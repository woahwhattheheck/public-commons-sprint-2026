// SPDX-License-Identifier: MIT
// Original QGIS analyst workspace. Every mutation retains its original request.
import {renderParcels, acceptParcelResult, acceptParcelCaptureResult} from './parcels.js';
const $ = (selector, root = document) => root.querySelector(selector);
const clone = value => structuredClone(value);
const clean = value => value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const id = prefix => prefix + '-' + crypto.randomUUID();
const compact = value => typeof value === 'string' && value.length > 22 ? value.slice(0, 10) + '…' + value.slice(-8) : clean(value);
const pretty = value => JSON.stringify(value, null, 2);
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
let state, connection, capabilities = {}, draft = {}, storageKey = '', selectedOperation = null;
let renderEpoch = 0, pollTimer, sourcePage = 0, assetPage = 0, historyPage = 0, operationPage = 0;
let sourceRows, assetRows, comparison, fieldReview, nativeInspection, mapView, featureView;
let currentTab = 'sources', sourceId = '', selectedScene = '', uploadRunning = false, uploadStopRequested = false;
const consumedResults = new Set();
const AUTH = 'X-Starforge-Qgis-Workspace';
let token = /^#[a-f0-9]{64}$/.test(location.hash) ? location.hash.slice(1) : sessionStorage.getItem('qgis-token:' + location.origin);
if (/^#[a-f0-9]{64}$/.test(location.hash)) {
  sessionStorage.setItem('qgis-token:' + location.origin, token);
  history.replaceState(null, '', location.pathname + location.search);
}
function element(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (value !== undefined && value !== null && value !== false) {
      if (key in node && !key.startsWith('aria-') && !key.startsWith('data-')) node[key] = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
function button(text, fn, options = {}) {
  return element('button', {type: 'button', ...options, onclick: async event => {
    const target = event.currentTarget;
    target.disabled = true;
    try { await fn(event); } catch (error) { notice(error.message, true); }
    finally { if (target.isConnected) target.disabled = !!options.disabled; }
  }}, text);
}
function link(text, href, download) { return element('a', {href, ...(download ? {download} : {})}, text); }
function panel(title, ...body) { return element('section', {class: 'panel'}, element('h2', {}, title), ...body); }
function detail(title, value, open = false) { return element('details', {open}, element('summary', {}, title), element('pre', {}, pretty(value))); }
function note(text) { return element('p', {class: 'muted'}, text); }
function actions(...items) { return element('div', {class: 'actions'}, ...items); }
function label(text, input, hint) {
  const title = element('span', {id: id('field-label')}, text);
  input.setAttribute('aria-labelledby', title.id);
  const help = hint ? element('small', {id: id('field-hint')}, hint) : null;
  if (help) input.setAttribute('aria-describedby', help.id);
  return element('label', {class: 'field'}, title, input, help);
}
function inputValue(value, oninput, options = {}) {
  return element('input', {type: 'text', value: value ?? '', ...options, oninput: event => oninput(event.target.type === 'checkbox' ? event.target.checked : event.target.value)});
}
function selectValue(value, choices, onchange) {
  const node = element('select', {onchange: event => onchange(event.target.value)});
  for (const choice of choices) {
    const [key, title] = Array.isArray(choice) ? choice : [choice, choice];
    node.append(element('option', {value: key, selected: String(key) === String(value)}, title));
  }
  if (value !== '' && value !== null && value !== undefined && ![...node.options].some(option => option.value === String(value))) {
    node.prepend(element('option', {value, selected: true}, 'Retained value: ' + String(value)));
  }
  return node;
}
function textArea(value, oninput, options = {}) {
  return element('textarea', {value: value ?? '', rows: 4, spellcheck: false, ...options, oninput: event => oninput(event.target.value)});
}
function saveDraft() {
  try { localStorage.setItem(storageKey, JSON.stringify(draft)); }
  catch { notice('Browser draft storage is full. Export the draft file; saved workspace requests remain available in History.', true); }
}
function setDraft(key, value) { draft[key] = value; saveDraft(); }
function draftInput(name, title, options = {}) { return label(title, inputValue(draft[name] ?? '', value => setDraft(name, value), options)); }
function draftText(name, title, hint) { return label(title, textArea(draft[name] ?? '', value => setDraft(name, value)), hint); }
function jsonDownload(name, value) {
  const url = URL.createObjectURL(new Blob([pretty(value) + '\n'], {type: 'application/json'}));
  const a = link(name, url, name); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function notice(message, error = false) {
  const node = $('#notice'); node.replaceChildren(element('strong', {}, error ? 'Action needs attention. ' : ''), String(message));
  node.className = error ? 'notice error' : 'notice'; node.hidden = false;
}
function table(columns, rows, empty = 'No saved rows.') {
  return element('div', {class: 'table-wrap'}, element('table', {},
    element('thead', {}, element('tr', {}, columns.map(([name]) => element('th', {scope: 'col'}, name)))),
    element('tbody', {}, rows.length ? rows.map(row => element('tr', {}, columns.map(([, cell]) => element('td', {}, cell(row))))) :
      element('tr', {}, element('td', {colSpan: columns.length, class: 'empty'}, empty)))));
}
function pager(page, update) {
  return actions(
    button('Previous', () => update(Math.max(0, page.offset - page.limit)), {disabled: page.offset === 0}),
    element('span', {class: 'count'}, page.total ? (page.offset + 1) + '–' + (page.offset + page.items.length) + ' of ' + page.total : '0 rows'),
    button('Next', () => update(page.offset + page.limit), {disabled: page.complete ?? !page.hasMore}));
}
function sourceChoices() { return (state?.sources ?? []).map(row => [row.id, (row.title || row.source?.title || row.sourceKind || 'Source') + ' · ' + compact(row.id)]); }
function projectChoices() { return (state?.projects ?? []).map(row => [row.id, row.id + ' · revision ' + row.inputRevision + (row.kind === 'field' ? ' · accepted field map' : '')]); }
function requireValue(value, message) { if (!value) throw new Error(message); return value; }
function parsed(text, labelText) { try { return JSON.parse(text); } catch { throw new Error(labelText + ' must be valid JSON.'); } }
async function request(path, options = {}) {
  const response = await fetch(path, {cache: 'no-store', credentials: 'same-origin', ...options,
    headers: {[AUTH]: token || '', ...(options.body && !(options.body instanceof ArrayBuffer) && !ArrayBuffer.isView(options.body) ? {'Content-Type': 'application/json'} : {}), ...options.headers}});
  const value = await response.json().catch(() => ({message: 'The original listener returned an unreadable response.'}));
  if (!response.ok) {
    const error = new Error(value.message || value.error || 'The original operation could not be read.');
    error.code = value.error; error.status = response.status; error.details = value.details;
    throw error;
  }
  return value;
}
async function refreshState({render: redraw = true} = {}) {
  const current = await request('/api/state');
  state = current.state; capabilities = current.capabilities; connection = current;
  if (!sourceId || !state.sources.some(row => row.id === sourceId)) sourceId = state.activeSourceId || state.sources.at(-1)?.id || '';
  if (draft.layers === undefined) {
    draft.layers = clone(state.layers); draft.layersBaseline = clone(state.layers); draft.layersRevision = state.revision; saveDraft();
  } else if (draft.layersRevision !== state.revision && draft.layersBaseline &&
      JSON.stringify(draft.layersBaseline) === JSON.stringify(state.layers)) {
    // Source imports, saved maps and native checks may advance history without changing this layer selection.
    draft.layersRevision = state.revision; saveDraft();
  }
  $('#workspace-title').textContent = state.title || 'QGIS analyst workspace';
  $('#workspace-identity').textContent = state.id + ' · revision ' + state.revision;
  $('#runtime-state').textContent = capabilities.nativeRuntimeSelected ? 'Native QGIS selected' : 'Select native QGIS in Applications to open maps';
  $('#workspace-directory').textContent = current.directory;
  if (redraw) await render();
}
async function recoverSubmitted(entry) {
  try { return await request('/api/operations/' + encodeURIComponent(entry.body.requestId)); }
  catch (error) {
    if (error.status !== 404 && error.code !== 'ANALYST_REQUEST_NOT_FOUND') throw error;
    return request('/api/operations', {method: 'POST', body: JSON.stringify(entry.body)});
  }
}
async function run(action, payload, {revision = state.revision} = {}) {
  const actor = requireValue(String(draft.actor || '').trim(), 'Enter the responsible analyst in the workspace header.');
  const body = {requestId: id('analyst'), action, payload: clone(payload), revision, actor};
  draft.pending ||= {};
  draft.pending[body.requestId] = {body, createdAt: new Date().toISOString()};
  saveDraft();
  let operation;
  try { operation = await request('/api/operations', {method: 'POST', body: JSON.stringify(body)}); }
  catch (error) {
    notice('Saved request ' + body.requestId + '. ' + error.message + ' Use Recover saved request to reconcile this exact input.', true);
    renderOperation();
    throw error;
  }
  await selectOperation(operation);
  return operation;
}
async function selectOperation(operation) {
  selectedOperation = operation; setDraft('selectedRequestId', operation.requestId);
  await acceptResult(operation);
  renderOperation();
  clearTimeout(pollTimer);
  if (operation.displayStatus === 'RUNNING' || operation.status === 'RUNNING' && operation.workerActive) {
    pollTimer = setTimeout(async () => {
      try { await selectOperation(await request('/api/operations/' + encodeURIComponent(operation.requestId))); }
      catch (error) { notice(error.message + ' The original request remains saved.', true); }
    }, 1200);
  }
}
async function acceptResult(operation) {
  if (operation.status !== 'COMPLETED' || consumedResults.has(operation.requestId)) return;
  consumedResults.add(operation.requestId);
  delete draft.pending?.[operation.requestId]; saveDraft();
  const action = operation.input.action, payload = operation.input.payload, result = operation.result;
  if (action === 'source.inspect') { draft.inspectedSource = {result, payload}; saveDraft(); }
  if (action === 'map.inspect') nativeInspection = result;
  if (action === 'postgis.select') {
    if (draft.layers.some(row => row.id === result.id))
      notice('This original database relation is already in the layer draft. Use Later edition to change its accepted source.');
    else { draft.layers.push(clone(result)); saveDraft(); currentTab = 'layers'; }
  }
  if (action === 'map.render') mapView = {operation, result};
  if (action === 'map.features') featureView = {operation, result};
  if (['layers.save', 'postgis.layers'].includes(action) && JSON.stringify(draft.layers) === JSON.stringify(payload.layers)) {
    draft.layers = undefined; saveDraft();
  }
  if (action === 'field.command') {
    if (payload.action === 'field.inventory') { draft.fieldInventory = {result, directory: result.directory || payload.payload.directory}; draft.fieldReturnDirectory = draft.fieldInventory.directory; saveDraft(); }
    if (payload.action === 'field.review') fieldReview = {result, ...payload.payload};
    if (payload.action === 'field.inspect') draft.fieldInspection = result;
  }
  if (action === 'parcel.capture') {
    draft.parcels ||= {};
    acceptParcelCaptureResult(draft.parcels, payload, result);
    saveDraft();
  }
  if (action === 'parcel.command') {
    draft.parcels ||= {};
    acceptParcelResult(draft.parcels, payload, result);
    if (payload.action === 'map.publish') {
      draft.layers ||= clone(state.layers);
      if (!draft.layers.some(row => row.id === result.layer.id)) draft.layers.push(clone(result.layer));
      currentTab = 'layers'; draft.tab = currentTab;
    }
    saveDraft();
  }
  if (action === 'project.receive') { draft.receivedProject = result; saveDraft(); }
  await refreshState({render: false});
  await render();
}
function renderOperation() {
  const host = $('#operation');
  const op = selectedOperation;
  const pending = Object.values(draft.pending || {});
  const body = [];
  if (op) {
    const status = op.displayStatus || op.status;
    body.push(element('h2', {}, 'Current operation'), element('p', {}, element('strong', {}, status), ' · ', op.input.action, ' · ', op.requestId));
    if (op.progress) body.push(detail('Original progress', op.progress, status === 'RUNNING'));
    if (op.error) body.push(detail('Original error and details', op.error, true));
    if (op.runtimeSelectionChanged) body.push(note('This request retains another selected native runtime. Reopen its original runtime or review a new action in the current environment.'));
    if (op.originalHostInput) body.push(note('This received request retains an input path on its original host. Locate the intended source on this host and review a new action.'));
    body.push(actions(
      button('Refresh request', async () => selectOperation(await request('/api/operations/' + encodeURIComponent(op.requestId)))),
      button('Continue same request', async () => selectOperation(await request('/api/operations/' + encodeURIComponent(op.requestId) + '/continue',
        {method: 'POST', body: JSON.stringify({inputSha256: op.inputSha256})})), {disabled: !op.canResume || status === 'RUNNING'}),
      button('Download request', () => jsonDownload(op.requestId + '.json', op))));
    if (op.status === 'COMPLETED') {
      if (op.input.action === 'project.export') body.push(link('Download complete project archive', '/download/operations/' + op.requestId + '/project'));
      if (op.files?.length) body.push(element('ul', {}, op.files.map((file, index) => element('li', {},
        link(file.path.split('/').at(-1) + ' · ' + file.bytes + ' bytes', '/download/operations/' + op.requestId + '/files/' + index), ' · ', element('code', {}, file.sha256)))));
      body.push(detail('Saved result', op.result));
    }
    body.push(detail('Original reviewed input and attempts', {input: op.input, inputSha256: op.inputSha256, attempts: op.attempts}));
  }
  if (pending.length) body.push(detail('Browser requests awaiting reconciliation', pending.map(row => row.body)), actions(...pending.map(entry =>
    button('Recover ' + compact(entry.body.requestId), async () => selectOperation(await recoverSubmitted(entry))))));
  host.hidden = !body.length; host.replaceChildren(...body);
}
async function render() {
  const epoch = ++renderEpoch, host = $('#content');
  // A reopened form must not accept edits into the previous draft while its
  // current source and saved decision are still being read.
  host.inert = true;
  host.setAttribute('aria-busy', 'true');
  try {
    $('#navigation').replaceChildren(...['sources', 'layers', 'maps', 'editions', 'field', 'parcels', 'transfers', 'history'].map(tab =>
      button(tab[0].toUpperCase() + tab.slice(1), async () => { currentTab = tab; setDraft('tab', tab); await render(); },
        {'aria-current': currentTab === tab ? 'page' : undefined})));
    const result = await ({sources: sourcesPane, layers: layersPane, maps: mapsPane, editions: editionsPane,
      field: fieldPane, parcels: parcelsPane, transfers: transfersPane, history: historyPane})[currentTab]();
    if (epoch === renderEpoch) host.replaceChildren(...(Array.isArray(result) ? result : [result]));
    renderOperation();
  } finally {
    if (epoch === renderEpoch) {
      host.inert = false;
      host.setAttribute('aria-busy', 'false');
    }
  }
}


async function parcelsPane() {
  if (!draft.parcels || typeof draft.parcels !== 'object' || Array.isArray(draft.parcels)) draft.parcels = {};
  return renderParcels({state, draft: draft.parcels, sourceDirectory: draft.sourceDirectory,
    element, button, link, panel, detail, note, actions, label, inputValue, selectValue, textArea,
    table, pager, compact, clean, request, render, save: saveDraft, jsonDownload, requireValue,
    uploadControl, notice, run: (action, payload) => run('parcel.command', {action, payload}),
    runCapture: (action, payload) => run('parcel.capture', {action, payload})});
}

function connectionFields(profile, changed, roles = []) {
  const update = (key, value) => { profile[key] = value; changed(); };
  return element('div', {class: 'fields'},
    label('Accepted profile reference', inputValue(profile.profileId || '', value => update('profileId', value), {readOnly: true})),
    label('Existing local libpq service', inputValue(profile.service || '', value => update('service', value))),
    label('Existing QGIS authentication ID, optional', inputValue(profile.authConfigId || '', value => update('authConfigId', value))),
    label('Existing database role', roles.length
      ? selectValue(profile.role || '', [['', 'Choose an accepted role'], ...roles], value => update('role', value))
      : inputValue(profile.role || '', value => update('role', value))),
    label('Native SSL mode', selectValue(profile.sslMode || 'verify-full',
      ['verify-full', 'verify-ca', 'require', 'prefer', 'allow', 'disable'], value => update('sslMode', value))),
    label('Permit native editing when the accepted role allows it',
      inputValue('', value => update('allowEditing', value), {type: 'checkbox', checked: !!profile.allowEditing})));
}
async function databasePane(selectedSourceId) {
  const rows = await request('/api/database-layers?sourceId=' + selectedSourceId + '&offset=' + sourcePage + '&limit=50');
  draft.postgis ||= {};
  const selected = draft.postgis[selectedSourceId] ||= {connection: {
    schema: 'starforge.postgis-qgis-connection.v1', profileId: rows.database.profileId,
    service: '', authConfigId: '', role: '', sslMode: 'verify-full', allowEditing: false
  }, layers: {}};
  const roles = [...new Set(rows.items.flatMap(row => (row.roles || [])
    .filter(role => role.observedPrivileges?.select).map(role => role.name)))].sort();
  const original = panel('Accepted PostGIS relations',
    detail('Original database receipt and summary', {sourceId: rows.sourceId, database: rows.database, summary: rows.summary}),
    note('Select the existing local service and authentication reference. The original native reader checks the accepted database, columns, role, row counts and row identities before saving or reopening its map.'),
    connectionFields(selected.connection, saveDraft, roles),
    actions(button('Select this page', async () => { rows.items.forEach(row => { selected.layers[row.id] = true; }); saveDraft(); await render(); }),
      button('Clear selected relations', async () => { selected.layers = {}; saveDraft(); await render(); }),
      button('Check selected relations in native PostGIS', () => run('postgis.check', {
        sourceId: selectedSourceId, layerIds: requireValue(Object.keys(selected.layers).filter(key => selected.layers[key]).length &&
          Object.keys(selected.layers).filter(key => selected.layers[key]), 'Select the accepted relations to check.'),
        connection: clone(selected.connection)}), {disabled: !capabilities.nativeRuntimeSelected})),
    table([['Check', row => inputValue('', value => { selected.layers[row.id] = value; saveDraft(); }, {type: 'checkbox', checked: !!selected.layers[row.id]})],
      ['Accepted relation', row => element('span', {}, row.title, ' · ', element('code', {}, row.schema + '.' + row.relation))],
      ['Rows / SRID', row => clean(row.rowCount) + ' / ' + clean(row.srid)],
      ['Original contract', row => detail('Fields, roles and source binding', row)],
      ['Map selection', row => button('Add accepted relation to draft', () => run('postgis.select', {
        sourceId: selectedSourceId, layerId: row.id, connection: clone(selected.connection)}))]], rows.items),
    pager(rows, async offset => { sourcePage = offset; await render(); }));
  return original;
}

async function uploadFiles(kind, selected) {
  requireValue(!uploadRunning, 'Finish or pause the active original upload first.');
  const files = [...selected];
  requireValue(files.length, 'Choose the complete original folder or archive.');
  const entries = files.map(file => {
    let name = kind !== 'project' ? file.webkitRelativePath : file.name;
    if (kind !== 'project') name = name.split('/').slice(1).join('/');
    requireValue(name, 'Choose the original receiving folder with its files.');
    return {file, path: name};
  }).sort((a, b) => a.path.localeCompare(b.path));
  const retained = draft.uploads?.[kind];
  const descriptor = entries.map(({file, path}) => ({path, bytes: file.size,
    sha256: kind === 'project' && draft.archiveSha256 ? draft.archiveSha256.trim() : null}));
  if (retained) requireValue(JSON.stringify(descriptor) === JSON.stringify(retained.files),
    'This selection differs from the retained upload manifest. Re-select its original files, or choose New upload.');
  else {
    draft.uploads ||= {};
    draft.uploads[kind] = {uploadId: id('upload'), kind, files: descriptor};
    saveDraft();
  }
  const manifest = draft.uploads[kind];
  uploadRunning = true; uploadStopRequested = false;
  try {
    await request('/api/uploads', {method: 'POST', body: JSON.stringify(manifest)});
    let processed = 0;
    const total = descriptor.reduce((sum, file) => sum + file.bytes, 0);
    for (const entry of entries) {
      // Recheck prior chunks byte-for-byte on the server before appending after a browser loss.
      for (let offset = 0; offset < entry.file.size; offset += 8 * 1024 * 1024) {
        requireValue(!uploadStopRequested, 'Upload paused after the retained chunk. Re-select the same files to continue the saved upload.');
        const bytes = await entry.file.slice(offset, offset + 8 * 1024 * 1024).arrayBuffer();
        await request('/api/uploads/' + manifest.uploadId + '/file?path=' + encodeURIComponent(entry.path) + '&offset=' + offset,
          {method: 'PUT', body: bytes, headers: {'Content-Type': 'application/octet-stream', 'X-Content-SHA256': await hash(bytes)}});
        processed += bytes.byteLength;
        notice('Original upload ' + manifest.uploadId + ': ' + processed + ' / ' + total + ' bytes verified or transferred · ' + entry.path);
      }
    }
    const completed = await request('/api/uploads/' + manifest.uploadId + '/complete', {method: 'POST', body: '{}'});
    draft.completedUploads ||= {}; draft.completedUploads[kind] = completed;
    if (kind === 'source') draft.sourceDirectory = completed.directory;
    else if (kind === 'field') draft.fieldReturnDirectory = completed.directory;
    else { draft.archivePath = completed.file; draft.archiveSha256 = completed.sha256; }
    saveDraft();
    notice('Complete original upload retained: ' + completed.files.length + ' files. Review the source or receiving archive below.');
    await render();
  } finally { uploadRunning = false; }
}
function uploadControl(kind) {
  let selected = [];
  const picker = element('input', {type: 'file', ...(kind !== 'project' ? {multiple: true, webkitdirectory: true} : {accept: '.zip,application/zip'}),
    onchange: event => { selected = event.target.files; }});
  if (kind !== 'project') picker.setAttribute('webkitdirectory', '');
  const row = draft.uploads?.[kind], complete = draft.completedUploads?.[kind];
  return element('div', {class: 'upload'}, label(kind === 'source' ? 'Complete source folder on this computer' : kind === 'field' ? 'Complete saved QField return folder on this computer' : 'Complete project ZIP on this computer', picker),
    note('Transfers use exact 8 MiB chunks. Re-select the same files to verify previous bytes and continue after a browser or connection loss.'),
    actions(button(row ? 'Resume original upload' : 'Upload original files', () => uploadFiles(kind, selected)),
      button('Pause after current chunk', () => { uploadStopRequested = true; }),
      button('New upload', async () => {
        requireValue(!uploadRunning, 'Pause the current upload first.');
        if (row) { draft.uploadHistory ||= []; draft.uploadHistory.push({manifest: row, completed: complete || null}); }
        delete draft.uploads?.[kind]; delete draft.completedUploads?.[kind]; saveDraft(); await render();
      })),
    row && note('Saved upload: ' + row.uploadId + ' · ' + row.files.length + ' files'),
    complete && detail('Completed original file inventory', complete));
}
function addLayer(row, nativeLayer) {
  const kind = nativeLayer?.kind || row.kindHint;
  requireValue(kind === 'raster' || kind === 'vector', 'Inspect the received file and select an actual raster or vector layer.');
  requireValue(row.file, 'This original asset has no received local file.');
  const definition = {id: id('layer'), sourceId: row.sourceId || sourceId, kind,
    collection: row.collection ?? null, itemId: row.itemId, assetKey: row.assetKey,
    label: row.title || nativeLayer?.name || row.assetKey, visible: true, opacity: 1};
  if (kind === 'vector') definition.vectorLayer = nativeLayer?.sublayer || row.nativeLayer || '';
  draft.layers.push(definition); saveDraft(); currentTab = 'layers'; render();
}
async function sourcesPane() {
  const intake = panel('Receive an original source edition',
    note('Choose a complete STAC, vector or accepted PostGIS receiving directory. Inspection verifies its original manifest and retained assets before import.'),
    draftInput('sourceDirectory', 'Original receiving directory on this host'),
    draftInput('sourceManifestSha256', 'Expected manifest SHA-256, when supplied by the producer'),
    actions(button('Inspect original source', () => run('source.inspect', {
      directory: requireValue(draft.sourceDirectory, 'Choose the original directory.'),
      ...(draft.sourceManifestSha256?.trim() ? {expectedManifestSha256: draft.sourceManifestSha256.trim()} : {})}))),
    uploadControl('source'));
  if (draft.inspectedSource) {
    const {result, payload} = draft.inspectedSource;
    intake.append(panel('Reviewed source', element('p', {}, result.sourceKind, ' · ', result.scenes, ' scenes · ', result.assets, ' assets'),
      element('code', {}, result.sourceId), detail('Original source and summary', result),
      button('Import this exact source', () => run('source.import', {directory: payload.directory, expectedManifestSha256: result.sourceId}))));
  }
  const register = panel('Imported source register',
    table([['Edition', row => element('code', {}, row.id)], ['Original source', row => detail(row.sourceKind || 'Source', row)],
      ['Use', row => button(row.id === state.activeSourceId ? 'Active source' : 'Make active', () => run('source.select', {sourceId: row.id}),
        {disabled: row.id === state.activeSourceId})]], state.sources));
  if (!sourceId) return [intake, register];
  const selected = label('Inspect an imported edition', selectValue(sourceId, sourceChoices(), async value => {
    sourceId = value; sourcePage = assetPage = 0; selectedScene = ''; await render();
  }));
  const originalSource = state.sources.find(row => row.id === sourceId);
  if ((originalSource?.sourceKind || originalSource?.source?.sourceKind) === 'postgis')
    return [intake, register, selected, await databasePane(sourceId)];
  const [scenes, assets] = await Promise.all([
    request('/api/scenes?sourceId=' + sourceId + '&offset=' + sourcePage + '&limit=50'),
    request('/api/assets?sourceId=' + sourceId + '&offset=' + assetPage + '&limit=50' + (selectedScene ? '&sceneKey=' + encodeURIComponent(selectedScene) : ''))]);
  sourceRows = scenes; assetRows = assets;
  const scenePanel = panel('Original scenes', selected,
    scenes.sourceKind === 'stac' && button('Add all scene footprints', () => {
      draft.layers.push({id: id('layer'), sourceId, kind: 'footprints', label: 'Scene footprints', visible: true, opacity: 1, allScenes: true});
      saveDraft(); currentTab = 'layers'; render();
    }),
    table([['Collection / Item', row => element('span', {}, clean(row.collection), ' / ', row.itemId)],
      ['Original time', row => row.datetime || [row.startDatetime, row.endDatetime].filter(Boolean).join(' – ') || '—'],
      ['Assets', row => clean(row.assetCount)], ['Metadata', row => detail('View', row)],
      ['Selection', row => button('Show assets', async () => { selectedScene = row.key; assetPage = 0; await render(); })]], scenes.items),
    pager(scenes, async offset => { sourcePage = offset; await render(); }));
  const assetPanel = panel('Received asset inventory',
    selectedScene && actions(element('code', {}, selectedScene), button('Show all assets', async () => { selectedScene = ''; assetPage = 0; await render(); })),
    table([['Item / asset', row => element('span', {}, row.itemId, ' / ', row.assetKey)],
      ['Original outcome', row => [row.outcome, row.reason].filter(Boolean).join(' · ') || '—'],
      ['Local bytes', row => row.file ? clean(row.file.bytes) : 'Metadata only'],
      ['Asset', row => detail(row.title || 'View', row)],
      ['Native layer', row => actions(button('Inspect in QGIS', () => run('map.inspect', {sourceId, collection: row.collection ?? null, itemId: row.itemId, assetKey: row.assetKey}),
        {disabled: !capabilities.nativeRuntimeSelected || !row.file}),
        button('Add retained ' + (row.kindHint || 'layer'), () => addLayer(row), {disabled: !row.file || !['raster', 'vector'].includes(row.kindHint)}))]], assets.items),
    pager(assets, async offset => { assetPage = offset; await render(); }));
  if (nativeInspection) assetPanel.append(panel('Native asset inspection',
    detail('Original provider result', nativeInspection, true),
    ...(nativeInspection.layers || []).map(layer => actions(
      element('span', {}, layer.name, ' · ', layer.kind, ' · ', layer.provider),
      button('Add this native layer', () => addLayer({...nativeInspection, title: layer.name, kindHint: layer.kind}, layer))))));
  return [intake, register, scenePanel, assetPanel];
}
function layersPane() {
  const changed = JSON.stringify(draft.layers) !== JSON.stringify(state.layers);
  const rows = draft.layers || [];
  const controls = panel('Map layer selection',
    note('The complete layer list retains source edition, native sublayer, filter, styles and order. Native maps are saved as new immutable project editions.'),
    element('p', {}, changed ? 'Unsaved layer draft' : 'Draft matches saved selection', ' · reviewed revision ', draft.layersRevision, ' · current revision ', state.revision),
    actions(button('Save complete layer selection', () => run(rows.some(row => row.postgis) ? 'postgis.layers' : 'layers.save', {layers: rows}, {revision: draft.layersRevision}), {disabled: !changed || rows.some(row => row.postgis) && !capabilities.nativeRuntimeSelected}),
      button('Reload saved selection', async () => { draft.layers = clone(state.layers); draft.layersBaseline = clone(state.layers); draft.layersRevision = state.revision; saveDraft(); await render(); }),
      button('Use current reviewed revision', async () => { draft.layersBaseline = clone(state.layers); draft.layersRevision = state.revision; saveDraft(); await render(); }, {disabled: draft.layersRevision === state.revision}),
      button('Export layer draft', () => jsonDownload('qgis-layer-draft.json', {workspaceId: state.id, revision: draft.layersRevision, layers: rows}))),
    changed && state.revision !== draft.layersRevision && note('The workspace advanced after this draft was opened. Review the current saved selection below, then merge your intended changes into the draft before using its current reviewed revision.'));
  if (draft.layersRevision !== state.revision) controls.append(detail('Current saved layer selection', state.layers, true));
  const entries = rows.map((row, index) => {
    const update = (key, value) => { row[key] = value; saveDraft(); };
    const header = actions(element('strong', {}, (index + 1) + '. ' + row.label), element('code', {}, row.id),
      button('Move up', async () => { [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]]; saveDraft(); await render(); }, {disabled: index === 0}),
      button('Move down', async () => { [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]]; saveDraft(); await render(); }, {disabled: index === rows.length - 1}),
      button('Remove from draft', async () => { rows.splice(index, 1); saveDraft(); await render(); }));
    const fields = [
      label('Label', inputValue(row.label, value => update('label', value))),
      label('Visible', inputValue('', value => update('visible', value), {type: 'checkbox', checked: row.visible})),
      label('Opacity', inputValue(row.opacity, value => update('opacity', Number(value)), {type: 'number', min: 0, max: 1, step: 0.05})),
      element('p', {class: 'break'}, row.kind, ' · source ', element('code', {}, row.sourceId))];
    if (row.kind === 'footprints') {
      fields.push(label('Use every original scene', inputValue('', value => { update('allScenes', value); render(); }, {type: 'checkbox', checked: row.allScenes})));
      if (!row.allScenes) fields.push(label('Original scene keys, one JSON string per line', textArea((row.sceneKeys || []).join('\n'),
        value => update('sceneKeys', value.split('\n').map(x => x.trim()).filter(Boolean))),
      'Use the exact scene key shown in the source inventory. Collection and Item remain separate inside that key.'));
    } else if (row.postgis) {
      fields.push(element('p', {}, 'Accepted database relation: ', element('code', {}, row.postgis.layerId)),
        connectionFields(row.postgis.connection, () => saveDraft()),
        label('Native provider subset expression', textArea(row.vectorSubsetString || '', value => update('vectorSubsetString', value))),
        note('The original accepted database SRID and column contract stay with this relation. The project CRS controls its map display.'));
    } else {
      fields.push(element('p', {}, clean(row.collection), ' / ', row.itemId, ' / ', row.assetKey),
        label('CRS override, only for the selected native asset', inputValue(row.crsOverride || '', value => update('crsOverride', value || null))));
      if (row.kind === 'vector') fields.push(
        label('Exact native sublayer', inputValue(row.vectorLayer || '', value => update('vectorLayer', value))),
        label('Native provider subset expression', textArea(row.vectorSubsetString || '', value => update('vectorSubsetString', value))));
      else {
        const mode = row.bands?.rgb ? 'rgb' : row.bands?.gray ? 'gray' : 'native';
        fields.push(label('Raster display', selectValue(mode, [['native', 'Original native renderer'], ['gray', 'One grayscale band'], ['rgb', 'Three RGB bands']], value => {
          update('bands', value === 'native' ? null : value === 'gray' ? {gray: 1} : {rgb: [1, 2, 3]}); render();
        })));
        if (mode === 'gray') fields.push(label('Original band number', inputValue(row.bands.gray, value => update('bands', {gray: Number(value)}), {type: 'number', min: 1, step: 1})));
        if (mode === 'rgb') ['Red band', 'Green band', 'Blue band'].forEach((name, position) => fields.push(label(name,
          inputValue(row.bands.rgb[position], value => { row.bands.rgb[position] = Number(value); saveDraft(); }, {type: 'number', min: 1, step: 1}))));
      }
    }
    if (row.styleFile) fields.push(detail('Retained native style and dependencies', {style: row.styleFile, files: row.styleDependencies}),
      button('Clear retained style in draft', async () => { row.styleFile = null; row.styleDependencies = []; saveDraft(); await render(); }));
    return element('section', {class: 'layer'}, header, element('div', {class: 'fields'}, ...fields));
  });
  const saveMap = panel('Save a native project',
    draftInput('projectCrs', 'Project CRS, optional', {placeholder: 'Use original project CRS or enter an authority such as EPSG:4326'}),
    button('Save current workspace as a native QGIS map', () => run('map.save', draft.projectCrs?.trim() ? {projectCrs: draft.projectCrs.trim()} : {}),
      {disabled: !capabilities.nativeRuntimeSelected || changed || !state.layers.length}),
    note('Save the layer draft first. The native engine verifies actual received files, selected sublayers, fields, coordinate systems and styles.'));
  return [controls, ...entries, !entries.length && note('Choose received assets or scene footprints in Sources.'), saveMap];
}


function mapsPane() {
  const projectId = draft.mapProjectId && state.projects.some(x => x.id === draft.mapProjectId) ? draft.mapProjectId : state.projects.at(-1)?.id || '';
  if (projectId !== draft.mapProjectId) setDraft('mapProjectId', projectId);
  const selected = state.projects.find(row => row.id === projectId);
  const fields = element('div', {class: 'fields'},
    label('Saved native project', selectValue(projectId, [['', 'Choose a saved map'], ...projectChoices()], value => {
      setDraft('mapProjectId', value); mapView = featureView = undefined; render();
    })),
    draftInput('mapWidth', 'Image width in pixels', {type: 'number', min: 64, max: 4096, placeholder: '1200'}),
    draftInput('mapHeight', 'Image height in pixels', {type: 'number', min: 64, max: 4096, placeholder: '800'}));
  const renderNative = (extent) => run('map.render', {projectId: requireValue(projectId, 'Choose a saved native project.'),
    width: Number(draft.mapWidth || 1200), height: Number(draft.mapHeight || 800), ...(extent ? {extent} : {})});
  const tools = actions(
    button('Reopen and verify native map', () => run('map.reopen', {projectId}), {disabled: !selected || !capabilities.nativeRuntimeSelected}),
    button('Render full map', () => renderNative(), {disabled: !selected || !capabilities.nativeRuntimeSelected}),
    selected && link('Download original QGZ', '/download/projects/' + projectId));
  const parts = [panel('Native map workspace', fields, tools,
    note('Map images and feature rows come from the selected saved QGIS project and its original providers. Each requested view is retained with its exact project, extent, CRS and output file.'),
    selected && detail('Selected original map', selected))];
  if (mapView && mapView.result.projectId === projectId) {
    const view = mapView.result, pngIndex = mapView.operation.files.findIndex(file => file.path === view.file.path);
    const extent = view.extent;
    const move = (dx, dy, scale = 1) => {
      const width = extent[2] - extent[0], height = extent[3] - extent[1];
      const cx = (extent[0] + extent[2]) / 2 + width * dx, cy = (extent[1] + extent[3]) / 2 + height * dy;
      return renderNative([cx - width * scale / 2, cy - height * scale / 2, cx + width * scale / 2, cy + height * scale / 2]);
    };
    const image = element('img', {class: 'native-map', alt: 'Native QGIS map from saved project ' + projectId,
      src: '/download/operations/' + mapView.operation.requestId + '/files/' + pngIndex,
      onclick: event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const dx = (event.clientX - bounds.left) / bounds.width - 0.5;
        const dy = 0.5 - (event.clientY - bounds.top) / bounds.height;
        move(dx, dy).catch(error => notice(error.message, true));
      }});
    parts.push(panel('Retained native view', actions(
      button('Zoom in', () => move(0, 0, 0.5)), button('Zoom out', () => move(0, 0, 2)),
      button('West', () => move(-0.35, 0)), button('North', () => move(0, 0.35)),
      button('South', () => move(0, -0.35)), button('East', () => move(0.35, 0))),
      image, note('Click the image to request a new native view centered at that map location.'),
      element('p', {class: 'break'}, 'Actual visible extent: ', clean(view.extent), ' · ', clean(view.projectCrs?.authid || view.projectCrs)),
      detail('Native view, source readback and original file', view)));
  }
  if (selected) {
    const vectors = selected.layers.filter(row => row.kind === 'vector' || row.kind === 'footprints');
    let layerId = draft.featureLayerId;
    if (!vectors.some(row => row.id === layerId)) layerId = vectors[0]?.id || '';
    if (layerId !== draft.featureLayerId) setDraft('featureLayerId', layerId);
    const inspectFeatures = offset => run('map.features', {projectId, layerId: requireValue(draft.featureLayerId, 'Choose an actual vector layer.'),
      offset, limit: 100, ...(draft.featuresInView && mapView?.result.projectId === projectId ? {extent: mapView.result.extent} : {})});
    const featurePanel = panel('Native feature table',
      label('Saved vector layer', selectValue(layerId, [['', 'Choose a layer'], ...vectors.map(row => [row.id, row.label])], value => {
        setDraft('featureLayerId', value); featureView = undefined; render();
      })),
      label('Use the currently displayed native map extent', inputValue('', value => setDraft('featuresInView', value), {type: 'checkbox', checked: !!draft.featuresInView})),
      button('Read native features', () => inspectFeatures(0), {disabled: !layerId || !capabilities.nativeRuntimeSelected}));
    if (featureView?.result.projectId === projectId && featureView.result.layerId === layerId) {
      const result = featureView.result;
      featurePanel.append(note('Provider feature count: ' + result.nativeFeatureCount + ' · subset: ' + (result.subsetString || '(none)')),
        table([['Feature ID', row => row.featureId], ...result.fields.map((field, index) =>
          [field.name + ' · ' + field.type, row => clean(row.values[index])])], result.rows),
        actions(button('Previous features', () => inspectFeatures(Math.max(0, result.offset - result.limit)), {disabled: result.offset === 0}),
          element('span', {}, result.rows.length ? (result.offset + 1) + '–' + (result.offset + result.rows.length) : 'No features'),
          button('Next features', () => inspectFeatures(result.offset + result.limit), {disabled: !result.hasMore})),
        detail('Original feature page metadata', {...result, rows: undefined}));
    }
    parts.push(featurePanel);
  }
  parts.push(panel('Saved native map editions', table([
    ['Map', row => button(row.id, async () => { setDraft('mapProjectId', row.id); mapView = featureView = undefined; await render(); })],
    ['Recorded', row => row.at], ['Analyst', row => row.actor], ['Input revision', row => clean(row.inputRevision)],
    ['Layers', row => row.layers.length], ['Original file', row => link('QGZ', '/download/projects/' + row.id)]], [...state.projects].reverse())));
  return parts;
}
function localPage(rows, offset, limit = 50) { return {items: rows.slice(offset, offset + limit), offset, limit, total: rows.length, complete: offset + limit >= rows.length}; }
function editionsPane() {
  const left = draft.editionLeft || state.sources[0]?.id || '', right = draft.editionRight || state.sources.at(-1)?.id || '';
  const choices = [['', 'Choose an imported source'], ...sourceChoices()];
  const header = panel('Review a later source edition',
    note('Compare original scene/asset or accepted database relation identities before changing any map layer. Every layer on the earlier edition needs an explicit keep, update or remove decision.'),
    element('div', {class: 'fields'},
      label('Earlier edition', selectValue(left, choices, value => { setDraft('editionLeft', value); comparison = undefined; render(); })),
      label('Later edition', selectValue(right, choices, value => { setDraft('editionRight', value); comparison = undefined; render(); }))),
    button('Compare original editions', async () => {
      requireValue(left && right && left !== right, 'Choose two different imported source editions.');
      const revision = state.revision;
      const result = await request('/api/compare?left=' + left + '&right=' + right);
      comparison = {result, left, right, revision, sceneOffset: 0, assetOffset: 0};
      await render();
    }));
  const parts = [header];
  if (comparison) {
    const result = comparison.result;
    parts.push(panel('Original comparison', detail('Summary and source identity', {...result, scenes: undefined, assets: undefined}, true)));
    for (const [name, key] of [['Scenes', 'scenes'], ['Assets', 'assets']]) {
      const offsetKey = key === 'scenes' ? 'sceneOffset' : 'assetOffset', rows = localPage(result[key] || [], comparison[offsetKey]);
      parts.push(panel(name, table([['Identity', row => element('code', {}, row.key)],
        ['Change', row => row.status], ['Original details', row => detail('View', row)]], rows.items),
        pager(rows, async offset => { comparison[offsetKey] = offset; await render(); })));
    }
    if (result.databaseLayers) parts.push(panel('Accepted database relation changes',
      table([['Relation', row => element('code', {}, row.id)], ['Change', row => row.status],
        ['Original column and row contract', row => detail('View accepted relation', row)]], result.databaseLayers)));
    const affected = state.layers.filter(row => row.sourceId === comparison.left);
    const draftKey = comparison.left + '/' + comparison.right;
    draft.editionDecisions ||= {}; draft.editionDecisions[draftKey] ||= {};
    const decisions = draft.editionDecisions[draftKey];
    parts.push(panel('Map layer decisions',
      note('Updating changed native bytes clears the old style, band selection and CRS override. Review the actual successor sublayer and filter before saving its next map.'),
      table([['Current layer', row => row.label], ['Decision', row => selectValue(decisions[row.id]?.decision || '',
        [['', 'Choose a decision'], ['keep', 'Keep earlier edition'], ['update', 'Use later edition'], ['remove', 'Remove layer']],
        value => { decisions[row.id] = {...decisions[row.id], decision: value}; saveDraft(); })],
      ['Successor sublayer', row => row.kind === 'vector' && !row.postgis ? inputValue(decisions[row.id]?.vectorLayer ?? row.vectorLayer ?? '', value => {
        decisions[row.id] = {...decisions[row.id], vectorLayer: value}; saveDraft();
      }) : '—'],
      ['Successor filter', row => row.kind === 'vector' && !row.postgis ? textArea(decisions[row.id]?.vectorSubsetString ?? '', value => {
        decisions[row.id] = {...decisions[row.id], vectorSubsetString: value}; saveDraft();
      }, {rows: 2}) : '—'],
      ['Successor database connection', row => {
        if (!row.postgis) return '—';
        if (!decisions[row.id]?.connection) {
          decisions[row.id] = {...decisions[row.id], connection: clone(row.postgis.connection)};
          saveDraft();
        }
        return element('details', {}, element('summary', {}, 'Retain or change the local connection reference'),
          connectionFields(decisions[row.id].connection, saveDraft));
      }]], affected, 'No current layers use this earlier edition. The reviewed edition can still become active.'),
      draftText('editionNote', 'Reason for the edition decisions'),
      button('Retain complete edition review', () => {
        requireValue(affected.every(row => ['keep', 'update', 'remove'].includes(decisions[row.id]?.decision)), 'Choose a decision for every affected layer.');
        const rows = affected.map(row => ({layerId: row.id, ...decisions[row.id],
          ...(row.kind === 'vector' && !row.postgis && decisions[row.id].decision === 'update' && decisions[row.id].vectorLayer === undefined ? {vectorLayer: row.vectorLayer || ''} : {})}));
        return run('edition.review', {leftSourceId: comparison.left, rightSourceId: comparison.right,
          decisions: rows, note: requireValue(draft.editionNote?.trim(), 'Record the review reason.')}, {revision: comparison.revision});
      })));
  }
  parts.push(panel('Saved edition reviews', table([['Review', row => row.id], ['Recorded', row => row.at],
    ['Analyst / reason', row => row.actor + ' · ' + row.note], ['Original decision', row => detail('Open review', row)]], [...state.reviews].reverse())));
  return parts;
}

