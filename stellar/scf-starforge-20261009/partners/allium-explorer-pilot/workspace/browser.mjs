// MIT. Retained operator interface; all acquisition, dataset and merchant work uses the original host.
import { createDraftStore } from '/local-draft-store.mjs';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = value => JSON.stringify(value, null, 2);
const short = value => value ? String(value).slice(0, 12) : '—';
const date = value => value ? new Date(value).toLocaleString() : '—';
const human = value => Number(value ?? 0).toLocaleString();
const tag = value => '<span class="tag">' + esc(value) + '</span>';
const code = value => '<code>' + esc(value) + '</code>';
const button = (action, label, extra = '') => '<button type="button" data-action="' + action + '" ' + extra + '>' + label + '</button>';
const field = (label, name, value, extra = '') => '<div class="field"><label for="' + name + '">' + label + '</label><input id="' + name + '" data-model="' + name + '" value="' + esc(value) + '" ' + extra + '></div>';
const area = (label, name, value, extra = '') => '<div class="field"><label for="' + name + '">' + label + '</label><textarea id="' + name + '" data-model="' + name + '" ' + extra + '>' + esc(value) + '</textarea></div>';
const options = (records, selected, label) => records.map(r => '<option value="' + esc(r.id) + '"' + (selected === r.id ? ' selected' : '') + '>' + esc(label(r)) + '</option>').join('');
let state, draft, local, pending = null, busy = false, view = 'overview', historyRevision = null, savedAt = null;
let draftTail = Promise.resolve(), draftTimer;
let token = location.hash.slice(1).replace(/^token=/, '') || sessionStorage.getItem('allium-workspace-token');
if (token) sessionStorage.setItem('allium-workspace-token', token);
history.replaceState(null, '', location.pathname);

