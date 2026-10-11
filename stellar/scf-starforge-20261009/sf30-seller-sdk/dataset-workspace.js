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
function status(message, error = false) {
  $('status').textContent = message; $('status').className = error ? 'error' : '';
}
function buttons() {
  for (const id of ['run', 'run-raw', 'reset']) $(id).disabled = busy || !schema;
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
  if (!response.ok) throw new Error(value.message || value.error || `HTTP ${response.status}`);
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
  $('recipe').textContent = value.curl ? value.requestUrl + '\n\n' + value.curl : 'No public resource configured. The saved query still contains exact parameters and snapshot identity. Restart with --resource to add public request examples.';
}
async function run(query, mode = 'new') {
  if (busy) return;
  busy = true; buttons(); status('Preparing query against the loaded source snapshot…');
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
  const { schema, mode, snapshot, query, requestUrl } = latest;
  save('dataset-query.json', { schema, mode, snapshot, query, requestUrl });
});
$('save-result').addEventListener('click', () => { if (latest) save('dataset-page.json', latest.result); });
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(latest.curl); status('Unpaid request example copied.'); }
  catch { status('Clipboard unavailable. Select and copy the request example shown above.', true); }
});
(async () => {
  try {
    schema = await api('/api/schema');
    const d = schema.dataset;
    for (const [value, label] of [[d.name, 'Dataset'], [d.rowCount.toLocaleString(), 'Source records'],
      [d.columns.length, 'Exposed columns'], [d.maxLimit, 'Maximum page size']]) {
      const block = document.createElement('div'); block.append(text('strong', value), text('span', label, 'muted')); $('stats').append(block);
    }
    $('snapshot').textContent = 'Snapshot · ' + d.snapshot;
    $('resource').textContent = schema.resource ? 'Public request examples target ' + schema.resource + ' (not contacted).' : 'No public resource configured. Query preparation and exports remain available.';
    renderControls(); status('Ready. Select fields, add filters and preview a query.'); buttons();
  } catch (error) { status(error.message, true); }
})();
