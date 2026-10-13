import {mountProviderWorkflows} from "./provider_workflows.mjs";
const $ = id => document.getElementById(id);
const tokenKey = 'source-workflow-connection:' + location.origin;
let token = location.hash.slice(1);
try { if (token) sessionStorage.setItem(tokenKey, token); else token = sessionStorage.getItem(tokenKey) || ''; } catch {}
history.replaceState(null, '', location.pathname);
const state = {configuration: null, requests: [], selected: null, detail: null, tab: 'request', generation: 0, loading: false, actions: new Set(), intakeConfiguration: null};
const draftKey = 'source-workflow-draft:' + location.origin;
const labels = {RECEIVED: 'Received', RUNNING: 'Processing', FAILED: 'Continue required', RESULT_READY: 'Result ready', PUBLISHED: 'Published', DELIVERED: 'Customer received'};
function message(text, error = false) { $('notice').textContent = text; $('notice').className = 'visible' + (error ? ' error' : ''); }
function pretty(value) { return JSON.stringify(value ?? {}, null, 2); }
function timestamp(value) { return value ? new Date(value).toLocaleString() : ''; }
function size(bytes) { return bytes < 1024 ? bytes + ' B' : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB'; }
function button(text, action, className = 'secondary') { const e = document.createElement('button'); e.type = 'button'; e.textContent = text; e.className = className; e.addEventListener('click', action); return e; }
function textNode(tag, text, className) { const e = document.createElement(tag); e.textContent = text; if (className) e.className = className; return e; }
function route(id, action = '') { return '/api/requests/' + encodeURIComponent(id) + (action ? '/' + action : ''); }
function actionKey(id, name) { return JSON.stringify([id, name === 'export-supplier' ? 'export' : name]); }
function busy(id, name) { return state.actions.has(actionKey(id, name)); }
async function api(path, body) {
  const response = await fetch(path, {method: body === undefined ? 'GET' : 'POST', headers: {'X-Workflow-Capability': token, ...(body === undefined ? {} : {'Content-Type': 'application/json'})}, body: body === undefined ? undefined : JSON.stringify(body)});
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || value.error || 'The original operation could not be read.');
  return value;
}
function saveBlob(name, blob) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
function saveJSON(name, value) { saveBlob(name, new Blob([pretty(value) + '\n'], {type: 'application/json'})); }
async function download(id, file) {
  try {
    message('Receiving ' + file.name + '…');
    const response = await fetch(route(id, 'files/' + encodeURIComponent(file.name)), {headers: {'X-Workflow-Capability': token}});
    if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'The original file is unavailable.'); }
    const bytes = await response.arrayBuffer();
    const expected = response.headers.get('X-Content-SHA256');
    const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    if (bytes.byteLength !== file.bytes || actual !== file.sha256 || actual !== expected) throw new Error('The file transfer is incomplete. Download the same original file again.');
    saveBlob(file.name, new Blob([bytes], {type: file.contentType || 'application/octet-stream'}));
    message(file.name + ' received in full.');
  } catch (error) { message(error.message, true); }
}
function table(headers, rows) {
  const wrap = document.createElement('div'); wrap.className = 'table-wrap';
  const grid = document.createElement('table'), head = grid.createTHead().insertRow(), body = grid.createTBody();
  for (const h of headers) head.append(textNode('th', h));
  for (const row of rows) { const tr = body.insertRow(); for (const value of row) { const td = tr.insertCell(); if (value instanceof Node) td.append(value); else td.textContent = String(value ?? ''); } }
  wrap.append(grid); return wrap;
}

