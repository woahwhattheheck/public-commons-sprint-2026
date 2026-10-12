// MIT. Original runtime operations, complete records and streamed receiving.
const $ = id => document.getElementById(id);
const query = (selector, within = document) => [...within.querySelectorAll(selector)];
const SESSION_KEY = 'starforge-ruby-runtime-session';
const PENDING_KEY = 'starforge-ruby-runtime-pending';
const TRANSFER_KEY = 'starforge-ruby-runtime-transfer';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE = new Set(['QUEUED','RUNNING']);
const state = { token: '', connected: false, snapshot: null, environmentId: null, applicationId: null,
  operationId: null, operation: null, application: null, tab: 'environments', pending: null, pendingRecords: [],
  transfer: null, transferRecords: [], transferFile: null, transferBusy: false, busy: false, refreshing: null,
  log: null, logStarts: [], timer: null, closed: false };
const full = value => JSON.stringify(value, null, 2);
const rubyPath = value => typeof value === 'string' ? value : value?.executable || value?.ruby_executable || '—';
const bytes = value => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value) / (1024 * 1024)) + ' MiB' : '—';
const short = value => typeof value === 'string' && value.length > 22 ? value.slice(0,18) + '…' : value || '—';
const time = value => value ? new Date(value).toLocaleString() : '—';
const errorText = issue => [issue.code, issue.message || String(issue)].filter(Boolean).join(': ');
function announce(message, kind = 'status') { $('notice').textContent = message; $('notice').dataset.kind = kind; }
function storage(key, value) {
  if (value === undefined) { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
  if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value));
}
function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}
function button(label, action) { const b = node('button',label); b.type = 'button'; b.addEventListener('click',()=>Promise.resolve().then(action).catch(issue=>announce(errorText(issue),'error'))); return b; }
function facts(target, entries) {
  target.replaceChildren();
  for (const [label,value] of entries) {
    target.append(node('dt',label),node('dd',value === undefined || value === null || value === '' ? '—' :
      typeof value === 'object' ? full(value) : String(value)));
  }
}
function listRows(target, rows, columns, empty) {
  target.replaceChildren();
  if (!rows.length) { const tr=node('tr'),td=node('td',empty,'empty');td.colSpan=columns;tr.append(td);target.append(tr); }
  else for (const tr of rows) target.append(tr);
}
function cell(tr, value, detail) {
  const td = node('td');
  if (value instanceof Node) td.append(value); else td.textContent = value ?? '—';
  if (detail) td.append(node('span',detail,'secondary'));
  tr.append(td); return td;
}
function localUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname) &&
      !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function address(value) {
  const href = localUrl(value);
  if (!href) return '—';
  const link = node('a','Open application'); link.href=href;link.target='_blank';link.rel='noopener noreferrer';return link;
}
function showTab(name) {
  state.tab = name;
  for (const b of query('[data-tab]')) {
    if (b.dataset.tab === name) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  }
  for (const panel of query('.panel')) panel.hidden = panel.id !== 'panel-' + name;
}
function submitInput(form) {
  const values = {};
  for (const [key,value] of new FormData(form)) if (typeof value === 'string' && value !== '') values[key] = value;
  return values;
}
async function api(path, input, options = {}) {
  const method = options.method ?? (input === undefined ? 'GET' : 'POST');
  const response = await fetch(path, { method, credentials:'same-origin', cache:'no-store',
    headers:{ ...(state.token ? {'x-ruby-runtime-token':state.token} : {}),
      ...(input === undefined ? {} : {'content-type':'application/json'}), ...(options.headers||{}) },
    ...(input === undefined ? {} : {body:JSON.stringify(input)}) });
  let value;
  try { value = await response.json(); }
  catch { throw Object.assign(new Error('The response was interrupted. Read the original operation before continuing.'), {code:'RESPONSE_INTERRUPTED',status:response.status}); }
  if (!response.ok) {
    if (response.status === 403) sessionState(false);
    throw Object.assign(new Error(value.message || 'The original runtime action did not complete.'), {code:value.code||value.error,status:response.status});
  }
  return value;
}
function sessionState(connected) {
  state.connected = connected;
  $('connection-state').textContent = connected ? 'Connected' : 'Private access required';
  $('session-panel').hidden = connected;
  $('refresh').disabled = !connected; $('disconnect').disabled = !connected;
}
function renderPending() {
  const p = state.pending; $('pending-panel').hidden = !p;
  const chooser=$('pending-choice');
  chooser.replaceChildren();
  for(const entry of state.pendingRecords)chooser.add(new Option(entry.label+' · '+(entry.body.operationId||entry.body.requestId||entry.body.id||entry.id),entry.id));
  chooser.value=p?.id||'';
  if (!p) return;
  $('pending-description').textContent = p.label + ' · ' + (p.body.operationId || p.body.requestId || p.body.id || '') +
    ' · ' + (p.status || 'SAVED');
  $('pending-record').textContent = full(p);
  $('pending-retry').disabled = state.busy || !state.connected || p.directory!==state.snapshot?.directory;
  $('pending-dismiss').disabled = state.busy;
}
function keepPending(value, removeId) {
  const id=removeId||value?.id||state.pending?.id;
  state.pendingRecords=state.pendingRecords.filter(item=>item.id!==id);
  if(value)state.pendingRecords.push(value);
  storage(PENDING_KEY,state.pendingRecords);
  state.pending=value||state.pendingRecords.at(-1)||null;renderPending();
}
function getEnvironment(id=state.environmentId) { return state.snapshot?.environments?.find(x=>x.id===id); }
function getApplication(id=state.applicationId) { return state.application?.id===id ? state.application : state.snapshot?.applications?.find(x=>x.id===id); }
function originalOperations() {
  const all = new Map();
  for (const item of state.snapshot?.operations || []) if (item && typeof item === 'object' && item.id) all.set(item.id,item);
  for (const env of state.snapshot?.environments || []) for (const item of env.operations || [])
    if (item && typeof item === 'object' && item.id && !all.has(item.id)) all.set(item.id,item);
  return [...all.values()].sort((a,b)=>(b.updatedAt||b.createdAt||'').localeCompare(a.updatedAt||a.createdAt||''));
}
function environmentActive(id) { return originalOperations().some(x=>x.environmentId===id && (x.active || ACTIVE.has(x.phase))); }
function environmentLast(id) { return originalOperations().find(x=>x.environmentId===id); }
function renderEnvironments() {
  const filter = $('env-filter').value.toLowerCase(), environments = state.snapshot?.environments || [];
  listRows($('environment-rows'),environments.filter(e=>[e.id,e.title,rubyPath(e.ruby),e.ruby?.ruby_version].join(' ').toLowerCase().includes(filter)).map(e=>{
    const tr=node('tr');tr.dataset.selected=String(e.id===state.environmentId);
    cell(tr,e.title||e.id,e.id);cell(tr,rubyPath(e.ruby),e.ruby?.ruby_version);cell(tr,e.phase);
    cell(tr,short(e.lockSha256||e.lock?.sha256));cell(tr,button('Review',()=>selectEnvironment(e.id)));return tr;
  }),5,'No matching environments. Add an environment or receive a complete runtime archive.');
  for (const choice of query('.environment-choice')) {
    if (document.activeElement===choice) continue;
    const selected=choice.value;choice.replaceChildren(new Option('Choose environment',''));
    for(const env of environments) choice.add(new Option((env.title||env.id)+' · '+env.id,env.id));
    choice.value=environments.some(e=>e.id===selected)?selected:'';
  }
  const e=getEnvironment();$('environment-detail').hidden=!e;
  if(!e)return;
  $('environment-title').textContent=e.title||e.id;
  facts($('environment-facts'),[['ID',e.id],['Phase',e.phase],['Ruby',rubyPath(e.ruby)],['Ruby version',e.ruby?.ruby_version],['Bundler',e.bundlerVersion],
    ['Directory',e.directory],['Source selection',e.selectionSha256],['Bundle lock',e.lockSha256||e.lock?.sha256]]);
  $('environment-record').textContent=full(e);
  $('environment-gemfile').textContent=e.gemfile?.text||'The selected environment has not returned Gemfile text.';
  $('environment-lock').textContent=e.lock?.text||'Install this environment to retain its resolved bundle lock.';
  const busy=environmentActive(e.id);
  for(const b of query('[data-env-action]'))b.disabled=state.busy||busy||!state.connected;
  const latest=environmentLast(e.id);$('env-show-operation').hidden=!latest;
  $('env-show-operation').dataset.operationId=latest?.id||'';
}
function renderApplications() {
  const filter=$('app-filter').value.toLowerCase(), apps=state.snapshot?.applications||[];
  listRows($('application-rows'),apps.filter(a=>[a.id,a.title].join(' ').toLowerCase().includes(filter)).map(a=>{
    const tr=node('tr');tr.dataset.selected=String(a.id===state.applicationId);
    cell(tr,a.title||a.id,a.id);cell(tr,a.environmentId);cell(tr,a.phase);cell(tr,address(a.current?.url));
    cell(tr,button('Review',()=>selectApplication(a.id)));return tr;
  }),5,'No matching applications. Register an original received Rails application.');
  const a=getApplication();$('application-detail').hidden=!a;if(!a)return;
  $('application-title').textContent=a.title||a.id;
  facts($('application-facts'),[['ID',a.id],['Phase',a.phase],['Environment',a.environmentId],
    ['Working copy',a.directory],['Original source',a.source?.originalDirectory||a.source],
    ['Current operation',a.current?.operationId]]);
  $('application-record').textContent=full(a);
  const running=a.current?.active||['STARTING','RUNNING','STOPPING'].includes(a.phase),href=localUrl(a.current?.url);
  $('application-launch').disabled=state.busy||running||!state.connected;
  $('application-stop').disabled=state.busy||!running||!state.connected;
  $('application-export').disabled=state.busy||running||!state.connected;
  $('application-verify').disabled=state.busy||running||!state.connected;
  $('application-open').hidden=!href||a.phase!=='RUNNING';
  if(href)$('application-open').href=href;
  $('application-state-note').textContent=running
    ? 'The current launch and its address belong to the saved application operation. Stop it before exporting its complete working copy.'
    : 'Launch the private working copy with this environment, or export the complete stopped application for receiving on another host.';
}
function renderOperations() {
  const filter=$('operation-filter').value.toLowerCase(),phase=$('operation-phase').value;
  const ops=originalOperations().filter(o=>(!phase||o.phase===phase)&&
    [o.id,o.environmentId,o.action,o.stage].join(' ').toLowerCase().includes(filter));
  listRows($('operation-rows'),ops.map(o=>{
    const tr=node('tr');tr.dataset.selected=String(o.id===state.operationId);
    cell(tr,o.action,o.id);cell(tr,o.environmentId);cell(tr,o.phase);cell(tr,o.stage);
    cell(tr,time(o.updatedAt||o.createdAt));cell(tr,button('Open',()=>selectOperation(o.id)));return tr;
  }),6,'No matching operations. Installation, verification, export and receiving appear here as they are saved.');
}
function render() {
  if(!state.snapshot)return;
  $('workspace-directory').textContent=state.snapshot.directory||'';
  renderEnvironments();renderApplications();renderOperations();renderPending();
}

