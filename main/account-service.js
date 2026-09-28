function register({handle,database,vault,isRunning}){
 const url=require('../shared/remote-endpoint').remoteUrl();
 async function api(endpoint,method='GET',body){
  const token=vault.get('dsa:session');let r;
  try{r=await fetch(url+'/v1/'+endpoint,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});}catch{throw Object.assign(new Error('暂时无法连接订阅服务，请确认服务已启动 / Subscription service is unavailable. Check that it is running.'),{code:'SERVICE_UNAVAILABLE'});}
  const b=await r.json();if(!b.ok)throw Object.assign(new Error(b.error?.message||'Subscription service unavailable'),{code:b.error?.code});return b.data;
 }
 require('../dsa/client/connection').configure(()=>({url,token:vault.get('dsa:session')}));
 const mode=()=>database.getSetting('dsa_mode','local');
 const localReady=()=>{const m=database.getDefaultModelRecord();return !!(m&&vault.get(m.credential_ref));};
 const schedulePayload=()=>({topics:database.listTopics().filter(t=>t.enabled),settings:{...require('./preferences').DEFAULTS,...database.getSetting('preferences',{})},timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});
 async function syncSchedule(){if(!vault.get('dsa:session'))return;await api('schedule',mode()==='remote'?'PUT':'DELETE',mode()==='remote'?schedulePayload():undefined);}
 module.exports.syncSchedule=syncSchedule;
 handle('account:state',async()=>{let user=null,error=null,errorCode=null,plans=[],subscription=null;const hasSession=!!vault.get('dsa:session');if(hasSession)try{user=await api('me');subscription=await api('subscription');plans=subscription.catalog;}catch(e){error=e.message;errorCode=e.code;if(['AUTH','USER_DISABLED'].includes(e.code))user=null;}return {user,plans,subscription,error,errorCode,hasSession,rememberedUsername:database.getSetting('remembered_username',''),rememberUsername:database.getSetting('remember_username',true),mode:mode(),localModelConfigured:localReady(),running:isRunning()};});
 let lastActivity=0;
 handle('account:activity',async()=>{if(!vault.get('dsa:session')||Date.now()-lastActivity<60000)return;await api('auth/activity','POST',{});lastActivity=Date.now();});
 handle('account:usage',()=>api('me/usage'));
 handle('account:login',async b=>{const result=await api('auth/login','POST',{username:b.username,password:b.password,code:b.code,uuid:b.uuid});vault.save('dsa:session',result.token);database.setSetting('remember_username',b.rememberUsername!==false);database.setSetting('remembered_username',b.rememberUsername===false?'':String(b.username||'').trim().slice(0,100));return result.user;});
 handle('account:register',b=>api('auth/register','POST',b));
 handle('account:captcha',()=>api('auth/captcha'));
 handle('account:logout',async()=>{if(isRunning())throw new Error('请先结束当前任务 / Finish the current task');if(vault.get('dsa:session')){if(mode()==='remote')try{await api('schedule','DELETE');}catch(e){if(!['AUTH','USER_DISABLED'].includes(e.code))throw e;}try{await api('auth/logout','POST',{});}catch(e){if(!['AUTH','USER_DISABLED'].includes(e.code))throw e;}}vault.save('dsa:session','');database.setSetting('dsa_mode','local');return true;});
 handle('account:mode',async b=>{
  if(isRunning())throw new Error('当前任务结束后才能切换生成方式 / Finish the current task before switching generation mode');
  const next=b.mode==='remote'?'remote':'local',previous=mode();
  if(next==='local'&&previous==='local'){if(vault.get('dsa:session'))await api('me/preferences','PATCH',{preferredMode:next}).catch(()=>{});return next;}
  if(next==='remote'){
   const u=await api('me');if(!u.vip&&!(Date.parse(u.subscription?.until)>Date.now()))throw Object.assign(new Error('请先订阅 / Subscribe first'),{code:'SUBSCRIPTION_REQUIRED'});
   await api('me/preferences','PATCH',{preferredMode:next});await api('schedule','PUT',schedulePayload());
  }else{
   if(!localReady())throw Object.assign(new Error('请先验证本地 API Key / Verify a local API key first'),{code:'MODEL_REQUIRED'});
   if(vault.get('dsa:session')){await api('schedule','DELETE');await api('me/preferences','PATCH',{preferredMode:next});}
  }
  // Commit only after remote schedule acknowledgement; a failure retains the previous mode.
  database.setSetting('dsa_mode',next);return next;
 });
 handle('share:state',b=>{const report=database.getReport(b.id);let query='';if(report&&!report.deleted_at){const fs=require('node:fs');if(fs.existsSync(report.html_path)&&fs.statSync(report.html_path).size<=2*1024*1024){const html=require('../shared/html-sanitizer').cleanHtml(fs.readFileSync(report.html_path,'utf8'));query='?'+new URLSearchParams({title:report.title,fingerprint:require('node:crypto').createHash('sha256').update(html).digest('hex')});}}return api('shares/document/'+encodeURIComponent(b.id)+query);});
 handle('share:list',()=>api('shares'));
 handle('share:revoke',b=>api('shares/'+encodeURIComponent(b.id),'DELETE'));
 handle('share:create',b=>{if(b.consent!==true)throw new Error('Public sharing consent required');const report=database.getReport(b.id);if(!report||report.deleted_at)throw new Error('Report unavailable');const fs=require('node:fs');if(fs.statSync(report.html_path).size>2*1024*1024)throw new Error('Report exceeds share size limit');return api('shares','POST',{documentId:report.id,title:report.title,html:fs.readFileSync(report.html_path,'utf8'),consent:true});});
 handle('account:preview',b=>api('subscription/preview','POST',b));
 handle('account:cancelPending',()=>api('subscription/pending','DELETE'));
 handle('account:order',b=>api('subscription/order','POST',b));handle('account:cancel',()=>api('subscription/cancel','POST',{}));
}
module.exports={register};
