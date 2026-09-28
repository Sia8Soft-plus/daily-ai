const DEFAULTS={language:'zh-CN',reportLanguage:'interface',theme:'system',frequency:'daily',time:'09:00',weekdays:[1,2,3,4,5],retentionMonths:6,cleanupTime:'03:30',scheduleEnabled:true,notificationsEnabled:true,launchAtLogin:true,cleanupEnabled:true,compactSidebar:false,sidebarCollapsed:false};
function validatePreferences(value,previous={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('无效设置 / Invalid preferences');
  const next={...DEFAULTS,...previous,...value};
  for(const [key,values]of Object.entries({language:['zh-CN','en-US'],reportLanguage:['interface','zh-CN','en-US'],theme:['system','light','dark'],frequency:['daily','weekly','weekdays']}))if(!values.includes(next[key]))throw new Error(`无效设置 / Invalid setting: ${key}`);
  for(const key of ['time','cleanupTime'])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(next[key]))throw new Error('请选择有效时间 / Choose a valid time');
  if(!Array.isArray(next.weekdays)||next.weekdays.some(day=>!Number.isInteger(day)||day<1||day>7))throw new Error('无效星期 / Invalid weekdays');
  next.weekdays=[...new Set(next.weekdays)].sort();
  if(next.frequency==='weekly'&&!next.weekdays.length)throw new Error('每周计划至少选择一天 / Select a weekday');
  if(!Number.isInteger(next.retentionMonths)||next.retentionMonths<1||next.retentionMonths>120)throw new Error('保留月份须为 1–120 / Retention must be 1–120 months');
  for(const key of ['scheduleEnabled','notificationsEnabled','launchAtLogin','cleanupEnabled','compactSidebar','sidebarCollapsed'])if(typeof next[key]!=='boolean')throw new Error(`无效开关 / Invalid toggle: ${key}`);
  return next;
}
function scheduleChanged(a={},b={}){
  const signature=value=>JSON.stringify([value.scheduleEnabled!==false,value.frequency||'daily',value.time||'09:00',value.frequency==='weekly'?[...new Set(value.weekdays||[])].sort():[]]);
  return signature(a)!==signature(b);
}
module.exports={DEFAULTS,validatePreferences,scheduleChanged};
