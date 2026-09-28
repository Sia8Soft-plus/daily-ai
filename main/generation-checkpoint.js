const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {fingerprint}=require('./report-snapshot');
function checkpointKey({date,topics,model,language}) {
  return crypto.createHash('sha256').update(JSON.stringify([3,date,topics.map(fingerprint),model.provider,model.model,model.base_url,language])).digest('hex');
}
function readCheckpoint(dataDir,key,now=Date.now()) {
  try {
    const value=JSON.parse(fs.readFileSync(path.join(dataDir,'generation-checkpoint.json'),'utf8'));
    return value.version===1&&value.key===key&&now-value.createdAt>=0&&now-value.createdAt<30*60000?value:null;
  }catch{return null;}
}
function writeCheckpoint(dataDir,value) {
  const file=path.join(dataDir,'generation-checkpoint.json');
  try{fs.writeFileSync(`${file}.tmp`,JSON.stringify({...value,version:1}),'utf8');fs.renameSync(`${file}.tmp`,file);}catch(error){console.warn('[checkpoint]',error.code || 'WRITE_FAILED');}
}
module.exports={checkpointKey,readCheckpoint,writeCheckpoint};
