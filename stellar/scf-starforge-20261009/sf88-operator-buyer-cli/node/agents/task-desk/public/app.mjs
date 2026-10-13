import { TaskDeskClient } from '/client.mjs';
import { mountCustomerDelivery } from '/assets/customer-delivery.mjs';

const client = new TaskDeskClient(location.origin);
const $ = (selector) => document.querySelector(selector);
const main = $('#main-content');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const pretty = (value) => JSON.stringify(value, null, 2) ?? String(value);
const terminalStates = new Set(['succeeded', 'failed', 'interrupted']);
const activeStates = new Set(['queued', 'running']);
const storagePrefix = 'inbox-task-desk.v1.';
const pollers = new Map();
let toastTimer = null;
const state = {
  tasks: [], taskIssues: [], jobs: [], process: null, status: null, connected: false,
  mode: 'home', taskId: null, detail: null, packet: null, taskError: null, loading: false,
  activeTab: 'requests', selectedIntent: null, review: null, reviewIntent: null,
  reviewBusy: false, operationBusy: false, operations: new Map(), pollErrors: new Map(),
  draft: null, draftVersion: 0, preview: null, previewBusy: false, saveBusy: false,
  pickerChecked: new Set(), pickerSearch: '', search: '', refreshing: false, routeVersion: 0, loadVersion: 0,
  comparison: null, comparisonPreviousId: '', compareBusy: false,
  pending: readStored('pending', []), downloadBusy: false,
  rpcDirectories: new Map(), rpcViews: new Map(), rpcSelecting: 0
};

