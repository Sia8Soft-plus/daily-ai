const { discoverSearch } = require('./search-engine');
const { buildSearchPlan } = require('./search-plan');
const {minimumItems}=require('./topic-contract');
const {mapLimit}=require('./search-engine');
const {bounded,checkTask}=require('./task-control');

async function collectIsolated(options={}) {
  if(process.versions.electron&&process.type==='browser'&&!process.env.DSA_WORKER)return require('../client/local').call('search',options);
  const topics=options.topics||[];let finished=0;
  const results=await mapLimit(topics,2,async topic=>{
    try{return await bounded(()=>collectIntelligence({...options,topics:[topic],onProgress:(done,total,count,detail)=>options.onProgress?.(finished,topics.length,count,`${topic.name_zh} · ${detail}`)}),6*60000,{code:'TOPIC_SEARCH_TIMEOUT',message:'Topic search deadline reached'});}
    catch(error){checkTask();return {sources:[],fetched:0,searchStats:{},failures:[`${topic.id}: ${error.message}`],coverage:[{topicId:topic.id,name:topic.name_zh,queries:0,selected:0,facets:[]}],plan:[],rejections:[]};}
    finally{finished++;}
  });
  const combined={sources:[],fetched:0,searchStats:{},failures:[],coverage:[],plan:[],rejections:[]};
  for(const result of results){
    combined.fetched+=result.fetched;
    for(const key of ['failures','coverage','plan','rejections'])combined[key].push(...result[key]);
    for(const [key,value]of Object.entries(result.searchStats))combined.searchStats[key]=(combined.searchStats[key]||0)+value;
    for(const source of result.sources){const prior=combined.sources.find(s=>s.url===source.url);if(prior)prior.topicIds=[...new Set([...prior.topicIds,...source.topicIds])];else combined.sources.push({...source,id:`S${combined.sources.length+1}`});}
  }
  return combined;
}

function selectSources(items, now=Date.now(), limit=72) {
  const byUrl = new Map();
  for (const item of items) {
    const date = Date.parse(item.publishedAt);
    if (!Number.isFinite(date) || date < now-7*86400000 || date > now+3600000) continue;
    const previous = byUrl.get(item.url);
    if (previous) { previous.topicIds = [...new Set([...previous.topicIds,...(item.topicIds || [])])]; continue; }
    byUrl.set(item.url,{...item,topicIds:item.topicIds || [item.topicId]});
  }
  const pool = [...byUrl.values()].sort((a,b)=>(b.score || 0)-(a.score || 0));
  const topics = [...new Set(pool.flatMap(item=>item.topicIds))];
  const selected=[]; const used=new Set(); const hosts=new Map();
  while(selected.length<limit) {
    let changed=false;
    for(const topic of topics) {
      const item=pool.find(item=>!used.has(item.url) && item.topicIds.includes(topic) && (!selected.some(row=>row.topicIds.includes(topic)) || (hosts.get(new URL(item.url).hostname)||0)<Math.max(3,Math.ceil(limit/8)))) || pool.find(item=>!used.has(item.url)&&item.topicIds.includes(topic));
      if(!item) continue;
      used.add(item.url); selected.push(item); changed=true;
      const host=new URL(item.url).hostname; hosts.set(host,(hosts.get(host)||0)+1);
      if(selected.length>=limit) break;
    }
    if(!changed) break;
  }
  return selected.map((item,index)=>({...item,id:`S${index+1}`}));
}

async function collectIntelligence({topics=[],expansions=[],glmApiKey=null,exaApiKey=null,onProgress=()=>{},round=0}={}) {
  const plan=buildSearchPlan(topics,expansions,new Date(),round);
  const result=await discoverSearch({topics,plan,glmApiKey,exaApiKey,onProgress:event=>{
    const detail=event.phase==='verify' ? `核验原文与日期 ${event.done || 0}/${event.total || event.count}` : `动态检索 ${event.done || 0}/${event.total || plan.length} · ${event.channel || event.phase}`;
    onProgress(event.done || 0,event.total || plan.length,0,detail);
  }});
  const sources=selectSources(result.items,Date.now(),Math.max(48,topics.reduce((sum,topic)=>sum+Math.max(12,minimumItems(topic)*4),0)));
  const coverage=topics.map(topic=>({topicId:topic.id,name:topic.name_zh,queries:plan.filter(q=>q.topicId===topic.id).length,selected:sources.filter(s=>s.topicIds.includes(topic.id)).length,facets:[...new Set(sources.filter(s=>s.topicIds.includes(topic.id)).map(s=>s.facet))]}));
  return {sources,fetched:result.candidates,verifiedSocial:sources.filter(s=>s.facet==='social').length,searchStats:result.stats,failures:result.failures,coverage,plan,rejections:result.rejections};
}
module.exports={selectSources,collectIntelligence,collectIsolated};
