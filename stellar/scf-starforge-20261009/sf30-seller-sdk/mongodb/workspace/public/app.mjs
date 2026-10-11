// MIT. Browser editing and exact-value inspection over the native MongoDB workspace.
import { createMongoPublicationPanel } from './publisher.mjs';
let publicationPanel = null;
const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const pretty = value => JSON.stringify(value, null, 2);
const own = (value, key) => Object.hasOwn(value ?? {}, key);
const state = { source: null, plan: null, revision: null, headRevision: null, selectedRevision: null, query: null,
  route: null, dirty: false, pending: new Set(), review: null, package: null, result: null,
  buyer: null, catalogue: null, history: [], historyBefore: null, localDraft: null };
const tokenKey = 'mongodb-workspace-token:' + location.origin;
let token = location.hash.slice(1) || sessionStorage.getItem(tokenKey);
if (token) { sessionStorage.setItem(tokenKey, token); history.replaceState(null, '', location.pathname); }
const node = (tag, text, className) => {
  const value = document.createElement(tag); if (text !== undefined) value.textContent = String(text);
  if (className) value.className = className; return value;
};
const button = (text, action, className) => {
  const value = node('button', text, className); value.type = 'button';
  value.addEventListener('click', action); return value;
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function parse(text, label, array = false) {
  let value; try { value = JSON.parse(text); } catch { throw new Error(label + ' must contain valid JSON'); }
  if (array ? !Array.isArray(value) : !object(value)) throw new Error(label + ' must be a JSON ' + (array ? 'array' : 'object'));
  return value;
}
function notice(text, error = false) {
  $('notice').textContent = text; $('notice').hidden = !text; $('notice').dataset.error = String(error);
}
async function api(path, body) {
  const response = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store' });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Workspace request failed (' + response.status + ')');
  return value;
}
async function run(action) {
  const controls = [...document.querySelectorAll('button,input,select,textarea')].map(item => [item, item.disabled]);
  controls.forEach(([item]) => { item.disabled = true; }); document.body.setAttribute('aria-busy', 'true');
  try { await action(); } catch (error) { notice(error.message, true); }
  finally { controls.forEach(([item, disabled]) => { item.disabled = disabled; }); document.body.removeAttribute('aria-busy'); publicationPanel?.update(); }
}
function draftKey() { return 'mongodb-workspace-draft:' + state.directory; }
function cache() {
  if (!state.directory || !state.source) return;
  if (state.localDraft && !state.dirty && !state.pending.size) {
    sessionStorage.setItem(draftKey(), pretty(state.localDraft)); return;
  }
  const pending = Object.fromEntries([...state.pending].map(id => [id, $(id).value]));
  sessionStorage.setItem(draftKey(), pretty({ baseRevision: state.revision, selectedRevision: state.selectedRevision,
    source: state.source, plan: state.plan, dirty: state.dirty, query: state.query, route: state.route, pending }));
}
function status() {
  $('draft-status').textContent = state.dirty || state.pending.size ? 'Unsaved draft' :
    state.selectedRevision !== state.revision ? 'Historical revision selected' : 'Saved revision';
  $('revision-label').textContent = state.selectedRevision ? String(state.selectedRevision) : '';
  $('footer-status').textContent = Object.keys(state.source?.queries ?? {}).length + ' named reports · ' +
    (state.plan?.routes?.length ?? 0) + ' merchant routes' + (state.dirty || state.pending.size ? ' · changes pending' : '') +
    (state.headRevision !== null && state.headRevision !== state.revision ? ' · newer saved revision available' : '');
}
function syncEditors() {
  if (!state.pending.has('source-json')) $('source-json').value = pretty(state.source);
  if (!state.pending.has('plan-json')) $('plan-json').value = pretty(state.plan);
  if (query() && !state.pending.has('query-json')) $('query-json').value = pretty(query());
}
function dirty() { state.dirty = true; state.review = null; syncEditors(); status(); cache(); }
function pending(id) { state.pending.add(id); dirty(); }
function showTab(name) {
  for (const tab of ['source', 'reports', 'merchant', 'review', 'packages', 'publisher']) $(tab + '-panel').hidden = name !== tab;
  document.querySelectorAll('[data-tab]').forEach(item => item.classList.toggle('active', item.dataset.tab === name));
  publicationPanel?.show(name === 'publisher');
}
function query() { return state.source?.queries?.[state.query]; }
function route() { return state.plan?.routes?.find(item => item.id === state.route); }
function choices(target) { return own(target, 'paymentOptions') ? target.paymentOptions : target?.payment ? [target.payment] : []; }
function setChoices(target, values) {
  delete target.payment; delete target.paymentOptions;
  if (values.length === 1) target.payment = values[0]; else target.paymentOptions = values;
}
const newChoice = () => ({ scheme: 'exact', network: 'stellar:testnet', asset: '', payTo: '', amount: '', maxTimeoutSeconds: 60 });
function field(label, value, update, { number = false, area = false } = {}) {
  const wrap = node('label', label), input = document.createElement(area ? 'textarea' : 'input');
  if (!area) input.type = number ? 'number' : 'text'; else input.rows = 3;
  input.value = value ?? ''; input.spellcheck = false;
  input.addEventListener('change', () => {
    try { update(number ? Number(input.value) : input.value); input.removeAttribute('aria-invalid'); dirty(); }
    catch (error) { input.setAttribute('aria-invalid', 'true'); notice(error.message, true); }
  });
  wrap.append(input); return wrap;
}
function payments(container, target) {
  container.replaceChildren();
  choices(target).forEach((choice, index) => {
    const card = node('div', undefined, 'payment-row'), heading = node('div', 'Choice ' + index, 'payment-index');
    heading.append(button('Remove', () => {
      const values = choices(target); values.splice(index, 1); setChoices(target, values); dirty(); payments(container, target);
    }, 'small'));
    const grid = node('div', undefined, 'form-grid');
    grid.append(field('Network', choice.network, value => { choice.network = value; }),
      field('Amount, atomic units', choice.amount, value => { choice.amount = value; }),
      field('Asset / token contract', choice.asset, value => { choice.asset = value; }),
      field('Merchant recipient', choice.payTo, value => { choice.payTo = value; }),
      field('Timeout, seconds', choice.maxTimeoutSeconds, value => { choice.maxTimeoutSeconds = value; }, { number: true }));
    const extra = node('details', undefined, 'spaced'); extra.append(node('summary', 'Complete option extensions'));
    extra.append(field('extra, JSON object', choice.extra === undefined ? '' : pretty(choice.extra), value => {
      if (!value.trim()) delete choice.extra; else choice.extra = parse(value, 'Payment extensions');
    }, { area: true }));
    card.append(heading, grid, extra); container.append(card);
  });
  if (!container.children.length) container.append(node('p', 'Add a complete payment choice or inherit the defaults.', 'help'));
}
function selectOptions(target, values, selected) {
  target.replaceChildren(...values.map(item => {
    const option = node('option', typeof item === 'string' ? item : item.label);
    option.value = typeof item === 'string' ? item : item.value; return option;
  }));
  if (selected !== undefined && [...target.options].some(item => item.value === String(selected))) target.value = selected;
}
function renderSource() {
  const connection = state.source.connection;
  $('database').value = connection.database ?? ''; $('uri-env').value = connection.uriEnv ?? '';
  $('tls').value = connection.tls ?? 'required'; $('ca-file').value = connection.caFile ?? '';
  $('database-label').textContent = connection.database; $('workspace-label').textContent = state.directory;
  if (!state.pending.has('source-json')) $('source-json').value = pretty(state.source);
}
function applyQueryEditor() {
  if (!query()) return;
  if (state.pending.has('query-json')) throw new Error('Apply the complete report JSON before continuing');
  if (state.pending.has('query-pipeline')) {
    query().pipeline = parse($('query-pipeline').value, 'Aggregation pipeline', true);
    state.pending.delete('query-pipeline');
  }
}
function applyRouteEditor() {
  if (!route()) return;
  for (const [id, key, label] of [['route-example', 'example', 'Public inputs'],
    ['route-descriptions', 'parameterDescriptions', 'Input descriptions']]) {
    if (state.pending.has(id)) { route()[key] = parse($(id).value, label); state.pending.delete(id); }
  }
}
function applyEditors() {
  const invalid = document.querySelector('[aria-invalid="true"]');
  if (invalid) { invalid.focus(); throw new Error('Correct the input that was rejected before continuing'); }
  if (state.pending.has('source-json') || state.pending.has('plan-json'))
    throw new Error('Apply or reset the complete source / merchant JSON edits before continuing');
  applyQueryEditor(); applyRouteEditor(); syncEditors(); cache(); status();
}
function renderQueryList() {
  const list = $('query-list'); list.replaceChildren();
  for (const [id, report] of Object.entries(state.source.queries)) {
    const item = button(id, () => {
      try { applyQueryEditor(); state.query = id; renderQueries(); cache(); } catch (error) { notice(error.message, true); }
    }, state.query === id ? 'active' : '');
    item.append(node('small', report.collection + ' · ' + Object.keys(report.parameters ?? {}).length + ' inputs'));
    list.append(item);
  }
}
function exactDefault(value, type) {
  if (value === 'null') return null;
  if (type === 'boolean') {
    if (!['true', 'false'].includes(value)) throw new Error('A boolean default must be true or false');
    return value === 'true';
  }
  if (type === 'number') {
    if (!value.trim() || !Number.isFinite(Number(value))) throw new Error('A numeric default must be finite');
    return Number(value);
  }
  return value;
}
function renderParameters() {
  const list = $('parameter-list'); list.replaceChildren();
  for (const [name, spec] of Object.entries(query().parameters ?? {})) {
    const card = node('div', undefined, 'parameter-card'), heading = node('div', name, 'parameter-title');
    heading.append(button('Remove', () => {
      delete query().parameters[name]; dirty(); renderParameters(); renderQueryList();
    }, 'small'));
    const grid = node('div', undefined, 'form-grid'), label = node('label', 'Type'), selector = document.createElement('select');
    selectOptions(selector, ['string', 'integer', 'decimal', 'number', 'boolean', 'objectId', 'date'], spec.type);
    selector.addEventListener('change', () => { spec.type = selector.value; dirty(); renderParameters(); });
    label.append(selector); grid.append(label);
    const hasDefault = node('label', undefined, 'check'), checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    checkbox.checked = own(spec, 'default'); hasDefault.append(checkbox, document.createTextNode('Use a default value'));
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) spec.default = spec.type === 'boolean' ? false : spec.type === 'number' ? 0 : '';
      else delete spec.default; dirty(); renderParameters();
    }); grid.append(hasDefault);
    if (own(spec, 'default')) grid.append(field('Exact default (null for null)', spec.default === null ? 'null' : String(spec.default),
      value => { spec.default = exactDefault(value, spec.type); }));
    const constraints = Object.fromEntries(Object.entries(spec).filter(([key]) => !['type', 'default'].includes(key)));
    grid.append(field('Constraints, JSON', pretty(constraints), value => {
      const additional = parse(value, 'Input constraints');
      if (own(additional, 'type') || own(additional, 'default')) throw new Error('Edit type and default in their own controls');
      for (const key of Object.keys(spec)) if (!['type', 'default'].includes(key)) delete spec[key];
      Object.assign(spec, additional);
    }, { area: true }));
    card.append(heading, grid); list.append(card);
  }
  if (!list.children.length) list.append(node('p', 'This report has no buyer inputs.', 'help'));
}
function renderQueries() {
  if (!query()) state.query = Object.keys(state.source.queries)[0] ?? null;
  renderQueryList(); $('query-editor').hidden = !query(); if (!query()) return;
  const current = query(); $('query-title').textContent = state.query;
  $('query-collection').value = current.collection; $('query-concern').value = current.readConcern ?? 'snapshot';
  $('query-rows').value = current.maxRows ?? 100; $('query-bytes').value = current.maxBytes ?? 524288;
  $('query-timeout').value = current.timeoutMs ?? 5000; $('query-columns').value = (current.columns ?? []).join('\n');
  if (!state.pending.has('query-pipeline')) $('query-pipeline').value = pretty(current.pipeline);
  if (!state.pending.has('query-json')) $('query-json').value = pretty(current);
  renderParameters();
}
function renderRouteList() {
  const list = $('route-list'); list.replaceChildren();
  for (const item of state.plan.routes) {
    const entry = button(item.id, () => {
      try { applyRouteEditor(); state.route = item.id; renderRoutes(); cache(); } catch (error) { notice(error.message, true); }
    }, state.route === item.id ? 'active' : '');
    entry.append(node('small', item.method + ' ' + item.path)); list.append(entry);
  }
}
function renderRoutes() {
  if (!route()) state.route = state.plan.routes[0]?.id ?? null;
  renderRouteList(); $('route-editor').hidden = !route(); if (!route()) return;
  const current = route(); $('route-title').textContent = current.id;
  for (const [id, value] of [['route-method', current.method], ['route-path', current.path],
    ['route-service', current.serviceName], ['route-description', current.description],
    ['route-tags', (current.tags ?? []).join(', ')]]) $(id).value = value ?? '';
  selectOptions($('route-query'), Object.keys(state.source.queries), current.query);
  if (!state.pending.has('route-example')) $('route-example').value = pretty(current.example ?? {});
  if (!state.pending.has('route-descriptions')) $('route-descriptions').value = pretty(current.parameterDescriptions ?? {});
  const override = own(current, 'payment') || own(current, 'paymentOptions');
  $('override-payment').checked = override; $('route-payment-section').hidden = !override;
  payments($('route-payments'), current);
}
function renderMerchant() {
  $('public-origin').value = state.plan.publicOrigin ?? ''; payments($('default-payments'), state.plan); renderRoutes();
  if (!state.pending.has('plan-json')) $('plan-json').value = pretty(state.plan);
}
function renderRunChoices() {
  const selected = $('run-query').value;
  selectOptions($('run-query'), Object.keys(state.source.queries), selected);
  $('run-revision').value = state.selectedRevision ?? '';
  if (!state.runInputEdited) setRunExample();
}
function setRunExample() {
  const selected = $('run-query').value;
  const found = state.plan.routes.find(item => item.query === selected);
  $('run-input').value = pretty(found?.example ?? Object.fromEntries(Object.entries(state.source.queries[selected]?.parameters ?? {})
    .filter(([, spec]) => own(spec, 'default')).map(([name, spec]) => [name, spec.default])));
  state.runInputEdited = false;
}
function renderAll() {
  renderSource(); renderQueries(); renderMerchant(); renderRunChoices(); status();
}
function table(headers, rows) {
  const wrap = node('div', undefined, 'table-wrap'), result = document.createElement('table'),
    head = document.createElement('thead'), tr = document.createElement('tr'), body = document.createElement('tbody');
  headers.forEach(value => tr.append(node('th', value))); head.append(tr); result.append(head);
  for (const values of rows) {
    const row = document.createElement('tr');
    values.forEach(value => { const cell = document.createElement('td'); cell.append(value instanceof Node ? value : document.createTextNode(String(value ?? ''))); row.append(cell); });
    body.append(row);
  } result.append(body); wrap.append(result); return wrap;
}
function renderCatalogue(data) {
  state.catalogue = data; const catalog = data.catalogue ?? data.catalog ?? data;
  const container = $('catalog'); container.replaceChildren();
  $('catalog-description').textContent = (catalog.database ?? state.source.connection.database) + ' · MongoDB ' +
    (catalog.serverVersion ?? 'unknown version') + ' · ' + (catalog.topology ?? '') + ' · ' + new Date(catalog.capturedAt).toLocaleString();
  $('collections').replaceChildren(...(catalog.collections ?? []).map(item => { const option = document.createElement('option'); option.value = item.name; return option; }));
  for (const item of catalog.collections ?? []) {
    const group = node('section', undefined, 'catalog-collection');
    group.append(node('h3', item.name), node('p', item.type + ' · ' + item.sampled + ' documents inspected', 'help'));
    group.append(table(['Field', 'Observed BSON types', 'Present', 'Missing'], (item.fields ?? []).map(field =>
      [field.path, pretty(field.types), field.present, field.missing])));
    const detail = document.createElement('details'); detail.className = 'spaced';
    detail.append(node('summary', 'Sample values and indexes'),
      node('pre', pretty({ sampleMethod: catalog.sampleMethod, samples: item.samples, indexes: item.indexes, indexAvailability: item.indexAvailability })));
    group.append(detail); container.append(group);
  }
}
function renderReview(review) {
  const container = $('review-content'); container.className = ''; container.replaceChildren();
  const facts = node('div', undefined, 'card facts');
  for (const [label, value] of [['Database', review.database], ['Reports', review.queryCount], ['Routes', review.routes.length], ['Public origin', review.publicOrigin]]) {
    const fact = node('div', undefined, 'fact'); fact.append(node('strong', value), node('span', label)); facts.append(fact);
  } container.append(facts);
  for (const item of review.routes) {
    const card = node('article', undefined, 'card');
    card.append(node('h3', item.id + ' · ' + item.method), node('p', item.url, 'mono break'),
      node('p', item.description), node('p', item.collection + ' · ' + item.readConcern + ' read · ' + item.maxRows + ' rows maximum', 'help'));
    card.append(table(['Input', 'Type', 'Contract', 'Public example'], Object.entries(item.parameters).map(([name, spec]) =>
      [name, spec.type, pretty(spec), pretty(item.example[name])])));
    card.append(table(['Choice', 'Network', 'Asset', 'Amount', 'Recipient', 'Timeout'], item.offer.accepts.map((option, index) =>
      [index, option.network, node('code', option.asset), node('code', option.amount), node('code', option.payTo), option.maxTimeoutSeconds + 's'])));
    const detail = document.createElement('details'); detail.className = 'spaced';
    detail.append(node('summary', 'Exact public columns and complete original offer'),
      node('pre', pretty({ columns: item.columns, offer: item.offer }))); card.append(detail); container.append(card);
  }
}
function renderResult(envelope) {
  state.result = envelope; const result = envelope.result ?? envelope;
  const container = $('run-result'); container.replaceChildren();
  const meta = node('div', undefined, 'run-meta');
  for (const text of [result.rowCount + ' rows', result.truncated ? 'Row limit reached' : 'Complete within declared limits',
    result.valueEncoding, result.read?.concern + ' read']) meta.append(node('span', text, 'tag'));
  container.append(meta);
  const rows = result.rows ?? [];
  container.append(table(result.columns ?? [], rows.slice(0, 100).map(row => result.columns.map(name =>
    node('div', own(row, name) ? pretty(row[name]) : '(field absent)', 'row-value')))));
  if (rows.length > 100) container.append(node('p', 'The first 100 rows are displayed. The download contains every returned row.', 'help'));
  const detail = document.createElement('details'); detail.className = 'spaced';
  detail.append(node('summary', 'Read semantics and exact BSON column types'),
    node('pre', pretty({ revision: envelope.revision, read: result.read, columnTypes: result.columnTypes,
      missingFieldEncoding: result.missingFieldEncoding }))); container.append(detail);
  $('download-result').hidden = false;
}
async function download(path, name) {
  const response = await fetch('/api/' + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!response.ok) { const value = await response.json(); throw new Error(value.error); }
  const href = URL.createObjectURL(await response.blob()), anchor = document.createElement('a');
  anchor.href = href; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(href), 10000);
}
function installSnapshot(snapshot, { preserveBase = false, preserveLocalDraft = false } = {}) {
  if (!preserveLocalDraft) state.localDraft = null;
  state.source = clone(snapshot.source); state.plan = clone(snapshot.plan); state.selectedRevision = snapshot.revision;
  if (!preserveBase) state.revision = snapshot.revision;
  state.headRevision = snapshot.currentRevision ?? state.revision;
  state.query = Object.keys(state.source.queries)[0] ?? null; state.route = state.plan.routes[0]?.id ?? null;
  state.dirty = false; state.pending.clear(); state.review = null; state.runInputEdited = false;
  renderAll(); cache();
}
async function historyPage(append = false) {
  const result = await api('history' + (append && state.historyBefore ? '?before=' + encodeURIComponent(state.historyBefore) : ''));
  state.history = append ? [...state.history, ...result.revisions] : result.revisions;
  state.historyBefore = result.nextBefore; state.headRevision = result.currentRevision;
  const list = $('history-list'); list.replaceChildren();
  for (const version of state.history) {
    const item = button('Revision ' + version.revision, () => run(async () => {
      if ((state.dirty || state.pending.size) && !confirm('Open this saved revision and replace this tab’s draft?')) return;
      const snapshot = await api('history/' + encodeURIComponent(version.revision));
      state.revision = snapshot.currentRevision;
      installSnapshot(snapshot, { preserveBase: true }); await historyPage(); notice('Opened the retained source and merchant plan for this revision.');
    }), version.revision === state.selectedRevision ? 'active' : '');
    item.append(node('small', new Date(version.updatedAt).toLocaleString())); list.append(item);
  } $('more-history').hidden = !state.historyBefore; status();
}
function requireSaved() {
  applyEditors();
  if (state.dirty) throw new Error('Save the current draft before running, inspecting or exporting it');
  if (state.headRevision !== state.revision) throw new Error('A newer revision has been saved. Reload it before running or exporting.');
  if (state.selectedRevision !== state.revision) throw new Error('Save this historical revision as a new current revision before running or exporting it');
  return state.revision;
}
async function save() {
  applyEditors();
  const snapshot = await api('save', { expectedRevision: state.revision, source: state.source, plan: state.plan });
  installSnapshot(snapshot); await historyPage(); notice('Saved the source and merchant plan as one native revision.');
}
async function review() {
  applyEditors(); state.review = await api('review', { source: state.source, plan: state.plan });
  renderReview(state.review); showTab('review'); notice('Compiled every route through the original seller and MongoDB parameter binder.');
}
function defaultBuyerInput() {
  const plan = state.package?.plan, selected = plan?.routes?.find(item => item.id === $('buyer-route').value);
  $('buyer-input').value = pretty(selected?.example ?? {});
}
function renderPackage(item) {
  state.package = item;
  const container = $('package-content'); container.hidden = false; container.replaceChildren();
  const card = node('div', undefined, 'card');
  card.append(node('h3', item.id), node('p', 'Saved revision ' + item.revision, 'help'));
  const actions = node('div', undefined, 'actions'); actions.append(button('Download complete package', () => run(() =>
    download('files/packages/' + item.id + '/package.tar.gz', 'MongoDB-Merchant-' + item.id + '.tar.gz'))));
  card.append(actions);
  card.append(table(['File', 'Bytes', 'Download'], [...Object.entries(item.manifest.files), ['manifest.json', { bytes: null }]].map(([name, binding]) =>
    [name, binding.bytes ?? 'Manifest', button('Download', () => run(() =>
      download('files/packages/' + item.id + '/' + name.split('/').map(encodeURIComponent).join('/'), name.split('/').at(-1))), 'small')])));
  card.append(node('p', 'Connection environment: ' + item.manifest.requiredEnvironment.join(', '), 'help'));
  container.append(card); $('buyer-card').hidden = false; $('seller-card').hidden = false;
  selectOptions($('buyer-route'), item.plan.routes.map(value => ({ value: value.id, label: value.id + ' · ' + value.method })));
  $('buyer-intent').value = 'mongodb-' + Date.now(); defaultBuyerInput();
  $('operator-commands').textContent = item.commands;
  renderSeller(item.seller);
}
function renderSeller(seller) {
  state.seller = seller ?? null;
  $('seller-status').textContent = seller ? seller.origin + ' · ' + seller.mode + ' · package ' + seller.packageId :
    'Start this package with the connection environment of this workspace.';
  $('stop-seller').hidden = !seller; $('start-seller').hidden = !!seller && seller.packageId === state.package?.id;
  $('seller-operations').hidden = !seller?.operationsUrl;
  if (seller?.operationsUrl) $('seller-operations').href = seller.operationsUrl;
}
async function listPackages() {
  const result = await api('packages'), list = $('package-list'); list.className = 'card'; list.replaceChildren();
  if (!result.items.length) { list.className += ' empty'; list.textContent = 'Prepared packages will appear here.'; return; }
  for (const item of result.items) {
    const entry = button(item.id, () => run(async () => renderPackage(await api('packages/' + item.id))));
    entry.append(node('small', 'Revision ' + item.revision + ' · ' + new Date(item.createdAt).toLocaleString()));
    list.append(entry);
  }
}
function on(id, action) { $(id).addEventListener('click', () => run(action)); }
function changed(id, action) {
  $(id).addEventListener('change', () => { try { action($(id).value); dirty(); } catch (error) { notice(error.message, true); } });
}
document.querySelectorAll('[data-tab]').forEach(item => item.addEventListener('click', () => showTab(item.dataset.tab)));
for (const id of ['source-json', 'query-pipeline', 'query-json', 'route-example', 'route-descriptions', 'plan-json'])
  $(id).addEventListener('input', () => pending(id));
