const test=require('node:test');
const assert=require('node:assert/strict');
const {fingerprint,partitionTopics}=require('../main/report-snapshot');
const {translateReport,embedBilingualHtml}=require('../main/report-language');
const {mergeReportSections,GenerationService,reportIncludesEnabledTopics}=require('../main/generation-service');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');

const topics=[
  {id:'old',name_zh:'旧主题',name_en:'Old topic',description:'unchanged coverage',enabled:true,min_items:1},
  {id:'new',name_zh:'新增主题',name_en:'New topic',description:'new coverage',enabled:true,min_items:1}
];
const item=(headline,sourceId)=>({headline,summary:'Specific evidence',why_it_matters:'Useful change',caveat:'Requires validation',source_ids:[sourceId],evidence_quotes:[{source_id:sourceId,quote:'Concrete evidence from the original article.'} ]});

test('old default-topic fingerprints survive the previous no-op edit translation bug',()=>{
  const {matchesFingerprint}=require('../main/report-snapshot');
  const topic={id:'agents-llm',name_zh:'AI 智能体与大模型',name_en:'AI 智能体与大模型',description:'模型、推理、训练、工具调用、评测与应用架构',min_items:6};
  const row={fingerprint:require('node:crypto').createHash('sha256').update(JSON.stringify([3,topic.id,topic.name_zh,'AI agents & LLMs',topic.description,6,'global'])).digest('hex')};
  assert(matchesFingerprint(row,topic));assert(!matchesFingerprint(row,{...topic,description:'A genuinely different topic scope'}));
  assert.equal(fingerprint(topic),fingerprint({...topic,description:' '+topic.description+'\n',name_en:'Other display label'}));
});

test('only new or edited topics enter the incremental search set',()=>{
  const snapshot={contractVersion:3,topics:[{id:'old',fingerprint:fingerprint(topics[0])}],zh:{sections:[{topic_id:'old',items:[{topic_id:'old',topic_reviewed:3}]}]},en:{sections:[{topic_id:'old',items:[{topic_id:'old',topic_reviewed:3}]}]}};
  let selected=partitionTopics(topics,snapshot);
  assert.deepEqual(selected.reuse.map(t=>t.id),['old']);
  assert.deepEqual(selected.search.map(t=>t.id),['new']);
  selected=partitionTopics([{...topics[0],description:'edited coverage'},topics[1]],snapshot);
  assert.deepEqual(selected.search.map(t=>t.id),['old','new']);
  assert.deepEqual(partitionTopics(topics,null).search.map(t=>t.id),['old','new']);
});

test('incremental merge preserves old results and remaps new source IDs',()=>{
  const snapshot={zh:{title:'旧日报',sections:[{topic_id:'old',title:'旧主题',items:[item('旧结果','S1')]}]},en:{title:'Old daily',sections:[{topic_id:'old',title:'Old topic',items:[item('Old finding','S1')]}]},sources:[{id:'S1',url:'https://old.example/article'}]};
  const zhNew={title:'新日报',sections:[{topic_id:'new',title:'新增主题',items:[item('新结果','S1')]}]};
  const enNew={title:'New daily',sections:[{topic_id:'new',title:'New topic',items:[item('New finding','S1')]}]};
  const merged=mergeReportSections(topics,snapshot,zhNew,enNew,[{id:'S1',url:'https://new.example/article'}]);
  assert.deepEqual(merged.zh.sections.map(s=>s.topic_id),['old','new']);
  assert.deepEqual(merged.en.sections.map(s=>s.topic_id),['old','new']);
  assert.equal(merged.zh.sections[0].items[0].source_ids[0],'S1');
  assert.notEqual(merged.zh.sections[1].items[0].source_ids[0],'S1');
  assert.equal(new Set(merged.sources.map(s=>s.id)).size,2);
});

test('report is translated once for HTML embedding and keeps source IDs',async()=>{
  const source={title:'日报',sections:[{topic_id:'new',title:'新增主题',items:[item('具体进展','S1')]}]};
  let calls=0;
  const translated=await translateReport(source,'en-US',{},async request=>{
    calls++;
    const input=JSON.parse(request.messages[0].content.split('Input: ')[1]);
    return {text:JSON.stringify({translations:input.map(field=>({id:field.id,text:`EN ${field.text}`})).reverse()})};
  });
  assert.equal(calls,1);
  assert.equal(translated.sections[0].items[0].source_ids[0],'S1');
  assert.equal(translated.sections[0].items[0].headline,'EN 具体进展');
  const zh='<html lang="zh-CN"><head><style>body{color:black}</style></head><body><main><h2>新增主题</h2></main></body></html>';
  const en='<html lang="en"><head><style>body{color:black}</style></head><body><main><h2>New topic</h2></main></body></html>';
  const html=embedBilingualHtml(zh,en,'en-US');
  assert.match(html,/id="daily-lang-en"[^>]*checked/);
  assert.match(html,/id="daily-report-zh"/);
  assert.match(html,/id="daily-report-en"/);
  assert.match(html,/New topic/);
  assert.match(html,/新增主题/);
});

