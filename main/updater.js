const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const {compare,validateRelease}=require('./update-package');
const {abortable}=require('./task-control');
const BASE='https://www.ai4indus.com/daily-ai/';
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return null;}};
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(file+'.tmp',file);}
// Resolve relocated profile/install roots while leaving internal link checks intact.
function canonicalPath(file){let current=path.resolve(file),suffix=[];for(;;){try{return path.join(fs.realpathSync.native(current),...suffix);}catch(e){if(e.code!=='ENOENT')throw e;const parent=path.dirname(current);if(parent===current)throw e;suffix.unshift(path.basename(current));current=parent;}}}
async function launchHelper(script,jobFile,phase){
 const quote=value=>"'"+String(value).replace(/'/g,"''")+"'";
 const encoded=Buffer.from('& '+quote(script)+' -JobFile '+quote(jobFile)+' -Phase '+quote(phase)+'; exit $LASTEXITCODE','utf16le').toString('base64');
 const command='$p=Start-Process -FilePath '+quote(path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'))+' -WindowStyle Hidden -ArgumentList '+quote('-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand '+encoded)+' -RedirectStandardOutput '+quote(path.join(path.dirname(jobFile),'helper-stdout.log'))+' -RedirectStandardError '+quote(path.join(path.dirname(jobFile),'helper-stderr.log'))+' -PassThru; Write-Output $p.Id';
 const result=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:30000,maxBuffer:65536});
 const pid=Number(result.stdout.trim());if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid updater process ID');return pid;
}
function createUpdater({app,getDataDir,isBusy,onState=()=>{},onAvailable=()=>{},quit,fetchImpl=fetch,base=BASE,platform=process.platform,arch=process.arch,downloadTimeoutMs=1200000,idleTimeoutMs=60000,checkIntervalMs=6*3600000}){
 const root=path.join(canonicalPath(app.getPath('userData')),'updates'),pendingFile=path.join(root,'pending.json');
 let state={status:'idle',currentVersion:app.getVersion(),percent:0},release=null,job=null,controller=null,installing=false,timer=null,lastNotice='';
 const emit=patch=>{state={...state,...patch};onState({...state});};
 const supported=()=>platform==='win32'&&arch==='x64'&&app.isPackaged;
 function pending(){const p=read(pendingFile);if(!p||!/^job-[a-f0-9-]{36}$/.test(p.id))return null;const file=path.join(root,p.id,'job.json'),value=read(file);if(!value||value.product!=='daily-ai'||value.token!==p.token||canonicalPath(value.target)!==canonicalPath(path.dirname(app.getPath('exe'))))return null;return{file,dir:path.dirname(file),value};}
 function helper(p,phase,options={}){return spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(p.dir,'helper.ps1'),'-JobFile',p.file,'-Phase',phase],{windowsHide:true,...options});}
 async function arm(p,phase){
  fs.rmSync(path.join(p.dir,'armed.json'),{force:true});fs.rmSync(path.join(p.dir,'error.json'),{force:true});p.value.parentPid=process.pid;write(p.file,p.value);
  const childPid=await launchHelper(path.join(p.dir,'helper.ps1'),p.file,phase);
  for(let i=0;i<300;i++){
   const armed=read(path.join(p.dir,'armed.json'));
   if(armed?.token===p.value.token&&armed.pid===childPid)return;
   let alive=true;try{process.kill(childPid,0);}catch{alive=false;}if(!alive){const failure=read(path.join(p.dir,'error.json'));throw Error('更新程序启动失败 / Updater exited: '+(failure?.message||'see helper-stderr.log'));}
   await new Promise(r=>setTimeout(r,100));
  }
  try{process.kill(childPid);}catch{}throw Error('更新程序启动超时，请重试 / Updater startup timed out; retry');
 }
 async function recoverStartup(){const p=pending();if(!p)return false;const tx=read(path.join(p.dir,'transaction.json')),result=read(path.join(p.dir,'result.json'));if(result){if(result.status==='rolled-back'||result.status==='recovered')emit({status:'failed',message:'上次更新已恢复旧版，用户数据未改变 / Previous update recovered; your data is unchanged.'});return false;}if(process.argv.includes('--daily-ai-update-ack='+p.value.token))return false;if(!tx&&read(path.join(p.dir,'prepared.json'))?.token===p.value.token&&compare(p.value.version,app.getVersion())>0){job=p;emit({status:'ready',version:p.value.version,percent:100});return false;}if(['applying','awaiting-start','committed'].includes(tx?.phase)){const armed=read(path.join(p.dir,'armed.json'));let running=false;try{if(Number.isInteger(armed?.pid)){process.kill(armed.pid,0);running=true;try{const info=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);(Get-CimInstance Win32_Process -Filter 'ProcessId=${armed.pid}').CommandLine`],{windowsHide:true,timeout:5000});running=info.stdout.includes(path.join(p.dir,'helper.ps1'));}catch{}}}catch{}if(running)throw Error('更新正在进行，请等待新版自动打开 / Update in progress. Please wait.');installing=true;await arm(p,'Recover');quit();return true;}return false;}
 function acknowledge(){const p=pending();if(p&&process.argv.includes('--daily-ai-update-ack='+p.value.token)&&p.value.version===app.getVersion())write(path.join(p.dir,'ack.json'),{token:p.value.token,version:app.getVersion(),pid:process.pid});}
 async function check({silent=false}={}){
  if(['checking','downloading','verifying','ready','installing'].includes(state.status))return state;
  if(!supported()){if(!silent)emit({status:'unsupported',message:'请在 Windows x64 正式版中使用自动更新 / Automatic updates require the packaged Windows x64 app.'});return state;}
  emit({status:'checking',message:'',percent:0});
  try{const response=await fetchImpl(new URL('api/update/windows-x64',base),{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('暂时无法检查更新，请稍后重试 / Update service unavailable. Please retry.');release=validateRelease(await response.json());const available=compare(release.version,app.getVersion())>0;emit({status:available?'available':'upToDate',version:release.version,bytes:release.bytes,percent:0});if(available&&lastNotice!==release.version){lastNotice=release.version;onAvailable(release.version);}return state;}catch(e){emit({status:'failed',message:e.message});return state;}
 }
 async function download(){
  if(!supported())throw Error('Automatic update is unavailable');if(!['available','failed'].includes(state.status)||!release||compare(release.version,app.getVersion())<=0)throw Error('请先检查新版本 / Check for a newer version first');if(controller)throw Error('Download already running');
  controller=new AbortController();const active=controller,deadline=setTimeout(()=>active.abort(Error('下载超时，请重试 / Download timed out; retry')),downloadTimeoutMs),id='job-'+crypto.randomUUID(),dir=path.join(root,id),file=path.join(dir,'job.json');
  job={dir,file,value:{product:'daily-ai',version:release.version,sha256:release.sha256,token:crypto.randomBytes(24).toString('hex'),target:canonicalPath(path.dirname(app.getPath('exe'))),dataDir:canonicalPath(getDataDir()),userData:canonicalPath(app.getPath('userData')),parentPid:process.pid}};
  let handle,reader;
  try{
   fs.mkdirSync(dir,{recursive:true});write(file,job.value);fs.copyFileSync(path.join(__dirname,'updater-helper.ps1'),path.join(dir,'helper.ps1'));emit({status:'downloading',percent:0,received:0,message:''});
   const response=await fetchImpl(new URL(release.downloadPath,base),{redirect:'error',signal:active.signal});if(!response.ok)throw Error('发布包已更新或下载不可用，请重新检查 / Release changed or download unavailable; check again');if(Number(response.headers.get('content-length'))!==release.bytes)throw Error('Package size mismatch');
   handle=await fs.promises.open(path.join(dir,'download.zip'),'wx');reader=response.body.getReader();const hash=crypto.createHash('sha256');let received=0,last=0;
   for(;;){let idle;const item=await Promise.race([abortable(()=>reader.read(),active.signal),new Promise((_,reject)=>{idle=setTimeout(()=>{const error=Error('下载连接长时间无响应，请重试 / Download stalled; retry');active.abort(error);reject(error);},idleTimeoutMs);})]).finally(()=>clearTimeout(idle));if(item.done)break;received+=item.value.length;if(received>release.bytes)throw Error('Package size mismatch');hash.update(item.value);await handle.writeFile(item.value);if(Date.now()-last>150){last=Date.now();emit({received,percent:Math.floor(received/release.bytes*90)});}}
   await handle.close();handle=null;if(received!==release.bytes||hash.digest('hex')!==release.sha256)throw Error('安装包校验失败，请重新下载 / Package verification failed. Download again.');
   emit({status:'verifying',percent:92});await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(dir,'helper.ps1'),'-JobFile',file,'-Phase','Prepare'],{windowsHide:true,signal:active.signal,timeout:300000,maxBuffer:65536});write(pendingFile,{id,token:job.value.token});emit({status:'ready',percent:100});return state;
  }catch(e){reader?.cancel().catch(()=>{});if(handle)await handle.close().catch(()=>{});emit({status:active.signal.reason?.code==='USER_CANCELLED'?'available':'failed',percent:0,message:active.signal.reason?.code==='USER_CANCELLED'?'下载已取消，可重新下载 / Download cancelled; you can retry.':(active.signal.reason?.message||e.message).slice(0,400)});
   // Only this generated job directory may be removed; user data is outside it.
   const expected=path.resolve(root,id);if(path.resolve(dir)===expected&&path.dirname(expected)===path.resolve(root))fs.rmSync(expected,{recursive:true,force:true});job=null;return state;
  }finally{clearTimeout(deadline);controller=null;}
 }
 function cancel(){controller?.abort(Object.assign(Error('User cancelled'),{code:'USER_CANCELLED'}));return state;}
 async function install(){if(state.status!=='ready'||!job)throw Error('请先下载新版 / Download the update first');if(isBusy())throw Error('请先完成日报生成、迁移或其他操作 / Finish generation, migration and other operations first');installing=true;emit({status:'installing'});try{const probe=path.join(job.value.target,'.daily-ai-write-'+crypto.randomBytes(6).toString('hex'));fs.writeFileSync(probe,'');fs.unlinkSync(probe);job.value.dataDir=canonicalPath(getDataDir());await arm(job,'Apply');setTimeout(quit,150);return state;}catch(e){installing=false;emit({status:'ready',message:e.message});throw e;}}
 function start(){if(timer)return;check({silent:true});timer=setInterval(()=>check({silent:true}),checkIntervalMs);timer.unref();}
 function stop(){clearTimeout(timer);clearInterval(timer);timer=null;controller?.abort();}
 return{check,download,cancel,install,recoverStartup,acknowledge,start,stop,get installing(){return installing;},state:()=>({...state})};
}
module.exports={createUpdater,canonicalPath,launchHelper};
