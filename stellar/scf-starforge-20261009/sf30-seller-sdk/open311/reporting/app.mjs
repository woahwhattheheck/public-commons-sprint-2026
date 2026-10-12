// MIT. Local service-performance operator; all mutations retain their original input.
const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const short = (value, length = 14) => String(value ?? '').slice(0, length);
const whole = value => Number(value ?? 0).toLocaleString();
const lines = value => String(value ?? '').replace(/\r\n?/g, '\n').split('\n').filter(value => value !== '');
const fmt = value => value === null || value === undefined || value === '' ? 'Unstated' : String(value);
const keyOfProfile = value => value.id + '@' + value.revision;
const actionPaths = new Set(['/api/import', '/api/profile', '/api/build', '/api/review-import', '/api/review-apply', '/api/receive']);
const kindPaths = { 'source-import': '/api/import', 'profile-save': '/api/profile', 'report-build': '/api/build', 'review-import': '/api/review-import', 'review-apply': '/api/review-apply', 'workspace-receive': '/api/receive' };
const targetNames = { UNASSESSED: 'Unassessed', COMPLETED_ON_TIME: 'Completed on time', COMPLETED_LATE: 'Completed late', PENDING_WITHIN_TARGET: 'Open within target', OPEN_OVERDUE: 'Open overdue' };
const PAGE_SIZE = 50;
let workspace = null, pending = null, busy = false, databasePromise = null, currentView = 'overview';
let profileDraft = emptyProfile(), profileDirty = false, report = null, reportPage = 0, reportRequest = 0;
let reviewReturn = null, reviewDraft = null, reviewRequest = 0, comparison = null, inspectorValue = null;
let stateRequest = 0, mutationResult = null;
const reportCache = new Map(), sourceCache = new Map();

function emptyProfile() {
  return { id: '', name: '', revision: 1, provider: 'helsinki', calendars: [], mappings: [], policies: [],
    statusMappings: {}, reviewDeadline: null, notes: '' };
}
function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined && text !== null) result.textContent = String(text);
  if (className) result.className = className;
  return result;
}
function setText(id, text) { $(id).textContent = text ?? ''; }
function button(text, callback, className) {
  const result = node('button', text, className); result.type = 'button';
  result.addEventListener('click', () => safely(callback)); return result;
}
function badge(text, issue = false) { return node('span', text, 'tag' + (issue ? ' issue' : '')); }
function notify(message, error = false) {
  const target = $('notice'); target.textContent = message; target.className = 'notice' + (error ? ' error' : ''); target.hidden = !message;
}
async function safely(action) {
  try { return await action(); } catch (error) { notify(error.message || String(error), true); return null; }
}
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function numberField(id, { integer = true, minimum = -Infinity, maximum = Infinity } = {}) {
  const raw = $(id).value;
  requireValue(raw.trim() !== '', 'Complete the ' + $(id).closest('label').childNodes[0].textContent.trim() + ' field.');
  const value = Number(raw);
  requireValue(Number.isFinite(value) && (!integer || Number.isSafeInteger(value)) && value >= minimum && value <= maximum,
    'Enter a valid ' + (integer ? 'integer' : 'number') + ' for ' + $(id).closest('label').childNodes[0].textContent.trim() + '.');
  return value;
}
function instantField(id) {
  const value = $(id).value.trim();
  requireValue(/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)), 'Use a complete ISO timestamp with Z or an explicit offset for ' + $(id).closest('label').childNodes[0].textContent.trim() + '.');
  return value;
}
function dateTime(value, timeZone = report?.definition?.displayTimeZone ?? 'UTC') {
  if (!value || !Number.isFinite(Date.parse(value))) return fmt(value);
  try { return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value)) + ' · ' + timeZone; }
  catch { return value; }
}
function pathFor(path, values = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
  return path + (query.size ? '?' + query.toString() : '');
}
async function api(path, options = {}) {
  let response;
  try { response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', ...(options.headers ?? {}) } }); }
  catch (cause) { const error = new Error('The local reporting response was lost. The original command remains available for operation lookup and exact retry.', { cause }); error.uncertain = true; throw error; }
  let result;
  try { result = await response.json(); }
  catch (cause) { const error = new Error('The local service returned an incomplete response. Inspect the saved operation before retrying its original command.', { cause }); error.uncertain = true; error.status = response.status; throw error; }
  if (!response.ok || result?.ok !== true) {
    const error = new Error(result?.error?.message || 'The reporting action failed.');
    error.code = result?.error?.code || 'HTTP_' + response.status; error.status = response.status;
    error.details = result?.error?.details ?? null; error.uncertain = response.status >= 500;
    throw error;
  }
  return result.value;
}
async function readTextFile(input, description) {
  const file = input.files?.[0]; requireValue(file, 'Choose ' + description + '.');
  requireValue(file.size <= 128 * 1024 * 1024, 'This file exceeds the local server’s 128 MiB input limit.');
  let text; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); }
  catch { throw new Error('The selected file must contain complete UTF-8 text.'); }
  return { name: file.name, bytes: file.size, text };
}
function parseJson(text, description = 'The selected file') {
  try { return JSON.parse(text); } catch { throw new Error(description + ' must contain complete JSON.'); }
}
function safeFilename(value) { return String(value ?? 'export').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 160) || 'export'; }
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), anchor = node('a');
  anchor.href = url; anchor.download = safeFilename(name); document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function downloadJson(value, name) { downloadBlob(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }), name); }
