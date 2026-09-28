const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const { PROVIDERS } = require('../main/providers');
const fail = (code, message) => Object.assign(new Error(message), { code });
const normalizeBase = value => String(value || '').trim().replace(/\/+$/, '');
const sameConnection = (a, b) => a?.provider === b?.provider && normalizeBase(a?.baseUrl || a?.base_url) === normalizeBase(b?.baseUrl || b?.base_url);

// Pin DNS resolution to a public address; never redirect a credential-bearing request.
function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19)));
  }
  return net.isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:(?:db8|0):/i.test(address);
}
function requestJson(url, headers, signal) {
  return new Promise((resolve, reject) => {
    const req=https.get(url, {headers, signal, lookup:(host,options,done)=>dns.lookup(host,{all:true},(err,rows)=>{
      if(err)return done(err);
      if(!rows.length||rows.some(r=>!publicAddress(r.address)))return done(fail('UNSAFE_ENDPOINT','仅支持公网模型地址 / Public model endpoints only'));
      if(options.all)done(null,rows);else done(null,rows[0].address,rows[0].family);
    })}, res=>{
      let size=0;const chunks=[];
      res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)req.destroy(fail('MODEL_LIST_SIZE','模型列表响应过大 / Model response too large'));else chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>{let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{}resolve({status:res.statusCode,body});});
    });
    req.setTimeout(12000,()=>req.destroy(fail('MODEL_LIST_TIMEOUT','获取模型超时，请重试 / Model discovery timed out; retry')));
    req.on('error',reject);
  });
}
async function discoverModels({provider,baseUrl,apiKey}, {request=requestJson,timeoutMs=30000}={}) {
  if(!PROVIDERS.some(p=>p.id===provider))throw fail('PROVIDER','不支持的厂商 / Unsupported provider');
  let base;try{base=new URL(normalizeBase(baseUrl));}catch{throw fail('ENDPOINT','请输入有效 API 地址 / Enter a valid API URL');}
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||net.isIP(base.hostname)||base.hostname.includes(':')||!base.hostname.includes('.')||/\.(local|internal|localhost)$/i.test(base.hostname))throw fail('ENDPOINT','请输入公网 HTTPS API 地址 / Enter a public HTTPS API URL');
  if(typeof apiKey!=='string'||!apiKey.trim())throw fail('KEY_REQUIRED','请先输入此连接的 API Key / Enter the API key for this connection');
  const headers={Accept:'application/json',Authorization:'Bearer '+apiKey.trim()};
  let protocol='openai',endpoint=normalizeBase(base.href)+'/models';
  if(provider==='anthropic'){protocol='anthropic';delete headers.Authorization;headers['x-api-key']=apiKey.trim();headers['anthropic-version']='2023-06-01';}
  if(provider==='gemini'&&base.hostname==='generativelanguage.googleapis.com'){protocol='gemini';endpoint=base.origin+base.pathname.replace(/\/openai\/?$/,'').replace(/\/$/,'')+'/models';delete headers.Authorization;headers['x-goog-api-key']=apiKey.trim();}
  if(provider==='qwen'&&(/(^|\.)aliyuncs\.com$/.test(base.hostname))){protocol='qwen';endpoint=base.origin+'/api/v1/models';}
  const url=new URL(endpoint),models=new Map(),seen=new Set();
  if(protocol==='gemini')url.searchParams.set('pageSize','1000');
  if(protocol==='anthropic')url.searchParams.set('limit','1000');
  if(protocol==='qwen'){url.searchParams.set('page_no','1');url.searchParams.set('page_size','100');url.searchParams.set('capabilities','TG');}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  let complete=false,pages=0;
  try {
    for(;pages<50;){
      const key=url.href;if(seen.has(key))break;seen.add(key);
      const {status,body}=await request(url,headers,controller.signal);pages++;
      if(status<200||status>=300)throw fail('MODEL_LIST_HTTP',`模型列表请求失败 HTTP ${status}；请检查密钥、API 地址及列表权限；不支持列表时可手动填写并测试。 / Model list HTTP ${status}. Check credentials, endpoint and list permission, or enter and test a model manually.`);
      const rows=protocol==='gemini'?body?.models:body?.output?.models||body?.data||body?.models;
      if(!Array.isArray(rows)||body?.success===false||body?.error)throw fail('MODEL_LIST_UNSUPPORTED','此 API 未返回模型列表，请检查地址或手动填写并测试 / This API did not return a model list; check the URL or enter and test a model manually');
      for(const row of rows){
        if(protocol==='gemini'&&!row.supportedGenerationMethods?.includes('generateContent'))continue;
        const id=String(row.id||row.model||row.name||'').replace(protocol==='gemini'?/^models\//:/$^/,'');
        if(id&&id.length<=200&&!/[\x00-\x1f]/.test(id))models.set(id,{id,name:String(row.display_name||row.displayName||row.name||id).slice(0,200)});
      }
      if(models.size>20000)break;
      if(body.nextPageToken){url.searchParams.set('pageToken',body.nextPageToken);continue;}
      if(body.has_more){const cursor=body.last_id||rows.at(-1)?.id;if(!cursor)break;url.searchParams.set('after_id',cursor);continue;}
      if(body.output&&Number(body.output.total)>Number(url.searchParams.get('page_no'))*Number(body.output.page_size||100)){url.searchParams.set('page_no',String(Number(url.searchParams.get('page_no'))+1));continue;}
      complete=true;break;
    }
  } catch(e) {
    if(controller.signal.aborted)throw fail('MODEL_LIST_TIMEOUT','获取模型列表超时，请重试；也可手动填写并测试 / Model discovery timed out; retry or enter and test a model manually');
    // Do not surface vendor response bodies or network diagnostics containing credentials.
    if(e.code?.startsWith('MODEL_')||e.code==='UNSAFE_ENDPOINT')throw e;
    throw fail('MODEL_LIST_NETWORK','无法连接模型列表接口，请检查网络 / Cannot reach the model list API; check your network');
  } finally {clearTimeout(timer);}
  return {models:[...models.values()].sort((a,b)=>a.id.localeCompare(b.id)),source:'api',endpoint,complete,pages,fetchedAt:new Date().toISOString()};
}
module.exports={discoverModels,sameConnection,normalizeBase,publicAddress};
