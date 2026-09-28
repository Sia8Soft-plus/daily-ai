const crypto=require('node:crypto');
const cooldowns=new Map();
const strikes=new Map();
const identity=(provider,key)=>`${provider}:${key?crypto.createHash('sha256').update(key).digest('hex').slice(0,16):'anonymous'}`;
function paused(provider,key,now=Date.now()){
  const row=cooldowns.get(identity(provider,key));
  if(row&&row.until>now)return row;
  cooldowns.delete(identity(provider,key));return null;
}
function recordFailure(provider,key,error,now=Date.now()){
  const text=String(error?.message||error);
  const limited=/rate.?limit|quota|credits|429|余额|额度|限流/i.test(text);
  const auth=/\b401\b|\b403\b|unauthori|invalid.*key/i.test(text);
  const transient=/timeout|timed out|fetch failed|\b50[0234]\b|网络错误/i.test(text);
  const id=identity(provider,key);
  if(transient)strikes.set(id,(strikes.get(id)||0)+1);
  if(!limited&&!auth&&(!transient||strikes.get(id)<3))return null;
  const row={until:now+(limited?15:auth?5:1)*60000,reason:limited?'rate_limited':auth?'unauthorized':'temporarily_unavailable'};
  cooldowns.set(identity(provider,key),row);return row;
}
function recordSuccess(provider,key){strikes.delete(identity(provider,key));}
module.exports={paused,recordFailure,recordSuccess};
