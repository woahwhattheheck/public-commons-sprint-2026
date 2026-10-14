/** Local opening recovery without retaining scientific data or session secrets. */
const EDITION='upstate.workbench-links/1';
const VIEW=/^[a-z][a-z0-9-]{0,79}$/;
const TOKEN=/^[A-Za-z0-9_-]{32,256}$/;
const LEGACY={'/designations.html':'water-designations','/web/designations.html':'water-designations'};
const browser=typeof window!=='undefined'&&typeof document!=='undefined';
const localOrigin=value=>value.protocol==='http:'&&value.hostname==='127.0.0.1'&&Boolean(value.port);

export function requestedWorkbenchView(value){
 try{
  const url=new URL(typeof value==='string'?value:value.href);
  const hash=url.hash.slice(1),parameters=new URLSearchParams(hash);
  for(const candidate of [hash,parameters.get('view'),url.searchParams.get('view'),LEGACY[url.pathname]]){
   if(typeof candidate==='string'&&VIEW.test(candidate))return candidate;
  }
  if(url.pathname.startsWith('/api/file/'))return 'deliveries';
 }catch{}
 return null;
}

// Captured before the ordinary application removes the private login fragment.
export const initialWorkbenchView=browser?requestedWorkbenchView(window.location):null;

export function currentWorkbenchURL(value,{currentOrigin=null,view=null}={}){
 if(typeof value!=='string'||!value.trim()||value.length>4096||/[\x00-\x20\x7f]/.test(value.trim()))throw Error('Paste the complete current private workbench link.');
 let url;try{url=new URL(value.trim());}catch{throw Error('Paste the complete current private workbench link, including its address.');}
 const sameSecure=url.protocol==='https:'&&url.origin===currentOrigin;
 if((!localOrigin(url)&&!sameSecure)||url.username||url.password)throw Error('Use the private link printed by the local workbench launcher.');
 if(!['/','/web/index.html',...Object.keys(LEGACY)].includes(url.pathname))throw Error('Use the complete workbench opening link, not a report or API address.');
 const fragment=new URLSearchParams(url.hash.slice(1)),tokens=fragment.getAll('token');
 if(tokens.length!==1||!TOKEN.test(tokens[0])||[...fragment.keys()].some(key=>!['token','view'].includes(key)))throw Error('The current private workbench link needs its complete session token.');
 // Carry only a non-secret view name. Never send a supplied token as a query,
 // preserve an arbitrary redirect, or copy it into another origin's storage.
 const requested=requestedWorkbenchView(url)||(typeof view==='string'&&VIEW.test(view)?view:null);
 const output=new URL('/',url.origin);
 if(requested)output.searchParams.set('view',requested);
 output.hash=new URLSearchParams({token:tokens[0]}).toString();
 return output.href;
}

