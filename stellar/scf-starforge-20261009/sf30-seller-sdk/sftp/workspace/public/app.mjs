// MIT. SFTP authoring UI; each product opens the original publication console.
const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const pretty = value => JSON.stringify(value, null, 2);
const token = location.hash.slice(1);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const short = value => value ? value.slice(0, 14) + '…' : '—';
const date = value => value ? new Date(value).toLocaleString() : '—';
const words = value => String(value ?? '—').replaceAll('_', ' ').toLowerCase();
const emptySource = () => ({ schema: 'stellar-forge.sftp-source.v1',
  connection: { host: '', port: 22, username: '', hostKeyFingerprints: [], auth: { privateKeyFileEnv: 'SFTP_PRIVATE_KEY_FILE' } },
  root: '/exports', limits: { maxFileBytes: 67108864, maxRowBytes: 1048576, timeoutMs: 300000, maxDirectoryEntries: 10000 }, queries: {} });
const emptyMerchant = () => ({ publicOrigin: '', serviceName: 'SFTP datasets',
  description: 'Retained dataset from a private SFTP report', tags: ['sftp', 'dataset'] });
const emptyPayment = () => ({ scheme: 'exact', network: 'eip155:8453', asset: '', amount: '1000', payTo: '', maxTimeoutSeconds: 60, extraText: '' });
const state = { data: null, source: emptySource(), merchant: emptyMerchant(), merchantEnabled: false,
  paymentStyle: 'paymentOptions', payments: [], baseRevision: 0, dirty: false, busy: false,
  reportKey: '', editor: null, editorDirty: false, tab: 'connection', sample: null,
  publicationId: null, publication: null, runId: null, run: null, offer: null };
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function button(label, action, className) {
  const element = node('button', label, className); element.type = 'button';
  element.addEventListener('click', () => run(action)); return element;
}
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function parse(text, label, array = false) {
  let value; try { value = JSON.parse(text); } catch { throw new Error(label + ' must contain valid JSON.'); }
  if (array ? !Array.isArray(value) : !object(value)) throw new Error(label + ' must be a JSON ' + (array ? 'array.' : 'object.'));
  return value;
}
async function api(path, body) {
  const response = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error ?? 'Workspace operation failed.'), { status: response.status, code: result.code });
  return result;
}
async function run(action) {
  if (state.busy) return;
  state.busy = true; renderStatus();
  try { return await action(); } catch (issue) { notice(issue.message, true); cache(); }
  finally { state.busy = false; renderStatus(); }
}
const cacheKey = () => 'sftp-workspace-draft:' + state.data?.directory;
function cache() {
  if (!state.data) return;
  try {
    if (!state.dirty) sessionStorage.removeItem(cacheKey());
    else sessionStorage.setItem(cacheKey(), JSON.stringify({ version: 1, baseRevision: state.baseRevision,
      source: state.source, merchant: state.merchant, merchantEnabled: state.merchantEnabled,
      paymentStyle: state.paymentStyle, payments: state.payments, reportKey: state.reportKey,
      editor: state.editor, editorDirty: state.editorDirty }));
  } catch { /* The draft remains available in the active tab if browser storage is full. */ }
}
function dirty(editor = false) {
  state.dirty = true; if (editor) state.editorDirty = true;
  renderStatus(); cache();
}
function renderStatus() {
  $('revision-label').textContent = 'Saved revision ' + (state.data?.revision ?? 0);
  $('draft-label').textContent = state.busy ? 'Operation running' : state.dirty ?
    'Draft based on revision ' + state.baseRevision : 'All changes saved';
  $('save').disabled = state.busy; $('reload').disabled = state.busy;
  document.body.setAttribute('aria-busy', String(state.busy));
  const saved = state.data?.source;
  $('source-summary').textContent = saved ? saved.connection.host + ':' + (saved.connection.port ?? 22) +
    ' · ' + saved.root + ' · ' + Object.keys(saved.queries).length + ' saved reports' : 'Save a connection to begin';
  $('workspace-location').textContent = state.data?.directory ?? '';
}
function showTab(name) {
  state.tab = name;
  for (const item of document.querySelectorAll('[data-tab]')) {
    const selected = item.dataset.tab === name;
    item.setAttribute('aria-selected', String(selected)); $(item.dataset.tab).hidden = !selected;
  }
  if (name === 'products' && state.data) run(refreshProducts);
}
function bind(id, action, { checkbox = false, editor = false } = {}) {
  $(id).addEventListener('input', () => { action(checkbox ? $(id).checked : $(id).value); dirty(editor); });
}
function selectOptions(element, entries, selected) {
  element.replaceChildren(...entries.map(({ value, label }) => {
    const item = node('option', label); item.value = value; return item;
  }));
  if (selected !== undefined) element.value = selected;
}
function table(headers, rows) {
  const element = node('table'), head = node('thead'), heading = node('tr'), body = node('tbody');
  for (const header of headers) heading.append(node('th', header));
  head.append(heading);
  for (const row of rows) {
    const line = node('tr');
    for (const value of row) {
      const cell = node('td');
      cell.append(value instanceof Node ? value : node('span', value === null ? 'null' : String(value ?? ''), 'cell-text'));
      line.append(cell);
    }
    body.append(line);
  }
  element.append(head, body); return element;
}
function replaceTable(id, headers, rows, empty) {
  const target = $(id); target.classList.toggle('empty', !rows.length);
  target.replaceChildren(rows.length ? table(headers, rows) : node('span', empty));
}
function makeEditor(name = '', definition = {}) {
  return { name, path: definition.path ?? '', format: definition.format ?? 'csv', recordsPointer: definition.recordsPointer ?? '',
    expectedSha256: definition.expectedSha256 ?? '', columns: Object.entries(definition.columns ?? {}).map(([name, spec]) =>
      ({ name, pointer: spec.pointer ?? '/' + name.replaceAll('~', '~0').replaceAll('/', '~1'), type: spec.type,
        nullable: spec.nullable ?? false, missing: spec.missing ?? 'error' })),
    parametersText: pretty(definition.parameters ?? {}), whereText: pretty(definition.where ?? []) };
}
function applyReport() {
  if (!state.editorDirty) return;
  const current = state.editor, name = current.name;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name))
    throw new Error('Use a report key with 1–48 letters, digits, or underscores, starting with a letter.');
  if (name !== state.reportKey && Object.hasOwn(state.source.queries, name)) throw new Error('A report already uses that key.');
  const columns = Object.create(null);
  for (const field of current.columns) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(field.name) || ['__proto__', 'constructor', 'prototype'].includes(field.name))
      throw new Error('Give each output field a valid name, starting with a letter.');
    if (Object.hasOwn(columns, field.name)) throw new Error('Output field names must be unique.');
    columns[field.name] = { pointer: field.pointer, type: field.type, nullable: field.nullable, missing: field.missing };
  }
  if (!Object.keys(columns).length) throw new Error('Choose at least one output field for this report.');
  const value = { path: current.path, format: current.format, recordsPointer: current.recordsPointer,
    ...(current.expectedSha256 ? { expectedSha256: current.expectedSha256 } : {}), columns,
    parameters: parse(current.parametersText, 'Report parameters'), where: parse(current.whereText, 'Row filters', true) };
  if (state.reportKey && state.reportKey !== name) delete state.source.queries[state.reportKey];
  state.source.queries[name] = value; state.reportKey = name; state.editorDirty = false;
}
function merchantForSave() {
  if (!state.merchantEnabled) return null;
  const choices = state.payments.map(({ extraText, ...choice }) => {
    const result = { ...choice }; delete result.extra;
    if (extraText.trim()) result.extra = parse(extraText, 'Payment extra terms');
    return result;
  });
  const merchant = { ...state.merchant }; delete merchant.payment; delete merchant.paymentOptions;
  if (state.paymentStyle === 'payment' && choices.length === 1) merchant.payment = choices[0];
  else merchant.paymentOptions = choices;
  return merchant;
}
function renderConnection() {
  const source = state.source, connection = source.connection, auth = connection.auth;
  $('host').value = connection.host; $('port').value = connection.port ?? 22;
  $('username').value = connection.username; $('root').value = source.root;
  $('host-pins').value = connection.hostKeyFingerprints.join('\n');
  const method = ['privateKeyFileEnv', 'privateKeyEnv', 'passwordEnv'].find(key => auth[key] !== undefined) ?? 'privateKeyFileEnv';
  $('auth-method').value = method; $('auth-env').value = auth[method] ?? '';
  $('passphrase-env').value = auth.passphraseEnv ?? ''; $('passphrase-env').disabled = method === 'passwordEnv';
  const limits = source.limits ?? {};
  for (const [id, key, fallback] of [['max-file-bytes', 'maxFileBytes', 67108864], ['max-row-bytes', 'maxRowBytes', 1048576],
    ['timeout-ms', 'timeoutMs', 300000], ['max-directory-entries', 'maxDirectoryEntries', 10000]]) $(id).value = limits[key] ?? fallback;
  const environment = state.data.environment ?? [];
  $('environment-status').replaceChildren(...(environment.length ? environment.map(item => {
    const row = node('div', undefined, 'environment-row'); row.append(node('span', item.name), node('span', item.configured ? 'Configured' : 'Missing from launch')); return row;
  }) : [node('p', 'Save the source to inspect its environment references.', 'help')]));
  renderHistory();
}
function renderHistory() {
  $('history').replaceChildren(...state.data.history.map(item => {
    const row = node('div', undefined, 'history-row'), description = node('div');
    description.append(node('p', 'Revision ' + item.revision + ' · ' + item.reports + ' reports'), node('p', date(item.savedAt), 'help'));
    const actions = node('div', undefined, 'actions');
    actions.append(button('Load draft', async () => {
      const retained = await api('revisions/' + item.revision);
      loadEditorState(retained.source, retained.merchant);
      state.dirty = true; renderAll(); cache();
      notice('Loaded revision ' + item.revision + ' into the draft. Save it to create revision ' + (state.baseRevision + 1) + '.');
    }), button('Source JSON', () => download('files/revision/' + item.revision + '/source.json', 'SFTP-Source-Revision-' + item.revision + '.json')));
    if (item.merchantHash) actions.append(button('Merchant JSON', () => download('files/revision/' + item.revision + '/merchant.json', 'SFTP-Merchant-Revision-' + item.revision + '.json')));
    row.append(description, actions); return row;
  }));
  if (!state.data.history.length) $('history').append(node('p', 'No saved revisions yet.', 'help'));
}
function renderReport() {
  if (!state.editor) state.editor = makeEditor();
  selectOptions($('report-select'), [{ value: '', label: 'New report' }, ...Object.keys(state.source.queries).map(value => ({ value, label: value }))], state.reportKey);
  for (const [id, key] of [['report-name', 'name'], ['report-path', 'path'], ['report-format', 'format'], ['report-pointer', 'recordsPointer'],
    ['report-hash', 'expectedSha256'], ['report-parameters', 'parametersText'], ['report-where', 'whereText']]) $(id).value = state.editor[key];
  $('remove-report').disabled = !state.reportKey;
  renderMapping();
}
function renderMapping() {
  $('mapping').replaceChildren(...state.editor.columns.map((field, index) => {
    const row = node('tr');
    for (const [key, label] of [['name', 'Output name'], ['pointer', 'Source pointer']]) {
      const cell = node('td'), input = node('input'); input.value = field[key]; input.spellcheck = false;
      input.setAttribute('aria-label', label + ' ' + (index + 1));
      input.addEventListener('input', () => { field[key] = input.value; dirty(true); }); cell.append(input); row.append(cell);
    }
    const typeCell = node('td'), type = node('select'); type.setAttribute('aria-label', 'Field type ' + (index + 1));
    selectOptions(type, ['string', 'integer', 'number', 'boolean'].map(value => ({ value, label: value === 'string' ? 'Text' : value })), field.type);
    type.addEventListener('change', () => { field.type = type.value; dirty(true); }); typeCell.append(type); row.append(typeCell);
    const nullableCell = node('td'), nullable = node('input'); nullable.type = 'checkbox'; nullable.checked = field.nullable;
    nullable.setAttribute('aria-label', 'Nullable field ' + (index + 1));
    nullable.addEventListener('change', () => { field.nullable = nullable.checked; if (!field.nullable) field.missing = 'error'; dirty(true); renderMapping(); });
    nullableCell.append(nullable); row.append(nullableCell);
    const missingCell = node('td'), missing = node('select'); missing.setAttribute('aria-label', 'Missing field ' + (index + 1));
    selectOptions(missing, [{ value: 'error', label: 'Stop extraction' }, ...(field.nullable ? [{ value: 'null', label: 'Use null' }] : [])], field.missing);
    missing.addEventListener('change', () => { field.missing = missing.value; dirty(true); }); missingCell.append(missing); row.append(missingCell);
    const action = node('td'); action.append(button('Remove', () => { state.editor.columns.splice(index, 1); dirty(true); renderMapping(); })); row.append(action);
    return row;
  }));
}
function paymentField(label, value, action, { number = false, area = false } = {}) {
  const wrap = node('label', label), input = node(area ? 'textarea' : 'input');
  if (!area) input.type = number ? 'number' : 'text'; else input.rows = 3;
  input.value = value ?? ''; input.spellcheck = false;
  input.addEventListener('input', () => { action(number ? Number(input.value) : input.value); dirty(); }); wrap.append(input); return wrap;
}
function renderPayments() {
  $('payments').replaceChildren(...state.payments.map((choice, index) => {
    const card = node('div', undefined, 'payment-card'), heading = node('div', undefined, 'payment-heading');
    heading.append(node('h4', 'Exact payment choice ' + index), button('Remove choice', () => { state.payments.splice(index, 1); dirty(); renderPayments(); }));
    const grid = node('div', undefined, 'form-grid');
    for (const [key, label] of [['network', 'Network'], ['amount', 'Amount in atomic units'], ['asset', 'Asset / token contract'], ['payTo', 'Merchant recipient']])
      grid.append(paymentField(label, choice[key], value => { choice[key] = value; }));
    grid.append(paymentField('Timeout in seconds', choice.maxTimeoutSeconds, value => { choice.maxTimeoutSeconds = value; }, { number: true }));
    const extra = node('details', undefined, 'top-space'); extra.append(node('summary', 'Extra payment terms'),
      paymentField('Extra terms, JSON object', choice.extraText, value => { choice.extraText = value; }, { area: true }));
    card.append(heading, grid, extra); return card;
  }));
  if (!state.payments.length) $('payments').append(node('p', 'Add at least one complete payment choice.', 'help'));
}
function renderMerchant() {
  $('merchant-enabled').checked = state.merchantEnabled; $('merchant-fields').hidden = !state.merchantEnabled;
  for (const [id, key] of [['public-origin', 'publicOrigin'], ['service-name', 'serviceName'], ['merchant-description', 'description']]) $(id).value = state.merchant[key] ?? '';
  $('merchant-tags').value = (state.merchant.tags ?? []).join(', '); renderPayments();
}
function loadEditorState(source, merchant) {
  state.source = clone(source ?? emptySource()); state.source.limits ??= {}; state.source.queries ??= {};
  state.merchant = clone(merchant ?? emptyMerchant()); state.merchantEnabled = Boolean(merchant);
  state.paymentStyle = merchant?.payment ? 'payment' : 'paymentOptions';
  state.payments = (merchant?.paymentOptions ?? (merchant?.payment ? [merchant.payment] : [])).map(choice => ({ ...clone(choice), extraText: choice.extra === undefined ? '' : pretty(choice.extra) }));
  state.reportKey = Object.keys(state.source.queries)[0] ?? ''; state.editor = makeEditor(state.reportKey, state.source.queries[state.reportKey]); state.editorDirty = false;
}
function installSaved(data, restoreCache = false) {
  state.data = data; state.baseRevision = data.revision; state.dirty = false;
  loadEditorState(data.source, data.merchant);
  if (restoreCache) {
    try {
      const retained = JSON.parse(sessionStorage.getItem(cacheKey()) ?? 'null');
      if (retained?.version === 1 && object(retained.source) && object(retained.merchant) && Array.isArray(retained.payments)) {
        for (const key of ['baseRevision', 'source', 'merchant', 'merchantEnabled', 'paymentStyle', 'payments', 'reportKey', 'editor', 'editorDirty']) state[key] = retained[key];
        state.dirty = true;
      }
    } catch { /* A malformed local draft never changes the retained workspace. */ }
  }
  renderAll(); cache();
}
function renderAll() { renderConnection(); renderReport(); renderMerchant(); renderProducts(); renderStatus(); }
function requireSaved() {
  if (!state.data?.revision) throw new Error('Save the SFTP connection first.');
  if (state.dirty) throw new Error('Save this draft as a revision before using its source or merchant settings.');
  return state.data.revision;
}
async function save() {
  applyReport(); cache();
  const result = await api('save', { expectedRevision: state.baseRevision, source: state.source, merchant: merchantForSave() });
  installSaved(result); notice('Saved revision ' + result.revision + ' with ' + Object.keys(result.source.queries).length + ' reports.');
}
async function download(path, fallback) {
  const response = await fetch('/api/' + path, { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' });
  if (!response.ok) { const issue = await response.json(); throw new Error(issue.error ?? 'Download failed.'); }
  const blob = await response.blob(), url = URL.createObjectURL(blob), link = node('a');
  link.href = url; link.download = fallback; link.click(); setTimeout(() => URL.revokeObjectURL(url), 15000);
}

function renderCatalogue(result) {
  const catalogue = result.catalogue;
  $('catalogue-summary').textContent = 'Revision ' + result.revision + ' · ' + catalogue.resolvedPath + ' · ' +
    catalogue.entries.length + ' entries of ' + catalogue.totalEntries +
    ' · host ' + catalogue.host.fingerprint;
  replaceTable('catalogue', ['Name', 'Kind', 'Bytes', 'Modified', 'Open'], catalogue.entries.map(entry => [
    entry.name, entry.type, node('span', entry.type === 'file' ? entry.size.toLocaleString() : '—', 'number'),
    node('span', date(entry.modifiedAt), 'nowrap'),
    entry.type === 'directory' ? button('Open folder', async () => { $('folder-path').value = entry.path; await browse(); }) :
      entry.type === 'file' ? button('Select file', () => {
        $('sample-path').value = entry.path;
        $('sample-format').value = /\.ndjson$|\.jsonl$/i.test(entry.path) ? 'ndjson' : /\.json$/i.test(entry.path) ? 'json' : 'csv';
        $('records-pointer').value = ''; notice('Selected ' + entry.path + '. Capture the complete file to inspect its fields.');
      }) : node('span', '—'),
  ]), 'This folder has no returned entries.');
  $('catalogue-pages').replaceChildren();
  if (catalogue.offset > 0) $('catalogue-pages').append(button('Previous files', async () => {
    $('folder-path').value = catalogue.path; await browse(Math.max(0, catalogue.offset - catalogue.limit));
  }));
  if (catalogue.nextOffset !== null && catalogue.nextOffset !== undefined) $('catalogue-pages').append(button('Next files', async () => {
    $('folder-path').value = catalogue.path; await browse(catalogue.nextOffset);
  }));
}
async function browse(offset = 0) {
  const expectedRevision = requireSaved();
  notice('Reading the saved SFTP file catalogue.');
  renderCatalogue(await api('catalogue', { expectedRevision, path: $('folder-path').value, limit: 200, offset }));
  notice('Loaded the catalogue from saved revision ' + expectedRevision + '.');
}
function renderSample(record) {
  state.sample = record; const sample = record.sample;
  $('sample-summary').textContent = sample.path + ' · ' + sample.capture.bytes.toLocaleString() + ' captured bytes · ' +
    sample.sampledRows + ' displayed records' + (sample.complete ? ' · all records shown' : '') + ' · SHA256 ' + sample.capture.sha256;
  const fields = [...new Set(sample.rows.flatMap(row => Object.keys(row)))];
  replaceTable('sample-table', fields, sample.rows.map(row => fields.map(field =>
    object(row[field]) || Array.isArray(row[field]) ? JSON.stringify(row[field]) : row[field])), 'The captured file has no records.');
  $('use-sample').disabled = !Object.keys(sample.suggestedColumns).length;
}
function useSample() {
  if (!state.sample) throw new Error('Capture a source file first.');
  if (state.sample.revision !== state.data.revision) throw new Error('Capture this file from the current saved revision before choosing its fields.');
  const sample = state.sample.sample;
  if (state.editorDirty) applyReport();
  const base = sample.path.split('/').at(-1).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
  const name = /^[A-Za-z]/.test(base) ? base : 'report_' + base;
  state.reportKey = ''; state.editor = makeEditor(name, {
    path: sample.path, format: sample.format, recordsPointer: sample.recordsPointer,
    columns: sample.suggestedColumns, parameters: {}, where: [],
  });
  dirty(true); renderReport();
  notice('Loaded the captured field suggestions into a new report draft. Review field types and names, then save the revision.');
  $('report-name').focus();
}
function renderProducts() {
  if (!state.data) return;
  const selected = $('product-report').value, reports = Object.keys(state.data.source?.queries ?? {});
  selectOptions($('product-report'), reports.length ? reports.map(value => ({ value, label: value })) :
    [{ value: '', label: 'Save a report first' }], reports.includes(selected) ? selected : reports[0] ?? '');
  $('product-source').textContent = 'Saved revision ' + state.data.revision + ' · ' + reports.length + ' reports · ' +
    (state.data.merchant ? state.data.merchant.publicOrigin : 'Merchant settings required');
  $('publication-list').replaceChildren(...state.data.publications.map(item => {
    const element = button(item.query, async () => {
      state.publicationId = item.id; state.runId = null; state.run = null; state.offer = null;
      $('run-detail').hidden = true; await refreshPublication(); renderProducts();
    }, item.id === state.publicationId ? 'active' : '');
    element.append(node('small', item.path), node('small', 'Revision ' + item.revision + ' · ' + (item.seller ? 'Seller running' : 'Seller stopped')));
    return element;
  }));
  if (!state.data.publications.length) $('publication-list').append(node('p', 'No dataset products yet.', 'help'));
}
function facts(target, entries) {
  target.replaceChildren();
  for (const [label, value] of entries) target.append(node('dt', label), node('dd', String(value ?? '—')));
}
function renderPublication() {
  const current = state.publication;
  $('publication-detail').hidden = !current; if (!current) return;
  $('publication-title').textContent = current.query;
  $('publication-binding').textContent = current.path + ' · source revision ' + current.revision;
  $('publication-console').href = current.consoleUrl;
  const versions = current.target.versions;
  facts($('publication-summary'), [
    ['Merchant', current.merchant.publicOrigin],
    ['Source', short(current.sourceHash)],
    ['Publication', versions ? 'Revision ' + versions.revision + ' · ' + versions.versions.length + ' retained editions' :
      current.target.initializable ? 'First publication pending' : 'Retained dataset available'],
    ['Snapshot', versions?.current ?? 'Open the publication console for its current version'],
    ['Seller', current.seller ? current.seller.mode + ' · ' + current.seller.origin : 'Stopped'],
    ['Refresh', current.schedule.policy ? (current.schedule.enabled ? 'Enabled' : 'Paused') + ' · ' + current.schedule.policy.data.intervalSeconds + ' seconds' : 'No saved refresh policy'],
  ]);
  $('start-seller').hidden = Boolean(current.seller);
  $('start-seller').disabled = current.target.initializable || Boolean(current.status.active);
  $('stop-seller').hidden = !current.seller;
  $('stop-seller').disabled = Boolean(current.status.active || current.schedule.active);
  $('seller-docs').hidden = !current.seller;
  if (current.seller) $('seller-docs').href = current.seller.docs;
  $('publication-hint').textContent = current.startError ?? (current.target.initializable ?
    'Open the publication console to save an extraction plan, inspect its complete candidate, review it, and publish the first edition.' :
    'Use the publication console for complete extraction, reviews, version selection, and the saved recurring refresh policy.');
  replaceTable('publication-runs', ['Started', 'Plan', 'State', 'Run'], current.status.runs.map(item => [
    node('span', date(item.created), 'nowrap'), String(item.plan), node('span', words(item.state), 'nowrap'),
    button(short(item.id), () => loadRun(item.id)),
  ]), 'No extraction runs yet.');
  $('buyers').replaceChildren(...current.buyers.map(item => {
    const row = button('Download buyer · ' + item.intentId, () => download('files/buyer/' + current.id + '/' + item.id, 'SFTP-Dataset-Buyer-' + item.id + '.json'));
    row.append(node('small', 'Snapshot ' + short(item.snapshot) + ' · ' + date(item.createdAt))); return row;
  }));
  if (!current.buyers.length) $('buyers').append(node('p', 'Prepare a buyer from a retained publication run.', 'help'));
}
async function refreshProducts() {
  state.data = await api('state');
  renderProducts(); renderStatus();
  if (state.publicationId) await refreshPublication();
}
async function refreshPublication() {
  state.publication = await api('publications/' + state.publicationId); renderPublication();
}
async function loadRun(id) {
  state.runId = id; state.offer = null; state.run = await api('publications/' + state.publicationId + '/run?runId=' + encodeURIComponent(id));
  const result = state.run, manifest = result.run.data.candidate;
  $('run-detail').hidden = false; $('buyer-review').hidden = true;
  $('run-title').textContent = words(result.run.state) + ' · ' + short(id);
  $('run-summary').textContent = result.preview ? result.preview.page.total.toLocaleString() + ' rows · snapshot ' +
    (manifest?.dataset?.snapshot ?? result.preview.dataset?.snapshot ?? short(result.run.data.snapshot)) :
    result.run.data.error ? words(result.run.data.error) : 'This run has no complete candidate yet.';
  $('run-files').replaceChildren(...(manifest ? ['data.csv', 'dataset.json', 'candidate.json'].map(name =>
    button('Download ' + name, () => download('publications/' + state.publicationId + '/files/' + id + '/' + name,
      name === 'data.csv' ? state.publication.query + '.csv' : name))) : []));
  $('run-preview').replaceChildren();
  if (result.preview) $('run-preview').append(table(result.preview.fields, result.preview.rows.map(row => result.preview.fields.map(field => row[field]))));
  $('load-offer').disabled = !manifest || !state.publication.seller;
}
function renderOffer(offer) {
  state.offer = offer; $('buyer-review').hidden = false;
  $('buyer-resource').textContent = offer.url;
  $('buyer-offers').replaceChildren(...offer.accepts.map((choice, index) => {
    const card = node('div', undefined, 'offer'); card.append(node('strong', 'Choice ' + index + ' · ' + choice.network));
    const terms = node('dl');
    for (const [label, value] of [['Scheme', choice.scheme], ['Amount', choice.amount], ['Asset', choice.asset], ['Recipient', choice.payTo], ['Timeout', choice.maxTimeoutSeconds + ' seconds']])
      terms.append(node('dt', label), node('dd', String(value)));
    card.append(terms);
    if (choice.extra !== undefined) card.append(node('pre', pretty(choice.extra)));
    return card;
  }));
  selectOptions($('buyer-choice'), offer.accepts.map((choice, index) => ({ value: String(index), label: index + ' · ' + choice.network + ' · ' + choice.amount })), '0');
  if (!$('buyer-intent').value) $('buyer-intent').value = 'sftp-' + crypto.randomUUID();
}
function on(id, action) { $(id).addEventListener('click', () => run(action)); }
for (const element of document.querySelectorAll('[data-tab]')) element.addEventListener('click', () => showTab(element.dataset.tab));
for (const [id, key] of [['host', 'host'], ['username', 'username']]) bind(id, value => { state.source.connection[key] = value; });
bind('port', value => { state.source.connection.port = Number(value); });
bind('root', value => { state.source.root = value; });
bind('host-pins', value => { state.source.connection.hostKeyFingerprints = value.split(/\r?\n/).map(item => item.trim()).filter(Boolean); });
function authFromForm() {
  const method = $('auth-method').value, passphrase = $('passphrase-env').value;
  state.source.connection.auth = { [method]: $('auth-env').value,
    ...(method !== 'passwordEnv' && passphrase ? { passphraseEnv: passphrase } : {}) };
  $('passphrase-env').disabled = method === 'passwordEnv';
}
bind('auth-method', authFromForm); bind('auth-env', authFromForm); bind('passphrase-env', authFromForm);
for (const [id, key] of [['max-file-bytes', 'maxFileBytes'], ['max-row-bytes', 'maxRowBytes'], ['timeout-ms', 'timeoutMs'], ['max-directory-entries', 'maxDirectoryEntries']])
  bind(id, value => { state.source.limits[key] = Number(value); });
for (const [id, key] of [['report-name', 'name'], ['report-path', 'path'], ['report-format', 'format'], ['report-pointer', 'recordsPointer'],
  ['report-hash', 'expectedSha256'], ['report-parameters', 'parametersText'], ['report-where', 'whereText']])
  bind(id, value => { state.editor[key] = value; }, { editor: true });
$('report-select').addEventListener('change', () => run(() => {
  const selected = $('report-select').value;
  try { applyReport(); state.reportKey = selected; state.editor = makeEditor(selected, state.source.queries[selected]); state.editorDirty = false; renderReport(); cache(); }
  catch (issue) { $('report-select').value = state.reportKey; throw issue; }
}));
bind('merchant-enabled', value => { state.merchantEnabled = value; $('merchant-fields').hidden = !value; }, { checkbox: true });
for (const [id, key] of [['public-origin', 'publicOrigin'], ['service-name', 'serviceName'], ['merchant-description', 'description']])
  bind(id, value => { state.merchant[key] = value; });
bind('merchant-tags', value => { state.merchant.tags = value.split(',').map(item => item.trim()).filter(Boolean); });
on('save', save);
on('reload', async () => { installSaved(await api('state')); notice('Loaded saved revision ' + state.data.revision + '.'); });
on('browse', browse);
on('folder-up', async () => { $('folder-path').value = $('folder-path').value.split('/').filter(Boolean).slice(0, -1).join('/'); await browse(); });
on('sample', async () => {
  const expectedRevision = requireSaved();
  notice('Capturing the complete source file and inspecting its records.');
  renderSample(await api('sample', { expectedRevision, path: $('sample-path').value, format: $('sample-format').value,
    recordsPointer: $('records-pointer').value, limit: 20 }));
  notice('Captured the complete source file. Review the preview and choose its output fields.');
});
on('use-sample', useSample);
on('new-report', () => { applyReport(); state.reportKey = ''; state.editor = makeEditor(); state.editorDirty = false; renderReport(); cache(); $('report-name').focus(); });
on('add-column', () => { state.editor.columns.push({ name: '', pointer: '', type: 'string', nullable: false, missing: 'error' }); dirty(true); renderMapping(); });
on('keep-report', () => { applyReport(); dirty(); renderReport(); notice('Kept the report in this draft. Save the revision to make it available to dataset products.'); });
on('remove-report', () => {
  if (!state.reportKey) return;
  delete state.source.queries[state.reportKey]; state.reportKey = ''; state.editor = makeEditor(); state.editorDirty = false;
  dirty(); renderReport(); notice('Removed the report from the draft. Existing saved revisions and dataset products remain available.');
});
on('add-payment', () => { state.payments.push(emptyPayment()); state.paymentStyle = 'paymentOptions'; dirty(); renderPayments(); });
on('refresh-products', refreshProducts);
on('create-product', async () => {
  const created = await api('publications', { expectedRevision: requireSaved(), query: $('product-report').value, path: $('product-path').value });
  state.publicationId = created.id; state.publication = created; state.runId = null; state.run = null; state.offer = null;
  $('run-detail').hidden = true; await refreshProducts();
  notice('Created the dataset product. Open its publication console to save and run the first complete extraction plan.');
});
on('start-seller', async () => {
  state.publication = await api('publications/' + state.publicationId + '/seller/start', {}); renderPublication();
  await refreshProducts(); notice('Started the original versioned dataset seller.');
});
on('stop-seller', async () => {
  state.publication = await api('publications/' + state.publicationId + '/seller/stop', {}); renderPublication();
  state.offer = null; $('buyer-review').hidden = true; await refreshProducts();
  notice('Paused the original refresh policy and stopped this dataset seller.');
});
on('load-offer', async () => {
  renderOffer(await api('publications/' + state.publicationId + '/buyer?runId=' + encodeURIComponent(state.runId) +
    '&query=' + encodeURIComponent($('buyer-query').value)));
  notice('Loaded the running seller’s original payment choices for this retained snapshot.');
});
$('buyer-query').addEventListener('input', () => { state.offer = null; $('buyer-review').hidden = true; });
on('prepare-buyer', async () => {
  if (!state.offer) throw new Error('Load the current payment choices before preparing a buyer.');
  const result = await api('publications/' + state.publicationId + '/buyer', { runId: state.runId, query: $('buyer-query').value,
    intentId: $('buyer-intent').value, acceptIndex: Number($('buyer-choice').value), offerSha256: state.offer.offerSha256 });
  await refreshPublication();
  await download('files/buyer/' + state.publicationId + '/' + result.id, 'SFTP-Dataset-Buyer-' + result.id + '.json');
  notice('Prepared and downloaded the original buyer configuration for snapshot ' + short(result.snapshot) + '.');
});
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
setInterval(() => {
  if (!document.hidden && state.tab === 'products' && !state.busy) run(refreshProducts);
}, 7000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.tab === 'products' && !state.busy) run(refreshProducts);
});
await run(async () => {
  if (!token) throw new Error('Open the complete private workspace URL printed by the launch terminal.');
  installSaved(await api('state'), true);
  notice(state.dirty ? 'Restored your unsaved draft based on revision ' + state.baseRevision + '. The server currently retains revision ' + state.data.revision + '.' :
    state.data.revision ? 'Opened saved revision ' + state.data.revision + '. Choose a source task or dataset product.' : 'Enter the SFTP connection and trusted host fingerprint to begin.');
});

