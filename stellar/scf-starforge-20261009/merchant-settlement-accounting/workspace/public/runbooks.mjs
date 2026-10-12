const ROOT = '/api/runbooks';
const PHASE = {DRAFT:'Preparation',IN_REVIEW:'In review',CHANGES_REQUESTED:'Changes requested',APPROVED:'Approved'};
const STATUS = {PENDING:'Pending',COMPLETE:'Complete',NOT_APPLICABLE:'Not applicable',BLOCKED:'Blocked'};
const KINDS = {book:'edition_saved',file:'file_retained',cycle:'cycle_created',work:'procedure_saved',submit:'preparation_submitted',review:'review_saved',receive:'packet_received'};
const FILE_LIMIT = 8 * 1024 * 1024, PACKET_LIMIT = 64 * 1024 * 1024;
const S = {workspaceId:null,data:null,sources:null,view:'overview',book:null,bookId:null,editionId:null,cycle:null,cycleId:null,stepId:null,author:null,schedule:null,workDrafts:new Map(),pending:null,busy:false,connected:false,storageError:null,epoch:0,readGeneration:0,actor:'',writes:Promise.resolve(),scheduleBook:null};
const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const uid = () => crypto.randomUUID();
const slug = prefix => prefix + '-' + uid().replaceAll('-','').slice(0,16);
const short = value => !value ? '—' : String(value).length > 22 ? String(value).slice(0,10) + '…' + String(value).slice(-6) : String(value);
const bytes = value => !Number.isFinite(Number(value)) ? '—' : Number(value) < 1024 ? value + ' B' : Number(value) < 1048576 ? (Number(value)/1024).toFixed(1) + ' KiB' : (Number(value)/1048576).toFixed(1) + ' MiB';
const when = value => { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString(); };
const prefix = () => 'workspace/' + S.workspaceId + '/';
const key = tail => prefix() + tail;
function el(tagName, attributes = {}, ...children) {
  const node = document.createElement(tagName);
  for (const [name,value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'className') node.className = value;
    else if (name === 'text') node.textContent = value;
    else if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2),value);
    else if (['value','checked','disabled','hidden','required','open','multiple'].includes(name)) node[name] = value;
    else node.setAttribute(name,value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function put(target,...children) { const node = typeof target === 'string' ? $(target) : target; node.replaceChildren(...children.flat().filter(value => value !== null && value !== undefined)); return node; }
const empty = text => el('p',{className:'empty'},text);
const prose = text => el('p',{className:'prose'},text || '—');
const tag = (text,strong = false) => el('span',{className:'tag' + (strong ? ' strong' : '')},text);
const act = fn => event => { event?.preventDefault(); Promise.resolve().then(() => fn(event)).catch(showError); };
function button(text,fn,options = {}) {
  const node = el('button',{type:'button',className:options.primary?'primary':options.quiet?'quiet':'',disabled:options.disabled,title:options.title,onclick:act(fn)},text);
  if (options.disabled) node.dataset.permanentDisabled = 'true';
  if (options.mutation) node.dataset.mutation = 'true';
  return node;
}
function safeHref(value) {
  try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function link(text,url,{download=false,external=false} = {}) {
  const node = el('a',{href:url,className:download?'download':''},text);
  if (download) node.setAttribute('download','');
  if (external) { node.target='_blank'; node.rel='noopener noreferrer'; }
  return node;
}
function field(label,control,{full=false,hint} = {}) { return el('label',{className:full?'full':''},label,control,hint?el('span',{className:'small muted'},hint):null); }
function input(value,props={}) { return el('input',{value:value??'',...props}); }
function area(value,props={}) { return el('textarea',{rows:4,...props},value??''); }
function select(options,value,props={}) {
  const node=el('select',props);
  for (const option of options) node.append(el('option',{value:option.value,disabled:option.disabled},option.label));
  node.value=value??''; return node;
}
function facts(items) { return el('dl',{className:'facts'},items.filter(([,value])=>value!==undefined&&value!==null&&value!=='').map(([label,value])=>el('div',{},el('dt',{},label),el('dd',{},value instanceof Node?value:String(value))))); }
function notice(message,error=false) { $('notice').hidden=!message; $('notice').className='notice'+(error?' error':''); $('notice').textContent=message||''; }
function showError(error) { notice(error?.message||String(error),true); }
function setBusy(value,label='Saving…') { S.busy=value; $('busy-status').hidden=!value; $('busy-status').textContent=label; paintLocks(); }
function paintLocks() {
  const locked=S.busy||!!S.pending||!S.connected||!!S.storageError;
  for (const form of document.querySelectorAll('#author-form,#schedule-form,#receive-form,.mutation-form')) {
    for (const control of form.querySelectorAll('input,select,textarea,button')) control.disabled=locked||form.dataset.readonly==='true'||control.dataset.permanentDisabled==='true';
  }
  for (const control of document.querySelectorAll('[data-mutation],#new-runbook,#new-cycle,#overview-new-cycle')) control.disabled=locked||control.dataset.permanentDisabled==='true';
  for(const control of document.querySelectorAll('#recovery button'))control.disabled=S.busy||control.dataset.permanentDisabled==='true';
  $('refresh').disabled=S.busy;
  $('operator-name').disabled=S.busy||!!S.pending||!S.connected;
}
let dbPromise;
function openDb() {
  if (!dbPromise) dbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open('stellar-forge-accounting-runbooks',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('kv',{keyPath:'key'});
    request.onsuccess=()=>{ const db=request.result; db.onversionchange=()=>db.close(); resolve(db); };
    request.onerror=()=>reject(request.error||new Error('Private draft storage could not be opened.'));
    request.onblocked=()=>reject(new Error('Close the older runbook tab so private draft storage can open.'));
  });
  return dbPromise;
}
async function readMany(keys) {
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('kv','readonly'), output=new Map();
    for (const name of keys) { const req=tx.objectStore('kv').get(name); req.onsuccess=()=>output.set(name,req.result?.value); }
    tx.oncomplete=()=>resolve(output); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error||new Error('Draft read was interrupted.'));
  });
}
async function readKey(name) { return (await readMany([name])).get(name); }
async function savedEntries(start) {
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('kv','readonly'), request=tx.objectStore('kv').getAll(IDBKeyRange.bound(start,start+'\uffff'));
    request.onsuccess=()=>resolve(request.result.map(item=>[item.key,item.value])); request.onerror=()=>reject(request.error);
  });
}
async function writeBatch(items=[],remove=[]) {
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('kv','readwrite'), store=tx.objectStore('kv');
    for (const [name,value] of items) store.put({key:name,value});
    for (const name of remove) store.delete(name);
    tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error||new Error('Private draft save was interrupted.'));
  });
}
function persist(name,value) {
  const snapshot=clone(value);
  $('draft-status').textContent='Saving private draft…';
  const task=S.writes.then(()=>writeBatch([[name,snapshot]]));
  S.writes=task.catch(error=>{ S.storageError=error; $('draft-status').textContent='Private draft storage needs attention.'; paintLocks(); showError(new Error('Draft storage could not save this edit: '+error.message)); });
  task.then(() => { if (!S.storageError) $('draft-status').textContent='Draft saved in this browser · '+new Date().toLocaleTimeString(); }).catch(()=>{});
  return task;
}
async function flush() { await S.writes; if (S.storageError) throw new Error('Private draft storage could not save the latest edit. Keep this tab open and restore storage before continuing.'); }
async function reservePending(pending) {
  await flush();
  const db=await openDb(), name=key('pending');
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('kv','readwrite'), store=tx.objectStore('kv'), read=store.get(name); let collision=false;
    read.onsuccess=()=>{ if (read.result) { collision=true; tx.abort(); } else store.put({key:name,value:pending}); };
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(collision?Object.assign(new Error('Another runbook save is already retained. Check its result before starting another save.'),{code:'PENDING_OPERATION'}):tx.error);
  });
}
function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value&&typeof value==='object') return '{'+Object.keys(value).sort().map(name=>JSON.stringify(name)+':'+canonical(value[name])).join(',')+'}';
  return JSON.stringify(value);
}
async function sha256(value) {
  const buffer=typeof value==='string'?new TextEncoder().encode(value):value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function api(path,{body,signal}={}) {
  let response;
  try { response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json','x-workspace-request':'1'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'same-origin',signal}); }
  catch(error) { if(error.name==='AbortError')throw error; throw Object.assign(new Error('The accounting workspace did not answer. Any pending save remains available for exact recovery.'),{code:'CONNECTION_LOST',cause:error}); }
  let value;
  try { value=await response.json(); } catch { throw Object.assign(new Error('The accounting workspace returned an unreadable response. Check the saved operation before retrying.'),{code:'RESPONSE_UNREADABLE',status:response.status}); }
  if (!response.ok) { const source=value.error||{}; throw Object.assign(new Error(source.message||'The accounting request could not finish.'),{code:source.code||'REQUEST_FAILED',status:response.status,applied:source.applied,details:source}); }
  return value;
}
function sameWorkspace(value) {
  if (!value||value.workspaceId!==S.workspaceId) throw Object.assign(new Error('This local address now serves a different accounting workspace. Refresh to reopen that workspace; the earlier drafts and saves stay separately retained.'),{code:'RUNBOOK_WORKSPACE_CHANGED'});
  return value;
}
function recordedBy() {
  const value=$('operator-name').value.trim();
  if (!value) { $('operator-name').focus(); throw new Error('Enter the name to record with this work.'); }
  return value;
}
async function readFile(file,limit) {
  if (!file) throw new Error('Choose the original file first.');
  if (file.size<1||file.size>limit) throw new Error('Choose a non-empty file up to '+bytes(limit)+'.');
  const data=new Uint8Array(await file.arrayBuffer()), chunks=[];
  for (let offset=0,index=0;offset<data.length;offset+=24576,index++) {
    chunks.push(btoa(String.fromCharCode(...data.subarray(offset,Math.min(data.length,offset+24576)))));
    if (index&&index%64===0) await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  return {name:file.name,type:file.type||'application/octet-stream',content:chunks.join(''),bytes:data.length};
}
function rememberView() {
  if (S.workspaceId) persist(key('view'),{view:S.view,bookId:S.bookId,editionId:S.editionId,cycleId:S.cycleId,stepId:S.stepId}).catch(()=>{});
}
function showView(name,{remember=true}={}) {
  S.view=name;
  for (const section of document.querySelectorAll('[data-view]')) section.hidden=section.dataset.view!==name;
  for (const nav of document.querySelectorAll('[data-go]')) { if(nav.dataset.go===name)nav.setAttribute('aria-current','page');else nav.removeAttribute('aria-current'); }
  if (remember) rememberView();
  renderNav(); paintLocks();
}
async function go(name) { await flush(); if(name==='author')return resumeAuthor();if(name==='schedule')return resumeSchedule();showView(name); }
function clearSelection() {
  S.epoch++;S.book=null;S.bookId=null;S.editionId=null;S.cycle=null;S.cycleId=null;S.stepId=null;S.author=null;S.schedule=null;S.sources=null;S.scheduleBook=null;S.workDrafts.clear();S.pending=null;
  put('book-detail',empty('Choose a runbook.'));put('cycle-detail',empty('Choose a period.'));put('author-resources');put('author-steps');
  for(const id of ['author-name','author-client','author-description','schedule-label','schedule-due','schedule-preparer','schedule-reviewer','receive-file'])$(id).value='';
  for(const id of ['author-reference','schedule-context','schedule-source-summary','receive-selection'])put(id);
  for(const id of ['schedule-book','schedule-edition','schedule-handoff','schedule-accountant-revision','schedule-close'])put(id,el('option',{value:''},'Choose a current workspace source'));
}
async function refreshRoot({restore=false}={}) {
  const generation=++S.readGeneration, value=await api(ROOT);
  if(generation!==S.readGeneration)return null;
  if(typeof value.workspaceId!=='string'||!value.workspaceId)throw new Error('The runbook service did not identify its accounting workspace.');
  const changed=S.workspaceId!==value.workspaceId;
  if(changed){clearSelection();S.workspaceId=value.workspaceId;}
  S.data=value;S.connected=true;
  $('workspace-id').textContent=short(value.workspaceId);$('workspace-id').title=value.workspaceId;$('revision').textContent=' · revision '+short(value.revision);
  if(restore||changed){
    const stored=await readMany([key('actor'),key('pending'),key('view')]);
    S.actor=stored.get(key('actor'))||'';$('operator-name').value=S.actor;S.pending=stored.get(key('pending'))||null;
    S.restoredView=stored.get(key('view'));
  }
  renderNav();renderOverview();renderRecovery();paintLocks();
  return {value,changed};
}
async function refreshCurrent() {
  await flush();setBusy(true,'Refreshing workspace…');
  try {
    const oldWorkspace=S.workspaceId, result=await refreshRoot();
    if(!result)return;
    if(oldWorkspace!==S.workspaceId){showView('overview');notice('Opened the current accounting workspace. Earlier workspace drafts remain separately retained.');return;}
    if(S.view==='book'&&S.bookId)await openBook(S.bookId,S.editionId);
    else if(S.view==='cycle'&&S.cycleId)await openCycle(S.cycleId,S.stepId);
    else if(S.view==='schedule'&&S.schedule)await renderSchedule({reload:true});
    else if(S.view==='author'&&S.author){renderAuthorBasis();notice('Current workspace revision loaded. Your procedure draft keeps its original basis until you review any changes.');}
    else notice('Workspace refreshed.');
    const retained=await readKey(key('pending'));S.pending=await loadPending();renderRecovery();
  } finally {setBusy(false);}
}
function renderNav() {
  if(!S.data)return;
  const query=$('book-search').value.trim().toLowerCase(), books=(S.data.runbooks||[]).filter(item=>(item.name+' '+item.client).toLowerCase().includes(query));
  $('book-count').textContent=String((S.data.runbooks||[]).length);
  put('book-list',books.length?books.map(item=>el('button',{type:'button',className:'nav-item','aria-current':S.bookId===item.id?'true':null,onclick:act(()=>openBook(item.id))},el('strong',{},item.name),el('span',{},item.client+' · '+item.editionCount+' edition'+(item.editionCount===1?'':'s')))):empty(query?'No matching runbooks.':'Create the first runbook.'));
  const cq=$('cycle-search').value.trim().toLowerCase(), phase=$('cycle-phase').value;
  const cycles=(S.data.cycles||[]).filter(item=>(!phase||item.phase===phase)&&(item.label+' '+item.preparer+' '+item.reviewer).toLowerCase().includes(cq)).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  $('cycle-count').textContent=String((S.data.cycles||[]).length);
  put('cycle-list',cycles.length?cycles.map(item=>el('button',{type:'button',className:'nav-item','aria-current':S.cycleId===item.id?'true':null,onclick:act(()=>openCycle(item.id))},el('strong',{},item.label),el('span',{},(PHASE[item.phase]||item.phase)+' · due '+item.dueDate))):empty(cq||phase?'No matching periods.':'Start a period from a saved runbook.'));
}
function cycleCard(item) {
  return el('article',{className:'record-card'},el('div',{},el('h3',{},button(item.label,()=>openCycle(item.id),{quiet:true})),el('p',{className:'small muted'},'Preparer: '+item.preparer+' · Reviewer: '+item.reviewer),el('p',{className:'small'},'Due '+item.dueDate)),tag(PHASE[item.phase]||item.phase,item.phase==='IN_REVIEW'));
}
function renderOverview() {
  if(!S.data)return;
  const cycles=S.data.cycles||[],books=S.data.runbooks||[];
  const counts=[['Runbooks',books.length],['In preparation',cycles.filter(x=>['DRAFT','CHANGES_REQUESTED'].includes(x.phase)).length],['In review',cycles.filter(x=>x.phase==='IN_REVIEW').length],['Approved',cycles.filter(x=>x.phase==='APPROVED').length]];
  put('overview-counts',counts.map(([label,count])=>el('div',{className:'metric'},el('strong',{},count),el('span',{},label))));
  const current=cycles.filter(x=>x.phase!=='APPROVED').sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)));
  put('current-work',current.length?el('div',{className:'record-list'},current.map(cycleCard)):empty('No open period work. Start a period to assign preparation and review.'));
  put('overview-books',books.length?el('div',{className:'record-list'},books.map(item=>el('article',{className:'record-card'},el('div',{},el('h3',{},item.name),el('p',{className:'small muted'},item.client)),el('div',{className:'actions'},button('Open procedure',()=>openBook(item.id)),button('Start period',()=>startSchedule({runbookId:item.id,editionId:item.latestEditionId}),{mutation:true}))))):empty('A runbook keeps the reusable instructions and resource references for a client.'));
}
function fileName(id) { const found=(S.data?.files||[]).find(item=>item.id===id);return found?.name||('File '+short(id)); }
function fileList(ids) {
  return el('div',{className:'resource-list'},(ids||[]).map(id=>el('div',{className:'resource-item'},link(fileName(id),ROOT+'/files/'+encodeURIComponent(id),{download:true}))));
}
function resourceNodes(resources) {
  return (resources||[]).map(item=>{
    let content;
    if(item.kind==='link'){const href=safeHref(item.url);content=href?link(item.url,href,{external:true}):prose(item.url);}
    else if(item.kind==='file')content=link(fileName(item.fileId),ROOT+'/files/'+encodeURIComponent(item.fileId),{download:true});
    else content=prose(item.text);
    return el('div',{className:'resource-item'},el('h4',{},item.title),content);
  });
}
function procedureNode(edition) {
  const resources=new Map((edition.resources||[]).map(item=>[item.id,item]));
  return el('div',{className:'procedure'},(edition.steps||[]).map((step,index)=>el('article',{className:'procedure-step'},el('div',{className:'step-title'},el('h3',{},(index+1)+'. '+step.title),tag(step.required?'Required':'Optional')),prose(step.instructions),(step.resourceIds||[]).length?el('div',{className:'resource-list'},resourceNodes(step.resourceIds.map(id=>resources.get(id)).filter(Boolean))):null)));
}
async function openBook(id,editionId) {
  await flush();const epoch=++S.epoch,workspace=S.workspaceId;S.bookId=id;S.cycleId=null;S.book=null;
  showView('book');put('book-detail',empty('Loading procedure…'));
  const value=await api(ROOT+'/books/'+encodeURIComponent(id));
  if(epoch!==S.epoch||workspace!==S.workspaceId)return;
  sameWorkspace(value);S.book=value.runbook;S.data.revision=value.revision;
  S.editionId=(S.book.editions||[]).some(item=>item.id===editionId)?editionId:S.book.latestEditionId;
  renderBook();rememberView();
}
function renderBook() {
  const book=S.book;if(!book)return;
  const edition=book.editions.find(item=>item.id===S.editionId)||book.editions.at(-1);
  if(!edition){put('book-detail',empty('This runbook has no retained procedure edition.'));return;}
  S.editionId=edition.id;
  const chooser=select(book.editions.map(item=>({value:item.id,label:'Edition '+item.number+' · '+when(item.createdAt)+(item.id===book.latestEditionId?' · latest':'')})),edition.id,{onchange:event=>{S.editionId=event.target.value;renderBook();rememberView();}});
  put('book-detail',
    el('div',{className:'view-heading'},el('div',{},el('p',{className:'eyebrow'},edition.client),el('h1',{},edition.name)),tag('Edition '+edition.number)),
    el('section',{className:'panel'},field('Retained procedure edition',chooser),prose(edition.description),facts([['Recorded by',edition.actor],['Saved',when(edition.createdAt)],['Steps',edition.steps.length],['Resources',edition.resources.length]]),
      el('div',{className:'actions'},button('Create next edition',()=>beginAuthor(edition,{runbookId:book.id,expectedEditionId:book.latestEditionId}),{mutation:true}),button('Start period with this edition',()=>startSchedule({runbookId:book.id,editionId:edition.id}),{primary:true,mutation:true}))),
    el('section',{className:'panel'},el('h2',{},'Procedure'),procedureNode(edition)),
    (edition.resources||[]).length?el('section',{className:'panel'},el('h2',{},'All resources'),el('div',{className:'resource-list'},resourceNodes(edition.resources))):null);
  paintLocks();
}


