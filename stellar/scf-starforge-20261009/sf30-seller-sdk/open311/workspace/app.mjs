const $ = (id) => document.getElementById(id);
const views = new Set(['requests','collections','reviews','catalog','changes','connections','handover']);
const reviewLabels = {new:'New',assigned:'Assigned',in_progress:'In progress',done:'Done'};
const preferencesKey = 'commons.open311.preferences.v1';
const pendingKey = 'commons.open311.pending.v1:' + location.origin;
const draftsKey = 'commons.open311.review-drafts.v1:' + location.origin;
let workspace = null;
let preferences = readLocal(preferencesKey, {});
let connectionId = typeof preferences.connectionId === 'string' ? preferences.connectionId : '';
let captureId = typeof preferences.captureId === 'string' ? preferences.captureId : '';
let view = views.has(preferences.view) ? preferences.view : 'requests';
let requestSource = preferences.requestSource === 'collection' ? 'collection' : 'capture';
let collectionId = typeof preferences.collectionId === 'string' ? preferences.collectionId : '';
let collectionPage = {collection:null,connection:null,items:[],total:0,offset:0,limit:100,nextOffset:null};
let collectionOffset = 0;
let collectionSequence = 0;
let collectionFormContext = '';
let collectionRefreshTimer = null;
let pauseCommand = null;
let pauseBusy = false;
let offset = 0;
let page = {items:[],total:0,offset:0,limit:50};
let selected = null;
let catalog = {items:[],capture:null};
let catalogQueryContext = '';
let catalogLoading = false;
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
  preferences = {view,connectionId,captureId,requestSource,collectionId};
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
async function pendingStorage(action, value, slot = '') {
  const storageKey = slot ? pendingKey + ':' + slot : pendingKey;
  const database = await openCommandDatabase();
  if (database) return new Promise((resolve,reject) => {
    const transaction = database.transaction('commands',action === 'read' ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('commands');
    const request = action === 'read' ? store.get(storageKey) : action === 'delete' ? store.delete(storageKey) : store.put(value,storageKey);
    let result = null;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('Could not retain the original operation in browser storage.'));
    transaction.onabort = () => reject(transaction.error || new Error('The browser cancelled operation retention.'));
  });
  try {
    if (action === 'read') return readLocal(storageKey,null);
    if (action === 'delete') localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey,JSON.stringify(value));
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
    if (node) node.disabled = value || (id === 'receive-submit' && (!receiveBundle || !isEmptyWorkspace())) || (id === 'catalog-refresh' && (!connectionId || catalogLoading));
  }
  for (const node of $('catalog-query-fields').querySelectorAll('input')) node.disabled = value;
  $('catalog-query-reset').disabled = value;
  renderPending();
  renderPause();
  renderCollectionControls();
}
function assertWriteReady() {
  if (!workspace) throw new Error('Open the saved workspace before making a change.');
  if (busy) throw new Error('The current operation is still running.');
  if (pending) throw new Error('Reconcile the retained operation shown above before preparing another write.');
  if (pauseCommand || pauseBusy) throw new Error('Reconcile the retained pause request before preparing another write.');
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
  pending = command;
  setBusy(true);
  renderPending();
  try{await pendingStorage('write',command);}
  catch(error){pending=null;renderPending();throw error;}
  finally{setBusy(false);}
  return sendPending();
}
async function sendPending() {
  if (!pending || busy) return null;
  const command = pending;
  let acceptedResult = null;
  setBusy(true);
  notify('Running the original saved command…');
  if (command.endpoint === '/api/collection-run') scheduleCollectionRefresh(1200);
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
async function downloadExport(kind,id = captureId,sourceKind = 'capture') {
  if (kind !== 'workspace' && !id) throw new Error('Select a saved source to export.');
  if (kind === 'source' && sourceKind === 'collection') throw new Error('Open the collection’s source windows to download an exact original, or export collection JSON for every retained original together.');
  const path = queryPath('/api/export',{kind,capture:kind === 'workspace' || sourceKind === 'collection' ? undefined : id,collection:kind === 'workspace' || sourceKind !== 'collection' ? undefined : id});
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
  if (view === 'collections') safely(loadCollection);
  else if (!busy) clearTimeout(collectionRefreshTimer);
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
  const collections = collectionsFor();
  if (!collections.some((item) => item.id === collectionId)) collectionId = collections[0]?.id || '';
  if (requestSource === 'collection' && !collectionId) requestSource = 'capture';
  text('workspace-name','Workspace ' + short(workspace.workspaceId,16));
  $('workspace-name').title = workspace.workspaceId || '';
  text('workspace-revision','Saved revision ' + workspace.revision);
  options('active-connection',workspace.connections.map((item) => ({value:item.id,label:item.name || item.id})),connectionId,workspace.connections.length ? 'Choose a connection' : 'No saved connections');
  renderConnectionContext();
  renderCaptureSelectors();
  renderConnections();
  renderCaptureHistory();
  renderCollectionSelectors();
  renderQueue();
  renderHandover();
  renderDiffSelectors();
  renderPending();
  savePreferences();
  await loadRequests();
  if (view === 'catalog') await loadCatalog();
  if (view === 'collections') await loadCollection();
}
function renderConnectionContext() {
  const current = connection();
  text('connection-context',current ? (current.jurisdictionId ? current.jurisdictionId + ' · ' : '') + current.baseUrl : 'Add a connection to begin.');
  text('capture-connection',current?.name || 'No connection selected');
  $('catalog-refresh').disabled = !current || busy || catalogLoading;
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
  renderCollectionForm();
}
function renderStatusOptions() {
  const values = new Set(['open','closed',...(connection()?.statusValues || []),...(selectedCapture()?.statuses || []),...(selectedCollection()?.statuses || []),...page.items.map((item) => status(item))]);
  $('source-statuses').replaceChildren(...[...values].filter((value) => value && value !== '—').sort().map((value) => { const item=element('option');item.value=String(value);return item; }));
}
function renderCaptureSelectors() {
  const entries=sourceEntries();
  options('request-capture',entries,sourceChoice(requestSource,requestSource === 'collection' ? collectionId : captureId),entries.length ? 'Choose a saved source' : 'No saved request sources');
  const isCollection=requestSource==='collection';
  const current=isCollection ? selectedCollection() : selectedCapture();
  text('nav-request-count',isCollection ? current?.counts?.uniqueRequests ?? '' : current?.rowCount ?? '');
  text('capture-context',current ? isCollection ? collectionLabel(current)+' · '+collectionCoverage(current)+' · query '+objectText(current.query || {}) : coverage(current) + ' · ' + date(current.capturedAt) + ' · query ' + objectText(current.query || {}) + (current.scope?.fixed === false ? ' · Rolling or provider-default source selection' : '') : 'Select a connection and capture its requests or run a saved source collection.');
  text('inspect-capture',isCollection ? 'Open collection' : 'Inspect capture');
  text('download-source',isCollection ? 'Collection and originals' : 'Original source');
  $('inspect-capture').disabled=!current;
  $('download-source').disabled=!current;
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
  requestSource='capture';
  collectionId=collectionsFor(id)[0]?.id || '';
  collectionOffset=0;collectionSequence++;
  collectionPage={collection:null,connection:null,items:[],total:0,offset:0,limit:100,nextOffset:null};
  clearTimeout(collectionRefreshTimer);
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
  renderCollectionSelectors();
  renderDiffSelectors();
  renderQueue();
  renderHandover();
  savePreferences();
  await loadRequests();
  if (view === 'catalog') { renderCatalog(); await loadCatalog(); }
  if (view === 'collections') await loadCollection();
}
async function loadRequests() {
  const sequence=++requestSequence;
  if (!(requestSource === 'collection' ? collectionId : captureId)) {
    page={items:[],total:0,offset:0,limit:Number($('filter-limit').value)};
    emptyRows('request-rows',5,'Capture a source or run a saved collection to open the worklist.');
    text('request-range','No saved source selected');
    $('request-prev').disabled=true;
    $('request-next').disabled=true;
    return;
  }
  text('request-range','Opening saved requests…');
  const result=await api(queryPath('/api/requests',{
    capture:requestSource==='collection' ? undefined : captureId,collection:requestSource==='collection' ? collectionId : undefined,status:$('filter-status').value.trim(),service:$('filter-service').value.trim(),
    q:$('filter-q').value.trim(),offset,limit:$('filter-limit').value
  }));
  if(sequence!==requestSequence)return;
  page={items:result.items || [],total:Number(result.total || 0),offset:Number(result.offset ?? offset),limit:Number(result.limit || $('filter-limit').value)};
  offset=page.offset;
  if(result.collection) updateCollectionSummary(result.collection);
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
    if(item.collectionId) identity.append(element('span',(item.observationCount ?? 1)+' source observations · '+(item.versionCount ?? 1)+' retained versions','muted small'));
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
  const selectedCollectionId=settings.latest || settings.captureId ? '' : (settings.collectionId ?? (requestSource==='collection' ? collectionId : ''));
  const selectedCaptureId=settings.latest || selectedCollectionId ? '' : (settings.captureId ?? captureId);
  const sourceSelection=selectedCollectionId ? {collection:selectedCollectionId} : selectedCaptureId ? {capture:selectedCaptureId} : {connection:selectedConnection};
  const result=await api(queryPath('/api/request',{...sourceSelection,id}));
  if(sequence!==detailSequence)return;
  if(!result.item)throw new Error('This saved request was not found in the selected source.');
  selected={...result,id:String(requestId(result.item) || id),connectionId:result.item.connectionId || selectedConnection,viewedCaptureId:selectedCaptureId,viewedCollectionId:selectedCollectionId};
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
  addFact(facts,'Collection',selected.collection?.name || (item.collectionId ? short(item.collectionId,16) : null));
  addFact(facts,'Source observations',item.observationCount);
  addFact(facts,'Retained versions',item.versionCount);
  addFact(facts,'Selected source capture',item.captureId);
  $('detail-facts').replaceChildren(facts);
  text('detail-source',json(item.source ?? item));
  const links=[];
  for(const [label,value] of [['Source record',item.source?.service_request_url || item.source?.url],['Source media',item.source?.media_url]]){
    const anchor=sourceLink(label,value);if(anchor)links.push(anchor);
  }
  if(item.captureId) links.push(button('Selected original source',()=>downloadExport('source',item.captureId)));
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
  const currentSelection={connectionId:selected.connectionId,id:selected.id,captureId:selected.item.captureId || selected.viewedCaptureId,sourceSha256:selected.item.sourceSha256,collectionId:selected.viewedCollectionId};
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
    await mutate('/api/reviews',{connectionId:currentSelection.connectionId,serviceRequestId:currentSelection.id,review:merged,...(currentSelection.captureId && currentSelection.sourceSha256 ? {captureId:currentSelection.captureId,expectedSourceSha256:currentSelection.sourceSha256} : {})});
    clearDraft(key);
    $('inspector').close();
    if (selected && selected.connectionId===currentSelection.connectionId && selected.id===currentSelection.id) await openRequest(currentSelection.id,{connectionId:currentSelection.connectionId,...(currentSelection.collectionId ? {collectionId:currentSelection.collectionId} : currentSelection.captureId ? {captureId:currentSelection.captureId} : {latest:true}),scroll:false});
    renderQueue();
    notify('Review saved for request '+currentSelection.id+'.');
  };
  if(conflicts.length){
    showInspector('Review changed while you were editing',{fields:conflicts,original:base,saved:current,yourDraft:mine,proposed:merged},'Your unchanged fields keep the currently saved values. Choose whether to apply your edited values or reopen the saved review.',[
      button('Apply my edited values',commit),
      button('Reopen saved review',async()=>{clearDraft(key);$('inspector').close();await openRequest(currentSelection.id,{connectionId:currentSelection.connectionId,...(currentSelection.collectionId ? {collectionId:currentSelection.collectionId} : currentSelection.captureId ? {captureId:currentSelection.captureId} : {latest:true}),scroll:false});})
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
function renderCatalogQuery() {
  const fields=connection()?.queryExtensions || [];
  const context=JSON.stringify([connectionId,catalog.capture?.id || '',fields]);
  if(context===catalogQueryContext)return;
  catalogQueryContext=context;
  $('catalog-query-options').hidden=!fields.length;
  const saved=catalog.capture?.connectionId===connectionId ? catalog.capture.query || {} : {};
  const fragment=document.createDocumentFragment();
  for(const key of fields){
    const label=element('label',null,'field');
    label.append(element('span',key));
    const input=element('input');
    input.dataset.catalogExtension=key;
    input.autocomplete='off';
    input.placeholder='Provider default';
    input.value=saved[key]===undefined || saved[key]===null ? '' : String(saved[key]);
    input.disabled=busy;
    label.append(input);fragment.append(label);
  }
  $('catalog-query-fields').replaceChildren(fragment);
  $('catalog-query-reset').disabled=busy;
}
function catalogQuery() {
  const allowed=new Set(connection()?.queryExtensions || []);
  const query=Object.create(null);
  for(const input of $('catalog-query-fields').querySelectorAll('[data-catalog-extension]')){
    const key=input.dataset.catalogExtension,value=input.value.trim();
    if(allowed.has(key) && value)query[key]=value;
  }
  return query;
}
async function loadCatalog() {
  const sequence=++catalogSequence;
  if(!connectionId){catalogLoading=false;catalog={items:[],capture:null};renderCatalog();$('catalog-refresh').disabled=true;return;}
  const requestedConnection=connectionId;
  catalogLoading=true;
  $('catalog-refresh').disabled=true;
  try{
    const result=await api(queryPath('/api/services',{connection:requestedConnection}));
    if(sequence!==catalogSequence || requestedConnection!==connectionId)return;
    catalog={items:result.items || [],capture:result.capture || null};
  }catch(error){
    if(sequence!==catalogSequence || requestedConnection!==connectionId)return;
    if(error.status===404)catalog={items:[],capture:null};
    else throw error;
  }finally{
    if(sequence===catalogSequence){catalogLoading=false;$('catalog-refresh').disabled=busy || !connectionId;}
  }
  renderCatalog();
}
function renderCatalog() {
  renderCatalogQuery();
  const renderedConnection=connectionId;
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
      if(connectionId!==renderedConnection)throw new Error('Open this service in its original jurisdiction connection.');
      const query=catalogQuery();
      const result=await mutate('/api/capture',{connectionId:renderedConnection,kind:'service',resourceId:String(serviceCode(item)),query});
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
    requestSource='capture';captureId=id;offset=0;selected=null;$('request-detail').hidden=true;
    renderCaptureSelectors();savePreferences();await loadRequests();
  }else if(id)await inspectCapture(id);
  $('capture-panel').hidden=true;
}
function collectionsFor(id = connectionId) {
  return (workspace?.collections || []).filter((item)=>item.connectionId===id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
}
function selectedCollection() { return workspace?.collections?.find((item)=>item.id===collectionId) || null; }
function collectionLabel(item) {
  return (item.name || short(item.id,16))+' · '+(item.state || 'PLANNED')+' · '+(item.counts?.uniqueRequests ?? 0)+' requests';
}
function collectionCoverage(item) {
  if(item.state==='COMPLETE' && item.capResolved===true)return 'All planned source windows resolved within the declared response limit';
  if(item.state==='LIMITED')return 'Retained selection includes '+(item.counts?.limitedWindows ?? 0)+' windows still at the source limit';
  if(item.state==='COMPLETE')return 'All planned source windows retained; inspect the recorded coverage';
  return (item.counts?.capturedWindows ?? 0)+' captured windows · '+(item.counts?.pendingWindows ?? 0)+' pending · '+(item.counts?.activeWindows ?? 0)+' active';
}
function sourceChoice(kind,id) { return id ? kind+':'+id : ''; }
function parseSourceChoice(value) {
  if(value.startsWith('collection:'))return {kind:'collection',id:value.slice(11)};
  return {kind:'capture',id:value.startsWith('capture:') ? value.slice(8) : value};
}
function sourceEntries() {
  return [
    ...collectionsFor().map((item)=>({value:sourceChoice('collection',item.id),label:'Collection · '+collectionLabel(item)})),
    ...capturesFor(connectionId,true).map((item)=>({value:sourceChoice('capture',item.id),label:'Capture · '+captureLabel(item)}))
  ];
}
function updateCollectionSummary(summary) {
  if(!workspace || !summary?.id)return;
  const values=workspace.collections || [];
  workspace.collections=values.some((item)=>item.id===summary.id) ? values.map((item)=>item.id===summary.id ? summary : item) : [...values,summary];
}
function renderCollectionForm() {
  const current=connection();
  text('collection-connection',current?.name || 'No connection selected');
  const context=JSON.stringify([connectionId,current?.queryExtensions,current?.extendedAttributes,current?.responseLimit]);
  if(collectionFormContext===context)return;
  collectionFormContext=context;
  const previous=capturesFor().find((item)=>item.kind==='requests')?.query || {};
  const fragment=document.createDocumentFragment();
  for(const key of current?.queryExtensions || []){
    if(['service_request_id','page','page_size','start_date','end_date','service_code','status','extensions'].includes(key))continue;
    const label=element('label',null,'field');
    label.append(element('span',key));
    const input=element('input');
    input.dataset.collectionExtension=key;
    input.autocomplete='off';
    input.value=previous[key]===undefined ? '' : String(previous[key]);
    label.append(input);fragment.append(label);
  }
  $('collection-extension-fields').replaceChildren(fragment);
  $('collection-service').value=previous.service_code || '';
  $('collection-status').value=previous.status || '';
  $('collection-extended-field').hidden=!current?.extendedAttributes;
  $('collection-extended').checked=!!current?.extendedAttributes && previous.extensions!=='false';
  $('collection-editor').hidden=true;
  text('collection-policy-help',current ? 'The saved plan uses '+current.name+' with declared response limit '+(current.responseLimit || 1000)+'. Responses at that limit refine into smaller date windows; parent originals and repeated observations remain retained. Query precision is an operator setting.' : 'Save a jurisdiction connection before planning a source collection.');
}
function renderCollectionSelectors() {
  const entries=collectionsFor().map((item)=>({value:item.id,label:collectionLabel(item)}));
  options('collection-choice',entries,collectionId,entries.length ? 'Choose a saved collection' : 'No saved collections');
  text('nav-collection-count',entries.length || '');
  renderCollectionControls();
}
function renderCollectionControls() {
  const current=selectedCollection();
  const unresolved=!!pending || !!pauseCommand;
  const writable=!!workspace && !!connectionId && !busy && !pauseBusy && !unresolved;
  $('collection-new').disabled=!connectionId || busy;
  $('collection-create').disabled=!writable;
  $('collection-create-run').disabled=!writable;
  $('collection-reload').disabled=!collectionId;
  $('collection-open').disabled=!current;
  const resumeTime=current?.resumeAt ? Date.parse(current.resumeAt) : NaN;
  const waiting=Number.isFinite(resumeTime) && resumeTime>Date.now();
  $('collection-run').disabled=!current || !writable || !['PLANNED','PAUSED','INTERRUPTED'].includes(current.state) || waiting;
  text('collection-run',current?.state==='PLANNED' ? 'Run collection' : 'Resume collection');
  $('collection-recover').hidden=!current?.runRequestId || current.state!=='RUNNING';
  $('collection-recover').disabled=!writable;
  $('collection-pause').disabled=!current || current.state!=='RUNNING' || current.pauseRequested===true || pauseBusy || !!pauseCommand;
  text('collection-pause',current?.pauseRequested ? 'Pause requested' : 'Pause after current source');
  for(const id of ['collection-inspect','collection-copy','collection-export-report','collection-export-csv','collection-export-json','collection-export-workspace'])$(id).disabled=!current;
  if(waiting)text('collection-run-help','The saved source outcome gives a resume time of '+date(current.resumeAt)+'. The original progress remains available below.');
  else if(current?.state==='LIMITED')text('collection-run-help','These minimum-size source windows still reached the declared cap. Copy this plan to choose a finer supported query precision or a more specific source filter; the current originals stay available.');
  else if(current?.state==='RUNNING')text('collection-run-help','This original run is collecting the saved period. Pause retains the current source response before stopping. Progress refreshes from the local journal.');
  else text('collection-run-help','Run processes this saved plan. A paused or interrupted run resumes its remaining windows through a new retained run command after the original outcome is reconciled.');
}
function scheduleCollectionRefresh(delay=2500) {
  clearTimeout(collectionRefreshTimer);
  if(!collectionId || !workspace)return;
  collectionRefreshTimer=setTimeout(()=>safely(()=>loadCollection({poll:true})),delay);
}
async function loadCollection(settings={}) {
  const sequence=++collectionSequence;
  if(!collectionId){
    collectionPage={collection:null,connection:null,items:[],total:0,offset:0,limit:100,nextOffset:null};
    $('collection-detail').hidden=true;
    text('collection-context','Create a plan for the selected jurisdiction to collect a fixed source period.');
    renderCollectionSelectors();
    return;
  }
  const id=collectionId;
  if(!settings.poll)text('collection-context','Opening the saved collection and its original source windows…');
  const result=await api(queryPath('/api/collection',{id,offset:collectionOffset,limit:100}));
  if(sequence!==collectionSequence || id!==collectionId)return;
  if(!result.collection || !Array.isArray(result.items))throw new Error('The collection response is missing its saved plan or source windows.');
  collectionPage={...result,total:Number(result.total || 0),offset:Number(result.offset || 0),limit:Number(result.limit || 100),nextOffset:result.nextOffset ?? null};
  collectionOffset=collectionPage.offset;
  updateCollectionSummary(result.collection);
  renderCollectionSelectors();
  renderCollectionDetail();
  if(requestSource==='collection')renderCaptureSelectors();
  const current=result.collection;
  const resumePending=current.resumeAt && Date.parse(current.resumeAt)>Date.now();
  const ownRun=pending?.endpoint==='/api/collection-run' && pending.payload?.collectionId===id && !['completed','rejected'].includes(pending.state);
  if((view==='collections' || ownRun) && (current.state==='RUNNING' || resumePending || ownRun && busy))scheduleCollectionRefresh();
  else clearTimeout(collectionRefreshTimer);
}
function renderCollectionDetail() {
  const current=collectionPage.collection;
  if(!current || current.id!==collectionId){$('collection-detail').hidden=true;return;}
  $('collection-detail').hidden=false;
  text('collection-context',(current.name || short(current.id))+' · '+date(current.query?.start_date)+' through '+date(current.query?.end_date)+' · '+connectionName(current.connectionId));
  text('collection-state',current.state);
  const outcomes={
    PLANNED:'The fixed source period and provider settings are saved. Run this plan to collect its original responses.',
    RUNNING:'Collecting the saved source windows. Every completed response and refinement is retained as progress is made.',
    PAUSED:'The requested pause is saved after retaining the current source response. Resume continues the remaining windows.',
    INTERRUPTED:'The run retained its progress and source outcome. Inspect the saved error and resume the remaining windows when its cause is resolved.',
    COMPLETE:collectionCoverage(current)+'.',
    LIMITED:collectionCoverage(current)+'. Inspect those windows and their exact source responses.'
  };
  text('collection-outcome',outcomes[current.state] || String(current.state || 'Saved collection'));
  const counts=current.counts || {};
  $('collection-counts').replaceChildren(...[
    ['Unique requests',counts.uniqueRequests],
    ['Original captures',counts.originalCaptureCount],
    ['Pending windows',counts.pendingWindows],
    ['Windows at the limit',counts.limitedWindows]
  ].map(([label,value])=>{const node=element('div',null,'summary-item');node.append(element('strong',value ?? 0),element('span',label));return node;}));
  const facts=document.createDocumentFragment();
  addFact(facts,'Created',date(current.createdAt));
  addFact(facts,'Saved progress',date(current.updatedAt));
  addFact(facts,'Returned source rows',counts.returnedRows);
  addFact(facts,'Repeated observations',counts.duplicateObservations);
  addFact(facts,'Requests with versions',counts.changedRequests);
  addFact(facts,'Outside requested period',counts.outOfWindowRows);
  addFact(facts,'Unspecified source date',counts.unknownDateRows);
  addFact(facts,'Windows refined',counts.splitWindows);
  addFact(facts,'Failed source windows',counts.failedWindows);
  addFact(facts,'Pause requested',current.pauseRequested ? 'Yes; the current response is retained first' : null);
  addFact(facts,'Resume time',current.resumeAt ? date(current.resumeAt) : null);
  $('collection-facts').replaceChildren(facts);
  text('collection-plan-json',json({id:current.id,connection:collectionPage.connection,query:current.query,policy:current.policy}));
  $('collection-error').hidden=!current.lastError;
  text('collection-error-json',current.lastError ? json(current.lastError) : '');
  text('collection-window-total',collectionPage.total+' saved windows · '+(counts.activeWindows || 0)+' active');
  const nodes=collectionPage.items;
  if(!nodes.length)emptyRows('collection-windows',6,'The saved collection currently has no source windows.');
  else $('collection-windows').replaceChildren(...nodes.map((item)=>{
    const row=element('tr');
    const period=cell(row,date(item.startDate));
    period.append(element('span','to '+date(item.endDate),'muted small'));
    if(item.parentId)period.append(element('div','Refined from '+short(item.parentId,14),'collection-refinement'));
    if(item.children?.length)period.append(element('div',item.children.length+' retained child windows','collection-refinement'));
    cell(row).append(element('span',item.state,'badge'));
    const capture=item.capture;
    cell(row,capture?.rowCount ?? '—');
    const limit=capture?.receipt?.coverage?.documentedLimit ?? capture?.responseLimit ?? collectionPage.connection?.responseLimit;
    const cap=cell(row,limit ?? '—');
    if(capture?.saturated || capture?.receipt?.coverage?.mayBeTruncated)cap.append(element('span','Returned at limit','small muted'));
    cell(row,Array.isArray(item.attempts) ? item.attempts.length : item.attempts ?? 0);
    const actions=element('div',null,'collection-member-actions');
    actions.append(button('Window',()=>showInspector('Source window '+short(item.id),item,'Saved interval, attempts, refinement, and source metadata.')));
    if(capture?.id){
      actions.append(button('Receipt',()=>inspectCapture(capture.id)),button('Original',()=>downloadExport('source',capture.id)));
    }
    cell(row).append(actions);
    return row;
  }));
  text('collection-window-range',collectionPage.total ? (collectionPage.offset+1)+'–'+Math.min(collectionPage.offset+nodes.length,collectionPage.total)+' of '+collectionPage.total+' source windows' : '0 source windows');
  $('collection-window-prev').disabled=collectionPage.offset<=0;
  $('collection-window-next').disabled=collectionPage.nextOffset===null;
  renderCollectionControls();
}
async function chooseCollection(id) {
  collectionSequence++;
  collectionId=id;
  collectionOffset=0;
  collectionPage={collection:null,connection:null,items:[],total:0,offset:0,limit:100,nextOffset:null};
  clearTimeout(collectionRefreshTimer);
  renderCollectionSelectors();
  if(requestSource==='collection'){offset=0;selected=null;detailSequence++;$('request-detail').hidden=true;}
  savePreferences();
  await loadCollection();
  if(requestSource==='collection')await loadRequests();
}
function collectionFormValue() {
  if(!connection())throw new Error('Select a saved jurisdiction connection.');
  const name=$('collection-name').value.trim();
  const start=utcInput($('collection-start').value);
  const end=utcInput($('collection-end').value);
  if(!name || !start || !end)throw new Error('Enter a collection name and the complete fixed UTC period.');
  if(start>=end)throw new Error('The collection Until timestamp must be later than Since.');
  const policy={
    maxWindowDays:Number($('collection-max-days').value),
    minimumWindowMs:Number($('collection-min-ms').value),
    boundaryOverlapMs:Number($('collection-overlap-ms').value),
    queryQuantumMs:Number($('collection-quantum-ms').value)
  };
  if(!Number.isSafeInteger(policy.maxWindowDays) || policy.maxWindowDays<1 || policy.maxWindowDays>90)throw new Error('Choose a whole number from 1 to 90 days for the maximum initial window.');
  if(!Number.isSafeInteger(policy.queryQuantumMs) || policy.queryQuantumMs<1 || policy.queryQuantumMs>86400000)throw new Error('Choose a positive whole-millisecond query precision of at most one day.');
  if(!Number.isSafeInteger(policy.minimumWindowMs) || policy.minimumWindowMs<policy.queryQuantumMs || policy.minimumWindowMs>policy.maxWindowDays*86400000 || policy.minimumWindowMs%policy.queryQuantumMs!==0)throw new Error('The minimum window must be a positive multiple of the selected query precision within the maximum initial window.');
  if(!Number.isSafeInteger(policy.boundaryOverlapMs) || policy.boundaryOverlapMs<0 || policy.boundaryOverlapMs>=policy.maxWindowDays*86400000/2 || policy.boundaryOverlapMs%policy.queryQuantumMs!==0)throw new Error('Boundary overlap must be a multiple of the selected query precision below half the maximum initial window.');
  const query=Object.create(null);
  for(const node of $('collection-extension-fields').querySelectorAll('[data-collection-extension]'))if(node.value.trim())query[node.dataset.collectionExtension]=node.value.trim();
  if($('collection-service').value.trim())query.service_code=$('collection-service').value.trim();
  if($('collection-status').value.trim())query.status=$('collection-status').value.trim();
  query.start_date=start;query.end_date=end;
  if(connection().extendedAttributes && $('collection-extended').checked)query.extensions=true;
  return {connectionId,name,query,policy};
}
async function createCollection(runNow=false) {
  if(!$('collection-form').reportValidity())return;
  const input=collectionFormValue();
  const result=await mutate('/api/collections',input);
  const id=result?.collection?.id || result?.collectionId || result?.result?.collection?.id || result?.result?.collectionId || result?.id;
  if(!id)throw new Error('The saved collection result did not include its identity. Inspect the original operation before running a plan.');
  if(connectionId!==input.connectionId){notify('Saved collection '+input.name+' for '+connectionName(input.connectionId)+'.');return;}
  await chooseCollection(id);
  $('collection-editor').hidden=true;
  notify('Saved collection '+input.name+'.');
  if(runNow)await runCollection();
}
async function runCollection() {
  const current=selectedCollection();
  if(!current)throw new Error('Select a saved source collection.');
  if(!['PLANNED','PAUSED','INTERRUPTED'].includes(current.state))throw new Error('This collection has state '+current.state+'. Open its retained progress before preparing another run.');
  if(current.resumeAt && Date.parse(current.resumeAt)>Date.now())throw new Error('The saved source outcome requests resuming at '+date(current.resumeAt)+'.');
  const id=current.id;
  await mutate('/api/collection-run',{collectionId:id});
  if(collectionId===id)await loadCollection();
  const latest=workspace.collections?.find((item)=>item.id===id);
  notify('Collection '+(latest?.name || short(id))+' · '+(latest?.state || 'saved')+' · '+(latest?.counts?.uniqueRequests ?? 0)+' retained request identities.');
}
async function recoverCollectionRun() {
  assertWriteReady();
  const current=selectedCollection();
  if(!current?.runRequestId)throw new Error('This collection has no original run request to recover.');
  const result=await api(queryPath('/api/operation',{requestId:current.runRequestId}));
  const operation=result?.operation ?? result;
  const input=operation?.intent;
  if(operation?.kind!=='collection-run' || operation.requestId!==current.runRequestId || input?.requestId!==operation.requestId || input.collectionId!==current.id || !Number.isSafeInteger(input.expectedRevision))throw new Error('The saved journal did not return the complete original run input for this collection.');
  if(operation.state==='SUCCEEDED'){
    await refreshState();
    showInspector('Original collection run completed',operation,'The original result is saved with this collection.');
    return;
  }
  assertWriteReady();
  const command={
    schema:'commons.open311.browser-command.v1',
    origin:location.origin,workspaceId:workspace.workspaceId,requestId:operation.requestId,
    endpoint:'/api/collection-run',payload:JSON.parse(JSON.stringify(input)),
    createdAt:operation.createdAt,state:'uncertain',
    restoredAt:new Date().toISOString(),restoredFrom:'Original workspace operation journal'
  };
  pending=command;setBusy(true);
  try{await pendingStorage('write',command);}
  catch(error){pending=null;throw error;}
  finally{setBusy(false);renderPending();}
  $('pending-panel').scrollIntoView({behavior:'smooth',block:'start'});
  notify('Recovered the complete original run command. Inspect its current outcome or retry the same saved request to continue its remaining windows.');
}
function copyCollectionPlan() {
  const current=selectedCollection();
  if(!current)return;
  $('collection-editor').hidden=false;
  $('collection-name').value=(current.name || 'Collection')+' — next selection';
  $('collection-start').value=new Date(current.query.start_date).toISOString().slice(0,19);
  $('collection-end').value=new Date(current.query.end_date).toISOString().slice(0,19);
  $('collection-service').value=current.query.service_code || '';
  $('collection-status').value=current.query.status || '';
  for(const node of $('collection-extension-fields').querySelectorAll('[data-collection-extension]'))node.value=current.query[node.dataset.collectionExtension] ?? '';
  $('collection-extended').checked=current.query.extensions===true || current.query.extensions==='true';
  $('collection-max-days').value=current.policy.maxWindowDays;
  $('collection-min-ms').value=current.policy.minimumWindowMs;
  $('collection-overlap-ms').value=current.policy.boundaryOverlapMs;
  $('collection-quantum-ms').value=current.policy.queryQuantumMs ?? 1000;
  $('collection-editor').scrollIntoView({behavior:'smooth',block:'start'});
  $('collection-name').focus();
}
async function openCollectionRequests() {
  if(!selectedCollection())throw new Error('Select a saved source collection.');
  requestSource='collection';
  offset=0;selected=null;detailSequence++;
  $('request-detail').hidden=true;
  renderCaptureSelectors();savePreferences();switchView('requests');
  await loadRequests();
}
function renderPause() {
  $('pause-panel').hidden=!pauseCommand;
  if(!pauseCommand)return;
  const rejected=pauseCommand.state==='rejected';
  const resolved=['completed','rejected','absent'].includes(pauseCommand.state);
  text('pause-description',rejected ? 'The service returned this saved rejection. A revision conflict can prepare a new pause at the current saved revision; the original run stays retained.' : pauseCommand.state==='completed' ? 'This pause request has a saved outcome. Reopen the collection to read its current progress.' : 'This pause has its own retained original ID and input. Inspect its saved outcome after a lost response, or retry the same pause command.');
  text('pause-request-id',pauseCommand.requestId);
  text('pause-json',json(pauseCommand));
  $('pause-inspect').disabled=pauseBusy;
  $('pause-retry').disabled=pauseBusy || ['completed','rejected'].includes(pauseCommand.state);
  $('pause-current').hidden=!(rejected && pauseCommand.lastError?.code==='REVISION_CONFLICT');
  $('pause-current').disabled=pauseBusy;
  $('pause-dismiss').hidden=!resolved;
  $('pause-dismiss').disabled=pauseBusy;
  $('pause-download').disabled=pauseBusy;
}
async function prepareCollectionPause() {
  if(pauseBusy)throw new Error('The original pause request is still being prepared or sent.');
  const previous=pauseCommand;
  if(previous && !(previous.state==='rejected' && previous.lastError?.code==='REVISION_CONFLICT'))throw new Error('Reconcile the retained pause request before preparing another pause.');
  const target=previous?.payload?.collectionId || collectionId;
  let prepared=false;
  pauseBusy=true;renderPause();renderCollectionControls();
  try{
    const current=await api('/api/state');
    const plan=current.collections?.find((item)=>item.id===target);
    if(!plan || plan.state!=='RUNNING')throw new Error('This collection has no active source run to pause. Refresh its saved progress.');
    if(plan.pauseRequested){
      workspace=current;renderCollectionSelectors();
      await loadCollection();
      notify('This collection already has a saved pause request.');
      return;
    }
    const id=crypto.randomUUID();
    const command={
      schema:'commons.open311.browser-command.v1',
      origin:location.origin,workspaceId:current.workspaceId,requestId:id,
      endpoint:'/api/collection-pause',payload:{requestId:id,expectedRevision:current.revision,collectionId:target},
      createdAt:new Date().toISOString(),state:'prepared',
      ...(previous ? {supersedes:previous} : {})
    };
    await pendingStorage('write',command,'pause');
    pauseCommand=command;
    prepared=true;
  }finally{
    pauseBusy=false;renderPause();renderCollectionControls();
  }
  if(prepared)await sendCollectionPause();
}
async function sendCollectionPause() {
  if(!pauseCommand || pauseBusy)return;
  const command=pauseCommand;
  pauseBusy=true;renderPause();renderCollectionControls();
  let saved=false;
  try{
    const result=await api(command.endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Open311-Workspace':command.workspaceId},body:JSON.stringify(command.payload)});
    pauseCommand={...command,state:'completed',result};
    await pendingStorage('write',pauseCommand,'pause').catch(()=>{});
    saved=true;
    await pendingStorage('delete',undefined,'pause');
    pauseCommand=null;
    notify('Pause requested. The active source response is retained before this collection stops.');
  }catch(error){
    const definite=!error.uncertain && error.status>=400 && error.status<500 && ![408,429].includes(error.status) && !['OPERATION_RUNNING','OPERATION_PENDING'].includes(error.code);
    pauseCommand={...command,state:saved ? 'completed' : definite ? 'rejected' : 'uncertain',lastError:{message:error.message,code:error.code || null,status:error.status || null,at:new Date().toISOString()}};
    await pendingStorage('write',pauseCommand,'pause').catch(()=>{});
    notify(saved ? 'The pause is saved; its local retained command remains available for reconciliation.' : error.message,'error');
  }finally{
    pauseBusy=false;renderPause();renderCollectionControls();
  }
  if(saved)await loadCollection();
}
async function inspectCollectionPause() {
  if(!pauseCommand || pauseBusy)return;
  let result;
  try{result=await api(queryPath('/api/operation',{requestId:pauseCommand.requestId}));}
  catch(error){if(error.status===404 && error.code==='OPERATION_NOT_FOUND')result=null;else throw error;}
  const operation=result?.operation ?? result;
  if(!operation?.requestId)pauseCommand={...pauseCommand,state:pauseCommand.state==='rejected' ? 'rejected' : 'absent',inspection:{at:new Date().toISOString(),operation:null}};
  else{
    const state=String(operation.state || '').toUpperCase();
    pauseCommand={...pauseCommand,state:['SUCCEEDED','COMPLETED'].includes(state) ? 'completed' : ['FAILED','REJECTED'].includes(state) ? 'rejected' : 'uncertain',inspection:{at:new Date().toISOString(),operation}};
  }
  await pendingStorage('write',pauseCommand,'pause');
  renderPause();renderCollectionControls();
  await loadCollection();
}
async function dismissCollectionPause() {
  if(!pauseCommand || !['completed','rejected','absent'].includes(pauseCommand.state))return;
  await pendingStorage('delete',undefined,'pause');
  pauseCommand=null;
  renderPause();renderCollectionControls();
  await refreshState();
}

function renderDiffSelectors() {
  const kind=$('diff-source').value;
  const values=kind==='collection' ? collectionsFor() : capturesFor(connectionId,true);
  const oldBefore=$('diff-before').value;
  const oldAfter=$('diff-after').value;
  const entries=values.map((item)=>({value:item.id,label:kind==='collection' ? collectionLabel(item) : captureLabel(item)}));
  options('diff-before',entries,values.some((item)=>item.id===oldBefore) ? oldBefore : values[1]?.id || '',values.length ? 'Choose earlier source' : 'No saved sources');
  options('diff-after',entries,values.some((item)=>item.id===oldAfter) ? oldAfter : values[0]?.id || '',values.length ? 'Choose later source' : 'No saved sources');
}
async function compareCaptures() {
  const sequence=++comparisonSequence;
  const targetConnection=connectionId;
  const before=$('diff-before').value,after=$('diff-after').value;
  const kind=$('diff-source').value;
  if(!before || !after)throw new Error('Choose an earlier and a later saved request source.');
  if(before===after)throw new Error('Choose two different sources.');
  const values=kind==='collection' ? workspace.collections : workspace.captures;
  const first=values.find((item)=>item.id===before),second=values.find((item)=>item.id===after);
  if(first?.capturedAt && second?.capturedAt && first.capturedAt>second.capturedAt)throw new Error('The Earlier capture must precede the Later capture.');
  const result=await api(queryPath('/api/diff',{before,after,kind:kind==='collection' ? 'collection' : undefined}));
  if(sequence!==comparisonSequence || targetConnection!==connectionId)return;
  comparison=result;
  comparisonIds={before,after,connectionId,kind};
  comparisonOffset=0;
  const comparable=comparison.scopeComparable;
  text('diff-context',kind==='collection' ? (comparable===true ? 'Both collections have matching fully queried scopes. Records absent from the later selection remain retained with the earlier source.' : 'Read the saved source scopes and coverage alongside this collection comparison. Each earlier request remains retained with its original observations.') : comparable===true ? 'Both captures have comparable source selections. An absent record stays retained in the earlier capture.' : 'The captures have different or unspecified source selections. Read their saved query and coverage alongside records absent from the later capture.');
  $('diff-summary').hidden=false;
  $('diff-toolbar').hidden=false;
  $('diff-summary').replaceChildren(...[['Added',comparison.added],['Changed',comparison.changed],['Absent in later source',comparison.missingFromCapture],['Unchanged',comparison.unchanged]].map(([label,rows])=>{
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
    cell(row).append(button('Inspect',()=>showInspector('Request '+entry.id+' · '+entry.label,{...comparisonIds,...entry},'Complete retained before and after values.',[button('Open source request',async()=>{$('inspector').close();switchView('requests');await openRequest(entry.id,{connectionId:comparisonIds.connectionId,...(comparisonIds.kind==='collection' ? {collectionId:entry.after ? comparisonIds.after : comparisonIds.before} : {captureId:entry.after ? comparisonIds.after : comparisonIds.before})});})])));
    return row;
  }));
  text('diff-range',rows.length ? (comparisonOffset+1)+'–'+Math.min(comparisonOffset+shown.length,rows.length)+' of '+rows.length+' comparison rows' : '0 comparison rows');
  $('diff-prev').disabled=comparisonOffset===0;
  $('diff-next').disabled=comparisonOffset+shown.length>=rows.length;
}
function exportComparison(kind) {
  if(!comparison)throw new Error('Compare two saved request sources first.');
  const name='open311-comparison-'+short(comparisonIds.before)+'-'+short(comparisonIds.after);
  if(kind==='json'){downloadJson({schema:comparisonIds.kind==='collection' ? 'commons.open311.collection-comparison-export.v1' : 'commons.open311.capture-comparison-export.v1',workspaceId:workspace.workspaceId,...comparisonIds,comparison},name+'.json');return;}
  const rows=comparisonRows();
  downloadCsv(['change','service_request_id','service_code','service_name','before_status','after_status','changed_fields',comparisonIds.kind==='collection' ? 'before_collection_id' : 'before_capture_id',comparisonIds.kind==='collection' ? 'after_collection_id' : 'after_capture_id'],rows.map((entry)=>{
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
  const identityFixed=!!value.id && (capturesFor(value.id).length>0 || collectionsFor(value.id).length>0);
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
  return !!workspace && (workspace.connections || []).length===0 && (workspace.captures || []).length===0 && (workspace.reviews || []).length===0 && (workspace.collections || []).length===0;
}
function renderHandoverSource() {
  const selected=parseSourceChoice($('export-capture').value);
  $('handover-source-export').hidden=selected.kind==='collection';
}
function renderHandover() {
  if(!workspace)return;
  const entries=sourceEntries();
  const previous=$('export-capture').value;
  const selectedSource=sourceChoice(requestSource,requestSource==='collection' ? collectionId : captureId);
  options('export-capture',entries,entries.some((item)=>item.value===previous) ? previous : selectedSource,entries.length ? 'Choose a saved source' : 'No saved request sources');
  renderHandoverSource();
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
  const supportedSchemas=new Set(['commons.open311.workspace-export.v1','commons.open311.workspace-export.v2']);
  if(!supportedSchemas.has(bundle.schema))throw new Error('Choose a complete Open311 workspace export (v1 or v2).');
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
    collections:bundle.manifest?.collectionCount ?? (Array.isArray(payload.collections) ? payload.collections.length : undefined),
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
  if(!workspace)throw new Error('Open the saved workspace before restoring its original command.');
  const file=$('command-file').files[0];
  if(!file)return;
  const value=await readJsonFile(file);
  const endpoints=new Set(['/api/connections','/api/capture','/api/reviews','/api/receive','/api/collections','/api/collection-run','/api/collection-pause']);
  if(value.schema!=='commons.open311.browser-command.v1' || !endpoints.has(value.endpoint) || !value.payload || typeof value.requestId!=='string' || value.payload.requestId!==value.requestId || !Number.isInteger(value.payload.expectedRevision) || value.payload.expectedRevision<0)throw new Error('This file is not a complete original Open311 browser command.');
  if(value.workspaceId!==workspace.workspaceId)throw new Error('Open the command’s original workspace '+value.workspaceId+' before restoring this request.');
  if(value.endpoint==='/api/collection-pause'){
    if(pauseCommand || pauseBusy)throw new Error('Reconcile the existing retained pause before restoring another pause command.');
    pauseCommand={...value,state:'uncertain',restoredAt:new Date().toISOString(),restoredFrom:file.name};
    await pendingStorage('write',pauseCommand,'pause');
    renderPause();renderCollectionControls();
    $('pause-panel').scrollIntoView({behavior:'smooth',block:'start'});
    notify('Original pause command restored. Inspect its saved outcome before selecting a retry.');
    return;
  }
  if(pending || busy)throw new Error('Reconcile the existing original command before restoring another workspace command.');
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
  for(const node of document.querySelectorAll('[data-view]'))node.addEventListener('click',()=>safely(async()=>{switchView(node.dataset.view);$('main').focus({preventScroll:true});if(view==='requests')await loadRequests();}));
  $('reload-state').addEventListener('click',()=>safely(async()=>{await refreshState();notify('Reloaded saved revision '+workspace.revision+'.');}));
  $('active-connection').addEventListener('change',()=>safely(()=>chooseConnection($('active-connection').value)));
  $('toggle-capture').addEventListener('click',()=>{$('capture-panel').hidden=!$('capture-panel').hidden;if(!$('capture-panel').hidden)renderCaptureKind();});
  $('capture-cancel').addEventListener('click',()=>{$('capture-panel').hidden=true;});
  $('capture-kind').addEventListener('change',renderCaptureKind);
  $('capture-form').addEventListener('submit',(event)=>{event.preventDefault();safely(captureSource);});
  $('request-capture').addEventListener('change',()=>safely(async()=>{
    const choice=parseSourceChoice($('request-capture').value);
    requestSource=choice.kind;
    if(choice.kind==='collection')collectionId=choice.id;else captureId=choice.id;
    offset=0;selected=null;$('request-detail').hidden=true;detailSequence++;
    renderCaptureSelectors();savePreferences();await loadRequests();
  }));
  $('inspect-capture').addEventListener('click',()=>safely(async()=>{if(requestSource==='collection'){switchView('collections');}else await inspectCapture(captureId);}));
  $('download-source').addEventListener('click',()=>safely(()=>requestSource==='collection' ? downloadExport('json',collectionId,'collection') : downloadExport('source')));
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
  $('discard-review-draft').addEventListener('click',()=>safely(async()=>{if(!selected)return;const current=selected;clearDraft();await openRequest(current.id,{connectionId:current.connectionId,...(current.viewedCollectionId ? {collectionId:current.viewedCollectionId} : current.viewedCaptureId ? {captureId:current.viewedCaptureId} : {latest:true}),scroll:false});}));
  for(const id of ['queue-connection','queue-status'])$(id).addEventListener('change',renderQueue);
  $('queue-search').addEventListener('input',renderQueue);
  $('queue-export').addEventListener('click',exportQueue);
  $('catalog-search').addEventListener('input',renderCatalog);
  $('catalog-query-reset').addEventListener('click',()=>{catalogQueryContext='';renderCatalogQuery();});
  $('catalog-refresh').addEventListener('click',()=>safely(async()=>{
    if(!connectionId)throw new Error('Select a saved jurisdiction connection.');
    const targetConnection=connectionId;
    const query=catalogQuery();
    await mutate('/api/capture',{connectionId:targetConnection,kind:'services',query});
    if(connectionId===targetConnection)await loadCatalog();
    notify('Saved service catalog for '+connectionName(targetConnection)+'.');
  }));
  $('catalog-inspect').addEventListener('click',()=>safely(()=>inspectCapture(catalog.capture?.id)));
  $('diff-source').addEventListener('change',()=>{invalidateComparison();renderDiffSelectors();});
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
  $('export-capture').addEventListener('change',renderHandoverSource);
  for(const node of document.querySelectorAll('[data-export]'))node.addEventListener('click',()=>safely(()=>{const choice=parseSourceChoice($('export-capture').value);return downloadExport(node.dataset.export,choice.id,choice.kind);}));
  $('receive-file').addEventListener('change',()=>safely(previewReceive));
  $('receive-submit').addEventListener('click',()=>safely(receiveWorkspace));
  $('operation-inspect').addEventListener('click',()=>safely(()=>inspectOperation($('operation-id').value.trim())));
  $('operation-id').addEventListener('keydown',(event)=>{if(event.key==='Enter'){event.preventDefault();safely(()=>inspectOperation($('operation-id').value.trim()));}});
  $('command-file').addEventListener('change',()=>safely(restoreOriginalCommand));
  $('collection-new').addEventListener('click',()=>{$('collection-editor').hidden=false;$('collection-name').focus();});
  $('collection-cancel').addEventListener('click',()=>{$('collection-editor').hidden=true;});
  $('collection-form').addEventListener('submit',(event)=>{event.preventDefault();safely(()=>createCollection(false));});
  $('collection-create-run').addEventListener('click',()=>safely(()=>createCollection(true)));
  $('collection-choice').addEventListener('change',()=>safely(()=>chooseCollection($('collection-choice').value)));
  $('collection-reload').addEventListener('click',()=>safely(refreshState));
  $('collection-open').addEventListener('click',()=>safely(openCollectionRequests));
  $('collection-run').addEventListener('click',()=>safely(runCollection));
  $('collection-pause').addEventListener('click',()=>safely(prepareCollectionPause));
  $('collection-recover').addEventListener('click',()=>safely(recoverCollectionRun));
  $('collection-copy').addEventListener('click',()=>safely(copyCollectionPlan));
  $('collection-inspect').addEventListener('click',()=>{if(collectionPage.collection)showInspector('Saved source collection',{collection:collectionPage.collection,connection:collectionPage.connection},'Original plan, provider configuration, recorded progress and coverage.',[button('Download collection with all originals',()=>downloadExport('json',collectionId,'collection'))]);});
  $('collection-window-prev').addEventListener('click',()=>safely(async()=>{collectionOffset=Math.max(0,collectionPage.offset-collectionPage.limit);await loadCollection();}));
  $('collection-window-next').addEventListener('click',()=>safely(async()=>{if(collectionPage.nextOffset===null)return;collectionOffset=collectionPage.nextOffset;await loadCollection();}));
  for(const kind of ['report','csv','json','workspace'])$('collection-export-'+kind).addEventListener('click',()=>safely(()=>downloadExport(kind,collectionId,'collection')));
  $('pause-inspect').addEventListener('click',()=>safely(inspectCollectionPause));
  $('pause-retry').addEventListener('click',()=>safely(sendCollectionPause));
  $('pause-current').addEventListener('click',()=>safely(prepareCollectionPause));
  $('pause-dismiss').addEventListener('click',()=>safely(dismissCollectionPause));
  $('pause-download').addEventListener('click',()=>{if(pauseCommand)downloadJson(pauseCommand,'open311-pause-command-'+filename(pauseCommand.requestId,'original')+'.json');});
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
  [pending,pauseCommand]=await Promise.all([pendingStorage('read'),pendingStorage('read',undefined,'pause')]);
  renderPending();renderPause();
  await refreshState();
  if(!workspace.connections.length){switchView('connections');editConnection();}
}
await safely(start);