let retryCurrent=null,notice=null,dialog=null,registered=false;
function ensureStyles(){
 if(!browser||document.querySelector('link[href="/web/workbench_links.css"]')||document.body?.hasAttribute('data-workbench-reopen'))return;
 const link=document.createElement('link');link.rel='stylesheet';link.href='/web/workbench_links.css';document.head.append(link);
}
function create(tag,text,attributes={}){
 const node=document.createElement(tag);if(text!==null)node.textContent=text;
 for(const [name,value]of Object.entries(attributes))node.setAttribute(name,value);
 return node;
}
function launcherHelp(){
 const p=create('p','Open the extracted workbench folder. Double-click ');
 p.append(create('code','Open_Workbench.cmd'),document.createTextNode(' on Windows or '),
  create('code','Open_Workbench.command'),document.createTextNode(' on Mac. The launcher opens the ready application at its current address.'));
 return p;
}
function linkForm(prefix){
 const form=create('form',null),id=prefix+'-link';
 const label=create('label','Current private workbench link',{for:id});
 const input=create('input',null,{id,type:'password',autocomplete:'off',spellcheck:'false',required:''});
 const small=create('small','Use the complete current launcher link. This helper does not save the link.');
 const actions=create('div',null,{class:'wb-actions'}),submit=create('button','Open current workbench',{type:'submit'});
 const error=create('p',null,{role:'alert',hidden:''});actions.append(submit);form.append(label,input,small,actions,error);
 form.addEventListener('submit',event=>{
  event.preventDefault();error.hidden=true;
  try{
   const destination=currentWorkbenchURL(input.value,{currentOrigin:location.origin,view:requestedWorkbenchView(location)});
   input.value='';window.location.replace(destination);
  }catch(failure){error.textContent=failure.message;error.hidden=false;}
 });
 return form;
}
async function readiness(){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
 try{
  const response=await fetch('/workbench-link-status',{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
  if(!response.ok)return false;
  const value=await response.json();return value?.schema===EDITION&&value.ready===true;
 }catch{return false;}finally{clearTimeout(timer);}
}
function openHelp(){
 if(dialog){dialog.showModal();return;}
 dialog=create('dialog',null,{class:'wb-link-dialog','aria-labelledby':'wb-help-title'});
 const header=create('header',null),heading=create('h2','Reopen the workbench',{id:'wb-help-title'}),close=create('button','Close',{type:'button'});
 close.addEventListener('click',()=>dialog.close());header.append(heading,close);dialog.append(header,launcherHelp());
 dialog.append(create('p','Keep this tab open to preserve any unsaved form. After the launcher opens the current session, reopen the retained report or operation; do not submit a second copy of an accepted operation.'));
 const actions=create('div',null,{class:'wb-actions'});
 actions.append(create('a','Save reopening help',{href:'/web/workbench_reopen.html?download=1',download:'Reopen_Workbench.html',class:'wb-button'}));
 dialog.append(actions,linkForm('wb-help'));document.body.append(dialog);dialog.showModal();
}

export function attachWorkbenchLinks({onRetry}={}){
 if(!browser||!localOrigin(new URL(location.href)))return;
 retryCurrent=onRetry||retryCurrent;ensureStyles();
 if(!document.getElementById('wb-help-open')){
  const button=create('button','Reopen help',{id:'wb-help-open',type:'button'});
  button.addEventListener('click',openHelp);document.querySelector('.top-actions')?.append(button);
 }
 if(!notice&&document.getElementById('connection-state')){
  notice=create('section',null,{class:'wb-link-notice',hidden:'','aria-live':'polite'});
  const text=create('p','The connection was interrupted. Keep this tab open for unsaved work; use the launcher to reopen the current workbench.');
  const actions=create('div',null,{class:'wb-actions'}),retry=create('button','Check connection',{type:'button'}),help=create('button','Opening help',{type:'button'});
  retry.addEventListener('click',async()=>{
   retry.disabled=true;
   try{
    if(await readiness()){
     text.textContent='The workbench is responding. Refreshing the original connection; use the launcher if this session has expired.';
     if(retryCurrent)await retryCurrent();
    }else text.textContent='This address is not ready. Open the extracted workbench folder and double-click its launcher.';
   }finally{retry.disabled=false;}
  });
  help.addEventListener('click',openHelp);actions.append(retry,help);notice.append(text,actions);
  document.getElementById('connection-state').after(notice);
 }
 if(!registered&&'serviceWorker'in navigator){
  registered=true;
  // This request-driven worker serves opening help only after a failed page
  // navigation. It never polls, retries a task, caches an API or stores a token.
  navigator.serviceWorker.register('/workbench-recovery-sw.mjs',{scope:'/',updateViaCache:'none'})
   .catch(()=>{document.getElementById('wb-help-open')?.setAttribute('title','Save reopening help for use after closing the workbench.');});
 }
}

export function workbenchConnection(ready){
 if(notice)notice.hidden=Boolean(ready);
}

function mountOpeningPage(){
 const status=document.getElementById('wb-reopen-status'),retry=document.getElementById('wb-retry');
 const main=document.getElementById('wb-main'),save=document.getElementById('wb-save');
 const inLocalPage=localOrigin(new URL(location.href));
 if(!inLocalPage){
  retry.hidden=true;save.hidden=true;
  status.textContent='Open the extracted workbench with its Windows or Mac launcher.';
 }else{
  const wanted=requestedWorkbenchView(location),target=new URL('/',location.origin);
  if(wanted)target.hash=wanted;
  main.href=target.href;
  retry.addEventListener('click',async()=>{
   retry.disabled=true;status.textContent='Checking the current workbench address…';
   try{
    const ready=await readiness();main.hidden=!ready;
    status.textContent=ready?'The workbench is ready at this address. Open it below, or use the launcher for a current private session.':'This saved address is not ready. Use the launcher in the extracted workbench folder.';
   }finally{retry.disabled=false;}
  });
 }
 const form=document.getElementById('wb-current-link-form'),input=document.getElementById('wb-current-link'),error=document.getElementById('wb-link-error');
 form.addEventListener('submit',event=>{
  event.preventDefault();error.hidden=true;
  try{
   const destination=currentWorkbenchURL(input.value,{currentOrigin:location.origin,view:requestedWorkbenchView(location)});
   input.value='';window.location.replace(destination);
  }catch(failure){error.textContent=failure.message;error.hidden=false;}
 });
 // No automatic requests from an offline report/opening file.
}
if(browser){
 if(document.body?.hasAttribute('data-workbench-reopen'))mountOpeningPage();
 else attachWorkbenchLinks();
}
