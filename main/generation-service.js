const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { collectIsolated:collectIntelligence } = require('./intelligence-sources');
const { planTopics, summarizeTopics,refineTopicSearch } = require('./editor');
const { translateReport, embedBilingualHtml } = require('./report-language');
const { fingerprint, matchesFingerprint, loadSnapshot, saveSnapshot, partitionTopics } = require('./report-snapshot');
const {loadDaySnapshot}=require('./daily-reuse');
const {scope,currentTask,checkTask,bounded,taskError}=require('./task-control');
const {checkpointKey,readCheckpoint,writeCheckpoint}=require('./generation-checkpoint');
const {CONTRACT_VERSION,minimumItems,validateReportTopics}=require('./topic-contract');

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function reportIncludesEnabledTopics(report, topics) {
  try {
    const html=require('node:fs').readFileSync(report.html_path,'utf8');
    const data=html.match(/<script type="application\/json" id="daily-topic-contract">([^<]+)<\/script>/)?.[1];
    if(!data)return false;
    const contract=JSON.parse(data);
    return contract.version===CONTRACT_VERSION && contract.topics.length===topics.length && topics.every(topic=>contract.topics.some(row=>row.id===topic.id&&matchesFingerprint(row,topic)&&row.count>0));
  } catch { return false; }
}

function mergeReportSections(topics,snapshot,zhNew,enNew,newSources) {
  const previousSources=snapshot?.sources || [];
  const remap=new Map(newSources.map(source=>[source.id,`new-${crypto.randomUUID().slice(0,8)}-${source.id}`]));
  const remapReport=report=>({ ...report,sections:(report?.sections || []).map(section=>({...section,items:section.items.map(item=>({...item,source_ids:item.source_ids.map(id=>remap.get(id) || id),evidence_quotes:(item.evidence_quotes || []).map(quote=>({...quote,source_id:remap.get(quote.source_id) || quote.source_id}))}))})) });
  const zhMapped=remapReport(zhNew),enMapped=remapReport(enNew);
  const build=(prior,current)=>({title:current?.title || prior?.title || '',sections:topics.map(topic=>current?.sections.find(section=>section.topic_id===topic.id) || prior?.sections.find(section=>section.topic_id===topic.id)).filter(Boolean)});
  const zh=build(snapshot?.zh,zhMapped),en=build(snapshot?.en,enMapped);
  const sources=[...previousSources,...newSources.map(source=>({...source,id:remap.get(source.id)}))];
  const cited=new Set(zh.sections.flatMap(section=>section.items.flatMap(item=>item.source_ids)));
  return {zh,en,sources:sources.filter(source=>cited.has(source.id))};
}


function parseModelJson(text) {
  const clean = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回可解析的结构化日报');
  return JSON.parse(clean.slice(start, end + 1));
}

