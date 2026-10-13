const PREFIX='gridkind.assistant.v1.';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TOKEN=/^[a-f0-9]{64}$/;
export function connectionConfig(endpoint,token,origin=location.origin){
 const url=new URL(endpoint);
 if(url.origin!==origin||url.pathname!=='/mcp'||url.search||url.hash||url.username||url.password||!TOKEN.test(token))throw Error('The connection must use this local GridKind endpoint and its original token.');
 return {mcpServers:{gridkind:{type:'http',url:url.href,headers:{Authorization:'Bearer '+token}}}};
}
export function createConnectionRequest(state,name,cryptography=crypto){
 const home=state?.workspace;
 if(!home?.selectedId||!UUID.test(home.selectedId))throw Error('Open the household before creating a connection.');
 name=name.trim();if(!name||name.length>100||/[\x00-\x1f\x7f]/.test(name))throw Error('Name this assistant using 1–100 printable characters.');
 const token=Array.from(cryptography.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 return {action:'create',context:{generation:home.generation,householdId:home.selectedId,revision:home.revision},requestId:cryptography.randomUUID(),name,token};
}
function validRecord(r){return r?.schema==='gridkind-browser-connection.v1'&&UUID.test(r.body?.requestId)&&UUID.test(r.body?.context?.householdId)&&TOKEN.test(r.body?.token)&&typeof r.body?.name==='string'&&r.body.action==='create';}
export function mountAssistant({getState,isBusy,run,onState,onProblem}){
 const $=id=>document.getElementById(id),list=$('assistant-list');
 let data=null,viewHome=null,scheduled=false,loading=false,problem='',notice='',paint='',lastFailedHome=null;
 const records=new Map();
 function readVault(){
  try{
   const next=new Map();for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(PREFIX))continue;
    let record;try{record=JSON.parse(localStorage.getItem(key));}catch{problem='A saved connection entry could not be read. Its original browser storage is retained.';continue;}
    if(validRecord(record)&&key===PREFIX+record.body.requestId)next.set(record.body.requestId,record);
   }
   for(const [id,record]of next)records.set(id,record);
  }catch(error){problem='Browser storage is unavailable: '+error.message+'. Existing server connections remain listed; a new connection requires recoverable local storage.';}
 }
 function save(record){
  if(!validRecord(record))throw Error('Incomplete original connection recovery record.');
  const encoded=JSON.stringify(record),key=PREFIX+record.body.requestId;
  localStorage.setItem(key,encoded);
  if(localStorage.getItem(key)!==encoded)throw Error('The original connection could not be retained in browser storage.');
  records.set(record.body.requestId,record);paint='';
 }
 function forget(id){localStorage.removeItem(PREFIX+id);records.delete(id);paint='';}
 function stateContext(){const w=getState()?.workspace;return {generation:w?.generation,householdId:w?.selectedId,revision:w?.revision};}
 function date(value){if(!value)return '';const d=new Date(value);return Number.isFinite(d.valueOf())?new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short'}).format(d):value;}
 function node(tag,text,cls){const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x;}
 function button(label,fn,disabled=false){const b=node('button',label,'secondary');b.type='button';b.disabled=disabled;b.dataset.assistantAction='1';b.onclick=()=>execute(fn);return b;}
 function setProblem(error){problem=error?.message||String(error);onProblem?.(error);refresh();}
 async function execute(fn){
  if(isBusy())return;
  return run(async()=>{problem='';try{return await fn();}catch(error){setProblem(error);return null;}finally{refresh();}});
 }
 async function request(body){
  const response=await fetch('/api/assistant',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  let value;try{value=await response.json();}catch{throw Error('The server response could not be read. The original connection is retained; use Retry original connection to recover it.');}
  if(value.state)onState(value.state);
  if(!response.ok)throw Object.assign(Error(value.error||'Connection request failed.'),{status:response.status});
  if(!value.grant||value.grant.id!==(body.requestId||body.grantId)||value.grant.householdId!==body.context.householdId)throw Error('The server did not identify the original connection. Its recovery record remains retained.');
  return value;
 }
 async function reload(){
  loading=true;refresh();
  try{
   const response=await fetch('/api/assistant');const value=await response.json();
   if(!response.ok)throw Error(value.error||'Could not read assistant connections.');
   connectionConfig(value.endpoint,'0'.repeat(64));
   if(!Array.isArray(value.grants)||value.householdId!==value.state?.workspace?.selectedId)throw Error('The household connection response was incomplete.');
   data=value;viewHome=value.householdId;lastFailedHome=null;onState(value.state);paint='';
   for(const grant of value.grants){
    const original=records.get(grant.id);
    if(original&&original.body.context.householdId===grant.householdId){
     const updated={...original,status:grant.revokedAt?'revoked':'active',grant,endpoint:value.endpoint};
     records.set(grant.id,updated);
     try{save(updated);}catch(error){problem='Connection recovered, but browser storage could not be updated: '+error.message;}
    }
   }
  }catch(error){lastFailedHome=getState()?.workspace?.selectedId;throw error;}
  finally{loading=false;refresh();}
 }
 async function create(){
  const state=getState(),body=createConnectionRequest(state,$('assistant-name').value);
  if(!data||data.householdId!==body.context.householdId)throw Error('Refresh connections for this household first.');
  if([...records.values()].some(r=>r.status==='pending'&&r.body.context.householdId===body.context.householdId))throw Error('Recover the original pending connection before creating another.');
  const record={schema:'gridkind-browser-connection.v1',status:'pending',body,householdName:data.householdName,endpoint:data.endpoint,createdAt:new Date().toISOString()};
  save(record);notice='Original connection retained locally. Creating access…';refresh();
  await sendCreate(record,false);
 }
 async function sendCreate(record,refreshContext){
  if(record.body.context.householdId!==getState()?.workspace?.selectedId)throw Error('Open '+record.householdName+' before retrying its original connection.');
  let pending=record;
  if(refreshContext){
   await reload();
   // Refresh may already have recovered a committed connection.
   const recovered=records.get(record.body.requestId);
   if(recovered?.status!=='pending'){notice='Original connection recovered.';refresh();return;}
   if(record.body.context.householdId!==getState()?.workspace?.selectedId)throw Error('The selected household changed. Reopen the original household before continuing.');
   pending={...record,body:{...record.body,context:stateContext()}};
   save(pending);
  }
  const value=await request(pending.body),updated={...pending,grant:value.grant,status:value.grant.revokedAt?'revoked':'active'};
  records.set(updated.body.requestId,updated);
  try{save(updated);}catch(error){problem='Connection created; its original pending recovery is still retained. Browser storage could not be updated: '+error.message;}
  notice=updated.status==='revoked'?'This original connection was already revoked.':'Connection created. Download its private configuration for the assistant client.';
  await reload();
 }
 function download(record){
  const content=JSON.stringify(connectionConfig(data?.endpoint||record.endpoint,record.body.token),null,2)+'\n';
  const url=URL.createObjectURL(new Blob([content],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download='GridKind_Assistant_'+record.body.requestId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  notice='Private configuration downloaded. It contains this connection’s access token.';refresh();
 }
 async function revoke(grant){
  if(grant.householdId!==getState()?.workspace?.selectedId)throw Error('Open the linked household before revoking this connection.');
  const value=await request({action:'revoke',grantId:grant.id,context:stateContext()});
  const record=records.get(grant.id);
  if(record){const revoked={...record,status:'revoked',grant:value.grant};records.set(grant.id,revoked);try{save(revoked);}catch(error){problem='Access was revoked, but its local copy could not be updated: '+error.message;}}
  notice='Connection revoked. This token no longer authorizes assistant operations.';await reload();
 }
 function renderList(){
  const home=getState()?.workspace?.selectedId;
  const grants=data?.householdId===home?data.grants:[];
  const pending=[...records.values()].filter(r=>r.status==='pending'&&!grants.some(g=>g.id===r.body.requestId));
  const signature=JSON.stringify({home,grants,pending,locals:grants.map(g=>[g.id,Boolean(records.get(g.id))]),busy:isBusy()});
  if(signature===paint)return;paint=signature;list.replaceChildren();
  if(!grants.length&&!pending.length)list.append(node('p',loading?'Opening connections…':'No assistant connections for this household.','dim'));
  for(const grant of grants){
   const article=node('article',undefined,'assistant-connection'),heading=node('h3',grant.name),state=node('p',(grant.revokedAt?'Revoked '+date(grant.revokedAt):'Created '+date(grant.createdAt)),'field-hint');
   article.append(heading,state);
   const record=records.get(grant.id),controls=node('div',undefined,'controls');
   if(grant.revokedAt){
    if(record)controls.append(button('Remove revoked local credential',()=>{forget(grant.id);notice='Revoked credential removed from this browser.';refresh();},isBusy()));
   }else{
    if(record){
     controls.append(button('Download private configuration',()=>download(record),isBusy()));
     const detail=node('details',undefined,'assistant-secret'),summary=node('summary','View private connection details');
     const endpoint=node('p',data.endpoint,'assistant-endpoint'),label=node('label','Access token'),token=node('textarea');
     token.readOnly=true;token.rows=3;token.spellcheck=false;token.autocomplete='off';token.setAttribute('aria-label','Private assistant access token');token.value=record.body.token;label.append(token);
     detail.append(summary,endpoint,label);article.append(detail);
    }else article.append(node('p','The token is retained only in the browser that created it or a downloaded configuration. Revoke this connection if its credential is lost.','dim'));
    controls.append(button('Revoke connection',()=>revoke(grant),isBusy()));
   }
   article.append(controls);list.append(article);
  }
  for(const record of pending){
   const article=node('article',undefined,'assistant-connection');article.append(node('h3',record.body.name+' · pending'),node('p','Original request retained for '+record.householdName+'. Retry recovers an existing grant or submits that same connection identity.','dim'));
   article.append(button('Retry original connection',()=>sendCreate(record,true),isBusy()||record.body.context.householdId!==home));list.append(article);
  }
 }
 function refresh(){
  const home=getState()?.workspace?.selectedId,locked=isBusy()||loading;
  $('assistant-create').disabled=locked||!data||data.householdId!==home||[...records.values()].some(r=>r.status==='pending'&&r.body.context.householdId===home);
  $('assistant-name').disabled=locked||!home;$('assistant-refresh').disabled=locked||!home;
  $('assistant-household').textContent=data?.householdId===home?'Linked household: '+data.householdName:'Open a household to manage its assistant connections.';
  $('assistant-status').textContent=loading?'Opening assistant connections…':notice||'Connections use the current saved household. Approve a proposed schedule in the original household controls.';
  $('assistant-error').textContent=problem;renderList();
  if(home&&home!==viewHome&&home!==lastFailedHome&&!scheduled&&!locked){
   scheduled=true;queueMicrotask(()=>{scheduled=false;if(!isBusy())execute(reload);});
  }
 }
 readVault();
 $('assistant-create').onclick=()=>execute(create);
 $('assistant-refresh').onclick=()=>execute(async()=>{await reload();notice='Saved connections and household state refreshed.';});
 window.addEventListener('storage',event=>{if(event.key?.startsWith(PREFIX)){if(event.newValue===null)records.delete(event.key.slice(PREFIX.length));readVault();paint='';refresh();}});
 refresh();return {refresh};
}