async function loadAuthor() {
  const meta=await readKey(key('author/meta'));if(!meta)return null;
  const names=[...meta.stepIds.map(id=>key('author/step/'+id)),...meta.resourceIds.map(id=>key('author/resource/'+id)),key('author/reference')], values=await readMany(names);
  const steps=meta.stepIds.map(id=>values.get(key('author/step/'+id))),resources=meta.resourceIds.map(id=>values.get(key('author/resource/'+id)));
  if(steps.some(item=>!item)||resources.some(item=>!item))throw new Error('A saved procedure draft is incomplete in browser storage. Keep this tab open and restore the original draft before saving an edition.');
  return {meta,steps,resources,reference:values.get(key('author/reference'))||null};
}
function authorMetaChanged() { if(!S.author)return;S.author.meta.updatedAt=new Date().toISOString();persist(key('author/meta'),S.author.meta).catch(()=>{}); }
function saveAuthorPart(kind,item) { S.author.meta.updatedAt=new Date().toISOString();persist(key('author/'+kind+'/'+item.id),item).catch(()=>{}); }
async function beginAuthor(edition=null,context={}) {
  await flush();
  const retained=await loadAuthor();
  if(retained){S.author=retained;showView('author');renderAuthor();notice('Your saved procedure draft is open. Save or discard it before starting a different edition.');return;}
  const now=new Date().toISOString(), steps=clone(edition?.steps||[{id:slug('step'),title:'',instructions:'',required:true,resourceIds:[]}]),resources=clone(edition?.resources||[]);
  const meta={draftId:uid(),runbookId:context.runbookId||null,expectedEditionId:context.expectedEditionId||null,baseRevision:S.data.revision,name:edition?.name||'',client:edition?.client||'',description:edition?.description||'',stepIds:steps.map(x=>x.id),resourceIds:resources.map(x=>x.id),createdAt:now,updatedAt:now};
  S.author={meta,steps,resources,reference:edition?clone(edition):null};
  await writeBatch([[key('author/meta'),meta],[key('author/reference'),S.author.reference],...steps.map(item=>[key('author/step/'+item.id),item]),...resources.map(item=>[key('author/resource/'+item.id),item])]);
  showView('author');renderAuthor();notice('');
}
async function resumeAuthor() { await flush();S.author=await loadAuthor();if(!S.author)return beginAuthor();showView('author');renderAuthor(); }
function renderAuthorBasis() {
  if(!S.author)return;const meta=S.author.meta;
  $('author-basis').textContent=(meta.runbookId?'Based on retained edition '+short(meta.expectedEditionId)+'. ':'New runbook. ')+'Workspace revision '+short(meta.baseRevision)+'.';
  $('author-draft-label').textContent='Private draft';
}
function renderAuthor() {
  const draft=S.author;if(!draft)return;
  $('author-heading').textContent=draft.meta.runbookId?'Create next edition':'New runbook';
  $('author-name').value=draft.meta.name;$('author-client').value=draft.meta.client;$('author-description').value=draft.meta.description;
  renderAuthorBasis();renderAuthorResources();renderAuthorSteps();
  const box=$('author-reference');box.hidden=!draft.reference;
  if(draft.reference)put(box,el('details',{},el('summary',{},'Original selected edition · '+(draft.reference.number||short(draft.reference.id))),el('div',{},prose(draft.reference.description),procedureNode(draft.reference))));
  else put(box);
  paintLocks();
}
function selectedResourceChecks(step) {
  if(!S.author.resources.length)return empty('Add resources above to attach them to this step.');
  return el('div',{className:'check-list'},S.author.resources.map(resource=>{
    const control=input('',{type:'checkbox',checked:step.resourceIds.includes(resource.id),onchange:event=>{
      step.resourceIds=event.target.checked?[...new Set([...step.resourceIds,resource.id])]:step.resourceIds.filter(id=>id!==resource.id);saveAuthorPart('step',step);
    }});
    return el('label',{className:'check-row'},control,el('span',{},resource.title||'Untitled resource',el('small',{},resource.kind)));
  }));
}
function renderAuthorResources() {
  const draft=S.author;if(!draft)return;
  put('author-resources',draft.resources.length?draft.resources.map((resource,index)=>{
    const title=input(resource.title,{maxlength:240,required:true,oninput:event=>{resource.title=event.target.value;saveAuthorPart('resource',resource);}});
    const kind=select([{value:'link',label:'Web link'},{value:'note',label:'Working note'},{value:'file',label:'Retained document'}],resource.kind,{onchange:event=>{
      resource.kind=event.target.value;saveAuthorPart('resource',resource);renderAuthorResources();renderAuthorSteps();paintLocks();
    }});
    let body;
    if(resource.kind==='link')body=field('Link address',input(resource.url||'',{type:'url',maxlength:8000,placeholder:'https://',required:true,oninput:event=>{resource.url=event.target.value;saveAuthorPart('resource',resource);}}),{full:true});
    else if(resource.kind==='note')body=field('Working note',area(resource.text||'',{maxlength:32000,rows:5,required:true,oninput:event=>{resource.text=event.target.value;saveAuthorPart('resource',resource);}}),{full:true});
    else{
      const files=(S.data.files||[]),options=[{value:'',label:'Choose a retained document'},...files.map(item=>({value:item.id,label:item.name+' · '+bytes(item.bytes)}))];
      if(resource.fileId&&!files.some(item=>item.id===resource.fileId))options.push({value:resource.fileId,label:'Selected retained file · '+short(resource.fileId)});
      const picker=select(options,resource.fileId||'',{required:true,onchange:event=>{resource.fileId=event.target.value;saveAuthorPart('resource',resource);}});
      const upload=input('',{type:'file'});
      body=el('div',{className:'full'},field('Retained document',picker),el('div',{className:'resource-inline'},field('Add a document',upload,{hint:'Up to 8 MiB; retained with this accounting workspace.'}),button('Upload document',async()=>uploadFile(upload.files[0],{draftId:draft.meta.draftId,resourceId:resource.id}),{mutation:true})));
    }
    return el('article',{className:'editor-card'},el('div',{className:'section-heading'},el('h3',{},'Resource '+(index+1)),el('div',{className:'actions'},
      button('Move up',()=>moveAuthor('resource',index,-1),{disabled:index===0}),button('Move down',()=>moveAuthor('resource',index,1),{disabled:index===draft.resources.length-1}),button('Remove',()=>removeResource(resource.id)))),
      el('div',{className:'form-grid'},field('Resource title',title),field('Resource type',kind),body));
  }):empty('Add a document, a working note or a link used by this procedure.'));
  $('add-resource').dataset.permanentDisabled=draft.resources.length>=100?'true':'false';
}
function renderAuthorSteps() {
  const draft=S.author;if(!draft)return;
  put('author-steps',draft.steps.map((step,index)=>{
    const title=input(step.title,{maxlength:240,required:true,oninput:event=>{step.title=event.target.value;saveAuthorPart('step',step);}});
    const instructions=area(step.instructions,{rows:6,maxlength:32000,required:true,oninput:event=>{step.instructions=event.target.value;saveAuthorPart('step',step);}});
    const required=input('',{type:'checkbox',checked:step.required,onchange:event=>{step.required=event.target.checked;saveAuthorPart('step',step);}});
    return el('article',{className:'editor-card'},el('div',{className:'section-heading'},el('h3',{},'Step '+(index+1)),el('div',{className:'actions'},
      button('Move up',()=>moveAuthor('step',index,-1),{disabled:index===0}),button('Move down',()=>moveAuthor('step',index,1),{disabled:index===draft.steps.length-1}),button('Remove',()=>removeStep(step.id),{disabled:draft.steps.length===1}))),
      field('Task title',title),field('Instructions',instructions),el('label',{className:'check-row'},required,el('span',{},'Required for period preparation')),
      el('h4',{},'Resources used in this step'),selectedResourceChecks(step));
  }));
  $('add-step').dataset.permanentDisabled=draft.steps.length>=100?'true':'false';
}
async function moveAuthor(kind,index,direction) {
  await flush();const list=kind==='step'?S.author.steps:S.author.resources,other=index+direction;
  if(other<0||other>=list.length)return;[list[index],list[other]]=[list[other],list[index]];
  S.author.meta[kind==='step'?'stepIds':'resourceIds']=list.map(item=>item.id);await persist(key('author/meta'),S.author.meta);
  if(kind==='step')renderAuthorSteps();else{renderAuthorResources();renderAuthorSteps();}paintLocks();
}
async function addResource() {
  if(S.author.resources.length>=100)throw new Error('A procedure edition can retain up to 100 resources.');
  const item={id:slug('resource'),title:'',kind:'note',text:''};S.author.resources.push(item);S.author.meta.resourceIds.push(item.id);
  await flush();await writeBatch([[key('author/resource/'+item.id),item],[key('author/meta'),S.author.meta]]);renderAuthorResources();renderAuthorSteps();paintLocks();
}
async function addStep() {
  if(S.author.steps.length>=100)throw new Error('A procedure edition can retain up to 100 steps.');
  const item={id:slug('step'),title:'',instructions:'',required:true,resourceIds:[]};S.author.steps.push(item);S.author.meta.stepIds.push(item.id);
  await flush();await writeBatch([[key('author/step/'+item.id),item],[key('author/meta'),S.author.meta]]);renderAuthorSteps();paintLocks();
}
async function removeResource(id) {
  await flush();S.author.resources=S.author.resources.filter(item=>item.id!==id);S.author.meta.resourceIds=S.author.resources.map(item=>item.id);
  const changed=[];
  for(const step of S.author.steps)if(step.resourceIds.includes(id)){step.resourceIds=step.resourceIds.filter(value=>value!==id);changed.push([key('author/step/'+step.id),step]);}
  await writeBatch([[key('author/meta'),S.author.meta],...changed],[key('author/resource/'+id)]);renderAuthorResources();renderAuthorSteps();paintLocks();
}
async function removeStep(id) {
  if(S.author.steps.length===1)return;await flush();S.author.steps=S.author.steps.filter(item=>item.id!==id);S.author.meta.stepIds=S.author.steps.map(item=>item.id);
  await writeBatch([[key('author/meta'),S.author.meta]],[key('author/step/'+id)]);renderAuthorSteps();paintLocks();
}
async function discardAuthor() {
  await flush();if(!S.author)return;
  const retained=await savedEntries(key('author/'));
  await writeBatch([[key('discarded-author/'+S.author.meta.draftId),{discardedAt:new Date().toISOString(),draft:clone(S.author)}]],retained.map(([name])=>name));
  S.author=null;showView('overview');notice('The current draft was discarded. Saved procedure editions remain available.');
}
function normalizedResources() {
  return S.author.resources.map(item=>{
    const output={id:item.id,title:item.title,kind:item.kind};
    if(item.kind==='link'){if(!safeHref(item.url))throw new Error('Resource “'+item.title+'” needs an http or https address.');output.url=item.url;}
    else if(item.kind==='file'){if(!item.fileId)throw new Error('Choose the retained document for “'+item.title+'”.');output.fileId=item.fileId;}
    else output.text=item.text||'';
    return output;
  });
}
async function saveEdition() {
  if(!$('author-form').reportValidity())return;
  await flush();const draft=S.author,body={name:draft.meta.name,client:draft.meta.client,description:draft.meta.description,steps:clone(draft.steps),resources:normalizedResources()};
  if(draft.meta.runbookId){body.runbookId=draft.meta.runbookId;body.expectedEditionId=draft.meta.expectedEditionId;}
  await mutate('book',ROOT+'/books/save',null,body,{draftId:draft.meta.draftId},draft.meta.baseRevision);
}
async function uploadFile(file,context) {
  setBusy(true,'Retaining document…');
  try{
    if(context.cycleId&&context.stepId){const draft=S.workDrafts.get(context.stepId);if(draft?.draftId===context.draftId)await persist(workKey(context.cycleId,context.stepId),draft);}
    const value=await readFile(file,FILE_LIMIT);
    await mutate('file',ROOT+'/files',null,{name:value.name,type:value.type,content:value.content},context,S.data.revision);
  }finally{setBusy(false);}
}
async function startSchedule(options={}) {
  await flush();const old=await readKey(key('schedule'));
  if(old){S.schedule=old;showView('schedule');await renderSchedule({reload:true});notice('Your saved period draft is open. Create or discard it before starting another period.');return;}
  const previous=options.previousCycle||null;
  const draft={draftId:uid(),baseRevision:S.data.revision,runbookId:options.runbookId||previous?.runbookId||'',editionId:options.editionId||previous?.editionId||'',label:'',preparer:previous?.preparer||'',reviewer:previous?.reviewer||'',dueDate:'',handoffId:'',accountantRevisionId:'',periodCloseId:'',previousCycleId:previous?.id||'',previousLabel:previous?.label||'',createdAt:new Date().toISOString()};
  S.schedule=draft;await writeBatch([[key('schedule'),draft]]);showView('schedule');await renderSchedule({reload:true});notice('');
}
async function resumeSchedule() {
  await flush();S.schedule=await readKey(key('schedule'));if(!S.schedule)return startSchedule();
  showView('schedule');await renderSchedule({reload:true});
}
function saveScheduleDraft() { if(S.schedule)persist(key('schedule'),S.schedule).catch(()=>{}); }
function fillOptions(node,options,value) {
  node.replaceChildren(...options.map(item=>el('option',{value:item.value,disabled:item.disabled},item.label)));
  if(value&&!options.some(item=>item.value===value))node.append(el('option',{value,disabled:true},'Earlier selection unavailable · '+short(value)));
  node.value=value||'';
}
async function renderSchedule({reload=false}={}) {
  const draft=S.schedule;if(!draft)return;
  const generation=++S.epoch,workspace=S.workspaceId,draftId=draft.draftId,bookId=draft.runbookId;
  if(reload||!S.sources){
    const calls=[api(ROOT+'/sources'),bookId?api(ROOT+'/books/'+encodeURIComponent(bookId)):Promise.resolve(null)];
    const results=await Promise.allSettled(calls);
    if(generation!==S.epoch||workspace!==S.workspaceId||S.schedule?.draftId!==draftId||S.schedule.runbookId!==bookId)return;
    for(const result of results)if(result.status==='rejected')throw result.reason;
    S.sources=sameWorkspace(results[0].value);S.scheduleBook=results[1].value?sameWorkspace(results[1].value).runbook:null;
  }else if(bookId&&S.scheduleBook?.id!==bookId){
    const value=await api(ROOT+'/books/'+encodeURIComponent(bookId));
    if(generation!==S.epoch||workspace!==S.workspaceId||S.schedule?.draftId!==draftId||S.schedule.runbookId!==bookId)return;
    S.scheduleBook=sameWorkspace(value).runbook;
  }else if(!bookId)S.scheduleBook=null;
  fillOptions($('schedule-book'),[{value:'',label:'Choose a runbook'},...(S.data.runbooks||[]).map(item=>({value:item.id,label:item.name+' · '+item.client}))],draft.runbookId);
  fillOptions($('schedule-edition'),[{value:'',label:'Choose an edition'},...(S.scheduleBook?.editions||[]).map(item=>({value:item.id,label:'Edition '+item.number+' · '+when(item.createdAt)+(item.id===S.scheduleBook.latestEditionId?' · latest':'')}))],draft.editionId);
  for(const [id,name] of [['schedule-label','label'],['schedule-preparer','preparer'],['schedule-reviewer','reviewer'],['schedule-due','dueDate']])$(id).value=draft[name]||'';
  const context=$('schedule-context');context.hidden=!draft.previousCycleId;
  if(draft.previousCycleId)put(context,el('h2',{},'Following period'),el('p',{},'Continue the procedure after “'+draft.previousLabel+'”. Choose the new local accountant source below. Earlier worked tasks and reviews stay in the prior period.'),button('Open prior worked period',()=>openCycle(draft.previousCycleId)));
  else put(context);
  renderScheduleSources();paintLocks();
}
function renderScheduleSources() {
  const draft=S.schedule;if(!draft||!S.sources)return;
  const handoffs=S.sources.handoffs||[];
  fillOptions($('schedule-handoff'),[{value:'',label:'Choose a local accountant handoff'},...handoffs.map(item=>({value:item.id,label:'Handoff '+short(item.id)+' · run '+short(item.runId)+' · '+when(item.createdAt)}))],draft.handoffId);
  const selected=handoffs.find(item=>item.id===draft.handoffId);
  let revisions=selected?.revisions||[];
  if(selected&&!revisions.some(item=>item.id==='initial'))revisions=[{id:'initial',label:'Initial accountant handoff'},...revisions];
  fillOptions($('schedule-accountant-revision'),[{value:'',label:selected?'Choose the accountant revision':'Choose a handoff first'},...revisions.map(item=>({value:item.id,label:item.label||short(item.id)}))],draft.accountantRevisionId);
  const closes=(S.sources.closes||[]).filter(item=>selected&&item.runId===selected.runId);
  fillOptions($('schedule-close'),[{value:'',label:'No closed-period selection'},...closes.map(item=>({value:item.id,label:item.label||short(item.id)}))],draft.periodCloseId);
  put('schedule-source-summary',selected?facts([['Selected source run',selected.runId],['Accountant handoff',selected.id],['Accountant revision',draft.accountantRevisionId||'Choose a revision'],['Closed period',closes.find(item=>item.id===draft.periodCloseId)?.label||'No closed-period selection']]):empty('Choose an existing local accountant handoff. Receiving a foreign period does not substitute a local source.'));
}
async function saveCycle() {
  if(!$('schedule-form').reportValidity())return;
  await flush();const draft=S.schedule;
  if(!S.sources?.handoffs?.some(item=>item.id===draft.handoffId))throw new Error('Choose a currently available local accountant handoff.');
  const fields={runbookId:draft.runbookId,editionId:draft.editionId,label:draft.label,preparer:draft.preparer,reviewer:draft.reviewer,dueDate:draft.dueDate,handoffId:draft.handoffId,accountantRevisionId:draft.accountantRevisionId};
  if(draft.periodCloseId)fields.periodCloseId=draft.periodCloseId;if(draft.previousCycleId)fields.previousCycleId=draft.previousCycleId;
  await mutate('cycle',ROOT+'/cycles',null,fields,{draftId:draft.draftId},draft.baseRevision);
}
async function discardSchedule() {
  await flush();if(!S.schedule)return;
  await writeBatch([[key('discarded-schedule/'+S.schedule.draftId),{discardedAt:new Date().toISOString(),draft:clone(S.schedule)}]],[key('schedule')]);S.schedule=null;showView('overview');notice('The current period draft was discarded.');
}


