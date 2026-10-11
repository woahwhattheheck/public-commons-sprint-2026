const $ = id => document.getElementById(id);
const tokenKey = 'starforge-object-workspace-capability';
let token = location.hash.slice(1);
if (/^[a-f0-9]{64}$/.test(token)) {
  sessionStorage.setItem(tokenKey, token); history.replaceState(null, '', location.pathname);
} else token = sessionStorage.getItem(tokenKey) ?? '';
let state = null, products = [], review = null, selected = null, page = 0, pending = false;
let query = '', filter = 'all', generation = 0, pollTimer, queryTimer, confirmAction = null;
const readable = value => String(value ?? '').replace(/_/g, ' ').toLowerCase();
const integer = value => value === null || value === undefined ? '—' : String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const bytes = value => {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return integer(value) + ' B';
  const unit = value < 1048576 ? ['KiB',1024] : value < 1073741824 ? ['MiB',1048576] : ['GiB',1073741824];
  return (value / unit[1]).toFixed(2) + ' ' + unit[0];
};
const messages = {
  OBJECT_WORKSPACE_REVIEW_CHANGED: 'The saved source or download has changed. Refresh it and review the current plan before continuing.',
  OBJECT_WORKSPACE_REVIEW_EXPIRED: 'This preparation review has expired. Review the download plan again.',
  OBJECT_WORKSPACE_BUSY: 'An operation is already running. Wait for its result or stop the active download.',
  OBJECT_WORKSPACE_SESSION_NAME_OCCUPIED: 'That session name already belongs to another reviewed plan. Choose a new name.',
  OBJECT_TOTAL_BUDGET_INSUFFICIENT: 'The whole-download cap must cover every planned request at the selected per-request maximum.',
  OBJECT_WORKSPACE_SAVED_FILE_CHANGED: 'The assembled file no longer matches its recorded bytes. Inspect the original saved results before downloading it.',
  OBJECT_WORKSPACE_CAPABILITY_REQUIRED: 'Open the complete workspace URL printed by the running command.',
  OBJECT_WORKSPACE_RUN_CHANGED: 'That run has ended or changed. The current run was left unchanged.',
};
function notice(message = '', error = false) {
  $('notice').hidden = !message; $('notice').textContent = message; $('notice').classList.toggle('error', error);
}
async function request(path, value, raw = false) {
  const response = await fetch(path, { method: value === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: { 'x-object-workspace-token': token, ...(value === undefined ? {} : {'content-type':'application/json'}) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({error:'OBJECT_WORKSPACE_REQUEST_FAILED'}));
    if (response.status === 401) sessionStorage.removeItem(tokenKey);
    throw Object.assign(new Error(result.error ?? 'OBJECT_WORKSPACE_REQUEST_FAILED'), {code:result.error});
  }
  return raw ? response : response.json();
}
function errorMessage(error) { return messages[error.code] ?? 'The operation could not complete: ' + readable(error.code ?? error.message) + '.'; }
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function details(target, values) {
  target.replaceChildren();
  for (const [label, value] of values) {
    target.append(element('dt', label)); const dd = element('dd'); dd.append(element('code', value ?? '—')); target.append(dd);
  }
}
function selectedParams() {
  const params = new URLSearchParams();
  if (selected) params.set('session', selected);
  if (page) params.set('page', String(page));
  if (filter !== 'all') params.set('filter', filter);
  if (query) params.set('query', query);
  return params.size ? '?' + params : '';
}
function schedulePoll() {
  clearTimeout(pollTimer);
  if (state?.active && !document.hidden) pollTimer = setTimeout(() => load().catch(showError), 1000);
}
async function load() {
  const current = ++generation, result = await request('/api/state' + selectedParams());
  if (current !== generation) return;
  state = result; render(); $('connection').textContent = 'Connected'; schedulePoll();
}
function showError(error) { $('connection').textContent = 'Needs attention'; notice(errorMessage(error), true); }
async function action(work) {
  if (pending) return;
  pending = true; notice(); controls();
  try { await work(); }
  catch (error) { showError(error); }
  finally { pending = false; await load().catch(showError); controls(); }
}
function selectSession(id) {
  selected = id; page = 0; query = ''; filter = 'all'; review = null;
  $('chunk-query').value = ''; $('chunk-filter').value = 'all'; $('setup').hidden = true;
  $('selection-review').hidden = true; load().catch(showError);
}
function renderSessions() {
  const list = $('session-list'); list.replaceChildren();
  for (const session of state.sessions) {
    const button = element('button', undefined, 'session-item' + (session.id === selected ? ' active' : ''));
    button.dataset.session = session.id;
    button.append(element('strong', session.name), element('span', session.id));
    const status = state.active?.session === session.id ? state.active.state : session.status;
    button.append(element('span', readable(status) + (session.bytes ? ' · ' + bytes(session.bytes) : '')));
    button.onclick = () => selectSession(session.id); list.append(button);
  }
  if (!state.sessions.length) list.append(element('p', 'No saved downloads yet.', 'list-empty'));
}
function explanation(row) {
  if (row.status === 'RUNNING') return 'Downloading through the original buyer. Review each paid request in the terminal. The page updates from completed parts.';
  if (row.status === 'STOPPING') return 'Stopping the active request and retaining its original result. Wait for the run to finish before recovery.';
  if (row.lastRun?.state === 'SETUP_REQUIRED') return 'The original buyer needs its operator setup: ' + readable(row.lastRun.error) + '. Repair that setup, refresh, and deliberately continue.';
  if (row.status === 'RECONCILIATION_REQUIRED') return 'Part ' + ((row.stoppedChunk?.index ?? 0) + 1) + ' needs reconciliation: ' + readable(row.stoppedChunk?.code) + '. Recover the saved original result or export its record for the existing operator workflow.';
  if (row.lock?.state === 'STALE') return 'The original run has a stale local process lease. Recover the saved session to reopen it.';
  if (row.status === 'COMPLETE') return 'Every part is verified. Assemble the file, then download the completed bytes.';
  if (row.status === 'RUNNING_OR_INTERRUPTED' || row.lock) return 'The original session is owned by another process. Refresh after its operation ends.';
  if (row.completeChunks) return 'Continue from the next unattempted part. ' + integer(row.completeChunks) + ' completed parts remain in the original session.';
  return 'The reviewed byte plan is saved. Start the download when you are ready to approve its original requests.';
}
function render() {
  renderSessions(); const row = state.selected;
  $('empty').hidden = Boolean(row) || !$('setup').hidden;
  $('session').hidden = !row || !$('setup').hidden;
  if (!row) { controls(); return; }
  $('session-id').textContent = 'SAVED DOWNLOAD / ' + row.id;
  $('session-title').textContent = row.name;
  $('session-source').textContent = row.sourceUrl;
  $('session-status').textContent = readable(row.status).toUpperCase();
  $('parts-value').textContent = integer(row.completeChunks) + ' / ' + integer(row.chunkCount);
  $('bytes-value').textContent = bytes(row.downloadedBytes) + ' / ' + bytes(row.bytes);
  $('cap-value').textContent = integer(row.limits.maxTotalAtomic);
  $('allocated-value').textContent = integer(row.capAllocatedAtomic);
  $('progress-bar').style.width = Math.min(100, row.downloadedBytes / row.bytes * 100) + '%';
  $('session-explanation').textContent = explanation(row);
  details($('session-terms'), [['Resource',row.sourceUrl],['Network',row.terms.network],['Scheme',row.terms.scheme],
    ['Asset',row.terms.asset],['Recipient',row.terms.payTo],['Maximum per request',row.limits.maxAtomic + ' atomic units'],
    ['Planned maximum',row.limits.plannedMaxAtomic + ' atomic units'],['Whole-download cap',row.limits.maxTotalAtomic + ' atomic units'],
    ['Content type',row.contentType],['Object snapshot',row.snapshot],['Expected whole-file SHA-256',row.expectedSha256 ?? 'Not supplied'],
    ['Measured complete SHA-256',row.objectSha256 ?? 'Available after complete verification'],
    ['Merchant description SHA-256',row.selection?.descriptionSha256]]);
  const assembly = row.assembly;
  $('assembly-status').textContent = assembly ? 'RECORDED' : row.status === 'COMPLETE' ? 'READY' : 'WAITING FOR PARTS';
  $('assembly-description').textContent = assembly ? assembly.name + ' · ' + bytes(assembly.bytes) + '. Download rechecks the saved file against this recorded SHA-256.' :
    'Assembly reads verified parts in byte order, checks the complete length and digest, and saves a new private file.';
  $('assembly-digest').hidden = !assembly; $('assembly-digest').textContent = assembly?.sha256 ?? '';
  $('run').textContent = row.completeChunks ? 'Continue download' : 'Start download';
  $('last-inspection').textContent = row.inspectedAt ? 'Observed ' + new Date(row.inspectedAt).toLocaleTimeString() : '';
  const rows = $('chunk-rows'); rows.replaceChildren();
  for (const chunk of row.chunks) {
    const tr = element('tr'); tr.append(element('td',String(chunk.index + 1)),element('td',integer(chunk.offset) + '–' + integer(chunk.offset + chunk.length - 1)));
    const status = element('td',readable(chunk.state)); status.append(element('small',integer(chunk.length) + ' bytes')); tr.append(status);
    const outcome = element('td',chunk.outcome ? readable(chunk.outcome) : '—'); outcome.append(element('small',chunk.intentId)); tr.append(outcome);
    const digest = element('td'); digest.append(element('code',chunk.sha256 ?? (chunk.code ? readable(chunk.code) : 'Awaiting original request'))); tr.append(digest); rows.append(tr);
  }
  if (!row.chunks.length) { const tr = element('tr'), td = element('td','No parts match this filter.','no-rows'); td.colSpan = 5; tr.append(td); rows.append(tr); }
  $('page-label').textContent = integer(row.pagination.total) + ' parts · Page ' + (row.pagination.page + 1) + ' of ' + row.pagination.pages;
  page = row.pagination.page; controls();
}
function controls() {
  const row = state?.selected;
  for (const id of ['run','stop','recover','assemble','download','refresh']) $(id).disabled = pending || !row?.controls[id];
  $('previous').disabled = pending || !row || row.pagination.page === 0;
  $('next').disabled = pending || !row || row.pagination.page + 1 >= row.pagination.pages;
  $('review-selection').disabled = pending || !products.some(product => product.id === $('product').value && !product.error);
  $('create-session').disabled = pending || !review;
  $('refresh-list').disabled = pending;
  for (const id of ['export-html','export-json']) $(id).disabled = pending || !row || Boolean(state?.active || state?.mutation);
}
function productChanged() {
  review = null; $('selection-review').hidden = true;
  const product = products.find(item => item.id === $('product').value);
  if (!product || product.error) {
    $('product-summary').textContent = product ? 'This product needs operator setup: ' + readable(product.error) : 'Add a trusted product profile when launching this workspace.';
    controls(); return;
  }
  $('product-summary').textContent = product.filename + ' · ' + bytes(product.bytes) + ' · ' + product.sourceUrl;
  $('chunk-bytes').value = String(product.chunkBytes); $('chunk-bytes').max = String(product.chunkBytes);
  $('total-cap').value = product.plannedMaxAtomic;
  $('session-name').value = product.id + '-' + new Date().toISOString().slice(0,10);
  controls();
}
async function newDownload() {
  await action(async () => {
    products = (await request('/api/products')).products;
    const select = $('product'); select.replaceChildren();
    for (const product of products) { const option = element('option',product.label + (product.error ? ' · setup required' : '')); option.value = product.id; select.append(option); }
    if (!products.length) { const option = element('option','No product profile configured'); option.value = ''; select.append(option); }
    $('setup').hidden = false; $('session').hidden = true; $('empty').hidden = true; productChanged();
  });
}
function confirm({ title, copy, fields, note, button }, callback) {
  confirmAction = callback; $('confirmation-title').textContent = title; $('confirmation-copy').textContent = copy;
  details($('confirmation-details'),fields); $('confirmation-note').textContent = note;
  $('confirmation-accept').textContent = button; $('confirmation').showModal();
}
function cancelConfirmation() { confirmAction = null; $('confirmation').close(); }
$('confirmation-cancel').onclick = cancelConfirmation;
$('confirmation').addEventListener('cancel',()=>{confirmAction = null;});
$('confirmation-accept').onclick = () => { const callback = confirmAction; confirmAction = null; $('confirmation').close(); if (callback) action(callback); };
$('new-download').onclick = newDownload; $('empty-new').onclick = newDownload;
$('close-setup').onclick = () => {$('setup').hidden = true; review = null; render();};
$('product').onchange = productChanged;
for (const id of ['session-name','chunk-bytes','total-cap']) $(id).addEventListener('input',()=>{review = null; $('selection-review').hidden = true; controls();});
$('setup-form').onsubmit = event => {
  event.preventDefault(); action(async () => {
    review = await request('/api/review',{productId:$('product').value,sessionName:$('session-name').value,
      chunkBytes:Number($('chunk-bytes').value),maxTotalAtomic:$('total-cap').value});
    details($('review-terms'),[['Session',review.sessionName],['File',review.filename],['Complete bytes',integer(review.bytes)],
      ['Requests',integer(review.chunkCount)],['Bytes per request',integer(review.chunkBytes)],
      ['First range',review.firstRange.offset + '–' + (review.firstRange.length - 1)],
      ['Last range',review.lastRange.offset + '–' + (review.lastRange.offset + review.lastRange.length - 1)],
      ['Network',review.terms.network],['Asset',review.terms.asset],['Recipient',review.terms.payTo],
      ['Maximum per request',review.terms.maxAtomic + ' atomic units'],['Planned maximum',review.plannedMaxAtomic + ' atomic units'],
      ['Whole-download cap',review.maxTotalAtomic + ' atomic units'],['Snapshot',review.snapshot],
      ['Native workspace',review.operatorWorkspace ? 'Configured original workspace' : 'Original configured operator environment']]);
    $('selection-review').hidden = false;
  });
};
$('create-session').onclick = () => action(async () => {
  const created = await request('/api/create',{reviewId:review.reviewId});
  selected = created.session; page = 0; query = ''; filter = 'all'; $('chunk-query').value = ''; $('chunk-filter').value = 'all';
  $('setup').hidden = true; review = null; $('selection-review').hidden = true;
  notice(created.recoveredCreate ? 'Reopened the same saved download plan.' : 'The reviewed download plan is saved.');
});
$('run').onclick = () => {
  const row = state.selected, session = selected, expectedRevision = row.revision, actionId = crypto.randomUUID();
  confirm({title:row.completeChunks ? 'Continue this download?' : 'Start this download?',
    copy:'The original buyer will request the next untouched parts from the selected merchant.',
    fields:[['File',row.name],['Remaining parts',integer(row.chunkCount - row.completeChunks)],['Network',row.terms.network],
      ['Asset',row.terms.asset],['Recipient',row.terms.payTo],['Maximum per request',row.limits.maxAtomic + ' atomic units'],
      ['Whole-download cap',row.limits.maxTotalAtomic + ' atomic units']],
    note:'Keep the launching terminal available. Each paid request keeps its original approval and spending-ledger checks.',button:'Start original buyer'},
  async()=>{await request('/api/run',{session,expectedRevision,actionId});});
};
$('stop').onclick = () => { const run = state.active; if(run) action(async()=>{await request('/api/stop',{session:run.session,runId:run.id});}); };
$('recover').onclick = () => { const row = state.selected; action(async()=>{await request('/api/recover',{session:row.id,expectedRevision:row.revision});notice('Original saved results recovered.');}); };
$('refresh').onclick = () => action(async()=>{await request('/api/refresh',{session:selected});notice('Current saved parts and original outcomes verified.');});
$('refresh-list').onclick = () => action(async()=>{await request('/api/refresh',{session:selected});});
$('assemble').onclick = () => {
  const row = state.selected;
  confirm({title:'Assemble the complete file?',copy:'This reads the original verified parts and saves their byte sequence to a new private file.',
    fields:[['File',row.name],['Size',integer(row.bytes) + ' bytes'],['Parts',integer(row.chunkCount)],['Complete SHA-256',row.objectSha256]],
    note:'The original chunk files and attempt history remain available for subsequent review.',button:'Assemble file'},
  async()=>{await request('/api/assemble',{session:row.id,expectedRevision:row.revision});notice('The complete file is assembled and ready to download.');});
};
$('download').onclick = () => action(async()=>{
  const result = await request('/api/download-ticket',{session:selected});
  const link = element('a'); link.href = result.url; link.download = state.selected.assembly.name;
  document.body.append(link); link.click(); link.remove();
});
async function exportFile(kind) {
  const response = await request('/api/export?'+new URLSearchParams({session:selected,kind}),undefined,true);
  const blob = await response.blob(), url = URL.createObjectURL(blob), link = element('a');
  link.href = url; link.download = selected + (kind === 'html' ? '.html' : '.json'); document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
$('export-html').onclick = () => action(()=>exportFile('html')); $('export-json').onclick = () => action(()=>exportFile('json'));
$('previous').onclick = () => {if(page){page--;load().catch(showError);}};
$('next').onclick = () => {page++;load().catch(showError);};
$('chunk-filter').onchange = () => {filter = $('chunk-filter').value;page = 0;load().catch(showError);};
$('chunk-query').oninput = () => {clearTimeout(queryTimer);queryTimer = setTimeout(()=>{query=$('chunk-query').value;page=0;load().catch(showError);},180);};
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(pollTimer);else load().catch(showError);});
load().catch(showError);
