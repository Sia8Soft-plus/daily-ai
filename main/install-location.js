const fs=require('node:fs'),path=require('node:path');
function initialLocation(userData,executableDir){
 const locationFile=path.join(userData,'data-location.json'),fallback=path.join(userData,'data');
 if(fs.existsSync(locationFile)){
  const dataDir=JSON.parse(fs.readFileSync(locationFile,'utf8')).dataDir;
  if(typeof dataDir!=='string'||!path.isAbsolute(dataDir)||!fs.existsSync(path.join(dataDir,'daily-ai.db')))throw Error('已迁移的数据目录不可用，请连接数据磁盘后重试 / Data directory unavailable');
  return {dataDir,locationFile,persist:false};
 }
 if(fs.existsSync(path.join(fallback,'daily-ai.db')))return {dataDir:fallback,locationFile,persist:false};
 const config=path.join(executableDir,'install-settings.json');
 if(!fs.existsSync(config))return {dataDir:fallback,locationFile,persist:false};
 const {dataDir}=JSON.parse(fs.readFileSync(config,'utf8'));
 if(typeof dataDir!=='string'||!path.isAbsolute(dataDir))throw Error('安装时选择的数据目录无效 / Invalid installed data directory');
 return {dataDir:path.resolve(dataDir),locationFile,persist:true};
}
function persistLocation(location){if(!location.persist)return;fs.mkdirSync(path.dirname(location.locationFile),{recursive:true});const temp=location.locationFile+'.tmp';fs.writeFileSync(temp,JSON.stringify({dataDir:location.dataDir}));fs.renameSync(temp,location.locationFile);}
module.exports={initialLocation,persistLocation};
