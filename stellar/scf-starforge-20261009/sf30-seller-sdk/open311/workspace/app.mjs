const $ = (id) => document.getElementById(id);
const views = new Set(['requests','reviews','catalog','changes','connections','handover']);
const reviewLabels = {new:'New',assigned:'Assigned',in_progress:'In progress',done:'Done'};
const preferencesKey = 'commons.open311.preferences.v1';
const pendingKey = 'commons.open311.pending.v1:' + location.origin;
const draftsKey = 'commons.open311.review-drafts.v1:' + location.origin;
let workspace = null;
let preferences = readLocal(preferencesKey, {});
let connectionId = typeof preferences.connectionId === 'string' ? preferences.connectionId : '';
let captureId = typeof preferences.captureId === 'string' ? preferences.captureId : '';
let view = views.has(preferences.view) ? preferences.view : 'requests';
let offset = 0;
let page = {items:[],total:0,offset:0,limit:50};
let selected = null;
let catalog = {items:[],capture:null};
let comparison = null;
let comparisonIds = null;
let comparisonOffset = 0;
let comparisonSequence = 0;
let pending = null;
let busy = false;
let requestSequence = 0;
let catalogSequence = 0;
let detailSequence = 0;
let receiveBundle = null;
let receiveFilename = '';
let draftCache = readSession(draftsKey, {});
let editConnectionId = '';
let dbPromise = null;

