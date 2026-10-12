const $ = id => document.getElementById(id);
const API = '/api/portfolio';
const clone = value => structuredClone(value);
const uuid = () => crypto.randomUUID();
const short = value => String(value || '').slice(0,12);
const text = value => value === null || value === undefined || value === '' ? '—' : String(value);
const human = value => String(value || '').replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase());
const formatDate = value => value ? String(value).slice(0,10) : '—';
const formatTime = value => value ? new Date(value).toLocaleString() : '—';
const bytes = value => Number.isSafeInteger(Number(value)) ? new Intl.NumberFormat().format(Number(value)) + ' bytes' : '—';
const minutes = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(Number(value)) + ' min' : '—';
const cleanId = prefix => prefix + '-' + uuid().slice(0,12);
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',') + '}';
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value === 'string' ? value : canonical(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');
const dateInput = value => value ? String(value).slice(0,10) : '';
const state = {
  view:'overview',root:null,workspaceId:null,revision:null,epoch:0,
  db:null,storageReady:false,pending:null,busy:false,requests:new Map(),sources:new Map(),
  selectedClient:null,clientDetail:null,clientDraft:null,clientLoad:0,
  selectedPlan:null,planDetail:null,planDraft:null,planPreview:null,planLoad:0,
  selectedCommand:null,commandDetail:null,commandLoad:0,
  selectedReceived:null,receivedDetail:null,receivedLoad:0,
  firmDraft:null,firmLoaded:false,live:null,receiveSelection:null,receiveInspection:null,
  draftWrites:new Map(),draftTimers:new Map(),rootTicket:0,disposed:false
};
const el = (tag,attrs={},...children) => {
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attrs||{})){
    if(value===undefined||value===null||value===false)continue;
    if(key==='class')node.className=value;
    else if(key==='text')node.textContent=value;
    else if(key==='dataset')Object.assign(node.dataset,value);
    else if(key.startsWith('on')&&typeof value==='function')node.addEventListener(key.slice(2),value);
    else if(key==='checked'||key==='disabled'||key==='required'||key==='readOnly'||key==='multiple')node[key]=Boolean(value);
    else if(key==='value')node.value=value;
    else node.setAttribute(key,value===true?'':String(value));
  }
  for(const child of children.flat(Infinity)){
    if(child===null||child===undefined||child===false)continue;
    node.append(child instanceof Node?child:document.createTextNode(String(child)));
  }
  return node;
};
const put = (target,...children) => {const node=typeof target==='string'?$(target):target;node.replaceChildren(...children.flat().filter(Boolean));return node;};
const btn = (label,action,attrs={}) => el('button',{type:'button',...attrs,onclick:guard(action)},label);
const tag = value => el('span',{class:'tag'},human(value));
const empty = message => el('div',{class:'empty'},message);
const help = message => el('p',{class:'field-note'},message);
const link = (label,href,attrs={}) => el('a',{href,...attrs},label);
const actions = (...children) => el('div',{class:'actions'},...children);
const panel = (title,...children) => el('section',{class:'panel'},title?el('h3',{},title):null,...children);
const field = (label,control,hint) => el('label',{},label,control,hint?el('small',{},hint):null);
const input = (value='',attrs={}) => el('input',{value,...attrs});
const textarea = (value='',attrs={}) => el('textarea',{rows:4,...attrs},value);
const options = (items,selected,placeholder='Choose…') => {
 const select=el('select',{});
 if(placeholder!==null)select.append(el('option',{value:''},placeholder));
 for(const row of items)select.append(el('option',{value:row.value,selected:row.value===selected},row.label));
 select.value=selected??'';return select;
};
const choose = (items,selected,placeholder,change) => {const node=options(items,selected,placeholder);if(change)node.addEventListener('change',()=>change(node.value));return node;};
const check = (label,checked,change) => {const node=input('',{type:'checkbox',checked});if(change)node.addEventListener('change',()=>change(node.checked));return el('label',{class:'check'},node,el('span',{},label));};
const recordFacts = rows => el('dl',{class:'detail-grid'},...rows.flatMap(([label,value])=>[el('dt',{},label),el('dd',{},value instanceof Node?value:text(value))]));
const facts = rows => rows.map(([label,value])=>el('dl',{class:'fact'},el('dt',{},label),el('dd',{},text(value))));
function table(headers,rows){
 if(!rows.length)return empty('No entries for this selection.');
 return el('div',{class:'table-scroll',tabindex:0},el('table',{},el('thead',{},el('tr',{},...headers.map(h=>el('th',{scope:'col'},h)))),el('tbody',{},...rows.map(row=>el('tr',{},...row.map(value=>el('td',{},value instanceof Node?value:text(value))))))));
}
function guard(fn){return async event=>{try{await fn(event);}catch(error){notice(error.message||String(error),true);}};}
function notice(message,error=false){const node=$('notice');node.className='notice'+(error?' error':'');put(node,el('p',{},message));}
function clearNotice(){$('notice').classList.add('hidden');}
function assertWrite(){
 if(!state.workspaceId)throw Error('Open the current accounting workspace first.');
 if(!state.storageReady)throw Error('The browser has not retained its private request storage. Reopen the page or free browser storage before saving.');
 if(state.pending)throw Error('Reconcile the retained operation before preparing another save.');
 if(state.busy)throw Error('The current operation is still being received.');
 const actor=$('operator-name').value.trim();
 if(!actor)throw Error('Enter the operator name for this retained change.');
 return actor;
}
function writable(node){node.dataset.write='true';node.disabled=state.busy||Boolean(state.pending)||!state.storageReady;return node;}
function refreshWrites(){
 document.querySelectorAll('form').forEach(form=>{form.inert=state.busy||Boolean(state.pending);});
 document.querySelectorAll('[data-write]').forEach(node=>{node.disabled=state.busy||Boolean(state.pending)||!state.storageReady||node.dataset.unavailable==='true';});
 $('receive-form').querySelector('button[type=submit]').disabled=state.busy||Boolean(state.pending)||!state.storageReady;
 $('firm-form').querySelector('button[type=submit]').disabled=state.busy||Boolean(state.pending)||!state.storageReady;
}
async function api(route,{method='GET',body,signal}={}){
 const response=await fetch(API+route,{method,signal,credentials:'same-origin',headers:body===undefined?{Accept:'application/json'}:{Accept:'application/json','Content-Type':'application/json','x-workspace-request':'1'},body:body===undefined?undefined:JSON.stringify(body)});
 let value;
 try{value=await response.json();}catch{throw Object.assign(Error('The operator returned an unreadable response. The exact request remains available for reconciliation.'),{status:response.status});}
 if(!response.ok||value?.error){
  const detail=typeof value.error==='object'?value.error:value;
  throw Object.assign(Error(detail.message||value.message||'The operator could not complete this request.'),{status:response.status,code:typeof value.error==='string'?value.error:detail.code,applied:detail.applied??value.applied,value});
 }
 return value;
}
async function read(route,{key=route,expectedWorkspace=state.workspaceId}={}){
 const ticket=uuid(),epoch=state.epoch;
 state.requests.set(key,ticket);
 const value=await api(route);
 if(state.disposed||epoch!==state.epoch||state.requests.get(key)!==ticket)return null;
 if(expectedWorkspace&&value.workspaceId&&value.workspaceId!==expectedWorkspace)throw Error('The connected accounting workspace changed. Refresh its identity before continuing.');
 return value;
}
function coordinator(value){
 if(value?.workspaceId&&value.workspaceId!==state.workspaceId)throw Error('The response belongs to another accounting workspace. Refresh and use its own saved operation.');
 if(value?.revision)state.revision=value.revision;
}
const draftKey = scope => state.workspaceId+'::'+scope;
async function openStorage(){
 const db=await new Promise((resolve,reject)=>{
  const request=indexedDB.open('merchant-accounting-portfolio-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('private',{keyPath:'key'});
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||Error('Private browser storage could not open.'));
  request.onblocked=()=>reject(Error('Close the older portfolio tab so its browser storage can open.'));
 });
 db.onversionchange=()=>{db.close();state.storageReady=false;$('draft-storage-status').textContent='Private storage changed. Reopen this page before saving.';refreshWrites();};
 state.db=db;state.storageReady=true;$('draft-storage-status').textContent='Drafts and exact pending requests stay in this browser.';refreshWrites();
}
function dbGet(key){return new Promise((resolve,reject)=>{const tx=state.db.transaction('private','readonly'),request=tx.objectStore('private').get(key);request.onsuccess=()=>resolve(request.result?.value);request.onerror=()=>reject(request.error);});}
function dbPut(key,value){return new Promise((resolve,reject)=>{const tx=state.db.transaction('private','readwrite');tx.objectStore('private').put({key,value});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Private storage write was interrupted.'));});}
function dbDelete(key){return new Promise((resolve,reject)=>{const tx=state.db.transaction('private','readwrite');tx.objectStore('private').delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
async function loadDraft(scope){if(!state.storageReady||!state.workspaceId)return null;return (await dbGet(draftKey('draft:'+scope)))||null;}
function saveDraft(scope,value){
 if(!state.storageReady||!state.workspaceId)return;
 const key=draftKey('draft:'+scope),captured=clone(value),workspaceId=state.workspaceId;
 clearTimeout(state.draftTimers.get(key));
 const timer=setTimeout(()=>{
  state.draftTimers.delete(key);
  const promise=dbPut(key,{workspaceId,updatedAt:new Date().toISOString(),value:captured});
  state.draftWrites.set(key,promise);
  promise.then(()=>{$('draft-storage-status').textContent='Drafts saved privately at '+new Date().toLocaleTimeString();}).catch(error=>{state.storageReady=false;notice('The current draft could not be saved: '+error.message,true);refreshWrites();}).finally(()=>state.draftWrites.delete(key));
 },250);
 state.draftTimers.set(key,timer);
}
async function clearDraft(scope){if(state.storageReady){const key=draftKey('draft:'+scope);clearTimeout(state.draftTimers.get(key));state.draftTimers.delete(key);const pending=state.draftWrites.get(key);if(pending)await pending;await dbDelete(key);}}
const pendingMatches=(left,right)=>Boolean(left&&right&&left.workspaceId===right.workspaceId&&left.id===right.id&&left.mode===right.mode&&left.route===right.route&&left.requestSha256===right.requestSha256&&left.commandSha256===right.commandSha256&&canonical(left.body)===canonical(right.body));
let pendingChannel=null;
try{if(typeof BroadcastChannel==='function')pendingChannel=new BroadcastChannel('merchant-accounting-portfolio-v1');}catch{}
function announcePending(workspaceId){pendingChannel?.postMessage({workspaceId});}
function pendingStore(value,remove=false){
 return new Promise((resolve,reject)=>{
  const tx=state.db.transaction('private','readwrite'),records=tx.objectStore('private'),key=value.workspaceId+'::pending',request=records.get(key);let selected;
  request.onsuccess=()=>{
   const existing=request.result?.value;
   if(remove){if(pendingMatches(existing,value)){records.delete(key);selected=null;}else selected=existing||null;}
   else if(existing&&!pendingMatches(existing,value))selected=existing;
   else{selected=existing||value;records.put({key,value:selected});}
  };
  tx.oncomplete=()=>resolve(selected);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Private request storage was interrupted.'));
 });
}
async function savePending(value){
 if(!state.storageReady)throw Error('Private request storage is unavailable.');
 const selected=await pendingStore(value);
 announcePending(value.workspaceId);
 if(state.workspaceId===value.workspaceId){state.pending=selected;renderPending();refreshWrites();}
 if(!pendingMatches(selected,value))throw Error('Another tab has already retained a different operation for this workspace. Reconcile that original request before preparing this change.');
 if(state.workspaceId!==value.workspaceId)throw Error('The request is retained in its original workspace. Reopen that workspace to reconcile or replay it.');
}
async function removePending(value){
 const remaining=await pendingStore(value,true);announcePending(value.workspaceId);
 if(state.workspaceId===value.workspaceId){state.pending=remaining;renderPending();refreshWrites();}
 return remaining;
}
async function clearPending(){if(state.pending)await removePending(state.pending);}
if(pendingChannel)pendingChannel.onmessage=event=>{
 const workspaceId=event.data?.workspaceId;
 if(!state.storageReady||!workspaceId||workspaceId!==state.workspaceId||state.busy)return;
 dbGet(workspaceId+'::pending').then(value=>{if(state.workspaceId===workspaceId&&!state.busy){state.pending=value||null;renderPending();refreshWrites();}}).catch(error=>notice(error.message,true));
};
function setBusy(value){state.busy=value;document.body.setAttribute('aria-busy',String(value));refreshWrites();}
function discardRenderedState(){
 for(const id of ['client-detail','plan-detail','command-detail','received-detail'])put(id,empty('Select an item from this workspace.'));
 for(const id of ['client-list','plan-list','command-list','capture-list','received-list','overview-live','receive-preview'])put(id);
 state.selectedClient=state.selectedPlan=state.selectedCommand=state.selectedReceived=null;
 state.clientDetail=state.planDetail=state.commandDetail=state.receivedDetail=null;
 state.clientDraft=state.planDraft=state.firmDraft=state.commandDraft=null;state.planPreview=null;state.firmLoaded=false;state.captureDraft=null;state.adoptDrafts={};
 for(const id of ['firm-name','firm-cadence','firm-close-standard','firm-reporting-standard','firm-escalation'])$(id).value='';
 for(const id of ['staff-list','overview-plans','overview-attention','overview-facts','export-form'])put(id);
 $('firm-edition').textContent='';$('firm-draft-status').textContent='';$('operator-name').value='';
 state.sources.clear();state.requests.clear();state.live=null;
 state.receiveSelection=null;state.receiveInspection=null;$('receive-file').value='';put('receive-file-info');
}
async function refreshRoot({initial=false}={}){
 const ticket=++state.rootTicket,value=await api('');
 if(ticket!==state.rootTicket)return null;
 if(!value.workspaceId||!value.revision)throw Error('The portfolio did not return its original workspace identity and revision.');
 const changed=Boolean(state.workspaceId&&state.workspaceId!==value.workspaceId);
 if(changed){state.epoch++;discardRenderedState();notice('A different accounting workspace is now open. Its own client records and private drafts are shown.');}
 state.workspaceId=value.workspaceId;state.revision=value.revision;state.root=value;
 if(initial||changed){state.pending=state.storageReady?await dbGet(draftKey('pending')):null;const actor=state.storageReady?await dbGet(draftKey('actor')):null;if(actor)$('operator-name').value=actor;const capture=await loadDraft('capture');state.captureDraft=clone(capture?.value||{label:'',clients:[]});}
 $('connection-status').textContent=(value.firm?.name||'Firm settings are ready to configure')+' · Current portfolio received '+new Date().toLocaleTimeString();
 $('workspace-identity').textContent='Workspace '+short(value.workspaceId)+' · revision '+short(value.revision);
 renderOverview();renderClientList();renderPlanList();renderCommandList();renderReceivingLists();renderExportForm();renderPending();refreshWrites();
 if(state.view==='firm'&&!state.firmLoaded)await loadFirm();
 return value;
}
function setView(name){
 if(!['overview','firm','clients','calendar','commands','receiving'].includes(name))return;
 state.view=name;
 const workspaceId=state.workspaceId;
 queueMicrotask(()=>{if(state.storageReady&&workspaceId&&state.workspaceId===workspaceId)dbPut(workspaceId+'::navigation',{view:state.view,clientId:state.selectedClient,planId:state.selectedPlan,commandId:state.selectedCommand,receivedId:state.selectedReceived}).catch(error=>notice(error.message,true));});
 document.querySelectorAll('.view').forEach(node=>node.classList.toggle('hidden',node.id!=='view-'+name));
 document.querySelectorAll('[data-view]').forEach(node=>node.getAttribute('data-view')===name?node.setAttribute('aria-current','page'):node.removeAttribute('aria-current'));
 if(name==='firm'&&!state.firmLoaded)guard(loadFirm)();
 if(name==='overview'&&!state.live)guard(loadLive)();
}
function sourceRoute(alias){return '/sources/'+encodeURIComponent(alias);}
function clientRunbooks(alias){return '/portfolio/clients/'+encodeURIComponent(alias)+'/runbooks.html';}
function clientName(id){const row=state.root?.clients?.find(x=>x.id===id);return row?.commission?.name||row?.name||short(id);}
function people(){return state.root?.firm?.staff||state.root?.staff||[];}
function personName(id){return people().find(x=>x.id===id)?.name||id||'—';}
function personOptions(placeholder){return people().map(x=>({value:x.id,label:x.name}));}
function currentCommission(row){return row?.commission||null;}
function aliasOptions(){
 return (state.root?.clientAliases||[]).map(row=>typeof row==='string'?{value:row,label:row}:{value:row.alias,label:row.name?row.name+' · '+row.alias:row.alias});
}
async function loadSources(alias,{refresh=false}={}){
 if(!alias)return null;
 if(!refresh&&state.sources.has(alias))return state.sources.get(alias);
 const value=await read(sourceRoute(alias),{key:'source:'+alias});
 if(value){if(!value.source)throw Error('The original client source response is incomplete.');state.sources.set(alias,value.source);}
 return value?.source||null;
}
function fileChoices(files,selected,change){
 const list=el('div',{class:'resource-list'});
 if(!files?.length)return empty('No retained files are available in this client workspace.');
 const chosen=new Set(selected||[]);
 for(const file of files){
  const label=el('span',{},file.name||file.id,el('span',{class:'file-info'},bytes(file.bytes)+' · '+short(file.sha256)));
  list.append(check(label,chosen.has(file.id),checked=>{if(checked)chosen.add(file.id);else chosen.delete(file.id);change([...chosen]);}));
 }
 return list;
}
function renderOverview(){
 const root=state.root||{},clients=root.clients||[],plans=root.plans||[],commands=root.commands||[];
 put('overview-facts',...facts([['Commissioned clients',clients.length],['Published plans',plans.length],['Named people',people().length],['Retained operations',commands.length]]));
 put('overview-plans',plans.length?el('div',{class:'list'},...plans.slice(0,8).map(plan=>listButton(plan.label||short(plan.id),[formatDate(plan.startDate),formatDate(plan.endDate)],()=>openPlan(plan.id)))):empty('Publish the first close plan after configuring the firm and clients.'));
 const attention=commands.filter(row=>row.current!==false);
 put('overview-attention',attention.length?el('div',{class:'list'},...attention.slice().reverse().slice(0,10).map(row=>listButton(commandLabels[row.action]||human(row.action),[clientName(row.clientId),formatTime(row.createdAt)],()=>openCommand(row.id)))):empty('Retained execution requests appear here after an original client operation is prepared.'));
 if(!state.live)put('overview-live',empty('Read the current original client workspaces to review their receiving state.'));
}
function listButton(title,metadata,action,selected=false){
 return el('div',{class:'list-item'+(selected?' selected':'')},btn(el('span',{},el('span',{class:'title'},title),el('span',{class:'meta'},...metadata.filter(Boolean).map(value=>el('span',{},value)))),action,{class:'list-select'}));
}
async function loadLive(){
 const value=await read('/live',{key:'live'});
 if(!value)return;state.live=value;
 const rows=value.clients||value.items||[];
 put('overview-live',rows.length?table(['Client workspace','Workspace state','Original revision','Current work'],rows.map(row=>[
  row.name||row.alias,
  row.error?row.error.message||row.error:(row.available?'Available':'Unavailable'),
  short(row.clientRevision||row.revision),
  row.alias?link('Open original Runbooks',clientRunbooks(row.alias),{target:'_blank',rel:'noopener'}):'—'
 ])):empty('The original coordinator has no mounted client workspaces yet.'));
}

const mutationKinds={settings:'configured',client:'commissioned',plan:'scheduled',prepare:'command_prepared',capture:'captured',receive:'received',adopt:'adopted'};
async function prepareMutation({type,route,fields,scope,title}){
 const actor=assertWrite(),workspaceId=state.workspaceId;
 const body={...clone(fields),workspaceId,revision:state.revision,requestId:uuid(),actor};
 const kind='portfolio_'+mutationKinds[type],target=null;
 if(!mutationKinds[type])throw Error('The original portfolio operation is not defined.');
 let pending;setBusy(true);
 try{
  const requestSha256=await digest({kind,target,input:body});
  if(state.workspaceId!==workspaceId)throw Error('The coordinator changed before this request was retained. Review its current workspace before saving.');
  pending={mode:'coordinator',id:body.requestId,workspaceId,route,type,scope,title,kind,target,body,requestSha256,createdAt:new Date().toISOString()};
  await savePending(pending);
 }finally{setBusy(false);}
 return performPending(pending);
}
async function finishPending(pending,result){
 if(result.workspaceId&&result.workspaceId!==pending.workspaceId)throw Error('The saved result belongs to another coordinator workspace.');
 await dbPut(pending.workspaceId+'::result:'+pending.id,{pendingId:pending.id,at:new Date().toISOString(),result});
 const owned=state.workspaceId===pending.workspaceId&&state.pending?.id===pending.id;
 await removePending(pending);
 if(!owned||state.workspaceId!==pending.workspaceId)return;
 if(pending.scope)await clearDraft(pending.scope);
 await refreshRoot();
 if(pending.type==='settings'){state.firmLoaded=false;await loadFirm();setView('firm');}
 else if(pending.type==='client'&&result.clientId)await openClient(result.clientId);
 else if(pending.type==='plan'&&result.planId)await openPlan(result.planId);
 else if(pending.type==='prepare'&&result.commandId)await openCommand(result.commandId);
 else if(pending.type==='execute')await openCommand(pending.commandId);
 else if(pending.type==='receive'){
   await dbDelete(draftKey('receive-file'));
   state.receiveSelection=null;state.receiveInspection=null;$('receive-file').value='';put('receive-file-info');put('receive-preview');
   if(result.receivedId)await openReceived(result.receivedId);else setView('receiving');
 } else if(pending.type==='adopt'){await loadLive();setView('overview');}
 else if(pending.type==='capture'){state.captureDraft={label:'',clients:[]};renderExportForm();setView('receiving');}
 notice(pending.title+' is retained in the original workspace.');
}
async function performPending(pending=state.pending){
 if(!pending||state.busy)return;
 if(state.workspaceId!==pending.workspaceId)throw Error('Open this retained request’s original coordinator workspace before continuing.');
 setBusy(true);clearNotice();
 try{
  const value=await api(pending.route,{method:'POST',body:pending.body});
  if(pending.mode==='client'){
   if(value.commandId!==pending.commandId||value.commandSha256!==pending.commandSha256)throw Error('The native result does not match the selected saved request.');
  }else if(value.requestId!==pending.id)throw Error('The coordinator did not return this exact saved request identity.');
  await finishPending(pending,value);
 }catch(error){
  if(error.applied===false){
   await removePending(pending);
   if(state.workspaceId===pending.workspaceId)await refreshRoot();
   notice(error.message+' The original input is still available to correct and prepare again.',true);
  }else notice(error.message+' Keep this retained request and reconcile or replay its exact bytes.',true);
 }finally{setBusy(false);renderPending();}
}
async function reconcilePending(){
 const pending=state.pending;if(!pending||state.busy)return;
 if(state.workspaceId!==pending.workspaceId)throw Error('Reopen the retained request’s original coordinator workspace.');
 setBusy(true);
 try{
  if(pending.mode==='client'){
   const value=await api('/commands/'+encodeURIComponent(pending.commandId)+'/result');
   if(value.commandId!==pending.commandId||value.commandSha256!==pending.commandSha256)throw Error('The original command identity changed.');
   if(value.found){await finishPending(pending,value);return;}
   notice('This exact native request has no saved result yet. Replay the retained request when ready.');return;
  }
  let value;
  try{value=await api('/operations/'+encodeURIComponent(pending.id));}
  catch(error){if(error.code==='RUNBOOK_OPERATION_NOT_FOUND'||error.status===404){notice('The coordinator has no saved result for this exact request yet. It remains retained for exact replay.');return;}throw error;}
  const operation=value.operation;
  if(value.workspaceId!==pending.workspaceId||operation?.id!==pending.id||operation.kind!==pending.kind||(operation.target??null)!==pending.target||operation.requestSha256!==pending.requestSha256)throw Error('The retained operation does not match this complete original request. Keep the saved request and open the original workspace.');
  await finishPending(pending,operation.result);
 }finally{setBusy(false);renderPending();}
}
function renderPending(){
 const container=$('pending-operation'),p=state.pending;
 container.classList.toggle('hidden',!p);
 if(!p){put(container);return;}
 put(container,el('h2',{id:'pending-title'},'Retained operation: '+p.title),
  el('p',{},'This complete request is saved privately. Reconcile its original result before preparing another change.'),
  recordFacts([['Prepared',formatTime(p.createdAt)],['Workspace',short(p.workspaceId)],['Request',short(p.id)],['Operation',human(p.type)]]),
  actions(btn('Reconcile saved result',reconcilePending,{disabled:state.busy}),btn('Replay exact request',()=>performPending(p),{disabled:state.busy})),
  el('details',{},el('summary',{},'Original request identity'),recordFacts([['Request ID',p.id],['Full request hash',p.requestSha256||p.commandSha256],['Original destination',p.route]])));
}
function draftStatus(id,source){
 const node=$(id);if(node)node.textContent=source?'Private draft · '+formatTime(source.updatedAt):'Using the current saved edition.';
}
function attachDraft(form,scope,getValue,onChange){
 const save=()=>{if(onChange)onChange();saveDraft(scope,getValue());};
 form.addEventListener('input',save);form.addEventListener('change',save);
}
async function childApi(alias,route){
 const response=await fetch('/portfolio/clients/'+encodeURIComponent(alias)+'/api/runbooks'+route,{credentials:'same-origin',headers:{Accept:'application/json'}});
 let value;try{value=await response.json();}catch{throw Error('The original client desk returned an unreadable response.');}
 if(!response.ok||value.error)throw Object.assign(Error(value.message||value.error?.message||'The original client detail could not be read.'),{code:typeof value.error==='string'?value.error:value.error?.code,status:response.status});
 const source=state.sources.get(alias);
 if(source&&value.workspaceId!==source.clientWorkspaceId)throw Error('The mounted alias now opens another client workspace. Refresh its source before continuing.');
 return value;
}
function canonicalFirm(){const firm=state.root?.firm;return {expectedFirmEditionId:firm?.id??null,firm:{name:firm?.name||'',closeStandard:firm?.closeStandard||'',reportingStandard:firm?.reportingStandard||'',reportingCadence:firm?.reportingCadence||'',escalationNote:firm?.escalationNote||''},staff:clone(firm?.staff||[])};}
function readFirmForm(){
 const base=clone(state.firmDraft||canonicalFirm());
 base.firm={name:$('firm-name').value,reportingCadence:$('firm-cadence').value,closeStandard:$('firm-close-standard').value,reportingStandard:$('firm-reporting-standard').value,escalationNote:$('firm-escalation').value};
 return base;
}
async function loadFirm({saved=false}={}){
 const draft=saved?null:await loadDraft('firm');
 state.firmDraft=clone(draft?.value||canonicalFirm());state.firmLoaded=true;
 const firm=state.firmDraft.firm;
 for(const [id,key] of [['firm-name','name'],['firm-cadence','reportingCadence'],['firm-close-standard','closeStandard'],['firm-reporting-standard','reportingStandard'],['firm-escalation','escalationNote']])$(id).value=firm[key]||'';
 $('firm-edition').textContent=state.firmDraft.expectedFirmEditionId?'Editing edition '+short(state.firmDraft.expectedFirmEditionId):'First firm edition';
 draftStatus('firm-draft-status',draft);renderStaff();
}
function updateFirmDraft(){const value=readFirmForm();if(state.firmDraft)state.firmDraft.firm=value.firm;else state.firmDraft=value;saveDraft('firm',state.firmDraft);$('firm-draft-status').textContent='Private draft';}
function renderStaff(){
 const rows=state.firmDraft?.staff||[];
 put('staff-list',rows.length?rows.map((person,index)=>{
  const patch=(field,value)=>{person[field]=value;updateFirmDraft();};
  const name=input(person.name,{maxlength:160,required:true,oninput:event=>patch('name',event.target.value)});
  const capacity=input(person.minutesPerDay??'',{type:'number',min:0,max:1440,step:1,required:true,oninput:event=>patch('minutesPerDay',event.target.value===''?null:Number(event.target.value))});
  const dayLabels=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const days=el('div',{class:'weekdays'},...dayLabels.map((label,day)=>check(label,(person.workingDays||[]).includes(day),checked=>{
   const chosen=new Set(person.workingDays||[]);checked?chosen.add(day):chosen.delete(day);patch('workingDays',[...chosen].sort());
  })));
  const holidays=el('div',{class:'date-list'});
  const drawHolidays=()=>put(holidays,...(person.holidays||[]).map((day,n)=>el('div',{class:'date-row'},input(day,{type:'date',required:true,onchange:event=>{person.holidays[n]=event.target.value;updateFirmDraft();}}),btn('Remove',()=>{person.holidays.splice(n,1);updateFirmDraft();drawHolidays();}))));
  drawHolidays();
  const leave=el('div',{class:'date-list'});
  const drawLeave=()=>put(leave,...(person.timeOff||[]).map((away,n)=>el('div',{class:'leave-row'},
   field('From',input(away.from,{type:'date',required:true,onchange:event=>{away.from=event.target.value;updateFirmDraft();}})),
   field('To',input(away.to,{type:'date',required:true,onchange:event=>{away.to=event.target.value;updateFirmDraft();}})),
   field('Time-away note',input(away.note||'',{maxlength:1000,oninput:event=>{away.note=event.target.value;updateFirmDraft();}})),
   btn('Remove',()=>{person.timeOff.splice(n,1);updateFirmDraft();drawLeave();})
  )));
  drawLeave();
  return el('section',{class:'person-card'},el('div',{class:'person-heading'},el('h4',{},'Person '+(index+1)),btn('Remove person',()=>{state.firmDraft.staff.splice(index,1);updateFirmDraft();renderStaff();})),
   el('div',{class:'form-grid two'},field('Name',name),field('Available minutes per working day',capacity,'Enter this portfolio’s allocated time, from 0 to 1,440 minutes.')),
   el('fieldset',{},el('legend',{},'Working days'),days),
   el('details',{},el('summary',{},'Holidays and time away'),
    el('h4',{},'Individual holiday dates'),holidays,btn('Add holiday',()=>{(person.holidays??=[]).push('');updateFirmDraft();drawHolidays();},{class:'muted-button'}),
    el('h4',{},'Time-away intervals'),leave,btn('Add time away',()=>{(person.timeOff??=[]).push({from:'',to:'',note:''});updateFirmDraft();drawLeave();},{class:'muted-button'})),
   el('details',{},el('summary',{},'Stable person identity'),el('p',{class:'identity'},person.id)));
 }):empty('Add the actual people responsible for this portfolio. Their names and available time drive the close calendar.'));
 refreshWrites();
}
function renderClientList(){
 const query=$('client-search').value.trim().toLowerCase(),rows=(state.root?.clients||[]).filter(row=>(row.commission?.name+' '+row.commission?.alias).toLowerCase().includes(query));
 put('client-list',rows.length?rows.map(row=>listButton(row.commission?.name||short(row.id),[row.commission?.alias,human(row.commission?.status)],()=>openClient(row.id),state.selectedClient===row.id)):empty(query?'No clients match this search.':'No clients are commissioned yet.'));
}
async function openClient(id){
 setView('clients');state.selectedClient=id;state.clientDetail=null;state.clientDraft=null;
 const ticket=++state.clientLoad;put('client-detail',empty('Opening the original client commission…'));renderClientList();
 const value=await read('/clients/'+encodeURIComponent(id),{key:'client-detail'});
 if(!value||ticket!==state.clientLoad||state.selectedClient!==id)return;
 state.clientDetail=value.client;renderClientDetail();
}
function renderClientDetail(){
 const client=state.clientDetail;if(!client)return;
 const commission=client.commissions.find(row=>row.id===client.latestCommissionId);
 const history=client.commissions.slice().reverse();
 put('client-detail',panel(commission.name,
  el('div',{class:'section-heading'},tag(commission.status),actions(btn('Edit commissioning',()=>editClient(client.id)),link('Open original Runbooks',clientRunbooks(commission.alias),{target:'_blank',rel:'noopener'}))),
  recordFacts([['Client alias',commission.alias],['Preparer',personName(commission.preparerId)],['Backup',personName(commission.backupId)],['Reviewer',personName(commission.reviewerId)],['Procedure edition',short(commission.editionId)],['Client workspace',short(commission.clientWorkspaceId)],['Source revision',short(commission.clientRevision)]])),
  ...[['Commissioned scope','scope'],['Source gaps','sourceGaps'],['Reporting instructions','reportingInstructions'],['Escalation instructions','escalationInstructions'],['Readiness note','readinessNote']].filter(([,key])=>commission[key]).map(([label,key])=>panel(label,el('p',{class:'instructions'},commission[key]))),
  panel('Commissioning history',table(['Saved','Status','Operator','Procedure edition'],history.map(row=>[formatTime(row.createdAt),human(row.status),row.actor,short(row.editionId)]))),
  panel('Close planning',help('A published plan binds this exact commissioning edition and its selected client sources.'),btn('Add this client to a new plan',()=>newPlan({clientId:client.id})))
 );
}
async function editClient(id=null){
 setView('clients');state.selectedClient=id;state.clientDetail=null;const ticket=++state.clientLoad;
 put('client-detail',empty('Opening the client commissioning form…'));renderClientList();
 let current=null;
 if(id){const value=await read('/clients/'+encodeURIComponent(id),{key:'client-edit'});if(!value||ticket!==state.clientLoad)return;current=value.client.commissions.find(row=>row.id===value.client.latestCommissionId);}
 const stored=await loadDraft('client:'+(id||'new'));if(ticket!==state.clientLoad)return;
 state.clientDraft=clone(stored?.value||{clientId:id,expectedCommissionId:current?.id,alias:current?.alias||'',clientWorkspaceId:current?.clientWorkspaceId||'',clientRevision:current?.clientRevision||'',name:current?.name||'',runbookId:current?.runbookId||'',editionId:current?.editionId||'',preparerId:current?.preparerId||'',backupId:current?.backupId||'',reviewerId:current?.reviewerId||'',scope:current?.scope||'',sourceGaps:current?.sourceGaps||'',reportingInstructions:current?.reportingInstructions||'',escalationInstructions:current?.escalationInstructions||'',readinessNote:current?.readinessNote||'',status:current?.status||'DISCOVERY'});
 await renderClientForm(stored);
}
async function renderClientForm(stored){
 const draft=state.clientDraft;if(!draft)return;
 const scope='client:'+(draft.clientId||'new'),form=el('form',{class:'stack'}),sourceBox=el('div',{class:'stack'}),readiness=el('p',{class:'source-status quiet'});
 const mutate=(key,value)=>{draft[key]=value;saveDraft(scope,draft);};
 const alias=choose(aliasOptions(),draft.alias,'Choose an original workspace',value=>{
  sourceTicket++;mutate('alias',value);draft.clientWorkspaceId='';draft.clientRevision='';draft.runbookId='';draft.editionId='';
  put(sourceBox,empty(value?'Reading the selected original workspace…':'Choose a client workspace.'));readiness.textContent='';guard(()=>loadSource(true))();
 });
 let sourceTicket=0;
 const readEdition=async(source,bookSelect,editionBox,request)=>{
  const bookId=bookSelect.value;
  draft.runbookId=bookId;draft.editionId='';saveDraft(scope,draft);put(editionBox);
  if(!bookId)return;
  const value=await childApi(draft.alias,'/books/'+encodeURIComponent(bookId));
  if(request!==sourceTicket||state.clientDraft!==draft||bookSelect.value!==bookId)return;
  if(value.revision!==source.clientRevision)throw Error('The client changed while its procedure was read. Refresh its original source before commissioning.');
  const book=value.runbook;
  const optionsRows=book.editions.map(row=>({value:row.id,label:'Edition '+row.number+' · '+row.name+' · '+formatDate(row.createdAt)}));
  const edition=choose(optionsRows,book.latestEditionId,'Choose exact procedure edition',selected=>mutate('editionId',selected));edition.required=true;draft.editionId=edition.value;saveDraft(scope,draft);
  put(editionBox,field('Procedure edition',edition));
 };
 const loadSource=async(refresh=false)=>{
  const request=++sourceTicket,selectedAlias=draft.alias;
  if(!selectedAlias){put(sourceBox,empty('Choose a declared client workspace.'));return;}
  const source=await loadSources(selectedAlias,{refresh});
  if(request!==sourceTicket||state.clientDraft!==draft||draft.alias!==selectedAlias||!source)return;
  draft.clientWorkspaceId=source.clientWorkspaceId;draft.clientRevision=source.clientRevision;
  readiness.textContent='Original workspace '+short(source.clientWorkspaceId)+' · current revision '+short(source.clientRevision);
  const books=source.runbooks||[],editionBox=el('div',{}),savedEdition=draft.editionId;
  const bookSelect=choose(books.map(row=>({value:row.id,label:row.name+' · '+(row.client||'Client procedure')})),draft.runbookId,'Choose a saved procedure',value=>{sourceTicket++;guard(()=>readEdition(source,bookSelect,editionBox,sourceTicket))();});bookSelect.required=true;
  put(sourceBox,el('div',{class:'form-grid two'},field('Saved client procedure',bookSelect),editionBox),books.length?null:help('Create the client’s original procedure in its Runbooks desk, then refresh this source list.'),link('Open original Runbooks',clientRunbooks(selectedAlias),{target:'_blank',rel:'noopener'}));
  if(bookSelect.value){
   const selectedBook=bookSelect.value,value=await childApi(selectedAlias,'/books/'+encodeURIComponent(selectedBook));
   if(request!==sourceTicket||state.clientDraft!==draft||draft.alias!==selectedAlias||bookSelect.value!==selectedBook)return;
   if(value.revision!==source.clientRevision)throw Error('The client changed while its procedure was read. Refresh its original source before commissioning.');
   const book=value.runbook,chosen=book.editions.some(x=>x.id===savedEdition)?savedEdition:book.latestEditionId;
   const edition=choose(book.editions.map(row=>({value:row.id,label:'Edition '+row.number+' · '+row.name+' · '+formatDate(row.createdAt)})),chosen,'Choose exact procedure edition',value=>mutate('editionId',value));edition.required=true;draft.editionId=edition.value;put(editionBox,field('Procedure edition',edition));
  }
  saveDraft(scope,draft);
 };
 const names=personOptions();
 const personField=(label,key)=>{const node=choose(names,draft[key],'Choose a named person',value=>mutate(key,value));node.required=true;return field(label,node);};
 const name=input(draft.name,{maxlength:240,required:true,oninput:event=>mutate('name',event.target.value)});
 const status=choose(['DISCOVERY','READY','ACTIVE'].map(value=>({value,label:human(value)})),draft.status,null,value=>mutate('status',value));
 form.append(panel(draft.clientId?'Edit client commissioning':'Commission a client',stored?el('p',{class:'draft-badge'},'Restored private draft · '+formatTime(stored.updatedAt)):null,
  el('div',{class:'form-grid two'},field('Client / legal-entity name',name),field('Commissioning status',status),field('Original workspace alias',alias),el('div',{},btn('Refresh original sources',()=>loadSource(true)))),
  readiness,sourceBox),
  panel('Named operating team',el('div',{class:'form-grid three'},personField('Preparer / client lead','preparerId'),personField('Different backup','backupId'),personField('Reviewer','reviewerId'))),
  panel('Client-specific instructions',el('div',{class:'form-grid two'},...[
   ['Commissioned scope','scope'],['Source gaps to resolve','sourceGaps'],['Reporting instructions','reportingInstructions'],['Escalation instructions','escalationInstructions'],['Readiness note','readinessNote']
  ].map(([label,key])=>field(label,textarea(draft[key],{maxlength:16000,oninput:event=>mutate(key,event.target.value)}))))),
  actions(writable(el('button',{type:'submit',class:'primary'},'Save commissioning edition')),btn('Use saved commissioning',async()=>{await clearDraft(scope);await editClient(draft.clientId||null);})));
 form.addEventListener('submit',guard(async event=>{
  event.preventDefault();if(!form.reportValidity())return;
  if(!draft.clientWorkspaceId||!draft.clientRevision)throw Error('Read the original client workspace and procedure before commissioning.');
  const fields=clone(draft);if(!fields.clientId){delete fields.clientId;delete fields.expectedCommissionId;}
  await prepareMutation({type:'client',route:'/clients',fields,scope,title:'Client commissioning'});
 }));
 put('client-detail',form);refreshWrites();if(draft.alias)await loadSource(false);
}

function renderPlanList(){
 const plans=state.root?.plans||[];
 put('plan-list',plans.length?plans.slice().reverse().map(plan=>listButton(plan.label,[formatDate(plan.startDate)+' → '+formatDate(plan.endDate),plan.superseded?'Earlier edition':String(plan.rows)+' client periods'],()=>openPlan(plan.id),state.selectedPlan===plan.id)):empty('Published close plans appear here.'));
}
function planInput(draft){
 return {label:draft.label,startDate:draft.startDate,endDate:draft.endDate,...(draft.previousPlanId?{previousPlanId:draft.previousPlanId}:{}),
  rows:draft.rows.map(row=>{
   const result={id:row.id,clientId:row.clientId,commissionId:row.commissionId,label:row.label,closeDate:row.closeDate,reviewDate:row.reviewDate,
    preparationMinutes:row.preparationMinutes,reviewMinutes:row.reviewMinutes,backupMinutes:row.backupMinutes};
   for(const name of ['preparerId','backupId','reviewerId','cycleId','previousCycleId'])if(row[name])result[name]=row[name];
   if(row.source)result.source=clone(row.source);return result;
  })};
}
function newScheduleRow(clientId=''){
 const record=state.root?.clients?.find(row=>row.id===clientId),commission=record?.commission;
 return {id:cleanId('period'),clientId,commissionId:commission?.id||'',label:'',closeDate:'',reviewDate:'',preparerId:commission?.preparerId||'',backupId:commission?.backupId||'',reviewerId:commission?.reviewerId||'',preparationMinutes:'',reviewMinutes:'',backupMinutes:'',cycleId:'',previousCycleId:'',source:null};
}
async function newPlan({clientId='',previous=null}={}){
 setView('calendar');state.selectedPlan=previous?.id||null;state.planDetail=null;state.planPreview=null;const ticket=++state.planLoad;
 const scope='plan:'+(previous?.id||'new'),stored=await loadDraft(scope);if(ticket!==state.planLoad)return;
 const saved=previous?{label:previous.label,startDate:previous.startDate,endDate:previous.endDate,previousPlanId:previous.id,rows:planInput(previous).rows,capacityNotes:{}}:{label:'',startDate:'',endDate:'',rows:clientId?[newScheduleRow(clientId)]:[],capacityNotes:{}};
 state.planDraft=clone(stored?.value||saved);state.planDraft._scope=scope;renderPlanList();renderPlanForm(stored);
}
function invalidatePlan(){
 if(state.planPreview){state.planPreview=null;const box=$('plan-preview');if(box)put(box,empty('The schedule changed. Preview the complete current plan again before publishing.'));}
 if(state.planDraft)saveDraft(state.planDraft._scope||'plan:new',state.planDraft);
}
function nativeSourceEditor({alias,source,selected,onChange,existingCycle=false}){
 const box=el('div',{class:'resource-box stack'}),current=selected?clone(selected):null;
 let mode=current?.sourceKind||'none',value=current||null;
 const modes=[{value:'none',label:existingCycle?'Keep the existing period source':'Capacity planning only · choose close sources later'},{value:'files',label:'Original client close files'},{value:'accountant',label:'Original accountant handoff'}];
 const selector=choose(modes,mode,null,next=>{
  mode=next;value=next==='files'?{sourceKind:'files',sourceFileIds:[],sourceLabel:'',sourceNote:''}:next==='accountant'?{sourceKind:'accountant',handoffId:'',accountantRevisionId:''}:null;
  onChange(value?clone(value):null);render();
 });
 const fields=el('div',{class:'stack'});
 const commit=()=>onChange(value?clone(value):null);
 function render(){
  put(fields);
  if(mode==='none'){fields.append(help(existingCycle?'The original period retains its selected source.':'The published capacity plan may leave source selection open. A native period request must select real client files or an accountant handoff before execution.'));return;}
  if(mode==='files'){
   const label=input(value.sourceLabel||'',{maxlength:240,required:true,oninput:event=>{value.sourceLabel=event.target.value;commit();}});
   const note=textarea(value.sourceNote||'',{maxlength:16000,oninput:event=>{value.sourceNote=event.target.value;commit();}});
   fields.append(field('Close-source label',label),field('Source note',note),fileChoices(source.files,value.sourceFileIds,ids=>{value.sourceFileIds=ids;commit();}),link('Open original files and periods',clientRunbooks(alias),{target:'_blank',rel:'noopener'}));
  }else{
   const handoff=choose((source.handoffs||[]).map(row=>({value:row.id,label:(row.label||short(row.runId)||short(row.id))+' · '+formatDate(row.createdAt)})),value.handoffId,'Choose an exact accountant handoff',selected=>{
    value.handoffId=selected;value.accountantRevisionId='';delete value.periodCloseId;commit();render();
   });handoff.required=true;
   const selected=(source.handoffs||[]).find(row=>row.id===value.handoffId),editions=selected?.revisions||[];
   const revision=choose(editions.map(row=>({value:row.id,label:row.label||short(row.id)})),value.accountantRevisionId,'Choose the exact handoff edition',id=>{value.accountantRevisionId=id;commit();});revision.required=true;
   const closes=(source.closes||[]).filter(row=>!selected||!row.runId||row.runId===selected.runId);
   const close=choose(closes.map(row=>({value:row.id,label:row.label||short(row.id)})),value.periodCloseId||'','Optional saved period close',id=>{if(id)value.periodCloseId=id;else delete value.periodCloseId;commit();});
   fields.append(field('Accountant handoff',handoff),field('Handoff edition',revision),field('Saved close selection',close));
  }
 }
 box.append(field('Close source',selector),fields);render();return box;
}
function renderPlanForm(stored){
 const draft=state.planDraft;if(!draft)return;
 const form=el('form',{class:'stack'}),rowsBox=el('div',{class:'stack'}),previewBox=el('div',{id:'plan-preview',class:'stack'});
 const patch=(key,value)=>{draft[key]=value;invalidatePlan();};
 const heading=draft.previousPlanId?'Prepare a revised close plan':'Prepare a close plan';
 const renderRows=()=>put(rowsBox,draft.rows.length?draft.rows.map((row,index)=>scheduleRowEditor(row,index,draft,renderRows)):empty('Add the actual client periods in this close horizon.'));
 form.append(panel(heading,stored?el('p',{class:'draft-badge'},'Restored private draft · '+formatTime(stored.updatedAt)):null,
  el('div',{class:'form-grid three'},field('Plan label',input(draft.label,{maxlength:240,required:true,oninput:event=>patch('label',event.target.value)})),field('Horizon starts',input(draft.startDate,{type:'date',required:true,onchange:event=>patch('startDate',event.target.value)})),field('Horizon ends',input(draft.endDate,{type:'date',required:true,onchange:event=>patch('endDate',event.target.value)}))),
  help('Use a horizon of up to 366 calendar days. The preview includes allocations in other current published plans.')),
  panel('Client periods',rowsBox,btn('Add client period',()=>{if(draft.rows.length>=200)throw Error('This plan already has 200 client periods.');draft.rows.push(newScheduleRow());invalidatePlan();renderRows();})),
  actions(writable(el('button',{type:'submit',class:'primary'},'Preview complete capacity')),btn('Use current saved plan',async()=>{await clearDraft(draft._scope||'plan:new');if(draft.previousPlanId){const value=await api('/plans/'+draft.previousPlanId);await newPlan({previous:value.plan});}else await newPlan();})),previewBox);
 form.addEventListener('submit',guard(async event=>{
  event.preventDefault();if(!form.reportValidity())return;assertWrite();
  const exactInput=planInput(draft),generation=canonical(exactInput);
  if(!draft.rows.length)throw Error('Add at least one actual client period.');
  setBusy(true);
  try{
   const value=await api('/preview',{method:'POST',body:{...exactInput,workspaceId:state.workspaceId}});
   if(state.planDraft!==draft||canonical(planInput(draft))!==generation)return;
   coordinator(value);state.planPreview={input:exactInput,value:value.preview,revision:value.revision};
   renderPlanPreview(previewBox,draft);
  }finally{setBusy(false);}
 }));
 put('plan-detail',form);renderRows();refreshWrites();
}
function scheduleRowEditor(row,index,draft,rerender){
 const card=el('section',{class:'schedule-row'}),sourceBox=el('div',{class:'stack'}),periodBox=el('div',{class:'form-grid two'}),teamBox=el('div',{class:'form-grid three'}),sourceStatus=el('p',{class:'quiet'});
 let generation=0;
 const active=()=>state.planDraft===draft&&draft.rows.includes(row)&&card.isConnected;
 const patch=(key,value)=>{row[key]=value;invalidatePlan();};
 const chooseClient=choose((state.root?.clients||[]).map(client=>({value:client.id,label:client.commission.name+' · '+client.commission.alias})),row.clientId,'Choose a commissioned client',id=>{
  generation++;const next=newScheduleRow(id);
  for(const name of ['clientId','commissionId','preparerId','backupId','reviewerId'])row[name]=next[name];
  row.cycleId='';row.previousCycleId='';row.source=null;invalidatePlan();
  put(sourceBox,empty(id?'Reading original client sources…':'Choose a client.'));
  put(periodBox);renderTeam();guard(()=>loadRowSource(true))();
 });chooseClient.required=true;
 const label=input(row.label,{maxlength:240,required:true,oninput:event=>patch('label',event.target.value)});
 function renderTeam(){
  const names=personOptions();
  put(teamBox,...[['Preparer / lead','preparerId'],['Backup','backupId'],['Reviewer','reviewerId']].map(([label,key])=>{
   const select=choose(names,row[key],'Choose a named person',id=>patch(key,id));select.required=true;return field(label,select);
  }));
 }
 async function loadRowSource(refresh=false){
  const ticket=++generation,clientId=row.clientId,client=state.root?.clients?.find(item=>item.id===clientId),commission=client?.commission;
  if(!commission){put(sourceBox,empty('Select a commissioned client to choose its exact period and files.'));return;}
  const source=await loadSources(commission.alias,{refresh});
  if(ticket!==generation||!active()||row.clientId!==clientId||!source)return;
  if(row.commissionId!==commission.id)sourceStatus.textContent='This draft names an older client commission. Use the current commissioning edition before previewing.';
  else sourceStatus.textContent='Commission '+short(commission.id)+' · original client revision '+short(source.clientRevision);
  const cycles=(source.cycles||[]).filter(cycle=>cycle.runbookId===commission.runbookId);
  const current=choose(cycles.map(cycle=>({value:cycle.id,label:cycle.label+' · '+human(cycle.phase)})),row.cycleId||'','New period to prepare',id=>{row.cycleId=id;invalidatePlan();renderSource();});
  const previous=choose(cycles.map(cycle=>({value:cycle.id,label:cycle.label+' · '+human(cycle.phase)})),row.previousCycleId||'','No previous period selected',id=>patch('previousCycleId',id));
  put(periodBox,field('Existing period or new work',current),field('Previous-period handover',previous));
  const renderSource=()=>put(sourceBox,nativeSourceEditor({alias:commission.alias,source,selected:row.source,existingCycle:Boolean(row.cycleId),onChange:value=>patch('source',value)}));
  renderSource();
 }
 card.append(el('div',{class:'row-heading'},el('h4',{},'Client period '+(index+1)),btn('Remove period',()=>{generation++;draft.rows.splice(draft.rows.indexOf(row),1);invalidatePlan();rerender();})),
  el('div',{class:'form-grid two'},field('Commissioned client',chooseClient),field('Period label',label)),sourceStatus,
  actions(btn('Refresh original sources',()=>loadRowSource(true),{class:'muted-button'}),btn('Use current commissioning',async()=>{
   await refreshRoot();const current=state.root?.clients?.find(item=>item.id===row.clientId)?.commission;
   if(!current)throw Error('This commissioned client is no longer available.');
   row.commissionId=current.id;row.preparerId=current.preparerId;row.backupId=current.backupId;row.reviewerId=current.reviewerId;
   row.cycleId='';row.previousCycleId='';row.source=null;invalidatePlan();renderTeam();await loadRowSource(true);
  },{class:'muted-button'})),
  el('div',{class:'form-grid two'},field('Preparation / close due',input(row.closeDate,{type:'date',required:true,onchange:event=>patch('closeDate',event.target.value)})),field('Review due',input(row.reviewDate,{type:'date',required:true,onchange:event=>patch('reviewDate',event.target.value)}))),
  teamBox,
  el('div',{class:'form-grid three'},...[
   ['Preparation minutes','preparationMinutes'],['Review minutes','reviewMinutes'],['Backup reserve minutes','backupMinutes']
  ].map(([label,key])=>field(label,input(row[key],{type:'number',min:0,max:1000000,step:1,required:true,oninput:event=>patch(key,event.target.value===''?'':Number(event.target.value))})))),
  periodBox,sourceBox,el('details',{},el('summary',{},'Stable schedule row'),el('p',{class:'identity'},row.id)));
 renderTeam();
 queueMicrotask(()=>{if(active())guard(()=>loadRowSource(false))();});
 return card;
}
function conflictDescription(conflict,preview){
 const staff=preview.firm?.staff||[],name=staff.find(person=>person.id===conflict.staffId)?.name||conflict.staffId;
 if(conflict.kind==='UNALLOCATED')return (preview.rows.find(row=>row.id===conflict.rowId)?.name||clientName(conflict.clientId))+': '+minutes(conflict.unallocatedMinutes)+' of '+human(conflict.role).toLowerCase()+' for '+name+' remain unallocated between '+conflict.from+' and '+conflict.to+'.';
 if(conflict.kind==='EXISTING_OVERLOAD')return name+' already has '+minutes(conflict.overloadMinutes)+' above declared capacity on '+conflict.date+'.';
 return human(conflict.kind);
}
function pagedTable(headers,rows,{pageSize=40,emptyText='No entries for this selection.'}={}){
 const container=el('div',{class:'stack'});if(!rows.length){container.append(empty(emptyText));return container;}
 let page=0;const content=el('div',{}),label=el('span',{class:'quiet'});
 const before=btn('Previous page',()=>{page--;draw();}),after=btn('Next page',()=>{page++;draw();});
 function draw(){const start=page*pageSize;put(content,table(headers,rows.slice(start,start+pageSize)));label.textContent=(start+1)+'–'+Math.min(rows.length,start+pageSize)+' of '+rows.length;before.disabled=page===0;after.disabled=start+pageSize>=rows.length;}
 container.append(content,actions(before,label,after));draw();return container;
}
function calendarTables(preview){
 const calendar=preview.calendar,staff=preview.firm?.staff||calendar.staff||[],names=new Map(staff.map(person=>[person.id,person.name])),rowNames=new Map(preview.rows.map(row=>[row.id,row.name+' · '+row.label]));
 const box=el('div',{class:'stack'}),who=choose(staff.map(person=>({value:person.id,label:person.name})),'','All named people'),date=input('',{type:'date'}),view=choose([{value:'allocations',label:'Scheduled work'},{value:'days',label:'Daily capacity'}],'allocations',null),result=el('div',{});
 const draw=()=>{
  const rows=view.value==='days'?calendar.days.filter(row=>(!who.value||row.staffId===who.value)&&(!date.value||row.date===date.value)).map(row=>[row.date,names.get(row.staffId)||row.staffId,row.capacityMinutes,row.bookedMinutes,row.plannedMinutes,row.availableMinutes,row.overloadMinutes]):
   calendar.allocations.filter(row=>(!who.value||row.staffId===who.value)&&(!date.value||row.date===date.value)).map(row=>[row.date,names.get(row.staffId)||row.staffId,rowNames.get(row.rowId)||clientName(row.clientId),human(row.role),row.minutes]);
  put(result,pagedTable(view.value==='days'?['Date','Person','Available capacity','Existing bookings','This plan','Time remaining','Over capacity']:['Date','Person','Client period','Role','Minutes'],rows));
 };
 who.addEventListener('change',draw);date.addEventListener('change',draw);view.addEventListener('change',draw);
 box.append(el('div',{class:'toolbar'},field('View',view),field('Person',who),field('Date',date),btn('Clear date',()=>{date.value='';draw();})),result);
 draw();return box;
}
function renderPlanPreview(target,draft){
 const reviewed=state.planPreview;if(!reviewed)return;
 const preview=reviewed.value,totals=preview.calendar.totals,conflicts=preview.calendar.conflicts;
 const notes=draft.capacityNotes??={};
 const conflictList=el('div',{class:'stack'});
 for(const conflict of conflicts){
  const note=textarea(notes[conflict.id]||'',{maxlength:4000,required:true,rows:3,oninput:event=>{notes[conflict.id]=event.target.value;saveDraft(draft._scope||'plan:new',draft);}});
  conflictList.append(el('div',{class:'conflict'},el('p',{},conflictDescription(conflict,preview)),field('Explicit handling plan',note,'Describe the actual reassignment, timing or capacity decision for this conflict.')));
 }
 const publish=writable(btn('Publish reviewed close plan',async()=>{
  assertWrite();if(state.planPreview!==reviewed||canonical(planInput(draft))!==canonical(reviewed.input))throw Error('The plan changed. Preview the complete current schedule again.');
  for(const conflict of conflicts)if(!String(notes[conflict.id]||'').trim())throw Error('Record an explicit handling note for every displayed capacity conflict.');
  const fields={...clone(reviewed.input),expectedPreviewSha256:preview.previewSha256,capacityExceptions:conflicts.map(conflict=>({id:conflict.id,note:notes[conflict.id]}))};
  await prepareMutation({type:'plan',route:'/plans',fields,scope:draft._scope||'plan:new',title:'Close calendar'});
 },{class:'primary'}));
 put(target,panel('Complete capacity preview',
  el('div',{class:'facts'},...facts([['Requested',minutes(totals.requestedMinutes)],['Allocated',minutes(totals.allocatedMinutes)],['Unallocated',minutes(totals.unallocatedMinutes)],['Existing overload',minutes(totals.existingOverloadMinutes)]])),
  help('The original scheduler allocates actual work before backup reserve and includes retained bookings from other current plans.'),
  conflicts.length?panel('Capacity decisions required',conflictList):el('p',{},'All requested work fits within the declared capacity and selected dates.'),
  calendarTables(preview),
  actions(publish),
  el('details',{},el('summary',{},'Reviewed source identity'),recordFacts([['Firm edition',preview.firmEditionId],['Calendar preview',preview.previewSha256],['Coordinator revision',reviewed.revision]]))));
 refreshWrites();
}
async function openPlan(id){
 setView('calendar');state.selectedPlan=id;state.planDetail=null;state.planDraft=null;state.planPreview=null;
 const ticket=++state.planLoad;put('plan-detail',empty('Opening the original published close calendar…'));renderPlanList();
 const value=await read('/plans/'+encodeURIComponent(id),{key:'plan-detail'});
 if(!value||ticket!==state.planLoad||state.selectedPlan!==id)return;
 state.planDetail=value.plan;renderPlanDetail();
}
function renderPlanDetail(){
 const plan=state.planDetail;if(!plan)return;
 const summary=(state.root.plans||[]).find(row=>row.id===plan.id),current=!summary?.superseded;
 const rows=plan.rows.map(row=>el('section',{class:'schedule-row'},
  el('div',{class:'row-heading'},el('h4',{},row.name+' · '+row.label),tag(row.cycleId?'EXISTING_PERIOD':'NEW_PERIOD')),
  recordFacts([['Close due',row.closeDate],['Review due',row.reviewDate],['Preparer',plan.firm.staff.find(p=>p.id===row.preparerId)?.name],['Backup',plan.firm.staff.find(p=>p.id===row.backupId)?.name],['Reviewer',plan.firm.staff.find(p=>p.id===row.reviewerId)?.name],['Preparation',minutes(row.preparationMinutes)],['Review',minutes(row.reviewMinutes)],['Backup reserve',minutes(row.backupMinutes)],['Close source',row.source?human(row.source.sourceKind):row.cycleId?'Retained original period':'Choose before creating the period']]),
  actions(btn('Prepare client operation',()=>newCommand({clientId:row.clientId,planId:plan.id,rowId:row.id,action:row.cycleId?'assign':'create'})),link('Open original client desk',clientRunbooks(row.alias),{target:'_blank',rel:'noopener'})),
  el('details',{},el('summary',{},'Original row binding'),recordFacts([['Row ID',row.id],['Commission',row.commissionId],['Procedure edition',row.editionId],['Client workspace',row.clientWorkspaceId],['Client revision',row.clientRevision]]))
 ));
 put('plan-detail',panel(plan.label,
  el('div',{class:'plan-summary'},recordFacts([['Horizon',plan.startDate+' → '+plan.endDate],['Published',formatTime(plan.createdAt)],['Operator',plan.actor],['Edition',current?'Current plan':'Earlier retained plan']]),current?btn('Revise complete calendar',()=>newPlan({previous:plan})):null),
  el('div',{class:'export-links'},link('Download calendar CSV',API+'/plans/'+encodeURIComponent(plan.id)+'/calendar.csv'),link('Open printable handover',API+'/plans/'+encodeURIComponent(plan.id)+'/print',{target:'_blank',rel:'noopener'}))),
  panel('Original client periods',el('div',{class:'stack'},rows)),
  panel('Published capacity',calendarTables(plan)),
  plan.capacityExceptions?.length?panel('Retained capacity decisions',...plan.capacityExceptions.map(exception=>el('div',{class:'conflict'},el('p',{},conflictDescription(plan.calendar.conflicts.find(c=>c.id===exception.id)||{kind:exception.id},plan)),el('p',{class:'instructions'},exception.note)))):null);
}

const commandLabels={save:'Revise client procedure',create:'Create client period',assign:'Hand over responsibility',work:'Save procedure work',submit:'Submit preparation',review:'Record reviewer decision'};
function renderCommandList(){
 const query=$('command-search').value.trim().toLowerCase(),rows=(state.root?.commands||[]).filter(row=>(clientName(row.clientId)+' '+row.alias+' '+commandLabels[row.action]+' '+row.nativeRequestId).toLowerCase().includes(query));
 put('command-list',rows.length?rows.slice().reverse().map(row=>listButton(commandLabels[row.action]||human(row.action),[clientName(row.clientId),row.current===false?'Earlier request':'Current request',formatTime(row.createdAt)],()=>openCommand(row.id),state.selectedCommand===row.id)):empty(query?'No retained requests match this search.':'Prepare an original client operation from a close plan or commissioned client.'));
}
function commandScope(value){return 'command:'+(value.replacesCommandId||[value.clientId||'new',value.planId||'',value.rowId||'',value.action||'create'].join(':'));}
async function newCommand({clientId='',planId=null,rowId=null,action='create',replaces=null}={}){
 setView('commands');state.selectedCommand=null;state.commandDetail=null;const generation=++state.commandLoad;
 put('command-detail',empty('Opening the original client operation form…'));renderCommandList();
 const seed={clientId,planId,rowId,action,nativeRequestId:replaces?.nativeRequest.requestId||uuid(),replacesCommandId:replaces?.id||null,parameters:{},clientWorkspaceId:'',clientRevision:''};
 if(replaces){
  seed.clientId=replaces.clientId;seed.planId=replaces.planId;seed.rowId=replaces.rowId;seed.action=replaces.action;
  seed.parameters=clone(replaces.nativeRequest);for(const name of ['workspaceId','revision','requestId','actor'])delete seed.parameters[name];
  if(replaces.target)seed.parameters.cycleId=replaces.target;
 }
 const scope=commandScope(seed),stored=await loadDraft(scope);if(generation!==state.commandLoad)return;
 state.commandDraft=clone(stored?.value||seed);state.commandDraft._scope=scope;state.commandDraft._replaces=replaces?{id:replaces.id,commandSha256:replaces.commandSha256}:null;
 await renderCommandForm(stored);
}
async function renderCommandForm(stored){
 const draft=state.commandDraft;if(!draft)return;
 const form=el('form',{class:'stack'}),nativeBox=el('div',{class:'stack'}),sourceStatus=el('p',{class:'quiet'}),planBox=el('div',{class:'stack'});
 let generation=0,source=null,book=null,plan=null,planRow=null,cycle=null,assignment=null,actionAvailable=false;
 const active=()=>state.commandDraft===draft&&form.isConnected;
 const save=()=>saveDraft(draft._scope||commandScope(draft),draft);
 const patch=(key,value)=>{draft.parameters[key]=value;save();};
 const client=choose((state.root?.clients||[]).map(row=>({value:row.id,label:row.commission.name+' · '+row.commission.alias})),draft.clientId,'Choose a commissioned client',id=>{
  generation++;draft.clientId=id;draft.planId=null;draft.rowId=null;draft.parameters={};draft.nativeRequestId=uuid();draft.clientWorkspaceId='';draft.clientRevision='';save();
  source=book=plan=planRow=cycle=assignment=null;put(nativeBox,empty('Reading the selected original client…'));guard(()=>loadClient(true))();
 });client.required=true;client.disabled=Boolean(draft.replacesCommandId);
 const action=choose(Object.entries(commandLabels).map(([value,label])=>({value,label})),draft.action,null,value=>{
  generation++;draft.action=value;draft.parameters={};draft.nativeRequestId=uuid();cycle=assignment=null;save();guard(()=>renderNative())();
 });action.disabled=Boolean(draft.replacesCommandId);
 const commission=()=>state.root?.clients?.find(row=>row.id===draft.clientId)?.commission;
 const selectedPeople=()=>plan?.firm?.staff||people();
 function namedSelect(label,name,selected,required=true,readOnly=false){
  const rows=selectedPeople().map(person=>({value:person.name,label:person.name}));
  if(selected&&!rows.some(row=>row.value===selected))rows.push({value:selected,label:selected+' · retained assignment'});
  const control=choose(rows,selected,'Choose a named person',value=>patch(name,value));control.required=required;control.disabled=readOnly;
  return field(label,control);
 }
 async function loadClient(refresh=false){
  actionAvailable=false;
  const ticket=++generation,selectedId=draft.clientId,c=commission();
  put(nativeBox,empty(c?'Reading the client’s exact source and procedure…':'Choose a commissioned client.'));
  put(planBox);sourceStatus.textContent='';
  if(!c)return;
  const selectedSource=await loadSources(c.alias,{refresh});
  if(ticket!==generation||!active()||draft.clientId!==selectedId||!selectedSource)return;
  source=selectedSource;
  draft.clientWorkspaceId=source.clientWorkspaceId;draft.clientRevision=source.clientRevision;
  sourceStatus.textContent='Original client '+short(source.clientWorkspaceId)+' · revision '+short(source.clientRevision);
  const value=await childApi(c.alias,'/books/'+encodeURIComponent(c.runbookId));
  if(ticket!==generation||!active()||draft.clientId!==selectedId)return;
  if(value.revision!==source.clientRevision)throw Error('The client changed while its procedure was read. Refresh its original source before preparing.');
  book=value.runbook;
  if(draft.planId){
   const selectedPlan=await api('/plans/'+encodeURIComponent(draft.planId));
   if(ticket!==generation||!active())return;
   plan=selectedPlan.plan;planRow=plan.rows.find(row=>row.id===draft.rowId&&row.clientId===draft.clientId);
   if(!planRow)throw Error('The original close-plan row does not belong to this selected client.');
  }else plan=planRow=null;
  renderPlanChoice();await renderNative();save();
 }
 function renderPlanChoice(){
  if(!source)return;
  const plans=state.root?.plans||[];
  const select=choose(plans.map(row=>({value:row.id,label:row.label+(row.superseded?' · earlier edition':'')})),draft.planId||'','No saved calendar selection',id=>{
   generation++;draft.planId=id||null;draft.rowId=null;plan=planRow=null;draft.parameters={};save();guard(async()=>{
    if(!id){renderPlanChoice();await renderNative();return;}
    const ticket=++generation,value=await api('/plans/'+encodeURIComponent(id));if(ticket!==generation||!active())return;
    plan=value.plan;renderPlanChoice();put(nativeBox,empty('Choose this client’s row in the saved calendar.'));
   })();
  });
  select.disabled=Boolean(draft.replacesCommandId);
  const children=[field('Published close plan',select)];
  if(plan){
   const rows=plan.rows.filter(row=>row.clientId===draft.clientId);
   const row=choose(rows.map(row=>({value:row.id,label:row.label+' · close '+row.closeDate})),draft.rowId||'','Choose exact client period',value=>{
    generation++;draft.rowId=value;planRow=plan.rows.find(row=>row.id===value);draft.parameters={};save();guard(renderNative)();
   });row.required=true;row.disabled=Boolean(draft.replacesCommandId);
   children.push(field('Original calendar row',row));
   if(!rows.length)children.push(help('This plan contains no row for the selected client.'));
  }
  put(planBox,el('div',{class:'form-grid two'},children));
 }
 async function cycleSelection({allowed,render}){
  const c=commission(),cycles=(source.cycles||[]).filter(row=>row.runbookId===c.runbookId);
  const fixed=Boolean(planRow?.cycleId||draft._replaces?.id&&draft.parameters.cycleId);
  const chosen=planRow?.cycleId||draft.parameters.cycleId||'';
  if(chosen)draft.parameters.cycleId=chosen;
  const select=choose(cycles.map(row=>({value:row.id,label:row.label+' · '+human(row.phase)+(row.readOnly?' · received':'')})),chosen,'Choose an original client period',id=>{
   generation++;draft.parameters={cycleId:id};cycle=assignment=null;save();guard(renderNative)();
  });select.required=true;select.disabled=fixed;
  const detail=el('div',{class:'stack'});
  put(nativeBox,panel('Original client period',field('Period',select),help('Only the original current period can receive new work. Received periods open for retained handover.')),detail);
  if(!chosen)return;
  const ticket=++generation,response=await childApi(c.alias,'/cycles/'+encodeURIComponent(chosen));
  if(ticket!==generation||!active()||draft.parameters.cycleId!==chosen)return;
  if(response.revision!==source.clientRevision)throw Error('The client changed while its current work was read. Refresh before preparing this operation.');
  cycle=response.cycle;assignment=response.assignment;
  detail.append(panel(cycle.label,recordFacts([['Phase',human(cycle.phase)],['Preparer',cycle.preparer],['Reviewer',cycle.reviewer],['Due date',cycle.dueDate],['Current procedure',short(cycle.editionId)]])));
  if(cycle.readOnly){detail.append(el('div',{class:'read-only'},'This is an original received handover. Start a fresh local period for new preparation.'));return;}
  if(allowed&&!allowed.includes(cycle.phase)){detail.append(el('div',{class:'warning-box'},'This action is unavailable in the current '+human(cycle.phase).toLowerCase()+' phase. Open the original desk or choose the appropriate period.'));return;}
  await render(detail);if(ticket===generation&&active()&&draft.parameters.cycleId===chosen)actionAvailable=true;save();
 }
 async function renderNative(){
  actionAvailable=false;
  if(!source||!book){put(nativeBox,empty('Read the original client source first.'));return;}
  const c=commission(),p=draft.parameters;
  if(draft.planId&&!planRow){put(nativeBox,empty('Choose an exact row from the selected close plan.'));return;}
  if(draft.action==='create'){
   const fixed=planRow?{
    runbookId:planRow.runbookId,editionId:planRow.editionId,label:planRow.label,
    preparer:selectedPeople().find(person=>person.id===planRow.preparerId)?.name,
    reviewer:selectedPeople().find(person=>person.id===planRow.reviewerId)?.name,dueDate:planRow.closeDate
   }:null;
   if(!p.runbookId)p.runbookId=c.runbookId;if(!p.editionId)p.editionId=planRow?.editionId||c.editionId;
   if(fixed){for(const [key,value] of Object.entries(fixed))p[key]=value;if(planRow.previousCycleId)p.previousCycleId=planRow.previousCycleId;else delete p.previousCycleId;}
   const nativeSource=p.sourceKind?Object.fromEntries(['sourceKind','sourceFileIds','sourceLabel','sourceNote','handoffId','accountantRevisionId','periodCloseId'].filter(key=>p[key]!==undefined).map(key=>[key,clone(p[key])])):planRow?.source?clone(planRow.source):null;
   if(nativeSource)Object.assign(p,nativeSource);
   const edition=choose(book.editions.map(row=>({value:row.id,label:'Edition '+row.number+' · '+row.name})),p.editionId,'Choose procedure edition',id=>patch('editionId',id));edition.required=true;edition.disabled=Boolean(fixed);
   const label=input(p.label||'',{maxlength:240,required:true,readOnly:Boolean(fixed),oninput:event=>patch('label',event.target.value)});
   const due=input(p.dueDate||'',{type:'date',required:true,readOnly:Boolean(fixed),onchange:event=>patch('dueDate',event.target.value)});
   const previous=choose((source.cycles||[]).filter(row=>row.runbookId===c.runbookId).map(row=>({value:row.id,label:row.label+' · '+human(row.phase)})),p.previousCycleId||'','No previous period',id=>{if(id)p.previousCycleId=id;else delete p.previousCycleId;save();});previous.disabled=Boolean(fixed);
   const sourceEditor=nativeSourceEditor({alias:c.alias,source,selected:nativeSource,onChange:value=>{
    for(const key of ['sourceKind','sourceFileIds','sourceLabel','sourceNote','handoffId','accountantRevisionId','periodCloseId'])delete p[key];
    if(value)Object.assign(p,value);save();
   }});
   put(nativeBox,panel('Create original client period',fixed?el('p',{class:'source-lock'},'The selected published calendar fixes this period’s label, procedure, preparer, reviewer and close date.'):null,
    el('div',{class:'form-grid two'},field('Procedure edition',edition),field('Period label',label),namedSelect('Preparer','preparer',p.preparer||'',true,Boolean(fixed)),namedSelect('Reviewer','reviewer',p.reviewer||'',true,Boolean(fixed)),field('Close due',due),field('Previous-period handover',previous)),sourceEditor));
  }else if(draft.action==='assign'){
   await cycleSelection({allowed:['DRAFT','CHANGES_REQUESTED','IN_REVIEW'],render:async detail=>{
    p.expectedAssignmentSha256=assignment.sha256;
    if(!p.preparer)p.preparer=cycle.preparer;if(!p.reviewer)p.reviewer=cycle.reviewer;if(!p.dueDate)p.dueDate=cycle.dueDate;
    detail.append(panel('Responsibility and open-items handover',
     help('This change retains the current work and its source, then records the receiving responsibility and agreed due date.'),
     el('div',{class:'form-grid three'},namedSelect('Receiving preparer','preparer',p.preparer),namedSelect('Receiving reviewer','reviewer',p.reviewer),field('Agreed close due',input(p.dueDate,{type:'date',required:true,onchange:event=>patch('dueDate',event.target.value)}))),
     field('Handover and open-items note',textarea(p.note||'',{maxlength:16000,required:true,oninput:event=>patch('note',event.target.value)})),
     actions(btn('Use the named backup',()=>{p.preparer=people().find(person=>person.id===c.backupId)?.name||p.preparer;save();guard(renderNative)();}))));
   }});
  }else if(draft.action==='work'){
   await cycleSelection({allowed:['DRAFT','CHANGES_REQUESTED'],render:async detail=>{
    const steps=cycle.edition.steps||[],step=choose(steps.map(row=>({value:row.id,label:row.title+(row.required?' · required':'')})),p.stepId||'','Choose original procedure task',id=>{
     const work=cycle.work[id]||{};p.stepId=id;p.status=work.status||'PENDING';p.note=work.note||'';p.fileIds=clone(work.fileIds||[]);save();guard(renderNative)();
    });step.required=true;
    const chosen=steps.find(row=>row.id===p.stepId),controls=el('div',{class:'stack'});
    detail.append(panel('Procedure work',field('Original task',step),controls));
    if(chosen){
     const status=choose(['PENDING','COMPLETE','NOT_APPLICABLE','BLOCKED'].map(value=>({value,label:human(value)})),p.status||'PENDING',null,value=>patch('status',value));p.status=status.value;p.fileIds??=[];
     controls.append(el('p',{class:'instructions'},chosen.instructions),field('Work status',status),field('Preparation note',textarea(p.note||'',{maxlength:32000,oninput:event=>patch('note',event.target.value)})),el('fieldset',{},el('legend',{},'Original working attachments'),fileChoices(source.files,p.fileIds,ids=>patch('fileIds',ids))),link('Open original file intake',clientRunbooks(c.alias),{target:'_blank',rel:'noopener'}));
    }
   }});
  }else if(draft.action==='submit'){
   await cycleSelection({allowed:['DRAFT','CHANGES_REQUESTED'],render:async detail=>{
    const steps=cycle.edition.steps||[];
    detail.append(panel('Submit current preparation',help('The original current task work and attachments are retained in this review round. Complete required pending tasks or record their actual blocked condition before submitting.'),
     table(['Task','Required','Current status'],steps.map(step=>[step.title,step.required?'Yes':'No',human(cycle.work[step.id]?.status||'PENDING')])),
     field('Preparation handover note',textarea(p.note||'',{maxlength:16000,oninput:event=>patch('note',event.target.value)}))));
   }});
  }else if(draft.action==='review'){
   await cycleSelection({allowed:['IN_REVIEW'],render:async detail=>{
    const decision=choose([{value:'RETURN',label:'Return for corrections'},{value:'APPROVE',label:'Approve preparation'}],p.decision||'RETURN',null,value=>{p.decision=value;save();guard(renderNative)();});p.decision=decision.value;
    const blocked=(cycle.edition.steps||[]).filter(step=>step.required&&cycle.work[step.id]?.status==='BLOCKED'),exceptionBox=el('div',{class:'stack'});
    if(p.decision==='APPROVE'&&blocked.length){
     p.acceptedExceptions??=[];
     exceptionBox.append(help('Review every required blocked task. Select each exception you explicitly accept and explain its handling in the review note.'),...blocked.map(step=>check(step.title+' · '+(cycle.work[step.id]?.note||'No preparation note'),p.acceptedExceptions.includes(step.id),checked=>{
      const selected=new Set(p.acceptedExceptions);checked?selected.add(step.id):selected.delete(step.id);p.acceptedExceptions=[...selected];save();
     })));
    }
    detail.append(panel('Reviewer decision',help('The operator name at the top is retained as the actual reviewer. Current assigned reviewer: '+cycle.reviewer+'.'),
     field('Decision',decision),exceptionBox,field('Review and exception note',textarea(p.note||'',{maxlength:16000,required:p.decision==='RETURN'||blocked.length>0,oninput:event=>patch('note',event.target.value)})),
     el('details',{},el('summary',{},'Current preparation'),table(['Task','Status','Preparation note'],cycle.edition.steps.map(step=>[step.title,human(cycle.work[step.id]?.status||'PENDING'),cycle.work[step.id]?.note||''])))));
   }});
  }else if(draft.action==='save'){
   if(!p.runbookId){const edition=book.editions.find(row=>row.id===book.latestEditionId);Object.assign(p,{runbookId:book.id,expectedEditionId:book.latestEditionId,name:edition.name,client:edition.client,description:edition.description,steps:clone(edition.steps),resources:clone(edition.resources)});}
   put(nativeBox,procedureEditor(p,source,save));
  }
  if(['create','save'].includes(draft.action))actionAvailable=true;
  save();refreshWrites();
 }
 const header=panel(draft.replacesCommandId?'Correct an original uncommitted request':'Prepare an original client operation',
  stored?el('p',{class:'draft-badge'},'Restored private request draft · '+formatTime(stored.updatedAt)):null,
  el('div',{class:'form-grid two'},field('Commissioned client',client),field('Original client action',action)),sourceStatus,
  actions(btn('Refresh current client source',()=>loadClient(true)),commission()?link('Open original client desk',clientRunbooks(commission().alias),{target:'_blank',rel:'noopener'}):null),planBox);
 const submit=writable(el('button',{type:'submit',class:'primary'},'Retain exact prepared request'));
 form.append(header,nativeBox,actions(submit),el('details',{},el('summary',{},'Original request identity'),recordFacts([['Native request UUID',draft.nativeRequestId],['Corrects saved request',draft.replacesCommandId||'New native operation']])));
 form.addEventListener('submit',guard(async event=>{
  event.preventDefault();if(!form.reportValidity())return;assertWrite();
  if(!source||!draft.clientWorkspaceId||!draft.clientRevision)throw Error('Read the current original client source before preparing.');
  if(!actionAvailable)throw Error('Read an original client period in a phase that supports this action before preparing.');
  if(draft.action==='create'&&!['files','accountant'].includes(draft.parameters.sourceKind))throw Error('Select the actual original close files or accountant handoff before creating this period.');
  if(['assign','work','submit','review'].includes(draft.action)&&(!cycle||cycle.readOnly))throw Error('Choose an original writable local client period.');
  if(draft.action==='work'&&!draft.parameters.stepId)throw Error('Choose the actual task being prepared.');
  const parameters=clone(draft.parameters);
  if(draft.action==='review'&&parameters.decision==='RETURN')parameters.acceptedExceptions=[];
  if(draft.action==='review'&&!parameters.acceptedExceptions)parameters.acceptedExceptions=[];
  const fields={clientId:draft.clientId,action:draft.action,nativeRequestId:draft.nativeRequestId,clientWorkspaceId:draft.clientWorkspaceId,clientRevision:draft.clientRevision,parameters};
  for(const name of ['planId','rowId','replacesCommandId'])if(draft[name])fields[name]=draft[name];
  await prepareMutation({type:'prepare',route:'/commands',fields,scope:draft._scope||commandScope(draft),title:commandLabels[draft.action]});
 }));
 put('command-detail',form);refreshWrites();if(draft.clientId)await loadClient(false);
}
function procedureEditor(parameters,source,save){
 const p=parameters,box=el('div',{class:'stack'}),tasks=el('div',{class:'stack'}),resources=el('div',{class:'stack'});
 const patch=(key,value)=>{p[key]=value;save();};
 const redrawTasks=()=>put(tasks,p.steps.length?p.steps.map((step,index)=>{
  const shift=delta=>{const target=index+delta;if(target<0||target>=p.steps.length)return;[p.steps[index],p.steps[target]]=[p.steps[target],p.steps[index]];save();redrawTasks();};
  const choices=el('div',{class:'choice-grid'},...p.resources.map(resource=>check(resource.title||resource.id,(step.resourceIds||[]).includes(resource.id),checked=>{
   const ids=new Set(step.resourceIds||[]);checked?ids.add(resource.id):ids.delete(resource.id);step.resourceIds=[...ids];save();
  })));
  return el('section',{class:'task-editor'},
   el('div',{class:'row-heading'},el('h4',{},'Task '+(index+1)),actions(btn('Move up',()=>shift(-1),{disabled:index===0}),btn('Move down',()=>shift(1),{disabled:index===p.steps.length-1}),btn('Remove task',()=>{p.steps.splice(index,1);save();redrawTasks();}))),
   field('Task title',input(step.title,{maxlength:240,required:true,oninput:event=>{step.title=event.target.value;save();}})),
   field('Instructions',textarea(step.instructions||'',{maxlength:32000,required:true,oninput:event=>{step.instructions=event.target.value;save();}})),
   check('Required preparation',step.required,checked=>{step.required=checked;save();}),
   p.resources.length?el('fieldset',{},el('legend',{},'Reference resources'),choices):null,
   el('p',{class:'identity'},'Stable task '+step.id));
 }):empty('Add the actual ordered client procedure tasks.'));
 const redrawResources=()=>put(resources,p.resources.length?p.resources.map((resource,index)=>{
  const body=el('div',{class:'stack'});
  const draw=()=>{
   put(body);
   if(resource.kind==='link')body.append(field('Approved reference URL',input(resource.url||'',{type:'url',maxlength:4000,required:true,oninput:event=>{resource.url=event.target.value;save();}})));
   if(resource.kind==='note')body.append(field('Reference note',textarea(resource.text||'',{maxlength:32000,required:true,oninput:event=>{resource.text=event.target.value;save();}})));
   if(resource.kind==='file'){const file=choose((source.files||[]).map(row=>({value:row.id,label:row.name+' · '+bytes(row.bytes)})),resource.fileId||'','Choose original retained file',id=>{resource.fileId=id;save();});file.required=true;body.append(field('Original reference file',file));}
  };
  const kind=choose([{value:'link',label:'Approved link'},{value:'note',label:'Reference note'},{value:'file',label:'Retained file'}],resource.kind,null,value=>{resource.kind=value;delete resource.url;delete resource.text;delete resource.fileId;save();draw();});
  draw();
  return el('section',{class:'task-editor'},el('div',{class:'row-heading'},el('h4',{},'Resource '+(index+1)),btn('Remove resource',()=>{p.resources.splice(index,1);for(const step of p.steps)step.resourceIds=(step.resourceIds||[]).filter(id=>id!==resource.id);save();redrawResources();redrawTasks();})),
   el('div',{class:'form-grid two'},field('Resource title',input(resource.title||'',{maxlength:240,required:true,oninput:event=>{resource.title=event.target.value;save();}})),field('Resource type',kind)),body,el('p',{class:'identity'},'Stable resource '+resource.id));
 }):empty('Add approved links, notes or files used by this procedure.'));
 box.append(panel('Revise the complete client procedure',
  help('This request saves a new complete procedure edition. Existing periods keep their original edition and work.'),
  el('div',{class:'form-grid two'},field('Procedure name',input(p.name||'',{maxlength:240,required:true,oninput:event=>patch('name',event.target.value)})),field('Client label',input(p.client||'',{maxlength:240,required:true,oninput:event=>patch('client',event.target.value)}))),
  field('Procedure description',textarea(p.description||'',{maxlength:16000,oninput:event=>patch('description',event.target.value)}))),
  panel('Approved references',resources,btn('Add reference resource',()=>{if(p.resources.length>=100)throw Error('This procedure already contains 100 resources.');p.resources.push({id:cleanId('reference'),title:'',kind:'note',text:''});save();redrawResources();redrawTasks();})),
  panel('Ordered preparation tasks',tasks,btn('Add procedure task',()=>{if(p.steps.length>=100)throw Error('This procedure already contains 100 tasks.');p.steps.push({id:cleanId('task'),title:'',instructions:'',required:true,resourceIds:[]});save();redrawTasks();})));
 redrawResources();redrawTasks();return box;
}
async function openCommand(id){
 setView('commands');state.selectedCommand=id;state.commandDetail=null;state.commandDraft=null;
 const ticket=++state.commandLoad;put('command-detail',empty('Opening the exact retained client request…'));renderCommandList();
 const value=await read('/commands/'+encodeURIComponent(id),{key:'command-detail'});
 if(!value||ticket!==state.commandLoad||state.selectedCommand!==id)return;
 state.commandDetail=value.command;renderCommandDetail();
 await loadCommandResult(id,ticket);
}
function renderCommandDetail(){
 const command=state.commandDetail;if(!command)return;
 const summary=(state.root?.commands||[]).find(row=>row.id===command.id),current=summary?.current!==false&&!summary?.replacedByCommandId;
 const params=command.nativeRequest;
 const successor=summary?.replacedByCommandId,predecessor=command.replacesCommandId;
 const values=[['Action',commandLabels[command.action]],['Client',clientName(command.clientId)],['Original alias',command.alias],['Prepared by',command.actor],['Prepared',formatTime(command.createdAt)],['Request edition',current?'Current selected request':'Earlier retained request'],['Original client workspace',short(command.clientWorkspaceId)],['Source revision',short(params.revision)]];
 put('command-detail',panel(commandLabels[command.action]||human(command.action),recordFacts(values),
  actions(link('Open original client Runbooks',clientRunbooks(command.alias),{target:'_blank',rel:'noopener'}),btn('Reconcile current native result',()=>loadCommandResult(command.id,state.commandLoad)))),
  panel('Prepared client operation',renderNativeRequest(command)),
  panel('Original result',el('div',{id:'command-result'},empty('Reading the saved native result…'))),
  panel('Replacement history',el('div',{class:'command-history'},
   predecessor?btn('Open previous prepared request',()=>openCommand(predecessor)):el('p',{},'This is the first prepared request in its chain.'),
   successor?btn('Open current correction',()=>openCommand(successor)):el('p',{},'No later correction is recorded for this selected request.'))),
  el('details',{class:'panel'},el('summary',{},'Exact retained request identity'),recordFacts([['Coordinator request',command.id],['Native UUID',params.requestId],['Full command hash',command.commandSha256],['Native request hash',command.nativeRequestSha256],['Native target',command.target||'New entity']])));
}
function renderNativeRequest(command){
 const p=command.nativeRequest;
 const rows=[];
 for(const [label,key] of [['Period label','label'],['Procedure name','name'],['Client label','client'],['Preparer','preparer'],['Reviewer','reviewer'],['Due date','dueDate'],['Work status','status'],['Reviewer decision','decision'],['Source type','sourceKind'],['Source label','sourceLabel'],['Selected accountant handoff','handoffId'],['Accountant edition','accountantRevisionId']])if(p[key]!==undefined)rows.push([label,key==='status'||key==='decision'||key==='sourceKind'?human(p[key]):p[key]]);
 const content=el('div',{class:'stack'},rows.length?recordFacts(rows):null);
 for(const [label,key] of [['Operation note','note'],['Description','description'],['Source note','sourceNote']])if(p[key])content.append(el('div',{},el('h4',{},label),el('p',{class:'instructions'},p[key])));
 if(p.steps)content.append(table(['Task','Required','Instructions'],p.steps.map(row=>[row.title,row.required?'Yes':'No',row.instructions])));
 for(const [label,key] of [['Original working files','fileIds'],['Original close files','sourceFileIds'],['Accepted required exceptions','acceptedExceptions']])if(p[key]?.length)content.append(recordFacts([[label,p[key].map(short).join(', ')]]));
 return content;
}
async function loadCommandResult(id,ticket=state.commandLoad){
 const command=state.commandDetail;if(!command||command.id!==id)return;
 const container=$('command-result');put(container,empty('Reconciling the original native UUID…'));
 let value;
 try{value=await read('/commands/'+encodeURIComponent(id)+'/result',{key:'command-result'});}
 catch(error){if(state.selectedCommand===id&&ticket===state.commandLoad)put(container,el('div',{class:'warning-box'},error.message));return;}
 if(!value||state.selectedCommand!==id||ticket!==state.commandLoad)return;
 if(value.commandId!==id||value.commandSha256!==command.commandSha256)throw Error('The received native result belongs to a different original command.');
 state.commandResult=value;
 const summary=state.root.commands.find(row=>row.id===id),current=summary?.current!==false&&!summary?.replacedByCommandId;
 if(value.found){
  const native=value.native;
  put(container,el('p',{},'The original client operation is committed and available for same-request receiving.'),
   recordFacts([['Native request',native.requestId||command.nativeRequest.requestId],['Client period',native.cycleId?short(native.cycleId):'—'],['Procedure edition',native.editionId?short(native.editionId):'—'],['Client revision',short(native.revision)]]),
   actions(link('Open the original client period',clientRunbooks(command.alias)+(native.cycleId?'?cycle='+encodeURIComponent(native.cycleId):''),{target:'_blank',rel:'noopener'}),btn('Read current client source',async()=>{await loadSources(command.alias,{refresh:true});await loadLive();notice('The original client source is refreshed.');})));
 }else{
  const execute=writable(btn('Execute this exact client request',()=>executeCommand(command),{class:'primary'}));execute.dataset.unavailable=String(!current);execute.disabled=!current||state.busy||Boolean(state.pending)||!state.storageReady;
  const correction=writable(btn('Correct the uncommitted request',()=>newCommand({replaces:command})));correction.dataset.unavailable=String(!current);
  put(container,el('p',{},'The original client has no committed result for this UUID.'),
   current?actions(execute,correction):el('div',{class:'read-only'},'This is an earlier prepared request. Open its recorded successor to execute the current correction.'),
   help('Execution uses the exact retained native UUID, source revision, actor and bytes. A lost reply is reconciled through this same original client result.'));
 }
 refreshWrites();
}
async function executeCommand(command){
 assertWrite();const workspaceId=state.workspaceId;
 const current=state.root.commands.find(row=>row.id===command.id);
 if(current?.current===false||current?.replacedByCommandId)throw Error('Open the current correction before dispatching this client request.');
 let pending;setBusy(true);
 try{
  const existing=await api('/commands/'+encodeURIComponent(command.id)+'/result');
  if(state.workspaceId!==workspaceId)throw Error('The coordinator changed while this native result was read. Open the original command before continuing.');
  if(existing.commandId!==command.id||existing.commandSha256!==command.commandSha256)throw Error('The prepared command changed before execution.');
  if(existing.found){await loadCommandResult(command.id,state.commandLoad);return;}
  pending={mode:'client',id:command.nativeRequest.requestId,workspaceId,type:'execute',title:commandLabels[command.action],commandId:command.id,commandSha256:command.commandSha256,route:'/commands/'+encodeURIComponent(command.id)+'/execute',
   body:{workspaceId,expectedCommandSha256:command.commandSha256},requestSha256:command.nativeRequestSha256,createdAt:new Date().toISOString()};
  await savePending(pending);
 }finally{setBusy(false);}
 await performPending(pending);
}

function renderReceivingLists(){
 const root=state.root||{};
 put('capture-list',root.captures?.length?root.captures.slice().reverse().map(capture=>el('div',{class:'list-item'},
  el('div',{class:'title'},capture.label),el('div',{class:'meta'},formatTime(capture.createdAt),String(capture.periodCount)+' client periods',bytes(capture.bytes)),
  link('Download complete portfolio',API+'/captures/'+encodeURIComponent(capture.id)+'/packet'),
  el('details',{},el('summary',{},'Retained packet identity'),recordFacts([['Packet file hash',capture.sha256],['Packet content hash',capture.packetSha256],['Original revision',capture.asOfWorkspaceRevision]]))
 )):empty('Complete portfolio captures will appear here.'));
 put('received-list',root.received?.length?root.received.slice().reverse().map(received=>listButton(received.label,[formatTime(received.receivedAt),String(received.periodCount)+' original client periods'],()=>openReceived(received.id),state.selectedReceived===received.id)):empty('Receive an original portfolio packet to view its source and client handovers.'));
}
function renderExportForm(){
 const target=$('export-form');if(!state.root){put(target,empty('Open the original portfolio workspace first.'));return;}
 const draft=state.captureDraft??={label:'',clients:[]},form=el('form',{class:'stack'}),clientsBox=el('div',{class:'stack'});
 const save=()=>saveDraft('capture',draft);
 const rows=state.root.clients||[];
 const renderClient=client=>{
  const commission=client.commission,id=client.id,section=el('section',{class:'resource-box stack'}),periods=el('div',{class:'stack'});
  let generation=0,selected=draft.clients.find(row=>row.clientId===id),source=null;
  const chooseClient=check(commission.name,Boolean(selected),checked=>{
   generation++;
   if(checked){selected={clientId:id,clientWorkspaceId:'',clientRevision:'',cycleIds:[]};draft.clients.push(selected);save();guard(()=>load(true))();}
   else{draft.clients=draft.clients.filter(row=>row.clientId!==id);selected=null;save();put(periods);}
  });
  async function load(refresh=false){
   const ticket=++generation;if(!selected){put(periods);return;}
   put(periods,empty('Reading the original client’s complete periods…'));
   const value=await loadSources(commission.alias,{refresh});
   if(ticket!==generation||!selected||!section.isConnected||!value)return;
   source=value;selected.clientWorkspaceId=value.clientWorkspaceId;selected.clientRevision=value.clientRevision;save();
   const cycles=(value.cycles||[]).filter(row=>row.runbookId===commission.runbookId);
   const choices=cycles.map(cycle=>check(cycle.label+' · '+human(cycle.phase)+' · '+formatDate(cycle.dueDate),selected.cycleIds.includes(cycle.id),checked=>{
    const ids=new Set(selected.cycleIds);checked?ids.add(cycle.id):ids.delete(cycle.id);selected.cycleIds=[...ids];save();
   }));
   put(periods,help('Include at least one complete period using the commissioned procedure edition '+short(commission.editionId)+'.'),
    cycles.length?el('div',{class:'resource-list'},choices):empty('This commissioned procedure has no original periods to capture.'),
    el('p',{class:'quiet'},'Source revision '+short(value.clientRevision)),
    actions(btn('Refresh original periods',()=>load(true)),link('Open original client desk',clientRunbooks(commission.alias),{target:'_blank',rel:'noopener'})));
  }
  section.append(chooseClient,periods);
  queueMicrotask(()=>{if(selected&&section.isConnected)guard(()=>load(false))();});
  return section;
 };
 form.append(field('Handover label',input(draft.label,{maxlength:240,required:true,oninput:event=>{draft.label=event.target.value;save();}})),help('Select all complete periods that belong in this handover. The original packet carries their procedures, sources, work, review rounds and attachments.'),clientsBox,
  writable(el('button',{type:'submit',class:'primary'},'Retain complete portfolio packet')));
 form.addEventListener('submit',guard(async event=>{
  event.preventDefault();if(!form.reportValidity())return;assertWrite();
  if(!draft.clients.length||draft.clients.some(row=>!row.cycleIds.length||!row.clientWorkspaceId||!row.clientRevision))throw Error('Choose at least one complete period in every selected client workspace.');
  if(draft.clients.length>15||draft.clients.some(row=>row.cycleIds.length>100))throw Error('Select up to 15 clients and 100 complete periods per client.');
  await prepareMutation({type:'capture',route:'/captures',fields:{label:draft.label,clients:clone(draft.clients)},scope:'capture',title:'Complete portfolio handover'});
 }));
 put(target,form);put(clientsBox,rows.length?rows.map(renderClient):empty('Commission real client workspaces before capturing a portfolio.'));refreshWrites();
}
function arrayBase64(bytes){
 let binary='';const chunk=32768;
 for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
 return btoa(binary);
}
async function inspectReceivedFile(){
 assertWrite();
 const file=$('receive-file').files[0];if(!file)throw Error('Choose the complete original portfolio packet.');
 if(file.size>64*1024*1024)throw Error('Choose a complete portfolio packet within 64 MiB.');
 const workspaceId=state.workspaceId,selectionId=uuid();
 state.receiveSelection={id:selectionId,workspaceId,name:file.name,bytes:file.size};
 put('receive-preview');$('receive-file-info').textContent='Reading the selected complete portfolio…';
 const raw=new Uint8Array(await file.arrayBuffer());
 if(state.receiveSelection?.id!==selectionId||state.workspaceId!==workspaceId)return;
 let packet;try{packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw Error('The selected file is not the original complete portfolio JSON packet.');}
 if(packet.schema!=='stellar-forge.accounting-client-portfolio-packet.v1'||!packet.metadata||!Array.isArray(packet.packets))throw Error('Select an original client-portfolio handover packet.');
 const sha256=await digestBytes(raw);
 if(state.receiveSelection?.id!==selectionId||state.workspaceId!==workspaceId)return;
 const stored={id:selectionId,workspaceId,name:file.name,bytes:raw.length,sha256,blob:new Blob([raw],{type:'application/json'})};
 await dbPut(workspaceId+'::receive-file',stored);
 if(state.receiveSelection?.id!==selectionId||state.workspaceId!==workspaceId)return;
 state.receiveSelection=stored;state.receiveInspection={label:packet.label,originWorkspaceId:packet.originWorkspaceId,packetSha256:packet.sha256,clients:packet.metadata.clients?.length||0,periods:packet.packets.length};
 renderReceiveInspection();
}
async function digestBytes(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function renderReceiveInspection(){
 const selected=state.receiveSelection,inspection=state.receiveInspection;if(!selected||!inspection)return;
 $('receive-file-info').textContent=selected.name+' · '+bytes(selected.bytes)+' · '+short(selected.sha256);
 put('receive-preview',panel('Selected original handover',
  recordFacts([['Label',inspection.label],['Original workspace',short(inspection.originWorkspaceId)],['Portfolio client records',inspection.clients],['Complete period packets',inspection.periods],['Selected file',selected.name]]),
  help('The original receiver will verify the full portfolio, client packets and hashes before retaining this handover.'),
  writable(btn('Receive complete portfolio',async()=>{
   assertWrite();if(selected.workspaceId!==state.workspaceId||state.receiveSelection?.id!==selected.id)throw Error('Select the packet in this current workspace.');
   const saved=await dbGet(draftKey('receive-file'));if(saved?.id!==selected.id)throw Error('The original selected packet is no longer retained in this browser.');
   const raw=new Uint8Array(await saved.blob.arrayBuffer());if(await digestBytes(raw)!==selected.sha256)throw Error('The retained packet bytes changed. Select the original file again.');
   if(state.workspaceId!==selected.workspaceId||state.receiveSelection?.id!==selected.id)throw Error('Select the original packet in this current workspace before receiving.');
   await prepareMutation({type:'receive',route:'/receive',fields:{content:arrayBase64(raw)},scope:'receive',title:'Received portfolio handover'});
  },{class:'primary'}))));
 refreshWrites();
}
async function openReceived(id){
 setView('receiving');state.selectedReceived=id;state.receivedDetail=null;const ticket=++state.receivedLoad;
 put('received-detail',empty('Opening the original retained portfolio and its client packets…'));renderReceivingLists();
 const value=await read('/received/'+encodeURIComponent(id),{key:'received-detail'});
 if(!value||ticket!==state.receivedLoad||state.selectedReceived!==id)return;
 state.receivedDetail=value;await renderReceivedDetail();
}
async function renderReceivedDetail(){
 const detail=state.receivedDetail;if(!detail)return;
 const {received,metadata,packets}=detail;
 const firm=metadata.firmEditions.find(row=>row.id===metadata.latestFirmEditionId);
 const sourceClients=metadata.clients.filter(client=>packets.some(packet=>packet.clientId===client.id));
 const draftKeyName='adopt:'+received.id,stored=await loadDraft(draftKeyName);
 if(state.receivedDetail!==detail)return;
 state.adoptDrafts??={};
 const draft=state.adoptDrafts[received.id]??=clone(stored?.value||{receivedId:received.id,expectedPacketSha256:received.sha256,adoptFirm:!state.root.firm,expectedFirmEditionId:state.root.firm?.id??null,bindings:[]});
 const save=()=>saveDraft(draftKeyName,draft);
 const receivingForm=el('form',{class:'stack'}),bindingsBox=el('div',{class:'stack'}),firmChoice=check('Adopt the received firm standards and named people',draft.adoptFirm,checked=>{draft.adoptFirm=checked;draft.expectedFirmEditionId=state.root.firm?.id??null;save();drawBindings();});
 function drawBindings(){
  put(bindingsBox,sourceClients.map(client=>{
   const commission=client.commissions.find(row=>row.id===client.latestCommissionId),sourcePackets=packets.filter(row=>row.clientId===client.id);
   let selected=draft.bindings.find(row=>row.sourceClientId===client.id),generation=0;
   const card=el('section',{class:'resource-box stack'}),selectionBox=el('div',{class:'stack'});
   const select=check(commission.name,Boolean(selected),checked=>{
    generation++;
    if(checked){selected={sourceClientId:client.id,clientId:uuid(),alias:'',clientWorkspaceId:'',clientRevision:'',preparerId:commission.preparerId,backupId:commission.backupId,reviewerId:commission.reviewerId};draft.bindings.push(selected);}
    else{draft.bindings=draft.bindings.filter(row=>row.sourceClientId!==client.id);selected=null;}
    save();drawSelection();
   });
   function drawSelection(){
    put(selectionBox);if(!selected)return;
    const usedAliases=new Set((state.root.clients||[]).map(row=>row.commission.alias));
    const aliases=aliasOptions().filter(row=>!usedAliases.has(row.value));
    const alias=choose(aliases,selected.alias,'Choose an unused local client workspace',value=>{
     generation++;selected.alias=value;selected.clientWorkspaceId='';selected.clientRevision='';save();guard(loadLocal)();
    });alias.required=true;
    const readiness=el('div',{class:'stack'});
    const chosenStaff=draft.adoptFirm?firm.staff:people();
    const staffFields=el('div',{class:'form-grid three'},...[
     ['Local preparer','preparerId'],['Different local backup','backupId'],['Local reviewer','reviewerId']
    ].map(([label,key])=>{const control=choose(chosenStaff.map(person=>({value:person.id,label:person.name})),selected[key],'Choose a named person',id=>{selected[key]=id;save();});control.required=true;return field(label,control);}));
    selectionBox.append(field('Local receiving workspace',alias),staffFields,readiness);
    async function loadLocal(){
     const ticket=++generation,targetAlias=selected?.alias;if(!targetAlias){put(readiness);return;}
     put(readiness,empty('Reading the current local client workspace…'));
     const source=await loadSources(targetAlias,{refresh:true});
     if(ticket!==generation||!selected||selected.alias!==targetAlias||!card.isConnected||state.receivedDetail!==detail||!source)return;
     selected.clientWorkspaceId=source.clientWorkspaceId;selected.clientRevision=source.clientRevision;save();
     const retained=new Map((source.cycles||[]).map(cycle=>[cycle.id,cycle]));
     const present=sourcePackets.filter(packet=>retained.get(packet.cycleId)?.readOnly);
     const missing=sourcePackets.filter(packet=>!retained.get(packet.cycleId)?.readOnly);
     put(readiness,el('p',{},present.length+' of '+sourcePackets.length+' original periods appear in this local receiving workspace.'),
      missing.length?el('div',{class:'warning-box'},'Download the client’s complete original period packets below and receive them through this local Runbooks desk, then refresh this selection.'):el('p',{},'The original native adoption will verify every retained period packet against its exact source hash.'),
      recordFacts([['Local workspace',short(source.clientWorkspaceId)],['Current source revision',short(source.clientRevision)]]),
      actions(link('Open this local Runbooks receiver',clientRunbooks(targetAlias),{target:'_blank',rel:'noopener'}),btn('Refresh received periods',loadLocal)));
    }
    queueMicrotask(()=>{if(selected?.alias&&card.isConnected)guard(loadLocal)();});
   }
   card.append(select,help('Original alias '+commission.alias+' · commissioned procedure '+short(commission.editionId)),
    el('div',{class:'list'},sourcePackets.map(packet=>el('div',{class:'list-item'},
     el('div',{class:'title'},'Original period '+short(packet.cycleId)),el('p',{class:'quiet'},packet.name+' · '+bytes(packet.bytes)),
     link('Download complete client period',API+'/received/'+encodeURIComponent(received.id)+'/clients/'+encodeURIComponent(client.id)+'/cycles/'+encodeURIComponent(packet.cycleId)+'/packet'),
     el('details',{},el('summary',{},'Original packet identity'),recordFacts([['Cycle ID',packet.cycleId],['Source file hash',packet.sha256],['Authoring workspace',packet.authoringWorkspaceId]]))
    ))),selectionBox);
   drawSelection();return card;
  }));
 }
 receivingForm.append(panel('Commission the received clients locally',
  help('First receive each selected client’s complete native period packets through its own local Runbooks desk. Then bind that actual receiving workspace, named team and original procedure here.'),
  firmChoice,help('Received portfolio history remains retained. This action creates explicit local client commissions for following periods.'),
  el('p',{class:'quiet'},'Local firm edition selected for adoption: '+(draft.expectedFirmEditionId?short(draft.expectedFirmEditionId):'No saved firm edition')),
  actions(btn('Review current local firm edition',async()=>{await refreshRoot();draft.expectedFirmEditionId=state.root.firm?.id??null;save();await renderReceivedDetail();})),
  bindingsBox,writable(el('button',{type:'submit',class:'primary'},'Adopt reviewed local client bindings'))));
 receivingForm.addEventListener('submit',guard(async event=>{
  event.preventDefault();if(!receivingForm.reportValidity())return;assertWrite();
  if(!draft.bindings.length||draft.bindings.some(row=>!row.alias||!row.clientWorkspaceId||!row.clientRevision))throw Error('Select and refresh every actual local receiving client before adoption.');
  if(new Set(draft.bindings.map(row=>row.alias)).size!==draft.bindings.length)throw Error('Choose a different original local workspace for each client.');
  await prepareMutation({type:'adopt',route:'/adopt',fields:clone(draft),scope:draftKeyName,title:'Local portfolio commissioning'});
 }));
 put('received-detail',panel(received.label,
  recordFacts([['Received',formatTime(received.receivedAt)],['Original firm',firm?.name],['Complete periods',packets.length],['Original workspace',short(received.originWorkspaceId)],['Original source revision',short(received.asOfWorkspaceRevision)]]),
  actions(link('Download complete received portfolio',API+'/received/'+encodeURIComponent(received.id)+'/packet')),
  el('p',{class:'identity'},'Original complete packet '+received.sha256),
  el('details',{},el('summary',{},'Received firm standards'),recordFacts([['Close standard',firm?.closeStandard],['Reporting standard',firm?.reportingStandard],['Reporting cadence',firm?.reportingCadence],['Escalation',firm?.escalationNote]])),
  el('details',{},el('summary',{},'Received close plans'),table(['Plan','Horizon','Client periods'],metadata.plans.map(plan=>[plan.label,plan.startDate+' → '+plan.endDate,plan.rows.length])))),
  receivingForm);
 drawBindings();refreshWrites();
}

async function refreshVisible(){
 const previousRevision=state.revision;await refreshRoot();
 if(state.planPreview&&state.planPreview.revision!==state.revision){state.planPreview=null;const node=$('plan-preview');if(node)put(node,empty('The coordinator changed. Preview the full current plan again before publishing.'));}
 if(state.selectedClient&&state.clientDetail&&!state.clientDraft)await openClient(state.selectedClient);
 if(state.selectedPlan&&state.planDetail&&!state.planDraft)await openPlan(state.selectedPlan);
 if(state.selectedCommand&&state.commandDetail&&!state.commandDraft)await openCommand(state.selectedCommand);
 if(state.selectedReceived&&state.receivedDetail)await openReceived(state.selectedReceived);
 if(state.view==='overview')await loadLive();
 if(previousRevision===state.revision)notice('The original portfolio is current.');
}
function bindEvents(){
 document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
 $('refresh-all').addEventListener('click',guard(refreshVisible));
 $('overview-refresh-live').addEventListener('click',guard(loadLive));
 $('operator-name').addEventListener('change',guard(async()=>{if(state.storageReady&&state.workspaceId)await dbPut(draftKey('actor'),$('operator-name').value.trim());}));
 $('add-person').addEventListener('click',guard(async()=>{
  if(!state.firmDraft)await loadFirm();if(state.firmDraft.staff.length>=100)throw Error('This firm edition already has 100 named people.');
  state.firmDraft.staff.push({id:cleanId('person'),name:'',minutesPerDay:null,workingDays:[1,2,3,4,5],holidays:[],timeOff:[]});updateFirmDraft();renderStaff();
 }));
 $('firm-form').addEventListener('input',()=>{if(state.firmDraft)updateFirmDraft();});
 $('firm-form').addEventListener('change',()=>{if(state.firmDraft)updateFirmDraft();});
 $('firm-form').addEventListener('submit',guard(async event=>{
  event.preventDefault();if(!$('firm-form').reportValidity())return;
  const fields=readFirmForm();if(!fields.staff.length)throw Error('Declare the actual named people and available time for this portfolio.');
  await prepareMutation({type:'settings',route:'/settings',fields,scope:'firm',title:'Firm standards and capacity'});
 }));
 $('reload-firm').addEventListener('click',guard(async()=>{await clearDraft('firm');await refreshRoot();await loadFirm({saved:true});}));
 $('new-client').addEventListener('click',guard(()=>editClient()));
 $('client-search').addEventListener('input',renderClientList);
 $('new-plan').addEventListener('click',guard(()=>newPlan()));
 $('new-command').addEventListener('click',guard(()=>newCommand()));
 $('command-search').addEventListener('input',renderCommandList);
 $('refresh-commands').addEventListener('click',guard(async()=>{await refreshRoot();if(state.selectedCommand)await openCommand(state.selectedCommand);}));
 $('receive-file').addEventListener('change',()=>{
  state.receiveSelection=null;state.receiveInspection=null;put('receive-preview');put('receive-file-info');
  if(state.storageReady&&state.workspaceId)dbDelete(draftKey('receive-file')).catch(error=>notice(error.message,true));
 });
 $('receive-form').addEventListener('submit',guard(async event=>{event.preventDefault();if($('receive-form').reportValidity())await inspectReceivedFile();}));
 window.addEventListener('beforeunload',event=>{if(state.draftTimers.size||state.draftWrites.size){event.preventDefault();event.returnValue='';}});
}
async function bootstrap(){
 bindEvents();
 try{await openStorage();}catch(error){state.storageReady=false;$('draft-storage-status').textContent='Private request storage is unavailable.';notice(error.message,true);}
 try{
  await refreshRoot({initial:true});
  const query=new URLSearchParams(location.search),navigation=state.storageReady?await dbGet(draftKey('navigation')):null;
  const clientId=query.get('client')||navigation?.clientId,planId=query.get('plan')||navigation?.planId,commandId=query.get('command')||navigation?.commandId,receivedId=query.get('received')||navigation?.receivedId;
  const view=query.get('view')||navigation?.view||'overview';
  setView(view);
  if(view==='clients'&&clientId)await openClient(clientId);
  else if(view==='calendar'&&planId)await openPlan(planId);
  else if(view==='commands'&&commandId)await openCommand(commandId);
  else if(view==='receiving'&&receivedId)await openReceived(receivedId);
  const file=state.storageReady?await dbGet(draftKey('receive-file')):null;
  if(file&&file.workspaceId===state.workspaceId){
   state.receiveSelection=file;
   try{const packet=JSON.parse(await file.blob.text());state.receiveInspection={label:packet.label,originWorkspaceId:packet.originWorkspaceId,packetSha256:packet.sha256,clients:packet.metadata.clients.length,periods:packet.packets.length};renderReceiveInspection();}catch{notice('The earlier selected handover could not be reopened. Select its original packet again.',true);}
  }
  if(state.pending)renderPending();
 }catch(error){$('connection-status').textContent='The original portfolio could not be opened.';notice(error.message,true);}
 refreshWrites();
}
await bootstrap();
