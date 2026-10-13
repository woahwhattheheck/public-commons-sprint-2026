/** Source updates in the original operator, embedded or opened directly. */
function attachSourceRefresh(root, host = null) {
const document = root.ownerDocument || globalThis.document;
const standalone = !host;
const life = new AbortController();
let disposed = false, pendingState = null;
const nlcdClasses = new Map([[11,"Open water"],[12,"Perennial ice and snow"],[21,"Developed, open space"],[22,"Developed, low intensity"],[23,"Developed, medium intensity"],[24,"Developed, high intensity"],[31,"Barren land"],[41,"Deciduous forest"],[42,"Evergreen forest"],[43,"Mixed forest"],[52,"Shrub and scrub"],[71,"Grassland and herbaceous"],[81,"Pasture and hay"],[82,"Cultivated crops"],[90,"Woody wetlands"],[95,"Emergent herbaceous wetlands"]]);
const $ = selector => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty = value => JSON.stringify(value, null, 2);
const short = value => String(value ?? '').slice(0, 12);
const fmt = value => typeof value === 'number' ? value.toLocaleString(undefined, {maximumFractionDigits: 3}) : String(value ?? '—');
const capKey = 'upstate-operator-capability', workspaceKey = 'upstate-selected-workspace';
const opening = new URLSearchParams(standalone ? location.search : '');
const fragment = new URLSearchParams(standalone ? location.hash.slice(1) : '');
let capability = standalone ? fragment.get('token') || sessionStorage.getItem(capKey) : null;
if (standalone && fragment.get('token')) {
  sessionStorage.setItem(capKey, capability); history.replaceState(null, '', location.pathname + location.search);
}
let workspace = host?.getWorkspace() || (standalone ? opening.get('workspace') || sessionStorage.getItem(workspaceKey) || '' : '');
let uiKey = 'upstate-source-refresh-selection:' + workspace;
let retained = {}, original = {}, previewResult = null, previewSelection = null, selectedPlan = null;
let busy = false, loading = false, timer = null, fingerprints = {}, oldStates = new Map();
let previewEpoch = 0, planRequest = 0, selectedPlanStamp = null;
let preferences = {}, requests = {};
const requestKey = () => 'upstate-source-refresh-requests:' + workspace;
const requestLabels = {'source.refresh.plan':'Save update plan','source.refresh.apply':'Continue saved update','source.refresh.landcover':'Create change layers','workspace.backup':'Export complete study'};
const canonical = value => JSON.stringify(value, function(key, item) { return item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(name => [name,item[name]])) : item; });
const classes = ['from-year','to-year','from-classes','to-classes','zone-field'];
function readPreferences() {
  preferences = {};
  uiKey = 'upstate-source-refresh-selection:' + workspace;
  try { preferences = JSON.parse(sessionStorage.getItem(uiKey) || '{}'); } catch {}
  requests = {};
  try { requests = JSON.parse(sessionStorage.getItem(requestKey()) || '{}'); } catch {}
  if (!requests || Array.isArray(requests) || typeof requests !== 'object') requests = {};
  $('#plan-title').value = preferences['plan-title'] || '';
  for (const id of classes) $('#' + id).value = preferences[id] ?? (id === 'zone-field' ? 'huc12' : '');
  for (const id of ['align','polygonize']) $('#' + id).checked = preferences[id] ?? (id === 'polygonize');
}
readPreferences();
if (standalone && opening.get('plan_id')) preferences.plans = opening.get('plan_id');

