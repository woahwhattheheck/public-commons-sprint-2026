// Specialist desks retain their original state and writers. This module only
// postpones loading their JavaScript until the existing host selects a desk.
export function createLazyDesk({label,load,exportName}) {
  if(typeof label!=='string'||typeof load!=='function'||typeof exportName!=='string')
    throw new TypeError('A desk label, module loader and original mount export are required.');
  let modulePromise=null,loadedModule=null;
  function originalModule() {
    if(loadedModule)return Promise.resolve(loadedModule);
    if(!modulePromise)modulePromise=Promise.resolve().then(load).then(module=>{
      if(typeof module?.[exportName]!=='function')throw new Error('The installed '+label+' module is missing its original entry point.');
      loadedModule=module;return module;
    }).catch(error=>{modulePromise=null;throw error;});
    return modulePromise;
  }
  return function mountLazyDesk(options) {
    const {container,isCurrent=()=>true,...originalOptions}=options;
    if(!container||typeof container.replaceChildren!=='function')throw new TypeError('An original desk container is required.');
    let active=true,hostBusy=false,child=null,phase='loading',attempt=0,ready;
    let cancel;
    const cancelled=new Promise(resolve=>{cancel=resolve;});
    const document=container.ownerDocument;
    const panel=document.createElement('section');
    panel.className='ops-lazy-desk';
    panel.setAttribute('aria-label',label);
    const heading=document.createElement('h3');
    heading.textContent=label;
    const message=document.createElement('p');
    message.setAttribute('role','status');
    message.setAttribute('aria-live','polite');
    const retry=document.createElement('button');
    retry.type='button';retry.textContent='Retry loading';retry.hidden=true;
    panel.append(heading,message,retry);
    const available=()=>active&&container.isConnected&&isCurrent();
    function loading() {
      phase='loading';message.textContent='Opening '+label.toLowerCase()+'…';
      message.setAttribute('role','status');retry.hidden=true;
      panel.setAttribute('aria-busy','true');container.replaceChildren(panel);
    }
    function controls() {retry.disabled=hostBusy||phase==='loading'||!available();}
    function reportFailure(error) {
      if(!available())return;
      phase='error';
      // A child initialization failure can include a retained uncertain request.
      // Leave its own recovery controls and original state in place.
      if(child) {
        panel.setAttribute('aria-busy','false');
        message.setAttribute('role','alert');
        message.textContent='This desk needs attention. Review its original recovery controls below. '+(error?.message||String(error));
        retry.hidden=true;
        container.prepend(panel);
      } else {
        panel.setAttribute('aria-busy','false');message.setAttribute('role','alert');
        message.textContent='Could not open '+label.toLowerCase()+'. '+(error?.message||String(error));
        retry.hidden=false;container.replaceChildren(panel);
      }
      controls();
    }
    async function start() {
      const token=++attempt;
      loading();controls();
      try {
        const module=await Promise.race([originalModule(),cancelled]);
        if(!module||!available()||token!==attempt)return null;
        const mounted=module[exportName]({container,...originalOptions});
        if(!mounted||typeof mounted.dispose!=='function'||typeof mounted.setHostBusy!=='function') {
          if(typeof mounted?.dispose==='function')mounted.dispose();
          throw new Error('The installed '+label+' desk has an incomplete lifecycle.');
        }
        child=mounted;
        child.setHostBusy(hostBusy);
        await Promise.race([Promise.resolve(child.ready),cancelled]);
        if(!available()||token!==attempt)return null;
        phase='ready';return child;
      } catch(error) {
        if(!available()||token!==attempt)return null;
        reportFailure(error);throw error;
      }
    }
    function retryOpen() {
      if(!available()||hostBusy||phase!=='error'||child)return;
      ready=start();
      // The initial ready rejection is observed by the original host. This
      // explicit local retry renders its own error and never repeats an action.
      ready.catch(()=>{});
    }
    retry.addEventListener('click',retryOpen);
    function setHostBusy(value) {
      hostBusy=Boolean(value);if(!active)return;
      child?.setHostBusy(hostBusy);controls();
    }
    function dispose() {
      if(!active)return;
      active=false;phase='disposed';attempt++;cancel(null);
      retry.removeEventListener('click',retryOpen);
      child?.dispose();
    }
    function draftInputs() {
      if(child&&typeof child.draftInputs==='function')return child.draftInputs();
      return originalOptions.initialInputs==null?null:structuredClone(originalOptions.initialInputs);
    }
    function currentSavedWorkflow() {
      if(!available()||phase!=='ready')return null;
      return child?.currentSavedWorkflow?.()||null;
    }
    async function openSavedWorkflow(selection) {
      await ready;
      if(!available()||phase!=='ready'||typeof child?.openSavedWorkflow!=='function')
        throw new Error('Reopen the original '+label.toLowerCase()+' desk before selecting saved work.');
      const opened=await child.openSavedWorkflow(selection);
      if(!available())throw new Error('The original desk changed while its saved work was opening.');
      return opened;
    }
    ready=start();
    return {
      get root(){return child?.root||panel;},
      get ready(){return ready;},
      get loadingState(){return {label,phase,moduleLoaded:Boolean(loadedModule)};},
      dispose,setHostBusy,draftInputs,currentSavedWorkflow,openSavedWorkflow
    };
  };
}