function scalarValue(text) {
  const value = parsed(text, 'The choice value');
  requireValue(['string', 'boolean', 'number'].includes(typeof value) &&
    (typeof value !== 'number' || Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))),
    'Use a JSON string, boolean, or finite number. Keep large exact identifiers as strings.');
  return value;
}
function scalarChoiceInput(choice) {
  const node = element('input', {type: 'text', value: choice.editorValueText ?? JSON.stringify(choice.value)});
  const validate = () => {
    try {
      const value = scalarValue(node.value);
      choice.value = value; delete choice.editorValueText; node.setCustomValidity('');
    } catch (error) {
      choice.editorValueText = node.value; node.setCustomValidity(error.message);
    }
  };
  validate();
  node.addEventListener('input', () => { validate(); saveDraft(); });
  return node;
}
function reviewedCommission(config) {
  const selected = clone(config);
  for (const layer of selected.layers || []) for (const field of layer.fields || []) for (const choice of field.choices || []) {
    if (choice.editorValueText !== undefined) choice.value = scalarValue(choice.editorValueText);
    delete choice.editorValueText;
  }
  const invalid = $('#content').querySelector('input:invalid,select:invalid,textarea:invalid');
  if (invalid) { invalid.reportValidity(); throw new Error('Complete the highlighted original form value.'); }
  return selected;
}

