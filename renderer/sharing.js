(()=>{
 const $=s=>document.querySelector(s),t=(z,e)=>document.documentElement.lang.startsWith('en')?e:z;
 const dialog=document.createElement('dialog');dialog.className='daily-dialog share-dialog';document.body.append(dialog);
 let reportId=null,share=null,revision=0,busy=false;
 const request=async(fn,...args)=>{const r=await fn(...args);if(!r?.ok)throw Object.assign(new Error(r?.error?.message||'Request failed'),{code:r?.error?.code});return r.data;};
 function render(message='',auth=false){
  dialog.innerHTML=`<header class="account-head"><h2>${t('文档分享','Share document')}</h2><button class="icon-btn" data-share-action="close" aria-label="${t('关闭','Close')}"><svg class="icon"><use href="#i-close"/></svg></button></header><p>${t('一个文档，一个链接。在这里管理访问权限；关闭分享后链接立即失效。','One document, one link. Manage access here; turning sharing off disables the link immediately.')}</p><div class="v020-note">${share?.active?t('链接分享已开启 · 持有链接的人可以阅读','Link sharing on · Anyone with the link can read'):t('仅自己可见 · 尚未公开分享','Private · Link sharing is off')}</div><p id="shareStatus" role="status"></p>${share?.active?`<div class="share-url" id="shareLinkRow"><input id="realShareUrl" readonly aria-label="${t('分享链接','Share link')}"><button class="secondary-btn" data-share-action="copy">${t('复制','Copy')}</button></div><p>${t('此链接展示分享时的文档快照。','This link displays the document snapshot you shared.')}</p><div class="account-actions"><button class="danger-btn" data-share-action="revoke">${t('关闭分享','Turn off sharing')}</button></div>`:`<label class="share-consent"><input id="shareAllowed" type="checkbox"><span>${t('我同意公开这份文档，任何持有链接的人均可查看','I consent to making this document accessible to anyone with its link')}</span></label><div class="account-actions"><button class="primary-btn" id="makeRealShare" data-share-action="${auth?'login':'create'}">${auth?t('登录后分享','Sign in to share'):share?t('重新开启原链接','Enable the same link'):t('开启链接分享','Enable link sharing')}</button></div>`}`;
  $('#shareStatus').textContent=message;if(share?.active)$('#realShareUrl').value=share.url;
 }
 async function open(id){
  revision++;const current=revision;reportId=id;share=null;busy=true;
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelectorAll('.overlay.open').forEach(d=>d.classList.remove('open'));
  render(t('正在读取分享状态…','Loading sharing status…'));dialog.showModal();dialog.querySelectorAll('button:not([data-share-action="close"])').forEach(b=>b.disabled=true);
  try{const row=await request(window.dailyAI.shareState,id);if(current!==revision||!dialog.open)return;share=row;render();}catch(e){if(current===revision&&dialog.open)render(e.message,['AUTH','USER_DISABLED'].includes(e.code));}finally{if(current===revision)busy=false;}
 }
 dialog.addEventListener('close',()=>{revision++;busy=false;});
 dialog.addEventListener('click',async e=>{
  const action=e.target.closest('[data-share-action]')?.dataset.shareAction;if(!action)return;
  if(action==='close'){dialog.close();return;}if(busy)return;
  if(action==='login'){dialog.close();window.dailyOpenLogin?.();return;}
  if(action==='copy'){try{await navigator.clipboard.writeText(share.url);$('#shareStatus').textContent=t('链接已复制','Link copied');}catch{$('#realShareUrl').select();$('#shareStatus').textContent=t('请按 Ctrl+C 复制','Press Ctrl+C to copy');}return;}
  if(action==='revoke'){const button=e.target.closest('button');button.dataset.shareAction='confirm-revoke';button.textContent=t('确认关闭分享','Confirm turning off');$('#shareStatus').textContent=t('关闭后链接失效，已下载的副本无法收回。','The link will stop working. Downloaded copies cannot be recalled.');return;}
  if(action==='create'&&!$('#shareAllowed').checked){$('#shareStatus').textContent=t('请先确认公开分享','Confirm public sharing first');return;}
  const current=revision,id=reportId;busy=true;e.target.closest('button').disabled=true;
  try{if(action==='create'){const row=await request(window.dailyAI.createShare,{id,consent:true});if(current!==revision||!dialog.open)return;share=row;render(t('分享链接已就绪','Your share link is ready'));}else if(action==='confirm-revoke'){await request(window.dailyAI.revokeShare,share.id);if(current!==revision||!dialog.open)return;share={...share,active:false};render(t('已关闭分享','Sharing turned off'));}}
  catch(err){if(current===revision&&dialog.open)render(err.message,['AUTH','USER_DISABLED'].includes(err.code));}finally{if(current===revision)busy=false;}
 });
 function buttons(){document.querySelectorAll('.view[data-pane^="report-"] .paper-actions').forEach(el=>{let button=el.querySelector('[data-live-share]');if(!button){button=document.createElement('button');button.className='icon-btn';button.dataset.liveShare=el.closest('.view').dataset.pane.slice(7);button.innerHTML='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';button.onclick=()=>open(button.dataset.liveShare);el.append(button);}button.title=t('分享设置','Sharing settings');button.setAttribute('aria-label',button.title);});}
 new MutationObserver(buttons).observe($('#viewport')||$('.viewport'),{childList:true,subtree:true});
 new MutationObserver(()=>{buttons();if(dialog.open)render();}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
})();
