// MIT. ArcGIS source intake and deployment in the original publisher workspace.
import { publisherHost as host } from '/app.mjs';

const $ = id => document.getElementById(id);
const PREFIX = '/api/arcgis/';
const ROUTES = new Set(['captures', 'continue', 'pause', 'editions', 'select', 'deployments',
  'stage', 'release-console', 'uploads', 'remove-upload']);
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const RESERVED = new Set(['constructor', 'prototype', '__proto__']);
const INTEGER = new Set(['OID', 'ObjectID', 'SmallInteger', 'Integer', 'BigInteger', 'BigInt', 'Date']);
const NUMBER = new Set(['Single', 'Double']);
const TEXT = new Set(['String', 'GUID', 'GlobalID', 'XML', 'DateOnly', 'TimeOnly', 'TimestampOffset']);
const RETRYABLE = new Set(['FAILED', 'PAUSED', 'INTERRUPTED', 'UNCERTAIN', 'PENDING']);
const state = {
  identity: null, status: null, wrongWorkspace: false, busy: false, refreshing: null, timer: null,
  offsets: { captures: 0, editions: 0, deployments: 0 }, captureId: null, capture: null,
  editionId: null, edition: null, deploymentId: null, deployment: null, mappingDirty: false,
  requests: [], files: new Map(), interactive: new Set(), listKeys: {},
  pages: [], geometryPages: [], closed: false, polling: false,
};

function node(tag, text = '', attributes = {}) {
  const value = document.createElement(tag);
  value.textContent = text;
  for (const [key, item] of Object.entries(attributes)) value.setAttribute(key, item);
  return value;
}
function button(text, callback, attributes = {}) {
  const value = node('button', text, { type: 'button', ...attributes });
  value.addEventListener('click', () => perform(callback));
  return value;
}
function words(value) { return String(value ?? '').replaceAll('_', ' ').toLowerCase(); }
function size(value) { return Number.isFinite(value) ? `${(value / 1048576).toFixed(2)} MiB` : '—'; }
function count(value) { return Number.isFinite(value) ? value.toLocaleString() : '—'; }
function short(value) { return value ? String(value).slice(0, 12) + '…' : '—'; }
function pretty(value) { return JSON.stringify(value, null, 2); }
function text(id, value) { $(id).textContent = value; }
function validName(value) { return NAME.test(value) && !RESERVED.has(value); }
function message(error) { return error?.message || words(error?.code) || 'The operation could not finish.'; }