function renderReport({ report, sources, model, generatedAt, collection, language = 'zh-CN' }) {
  const english = language === 'en-US';
  const labels = english ? { key:'Key takeaways', sources:'Original sources', why:'Why it matters:', unknown:'Date unknown', clue:'Discovery post', verified:'Source pending verification', footer:'Generated locally by Daily AI · Check the original sources' } : { key:'本期要点', sources:'原始来源', why:'为什么重要：', unknown:'日期未知', clue:'发现线索', verified:'来源待核验', footer:'由 Daily AI 在本机生成 · 请以原始来源为准' };
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  const sections = Array.isArray(report.sections) ? report.sections : [];
  const firstPerSection = sections.map(section => Array.isArray(section.items)&&section.items[0] ? {...section.items[0],topicTitle:section.title} : null).filter(Boolean);
  const remaining = sections.flatMap(section => Array.isArray(section.items) ? section.items.slice(1).map(item=>({...item,topicTitle:section.title})) : []);
  const highlights = [...firstPerSection, ...remaining].slice(0, Math.max(3,sections.length)).map(item => {
    const detail = String(item.summary || item.why_it_matters || '').trim();
    const firstSentence = detail.split(/(?<=[。！？.!?])\s*/u)[0].slice(0, 150);
    return `<li class="key-point"><small>${escapeHtml(item.topicTitle)}</small><strong>${escapeHtml(item.headline)}</strong>${firstSentence ? `<span>${escapeHtml(firstSentence)}${detail.length > firstSentence.length && !/[。！？.!?]$/.test(firstSentence) ? '…' : ''}</span>` : ''}</li>`;
  }).join('');
  const sectionHtml = sections.map(section => {
    const items = Array.isArray(section.items) ? section.items : [];
    return `<section data-topic-id="${escapeHtml(section.topic_id)}"><h2>${escapeHtml(section.title)}</h2>${section.shortfall ? `<p class="lead">${section.shortfall.reason==='delivered_news_duplicates'?(english?'Repeated items delivered in the last seven days were removed. ':'已排除近七天推送过的重复资讯。'):''}${english ? `Coverage incomplete: ${items.length}/${section.shortfall.minimum} verified items. After ${section.shortfall.rounds} search/editorial rounds, public readable sources within the last 7 days or relevance checks did not provide enough evidence. Other topics are available below; the system will use the recorded gaps on retry.` : `本主题覆盖不足：已核验 ${items.length}/${section.shortfall.minimum} 条。经过 ${section.shortfall.rounds} 轮检索与提炼，近 7 天内可公开读取、日期明确且符合主题的证据仍不足。可能涉及搜索服务、访问限制或归属复核；其他主题正常交付，系统将记录缺口，供再次检索补足。`}</p>` : ''}${items.map((item, index) => {
      const ids = Array.isArray(item.source_ids) ? item.source_ids : [];
      const links = ids.map(id => sourceMap.get(id)).filter(Boolean).map(source => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.source)} · ${escapeHtml(source.publishedAt ? source.publishedAt.slice(0,10) : labels.unknown)}</a>${["author-abstract","publisher-abstract"].includes(source.evidence) ? (english ? " · Author/publisher abstract" : " · 作者／出版方摘要") : ""}${source.socialUrl ? `<a href="${escapeHtml(source.socialUrl)}" target="_blank" rel="noreferrer">${labels.clue}</a>` : ''}`).join('');
      return `<article class="item"><span class="index">${String(index + 1).padStart(2,'0')}</span><div><h3>${escapeHtml(item.headline)}</h3><p>${escapeHtml(item.summary)}</p>${item.caveat ? `<p class="why"><strong>${english ? 'Evidence limits: ' : '证据限制：'}</strong>${escapeHtml(item.caveat)}</p>` : ''}${item.why_it_matters ? `<p class="why"><strong>${labels.why}</strong>${escapeHtml(item.why_it_matters)}</p>` : ''}<div class="links">${links || `<span>${labels.verified}</span>`}</div></div></article>`;
    }).join('')}</section>`;
  }).join('');
  const allSources = sources.map(source => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a><span>${escapeHtml(source.source)} · ${escapeHtml(source.publishedAt ? source.publishedAt.slice(0,10) : labels.unknown)}${["author-abstract","publisher-abstract"].includes(source.evidence) ? (english ? " · Author/publisher abstract" : " · 作者／出版方摘要") : ""}${source.socialUrl ? ` · <a href="${escapeHtml(source.socialUrl)}" target="_blank" rel="noreferrer">${english ? 'Social discovery post' : '社交发现帖'}</a>` : ''}</span></li>`).join('');
  const html = `<!doctype html><html lang="${english ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(report.title)}</title><style>
  :root{color-scheme:light dark;--bg:#f4f0e8;--paper:#fffdf8;--ink:#292621;--muted:#716d65;--line:#ded8cd;--accent:#2f6f61}*{box-sizing:border-box}body{margin:0;padding:40px 20px;background:var(--bg);color:var(--ink);font:16px/1.7 Inter,"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:920px;margin:auto;padding:54px;border:1px solid var(--line);border-radius:24px;background:var(--paper);box-shadow:0 22px 60px rgba(55,48,38,.12)}header small{color:var(--accent);font-weight:700;letter-spacing:.13em}h1,h2{font-family:Georgia,"Noto Serif SC",serif;font-weight:500}h1{margin:.3em 0;font-size:2.6rem;line-height:1.2}h2{margin-top:2em;padding-bottom:.35em;border-bottom:1px solid var(--line)}.meta,.links,footer{color:var(--muted);font-size:.8rem}.lead{padding:18px;border-radius:14px;background:#e8eee9}.item{display:grid;grid-template-columns:38px 1fr;gap:10px;padding:20px 0;border-bottom:1px solid var(--line)}.index{color:var(--accent);font-weight:700}.item h3{margin:0;font-size:1.08rem}.item p{margin:.5em 0}.why{color:var(--muted)}.links{display:flex;flex-wrap:wrap;gap:10px}.links a,.sources a{color:var(--accent)}.sources li{margin:.7em 0}.sources span{display:block;color:var(--muted);font-size:.78rem}footer{margin-top:35px;text-align:center}@media(max-width:700px){main{padding:28px}h1{font-size:2rem}}@media(prefers-color-scheme:dark){:root{--bg:#191a18;--paper:#272824;--ink:#f2eee6;--muted:#aaa59c;--line:#41413c;--accent:#82b8a8}.lead{background:#2a3b35}}
  .highlights{margin:27px 0 0;padding:20px 25px;border-radius:15px;background:#e8eee9}.highlights h2{margin:0 0 8px;padding:0;border:0;font-size:1.28rem}.highlights ul{margin:0;padding-left:22px}.key-point{padding:10px 0;line-height:1.55}.key-point+li{border-top:1px solid var(--line)}.key-point strong{display:block;font-weight:700;color:var(--ink)}.key-point span{display:block;margin-top:3px;color:var(--muted)}@media(prefers-color-scheme:dark){.highlights{background:#2a3b35}}
  </style></head><body><main><header><small>DAILY AI · ${escapeHtml(model.toUpperCase())}</small><h1>${escapeHtml(report.title)}</h1><p class="meta">${escapeHtml(generatedAt)} · 最近 24 小时优先，必要时补充近 7 天资料 · ${sources.length} 个引用来源</p><p class="meta">Exa MCP ${collection?.searchStats?.exaCandidates || 0} 条线索 · GLM MCP ${collection?.searchStats?.glmCandidates || 0} 条线索 · 公共网页搜索 ${collection?.searchStats?.publicCandidates || 0} 条线索 · ${english ? "Scholarly abstracts" : "学术摘要"} ${collection?.searchStats?.scholarlyAbstracts || 0} · ${collection?.searchStats?.verifiedSearch || 0} 篇原文完成读取与日期检查</p><p class="meta">动态检索与追溯共获得 ${collection?.fetched ?? sources.length} 条候选 · ${collection?.failures?.length || 0} 组采集任务未响应</p>${collection?.reusedTopics?.length ? `<p class="meta">${english ? 'Reused unchanged topics from today: ' : '复用今日未变化主题：'}${escapeHtml(collection.reusedTopics.join('、'))}</p>` : ''}</header><section class="highlights"><h2>本期要点</h2><ul>${highlights}</ul></section>${sectionHtml}<details class="coverage"><summary>${english ? 'Search coverage and limitations' : '检索覆盖与限制'}</summary>${(collection?.coverage || []).map(row=>`<p>${escapeHtml(row.name)} · ${row.selected} ${english ? 'dated evidence sources' : '份可读且有日期的资料'} · ${row.published || 0} ${english ? 'published items' : '条入选动态'}${row.reused ? english ? ' · reused' : ' · 已复用' : ''}</p>`).join('')}<p>${english ? `Seven-day delivered-news filter: ${collection?.dedup?.filteredCandidates || 0} candidate sources and ${collection?.dedup?.filteredItems || 0} final items removed.` : `近七天已推送资讯去重：过滤 ${collection?.dedup?.filteredCandidates || 0} 份候选资料、${collection?.dedup?.filteredItems || 0} 条最终资讯。`}</p><p>${english ? 'Public indexed pages only. Social access may be limited. Reading a page is not independent fact verification.' : '仅覆盖公开可索引页面；社交平台访问可能受限。读到原文不等于事实已获独立证实。'}</p>${(collection?.failures || []).length ? `<p>${english ? 'Some searches or editorial steps failed; coverage is incomplete.' : '部分检索或主题提炼失败，本期覆盖不完整。'}</p>` : ''}</details><section class="sources"><h2>原始来源</h2><ol>${allSources}</ol></section><footer>由 Daily AI 在本机生成 · 请以原始来源为准</footer></main></body></html>`;
  if (!english) return html;
  return html
    .replace('最近 24 小时优先，必要时补充近 7 天资料', 'Prioritizing the last 24 hours, with context from the past 7 days')
    .replace('个引用来源', 'cited sources')
    .replaceAll('条线索', 'candidates')
    .replace('公共网页搜索', 'Public web search')
    .replace('篇原文完成读取与日期检查', 'original pages read and date-checked')
    .replace('动态检索与追溯共获得', 'Total candidates from search and link tracing: ')
    .replace('条候选', '')
    .replace('组采集任务未响应', 'collection tasks unavailable')
    .replace('<h2>本期要点</h2>', `<h2>${labels.key}</h2>`)
    .replace('<h2>原始来源</h2>', `<h2>${labels.sources}</h2>`)
    .replace('由 Daily AI 在本机生成 · 请以原始来源为准', labels.footer);

}

