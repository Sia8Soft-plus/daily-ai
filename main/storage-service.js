const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DailyAiDatabase}=require('./database');
const inside=(root,file)=>{const rel=path.relative(root,file);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
async function hash(file) {const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))digest.update(chunk);return digest.digest('hex');}

function deleteTrashedReport(database,dataDir,id) {
  const report=database.getReport(id);
  if(!report?.deleted_at)throw new Error('请先将报告移入回收站 / Move the report to Trash first');
  const files=[report.html_path,path.join(dataDir,'report-snapshots',`${id}.json`)];
  const translations=path.join(dataDir,'translations');
  if(fs.existsSync(translations))for(const name of fs.readdirSync(translations))if(name.startsWith(`${id}-`))files.push(path.join(translations,name));
  for(const file of files) {
    if(!inside(path.resolve(dataDir),path.resolve(file)))throw new Error('报告路径不属于数据目录 / Invalid report path');
    if(fs.existsSync(file))fs.unlinkSync(file);
  }
  return database.permanentlyDeleteReport(id);
}

async function migrateData({database,source,target,configFile,onProgress=()=>{}}) {
  source=await fs.promises.realpath(source);
  target=path.resolve(target);
  // Select an empty directory; never overwrite or merge another data store.
  if(fs.existsSync(target))target=await fs.promises.realpath(target);
  if(source===target||inside(source,target)||inside(target,source))throw new Error('请选择与当前目录互不包含的新目录 / Choose a separate directory');
  if(fs.existsSync(target)&&(await fs.promises.readdir(target)).length)throw new Error('目标目录必须为空 / Destination must be empty');
  await fs.promises.mkdir(target,{recursive:true});
  target=await fs.promises.realpath(target);
  if(source===target||inside(source,target)||inside(target,source))throw new Error('目标目录无效 / Invalid destination');
  const files=[];
  async function scan(dir) {
    for(const entry of await fs.promises.readdir(dir,{withFileTypes:true})) {
      const file=path.join(dir,entry.name);
      if(entry.isSymbolicLink())throw new Error('数据目录含符号链接，无法安全迁移 / Symbolic links are not supported');
      if(entry.isDirectory()){await fs.promises.mkdir(path.join(target,path.relative(source,file)),{recursive:true});await scan(file);}
      else if(!/daily-ai\.db-(wal|shm)$/.test(entry.name))files.push(file);
    }
  }
  database.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  await scan(source);
  let done=0;
  for(const file of files) {
    const destination=path.join(target,path.relative(source,file));
    await fs.promises.mkdir(path.dirname(destination),{recursive:true});
    await fs.promises.copyFile(file,destination,fs.constants.COPYFILE_EXCL);
    if(await hash(file)!==await hash(destination))throw new Error('文件校验失败 / File verification failed');
    onProgress({percent:Math.round(++done/files.length*90),done,total:files.length});
  }
  let next;
  try {
    next=new DailyAiDatabase(target);
    const result=next.db.prepare('PRAGMA quick_check').get();
    if(Object.values(result)[0]!=='ok')throw new Error('SQLite integrity check failed');
    const rows=next.db.prepare('SELECT id,html_path,original_path FROM reports').all();
    const relocate=file=>{
      if(!file)return null;
      if(!inside(source,path.resolve(file)))throw new Error('Report path is outside the data directory');
      return path.join(target,path.relative(source,file));
    };
    next.db.exec('BEGIN');
    try {
      const update=next.db.prepare('UPDATE reports SET html_path=?, original_path=? WHERE id=?');
      for(const row of rows)update.run(relocate(row.html_path),relocate(row.original_path),row.id);
      next.db.exec('COMMIT');
    }catch(error){next.db.exec('ROLLBACK');throw error;}
    await fs.promises.writeFile(`${configFile}.tmp`,JSON.stringify({dataDir:target}),'utf8');
    await fs.promises.rename(`${configFile}.tmp`,configFile);
    onProgress({percent:100,done,total:files.length});
    return {database:next,target,previous:source};
  } catch(error) {next?.close();throw error;}
}
module.exports={migrateData,deleteTrashedReport};
