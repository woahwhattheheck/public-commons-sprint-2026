/* MIT. Browser client for local operator previews; never fetches a merchant URL. */
'use strict';
const $ = id => document.getElementById(id);
const text = (tag, value, className) => {
  const node = document.createElement(tag); node.textContent = String(value);
  if (className) node.className = className;
  return node;
};
const sessionKey = 'sf30-dataset-workspace-session';
let token = location.hash.slice(1);
try {
  if (token) { sessionStorage.setItem(sessionKey, token); history.replaceState(null, '', '/'); }
  else token = sessionStorage.getItem(sessionKey) || '';
} catch { /* Session still works without browser storage; use the printed URL after reload. */ }
let schema, controls = [], latest = null, currentQuery = '', historyQueries = [], busy = false;
let catalogBusy = false, activationNeedsRefresh = false;
const selectedVersion = () => schema?.versions?.versions.find(version => version.snapshot === $('version').value);
const short = value => String(value).slice(0, 12);
function status(message, error = false) {
  $('status').textContent = message; $('status').className = error ? 'error' : '';
}
function buttons() {
  for (const id of ['run', 'run-raw', 'reset']) $(id).disabled = busy || !schema;
  if (selectedVersion()?.status === 'EXPIRED') $('run').disabled = true;
  $('version').disabled = busy || !schema?.versions;
  $('refresh-state').disabled = busy || !schema?.versions;
  $('activate').disabled = busy || activationNeedsRefresh || !selectedVersion() ||
    selectedVersion().snapshot === schema?.versions?.current;
  $('refresh-catalog').disabled = catalogBusy;
  $('previous').disabled = busy || !historyQueries.length;
  $('next').disabled = busy || !latest?.result.page.nextCursor;
  $('save-query').disabled = busy || !latest;
  $('save-result').disabled = busy || !latest;
  $('copy').disabled = busy || !latest?.curl;
}
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', credentials: 'omit' });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.message || value.error || 'HTTP ' + response.status),
    { code: value.error, status: response.status });
  return value;
}
function input(label) {
  const node = document.createElement('input'); node.type = 'text'; node.setAttribute('aria-label', label);
  node.autocomplete = 'off'; return node;
}
function bound(column, side) {
  const cell = document.createElement('td');
  if (!column.rangeFilterable) { cell.textContent = '—'; return { cell }; }
  const op = document.createElement('select'); op.setAttribute('aria-label', `${column.name} ${side} operator`);
  const choices = side === 'lower' ? [['', 'None'], ['gt', '>'], ['gte', '≥']] : [['', 'None'], ['lt', '<'], ['lte', '≤']];
  choices.forEach(([value, label]) => { const option = text('option', label); option.value = value; op.append(option); });
  const value = input(`${column.name} ${side} value`); value.disabled = true;
  op.addEventListener('change', () => { value.disabled = !op.value; });
  cell.append(op, value); return { cell, op, value };
}
function renderControls() {
  const body = $('columns').tBodies[0]; body.replaceChildren(); controls = [];
  for (const c of schema.dataset.columns) {
    const row = document.createElement('tr');
    const include = document.createElement('input'); include.type = 'checkbox'; include.checked = true;
    include.setAttribute('aria-label', `Include ${c.name}`);
    const label = text('label', c.name); label.prepend(include);
    const fieldCell = document.createElement('td'); fieldCell.append(label);
    row.append(fieldCell, text('td', c.type + (c.nullable ? ' / null' : '')));
    const eqCell = document.createElement('td'); let eqEnabled, eqValue;
    if (c.filterable) {
      eqEnabled = document.createElement('input'); eqEnabled.type = 'checkbox';
      eqEnabled.setAttribute('aria-label', `${c.name} equality enabled`);
      eqValue = input(`${c.name} equals value`); eqValue.disabled = true;
      eqEnabled.addEventListener('change', () => { eqValue.disabled = !eqEnabled.checked; });
      eqCell.append(eqEnabled, eqValue);
    } else eqCell.textContent = '—';
    const low = bound(c, 'lower'), high = bound(c, 'upper');
    row.append(eqCell, low.cell, high.cell); body.append(row);
    controls.push({ c, include, eqEnabled, eqValue, low, high });
  }
  $('sort').replaceChildren(text('option', 'CSV record order')); $('sort').options[0].value = '';
  for (const c of schema.dataset.columns.filter(c => c.sortable)) {
    const option = text('option', c.name); option.value = c.name; $('sort').append(option);
  }
  $('sort').disabled = !schema.dataset.columns.some(c => c.sortable);
  $('limit').value = schema.dataset.defaultLimit; $('limit').max = schema.dataset.maxLimit;
  $('descending').checked = false;
}
function formQuery() {
  const q = new URLSearchParams();
  const fields = controls.filter(c => c.include.checked).map(c => c.c.name);
  if (!fields.length) throw new Error('Select at least one output field.');
  q.set('fields', fields.join(',')); q.set('limit', $('limit').value);
  if (schema.versions && $('version').value) q.set('snapshot', $('version').value);
  for (const item of controls) {
    if (item.eqEnabled?.checked) q.set(`where_${item.c.name}`, item.eqValue.value);
    for (const b of [item.low, item.high]) if (b.op?.value) q.set(`${b.op.value}_${item.c.name}`, b.value.value);
  }
  if ($('sort').value) q.set('sort', ($('descending').checked ? '-' : '') + $('sort').value);
  return q.toString();
}
function renderResult(value) {
  const result = value.result;
  const headers = document.createElement('tr');
  result.fields.forEach(field => { const th = text('th', field); th.scope = 'col'; headers.append(th); });
  $('results').tHead.replaceChildren(headers);
  const fragment = document.createDocumentFragment();
  for (const row of result.rows) {
    const tr = document.createElement('tr');
    for (const field of result.fields) {
      const value = row[field]; tr.append(text('td', value === null ? 'null' : value, value === null ? 'null' : ''));
    }
    fragment.append(tr);
  }
  $('results').tBodies[0].replaceChildren(fragment);
  const order = result.order ? `${result.order.column} ${result.order.direction}; nulls last; CSV ties` : 'CSV record order';
  $('result-summary').textContent = `${result.page.returned.toLocaleString()} returned / ${result.page.total.toLocaleString()} matching records · ${order}`;
  $('result-snapshot').textContent = 'Preview snapshot · ' + value.snapshot;
  $('recipe').textContent = value.curl ? value.requestUrl + '\n\n' + value.curl : value.requestUnavailable || 'No public resource configured. The saved query still contains exact parameters and snapshot identity. Restart with --resource to add public request examples.';
}
async function run(query, mode = 'new') {
  if (busy) return;
  busy = true; buttons(); status('Preparing query against the selected source snapshot…');
  try {
    const result = await api('/api/query', { query });
    if (mode === 'next') historyQueries.push(currentQuery);
    else if (mode === 'previous') historyQueries.pop();
    else historyQueries = [];
    latest = result; currentQuery = result.query; $('raw').value = result.query;
    renderResult(result);
    status(`Preview complete. ${result.result.page.total.toLocaleString()} matching records. No public request or payment was made.`);
  } catch (error) { status(error.message + (latest ? ' The last successful result remains below.' : ''), true); }
  finally { busy = false; buttons(); }
}
function save(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('run').addEventListener('click', () => {
  try { run(formQuery()); } catch (error) { status(error.message, true); }
});
$('run-raw').addEventListener('click', () => run($('raw').value.replace(/^\?/, '')));
$('next').addEventListener('click', () => {
  if (!latest?.result.page.nextCursor) return;
  const q = new URLSearchParams(currentQuery); q.set('cursor', latest.result.page.nextCursor); run(q.toString(), 'next');
});
$('previous').addEventListener('click', () => { if (historyQueries.length) run(historyQueries.at(-1), 'previous'); });
$('reset').addEventListener('click', () => { renderControls(); $('raw').value = ''; status('Query controls reset. The last successful result, if any, remains below.'); });
$('save-query').addEventListener('click', () => {
  if (!latest) return;
  const { schema, mode, snapshot, query, requestUrl, requestUnavailable } = latest;
  save('dataset-query.json', { schema, mode, snapshot, query, requestUrl,
    ...(requestUnavailable ? { requestUnavailable } : {}) });
});
$('save-result').addEventListener('click', () => { if (latest) save('dataset-page.json', latest.result); });
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(latest.curl); status('Unpaid request example copied.'); }
  catch { status('Clipboard unavailable. Select and copy the request example shown above.', true); }
});
function selectionNote() {
  const selected = selectedVersion();
  $('selection-note').textContent = !selected ?
    'No snapshot parameter is added. The running service selects its current dataset when the query is admitted.' :
    selected.status === 'EXPIRED' ?
      'This stored version has expired for new queries. You can explicitly reactivate it while it is still stored.' :
      'New previews explicitly select ' + selected.snapshot + '. Continuation keeps the original cursor unchanged.';
  $('activation-note').textContent = schema?.versions ?
    'Activation uses displayed revision ' + schema.versions.revision + ' and current snapshot ' +
      short(schema.versions.current) + '. It changes the current pointer; the previous snapshot keeps its configured retention period.' : '';
}
function renderVersions() {
  const live = schema.versions;
  $('version-panel').hidden = !live;
  if (!live) return;
  const selected = $('version').value;
  $('version-summary').textContent = 'Revision ' + live.revision + ' · ' + live.versions.length + ' / ' +
    live.settings.maxVersions + ' stored versions · ' + live.retainedSourceBytes.toLocaleString() + ' source bytes retained';
  $('cache-summary').textContent = 'Parsed cache: ' + live.cache.residentVersions + ' / ' +
    live.cache.maxCachedVersions + ' snapshots · ' + live.cache.residentRows.toLocaleString() + ' / ' +
    live.cache.maxResidentRows.toLocaleString() + ' rows. Cold snapshots load within this same budget.';
  const body = $('versions').tBodies[0]; body.replaceChildren();
  $('version').replaceChildren(text('option', 'Current at request admission')); $('version').options[0].value = '';
  for (const version of live.versions) {
    const row = document.createElement('tr');
    row.append(text('td', version.snapshot, 'mono digest'), text('td', version.status),
      text('td', version.rowCount.toLocaleString()), text('td', version.resident ? 'Resident' : 'Cold'),
      text('td', version.readers + ' / ' + version.loading),
      text('td', version.expiresAt === null ? 'Current — no expiry' : new Date(version.expiresAt).toISOString()));
    body.append(row);
    const option = text('option', short(version.snapshot) + ' · ' + version.status + ' · ' + version.rowCount + ' rows');
    option.value = version.snapshot; $('version').append(option);
  }
  $('version').value = live.versions.some(version => version.snapshot === selected) ? selected : '';
  selectionNote();
}
function renderSchema(value, reset = false) {
  schema = value;
  const d = schema.dataset;
  $('stats').replaceChildren();
  for (const [value, label] of [[d.name, 'Dataset'], [d.rowCount.toLocaleString(), 'Source records'],
    [d.columns.length, 'Exposed columns'], [d.maxLimit, 'Maximum page size']]) {
    const block = document.createElement('div'); block.append(text('strong', value), text('span', label, 'muted')); $('stats').append(block);
  }
  $('snapshot-heading').textContent = schema.versions ? 'Current source snapshot' : 'Source snapshot';
  $('snapshot').textContent = 'Snapshot · ' + d.snapshot;
  $('resource').textContent = schema.resource ? 'Public request examples target ' + schema.resource + ' (not contacted).' :
    'No public resource configured. Query preparation and exports remain available.';
  if (schema.versions) {
    $('subtitle').textContent = 'Inspect the running dataset, prepare native queries and manage retained versions.';
    $('resource').textContent += schema.publicSnapshotSelection ?
      ' This route advertises optional first-page snapshot selection.' :
      ' This route accepts current queries and original cursors; first-page selection stays private.';
    $('footer-note').textContent = 'The workspace uses the running service’s original dataset engine and private control connection. Preview reads expose only configured columns and do not make a payment. Making a snapshot current changes the retained version pointer with snapshot and revision checks. Keep the session URL private; close this workspace when finished.';
  }
  $('catalog-panel').hidden = !schema.catalogConfigured;
  renderVersions();
  if (reset) renderControls();
}
async function refreshSchema() {
  const value = await api('/api/schema');
  renderSchema(value); activationNeedsRefresh = false;
}
async function refreshCatalog() {
  if (!schema?.catalogConfigured || catalogBusy) return;
  catalogBusy = true; buttons();
  try {
    const value = await api('/api/catalog');
    $('catalog-summary').textContent = value.state + ' · ' + value.activeResources + ' active catalog resources · ' +
      value.committedOperations + ' committed operations. This is catalog-wide status.';
    $('catalog-head').textContent = 'Journal head · ' + value.journalHead;
    $('catalog-origin').textContent = 'Live discovery origin · ' + value.discoveryOrigin;
  } catch (error) {
    $('catalog-summary').textContent = error.message; $('catalog-head').textContent = ''; $('catalog-origin').textContent = '';
  } finally { catalogBusy = false; buttons(); }
}
$('version').addEventListener('change', () => {
  latest = null; currentQuery = ''; historyQueries = [];
  $('results').tHead.replaceChildren(); $('results').tBodies[0].replaceChildren();
  $('result-summary').textContent = 'Run a query to inspect the selected snapshot.';
  $('result-snapshot').textContent = ''; $('recipe').textContent = 'Preview a query to prepare a request example.';
  try { $('raw').value = formQuery(); } catch { $('raw').value = ''; }
  selectionNote(); buttons(); status('Snapshot selection updated. Preview a query or make the selected stored snapshot current.');
});
$('refresh-state').addEventListener('click', async () => {
  if (busy) return;
  busy = true; buttons(); status('Reading current versions and parsed-cache occupancy…');
  try { await refreshSchema(); status('Live state refreshed. Existing query cursors and explicit snapshot selections are preserved.'); }
  catch (error) { activationNeedsRefresh = true; status(error.message, true); }
  finally { busy = false; buttons(); }
});
$('activate').addEventListener('click', async () => {
  const selected = selectedVersion();
  if (busy || !selected || activationNeedsRefresh) return;
  const input = { snapshot: selected.snapshot, expectedSnapshot: schema.versions.current, expectedRevision: schema.versions.revision };
  busy = true; buttons(); status('Making the selected retained snapshot current…');
  try {
    const result = await api('/api/activate', input);
    renderSchema(result.workspace); activationNeedsRefresh = false;
    status((result.activation.changed ? 'Activated ' : 'Already current: ') + short(result.activation.current) +
      '. Live state is revision ' + schema.versions.revision + ', current ' + short(schema.versions.current) + '.');
  } catch (error) {
    activationNeedsRefresh = true;
    let refreshed = false;
    try { await refreshSchema(); refreshed = true; } catch { /* Keep the stale state visibly non-actionable. */ }
    status(error.message + (refreshed ?
      ' Live state has been refreshed. Review the selection and choose Make current again if appropriate.' :
      ' Refresh live state to inspect the current result before another activation.'), true);
  } finally { busy = false; buttons(); }
});
$('refresh-catalog').addEventListener('click', refreshCatalog);
(async () => {
  try {
    renderSchema(await api('/api/schema'), true);
    status('Ready. Select fields, add filters and preview a query.'); buttons();
    await refreshCatalog();
  } catch (error) { status(error.message, true); }
})();