function readStored(key, fallback) {
  try { const value = localStorage.getItem(storagePrefix + key); return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
}
function writeStored(key, value) {
  try { localStorage.setItem(storagePrefix + key, JSON.stringify(value)); return true; }
  catch { return false; }
}
function errorRecord(error) {
  if (error && typeof error === 'object') {
    const record = {};
    for (const key of ['name', 'code', 'status', 'message', 'details', 'nativeResult', 'requestId']) {
      if (Object.prototype.hasOwnProperty.call(error, key) || error[key] !== undefined) record[key] = error[key];
    }
    return Object.keys(record).length ? record : error;
  }
  return { message: String(error ?? 'The operation could not be completed.') };
}
function messageOf(error) {
  const value = errorRecord(error);
  return String(value.message ?? value.error ?? value.code ?? 'The operation could not be completed.');
}
function errorPanel(title, error, action = '') {
  return '<div class="notice error"><strong>' + esc(title) + '</strong><p>' + esc(messageOf(error)) + '</p>' +
    '<details><summary>Original error details</summary><pre>' + esc(pretty(errorRecord(error))) + '</pre></details>' + action + '</div>';
}
function notify(message, error = null) {
  const node = $('#global-notice');
  node.innerHTML = error ? errorPanel(message, error) : '<strong>' + esc(message) + '</strong>';
  node.hidden = false;
}
function clearNotice() { $('#global-notice').hidden = true; $('#global-notice').replaceChildren(); }
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4200);
}
function formatDate(value, options = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', ...options}).format(date);
}
function formatBytes(value) {
  if (!Number.isFinite(Number(value)) || value === null) return '—';
  const bytes = Number(value);
  if (bytes < 1024) return bytes.toLocaleString() + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toLocaleString(undefined, {maximumFractionDigits:1}) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toLocaleString(undefined, {maximumFractionDigits:1}) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toLocaleString(undefined, {maximumFractionDigits:2}) + ' GB';
}
function humanize(value) {
  return String(value ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
    .toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}
function badge(value, style = '') { return '<span class="badge ' + esc(style) + '">' + esc(value) + '</span>'; }
function scalar(value) { return value === null || value === undefined ? 'Not recorded' : typeof value === 'string' ? value : pretty(value); }
function nativeObject(value) {
  if (value === null || typeof value !== 'object') return '<p class="wrap-anywhere">' + esc(scalar(value)) + '</p>';
  if (Array.isArray(value)) return '<ol class="native-list">' + value.map((entry) => '<li>' + nativeObject(entry) + '</li>').join('') + '</ol>';
  const entries = Object.entries(value);
  if (!entries.length) return '<p class="muted small">No additional fields.</p>';
  const technical = /(?:sha256|hash|^root$|^directory$|^id$|intentId$|requestId$|reviewId$|taskId$|jobId$)/i;
  const references = entries.filter(([key,entry]) => technical.test(key) && (entry === null || typeof entry !== 'object'));
  const visible = entries.filter(([key,entry]) => !technical.test(key) || (entry !== null && typeof entry === 'object'));
  return (visible.length ? '<dl class="native-values">' + visible.map(([key, entry]) => '<dt>' + esc(humanize(key)) + '</dt><dd>' +
    (entry && typeof entry === 'object' ? '<details><summary>View complete ' + esc(humanize(key).toLowerCase()) + '</summary><pre>' + esc(pretty(entry)) + '</pre></details>' : esc(scalar(entry))) + '</dd>').join('') + '</dl>' : '') +
    (references.length ? '<details><summary>Reference details</summary>' + references.map(([key,entry]) => copyRow(humanize(key),entry)).join('') + '</details>' : '');
}
function copyRow(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return '<div class="copy-row"><div><span>' + esc(label) + '</span><code>' + esc(value) + '</code></div><button class="copy-button" type="button" data-action="copy" data-value="' + esc(value) + '">Copy</button></div>';
}
function taskRecord(item) { return item?.record ?? null; }
function callerOf(item) { return taskRecord(item)?.manifest?.task ?? item?.inspection?.task ?? {}; }
function entriesOf(detail = state.detail) { return detail?.record?.manifest?.entries ?? []; }
function jobIntent(job) { return typeof job?.operation?.intentId === 'string' ? job.operation.intentId : null; }
function usableJobs() { return state.jobs.filter((job) => jobIntent(job)); }
function jobFor(intentId) {
  const inspected = state.detail?.inspection?.entries?.find((entry) => entry.selection?.intentId === intentId)?.job;
  return inspected ?? state.jobs.find((job) => jobIntent(job) === intentId) ?? null;
}
function requestLabel(job, index = 0) {
  const operation = job?.operation ?? {};
  const title = ['title','name','description','label'].map((key) => operation[key]).find((value) => typeof value === 'string' && value.trim());
  if (title) return title;
  const method = typeof operation.method === 'string' ? operation.method : '';
  const address = ['url','endpoint','resource'].map((key) => operation[key]).find((value) => typeof value === 'string' && value.trim());
  if (address) {
    try { const parsed = new URL(address); return (method ? method.toUpperCase() + ' ' : '') + parsed.hostname + parsed.pathname; }
    catch { return (method ? method.toUpperCase() + ' ' : '') + address; }
  }
  return 'Original request ' + (index + 1);
}
function roleFor(intentId) { return entriesOf().find((entry) => entry.selection.intentId === intentId)?.selection?.role ?? 'Original request'; }
function taskTitle(item) { return callerOf(item).title || 'Saved task'; }
function routeTo(taskId, operationId = null) {
  const params = new URLSearchParams(); params.set('task', taskId);
  if (operationId) params.set('operation', operationId);
  history.replaceState(null, '', '#' + params.toString());
  writeStored('selectedTask', taskId);
}
function setConnection(connected) {
  state.connected = connected;
  const node = $('#connection-status'); node.textContent = connected ? 'Connected to task desk' : 'Connection interrupted';
  node.classList.toggle('offline', !connected);
}
function sidebarOpen(open) {
  document.body.classList.toggle('sidebar-open', open); $('#sidebar-backdrop').hidden = !open;
  $('#sidebar-toggle').setAttribute('aria-expanded', String(open));
}
function renderSidebar() {
  const search = state.search.trim().toLowerCase();
  const visible = state.tasks.filter((task) => pretty(callerOf(task)).toLowerCase().includes(search));
  $('#task-count').textContent = String(state.tasks.length);
  $('#task-list').innerHTML = visible.length ? visible.map((task) => {
    const caller = callerOf(task), createdAt = taskRecord(task)?.createdAt;
    return '<button type="button" class="task-link" data-task-id="' + esc(task.id) + '" ' + (state.mode === 'task' && state.taskId === task.id ? 'aria-current="page"' : '') + '><strong>' + esc(caller.title || 'Saved task') + '</strong><span class="task-meta">' + esc([caller.revision ? 'Revision ' + caller.revision : '', caller.service].filter(Boolean).join(' · ')) + '</span><span class="task-time">' + esc(formatDate(createdAt)) + '</span></button>';
  }).join('') : '<p class="sidebar-note">' + (search ? 'No saved tasks match your search.' : 'Your saved tasks will appear here.') + '</p>';
  const issues = $('#task-list-issues');
  issues.hidden = !state.taskIssues.length;
  issues.innerHTML = state.taskIssues.length ? '<details><summary>' + state.taskIssues.length + ' task record' + (state.taskIssues.length === 1 ? '' : 's') + ' need attention</summary>' +
    state.taskIssues.map((issue) => '<p>' + esc(messageOf(issue.error)) + '</p>' + copyRow('Record reference', issue.id)).join('') + '</details>' : '';
}
function unreadableJobsMarkup() {
  const issues = state.jobs.filter((job) => !jobIntent(job));
  if (!issues.length) return '';
  return '<details class="notice"><summary>' + issues.length + ' original inbox record' + (issues.length === 1 ? '' : 's') + ' need attention</summary>' +
    issues.map((issue) => errorPanel('Inbox record could not be read.',issue?.error ?? issue) + copyRow('Inbox record reference',issue?.id)).join('') + '</details>';
}
function renderHome() {
  if (!state.connected) {
    main.innerHTML = '<section class="empty-state"><p class="eyebrow">SAVED WORKSPACE</p><h1>Reconnect to your saved work</h1><p>Open the configured task desk to read saved tasks, original inbox requests, and retained operation progress.</p><div class="button-row"><button class="button primary" type="button" data-action="reconnect">Reconnect</button></div></section>';
    return;
  }
  main.innerHTML = '<section class="empty-state"><p class="eyebrow">INBOX TASK DESK</p><h1>Bring the work together.</h1><p>Build a task from your original inbox requests, review each request, and retain the complete responses in one packet.</p><p>' +
    (state.tasks.length ? 'Choose a saved task to continue where you left off.' : 'Start by choosing existing requests and describing the work they belong to.') +
    '</p><div class="button-row"><button class="button primary" type="button" data-action="new-task">New task</button><button class="button" type="button" data-action="refresh">Refresh saved work</button></div></section>' +
    '<section class="panel"><div class="section-heading"><div><h2>Original inbox</h2><p class="muted small">' + usableJobs().length + ' request' + (usableJobs().length === 1 ? '' : 's') + ' available to include in a task.</p></div></div>' +
    (usableJobs().length ? '<p class="muted">The task desk keeps the original request, its review, its execution history, and its response together.</p>' : '<p class="muted">Prepare requests in the original Inbox, then refresh this desk to select them.</p>') +
    unreadableJobsMarkup() +
    (state.process ? '<details><summary>Inbox process details</summary><pre>' + esc(pretty(state.process)) + '</pre></details>' : '') + '</section>';
}
function renderMain() {
  if (state.mode === 'draft') return renderDraft();
  if (state.mode === 'task') return renderTask();
  renderHome();
}
async function refreshDesk({ reconnect = false, initial = false } = {}) {
  if (state.refreshing) return;
  state.refreshing = true; $('#refresh-all-button').disabled = true; clearNotice();
  try {
    if (reconnect) client.clearSession();
    state.status = await client.getStatus(); setConnection(true);
    const [jobs, tasks] = await Promise.allSettled([client.listJobs(), client.listTasks()]);
    if (jobs.status === 'fulfilled') { state.jobs = jobs.value.jobs ?? []; state.process = jobs.value.process ?? null; }
    else notify('The original inbox could not be refreshed.', jobs.reason);
    if (tasks.status === 'fulfilled') { state.tasks = tasks.value.tasks ?? []; state.taskIssues = tasks.value.issues ?? []; }
    else notify('Saved tasks could not be refreshed.', tasks.reason);
    renderSidebar();
    $('#last-refreshed').textContent = 'Updated ' + formatDate(new Date().toISOString(), {year:undefined, month:undefined, day:undefined});
    if (initial) {
      const route = new URLSearchParams(location.hash.slice(1));
      const selected = route.get('task') || readStored('selectedTask', null);
      const operationId = route.get('operation');
      if (selected && operationId && !state.pending.some((entry) => entry.requestId === operationId)) {
        state.pending.push({requestId:operationId, taskId:selected, kind:'operation', createdAt:null});
      }
      if (location.hash === '#new') showNewTask();
      else if (selected && state.tasks.some((task) => task.id === selected)) await showTask(selected, {operationId});
      else if (state.tasks.length) await showTask(state.tasks[0].id);
      else renderHome();
    } else if (state.mode === 'task' && state.taskId) await loadTask(state.taskId, {quiet:true});
    else { if (state.mode === 'draft') invalidatePreview(); renderMain(); }
  } catch (error) { setConnection(false); notify('Could not connect to the task desk.', error); if (initial) renderHome(); }
  finally { state.refreshing = false; $('#refresh-all-button').disabled = false; }
}
function createDraft(source = null) {
  const record = source?.record;
  const task = record?.manifest?.task ?? {};
  return {
    task:{system:task.system ?? '',id:task.id ?? '',revision:'',title:task.title ?? '',purpose:task.purpose ?? '',service:task.service ?? ''},
    predecessorId:source?.id ?? null,
    predecessorLabel:source ? task.title + ' · Revision ' + task.revision : null,
    selections:record ? record.manifest.entries.map((entry) => ({...entry.selection})) : []
  };
}
function showNewTask(source = null) {
  if (source) state.draft = createDraft(source);
  else if (!state.draft) state.draft = createDraft();
  state.mode = 'draft'; state.preview = null; state.review = null; state.draftVersion++;
  history.replaceState(null, '', '#new'); sidebarOpen(false); clearNotice(); renderSidebar(); renderDraft();
  main.focus({preventScroll:true});
}
function fieldMarkup(label, key, value, {multiline = false, help = '', required = true, placeholder = '', index = null} = {}) {
  const attributes = index === null ? 'data-draft-field="' + esc(key) + '"' : 'data-selection-field="' + esc(key) + '" data-index="' + index + '"';
  return '<label><span class="field-caption">' + esc(label) + (required ? ' <span class="required-mark">Required</span>' : '') + '</span>' +
    (multiline ? '<textarea ' : '<input type="text" ') + attributes + (required ? ' required' : '') + ' placeholder="' + esc(placeholder) + '"' +
    (multiline ? '>' + esc(value) + '</textarea>' : ' value="' + esc(value) + '">') +
    (help ? '<span class="field-help">' + esc(help) + '</span>' : '') + '</label>';
}

function rpcDirectory(selection) {
  return state.rpcDirectories.get(selection.intentId) ?? selection.rpcResult?.commerceDirectory ?? state.status?.roots?.commerce ?? '';
}
function rpcKey(intentId, directory) { return JSON.stringify([intentId, directory]); }
function rpcView(selection) { return state.rpcViews.get(rpcKey(selection.intentId, rpcDirectory(selection).trim())); }
function rpcAttributes(selection, index) {
  return ' data-rpc-intent="' + esc(selection.intentId) + '"' + (index === null ? '' : ' data-rpc-index="' + index + '"');
}
function recoveredResultMarkup(value, {compact = false} = {}) {
  if (!value) return '';
  const observed = value.responseObservedAt ? formatDate(value.responseObservedAt) : null;
  if (compact) return '<div class="muted small">Saved RPC read' + (observed ? ' · observed ' + esc(observed) : '') + '</div>';
  return '<div class="rpc-result-summary"><h3>Selected recovered RPC result</h3><dl class="facts">' +
    (observed ? '<div><dt>Observed</dt><dd>' + esc(observed) + '</dd></div>' : '') +
    (value.recoveryReadStartedAt ? '<div><dt>Read started</dt><dd>' + esc(formatDate(value.recoveryReadStartedAt)) + '</dd></div>' : '') +
    (value.publishedAt ? '<div><dt>Saved</dt><dd>' + esc(formatDate(value.publishedAt)) + '</dd></div>' : '') +
    (value.bytes != null ? '<div><dt>Complete response</dt><dd>' + esc(formatBytes(value.bytes)) + '</dd></div>' : '') +
    (value.httpStatus != null ? '<div><dt>Recovery HTTP outcome</dt><dd>HTTP ' + esc(value.httpStatus) + ' accepted by original recovery</dd></div>' : '') +
    '</dl><details><summary>Saved read and settlement references</summary>' +
    copyRow('Read reference',value.readId) + copyRow('Response SHA-256',value.sha256) +
    copyRow('Settled transaction',value.transaction) + (value.httpStatusSource ? '<p class="small">' + esc(value.httpStatusSource) + '</p>' : '') +
    '</details></div>';
}
function selectedRpcDetails(selection) {
  const selected = selection.rpcResult;
  if (!selected) return null;
  const retained = inspectionEntry(selection.intentId)?.job?.rpcRecovery;
  if (retained?.readId === selected.readId && retained?.responseFile?.sha256 === selected.responseSha256)
    return retained.responseFile;
  const packet = packetOutcome(selection.intentId)?.recoveredResult;
  if (packet?.readId === selected.readId && packet?.sha256 === selected.responseSha256) return packet;
  const viewed = state.rpcViews.get(rpcKey(selection.intentId,selected.commerceDirectory))?.detail;
  return viewed?.recovery?.readId === selected.readId && viewed?.delivery?.sha256 === selected.responseSha256
    ? viewed.delivery : null;
}
function rpcSelectionMarkup(selection, index = null) {
  const selected = selection.rpcResult;
  if (!selected) return '<p class="muted small">This task uses the original attempt’s response. A saved RPC read can be selected below.</p>';
  return '<div class="notice"><strong>Saved RPC read selected for this task edition</strong>' +
    (selectedRpcDetails(selection) ? recoveredResultMarkup(selectedRpcDetails(selection)) : '') +
    '<details><summary>Exact selected read</summary>' + copyRow('Original commerce session',selected.commerceDirectory) +
    copyRow('Read reference',selected.readId) + copyRow('Response SHA-256',selected.responseSha256) + '</details>' +
    (index !== null ? '<button class="button quiet small-button" type="button" data-action="rpc-clear"' + rpcAttributes(selection,index) + (state.rpcSelecting || state.saveBusy ? ' disabled' : '') + '>Use original attempt response</button>' : '') + '</div>';
}
function rpcSelectorMarkup(selection, index = null) {
  if (!selection.intentId) return '';
  const directory = rpcDirectory(selection), view = rpcView(selection), result = view?.result;
  const recovery = result?.native?.rpcRecovery, reads = recovery?.reads ?? [];
  const attrs = rpcAttributes(selection,index), selected = selection.rpcResult;
  const resultRows = result ? (recovery ? '<p class="small"><strong>' + esc(humanize(recovery.state)) + '</strong> · ' + reads.length + ' retained read edition' + (reads.length === 1 ? '' : 's') + '</p>' +
    (reads.length ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>Observation</th><th>Full response</th><th>Status</th><th>Open or select</th></tr></thead><tbody>' +
      reads.map((read) => {
        const current = selected?.commerceDirectory === recovery.commerceDirectory && selected?.readId === read.readId && selected?.responseSha256 === read.response?.sha256;
        const values = attrs + ' data-rpc-read-id="' + esc(read.readId) + '" data-rpc-response-sha256="' + esc(read.response?.sha256) + '"';
        return '<tr><td>' + esc(formatDate(read.responseObservedAt)) + '<details><summary>Read identity</summary>' + copyRow('Read reference',read.readId) +
          copyRow('Response SHA-256',read.response?.sha256) + '<p class="small">Started ' + esc(formatDate(read.recoveryReadStartedAt)) + ' · Saved ' + esc(formatDate(read.publishedAt)) + '</p></details></td>' +
          '<td>' + esc(formatBytes(read.response?.bytes)) + '</td><td>' + badge(current ? 'Selected' : read.complete ? 'Saved' : 'Publishing',current ? 'strong' : '') + '</td>' +
          '<td><div class="button-row"><button class="button small-button" type="button" data-action="rpc-inspect"' + values + (!read.complete || view?.inspecting ? ' disabled' : '') + '>Inspect read</button>' +
          '<button class="button small-button" type="button" data-action="rpc-use"' + values + (!read.complete || current || view?.inspecting || state.rpcSelecting || state.previewBusy || state.saveBusy ? ' disabled' : '') + '>' +
          (index === null ? 'Create edition with read' : 'Use this read') + '</button></div></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">This original request has no retained completed read yet. Refresh the saved reads after its existing recovery finishes.</p>') :
      '<p class="muted">The original request has no saved RPC recovery record in this commerce session.</p>') : '';
  const inspected = view?.detail;
  return rpcSelectionMarkup(selection,index) +
    '<details class="rpc-picker"' + (selected || view ? ' open' : '') + '><summary>Saved RPC read editions</summary>' +
    '<p class="muted small">Open the existing commerce session to inspect its saved read editions. Choosing a read keeps its observation time and exact response in the task revision.</p>' +
    '<div class="form-grid"><label><span class="field-caption">Original commerce session</span><input type="text" data-rpc-commerce="' + esc(selection.intentId) + '" value="' + esc(directory) + '" placeholder="/absolute/original/commerce-session"><span class="field-help">Use the session that contains this original Inbox. Selecting a read changes the task’s response selection.</span></label></div>' +
    '<div class="button-row"><button class="button" type="button" data-action="rpc-list"' + attrs + (view?.busy ? ' disabled' : '') + '>' + (view?.busy ? 'Reading saved editions…' : 'Inspect saved reads') + '</button></div>' +
    '<div class="rpc-read-results">' + (view?.error ? errorPanel('Saved reads could not be opened.',view.error) : '') + resultRows +
    (view?.detailError ? errorPanel('The selected saved read could not be opened.',view.detailError) : '') +
    (view?.inspecting ? '<p class="muted small">Opening and verifying the complete original read…</p>' : '') +
    (inspected ? '<section class="rpc-inspection"><h3>Inspected original read</h3>' + recoveredResultMarkup(inspected.delivery) +
      '<h4>Original attempt outcome</h4><pre>' + esc(pretty({state:inspected.job?.state,outcome:inspected.job?.outcome,lastError:inspected.job?.lastError})) + '</pre>' +
      '<div class="button-row"><button class="button" type="button" data-action="rpc-download"' + attrs +
      ' data-rpc-read-id="' + esc(inspected.recovery.readId) + '" data-rpc-response-sha256="' + esc(inspected.delivery.sha256) + '">Download complete original response</button></div>' +
      '<details><summary>Complete verified result and original read records</summary><pre>' + esc(pretty(inspected)) + '</pre></details></section>' : '') +
    (result ? '<details><summary>Complete native saved-read listing</summary><pre>' + esc(pretty(result)) + '</pre></details>' : '') +
    '</div></details>';
}
function rpcContext(button) {
  const intentId = button.dataset.rpcIntent;
  const index = button.dataset.rpcIndex === undefined ? null : Number(button.dataset.rpcIndex);
  const selection = index === null ? entriesOf().find(entry => entry.selection.intentId === intentId)?.selection : state.draft?.selections[index];
  if (!selection || selection.intentId !== intentId) throw new Error('Open the current original request before selecting a saved read.');
  const directory = rpcDirectory(selection).trim();
  if (!directory) throw new Error('Choose the original absolute commerce session directory.');
  return {intentId,index,selection,directory,key:rpcKey(intentId,directory),draft:state.draft,
    taskId:state.taskId,taskSha256:state.detail?.record?.taskSha256,routeVersion:state.routeVersion};
}
function rpcContextCurrent(context) {
  if (context.index !== null) return state.mode === 'draft' && state.draft === context.draft &&
    state.draft?.selections.includes(context.selection) && context.selection.intentId === context.intentId &&
    rpcDirectory(context.selection).trim() === context.directory;
  return state.mode === 'task' && state.taskId === context.taskId && state.routeVersion === context.routeVersion &&
    state.detail?.record?.taskSha256 === context.taskSha256 && state.selectedIntent === context.intentId &&
    rpcDirectory(context.selection).trim() === context.directory;
}
async function listRpcReads(button) {
  const context = rpcContext(button), previous = state.rpcViews.get(context.key);
  if (previous?.busy || previous?.inspecting) return;
  const view = {busy:true,error:null,result:null,detail:null,detailError:null};
  state.rpcViews.set(context.key,view); clearNotice(); renderMain();
  try { view.result = await client.listRpcResponses(context.intentId,{commerceDirectory:context.directory}); }
  catch (error) { view.error = errorRecord(error); }
  finally { view.busy = false; if (rpcContextCurrent(context)) renderMain(); }
}
async function inspectRpcRead(button, useInTask = false) {
  const context = rpcContext(button), view = state.rpcViews.get(context.key);
  const read = view?.result?.native?.rpcRecovery?.reads?.find(item => item.readId === button.dataset.rpcReadId &&
    item.response?.sha256 === button.dataset.rpcResponseSha256);
  if (!read?.complete) throw new Error('Refresh the original saved reads and choose a completed edition.');
  if (view.inspecting || state.rpcSelecting || useInTask && (state.previewBusy || state.saveBusy)) return;
  view.inspecting = true; view.detail = null; view.detailError = null;
  if (useInTask) state.rpcSelecting++;
  clearNotice(); renderMain();
  try {
    const detail = await client.getRpcResponse(context.intentId, {
      commerceDirectory:context.directory,readId:read.readId,responseSha256:read.response.sha256,
    });
    if (detail.intentId !== context.intentId || detail.recovery?.readId !== read.readId ||
      detail.delivery?.sha256 !== read.response.sha256 || detail.recovery?.commerceDirectory !== view.result.native.rpcRecovery.commerceDirectory)
      throw new Error('The opened RPC result differs from the selected original read.');
    view.detail = detail;
    if (useInTask) {
      if (!rpcContextCurrent(context)) { toast('The original read is available. Select it from the current task view.'); return; }
      const selected = {commerceDirectory:detail.recovery.commerceDirectory,readId:detail.recovery.readId,responseSha256:detail.delivery.sha256};
      state.rpcDirectories.set(context.intentId,selected.commerceDirectory);
      state.rpcViews.set(rpcKey(context.intentId,selected.commerceDirectory),view);
      if (context.index === null) {
        showNewTask(state.detail);
        state.draft.selections.find(item => item.intentId === context.intentId).rpcResult = selected;
      } else context.selection.rpcResult = selected;
      invalidatePreview();
      toast('Saved RPC read selected. Preview and save this task edition.');
    }
  } catch (error) { view.detailError = errorRecord(error); if (rpcContextCurrent(context)) notify('The original saved read could not be selected.',error); }
  finally {
    view.inspecting = false;
    if (useInTask) state.rpcSelecting--;
    if (state.mode === 'draft' || rpcContextCurrent(context)) renderMain();
  }
}
function downloadRpcRead(button) {
  const context = rpcContext(button), detail = state.rpcViews.get(context.key)?.detail;
  if (!detail || detail.recovery?.readId !== button.dataset.rpcReadId || detail.delivery?.sha256 !== button.dataset.rpcResponseSha256)
    throw new Error('Inspect this exact original saved read before downloading it.');
  const query = new URLSearchParams({commerceDirectory:detail.recovery.commerceDirectory,responseSha256:detail.delivery.sha256});
  startNativeDownload('/api/jobs/' + encodeURIComponent(context.intentId) + '/rpc-results/' +
    encodeURIComponent(detail.recovery.readId) + '/download?' + query,'rpc-result-' + detail.recovery.readId + '.json');
}

function selectionMarkup(selection, index) {
  const current = selection.intentId || '';
  const jobs = usableJobs();
  const options = jobs.map((job, position) => '<option value="' + esc(jobIntent(job)) + '"' + (current === jobIntent(job) ? ' selected' : '') + '>' +
    esc(requestLabel(job, position) + ' · ' + humanize(job.state || 'Retained')) + '</option>').join('');
  const missingOption = current && !jobs.some((job) => jobIntent(job) === current) ? '<option value="' + esc(current) + '" selected>Previously selected request · refresh inbox to inspect</option>' : '';
  const job = jobs.find((entry) => jobIntent(entry) === current);
  return '<article class="selection-card"><div class="selection-heading"><h3><span class="selection-number">' + (index + 1) + '</span>' + esc(selection.role || 'Request role') +
    '</h3><button class="button quiet small-button" type="button" data-action="remove-selection" data-index="' + index + '">Remove</button></div><div class="form-grid">' +
    '<label><span class="field-caption">Original inbox request <span class="required-mark">Required</span></span><select data-selection-field="intentId" data-index="' + index + '" required><option value="">Choose an existing request</option>' + missingOption + options + '</select></label>' +
    fieldMarkup('Role in this task','role',selection.role ?? '',{index,help:'Keep this role stable when revising the task.'}) + '</div>' +
    (job ? '<p class="request-summary">' + esc(humanize(job.state || 'Retained')) + (job.bodyBytes != null ? ' · ' + esc(formatBytes(job.bodyBytes)) + ' request body' : '') + '</p><details><summary>Complete original request</summary><pre>' + esc(pretty(job.operation)) + '</pre>' + copyRow('Intent reference',current) + '</details>' : '') +
    rpcSelectorMarkup(selection,index) +
    '<details><summary>Source, facilitator, and decision references</summary><div class="form-grid">' +
    fieldMarkup('Source edition','sourceEdition',selection.sourceEdition ?? '',{index,required:false}) +
    fieldMarkup('Facilitator HTTPS URL','facilitator',selection.facilitator ?? '',{index,required:false,help:'Use an HTTPS URL without a query, fragment, or embedded credentials.'}) +
    fieldMarkup('Decision reference','decisionRef',selection.decisionRef ?? '',{index,required:false}) +
    fieldMarkup('Reservation reference','reservationRef',selection.reservationRef ?? '',{index,required:false}) + '</div></details></article>';
}
function renderDraft() {
  const draft = state.draft;
  main.innerHTML = '<div class="page-heading"><div><p class="eyebrow">' + (draft.predecessorId ? 'NEW TASK EDITION' : 'TASK PREPARATION') + '</p><h1>' +
    (draft.predecessorId ? 'Revise the task' : 'Create a task') + '</h1><p class="lead">Describe the work, choose the original requests, and inspect the native preview before saving.</p></div></div>' +
    (draft.predecessorId ? '<div class="notice"><strong>Based on ' + esc(draft.predecessorLabel) + '</strong>Choose the new revision and preserve the role names you want to compare across editions.</div>' : '') +
    '<form id="new-task-form"><fieldset ' + (state.saveBusy || state.rpcSelecting ? 'disabled' : '') + '><section class="panel"><div class="panel-heading"><h2>Task details</h2><p class="muted small">These six fields identify the caller and the purpose of this task.</p></div><div class="form-grid">' +
    fieldMarkup('Task title','title',draft.task.title) + fieldMarkup('Service','service',draft.task.service) +
    '<div class="span-all">' + fieldMarkup('Purpose','purpose',draft.task.purpose,{multiline:true}) + '</div>' +
    fieldMarkup('Calling system','system',draft.task.system) + fieldMarkup('Task reference','id',draft.task.id,{help:'The reference used by the calling system.'}) +
    fieldMarkup('Revision','revision',draft.task.revision,{help:draft.predecessorId ? 'Use a new revision for this edition.' : 'The caller’s revision for this task.'}) +
    '</div></section><section class="panel"><div class="section-heading"><div><h2>Requests and roles</h2><p class="muted small">Include 1–500 distinct original requests. Each role is unique within the task.</p></div><div class="button-row"><button class="button" type="button" data-action="add-selection"' + (draft.selections.length >= 500 ? ' disabled' : '') + '>Add one request</button><button class="button" type="button" data-action="pick-jobs"' + (draft.selections.length >= 500 ? ' disabled' : '') + '>Choose requests</button></div></div>' +
    (draft.selections.length ? draft.selections.map(selectionMarkup).join('') : '<div class="preview-empty">Choose requests from the original inbox to begin.</div>') +
    '<p class="muted small">' + draft.selections.length + ' of 500 request slots used</p></section><section class="panel"><div class="section-heading"><div><h2>Native preview</h2><p class="muted small">Review the exact task manifest and original request bindings that will be saved.</p></div></div><div id="native-preview">' + previewMarkup() + '</div><div class="preview-actions"><p id="preview-hint">' + (state.preview ? 'The preview matches the current form.' : 'A current preview is required to save this task.') + '</p><div class="button-row"><button id="preview-task-button" class="button" type="button" data-action="preview-task"' + (state.previewBusy || state.saveBusy ? ' disabled' : '') + '>' + (state.previewBusy ? 'Preparing preview…' : 'Preview task') + '</button><button id="save-task-button" class="button primary" type="button" data-action="save-task"' + (!state.preview || state.previewBusy || state.saveBusy ? ' disabled' : '') + '>' + (state.saveBusy ? 'Saving task…' : 'Save task') + '</button></div></div></section></fieldset></form>';
}
function invalidatePreview() {
  state.preview = null; state.draftVersion++;
  const node = $('#native-preview'); if (node) node.innerHTML = '<div class="preview-empty">The form has changed. Prepare a fresh native preview before saving.</div>';
  if ($('#save-task-button')) $('#save-task-button').disabled = true;
  if ($('#preview-hint')) $('#preview-hint').textContent = 'A current preview is required to save this task.';
}
function buildTaskInput() {
  if (state.rpcSelecting) throw new Error('Wait for the selected original RPC read to open.');
  const task = Object.fromEntries(Object.entries(state.draft.task).map(([key,value]) => [key,String(value).trim()]));
  if (Object.values(task).some((value) => !value)) throw new Error('Complete all six task fields.');
  if (!state.draft.selections.length || state.draft.selections.length > 500) throw new Error('Select between 1 and 500 original requests.');
  const selections = state.draft.selections.map((selection) => {
    const result = {intentId:String(selection.intentId ?? '').trim(), role:String(selection.role ?? '').trim()};
    if (!result.intentId || !result.role) throw new Error('Every request needs an original inbox selection and a role.');
    for (const key of ['sourceEdition','facilitator','decisionRef','reservationRef']) {
      const value = String(selection[key] ?? '').trim(); if (value) result[key] = value;
    }
    if (selection.rpcResult !== undefined) {
      const {commerceDirectory,readId,responseSha256} = selection.rpcResult;
      if (typeof commerceDirectory !== 'string' || !commerceDirectory ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(readId) ||
        !/^[a-f0-9]{64}$/.test(responseSha256)) throw new Error('Choose a complete original saved RPC read.');
      result.rpcResult = {commerceDirectory,readId,responseSha256};
    }
    return result;
  });
  if (new Set(selections.map((selection) => selection.intentId)).size !== selections.length) throw new Error('Choose each original request only once.');
  if (new Set(selections.map((selection) => selection.role)).size !== selections.length) throw new Error('Give each request a distinct, stable role.');
  return {task,selections,...(state.draft.predecessorId ? {predecessorId:state.draft.predecessorId} : {})};
}
function previewMarkup() {
  if (!state.preview) return '<div class="preview-empty">The preview will show the complete caller details, selected roles, and original request bindings.</div>';
  const result = state.preview.result, manifest = result.manifest;
  return '<div class="preview-heading"><h3>Task manifest prepared</h3>' + badge('Current preview','strong') + '</div>' + callerFacts(manifest.task) +
    '<div class="table-wrap space-before-20"><table class="data-table"><thead><tr><th>Role</th><th>Source edition</th><th>Original request</th></tr></thead><tbody>' +
    (manifest.entries ?? []).map((entry) => '<tr><td><strong>' + esc(entry.selection.role) + '</strong></td><td>' + esc(entry.selection.sourceEdition ?? '—') + '</td><td><details><summary>Complete request and binding</summary><pre>' + esc(pretty({request:entry.request,binding:entry.binding,selection:entry.selection})) + '</pre></details></td></tr>').join('') +
    '</tbody></table></div><details class="space-before-14"><summary>Complete native preview</summary><pre>' + esc(pretty(result)) + '</pre></details>';
}
async function previewTask() {
  if (state.previewBusy || state.saveBusy || state.rpcSelecting) return;
  const form = $('#new-task-form'); if (!form?.reportValidity()) return;
  let input; try { input = buildTaskInput(); } catch (error) { notify('Check the task details.',error); return; }
  const version = state.draftVersion; state.previewBusy = true; state.preview = null; clearNotice(); renderDraft();
  try {
    const result = await client.previewTask(input);
    if (state.mode !== 'draft' || version !== state.draftVersion) { toast('The form changed while the preview was prepared. Preview the updated task.'); return; }
    if (!result?.previewSha256 || !result?.manifest) throw Object.assign(new Error('The native preview did not return a complete manifest.'), {details:result});
    state.preview = {signature:JSON.stringify(input),result}; toast('Native task preview is ready.');
  } catch (error) { notify('The task preview could not be prepared.',error); }
  finally { state.previewBusy = false; if (state.mode === 'draft') renderDraft(); }
}
async function saveTask() {
  if (state.saveBusy || state.rpcSelecting || !state.preview) return;
  let input; try { input = buildTaskInput(); } catch (error) { notify('Check the task details.',error); return; }
  if (state.preview.signature !== JSON.stringify(input)) { invalidatePreview(); return; }
  const expectedPreviewSha256 = state.preview.result.previewSha256;
  state.saveBusy = true; clearNotice(); renderDraft();
  try {
    const result = await client.createTask({...input,expectedPreviewSha256});
    if (!result?.id) throw Object.assign(new Error('The saved task reference was not returned. Refresh saved tasks to reconcile the result.'),{details:result});
    state.draft = null; state.preview = null;
    if (result.record) { const index = state.tasks.findIndex((entry) => entry.id === result.id); if (index >= 0) state.tasks[index] = result; else state.tasks.unshift(result); }
    await showTask(result.id); toast('Task saved.');
  } catch (error) { state.preview = null; notify('The task could not be confirmed as saved. Refresh saved tasks before preparing another save.',error); }
  finally { state.saveBusy = false; renderSidebar(); if (state.mode === 'draft') renderDraft(); }
}
function openJobPicker() { state.pickerChecked = new Set(); state.pickerSearch = ''; $('#job-search').value = ''; renderJobPicker(); $('#job-picker').showModal(); }
function renderJobPicker() {
  const selected = new Set(state.draft.selections.map((selection) => selection.intentId));
  const query = state.pickerSearch.toLowerCase().trim();
  const jobs = usableJobs().map((job,index) => ({job,index})).filter(({job}) => !query || pretty(job.operation).toLowerCase().includes(query) || String(job.state).toLowerCase().includes(query));
  $('#job-picker-list').innerHTML = jobs.length ? jobs.map(({job,index}) => {
    const intentId = jobIntent(job), already = selected.has(intentId);
    return '<article class="picker-row"><label><input type="checkbox" data-picker-intent="' + esc(intentId) + '"' + (already ? ' checked disabled' : state.pickerChecked.has(intentId) ? ' checked' : '') + '><div><strong>' + esc(requestLabel(job,index)) + '</strong><div class="muted">' + esc(humanize(job.state || 'Retained')) + (already ? ' · Already in this task' : '') + '</div></div></label><details><summary>Original request details</summary><pre>' + esc(pretty(job.operation)) + '</pre>' + copyRow('Intent reference',intentId) + '</details></article>';
  }).join('') : '<div class="table-empty">' + (query ? 'No original requests match this search.' : 'The inbox has no readable requests yet. Prepare requests in the original Inbox, then refresh.') + '</div>';
  $('#job-picker-list').insertAdjacentHTML('beforeend',unreadableJobsMarkup());
  $('#job-picker-count').textContent = state.pickerChecked.size + ' selected to add';
  $('#job-picker-add').disabled = !state.pickerChecked.size;
}
function addPickedJobs() {
  const existing = state.draft.selections.filter((selection) => selection.intentId);
  if (existing.length + state.pickerChecked.size > 500) { toast('A task can include up to 500 original requests.'); return; }
  const roles = new Set(existing.map((selection) => selection.role));
  for (const intentId of state.pickerChecked) {
    let number = existing.length + 1; while (roles.has('Request ' + number)) number++;
    const role = 'Request ' + number; roles.add(role); existing.push({intentId,role});
  }
  state.draft.selections = existing; invalidatePreview(); $('#job-picker').close(); renderDraft();
}

function callerFacts(task = {}) {
  return '<dl class="facts"><div><dt>Calling system</dt><dd>' + esc(task.system || '—') + '</dd></div><div><dt>Task reference</dt><dd>' + esc(task.id || '—') + '</dd></div><div><dt>Revision</dt><dd>' + esc(task.revision || '—') + '</dd></div><div><dt>Task title</dt><dd>' + esc(task.title || '—') + '</dd></div><div><dt>Service</dt><dd>' + esc(task.service || '—') + '</dd></div><div class="wide"><dt>Purpose</dt><dd>' + esc(task.purpose || '—') + '</dd></div></dl>';
}
function inspectionEntry(intentId) { return state.detail?.inspection?.entries?.find((entry) => entry.selection?.intentId === intentId); }
function packetOutcome(intentId) { return state.packet?.outcomes?.find((entry) => entry.intentId === intentId); }
function outcomeFor(intentId) {
  const inspected = inspectionEntry(intentId)?.job;
  const job = inspected ?? (packetOutcome(intentId) ? null : jobFor(intentId));
  if (!job) return packetOutcome(intentId);
  const outcome = job.outcome;
  if (!outcome) return null;
  return {intentId,state:job.state,nativeStatus:outcome.status,httpStatus:outcome.httpStatus,responseStatus:outcome.responseFile?.status,nativeError:outcome.error,lastError:job.lastError,evidenceError:outcome.evidenceError,responseCleanupError:outcome.responseCleanupError,...(job.rpcRecovery?.responseFile ? {recoveredResult:job.rpcRecovery.responseFile} : {})};
}
function nativeOutcomeText(outcome) {
  if (!outcome) return 'Awaiting an outcome';
  const parts = [];
  if (outcome.httpStatus !== null && outcome.httpStatus !== undefined) parts.push('HTTP ' + outcome.httpStatus);
  if (outcome.nativeStatus !== null && outcome.nativeStatus !== undefined) {
    parts.push(typeof outcome.nativeStatus === 'object' ? 'Native result recorded' : humanize(String(outcome.nativeStatus)));
  }
  if (!parts.length && outcome.state) parts.push(humanize(outcome.state));
  return parts.join(' · ') || 'Outcome recorded';
}
function responseState(intentId) {
  const entry = inspectionEntry(intentId), selected = entriesOf().find(item => item.selection.intentId === intentId)?.selection.rpcResult;
  const packet = packetOutcome(intentId);
  if (selected && (entry?.delivery?.status === 'SAVED' || packet?.recoveredResult)) return 'Saved RPC read';
  const status = entry ? entry.delivery?.status ?? entry.job?.outcome?.responseFile?.status
    : packet?.responseStatus ?? jobFor(intentId)?.outcome?.responseFile?.status;
  return status ? humanize(status) : selected ? 'Selected RPC read awaits inspection' : 'Awaiting response file';
}
async function showTask(taskId, {operationId = null} = {}) {
  state.mode = 'task'; state.taskId = taskId; state.detail = null; state.packet = null; state.taskError = null;
  state.activeTab = 'requests'; state.selectedIntent = null; state.review = null; state.reviewIntent = null;
  state.comparison = null; state.comparisonPreviousId = ''; state.loading = true; state.routeVersion++;
  routeTo(taskId,operationId); sidebarOpen(false); clearNotice(); renderSidebar(); renderTask();
  await loadTask(taskId);
  main.focus({preventScroll:true});
}
async function loadTask(taskId, {quiet = false} = {}) {
  const routeVersion = state.routeVersion, loadVersion = ++state.loadVersion;
  if (!quiet) state.loading = true;
  const [detail, operations] = await Promise.allSettled([client.getTask(taskId),client.listOperations({taskId})]);
  if (state.mode !== 'task' || state.taskId !== taskId || state.routeVersion !== routeVersion || state.loadVersion !== loadVersion) return;
  state.loading = false;
  if (detail.status === 'fulfilled') {
    state.detail = detail.value; state.packet = detail.value.packet ?? null; state.taskError = null;
    const entries = entriesOf();
    if (!entries.some((entry) => entry.selection.intentId === state.selectedIntent)) state.selectedIntent = entries[0]?.selection?.intentId ?? null;
    const found = state.tasks.findIndex((task) => task.id === taskId);
    if (detail.value.record) {
      const entry = {id:taskId,record:detail.value.record,summary:{requests:entries.length}};
      if (found >= 0) state.tasks[found] = entry; else state.tasks.unshift(entry);
    }
    setConnection(true);
  } else { state.taskError = detail.reason; setConnection(false); }
  if (operations.status === 'fulfilled') {
    for (const operation of operations.value.operations ?? []) mergeOperation(operation);
  } else notify('Saved operation progress could not be refreshed.',operations.reason);
  await reconcilePending(taskId);
  if (state.mode === 'task' && state.taskId === taskId && state.routeVersion === routeVersion && state.loadVersion === loadVersion) { renderSidebar(); renderTask(); }
}
function renderTask() {
  if (state.loading && !state.detail) { main.innerHTML = '<div class="view-loading"><h1>Opening saved task</h1><p>Loading the task, original requests, and retained progress.</p><div class="loading-line" aria-hidden="true"></div></div>'; return; }
  if (!state.detail?.record) {
    main.innerHTML = errorPanel('This task could not be opened.',state.taskError ?? {message:'The task record is unavailable.'},'<div class="button-row"><button class="button" type="button" data-action="refresh">Refresh saved work</button></div>');
    return;
  }
  const record = state.detail.record, task = record.manifest.task, entries = entriesOf();
  const saved = state.detail.inspection?.savedResults ?? state.packet?.files?.length ?? null;
  const required = state.detail.inspection?.requiredResults ?? entries.length;
  const outcomes = entries.filter((entry) => outcomeFor(entry.selection.intentId)).length;
  main.innerHTML = '<div class="page-heading"><div><p class="eyebrow">' + esc(task.service) + ' · REVISION ' + esc(task.revision) + '</p><h1>' + esc(task.title) + '</h1><p class="lead">' + esc(task.purpose) + '</p></div><div class="button-row"><button class="button" type="button" data-action="revise-task">Create new edition</button><button class="button primary" type="button" data-action="receive-task"' + (!receiveAllowed() || receivingActive() || state.operationBusy ? ' disabled' : '') + '>' + receiveLabel() + '</button></div></div>' +
    '<section class="stats-row" aria-label="Task status"><div class="stat-card"><div class="stat-label">Original requests</div><div class="stat-value">' + entries.length + '</div><div class="stat-note">Each request has a stable task role.</div></div><div class="stat-card"><div class="stat-label">Saved responses</div><div class="stat-value">' + (saved ?? '—') + ' <span class="muted">of ' + required + '</span></div><div class="stat-note">' + (saved === null ? 'Refresh the inbox inspection to read file readiness.' : saved === required ? 'Every selected response file is ready.' : 'Response collection is still in progress.') + '</div></div><div class="stat-card"><div class="stat-label">Native outcomes</div><div class="stat-value">' + outcomes + ' <span class="muted">recorded</span></div><div class="stat-note">HTTP and native status are shown per request.</div></div></section>' +
    (!receiveAllowed() ? '<div class="notice"><strong>Delivered packet</strong><p>Open the retained packet to review its complete saved responses, native outcomes, and report.</p><button class="button small-button" type="button" data-action="tab" data-tab="packet">Open delivered packet</button></div>' : state.detail.locations?.mode === 'original-receiving' ? '<div class="notice"><strong>Original receiving workspace</strong><p>Receiving continues in this task’s original saved destination.</p></div>' : '') +
    (state.detail.inspectionError ? errorPanel('The saved task is open; its current inbox inspection needs attention.',state.detail.inspectionError) : '') +
    (state.taskError ? errorPanel('The latest task refresh failed.',state.taskError) : '') +
    '<div id="task-progress-strip">' + progressStrip() + '</div>' +
    '<div class="tabs" role="tablist" aria-label="Task views">' +
    [['requests','Requests & review'],['operations','Operation progress'],['packet','Response packet'],['customer','Customer delivery'],['versions','Compare editions'],['details','Task details']].map(([key,label]) => '<button id="task-tab-' + key + '" class="tab-button" type="button" role="tab" tabindex="' + (state.activeTab === key ? '0' : '-1') + '" aria-selected="' + (state.activeTab === key) + '" aria-controls="task-tab-panel" data-action="tab" data-tab="' + key + '">' + label + '</button>').join('') +
    '</div><div id="task-tab-panel" role="tabpanel" aria-labelledby="task-tab-' + state.activeTab + '">' + taskTabMarkup() + '</div>';
  if (state.activeTab === 'customer') mountCustomerDelivery(document.getElementById('customer-delivery-view'), {
    client, taskId: state.taskId, detail: state.detail, status: state.status,
  });
}
function taskTabMarkup() {
  if (state.activeTab === 'customer') return '<div id="customer-delivery-view"></div>';
  if (state.activeTab === 'operations') return operationsMarkup();
  if (state.activeTab === 'packet') return packetMarkup();
  if (state.activeTab === 'versions') return versionsMarkup();
  if (state.activeTab === 'details') return detailsMarkup();
  return requestsMarkup();
}
function requestsMarkup() {
  const entries = entriesOf();
  return '<section class="panel"><div class="section-heading"><div><h2>Original requests</h2><p class="muted small">Choose a role to inspect its request, prepare a native review, and continue the original work.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Role</th><th>Inbox state</th><th>Native outcome</th><th>Response file</th></tr></thead><tbody>' +
    entries.map((entry) => {
      const intentId = entry.selection.intentId, job = jobFor(intentId);
      return '<tr class="' + (state.selectedIntent === intentId ? 'selected-row' : '') + '"><td><button class="row-button" type="button" data-action="select-intent" data-intent-id="' + esc(intentId) + '">' + esc(entry.selection.role) + '</button><div class="muted">' + esc(entry.selection.sourceEdition || '') + '</div></td><td>' + badge(humanize(job?.state || 'Retained')) + '</td><td>' + esc(nativeOutcomeText(outcomeFor(intentId))) + '</td><td>' + esc(responseState(intentId)) + '</td></tr>';
    }).join('') + '</tbody></table></div></section><div class="request-layout">' + requestDetailMarkup() + reviewMarkup() + '</div>';
}
function requestDetailMarkup() {
  const entry = entriesOf().find((item) => item.selection.intentId === state.selectedIntent);
  if (!entry) return '<section class="panel"><h2>Select a request</h2><p class="muted">Choose a task role above to inspect its original request.</p></section>';
  const selection = entry.selection, job = jobFor(selection.intentId), outcome = outcomeFor(selection.intentId), inspected = inspectionEntry(selection.intentId);
  const fileReady = (state.packet?.files ?? []).some((file) => file.intentId === selection.intentId);
  const optionalFacts = ['sourceEdition','facilitator','decisionRef','reservationRef'].filter((key) => selection[key] !== null && selection[key] !== undefined && selection[key] !== '');
  return '<section class="panel"><div class="request-detail-heading"><div><p class="eyebrow">SELECTED ROLE</p><h2>' + esc(selection.role) + '</h2></div>' + badge(humanize(job?.state || 'Retained')) + '</div>' +
    (optionalFacts.length ? '<dl class="facts">' + optionalFacts.map((key) => '<div><dt>' + esc(humanize(key)) + '</dt><dd>' + esc(selection[key]) + '</dd></div>').join('') + '</dl><hr class="subtle-divider">' : '') +
    '<h3>Original attempt outcome</h3><p>' + esc(nativeOutcomeText(outcome)) + '</p><p class="muted small">Response file: ' + esc(responseState(selection.intentId)) + '</p>' +
    (outcome ? '<details><summary>Complete outcome</summary><pre>' + esc(pretty(outcome)) + '</pre></details>' : '') +
    (job?.outcome?.responseFile?.bytes != null ? '<p class="small muted">Original attempt response size: ' + esc(formatBytes(job.outcome.responseFile.bytes)) + '</p>' : '') +
    '<div class="download-actions"><button class="button small-button" type="button" data-action="download-response" data-intent-id="' + esc(selection.intentId) + '"' + (state.downloadBusy || !fileReady ? ' disabled' : '') + '>Download full saved response</button></div>' +
    (!fileReady ? '<p class="field-help">Receive the complete packet to download this response.</p>' : '') +
    rpcSelectorMarkup(selection) +
    '<hr class="subtle-divider"><h3>Original request</h3><p class="muted small">This is the complete operation bound to the saved task.</p><details open><summary>View original request</summary><pre>' + esc(pretty(entry.request)) + '</pre></details>' +
    '<details><summary>Request identity and bindings</summary>' + copyRow('Intent reference',selection.intentId) +
    Object.entries(entry.binding ?? {}).map(([key,value]) => copyRow(humanize(key),value)).join('') + '</details>' +
    (inspected?.delivery ? '<details><summary>Response delivery details</summary><pre>' + esc(pretty(inspected.delivery)) + '</pre></details>' : '') +
    (job ? '<details><summary>Complete retained inbox record</summary><pre>' + esc(pretty(job)) + '</pre></details>' : '') + '</section>';
}
function reviewMarkup() {
  const intentId = state.selectedIntent, job = jobFor(intentId);
  const currentReview = state.review && state.reviewIntent === intentId ? state.review : null;
  const active = intentId && [...state.operations.values()].some((operation) => operation.taskId === state.taskId && operation.intentId === intentId && activeStates.has(operation.state));
  const hasOriginalAttempt = Boolean(job?.attempt || job?.outcome || job?.recovery || (job?.state && !['QUEUED','READY'].includes(String(job.state).toUpperCase())));
  return '<section class="panel"><p class="eyebrow">NATIVE REQUEST CONTROL</p><h2>Review before execution</h2><p class="muted small">Prepare the native review for this exact original request. Execution uses the returned review reference.</p>' +
    (active ? '<div class="notice"><strong>An operation is in progress for this request.</strong><button class="text-button" type="button" data-action="tab" data-tab="operations">View retained progress</button></div>' : '') +
    '<button class="button" type="button" data-action="review-intent"' + (!intentId || state.reviewBusy || state.operationBusy || active ? ' disabled' : '') + '>' + (state.reviewBusy ? 'Preparing native review…' : 'Review original request') + '</button>' +
    (currentReview ? '<div class="review-native"><div class="preview-heading"><h3>Native review</h3>' + badge('Ready to inspect','strong') + '</div><p class="muted small">Reviewed ' + esc(formatDate(currentReview.review?.reviewedAt)) + '</p>' +
      nativeObject(currentReview.review?.native ?? currentReview.review) +
      '<details><summary>Complete review and source bindings</summary><pre>' + esc(pretty(currentReview.review)) + '</pre>' + copyRow('Review reference',currentReview.reviewId) + '</details></div>' : '<div class="preview-empty space-before-16">The original review will appear here. Inspect its full details before choosing Execute.</div>') +
    '<div class="review-actions"><button class="button primary" type="button" data-action="execute-intent"' + (!currentReview || state.operationBusy || active ? ' disabled' : '') + '>Execute reviewed request</button>' +
    (hasOriginalAttempt ? '<button class="button" type="button" data-action="recover-intent"' + (state.operationBusy || active ? ' disabled' : '') + '>Recover original request</button>' : '') +
    '</div>' + (hasOriginalAttempt ? '<p class="field-help">Recovery opens the retained original job and its existing response work.</p>' : '') + '</section>';
}
async function reviewIntent() {
  const taskId = state.taskId, intentId = state.selectedIntent;
  if (!taskId || !intentId || state.reviewBusy) return;
  state.reviewBusy = true; state.review = null; state.reviewIntent = null; clearNotice(); renderTask();
  try {
    const result = await client.reviewTask(taskId,{intentId});
    if (state.taskId !== taskId || state.selectedIntent !== intentId) return;
    if (!result?.reviewId || !result?.review) throw Object.assign(new Error('The native review is incomplete.'),{details:result});
    state.review = result; state.reviewIntent = intentId;
  } catch (error) { notify('The original request could not be reviewed.',error); }
  finally { state.reviewBusy = false; if (state.mode === 'task') renderTask(); }
}
function receiveAllowed() { return state.detail?.locations?.receiveAllowed !== false; }
function receiveLabel() {
  if (!receiveAllowed()) return 'Delivered packet';
  if (receivingActive()) return 'Receiving packet…';
  const previous = [...state.operations.values()].filter((operation) => operation.taskId === state.taskId && operation.kind === 'receive').sort((a,b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))[0];
  return previous && ['failed','interrupted'].includes(previous.state) ? 'Resume receiving' : state.packet ? 'Refresh complete packet' : 'Receive complete packet';
}
function receivingActive() { return [...state.operations.values()].some((operation) => operation.taskId === state.taskId && operation.kind === 'receive' && activeStates.has(operation.state)); }
function rememberOperation(command) {
  state.pending = state.pending.filter((entry) => entry.requestId !== command.requestId);
  state.pending.push(command); writeStored('pending',state.pending);
  routeTo(command.taskId,command.requestId);
}
function forgetPending(requestId) {
  state.pending = state.pending.filter((entry) => entry.requestId !== requestId);
  writeStored('pending',state.pending);
}
function definiteCommandRejection(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const status = Number(error?.status);
  if (!(status >= 400 && status <= 599) || !code || code.startsWith('TASK_DESK_')) return false;
  const explicit = new Set([
    'DESK_SESSION_REQUIRED','DESK_HOST_REJECTED','DESK_ORIGIN_REJECTED','DESK_JSON_REQUIRED',
    'DESK_BODY_LIMIT','DESK_JSON_INVALID','DESK_OBJECT_REQUIRED','DESK_CLOSING',
    'DESK_REQUEST_ID_REQUIRED','DESK_REQUEST_ID_REUSED','DESK_TASK_ID_INVALID',
    'TASK_INTENT_NOT_SELECTED','TASK_MATCHING_REVIEW_REQUIRED','ENOENT','ENOSPC','EDQUOT',
    'EACCES','EPERM','ENOTDIR','PRIVATE_STATE_DIRECTORY_REQUIRED','STATE_DIRECTORY_OWNER_MISMATCH',
    'FILE_SIZE_OR_TYPE_INVALID','JSON_INVALID','JSON_OBJECT_REQUIRED'
  ]);
  return explicit.has(code) || (status < 500 && code.startsWith('TASK_'));
}
function showCommandRejection(error,command) {
  const reviewRequired = error?.code === 'TASK_MATCHING_REVIEW_REQUIRED';
  const sessionRequired = error?.code === 'DESK_SESSION_REQUIRED';
  notify(reviewRequired ? 'Prepare a new native review to continue the original request.' : sessionRequired ? 'Reconnect to the task desk to continue this command’s original work.' : 'The task desk could not accept this command.',error);
  const action = reviewRequired ? 'review-rejected-request' : sessionRequired ? 'reconnect-rejected-request' : 'open-rejected-request';
  const label = reviewRequired ? 'Review original request' : sessionRequired ? 'Reconnect and open original work' : command.intentId ? 'Open original request' : 'Open task';
  $('#global-notice').insertAdjacentHTML('beforeend','<div class="button-row space-before-14"><button class="button" type="button" data-action="' + action + '" data-task-id="' + esc(command.taskId) + '" data-intent-id="' + esc(command.intentId ?? '') + '">' + label + '</button></div>');
}
async function openRejectedCommand(taskId,intentId,{reconnect = false, review = false} = {}) {
  if (!taskId) return;
  if (reconnect) {
    client.clearSession();
    try { state.status = await client.getStatus(); setConnection(true); }
    catch (error) { setConnection(false); notify('Could not reconnect to the original task.',error); return; }
  }
  await showTask(taskId);
  if (state.mode !== 'task' || state.taskId !== taskId || !state.detail?.record) return;
  if (intentId) {
    if (!entriesOf().some((entry) => entry.selection.intentId === intentId)) {
      notify('The original request could not be found in this saved task.',{code:'TASK_INTENT_NOT_SELECTED',message:'Refresh the original task record to inspect its selected requests.',taskId,intentId});
      return;
    }
    state.selectedIntent = intentId; state.activeTab = 'requests'; state.review = null; state.reviewIntent = null;
    renderTask();
    if (review) await reviewIntent();
  }
}
function canResendPending(entry) {
  return ['execute','recover','receive'].includes(entry.kind) && !(entry.kind === 'receive' && entry.taskId === state.taskId && !receiveAllowed()) && entry.payload && entry.payload.requestId === entry.requestId &&
    (entry.kind === 'receive' || (typeof entry.intentId === 'string' && entry.payload.intentId === entry.intentId)) &&
    (entry.kind !== 'execute' || typeof entry.payload.reviewId === 'string');
}
async function startOperation(kind) {
  const taskId = state.taskId, intentId = kind === 'receive' ? null : state.selectedIntent;
  if (!taskId || state.operationBusy || (kind !== 'receive' && !intentId)) return;
  if (kind === 'receive' && !receiveAllowed()) { toast('Open the delivered packet to view its saved responses.'); return; }
  if (kind === 'execute' && (!state.review || state.reviewIntent !== intentId)) { toast('Prepare a current native review first.'); return; }
  const requestId = crypto.randomUUID();
  const payload = {requestId,...(intentId ? {intentId} : {}),...(kind === 'execute' ? {reviewId:state.review.reviewId} : {})};
  const command = {requestId,taskId,intentId,kind,payload,createdAt:new Date().toISOString()};
  rememberOperation(command);
  await submitRecordedCommand(command);
}
async function resendPending(requestId) {
  if (state.operationBusy) return;
  const command = state.pending.find((entry) => entry.requestId === requestId && entry.taskId === state.taskId);
  if (!command || !canResendPending(command)) { toast('Refresh progress to locate the original operation.'); return; }
  if (command.kind === 'receive' && !receiveAllowed()) { toast('Open the delivered packet to view its saved responses.'); return; }
  await submitRecordedCommand(command,{replay:true});
}
async function submitRecordedCommand(command,{replay = false} = {}) {
  const {taskId,intentId,kind,requestId,payload} = command;
  let rejected = false;
  state.operationBusy = true; clearNotice();
  if (kind === 'execute') { state.review = null; state.reviewIntent = null; }
  renderTask();
  try {
    const result = kind === 'execute' ? await client.executeTask(taskId,payload) : kind === 'recover' ? await client.recoverTask(taskId,payload) : await client.receiveTask(taskId,payload);
    if (!result?.operation?.id) throw Object.assign(new Error('The operation reference was not returned. Reading the original saved operation.'),{details:result,requestId});
    mergeOperation(result.operation); forgetPending(requestId);
    if (state.taskId === taskId) state.activeTab = 'operations';
    toast(replay ? 'Original command reference opened.' : kind === 'receive' ? 'Packet receiving started.' : kind === 'recover' ? 'Original request recovery started.' : 'Reviewed request execution started.');
    if (terminalStates.has(result.operation.state) && state.mode === 'task' && state.taskId === taskId) await loadTask(taskId,{quiet:true});
  } catch (error) {
    if (definiteCommandRejection(error)) {
      rejected = true; forgetPending(requestId);
      if (state.mode === 'task' && state.taskId === taskId) {
        routeTo(taskId);
        state.activeTab = kind === 'receive' ? 'packet' : 'requests';
      }
      showCommandRejection(error,command);
    } else {
      const pending = state.pending.find((entry) => entry.requestId === requestId);
      if (pending) pending.error = errorRecord(error);
      writeStored('pending',state.pending);
      await reconcilePending(taskId);
      if (!state.operations.has(requestId)) notify('The operation response was interrupted. Its original reference is retained below.',error);
    }
  } finally {
    state.operationBusy = false;
    if (state.mode === 'task') { if (state.taskId === taskId && !rejected) state.activeTab = 'operations'; renderTask(); }
  }
}
function mergeOperation(operation) {
  if (!operation?.id) return;
  state.operations.set(operation.id,operation); forgetPending(operation.id); state.pollErrors.delete(operation.id);
  if (activeStates.has(operation.state)) startPolling(operation.id);
}
async function reconcilePending(taskId) {
  for (const entry of state.pending.filter((item) => item.taskId === taskId)) {
    if (state.operations.has(entry.requestId)) { forgetPending(entry.requestId); continue; }
    try {
      const result = await client.getOperation(entry.requestId);
      if (result.operation) mergeOperation(result.operation);
    } catch (error) {
      const pending = state.pending.find((item) => item.requestId === entry.requestId);
      if (pending) { pending.lookupError = errorRecord(error); pending.checkedAt = new Date().toISOString(); }
    }
  }
  writeStored('pending',state.pending);
}
function pause(milliseconds, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(done,milliseconds);
    function done() { clearTimeout(timer); signal.removeEventListener('abort',done); resolve(); }
    signal.addEventListener('abort',done,{once:true});
  });
}
function startPolling(operationId) {
  if (pollers.has(operationId)) return;
  const controller = new AbortController(); pollers.set(operationId,controller);
  void (async () => {
    try {
      while (!controller.signal.aborted) {
        const current = state.operations.get(operationId); if (!current || !activeStates.has(current.state)) break;
        await pause(document.hidden ? 5000 : 1400,controller.signal); if (controller.signal.aborted) break;
        const response = await client.getOperation(operationId);
        if (controller.signal.aborted) break;
        if (!response.operation) throw new Error('The saved operation response is incomplete.');
        state.operations.set(operationId,response.operation); state.pollErrors.delete(operationId); setConnection(true);
        refreshProgressMarkup();
        if (terminalStates.has(response.operation.state)) {
          if (response.operation.taskId === state.taskId) {
            state.review = null; state.reviewIntent = null;
            await loadTask(state.taskId,{quiet:true});
          }
          break;
        }
      }
    } catch (error) {
      state.pollErrors.set(operationId,errorRecord(error)); setConnection(false); refreshProgressMarkup();
    } finally { pollers.delete(operationId); }
  })();
}
function progressStrip() {
  const active = [...state.operations.values()].filter((operation) => operation.taskId === state.taskId && activeStates.has(operation.state));
  const pending = state.pending.filter((entry) => entry.taskId === state.taskId);
  if (!active.length && !pending.length) return '';
  return '<div class="notice"><strong>' + (active.length ? active.length + ' operation' + (active.length === 1 ? ' is' : 's are') + ' in progress.' : 'An operation reference is awaiting reconciliation.') + '</strong><button class="text-button" type="button" data-action="tab" data-tab="operations">View saved progress and response details</button></div>';
}
function refreshProgressMarkup() {
  if (state.mode !== 'task') return;
  if ($('#task-progress-strip')) $('#task-progress-strip').innerHTML = progressStrip();
  if (state.activeTab === 'operations' && $('#task-tab-panel')) $('#task-tab-panel').innerHTML = operationsMarkup();
}
function operationLabel(operation) {
  const kind = operation.kind === 'receive' ? 'Receive complete packet' : operation.kind === 'recover' ? 'Recover original request' : operation.kind === 'execute' ? 'Execute reviewed request' : humanize(operation.kind || 'Operation');
  return kind + (operation.intentId ? ' · ' + roleFor(operation.intentId) : '');
}
function operationsMarkup() {
  const operations = [...state.operations.values()].filter((operation) => operation.taskId === state.taskId).sort((a,b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')));
  const pending = state.pending.filter((entry) => entry.taskId === state.taskId);
  return '<section class="panel"><div class="section-heading"><div><h2>Retained operation progress</h2><p class="muted small">Reopen the same saved operation after reconnecting. Progress refreshes read the retained record.</p></div><button class="button" type="button" data-action="refresh-operations">Refresh progress</button></div>' +
    (pending.length ? pending.map((entry) => '<div class="notice"><strong>Reading the original operation reference</strong><p>' + esc(operationLabel(entry)) + '</p><p class="small">The command response has not been matched to its saved record yet. Refresh progress to check this same reference.</p>' +
      (canResendPending(entry) ? '<p class="small">Send the same saved command once to continue an interrupted handoff. The desk returns its original operation if it already accepted the command.</p><div class="button-row"><button class="button" type="button" data-action="resend-pending" data-request-id="' + esc(entry.requestId) + '"' + (state.operationBusy ? ' disabled' : '') + '>Send original command once</button></div>' : '') +
      copyRow('Original operation reference',entry.requestId) + (entry.lookupError ? '<details><summary>Latest lookup result</summary><pre>' + esc(pretty(entry.lookupError)) + '</pre></details>' : '') + (entry.error ? '<details><summary>Original command response</summary><pre>' + esc(pretty(entry.error)) + '</pre></details>' : '') + '</div>').join('') : '') +
    (operations.length ? '<div class="operation-list">' + operations.map(operationMarkup).join('') + '</div>' : '<div class="preview-empty">Review and execute a request, recover its original work, or receive the complete packet. The saved operation will appear here.</div>') + '</section>';
}
function operationMarkup(operation) {
  const active = activeStates.has(operation.state);
  const stateLabels = {queued:'Queued',running:'In progress',succeeded:'Operation finished',failed:'Operation needs attention',interrupted:'Interrupted'};
  const originalRetained = operation.result?.dispatched === false;
  const pollError = state.pollErrors.get(operation.id);
  return '<article class="operation-card"><div class="operation-heading"><div><h3>' + esc(operationLabel(operation)) + '</h3><div class="operation-time">Started ' + esc(formatDate(operation.startedAt)) +
    (operation.finishedAt ? ' · Finished ' + esc(formatDate(operation.finishedAt)) : '') + '</div></div>' + badge(stateLabels[operation.state] ?? humanize(operation.state),active ? 'dashed' : 'strong') + '</div>' +
    (active ? '<div class="operation-progress" aria-label="Operation in progress"></div>' : '') +
    (originalRetained ? '<div class="operation-summary"><strong>Original request retained</strong><p>The native result reopened the existing attempt.</p></div>' : '') +
    (operation.result !== undefined && operation.result !== null ? '<details open><summary>Complete command result</summary>' + nativeObject(operation.result) + '<details><summary>Original result JSON</summary><pre>' + esc(pretty(operation.result)) + '</pre></details></details>' : '') +
    (operation.error ? errorPanel('Operation result',operation.error) : '') +
    (operation.persistenceError ? errorPanel('The final progress record could not be saved.',operation.persistenceError) : '') +
    (pollError ? errorPanel('Progress refresh was interrupted.',pollError,'<div class="button-row"><button class="button small-button" type="button" data-action="reconnect">Reconnect and read progress</button></div>') : '') +
    (operation.kind === 'receive' && ['failed','interrupted'].includes(operation.state) ? '<div class="button-row space-before-14"><button class="button" type="button" data-action="receive-task"' + (!receiveAllowed() || receivingActive() || state.operationBusy ? ' disabled' : '') + '>Resume receiving</button><button class="button quiet" type="button" data-action="tab" data-tab="packet">Open retained packet</button></div>' : '') +
    '<details><summary>Operation reference and complete record</summary>' + copyRow('Operation reference',operation.id) + '<pre>' + esc(pretty(operation)) + '</pre></details></article>';
}

function packetMarkup() {
  const packet = state.packet;
  const saved = state.detail?.inspection?.savedResults ?? packet?.files?.length ?? null;
  const required = state.detail?.inspection?.requiredResults ?? entriesOf().length;
  if (!packet) {
    return '<section class="panel"><div class="section-heading"><div><h2>Complete response packet</h2><p class="muted">' + (saved === null ? 'Refresh the inbox inspection to read current file readiness.' : saved + ' of ' + required + ' selected response files are ready.') + '</p></div><button class="button primary" type="button" data-action="receive-task"' + (!receiveAllowed() || receivingActive() || state.operationBusy ? ' disabled' : '') + '>' + receiveLabel() + '</button></div><div class="preview-empty">Receive this task’s complete packet to retain the full response attachments, native outcomes, and offline report together.</div>' +
      (state.detail?.packetError ? errorPanel('Current packet status',state.detail.packetError) : '') +
      '<div class="button-row space-before-17"><button class="button" type="button" data-action="refresh-packet">Open saved packet</button><button class="button quiet" type="button" data-action="tab" data-tab="operations">View receiving progress</button></div></section>';
  }
  const files = packet.files ?? [], outcomes = packet.outcomes ?? [];
  return '<section class="panel"><div class="packet-header"><div class="packet-note"><p class="eyebrow">RECEIVED RESPONSE PACKET</p><h2>' + esc(packet.task?.title || 'Complete response packet') + '</h2><p class="muted small">' + files.length + ' full response attachment' + (files.length === 1 ? '' : 's') + '. ' +
      (state.detail?.packetOpenedAt ? 'Last opened ' + esc(formatDate(state.detail.packetOpenedAt)) + '.' : '') + '</p></div><div class="button-row"><button class="button primary" type="button" data-action="download-archive"' + (state.downloadBusy ? ' disabled' : '') + '>Download complete packet (.tar)</button><button class="button" type="button" data-action="download-report"' + (state.downloadBusy ? ' disabled' : '') + '>Download report HTML</button></div></div>' +
    '<p class="muted small">Extract the complete packet and open review.html with the response files kept in their original folders. The report’s attachment links use those files.</p>' +
    '<div class="table-wrap"><table class="data-table"><thead><tr><th>Task role</th><th>Response attachment</th><th>Size</th><th>Native outcome</th><th>Download</th></tr></thead><tbody>' +
    files.map((file) => '<tr><td><strong>' + esc(roleFor(file.intentId)) + '</strong></td><td><span class="file-name">' + esc(file.path ? String(file.path).split('/').pop() : 'Saved response') + '</span><div class="muted">' + esc(file.contentType || '') + '</div><details><summary>Complete file identity</summary>' + copyRow('Packet path',file.path) + copyRow('SHA-256',file.sha256) + copyRow('Intent reference',file.intentId) + '</details></td><td>' + esc(formatBytes(file.bytes)) + '</td><td>' + esc(nativeOutcomeText(outcomes.find((outcome) => outcome.intentId === file.intentId))) + recoveredResultMarkup(outcomes.find((outcome) => outcome.intentId === file.intentId)?.recoveredResult,{compact:true}) + '</td><td><button class="button small-button" type="button" data-action="download-response" data-intent-id="' + esc(file.intentId) + '"' + (state.downloadBusy ? ' disabled' : '') + '>Full response</button></td></tr>').join('') +
    '</tbody></table></div>' +
    '<div class="button-row space-before-18"><button class="button" type="button" data-action="refresh-packet">Reopen saved packet</button><button class="button" type="button" data-action="download-packet-json">Download packet metadata</button></div>' +
    '<details class="space-before-15"><summary>Every native outcome and packet record</summary><pre>' + esc(pretty(packet)) + '</pre></details></section>';
}
async function refreshPacket() {
  const taskId = state.taskId, routeVersion = state.routeVersion, loadVersion = ++state.loadVersion;
  const current = () => state.mode === 'task' && state.taskId === taskId && state.routeVersion === routeVersion && state.loadVersion === loadVersion;
  clearNotice();
  try {
    const opened = await client.getPacket(taskId);
    if (!current()) return;
    const detail = await client.getTask(taskId);
    if (!current()) return;
    state.detail = detail; state.packet = detail.packet ?? opened?.packet ?? opened;
    state.loading = false; state.taskError = null; state.review = null; state.reviewIntent = null;
    state.activeTab = 'packet'; renderTask(); toast('Saved response packet opened.');
  } catch (error) {
    if (!current()) return;
    if (state.detail) state.detail.packetError = errorRecord(error);
    state.loading = false; notify('The complete packet could not be opened.',error); renderTask();
  }
}
function versionCandidates() {
  const manifest = state.detail?.record?.manifest, predecessor = manifest?.predecessor;
  if (!predecessor?.taskSha256) return [];
  return state.tasks.filter((entry) => entry.id !== state.taskId && entry.record?.taskSha256 === predecessor.taskSha256 && callerOf(entry).system === manifest.task.system && callerOf(entry).service === manifest.task.service);
}
function versionsMarkup() {
  const versions = versionCandidates();
  const predecessor = state.detail?.record?.manifest?.predecessor;
  if (!versions.some((entry) => entry.id === state.comparisonPreviousId)) {
    state.comparisonPreviousId = versions.find((entry) => entry.record?.taskSha256 === predecessor?.taskSha256)?.id ?? versions[0]?.id ?? '';
  }
  return '<section class="panel"><div class="section-heading"><div><h2>Compare complete task editions</h2><p class="muted small">Compare stable roles, source editions, facilitators, original requests, and selected RPC results against this task’s direct predecessor.</p></div><button class="button" type="button" data-action="revise-task">Create new edition</button></div>' +
    (versions.length ? '<div class="compare-controls"><label><span class="field-caption">Direct predecessor</span><select id="comparison-previous">' +
      versions.map((entry) => '<option value="' + esc(entry.id) + '"' + (state.comparisonPreviousId === entry.id ? ' selected' : '') + '>' + esc(taskTitle(entry) + ' · Revision ' + callerOf(entry).revision + ' · ' + formatDate(entry.record?.createdAt)) + '</option>').join('') +
      '</select></label><button class="button primary" type="button" data-action="compare-versions"' + (state.compareBusy ? ' disabled' : '') + '>' + (state.compareBusy ? 'Comparing editions…' : 'Compare with this task') + '</button></div>' :
      '<div class="preview-empty">' + (predecessor ? 'The direct predecessor is not in the current saved task list. Refresh saved work to load it.' : 'This is the first edition. Create a new edition to retain this task as its direct predecessor and compare the work.') + '</div>') +
    (state.comparison ? comparisonMarkup(state.comparison) : versions.length ? '<div class="preview-empty">Run the native comparison against the direct predecessor. The complete comparison will appear here.</div>' : '') + '</section>';
}
function comparisonMarkup(result) {
  const comparison = result?.comparison ?? result;
  const rows = comparison?.entries ?? [];
  const removed = comparison?.removedRoles ?? [];
  return '<div class="preview-heading"><h3>Native edition comparison</h3><button class="button small-button" type="button" data-action="download-comparison">Download complete comparison</button></div>' +
    (rows.length ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>Stable role</th><th>Changes</th><th>Complete before and after</th></tr></thead><tbody>' +
      rows.map((entry) => {
        const labels = [];
        if (entry.sourceChanged === true) labels.push('Source edition changed');
        if (entry.facilitatorChanged === true) labels.push('Facilitator changed');
        if (entry.requestChanged === true) labels.push('Original request changed');
        if (entry.resultChanged === true) labels.push('Selected RPC result changed');
        if (entry.reusedOriginalIntent === true) labels.push('Original request retained');
        if (!entry.previous && entry.next) labels.push('Role added');
        if (entry.previous && !entry.next) labels.push('Role removed');
        if (!labels.length) labels.push('Role compared');
        return '<tr><td><strong>' + esc(entry.role) + '</strong></td><td><div class="comparison-tags">' + labels.map((label) => badge(label)).join('') + '</div></td><td>' +
          '<details><summary>Earlier complete entry</summary><pre>' + esc(pretty(entry.previous ?? null)) + '</pre></details><details><summary>Current complete entry</summary><pre>' + esc(pretty(entry.next ?? null)) + '</pre></details></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="notice">The native comparison returned no role rows. Its complete result is available below.</div>') +
    (removed.length ? '<div class="notice"><strong>Roles removed from this edition</strong><p>' + esc(removed.map((role) => typeof role === 'string' ? role : scalar(role)).join(', ')) + '</p></div>' : '') +
    '<details class="space-before-16"><summary>Complete native comparison</summary><pre>' + esc(pretty(result)) + '</pre></details>';
}
async function compareVersions() {
  const taskId = state.taskId, previousId = state.comparisonPreviousId;
  if (!previousId || state.compareBusy) return;
  state.compareBusy = true; state.comparison = null; clearNotice(); renderTask();
  try {
    const result = await client.compareTask(taskId,previousId);
    if (state.taskId === taskId && state.comparisonPreviousId === previousId) state.comparison = result;
  } catch (error) { notify('The task editions could not be compared.',error); }
  finally { state.compareBusy = false; if (state.mode === 'task') renderTask(); }
}
function detailsMarkup() {
  const record = state.detail.record;
  const predecessor = record.manifest.predecessor;
  return '<section class="panel"><div class="section-heading"><div><h2>Saved task details</h2><p class="muted small">Created ' + esc(formatDate(record.createdAt)) + '</p></div><button class="button" type="button" data-action="download-task">Download complete task record</button></div>' +
    callerFacts(record.manifest.task) +
    (state.detail.locations ? '<details><summary>Original task and response locations</summary>' + copyRow('Task directory',state.detail.locations.taskDirectory) + copyRow('Response directory',state.detail.locations.outputDirectory) + '<pre>' + esc(pretty(state.detail.locations)) + '</pre></details>' : '') +
    (predecessor ? '<hr class="subtle-divider"><h3>Direct predecessor</h3>' + nativeObject({system:predecessor.system,id:predecessor.id,revision:predecessor.revision}) + copyRow('Predecessor task SHA-256',predecessor.taskSha256) : '') +
    '<details class="space-before-20"><summary>Task identity and source directory</summary>' + copyRow('Saved task reference',state.taskId) + copyRow('Task SHA-256',record.taskSha256) + copyRow('Original inbox directory',record.manifest.inboxDirectory) + '</details>' +
    '<details><summary>Complete saved task record</summary><pre>' + esc(pretty(record)) + '</pre></details>' +
    (state.detail.inspection?.process ? '<details><summary>Current native inspection process</summary><pre>' + esc(pretty(state.detail.inspection.process)) + '</pre></details>' : '') + '</section>';
}
function filename(value, suffix) {
  const name = String(value || 'task').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/\s+/g,'-').replace(/^-+|-+$/g,'').slice(0,110) || 'task';
  return name + suffix;
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.hidden = true; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),60000);
}
function downloadJson(value, suffix) {
  downloadBlob(new Blob([pretty(value) + '\n'],{type:'application/json;charset=utf-8'}),filename(callerOf(state.detail).title,suffix));
}
function startNativeDownload(path, suggestedName) {
  const link = document.createElement('a');
  link.href = new URL(path,location.origin).href;
  link.download = suggestedName; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  toast('Download started.');
}
function downloadResponse(intentId) {
  const file = state.packet?.files?.find((entry) => entry.intentId === intentId);
  if (!file) { toast('Receive the complete packet to download this response.'); return; }
  const query = new URLSearchParams({intentId});
  const path = '/api/tasks/' + encodeURIComponent(state.taskId) + '/packet/download?' + query.toString();
  startNativeDownload(path,String(file.path ?? '').split('/').pop() || filename(roleFor(intentId),'-response.bin'));
}
function downloadArchive() {
  if (!state.packet) { toast('Receive the complete packet before downloading it.'); return; }
  startNativeDownload('/api/tasks/' + encodeURIComponent(state.taskId) + '/packet/archive',filename(callerOf(state.detail).title,'-complete-packet.tar'));
}
async function downloadReport() {
  if (state.downloadBusy) return;
  const taskId = state.taskId;
  state.downloadBusy = true; clearNotice(); renderTask();
  try {
    const html = await client.getPacketReview(taskId);
    downloadBlob(new Blob([html],{type:'text/html;charset=utf-8'}),'review.html');
    toast('Report downloaded. Keep it with the extracted packet attachments.');
  } catch (error) { notify('The packet report could not be downloaded.',error); }
  finally { state.downloadBusy = false; if (state.mode === 'task') renderTask(); }
}
async function copyValue(value) {
  try { await navigator.clipboard.writeText(value); toast('Copied.'); }
  catch {
    const field = document.createElement('textarea'); field.value = value; field.className = 'clipboard-field';
    document.body.append(field); field.select();
    try { if (!document.execCommand('copy')) throw new Error('Copy unavailable'); toast('Copied.'); }
    catch { toast('Copy is unavailable. Select the reference text in Details.'); }
    finally { field.remove(); }
  }
}
async function refreshOperations() {
  const taskId = state.taskId;
  if (!taskId || state.mode !== 'task') return;
  clearNotice(); state.review = null; state.reviewIntent = null;
  await loadTask(taskId,{quiet:true});
}
async function refreshPickerJobs() {
  $('#job-picker-refresh').disabled = true;
  try {
    const result = await client.listJobs(); state.jobs = result.jobs ?? []; state.process = result.process ?? null;
    invalidatePreview(); renderJobPicker(); toast('Original inbox refreshed.');
  } catch (error) { notify('The original inbox could not be refreshed.',error); }
  finally { $('#job-picker-refresh').disabled = false; }
}
async function act(button) {
  const action = button.dataset.action;
  if (button.disabled) return;
  if (action === 'copy') return copyValue(button.dataset.value ?? '');
  if (action === 'new-task') return showNewTask();
  if (action === 'refresh') return refreshDesk();
  if (action === 'reconnect') return refreshDesk({reconnect:true});
  if (action === 'review-rejected-request') return openRejectedCommand(button.dataset.taskId,button.dataset.intentId,{review:true});
  if (action === 'reconnect-rejected-request') return openRejectedCommand(button.dataset.taskId,button.dataset.intentId,{reconnect:true});
  if (action === 'open-rejected-request') return openRejectedCommand(button.dataset.taskId,button.dataset.intentId);
  if (action === 'revise-task') return showNewTask(state.detail);
  if (action === 'add-selection') {
    if (state.draft.selections.length < 500) { state.draft.selections.push({intentId:'',role:''}); invalidatePreview(); renderDraft(); }
    return;
  }
  if (action === 'remove-selection') { state.draft.selections.splice(Number(button.dataset.index),1); invalidatePreview(); renderDraft(); return; }
  if (action === 'pick-jobs') return openJobPicker();
  if (action === 'rpc-list') return listRpcReads(button);
  if (action === 'rpc-inspect') return inspectRpcRead(button);
  if (action === 'rpc-use') return inspectRpcRead(button,true);
  if (action === 'rpc-download') return downloadRpcRead(button);
  if (action === 'rpc-clear') {
    const selection = state.draft?.selections[Number(button.dataset.rpcIndex)];
    if (state.mode === 'draft' && !state.rpcSelecting && !state.saveBusy && selection?.intentId === button.dataset.rpcIntent) {
      delete selection.rpcResult; invalidatePreview(); renderDraft();
    }
    return;
  }
  if (action === 'preview-task') return previewTask();
  if (action === 'save-task') return saveTask();
  if (action === 'select-intent') {
    state.selectedIntent = button.dataset.intentId; state.review = null; state.reviewIntent = null; renderTask(); return;
  }
  if (action === 'tab') { state.activeTab = button.dataset.tab; renderTask(); return; }
  if (action === 'review-intent') return reviewIntent();
  if (action === 'execute-intent') return startOperation('execute');
  if (action === 'recover-intent') return startOperation('recover');
  if (action === 'receive-task') return startOperation('receive');
  if (action === 'resend-pending') return resendPending(button.dataset.requestId);
  if (action === 'refresh-operations') return refreshOperations();
  if (action === 'refresh-packet') return refreshPacket();
  if (action === 'compare-versions') return compareVersions();
  if (action === 'download-response') return downloadResponse(button.dataset.intentId);
  if (action === 'download-archive') return downloadArchive();
  if (action === 'download-report') return downloadReport();
  if (action === 'download-packet-json') return downloadJson(state.packet,'-packet.json');
  if (action === 'download-comparison') return downloadJson(state.comparison,'-comparison.json');
  if (action === 'download-task') return downloadJson(state.detail.record,'-task.json');
}
function catchAction(promise) { Promise.resolve(promise).catch((error) => notify('The desk action could not be completed.',error)); }

main.addEventListener('click',(event) => {
  const button = event.target.closest('[data-action]'); if (button && main.contains(button)) catchAction(act(button));
});
$('#global-notice').addEventListener('click',(event) => {
  const button = event.target.closest('[data-action]'); if (button) catchAction(act(button));
});
main.addEventListener('input',(event) => {
  const target = event.target;
  if (target.dataset.rpcCommerce !== undefined) {
    state.rpcDirectories.set(target.dataset.rpcCommerce,target.value);
    const results = target.closest('.rpc-picker')?.querySelector('.rpc-read-results');
    if (results) results.innerHTML = '<p class="muted small">Inspect saved reads for the selected commerce directory.</p>';
  }
  if (target.dataset.draftField && state.draft) { state.draft.task[target.dataset.draftField] = target.value; invalidatePreview(); }
  if (target.dataset.selectionField && state.draft) {
    const selection = state.draft.selections[Number(target.dataset.index)];
    if (selection) {
      if (target.dataset.selectionField === 'intentId' && selection.intentId !== target.value) delete selection.rpcResult;
      selection[target.dataset.selectionField] = target.value; invalidatePreview();
    }
  }
});
main.addEventListener('change',(event) => {
  const target = event.target;
  if (target.dataset.selectionField === 'intentId' && state.draft) {
    const selection = state.draft.selections[Number(target.dataset.index)];
    if (selection) { selection.intentId = target.value; invalidatePreview(); renderDraft(); }
  }
  if (target.id === 'comparison-previous') { state.comparisonPreviousId = target.value; state.comparison = null; }
});
main.addEventListener('submit',(event) => {
  if (event.target.id === 'new-task-form') { event.preventDefault(); catchAction(previewTask()); }
});
main.addEventListener('keydown',(event) => {
  if (event.target.getAttribute('role') !== 'tab' || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  const keys = ['requests','operations','packet','customer','versions','details'];
  const position = keys.indexOf(state.activeTab);
  state.activeTab = event.key === 'Home' ? keys[0] : event.key === 'End' ? keys.at(-1) : keys[(position + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length];
  event.preventDefault(); renderTask(); main.querySelector('[role="tab"][aria-selected="true"]')?.focus();
});
$('#task-list').addEventListener('click',(event) => {
  const button = event.target.closest('[data-task-id]'); if (button) catchAction(showTask(button.dataset.taskId));
});
$('#task-search').addEventListener('input',(event) => { state.search = event.target.value; renderSidebar(); });
$('#new-task-button').addEventListener('click',() => showNewTask());
$('#refresh-all-button').addEventListener('click',() => catchAction(refreshDesk()));
$('#reconnect-button').addEventListener('click',() => catchAction(refreshDesk({reconnect:true})));
$('#sidebar-toggle').addEventListener('click',() => sidebarOpen(!document.body.classList.contains('sidebar-open')));
$('#sidebar-close').addEventListener('click',() => sidebarOpen(false));
$('#sidebar-backdrop').addEventListener('click',() => sidebarOpen(false));
$('#job-picker-close').addEventListener('click',() => $('#job-picker').close());
$('#job-picker-add').addEventListener('click',addPickedJobs);
$('#job-picker-refresh').addEventListener('click',() => catchAction(refreshPickerJobs()));
$('#job-search').addEventListener('input',(event) => { state.pickerSearch = event.target.value; renderJobPicker(); });
$('#job-picker-list').addEventListener('change',(event) => {
  const intentId = event.target.dataset.pickerIntent;
  if (!intentId) return;
  if (event.target.checked) {
    if (state.draft.selections.filter((selection) => selection.intentId).length + state.pickerChecked.size >= 500) {
      event.target.checked = false; toast('A task can include up to 500 original requests.'); return;
    }
    state.pickerChecked.add(intentId);
  } else state.pickerChecked.delete(intentId);
  $('#job-picker-count').textContent = state.pickerChecked.size + ' selected to add'; $('#job-picker-add').disabled = !state.pickerChecked.size;
});
$('#job-picker-list').addEventListener('click',(event) => {
  const button = event.target.closest('[data-action="copy"]'); if (button) catchAction(copyValue(button.dataset.value ?? ''));
});
document.addEventListener('keydown',(event) => { if (event.key === 'Escape') sidebarOpen(false); });
window.addEventListener('hashchange',() => {
  if (location.hash === '#new') { showNewTask(); return; }
  const route = new URLSearchParams(location.hash.slice(1));
  if (route.get('task')) catchAction(showTask(route.get('task'),{operationId:route.get('operation')}));
  else { state.mode = 'home'; sidebarOpen(false); renderSidebar(); renderHome(); }
});
window.addEventListener('pagehide',() => { for (const controller of pollers.values()) controller.abort(); pollers.clear(); });
window.addEventListener('pageshow',(event) => {
  if (event.persisted) catchAction(refreshDesk({reconnect:true}));
});
state.pending = Array.isArray(state.pending) ? state.pending.filter((entry) => entry && typeof entry.requestId === 'string' && typeof entry.taskId === 'string') : [];
void refreshDesk({initial:true});
