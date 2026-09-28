const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const profile = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(),'daily-ai-single-instance-'));
app.setPath('userData', profile);
const lock = app.requestSingleInstanceLock();
if (process.argv[3] === 'second') {
  console.log(JSON.stringify({ secondGotLock:lock }));
  app.quit();
} else {
  assert.equal(lock,true,'First instance must get the lock');
  let secondInstanceSeen = false;
  app.on('second-instance', () => { secondInstanceSeen = true; });
  app.whenReady().then(() => new Promise((resolve,reject) => {
    const childEnvironment = { ...process.env };
    delete childEnvironment.ELECTRON_RUN_AS_NODE;
    const child = spawn(process.execPath,[__filename,profile,'second'],{env:childEnvironment,windowsHide:true});
    let stdout=''; let stderr='';
    child.stdout.on('data',chunk => { stdout += chunk; });
    child.stderr.on('data',chunk => { stderr += chunk; });
    child.on('error',reject);
    child.on('exit',code => resolve({code,stdout,stderr}));
  })).then(async result => {
    await new Promise(resolve => setTimeout(resolve,200));
    assert.equal(result.code,0,result.stderr);
    assert.match(result.stdout,/"secondGotLock":false/);
    assert.equal(secondInstanceSeen,true);
    console.log(JSON.stringify({secondInstanceRejected:true,firstInstanceNotified:true}));
    app.quit();
  }).catch(error => { console.error(error); app.exit(1); });
}
