const { AsyncLocalStorage } = require('node:async_hooks');
const scope = new AsyncLocalStorage();
function taskError(code, message) { return Object.assign(new Error(message), {code}); }
function currentTask() { return scope.getStore() || {}; }
function checkTask() { currentTask().signal?.throwIfAborted(); }
function abortable(operation, signal) {
  if (!signal) return Promise.resolve().then(operation);
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const aborted=()=>reject(signal.reason);
    signal.addEventListener('abort',aborted,{once:true});
    Promise.resolve().then(()=>{signal.throwIfAborted();return operation();}).then(resolve,reject)
      .finally(()=>signal.removeEventListener('abort',aborted));
  });
}
async function bounded(operation, ms, {signal=currentTask().signal, code='TIMEOUT', message='Operation timed out'}={}) {
  const controller=new AbortController();
  const combined=signal ? AbortSignal.any([signal,controller.signal]) : controller.signal;
  const timer=setTimeout(()=>controller.abort(taskError(code,message)),ms);
  try { return await scope.run({...currentTask(),signal:combined},()=>abortable(()=>operation(combined),combined)); }
  finally {clearTimeout(timer);}
}
function terminal(error) { return ['CANCELLED','TASK_TIMEOUT','STAGE_TIMEOUT','AUTH','INVALID_REQUEST','CONTENT_POLICY'].includes(error?.code); }
function delay(ms,signal=currentTask().signal) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(signal.reason);
    const cleanup=()=>signal?.removeEventListener('abort',abort);
    const timer=setTimeout(()=>{cleanup();resolve();},ms);
    const abort=()=>{clearTimeout(timer);cleanup();reject(signal.reason);};
    signal?.addEventListener('abort',abort,{once:true});
  });
}
module.exports={scope,currentTask,checkTask,abortable,bounded,taskError,terminal,delay};