test('same-day generation searches only the newly added topic',async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'daily-ai-incremental-'));
  let active=[topics[0]];const reports=[];const searched=[];
  const database={listTopics:()=>active,getSetting:()=>({language:'zh-CN'}),latestDailyReport:()=>reports.at(-1) || null,insertReport:record=>{reports.push(record);return record;}};
  const services={
    planTopics:async()=>({expansions:[],warnings:[]}),
    collectIntelligence:async({topics:requested})=>{
      searched.push(requested.map(topic=>topic.id));
      return {sources:requested.map(topic=>({id:'S1',topicIds:[topic.id],url:`https://example.org/${topic.id}`,title:topic.name_zh,source:'example.org',publishedAt:new Date().toISOString(),excerpt:'Concrete evidence from the original article.'})),fetched:1,searchStats:{exaCandidates:1,verifiedSearch:1},failures:[],coverage:requested.map(topic=>({topicId:topic.id,name:topic.name_zh,queries:7,selected:1,facets:['overview']})),plan:[],rejections:[]};
    },
    summarizeTopics:async({topics:requested})=>({report:{title:'日报',sections:requested.map(topic=>({topic_id:topic.id,title:topic.name_zh,items:[{...item(`${topic.name_zh} update`,'S1'),topic_id:topic.id,topic_reviewed:3}]}))},warnings:[]}),
    translateReport:async report=>({...report,title:'Daily report',sections:report.sections.map(section=>({...section,title:section.topic_id==='old'?'Old topic':'New topic',items:section.items.map(entry=>({...entry,headline:`EN ${entry.headline}`}))}))})
  };
  const service=new GenerationService({database,vault:{get:()=> 'test-secret'},dataDir,onProgress:()=>{},onComplete:()=>{},services});
  const model={credential_ref:'ref',provider:'custom',model:'test-model',base_url:'https://example.org/v1'};
  try {
    await service.run('2026-09-25',model,1);
    active=topics;
    const translate=service.services.translateReport;
    service.services.translateReport=async()=>{throw new Error('simulated translation failure');};
    await assert.rejects(service.run('2026-09-25',model,2),/simulated translation failure/);
    service.services.translateReport=translate;
    await service.run('2026-09-25',model,2);
    assert.deepEqual(searched,[['old'],['new']]);
    const html=fs.readFileSync(reports.at(-1).html_path,'utf8');
    assert(html.includes('旧主题') && html.includes('新增主题'));
    assert(html.includes('Old topic') && html.includes('New topic'));
    assert(html.includes('复用今日未变化主题'));
    assert.equal(reportIncludesEnabledTopics(reports.at(-1),topics),true);
    active=[topics[0]];
    await service.run('2026-09-25',model,3);
    assert.deepEqual(searched,[['old'],['new']]);
    assert.equal(reportIncludesEnabledTopics(reports.at(-1),active),true);
    assert.equal(fs.readFileSync(reports.at(-1).html_path,'utf8').includes('<h2>新增主题</h2>'),false);
  } finally {
    assert(dataDir.startsWith(os.tmpdir()+path.sep));
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
});

test('the actual save path keeps progress sequence increasing through completion',async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'daily-ai-save-progress-'));
  const topic={id:'save-topic',name_zh:'保存阶段',description:'验证完成信号',enabled:true,min_items:1};
  const source={id:'S1',topicIds:[topic.id],url:'https://example.org/evidence',source:'example.org',title:'Evidence',publishedAt:new Date().toISOString(),excerpt:'Concrete evidence from the original article.'};
  const database={listTopics:()=>[topic],findDailyReport:()=>null,getDefaultModelRecord:()=>({credential_ref:'ref',provider:'custom',model:'test',base_url:'https://example.org/v1'}),getTopicRevision:()=>1,getSetting:()=>({language:'zh-CN'}),setSetting:()=>{},latestDailyReport:()=>null,insertReport:record=>record};
  const services={planTopics:async()=>({expansions:[],warnings:[]}),collectIntelligence:async()=>({sources:[source],fetched:1,searchStats:{},failures:[],coverage:[{topicId:topic.id,name:topic.name_zh,selected:1,queries:1}],plan:[],rejections:[]}),summarizeTopics:async()=>({report:{title:'日报',sections:[{topic_id:topic.id,title:topic.name_zh,items:[{...item('A genuine saved result','S1'),topic_id:topic.id,topic_reviewed:3}]}]},warnings:[]}),translateReport:async report=>report};
  const seen=[];let resolve;
  const finished=new Promise(done=>resolve=done);
  const service=new GenerationService({database,vault:{get:()=> 'test'},dataDir,services,onProgress:progress=>{seen.push({stage:progress.stage,status:progress.status,sequence:progress.sequence,percent:progress.percent});if(progress.status==='completed'||progress.status==='failed')resolve(progress);},onComplete:()=>{}});
  try{
    assert.equal(service.start().status,'started');
    const result=await Promise.race([finished,new Promise((_,reject)=>setTimeout(()=>reject(new Error('save stage did not finish')),3000))]);
    assert.equal(result.status,'completed',result.detail);
    const saving=seen.find(row=>row.stage==='保存报告'&&row.percent>=94);
    const completed=seen.at(-1);
    assert(saving);assert(completed.sequence>saving.sequence);
    assert.equal(completed.percent,100);
  }finally{fs.rmSync(dataDir,{recursive:true,force:true});}
});
