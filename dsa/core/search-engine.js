const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
let electron={};try{electron=require('electron')}catch{}
const { buildSearchPlan } = require('./search-plan');
const dns = require('node:dns').promises;
const {bounded,currentTask,checkTask}=require('./task-control');
const {minimumItems}=require('./topic-contract');
const searchHealth=require('./search-health');
const {searchScholarly}=require('./scholarly-search');

const decode = text => String(text || '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff)));
const plain = text => decode(String(text || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
const tag = (block,name) => plain(block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]);

function publicUrl(value) {
  try {
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol) || url.username || url.password) return '';
    const host=url.hostname.toLowerCase();
    if(host==='arxiv.org'&&/^\/(?:pdf|html)\//.test(url.pathname))url.pathname=url.pathname.replace(/^\/(?:pdf|html)\//,'/abs/').replace(/\.pdf$/,'');
    if(host==='localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return '';
    if((host==='bing.com' || host.endsWith('.bing.com')) && url.pathname.includes('apiclick')) return publicUrl(url.searchParams.get('url'));
    if(url.pathname==='/' && !url.search) return '';
    url.hash='';
    for(const key of [...url.searchParams.keys()]) if(/^utm_|^fbclid$|^gclid$/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return ''; }
}

async function mapLimit(items,limit,fn) {
  const output=new Array(items.length); let next=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){checkTask();const index=next++;output[index]=await fn(items[index],index);checkTask();}}));
  return output;
}

async function fetchText(value,timeoutMs=12000) {
  return bounded(()=>fetchTextBody(value,timeoutMs),timeoutMs,{message:'Article or DNS request timed out'});
}
async function fetchTextBody(value,timeoutMs) {
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const signal=currentTask().signal ? AbortSignal.any([controller.signal,currentTask().signal]) : controller.signal;
  try {
    let url=publicUrl(value);
    const request=typeof electron.net?.fetch==='function' ? electron.net.fetch.bind(electron.net) : fetch;
    for(let redirects=0;redirects<5;redirects++) {
      signal.throwIfAborted();
      if(!url) throw new Error('Invalid public article URL');
      const addresses=await bounded(()=>dns.lookup(new URL(url).hostname,{all:true}),timeoutMs,{signal,message:'DNS lookup timed out'});
      if(addresses.some(({address})=>/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|f[cd]|fe80)/i.test(address))) throw new Error('Private network address rejected');
      const options={redirect:'manual',signal,headers:{'User-Agent':'Mozilla/5.0 (compatible; DailyAI/0.1.17)','Accept':'text/html, application/xml, application/rss+xml, */*'}};
      let response;
      try {response=await request(url,options);} catch(error) {if(!/redirect was cancelled/i.test(error.message))throw error;response=await fetch(url,options);}
      if(response.status>=300 && response.status<400) {url=publicUrl(new URL(response.headers.get('location'),url).href); continue;}
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const type=response.headers.get('content-type') || '';
      if(/application\/pdf|image\//i.test(type)) {await response.body?.cancel();throw new Error('Binary document: use its abstract or announcement page');}
      const reader=response.body.getReader(); const decoder=new TextDecoder(); let body=''; let bytes=0;
      while(true) {const part=await reader.read();if(part.done)break; bytes+=part.value.length;if(bytes>2_000_000){await reader.cancel();break;}body+=decoder.decode(part.value,{stream:true});}
      return {text:body+decoder.decode(),url};
    }
    throw new Error('Too many redirects');
  } finally {clearTimeout(timer);}
}

function parseSearchRss(xml,query,channel) {
  return [...String(xml).matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,10).map(match=>({title:tag(match[1],'title'),url:publicUrl(tag(match[1],'link')),excerpt:tag(match[1],'description'),publishedAt:tag(match[1],'pubDate'),query,channel})).filter(item=>item.title && item.url);
}

