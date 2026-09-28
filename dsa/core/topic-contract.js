const CONTRACT_VERSION=3;
function minimumItems(topic) {return topic.min_items===undefined?6:Number(topic.min_items);}
function validateMinimum(value) {
  const count=Number(value);
  if(!Number.isInteger(count)||count<1||count>20)throw new Error('每个主题的最低条数须为 1–20 的整数 / Minimum items must be an integer from 1 to 20');
  return count;
}
const normalized=value=>String(value||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function validateReportTopics(report,topics,sources,{reviewed=true,allowPartial=false}={}) {
  const sections=report?.sections || [];
  if(sections.length!==topics.length||new Set(sections.map(s=>s.topic_id)).size!==topics.length)throw new Error('主题结构不完整或出现重复 / Missing or duplicate topic sections');
  const sourceMap=new Map(sources.map(source=>[source.id,source]));
  const seen=new Set();
  for(const topic of topics) {
    const section=sections.find(section=>section.topic_id===topic.id);
    if(!section)throw new Error(`缺少主题：${topic.name_zh}`);
    if(!Array.isArray(section.items)||section.items.length<minimumItems(topic) && !(allowPartial && ['partial','unavailable'].includes(section.status) && section.shortfall?.minimum===minimumItems(topic) && section.shortfall?.found===section.items.length && section.shortfall?.reason))throw Object.assign(new Error(`${topic.name_zh}：至少需要 ${minimumItems(topic)} 条，目前 ${section.items?.length || 0} 条，未发布日报`),{code:'TOPIC_SHORTFALL'});
    for(const item of section.items) {
      if(item.topic_id!==topic.id || reviewed&&item.topic_reviewed!==CONTRACT_VERSION)throw new Error(`主题归属未通过复核：${topic.name_zh}`);
      if(!item.source_ids?.length||item.source_ids.some(id=>!sourceMap.get(id)?.topicIds?.includes(topic.id)))throw new Error(`主题引用越界：${topic.name_zh}`);
      const key=normalized(item.headline);
      const quoteKey=(item.evidence_quotes || []).map(q=>`${sourceMap.get(q.source_id)?.url || q.source_id}:${normalized(q.quote)}`).sort().join('|');
      if(!key||seen.has(key)||quoteKey&&seen.has(quoteKey))throw new Error('出现重复资讯，未发布日报 / Duplicate event');
      seen.add(key);if(quoteKey)seen.add(quoteKey);
    }
  }
  return true;
}
module.exports={CONTRACT_VERSION,minimumItems,validateMinimum,validateReportTopics};
