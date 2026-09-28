const test=require('node:test');const assert=require('node:assert/strict');
const {buildSearchPlan}=require('../main/search-plan');
const {parseMcpResults,extractArticle,publicUrl}=require('../main/search-engine');
const {selectSources}=require('../main/intelligence-sources');
const {validateItems,summarizeTopics}=require('../main/editor');
const {callModel}=require('../main/glm-client');
const {reportIncludesEnabledTopics}=require('../main/generation-service');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
test('every unpredictable topic retains generic queries plus routed channels and description',()=>{
  const topics=Array.from({length:12},(_,i)=>({id:`t${i}`,name_zh:`领域${i}`,description:`研究方向${i}`}));
  const plan=buildSearchPlan(topics,[],new Date('2026-09-24'));
  assert(plan.length>=84);assert(plan.filter(p=>p.topicId==='t11').length>=7);
  assert(plan.some(p=>p.query.includes('研究方向11')));
  assert(!plan.some(p=>/openai\.com|siemens|vllm/.test(p.query)));
});
test('MCP parser accepts structured data, nested JSON, and current text blocks',()=>{
  const item={title:'A result',url:'https://example.org/article',publishedDate:'2026-09-24',text:'Evidence'};
  assert.equal(parseMcpResults({structuredContent:{results:[item]}},'query').length,1);
  assert.equal(parseMcpResults({content:[{type:'text',text:JSON.stringify(JSON.stringify([item]))}]},'query').length,1);
  const parsed=parseMcpResults({content:[{type:'text',text:'Title: A result\nURL: https://example.org/article\nPublished Date: 2026-09-24\nText: Full original text'}]},'query');
  assert.equal(parsed[0].excerpt,'Full original text');
});
test('original content and date provenance survive verification; stale/future rejected',()=>{
  const now=Date.parse('2026-09-24T12:00:00Z');const item={url:'https://example.org/article',publishedAt:'2026-09-23',topicIds:['a']};
  const html='<title>Findings</title><article><p>'+('Measured scientific evidence. '.repeat(20))+'</p></article>';
  assert.equal(extractArticle(html,item,now).dateEvidence,'search-index');
  assert(extractArticle(html,item,now).excerpt.length>400);
  assert.throws(()=>extractArticle(html,{...item,publishedAt:'2026-01-01'},now),/window/);
  assert.throws(()=>extractArticle(html,{...item,publishedAt:'2027-01-01'},now),/window/);
  assert.equal(publicUrl('http://localhost/private'),'');
});
test('source quota cannot crowd out a later topic; quotes must exist in cited source',()=>{
  const now=Date.now();const items=Array.from({length:20},(_,i)=>({url:`https://host${i}.example/a`,title:`Article ${i}`,publishedAt:new Date(now).toISOString(),topicIds:[i===19?'last':'first'],score:20-i}));
  assert(selectSources(items,now,4).some(s=>s.topicIds.includes('last')));
  const source={id:'S1',excerpt:'An exact measurable result from the original article.'};
  assert.equal(validateItems([{headline:'Claim',summary:'Result',evidence_quotes:[{source_id:'S1',quote:'Completely fabricated evidence'}]}],[source]).length,0);
  assert.equal(validateItems([{headline:'Claim',summary:'Result',evidence_quotes:[{source_id:'S1',quote:source.excerpt}]}],[source]).length,1);
});
test('all supported generation vendors keep credentials scoped to their protocol',async()=>{
  for(const provider of ['glm','openai','anthropic','gemini','deepseek','qwen','doubao','custom']){
    let called;
    const result=await callModel({provider,apiKey:'test-key-not-real',model:'test-model',baseUrl:'https://vendor.example/v1',messages:[{role:'user',content:'test'}],fetchImpl:async(url,options)=>{
      called={url,options};return {ok:true,json:async()=>provider==='anthropic'?{content:[{type:'text',text:'OK'}]}:{choices:[{message:{content:'OK'}}]}};
    }});
    assert.equal(result.text,'OK');assert(called.url.startsWith('https://vendor.example/'));
    assert.equal(called.options.headers[provider==='anthropic'?'x-api-key':'Authorization'],provider==='anthropic'?'test-key-not-real':'Bearer test-key-not-real');
  }
});