function configuredQueries(configuration = state.configuration) {
  if (Array.isArray(configuration?.queries) && configuration.queries.length) return configuration.queries;
  return configuration?.query ? [configuration.query] : [];
}
function requiredParameterNames(configuration = state.intakeConfiguration || state.configuration) {
  return [...new Set(configuredQueries(configuration).flatMap(query => Array.isArray(query.parameterNames) ? query.parameterNames : []).filter(name => typeof name === 'string' && name.length))];
}
function renderConfiguration() {
  const configuration = state.intakeConfiguration || state.configuration, host = $('installed-profile');
  host.replaceChildren();
  $('configuration').hidden = !configuration?.configured;
  const required = requiredParameterNames();
  $('parameter-help').textContent = required.length
    ? 'Required JSON keys: ' + required.join(', ') + '. Values are passed unchanged to the installed queries.'
    : 'Enter a JSON object. The installed queries do not require named parameters.';
  if (!configuration?.configured) return;
  const queries = configuredQueries(configuration), sources = Array.isArray(configuration.sources) ? configuration.sources : [];
  $('configuration-title').textContent = (configuration.title || configuration.profile || 'Installed workflow') +
    ' · ' + sources.length + ' sources · ' + queries.length + ' queries';
  if (sources.length) {
    host.append(textNode('h3', 'Original sources'));
    host.append(table(['Alias', 'Source type', 'Title'], sources.map(source => [source.alias, source.kind, source.title])));
  }
  if (queries.length) {
    host.append(textNode('h3', 'Installed queries'));
    host.append(table(['Query', 'Required parameters', 'Row limit', 'Definition'], queries.map(query => {
      const definition = document.createElement('details');
      definition.append(textNode('summary', 'SQL'), textNode('pre', query.sql || ''));
      if (query.note) definition.append(textNode('p', query.note, 'muted'));
      const names = Array.isArray(query.parameterNames) ? query.parameterNames : [];
      return [query.title || query.name || 'Source query', names.length ? names.join(', ') : 'None', query.maxRows ?? 'Profile default', definition];
    })));
  }
  if (configuration.report) {
    host.append(textNode('h3', 'Report'));
    if (configuration.report.title) host.append(textNode('p', configuration.report.title));
    if (configuration.report.introduction) host.append(textNode('p', configuration.report.introduction));
    if (configuration.report.note) host.append(textNode('p', configuration.report.note, 'muted'));
  }
  if (configuration.supplier?.enabled) {
    const bindings = configuration.supplier.sourceBindings || {};
    host.append(textNode('h3', 'Supplier review'));
    if (Object.keys(bindings).length) host.append(table(['Source alias', 'Review edition'], Object.entries(bindings)));
    if (configuration.supplier.coverage) host.append(textNode('p', 'Catalogue coverage is included with the original price and catalogue sources.', 'muted'));
  }
}

