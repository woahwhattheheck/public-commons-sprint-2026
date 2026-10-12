// MIT. Industrial owner workspace; every native operation remains in the original source.
const $ = id => document.getElementById(id);
const tokenKey = 'starforge.mssql.workspace.capability';
if (/^#[a-f0-9]{64}$/.test(location.hash)) { sessionStorage.setItem(tokenKey, location.hash.slice(1)); history.replaceState(null, '', location.pathname); }
const token = sessionStorage.getItem(tokenKey) ?? '';
const state = { relation: null, endpoints: [], filters: [], orders: [], payments: [], editing: null,
  review: null, selected: null, runtime: null, page: 0, busy: false, preview: null, previewPage: 0, endpointDirty: false };
const errors = {
  SOURCE_SCHEMA_CHANGED: 'The table schema changed. Reopen each affected endpoint, review its fields and save the updated choices.',
  SOURCE_PROFILE_CHANGED: 'The private source profile changed. Refresh the database tables and review a new release.',
  REVIEW_CURRENT_CHOICES_REQUIRED: 'Review this release again; the previous review expired or its choices changed.',
  RELEASE_ID_ALREADY_USED: 'This release ID already belongs to another prepared plan. Choose a new release ID.',
  RELEASE_CHANGED: 'The selected prepared files changed. Reopen and inspect the release before continuing.',
  WORKSPACE_CAPABILITY_REQUIRED: 'Open the complete workspace URL printed by the launching terminal.',
  DECIMAL_SCALE_EXCEEDED: 'The example has more fractional digits than this database field can store exactly.',
  DECIMAL_INTEGER_DIGITS_EXCEEDED: 'The example exceeds this database field’s integer precision.',
  STOP_CURRENT_MERCHANT_BEFORE_START: 'Stop the current merchant before starting another release.',
  MERCHANT_RUN_CHANGED: 'The active merchant changed. Refresh its current runtime before stopping it.',
  MSSQL_RELEASE_PREPARATION_ACTIVE: 'Another workspace process is preparing this release. Refresh its saved result before preparing again.',
};
function node(tag, attrs = {}, children = []) {
  const result = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) result.addEventListener(key.slice(2), value);
    else if (key === 'className') result.className = value;
    else if (key in result) result[key] = value;
    else result.setAttribute(key, value);
  }
  for (const child of children) result.append(child?.nodeType ? child : document.createTextNode(String(child)));
  return result;
}
const option = (value, label = value) => node('option', { value, textContent: label });
const button = (label, action, className = 'small') => node('button', { type: 'button', textContent: label, className, onclick: action });
function notice(text, kind = '') { $('status').textContent = text; $('status').className = 'status ' + kind; }
async function api(path, value) {
  const response = await fetch(path, { headers: { 'x-workspace-token': token,
    ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(value === undefined ? {} : { method: 'POST', body: JSON.stringify(value) }) });
  const result = await response.json();
  if (!response.ok) throw new Error((result.field ? result.field + ': ' : '') + (errors[result.error] ?? result.detail ?? result.error));
  return result;
}
async function work(label, action) {
  if (state.busy) return;
  state.busy = true; $('main').inert = true; $('main').classList.add('busy'); notice(label, 'working');
  try { await action(); }
  catch (error) { notice(error.message || 'The workspace connection was interrupted.', 'error'); }
  finally { state.busy = false; $('main').inert = false; $('main').classList.remove('busy'); renderRuntime(); }
}
function invalidateReview() {
  state.review = null; $('review-panel').hidden = true; $('confirm-review').checked = false; $('prepare-release').disabled = true;
}
function endpointChanged() { state.endpointDirty = true; invalidateReview(); }
function setView(name) {
  const saved = name === 'saved'; $('build-view').hidden = saved; $('saved-view').hidden = !saved;
  for (const [id, selected] of [['build-tab', !saved], ['saved-tab', saved]]) {
    $(id).classList.toggle('selected', selected); $(id).setAttribute('aria-selected', String(selected));
  }
}
function choices() {
  if (state.endpointDirty) throw new Error('Save the current endpoint changes before reviewing the release, or choose New endpoint to clear its unfinished form.');
  if (!$('terms-form').reportValidity()) throw new Error('Complete the release and payment fields.');
  if (!state.endpoints.length) throw new Error('Add at least one endpoint to the release.');
  const paymentOptions = state.payments.map(payment => {
    let extra;
    if (payment.extraText.trim()) { try { extra = JSON.parse(payment.extraText); } catch { throw new Error('Payment extra must be valid JSON.'); } }
    return { scheme: 'exact', network: payment.network, asset: payment.asset, payTo: payment.payTo,
      amount: payment.amount, maxTimeoutSeconds: Number(payment.maxTimeoutSeconds), ...(extra === undefined ? {} : { extra }) };
  });
  return { schema: 'stellar-forge.mssql-workspace-plan.v1', releaseId: $('release-id').value,
    label: $('release-label').value, publicOrigin: $('public-origin').value,
    paymentOptions, endpoints: structuredClone(state.endpoints) };
}
const filterable = () => state.relation?.columns.filter(column => column.filterType) ?? [];
function columnOptions(select, selected, columns = filterable()) {
  select.replaceChildren(...columns.map(column => option(column.name, column.name + ' · ' + column.dataType)));
  if (columns.some(column => column.name === selected)) select.value = selected;
}
const orderable = () => {
  const selected = new Set([...$('column-rows').querySelectorAll('input:checked')].map(input => input.value));
  return filterable().filter(column => selected.has(column.name));
};
function renderOrders() {
  const columns = orderable();
  state.orders = state.orders.filter(order => columns.some(column => column.name === order.column));
  if (!state.orders.length && columns.length) {
    const first = columns.find(column => column.keyKind === 'PRI') ?? columns[0];
    state.orders.push({ column: first.name, direction: 'ASC' });
  }
  $('order-rows').replaceChildren(...state.orders.map((order, index) => {
    const field = node('select', { 'aria-label': 'Order field ' + (index + 1), onchange: event => { order.column = event.target.value; endpointChanged(); renderOrders(); } });
    columnOptions(field, order.column, columns.filter(column => column.name === order.column || !state.orders.some(other => other.column === column.name)));
    const direction = node('select', { 'aria-label': 'Order direction ' + (index + 1), onchange: event => { order.direction = event.target.value; endpointChanged(); } }, [option('ASC'), option('DESC')]);
    direction.value = order.direction;
    return node('div', { className: 'order-row' }, [field, direction, button('Remove', () => { state.orders.splice(index, 1); endpointChanged(); renderOrders(); })]);
  }));
  $('add-order').disabled = columns.length <= state.orders.length || state.orders.length >= 4;
}
function renderFilters() {
  $('filter-rows').replaceChildren(...state.filters.map((filter, index) => {
    const column = state.relation.columns.find(item => item.name === filter.column), type = column.filterType;
    const choose = node('select', { 'aria-label': 'Filter field ' + (index + 1), onchange: event => {
      filter.column = event.target.value; filter.operator = 'eq'; filter.description = 'Match ' + filter.column + '.';
      invalidateReview(); renderFilters();
    } }); columnOptions(choose, filter.column);
    const ops = { eq: 'Equal', ne: 'Not equal', gt: 'Greater than', gte: 'At least', lt: 'Less than', lte: 'At most', ...(type.prefix ? { prefix: 'Literal prefix' } : {}) };
    const operator = node('select', { 'aria-label': 'Filter operator ' + (index + 1), onchange: event => { filter.operator = event.target.value; invalidateReview(); } }, Object.entries(ops).map(([value, label]) => option(value, label)));
    operator.value = filter.operator;
    const field = (label, key, attrs = {}) => node('label', {}, [label, node('input', { value: filter[key],
      oninput: event => { filter[key] = event.target.value; invalidateReview(); }, ...attrs })]);
    return node('div', { className: 'filter-card' }, [
      node('div', { className: 'section-heading' }, [node('h3', { textContent: 'Filter ' + (index + 1) }), button('Remove', () => { state.filters.splice(index, 1); endpointChanged(); renderFilters(); })]),
      node('div', { className: 'grid-3' }, [node('label', {}, ['Database field', choose]), field('Parameter name', 'name', { required: true, pattern: '[A-Za-z_][A-Za-z0-9_]{0,63}', maxLength: 64 }), node('label', {}, ['Comparison', operator])]),
      node('p', { className: 'hint', textContent: type.kind + (type.spec.maxScale !== undefined ? ' · scale ≤ ' + type.spec.maxScale + ' · integer digits ≤ ' + type.spec.maxIntegerDigits : '') }),
      node('div', { className: 'grid-2' }, [field('Example value (preserved as text)', 'example', { maxLength: type.spec.type === 'string' ? type.spec.maxLength : 128 }), field('Public parameter description', 'description', { required: true, maxLength: 240 })]),
      node('label', { className: 'check-row' }, [node('input', { type: 'checkbox', checked: filter.optional,
        onchange: event => { filter.optional = event.target.checked; if (!filter.optional) filter.includeExample = true; invalidateReview(); renderFilters(); } }), 'Optional; omission leaves this condition unrestricted']),
      node('label', { className: 'check-row' }, [node('input', { type: 'checkbox', checked: filter.includeExample, disabled: !filter.optional,
        onchange: event => { filter.includeExample = event.target.checked; invalidateReview(); } }), 'Include this value in the public example']),
    ]);
  }));
  $('add-filter').disabled = !filterable().length || state.filters.length >= 16;
}
function renderColumns(selected = []) {
  const wanted = new Set(selected);
  $('column-rows').replaceChildren(...state.relation.columns.map(column => node('tr', {}, [
    node('td', {}, [node('input', { type: 'checkbox', checked: wanted.has(column.name), value: column.name,
      'aria-label': 'Include ' + column.name, onchange: () => { endpointChanged(); renderOrders(); } })]),
    node('td', {}, [node('span', { className: 'field-name mono', textContent: column.name }),
      node('span', { className: 'field-meta', textContent: [column.keyKind === 'PRI' ? 'Primary key' : column.keyKind,
        column.nullable === 'YES' ? 'Nullable' : 'Required'].filter(Boolean).join(' · ') })]),
    node('td', {}, [node('span', { className: 'field-name', textContent: column.columnType }),
      node('span', { className: 'field-meta', textContent: column.filterType?.kind ?? 'Projection only' })]),
  ])));
}
async function loadTable(name, endpoint) {
  if (!name) return;
  const relation = await api('/api/table?name=' + encodeURIComponent(name)); state.relation = relation;
  $('table-select').value = name; renderColumns(endpoint?.columns ?? []);
  const orderColumns = filterable(), suggested = orderColumns.find(column => column.keyKind === 'PRI') ?? orderColumns[0];
  state.orders = endpoint ? endpoint.orderBy.filter(order => orderColumns.some(column => column.name === order.column)).map(order => ({ ...order }))
    : suggested ? [{ column: suggested.name, direction: 'ASC' }] : [];
  state.filters = (endpoint?.filters ?? []).filter(filter => orderColumns.some(column => column.name === filter.column)).map(filter => ({ ...filter,
    includeExample: Object.hasOwn(filter, 'example'), example: filter.example === undefined ? '' : String(filter.example) }));
  $('schema-summary').textContent = relation.columns.length + ' actual fields · ' + relation.serverVersion;
  if (!endpoint && !$('endpoint-description').value) $('endpoint-description').value = 'Selected ' + name + ' data from the merchant database.';
  renderOrders(); renderFilters(); invalidateReview(); state.endpointDirty = !endpoint || endpoint.fingerprint !== relation.fingerprint;
  notice(endpoint && endpoint.fingerprint !== relation.fingerprint ? 'This table schema has changed. Inspect the current fields and filters, then save the updated endpoint.' : 'Loaded the actual schema for ' + name + '.');
}
async function refreshCatalog() {
  const catalog = await api('/api/catalog');
  $('table-select').replaceChildren(option('', 'Choose a table…'), ...catalog.tables.map(table => option(table.name, table.name + (table.type === 'VIEW' ? ' · view' : ''))));
  if (state.relation && catalog.tables.some(table => table.name === state.relation.table)) $('table-select').value = state.relation.table;
  notice(catalog.tables.length + ' database tables and views loaded.' + (catalog.truncated ? ' The native catalog returned its first 1,000 entries.' : ''));
}
function collectEndpoint() {
  if (!state.relation) throw new Error('Choose a database table before adding an endpoint.');
  if (!$('endpoint-form').reportValidity()) throw new Error('Complete the endpoint fields.');
  const columns = [...$('column-rows').querySelectorAll('input:checked')].map(input => input.value);
  if (!columns.length || columns.length > 64) throw new Error('Select between 1 and 64 output fields.');
  if (!state.orders.length) throw new Error('Choose at least one ordering field.');
  return { id: $('endpoint-id').value, table: state.relation.table, fingerprint: state.relation.fingerprint, columns,
    orderBy: structuredClone(state.orders), filters: state.filters.map(filter => ({ column: filter.column, name: filter.name,
      operator: filter.operator, optional: filter.optional, ...(filter.includeExample || !filter.optional ? { example: filter.example } : {}), description: filter.description })),
    path: $('route-path').value, method: $('route-method').value, serviceName: $('service-name').value, description: $('endpoint-description').value,
    maxRows: Number($('max-rows').value), maxBytes: Number($('max-bytes').value), timeoutMs: Number($('timeout-ms').value) };
}
function renderEndpoints() {
  $('endpoint-count').textContent = state.endpoints.length + ' endpoint' + (state.endpoints.length === 1 ? '' : 's');
  $('endpoint-empty').hidden = state.endpoints.length > 0;
  $('endpoint-rows').replaceChildren(...state.endpoints.map(endpoint => node('tr', {}, [
    node('td', { className: 'mono', textContent: endpoint.id }), node('td', { textContent: endpoint.method + ' ' + endpoint.path }),
    node('td', { textContent: endpoint.table }), node('td', { textContent: endpoint.columns.length + ' / ' + endpoint.filters.length }),
    node('td', {}, [node('div', { className: 'inline-actions' }, [button('Edit', () => work('Opening the current database schema…', async () => {
      state.editing = endpoint.id;
      for (const [id, key] of [['endpoint-id', 'id'], ['service-name', 'serviceName'], ['route-path', 'path'], ['route-method', 'method'], ['endpoint-description', 'description'],
        ['max-rows', 'maxRows'], ['max-bytes', 'maxBytes'], ['timeout-ms', 'timeoutMs']]) $(id).value = endpoint[key];
      await loadTable(endpoint.table, endpoint); $('save-endpoint').textContent = 'Save endpoint changes'; $('endpoint-title').scrollIntoView({ block: 'start' });
    })), button('Remove', () => { state.endpoints = state.endpoints.filter(item => item !== endpoint); invalidateReview(); renderEndpoints(); })])]),
  ])));
}
function renderPayments() {
  $('payment-rows').replaceChildren(...state.payments.map((payment, index) => {
    const field = (label, key, attrs = {}) => node('label', {}, [label, node('input', { required: true, value: payment[key],
      oninput: event => { payment[key] = event.target.value; invalidateReview(); }, ...attrs })]);
    const heading = node('div', { className: 'section-heading' }, [node('h3', { textContent: 'Option ' + (index + 1) + ' · exact' })]);
    if (state.payments.length > 1) heading.append(button('Remove', () => { state.payments.splice(index, 1); invalidateReview(); renderPayments(); }));
    return node('div', { className: 'payment-card' }, [heading,
      node('div', { className: 'grid-3' }, [field('Network', 'network', { maxLength: 128 }), field('Amount in atomic units', 'amount', { inputMode: 'numeric', pattern: '[1-9][0-9]*', maxLength: 39 }), field('Payment timeout (seconds)', 'maxTimeoutSeconds', { type: 'number', min: 1, max: 86400, step: 1 })]),
      node('div', { className: 'grid-2' }, [field('Asset identifier', 'asset', { maxLength: 1024 }), field('Recipient identifier', 'payTo', { maxLength: 1024 })]),
      node('details', {}, [node('summary', { textContent: 'Additional native payment terms' }), node('label', {}, ['Extra terms as JSON (optional)', node('textarea', { rows: 2, value: payment.extraText, maxLength: 4096,
        oninput: event => { payment.extraText = event.target.value; invalidateReview(); } })])]),
    ]);
  }));
  $('add-payment').disabled = state.payments.length >= 8;
}
function renderReview() {
  const review = state.review;
  $('review-panel').hidden = !review; if (!review) return;
  $('review-summary').textContent = review.label + ' · ' + review.endpoints.length + ' endpoints · ' + review.merchantPlan.publicOrigin;
  $('review-expiry').textContent = 'Review expires ' + new Date(review.expiresAt).toLocaleTimeString();
  $('review-contract').textContent = JSON.stringify({ merchantPlan: review.merchantPlan, publicContract: review.publicContract }, null, 2);
  $('review-endpoints').replaceChildren(...review.endpoints.map(endpoint => node('article', { className: 'review-endpoint' }, [
    node('div', { className: 'section-heading' }, [node('h3', { textContent: endpoint.route.method + ' ' + endpoint.route.path }),
      button('Preview approved example', () => work('Running the original private query against the database…', async () => {
        state.preview = await api('/api/preview', { reviewId: review.reviewId, planId: review.planId, endpointId: endpoint.route.id });
        state.previewPage = 0; renderPreview(); $('preview-panel').scrollIntoView({ block: 'start' }); notice('The original source returned the private operator example.');
      }))]),
    node('p', { textContent: endpoint.query.columns.length + ' output fields · at most ' + endpoint.query.maxRows + ' rows · ' + endpoint.query.maxBytes + ' bytes · ' + endpoint.query.timeoutMs + ' ms' }),
    node('pre', { textContent: endpoint.query.sql }),
    node('details', {}, [node('summary', { textContent: 'Typed parameters, examples and field mapping' }), node('pre', { textContent: JSON.stringify({ parameters: endpoint.query.parameters,
      example: endpoint.route.example, mapping: endpoint.mapping, ordering: endpoint.ordering }, null, 2) })]),
  ])));
  $('confirm-review').checked = false; $('prepare-release').disabled = true;
}
function renderPreview() {
  const preview = state.preview; if (!preview) return;
  $('preview-panel').hidden = false;
  const { result } = preview, rows = result.rows.slice(state.previewPage * 50, (state.previewPage + 1) * 50);
  const columns = result.columns ?? Object.keys(result.rows[0] ?? {});
  $('preview-summary').textContent = preview.endpointId + ' · ' + result.rowCount + ' rows' + (result.truncated ? ' · additional source rows exist' : '') + ' · original SQL Server result';
  const names = columns.map(column => typeof column === 'string' ? column : column.name);
  $('preview-table').replaceChildren(node('table', {}, [node('thead', {}, [node('tr', {}, names.map(name => node('th', { textContent: name })))]),
    node('tbody', {}, rows.map(row => node('tr', {}, names.map(name => node('td', { className: 'preview-value mono', textContent: row[name] === null ? 'null' : typeof row[name] === 'object' ? JSON.stringify(row[name]) : String(row[name]) })))))]));
  $('preview-previous').disabled = state.previewPage === 0; $('preview-next').disabled = (state.previewPage + 1) * 50 >= result.rows.length;
  $('preview-page').textContent = rows.length ? (state.previewPage * 50 + 1) + '–' + (state.previewPage * 50 + rows.length) + ' of ' + result.rows.length : '0 rows';
}
function renderRuntime() {
  const runtime = state.runtime;
  $('runtime-summary').textContent = runtime ? runtime.releaseId + ' · ' + runtime.status + ' · ' + runtime.mode + ' · ' + runtime.url : 'No merchant running.';
  $('runtime-links').replaceChildren(...(runtime ? [['docs', 'API docs'], ['openapi', 'OpenAPI'], ['operations', 'Operations'], ['availability', 'Availability'], ['availabilityControl', 'Pause / resume']]
    .filter(([key]) => runtime[key]).map(([key, label]) => node('a', { href: runtime[key], target: '_blank', rel: 'noreferrer', textContent: label })) : []));
  $('stop-merchant').disabled = !runtime || runtime.status !== 'running';
  $('run-release').disabled = !state.selected || Boolean(runtime && runtime.releaseId !== state.selected.releaseId);
  $('run-release').textContent = runtime?.releaseId === state.selected?.releaseId ? 'Merchant is running' : 'Start merchant';
  if (runtime?.releaseId === state.selected?.releaseId && runtime) $('run-release').disabled = true;
}
function renderSelected() {
  const selected = state.selected; if (!selected) return;
  $('selected-title').textContent = selected.label;
  const facts = [['Release', selected.releaseId], ['Created', selected.createdAt], ['Private package', selected.directory],
    ['Manifest SHA256', selected.manifestSha256], ['Credential environment', selected.requiredEnvironment ?? 'No password environment configured']];
  $('selected-details').replaceChildren(node('dl', { className: 'facts' }, facts.flatMap(([name, value]) => [node('dt', { textContent: name }), node('dd', { className: 'mono', textContent: value })])),
    node('h3', { textContent: 'Original merchant routes' }), node('ul', {}, selected.routes.map(route => node('li', { textContent: route.method + ' ' + route.url + ' · ' + route.paymentOptions + ' payment option' + (route.paymentOptions === 1 ? '' : 's') }))),
    node('details', {}, [node('summary', { textContent: 'Verified prepared files' }), node('pre', { textContent: selected.files.map(file => file.name + ' · ' + file.bytes + ' bytes · ' + file.sha256).join('\n') })]),
    node('p', { className: 'hint', textContent: 'The customer archive contains the original JavaScript client, TypeScript declarations, package metadata, client guide and OpenAPI. Start this private release here or use the native SQL Server run command with the package directory.' }));
  $('selected-actions').hidden = false; renderRuntime();
}
async function openRelease(id) {
  state.selected = await api('/api/release?id=' + encodeURIComponent(id)); state.runtime = state.selected.runtime;
  renderSelected(); renderRuntime(); setView('saved');
  for (const item of $('release-list').children) item.classList.toggle('selected', item.dataset.releaseId === id);
  notice('Opened the original verified release ' + id + '.');
}
async function listReleases() {
  const page = await api('/api/releases?page=' + state.page); state.runtime = page.runtime;
  $('release-list').replaceChildren(...page.items.map(item => {
    const itemButton = button('', () => work('Verifying the original prepared release…', () => openRelease(item.releaseId)), 'release-item');
    itemButton.dataset.releaseId = item.releaseId; itemButton.classList.toggle('selected', item.releaseId === state.selected?.releaseId);
    itemButton.append(node('strong', { textContent: item.label ?? item.releaseId }), node('span', { textContent: item.error ?? item.releaseId + ' · ' + item.endpoints + ' endpoints · ' + new Date(item.createdAt).toLocaleString() }));
    return itemButton;
  }));
  if (!page.total) $('release-list').append(node('p', { className: 'muted', textContent: 'No private releases have been prepared yet.' }));
  $('release-page').textContent = page.total ? (page.page * 50 + 1) + '–' + (page.page * 50 + page.items.length) + ' of ' + page.total : '0 releases';
  $('release-previous').disabled = page.page === 0; $('release-next').disabled = !page.hasMore; renderRuntime();
}
function addPayment() { state.payments.push({ network: 'stellar:testnet', amount: '', asset: '', payTo: '', maxTimeoutSeconds: '60', extraText: '' }); invalidateReview(); renderPayments(); }

$('endpoint-form').addEventListener('input', endpointChanged); $('endpoint-form').addEventListener('change', endpointChanged);
$('terms-form').addEventListener('input', invalidateReview); $('terms-form').addEventListener('change', invalidateReview);
$('endpoint-form').addEventListener('submit', event => { event.preventDefault(); try {
  const endpoint = collectEndpoint();
  if (state.endpoints.some(item => item.id === endpoint.id && item.id !== state.editing)) throw new Error('Choose a unique endpoint ID.');
  if (!state.editing && state.endpoints.length >= 64) throw new Error('A release supports up to 64 endpoints.');
  const index = state.endpoints.findIndex(item => item.id === state.editing);
  if (index >= 0) state.endpoints[index] = endpoint; else state.endpoints.push(endpoint);
  state.editing = endpoint.id; state.endpointDirty = false; $('save-endpoint').textContent = 'Save endpoint changes'; invalidateReview(); renderEndpoints();
  notice('Saved ' + endpoint.method + ' ' + endpoint.path + ' in this release draft.');
} catch (error) { notice(error.message, 'error'); } });
$('new-endpoint').addEventListener('click', () => {
  state.editing = null; state.endpointDirty = false; $('endpoint-form').reset(); state.filters = []; state.orders = [];
  $('endpoint-id').value = 'query_' + (state.endpoints.length + 1); $('route-path').value = '/query-' + (state.endpoints.length + 1);
  $('save-endpoint').textContent = 'Add endpoint to release';
  if (state.relation) { renderColumns(); const column = filterable().find(item => item.keyKind === 'PRI') ?? filterable()[0]; if (column) state.orders.push({ column: column.name, direction: 'ASC' }); }
  renderOrders(); renderFilters(); invalidateReview(); notice('Configure the next endpoint, then add it to the release.');
});
$('refresh-catalog').addEventListener('click', () => work('Reading the actual database catalog…', refreshCatalog));
$('table-select').addEventListener('change', event => work('Reading the actual table fields…', () => loadTable(event.target.value)));
$('add-order').addEventListener('click', () => {
  const column = orderable().find(item => !state.orders.some(order => order.column === item.name));
  if (column && state.orders.length < 4) state.orders.push({ column: column.name, direction: 'ASC' }); endpointChanged(); renderOrders();
});
$('add-filter').addEventListener('click', () => {
  const column = filterable()[0]; if (!column || state.filters.length >= 16) return;
  state.filters.push({ column: column.name, name: 'filter_' + (state.filters.length + 1), operator: 'eq', optional: true,
    includeExample: false, example: '', description: 'Match ' + column.name + '.' }); endpointChanged(); renderFilters();
});
$('add-payment').addEventListener('click', addPayment);
$('terms-form').addEventListener('submit', event => { event.preventDefault(); work('Compiling current schema, typed inputs and original payment terms…', async () => {
  state.review = await api('/api/review', choices()); renderReview(); $('review-panel').scrollIntoView({ block: 'start' });
  notice('Review the fixed SQL, exact inputs, public contract and payment terms before preparation.');
}); });
$('confirm-review').addEventListener('change', () => { $('prepare-release').disabled = !state.review || !$('confirm-review').checked; });
$('prepare-release').addEventListener('click', () => work('Preparing the original private SQL Server package and customer client…', async () => {
  state.selected = await api('/api/prepare', { reviewId: state.review.reviewId, planId: state.review.planId });
  state.runtime = state.selected.runtime; await listReleases(); renderSelected(); setView('saved');
  notice((state.selected.reopened ? 'Reopened' : 'Prepared') + ' ' + state.selected.releaseId + ' with the original source, seller, operations contract and customer client.');
}));
$('build-tab').addEventListener('click', () => setView('build'));
$('saved-tab').addEventListener('click', () => work('Reading saved private releases…', async () => { await listReleases(); setView('saved'); notice('Choose a release to open or run.'); }));
$('refresh-releases').addEventListener('click', () => work('Refreshing prepared releases…', async () => { await listReleases(); notice('Prepared release list refreshed.'); }));
for (const [id, delta] of [['release-previous', -1], ['release-next', 1]]) $(id).addEventListener('click', () => work('Reading saved releases…', async () => { state.page += delta; await listReleases(); notice('Prepared release list refreshed.'); }));
for (const [id, delta] of [['preview-previous', -1], ['preview-next', 1]]) $(id).addEventListener('click', () => { state.previewPage += delta; renderPreview(); });
$('run-release').addEventListener('click', () => work('Starting the original merchant and operations controls…', async () => {
  state.runtime = await api('/api/run', { releaseId: state.selected.releaseId, manifestSha256: state.selected.manifestSha256 });
  renderRuntime(); notice('The original merchant is running at ' + state.runtime.url + '.');
}));
$('stop-merchant').addEventListener('click', () => work('Draining the original merchant and closing its database source…', async () => {
  await api('/api/stop', { runId: state.runtime.runId }); state.runtime = null; renderRuntime(); notice('Merchant stopped. Its prepared release and availability policy are saved.');
}));
$('export-client').addEventListener('click', () => work('Exporting the original verified customer client…', async () => {
  const result = await api('/api/export-client', { releaseId: state.selected.releaseId, manifestSha256: state.selected.manifestSha256 });
  const anchor = node('a', { href: result.download, download: result.filename }); document.body.append(anchor); anchor.click(); anchor.remove();
  notice('Customer client exported · ' + result.bytes + ' bytes · SHA256 ' + result.sha256);
}));
$('load-draft').addEventListener('click', () => {
  const choice = state.selected.choices; state.endpoints = structuredClone(choice.endpoints); state.editing = null; state.endpointDirty = false;
  $('release-id').value = choice.releaseId.slice(0, 59) + '_next'; $('release-label').value = choice.label; $('public-origin').value = choice.publicOrigin;
  state.payments = (choice.paymentOptions ?? [choice.payment]).map(payment => ({ ...payment,
    maxTimeoutSeconds: String(payment.maxTimeoutSeconds), extraText: payment.extra ? JSON.stringify(payment.extra, null, 2) : '' }));
  invalidateReview(); renderPayments(); renderEndpoints(); setView('build');
  notice('Loaded the release as a new draft. Edit an endpoint to refresh its current schema before reviewing changes.');
});

addPayment(); renderOrders(); renderFilters(); renderEndpoints();
await work('Opening the private SQL Server workspace…', async () => {
  const info = await api('/api/info'); state.runtime = info.runtime;
  $('profile').textContent = info.source.database + ' · ' + info.source.host + ' · ' + info.source.user + ' · ' + info.source.tls;
  $('mode').textContent = info.mode === 'CHALLENGE_ONLY' ? 'Challenge only' : 'Native facilitator'; renderRuntime();
  await refreshCatalog(); await listReleases();
  notice(info.mode === 'CHALLENGE_ONLY' ? 'Ready. A facilitator can be selected in the launcher for native paid execution. Build and inspect releases here.' : 'Ready. Build a release from the actual database schema and run the original native seller.');
});
setInterval(async () => {
  if (state.busy || document.hidden) return;
  try { const result = await api('/api/runtime'); state.runtime = result.runtime; renderRuntime(); }
  catch { /* Keep the current work visible; the next explicit action reports connection state. */ }
}, 5000);