class GenerationService {
  constructor({ database, vault, dataDir, onProgress, onComplete, services = {} }) {
    this.database = database;
    this.vault = vault;
    this.dataDir = dataDir;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.services={planTopics,collectIntelligence,summarizeTopics,translateReport,...services};
    this.sequence=0;
    this.running = false;
    this.state = { status:'idle', percent:0, stage:'', detail:'' };
  }

  emit(percent, stage, detail, extra = {}) {
    checkTask();
    if(stage!==this.state.stage){if(this.stageTimings&&this.state.stage)this.stageTimings[this.state.stage]=(this.stageTimings[this.state.stage]||0)+Date.now()-this.stageStartedAt;this.stageStartedAt=Date.now();}
    if (this.running) percent = Math.max(this.state.percent || 0, percent);
    this.state = { status:this.running ? 'running' : this.state.status, percent, stage, detail, elapsedSeconds:Math.floor((Date.now()-(this.startedAt || Date.now()))/1000), stageElapsedSeconds:Math.floor((Date.now()-this.stageStartedAt)/1000), updatedAt:new Date().toISOString(), taskId:this.taskId, sequence:++this.sequence, ...extra };
    try { this.onProgress(this.state); } catch (error) { console.warn(`[progress] ${error.message}`); }
  }

  getState() { return this.state; }
  cancel() {
    if(this.running){
      this.controller?.abort(taskError('CANCELLED','任务已取消，可重新生成'));
      if(this.deliveryTimer){clearTimeout(this.deliveryTimer);this.deliveryTimer=null;}
      this.state={...this.state,status:'cancelled',stage:'已取消',detail:'任务已取消，可重新生成',sequence:++this.sequence,updatedAt:new Date().toISOString()};
      try{this.onProgress(this.state);}catch{}
    }
    return this.state;
  }
  async stage(operation,ms) {
    return bounded(operation,ms,{code:'STAGE_TIMEOUT',message:`${this.state.stage}超过 ${Math.ceil(ms/60000)} 分钟，已停止本次任务。请检查网络或稍后重试。`});
  }