function message(text, error = false) { $('#message').textContent = text ?? ''; $('#message').dataset.error = String(error); }
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error',
    headers: { 'X-Allium-Workspace-Token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.message ?? value.error ?? 'Workspace request failed.'), { code: value.error, status: response.status });
  return value;
}
function footer() {
  $('#local-status').textContent = savedAt ? 'Local draft retained ' + date(savedAt) : 'Saving local draft…';
  $('#server-status').textContent = state ? 'Saved product ' + short(state.head) + ' · workspace revision ' + state.revision : '';
}
function saveLocal() {
  clearTimeout(draftTimer); const copy = structuredClone(draft); savedAt = null; footer();
  draftTail = draftTail.catch(() => {}).then(() => local.writeDraft(copy)).then(() => { savedAt = new Date().toISOString(); footer(); });
  draftTail.catch(error => message(error.message, true)); return draftTail;
}
function queueLocal() { savedAt = null; footer(); clearTimeout(draftTimer); draftTimer = setTimeout(() => saveLocal(), 180); }
function cleanProduct() {
  if (draft.productDirty) draft.previousProduct = { productText: draft.productText, baseHead: draft.baseHead, savedAt: new Date().toISOString() };
  draft.productText = state.current.productText; draft.baseHead = state.head; draft.productDirty = false; draft.productNote = '';
}
function adopt(next) {
  state = next;
  if (draft && !draft.productDirty) { draft.productText = state.current.productText; draft.baseHead = state.head; }
  if (draft && !state.acquisitions.some(r => r.id === draft.acquisitionId)) draft.acquisitionId = state.acquisitions.at(-1)?.id ?? null;
  if (draft && !state.revisions.some(r => r.id === draft.acquireRevisionId)) draft.acquireRevisionId = state.head;
  if (draft && !draft.merchantDirty) {
    const config = state.configurations.find(c => c.id === state.configurationId);
    if (config) { draft.merchant.origin = config.origin; draft.merchant.path = config.path; draft.merchant.paymentText = json(config.payment); }
  }
}
async function refresh() {
  adopt(await api('/api/state'));
  if (pending?.body?.operationId && state.operations.some(o => o.id === pending.body.operationId)) {
    await local.deletePending(); pending = null; message('The retained operation is present in the saved workspace.');
  }
  await saveLocal(); render();
}
async function perform(path, body, { replayable = false, retain = true } = {}) {
  if (busy) throw new Error('Wait for the current operation to complete.');
  busy = true; render();
  try {
    await saveLocal();
    if (retain) { pending = { path, body: structuredClone(body), replayable, createdAt: new Date().toISOString() }; await local.writePending(pending); }
    const response = await api(path, body);
    if (retain) { await local.deletePending(); pending = null; }
    adopt(response.state); await saveLocal(); return response.result;
  } catch (error) {
    if (error.status && retain) { await local.deletePending(); pending = null; }
    try { adopt(await api('/api/state')); } catch {}
    throw error;
  } finally { busy = false; render(); }
}
function pendingView() {
  if (!pending) return '';
  return '<div class="notice"><strong>Retained request: ' + esc(pending.path) + '</strong><p>Read the saved state to recover its outcome. The original request and inputs are kept in this browser.</p><div class="actions">' +
    button('refresh', 'Read saved state') + (pending.replayable ? button('retry', 'Retry the exact retained request') : '') + button('clear-pending', 'Clear recovered request') + '</div></div>';
}
function section(title, body, description = '') { return '<section><h2>' + title + '</h2>' + (description ? '<p class="help">' + description + '</p>' : '') + body + '</section>'; }
function heading(title, text) { return '<div class="heading"><div><h1>' + title + '</h1><p class="lead">' + text + '</p></div></div>'; }
function selectedAcquisition() { return state.acquisitions.find(a => a.id === draft.acquisitionId) ?? null; }
function acquisitionPicker(id = 'acquisitionId') {
  return '<div class="field"><label for="' + id + '">Retained acquisition</label><select id="' + id + '" data-model="acquisitionId">' +
    (state.acquisitions.length ? options([...state.acquisitions].reverse(), draft.acquisitionId, a => short(a.id) + ' · ' + a.status + ' · ' + (a.filename ?? a.runId ?? 'saved query')) : '<option value="">No source acquired</option>') + '</select></div>';
}
function overview() {
  const ready = state.acquisitions.filter(a => a.status === 'STAGED');
  return heading(state.name, 'Prepare an approved Allium data product, retain its source and operate the original dataset merchant from one workspace.') +
    '<div class="stats"><div class="stat"><strong>' + state.revisions.length + '</strong><span>Product revisions</span></div><div class="stat"><strong>' + ready.length + '</strong><span>Completed sources</span></div><div class="stat"><strong>' + (state.versions?.versions?.length ?? 0) + '</strong><span>Merchant snapshots</span></div><div class="stat"><strong>' + (state.publisher.buyers?.length ?? 0) + '</strong><span>Retained buyer preparations</span></div></div><p></p>' +
    section('Current product', '<dl><dt>Name</dt><dd>' + esc(state.current.product.name) + '</dd><dt>Saved query</dt><dd>' + code(state.current.product.queryId) + '</dd><dt>Source table</dt><dd>' + code(state.current.product.sourceTable) + '</dd><dt>Projection</dt><dd>' + Object.keys(state.current.product.columns).length + ' declared columns</dd><dt>Acquisition limits</dt><dd>' + human(state.current.product.maxRows) + ' rows · ' + human(state.current.product.maxResponseBytes) + ' bytes</dd><dt>Host credential</dt><dd>' + code(state.credentials.apiKeyEnv) + ' · ' + (state.credentials.available ? 'available to this process' : 'not set in this process') + '</dd></dl><div class="actions">' + button('go-product', 'Edit product') + button('go-acquisitions', 'Acquire source') + '</div>') +
    section('Merchant operation', '<p>' + tag(state.runtime.status) + (state.runtime.mode ? ' ' + tag(state.runtime.mode) : '') + '</p><p>' + (state.versions ? 'Current snapshot ' + code(state.versions.current) : 'Configure the merchant after a source has passed the original typed loader.') + '</p><div class="actions">' + button('go-merchant', 'Open merchant controls') + '</div>') +
    section('Source and customer handoff', '<p>Imported JSON stays byte exact. Query runs retain the actual Allium run ID. The existing dataset publisher handles source publication, snapshot selection and buyer-offer preparation.</p><p>Provider query execution is an explicit operator action using the named host key. A buyer request uses the completed native dataset.</p><div class="actions">' + button('go-history', 'History & complete export') + '</div>');
}
function productObject() { try { return JSON.parse(draft.productText.replace(/^\uFEFF/, '')); } catch { return null; } }
function projection(config) {
  if (!config || !config.columns || typeof config.columns !== 'object') return '<p class="help">Correct the raw JSON to use the structured projection editor.</p>';
  const safeRows = Object.entries(config.columns).map(([name, spec]) => {
    const inputs = '<td><input aria-label="Public name ' + esc(name) + '" data-column="' + esc(name) + '" data-key="name" value="' + esc(name) + '"></td><td><input aria-label="Source column ' + esc(name) + '" data-column="' + esc(name) + '" data-key="source" value="' + esc(spec?.source) + '"></td><td><select aria-label="Type ' + esc(name) + '" data-column="' + esc(name) + '" data-key="type">' + ['string', 'integer', 'number', 'boolean'].map(type => '<option' + (spec?.type === type ? ' selected' : '') + '>' + type + '</option>').join('') + '</select></td>';
    return '<tr>' + inputs + ['nullable', 'filters', 'ranges', 'sorts'].map(key => '<td class="small"><input type="checkbox" aria-label="' + key + ' ' + esc(name) + '" data-column="' + esc(name) + '" data-key="' + key + '"' + ((key === 'nullable' ? spec?.nullable : config[key]?.includes(name)) ? ' checked' : '') + '></td>').join('') + '<td class="small">' + button('remove-column', 'Remove', 'data-id="' + esc(name) + '"') + '</td></tr>';
  });
  return '<div class="table-wrap"><table class="projection"><thead><tr><th>Public name</th><th>Source column</th><th>Type</th><th>Nullable</th><th>Filter</th><th>Range</th><th>Sort</th><th></th></tr></thead><tbody>' + safeRows.join('') + '</tbody></table></div><div class="actions">' + button('add-column', 'Add column') + '</div><p class="help">Use strings for integers that exceed JavaScript’s safe integer range. A nullable string cannot distinguish an empty CSV value from null.</p>';
}
function productView() {
  const config = productObject();
  const notice = draft.baseHead !== state.head ? '<div class="notice"><strong>A newer saved product is available.</strong><p>Your local draft still uses ' + code(draft.baseHead) + '. Load the current revision before merging its changes; the previous local draft is retained.</p>' + button('adopt-current', 'Load current saved product') + '</div>' : '';
  const top = config ? '<div class="grid three">' + ['name', 'queryId', 'sourceTable', 'apiKeyEnv', 'maxRows', 'maxResponseBytes', 'defaultLimit', 'maxLimit', 'timeoutMs'].map(key => '<div class="field"><label for="product-' + key + '">' + ({ name: 'Product name', queryId: 'Approved saved query ID', sourceTable: 'Source table', apiKeyEnv: 'Host key environment name', maxRows: 'Maximum acquired rows', maxResponseBytes: 'Maximum result bytes', defaultLimit: 'Default page size', maxLimit: 'Maximum page size', timeoutMs: 'Provider request timeout (ms)' }[key]) + '</label><input id="product-' + key + '" data-product="' + key + '" value="' + esc(config[key] ?? '') + '"' + (['maxRows', 'maxResponseBytes', 'defaultLimit', 'maxLimit', 'timeoutMs'].includes(key) ? ' type="number"' : '') + '></div>').join('') + '</div>' : '';
  return heading('Product & projection', 'Save an immutable product revision before acquiring a source. Both editors change the same retained JSON document.') + notice +
    section('Saved-query product', top + projection(config)) +
    section('Complete product JSON', area('Product JSON, including parameters and compute profile', 'productText', draft.productText, 'class="mono-editor" spellcheck="false"') +
      field('Revision note', 'productNote', draft.productNote, 'maxlength="240"') + '<p class="help">Based on ' + code(draft.baseHead) + ' · ' + (draft.productDirty ? 'local changes retained; not saved as a product revision' : 'matches the saved product') + '</p><div class="actions">' +
      button('save-product', 'Save product revision', 'class="primary"') + button('render-product', 'Update structured editor') + button('adopt-current', 'Load saved product') + (draft.previousProduct ? button('recover-draft', 'Recover previous local draft') : '') + '</div>');
}
function acquisitionView() {
  const chosen = selectedAcquisition();
  const list = state.acquisitions.length ? '<div class="table-wrap"><table><thead><tr><th>Acquisition</th><th>Source</th><th>Status</th><th>Rows</th><th>Created</th><th></th></tr></thead><tbody>' + [...state.acquisitions].reverse().map(r => '<tr' + (r.id === draft.acquisitionId ? ' class="selected"' : '') + '><td>' + code(short(r.id)) + '<br>' + esc(r.note) + '</td><td>' + esc(r.filename ?? r.runId ?? 'Allium saved query') + '</td><td>' + tag(r.status) + '</td><td>' + (r.dataset ? human(r.dataset.rowCount) : '—') + '</td><td>' + date(r.createdAt) + '</td><td>' + button('select-acquisition', 'Open', 'data-id="' + r.id + '"') + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="empty">No source has been acquired yet.</p>';
  const create = '<div class="field"><label for="acquireRevisionId">Saved product revision used for this acquisition</label><select id="acquireRevisionId" data-model="acquireRevisionId">' + options([...state.revisions].reverse(), draft.acquireRevisionId, r => short(r.id) + ' · ' + r.name + ' · ' + date(r.createdAt)) + '</select></div>' +
    field('Source or operation note', 'acquisitionNote', draft.acquisitionNote, 'maxlength="1024"') + '<div class="grid"><div><h3>Import an existing result</h3><div class="field"><label for="resultFile">Original Allium result JSON</label><input type="file" id="resultFile" accept=".json,application/json"></div><p class="help">' + (draft.importFile ? esc(draft.importFile.name) + ' · ' + human(draft.importFile.bytes) + ' bytes retained locally' : 'Choose the complete {sql, meta, data, queried_at} envelope.') + '</p>' + button('import-result', 'Import & stage source', 'class="primary"' + (draft.importFile ? '' : ' disabled')) + '</div><div><h3>Run the saved Allium query</h3><p class="help">This submits one query with the saved parameters and row cap. It uses the named host key and may consume Allium credits. A lost response is recovered from its retained acquisition.</p>' + button('start-query', 'Start saved query') + '</div></div>';
  let detail = '';
  if (chosen) {
    detail = '<dl><dt>Acquisition</dt><dd>' + code(chosen.id) + '</dd><dt>Product revision</dt><dd>' + code(chosen.revisionId) + '</dd><dt>Status</dt><dd>' + tag(chosen.status) + '</dd><dt>Native run ID</dt><dd>' + code(chosen.runId ?? 'No provider run') + '</dd><dt>Source note</dt><dd>' + esc(chosen.note) + '</dd></dl>';
    if (chosen.error) detail += '<div class="notice error">' + code(chosen.error.code) + '<p>' + esc(chosen.error.message) + '</p></div>';
    if (chosen.kind === 'query') {
      detail += '<div class="actions">' + (chosen.canResumeSubmission ? button('resume-query', 'Submit prepared acquisition') : '') + (chosen.runId && chosen.status !== 'STAGED' ? button('collect-query', 'Read status & collect completed result') : '') + (chosen.nativeRun ? button('download-run', 'Download native run record') : '') + '</div>';
      if (!chosen.runId && ['submitting', 'submission_unknown'].includes(chosen.status)) detail += field('Actual existing Allium run ID', 'recoverRunId', draft.recoverRunId) + button('recover-query', 'Attach existing run ID');
    }
    if (chosen.dataset) detail += '<dl><dt>Snapshot</dt><dd>' + code(chosen.dataset.snapshot) + '</dd><dt>Acquired rows</dt><dd>' + human(chosen.dataset.rowCount) + (chosen.source.rowLimitReached ? ' · configured row cap reached' : '') + '</dd><dt>Source result</dt><dd>' + code(chosen.source.resultSha256) + '</dd><dt>Queried at</dt><dd>' + esc(chosen.source.queriedAt ?? 'Not supplied') + '</dd></dl><div class="actions">' + button('go-explore', 'Explore typed rows') + ['result', 'csv', 'dataset', 'source'].map(k => button('download-' + k, 'Download ' + k)).join('') + '</div>';
  }
  return heading('Source acquisitions', 'Retain original source bytes and exact product revisions. Provider run identity remains in the original Allium record.') + section('Acquire source', create) + section('Retained acquisitions', list) + (chosen ? section('Selected acquisition', detail) : '');
}
function rowsTable(result) {
  const rows = result?.body?.rows;
  if (!Array.isArray(rows)) return '<pre>' + esc(json(result?.body ?? result)) + '</pre>';
  const names = rows.length ? Object.keys(rows[0]) : result?.dataset?.columns?.map(c => c.name) ?? [];
  return '<div class="table-wrap result"><table><thead><tr>' + names.map(n => '<th>' + esc(n) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + names.map(name => '<td class="value">' + esc(row[name] === null ? 'null' : typeof row[name] === 'object' ? json(row[name]) : row[name]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}
function explore() {
  const acquisition = selectedAcquisition(), preview = draft.preview?.acquisitionId === draft.acquisitionId ? draft.preview.result : null;
  const source = acquisition?.dataset;
  if (!source) return heading('Explore results', 'Use the original typed dataset parser and pagination against a completed source.') + section('Select source', acquisitionPicker() + '<p class="empty">Choose a staged acquisition to explore its original dataset.</p>');
  return heading('Explore results', 'Read the completed source locally with the original dataset query engine. Rows and cursors use its native types and snapshot identity.') +
    section('Source & query', acquisitionPicker() + '<dl><dt>Snapshot</dt><dd>' + code(source.snapshot) + '</dd><dt>Rows</dt><dd>' + human(source.rowCount) + '</dd><dt>Page limit</dt><dd>' + human(source.defaultLimit) + ' default · ' + human(source.maxLimit) + ' maximum</dd></dl>' +
      field('Native query string', 'query', draft.query, 'class="code" placeholder="limit=25&fields=transaction_hash,ledger_sequence"') + '<p class="help">Use fields, limit and the declared where_, gt_, gte_, lt_, lte_ or sort parameters. Keep filters and ordering unchanged when using the returned cursor.</p><div class="actions">' + button('preview', 'Run local query', 'class="primary"') + button('first-page', 'First page') + (preview?.body?.page?.nextCursor ? button('next-page', 'Next page') : '') + '</div>' +
      '<details><summary>Declared column capabilities</summary><div class="table-wrap"><table><thead><tr><th>Column</th><th>Type</th><th>Nullable</th><th>Filter</th><th>Range</th><th>Sort</th></tr></thead><tbody>' + source.columns.map(c => '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.type) + '</td><td>' + (c.nullable ? 'Yes' : 'No') + '</td><td>' + (c.filterable ? 'Yes' : '—') + '</td><td>' + (c.rangeFilterable ? 'Yes' : '—') + '</td><td>' + (c.sortable ? 'Yes' : '—') + '</td></tr>').join('') + '</tbody></table></div></details>') +
    (preview ? section('Original query response', '<p>' + tag(preview.status) + ' ' + tag(preview.mode) + (preview.body?.page ? ' · ' + human(preview.body.page.returned) + ' returned / ' + human(preview.body.page.total) + ' matching' : '') + '</p>' + rowsTable(preview) + '<details><summary>Complete native response</summary><pre>' + esc(json(preview)) + '</pre></details>') : '');
}
function merchant() {
  const configuration = state.configurations.find(c => c.id === state.configurationId), versions = state.versions;
  const current = state.runtime.status === 'RUNNING';
  const form = acquisitionPicker('merchant-acquisition') + '<div class="grid">' + field('Advertised HTTPS origin', 'merchant.origin', draft.merchant.origin, 'placeholder="https://data.your-domain.example"') + field('Fixed dataset route', 'merchant.path', draft.merchant.path) + '</div>' +
    area('Exact public payment terms', 'merchant.paymentText', draft.merchant.paymentText, 'class="code small-editor" spellcheck="false"') +
    '<details><summary>Initial native retention settings</summary>' + area('Original settings JSON', 'merchant.settingsText', draft.merchant.settingsText, 'class="code small-editor"') + '<p class="help">Only used when creating the first native version store: retentionMs, maxVersions, maxRetainedBytes. Empty JSON uses original defaults. Later changes follow the original version-store operation.</p></details>' +
    '<div class="actions">' + button('configure', configuration ? 'Save merchant terms' : 'Initialize & configure merchant', 'class="primary"' + (current ? ' disabled' : '')) + '</div><p class="help">Payment amounts are exact atomic-unit strings. Enter the merchant’s public asset and recipient. This configuration does not create a wallet or authorize a customer payment.</p>';
  const runtime = '<p>' + tag(state.runtime.status) + (state.runtime.mode ? ' ' + tag(state.runtime.mode) : '') + '</p>' + (current ? '<dl><dt>Local seller</dt><dd>' + code(state.runtime.url) + '</dd><dt>Advertised resource</dt><dd>' + code(state.runtime.resource) + '</dd><dt>Owned session</dt><dd>' + code(state.runtime.id) + '</dd><dt>Started</dt><dd>' + date(state.runtime.startedAt) + '</dd></dl>' : '') +
    '<div class="grid">' + field('Local merchant port (0 selects a free port)', 'merchant.port', draft.merchant.port, 'type="number" min="0" max="65535"') + field('Original facilitator URL (optional)', 'merchant.facilitator', draft.merchant.facilitator, 'placeholder="https://facilitator.example"') + '</div><div class="field"><label class="checkbox"><input type="checkbox" data-model="merchant.allowLocalFacilitator"' + (draft.merchant.allowLocalFacilitator ? ' checked' : '') + '>Allow explicitly selected local 127.0.0.1 facilitator</label></div>' +
    '<div class="actions">' + button('start-merchant', 'Start configured merchant', 'class="primary"' + (!configuration || current ? ' disabled' : '')) + button('stop-merchant', 'Stop owned merchant', current ? '' : 'disabled') + button('open-publisher', 'Open publishing & buyer session', current ? '' : 'disabled') + button('stage-publisher', 'Review selected source in publisher', current ? '' : 'disabled') + '</div>' +
    '<p class="help">Without a facilitator, the original seller exposes CHALLENGE_ONLY. Stop then start to restart from retained native snapshots and terms.</p>' +
    (state.publisher.url ? '<p><a class="button" href="' + esc(state.publisher.url) + '" target="_blank" rel="noopener noreferrer">Continue in the original dataset publisher →</a></p>' : '') +
    '<p class="help">The original publisher retains candidate sources, snapshot activations and reviewed buyer configurations in this workspace. Its session closes with the merchant; its saved records remain.</p>';
  let list = '<p class="empty">The native version store is created with the first merchant configuration.</p>';
  if (versions) list = '<dl><dt>Current snapshot</dt><dd>' + code(versions.current) + '</dd><dt>Native revision</dt><dd>' + versions.revision + '</dd></dl><div class="actions">' + button('publish-source', 'Publish selected completed acquisition') + button('collect-versions', 'Collect expired native snapshots') + '</div><div class="table-wrap"><table><thead><tr><th>Snapshot</th><th>State</th><th>Activated</th><th>Retention end</th><th></th></tr></thead><tbody>' + versions.versions.map(v => '<tr><td>' + code(v.snapshot) + '</td><td>' + tag(v.snapshot === versions.current ? 'CURRENT' : v.status ?? 'RETAINED') + '</td><td>' + date(v.activatedAt) + '</td><td>' + date(v.expiresAt) + '</td><td>' + (v.snapshot !== versions.current ? button('activate', 'Activate', 'data-id="' + v.snapshot + '"') : '') + '</td></tr>').join('') + '</tbody></table></div><p class="help">Publication and activation compare the displayed snapshot and native revision. Existing buyer cursors retain the original version and retention behavior.</p>';
  return heading('Merchant & buyers', 'Configure and own the existing versioned dataset seller. Continue customer review and preparation in its original publishing interface.') +
    '<div class="grid"><div>' + section('Merchant configuration', form) + '</div><div>' + section('Runtime & customer session', runtime) + '</div></div>' + section('Native snapshot lifecycle', list) +
    (configuration ? section('Saved advertised configuration', '<p>' + code(configuration.id) + ' · ' + code(configuration.configSha256) + '</p><details><summary>Complete original seller configuration</summary><pre>' + esc(json(configuration.config)) + '</pre></details>') : '') +
    section('Retained customer preparations', '<p>' + (state.publisher.buyers?.length ?? 0) + ' original buyer configurations · ' + (state.publisher.candidates?.length ?? 0) + ' retained publisher candidates.</p><p class="help">Open the publisher, query the selected snapshot from its first page, review the actual seller offer and download the original SF88 configuration. A later buyer approval or payment uses that existing buyer workflow.</p>');
}
function historyView() {
  const list = '<div class="table-wrap"><table><thead><tr><th>Revision</th><th>Product</th><th>Note</th><th>Saved</th><th></th></tr></thead><tbody>' + [...state.revisions].reverse().map(r => '<tr><td>' + code(short(r.id)) + (r.id === state.head ? '<br>' + tag('CURRENT') : '') + '</td><td>' + esc(r.name) + '<br>' + code(r.queryId) + '</td><td>' + esc(r.note) + '</td><td>' + date(r.createdAt) + '</td><td>' + button('view-revision', 'Inspect', 'data-id="' + r.id + '"') + '</td></tr>').join('') + '</tbody></table></div>';
  const history = historyRevision ? section('Inspected immutable revision', '<dl><dt>ID</dt><dd>' + code(historyRevision.id) + '</dd><dt>Original JSON SHA-256</dt><dd>' + code(historyRevision.productSha256) + '</dd><dt>Parent</dt><dd>' + code(historyRevision.parent ?? 'Initial revision') + '</dd><dt>Restored from</dt><dd>' + code(historyRevision.restoredFrom ?? '—') + '</dd></dl><pre>' + esc(historyRevision.productText) + '</pre><div class="actions">' + button('download-product', 'Download original product JSON') + button('restore-revision', 'Restore as a new product revision', historyRevision.id === state.head ? 'disabled' : '') + '</div><p class="help">Restoring creates a new head; all existing sources, products and merchant snapshots remain retained.</p>') : '';
  return heading('History & handoff', 'Inspect original product bytes, restore a prior product as a new revision and move the complete operating workspace.') + section('Product history', list) + history +
    section('Complete portable handoff', '<p>Export stops this workspace’s merchant and publisher, then retains every product revision, original result and query-run record, projected dataset, native merchant snapshot, publisher candidate and prepared buyer configuration.</p><p>Reopen into a new directory with the original CLI. The imported workspace starts stopped; the known native publisher directory binding is updated to the new location. API-key values and runtime control tokens are excluded.</p><pre>starforge allium-workspace import --workspace /private/new-allium-workspace --bundle /private/workspace.allium-workspace.json\nstarforge allium-workspace serve --workspace /private/new-allium-workspace</pre><div class="actions">' + button('export', 'Stop owned runtime & download full workspace', 'class="primary"') + '</div>') +
    (state.imports.length ? section('Portable origin history', '<pre>' + esc(json(state.imports)) + '</pre>') : '');
}
function render() {
  if (!state || !draft) return;
  $('#workspace-name').textContent = state.name; $('#pending').innerHTML = pendingView();
  $('#content').innerHTML = ({ overview, product: productView, acquisitions: acquisitionView, explore, merchant, history: historyView })[view]();
  document.querySelectorAll('[data-view]').forEach(node => node.setAttribute('aria-current', node.dataset.view === view ? 'page' : 'false'));
  document.body.dataset.busy = String(busy);
  document.querySelectorAll('header button,nav button').forEach(node => { node.disabled = busy; });
  if (busy) document.querySelectorAll('button,input,textarea,select').forEach(node => { node.disabled = true; });
  footer();
}
function updateProduct(config) {
  draft.productText = json(config) + '\n'; draft.productDirty = true;
  const editor = $('#productText'); if (editor) editor.value = draft.productText; queueLocal();
}
function downloadBlob(data, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function downloadSource(kind) {
  const response = await fetch('/api/download?id=' + encodeURIComponent(draft.acquisitionId) + '&kind=' + kind,
    { headers: { 'X-Allium-Workspace-Token': token }, credentials: 'omit', redirect: 'error' });
  if (!response.ok) { const error = await response.json(); throw new Error(error.message ?? error.error); }
  downloadBlob(await response.arrayBuffer(), response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? kind + '.json', response.headers.get('content-type'));
}
async function exportWorkspace() {
  busy = true; render();
  try {
    await saveLocal();
    const response = await fetch('/api/export', { method: 'POST', headers: { 'X-Allium-Workspace-Token': token, 'content-type': 'application/json' }, body: '{}', credentials: 'omit', redirect: 'error' });
    if (!response.ok) { const error = await response.json(); throw new Error(error.message ?? error.error); }
    downloadBlob(await response.arrayBuffer(), state.id + '.allium-workspace.json');
    adopt(await api('/api/state')); message('Complete workspace exported. The owned merchant and publisher are stopped.');
  } finally { busy = false; render(); }
}
const operationId = () => crypto.randomUUID();
async function runPreview() {
  const result = await perform('/api/preview', { acquisitionId: draft.acquisitionId, query: draft.query }, { retain: false });
  draft.preview = { acquisitionId: draft.acquisitionId, query: draft.query, result }; await saveLocal(); render();
  message(result.status === 200 ? 'Original typed query completed.' : 'The original dataset rejected this query.', result.status !== 200);
}
const actions = {
  refresh,
  'go-product': () => { view = 'product'; render(); }, 'go-acquisitions': () => { view = 'acquisitions'; render(); },
  'go-explore': () => { view = 'explore'; render(); }, 'go-merchant': () => { view = 'merchant'; render(); }, 'go-history': () => { view = 'history'; render(); },
  'render-product': () => render(),
  'adopt-current': async () => { cleanProduct(); await saveLocal(); render(); message('Loaded the current saved product. The preceding local draft remains recoverable.'); },
  'recover-draft': async () => { if (!draft.previousProduct) return; const previous = draft.previousProduct; draft.previousProduct = { productText: draft.productText, baseHead: draft.baseHead }; draft.productText = previous.productText; draft.baseHead = previous.baseHead; draft.productDirty = true; await saveLocal(); render(); },
  'save-product': async () => {
    const result = await perform('/api/product/save', { operationId: operationId(), expectedHead: draft.baseHead, productText: draft.productText, note: draft.productNote }, { replayable: true });
    cleanProduct(); draft.acquireRevisionId = result.revisionId; await saveLocal(); render(); message('Saved product revision ' + result.revisionId + '.');
  },
  'add-column': () => { const config = productObject(); if (!config?.columns) throw new Error('Correct the product JSON first.'); let name = 'field'; for (let n = 1; Object.hasOwn(config.columns, name); n++) name = 'field_' + n; config.columns[name] = { source: name, type: 'string', nullable: false }; updateProduct(config); render(); },
  'remove-column': node => { const config = productObject(), name = node.dataset.id; delete config.columns[name]; for (const key of ['filters', 'ranges', 'sorts']) config[key] = (config[key] ?? []).filter(v => v !== name); updateProduct(config); render(); },
  'import-result': async () => {
    if (!draft.importFile) throw new Error('Choose the complete original JSON result.');
    const result = await perform('/api/import', { operationId: operationId(), revisionId: draft.acquireRevisionId, resultBase64: draft.importFile.base64, filename: draft.importFile.name, note: draft.acquisitionNote }, { replayable: true });
    draft.acquisitionId = result.id; await saveLocal(); render(); message('Retained and staged the complete original source.');
  },
  'start-query': async () => { const result = await perform('/api/query/start', { operationId: operationId(), revisionId: draft.acquireRevisionId, note: draft.acquisitionNote }, { replayable: true }); draft.acquisitionId = result.id; await saveLocal(); render(); message('Saved query submitted once. Its retained run is ready for collection.'); },
  'select-acquisition': async node => { draft.acquisitionId = node.dataset.id; await saveLocal(); render(); },
  'collect-query': async () => { const result = await perform('/api/query/collect', { acquisitionId: draft.acquisitionId }); message('Native Allium status: ' + result.status + '.'); },
  'recover-query': async () => { await perform('/api/query/recover', { acquisitionId: draft.acquisitionId, runId: draft.recoverRunId }); message('The existing Allium run ID is attached; collect it when ready.'); },
  'resume-query': async () => { await perform('/api/query/resume', { acquisitionId: draft.acquisitionId }); message('Prepared acquisition submitted. Its native run identity is retained.'); },
  preview: runPreview,
  'first-page': async () => { const query = new URLSearchParams(draft.query); query.delete('cursor'); draft.query = query.toString(); await runPreview(); },
  'next-page': async () => { const previous = draft.preview; if (!previous?.result?.body?.page?.nextCursor) throw new Error('Run a first-page query with more rows.'); const query = new URLSearchParams(previous.query); query.set('cursor', previous.result.body.page.nextCursor); draft.query = query.toString(); await runPreview(); },
  configure: async () => {
    const result = await perform('/api/merchant/configure', { operationId: operationId(), acquisitionId: draft.acquisitionId, expectedConfigurationId: state.configurationId,
      origin: draft.merchant.origin, path: draft.merchant.path, payment: JSON.parse(draft.merchant.paymentText), settings: JSON.parse(draft.merchant.settingsText) }, { replayable: true });
    draft.merchantDirty = false; await saveLocal(); render(); message('Saved original merchant configuration ' + result.configurationId + '.');
  },
  'start-merchant': async () => { const result = await perform('/api/merchant/start', { expectedConfigurationId: state.configurationId, port: Number(draft.merchant.port), facilitator: draft.merchant.facilitator.trim() || null, allowLocalFacilitator: !!draft.merchant.allowLocalFacilitator }); message('Original merchant running at ' + result.url + ' (' + result.mode + ').'); },
  'stop-merchant': async () => { await perform('/api/merchant/stop', { expectedSessionId: state.runtime.id }); message('Owned merchant and publisher stopped; their native state is retained.'); },
  'open-publisher': async () => { await perform('/api/publisher', {}); message('Original publisher session is ready. Open its link to operate sources, snapshots and buyers.'); },
  'stage-publisher': async () => { await perform('/api/publisher/stage', { operationId: operationId(), acquisitionId: draft.acquisitionId }, { replayable: true }); message('The complete selected source is retained in the original publisher with its Allium provenance. Open the publisher link to review it.'); },
  'publish-source': async () => { const result = await perform('/api/merchant/refresh', { acquisitionId: draft.acquisitionId, expectedSnapshot: state.versions?.current, expectedRevision: state.versions?.revision }); message('Native source publication ' + (result.changed ? 'completed' : 'already current') + '.'); },
  activate: async node => { await perform('/api/merchant/activate', { snapshot: node.dataset.id, expectedSnapshot: state.versions.current, expectedRevision: state.versions.revision }); message('The selected native snapshot is current.'); },
  'collect-versions': async () => { const result = await perform('/api/merchant/collect', {}); message('Original native collection completed: ' + (result.removed?.length ?? 0) + ' expired snapshots removed.'); },
  'view-revision': async node => { historyRevision = await api('/api/revision?id=' + encodeURIComponent(node.dataset.id)); render(); },
  'restore-revision': async () => { const result = await perform('/api/product/restore', { operationId: operationId(), expectedHead: state.head, revisionId: historyRevision.id, note: 'Restore ' + historyRevision.id }, { replayable: true }); if (!draft.productDirty) cleanProduct(); draft.acquireRevisionId = result.revisionId; await saveLocal(); render(); message('Restored as new product revision ' + result.revisionId + '.'); },
  'download-product': () => downloadBlob(historyRevision.productText, historyRevision.id + '.product.json'),
  export: exportWorkspace,
  retry: async () => { if (!pending?.replayable) throw new Error('Read saved state before continuing.'); const retained = structuredClone(pending); await perform(retained.path, retained.body, { replayable: true }); message('The original retained request has been reconciled.'); },
  'clear-pending': async () => { await local.deletePending(); pending = null; render(); message('Cleared the local pending request. Existing server work and saved records remain.'); },
};
document.addEventListener('click', async event => {
  const node = event.target.closest('button'); if (!node || node.disabled || busy) return;
  try {
    if (node.dataset.view) { await saveLocal(); view = node.dataset.view; render(); return; }
    if (node.dataset.action?.startsWith('download-') && !['download-product'].includes(node.dataset.action)) return await downloadSource(node.dataset.action.slice(9));
    const action = actions[node.dataset.action]; if (action) { message(''); await action(node); }
  } catch (error) { message((error.code ? error.code + ': ' : '') + error.message, true); }
});
document.addEventListener('input', event => {
  const node = event.target;
  if (busy || node.type === 'file' || node.dataset.column) return;
  if (node.dataset.product) {
    const config = productObject(); if (!config) return;
    config[node.dataset.product] = node.type === 'number' ? Number(node.value) : node.value; updateProduct(config); return;
  }
  const name = node.dataset.model; if (!name || !draft) return;
  const value = node.type === 'checkbox' ? node.checked : node.value;
  if (name.startsWith('merchant.')) { draft.merchant[name.slice(9)] = value; draft.merchantDirty = true; }
  else { draft[name] = value; if (name === 'productText') draft.productDirty = true; }
  queueLocal();
});
document.addEventListener('change', async event => {
  const node = event.target;
  try {
    if (node.id === 'resultFile') {
      const file = node.files?.[0]; if (!file) return;
      if (file.size > 1048576) throw new Error('The original Allium product accepts at most 1 MiB per result.');
      const data = new Uint8Array(await file.arrayBuffer()); let binary = '';
      for (let offset = 0; offset < data.length; offset += 32768) binary += String.fromCharCode(...data.subarray(offset, offset + 32768));
      draft.importFile = { name: file.name, bytes: data.length, base64: btoa(binary) }; await saveLocal(); render(); return;
    }
    if (node.dataset.column) {
      const config = productObject(), name = node.dataset.column, key = node.dataset.key;
      if (!config?.columns?.[name]) throw new Error('Reload the structured projection after editing its raw JSON.');
      if (key === 'name') {
        const next = node.value;
        if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(next) || ['constructor', 'prototype', '__proto__'].includes(next) || next !== name && Object.hasOwn(config.columns, next)) throw new Error('Use a unique public column identifier.');
        config.columns = Object.fromEntries(Object.entries(config.columns).map(([n, value]) => [n === name ? next : n, value]));
        for (const capability of ['filters', 'ranges', 'sorts']) config[capability] = (config[capability] ?? []).map(n => n === name ? next : n);
      } else if (['filters', 'ranges', 'sorts'].includes(key)) config[key] = [...new Set([...(config[key] ?? []).filter(n => n !== name), ...(node.checked ? [name] : [])])];
      else config.columns[name][key] = node.type === 'checkbox' ? node.checked : node.value;
      updateProduct(config); await saveLocal(); render(); return;
    }
    if (node.dataset.model === 'acquisitionId' || node.dataset.model === 'acquireRevisionId') { draft[node.dataset.model] = node.value; await saveLocal(); render(); }
  } catch (error) { message(error.message, true); }
});
window.addEventListener('beforeunload', event => { if (!savedAt && draft) { event.preventDefault(); event.returnValue = ''; } });

async function bootstrap() {
  state = await api('/api/state'); local = createDraftStore(state.id);
  [draft, pending] = await Promise.all([local.readDraft(), local.readPending()]);
  if (!draft) draft = { baseHead: state.head, productText: state.current.productText, productDirty: false, productNote: '',
    acquisitionId: state.acquisitions.at(-1)?.id ?? null, acquireRevisionId: state.head, acquisitionNote: '', importFile: null,
    query: '', recoverRunId: '', preview: null, merchantDirty: false,
    merchant: { origin: '', path: '/data', paymentText: json({ scheme: 'exact', network: 'stellar:testnet', asset: '', amount: '', payTo: '', maxTimeoutSeconds: 60 }),
      settingsText: '{}', port: '0', facilitator: '', allowLocalFacilitator: false } };
  adopt(state); await saveLocal(); render();
  if (pending) message('A prior request is retained locally. Read its saved outcome before another source operation.');
}
bootstrap().catch(error => message(error.message, true));
