// MIT. Editable original documents; the maintained onboarding compiler owns review.
const $ = id => document.getElementById(id);
const tokenKey = 'sf105-workspace:' + location.origin;
const fragment = location.hash.slice(1);
if (fragment) { sessionStorage.setItem(tokenKey, fragment); history.replaceState(null, '', location.pathname); }
const token = fragment || sessionStorage.getItem(tokenKey) || '';
const state = { saved: null, revision: 0, dirty: false, review: null, operation: 0, exportId: null,
  queries: null, plan: null, busy: false };
const json = value => JSON.stringify(value, null, 2) + '\n';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
function notice(message, error = false) {
  $('notice').className = 'visible' + (error ? ' error' : '');
  $('notice').textContent = message;
}
function empty(target, message) { target.replaceChildren(node('div', message, 'empty')); }
function safeObject(text, label) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error(label + ' must be valid JSON.'); }
  if (!plain(value)) throw new Error(label + ' must be a JSON object.');
  return value;
}
function editorObject(text, kind) {
  const value = safeObject(text, kind), objects = list => Array.isArray(list) && list.every(plain);
  let usable;
  if (kind === 'queries') {
    usable = value.operations === undefined || objects(value.operations) && value.operations.every(op =>
      op.variables === undefined || plain(op.variables) && Object.values(op.variables).every(plain));
  } else {
    const payments = item => (item.payment === undefined || plain(item.payment)) &&
      (item.paymentOptions === undefined || objects(item.paymentOptions));
    usable = payments(value) && (value.routes === undefined || objects(value.routes) && value.routes.every(route =>
      payments(route) && (route.tags === undefined || Array.isArray(route.tags))));
  }
  // Only check shapes used by these controls. The original compiler validates
  // semantics; unfinished documents remain editable and saveable as raw text.
  if (!usable) throw new Error('The guided ' + kind + ' editor needs object entries and array lists. Correct the raw JSON or save this unfinished draft.');
  return value;
}
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Workspace-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Workspace request failed.');
  return value;
}
async function action(message, work) {
  if (state.busy) return;
  state.busy = true; notice(message); buttons();
  try { await work(); }
  catch (error) { notice(error.message, true); }
  finally { state.busy = false; buttons(); }
}
function buttons() {
  for (const element of document.querySelectorAll('button,input,select,textarea')) {
    const selected = element.name === 'merchant-export' ? state.saved?.exports.find(item => item.id === element.value) : null;
    const staleExport = selected && (selected.unavailable || selected.inputDigest !== state.saved?.inputDigest);
    element.disabled = state.busy || element.id === 'project-id' && state.saved !== null || staleExport;
  }
  $('export').disabled = state.busy || !state.saved || state.dirty || !state.review;
  $('start').disabled = state.busy || state.dirty || !state.saved || !state.exportId;
}
function changed() {
  state.dirty = true; state.review = null;
  $('review-status').textContent = 'The draft changed. Review its current source and terms before export.';
  $('review-summary').replaceChildren();
  $('revision').textContent = state.saved ? 'Revision ' + state.revision + ' · unsaved changes' : 'Unsaved project';
  buttons();
}
function input() {
  return { title: $('project-title').value, schemaText: $('schema-text').value,
    queriesText: $('queries-text').value, planText: $('plan-text').value };
}
function syncQueries() { $('queries-text').value = json(state.queries); changed(); }
function syncPlan() { $('plan-text').value = json(state.plan); changed(); }
function control(label, value, update, { type = 'text', textarea = false, placeholder = '', rows = 4 } = {}) {
  const wrapper = node('label', label), element = node(textarea ? 'textarea' : 'input');
  if (textarea) { element.rows = rows; element.spellcheck = false; element.className = 'code'; }
  else element.type = type;
  element.value = value ?? ''; element.placeholder = placeholder;
  element.addEventListener('change', () => {
    try { update(type === 'number' ? Number(element.value) : element.value); }
    catch (error) { notice(error.message, true); }
  });
  wrapper.append(element); return wrapper;
}
function selectControl(label, value, options, update) {
  const wrapper = node('label', label), element = node('select');
  for (const option of options) { const entry = node('option', option); entry.value = option; element.append(entry); }
  element.value = value;
  element.addEventListener('change', () => update(element.value)); wrapper.append(element); return wrapper;
}
function checkControl(label, value, update) {
  const wrapper = node('label', undefined, 'checkbox'), element = node('input');
  element.type = 'checkbox'; element.checked = value === true;
  element.addEventListener('change', () => update(element.checked));
  wrapper.append(element, node('span', label)); return wrapper;
}
function button(label, work, secondary = false) {
  const element = node('button', label, secondary ? 'secondary' : undefined); element.type = 'button';
  element.addEventListener('click', work); return element;
}
function table(headers, rows) {
  const element = node('table'), head = node('thead'), hrow = node('tr'), body = node('tbody');
  for (const header of headers) hrow.append(node('th', header));
  head.append(hrow);
  for (const row of rows) { const tr = node('tr'); for (const cell of row) tr.append(node('td', cell)); body.append(tr); }
  element.append(head, body);
  const scroll = node('div', undefined, 'table-wrap'); scroll.append(element); return scroll;
}
function detail(title, value) {
  const element = node('details'); element.append(node('summary', title), node('pre', typeof value === 'string' ? value : json(value))); return element;
}
function renderOperation() {
  const editor = $('operation-editor'), op = state.queries?.operations?.[state.operation]; editor.replaceChildren();
  if (!op) { empty(editor, 'Load an approved-queries document or add a query from the actual schema.'); renderRoute(); return; }
  const grid = node('div', undefined, 'grid two');
  for (const key of ['name', 'root', 'handler', 'admission']) grid.append(control(
    { name: 'Operation name', root: 'GraphQL result root', handler: 'Native handler name', admission: 'Native admission name' }[key], op[key], value => {
      const old = op.name; op[key] = value;
      if (key === 'name') for (const route of state.plan?.routes ?? []) if (route.operation === old) route.operation = value;
      syncQueries(); if (key === 'name') { if (state.plan) syncPlan(); renderQueries(); }
    }));
  editor.append(grid, control('Fixed read-only GraphQL query', op.query, value => { op.query = value; syncQueries(); }, { textarea: true, rows: 6 }));
  editor.append(control('Maximum returned nodes', op.maxNodes ?? 100, value => { op.maxNodes = value; syncQueries(); }, { type: 'number' }));
  const heading = node('div', undefined, 'subheading'); heading.append(node('h3', 'Buyer variables'), button('Add variable', () => {
    const name = prompt('Variable name from the fixed query'); if (!name) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return notice('Use a declared GraphQL variable name.', true);
    op.variables ??= {};
    if (Object.hasOwn(op.variables, name)) return notice('That variable is already present.', true);
    Object.defineProperty(op.variables, name, { value: { type: 'string', required: true, min: 1, max: 256 }, enumerable: true, configurable: true, writable: true });
    syncQueries(); renderOperation();
  })); editor.append(heading);
  if (!Object.keys(op.variables ?? {}).length) editor.append(node('p', 'This operation has no declared buyer variables.', 'subtle'));
  for (const [name, spec] of Object.entries(op.variables ?? {})) {
    const row = node('div', undefined, 'payment'), top = node('div', undefined, 'payment-title');
    top.append(node('strong', '$' + name), button('Remove', () => { delete op.variables[name]; syncQueries(); renderOperation(); }, true));
    const fields = node('div', undefined, 'grid three');
    fields.append(selectControl('Native variable type', spec.type, ['integer', 'string', 'boolean', 'stellar-account'], value => {
      spec.type = value;
      if (['boolean', 'stellar-account'].includes(value)) { delete spec.min; delete spec.max; }
      else { spec.min ??= value === 'integer' ? 0 : 1; spec.max ??= value === 'integer' ? 100000 : 256; }
      delete spec.default; syncQueries(); renderOperation();
    }));
    if (['integer', 'string'].includes(spec.type)) for (const key of ['min', 'max']) fields.append(control(
      (key === 'min' ? 'Minimum' : 'Maximum') + (spec.type === 'string' ? ' characters' : ''), spec[key], value => { spec[key] = value; syncQueries(); }, { type: 'number' }));
    row.append(top, fields, checkControl('Required', spec.required, value => { spec.required = value; syncQueries(); }));
    row.append(control('Default value (JSON; leave empty for no default)', Object.hasOwn(spec, 'default') ? JSON.stringify(spec.default) : '', value => {
      if (value.trim()) spec.default = JSON.parse(value); else delete spec.default; syncQueries();
    })); editor.append(row);
  }
  renderRoute();
}
function renderQueries() {
  const q = state.queries;
  if (!q) {
    $('operation-select').replaceChildren();
    empty($('operation-editor'), 'Apply valid queries JSON to use the guided editors.'); renderRoute(); return;
  }
  for (const [id, key, fallback] of [['backend-origin', 'origin', ''], ['backend-path', 'path', '/graphql'],
    ['backend-auth', 'authorizationEnv', ''], ['backend-timeout', 'timeoutMs', 8000],
    ['backend-bytes', 'maxResponseBytes', 262144], ['backend-concurrency', 'maxInFlight', 8]]) $(id).value = q[key] ?? fallback;
  const selector = $('operation-select'); selector.replaceChildren();
  const operations = Array.isArray(q.operations) ? q.operations : [];
  state.operation = Math.max(0, Math.min(state.operation, operations.length - 1));
  operations.forEach((op, i) => { const option = node('option', op.name || 'Unnamed operation'); option.value = i; selector.append(option); });
  selector.value = state.operation; renderOperation();
}
function choices(plan) { return Array.isArray(plan.paymentOptions) ? plan.paymentOptions : plan.payment ? [plan.payment] : []; }
function renderPayments() {
  const target = $('payments'); target.replaceChildren();
  if (!state.plan) return;
  const list = choices(state.plan);
  if (!list.length) empty(target, 'Add the merchant’s agreed payment choice or load its existing merchant plan.');
  list.forEach((payment, index) => {
    const box = node('div', undefined, 'payment'), top = node('div', undefined, 'payment-title');
    top.append(node('strong', 'Choice ' + (index + 1)), button('Remove', () => {
      const remaining = choices(state.plan).filter((_, i) => i !== index);
      delete state.plan.payment; state.plan.paymentOptions = remaining; syncPlan(); renderPayments();
    }, true));
    const grid = node('div', undefined, 'grid three');
    for (const [key, label] of [['scheme', 'Scheme'], ['network', 'Network'], ['amount', 'Atomic-unit amount'],
      ['asset', 'Asset'], ['payTo', 'Merchant recipient'], ['maxTimeoutSeconds', 'Payment timeout (seconds)']])
      grid.append(control(label, payment[key], value => { payment[key] = value; syncPlan(); }, { type: key === 'maxTimeoutSeconds' ? 'number' : 'text' }));
    box.append(top, grid); target.append(box);
  });
}
function renderRoute() {
  const target = $('route-editor'), op = state.queries?.operations?.[state.operation]; target.replaceChildren();
  const route = state.plan?.routes?.find(value => value.operation === op?.name);
  if (!route) { empty(target, op ? 'Create the merchant route for ' + op.name + '.' : 'Select an approved operation first.'); return; }
  const fields = node('div', undefined, 'grid two');
  for (const [key, label] of [['id', 'Route ID'], ['path', 'Public POST path'], ['serviceName', 'Service name'], ['description', 'Description']])
    fields.append(control(label, route[key], value => { route[key] = value; syncPlan(); }));
  target.append(fields, control('Tags (comma separated)', (route.tags ?? []).join(', '), value => {
    route.tags = value.split(',').map(item => item.trim()).filter(Boolean); syncPlan();
  }));
  const samples = node('div', undefined, 'grid two');
  samples.append(control('Public example variables (JSON)', json(route.variables ?? {}), value => {
    route.variables = safeObject(value, 'Example variables'); syncPlan();
  }, { textarea: true, rows: 5 }));
  samples.append(control('Variable descriptions (JSON)', json(route.variableDescriptions ?? {}), value => {
    route.variableDescriptions = safeObject(value, 'Variable descriptions'); syncPlan();
  }, { textarea: true, rows: 5 })); target.append(samples);
  if (route.payment || route.paymentOptions) target.append(detail('This route retains its own payment choices', choices(route)));
  target.append(button('Remove this route', () => { state.plan.routes = state.plan.routes.filter(value => value !== route); syncPlan(); renderRoute(); }, true));
}
function renderPlan() { $('public-origin').value = state.plan?.publicOrigin ?? ''; renderPayments(); renderRoute(); }
function loadEditors() {
  try { state.queries = editorObject($('queries-text').value, 'queries'); }
  catch { state.queries = null; }
  try { state.plan = editorObject($('plan-text').value, 'plan'); }
  catch { state.plan = null; }
  renderQueries(); renderPlan();
}
function loadDraft(saved) {
  state.saved = saved; state.revision = saved.currentRevision; state.dirty = false; state.review = null;
  state.operation = 0; state.exportId = saved.exports.filter(item => !item.unavailable && item.inputDigest === saved.inputDigest).at(-1)?.id ?? null;
  $('project-id').value = saved.id; $('project-id').disabled = true;
  $('project-title').value = saved.input.title; $('heading').textContent = saved.input.title;
  for (const [id, field] of [['schema-text', 'schemaText'], ['queries-text', 'queriesText'], ['plan-text', 'planText']]) $(id).value = saved.input[field];
  $('revision').textContent = saved.revision === saved.currentRevision ? 'Saved revision ' + saved.revision : 'Viewing revision ' + saved.revision + ' · current revision ' + saved.currentRevision;
  $('schema-summary').replaceChildren(); $('schema-status').textContent = '';
  $('review-summary').replaceChildren(); $('review-status').textContent = 'Review this saved project against its retained schema and current compiler.';
  if (saved.revision !== saved.currentRevision) { state.dirty = true; state.exportId = null; }
  loadEditors(); renderExports(); buttons();
}
function fresh() {
  state.saved = null; state.revision = 0; state.dirty = false; state.review = null; state.operation = 0; state.exportId = null;
  $('project-id').disabled = false; $('project-id').value = ''; $('project-title').value = ''; $('heading').textContent = 'New GraphQL merchant';
  $('schema-text').value = ''; $('schema-status').textContent = ''; $('schema-summary').replaceChildren();
  $('queries-text').value = json({ schema: 'stellar-forge.subquery-merchant.v1', origin: '', path: '/graphql', timeoutMs: 8000,
    maxResponseBytes: 262144, maxInFlight: 8, operations: [] });
  $('plan-text').value = json({ schema: 'stellar-forge.subquery-merchant-plan.v1', publicOrigin: '', paymentOptions: [], routes: [] });
  $('revision').textContent = 'Unsaved project'; $('review-summary').replaceChildren();
  $('review-status').textContent = 'Review the complete draft using its original schema and merchant compiler.';
  $('history').replaceChildren(); loadEditors(); renderExports(); buttons();
}
function discard() { return !state.dirty || confirm('Open another project and discard these unsaved edits?'); }
async function projects() {
  const result = await api('/api/projects'); $('directory').textContent = result.directory; renderRuntime(result.runtime);
  const target = $('projects'); target.replaceChildren();
  if (!result.projects.length) empty(target, 'No saved projects.');
  for (const item of result.projects) {
    const card = button('', () => action('Opening project…', async () => {
      if (!discard()) return;
      loadDraft(await api('/api/project?id=' + encodeURIComponent(item.id))); await historyList();
      notice('Opened ' + item.id + '.'); await projects();
    }));
    card.className = 'project-card' + (state.saved?.id === item.id ? ' active' : '');
    card.append(node('strong', item.title ?? item.id), node('small', item.unreadable ? item.error : 'Revision ' + item.revision + ' · ' + item.exports + ' exports'));
    target.append(card);
  }
}
function renderRuntime(value) {
  const target = $('runtime'); target.replaceChildren();
  if (value.state !== 'RUNNING') return empty(target, 'No managed merchant is running.');
  const facts = node('div', undefined, 'runtime-facts');
  facts.append(node('span', value.state, 'badge'), node('strong', value.project), node('span', value.mode));
  for (const [key, title] of [['offers', 'Original offers'], ['readiness', 'Merchant readiness']]) {
    const link = node('a', title); link.href = value[key]; link.target = '_blank'; link.rel = 'noreferrer'; facts.append(link);
  }
  target.append(facts, node('pre', value.url));
}
function renderExports() {
  const target = $('exports'); target.replaceChildren();
  const records = state.saved?.exports ?? [];
  if (!records.length) { empty(target, 'Save and review the project to export its launchable merchant package.'); return; }
  for (const record of records.slice().reverse()) {
    const card = node('div', undefined, 'export-card'), label = node('label'), radio = node('input');
    radio.type = 'radio'; radio.name = 'merchant-export'; radio.value = record.id;
    radio.checked = state.exportId === record.id; radio.disabled = record.unavailable || record.inputDigest !== state.saved.inputDigest;
    radio.addEventListener('change', () => { state.exportId = record.id; buttons(); });
    label.append(radio, node('strong', 'Draft revision ' + record.draftRevision + ' · ' + new Date(record.createdAt).toLocaleString()));
    card.append(label, node('p', record.directory, 'code'));
    if (radio.disabled) card.append(node('p', record.unavailable ? record.error : 'This export belongs to earlier project contents.', 'subtle'));
    if (record.unavailable) { target.append(card); continue; }
    card.append(node('pre', record.command));
    const tools = node('div', undefined, 'toolbar');
    tools.append(button('Copy launch command', () => action('Copying command…', async () => { await navigator.clipboard.writeText(record.command); notice('Launch command copied.'); }), true));
    card.append(tools, detail('Exported files', record.files)); target.append(card);
  }
}
function renderReview(review) {
  $('review-status').textContent = 'Current draft accepted by the original GraphQL schema and merchant compiler.';
  const target = $('review-summary'); target.replaceChildren();
  const routes = review.service?.routes ?? [], operations = review.queries?.operations ?? [];
  const metrics = node('div', undefined, 'review-metrics');
  for (const [label, count] of [['Merchant routes', routes.length], ['Approved queries', operations.length]]) {
    const metric = node('div'); metric.append(node('strong', count), node('span', label)); metrics.append(metric);
  }
  target.append(metrics, node('p', 'Schema source: ' + review.sourceSha256, 'code'));
  const rows = [];
  for (const route of routes) {
    const definition = route.definition ?? {};
    const payments = definition.accepts ?? definition.paymentOptions ?? (definition.payment ? [definition.payment] : route.offer?.accepts ?? []);
    for (const payment of payments.length ? payments : [{}]) rows.push([route.id, 'POST ' + route.path,
      payment.network ?? '', payment.amount ?? '', payment.asset ?? '', payment.payTo ?? '']);
  }
  target.append(table(['Route', 'Method / path', 'Network', 'Atomic price', 'Asset', 'Recipient'], rows));
  target.append(detail('Original compiler review', review.review), detail('Compiled seller-service JSON', review.service),
    detail('Validated approved-queries JSON', review.queries));
}
function renderSchema(result) {
  const target = $('schema-summary'), inspection = result.inspection; target.replaceChildren();
  target.append(node('p', result.sourceSha256, 'code'));
  const fields = inspection?.queryFields ?? [];
  target.append(node('h3', 'Query root: ' + (inspection?.queryType ?? '')),
    table(['Field', 'Return type', 'Declared arguments', 'Description'], fields.map(field => [field.name,
      field.type, (field.arguments ?? []).map(arg => arg.name + ': ' + arg.type).join(', '),
      (field.deprecated ? 'Deprecated. ' : '') + (field.description ?? '')])));
  const browser = node('div', undefined, 'grid two'), filter = node('input'), types = node('select'), selected = node('div');
  filter.placeholder = 'Filter type names'; filter.setAttribute('aria-label', 'Filter schema types');
  types.setAttribute('aria-label', 'Schema type'); browser.append(filter, types); target.append(browser, selected);
  function showType() {
    selected.replaceChildren();
    const type = (inspection?.types ?? []).find(value => value.name === types.value); if (!type) return;
    selected.append(node('p', type.kind + (type.description ? ' · ' + type.description : ''), 'subtle'));
    if (type.fields) selected.append(table(['Field', 'Type', 'Arguments'], type.fields.map(field => [field.name, field.type,
      (field.arguments ?? []).map(arg => arg.name + ': ' + arg.type).join(', ')])));
    if (type.values) selected.append(table(['Enum value', 'Status'], type.values.map(value => [value.name, value.deprecated ? 'Deprecated' : 'Declared'])));
  }
  function filterTypes() {
    const previous = types.value; types.replaceChildren();
    for (const type of inspection?.types ?? []) if (type.name.toLowerCase().includes(filter.value.toLowerCase())) {
      const option = node('option', type.name); option.value = type.name; types.append(option);
    }
    if ([...types.options].some(option => option.value === previous)) types.value = previous;
    showType();
  }
  filter.addEventListener('input', filterTypes); types.addEventListener('change', showType); filterTypes();
}
async function historyList() {
  const target = $('history'); target.replaceChildren();
  if (!state.saved) return empty(target, 'Saved revisions appear here.');
  const result = await api('/api/history?id=' + encodeURIComponent(state.saved.id));
  for (const item of result.items) {
    const row = node('div', undefined, 'toolbar');
    row.append(node('span', 'Revision ' + item.revision + ' · ' + new Date(item.updatedAt).toLocaleString()),
      button(item.revision === result.currentRevision ? 'Open current' : 'Open revision', () => action('Opening retained revision…', async () => {
        if (!discard()) return;
        loadDraft(await api('/api/project?id=' + encodeURIComponent(item.id) + '&revision=' + item.revision));
        notice(item.revision === result.currentRevision ? 'Opened current revision.' : 'Opened retained revision. Save creates a new revision without removing later work.');
      }), true)); target.append(row);
  }
  if (result.more) target.append(node('p', 'Showing the latest 100 revisions.', 'subtle'));
}

