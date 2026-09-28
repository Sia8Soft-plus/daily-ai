const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {normalizeUsage}=require('../main/model-usage');
const {activeDocumentStats,nextCleanup,usageWindow}=require('../main/dashboard-stats');

test('model usage accepts provider variants and never invents absent token counts',()=>{
  assert.deepEqual(normalizeUsage({prompt_tokens:120,completion_tokens:30,total_tokens:150}),{inputTokens:120,outputTokens:30,totalTokens:150});
  assert.deepEqual(normalizeUsage({input_tokens:9,output_tokens:4}),{inputTokens:9,outputTokens:4,totalTokens:13});
  assert.deepEqual(normalizeUsage(null),{inputTokens:null,outputTokens:null,totalTokens:null});
  assert.equal(normalizeUsage({total_tokens:'NaN'}).totalTokens,null);
  const window=usageWindow(new Date(2026,8,26,12));
  assert.equal(new Date(window.todayStart).getDate(),26);
  assert.equal(new Date(window.monthStart).getDate(),1);
});

test('storage statistics exclude trashed reports and do not count deleted HTML',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'daily-ai-dashboard-'));
  try{
    const active=path.join(dir,'active.html'),trashed=path.join(dir,'trash.html');
    fs.writeFileSync(active,'abc');fs.writeFileSync(trashed,'x'.repeat(500));fs.writeFileSync(path.join(dir,'daily-ai.db'),'12345');
    const db={listReports:()=>[{id:'active',report_type:'daily',is_favorite:false,html_path:active},{id:'favorite',report_type:'digest',is_favorite:true,html_path:path.join(dir,'missing.html')}]};
    const stats=await activeDocumentStats(db,dir);
    assert.deepEqual([stats.total,stats.daily,stats.digest,stats.favorites,stats.htmlBytes,stats.indexBytes,stats.missing],[2,1,1,1,3,5,1]);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('next cleanup follows actual settings and last execution date',()=>{
  const now=new Date(2026,8,26,12,0);
  assert.equal(nextCleanup({cleanupEnabled:false},null,now).at,null);
  assert.equal(nextCleanup({cleanupTime:'03:30'},'2026-09-26',now).enabled,true);
  assert.equal(new Date(nextCleanup({cleanupTime:'03:30'},'2026-09-26',now).at).getDate(),27);
  assert.equal(nextCleanup({cleanupTime:'03:30'},null,now).due,true);
});
