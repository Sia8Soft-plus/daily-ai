const test=require('node:test');const assert=require('node:assert/strict');
const {resolveRoute}=require('../main/source-router');
const {buildSearchPlan,plannerPrompt}=require('../main/search-plan');
const {minimumItems}=require('../main/topic-contract');
const {fingerprint,partitionTopics}=require('../main/report-snapshot');
const {ActivityStore}=require('../main/activity');
const {cutoffDate,candidates}=require('../main/retention');
const {renderReport}=require('../main/generation-service');
test('semantic routes retain open search, diversify channels and reject unsafe model domains',()=>{
  const topic={id:'unsupervised',name_zh:'无监督AI',description:'聚类和无监督表示学习',region_preference:'domestic'};
  const expansion={topic_id:topic.id,local_query:'无监督学习 聚类',english_query:'unsupervised representation learning',aliases:['unsupervised learning','clustering'],channels:['research','open_global','technical_cn','not-real'],domains:['arxiv.org','127.0.0.1','http://localhost/private','evil.test'],route_reason:'research and implementations'};
  const route=resolveRoute(topic,expansion);assert.deepEqual(route.domains,['arxiv.org']);assert(route.channels.includes('wechat'));assert(route.channels.includes('channels'));
  const initial=buildSearchPlan([topic],[expansion],new Date('2026-09-26'));
  const retry=buildSearchPlan([topic],[expansion],new Date('2026-09-26'),1);
  for(const facet of ['research','opensource','social','community','news'])assert(initial.some(row=>row.facet===facet));
  assert(initial.some(row=>!row.query.includes('site:')));assert(initial.some(row=>row.query.includes('mp.weixin.qq.com')));
  assert(retry.some(row=>row.query.includes('openreview.net')));assert(retry.some(row=>row.route==='semantic-expansion'));
  assert(plannerPrompt([topic]).includes('unsupervised learning'));assert.equal(minimumItems({}),6);
  assert.notEqual(fingerprint(topic),fingerprint({...topic,region_preference:'global'}));
  assert.doesNotThrow(()=>resolveRoute(topic,{aliases:'malformed',domains:[null],channels:42}));
});
test('activity events deduplicate, survive store recreation and can be individually read',()=>{
  const values={};const db={getSetting:(k,v)=>values[k]??v,setSetting:(k,v)=>values[k]=v};
  const store=new ActivityStore(db),message={key:'task:1',kind:'error',title:{zh:'失败',en:'Failed'},body:{zh:'需重试',en:'Retry'}};
  const row=store.add(message);assert(row);assert.equal(store.add(message),null);assert.equal(store.unread(),1);
  const restored=new ActivityStore(db);assert.equal(restored.unread(),1);restored.read(row.id);assert.equal(restored.unread(),0);assert.equal(restored.list().length,1);
});
test('retention protects favorites and digests and clamps month-end dates',()=>{
  assert.equal(cutoffDate(1,new Date(2026,2,31)),'2026-02-28');
  const db={listReports:()=>[{id:'a',report_type:'daily',period_end:'2025-01-01'},{id:'b',report_type:'daily',period_end:'2025-01-01',is_favorite:true},{id:'c',report_type:'digest',period_end:'2025-01-01'},{id:'d',report_type:'daily',period_end:'2026-09-26'}]};
  assert.deepEqual(candidates(db,'2026-03-26').map(row=>row.id),['a']);
});
test('a partial topic remains visible in both report languages and is never reused as complete',()=>{
  const topic={id:'a',name_zh:'无监督AI',min_items:6};
  const section={topic_id:'a',title:'Unsupervised AI',items:[],status:'unavailable',shortfall:{minimum:6,found:0,rounds:3,reason:'no_verified_items'}};
  const report={title:'Daily',sections:[section]};
  for(const language of ['zh-CN','en-US']){
    const html=renderReport({report,sources:[],model:'test',generatedAt:'now',language});assert(html.includes('0/6'));assert(html.includes('data-topic-id="a"'));
  }
  assert.equal(partitionTopics([topic],{contractVersion:3,topics:[{id:'a',fingerprint:fingerprint(topic)}],zh:report,en:report}).search.length,1);
});

test('MCP reader accepts only exact dated source matches, never stale or mismatched pages',()=>{
  const {parseReadResult}=require('../main/search-engine');const now=Date.parse('2026-09-26T12:00:00Z');
  const item={url:'https://example.org/news',title:'Evidence',topicIds:['a'],publishedAt:'2026-09-25'};
  const response={content:[{type:'text',text:'# Evidence\nURL: https://example.org/news\n'+ 'Specific original observations. '.repeat(30)}]};
  assert.equal(parseReadResult(response,[item],now).length,1);
  assert.equal(parseReadResult(response,[{...item,url:'https://other.org/news'}],now).length,0);
  assert.equal(parseReadResult(response,[{...item,publishedAt:'2025-01-01'}],now).length,0);
  assert.equal(parseReadResult(response,[{...item,publishedAt:null}],now).length,0);
});
