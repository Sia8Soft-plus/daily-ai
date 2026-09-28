const crypto=require('node:crypto');
const {loadSnapshot,partitionTopics,fingerprint}=require('./report-snapshot');
const {CONTRACT_VERSION,minimumItems}=require('./topic-contract');

// Inputs are newest first. Prefer the largest usable section for each exact topic scope.
function composeDaySnapshot(topics,snapshots,date){
  const candidates=snapshots.filter(s=>s&&(!s.reportDate||s.reportDate===date));
  const result={version:1,contractVersion:CONTRACT_VERSION,reportDate:date,topics:[],zh:{title:'',sections:[]},en:{title:'',sections:[]},sources:[],coverage:[]};
  const sources=new Map();
  for(const topic of topics){
    let selected;
    for(const snapshot of candidates){
      if(!partitionTopics([topic],snapshot).reuse.length)continue;
      const section=snapshot.zh.sections.find(s=>s.topic_id===topic.id),byId=new Map((snapshot.sources||[]).map(s=>[s.id,s]));
      const indexes=section.items.map((item,index)=>({item,index})).filter(({item})=>item.headline&&item.summary&&item.source_ids?.length&&item.source_ids.every(id=>byId.get(id)?.topicIds?.includes(topic.id)));
      if(indexes.length&&(!selected||indexes.length>selected.indexes.length))selected={snapshot,section,byId,indexes};
    }
    if(!selected)continue;
    const {snapshot,section,byId,indexes}=selected,remap=new Map();
    for(const {item} of indexes)for(const id of item.source_ids){
      const source=byId.get(id),key='reuse-'+crypto.createHash('sha256').update(source.url||id).digest('hex').slice(0,20);
      remap.set(id,key);const old=sources.get(key);sources.set(key,{...source,id:key,topicIds:[...new Set([...(old?.topicIds||[]),...source.topicIds])]});
    }
    const clone=part=>{
      const value={...part,topic_id:topic.id,items:indexes.map(({index})=>{const item=part.items[index];return {...item,topic_id:topic.id,source_ids:item.source_ids.map(id=>remap.get(id)),evidence_quotes:(item.evidence_quotes||[]).map(q=>({...q,source_id:remap.get(q.source_id)||q.source_id}))};})};
      if(value.items.length<minimumItems(topic)){value.status='partial';value.shortfall={...value.shortfall,minimum:minimumItems(topic),found:value.items.length,rounds:value.shortfall?.rounds||0,reason:value.shortfall?.reason||'reused_day_coverage'};}
      else {delete value.shortfall;value.status='complete';}
      return value;
    };
    result.zh.sections.push(clone(section));
    const english=snapshot.en?.sections?.find(s=>s.topic_id===topic.id);
    if(english&&indexes.every(({item,index})=>english.items?.[index]?.headline&&english.items[index]?.summary&&JSON.stringify(english.items[index].source_ids)===JSON.stringify(item.source_ids)))result.en.sections.push(clone(english));
    result.topics.push({...topic,fingerprint:fingerprint(topic)});
    result.zh.title ||= snapshot.zh.title;result.en.title ||= snapshot.en?.title;
    const coverage=snapshot.coverage?.find(c=>c.topicId===topic.id);if(coverage)result.coverage.push({...coverage,reused:true});
  }
  result.sources=[...sources.values()];
  return result.topics.length?result:null;
}

function loadDaySnapshot(database,dataDir,date,topics){
  const rows=database.dailyReports?.(date)||database.listReports?.().filter(r=>r.report_type==='daily'&&r.period_start===date)||[database.latestDailyReport(date)].filter(Boolean);
  const snapshots=rows.filter(r=>!r.deleted_at&&(!r.period_start||r.period_start===date)).map(r=>loadSnapshot(dataDir,r));
  return composeDaySnapshot(topics,snapshots,date);
}

function mergeDayCache(previous,current,date){
  const topics=new Map();
  for(const row of [...(previous?.topics||[]),...(current?.topics||[])])topics.set(row.id,row);
  return composeDaySnapshot([...topics.values()].slice(-100),[current,previous],date);
}

function requestKey(date,topics){return crypto.createHash('sha256').update(JSON.stringify([date,topics.map(fingerprint).sort()])).digest('hex');}
module.exports={composeDaySnapshot,loadDaySnapshot,mergeDayCache,requestKey};
