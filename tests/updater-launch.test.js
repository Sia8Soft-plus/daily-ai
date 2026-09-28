const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{execFileSync}=require('child_process');
const {createUpdater}=require('../main/updater');
test('Windows updater starts, authenticates handshake and preserves running parent', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'update-arm-')),profile=path.join(root,'profile'),target=path.join(root,'app'),id='job-'+crypto.randomUUID(),dir=path.join(profile,'updates',id),token='a'.repeat(48);fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(target);fs.writeFileSync(path.join(target,'Daily AI.exe'),'fixture');
 const job={product:'daily-ai',version:'0.3.0',token,target,dataDir:path.join(root,'reports'),userData:profile};for(const [name,value] of [['job.json',job],['prepared.json',{token,version:'0.3.0'}]])fs.writeFileSync(path.join(dir,name),JSON.stringify(value));fs.writeFileSync(path.join(profile,'updates','pending.json'),JSON.stringify({id,token}));fs.copyFileSync(path.resolve('main/updater-helper.ps1'),path.join(dir,'helper.ps1'));
 let quit=false;const service=createUpdater({app:{isPackaged:true,getVersion:()=> '0.2.12',getPath:k=>k==='exe'?path.join(target,'Daily AI.exe'):profile},getDataDir:()=>job.dataDir,isBusy:()=>false,quit:()=>{quit=true;}});
 try{await service.recoverStartup();assert.equal(service.state().status,'ready');await service.install();const armed=JSON.parse(fs.readFileSync(path.join(dir,'armed.json')));assert.equal(armed.token,token);process.kill(armed.pid);await new Promise(r=>setTimeout(r,250));assert.equal(quit,true);}finally{service.stop();fs.rmSync(root,{recursive:true,force:true});}
});
test('Windows helper can survive launcher exit without detached console', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'update-survive-')),marker=path.join(root,'alive');
 const script=path.join(root,'helper.ps1');fs.writeFileSync(script,`param($JobFile,$Phase) Start-Sleep -Milliseconds 500;[IO.File]::WriteAllText('${marker.replace(/'/g,"''")}','alive')`);
 execFileSync(process.execPath,['-e',`require(${JSON.stringify(path.resolve('main/updater.js'))}).launchHelper(${JSON.stringify(script)},${JSON.stringify(path.join(root,'job.json'))},'Prepare').catch(e=>{console.error(e);process.exitCode=1});`]);
 try{for(let i=0;i<100&&!fs.existsSync(marker);i++)await new Promise(r=>setTimeout(r,100));assert.equal(fs.readFileSync(marker,'utf8'),'alive');}finally{fs.rmSync(root,{recursive:true,force:true});}
});
