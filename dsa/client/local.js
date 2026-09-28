const {fork}=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
const {currentTask,scope}=require('../core/task-control');
let child,ready,connection;
function start(){if(ready)return ready;ready=new Promise((resolve,reject)=>{
 const proc=child=fork(path.join(__dirname,'../local/local.js'),[],{execPath:process.execPath,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DSA_WORKER:'1'},stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
 proc.stderr.on('data',()=>{});
 const secret=crypto.randomBytes(32).toString('hex');const timer=setTimeout(()=>{proc.kill();reject(new Error('local-DSA startup timeout'));ready=null;},15000);
 proc.once('error',e=>{clearTimeout(timer);if(child===proc)ready=null;reject(e)});proc.once('exit',()=>{clearTimeout(timer);if(child===proc){ready=null;connection=null;}reject(new Error('local-DSA exited'));});
 proc.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);connection={url:`http://127.0.0.1:${m.port}`,token:secret};resolve(connection)}});proc.send({secret,port:0});
 });return ready;}
async function call(operation,args){const context=currentTask(),controller=new AbortController(),parent=args.signal||context.signal,signal=parent?AbortSignal.any([parent,controller.signal]):controller.signal;
 try{const conn=await require('./connection').connection(),payload={...args};if(conn.remote){delete payload.apiKey;delete payload.glmApiKey;delete payload.exaApiKey;delete payload.baseUrl;delete payload.connection;}
 const response=await fetch(conn.url+'/rpc',{method:'POST',headers:{Authorization:'Bearer '+conn.token,'Content-Type':'application/json'},body:JSON.stringify({operation,args:payload,callbackMethods:typeof args.searchMore==='function'?['searchMore']:[]}),signal});
 if(!response.ok){const e=await response.json();throw Object.assign(new Error(e.error?.message||'DSA request failed'),{code:e.error?.code});}
 let pending='';const decoder=new TextDecoder();for await(const chunk of response.body){pending+=decoder.decode(chunk,{stream:true});if(pending.length>24*1024*1024)throw new Error('DSA result exceeded size limit');let end;while((end=pending.indexOf('\n'))>=0){const event=JSON.parse(pending.slice(0,end));pending=pending.slice(end+1);
  if(event.type==='callback'&&event.method==='searchMore'&&typeof args.searchMore==='function')scope.run({...context,signal},()=>Promise.resolve().then(()=>args.searchMore(...event.args))).then(data=>({data:operation==='summarize'?{sources:args.sources}:data}),e=>({error:{code:e.code,message:e.message}})).then(body=>fetch(conn.url+'/rpc/callback/'+event.callbackId,{method:'POST',headers:{Authorization:'Bearer '+conn.token,'Content-Type':'application/json'},body:JSON.stringify(body),signal})).catch(()=>{});
  if(event.type==='progress')args.onProgress?.(...event.data);if(event.type==='usage')(args.onUsage||context.onUsage)?.(event.data);if(event.type==='status')context.onStatus?.(event.data);if(event.type==='error')throw Object.assign(new Error(event.error.message),{code:event.error.code});if(event.type==='result')return event.data;
 }}throw new Error('DSA stream ended without a result');
 }finally{controller.abort(Object.assign(new Error('DSA operation ended'),{code:'CANCELLED'}));}}
function stop(){child?.kill();child=null;ready=null;connection=null;}
module.exports={call,start,stop};
