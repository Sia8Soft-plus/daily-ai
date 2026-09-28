const fs=require('node:fs/promises');
const path=require('node:path');

const localDay=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
function usageWindow(now=new Date()){
  const start=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const month=new Date(now.getFullYear(),now.getMonth(),1);
  return {todayStart:start.toISOString(),monthStart:month.toISOString()};
}
function nextCleanup(preferences,lastDate,now=new Date()){
  if(preferences.cleanupEnabled===false)return {enabled:false,at:null};
  const [hour,minute]=String(preferences.cleanupTime||'03:30').split(':').map(Number);
  const at=new Date(now.getFullYear(),now.getMonth(),now.getDate(),Number.isInteger(hour)?hour:3,Number.isInteger(minute)?minute:30);
  if(lastDate===localDay(now))at.setDate(at.getDate()+1);
  return {enabled:true,at:at.toISOString(),due:at<=now};
}
async function activeDocumentStats(database,dataDir){
  const reports=database.listReports();
  let bytes=0,missing=0;
  // Bound concurrent disk operations when users have accumulated many HTML files.
  let next=0;
  await Promise.all(Array.from({length:Math.min(16,reports.length)},async()=>{
    while(next<reports.length){const report=reports[next++];try{bytes+=(await fs.stat(report.html_path)).size;}catch{missing++;}}
  }));
  const counts={daily:0,digest:0,favorites:0};
  for(const report of reports){if(report.report_type==='daily')counts.daily++;if(report.report_type==='digest')counts.digest++;if(report.is_favorite)counts.favorites++;}
  const files=['daily-ai.db','daily-ai.db-wal','daily-ai.db-shm'];
  let indexBytes=0;
  for(const name of files)try{indexBytes+=(await fs.stat(path.join(dataDir,name))).size;}catch{}
  return {...counts,total:reports.length,htmlBytes:bytes,indexBytes,missing};
}
async function dashboardStats(database,dataDir,now=new Date()){
  const settings=database.getSetting('preferences',{});
  const [documents,modelUsage]=await Promise.all([
    activeDocumentStats(database,dataDir),
    Promise.resolve(database.modelUsageStats(usageWindow(now)))
  ]);
  return {documents,modelUsage,cleanup:{...nextCleanup(settings,database.getSetting('cleanup_last_date',null),now),retentionMonths:settings.retentionMonths||6,cleanupTime:settings.cleanupTime||'03:30'},updatedAt:now.toISOString()};
}
module.exports={usageWindow,nextCleanup,activeDocumentStats,dashboardStats};
