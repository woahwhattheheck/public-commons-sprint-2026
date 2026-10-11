import { renderComparison } from './comparison-view.mjs';

const $ = id => document.getElementById(id);
const token = location.hash.slice(1);
let current = null, selectedRun = null, releaseReview = null, sourceReview = null, comparisonView = null, busy = false, activeTab = 'sources';
const make = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
const pretty = value => JSON.stringify(value, null, 2);
const note = (message, error = false) => { $('notice').textContent = message; $('notice').classList.toggle('error', error); };
const operator = () => { const name = $('operator').value.trim(); if (!name) throw new Error('Enter your operator name before saving a change.'); sessionStorage.setItem('migration-operator', name); return name; };
const utc = value => value ? new Date(value + (value.endsWith('Z') ? '' : 'Z')).toISOString() : null;
const projectId = () => { if (!current) throw new Error('Open a migration project first.'); return current.project.id; };
const input = extra => ({ projectId: projectId(), expectedRevision: current.project.revision, actor: operator(), requestId: 'ui-' + crypto.randomUUID(), ...extra });
const fields = form => Object.fromEntries(new FormData(form));
const parse = (text, label) => { try { return JSON.parse(text); } catch { throw new Error(label + ' must be valid JSON.'); } };
const button = (label, work, cls) => { const e = make('button', label, cls); e.type = 'button'; e.addEventListener('click', () => act(work)); return e; };
const actions = (...elements) => { const e = make('div', undefined, 'actions'); e.append(...elements); return e; };
const badge = value => make('span', value ?? '—', 'status');
const pre = value => make('pre', typeof value === 'string' ? value : pretty(value));
const empty = message => make('p', message, 'empty');
function table(headers, rows) {
  if (!rows.length) return empty('No records yet.');
  const wrap = make('div', undefined, 'table-wrap'), t = make('table'), head = make('thead'), tr = make('tr'), body = make('tbody');
  for (const name of headers) tr.append(make('th', name));
  head.append(tr); t.append(head, body);
  for (const row of rows) { const r = make('tr'); for (const value of row) { const cell = make('td'); cell.append(value instanceof Node ? value : document.createTextNode(value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value))); r.append(cell); } body.append(r); }
  wrap.append(t); return wrap;
}
function selectOptions(element, entries, preferred) {
  const selected = preferred ?? element.value; element.replaceChildren();
  element.append(new Option('Choose…', ''));
  for (const [value, label] of entries) element.append(new Option(label, value));
  if (entries.some(row => row[0] === selected)) element.value = selected;
}
async function api(path, body) {
  const response = await fetch('/api/migrations/' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-workspace-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Workspace request failed.');
  return value;
}
async function originalFileText(file) {
  if (!(file instanceof File) || !file.size) throw new Error('Select the original source or response file.');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); }
  catch { throw new Error(file.name + ' must contain valid UTF-8 text.'); }
}
async function importArchive(name, file) {
  if (!(file instanceof File) || !file.size || file.size > 32 * 1024 * 1024)
    throw new Error('Select a complete migration handover up to 32 MiB.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  const expectedSha256 = [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
  const response = await fetch('/api/migrations/handover/import-file?name=' + encodeURIComponent(name) +
    '&sha256=' + expectedSha256, { method: 'POST', headers: { 'x-workspace-token': token, 'content-type': 'application/gzip' }, body: file });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Handover import failed.');
  return value;
}
async function download(path, name) {
  const response = await fetch('/api/migrations/' + path, { headers: { 'x-workspace-token': token } });
  if (!response.ok) { const value = await response.json(); throw new Error(value.error ?? 'Download failed.'); }
  const object = URL.createObjectURL(await response.blob()), a = make('a'); a.href = object; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(object), 10000);
}
async function act(work) {
  if (busy) return;
  busy = true; const controls = [...document.querySelectorAll('button,input,select,textarea')], previous = controls.map(e => e.disabled);
  controls.forEach(e => { e.disabled = true; }); document.body.classList.add('loading');
  try { await work(); }
  catch (error) { note(error.message, true); }
  finally { controls.forEach((e, i) => { if (e.isConnected) e.disabled = previous[i]; }); busy = false; document.body.classList.remove('loading'); updateReviewButtons(); }
}
function showTab(name) {
  activeTab = name; document.querySelectorAll('[data-panel]').forEach(e => { e.hidden = e.dataset.panel !== name; });
  document.querySelectorAll('[data-tab]').forEach(e => e.setAttribute('aria-selected', String(e.dataset.tab === name)));
}
function query(extra = '') { return 'project=' + encodeURIComponent(projectId()) + extra; }
async function refreshProjects() {
  const value = await api('list'), list = $('project-list'); list.replaceChildren();
  for (const project of value.projects) {
    const control = button(project.title ?? project.id, () => openProject(project.id), 'project-button');
    control.append(make('small', project.error ?? (project.customer || project.id)));
    control.setAttribute('aria-current', String(current?.project.id === project.id)); list.append(control);
  }
  if (!value.projects.length) list.append(empty('Create the first migration.'));
  const received = $('received-workspaces'); received.replaceChildren();
  for (const workspace of value.receivedWorkspaces ?? []) {
    const control = button(workspace.name, async () => {
      const opened = await api('handover/open', { name: workspace.name }); location.assign(opened.url);
    }, 'project-button');
    control.append(make('small', workspace.projectId + ' · ' + workspace.importedAt)); received.append(control);
  }
  if (!received.childElementCount) received.append(empty('Imported handovers appear here.'));
  return value;
}
async function openProject(id) {
  current = await api('project?project=' + encodeURIComponent(id));
  selectedRun = null; releaseReview = null; sourceReview = null;
  comparisonView?.dispose(); comparisonView = null;
  $('empty').hidden = true; $('project').hidden = false; $('history').hidden = true;
  sessionStorage.setItem('migration-project', id);
  resetMapping(); render(); await refreshProjects(); await renderInventory();
  note('Opened ' + current.project.title + ', edition ' + current.project.sequence + '.');
}
async function refreshProject() {
  if (!current) return;
  const id = current.project.id; const value = await api('project?project=' + encodeURIComponent(id));
  if (current?.project.id !== id) return;
  current = value; render();
}
function render() {
  const p = current.project, state = p.state;
  $('project-title').textContent = p.title; $('project-meta').textContent = (p.customer ? p.customer + ' · ' : '') + 'Edition ' + p.sequence + ' · ' + p.at + ' · ' + p.actor;
  $('merchant-link').href = '/#' + token; $('merchant-setup-link').href = '/#' + token;
  $('source-list').replaceChildren(table(['Source', 'Purpose', 'Original bytes', 'Actions'], state.sources.map(source => {
    const label = make('div'); label.append(make('div', source.name, 'source-name'), make('div', source.sha256, 'mono'));
    if (state.currentSource === source.ref) label.append(badge('Current provider source'));
    const buttons = [button('Download', () => download('source-download?' + query('&ref=' + source.ref), source.name), 'small-button')];
    if (source.kind.includes('openapi')) buttons.push(button('Inspect', () => inspectSource(source.ref), 'small-button'), button('Use in merchant setup', () => { location.href = '/?migration=' + encodeURIComponent(p.id) + '&source=' + source.ref + '#' + token; }, 'small-button'));
    return [label, source.kind, source.bytes.toLocaleString(), actions(...buttons)];
  })));
  renderAcquisitions(); renderMappingList(); renderComparisons(); renderReleases(); renderReceiver();
  const packageRows = current.packages.map(value => [value.name, value.name + ' · ' + (value.title ?? '')]);
  selectOptions($('baseline-package'), packageRows, state.merchant.baseline ?? undefined);
  selectOptions($('stage-package'), packageRows, state.merchant.package?.name ?? undefined);
  const sourceOptions = current.acquisitions.map(row => ['acquisition:' + row.id, row.id + ' · ' + (row.manifest?.state ?? 'Unavailable')]);
  for (const row of state.sources.filter(row => row.kind === 'legacy-response')) sourceOptions.push(['source:' + row.ref, 'Imported file · ' + row.name]);
  selectOptions($('mapping-baseline'), sourceOptions); selectOptions($('mapping-candidate'), sourceOptions);
  selectOptions($('capture-run'), current.acquisitions.map(row => [row.id, row.id]));
  $('handover-summary').replaceChildren(table(['Retained scope', 'Count or current selection'], [
    ['Source files', state.sources.length], ['Acquisitions', state.acquisitions.length], ['Saved mappings', Object.keys(state.mappings).length],
    ['Result comparisons', Object.keys(state.comparisons).length], ['Merchant package', state.merchant.package?.name ?? 'Choose or export a merchant package']]));
  $('handover-list').replaceChildren(table(['Handover', 'Created', 'Receiving team', 'Archive bytes', 'Actions'],
    (current.handovers ?? []).map(row => [row.id, row.createdAt, row.receiver, row.archive?.bytes?.toLocaleString(),
      row.problem ? make('span', row.problem) : button('Download handover', () => download(
        'handover-download?' + query('&name=' + encodeURIComponent(row.id)), row.filename), 'small-button')])));
  updateReviewButtons(); showTab(activeTab);
}
function renderReceiver() {
  const state = current.receiver ?? { open: false }, target = $('receiver-state');
  target.replaceChildren(badge(state.open ? 'Receiving workspace open' : 'Receiving workspace closed'));
  if (state.open && state.url) {
    const link = make('a', 'Open the original receiving application'); link.href = state.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    target.append(actions(link));
  }
  target.append(make('p', 'Closing the view retains its saved runs. Reopen it to continue an existing operation.', 'hint'));
}
async function inspectSource(ref) {
  const value = await api('source-inspect?' + query('&ref=' + ref));
  const operations = value.operations ?? [];
  $('source-inspection').replaceChildren(make('h3', (value.title ?? 'API description') + ' · ' + operations.length + ' operations'),
    table(['Method', 'Path', 'Summary', 'Authentication'], operations.map(row => [row.method, row.path, row.summary ?? row.operationId ?? '', row.authentication ?? row.security ?? 'See original source'])));
  note('Loaded the original provider contract.');
}
async function renderInventory() {
  const value = await api('inventory?' + query());
  $('inventory').replaceChildren(table(['Feature', 'Family', 'Legacy request', 'Request ID'], value.requests.map(row => [row.feature, row.family, row.method + ' ' + row.path, row.id])));
}
function renderAcquisitions() {
  $('acquisition-list').replaceChildren(table(['Acquisition', 'State', 'Coverage', 'Actions'], current.acquisitions.map(row => {
    const m = row.manifest;
    const coverage = m?.coverage ? pretty(m.coverage) : row.problem ?? 'No retained result';
    return [row.id, badge(row.running ? 'RUNNING' : m?.state ?? 'UNAVAILABLE'), coverage, actions(
      button('Open', () => openAcquisition(row.id), 'small-button'),
      button('Run / resume', async () => { await api('acquisition/run', { projectId: projectId(), id: row.id }); selectedRun = row.id; await refreshProject(); note('Acquiring ' + row.id + '.'); }, 'small-button'),
      button('Pause', async () => { await api('acquisition/pause', { projectId: projectId(), id: row.id }); await refreshProject(); note('Acquisition paused with its existing captures retained.'); }, 'small-button'))];
  })));
}
async function openAcquisition(id) {
  selectedRun = id; const value = await api('acquisition?' + query('&run=' + encodeURIComponent(id)));
  const m = value.manifest, detail = $('acquisition-detail'); detail.replaceChildren(make('h3', id), badge(m.state), pre({ request: m.request, source: m.source, coverage: m.coverage, problem: m.problem }));
  detail.append(table(['Capture', 'HTTP status', 'Bytes', 'Captured at', 'Original response'], (m.captures ?? []).map(capture => [
    capture.id, capture.status, capture.bytes, capture.capturedAt,
    button('Download', () => download('capture?' + query('&run=' + encodeURIComponent(id) + '&capture=' + encodeURIComponent(capture.id)), id + '-' + capture.id + '.json'), 'small-button')])));
  if (m.captures?.length) {
    try {
      const data = await api('rows?' + query('&run=' + encodeURIComponent(id))); const rows = data.rows ?? [];
      detail.append(make('h4', data.kind === 'timeseries' ? 'Series and original point schema' : 'Retained data'));
      if (rows.length) { const keys = [...new Set(rows.flatMap(row => Object.keys(row ?? {})))].slice(0, 12); detail.append(make('p', 'Showing ' + Math.min(rows.length, 100) + ' of ' + rows.length + ' retained rows.', 'subtle'), table(keys, rows.slice(0, 100).map(row => keys.map(key => row[key])))); }
      else detail.append(pre({ kind: data.kind, pointSchema: data.pointSchema, series: data.series, metadata: data.metadata, coverage: data.coverage, complete: data.complete }));
    } catch (error) { detail.append(make('p', error.message)); }
  }
}
function requestPath() {
  const form = $('acquisition-form'), f = fields(form), g = encodeURIComponent(f.granularity), entity = encodeURIComponent(f.entity.trim());
  const paths = { catalog: '/query/tabular/catalog', 'series-catalog': '/query/timeseries/catalog', assets: '/query/tabular/assets', blockchains: '/query/tabular/blockchains',
    'stablecoin-products': '/query/tabular/stablecoin-products', 'asset-price': '/query/timeseries/asset-price/' + g + (entity ? '/' + entity : ''),
    'network-series': '/query/timeseries/blockchains/' + g + (entity ? '/' + entity : ''), 'stablecoin-series': '/query/timeseries/stablecoins-by-product/' + g + (entity ? '/' + entity : '') };
  $('request-path').value = paths[f.model];
}
function newDefinition() { return { schemaVersion: 'blockworks-mapping/v1', id: '', keys: [], measures: [], decisions: [] }; }
function resetMapping() { $('mapping-id').value = ''; $('mapping-definition').value = pretty(newDefinition()); $('mapping-review').replaceChildren(); renderMappingFields(); }
function definition() { const value = parse($('mapping-definition').value, 'Mapping definition'); value.id = $('mapping-id').value.trim(); return value; }
function updateDefinition(value) { $('mapping-definition').value = pretty(value); renderMappingFields(); }
function cellInput(value, update, options) {
  const element = options ? make('select') : make('input'); if (options) for (const choice of options) element.append(new Option(choice || 'Unspecified', choice));
  element.value = value ?? ''; element.addEventListener('change', () => { try { update(element.value); } catch (error) { note(error.message, true); } }); return element;
}
function renderMappingFields() {
  let value; try { value = parse($('mapping-definition').value, 'Mapping definition'); } catch { return; }
  const root = $('mapping-fields'); root.replaceChildren();
  function change(collection, index, callback) { const next = definition(); callback(next[collection][index]); updateDefinition(next); }
  function pathCell(collection, i, side) { return cellInput(pretty(value[collection][i][side]?.path ?? []), text => change(collection, i, row => { row[side] ??= { from: 'row' }; row[side].path = parse(text, 'Selector path'); })); }
  function sourceSelector(collection, i, side) {
    const selected = value[collection][i][side] ?? {};
    const from = cellInput(selected.from ?? 'row', text => change(collection, i, row => { row[side].from = text; }), ['row', 'entity', 'point']);
    const result = actions(from, pathCell(collection, i, side));
    if (selected.from === 'point') {
      const descriptor = cellInput(selected.descriptorKey ?? 'field', text => change(collection, i, row => { row[side].descriptorKey = text; }), ['field', 'slug']);
      descriptor.setAttribute('aria-label', side + ' point descriptor field');
      result.append(make('span', 'Descriptor name', 'hint'), descriptor);
    }
    return result;
  }
  if (value.keys?.length) root.append(make('h4', 'Entity, dimension and time keys'), table(['Key', 'Meaning', 'Baseline from / path', 'Candidate from / path', 'Time formats', ''], value.keys.map((row, i) => [
    cellInput(row.id, text => change('keys', i, key => { key.id = text; })), cellInput(row.semantic, text => change('keys', i, key => { key.semantic = text; })),
    sourceSelector('keys', i, 'baseline'),
    sourceSelector('keys', i, 'candidate'),
    actions(cellInput(row.baseline?.timeFormat, text => change('keys', i, key => { if (text) key.baseline.timeFormat = text; else delete key.baseline.timeFormat; }), ['', 'unix-s', 'unix-ms', 'rfc3339']),
      cellInput(row.candidate?.timeFormat, text => change('keys', i, key => { if (text) key.candidate.timeFormat = text; else delete key.candidate.timeFormat; }), ['', 'unix-s', 'unix-ms', 'rfc3339'])),
    button('Remove', async () => { const next = definition(); next.keys.splice(i, 1); updateDefinition(next); }, 'small-button')])));
  if (value.measures?.length) root.append(make('h4', 'Measures and agreed tolerances'), table(['Measure', 'Interpretation', 'Baseline selector / unit', 'Candidate selector / unit', 'Factor / offset', 'Absolute / relative tolerance', ''], value.measures.map((row, i) => [
    cellInput(row.id, text => change('measures', i, measure => { measure.id = text; })),
    cellInput(row.interpretation ?? '', text => change('measures', i, measure => { measure.interpretation = text; }), ['', 'numeric', 'scalar']),
    actions(sourceSelector('measures', i, 'baseline'), cellInput(row.baseline?.unit, text => change('measures', i, measure => { measure.baseline.unit = text || null; }))),
    actions(sourceSelector('measures', i, 'candidate'), cellInput(row.candidate?.unit, text => change('measures', i, measure => { measure.candidate.unit = text || null; }))),
    actions(cellInput(row.conversion?.factor ?? '1', text => change('measures', i, measure => { measure.conversion ??= {}; measure.conversion.factor = text; })),
      cellInput(row.conversion?.offset ?? '0', text => change('measures', i, measure => { measure.conversion ??= {}; measure.conversion.offset = text; }))),
    actions(cellInput(row.tolerance?.absolute ?? '0', text => change('measures', i, measure => { measure.tolerance ??= {}; measure.tolerance.absolute = text; })),
      cellInput(row.tolerance?.relative ?? '0', text => change('measures', i, measure => { measure.tolerance ??= {}; measure.tolerance.relative = text; }))),
    button('Remove', async () => { const next = definition(); next.measures.splice(i, 1); updateDefinition(next); }, 'small-button')])));
  if (value.measures?.length) root.append(make('p', 'Numeric measures compare exact decimal values using the selected units, conversion and tolerances. Scalar measures preserve primitive types and values; use no units, identity conversion and zero tolerances.', 'hint'));
  const timeKeys = (value.keys ?? []).filter(key => key.semantic === 'time');
  if (timeKeys.length) {
    const windowKey = make('select');
    for (const key of timeKeys) windowKey.append(new Option(key.id, key.id));
    windowKey.value = value.window?.timeKey ?? timeKeys[0].id;
    const start = make('input'), end = make('input');
    for (const input of [start, end]) { input.type = 'datetime-local'; input.step = '1'; }
    if (Number.isFinite(value.window?.start)) start.value = new Date(value.window.start * 1000).toISOString().slice(0, 19);
    if (Number.isFinite(value.window?.end)) end.value = new Date(value.window.end * 1000).toISOString().slice(0, 19);
    const labeled = (title, input) => { const label = make('label', title); label.append(input); return label; };
    root.append(make('h4', 'Comparison time window'), make('p', 'Use UTC. The start is included and the end is excluded. The original capture coverage remains visible in the review.', 'hint'),
      actions(labeled('Time key', windowKey), labeled('Start, UTC', start), labeled('End, UTC', end),
        button('Apply window', async () => {
          if (!start.value || !end.value) throw new Error('Choose both UTC window boundaries.');
          const left = Date.parse(start.value + 'Z') / 1000, right = Date.parse(end.value + 'Z') / 1000;
          if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) throw new Error('The UTC window must end after it starts.');
          const next = definition(); next.window = { timeKey: windowKey.value, start: left, end: right }; updateDefinition(next);
        }), button('Remove window', async () => { const next = definition(); delete next.window; updateDefinition(next); })));
  }
  if (value.decisions?.length) root.append(make('h4', 'Review decisions'), table(['Decision', 'Kind', 'Result', 'Reviewer', 'Reference', 'Reason'], value.decisions.map((row, i) => [
    cellInput(row.id, text => change('decisions', i, decision => { decision.id = text; })), cellInput(row.kind, text => change('decisions', i, decision => { decision.kind = text; })),
    cellInput(row.decision, text => change('decisions', i, decision => { decision.decision = text; decision.at = new Date().toISOString(); }), ['needs_review', 'approved']),
    cellInput(row.by, text => change('decisions', i, decision => { decision.by = text; })), cellInput(row.reference, text => change('decisions', i, decision => { decision.reference = text; })),
    cellInput(row.note, text => change('decisions', i, decision => { decision.note = text; }))])));
  if (!value.keys?.length && !value.measures?.length) root.append(empty('Add the original source keys and measures, or paste a complete retained mapping definition.'));
}
function renderMappingList() {
  $('mapping-list').replaceChildren(table(['Mapping', 'Family', 'Review', 'Actions'], Object.entries(current.project.state.mappings).map(([id, value]) => [
    id, value.family ?? value.mapping.family, current.project.state.mappingReviews[id]?.ready ? 'Ready' : 'Needs review',
    button('Edit', async () => {
      $('mapping-id').value = id; $('mapping-family').value = value.family ?? value.mapping.family;
      $('mapping-baseline').value = selectorValue(value.binding.baseline); $('mapping-candidate').value = selectorValue(value.binding.candidate);
      if ($('legacy-selection')) $('legacy-selection').value = pretty(value.binding.baseline.selection ?? {});
      $('candidate-selection').value = pretty(value.binding.candidate.selection ?? {});
      updateDefinition(value.mapping); updateReviewButtons(); showTab('mapping'); note('Opened the saved mapping ' + id + '.');
    }, 'small-button')])));
}
function selectorValue(value) { return value.type === 'acquisition' ? 'acquisition:' + value.id : 'source:' + value.ref; }
function selector(value, side) {
  if (value.startsWith('acquisition:')) return { type: 'acquisition', id: value.slice(12) };
  if (value.startsWith('source:')) return { type: 'source', ref: value.slice(7), selection: parse($(side === 'candidate' ? 'candidate-selection' : 'legacy-selection').value, side + ' file selection') };
  throw new Error('Choose a retained source for both sides.');
}
function updateReviewButtons() {
  if (!current) return;
  const id = $('mapping-id').value, saved = current.project.state.mappings[id], reviewed = current.project.state.mappingReviews[id];
  $('review-mapping').disabled = busy || !saved; $('compare-mapping').disabled = busy || !reviewed?.ready;
  $('select-release').disabled = busy || !releaseReview; $('rollback-release').disabled = busy || !releaseReview;
  $('open-receiver').disabled = busy || Boolean(current.receiver?.open); $('close-receiver').disabled = busy || !current.receiver?.open;
}
async function reviewSavedMapping() {
  const id = $('mapping-id').value.trim(), result = await api('mapping/review', input({ id }));
  await refreshProject(); renderReview($('mapping-review'), result.review, 'Mapping review'); note(result.review.ready ? 'Mapping is ready for result comparison.' : 'The review identifies decisions or source inputs to resolve.');
}
function renderReview(target, value, title) {
  target.replaceChildren(make('h3', title), badge(value.ready ? 'Ready' : value.status ?? 'Needs review'));
  if (value.summary) target.append(pre(value.summary));
  if (value.issues?.length) target.append(table(['Severity', 'Location', 'Issue'], value.issues.map(row => [row.severity ?? '', row.path ?? row.code ?? '', row.message ?? pretty(row)])));
  const details = make('details'), summary = make('summary', 'Complete retained review'); details.append(summary, pre(value)); target.append(details);
}
function renderComparisons() {
  $('comparison-list').replaceChildren(table(['Mapping', 'Result', 'Comparison identity', 'Actions'], Object.entries(current.project.state.comparisons).map(([id, row]) => [
    id, badge(row.status), make('span', row.comparisonId, 'mono'), button('Open comparison', () => openComparison(row.ref), 'small-button')])));
}
async function openComparison(ref) {
  const retained = await api('source?' + query('&ref=' + ref)), value = parse(retained.content, 'Comparison');
  const binding = current.project.state.mappings[value.mappingId]?.binding;
  comparisonView?.dispose();
  comparisonView = renderComparison($('comparison-detail'), value, { sourceText: retained.content,
    onOpenSource: ({ side, source, location: recordLocation }) => act(async () => {
      const selected = binding?.[side];
      if (!selected) throw new Error('Open the mapping edition that retained this comparison source.');
      if (selected.type === 'acquisition') {
        await openAcquisition(selected.id); showTab('acquire');
        $('acquisition-detail').append(make('h4', 'Selected comparison record'), pre({ side, source: source.id, location: recordLocation }));
      } else {
        const original = await api('source?' + query('&ref=' + encodeURIComponent(selected.ref)));
        const details = make('details'); details.append(make('summary', 'Complete original response'), pre(original.content));
        $('source-inspection').replaceChildren(make('h3', original.metadata.name),
          pre({ source: original.metadata, location: recordLocation }),
          button('Download original response', () => download('source-download?' + query('&ref=' + selected.ref), original.metadata.name)), details);
        showTab('sources');
      }
    }) });
  showTab('results');
}
function renderReleases() {
  const r = current.releases; $('release-state').replaceChildren(pre({ selection: r.state, running: r.ownedRuntime ?? r.runtime }));
  $('release-list').replaceChildren(table(['Release', 'Label', 'Created', 'Actions'], (r.releases ?? []).map(row => [
    row.id, row.label, row.createdAt, button('Review difference', async () => {
      releaseReview = await api('release/diff', { projectId: projectId(), to: row.id });
      $('release-diff').replaceChildren(make('h3', 'Release difference · ' + row.id), pre(releaseReview.report.summary),
        table(['Route', 'Change', 'Details'], releaseReview.report.changes.map(change => [change.route, change.state, pre(change.fields)])), pre(releaseReview.report.runtimeChanges));
      updateReviewButtons(); note('Reviewed release ' + row.id + ' against selection generation ' + releaseReview.generation + '.');
    }, 'small-button')])));
}
function submit(formId, work) { $(formId).addEventListener('submit', event => { event.preventDefault(); const form = event.currentTarget, value = fields(form), submitter = event.submitter; act(() => work(value, form, submitter)); }); }
submit('new-project', async (f, form) => { const result = await api('create', { id: f.id.trim(), title: f.title.trim(), customer: f.customer.trim(), actor: operator() }); form.reset(); await openProject(result.project.id); });
submit('source-form', async (f, form) => {
  if (!(f.file instanceof File) || !f.file.size) throw new Error('Select the original source file.');
  const metadata = parse(f.metadata, 'Original response metadata');
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Original response metadata must be an object.');
  const status = f.status ? Number(f.status) : metadata.status ?? null;
  if (status !== null && (!Number.isInteger(status) || status < 100 || status > 599)) throw new Error('Retain the recorded HTTP status or leave it empty for a file export.');
  const result = await api('source/add', input({ kind: f.kind, name: f.file.name, content: await originalFileText(f.file),
    provenance: { ...metadata, url: f.url || metadata.url || null, capturedAt: utc(f.capturedAt) ?? metadata.capturedAt ?? null,
      reference: f.reference || metadata.reference || null, importedBy: operator(), status } }));
  await refreshProject(); await renderInventory(); form.elements.file.value = ''; note('Retained ' + result.retained.name + ' in edition ' + current.project.sequence + '.');
});
submit('inventory-form', async (f, form) => {
  const value = { schema: 'stellar-forge.blockworks-inventory.v1', requests: [{ id: f.id, feature: f.feature, family: f.family, method: 'GET', path: f.path }] };
  await api('source/add', input({ kind: 'inventory', name: f.id + '-inventory.json', content: pretty(value), provenance: { enteredBy: operator(), at: new Date().toISOString() } }));
  await refreshProject(); await renderInventory(); form.reset(); note('Saved the application request inventory.');
});
submit('acquisition-form', async (f, form, submitter) => {
  await api('acquisition/create', input({ id: f.id, sourceRef: current.project.state.currentSource, family: f.family, feature: f.feature, role: f.role,
    request: { path: f.path, query: parse(f.query, 'Query parameters') }, credentialEnv: f.credentialEnv || undefined, reason: f.reason }));
  if (submitter?.value === 'run') await api('acquisition/run', { projectId: projectId(), id: f.id });
  await refreshProject(); await openAcquisition(f.id); note(submitter?.value === 'run' ? 'Started the prepared native acquisition.' : 'Prepared the exact provider request.');
});
submit('capture-form', async (f, form) => {
  await api('acquisition/import', { projectId: projectId(), id: f.id, url: f.url, status: Number(f.status), headers: parse(f.headers, 'Response headers'),
    body: await originalFileText(f.file), capturedAt: utc(f.capturedAt), provenance: { reference: f.reference, importedBy: operator() } });
  await refreshProject(); await openAcquisition(f.id); form.elements.file.value = ''; note('Imported the original native response.');
});
submit('mapping-form', async f => {
  const mapping = definition(); if (!mapping.id) throw new Error('Enter a mapping ID.');
  const binding = { contractRef: current.project.state.currentSource, baseline: selector(f.baseline, 'baseline'), candidate: selector(f.candidate, 'candidate') };
  await api('mapping/save', input({ family: f.family, mapping, binding })); await refreshProject(); note('Saved the mapping. Review this edition before comparing results.');
});
submit('source-review-form', async f => {
  const result = await api('source/review', input({ baselineName: f.baselineName, decisions: parse(f.decisions, 'Source decisions') }));
  sourceReview = result.report; await refreshProject(); renderReview($('source-review'), result.report, 'Merchant source review'); note(result.report.ready ? 'Source update is ready for package export.' : 'Resolve the source review’s operation or compiler issues.');
});
submit('merchant-export-form', async f => {
  const reviewed = current.project.state.merchant.sourceReview; if (!reviewed) throw new Error('Review the merchant source update first.');
  const result = await api('source/export', input({ name: f.name, reviewId: reviewed.reviewId })); await refreshProject(); note('Saved original merchant package ' + result.result.name + '.');
});
submit('stage-form', async f => {
  await api('release/stage', { projectId: projectId(), package: f.package, id: f.id, label: f.label, runtime: { port: Number(f.port), ...(f.facilitator ? { facilitator: f.facilitator } : {}) } });
  await refreshProject(); note('Staged the original merchant release. Open its difference before selecting it.');
});
submit('handover-form', async f => {
  const result = await api('handover/create', input({ name: f.name, receiver: f.receiver, note: f.note }));
  await refreshProject(); note('Created ' + result.filename + '. Download it from the saved handover list.');
});
submit('handover-import-form', async f => {
  const result = await importArchive(f.name.trim(), f.file);
  note('Imported the complete handover. Opening its original merchant workspace.'); location.assign(result.open.url);
});
submit('receiver-result-form', async f => {
  const selection = parse(f.selection, 'Original response layout');
  const result = await api('receiver/retain', input({ runId: f.runId.trim(), operationId: f.operationId.trim(), name: f.name.trim(), selection }));
  await refreshProject();
  $('mapping-candidate').value = 'source:' + result.retained.ref; $('candidate-selection').value = pretty(selection);
  showTab('mapping'); note('Retained ' + result.retained.name + ' from the original receiving operation. It is selected as candidate data.');
});
$('open-receiver').addEventListener('click', () => act(async () => {
  await api('receiver/open', { projectId: projectId() }); await refreshProject(); note('The original receiving workspace is open. Use its link to continue.');
}));
$('close-receiver').addEventListener('click', () => act(async () => {
  await api('receiver/close', { projectId: projectId() }); await refreshProject(); note('The receiving workspace closed with its saved operations retained.');
}));
$('refresh-projects').addEventListener('click', () => act(async () => { await refreshProjects(); await refreshProject(); note('Refreshed current work.'); }));
$('show-history').addEventListener('click', () => act(async () => {
  const result = await api('history?' + query()); $('history').hidden = false;
  $('history-list').replaceChildren(table(['Edition', 'Saved at', 'Operator', 'Action', 'Sources / acquisitions / mappings'], result.editions.slice().reverse().map(row => [
    row.sequence, row.at, row.actor, row.action, row.sourceCount + ' / ' + row.acquisitionCount + ' / ' + row.mappingCount])));
}));
$('close-history').addEventListener('click', () => { $('history').hidden = true; });
document.querySelectorAll('[data-tab]').forEach(e => e.addEventListener('click', () => showTab(e.dataset.tab)));
for (const id of ['request-model', 'request-entity', 'request-granularity']) $(id).addEventListener('change', requestPath);
$('mapping-definition').addEventListener('change', renderMappingFields); $('mapping-id').addEventListener('input', updateReviewButtons);
$('legacy-preset').addEventListener('change', () => {
  const selected = $('legacy-preset').value;
  const common = { schemaVersion: 'blockworks-legacy-projection/v1', format: selected === 'csv' ? 'csv' : 'json', kind: selected === 'series' ? 'timeseries' : 'tabular' };
  const projection = selected === 'csv' ? { csv: { delimiter: ',', header: true } } : selected === 'series' ?
    { pointsPointer: '/data/points', pointSchemaPointer: '/metadata/pointSchemas', descriptorKey: 'slug', seriesKey: '', entity: {} } :
    { rowsPointer: selected === 'assets' ? '/data' : '/data/data', metadataPointer: selected === 'assets' ? '/metadata' : '/data/metadata' };
  $('legacy-selection').value = pretty({ ...common, ...projection, wholeExport: false });
  note('Selected the original file layout. Enter its actual entity and export coverage where applicable.');
});
$('add-key').addEventListener('click', () => {
  try { const value = definition(); value.keys ??= []; value.keys.push({ id: 'key-' + (value.keys.length + 1), semantic: 'entity', baseline: { from: 'row', path: [] }, candidate: { from: 'row', path: [] }, aliases: [] }); updateDefinition(value); } catch (e) { note(e.message, true); }
});
$('add-measure').addEventListener('click', () => {
  try { const value = definition(); value.measures ??= []; value.measures.push({ id: 'measure-' + (value.measures.length + 1), interpretation: '', baseline: { from: 'row', path: [], unit: null, dimensions: {} }, candidate: { from: 'row', path: [], unit: null, dimensions: {} }, conversion: { factor: '1', offset: '0' }, tolerance: { absolute: '0', relative: '0' } }); updateDefinition(value); } catch (e) { note(e.message, true); }
});
$('add-decision').addEventListener('click', () => {
  try { const value = definition(); value.decisions ??= []; value.decisions.push({ id: 'decision-' + (value.decisions.length + 1), decision: 'needs_review', kind: 'equivalence', by: $('operator').value.trim(), at: new Date().toISOString(), reference: '', note: '' }); updateDefinition(value); } catch (e) { note(e.message, true); }
});
$('review-mapping').addEventListener('click', () => act(reviewSavedMapping));
$('compare-mapping').addEventListener('click', () => act(async () => {
  const id = $('mapping-id').value.trim(), review = current.project.state.mappingReviews[id];
  if (!review?.ready) throw new Error('Review and resolve this mapping first.');
  const result = await api('mapping/compare', input({ id, reviewId: review.reviewId })); await refreshProject();
  await openComparison(current.project.state.comparisons[id].ref); note('Compared the retained results using the saved mapping.');
}));
for (const [id, rollback] of [['select-release', false], ['rollback-release', true]]) $(id).addEventListener('click', () => act(async () => {
  if (!releaseReview) throw new Error('Open the release difference first.');
  await api('release/select', { projectId: projectId(), to: releaseReview.report.after.id, generation: releaseReview.generation,
    reviewId: releaseReview.reviewId, reason: (rollback ? 'Rollback' : 'Select release') + ' reviewed by ' + operator(), rollback });
  releaseReview = null; await refreshProject(); note('Updated the original release selection. Start it when ready.');
}));
$('start-release').addEventListener('click', () => act(async () => { await api('release/start', { projectId: projectId(), generation: current.releases.state.generation }); await refreshProject(); note('Started the selected release through its original runtime.'); }));
$('stop-release').addEventListener('click', () => act(async () => { await api('release/stop', { projectId: projectId() }); await refreshProject(); note('The owned release has stopped.'); }));
$('operator').value = sessionStorage.getItem('migration-operator') ?? '';
$('merchant-link').href = '/#' + token;
await act(async () => {
  if (!token) throw new Error('Open the complete private workspace URL printed by the launcher.');
  const list = await refreshProjects(), previous = new URLSearchParams(location.search).get('project') || sessionStorage.getItem('migration-project');
  if (previous && list.projects.some(row => row.id === previous && !row.error)) await openProject(previous);
  else note('Choose a saved migration or create a project.');
});
setInterval(() => {
  if (!current || busy || !current.acquisitions.some(row => row.running)) return;
  refreshProject().catch(error => note(error.message, true));
}, 2000);