  start(options = {}) {
    if (this.running) return { status:'running', progress:this.state };
    const date = options.reportDate || localDate();
    const topics = this.database.listTopics().filter(topic => topic.enabled);
    const existing = options.digest ? null : this.database.latestDailyReport(date);
    if (existing && reportIncludesEnabledTopics(existing,topics)) return { status:'already_generated', report:existing };
    if (this.running) return { status:'running', progress:this.state };
    const dsaMode=(this.database.getSetting?.('dsa_mode','local')||'local');
    const model = dsaMode==='remote'?{id:'remote-managed',credential_ref:'remote:session',provider:'managed',model:'platform-managed',base_url:'https://managed.invalid'}:this.database.getDefaultModelRecord();
    if (!model?.credential_ref) return { status:'model_required' };
    if(options.digest)require('./digest-service').selectedReports(this.database,options.digest);
    this.taskId=crypto.randomUUID();this.sequence=0;
    this.state.percent = 0;
    this.running = true;
    this.controller=new AbortController();
    this.startedAt=Date.now();
    this.stageStartedAt=this.startedAt;this.stageTimings={};this.state.stage='';
    this.emit(2, '准备任务', '正在检查模型、日期和本地目录');
    const topicRevision = this.database.getTopicRevision();
    const heartbeat=setInterval(()=>{
      if(!this.running)return;
      this.state={...this.state,elapsedSeconds:Math.floor((Date.now()-this.startedAt)/1000),stageElapsedSeconds:Math.floor((Date.now()-this.stageStartedAt)/1000),updatedAt:new Date().toISOString()};
      try{this.onProgress(this.state);}catch{}
    },5000);
    const onStatus=activity=>{checkTask();this.state={...this.state,activity};try{this.onProgress(this.state);}catch{}};
    const budget=Math.min(60*60000,Math.max(20*60000,topics.length*18*60000));
    setImmediate(() => scope.run({dsaMode,signal:this.controller.signal,onStatus,searchCache:{pages:new Map()},onUsage:event=>this.database.recordModelUsage?.(event)},()=>bounded(async()=>{await require('../dsa/client/connection').ensureAccess();this.database.setSetting?.('generation_in_progress',{startedAt:new Date().toISOString(),date});return options.digest?require('./digest-service').runDigest(this,options.digest,model):this.run(date, model, topicRevision, options);},budget,{code:'TASK_TIMEOUT',message:`任务超过 ${budget/60000} 分钟，已中断并保留可恢复进度，请稍后重试。`})).catch(error => {
      this.running = false;
      this.state = { status:error.code==='CANCELLED'?'cancelled':'failed', percent:this.state.percent, stage:error.code==='CANCELLED'?'已取消':'生成失败',taskId:this.taskId,sequence:++this.sequence, failedStage:this.state.stage, errorCode:error.code || 'GENERATION_ERROR', detail:error.message, updatedAt:new Date().toISOString() };
      try{fs.writeFileSync(path.join(this.dataDir,'latest-task-status.json'),JSON.stringify(this.state,null,2));}catch{}
      try { this.onProgress(this.state); } catch (progressError) { console.warn(`[progress] ${progressError.message}`); }
    }).finally(()=>{clearInterval(heartbeat);try{this.database.setSetting?.('generation_in_progress',null);}catch{}}));
    return { status:'started', progress:this.state };
  }