function error(value) { if (disposed || value?.name === 'AbortError') return; $('#error').hidden = !value; $('#error').textContent = value ? (value.message || String(value)) : ''; }
function notice(text) { if (disposed) return; $('#notice').textContent = text; $('#notice').hidden = !text; }
function endpoint(path, extra = {}) { return path + '?' + new URLSearchParams({workspace, ...extra}); }
async function api(path, method = 'GET', value) {
  if (disposed) throw new DOMException('Source updates closed', 'AbortError');
  if (host) return host.api(path, {method, body:value, signal:life.signal});
  if (!capability) throw new Error('Open the current scientific workbench startup URL, then choose Source updates.');
  const response = await fetch(path, {
    method, credentials: 'same-origin', signal: life.signal,
    headers: {Authorization: 'Bearer ' + capability, ...(value === undefined ? {} : {'Content-Type':'application/json'})},
    body: value === undefined ? undefined : JSON.stringify(value)
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('The operator returned an unreadable response (HTTP ' + response.status + ').'); }
  if (!response.ok) throw new Error(result.error?.message || 'The operation failed (HTTP ' + response.status + ').');
  return result;
}
function options(element, items, chosen, blank = 'Choose an item') {
  const current = chosen ?? element.value;
  element.innerHTML = '<option value="">' + esc(blank) + '</option>' + items.map(item =>
    '<option value="' + esc(item.id) + '">' + esc(item.title) + '</option>').join('');
  if (items.some(item => item.id === current)) element.value = current;
}
function savePreferences() {
  if (disposed) return;
  for (const id of ['from-edition','to-edition','plans','plan-title','from-raster','to-raster','zones', ...classes]) preferences[id] = $('#' + id).value;
  for (const id of ['align','polygonize']) preferences[id] = $('#' + id).checked;
  const mappingKey = $('#from-edition').value + '/' + $('#to-edition').value;
  if ($('#mapping').querySelector('[data-source-id]')) {
    preferences.sourceMaps ||= {}; preferences.sourceMaps[mappingKey] = {};
    $('#mapping').querySelectorAll('[data-source-id]').forEach(node => { preferences.sourceMaps[mappingKey][node.dataset.sourceId] = node.value; });
  }
  sessionStorage.setItem(uiKey, JSON.stringify(preferences));
}
function entries() {
  return (retained.sources || []).flatMap(collection => (collection.entries || []).map(entry =>
    ({id: collection.id + '/' + entry.id, title: collection.title + ' · ' + entry.title,
      collection, entry})));
}
function findEntry(id) { return entries().find(row => row.id === id); }
function collection(id) { return (retained.sources || []).find(row => row.id === id); }
function table(headers, rows) {
  if (!rows.length) return '<p class="empty">No entries in this selection.</p>';
  return '<div class="table-wrap"><table><thead><tr>' + headers.map(x => '<th>' + esc(x) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
}
function details(value, title = 'Complete saved details') { return '<details><summary>' + esc(title) + '</summary><pre>' + esc(pretty(value)) + '</pre></details>'; }
function tag(value) { return '<span class="tag">' + esc(value || 'pending') + '</span>'; }
function editionMeta(id) {
  const c = collection(id);
  return c ? (c.entries || []).length + ' original sources · ' + (c.captured_at || 'Original capture date retained with each source') + ' · ' + short(c.id) : '';
}
function renderMappings() {
  const before = collection($('#from-edition').value), after = collection($('#to-edition').value);
  $('#from-meta').textContent = editionMeta(before?.id);
  $('#to-meta').textContent = editionMeta(after?.id);
  if (!before || !after) { $('#mapping').innerHTML = ''; return; }
  const replacements = after.entries || [];
  $('#mapping').innerHTML = table(['Original source','Role / kind','Replacement source'], (before.entries || []).map(entry => {
    const remembered = preferences.sourceMaps?.[before.id + '/' + after.id]?.[entry.id];
    const selected = remembered !== undefined ? remembered : (replacements.some(x => x.id === entry.id) ? entry.id : '');
    return '<tr><td><strong>' + esc(entry.title) + '</strong><br><span class="mono">' + esc(entry.id) +
      '</span></td><td>' + esc(entry.role || entry.kind) + '</td><td><select data-source-id="' + esc(entry.id) +
      '" aria-label="Replacement for ' + esc(entry.title) + '"><option value="">No replacement selected</option>' +
      replacements.map(row => '<option value="' + esc(row.id) + '"' + (row.id === selected ? ' selected' : '') + '>' +
        esc(row.title + ' · ' + row.id) + '</option>').join('') + '</select></td></tr>';
  }));
  $('#mapping').querySelectorAll('select').forEach(select => select.addEventListener('change', invalidatePreview));
}
function invalidatePreview() {
  previewEpoch += 1;
  previewResult = previewSelection = null; $('#preview-result').innerHTML = ''; $('#save-plan').disabled = true;
  $('#preview-hint').textContent = 'Compare this selection before saving the update.';
  savePreferences();
}
function selection() {
  const map = {};
  $('#mapping').querySelectorAll('[data-source-id]').forEach(select => { map[select.dataset.sourceId] = select.value || null; });
  const value = {from_collection_id: $('#from-edition').value, to_collection_id: $('#to-edition').value, source_id_map: map};
  if (!value.from_collection_id || !value.to_collection_id) throw new Error('Choose both source editions.');
  if (value.from_collection_id === value.to_collection_id) throw new Error('Choose two different source editions.');
  if ($('#plan-title').value.trim()) value.title = $('#plan-title').value.trim();
  return value;
}
function currentSourceChoice() {
  try { return JSON.stringify({...selection(),title:undefined}); } catch { return null; }
}
function problemText(problem) {
  return typeof problem === 'string' ? problem : problem.message || problem.reason || pretty(problem);
}
function assessmentBody(value) {
  const changes = value.changes || value.entry_changes || [];
  const affected = value.affected || Object.fromEntries(['profiles','scenarios','grids','runs'].map(kind =>
    [kind,(value.nodes || []).filter(node => node.kind === kind && node.action !== 'reuse')]));
  const cards = ['profiles','scenarios','grids','runs'].map(kind => {
    const v = affected[kind]; const count = Array.isArray(v) ? v.length : (typeof v === 'number' ? v : Object.keys(v || {}).length);
    return '<div class="card"><strong>' + count + '</strong><span>Affected ' + kind + '</span></div>';
  }).join('');
  let html = '<div class="cards">' + cards + '</div>';
  const problems = value.problems || value.errors || [];
  if (problems.length) html += '<ul class="problem-list">' + problems.map(p => '<li>' + esc(problemText(p)) + '</li>').join('') + '</ul>';
  html += table(['Source','Change','Replacement','Reason'], changes.map(change => {
    const before = change.from_source_id || change.source_id || change.before_id || change.id || change.before?.id;
    const after = change.to_source_id || change.replacement_source_id || change.replacement_id || change.after_id || change.after?.id;
    const reasons = change.reasons || change.fields || change.changed_fields || change.reason || '';
    return '<tr><td class="mono">' + esc(before || '—') + '</td><td>' + tag(change.status || change.change || change.kind) +
      '</td><td class="mono">' + esc(after || '—') + '</td><td>' + esc(Array.isArray(reasons) ? reasons.join(', ') :
        typeof reasons === 'object' ? pretty(reasons) : reasons) + '</td></tr>';
  }));
  return html + details(affected, 'Affected original cases') + details(value, 'Complete edition comparison');
}

function executionBody(current) {
  if (!current || typeof current !== 'object') return '';
  const runs = Object.values(current.run_results || {});
  const comparisons = Object.values(current.comparison_results || {});
  let html = current.completion_note ? '<p class="notice">' + esc(current.completion_note) + '</p>' : '';
  if (runs.length) html += '<h3>Refreshed native cases</h3>' + table(['Earlier run','Refreshed run','Execution','Outputs'], runs.map(row =>
    '<tr><td class="mono" title="' + esc(row.from_run_id) + '">' + esc(short(row.from_run_id)) +
    '</td><td class="mono" title="' + esc(row.to_run_id) + '">' + esc(short(row.to_run_id)) +
    '</td><td>' + tag(({already_complete:'Previously completed',reused:'Verified native reuse',mixed:'Reuse and native execution'})[row.execution] || row.execution || row.state) +
    (row.model_results ? '<ul>' + Object.entries(row.model_results).map(([model,value]) =>
      '<li>' + esc(model.toUpperCase()) + ': ' + esc(value.mode === 'reused' ? 'reused native stage' : 'native stage') +
      (value.source_run_id ? ' from <span class="mono" title="' + esc(value.source_run_id) + '">' +
        esc(short(value.source_run_id)) + '</span>' : '') + '</li>').join('') + '</ul>' : '') + '</td><td>' +
    (row.state === 'complete' ? '<button type="button" data-open-files="' + esc(row.to_run_id) +
      '" data-item-kind="runs">Open run outputs</button>' : esc(row.state || 'prepared')) + '</td></tr>'));
  if (comparisons.length) html += '<h3>Source-edition comparisons</h3>' + table(['Earlier run','Refreshed run','Comparison','Outputs'], comparisons.map(row =>
    '<tr><td class="mono" title="' + esc(row.from_run_id) + '">' + esc(short(row.from_run_id)) +
    '</td><td class="mono" title="' + esc(row.to_run_id) + '">' + esc(short(row.to_run_id)) +
    '</td><td>' + tag(row.state) + (row.reason ? '<p class="muted">' + esc(row.reason) + '</p>' : '') +
    '</td><td>' + (row.comparison_id ? '<button type="button" data-open-files="' + esc(row.comparison_id) +
      '" data-item-kind="comparisons">Open change maps</button>' : '—') + '</td></tr>'));
  return html;
}

function persistRequests(values=requests, key=requestKey()) {
  sessionStorage.setItem(key, JSON.stringify(values));
}
function unresolvedRequests() {
  return Object.values(requests).filter(row => row?.workspace === workspace && row.operation_id && !row.task_id);
}
async function submitRequest(request, ledger=requests, storageKey=requestKey()) {
  const selectedWorkspace = request.workspace;
  const task = await api('/api/actions', 'POST', {workspace:selectedWorkspace,action:request.action,payload:request.payload,operation_id:request.operation_id});
  request.task_id = task.id; request.state = task.state; request.acknowledged_at = new Date().toISOString();
  persistRequests(ledger,storageKey);
  if (disposed || workspace !== selectedWorkspace || (host && host.getWorkspace() !== selectedWorkspace)) return task;
  notice((requestLabels[request.action] || request.action) + ' is ' + task.state + '. The original operation is retained with this study.');
  if (host) await host.refresh({force:true});
  await load({force:true});
  return task;
}
async function runAction(action, payload) {
  const value = JSON.parse(JSON.stringify(payload)), key = canonical({action,payload:value});
  let request = requests[key];
  const existing = request?.task_id && (original.tasks || []).find(row => row.id === request.task_id);
  if (existing) request.state = existing.state;
  // A completed apply may have prepared targets under an earlier source edition;
  // a new explicit click reopens the same plan with a new queue operation. An
  // unacknowledged or active click retains its original request identity.
  const freshCompleted = request?.state === 'complete' && ['workspace.backup','source.refresh.plan','source.refresh.apply'].includes(action);
  if (!request || freshCompleted) {
    request = {operation_id:'source-refresh-' + crypto.randomUUID(),workspace,action,payload:value,created_at:new Date().toISOString()};
    requests[key] = request;
  }
  persistRequests();
  renderTasks();
  return submitRequest(request);
}
async function guarded(fn) {
  if (busy || disposed) return;
  busy = true; error(null); updateButtons();
  try { await fn(); } catch (e) { error(e); } finally { busy = false; updateButtons(); }
}
function updateButtons() {
  if (disposed) return;
  $('#workspace').disabled = busy;
  $('#preview').disabled = busy || !$('#from-edition').value || !$('#to-edition').value;
  const previewProblems = previewResult?.problems || previewResult?.errors || [];
  $('#save-plan').disabled = busy || !previewResult || previewProblems.length > 0;
  for (const id of ['prepare-plan','run-plan','download-report','export-study']) $('#' + id).disabled = busy || !$('#plans').value;
  $('#download-plan').disabled = busy || !selectedPlan || selectedPlan.id !== $('#plans').value;
  $('#calculate-change').disabled = busy || !$('#from-raster').value || !$('#to-raster').value;
}
async function choosePlan({force=false} = {}) {
  const id = $('#plans').value, selectedWorkspace = workspace;
  const stamp = JSON.stringify((retained.plans || []).find(row => (row.plan?.id || row.id) === id) || null);
  savePreferences();
  if (!force && id && selectedPlan?.id === id && stamp === selectedPlanStamp) return;
  const ticket = ++planRequest, previousId = selectedPlan?.id;
  selectedPlan = null; updateButtons();
  if (!id) {
    selectedPlanStamp = null;
    $('#plan-detail').innerHTML = '<p class="empty">Choose a saved update plan.</p>';
    return;
  }
  if (previousId !== id) $('#plan-detail').innerHTML = '<p class="empty">Opening the selected update…</p>';
  const response = await api(endpoint('/api/source-refresh/plan', {id}));
  if (disposed || ticket !== planRequest || workspace !== selectedWorkspace || $('#plans').value !== id) return;
  selectedPlan = response; selectedPlanStamp = stamp;
  const plan = selectedPlan.plan || selectedPlan;
  const current = selectedPlan.state || selectedPlan.execution || plan.execution || {};
  const preview = plan.preview || plan.assessment || plan.snapshot || plan;
  $('#plan-detail').innerHTML = '<div class="plan-state"><strong>' + esc(plan.title || plan.selection?.title || 'Source update') +
    '</strong>' + tag(typeof current === 'string' ? current : current.state || current.status || 'saved') +
    '<span class="mono">' + esc(short(id)) + '</span></div>' +
    (current.phase ? '<p>Current phase: ' + esc(current.phase) + '</p>' : '') +
    assessmentBody(preview) + executionBody(current) + details(current, 'Retained progress and replacement identities');
  updateButtons();
}
function comparisonCoverage(item) {
  const coverage = item.spatial_support?.native_coverage;
  if (!coverage) return '';
  const labels = {nitrogen_export:'Nitrogen',phosphorus_export:'Phosphorus',sediment_export:'Sediment'};
  const entries = Object.entries(coverage);
  const area = (row,key) => fmt((row.areas_m2?.[key] ?? row[key + '_cells'] * row.pixel_area_m2) / 10000);
  const row = values => '<tr>' + values.map(value => '<td>' + esc(value) + '</td>').join('') + '</tr>';
  const areas = table(['Output','Shared area (ha)','Earlier only (ha)','Later only (ha)','Neither valid (ha)'],
    entries.map(([key,value]) => row([labels[key] || key,area(value,'common_valid'),area(value,'baseline_only'),area(value,'alternative_only'),area(value,'neither_valid')])));
  const masses = table(['Output','Shared-area change','Earlier-only mass','Later-only mass','Annual units'],
    entries.map(([key,value]) => row([labels[key] || key,fmt(item.alternatives?.[0]?.artifacts?.[key]?.sum_change),fmt(value.baseline_only_mass),fmt(value.alternative_only_mass),value.summed_mass_units])));
  return '<h3>Change and valid-data coverage</h3><p class="muted">Change is later minus earlier on shared valid cells. Coverage refers to the complete native output grid.</p>' + areas + masses;
}

function renderChanges() {
  const changes = retained.landcover_changes || [];
  $('#change-results').innerHTML = changes.length ? table(['Saved change','Earlier source','Later source','Outputs'], changes.map(record =>
    '<tr><td><strong>' + esc(record.title) + '</strong><br>' + esc(record.created_at || '') +
    '</td><td class="mono">' + esc(record.from_source_id) + '</td><td class="mono">' + esc(record.to_source_id) +
    '</td><td><button type="button" data-change-files="' + esc(record.source_collection_id) + '">Open change layers</button></td></tr>')) : '';
}
function isRefreshTask(task) {
  return String(task.action).startsWith('source.refresh.') || task.action === 'source-refresh.apply' ||
    (task.action === 'workspace.backup' && task.payload?.source_refresh_plan_id);
}
function renderTasks() {
  const tasks = (original.tasks || []).filter(isRefreshTask);
  const labels = {'source.refresh.plan':'Save source-update plan','source.refresh.apply':'Continue source update','source.refresh.landcover':'Measure land-cover change','source-refresh.apply':'Continue source update','workspace.backup':'Export complete study'};
  const pendingRequests = unresolvedRequests();
  const recovery = pendingRequests.length ? '<div class="request-recovery"><h3>Continue a submitted selection</h3><p>These submitted selections retain their original request identities. Continue a selection to obtain its original task.</p>' + pendingRequests.map(row => '<button type="button" data-retry-request="' + esc(row.operation_id) + '">' + esc(requestLabels[row.action] || row.action) + '</button>').join(' ') + '</div>' : '';
  $('#tasks').innerHTML = recovery + (tasks.length ? tasks.map(task => '<article class="task"><div class="task-head"><strong>' +
    esc(labels[task.action] || task.action) + '</strong>' + tag(task.state) + '</div><p class="muted">' +
    esc(task.created_at || '') + ' · <span class="mono">' + esc(short(task.id)) + '</span></p>' +
    (task.error ? '<p>' + esc(task.error.message || pretty(task.error)) + '</p>' : '') +
    (['failed','interrupted','cancelled'].includes(task.state) ? '<button type="button" data-resume="' + esc(task.id) + '">Resume this operation</button>' : '') +
    (task.state === 'queued' ? '<button type="button" data-cancel="' + esc(task.id) + '">Cancel queued operation</button>' : '') +
    '<button type="button" data-open-task="' + esc(task.id) + '">' + (task.action === 'workspace.backup' && task.state === 'complete' ? 'Download complete study' : 'Open operation') + '</button>' +
    details(task.result || {operation_id:task.operation_id,payload:task.payload,attempts:task.attempts}, 'Operation details') + '</article>').join('') :
    '<p class="empty">Source-update operations appear here when started.</p>');
  for (const task of tasks) {
    const before = oldStates.get(task.id);
    if (before && before !== task.state && task.state === 'complete') notice((labels[task.action] || task.action) + ' completed.');
    oldStates.set(task.id, task.state);
  }
  let changed = false;
  for (const request of Object.values(requests)) {
    const task = tasks.find(row => row.id === request.task_id || row.operation_id === request.operation_id);
    if (task && (request.task_id !== task.id || request.state !== task.state)) {
      request.task_id = task.id; request.state = task.state; changed = true;
    }
  }
  if (changed) persistRequests();
}
async function load({force=false, suppliedState=null} = {}) {
  if (disposed) return;
  if (loading) { if (suppliedState) pendingState = suppliedState; return; }
  loading = true;
  try {
    const next = host ? (suppliedState || host.getState()) : await api(workspace ? endpoint('/api/state') : '/api/state');
    if (disposed || !next?.workspace_key) return;
    if (host && next.workspace_key !== workspace) return;
    original = next;
    if (workspace !== original.workspace_key) { workspace = original.workspace_key; readPreferences(); }
    if (standalone) sessionStorage.setItem(workspaceKey, workspace);
    const updates = original.data?.source_updates;
    retained = updates ? {project:original.data.project,sources:original.data.sources,...updates} :
      await api(endpoint('/api/source-refresh'));
    if (disposed) return;
    options($('#workspace'), (original.workspaces || []).filter(row => row.available !== false), workspace, 'Choose a workspace');
    const sourceFingerprint = JSON.stringify((retained.sources || []).map(x => x.id));
    if (force || fingerprints.sources !== sourceFingerprint) {
      const selected = {};
      for (const id of ['from-edition','to-edition','from-raster','to-raster','zones']) selected[id] = $('#' + id).value || preferences[id];
      options($('#from-edition'), retained.sources || [], selected['from-edition'], 'Choose earlier source edition');
      options($('#to-edition'), retained.sources || [], selected['to-edition'], 'Choose replacement source edition');
      const all = entries(), raster = all.filter(x => x.entry.kind === 'raster' && (x.entry.role === 'NLCD' || x.entry.units === 'class'));
      options($('#from-raster'), raster, selected['from-raster'], 'Choose earlier classified raster');
      options($('#to-raster'), raster, selected['to-raster'], 'Choose later classified raster');
      options($('#zones'), all.filter(x => x.entry.kind === 'vector'), selected.zones, 'No zone summaries');
      renderMappings(); fingerprints.sources = sourceFingerprint;
    }
    const planFingerprint = JSON.stringify(retained.plans || []);
    if (force || fingerprints.plans !== planFingerprint) {
      const chosen = $('#plans').value || preferences.plans;
      const plans = (retained.plans || []).map(item => {
        const p = item.plan || item;
        return {id:p.id || item.id,title:p.title || p.selection?.title || ('Update ' + short(p.id || item.id))};
      });
      options($('#plans'), plans, chosen, 'Choose a saved update');
      fingerprints.plans = planFingerprint;
    }
    renderChanges(); renderTasks();
    if ($('#plans').value) await choosePlan({force});
    updateButtons();
  } catch (e) { if (force || !retained.project) error(e); }
  finally {
    loading = false; clearTimeout(timer);
    const active = (original.tasks || []).some(x => isRefreshTask(x) && ['queued','running'].includes(x.state));
    if (!disposed && standalone && !document.hidden) timer = setTimeout(() => load(), active ? 2500 : 15000);
    if (!disposed && pendingState) {
      const next = pendingState; pendingState = null;
      queueMicrotask(() => load({suppliedState:next}));
    }
  }
}
function parseClasses(id) {
  const value = $('#' + id).value.trim();
  if (!value) return null;
  const values = value.split(/[\s,;]+/).filter(Boolean).map(x => Number(x));
  if (values.some(x => !Number.isInteger(x) || !nlcdClasses.has(x))) throw new Error('Use the supported Annual NLCD class codes shown below the filters, separated by commas.');
  return [...new Set(values)];
}
function rasterSelection(side) {
  const selected = findEntry($('#' + side + '-raster').value);
  if (!selected) throw new Error('Choose both original classified land-cover rasters.');
  const input = $('#' + side + '-year'), year = input.value.trim();
  if (input.validity.badInput || (year && (!Number.isInteger(Number(year)) || Number(year) < 1985 || Number(year) > 2100))) {
    throw new Error('Choose the original raster year as an integer from 1985 to 2100.');
  }
  return {[side + '_collection_id']:selected.collection.id,[side + '_source_id']:selected.entry.id,...(year ? {[side + '_year']:Number(year)} : {})};
}
function suggestYear(side) {
  const selected = findEntry($('#' + side + '-raster').value);
  const entry = selected?.entry || {}, metadata = entry.metadata || {};
  const years = [...new Set([entry.year,metadata.year,metadata.product_year,entry.source_time,
    /^\d{4}$/.test(String(entry.vintage ?? '').trim()) ? entry.vintage : null].flatMap(value => {
    const match = String(value ?? '').trim().match(/^(\d{4})(?:-\d{2}-\d{2}(?:[T ].*)?)?$/);
    return match ? [Number(match[1])] : [];
  }))];
  const year = years.length === 1 ? years[0] : '';
  $('#' + side + '-year').value = year || '';
  savePreferences(); updateButtons();
}
function download(value, filename, mime='application/json') {
  const body = mime === 'application/json' ? pretty(value) + '\n' : String(value);
  const url = URL.createObjectURL(new Blob([body], {type:mime}));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#preview').addEventListener('click', () => guarded(async () => {
  const chosen = selection(), chosenKey = currentSourceChoice(), epoch = previewEpoch;
  const response = await api('/api/source-refresh/preview', 'POST', {workspace,selection:chosen});
  if (disposed || epoch !== previewEpoch || currentSourceChoice() !== chosenKey) return;
  previewResult = response; previewSelection = chosen;
  $('#preview-result').innerHTML = assessmentBody(previewResult);
  const problems = previewResult.problems || previewResult.errors || [];
  $('#preview-hint').textContent = problems.length ? 'Resolve the source mappings above, then compare again.' : 'The update can now be saved with these exact source choices.';
}));
$('#save-plan').addEventListener('click', () => guarded(async () => {
  if (!previewSelection || currentSourceChoice() !== JSON.stringify({...previewSelection,title:undefined})) {
    invalidatePreview(); throw new Error('Compare the current source choices before saving this update.');
  }
  await runAction('source.refresh.plan', {...previewSelection,title:$('#plan-title').value.trim() || previewSelection.title});
}));
for (const id of ['from-edition','to-edition']) $('#' + id).addEventListener('change', () => {
  renderMappings(); invalidatePreview(); updateButtons();
});
$('#plans').addEventListener('change', () => { void choosePlan({force:true}).catch(error); });
$('#prepare-plan').addEventListener('click', () => guarded(() => runAction('source.refresh.apply', {plan_id:$('#plans').value,run_models:false})));
$('#run-plan').addEventListener('click', () => guarded(() => runAction('source.refresh.apply', {plan_id:$('#plans').value,run_models:true})));
$('#download-plan').addEventListener('click', () => { if (selectedPlan) download(selectedPlan, 'Upper_Savannah_Source_Update_' + short($('#plans').value) + '.json'); });
$('#download-report').addEventListener('click', () => guarded(async () => {
  const id = $('#plans').value, chosenWorkspace = workspace, format = $('#report-format').value;
  if (!id) throw new Error('Choose a saved update.');
  const report = await api(endpoint('/api/source-refresh/report', {id}));
  if (disposed || workspace !== chosenWorkspace || $('#plans').value !== id) return;
  if (!['csv','html'].includes(format) || typeof report[format] !== 'string') throw new Error('The saved update report is unavailable.');
  download(report[format], 'Upper_Savannah_Source_Update_' + short(id) + '.' + format,
    format === 'html' ? 'text/html;charset=utf-8' : 'text/csv;charset=utf-8');
}));
$('#export-study').addEventListener('click', () => guarded(async () => {
  const id = $('#plans').value;
  if (!id) throw new Error('Choose a saved update.');
  await runAction('workspace.backup', {include_intermediates:true,source_refresh_plan_id:id});
}));
$('#calculate-change').addEventListener('click', () => guarded(async () => {
  const payload = {...rasterSelection('from'),...rasterSelection('to'),from_classes:parseClasses('from-classes'),
    to_classes:parseClasses('to-classes'),align_to_from:$('#align').checked,polygonize:$('#polygonize').checked};
  const zone = findEntry($('#zones').value);
  if (zone) Object.assign(payload,{zone_collection_id:zone.collection.id,zone_source_id:zone.entry.id,
    zone_layer:zone.entry.layer,zone_id_field:$('#zone-field').value.trim() || 'huc12'});
  savePreferences(); await runAction('source.refresh.landcover', payload);
}));
for (const side of ['from','to']) $('#' + side + '-raster').addEventListener('change', () => suggestYear(side));
for (const id of [...classes,'zones','align','polygonize','plan-title']) $('#' + id).addEventListener('change', savePreferences);
$('#plan-title').addEventListener('input', savePreferences);
$('#reload').addEventListener('click', () => guarded(async () => { if (host) await host.refresh({force:true}); await load({force:true}); }));
$('#workspace').addEventListener('change', () => guarded(async () => {
  if (!standalone) return;
  savePreferences();
  workspace = $('#workspace').value; fingerprints = {}; previewResult = previewSelection = selectedPlan = null;
  previewEpoch += 1; planRequest += 1; selectedPlanStamp = null;
  oldStates = new Map(); readPreferences();
  sessionStorage.setItem(workspaceKey,workspace);
  $('#from-edition').value = $('#to-edition').value = $('#plans').value = '';
  $('#from-raster').value = $('#to-raster').value = $('#zones').value = '';
  $('#preview-result').innerHTML = ''; $('#plan-detail').innerHTML = '';
  await load({force:true});
}));
root.addEventListener('click', event => {
  const retry = event.target.closest('[data-retry-request]');
  if (retry) guarded(async () => {
    const request = Object.values(requests).find(row => row.operation_id === retry.dataset.retryRequest);
    if (!request || request.workspace !== workspace) throw new Error('Reopen the study that owns this saved request.');
    await submitRequest(request);
  });
  const openTask = event.target.closest('[data-open-task]');
  if (openTask) guarded(async () => {
    if (host?.showTask) { await host.showTask(openTask.dataset.openTask); return; }
    const item = await api('/api/task?' + new URLSearchParams({id:openTask.dataset.openTask}));
    if (disposed) return;
    const article = openTask.closest('.task'), previous = article.querySelector('[data-task-downloads]');
    const downloads = document.createElement('div'); downloads.dataset.taskDownloads = '';
    downloads.innerHTML = '<div class="downloads">' + (item._downloads || [])
      .filter(row => typeof row.url === 'string' && /^\/api\/file\/[a-f0-9]+(?:\?|$)/.test(row.url))
      .map(row => '<a href="' + esc(row.url + (row.url.includes('?') ? '&' : '?') + 'download=1') + '">' +
        esc(row.label || row.filename || 'Download output') + '</a>').join('') + '</div>' + details(item, 'Retained operation');
    if (previous) previous.replaceWith(downloads); else article.append(downloads);
  });
  const resume = event.target.closest('[data-resume]'), cancel = event.target.closest('[data-cancel]'), files = event.target.closest('[data-change-files],[data-open-files]');
  if (resume) guarded(async () => { await api('/api/task/resume','POST',{id:resume.dataset.resume}); await load({force:true}); });
  if (cancel) guarded(async () => { await api('/api/task/cancel','POST',{id:cancel.dataset.cancel}); await load({force:true}); });
  if (files) guarded(async () => {
    const itemId = files.dataset.openFiles || files.dataset.changeFiles;
    const itemKind = files.dataset.itemKind || 'sources';
    const item = await api(endpoint('/api/item',{kind:itemKind,id:itemId}));
    const row = files.closest('tr'), old = row.nextElementSibling;
    if (old?.dataset.filesFor === itemId) { old.remove(); return; }
    const insert = document.createElement('tr'); insert.dataset.filesFor = itemId;
    const cell = document.createElement('td'); cell.colSpan = 4;
    const candidates = []; const walk = object => {
      if (!object || typeof object !== 'object') return;
      if (typeof object.url === 'string' && /^\/api\/file\/[a-f0-9]+/.test(object.url)) candidates.push(object);
      if (Array.isArray(object)) object.forEach(walk); else Object.values(object).forEach(walk);
    }; walk(item);
    const unique = [...new Map(candidates.map(x=>[x.url,x])).values()];
    cell.innerHTML = comparisonCoverage(item) + '<div class="downloads">' + unique.map(x => '<a href="' + esc(x.url + (x.url.includes('?')?'&':'?') + 'download=1') + '">' + esc(x.label || x.filename || x.name || 'Download source') + '</a>').join('') + '</div>' + details(item,'Retained output metadata');
    insert.appendChild(cell); row.after(insert);
  });
});
document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  if (!document.hidden && !disposed) load({force:true});
}, {signal:life.signal});
$('#class-reference').innerHTML = table(['Code','Land cover'], [...nlcdClasses].map(([code,label]) => '<tr><td>' + code + '</td><td>' + esc(label) + '</td></tr>'));
void guarded(async () => {
  if (standalone) await api('/api/session','POST',{});
  await load({force:true});
});
return {
  update(state) { if (!disposed) void load({suppliedState:state}); },
  detach() {
    if (disposed) return;
    savePreferences(); disposed = true; previewEpoch += 1; planRequest += 1;
    clearTimeout(timer); life.abort();
    pendingState = null;
  }
};
}


