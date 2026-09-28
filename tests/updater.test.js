const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {compare,owned,validateRelease}=require('../main/update-package'),{createUpdater}=require('../main/updater');
const release=version=>({schemaVersion:1,platform:'windows-x64',version,bytes:3,sha256:'a'.repeat(64),downloadPath:'download/windows-portable?version='+version});
function fixture(t,fetchImpl,options={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'daily-update-unit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const events=[],notices=[];const service=createUpdater({app:{isPackaged:true,getVersion:()=> '0.2.12',getPath:k=>k==='exe'?path.join(root,'app','Daily AI.exe'):path.join(root,'user')},getDataDir:()=>path.join(root,'reports'),isBusy:()=>false,onState:s=>events.push(s),onAvailable:v=>notices.push(v),quit:()=>assert.fail('must not quit'),platform:'win32',arch:'x64',fetchImpl,...options});t.after(()=>service.stop());return{service,root,events,notices};}
test('semantic versions never downgrade or offer same-version automatic reinstall',()=>{assert(compare('0.10.0','0.2.12')>0);assert.equal(compare('0.2.12','0.2.12'),0);assert(compare('0.2.11','0.2.12')<0);assert.throws(()=>compare('0.3.0-beta','0.2.12'));});
test('release metadata restricts package size, digest, path and platform',()=>{assert.equal(validateRelease(release('0.3.0')).version,'0.3.0');for(const change of [{downloadPath:'https://evil.test/app.zip'},{sha256:''},{bytes:2147483648},{platform:'linux'},{version:'../bad'}])assert.throws(()=>validateRelease({...release('0.3.0'),...change}));});
test('managed file rules exclude data, credentials and directory traversal',()=>{for(const file of ['data/report.html','credentials.json','install-settings.json','../Daily AI.exe','resources/../app.asar','resources\\app.asar','C:/evil.exe'])assert.equal(owned(file),false,file);for(const file of ['Daily AI.exe','resources/app.asar','locales/zh-CN.pak','resources/app.asar.unpacked/assets/icon.ico'])assert.equal(owned(file),true,file);});
test('checking does not download automatically; newer version announces once; equal and older do not',async t=>{let current='0.3.0',calls=0;const f=fixture(t,async()=>{calls++;return Response.json(release(current));});assert.equal((await f.service.check()).status,'available');assert.equal(calls,1);assert.equal(fs.existsSync(path.join(f.root,'user','updates')),false);await f.service.check();assert.equal(f.notices.length,1);current='0.2.12';assert.equal((await f.service.check()).status,'upToDate');current='0.2.1';assert.equal((await f.service.check()).status,'upToDate');});
test('corrupted download never becomes installable and leaves user assets intact',async t=>{let calls=0;const f=fixture(t,async()=>++calls===1?Response.json(release('0.3.0')):new Response('bad',{headers:{'content-length':'3'}}));fs.mkdirSync(path.join(f.root,'reports'));fs.writeFileSync(path.join(f.root,'reports','report.html'),'keep');await f.service.check();assert.equal((await f.service.download()).status,'failed');assert.equal(fs.readFileSync(path.join(f.root,'reports','report.html'),'utf8'),'keep');assert.deepEqual(fs.readdirSync(path.join(f.root,'user','updates')),[]);await assert.rejects(f.service.install());});
test('unavailable metadata is a recoverable state and does not replace existing files',async t=>{const f=fixture(t,async()=>{throw Error('offline');});assert.equal((await f.service.check()).status,'failed');assert.equal(f.service.state().message,'offline');});

for(const mode of ['cancel','stall','deadline'])test('download '+mode+' terminates with the correct status and no user-data changes',async t=>{
 let calls=0,started;const ready=new Promise(r=>started=r);
 const f=fixture(t,async()=>{if(++calls===1)return Response.json(release('0.3.0'));return {ok:true,headers:new Headers({'content-length':'3'}),body:{getReader:()=>({read:()=>{started();return new Promise(()=>{});},cancel:()=>Promise.resolve()})}};},{idleTimeoutMs:mode==='stall'?20:5000,downloadTimeoutMs:mode==='deadline'?20:5000});
 await f.service.check();const pending=f.service.download();await ready;if(mode==='cancel')f.service.cancel();const result=await pending;
 assert.equal(result.status,mode==='cancel'?'available':'failed');assert.match(result.message,mode==='cancel'?/cancelled/:mode==='stall'?/stalled/:/timed out/);assert.deepEqual(fs.readdirSync(path.join(f.root,'user','updates')),[]);
});

test('relocated install and profile roots resolve through junctions without creating paths',t=>{
 const {canonicalPath}=require('../main/updater');const root=fs.mkdtempSync(path.join(os.tmpdir(),'update-junction-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const real=path.join(root,'real'),alias=path.join(root,'alias');fs.mkdirSync(real);fs.symlinkSync(real,alias,'junction');
 assert.equal(canonicalPath(path.join(alias,'updates','job')),path.join(fs.realpathSync.native(real),'updates','job'));
 assert.equal(fs.existsSync(path.join(real,'updates')),false);
});

test('automatic checks start immediately, repeat, and stop cleanly',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;return Response.json(release('0.3.0'));},{checkIntervalMs:20});
 f.service.start();f.service.start();await new Promise(r=>setTimeout(r,75));assert(calls>=2);f.service.stop();const count=calls;await new Promise(r=>setTimeout(r,50));assert.equal(calls,count);assert.equal(f.notices.length,1);
});
