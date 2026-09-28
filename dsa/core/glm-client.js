const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';
let electron={};try{electron=require('electron')}catch{}
const {bounded,currentTask,terminal,delay}=require('./task-control');

async function callModel({apiKey,provider='glm',model='glm-5.3',baseUrl=DEFAULT_BASE_URL,messages,signal,timeoutMs=180000,maxTokens=6000,retries=1,fetchImpl,onUsage}) {
  if(process.versions.electron&&process.type==='browser'&&!process.env.DSA_WORKER&&!fetchImpl)return require('../client/local').call('model',{apiKey,provider,model,baseUrl,messages,signal,timeoutMs,maxTokens,retries,onUsage});
  const request=fetchImpl || (typeof electron.net?.fetch==='function'?electron.net.fetch.bind(electron.net):fetch);
  const anthropic=provider==='anthropic';
  const endpoint=`${baseUrl.replace(/\/$/,'')}/${anthropic?'messages':'chat/completions'}`;
  if(!/^https:\/\//i.test(endpoint))throw new Error('Model endpoint must use HTTPS');
  const parent=currentTask();
  signal=signal && parent.signal ? AbortSignal.any([signal,parent.signal]) : signal || parent.signal;
  for(let attempt=0;attempt<=retries;attempt++) {
    try {
      return await bounded(async combined=>{
      const response=await request(endpoint,{method:'POST',signal:combined,
        headers:anthropic?{'x-api-key':apiKey,'anthropic-version':'2023-06-01','Content-Type':'application/json'}:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
        body:JSON.stringify({model,messages,stream:false,...(anthropic?{max_tokens:maxTokens}:{}),...(provider==='glm'&&/^glm-5\.(?:[2-9]|\d{2,})(?:\D|$)/i.test(model)?{reasoning_effort:'low'}:{})})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok){const error=new Error(body?.error?.message || body?.msg || `HTTP ${response.status}`);error.retryable=[408,429,500,502,503,504].includes(response.status);error.code=['1301','content_filter','content_policy_violation'].includes(String(body?.error?.code))||/content.?filter|content.?policy|敏感内容|不安全/.test(error.message)?'CONTENT_POLICY':[401,403].includes(response.status)?'AUTH':error.retryable?'HTTP_TRANSIENT':'INVALID_REQUEST';error.retryAfter=Math.min(10000,Math.max(1000,Number(response.headers?.get('retry-after'))*1000 || 1000));throw error;}
      if(body.choices?.[0]?.finish_reason==='content_filter'||body.choices?.[0]?.message?.refusal)throw Object.assign(new Error('模型服务拒绝处理此内容 / Model provider declined this content'),{code:'CONTENT_POLICY',retryable:false});
      const content=anthropic?body.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n'):body.choices?.[0]?.message?.content;
      const text=Array.isArray(content)?content.map(b=>b.text || '').join('\n'):content;
      if(!text || typeof text!=='string')throw new Error('Model returned no usable text');
      if(body.stop_reason==='max_tokens' || body.choices?.[0]?.finish_reason==='length')throw new Error('Model output was truncated; reduce the editorial batch');
      const result={model:body.model || model,text,usage:body.usage || null};
      try{(onUsage||parent.onUsage)?.({provider,model:result.model,usage:result.usage});}
      catch(error){console.warn(`[model usage] ${error.message}`);}
      return result;
      },timeoutMs,{signal,code:'MODEL_TIMEOUT',message:`Model did not finish within ${Math.round(timeoutMs/1000)} seconds`});
    } catch(error) {
      if(signal?.aborted)throw signal.reason;
      if(terminal(error) || attempt>=retries || !(error.retryable || error.code==='MODEL_TIMEOUT' || /fetch failed|network|socket/i.test(error.message)))throw error;
      parent.onStatus?.({type:'retry',attempt:attempt+2,total:retries+1,code:error.code || 'NETWORK'});
      await delay(error.retryAfter || 1500,signal);
    }
  }
}
async function verifyModel(input) {
  const result=await callModel({...input,messages:[{role:'user',content:'Reply only DAILY_AI_OK'}],timeoutMs:30000,retries:0,maxTokens:64});
  return {ok:true,model:result.model,message:result.text.slice(0,120),usage:result.usage};
}
module.exports={DEFAULT_BASE_URL,callModel,verifyModel,callGlm:input=>callModel({...input,provider:'glm'}),verifyGlm:input=>verifyModel({...input,provider:'glm'})};
