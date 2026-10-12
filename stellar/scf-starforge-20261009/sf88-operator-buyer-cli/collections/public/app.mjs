// MIT — Same-origin private collection review; all execution uses the original CLI.
const $ = id => document.getElementById(id);
const sessionKey = 'starforge.collections.' + location.origin;
const state = { token: '', connected: false, busy: false, status: null,
  collections: [], current: null, selectedId: null, selected: new Set(),
  preview: null, command: null, exported: null, view: 'empty', generation: 0, pendingToken: null };
const recordedStates = new Set(['ATTEMPT_RECORDED', 'RECOVERED']);
const queuedStates = new Set(['QUEUED']);
const errors = {
  PRIVATE_SESSION_REQUIRED: 'The private session has ended. Open the current workspace URL.',
  COLLECTION_PREVIEW_CHANGED: 'The request inputs changed. Review them again before saving.',
  COLLECTION_REVIEW_EXPIRED: 'This source review expired. Review the requests again.',
  COLLECTION_MANIFEST_CHANGED: 'The collection changed. Refresh its status and review it again.',
  COLLECTION_INPUT_CHANGED: 'A retained input changed. Inspect the request details before continuing.',
  COLLECTION_INPUT_MISSING: 'A required input is missing. Inspect the request details and restore that file.',
  COLLECTION_BUSY: 'This collection is already being updated. Refresh after the current operation finishes.',
  COLLECTION_WORKSPACE_BUSY: 'Another workspace action is still running. Refresh its status shortly.',
  COLLECTION_INTENT_REQUIRED: 'Select at least one request.',
  COLLECTION_INTENT_UNKNOWN: 'The selection changed. Refresh and select the requests again.',
  COLLECTION_NOT_ENQUEUED: 'Queue the retained requests before preparing a run.',
  COLLECTION_ID_CONFLICT: 'That collection ID already exists. Open it, or choose a different ID.',
  COLLECTION_ORIGINAL_JOB_CHANGED: 'The original queued request changed. Inspect its current record.',
  COLLECTION_INVALID_INPUT: 'Check the collection name, ID and absolute configuration paths.',
  COLLECTION_EXPORT_CHANGED: 'The saved export changed on disk. Export the current results again.',
  COLLECTION_EXPORT_EXPIRED: 'The download session expired. Create a fresh results export.',
  COLLECTION_NOT_FOUND: 'That collection is unavailable. Refresh the collection list.',
  INBOX_PRIVATE_DIRECTORY_REQUIRED: 'The original inbox must use its existing private directory.',
  INBOX_INTENT_EXISTS: 'This request already exists in the original inbox. Refresh and inspect its identity.',
  REQUEST_TOO_LARGE: 'This request is too large. Shorten the configuration list.',
  JSON_REQUIRED: 'The workspace requires a JSON request.',
};
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
function children(element, values) { element.replaceChildren(...values); return element; }
function formatState(value) { return String(value ?? 'UNKNOWN').replaceAll('_', ' '); }
function date(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}
function say(message, kind = 'status') {
  const notice = $('notice'); notice.textContent = message;
  notice.dataset.kind = kind; notice.hidden = !message;
}
function humanError(error) {
  const code = error.code ?? error.message ?? 'COLLECTION_OPERATION_FAILED';
  if (errors[code]) return errors[code] + ' [' + code + ']';
  if (code === 'Failed to fetch') return 'The workspace is unreachable. Check that its terminal is still open.';
  return 'The operation could not finish. ' + String(code).replaceAll('_', ' ');
}
function locked() {
  state.connected = false; state.token = '';
  try { sessionStorage.removeItem(sessionKey); } catch {}
  $('connection').hidden = false; $('workspace').hidden = true;
  $('lock').hidden = true; $('connection-state').textContent = 'Locked';
  $('session-key').focus();
}
async function api(path, input, { blob = false } = {}) {
  const headers = { Authorization: 'Bearer ' + state.token };
  const options = { method: input === undefined ? 'GET' : 'POST', headers,
    cache: 'no-store', credentials: 'omit', redirect: 'error' };
  if (input !== undefined) {
    headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(input);
  }
  const response = await fetch(path, options);
  if (!response.ok) {
    let payload;
    try { payload = await response.json(); } catch {}
    const error = Object.assign(new Error(payload?.error ?? 'HTTP_' + response.status),
      { code: payload?.error ?? 'HTTP_' + response.status });
    if (response.status === 401) locked();
    throw error;
  }
  return blob ? response.blob() : response.json();
}
function showView(view) {
  state.view = view;
  $('empty').hidden = view !== 'empty';
  $('create-panel').hidden = view !== 'create';
  $('detail-panel').hidden = view !== 'detail';
}
const actionIds = ['preview-button', 'save-collection', 'enqueue', 'export',
  'recover', 'cancel', 'run-command', 'refresh', 'refresh-detail', 'new-collection'];
