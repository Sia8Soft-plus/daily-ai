const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DailyAiDatabase}=require('../main/database'),{GenerationService,reportIncludesEnabledTopics}=require('../main/generation-service');
const {loadDaySnapshot,composeDaySnapshot}=require('../main/daily-reuse');
const {saveSnapshot,loadSnapshot,fingerprint}=require('../main/report-snapshot');
const topic=(id,min=1)=>({id,name_zh:id,name_en:id,description:id+' research',enabled:true,min_items:min,region_preference:'global'});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'daily-reuse-'));const db=new DailyAiDatabase(dir);db.db.exec('DELETE FROM topics');let active=[topic('alpha',6)],calls=[],translations=[];
 db.listTopics=()=>active;const date='2026-09-28';
 const services={planTopics:async topics=>({expansions:[],warnings:[]}),collectIntelligence:async({topics})=>{calls.push(topics.map(t=>t.id));return {sources:topics.flatMap(t=>Array.from({length:t.id==='alpha'?2:1},(_,i)=>({id:t.id+i,topicIds:[t.id],url:'https://example.test/'+t.id+'/'+i,title:t.id+' concrete discovery '+i,source:'example',publishedAt:new Date().toISOString()}))),fetched:1,searchStats:{},failures:[],coverage:[],plan:[],rejections:[]};},summarizeTopics:async({topics,sources})=>({report:{title:'Daily',sections:topics.map(t=>{const items=sources.filter(s=>s.topicIds.includes(t.id)).map(s=>({topic_id:t.id,topic_reviewed:3,headline:s.title,summary:'Concrete evidence '+s.title,source_ids:[s.id]}));return {topic_id:t.id,title:t.name_zh,items,...(items.length<t.min_items?{status:'partial',shortfall:{minimum:t.min_items,found:items.length,reason:'insufficient_verified_items',rounds:2}}:{})};})},warnings:[]}),translateReport:async report=>{translations.push(report.sections.map(s=>s.topic_id));return structuredClone(report);}};
 const service=new GenerationService({database:db,vault:{get:()=> 'fixture'},dataDir:dir,services,onProgress:()=>{},onComplete:()=>{}}),model={credential_ref:'fixture',provider:'custom',model:'fixture'};
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});return {db,dir,date,calls,translations,service,set:topics=>active=topics,run:()=>service.run(date,model,1)};
}
test('same-day partial sections, remove/re-enable, minimum and language changes search only new topics',async t=>{
 const f=fixture(t);await f.run();assert.equal(reportIncludesEnabledTopics(f.db.latestDailyReport(f.date),[topic('alpha',6)]),true);
 f.set([topic('alpha',6),topic('beta')]);await f.run();
 f.set([topic('alpha',6)]);await f.run();
 f.set([topic('alpha',10),topic('beta')]);f.db.setSetting('preferences',{language:'en-US'});await f.run();
 assert.deepEqual(f.calls,[['alpha'],['beta']]);const s=loadSnapshot(f.dir,f.db.latestDailyReport(f.date));assert.deepEqual(s.zh.sections.map(s=>[s.topic_id,s.items.length]),[['alpha',2],['beta',1]]);assert.equal(s.zh.sections[0].shortfall.minimum,10);
});
test('deleted sidecar uses embedded bilingual data; corrupt latest section falls back to an earlier daily',async t=>{
 const f=fixture(t);await f.run();const first=f.db.latestDailyReport(f.date);fs.unlinkSync(path.join(f.dir,'report-snapshots',first.id+'.json'));
 f.set([topic('alpha',6),topic('beta')]);await f.run();assert.deepEqual(f.calls,[['alpha'],['beta']]);
 const last=f.db.latestDailyReport(f.date),s=loadSnapshot(f.dir,last);s.zh.sections[0].items=[];s.en.sections[0].items=[];saveSnapshot(f.dir,last.id,s);
 f.set([topic('alpha',6),topic('beta'),topic('gamma')]);await f.run();assert.deepEqual(f.calls,[['alpha'],['beta'],['gamma']]);
});
test('missing English is translated without search; a changed scope and a new date do search',async t=>{
 const f=fixture(t);await f.run();const report=f.db.latestDailyReport(f.date),s=loadSnapshot(f.dir,report);s.en=null;saveSnapshot(f.dir,report.id,s);await f.run();assert.deepEqual(f.calls,[['alpha']]);assert.deepEqual(f.translations,[['alpha'],['alpha']]);
 f.set([{...topic('alpha',6),description:'a different scope'}]);await f.run();assert.deepEqual(f.calls,[['alpha'],['alpha']]);assert.equal(loadDaySnapshot(f.db,f.dir,'2026-09-29',[topic('alpha',6)]),null);
 assert.equal(composeDaySnapshot([topic('alpha',6)],[{...s,reportDate:'2026-09-27'}],f.date),null);
});
test('legacy generated HTML without a sidecar recovers citations instead of searching again',async t=>{
 const f=fixture(t);await f.run();const row=f.db.latestDailyReport(f.date);fs.unlinkSync(path.join(f.dir,'report-snapshots',row.id+'.json'));fs.writeFileSync(row.html_path,fs.readFileSync(row.html_path,'utf8').replace(/<script type="application\/json" id="daily-report-snapshot">[^<]+<\/script>/,''));
 await f.run();assert.deepEqual(f.calls,[['alpha']]);assert.equal(loadSnapshot(f.dir,f.db.latestDailyReport(f.date)).zh.sections[0].items.length,2);
});
