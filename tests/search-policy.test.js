const test=require('node:test'),assert=require('node:assert/strict');
const {buildSearchPlan,plannerPrompt}=require('../main/search-plan');
const {parseArxiv,parseCrossref}=require('../main/scholarly-search');
const {summarizeTopics}=require('../main/editor');
const {validateReportTopics}=require('../main/topic-contract');
test('a single article cannot be split into several counted events',()=>{
  const {validateItems}=require('../main/editor');
  const source={id:'S1',url:'https://example.org/paper',excerpt:'An original measured result demonstrates a useful advance.'};
  const rows=['Result','Discussion','Implications'].map(headline=>({topic_id:'t',headline,summary:'Summary',evidence_quotes:[{source_id:'S1',quote:source.excerpt}]}));
  assert.equal(validateItems(rows,[source],'t').length,1);
});
test('scholarly ranking favors domain evidence over generic keyword matches',()=>{
  const {rankAbstracts}=require('../main/scholarly-search');
  const queries=[{term:'unsupervised visual learning'},{term:'semi-supervised visual segmentation'}];
  const rows=[{title:'Unsupervised financial learning',excerpt:'Financial market analysis'},{title:'Visual segmentation',excerpt:'Semi-supervised and unsupervised visual learning for images'}];
  assert.equal(rankAbstracts(rows,queries)[0].title,'Visual segmentation');
});
test('profile and dictionary pages are removed without excluding publisher articles',()=>{
  const {isArticleCandidate}=require('../main/search-engine');
  assert.equal(isArticleCandidate({url:'https://university.example/teacher/123'}),false);
  assert.equal(isArticleCandidate({url:'https://baike.baidu.com/item/self/123'}),false);
  assert.equal(isArticleCandidate({url:'https://university.example/news/new-paper'}),true);
});
test('all requested research branches enter first-pass search before generic media',()=>{
  const topic={id:'t',name_zh:'无监督视觉AI最新进展',description:'侧重顶刊顶会论文，关注无监督弱监督半监督视觉模型最新进展。'};
  const branches=[['u','无监督视觉学习','unsupervised visual learning'],['w','弱监督图像分割','weakly supervised image segmentation'],['s','半监督视觉学习','semi-supervised visual learning']].map(([id,local_query,english_query])=>({id,local_query,english_query}));
  const plan=buildSearchPlan([topic],[{topic_id:'t',intent:'research',branches,local_query:'视觉学习',english_query:'visual learning',channels:['research']}]);
  for(const branch of branches)assert(plan.some(row=>row.query.includes(branch.english_query)));
  assert(plan.some(row=>row.query.includes(branches[0].local_query)));
  assert(plan.some(row=>row.query.includes('site:arxiv.org')));
  assert(!plan.slice(0,8).some(row=>/reuters|apnews|视频号/.test(row.query)));
  assert.match(plannerPrompt([topic]),/Enumerated interests mean OR/);
});
test('academic metadata uses actual submission/publication dates and author abstracts',()=>{
  const now=Date.parse('2026-09-26T12:00Z'),plan={topicId:'t'},abstract='We evaluate weakly supervised visual segmentation with measured improvements. '.repeat(4);
  const atom=`<feed><entry><id>http://arxiv.org/abs/2609.12345v1</id><title>Visual segmentation</title><published>2026-09-24T00:00:00Z</published><summary>${abstract}</summary></entry></feed>`;
  assert.equal(parseArxiv(atom,plan,now)[0].evidence,'author-abstract');
  assert.equal(parseArxiv(atom.replace('2026-09-24','2025-09-24'),plan,now).length,0);
  const row={DOI:'10.1234/example',title:['Study'],abstract,published:{'date-parts':[[2026,9,24]]},'container-title':['Journal']};
  assert.equal(parseCrossref({message:{items:[row]}},plan,now)[0].dateEvidence,'publisher-publication');
  assert.equal(parseCrossref({message:{items:[{...row,published:{'date-parts':[[2026,9]]}}]}},plan,now).length,0);
  assert.equal(parseCrossref({message:{items:[{...row,abstract:''}]}},plan,now).length,0);
});
test('specific topic retains shared evidence and broad topic refills with a different event',async()=>{
  const topics=[{id:'b',name_zh:'视觉与工业',description:'所有视觉论文与工业产品',min_items:1},{id:'n',name_zh:'弱监督视觉',description:'弱监督视觉论文',min_items:1}];
  const sources=[{id:'shared',title:'Specific paper',url:'https://example.org/shared',topicIds:['b','n'],excerpt:'Weakly supervised segmentation provides a measured visual improvement.'},{id:'other',title:'Industrial product',url:'https://example.org/other',topicIds:['b'],excerpt:'A new industrial inspection product provides measured deployment results.'}];
  const modelCaller=async({messages})=>{
    const prompt=messages[0].content;
    if(prompt.startsWith('TASK:topic-review')){const data=JSON.parse(prompt.split('Input: ')[1]);return {text:JSON.stringify({decisions:data.items.map(row=>({id:row.id,topic_id:data.target_topic_id,relevant:true,duplicate:false,reason:'Direct evidence within target scope'}))})};}
    const topicId=prompt.match(/"id":"([bn])"/)[1];
    const rows=JSON.parse(prompt.split('Sources: ')[1].replace(/ Copy every quote exactly\.$/,'')),row=rows[0];
    return {text:JSON.stringify({items:[{topic_id:topicId,headline:row.title,summary:'Measured event',evidence_quotes:[{source_id:row.id,quote:row.excerpt}]}]})};
  };
  const result=await summarizeTopics({topics,sources,connection:{},modelCaller,expansions:[{topic_id:'b',specificity:1},{topic_id:'n',specificity:5}]});
  assert.equal(result.report.sections[0].items[0].headline,'Industrial product');
  assert.equal(result.report.sections[1].items[0].headline,'Specific paper');
  assert(validateReportTopics(result.report,topics,sources));
  assert(result.audit.every(row=>row.decisions?.length));
});
