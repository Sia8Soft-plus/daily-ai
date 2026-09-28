const {app}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DailyAiDatabase}=require('../main/database');
const {migrateData,deleteTrashedReport}=require('../main/storage-service');
app.whenReady().then(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'daily-ai-storage-'));
  const source=path.join(root,'source'),target=path.join(root,'target'),config=path.join(root,'location.json');
  let database=new DailyAiDatabase(source),next;
  try {
    fs.mkdirSync(path.join(source,'reports'));fs.mkdirSync(path.join(source,'trash'));
    const file=path.join(source,'reports','test.html');fs.writeFileSync(file,'<html>report</html>');
    database.insertReport({id:'test',title:'report',report_type:'daily',period_start:'2026-09-25',period_end:'2026-09-25',html_path:file,created_at:new Date().toISOString(),topic_revision:0});
    database.recordModelUsage({provider:'glm',model:'glm-5.3',usage:{prompt_tokens:120,completion_tokens:30,total_tokens:150}});
    database.recordModelUsage({provider:'custom',model:'other',usage:null});
    assert.equal(database.unreadCount(),0);assert(database.markUnread('test'));assert.equal(database.unreadCount(),1);
    await assert.rejects(migrateData({database,source,target:source,configFile:config}),/separate directory/);
    const moved=await migrateData({database,source,target,configFile:config});next=moved.database;
    assert.equal(JSON.parse(fs.readFileSync(config)).dataDir,target);
    assert.equal(next.getReport('test').html_path,path.join(target,'reports','test.html'));
    const {usageWindow}=require('../main/dashboard-stats');const usage=next.modelUsageStats(usageWindow());assert.equal(usage.today.calls,2);assert.equal(usage.today.tokens,150);assert.equal(usage.today.metered_calls,1);
    assert.equal(next.unreadCount(),1);next.markRead('test');assert.equal(next.unreadCount(),0);assert.equal(next.markUnread('test'),false,'Already delivered reports must not become unread again');
    const topic=next.addTopic({name:'测试最低数量',description:'检验最低条数的保存以及主题版本变化',min_items:7});
    assert.equal(topic.min_items,7);assert.equal(topic.region_preference,'global');assert(database.listTopics().every(t=>t.min_items===6));const revision=next.getTopicRevision();next.updateTopic(topic.id,{name:topic.name_zh,description:topic.description,min_items:8});assert(next.getTopicRevision()>revision);
    assert.throws(()=>next.updateTopic(topic.id,{name:topic.name_zh,description:topic.description,min_items:0}));
    const beforeRegion=next.getTopicRevision();const domestic=next.updateTopic(topic.id,{name:topic.name_zh,description:topic.description,region_preference:'domestic'});assert.equal(domestic.region_preference,'domestic');assert(next.getTopicRevision()>beforeRegion);
    assert.equal(fs.readFileSync(next.getReport('test').html_path,'utf8'),'<html>report</html>');
    assert(fs.existsSync(file),'Original backup retained');
    assert.throws(()=>deleteTrashedReport(next,target,'test'),/Trash first/);
    const trash=path.join(target,'trash','test.html');fs.renameSync(next.getReport('test').html_path,trash);
    next.markTrashed('test',trash,path.join(target,'reports','test.html'));
    deleteTrashedReport(next,target,'test');assert(!next.getReport('test'));assert(!fs.existsSync(trash));
    const occupied=path.join(root,'occupied');fs.mkdirSync(occupied);fs.writeFileSync(path.join(occupied,'keep'),'keep');
    await assert.rejects(migrateData({database,source,target:occupied,configFile:config}),/must be empty/);
    assert.equal(fs.readFileSync(path.join(occupied,'keep'),'utf8'),'keep');
    const {cleanup}=require('../main/retention');
    for(const [id,type,favorite]of [['expired','daily',false],['protected','daily',true],['digest','digest',false]]){
      const html=path.join(target,'reports',id+'.html');fs.writeFileSync(html,'<html>retention test</html>');next.insertReport({id,title:id,report_type:type,period_start:'2025-01-01',period_end:'2025-01-01',html_path:html,created_at:new Date().toISOString(),topic_revision:0});if(favorite)next.toggleFavorite(id);
    }
    const cleaned=cleanup(next,target,'2026-03-26');assert.equal(cleaned.moved,1);assert.equal(cleaned.failed.length,0);assert(next.getReport('expired').deleted_at);assert(!next.getReport('protected').deleted_at);assert(!next.getReport('digest').deleted_at);
    const {ActivityStore}=require('../main/activity');const activities=new ActivityStore(next);const notice=activities.add({key:'cleanup:test',kind:'cleanup',title:{zh:'完成',en:'Done'},body:{zh:'1份',en:'1 report'}});assert.equal(new ActivityStore(next).unread(),1);activities.read(notice.id);assert.equal(activities.unread(),0);
    console.log(JSON.stringify({verifiedMigration:true,reportPathsUpdated:true,sourceBackupPreserved:true,trashOnlyDeletion:true,occupiedDestinationProtected:true}));
  }finally{next?.close();database.close();assert(root.startsWith(os.tmpdir()+path.sep));fs.rmSync(root,{recursive:true,force:true});}
  app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
