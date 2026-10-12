const $ = (id) => document.getElementById(id);
const tokenKey = 'soroban-events-session:' + location.origin;
let token = new URLSearchParams(location.hash.slice(1)).get('token') ?? sessionStorage.getItem(tokenKey) ?? '';
if (token) { sessionStorage.setItem(tokenKey, token); history.replaceState(null, '', location.pathname); }
let state = null, selectedPlan = null, selectedCapture = null, nextCursor = null, shownEvents = [], selectedExport = null, busy = false, pending = null, transferring = false, eventRead = 0, eventSelection = null;
const notice = (message = '', error = false) => { $('notice').textContent = message; $('notice').dataset.error = String(error); };
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function action(label, handler) { const node = element('button', label); node.type = 'button'; node.addEventListener('click', () => run(handler)); return node; }
function mutationAction(label, handler) { const node = action(label, handler); node.dataset.mutate = ''; node.disabled = busy || Boolean(pending); return node; }
function run(work) { return Promise.resolve().then(work).catch((error) => notice(error.message, true)); }
function show(view) { for (const button of document.querySelectorAll('[data-view]')) button.classList.toggle('selected', button.dataset.view === view); for (const section of document.querySelectorAll('[id^=view-]')) section.hidden = section.id !== 'view-' + view; }
function setBusy(value) { busy = value; const disabled = value || Boolean(pending); for (const control of document.querySelectorAll('[data-mutate]')) control.disabled = disabled; $('start-capture').disabled = disabled || !selectedPlan; $('recover').disabled = value; }
function setTransferring(value) { transferring = value; $('download-export').disabled = value; $('save-export-folder').disabled = value || typeof window.showDirectoryPicker !== 'function'; }
async function request(route, body, binary = false) {
  const response = await fetch(route, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    let result; try { result = await response.json(); } catch {}
    const error = new Error(result?.error?.message ?? 'Workspace returned HTTP ' + response.status);
    error.code = result?.error?.code; error.definitive = response.status < 500;
    if (response.status === 401) { $('session').hidden = false; $('workspace').hidden = true; }
    throw error;
  }
  return binary ? new Uint8Array(await response.arrayBuffer()) : response.json();
}
function pendingKey() { return state ? 'soroban-events-pending:' + state.workspaceId : null; }
function showPending() {
  $('pending').hidden = !pending;
  $('pending-description').textContent = pending ? pending.route + ' · ' + pending.body.requestId + '\nThe original arguments are saved in this browser.' : '';
  setBusy(busy);
}
async function executePending() {
  if (!pending || busy) return;
  const operation = structuredClone(pending);
  setBusy(true); notice('Running the saved workspace operation…');
  if (operation.route.startsWith('/api/capture/')) { if (operation.body.captureId) selectedCapture = operation.body.captureId; show('captures'); }
  const progress = setInterval(() => refresh(false).catch(() => {}), 1500);
  try {
    const result = await request(operation.route, operation.body);
    pending = null; sessionStorage.removeItem(pendingKey()); showPending();
    await refresh(false).catch(() => {});
    if (result.received) { selectedCapture = result.capture.id; notice('Received and reopened edition ' + result.edition.name + '.'); show('editions'); }
    else if (result.capture) {
      selectedCapture = result.capture.id;
      notice('Capture ' + result.capture.status.toLowerCase().replaceAll('_',' ') + ' · ' + result.capture.eventCount + ' retained events' + (result.capture.lastError ? '\n' + result.capture.lastError.message : ''));
      show('captures'); renderCaptureDetail();
    } else if (result.plan) { selectedPlan = result.plan.id; fillPlan(result.plan); notice('Saved plan version ' + result.plan.currentVersion + '.'); }
    else if (result.export) { selectedExport = result.export; renderExport(); show('editions'); notice('Complete source export is ready.'); }
    else if (result.edition) { notice('Saved edition ' + result.edition.name + '.'); show('editions'); }
    return result;
  } catch (error) {
    if (error.definitive) { pending = null; sessionStorage.removeItem(pendingKey()); showPending(); await refresh(false).catch(() => {}); }
    else { showPending(); error.message += '\nRecover the saved request to keep its original identity.'; }
    throw error;
  } finally { clearInterval(progress); setBusy(false); }
}
async function mutate(route, body) {
  if (pending) throw new Error('Recover the saved original request before starting another change.');
  pending = { route, body: { ...structuredClone(body), requestId: crypto.randomUUID(), expectedRevision: state.revision } };
  sessionStorage.setItem(pendingKey(), JSON.stringify(pending)); showPending();
  return executePending();
}
async function refresh(message = true) {
  const nextState = await request('/api/state');
  if (state && nextState.workspaceId === state.workspaceId && nextState.revision < state.revision) return;
  state = nextState;
  $('session').hidden = true; $('workspace').hidden = false;
  $('network').textContent = state.connection?.network ?? 'Received source workspace';
  $('revision').textContent = 'Revision ' + state.revision;
  $('workspace-id').textContent = 'Workspace ' + state.workspaceId;
  $('connection').textContent = state.connection?.rpcOrigin ?? 'Open with a host connection file to collect new native events.';
  if (!pending) {
    const saved = sessionStorage.getItem(pendingKey());
    if (saved) { try { pending = JSON.parse(saved); } catch { sessionStorage.removeItem(pendingKey()); } }
  }
  showPending(); renderPlans(); renderCaptures(); renderEditions();
  if (message) notice('Workspace refreshed.');
}
function renderPlans() {
  const container = $('plans'); container.replaceChildren();
  for (const plan of state.plans) {
    const row = element('div', undefined, 'item');
    row.append(element('span', plan.name, 'item-title'), element('span', 'Version ' + plan.currentVersion + ' · ' + plan.versions.length + ' saved version(s)', 'item-meta'));
    row.append(action('Open plan', () => { fillPlan(plan); show('plan'); }));
    container.append(row);
  }
  if (!state.plans.length) container.append(element('p', 'Save a plan to begin capturing events.', 'muted'));
}
function filterRow(filter = { type: 'contract' }) {
  const box = element('fieldset', undefined, 'filter');
  const title = element('div', undefined, 'section-heading'); title.append(element('h3', 'Event filter'), action('Remove', () => box.remove()));
  const fields = element('div', undefined, 'fields');
  const typeLabel = element('label', 'Event type'), type = document.createElement('select'); type.dataset.field = 'type';
  for (const [value,label] of [['','All types'],['contract','Contract'],['system','System']]) { const option = element('option',label); option.value = value; type.append(option); }
  type.value = filter.type ?? ''; typeLabel.append(type);
  const contractsLabel = element('label','Contract IDs, one per line'), contracts = document.createElement('textarea'); contracts.dataset.field = 'contracts'; contracts.placeholder = 'Leave empty for all contracts'; contracts.value = (filter.contractIds ?? []).join('\n'); contractsLabel.append(contracts);
  fields.append(typeLabel, contractsLabel);
  const topicLabel = element('label','Topic filters, JSON arrays'), topics = document.createElement('textarea'); topics.dataset.field = 'topics'; topics.value = JSON.stringify(filter.topics ?? [],null,2); topicLabel.append(topics);
  box.append(title, fields, topicLabel, element('small', 'Use original base64 XDR segments, "*" for one segment, or final "**" for the remaining segments. Up to five topic alternatives.'));
  $('filters').append(box);
}
function fillPlan(plan = null) {
  selectedPlan = plan?.id ?? null;
  const version = plan?.versions.find((entry) => entry.version === plan.currentVersion);
  $('plan-heading').textContent = plan ? plan.name : 'New event plan';
  $('plan-version').textContent = plan ? 'Saved version ' + plan.currentVersion : '';
  $('plan-name').value = version?.name ?? '';
  $('start-ledger').value = version?.startLedger ?? '';
  $('end-ledger').value = version?.endLedger ?? '';
  $('page-size').value = version?.pageSize ?? 1000;
  $('filters').replaceChildren();
  for (const filter of version?.filters ?? [{type:'contract'}]) filterRow(filter);
  $('start-capture').disabled = busy || Boolean(pending) || !selectedPlan;
}
function readPlan() {
  const filters = [...$('filters').children].map((box) => {
    const filter = {}, type = box.querySelector('[data-field=type]').value;
    const contracts = box.querySelector('[data-field=contracts]').value.trim().split(/\s+/).filter(Boolean);
    const topics = JSON.parse(box.querySelector('[data-field=topics]').value || '[]');
    if (type) filter.type = type; if (contracts.length) filter.contractIds = contracts; if (topics.length) filter.topics = topics;
    return filter;
  });
  return { ...(selectedPlan ? {planId:selectedPlan} : {}), name: $('plan-name').value,
    startLedger: $('start-ledger').value ? Number($('start-ledger').value) : null,
    endLedger: $('end-ledger').value ? Number($('end-ledger').value) : null, pageSize: Number($('page-size').value), filters };
}
function renderCaptures() {
  const container = $('captures'); container.replaceChildren();
  const oldSelection = $('event-capture').value; $('event-capture').replaceChildren();
  for (const capture of [...state.captures].reverse()) {
    const row = element('div',undefined,'item'), commands = element('div',undefined,'actions');
    row.append(element('span',capture.plan.name + ' · version ' + capture.planVersion,'item-title'),
      element('span',capture.status.replaceAll('_',' ') + ' · ' + capture.eventCount + ' events · ' + capture.pages.length + ' RPC pages\n' + (capture.startLedger === null ? 'Range awaiting original network read' : 'Ledgers ' + capture.startLedger + ' to ' + capture.endLedger + ' exclusive'),'item-meta'));
    commands.append(action('Inspect', () => { selectedCapture = capture.id; renderCaptureDetail(); }));
    commands.append(action('Read events', async () => { selectedCapture = capture.id; $('event-capture').value = capture.id; show('events'); await readEvents(); }));
    if (capture.status !== 'COMPLETE') commands.append(mutationAction('Resume same capture', () => mutate('/api/capture/resume',{captureId:capture.id})));
    if (capture.status === 'COMPLETE') commands.append(mutationAction('Save edition', () => {
      const name = prompt('Edition name', capture.plan.name + ' · ' + capture.startLedger + '–' + (capture.endLedger-1));
      if (name?.trim()) return mutate('/api/edition',{captureId:capture.id,name:name.trim()});
    }));
    row.append(commands); container.append(row);
    const option = element('option',capture.plan.name + ' · ' + capture.status + ' · ' + capture.id.slice(0,8)); option.value = capture.id; $('event-capture').append(option);
  }
  if (state.captures.some((capture) => capture.id === oldSelection)) $('event-capture').value = oldSelection;
  if (selectedCapture) renderCaptureDetail();
  if (!state.captures.length) container.append(element('p','Capture a saved plan to retain its original RPC events.','muted'));
}
function renderCaptureDetail() {
  const capture = state.captures.find((entry) => entry.id === selectedCapture);
  $('capture-detail').hidden = !capture;
  $('capture-json').textContent = capture ? JSON.stringify(capture,null,2) : '';
  if (capture) $('capture-detail').open = true;
}
async function readEvents(after = null) {
  const captureId = $('event-capture').value;
  if (!captureId) return notice('Select an original capture.');
  const query = new URLSearchParams({ captureId,limit:'100' });
  if ($('event-contract').value.trim()) query.set('contractId',$('event-contract').value.trim());
  if ($('event-type').value) query.set('type',$('event-type').value);
  const selection = query.toString(), requestNumber = ++eventRead;
  if (after && selection === eventSelection) query.set('after',after);
  const result = await request('/api/events?' + query);
  if (requestNumber !== eventRead) return;
  eventSelection = selection; shownEvents = result.rows; nextCursor = result.nextCursor;
  $('events-next').disabled = !nextCursor;
  $('event-count').textContent = result.total + ' matching retained event(s) · ' + shownEvents.length + ' on this page · ' + (result.complete ? 'Complete selected range' : 'Capture still in progress');
  const body = $('event-rows'); body.replaceChildren();
  for (const event of shownEvents) {
    const row = document.createElement('tr');
    row.append(element('td',event.ledger),element('td',event.ledgerClosedAt));
    const identity = element('td'); identity.append(element('strong',event.type),element('code',event.contractId ?? '', 'muted'));
    const detail = element('td'); detail.append(element('code',event.id),action('View full event',() => { $('event-json').textContent=JSON.stringify(event,null,2); $('event-dialog').showModal(); }));
    row.append(identity,detail); body.append(row);
  }
}
function renderEditions() {
  const container = $('editions'); container.replaceChildren();
  for (const edition of [...state.editions].reverse()) {
    const row = element('div',undefined,'item'), commands = element('div',undefined,'actions');
    row.append(element('span',edition.name,'item-title'),element('span',edition.eventCount + ' events · ' + edition.network + '\nLedgers ' + edition.startLedger + ' to ' + edition.endLedger + ' exclusive\n' + edition.sha256,'item-meta'));
    commands.append(mutationAction('Export complete source',() => mutate('/api/export',{editionId:edition.id})),
      action('Publisher source',async () => { const source=await request('/api/publisher-source?'+new URLSearchParams({editionId:edition.id})); notice(JSON.stringify(source,null,2)); }));
    row.append(commands); container.append(row);
  }
  if (!state.editions.length) container.append(element('p','Select a completed capture and save its first edition.','muted'));
  if (selectedExport) renderExport();
}
async function sha256(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((value) => value.toString(16).padStart(2,'0')).join(''); }
function exportFile(exported, path) { return path === 'manifest.json' ? {path,sha256:exported.manifestSha256} : exported.manifest.files.find((file) => file.path === path); }
async function sourceBytes(exported, path) {
  const file = exportFile(exported, path);
  if (!file) throw new Error('The selected original export does not contain ' + path);
  const bytes = await request('/api/source-file?' + new URLSearchParams({exportId:exported.id,path}), undefined, true);
  if ((file.bytes !== undefined && file.bytes !== bytes.length) || await sha256(bytes) !== file.sha256) throw new Error('Received source bytes differ from the selected original export: ' + path);
  return bytes;
}
function download(name, bytes, type='application/octet-stream') {
  const url=URL.createObjectURL(new Blob([bytes],{type})), link=document.createElement('a'); link.href=url; link.download=name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function renderExport() {
  const exported = structuredClone(selectedExport);
  $('export').hidden=false; $('export-directory').textContent=exported.directory;
  $('export-manifest').textContent='Manifest SHA-256: ' + exported.manifestSha256;
  const body=$('export-files'); body.replaceChildren();
  for(const file of [{path:'manifest.json',bytes:null},...exported.manifest.files]) {
    const row=document.createElement('tr'), command=document.createElement('td');
    row.append(element('td',file.path),element('td',file.bytes===null?'Manifest':file.bytes.toLocaleString()));
    command.append(action('Download',async()=>download(file.path.split('/').at(-1),await sourceBytes(exported,file.path),'application/json')));
    row.append(command);body.append(row);
  }
  setTransferring(transferring);
}
const CRC_TABLE=Array.from({length:256},(_,number)=>{let c=number;for(let bit=0;bit<8;bit++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);return(crc^0xffffffff)>>>0;}
function header(length){const bytes=new Uint8Array(length);return{bytes,view:new DataView(bytes.buffer)};}
async function downloadArchive(){
  if(!selectedExport || transferring)return;
  const exported = structuredClone(selectedExport);
  if(exported.manifest.bytes>256*1024*1024)throw new Error('Use Save source folder for an export larger than 256 MiB.');
  setTransferring(true);
  try {
  const entries=[{path:'manifest.json'},...exported.manifest.files],local=[],central=[];let offset=0;
  if(entries.length>65535)throw new Error('Use Save source folder for this export.');
  for(let index=0;index<entries.length;index++){
    const file=entries[index],bytes=await sourceBytes(exported,file.path),name=new TextEncoder().encode(file.path),crc=crc32(bytes);
    $('export-progress').textContent='Receiving original file '+(index+1)+' of '+entries.length;
    const lh=header(30);lh.view.setUint32(0,0x04034b50,true);lh.view.setUint16(4,20,true);lh.view.setUint16(6,0x800,true);lh.view.setUint16(12,33,true);lh.view.setUint32(14,crc,true);lh.view.setUint32(18,bytes.length,true);lh.view.setUint32(22,bytes.length,true);lh.view.setUint16(26,name.length,true);
    const ch=header(46);ch.view.setUint32(0,0x02014b50,true);ch.view.setUint16(4,20,true);ch.view.setUint16(6,20,true);ch.view.setUint16(8,0x800,true);ch.view.setUint16(14,33,true);ch.view.setUint32(16,crc,true);ch.view.setUint32(20,bytes.length,true);ch.view.setUint32(24,bytes.length,true);ch.view.setUint16(28,name.length,true);ch.view.setUint32(42,offset,true);
    local.push(lh.bytes,name,bytes);central.push(ch.bytes,name);offset+=30+name.length+bytes.length;
  }
  const centralBytes=central.reduce((total,part)=>total+part.length,0),end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,entries.length,true);end.view.setUint16(10,entries.length,true);end.view.setUint32(12,centralBytes,true);end.view.setUint32(16,offset,true);
  download('soroban-events-'+exported.editionId+'.zip',new Blob([...local,...central,end.bytes]),'application/zip');$('export-progress').textContent='Complete source ZIP downloaded for edition ' + exported.editionId + '.';
  } finally { setTransferring(false); }
}
async function saveFolder(){
  if(!selectedExport || transferring)return;
  const exported = structuredClone(selectedExport);
  setTransferring(true);
  try {
    const root=await window.showDirectoryPicker({mode:'readwrite'});
    const folder=await root.getDirectoryHandle('soroban-events-'+exported.id.slice(0,16),{create:true});
    const entries=[{path:'manifest.json'},...exported.manifest.files];
    for(let index=0;index<entries.length;index++){
      const file=entries[index],parts=file.path.split('/');let target=folder;
      for(const part of parts.slice(0,-1))target=await target.getDirectoryHandle(part,{create:true});
      let existing;try{existing=await target.getFileHandle(parts.at(-1));}catch(error){if(error.name!=='NotFoundError')throw error;}
      if(existing){
        const original=exportFile(exported,file.path),saved=await existing.getFile();
        if((original.bytes!==undefined && original.bytes!==saved.size) || await sha256(await saved.arrayBuffer())!==original.sha256)throw new Error('The selected folder contains different original bytes at '+file.path+'. Choose a new destination folder.');
      } else {
        const bytes=await sourceBytes(exported,file.path);
        const handle=await target.getFileHandle(parts.at(-1),{create:true}),writer=await handle.createWritable();
        try{await writer.write(bytes);await writer.close();}
        catch(error){await writer.abort().catch(()=>{});await target.removeEntry(parts.at(-1)).catch(()=>{});throw error;}
      }
      $('export-progress').textContent='Saved original file '+(index+1)+' of '+entries.length;
    }
    $('export-progress').textContent='Complete source folder saved for edition ' + exported.editionId + '.';
  } finally { setTransferring(false); }
}
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>show(button.dataset.view));
$('session-form').addEventListener('submit',(event)=>{event.preventDefault();token=$('session-token').value.trim();sessionStorage.setItem(tokenKey,token);run(()=>refresh());});
$('refresh').addEventListener('click',()=>run(()=>refresh()));
$('recover').addEventListener('click',()=>run(executePending));
$('new-plan').addEventListener('click',()=>{fillPlan();show('plan');});
$('add-filter').addEventListener('click',()=>{if($('filters').children.length>=5)return notice('Use at most five native event filters.',true);filterRow();});
$('plan-form').addEventListener('submit',(event)=>{event.preventDefault();run(()=>mutate('/api/plan',readPlan()));});
$('start-capture').addEventListener('click',()=>run(()=>mutate('/api/capture/start',{planId:selectedPlan})));
$('event-filter-form').addEventListener('submit',(event)=>{event.preventDefault();run(()=>readEvents());});
$('events-first').addEventListener('click',()=>run(()=>readEvents()));
$('events-next').addEventListener('click',()=>run(()=>readEvents(nextCursor)));
$('events-download').addEventListener('click',()=>download('soroban-events-page.json',JSON.stringify(shownEvents,null,2)+'\n','application/json'));
$('close-event').addEventListener('click',()=>$('event-dialog').close());
$('receive-form').addEventListener('submit',(event)=>{event.preventDefault();run(()=>{
  const sourceDirectory=$('source-directory').value.trim(),expectedManifestSha256=$('source-manifest-sha256').value.trim();
  if(!sourceDirectory.startsWith('/'))throw new Error('Enter the absolute source directory on this operator host.');
  return mutate('/api/receive',{sourceDirectory,...(expectedManifestSha256?{expectedManifestSha256}:{})});
});});
$('download-export').addEventListener('click',()=>run(downloadArchive));
$('save-export-folder').addEventListener('click',()=>run(saveFolder));
fillPlan();
if(token)run(()=>refresh(false));else $('session').hidden=false;