function fileLink(operationId,name,label) {
  const link=node('a',label||name,'button');
  link.href='/api/file?'+new URLSearchParams({operationId,name});link.download='';return link;
}
function savedFiles(operation) {
  const found=new Map();
  const add=(value,fallback)=>{
    if(!value||typeof value!=='object')return;
    const name=value.name||value.path||fallback;
    if(typeof name==='string'&&name&&!found.has(name))found.set(name,{...value,name});
  };
  for(const collection of [operation.files,operation.result?.files]) {
    if(Array.isArray(collection))for(const file of collection)add(file);
    else if(collection&&typeof collection==='object')for(const [name,file]of Object.entries(collection))add(file,name);
  }
  add(operation.result?.archive);return [...found.values()];
}
function renderOperation() {
  const o=state.operation;$('operation-detail').hidden=!o;if(!o)return;
  $('operation-title').textContent=(o.action||'Operation')+' · '+o.id;
  facts($('operation-facts'),[['Environment',o.environmentId],['Phase',o.phase],['Stage',o.stage],
    ['Worker active',Boolean(o.active)],['Stop requested',Boolean(o.stopRequested)],['Created',time(o.createdAt)],['Updated',time(o.updatedAt)]]);
  $('operation-record').textContent=full(o);
  $('operation-error').textContent=o.error?typeof o.error==='string'?o.error:full(o.error):'';
  $('operation-resume').disabled=state.busy||!state.connected||!['FAILED','INTERRUPTED','CANCELLED'].includes(o.phase)||o.active;
  $('operation-cancel').disabled=state.busy||!state.connected||!(o.active||ACTIVE.has(o.phase))||o.stopRequested;
  const files=$('operation-files');files.replaceChildren();
  for(const file of savedFiles(o)) {
    const link=fileLink(o.id,file.name,file.name+(file.bytes!==undefined?' · '+bytes(file.bytes):''));
    link.title=file.sha256?'SHA-256 '+file.sha256:file.name;files.append(link);
  }
  if(!files.children.length)files.append(node('span','Saved outputs appear when the original operation returns them.'));
}
async function readOperation({quiet=false}={}) {
  const id=state.operationId;if(!id)return;
  const value=await api('/api/operation?'+new URLSearchParams({operationId:id}));
  if(state.operationId!==id)return;
  state.operation=value;renderOperation();
  if(!quiet||state.tab==='operations')await readLog({follow:$('log-follow').checked});
}
async function readLog({offset,follow=false}={}) {
  const id=state.operationId;if(!id)return;
  let start=offset??state.log?.offset??0;
  if(follow&&state.log)start=Math.max(0,state.log.totalBytes-65536);
  const value=await api('/api/log?'+new URLSearchParams({operationId:id,offset:String(start),limit:'65536'}));
  if(state.operationId!==id)return;
  if(follow&&value.totalBytes>start+65536)return readLog({offset:Math.max(0,value.totalBytes-65536),follow:false});
  state.log=value;
  if(!state.logStarts.includes(value.offset))state.logStarts.push(value.offset);
  state.logStarts.sort((a,b)=>a-b);
  $('operation-log').textContent=value.text;
  $('log-position').textContent='Bytes '+value.offset+'–'+value.nextOffset+' of '+value.totalBytes;
  $('log-previous').disabled=value.offset===0;
  $('log-next').disabled=value.nextOffset>=value.totalBytes;
  $('log-seek-form').elements.offset.value=String(value.offset);
  if(follow)$('operation-log').scrollTop=$('operation-log').scrollHeight;
}
async function selectOperation(id) {
  state.operationId=id;state.operation=null;state.log=null;state.logStarts=[];
  showTab('operations');$('operation-log').textContent='Reading original worker output…';
  renderOperations();await readOperation();
}
function selectEnvironment(id) { state.environmentId=id;showTab('environments');renderEnvironments(); }
async function readApplication() {
  const id=state.applicationId;if(!id)return;
  const value=await api('/api/application?'+new URLSearchParams({id}));
  if(state.applicationId!==id)return;state.application=value;renderApplications();
}
async function selectApplication(id) {
  state.applicationId=id;state.application=null;showTab('applications');renderApplications();await readApplication();
}
async function refresh({quiet=false}={}) {
  if(!state.connected)return;
  if(state.refreshing)return state.refreshing;
  state.refreshing=(async()=>{
    const snapshot=await api('/api/state');
    state.snapshot=snapshot;render();
    const reads=[];
    if(state.operationId)reads.push(readOperation({quiet:true}));
    if(state.applicationId)reads.push(readApplication());
    if(state.transfer&&state.transfer.directory===snapshot.directory)reads.push(readTransfer());
    const results=await Promise.allSettled(reads);
    const issue=results.find(x=>x.status==='rejected');
    if(issue&&!quiet)announce(errorText(issue.reason),'error');
    return snapshot;
  })();
  try{return await state.refreshing;}
  finally{state.refreshing=null;}
}
async function afterCommand(path,body,result) {
  await refresh({quiet:true});
  if(path==='/api/receive-upload/prepare'){showTab('receive');return;}
  if(path==='/api/environments/create')selectEnvironment(body.id);
  else if(path==='/api/applications/register'||path==='/api/applications/stop')await selectApplication(body.id);
  else if(body.operationId&&UUID.test(body.operationId))await selectOperation(body.operationId);
  else if(result?.id&&UUID.test(result.id))await selectOperation(result.id);
}
async function command(path,body,label,original) {
  if(state.busy)throw new Error('The current browser action is still returning.');
  if(!state.connected||!state.snapshot)throw new Error('Connect to the original runtime first.');
  const request=original||{id:crypto.randomUUID(),path,body:JSON.parse(JSON.stringify(body)),label,
    directory:state.snapshot.directory,createdAt:new Date().toISOString(),status:'SAVED'};
  if(request.directory!==state.snapshot.directory)throw new Error('Open the original runtime directory for this retained action: '+request.directory);
  state.busy=true;
  try {
    keepPending({...request,status:'SENDING'});render();
    const result=await api(request.path,request.body);
    keepPending(null,request.id);
    announce(request.label+' returned. Its original selection and operation are saved.');
    try{await afterCommand(request.path,request.body,result);}
    catch(issue){announce(request.label+' returned; '+errorText(issue),'error');}
    return result;
  } catch(issue) {
    keepPending({...request,status:issue.status?'RETURNED_ERROR':'RESPONSE_UNKNOWN',error:errorText(issue)});
    throw issue;
  } finally{state.busy=false;render();renderOperation();}
}
function downloadJSON(name,value) {
  const url=URL.createObjectURL(new Blob([full(value)+'\n'],{type:'application/json'})),a=node('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function renderTransfer(value) {
  const t=state.transfer;$('transfer-panel').hidden=!t;
  const chooser=$('transfer-choice');chooser.replaceChildren();
  for(const item of state.transferRecords)chooser.add(new Option(item.selection.id+' · '+item.selection.operationId,item.selection.operationId));
  chooser.value=t?.selection.operationId||'';chooser.disabled=state.transferBusy;
  if(!t)return;
  const v=value||t.last||t.selection;
  facts($('transfer-facts'),[['Operation',t.selection.operationId],['Environment',t.selection.id],
    ['Phase',v.phase||t.phase||'SELECTED'],['Transferred',bytes(v.receivedBytes||0)+' / '+bytes(t.selection.bytes)],
    ['Original SHA-256',t.selection.expectedSha256]]);
  $('transfer-progress').max=t.selection.bytes||1;$('transfer-progress').value=v.receivedBytes||0;
  $('transfer-record').textContent=full(t);
  const original=state.snapshot?.directory===t.directory;
  $('transfer-continue').disabled=state.transferBusy||!state.connected||!original;
  $('transfer-read').disabled=!state.connected||!original;
  $('transfer-reselect').hidden=state.transferBusy||v.phase==='RECEIVED'||Boolean(state.transferFile);
}
function saveTransfer(value) {
  state.transferRecords=state.transferRecords.filter(item=>item.selection.operationId!==value.selection.operationId);
  state.transferRecords.push(value);state.transfer=value;storage(TRANSFER_KEY,state.transferRecords);renderTransfer();
}
async function readTransfer() {
  const t=state.transfer;if(!t||t.directory!==state.snapshot?.directory)return;
  const value=await api('/api/receive-upload/status?'+new URLSearchParams({operationId:t.selection.operationId}));
  if(state.transfer?.selection.operationId!==t.selection.operationId)return value;
  saveTransfer({...state.transfer,last:value,phase:value.phase});return value;
}
async function continueTransfer(file=state.transferFile) {
  const t=state.transfer;
  if(!t||t.directory!==state.snapshot?.directory)throw new Error('Open the original runtime for this archive transfer.');
  if(state.transferBusy)throw new Error('The original archive transfer is active.');
  state.transferBusy=true;renderTransfer();
  try {
    let current;
    try{current=await readTransfer();}
    catch(issue){if(issue.status!==404&&issue.code!=='ENOENT')throw issue;current=await api('/api/receive-upload/prepare',t.selection);}
    if(current.phase!=='RECEIVED') {
      if(!file||file.size!==t.selection.bytes) {
        $('transfer-reselect').hidden=false;throw new Error('Choose the same complete archive to continue this saved transfer.');
      }
      if(['UPLOADING','VERIFYING','CHECKING_ARCHIVE'].includes(current.phase)) {
        $('transfer-message').textContent='The original host transfer is active. Read its progress before continuing.';return;
      }
      $('transfer-message').textContent='Streaming the original archive to the private runtime…';
      const response=await fetch('/api/receive-upload?'+new URLSearchParams({operationId:t.selection.operationId}),{
        method:'PUT',credentials:'same-origin',headers:{...(state.token?{'x-ruby-runtime-token':state.token}:{}),'content-type':'application/x-tar'},
        body:file,cache:'no-store'});
      let value;
      try{value=await response.json();}catch{throw new Error('The transfer response was interrupted. Read this original transfer to continue.');}
      if(!response.ok)throw Object.assign(new Error(value.message||'The original transfer did not complete.'),{code:value.code,status:response.status});
      saveTransfer({...state.transfer,last:value,phase:value.phase});
      current=value;
    }
    if(current.phase==='RECEIVED') {
      $('transfer-message').textContent='The complete archive is received. Continuing its original native receiving operation…';
      await command('/api/receive-upload/commit',{operationId:t.selection.operationId},'Receive complete runtime archive');
      saveTransfer({...state.transfer,committed:true});
      $('transfer-message').textContent='The original receiving operation is saved. Read its installation and application output in Operations.';
    }
  } finally{state.transferBusy=false;renderTransfer();}
}
async function startBrowserReceive(form) {
  if(state.transferBusy)throw new Error('Wait for the active original archive transfer to finish.');
  const input=submitInput(form),file=form.elements.file.files[0];
  if(!file||file.size<1||file.size>4*1024*1024*1024)throw new Error('Choose a complete TAR archive of at most 4 GiB.');
  const selection={operationId:crypto.randomUUID(),id:input.id,title:input.title,ruby:input.ruby,
    ...(input.bundlerVersion?{bundlerVersion:input.bundlerVersion}:{}),expectedSha256:input.expectedSha256,bytes:file.size};
  state.transferFile=file;
  const transfer={directory:state.snapshot.directory,selection,fileName:file.name,phase:'SELECTED',createdAt:new Date().toISOString()};
  saveTransfer(transfer);
  const prepared=await command('/api/receive-upload/prepare',selection,'Retain original runtime archive selection');
  if(prepared){saveTransfer({...state.transfer,last:prepared,phase:prepared.phase});showTab('receive');await continueTransfer(file);}
}

function on(id,event,action) {
  $(id).addEventListener(event,e=>{
    if(event==='submit')e.preventDefault();
    Promise.resolve().then(()=>action(e)).catch(issue=>announce(errorText(issue),'error'));
  });
}
function newOperation() { return crypto.randomUUID(); }
async function connect(token) {
  if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Enter the complete access token from the current private runtime URL.');
  state.token=token;storage(SESSION_KEY,token);
  await api('/api/session',{});sessionState(true);await refresh();
  $('session-form').reset();announce('Connected to the private runtime.');
}
async function poll() {
  if(state.closed)return;
  if(state.connected&&!document.hidden) {
    try{await refresh({quiet:true});}
    catch(issue){$('connection-state').textContent=issue.status===403?'Private access required':'Read interrupted — retrying';}
  }
  const active=state.transferBusy||originalOperations().some(o=>o.active||ACTIVE.has(o.phase));
  if(!state.closed)state.timer=setTimeout(poll,active?2000:10000);
}
for(const b of query('[data-tab]'))b.addEventListener('click',()=>{
  showTab(b.dataset.tab);
  if(state.tab==='operations'&&state.operationId)readOperation().catch(issue=>announce(errorText(issue),'error'));
});
on('refresh','click',async()=>{await refresh();announce('Current runtime state received.');});
on('disconnect','click',async()=>{
  await api('/api/session/close',{});storage(SESSION_KEY,null);state.token='';sessionState(false);
  announce('Browser disconnected. Reopen the original private runtime address to continue.');
});
on('session-form','submit',()=>connect($('session-form').elements.token.value.trim()));
on('pending-choice','change',()=>{
  state.pending=state.pendingRecords.find(x=>x.id===$('pending-choice').value)||null;renderPending();
});
on('pending-dismiss','click',()=>{keepPending(null);announce('Browser action reminder dismissed. Original runtime records remain available in Operations.');});
on('pending-retry','click',async()=>{
  const p=state.pending;if(p)await command(p.path,p.body,p.label,p);
});
on('pending-read','click',async()=>{
  const p=state.pending;if(!p)return;
  await refresh();
  if(p.directory!==state.snapshot.directory)throw new Error('This retained action belongs to '+p.directory);
  if(p.path==='/api/receive-upload/prepare'){showTab('receive');await readTransfer();}
  else if(p.body.operationId)await selectOperation(p.body.operationId);
  else if(p.path==='/api/environments/create')selectEnvironment(p.body.id);
  else if(p.body.id&&p.path.startsWith('/api/applications/'))await selectApplication(p.body.id);
});
on('show-create','click',()=>{$('create-panel').open=true;$('create-form').elements.id.focus();});
on('env-filter','input',renderEnvironments);
on('create-form','submit',async()=>{
  const input=submitInput($('create-form'));
  const result=await command('/api/environments/create',{...input,requestId:crypto.randomUUID()},'Save environment selection');
  if(result)$('create-panel').open=false;
});
on('probe-ruby','click',async()=>{
  const f=$('create-form'),ruby=f.elements.ruby.value;
  if(!ruby)throw new Error('Select the absolute Ruby executable first.');
  $('probe-ruby').disabled=true;$('probe-summary').textContent='Reading the selected interpreter…';
  try {
    const input={ruby};
    if(f.elements.bundlerVersion.value)input.bundlerVersion=f.elements.bundlerVersion.value;
    const result=await api('/api/probe',input);
    $('probe-output').textContent=full(result);$('probe-details').open=true;
    const versions=(result.bundlers||[]).map(item=>item.version).filter(Boolean);
    $('probe-summary').textContent='Ruby '+(result.ruby_version||'')+' · '+rubyPath(result)+
      (versions.length?' · Installed Bundler: '+versions.join(', '):' · Select the exact Bundler version for installation.');
  } finally{$('probe-ruby').disabled=false;}
});
for(const b of query('[data-env-action]'))b.addEventListener('click',()=>{
  const id=state.environmentId;if(!id)return;
  const action=b.dataset.envAction,body={id,operationId:newOperation(),action};
  if(['install','verify'].includes(action)&&$('environment-offline').checked)body.offline=true;
  command('/api/operations/start',body,action==='install'?'Install original environment':action==='verify'?'Inspect installed runtime':'Export complete environment')
    .catch(issue=>announce(errorText(issue),'error'));
});
on('env-show-operation','click',()=>selectOperation($('env-show-operation').dataset.operationId));
on('show-register','click',()=>{$('register-panel').open=true;$('application-form').elements.id.focus();});
on('app-filter','input',renderApplications);
on('application-form','submit',async()=>{
  const input=submitInput($('application-form'));
  const result=await command('/api/applications/register',{...input,requestId:crypto.randomUUID()},'Receive and register Rails application');
  if(result)$('register-panel').open=false;
});
on('application-launch','click',async()=>{
  const port=Number($('application-port').value);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Choose a Rails port from 1 to 65535.');
  await command('/api/applications/launch',{id:state.applicationId,operationId:newOperation(),port},'Launch original Rails application');
});
on('application-stop','click',()=>command('/api/applications/stop',{id:state.applicationId},'Stop original Rails application'));
on('application-verify','click',()=>{
  const app=getApplication();if(!app)throw new Error('Select an original application.');
  return command('/api/operations/start',{id:app.environmentId,operationId:newOperation(),action:'verify',applicationId:app.id},'Verify stopped Rails application and complete current rows');
});
on('application-export','click',()=>{
  const app=getApplication();if(!app)throw new Error('Select an original application.');
  return command('/api/operations/start',{id:app.environmentId,operationId:newOperation(),action:'export',applicationId:app.id},'Export environment and stopped application');
});

on('operation-filter','input',renderOperations);
on('operation-phase','change',renderOperations);
on('operation-refresh','click',()=>readOperation());
on('operation-resume','click',()=>command('/api/operations/resume',{operationId:state.operationId},'Resume original operation'));
on('operation-cancel','click',()=>command('/api/operations/cancel',{operationId:state.operationId},'Cancel original operation'));
on('operation-json','click',()=>{if(state.operation)downloadJSON('ruby-operation-'+state.operation.id+'.json',state.operation);});
on('saved-file-form','submit',()=>{
  if(!state.operationId)throw new Error('Select an original operation.');
  const link=fileLink(state.operationId,$('saved-file-form').elements.name.value);document.body.append(link);link.click();link.remove();
});
on('log-start','click',()=>{$('log-follow').checked=false;return readLog({offset:0});});
on('log-previous','click',()=>{
  $('log-follow').checked=false;
  const previous=state.logStarts.filter(value=>value<(state.log?.offset||0)).at(-1);
  return readLog({offset:previous??Math.max(0,(state.log?.offset||0)-65536)});
});
on('log-next','click',()=>{$('log-follow').checked=false;return readLog({offset:state.log?.nextOffset||0});});
on('log-follow','change',()=>readLog({follow:$('log-follow').checked}));
on('log-seek-form','submit',()=>{
  const offset=Number($('log-seek-form').elements.offset.value);
  if(!Number.isSafeInteger(offset)||offset<0)throw new Error('Use a nonnegative whole byte offset.');
  $('log-follow').checked=false;return readLog({offset});
});
for(const radio of query('[name=location]',$('receive-form')))radio.addEventListener('change',()=>{
  const host=$('receive-form').elements.location.value==='host';
  $('receive-host-field').hidden=!host;$('receive-file-field').hidden=host;
  $('receive-form').elements.archive.required=host;
});
on('receive-form','submit',async()=>{
  if(!state.connected||!state.snapshot)throw new Error('Connect to the private receiving runtime first.');
  const form=$('receive-form'),input=submitInput(form);
  if(input.location==='browser')return startBrowserReceive(form);
  const body={id:input.id,title:input.title,ruby:input.ruby,archive:input.archive,
    expectedSha256:input.expectedSha256,operationId:newOperation(),
    ...(input.bundlerVersion?{bundlerVersion:input.bundlerVersion}:{})};
  return command('/api/receive',body,'Receive original runtime archive from this host');
});
on('transfer-choice','change',()=>{
  if(state.transferBusy)throw new Error('The selected original transfer is active.');
  state.transfer=state.transferRecords.find(t=>t.selection.operationId===$('transfer-choice').value)||null;
  state.transferFile=null;renderTransfer();return readTransfer();
});
on('transfer-read','click',()=>readTransfer());
on('transfer-continue','click',()=>continueTransfer());
on('transfer-file','change',()=>{
  const file=$('transfer-file').files[0];
  if(!file||file.size!==state.transfer?.selection.bytes)throw new Error('Choose the same complete original archive and byte length.');
  state.transferFile=file;renderTransfer();
  $('transfer-message').textContent='Original archive selected. Continue its saved receiving operation.';
});
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&state.connected)refresh({quiet:true}).catch(issue=>announce(errorText(issue),'error'));
});
window.addEventListener('pagehide',()=>{state.closed=true;if(state.timer)clearTimeout(state.timer);});
window.addEventListener('pageshow',()=>{if(state.closed){state.closed=false;poll();}});

async function boot() {
  const fragment=new URLSearchParams(location.hash.slice(1)),given=fragment.get('token');
  try {
    const pending=storage(PENDING_KEY);
    state.pendingRecords=Array.isArray(pending)?pending:pending?[pending]:[];
    state.pending=state.pendingRecords.at(-1)||null;
    const transfers=storage(TRANSFER_KEY);
    state.transferRecords=Array.isArray(transfers)?transfers:transfers?[transfers]:[];
    state.transfer=state.transferRecords.at(-1)||null;
    renderPending();renderTransfer();
    const token=given||storage(SESSION_KEY);
    if(given)history.replaceState(null,'',location.pathname+location.search);
    if(token)await connect(token);
    else {
      state.snapshot=await api('/api/state');sessionState(true);render();await refresh();
    }
  } catch(issue) {
    if(!state.connected)sessionState(false);
    announce(errorText(issue),'error');
  } finally{poll();}
}
boot();