  async run(date, model, topicRevision, options = {}) {
    const apiKey = model.provider==='managed'?'remote-managed':this.vault.get(model.credential_ref);
    if (!apiKey) throw new Error('找不到已保存的模型密钥，请重新验证 API Key');
    const topics = this.database.listTopics().filter(topic => topic.enabled);
    if (!topics.length) throw new Error('请至少启用一个关注主题');
    const connection = {apiKey,provider:model.provider,model:model.model,baseUrl:model.base_url};
    const glmProfile=this.database.listModels?.().find(row=>row.provider==='glm'&&row.status==='verified');
    const searchGlmKey=model.provider==='glm'?apiKey:glmProfile?this.vault.get(this.database.getModelRecord(glmProfile.id)?.credential_ref):null;
    const searchExaKey=this.vault.get('search:exa');
    const preferences = this.database.getSetting('preferences', {});
    const outputLanguage = preferences.reportLanguage && preferences.reportLanguage !== 'interface' ? preferences.reportLanguage : preferences.language;
    const snapshot=loadDaySnapshot(this.database,this.dataDir,date,topics);
    const {reuse,search}=partitionTopics(topics,snapshot);
    const {PushedNews,keysFor}=require('./pushed-news');
    const ledger=this.database.db?new PushedNews(this.database):null;ledger?.backfill(this.dataDir);
    const pushedKeys=ledger?.load()||new Set();
    const freshSource=source=>!keysFor(source,[source]).some(key=>pushedKeys.has(key));
    const key=checkpointKey({date,topics:search,model,language:outputLanguage});
    const checkpoint=readCheckpoint(this.dataDir,key);
    const saved=checkpoint || {key,createdAt:Date.now()};
    this.emit(5, search.length?'准备检索词':'复用今日日报', reuse.length ? `复用 ${reuse.length} 个未变化主题，仅检索 ${search.length} 个待检索主题（新增、范围修改或无可用内容）` : `正在为 ${search.length} 个主题分别规划检索`);
    const planning=search.length&&!checkpoint?.collection ? await this.stage(()=>this.services.planTopics(search,connection,{load:topic=>{const row=this.database.getSetting('topic_routes',{})?.[topic.id];return row?.planVersion===4&&row?.expansion?.local_query&&row?.expansion?.english_query&&row?.fingerprint===fingerprint(topic)&&Date.now()-Date.parse(row.updatedAt)<7*86400000?row.expansion:null;},save:(topic,expansion,route)=>{const routes=this.database.getSetting('topic_routes',{});routes[topic.id]={planVersion:4,fingerprint:fingerprint(topic),expansion,route,updatedAt:new Date().toISOString()};this.database.setSetting?.('topic_routes',routes);}}),Math.max(90000,Math.ceil(search.length/8)*60000)) : {expansions:[],warnings:[]};
    if(!search.length)this.emit(45,'重组报告','主题已删除，正在复用保留主题并重组双语报告');
    if(search.length)this.emit(10,'检索资料',`正在检索 ${search.length} 个待检索主题`);
    const collection=checkpoint?.collection || (search.length ? await this.stage(()=>this.services.collectIntelligence({topics:search,expansions:planning.expansions,glmApiKey:searchGlmKey,exaApiKey:searchExaKey,onProgress:(done,total,count,detail)=>this.emit(10+Math.min(34,Math.round(done/Math.max(1,total)*34)),'检索资料',detail)}),Math.max(7*60000,Math.ceil(search.length/2)*7*60000)) : {sources:[],fetched:0,searchStats:{},failures:[],coverage:[],plan:[],rejections:[]});
    checkTask();
    collection.failures.push(...planning.warnings);
    collection.reusedTopics=reuse.map(topic=>topic.name_zh);
    fs.writeFileSync(path.join(this.dataDir,'latest-search-audit.json.tmp'),JSON.stringify({createdAt:new Date().toISOString(),timingsMs:this.stageTimings,elapsedMs:Date.now()-this.startedAt,editorAudit:collection.editorAudit||[],dedup:collection.dedup,plan:collection.plan,reusedTopics:collection.reusedTopics,coverage:collection.coverage,stats:collection.searchStats,failures:collection.failures,rejections:collection.rejections},null,2));
    fs.renameSync(path.join(this.dataDir,'latest-search-audit.json.tmp'),path.join(this.dataDir,'latest-search-audit.json'));
    collection.dedup={windowDays:7,filteredCandidates:0,filteredItems:0};
    const beforeDedup=collection.sources.length;collection.sources=collection.sources.filter(freshSource);collection.dedup.filteredCandidates+=beforeDedup-collection.sources.length;
    const sources=collection.sources;
    if(search.length&&sources.length){saved.collection=collection;writeCheckpoint(this.dataDir,saved);}
    if(search.length)this.emit(52,'分析资料',`正在逐主题提炼 ${search.length} 个待检索主题`);
    let edited;
    try {
      if(checkpoint?.edited) {edited=checkpoint.edited;this.emit(76,'分析资料','已恢复上次完成的检索与提炼，继续准备双语报告');}
      else if(search.length) edited=await this.stage(()=>this.services.summarizeTopics({topics:search,allTopics:topics,existingSections:(snapshot?.zh?.sections || []).filter(section=>reuse.some(topic=>topic.id===section.topic_id)),sources,connection,expansions:planning.expansions,language:outputLanguage,
        searchMore:async(topic,round,feedback)=>{
          this.emit(55,'分析资料',`${topic.name_zh} 尚未达到至少 ${minimumItems(topic)} 条，进行第 ${round} 轮补搜`);
          const base=planning.expansions.find(row=>row.topic_id===topic.id)||{topic_id:topic.id};
          const refined=feedback?await refineTopicSearch(topic,base,feedback,connection):base;
          const extra=await this.stage(()=>this.services.collectIntelligence({topics:[topic],expansions:[refined],glmApiKey:searchGlmKey,exaApiKey:searchExaKey,round,onProgress:(done,total,count,detail)=>this.emit(55,'分析资料',`${topic.name_zh} · ${detail}`)}),4*60000);
          collection.failures.push(...extra.failures);collection.plan.push(...extra.plan);collection.rejections.push(...extra.rejections);collection.fetched+=extra.fetched;
          for(const [key,value] of Object.entries(extra.searchStats||{}))collection.searchStats[key]=(collection.searchStats[key]||0)+value;
          const freshExtra=extra.sources.filter(freshSource);collection.dedup.filteredCandidates+=extra.sources.length-freshExtra.length;
          for(const source of freshExtra){const existing=sources.find(row=>row.url===source.url);if(existing){existing.topicIds=[...new Set([...existing.topicIds,...source.topicIds])];}else sources.push({...source,id:`extra-${crypto.randomUUID()}`});}
          const coverage=collection.coverage.find(row=>row.topicId===topic.id);if(coverage){coverage.queries+=extra.plan.length;coverage.selected=sources.filter(source=>source.topicIds.includes(topic.id)).length;coverage.facets=[...new Set(sources.filter(source=>source.topicIds.includes(topic.id)).map(source=>source.facet))];}
        },onProgress:(done,total)=>this.emit(52+Math.round(done/total*24),'分析资料',`已完成 ${done}/${total} 个待检索主题的证据提炼`)}),search.length*22*60000);
      else edited={report:null,warnings:[]};
      if(!reuse.length&&edited.report&&!edited.report.sections.some(s=>s.items.length)&&edited.report.sections.some(s=>s.shortfall?.reason==='model_content_policy'))throw Object.assign(new Error('搜索已完成，但模型服务拒绝处理主题内容 / Search completed, but the model provider declined the content'),{code:'CONTENT_POLICY'});
    } catch(error) {
      checkTask();
      collection.failures.push(...(error.warnings || []),error.message);
      const auditFile=path.join(this.dataDir,'latest-search-audit.json');
      fs.writeFileSync(`${auditFile}.tmp`,JSON.stringify({createdAt:new Date().toISOString(),timingsMs:this.stageTimings,elapsedMs:Date.now()-this.startedAt,editorAudit:collection.editorAudit||[],dedup:collection.dedup,plan:collection.plan,reusedTopics:collection.reusedTopics,coverage:collection.coverage,stats:collection.searchStats,failures:collection.failures,rejections:collection.rejections},null,2));
      fs.renameSync(`${auditFile}.tmp`,auditFile);
      throw error;
    }
    collection.failures.push(...edited.warnings);
    collection.editorAudit=edited.audit||[];
    if(edited.report&&!edited.report.sections.some(section=>section.shortfall)){saved.edited=edited;writeCheckpoint(this.dataDir,saved);}
    else if(edited.report){try{fs.unlinkSync(path.join(this.dataDir,'generation-checkpoint.json'));}catch{}}
    let zhNew=null,enNew=null;
    if(edited.report) {
      this.emit(79,'准备双语报告','正在把中英文内容写入同一份 HTML，之后切换无需等待');
      const other=await this.stage(()=>this.services.translateReport(edited.report,outputLanguage==='en-US'?'zh-CN':'en-US',connection),Math.max(6*60000,search.length*7*60000));
      zhNew=outputLanguage==='en-US'?other:edited.report;
      enNew=outputLanguage==='en-US'?edited.report:other;
    }
    checkTask();
    // Missing English is a translation task, never a retrieval task.
    const missingEnglish=(snapshot?.zh?.sections||[]).filter(s=>!snapshot.en?.sections?.some(e=>e.topic_id===s.topic_id));
    if(missingEnglish.length){
      this.emit(82,'补齐已有日报译文','复用今日资料，仅翻译缺失的英文内容');
      const translated=await this.stage(()=>this.services.translateReport({title:snapshot.zh.title,sections:missingEnglish},'en-US',connection),Math.max(6*60000,missingEnglish.length*7*60000));
      snapshot.en={title:snapshot.en?.title||translated.title,sections:[...(snapshot.en?.sections||[]),...translated.sections]};
    }
    const merged=mergeReportSections(topics,snapshot,zhNew,enNew,sources);
    const finalKeys=ledger?.load()||new Set(),sourceMap=new Map(merged.sources.map(s=>[s.id,s]));
    for(const section of merged.zh.sections){
      if(reuse.some(t=>t.id===section.topic_id))continue;
      const english=merged.en.sections.find(s=>s.topic_id===section.topic_id);
      const keep=section.items.map((item,i)=>![...keysFor(item,item.source_ids.map(id=>sourceMap.get(id)).filter(Boolean)),...keysFor(english.items[i])].some(key=>finalKeys.has(key)));
      collection.dedup.filteredItems+=keep.filter(value=>!value).length;
      section.items=section.items.filter((_,i)=>keep[i]);english.items=english.items.filter((_,i)=>keep[i]);
      const minimum=minimumItems(topics.find(t=>t.id===section.topic_id));
      if(section.items.length<minimum)for(const part of [section,english]){part.status=part.items.length?'partial':'unavailable';part.shortfall={...(part.shortfall||{}),minimum,found:part.items.length,rounds:part.shortfall?.rounds||1,reason:keep.some(value=>!value)?'delivered_news_duplicates':part.shortfall?.reason||'insufficient_verified_items'};}
    }
    const cited=new Set(merged.zh.sections.flatMap(s=>s.items.flatMap(i=>i.source_ids)));merged.sources=merged.sources.filter(s=>cited.has(s.id));
    if(!merged.zh.sections.some(section=>section.items.length)&&merged.zh.sections.some(section=>section.shortfall?.reason==='model_content_policy'))throw Object.assign(new Error('搜索已完成，但模型服务拒绝处理主题内容。请查看模型服务的内容限制。 / Search completed, but the model provider declined the content. Check the provider’s content policy.'),{code:'CONTENT_POLICY'});
    if(!merged.zh.sections.some(section=>section.items.length))throw Object.assign(new Error('本次未找到可新增推送的核验资讯（含近一周去重）。已有资讯不会重复发布，请稍后重试。 / No new verified items after seven-day deduplication.'),{code:'NO_VERIFIED_ITEMS'});
    for(const report of [merged.zh,merged.en]){
      validateReportTopics(report,topics,merged.sources,{allowPartial:true,reviewed:false});
      for(const topic of search)validateReportTopics({sections:report.sections.filter(s=>s.topic_id===topic.id)},[topic],merged.sources,{allowPartial:true});
    }
    for(const topic of topics){const zh=merged.zh.sections.find(s=>s.topic_id===topic.id),en=merged.en.sections.find(s=>s.topic_id===topic.id);if(zh.items.length!==en.items.length||zh.items.some((item,index)=>JSON.stringify(item.source_ids)!==JSON.stringify(en.items[index].source_ids)))throw new Error('双语主题条目映射不一致');}
    if(merged.zh.sections.length!==topics.length || merged.en.sections.length!==topics.length) throw new Error('双语报告缺少启用主题，未发布日报');
    for(const topic of topics) {
      merged.zh.sections.find(section=>section.topic_id===topic.id).title=topic.name_zh;
    }
    collection.coverage=topics.map(topic=>{
      const current=collection.coverage.find(row=>row.topicId===topic.id);
      const prior=snapshot?.coverage?.find(row=>row.topicId===topic.id);
      return {...(current || prior || {topicId:topic.id,name:topic.name_zh,queries:0,selected:0,facets:[]}),published:merged.zh.sections.find(section=>section.topic_id===topic.id)?.items.length || 0,reused:!current};
    });
    const audit={createdAt:new Date().toISOString(),timingsMs:this.stageTimings,elapsedMs:Date.now()-this.startedAt,editorAudit:collection.editorAudit||[],dedup:collection.dedup,plan:collection.plan,reusedTopics:collection.reusedTopics,coverage:collection.coverage,stats:collection.searchStats,failures:collection.failures,rejections:collection.rejections};
    const auditFile=path.join(this.dataDir,'latest-search-audit.json');
    fs.writeFileSync(`${auditFile}.tmp`,JSON.stringify(audit,null,2));
    fs.renameSync(`${auditFile}.tmp`,auditFile);
    const generatedAt = new Date().toLocaleString(outputLanguage === 'en-US' ? 'en-US' : 'zh-CN', { hour12:false });
    const zhHtml=renderReport({ report:merged.zh, sources:merged.sources, model:model.model, generatedAt, collection, language:'zh-CN' });
    const enCollection={...collection,coverage:collection.coverage.map(row=>({...row,name:merged.en.sections.find(section=>section.topic_id===row.topicId)?.title || row.name})),reusedTopics:reuse.map(topic=>merged.en.sections.find(section=>section.topic_id===topic.id)?.title || topic.name_en)};
    const enHtml=renderReport({ report:merged.en, sources:merged.sources, model:model.model, generatedAt, collection:enCollection, language:'en-US' });
    const contract={version:CONTRACT_VERSION,topics:topics.map(topic=>({id:topic.id,fingerprint:fingerprint(topic),count:merged.zh.sections.find(s=>s.topic_id===topic.id).items.length}))};
    if(JSON.stringify(this.database.listTopics().filter(t=>t.enabled).map(fingerprint).sort())!==JSON.stringify(topics.map(fingerprint).sort()))throw Object.assign(new Error('主题设置在生成期间发生变化，请按最新设置重新生成。'),{code:'TOPICS_CHANGED'});
    const snapshotValue={version:1,contractVersion:CONTRACT_VERSION,reportDate:date,createdAt:new Date().toISOString(),topics:topics.map(topic=>({...topic,fingerprint:fingerprint(topic)})),zh:merged.zh,en:merged.en,sources:merged.sources,coverage:collection.coverage};
    const embedded={...snapshotValue,sources:merged.sources.map(({id,url,title,source,publishedAt,topicIds,socialUrl,evidence})=>({id,url,title,source,publishedAt,topicIds,socialUrl,evidence}))};
    const html=embedBilingualHtml(zhHtml,enHtml,outputLanguage).replace('</head>',`<script type="application/json" id="daily-report-snapshot">${JSON.stringify(embedded).replace(/</g,'\\u003c')}</script><script type="application/json" id="daily-topic-contract">${JSON.stringify(contract).replace(/</g,'\\u003c')}</script></head>`);
    this.emit(90,'保存报告','正在写入本地 HTML 文件');
    const reportDir = path.join(this.dataDir, 'reports', date.slice(0,4), date.slice(5,7));
    fs.mkdirSync(reportDir, { recursive:true });
    const id = crypto.randomUUID();
    const file = path.join(reportDir, `${date}-daily-${id.slice(0,8)}.html`);
    const temp = `${file}.tmp`;
    await require('../dsa/client/connection').ensureAccess();
    try {fs.writeFileSync(temp, html, 'utf8');fs.renameSync(temp, file);}
    catch(error){try{if(fs.existsSync(temp))fs.unlinkSync(temp);}catch{}throw error;}
    this.emit(94, '保存报告', '正在写入 SQLite 并更新历史列表');
    const chosen=outputLanguage==='en-US'?merged.en:merged.zh;
    let record;
    try {
      saveSnapshot(this.dataDir,id,snapshotValue);
      this.emit(97,'保存报告','HTML 与快照已写入，正在登记日报');
      record = this.database.insertReport({ id, title:chosen.title || `${date} AI 动态日报`, report_type:'daily', period_start:date, period_end:date, html_path:file, created_at:new Date().toISOString(), topic_revision:topicRevision });
    } catch(error) {
      for(const artifact of [file,temp,path.join(this.dataDir,'report-snapshots',`${id}.json`),path.join(this.dataDir,'report-snapshots',`${id}.json.tmp`)]) {
        try{if(fs.existsSync(artifact))fs.unlinkSync(artifact);}catch{}
      }
      throw error;
    }
    try {fs.unlinkSync(path.join(this.dataDir,'generation-checkpoint.json'));}catch{}
    if (options.scheduledFor && Date.now() < options.scheduledFor) {
      this.emit(99, '等待交付', `报告已准备，将在 ${new Date(options.scheduledFor).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} 推送`);
      await bounded(()=>new Promise(resolve => { this.deliveryTimer=setTimeout(resolve,Math.max(0,options.scheduledFor-Date.now())); }),Math.max(1000,options.scheduledFor-Date.now()+1000));
      this.deliveryTimer=null;
    }
    this.running = false;
    this.state = { status:'completed', taskId:this.taskId, sequence:++this.sequence, percent:100, stage:'日报已生成', detail:record.title, report:record, updatedAt:new Date().toISOString() };
    try { this.onProgress(this.state); } catch (error) { console.warn(`[progress] ${error.message}`); }
    try { this.onComplete(record, {...options,shortfalls:merged.zh.sections.filter(section=>section.shortfall).map(section=>({topicId:section.topic_id,name:section.title,...section.shortfall}))}); } catch (error) { console.warn(`[notification] ${error.message}`); }
  }
}

module.exports = { GenerationService, localDate, renderReport, reportIncludesEnabledTopics, mergeReportSections };
