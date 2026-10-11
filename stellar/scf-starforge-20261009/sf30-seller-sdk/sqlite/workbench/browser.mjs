// MIT. No external resources. All source/preview values are rendered as text.
const $ = id => document.getElementById(id);
let draft, revision, selected = -1, dirty = false, busy = false, tableColumns = [];
const storageKey = 'sf30-sqlite-workbench-token';
if (/^[a-f0-9]{64}$/.test(location.hash.slice(1))) {
  sessionStorage.setItem(storageKey, location.hash.slice(1));
  history.replaceState(null, '', location.pathname);
}
const token = sessionStorage.getItem(storageKey) ?? '';
const formatted = value => JSON.stringify(value, null, 2);
const controls = () => [...document.querySelectorAll('button,input,select,textarea')];
function notice(message, error = false) { $('notice').textContent = message; $('notice').dataset.error = String(error); }
function markDirty() { if (!draft) return; dirty = true; $('save-state').textContent = 'Unsaved changes'; $('review-result').replaceChildren(); }
async function api(path, data) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + token, ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message + (result.field ? ` (${result.field})` : ''));
  return result;
}
async function run(task) {
  if (busy) return;
  busy = true; controls().forEach(control => { control.disabled = true; });
  try { await task(); } catch (error) { notice(error.message, true); }
  finally { busy = false; controls().forEach(control => { control.disabled = false; }); }
}
function readJSON(id, label) {
  try { const value = JSON.parse($(id).value); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { throw new Error(label + ' must be a valid JSON object.'); }
}
function capture() {
  draft.merchant = { name: $('merchant-name').value, origin: $('merchant-origin').value,
    network: $('merchant-network').value, asset: $('merchant-asset').value, payTo: $('merchant-payto').value,
    maxTimeoutSeconds: Number($('merchant-timeout').value) };
  if (selected < 0) return;
  draft.queries[selected] = { name: $('query-name').value, path: $('query-path').value, method: $('query-method').value,
    amount: $('query-amount').value, description: $('query-description').value, sql: $('query-sql').value,
    columns: $('query-columns').value.split(',').map(text => text.trim()).filter(Boolean),
    parameters: readJSON('query-parameters', 'Parameter declaration'), publicInput: readJSON('query-public', 'Public example'),
    maxRows: Number($('query-rows').value), maxBytes: Number($('query-bytes').value), timeoutMs: Number($('query-timeout').value) };
}
function renderNav() {
  $('query-list').replaceChildren();
  draft.queries.forEach((query, index) => {
    const button = document.createElement('button'); button.textContent = `${query.method || 'GET'} ${query.path || '(route not set)'}`;
    button.title = query.name || 'Unnamed query'; button.setAttribute('aria-current', String(index === selected));
    button.addEventListener('click', () => run(async () => { capture(); selected = index; renderEditor(); renderNav(); }));
    $('query-list').append(button);
  });
  $('query-count').textContent = `${draft.queries.length} of 64 routes configured`;
}
function renderEditor() {
  const query = draft.queries[selected];
  $('query-editor').hidden = !query; $('preview-section').hidden = !query;
  if (!query) return;
  $('query-heading').textContent = query.name || 'New query';
  for (const [id, key] of [['name', 'name'], ['path', 'path'], ['method', 'method'], ['amount', 'amount'],
    ['description', 'description'], ['sql', 'sql'], ['rows', 'maxRows'], ['bytes', 'maxBytes'], ['timeout', 'timeoutMs']]) $('query-' + id).value = query[key] ?? '';
  $('query-columns').value = (query.columns ?? []).join(', ');
  $('query-parameters').value = formatted(query.parameters ?? {}); $('query-public').value = formatted(query.publicInput ?? {});
  $('preview-input').value = '{}'; $('preview-summary').textContent = 'No rows fetched for this selection.';
  $('preview-result').replaceChildren();
}
function renderExports(entries) {
  $('exports').replaceChildren();
  if (!entries.length) { $('exports').textContent = 'No exported releases.'; return; }
  for (const entry of entries) {
    const details = document.createElement('details'), summary = document.createElement('summary'), command = document.createElement('pre');
    summary.textContent = entry.name; command.textContent = entry.command; details.append(summary, command); $('exports').append(details);
  }
}
function applyState(state) {
  draft = state.draft; revision = state.revision; dirty = false;
  selected = draft.queries.length ? 0 : -1;
  $('database').textContent = `${state.databaseName} · private local workspace`;
  $('save-state').textContent = 'Saved';
  for (const [id, key] of [['name', 'name'], ['origin', 'origin'], ['network', 'network'], ['asset', 'asset'], ['payto', 'payTo'], ['timeout', 'maxTimeoutSeconds']]) $('merchant-' + id).value = draft.merchant[key] ?? '';
  renderNav(); renderEditor(); renderExports(state.exports);
}
async function save() {
  capture();
  const state = await api('/api/save', { draft, revision });
  revision = state.revision; dirty = false; $('save-state').textContent = 'Saved'; renderExports(state.exports); renderNav();
}
function uniqueName(base) {
  let name = base.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]/, '_').slice(0, 55) || 'query';
  if (['__proto__', 'prototype', 'constructor'].includes(name)) name = 'query';
  const names = new Set(draft.queries.map(query => query.name));
  const root = name; let suffix = 2; while (names.has(name)) name = `${root}_${suffix++}`;
  return name;
}
function addQuery(query = {}) {
  if (draft.queries.length >= 64) throw new Error('The original seller accepts at most 64 configured routes.');
  capture(); const name = query.name ?? uniqueName('query');
  draft.queries.push({ name, path: '/' + name, method: 'GET', amount: '', description: 'Read-only selected database fields.',
    sql: '', columns: [], parameters: {}, publicInput: {}, maxRows: 100, maxBytes: 524288, timeoutMs: 1500, ...query });
  selected = draft.queries.length - 1; markDirty(); renderNav(); renderEditor();
}
function renderTable(target, columns, rows) {
  target.replaceChildren(); const table = document.createElement('table'), head = document.createElement('thead'), header = document.createElement('tr');
  columns.forEach(column => { const th = document.createElement('th'); th.textContent = column; th.scope = 'col'; header.append(th); });
  head.append(header); table.append(head); const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const column of columns) {
      const td = document.createElement('td'), value = row[column];
      td.textContent = value === null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
      td.title = td.textContent; tr.append(td);
    }
    body.append(tr);
  }
  table.append(body); target.append(table);
}
$('table').addEventListener('change', () => run(async () => {
  $('columns').replaceChildren(); tableColumns = [];
  if (!$('table').value) return;
  const result = await api('/api/schema?table=' + encodeURIComponent($('table').value));
  tableColumns = result.columns;
  result.columns.forEach((column, index) => {
    const label = document.createElement('label'), input = document.createElement('input'), title = document.createElement('span'), type = document.createElement('small');
    input.type = 'checkbox'; input.value = String(index); title.textContent = column.name; type.textContent = column.type || 'untyped';
    label.append(input, title, type); $('columns').append(label);
  });
  notice(result.truncated ? 'Column list truncated at 1,000. Author the SQL and aliases explicitly for other columns.' : 'Schema loaded. Select the fields this API should expose; no rows were read.');
}));
$('from-table').addEventListener('click', () => run(async () => {
  const columns = [...$('columns').querySelectorAll('input:checked')].map(input => tableColumns[Number(input.value)]);
  if (!columns.length) throw new Error('Select at least one database column.');
  if (columns.length > 64) throw new Error('The original source accepts at most 64 output aliases.');
  const table = $('table').value, aliases = new Set();
  const identifier = text => '"' + text.replaceAll('"', '""') + '"';
  const projections = columns.map((column, index) => {
    let alias = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(column.name) ? column.name : `column_${index + 1}`;
    const baseAlias = alias; let suffix = 2;
    while (aliases.has(alias)) alias = baseAlias.slice(0, 58) + '_' + suffix++;
    aliases.add(alias); return identifier(column.name) + (alias === column.name ? '' : ' AS ' + identifier(alias));
  });
  addQuery({ name: uniqueName(table), path: '/' + uniqueName(table), sql: 'SELECT ' + projections.join(', ') + '\nFROM ' + identifier(table), columns: [...aliases] });
  notice('Query added. Review its projection, public inputs and price before exporting.');
}));
$('add-query').addEventListener('click', () => run(async () => { addQuery(); notice('New query added to the draft.'); }));
$('remove-query').addEventListener('click', () => run(async () => {
  if (selected < 0 || !confirm('Remove this query from the draft? Existing releases and the database are unchanged.')) return;
  draft.queries.splice(selected, 1); selected = draft.queries.length ? Math.min(selected, draft.queries.length - 1) : -1;
  markDirty(); renderNav(); renderEditor();
}));
$('save').addEventListener('click', () => run(async () => { await save(); notice('Draft saved privately. No service was deployed.'); }));
$('reload').addEventListener('click', () => run(async () => {
  if (dirty && !confirm('Discard unsaved browser edits and reload the saved draft?')) return;
  applyState(await api('/api/state')); notice('Saved draft restored.');
}));
$('preview').addEventListener('click', () => run(async () => {
  capture(); const input = readJSON('preview-input', 'Private preview input');
  $('preview-summary').textContent = 'Reading through the original SQLite source…';
  try {
    const result = await api('/api/preview', { query: draft.queries[selected], input });
    renderTable($('preview-result'), result.columns, result.rows);
    $('preview-summary').textContent = `${result.rowCount} rows · ${result.truncated ? 'more rows exist; use an explicit cursor/filter' : 'result complete'} · INTEGER values remain exact strings`;
    notice('Local preview completed. Rows and private input were not saved or exported.');
  } catch (error) { $('preview-summary').textContent = 'Preview failed; no new result was delivered.'; $('preview-result').replaceChildren(); throw error; }
}));
$('inspect').addEventListener('click', () => run(async () => {
  capture(); const result = await api('/api/inspect', { draft });
  renderTable($('review-result'), ['method', 'route', 'atomic amount', 'network', 'output aliases'], result.service.routes.map(route => ({
    method: route.definition.method, route: route.path, 'atomic amount': route.definition.payment.amount,
    network: route.definition.payment.network, 'output aliases': route.definition.outputExample.columns.join(', '),
  })));
  notice('Every query prepared and public offer compiled using the original engines. No ownership or settlement claim is implied.');
}));
$('export').addEventListener('click', () => run(async () => {
  const name = $('export-name').value;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw new Error('Choose a new release name using letters, digits, hyphens or underscores.');
  await save(); const result = await api('/api/export', { name, revision });
  $('export-result').textContent = `${result.directory}\n\n${result.command}\n\n${result.files.join(' · ')}\n\nStarts the original seller in CHALLENGE_ONLY mode. Use its --facilitator option for an operator-configured native payment setup. The database was not copied.`;
  renderExports((await api('/api/state')).exports); notice('Private release exported. Existing releases are unchanged.');
}));
for (const control of document.querySelectorAll('#query-editor input,#query-editor select,#query-editor textarea,.workspace section:first-child input,.workspace section:first-child select')) control.addEventListener('input', markDirty);
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
await run(async () => {
  if (!token) throw new Error('Open the private launch URL printed in the terminal. Its fragment grants access only to this local workbench session.');
  applyState(await api('/api/state'));
  const schema = await api('/api/schema');
  for (const table of schema.tables) { const option = document.createElement('option'); option.value = table.name; option.textContent = `${table.name} (${table.type})`; $('table').append(option); }
  notice(schema.truncated ? 'Schema contains more than 512 entries. Use explicit SQL for unlisted tables.' : 'Workspace ready. Choose a table to begin or resume a saved query.');
});