function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function readSession(key, fallback) {
  try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function savePreferences() {
  preferences = {view,connectionId,captureId};
  try { localStorage.setItem(preferencesKey, JSON.stringify(preferences)); } catch {}
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function text(id, value) { $(id).textContent = value === undefined || value === null ? '' : String(value); }
function json(value) { return JSON.stringify(value, null, 2); }
function date(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return String(value);
  return parsed.toISOString().replace('T',' ').replace(/\.\d{3}Z$/, ' UTC');
}
function short(value, length = 12) { return String(value || '').slice(0,length); }
function connection() { return workspace?.connections?.find((item) => item.id === connectionId) || null; }
function connectionName(id) { return workspace?.connections?.find((item) => item.id === id)?.name || id || '—'; }
function capturesFor(id = connectionId, requestOnly = false) {
  return (workspace?.captures || []).filter((item) => item.connectionId === id && (!requestOnly || ['requests','request'].includes(item.kind || 'requests'))).sort((a,b) => String(b.capturedAt).localeCompare(String(a.capturedAt)));
}
function selectedCapture() { return workspace?.captures?.find((item) => item.id === captureId) || null; }
function captureLabel(item) { return date(item.capturedAt) + ' · ' + (item.kind || 'requests') + ' · ' + (item.rowCount ?? '?') + ' rows · ' + short(item.id,8); }
function coverage(item) { return item.complete === true ? 'Returned selection complete' : item.complete === false ? 'Partial returned selection' : 'Coverage unspecified'; }
function status(item) { return item?.status ?? item?.sourceStatus ?? item?.source?.status ?? '—'; }
function serviceCode(item) { return item?.serviceCode ?? item?.service_code ?? item?.code ?? ''; }
function serviceName(item) { return item?.serviceName ?? item?.service_name ?? item?.name ?? ''; }
function requestId(item) { return item?.serviceRequestId ?? item?.service_request_id ?? item?.id ?? ''; }
function objectText(value) { return value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''); }
function notify(message, kind = 'info') {
  const node = $('notice');
  node.hidden = !message;
  node.dataset.kind = kind;
  node.textContent = message || '';
}
function button(label, handler, className = 'secondary') {
  const node = element('button', label, className);
  node.type = 'button';
  node.addEventListener('click', () => safely(handler));
  return node;
}
function cell(row, value, className) {
  const node = element('td', value, className);
  row.append(node);
  return node;
}
function emptyRows(id, columns, message) {
  const row = element('tr');
  const node = cell(row, message, 'empty-cell');
  node.colSpan = columns;
  $(id).replaceChildren(row);
}
function options(id, items, current, placeholder) {
  const select = $(id);
  const fragment = document.createDocumentFragment();
  if (placeholder !== undefined) {
    const option = element('option', placeholder);
    option.value = '';
    fragment.append(option);
  }
  for (const item of items) {
    const option = element('option', item.label);
    option.value = String(item.value);
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  select.value = current || '';
}
function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function sourceLink(label, value) {
  const href = safeUrl(value);
  if (!href) return null;
  const anchor = element('a', label);
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}
async function safely(task) {
  try { await task(); } catch (error) { if (error.name !== 'AbortError') notify(error.message || String(error), 'error'); }
}
async function api(path, init = {}) {
  const response = await fetch(path, {...init, credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(init.headers || {})}});
  let result;
  try { result = await response.json(); } catch {
    const error = new Error('The local service returned an incomplete JSON response. Inspect the saved operation before retrying a write.');
    error.status = response.status;
    error.uncertain = true;
    throw error;
  }
  if (!response.ok) {
    const detail = result?.error;
    const error = new Error(typeof detail === 'string' ? detail : detail?.message || result?.message || 'The local operation failed.');
    error.status = response.status;
    error.code = detail?.code || 'HTTP_' + response.status;
    error.details = detail?.details;
    throw error;
  }
  return result;
}
function queryPath(path, params) {
  const query = new URLSearchParams();
  for (const [key,value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') query.set(key,String(value));
  return path + (query.size ? '?' + query.toString() : '');
}
async function openCommandDatabase() {
  if (!globalThis.indexedDB) return null;
  if (!dbPromise) dbPromise = new Promise((resolve) => {
    let finished = false;
    const finish = (value) => { if (finished) { value?.close(); return; } finished = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => finish(null), 4000);
    try {
      const request = indexedDB.open('commons-open311-commands-v1',1);
      request.onupgradeneeded = () => request.result.createObjectStore('commands');
      request.onsuccess = () => finish(request.result);
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch { finish(null); }
  });
  return dbPromise;
}
async function pendingStorage(action, value) {
  const database = await openCommandDatabase();
  if (database) return new Promise((resolve,reject) => {
    const transaction = database.transaction('commands',action === 'read' ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('commands');
    const request = action === 'read' ? store.get(pendingKey) : action === 'delete' ? store.delete(pendingKey) : store.put(value,pendingKey);
    let result = null;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('Could not retain the original operation in browser storage.'));
    transaction.onabort = () => reject(transaction.error || new Error('The browser cancelled operation retention.'));
  });
  try {
    if (action === 'read') return readLocal(pendingKey,null);
    if (action === 'delete') localStorage.removeItem(pendingKey);
    else localStorage.setItem(pendingKey,JSON.stringify(value));
  } catch {
    throw new Error('The browser cannot retain this command. Free space in this browser’s local storage, then submit the same form again.');
  }
  return null;
}
function pendingDescription() {
  if (!pending) return '';
  if (pending.state === 'rejected') return 'The service returned a definitive rejection. Inspect the saved outcome, then close this command to prepare a corrected input.';
  if (pending.state === 'completed') return 'This operation has a saved result. Inspect the result and reopen the current workspace state.';
  if (pending.state === 'absent') return 'No saved operation was returned for this original request ID. Its complete original command is retained for retry.';
  return 'The original command is retained. Inspect its saved outcome after a lost response, or retry with the same ID and original input.';
}
function renderPending() {
  $('pending-panel').hidden = !pending;
  if (!pending) return;
  text('pending-description',pendingDescription());
  text('pending-id',pending.requestId);
  text('pending-json',json(pending));
  $('pending-inspect').disabled = busy;
  $('pending-retry').disabled = busy || ['completed','rejected'].includes(pending.state);
  $('pending-dismiss').hidden = !['completed','rejected','absent'].includes(pending.state);
  $('pending-dismiss').disabled = busy;
  $('pending-download').disabled = busy;
}
function setBusy(value) {
  busy = value;
  document.body.classList.toggle('busy',value);
  for (const id of ['capture-submit','catalog-refresh','receive-submit']) {
    const node = $(id);
    if (node) node.disabled = value || (id === 'receive-submit' && (!receiveBundle || !isEmptyWorkspace())) || (id === 'catalog-refresh' && !connectionId);
  }
  renderPending();
}
function assertWriteReady() {
  if (!workspace) throw new Error('Open the saved workspace before making a change.');
  if (busy) throw new Error('The current operation is still running.');
  if (pending) throw new Error('Reconcile the retained operation shown above before preparing another write.');
}
async function mutate(endpoint, input) {
  assertWriteReady();
  const requestId = crypto.randomUUID();
  const command = {
    schema:'commons.open311.browser-command.v1',
    origin:location.origin,
    workspaceId:workspace.workspaceId,
    requestId,
    endpoint,
    payload:{requestId,expectedRevision:workspace.revision,...input},
    createdAt:new Date().toISOString(),
    state:'prepared'
  };
  await pendingStorage('write',command);
  pending = command;
  renderPending();
  return sendPending();
}
async function sendPending() {
  if (!pending || busy) return null;
  const command = pending;
  let acceptedResult = null;
  setBusy(true);
  notify('Running the original saved command…');
  try {
    const result = await api(command.endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Open311-Workspace':command.workspaceId},
      body:JSON.stringify(command.payload)
    });
    acceptedResult = result;
    pending = {...command,state:'completed',result};
    await pendingStorage('write',pending).catch(() => {});
    await pendingStorage('delete').catch(() => {});
    pending = null;
    await refreshState();
    notify('Saved. Workspace revision ' + workspace.revision + '.');
    return result;
  } catch (error) {
    if (acceptedResult !== null) {
      pending = {...command,state:'completed',result:acceptedResult,lastError:{message:'Saved result received; state refresh failed: '+error.message,at:new Date().toISOString()}};
      await pendingStorage('write',pending).catch(() => {});
      notify('The operation saved successfully. Reload the workspace or inspect its retained result to recover the current view.','error');
      return acceptedResult;
    }
    const retainedCodes = new Set(['OPERATION_RUNNING','OPERATION_PENDING','CAPTURE_NOT_READY']);
    const definitive = !error.uncertain && !retainedCodes.has(error.code) && error.status >= 400 && error.status < 500 && ![408,429].includes(error.status);
    pending = {...command,state:definitive ? 'rejected' : 'uncertain',lastError:{message:error.message,code:error.code || null,status:error.status || null,at:new Date().toISOString()}};
    await pendingStorage('write',pending).catch(() => {});
    notify(error.message,'error');
    throw error;
  } finally {
    setBusy(false);
    renderPending();
  }
}
async function inspectPending() {
  if (!pending) return;
  let response;
  try { response = await api(queryPath('/api/operation',{requestId:pending.requestId})); }
  catch (error) { if (error.status===404 && error.code==='OPERATION_NOT_FOUND') response=null; else throw error; }
  const operation = response?.operation ?? response;
  if (!operation || !operation.requestId) {
    pending = {...pending,state:'absent',inspection:{at:new Date().toISOString(),operation:null}};
    notify('The local journal returned no operation for this original request ID. The original input remains available for retry.');
  } else {
    const state = String(operation.state || '').toLowerCase();
    const done = ['completed','complete','succeeded','success','applied','saved'].includes(state) || (operation.result !== null && operation.result !== undefined && !operation.error);
    const failed = ['failed','rejected','error'].includes(state) && !operation.result;
    pending = {...pending,state:done ? 'completed' : failed ? 'rejected' : 'uncertain',inspection:{at:new Date().toISOString(),operation}};
    notify(done ? 'The original operation has a saved result. Reloaded workspace state is available.' : failed ? 'The original operation has a recorded failure. Review its result before preparing corrected input.' : 'The journal retained this operation with state ' + (operation.state || 'unknown') + '.');
    if (done) await refreshState();
  }
  await pendingStorage('write',pending);
  renderPending();
  $('pending-details').open = true;
}
async function dismissPending() {
  if (!pending || !['completed','rejected','absent'].includes(pending.state)) return;
  await pendingStorage('delete');
  pending = null;
  renderPending();
  await refreshState();
}
function showInspector(title,value,description = '',actions = []) {
  text('inspector-title',title);
  text('inspector-description',description);
  text('inspector-content',json(value));
  $('inspector-actions').replaceChildren(...actions);
  if (!$('inspector').open) $('inspector').showModal();
}
function filename(value,fallback) {
  let name = String(value || fallback).split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g,'').trim();
  return name || fallback;
}
function downloadBlob(blob,name) {
  const url = URL.createObjectURL(blob);
  const anchor = element('a');
  anchor.href = url;
  anchor.download = filename(name,'open311-export.json');
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url),30000);
}
function downloadJson(value,name) { downloadBlob(new Blob([json(value) + '\n'],{type:'application/json;charset=utf-8'}),name); }
function csvValue(value) {
  let valueText = objectText(value);
  if (/^(?:[\u0000-\u0020]*[=+\-@]|[\t\r\n])/.test(valueText)) valueText = "'" + valueText;
  return '"' + valueText.replace(/"/g,'""') + '"';
}
function downloadCsv(headers,rows,name) {
  const content = '\uFEFF' + [headers,...rows].map((row) => row.map(csvValue).join(',')).join('\r\n') + '\r\n';
  downloadBlob(new Blob([content],{type:'text/csv;charset=utf-8'}),name);
}
async function downloadExport(kind,id = captureId) {
  if (kind !== 'workspace' && !id) throw new Error('Select a saved capture to export.');
  const path = queryPath('/api/export',{kind,capture:kind === 'workspace' ? undefined : id});
  const response = await fetch(path,{credentials:'same-origin',cache:'no-store'});
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error?.message || 'The saved export could not be opened.');
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const extended = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const ordinary = disposition.match(/filename="?([^";]+)"?/i);
  let name = ordinary?.[1];
  if (extended) { try { name = decodeURIComponent(extended[1]); } catch {} }
  const extension = kind === 'csv' ? 'csv' : kind === 'report' ? 'html' : 'json';
  downloadBlob(await response.blob(),name || 'open311-' + kind + '-' + (id ? short(id) : short(workspace?.workspaceId)) + '.' + extension);
}
async function inspectCapture(id) {
  if (!id) throw new Error('Select a saved capture first.');
  const value = await api(queryPath('/api/capture',{id}));
  showInspector('Saved capture ' + short(id),value,'Complete saved metadata, normalized records and original decoded source.',[
    button('Download exact source',() => downloadExport('source',id)),
    button('Download capture JSON',() => downloadExport('json',id)),
    button('Download customer report',() => downloadExport('report',id))
  ]);
}
async function inspectOperation(id) {
  if (!id) throw new Error('Enter the original request ID.');
  const result = await api(queryPath('/api/operation',{requestId:id}));
  showInspector('Saved operation',result,'Original request ID: ' + id,[button('Download saved result',() => downloadJson(result,'open311-operation-' + filename(id,'result') + '.json'))]);
}
function switchView(next) {
  if (!views.has(next)) return;
  view = next;
  for (const node of document.querySelectorAll('[data-panel]')) node.hidden = node.dataset.panel !== view;
  for (const node of document.querySelectorAll('[data-view]')) {
    if (node.dataset.view === view) node.setAttribute('aria-current','page');
    else node.removeAttribute('aria-current');
  }
  savePreferences();
  if (view === 'reviews') renderQueue();
  if (view === 'catalog') safely(loadCatalog);
  if (view === 'changes') renderDiffSelectors();
  if (view === 'handover') renderHandover();
}
async function refreshState() {
  workspace = await api('/api/state');
  if (!Array.isArray(workspace.connections) || !Array.isArray(workspace.captures) || !Number.isFinite(workspace.revision)) throw new Error('The saved workspace response is missing its connections, captures, or revision.');
  if (!workspace.connections.some((item) => item.id === connectionId)) connectionId = workspace.connections[0]?.id || '';
  const captures = capturesFor(connectionId,true);
  if (!captures.some((item) => item.id === captureId)) captureId = captures[0]?.id || '';
  text('workspace-name','Workspace ' + short(workspace.workspaceId,16));
  $('workspace-name').title = workspace.workspaceId || '';
  text('workspace-revision','Saved revision ' + workspace.revision);
  options('active-connection',workspace.connections.map((item) => ({value:item.id,label:item.name || item.id})),connectionId,workspace.connections.length ? 'Choose a connection' : 'No saved connections');
  renderConnectionContext();
  renderCaptureSelectors();
  renderConnections();
  renderCaptureHistory();
  renderQueue();
  renderHandover();
  renderDiffSelectors();
  renderPending();
  savePreferences();
  await loadRequests();
  if (view === 'catalog') await loadCatalog();
}
function renderConnectionContext() {
  const current = connection();
  text('connection-context',current ? (current.jurisdictionId ? current.jurisdictionId + ' · ' : '') + current.baseUrl : 'Add a connection to begin.');
  text('capture-connection',current?.name || 'No connection selected');
  $('catalog-refresh').disabled = !current || busy;
  $('toggle-capture').disabled = !current;
  $('capture-extended-field').hidden = !current?.extendedAttributes;
  $('capture-extended').checked = !!current?.extendedAttributes;
  $('capture-page-size').value = current?.responseLimit || 1000;
  $('capture-page-size').max = current?.responseLimit || 1000;
  $('capture-page').value = '1';
  const extensionFields = document.createDocumentFragment();
  for (const key of current?.queryExtensions || []) {
    const label = element('label',null,'field');
    label.append(element('span',key));
    const input = element('input');
    input.dataset.queryExtension = key;
    input.autocomplete = 'off';
    label.append(input);
    extensionFields.append(label);
  }
  $('capture-extension-fields').replaceChildren(extensionFields);
  text('capture-scope-help',current ? 'This provider is configured for ' + (current.pagination ? 'page / page_size pagination' : 'a single returned collection') + ' with response limit ' + (current.responseLimit || 1000) + '. The capture retains its exact query and returned source.' : 'Choose a connection to capture its source.');
  renderStatusOptions();
  renderCaptureKind();
}
function renderStatusOptions() {
  const values = new Set(['open','closed',...(connection()?.statusValues || []),...(selectedCapture()?.statuses || []),...page.items.map((item) => status(item))]);
  $('source-statuses').replaceChildren(...[...values].filter((value) => value && value !== '—').sort().map((value) => { const item=element('option');item.value=String(value);return item; }));
}
function renderCaptureSelectors() {
  const captures = capturesFor(connectionId,true);
  const entries = captures.map((item) => ({value:item.id,label:captureLabel(item)}));
  options('request-capture',entries,captureId,captures.length ? 'Choose a capture' : 'No saved request captures');
  options('export-capture',entries,$('export-capture').value || captureId,captures.length ? 'Choose a capture' : 'No saved request captures');
  text('nav-request-count',selectedCapture()?.rowCount ?? '');
  const current = selectedCapture();
  text('capture-context',current ? coverage(current) + ' · ' + date(current.capturedAt) + ' · query ' + objectText(current.query || {}) + (current.scope?.fixed === false ? ' · Rolling or provider-default source selection' : '') : 'Select a connection and capture its requests.');
  $('inspect-capture').disabled = !current;
  $('download-source').disabled = !current;
}
function renderCaptureHistory() {
  const items = capturesFor();
  if (!items.length) { emptyRows('capture-history',6,'This connection has no saved source captures.');return; }
  const rows = items.map((item) => {
    const row=element('tr');
    cell(row,date(item.capturedAt));
    cell(row,item.kind || 'requests');
    cell(row,item.rowCount ?? '—');
    cell(row,coverage(item));
    cell(row,objectText(item.query || {}));
    const actions=cell(row);actions.append(button('Inspect',() => inspectCapture(item.id)));
    return row;
  });
  $('capture-history').replaceChildren(...rows);
}
async function chooseConnection(id) {
  detailSequence++;
  comparisonSequence++;
  connectionId = id;
  $('active-connection').value = id;
  captureId = capturesFor(id,true)[0]?.id || '';
  selected = null;
  catalog = {items:[],capture:null};
  comparison = null;
  comparisonIds = null;
  $('request-detail').hidden = true;
  $('diff-summary').hidden = true;
  $('diff-toolbar').hidden = true;
  emptyRows('diff-rows',6,'Choose two captures and compare their saved records.');
  text('diff-range','');
  offset=0;
  renderConnectionContext();
  renderCaptureSelectors();
  renderCaptureHistory();
  renderDiffSelectors();
  renderQueue();
  renderHandover();
  savePreferences();
  await loadRequests();
  if (view === 'catalog') { renderCatalog(); await loadCatalog(); }
}
async function loadRequests() {
  const sequence=++requestSequence;
  if (!captureId) {
    page={items:[],total:0,offset:0,limit:Number($('filter-limit').value)};
    emptyRows('request-rows',5,'Capture a request collection or choose a saved capture to open the worklist.');
    text('request-range','No capture selected');
    $('request-prev').disabled=true;
    $('request-next').disabled=true;
    return;
  }
  text('request-range','Opening saved requests…');
  const result=await api(queryPath('/api/requests',{
    capture:captureId,status:$('filter-status').value.trim(),service:$('filter-service').value.trim(),
    q:$('filter-q').value.trim(),offset,limit:$('filter-limit').value
  }));
  if(sequence!==requestSequence)return;
  page={items:result.items || [],total:Number(result.total || 0),offset:Number(result.offset ?? offset),limit:Number(result.limit || $('filter-limit').value)};
  offset=page.offset;
  renderRequestRows();
  renderStatusOptions();
}
function reviewFor(item) {
  return item.review || (workspace?.reviews || []).find((value)=>value.connectionId===(item.connectionId || connectionId) && String(value.serviceRequestId)===String(requestId(item))) || null;
}
function renderRequestRows() {
  if (!page.items.length) emptyRows('request-rows',5,page.total ? 'This page has no returned rows. Choose Previous or reset the saved-request filters.' : 'No saved request matches these filters.');
  else $('request-rows').replaceChildren(...page.items.map((item)=>{
    const row=element('tr');
    if(selected && String(selected.id)===String(requestId(item)))row.className='selected';
    const identity=cell(row);
    identity.append(button(String(requestId(item)),()=>openRequest(requestId(item)),'link-button'));
    identity.append(element('span',serviceName(item) || serviceCode(item) || 'Service unspecified','muted small'));
    cell(row,status(item));
    const address=cell(row,item.address || 'Address unspecified');
    if(item.description)address.append(element('span',item.description,'muted small'));
    cell(row,date(item.updatedAt || item.requestedAt));
    const review=reviewFor(item);
    const owner=cell(row);
    owner.append(element('span',reviewLabels[review?.status] || 'New','badge'));
    if(review?.assignee)owner.append(element('span',review.assignee,'small'));
    if(review?.dueDate)owner.append(element('span',(overdue(review) ? 'Overdue · ' : 'Due · ') + review.dueDate,'small muted'));
    return row;
  }));
  const start=page.total && page.items.length ? page.offset+1 : 0;
  text('request-range',start+'–'+Math.min(page.offset+page.items.length,page.total)+' of '+page.total+' saved requests');
  $('request-prev').disabled=page.offset<=0;
  $('request-next').disabled=page.offset+page.items.length>=page.total;
}
async function openRequest(id, settings={}) {
  const sequence=++detailSequence;
  const selectedConnection=settings.connectionId || connectionId;
  const selectedCaptureId=settings.latest ? '' : (settings.captureId ?? captureId);
  const result=await api(queryPath('/api/request',{capture:selectedCaptureId,connection:selectedConnection,id}));
  if(sequence!==detailSequence)return;
  if(!result.item)throw new Error('This saved request was not found in the selected source.');
  selected={...result,id:String(requestId(result.item) || id),connectionId:result.item.connectionId || selectedConnection,viewedCaptureId:selectedCaptureId};
  renderDetail();
  renderRequestRows();
  $('request-detail').hidden=false;
  if(settings.scroll!==false)$('request-detail').scrollIntoView({behavior:'smooth',block:'start'});
}
function addFact(fragment,name,value) {
  if(value===undefined || value===null || value==='')return;
  fragment.append(element('dt',name),element('dd',objectText(value)));
}
function draftId() { return selected ? JSON.stringify([selected.connectionId,selected.id]) : ''; }
function reviewFields(review) {
  return {status:review?.status || 'new',assignee:review?.assignee || '',note:review?.note || '',dueDate:review?.dueDate || ''};
}
function readReviewForm() {
  return {status:$('review-status').value,assignee:$('review-assignee').value.trim(),note:$('review-note').value,dueDate:$('review-due').value};
}
function persistDraft() {
  if(!selected)return;
  const key=draftId();
  const previous=draftCache[key];
  draftCache[key]={review:readReviewForm(),baseReview:previous?.baseReview || reviewFields(selected.review),baseUpdatedAt:previous?.baseUpdatedAt ?? selected.review?.updatedAt ?? null,updatedAt:new Date().toISOString()};
  try{sessionStorage.setItem(draftsKey,JSON.stringify(draftCache));}catch{}
  text('review-draft-state','Unsaved review draft retained in this browser session.');
}
function clearDraft(key=draftId()) {
  delete draftCache[key];
  try{sessionStorage.setItem(draftsKey,JSON.stringify(draftCache));}catch{}
}
function renderDetail() {
  if(!selected)return;
  const item=selected.item;
  text('detail-title','Request '+selected.id);
  text('detail-description',item.description || 'No description returned by the source.');
  const facts=document.createDocumentFragment();
  addFact(facts,'Connection',connectionName(selected.connectionId));
  addFact(facts,'Service',serviceName(item));
  addFact(facts,'Service code',serviceCode(item));
  addFact(facts,'Source status',status(item));
  addFact(facts,'Address',item.address);
  addFact(facts,'Agency',item.agency);
  addFact(facts,'Requested',item.requestedAt ? date(item.requestedAt) : null);
  addFact(facts,'Updated',item.updatedAt ? date(item.updatedAt) : null);
  addFact(facts,'Expected',item.expectedAt ? date(item.expectedAt) : null);
  addFact(facts,'Latitude',item.latitude);
  addFact(facts,'Longitude',item.longitude);
  addFact(facts,'Source SHA-256',item.sourceSha256);
  $('detail-facts').replaceChildren(facts);
  text('detail-source',json(item.source ?? item));
  const links=[];
  for(const [label,value] of [['Source record',item.source?.service_request_url || item.source?.url],['Source media',item.source?.media_url]]){
    const anchor=sourceLink(label,value);if(anchor)links.push(anchor);
  }
  links.push(button('Download request JSON',()=>downloadJson(selected,'open311-request-'+filename(selected.id,'record')+'.json')));
  $('detail-links').replaceChildren(...links);
  const saved=selected.review || reviewFor(item);
  selected.review=saved;
  const draft=draftCache[draftId()];
  const fields=draft?.review || reviewFields(saved);
  $('review-status').value=reviewLabels[fields.status] ? fields.status : 'new';
  $('review-assignee').value=fields.assignee;
  $('review-note').value=fields.note;
  $('review-due').value=fields.dueDate;
  text('review-draft-state',draft ? (draft.baseUpdatedAt !== (saved?.updatedAt ?? null) ? 'Retained local draft. The saved review also changed; saving compares both versions.' : 'Unsaved review draft retained in this browser session.') : saved?.updatedAt ? 'Saved '+date(saved.updatedAt) : 'No review has been saved for this request.');
  const history=Array.isArray(selected.history) ? selected.history : [];
  if(!history.length)emptyRows('detail-history',4,'This capture is the first retained occurrence of the request.');
  else $('detail-history').replaceChildren(...history.map((version)=>{
    const row=element('tr');
    cell(row,date(version.capturedAt));
    cell(row,status(version.item));
    const source=cell(row,short(version.item?.sourceSha256,16) || short(version.captureId,16));
    source.title=version.item?.sourceSha256 || version.captureId || '';
    cell(row).append(button('Open',()=>openRequest(selected.id,{connectionId:selected.connectionId,captureId:version.captureId})));
    return row;
  }));
  const changes=Array.isArray(saved?.history) ? saved.history : [];
  if(!changes.length)$('review-history').replaceChildren(element('p',saved ? 'The current saved review is shown above.' : 'Review history begins when the first review is saved.','muted small'));
  else $('review-history').replaceChildren(...changes.slice().reverse().map((entry)=>{
    const value=entry.review || entry.value || entry;
    const block=element('div',null,'history-item');
    block.append(element('strong',(reviewLabels[value.status] || value.status || 'Saved review')+(value.assignee ? ' · '+value.assignee : '')));
    block.append(element('div',date(entry.updatedAt || entry.createdAt || entry.at || value.updatedAt),'muted'));
    if(value.dueDate)block.append(element('div','Due '+value.dueDate));
    if(value.note)block.append(element('p',value.note));
    return block;
  }));
}
async function saveReview() {
  if(!selected)throw new Error('Open a saved request first.');
  assertWriteReady();
  const currentSelection={connectionId:selected.connectionId,id:selected.id};
  const key=draftId();
  const mine=readReviewForm();
  const base=draftCache[key]?.baseReview || reviewFields(selected.review);
  const fresh=await api('/api/state');
  const live=(fresh.reviews || []).find((item)=>item.connectionId===currentSelection.connectionId && String(item.serviceRequestId)===currentSelection.id);
  const current=reviewFields(live);
  const merged={};
  const conflicts=[];
  for(const field of ['status','assignee','note','dueDate']){
    if(mine[field]===base[field])merged[field]=current[field];
    else{
      merged[field]=mine[field];
      if(current[field]!==base[field] && current[field]!==mine[field])conflicts.push(field);
    }
  }
  workspace=fresh;
  const commit=async()=>{
    await mutate('/api/reviews',{connectionId:currentSelection.connectionId,serviceRequestId:currentSelection.id,review:merged});
    clearDraft(key);
    $('inspector').close();
    if (selected && selected.connectionId===currentSelection.connectionId && selected.id===currentSelection.id) await openRequest(currentSelection.id,{connectionId:currentSelection.connectionId,latest:true,scroll:false});
    renderQueue();
    notify('Review saved for request '+currentSelection.id+'.');
  };
  if(conflicts.length){
    showInspector('Review changed while you were editing',{fields:conflicts,original:base,saved:current,yourDraft:mine,proposed:merged},'Your unchanged fields keep the currently saved values. Choose whether to apply your edited values or reopen the saved review.',[
      button('Apply my edited values',commit),
      button('Reopen saved review',async()=>{clearDraft(key);$('inspector').close();await openRequest(currentSelection.id,{connectionId:currentSelection.connectionId,latest:true,scroll:false});})
    ]);
    return;
  }
  await commit();
}
function overdue(review) {
  return !!review?.dueDate && review.status!=='done' && String(review.dueDate)<new Date().toISOString().slice(0,10);
}
function queueItems() {
  const source=Array.isArray(workspace?.reviewqueues) ? workspace.reviewqueues : workspace?.reviews || [];
  return source.map((entry)=>{
    const review=entry.review || entry;
    const item=entry.item || entry.latestSource || {};
    return {...review,connectionId:entry.connectionId || review.connectionId || item.connectionId,serviceRequestId:entry.serviceRequestId || review.serviceRequestId || requestId(item),sourceItem:item};
  }).filter((review)=>{
    if($('queue-connection').value==='current' && review.connectionId!==connectionId)return false;
    const wanted=$('queue-status').value;
    if(wanted==='active' && review.status==='done')return false;
    if(wanted==='overdue' && !overdue(review))return false;
    if(wanted && !['active','overdue'].includes(wanted) && review.status!==wanted)return false;
    const term=$('queue-search').value.trim().toLocaleLowerCase();
    return !term || [review.serviceRequestId,review.assignee,review.note,connectionName(review.connectionId)].some((value)=>String(value || '').toLocaleLowerCase().includes(term));
  }).sort((a,b)=>{
    if(overdue(a)!==overdue(b))return overdue(a) ? -1 : 1;
    if(a.dueDate!==b.dueDate)return String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}
function renderQueue() {
  if(!workspace)return;
  const reviews=queueItems();
  text('nav-review-count',(workspace.reviews || []).filter((item)=>item.connectionId===connectionId && item.status!=='done').length || '');
  text('queue-count',reviews.length+' saved review'+(reviews.length===1 ? '' : 's'));
  if(!reviews.length){emptyRows('queue-rows',6,'No saved reviews match this queue. Open a request to assign its follow-up.');return;}
  $('queue-rows').replaceChildren(...reviews.map((review)=>{
    const row=element('tr');
    const identity=cell(row,review.serviceRequestId);
    identity.append(element('span',connectionName(review.connectionId),'muted small'));
    cell(row).append(element('span',reviewLabels[review.status] || review.status || 'New','badge'));
    cell(row,review.assignee || 'Unassigned');
    const due=cell(row,review.dueDate || '—');
    if(overdue(review))due.append(element('span','Overdue','badge overdue'));
    cell(row,review.note || '—');
    cell(row).append(button('Open request',async()=>{
      switchView('requests');
      if(connectionId!==review.connectionId)await chooseConnection(review.connectionId);
      await openRequest(review.serviceRequestId,{connectionId:review.connectionId,latest:true});
    }));
    return row;
  }));
}
function exportQueue() {
  const items=queueItems();
  downloadCsv(['connection_id','connection','service_request_id','review_status','assignee','due_date','overdue','note','updated_at'],items.map((item)=>[item.connectionId,connectionName(item.connectionId),item.serviceRequestId,item.status,item.assignee,item.dueDate,overdue(item),item.note,item.updatedAt]),'open311-review-queue-'+new Date().toISOString().slice(0,10)+'.csv');
}
async function loadCatalog() {
  const sequence=++catalogSequence;
  if(!connectionId){catalog={items:[],capture:null};renderCatalog();return;}
  const requestedConnection=connectionId;
  try{
    const result=await api(queryPath('/api/services',{connection:requestedConnection}));
    if(sequence!==catalogSequence || requestedConnection!==connectionId)return;
    catalog={items:result.items || [],capture:result.capture || null};
  }catch(error){
    if(sequence!==catalogSequence)return;
    if(error.status===404)catalog={items:[],capture:null};
    else throw error;
  }
  renderCatalog();
}
function renderCatalog() {
  const term=$('catalog-search').value.trim().toLocaleLowerCase();
  const items=catalog.items.filter((item)=>!term || [serviceCode(item),serviceName(item),item.description,item.group,item.type].some((value)=>String(value || '').toLocaleLowerCase().includes(term)));
  text('catalog-context',catalog.capture ? 'Saved '+date(catalog.capture.capturedAt)+' · '+catalog.items.length+' services · '+coverage(catalog.capture) : 'Capture this connection’s service catalog to inspect its original service codes.');
  text('catalog-count',items.length+' of '+catalog.items.length+' saved services');
  $('catalog-inspect').disabled=!catalog.capture;
  $('service-codes').replaceChildren(...catalog.items.map((item)=>{const option=element('option',serviceName(item));option.value=String(serviceCode(item));return option;}));
  if(!items.length){emptyRows('catalog-rows',5,catalog.items.length ? 'No saved service matches this search.' : 'The saved service catalog is empty. Capture the provider’s current catalog to begin.');return;}
  $('catalog-rows').replaceChildren(...items.map((item)=>{
    const row=element('tr');
    cell(row,serviceCode(item));
    const title=cell(row,serviceName(item));
    if(item.description)title.append(element('span',item.description,'small muted'));
    cell(row,[item.group,item.type].filter(Boolean).join(' · ') || '—');
    cell(row,item.metadata===true || item.metadata==='true' ? 'Service metadata available' : item.metadata===false || item.metadata==='false' ? 'Basic service definition' : 'See original service');
    const actions=element('div',null,'actions');
    actions.append(button('Inspect',()=>showInspector('Service '+serviceCode(item),item,'Original saved catalog object.')));
    actions.append(button('Requests',()=>{switchView('requests');$('capture-panel').hidden=false;$('capture-kind').value='requests';renderCaptureKind();$('capture-service').value=String(serviceCode(item));$('capture-service').focus();}));
    if(item.metadata===true || item.metadata==='true')actions.append(button('Capture definition',async()=>{
      const result=await mutate('/api/capture',{connectionId,kind:'service',resourceId:String(serviceCode(item)),query:{}});
      const id=resultCaptureId(result,'service');
      if(id)await inspectCapture(id);
    }));
    cell(row).append(actions);
    return row;
  }));
}
function renderCaptureKind() {
  const kind=$('capture-kind').value;
  const collection=kind==='requests';
  for(const item of document.querySelectorAll('.collection-field'))item.hidden=!collection;
  $('capture-resource-field').hidden=!['request','token'].includes(kind);
  $('capture-resource').required=['request','token'].includes(kind);
  $('capture-extension-fields').hidden=!collection;
  $('capture-page-field').hidden=!collection || !connection()?.pagination;
  $('capture-page-size-field').hidden=!collection || !connection()?.pagination;
  $('capture-extended-field').hidden=!collection || !connection()?.extendedAttributes;
}
function utcInput(value) {
  if(!value)return '';
  const parsed=new Date(value+'Z');
  if(!Number.isFinite(parsed.getTime()))throw new Error('Enter a valid UTC date and time.');
  return parsed.toISOString();
}
function resultCaptureId(result,kind) {
  const id=result?.capture?.id || result?.captureId || result?.result?.capture?.id || result?.result?.captureId || result?.id || result?.result?.id;
  if(id && workspace?.captures?.some((item)=>item.id===id))return id;
  return capturesFor().find((item)=>(item.kind || 'requests')===kind)?.id || null;
}
async function captureSource() {
  const targetConnection=connectionId;
  if(!connection())throw new Error('Select a saved jurisdiction connection.');
  const kind=$('capture-kind').value;
  const query={};
  if(kind==='requests'){
    const service=$('capture-service').value.trim();
    const sourceStatus=$('capture-status').value.trim();
    const start=utcInput($('capture-start').value);
    const end=utcInput($('capture-end').value);
    if(start && end && start>end)throw new Error('The Until timestamp must be at or after Since.');
    if(service)query.service_code=service;
    if(sourceStatus)query.status=sourceStatus;
    if(start)query.start_date=start;
    if(end)query.end_date=end;
    if(connection().extendedAttributes && $('capture-extended').checked)query.extensions=true;
    if(connection().pagination){query.page=Number($('capture-page').value);query.page_size=Number($('capture-page-size').value);}
    for(const input of $('capture-extension-fields').querySelectorAll('[data-query-extension]'))if(input.value.trim())query[input.dataset.queryExtension]=input.value.trim();
  }
  const input={connectionId:targetConnection,kind,query};
  if(['request','token'].includes(kind))input.resourceId=$('capture-resource').value.trim();
  const result=await mutate('/api/capture',input);
  if(connectionId!==targetConnection){notify('Saved source capture for '+connectionName(targetConnection)+'.');return;}
  const id=resultCaptureId(result,kind);
  if(id && ['requests','request'].includes(kind)){
    captureId=id;offset=0;selected=null;$('request-detail').hidden=true;
    renderCaptureSelectors();savePreferences();await loadRequests();
  }else if(id)await inspectCapture(id);
  $('capture-panel').hidden=true;
}
function renderDiffSelectors() {
  const values=capturesFor(connectionId,true);
  const oldBefore=$('diff-before').value;
  const oldAfter=$('diff-after').value;
  const entries=values.map((item)=>({value:item.id,label:captureLabel(item)}));
  options('diff-before',entries,values.some((item)=>item.id===oldBefore) ? oldBefore : values[1]?.id || '',values.length ? 'Choose earlier capture' : 'No saved captures');
  options('diff-after',entries,values.some((item)=>item.id===oldAfter) ? oldAfter : values[0]?.id || '',values.length ? 'Choose later capture' : 'No saved captures');
}
async function compareCaptures() {
  const sequence=++comparisonSequence;
  const targetConnection=connectionId;
  const before=$('diff-before').value,after=$('diff-after').value;
  if(!before || !after)throw new Error('Choose an earlier and a later saved request capture.');
  if(before===after)throw new Error('Choose two different captures.');
  const first=workspace.captures.find((item)=>item.id===before),second=workspace.captures.find((item)=>item.id===after);
  if(first?.capturedAt && second?.capturedAt && first.capturedAt>second.capturedAt)throw new Error('The Earlier capture must precede the Later capture.');
  const result=await api(queryPath('/api/diff',{before,after}));
  if(sequence!==comparisonSequence || targetConnection!==connectionId)return;
  comparison=result;
  comparisonIds={before,after,connectionId};
  comparisonOffset=0;
  const comparable=comparison.scopeComparable;
  text('diff-context',comparable===true ? 'Both captures have comparable source selections. An absent record stays retained in the earlier capture.' : 'The captures have different or unspecified source selections. Read their saved query and coverage alongside records absent from the later capture.');
  $('diff-summary').hidden=false;
  $('diff-toolbar').hidden=false;
  $('diff-summary').replaceChildren(...[['Added',comparison.added],['Changed',comparison.changed],['Absent in later capture',comparison.missingFromCapture],['Unchanged',comparison.unchanged]].map(([label,rows])=>{
    const block=element('div',null,'summary-item');block.append(element('strong',Array.isArray(rows) ? rows.length : 0),element('span',label));return block;
  }));
  renderComparison();
}
function comparisonRows() {
  if(!comparison)return [];
  const rows=[
    ...(comparison.changed || []).map((entry)=>({kind:'changed',label:'Changed',id:entry.id || requestId(entry.after) || requestId(entry.before),before:entry.before,after:entry.after,fields:entry.fields || []})),
    ...(comparison.added || []).map((entry)=>({kind:'added',label:'Added',id:requestId(entry),before:null,after:entry,fields:[]})),
    ...(comparison.missingFromCapture || []).map((entry)=>({kind:'missing',label:'Absent',id:requestId(entry),before:entry,after:null,fields:[]})),
    ...(comparison.unchanged || []).map((entry)=>({kind:'unchanged',label:'Unchanged',id:requestId(entry),before:entry,after:entry,fields:[]}))
  ];
  const kind=$('diff-kind').value,term=$('diff-search').value.trim().toLocaleLowerCase();
  return rows.filter((entry)=>{
    if(kind==='all' && entry.kind==='unchanged')return false;
    if(kind!=='all' && entry.kind!==kind)return false;
    const item=entry.after || entry.before || {};
    return !term || [entry.id,serviceCode(item),serviceName(item),item.description,item.address].some((value)=>String(value || '').toLocaleLowerCase().includes(term));
  });
}
function fieldNames(fields) {
  if(Array.isArray(fields))return fields.map((value)=>typeof value==='string' ? value : value.field || value.path || objectText(value)).join(', ');
  return fields && typeof fields==='object' ? Object.keys(fields).join(', ') : objectText(fields);
}
function renderComparison() {
  const rows=comparisonRows();
  const shown=rows.slice(comparisonOffset,comparisonOffset+100);
  if(!shown.length)emptyRows('diff-rows',6,comparison ? 'No rows match this comparison view.' : 'Choose two captures and compare their saved records.');
  else $('diff-rows').replaceChildren(...shown.map((entry)=>{
    const row=element('tr'),item=entry.after || entry.before || {};
    cell(row).append(element('span',entry.label,'badge'));
    const identity=cell(row,entry.id);identity.append(element('span',serviceName(item) || serviceCode(item),'small muted'));
    cell(row,entry.before ? status(entry.before) : '—');
    cell(row,entry.after ? status(entry.after) : '—');
    cell(row,fieldNames(entry.fields) || '—');
    cell(row).append(button('Inspect',()=>showInspector('Request '+entry.id+' · '+entry.label,{...comparisonIds,...entry},'Complete retained before and after values.',[button('Open source request',async()=>{$('inspector').close();switchView('requests');await openRequest(entry.id,{connectionId:comparisonIds.connectionId,captureId:entry.after ? comparisonIds.after : comparisonIds.before});})])));
    return row;
  }));
  text('diff-range',rows.length ? (comparisonOffset+1)+'–'+Math.min(comparisonOffset+shown.length,rows.length)+' of '+rows.length+' comparison rows' : '0 comparison rows');
  $('diff-prev').disabled=comparisonOffset===0;
  $('diff-next').disabled=comparisonOffset+shown.length>=rows.length;
}
function exportComparison(kind) {
  if(!comparison)throw new Error('Compare two saved captures first.');
  const name='open311-comparison-'+short(comparisonIds.before)+'-'+short(comparisonIds.after);
  if(kind==='json'){downloadJson({schema:'commons.open311.capture-comparison-export.v1',workspaceId:workspace.workspaceId,...comparisonIds,comparison},name+'.json');return;}
  const rows=comparisonRows();
  downloadCsv(['change','service_request_id','service_code','service_name','before_status','after_status','changed_fields','before_capture_id','after_capture_id'],rows.map((entry)=>{
    const item=entry.after || entry.before || {};
    return [entry.kind,entry.id,serviceCode(item),serviceName(item),entry.before ? status(entry.before) : '',entry.after ? status(entry.after) : '',fieldNames(entry.fields),comparisonIds.before,comparisonIds.after];
  }),name+'.csv');
}
function renderConnections() {
  const items=workspace?.connections || [];
  if(!items.length){emptyRows('connection-rows',5,'Add the jurisdiction’s GeoReport API endpoint to create a saved connection.');return;}
  $('connection-rows').replaceChildren(...items.map((item)=>{
    const row=element('tr');
    if(item.id===connectionId)row.className='selected';
    const identity=cell(row,item.name || item.id);identity.append(element('span',item.id,'small muted'));
    const endpoint=cell(row);const link=sourceLink(item.baseUrl,item.baseUrl);endpoint.append(link || element('span',item.baseUrl));
    cell(row,item.jurisdictionId || 'Provider default');
    cell(row,[(item.pagination ? 'Paginated' : 'Single collection'),'limit '+(item.responseLimit || 1000),item.extendedAttributes ? 'extended attributes' : '',item.apiKeyEnv ? 'key: '+item.apiKeyEnv : ''].filter(Boolean).join(' · '));
    const actions=element('div',null,'actions');
    actions.append(button('Use',async()=>{await chooseConnection(item.id);$('active-connection').value=item.id;switchView('requests');}));
    actions.append(button('Edit',()=>editConnection(item.id)));
    cell(row).append(actions);
    return row;
  }));
}
function editConnection(id='') {
  const value=(workspace?.connections || []).find((item)=>item.id===id) || {};
  editConnectionId=value.id || '';
  $('connection-form').reset();
  text('connection-editor-title',editConnectionId ? 'Edit connection' : 'Add connection');
  $('connection-name').value=value.name || '';
  $('connection-id').value=value.id || '';
  $('connection-id').readOnly=!!editConnectionId;
  $('connection-url').value=value.baseUrl || '';
  $('connection-jurisdiction').value=value.jurisdictionId || '';
  const identityFixed=!!value.id && capturesFor(value.id).length>0;
  $('connection-url').readOnly=identityFixed;
  $('connection-jurisdiction').readOnly=identityFixed;
  $('connection-identity-help').hidden=!identityFixed;
  $('connection-clone').hidden=!value.id;
  $('connection-allow-http').checked=!!value.allowHttp;
  $('connection-discovery-url').value=value.discoveryUrl || '';
  $('connection-key-parameter').value=value.apiKeyParameter || '';
  $('connection-key-env').value=value.apiKeyEnv || '';
  $('connection-response-limit').value=value.responseLimit || 1000;
  $('connection-statuses').value=(value.statusValues || []).join(', ');
  $('connection-query-extensions').value=(value.queryExtensions || []).join(', ');
  $('connection-pagination').checked=!!value.pagination;
  $('connection-extended').checked=!!value.extendedAttributes;
  for(const key of ['publisher','title','license','licenseUrl','sourceUrl']){
    const input=$('connection-attribution-'+key);
    if(input)input.value=value.attribution?.[key] || '';
  }
  $('connection-editor').hidden=false;
  $('connection-name').focus();
}
function commaValues(value) { return [...new Set(String(value).split(',').map((item)=>item.trim()).filter(Boolean))]; }
async function saveConnection() {
  if(!$('connection-form').reportValidity())return;
  const old=(workspace?.connections || []).find((item)=>item.id===editConnectionId) || {};
  const id=editConnectionId || $('connection-id').value.trim() || crypto.randomUUID();
  const baseUrl=$('connection-url').value.trim();
  if(!safeUrl(baseUrl))throw new Error('Use an HTTP or HTTPS GeoReport endpoint without embedded user credentials.');
  const value={
    ...old,id,name:$('connection-name').value.trim(),baseUrl,
    jurisdictionId:$('connection-jurisdiction').value.trim(),
    allowHttp:$('connection-allow-http').checked,
    pagination:$('connection-pagination').checked,
    extendedAttributes:$('connection-extended').checked,
    responseLimit:Number($('connection-response-limit').value)
  };
  for(const [key,input] of [['apiKeyEnv','connection-key-env'],['discoveryUrl','connection-discovery-url'],['apiKeyParameter','connection-key-parameter'],['statusValues','connection-statuses'],['queryExtensions','connection-query-extensions']]){
    const entered=$(input).value.trim();
    if(entered)value[key]=['statusValues','queryExtensions'].includes(key) ? commaValues(entered) : entered;
    else delete value[key];
  }
  const attribution={...(old.attribution || {})};
  for(const key of ['publisher','title','license','licenseUrl','sourceUrl']){
    const entered=$('connection-attribution-'+key)?.value.trim();
    if(entered)attribution[key]=entered;else delete attribution[key];
  }
  if(Object.keys(attribution).length)value.attribution=attribution;else delete value.attribution;
  await mutate('/api/connections',{connection:value});
  $('connection-editor').hidden=true;
  await chooseConnection(id);
  $('active-connection').value=id;
  renderConnections();
  notify('Saved '+value.name+'. Capture its service catalog or request collection to begin.');
}
function isEmptyWorkspace() {
  return !!workspace && (workspace.connections || []).length===0 && (workspace.captures || []).length===0 && (workspace.reviews || []).length===0;
}
function renderHandover() {
  if(!workspace)return;
  const entries=capturesFor(connectionId,true).map((item)=>({value:item.id,label:captureLabel(item)}));
  const previous=$('export-capture').value;
  options('export-capture',entries,entries.some((item)=>item.value===previous) ? previous : captureId,entries.length ? 'Choose a saved capture' : 'No saved request captures');
  const empty=isEmptyWorkspace();
  text('receive-context',empty ? 'This destination is empty. Select the complete original workspace handover, inspect its identity, then receive and reopen it.' : 'To reopen another handover, start the installed workspace command with a new empty data directory. This running workspace already contains saved work.');
  $('receive-file').disabled=!empty || busy;
  $('receive-submit').disabled=!empty || !receiveBundle || busy;
  const operations=workspace.operations || workspace.recentOperations || [];
  if(!operations.length)emptyRows('operation-rows',5,'Saved commands appear here after the first workspace operation.');
  else $('operation-rows').replaceChildren(...operations.map((operation)=>{
    const row=element('tr');
    const identity=cell(row,operation.requestId);identity.title=operation.requestId || '';
    cell(row,operation.kind || operation.action || '—');
    cell(row,operation.state || '—');
    cell(row,date(operation.updatedAt || operation.createdAt));
    cell(row).append(button('Inspect',()=>inspectOperation(operation.requestId)));
    return row;
  }));
}
async function readJsonFile(file) {
  if(!file)throw new Error('Choose the original JSON file.');
  if(file.size>64*1024*1024)throw new Error('This browser intake accepts JSON files up to 64 MiB. Use the installed local receiving command for a larger original handover.');
  let value;
  try{value=JSON.parse(await file.text());}catch{throw new Error('The selected file is not a complete JSON document.');}
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('The selected JSON must contain an original workspace or command object.');
  return value;
}
async function previewReceive() {
  receiveBundle=null;
  receiveFilename='';
  $('receive-submit').disabled=true;
  $('receive-preview').hidden=true;
  const file=$('receive-file').files[0];
  if(!file)return;
  const bundle=await readJsonFile(file);
  const payload=bundle.payload || bundle;
  const original=payload.workspace || bundle.workspace || bundle.state || bundle;
  const preview={
    filename:file.name,
    bytes:file.size,
    schema:bundle.schema,
    workspaceId:original.workspaceId || bundle.manifest?.workspaceId || original.id,
    revision:original.revision,
    connections:bundle.manifest?.connectionCount ?? (Array.isArray(payload.connections) ? payload.connections.length : undefined),
    captures:bundle.manifest?.captureCount ?? (Array.isArray(payload.captures) ? payload.captures.length : undefined),
    reviews:bundle.manifest?.reviewCount ?? (Array.isArray(payload.reviews) ? payload.reviews.length : undefined),
    operations:bundle.manifest?.operationCount,
    payloadSha256:bundle.manifest?.payloadSha256
  };
  receiveBundle=bundle;
  receiveFilename=file.name;
  text('receive-preview',json(preview));
  $('receive-preview').hidden=false;
  $('receive-submit').disabled=!isEmptyWorkspace();
}
async function receiveWorkspace() {
  if(!receiveBundle)throw new Error('Select the complete original workspace JSON.');
  if(!isEmptyWorkspace())throw new Error('Open a new empty workspace before receiving this handover.');
  const name=receiveFilename;
  await mutate('/api/receive',{bundle:receiveBundle});
  receiveBundle=null;receiveFilename='';
  $('receive-file').value='';
  $('receive-preview').hidden=true;
  renderHandover();
  notify('Reopened '+name+' as workspace '+workspace.workspaceId+' at revision '+workspace.revision+'.');
  switchView('requests');
}
async function restoreOriginalCommand() {
  assertWriteReady();
  const file=$('command-file').files[0];
  if(!file)return;
  const value=await readJsonFile(file);
  const endpoints=new Set(['/api/connections','/api/capture','/api/reviews','/api/receive']);
  if(value.schema!=='commons.open311.browser-command.v1' || !endpoints.has(value.endpoint) || !value.payload || typeof value.requestId!=='string' || value.payload.requestId!==value.requestId || !Number.isInteger(value.payload.expectedRevision) || value.payload.expectedRevision<0)throw new Error('This file is not a complete original Open311 browser command.');
  if(value.workspaceId!==workspace.workspaceId)throw new Error('Open the command’s original workspace '+value.workspaceId+' before restoring this request.');
  pending={...value,state:'uncertain',restoredAt:new Date().toISOString(),restoredFrom:file.name};
  await pendingStorage('write',pending);
  renderPending();
  $('pending-details').open=true;
  $('pending-panel').scrollIntoView({behavior:'smooth',block:'start'});
  notify('Original command restored. Inspect its saved outcome before selecting a retry.');
}
function invalidateComparison() {
  comparisonSequence++;
  comparison=null;comparisonIds=null;comparisonOffset=0;
  $('diff-summary').hidden=true;$('diff-toolbar').hidden=true;
  emptyRows('diff-rows',6,'Choose two captures and compare their saved records.');
  text('diff-range','');
  $('diff-prev').disabled=true;$('diff-next').disabled=true;
}
function bind() {
  for(const node of document.querySelectorAll('[data-view]'))node.addEventListener('click',()=>{switchView(node.dataset.view);$('main').focus({preventScroll:true});});
  $('reload-state').addEventListener('click',()=>safely(async()=>{await refreshState();notify('Reloaded saved revision '+workspace.revision+'.');}));
  $('active-connection').addEventListener('change',()=>safely(()=>chooseConnection($('active-connection').value)));
  $('toggle-capture').addEventListener('click',()=>{$('capture-panel').hidden=!$('capture-panel').hidden;if(!$('capture-panel').hidden)renderCaptureKind();});
  $('capture-cancel').addEventListener('click',()=>{$('capture-panel').hidden=true;});
  $('capture-kind').addEventListener('change',renderCaptureKind);
  $('capture-form').addEventListener('submit',(event)=>{event.preventDefault();safely(captureSource);});
  $('request-capture').addEventListener('change',()=>safely(async()=>{
    captureId=$('request-capture').value;offset=0;selected=null;$('request-detail').hidden=true;detailSequence++;
    renderCaptureSelectors();savePreferences();await loadRequests();
  }));
  $('inspect-capture').addEventListener('click',()=>safely(()=>inspectCapture(captureId)));
  $('download-source').addEventListener('click',()=>safely(()=>downloadExport('source')));
  $('request-filters').addEventListener('submit',(event)=>{event.preventDefault();offset=0;safely(loadRequests);});
  $('clear-filters').addEventListener('click',()=>safely(async()=>{$('filter-q').value='';$('filter-status').value='';$('filter-service').value='';offset=0;await loadRequests();}));
  $('filter-limit').addEventListener('change',()=>{offset=0;safely(loadRequests);});
  let searchTimer=null;
  $('filter-q').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{offset=0;safely(loadRequests);},300);});
  $('request-prev').addEventListener('click',()=>{offset=Math.max(0,page.offset-page.limit);safely(loadRequests);});
  $('request-next').addEventListener('click',()=>{offset=page.offset+page.limit;safely(loadRequests);});
  $('close-detail').addEventListener('click',()=>{selected=null;detailSequence++;$('request-detail').hidden=true;renderRequestRows();});
  $('review-form').addEventListener('input',persistDraft);
  $('review-form').addEventListener('change',persistDraft);
  $('review-form').addEventListener('submit',(event)=>{event.preventDefault();safely(saveReview);});
  $('discard-review-draft').addEventListener('click',()=>safely(async()=>{if(!selected)return;const current=selected;clearDraft();await openRequest(current.id,{connectionId:current.connectionId,latest:true,scroll:false});}));
  for(const id of ['queue-connection','queue-status'])$(id).addEventListener('change',renderQueue);
  $('queue-search').addEventListener('input',renderQueue);
  $('queue-export').addEventListener('click',exportQueue);
  $('catalog-search').addEventListener('input',renderCatalog);
  $('catalog-refresh').addEventListener('click',()=>safely(async()=>{
    if(!connectionId)throw new Error('Select a saved jurisdiction connection.');
    const targetConnection=connectionId;
    await mutate('/api/capture',{connectionId:targetConnection,kind:'services',query:{}});
    if(connectionId===targetConnection)await loadCatalog();
    notify('Saved service catalog for '+connectionName(targetConnection)+'.');
  }));
  $('catalog-inspect').addEventListener('click',()=>safely(()=>inspectCapture(catalog.capture?.id)));
  $('diff-form').addEventListener('submit',(event)=>{event.preventDefault();safely(compareCaptures);});
  for(const id of ['diff-before','diff-after'])$(id).addEventListener('change',invalidateComparison);
  $('diff-kind').addEventListener('change',()=>{comparisonOffset=0;renderComparison();});
  $('diff-search').addEventListener('input',()=>{comparisonOffset=0;renderComparison();});
  $('diff-prev').addEventListener('click',()=>{comparisonOffset=Math.max(0,comparisonOffset-100);renderComparison();});
  $('diff-next').addEventListener('click',()=>{comparisonOffset+=100;renderComparison();});
  $('diff-json').addEventListener('click',()=>safely(()=>exportComparison('json')));
  $('diff-csv').addEventListener('click',()=>safely(()=>exportComparison('csv')));
  $('new-connection').addEventListener('click',()=>editConnection());
  $('connection-cancel').addEventListener('click',()=>{$('connection-editor').hidden=true;});
  $('connection-reset').addEventListener('click',()=>editConnection(editConnectionId));
  $('connection-clone').addEventListener('click',()=>{
    editConnectionId='';$('connection-id').value='';$('connection-id').readOnly=false;$('connection-url').readOnly=false;$('connection-jurisdiction').readOnly=false;
    $('connection-identity-help').hidden=true;$('connection-clone').hidden=true;text('connection-editor-title','Add a connection using these settings');$('connection-name').focus();
  });
  $('connection-form').addEventListener('submit',(event)=>{event.preventDefault();safely(saveConnection);});
  for(const node of document.querySelectorAll('[data-export]'))node.addEventListener('click',()=>safely(()=>downloadExport(node.dataset.export,$('export-capture').value)));
  $('receive-file').addEventListener('change',()=>safely(previewReceive));
  $('receive-submit').addEventListener('click',()=>safely(receiveWorkspace));
  $('operation-inspect').addEventListener('click',()=>safely(()=>inspectOperation($('operation-id').value.trim())));
  $('operation-id').addEventListener('keydown',(event)=>{if(event.key==='Enter'){event.preventDefault();safely(()=>inspectOperation($('operation-id').value.trim()));}});
  $('command-file').addEventListener('change',()=>safely(restoreOriginalCommand));
  $('pending-inspect').addEventListener('click',()=>safely(inspectPending));
  $('pending-retry').addEventListener('click',()=>safely(sendPending));
  $('pending-download').addEventListener('click',()=>{if(pending)downloadJson(pending,'open311-command-'+filename(pending.requestId,'original')+'.json');});
  $('pending-dismiss').addEventListener('click',()=>safely(dismissPending));
  $('inspector-close').addEventListener('click',()=>$('inspector').close());
}
async function start() {
  bind();
  switchView(view);
  emptyRows('request-rows',5,'Opening the saved workspace…');
  emptyRows('catalog-rows',5,'Choose a connection to inspect its saved catalog.');
  invalidateComparison();
  pending=await pendingStorage('read');
  renderPending();
  await refreshState();
  if(!workspace.connections.length){switchView('connections');editConnection();}
}
await safely(start);
