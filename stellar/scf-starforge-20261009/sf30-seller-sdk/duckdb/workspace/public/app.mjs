// MIT. Private industrial operator UI; original plan JSON remains the interchange format.
import { mountQueryAuthor } from './author.mjs';
import { mountCloudDelivery } from '/cloud.mjs';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pretty = value => JSON.stringify(value, null, 2);
const short = value => value ? value.slice(0, 12) : '—';
const moment = value => value ? new Date(value).toLocaleString() : '—';
const bytes = value => Number(value ?? 0).toLocaleString() + ' bytes';
const storageKey = () => 'duckdb-workspace-editor:' + data.workspaceId;
const urlKey = new URLSearchParams(location.hash.slice(1)).get('key');
if (urlKey) { sessionStorage.setItem('duckdb-workspace-key', urlKey); history.replaceState(null, '', location.pathname); }
const key = urlKey ?? sessionStorage.getItem('duckdb-workspace-key');
let data, editor, revision = 0, dirty = false, busy = false, review = null;
let selectedQuery = '', selectedRoute = 0, selectedPackage = '', activeTab = 'queries', previewResult;
const previewInputs = new Map();
let cloudUi;

function report(message, error = false) {
  const box = $('#message'); box.hidden = !message; box.textContent = message;
  box.classList.toggle('error', error);
}
function setBusy(value) {
  busy = value; document.body.classList.toggle('busy', value);
  for (const button of document.querySelectorAll('button')) button.disabled = value || button.dataset.disabled === 'true';
  for (const input of document.querySelectorAll('input,textarea,select')) input.disabled = value || input.dataset.disabled === 'true';
}
async function api(path, payload, options = {}) {
  const binary = options.binary === true;
  const response = await fetch(path, { method: options.method ?? (payload === undefined ? 'GET' : 'POST'),
    headers: { 'x-duckdb-workspace': key ?? '', ...(payload === undefined ? {} : {
      'content-type': binary ? 'application/octet-stream' : 'application/json' }) },
    ...(payload === undefined ? {} : { body: binary ? payload : JSON.stringify(payload) }) });
  let value;
  try { const text = await response.text(); value = text ? JSON.parse(text) : {}; }
  catch {
    const error = new Error('The workspace response was interrupted or unreadable. Refresh its retained operation before retrying.');
    error.status = response.status; throw error;
  }
  if (!response.ok) {
    const error = new Error(value.message ?? value.error ?? 'The operation could not complete.');
    error.code = value.error; error.status = response.status; throw error;
  }
  return value;
}
async function perform(label, action) {
  if (busy) return;
  setBusy(true); report(label);
  try { await action(); }
  catch (error) { report(error.message + (error.code ? ' (' + error.code + ')' : ''), true); }
  finally { setBusy(false); }
}
function toEditor(plan, authoring = []) {
  const copy = structuredClone(plan);
  return { extra: copy, authoring: structuredClone(authoring), authoredSpecs: {},
    origin: copy.publicOrigin ?? '', paymentText: pretty(copy.paymentOptions ?? (copy.payment ? [copy.payment] : [])),
    routes: (copy.routes ?? []).map(route => ({ ...route, exampleText: pretty(route.example ?? {}),
      descriptionsText: pretty(route.parameterDescriptions ?? {}),
      paymentText: route.paymentOptions || route.payment ? pretty(route.paymentOptions ?? [route.payment]) : '',
      tagsText: (route.tags ?? []).join(', ') })) };
}
function parse(text, label) {
  try { return JSON.parse(text); }
  catch { throw new Error(label + ' must be valid JSON. Your edits remain in the form.'); }
}
function planValue() {
  const plan = { ...editor.extra, publicOrigin: editor.origin,
    paymentOptions: parse(editor.paymentText, 'Default payment options'),
    routes: editor.routes.map(route => {
      const value = { ...route, example: parse(route.exampleText, 'Public example for ' + route.id),
        parameterDescriptions: parse(route.descriptionsText, 'Parameter descriptions for ' + route.id) };
      delete value.exampleText; delete value.descriptionsText; delete value.paymentText; delete value.tagsText;
      delete value.payment; delete value.paymentOptions;
      if (route.tagsText.trim()) value.tags = route.tagsText.split(',').map(tag => tag.trim()).filter(Boolean);
      else delete value.tags;
      if (route.paymentText.trim()) value.paymentOptions = parse(route.paymentText, 'Payment options for ' + route.id);
      return value;
    }) };
  delete plan.payment; return plan;
}
function remember() {
  try { sessionStorage.setItem(storageKey(), JSON.stringify({ editor, revision,
    sourceSha256: data.source.sourceSha256, selectedRoute })); } catch {}
}
function markEdited() {
  dirty = true; review = null; $('#plan-review').hidden = true;
  $('#edit-status').textContent = 'Unsaved edits · based on revision ' + revision;
  remember();
}
function showTab(name) {
  activeTab = name;
  if (name === 'cloud') cloudUi?.render(data?.cloud);
  for (const node of document.querySelectorAll('.tab-panel')) node.hidden = node.id !== name;
  for (const button of document.querySelectorAll('[data-tab]')) {
    if (button.dataset.tab === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}
function table(columns, rows) {
  return '<div class="table-wrap"><table><thead><tr>' + columns.map(c => '<th>' + esc(c) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(c => '<td class="mono">' + esc(typeof c === 'object' && c !== null ? JSON.stringify(c) : c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}
function querySpecs() {
  const queries = { ...data.source.queries };
  const names = new Set((editor.authoring ?? []).map(entry => entry.plan.queryName));
  for (const entry of data.draft?.authoring ?? []) if (!names.has(entry.plan.queryName)) delete queries[entry.plan.queryName];
  for (const [name, spec] of Object.entries(editor.authoredSpecs ?? {})) if (names.has(name)) queries[name] = spec;
  return queries;
}
function queryList() {
  const queries = querySpecs();
  if (!Object.hasOwn(queries, selectedQuery)) selectedQuery = Object.keys(queries)[0] ?? '';
  $('#query-list').innerHTML = Object.entries(queries).map(([name, spec]) => '<button type="button" data-query="' + esc(name) + '" class="' + (selectedQuery === name ? 'selected' : '') + '"><span class="item-title">' + esc(name) + '</span><span class="item-meta">' + spec.columns.length + ' columns · ' + Object.keys(spec.parameters).length + ' parameters</span></button>').join('') || '<p class="empty">No approved queries available.</p>';
  $('#source-detail').innerHTML = '<p>' + esc(data.source.mode) + '</p><p>' + data.source.approvedFileCount + ' declared files<br>' + esc(bytes(data.source.datasetBytes)) + '</p><p class="mono">' + esc(short(data.source.sourceSha256)) + '</p>';
  const spec = queries[selectedQuery];
  if (spec) {
    $('#query-description').innerHTML = '<h3>' + esc(selectedQuery) + '</h3><p class="mono">' + spec.columns.map(esc).join(' · ') + '</p>' +
      table(['Parameter', 'Type', 'Requirement', 'Constraints'], Object.entries(spec.parameters).map(([name, p]) => [name, p.type, p.optional ? 'Optional; native default' : 'Required',
        [p.minimum !== undefined ? 'min ' + p.minimum : '', p.maximum !== undefined ? 'max ' + p.maximum : '', p.enum ? 'enum ' + JSON.stringify(p.enum) : '', p.nullable ? 'nullable' : '', p.maxLength !== undefined ? 'max length ' + p.maxLength : ''].filter(Boolean).join('; ')])) +
      '<p class="small muted">Up to ' + spec.maxRows + ' rows · ' + esc(bytes(spec.maxBytes)) + ' · ' + spec.timeoutMs + ' ms native deadline</p>';
    if (!previewInputs.has(selectedQuery)) {
      const published = editor.routes.find(route => route.query === selectedQuery);
      previewInputs.set(selectedQuery, published?.exampleText ?? '{}');
    }
    $('#query-input').value = previewInputs.get(selectedQuery);
  } else $('#query-description').innerHTML = '<p class="empty">Open an approved source declaration to review queries.</p>';
  $('#preview').dataset.disabled = String(!spec || !data.source.available);
  $('#use-query').dataset.disabled = String(!spec);
  renderPreview();
}
function renderPreview() {
  if (!previewResult || previewResult.result.query !== selectedQuery) { $('#preview-result').innerHTML = ''; return; }
  const result = previewResult.result;
  $('#preview-result').innerHTML = '<div class="panel-heading"><h3>Local query result</h3><button type="button" data-action="download-preview">Download typed JSON</button></div>' +
    '<p class="small">' + result.rowCount + ' rows' + (result.truncated ? ' · result limit reached' : '') + ' · exact native result</p>' +
    table(result.columns, result.rows.map(row => result.columns.map(column => row[column])));
}
function routeList() {
  selectedRoute = Math.min(selectedRoute, Math.max(0, editor.routes.length - 1));
  $('#route-list').innerHTML = editor.routes.map((route, index) => '<button type="button" data-route="' + index + '" class="' + (index === selectedRoute ? 'selected' : '') + '"><span class="item-title">' + esc(route.id || 'Untitled route') + '</span><span class="item-meta">' + esc(route.method + ' ' + route.path) + '</span></button>').join('') || '<p class="empty">Add one of the approved queries as a public route.</p>';
}
function renderRoute() {
  routeList();
  const route = editor.routes[selectedRoute], host = $('#route-editor');
  if (!route) { host.innerHTML = '<p class="empty">Select Add to configure an approved query.</p>'; return; }
  const field = (key, label, value, wide = false) => '<label class="' + (wide ? 'wide' : '') + '">' + label + '<input data-field="' + key + '" value="' + esc(value) + '" autocomplete="off"></label>';
  const areas = (key, label, text, rows = 5) => '<label class="wide">' + label + '<textarea data-field="' + key + '" rows="' + rows + '" spellcheck="false">' + esc(text) + '</textarea></label>';
  const queries = Object.keys(querySpecs());
  if (!queries.includes(route.query)) queries.push(route.query);
  host.innerHTML = '<div class="panel-heading"><h3>Route details</h3><button type="button" data-action="remove-route">Remove route</button></div><div class="fields">' +
    field('id', 'Route ID', route.id) + field('path', 'Public path', route.path) +
    '<label>Approved query<select data-field="query">' + queries.map(name => '<option' + (name === route.query ? ' selected' : '') + '>' + esc(name) + '</option>').join('') + '</select></label>' +
    '<label>HTTP method<select data-field="method">' + ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].map(name => '<option' + (name === route.method ? ' selected' : '') + '>' + name + '</option>').join('') + '</select></label>' +
    field('serviceName', 'Public service name', route.serviceName) + field('tagsText', 'Tags, separated by commas', route.tagsText) +
    areas('description', 'Public description', route.description, 3) +
    areas('exampleText', 'Deliberately public request example', route.exampleText) +
    areas('descriptionsText', 'Public parameter descriptions', route.descriptionsText) +
    areas('paymentText', 'Route payment options · leave empty to use defaults', route.paymentText, 6) + '</div>';
}
function renderReview() {
  const host = $('#plan-review'); host.hidden = !review;
  if (!review) return;
  host.innerHTML = '<h3>Review saved revision ' + review.revision + '</h3><p>' + review.datasetFiles + ' source files · ' + esc(bytes(review.datasetBytes)) + ' copied into a private package.</p>' +
    review.review.routes.map(route => '<div class="review-route"><h4>' + esc(route.method + ' ' + route.url) + '</h4><p class="small">' + esc(route.query) + ' · ' + route.columns.map(esc).join(', ') + '</p>' +
      table(['Network', 'Asset', 'Recipient', 'Atomic amount', 'Timeout'], route.paymentOptions.map(option => [option.network, option.asset, option.payTo, option.amount, option.maxTimeoutSeconds + ' s'])) +
      '<p class="mono">Public ' + esc(route.input) + ': ' + esc(JSON.stringify(route.example)) + '</p></div>').join('') +
    '<div class="toolbar"><button type="button" data-action="prepare" class="primary">Prepare this package</button><span class="small muted">Original native preflight and package writer</span></div>';
}
function renderPackages() {
  renderRuntime();
  const list = data.packages ?? [];
  if (selectedPackage && !list.some(item => item.id === selectedPackage)) selectedPackage = '';
  selectedPackage ||= list.find(item => item.state === 'READY')?.id ?? list[0]?.id ?? '';
  $('#package-list').innerHTML = list.map(item => '<button type="button" data-package="' + esc(item.id) + '" class="' + (selectedPackage === item.id ? 'selected' : '') + '"><span class="item-title">Revision ' + item.revision + ' · ' + esc(item.state.toLowerCase()) + '</span><span class="item-meta">' + esc(moment(item.createdAt)) + '<br>' + esc(short(item.id.replace('prepare-', ''))) + '</span></button>').join('') || '<p class="empty">Review a merchant plan and prepare its first package.</p>';
  const item = list.find(value => value.id === selectedPackage), detail = $('#package-detail');
  if (!item) { detail.innerHTML = '<p class="empty">Prepared packages retain their own data and public API files.</p>'; return; }
  const summary = item.summary;
  detail.innerHTML = '<div class="panel-heading"><h3>Package · revision ' + item.revision + '</h3><span class="pill">' + esc(item.state) + '</span></div>' +
    '<p class="small muted">' + esc(item.id) + '</p>' + (summary ? '<dl><dt>Public origin</dt><dd>' + esc(summary.publicOrigin) + '</dd><dt>Native engine</dt><dd>DuckDB ' + esc(summary.nativePreflight.engineVersion) + '</dd><dt>Copied data</dt><dd>' + esc(bytes(summary.datasetBytes)) + '</dd><dt>Package identity</dt><dd class="mono">' + esc(summary.packageSha256) + '</dd></dl>' +
      summary.review.routes.map(route => '<div class="review-route"><h4>' + esc(route.method + ' ' + route.url) + '</h4>' +
        table(['Network', 'Recipient', 'Amount', 'Asset'], route.paymentOptions.map(option => [option.network, option.payTo, option.amount, option.asset])) + '</div>').join('') :
      '<div class="notice">' + esc(item.error ?? 'Inspect this package to recover a completed preparation. An incomplete copy can be followed by a new preparation from the saved draft.') + '</div>') +
    '<div class="toolbar"><button type="button" data-action="inspect-package">Inspect &amp; recover</button>' + (summary && item.state === 'READY' ? '<button type="button" data-action="start-merchant" class="primary">Start this merchant</button>' : '') + '</div>' +
    (summary ? '<h4>Public API &amp; client files</h4><div class="download-list">' + summary.artifacts.map(file => '<button type="button" data-artifact="' + esc(file.path) + '">' + esc(file.path) + '</button>').join('') + '</div>' : '');
}
function renderRuntime() {
  const runtime = data.runtime, running = runtime.state === 'RUNNING';
  $('#runtime-detail').innerHTML = '<div class="panel-heading"><h3>Original merchant runtime</h3><span class="pill">' + esc(runtime.state) + '</span></div>' +
    (running ? '<dl><dt>Package</dt><dd>Revision ' + runtime.revision + ' · ' + esc(runtime.packageId) + '</dd><dt>Mode</dt><dd>' + esc(runtime.mode) + '</dd><dt>Native reader</dt><dd>DuckDB ' + esc(runtime.engineVersion) + ' · ' + runtime.source.completed + ' completed queries · ' + runtime.source.pending + ' pending</dd><dt>Started</dt><dd>' + esc(moment(runtime.startedAt)) + '</dd></dl>' +
      '<div class="toolbar"><a target="_blank" rel="noreferrer" href="' + esc(runtime.docs) + '">Developer API</a><a target="_blank" rel="noopener" referrerpolicy="origin" href="' + esc(runtime.operations) + '">Original operations console</a>' + (runtime.availabilityControlUrl ? '<a target="_blank" rel="noopener" referrerpolicy="origin" href="' + esc(runtime.availabilityControlUrl) + '">Product availability</a>' : '') + '<button type="button" data-action="stop-merchant">Stop merchant</button><button type="button" data-action="refresh-runtime">Refresh status</button></div>' :
      '<p class="muted">' + (runtime.state === 'INTERRUPTED' ? 'The previous workspace process ended. Select its retained package to start a new merchant instance.' : 'Select a retained package below to start the merchant and its operations console.') + '</p>');
}
function renderHistory() {
  $('#history-list').innerHTML = '<table><thead><tr><th>Revision</th><th>Saved</th><th>Plan</th><th>Source</th><th>Action</th></tr></thead><tbody>' +
    data.drafts.map(item => '<tr><td>' + item.revision + (item.revision === data.draft?.revision ? ' · current' : '') + '</td><td>' + esc(moment(item.savedAt)) + '</td><td class="mono">' + short(item.planSha256) + '</td><td class="mono">' + short(item.sourceSha256) + '</td><td><button type="button" data-revision="' + item.revision + '">Reopen for editing</button></td></tr>').join('') + '</tbody></table>';
}
function render() {
  $('#connection').textContent = 'Private local workspace';
  $('#source-status').textContent = data.source.available ? Object.keys(querySpecs()).length + ' queries available' : 'Source unavailable';
  $('#draft-status').textContent = data.draft ? 'Revision ' + data.draft.revision : 'First draft';
  $('#package-count').textContent = data.packages.filter(item => item.state === 'READY').length + ' ready';
  $('#runtime-status').textContent = data.runtime.state.toLowerCase();
  $('#public-origin').value = editor.origin; $('#default-payment').value = editor.paymentText;
  $('#edit-status').textContent = dirty ? 'Unsaved edits · based on revision ' + revision : 'Saved revision ' + revision;
  queryList(); renderRoute(); renderReview(); renderPackages(); renderHistory(); authorUi.render(); showTab(activeTab); setBusy(busy);
}
async function refresh({ replaceEditor = false } = {}) {
  data = await api('/api/state');
  if (!editor || replaceEditor || !dirty) {
    editor = toEditor(data.draft?.plan ?? data.initialPlan, data.draft?.authoring); revision = data.draft?.revision ?? 0;
    if (replaceEditor) { dirty = false; review = null; sessionStorage.removeItem(storageKey()); }
  }
  render();
}
function addRoute(query) {
  const spec = querySpecs()[query];
  if (!spec) throw new Error('Choose an approved query first.');
  let id = query, index = 2;
  while (editor.routes.some(route => route.id === id)) id = query + '-' + index++;
  editor.routes.push({ id, path: '/' + id, method: 'GET', query, serviceName: query.slice(0, 32),
    description: '', tagsText: '', exampleText: '{}', paymentText: '',
    descriptionsText: pretty(Object.fromEntries(Object.keys(spec.parameters).map(name => [name, '']))) });
  selectedRoute = editor.routes.length - 1; markEdited(); renderRoute(); showTab('plan');
}
async function saveDraft() {
  const plan = planValue();
  const intent = { expectedRevision: revision, sourceSha256: data.source.sourceSha256, plan, authoring: editor.authoring ?? [] };
  const builder = editor.builder;
  const identity = JSON.stringify(intent), intentKey = 'duckdb-save-intent:' + data.workspaceId;
  let pending;
  try { pending = JSON.parse(sessionStorage.getItem(intentKey) ?? 'null'); } catch {}
  if (pending?.identity !== identity) pending = { identity, operationId: 'save-' + crypto.randomUUID() };
  sessionStorage.setItem(intentKey, JSON.stringify(pending));
  let result;
  try { result = await api('/api/draft', { ...intent, operationId: pending.operationId }); }
  catch (error) { if (error.code) sessionStorage.removeItem(intentKey); throw error; }
  sessionStorage.removeItem(intentKey);
  revision = result.revision; dirty = false; sessionStorage.removeItem(storageKey());
  await refresh();
  if (builder?.plan) { editor.builder = builder; remember(); authorUi.render(); }
  return result;
}
function download(name, content, type = 'application/json') {
  const address = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = address; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(address), 1000);
}
async function downloadArtifact(name) {
  const response = await fetch('/api/artifact?' + new URLSearchParams({ package: selectedPackage, name }),
    { headers: { 'x-duckdb-workspace': key } });
  if (!response.ok) { const value = await response.json(); throw new Error(value.message ?? value.error); }
  download(name.replaceAll('/', '-'), await response.arrayBuffer(), response.headers.get('content-type'));
  report('Downloaded ' + name + ' from the selected retained package.');
}

document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || busy) return;
  if (button.dataset.tab) { showTab(button.dataset.tab); return; }
  if (button.dataset.query) {
    selectedQuery = button.dataset.query; queryList(); return;
  }
  if (button.dataset.route !== undefined) { selectedRoute = Number(button.dataset.route); renderRoute(); return; }
  if (button.dataset.package) { selectedPackage = button.dataset.package; renderPackages(); return; }
  if (button.dataset.revision) return perform('Opening saved revision…', async () => {
    const saved = await api('/api/draft?revision=' + button.dataset.revision);
    editor = toEditor(saved.plan, saved.authoring); revision = data.draft?.revision ?? 0; markEdited(); render(); showTab('plan');
    report('Opened revision ' + saved.revision + '. Save to create a new current revision.');
  });
  if (button.dataset.artifact) return perform('Reading exact package artifact…', () => downloadArtifact(button.dataset.artifact));
  const action = button.dataset.action;
  if (action === 'remove-route') { editor.routes.splice(selectedRoute, 1); markEdited(); renderRoute(); return; }
  if (action === 'download-preview') { download('duckdb-local-query.json', pretty(previewResult.result) + '\n'); return; }
  if (action === 'prepare') return perform('Preparing the original native package…', async () => {
    const intentKey = 'duckdb-preparation-' + review.reviewId;
    const operationId = sessionStorage.getItem(intentKey) ?? 'prepare-' + crypto.randomUUID();
    sessionStorage.setItem(intentKey, operationId);
    let prepared;
    try { prepared = await api('/api/prepare', { revision: review.revision, reviewId: review.reviewId, operationId }); }
    catch (error) { if (error.code) sessionStorage.removeItem(intentKey); throw error; }
    sessionStorage.removeItem(intentKey); selectedPackage = prepared.id; await refresh(); showTab('packages');
    report('Prepared revision ' + prepared.revision + ' with the original native reader and copied data.');
  });
  if (action === 'inspect-package') return perform('Inspecting the retained package and its data…', async () => {
    await api('/api/inspect', { packageId: selectedPackage }); await refresh(); report('Retained package and declared files verified.');
  });
  if (action === 'start-merchant') return perform('Starting the original merchant and operations console…', async () => {
    const item = data.packages.find(value => value.id === selectedPackage);
    await api('/api/start', { packageId: item.id, packageSha256: item.summary.packageSha256 });
    await refresh(); report('The selected merchant is running. Its original API and operations console are available above.');
  });
  if (action === 'stop-merchant') return perform('Draining the current merchant…', async () => {
    await api('/api/stop', { instanceId: data.runtime.instanceId }); await refresh(); report('Merchant drained and stopped. Saved packages remain available.');
  });
  if (action === 'refresh-runtime') return perform('Refreshing actual merchant status…', async () => { await refresh(); report('Merchant status refreshed.'); });
});
$('#route-editor').addEventListener('input', event => {
  const field = event.target.dataset.field, route = editor.routes[selectedRoute];
  if (!field || !route) return;
  route[field] = event.target.value; markEdited();
  if (['id', 'path', 'method'].includes(field)) routeList();
});
$('#route-editor').addEventListener('change', event => {
  if (event.target.dataset.field !== 'query') return;
  const route = editor.routes[selectedRoute], spec = querySpecs()[route.query];
  route.exampleText = '{}'; route.descriptionsText = pretty(Object.fromEntries(Object.keys(spec.parameters).map(name => [name, ''])));
  markEdited(); renderRoute();
});
$('#public-origin').addEventListener('input', event => { editor.origin = event.target.value; markEdited(); });
$('#default-payment').addEventListener('input', event => { editor.paymentText = event.target.value; markEdited(); });
$('#query-input').addEventListener('input', event => previewInputs.set(selectedQuery, event.target.value));
$('#refresh').addEventListener('click', () => perform('Refreshing source, drafts and merchant status…', async () => {
  await refresh(); report(data.source.available ? 'Workspace refreshed. Unsaved edits are retained.' : 'The original source is unavailable. Retained packages can still be inspected and started.');
}));
$('#preview').addEventListener('click', () => perform('Running the approved native query…', async () => {
  previewResult = await api('/api/preview', { sourceSha256: data.source.sourceSha256, query: selectedQuery,
    authoring: editor.authoring ?? [], input: parse($('#query-input').value, 'Local query input') });
  renderPreview(); report('Local native preview completed.');
}));
$('#use-query').addEventListener('click', () => addRoute(selectedQuery));
$('#add-route').addEventListener('click', () => addRoute(selectedQuery || Object.keys(querySpecs())[0]));
$('#save-draft').addEventListener('click', () => perform('Saving merchant revision…', async () => {
  review = null; await saveDraft(); report('Saved revision ' + revision + '.');
}));
$('#review-plan').addEventListener('click', () => perform('Compiling the original merchant plan…', async () => {
  if (dirty || !revision) await saveDraft();
  review = await api('/api/review', { revision }); renderReview();
  $('#plan-review').scrollIntoView({ behavior: 'smooth', block: 'start' }); report('Review the exact public routes and payment options below.');
}));
$('#export-plan').addEventListener('click', () => perform('Preparing draft download…', async () => {
  download('merchant-plan.json', pretty(planValue()) + '\n'); report('Downloaded the original merchant plan format.');
}));
$('#export-draft').addEventListener('click', () => perform('Preparing complete draft download…', async () => {
  download('duckdb-workspace-draft.json', pretty({ schema: 'stellar-forge.duckdb-workspace-draft.v1',
    sourceSha256: data.source.sourceSha256, plan: planValue(), authoring: editor.authoring ?? [], builder: editor.builder }) + '\n');
  report('Downloaded merchant terms, retained query choices and the current query builder.');
}));
$('#import-plan').addEventListener('click', () => $('#plan-file').click());
$('#plan-file').addEventListener('change', event => perform('Opening merchant plan…', async () => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 262144) throw new Error('Merchant plans must be at most 256 KiB.');
  const value = parse(await file.text(), 'Imported plan');
  const complete = value.schema === 'stellar-forge.duckdb-workspace-draft.v1', plan = complete ? value.plan : value;
  if (plan?.schema !== 'stellar-forge.duckdb-merchant-plan.v1' || !Array.isArray(plan.routes) || complete && !Array.isArray(value.authoring))
    throw new Error('Choose a DuckDB merchant plan or complete workspace draft.');
  editor = toEditor(plan, complete ? value.authoring : []); if (complete) editor.builder = value.builder;
  selectedRoute = 0; markEdited(); render(); report('Imported draft. Review its query choices, routes and public examples before saving.');
}));

