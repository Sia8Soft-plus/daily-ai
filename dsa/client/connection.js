const {currentTask}=require('../core/task-control');
let resolveRemote;
function configure(fn){resolveRemote=fn}
async function connection(){if(currentTask().dsaMode==='remote'){const c=await resolveRemote?.();if(!c?.token)throw Object.assign(new Error('请登录订阅账号 / Sign in required'),{code:'AUTH'});return {...c,remote:true};}return require('./local').start();}
async function ensureAccess(){
 if(currentTask().dsaMode!=='remote')return;
 const c=await connection();
 const response=await fetch(c.url+'/v1/subscription',{headers:{Authorization:'Bearer '+c.token},signal:AbortSignal.any([AbortSignal.timeout(15000),...(currentTask().signal?[currentTask().signal]:[])])});
 const body=await response.json();
 if(!body.ok)throw Object.assign(new Error(body.error?.message||'订阅校验失败 / Subscription verification failed'),{code:body.error?.code||'SUBSCRIPTION_REQUIRED'});
 if(!body.data?.active)throw Object.assign(new Error('订阅未开通或已到期，请重新订阅 / Subscription inactive or expired. Subscribe to continue.'),{code:'SUBSCRIPTION_REQUIRED'});
}
module.exports={configure,connection,ensureAccess};