const sourcePanel = node('section', '', { class: 'panel arcgis-panel', id: 'arcgis-source-panel' });
// Only this fixed application template uses HTML. Source values are rendered as text below.
sourcePanel.innerHTML = `
  <div class="section-heading"><div><span class="eyebrow">SOURCE INTAKE</span><h2>ArcGIS source editions</h2></div><span id="arcgis-source-state" class="badge">Connecting…</span></div>
  <p id="arcgis-current-source" class="muted">Loading the original publisher workspace.</p>
  <details id="arcgis-intake" open><summary>Prepare a source capture</summary>
    <form id="arcgis-capture-form">
      <div class="two"><label>Capture name<input id="arcgis-title" maxlength="240" required placeholder="Layer and observation date"></label><label>Source input<select id="arcgis-mode"><option value="live">Live ArcGIS layer</option><option value="files">Original response files</option></select></label></div>
      <label>ArcGIS layer URL<input id="arcgis-layer" type="url" required placeholder="https://…/MapServer/0"><small>The original FeatureServer or MapServer layer, including its numeric layer ID.</small></label>
      <div class="two"><label>Selection expression<input id="arcgis-where" required maxlength="8192" value="1=1"></label><label>Retained attribute fields<input id="arcgis-fields" placeholder="Leave blank for all native fields"><small>Comma-separated native field names. The original object ID is always retained.</small></label></div>
      <label>Geometry<select id="arcgis-geometry"><option value="auto">Use the layer’s original geometry setting</option><option value="yes">Retain original geometry and spatial reference</option><option value="no">Attributes only</option></select></label>
      <div id="arcgis-file-input" hidden>
        <label>Original layer metadata JSON<input id="arcgis-metadata" type="file" accept=".json,application/json"><small>Maximum 2 MiB for layer metadata.</small></label>
        <label>Original feature response pages<input id="arcgis-pages" type="file" multiple accept=".json,application/json"><small>Each page may be up to 16 MiB. Files are retained in the order shown.</small></label><ol id="arcgis-page-files" class="arcgis-file-list"></ol>
        <details><summary>Join original geometry response pages</summary><label>Geometry pages<input id="arcgis-geometry-pages" type="file" multiple accept=".json,application/json"></label><ol id="arcgis-geometry-files" class="arcgis-file-list"></ol><label>Exact shared attribute field<input id="arcgis-geometry-field" placeholder="GEOID"><small>The field must be present in both original responses.</small></label></details>
        <label>Response representation<select id="arcgis-representation"><option value="parsed-json">Saved JSON response</option><option value="wire-json">Original JSON response bytes</option></select></label>
      </div>
      <details><summary>Capture limits and connection</summary><div class="limits">
        <label>Maximum rows<input id="arcgis-max-rows" type="number" min="1" max="1000000" value="250000" required></label>
        <label>Maximum source MiB<input id="arcgis-source-mib" type="number" min="1" max="256" value="64" required></label>
        <label data-arcgis-live>Rows per request<input id="arcgis-page-size" type="number" min="1" max="1000" value="250" required></label>
        <label data-arcgis-live>Maximum response MiB<input id="arcgis-page-mib" type="number" min="1" max="64" value="16" required></label>
        <label data-arcgis-live>Request timeout, seconds<input id="arcgis-timeout" type="number" min="1" max="300" value="120" required></label>
      </div><label data-arcgis-live>Token environment variable, if required<input id="arcgis-token-env" pattern="[A-Za-z_][A-Za-z0-9_]*" placeholder="ARCGIS_TOKEN"><small>The host reads the named environment variable when contacting the service.</small></label></details>
      <div class="actions"><button id="arcgis-prepare" type="submit" class="primary">Prepare capture</button><span id="arcgis-upload-progress" class="muted" role="status"></span></div>
      <p class="muted">Preparation saves the selection and original inputs. Continue capture processes the remaining pages.</p>
    </form>
  </details>
  <div class="arcgis-split"><div><h3>Retained captures</h3><div id="arcgis-captures" class="stack"></div><nav id="arcgis-captures-pages" class="pagination" aria-label="Capture pages"></nav></div><div><h3>Saved source editions</h3><div id="arcgis-editions" class="stack"></div><nav id="arcgis-editions-pages" class="pagination" aria-label="Source edition pages"></nav></div></div>
  <div id="arcgis-capture-detail" class="arcgis-detail" hidden>
    <div class="section-heading"><h3 id="arcgis-capture-title"></h3><span id="arcgis-capture-state" class="badge"></span></div><div id="arcgis-capture-metrics" class="metrics"></div>
    <p id="arcgis-capture-error" class="error" hidden></p><p id="arcgis-capture-identity" class="mono muted"></p>
    <div class="actions"><label class="arcgis-inline-label">Pages this continuation<input id="arcgis-continue-pages" type="number" min="1" max="1000000" placeholder="All remaining"></label><button id="arcgis-continue" type="button">Continue capture</button><button id="arcgis-pause" type="button" hidden>Pause capture</button><button id="arcgis-reload-capture" type="button">Reload capture</button></div>
  </div>
  <form id="arcgis-mapping-form" class="arcgis-detail" hidden>
    <h3>Map a complete capture</h3><p class="muted">Choose public names for the original values. The native object ID remains the first column and the extraction order. Types and nullability come from the layer metadata.</p>
    <div class="two"><label>Source edition name<input id="arcgis-edition-title" maxlength="240" required></label><label>Public query name<input id="arcgis-query" maxlength="48" value="records" pattern="[A-Za-z][A-Za-z0-9_]{0,47}" required></label></div>
    <div class="table-wrap arcgis-mapping"><table><thead><tr><th>Include</th><th>Public name</th><th>Native value</th><th>Order</th><th>Type / null</th><th>Original sample</th></tr></thead><tbody id="arcgis-mapping"></tbody></table></div>
    <p id="arcgis-mapping-count" class="muted"></p><details><summary>Original selection, geometry and sample attributes</summary><pre id="arcgis-capture-metadata"></pre><div id="arcgis-sample-table" class="table-wrap"></div></details>
    <div class="actions"><button id="arcgis-save-edition" type="submit" class="primary">Save source edition</button><button id="arcgis-reset-mapping" type="button">Restore native mapping</button><span class="muted">Up to 64 public columns.</span></div>
  </form>
  <div id="arcgis-edition-detail" class="arcgis-detail" hidden><h3 id="arcgis-edition-name"></h3><p id="arcgis-edition-binding" class="mono"></p><details><summary>Retained source declaration</summary><pre id="arcgis-edition-source"></pre></details><div class="actions"><button id="arcgis-select-edition" class="primary" type="button">Select for new plans</button><span id="arcgis-edition-current" class="muted"></span></div></div>
  <details><summary>Retained upload copies</summary><p class="muted">The workspace accepts 64 MiB per upload and 256 MiB of retained ingress. Remove an ingress copy after its capture or deployment has retained the required original bytes.</p><div id="arcgis-uploads"></div></details>
  <details id="arcgis-requests-details"><summary>Submitted operations and recovery</summary><p class="muted">Check an operation after an interrupted response. Retry continues that same submitted input. A page reload only reads saved state.</p><div id="arcgis-requests"></div></details>
`;
$('configuration').before(sourcePanel);

const deploymentPanel = node('section', '', { class: 'panel arcgis-panel', id: 'arcgis-deployment-panel' });
deploymentPanel.innerHTML = `
  <div class="section-heading"><div><span class="eyebrow">DEPLOYMENT</span><h2>Deliver this published dataset</h2></div><span id="arcgis-published-state" class="badge">Select a published extraction</span></div>
  <p id="arcgis-published-run" class="muted">Publish a reviewed candidate above, or select an existing published extraction.</p>
  <form id="arcgis-deployment-form"><div class="two"><label>Deployment name<input id="arcgis-deployment-label" maxlength="240" required placeholder="Dataset and release date"></label><label>Original seller configuration JSON<input id="arcgis-seller" type="file" accept=".json,application/json" required><small>Use the seller configuration with its existing environment variable references.</small></label></div><button id="arcgis-export" class="primary" type="submit" disabled>Prepare deployment package</button></form>
  <h3>Retained deployments</h3><div id="arcgis-deployments" class="stack"></div><nav id="arcgis-deployments-pages" class="pagination" aria-label="Deployment pages"></nav>
  <div id="arcgis-deployment-detail" class="arcgis-detail" hidden><h3 id="arcgis-deployment-title"></h3><p id="arcgis-deployment-binding" class="mono"></p><details><summary>Original package and release</summary><pre id="arcgis-deployment-inspection"></pre></details><div id="arcgis-downloads" class="arcgis-downloads"></div>
    <form id="arcgis-stage-form"><div class="two"><label>Release ID<input id="arcgis-release-id" maxlength="128" required placeholder="dataset-20261012"></label><label>Release label<input id="arcgis-release-label" maxlength="240" required></label></div><button id="arcgis-stage" class="primary" type="submit">Stage in the release store</button></form>
    <p id="arcgis-release-state" class="muted"></p>
  </div>
  <div class="arcgis-detail"><h3>Seller release controls</h3><p class="muted">Open the existing seller before reviewing a dataset refresh. The original release controls select, start, drain, restart and roll back the seller. Staging adds this exact published package to that same host.</p><div class="actions"><button id="arcgis-open-console" type="button">Open release controls</button><a id="arcgis-console-link" target="_blank" rel="noopener noreferrer" hidden>Continue to release controls</a></div></div>
`;
$('review-panel').after(deploymentPanel);
if (!$('max-cell-chars')) {
  const label = node('label', 'Maximum characters per CSV cell');
  label.append(node('input', '', { id: 'max-cell-chars', type: 'number', min: '1', max: '8388608', value: '1048576', required: '' }),
    node('small', 'Allow space for the original geometry JSON.'));
  $('configuration').querySelector('.limits').append(label);
}