for (const id of ['project-title', 'schema-text', 'queries-text', 'plan-text']) $(id).addEventListener('input', changed);
$('project-title').addEventListener('input', () => { $('heading').textContent = $('project-title').value || 'New GraphQL merchant'; });
for (const [id, key, numeric] of [['backend-origin', 'origin'], ['backend-path', 'path'], ['backend-auth', 'authorizationEnv'],
  ['backend-timeout', 'timeoutMs', true], ['backend-bytes', 'maxResponseBytes', true], ['backend-concurrency', 'maxInFlight', true]])
  $(id).addEventListener('change', () => {
    if (!state.queries) return notice('Apply valid queries JSON before using the editors.', true);
    if (key === 'authorizationEnv' && !$(id).value) delete state.queries[key];
    else state.queries[key] = numeric ? Number($(id).value) : $(id).value;
    syncQueries();
  });
$('public-origin').addEventListener('change', () => { if (state.plan) { state.plan.publicOrigin = $('public-origin').value; syncPlan(); } });
$('operation-select').addEventListener('change', () => { state.operation = Number($('operation-select').value); renderOperation(); });
$('add-operation').addEventListener('click', () => {
  if (!state.queries) return notice('Apply valid queries JSON first.', true);
  state.queries.operations ??= [];
  const name = 'operation' + (state.queries.operations.length + 1);
  state.queries.operations.push({ name, handler: 'handle_' + name, admission: 'admit_' + name, root: '', query: '', variables: {}, maxNodes: 100 });
  state.operation = state.queries.operations.length - 1; syncQueries(); renderQueries();
});
$('remove-operation').addEventListener('click', () => {
  const op = state.queries?.operations?.[state.operation]; if (!op) return;
  state.queries.operations.splice(state.operation, 1);
  if (Array.isArray(state.plan?.routes)) { state.plan.routes = state.plan.routes.filter(route => route.operation !== op.name); syncPlan(); }
  syncQueries(); renderQueries();
});
$('add-payment').addEventListener('click', () => {
  if (!state.plan) return notice('Apply valid merchant-plan JSON first.', true);
  const values = choices(state.plan); delete state.plan.payment;
  state.plan.paymentOptions = [...values, { scheme: 'exact', network: '', amount: '', asset: '', payTo: '', maxTimeoutSeconds: 60 }];
  syncPlan(); renderPayments();
});
$('add-route').addEventListener('click', () => {
  const op = state.queries?.operations?.[state.operation];
  if (!op || !state.plan) return notice('Select an operation and apply a valid merchant plan first.', true);
  state.plan.routes ??= [];
  if (state.plan.routes.some(route => route.operation === op.name)) return notice('This operation already has a route.');
  state.plan.routes.push({ id: op.name, path: '/queries/' + op.name, operation: op.name,
    serviceName: $('project-title').value, description: '', variables: {}, variableDescriptions: {} });
  syncPlan(); renderRoute();
});
for (const [buttonId, field, target, render] of [['apply-queries', 'queries-text', 'queries', renderQueries], ['apply-plan', 'plan-text', 'plan', renderPlan]])
  $(buttonId).addEventListener('click', () => {
    try { state[target] = editorObject($(field).value, target); changed(); render(); notice('JSON applied to the editors.'); }
    catch (error) { state[target] = null; render(); notice(error.message, true); }
  });
