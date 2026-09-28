const test=require('node:test');
const assert=require('node:assert/strict');
const {validateReportTopics,validateMinimum}=require('../main/topic-contract');
const {reviewTopicItems,summarizeTopics}=require('../main/editor');
const {buildSearchPlan}=require('../main/search-plan');
const {renderReport}=require('../main/generation-service');
const topics=[{id:'a',name_zh:'工业视觉',description:'工业缺陷检测，不关注聊天模型',min_items:1},{id:'b',name_zh:'聊天模型',description:'语言模型对话能力',min_items:1}];
const sources=[{id:'s1',topicIds:['a'],excerpt:'A measured industrial vision defect detection improvement.'}];
const item={topic_id:'a',topic_reviewed:3,headline:'Defect inspection',summary:'A measured change',source_ids:['s1'],evidence_quotes:[{source_id:'s1',quote:sources[0].excerpt}]};
test('rejects missing, duplicated, mislabeled, insufficient and cross-topic content',()=>{
  const report={sections:[{topic_id:'a',items:[item]}]};
  assert(validateReportTopics(report,[topics[0]],sources));
  assert.throws(()=>validateReportTopics(report,topics,sources),/Missing/);
  assert.throws(()=>validateReportTopics({sections:[report.sections[0],report.sections[0]]},topics,sources),/duplicate/);
  assert.throws(()=>validateReportTopics(report,[{...topics[0],min_items:2}],sources),{code:'TOPIC_SHORTFALL'});
  assert.throws(()=>validateReportTopics({sections:[{topic_id:'b',items:[item]}]},[topics[1]],sources),/归属/);
  assert.throws(()=>validateReportTopics(report,[topics[0]],[{...sources[0],topicIds:['b']}]),/引用越界/);
  assert.throws(()=>validateReportTopics({sections:[{topic_id:'a',items:[item,item]}]},[topics[0]],sources),/重复/);
  for(const value of [0,21,2.5,NaN])assert.throws(()=>validateMinimum(value));
});
test('independent reviewer rejects a search result that belongs to another topic',async()=>{
  const reviewed=await reviewTopicItems(topics[0],[item],topics,[],{},async()=>({text:JSON.stringify({decisions:[{id:'0',topic_id:'b',relevant:true,duplicate:false,reason:'Actually about a chat model'}]})}));
  assert.equal(reviewed.length,0);
});
test('shortage triggers two targeted searches then returns an explicit unavailable section',async()=>{
  let extra=0;
  const result=await summarizeTopics({topics:[topics[0]],sources:[],connection:{},searchMore:async topic=>{assert.equal(topic.id,'a');extra++;}});
  assert.equal(result.report.sections[0].status,'unavailable');
  assert.equal(result.report.sections[0].items.length,0);
  assert.equal(result.report.sections[0].shortfall.minimum,1);
  assert(validateReportTopics(result.report,[topics[0]],[],{allowPartial:true}));
  assert.equal(extra,2);
});
test('higher minimum increases search breadth and all topics receive a highlight',()=>{
  assert(buildSearchPlan([{...topics[0],min_items:20}]).length>buildSearchPlan(topics.slice(0,1)).length);
  const sections=Array.from({length:6},(_,i)=>({topic_id:`t${i}`,title:`Topic ${i}`,items:[{headline:`Item ${i}`,summary:'A new result',source_ids:[]}]}));
  const html=renderReport({report:{title:'Daily',sections},sources:[],model:'test',generatedAt:'now',collection:{}});
  assert.equal((html.match(/class="key-point"/g)||[]).length,6);
});