for (const [id, key] of [['database', 'database'], ['uri-env', 'uriEnv'], ['tls', 'tls']])
  changed(id, value => { state.source.connection[key] = value; });
changed('ca-file', value => { if (value.trim()) state.source.connection.caFile = value; else delete state.source.connection.caFile; });
changed('query-collection', value => { query().collection = value; renderQueryList(); });
changed('query-concern', value => { query().readConcern = value; });
for (const [id, key] of [['query-rows', 'maxRows'], ['query-bytes', 'maxBytes'], ['query-timeout', 'timeoutMs']])
  changed(id, value => { query()[key] = Number(value); });
changed('query-columns', value => { query().columns = value.split('\n').map(item => item.trim()).filter(Boolean); });
changed('public-origin', value => { state.plan.publicOrigin = value; });
for (const [id, key] of [['route-method', 'method'], ['route-path', 'path'], ['route-query', 'query'],
  ['route-service', 'serviceName'], ['route-description', 'description']])
  changed(id, value => { route()[key] = value; renderRouteList(); });
changed('route-tags', value => { route().tags = value.split(',').map(item => item.trim()).filter(Boolean); });
$('override-payment').addEventListener('change', () => {
  if ($('override-payment').checked) setChoices(route(), clone(choices(state.plan)));
  else { delete route().payment; delete route().paymentOptions; }
  dirty(); renderRoutes();
});
on('add-default-payment', () => { setChoices(state.plan, [...choices(state.plan), newChoice()]); dirty(); payments($('default-payments'), state.plan); });
on('add-route-payment', () => { setChoices(route(), [...choices(route()), newChoice()]); dirty(); payments($('route-payments'), route()); });
function askName(label, existing, pattern) {
  const value = prompt(label); if (value === null) return null;
  if (!pattern.test(value) || existing.includes(value)) throw new Error('Choose an unused identifier using letters, digits and underscores');
  return value;
}
on('add-query', () => {
  applyQueryEditor(); const name = askName('Report identifier', Object.keys(state.source.queries), /^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
  if (!name) return;
  state.source.queries[name] = { collection: state.catalogue?.catalogue?.collections?.[0]?.name ?? query()?.collection ?? '',
    pipeline: [{ $match: {} }], parameters: {}, columns: ['_id'], maxRows: 100, maxBytes: 524288, timeoutMs: 5000, readConcern: 'snapshot' };
  state.query = name; dirty(); renderQueries(); renderRunChoices(); renderRoutes();
});
on('duplicate-query', () => {
  applyQueryEditor(); const name = askName('New report identifier', Object.keys(state.source.queries), /^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
  if (!name) return; state.source.queries[name] = clone(query()); state.query = name; dirty(); renderQueries(); renderRunChoices(); renderRoutes();
});
on('remove-query', () => {
  if (state.plan.routes.some(item => item.query === state.query)) throw new Error('Reassign or remove the merchant routes using this report first');
  delete state.source.queries[state.query]; state.query = null; dirty(); renderQueries(); renderRunChoices();
});
on('add-parameter', () => {
  const name = askName('Input name (use $$sf30_' + 'name in the pipeline)', Object.keys(query().parameters ?? {}), /^[a-z][A-Za-z0-9_]{0,55}$/);
  if (!name) return; query().parameters ??= {}; query().parameters[name] = { type: 'string', maxLength: 128 };
  dirty(); renderParameters(); renderQueryList();
});
on('apply-query-json', () => {
  const value = parse($('query-json').value, 'Report declaration');
  state.source.queries[state.query] = value; state.pending.delete('query-json'); state.pending.delete('query-pipeline'); dirty(); renderQueries();
});
on('add-route', () => {
  applyRouteEditor(); const id = askName('Route identifier', state.plan.routes.map(item => item.id), /^[A-Za-z0-9_-]{1,64}$/);
  if (!id) return;
  const name = state.query ?? Object.keys(state.source.queries)[0], parameters = state.source.queries[name]?.parameters ?? {};
  state.plan.routes.push({ id, query: name, method: 'GET', path: '/reports/' + id, serviceName: id.slice(0, 32),
    description: 'Describe this report for buyers', tags: ['mongodb', 'data'],
    example: Object.fromEntries(Object.entries(parameters).filter(([, spec]) => own(spec, 'default') && spec.default !== null).map(([key, spec]) => [key, spec.default])),
    parameterDescriptions: Object.fromEntries(Object.keys(parameters).map(key => [key, key])) });
  state.route = id; dirty(); renderRoutes(); renderRunChoices();
});
on('remove-route', () => { state.plan.routes = state.plan.routes.filter(item => item.id !== state.route); state.route = null; dirty(); renderRoutes(); });
on('apply-source-json', () => {
  const value = parse($('source-json').value, 'Source declaration');
  if (!object(value.connection) || !object(value.queries)) throw new Error('The source needs connection and queries objects');
  state.source = value; state.pending.delete('source-json'); state.pending.delete('query-json'); state.pending.delete('query-pipeline');
  dirty(); renderAll();
});
on('reset-source-json', () => { state.pending.delete('source-json'); $('source-json').value = pretty(state.source); status(); cache(); });
on('apply-plan-json', () => {
  const value = parse($('plan-json').value, 'Merchant plan');
  if (!Array.isArray(value.routes)) throw new Error('The merchant plan needs its routes array');
  state.plan = value; state.pending.delete('plan-json'); state.pending.delete('route-example'); state.pending.delete('route-descriptions');
  dirty(); renderAll();
});
on('reset-plan-json', () => { state.pending.delete('plan-json'); $('plan-json').value = pretty(state.plan); status(); cache(); });
on('inspect-source', async () => {
  const expectedRevision = requireSaved();
  renderCatalogue(await api('catalogue', { expectedRevision, sampleSize: Number($('sample-size').value) }));
  notice('Loaded the current database catalogue and retained its sample with this revision.');
});
on('save-revision', save); on('review-current', review);
on('refresh-history', () => historyPage()); on('more-history', () => historyPage(true));
on('reload-saved', async () => {
  if ((state.dirty || state.pending.size) && !confirm('Reload the current saved revision and replace this tab’s draft?')) return;
  installSnapshot((await api('bootstrap')).snapshot); await historyPage(); notice('Opened the latest native saved revision.');
});
function restoreLocalDraft() {
  if (!state.localDraft) return;
  const draft = state.localDraft; state.source = clone(draft.source); state.plan = clone(draft.plan);
  state.query = draft.query; state.route = draft.route; state.dirty = true; state.pending = new Set(Object.keys(draft.pending ?? {}));
  renderAll(); for (const [id, text] of Object.entries(draft.pending ?? {})) $(id).value = text;
  state.localDraft = null; cache(); status(); $('restore-local').hidden = true;
  notice('Restored the tab draft. Saving will compare it with the current native revision.');
}
on('restore-local', restoreLocalDraft);
$('run-query').addEventListener('change', setRunExample);
$('run-input').addEventListener('input', () => { state.runInputEdited = true; });
on('run-report', async () => {
  const expectedRevision = requireSaved(), queryName = $('run-query').value;
  renderResult(await api('preview', { expectedRevision, query: queryName, input: parse($('run-input').value, 'Report inputs') }));
  notice('Executed the saved fixed pipeline against the configured MongoDB source.');
});
on('download-result', () => download('files/results/' + state.result.id + '/result.json', state.result.query + '-result.json'));
on('prepare-package', async () => {
  const expectedRevision = requireSaved(), result = await api('prepare', { expectedRevision });
  await listPackages(); renderPackage(result); notice('Prepared and reopened the original seller package from this saved revision.');
});
$('buyer-route').addEventListener('change', defaultBuyerInput);
on('start-seller', async () => {
  renderSeller(await api('seller/start', { packageId: state.package.id }));
  notice('Started the original seller and its operations console from this prepared package.');
});
on('stop-seller', async () => { await api('seller/stop', {}); renderSeller(null); notice('The local seller has drained and closed.'); });
on('prepare-buyer', async () => {
  const result = await api('buyer', { packageId: state.package.id, routeId: $('buyer-route').value,
    acceptIndex: Number($('buyer-choice').value), intentId: $('buyer-intent').value, input: parse($('buyer-input').value, 'Buyer inputs') });
  state.buyer = result; $('buyer-result').replaceChildren(node('pre', pretty(result.view)));
  $('download-buyer').hidden = false; notice('Prepared the original buyer review with the selected payment choice and exact inputs.');
});
on('download-buyer', () => download('files/buyers/' + state.buyer.id + '/buyer.tar.gz', 'MongoDB-Buyer-' + state.buyer.id + '.tar.gz'));
publicationPanel = createMongoPublicationPanel({ api, action: run, notice, current: () => state,
  requireSaved, download, isBusy: () => document.body.getAttribute('aria-busy') === 'true' });
window.addEventListener('beforeunload', event => {
  cache(); if (state.dirty || state.pending.size) { event.preventDefault(); event.returnValue = ''; }
});
await run(async () => {
  const opened = await api('bootstrap'); state.directory = opened.snapshot.directory; state.commands = opened.commands;
  let draft; try { draft = JSON.parse(sessionStorage.getItem(draftKey()) ?? 'null'); } catch {}
  state.localDraft = draft?.dirty || Object.keys(draft?.pending ?? {}).length ? draft : null;
  installSnapshot(opened.snapshot, { preserveLocalDraft: true });
  if (draft?.dirty || Object.keys(draft?.pending ?? {}).length) {
    state.localDraft = draft; $('restore-local').hidden = false;
    if (draft.baseRevision === state.revision) restoreLocalDraft();
    else notice('This tab has a retained draft from an earlier revision. Use Restore tab draft to review it against the current source.');
  }
  $('operator-commands').textContent = opened.commands;
  await historyPage(); await listPackages();
  if (opened.catalogue) renderCatalogue(opened.catalogue);
});
