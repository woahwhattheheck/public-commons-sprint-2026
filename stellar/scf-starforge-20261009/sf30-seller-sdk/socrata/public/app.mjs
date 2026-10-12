// MIT. Browser operator for the original Socrata workspace.
import {createPublisherPanel} from "./publisher.mjs";
let publisherPanel;
const $ = id => document.getElementById(id);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => JSON.stringify(value, null, 2);
const text = value => value === null || value === undefined ? '—' : typeof value === 'object' ? json(value) : String(value);
const number = value => Number.isFinite(Number(value)) && value !== null && value !== undefined ? Number(value).toLocaleString('en-US') : '—';
const size = value => value === null || value === undefined ? '—' :
  Number(value) < 1024 ? number(value) + ' B' : Number(value) < 1048576 ?
    (Number(value) / 1024).toFixed(1) + ' KiB' : (Number(value) / 1048576).toFixed(2) + ' MiB';
const short = value => value ? String(value).slice(0, 16) : '—';
const storageKey = 'starforge-socrata-session:' + location.origin;
let token = location.hash.slice(1);
try {
  if (token) sessionStorage.setItem(storageKey, token);
  else token = sessionStorage.getItem(storageKey) || '';
} catch {}
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
let state = null, busy = false, needsRefresh = false, sessionExpired = false;
let sourceDirty = false, merchantDirty = false, mappingDirty = false, queryDirty = false;
let sourceSignature = '', merchantSignature = '', mappingSignature = '', activeSignature = '';
let mappingRows = [], mappingOrder = {}, conditions = [], lastQuery = null, nextCursor = null, queryResult = null;
let continueCapture = false, captureLoopActive = false, pauseRequested = false;
const node = (tag, content, className) => {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = text(content);
  if (className) element.className = className;
  return element;
};
const option = (value, label) => {
  const element = node('option', label);
  element.value = value;
  return element;
};
const status = () => String(state?.capture?.status || '').toLowerCase();
const emptyWorkspace = () => Boolean(state && !state.source && !state.capture &&
  !(state.editions || []).length && !state.mapping && !state.merchant);
const columns = () => state?.mapping?.columns || [];
const mappedNames = () => columns().map(column => column.name);
function notice(message, kind = 'success') {
  $('notice').textContent = message;
  $('notice').dataset.kind = kind;
  $('notice').hidden = !message;
}
function sessionMessage(message) {
  $('session-message').textContent = message;
  $('session-message').hidden = !message;
}
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {...options, cache: 'no-store',
      headers: {'Authorization': 'Bearer ' + token, ...(options.body ? {'Content-Type': 'application/json'} : {}), ...options.headers}});
  } catch (cause) {
    throw Object.assign(new Error('The response could not be read. Refresh the retained workspace state before another operation.'), {uncertain: true, cause});
  }
  let value;
  try { value = await response.json(); }
  catch { throw Object.assign(new Error('The server response was incomplete. Refresh the retained workspace state.'), {uncertain: true}); }
  if (!response.ok) {
    if (response.status === 401) {
      sessionExpired = true;
      sessionMessage(value.message || 'Reopen the session URL printed by the workspace command.');
    }
    throw Object.assign(new Error(value.message || value.error || ('Request failed: ' + response.status)),
      {code: value.error, status: response.status, details: value});
  }
  return value;
}
async function refresh({quiet = false} = {}) {
  try {
    state = await request('/api/state');
    needsRefresh = false; sessionExpired = false; sessionMessage('');
    render();
    if (!quiet) notice('Retained workspace state refreshed.');
    return state;
  } catch (error) {
    needsRefresh = true;
    $('connection-status').textContent = 'State unavailable';
    renderControls();
    if (!quiet) notice(error.message, 'error');
    throw error;
  }
}
async function perform(action, payload = {}, {quiet = false} = {}) {
  if (busy) throw new Error('Wait for the current operation to finish.');
  if (needsRefresh) throw new Error('Refresh the retained workspace state before another operation.');
  busy = true;
  $('connection-status').textContent = 'Working · ' + action;
  renderControls();
  try {
    const response = await request('/api/action', {method: 'POST', body: JSON.stringify({action, payload})});
    state = response.state || await request('/api/state');
    $('action-name').textContent = action;
    $('action-result').textContent = json(response.result ?? response);
    render();
    if (!quiet) notice(action + ' completed. The retained workspace is updated.');
    return response.result;
  } catch (error) {
    if (error.uncertain) needsRefresh = true;
    $('action-name').textContent = action;
    $('action-result').textContent = json(error.details || {error: error.code || 'REQUEST_FAILED', message: error.message});
    try { await refresh({quiet: true}); } catch {}
    notice(error.message + (error.uncertain ? '\nThe action was not automatically repeated.' : ''), 'error');
    error.reported = true;
    throw error;
  } finally {
    busy = false;
    if (pauseRequested && (status() !== 'running' || needsRefresh)) pauseRequested = false;
    $('connection-status').textContent = needsRefresh ? 'Refresh required' : sessionExpired ? 'Session expired' : 'Local workspace';
    renderCapture(); renderControls();
    if (pauseRequested && status() === 'running' && !needsRefresh) {
      pauseRequested = false;
      queueMicrotask(() => handle(() => perform('capture.pause', {})));
    }
  }
}
function handle(task) {
  Promise.resolve().then(task).catch(error => {
    if (!error.reported) notice(error.message || String(error), 'error');
  });
}
function bindForm(id, operation) {
  $(id).addEventListener('submit', event => { event.preventDefault(); handle(operation); });
}
function selectSection(name) {
  document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
  document.querySelectorAll('[data-section]').forEach(button => {
    if (button.dataset.section === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}
async function downloadPublisher(kind, id) {
  let response;
  try {
    response = await fetch('/api/publisher/exports/' + encodeURIComponent(kind) + '/' + encodeURIComponent(id),
      {headers:{Authorization:'Bearer ' + token},cache:'no-store'});
  } catch { throw new Error('The retained publisher download could not be read. Retry this file download.'); }
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw new Error(failure.message || failure.error || 'Export the retained customer delivery before downloading this file.');
  }
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const filename = encoded ? decodeURIComponent(encoded) : kind + '.json';
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),30000);
  notice('Downloaded retained publisher file: ' + filename);
}
publisherPanel = createPublisherPanel({getState:() => state,perform,download:downloadPublisher,handle,notice,selectSection});