function buttons() {
  for (const id of actionIds) $(id).disabled = state.busy || !state.connected;
  const hasCurrent = Boolean(state.current && state.view === 'detail');
  for (const id of ['enqueue', 'export', 'refresh-detail'])
    $(id).disabled = state.busy || !hasCurrent;
  const selectedItems = (state.current?.items ?? []).filter(item => state.selected.has(item.intentId));
  const any = hasCurrent && selectedItems.length > 0;
  $('run-command').disabled = state.busy || !any || selectedItems.some(item => item.state !== 'QUEUED');
  $('cancel').disabled = state.busy || !any || selectedItems.some(item => item.state !== 'QUEUED');
  $('recover').disabled = state.busy || !any || selectedItems.some(item => item.job?.attempt?.kind !== 'EXECUTE');
  $('save-collection').disabled = state.busy || !state.preview;
  $('copy-command').disabled = !state.command;
  $('selection-count').textContent = state.selected.size + ' selected';
  $('connection-state').textContent = state.connected
    ? state.busy ? 'Updating' : 'Private session' : 'Locked';
}
async function task(label, operation) {
  if (state.busy) return;
  state.busy = true; buttons(); say(label);
  try { await operation(); }
  catch (error) { say(humanError(error), 'error'); }
  finally {
    state.busy = false; buttons();
    if (state.pendingToken) {
      const token = state.pendingToken; state.pendingToken = null;
      void task('Reconnecting to the workspace…', async () => { await connect(token); say('Private session refreshed.'); });
    }
  }
}
function table(headings, rows) {
  const wrap = node('div', null, 'table-wrap'), table = node('table');
  const header = node('tr');
  for (const heading of headings) header.append(node('th', heading));
  table.append(children(node('thead'), [header]));
  const body = node('tbody');
  for (const row of rows) {
    const tr = node('tr');
    for (const cell of row) {
      const td = node('td');
      if (cell instanceof Node) td.append(cell);
      else td.textContent = cell === undefined || cell === null || cell === '' ? '—' : String(cell);
      tr.append(td);
    }
    body.append(tr);
  }
  if (!rows.length) {
    const tr = node('tr'), td = node('td', 'No entries.');
    td.colSpan = headings.length; tr.append(td); body.append(tr);
  }
  table.append(body); wrap.append(table); return wrap;
}
function totals(rows) {
  return table(['Network / flow', 'Asset', 'Recipient', 'Requests', 'Limit · atomic'],
    (rows ?? []).map(item => [
      children(node('div'), [node('span', item.network, 'cell-primary'),
        node('span', (item.scheme ?? 'exact') + ' · ' + (item.paymentFlow ?? 'authorization'), 'cell-secondary')]),
      node('span', item.asset, 'mono'),
      node('span', item.payTo, 'mono'),
      String(item.itemCount), node('span', item.maxAtomic, 'mono'),
    ]));
}
function resource(item) {
  return children(node('div'), [
    node('span', item.intentId, 'cell-primary mono'),
    node('span', item.operation?.url ?? '', 'cell-secondary'),
  ]);
}
function previewItems(items) {
  return table(['Request', 'Method', 'Limit · atomic', 'Response destination'],
    items.map(item => [resource(item), item.operation?.method ?? 'GET',
      node('span', item.operation?.expect?.maxAtomic ?? '—', 'mono'),
      node('span', destination(item), 'mono')]));
}
function destination(item) {
  const value = item.responseDestination;
  return typeof value === 'string' ? value : value?.destination ?? 'Retained request result';
}
function renderList() {
  const query = $('filter').value.trim().toLowerCase();
  const matches = state.collections.filter(item =>
    [item.name, item.id, item.state].some(value => String(value ?? '').toLowerCase().includes(query)));
  const entries = matches.map(item => {
    const button = node('button', null, 'collection-choice');
    button.type = 'button'; button.setAttribute('aria-current', String(item.id === state.selectedId));
    button.append(node('strong', item.name ?? item.id),
      node('small', (item.itemCount ?? '—') + ' requests · ' + formatState(item.state)),
      node('small', item.id, 'mono'));
    button.addEventListener('click', () => task('Opening collection…', async () => {
      await selectCollection(item.id); say('');
    }));
    return button;
  });
  if (!entries.length) entries.push(node('p',
    query ? 'No matching collections.' : 'Your saved collections will appear here.', 'muted'));
  children($('collection-list'), entries);
}
function renderLocations() {
  const data = state.status ?? {}, values = [];
  for (const [label, value] of [['Collections', data.directory], ['Original inbox', data.queueRoot],
    ['Exports', data.exportRoot]]) values.push(node('dt', label), node('dd', value ?? '—'));
  children($('locations'), values);
}
function renderProgress(snapshot) {
  const items = snapshot.items ?? [];
  const counts = [
    [items.length, 'REQUESTS'],
    [items.filter(item => recordedStates.has(item.state)).length, 'RECORDED ATTEMPTS'],
    [items.filter(item => queuedStates.has(item.state)).length, 'QUEUED'],
    [items.filter(item => item.error || /REVIEW|FAILED|MISSING|UNKNOWN|INTERRUPTED/.test(item.state)).length,
      'NEED ATTENTION'],
  ];
  children($('progress'), counts.map(([value, label]) =>
    children(node('div'), [node('span', value, 'progress-value'), node('span', label, 'progress-label')])));
}
function renderDetails(snapshot) {
  const rows = (snapshot.items ?? []).map(item => {
    const checkbox = node('input');
    checkbox.type = 'checkbox'; checkbox.checked = state.selected.has(item.intentId);
    checkbox.setAttribute('aria-label', 'Select ' + item.intentId);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selected.add(item.intentId); else state.selected.delete(item.intentId);
      state.command = null; $('command-panel').hidden = true; buttons();
    });
    const result = children(node('div'), [node('span', formatState(item.state), 'state')]);
    if (item.error) result.append(node('span',
      typeof item.error === 'string' ? item.error : item.error.code ?? JSON.stringify(item.error),
      'cell-secondary'));
    return [checkbox, resource(item), item.operation?.method ?? 'GET', result,
      node('span', destination(item), 'mono')];
  });
  children($('detail-items'), [table(['Select', 'Request / resource', 'Method', 'State', 'Destination'], rows)]);
  children($('request-details'), (snapshot.items ?? []).map(item => {
    const detail = node('details', null, 'item-details');
    detail.append(node('summary', item.intentId + ' · ' + formatState(item.state)),
      node('pre', JSON.stringify({ operation: item.operation, sourceConfig: item.sourceConfig,
        body: item.body, ticket: item.ticket, responseDestination: item.responseDestination,
        state: item.state, job: item.job, error: item.error }, null, 2)));
    return detail;
  }));
  children($('run-history'), [table(['Run', 'Started', 'Requests', 'State'],
    (snapshot.runs ?? []).map(run => [node('span', run.runId, 'mono'), date(run.startedAt),
      run.intentIds?.length ?? '—', formatState(run.state)]))]);
}
function renderCurrent() {
  const snapshot = state.current;
  if (!snapshot) return;
  $('detail-name').textContent = snapshot.name ?? snapshot.id;
  $('detail-meta').textContent = snapshot.id + ' · Created ' + date(snapshot.createdAt);
  $('detail-state').textContent = formatState(snapshot.state);
  $('manifest-hash').textContent = snapshot.manifestSha256;
  children($('detail-totals'), [totals(snapshot.totals)]);
  renderProgress(snapshot); renderDetails(snapshot); buttons();
}
async function refresh({ silent = false } = {}) {
  if (!state.connected) return;
  const id = state.selectedId, generation = ++state.generation;
  const [list, snapshot] = await Promise.all([
    api('/api/collections'), id ? api('/api/collections/' + encodeURIComponent(id)) : null,
  ]);
  if (generation !== state.generation) return;
  state.collections = list.collections ?? [];
  renderList();
  if (snapshot && state.selectedId === id) {
    const changed = JSON.stringify(snapshot) !== JSON.stringify(state.current);
    state.current = snapshot;
    const known = new Set(snapshot.items.map(item => item.intentId));
    state.selected = new Set([...state.selected].filter(intent => known.has(intent)));
    if (changed || !silent) renderCurrent();
  }
}
async function selectCollection(id) {
  const changed = state.selectedId !== id;
  state.selectedId = id;
  if (changed) {
    state.selected.clear(); state.command = null; state.exported = null;
    $('command-panel').hidden = true; $('export-panel').hidden = true;
  }
  await refresh();
  if (state.selectedId === id && state.current) showView('detail');
  renderList(); buttons();
}
function beginCreate() {
  if (state.busy) return;
  state.preview = null; $('preview-panel').hidden = true;
  $('collection-id').value = 'collection-' + crypto.randomUUID().slice(0, 8);
  $('collection-name').value = ''; $('config-files').value = '';
  showView('create'); buttons(); $('collection-name').focus();
}
function invalidatePreview() {
  if (!state.preview) return;
  state.preview = null; $('preview-panel').hidden = true;
  buttons(); $('preview-hint').textContent = 'The paths changed. Review the requests again.';
}
async function connect(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token.trim()))
    throw Object.assign(new Error('PRIVATE_SESSION_REQUIRED'), { code: 'PRIVATE_SESSION_REQUIRED' });
  state.token = token.trim();
  const status = await api('/api/status');
  if (state.status && state.status.directory !== status.directory) {
    state.selectedId = null; state.current = null; state.collections = [];
    state.selected.clear(); state.preview = null; state.command = null; state.exported = null;
    $('command-panel').hidden = true; $('export-panel').hidden = true; showView('empty');
  }
  state.status = status; state.connected = true;
  try { sessionStorage.setItem(sessionKey, state.token); } catch {}
  $('connection').hidden = true; $('workspace').hidden = false; $('lock').hidden = false;
  $('session-key').value = '';
  renderLocations(); await refresh(); buttons();
}
function pinnedAction() {
  if (!state.current) throw Object.assign(new Error('COLLECTION_NOT_FOUND'),
    { code: 'COLLECTION_NOT_FOUND' });
  return { expectedManifestSha256: state.current.manifestSha256 };
}
async function collectionAction(action, includeSelection = false) {
  const id = state.selectedId;
  const input = { ...pinnedAction(), ...(includeSelection ? { intentIds: [...state.selected] } : {}) };
  const result = await api('/api/collections/' + encodeURIComponent(id) + '/' + action, input);
  if (state.selectedId === id) {
    state.current = result; state.command = null; $('command-panel').hidden = true;
  }
  await refresh();
  const problems = result.action?.results?.filter(item => item.error) ?? [];
  say(problems.length ? 'Request update needs attention: ' + problems.map(item =>
    item.intentId + ' [' + (item.error?.code ?? item.error) + ']').join('; ')
    : 'Request states updated.', problems.length ? 'error' : 'status');
}
$('preview-form').addEventListener('submit', event => {
  event.preventDefault();
  task('Reading request inputs…', async () => {
    const sourceText = $('config-files').value;
    const configFiles = sourceText.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const reviewed = await api('/api/preview', { configFiles });
    if ($('config-files').value !== sourceText) {
      state.preview = null; $('preview-panel').hidden = true;
      say('The configuration paths changed while being reviewed. Review the updated requests.');
      return;
    }
    state.preview = reviewed;
    children($('preview-totals'), [totals(state.preview.totals)]);
    children($('preview-items'), [previewItems(state.preview.items)]);
    $('preview-hash').textContent = state.preview.previewSha256;
    $('preview-hint').textContent = state.preview.itemCount + ' requests reviewed.';
    $('preview-panel').hidden = false; buttons();
    say('Review the included requests and limits, then save the collection.');
  });
});
$('config-files').addEventListener('input', invalidatePreview);
$('save-collection').addEventListener('click', () => task('Saving reviewed collection…', async () => {
  const preview = state.preview;
  if (!preview) return;
  if (!$('preview-form').reportValidity()) return;
  const result = await api('/api/collections', {
    id: $('collection-id').value.trim(), name: $('collection-name').value.trim(),
    reviewId: preview.reviewId, expectedPreviewSha256: preview.previewSha256,
  });
  state.preview = null;
  await selectCollection(result.id);
  say('Collection saved. Its retained requests are ready to queue.');
}));
for (const id of ['new-collection', 'empty-create']) $(id).addEventListener('click', beginCreate);
$('close-create').addEventListener('click', () => {
  if (!state.busy) { showView(state.current ? 'detail' : 'empty'); buttons(); }
});
$('filter').addEventListener('input', renderList);
for (const id of ['refresh', 'refresh-detail']) $(id).addEventListener('click',
  () => task('Refreshing collection status…', async () => { await refresh(); say('Status refreshed.'); }));
