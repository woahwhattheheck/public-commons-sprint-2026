const $ = id => document.getElementById(id);
const clone = value => value == null ? value : structuredClone(value);
const text = (tag, value, className) => {
  const node = document.createElement(tag);
  node.textContent = value == null ? '' : String(value);
  if (className) node.className = className;
  return node;
};
const short = value => value ? String(value).slice(0, 16) : '—';
const display = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const time = value => value ? new Date(value).toLocaleString() : '—';
const uuid = () => crypto.randomUUID();
const tokenKey = 'stellar.sheets.authoring.token';
const pendingKey = 'stellar.sheets.authoring.pending.v1';
let token = new URLSearchParams(location.hash.slice(1)).get('token');
if (token) {
  sessionStorage.setItem(tokenKey, token);
  history.replaceState(null, '', location.pathname + location.search);
} else token = sessionStorage.getItem(tokenKey);
let state = null, captureView = null, draftRevision = 0, draftDirty = false;
let preview = null, upload = null, workbook = null, columns = new Map();
let capturesOffset = 0, versionsOffset = 0, busy = false, pending = null, retryPayload = null;
let recoveryKnown = null, recoveryBusy = false, viewGeneration = 0, editGeneration = 0, uploadGeneration = 0;
const pageSize = 25;
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
  $('notice').classList.toggle('error', error);
}
function view(name) {
  document.querySelectorAll('[data-panel]').forEach(node => { node.hidden = node.dataset.panel !== name; });
  document.querySelectorAll('[data-view]').forEach(node => {
    node.classList.toggle('selected', node.dataset.view === name);
    node.setAttribute('aria-current', node.dataset.view === name ? 'page' : 'false');
  });
}
function lock() {
  $('workspace-controls').disabled = !state || busy || Boolean(pending);
  $('check-operation').disabled = recoveryBusy || busy;
  $('resume-operation').disabled = recoveryBusy || busy;
  $('retry-operation').disabled = recoveryBusy || busy || (!retryPayload && Boolean(pending?.file));
  $('dismiss-operation').disabled = recoveryBusy || busy;
  $('retry-file').disabled = recoveryBusy || busy;
}
function operationMessage(value) {
  if (!value) return 'No receipt is currently recorded. Retry the same request; its identifier and payload remain unchanged.';
  if (value.status === 'pending') return 'The original request is still pending. Check its receipt again before doing new work.';
  if (value.status === 'interrupted') return 'The process ended before returning a complete receipt. Resume the same retained request. Provider reads are not repeated by recovery.';
  if (value.status === 'failed') return value.error?.message || value.error || 'The request ended with a recorded error. Your saved work remains available.';
  return 'The original receipt is available.';
}
function showRecovery(value = recoveryKnown, message) {
  recoveryKnown = value;
  $('recovery').hidden = !pending;
  if (!pending) { lock(); return; }
  $('recovery-title').textContent = pending.label || 'Recover saved request';
  $('recovery-id').textContent = pending.requestId;
  $('recovery-message').textContent = message || operationMessage(value);
  const missing = value === null;
  $('resume-operation').hidden = value?.status !== 'interrupted';
  $('retry-operation').hidden = !missing;
  $('retry-file-label').hidden = !missing || !pending.file || Boolean(retryPayload);
  $('dismiss-operation').hidden = value?.status !== 'failed';
  lock();
}
function remember(marker, payload) {
  // Write the small receipt marker before starting an operation. Never retain cells or tokens here.
  marker.directory = state.directory;
  localStorage.setItem(pendingKey + ':' + marker.directory, JSON.stringify(marker));
  pending = marker;
  retryPayload = payload;
  recoveryKnown = null;
  showRecovery(null, 'Waiting for the original operation receipt…');
}
function forget() {
  if (pending) localStorage.removeItem(pendingKey + ':' + pending.directory);
  pending = null; retryPayload = null; recoveryKnown = null;
  showRecovery();
}
async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout ?? 65000);
  try {
    const response = await fetch(path, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers: { 'x-sheets-workspace-token': token || '', ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal, cache: 'no-store'
    });
    if (options.binary && response.ok) return { bytes: await response.blob(), filename: response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] };
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error?.message || result.message || (typeof result.error === 'string' ? result.error : response.statusText));
      error.code = result.error?.code || result.code || (typeof result.error === 'string' ? result.error : undefined); error.status = response.status;
      throw error;
    }
    return result;
  } catch (error) {
    if (!error.status) error.uncertain = true;
    throw error;
  } finally { clearTimeout(timeout); }
}
function errorMessage(error) { return [error.code, error.message || String(error)].filter(Boolean).join(': '); }
async function refresh({loadDraft = false} = {}) {
  const intent = loadDraft ? {generation: ++viewGeneration, editing: editGeneration} : null;
  const latest = await api('/api/status?' + new URLSearchParams({ capturesOffset, versionsOffset, limit: pageSize }));
  state = latest;
  renderState();
  if (loadDraft && latest.draft && intent.generation === viewGeneration && intent.editing === editGeneration)
    await loadDraftState(latest.draft, latest.draftRevision, false, intent);
  return latest;
}
async function finishReceipt(result, marker) {
  forget();
  await refresh();
  if (marker.path === '/api/import' || marker.path === '/api/capture') {
    const capture = result.capture || result;
    if (capture.id) await loadCapture(capture.id, null, {carry: true});
    view('review');
  } else if (marker.path === '/api/import-package' || marker.path === '/api/draft') {
    if (state.draft) await loadDraftState(state.draft, state.draftRevision);
    view('review');
  } else if (marker.path === '/api/preview') {
    preview = result.preview || result; renderPreview(); view('review');
  } else if (marker.path === '/api/version' || marker.path === '/api/select') {
    view('versions');
  } else if (marker.path === '/api/publisher/start') {
    view('versions');
  }
  notice(marker.label + ' completed. The original receipt is retained.');
  return result;
}
async function reconcile({resume = false} = {}) {
  if (!pending || recoveryBusy || busy) return;
  recoveryBusy = true; lock();
  const marker = clone(pending);
  try {
    if (resume) {
      const result = await api('/api/resume', { body: {requestId: marker.requestId} });
      if (pending?.requestId === marker.requestId) await finishReceipt(result, marker);
      return;
    }
    const {operation} = await api('/api/operation?id=' + encodeURIComponent(marker.requestId));
    if (pending?.requestId !== marker.requestId) return;
    if (operation?.status === 'complete' || operation?.status === 'completed') await finishReceipt(operation.result, marker);
    else showRecovery(operation || (marker.failureReceived ? {status: 'failed', error: marker.failureReceived} : null));
  } catch (error) {
    if (pending?.requestId === marker.requestId) {
      if (resume && error.status) {
        try {
          const {operation} = await api('/api/operation?id=' + encodeURIComponent(marker.requestId));
          if (pending?.requestId !== marker.requestId) return;
          if (operation?.status === 'complete') await finishReceipt(operation.result, marker);
          else showRecovery(operation, operationMessage(operation));
        } catch {
          showRecovery(recoveryKnown, 'The resumed request needs its original receipt. Check again: ' + errorMessage(error));
        }
      } else showRecovery(recoveryKnown, 'Receipt lookup did not finish: ' + errorMessage(error) + '. Keep this request and check again.');
    }
  } finally { recoveryBusy = false; lock(); }
}
async function mutation(path, body, label, file = null) {
  if (pending || busy) throw new Error('Finish the current receipt recovery before starting another operation.');
  const payload = {...body, requestId: body.requestId || uuid()};
  const marker = {path, requestId: payload.requestId, label, createdAt: new Date().toISOString(),
    ...(file ? {file, body: {...payload, resource: undefined, packet: undefined}} : {body: payload})};
  remember(marker, payload);
  busy = true; lock();
  try {
    const result = await api(path, {body: payload});
    if (pending?.requestId === marker.requestId) return await finishReceipt(result, marker);
    return result;
  } catch (error) {
    if (pending?.requestId === marker.requestId) {
      // Even an HTTP error can follow a durable partial write. Consult its original receipt first.
      if (error.status) {
        pending.failureReceived = {status: error.status, code: error.code, message: error.message};
        localStorage.setItem(pendingKey + ':' + pending.directory, JSON.stringify(pending));
      }
      notice(errorMessage(error), true);
      showRecovery(null, 'The request did not return a complete receipt. Checking the same request will resolve its state.');
    }
    throw error;
  } finally {
    busy = false; lock();
    if (pending?.requestId === marker.requestId) await reconcile();
  }
}
async function retrySame() {
  if (!pending || recoveryBusy || busy) return;
  const payload = retryPayload || (!pending.file ? pending.body : null);
  if (!payload) { notice('Select the same original file to retry this request.', true); return; }
  const marker = clone(pending);
  recoveryBusy = true; busy = true; lock();
  try {
    const result = await api(marker.path, {body: payload});
    if (pending?.requestId === marker.requestId) await finishReceipt(result, marker);
  } catch (error) {
    if (pending?.requestId === marker.requestId) {
      if (error.status) {
        pending.failureReceived = {status: error.status, code: error.code, message: error.message};
        localStorage.setItem(pendingKey + ':' + pending.directory, JSON.stringify(pending));
      }
      showRecovery(null, 'The same request still needs a receipt: ' + errorMessage(error));
    }
  } finally {
    recoveryBusy = false; busy = false; lock();
    if (pending?.requestId === marker.requestId) await reconcile();
  }
}
function run(fn) { return async event => { event?.preventDefault(); try { await fn(event); } catch (error) { notice(errorMessage(error), true); } }; }
function rowsOf(value) { return Array.isArray(value) ? value : value?.items || []; }
function pageOf(value, fallback, offset) {
  return {items: rowsOf(value), total: value?.total ?? fallback ?? rowsOf(value).length, offset: value?.offset ?? offset};
}
function button(label, action) {
  const node = text('button', label); node.type = 'button'; node.addEventListener('click', run(action)); return node;
}
function option(value, label, selected = false) {
  const node = text('option', label); node.value = value; node.selected = selected; return node;
}
function summary(container, pairs) {
  container.replaceChildren();
  const dl = text('dl', '', 'metadata');
  for (const [label, value] of pairs) { dl.append(text('dt', label), text('dd', display(value))); }
  container.append(dl);
}
function table(container, headers, data) {
  container.replaceChildren();
  const wrapper = text('div', '', 'table-scroll'), node = document.createElement('table');
  const head = document.createElement('thead'), heading = document.createElement('tr');
  headers.forEach(value => heading.append(text('th', value))); head.append(heading);
  const body = document.createElement('tbody');
  data.forEach(values => { const row = document.createElement('tr'); values.forEach(value => row.append(text('td', display(value)))); body.append(row); });
  if (!data.length) { const row = document.createElement('tr'), cell = text('td', 'No saved rows.'); cell.colSpan = Math.max(1, headers.length); row.append(cell); body.append(row); }
  node.append(head, body); wrapper.append(node); container.append(wrapper);
}
function connectionsList() { return rowsOf(state?.connections); }
function fillConnections(select, current) {
  select.replaceChildren(option('', 'Select a host connection'));
  for (const item of connectionsList()) select.append(option(item.alias, item.label || item.alias));
  select.value = current || '';
}
function renderState() {
  $('host-status').textContent = pending ? 'Receipt recovery' : 'Ready';
  $('workspace-path').textContent = state.directory || state.workspace || '';
  $('source-path').textContent = state.publisher.sourceFile;
  $('publisher-path').textContent = state.publisher.directory;
  $('dataset-path').textContent = state.publisher.targetDirectory;
  fillConnections($('live-connection'), $('live-connection').value);
  fillConnections($('draft-connection'), $('draft-connection').value);
  renderConnection();
  const capturePage = pageOf(state.captures, state.pages.capturesTotal, capturesOffset);
  const versionPage = pageOf(state.versions, state.pages.versionsTotal, versionsOffset);
  renderCaptures(capturePage.items);
  renderVersions(versionPage.items);
  $('captures-page').textContent = capturePage.total ? (capturePage.offset + 1) + '–' + Math.min(capturePage.offset + capturePage.items.length, capturePage.total) + ' of ' + capturePage.total : 'No saved observations';
  $('captures-prev').disabled = capturesOffset <= 0;
  $('captures-next').disabled = capturesOffset + capturePage.items.length >= capturePage.total;
  $('versions-page').textContent = versionPage.total ? (versionPage.offset + 1) + '–' + Math.min(versionPage.offset + versionPage.items.length, versionPage.total) + ' of ' + versionPage.total : 'No saved versions';
  $('versions-prev').disabled = versionsOffset <= 0;
  $('versions-next').disabled = versionsOffset + versionPage.items.length >= versionPage.total;
  const selected = typeof state.selectedVersion === 'object' ? state.selectedVersion?.id : state.selectedVersion;
  $('selected-version').textContent = selected ? 'Version ' + selected : 'No source selected';
  const running = Boolean(state.publisher?.running);
  $('publisher-summary').textContent = selected
    ? 'Version ' + selected + ' is the source for new native publisher plans. Earlier plans retain their source declaration; completed extractions retain their original observation.'
    : 'Save and select a reviewed source version before opening the original dataset publisher.';
  $('open-publisher').disabled = !selected;
  $('stop-publisher').disabled = !running;
  $('publisher-link').hidden = !running;
  if (running) $('publisher-link').href = state.publisher.url;
  else $('publisher-link').removeAttribute('href');
  renderOperations(rowsOf(state.operations));
  renderDraftState();
}
function selectedVersionId() { return typeof state?.selectedVersion === 'object' ? state.selectedVersion?.id ?? null : state?.selectedVersion ?? null; }
function renderCaptures(items) {
  $('captures-body').replaceChildren();
  for (const item of items) {
    const row = document.createElement('tr');
    const identity = document.createElement('td');
    identity.append(text('strong', item.title), text('div', item.workbookTitle || item.spreadsheetTitle || item.spreadsheetId, 'muted'), text('code', short(item.sourceSha256)));
    row.append(identity, text('td', item.range), text('td', time(item.receivedAt)), text('td', item.sourceBytes.toLocaleString() + ' bytes · ' + item.transport));
    const action = document.createElement('td');
    action.append(button('Review projection', async () => { await loadCapture(item.id, null, {carry: true}); view('review'); }));
    row.append(action); $('captures-body').append(row);
  }
  if (!items.length) { const row = document.createElement('tr'), cell = text('td', 'Import CellData or read an authorized workbook to begin.'); cell.colSpan = 5; row.append(cell); $('captures-body').append(row); }
}
function renderVersions(items) {
  $('versions-body').replaceChildren();
  const previousLeft = $('compare-left').value, previousRight = $('compare-right').value;
  $('compare-left').replaceChildren(option('', 'Select saved version'));
  $('compare-right').replaceChildren(option('', 'Select saved version'));
  for (const item of items) {
    const row = document.createElement('tr'), identity = document.createElement('td');
    identity.append(text('strong', 'v' + item.id + ' · ' + item.title), text('div', item.reviewer + ' · ' + time(item.createdAt), 'muted'), text('div', item.note || '', 'muted'));
    row.append(identity, text('td', item.range), text('td', (item.rowCount ?? '—') + ' rows · ' + item.mode), text('td', short(item.observationSha256)));
    const action = text('td', '', 'actions');
    const use = button(item.id === selectedVersionId() ? 'Selected' : 'Use for next plan', () => mutation('/api/select', {versionId: item.id, expectedSelectedVersion: selectedVersionId()}, 'Source selection'));
    use.disabled = item.id === selectedVersionId();
    action.append(use, button('Edit projection', async () => {
      const intent = {generation: ++viewGeneration, editing: editGeneration}, revision = state.draftRevision;
      const saved = await api('/api/version?id=' + item.id);
      if (intent.generation !== viewGeneration || intent.editing !== editGeneration) return;
      if (!await loadDraftState(saved.draft, revision, true, intent)) return;
      notice('Editing version ' + item.id + ' as a new draft. Its saved source and existing publisher plans remain retained.');
      view('review');
    }), button('Private source packet', () => downloadVersion(item.id)));
    row.append(action); $('versions-body').append(row);
    $('compare-left').append(option(item.id, 'v' + item.id + ' · ' + item.title));
    $('compare-right').append(option(item.id, 'v' + item.id + ' · ' + item.title));
  }
  $('compare-left').value = items.some(x => String(x.id) === previousLeft) ? previousLeft : String(items[1]?.id || '');
  $('compare-right').value = items.some(x => String(x.id) === previousRight) ? previousRight : String(items[0]?.id || '');
  if (!items.length) { const row = document.createElement('tr'), cell = text('td', 'Reviewed versions appear here after a complete original-extractor preview.'); cell.colSpan = 5; row.append(cell); $('versions-body').append(row); }
}
function renderOperations(items) {
  $('operations-body').replaceChildren();
  for (const item of items) {
    const row = document.createElement('tr'), id = text('td', '');
    id.append(text('code', item.id));
    row.append(id, text('td', item.kind), text('td', item.status), text('td', time(item.updatedAt || item.createdAt)));
    const actions = text('td', '', 'actions');
    actions.append(button('Inspect receipt', async () => {
      const value = await api('/api/operation?id=' + encodeURIComponent(item.requestId || item.id));
      $('operation-detail').textContent = JSON.stringify(value.operation, null, 2);
      $('operation-detail').hidden = false;
    }));
    if (item.status === 'interrupted' || item.status === 'pending') actions.append(button('Recover this request', async () => {
      if (pending) throw new Error('Recover the current request first.');
      const requestId = item.requestId || item.id;
      const paths = {IMPORT:'/api/import', CAPTURE:'/api/capture', PACKET:'/api/import-package', DRAFT:'/api/draft', PREVIEW:'/api/preview', VERSION:'/api/version', SELECT:'/api/select', PUBLISHER:'/api/publisher/start', STOP_PUBLISHER:'/api/publisher/stop'};
      remember({requestId, path: paths[item.kind], label: item.kind + ' recovery', createdAt: item.createdAt}, null);
      await reconcile();
    }));
    row.append(actions); $('operations-body').append(row);
  }
}
function renderConnection() {
  const item = connectionsList().find(x => x.alias === $('live-connection').value);
  $('connection-state').textContent = item ? [item.label || item.alias, item.status?.state || item.state || item.kind || 'Configured host connection', typeof item.account === 'string' ? item.account : item.account?.email || ''].filter(Boolean).join(' · ') : 'Live reads use an existing host connection. Importing a captured observation does not require one.';
  $('load-workbook').disabled = !item;
  $('capture-live').disabled = !item || !workbook;
}
function dirty() {
  draftDirty = true; editGeneration++; preview = null;
  renderDraftState(); renderPreview();
}
function renderDraftState() {
  $('draft-state').textContent = draftDirty ? 'Unsaved changes' : 'Saved draft · revision ' + (state?.draftRevision ?? draftRevision);
  $('save-draft').disabled = !captureView || !draftDirty;
  $('preview-draft').disabled = !captureView;
  $('reload-draft').disabled = !state?.draft;
  $('save-version').disabled = !preview || draftDirty || preview.draftRevision !== draftRevision;
}
function captureRecord() { return captureView?.capture || captureView?.observation || captureView; }
function columnRows() { return captureView?.columns || []; }
function unqualified(range) {
  const match = String(range || '').match(/([A-Z]+\d+:[A-Z]+\d+)$/); return match ? match[1] : String(range || '');
}
function aliasFor(header, letter, used) {
  let name = String(header || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(name)) name = 'column_' + name;
  name = name.slice(0, 40) || 'column_' + letter.toLowerCase();
  if (['__proto__', 'prototype', 'constructor'].includes(name)) name = 'column_' + letter.toLowerCase();
  let result = name, index = 2;
  while (used.has(result)) result = name.slice(0, 40) + '_' + index++;
  used.add(result); return result;
}
function currentProjection() {
  const result = {};
  for (const [letter, row] of columns) if (row.use.checked) {
    const alias = row.alias.value.trim();
    if (Object.hasOwn(result, alias)) throw new Error('Public column names must be unique: ' + alias);
    Object.defineProperty(result, alias, {value: {column: letter, header: row.header, type: row.type.value, nullable: row.nullable.checked, formula: row.formula.value}, enumerable: true, configurable: true, writable: true});
  }
  return result;
}
function draftFromEditor() {
  if (!captureView) throw new Error('Select a retained observation first.');
  if (unqualified($('draft-range').value.trim()) !== unqualified(captureView.range || captureRecord().range)) throw new Error('Inspect the edited range before saving its projection.');
  return {
    captureId: captureRecord().id, title: $('draft-title').value.trim(), name: $('draft-name').value.trim(),
    range: unqualified($('draft-range').value.trim()), columns: currentProjection(), emptyRows: $('empty-rows').value,
    mode: $('source-mode').value, connectionAlias: $('source-mode').value === 'live' ? $('draft-connection').value || null : null
  };
}
async function loadCapture(id, range = null, {carry = false, definition = null, changed = true, intent = null, revision} = {}) {
  const generation = intent?.generation ?? ++viewGeneration;
  const editing = intent?.editing ?? editGeneration;
  const baseRevision = revision ?? (carry && captureView ? draftRevision : state.draftRevision);
  const prior = carry && captureView ? currentProjection() : {};
  const result = await api('/api/capture?' + new URLSearchParams({id, ...(range ? {range} : {})}));
  if (generation !== viewGeneration || editing !== editGeneration) return false;
  captureView = result;
  const capture = captureRecord();
  const projection = definition?.columns || prior;
  $('no-capture').hidden = true; $('editor').hidden = false;
  $('capture-title').textContent = capture.title || 'Retained Sheet observation';
  summary($('capture-identity'), [['Workbook', capture.workbookTitle || capture.spreadsheetTitle || capture.spreadsheetId],
    ['Tab / capture range', capture.range], ['Exact source SHA-256', capture.sourceSha256], ['Received', time(capture.receivedAt)], ['Transport', capture.transport]]);
  if (definition) {
    $('draft-title').value = definition.title;
    $('draft-name').value = definition.name;
    $('empty-rows').value = definition.emptyRows;
    $('source-mode').value = definition.mode;
    $('draft-connection').value = definition.connectionAlias || '';
  } else if (!carry || !columns.size) {
    $('draft-title').value = capture.title || 'Reviewed Sheet source';
    $('draft-name').value = 'catalog';
    $('empty-rows').value = 'reject';
    $('source-mode').value = 'capture';
    $('draft-connection').value = capture.connectionAlias || '';
  }
  $('draft-range').value = unqualified(result.range || definition?.range || capture.range);
  columns = new Map();
  $('columns-body').replaceChildren();
  const used = new Set(Object.keys(projection));
  let retained = 0;
  for (const column of columnRows()) {
    const letter = column.column || column.letter;
    const binding = Object.entries(projection).find(([, spec]) => spec.column === letter && spec.header === column.header);
    const use = document.createElement('input'); use.type = 'checkbox'; use.checked = Boolean(binding); use.disabled = column.validHeader === false;
    if (binding) retained++;
    const alias = document.createElement('input'); alias.type = 'text'; alias.maxLength = 48; alias.value = binding?.[0] || aliasFor(column.header, letter, used);
    const type = document.createElement('select');
    ['string','integer','number','boolean'].forEach(value => type.append(option(value, value)));
    type.value = binding?.[1].type || column.suggestedType || 'string';
    const nullable = document.createElement('input'); nullable.type = 'checkbox'; nullable.checked = binding?.[1].nullable || false;
    const formula = document.createElement('select'); formula.append(option('reject', 'Reject formulas'), option('effective', 'Use effective value'));
    formula.value = binding?.[1].formula || 'reject';
    use.setAttribute('aria-label', 'Include source column ' + letter);
    alias.setAttribute('aria-label', 'Public name for column ' + letter);
    type.setAttribute('aria-label', 'Scalar type for column ' + letter);
    nullable.setAttribute('aria-label', 'Allow blank values for column ' + letter);
    formula.setAttribute('aria-label', 'Formula rule for column ' + letter);
    const row = document.createElement('tr'); row.dataset.column = letter;
    const useCell = document.createElement('td'); useCell.append(use);
    const source = document.createElement('td'); source.append(text('strong', letter + ' · ' + display(column.header)));
    if (column.validHeader === false) source.append(text('div', 'A literal, nonempty text header is required.', 'muted'));
    const aliasCell = document.createElement('td'); aliasCell.append(alias);
    const typeCell = document.createElement('td'); typeCell.append(type);
    const nullableCell = document.createElement('td'); nullableCell.append(nullable);
    const formulaCell = document.createElement('td'); formulaCell.append(formula);
    const observed = document.createElement('td');
    const counts = column.counts || column.observed || {};
    observed.append(text('div', Object.entries(counts).filter(([, value]) => typeof value === 'number' && value > 0).map(([key, value]) => value + ' ' + key).join(' · ') || 'No nonempty values', 'muted'));
    for (const sample of column.samples || []) observed.append(text('div', 'Row ' + sample.row + ': ' + display(sample.value), 'cell-sample'));
    const updateEnabled = () => {
      row.classList.toggle('unselected', !use.checked);
      for (const input of [alias, type, nullable, formula]) input.disabled = !use.checked;
      $('column-count').textContent = [...columns.values()].filter(x => x.use.checked).length + ' public columns selected';
    };
    columns.set(letter, {use, alias, type, nullable, formula, header: column.header});
    for (const input of [use, alias, type, nullable, formula]) input.addEventListener('input', () => { updateEnabled(); dirty(); });
    row.append(useCell, source, aliasCell, typeCell, nullableCell, formulaCell, observed);
    $('columns-body').append(row); updateEnabled();
  }
  $('column-count').textContent = retained + ' public columns selected';
  draftRevision = baseRevision;
  draftDirty = changed; preview = null;
  renderMode(); renderDraftState(); renderPreview();
  if (carry && Object.keys(prior).length && retained !== Object.keys(prior).length) notice('Only bindings whose source letter and exact header still match were retained. Review changed and unselected columns.');
  return true;
}
async function loadDraftState(definition, revision, editingVersion = false, intent = null) {
  if (!await loadCapture(definition.captureId, definition.range, {definition, changed: editingVersion, revision, intent})) return false;
  draftRevision = revision;
  draftDirty = editingVersion;
  if (!editingVersion && state.preview?.draftRevision === revision) preview = state.preview;
  renderDraftState(); renderPreview();
  return true;
}
function renderMode() {
  const live = $('source-mode').value === 'live';
  $('draft-connection-label').hidden = !live;
  $('mode-description').textContent = live
    ? 'Preview uses this exact retained observation. A live plan reads this bounded tab/range through the selected host connection on each extraction. Every resulting candidate uses the original publisher review.'
    : 'Every new native publisher plan reads these exact retained CellData bytes. To refresh the source, capture another observation and save a new reviewed source version.';
}
async function saveDraft() {
  const definition = draftFromEditor();
  const generation = editGeneration;
  const result = await mutation('/api/draft', {draft: definition, expectedRevision: draftRevision}, 'Save source draft');
  if (generation === editGeneration) { draftDirty = false; draftRevision = state.draftRevision; renderDraftState(); }
  return result;
}
async function previewDraft() {
  if (draftDirty) await saveDraft();
  if (pending) return;
  const result = await mutation('/api/preview', {draftRevision}, 'Validate and preview projection');
  preview = result.preview || result; renderPreview();
}
function renderPreview() {
  $('preview-card').hidden = !preview;
  if (!preview) { renderDraftState(); return; }
  $('preview-state').textContent = 'Original typed extractor · complete';
  const report = preview.report || {};
  summary($('preview-summary'), [['Validated rows', report.rowCount ?? report.rows ?? preview.rowCount],
    ['Draft revision', preview.draftRevision], ['Source SHA-256', preview.sourceSha256],
    ['Observed at', time(preview.createdAt)], ['Preview sample', 'First ' + (preview.sample?.length || 0) + ' rows; validation covers the full selected range']]);
  const names = Object.keys(preview.sample?.[0] || state?.draft?.columns || {});
  table($('preview-table'), names, (preview.sample || []).map(row => names.map(name => row[name])));
  renderDraftState();
}
async function downloadVersion(id) {
  const result = await api('/api/export?id=' + id, {binary: true});
  const url = URL.createObjectURL(result.bytes);
  const link = text('a', 'Download source packet'); link.href = url; link.download = result.filename || 'sheets-source-v' + id + '.private.json';
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice('Private source packet downloaded. It includes the complete captured CellData and reviewed projection; share it only with the intended operator.');
}
async function compare() {
  const left = Number($('compare-left').value), right = Number($('compare-right').value);
  if (!left || !right) throw new Error('Select two saved versions.');
  const result = await api('/api/compare?' + new URLSearchParams({left, right}));
  const container = $('comparison'); container.replaceChildren();
  const cards = text('div', '', 'compare-summary');
  for (const saved of [result.left, result.right]) {
    const section = text('section', '', 'card'); section.append(text('h3', 'Version ' + saved.id + ' · ' + saved.title));
    const details = document.createElement('div'); summary(details, [['Range', saved.range], ['Rows', saved.rowCount], ['Mode', saved.mode], ['Observation', saved.observationSha256], ['Reviewed by', saved.reviewer], ['Review note', saved.note]]);
    section.append(details); cards.append(section);
  }
  container.append(cards, text('p', [
    result.sameObservation ? 'Same observation bytes' : 'Different observation bytes',
    result.sameRange ? 'same range' : 'different range',
    result.sameProjection ? 'same projection' : 'different projection'
  ].join(' · ')));
  const projection = document.createElement('div');
  table(projection, ['Public column', 'Change', 'Earlier binding', 'Later binding'], result.columns.map(row => [row.alias, row.status, row.before, row.after]));
  container.append(projection);
  for (const [saved, originalPreview] of [[result.left, result.leftPreview], [result.right, result.rightPreview]]) {
    container.append(text('h3', 'Saved original preview · version ' + saved.id));
    const sample = originalPreview?.sample || [], names = Object.keys(sample[0] || saved.draft?.columns || {});
    const previewTable = document.createElement('div'); table(previewTable, names, sample.map(row => names.map(name => row[name]))); container.append(previewTable);
  }
}
function tabsOf(resource) { return (resource.sheets || []).map(sheet => sheet.properties).filter(props => props?.sheetType === 'GRID'); }
function quoted(title) { return "'" + title.replaceAll("'", "''") + "'"; }
async function bytesOf(file, limit) {
  if (!file || file.size > limit) throw new Error('Select a JSON file within the displayed size limit.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  return {bytes, digest};
}
function base64(bytes) {
  const parts = [];
  for (let start = 0; start < bytes.length; start += 32768) parts.push(String.fromCharCode(...bytes.subarray(start, start + 32768)));
  return btoa(parts.join(''));
}
async function chooseUpload(file) {
  const generation = ++uploadGeneration;
  upload = null; $('import-source').disabled = true; $('upload-summary').textContent = 'Reading the selected original file…';
  const original = await bytesOf(file, 128 * 1024 * 1024);
  if (generation !== uploadGeneration) return;
  const resource = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(original.bytes));
  const packet = resource.schema === 'stellar-forge.sheets-source-packet.v1';
  if (!packet && original.bytes.length > 64 * 1024 * 1024) throw new Error('CellData resource limit is 64 MiB.');
  const tabs = packet ? [] : tabsOf(resource);
  if (!packet && !tabs.length) throw new Error('Select an original Spreadsheet resource containing a GRID tab and CellData, or a private source packet.');
  upload = {file, ...original, resource, packet, tabs};
  $('upload-summary').textContent = packet
    ? 'Private source packet · ' + (resource.version?.title || file.name) + ' · ' + file.size.toLocaleString() + ' bytes'
    : (resource.properties?.title || file.name) + ' · ' + tabs.length + ' captured tab(s) · ' + file.size.toLocaleString() + ' exact bytes';
  $('upload-range-controls').hidden = packet;
  $('upload-tab').replaceChildren();
  tabs.forEach(tab => $('upload-tab').append(option(tab.sheetId, tab.title + ' · ID ' + tab.sheetId)));
  $('upload-range').value = '';
  $('upload-title').value = packet ? resource.version?.title || 'Imported source' : resource.properties?.title || file.name;
  $('import-source').textContent = packet ? 'Import private source packet' : 'Retain observation';
  $('import-source').disabled = false;
}
async function importUpload() {
  if (!upload) throw new Error('Select an original CellData JSON file or private source packet.');
  const file = {name: upload.file.name, bytes: upload.bytes.length, sha256: upload.digest, packet: upload.packet};
  if (upload.packet) return mutation('/api/import-package', {packet: upload.resource, title: $('upload-title').value.trim(), expectedDraftRevision: state.draftRevision}, 'Import private source packet', file);
  const tab = upload.tabs.find(item => String(item.sheetId) === $('upload-tab').value);
  if (!tab) throw new Error('Select the captured tab.');
  const range = $('upload-range').value.trim().toUpperCase();
  if (!/^[A-Z]+[1-9]\d*:[A-Z]+[1-9]\d*$/.test(range)) throw new Error('Enter the exact original requested A1 rectangle, including the header and data rows.');
  return mutation('/api/import', {resource: {encoding: 'base64', bytes: upload.bytes.length, sha256: upload.digest, data: base64(upload.bytes)},
    range: quoted(tab.title) + '!' + range, title: $('upload-title').value.trim()}, 'Retain Sheet observation', file);
}
async function retryFile(file) {
  if (!pending?.file) return;
  const requestId = pending.requestId;
  const original = await bytesOf(file, 128 * 1024 * 1024);
  if (pending?.requestId !== requestId) return;
  if (original.digest !== pending.file.sha256 || original.bytes.length !== pending.file.bytes) throw new Error('This file does not match the original request. Select the exact same bytes.');
  retryPayload = {...pending.body};
  if (pending.file.packet) retryPayload.packet = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(original.bytes));
  else retryPayload.resource = {encoding: 'base64', bytes: original.bytes.length, sha256: original.digest, data: base64(original.bytes)};
  showRecovery(null, 'Exact original file verified. Retry uses the same request ID and bytes.');
}
async function inspectWorkbook() {
  const alias = $('live-connection').value, input = $('live-workbook').value.trim();
  if (!alias || !input) throw new Error('Select a host connection and enter the workbook URL or ID.');
  const generation = ++viewGeneration;
  $('load-workbook').disabled = true;
  try {
    const result = await api('/api/workbook', {body: {connectionAlias: alias, spreadsheet: input}});
    if (generation !== viewGeneration || alias !== $('live-connection').value || input !== $('live-workbook').value.trim()) return;
    workbook = result;
    $('workbook-summary').textContent = result.title + ' · ' + result.spreadsheetId;
    $('live-tab').replaceChildren();
    (result.tabs || []).filter(tab => tab.sheetType === 'GRID').forEach(tab => $('live-tab').append(option(tab.sheetId, tab.title + ' · ' + (tab.rows || '?') + ' rows')));
    $('live-range').value = '';
    $('live-title').value = result.title;
  } finally { renderConnection(); }
}
async function captureLive() {
  if (!workbook) throw new Error('Read the workbook tabs first.');
  const tab = (workbook.tabs || []).find(item => String(item.sheetId) === $('live-tab').value);
  if (!tab) throw new Error('Select an original GRID tab.');
  const range = $('live-range').value.trim().toUpperCase();
  return mutation('/api/capture', {connectionAlias: $('live-connection').value, spreadsheet: workbook.spreadsheetId,
    sheetId: tab.sheetId, sheetTitle: tab.title, range, title: $('live-title').value.trim()}, 'Read bounded Sheet observation');
}
function invalidateWorkbook() {
  workbook = null; viewGeneration++;
  $('workbook-summary').textContent = ''; $('live-tab').replaceChildren(); renderConnection();
}
document.querySelectorAll('[data-view]').forEach(node => node.addEventListener('click', () => view(node.dataset.view)));
$('refresh').addEventListener('click', run(() => refresh()));
$('source-file').addEventListener('change', run(() => chooseUpload($('source-file').files[0])));
$('import-source').addEventListener('click', run(importUpload));
$('live-connection').addEventListener('change', invalidateWorkbook);
$('live-workbook').addEventListener('input', invalidateWorkbook);
$('load-workbook').addEventListener('click', run(inspectWorkbook));
$('capture-live').addEventListener('click', run(captureLive));
$('captures-prev').addEventListener('click', run(async () => { capturesOffset = Math.max(0, capturesOffset - pageSize); await refresh(); }));
$('captures-next').addEventListener('click', run(async () => { capturesOffset += pageSize; await refresh(); }));
$('versions-prev').addEventListener('click', run(async () => { versionsOffset = Math.max(0, versionsOffset - pageSize); await refresh(); }));
$('versions-next').addEventListener('click', run(async () => { versionsOffset += pageSize; await refresh(); }));
for (const id of ['draft-title','draft-name','draft-range','empty-rows','source-mode','draft-connection']) $(id).addEventListener('input', () => { dirty(); if (id === 'source-mode') renderMode(); });
$('inspect-range').addEventListener('click', run(async () => {
  if (!captureView) throw new Error('Select a retained observation first.');
  await loadCapture(captureRecord().id, $('draft-range').value.trim().toUpperCase(), {carry: true});
}));
$('save-draft').addEventListener('click', run(saveDraft));
$('preview-draft').addEventListener('click', run(previewDraft));
$('reload-draft').addEventListener('click', run(async () => { await refresh({loadDraft: true}); notice('Loaded the current saved draft.'); }));
$('save-version').addEventListener('click', run(async () => {
  if (!preview || draftDirty) throw new Error('Validate the current saved projection first.');
  if (!$('reviewer').value.trim() || !$('version-note').value.trim()) throw new Error('Enter the reviewer and source change note.');
  await mutation('/api/version', {draftRevision, previewId: preview.id, reviewer: $('reviewer').value.trim(), note: $('version-note').value.trim(), expectedSelectedVersion: selectedVersionId()}, 'Save reviewed source version');
}));
$('open-publisher').addEventListener('click', run(async () => {
  await mutation('/api/publisher/start', {expectedSelectedVersion: selectedVersionId()}, 'Open original publisher');
  if (state.publisher?.running) $('publisher-link').focus();
}));
$('stop-publisher').addEventListener('click', run(() => mutation('/api/publisher/stop', {}, 'Stop original publisher')));
$('compare-versions').addEventListener('click', run(compare));
$('check-operation').addEventListener('click', run(() => reconcile()));
$('resume-operation').addEventListener('click', run(() => reconcile({resume: true})));
$('retry-operation').addEventListener('click', run(retrySame));
$('retry-file').addEventListener('change', run(() => retryFile($('retry-file').files[0])));
$('dismiss-operation').addEventListener('click', run(async () => {
  if (recoveryKnown?.status !== 'failed') throw new Error('The request must have a confirmed terminal failure before returning to new work.');
  forget(); await refresh(); notice('The request has a confirmed failure. Continue from the saved source.');
}));
window.addEventListener('beforeunload', event => {
  if (draftDirty && !pending) { event.preventDefault(); event.returnValue = ''; }
});
(async () => {
  busy = true; lock();
  try {
    if (!token) throw new Error('Open the exact capability URL printed by the workspace command.');
    await refresh();
    const retained = localStorage.getItem(pendingKey + ':' + state.directory);
    if (retained) {
      const value = JSON.parse(retained);
      if (!value.requestId || !/^[0-9a-f-]{36}$/i.test(value.requestId)) throw new Error('The retained request marker is invalid.');
      pending = value; showRecovery(null, 'Checking the retained original request before enabling new work…');
    }
    if (state.draft) await loadDraftState(state.draft, state.draftRevision);
    busy = false;
    if (pending) await reconcile();
    else notice('Ready. Begin with a retained observation or an existing host connection.');
  } catch (error) {
    $('host-status').textContent = 'Connection needed';
    notice(errorMessage(error), true);
    if (pending) showRecovery(null, 'The workspace is unavailable. Keep this original request and check again after reopening the server.');
  } finally { busy = false; lock(); }
})();