export function createSourceRefresh(host) {
  if (!host || typeof host.api !== 'function' || typeof host.getState !== 'function' ||
      typeof host.getWorkspace !== 'function' || typeof host.refresh !== 'function') {
    throw new TypeError('Source updates needs the existing operator host.');
  }
  const document = host.document || globalThis.document;
  let desk = null, request = null, epoch = 0, mountedWorkspace = null;
  function detach() {
    epoch += 1; request?.abort(); request = null;
    desk?.detach(); desk = null; mountedWorkspace = null;
  }
  return {
    async mount(node, state) {
      detach();
      const selectedEpoch = epoch, workspace = state?.workspace_key;
      if (!workspace) throw new Error('Choose an original workspace.');
      request = new AbortController();
      try {
      const response = await fetch('/web/source-refresh.html', {credentials:'same-origin',signal:request.signal});
      if (!response.ok) throw new Error('Source updates could not open its installed page.');
      const text = await response.text();
      if (selectedEpoch !== epoch || host.getWorkspace() !== workspace) return;
      const parsed = new DOMParser().parseFromString(text, 'text/html');
      const shell = document.createElement('div');
      shell.className = 'source-refresh-desk';
      const shadow = shell.attachShadow({mode:'open'});
      const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/web/source-refresh.css';
      shadow.append(style);
      for (const child of parsed.body.childNodes) shadow.append(document.importNode(child,true));
      const topbar = shadow.querySelector('.topbar');
      const reload = shadow.querySelector('#reload');
      const actions = document.createElement('div'); actions.className = 'actions';
      actions.append(reload); shadow.querySelector('.page-title').append(actions);
      topbar.hidden = true; shadow.querySelector('.skip')?.remove(); shadow.querySelector('footer')?.remove();
      node.replaceChildren(shell); mountedWorkspace = workspace;
      desk = attachSourceRefresh(shadow,host);
      desk.update(state);
      } catch (error) {
        if (selectedEpoch !== epoch || error?.name === 'AbortError') return;
        throw error;
      } finally {
        if (selectedEpoch === epoch) request = null;
      }
    },
    update(state) {
      if (state?.workspace_key === mountedWorkspace) desk?.update(state);
    },
    detach
  };
}

if (globalThis.document?.body?.hasAttribute('data-source-refresh-standalone')) {
  const direct = attachSourceRefresh(globalThis.document);
  globalThis.addEventListener('pagehide', () => direct.detach(), {once:true});
}
