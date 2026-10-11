const $ = id => document.getElementById(id);
const tokenKey = 'starforge-object-workspace-capability';
let token = location.hash.slice(1);
if (/^[a-f0-9]{64}$/.test(token)) {
  sessionStorage.setItem(tokenKey, token); history.replaceState(null, '', location.pathname);
} else token = sessionStorage.getItem(tokenKey) ?? '';
let state = null, products = [], review = null, selected = null, page = 0, pending = false;
let section = sessionStorage.getItem('starforge-object-workspace-view') === 'accounting' ? 'accounting' : 'delivery';
let query = '', filter = 'all', generation = 0, pollTimer, queryTimer, confirmAction = null;
let downloadWatchUntil = 0;
let receiving = { sources: [], operator: null }, receivedChoices = [], receivedReview = null, receivingGeneration = 0;
let recoveryState = null, backupReview = null;
let analysisReview = null, analysisAction = null;
const readable = value => String(value ?? '').replace(/_/g, ' ').toLowerCase();
const integer = value => value === null || value === undefined ? '—' : String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const bytes = value => {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return integer(value) + ' B';
  const unit = value < 1048576 ? ['KiB',1024] : value < 1073741824 ? ['MiB',1048576] : ['GiB',1073741824];
  return (value / unit[1]).toFixed(2) + ' ' + unit[0];
};
const isWhole = value => value?.deliveryMode === 'whole';
const deliveryLabel = value => isWhole(value) ? 'Whole file · one GET' : 'Byte chunks';
function requestPlan(value) {
  return [['Delivery',deliveryLabel(value)],['Complete bytes',integer(value.bytes)],['Requests',integer(value.chunkCount)],
    ...(isWhole(value) ? [['Request', 'GET ' + value.sourceUrl],['Expected response','HTTP 200 · complete file']] :
      [['Bytes per request',integer(value.chunkBytes)],
        ['First range',value.firstRange.offset + '–' + (value.firstRange.length - 1)],
        ['Last range',value.lastRange.offset + '–' + (value.lastRange.offset + value.lastRange.length - 1)]])];
}
const messages = {
  OBJECT_WORKSPACE_REVIEW_CHANGED: 'The saved source or download has changed. Refresh it and review the current plan before continuing.',
  OBJECT_WORKSPACE_REVIEW_EXPIRED: 'This preparation review has expired. Review the download plan again.',
  OBJECT_WORKSPACE_BUSY: 'An operation is already running. Wait for its result or stop the active download.',
  OBJECT_WORKSPACE_SESSION_NAME_OCCUPIED: 'That session name already belongs to another reviewed plan. Choose a new name.',
  OBJECT_TOTAL_BUDGET_INSUFFICIENT: 'The whole-download cap must cover every planned request at the selected per-request maximum.',
  OBJECT_WORKSPACE_SAVED_FILE_CHANGED: 'The assembled file no longer matches its recorded bytes. Inspect the original saved results before downloading it.',
  OBJECT_WORKSPACE_DOWNLOAD_STOPPED: 'The file transfer stopped. Its original assembled file and purchase records remain available.',
  OBJECT_WORKSPACE_DOWNLOAD_INTERRUPTED: 'The file transfer ended before completion. Download the recorded file again when ready.',
  OBJECT_WORKSPACE_CAPABILITY_REQUIRED: 'Open the complete workspace URL printed by the running command.',
  OBJECT_WORKSPACE_RUN_CHANGED: 'That run has ended or changed. The current run was left unchanged.',
  OBJECT_WORKSPACE_ACCOUNTING_WORKSPACE_REQUIRED: 'This download has no saved native operator workspace. Its existing receipts remain readable; use the original accounting command with the matching workspace to finalize earlier attempts.',
  OBJECT_WORKSPACE_SESSION_CHANGED: 'The saved session identity changed. Reopen the workspace with the intended original session.',
  OBJECT_RECEIVING_PRESET_CHANGED: 'The local operator preset changed after review. Review the received download with its current settings.',
  OBJECT_RECEIVING_BUDGET_OUTSIDE_OPERATOR_LIMITS: 'The daily and whole-download caps must fit this host’s operator ceilings. Each request must also fit the daily cap.',
  OBJECT_RECEIVING_SOURCE_CHANGED: 'The retained merchant files changed. Receive the original files again before preparing this object.',
  OBJECT_WHOLE_FILE_SIZE_FIXED: 'This merchant sells the complete file in one request. Its byte count is fixed by the original descriptor.',
  REQUEST_OPERATOR_PRESET_REQUIRED: 'Launch this workspace with its private --operator-settings preset to prepare a new buyer.',
  OBJECT_RECOVERY_REVIEW_CHANGED: 'The selected backup contents changed. Review the current state before creating the backup.',
  OBJECT_RECOVERY_DEPENDENCY_OUTSIDE_ROOT: 'Choose the common private state root that contains this workspace, its operator preset and every selected native buyer.',
  OBJECT_RECOVERY_ORIGINAL_OPERATOR_REQUIRED: 'Workspace backup requires the original prepared buyer and its committed spending journal. Prepare the received product with your local preset first, or select its existing native operator.',
  WORKSPACE_RECOVERY_TARGET_NOT_EMPTY: 'The original restore location contains files. Close its programs and preserve that existing directory before restoring to an absent or empty location.',
  OBJECT_ANALYSIS_STOP_BEFORE_BACKUP: 'Stop the analysis workspace in Data analysis, then review the backup contents again.',
  OBJECT_ANALYSIS_SOURCE_INVALID: 'Choose JSON or CSV and a source name beginning with a letter, followed by letters, numbers or underscores.',
  DATASET_ANALYSIS_COMMAND_FAILED: 'The original Python application could not start. Check Python on the launching host or supply --analysis-python, then reopen the same saved work.',
  ANALYSIS_WORKSPACE_ALREADY_OPEN: 'This database is already open in another analysis process. Use that original workspace or close its owning terminal before reopening it here.',
  ANALYSIS_SOURCE_CHANGED: 'The named analysis source changed after review. Review its current revision before registering this file.',
  DATASET_ANALYSIS_STOPPED: 'The analysis operation stopped. The original downloaded file and committed analytical work remain available.',
  DATASET_ANALYSIS_WORKSPACE_CHANGED: 'The target analysis database changed after review. Review this source against the current workspace.',
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
  if (section === 'accounting') params.set('section', section);
  if (page) params.set('page', String(page));
  if (filter !== 'all') params.set('filter', filter);
  if (query) params.set('query', query);
  return params.size ? '?' + params : '';
}
function schedulePoll() {
  clearTimeout(pollTimer);
  if ((state?.active || Date.now() < downloadWatchUntil || !$('analysis-panel').hidden && state?.analysis?.running) && !document.hidden)
    pollTimer = setTimeout(() => load().catch(showError), state?.active ? 1000 : 2000);
}
async function load() {
  const current = ++generation, result = await request('/api/state' + selectedParams());
  if (current !== generation) return;
  state = result; render(); $('connection').textContent = 'Connected'; schedulePoll();
  if (!$('recovery-panel').hidden) await loadRecovery();
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
  $('recovery-panel').hidden = true;
  $('analysis-panel').hidden = true; analysisReview = null; analysisAction = null;
}
function renderSessions() {
  const list = $('session-list'); list.replaceChildren();
  for (const session of state.sessions) {
    const button = element('button', undefined, 'session-item' + (session.id === selected ? ' active' : ''));
    button.dataset.session = session.id;
    button.append(element('strong', session.name), element('span', session.id));
    const status = state.active?.session === session.id ? state.active.state : session.status;
    button.append(element('span', readable(status) + (Number.isFinite(session.bytes) ? ' · ' + bytes(session.bytes) : '')));
    button.onclick = () => selectSession(session.id); list.append(button);
  }
  if (!state.sessions.length) list.append(element('p', 'No saved downloads yet.', 'list-empty'));
}
function explanation(row) {
  if (state.active?.session === row.id && state.active.kind === 'FILE_DOWNLOAD')
    return state.active.state === 'STOPPING' ? 'Stopping this file transfer and closing its saved-file read.' :
      'Checking and streaming the recorded file to your browser. Stop file transfer cancels this exact read and leaves the original file available.';
  if (state.active?.session === row.id && ['FINALIZE','EXPORT'].includes(state.active.kind)) return 'An operation is running on the original purchase records. Open Purchase records to follow it or stop it.';
  if (row.status === 'RUNNING') return 'Downloading through the original buyer. Review each paid request in the terminal. The page updates from completed parts.';
  if (row.status === 'STOPPING') return 'Stopping the active request and retaining its original result. Wait for the run to finish before recovery.';
  if (row.lastRun?.state === 'SETUP_REQUIRED') return 'The original buyer needs its operator setup: ' + readable(row.lastRun.error) + '. Repair that setup, refresh, and deliberately continue.';
  if (row.status === 'RECONCILIATION_REQUIRED') return 'Part ' + ((row.stoppedChunk?.index ?? 0) + 1) + ' needs reconciliation: ' + readable(row.stoppedChunk?.code) + '. Recover the saved original result or export its record for the existing operator workflow.';
  if (row.lock?.state === 'STALE') return 'The original run has a stale local process lease. Recover the saved session to reopen it.';
  if (row.status === 'COMPLETE') return isWhole(row) ?
    'The complete response is verified. Save the whole file, then download its recorded bytes.' :
    'Every part is verified. Assemble the file, then download the completed bytes.';
  if (row.status === 'RUNNING_OR_INTERRUPTED' || row.lock) return 'The original session is owned by another process. Refresh after its operation ends.';
  if (row.completeChunks) return 'Continue from the next unattempted part. ' + integer(row.completeChunks) + ' completed parts remain in the original session.';
  return 'The reviewed byte plan is saved. Start the download when you are ready to approve its original requests.';
}
function render() {
  renderSessions(); const row = state.selected;
  renderAnalysis();
  $('empty').hidden = Boolean(row) || !$('setup').hidden || !$('recovery-panel').hidden || !$('analysis-panel').hidden;
  $('session').hidden = !row || !$('setup').hidden || !$('recovery-panel').hidden || !$('analysis-panel').hidden;
  if (!row) { controls(); return; }
  $('session-id').textContent = 'SAVED DOWNLOAD / ' + row.id;
  $('session-title').textContent = row.name;
  $('session-source').textContent = row.sourceUrl;
  $('session-status').textContent = readable(row.status).toUpperCase();
  $('delivery-view').hidden = section !== 'delivery'; $('accounting-view').hidden = section !== 'accounting';
  for (const name of ['delivery','accounting']) {
    $(name + '-tab').setAttribute('aria-current',section === name ? 'page' : 'false');
  }
  if (section === 'accounting') { renderAccounting(row); controls(); return; }
  $('parts-value').textContent = integer(row.completeChunks) + ' / ' + integer(row.chunkCount);
  $('bytes-value').textContent = bytes(row.downloadedBytes) + ' / ' + bytes(row.bytes);
  $('cap-value').textContent = integer(row.limits.maxTotalAtomic);
  $('allocated-value').textContent = integer(row.capAllocatedAtomic);
  $('progress-bar').style.width = (row.bytes ? Math.min(100, row.downloadedBytes / row.bytes * 100) :
    row.completeChunks === row.chunkCount ? 100 : 0) + '%';
  $('session-explanation').textContent = explanation(row);
  details($('session-terms'), [['Delivery',deliveryLabel(row)],['Resource',row.sourceUrl],['Network',row.terms.network],['Scheme',row.terms.scheme],
    ['Asset',row.terms.asset],['Recipient',row.terms.payTo],['Maximum per request',row.limits.maxAtomic + ' atomic units'],
    ['Planned maximum',row.limits.plannedMaxAtomic + ' atomic units'],['Whole-download cap',row.limits.maxTotalAtomic + ' atomic units'],
    ['Content type',row.contentType],['Object snapshot',row.snapshot],['Expected whole-file SHA-256',row.expectedSha256 ?? 'Not supplied'],
    ['Measured complete SHA-256',row.objectSha256 ?? 'Available after complete verification'],
    ['Merchant description SHA-256',row.selection?.descriptionSha256]]);
  const assembly = row.assembly;
  $('assembly-status').textContent = assembly ? 'RECORDED' : row.status === 'COMPLETE' ? 'READY' : 'WAITING FOR PARTS';
  $('assembly-description').textContent = assembly ? assembly.name + ' · ' + bytes(assembly.bytes) + '. Download rechecks the saved file against this recorded SHA-256.' :
    isWhole(row) ? 'Save the verified whole response to a new private file with its recorded length and digest.' :
      'Assembly reads verified parts in byte order, checks the complete length and digest, and saves a new private file.';
  $('assemble').textContent = isWhole(row) ? 'Save whole file' : 'Assemble file';
  $('assembly-digest').hidden = !assembly; $('assembly-digest').textContent = assembly?.sha256 ?? '';
  const fileTransfer = state.active?.session === row.id && state.active.kind === 'FILE_DOWNLOAD' ? state.active : row.lastFileTransfer;
  $('file-transfer-progress').hidden = !fileTransfer;
  if (fileTransfer) {
    const label = fileTransfer.phase === 'VERIFYING' ? 'Checking saved file' : 'Streaming verified file';
    const count = fileTransfer.phase === 'VERIFYING' ? fileTransfer.verifiedBytes : fileTransfer.streamedBytes;
    $('file-transfer-progress').textContent = label + ': ' + readable(fileTransfer.state) + ' · ' +
      bytes(count) + ' / ' + bytes(fileTransfer.totalBytes) + '. ' +
      (fileTransfer.state === 'COMPLETED' ? 'The stream completed; your browser manages the downloaded copy.' :
        fileTransfer.state === 'STOPPED' ? 'The original file is retained. Download it again when ready.' :
        fileTransfer.error ? errorMessage({code:fileTransfer.error}) : '');
  }
  $('stop').textContent = state.active?.kind === 'FILE_DOWNLOAD' ? 'Stop file transfer' : 'Stop download';
  $('run').textContent = row.completeChunks ? 'Continue download' : 'Start download';
  $('last-inspection').textContent = row.inspectedAt ? 'Observed ' + new Date(row.inspectedAt).toLocaleTimeString() : '';
  const rows = $('chunk-rows'); rows.replaceChildren();
  for (const chunk of row.chunks) {
    const tr = element('tr'); tr.append(element('td',String(chunk.index + 1)),element('td',isWhole(row) ?
      'Whole file' : integer(chunk.offset) + '–' + integer(chunk.offset + chunk.length - 1)));
    const status = element('td',readable(chunk.state)); status.append(element('small',integer(chunk.length) + ' bytes')); tr.append(status);
    const outcome = element('td',chunk.outcome ? readable(chunk.outcome) : '—'); outcome.append(element('small',chunk.intentId)); tr.append(outcome);
    const digest = element('td'); digest.append(element('code',chunk.sha256 ?? (chunk.code ? readable(chunk.code) : 'Awaiting original request'))); tr.append(digest); rows.append(tr);
  }
  if (!row.chunks.length) { const tr = element('tr'), td = element('td','No parts match this filter.','no-rows'); td.colSpan = 5; tr.append(td); rows.append(tr); }
  $('page-label').textContent = integer(row.pagination.total) + ' parts · Page ' + (row.pagination.page + 1) + ' of ' + row.pagination.pages;
  page = row.pagination.page; controls();
}
function renderAccounting(row) {
  const record = row.accounting, counts = row.totals;
  $('accounting-observed').textContent = 'Read ' + new Date(record.observedAt).toLocaleTimeString();
  details($('accounting-terms'),[['Delivery',deliveryLabel(record)],['Network',record.terms.network],['Asset',record.terms.asset],
    ['Recipient',record.terms.payTo],['Original parts',integer(record.range.total)],
    ['Operator workspace',record.workspace ? 'Saved with this original session' : 'Not bound to this session']]);
  $('accounting-explanation').textContent = record.workspace ?
    'Finalization covers every original part. It can check network finality for earlier approved reservations and retain their receipts. It does not create a download request or another payment. Reading these saved views requires no signing keys or network.' :
    'Saved receipts remain available without a signer, network connection or delivered file. This session has no saved operator workspace; the original accounting command can finalize it with an explicitly selected matching workspace.';
  $('accounting-actual').textContent = integer(counts.actualAtomicUnits);
  $('accounting-finalized').textContent = integer(counts.finalized);
  $('accounting-unpaid').textContent = integer(counts.unpaid);
  $('accounting-attention').textContent = integer(counts.attention);
  const running = state.active?.session === row.id && ['FINALIZE','EXPORT'].includes(state.active.kind) ? state.active : null;
  const activity = running ?? row.lastFinalization;
  $('accounting-progress').hidden = !activity;
  if (activity) {
    const label = activity.kind === 'EXPORT' ? 'Exporting saved records' : 'Original finalization';
    const totals = activity.totals;
    $('accounting-progress').textContent = label + ': ' + readable(activity.state) + ' · ' +
      integer(activity.processedChunks ?? 0) + ' of ' + integer(activity.chunkCount) + ' parts reviewed.' +
      (totals ? ' ' + integer(totals.finalized) + ' finalized; ' + integer(totals.unpaid) + ' no payment required; ' +
        integer(totals.unattempted) + ' unattempted; ' + integer(totals.attention) + ' need attention.' : '') +
      (activity.error ? ' ' + readable(activity.error) + '. Original saved receipts remain available below.' : '');
  }
  const rows = $('accounting-rows'); rows.replaceChildren();
  for (const entry of record.entries) {
    const tr = element('tr'), part = element('td',String(entry.index + 1));
    part.append(element('small',entry.intentId)); tr.append(part);
    const status = element('td',readable(entry.outcome));
    if (entry.viewStatus === 'SAVE_FAILED') status.append(element('small','Result returned; local receipt view needs saving.'));
    if (entry.code || entry.reason) status.append(element('small',readable(entry.code ?? entry.reason)));
    const check = row.lastCheckIssues.find(value => value.index === entry.index);
    if (check) status.append(element('small','Last browser check: ' + readable(check.code ?? check.outcome)));
    tr.append(status,element('td',integer(entry.actualAtomicUnits)));
    const receipt = element('td');
    receipt.append(element('code',entry.receipt ?? (entry.outcome === 'NOT_ATTEMPTED' ? 'No original attempt' :
      entry.outcome === 'NO_PAYMENT_REQUIRED' ? 'No ledger finalization asserted' : 'No current finalized receipt')));
    if (entry.lastFinalized && !entry.receipt) {
      receipt.append(element('p','Earlier finalized receipt · ' + integer(entry.lastFinalized.actualAtomicUnits) + ' atomic units','prior-receipt'));
      receipt.append(element('code',entry.lastFinalized.receipt));
    }
    const disclosure = element('details'), fields = element('dl',undefined,'detail-grid');
    disclosure.append(element('summary','Record details'));
    details(fields,[['Original intent',entry.intentId],['Current result',entry.outcome],
      ['Recorded at',entry.completedAt],['Approved request SHA-256',entry.requestSha256],
      ['Original saved view',entry.viewPath ?? entry.evidencePath],['View status',entry.viewStatus],
      ['Last browser check',check?.observedAt],
      ['Earlier receipt at',entry.lastFinalized?.completedAt]]);
    disclosure.append(fields); receipt.append(disclosure); tr.append(receipt); rows.append(tr);
  }
  if (!record.entries.length) { const tr=element('tr'),td=element('td','No original parts in this range.','no-rows');td.colSpan=4;tr.append(td);rows.append(tr); }
  $('accounting-page-label').textContent = integer(record.range.total) + ' original parts · Page ' +
    (row.pagination.page + 1) + ' of ' + row.pagination.pages + ' · ' + integer(counts.unattempted) + ' unattempted here';
  page = row.pagination.page;
}
function controls() {
  const row = state?.selected;
  for (const id of ['run','stop','recover','assemble','download','refresh']) $(id).disabled = pending || !row?.controls[id];
  $('previous').disabled = pending || !row || row.pagination.page === 0;
  $('next').disabled = pending || !row || row.pagination.page + 1 >= row.pagination.pages;
  $('review-selection').disabled = pending || !products.some(product => product.id === $('product').value && !product.error);
  $('create-session').disabled = pending || !review;
  $('refresh-list').disabled = pending;
  for (const id of ['new-download','empty-new','close-setup']) $(id).disabled = pending;
  for (const id of ['export-html','export-json']) $(id).disabled = pending || !row || Boolean(state?.active || state?.mutation);
  for (const name of ['delivery','accounting']) $(name + '-tab').disabled = pending;
  const financial = row?.section === 'accounting';
  for (const [id,key] of [['accounting-finalize','finalize'],['accounting-stop','stop'],['accounting-refresh','refresh'],['accounting-export','export']])
    $(id).disabled = pending || !financial || !row.controls[key];
  $('accounting-previous').disabled = pending || !financial || row.pagination.page === 0;
  $('accounting-next').disabled = pending || !financial || row.pagination.page + 1 >= row.pagination.pages;
  const receivingBusy = pending || Boolean(state?.active || state?.mutation);
  $('receive-files').disabled = receivingBusy;
  for (const id of ['receive-source','receive-object','receive-offer']) $(id).disabled = receivingBusy;
  $('receive-review').disabled = receivingBusy || !receiving.operator || !receivedChoices.some(choice =>
    !choice.error && choice.rowIndex + ':' + choice.acceptIndex === $('receive-offer').value);
  $('receive-create').disabled = receivingBusy || !receivedReview;
  $('open-recovery').disabled = pending; $('close-recovery').disabled = pending;
  $('backup-review').disabled = receivingBusy;
  $('backup-create').disabled = receivingBusy || !backupReview || !$('backup-quiesced').checked;
  $('backup-verify').disabled = receivingBusy;
  $('recovery-stop').hidden = !recoveryState?.active;
  $('recovery-stop').disabled = pending || recoveryState?.active?.state === 'STOPPING';
  $('open-analysis').disabled = pending; $('close-analysis').disabled = pending;
  const usableObject = row?.section === 'delivery' && row.status === 'COMPLETE' && row.assembly;
  $('analyze-file').disabled = receivingBusy || !usableObject;
  $('analysis-review').disabled = receivingBusy || !usableObject;
  $('analysis-name').disabled = receivingBusy || !usableObject; $('analysis-format').disabled = receivingBusy || !usableObject;
  $('analysis-register').disabled = receivingBusy || !analysisReview;
  $('analysis-open').disabled = receivingBusy || state?.analysis?.running;
  $('analysis-stop').disabled = receivingBusy || !state?.analysis?.running;
  $('analysis-cancel').hidden = !state?.analysis?.active;
  $('analysis-cancel').disabled = pending || state?.analysis?.active?.state === 'STOPPING';
}
function renderAnalysis() {
  const value = state?.analysis, last = value?.last, work = value?.active;
  $('analysis-status').textContent = work ? readable(work.kind) + ': ' + readable(work.state) +
    (work.phase ? ' · ' + readable(work.phase) : '') + '.' : value?.running ?
      'The original analysis workspace is open. Continue in its private browser to map fields, import tables or resume saved work.' :
      'The analysis workspace is stopped. Open it to continue saved work, or review the selected completed file below.';
  $('analysis-link').hidden = !value?.url || !value.running;
  if (value?.url && value.running) $('analysis-link').href = value.url; else $('analysis-link').removeAttribute('href');
  const row = state?.selected, usable = row?.section === 'delivery' && row.status === 'COMPLETE' && row.assembly;
  $('analysis-review-form').hidden = !usable;
  $('analysis-selection').textContent = usable ? row.assembly.name + ' · ' + bytes(row.assembly.bytes) +
    '. Registration reopens this exact recorded file through the original Object Buyer.' :
    'Select a completed file in File delivery, then choose Use in data analysis. Existing analytical work remains available above.';
  if (analysisReview && (analysisReview.session !== row?.id || analysisReview.expectedRevision !== row?.revision)) {
    analysisReview = null; analysisAction = null; $('analysis-source-review').hidden = true;
  }
  $('analysis-history').textContent = last ? (last.name ? last.name + ' · ' : '') + readable(last.kind) + ': ' +
    readable(last.state) + (last.sourceRevision ? ' · source revision ' + last.sourceRevision : '') +
    (last.filename ? ' · ' + last.filename + ' / ' + bytes(last.bytes) : '') +
    (last.endedAt ? ' · ' + new Date(last.endedAt).toLocaleString() : '') +
    (last.error ? '. ' + errorMessage({code:last.error}) : '') +
    (last.state === 'INTERRUPTED' ? '. Reopen saved analysis or review and register the same original file to recover its source.' : '') +
    (last.saveError ? '. The handoff history could not be saved: ' + readable(last.saveError) : '') :
    'No source has been handed to analysis from this workspace yet.';
}
function openAnalysis() {
  $('setup').hidden = true; $('recovery-panel').hidden = true; $('analysis-panel').hidden = false;
  analysisReview = null; analysisAction = null; $('analysis-source-review').hidden = true;
  const row = state?.selected;
  if (row?.assembly) {
    const cleaned = row.assembly.name.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_]/g, '_');
    $('analysis-name').value = (/^[A-Za-z]/.test(cleaned) ? cleaned : 'object_' + cleaned).slice(0,48);
    $('analysis-format').value = row.contentType?.split(';')[0] === 'text/csv' || /\.csv$/i.test(row.assembly.name) ? 'csv' : 'json';
  }
  render(); schedulePoll();
}
$('open-analysis').onclick = openAnalysis; $('analyze-file').onclick = openAnalysis;
$('close-analysis').onclick = () => { $('analysis-panel').hidden = true; render(); schedulePoll(); };
for (const id of ['analysis-name','analysis-format']) $(id).addEventListener('input', () => {
  analysisReview = null; analysisAction = null; $('analysis-source-review').hidden = true; controls();
});
$('analysis-review-form').onsubmit = event => {
  event.preventDefault(); action(async () => {
    analysisReview = null; analysisAction = null; $('analysis-source-review').hidden = true;
    const row = state.selected;
    analysisReview = await request('/api/analysis/review', {session:row.id, expectedRevision:row.revision,
      name:$('analysis-name').value, format:$('analysis-format').value});
    details($('analysis-source-terms'), [['Recorded file',analysisReview.filename],['Complete bytes',integer(analysisReview.bytes)],
      ['File SHA-256',analysisReview.sha256],['Original session',analysisReview.sessionId],['Snapshot',analysisReview.snapshot],
      ['Configuration SHA-256',analysisReview.configurationSha256],
      ['Analysis source',analysisReview.name],['Chosen format',analysisReview.format.toUpperCase()],
      ['Current source revision',analysisReview.expectedSourceRevision || 'New source'],
      ['Workspace',analysisReview.workspaceId ?? 'Create inside this buyer workspace']]);
    $('analysis-source-review').hidden = false;
  });
};
$('analysis-register').onclick = () => action(async () => {
  if (!analysisReview) return;
  analysisAction ??= crypto.randomUUID();
  await request('/api/analysis/start', {kind:'ATTACH',actionId:analysisAction,reviewId:analysisReview.reviewId});
});
for (const [id,kind] of [['analysis-open','OPEN'],['analysis-stop','STOP']]) $(id).onclick = () => action(async () => {
  await request('/api/analysis/start',{kind,actionId:crypto.randomUUID()});
});
$('analysis-cancel').onclick = () => action(async () => {
  const current = state.analysis.active;
  if (current) await request('/api/stop',{session:current.session,runId:current.id});
});
function productChanged() {
  review = null; $('selection-review').hidden = true;
  const product = products.find(item => item.id === $('product').value);
  if (!product || product.error) {
    $('product-summary').textContent = product ? 'This product needs operator setup: ' + readable(product.error) : 'Add a trusted product profile when launching this workspace.';
    controls(); return;
  }
  $('product-summary').textContent = product.filename + ' · ' + deliveryLabel(product) + ' · ' + bytes(product.bytes) + ' · ' + product.sourceUrl;
  $('chunk-bytes').value = String(product.chunkBytes); $('chunk-bytes').max = String(product.chunkBytes);
  $('chunk-size-field').hidden = isWhole(product); $('chunk-bytes').readOnly = isWhole(product);
  $('total-cap').value = product.plannedMaxAtomic;
  $('session-name').value = product.id + '-' + new Date().toISOString().slice(0,10);
  controls();
}
async function newDownload() {
  await action(async () => {
    $('recovery-panel').hidden = true;
    $('analysis-panel').hidden = true;
    products = (await request('/api/products')).products;
    const select = $('product'); select.replaceChildren();
    for (const product of products) { const option = element('option',product.label + (product.error ? ' · setup required' : '')); option.value = product.id; select.append(option); }
    if (!products.length) { const option = element('option','No product profile configured'); option.value = ''; select.append(option); }
    $('setup').hidden = false; $('session').hidden = true; $('empty').hidden = true; productChanged();
    await loadReceiving();
    $('receiving-panel').open = !products.some(product => !product.error);
  });
}

