const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
app.setPath('userData',require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(),'daily-ai-ui-profile-')));

const report = { id:'sample-report', title:'AI Progress Daily', report_type:'daily', period_start:'2026-09-24', period_end:'2026-09-24', created_at:'2026-09-24T09:00:00+08:00', is_favorite:false };
const topic = { id:'agents-llm', name_zh:'AI 智能体与大模型', name_en:'AI agents & LLMs', description:'模型、推理、训练、工具调用、评测与应用架构', enabled:1 };
let reportHtml='<!doctype html><html lang="zh-CN"><head></head><body><main><header><h1>AI Progress Daily</h1><p class="lead">A dense old summary without paragraphs.</p></header><section><h2>Agents</h2><article class="item"><h3>Agent runtimes gained recovery checkpoints</h3><p>中文测试。Failure recovery is easier. Additional details.</p></article></section></main></body></html>';
let translationCalls=0;
let trash=[{...report,id:'trash-test',deleted_at:new Date().toISOString()}];
let emptyCalls=0,chooseCalls=0,cancelCalls=0,dataPath='C:\\Daily-AI-Test';
let generationState={status:'idle'};let digestPayload=null,clearActivityCalls=0;
const readReports=[];
const wrap = data => ({ ok:true, data });
const routes = {
    'update:healthy':()=>true,
    'update:state':()=>({status:'idle',currentVersion:'0.2.12'}),
  'account:activity':()=>({}),
  'account:state':()=>({user:null,plans:[],mode:'local',hasSession:false}),
  'search:getConfig':()=>({exaConfigured:false}),
  'search:saveConfig':()=>({exaConfigured:true}),
  'dashboard:getStats':()=>({documents:{total:1,daily:1,digest:0,favorites:0,htmlBytes:2048,indexBytes:4096,missing:0},modelUsage:{today:{calls:2,metered_calls:1,tokens:1250},month:{calls:5,metered_calls:3,tokens:4700}},cleanup:{enabled:true,at:'2026-09-27T03:30:00+08:00',retentionMonths:6,cleanupTime:'03:30'}}),
  'activity:list':()=>[],
  'activity:read':()=>[],
  'activity:clear':()=>{clearActivityCalls++;return [];},
  'digest:preview':(_event,{start,end})=>start>end?[]:[{...report,id:'digest-first',available:true},{...report,id:'digest-second',title:'Second source report',is_favorite:true,available:true}],
  'digest:create':(_event,payload)=>{digestPayload=payload;return {status:'started',progress:{taskId:'digest-test',sequence:1,status:'running',percent:8,stage:'读取原日报',detail:'Reading reports'}};},
  'window:cancelQuit':()=>true,
  'window:confirmQuit':()=>true,
  'bootstrap:get':() => ({ appVersion:'9.8.7-test', settings:{ language:'zh-CN', theme:'system', frequency:'daily', time:'09:00', weekdays:[1], scheduleEnabled:true }, reports:[report], trash, topics:[topic], models:[], dataPath }),
  'reports:list':()=>[report],
  'reports:markRead':(_event,{id})=>{readReports.push(id);return 0;},
  'theme:set':(_event,value)=>value,
  'topics:list':()=>[topic],
  'topics:update':(_event,payload)=>{Object.assign(topic,{min_items:payload.min_items,region_preference:payload.region_preference});return topic;},
  'reports:trash:list':()=>trash,
  'reports:emptyTrash':()=>{emptyCalls++;trash=[];return {deleted:1,failed:[]};},
  'storage:chooseDirectory':()=>{chooseCalls++;return 'D:\\Daily-AI-New';},
  'storage:migrate':(_event,{target})=>{const previousPath=dataPath;dataPath=target;return {dataPath,previousPath};},
  'models:catalog':() => [],
  'reports:getContent':() => ({ report, html:reportHtml }),
  'reports:translateTexts':(_event,{texts}) => {translationCalls++;return texts.map(text=>text.replace('中文测试','English translation'));},
  'reports:saveBilingual':(_event,payload)=>payload.translatedHtml,
  'generation:getState':() => generationState,
  'generation:cancel':()=>{cancelCalls++;return {taskId:'scheduled-test',sequence:2,status:'cancelled',percent:99,stage:'已取消',updatedAt:new Date().toISOString()};},
  'schedule:getStatus':() => ({dueAt:new Date(2026,8,25,9,0).getTime(),startAt:new Date(2026,8,25,8,50).getTime()}),
  'tabs:saveState':() => true,
  'settings:update':(_event, settings) => settings
};
Object.entries(routes).forEach(([channel, handler]) => ipcMain.handle(channel, (event, payload) => wrap(handler(event,payload))));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show:false, webPreferences:{ preload:path.join(__dirname,'../preload.js'), contextIsolation:true, sandbox:true,backgroundThrottling:false,offscreen:Boolean(process.env.DAILY_AI_CAPTURE) } });
  await win.loadFile(path.join(__dirname,'../renderer/index.html'));
  await new Promise(resolve => setTimeout(resolve,350));
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#appVersion').textContent`),'v9.8.7-test');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.topbar .github-link').href`),'https://github.com/Sia8Soft-plus/daily-ai');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#appVersion').click();document.querySelector('#modal-about').classList.contains('open')`),true);
  await win.webContents.executeJavaScript(`document.querySelector('#modal-about [data-close]').click()`);
  const result = await win.webContents.executeJavaScript(`(async () => {
    const q = selector => document.querySelector(selector);
    const top = q('#view-home').firstElementChild?.id === 'latestReportCard';
    const preview = q('#latestReportHook').textContent;
    const linked = q('#latestReportOpen').dataset.reportOpen;
    q('#latestReportOpen').click();
    await new Promise(resolve => setTimeout(resolve,100));
    const tabOpened = !!q('.tab[data-pane="report-sample-report"]');
    const oldReportReformatted = q('.view[data-pane="report-sample-report"] iframe')?.srcdoc.includes('<section class="highlights">');
    q('#languageToggle').click();
    await new Promise(resolve => setTimeout(resolve,300));
    const translatedReport=q('.view[data-pane="report-sample-report"] iframe')?.srcdoc.includes('English translation');
    const walker = document.createTreeWalker(q('#view-home'),NodeFilter.SHOW_TEXT);
    const untranslated=[]; let node;
    while (node=walker.nextNode()) { const text=node.nodeValue.trim(); if (/[\\u3400-\\u9fff]/u.test(text)) untranslated.push(text.slice(0,80)); }
    const screenChinese={};
    for(const name of ['favorites','library','trash','settings']) {
      const root=q('#view-'+name);const scan=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let part;
      screenChinese[name]=[];
      while(part=scan.nextNode()) { const value=part.nodeValue.trim();if(/[\\u3400-\\u9fff]/u.test(value)) screenChinese[name].push(value.slice(0,70)); }
    }
    const modalChinese=[];
    for(const root of document.querySelectorAll('.overlay')) {
      const scan=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let part;
      while(part=scan.nextNode()) {const value=part.nodeValue.trim();if(/[\\u3400-\\u9fff]/u.test(value))modalChinese.push(value.slice(0,70));}
    }
    const attributeChinese=[];
    for(const el of document.querySelectorAll('[title],[aria-label],[placeholder]')) for(const attr of ['title','aria-label','placeholder']) {
      const value=el.getAttribute(attr);
      if(value && /[\\u3400-\\u9fff]/u.test(value) && el.id!=='languageToggle') attributeChinese.push({attr,value});
    }
    return { top, preview, linked, tabOpened, oldReportReformatted, translatedReport, language:document.documentElement.lang, month:q('#historyMonth option').textContent, topicButton:q('#settingsTopicList [data-topic-edit]').textContent, latestTitle:q('[data-i18n="latest.title"]').textContent, untranslated,screenChinese,modalChinese,attributeChinese };
  })()`);
  assert.equal(result.top,true);
  const realStats=await win.webContents.executeJavaScript(`({sidebar:document.querySelector('#sidebarDocumentSize').textContent,daily:document.querySelector('#homeDailyCount').textContent,tokens:document.querySelector('#todayModelTokens').textContent,calls:document.querySelector('#monthlyModelCalls').textContent,activity:document.querySelector('#homeActivityList').textContent})`);
  assert.equal(realStats.sidebar,'2.0 KB');assert.equal(realStats.daily,'1 daily report');assert.equal(realStats.tokens,'1,250+');assert.equal(realStats.calls,'5 calls');assert(!realStats.activity.includes('09:02'));
  assert.match(result.preview,/Agent runtimes gained recovery checkpoints/);
  assert.equal(result.linked,report.id);
  assert.equal(result.tabOpened,true);
  assert.equal(result.oldReportReformatted,true);
  assert.equal(result.translatedReport,true);
  assert.equal(result.language,'en');
  assert.equal(result.month,'All months');
  assert.equal(result.topicButton,'Edit');
  assert.equal(result.latestTitle,'Latest report');
  assert.deepEqual(result.untranslated,[],'Home UI should be English after switching language');
  assert.deepEqual(result.screenChinese,{favorites:[],library:[],trash:[],settings:[]},'Static screens should contain no untranslated Chinese');
  assert.deepEqual(result.modalChinese,[],'Dialog copy should contain no untranslated Chinese');
  assert.deepEqual(result.attributeChinese,[],'Tooltips and accessible labels should contain no untranslated Chinese');
  const beforeBilingual=translationCalls;
  reportHtml='<!doctype html><html lang="zh-CN" data-bilingual="true"><head><style>body:has(#daily-lang-zh:checked) #daily-report-en,body:has(#daily-lang-en:checked) #daily-report-zh{display:none}</style></head><body><input id="daily-lang-zh" type="radio" name="lang" checked><input id="daily-lang-en" type="radio" name="lang"><div id="daily-report-zh"><main><section class="highlights"><strong>中文重点</strong></section></main></div><div id="daily-report-en"><main><section class="highlights"><strong>English highlight</strong></section></main></div></body></html>';
  const bilingual=await win.webContents.executeJavaScript(`(async()=>{document.querySelector('#latestReportOpen').click();await new Promise(resolve=>setTimeout(resolve,80));const html=document.querySelector('.view[data-pane="report-sample-report"] iframe').srcdoc;return {english:html.includes('id="daily-lang-en" type="radio" name="lang" checked'),both:html.includes('English highlight')&&html.includes('中文重点')}})()`);
  assert.equal(bilingual.english,true);
  assert.equal(bilingual.both,true);
  assert.equal(translationCalls,beforeBilingual,'Bilingual report must switch without model translation');
  const interaction=await win.webContents.executeJavaScript(`(async()=>{
    const q=s=>document.querySelector(s);
    q('#historyMonthButton').click();
    const monthOpen=q('#historyMonthMenu').matches(':popover-open');
    q('[data-history-month="2026-09"]').click();
    const monthSelected=q('#historyMonth').value==='2026-09'&&!q('#historyMonthMenu').matches(':popover-open');
    q('#emptyTrash').click();
    const confirmed=q('#modal-confirm').classList.contains('open');
    q('#confirmAction').click();await new Promise(r=>setTimeout(r,100));
    const emptyDisabled=q('#emptyTrash').disabled;
    q('#chooseDataDirectory').click();await new Promise(r=>setTimeout(r,80));
    const selectedPath=q('#newDataDirectory').value;
    q('#startMigration').click();await new Promise(r=>setTimeout(r,150));
    return {monthOpen,monthSelected,confirmed,emptyDisabled,selectedPath,currentPath:q('#currentDataDirectory').value};
  })()`);
  assert.equal(interaction.monthOpen,true);assert.equal(interaction.monthSelected,true);assert.equal(interaction.confirmed,true);assert.equal(interaction.emptyDisabled,true);
  assert.equal(interaction.currentPath,'D:\\Daily-AI-New');assert.equal(interaction.selectedPath,interaction.currentPath);
  assert.equal(emptyCalls,1);assert.equal(chooseCalls,1);
  const appearance=await win.webContents.executeJavaScript(`(async()=>{
    const q=s=>document.querySelector(s);
    q('[data-theme-value="dark"]').click();
    const dark={icon:q('#themeQuick use').getAttribute('href'),background:getComputedStyle(document.body).backgroundColor,margin:getComputedStyle(q('.app-shell')).margin};
    q('#themeQuick').click();
    const light={icon:q('#themeQuick use').getAttribute('href'),background:getComputedStyle(document.body).backgroundColor,border:getComputedStyle(q('.app-shell')).borderTopWidth};
    q('#homeTopicList [data-topic-edit]').click();q('#topicMinimum').value='8';q('#topicRegion').value='domestic';q('#saveTopic').click();await new Promise(r=>setTimeout(r,100));
    return {dark,light,minimum:q('#homeTopicList small').textContent};
  })()`);
  assert.equal(appearance.dark.icon,'#i-sun');assert.equal(appearance.light.icon,'#i-moon');
  assert.equal(appearance.dark.background,'rgb(32, 33, 31)');assert.equal(appearance.light.background,'rgb(246, 243, 236)');
  assert.equal(appearance.dark.margin,'0px');assert.equal(appearance.light.border,'0px');
  assert.equal(topic.min_items,8);assert.equal(topic.region_preference,'domestic');assert.match(appearance.minimum,/8/);assert(readReports.length>0);assert(readReports.every(id=>id===report.id));
  await win.webContents.executeJavaScript(`document.querySelector('[data-language-value="en"]').click();`);
  win.webContents.send('window:requestQuit');
  await new Promise(r=>setTimeout(r,50));
  const quit=await win.webContents.executeJavaScript(`(()=>{const modal=document.querySelector('#modal-quit');const result={open:modal.classList.contains('open'),copy:document.querySelector('#quitMessage').textContent,focused:document.activeElement.id};document.querySelector('#quitCancel').click();return {...result,closed:!modal.classList.contains('open')};})()`);
  assert(quit.open&&quit.closed);assert.equal(quit.focused,'quitCancel');assert.match(quit.copy,/no longer receive/);
  win.webContents.send('activity:changed',[{id:'notice-test',title:{zh:'清理完成',en:'Cleanup finished'},body:{zh:'一份文档',en:'One report'},read:false,createdAt:new Date().toISOString()}]);
  await new Promise(r=>setTimeout(r,60));
  const activity=await win.webContents.executeJavaScript(`(async()=>{const q=s=>document.querySelector(s);q('#activityButton').click();const result={count:q('#activityCount').textContent,visible:!q('#activityCount').hidden,body:q('#activityList').textContent,open:q('#modal-activity').classList.contains('open')};q('#activityReadAll').click();await new Promise(r=>setTimeout(r,50));return {...result,cleared:q('#activityCount').hidden};})()`);
  assert.equal(activity.count,'1');assert(activity.visible&&activity.open&&activity.cleared);assert.match(activity.body,/Cleanup finished/);
  win.setSize(820,620);
  win.webContents.send('activity:changed',Array.from({length:30},(_,i)=>({id:`long-${i}`,title:{en:`Search update ${i}`,zh:`检索动态 ${i}`},body:{en:'https://example.org/'+('long-details'.repeat(45)),zh:'长错误详情'.repeat(90)},read:false,createdAt:new Date().toISOString()})));
  await new Promise(r=>setTimeout(r,80));
  const activityLayout=await win.webContents.executeJavaScript(`(()=>{const list=document.querySelector('#activityList'),modal=list.closest('.modal'),article=list.querySelector('article');return {scrolls:list.scrollHeight>list.clientHeight,fits:modal.getBoundingClientRect().bottom<=innerHeight,noOverflow:article.scrollWidth<=article.clientWidth,footerVisible:document.querySelector('#activityReadAll').getBoundingClientRect().bottom<=innerHeight};})()`);
  assert.deepEqual(activityLayout,{scrolls:true,fits:true,noOverflow:true,footerVisible:true});
  if(process.env.DAILY_AI_CAPTURE_ACTIVITY)require('node:fs').writeFileSync(process.env.DAILY_AI_CAPTURE_ACTIVITY,(await win.webContents.capturePage()).toPNG());
  win.setSize(1200,820);
  await win.webContents.executeJavaScript(`document.querySelector('#modal-activity [data-close]').click();`);
  win.webContents.send('generation:progress',{taskId:'scheduled-test',sequence:1,status:'running',percent:99,stage:'等待交付',detail:'Ready for delivery',updatedAt:new Date().toISOString()});
  await new Promise(r=>setTimeout(r,60));
  const waiting=await win.webContents.executeJavaScript(`(()=>{const panel=document.querySelector('#generationProgress');document.querySelector('#generationProgressToggle').click();const cancel=document.querySelector('#generationHeaderCancel');const visible=!panel.hidden&&panel.classList.contains('collapsed')&&getComputedStyle(cancel).display!=='none';cancel.click();return visible;})()`);
  await new Promise(r=>setTimeout(r,60));
  const cancelled=await win.webContents.executeJavaScript(`document.querySelector('#generationProgress').classList.contains('completed')`);
  assert(waiting&&cancelled&&cancelCalls===1,'Collapsed scheduled task must cancel the backing task');
  await win.webContents.executeJavaScript(`document.querySelector('#generationProgressToggle').click();`);
  win.webContents.send('generation:progress',{taskId:'completed-one',sequence:1,status:'running',percent:94,stage:'保存报告',detail:'Saving',updatedAt:new Date().toISOString()});
  await new Promise(r=>setTimeout(r,60));
  generationState={taskId:'completed-one',sequence:2,status:'completed',percent:100,stage:'日报已生成',detail:'Saved',updatedAt:new Date().toISOString()};
  await new Promise(r=>setTimeout(r,4300));
  const manualClose=await win.webContents.executeJavaScript(`(()=>{const panel=document.querySelector('#generationProgress');const shown=!panel.hidden;document.querySelector('#generationProgressClose').click();return shown&&panel.hidden;})()`);
  assert.equal(manualClose,true,'A completed task must be manually dismissible');
  win.webContents.send('generation:progress',{taskId:'completed-two',sequence:1,status:'completed',percent:100,stage:'日报已生成',detail:'Saved again',updatedAt:new Date(Date.now()+1000).toISOString()});
  await new Promise(r=>setTimeout(r,5200));
  const autoDismissed=await win.webContents.executeJavaScript(`document.querySelector('#generationProgress').hidden`);
  assert.equal(autoDismissed,true,'A completed task must dismiss itself');
  const controls=await win.webContents.executeJavaScript(`(async()=>{
    const q=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)],pause=()=>new Promise(r=>setTimeout(r,70));
    all('.overlay.open').forEach(el=>el.classList.remove('open'));
    const count=all('#tabs .tab').length;for(const name of ['favorites','library','trash','settings'])(q('[data-view="'+name+'"]')||q('[data-view-target="'+name+'"]')).click();
    const navNoTabs=all('#tabs .tab').length===count;
    const destinations=[];for(const card of all('.status-card[role=button]')){card.click();await pause();destinations.push(document.querySelector('.view.active').dataset.pane);}
    const storageActive=q('.settings-nav button.active')?.dataset.settingsTarget==='settings-storage';
    const oldHeight=q('#historyList .history-item').getBoundingClientRect().height;q('#compactSidebarToggle').click();await pause();const compactHeight=q('#historyList .history-item').getBoundingClientRect().height;
    const input=q('#historySearch');input.value='no-such-report';input.dispatchEvent(new Event('input',{bubbles:true}));const empty=all('#historyList .history-item').length===0;
    q('#historyMonth').value='all';q('#historyMonth').dispatchEvent(new Event('change',{bubbles:true}));const stillEmpty=all('#historyList .history-item').length===0;
    input.value='ai progress';input.dispatchEvent(new Event('input',{bubbles:true}));const found=all('#historyList .history-item').length===1;
    input.value='2026-09-24';input.dispatchEvent(new Event('input',{bubbles:true}));const dateFound=all('#historyList .history-item').length===1;
    input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));
    const red=getComputedStyle(q('[data-report-trash]')).color,controlsHeight=q('.window-controls button').getBoundingClientRect().height;
    hasApiKey=true;q('[data-modal="digest"]').click();await pause();const actualRows=all('#digestFileList .file-row').length;
    const originalDate=q('#startDate').value;q('#startDate').value='2027-01-01';q('#startDate').dispatchEvent(new Event('change',{bubbles:true}));await pause();const emptyRange=q('#createDigest').disabled&&all('#digestFileList .file-row').length===0;q('#startDate').value=originalDate;q('#startDate').dispatchEvent(new Event('change',{bubbles:true}));await pause();q('#digestFileList input').click();const minGuard=q('#createDigest').disabled;q('#digestFileList input').click();q('#createDigest').click();await pause();
    const digestProgress=!q('#generationProgress').hidden&&!q('#modal-digest').classList.contains('open');
    return {settingsNav:q('.settings-nav button.active')?.dataset.settingsTarget,navNoTabs,destinations,storageActive,oldHeight,compactHeight,empty,stillEmpty,found,dateFound,red,controlsHeight,actualRows,emptyRange,minGuard,digestProgress};
  })()`);
  assert(controls.navNoTabs);assert.deepEqual(controls.destinations,['library','settings','settings','settings']);assert(controls.storageActive);assert(controls.oldHeight-controls.compactHeight>=8);assert(controls.empty&&controls.stillEmpty&&controls.found&&controls.dateFound);assert.equal(controls.red,'rgb(188, 66, 66)');assert.equal(controls.controlsHeight,34);assert.equal(controls.actualRows,2);assert(controls.emptyRange&&controls.minGuard&&controls.digestProgress);assert.deepEqual(digestPayload.ids,['digest-first','digest-second']);
  win.webContents.send('activity:changed',Array.from({length:12},(_,i)=>({id:'cap-'+i,title:{en:'Update'},body:{en:'Details'},read:false,createdAt:new Date().toISOString()})));await new Promise(r=>setTimeout(r,50));
  const capped=await win.webContents.executeJavaScript(`(async()=>{const q=s=>document.querySelector(s);q('#activityButton').click();const count=document.querySelectorAll('#activityList article').length;q('#activityClearAll').click();await new Promise(r=>setTimeout(r,70));const result={count,empty:document.querySelectorAll('#activityList article').length===0,unread:q('#activityCount').hidden};q('#modal-activity [data-close]').click();return result;})()`);
  assert.equal(capped.count,8);assert(capped.empty&&capped.unread);assert.equal(clearActivityCalls,1);console.log(JSON.stringify({controls,capped}));
  console.log(JSON.stringify(appearance));
  if(process.env.DAILY_AI_CAPTURE) {
    win.setSize(1440,920);
    await new Promise(resolve=>setTimeout(resolve,200));
    await win.webContents.executeJavaScript(`const captureStyle=document.createElement('style');captureStyle.textContent='*{animation:none!important;transition:none!important}';document.head.append(captureStyle);document.querySelector('[data-view="home"]').click();document.querySelector('.viewport').scrollTop=0;document.querySelector('#historyMonthButton').click();`);
    await new Promise(resolve=>setTimeout(resolve,200));
    require('node:fs').writeFileSync(process.env.DAILY_AI_CAPTURE,(await win.webContents.capturePage()).toPNG());
    if(process.env.DAILY_AI_CAPTURE_QUIT){win.webContents.send('window:requestQuit');await new Promise(r=>setTimeout(r,200));require('node:fs').writeFileSync(process.env.DAILY_AI_CAPTURE_QUIT,(await win.webContents.capturePage()).toPNG());await win.webContents.executeJavaScript(`document.querySelector('#quitCancel').click();`);}
    if(process.env.DAILY_AI_CAPTURE_DARK){await win.webContents.executeJavaScript(`document.querySelector('[data-theme-value="dark"]').click();`);await new Promise(resolve=>setTimeout(resolve,200));require('node:fs').writeFileSync(process.env.DAILY_AI_CAPTURE_DARK,(await win.webContents.capturePage()).toPNG());}
  }
  console.log(JSON.stringify(interaction));
  console.log(JSON.stringify(result));
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
