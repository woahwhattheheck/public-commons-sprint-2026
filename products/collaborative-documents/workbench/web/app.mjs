// SPDX-License-Identifier: MIT
import { createCollaborativeEditor, SCHEMA_ID, FIELD_NAME } from './editor.mjs';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const enc = new TextEncoder();
const PANES = {overview:'Overview',sources:'Sources',access:'Tenant access',editions:'Editions',migrations:'Migration review',documents:'Documents',runtime:'Runtime',delivery:'Delivery & history'};
const S = {
  token:'',session:null,projects:[],project:null,pane:'overview',nav:0,reading:0,
  pending:null,scope:null,storageLoaded:false,storageError:null,busy:false,loading:false,
  drafts:{},form:null,formGeneration:0,detailGeneration:0,editor:null,editorSerial:0,editorState:null,
  selectedMigration:null,poll:null,storageTail:Promise.resolve(),lastOutcome:null,
};
let applicationClosing=false,applicationClosed=false,applicationClose=null;
const ownedWork=new Set(),databaseHandles=new Set(),databaseOpenings=new Set(),objectURLs=new Map(),knownCommitted=new Map(),editorOwners=new Set();
let editorTransition=Promise.resolve();
function trackWork(work) {
  let task;
  try {task=Promise.resolve(work());}catch(error){task=Promise.reject(error);}
  ownedWork.add(task);
  task.then(()=>ownedWork.delete(task),()=>ownedWork.delete(task));return task;
}
function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
function sameRequest(a,b) {return a.scope===b.scope&&a.requestId===b.requestId&&a.path===b.path&&a.bodyText===b.bodyText;}
function adoptPending(value,{durable=false}={}) {
  if(!value)return value;
  const known=knownCommitted.get(value.scope);
  if(known&&!sameRequest(known,value)) {
    // A completed, cleared predecessor does not own a later original request.
    need(known.finished,'PENDING_REQUEST_CONFLICT','Another original request already has a known committed result.');
  }
  if(known&&sameRequest(known,value)) {
    if(value.response)need(known.response.view.id===value.response.view.id&&known.response.view.revision===value.response.view.revision&&
      canonical(known.response.result)===canonical(value.response.result),'PENDING_RESULT_CONFLICT','The same request returned a conflicting native result.');
    if(durable&&value.response)known.resultDurable=true;
    return clone(known);
  }
  if(value.response) {
    normalizeOutcome(value.response,value);
    const next={...clone(value),state:'committed',resultDurable:durable};
    knownCommitted.set(value.scope,next);return clone(next);
  }
  return value;
}
function fail(code,message,details) { throw Object.assign(new Error(message),{code,details}); }
function need(value,code,message) { if(!value) fail(code,message); }
const h = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const j = value => JSON.stringify(value,null,2);
const clone = value => structuredClone(value);
const id = () => crypto.randomUUID();
function time(value) { if(!value)return '—'; const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString(); }
function size(value) { const n=Number(value);if(!Number.isFinite(n))return '—';if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KiB';return (n/1048576).toFixed(1)+' MiB'; }
const brief = value => String(value??'').length>22?String(value).slice(0,14)+'…'+String(value).slice(-6):String(value??'');
const badge = (value,strong=false) => '<span class="badge'+(strong?' strong':'')+'">'+h(value||'retained')+'</span>';
function button(label,action,key='',options={}) {
  return '<button type="button" class="'+h(options.class||'secondary small-button')+'" data-action="'+h(action)+'"'+(key?' data-id="'+h(key)+'"':'')+(options.mutate?' data-mutates':'')+(options.disabled?' disabled'+(options.mutate?' data-unavailable="true"':''):'')+'>'+h(label)+'</button>';
}
function notice(message,{error=false,title='',actions=''}={}) {
  const target=$('#tt-notice');target.hidden=!message;
  target.className='notice'+(error?' error':'');
  target.innerHTML=(title?'<h3>'+h(title)+'</h3>':'')+'<p>'+h(message||'')+'</p>'+actions;
}
function errorText(error) { return (error?.code?error.code+': ':'')+String(error?.message||error); }
function report(error) { notice(errorText(error),{error:true}); }
async function sha(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join(''); }
function safePath(path) { need(typeof path==='string'&&path.startsWith('/api/')&&!path.includes('\0'),'API_PATH_INVALID','Use an original workspace API path.');return path; }
async function request(path,{method='GET',body,headers={},raw=false,signal}={}) {
  need(!applicationClosed,'APPLICATION_CLOSED','The original application has closed.');
  need(S.token,'AUTH_REQUIRED','Sign in with this host’s access token.');
  const options={method,headers:{Authorization:'Bearer '+S.token,...headers},credentials:'omit',redirect:'error',cache:'no-store',signal};
  if(body!==undefined) {
    if(typeof body==='string'||body instanceof Blob||body instanceof ArrayBuffer||ArrayBuffer.isView(body))options.body=body;
    else {options.body=JSON.stringify(body);options.headers['Content-Type']='application/json';}
  }
  const response=await fetch(safePath(path),options);
  if(raw) {
    if(!response.ok) {
      let value;try{value=await response.json();}catch{}
      throw Object.assign(new Error(value?.error?.message||'The host could not return the selected bytes.'),{code:value?.error?.code||'DOWNLOAD_FAILED',status:response.status,details:value?.error?.details});
    }
    return response;
  }
  let value;
  try {value=await response.json();} catch(error) {
    throw Object.assign(new Error('The host response could not be read. Keep the original request for reconciliation.'),{code:'RESPONSE_UNREADABLE',status:response.status,cause:error,uncertain:true});
  }
  if(!response.ok)throw Object.assign(new Error(value?.error?.message||'The host rejected this request.'),{code:value?.error?.code||'HTTP_'+response.status,status:response.status,details:value?.error?.details});
  return value;
}
let database=null;
function db() {
  need(!applicationClosed,'APPLICATION_CLOSED','The original browser store has closed.');
  if(database)return database;
  let terminal;
  const held=new Promise(resolve=>{terminal=resolve;});databaseOpenings.add(held);
  held.then(()=>databaseOpenings.delete(held));
  database=new Promise((resolve,reject)=>{
    let failed=false,opening;
    try {opening=indexedDB.open('tiptap-migration-operator-v1',1);}catch(error){terminal();reject(error);return;}
    opening.onupgradeneeded=()=>opening.result.createObjectStore('records',{keyPath:'key'});
    opening.onerror=()=>{failed=true;terminal();reject(opening.error||new Error('The browser could not open retained requests.'));};
    opening.onblocked=()=>{failed=true;reject(new Error('Another page is holding an older request store. Close it, then retry the retained-state read.'));};
    opening.onsuccess=()=>{
      const value=opening.result;databaseHandles.add(value);
      if(failed){value.close();databaseHandles.delete(value);terminal();return;}
      value.onversionchange=()=>{value.close();databaseHandles.delete(value);database=null;};
      terminal();resolve(value);
    };
  }).catch(error=>{database=null;throw error;});
  return database;
}
async function stored(key) {
  const database=await db();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction('records','readonly'),q=tx.objectStore('records').get(key);let result;
    q.onsuccess=()=>{result=q.result?.value;};tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>{};tx.onabort=()=>reject(tx.error||new Error('Retained-state read was interrupted.'));
  });
}
async function store(key,value) {
  const database=await db();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction('records','readwrite');
    tx.objectStore('records').put({key,value});
    tx.oncomplete=()=>resolve();tx.onerror=()=>{};tx.onabort=()=>reject(tx.error||new Error('The browser did not retain the exact request.'));
  });
}
async function remove(key) {
  const database=await db();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction('records','readwrite');tx.objectStore('records').delete(key);
    tx.oncomplete=()=>resolve();tx.onerror=()=>{};tx.onabort=()=>reject(tx.error||new Error('The saved request could not be cleared.'));
  });
}
function scope(projectId) {
  need(S.session?.instanceId&&S.session.actor?.id,'AUTH_REQUIRED','Open the host session first.');
  return [location.origin,S.session.instanceId,S.session.actor.id,projectId||'$create'].map(encodeURIComponent).join('|');
}
async function loadStorage(projectId,nav=S.nav) {
  const target=scope(projectId);S.storageLoaded=false;S.storageError=null;S.pending=null;S.scope=target;controls();
  try {
    const [pending,drafts,last]=await Promise.all([stored('pending:'+target),stored('drafts:'+target),stored('last:'+target)]);
    if(nav!==S.nav||S.scope!==target)return false;
    if(pending)validatePending(pending,target);
    const known=knownCommitted.get(target);
    S.pending=pending?adoptPending(pending,{durable:!!pending.response}):known&&!known.finished?clone(known):null;
    S.drafts=drafts||{};S.lastOutcome=last||null;S.storageLoaded=true;
    renderPending();controls();return true;
  } catch(error) {
    if(nav===S.nav&&S.scope===target){S.storageError=error;S.storageLoaded=false;const known=knownCommitted.get(target);if(known&&!known.finished)S.pending=clone(known);renderPending();controls();}
    return false;
  }
}
function requireStorage() {
  need(S.storageLoaded&&!S.storageError&&S.scope===scope(S.project?.id),'REQUEST_STORAGE_UNREAD','Load the original retained request and drafts before another mutation.');
}
function requireWrite() {
  need(!applicationClosing&&!applicationClosed,'APPLICATION_CLOSING','The original application is closing.');
  requireStorage();
  need(S.session?.permissions?.operate&&(!S.project||S.project.permissions?.operate),'OPERATOR_REQUIRED','This action requires the host’s operator permission.');
  need(!S.project?.historical,'HISTORICAL_VIEW','Open the current project before making a change.');
  need(!S.loading&&!S.busy,'ACTION_IN_PROGRESS','Wait for the selected view or current request.');
  need(!S.pending,'REQUEST_PENDING','Reconcile the retained original request before creating another.');
}
function validatePending(p,selectedScope) {
  need(p?.schema==='tjlabs.tiptap-browser-request.v1'&&p.scope===selectedScope,'PENDING_SCOPE_MISMATCH','The retained request belongs to another host, actor, or project.');
  need(typeof p.bodyText==='string'&&typeof p.requestId==='string'&&typeof p.path==='string','PENDING_INVALID','The retained request is incomplete.');
  const body=JSON.parse(p.bodyText);
  need(body.requestId===p.requestId,'PENDING_ID_MISMATCH','The retained request ID does not match its complete body.');
  safePath(p.path);
}
async function persistPending(p) {
  // Publish a received native result in memory before attempting durable storage.
  // Every later transaction merges against that same current observation.
  let selected=adoptPending(p);
  if(S.scope===p.scope&&selected.response){S.pending=clone(selected);renderPending();controls();}
  const database=await db();
  await new Promise((resolve,reject)=>{
    const tx=database.transaction('records','readwrite'),records=tx.objectStore('records'),q=records.get('pending:'+p.scope);let problem=null;
    q.onsuccess=()=>{
      try {
        const old=q.result?.value;
        need(!old||sameRequest(old,p),'PENDING_REQUEST_CONFLICT','Another page retained a different original request. Reload it before continuing.');
        if(old?.response)adoptPending(old,{durable:true});
        selected=adoptPending(p);
        records.put({key:'pending:'+p.scope,value:selected});
      }catch(error){problem=error;tx.abort();}
    };
    tx.oncomplete=()=>resolve();tx.onerror=()=>{problem ||= tx.error;};
    tx.onabort=()=>reject(problem||tx.error||new Error('The exact pending request could not be retained.'));
  });
  selected=adoptPending(selected,{durable:!!selected.response});
  if(S.scope===p.scope){S.pending=selected;renderPending();controls();}
}
async function removePending(p) {
  const database=await db();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction('records','readwrite'),records=tx.objectStore('records'),q=records.get('pending:'+p.scope);let removed=false;
    q.onsuccess=()=>{const old=q.result?.value;if(!old){removed=true;return;}if(old.requestId===p.requestId&&old.bodyText===p.bodyText){records.delete('pending:'+p.scope);removed=true;}};
    tx.oncomplete=()=>resolve(removed);tx.onerror=()=>{};tx.onabort=()=>reject(tx.error||new Error('The original pending request could not be reconciled.'));
  });
}
function renderPending() {
  const root=$('#tt-pending');
  if(S.storageError) {
    root.hidden=false;root.innerHTML='<h3>Retained requests could not be loaded</h3><p>'+h(errorText(S.storageError))+'</p><p class="small">The original key is preserved. New mutations stay closed until this read succeeds.</p><div class="actions">'+button('Retry retained-state read','retry-storage')+'</div>';return;
  }
  if(S.session&&!S.storageLoaded) {
    root.hidden=false;root.innerHTML='<p>Loading this actor’s original request and drafts…</p>';return;
  }
  const p=S.pending;if(!p){root.hidden=true;root.textContent='';return;}
  root.hidden=false;
  const heading=p.state==='rejected'?'The original request was rejected':p.state==='committed'?'Committed result retained':p.state==='uploading'?'Source upload retained':'Original request retained';
  root.innerHTML='<h3>'+heading+'</h3><p>'+h(p.label||p.path)+'</p><p class="small mono">'+h(p.requestId)+' · revision '+h(p.expectedRevision??'create')+'</p>'+(p.error?'<p class="small">'+h(p.error.message)+'</p>':'')+(p.upload?'<p class="small">'+h(p.upload.filename)+' · '+h(size(p.upload.bytes))+' · '+h(p.upload.offset||0)+' bytes observed</p>':'')+'<div class="actions">'+button(p.state==='committed'?'Finish saved response':'Retry same request','retry-pending','',{disabled:S.busy})+button('Inspect request','inspect-pending')+button('Read original receipt','recover-pending','',{disabled:S.busy})+(p.state==='rejected'?button('Close rejected request','close-rejected','',{disabled:S.busy}):'')+'</div>';
}
function controls() {
  const ready=!applicationClosing&&!applicationClosed&&!!S.session&&S.storageLoaded&&!S.storageError&&!S.loading&&!S.busy&&!S.pending&&!S.project?.historical&&!!S.session.permissions?.operate&&(!S.project||!!S.project.permissions?.operate);
  $$('[data-mutates]').forEach(el=>{el.disabled=!ready||el.dataset.unavailable==='true';});
  $('#tt-project-select').disabled=!S.session||S.busy;
  $('#tt-refresh').disabled=!S.session||S.loading;
  $('#tt-revision').disabled=!S.project||S.loading;
  $('#tt-signout').hidden=!S.session;$('#tt-signout').disabled=S.busy;
  if($('#tt-form-submit'))$('#tt-form-submit').disabled=!ready||!S.form||S.form.loading;
}
function normalizeOutcome(value,p) {
  need(value&&typeof value==='object'&&value.view&&typeof value.view.id==='string'
    &&Number.isSafeInteger(value.view.revision)&&Number.isSafeInteger(value.currentRevision),
    'OUTCOME_UNREADABLE','The host response is missing its retained project identity. Retry the original request.');
  const body=JSON.parse(p.bodyText);
  if(p.path==='/api/actions'&&body.action!=='handoff.receive')
    need(value.view.id===body.projectId,'OUTCOME_PROJECT_MISMATCH','The returned project differs from this original request.');
  return value;
}
async function finishCommitted(p) {
  p=adoptPending(p);
  const value=normalizeOutcome(p.response,p);
  const record={...p,upload:p.upload?{...p.upload,file:undefined}:undefined};
  if(record.upload)delete record.upload.file;else delete record.upload;
  await store('last:'+p.scope,record);
  const removed=await removePending(p);
  if(removed&&knownCommitted.has(p.scope)&&sameRequest(knownCommitted.get(p.scope),p))knownCommitted.get(p.scope).finished=true;
  if(S.scope===p.scope){if(removed)S.pending=null;else await loadStorage(S.project?.id,S.nav);S.lastOutcome=record;renderPending();controls();}
  const destination=value.result?.projectId||value.view.id;
  try {
    if(!applicationClosing&&S.nav===p.navigation&&S.scope===p.scope&&!S.project?.historical) {
      await openProject(destination,null,{pane:p.pane||S.pane});
      notice('The original request is committed at revision '+value.view.revision+'. The current project is shown.',{title:p.label||'Saved'});
    } else notice('The original request completed. Its response is retained with the project.',{title:p.label||'Saved'});
    if(!applicationClosing)await refreshProjects();
  } catch(error) {notice('The original request is committed at revision '+value.view.revision+'. Refresh its current view when the host is reachable. '+errorText(error),{title:p.label||'Saved'});}
  return value;
}
async function uploadExact(p) {
  const u=p.upload;
  need(u?.file instanceof Blob&&u.file.size===u.bytes,'UPLOAD_SOURCE_MISSING','The original complete upload is not available in this browser.');
  need(await sha(await u.file.arrayBuffer())===u.sha256,'UPLOAD_SOURCE_CHANGED','The retained upload differs from its recorded hash.');
  let remote;
  try {remote=await request('/api/uploads/'+encodeURIComponent(u.id));}
  catch(error) {
    if(error.status!==404)throw error;
    remote=await request('/api/uploads',{method:'POST',body:{uploadId:u.id,filename:u.filename,mediaType:u.mediaType,bytes:u.bytes,sha256:u.sha256}});
  }
  function check(value) {
    need(value?.id===u.id&&value.bytes===u.bytes&&value.sha256===u.sha256&&Number.isSafeInteger(value.offset)&&value.offset>=0&&value.offset<=u.bytes,
      'UPLOAD_IDENTITY_CHANGED','The host upload does not match its original bytes and ID.');
  }
  check(remote);p.state='uploading';
  while(remote.offset<u.bytes) {
    const start=remote.offset,end=Math.min(start+8*1024*1024,u.bytes),chunk=await u.file.slice(start,end).arrayBuffer(),chunkSha=await sha(chunk);
    remote=await request('/api/uploads/'+encodeURIComponent(u.id),{method:'PATCH',body:chunk,headers:{'Content-Type':'application/octet-stream','Content-Range':'bytes '+start+'-'+(end-1)+'/'+u.bytes,'X-Chunk-SHA256':chunkSha}});
    check(remote);need(remote.offset>=end,'UPLOAD_PROGRESS_UNCERTAIN','The host did not confirm this complete chunk. Resume the same upload.');
    u.offset=remote.offset;await persistPending(p);
  }
  const completed=await request('/api/uploads/'+encodeURIComponent(u.id)+'/finish',{method:'POST',body:{}});
  check(completed);need(completed.complete&&completed.objectId,'UPLOAD_NOT_COMPLETE','The host has not sealed the original upload.');
  p.upload={...u,offset:u.bytes,complete:true,objectId:completed.objectId};p.state='prepared';await persistPending(p);
}
async function recoverPending() {
  need(!S.busy&&S.pending,'REQUEST_NOT_PENDING','Select the original retained request first.');
  const p=clone(S.pending),actorId=S.session.actor.id,instanceId=S.session.instanceId;
  validatePending(p,S.scope);S.busy=true;controls();
  try {
    const receipt=await request('/api/requests/'+encodeURIComponent(p.requestId));
    const body=JSON.parse(p.bodyText),bound=p.path==='/api/projects'?{action:'project.create',...body}:body;
    need(receipt.schema==='tjlabs.tiptap-request-receipt.v1'&&receipt.instanceId===instanceId&&receipt.actorId===actorId&&
      receipt.requestId===p.requestId&&receipt.inputSha256===await sha(enc.encode(canonical(bound))),
      'REQUEST_RECEIPT_CHANGED','The native receipt does not match this exact original actor, input and request.');
    p.response=normalizeOutcome(receipt.response,p);p.state='committed';p.committedAt=new Date().toISOString();
    adoptPending(p);if(S.scope===p.scope)S.pending=adoptPending(p);
    await persistPending(p);return await finishCommitted(p);
  } catch(error) {
    if(error.code==='REQUEST_NOT_FOUND'){notice('The host has no committed receipt for this original request. Its exact input remains retained for reconciliation.');return null;}
    throw error;
  } finally {S.busy=false;controls();}
}
async function sendPending(original) {
  validatePending(original,original.scope);
  need(original.scope===S.scope,'PENDING_SCOPE_MISMATCH','Open the original request’s project before retrying.');
  need(S.storageLoaded&&!S.storageError,'REQUEST_STORAGE_UNREAD','Reload the original browser request first.');
  need(!S.busy,'ACTION_IN_PROGRESS','The original request is already being handled.');
  const p=adoptPending(clone(original));p.navigation=S.nav;p.pane=S.pane;S.busy=true;controls();
  try {
    if(p.state==='committed')return await finishCommitted(p);
    if(p.upload&&!p.upload.complete)await uploadExact(p);
    p.state='sending';delete p.error;await persistPending(p);
    const value=normalizeOutcome(await request(p.path,{method:'POST',body:p.bodyText,headers:{'Content-Type':'application/json'}}),p);
    p.state='committed';p.response=value;p.committedAt=new Date().toISOString();
    adoptPending(p);if(S.scope===p.scope)S.pending=adoptPending(p);
    await persistPending(p);
    return await finishCommitted(p);
  } catch(error) {
    p.state=error.status>=400&&error.status<500&&!error.uncertain?'rejected':'uncertain';
    p.error={code:error.code||'REQUEST_UNCERTAIN',message:String(error.message||error),status:error.status??null};
    if(p.response)p.state='committed';
    try {await persistPending(p);} catch(storageError) {S.storageError=storageError;S.storageLoaded=false;if(S.scope===p.scope)S.pending=adoptPending(p);}
    renderPending();throw error;
  } finally {S.busy=false;controls();}
}
async function mutate(action,payload,{label,upload,create=false,captured=null}={}) {
  requireWrite();
  const origin=captured||{projectId:S.project?.id||null,revision:S.project?.revision,scope:S.scope,nav:S.nav,pane:S.pane};
  need(origin.scope===S.scope&&origin.nav===S.nav&&origin.projectId===(S.project?.id||null),'ACTION_VIEW_CHANGED','The selected project changed while this action was being prepared.');
  let body,uploadRecord=null;
  const requestId=id();
  if(upload) {
    S.busy=true;controls();
    try {
      need(upload.file instanceof File&&upload.file.size>0&&upload.file.size<=512*1024*1024,'UPLOAD_SIZE','Choose a nonempty file no larger than 512 MiB.');
      const uploadId=id(),digest=await sha(await upload.file.arrayBuffer());
      uploadRecord={id:uploadId,file:upload.file,filename:upload.file.name,mediaType:upload.file.type||'application/octet-stream',bytes:upload.file.size,sha256:digest,offset:0,complete:false};
      payload={...payload,uploadId};
      need(origin.nav===S.nav&&origin.scope===S.scope,'ACTION_VIEW_CHANGED','The project changed before its upload was retained.');
    } finally {S.busy=false;controls();}
  }
  body=create?{requestId,...clone(payload)}:{action,projectId:origin.projectId,expectedRevision:origin.revision,requestId,payload:clone(payload)};
  const p={schema:'tjlabs.tiptap-browser-request.v1',scope:origin.scope,path:create?'/api/projects':'/api/actions',requestId,
    expectedRevision:create?null:origin.revision,bodyText:JSON.stringify(body),label:label||action,createdAt:new Date().toISOString(),
    navigation:origin.nav,pane:origin.pane,state:'prepared',...(uploadRecord?{upload:uploadRecord}:{})};
  try {await persistPending(p);} catch(error) {if(error.code==='PENDING_REQUEST_CONFLICT')await loadStorage(S.project?.id,S.nav);throw error;}return sendPending(p);
}
async function refreshProjects() {
  if(!S.session)return;
  const actor=S.session.actor.id,instance=S.session.instanceId;
  const value=await request('/api/projects');
  if(S.session?.actor.id!==actor||S.session?.instanceId!==instance)return;
  need(value.instanceId===instance&&Array.isArray(value.projects),'PROJECT_LIST_IDENTITY','The host project list changed installation.');
  S.projects=value.projects;renderProjectList();
}
function renderProjectList() {
  const selected=S.project?.id||'';
  const rows=[...S.projects];if(S.project&&!rows.some(p=>p.id===S.project.id))rows.push(S.project);
  $('#tt-project-select').innerHTML='<option value="">Select a project</option>'+rows.map(p=>'<option value="'+h(p.id)+'"'+(p.id===selected?' selected':'')+'>'+h(p.title)+' · r'+h(p.revision)+'</option>').join('');
}
function routeValue() {
  const raw=location.hash.replace(/^#/,'')||'/overview',question=raw.indexOf('?'),path=question<0?raw:raw.slice(0,question);
  const q=new URLSearchParams(question<0?'':raw.slice(question+1));
  return {pane:Object.hasOwn(PANES,path.slice(1))?path.slice(1):'overview',project:q.get('project')||null,revision:q.has('revision')?Number(q.get('revision')):null};
}
function setRoute({pane=S.pane,project=S.project?.id,revision=S.project?.historical?S.project.revision:null}={}) {
  const q=new URLSearchParams();if(project)q.set('project',project);if(revision!==null&&revision!==undefined)q.set('revision',String(revision));
  const next='#/'+pane+(q.size?'?'+q.toString():'');history.replaceState(null,'',next);updateNavigation();
}
function updateNavigation() {
  $$('#tt-navigation a').forEach(a=>{
    const pane=a.dataset.pane,q=new URLSearchParams();if(S.project)q.set('project',S.project.id);if(S.project?.historical)q.set('revision',String(S.project.revision));
    a.href='#/'+pane+(q.size?'?'+q.toString():'');if(pane===S.pane)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
}
async function closeEditorOwner(editor) {
  try {await editor.close();}
  finally {
    if(editor.inspect().closed) {
      editorOwners.delete(editor);
      if(S.editor===editor){S.editor=null;S.editorState=null;$('#tt-editor-section').hidden=true;$('#tt-editor').textContent='';}
    }
  }
}
async function closeEditor() {
  if(S.editor)editorOwners.add(S.editor);
  let first;
  for(const editor of [...editorOwners]) {
    try {await closeEditorOwner(editor);}catch(error){first ||= error;}
  }
  if(first)throw first;
}
async function openProject(projectId,revision=null,{pane=S.pane}={}) {
  await saveMigrationDraft();
  const nav=++S.nav;
  S.loading=true;S.detailGeneration++;$('#tt-detail-dialog').close();closeForm();controls();
  try {
    if(S.editor&&(S.editor.identity.projectId!==projectId||revision!==null))await closeEditor();
    const value=await request('/api/projects/'+encodeURIComponent(projectId)+(revision!==null?'?revision='+encodeURIComponent(revision):''));
    if(nav!==S.nav)return;
    need(value.id===projectId&&Number.isSafeInteger(value.revision),'PROJECT_IDENTITY_CHANGED','The project response has another identity.');
    S.project=value;S.pane=Object.hasOwn(PANES,pane)?pane:'overview';S.loading=false;
    await loadStorage(projectId,nav);if(nav!==S.nav)return;
    setRoute();render();syncEditorIdentity();schedulePoll();
  } catch(error) {if(nav===S.nav){S.loading=false;report(error);}throw error;}
  finally {if(nav===S.nav){S.loading=false;controls();}}
}
function renderIdentity() {
  const p=S.project;
  $('#tt-actor').textContent=S.session?S.session.actor.name+' · '+S.session.actor.id:'';
  $('#tt-instance').textContent=S.session?.instanceId||'Not connected';
  $('#tt-runtime-summary').textContent=S.session?.runtime?.ready?'The selected native runtime is ready.':S.session?.runtime?.configured?'The selected runtime needs its recorded inspection.':'The host has not selected a native runtime.';
  $('#tt-connection').textContent=S.session?'Host session active':'Sign in to open a workspace';
  $('#tt-connection').dataset.state=S.session?'ready':'';
  if(!p)return;
  $('#tt-identity').innerHTML='<span class="eyebrow">'+h(PANES[S.pane])+'</span><strong>'+h(p.title)+'</strong><div class="identity-meta"><code>'+h(p.id)+'</code>'+badge((p.historical?'Historical':'Current')+' · revision '+p.revision,p.historical)+'<span>Latest '+h(p.currentRevision??p.revision)+'</span></div>';
  const revisions=[...new Set([p.revision,p.currentRevision,...(p.history||[]).map(e=>e.revision)].filter(Number.isSafeInteger))].sort((a,b)=>b-a);
  $('#tt-revision').innerHTML='<option value=""'+(!p.historical?' selected':'')+'>Current view</option>'+revisions.map(n=>'<option value="'+n+'"'+(p.historical&&p.revision===n?' selected':'')+'>Revision '+n+'</option>').join('');
  renderProjectList();updateNavigation();
}
function heading(title,description,actions='') {return '<header class="page-heading"><div><span class="eyebrow">'+h(S.project?.title||'Workspace')+'</span><h1>'+h(title)+'</h1><p class="help">'+h(description)+'</p></div><div class="actions">'+actions+'</div></header>';}
function empty(title,text,actions='') {return '<section class="empty"><h3>'+h(title)+'</h3><p class="help">'+h(text)+'</p><div class="actions">'+actions+'</div></section>';}
function table(columns,rows) {return '<div class="table-wrap"><table class="data-table"><thead><tr>'+columns.map(c=>'<th>'+h(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';}
function recordButtons(kind,item,extra='') {return '<div class="actions">'+button('Inspect','inspect-record',kind+':'+item.id,{class:'quiet small-button'})+extra+'</div>';}
function item(collection,key) {return (S.project?.[collection]||[]).find(v=>v.id===key);}
function requireItem(collection,key) {const value=item(collection,key);need(value,'RECORD_NOT_SELECTED','This record is not in the selected project revision.');return value;}
function jsonDetail(title,value,kind='Retained record') {
  S.detailGeneration++;$('#tt-detail-title').textContent=title;$('#tt-detail-kind').textContent=kind;
  $('#tt-detail-body').innerHTML='<pre></pre>';$('#tt-detail-body pre').textContent=j(value);$('#tt-detail-dialog').showModal();
}

function overview() {
  const p=S.project,docs=p.documents||[],jobs=p.jobs||[],active=(p.deployments||[]).find(d=>d.id===p.activeDeploymentId);
  return heading('A complete path into collaboration','Keep source decisions, native document state, and the receiving handoff in one retained project.',button('Project details','form','project.update',{mutate:true}))
    +'<section class="metrics">'+[
      ['Retained sources',(p.sources||[]).length],['Documents',docs.length],['Current edition',p.currentEditionId?brief(p.currentEditionId):'—'],['Native runtime',active?.status||'Closed'],
    ].map(([label,value])=>'<div class="card"><span class="eyebrow">'+h(label)+'</span><strong class="metric">'+h(value)+'</strong></div>').join('')+'</section>'
    +'<div class="two-columns"><section class="card"><h2>Working sequence</h2><ol class="rule-list">'
    +[['01','Retain the application inputs','Keep the complete document source, schema, application, and authorization contract.'],
      ['02','Review the tenant and document mapping','Choose the target names and disposition of each original source row before import.'],
      ['03','Open the original collaboration runtime','Use the approved edition and explicit document grants for each host actor.'],
      ['04','Retain a checkpoint and deliver','Close or drain the selected runtime, preserve the binary state, and verify the receiving project.']]
      .map(([n,title,text])=>'<li><span class="number">'+n+'</span><div><strong>'+h(title)+'</strong><p class="help">'+h(text)+'</p></div></li>').join('')+'</ol></section>'
    +'<div class="stack"><section class="card"><h3>Project notes</h3><p class="help">'+h(p.notes||'Add the application boundary, accountable people, and receiving requirements.')+'</p><div class="card-meta"><div><span>Created</span><span>'+h(time(p.createdAt))+'</span></div><div><span>Updated</span><span>'+h(time(p.updatedAt))+'</span></div><div><span>Host permission</span><span>'+h(p.permissions?.operate?'Operator':p.permissions?.edit?'Editor':'Read')+'</span></div></div></section>'
    +'<section class="card"><h3>Current work</h3><p class="help">'+h(jobs.filter(v=>['queued','running','cancelling'].includes(v.status)).length)+' live jobs · '+h(jobs.filter(v=>['failed','interrupted'].includes(v.status)).length)+' jobs need review.</p><div class="actions">'+button('Migration review','pane','migrations')+button('Runtime','pane','runtime')+'</div></section></div></div>';
}
function sources() {
  const rows=S.project.sources||[];
  return heading('Original sources','Upload complete inputs and keep their original hash, role, and attribution available in every selected revision.',button('Retain source','form','source.retain',{mutate:true}))
    +(rows.length?table(['Source','Role','Original bytes','Received','Actions'],rows.map(s=>'<tr><td class="title-cell"><strong>'+h(s.title||s.filename||s.id)+'</strong><span class="small">'+h(s.filename||'')+'</span>'+(s.url?'<span class="small">'+h(s.url)+'</span>':'')+'</td><td>'+badge(s.role)+'</td><td>'+h(size(s.bytes))+'<code class="hash">'+h(s.sha256)+'</code></td><td>'+h(time(s.createdAt||s.receivedAt))+'</td><td>'+recordButtons('sources',s,button('Read source','read-source',s.id)+button('Download','download-source',s.id))+'</td></tr>')):empty('No source has been retained','Start with the original complete JSON document population, HTML document, or Yjs binary state.',button('Retain source','form','source.retain',{mutate:true})));
}
function access() {
  const p=S.project,tenants=p.tenants||[],grants=p.grants||[];
  return heading('Tenant access','The host verifies each actor. A project grant authorizes only its selected tenant and document set.',button('Add tenant','form','tenant.save',{mutate:true})+button('Add grant','form','grant.save',{mutate:true}))
    +'<section class="cards">'+tenants.map(t=>'<article class="card"><span class="eyebrow">Tenant</span><h3>'+h(t.name||t.id)+'</h3><code>'+h(t.id)+'</code><p class="help">'+h(t.notes||'')+'</p><div class="actions">'+button('Edit','edit-tenant',t.id,{mutate:true})+button('Inspect','inspect-record','tenants:'+t.id,{class:'quiet small-button'})+'</div></article>').join('')+'</section>'
    +(!tenants.length?empty('Create the receiving tenants','Use the application’s actual tenant identities before reviewing a document mapping.'):'')
    +'<div class="section-title"><div><h2>Document grants</h2><p class="help">An empty document selection grants access to all documents in that one tenant.</p></div></div>'
    +(grants.length?table(['Actor / tenant','Document selection','Access','Review reason','Actions'],grants.map(g=>'<tr><td class="title-cell"><strong>'+h(g.actorId)+'</strong><span class="small">'+h(g.tenantId)+'</span></td><td>'+h(g.documentIds?.length?g.documentIds.join(', '):'All documents in this tenant')+'</td><td>'+badge(g.access)+' '+badge(g.enabled?'Enabled':'Disabled',!g.enabled)+'</td><td>'+h(g.reason||'')+'</td><td>'+recordButtons('grants',g,button('Edit','edit-grant',g.id,{mutate:true}))+'</td></tr>')):empty('No document grants','An operator session alone does not authorize a live document connection.'));
}
function isFrozen(e) {return e.status==='frozen'||e.frozen===true||!!e.frozenAt;}
function editions() {
  const list=S.project.editions||[];
  return heading('Reviewed application editions','Keep source selection, shared schema, field, and native runtime configuration together. Freeze an edition before preparing its migration and deployment.',button('New edition','form','edition.save',{mutate:true}))
    +(list.length?'<section class="record-list">'+list.map(e=>'<article class="record-row"><div class="description"><span class="eyebrow">'+h(e.id)+'</span><h3>'+h(e.title)+' '+badge(isFrozen(e)?'Frozen':'Working',isFrozen(e))+'</h3><p class="small">'+h(e.schemaId)+' · field '+h(e.field)+' · '+h(e.sourceIds?.length||0)+' sources</p><p class="help">'+h(e.notes||'')+'</p></div><div class="actions">'+button('Inspect','inspect-record','editions:'+e.id,{class:'quiet small-button'})+button('Edit','edit-edition',e.id,{mutate:true,disabled:isFrozen(e)})+button('Freeze','freeze-edition',e.id,{mutate:true,disabled:isFrozen(e)})+'</div></article>').join('')+'</section>':empty('No application edition','Retain its complete inputs, then save the shared schema and native configuration.',button('New edition','form','edition.save',{mutate:true})));
}
function migrations() {
  const list=S.project.migrations||[],selected=list.find(v=>v.id===S.selectedMigration);
  let result=heading('Migration review','Inspect each original row and explicitly choose its target tenant, document name, and import or skip decision.',button('Plan migration','form','migration.plan',{mutate:true}));
  result+=list.length?table(['Migration','Source / edition','State','Actions'],list.map(m=>'<tr><td class="title-cell"><strong>'+h(m.title||m.id)+'</strong><span class="small">'+h(m.id)+'</span></td><td><span>'+h(brief(m.sourceId))+'</span><span class="small"> · '+h(brief(m.editionId))+'</span></td><td>'+badge(m.status||'planned')+'</td><td><div class="actions">'+button('Review rows','select-migration',m.id)+button('Inspect','inspect-record','migrations:'+m.id,{class:'quiet small-button'})+'</div></td></tr>')):empty('No migration plan','Select the original source, target edition, format, and field mapping.',button('Plan migration','form','migration.plan',{mutate:true}));
  if(!selected)return result;
  const rows=selected.rows||[],draft=S.drafts['migration:'+selected.id]||{},offset=Number(S.migrationOffset)||0,page=rows.slice(offset,offset+100);
  result+='<section id="tt-migration-review"><div class="section-title"><div><h2>'+h(selected.title||'Selected migration')+'</h2><p class="help">'+rows.length+' original rows. A nonempty target is protected by the native import gate.</p></div><div class="actions">'+button('Apply reviewed import','apply-migration',selected.id,{mutate:true,disabled:!rows.length||rows.some(r=>r.decision==='unreviewed'||r.status==='error')})+'</div></div>'
    +(Number.isSafeInteger(draft._revision)&&draft._revision!==S.project.revision?'<p class="permission-note">This row draft began at revision '+h(draft._revision)+'. Review the current rows before rebinding it. '+button('Use reviewed current revision','rebase-migration','',{mutate:true})+'</p>':'')
    +'<form id="tt-migration-form" data-migration="'+h(selected.id)+'"><div class="table-wrap"><table class="data-table"><thead><tr><th>Original row</th><th>Decision</th><th>Tenant / target name</th><th>Target title</th><th>Reason</th></tr></thead><tbody>'
    +page.map(r=>{
      const v={...r,...draft[r.id]};
      return '<tr data-row="'+h(r.id)+'"><td class="title-cell"><strong>'+h(r.title||r.sourceKey)+'</strong><span class="small">'+h(r.sourceKey)+'</span>'+badge(r.status)+'<code class="hash">'+h(r.sourceSha256)+'</code>'+(r.errors?.length?'<p class="small">'+h(r.errors.map(x=>typeof x==='string'?x:JSON.stringify(x)).join('; '))+'</p>':'')+'</td>'
        +'<td><label class="sr-only" for="decision-'+h(r.id)+'">Decision for '+h(r.title)+'</label><select id="decision-'+h(r.id)+'" name="decision" data-mutates><option value="unreviewed"'+(v.decision==='unreviewed'?' selected':'')+'>Review needed</option><option value="import"'+(v.decision==='import'?' selected':'')+'>Import</option><option value="skip"'+(v.decision==='skip'?' selected':'')+'>Skip</option></select></td>'
        +'<td><label>Tenant<select name="tenantId" data-mutates>'+options(S.project.tenants||[],v.tenantId,t=>t.name||t.id)+'</select></label><label>Document name<input class="review-name" name="documentName" value="'+h(v.documentName||'')+'" data-mutates></label></td>'
        +'<td><label class="sr-only">Target title</label><input class="review-title" name="title" value="'+h(v.title||'')+'" data-mutates></td>'
        +'<td><label class="sr-only">Decision reason</label><textarea name="reason" data-mutates>'+h(v.reason||'')+'</textarea></td></tr>';
    }).join('')+'</tbody></table></div><div class="table-toolbar" style="margin-top:12px"><div class="actions">'+button('Previous rows','migration-page',String(Math.max(0,offset-100)),{disabled:offset===0})+'<span class="small">'+(rows.length?offset+1:0)+'–'+Math.min(rows.length,offset+100)+' of '+rows.length+'</span>'+button('Next rows','migration-page',String(offset+100),{disabled:offset+100>=rows.length})+'</div><button type="submit" data-mutates>Save row review</button></div></form></section>';
  return result;
}
function documentsPane() {
  const rows=S.project.documents||[];
  return heading('Collaborative documents','Open a current document through its original host grant. The editor retains its own epoch and reports server persistence from the complete native binary state.')
    +(S.project.historical?'<p class="permission-note">This is a retained historical project revision. Its document identities and checkpoints can be inspected; it has no live editing connection.</p>':'')
    +(rows.length?table(['Document','Tenant / epoch','Retained native state','Actions'],rows.map(d=>'<tr><td class="title-cell"><strong>'+h(d.title||d.logicalKey||d.id)+'</strong><span class="small">'+h(d.logicalKey||d.documentName)+'</span>'+badge(d.access||'No live grant')+'</td><td><span>'+h(d.tenantId)+'</span><code class="hash">'+h(d.epochId)+'</code></td><td>'+h(d.persisted?time(d.persisted.savedAt):'Not yet retained')+(d.persisted?'<code class="hash">'+h(d.persisted.sha256)+'</code><span class="small">'+h(size(d.persisted.bytes))+'</span>':'')+'</td><td>'+recordButtons('documents',d,button(d.access==='read'?'Open read view':'Open editor','open-document',d.id,{disabled:S.project.historical||!['read','write'].includes(d.access)}))+'</td></tr>')):empty('No imported documents','Apply the reviewed original migration before opening a collaborative document.',button('Migration review','pane','migrations')));
}
function runtimePane() {
  const p=S.project,list=p.deployments||[],jobs=p.jobs||[];
  return heading('Native runtime','Prepare the selected edition, start or drain its original Hocuspocus owner, and retain every job outcome.',button('Prepare deployment','form','deployment.prepare',{mutate:true})+button('Create checkpoint','form','checkpoint.create',{mutate:true}))
    +'<section class="card" style="margin-bottom:20px"><span class="eyebrow">Receiving host selection</span><h3>'+h(p.runtime?.ready?'Native runtime ready':p.runtime?.configured?'Runtime inspection required':'No runtime selected')+'</h3><p class="help">'+h(p.runtime?.error?errorText(p.runtime.error):'The receiving host owns the installed native package selection. A portable handoff opens closed.')+'</p><div class="actions">'+button('Inspect runtime','inspect-runtime')+'</div></section>'
    +(list.length?'<section class="record-list">'+list.map(d=>'<article class="record-row"><div class="description"><span class="eyebrow">'+h(d.id)+'</span><h3>'+h(d.title||'Deployment')+' '+badge(d.status,d.status==='running')+'</h3><p class="small">Edition '+h(d.editionId)+' · '+h(time(d.updatedAt||d.createdAt))+'</p>'+(d.lastError?'<p class="help">'+h(errorText(d.lastError))+'</p>':'')+'</div><div class="actions">'+button('Inspect','inspect-record','deployments:'+d.id,{class:'quiet small-button'})+button('Start','start-deployment',d.id,{mutate:true,disabled:!['prepared','stopped','failed','interrupted'].includes(d.status)})+button('Drain & stop','stop-deployment',d.id,{mutate:true,disabled:!['running','stopping'].includes(d.status)})+button('Rollback config','rollback-deployment',d.id,{mutate:true})+'</div></article>').join('')+'</section>':empty('No deployment has been prepared','Select the frozen edition that should own the native collaboration runtime.'))
    +'<div class="section-title"><div><h2>Native jobs</h2><p class="help">Resume only the retained original job after inspecting its actual failure or interruption.</p></div></div>'
    +(jobs.length?table(['Job','State / progress','Outcome','Actions'],jobs.map(job=>'<tr><td class="title-cell"><strong>'+h(job.title||job.kind||job.id)+'</strong><span class="small">'+h(job.id)+'</span></td><td>'+badge(job.status)+'<p class="small">'+h(job.progress?.phase||'')+' '+h(job.progress?.completed??'')+(job.progress?.total!==undefined?' / '+h(job.progress.total):'')+'</p></td><td>'+h(job.error?errorText(job.error):job.summary?JSON.stringify(job.summary):'Retained native attempt')+'</td><td>'+recordButtons('jobs',job,button('Cancel','cancel-job',job.id,{mutate:true,disabled:!['queued','running','cancelling'].includes(job.status)})+button('Resume','resume-job',job.id,{mutate:true,disabled:!['failed','interrupted'].includes(job.status)}))+'</td></tr>')):empty('No native job has been requested','Source retention and mapping review can proceed before the first native import.'));
}
function delivery() {
  const p=S.project,checkpoints=p.checkpoints||[],handoffs=p.handoffs||[],history=p.history||[];
  return heading('Delivery and retained history','Create a complete native checkpoint, retain the chosen project edition, and reopen its original source and document state on the receiving host.',button('Prepare handoff','form','handoff.prepare',{mutate:true})+button('Receive handoff','form','handoff.receive',{mutate:true}))
    +'<div class="section-title"><h2>Document checkpoints</h2><div class="actions">'+button('Create checkpoint','form','checkpoint.create',{mutate:true})+'</div></div>'
    +(checkpoints.length?table(['Checkpoint','Document state','Created','Actions'],checkpoints.map(c=>'<tr><td class="title-cell"><strong>'+h(c.title||c.id)+'</strong><span class="small">'+h(c.id)+'</span>'+badge(c.source||'retained')+'</td><td>'+h(c.documents?.length||c.documentIds?.length||0)+' documents<span class="small"> · '+h(size(c.bytes))+'</span></td><td>'+h(time(c.createdAt))+'</td><td>'+recordButtons('checkpoints',c,button('Download','download-checkpoint',c.id)+button('Restore content','restore-checkpoint',c.id,{mutate:true})+button('Review','review-checkpoint',c.id,{mutate:true}))+'</td></tr>')):empty('No checkpoint has been created','A drain checkpoint closes the selected native runtime before sealing its document state.'))
    +'<div class="section-title"><h2>Named handoffs</h2></div>'
    +(handoffs.length?table(['Handoff','Selected revision / bytes','Created','Actions'],handoffs.map(v=>'<tr><td class="title-cell"><strong>'+h(v.title||v.id)+'</strong><span class="small">'+h(v.filename||'')+'</span></td><td>Revision '+h(v.revision)+' · '+h(size(v.bytes))+'<code class="hash">'+h(v.sha256)+'</code></td><td>'+h(time(v.createdAt))+'</td><td>'+recordButtons('handoffs',v,button('Download','download-handoff',v.id)+button('Review','review-handoff',v.id,{mutate:true}))+'</td></tr>')):empty('No handoff has been prepared','Retain an explicit project revision after reviewing its migration, runtime, and document state.'))
    +'<div class="section-title"><div><h2>Project history</h2><p class="help">Every historical view stays bound to its original source and physical document epoch.</p></div></div>'
    +'<ol class="timeline">'+[...history].reverse().map(e=>'<li><span class="mono small">r'+h(e.revision)+'</span><div><strong>'+h(e.summary||e.type)+'</strong><p class="small">'+h(e.actorId)+' · '+h(time(e.createdAt))+'</p></div><div class="actions">'+button('Open revision','open-revision',String(e.revision))+button('Inspect','inspect-event',e.id,{class:'quiet small-button'})+'</div></li>').join('')+'</ol>';
}
function render() {
  if(!S.session)return;
  renderIdentity();
  if(!S.project) {
    $('#tt-main').innerHTML=heading('Choose the original project','Open a retained project or create the application migration boundary.',button('New project','form','project.create',{mutate:true}))
      +'<section class="cards">'+S.projects.map(p=>'<article class="card"><span class="eyebrow">Revision '+h(p.revision)+'</span><h3>'+h(p.title)+'</h3><p class="small">'+h(p.documentCount||0)+' documents · '+h(p.sourceCount||0)+' sources</p><div class="actions">'+button('Open project','open-project',p.id)+'</div></article>').join('')+'</section>';
  } else {
    const views={overview,sources,access,editions,migrations,documents:documentsPane,runtime:runtimePane,delivery};
    $('#tt-main').innerHTML=(S.project.historical?'<p class="permission-note">Historical revision '+h(S.project.revision)+'. Original sources and records are available for inspection. '+button('Open current view','current-project')+'</p>':'')+views[S.pane]();
  }
  renderPending();controls();
}
function schedulePoll() {
  clearTimeout(S.poll);
  if(applicationClosing||applicationClosed)return;
  if(!S.session||!S.project||S.project.historical)return;
  S.poll=setTimeout(async()=>{
    const nav=S.nav,projectId=S.project?.id,instance=S.session?.instanceId,reading=++S.reading;
    try {
      const value=await request('/api/projects/'+encodeURIComponent(projectId));
      if(nav===S.nav&&S.project?.id===projectId&&!S.project.historical&&S.session?.instanceId===instance&&reading===S.reading) {
        need(value.id===projectId,'PROJECT_IDENTITY_CHANGED','The refreshed project has another identity.');
        if(S.form||$('#tt-migration-form')?.contains(document.activeElement)) {S.observedRevision=value.revision;$('#tt-connection').textContent='Host current revision '+value.revision+' · draft view retained';}
        else {S.project=value;render();syncEditorIdentity();}
      }
    } catch(error) {if(nav===S.nav)$('#tt-connection').textContent='Project refresh pending · '+(error.code||'connection');}
    finally {if(nav===S.nav&&!applicationClosing)schedulePoll();}
  },4500);
}
function options(values,selected,label=v=>v.title||v.name||v.id,allowEmpty=false) {
  return (allowEmpty?'<option value="">Select…</option>':'')+values.map(v=>{
    const key=typeof v==='string'?v:v.id,text=typeof v==='string'?v:label(v);
    return '<option value="'+h(key)+'"'+(String(key)===String(selected)?' selected':'')+'>'+h(text)+'</option>';
  }).join('');
}

const textField=(name,label,value='',extra={})=>({name,label,type:'text',value,...extra});
const selectField=(name,label,values,value='',extra={})=>({name,label,type:'select',values,value,...extra});
const jsonField=(name,label,value,extra={})=>({name,label,type:'json',value:typeof value==='string'?value:j(value),wide:true,...extra});
const multiField=(name,label,values,value=[],extra={})=>({name,label,type:'multi',values,value,wide:true,...extra});
function specFor(name,p,record={}) {
  const tenants=p?.tenants||[],editions=p?.editions||[],sources=p?.sources||[],documents=p?.documents||[],deployments=p?.deployments||[],checkpoints=p?.checkpoints||[];
  const commonEdition=editions.find(e=>e.id===p?.currentEditionId)||editions.at(-1);
  const originalJSONMapping={arrayPath:'documents',sourceKeyField:'id',titleField:'title',tenantField:'tenantId',contentField:'content',documentNameField:'documentName',schemaId:SCHEMA_ID,field:FIELD_NAME,defaultTenantId:tenants[0]?.id||''};
  const specs={
    'project.create':{title:'New migration project',description:'Name the application boundary and retain its working notes.',create:true,
      fields:[textField('title','Project title','',{required:true,wide:true}),textField('notes','Working notes','',{type:'textarea',wide:true})],build:v=>({title:v.title,notes:v.notes})},
    'project.update':{title:'Project details',description:'Keep project notes and the original namespace explicit.',action:'project.update',
      fields:[textField('title','Project title',p?.title,{required:true,wide:true}),textField('notes','Working notes',p?.notes,{type:'textarea',wide:true}),jsonField('settings','Project settings',p?.settings||{})],build:v=>({title:v.title,notes:v.notes,settings:v.settings})},
    'source.retain':{title:'Retain original source',description:'The complete selected file is saved in this browser before an upload begins. The host verifies every chunk and the final file hash.',action:'source.retain',file:true,
      fields:[textField('file','Original file','',{type:'file',required:true,wide:true}),textField('title','Source title','',{required:true}),selectField('role','Source role',['documents','schema','application','auth_contract','other'],'documents'),textField('url','Original source URL','',{wide:true}),jsonField('metadata','Attribution and source metadata',{})],
      build:v=>({title:v.title,role:v.role,...(v.url?{url:v.url}:{}),metadata:v.metadata})},
    'tenant.save':{title:record.id?'Edit tenant':'Add tenant',action:'tenant.save',description:'Use the application’s actual tenant identity. Grants never cross this boundary.',
      fields:[textField('tenantId','Tenant ID',record.id||'',{help:'An explicit ID such as tenant-a can match retained source rows.'}),textField('name','Tenant name',record.name||'',{required:true}),textField('notes','Notes',record.notes||'',{type:'textarea',wide:true})],
      build:v=>({...((record.id||v.tenantId)?{tenantId:record.id||v.tenantId}:{}),name:v.name,notes:v.notes})},
    'grant.save':{title:record.id?'Edit document grant':'Add document grant',action:'grant.save',description:'The host verifies actor identity. Select the tenant and specific documents, or leave the document set empty for all documents in that one tenant.',
      fields:[textField('actorId','Host actor ID',record.actorId||'',{required:true}),selectField('tenantId','Tenant',tenants,record.tenantId||tenants[0]?.id,{required:true}),multiField('documentIds','Selected documents',documents,record.documentIds||[],{help:'Every selected document must belong to the selected tenant.'}),selectField('access','Access',['read','write'],record.access||'read'),selectField('enabled','Grant state',[{id:'true',title:'Enabled'},{id:'false',title:'Disabled'}],String(record.enabled??true)),textField('reason','Grant review reason',record.reason||'',{type:'textarea',required:true,wide:true})],
      build:v=>({...record.id?{grantId:record.id}:{},actorId:v.actorId,tenantId:v.tenantId,documentIds:v.documentIds,access:v.access,enabled:v.enabled==='true',reason:v.reason})},
    'edition.save':{title:record.id?'Edit working edition':'New application edition',action:'edition.save',description:'Both native migration and browser editing use the shared original schema. Freeze the reviewed edition before native work.',
      fields:[textField('title','Edition title',record.title||'',{required:true,wide:true}),textField('notes','Review notes',record.notes||'',{type:'textarea',wide:true}),multiField('sourceIds','Retained sources',sources,record.sourceIds||sources.map(s=>s.id)),textField('schemaId','Shared schema ID',record.schemaId||SCHEMA_ID,{required:true}),textField('field','Yjs XML field',record.field||FIELD_NAME,{required:true}),jsonField('config','Native runtime configuration',record.config||{debounceMs:1000,maxDebounceMs:10000,maxDocumentBytes:33554432,allowedOrigins:[location.origin]})],
      build:v=>({...record.id?{editionId:record.id}:{},title:v.title,notes:v.notes,sourceIds:v.sourceIds,schemaId:v.schemaId,field:v.field,config:v.config})},
    'edition.freeze':{title:'Freeze reviewed edition',action:'edition.freeze',description:'The retained edition fixes its complete source, schema, field, and native configuration.',
      fields:[selectField('editionId','Edition',editions,record.id||commonEdition?.id,{required:true})],build:v=>({editionId:v.editionId})},
    'migration.plan':{title:'Plan original document migration',action:'migration.plan',description:'The native transformer reads the complete retained source. Review every resulting row before import.',
      fields:[textField('title','Migration title','',{required:true,wide:true}),selectField('editionId','Target edition',editions,commonEdition?.id,{required:true}),selectField('sourceId','Original document source',sources.filter(s=>s.role==='documents'),sources.find(s=>s.role==='documents')?.id,{required:true}),selectField('format','Original source format',[{id:'tiptap_json',title:'Tiptap JSON population'},{id:'html',title:'One HTML document'},{id:'yjs_update',title:'One native Yjs update'}],'tiptap_json'),jsonField('mapping','Exact document mapping',originalJSONMapping,{help:'For one HTML/Yjs document use {sourceKey,title,tenantId,documentName,schemaId,field}. Original nonempty targets are protected.'})],
      build:v=>({title:v.title,editionId:v.editionId,sourceId:v.sourceId,format:v.format,mapping:v.mapping})},
    'migration.apply':{title:'Apply reviewed migration',action:'migration.apply',description:'This starts the original retained native import. It never overwrites a nonempty existing document.',
      fields:[selectField('migrationId','Reviewed migration',p?.migrations||[],record.id,{required:true})],build:v=>({migrationId:v.migrationId})},
    'job.cancel':{title:'Cancel original native job',action:'job.cancel',description:'The original worker retains its actual completed work and cancellation outcome.',
      fields:[selectField('jobId','Original job',p?.jobs||[],record.id,{required:true}),textField('reason','Cancellation reason','',{type:'textarea',wide:true,required:true})],build:v=>({jobId:v.jobId,reason:v.reason})},
    'job.resume':{title:'Resume retained native job',action:'job.resume',description:'Inspect the original failure first. This continuation keeps the original job and completed work.',
      fields:[selectField('jobId','Original job',p?.jobs||[],record.id,{required:true}),textField('reason','Reviewed continuation reason','',{type:'textarea',wide:true,required:true})],build:v=>({jobId:v.jobId,reason:v.reason})},
    'deployment.prepare':{title:'Prepare native deployment',action:'deployment.prepare',description:'Bind a reviewed edition to this host’s selected original runtime.',
      fields:[textField('title','Deployment title','',{required:true,wide:true}),selectField('editionId','Reviewed edition',editions,commonEdition?.id,{required:true})],build:v=>({title:v.title,editionId:v.editionId})},
    'deployment.start':{title:'Start original deployment',action:'deployment.start',description:'The host starts its retained original Hocuspocus runtime for this selected deployment.',
      fields:[selectField('deploymentId','Deployment',deployments,record.id||p?.activeDeploymentId,{required:true})],build:v=>({deploymentId:v.deploymentId})},
    'deployment.stop':{title:'Drain and stop deployment',action:'deployment.stop',description:'The original runtime persists its document updates before its owner closes.',
      fields:[selectField('deploymentId','Deployment',deployments,record.id||p?.activeDeploymentId,{required:true}),textField('reason','Stop reason','',{type:'textarea',wide:true,required:true})],build:v=>({deploymentId:v.deploymentId,reason:v.reason})},
    'deployment.rollback':{title:'Rollback runtime configuration',action:'deployment.rollback',description:'Return to a reviewed configuration while preserving the current Yjs document data. Content restoration is a separate checkpoint action.',
      fields:[selectField('deploymentId','Deployment',deployments,record.id||p?.activeDeploymentId,{required:true}),selectField('targetEditionId','Target reviewed edition',editions,commonEdition?.id,{required:true}),textField('reason','Rollback reason','',{type:'textarea',wide:true,required:true})],
      build:v=>({deploymentId:v.deploymentId,targetEditionId:v.targetEditionId,reason:v.reason,documentPolicy:'preserve_current'})},
    'checkpoint.create':{title:'Retain native document checkpoint',action:'checkpoint.create',description:'A drain checkpoint closes the selected deployment. A persisted checkpoint captures its last committed complete document state.',
      fields:[textField('title','Checkpoint title','',{required:true,wide:true}),selectField('deploymentId','Deployment',deployments,p?.activeDeploymentId||deployments.at(-1)?.id,{allowEmpty:true}),selectField('mode','Checkpoint mode',[{id:'drain',title:'Drain and close native runtime'},{id:'persisted',title:'Current retained persisted state'}],'drain')],
      build:v=>({title:v.title,...v.deploymentId?{deploymentId:v.deploymentId}:{},mode:v.mode})},
    'document.restore':{title:'Restore checkpoint into new document epochs',action:'document.restore',description:'The core drains the original deployment and retains both histories. Earlier offline caches stay in their old physical epochs. The deployment remains stopped until explicitly restarted.',
      fields:[selectField('checkpointId','Original checkpoint',checkpoints,record.id||checkpoints.at(-1)?.id,{required:true}),multiField('documentIds','Documents to restore',documents,record.documentIds||record.documents?.map(d=>d.documentId||d.id)||[],{required:true}),textField('reason','Content restoration reason','',{type:'textarea',wide:true,required:true})],
      build:v=>({checkpointId:v.checkpointId,documentIds:v.documentIds,reason:v.reason,mode:'new_epoch'})},
    'handoff.prepare':{title:'Prepare complete receiving handoff',action:'handoff.prepare',description:'Close the native deployment first. The package binds the selected original project revision and complete source/binary closure; its named descriptor is recorded in the next revision.',
      fields:[textField('title','Handoff title','',{required:true,wide:true}),textField('notes','Receiving notes','',{type:'textarea',wide:true}),textField('revision','Selected project revision',String(p?.revision??''),{type:'number',required:true})],
      build:v=>({title:v.title,notes:v.notes,revision:Number(v.revision)})},
    'handoff.receive':{title:'Receive complete original project',action:'handoff.receive',file:true,description:'Upload the original complete .ndjson.gz handoff. The imported project keeps its original ID and opens closed, with this receiving host’s own authorization and runtime.',
      fields:[textField('file','Original handoff file','',{type:'file',required:true,wide:true})],build:()=>({})},
    'review.save':{title:'Retain operator review',action:'review.save',description:'Record a decision against the exact selected native subject and its retained source evidence.',
      fields:[selectField('subjectType','Subject type',['migration','checkpoint','deployment','handoff'],record.subjectType||'migration'),textField('subjectId','Subject ID',record.subjectId||'',{required:true}),selectField('decision','Decision',['accepted','changes_requested','rejected'],record.decision||'accepted'),textField('note','Review note',record.note||'',{type:'textarea',required:true,wide:true}),multiField('evidenceSourceIds','Retained evidence sources',sources,record.evidenceSourceIds||[])],
      build:v=>({subjectType:v.subjectType,subjectId:v.subjectId,decision:v.decision,note:v.note,evidenceSourceIds:v.evidenceSourceIds})},
  };
  const spec=specs[name];need(spec,'ACTION_UNKNOWN','Select an original application action.');
  return spec;
}
function formField(field,value) {
  const key='tt-field-'+field.name,attrs=' id="'+h(key)+'" name="'+h(field.name)+'"'+(field.required?' required':'')+(field.readOnly?' readonly':'');
  let control;
  if(field.type==='select')control='<select'+attrs+'>'+options(field.values||[],value,v=>v.title||v.name||v.id,field.allowEmpty)+'</select>';
  else if(field.type==='multi')control='<div class="check-list">'+(field.values||[]).map(v=>'<label><input type="checkbox" name="'+h(field.name)+'" value="'+h(v.id)+'"'+(Array.isArray(value)&&value.includes(v.id)?' checked':'')+'>'+h(v.title||v.name||v.id)+' <span class="small">'+h(v.tenantId||'')+'</span></label>').join('')+'</div>';
  else if(field.type==='textarea'||field.type==='json')control='<textarea'+attrs+(field.type==='json'?' class="mono" spellcheck="false"':'')+'>'+h(field.type==='json'&&typeof value!=='string'?j(value):value)+'</textarea>';
  else if(field.type==='file')control='<input'+attrs.replace(' required','')+' type="file">'+(value instanceof Blob?'<p class="help">Retained original selection: '+h(value.name||'file')+' · '+h(size(value.size))+'</p>':'');
  else control='<input'+attrs+' type="'+h(field.type||'text')+'" value="'+h(value)+'"'+(field.type==='number'?' min="0" step="1"':'')+'>';
  return '<div class="field'+(field.wide?' wide':'')+'"><label for="'+h(key)+'">'+h(field.label)+'</label>'+control+(field.help?'<p class="help">'+h(field.help)+'</p>':'')+'</div>';
}
function formValues(form=S.form) {
  need(form,'FORM_CLOSED','The original action form has closed.');
  const values={};
  for(const field of form.spec.fields) {
    const controls=[...$('#tt-action-form').elements].filter(e=>e.name===field.name);
    if(field.type==='multi')values[field.name]=controls.filter(e=>e.checked).map(e=>e.value);
    else if(field.type==='file')values[field.name]=controls[0]?.files?.[0]||form.retainedFile||null;
    else values[field.name]=controls[0]?.value??'';
  }
  return values;
}
function parsedFormValues(form) {
  const values=formValues(form);
  for(const field of form.spec.fields) {
    if(field.type==='json') {
      try {values[field.name]=JSON.parse(values[field.name]);}
      catch{fail('FORM_JSON_INVALID',field.label+' must contain complete valid JSON.');}
    }
    if(field.required)need(field.type==='multi'?values[field.name]?.length:values[field.name]!==''&&values[field.name]!==null,'FORM_FIELD_REQUIRED',field.label+' is required.');
  }
  return values;
}
async function saveFormDraft(form=S.form) {
  if(!form||form!==S.form)return;
  const values=formValues(form),record={schema:'tjlabs.tiptap-form-draft.v1',name:form.name,recordId:form.record?.id||form.record?.subjectId||'',
    revision:form.capture.revision,values,version:id(),updatedAt:new Date().toISOString()};
  S.drafts[form.key]=record;
  const target=form.capture.scope,full=clone(S.drafts);
  const write=()=>store('drafts:'+target,full);
  S.storageTail=S.storageTail.then(write,write);
  await S.storageTail;
  if(form===S.form)$('#tt-form-draft-status').textContent='Draft retained · revision '+(form.capture.revision??'create')+(S.project&&form.capture.revision!==S.project.revision?' · current '+S.project.revision:'');
  return record;
}
function openForm(name,record={}) {
  requireWrite();closeForm();
  const project=S.project?clone(S.project):null,spec=specFor(name,project,record),key=name+':'+(record.id||record.subjectId||'new');
  const saved=S.drafts[key],values=Object.fromEntries(spec.fields.map(f=>[f.name,f.value??'']));
  if(saved?.schema==='tjlabs.tiptap-form-draft.v1'&&saved.name===name)Object.assign(values,saved.values);
  const form={name,key,record:clone(record),spec,loading:false,generation:++S.formGeneration,
    capture:{projectId:S.project?.id||null,revision:saved?.revision??S.project?.revision,scope:S.scope,nav:S.nav,pane:S.pane},
    retainedFile:values.file instanceof Blob?values.file:null};
  S.form=form;
  $('#tt-form-title').textContent=spec.title;$('#tt-form-eyebrow').textContent=S.project?'Project revision '+(form.capture.revision??S.project.revision):'New project';
  $('#tt-form-description').textContent=spec.description;
  $('#tt-form-fields').innerHTML=spec.fields.map(f=>formField(f,values[f.name])).join('');
  $('#tt-form-error').hidden=true;$('#tt-form-error').textContent='';
  $('#tt-form-submit').textContent=spec.file?'Retain & continue':name==='migration.apply'?'Apply reviewed import':'Save';
  $('#tt-form-draft-status').textContent=saved?'Original draft retained · revision '+saved.revision:'Draft will be retained before dispatch';
  if(S.project&&form.capture.revision!==S.project.revision) {
    $('#tt-form-error').hidden=false;$('#tt-form-error').innerHTML='This draft began at revision '+h(form.capture.revision)+'. Review the current project before rebinding it. '+button('Use reviewed current revision','rebase-form');
  }
  $('#tt-action-dialog').showModal();controls();
}
function closeForm() {
  const form=S.form;
  if(form&&!form.loading)saveFormDraft(form).catch(error=>{if(S.scope===form.capture.scope){S.storageError=error;S.storageLoaded=false;renderPending();controls();}});
  S.form=null;S.formGeneration++;$('#tt-action-dialog').close();
}
async function submitForm(event) {
  event.preventDefault();const form=S.form;if(!form)return;
  requireWrite();
  need(form.capture.scope===S.scope&&form.capture.nav===S.nav,'FORM_VIEW_CHANGED','The original form belongs to another selected project.');
  const before=formValues(form),values=parsedFormValues(form),payload=form.spec.build(values);
  const submittedDraft=await saveFormDraft(form);
  if(form!==S.form||form.capture.nav!==S.nav)fail('FORM_VIEW_CHANGED','The action form changed before its request was prepared.');
  form.loading=true;controls();$('#tt-form-error').hidden=true;
  try {
    if(['document.restore','deployment.stop','deployment.rollback','checkpoint.create'].includes(form.spec.action)&&S.editor)await S.editor.flush();
    const result=await mutate(form.spec.action||form.name,payload,{label:form.spec.title,create:!!form.spec.create,
      upload:form.spec.file?{file:values.file}:null,captured:form.capture});
    await S.storageTail;
    const current=await stored('drafts:'+form.capture.scope)||{};
    // A later edit or another form generation is never cleared by this reply.
    const sameRecord=current[form.key]?.version===submittedDraft.version;
    if(sameRecord){delete current[form.key];await store('drafts:'+form.capture.scope,current);if(S.scope===form.capture.scope)S.drafts=current;}
    if(S.form===form){S.form=null;$('#tt-action-dialog').close();}
    return result;
  } catch(error) {
    if(S.form===form){$('#tt-form-error').hidden=false;$('#tt-form-error').textContent=errorText(error);}
    else report(error);
  } finally {if(S.form===form)form.loading=false;controls();}
}
function sameDraftValues(a,b) {
  const keys=[...new Set([...Object.keys(a||{}),...Object.keys(b||{})])];
  return keys.every(k=>{
    const x=a?.[k],y=b?.[k];
    if(x instanceof Blob||y instanceof Blob)return x instanceof Blob&&y instanceof Blob&&x.size===y.size&&x.type===y.type&&x.name===y.name&&x.lastModified===y.lastModified;
    return JSON.stringify(x)===JSON.stringify(y);
  });
}
function captureMigrationDraft() {
  const form=$('#tt-migration-form');if(!form)return null;
  const migrationId=form.dataset.migration,key='migration:'+migrationId,prior=S.drafts[key]||{_revision:S.project.revision};
  for(const row of [...form.querySelectorAll('[data-row]')]) {
    const value={};
    for(const input of row.querySelectorAll('[name]'))value[input.name]=input.value;
    prior[row.dataset.row]=value;
  }
  if(!Number.isSafeInteger(prior._revision))prior._revision=S.project.revision;
  S.drafts[key]=prior;return {key,value:clone(prior),scope:S.scope,migrationId};
}
async function saveMigrationDraft() {
  const snapshot=captureMigrationDraft();if(!snapshot)return;
  const all=clone(S.drafts),write=()=>store('drafts:'+snapshot.scope,all);
  S.storageTail=S.storageTail.then(write,write);await S.storageTail;
}
async function submitMigration(event) {
  event.preventDefault();requireWrite();
  const snapshot=captureMigrationDraft();need(snapshot,'MIGRATION_NOT_SELECTED','Select the original migration.');
  const migration=clone(requireItem('migrations',snapshot.migrationId));
  const capture={projectId:S.project.id,revision:snapshot.value._revision,scope:S.scope,nav:S.nav,pane:S.pane};
  await saveMigrationDraft();
  need(capture.scope===S.scope&&capture.nav===S.nav&&S.project?.id===capture.projectId,'MIGRATION_VIEW_CHANGED','The original row review changed project while its draft was retained.');
  const rows=(migration.rows||[]).map(row=>({...row,...snapshot.value[row.id]})).filter(row=>['import','skip'].includes(row.decision)).map(row=>({
    rowId:row.id,decision:row.decision,tenantId:row.tenantId,documentName:row.documentName,title:row.title,reason:row.reason||'',
  }));
  need(rows.length,'MIGRATION_REVIEW_EMPTY','Choose import or skip for at least one original row.');
  await mutate('migration.review',{migrationId:migration.id,rows},{label:'Save original row review',captured:capture});
  const saved=await stored('drafts:'+snapshot.scope)||{};
  if(JSON.stringify(saved[snapshot.key])===JSON.stringify(snapshot.value)){delete saved[snapshot.key];await store('drafts:'+snapshot.scope,saved);if(S.scope===snapshot.scope)S.drafts=saved;}
}

async function download(path,fallback,{preview=false,title='Original source'}={}) {
  const generation=++S.detailGeneration,nav=S.nav;
  if(preview){$('#tt-detail-title').textContent=title;$('#tt-detail-kind').textContent='Original bytes';$('#tt-detail-body').textContent='Reading and verifying the selected source…';$('#tt-detail-dialog').showModal();}
  const response=await request(path,{raw:true}),blob=await response.blob(),bytes=await blob.arrayBuffer();
  const wanted=response.headers.get('X-Content-SHA256');
  need(/^[a-f0-9]{64}$/i.test(wanted||''),'DOWNLOAD_HASH_MISSING','The host did not bind this complete download to its original content hash.');
  need(await sha(bytes)===wanted.toLowerCase(),'DOWNLOAD_CHANGED','The received bytes differ from the host’s retained source hash.');
  const declared=response.headers.get('Content-Length');if(declared)need(Number(declared)===blob.size,'DOWNLOAD_INCOMPLETE','The complete original download length differs.');
  const cd=response.headers.get('Content-Disposition')||'';
  let filename=/filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
  if(filename)try{filename=decodeURIComponent(filename);}catch{filename=null;}
  filename=filename||/filename="([^"]+)"/i.exec(cd)?.[1]||fallback||'retained-source.bin';
  filename=filename.replace(/[\\/\u0000-\u001f\u007f]/g,'_');
  if(preview) {
    if(generation!==S.detailGeneration||nav!==S.nav)return;
    const media=response.headers.get('Content-Type')||'application/octet-stream';
    const textLike=/^(text\/|application\/(?:json|xml|yaml|javascript))/i.test(media)||/\.(?:json|html?|xml|md|ya?ml|txt|mjs|js|css)$/i.test(filename);
    $('#tt-detail-body').innerHTML='<div class="record-meta"><span>'+h(filename)+'</span><span>'+h(size(blob.size))+'</span><code>'+h(wanted)+'</code></div><p class="help">'+(textLike?'Original source is shown as text.':'This retained source is binary; download it with its original hash.')+'</p><pre></pre><div class="actions"></div>';
    const limit=512*1024;
    $('#tt-detail-body pre').textContent=textLike?new TextDecoder('utf-8',{fatal:false}).decode(bytes.slice(0,limit))+(bytes.byteLength>limit?'\n\n[Source display ends at 512 KiB. The download contains all '+bytes.byteLength+' original bytes.]':''):j({filename,mediaType:media,bytes:blob.size,sha256:wanted});
    const save=document.createElement('button');save.type='button';save.textContent='Download complete original';save.addEventListener('click',()=>saveBlob(blob,filename));$('#tt-detail-body .actions').append(save);
  } else {saveBlob(blob,filename);$('#tt-download-status').textContent='Verified and downloaded '+filename+', '+blob.size+' bytes.';}
  return {filename,bytes:blob.size,sha256:wanted};
}
function saveBlob(blob,filename) {
  need(!applicationClosing&&!applicationClosed,'APPLICATION_CLOSING','The original application is closing.');
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  const timer=setTimeout(()=>{URL.revokeObjectURL(url);objectURLs.delete(url);},60000);objectURLs.set(url,timer);
  try {a.href=url;a.download=filename;a.rel='noopener';a.style.display='none';document.body.append(a);a.click();}finally{a.remove();}
}
function sourceUrl(sourceId) {return '/api/projects/'+encodeURIComponent(S.project.id)+'/sources/'+encodeURIComponent(sourceId)+'/content?revision='+S.project.revision;}
function selectedRecord(value) {const split=value.indexOf(':');need(split>0,'RECORD_INVALID','Select the original record.');return {collection:value.slice(0,split),id:value.slice(split+1)};}
function inspectRecord(value) {
  const selected=selectedRecord(value),record=requireItem(selected.collection,selected.id);
  jsonDetail(record.title||record.name||record.id,record,selected.collection);
  if(selected.collection==='jobs') {
    const files=Array.isArray(record.files)?record.files:Array.isArray(record.artifacts)?record.artifacts:[];
    const wrap=document.createElement('div');wrap.className='file-grid';
    for(const file of files)if(file?.id) {
      const row=document.createElement('div');row.className='file-row';const label=document.createElement('span');label.textContent=file.filename||file.path||file.id;
      const b=document.createElement('button');b.className='secondary small-button';b.textContent='Download';b.type='button';
      const projectId=S.project.id,jobId=record.id,fileId=file.id;
      b.addEventListener('click',()=>download('/api/projects/'+encodeURIComponent(projectId)+'/jobs/'+encodeURIComponent(jobId)+'/files/'+encodeURIComponent(fileId),file.filename||fileId).catch(report));
      row.append(label,b);wrap.append(row);
    }
    $('#tt-detail-body').append(wrap);
  }
}
async function openDocument(documentId) {
  need(!applicationClosing&&!applicationClosed,'APPLICATION_CLOSING','The original application is closing.');
  need(S.project&&!S.project.historical,'HISTORICAL_DOCUMENT','Open the current project to authorize a live document session.');
  const documentRecord=clone(requireItem('documents',documentId)),projectId=S.project.id,actor=clone(S.session.actor),instanceId=S.session.instanceId;
  need(['read','write'].includes(documentRecord.access),'DOCUMENT_GRANT_REQUIRED','This host actor needs an explicit grant for the selected document.');
  const serial=++S.editorSerial,previous=editorTransition;
  let release;
  editorTransition=new Promise(resolve=>{release=resolve;});
  const isCurrent=()=>!applicationClosing&&serial===S.editorSerial&&S.session?.actor.id===actor.id&&S.session.instanceId===instanceId
    &&S.project?.id===projectId&&!S.project.historical&&item('documents',documentId)?.epochId===documentRecord.epochId;
  const originalPath='/api/projects/'+encodeURIComponent(projectId)+'/documents/'+encodeURIComponent(documentId);
  try {
    // Preserve admission identity while the earlier original editor transition drains.
    await previous;
    if(!isCurrent())return;
    await closeEditor();
    if(!isCurrent())return;
    $('#tt-editor-section').hidden=false;$('#tt-editor').textContent='';
    $('#tt-editor-title').textContent=documentRecord.title||documentRecord.logicalKey||documentId;
    $('#tt-editor-tenant').textContent=documentRecord.tenantId;
    $('#tt-editor-identity').textContent=documentId+' · epoch '+documentRecord.epochId;
    $('#tt-editor-alert').hidden=true;
    const editor=await createCollaborativeEditor({
      element:$('#tt-editor'),instanceId,actor,projectId,document:documentRecord,isCurrent,
      requestSession:()=>{need(isCurrent(),'EDITOR_SELECTION_CHANGED','The selected document or actor changed.');return request(originalPath+'/session',{method:'POST',body:{}});},
      readPersistence:()=>{need(S.session?.actor.id===actor.id&&S.session.instanceId===instanceId,'EDITOR_ACTOR_CHANGED','Sign in as the original editor before reconciling its document.');return request(originalPath+'/persistence');},
      onState:value=>{if(serial===S.editorSerial){S.editorState=value;renderEditorState();}},
      onEpochChange:value=>{if(serial===S.editorSerial){$('#tt-editor-alert').hidden=false;$('#tt-editor-alert').textContent=value.reason+' The old native state remains available to download. Open the current document explicitly after reviewing it.';}},
    });
    // Every acquired owner is retained before any selection or presentation check.
    editorOwners.add(editor);
    if(!isCurrent()){await closeEditorOwner(editor);return;}
    S.editor=editor;renderEditorState();$('#tt-editor-section').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(error) {
    if(error.editorOwner){editorOwners.add(error.editorOwner);if(isCurrent())S.editor=error.editorOwner;}
    if(serial===S.editorSerial){$('#tt-editor-alert').hidden=false;$('#tt-editor-alert').textContent=errorText(error);$('#tt-editor-network').textContent='Editor not connected';}
    throw error;
  } finally {release();}
}
function renderEditorState() {
  const value=S.editorState;if(!value)return;
  $('#tt-editor-network').textContent=value.network+(value.identity.access==='read'?' · read only':'');
  $('#tt-editor-network').dataset.state=value.network==='connected'?'ready':value.retired?'failed':'';
  $('#tt-editor-local').textContent=value.localPersisted?'Original local state retained':value.localReady?'Retaining local changes':'Loading original local state';
  $('#tt-editor-local').dataset.state=value.localPersisted?'saved':'';
  $('#tt-editor-saved').textContent=value.retired?'Earlier epoch retained':value.saved?'Saved on host':value.localPersisted?'Local state retained · host save pending':'Local save pending';
  $('#tt-editor-saved').dataset.saved=String(!!value.saved);
  $('#tt-editor-save-detail').textContent=value.persisted?'Last host receipt '+time(value.persisted.savedAt)+' · '+value.persisted.bytes+' bytes · '+value.persisted.sha256:'No complete host persistence receipt has matched this editor state yet.';
  $('#tt-editor-words').textContent=value.words+' words · '+value.characters+' characters';
  $('#tt-editor-peers').innerHTML=(value.peers||[]).map(peer=>'<span class="peer">'+h(peer.name)+'</span>').join('');
  $('#tt-editor-network-toggle').textContent=value.offline?'Reconnect original document':'Work offline';
  $('#tt-editor-network-toggle').disabled=value.retired;
  $('#tt-editor-check').disabled=value.retired;
  if(value.error){$('#tt-editor-alert').hidden=false;$('#tt-editor-alert').textContent=value.error.message;}
  else if(!value.retired){$('#tt-editor-alert').hidden=true;$('#tt-editor-alert').textContent='';}
  $$('#tt-editor-toolbar [data-format]').forEach(button=>{
    const format=S.editor?.formatState(button.dataset.format)||{enabled:false,active:false};
    button.disabled=!format.enabled;button.setAttribute('aria-pressed',String(format.active));
  });
}
function syncEditorIdentity() {
  if(!S.editor||S.editor.identity.projectId!==S.project?.id)return;
  const current=item('documents',S.editor.identity.documentId);
  if(!current||current.epochId!==S.editor.identity.epochId||current.documentName!==S.editor.identity.documentName)
    S.editor.retire('The current project now selects a different physical document epoch.',current||null);
}
async function exportEditorState() {
  need(S.editor,'EDITOR_NOT_OPEN','Open an original document first.');
  const editor=S.editor,output=await editor.exportState();
  jsonDetail('Retained editor state',output.manifest,'Original Yjs binary');
  const wrap=document.createElement('div');wrap.className='actions';
  const binary=document.createElement('button');binary.textContent='Download native .yjs';binary.type='button';binary.addEventListener('click',()=>saveBlob(new Blob([output.bytes],{type:'application/octet-stream'}),output.filename));
  const manifest=document.createElement('button');manifest.textContent='Download state identity';manifest.type='button';manifest.className='secondary';manifest.addEventListener('click',()=>saveBlob(new Blob([j(output.manifest)+'\n'],{type:'application/json'}),output.filename+'.json'));
  wrap.append(binary,manifest);$('#tt-detail-body').append(wrap);
}
async function authenticate(form) {
  need(!S.busy,'ACTION_IN_PROGRESS','Reconcile the current host operation before changing actors.');
  const input=form.elements.token,token=input.value.trim();need(token,'AUTH_REQUIRED','Enter this host’s access token.');
  input.value='';S.token=token;const current=++S.nav;
  try {
    const session=await request('/api/session');
    if(current!==S.nav)return;
    need(session.instanceId&&session.actor?.id&&session.permissions?.read,'SESSION_INVALID','The host did not return a readable actor session.');
    S.session=session;
    await refreshProjects();if(current!==S.nav)return;
    const route=routeValue();
    if(route.project)await openProject(route.project,Number.isSafeInteger(route.revision)?route.revision:null,{pane:route.pane});
    else {
      S.project=null;S.pane=route.pane;await loadStorage(null,current);if(current!==S.nav)return;
      renderIdentity();render();setRoute({project:null});
    }
    notice('',{});controls();
  } catch(error){if(current===S.nav){S.token='';S.session=null;report(error);}throw error;}
}
const SIGN_IN_MARKUP=$('#tt-main').innerHTML;
async function signOut() {
  need(!S.busy,'ACTION_IN_PROGRESS','The original upload or mutation is still being reconciled. Its request will remain available after a reload.');
  await closeEditor();
  if(S.form)await saveFormDraft(S.form);
  clearTimeout(S.poll);S.nav++;S.editorSerial++;S.detailGeneration++;
  $('#tt-action-dialog').close();$('#tt-detail-dialog').close();
  S.token='';S.session=null;S.project=null;S.projects=[];S.pending=null;S.scope=null;S.storageLoaded=false;S.storageError=null;S.drafts={};S.form=null;
  $('#tt-main').innerHTML=SIGN_IN_MARKUP;$('#tt-pending').hidden=true;$('#tt-editor-section').hidden=true;
  $('#tt-identity').innerHTML='<span class="eyebrow">Collaborative application migration</span><strong>Open your project</strong>';
  $('#tt-project-select').innerHTML='<option value="">Select a project</option>';$('#tt-revision').innerHTML='<option value="">Current view</option>';
  renderIdentity();controls();notice('The host token is cleared. Original requests, drafts, and epoch-scoped local document data remain under their existing actor bindings.');
}
async function action(name,key) {
  if(name==='form'){openForm(key);return;}
  if(name==='pane'){const nav=S.nav;await saveMigrationDraft();if(nav!==S.nav)return;S.pane=key;setRoute();render();return;}
  if(name==='open-project')return openProject(key,null);
  if(name==='current-project')return openProject(S.project.id,null);
  if(name==='open-revision')return openProject(S.project.id,Number(key));
  if(name==='retry-storage')return loadStorage(S.project?.id,S.nav).then(()=>render());
  if(name==='retry-pending'){need(S.pending,'REQUEST_NOT_PENDING','There is no original pending request.');return sendPending(S.pending);}
  if(name==='recover-pending')return recoverPending();
  if(name==='inspect-pending') {
    const p=clone(S.pending);if(p?.upload)delete p.upload.file;return jsonDetail('Original retained request',p,'HTTP recovery');
  }
  if(name==='close-rejected') {
    need(S.pending?.state==='rejected'&&!S.busy,'REQUEST_OUTCOME_UNKNOWN','Only an observed rejected request can be closed here. An uncertain request keeps its original ID.');
    const p=S.pending;await store('last-rejected:'+p.scope,{...p,upload:p.upload?{...p.upload,file:undefined}:undefined});const removed=await removePending(p);
    if(S.scope===p.scope){if(removed)S.pending=null;else await loadStorage(S.project?.id,S.nav);renderPending();controls();}return;
  }
  if(name==='inspect-record')return inspectRecord(key);
  if(name==='inspect-runtime')return jsonDetail('Receiving host runtime',S.project?.runtime||S.session.runtime,'Original selected runtime');
  if(name==='inspect-event')return jsonDetail('Original project event',requireItem('history',key),'Project history');
  if(name==='download-source')return download(sourceUrl(key),requireItem('sources',key).filename||key);
  if(name==='read-source')return download(sourceUrl(key),requireItem('sources',key).filename||key,{preview:true,title:requireItem('sources',key).title||'Original source'});
  if(name==='download-handoff')return download('/api/projects/'+encodeURIComponent(S.project.id)+'/handoffs/'+encodeURIComponent(key)+'/download',requireItem('handoffs',key).filename||key+'.ndjson.gz');
  if(name==='download-checkpoint')return download('/api/projects/'+encodeURIComponent(S.project.id)+'/checkpoints/'+encodeURIComponent(key)+'/download',key+'.ndjson.gz');
  if(name==='open-document')return openDocument(key);
  if(name==='select-migration'){await saveMigrationDraft();S.selectedMigration=key;S.migrationOffset=0;render();return;}
  if(name==='migration-page'){await saveMigrationDraft();S.migrationOffset=Number(key);render();return;}
  if(name==='rebase-form') {
    const form=S.form;need(form&&form.capture.scope===S.scope&&!S.pending,'FORM_NOT_CURRENT','Open the same original draft without an unresolved request first.');
    form.capture.revision=S.project?.revision;await saveFormDraft(form);$('#tt-form-error').hidden=true;$('#tt-form-eyebrow').textContent='Project revision '+S.project.revision;return;
  }
  if(name==='rebase-migration') {
    requireWrite();const snapshot=captureMigrationDraft();need(snapshot,'MIGRATION_NOT_SELECTED','Open the original row review.');
    S.drafts[snapshot.key]._revision=S.project.revision;await saveMigrationDraft();render();return;
  }
  const bindings={
    'edit-tenant':['tenant.save','tenants'],'edit-grant':['grant.save','grants'],'edit-edition':['edition.save','editions'],
    'freeze-edition':['edition.freeze','editions'],'apply-migration':['migration.apply','migrations'],
    'start-deployment':['deployment.start','deployments'],'stop-deployment':['deployment.stop','deployments'],
    'rollback-deployment':['deployment.rollback','deployments'],'cancel-job':['job.cancel','jobs'],'resume-job':['job.resume','jobs'],
    'restore-checkpoint':['document.restore','checkpoints'],
  };
  if(bindings[name]){const [form,collection]=bindings[name];openForm(form,requireItem(collection,key));return;}
  const reviews={'review-checkpoint':'checkpoint','review-handoff':'handoff','review-migration':'migration','review-deployment':'deployment'};
  if(reviews[name]){openForm('review.save',{subjectType:reviews[name],subjectId:key});return;}
  fail('ACTION_UNKNOWN','Select an original workspace control.');
}
for(const type of ['click','submit','input','change','cancel'])document.addEventListener(type,event=>{
  if(applicationClosing||applicationClosed){event.preventDefault();event.stopImmediatePropagation();}
},true);
document.addEventListener('click',event=>{
  const close=event.target.closest('[data-close-dialog]');if(close){closeForm();return;}
  if(event.target.closest('[data-close-detail]')){S.detailGeneration++;$('#tt-detail-dialog').close();return;}
  const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
  event.preventDefault();Promise.resolve(action(target.dataset.action,target.dataset.id||'')).catch(report);
});
document.addEventListener('submit',event=>{
  if(event.target.id==='tt-auth-form'){event.preventDefault();authenticate(event.target).catch(report);}
  else if(event.target.id==='tt-action-form')submitForm(event).catch(report);
  else if(event.target.id==='tt-migration-form')submitMigration(event).catch(report);
});
let draftTimer=null;
document.addEventListener('input',event=>{
  if($('#tt-action-form').contains(event.target)&&S.form) {
    clearTimeout(draftTimer);
    // Clone immediately into the originating form; an in-flight action keeps
    // its separate immutable request body.
    const form=S.form;form.retainedFile=formValues(form).file||form.retainedFile;
    draftTimer=setTimeout(()=>saveFormDraft(form).catch(error=>{if(S.scope===form.capture.scope){S.storageError=error;S.storageLoaded=false;renderPending();controls();}}),150);
  } else if($('#tt-migration-form')?.contains(event.target)) {
    captureMigrationDraft();clearTimeout(draftTimer);
    draftTimer=setTimeout(()=>saveMigrationDraft().catch(error=>{S.storageError=error;S.storageLoaded=false;renderPending();controls();}),150);
  }
});
$('#tt-project-select').addEventListener('change',event=>{if(event.target.value)openProject(event.target.value,null).catch(report);});
$('#tt-create-project').addEventListener('click',()=>{try{openForm('project.create');}catch(error){report(error);}});
$('#tt-refresh').addEventListener('click',()=>{const work=S.project?openProject(S.project.id,S.project.historical?S.project.revision:null):refreshProjects().then(render);work.catch(report);});
$('#tt-revision').addEventListener('change',event=>openProject(S.project.id,event.target.value?Number(event.target.value):null).catch(report));
$('#tt-signout').addEventListener('click',()=>signOut().catch(report));
$('#tt-action-dialog').addEventListener('cancel',event=>{event.preventDefault();closeForm();});
$('#tt-detail-dialog').addEventListener('cancel',()=>{S.detailGeneration++;});
$('#tt-close-editor').addEventListener('click',()=>closeEditor().catch(report));
$('#tt-editor-check').addEventListener('click',()=>S.editor?.flush().catch(report));
$('#tt-editor-download').addEventListener('click',()=>exportEditorState().catch(report));
$('#tt-editor-network-toggle').addEventListener('click',()=>S.editor?.setOffline(!S.editorState?.offline).catch(report));
$('#tt-editor-toolbar').addEventListener('click',event=>{const button=event.target.closest('[data-format]');if(button&&!button.disabled)S.editor?.format(button.dataset.format);renderEditorState();});
window.addEventListener('hashchange',()=>trackWork(async()=>{
  const route=routeValue();if(applicationClosing||applicationClosed||!S.session)return;
  if(route.project&&route.project!==S.project?.id||route.revision!==(S.project?.historical?S.project.revision:null)) {
    if(route.project)openProject(route.project,Number.isSafeInteger(route.revision)?route.revision:null,{pane:route.pane}).catch(report);
  } else {const nav=S.nav;try{await saveMigrationDraft();if(nav!==S.nav)return;S.pane=route.pane;closeForm();render();}catch(error){report(error);}}
}).catch(report));
window.addEventListener('pagehide',()=>{if(applicationClosing||applicationClosed)return;S.editor?.suspend();if(S.form)saveFormDraft(S.form).catch(()=>{});});
window.addEventListener('pageshow',event=>{if(!applicationClosing&&!applicationClosed&&event.persisted&&S.editor)S.editor.resume().catch(report);});
window.addEventListener('beforeunload',event=>{
  if(!applicationClosing&&!applicationClosed&&(S.busy||S.pending||S.editorState&&!S.editorState.localPersisted)){event.preventDefault();event.returnValue='';}
});
async function closeApplication() {
  if(applicationClosed)return {state:'CLOSED'};
  if(applicationClose)return applicationClose;
  applicationClosing=true;clearTimeout(S.poll);clearTimeout(draftTimer);controls();
  const attempt=(async()=>{
    let first;
    // Existing dispatches retain their original input/result; new UI admission
    // is already frozen. The editor stops its independent socket/read timers.
    try {await closeEditor();}catch(error){first ||= error;}
    while(ownedWork.size)await Promise.allSettled([...ownedWork]);
    // An editor acquired during the preceding admission drain is still ours.
    try {await closeEditor();}catch(error){first ||= error;}
    try {if(S.form)await saveFormDraft(S.form);await saveMigrationDraft();await S.storageTail;}
    catch(error){first ||= error;}
    // A received native result remains ours until its exact original request is
    // durable. Failed storage keeps this same application available to retry.
    for(const known of [...knownCommitted.values()]) {
      if(!known.finished&&!known.resultDurable) {
        try {await persistPending(known);}catch(error){first ||= error;}
      }
    }
    while(ownedWork.size)await Promise.allSettled([...ownedWork]);
    if(first)throw first;
    while(databaseOpenings.size)await Promise.all([...databaseOpenings]);
    for(const handle of [...databaseHandles]){handle.close();databaseHandles.delete(handle);}
    database=null;
    for(const [url,timer] of objectURLs){clearTimeout(timer);URL.revokeObjectURL(url);objectURLs.delete(url);}
    $('#tt-action-dialog').close();$('#tt-detail-dialog').close();
    S.token='';applicationClosed=true;
    return {state:'CLOSED'};
  })();
  applicationClose=attempt;
  try{return await attempt;}finally{if(applicationClose===attempt)applicationClose=null;}
}
// Track complete original operations, including response bodies, transaction
// terminals, hashing, drafts and callbacks after an HTTP response has arrived.
for(const bind of [
  [()=>sha,value=>sha=value],[()=>request,value=>request=value],[()=>stored,value=>stored=value],
  [()=>store,value=>store=value],[()=>remove,value=>remove=value],[()=>loadStorage,value=>loadStorage=value],
  [()=>persistPending,value=>persistPending=value],[()=>removePending,value=>removePending=value],
  [()=>finishCommitted,value=>finishCommitted=value],[()=>uploadExact,value=>uploadExact=value],
  [()=>recoverPending,value=>recoverPending=value],[()=>sendPending,value=>sendPending=value],[()=>mutate,value=>mutate=value],
  [()=>refreshProjects,value=>refreshProjects=value],[()=>closeEditor,value=>closeEditor=value],
  [()=>openProject,value=>openProject=value],[()=>saveFormDraft,value=>saveFormDraft=value],
  [()=>submitForm,value=>submitForm=value],[()=>saveMigrationDraft,value=>saveMigrationDraft=value],
  [()=>submitMigration,value=>submitMigration=value],[()=>download,value=>download=value],
  [()=>openDocument,value=>openDocument=value],[()=>exportEditorState,value=>exportEditorState=value],
  [()=>authenticate,value=>authenticate=value],[()=>signOut,value=>signOut=value],[()=>action,value=>action=value],
]){const original=bind[0]();bind[1]((...args)=>trackWork(()=>original(...args)));}
window.migrationWorkspace=Object.freeze({
  close:closeApplication,
  inspect:()=>({state:applicationClosed?'CLOSED':applicationClosing?'CLOSING':'OPEN',instanceId:S.session?.instanceId||null,actorId:S.session?.actor.id||null,projectId:S.project?.id||null,
    revision:S.project?.revision??null,currentRevision:S.project?.currentRevision??null,historical:!!S.project?.historical,pane:S.pane,
    pending:S.pending?{requestId:S.pending.requestId,path:S.pending.path,bodyText:S.pending.bodyText,state:S.pending.state,expectedRevision:S.pending.expectedRevision}:null,
    storageLoaded:S.storageLoaded,storageError:S.storageError?errorText(S.storageError):null,
    lastOutcome:S.lastOutcome?{requestId:S.lastOutcome.requestId,response:clone(S.lastOutcome.response)}:null,
    editor:S.editor?.inspect()||S.editorState,
  }),
  async flushEditor(){need(!applicationClosing&&!applicationClosed,'APPLICATION_CLOSING','The original application is closing.');need(S.editor,'EDITOR_NOT_OPEN','Open a current document first.');const value=await S.editor.flush();return {saved:!!value?.saved,identity:S.editor.identity,persisted:value?.persisted||null};},
});
controls();