function cyclePath(id=S.cycleId) { return ROOT+'/cycles/'+encodeURIComponent(id); }
function workKey(cycleId,stepId) { return key('work/'+cycleId+'/'+stepId); }
async function openCycle(id,stepId) {
  await flush();const epoch=++S.epoch,workspace=S.workspaceId;S.cycleId=id;S.cycle=null;S.stepId=null;S.workDrafts.clear();
  showView('cycle');put('cycle-detail',empty('Loading worked period…'));
  const results=await Promise.allSettled([api(cyclePath(id)),savedEntries(key('work/'+id+'/')),readMany([key('submit/'+id),key('review/'+id)])]);
  if(epoch!==S.epoch||workspace!==S.workspaceId)return;
  for(const result of results)if(result.status==='rejected')throw result.reason;
  const value=sameWorkspace(results[0].value);S.cycle=value.cycle;S.data.revision=value.revision;S.bookId=value.cycle.runbookId;
  S.workDrafts=new Map(results[1].value.map(([,draft])=>[draft.stepId,draft]));
  S.cycleNotes={submit:results[2].value.get(key('submit/'+id))||{note:'',baseRevision:value.revision},review:results[2].value.get(key('review/'+id))||{decision:'',note:'',acceptedExceptions:[],baseRevision:value.revision}};
  S.stepId=(S.cycle.edition?.steps||[]).some(item=>item.id===stepId)?stepId:S.cycle.edition?.steps?.[0]?.id;
  renderCycle();rememberView();
}
function workStatus(cycle,stepId) { return cycle.work?.[stepId]?.status||'PENDING'; }
function cycleEditable() { return !!S.cycle&&!S.cycle.readOnly&&['DRAFT','CHANGES_REQUESTED'].includes(S.cycle.phase); }
function ensureWorkDraft(stepId) {
  let draft=S.workDrafts.get(stepId);if(draft)return draft;
  const current=S.cycle.work?.[stepId]||{status:'PENDING',note:'',fileIds:[]};
  draft={draftId:uid(),cycleId:S.cycle.id,stepId,baseRevision:S.data.revision,status:current.status||'PENDING',note:current.note||'',fileIds:clone(current.fileIds||[]),original:clone(current),dirty:false};
  S.workDrafts.set(stepId,draft);return draft;
}
function saveWorkDraft(draft) {
  draft.dirty=true;draft.updatedAt=new Date().toISOString();
  persist(workKey(draft.cycleId,draft.stepId),draft).catch(()=>{});
  const badgeNode=$('step-draft-state');if(badgeNode)badgeNode.textContent='Unsaved step draft';
  renderStepNav();renderCyclePreparation();
}
function renderStepNav() {
  const node=$('cycle-step-nav');if(!node||!S.cycle)return;
  put(node,(S.cycle.edition.steps||[]).map((step,index)=>{
    const draft=S.workDrafts.get(step.id);
    return el('button',{type:'button','aria-current':S.stepId===step.id?'true':null,onclick:act(async()=>{await flush();S.stepId=step.id;renderStepNav();renderWorkStep();rememberView();})},
      el('strong',{},(index+1)+'. '+step.title),tag(STATUS[workStatus(S.cycle,step.id)]||workStatus(S.cycle,step.id)),el('span',{},draft?.dirty?'Private draft to save':step.required?'Required':'Optional'));
  }));
}
function renderCycle() {
  const cycle=S.cycle;if(!cycle)return;
  const edition=cycle.edition,steps=edition.steps||[],saved=steps.filter(step=>workStatus(cycle,step.id)==='COMPLETE').length;
  const latestReturn=[...(cycle.reviews||[])].reverse().find(item=>item.decision==='RETURN');
  const source=cycle.source||{};
  const header=el('div',{className:'view-heading'},el('div',{},el('p',{className:'eyebrow'},edition.client+' · '+edition.name),el('h1',{},cycle.label)),tag(PHASE[cycle.phase]||cycle.phase,true));
  const overview=el('section',{className:'panel'},facts([['Due date',cycle.dueDate],['Preparer',cycle.preparer],['Reviewer',cycle.reviewer],['Procedure edition','Edition '+edition.number],['Completed steps',saved+' of '+steps.length],['Work mode',cycle.readOnly?'Received handover':'Local period']]),
    cycle.readOnly?el('p',{className:'inline-note'},'This received period retains its original preparation, review and accountant source. Start a following local period to perform the procedure with a new local handoff.'):null,
    cycle.phase==='CHANGES_REQUESTED'&&latestReturn?el('div',{className:'inline-note'},el('strong',{},'Review returned this preparation'),prose(latestReturn.note)):null,
    el('div',{className:'actions'},link('Download handover packet',cyclePath(cycle.id)+'/packet',{download:true}),link('Printable handover',cyclePath(cycle.id)+'/print',{download:true}),link('Task handover CSV',cyclePath(cycle.id)+'/tasks.csv',{download:true}),
      button('Start following period',()=>startSchedule({previousCycle:cycle}),{mutation:true}),button('Open procedure edition',()=>openBook(cycle.runbookId,cycle.editionId))));
  const sourceDetails=el('details',{className:'panel'},el('summary',{},'Selected accountant source and period lineage'),facts([['Source run',source.runId],['Accountant handoff',source.handoffId||cycle.handoffId],['Accountant revision',source.accountantRevisionId||cycle.accountantRevisionId],['Closed period',cycle.periodCloseId||source.periodCloseId],['Previous worked period',cycle.previousCycleId],['Origin workspace',cycle.origin?.workspaceId||cycle.originWorkspaceId||source.originWorkspaceId]]));
  const layout=el('div',{className:'cycle-layout'},el('nav',{id:'cycle-step-nav',className:'step-nav','aria-label':'Procedure steps'}),el('div',{className:'cycle-work'},el('div',{id:'cycle-step'}),el('div',{id:'cycle-preparation'}),el('div',{id:'cycle-review'})));
  put('cycle-detail',header,overview,sourceDetails,layout,el('section',{className:'panel'},el('h2',{},'Preparation and review history'),el('div',{id:'cycle-history',className:'history'})));
  renderStepNav();renderWorkStep();renderCyclePreparation();renderCycleReview();renderCycleHistory();paintLocks();
}
function attachmentPicker(draft,{onChange}={}) {
  const files=S.data.files||[],known=new Set(files.map(item=>item.id));
  const options=[...files,...draft.fileIds.filter(id=>!known.has(id)).map(id=>({id,name:'Retained file '+short(id)}))];
  if(!options.length)return empty('No retained documents yet. Upload the source document used for this work.');
  return el('div',{className:'check-list'},options.map(file=>el('label',{className:'check-row'},input('',{type:'checkbox',checked:draft.fileIds.includes(file.id),onchange:event=>{
    draft.fileIds=event.target.checked?[...new Set([...draft.fileIds,file.id])]:draft.fileIds.filter(id=>id!==file.id);onChange?.();
  }}),el('span',{},file.name,el('small',{},file.bytes===undefined?'Retained original file':bytes(file.bytes)+' · '+short(file.sha256))))));
}
function renderWorkStep() {
  const cycle=S.cycle,node=$('cycle-step');if(!cycle||!node)return;
  const step=cycle.edition.steps.find(item=>item.id===S.stepId);
  if(!step){put(node,empty('This period has no procedure steps.'));return;}
  const resources=new Map((cycle.edition.resources||[]).map(item=>[item.id,item])),saved=cycle.work?.[step.id]||{status:'PENDING',note:'',fileIds:[]};
  const instruction=el('div',{className:'step-instructions'},el('div',{className:'section-heading'},el('h2',{},step.title),tag(step.required?'Required':'Optional')),prose(step.instructions),(step.resourceIds||[]).length?el('div',{className:'resource-list'},resourceNodes(step.resourceIds.map(id=>resources.get(id)).filter(Boolean))):null);
  if(!cycleEditable()){
    put(node,el('section',{className:'panel'},instruction,facts([['Saved status',STATUS[saved.status]||saved.status],['Recorded by',saved.actor],['Saved',saved.updatedAt?when(saved.updatedAt):null]]),prose(saved.note),fileList(saved.fileIds),
      S.workDrafts.get(step.id)?.dirty?el('p',{className:'inline-note'},'A private step draft is retained from earlier preparation. This period is currently '+(PHASE[cycle.phase]||cycle.phase).toLowerCase()+'. The retained draft is not part of the saved handover.'):null));
    return;
  }
  const draft=ensureWorkDraft(step.id),form=el('form',{className:'panel mutation-form',onsubmit:act(()=>saveStep(step.id))});
  const status=select(Object.entries(STATUS).map(([value,label])=>({value,label})),draft.status,{onchange:event=>{draft.status=event.target.value;saveWorkDraft(draft);}});
  const note=area(draft.note,{rows:7,maxlength:32000,oninput:event=>{draft.note=event.target.value;saveWorkDraft(draft);}});
  const upload=input('',{type:'file'});
  form.append(instruction,el('div',{className:'split-note'},tag(STATUS[saved.status]||saved.status),el('span',{id:'step-draft-state',className:'small muted'},draft.dirty?'Unsaved step draft':'Saved preparation loaded')),
    field('Task status',status),field('Work performed, result or reason',note,{hint:'Describe the work and any exception. A blocked or not-applicable required task needs a clear reason.'}),el('h3',{},'Documents used or produced'),
    attachmentPicker(draft,{onChange:()=>saveWorkDraft(draft)}),
    el('div',{className:'resource-inline'},field('Retain another document',upload,{hint:'Up to 8 MiB.'}),button('Upload and attach',()=>uploadFile(upload.files[0],{cycleId:cycle.id,stepId:step.id,draftId:draft.draftId}),{mutation:true})),
    facts([['Last saved by',saved.actor],['Last saved',saved.updatedAt?when(saved.updatedAt):null]]),
    el('div',{className:'form-footer'},el('p',{className:'small muted'},'Changes stay in a private draft until you save this task.'),el('div',{className:'actions'},button('Discard step draft',()=>discardWork(step.id)),el('button',{type:'submit',className:'primary'},'Save task preparation'))));
  put(node,form);paintLocks();
}
async function discardWork(stepId) {
  await flush();const draft=S.workDrafts.get(stepId);if(!draft)return;
  await writeBatch([[key('discarded-work/'+draft.draftId),{discardedAt:new Date().toISOString(),draft:clone(draft)}]],[workKey(S.cycle.id,stepId)]);
  S.workDrafts.delete(stepId);renderWorkStep();renderStepNav();renderCyclePreparation();notice('The step now shows its saved preparation.');
}
async function saveStep(stepId) {
  const draft=ensureWorkDraft(stepId);await flush();
  if(['BLOCKED','NOT_APPLICABLE'].includes(draft.status)&&!draft.note.trim())throw new Error('Explain the blocked or not-applicable task before saving it.');
  await mutate('work',cyclePath(S.cycle.id)+'/work',S.cycle.id,{stepId,status:draft.status,note:draft.note,fileIds:clone(draft.fileIds)},{cycleId:S.cycle.id,stepId,draftId:draft.draftId},draft.baseRevision);
}
function renderCyclePreparation() {
  const cycle=S.cycle,node=$('cycle-preparation');if(!cycle||!node)return;
  if(!cycleEditable()){put(node);return;}
  const steps=cycle.edition.steps||[],pending=steps.filter(step=>step.required&&workStatus(cycle,step.id)==='PENDING'),blocked=steps.filter(step=>step.required&&workStatus(cycle,step.id)==='BLOCKED'),dirty=[...S.workDrafts.values()].filter(item=>item.dirty);
  const draft=S.cycleNotes.submit;
  const note=area(draft.note,{rows:4,maxlength:32000,oninput:event=>{draft.note=event.target.value;persist(key('submit/'+cycle.id),draft).catch(()=>{});}});
  const submit=el('button',{type:'submit',className:'primary'},'Submit preparation for review');
  if(pending.length||dirty.length)submit.dataset.permanentDisabled='true';
  const form=el('form',{className:'panel mutation-form',onsubmit:act(()=>submitCycle())},el('h2',{},'Send preparation to review'),
    el('p',{},'The saved task preparation becomes one retained review round for '+cycle.reviewer+'.'),
    pending.length?el('p',{className:'inline-note'},pending.length+' required task'+(pending.length===1?' remains':'s remain')+' pending: '+pending.map(item=>item.title).join('; ')+'.'):null,
    dirty.length?el('p',{className:'inline-note'},dirty.length+' private task draft'+(dirty.length===1?' needs':'s need')+' saving or discarding before submission.'):null,
    blocked.length?el('p',{className:'inline-note'},'The reviewer will decide whether to accept these required exceptions: '+blocked.map(item=>item.title).join('; ')+'.'):null,
    field('Preparation handover note',note),el('div',{className:'actions'},submit));
  put(node,form);paintLocks();
}
async function submitCycle() {
  await flush();const cycle=S.cycle;
  if([...S.workDrafts.values()].some(item=>item.dirty))throw new Error('Save or discard each private task draft before submitting the saved preparation.');
  const draft=S.cycleNotes.submit;
  await mutate('submit',cyclePath(cycle.id)+'/submit',cycle.id,{note:draft.note},{cycleId:cycle.id},draft.baseRevision);
}
function renderCycleReview() {
  const cycle=S.cycle,node=$('cycle-review');if(!cycle||!node)return;
  if(cycle.readOnly||cycle.phase!=='IN_REVIEW'){put(node);return;}
  const draft=S.cycleNotes.review,exceptions=cycle.edition.steps.filter(step=>step.required&&workStatus(cycle,step.id)==='BLOCKED');
  draft.acceptedExceptions=draft.acceptedExceptions.filter(id=>exceptions.some(item=>item.id===id));
  const decision=select([{value:'',label:'Choose the review decision'},{value:'APPROVE',label:'Approve preparation'},{value:'RETURN',label:'Return for changes'}],draft.decision,{required:true,onchange:event=>{draft.decision=event.target.value;persist(key('review/'+cycle.id),draft).catch(()=>{});renderCycleReview();paintLocks();}});
  const note=area(draft.note,{rows:5,maxlength:32000,required:draft.decision==='RETURN'||(draft.decision==='APPROVE'&&exceptions.length>0),oninput:event=>{draft.note=event.target.value;persist(key('review/'+cycle.id),draft).catch(()=>{});}});
  const exceptionList=el('div',{className:'check-list'},exceptions.map(step=>el('label',{className:'check-row'},input('',{type:'checkbox',checked:draft.acceptedExceptions.includes(step.id),onchange:event=>{
    draft.acceptedExceptions=event.target.checked?[...new Set([...draft.acceptedExceptions,step.id])]:draft.acceptedExceptions.filter(id=>id!==step.id);persist(key('review/'+cycle.id),draft).catch(()=>{});
  }}),el('span',{},'Accept exception: '+step.title,el('small',{},cycle.work?.[step.id]?.note||'No saved explanation')))));
  const form=el('form',{className:'panel mutation-form',onsubmit:act(event=>{if(event.target.reportValidity())return reviewCycle();})},el('h2',{},'Review the submitted work'),el('p',{},'Assigned reviewer: '+cycle.reviewer+'. Read the saved task results and attached documents before recording the decision.'),
    field('Review decision',decision),draft.decision==='APPROVE'&&exceptions.length?el('div',{},el('h3',{},'Required exceptions'),el('p',{className:'small'},'Select each required blocked task you are explicitly accepting and explain the decision.'),exceptionList):null,
    field('Review note',note),el('div',{className:'actions'},el('button',{type:'submit',className:'primary'},'Record review decision')));
  put(node,form);paintLocks();
}
async function reviewCycle() {
  await flush();const cycle=S.cycle,draft=S.cycleNotes.review;
  if(!['APPROVE','RETURN'].includes(draft.decision))throw new Error('Choose whether to approve or return this preparation.');
  const blocked=cycle.edition.steps.filter(step=>step.required&&workStatus(cycle,step.id)==='BLOCKED');
  if(draft.decision==='APPROVE'&&blocked.some(step=>!draft.acceptedExceptions.includes(step.id)))throw new Error('Explicitly select each required blocked task you accept, or return the preparation for changes.');
  if((draft.decision==='RETURN'||(draft.decision==='APPROVE'&&blocked.length))&&!draft.note.trim())throw new Error('Add the reason for this review decision.');
  await mutate('review',cyclePath(cycle.id)+'/review',cycle.id,{decision:draft.decision,note:draft.note,acceptedExceptions:draft.decision==='APPROVE'?clone(draft.acceptedExceptions):[]},{cycleId:cycle.id},draft.baseRevision);
}
function historyDetails(label,build) {
  const content=el('div'),details=el('details',{},el('summary',{},label),content);let built=false;
  details.addEventListener('toggle',()=>{if(details.open&&!built){built=true;put(content,build());}});return details;
}
function renderCycleHistory() {
  const cycle=S.cycle,node=$('cycle-history');if(!cycle||!node)return;
  const steps=new Map(cycle.edition.steps.map(item=>[item.id,item])),entries=[];
  for(const round of cycle.submissions||[]){
    const detail=historyDetails('Preparation submitted · '+when(round.at)+' · '+round.actor,()=>{
      const rows=Object.entries(round.work||{}).map(([stepId,work])=>el('div',{},
        el('h4',{},steps.get(stepId)?.title||short(stepId)),tag(STATUS[work.status]||work.status),prose(work.note),fileList(work.fileIds),
        el('p',{className:'small muted'},'Recorded by '+(work.actor||'—')+' · '+when(work.updatedAt))));
      return el('div',{},prose(round.note),facts([['Recorded by',round.actor],['Preparation snapshot',round.workSha256],['Submission',round.id]]),el('div',{className:'round-work'},rows));
    });
    entries.push({at:round.at,node:detail});
  }
  for(const review of cycle.reviews||[]){
    const detail=historyDetails((review.decision==='APPROVE'?'Review approved':'Returned for changes')+' · '+when(review.at)+' · '+review.actor,()=>{
      const exceptions=(review.acceptedExceptions||[]).map(id=>el('li',{},steps.get(id)?.title||short(id)));
      return el('div',{},prose(review.note),facts([['Recorded by',review.actor],['Reviewed submission',review.submissionId],['Preparation snapshot',review.workSha256],['Review',review.id]]),
        exceptions.length?el('div',{},el('h4',{},'Accepted required exceptions'),el('ul',{},exceptions)):null);
    });
    entries.push({at:review.at,node:detail});
  }
  entries.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  put(node,entries.length?entries.map(item=>item.node):empty('Preparation submissions and review decisions will appear here as retained rounds.'));
}
async function receivePacket() {
  if(!$('receive-form').reportValidity())return;setBusy(true,'Reading handover packet…');
  try{const file=await readFile($('receive-file').files[0],PACKET_LIMIT);await mutate('receive',ROOT+'/receive',null,{content:file.content},{name:file.name,bytes:file.bytes},S.data.revision);}
  finally{setBusy(false);}
}