const authorUi = mountQueryAuthor({ root: $('#query-author'), api, perform, report,
  getState: () => ({ source: data.source, entries: editor.authoring ?? [], builder: editor.builder }),
  updateBuilder: value => { editor.builder = value; markEdited(); },
  keepQuery: (entry, result) => {
    editor.authoring ??= []; editor.authoredSpecs ??= {};
    const index = editor.authoring.findIndex(value => value.plan.queryName === entry.plan.queryName);
    if (index >= 0) editor.authoring[index] = structuredClone(entry); else editor.authoring.push(structuredClone(entry));
    editor.authoredSpecs[result.queryName] = result.description;
    selectedQuery = result.queryName;
    const route = editor.routes.find(route => route.query === result.queryName);
    if (!route) {
      addRoute(result.queryName);
      editor.routes[selectedRoute].descriptionsText = pretty(result.parameterDescriptions);
    } else selectedRoute = editor.routes.indexOf(route);
    markEdited(); render(); showTab('plan');
    report('Kept ' + result.queryName + '. Set its public description and request example, or open Query review to preview actual rows.');
  },
  removeQuery: index => {
    const name = editor.authoring[index].plan.queryName;
    editor.authoring.splice(index, 1); delete editor.authoredSpecs?.[name];
    editor.routes = editor.routes.filter(route => route.query !== name); markEdited(); render();
    report('Removed ' + name + ' and its draft routes. Earlier saved revisions retain their definitions.');
  },
});