function downloadText(value, name, type = 'application/json;charset=utf-8') { downloadBlob(new Blob([value], { type }), name); }
async function downloadExport(kind, reportId = null) {
  requireValue(workspace, 'Open a reporting workspace first.');
  if (kind !== 'workspace') requireValue(reportId, 'Select a saved report.');
  const url = pathFor('/api/export', { kind, reportId, expectedRevision: workspace.revision });
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error?.message || 'The saved export could not be downloaded. Refresh the current workspace revision and try again.');
  }
  const header = response.headers.get('Content-Disposition') || '';
  const filename = /filename="([^"]+)"/i.exec(header)?.[1] || 'open311-reporting-' + (reportId ?? workspace.workspaceId) + (kind === 'csv' ? '.csv' : kind === 'html' ? '.html' : '.json');
  downloadBlob(await response.blob(), filename);
}
function inspect(title, value, description = '', actions = []) {
  inspectorValue = value; setText('inspector-title', title); setText('inspector-description', description);
  setText('inspector-body', JSON.stringify(value, null, 2)); $('inspector-actions').replaceChildren(
    ...actions, button('Download inspected JSON', () => downloadJson(inspectorValue, safeFilename(title) + '.json')));
  if (!$('inspector').open) $('inspector').showModal();
}
function empty(target, message) { target.replaceChildren(node('p', message, 'empty')); }
function renderTable(target, columns, rows, emptyMessage = 'No saved items yet.') {
  target.replaceChildren();
  if (!rows.length) { empty(target, emptyMessage); return; }
  const wrap = node('div', null, 'table-wrap'), table = node('table'), head = node('thead'), header = node('tr'), body = node('tbody');
  for (const column of columns) { const th = node('th', column.label, column.className); th.scope = 'col'; header.append(th); }
  head.append(header);
  for (const row of rows) {
    const tr = node('tr');
    for (const column of columns) {
      const td = node('td', null, column.className), value = column.render(row);
      if (value instanceof Node) td.append(value); else td.textContent = fmt(value);
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(head, body); wrap.append(table); target.append(wrap);
}
function textPair(top, bottom) { const result = node('div'); result.append(node('strong', top)); if (bottom !== null && bottom !== undefined) result.append(node('p', bottom, 'help')); return result; }
function actionGroup(...items) { const result = node('div', null, 'actions'); result.append(...items); return result; }
function renderMetrics(target, values) {
  target.replaceChildren(...values.map(([title, value, note]) => {
    const item = node('div', null, 'metric'); item.append(node('span', title, 'label'), node('span', value, 'value'));
    if (note) item.append(node('span', note, 'note')); return item;
  }));
}
function ratioText(value) { return value?.percentage == null ? 'Unassessed' : value.percentage.toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%'; }
function ratioNote(value) { return whole(value?.numerator) + ' of ' + whole(value?.denominator); }
function chooseOptions(id, choices, placeholder = 'Choose a saved item', preserve = true) {
  const element = $(id), selected = preserve ? element.value : '';
  element.replaceChildren(new Option(placeholder, ''), ...choices.map(([value, title]) => new Option(title, value)));
  if (choices.some(([value]) => value === selected)) element.value = selected;
}
function profileOptions() { return (workspace?.profiles ?? []).map(value => [keyOfProfile(value), value.name + ' · ' + keyOfProfile(value)]); }
function reportOptions() { return (workspace?.reports ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(value => [value.id, value.name + ' · ' + short(value.id) + ' · ' + value.definition.period.start.slice(0, 10)]); }
function switchView(value) {
  requireValue(['overview', 'sources', 'rules', 'build', 'reports', 'reviews', 'workspace'].includes(value), 'This reporting view is unavailable.');
  currentView = value;
  for (const element of document.querySelectorAll('[data-panel]')) element.hidden = element.dataset.panel !== value;
  for (const element of document.querySelectorAll('[data-view]')) {
    if (element.dataset.view === value) element.setAttribute('aria-current', 'page'); else element.removeAttribute('aria-current');
  }
  try { localStorage.setItem('open311-reporting-view', value); } catch {}
}
function operationKey() { return 'command:' + (workspace?.workspaceId ?? 'unopened'); }
async function commandDatabase() {
  if (!globalThis.indexedDB) return null;
  if (!databasePromise) databasePromise = new Promise(resolve => {
    let settled = false;
    const finish = value => { if (settled) { value?.close(); return; } settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => finish(null), 4000);
    try {
      const request = indexedDB.open('commons-open311-reporting-commands-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('commands');
      request.onsuccess = () => finish(request.result); request.onerror = () => finish(null); request.onblocked = () => finish(null);
    } catch { finish(null); }
  });
  return databasePromise;
}
async function retainedCommand(action, value = null) {
  const key = operationKey(), database = await commandDatabase();
  if (database) return new Promise((resolve, reject) => {
    const transaction = database.transaction('commands', action === 'read' ? 'readonly' : 'readwrite'), objectStore = transaction.objectStore('commands');
    const request = action === 'read' ? objectStore.get(key) : action === 'delete' ? objectStore.delete(key) : objectStore.put(value, key);
    let result = null; request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(new Error('The browser could not retain the complete original command. Free browser storage and submit the same form again.'));
    transaction.onabort = () => reject(new Error('The browser cancelled retention of the original command.'));
  });
  try {
    if (action === 'read') return JSON.parse(localStorage.getItem(key) || 'null');
    if (action === 'delete') localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return null;
  } catch { throw new Error('This browser cannot retain the complete command. Enable browser storage or free space before submitting this action.'); }
}
function validCommand(value) {
  return value && value.schema === 'commons.open311-reporting.command.v1' && value.workspaceId === workspace.workspaceId &&
    actionPaths.has(value.path) && typeof value.payload?.requestId === 'string' && value.payload.requestId.length > 0 &&
    Number.isSafeInteger(value.payload.expectedRevision) && value.payload.expectedRevision >= 0;
}
function renderPending() {
  $('pending-panel').hidden = !pending;
  if (pending) {
    const descriptions = {
      prepared: 'The complete original input has been saved in this browser.',
      sending: 'The original command is being submitted. Its request ID and selected revision are retained.',
      uncertain: 'The response was incomplete. Inspect the saved operation or retry this exact original input.',
      absent: 'No saved operation was returned for this request ID. Retry the same original command.',
      failed: 'The server rejected this action. Inspect its outcome, then close it to prepare a corrected action.',
      confirmed: 'The original operation has a saved successful result.'
    };
    setText('pending-description', descriptions[pending.status] || descriptions.uncertain);
    setText('pending-identity', pending.payload.requestId + ' · revision ' + pending.payload.expectedRevision + ' · ' + pending.path);
    setText('pending-outcome', pending.outcome ? JSON.stringify(pending.outcome, null, 2) : 'No saved outcome inspected yet.');
  }
  $('pending-inspect').disabled = busy || !pending;
  $('pending-retry').disabled = busy || !pending || pending.status === 'confirmed';
  $('pending-download').disabled = !pending;
  $('pending-close').disabled = busy || !pending || !['failed', 'confirmed'].includes(pending.status);
  $('pending-close').textContent = pending?.status === 'failed' ? 'Close rejected command and prepare correction' : 'Close resolved command';
  updateControls();
}
function updateControls() {
  for (const element of document.querySelectorAll('[data-mutation]')) element.disabled = busy || !!pending || !workspace;
  $('receive-submit').disabled = busy || !!pending || !workspace || workspace.revision !== 0 || workspace.sources.length !== 0 || workspace.reports.length !== 0;
  $('refresh-state').disabled = busy;
  $('policy-calendar').disabled = $('policy-clock').value !== 'business';
  $('review-comment-request').disabled = $('review-comment-kind').value !== 'request-comment';
}
async function finishCommand(result) {
  pending.status = 'confirmed'; pending.outcome = clone(result); mutationResult = result;
  await retainedCommand('write', pending); renderPending();
  await refreshState();
  await retainedCommand('delete'); pending = null; renderPending();
  notify('Saved at workspace revision ' + result.revision + '. Request ' + result.requestId + '.');
  return result;
}
async function submitOriginal() {
  requireValue(pending && validCommand(pending), 'The original command does not identify this reporting workspace.');
  requireValue(!busy, 'The original reporting action is still running.');
  busy = true; pending.status = 'sending'; renderPending();
  try {
    await retainedCommand('write', pending);
    const result = await api(pending.path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.payload) });
    return await finishCommand(result);
  } catch (error) {
    if (pending && pending.status !== 'confirmed') {
      pending.status = error.uncertain ? 'uncertain' : 'failed';
      pending.outcome = { code: error.code ?? 'DELIVERY_UNCERTAIN', message: error.message, details: error.details ?? null };
      await retainedCommand('write', pending).catch(() => {});
    }
    notify(error.message, true); return null;
  } finally { busy = false; renderPending(); }
}
async function mutate(path, input) {
  requireValue(workspace, 'Open a reporting workspace first.');
  requireValue(!busy && !pending, 'Resolve the retained original command before preparing another action.');
  requireValue(actionPaths.has(path), 'Choose an original reporting action.');
  const created = { schema: 'commons.open311-reporting.command.v1', workspaceId: workspace.workspaceId, path,
    payload: { ...clone(input), requestId: crypto.randomUUID(), expectedRevision: workspace.revision },
    createdAt: new Date().toISOString(), status: 'prepared', outcome: null };
  await retainedCommand('write', created); pending = created; renderPending();
  return submitOriginal();
}
async function inspectPending() {
  requireValue(pending, 'There is no retained command.');
  const operation = await api(pathFor('/api/operation', { requestId: pending.payload.requestId }));
  if (operation) {
    requireValue(!operation.archived && operation.kind === Object.keys(kindPaths).find(key => kindPaths[key] === pending.path),
      'This request ID belongs to a different or archived reporting action. Inspect its complete history.');
    const original = { ...operation.input }, saved = { ...pending.payload };
    delete original.expectedRevision; delete saved.expectedRevision;
    const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
      '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    requireValue(canonical(original) === canonical(saved), 'The saved operation belongs to different original input.');
    pending.status = 'confirmed'; pending.outcome = operation;
    await retainedCommand('write', pending); await refreshState();
    notify('The original request has a saved successful result. Close this resolved command to continue.');
  } else {
    pending.status = 'absent'; pending.outcome = { requestId: pending.payload.requestId, operation: null };
    await retainedCommand('write', pending);
  }
  renderPending();
}
async function closePending() {
  requireValue(pending && ['failed', 'confirmed'].includes(pending.status) && !busy, 'Inspect or retry the original command before closing it.');
  await retainedCommand('delete'); pending = null; await refreshState(); renderPending();
}
async function refreshState() {
  const sequence = ++stateRequest, value = await api('/api/state'); if (sequence !== stateRequest) return workspace;
  requireValue(value && typeof value.workspaceId === 'string' && Number.isSafeInteger(value.revision) &&
    ['sources', 'profiles', 'reports', 'series', 'reviews', 'operations'].every(key => Array.isArray(value[key])), 'The reporting workspace state is incomplete.');
  const priorId = workspace?.workspaceId; workspace = value;
  if (priorId && priorId !== value.workspaceId) { pending = null; reportCache.clear(); sourceCache.clear(); report = null; reviewReturn = null; }
  setText('workspace-label', 'Workspace ' + short(workspace.workspaceId, 18));
  setText('workspace-meta', 'Revision ' + workspace.revision + ' · ' + workspace.directory);
  renderOverview(); renderSources(); renderStateSelectors(); renderWorkspace(); updateControls();
  return workspace;
}
function renderStateSelectors() {
  const profileChoices = profileOptions(), reports = reportOptions();
  chooseOptions('profile-select', profileChoices); chooseOptions('build-profile', profileChoices);
  for (const id of ['report-select', 'compare-before', 'compare-after', 'review-compose-report']) chooseOptions(id, reports);
  if (report && workspace.reports.some(value => value.id === report.id)) $('report-select').value = report.id;
  chooseOptions('review-select', workspace.reviews.map(value => [value.id, value.reviewer + ' · ' + short(value.baseReportId) + ' · ' + value.changes.length + ' changes']));
  const selectedSources = new Set([...$('build-sources').querySelectorAll('input:checked')].map(value => value.value));
  $('build-sources').replaceChildren();
  for (const source of workspace.sources) {
    const label = node('label', null, 'source-choice'), input = node('input'); input.type = 'checkbox'; input.value = source.id;
    input.checked = selectedSources.has(source.id);
    const description = node('span'); description.append(node('strong', source.name || source.id),
      node('small', source.id + ' · ' + whole(source.summary?.counts?.uniqueRequests) + ' cases · ' + whole(source.summary?.counts?.originalCaptureCount) + ' originals'),
      node('small', fmt(source.summary?.state) + ' · ' + (source.connection?.label || source.connection?.baseUrl || '')));
    label.append(input, description); $('build-sources').append(label);
  }
  if (!workspace.sources.length) empty($('build-sources'), 'Import a complete source collection before building a report.');
  renderReviewSelection();
}
function reportSummaryTable(target, reports) {
  renderTable(target, [
    { label: 'Report', render: row => textPair(row.name, row.definition.period.start + ' → ' + row.definition.period.end) },
    { label: 'Series / profile', render: row => textPair(row.seriesId, row.definition.profileId) },
    { label: 'Cases', className: 'number', render: row => whole(row.totals.intake) },
    { label: 'Issues', className: 'number', render: row => whole(row.totals.calculationIssues) },
    { label: 'Open', className: 'actions-cell', render: row => button('Open report', () => openReport(row.id)) }
  ], reports, 'No saved reports. Import a collection and save its reporting profile to build the first one.');
}
function renderOverview() {
  renderMetrics($('overview-metrics'), [
    ['Source collections', whole(workspace.sources.length)], ['Saved profile revisions', whole(workspace.profiles.length)],
    ['Saved reports', whole(workspace.reports.length)], ['Reviewer returns', whole(workspace.reviews.length)]
  ]);
  renderTable($('overview-series'), [
    { label: 'Series', render: row => row.id },
    { label: 'Current report', render: row => button(workspace.reports.find(report => report.id === row.reportId)?.name || short(row.reportId), () => openReport(row.reportId)) }
  ], workspace.series, 'Report series appear when a report is saved.');
  reportSummaryTable($('overview-reports'), workspace.reports.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8));
}
function renderSources() {
  setText('sources-count', whole(workspace.sources.length) + ' complete original selections');
  renderTable($('sources-table'), [
    { label: 'Source collection', render: row => textPair(row.name || row.id, row.id) },
    { label: 'Jurisdiction / source', render: row => textPair(row.connection?.label || row.connection?.id, row.connection?.baseUrl) },
    { label: 'Coverage', render: row => textPair(fmt(row.summary?.state), whole(row.summary?.counts?.originalCaptureCount) + ' originals · ' + whole(row.summary?.counts?.limitedWindows) + ' limited windows') },
    { label: 'Cases', className: 'number', render: row => whole(row.summary?.counts?.uniqueRequests) },
    { label: 'Original file', render: row => textPair(whole(row.bytes) + ' bytes', short(row.sha256, 18)) },
    { label: 'Inspect', className: 'actions-cell', render: row => button('Open source', () => inspectSource(row.id)) }
  ], workspace.sources, 'Import a complete collection JSON file to retain its source records and coverage.');
}
async function getSource(id) {
  if (!sourceCache.has(id)) sourceCache.set(id, await api(pathFor('/api/source', { id })));
  return sourceCache.get(id);
}
async function inspectSource(id) {
  const source = await getSource(id), value = source.envelope;
  inspect('Original source collection', { id: source.id, sha256: source.sha256, bytes: source.bytes, identity: source.identity,
    connectionIdentity: source.connectionIdentity, collection: value.collection, summary: value.summary,
    originalCaptures: value.originals.map(item => ({ capture: item.capture, receipt: item.receipt, raw: { ...item.raw, body: '(retained in the complete original file)' } })) },
    'The imported text is retained byte for byte. Source connection, original windows and receipt metadata are shown here.',
    [button('Download unchanged original collection', () => downloadText(source.originalText, source.id + '-original.json'))]);
}
function renderWorkspace() {
  const facts = $('workspace-facts'), dl = node('dl', null, 'definition-list');
  for (const [name, value] of [['Workspace ID', workspace.workspaceId], ['Directory', workspace.directory], ['Revision', workspace.revision], ['Created', workspace.createdAt], ['Last saved change', workspace.updatedAt]]) dl.append(node('dt', name), node('dd', value));
  facts.replaceChildren(dl);
  const ready = workspace.revision === 0 && !workspace.sources.length && !workspace.reports.length;
  setText('receive-availability', ready ? 'This is an initialized empty destination. Receiving keeps its workspace identity and imports the complete original records and histories.' : 'Use an initialized empty reporting destination for receiving. This workspace already contains saved work.');
  renderTable($('receiving-history'), [
    { label: 'Original workspace', render: row => row.workspaceId }, { label: 'Original revision', render: row => row.revision },
    { label: 'Package SHA-256', render: row => row.packageSha256 }, { label: 'Received', render: row => row.receivedAt }
  ], workspace.receivedFrom ?? [], 'This workspace has no received package history.');
  renderTable($('operations-table'), [
    { label: 'Saved request', render: row => row.requestId }, { label: 'Action', render: row => row.kind },
    { label: 'Saved at', render: row => row.createdAt }, { label: 'Result', render: row => button('Inspect operation', () => inspectOperation(row.requestId)) }
  ], workspace.operations);
}
async function inspectOperation(requestId) {
  requireValue(requestId, 'Enter the original request ID.');
  const operation = await api(pathFor('/api/operation', { requestId }));
  inspect('Saved reporting operation', operation ?? { requestId, operation: null }, 'The original successful input and result, or an absent request ID.',
    operation && kindPaths[operation.kind] ? [button('Download original command', () => downloadJson({ schema: 'commons.open311-reporting.command.v1', workspaceId: operation.originWorkspaceId ?? workspace.workspaceId,
      path: kindPaths[operation.kind], payload: operation.input, createdAt: operation.createdAt, status: 'confirmed', outcome: operation.result }, 'reporting-command-' + requestId + '.json'))] : []);
}

function setProfileDirty(value = true) {
  profileDirty = value; setText('profile-dirty', value ? 'Unsaved profile draft' : 'Saved profile revision');
}
function statusLabelsText(value) {
  if (Object.keys(value).some(key => /[=\r\n]/.test(key)) || Object.values(value).some(item => /[\r\n]/.test(item))) return JSON.stringify(value, null, 2);
  return Object.entries(value).map(([key, label]) => key + ' = ' + label).join('\n');
}
function readStatusLabels() {
  const value = $('profile-status-mappings').value;
  if (!value.trim()) return {};
  if (value.trim().startsWith('{')) {
    const parsed = parseJson(value, 'Status labels'); requireValue(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'Status labels must be a JSON object.'); return parsed;
  }
  const labels = Object.create(null);
  for (const line of lines(value)) {
    const equals = line.indexOf('='); requireValue(equals >= 0, 'Write each status label as ORIGINAL_STATUS = Reporting label.');
    const key = line.slice(0, equals).trim(), label = line.slice(equals + 1).trim();
    requireValue(key && label, 'A source status and its reporting label must both be present.');
    requireValue(!Object.hasOwn(labels, key), 'A source status label is repeated: ' + key);
    labels[key] = label;
  }
  return labels;
}
function collectProfileBasics() {
  profileDraft = { ...profileDraft, id: $('profile-id').value.trim(), name: $('profile-name').value.trim(),
    revision: numberField('profile-revision', { minimum: 1 }), provider: $('profile-provider').value,
    notes: $('profile-notes').value, statusMappings: readStatusLabels(),
    reviewDeadline: $('profile-deadline-enabled').checked ? { time: $('profile-deadline-time').value,
      timeZone: $('profile-deadline-zone').value.trim(), disambiguation: $('profile-deadline-dst').value } : null };
  return profileDraft;
}
function ensureProfileShape(value) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'The complete profile must be an object.');
  for (const name of ['calendars', 'mappings', 'policies']) requireValue(value[name] === undefined || Array.isArray(value[name]), name + ' must be a complete array.');
  return { ...emptyProfile(), ...clone(value), calendars: clone(value.calendars ?? []), mappings: clone(value.mappings ?? []), policies: clone(value.policies ?? []) };
}
function loadProfileDraft(value, dirty = false) {
  profileDraft = ensureProfileShape(value);
  $('profile-id').value = profileDraft.id; $('profile-name').value = profileDraft.name;
  $('profile-revision').value = profileDraft.revision; $('profile-provider').value = profileDraft.provider;
  $('profile-notes').value = profileDraft.notes || ''; $('profile-status-mappings').value = statusLabelsText(profileDraft.statusMappings ?? {});
  $('profile-deadline-enabled').checked = !!profileDraft.reviewDeadline;
  $('profile-deadline-time').value = profileDraft.reviewDeadline?.time ?? '17:00';
  $('profile-deadline-zone').value = profileDraft.reviewDeadline?.timeZone ?? 'Europe/Helsinki';
  $('profile-deadline-dst').value = profileDraft.reviewDeadline?.disambiguation ?? 'reject';
  renderProfileLists(); setProfileDirty(dirty);
}
function profileJsonFromFields() {
  const value = collectProfileBasics(); $('profile-json').value = JSON.stringify(value, null, 2) + '\n'; return value;
}
function renderProfileLists() {
  renderTable($('calendars-table'), [
    { label: 'Calendar', render: item => textPair(item.name, item.id + '@' + item.revision) },
    { label: 'Time zone / effective dates', render: item => textPair(item.timeZone, (item.effectiveFrom || 'Open start') + ' → ' + (item.effectiveUntil || 'Open end')) },
    { label: 'Working days', render: item => Object.values(item.weeklyIntervals ?? {}).filter(value => value.length).length + ' weekly days · ' + Object.keys(item.dateOverrides ?? {}).length + ' date overrides' },
    { label: 'Edit', className: 'actions-cell', render: item => actionGroup(button('Edit draft', () => editCalendar(item)), button('Remove', () => removeCalendar(item))) }
  ], profileDraft.calendars, 'Add a named working calendar for any business-time target.');
  renderTable($('mappings-table'), [
    { label: 'Mapping', render: item => textPair(item.name, item.id) }, { label: 'Priority', className: 'number', render: item => item.priority },
    { label: 'Selector', render: item => Object.keys(item.selector ?? {}).length ? JSON.stringify(item.selector) : 'All selected cases' },
    { label: 'Service group', render: item => textPair(item.group, item.mappedPriority ? 'Priority label: ' + item.mappedPriority : '') },
    { label: 'Edit', className: 'actions-cell', render: item => actionGroup(button('Edit draft', () => editMapping(item)), button('Remove', () => removeDraftItem('mappings', item.id))) }
  ], profileDraft.mappings, 'Unmapped source services remain visible until an explicit mapping is saved.');
  renderTable($('policies-table'), [
    { label: 'Target policy', render: item => textPair(item.name, item.id + '@' + item.revision) },
    { label: 'Clock / duration', render: item => textPair(item.clockMode, whole(item.durationMinutes) + ' minutes') },
    { label: 'Origin / completion', render: item => textPair(item.origin, item.stop) },
    { label: 'Selector / priority', render: item => textPair(Object.keys(item.selector ?? {}).length ? JSON.stringify(item.selector) : 'All selected cases', 'Priority ' + item.priority) },
    { label: 'Edit', className: 'actions-cell', render: item => actionGroup(button('Edit draft', () => editPolicy(item)), button('Remove', () => removeDraftItem('policies', item.id))) }
  ], profileDraft.policies, 'Add operator targets when reporting against policy due times.');
  chooseOptions('policy-calendar', profileDraft.calendars.map(item => [item.id + '@' + item.revision, item.name + ' · ' + item.id + '@' + item.revision]), 'Choose a retained calendar');
  $('profile-json').value = JSON.stringify(profileDraft, null, 2) + '\n'; updateControls();
}
function removeDraftItem(kind, id) {
  collectProfileBasics(); profileDraft[kind] = profileDraft[kind].filter(item => item.id !== id);
  renderProfileLists(); setProfileDirty(); notify('Removed from the unsaved profile draft.');
}
function removeCalendar(calendar) {
  const key = calendar.id + '@' + calendar.revision;
  const consumers = profileDraft.policies.filter(item => item.calendarKey === key);
  requireValue(!consumers.length, 'Target policies still use this calendar: ' + consumers.map(item => item.name).join(', ') + '. Choose their replacement calendar first.');
  collectProfileBasics(); profileDraft.calendars = profileDraft.calendars.filter(item => item.id + '@' + item.revision !== key);
  renderProfileLists(); setProfileDirty(); notify('Calendar removed from the unsaved profile draft.');
}
function editCalendar(value = null) {
  const calendar = value ?? { id: '', name: '', revision: 1, timeZone: 'Europe/Helsinki',
    weeklyIntervals: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, day > 0 && day < 6 ? [{ start: '09:00', end: '17:00' }] : []])),
    dateOverrides: {}, effectiveFrom: null, effectiveUntil: null, disambiguation: 'reject', sourceReferences: [] };
  $('calendar-id').value = calendar.id; $('calendar-name').value = calendar.name; $('calendar-revision').value = calendar.revision;
  $('calendar-zone').value = calendar.timeZone; $('calendar-from').value = calendar.effectiveFrom || ''; $('calendar-until').value = calendar.effectiveUntil || '';
  $('calendar-dst').value = calendar.disambiguation || 'reject';
  for (let day = 0; day < 7; day++) $('calendar-day-' + day).value = (calendar.weeklyIntervals?.[day] ?? []).map(item => item.start + '-' + item.end).join(', ');
  $('calendar-overrides').value = Object.entries(calendar.dateOverrides ?? {}).map(([date, intervals]) => date + ' = ' + (intervals.length ? intervals.map(item => item.start + '-' + item.end).join(', ') : 'closed')).join('\n');
  $('calendar-references').value = (calendar.sourceReferences ?? []).join('\n');
}
function parseIntervals(value) {
  if (!value.trim() || value.trim().toLowerCase() === 'closed') return [];
  return value.split(',').map(part => {
    const match = /^\s*((?:[01]\d|2[0-3]):[0-5]\d)\s*-\s*((?:[01]\d|2[0-3]):[0-5]\d|24:00)\s*$/.exec(part);
    requireValue(match, 'Use working intervals such as 09:00-12:00, 13:00-17:00. Split overnight work at midnight.');
    return { start: match[1], end: match[2] };
  });
}
function readCalendar() {
  const dateOverrides = {};
  for (const line of lines($('calendar-overrides').value)) {
    const match = /^\s*(\d{4}-\d{2}-\d{2})\s*=\s*(.*?)\s*$/.exec(line);
    requireValue(match, 'Write each date override as YYYY-MM-DD = closed, or YYYY-MM-DD = 09:00-12:00.');
    requireValue(!Object.hasOwn(dateOverrides, match[1]), 'The calendar repeats a date override: ' + match[1]);
    dateOverrides[match[1]] = parseIntervals(match[2]);
  }
  const references = lines($('calendar-references').value).map(value => value.trim()).filter(Boolean);
  requireValue(references.length, 'Name the operator or source that supplied these calendar hours.');
  return { id: $('calendar-id').value.trim(), name: $('calendar-name').value.trim(),
    revision: numberField('calendar-revision', { minimum: 1 }), timeZone: $('calendar-zone').value.trim(),
    weeklyIntervals: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), parseIntervals($('calendar-day-' + day).value)])),
    dateOverrides, effectiveFrom: $('calendar-from').value || null, effectiveUntil: $('calendar-until').value || null,
    disambiguation: $('calendar-dst').value, sourceReferences: references };
}
function addCalendar() {
  collectProfileBasics(); const value = readCalendar(), key = value.id + '@' + value.revision;
  requireValue(value.id && value.name, 'Name the calendar and give it a stable ID.');
  const index = profileDraft.calendars.findIndex(item => item.id + '@' + item.revision === key);
  if (index < 0) profileDraft.calendars.push(value); else profileDraft.calendars[index] = value;
  renderProfileLists(); setProfileDirty(); notify('Calendar added to the profile draft. Save the profile revision to retain it.');
}
function exactSelectorValue(value) {
  if (value === '') return undefined;
  const trimmed = value.trim();
  if (trimmed === 'null' || trimmed.startsWith('[') || trimmed.startsWith('"')) {
    const parsed = parseJson(trimmed, 'An exact selector value');
    requireValue(parsed === null || typeof parsed === 'string' || Array.isArray(parsed) && parsed.every(item => item === null || typeof item === 'string'),
      'Exact selectors use strings, null or arrays of strings and null.');
    return parsed;
  }
  const selected = lines(value); return selected.length > 1 ? selected : selected[0];
}
function selectorValueText(value) {
  if (value === undefined) return '';
  if (value === null || Array.isArray(value) || value === '' || value === 'null' || /^[\["]/.test(value.trim())) return JSON.stringify(value, null, 2);
  return value;
}
function selectorFieldId(prefix, field) { return prefix === 'policy' && field === 'priority' ? 'policy-match-priority' : prefix + '-' + field; }
function selectorFields(prefix) { return ['serviceName', 'agency', 'status', 'serviceRequestId', ...(prefix === 'policy' ? ['group', 'priority', 'reviewStatus'] : [])]; }
function writeSelector(prefix, selected = {}) {
  const code = selected.serviceCode;
  $(prefix + '-service-mode').value = code === undefined ? 'any' : code === null ? 'null' : code === '' ? 'empty' : 'values';
  $(prefix + '-serviceCode').value = code === undefined || code === null || code === '' ? '' : selectorValueText(code);
  $(prefix + '-serviceCode').disabled = $(prefix + '-service-mode').value !== 'values';
  for (const field of selectorFields(prefix)) $(selectorFieldId(prefix, field)).value = selectorValueText(selected[field]);
}
function readSelector(prefix) {
  const result = {}, mode = $(prefix + '-service-mode').value;
  if (mode === 'null') result.serviceCode = null;
  else if (mode === 'empty') result.serviceCode = '';
  else if (mode === 'values') {
    const value = exactSelectorValue($(prefix + '-serviceCode').value);
    requireValue(value !== undefined, 'Enter the exact service-code values, or choose Any service code.'); result.serviceCode = value;
  }
  for (const field of selectorFields(prefix)) {
    const value = exactSelectorValue($(selectorFieldId(prefix, field)).value); if (value !== undefined) result[field] = value;
  }
  return result;
}
function editMapping(value = null) {
  const item = value ?? { id: '', name: '', priority: 0, selector: {}, group: '', mappedPriority: null };
  $('mapping-id').value = item.id; $('mapping-name').value = item.name; $('mapping-priority').value = item.priority;
  $('mapping-group').value = item.group; $('mapping-mapped-priority').value = item.mappedPriority ?? '';
  writeSelector('mapping', item.selector);
}
function addMapping() {
  collectProfileBasics();
  const value = { id: $('mapping-id').value.trim(), name: $('mapping-name').value.trim(), priority: numberField('mapping-priority'),
    selector: readSelector('mapping'), group: $('mapping-group').value.trim(), mappedPriority: $('mapping-mapped-priority').value || null };
  requireValue(value.id && value.name && value.group, 'Give the mapping an ID, a name and a service group.');
  const index = profileDraft.mappings.findIndex(item => item.id === value.id);
  if (index < 0) profileDraft.mappings.push(value); else profileDraft.mappings[index] = value;
  renderProfileLists(); setProfileDirty(); notify('Service mapping added to the profile draft.');
}
function editPolicy(value = null) {
  const item = value ?? { id: '', name: '', revision: 1, priority: 0, selector: {}, durationMinutes: '',
    clockMode: 'elapsed', calendarKey: '', origin: 'requestedAt', stop: 'asOf', sourceReferences: [] };
  for (const field of ['id', 'name', 'revision', 'priority']) $('policy-' + field).value = item[field];
  $('policy-duration').value = item.durationMinutes; $('policy-clock').value = item.clockMode; $('policy-calendar').value = item.calendarKey || '';
  $('policy-origin').value = item.origin; $('policy-stop').value = item.stop;
  $('policy-references').value = (item.sourceReferences ?? []).join('\n'); writeSelector('policy', item.selector); updateControls();
}
function addPolicy() {
  collectProfileBasics();
  const references = lines($('policy-references').value).map(value => value.trim()).filter(Boolean);
  requireValue(references.length, 'Name the operator or source that supplied this target policy.');
  const value = { id: $('policy-id').value.trim(), name: $('policy-name').value.trim(),
    revision: numberField('policy-revision', { minimum: 1 }), priority: numberField('policy-priority'),
    selector: readSelector('policy'), durationMinutes: numberField('policy-duration', { integer: false, minimum: 0, maximum: 5256000 }),
    clockMode: $('policy-clock').value, calendarKey: $('policy-clock').value === 'business' ? $('policy-calendar').value : null,
    origin: $('policy-origin').value, stop: $('policy-stop').value, sourceReferences: references };
  requireValue(value.id && value.name, 'Give the target policy an ID and a name.');
  requireValue(value.clockMode !== 'business' || value.calendarKey, 'Select the saved calendar revision for this business-time target.');
  const index = profileDraft.policies.findIndex(item => item.id === value.id);
  if (index < 0) profileDraft.policies.push(value); else profileDraft.policies[index] = value;
  renderProfileLists(); setProfileDirty(); notify('Target policy added to the profile draft.');
}
async function openProfile() {
  requireValue($('profile-select').value, 'Choose a saved profile revision.');
  const value = workspace.profiles.find(item => keyOfProfile(item) === $('profile-select').value) ??
    await api(pathFor('/api/profile', { id: $('profile-select').value }));
  loadProfileDraft(value); notify('Opened the retained profile revision. Save changes under a new revision.');
}
function nextProfileRevision() {
  collectProfileBasics(); requireValue(profileDraft.id, 'Name the profile before creating its next revision.');
  const revisions = workspace.profiles.filter(item => item.id === profileDraft.id).map(item => item.revision);
  profileDraft.revision = Math.max(profileDraft.revision, ...revisions, 0) + 1; loadProfileDraft(profileDraft, true);
}
async function saveProfile() {
  const value = clone(profileJsonFromFields());
  requireValue(value.id && value.name, 'Give the profile a stable ID and a name.');
  const result = await mutate('/api/profile', { profile: value });
  if (result) {
    $('profile-select').value = result.profileId; $('build-profile').value = result.profileId;
    const saved = workspace.profiles.find(item => keyOfProfile(item) === result.profileId); if (saved) loadProfileDraft(saved);
  }
}
function readDefinition() {
  const sourceIds = [...$('build-sources').querySelectorAll('input:checked')].map(item => item.value);
  requireValue(sourceIds.length, 'Select at least one complete source collection.');
  requireValue($('build-profile').value, 'Select a saved profile revision.');
  const start = instantField('build-start'), end = instantField('build-end');
  requireValue(Date.parse(end) > Date.parse(start), 'The report period end must be after its start.');
  return { name: $('build-name').value.trim(), seriesId: $('build-series').value.trim(), sourceIds,
    profileId: $('build-profile').value, period: { start, end }, asOf: instantField('build-asof'),
    displayTimeZone: $('build-zone').value.trim(), cohort: 'requestedAt', targetBasis: $('build-target').value,
    filters: Object.fromEntries(['group', 'status', 'reviewStatus', 'assignee'].map(field => [field, lines($('build-filter-' + field).value)])),
    commentary: $('build-commentary').value };
}
function loadDefinition(value) {
  requireValue(value && value.period && Array.isArray(value.sourceIds), 'Load a complete report definition.');
  const absent = value.sourceIds.filter(id => !workspace.sources.some(source => source.id === id));
  requireValue(!absent.length, 'Import the original source collections required by this definition first: ' + absent.join(', '));
  requireValue(workspace.profiles.some(profile => keyOfProfile(profile) === value.profileId), 'Save or receive the definition’s original profile revision first: ' + value.profileId);
  $('build-name').value = value.name ?? ''; $('build-series').value = value.seriesId ?? '';
  $('build-profile').value = value.profileId; $('build-zone').value = value.displayTimeZone ?? 'UTC';
  $('build-start').value = value.period.start; $('build-end').value = value.period.end;
  $('build-asof').value = value.asOf; $('build-target').value = value.targetBasis;
  for (const element of $('build-sources').querySelectorAll('input')) element.checked = value.sourceIds.includes(element.value);
  for (const field of ['group', 'status', 'reviewStatus', 'assignee']) $('build-filter-' + field).value = (value.filters?.[field] ?? []).join('\n');
  $('build-commentary').value = value.commentary ?? ''; switchView('build');
}
async function sourcePeriod() {
  const sourceIds = [...$('build-sources').querySelectorAll('input:checked')].map(item => item.value);
  requireValue(sourceIds.length, 'Choose complete source collections first.');
  const sources = [];
  for (const id of sourceIds) sources.push(await getSource(id));
  const starts = sources.map(source => source.envelope.collection.query.start_date).filter(value => Number.isFinite(Date.parse(value)));
  const ends = sources.map(source => source.envelope.collection.query.end_date).filter(value => Number.isFinite(Date.parse(value)));
  const observations = sources.flatMap(source => source.envelope.originals.map(value => value.capture.capturedAt)).filter(value => Number.isFinite(Date.parse(value)));
  requireValue(starts.length && ends.length, 'The selected original source has no complete requested-date interval.');
  $('build-start').value = new Date(Math.min(...starts.map(value => Date.parse(value)))).toISOString();
  $('build-end').value = new Date(Math.max(...ends.map(value => Date.parse(value)))).toISOString();
  if (observations.length) $('build-asof').value = new Date(Math.max(...observations.map(value => Date.parse(value)))).toISOString();
  notify('Copied the selected source window and latest retained observation time. Review these explicit report settings before saving.');
}
async function saveReport() {
  const definition = readDefinition(); requireValue(definition.name && definition.seriesId, 'Name the report and its series.');
  const result = await mutate('/api/build', { definition }); if (result) await openReport(result.reportId);
}

async function getReport(id) {
  requireValue(id, 'Select a saved report.');
  if (!reportCache.has(id)) {
    const value = await api(pathFor('/api/report', { id }));
    requireValue(value?.schema === 'commons.open311.service-report.v1' && Array.isArray(value.rows), 'The retained report is incomplete.');
    reportCache.set(id, value);
  }
  return reportCache.get(id);
}
async function openReport(id = $('report-select').value) {
  const sequence = ++reportRequest, value = await getReport(id); if (sequence !== reportRequest) return;
  report = value; reportPage = 0; $('report-select').value = value.id; renderReport(); switchView('reports');
}
function renderReport() {
  $('report-empty').hidden = !!report; $('report-content').hidden = !report; if (!report) return;
  setText('report-title', report.definition.name);
  setText('report-period', report.definition.period.start + ' ≤ requested < ' + report.definition.period.end + ' · observed as of ' + report.definition.asOf);
  setText('report-identity', report.id + ' · SHA-256 ' + report.sha256);
  setText('report-interpretation', report.interpretation);
  setText('report-commentary', report.commentary || 'No management commentary saved.');
  const totals = report.totals;
  renderMetrics($('report-metrics'), [
    ['Cases in period', whole(totals.intake), whole(totals.filtered) + ' excluded by saved filters'],
    ['Completed on time', ratioText(totals.completedOnTime), ratioNote(totals.completedOnTime) + ' completed cases'],
    ['Open overdue', ratioText(totals.openOverdue), ratioNote(totals.openOverdue) + ' assessed open cases'],
    ['Currently within target', ratioText(totals.currentlyWithinTarget), ratioNote(totals.currentlyWithinTarget) + ' assessed cases'],
    ['Unassessed targets', whole(totals.unassessedTargets), 'Selected target unavailable or invalid'],
    ['Calculation issues', whole(totals.calculationIssues), whole(totals.staleReviews) + ' reviews name an earlier source version']
  ]);
  renderCoverage(); renderGroups();
  chooseOptions('report-filter-group', [...new Set(report.rows.map(row => row.group))].sort().map(value => [value, value]), 'All service groups');
  chooseOptions('report-filter-status', [...new Set(report.rows.map(row => row.sourceStatus))].sort().map(value => [JSON.stringify(value ?? null), fmt(value)]), 'All original statuses');
  chooseOptions('report-filter-target', Object.entries(targetNames), 'All target states');
  chooseOptions('report-filter-review', [...new Set(report.rows.map(row => row.reviewStatus))].sort().map(value => [value, value]), 'All review states');
  renderReportRows();
}
function renderCoverage() {
  const target = $('report-coverage'); target.replaceChildren();
  for (const coverage of report.coverage) {
    const section = node('section'), heading = node('div', null, 'section-heading');
    heading.append(textPair(coverage.connection.label || coverage.connection.id, coverage.sourceId),
      actionGroup(button('Inspect original source', () => inspectSource(coverage.sourceId))));
    section.append(heading);
    const query = node('p', coverage.query.start_date + ' → ' + coverage.query.end_date, 'mono');
    const counts = coverage.summary.counts;
    section.append(query, node('p', fmt(coverage.summary.state) + ' · ' + whole(counts.originalCaptureCount) + ' original responses · ' +
      whole(counts.uniqueRequests) + ' source cases · ' + whole(counts.changedRequests) + ' changed cases · ' + whole(counts.limitedWindows) + ' limited windows', 'help'));
    if (coverage.unresolvedWindows.length) {
      const details = node('details'), summary = node('summary', whole(coverage.unresolvedWindows.length) + ' unresolved or unfinished source windows');
      const table = node('div');
      renderTable(table, [
        { label: 'Window', render: item => item.id }, { label: 'Start', render: item => item.startDate },
        { label: 'End', render: item => item.endDate }, { label: 'State / problem', render: item => textPair(item.state, item.problem?.code || item.problem || item.lastError?.message || '') },
        { label: 'Original capture', render: item => item.captureId ?? 'No capture saved' }
      ], coverage.unresolvedWindows);
      details.append(summary, table); section.append(details);
    }
    const attribution = coverage.connection.attribution;
    if (attribution) section.append(node('p', [attribution.publisher, attribution.title, attribution.license].filter(Boolean).join(' · '), 'help'));
    target.append(section);
  }
}
function renderGroups() {
  const names = { service: 'Service groups', sourceStatus: 'Original source statuses', reportingStatus: 'Reporting labels',
    review: 'Internal review states', assignee: 'Assigned operators', target: 'Target states' };
  $('report-groups').replaceChildren();
  for (const [key, title] of Object.entries(names)) {
    const section = node('section'), table = node('div'); section.append(node('h4', title));
    renderTable(table, [{ label: 'Group', render: item => key === 'target' ? targetNames[item.name] || item.name : item.name },
      { label: 'Cases', className: 'number', render: item => whole(item.count) }], report.groups[key] ?? [], 'No cases in this grouping.');
    section.append(table); $('report-groups').append(section);
  }
}
function selectedReportRows() {
  if (!report) return [];
  const query = $('report-search').value.trim().toLocaleLowerCase(), group = $('report-filter-group').value,
    status = $('report-filter-status').value, target = $('report-filter-target').value, review = $('report-filter-review').value;
  return report.rows.filter(row => (!group || row.group === group) && (!status || JSON.stringify(row.sourceStatus ?? null) === status) &&
    (!target || row.target.state === target) && (!review || row.reviewStatus === review) &&
    (!$('report-issues-only').checked || row.issues.length) &&
    (!query || [row.serviceRequestId, row.description, row.address, row.agency, row.assignee, row.group, row.sourceStatus].map(value => fmt(value)).join('\n').toLocaleLowerCase().includes(query)));
}
function renderReportRows() {
  const rows = selectedReportRows(), pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); reportPage = Math.min(reportPage, pages - 1);
  setText('report-row-count', whole(rows.length) + ' displayed of ' + whole(report?.rows.length) + ' saved cases');
  renderTable($('report-rows'), [
    { label: 'Source case', render: row => textPair(row.serviceRequestId, short(row.description || row.address, 115)) },
    { label: 'Service / source status', render: row => textPair(row.group, fmt(row.sourceStatus) + (row.reportingStatus !== row.sourceStatus ? ' · ' + row.reportingStatus : '')) },
    { label: 'Internal review', render: row => textPair(row.reviewStatus, row.assignee || 'Unassigned') },
    { label: 'Target', render: row => textPair(targetNames[row.target.state] || row.target.state, row.target.dueAt ? dateTime(row.target.dueAt) : row.target.reason) },
    { label: 'Issues / source editions', render: row => textPair(whole(row.issues.length) + ' issues', whole(row.versionCount) + ' versions · ' + whole(row.observationCount) + ' observations') },
    { label: 'Case', className: 'actions-cell', render: row => { const result = button('Open case', () => inspectCase(row)); result.dataset.caseKey = row.key; return result; } }
  ], rows.slice(reportPage * PAGE_SIZE, (reportPage + 1) * PAGE_SIZE), 'No retained cases match these display filters.');
  setText('report-page', 'Page ' + (reportPage + 1) + ' of ' + pages);
  $('report-prev').disabled = reportPage === 0; $('report-next').disabled = reportPage + 1 >= pages;
}
function inspectCase(row) {
  inspect('Source case ' + row.serviceRequestId, {
    serviceRequestId: row.serviceRequestId, key: row.key, sourceSha256: row.sourceSha256,
    requestedAt: row.requestedAt, updatedAt: row.updatedAt, expectedAt: row.expectedAt,
    sourceStatus: row.sourceStatus, reportingStatus: row.reportingStatus, serviceGroup: row.group,
    mappedPriority: row.priority, mappingId: row.mappingId, assignee: row.assignee,
    internalReview: row.review, reviewNeedsRebase: row.reviewNeedsRebase,
    target: row.target, policyId: row.policyId, sourceExpectedAt: row.sourceExpectedAt, reviewDueAt: row.reviewDueAt, policyDueAt: row.policyDueAt,
    ageMinutes: row.ageMinutes, resolutionMinutes: row.resolutionMinutes, businessMinutes: row.businessMinutes,
    calculationIssues: row.issues, reviewerComment: report.requestComments[row.key] ?? null,
    sourceSelection: { sourceId: row.sourceId, captureId: row.captureId, observedAt: row.observedAt,
      sourceSha256: row.sourceSha256, occurrenceCount: row.observationCount, versionCount: row.versionCount, occurrences: row.occurrences },
    originalSource: row.source
  }, 'The source case, its exact retained version, target calculation and internal review are shown together.',
  [button('Open retained source collection', () => inspectSource(row.sourceId)),
    button('Prepare source-linked reviewer comment', () => startCaseComment(row))]);
}
async function runComparison(before = $('compare-before').value, after = $('compare-after').value) {
  requireValue(before && after && before !== after, 'Choose two different saved report editions.');
  comparison = await api(pathFor('/api/compare', { before, after }));
  const original = await getReport(before), next = await getReport(after);
  renderComparison(comparison, original, next); $('compare-before').value = before; $('compare-after').value = after;
  switchView('reports'); return comparison;
}
function renderComparison(value, before, after) {
  const target = $('compare-result'); target.replaceChildren();
  target.append(node('h4', before.definition.name + ' → ' + after.definition.name));
  if (value.configurationChanged) target.append(node('p', 'The saved profile configuration changed between these reports. Inspect both profile revisions alongside the period totals.', 'comparison-config'));
  const facts = node('div', null, 'metrics'); renderMetrics(facts, [
    ['Cases added to selection', whole(value.added.length)], ['Absent from later selection', whole(value.absent.length)],
    ['Matched cases changed', whole(value.changed.length)]
  ]); target.append(facts);
  const totals = node('div');
  renderTable(totals, [
    { label: 'Measure', render: row => row.label }, { label: 'Earlier / base', render: row => row.before }, { label: 'Later', render: row => row.after }
  ], [
    { label: 'Reporting period', before: before.definition.period.start + ' → ' + before.definition.period.end, after: after.definition.period.start + ' → ' + after.definition.period.end },
    { label: 'Observation cutoff', before: before.definition.asOf, after: after.definition.asOf },
    { label: 'Profile edition', before: before.profileId, after: after.profileId },
    { label: 'Cases in period', before: whole(before.totals.intake), after: whole(after.totals.intake) },
    { label: 'Completed on time', before: ratioText(before.totals.completedOnTime) + ' (' + ratioNote(before.totals.completedOnTime) + ')', after: ratioText(after.totals.completedOnTime) + ' (' + ratioNote(after.totals.completedOnTime) + ')' },
    { label: 'Open overdue', before: ratioText(before.totals.openOverdue) + ' (' + ratioNote(before.totals.openOverdue) + ')', after: ratioText(after.totals.openOverdue) + ' (' + ratioNote(after.totals.openOverdue) + ')' },
    { label: 'Calculation issues', before: whole(before.totals.calculationIssues), after: whole(after.totals.calculationIssues) }
  ]); target.append(totals);
  const changed = node('div'); renderTable(changed, [
    { label: 'Matched source case', render: row => row.serviceRequestId },
    { label: 'Changed fields', render: row => row.fields.join(', ') },
    { label: 'Inspect', render: row => button('Inspect both editions', () => inspect('Changed source case ' + row.serviceRequestId, row)) }
  ], value.changed, 'No matched case has a changed retained calculation.');
  const details = node('details'); details.append(node('summary', 'Changed source cases'), changed); target.append(details);
  const added = new Map(after.rows.map(row => [row.key, row.serviceRequestId])), absent = new Map(before.rows.map(row => [row.key, row.serviceRequestId]));
  const selection = node('details'); selection.append(node('summary', 'Source identities entering or leaving the report selection'),
    node('pre', JSON.stringify({ added: value.added.map(key => ({ key, serviceRequestId: added.get(key) })),
      absent: value.absent.map(key => ({ key, serviceRequestId: absent.get(key) })) }, null, 2)));
  target.append(selection, actionGroup(button('Download complete comparison', () => downloadJson(value, 'report-comparison-' + short(before.id) + '-' + short(after.id) + '.json')),
    button('Inspect definitions and source coverage', () => inspect('Report comparison definitions', { before: value.before, after: value.after, configurationChanged: value.configurationChanged }))));
}
let reviewCurrentReport = null;
function renderReviewDraft() {
  setText('review-draft-base', reviewDraft ? reviewDraft.baseReportId + ' · SHA-256 ' + reviewDraft.baseReportSha256 : 'Choose a base report or load its reviewer template.');
  chooseOptions('review-comment-request', (reviewDraft?.availableRequests ?? []).map(row => [row.key, row.serviceRequestId + ' · ' + short(row.sourceSha256)]), 'Choose the exact source case');
  $('review-author').value = reviewDraft?.reviewer ?? $('review-author').value;
  renderTable($('review-draft-changes'), [
    { label: 'Change', render: row => textPair(row.kind === 'report-comment' ? 'Management commentary' : 'Source case comment',
      row.kind === 'request-comment' ? reviewDraft.availableRequests.find(item => item.key === row.key)?.serviceRequestId || row.key : row.id) },
    { label: 'Comment', render: row => node('span', row.comment || '(clear saved comment)', 'preserve') },
    { label: 'Remove from draft', render: row => button('Remove change', () => { reviewDraft.changes = reviewDraft.changes.filter(item => item.id !== row.id); renderReviewDraft(); }) }
  ], reviewDraft?.changes ?? [], 'Add individual comments to the reviewer return draft.');
  $('review-draft-download').disabled = !reviewDraft;
  updateControls();
}
async function startReviewDraft(reportId = $('review-compose-report').value) {
  const selected = await getReport(reportId);
  reviewDraft = { schema: 'commons.open311.report-review.v1', baseReportId: selected.id, baseReportSha256: selected.sha256,
    reviewer: $('review-author').value.trim(), changes: [],
    availableRequests: selected.rows.map(row => ({ key: row.key, serviceRequestId: row.serviceRequestId, sourceSha256: row.sourceSha256 })) };
  $('review-compose-report').value = selected.id; renderReviewDraft();
  notify('Started a reviewer return tied to the selected report and its original source versions.');
}
async function startCaseComment(row) {
  if (!reviewDraft || reviewDraft.baseReportId !== report.id) await startReviewDraft(report.id);
  $('review-comment-kind').value = 'request-comment'; $('review-comment-request').value = row.key;
  $('review-comment-text').value = report.requestComments[row.key]?.comment || '';
  $('review-comment-clear').checked = false; $('review-comment-text').disabled = false;
  $('inspector').close(); switchView('reviews'); updateControls(); $('review-comment-text').focus();
}
function addReviewComment() {
  requireValue(reviewDraft, 'Start a reviewer return for a saved report or load its template.');
  const kind = $('review-comment-kind').value, comment = $('review-comment-clear').checked ? '' : $('review-comment-text').value;
  requireValue(comment !== '' || $('review-comment-clear').checked, 'Write the comment, or explicitly choose to clear the saved comment.');
  const change = { id: crypto.randomUUID(), kind, comment };
  if (kind === 'request-comment') {
    const row = reviewDraft.availableRequests.find(item => item.key === $('review-comment-request').value);
    requireValue(row, 'Choose the exact source case for this comment.'); change.key = row.key; change.sourceSha256 = row.sourceSha256;
  }
  const existing = reviewDraft.changes.find(item => item.kind === kind && (kind === 'report-comment' || item.key === change.key));
  if (existing) { change.id = existing.id; reviewDraft.changes[reviewDraft.changes.indexOf(existing)] = change; }
  else reviewDraft.changes.push(change);
  reviewDraft.reviewer = $('review-author').value.trim(); renderReviewDraft();
  $('review-comment-text').value = ''; $('review-comment-clear').checked = false; $('review-comment-text').disabled = false;
  notify('Comment added to the reviewer return draft.');
}
function fullReviewDraft() {
  requireValue(reviewDraft && reviewDraft.changes.length, 'Add at least one selected reviewer comment.');
  reviewDraft.reviewer = $('review-author').value.trim(); requireValue(reviewDraft.reviewer, 'Name the reviewer before exporting or importing the return.');
  return clone(reviewDraft);
}
async function importDraftReview() {
  const value = fullReviewDraft(), result = await mutate('/api/review-import', { originalText: JSON.stringify(value, null, 2) + '\n' });
  if (result) { $('review-select').value = result.reviewId; await openReview(result.reviewId); }
}
async function openReview(id = $('review-select').value) {
  requireValue(id, 'Choose a retained reviewer return.');
  const sequence = ++reviewRequest, value = await api(pathFor('/api/review', { id })); if (sequence !== reviewRequest) return;
  requireValue(value?.review?.schema === 'commons.open311.report-review.v1', 'The retained reviewer return is incomplete.');
  reviewReturn = value; $('review-select').value = value.id;
  const base = workspace.reports.find(item => item.id === value.review.baseReportId);
  const head = workspace.series.find(item => item.id === base?.seriesId);
  reviewCurrentReport = head ? await getReport(head.reportId) : null; if (sequence !== reviewRequest) return;
  renderReviewSelection(); switchView('reviews');
}
function renderReviewSelection() {
  const target = $('review-changes'), previous = new Set([...target.querySelectorAll('input:checked')].map(item => item.value));
  target.replaceChildren(); $('review-selected-meta').replaceChildren();
  const priorSelection = $('review-rebase').value;
  $('review-rebase').replaceChildren(new Option('Use original base if it is still current', ''));
  if (!reviewReturn || !workspace) { empty(target, 'Open a retained reviewer return to inspect and select changes.'); return; }
  const value = reviewReturn.review, base = workspace.reports.find(item => item.id === value.baseReportId),
    head = workspace.series.find(item => item.id === base?.seriesId);
  $('review-selected-meta').append(node('p', value.reviewer + ' · base ' + value.baseReportId + ' · ' + value.changes.length + ' returned changes'),
    node('p', 'Original file SHA-256 ' + reviewReturn.sha256, 'mono'));
  if (head && head.reportId !== value.baseReportId) {
    $('review-rebase').append(new Option('Rebase selected comments to current report ' + short(head.reportId), head.reportId));
    if (priorSelection === head.reportId) $('review-rebase').value = priorSelection;
    $('review-selected-meta').append(node('p', 'This report series has a newer saved edition. Inspect the comparison and explicitly select the current report before applying compatible comments.', 'comparison-config'));
  }
  const applied = new Set(reviewCurrentReport?.id === head?.reportId
    ? reviewCurrentReport.reviewerHistory.filter(item => item.reviewId === reviewReturn.id).flatMap(item => item.changeIds) : []);
  for (const change of value.changes) {
    const section = node('div', null, 'review-change'), label = node('label', null, 'check'), input = node('input');
    input.type = 'checkbox'; input.value = change.id; input.checked = previous.has(change.id) && !applied.has(change.id); input.disabled = applied.has(change.id);
    const heading = node('span'); heading.append(node('strong', change.kind === 'report-comment' ? 'Management commentary' : 'Source case comment'),
      node('span', ' · ' + change.id, 'mono'));
    if (change.key) heading.append(node('p', 'Source key ' + change.key + ' · version ' + change.sourceSha256, 'help'));
    if (applied.has(change.id)) heading.append(node('p', 'Already incorporated into the current report edition.', 'help'));
    label.append(input, heading); section.append(label, node('pre', change.comment || '(clear saved comment)')); target.append(section);
  }
}
async function applySelectedReview() {
  requireValue(reviewReturn, 'Open the original reviewer return.');
  const changeIds = [...$('review-changes').querySelectorAll('input:checked')].map(item => item.value);
  requireValue(changeIds.length, 'Select the individual reviewer changes to apply.');
  const rebase = $('review-rebase').value, selection = { reviewId: reviewReturn.id, changeIds, ...(rebase ? { rebaseToReportId: rebase } : {}) };
  const result = await mutate('/api/review-apply', { selection });
  if (result) { await openReview(reviewReturn.id); await openReport(result.reportId); }
}
async function compareReviewBase() {
  requireValue(reviewReturn, 'Open a reviewer return.');
  const base = workspace.reports.find(item => item.id === reviewReturn.review.baseReportId),
    head = workspace.series.find(item => item.id === base?.seriesId);
  requireValue(head && head.reportId !== base.id, 'The original base is still the current report edition.');
  return runComparison(base.id, head.reportId);
}

function onClick(id, action) { $(id).addEventListener('click', () => safely(action)); }
function onSubmit(id, action) { $(id).addEventListener('submit', event => { event.preventDefault(); safely(action); }); }
function fileSummary(inputId, summaryId) {
  $(inputId).addEventListener('change', () => {
    const file = $(inputId).files?.[0]; setText(summaryId, file ? file.name + ' · ' + whole(file.size) + ' bytes' : '');
  });
}
async function bootstrap() {
  for (const element of document.querySelectorAll('[data-view]')) element.addEventListener('click', () => safely(() => switchView(element.dataset.view)));
  for (const element of document.querySelectorAll('[data-go]')) element.addEventListener('click', () => safely(() => switchView(element.dataset.go)));
  onClick('refresh-state', async () => { await refreshState(); notify('Opened the current saved workspace revision.'); });
  onClick('inspector-close', () => $('inspector').close());
  onClick('pending-inspect', inspectPending); onClick('pending-retry', submitOriginal); onClick('pending-close', closePending);
  onClick('pending-download', () => downloadJson(pending, 'reporting-command-' + pending.payload.requestId + '.json'));
  for (const [input, summary] of [['source-file', 'source-file-summary'], ['review-file', 'review-file-summary'], ['receive-file', 'receive-file-summary']]) fileSummary(input, summary);
  onSubmit('source-form', async () => {
    const file = await readTextFile($('source-file'), 'the complete source collection JSON'), value = parseJson(file.text);
    requireValue(value.schema === 'commons.open311.collection-export.v1', 'Choose a complete source collection export from municipal operations.');
    const result = await mutate('/api/import', { originalText: file.text });
    if (result) {
      $('source-file').value = ''; setText('source-file-summary', 'Imported ' + file.name + ' · ' + result.sourceId);
      for (const item of $('build-sources').querySelectorAll('input')) if (item.value === result.sourceId) item.checked = true;
    }
  });
  onClick('profile-new', () => { loadProfileDraft(emptyProfile(), true); editCalendar(); editMapping(); editPolicy(); });
  onClick('profile-load', openProfile); onClick('profile-clone', nextProfileRevision); onClick('profile-save', saveProfile);
  onClick('profile-copy-json', () => { profileJsonFromFields(); notify('Complete JSON refreshed from the visual profile draft.'); });
  onClick('profile-apply-json', () => { loadProfileDraft(parseJson($('profile-json').value, 'The profile draft'), true); notify('Complete JSON applied to the profile draft.'); });
  onClick('profile-download', () => downloadJson(profileJsonFromFields(), 'service-profile-' + (profileDraft.id || 'draft') + '-' + profileDraft.revision + '.json'));
  $('profile-file').addEventListener('change', () => safely(async () => {
    const file = await readTextFile($('profile-file'), 'a complete profile file'); loadProfileDraft(parseJson(file.text), true);
    $('profile-file').value = ''; notify('Loaded the complete profile into an unsaved draft.');
  }));
  for (const input of document.querySelectorAll('[data-panel="rules"] input,[data-panel="rules"] textarea,[data-panel="rules"] select'))
    input.addEventListener('input', () => setProfileDirty());
  onClick('calendar-new', () => editCalendar()); onSubmit('calendar-form', addCalendar);
  onClick('mapping-new', () => editMapping()); onSubmit('mapping-form', addMapping);
  onClick('policy-new', () => editPolicy()); onSubmit('policy-form', addPolicy);
  $('policy-clock').addEventListener('change', updateControls);
  for (const prefix of ['mapping', 'policy']) $(prefix + '-service-mode').addEventListener('change', () => {
    $(prefix + '-serviceCode').disabled = $(prefix + '-service-mode').value !== 'values';
  });
  onSubmit('build-form', saveReport); onClick('build-source-period', sourcePeriod);
  onClick('build-asof-now', () => { $('build-asof').value = new Date().toISOString(); notify('The report cutoff is now an explicit current timestamp.'); });
  onClick('build-download', () => downloadJson(readDefinition(), 'service-report-definition.json'));
  $('build-file').addEventListener('change', () => safely(async () => {
    const file = await readTextFile($('build-file'), 'the complete report definition'); loadDefinition(parseJson(file.text));
    $('build-file').value = ''; notify('Loaded the exact saved report definition.');
  }));
  onClick('report-open', () => openReport()); onClick('report-rebuild', () => { requireValue(report, 'Open a saved report first.'); loadDefinition(report.definition); });
  for (const element of document.querySelectorAll('[data-report-export]')) element.addEventListener('click', () => safely(() => downloadExport(element.dataset.reportExport, report?.id)));
  for (const id of ['report-search', 'report-filter-group', 'report-filter-status', 'report-filter-target', 'report-filter-review', 'report-issues-only'])
    $(id).addEventListener(id === 'report-search' ? 'input' : 'change', () => { reportPage = 0; renderReportRows(); });
  onClick('report-prev', () => { reportPage = Math.max(0, reportPage - 1); renderReportRows(); });
  onClick('report-next', () => { reportPage++; renderReportRows(); });
  onClick('report-inspect-definition', () => inspect('Saved report definition and profile', { definition: report.definition, profile: report.profile, totals: report.totals, calculationRuntime: report.calculationRuntime }));
  onClick('report-inspect-calendars', () => inspect('Resolved calendar intervals', report.resolvedCalendarIntervals, 'Exact local and UTC intervals retained with this calculation.'));
  onClick('report-inspect-history', () => inspect('Saved reviewer history', { commentary: report.commentary, requestComments: report.requestComments, reviewerHistory: report.reviewerHistory }));
  onSubmit('compare-form', () => runComparison());
  onClick('review-compose-start', () => startReviewDraft());
  $('review-author').addEventListener('input', () => { if (reviewDraft) reviewDraft.reviewer = $('review-author').value; });
  $('review-comment-kind').addEventListener('change', updateControls);
  $('review-comment-clear').addEventListener('change', () => { $('review-comment-text').disabled = $('review-comment-clear').checked; });
  onSubmit('review-comment-form', addReviewComment);
  onClick('review-draft-download', () => downloadJson(fullReviewDraft(), 'review-return-' + short(reviewDraft.baseReportId) + '.json'));
  onClick('review-draft-import', importDraftReview);
  $('review-template-file').addEventListener('change', () => safely(async () => {
    const file = await readTextFile($('review-template-file'), 'a complete reviewer template'), value = parseJson(file.text);
    requireValue(value.schema === 'commons.open311.report-review.v1' && typeof value.baseReportId === 'string' &&
      /^[a-f0-9]{64}$/.test(value.baseReportSha256 || '') && Array.isArray(value.availableRequests) &&
      value.availableRequests.every(row => typeof row.key === 'string' && typeof row.serviceRequestId === 'string' && /^[a-f0-9]{64}$/.test(row.sourceSha256 || '')),
      'Load the complete reviewer template with its base report hash and exact available source requests.');
    reviewDraft = { ...clone(value), reviewer: value.reviewer ?? '', changes: value.changes ?? [] };
    requireValue(Array.isArray(reviewDraft.changes), 'Reviewer changes must be an array.'); renderReviewDraft();
    $('review-template-file').value = ''; notify('Loaded the reviewer draft tied to its original report and source versions.');
  }));
  onSubmit('review-import-form', async () => {
    const file = await readTextFile($('review-file'), 'the complete reviewer return'), value = parseJson(file.text);
    requireValue(value.schema === 'commons.open311.report-review.v1', 'Choose the original returned review JSON file.');
    const result = await mutate('/api/review-import', { originalText: file.text });
    if (result) { $('review-file').value = ''; setText('review-file-summary', 'Retained ' + file.name); await openReview(result.reviewId); }
  });
  onClick('review-open', () => openReview()); onSubmit('review-apply-form', applySelectedReview); onClick('review-compare', compareReviewBase);
  onClick('review-original-download', () => { requireValue(reviewReturn, 'Open the original reviewer return.'); downloadText(reviewReturn.originalText, reviewReturn.id + '-original.json'); });
  onClick('workspace-export', () => downloadExport('workspace'));
  onSubmit('receive-form', async () => {
    const file = await readTextFile($('receive-file'), 'the complete reporting workspace package'), value = parseJson(file.text);
    requireValue(value.schema === 'commons.open311.reporting-workspace.v1', 'Choose a complete service-performance reporting workspace package.');
    requireValue(workspace.revision === 0, 'Receive into an initialized empty reporting workspace.');
    const result = await mutate('/api/receive', { originalText: file.text });
    if (result) {
      $('receive-file').value = ''; setText('receive-file-summary', 'Received ' + file.name + ' from original workspace ' + result.originalWorkspaceId);
      if (result.selectedReportId) await openReport(result.selectedReportId);
    }
  });
  onSubmit('operation-form', () => inspectOperation($('operation-id').value.trim()));
  $('command-file').addEventListener('change', () => safely(async () => {
    requireValue(!busy && !pending, 'Resolve this browser’s current original command before restoring another.');
    const file = await readTextFile($('command-file'), 'a downloaded original command'), value = parseJson(file.text);
    requireValue(validCommand(value), 'The command must identify this workspace, a supported reporting action and its original revision.');
    const restored = { ...clone(value), status: 'uncertain', outcome: null };
    await retainedCommand('write', restored); pending = restored; renderPending(); $('command-file').value = '';
    notify('Restored the complete original command. Inspect its saved result or retry that exact input.');
  }));
  loadProfileDraft(emptyProfile(), true); editCalendar(); editMapping(); editPolicy(); renderReviewDraft(); renderPending();
  await refreshState();
  const original = await retainedCommand('read');
  if (original) {
    requireValue(validCommand(original), 'The retained browser command belongs to a different reporting workspace.');
    pending = original; if (pending.status === 'sending') pending.status = 'uncertain'; renderPending();
  }
  let savedView; try { savedView = localStorage.getItem('open311-reporting-view'); } catch {}
  if (['overview', 'sources', 'rules', 'build', 'reports', 'reviews', 'workspace'].includes(savedView)) switchView(savedView);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy) safely(refreshState); });
}
bootstrap().catch(error => { notify(error.message || String(error), true); });
