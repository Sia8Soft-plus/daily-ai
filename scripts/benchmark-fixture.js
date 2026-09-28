const {ipcMain}=require('electron');
const {PROVIDERS}=require('../main/providers');
const {embedBilingualHtml}=require('../main/report-language');
function installFixture(){
  const state={calls:[],fail:{},pendingMigration:null,preferences:{language:'zh-CN',theme:'light',frequency:'daily',time:'09:00',weekdays:[1],notificationsEnabled:false,launchAtLogin:false,scheduleEnabled:false},generation:{status:'idle'},messages:[],tabs:[]};
  state.topics=[{id:'agents-llm',name_zh:'AI 智能体与大模型',name_en:'AI agents & LLMs',description:'模型、推理、训练、工具调用、评测与应用架构',min_items:6,region_preference:'global',enabled:true}];
  state.models=[{id:'glm-default',provider:'glm',model:'saved-custom-model',base_url:'https://open.bigmodel.cn/api/paas/v4',status:'verified',is_default:true,keyHint:'•••• test'}];
  state.reports=Array.from({length:3},(_,i)=>({id:'fixture-'+i,title:'Benchmark report '+i,report_type:'daily',period_start:'2026-09-2'+(4+i),period_end:'2026-09-2'+(4+i),created_at:'2026-09-2'+(4+i)+'T09:00:00+08:00',is_favorite:i===1}));
  state.trash=[{...state.reports[0],id:'trash-fixture',deleted_at:new Date().toISOString()}];
  state.tabs=[{tab_id:'home',title:'Home',is_active:false},{tab_id:'report-fixture-1',report_id:'fixture-1',title:'Benchmark report 1',is_active:true},{tab_id:'report-missing',report_id:'missing',title:'Missing',is_active:false}];
  const html=embedBilingualHtml('<html><head><style></style></head><body><main><h1>测试日报</h1><section class="highlights"><li class="key-point"><strong>可核验的技术进展</strong></li></section></main></body></html>','<html lang="en"><head><style></style></head><body><main><h1>Benchmark report</h1><section class="highlights"><li class="key-point"><strong>Verified technical progress</strong></li></section></main></body></html>');
  state.accountMode='local';state.accountUser=null;
  const routes={
    'update:healthy':()=>true,
    'update:state':()=>({status:'idle',currentVersion:'0.2.12'}),
    'account:activity':()=>({expiresAt:Date.now()+172800000}),
    'account:state':()=>{const plans=(state.accountPlans||require('./subscription-fixture').defaults).map(p=>({...require('./subscription-fixture').publicPlan(p),action:state.accountUser?.subscription?'change':'subscribe',isCurrent:state.accountUser?.subscription?.id===p.id}));return{rememberedUsername:state.rememberedUsername||'',rememberUsername:true,mode:state.accountMode,user:state.accountUser,hasSession:!!state.accountUser,localModelConfigured:state.models.length>0,plans,subscription:state.accountUser?{current:state.accountUser.subscription||null,active:!!state.accountUser.subscription,status:state.accountUser.subscription?'active':'none',pendingChange:state.accountUser.pendingChange||null,canRenew:!!state.accountUser.subscription&&plans.some(p=>p.id===state.accountUser.subscription.id),...require('./subscription-fixture').presentation(plans),catalog:plans}:null};},
    'account:captcha':()=>({captchaEnabled:false}),
    'account:login':b=>(state.rememberedUsername=b.username,state.accountUser={id:'fixture-user',name:'Fixture User',onboarded:false}),
    'account:mode':p=>{state.accountMode=p.mode;if(state.accountUser)state.accountUser.onboarded=true;return p.mode},
    'account:preview':p=>{const plan=(state.accountPlans||require('./subscription-fixture').defaults).find(x=>x.id===p.planId),current=state.accountUser.subscription,action=!current?'subscribe':current.id===p.planId?'renew':'change',effectiveAt=current?.until||new Date().toISOString();return state.quote={id:require('node:crypto').randomUUID(),plan,action,amountMinor:plan.amountMinor,currency:plan.currency,paymentAvailable:true,requiresConsent:plan.recurring,effectiveAt,until:require('./subscription-fixture').addMonths(effectiveAt,plan.months)};},
    'account:order':async()=>{if(state.orderDelay)await new Promise(r=>setTimeout(r,state.orderDelay));if(state.quote.action==='change')state.accountUser.pendingChange={plan:state.quote.plan,startsAt:state.quote.effectiveAt,until:state.quote.until};else state.accountUser.subscription={...state.quote.plan,until:state.quote.until};return state.accountUser},
    'account:cancelPending':()=>{state.accountUser.pendingChange=null;return state.accountUser;},
    'account:usage':()=>({days:[]}),
    'account:logout':()=>{state.accountUser=null;state.accountMode='local';return true},
    'share:list':()=>[],
    'share:state':()=>state.share||null,
    'share:create':p=>{if(!p.consent)throw Error('Consent required');return state.share={id:'fixture-share',documentId:p.id,active:true,url:'https://example.test/shared/fixture'}},
    'share:revoke':()=>{state.share.active=false;return{revoked:true}},

    'bootstrap:get':()=>({settings:state.preferences,reports:state.reports,trash:state.trash,topics:state.topics,models:state.accountMode==='remote'?[{id:'remote-managed',provider:'managed',model:'platform-managed',is_default:true,status:'verified'}]:state.models,tabs:state.tabs,dataPath:'C:\\Daily-AI-Fixture'}),
    'settings:update':p=>(state.preferences=p),'tabs:saveState':p=>(state.tabs=p,true),
    'models:discover':()=>({models:[{id:'live-model-one'},{id:'live-model-two'}],source:'api',complete:true,fetchedAt:new Date().toISOString()}),'models:catalog':()=>PROVIDERS,'models:list':()=>state.models,
    'models:testAndSave':p=>{const profile={id:p.id,provider:p.provider,model:p.model,base_url:p.baseUrl,status:'verified',is_default:true,keyHint:'•••• test'};state.models=state.models.filter(m=>m.id!==p.id).map(m=>({...m,is_default:false}));state.models.push(profile);return {profile,verification:{message:'TEST_OK'}};},
    'search:getConfig':()=>({exaConfigured:false}),'search:saveConfig':()=>({exaConfigured:true}),
    'reports:list':()=>state.reports,'reports:trash:list':()=>state.trash,
    'reports:getContent':({id})=>{const report=state.reports.find(r=>r.id===id);if(!report)throw new Error('Missing report');return {report,html};},
    'reports:reveal':()=>true,'reports:markRead':()=>0,'reports:toggleFavorite':({id})=>{const r=state.reports.find(r=>r.id===id);r.is_favorite=!r.is_favorite;return r;},
    'reports:trash':({id})=>{const r=state.reports.find(r=>r.id===id);state.reports=state.reports.filter(r=>r.id!==id);state.trash.push({...r,deleted_at:new Date().toISOString()});return r;},
    'reports:restore':({id})=>{const r=state.trash.find(r=>r.id===id);state.trash=state.trash.filter(r=>r.id!==id);state.reports.push({...r,deleted_at:null});return r;},
    'reports:deleteForever':({id})=>{state.trash=state.trash.filter(r=>r.id!==id);return {id};},
    'reports:emptyTrash':()=>{const deleted=state.trash.length;state.trash=[];return {deleted,failed:[]};},
    'topics:list':()=>state.topics,
    'topics:add':p=>{if(p.name.trim().length<2||p.description.trim().length<8)throw new Error('Invalid topic');const t={...p,id:'added-topic',name_zh:p.name,name_en:p.name,enabled:true};state.topics.push(t);return t;},
    'topics:update':p=>{const t=state.topics.find(t=>t.id===p.id);Object.assign(t,p,{name_zh:p.name});return t;},
    'topics:setEnabled':p=>{const t=state.topics.find(t=>t.id===p.id);t.enabled=p.enabled;return t;},
    'topics:delete':({id})=>{state.topics=state.topics.filter(t=>t.id!==id);return {id};},
    'generation:getState':()=>state.generation,'generation:create':()=>state.createResult||{status:'model_required'},
    'generation:cancel':()=>({...state.generation,status:'cancelled',sequence:(state.generation.sequence||0)+1}),
    'digest:preview':({start,end})=>state.reports.filter(r=>r.period_start>=start&&r.period_end<=end).map(r=>({...r,available:true})),
    'digest:create':()=>state.digestResult||{status:'running',progress:{status:'running',taskId:'existing-task',sequence:1,percent:20,stage:'检索资料'}},
    'activity:list':()=>state.messages,'activity:read':()=>{state.messages.forEach(m=>m.read=true);return state.messages;},'activity:clear':()=>state.messages=[],
    'schedule:getStatus':()=>null,'cleanup:preview':()=>[],'cleanup:run':()=>({moved:0,failed:[]}),
    'storage:chooseDirectory':()=>null,'storage:migrate':()=>new Promise(resolve=>state.pendingMigration=resolve),
    'theme:set':p=>p,'window:minimize':()=>true,'window:toggleMaximize':()=>true,'window:close':()=>true,'window:confirmQuit':()=>true,'window:cancelQuit':()=>true,'shell:openExternal':()=>true,
    'dashboard:getStats':()=>({documents:{total:state.reports.length,daily:state.reports.length,digest:0,favorites:state.reports.filter(r=>r.is_favorite).length,htmlBytes:1234,indexBytes:1000,missing:0},modelUsage:{today:{calls:0,metered_calls:0,tokens:0},month:{calls:0,metered_calls:0,tokens:0}},cleanup:{enabled:true,at:'2026-09-27T03:30:00+08:00',retentionMonths:6,cleanupTime:'03:30'}})
  };
  for(const [channel,run]of Object.entries(routes))ipcMain.handle(channel,async(_event,payload)=>{state.calls.push({channel,payload:channel.includes('Save')?{...payload,apiKey:'[redacted]'}:payload});try{if(state.fail[channel])throw new Error(state.fail[channel]);return {ok:true,data:await run(payload)};}catch(error){return {ok:false,error:{code:'FIXTURE',message:error.message}};}});
  return state;
}
module.exports={installFixture};