function storageKey() { return `arcgis-workbench:${state.identity}`; }
function save() {
  if (!state.identity) return;
  const pending = state.requests.filter(x => x.state !== 'SUCCEEDED');
  const complete = state.requests.filter(x => x.state === 'SUCCEEDED').slice(-12);
  const requests = [...pending, ...complete].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const value = { version: 1, identity: state.identity, requests, captureId: state.captureId,
    editionId: state.editionId, deploymentId: state.deploymentId };
  try { sessionStorage.setItem(storageKey(), JSON.stringify(value)); }
  catch { throw new Error('The browser cannot retain this submitted operation. Free session storage before submitting it.'); }
  state.requests = requests;
}
function restore() {
  let value;
  try { value = JSON.parse(sessionStorage.getItem(storageKey()) ?? 'null'); }
  catch { host.notice('Saved browser operation history could not be read. Retained workspace items remain available below.'); return; }
  if (!value || value.version !== 1 || value.identity !== state.identity) return;
  state.captureId = value.captureId ?? null;
  state.editionId = value.editionId ?? null;
  state.deploymentId = value.deploymentId ?? null;
  state.requests = Array.isArray(value.requests) ? value.requests.filter(x =>
    x && ROUTES.has(x.route) && x.input?.requestId === x.id && typeof x.createdAt === 'string') : [];
}
async function api(path, options = {}) {
  if (state.wrongWorkspace) throw new Error('This browser belongs to another publisher workspace. Reload the page to review the current workspace.');
  let response;
  try {
    response = await fetch(PREFIX + path, { ...options, cache: 'no-store', headers: {
      ...(state.identity ? { 'x-arcgis-workbench': state.identity } : {}), ...options.headers,
    } });
  } catch {
    const error = new Error('The response was interrupted. Check the retained operation before retrying.');
    error.uncertain = true; throw error;
  }
  let result;
  try { result = await response.json(); }
  catch {
    const error = new Error('The server response could not be read. Check the retained operation before retrying.');
    error.uncertain = true; throw error;
  }
  if (!response.ok) {
    const error = new Error(result.message || words(result.error) || `Request failed (${response.status}).`);
    error.status = response.status; error.code = result.error; error.request = result.request;
    if (error.code === 'ARCGIS_WORKSPACE_CHANGED') state.wrongWorkspace = true;
    throw error;
  }
  return result;
}
async function perform(callback) {
  if (state.busy || host.context().busy || state.wrongWorkspace) return;
  await host.action(async () => {
    state.busy = true; controls();
    try { await callback(); }
    finally { state.busy = false; controls(); }
  });
}
function requestSummary(result) {
  // Do not persist source samples, package contents, or a private console URL in browser history.
  return result && { id: result.id, captureId: result.capture?.id, editionId: result.edition?.id,
    deploymentId: result.deployment?.id, removed: result.removed };
}
async function accept(record, response) {
  const request = response?.request?.id === record.id ? response.request : response?.id === record.id && response.state ? response : null;
  const result = request ? (record.route === 'release-console' && response?.url ?
    { ...request.result, url: response.url, origin: response.origin } : request.result) : response;
  record.state = request?.state ?? 'SUCCEEDED';
  record.error = request?.error ? message(request.error) : null;
  record.result = requestSummary(result);
  save(); renderRequests();
  if (record.state === 'SUCCEEDED' && state.interactive.delete(record.id)) await applyResult(record, result);
  if (['FAILED', 'PAUSED', 'INTERRUPTED'].includes(record.state)) {
    $('arcgis-requests-details').open = true;
    host.notice(record.error || `${record.label}: ${words(record.state)}. Review the original submitted operation below.`);
  }
  return result;
}
async function dispatch(record, file) {
  record.state = 'PENDING'; record.error = null; save(); renderRequests();
  let response;
  try {
    response = record.route === 'uploads' ? await api('uploads?' + new URLSearchParams(record.input), {
      method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: file,
    }) : await api(record.route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(record.input) });
  } catch (error) {
    record.state = error.uncertain ? 'UNCERTAIN' : 'FAILED'; record.error = message(error);
    record.conflict = error.status === 409;
    if (error.request?.id === record.id) {
      record.state = error.request.state; record.error = message(error.request.error);
    }
    save(); renderRequests(); $('arcgis-requests-details').open = true;
    if (record.conflict && !state.wrongWorkspace) await refresh().catch(() => {});
    throw error;
  }
  // A later read or rendering failure cannot turn a confirmed mutation into a failed request.
  return accept(record, response);
}
async function submit(route, input, label) {
  const previous = [...state.requests].reverse().find(record => {
    const { requestId, ...original } = record.input;
    return record.route === route && record.state !== 'SUCCEEDED' && !record.conflict &&
      JSON.stringify(original) === JSON.stringify(input);
  });
  if (previous) {
    state.interactive.add(previous.id);
    await check(previous);
    if (['RUNNING', 'SUCCEEDED'].includes(previous.state)) { await refresh(); return { record: previous }; }
    const value = await dispatch(previous); await refresh(); return { record: previous, value };
  }
  const id = crypto.randomUUID();
  const record = { id, route, input: { requestId: id, ...input }, label, createdAt: new Date().toISOString(), state: 'PENDING' };
  state.requests.push(record); state.interactive.add(id);
  if (route === 'captures') state.captureId = id;
  if (route === 'editions') state.editionId = id;
  if (route === 'deployments') state.deploymentId = id;
  save();
  const value = await dispatch(record);
  await refresh();
  return { record, value };
}
async function check(record, interactive = false) {
  try {
    if (interactive) state.interactive.add(record.id);
    const request = await api('request?' + new URLSearchParams({ id: record.id }));
    if (!request) throw Object.assign(new Error('This request is not recorded by the workspace.'), { status: 404 });
    await accept(record, request);
  } catch (error) {
    if (error.status === 404) {
      record.state = 'UNCERTAIN'; record.error = 'The workspace has no recorded outcome for this request. Review its exact input and explicitly retry to continue.';
      save(); renderRequests();
    } else throw error;
  }
}
async function applyResult(record, result) {
  if (record.route === 'captures' || record.route === 'continue') {
    state.captureId = result?.capture?.id ?? record.input.captureId ?? record.id;
    await loadCapture(state.captureId, false);
  } else if (record.route === 'editions') {
    state.editionId = result?.edition?.id ?? record.id;
    if (record.input.captureId === state.captureId &&
      record.input.title === $('arcgis-edition-title').value.trim() && record.input.query === $('arcgis-query').value.trim()) {
      try { if (JSON.stringify(record.input.columns) === JSON.stringify(mappingInput())) state.mappingDirty = false; }
      catch { /* Keep any mapping edited since this request was submitted. */ }
    }
    mappingCount();
    await loadEdition(state.editionId);
    host.notice('Source edition saved. Select it for new plans when the mapping is ready.');
  } else if (record.route === 'select') {
    await host.newPlan(); await host.refresh();
    host.notice('The selected source edition is available to new plans. Review the publication plan below.');
  } else if (record.route === 'deployments' || record.route === 'stage') {
    state.deploymentId = result?.deployment?.id ?? record.input.deploymentId ?? record.id;
    await loadDeployment(state.deploymentId);
  } else if (record.route === 'release-console' && result?.url) {
    const url = new URL(result.url), origin = new URL(result.origin);
    if (url.origin !== origin.origin || url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
      throw new Error('The server did not return its local release console URL.');
    $('arcgis-console-link').href = url.href; $('arcgis-console-link').hidden = false;
    $('arcgis-console-link').focus();
    host.notice('Release controls are ready. Follow the link to the original seller controls.');
  } else if (record.route === 'release-console') {
    host.notice('The earlier release-control request is recorded. Use Open release controls for a current link.');
  }
  save();
}
async function upload(file) {
  if (!file || !file.size || file.size > 67108864) throw new Error('Choose a nonempty original JSON file of at most 64 MiB.');
  text('arcgis-upload-progress', `Retaining ${file.name} · ${size(file.size)}`);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  const existing = state.status?.uploads.find(x => x.name === file.name && x.sha256 === hash && x.bytes === file.size);
  if (existing) return existing;
  let record = [...state.requests].reverse().find(x => x.route === 'uploads' && x.state !== 'SUCCEEDED' &&
    x.input.name === file.name && x.input.sha256 === hash && !x.conflict);
  if (!record) {
    const id = crypto.randomUUID();
    record = { id, route: 'uploads', input: { requestId: id, name: file.name, sha256: hash },
      fileBytes: file.size, label: `Upload ${file.name}`, createdAt: new Date().toISOString(), state: 'PENDING' };
    state.requests.push(record);
  }
  state.files.set(record.id, file); save();
  const result = await dispatch(record, file);
  if (record.state !== 'SUCCEEDED' || !result?.id) throw new Error(record.error || 'The original file upload has not completed.');
  await refresh();
  return result;
}

function controls() {
  const blocked = state.busy || host.context().busy || !state.identity || state.wrongWorkspace;
  const active = state.status?.active || host.context().snapshot?.active;
  const capture = state.capture?.capture;
  const captureActive = state.status?.active?.captureId === state.captureId;
  for (const id of ['arcgis-prepare', 'arcgis-save-edition', 'arcgis-select-edition', 'arcgis-stage']) $(id).disabled = blocked || Boolean(active);
  $('arcgis-select-edition').disabled ||= !state.edition;
  $('arcgis-save-edition').disabled ||= capture?.state !== 'COMPLETE';
  $('arcgis-continue').disabled = blocked || Boolean(active) || !capture || capture.state === 'COMPLETE';
  $('arcgis-pause').hidden = !captureActive;
  $('arcgis-pause').disabled = blocked || !captureActive;
  $('arcgis-reload-capture').disabled = blocked;
  $('arcgis-open-console').disabled = blocked || !(state.status?.releaseReady || state.deployment?.deployment?.releaseId);
  $('arcgis-export').disabled = blocked || Boolean(active) || host.context().detail?.run?.state !== 'PUBLISHED';
  for (const element of document.querySelectorAll('[data-arcgis-operation]')) element.disabled = blocked || Boolean(active);
  for (const element of document.querySelectorAll('[data-arcgis-read]')) element.disabled = blocked;
  const currentRun = host.context().detail?.run;
  text('arcgis-published-state', currentRun ? words(currentRun.state) : 'Select a published extraction');
  text('arcgis-published-run', currentRun?.state === 'PUBLISHED' ?
    `${host.context().detail.plan.data.title} · run ${currentRun.id} · published version ${short(currentRun.data.publication?.snapshot)}` :
    'Publish a reviewed candidate above, or select an existing published extraction.');
}
function pages(kind) {
  const page = state.status.pages[kind], nav = $('arcgis-' + kind + '-pages');
  nav.replaceChildren();
  if (!page) return;
  nav.append(node('span', page.total ? `${page.offset + 1}–${Math.min(page.offset + page.limit, page.total)} of ${page.total}` : 'No retained items'));
  for (const [label, offset] of [['Previous', page.previous], ['Next', page.next]]) {
    const value = button(label, async () => { state.offsets[kind] = offset; await refresh(); });
    value.disabled = offset === null; nav.append(value);
  }
}
function list(kind, items, selected, title, description, select) {
  const key = JSON.stringify([items, selected, state.status.pages[kind]]);
  if (state.listKeys[kind] === key) return;
  state.listKeys[kind] = key;
  const area = $('arcgis-' + kind); area.replaceChildren();
  if (!items.length) area.append(node('p', 'No retained ' + (kind === 'editions' ? 'source editions' : kind) + '.', { class: 'muted' }));
  for (const item of items) {
    const value = button('', () => select(item.id), { class: item.id === selected ? 'selected' : '', 'data-arcgis-read': '' });
    value.append(node('strong', title(item)), node('span', description(item)));
    value.setAttribute('aria-pressed', String(item.id === selected)); area.append(value);
  }
  pages(kind);
}
function renderStatus() {
  const value = state.status;
  text('arcgis-source-state', value.active ? words(value.active.kind) : value.sourceReady ? 'Source ready' : 'Source required');
  const selected = value.editions.find(x => x.id === value.currentEditionId);
  text('arcgis-current-source', selected ? `Current source: ${selected.title} · ${short(selected.sourceHash)}` :
    value.currentEditionId ? `Current source edition: ${value.currentEditionId}` :
    value.sourceReady ? 'The original configured source is available. Save an edition to select another reviewed mapping.' :
    'Prepare and complete a capture, save its field mapping, then select the source edition for a publication plan.');
  list('captures', value.captures, state.captureId, x => x.title,
    x => `${words(x.state)} · ${count(x.selectedRecords)} rows · ${count(x.retainedPages)} retained pages · ${size(x.sourceBytes)}`, id => loadCapture(id, true));
  list('editions', value.editions, state.editionId, x => x.title + (x.selected ? ' · current' : ''),
    x => `Query ${x.query} · source ${short(x.sourceHash)}`, loadEdition);
  list('deployments', value.deployments, state.deploymentId, x => x.label,
    x => `${words(x.state)} · run ${short(x.run)}${x.releaseId ? ' · ' + x.releaseId : ''}`, loadDeployment);
  const live = value.captures.find(x => x.id === state.captureId);
  if (state.capture && live) { Object.assign(state.capture.capture, live); renderCaptureStatus(); }
  text('arcgis-edition-current', state.editionId === value.currentEditionId ? 'Selected for new plans.' : 'Saved plans retain their selected source edition.');
  renderUploads(); controls();
}
async function refresh() {
  if (state.closed || state.wrongWorkspace) return;
  if (state.refreshing) return state.refreshing;
  state.refreshing = (async () => {
    const query = new URLSearchParams({ limit: '25', ...Object.fromEntries(Object.entries(state.offsets).map(([k, v]) => [k + 'Offset', String(v)])) });
    const value = await api('status?' + query);
    if (state.identity && value.workbenchId !== state.identity) {
      state.wrongWorkspace = true; throw new Error('The publisher workspace changed. Reload to review the current workspace.');
    }
    if (!state.identity) { state.identity = value.workbenchId; restore(); }
    state.status = value; renderStatus();
  })();
  try { await state.refreshing; } finally { state.refreshing = null; }
}
async function poll() {
  if (state.closed || state.polling) return;
  state.polling = true;
  try {
    if (!document.hidden && !state.busy && !host.context().busy) {
      await refresh();
      for (const record of state.requests.filter(x => x.state === 'RUNNING' || x.state === 'PENDING')) {
        if (state.busy || host.context().busy) break;
        await check(record);
      }
      if (state.capture?.capture.state === 'COMPLETE' && !state.capture.defaultColumns) await loadCapture(state.captureId, false);
    }
  } catch (error) { host.notice(message(error)); }
  finally {
    state.polling = false;
    controls();
    if (!state.closed && !state.wrongWorkspace) state.timer = setTimeout(poll, state.status?.active ? 2500 : 8000);
  }
}
function renderCaptureStatus() {
  const value = state.capture?.capture;
  $('arcgis-capture-detail').hidden = !value;
  if (!value) return;
  text('arcgis-capture-title', value.title || 'Retained capture');
  text('arcgis-capture-state', words(value.state));
  text('arcgis-capture-identity', `Capture ${value.id} · SHA-256 ${value.captureSha256 || 'available after completion'}`);
  const area = $('arcgis-capture-metrics'); area.replaceChildren();
  for (const [label, amount] of [['Selected records', count(value.selectedRecords)], ['Retained pages', count(value.retainedPages)],
    ['Pending pages', count(value.pendingPages)], ['Source bytes', size(value.sourceBytes)]]) {
    const item = node('div', '', { class: 'metric' }); item.append(node('span', label), node('strong', amount)); area.append(item);
  }
  text('arcgis-capture-error', value.error ? words(value.error) : ''); $('arcgis-capture-error').hidden = !value.error;
  controls();
}
async function loadCapture(id, prompt) {
  if (prompt && state.mappingDirty && !window.confirm('Replace the unsaved source mapping with this retained capture?')) return;
  const value = await api('capture?' + new URLSearchParams({ id }));
  const changed = state.captureId !== id || state.capture?.capture.captureSha256 !== value.capture.captureSha256 || !state.capture?.defaultColumns;
  state.captureId = id; state.capture = value; save();
  renderCaptureStatus();
  $('arcgis-mapping-form').hidden = value.capture.state !== 'COMPLETE';
  if (value.capture.state === 'COMPLETE' && (changed || prompt)) renderMapping();
  renderStatus();
}
function scalar(type) {
  const name = String(type).replace(/^esriFieldType/, '');
  return INTEGER.has(name) ? 'integer' : NUMBER.has(name) ? 'number' : TEXT.has(name) ? 'string' : null;
}
function renderMapping() {
  const detail = state.capture, area = $('arcgis-mapping'); area.replaceChildren();
  state.mappingDirty = false;
  $('arcgis-edition-title').value = (detail.capture.title + ' source').slice(0, 240);
  $('arcgis-query').value = 'records';
  const defaults = Object.entries(detail.defaultColumns);
  const fields = [...detail.fields].sort((a, b) => a.name === detail.objectIdField ? -1 : b.name === detail.objectIdField ? 1 : 0);
  const rows = fields.map(field => ({ key: field.name, spec: { field: field.name }, field,
    name: defaults.find(([, spec]) => spec.field === field.name)?.[0] ?? (validName(field.name) ? field.name : ''),
    checked: defaults.some(([, spec]) => spec.field === field.name), type: scalar(field.type) }));
  for (const [source, label, fallback] of [['attributes', 'Complete attributes JSON', 'attributes_json'],
    ['geometry', 'Original geometry JSON', 'geometry_json'], ['spatialReference', 'Original spatial reference JSON', 'spatial_reference_json']]) {
    if (source !== 'attributes' && !detail.query.returnGeometry) continue;
    rows.push({ key: label, spec: { source }, name: defaults.find(([, spec]) => spec.source === source)?.[0] ?? fallback, checked: true, type: 'string' });
  }
  for (const row of rows) {
    const tr = node('tr'), included = node('input', '', { type: 'checkbox', 'aria-label': 'Include ' + row.key });
    const isId = row.spec.field === detail.objectIdField;
    included.checked = row.checked || isId; included.disabled = isId || !row.type;
    const publicName = node('input', '', { type: 'text', maxlength: '48', 'aria-label': 'Public name for ' + row.key });
    publicName.value = row.name; publicName.disabled = !included.checked;
    const order = node('td', '', { class: 'arcgis-column-order' });
    const up = button('Up', async () => {
      const previous = tr.previousElementSibling;
      if (previous && !previous._mapping.isId) { area.insertBefore(tr, previous); mappingChanged(); }
    }, { 'aria-label': 'Move ' + row.key + ' up' });
    const down = button('Down', async () => {
      const next = tr.nextElementSibling;
      if (next && !isId) { area.insertBefore(next, tr); mappingChanged(); }
    }, { 'aria-label': 'Move ' + row.key + ' down' });
    order.append(up, down);
    tr._mapping = { included, publicName, spec: row.spec, isId, up, down };
    const includeCell = node('td'), nameCell = node('td'); includeCell.append(included); nameCell.append(publicName);
    const nullable = row.field ? row.field.nullable !== false && !isId : false;
    const type = row.type ? `${row.type} / ${nullable ? 'nullable' : 'required'}` : 'Use attributes JSON';
    const sample = row.field ? detail.samples[0]?.attributes?.[row.field.name] : undefined;
    const sampleText = sample === undefined ? '—' : sample === null ? 'NULL' : typeof sample === 'string' ? sample : JSON.stringify(sample);
    const value = node('td', sampleText, { class: 'arcgis-original-value' });
    tr.append(includeCell, nameCell, node('td', row.key + (isId ? ' · object ID' : '')), order, node('td', type), value);
    included.addEventListener('change', () => { publicName.disabled = !included.checked; mappingChanged(); });
    publicName.addEventListener('input', mappingChanged); area.append(tr);
  }
  text('arcgis-capture-metadata', pretty({ query: detail.query, objectIdField: detail.objectIdField,
    geometryType: detail.geometryType, spatialReference: detail.spatialReference, captureSha256: detail.capture.captureSha256 }));
  const samples = $('arcgis-sample-table'); samples.replaceChildren();
  const table = node('table'), head = node('thead'), headings = node('tr'), body = node('tbody');
  for (const field of detail.fields) headings.append(node('th', field.name));
  head.append(headings);
  for (const sample of detail.samples) {
    const tr = node('tr');
    for (const field of detail.fields) {
      const value = sample.attributes[field.name];
      tr.append(node('td', value === null ? 'NULL' : typeof value === 'string' ? value : JSON.stringify(value), { class: 'arcgis-original-value' }));
    }
    body.append(tr);
  }
  table.append(head, body); samples.append(table, node('p', `${detail.samples.length} original samples shown · ${count(detail.sampleTotal)} retained records`, { class: 'muted' }));
  mappingCount();
}
function mappingCount() {
  const all = [...$('arcgis-mapping').rows], rows = all.filter(x => x._mapping.included.checked);
  for (const [index, row] of all.entries()) {
    row._mapping.up.disabled = row._mapping.isId || index < 2;
    row._mapping.down.disabled = row._mapping.isId || index === all.length - 1;
  }
  text('arcgis-mapping-count', `${rows.length} of 64 public columns selected${state.mappingDirty ? ' · unsaved mapping' : ''}.`);
}
function mappingChanged() { state.mappingDirty = true; mappingCount(); }
function mappingInput() {
  const columns = Object.create(null);
  for (const row of $('arcgis-mapping').rows) {
    const { included, publicName, spec } = row._mapping;
    if (!included.checked) continue;
    const name = publicName.value.trim();
    if (!validName(name)) throw new Error('Public names must start with a letter and use up to 48 letters, digits or underscores.');
    if (Object.hasOwn(columns, name)) throw new Error('Each public column needs a distinct name: ' + name);
    columns[name] = spec;
  }
  if (Object.keys(columns).length > 64) throw new Error('Choose at most 64 public columns.');
  if (Object.values(columns)[0]?.field !== state.capture.objectIdField) throw new Error('Keep the original object ID as the first public column.');
  if (!validName($('arcgis-query').value.trim())) throw new Error('Choose a valid public query name.');
  return columns;
}
async function loadEdition(id) {
  const value = await api('edition?' + new URLSearchParams({ id }));
  state.editionId = id; state.edition = value; save();
  $('arcgis-edition-detail').hidden = false;
  text('arcgis-edition-name', value.edition.title);
  text('arcgis-edition-binding', `Source ${value.edition.sourceHash} · capture ${value.edition.captureId}`);
  text('arcgis-edition-source', pretty(value.source)); renderStatus();
}
async function loadDeployment(id) {
  const value = await api('deployment?' + new URLSearchParams({ id }));
  const changed = state.deploymentId !== id || !state.deployment;
  state.deploymentId = id; state.deployment = value; save();
  $('arcgis-deployment-detail').hidden = false;
  text('arcgis-deployment-title', value.deployment.label);
  text('arcgis-deployment-binding', `Run ${value.deployment.run} · ${words(value.deployment.state)}`);
  text('arcgis-deployment-inspection', pretty({ inspection: value.inspection, release: value.deployment.release }));
  if (changed) {
    $('arcgis-release-id').value = value.deployment.releaseId ?? '';
    $('arcgis-release-label').value = value.deployment.label;
    $('arcgis-console-link').hidden = true; $('arcgis-console-link').removeAttribute('href');
  }
  $('arcgis-stage-form').hidden = Boolean(value.deployment.releaseId);
  text('arcgis-release-state', value.deployment.releaseId ? `Staged release ${value.deployment.releaseId}. Open its original release controls to select and start the seller.` : 'Ready to stage in the host’s release store.');
  const downloads = $('arcgis-downloads'); downloads.replaceChildren();
  for (const file of value.downloads) {
    const url = new URL(file.url, location.origin);
    if (url.origin !== location.origin || url.pathname !== PREFIX + 'download' || url.searchParams.get('deploymentId') !== id) continue;
    const item = node('div');
    item.append(node('a', file.label || file.name, { href: url.href, download: file.name }),
      node('span', `${size(file.bytes)} · SHA-256 ${file.sha256}`, { class: 'mono muted' })); downloads.append(item);
  }
  renderStatus();
}
function renderUploads() {
  const key = JSON.stringify(state.status.uploads);
  if (state.listKeys.uploads === key) return;
  state.listKeys.uploads = key;
  const area = $('arcgis-uploads'); area.replaceChildren();
  if (!state.status.uploads.length) area.append(node('p', 'No retained ingress copies.', { class: 'muted' }));
  for (const upload of state.status.uploads) {
    const item = node('div', '', { class: 'arcgis-operation' });
    item.append(node('strong', upload.name), node('span', `${size(upload.bytes)} · ${upload.sha256}`, { class: 'mono muted' }),
      button('Remove ingress copy', async () => {
        if (!window.confirm(`Remove the retained ingress copy of ${upload.name}? Any completed capture or exported deployment keeps its own original files.`)) return;
        await submit('remove-upload', { uploadId: upload.id, expectedSha256: upload.sha256 }, 'Remove upload ' + upload.name);
      }, { 'data-arcgis-operation': '' })); area.append(item);
  }
}
function renderRequests() {
  const area = $('arcgis-requests'); area.replaceChildren();
  if (!state.requests.length) area.append(node('p', 'No operations submitted from this browser session.', { class: 'muted' }));
  for (const record of [...state.requests].reverse()) {
    const item = node('div', '', { class: 'arcgis-operation' });
    item.append(node('strong', record.label + ' · ' + words(record.state)), node('span', record.id, { class: 'mono muted' }));
    if (record.error) item.append(node('p', record.error, { class: 'error' }));
    const detail = node('details'); detail.append(node('summary', 'Exact submitted input'), node('pre', pretty(record.input))); item.append(detail);
    if (record.state !== 'SUCCEEDED') {
      const actions = node('div', '', { class: 'actions' });
      actions.append(button('Check original request', async () => { await check(record, true); await refresh(); }, { 'data-arcgis-read': '' }));
      if (RETRYABLE.has(record.state) && !record.conflict) actions.append(button('Retry same request', async () => {
        let file;
        if (record.route === 'uploads') {
          file = state.files.get(record.id);
          if (!file) throw new Error('Reselect this same original file in the source or seller form, then submit that form to reuse its upload request.');
        }
        state.interactive.add(record.id); await dispatch(record, file); await refresh();
      }, { 'data-arcgis-operation': '' }));
      item.append(actions);
    }
    area.append(item);
  }
  controls();
}
function modeChanged() {
  const files = $('arcgis-mode').value === 'files';
  $('arcgis-file-input').hidden = !files;
  for (const label of document.querySelectorAll('[data-arcgis-live]')) {
    label.hidden = files; for (const input of label.querySelectorAll('input')) input.disabled = files;
  }
  for (const input of $('arcgis-file-input').querySelectorAll('input,select')) input.disabled = !files;
  $('arcgis-metadata').required = files; $('arcgis-pages').required = files && !state.pages.length;
}
function fileList(kind) {
  const area = $(kind === 'pages' ? 'arcgis-page-files' : 'arcgis-geometry-files'); area.replaceChildren();
  for (const [index, file] of state[kind].entries()) {
    const item = node('li'); item.append(node('span', `${file.name} · ${size(file.size)}`));
    for (const [label, delta] of [['Up', -1], ['Down', 1]]) {
      const value = button(label, async () => {
        const other = index + delta; [state[kind][index], state[kind][other]] = [state[kind][other], state[kind][index]]; fileList(kind);
      }, { 'aria-label': `${label}: ${file.name}` });
      value.disabled = index + delta < 0 || index + delta >= state[kind].length; item.append(value);
    }
    item.append(button('Remove', async () => { state[kind].splice(index, 1); fileList(kind); modeChanged(); })); area.append(item);
  }
}
function integer(id, factor = 1) {
  const value = Number($(id).value) * factor;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Review the capture limits before continuing.');
  return value;
}

$('arcgis-mode').addEventListener('change', modeChanged);
for (const [id, kind] of [['arcgis-pages', 'pages'], ['arcgis-geometry-pages', 'geometryPages']]) $(id).addEventListener('change', () => {
  state[kind] = [...$(id).files]; fileList(kind); modeChanged();
});
$('arcgis-capture-form').addEventListener('submit', event => {
  event.preventDefault(); perform(async () => {
    const mode = $('arcgis-mode').value;
    const query = { where: $('arcgis-where').value.trim() };
    if ($('arcgis-fields').value.trim()) query.outFields = $('arcgis-fields').value.split(',').map(x => x.trim()).filter(Boolean);
    if ($('arcgis-geometry').value !== 'auto') query.returnGeometry = $('arcgis-geometry').value === 'yes';
    const connection = { layerUrl: $('arcgis-layer').value.trim(), query,
      maxRows: integer('arcgis-max-rows'), maxSourceBytes: integer('arcgis-source-mib', 1048576) };
    const input = { title: $('arcgis-title').value.trim(), mode, connection };
    if (mode === 'live') {
      Object.assign(connection, { pageSize: integer('arcgis-page-size'), maxPageBytes: integer('arcgis-page-mib', 1048576), timeoutMs: integer('arcgis-timeout', 1000) });
      if ($('arcgis-token-env').value.trim()) connection.tokenEnv = $('arcgis-token-env').value.trim();
    } else {
      const metadata = $('arcgis-metadata').files[0], pages = [...state.pages], geometry = [...state.geometryPages];
      const representation = $('arcgis-representation').value, geometryField = $('arcgis-geometry-field').value.trim();
      if (!metadata || metadata.size > 2097152 || !pages.length || [...pages, ...geometry].some(x => x.size > 16777216))
        throw new Error('Choose metadata up to 2 MiB and at least one original feature page. Each feature or geometry page may be up to 16 MiB.');
      if (geometry.length && !geometryField) throw new Error('Choose the exact shared attribute field for the geometry join.');
      input.files = { metadata: (await upload(metadata)).id, pages: [], representation };
      for (const file of pages) input.files.pages.push((await upload(file)).id);
      if (geometry.length) {
        input.files.geometryPages = []; input.files.geometryField = geometryField;
        for (const file of geometry) input.files.geometryPages.push((await upload(file)).id);
      }
    }
    await submit('captures', input, 'Prepare capture ' + input.title); text('arcgis-upload-progress', 'Original inputs retained.');
  });
});
$('arcgis-continue').addEventListener('click', () => perform(async () => {
  const input = { captureId: state.captureId };
  if ($('arcgis-continue-pages').value !== '') {
    if (!$('arcgis-continue-pages').reportValidity()) return;
    input.maxPages = integer('arcgis-continue-pages');
  }
  await submit('continue', input, 'Continue capture ' + state.capture.capture.title);
}));
$('arcgis-pause').addEventListener('click', () => perform(async () => {
  await submit('pause', { captureId: state.captureId }, 'Pause capture');
}));
$('arcgis-reload-capture').addEventListener('click', () => perform(() => loadCapture(state.captureId, true)));
$('arcgis-reset-mapping').addEventListener('click', () => perform(async () => {
  if (!state.mappingDirty || window.confirm('Restore the native mapping for this capture?')) renderMapping();
}));
for (const id of ['arcgis-edition-title', 'arcgis-query']) $(id).addEventListener('input', mappingChanged);
$('arcgis-mapping-form').addEventListener('submit', event => {
  event.preventDefault(); perform(async () => {
    await submit('editions', { title: $('arcgis-edition-title').value.trim(), captureId: state.captureId,
      expectedCaptureSha256: state.capture.capture.captureSha256, query: $('arcgis-query').value.trim(), columns: mappingInput() },
    'Save source edition ' + $('arcgis-edition-title').value.trim());
  });
});
$('arcgis-select-edition').addEventListener('click', () => perform(async () => {
  await submit('select', { editionId: state.editionId, expectedRevision: state.status.revision }, 'Select source edition ' + state.edition.edition.title);
}));
$('arcgis-deployment-form').addEventListener('submit', event => {
  event.preventDefault(); perform(async () => {
    const run = host.context().detail?.run;
    if (run?.state !== 'PUBLISHED') throw new Error('Select an already published extraction.');
    const input = { run: run.id, label: $('arcgis-deployment-label').value.trim() };
    input.sellerUploadId = (await upload($('arcgis-seller').files[0])).id;
    await submit('deployments', input, 'Prepare deployment ' + input.label); text('arcgis-upload-progress', '');
  });
});
$('arcgis-stage-form').addEventListener('submit', event => {
  event.preventDefault(); perform(async () => {
    await submit('stage', { deploymentId: state.deploymentId, releaseId: $('arcgis-release-id').value.trim(),
      label: $('arcgis-release-label').value.trim(), runtime: { port: 0 } }, 'Stage release ' + $('arcgis-release-id').value.trim());
  });
});
$('arcgis-open-console').addEventListener('click', () => perform(async () => { await submit('release-console', {}, 'Open original release controls'); }));
window.addEventListener('publisher:change', controls);
window.addEventListener('pagehide', () => { state.closed = true; clearTimeout(state.timer); });
window.addEventListener('pageshow', event => { if (event.persisted) { state.closed = false; poll(); } });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !state.closed) { clearTimeout(state.timer); state.timer = setTimeout(poll, 0); }
});
modeChanged(); controls();
try {
  await refresh(); renderRequests();
  for (const [id, load] of [[state.captureId, id => loadCapture(id, false)], [state.editionId, loadEdition], [state.deploymentId, loadDeployment]]) {
    if (!id) continue;
    try { await load(id); } catch (error) { host.notice(message(error)); }
  }
} catch (error) { host.notice(message(error)); }
state.timer = setTimeout(poll, 1500);
