(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qAll = (selector, root = document) => [...root.querySelectorAll(selector)];
  const bridge = window.dailyAI;
  let preferences = null;
  let restoringTabs=true,tabsRestored=false;
  let latestPreviewKey=null;
  let preferenceTimer;
  let tabTimer;
  let generationUnsubscribe;
  let activityRows=[];
  let dashboardCache=null;
  let searchConfig=null;
  function renderSearchConfig(){if(searchConfig)q('#searchConfigState').textContent=searchConfig.exaConfigured?tr('Exa 搜索密钥已安全保存（••••）；搜索与生成模型独立。','Exa search key saved securely (••••); search is independent of the generation model.'):tr('联网检索与生成模型独立配置；未设置搜索密钥时使用可用公共通道。','Web search is configured independently of the generation model. Available public channels are used without a search key.');}
  let generationCache=null;
  let dismissedGenerationAt = null;
  let lastGenerationAt = null;
  let terminalHideTimer=null;
  let terminalHandledKey=null;
  let progressTaskId=null,progressSequence=-1;
  let reportsCache = [];
  let trashCache = [];
  let topicsCache = [];
  let modelsCache = [];
  let providerCatalog = [];
  let selectedMonth = 'all';
  let favoriteFilter = 'all';
  let editingTopicId = null;
  let selectedReportId = null;
  let pendingConfirmation = null;
  let latestPreviewRequest = 0;
  const reportViewRequests = new Map();
  const tr = (zh, en) => currentLanguage === 'en' ? en : zh;
  const uiDate = value => new Date(value).toLocaleString(currentLanguage === 'en' ? 'en-US' : 'zh-CN');
  async function refreshScheduleStatus() {
    if (!bridge?.getScheduleStatus) return;
    const next=unwrap(await bridge.getScheduleStatus());
    const home=q('[data-i18n="home.next"]');
    const summary=q('#scheduleSummary');
    if (!next) {
      if (home) home.textContent=tr('自动更新已暂停','Automatic updates paused');
      if (summary) summary.textContent=tr('自动更新已暂停','Automatic updates paused');
      return;
    }
    const delivery=new Date(next.dueAt).toLocaleString(currentLanguage==='en'?'en-US':'zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const start=new Date(next.startAt).toLocaleString(currentLanguage==='en'?'en-US':'zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    if (home) home.textContent=tr(`下次交付：${delivery} · ${start} 开始准备`,`Next delivery: ${delivery} · preparation ${start}`);
    if (summary) summary.textContent=tr(`${start} 开始准备，${delivery} 交付`,`Prepare ${start}; deliver ${delivery}`);
  }

  function unwrap(result) {
    if (!result?.ok) throw new Error(result?.error?.message || '操作失败');
    return result.data;
  }

  function setModelConnected(profile) {
    if (!profile) return;
    if(profile.provider==='managed'){
      hasApiKey=true;q('#modelConnectionCard')?.classList.remove('api-empty');
      q('#connectionTitle').textContent=tr('订阅 · 平台模型','Subscription · Platform model');
      q('#connectionCaption').textContent=tr('由 remote-DSA 统一提供','Managed by remote-DSA');
      q('#modelStatusName').textContent=tr('平台统一模型','Platform model');
      q('#modelStatusText').textContent=tr('订阅模式 · 无需本地 Key','Subscription · No local key required');
      q('#settingsModelState').textContent=tr('当前使用订阅，模型由平台管理','Subscription active; the platform manages the model');return;
    }
    const modelLabel = profile.model.toUpperCase();
    const providerName = currentLanguage === 'en' ? ({ glm:'Zhipu GLM', qwen:'Qwen', doubao:'Doubao', custom:'Custom API' }[profile.provider] || providerCatalog.find(item => item.id === profile.provider)?.name || profile.provider || 'Model') : providerCatalog.find(item => item.id === profile.provider)?.name || profile.provider || '模型';
    hasApiKey = true;
    q('#modelConnectionCard')?.classList.remove('api-empty');
    q('#connectionTitle').textContent = `${providerName} · ${modelLabel}`;
    q('#connectionCaption').textContent = currentLanguage === 'zh' ? '默认生成模型 · 已验证' : 'Default model · Verified';
    q('#modelStatusName').textContent = modelLabel;
    q('#modelStatusText').textContent = currentLanguage === 'zh' ? '连接正常 · 结构化输出' : 'Connected · Structured output';
    q('#settingsModelState').textContent = `${providerName} ${modelLabel} · ${profile.keyHint || '••••'} · ${tr('已验证','Verified')}`;
    q('#savedKeyHint').textContent = tr(`已保存密钥：${profile.keyHint || '••••'}（输入新 Key 可替换）`, `Saved key: ${profile.keyHint || '••••'} (enter a new key to replace it)`);
    q('#apiKey').placeholder = tr('留空沿用已保存密钥，输入新 Key 可替换', 'Leave blank to keep the saved key, or enter a new one');
    const notice = q('#modal-api .notice span');
    if (notice) { notice.removeAttribute('data-i18n'); notice.textContent = tr(`已连接 ${providerName} ${modelLabel}，密钥 ${profile.keyHint || '••••'}。可修改模型或替换密钥。`, `${providerName} ${modelLabel} is connected. Saved key: ${profile.keyHint || '••••'}. You can change the model or key.`); }
  }

  let modelDiscoverySequence=0, modelDiscoveryPending=null;
  function modelOptions(models,selected='') {
    const rows=models.map(m=>`<option value="${escapeHtml(m.id)}">${escapeHtml(m.id)}</option>`);
    if(selected&&!models.some(m=>m.id===selected))rows.unshift(`<option value="${escapeHtml(selected)}">${escapeHtml(selected)} · ${tr('当前配置','Current configuration')}</option>`);
    q('#apiModel').innerHTML=rows.join('')+`<option value="custom">${tr('手动填写其他模型…','Enter another model…')}</option>`;
    q('#apiModel').value=selected||models[0]?.id||'custom';
    q('#customModel').value=selected;
    q('#customModelField').hidden=q('#apiModel').value!=='custom';
  }
  async function discoverModelOptions(){
    if(!bridge?.discoverModels)return;
    const provider=q('#apiProvider').value,baseUrl=q('#apiBaseUrl').value.trim(),apiKey=q('#apiKey').value.trim();
    const connection=JSON.stringify([provider,baseUrl,apiKey]);
    if(modelDiscoveryPending?.connection===connection&&modelDiscoveryPending.sequence===modelDiscoverySequence)return;
    const sequence=++modelDiscoverySequence;
    const saved=modelsCache.find(m=>m.provider===provider&&m.status==='verified'&&(m.base_url||'').replace(/\/+$/,'')===baseUrl.replace(/\/+$/,''));
    const status=q('#modelDiscoveryStatus'),button=q('#refreshModels');
    const selected=q('#apiModel').value==='custom'?q('#customModel').value.trim():q('#apiModel').value;
    if(!apiKey&&!saved){button.disabled=true;button.title=tr('请先填写 API Key','Enter an API key first');status.dataset.state='idle';status.textContent=tr('请先填写此连接的 API Key；已有模型配置仍可查看。','Enter an API key for this connection. Existing model settings remain visible.');return;}
    button.title='';modelDiscoveryPending={connection,sequence};
    button.disabled=true;button.textContent=tr('正在刷新…','Refreshing…');status.dataset.state='loading';status.setAttribute('aria-busy','true');
    status.textContent=tr('正在读取厂商实时模型列表，原有选择会保留。','Loading live models. Your current selection will be kept.');
    let timer;
    try{
      const result=unwrap(await Promise.race([bridge.discoverModels({id:saved?.id,provider,baseUrl,apiKey}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(tr('刷新超时，请检查网络后重试。已保留原有模型。','Refresh timed out. Check your network and retry. Existing models were kept.'))),35000);})]));
      if(sequence!==modelDiscoverySequence)return;
      if(!Array.isArray(result.models))throw new Error(tr('接口未返回有效模型列表。','The API did not return a valid model list.'));
      if(result.models.length)modelOptions(result.models,selected);
      status.dataset.state=result.models.length?'success':'empty';
      status.textContent=result.models.length?tr(`已获取 ${result.models.length} 个模型，可展开列表选择。保存时将验证调用权限。`,`Loaded ${result.models.length} models. Open the list to select. Access is verified on save.`):tr('接口返回空列表，已保留原有配置。可重试或手动填写其他模型。','The API returned no models. Existing settings were kept. Retry or enter another model.');
      if(!result.complete)status.textContent+=tr(' 列表尚未完整，请重试。',' The list is incomplete; retry.');
    }catch(e){if(sequence===modelDiscoverySequence){status.dataset.state='error';status.textContent=tr('刷新失败，已保留原有模型。','Refresh failed; existing models were kept. ')+e.message;}}
    finally{clearTimeout(timer);if(modelDiscoveryPending?.sequence===sequence)modelDiscoveryPending=null;if(sequence===modelDiscoverySequence){button.disabled=false;button.textContent=tr('刷新模型列表','Refresh model list');status.setAttribute('aria-busy','false');}}
  }

  function applyProviderPreset(providerId, { preserveUrl = false, useSaved = true } = {}) {
    const provider = providerCatalog.find(item => item.id === providerId);
    if (!provider) return;
    q('#apiProvider').value = provider.id;
    q('#apiPlanField').hidden = provider.id !== 'glm';
    if (!preserveUrl) q('#apiBaseUrl').value = provider.baseUrl || '';
    ++modelDiscoverySequence;
    q('#refreshModels').disabled=false;
    q('#refreshModels').textContent=tr('刷新模型列表','Refresh model list');
    q('#modelDiscoveryStatus').dataset.state='idle';
    q('#modelDiscoveryStatus').setAttribute('aria-busy','false');
    q('#apiModel').innerHTML = `<option value="custom">${tr('手动填写模型名','Enter model name')}</option>`;
    q('#customModelField').hidden = false;
    q('#customModel').value = '';
    q('#modelDiscoveryStatus').textContent = tr('填写密钥后自动从此 API 获取模型，也可手动刷新。','Models load from this API after entering a key. You can also refresh.');
    const existing = modelsCache.find(model => model.provider === provider.id && model.status === 'verified');
    const notice=q('#modal-api .notice span');if(notice){notice.removeAttribute('data-i18n');notice.textContent=existing?tr(`此厂商已保存模型 ${existing.model}。可从 API 刷新列表或手动填写，再测试并保存。`,`Saved model: ${existing.model}. Refresh the API list or enter a model, then test and save.`):tr('填写密钥后获取模型列表，选择模型后测试并保存。','Enter a key to load models, then select, test and save.');}
    q('#savedKeyHint').textContent = existing ? tr(`已保存密钥：${existing.keyHint || '••••'}（留空可沿用）`, `Saved key: ${existing.keyHint || '••••'} (leave blank to keep it)`) : tr('尚未保存该厂商的密钥','No key saved for this provider');
    if(existing&&useSaved){
      if(!preserveUrl)q('#apiBaseUrl').value=existing.base_url;
      modelOptions([],existing.model);
      q('#customModelField').hidden=q('#apiModel').value!=='custom';
    }
    if(provider.id==='glm')q('#apiPlan').value=q('#apiBaseUrl').value;
    q('#apiKey').value = '';
    qAll('[data-provider-pick]').forEach(button => button.classList.toggle('active', button.dataset.providerPick === provider.id));
    if(q('#modal-api').classList.contains('open'))queueMicrotask(discoverModelOptions);
  }

  function renderRealReports(reports) {
    reportsCache = reports;
    renderHomeActivity();
    renderLatestReport(reports).catch(error => {latestPreviewKey=null;console.warn('[latest report]', error);});
    const history = q('#historyList');
    const monthSelect = q('#historyMonth');
    const months = [...new Set(reports.map(report => report.created_at.slice(0,7)))].sort().reverse();
    if (selectedMonth !== 'all' && !months.includes(selectedMonth)) selectedMonth = 'all';
    monthSelect.innerHTML = `<option value="all">${tr('全部月份','All months')}</option>${months.map(month => `<option value="${month}">${tr(`${month.slice(0,4)} 年 ${Number(month.slice(5,7))} 月`, new Date(`${month}-01`).toLocaleDateString('en-US',{month:'long',year:'numeric'}))}</option>`).join('')}`;
    monthSelect.value = selectedMonth;
    q('#historyMonthLabel').textContent=monthSelect.selectedOptions[0]?.textContent || tr('全部月份','All months');
    q('#historyMonthMenu').innerHTML=[...monthSelect.options].map(option=>`<button role="option" aria-selected="${option.selected}" data-history-month="${escapeHtml(option.value)}">${escapeHtml(option.textContent)}<span>${option.selected?'✓':''}</span></button>`).join('');
    const query=q('#historySearch').value.normalize('NFKC').trim().toLowerCase();
    const visible = reports.filter(report => (selectedMonth === 'all' || report.created_at.startsWith(selectedMonth)) && (!query || `${report.title} ${report.period_start} ${report.period_end}`.normalize('NFKC').toLowerCase().includes(query)));
    history.innerHTML = visible.length ? visible.map(report => `<button class="history-item" data-report="${escapeHtml(report.report_type)}" data-report-id="${escapeHtml(report.id)}" data-title="${escapeHtml(report.title)}" title="${escapeHtml(report.title)}"><svg class="icon history-icon"><use href="#i-file"/></svg><i class="history-dot ${report.report_type === 'digest' ? 'digest' : ''}"></i><span class="history-copy"><strong>${escapeHtml(report.title)}</strong><small>${uiDate(report.created_at)} · HTML</small></span><span class="star-mini ${report.is_favorite ? 'saved' : ''}" aria-label="${tr('收藏','Favorite')}">${report.is_favorite ? '★' : '☆'}</span><span class="history-more" role="button" tabindex="0" aria-label="${tr('管理报告','Manage report')}" data-report-more="${escapeHtml(report.id)}" title="${tr('管理报告','Manage report')}"><svg class="icon icon-sm"><use href="#i-more"/></svg></span></button>`).join('') : `<div class="history-empty">${tr('没有匹配的报告，请检查关键词或月份','No matching reports. Check your keywords or month.')}</div>`;
    const favoriteReports = reports.filter(report => report.is_favorite);
    const filteredFavorites = favoriteReports.filter(report => favoriteFilter === 'all' || report.report_type === favoriteFilter);
    q('#favoriteReportGrid').innerHTML = filteredFavorites.length ? filteredFavorites.map(report => renderReportTile(report, 'favorite')).join('') : `<div class="history-empty">${tr('没有符合条件的收藏报告','No matching favorite reports')}</div>`;
    q('#libraryReportGrid').innerHTML = reports.length ? reports.map(report => renderReportTile(report, 'library')).join('') : `<div class="history-empty">${tr('还没有生成报告','No reports yet')}</div>`;
    q('#favoriteCount').textContent = String(favoriteReports.length);
    q('#favoritesBadge').textContent = String(favoriteReports.length);
    q('#favoritesBadge').hidden = favoriteReports.length === 0;
    q('#libraryCount').textContent = tr(`${reports.length} 份`, `${reports.length} ${reports.length===1?'report':'reports'}`);
    const firstStatus = q('.status-strip .status-card');
    if (firstStatus) { q('strong', firstStatus).textContent = tr(`${reports.length} 份`, `${reports.length} ${reports.length===1?'report':'reports'}`); q('small', firstStatus).textContent = reports.length ? tr('本地生成报告','Reports saved locally') : tr('等待生成第一份日报','Waiting for the first report'); }
    const latest = reports.find(report => report.report_type === 'daily');
    q('[data-i18n="home.last"]').textContent = latest ? tr(`最近成功：${uiDate(latest.created_at)}`, `Last report: ${uiDate(latest.created_at)}`) : tr('最近成功：尚无日报','Last report: none yet');
    qAll('.metric strong').forEach(node => { node.textContent = '—'; });
  }

  async function renderLatestReport(reports) {
    const candidate=reports.find(report=>report.report_type==='daily');
    const key=JSON.stringify([candidate?.id,candidate?.html_path,candidate?.title,candidate?.created_at,currentLanguage]);
    if(key===latestPreviewKey)return;latestPreviewKey=key;
    const request = ++latestPreviewRequest;
    const latest = reports.find(report => report.report_type === 'daily');
    const open = q('#latestReportOpen');
    const hook = q('#latestReportHook');
    const highlights = q('#latestReportHighlights');
    const date = q('#latestReportDate');
    open.disabled = !latest;
    delete open.dataset.reportOpen;
    if (!latest) {
      date.textContent = '—';
      hook.textContent = currentLanguage === 'en' ? 'Your next AI signal starts with the first report.' : '生成第一份日报，开始追踪值得关注的 AI 进展。';
      highlights.textContent = currentLanguage === 'en' ? 'The most important takeaways will appear here after a report is generated.' : '最新日报生成后，这里会显示最值得看的要点。';
      return;
    }
    open.dataset.reportOpen = latest.id;
    date.textContent = new Date(latest.created_at).toLocaleString(currentLanguage === 'en' ? 'en-US' : 'zh-CN', { dateStyle:'medium', timeStyle:'short' });
    hook.textContent = latest.title;
    highlights.textContent = currentLanguage === 'en' ? 'Loading the latest takeaways…' : '正在读取本期要点…';
    const data = unwrap(await bridge.getReportContent(latest.id));
    if (request !== latestPreviewRequest) return;
    const documentHtml = new DOMParser().parseFromString(data.html, 'text/html');
    const currentReport=documentHtml.querySelector(currentLanguage==='en'?'#daily-report-en':'#daily-report-zh') || documentHtml;
    const headlines = [...currentReport.querySelectorAll('.key-point strong')].map(node => node.textContent.trim()).filter(Boolean);
    if (!headlines.length) headlines.push(...[...currentReport.querySelectorAll('.item h3')].map(node => node.textContent.trim()).filter(Boolean));
    hook.textContent = headlines[0] ? `${currentLanguage === 'en' ? 'Today’s signal: ' : '今天最值得看：'}${headlines[0]}` : latest.title;
    highlights.innerHTML = headlines.slice(0, 3).map((headline, index) => `<div class="source-row"><span class="source-num">${String(index + 1).padStart(2, '0')}</span><span><strong>${escapeHtml(headline)}</strong></span></div>`).join('') || `<p>${currentLanguage === 'en' ? 'Open the report to read its analysis.' : '打开日报查看完整分析。'}</p>`;
  }

  function renderReportTile(report, context) {
    const favoriteButton = `<button data-report-favorite="${escapeHtml(report.id)}">${report.is_favorite ? tr('取消收藏','Remove favorite') : tr('收藏','Favorite')}</button>`;
    return `<article class="report-tile" data-report="${escapeHtml(report.report_type)}" data-report-id="${escapeHtml(report.id)}" data-title="${escapeHtml(report.title)}"><div class="tile-top"><span class="type-pill">${report.report_type === 'digest' ? tr('汇聚','Digest') : tr('日报','Daily report')}</span><span>${report.is_favorite ? tr('★ 已收藏','★ Favorite') : tr('本地 HTML','Local HTML')}</span></div><h3>${escapeHtml(report.title)}</h3><p>${escapeHtml(report.period_start)} — ${escapeHtml(report.period_end)}</p><div class="tile-foot"><span>${new Date(report.created_at).toLocaleDateString(currentLanguage === 'en' ? 'en-US' : 'zh-CN')}</span><span>HTML</span></div><div class="report-tile-actions"><button data-report-open="${escapeHtml(report.id)}">${tr('打开','Open')}</button>${favoriteButton}<button data-report-trash="${escapeHtml(report.id)}">${tr('移入回收站','Move to trash')}</button></div></article>`;
  }

  function renderTrash(reports) {
    trashCache = reports;
    q('#trashReportGrid').innerHTML = reports.length ? reports.map(report => `<article class="report-tile"><div class="tile-top"><span class="type-pill">${tr('回收站','Trash')}</span><span>${report.is_favorite ? tr('★ 原收藏','★ Former favorite') : tr('普通报告','Daily report')}</span></div><h3>${escapeHtml(report.title)}</h3><p>${tr('删除时间：','Deleted: ')}${uiDate(report.deleted_at)}</p><div class="report-tile-actions"><button data-report-restore="${escapeHtml(report.id)}">${tr('恢复','Restore')}</button><button data-report-delete="${escapeHtml(report.id)}">${tr('永久删除','Delete permanently')}</button></div></article>`).join('') : `<div class="history-empty">${tr('回收站为空','Trash is empty')}</div>`;
    q('#trashCount').textContent = tr(`${reports.length} 份`, `${reports.length} ${reports.length===1?'report':'reports'}`);
    q('#emptyTrash').disabled=reports.length===0;
  }

  async function refreshReports() {
    const [reports, trash] = await Promise.all([bridge.listReports(), bridge.listTrash()]);
    renderRealReports(unwrap(reports));
    renderTrash(unwrap(trash));
    for(const tab of qAll('#tabs .tab[data-pane^="report-"]'))if(!reportsCache.some(r=>tab.dataset.pane==='report-'+r.id))closeTab(tab.dataset.pane);
    refreshDashboardStats().catch(()=>{});
  }

  function applyPersistedSettings(settings) {
    preferences = settings;
    q('#frequency').value = settings.frequency === 'weekdays' ? 'workdays' : settings.frequency;
    q('#retentionMonths').value=settings.retentionMonths||6;q('#cleanupTime').value=settings.cleanupTime||'03:30';q('#cleanupEnabled').classList.toggle('on',settings.cleanupEnabled!==false);
    q('#runTime').value = settings.time || '09:00';
    q('#reportLanguage').value = settings.reportLanguage || 'interface';
    q('#weekdayPicker').hidden = q('#frequency').value !== 'weekly';
    const selectedDays = new Set((settings.weekdays || []).map(day => day === 7 ? 0 : day));
    qAll('#weekdayPicker [data-day]').forEach(button => button.classList.toggle('active', selectedDays.has(Number(button.dataset.day))));
    applyLanguage(settings.language === 'en-US' ? 'en' : 'zh');
    setTheme(settings.theme || 'system');
    qAll('#languageSegment button').forEach(button => button.classList.toggle('active', button.dataset.languageValue === currentLanguage));
    qAll('#themeSegment button').forEach(button => button.classList.toggle('active', button.dataset.themeValue === (settings.theme || 'system')));
    q('.app-shell')?.classList.toggle('sidebar-collapsed', Boolean(settings.sidebarCollapsed));
    q('.app-shell')?.classList.toggle('sidebar-compact', Boolean(settings.compactSidebar));q('#compactSidebarToggle').classList.toggle('on',Boolean(settings.compactSidebar));q('#compactSidebarToggle').setAttribute('aria-pressed',String(Boolean(settings.compactSidebar)));
    qAll('#autoScheduleToggle,#settingsAutoScheduleToggle').forEach(button => button.classList.toggle('on', settings.scheduleEnabled !== false));
    q('#launchAtLoginToggle')?.classList.toggle('on', settings.launchAtLogin !== false);
    q('#notificationsToggle').classList.toggle('on',settings.notificationsEnabled!==false);
    if (q('#autoScheduleLabel')) q('#autoScheduleLabel').textContent = settings.scheduleEnabled === false ? tr('已暂停','Paused') : tr('已启用','Enabled');
    updateSidebarToggle();
  }

  function collectSettings() {
    const selected = q('#frequency').value;
    return {
      ...(preferences || {}),
      language: currentLanguage === 'en' ? 'en-US' : 'zh-CN',
      reportLanguage: q('#reportLanguage').value,
      theme: q('#themeSegment button.active')?.dataset.themeValue || 'system',
      frequency: selected === 'workdays' ? 'weekdays' : selected,
      time: q('#runTime').value,
      weekdays: qAll('#weekdayPicker .day-chip.active').map(button => Number(button.dataset.day) || 7),
      retentionMonths: Number(q('#retentionMonths').value)||6,
      cleanupEnabled:q('#cleanupEnabled').classList.contains('on'),
      cleanupTime: q('#cleanupTime').value || '03:30'
      ,compactSidebar:q('#compactSidebarToggle').classList.contains('on')
      ,sidebarCollapsed: q('.app-shell')?.classList.contains('sidebar-collapsed') || false
      ,scheduleEnabled: q('#autoScheduleToggle')?.classList.contains('on') !== false
      ,notificationsEnabled:q('#notificationsToggle').classList.contains('on')
      ,launchAtLogin: q('#launchAtLoginToggle')?.classList.contains('on') !== false
    };
  }

  function updateSidebarToggle() {
    const collapsed = q('.app-shell')?.classList.contains('sidebar-collapsed');
    const button = q('#sidebarToggle');
    if (!button) return;
    button.title = collapsed ? tr('展开侧栏','Expand sidebar') : tr('折叠侧栏','Collapse sidebar');
    button.setAttribute('aria-label', button.title);
  }

  function updateGenerationProgress(progress) {
    if(progress?.taskId){if(progressTaskId===progress.taskId && progress.sequence<progressSequence)return;progressTaskId=progress.taskId;progressSequence=progress.sequence??0;}
    if (!progress || progress.status === 'idle') return;
    const terminal=progress.status!=='running';
    const terminalKey=terminal?`${progress.taskId||'scheduled'}:${progress.sequence??progress.updatedAt}:${progress.status}`:null;
    const newTerminal=terminal&&terminalHandledKey!==terminalKey;
    if(newTerminal)terminalHandledKey=terminalKey;
    if(!terminal||newTerminal){clearTimeout(terminalHideTimer);terminalHideTimer=null;}
    generationCache=progress;renderHomeActivity();
    lastGenerationAt = progress.updatedAt || null;
    const panel = q('#generationProgress');
    if (!panel) return;
    if (progress.status === 'running') dismissedGenerationAt = null;
    panel.hidden = progress.status !== 'running' && dismissedGenerationAt === progress.updatedAt;
    panel.classList.toggle('running',progress.status==='running');
    const headerCancel=q('#generationHeaderCancel');headerCancel.title=tr('中断任务','Interrupt task');headerCancel.setAttribute('aria-label',headerCancel.title);
    if(newTerminal&&['completed','cancelled'].includes(progress.status))terminalHideTimer=setTimeout(()=>{
      if(generationCache?.status===progress.status&&generationCache?.updatedAt===progress.updatedAt){dismissedGenerationAt=progress.updatedAt;panel.hidden=true;}
    },5000);
    panel.classList.toggle('failed', progress.status === 'failed');
    panel.classList.toggle('completed', ['completed','cancelled'].includes(progress.status));
    q('#cancelGeneration').hidden=progress.status!=='running';
    q('#generationFootnote').textContent=progress.status==='running'&&progress.stage==='等待交付'?tr('等待预定时间交付','Waiting for scheduled delivery'):progress.status==='running'?tr('可安全最小化到托盘','Safe to minimize to tray'):progress.status==='completed'?tr('报告已保存到本地','Report saved locally'):progress.status==='cancelled'?tr('本次任务已停止','Task stopped'):tr('任务已停止，请检查原因','Task stopped; review the error');
    const englishStages = { '复用今日日报':'Reusing today’s report', '补齐已有日报译文':'Translating existing report', '重组报告':'Rebuilding report','读取原日报':'Reading source reports','分析汇聚内容':'Analyzing digest','保存汇聚报告':'Saving digest','汇聚已完成':'Digest ready','准备任务':'Preparing task', '准备检索词':'Preparing search queries', '检索资料':'Searching and verifying sources', '分析资料':'Analyzing sources', '重试模型请求':'Retrying model request', '整理报告':'Organizing report', '准备双语报告':'Preparing bilingual report', '保存报告':'Saving report', '等待交付':'Ready for scheduled delivery', '日报已生成':'Report generated', '生成失败':'Generation failed' };
    q('#generationStage').textContent = currentLanguage === 'en' ? englishStages[progress.stage] || 'Generating report' : progress.stage || '正在生成日报';
    q('#generationDetail').textContent = currentLanguage === 'en' && progress.status === 'running' ? `Working in the background · ${Math.round(Number(progress.percent) || 0)}% complete` : currentLanguage === 'en' && progress.status === 'failed' ? 'The task failed. Check model settings, search access, and your network connection.' : progress.detail || tr('后台任务运行中','Background task running');
    q('#generationBar').style.width = `${Math.max(0, Math.min(100, Number(progress.percent) || 0))}%`;
    q('#generationPercent').textContent = `${Math.round(Number(progress.percent) || 0)}%`;
    q('#generationStatus').textContent = progress.status === 'completed' ? tr('任务已完成','Task completed') : progress.status === 'failed' ? tr('任务需要处理','Task needs attention') : tr('后台任务运行中','Background task running');
    if(progress.status==='running') {
      const elapsed=Number(progress.elapsedSeconds)||0;
      q('#generationStatus').textContent=progress.stage==='等待交付'?tr('报告准备就绪','Report ready'):tr(`已用时 ${Math.floor(elapsed/60)} 分 ${elapsed%60} 秒`,`Elapsed ${Math.floor(elapsed/60)}m ${elapsed%60}s`);
      const activity=progress.activity;
      if(activity?.type==='topic')q('#generationDetail').textContent=tr(`正在提炼主题 ${activity.index}/${activity.total}：${activity.name || ''}`,`Analyzing topic ${activity.index}/${activity.total}`);
      if(activity?.type==='translation')q('#generationDetail').textContent=tr(`正在准备双语内容，第 ${activity.index}/${activity.total} 批`,`Preparing bilingual content, batch ${activity.index}/${activity.total}`);
      if(activity?.type==='retry')q('#generationDetail').textContent=tr(`服务响应异常，正在重试 ${activity.attempt}/${activity.total}（${activity.code}）`,`Retry ${activity.attempt}/${activity.total} (${activity.code})`);
      if(progress.stageElapsedSeconds>=60 && progress.stage!=='等待交付')q('#generationDetail').textContent+=tr(` · 当前阶段已用时 ${Math.floor(progress.stageElapsedSeconds/60)} 分钟，仍在等待响应`,` · This stage has taken ${Math.floor(progress.stageElapsedSeconds/60)}m; waiting for a response`);
    }
    if(progress.status==='cancelled'){q('#generationStage').textContent=tr('已取消','Cancelled');q('#generationDetail').textContent=tr('已停止当前任务，可重新生成','Task stopped. You can generate again.');q('#generationStatus').textContent=tr('任务已结束','Task ended');}
    if(progress.status==='failed')q('#generationDetail').textContent=currentLanguage==='zh'?`${progress.failedStage || ''}：${progress.detail}`:`${englishStages[progress.failedStage] || 'Generation'} failed (${progress.errorCode || 'ERROR'}). ${progress.errorCode==='AUTH'?'Check your API key and permissions.':progress.errorCode==='INTERRUPTED'?'The previous task was interrupted. Generate again.':'Check service access and retry. The task has stopped.'}`;
    if(progress.status==='failed') {
      const actions={SUBSCRIPTION_REQUIRED:tr('订阅未开通或已到期，请前往账号与订阅重新开通。','Your subscription is inactive or expired. Open Account & subscription to subscribe.'),NO_VERIFIED_ITEMS:tr('未发现尚未推送的新资讯；近一周已推送内容已去重，不重复发布。','No new verified items after excluding news delivered in the last seven days. Nothing was republished.'),ENOSPC:tr('磁盘空间不足，请释放空间或迁移数据目录。','Storage is full. Free space or move the data directory.'),EACCES:tr('无法写入数据目录，请检查目录权限。','The data directory is not writable. Check permissions.'),EPERM:tr('文件被占用或没有写入权限，请检查文件状态。','A file may be locked or access denied. Check file permissions.'),MODEL_TIMEOUT:tr('模型响应超时，可重试；已完成的中间结果会短期保留。','The model timed out. Retry; completed intermediate results are retained briefly.'),INVALID_REQUEST:tr('模型不支持当前请求，请检查模型名称与接口地址。','Check the model name and API endpoint; the request was rejected.')};
      if(actions[progress.errorCode])q('#generationDetail').textContent+=' '+actions[progress.errorCode];
      if(progress.errorCode==='TOPIC_SHORTFALL')q('#generationDetail').textContent=currentLanguage==='zh'?progress.detail:'One or more topics could not meet the configured minimum after targeted searches and relevance checks. No incomplete report was published. Review the topic scope or minimum count.';
      if(progress.errorCode==='TOPICS_CHANGED')q('#generationDetail').textContent=tr('主题设置在生成过程中发生变化，请重新生成，确保按最新主题发布。','Topic settings changed during generation. Generate again using the latest settings.');
      if(progress.retryAt)q('#generationDetail').textContent+=tr(' · 5 分钟后自动重试',' · Automatic retry in 5 minutes');
      if(progress.retryLimitReached)q('#generationDetail').textContent+=tr(' · 已停止自动重试，请处理后手动生成',' · Automatic retries stopped. Resolve the issue and generate manually.');
    }
    if (progress.status === 'completed'&&newTerminal) {
      refreshReports().catch(() => {});
      showToast(progress.report?.report_type==='digest'?tr('汇聚已生成','Digest generated'):tr('日报已生成','Report generated'), progress.detail || tr('已保存到本地报告库','Saved to the local report library'));
    }
    if (progress.status === 'failed'&&newTerminal) showToast(tr('日报生成失败','Report generation failed'), currentLanguage === 'en' ? 'Check model settings, search access, and your network connection.' : progress.detail || '请检查网络和模型配置');
  }

  function renderTopics(topics) {
    topicsCache = topics;
    const home = q('#homeTopicList');
    const settings = q('#settingsTopicList');
    if (!home || !settings) return;
    const topicName = topic => escapeHtml(currentLanguage === 'en' ? topic.name_en || topic.name_zh : topic.name_zh);
    const topicDescription = topic => escapeHtml(currentLanguage === 'en' && topic.id === 'agents-llm' && topic.description === '模型、推理、训练、工具调用、评测与应用架构' ? 'Models, reasoning, training, tool use, evaluation, and application architecture' : currentLanguage === 'en' && topic.id === 'vision-industry' && topic.description === '视觉论文、工业 AI 产品平台及国内外落地' ? 'Vision papers, industrial AI platforms, and deployments worldwide' : topic.description);
    home.innerHTML = topics.map(topic => `<div class="topic"><span class="topic-icon"><svg class="icon"><use href="#${topic.id === 'vision-industry' ? 'i-eye' : 'i-nodes'}"/></svg></span><span class="topic-copy"><strong>${topicName(topic)}</strong><small>${topicDescription(topic)}</small></span><span class="topic-actions"><button data-topic-edit="${escapeHtml(topic.id)}" title="${tr('编辑主题','Edit topic')}"><svg class="icon icon-sm"><use href="#i-settings"/></svg></button></span><button class="toggle ${topic.enabled ? 'on' : ''}" data-topic-toggle="${escapeHtml(topic.id)}" aria-label="${tr('切换','Toggle')} ${topicName(topic)}"></button></div>`).join('');
    settings.innerHTML = topics.map(topic => `<div class="setting-row"><span class="setting-copy"><strong>${topicName(topic)}</strong><small>${topicDescription(topic)}</small></span><span class="setting-control"><button class="secondary-btn" data-topic-edit="${escapeHtml(topic.id)}">${tr('编辑','Edit')}</button><button class="toggle ${topic.enabled ? 'on' : ''}" data-topic-toggle="${escapeHtml(topic.id)}" aria-label="${tr('切换','Toggle')} ${topicName(topic)}"></button></span></div>`).join('');
    const status = qAll('.status-strip .status-card')[1];
    qAll('#homeTopicList [data-topic-edit],#settingsTopicList [data-topic-edit]').forEach(button=>{
      const topic=topics.find(topic=>topic.id===button.dataset.topicEdit),small=button.closest('div')?.querySelector('small');
      if(small&&topic){const minimum=document.createElement('span');minimum.style.display='block';minimum.textContent=tr(`每期至少 ${topic.min_items??6} 条`,`At least ${topic.min_items??6} items per report`);minimum.textContent+=' · '+(topic.region_preference==='domestic'?tr('偏国内','Domestic focus'):tr('偏全球','Global focus'));small.append(minimum);}
    });
    if(status){const active=topics.filter(topic=>topic.enabled);q('strong',status).textContent=tr(`${active.length} 个`,`${active.length} ${active.length===1?'topic':'topics'}`);q('small',status).removeAttribute('data-i18n');q('small',status).textContent=active.length?active.map(t=>currentLanguage==='en'?t.name_en||t.name_zh:t.name_zh).join(' · '):tr('尚未启用主题','No active topics');}
    const badge = q('#homeTopicList')?.closest('.card')?.querySelector('.card-head .badge');
    if (badge) badge.textContent = tr(`${topics.filter(topic => topic.enabled).length} 已启用`, `${topics.filter(topic => topic.enabled).length} active`);
  }

  async function saveNewTopic() {
    const button = q('#saveTopic');
    button.disabled = true;
    try {
      if(!q('#topicMinimum').reportValidity())return;
      const topic = { name:q('#topicName').value, description:q('#topicDescription').value,min_items:Number(q('#topicMinimum').value),region_preference:q('#topicRegion').value };
      if (editingTopicId) unwrap(await bridge.updateTopic(editingTopicId, topic));
      else unwrap(await bridge.addTopic(topic));
      renderTopics(unwrap(await bridge.listTopics()));
      q('#modal-topic').classList.remove('open');
      q('#topicName').value = '';
      q('#topicDescription').value = '';
      showToast(tr('主题已保存','Topic saved'), tr('本次修改后可重新生成今日日报','You can regenerate today’s report after this change'));
      editingTopicId = null;
    } catch (error) { showToast(tr('无法保存主题','Could not save topic'), error.message); }
    finally { button.disabled = false; }
  }

  function openTopicEditor(id = null) {
    editingTopicId = id;
    const topic = topicsCache.find(item => item.id === id);
    q('#topicName').value = topic?.name_zh || '';
    q('#topicDescription').value = topic?.description || '';
    q('#topicMinimum').value=topic?.min_items??6;
    q('#topicRegion').value=topic?.region_preference||'global';
    q('#topicModalTitle').textContent = topic ? tr('编辑关注主题','Edit topic') : tr('新增关注主题','Add topic');
    q('#saveTopic').textContent = topic ? tr('保存修改','Save changes') : tr('保存并启用','Save and enable');
    q('#deleteTopic').hidden = !topic;
    openModal('topic');
  }

  function confirmAction(title, detail, action) {
    pendingConfirmation = action;
    q('#confirmTitle').textContent = title;
    q('#confirmDetail').textContent = detail;
    openModal('confirm');
  }

  async function toggleReportFavorite(id) {
    unwrap(await bridge.toggleFavorite(id));
    await refreshReports();
    q('.view[data-pane="report-'+CSS.escape(id)+'"] .js-report-star')?.classList.toggle('saved',!!reportsCache.find(r=>r.id===id)?.is_favorite);
    showToast(tr('收藏状态已更新','Favorite updated'), tr('收藏夹和历史记录已同步','Favorites and history are up to date'));
  }

  async function moveReportToTrash(id) {
    unwrap(await bridge.trashReport(id));
    closeTab(`report-${id}`);
    await refreshReports();
    showToast(tr('已移入回收站','Moved to trash'), tr('可在回收站恢复或永久删除','Restore or delete it permanently from Trash'));
  }

  function requestTrashReport(id) {
    const report = reportsCache.find(item => item.id === id);
    if (!report) return;
    const action = () => moveReportToTrash(id);
    if (report.is_favorite || report.report_type === 'digest') confirmAction(tr('确认移入回收站','Move protected report to trash?'), tr(`“${report.title}”受到收藏或汇聚保护，确认后才会移动。`, `“${report.title}” is a favorite or digest. Confirm to move it to Trash.`), action);
    else action().catch(error => showToast(tr('无法删除报告','Could not delete report'), error.message));
  }

  async function createDailyReport() {
    const button = q('#generateNow');
    const original = button?.innerHTML;
    if (button) { button.disabled = true; button.innerHTML = `<svg class="icon"><use href="#i-spark"/></svg>${currentLanguage === 'zh' ? '正在启动…' : 'Starting…'}`; }
    try {
      if(window.dailyEnsureSubscription&&!await window.dailyEnsureSubscription())return;
      const result = unwrap(await bridge.createReport());
      if (result.status === 'model_required') {
        openModal('api');
        showToast(tr('需要配置模型','Model setup required'), tr('请先添加并验证可用的 API Key','Add and verify an API key first'));
        return;
      }
      if (result.status === 'already_generated') {
        showToast(tr('今日日报已生成','Today’s report exists'), tr('为避免重复，当天不会再次生成日报','The same topic settings cannot generate a duplicate today'));
        if (result.report) await openRealReport(result.report.id, result.report.title, result.report.report_type);
        return;
      }
      updateGenerationProgress(unwrap(await bridge.getGenerationState()));
      showToast(result.status === 'running' ? tr('任务正在运行','Task running') : tr('日报任务已启动','Report task started'), tr('可在右下角查看实时进度','See live progress in the lower-right corner'));
    } catch (error) {
      showToast(tr('无法生成日报','Could not generate report'), error.message);
    } finally {
      if (button) { button.disabled = false; button.innerHTML = original; }
    }
  }

  async function openRealReport(id, title, type = 'daily') {
    const data = unwrap(await bridge.getReportContent(id));
    openReport(title || data.report.title, type || data.report.report_type, id);
    const pane = q(`.view[data-pane="report-${CSS.escape(id)}"]`);
    const paper = q('.report-paper', pane);
    if (!paper) return;
    if(!q(':scope > .report-toolbar',pane)){const toolbar=q('#view-report-template .report-toolbar').cloneNode(true);pane.insertBefore(toolbar,paper);}
    paper.classList.add('report-frame-wrap');
    paper.innerHTML = `<iframe class="report-frame" title="${tr('生成的 AI 日报','Generated AI report')}" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>`;
    q('.js-report-star',pane)?.classList.toggle('saved',!!data.report.is_favorite);
    const crumbs=q('.breadcrumbs',pane);if(crumbs)crumbs.textContent=data.report.period_start+' — '+data.report.period_end;
    await showReportLanguage(id, data.html, paper);
    if(bridge.markReportRead)unwrap(await bridge.markReportRead(id));
  }

  async function showReportLanguage(id, html, paper) {
    const language=currentLanguage === 'en' ? 'en-US' : 'zh-CN';
    const request=(reportViewRequests.get(id) || 0)+1;
    reportViewRequests.set(id,request);
    const frame=q('.report-frame',paper);
    if (!frame) return;
    const original=readableReportHtml(html);
    const documentHtml=new DOMParser().parseFromString(original,'text/html');
    const updateReportTitle=value=>{
      if(!value) return;
      const pane=paper.closest('.view');
      const heading=q('.js-report-title',pane);
      if(heading) heading.textContent=value;
      const tab=q(`.tab[data-pane="report-${CSS.escape(id)}"]`);
      if(tab) {const label=q('span',tab);if(label)label.textContent=value;tab.title=value;}
    };
    if(documentHtml.querySelector('#daily-report-zh,#daily-report-en')) {
      const zh=documentHtml.querySelector('#daily-lang-zh');
      const en=documentHtml.querySelector('#daily-lang-en');
      if(zh && en) {
        zh.removeAttribute('checked');en.removeAttribute('checked');
        (language==='en-US'?en:zh).setAttribute('checked','');
      }
      updateReportTitle(documentHtml.querySelector(language==='en-US'?'#daily-report-en h1':'#daily-report-zh h1')?.textContent);
      frame.srcdoc='<!doctype html>'+documentHtml.documentElement.outerHTML;
      return;
    }
    if ((documentHtml.documentElement.lang || '').toLowerCase()===(language==='en-US'?'en':'zh-cn')) {
      updateReportTitle(documentHtml.querySelector('h1')?.textContent);
      frame.srcdoc=original;
      return;
    }
    frame.srcdoc=original;
    paper.classList.add('report-translating');
    paper.dataset.translationStatus=tr('正在翻译日报…','Translating report…');
    const walker=documentHtml.createTreeWalker(documentHtml.body,NodeFilter.SHOW_TEXT);
    const nodes=[];
    while(walker.nextNode()) {
      const node=walker.currentNode;
      if(node.parentElement?.closest('script,style,svg') || !/[\p{L}]/u.test(node.textContent)) continue;
      nodes.push(node);
    }
    try {
      const translated=unwrap(await bridge.translateReportTexts(id,language,nodes.map(node=>node.textContent)));
      if(reportViewRequests.get(id)!==request || !paper.isConnected) return;
      nodes.forEach((node,index)=>{node.textContent=translated[index];});
      documentHtml.documentElement.lang=language==='en-US'?'en':'zh-CN';
      documentHtml.title=documentHtml.querySelector('h1')?.textContent || documentHtml.title;
      updateReportTitle(documentHtml.title);
      const translatedHtml='<!doctype html>'+documentHtml.documentElement.outerHTML;
      frame.srcdoc=translatedHtml;
      try {
        const stored=unwrap(await bridge.saveBilingualReport({id,originalHtml:html,preparedHtml:original,translatedHtml,translatedLanguage:language}));
        if(reportViewRequests.get(id)===request && paper.isConnected) {
          const storedDoc=new DOMParser().parseFromString(stored,'text/html');
          const target=storedDoc.querySelector(language==='en-US'?'#daily-lang-en':'#daily-lang-zh');
          storedDoc.querySelectorAll('#daily-lang-en,#daily-lang-zh').forEach(input=>input.removeAttribute('checked'));
          target?.setAttribute('checked','');
          frame.srcdoc='<!doctype html>'+storedDoc.documentElement.outerHTML;
        }
      } catch(error) { console.warn('[bilingual report cache]',error); }
    } catch(error) {
      if(reportViewRequests.get(id)===request) {
        showToast(tr('报告翻译暂不可用','Report translation unavailable'),error.message);
      }
    } finally { if(reportViewRequests.get(id)===request) paper.classList.remove('report-translating'); }
  }

  function readableReportHtml(html) {
    const documentHtml = new DOMParser().parseFromString(html, 'text/html');
    const lead = documentHtml.querySelector('header .lead');
    if (!lead || documentHtml.querySelector('.highlights')) return html;
    const sections = [...documentHtml.querySelectorAll('main > section:not(.sources)')];
    const items = [...sections.map(section => section.querySelector('.item')).filter(Boolean), ...sections.flatMap(section => [...section.querySelectorAll('.item')].slice(1))].slice(0, 3);
    if (!items.length) return html;
    const panel = documentHtml.createElement('section');
    panel.className = 'highlights';
    const heading = documentHtml.createElement('h2');
    heading.textContent = currentLanguage === 'en' ? 'Key takeaways' : '本期要点';
    const list = documentHtml.createElement('ul');
    for (const item of items) {
      const row = documentHtml.createElement('li');
      const strong = documentHtml.createElement('strong');
      strong.textContent = item.querySelector('h3')?.textContent || '';
      const detail = documentHtml.createElement('span');
      detail.textContent = (item.querySelector('p')?.textContent || '').split(/(?<=[。！？.!?])\s*/u)[0].slice(0, 150);
      row.append(strong, detail); list.append(row);
    }
    panel.append(heading,list);
    lead.closest('header').after(panel);
    lead.remove();
    const style = documentHtml.createElement('style');
    style.textContent = '.highlights{margin:26px 0 0;padding:20px 24px;border-radius:15px;background:#e8eee9}.highlights h2{margin:0 0 8px;padding:0;border:0;font-size:1.28rem}.highlights ul{margin:0;padding-left:22px}.highlights li{padding:9px 0}.highlights li+li{border-top:1px solid var(--line)}.highlights strong{display:block}.highlights span{display:block;color:var(--muted)}@media(prefers-color-scheme:dark){.highlights{background:#2a3b35}}';
    documentHtml.head.append(style);
    return '<!doctype html>' + documentHtml.documentElement.outerHTML;
  }

  async function persistSettings() {
    if (!bridge) return;
    if(!q('#runTime').value||!q('#cleanupTime').value||!q('#retentionMonths').checkValidity()){showToast(tr('请完善设置','Complete the settings'),tr('请选择有效时间及保留月份','Choose valid times and retention months'));return;}
    const next = collectSettings();
    if (next.frequency === 'weekly' && !next.weekdays.length) {
      showToast(tr('请选择星期','Choose a weekday'), tr('每周计划至少需要选择一天','A weekly schedule needs at least one day'));
      return;
    }
    preferences = unwrap(await bridge.updateSettings(next));
    refreshScheduleStatus().catch(()=>{});
    refreshDashboardStats().catch(()=>{});
    showToast(currentLanguage === 'zh' ? '设置已保存' : 'Settings saved', currentLanguage === 'zh' ? '计划和本地偏好已更新' : 'Schedule and local preferences were updated');
  }

  function persistPreferencesSilently() {
    if (!bridge || !preferences) return;
    clearTimeout(preferenceTimer);
    preferenceTimer = setTimeout(async () => {
      try { if(!q('#runTime').value||!q('#cleanupTime').value)return;const next=collectSettings(); if(next.frequency==='weekly'&&!next.weekdays.length) return; preferences = unwrap(await bridge.updateSettings(next)); refreshScheduleStatus().catch(()=>{});refreshDashboardStats().catch(()=>{}); } catch (error) { showToast(tr('偏好保存失败','Could not save preferences'), error.message); }
    }, 180);
  }

  function persistOpenTabs() {
    if (!bridge||restoringTabs) return;
    clearTimeout(tabTimer);
    tabTimer = setTimeout(() => {
      const tabs = qAll('#tabs .tab').filter(tab=>tab.dataset.pane==='home'||tab.dataset.pane.startsWith('report-')).map(tab => ({
        id: tab.dataset.pane,
        reportId: tab.dataset.pane.startsWith('report-') ? tab.dataset.pane.slice(7) : null,
        title: q('span', tab)?.textContent || tab.title || tab.dataset.pane,
        active: tab.classList.contains('active')
      }));
      bridge.saveTabs(tabs).then(unwrap).catch(error=>console.warn('[tabs]',error.message));
    }, 120);
  }

  async function verifyModel() {
    const key = q('#apiKey').value.trim();
    const providerId = q('#apiProvider').value;
    const existing = modelsCache.find(item => item.provider === providerId && item.status === 'verified');
    if (!key && !existing) {
      showToast(currentLanguage === 'zh' ? '请输入 API Key' : 'Enter an API key', currentLanguage === 'zh' ? '密钥不能为空' : 'The key cannot be empty');
      q('#apiKey').focus();
      return;
    }
    const button = q('#testApi');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = currentLanguage === 'zh' ? '正在验证…' : 'Verifying…';
    q('#apiProgress').classList.add('show');
    try {
      const selectedModel = q('#apiModel').value;
      const model = selectedModel === 'custom' ? q('#customModel').value.trim() : selectedModel;
      if (!model) throw new Error(tr('请输入自定义模型名','Enter a custom model name'));
      const data = unwrap(await bridge.testAndSaveModel({
        id: `${providerId}-default`, provider:providerId, model, baseUrl: q('#apiBaseUrl').value.trim(), apiKey: key
      }));
      modelsCache = unwrap(await bridge.listModels());
      setModelConnected(data.profile);window.dispatchEvent(new Event('daily-model-saved'));
      q('#apiKey').value = '';
      q('#modal-api').classList.remove('open');
      showToast(currentLanguage === 'zh' ? '模型连接成功' : 'Model connected', `${data.profile.model} · ${data.verification.message}`);
    } catch (error) {
      showToast(currentLanguage === 'zh' ? '连接验证失败' : 'Connection failed', error.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
      q('#apiProgress').classList.remove('show');
    }
  }

  function renderActivity(rows=activityRows){
    rows=rows.slice(0,8);activityRows=rows;const count=rows.filter(row=>!row.read).length;
    q('#activityCount').hidden=!count;q('#activityCount').textContent=count>99?'99+':String(count);
    q('#activityButton').classList.toggle('has-unread',count>0);
    renderHomeActivity();
    const container=q('#activityList');container.replaceChildren();
    q('#activityReadAll').disabled=!count;q('#activityClearAll').disabled=!rows.length;
    if(!rows.length){const p=document.createElement('p');p.textContent=tr('暂无消息','No updates yet');container.append(p);}
    for(const row of rows){const article=document.createElement('article');article.className=`activity-item${row.read?'':' unread'}`;
      const title=document.createElement('strong'),body=document.createElement('p'),time=document.createElement('time'),meta=document.createElement('div');meta.className='activity-meta';
      title.textContent=row.title?.[currentLanguage]||row.title?.en||'';body.textContent=row.body?.[currentLanguage]||row.body?.en||'';time.textContent=new Date(row.createdAt).toLocaleString(currentLanguage==='en'?'en-US':'zh-CN');time.dateTime=row.createdAt;
      meta.append(time);article.append(title,body,meta);if(!row.read){const button=document.createElement('button');button.className='ghost-btn';button.textContent=tr('标为已读','Mark as read');button.onclick=()=>{button.disabled=true;bridge.readActivity(row.id).then(unwrap).then(renderActivity).catch(error=>{button.disabled=false;showToast(tr('操作失败','Action failed'),error.message);});};meta.append(button);}container.append(article);
    }
  }
  const formatBytes=bytes=>{
    const value=Number(bytes)||0;
    if(value<1024)return tr(`${value} B`,`${value} B`);
    const unit=value>=1073741824?'GB':value>=1048576?'MB':'KB';
    const divisor={KB:1024,MB:1048576,GB:1073741824}[unit];
    return `${(value/divisor).toFixed(value/divisor<10?1:0)} ${unit}`;
  };
  function renderHomeActivity(){
    const container=q('#homeActivityList');if(!container)return;
    const rows=activityRows.map(row=>({at:row.createdAt,title:row.title?.[currentLanguage]||row.title?.en||'',detail:row.body?.[currentLanguage]||row.body?.en||'',kind:row.kind}));
    const latest=reportsCache[0];
    if(latest)rows.push({at:latest.created_at,title:tr('最近保存的报告','Latest saved report'),detail:latest.title,kind:'report'});
    if(generationCache?.status==='running')rows.push({at:generationCache.updatedAt,title:tr('正在生成日报','Generating report'),detail:tr(generationCache.stage,`Progress ${generationCache.percent||0}%`),kind:'running'});
    rows.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    const selected=rows.slice(0,2);
    const cleanup=dashboardCache?.cleanup;
    if(cleanup)selected.push({at:cleanup.at,title:cleanup.enabled?tr('下次自动清理','Next automatic cleanup'):tr('自动清理已暂停','Automatic cleanup paused'),detail:cleanup.enabled?new Date(cleanup.at).toLocaleString(currentLanguage==='en'?'en-US':'zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'',kind:'cleanup'});
    container.replaceChildren();
    if(!selected.length){const p=document.createElement('p');p.className='history-empty';p.textContent=tr('暂无运行动态','No activity yet');container.append(p);return;}
    for(const row of selected){const wrap=document.createElement('div'),icon=document.createElement('span'),copy=document.createElement('span'),title=document.createElement('strong'),detail=document.createElement('small');
      wrap.className='source-row';icon.className='source-num';icon.textContent=row.kind==='error'?'!':row.kind==='report'?'✓':row.kind==='cleanup'?'⌁':'•';
      title.textContent=row.title;detail.textContent=row.detail;copy.append(title,detail);wrap.append(icon,copy);container.append(wrap);
    }
  }
  function renderDashboardStats(stats){
    dashboardCache=stats;
    const docs=stats.documents,usage=stats.modelUsage,cleanup=stats.cleanup;
    const count=(value,singular,plural)=>tr(`${value} ${singular}`,`${value} ${plural}`);
    q('#monthlyModelCalls').textContent=count(usage.month.calls,'次','calls');
    q('#monthlyModelCalls').title=tr('自本版本开始记录的本机成功模型响应次数。','Successful model responses recorded on this device since this version.');
    const metered=usage.today.metered_calls,unknown=usage.today.calls-metered;
    q('#todayModelTokens').textContent=metered?`${usage.today.tokens.toLocaleString()}${unknown?'+':''}`:'—';
    q('#todayModelTokens').title=usage.today.calls===0?tr('今日尚无本机模型调用记录；升级前历史用量不可回溯。','No local model calls recorded today; historical usage cannot be recovered.'):unknown?tr(`本机记录 ${usage.today.calls} 次成功响应，其中 ${unknown} 次厂商未返回 Token 用量。`,`Recorded ${usage.today.calls} successful responses; ${unknown} had no token usage from the provider.`):tr('本机记录的模型 API 用量，不含升级前历史记录。','Model API usage recorded on this device since this version.');
    q('#homeDailyCount').textContent=tr(`${docs.daily} 份普通日报`,`${docs.daily} daily ${docs.daily===1?'report':'reports'}`);
    q('#homeDocumentKinds').textContent=tr(`收藏 ${docs.favorites} 份 · 汇聚 ${docs.digest} 份 · 不含回收站`,`Favorites ${docs.favorites} · Digests ${docs.digest} · Trash excluded`);
    q('#homeIndexBytes').textContent=tr(`SQLite 索引 ${formatBytes(docs.indexBytes)}（含回收站元数据）`,`SQLite index ${formatBytes(docs.indexBytes)} (includes Trash metadata)`);
    q('#homeDocumentBytes').textContent=formatBytes(docs.htmlBytes);
    q('#homeDocumentBytes').title=tr('仅有效 HTML 文件大小；SQLite 索引单独计算。','Active HTML only; SQLite index is counted separately.');
    q('#sidebarDocumentSize').textContent=formatBytes(docs.htmlBytes);
    q('#sidebarDocumentCount').textContent=tr(`${docs.total} 份已登记文档 · 不含回收站${docs.missing?` · ${docs.missing} 份文件缺失`:''}`,`${docs.total} registered ${docs.total===1?'document':'documents'} · Trash excluded${docs.missing?` · ${docs.missing} missing`:''}`);
    q('#sidebarDocumentSize').title=docs.missing?tr(`${docs.missing} 份文件无法读取，显示已读取大小。`,`${docs.missing} files could not be read; showing readable files.`):q('#homeDocumentBytes').title;
    q('#homeCleanupState').textContent=cleanup.enabled?tr('自动清理已启用','Automatic cleanup enabled'):tr('自动清理已暂停','Automatic cleanup paused');
    q('#homeCleanupRule').textContent=cleanup.enabled?tr(`保留 ${cleanup.retentionMonths} 个月，保护收藏与汇聚`,`Keep ${cleanup.retentionMonths} months; protect favorites and digests`):tr('收藏与汇聚报告仍受保护','Favorites and digests stay protected');
    q('#homeCleanupTime').textContent=cleanup.enabled?cleanup.cleanupTime:'—';
    const retention=qAll('.status-strip .status-card')[3];
    if(retention){q('strong',retention).textContent=cleanup.enabled?tr(`${cleanup.retentionMonths} 个月`,`${cleanup.retentionMonths} months`):tr('已暂停','Paused');q('small',retention).textContent=cleanup.enabled&&cleanup.due?tr('清理待执行','Cleanup pending'):cleanup.enabled?tr(`下次清理：${new Date(cleanup.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`,`Next cleanup: ${new Date(cleanup.at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}`):tr('不会自动清理普通日报','Daily reports are not automatically cleaned');}
    renderHomeActivity();
  }
  async function refreshDashboardStats(){if(!bridge?.getDashboardStats)return;renderDashboardStats(unwrap(await bridge.getDashboardStats()));}
  async function previewCleanup(){const before=q('#cleanupBefore').value;if(!before)throw new Error(tr('请选择日期','Choose a date'));const rows=unwrap(await bridge.previewCleanup(before));q('#cleanupPreviewText').textContent=tr(`将移入回收站 ${rows.length} 份普通日报，收藏与汇聚已跳过。`,`Move ${rows.length} daily reports to Trash; favorites and digests excluded.`);return rows;}
  let digestRows=[],digestRequest=0;
  function renderDigestSelection(){
    const ids=qAll('#digestFileList input:checked').map(input=>input.value);
    const selected=digestRows.filter(row=>ids.includes(row.id));
    q('#digestCount').textContent=tr(`范围内 ${digestRows.length} 份日报`,`${digestRows.length} reports in range`);
    q('#digestSelectionCount').textContent=tr(`已选 ${selected.length} 份`,`${selected.length} selected`);
    q('#digestNotice').textContent=tr(`成功保存后，将 ${selected.filter(r=>!r.is_favorite).length} 份未收藏原日报移入回收站；收藏保留。失败或取消不删除原文。`,`After saving, move ${selected.filter(r=>!r.is_favorite).length} unfavorited originals to Trash. Favorites remain. Failure or cancellation keeps originals.`);
    q('#digestName').textContent=tr(`自动命名：AI 动态汇总 ${q('#startDate').value} 至 ${q('#endDate').value}`,`Title: AI digest ${q('#startDate').value} – ${q('#endDate').value}`);
    q('#createDigest').disabled=selected.length<2||selected.length>100;
  }
  async function loadDigestPreview(){
    if(!bridge?.previewDigest)return;const request=++digestRequest;q('#createDigest').disabled=true;
    q('#digestFileList').textContent=tr('正在读取本地日报…','Loading local reports…');
    try{const rows=unwrap(await bridge.previewDigest({start:q('#startDate').value,end:q('#endDate').value}));if(request!==digestRequest)return;digestRows=rows;
      q('#digestFileList').innerHTML=rows.length?rows.map(row=>`<label class="file-row"><input type="checkbox" value="${escapeHtml(row.id)}" ${row.available?'checked':'disabled'} /><div><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.period_start)} · ${row.available?'HTML':tr('文件不可用','File unavailable')}</small></div>${row.is_favorite?`<span class="protected">${tr('★ 收藏保留','★ Favorite retained')}</span>`:''}</label>`).join(''):`<p>${tr('该日期范围没有普通日报，请调整日期。','No daily reports in this range. Choose different dates.')}</p>`;renderDigestSelection();
    }catch(error){if(request!==digestRequest)return;digestRows=[];q('#digestFileList').textContent=error.message;renderDigestSelection();q('#createDigest').disabled=true;}
  }
  q('#startDate').addEventListener('change',loadDigestPreview);q('#endDate').addEventListener('change',loadDigestPreview);q('#digestFileList').addEventListener('change',renderDigestSelection);
  document.addEventListener('click',event=>{
    if(!bridge)return;
    if(event.target.closest('[data-modal="digest"]')){
      event.preventDefault();event.stopImmediatePropagation();openModal('digest');if(!hasApiKey)return;
      const day=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      if(!q('#endDate').value){const end=new Date(),start=new Date();start.setDate(start.getDate()-6);q('#startDate').value=day(start);q('#endDate').value=day(end);}loadDigestPreview();
    }
    if(event.target.closest('#createDigest')){
      event.preventDefault();event.stopImmediatePropagation();const button=q('#createDigest');if(button.disabled)return;button.disabled=true;
      const selection={start:q('#startDate').value,end:q('#endDate').value,ids:qAll('#digestFileList input:checked').map(i=>i.value)};
      bridge.createDigest(selection).then(unwrap).then(result=>{if(result.status==='model_required'){q('#modal-digest').classList.remove('open');openModal('api');return;}q('#modal-digest').classList.remove('open');if(result.progress)updateGenerationProgress(result.progress);showToast(result.status==='running'?tr('任务正在运行','Task running'):tr('汇聚任务已启动','Digest task started'),result.status==='running'?tr('已有任务正在处理，本次未另建汇聚任务','An existing task is running; no new digest was started'):tr('可在右下角查看进度或取消','Track or cancel it in the lower-right corner'));}).catch(error=>showToast(tr('无法汇聚','Could not create digest'),error.message)).finally(renderDigestSelection);
    }
  },true);

  window.refreshDailyAIMode=()=>hydrate();
  async function hydrate() {
    if (!bridge) return;
    try {
      const data = unwrap(await bridge.bootstrap());
      q('#appVersion').textContent=data.appVersion?'v'+data.appVersion:'v—';q('#aboutVersion').textContent=data.appVersion||'—';
      providerCatalog = unwrap(await bridge.modelCatalog());
      if(bridge.getSearchConfig)bridge.getSearchConfig().then(unwrap).then(value=>{searchConfig=value;renderSearchConfig();}).catch(()=>{});
      modelsCache = data.models || [];
      applyProviderPreset('glm');
      applyPersistedSettings(data.settings);
      q('#currentDataDirectory').value=data.dataPath;
      refreshScheduleStatus().catch(()=>{});
      renderRealReports(data.reports || []);
      renderTrash(data.trash || []);
      renderTopics(data.topics || []);
      q('#sidebarDataPath').textContent=tr(`当前路径 ${data.dataPath}`,`Current path ${data.dataPath}`);
      refreshDashboardStats().catch(error=>{q('#sidebarDocumentSize').textContent='—';q('#sidebarDocumentCount').textContent=tr('无法读取存储统计','Storage statistics unavailable');console.warn('[dashboard stats]',error);});
      if(bridge.listActivity)bridge.listActivity().then(unwrap).then(renderActivity).catch(()=>{});
      const model = data.models.find(item => item.is_default && item.status === 'verified');
      if(model?.provider==='managed')setModelConnected(model);
      else if (model) { setModelConnected(model); applyProviderPreset(model.provider); q('#apiBaseUrl').value = model.base_url; modelOptions([],model.model); }
      if(!model){hasApiKey=false;q('#modelConnectionCard')?.classList.add('api-empty');q('#modelStatusName').textContent=tr('尚未配置','Not configured');q('#modelStatusText').textContent=tr('需要添加可用 API Key','Add a working API key');q('#settingsModelState').textContent=tr('当前没有已验证的 API Key','No verified API key');}
      if(!tabsRestored){
        const savedTabs=data.tabs||[];
        for(const saved of savedTabs){const report=reportsCache.find(r=>r.id===(saved.report_id||saved.reportId));if(!report)continue;openReport(saved.title||report.title,report.report_type,report.id);const pane=q('.view[data-pane="report-'+CSS.escape(report.id)+'"]');pane.dataset.unloaded='true';q('.report-paper',pane).textContent=tr('选择此标签加载报告','Select this tab to load the report');}
        const active=savedTabs.find(t=>t.is_active||t.active),id=active?.report_id||active?.reportId;
        if(id&&reportsCache.some(r=>r.id===id)){await openRealReport(id);delete q('.view[data-pane="report-'+CSS.escape(id)+'"]').dataset.unloaded;}else activatePane('home');
        tabsRestored=true;
      }
      restoringTabs=false;persistOpenTabs();
      const generation = unwrap(await bridge.getGenerationState());
      updateGenerationProgress(generation);
      const dataPathLabels = qAll('.storage-card small, .setting-copy small');
      dataPathLabels.forEach(node => {
        if (node.textContent.includes('D:\\Daily-AI-Data') || node.dataset.dataPath==='true') {node.dataset.dataPath='true';node.textContent = data.dataPath;}
      });
      bridge.updateHealthy?.().catch(()=>{});
    } catch (error) {
      restoringTabs=false;showToast(tr('初始化失败','Initialization failed'), error.message);
    }
  }

  document.addEventListener('click', event => {
    if(event.target.closest('#saveSearchKey')&&bridge?.saveSearchConfig){event.preventDefault();event.stopImmediatePropagation();const button=q('#saveSearchKey');button.disabled=true;bridge.saveSearchConfig(q('#exaSearchKey').value).then(unwrap).then(value=>{searchConfig=value;q('#exaSearchKey').value='';renderSearchConfig();showToast(tr('搜索密钥已保存','Search key saved'),tr('下次检索将使用新配置','The next search will use this configuration'));}).catch(error=>showToast(tr('保存失败','Save failed'),error.message)).finally(()=>button.disabled=false);return;}
    const action=event.target.closest('#quitConfirm,#quitCancel,#activityButton,#activityReadAll,#activityClearAll,#saveCleanup,#previewCleanup,#runCleanup');
    if(action&&bridge){event.preventDefault();event.stopImmediatePropagation();
      if(action.id==='quitConfirm')bridge.confirmQuit();
      if(action.id==='quitCancel'){q('#modal-quit').classList.remove('open');}
      if(action.id==='activityButton'){renderActivity();openModal('activity');}
      if(action.id==='activityClearAll')bridge.clearActivity().then(unwrap).then(renderActivity).catch(error=>showToast(tr('操作失败','Action failed'),error.message));
      if(action.id==='activityReadAll')bridge.readActivity('all').then(unwrap).then(renderActivity).catch(error=>showToast(tr('操作失败','Action failed'),error.message));
      if(action.id==='saveCleanup'){
        if(!q('#retentionMonths').reportValidity()||!q('#cleanupTime').reportValidity())return;
        preferences=collectSettings();bridge.updateSettings(preferences).then(unwrap).then(()=>{q('#modal-cleanup').classList.remove('open');refreshDashboardStats().catch(()=>{});showToast(tr('清理规则已保存','Cleanup rules saved'),tr('收藏与汇聚报告受保护','Favorites and digests are protected'));}).catch(error=>showToast(tr('保存失败','Save failed'),error.message));
      }
      if(action.id==='previewCleanup')previewCleanup().catch(error=>showToast(tr('预览失败','Preview failed'),error.message));
      if(action.id==='runCleanup')previewCleanup().then(rows=>{q('#modal-cleanup').classList.remove('open');const before=q('#cleanupBefore').value;confirmAction(tr('确认清理','Confirm cleanup'),rows.map(row=>row.title).join('\n')||tr('没有符合条件的日报','No eligible reports'),async()=>{unwrap(await bridge.runCleanup(before));await refreshReports();});}).catch(error=>showToast(tr('清理失败','Cleanup failed'),error.message));
      return;
    }
    if(event.target.closest('[data-modal="cleanup"]')){q('#cleanupPreviewText').textContent=tr('先预览符合条件的文档，再确认移入回收站。','Preview eligible documents before moving them to Trash.');}

    const reportTab=event.target.closest('.tab[data-pane^="report-"],[data-tab-select^="report-"]');
    if(reportTab&&!event.target.closest('.close,[data-tab-close]')){const paneName=reportTab.dataset.pane||reportTab.dataset.tabSelect;const pane=q('.view[data-pane="'+CSS.escape(paneName)+'"]');if(pane?.dataset.unloaded==='true'){delete pane.dataset.unloaded;openRealReport(paneName.slice(7)).catch(error=>showToast(tr('打开失败','Could not open report'),error.message));}}
    if(reportTab&&bridge?.markReportRead&&!event.target.closest('.close,[data-tab-close]'))bridge.markReportRead((reportTab.dataset.pane||reportTab.dataset.tabSelect).slice(7)).catch(()=>{});
    const month=event.target.closest('[data-history-month]');
    if(month){event.preventDefault();event.stopImmediatePropagation();selectedMonth=month.dataset.historyMonth;q('#historyMonthMenu').hidePopover();renderRealReports(reportsCache);q('#historyMonthButton').focus();return;}
    if(event.target.closest('#emptyTrash')&&bridge){
      event.preventDefault();event.stopImmediatePropagation();
      confirmAction(tr('清空回收站','Empty Trash?'),tr(`将永久删除回收站中的 ${trashCache.length} 份报告（含原收藏和汇聚），无法恢复。`,`Permanently delete all ${trashCache.length} reports in Trash, including former favorites and digests? This cannot be undone.`),async()=>{
        q('#emptyTrash').disabled=true;
        try{const result=unwrap(await bridge.emptyTrash());await refreshReports();showToast(tr('回收站清理完成','Trash cleanup finished'),tr(`已删除 ${result.deleted} 份，失败 ${result.failed.length} 份`,`Deleted ${result.deleted}; failed ${result.failed.length}`));}
        finally{q('#emptyTrash').disabled=trashCache.length===0;}
      });return;
    }
    if(event.target.closest('#cancelGeneration,#generationHeaderCancel')&&bridge){event.preventDefault();event.stopImmediatePropagation();const buttons=[q('#cancelGeneration'),q('#generationHeaderCancel')];buttons.forEach(button=>button.disabled=true);bridge.cancelGeneration().then(unwrap).then(updateGenerationProgress).catch(error=>showToast(tr('取消失败','Could not cancel'),error.message)).finally(()=>buttons.forEach(button=>button.disabled=false));return;}
    if(event.target.closest('#chooseDataDirectory')&&bridge){event.preventDefault();event.stopImmediatePropagation();bridge.chooseDataDirectory().then(unwrap).then(value=>{if(value)q('#newDataDirectory').value=value;}).catch(error=>showToast(tr('选择失败','Could not select folder'),error.message));return;}
    if(event.target.closest('#startMigration')&&bridge){
      event.preventDefault();event.stopImmediatePropagation();
      const button=q('#startMigration');button.disabled=true;q('#chooseDataDirectory').disabled=true;q('#modal-migrate').dataset.busy='true';qAll('#modal-migrate [data-close]').forEach(b=>b.disabled=true);
      q('#migrateProgress').classList.add('show');
      q('#migrateProgress .progress-text span').textContent=tr('正在复制和校验…','Copying and verifying…');
      bridge.migrateData(q('#newDataDirectory').value.trim()).then(unwrap).then(async result=>{
        q('#modal-migrate').classList.remove('open');await hydrate();
        showToast(tr('数据目录已切换','Data directory changed'),tr(`原目录保留为备份：${result.previousPath}`,`The original directory remains as a backup: ${result.previousPath}`));
      }).catch(error=>{q('#migrateProgress .progress-text span').textContent=tr('迁移未完成，原目录仍可用','Migration failed; the original remains available');showToast(tr('迁移失败','Migration failed'),error.message);}).finally(()=>{button.disabled=false;q('#chooseDataDirectory').disabled=false;q('#modal-migrate').dataset.busy='false';qAll('#modal-migrate [data-close]').forEach(b=>b.disabled=false);});return;
    }
    const windowAction = event.target.closest('[data-window-action]');
    if (windowAction && bridge) {
      const action = windowAction.dataset.windowAction;
      if (action === 'close') bridge.windowClose();
      if (action === 'minimize') bridge.windowMinimize();
      if (action === 'maximize') bridge.windowToggleMaximize();
      return;
    }
    if (event.target.closest('#testApi') && bridge) {
      event.preventDefault(); event.stopImmediatePropagation(); verifyModel(); return;
    }
    if (event.target.closest('#generateNow') && bridge) {
      event.preventDefault(); event.stopImmediatePropagation(); createDailyReport(); return;
    }
    if (event.target.closest('#addTopic,#addTopicSettings') && bridge) {
      event.preventDefault(); event.stopImmediatePropagation(); openTopicEditor(); return;
    }
    const topicEdit = event.target.closest('[data-topic-edit]');
    if (topicEdit && bridge) { event.preventDefault(); event.stopImmediatePropagation(); openTopicEditor(topicEdit.dataset.topicEdit); return; }
    if (event.target.closest('#saveTopic') && bridge) {
      event.preventDefault(); event.stopImmediatePropagation(); saveNewTopic(); return;
    }
    if (event.target.closest('#deleteTopic') && bridge && editingTopicId) {
      event.preventDefault(); event.stopImmediatePropagation();
      const id = editingTopicId;
      const topic = topicsCache.find(item => item.id === id);
      confirmAction(tr('永久删除主题','Delete topic permanently?'), tr(`删除“${topic?.name_zh || '该主题'}”后，下一份日报将不再包含它。`, `Delete “${topic?.name_en || topic?.name_zh || 'this topic'}”? Future reports will no longer include it.`), async () => {
        unwrap(await bridge.deleteTopic(id));
        editingTopicId = null;
        renderTopics(unwrap(await bridge.listTopics()));
        showToast(tr('主题已删除','Topic deleted'), tr('历史日报保持不变','Existing reports are unchanged'));
      });
      return;
    }
    if (event.target.closest('#confirmAction') && pendingConfirmation) {
      event.preventDefault(); event.stopImmediatePropagation();
      const action = pendingConfirmation; pendingConfirmation = null;
      q('#modal-confirm').classList.remove('open');
      Promise.resolve().then(action).catch(error => showToast(tr('操作失败','Action failed'), error.message));
      return;
    }
    const topicToggle = event.target.closest('[data-topic-toggle]');
    if (topicToggle && bridge) {
      event.preventDefault(); event.stopImmediatePropagation();
      const id = topicToggle.dataset.topicToggle;
      bridge.setTopicEnabled(id, !topicToggle.classList.contains('on')).then(unwrap).then(() => bridge.listTopics()).then(unwrap).then(renderTopics).catch(error => showToast(tr('主题更新失败','Could not update topic'),error.message));
      return;
    }
    if (event.target.closest('#sidebarToggle')) {
      event.preventDefault(); event.stopImmediatePropagation();
      q('.app-shell')?.classList.toggle('sidebar-collapsed');
      updateSidebarToggle(); persistPreferencesSilently(); return;
    }
    if (event.target.closest('#generationProgressToggle')) {
      event.preventDefault(); event.stopImmediatePropagation();
      const panel = q('#generationProgress');
      panel?.classList.toggle('collapsed');
      const collapsed = panel?.classList.contains('collapsed');
      const button = q('#generationProgressToggle');
      if (button) { button.title = collapsed ? tr('展开','Expand') : tr('收起','Collapse'); button.setAttribute('aria-label', button.title); }
      return;
    }
    if (event.target.closest('#generationProgressClose')) {
      event.preventDefault(); event.stopImmediatePropagation();
      const panel = q('#generationProgress');
      if (!panel.classList.contains('failed') && !panel.classList.contains('completed')) return;
      dismissedGenerationAt = lastGenerationAt;
      panel.hidden = true;
      return;
    }
    const scheduleToggle = event.target.closest('#autoScheduleToggle,#settingsAutoScheduleToggle');
    if (scheduleToggle) {
      setTimeout(() => {
        const enabled = scheduleToggle.classList.contains('on');
        qAll('#autoScheduleToggle,#settingsAutoScheduleToggle').forEach(button => button.classList.toggle('on', enabled));
        if (q('#autoScheduleLabel')) q('#autoScheduleLabel').textContent = enabled ? tr('已启用','Enabled') : tr('已暂停','Paused');
        persistPreferencesSilently();
      });
    }
    if (event.target.closest('#saveSettings') && bridge) {
      event.preventDefault(); event.stopImmediatePropagation(); persistSettings().catch(error => showToast(tr('保存失败','Save failed'), error.message));
    }
    const filter = event.target.closest('[data-favorite-filter]');
    if (filter) { event.preventDefault(); event.stopImmediatePropagation(); favoriteFilter = filter.dataset.favoriteFilter; qAll('[data-favorite-filter]').forEach(button => button.classList.toggle('active',button === filter)); renderRealReports(reportsCache); return; }
    const providerPick = event.target.closest('[data-provider-pick]');
    if (providerPick && bridge) { event.preventDefault(); event.stopImmediatePropagation(); applyProviderPreset(providerPick.dataset.providerPick); openModal('api'); return; }
    const paperAction=event.target.closest('.js-report-star,.js-report-reveal,.js-report-more');
    if(paperAction&&bridge){
      const id=paperAction.closest('.view')?.dataset.pane?.slice(7);
      if(id){event.preventDefault();event.stopImmediatePropagation();
        if(paperAction.matches('.js-report-star'))toggleReportFavorite(id).catch(error=>showToast(tr('收藏失败','Could not update favorite'),error.message));
        else if(paperAction.matches('.js-report-reveal'))bridge.revealReport(id).then(unwrap).catch(error=>showToast(tr('打开失败','Could not open file location'),error.message));
        else {selectedReportId=id;const report=reportsCache.find(r=>r.id===id);q('#reportActionTitle').textContent=report?.title||'';q('#reportActionFavorite').textContent=report?.is_favorite?tr('取消收藏','Remove favorite'):tr('加入收藏','Add to favorites');openModal('report-actions');}
        return;
      }
    }
    const reportMore = event.target.closest('[data-report-more]');
    if (reportMore && bridge) {
      event.preventDefault(); event.stopImmediatePropagation();
      selectedReportId = reportMore.dataset.reportMore;
      const report = reportsCache.find(item => item.id === selectedReportId);
      q('#reportActionTitle').textContent = report?.title || tr('管理报告','Manage report');
      q('#reportActionFavorite').textContent = report?.is_favorite ? tr('取消收藏','Remove favorite') : tr('加入收藏','Add to favorites');
      openModal('report-actions'); return;
    }
    if (event.target.closest('#reportActionOpen') && selectedReportId) {
      event.preventDefault(); event.stopImmediatePropagation(); q('#modal-report-actions').classList.remove('open');
      const report = reportsCache.find(item => item.id === selectedReportId);
      openRealReport(selectedReportId, report?.title, report?.report_type).catch(error => showToast(tr('打开失败','Could not open report'),error.message)); return;
    }
    if (event.target.closest('#reportActionFavorite') && selectedReportId) {
      event.preventDefault(); event.stopImmediatePropagation(); q('#modal-report-actions').classList.remove('open');
      toggleReportFavorite(selectedReportId).catch(error => showToast(tr('收藏失败','Could not update favorite'),error.message)); return;
    }
    if (event.target.closest('#reportActionTrash') && selectedReportId) {
      event.preventDefault(); event.stopImmediatePropagation(); q('#modal-report-actions').classList.remove('open'); requestTrashReport(selectedReportId); return;
    }
    const tileFavorite = event.target.closest('[data-report-favorite]');
    if (tileFavorite && bridge) { event.preventDefault(); event.stopImmediatePropagation(); toggleReportFavorite(tileFavorite.dataset.reportFavorite).catch(error => showToast(tr('收藏失败','Could not update favorite'),error.message)); return; }
    const tileTrash = event.target.closest('[data-report-trash]');
    if (tileTrash && bridge) { event.preventDefault(); event.stopImmediatePropagation(); requestTrashReport(tileTrash.dataset.reportTrash); return; }
    const restore = event.target.closest('[data-report-restore]');
    if (restore && bridge) { event.preventDefault(); event.stopImmediatePropagation(); bridge.restoreReport(restore.dataset.reportRestore).then(unwrap).then(refreshReports).then(() => showToast(tr('报告已恢复','Report restored'),tr('可在历史记录中查看','Find it in History'))).catch(error => showToast(tr('恢复失败','Restore failed'),error.message)); return; }
    const deleteForever = event.target.closest('[data-report-delete]');
    if (deleteForever && bridge) {
      event.preventDefault(); event.stopImmediatePropagation();
      const id = deleteForever.dataset.reportDelete;
      const report = trashCache.find(item => item.id === id);
      confirmAction(tr('永久删除报告','Delete report permanently?'), tr(`“${report?.title || '该报告'}”的 HTML 文件将被永久删除，无法恢复。`, `The HTML file for “${report?.title || 'this report'}” will be deleted permanently.`), async () => { unwrap(await bridge.deleteReportForever(id)); await refreshReports(); showToast(tr('已永久删除','Permanently deleted'),tr('本地文件和记录已清除','Local file and record removed')); });
      return;
    }
    const tileOpen = event.target.closest('[data-report-open]');
    if (tileOpen && bridge) { event.preventDefault(); event.stopImmediatePropagation(); const report = reportsCache.find(item => item.id === tileOpen.dataset.reportOpen); openRealReport(tileOpen.dataset.reportOpen,report?.title,report?.report_type).catch(error => showToast(tr('打开失败','Could not open report'),error.message)); return; }
    const favorite = event.target.closest('.star-mini');
    const reportItem = favorite?.closest('[data-report-id]');
    if (favorite && reportItem && bridge) {
      event.preventDefault(); event.stopImmediatePropagation();
      toggleReportFavorite(reportItem.dataset.reportId).catch(error => showToast(tr('收藏失败','Could not update favorite'), error.message));
      return;
    }
    const report = event.target.closest('[data-report-id]');
    if (report && bridge) {
      event.preventDefault(); event.stopImmediatePropagation();
      openRealReport(report.dataset.reportId, report.dataset.title, report.dataset.report || 'daily').catch(error => showToast(tr('无法打开报告','Could not open report'), error.message));
      return;
    }
    const external = event.target.closest('a[href^="http://"],a[href^="https://"]');
    if (external && bridge) { event.preventDefault(); bridge.openExternal(external.href); }
  }, true);

  document.addEventListener('dblclick', event => {
    if (event.target.closest('.topbar') && !event.target.closest('button,input,.tabs-overflow') && bridge) bridge.windowToggleMaximize();
  });

  qAll('#themeSegment button').forEach(button => button.addEventListener('click', () => { if (bridge) bridge.setTheme(button.dataset.themeValue); persistPreferencesSilently(); }));
  q('#apiModel')?.addEventListener('change', event => { q('#customModelField').hidden = event.target.value !== 'custom'; });
  q('#apiProvider')?.addEventListener('change', event => applyProviderPreset(event.target.value));
  q('#refreshModels')?.addEventListener('click',discoverModelOptions);
  for(const id of ['apiKey','apiBaseUrl'])q('#'+id)?.addEventListener('change',discoverModelOptions);
  q('#apiPlan')?.addEventListener('change',discoverModelOptions);
  for(const id of ['apiKey','apiBaseUrl'])q('#'+id)?.addEventListener('input',()=>{++modelDiscoverySequence;q('#refreshModels').disabled=!q('#apiKey').value.trim()&&!modelsCache.some(m=>m.provider===q('#apiProvider').value&&m.status==='verified'&&(m.base_url||'').replace(/\/+$/,'')===q('#apiBaseUrl').value.trim().replace(/\/+$/,''));const selected=q('#apiModel').value;if(selected!=='custom')q('#customModel').value=selected;q('#apiModel').innerHTML=`<option value="custom">${tr('手动填写模型名','Enter model name')}</option>`;q('#customModelField').hidden=false;q('#modelDiscoveryStatus').textContent=tr('连接已修改，完成输入后重新获取模型。','Connection changed. Finish editing to refresh models.');});
  new MutationObserver(()=>{if(q('#modal-api').classList.contains('open'))discoverModelOptions();else ++modelDiscoverySequence;}).observe(q('#modal-api'),{attributes:true,attributeFilter:['class']});
  q('#historySearch').addEventListener('input',()=>renderRealReports(reportsCache));
  q('#compactSidebarToggle').addEventListener('click',()=>setTimeout(()=>{const active=q('#compactSidebarToggle').classList.contains('on');q('.app-shell').classList.toggle('sidebar-compact',active);q('#compactSidebarToggle').setAttribute('aria-pressed',String(active));persistPreferencesSilently();}));
  qAll('.status-card[role=button]').forEach(card=>card.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();card.click();}}));
  q('#historyMonth')?.addEventListener('change', event => { selectedMonth = event.target.value; renderRealReports(reportsCache); });
  q('#historyMonthButton')?.addEventListener('click',()=>{
    const rect=q('#historyMonthButton').getBoundingClientRect(),menu=q('#historyMonthMenu');
    menu.style.left=`${rect.left}px`;menu.style.top=`${Math.min(rect.bottom+6,window.innerHeight-300)}px`;menu.style.width=`${Math.max(210,rect.width)}px`;
  });
  q('#historyMonthMenu')?.addEventListener('keydown',event=>{
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();
    const items=qAll('#historyMonthMenu button'),index=items.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();
  });
  window.addEventListener('resize',()=>q('#historyMonthMenu')?.hidePopover());
  bridge?.onQuitRequest?.(()=>{q('#quitTitle').textContent=tr('确认退出 Daily AI','Quit Daily AI?');q('#quitMessage').textContent=tr('退出将无法接受最新AI动态，确认退出？','You will no longer receive the latest AI updates after quitting. Quit Daily AI?');openModal('quit');q('#quitCancel').focus();});
  bridge?.onActivity?.(rows=>{renderActivity(rows);refreshReports().catch(()=>{});});
  bridge?.onActivityOpen?.(()=>{renderActivity();openModal('activity');});
  bridge?.onMigrationProgress?.(progress=>{q('#migrateProgress .progress-line i').style.width=`${progress.percent}%`;q('#migrateProgress .progress-text span:last-child').textContent=`${progress.percent}%`;});
  qAll('#languageSegment button').forEach(button => button.addEventListener('click', () => { persistPreferencesSilently(); setTimeout(()=>refreshScheduleStatus().catch(()=>{})); }));
  q('#languageToggle')?.addEventListener('click', () => { persistPreferencesSilently(); setTimeout(()=>refreshScheduleStatus().catch(()=>{})); });
  qAll('#languageSegment button,#languageToggle').forEach(button => button.addEventListener('click', () => {
    setTimeout(() => {
      renderRealReports(reportsCache);
      renderTrash(trashCache);
      renderTopics(topicsCache);renderActivity();q('#sidebarDataPath').textContent=tr(`当前路径 ${q('#currentDataDirectory').value}`,`Current path ${q('#currentDataDirectory').value}`);
      if(dashboardCache)renderDashboardStats(dashboardCache);
      renderSearchConfig();if(q('#modal-digest').classList.contains('open'))loadDigestPreview();
      const active = modelsCache.find(model => model.is_default && model.status === 'verified');
      if (active) setModelConnected(active);
      updateSidebarToggle();
      if (q('#autoScheduleLabel')) q('#autoScheduleLabel').textContent = q('#autoScheduleToggle').classList.contains('on') ? tr('已启用','Enabled') : tr('已暂停','Paused');
      for (const pane of qAll('.view[data-pane^="report-"]')) {
        const id=pane.dataset.pane.slice('report-'.length);
        const paper=q('.report-paper',pane);
        if (!paper?.querySelector('.report-frame')) continue;
        bridge.getReportContent(id).then(unwrap).then(data=>showReportLanguage(id,data.html,paper)).catch(error=>showToast(tr('报告切换语言失败','Could not change report language'),error.message));
      }
    }, 0);
  }));
  q('#themeQuick')?.addEventListener('click', persistPreferencesSilently);
  q('#frequency')?.addEventListener('change',persistPreferencesSilently);
  q('#runTime')?.addEventListener('change',persistPreferencesSilently);
  q('#weekdayPicker')?.addEventListener('click',event=>{ if(event.target.closest('[data-day]')) setTimeout(persistPreferencesSilently); });
  q('#launchAtLoginToggle')?.addEventListener('click',()=>setTimeout(persistPreferencesSilently));
  q('#notificationsToggle').addEventListener('click',()=>setTimeout(persistPreferencesSilently));
  q('#reportLanguage').addEventListener('change',persistPreferencesSilently);
  new MutationObserver(persistOpenTabs).observe(q('#tabs'), { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
  if (bridge?.onGenerationProgress) generationUnsubscribe = bridge.onGenerationProgress(updateGenerationProgress);
  const progressReconciler=bridge?.getGenerationState?setInterval(()=>{
    if(generationCache?.status==='running'){
      const observedTaskId=generationCache.taskId;
      bridge.getGenerationState().then(unwrap).then(state=>{
        if(generationCache?.status==='running'&&generationCache.taskId===observedTaskId)updateGenerationProgress(state);
      }).catch(()=>{});
    }
  },4000):null;
  window.addEventListener('beforeunload', () => {generationUnsubscribe?.();clearInterval(progressReconciler);clearTimeout(terminalHideTimer);});
  window.addEventListener('focus',()=>{const pane=q('.view.active[data-pane^="report-"]');if(pane&&bridge?.markReportRead)bridge.markReportRead(pane.dataset.pane.slice(7)).catch(()=>{});});
  window.addEventListener('focus',()=>refreshDashboardStats().catch(()=>{}));
  document.addEventListener('daily-dialog-closed',event=>{if(event.detail.id==='modal-confirm')pendingConfirmation=null;});
  hydrate();
})();