cloudUi = mountCloudDelivery($('#cloud-workspace'), {
  api, perform,
  getWorkspace: () => ({ ...data, merchantDirty: dirty, merchantRevision: revision }),
  download: async (name, content, type, path) => {
    if (!path) return download(name, content, type);
    const target = new URL(path, location.origin);
    if (target.origin !== location.origin || !target.pathname.startsWith('/api/cloud/'))
      throw new Error('The requested source file is outside this workspace.');
    const response = await fetch(target.pathname + target.search, { headers: { 'x-duckdb-workspace': key ?? '' } });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(failure.message ?? failure.error ?? 'The retained source download could not complete.');
    }
    download(name, await response.blob(), response.headers.get('content-type') ?? type);
  },
  beforeSelect: async context => {
    if (dirty && context.dirtyChoice === 'save') {
      review = null; await saveDraft();
    }
  },
  onSelected: async (_result, context) => {
    review = null; previewResult = undefined; selectedQuery = '';
    await refresh({ replaceEditor: context.dirtyChoice !== 'keep' });
    if (context.dirtyChoice === 'keep' && dirty) remember();
    showTab('author');
    report('The complete source edition is selected. Review native relations and query choices before preparing its merchant package.');
  }
});

await perform('Opening private merchant workspace…', async () => {
  await refresh();
  try {
    const retained = JSON.parse(sessionStorage.getItem(storageKey()) ?? 'null');
    if (retained?.editor) {
      editor = retained.editor; revision = retained.revision; selectedRoute = retained.selectedRoute;
      dirty = true; render(); report(retained.sourceSha256 !== data.source.sourceSha256 || !data.source.available ?
        'Recovered unsaved edits. The source changed or is unavailable; refresh its relations and review query choices before preparing a new package.' :
        'Recovered unsaved edits from this browser tab.'); return;
    }
  } catch {}
  report(data.sourceChanged ? 'The approved source changed since the current saved draft. Review its current queries before saving.' :
    data.authoringError ? 'Saved query choices need review against current source metadata: ' + data.authoringError : '');
});