$('enqueue').addEventListener('click', () =>
  task('Queuing retained requests…', () => collectionAction('enqueue')));
$('recover').addEventListener('click', () =>
  task('Recovering selected original requests…', () => collectionAction('recover', true)));
$('cancel').addEventListener('click', () => {
  if (state.selected.size && confirm('Cancel ' + state.selected.size + ' selected requests in the original inbox?'))
    task('Cancelling selected requests…', () => collectionAction('cancel', true));
});
$('select-remaining').addEventListener('click', () => {
  state.selected = new Set((state.current?.items ?? [])
    .filter(item => queuedStates.has(item.state)).map(item => item.intentId));
  state.command = null; $('command-panel').hidden = true; renderCurrent();
});
$('clear-selection').addEventListener('click', () => {
  state.selected.clear(); state.command = null; $('command-panel').hidden = true; renderCurrent();
});
$('run-command').addEventListener('click', () => task('Preparing selected terminal command…', async () => {
  const result = await api('/api/collections/' + encodeURIComponent(state.selectedId) + '/command',
    { ...pinnedAction(), intentIds: [...state.selected] });
  state.command = result;
  $('command').textContent = result.command;
  $('command-selection').textContent = result.intentIds.length + ' explicitly selected requests · ' +
    result.intentIds.join(', ');
  $('command-panel').hidden = false; buttons();
  $('command-panel').scrollIntoView({ block: 'nearest' });
  say('The selected command is ready. Run it in a separate terminal to review each request.');
}));
$('copy-command').addEventListener('click', () => task('Copying command…', async () => {
  if (!state.command) return;
  try { await navigator.clipboard.writeText(state.command.command); say('Command copied.'); }
  catch {
    const selection = window.getSelection(), range = document.createRange();
    range.selectNodeContents($('command')); selection.removeAllRanges(); selection.addRange(range);
    say('Command selected. Use your browser’s copy command.');
  }
}));
$('export').addEventListener('click', () => task('Saving results export…', async () => {
  const result = await api('/api/collections/' + encodeURIComponent(state.selectedId) + '/export',
    pinnedAction());
  state.exported = result; $('export-location').textContent = result.directory;
  children($('export-files'), result.files.map(file => {
    const button = node('button', null, 'export-file');
    button.type = 'button';
    button.append(node('span', file.name), node('small', file.bytes.toLocaleString() + ' bytes', 'muted'));
    button.addEventListener('click', () => task('Downloading ' + file.name + '…', async () => {
      const bytes = await api(file.downloadUrl, undefined, { blob: true });
      const url = URL.createObjectURL(bytes), link = node('a');
      link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000); say(file.name + ' downloaded.');
    }));
    return button;
  }));
  $('export-panel').hidden = false;
  say('Results exported to the saved workspace location.');
}));
$('lock').addEventListener('click', () => { locked(); say('Workspace locked in this tab.'); });
$('connect-form').addEventListener('submit', event => {
  event.preventDefault();
  task('Connecting to the workspace…', async () => {
    await connect($('session-key').value); say('');
  });
});
window.addEventListener('hashchange', () => {
  const token = location.hash.slice(1);
  if (!token) return;
  history.replaceState(null, '', location.pathname);
  if (state.busy) { state.pendingToken = token; return; }
  void task('Reconnecting to the workspace…', async () => { await connect(token); say('Private session refreshed.'); });
});
let initialToken = location.hash.slice(1);
if (initialToken) history.replaceState(null, '', location.pathname);
if (!initialToken) { try { initialToken = sessionStorage.getItem(sessionKey) ?? ''; } catch {} }
if (initialToken) {
  await task('Connecting to the workspace…', async () => {
    try { await connect(initialToken); say(''); }
    catch (error) { locked(); throw error; }
  });
} else locked();
setInterval(() => {
  if (!state.connected || state.busy || document.hidden || state.view === 'create') return;
  refresh({ silent: true }).catch(error => {
    if (state.connected) say(humanError(error), 'error');
  });
}, 5000);