async function bingSearch(query,channel='news') {
  const url=channel==='news' ? `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss` : `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`;
  return parseSearchRss((await fetchText(url)).text,query,channel);
}
function sameNewsTitle(a,b){
  const core=s=>String(s||'').replace(/\s+[-|–—]\s+[^|]+$/,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const x=core(a),y=core(b);return x.length>=12&&y.length>=12&&(x===y||Math.min(x.length,y.length)/Math.max(x.length,y.length)>.9&&(x.includes(y)||y.includes(x)));
}
async function googleNewsSearch(plan) {
  const chinese=/[\u3400-\u9fff]/.test(plan.query);
  const url=`https://news.google.com/rss/search?q=${encodeURIComponent(`${plan.query} when:7d`)}&hl=${chinese?'zh-CN':'en-US'}&gl=${chinese?'CN':'US'}&ceid=${chinese?'CN:zh-Hans':'US:en'}`;
  const leads=parseSearchRss((await fetchText(url)).text,plan.query,'google-news');
  return (await mapLimit(leads.slice(0,6),2,async lead=>{
    try {return (await bingSearch(`"${lead.title.replace(/\s+-\s+[^-]+$/,'').slice(0,120)}"`,'web')).slice(0,2).map(item=>({...item,...plan,publishedAt:item.publishedAt||(sameNewsTitle(item.title,lead.title)?lead.publishedAt:undefined),channel:'google-title-resolved'}));}catch{return [];}
  })).flat();
}

function normalizedRecord(item,query,channel) {
  const url=publicUrl(item.url || item.link || item.id);
  if(!url || !item.title) return null;
  return {title:String(item.title),url,excerpt:String(item.text || item.content || item.snippet || item.excerpt || (Array.isArray(item.highlights)?item.highlights.join(' '):'')),publishedAt:item.publishedDate || item.published_date || item.publish_date || item.published_at || item.publishedAt || item.publish_time || item.date,query,channel};
}
function parseMcpResults(result,query,channel='exa-mcp') {
  if(result?.isError) throw new Error((result.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(' ').slice(0,1000)||'MCP tool returned an error');
  const blocks=(result?.content || []).filter(item=>item.type==='text').map(item=>item.text);
  const output=[];
  for(let data of [result?.structuredContent,...blocks].filter(Boolean)) {
    for(let i=0;i<3 && typeof data==='string';i++){try{data=JSON.parse(data)}catch{break;}}
    const rows=Array.isArray(data)?data:data?.results || data?.data?.results || data?.web_search || data?.search_result || data?.data;
    if(Array.isArray(rows)) output.push(...rows.map(item=>normalizedRecord(item,query,channel)).filter(Boolean));
    else if(typeof data==='string') {
      for(const block of data.split(/(?=^Title: )/gm)) {
        const title=block.match(/^Title:\s*(.+)$/m)?.[1];
        const url=block.match(/^URL:\s*(.+)$/m)?.[1];
        const publishedAt=block.match(/^Published(?: Date)?:\s*(.+)$/m)?.[1];
        const excerpt=block.split(/^(?:Text|Content|Highlights):\s*/m).slice(1).join(' ');
        const item=normalizedRecord({title,url,publishedAt,text:excerpt},query,channel);if(item)output.push(item);
      }
    }
  }
  return [...new Map(output.map(item=>[item.url,item])).values()];
}
const parseExaText=(result,query)=>parseMcpResults(result,query);
const parseMcpText=result=>parseMcpResults(result,'','glm-mcp');
function isArticleCandidate(item){
  const url=new URL(item.url);
  return !/(?:^|\.)(?:baike\.baidu\.com|zhidao\.baidu\.com|hanyuguoxue\.com)$/.test(url.hostname)&&!/^\/(?:login|signin|teacher|faculty|people\/faculty)(?:\/|$)/i.test(url.pathname);
}

async function mcpSearch(plans,{provider='exa',apiKey,onProgress=()=>{},failures=[]}={}) {
  const glm=provider==='glm';
  if(!plans.length || (glm && !apiKey))return [];
  const pause=searchHealth.paused(provider,apiKey);
  if(pause){failures.push(`${provider}: ${pause.reason}; channel paused, other search channels continue`);return [];}
  const client=new Client({name:'daily-ai',version:'0.1.11'});
  const endpoint=glm?'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp':'https://mcp.exa.ai/mcp';
  const request=typeof electron.net?.fetch==='function'?electron.net.fetch.bind(electron.net):fetch;
  const transport=new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:apiKey?{Authorization:`Bearer ${apiKey}`} : {}},fetch:(url,options={})=>{
    const parent=currentTask().signal;
    const signal=parent&&options.signal?AbortSignal.any([parent,options.signal]):parent||options.signal;
    return bounded(combined=>request(url,{...options,signal:combined}),35000,{signal,message:'MCP HTTP request timed out'});
  }});
  let done=0;
  try {
    await bounded(()=>client.connect(transport,{timeout:15000}),20000,{message:'MCP connection timed out'});
    const catalog=await bounded(()=>client.listTools({}, {timeout:10000}),12000,{message:'MCP tool discovery timed out'});
    const tool=catalog.tools.find(tool=>(glm?['web_search_prime','webSearchPrime']:['web_search_exa']).includes(tool.name));
    const name=tool?.name;
    if(!tool)throw new Error(`Tool ${name} unavailable`);
    const properties=tool.inputSchema?.properties || {};
    return (await mapLimit(plans,2,async plan=>{
      if(searchHealth.paused(provider,apiKey))return [];
      try {
        const desired=glm?{search_query:plan.query,search_recency_filter:'oneWeek',content_size:'medium',location:/[\u3400-\u9fff]/.test(plan.query)?'cn':'us'}:{query:plan.query,objective:`Find recent concrete developments for ${plan.topicName||plan.query}. Return original readable pages, exact publication dates and factual evidence. Prefer the past 24 hours, at most 7 days; exclude generic homepages and unrelated subjects. Channel: ${plan.facet||'web'}.`,numResults:8,type:'auto',contextMaxCharacters:12000};
        const args=Object.fromEntries(Object.entries(desired).filter(([key])=>key in properties));
        const result=await bounded(signal=>client.callTool({name,arguments:args},undefined,{timeout:30000,signal}),35000,{message:'MCP search timed out'});
        const items=parseMcpResults(result,plan.query,`${provider}-mcp`).map(item=>({...item,...plan,channel:`${provider}-mcp`}));
        searchHealth.recordSuccess(provider,apiKey);return items;
      } catch(error) {checkTask();const limited=searchHealth.recordFailure(provider,apiKey,error);failures.push(`${provider}/${plan.topicId}/${plan.facet}: ${limited?limited.reason:error.message.slice(0,300)}`);return [];}
      finally {onProgress({phase:'search',channel:`${provider}-mcp`,done:++done,total:plans.length});}
    })).flat();
  } catch(error) {checkTask();const limited=searchHealth.recordFailure(provider,apiKey,error);failures.push(`${provider}: ${limited?limited.reason:error.message.slice(0,300)}`);return [];}
  finally {await bounded(()=>client.close(),3000,{signal:null,message:'MCP close timed out'}).catch(()=>{});}
}
const exaMcpSearch=queries=>mcpSearch(queries.map(query=>({query})),{provider:'exa'});
const glmMcpSearch=(queries,apiKey)=>mcpSearch(queries.map(query=>({query})),{provider:'glm',apiKey});