function fieldRun(action, payload, options) { return run('field.command', {action, payload}, options); }
function commissioningDraft() {
  if (!draft.commission) {
    draft.commission = {title: '', projectId: state.projects.at(-1)?.id || '', instructions: '', attachmentInstructions: '',
      profiles: [{id: 'field-device', label: 'Field device', platform: '', operatorInstructions: ''}],
      layers: [], referenceLayerIds: [], relations: []};
    draft.commissionRevision = state.revision; saveDraft();
  }
  return draft.commission;
}
function commissionPane() {
  const config = commissioningDraft(), project = state.projects.find(row => row.id === config.projectId);
  const originalLayers = project?.layers || [], choices = originalLayers.map(row => [row.id, row.label]);
  const put = (key, value) => { config[key] = value; saveDraft(); };
  const top = panel('Commission a saved map for field collection',
    note('Configure the actual saved native layers and forms. Original QGIS and QFieldSync create and synchronize the device project. Stable feature keys, complete relation pairs and saved attachment files travel with that project.'),
    element('div', {class: 'fields'},
      label('Field project title', inputValue(config.title, value => put('title', value))),
      label('Saved native project', selectValue(config.projectId, [['', 'Choose a native map'], ...projectChoices()], value => { put('projectId', value); render(); }))),
    label('Field instructions', textArea(config.instructions, value => put('instructions', value))),
    label('Attachment instructions', textArea(config.attachmentInstructions, value => put('attachmentInstructions', value))),
    actions(button('Inspect actual native layers and relations', () => fieldRun('field.inspect', {projectId: config.projectId}),
      {disabled: !project || !capabilities.nativeRuntimeSelected}),
      button('Export commissioning draft', () => jsonDownload('qfield-commissioning.json', config))),
    draft.fieldInspection && detail('Actual field inspection', draft.fieldInspection, true));
  const profiles = panel('Device profiles', ...config.profiles.map((profile, index) => element('div', {class: 'subpanel'},
    element('div', {class: 'fields'}, ...[['id', 'Profile ID'], ['label', 'Device name'], ['platform', 'Platform']].map(([key, name]) =>
      label(name, inputValue(profile[key], value => { profile[key] = value; saveDraft(); })))),
    label('Operator instructions', textArea(profile.operatorInstructions, value => { profile.operatorInstructions = value; saveDraft(); })),
    button('Remove profile', async () => { config.profiles.splice(index, 1); saveDraft(); await render(); }, {disabled: config.profiles.length === 1}))),
    button('Add device profile', async () => { config.profiles.push({id: id('device'), label: '', platform: '', operatorInstructions: ''}); saveDraft(); await render(); }));
  const editable = panel('Editable native layers', ...config.layers.map((layer, index) => {
    const set = (key, value) => { layer[key] = value; saveDraft(); };
    const fields = layer.fields || (layer.fields = []);
    const body = element('div', {class: 'subpanel'},
      element('div', {class: 'fields'},
        label('Native layer', selectValue(layer.layerId, [['', 'Choose a native layer'], ...choices], value => set('layerId', value))),
        label('Read-only stable feature identity field', inputValue(layer.identityField, value => set('identityField', value))),
        label('Form title', inputValue(layer.formTitle, value => set('formTitle', value)))),
      label('Editable field names, one per line', textArea((layer.editableFields || []).join('\n'),
        value => set('editableFields', value.split('\n').map(x => x.trim()).filter(Boolean)))),
      actions(...[['allowAdd', 'Allow new features'], ['allowDelete', 'Allow feature deletion'], ['allowGeometry', 'Allow geometry editing']].map(([key, title]) =>
        label(title, inputValue('', value => set(key, value), {type: 'checkbox', checked: layer[key]})))),
      ...fields.map((field, fieldIndex) => {
        const update = (key, value) => { if (value === undefined) delete field[key]; else field[key] = value; saveDraft(); };
        const node = element('div', {class: 'form-field'},
          element('div', {class: 'fields'},
            label('Original or new field name', inputValue(field.name, value => update('name', value))),
            label('Form label', inputValue(field.label, value => update('label', value))),
            label('Form group', inputValue(field.group || 'Details', value => update('group', value))),
            label('Widget', selectValue(field.widget || 'text', ['text', 'multiline', 'choice', 'range', 'date', 'attachment', 'image'], value => {
              update('widget', value);
              if (value === 'choice' && !field.choices) field.choices = [];
              if (value === 'range') { field.min ??= 0; field.max ??= 100; field.step ??= 1; }
              saveDraft(); render();
            })),
            label('New field type, when adding a field', selectValue(field.addType || '', [['', 'Existing native field'], 'text', 'integer', 'real', 'date', 'datetime', 'boolean'],
              value => update('addType', value || undefined))),
            label('Required', inputValue('', value => update('required', value), {type: 'checkbox', checked: !!field.required}))));
        if (field.widget === 'choice') {
          const values = field.choices || [];
          node.append(...values.map((choice, choiceIndex) => element('div', {class: 'fields'},
            label('Choice label', inputValue(choice.label, value => { choice.label = value; saveDraft(); })),
            label('Exact scalar value (JSON)', scalarChoiceInput(choice)),
            button('Remove choice', async () => { values.splice(choiceIndex, 1); saveDraft(); await render(); }))),
            button('Add choice', async () => { values.push({label: '', value: ''}); field.choices = values; saveDraft(); await render(); }));
        }
        if (field.widget === 'range') node.append(element('div', {class: 'fields'}, ...['min', 'max', 'step'].map(key =>
          label(key, inputValue(field[key], value => update(key, Number(value)), {type: 'number', step: 'any'})))));
        node.append(button('Remove form field', async () => { fields.splice(fieldIndex, 1); saveDraft(); await render(); }));
        return node;
      }),
      actions(button('Add form field', async () => { fields.push({name: '', label: '', group: 'Details', widget: 'text', required: false}); saveDraft(); await render(); }),
        button('Remove editable layer', async () => { config.layers.splice(index, 1); saveDraft(); await render(); })));
    return body;
  }),
  button('Add editable layer', async () => {
    config.layers.push({layerId: '', identityField: '', editableFields: [], allowAdd: false, allowDelete: false, allowGeometry: false, formTitle: '', fields: []});
    saveDraft(); await render();
  }));
  const references = panel('Read-only reference layers', ...originalLayers.map(layer => label(layer.label,
    inputValue('', value => {
      config.referenceLayerIds = value ? [...new Set([...config.referenceLayerIds, layer.id])] : config.referenceLayerIds.filter(x => x !== layer.id);
      saveDraft();
    }, {type: 'checkbox', checked: config.referenceLayerIds.includes(layer.id)}))));
  const relations = panel('Native parent and child relations',
    note('Retain every field pair of each original compound relation. A relation imported from native inspection retains its original strength.'),
    ...config.relations.map((relation, index) => element('div', {class: 'subpanel'},
      element('div', {class: 'fields'},
        ...[['id', 'Relation ID'], ['name', 'Relation name']].map(([key, title]) => label(title, inputValue(relation[key], value => { relation[key] = value; saveDraft(); }))),
        ...[['parentLayerId', 'Parent layer'], ['childLayerId', 'Child layer']].map(([key, title]) => label(title,
          selectValue(relation[key], [['', 'Choose a layer'], ...choices], value => { relation[key] = value; saveDraft(); })))),
      ...relation.fieldPairs.map((pair, pairIndex) => element('div', {class: 'fields'},
        label('Parent field', inputValue(pair.parentField, value => { pair.parentField = value; saveDraft(); })),
        label('Child field', inputValue(pair.childField, value => { pair.childField = value; saveDraft(); })),
        button('Remove field pair', async () => { relation.fieldPairs.splice(pairIndex, 1); saveDraft(); await render(); }, {disabled: relation.fieldPairs.length === 1}))),
      actions(button('Add field pair', async () => { relation.fieldPairs.push({parentField: '', childField: ''}); saveDraft(); await render(); }),
        button('Remove relation', async () => { config.relations.splice(index, 1); saveDraft(); await render(); })),
      label('Native relation strength', selectValue(relation.strength || 'association', ['association', 'composition'], value => { relation.strength = value; saveDraft(); })))),
    button('Add relation', async () => {
      config.relations.push({id: id('relation'), name: '', parentLayerId: '', childLayerId: '', fieldPairs: [{parentField: '', childField: ''}]});
      saveDraft(); await render();
    }));
  const raw = textArea(draft.commissionJson || '', value => setDraft('commissionJson', value), {rows: 10});
  const complete = panel('Review and commission', detail('Complete commissioning draft', config),
    element('details', {}, element('summary', {}, 'Import a complete native commissioning definition'),
      label('Original configuration JSON', raw),
      button('Load configuration into this draft', async () => {
        const selected = parsed(draft.commissionJson, 'Commissioning definition');
        requireValue(selected && typeof selected === 'object' && Array.isArray(selected.profiles) && Array.isArray(selected.layers) && Array.isArray(selected.relations || []),
          'Use the complete original field configuration.');
        selected.relations ||= []; selected.referenceLayerIds ||= [];
        draft.commission = selected; draft.commissionRevision = state.revision; saveDraft(); await render();
      })),
    element('p', {}, 'Draft revision ', draft.commissionRevision, ' · current revision ', state.revision),
    actions(button('Use current reviewed revision', () => { draft.commissionRevision = state.revision; saveDraft(); render(); }),
      button('Commission with original QGIS / QFieldSync', () => fieldRun('field.commission', {configuration: reviewedCommission(config)}, {revision: draft.commissionRevision}),
        {disabled: !project || !capabilities.nativeRuntimeSelected})));
  return [top, profiles, editable, references, relations, complete];
}
function fieldPane() {
  if (!capabilities.field) return panel('Field collection', note('Install the cumulative original QField source to commission and receive field projects.'));
  const campaigns = state.fieldCampaigns || [];
  const result = [panel('Field collection and office receiving', note('Commission a saved native map, export one current field round, collect in QField, then receive its complete saved device folder. Review original changes before synchronization into a new office map.'),
    actions(button(draft.showCommission ? 'Close commissioning draft' : 'Open commissioning draft', async () => {
      setDraft('showCommission', !draft.showCommission); await render();
    })))];
  if (draft.showCommission) result.push(...commissionPane());
  if (!campaigns.length) { result.push(note('No commissioned field projects yet.')); return result; }
  let campaign = campaigns.find(x => x.id === draft.fieldCampaignId) || campaigns.at(-1);
  if (campaign.id !== draft.fieldCampaignId) setDraft('fieldCampaignId', campaign.id);
  const profileId = draft.fieldProfileId && campaign.configuration.profiles.some(x => x.id === draft.fieldProfileId) ? draft.fieldProfileId : campaign.configuration.profiles[0]?.id;
  const activeRound = campaign.rounds.find(x => ['exported', 'returned'].includes(x.status));
  result.push(panel('Current field project',
    label('Commissioned project', selectValue(campaign.id, campaigns.map(x => [x.id, x.title]), value => {
      setDraft('fieldCampaignId', value); setDraft('fieldRoundId', ''); fieldReview = undefined; render();
    })),
    detail('Commissioning, office edition and instructions', campaign.configuration),
    note('Current office edition: ' + campaign.currentEdition.sha256),
    label('Device profile for the next round', selectValue(profileId, campaign.configuration.profiles.map(x => [x.id, x.label]), value => { setDraft('fieldProfileId', value); render(); })),
    button('Export next original field round', () => fieldRun('field.export', {campaignId: campaign.id, profileId}),
      {disabled: !!activeRound || !capabilities.nativeRuntimeSelected}),
    draftText('campaignNote', 'Project note'),
    button('Retain project note', () => fieldRun('field.note', {campaignId: campaign.id, note: requireValue(draft.campaignNote?.trim(), 'Enter the project note.')}))));
  const round = campaign.rounds.find(x => x.id === draft.fieldRoundId) || activeRound || campaign.rounds.at(-1);
  if (!round) return result;
  if (round.id !== draft.fieldRoundId) setDraft('fieldRoundId', round.id);
  result.push(panel('Field round and device package',
    label('Original field round', selectValue(round.id, campaign.rounds.map(x => [x.id, 'Round ' + x.number + ' · ' + x.status + ' · ' + x.profile.label]), value => {
      setDraft('fieldRoundId', value); setDraft('fieldReturnId', ''); fieldReview = undefined; render();
    })),
    element('p', {}, 'Status: ', element('strong', {}, round.status), ' · base office edition ', element('code', {}, round.baseEditionSha256)),
    detail('Original export and binding', round),
    link('Download complete device package', '/download/field/' + round.id),
    note('Extract the complete ZIP into a separate device folder, open its original QField project, and close the application after saving before returning that whole folder.'),
    draftInput('fieldCopyDirectory', 'New device copy directory on this host'),
    button('Make exact device copy', () => fieldRun('field.copy', {roundId: round.id, destination: draft.fieldCopyDirectory}),
      {disabled: !['exported', 'returned'].includes(round.status)})));
  result.push(panel('Receive a complete saved device return',
    uploadControl('field'), draftInput('fieldReturnDirectory', 'Saved device-return directory on this host'),
    button('Inventory saved return', () => fieldRun('field.inventory', {directory: requireValue(draft.fieldReturnDirectory, 'Choose the complete saved device folder.')})),
    draft.fieldInventory && detail('Actual selected return inventory', draft.fieldInventory.result),
    button('Receive selected return into this round', () => {
      const inventory = requireValue(draft.fieldInventory, 'Inventory the saved return first.');
      requireValue(inventory.directory === draft.fieldReturnDirectory, 'Inventory this selected directory before receiving.');
      return fieldRun('field.receive', {roundId: round.id, directory: inventory.directory, expectedFilesSha256: inventory.result.filesSha256});
    }, {disabled: !['exported', 'returned'].includes(round.status) || !capabilities.nativeRuntimeSelected})));
  const returned = round.returns.find(x => x.id === draft.fieldReturnId) || round.returns.at(-1);
  if (returned) {
    if (returned.id !== draft.fieldReturnId) setDraft('fieldReturnId', returned.id);
    const readPage = offset => fieldRun('field.review', {roundId: round.id, returnId: returned.id, offset, limit: 100,
      ...(draft.fieldReviewLayer ? {layerId: draft.fieldReviewLayer} : {}), ...(draft.fieldReviewKind ? {kind: draft.fieldReviewKind} : {})});
    const review = panel('Office review of the original return',
      label('Retained return', selectValue(returned.id, round.returns.map(x => [x.id, x.id + ' · ' + x.at]), value => {
        setDraft('fieldReturnId', value); fieldReview = undefined; render();
      })),
      detail('Original summary and readiness', {summary: returned.summary, ready: returned.ready, review: returned.review}, true),
      element('div', {class: 'fields'},
        label('Change kind', selectValue(draft.fieldReviewKind || '', [['', 'All changes'], 'added', 'changed', 'deleted', 'attachment', 'issue', 'problems'], value => setDraft('fieldReviewKind', value))),
        draftInput('fieldReviewLayer', 'Original layer ID filter, optional')),
      button('Read reviewed changes', () => readPage(0)));
    const selectedReview = fieldReview?.roundId === round.id && fieldReview?.returnId === returned.id ? fieldReview.result : null;
    if (selectedReview) review.append(
      table([['Original change', row => detail(clean(row.layerId || row.layer_id || row.kind || 'Change'), row, true)]], selectedReview.items),
      pager({...selectedReview, complete: !selectedReview.hasMore}, readPage));
    review.append(draftText('fieldAcceptNote', 'Office acceptance note'),
      button('Accept this reviewed return and create the next office map', () => {
        requireValue(selectedReview?.reviewSha256 === returned.review.sha256, 'Read the retained return review before acceptance.');
        return fieldRun('field.accept', {roundId: round.id, returnId: returned.id, reviewSha256: selectedReview.reviewSha256,
          note: requireValue(draft.fieldAcceptNote?.trim(), 'Record the office acceptance note.')});
      }, {disabled: round.status !== 'returned' || !returned.ready || !selectedReview || !capabilities.nativeRuntimeSelected}));
    result.push(review);
  }
  result.push(panel('Close this field round',
    draftText('fieldCloseNote', 'Reason for closing this round without acceptance'),
    button('Close original field round', () => fieldRun('field.close', {roundId: round.id,
      note: requireValue(draft.fieldCloseNote?.trim(), 'Record why the field round is being closed.')}),
    {disabled: !['exported', 'returned'].includes(round.status)})));
  return result;
}


