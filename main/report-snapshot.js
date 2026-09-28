const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {CONTRACT_VERSION,minimumItems}=require('./topic-contract');

function fingerprint(topic) {
  const clean=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ');
  return crypto.createHash('sha256').update(JSON.stringify([topic.id,clean(topic.name_zh),clean(topic.description),minimumItems(topic),topic.region_preference || 'global'])).digest('hex');
}
function matchesFingerprint(row,topic){
  if(row?.fingerprint===fingerprint(topic))return true;
  // Read old snapshots without making a no-op edit invalidate a translated title.
  const legacyDisplayNames={'agents-llm':'AI agents & LLMs','vision-industry':'AI vision & industrial adoption'};
  return [topic.name_en,topic.name_zh,legacyDisplayNames[topic.id]].filter(Boolean).some(name=>row?.fingerprint===crypto.createHash('sha256').update(JSON.stringify([CONTRACT_VERSION,topic.id,topic.name_zh,name,topic.description,minimumItems(topic),topic.region_preference||'global'])).digest('hex'));
}
function snapshotPath(dataDir,id) { return path.join(dataDir,'report-snapshots',`${id}.json`); }
function loadSnapshot(dataDir,report) {
  if(!report || report.deleted_at) return null;
  try {
    const value=JSON.parse(fs.readFileSync(snapshotPath(dataDir,report.id),'utf8'));
    if(value.version===1&&value.reportId===report.id&&Array.isArray(value.zh?.sections))return value;throw new Error('Invalid snapshot');
  } catch {
    try{if(fs.statSync(report.html_path).size>16*1024*1024)return null;const html=fs.readFileSync(report.html_path,'utf8');const json=html.match(/<script type="application\/json" id="daily-report-snapshot">([^<]+)<\/script>/)?.[1];if(json){const value=JSON.parse(json);if(value.version===1&&Array.isArray(value.zh?.sections))return value;}const recovered=loadArchiveSnapshot(dataDir,report);if(recovered){const raw=html.match(/<script type="application\/json" id="daily-topic-contract">([^<]+)<\/script>/)?.[1];return {...recovered,version:1,reportDate:report.period_start,topics:raw?JSON.parse(raw).topics:recovered.zh.sections.map(s=>({id:s.topic_id})),legacy:true};}}catch{}return null;
  }
}
function saveSnapshot(dataDir,id,value) {
  const file=snapshotPath(dataDir,id);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(`${file}.tmp`,JSON.stringify({...value,version:1,reportId:id}),'utf8');
  fs.renameSync(`${file}.tmp`,file);
}
function loadArchiveSnapshot(dataDir,report){
  try{const value=JSON.parse(fs.readFileSync(snapshotPath(dataDir,report.id),'utf8'));if(value.reportId===report.id&&value.zh?.sections?.length)return value;}catch{}
  // Older app-generated HTML has no JSON snapshot. Recover only its explicit
  // article blocks and source links; never ask a model to invent missing evidence.
  try{
    if(fs.statSync(report.html_path).size>16*1024*1024)return null;
    const html=fs.readFileSync(report.html_path,'utf8').match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1]||'';
    const decode=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g,(_,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#39':"'",nbsp:' '}[n])).replace(/\s+/g,' ').trim();
    const sources=[],sections=[];
    for(const block of html.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi)){
      const title=decode(block[2].match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]);if(!title)continue;
      const topicId=block[1].match(/data-topic-id=["']([^"']+)/)?.[1]||'legacy-'+crypto.createHash('sha256').update(title).digest('hex').slice(0,16),items=[];
      for(const article of block[2].matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)){
        const body=article[1],headline=decode(body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
        const summary=decode(body.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]),ids=[];
        for(const link of body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
          const url=decode(link[1]);if(!/^https?:\/\//i.test(url))continue;
          let source=sources.find(s=>s.url===url);if(!source){source={id:'legacy-source-'+sources.length,url,title:headline,source:decode(link[2]),publishedAt:decode(link[2]).match(/\d{4}-\d{2}-\d{2}/)?.[0]||null,topicIds:[topicId]};sources.push(source);}else if(!source.topicIds.includes(topicId))source.topicIds.push(topicId);ids.push(source.id);
        }
        if(headline&&summary&&ids.length)items.push({topic_id:topicId,headline,summary,source_ids:[...new Set(ids)]});
      }
      if(items.length)sections.push({topic_id:topicId,title,items});
    }
    if(!sections.length)return null;return {zh:{title:report.title,sections},sources,legacy:true};
  }catch{return null;}
}
// A minimum-count shortfall or missing translation is not a reason to search again.
function matchesContent(row,topic){
  if(!row)return false;
  if(matchesFingerprint(row,topic))return true;
  if(row.description!==undefined)return row.name_zh===topic.name_zh&&String(row.description).normalize('NFKC').trim().replace(/\s+/g,' ')===String(topic.description||'').normalize('NFKC').trim().replace(/\s+/g,' ')&&(row.region_preference||'global')===(topic.region_preference||'global');
  return Array.from({length:30},(_,i)=>i+1).some(min=>matchesFingerprint(row,{...topic,min_items:min}));
}
function partitionTopics(topics,snapshot) {
  const prior=new Map((snapshot?.topics || []).map(topic=>[topic.id,topic]));
  const reuse=[],search=[];
  for(const topic of topics){
    const old=prior.get(topic.id),section=snapshot?.zh?.sections?.find(s=>s.topic_id===topic.id);
    if((matchesContent(old,topic)||snapshot?.legacy&&!old?.fingerprint)&&section?.items?.length&&section.items.every(i=>!i.topic_id||i.topic_id===topic.id))reuse.push(topic);
    else search.push(topic);
  }
  return {reuse,search};
}
module.exports={fingerprint,matchesFingerprint,matchesContent,snapshotPath,loadSnapshot,loadArchiveSnapshot,saveSnapshot,partitionTopics};