const shellQuote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
function selectedBackup(bundle, record) {
  $('verify-bundle').value = bundle ?? ''; $('verify-record').value = record ?? '';
  $('recovery-command').textContent = 'buyer-object backup-restore --bundle ' + shellQuote(bundle ?? '/absolute/backup') +
    (record ? ' --expect ' + record : '') + ' --pass-env ' + shellQuote($('backup-pass-env').value);
}
async function loadRecovery() {
  recoveryState = await request('/api/recovery');
  if (!$('backup-root').value) $('backup-root').value = recoveryState.suggestedStateRoot;
  const record = recoveryState.last, output = record?.result;
  $('recovery-progress').hidden = !record;
  if (record) {
    const event = record.events.at(-1);
    $('recovery-progress').textContent = (record.kind === 'BACKUP' ? 'Encrypted backup' : 'Backup verification') +
      ': ' + readable(recoveryState.active?.state ?? record.state) + '. ' +
      (output ? integer(output.sessions) + ' downloads, ' + integer(output.operators) + ' native buyers, ' +
        integer(output.files) + ' files / ' + bytes(output.bytes) + '. Record ' + output.recordSha256 +
        (output.selectionRecordError ? '. Bundle completed; history needs attention: ' + readable(output.selectionRecordError) : '') :
        record.error ? errorMessage({code:record.error}) : event ? readable(event.stage) + '.' : 'Preparing original state.') +
      (output?.leaseReleaseErrors?.length ? ' Source lease release needs attention; reopen the original session before another capture.' : '');
    if (output && !$('verify-bundle').value) selectedBackup(output.bundle, output.recordSha256);
  }
  const history = $('recovery-history'); history.replaceChildren();
  for (const row of recoveryState.history) {
    const item = element('article', undefined, 'recovery-record');
    item.append(element('strong',row.error ? 'History entry needs attention' : readable(row.kind) + ' · ' + new Date(row.observedAt).toLocaleString()));
    item.append(element('p',row.error ? readable(row.error) : row.bundle));
    if (!row.error) {
      item.append(element('code',row.recordSha256));
      item.append(element('p',integer(row.sessions) + ' downloads · ' + integer(row.operators) + ' native buyers · ' + bytes(row.bytes)));
      const choose = element('button','Select this backup','small'); choose.disabled = pending || Boolean(state?.active);
      choose.onclick = () => selectedBackup(row.bundle,row.recordSha256); item.append(choose);
    }
    history.append(item);
  }
  if (!recoveryState.history.length) history.append(element('p','No backup has been retained in this workspace yet.','intro'));
  controls();
}
$('open-recovery').onclick = () => action(async () => {
  $('analysis-panel').hidden = true;
  $('setup').hidden = true; $('recovery-panel').hidden = false; await loadRecovery();
});
$('close-recovery').onclick = () => { $('recovery-panel').hidden = true; render(); };
$('backup-root').oninput = () => { backupReview = null; $('backup-selection').hidden = true; controls(); };
$('backup-quiesced').onchange = controls;
$('backup-review-form').onsubmit = event => {
  event.preventDefault(); action(async () => {
    backupReview = null; $('backup-selection').hidden = true;
    const review = await request('/api/recovery/review',{stateRoot:$('backup-root').value});
    backupReview = review.profile;
    details($('backup-selection-terms'),[['Workspace',backupReview.directory],['State root',backupReview.stateRoot],
      ['Original downloads',integer(backupReview.sessions.length)],['Prepared buyers',integer(backupReview.operators.length)],
      ['Received merchant sources',integer(backupReview.received.length)],['Review SHA-256',backupReview.reviewSha256]]);
    details($('backup-selection-paths'),[['Selected paths',backupReview.selected.join('\n')],
      ['Missing optional files',backupReview.missing.join('\n') || 'None'],
      ['Existing runtime required on restore',backupReview.runtime.map(item=>item.path).join('\n')],
      ['Wallet secrets','Environment values are not included in the bundle.']]);
    const rows=$('backup-session-rows');rows.replaceChildren();
    for(const session of backupReview.sessions) {
      const row=element('tr');row.append(element('td',session.id),element('td',deliveryLabel(session)),
        element('td',bytes(session.bytes)),element('td',integer(session.chunkCount)));rows.append(row);
    }
    if (!backupReview.sessions.length) { const row=element('tr'),cell=element('td','Prepared buyer and received sources; no download sessions yet.');cell.colSpan=4;row.append(cell);rows.append(row); }
    $('backup-selection').hidden=false;
    if (!$('backup-output').value) $('backup-output').value = backupReview.stateRoot.slice(0,backupReview.stateRoot.lastIndexOf('/')) +
      '/object-backup-' + new Date().toISOString().replace(/[:.]/g,'-');
    notice('The current original state is reviewed. Choose a new bundle destination to capture it.');
  });
};
$('backup-form').onsubmit = event => {
  event.preventDefault(); action(async () => {
    if (!backupReview || !$('backup-quiesced').checked) throw new Error('OBJECT_RECOVERY_REVIEW_REQUIRED');
    await request('/api/recovery/start',{kind:'BACKUP',actionId:crypto.randomUUID(),stateRoot:backupReview.stateRoot,
      expectedReviewSha256:backupReview.reviewSha256,output:$('backup-output').value,
      passEnv:$('backup-pass-env').value,quiesced:true});
    await loadRecovery();
  });
};
$('backup-verify-form').onsubmit = event => {
  event.preventDefault(); action(async () => {
    const bundle=$('verify-bundle').value,expected=$('verify-record').value;
    selectedBackup(bundle,expected);
    await request('/api/recovery/start',{kind:'VERIFY_BACKUP',actionId:crypto.randomUUID(),bundle,
      ...(expected ? {expected} : {}),passEnv:$('backup-pass-env').value});await loadRecovery();
  });
};
$('recovery-stop').onclick = () => action(async () => {
  if(recoveryState?.active)await request('/api/stop',{session:null,runId:recoveryState.active.id});
});
function clearReceivedReview() {
  receivingGeneration++; receivedReview = null; $('received-review').hidden = true; controls();
}
function receivedSource() { return receiving.sources.find(item => item.id === $('receive-source').value); }
function receivedObject() { return receivedSource()?.objects?.find(item => item.id === $('receive-object').value); }
async function loadReceiving(sourceId = $('receive-source').value) {
  receiving = await request('/api/receiving');
  const operator = receiving.operator;
  $('receiving-operator').textContent = operator ? operator.actor + ' / ' + operator.service +
    ' · payer ' + operator.payer + ' · maximum ' + integer(operator.maxTotalAtomic) +
    ' total / ' + integer(operator.maxDailyAtomic) + ' per UTC day' :
    receiving.presetError ? 'Local operator setup: ' + readable(receiving.presetError) :
    'To create a buyer, launch with a private --operator-settings preset. Saved downloads and already prepared products remain available.';
  const select = $('receive-source'); select.replaceChildren();
  for (const source of receiving.sources) {
    const option = element('option', source.error ? 'Received files · ' + readable(source.error) :
      source.descriptionName + ' / ' + source.catalogName);
    option.value = source.id; option.disabled = Boolean(source.error); select.append(option);
  }
  if (receiving.sources.some(item => item.id === sourceId && !item.error)) select.value = sourceId;
  if (!receiving.sources.length) { const option = element('option', 'Receive the merchant files first'); option.value = ''; select.append(option); }
  await receivedSourceChanged();
}
async function receivedSourceChanged() {
  clearReceivedReview(); const select = $('receive-object'); select.replaceChildren();
  for (const item of receivedSource()?.objects ?? []) {
    const option = element('option', item.name + (item.error ? ' · ' + readable(item.error) :
      ' · ' + deliveryLabel(item) + ' · ' + bytes(item.bytes)));
    option.value = item.id; option.disabled = Boolean(item.error); select.append(option);
  }
  const available = receivedSource()?.objects?.find(item => !item.error);
  if (available) select.value = available.id;
  await receivedObjectChanged();
}
async function receivedObjectChanged() {
  clearReceivedReview(); const current = receivingGeneration, item = receivedObject();
  const select = $('receive-offer'); select.replaceChildren(); receivedChoices = [];
  const placeholder = element('option', 'Choose the exact resource and payment option'); placeholder.value = ''; select.append(placeholder);
  if (!item || item.error) { $('receive-object-summary').textContent = ''; controls(); return; }
  $('receive-object-summary').textContent = item.name + ' · ' + deliveryLabel(item) + ' · ' + bytes(item.bytes) + ' · ' + item.path;
  $('receive-chunk').value = String(item.chunkBytes); $('receive-chunk').max = String(item.chunkBytes);
  $('receive-chunk-size-field').hidden = isWhole(item); $('receive-chunk').readOnly = isWhole(item);
  $('receive-session').value = 'download-' + item.id.slice(0,32) + '-' + new Date().toISOString().slice(0,10);
  $('receive-total').value = ''; $('receive-daily').value = '';
  const result = await request('/api/receiving/options?' + new URLSearchParams({ id: receivedSource().id, objectId: item.id }));
  if (current !== receivingGeneration) return;
  receivedChoices = result.choices;
  for (const choice of receivedChoices) {
    const label = choice.error ? choice.url + ' · ' + readable(choice.error) :
      choice.url + ' · ' + choice.terms.maxAtomic + ' atomic / request · ' + choice.terms.network + ' · ' + choice.terms.asset;
    const option = element('option', label); option.value = choice.rowIndex + ':' + choice.acceptIndex;
    option.disabled = Boolean(choice.error); select.append(option);
  }
  if (!receivedChoices.some(choice => !choice.error)) placeholder.textContent = 'No matching native object offer in these files';
  controls();
}
function receivedOfferChanged() {
  clearReceivedReview(); const item = receivedObject();
  const choice = receivedChoices.find(value => value.rowIndex + ':' + value.acceptIndex === $('receive-offer').value);
  if (!item || !choice || choice.error) return;
  const chunks = isWhole(item) ? 1 : Math.ceil(item.bytes / Number($('receive-chunk').value));
  if (!Number.isSafeInteger(chunks) || chunks < 1) return;
  const total = BigInt(choice.terms.maxAtomic) * BigInt(chunks);
  $('receive-total').value = String(total);
  const ceiling = receiving.operator?.maxDailyAtomic;
  $('receive-daily').value = ceiling && BigInt(ceiling) < total ? ceiling : String(total);
  $('receive-object-summary').textContent = item.name + ' · ' + deliveryLabel(item) + ' · ' + bytes(item.bytes) + ' · ' + choice.url +
    ' · recipient ' + choice.terms.payTo;
}
function fileBase64(file, maximum) {
  if (!file || file.size < 1 || file.size > maximum) return Promise.reject(new Error('OBJECT_RECEIVING_FILE_TOO_LARGE'));
  return new Promise((done, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('OBJECT_RECEIVING_FILE_READ_FAILED'));
    reader.onload = () => done(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.readAsDataURL(file);
  });
}
$('receive-files-form').onsubmit = event => {
  event.preventDefault(); action(async () => {
    const description = $('receive-description').files[0], catalog = $('receive-catalog').files[0];
    const descriptionBase64 = await fileBase64(description, 8 * 1048576), catalogBase64 = await fileBase64(catalog, 1048576);
    const result = await request('/api/receiving/receive', { descriptionName: description.name, descriptionBase64,
      catalogName: catalog.name, catalogBase64 });
    await loadReceiving(result.id); notice('Merchant files retained. Choose the object, payment option and your limits.');
  });
};
$('receive-source').onchange = () => action(receivedSourceChanged);
$('receive-object').onchange = () => action(receivedObjectChanged);
$('receive-offer').onchange = receivedOfferChanged;
for (const id of ['receive-session','receive-chunk','receive-total','receive-daily']) $(id).oninput = clearReceivedReview;
for (const id of ['receive-description','receive-catalog']) $(id).onchange = clearReceivedReview;
$('receive-plan-form').onsubmit = event => {
  event.preventDefault(); action(async () => {
    clearReceivedReview(); const current = receivingGeneration;
    const choice = receivedChoices.find(value => value.rowIndex + ':' + value.acceptIndex === $('receive-offer').value);
    if (!choice || choice.error) throw new Error('EXPLICIT_SELECTION_INDEX_REQUIRED');
    const result = await request('/api/receiving/review', { id: receivedSource().id, objectId: receivedObject().id,
      rowIndex: choice.rowIndex, acceptIndex: choice.acceptIndex, chunkBytes: Number($('receive-chunk').value),
      sessionName: $('receive-session').value, maxTotalAtomic: $('receive-total').value, dailyAtomic: $('receive-daily').value });
    if (current !== receivingGeneration) return;
    receivedReview = result;
    details($('received-review-terms'), [['Session',result.sessionName],['File',result.filename],['Resource',result.sourceUrl],
      ...requestPlan(result),
      ['Payer',result.operator.payer],['Network',result.terms.network],['Scheme',result.terms.scheme],['Asset',result.terms.asset],
      ['Recipient',result.terms.payTo],['Maximum per request',result.terms.maxAtomic + ' atomic units'],
      ['Planned maximum',result.plannedMaxAtomic + ' atomic units'],['Whole-download cap',result.maxTotalAtomic + ' atomic units'],
      ['Daily cap',result.dailyAtomic + ' atomic units'],['Content type',result.selected.expectedContentType],
      ['Object snapshot',result.selected.expectedSnapshot],['Expected file SHA-256',result.selected.expectedSha256 ?? 'Not supplied'],
      ['Description SHA-256',result.descriptionSha256],['Original offers SHA-256',result.catalogSha256]]);
    $('received-review').hidden = false;
  });
};
$('receive-create').onclick = () => action(async () => {
  const created = await request('/api/receiving/create', { reviewId: receivedReview.reviewId });
  selected = created.session; section = 'delivery'; page = 0; query = ''; filter = 'all';
  $('chunk-query').value = ''; $('chunk-filter').value = 'all';
  $('setup').hidden = true; review = null; clearReceivedReview();
  notice(created.recoveredCreate ? 'Reopened the same private buyer and saved download.' :
    'Your private buyer and reviewed download are ready. Start download when you are ready to approve its requests.');
});
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
    details($('review-terms'),[['Session',review.sessionName],['File',review.filename],...requestPlan(review),
      ['Network',review.terms.network],['Asset',review.terms.asset],['Recipient',review.terms.payTo],
      ['Maximum per request',review.terms.maxAtomic + ' atomic units'],['Planned maximum',review.plannedMaxAtomic + ' atomic units'],
      ['Whole-download cap',review.maxTotalAtomic + ' atomic units'],['Snapshot',review.snapshot],
      ['Native workspace',review.operatorWorkspace ? 'Configured original workspace' : 'Original configured operator environment']]);
    $('selection-review').hidden = false;
  });
};
$('create-session').onclick = () => action(async () => {
  const created = await request('/api/create',{reviewId:review.reviewId});
  selected = created.session; section = 'delivery'; page = 0; query = ''; filter = 'all'; $('chunk-query').value = ''; $('chunk-filter').value = 'all';
  $('setup').hidden = true; review = null; $('selection-review').hidden = true;
  notice(created.recoveredCreate ? 'Reopened the same saved download plan.' : 'The reviewed download plan is saved.');
});
$('run').onclick = () => {
  const row = state.selected, session = selected, expectedRevision = row.revision, actionId = crypto.randomUUID();
  confirm({title:row.completeChunks ? 'Continue this download?' : 'Start this download?',
    copy:isWhole(row) ? 'The original buyer will request the complete file once from the selected merchant.' :
      'The original buyer will request the next untouched parts from the selected merchant.',
    fields:[['File',row.name],['Remaining parts',integer(row.chunkCount - row.completeChunks)],['Network',row.terms.network],
      ['Asset',row.terms.asset],['Recipient',row.terms.payTo],['Maximum per request',row.limits.maxAtomic + ' atomic units'],
      ['Whole-download cap',row.limits.maxTotalAtomic + ' atomic units']],
    note:'Keep the launching terminal available. Each paid request keeps its original approval and spending-ledger checks.',button:'Start original buyer'},
  async()=>{await request('/api/run',{session,expectedRevision,actionId});});
};
$('stop').onclick = () => { const run = state.active; if(run) action(async()=>{await request('/api/stop',{session:run.session,runId:run.id});}); };
$('accounting-stop').onclick = $('stop').onclick;
$('recover').onclick = () => { const row = state.selected; action(async()=>{await request('/api/recover',{session:row.id,expectedRevision:row.revision});notice('Original saved results recovered.');}); };
$('refresh').onclick = () => action(async()=>{await request('/api/refresh',{session:selected});notice('Current saved parts and original outcomes verified.');});
$('refresh-list').onclick = () => action(async()=>{await request('/api/refresh',{session:selected,section});});
$('assemble').onclick = () => {
  const row = state.selected;
  confirm({title:isWhole(row) ? 'Save the verified whole file?' : 'Assemble the complete file?',
    copy:isWhole(row) ? 'This reads the original whole response and saves its verified bytes to a new private file.' :
      'This reads the original verified parts and saves their byte sequence to a new private file.',
    fields:[['File',row.name],['Size',integer(row.bytes) + ' bytes'],['Parts',integer(row.chunkCount)],['Complete SHA-256',row.objectSha256]],
    note:'The original chunk files and attempt history remain available for subsequent review.',button:'Assemble file'},
  async()=>{await request('/api/assemble',{session:row.id,expectedRevision:row.revision});notice('The complete file is assembled and ready to download.');});
};
$('download').onclick = () => action(async()=>{
  const result = await request('/api/download-ticket',{session:selected});
  const link = element('a'); link.href = result.url; link.download = state.selected.assembly.name;
  // A native download starts on its own request. Keep observing long enough
  // to see that request even if this action's immediate refresh arrives first.
  downloadWatchUntil = Date.now() + 10000;
  document.body.append(link); link.click(); link.remove();
});
async function exportFile(kind) {
  const response = await request('/api/export?'+new URLSearchParams({session:selected,kind}),undefined,true);
  const blob = await response.blob(), url = URL.createObjectURL(blob), link = element('a');
  link.href = url; link.download = selected + (kind === 'html' ? '.html' : '.json'); document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
$('export-html').onclick = () => action(()=>exportFile('html')); $('export-json').onclick = () => action(()=>exportFile('json'));
for (const name of ['delivery','accounting']) $(name + '-tab').onclick = () => {
  section=name; page=0; sessionStorage.setItem('starforge-object-workspace-view',name); load().catch(showError);
};
$('accounting-refresh').onclick = () => action(async()=>{
  await request('/api/refresh',{session:selected,section:'accounting'}); notice('Original purchase records refreshed.');
});
$('accounting-finalize').onclick = () => {
  const row=state.selected,session=selected,expectedRevision=row.revision,actionId=crypto.randomUUID();
  confirm({title:'Finalize the original purchases?',
    copy:'Review all earlier attempts in this saved download and complete their original reservation records.',
    fields:[['File',row.name],['Original parts',integer(row.accounting.range.total)],
      ['Network',row.accounting.terms.network],['Asset',row.accounting.terms.asset],['Recipient',row.accounting.terms.payTo]],
    note:'This uses the saved native workspace and original ledger. It can observe network finality for an earlier transaction; it does not run the buyer or sign another payment. You can stop the operation and keep every completed receipt.',
    button:'Finalize original records'},async()=>{await request('/api/finalize',{session,expectedRevision,actionId});});
};
$('accounting-export').onclick = () => action(async()=>{
  const result=await request('/api/accounting-export-ticket',{session:selected});
  const link=element('a');link.href=result.url;link.download=selected+'.accounting.jsonl';
  document.body.append(link);link.click();link.remove();
});
$('accounting-previous').onclick = () => {if(page){page--;load().catch(showError);}};
$('accounting-next').onclick = () => {page++;load().catch(showError);};
$('previous').onclick = () => {if(page){page--;load().catch(showError);}};
$('next').onclick = () => {page++;load().catch(showError);};
$('chunk-filter').onchange = () => {filter = $('chunk-filter').value;page = 0;load().catch(showError);};
$('chunk-query').oninput = () => {clearTimeout(queryTimer);queryTimer = setTimeout(()=>{query=$('chunk-query').value;page=0;load().catch(showError);},180);};
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(pollTimer);else load().catch(showError);});
load().catch(showError);