function transfersPane() {
  const exported = selectedOperation?.status === 'COMPLETED' && selectedOperation.input.action === 'project.export' ? selectedOperation : null;
  const receiving = draft.receivedProject;
  const parts = [
    panel('Complete project handover',
      note('Export the original SQLite snapshot, source manifests and retained assets, native maps and styles, field campaigns and returns, analyst requests and result files, and complete receiving software.'),
      draftInput('exportDirectory', 'New archive directory on this host', {placeholder: 'Default: a deliveries directory beside this workspace'}),
      button('Export complete original project', () => run('project.export', draft.exportDirectory?.trim() ? {directory: draft.exportDirectory.trim()} : {})),
      exported && link('Download complete project ZIP', '/download/operations/' + exported.requestId + '/project'),
      exported && detail('Original complete archive identity', exported.result, true)),
    panel('Independent project receiving',
      note('Select the entire original project ZIP and a new receiving directory. The original codec verifies every declared file and reopens the same project identity, history and native source references.'),
      draftInput('archiveSha256', 'Expected complete archive SHA-256'),
      uploadControl('project'),
      draftInput('archivePath', 'Original complete archive on this host'),
      draftInput('receiveDirectory', 'New independent receiving directory on this host'),
      button('Receive complete original project', () => run('project.receive', {
        file: requireValue(draft.archivePath?.trim(), 'Choose the original complete archive.'),
        destination: requireValue(draft.receiveDirectory?.trim(), 'Choose a new receiving directory.'),
        expectedSha256: requireValue(draft.archiveSha256?.trim(), 'Retain the original complete archive SHA-256.')})),
      receiving && panel('Received project',
        element('p', {}, 'Project ', element('code', {}, receiving.state.id), ' · revision ', receiving.state.revision),
        element('p', {class: 'break'}, 'Receiving directory: ', receiving.directory),
        note('Open this received directory as a separate QGIS analyst application using its existing Python and native runtime. This listener remains bound to the original project.'),
        detail('Original receiving receipt', receiving.receipt, true))),
    panel('Operator draft and original history',
      actions(link('Download complete saved history', '/download/history'),
        button('Download browser draft', () => jsonDownload('qgis-analyst-draft.json', {schema: 'starforge.stac-qgis-analyst-draft.v1', workspaceId: state.id, draft}))),
      note('Browser drafts contain unsaved form choices and original request IDs. The saved project journal retains submitted requests, domain history and completed outputs. Import actual sources or receive field returns before exporting their project file closure.'))
  ];
  const picker = element('input', {type: 'file', accept: '.json,application/json', onchange: async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      requireValue(file.size <= 32 * 1024 * 1024, 'Choose a browser draft of at most 32 MiB.');
      const value = JSON.parse(await file.text());
      requireValue(value.schema === 'starforge.stac-qgis-analyst-draft.v1' && value.workspaceId === state.id &&
        value.draft && typeof value.draft === 'object' && !Array.isArray(value.draft), 'Choose a saved draft for this exact project.');
      draft = value.draft; saveDraft(); notice('Saved browser draft reopened for the original project.'); await render();
    } catch (error) { notice(error.message, true); }
  }});
  parts.at(-1).append(label('Reopen an exported browser draft for this project', picker));
  return parts;
}
async function historyPane() {
  const [events, operations] = await Promise.all([
    request('/api/history?offset=' + historyPage + '&limit=50'),
    request('/api/operations?offset=' + operationPage + '&limit=50')]);
  return [
    panel('Original project history', table([
      ['Revision', row => clean(row.revision)], ['Original action', row => row.action], ['Recorded', row => row.at],
      ['Analyst', row => row.actor], ['Original event', row => detail('View event', row)]], events.items),
      pager(events, async offset => { historyPage = offset; await render(); })),
    panel('Saved analyst operations', note('Select an original request to view its complete input, progress, attempts and result, or continue that same request after an interruption.'),
      table([['Action', row => button(row.action, async () => selectOperation(await request('/api/operations/' + encodeURIComponent(row.requestId))))],
        ['Request', row => element('code', {}, row.requestId)], ['Status', row => row.status],
        ['Reviewed revision', row => clean(row.inputRevision)], ['Analyst', row => row.actor],
        ['Attempts', row => clean(row.attempts)]], operations.items),
      pager(operations, async offset => { operationPage = offset; await render(); })),
    panel('Open an original request by ID', draftInput('requestLookup', 'Saved request ID'),
      button('Open original request', async () => selectOperation(await request('/api/operations/' + encodeURIComponent(requireValue(draft.requestLookup?.trim(), 'Enter the saved request ID.'))))))
  ];
}
async function initialize() {
  requireValue(token && /^[a-f0-9]{64}$/.test(token), 'Open this workspace from its original Applications connection URL.');
  const launch = await request('/api/launch');
  requireValue(launch.schema === 'starforge.stac-qgis-analyst-startup.v1' && launch.status === 'QGIS_ANALYST_READY',
    'The original analyst listener did not return its startup identity.');
  storageKey = 'starforge-qgis-analyst:' + launch.workspaceId;
  try { draft = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { draft = {}; }
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) draft = {};
  currentTab = ['sources', 'layers', 'maps', 'editions', 'field', 'parcels', 'transfers', 'history'].includes(draft.tab) ? draft.tab : 'sources';
  $('#actor-control').replaceChildren(label('Responsible analyst', inputValue(draft.actor || '', value => setDraft('actor', value), {autocomplete: 'name'})));
  $('#global-actions').replaceChildren(button('Refresh saved workspace', () => refreshState()),
    button('Export browser draft', () => jsonDownload('qgis-analyst-draft.json', {schema: 'starforge.stac-qgis-analyst-draft.v1', workspaceId: state.id, draft})));
  await refreshState();
  if (draft.selectedRequestId) {
    try { await selectOperation(await request('/api/operations/' + encodeURIComponent(draft.selectedRequestId))); }
    catch (error) { notice(error.message + ' Original requests remain available in History.', true); }
  }
}
initialize().catch(error => {
  notice(error.message, true);
  $('#content').replaceChildren(panel('Open the original analyst workspace',
    note('Use the Open action on its saved Applications entry. The private connection belongs to that exact running project.')));
});