function parseReadResult(result,items,now=Date.now()) {
  if(result?.isError)return [];
  const output=[];
  for(const block of result?.content||[]) {
    if(block.type!=='text')continue;
    // The official reader returns Markdown headed by an exact URL. Never infer a URL.
    const text=block.text||'';if((text.match(/^URL:/gm)||[]).length!==1)continue;const url=publicUrl(text.match(/^URL:\s*(\S+)/m)?.[1]);
    const item=items.find(row=>row.url===url);if(!item)continue;
    const date=text.match(/^Published(?: Date)?:\s*(.+)$/mi)?.[1]||item.publishedAt;
    const published=Date.parse(date);if(!Number.isFinite(published)||published<now-7*86400000||published>now+3600000)continue;
    const body=text.replace(/^URL:.*$/m,'').trim();
    if(body.length<200||/^(#\s*)?(access denied|just a moment|sign in)/i.test(body))continue;
    output.push({...item,title:text.match(/^#\s+(.+)$/m)?.[1]||item.title,excerpt:body.slice(0,6000),publishedAt:new Date(published).toISOString(),dateEvidence:'search-index',evidence:'mcp-page-read',source:new URL(url).hostname,kind:'search',score:1+(published>now-86400000?3:0)});
  }
  return output;
}
async function readWithMcp(items,failures,onProgress,apiKey) {
  if(!items.length||searchHealth.paused('exa',apiKey))return [];
  const client=new Client({name:'daily-ai-reader',version:'0.1.17'});
  const request=typeof electron.net?.fetch==='function'?electron.net.fetch.bind(electron.net):fetch;
  const transport=new StreamableHTTPClientTransport(new URL('https://mcp.exa.ai/mcp'),{requestInit:{headers:apiKey?{Authorization:`Bearer ${apiKey}`} : {}},fetch:(url,options={})=>bounded(signal=>request(url,{...options,signal:options.signal?AbortSignal.any([signal,options.signal]):signal}),30000)});
  const rows=[];
  try {
    await bounded(()=>client.connect(transport,{timeout:15000}),18000);
    const catalog=await bounded(()=>client.listTools({}, {timeout:10000}),12000);
    const tool=catalog.tools.find(tool=>tool.name==='web_fetch_exa');if(!tool?.inputSchema?.properties?.urls)return [];
    for(let offset=0;offset<items.length;offset+=4){checkTask();const batch=items.slice(offset,offset+4);onProgress({phase:'verify',channel:'mcp-reader',done:offset,total:items.length});
      const args={urls:batch.map(item=>item.url)};if(tool.inputSchema.properties.maxCharacters)args.maxCharacters=6000;
      const result=await bounded(signal=>client.callTool({name:tool.name,arguments:args},undefined,{timeout:25000,signal}),30000);
      rows.push(...parseReadResult(result,batch));
    }
    return rows;
  }catch(error){checkTask();searchHealth.recordFailure('exa',apiKey,error);failures.push(`mcp-reader: ${error.message.slice(0,250)}`);return rows;}
  finally{await bounded(()=>client.close(),3000,{signal:null}).catch(()=>{});}
}

function parseGlmRead(result,item,now=Date.now()){
  if(result?.isError)return null;
  let data=result.structuredContent||(result.content||[]).find(block=>block.type==='text')?.text;
  for(let i=0;i<3&&typeof data==='string';i++){try{data=JSON.parse(data);}catch{break;}}
  const row=data?.reader_result||data?.data||data;
  const body=typeof row==='string'?row:row?.content||row?.text||row?.markdown||'';
  if(typeof body!=='string'||body.length<200||/^(?:#\s*)?(access denied|just a moment|sign in)/i.test(body))return null;
  if(row?.url&&publicUrl(row.url)!==item.url)return null;
  const meta=row?.metadata||{};
  const pageDate=row?.publishedTime||row?.publishedDate||meta['article:published_time']||meta.datePublished||body.match(/(?:Published(?: Date)?|发布时间)\s*[:：]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i)?.[1]||body.match(/Submitted on\s+(\d{1,2}\s+\w+\s+\d{4})/i)?.[1];
  const published=Date.parse(pageDate||item.publishedAt);
  if(!Number.isFinite(published)||published<now-7*86400000||published>now+3600000)return null;
  return {...item,title:row?.title||item.title,excerpt:body.slice(0,6000),publishedAt:new Date(published).toISOString(),dateEvidence:pageDate?'page-publication':'search-index',evidence:'glm-mcp-page-read',source:new URL(item.url).hostname,kind:'search',score:pageDate?4:2};
}
async function readWithGlm(items,apiKey,failures,onProgress){
  if(!items.length||!apiKey||searchHealth.paused('glm-reader',apiKey))return [];
  const client=new Client({name:'daily-ai-reader',version:'0.1.19'});
  const request=typeof electron.net?.fetch==='function'?electron.net.fetch.bind(electron.net):fetch;
  const transport=new StreamableHTTPClientTransport(new URL('https://open.bigmodel.cn/api/mcp/web_reader/mcp'),{requestInit:{headers:{Authorization:`Bearer ${apiKey}`}},fetch:(url,options={})=>bounded(signal=>request(url,{...options,signal:options.signal?AbortSignal.any([signal,options.signal]):signal}),25000)});
  try{
    await bounded(()=>client.connect(transport,{timeout:15000}),18000);
    const catalog=await bounded(()=>client.listTools({}, {timeout:10000}),12000);
    const tool=catalog.tools.find(tool=>['webReader','web_reader'].includes(tool.name));if(!tool)return [];
    return (await mapLimit(items,3,async(item,index)=>{
      if(searchHealth.paused('glm-reader',apiKey))return null;
      try{onProgress({phase:'verify',channel:'glm-mcp-reader',done:index,total:items.length});
        const properties=tool.inputSchema?.properties||{};
        const args=Object.fromEntries(Object.entries({url:item.url,return_format:'markdown',retain_images:false}).filter(([key])=>key in properties));
        const result=await bounded(signal=>client.callTool({name:tool.name,arguments:args},undefined,{timeout:20000,signal}),25000);
        if(result.isError)throw new Error((result.content||[]).map(row=>row.text||'').join(' ').slice(0,300));
        return parseGlmRead(result,item);
      }catch(error){checkTask();searchHealth.recordFailure('glm-reader',apiKey,error);failures.push(`glm-reader: ${error.message.slice(0,200)}`);return null;}
    })).filter(Boolean);
  }catch(error){checkTask();searchHealth.recordFailure('glm-reader',apiKey,error);failures.push(`glm-reader: ${error.message.slice(0,200)}`);return [];}
  finally{await bounded(()=>client.close(),3000,{signal:null}).catch(()=>{});}
}

function metaValue(html,names) {
  for(const meta of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs=Object.fromEntries([...meta.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].toLowerCase(),decode(m[2])]));
    if(names.map(name=>name.toLowerCase()).includes((attrs.name || attrs.property || '').toLowerCase())) return attrs.content || '';
  }
  return '';
}
function extractArticle(html,item,now=Date.now()) {
  const title=metaValue(html,['og:title']) || plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  if(!title || /^(just a moment|access denied|not found|attention required|sign in)/i.test(title))throw new Error('Blocked or empty page');
  const date=metaValue(html,['article:published_time','citation_publication_date','citation_online_date','citation_date','dc.date','dc.date.issued','datePublished','pubdate','date']) || html.match(/["']datePublished["']\s*:\s*["']([^"']+)/i)?.[1] || html.match(/<(?:time|relative-time)[^>]+datetime=["']([^"']+)/i)?.[1] || plain(html.match(/Submitted on\s+([^<\]\(]+\d{4})/i)?.[1]);
  const wechatTime=html.match(/(?:var\s+)?(?:ct|create_time)\s*[:=]\s*["']?(\d{10})["']?/)?.[1];
  const rawDate=date || (/mp\.weixin\.qq\.com/.test(item.url)&&wechatTime ? Number(wechatTime)*1000 : item.publishedAt);
  let normalizedDate=typeof rawDate==='string'?rawDate.replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/,'$1-$2-$3').trim():rawDate;
  if(typeof normalizedDate==='string'&&/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(normalizedDate))normalizedDate=normalizedDate.split(/[-/]/).map((part,index)=>index?part.padStart(2,'0'):part).join('-');
  if(typeof normalizedDate==='string'&&/^\d{1,2}\s+[a-z]+\s+\d{4}$/i.test(normalizedDate))normalizedDate+=' UTC';
  const published=new Date(normalizedDate);
  if(!Number.isFinite(published.getTime()))throw new Error('Publication date unavailable');
  if(published.getTime()>now+3600000 || published.getTime()<now-7*86400000)throw new Error('Outside seven-day window');
  const cleaned=html.replace(/<(script|style|nav|footer|header|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
  const article=cleaned.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1] || cleaned;
  const paragraphs=[...article.matchAll(/<(?:p|h[1-3]|li)\b[^>]*>([\s\S]*?)<\/(?:p|h[1-3]|li)>/gi)].map(m=>plain(m[1])).filter(text=>text.length>35);
  const paragraphText=[...new Set(paragraphs)].join('\n');
  const abstract=plain(article.match(/<blockquote[^>]*class=["'][^"']*abstract[^"']*["'][^>]*>([\s\S]*?)<\/blockquote>/i)?.[1]);
  const excerpt=(abstract+'\n'+(paragraphText.length>=100?paragraphText:plain(article))).trim().slice(0,6000) || metaValue(html,['description','og:description']);
  if(excerpt.length<100)throw new Error('Insufficient original text');
  const citedLinks=[...new Set([...article.matchAll(/<a\b[^>]+href=["']([^"']+)["']/gi)].map(m=>{try{return publicUrl(new URL(decode(m[1]),item.url).href);}catch{return '';}}).filter(url=>url && new URL(url).hostname!==new URL(item.url).hostname))].slice(0,3);
  return {...item,title:title.slice(0,240),publishedAt:published.toISOString(),dateEvidence:date?'page-publication':'search-index',excerpt,citedLinks,source:new URL(item.url).hostname,kind:'search',evidence:'page-read',score:(date?3:1)+(published.getTime()>now-86400000?3:0)+Math.min(excerpt.length/2000,2)};
}
async function verifySearchResult(item,options={}) {
  try {
    if(new URL(item.url).hostname==='news.google.com')throw new Error('Unresolved news redirect');
    const cache=currentTask().searchCache?.pages;
    let pending=cache?.get(item.url);
    if(!pending){pending=(options.fetcher || fetchText)(item.url).then(page=>({...page,text:page.text.slice(0,150000)}));if(cache&&cache.size<160)cache.set(item.url,pending);}
    const page=await pending;
    return extractArticle(page.text,{...item,url:page.url},options.now || Date.now());
  } catch(error) {checkTask();options.onReject?.({url:item.url,topicId:item.topicId,reason:error.message});return null;}
}

async function discoverSearch({topics=[],plan=buildSearchPlan(topics),glmApiKey=null,exaApiKey=null,onProgress=()=>{}}={}) {
  const failures=[];const rejections=[];let done=0;
  // All generation providers use the same search plan. GLM is an optional extra.
  const tasks=await Promise.allSettled([
    mcpSearch(plan,{provider:'exa',apiKey:exaApiKey,onProgress,failures}),
    mcpSearch(plan,{provider:'glm',apiKey:glmApiKey,onProgress,failures}),
    mapLimit(plan,4,async p=>{try{return (await bingSearch(p.query,['overview','news'].includes(p.facet)?'news':'web')).map(item=>({...item,...p}));}catch(error){checkTask();failures.push(`public/${p.topicId}/${p.facet}: ${error.message}`);return [];}finally{onProgress({phase:'search',channel:'public-web',done:++done,total:plan.length});}}),
    mapLimit(plan.filter(p=>['overview','news'].includes(p.facet)),2,async p=>{try{return await googleNewsSearch(p);}catch(error){checkTask();failures.push(`google/${p.topicId}: ${error.message}`);return [];}}),
    plan.some(row=>row.researchFocused)?searchScholarly(plan,fetchText,failures):Promise.resolve([])
  ]);
  checkTask();
  const exa=tasks[0].status==='fulfilled'?tasks[0].value:[];
  const glm=tasks[1].status==='fulfilled'?tasks[1].value:[];
  const pub=[...(tasks[2].status==='fulfilled'?tasks[2].value.flat():[]),...(tasks[3].status==='fulfilled'?tasks[3].value.flat():[])];
  const scholarly=tasks[4].status==='fulfilled'?tasks[4].value:[];
  const byUrl=new Map();
  // Interleave facets and topics before any cap. Preserve all discovery paths.
  for(const p of plan) for(const item of [...exa,...glm,...pub].filter(x=>x.topicId===p.topicId && x.facet===p.facet)) {
    const prev=byUrl.get(item.url);
    if(prev) {prev.topicIds=[...new Set([...prev.topicIds,item.topicId])];prev.discoveryQueries=[...new Set([...prev.discoveryQueries,item.query])];continue;}
    byUrl.set(item.url,{...item,topicIds:[item.topicId],discoveryQueries:[item.query]});
  }
  const all=[...byUrl.values()].filter(item=>{if(isArticleCandidate(item))return true;rejections.push({url:item.url,topicId:item.topicId,reason:'Non-article profile, dictionary or login page'});return false;});const candidates=[];const selected=new Set();
  for(let rank=0;rank<6;rank++)for(const p of plan){const item=all.filter(x=>x.topicIds.includes(p.topicId)&&x.discoveryQueries.includes(p.query))[rank];if(item&&!selected.has(item.url)&&candidates.filter(row=>row.topicIds.includes(p.topicId)).length<Math.max(48,minimumItems(topics.find(t=>t.id===p.topicId)||{})*8)){candidates.push(item);selected.add(item.url);}}
  onProgress({phase:'verify',count:candidates.length});
  let checked=0;
  const verified=(await mapLimit(candidates,6,async item=>{
    const result=await verifySearchResult(item,{onReject:reason=>rejections.push(reason)});
    onProgress({phase:'verify',done:++checked,total:candidates.length,count:candidates.length});
    return result;
  })).filter(Boolean);
  for(const item of scholarly)if(!verified.some(row=>row.url===item.url))verified.push(item);
  const readable=new Set(verified.map(item=>item.url));
  const blocked=candidates.filter(item=>!readable.has(item.url)&&!rejections.some(row=>row.url===item.url&&/Outside seven-day/.test(row.reason))).slice(0,12);
  const cache=currentTask().searchCache;
  if(cache&&!cache.readerResults)cache.readerResults=new Map();
  const fresh=blocked.filter(item=>!cache?.readerResults.has(item.url));
  const pending=Promise.all([readWithMcp(fresh,failures,onProgress,exaApiKey),readWithGlm(fresh,glmApiKey,failures,onProgress)]).then(rows=>rows.flat());
  for(const item of fresh)cache?.readerResults.set(item.url,pending.then(rows=>rows.find(row=>row.url===item.url)||null));
  const reread=[cache?(await Promise.all(blocked.map(async item=>{const row=await cache.readerResults.get(item.url);return row?{...row,topicId:item.topicId,topicIds:item.topicIds}:null;}))).filter(Boolean):await pending];
  for(const item of reread.flat())if(!verified.some(row=>row.url===item.url))verified.push(item);
  const follow=verified.filter(item=>item.facet==='social').flatMap(item=>(item.citedLinks || []).slice(0,2).map(url=>({...item,url,publishedAt:null,discoveredVia:item.url,excerpt:''}))).filter(item=>!selected.has(item.url));
  verified.push(...(await mapLimit(follow,4,item=>verifySearchResult(item,{onReject:reason=>rejections.push(reason)}))).filter(Boolean));
  // The editor requests targeted supplemental rounds after checking evidence.
  // Do not repeat a second full gap-filling loop inside every search round.
  return {items:verified,failures,rejections,queries:plan.length,candidates:all.length+follow.length+scholarly.length,stats:{exaCandidates:exa.length,glmCandidates:glm.length,publicCandidates:pub.length,scholarlyAbstracts:scholarly.length,verifiedSearch:verified.filter(row=>!['author-abstract','publisher-abstract'].includes(row.evidence)).length,gapQueries:0,followedLinks:follow.length}};
}
module.exports={sameNewsTitle,publicUrl,parseSearchRss,parseMcpText,parseExaText,parseMcpResults,parseReadResult,parseGlmRead,extractArticle,verifySearchResult,discoverSearch,glmMcpSearch,exaMcpSearch,bingSearch,mapLimit,isArticleCandidate};
