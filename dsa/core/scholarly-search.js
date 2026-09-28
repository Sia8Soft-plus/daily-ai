// Search indexes, not a publisher allowlist. Queries come from the topic plan.
const {checkTask}=require('./task-control');
const text=value=>String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
const tag=(xml,name)=>text(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]);
function recent(date,now){const value=Date.parse(date);return Number.isFinite(value)&&value>=now-7*86400000&&value<=now+3600000;}
function parseArxiv(xml,plan,now=Date.now()){
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)].flatMap(match=>{
    const row=match[1],url=tag(row,'id').replace(/^http:/,'https:'),title=tag(row,'title'),excerpt=tag(row,'summary'),publishedAt=tag(row,'published');
    if(!/^https:\/\/arxiv\.org\/abs\/[\w.\/-]+$/.test(url)||!title||excerpt.length<150||!recent(publishedAt,now))return [];
    return [{...plan,url,title,excerpt,publishedAt,topicIds:[plan.topicId],source:'arxiv.org',kind:'search',facet:'research',channel:'arxiv-api',evidence:'author-abstract',dateEvidence:'repository-submission',score:7}];
  });
}
function parseCrossref(data,plan,now=Date.now()){
  return (data?.message?.items||[]).flatMap(row=>{
    const parts=(row['published-online']||row.published||row.issued)?.['date-parts']?.[0];
    if(!parts||parts.length<3)return [];
    const publishedAt=new Date(Date.UTC(parts[0],parts[1]-1,parts[2])).toISOString();
    const title=text(row.title?.[0]),excerpt=text(row.abstract),doi=row.DOI;
    if(!/^10\.\d{4,9}\/\S+$/i.test(doi||'')||!title||excerpt.length<150||!recent(publishedAt,now))return [];
    return [{...plan,url:`https://doi.org/${doi}`,title,excerpt,publishedAt,topicIds:[plan.topicId],source:'Crossref / '+text(row['container-title']?.[0]||'publisher'),kind:'search',facet:'research',channel:'crossref-api',evidence:'publisher-abstract',dateEvidence:'publisher-publication',score:6}];
  });
}
function academicQueries(plan){
  const values=plan.filter(row=>row.facet==='research'&&!row.query.includes('site:')).map(row=>({...row,term:row.query.replace(/after:\S+|\b(?:study|findings|publication|results)\b/g,'').trim()}));
  return [...new Map(values.map(row=>[row.term,row])).values()].filter(row=>row.term&&!/[\u3400-\u9fff]/.test(row.term)).slice(0,4);
}
function rankAbstracts(rows,queries){
  const stop=new Set(['learning','model','models','study','paper','research','deep','based','supervised','unsupervised','self','semi','weakly','latest','new']);
  const tokens=value=>String(value).toLowerCase().match(/[a-z]{3,}/g)||[];
  const groups=queries.map(row=>[...new Set(tokens(row.term))]);
  const counts=new Map();for(const words of groups)for(const word of words)if(!stop.has(word))counts.set(word,(counts.get(word)||0)+1);
  const anchors=[...counts].filter(([,count])=>count>1).map(([word])=>word);
  return rows.map(row=>{
    const body=`${row.title} ${row.excerpt}`.toLowerCase();
    const overlap=Math.max(0,...groups.map(words=>words.filter(word=>body.includes(word)).length/Math.max(1,words.length)));
    const domain=anchors.length?anchors.some(word=>body.includes(word)):true;
    return {...row,score:3+overlap*5+(domain?3:0)};
  }).sort((a,b)=>b.score-a.score);
}
async function searchScholarly(plan,fetcher,failures){
  const queries=academicQueries(plan);if(!queries.length)return [];
  const first=queries[0],since=first.since.replaceAll('-','')+'0000';
  const expression=queries.map(row=>'('+row.term.replace(/[^\w\s-]/g,' ').split(/\s+/).filter(Boolean).slice(0,8).map(word=>`all:${word}`).join(' AND ')+')').join(' OR ');
  const arxivUrl=new URL('https://export.arxiv.org/api/query');arxivUrl.search=new URLSearchParams({search_query:`(${expression}) AND submittedDate:[${since} TO 300001010000]`,start:'0',max_results:'48',sortBy:'submittedDate',sortOrder:'descending'}).toString();
  const rows=[];
  const arxiv=(async()=>{try{rows.push(...parseArxiv((await fetcher(arxivUrl.href,18000)).text,first));}catch(error){checkTask();failures.push(`arxiv-search: ${error.message}`);}})();
  // Crossref is sequential to keep a conservative per-task service load.
  const crossref=(async()=>{for(const query of queries){
    checkTask();const url=new URL('https://api.crossref.org/works');
    url.search=new URLSearchParams({'query.bibliographic':query.term,filter:`from-pub-date:${query.since},has-abstract:true`,rows:'15',sort:'relevance'}).toString();
    try{rows.push(...parseCrossref(JSON.parse((await fetcher(url.href,12000)).text),query));}catch(error){checkTask();failures.push(`crossref-search: ${error.message}`);break;}
  }})();
  await Promise.allSettled([arxiv,crossref]);checkTask();return rankAbstracts([...new Map(rows.map(row=>[row.url,row])).values()],queries);
}
module.exports={parseArxiv,parseCrossref,academicQueries,searchScholarly,rankAbstracts};
