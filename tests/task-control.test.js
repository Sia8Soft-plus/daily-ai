const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {bounded,taskError}=require('../main/task-control');
const {callModel}=require('../main/glm-client');
const {translateReport}=require('../main/report-language');
const {GenerationService}=require('../main/generation-service');
const {checkpointKey,readCheckpoint,writeCheckpoint}=require('../main/generation-checkpoint');
const input={apiKey:'test',baseUrl:'https://example.org/v1',messages:[]};
test('checkpoints expire and cannot be reused for edited topics or another model',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'daily-ai-checkpoint-'));
  const spec={date:'2026-09-25',topics:[{id:'a',description:'agents'}],model:{provider:'test',model:'a'},language:'zh-CN'};
  try{
    const key=checkpointKey(spec);writeCheckpoint(dir,{key,createdAt:1000,edited:{report:{title:'ready'}}});
    assert(readCheckpoint(dir,key,2000));assert.equal(readCheckpoint(dir,key,1801000),null);
    assert.notEqual(checkpointKey({...spec,topics:[{id:'a',description:'vision'}]}),key);
    assert.notEqual(checkpointKey({...spec,model:{provider:'test',model:'b'}}),key);
  }finally{assert(dir.startsWith(os.tmpdir()+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});

test('hard deadline releases an operation that ignores abort',async()=>{
  await assert.rejects(bounded(()=>new Promise(()=>{}),20,{code:'STAGE_TIMEOUT'}),{code:'STAGE_TIMEOUT'});
});
test('model body hang times out; a fresh second attempt can succeed',async()=>{
  let count=0;const signals=[];
  const result=await callModel({...input,timeoutMs:20,retries:1,fetchImpl:async(_url,options)=>{
    signals.push(options.signal);count++;
    return {ok:true,json:()=>count===1?new Promise(()=>{}):Promise.resolve({choices:[{message:{content:'ready'}}]})};
  }});
  assert.equal(result.text,'ready');assert.equal(count,2);assert(signals[0].aborted);assert(!signals[1].aborted);
});
test('authentication errors do not retry, including translation fallback',async()=>{
  let count=0;
  await assert.rejects(callModel({...input,retries:3,fetchImpl:async()=>{count++;return {ok:false,status:401,json:async()=>({error:{message:'invalid key'}})};}}),{code:'AUTH'});
  assert.equal(count,1);count=0;
  await assert.rejects(translateReport({title:'report',sections:[]},'en-US',{},async()=>{count++;throw taskError('AUTH','invalid key');}),{code:'AUTH'});
  assert.equal(count,1);
});
test('cancelling generation releases the task and blocks a late result from publication',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'daily-ai-cancel-'));
  let release;let finished;let published=0;
  const terminal=new Promise(resolve=>finished=resolve);
  const database={listTopics:()=>[{id:'a',enabled:true}],findDailyReport:()=>null,latestDailyReport:()=>null,getDefaultModelRecord:()=>({credential_ref:'key'}),getTopicRevision:()=>1,getSetting:()=>({}),latestDailyReport:()=>null,setSetting:()=>{}};
  const service=new GenerationService({database,vault:{get:()=> 'test'},dataDir:dir,onComplete:()=>published++,onProgress:p=>{if(p.status==='cancelled')finished(p);},services:{planTopics:()=>new Promise(resolve=>release=resolve)}});
  try {
    assert.equal(service.start().status,'started');
    await new Promise(resolve=>setImmediate(resolve));
    service.cancel();
    const result=await bounded(()=>terminal,1000);
    assert.equal(result.status,'cancelled');assert.equal(service.running,false);
    release({expansions:[],warnings:[]});
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(published,0);assert(!fs.existsSync(path.join(dir,'reports')));
  }finally{assert(dir.startsWith(os.tmpdir()+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});

test('scheduled delivery remains interruptible after the report is prepared',()=>{
  const seen=[];
  const service=new GenerationService({database:{},vault:{},dataDir:os.tmpdir(),onProgress:state=>seen.push(state),onComplete:()=>{}});
  service.running=true;service.controller=new AbortController();service.taskId='scheduled-task';service.sequence=4;
  service.state={status:'running',stage:'等待交付',percent:99,taskId:service.taskId,sequence:4};
  service.deliveryTimer=setTimeout(()=>assert.fail('cancelled delivery timer fired'),30000);
  const result=service.cancel();
  assert.equal(result.status,'cancelled');assert.equal(result.sequence,5);
  assert.equal(service.controller.signal.aborted,true);assert.equal(service.deliveryTimer,null);
  assert.equal(seen.at(-1).status,'cancelled');
});

test('fast local rebuild starts after IPC reply and terminal sequence supersedes initial progress',async()=>{
  const database={listTopics:()=>[{id:'a',enabled:true}],findDailyReport:()=>null,latestDailyReport:()=>null,getDefaultModelRecord:()=>({credential_ref:'key'}),getTopicRevision:()=>1,setSetting:()=>{}};
  let finish;const completed=new Promise(resolve=>finish=resolve);
  const service=new GenerationService({database,vault:{},dataDir:os.tmpdir(),onProgress:p=>{if(p.status==='completed')finish(p);},onComplete:()=>{}});
  service.run=async function(){this.emit(45,'重组报告','Reusing unchanged topics');this.running=false;this.emit(100,'日报已生成','Ready',{status:'completed'});};
  const response=service.start();assert.equal(response.progress.percent,2);assert.equal(service.getState().percent,2);
  const end=await bounded(()=>completed,1000);assert.equal(end.taskId,response.progress.taskId);assert(end.sequence>response.progress.sequence);assert.equal(service.running,false);
});
