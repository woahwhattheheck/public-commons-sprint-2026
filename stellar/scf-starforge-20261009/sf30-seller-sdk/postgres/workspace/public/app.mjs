const byId = id => document.getElementById(id);
const state = { session: null, catalog: [], relation: null, filters: [], preview: null };
const element = (tag, text, props = {}) => Object.assign(document.createElement(tag), { textContent: text, ...props });
const notice = (message, error = false) => { byId('notice').textContent = message; byId('notice').dataset.error = String(error); };
function invalidated() { state.preview = null; byId('export').disabled = true; byId('review').hidden = true; byId('saved').hidden = true; }
async function api(path, body) {
  const response = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-workspace-token': state.session.token }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'WORKSPACE_UNAVAILABLE');
  return result;
}
function humanError(error) {
  const explanations = { SOURCE_SCHEMA_CHANGED: 'The database schema changed. Select the source again, review your choices, then export.',
    SELECT_1_TO_64_COLUMNS: 'Select at least one public result column (maximum 64).',
    SELECT_1_TO_4_SCALAR_ORDER_COLUMNS: 'Select one to four scalar columns for result ordering.',
    INVALID_PAYMENT_TERMS: 'Enter the asset, receiving account and a positive whole atomic-unit price.',
    CATALOG_UNAVAILABLE: 'The database metadata connection failed. Check the existing database role and connection environment.',
    CATALOG_TIMEOUT: 'Database metadata lookup timed out. Check connectivity and retry when ready.',
    CANONICAL_SELLER_DECLARATION_REJECTED: 'The original seller rejected these terms or metadata. Check the public origin, description and parameter count.',
    OUTPUT_COLUMN_ALIAS_COLLISION: 'Two selected database fields would use the same API alias. Change the selected columns.' };
  return explanations[error.message] ?? error.message.replaceAll('_', ' ').toLowerCase();
}
function renderSources() {
  const query = byId('find').value.toLowerCase();
  const shown = state.catalog.filter(row => `${row.schema}.${row.name}`.toLowerCase().includes(query));
  byId('source-count').textContent = `${shown.length} of ${state.catalog.length} sources`;
  byId('sources').replaceChildren(...shown.map(row => {
    const button = element('button', row.name, { type: 'button', className: state.relation?.id === row.id ? 'selected' : '' });
    button.append(element('span', `${row.schema} · ${kind(row.kind)}`));
    button.addEventListener('click', () => selectRelation(row.id)); return button;
  }));
}
const kind = value => ({ r: 'Table', p: 'Partitioned table', v: 'View', m: 'Materialized view' })[value] ?? value;
async function refresh() {
  byId('refresh').disabled = true;
  try {
    const result = await api(`/api/catalog?schema=${encodeURIComponent(byId('schema').value)}`);
    state.catalog = result.relations; renderSources();
    byId('connection-status').textContent = 'Database connected';
    notice(result.truncated ? 'Showing the first 500 sources. Enter a schema to narrow the list.' : 'Database metadata loaded. Select a source.');
  } catch (error) { byId('connection-status').textContent = 'Database unavailable'; notice(humanError(error), true); }
  finally { byId('refresh').disabled = false; }
}
async function selectRelation(id) {
  invalidated();
  try {
    state.relation = await api(`/api/relation?id=${encodeURIComponent(id)}`); state.filters = [];
    const relation = state.relation;
    byId('empty').hidden = true; byId('setup').hidden = false;
    byId('relation-title').textContent = `${relation.namespace}.${relation.name}`;
    byId('relation-kind').textContent = kind(relation.kind);
    const safe = relation.name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z]+/, '').slice(0, 44) || 'dataset';
    byId('query-name').value = safe; byId('route-path').value = `/data/${safe}`;
    byId('description').value = `${relation.name} data query`;
    byId('columns').replaceChildren(...relation.columns.map(column => {
      const checkbox = element('input', '', { type: 'checkbox', value: column.name });
      checkbox.setAttribute('aria-label', `Include ${column.name}`);
      checkbox.addEventListener('change', countSelection);
      const row = element('tr', ''), cell = element('td', ''); cell.append(checkbox);
      row.append(cell, element('td', column.name), element('td', column.sqlType), element('td', column.primaryKey ? 'Primary key' : ''));
      return row;
    }));
    byId('order').replaceChildren(...relation.columns.filter(column => column.filterType).map(column =>
      element('option', column.name, { value: column.name, selected: column.primaryKey })));
    renderFilters(); countSelection(); renderSources();
    notice('Select the public columns, optional filters and payment terms. The data itself stays in PostgreSQL.');
  } catch (error) { notice(humanError(error), true); }
}
function countSelection() {
  byId('selection-count').textContent = `${document.querySelectorAll('#columns input:checked').length} columns selected`;
  invalidated();
}
function renderFilters() {
  const columns = state.relation.columns.filter(column => column.filterType);
  byId('filters').replaceChildren(...state.filters.map((filter, index) => {
    const row = element('div', '', { className: 'filter-row' });
    const source = element('select', ''), operation = element('select', ''), name = element('input', '', { value: filter.name, maxLength: 48 });
    source.replaceChildren(...columns.map(column => element('option', column.name, { value: column.name, selected: column.name === filter.column })));
    const setOperators = () => {
      const type = columns.find(column => column.name === filter.column)?.filterType;
      const allowed = [['eq', 'Equals'], ...(type?.ordered ? [['min', 'At least'], ['max', 'At most']] : []), ...(type?.prefix ? [['prefix', 'Starts with']] : [])];
      if (!allowed.some(([value]) => value === filter.operator)) filter.operator = 'eq';
      operation.replaceChildren(...allowed.map(([value, label]) => element('option', label, { value, selected: value === filter.operator })));
    };
    setOperators();
    source.addEventListener('change', () => { filter.column = source.value; setOperators(); invalidated(); });
    operation.addEventListener('change', () => { filter.operator = operation.value; invalidated(); });
    name.addEventListener('input', () => { filter.name = name.value; invalidated(); });
    const remove = element('button', 'Remove', { type: 'button' });
    remove.addEventListener('click', () => { state.filters.splice(index, 1); renderFilters(); invalidated(); });
    for (const [title, control] of [['Column', source], ['Match', operation], ['Request parameter', name]]) {
      control.setAttribute('aria-label', title);
      const label = element('label', title); label.append(control); row.append(label);
    }
    row.append(remove); return row;
  }));
  byId('add-filter').disabled = !columns.length || state.filters.length >= 16;
}
function choices() {
  return { relationId: state.relation.id, fingerprint: state.relation.fingerprint,
    queryName: byId('query-name').value, routePath: byId('route-path').value,
    columns: [...document.querySelectorAll('#columns input:checked')].map(input => input.value),
    orderBy: [...byId('order').selectedOptions].map(option => option.value),
    filters: state.filters, maxRows: Number(byId('max-rows').value), timeoutMs: Number(byId('timeout').value),
    description: byId('description').value, publicOrigin: byId('public-origin').value,
    payment: { network: byId('network').value, amount: byId('amount').value, asset: byId('asset').value, payTo: byId('pay-to').value } };
}
byId('setup').addEventListener('input', invalidated);
byId('setup').addEventListener('change', invalidated);
byId('setup').addEventListener('submit', async event => {
  event.preventDefault(); byId('preview').disabled = true; byId('export').disabled = true;
  try {
    const result = await api('/api/preview', choices()); state.preview = result;
    byId('sql').textContent = result.sql;
    byId('source-json').textContent = JSON.stringify(result.source, null, 2);
    byId('seller-json').textContent = JSON.stringify(result.seller, null, 2);
    byId('run').textContent = result.run;
    byId('review-files').textContent = result.files.join(' · ');
    byId('review').hidden = false; byId('export').disabled = false;
    notice('Review the selected fields, fixed query and payment terms. Export when they match your intended API.');
    byId('review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { state.preview = null; notice(humanError(error), true); }
  finally { byId('preview').disabled = false; }
});
byId('export').addEventListener('click', async () => {
  if (!state.preview) return;
  byId('export').disabled = true;
  try {
    const result = await api('/api/export', { ...choices(), expectedPlanId: state.preview.planId });
    byId('saved-path').textContent = result.directory; byId('saved-run').textContent = result.run;
    byId('saved').hidden = false; notice('Merchant files exported to a new private directory.');
    byId('saved').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { notice(humanError(error), true); byId('export').disabled = false; }
});
byId('add-filter').addEventListener('click', () => {
  const column = state.relation.columns.find(column => column.filterType);
  if (!column || state.filters.length >= 16) return;
  state.filters.push({ column: column.name, operator: 'eq', name: `filter${state.filters.length + 1}` });
  invalidated(); renderFilters();
});
byId('find').addEventListener('input', renderSources);
byId('refresh').addEventListener('click', refresh);
try { state.session = await api('/api/session'); await refresh(); }
catch (error) { notice(humanError(error), true); }
