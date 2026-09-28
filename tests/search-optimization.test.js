const test=require('node:test'),assert=require('node:assert/strict');
const {buildSearchPlan}=require('../main/search-plan');
const {publicUrl,extractArticle,parseGlmRead}=require('../main/search-engine');
const {selectSources}=require('../main/intelligence-sources');
const health=require('../main/search-health');
const {translateReport}=require('../main/report-language');
const {callModel}=require('../main/glm-client');
test('low reasoning is scoped to documented GLM model versions',async()=>{
  for(const [provider,model,expected] of [['glm','glm-5.3','low'],['glm','glm-5.2','low'],['glm','glm-4.7',undefined],['openai','glm-5.3',undefined]]){
    let body;
    await callModel({provider,model,apiKey:'test',baseUrl:'https://vendor.example/v1',messages:[],fetchImpl:async(url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:'OK'}}]})};}});
    assert.equal(body.reasoning_effort,expected);
  }
});
test('niche topic synonyms are independent queries from round one with bounded followups',()=>{
  const topic={id:'niche',name_zh:'无监督视觉AI',min_items:6};
  const expansion={topic_id:'niche',local_query:'无监督视觉 | unsupervised vision',english_query:'无监督视觉 | unsupervised vision',aliases:['unsupervised anomaly detection','self-supervised visual representations','视觉聚类'],channels:['research','open_global']};
  const plans=[0,1,2].map(round=>buildSearchPlan([topic],[expansion],new Date('2026-09-26'),round));
  assert(plans[0].some(p=>p.query.startsWith('unsupervised anomaly detection')));
  assert(plans.flat().every(p=>!p.query.includes('|')));assert(plans.flat().length<=30);
  assert(plans[1].every(p=>!plans[0].some(old=>old.query===p.query)),'Supplemental queries must differ');
});
test('research abstract pages retain their real submission dates and PDF discovery resolves to abstract',()=>{
  const now=Date.parse('2026-09-26T12:00:00Z');
  assert.equal(publicUrl('https://arxiv.org/pdf/2609.12345.pdf'),'https://arxiv.org/abs/2609.12345');
  assert.equal(publicUrl('https://arxiv.org/html/2609.12345v1'),'https://arxiv.org/abs/2609.12345v1');
  const body='<title>A vision paper</title><main><div>[Submitted on 23 Sep 2026]</div><blockquote class="abstract">'+('We evaluate unsupervised anomaly detection on industrial images. '.repeat(8))+'</blockquote></main>';
  const result=extractArticle(body,{url:'https://arxiv.org/abs/2609.12345'},now);
  assert.equal(result.publishedAt,'2026-09-23T00:00:00.000Z');assert.match(result.excerpt,/unsupervised/);assert.equal(result.dateEvidence,'page-publication');
  assert.throws(()=>extractArticle(body.replace('23 Sep 2026','23 Sep 2025'),{url:result.url},now),/window/);
});
test('a rate-limited search channel is paused independently of other configured credentials',()=>{
  health.recordFailure('exa','test-a',new Error('free MCP rate limit'),1000);
  assert(health.paused('exa','test-a',1001));assert.equal(health.paused('exa','test-b',1001),null);
  assert.equal(health.paused('exa','test-a',1000+16*60000),null);
});
test('reader evidence requires a matching URL, usable text and a real date',()=>{
  const now=Date.parse('2026-09-26T12:00:00Z'),item={url:'https://example.org/news',topicIds:['niche']};
  const row={url:item.url,title:'Finding',content:'Documented evidence. '.repeat(40),metadata:{datePublished:'2026-09-25'}};
  const wrap=value=>({content:[{type:'text',text:JSON.stringify({reader_result:value})}]});
  assert(parseGlmRead(wrap(row),item,now));assert.equal(parseGlmRead(wrap({...row,url:'https://evil.example/news'}),item,now),null);
  assert.equal(parseGlmRead(wrap({...row,metadata:{}}),item,now),null);
});
test('publisher diversity does not discard relevant papers when a topic is concentrated on one archive',()=>{
  const rows=Array.from({length:14},(_,i)=>({url:`https://arxiv.org/abs/2609.${i}`,publishedAt:new Date().toISOString(),topicIds:['niche']}));
  assert.equal(selectSources(rows,Date.now(),24).length,14);
});
test('bilingual translation uses at most two concurrent batches while preserving every field',async()=>{
  let active=0,max=0,calls=0;
  const report={title:'Report',sections:[{topic_id:'a',title:'A',items:Array.from({length:20},(_,i)=>({headline:`Headline ${i}`,summary:`Summary ${i}`,why_it_matters:'Meaning',caveat:'Limit'}))}]};
  const translated=await translateReport(report,'en-US',{},async({messages})=>{
    active++;calls++;max=Math.max(max,active);await new Promise(resolve=>setImmediate(resolve));
    const rows=JSON.parse(messages[0].content.split('Input: ')[1]);active--;
    return {text:JSON.stringify({translations:rows.map(row=>({id:row.id,text:'EN '+row.text}))})};
  });
  assert.equal(max,2);assert(calls<7);assert.equal(translated.sections[0].items[19].headline,'EN Headline 19');
});