function filesView(element, id, files) {
  element.replaceChildren();
  if (!files.length) { element.append(textNode('p', 'The original operation will place its complete files here.', 'muted')); return; }
  element.append(table(['Original file', 'Size', ''], files.map(file => [file.name, size(file.bytes), button('Download', () => download(id, file))])));
}
function renderList() {
  const query = $('search').value.toLowerCase();
  $('counts').textContent = state.requests.length + ' requests · ' + state.requests.filter(r => r.resultSha256).length + ' results';
  $('requests').replaceChildren();
  for (const row of state.requests.filter(r => (r.requestId + ' ' + r.correlationId + ' ' + r.status).toLowerCase().includes(query))) {
    const card = button('', () => select(row.requestId), 'request-card'); card.setAttribute('aria-current', String(row.requestId === state.selected));
    card.append(textNode('strong', row.requestId), textNode('span', row.status === 'RUNNING' && !row.active ? 'Continue required' : labels[row.status] || row.status), textNode('span', timestamp(row.updatedAt)));
    $('requests').append(card);
  }
}
function selectTab(tab) {
  state.tab = tab;
  for (const e of document.querySelectorAll('[data-tab]')) e.setAttribute('aria-selected', String(e.dataset.tab === tab));
  for (const name of ['request', 'result', 'delivery', 'history']) $('tab-' + name).hidden = name !== tab;
}
function renderDetail(detail) {
  state.detail = detail; const selectedConfiguration = detail.configuration || state.configuration; $('empty').hidden = true; $('detail').hidden = false;
  $('title').textContent = detail.requestId; $('request-meta').textContent = 'Correlation: ' + detail.correlationId + ' · Updated ' + timestamp(detail.updatedAt);
  $('state').textContent = detail.status === 'RUNNING' && !detail.active ? 'Continue required' : labels[detail.status] || detail.status;
  $('request-body').textContent = pretty(detail.request);
  $('operation-error').hidden = !detail.error;
  $('operation-error').textContent = detail.error ? detail.error.message : '';
  $('run').disabled = !selectedConfiguration?.configured || Boolean(detail.active) || Boolean(detail.result);
  const result = detail.result;
  $('result-summary').textContent = result ? (result.analysis?.status === 'PARTIAL' ? 'The native report returned a partial outcome. Review its query limits and report details below.' : 'Complete native files from this original source and report operation.') : 'Run or continue the request to acquire its source and reports.';
  $('edition').textContent = pretty(result?.edition); $('analysis').textContent = pretty(result?.analysis); $('native-ids').textContent = pretty(result?.nativeIds);
  const supplier = result?.supplier;
  $('supplier-review').hidden = !supplier;
  $('supplier-comparison').replaceChildren();
  if (supplier) $('supplier-comparison').append(table(
    ['Supplier request', 'Comparison', 'Revision', 'Review status'],
    [[supplier.requestId, supplier.comparisonId, supplier.revision, supplier.status]]
  ));
  $('export-supplier').disabled = !result;

  filesView($('result-files'), detail.requestId, result ? [...(result.files || []), ...(result.archive ? [result.archive] : [])] : []);
  filesView($('exports'), detail.requestId, detail.exports || []);
  $('export').disabled = !result; $('prepare-jms').disabled = !result || !selectedConfiguration?.jms;
  $('callback').disabled = !result || !selectedConfiguration?.callback;
  $('callback').textContent = detail.publications.some(p => p.kind === 'CALLBACK' && p.status === 'RETRYABLE') ? 'Resume result callback' : 'Send result callback';
  $('publications').replaceChildren();
  if (detail.publications.length) $('publications').append(table(['Method', 'Attempt', 'State', 'Updated'], detail.publications.map(p => [p.kind, p.attemptId, p.status, timestamp(p.finishedAt || p.startedAt)])));
  else $('publications').append(textNode('p', 'Prepared and completed deliveries appear here.', 'muted'));
  $('history').replaceChildren();
  for (const event of [...(detail.history || [])].reverse()) {
    const line = document.createElement('details'); line.className = 'history-item';
    const summary = document.createElement('summary'); summary.append(textNode('strong', event.kind.replaceAll('_', ' ')), textNode('time', timestamp(event.at)));
    line.append(summary, textNode('pre', pretty(event.value))); $('history').append(line);
  }
  for (const name of ['run', 'export', 'export-supplier', 'prepare-jms', 'callback']) {
    if (busy(detail.requestId, name)) $(name).disabled = true;
  }
  $('record-return').disabled = busy(detail.requestId, 'record-return');
  selectTab(state.tab);
}
async function select(id) {
  state.selected = id; state.detail = null; state.generation++;
  $('detail').hidden = true; $('empty').hidden = false; renderList();
  try { await refreshDetail(); } catch (error) { message(error.message, true); }
}
async function refreshDetail() {
  const id = state.selected, generation = state.generation;
  if (!id) return;
  const detail = await api(route(id) + '?history=true');
  if (state.selected === id && state.generation === generation) renderDetail(detail);
}
async function refresh(silent = false) {
  if (state.loading) return;
  state.loading = true;
  try {
    const [requests, inbox] = await Promise.all([api('/api/requests'), api('/api/inbox')]);
    state.requests = requests.requests; renderList();
    $('inbox').replaceChildren();
    for (const receipt of inbox.results) $('inbox').append(button(receipt.requestId + ' · ' + timestamp(receipt.receivedAt), () => saveJSON('Customer_Received_' + receipt.deliveryId + '.json', receipt)));
    if (!inbox.results.length) $('inbox').append(textNode('p', 'Customer result messages are retained here.', 'muted'));
    await refreshDetail();
  } catch (error) { if (!silent) message(error.message, true); }
  finally { state.loading = false; }
}
function intake(open = true) { $('intake').hidden = !open; if (!open) state.intakeConfiguration = null; renderConfiguration(); if (open) { $('configuration-details').open = true; $('request-id').focus(); } }
function readDraft() { try { return JSON.parse(localStorage.getItem(draftKey) || '{}'); } catch { return {}; } }
function storeDraft() { try { localStorage.setItem(draftKey, JSON.stringify({id: $('request-id').value, correlation: $('correlation-id').value, parameters: $('parameters').value, parent: $('parent-request-id').value, configuration: state.intakeConfiguration})); } catch {} }
async function act(name, action) {
  const control = $(name), id = state.selected; if (!id || busy(id, name)) return;
  const key = actionKey(id, name);
  state.actions.add(key); control.disabled = true;
  if (state.detail?.requestId === id) renderDetail(state.detail);
  try { await action(id); await refresh(); } catch (error) { message(error.message, true); }
  finally {
    state.actions.delete(key); control.disabled = false;
    if (state.detail && state.selected === state.detail.requestId) renderDetail(state.detail);
  }
}
$('search').addEventListener('input', renderList);
$('refresh').addEventListener('click', () => refresh());
$('new-request').addEventListener('click', () => { state.intakeConfiguration = null; $('parent-request-id').value = ''; storeDraft(); intake(); });
$('cancel-intake').addEventListener('click', () => intake(false));
for (const e of document.querySelectorAll('[data-tab]')) e.addEventListener('click', () => selectTab(e.dataset.tab));
for (const id of ['request-id', 'correlation-id', 'parameters']) $(id).addEventListener('input', storeDraft);
$('intake-form').addEventListener('submit', async event => {
  event.preventDefault();
  const request = {schema: 'stellar-forge.source-workflow-request.v1', requestId: $('request-id').value.trim(), profile: (state.intakeConfiguration || state.configuration)?.profile, parameters: {}};
  try {
    request.parameters = JSON.parse($('parameters').value);
    if (!request.parameters || typeof request.parameters !== 'object' || Array.isArray(request.parameters)) throw new Error('Business parameters must be a JSON object.');
    const missing = requiredParameterNames().filter(name => !Object.prototype.hasOwnProperty.call(request.parameters, name));
    if (missing.length) throw new Error('Add the required business parameter' + (missing.length === 1 ? ': ' : 's: ') + missing.join(', ') + '. Your draft is retained.');
    if ($('correlation-id').value.trim()) request.correlationId = $('correlation-id').value.trim();
    if ($('parent-request-id').value) request.parentRequestId = $('parent-request-id').value;
    const priorDraft = JSON.stringify(readDraft());
    const received = await api('/api/requests', {request});
    if (JSON.stringify(readDraft()) === priorDraft) { intake(false); }
    await select(received.requestId); await refresh(); message('Original request retained. Run or continue its source and report operation.');
  } catch (error) { message(error.message, true); }
});
$('successor').addEventListener('click', () => {
  const request = state.detail?.request; if (!request) return;
  $('request-id').value = ''; $('correlation-id').value = ''; $('parameters').value = pretty(request.parameters);
  $('parent-request-id').value = request.requestId; state.intakeConfiguration = state.detail.configuration || state.configuration; storeDraft(); intake();
});
$('run').addEventListener('click', () => act('run', async id => { await api(route(id, 'run'), {}); message('The original native operation is running. Source and report progress remains in its history.'); }));
for (const control of ['export', 'export-supplier']) $(control).addEventListener('click', () => act(control, async id => {
  message('Preparing the complete editable project…');
  const value = await api(route(id, 'export'), {});
  await download(id, {...value.archive, contentType: 'application/zip'});
}));
$('prepare-jms').addEventListener('click', () => act('prepare-jms', async id => {
  const existing = state.detail.publications.find(p => p.kind === 'JMS' && p.status === 'PREPARED');
  const attemptId = existing?.attemptId || 'jms-' + crypto.randomUUID();
  const value = await api(route(id, 'publish'), {attemptId});
  saveJSON('JMS_Result_' + value.deliveryId + '.json', value.jms);
  $('return-attempt').value = attemptId; message('Original JMS result prepared for attempt ' + attemptId + '.');
}));
$('callback').addEventListener('click', () => act('callback', async id => {
  const existing = state.detail.publications.find(p => p.kind === 'CALLBACK' && ['RETRYABLE', 'PREPARED', 'DISPATCHING'].includes(p.status));
  await api(route(id, 'callback'), {attemptId: existing?.attemptId || 'callback-' + crypto.randomUUID()});
  message('The configured callback is continuing with the original delivery identity.');
}));
$('record-return').addEventListener('click', () => act('record-return', async id => {
  const value = JSON.parse($('return-json').value);
  if (value.schema === 'stellar-forge.source-workflow-receipt.v1') await api(route(id, 'acknowledge'), value);
  else await api(route(id, 'published'), {attemptId: $('return-attempt').value, messagesCount: value.messagesCount, response: value});
  message('Original returned result recorded.');
}));
async function start() {
  if (!token) { message('Open the complete local operator URL printed by the original serve command.', true); return; }
  try {
    state.configuration = await api('/api/configuration');
    $('profile').textContent = state.configuration.title || 'Receiver';
    $('installation').textContent = state.configuration.configured ? 'Installed workflow: ' + state.configuration.profile + ' · Source: ' + state.configuration.sourceKind : 'This operator can receive results and reopen delivered projects.';
    $('new-request').disabled = !state.configuration.configured;
    renderConfiguration();
    const draft = readDraft(); state.intakeConfiguration = draft.parent && draft.configuration?.configured ? draft.configuration : null; $('request-id').value = draft.id || ''; $('correlation-id').value = draft.correlation || ''; $('parameters').value = draft.parameters || '{}'; $('parent-request-id').value = draft.parent || '';
    await refresh();
    if (state.requests.length) await select(state.requests[0].requestId);
    else $('configuration-details').open = true;
    setInterval(() => { if (!document.hidden) refresh(true); }, 5000);
  } catch (error) { message(error.message, true); }
}
const providerDesk = mountProviderWorkflows({
  root: $('provider-workspace'), api, notify: message,
  request: (path, options = {}) => fetch(path, {...options, headers: {...(options.headers || {}), 'X-Workflow-Capability': token}}),
  onOpenRequest: async id => { selectWorkspaceMode('requests'); await refresh(); await select(id); }
});
async function selectWorkspaceMode(mode) {
  const providers = mode === 'providers';
  $('business-workspace').hidden = providers; $('provider-workspace').hidden = !providers;
  $('workspace-requests').setAttribute('aria-pressed', String(!providers));
  $('workspace-providers').setAttribute('aria-pressed', String(providers));
  if (providers) await providerDesk.start();
}
$('workspace-requests').addEventListener('click', () => selectWorkspaceMode('requests'));
$('workspace-providers').addEventListener('click', () => selectWorkspaceMode('providers'));
start();