function routeFor(action,target) {
  if(action==='book')return ROOT+'/books/save';
  if(action==='file')return ROOT+'/files';
  if(action==='cycle')return ROOT+'/cycles';
  if(action==='receive')return ROOT+'/receive';
  return ROOT+'/cycles/'+encodeURIComponent(target)+'/'+({work:'work',submit:'submit',review:'review'}[action]);
}
async function validatePending(pending) {
  if(!pending||pending.schema!=='stellar-forge.runbook-browser-operation.v1'||!KINDS[pending.action]||pending.kind!==KINDS[pending.action]||pending.path!==routeFor(pending.action,pending.target))throw new Error('The retained save does not match the original runbook operation contract.');
  if(pending.input.workspaceId!==S.workspaceId)throw new Error('The retained save belongs to another accounting workspace.');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pending.input.requestId))throw new Error('The retained request identity is invalid.');
  const digest=await sha256(canonical({kind:pending.kind,target:pending.target,input:pending.input}));
  if(digest!==pending.requestSha256)throw new Error('The retained request bytes changed. Keep the original save for recovery.');
}
async function loadPending() {
  const values=await readMany([key('pending'),key('pending-status')]),pending=values.get(key('pending')),status=values.get(key('pending-status'));
  if(!pending)return null;
  if(status?.requestId===pending.input.requestId)pending.status=status;
  return pending;
}
let broadcast;
try{broadcast=new BroadcastChannel('stellar-forge-accounting-runbooks');}catch{}
function announceOperation() { broadcast?.postMessage({workspaceId:S.workspaceId,at:Date.now()}); }
async function statusPending(pending,fields) {
  const status={requestId:pending.input.requestId,...fields,updatedAt:new Date().toISOString()};
  await writeBatch([[key('pending-status'),status]]);pending.status=status;S.pending=pending;renderRecovery();paintLocks();announceOperation();
}
async function mutate(action,path,target,fields,context={},revision=S.data.revision) {
  if(S.saving)throw new Error('The current save is still running.');
  if(S.pending)throw new Error('Resolve the retained save before starting another mutation.');
  if(!S.connected||S.storageError)throw new Error('Reconnect the workspace and private draft storage before saving.');
  S.saving=true;setBusy(true,action==='file'?'Retaining document…':action==='receive'?'Receiving handover…':'Saving runbook work…');
  try{
    await flush();
    const inputValue={workspaceId:S.workspaceId,requestId:uid(),revision,actor:recordedBy(),...clone(fields)};
    const pending={schema:'stellar-forge.runbook-browser-operation.v1',action,kind:KINDS[action],target:target||null,path,input:inputValue,requestSha256:await sha256(canonical({kind:KINDS[action],target:target||null,input:inputValue})),context:clone(context),createdAt:new Date().toISOString()};
    await validatePending(pending);await reservePending(pending);S.pending=pending;renderRecovery();paintLocks();announceOperation();
    await postPending(pending);
  }catch(error){
    if(error.code==='PENDING_OPERATION'){S.pending=await loadPending();renderRecovery();}
    throw error;
  }finally{S.saving=false;setBusy(false);}
}
async function postPending(pending) {
  await validatePending(pending);
  let result;
  try{result=await api(pending.path,{body:pending.input});}
  catch(error){
    await statusPending(pending,{stage:error.applied===false?'REJECTED':'UNCERTAIN',error:{code:error.code,message:error.message,applied:error.applied,status:error.status}});
    showError(error);return;
  }
  sameWorkspace(result);
  if(result.requestId!==pending.input.requestId)throw new Error('The workspace replied with a different request identity. Check the retained save before continuing.');
  await statusPending(pending,{stage:'COMMITTED',result});
  await finishCommitted(pending);
}
async function checkSaved() {
  if(S.saving||!S.pending)return;S.saving=true;setBusy(true,'Checking the original save…');
  try{
    const pending=S.pending;await validatePending(pending);
    if(pending.status?.stage==='COMMITTED'){await finishCommitted(pending);return;}
    let value;
    try{value=await api(ROOT+'/operations/'+encodeURIComponent(pending.input.requestId));}
    catch(error){
      if(error.status===404&&error.code==='RUNBOOK_OPERATION_NOT_FOUND'){
        const existing=pending.status;
        await statusPending(pending,{stage:existing?.error?.applied===false?'REJECTED':'NOT_FOUND',error:existing?.error});
        notice('The original operation is not recorded. Its exact request remains retained; retry that save to settle the outcome.');
        return;
      }
      throw error;
    }
    sameWorkspace(value);const operation=value.operation;
    if(operation?.id!==pending.input.requestId||operation.kind!==pending.kind||operation.requestSha256!==pending.requestSha256)throw new Error('The saved operation does not match this exact request. Keep the retained request and resolve the identity mismatch before continuing.');
    if(operation.result?.requestId!==pending.input.requestId||operation.result?.workspaceId!==S.workspaceId)throw new Error('The operation receipt does not identify this workspace and request.');
    await statusPending(pending,{stage:'COMMITTED',result:operation.result});await finishCommitted(pending);
  }finally{S.saving=false;setBusy(false);}
}
async function retryPending() {
  if(S.saving||!S.pending)return;S.saving=true;setBusy(true,'Retrying the original save…');
  try{if(S.pending.status?.stage==='COMMITTED')await finishCommitted(S.pending);else await postPending(S.pending);}
  finally{S.saving=false;setBusy(false);}
}
async function finishCommitted(pending) {
  const result=pending.status?.result;
  if(!result||pending.status?.stage!=='COMMITTED')throw new Error('A committed operation receipt is required to complete this save.');
  sameWorkspace(result);
  const oldRevision=pending.input.revision,newRevision=result.revision,context=pending.context||{},action=pending.action;
  const draftEntries=[...(await savedEntries(key('author/'))),...(await savedEntries(key('work/'))),...(await savedEntries(key('submit/'))),...(await savedEntries(key('review/')))];
  const schedule=await readKey(key('schedule'));if(schedule)draftEntries.push([key('schedule'),schedule]);
  const updates=new Map(),remove=new Set();
  for(const [name,value]of draftEntries)if(value&&Object.prototype.hasOwnProperty.call(value,'baseRevision')&&value.baseRevision===oldRevision)updates.set(name,{...clone(value),baseRevision:newRevision});
  const values=new Map(draftEntries);
  if(action==='book'&&values.get(key('author/meta'))?.draftId===context.draftId){
    const meta=values.get(key('author/meta')),steps=meta.stepIds.map(id=>values.get(key('author/step/'+id))),resources=meta.resourceIds.map(id=>values.get(key('author/resource/'+id)));
    const projected=resources.every(Boolean)?resources.map(item=>({id:item.id,title:item.title,kind:item.kind,...(item.kind==='file'?{fileId:item.fileId}:item.kind==='link'?{url:item.url}:{text:item.text||''})})):null;
    if(canonical({name:meta.name,client:meta.client,description:meta.description,steps,resources:projected})===canonical({name:pending.input.name,client:pending.input.client,description:pending.input.description,steps:pending.input.steps,resources:pending.input.resources}))for(const [name]of draftEntries)if(name.startsWith(key('author/')))remove.add(name);
  }
  if(action==='cycle'&&schedule?.draftId===context.draftId&&['runbookId','editionId','label','preparer','reviewer','dueDate','handoffId','accountantRevisionId','periodCloseId','previousCycleId'].every(name=>(schedule[name]||'')===(pending.input[name]||'')))remove.add(key('schedule'));
  if(action==='work'){
    const name=workKey(context.cycleId,context.stepId),draft=values.get(name);
    if(draft?.draftId===context.draftId&&canonical({status:draft.status,note:draft.note,fileIds:draft.fileIds})===canonical({status:pending.input.status,note:pending.input.note,fileIds:pending.input.fileIds}))remove.add(name);
  }
  if(action==='submit'&&(!values.get(key('submit/'+context.cycleId))||values.get(key('submit/'+context.cycleId)).note===pending.input.note))remove.add(key('submit/'+context.cycleId));
  if(action==='review'){
    const draft=values.get(key('review/'+context.cycleId));
    if(!draft||canonical({decision:draft.decision,note:draft.note,acceptedExceptions:draft.decision==='APPROVE'?draft.acceptedExceptions:[]})===canonical({decision:pending.input.decision,note:pending.input.note,acceptedExceptions:pending.input.acceptedExceptions}))remove.add(key('review/'+context.cycleId));
  }
  if(action==='file'&&result.file){
    if(context.resourceId){
      const meta=values.get(key('author/meta')),name=key('author/resource/'+context.resourceId),resource=values.get(name);
      if(meta?.draftId===context.draftId&&resource?.kind==='file')updates.set(name,{...clone(resource),fileId:result.file.id});
    }
    if(context.cycleId&&context.stepId){
      const name=workKey(context.cycleId,context.stepId),draft=updates.get(name)||values.get(name);
      if(draft?.draftId===context.draftId)updates.set(name,{...clone(draft),fileIds:[...new Set([...(draft.fileIds||[]),result.file.id])],dirty:true,updatedAt:new Date().toISOString()});
    }
  }
  for(const name of remove)updates.delete(name);
  remove.add(key('pending'));remove.add(key('pending-status'));
  await writeBatch([...updates], [...remove]);
  S.pending=null;S.data.revision=newRevision;renderRecovery();paintLocks();announceOperation();
  const workspace=S.workspaceId;
  try{
    await refreshRoot();
    if(S.workspaceId!==workspace){showView('overview');notice('The save completed in the earlier workspace. The current local workspace is now open.');return;}
    if(action==='book'){S.author=null;await openBook(result.runbookId,result.editionId);}
    else if(action==='cycle'||action==='receive'){S.schedule=null;if(action==='receive'){$('receive-file').value='';put('receive-selection');}await openCycle(result.cycleId);}
    else if(['work','submit','review'].includes(action))await openCycle(result.cycleId||context.cycleId,context.stepId||S.stepId);
    else if(action==='file'){
      if(context.resourceId){S.author=await loadAuthor();if(S.view==='author')renderAuthor();}
      if(context.cycleId&&S.view==='cycle'&&S.cycleId===context.cycleId)await openCycle(context.cycleId,context.stepId);
    }
    notice(action==='book'?'Procedure edition saved.':action==='cycle'?'Period created with the selected procedure and accountant source.':action==='file'?'Document retained and attached to its saved draft.':action==='work'?'Task preparation saved.':action==='submit'?'Preparation submitted as a retained review round.':action==='review'?'Review decision saved.':'Handover received and opened with its original source.');
  }catch(error){notice('The save committed successfully. Refresh to load its current detail. '+error.message,true);}
}
function renderRecovery() {
  const panel=$('recovery'),pending=S.pending;panel.hidden=!pending;
  if(!pending){put(panel);return;}
  const status=pending.status||{},committed=status.stage==='COMMITTED',rejected=status.stage==='REJECTED'&&status.error?.applied===false;
  const title=committed?'Saved operation ready to reopen':rejected?'Save rejected before it was applied':'Original save retained';
  const message=committed?'The original committed result is saved. Complete its local recovery to reopen the current record.':rejected?'The workspace confirms that this request was not applied. Review the current source, then return its content to a draft for correction.':'Keep the original request identity while checking or retrying this save. A missing operation after a dropped connection can still be arriving.';
  const actions=el('div',{className:'actions'},button(committed?'Complete saved recovery':'Check saved result',checkSaved,{disabled:S.busy}),!committed?button('Retry original save',retryPending,{disabled:S.busy}):null,rejected?button('Review current source and correct',prepareCorrection,{disabled:S.busy}):null);
  put(panel,el('h2',{},title),el('p',{},message),status.error?el('p',{className:'small'},status.error.message):null,
    facts([['Operation',pending.kind],['Saved locally',when(pending.createdAt)]]),
    el('details',{className:'request-details'},el('summary',{},'Request identity'),facts([['Request',pending.input.requestId],['Original workspace revision',pending.input.revision],['Exact request SHA-256',pending.requestSha256]])),actions,el('div',{id:'correction-comparison'}));
}
async function prepareCorrection() {
  const pending=S.pending;if(!pending||pending.status?.error?.applied!==false)return;
  setBusy(true,'Loading current source for correction…');
  try{
    const workspace=S.workspaceId,current=sameWorkspace(await api(ROOT));let source=null;
    if(pending.action==='book'&&pending.input.runbookId)source=sameWorkspace(await api(ROOT+'/books/'+encodeURIComponent(pending.input.runbookId))).runbook;
    else if(['work','submit','review'].includes(pending.action))source=sameWorkspace(await api(cyclePath(pending.target))).cycle;
    if(S.workspaceId!==workspace||S.pending?.input.requestId!==pending.input.requestId)return;
    const comparison=$('correction-comparison'),nodes=[el('hr'),el('h3',{},'Current source to review'),el('p',{},'Your rejected content is retained. Continuing adopts the current workspace revision; review the current source below before saving a new request.')];
    if(source&&pending.action==='book'){
      const edition=source.editions.find(item=>item.id===source.latestEditionId);
      nodes.push(el('p',{},'Current latest procedure: edition '+edition.number+' · '+when(edition.createdAt)+'.'),el('details',{},el('summary',{},'Read the current saved procedure'),procedureNode(edition)));
    }else if(source){
      nodes.push(facts([['Period',source.label],['Current phase',PHASE[source.phase]||source.phase],['Preparer',source.preparer],['Reviewer',source.reviewer]]));
      if(pending.action==='work'){
        const step=source.edition.steps.find(item=>item.id===pending.input.stepId),work=source.work?.[pending.input.stepId]||{status:'PENDING',note:''};
        nodes.push(el('h4',{},step?.title||'Selected task'),tag(STATUS[work.status]||work.status),prose(work.note),fileList(work.fileIds));
      }else nodes.push(el('p',{},'The current saved preparation and its latest review round will reopen. Choose the decision again against that current work.'));
    }
    nodes.push(el('div',{className:'actions'},button('Use current source and return to draft',()=>returnToDraft(pending,current,source),{primary:true})));
    put(comparison,nodes);
  }finally{setBusy(false);}
}
async function returnToDraft(pending,current,source) {
  if(S.pending?.input.requestId!==pending.input.requestId||pending.status?.error?.applied!==false)throw new Error('An explicit unapplied response is required before correcting this request.');
  sameWorkspace(current);await flush();const changes=[],action=pending.action,context=pending.context||{};
  if(action==='book'){
    const meta=await readKey(key('author/meta'));
    if(meta?.draftId===context.draftId){meta.baseRevision=current.revision;if(source){meta.expectedEditionId=source.latestEditionId;changes.push([key('author/reference'),source.editions.find(item=>item.id===source.latestEditionId)]);}changes.push([key('author/meta'),meta]);}
  }else if(action==='cycle'){
    const draft=await readKey(key('schedule'));if(draft?.draftId===context.draftId)changes.push([key('schedule'),{...draft,baseRevision:current.revision}]);
  }else if(action==='work'){
    const name=workKey(context.cycleId,context.stepId),draft=await readKey(name);
    if(draft?.draftId===context.draftId)changes.push([name,{...draft,baseRevision:current.revision,original:clone(source?.work?.[context.stepId]||{status:'PENDING',note:'',fileIds:[]}),dirty:true}]);
  }else if(action==='submit'||action==='review'){
    const name=key(action+'/'+context.cycleId),draft=await readKey(name)||{};
    changes.push([name,{...draft,baseRevision:current.revision,...(action==='review'?{decision:'',acceptedExceptions:[]}:{})}]);
  }
  changes.push([key('rejected-operation/'+pending.input.requestId),{kind:pending.kind,target:pending.target,requestSha256:pending.requestSha256,createdAt:pending.createdAt,returnedToDraftAt:new Date().toISOString(),error:pending.status.error}]);
  await writeBatch(changes,[key('pending'),key('pending-status')]);S.pending=null;renderRecovery();announceOperation();S.data=current;
  if(action==='book')await resumeAuthor();
  else if(action==='cycle')await resumeSchedule();
  else if(['work','submit','review'].includes(action))await openCycle(context.cycleId,context.stepId);
  else if(action==='receive')showView('receive');
  else if(context.resourceId)await resumeAuthor();
  else if(context.cycleId)await openCycle(context.cycleId,context.stepId);
  paintLocks();notice('The rejected request was returned to its draft. Review the content and save a new request when ready.');
}
function bindEvents() {
  $('refresh').addEventListener('click',act(refreshCurrent));
  $('operator-name').addEventListener('input',event=>{S.actor=event.target.value;if(S.workspaceId)persist(key('actor'),S.actor).catch(()=>{});});
  $('new-runbook').addEventListener('click',act(()=>beginAuthor()));
  $('new-cycle').addEventListener('click',act(()=>startSchedule()));
  $('overview-new-cycle').addEventListener('click',act(()=>startSchedule()));
  for(const node of document.querySelectorAll('[data-go]'))node.addEventListener('click',act(()=>go(node.dataset.go)));
  for(const id of ['book-search','cycle-search'])$(id).addEventListener('input',renderNav);
  $('cycle-phase').addEventListener('change',renderNav);
  for(const [id,name]of [['author-name','name'],['author-client','client'],['author-description','description']])$(id).addEventListener('input',event=>{if(S.author){S.author.meta[name]=event.target.value;authorMetaChanged();}});
  $('add-resource').addEventListener('click',act(addResource));$('add-step').addEventListener('click',act(addStep));
  $('author-discard').addEventListener('click',act(discardAuthor));$('author-form').addEventListener('submit',act(saveEdition));
  $('schedule-book').addEventListener('change',act(async event=>{if(!S.schedule)return;S.schedule.runbookId=event.target.value;S.schedule.editionId='';saveScheduleDraft();await renderSchedule();}));
  $('schedule-edition').addEventListener('change',event=>{if(S.schedule){S.schedule.editionId=event.target.value;saveScheduleDraft();}});
  for(const [id,name]of [['schedule-label','label'],['schedule-due','dueDate'],['schedule-preparer','preparer'],['schedule-reviewer','reviewer']])$(id).addEventListener('input',event=>{if(S.schedule){S.schedule[name]=event.target.value;saveScheduleDraft();}});
  $('schedule-handoff').addEventListener('change',event=>{if(S.schedule){S.epoch++;S.schedule.handoffId=event.target.value;S.schedule.accountantRevisionId='';S.schedule.periodCloseId='';saveScheduleDraft();renderScheduleSources();}});
  $('schedule-accountant-revision').addEventListener('change',event=>{if(S.schedule){S.schedule.accountantRevisionId=event.target.value;saveScheduleDraft();renderScheduleSources();}});
  $('schedule-close').addEventListener('change',event=>{if(S.schedule){S.schedule.periodCloseId=event.target.value;saveScheduleDraft();renderScheduleSources();}});
  $('schedule-discard').addEventListener('click',act(discardSchedule));$('schedule-form').addEventListener('submit',act(saveCycle));
  $('receive-file').addEventListener('change',()=>{const file=$('receive-file').files[0];put('receive-selection',file?facts([['Selected file',file.name],['Size',bytes(file.size)]]):null);});
  $('receive-form').addEventListener('submit',act(receivePacket));
  if(broadcast)broadcast.onmessage=event=>{if(event.data?.workspaceId===S.workspaceId&&!S.busy)loadPending().then(pending=>{S.pending=pending;renderRecovery();paintLocks();}).catch(showError);};
}
async function boot() {
  bindEvents();paintLocks();setBusy(true,'Opening runbook workspace…');
  try{
    await openDb();await refreshRoot({restore:true});
    S.pending=await loadPending();renderRecovery();
    if(S.pending?.status?.stage==='COMMITTED'){await finishCommitted(S.pending);return;}
    const view=S.restoredView||{};
    if(view.view==='author'&&await readKey(key('author/meta')))await resumeAuthor();
    else if(view.view==='schedule'&&await readKey(key('schedule')))await resumeSchedule();
    else if(view.view==='book'&&view.bookId)await openBook(view.bookId,view.editionId);
    else if(view.view==='cycle'&&view.cycleId)await openCycle(view.cycleId,view.stepId);
    else showView(view.view==='receive'?'receive':'overview',{remember:false});
  }catch(error){
    if(!S.workspaceId)S.connected=false;
    if(/storage|IndexedDB|Quota/i.test(error?.name+' '+error?.message))S.storageError=error;
    showError(error);
  }finally{setBusy(false);paintLocks();}
}
boot();