function factList(entries) {
  const list = node('dl');
  for (const [label, value] of entries) list.append(node('dt', label), node('dd', value));
  return list;
}
function renderSource(force = false) {
  const signature = json(state.source);
  if (force || (signature !== sourceSignature && !sourceDirty)) {
    const source = state.source || {};
    $('source-domain').value = source.domain || '';
    $('source-id').value = source.datasetId || '';
    $('source-protocol').value = source.protocol || 'soda2.1';
    $('source-where').value = source.where || '';
    $('source-order').value = source.order || ':id';
    $('source-page-size').value = source.pageSize || 1000;
    if (!$('search-domain').value) $('search-domain').value = source.domain || '';
    sourceSignature = signature;
  }
  const metadata = state.metadata, summary = $('metadata-summary'), fields = $('metadata-fields');
  summary.replaceChildren(); fields.replaceChildren();
  if (!metadata) summary.append(node('p', 'Inspect a source to see its name, revision and fields.', 'muted'));
  else {
    summary.append(node('h3', metadata.name || state.source?.datasetId));
    if (metadata.description) summary.append(node('p', metadata.description));
    summary.append(factList([['Provider revision', metadata.revision], ['Declared fields', (metadata.columns || []).length]]));
    for (const column of metadata.columns || []) {
      const row = node('tr');
      row.append(node('td', column.fieldName, 'mono'), node('td', column.name), node('td', column.dataTypeName));
      fields.append(row);
    }
  }
  const source = state.source;
  const safeDomain = source && typeof source.domain === 'string' && /^[A-Za-z0-9.-]+$/.test(source.domain);
  const safeId = source && typeof source.datasetId === 'string' && /^[a-z0-9]{4}-[a-z0-9]{4}$/i.test(source.datasetId);
  $('provider-link').hidden = !(safeDomain && safeId);
  if (safeDomain && safeId) $('provider-link').href = 'https://' + source.domain + '/d/' + source.datasetId;
  const previous = $('mapping-source-column').value;
  $('mapping-source-column').replaceChildren();
  for (const column of metadata?.columns || [])
    $('mapping-source-column').append(option(column.fieldName, column.fieldName + ' · ' + column.dataTypeName));
  if (!(metadata?.columns || []).length) $('mapping-source-column').append(option('', 'Inspect a source first'));
  if ([...$('mapping-source-column').options].some(entry => entry.value === previous)) $('mapping-source-column').value = previous;
}
function renderCapture() {
  const capture = state.capture;
  $('capture-status').textContent = capture?.status || 'No capture';
  $('capture-rows').textContent = number(capture?.rowCount);
  $('capture-expected').textContent = number(capture?.expectedRows);
  $('capture-pages').textContent = number(capture?.pageCount);
  $('capture-bytes').textContent = size(capture?.byteCount);
  $('capture-description').replaceChildren(capture ? factList([
    ['Capture', capture.id], ['Next offset', capture.nextOffset],
    ['Source', state.source ? state.source.domain + ' / ' + state.source.datasetId : 'Retained source'],
    ['Order', state.source?.order], ['Where', state.source?.where || 'All matched rows']
  ]) : node('p', 'Save and inspect a source before starting a capture.', 'muted'));
  const progress = $('capture-progress');
  progress.hidden = !capture || !(Number(capture.expectedRows) > 0);
  if (!progress.hidden) { progress.max = Number(capture.expectedRows); progress.value = Number(capture.rowCount) || 0; }
  $('capture-error').hidden = !capture?.error;
  $('capture-error').textContent = capture?.error ? text(capture.error) : '';
  $('capture-details').textContent = capture ? json(capture) : 'No capture retained.';
  $('capture-loop-status').textContent = pauseRequested ? 'Pause requested. The current page will finish and remain retained.' :
    captureLoopActive ? 'Fetching provider pages one at a time. Pause stops the next page request.' :
    status() === 'completed' ? 'Capture complete. Review its fields and build a retained edition.' :
    status() === 'paused' ? 'Capture paused. Resume continues this same capture.' :
    status() === 'changed' ? 'The source revision changed during capture. Review the retained capture details before selecting a new capture.' :
    status() === 'running' ? 'Ready for the next page. Run the remaining pages or inspect one page at a time.' : '';
}
function applyMapping(mapping, {saved = false} = {}) {
  mapping = mapping || {};
  mappingOrder = Object.fromEntries(['idColumns', 'filters', 'ranges', 'sorts'].map(key => [key, [...(mapping[key] || [])]]));
  mappingRows = (mapping.columns || []).map(column => ({...column,
    nullable: Boolean(column.nullable), nullPolicy: column.nullPolicy || (column.nullable ? 'empty-is-null' : 'reject-null'),
    identity: (mapping.idColumns || []).includes(column.name),
    filter: (mapping.filters || []).includes(column.name),
    range: (mapping.ranges || []).includes(column.name),
    sort: (mapping.sorts || []).includes(column.name)
  }));
  $('mapping-name').value = mapping.name || state.metadata?.name || '';
  $('mapping-page-size').value = mapping.pageSize || 50;
  $('mapping-max-page-size').value = mapping.maxPageSize || 250;
  if (saved) mappingSignature = json(state.mapping);
  mappingDirty = !saved;
  renderMappingRows(); renderControls();
}
function loadMapping() { applyMapping(state.mapping || {}, {saved: true}); }
function markMapping() {
  mappingDirty = true;
  updateCapabilities();
  renderControls();
}
function cellControl(tag, field, rowIndex, value, options) {
  const control = document.createElement(tag);
  control.dataset.field = field;
  control.dataset.row = rowIndex;
  const name = mappingRows[rowIndex].source;
  control.setAttribute('aria-label', name + ' ' + field);
  if (tag === 'select') {
    for (const [key, label] of options) control.append(option(key, label));
    control.value = value;
  } else if (typeof value === 'boolean') { control.type = 'checkbox'; control.checked = value; }
  else { control.type = 'text'; control.value = value; control.required = true; control.spellcheck = false; }
  return control;
}
function renderMappingRows() {
  const body = $('mapping-columns'); body.replaceChildren();
  for (const [index, column] of mappingRows.entries()) {
    const row = node('tr');
    row.append(node('td', column.source, 'source-field mono'));
    const nameCell = node('td'); nameCell.append(cellControl('input', 'name', index, column.name)); row.append(nameCell);
    const typeCell = node('td'); const type = cellControl('select', 'type', index, column.type,
      [['string', 'String'], ['integer', 'Integer'], ['number', 'Number'], ['boolean', 'Boolean']]);
    type.className = 'row-type'; typeCell.append(type); row.append(typeCell);
    const policyCell = node('td'); const policy = cellControl('select', 'nullPolicy', index, column.nullPolicy,
      [['empty-is-null', 'Empty becomes null'], ['reject-null', 'Reject null'], ['literal-json', 'Literal JSON text']]);
    policy.className = 'row-null'; policyCell.append(policy); row.append(policyCell);
    for (const field of ['nullable', 'identity', 'filter', 'range', 'sort']) {
      const cell = node('td', undefined, 'check-cell');
      const control = cellControl('input', field, index, Boolean(column[field]));
      if (field === 'range' && column.type === 'boolean') control.disabled = true;
      cell.append(control); row.append(cell);
    }
    const removeCell = node('td'), remove = node('button', 'Remove', 'remove-column');
    remove.type = 'button'; remove.dataset.removeColumn = index;
    remove.setAttribute('aria-label', 'Remove ' + column.source);
    removeCell.append(remove); row.append(removeCell); body.append(row);
  }
  if (!mappingRows.length) {
    const row = node('tr'), cell = node('td', 'Add the source columns this dataset should expose.', 'empty');
    cell.colSpan = 10; row.append(cell); body.append(row);
  }
  updateCapabilities();
}
function updateCapabilities() {
  const count = field => mappingRows.filter(column => column[field]).length;
  const filters = count('filter'), ranges = count('range'), sorts = count('sort');
  const parameters = 3 + filters + 4 * ranges + (sorts ? 1 : 0);
  $('mapping-capabilities').textContent = mappingRows.length + ' output columns · ' + count('identity') +
    ' identity columns · ' + filters + ' filters · ' + ranges + ' ranges · ' + sorts +
    ' sorts · ' + parameters + '/32 native query parameters. Each capability supports up to eight columns.';
  $('mapping-dirty').textContent = mappingDirty ? 'Unsaved mapping changes' : state?.mapping ? 'Saved mapping' : 'Choose and save a mapping';
}
function addColumn(source, {renderNow = true} = {}) {
  if (!source) throw new Error('Inspect a source and choose a column.');
  const names = new Set(mappingRows.map(column => column.name));
  let name = source, suffix = 2;
  while (names.has(name)) name = source + '_' + suffix++;
  mappingRows.push({source, name, type: 'string', nullable: true, nullPolicy: 'empty-is-null',
    identity: false, filter: false, range: false, sort: false});
  mappingDirty = true;
  if (renderNow) { renderMappingRows(); renderControls(); }
}
function mappingPayload() {
  if (!mappingRows.length) throw new Error('Choose at least one source column.');
  const names = mappingRows.map(column => column.name);
  if (names.some(name => !name) || new Set(names).size !== names.length) throw new Error('Output column names must be nonempty and unique.');
  for (const column of mappingRows) {
    if (column.nullPolicy === 'literal-json' && (column.type !== 'string' || column.nullable))
      throw new Error(column.name + ': literal JSON requires a non-nullable string.');
    if (column.nullPolicy === 'empty-is-null' && !column.nullable)
      throw new Error(column.name + ': empty becomes null requires nullable output.');
  }
  const selected = field => {
    const names = mappingRows.filter(column => column[field]).map(column => column.name);
    const key = {identity: 'idColumns', filter: 'filters', range: 'ranges', sort: 'sorts'}[field];
    const previous = (mappingOrder[key] || []).filter(name => names.includes(name));
    return [...previous, ...names.filter(name => !previous.includes(name))];
  };
  return {name: $('mapping-name').value, idColumns: selected('identity'),
    columns: mappingRows.map(({source, name, type, nullable, nullPolicy}) => ({source, name, type, nullable, nullPolicy})),
    filters: selected('filter'), ranges: selected('range'), sorts: selected('sort'),
    pageSize: Number($('mapping-page-size').value), maxPageSize: Number($('mapping-max-page-size').value)};
}
function renderEditions() {
  const area = $('edition-list'); area.replaceChildren();
  $('active-edition').textContent = state.activeEditionId ? 'Active · ' + short(state.activeEditionId) : 'No active edition';
  for (const edition of [...(state.editions || [])].reverse()) {
    const card = node('article', undefined, 'edition-card' + (edition.id === state.activeEditionId ? ' active' : ''));
    const heading = node('div', undefined, 'panel-heading');
    heading.append(node('strong', edition.id, 'mono'), node('span', number(edition.rowCount) + ' rows', 'badge'));
    card.append(heading, node('p', text(edition.createdAt) + ' · SHA-256 ' + text(edition.sha256), 'facts mono'));
    if (edition.changes !== undefined) {
      const detail = node('details'); detail.append(node('summary', 'Review edition changes'), node('pre', json(edition.changes)));
      card.append(detail);
    }
    const controls = node('div', undefined, 'actions'), activate = node('button', edition.id === state.activeEditionId ? 'Selected edition' : 'Use this edition');
    activate.type = 'button'; activate.dataset.activateEdition = edition.id; activate.dataset.write = '';
    if (edition.id === state.activeEditionId) activate.disabled = true;
    controls.append(activate); card.append(controls); area.append(card);
  }
  if (!(state.editions || []).length) area.append(node('p', 'Build an edition from a completed capture and saved mapping.', 'empty'));
}
function queryFields() {
  return mappedNames().filter(name => (state?.mapping?.filters || []).includes(name) || (state?.mapping?.ranges || []).includes(name));
}
function operators(field) {
  const list = [];
  if ((state?.mapping?.filters || []).includes(field)) list.push(['where', 'Equals']);
  if ((state?.mapping?.ranges || []).includes(field)) list.push(['gt', 'Greater than'], ['gte', 'At least'], ['lt', 'Less than'], ['lte', 'At most']);
  return list;
}
function renderQueryCapabilities() {
  $('query-saved-status').textContent = state?.lastQuery ? 'Saved selection · snapshot ' + short(state.lastQuery.snapshot) + ' · ' + text(state.lastQuery.queriedAt) : '';
  const previous = $('query-sort').value;
  $('query-sort').replaceChildren(option('', 'Source order'));
  for (const field of state?.mapping?.sorts || [])
    $('query-sort').append(option(field, field + ' · ascending'), option('-' + field, field + ' · descending'));
  if ([...$('query-sort').options].some(entry => entry.value === previous)) $('query-sort').value = previous;
  $('query-limit').max = state?.mapping?.maxPageSize || 250;
  if (!queryDirty && !lastQuery) $('query-limit').value = state?.mapping?.pageSize || 50;
  conditions = conditions.filter(condition => queryFields().includes(condition.field));
  renderConditions();
}
function renderConditions() {
  const area = $('query-conditions'); area.replaceChildren();
  for (const [index, condition] of conditions.entries()) {
    const row = node('div', undefined, 'condition-row');
    const fieldLabel = node('label', 'Column'), field = node('select'); field.dataset.conditionField = index;
    for (const name of queryFields()) field.append(option(name, name)); field.value = condition.field; fieldLabel.append(field);
    const operatorLabel = node('label', 'Comparison'), operator = node('select'); operator.dataset.conditionOperator = index;
    for (const [key, label] of operators(condition.field)) operator.append(option(key, label)); operator.value = condition.operator; operatorLabel.append(operator);
    const valueLabel = node('label', 'Value'), value = node('input'); value.dataset.conditionValue = index;
    value.value = condition.value; value.spellcheck = false; value.placeholder = condition.operator === 'where' ? 'Exact value; empty for null' : 'Typed boundary';
    valueLabel.append(value);
    const remove = node('button', 'Remove'); remove.type = 'button'; remove.dataset.removeCondition = index;
    row.append(fieldLabel, operatorLabel, valueLabel, remove); area.append(row);
  }
  if (!conditions.length) area.append(node('p', queryFields().length ? 'Add a condition here or enter native parameters below.' :
    'Enable filter or range columns in the saved mapping to add conditions.', 'empty'));
}
function queryPayload() {
  const query = {};
  const put = (key, value) => {
    if (Object.hasOwn(query, key)) throw new Error('Query parameter appears more than once: ' + key);
    query[key] = value;
  };
  put('limit', $('query-limit').value);
  if ($('query-sort').value) put('sort', $('query-sort').value);
  if ($('query-fields').value) put('fields', $('query-fields').value);
  for (const condition of conditions) {
    if (!operators(condition.field).some(([key]) => key === condition.operator)) throw new Error('Choose a supported condition for ' + condition.field);
    if (condition.operator !== 'where' && !condition.value) throw new Error('A range boundary is required for ' + condition.field);
    put(condition.operator + '_' + condition.field, condition.value);
  }
  for (const [key, value] of new URLSearchParams($('query-extra').value.replace(/^\?/, ''))) put(key, value);
  return query;
}
function unwrapQuery(value) {
  if (object(value?.result) && Array.isArray(value.result.rows)) return value.result;
  if (object(value?.body) && Array.isArray(value.body.rows)) return value.body;
  return value || {};
}
function renderQueryResult() {
  const area = $('query-result-table'); area.replaceChildren();
  if (queryResult === null) {
    $('query-result-summary').textContent = 'Run a query against an active edition.';
    $('query-result-json').textContent = 'No query run.';
    return;
  }
  $('query-result-json').textContent = json(queryResult);
  if (Number(queryResult.status) >= 400) {
    nextCursor = null;
    $('query-result-summary').textContent = 'Native query returned HTTP ' + queryResult.status;
    const detail = queryResult.body || queryResult;
    area.append(node('p', detail.message || text(detail.error || detail), 'error-detail'));
    return;
  }
  const result = unwrapQuery(queryResult);
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const fields = Array.isArray(result.fields) ? result.fields :
    rows.length && object(rows[0]) ? Object.keys(rows[0]) : [];
  nextCursor = result.page?.nextCursor || null;
  $('query-result-summary').textContent = number(result.page?.returned ?? rows.length) + ' returned' +
    (result.page?.total !== undefined ? ' / ' + number(result.page.total) + ' matching rows' : '') +
    (nextCursor ? ' · continuation available' : '');
  if (!fields.length) {
    area.append(node('p', rows.length ? 'The complete native result is available below.' : 'No rows returned.', 'empty'));
    return;
  }
  const table = node('table'), head = node('thead'), header = node('tr'), body = node('tbody');
  for (const field of fields) header.append(node('th', field)); head.append(header);
  for (const row of rows) {
    const record = node('tr');
    for (const [index, field] of fields.entries()) {
      const value = Array.isArray(row) ? row[index] : row[field];
      record.append(node('td', value === null ? 'null' : typeof value === 'object' ? json(value) : value));
    }
    body.append(record);
  }
  table.append(head, body); area.append(table);
}
function renderMerchant(force = false) {
  const signature = json(state.merchant);
  if (force || (signature !== merchantSignature && !merchantDirty)) {
    const merchant = state.merchant || {}, payment = merchant.payment || merchant.terms || {};
    $('merchant-origin').value = merchant.origin || '';
    $('merchant-path').value = merchant.path || '/data';
    for (const [id, field] of [['merchant-network', 'network'], ['merchant-asset', 'asset'],
      ['merchant-amount', 'amount'], ['merchant-pay-to', 'payTo']]) $(id).value = payment[field] || '';
    $('merchant-timeout').value = payment.maxTimeoutSeconds || 300;
    merchantSignature = signature;
  }
  $('merchant-summary').textContent = state.merchant ?
    'Prepared from the retained dataset. The complete configuration is included in package export.' :
    'Select an edition and prepare its offer.';
  $('merchant-details').hidden = !state.merchant;
  $('merchant-details').textContent = state.merchant ? json(state.merchant) : '';
}
function renderExports() {
  const area = $('export-list'); area.replaceChildren();
  for (const item of [...(state.exports || [])].reverse()) {
    const card = node('article', undefined, 'export-card'), heading = node('div', undefined, 'panel-heading');
    heading.append(node('strong', item.id, 'mono'), node('span', item.createdAt, 'muted'));
    card.append(heading, node('p', item.directory, 'facts mono'));
    const wrap = node('div', undefined, 'table-scroll'), table = node('table', undefined, 'file-table'),
      head = node('thead'), header = node('tr'), body = node('tbody');
    for (const name of ['File / SHA-256', 'Bytes', 'Download']) header.append(node('th', name)); head.append(header);
    for (const file of item.files || []) {
      const row = node('tr'), name = node('td'), control = node('td'), button = node('button', 'Download');
      name.append(node('span', file.name), node('span', file.sha256, 'sha mono'));
      button.type = 'button'; button.dataset.exportId = item.id; button.dataset.exportFilename = file.name;
      button.setAttribute('aria-label', 'Download ' + file.name);
      control.append(button); row.append(name, node('td', number(file.bytes)), control); body.append(row);
    }
    table.append(head, body); wrap.append(table); card.append(wrap); area.append(card);
  }
  if (!(state.exports || []).length) area.append(node('p', 'No package exported yet.', 'empty'));
  $('package-import-status').textContent = emptyWorkspace() ?
    'This workspace is empty and can receive a retained package.' :
    'To import a package, start another workspace with a new, empty directory.';
  $('workspace-details').textContent = json(state);
}
function renderControls() {
  const locked = busy || captureLoopActive || Boolean(state?.busy) || needsRefresh || sessionExpired || !state;
  document.querySelectorAll('[data-write]').forEach(button => { button.disabled = locked; });
  const gate = (id, condition) => { $(id).disabled = locked || !condition; };
  gate('inspect-source', Boolean(state?.source));
  gate('start-capture', Boolean(state?.source && state?.metadata && !['running', 'paused'].includes(status())));
  gate('next-page', status() === 'running');
  gate('run-capture', status() === 'running');
  gate('resume-capture', ['paused', 'error'].includes(status()));
  $('pause-capture').disabled = !state || needsRefresh || sessionExpired || pauseRequested || status() !== 'running';
  gate('build-edition', status() === 'completed' && Boolean(state?.mapping) && !mappingDirty);
  gate('next-query-page', Boolean(nextCursor && lastQuery && !queryDirty && state?.activeEditionId));
  $('query-form').querySelector('[type=submit]').disabled = locked || !state?.activeEditionId;
  $('merchant-form').querySelector('[type=submit]').disabled = locked || !state?.activeEditionId;
  gate('export-package', Boolean(state?.activeEditionId));
  gate('import-package', emptyWorkspace());
  $('package-import-path').disabled = !emptyWorkspace() || locked;
  $('capture-import-form').querySelector('[type=submit]').disabled = locked || status() === 'running';
  document.querySelectorAll('[data-activate-edition]').forEach(button => {
    button.disabled = locked || button.dataset.activateEdition === state?.activeEditionId;
  });
  $('download-mapping').disabled = !state?.mapping;
  $('add-query-condition').disabled = !queryFields().length;
  $('load-saved-query').disabled = !state?.lastQuery?.initialQuery;
  $('add-mapping-column').disabled = !state?.metadata?.columns?.length;
  $('add-all-mapping-columns').disabled = !state?.metadata?.columns?.length;
  $('refresh-state').disabled = busy;
  $('mapping-dirty').textContent = mappingDirty ? 'Unsaved mapping changes' : state?.mapping ? 'Saved mapping' : 'Choose and save a mapping';
  publisherPanel?.controls(locked);
}
function render() {
  if (!state) { renderControls(); return; }
  $('workspace-name').textContent = state.metadata?.name || state.source?.datasetId || 'No source configured';
  $('workspace-summary').textContent = state.capture ?
    number(state.capture.rowCount) + ' retained rows · ' + state.capture.status :
    state.source ? state.source.domain : 'Choose a source or restore a package.';
  $('edition-summary').textContent = state.activeEditionId ? 'Edition ' + short(state.activeEditionId) : '';
  renderSource(); renderCapture();
  if (json(state.mapping) !== mappingSignature && !mappingDirty) loadMapping();
  else if (!mappingDirty && !state.mapping && !$('mapping-name').value && state.metadata?.name) $('mapping-name').value = state.metadata.name;
  renderEditions();
  const currentActive = state.activeEditionId || '';
  if (currentActive !== activeSignature) {
    activeSignature = currentActive; lastQuery = null; nextCursor = null; queryResult = null; queryDirty = false;
  }
  renderQueryCapabilities(); renderQueryResult(); renderMerchant(); renderExports(); publisherPanel?.render(state); renderControls();
  if (!busy) $('connection-status').textContent = 'Local workspace';
}
async function runCapture({resume = false} = {}) {
  if (captureLoopActive) return;
  if (resume) await perform('capture.resume', {}, {quiet: true});
  if (status() !== 'running') throw new Error('Start or resume a capture before running its pages.');
  continueCapture = true; captureLoopActive = true; renderCapture(); renderControls();
  try {
    while (continueCapture && status() === 'running') {
      await perform('capture.advance', {pages: 1}, {quiet: true});
      if (!continueCapture || status() !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (status() === 'completed') notice('Capture complete: ' + number(state.capture.rowCount) + ' rows across ' + number(state.capture.pageCount) + ' original pages.');
  } finally {
    continueCapture = false; captureLoopActive = false; renderCapture(); renderControls();
  }
}
async function runQuery(query) {
  const result = await perform('dataset.query', {query});
  lastQuery = {...query}; queryResult = result; queryDirty = false;
  renderQueryResult(); renderControls();
}
async function download(exportId, filename) {
  let response;
  try { response = await fetch('/api/exports/' + encodeURIComponent(exportId) + '/' + encodeURIComponent(filename),
    {headers: {'Authorization': 'Bearer ' + token}, cache: 'no-store'}); }
  catch { throw new Error('The file download could not be read. Retry this retained file download.'); }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || 'The retained export file is unavailable.');
  }
  const blob = await response.blob(), url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  notice('Downloaded retained file: ' + filename);
}
document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => selectSection(button.dataset.section)));
$('refresh-state').addEventListener('click', () => handle(() => refresh()));
$('source-form').addEventListener('input', () => { sourceDirty = true; });
bindForm('source-form', async () => {
  await perform('source.configure', {domain: $('source-domain').value, datasetId: $('source-id').value,
    protocol: $('source-protocol').value, where: $('source-where').value, order: $('source-order').value,
    pageSize: Number($('source-page-size').value)}, {quiet: true});
  sourceDirty = false; renderSource(true);
  await perform('source.inspect', {});
});
$('inspect-source').addEventListener('click', () => handle(() => perform('source.inspect', {})));
bindForm('search-form', async () => {
  const result = await perform('source.search', {query: $('search-query').value,
    domain: $('search-domain').value || $('source-domain').value});
  $('search-results').replaceChildren(node('pre', json(result)));
});
$('start-capture').addEventListener('click', () => handle(() => perform('capture.start', {})));
$('next-page').addEventListener('click', () => handle(() => perform('capture.advance', {pages: 1})));
$('run-capture').addEventListener('click', () => handle(() => runCapture()));
$('resume-capture').addEventListener('click', () => handle(() => runCapture({resume: true})));
$('pause-capture').addEventListener('click', () => {
  continueCapture = false;
  if (busy) { pauseRequested = true; renderCapture(); renderControls(); }
  else handle(() => perform('capture.pause', {}));
});
bindForm('capture-import-form', () => perform('capture.import', {manifestPath: $('capture-manifest-path').value}));
$('mapping-form').addEventListener('input', event => {
  if (event.target.dataset.field === 'name') {
    const row = mappingRows[Number(event.target.dataset.row)]; if (row) row.name = event.target.value;
  }
  markMapping();
});
$('mapping-columns').addEventListener('change', event => {
  const field = event.target.dataset.field, index = Number(event.target.dataset.row);
  if (!field || !mappingRows[index]) return;
  const column = mappingRows[index];
  column[field] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  if (field === 'nullPolicy') {
    if (column.nullPolicy === 'literal-json') { column.type = 'string'; column.nullable = false; }
    else if (column.nullPolicy === 'empty-is-null') column.nullable = true;
    else column.nullable = false;
  }
  if (field === 'nullable') column.nullPolicy = column.nullable ? 'empty-is-null' :
    column.nullPolicy === 'literal-json' ? 'literal-json' : 'reject-null';
  if (field === 'type') {
    if (column.type !== 'string' && column.nullPolicy === 'literal-json') column.nullPolicy = 'reject-null';
    if (column.type === 'boolean') column.range = false;
  }
  mappingDirty = true;
  renderMappingRows(); renderControls();
});
$('mapping-columns').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-column]'); if (!button) return;
  mappingRows.splice(Number(button.dataset.removeColumn), 1); mappingDirty = true; renderMappingRows(); renderControls();
});
$('add-mapping-column').addEventListener('click', () => handle(() => addColumn($('mapping-source-column').value)));
$('add-all-mapping-columns').addEventListener('click', () => {
  for (const column of state?.metadata?.columns || [])
    if (!mappingRows.some(row => row.source === column.fieldName)) addColumn(column.fieldName, {renderNow: false});
  renderMappingRows(); renderControls();
});
$('reset-mapping').addEventListener('click', () => { loadMapping(); notice('Saved mapping loaded into the editor.'); });
$('download-mapping').addEventListener('click', () => {
  if (!state?.mapping) return;
  const url = URL.createObjectURL(new Blob([json(state.mapping) + '\n'], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'socrata-mapping.json';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  notice('Downloaded the exact saved mapping, including capability order.');
});
$('mapping-file').addEventListener('change', () => handle(async () => {
  const file = $('mapping-file').files[0]; if (!file) return;
  if (file.size > 65536) throw new Error('The mapping file exceeds 64 KiB.');
  const mapping = JSON.parse(await file.text());
  if (!object(mapping) || typeof mapping.name !== 'string' || !Array.isArray(mapping.columns) ||
      !mapping.columns.length || mapping.columns.length > 64 ||
      mapping.columns.some(column => !object(column) || typeof column.source !== 'string' ||
        typeof column.name !== 'string' || !['string', 'integer', 'number', 'boolean'].includes(column.type)) ||
      ['idColumns', 'filters', 'ranges', 'sorts'].some(key => mapping[key] !== undefined &&
        (!Array.isArray(mapping[key]) || mapping[key].some(value => typeof value !== 'string'))))
    throw new Error('Choose an original Socrata mapping JSON file with explicit columns and query capabilities.');
  applyMapping(mapping);
  notice('Mapping file loaded into the editor. Review its fields and save it for this capture.');
}));
bindForm('mapping-form', async () => { await perform('mapping.save', mappingPayload()); loadMapping(); renderQueryCapabilities(); });
$('build-edition').addEventListener('click', () => handle(() => perform('edition.build', {})));
$('edition-list').addEventListener('click', event => {
  const button = event.target.closest('[data-activate-edition]');
  if (button) handle(() => perform('edition.activate', {editionId: button.dataset.activateEdition}));
});
$('query-form').addEventListener('input', () => { queryDirty = true; renderControls(); });
$('query-form').addEventListener('change', () => { queryDirty = true; renderControls(); });
$('add-query-condition').addEventListener('click', () => {
  const field = queryFields()[0]; if (!field) return;
  conditions.push({field, operator: operators(field)[0][0], value: ''}); queryDirty = true; renderConditions(); renderControls();
});
$('query-conditions').addEventListener('input', event => {
  const index = event.target.dataset.conditionValue;
  if (index !== undefined && conditions[Number(index)]) conditions[Number(index)].value = event.target.value;
});
$('query-conditions').addEventListener('change', event => {
  if (event.target.dataset.conditionField !== undefined) {
    const row = conditions[Number(event.target.dataset.conditionField)]; row.field = event.target.value;
    row.operator = operators(row.field)[0][0]; renderConditions();
  } else if (event.target.dataset.conditionOperator !== undefined)
    conditions[Number(event.target.dataset.conditionOperator)].operator = event.target.value;
});
$('query-conditions').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-condition]');
  if (button) { conditions.splice(Number(button.dataset.removeCondition), 1); queryDirty = true; renderConditions(); renderControls(); }
});
bindForm('query-form', () => runQuery(queryPayload()));
$('next-query-page').addEventListener('click', () => handle(() => runQuery({...lastQuery, cursor: nextCursor})));
$('load-saved-query').addEventListener('click', () => {
  const saved = state?.lastQuery?.initialQuery;
  if (!saved) return;
  const query = typeof saved === 'string' ? Object.fromEntries(new URLSearchParams(saved)) : {...saved};
  delete query.cursor;
  $('query-limit').value = query.limit || state.mapping?.pageSize || 50;
  $('query-sort').value = query.sort || '';
  $('query-fields').value = query.fields || '';
  delete query.limit; delete query.sort; delete query.fields;
  $('query-extra').value = new URLSearchParams(query).toString();
  if ($('query-extra').value) $('query-extra').closest('details').open = true;
  conditions = []; lastQuery = null; nextCursor = null; queryResult = null; queryDirty = true;
  renderConditions(); renderQueryResult(); renderControls();
  notice('Saved query selection loaded. Review its parameters and run the native preview.');
});
$('clear-query').addEventListener('click', () => {
  $('query-form').reset(); conditions = []; lastQuery = null; nextCursor = null; queryResult = null; queryDirty = false;
  renderQueryCapabilities(); renderQueryResult(); renderControls();
});
$('merchant-form').addEventListener('input', () => { merchantDirty = true; });
bindForm('merchant-form', async () => {
  await perform('merchant.configure', {origin: $('merchant-origin').value, path: $('merchant-path').value,
    payment: {scheme: 'exact', network: $('merchant-network').value, asset: $('merchant-asset').value,
      amount: $('merchant-amount').value, payTo: $('merchant-pay-to').value,
      maxTimeoutSeconds: Number($('merchant-timeout').value)}});
  merchantDirty = false; renderMerchant(true);
});
$('export-package').addEventListener('click', () => handle(() => perform('package.export', {})));
$('export-list').addEventListener('click', event => {
  const button = event.target.closest('[data-export-id]');
  if (button) handle(() => download(button.dataset.exportId, button.dataset.exportFilename));
});
bindForm('package-import-form', async () => {
  await perform('package.import', {packagePath: $('package-import-path').value});
  sourceDirty = false; merchantDirty = false; mappingDirty = false; sourceSignature = ''; merchantSignature = ''; mappingSignature = '';
  render();
});
renderControls();
if (!token) { sessionMessage('Open the complete session URL printed by the workspace command.'); $('connection-status').textContent = 'Session required'; }
else handle(() => refresh({quiet: true}));