test('editor retries a smaller batch and publishes every enabled topic',async()=>{
  const topics=['first','second','third'].map(id=>({id,name_zh:id,description:id,min_items:1}));
  const sources=topics.flatMap(topic=>Array.from({length:8},(_,i)=>({id:`${topic.id}-${i}`,topicIds:[topic.id],title:'Evidence',url:`https://example.org/${topic.id}/${i}`,publishedAt:new Date().toISOString(),excerpt:`${topic.id} documented a concrete result with measurable evidence. `.repeat(80)})));
  let calls=0;const lengths=[];
  const modelCaller=async request=>{
    if(request.messages[0].content.startsWith('TASK:topic-review')){const input=JSON.parse(request.messages[0].content.split('Input: ')[1]);return {text:JSON.stringify({decisions:input.items.map(item=>({id:item.id,topic_id:input.target_topic_id,relevant:true,duplicate:false,reason:'Directly described in evidence'}))})};}
    calls++;lengths.push(request.messages[0].content.length);
    if(calls===1)throw new Error('Model request timed out or was cancelled');
    const topicId=request.messages[0].content.match(/"id":"(first|second|third)"/)[1];
    const sourceId='S1';
    return {text:JSON.stringify({items:[{topic_id:topicId,headline:`${topicId} update`,summary:'Measured result',evidence_quotes:[{source_id:sourceId,quote:`${topicId} documented a concrete result with measurable evidence.`}]}]})};
  };
  const result=await summarizeTopics({topics,sources,connection:{},modelCaller});
  assert.equal(result.report.sections.length,3);
  assert.equal(calls,4);
  assert(lengths.slice(1).some(length=>length<lengths[0]),'Retry uses a smaller prompt even when another topic runs concurrently');
  assert(lengths[0]<24000);
});

test('one failed topic does not erase another topic; unavailable topic remains explicit',async()=>{
  const topics=['one','two'].map(id=>({id,name_zh:id,description:id,min_items:1}));
  const sources=topics.map(topic=>({id:topic.id,topicIds:[topic.id],title:topic.id,url:`https://example.org/${topic.id}`,publishedAt:new Date().toISOString(),excerpt:`${topic.id} has clear independently recorded evidence. `.repeat(30)}));
  const modelCaller=async request=>{
    if(request.messages[0].content.startsWith('TASK:topic-review'))return {text:JSON.stringify({decisions:[{id:'0',topic_id:'one',relevant:true,duplicate:false,reason:'Specific measured result'}]})};
    if(request.messages[0].content.includes('"name":"two"'))throw new Error('timeout');
    return {text:JSON.stringify({items:[{topic_id:'one',headline:'One',summary:'Result',evidence_quotes:[{source_id:'S1',quote:'one has clear independently recorded evidence.'}]}]})};
  };
  const result=await summarizeTopics({topics,sources,connection:{},modelCaller});
  assert.equal(result.report.sections.length,2);assert.equal(result.report.sections[0].items.length,1);
  assert.deepEqual(result.report.sections[0].items[0].source_ids,['one'],'Prompt-local IDs must return to persistent source IDs');
  assert.equal(result.report.sections[1].status,'unavailable');assert(result.report.sections[1].shortfall.reason);
});

test('a same-day report missing enabled topics can be regenerated',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'daily-ai-incomplete-'));
  const filename=path.join(directory,'report.html');
  try {
    fs.writeFileSync(filename,'<section><h2>Third topic</h2></section>');
    const report={html_path:filename};
    assert.equal(reportIncludesEnabledTopics(report,[{name_zh:'First topic'},{name_zh:'Third topic'}]),false);
    fs.writeFileSync(filename,'<section><h2>First topic</h2></section><section><h2>Third topic</h2></section>');
    assert.equal(reportIncludesEnabledTopics(report,[{name_zh:'First topic'},{name_zh:'Third topic'}]),false,'Legacy headings alone are not proof of validated coverage');
  } finally {fs.rmSync(filename,{force:true});fs.rmdirSync(directory);}
});
