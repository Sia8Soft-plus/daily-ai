(() => {
  const dialogs=[...document.querySelectorAll('.overlay')];
  let active=null,origin=null;
  const focusable=dialog=>[...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(el=>!el.disabled&&!el.hidden&&el.getClientRects().length);
  const first={'modal-topic':'topicName','modal-api':'apiKey','modal-confirm':null,'modal-quit':'quitCancel','modal-digest':'startDate','modal-migrate':'newDataDirectory','modal-cleanup':'retentionMonths'};
  function sync(){
    const next=dialogs.find(el=>el.classList.contains('open'))||null;
    if(next===active){if(next)next.setAttribute('aria-busy',String(next.dataset.busy==='true'));return;}
    if(next&&!active)origin=document.activeElement;
    document.querySelector('.app-shell').inert=!!next;
    const previous=active;active=next;
    if(previous?.id==='modal-quit'&&next?.id!=='modal-quit')window.dailyAI?.cancelQuit().catch(()=>{});
    if(next){
      document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
      next.setAttribute('aria-busy',String(next.dataset.busy==='true'));
      const target=document.getElementById(first[next.id])||next.querySelector('[data-close]')||focusable(next)[0];
      target?.focus({preventScroll:true});
    }else{
      if(origin?.isConnected)origin.focus({preventScroll:true});origin=null;
      document.dispatchEvent(new CustomEvent('daily-dialog-closed',{detail:{id:previous?.id}}));
    }
  }
  const observer=new MutationObserver(sync);for(const dialog of dialogs)observer.observe(dialog,{attributes:true,attributeFilter:['class','data-busy']});
  document.addEventListener('keydown',event=>{
    const open=dialogs.find(el=>el.classList.contains('open'));
    if(open){
      if(event.key==='Escape'&&open.dataset.busy==='true'){event.preventDefault();event.stopImmediatePropagation();return;}
      if(event.key==='Tab'){
        const items=focusable(open);if(!items.length)return;const first=items[0],last=items.at(-1);
        if(!open.contains(document.activeElement)||event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last){event.preventDefault();(event.shiftKey?last:first).focus();}
      }
    }
    if(['Enter',' '].includes(event.key)&&event.target.matches('[role="button"],[role="menuitem"]')&&!event.target.matches('button,.status-card')){event.preventDefault();event.target.click();}
    const popover=document.querySelector('#tabsPopover.open');
    if(popover&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      const items=[...popover.querySelectorAll('[role="menuitem"]')].filter(el=>!el.hidden);if(!items.length)return;
      event.preventDefault();const index=items.indexOf(document.activeElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length].focus();
    }
  },true);
  document.addEventListener('focusin',event=>{const open=dialogs.find(el=>el.classList.contains('open'));if(open&&!open.contains(event.target))focusable(open)[0]?.focus();});
})();
