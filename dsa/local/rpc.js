const http=require('node:http'),crypto=require('node:crypto');
const {scope}=require('../core/task-control');
const operations={model:args=>require('../core/glm-client').callModel(args),search:args=>require('../core/intelligence-sources').collectIsolated(args),plan:a=>require('../core/editor').planTopics(a.topics,a.connection,{load:t=>a.cached?.[t.id]}),refine:a=>require('../core/editor').refineTopicSearch(a.topic,a.expansion,a.feedback,a.connection),summarize:a=>require('../core/editor').summarizeTopics(a),translate:a=>require('../core/report-language').translateReport(a.report,a.targetLanguage,a.connection)};
const error=(code,message)=>Object.assign(new Error(message),{code});
async function body(req,limit=2*1024*1024){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw error('BODY_TOO_LARGE','Request too large');parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString()||'{}')}catch{throw error('BAD_REQUEST','Invalid JSON')}}
function createServer({authorize,resolveArgs=async(_user,_op,args)=>args,onUsage=()=>{},maxActive=4,operations:ops=operations}){
 const active=new Map(),userActive=new Map(),callbacks=new Map();
 const server=http.createServer(async(req,res)=>{
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(req.url==='/health'&&req.method==='GET')return json(200,{service:'daily-serach-agent',version:require('../../package.json').version,active:active.size});
  try{
   if(req.headers.origin)throw error('FORBIDDEN','Browser origin not permitted on service RPC');
   const user=await authorize(req);
   const callbackMatch=req.url?.match(/^\/rpc\/callback\/([a-f0-9-]{36})$/);if(callbackMatch&&req.method==='POST'){const c=callbacks.get(callbackMatch[1]);if(!c||c.userId!==user.id)throw error('FORBIDDEN','Callback unavailable');const b=await body(req);callbacks.delete(callbackMatch[1]);if(b.error)c.reject(error(b.error.code||'CALLBACK_ERROR',b.error.message));else c.resolve(b.data);return json(200,{ok:true});}
   if(req.url!=='/rpc'||req.method!=='POST')return json(404,{error:{code:'NOT_FOUND'}});
   if((userActive.get(user.id)||0)>=2)throw error('BUSY','Per-user concurrency limit reached');
   if(active.size>=maxActive)throw error('BUSY','Service concurrency limit reached');
   const {operation,args={},callbackMethods=[]}=await body(req);if(!Object.hasOwn(ops,operation))throw error('BAD_REQUEST','Unknown operation');
   const input=await resolveArgs(user,operation,args),controller=new AbortController(),id=crypto.randomUUID();
   active.set(id,controller);userActive.set(user.id,(userActive.get(user.id)||0)+1);res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   const send=row=>{if(!res.destroyed&&!res.writableEnded)res.write(JSON.stringify(row)+'\n');};
   if(operation==='summarize'&&callbackMethods.includes('searchMore'))input.searchMore=(...args)=>new Promise((resolve,reject)=>{const callbackId=crypto.randomUUID();const aborted=()=>{callbacks.delete(callbackId);reject(controller.signal.reason)};controller.signal.addEventListener('abort',aborted,{once:true});callbacks.set(callbackId,{userId:user.id,resolve:data=>{controller.signal.removeEventListener('abort',aborted);if(Array.isArray(data?.sources)&&Array.isArray(input.sources)){const ids=new Set(input.sources.map(s=>s.id));for(const source of data.sources)if(source&&typeof source.id==='string'&&!ids.has(source.id)){input.sources.push(source);ids.add(source.id);}}resolve(data)},reject:e=>{controller.signal.removeEventListener('abort',aborted);reject(e)}});send({type:'callback',callbackId,method:'searchMore',args});});
   const abort=()=>controller.abort(error('CANCELLED','Client disconnected'));res.on('close',abort);
   const deadline=setTimeout(()=>controller.abort(error('TASK_TIMEOUT','DSA operation deadline reached')),15*60000);
   let checking=false;const accessCheck=setInterval(async()=>{if(checking)return;checking=true;try{await authorize(req)}catch(e){controller.abort(e)}finally{checking=false}},5000);
   const heartbeat=setInterval(()=>send({type:'heartbeat',time:Date.now()}),10000);
   try{const result=await scope.run({signal:controller.signal,onUsage:event=>{onUsage(user,event);send({type:'usage',data:event})},onStatus:event=>send({type:'status',data:event})},()=>ops[operation]({...input,signal:controller.signal,onProgress:(...data)=>send({type:'progress',data})}));await authorize(req);controller.signal.throwIfAborted();send({type:'result',data:result});}
   catch(e){send({type:'error',error:{code:e.code||'DSA_ERROR',message:e.message}});}
   finally{controller.abort(error('CANCELLED','Operation ended'));clearTimeout(deadline);clearInterval(heartbeat);clearInterval(accessCheck);active.delete(id);userActive.set(user.id,Math.max(0,(userActive.get(user.id)||1)-1));if(!userActive.get(user.id))userActive.delete(user.id);res.off('close',abort);res.end();}
  }catch(e){json(e.code==='BUSY'?429:['AUTH','FORBIDDEN'].includes(e.code)?401:400,{error:{code:e.code||'ERROR',message:e.message}});}
 });
 server.headersTimeout=10000;server.requestTimeout=30000;
 server.stop=()=>{for(const c of active.values())c.abort(error('CANCELLED','Service stopping'));server.closeAllConnections();return new Promise(r=>server.close(r));};
 return server;
}
module.exports={createServer,body,error};