for (const [id, target, limit] of [['schema-file', 'schema-text', 1024 * 1024], ['queries-file', 'queries-text', 1024 * 1024], ['plan-file', 'plan-text', 262144]])
  $(id).addEventListener('change', () => action('Loading selected local file…', async () => {
    const file = $(id).files[0]; if (!file) return;
    if (file.size > limit) throw new Error('Selected file exceeds its input limit.');
    $(target).value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    changed(); if (id !== 'schema-file') loadEditors(); notice('Loaded ' + file.name + '. Save to retain it in this project.'); $(id).value = '';
  }));
$('new-project').addEventListener('click', () => { if (discard()) { fresh(); notice('New project opened.'); } });
$('refresh').addEventListener('click', () => action('Refreshing projects…', async () => { await projects(); notice('Projects refreshed.'); }));
$('save').addEventListener('click', () => action('Saving private project revision…', async () => {
  const saved = await api('/api/save', { id: $('project-id').value, input: input(), expectedRevision: state.revision });
  const reviewed = state.review; loadDraft(saved); state.review = reviewed; if (reviewed) renderReview(reviewed);
  await projects(); await historyList(); notice('Saved revision ' + saved.revision + '.');
}));
$('inspect-schema').addEventListener('click', () => action('Inspecting the original query service schema…', async () => {
  const result = await api('/api/schema', { schemaText: $('schema-text').value });
  $('schema-status').textContent = result.format + ' · original schema accepted';
  renderSchema(result);
  notice('Schema inspection completed.');
}));
$('review').addEventListener('click', () => action('Reviewing the current merchant draft…', async () => {
  const reviewed = await api('/api/review', { input: input() }); state.review = reviewed; renderReview(reviewed);
  notice(state.dirty || !state.saved ? 'Merchant review completed. Save this draft to export these exact contents.' : 'Merchant review completed. The saved project is ready to export.');
  $('review-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
$('export').addEventListener('click', () => action('Exporting through the original merchant compiler…', async () => {
  const result = await api('/api/export', { id: state.saved.id, expectedRevision: state.revision });
  const reviewed = state.review; loadDraft(result.project); state.review = reviewed; state.exportId = result.exported.id;
  if (reviewed) renderReview(reviewed); renderExports(); await projects(); await historyList(); notice('Merchant package exported to ' + result.exported.directory + '.');
}));
$('start').addEventListener('click', () => action('Starting the original merchant runtime…', async () => {
  const result = await api('/api/start', { id: state.saved.id, expectedRevision: state.revision, exportId: state.exportId,
    allowLoopback: $('allow-loopback').checked, facilitator: $('facilitator').value });
  renderRuntime(result); notice('Original merchant started in ' + result.mode + ' mode.');
}));
$('stop').addEventListener('click', () => action('Draining the managed merchant…', async () => { renderRuntime(await api('/api/stop', {})); notice('Managed merchant stopped.'); }));
$('runtime-refresh').addEventListener('click', () => action('Refreshing runtime…', async () => { renderRuntime(await api('/api/runtime')); notice('Runtime refreshed.'); }));
$('history-refresh').addEventListener('click', () => action('Refreshing project history…', async () => { await historyList(); notice('Project history refreshed.'); }));
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
fresh();
action('Opening private workspace…', async () => {
  if (!token) throw new Error('Open the complete private URL printed by the workspace launcher.');
  await projects(); $('connection').textContent = 'Private local workspace'; notice('Workspace ready. Load your original schema, queries and merchant plan.');
});
