const fs=require('node:fs');
const path=require('node:path');
function cutoffDate(months,now=new Date()){
  const date=new Date(now);const day=date.getDate();date.setDate(1);date.setMonth(date.getMonth()-months);
  const end=new Date(date.getFullYear(),date.getMonth()+1,0).getDate();date.setDate(Math.min(day,end));
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function candidates(database,before){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(before)||!Number.isFinite(Date.parse(before))||new Date(before).toISOString().slice(0,10)!==before)throw new Error('无效日期 / Invalid date');
  return database.listReports().filter(row=>row.report_type==='daily'&&!row.is_favorite&&row.period_end<before);
}
function cleanup(database,dataDir,before){
  const rows=candidates(database,before),failed=[];let moved=0;
  const dir=path.join(dataDir,'trash');fs.mkdirSync(dir,{recursive:true});
  for(const row of rows){
    const destination=path.join(dir,`${row.id}.html`);
    try{
      fs.renameSync(row.html_path,destination);
      try{database.markTrashed(row.id,destination,row.html_path);moved++;}
      catch(error){fs.renameSync(destination,row.html_path);throw error;}
    }catch(error){failed.push({id:row.id,message:error.message});}
  }
  return {moved,failed,before};
}
module.exports={cutoffDate,candidates,cleanup};
