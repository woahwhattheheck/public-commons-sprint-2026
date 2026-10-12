/* MIT. StellarExpert operator UI over the existing merchant and buyer services. */
'use strict';

const $ = selector => document.querySelector(selector);
const ui = {
  schema: null, view: null, page: 'watchlist', busy: false, pending: null, conflict: null,
  drafts: new Map(), watch: null, rows: null, rowOffset: 0, comparison: null, queryResult: null,
  releaseResult: null, receivingResult: null, selectedDatasetId: null,
  editionArchive: null, editionCatalog: new Map(), queryResultDatasetId: null, queryHistory: [], currentQuery: null
};
const SESSION_KEY = 'stellar-expert-operator-session-v1';
const PENDING_KEY = 'stellar-expert-pending-action-v1';
const PAGE_KEY = 'stellar-expert-page-v1';
let token = location.hash.slice(1);
try {
  if (token) { sessionStorage.setItem(SESSION_KEY, token); history.replaceState(null, '', location.pathname); }
  else token = sessionStorage.getItem(SESSION_KEY) || '';
  const saved = sessionStorage.getItem(PENDING_KEY);
  if (saved) ui.pending = JSON.parse(saved);
  ui.page = sessionStorage.getItem(PAGE_KEY) || 'watchlist';
} catch { /* The original URL can reopen the session; writes verify storage before dispatch. */ }

const labels = {
  watchlist: 'Watchlist', editions: 'Source editions', analysis: 'Analysis and notes',
  publications: 'Merchant publications', receiving: 'Customer receiving'
};
const actionLabels = {
  'watch.add': 'Save asset watch', 'watch.remove': 'Remove asset watch',
  'capture.start': 'Capture source observations', 'capture.resume': 'Continue retained capture',
  'edition.select': 'Select source edition', 'edition.compare': 'Compare source editions',
  'annotation.save': 'Save source-linked note', 'dataset.prepare': 'Prepare dataset',
  'dataset.query': 'Query prepared dataset', 'release.prepare': 'Prepare merchant release',
  'release.inspect': 'Inspect merchant release', 'release.activate': 'Activate merchant release',
  'release.start': 'Run merchant', 'release.stop': 'Stop merchant', 'release.rollback': 'Restore previous release',
  'buyer.inspect': 'Inspect original buyer inbox',
  'buyer.receive': 'Receive selected purchases', 'export.create': 'Create edition export'
};
function element(tag, attributes, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'class') node.className = value;
    else if (name === 'text') node.textContent = value;
    else if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2), value);
    else if (name === 'checked' || name === 'disabled' || name === 'hidden') node[name] = Boolean(value);
    else node.setAttribute(name, String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
function button(label, handler, primary = false, attributes = {}) {
  return element('button', {type: 'button', class: primary ? 'primary' : '', onclick: handler, ...attributes}, label);
}
const paragraph = (value, className = '') => element('p', {class: className}, value);
const words = value => String(value || '').replaceAll('_', ' ').replaceAll('-', ' ');
const count = value => value === null || value === undefined ? '—' : String(value);
const short = value => String(value || '').slice(0, 12);
const items = value => Array.isArray(value) ? value : [];
const idOf = value => typeof value === 'string' ? value : value?.id ?? value?.value ?? value?.name ?? value?.kind;
const nameOf = value => typeof value === 'string' ? words(value) : value?.label ?? value?.title ?? words(idOf(value));
const selected = () => ui.view?.selectedEdition || items(ui.view?.editions).find(x => x.id === ui.view?.selectedEditionId);
const workspaceId = () => ui.view?.workspaceId || ui.schema?.workspaceId;
const selectionId = () => selected()?.id || ui.view?.selectedEditionId;
function date(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? String(value) : parsed.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}
function badge(value, strong = false) {
  return element('span', {class: 'badge' + (strong ? ' strong' : '')}, words(value || 'retained'));
}
function notify(message, error = false) {
  $('#notice').textContent = message;
  $('#notice').className = 'notice' + (error ? ' error' : '');
}
function field(name, label, value = '', options = {}) {
  const id = 'field-' + name;
  let control;
  if (options.choices) {
    control = element('select', {name, id, required: options.required, multiple: options.multiple});
    for (const choice of options.choices) {
      const key = Array.isArray(choice) ? choice[0] : idOf(choice);
      const title = Array.isArray(choice) ? choice[1] : nameOf(choice);
      const option = element('option', {value: key}, title);
      option.selected = String(key) === String(value);
      control.append(option);
    }
  } else if (options.type === 'textarea') {
    control = element('textarea', {name, id, required: options.required, rows: options.rows || 4,
      maxlength: options.maxlength || 12000, spellcheck: options.spellcheck !== false});
    control.value = value ?? '';
  } else {
    control = element('input', {name, id, type: options.type || 'text', required: options.required,
      min: options.min, max: options.max, step: options.step, maxlength: options.maxlength || 2048,
      placeholder: options.placeholder, autocomplete: 'off'});
    control.value = value ?? '';
  }
  return element('div', {class: 'field' + (options.full ? ' full' : '')},
    element('label', {for: id}, label), control,
    options.help ? paragraph(options.help, 'field-note') : null);
}
function scalarRecord(record) {
  const list = element('dl', {class: 'kv'});
  for (const [key, value] of Object.entries(record || {})) {
    if (value === undefined) continue;
    list.append(element('dt', {}, words(key)), element('dd', {}, typeof value === 'object' && value !== null ? JSON.stringify(value) : count(value)));
  }
  return list;
}
function jsonDetails(label, value) {
  return element('details', {}, element('summary', {}, label), element('pre', {}, JSON.stringify(value, null, 2)));
}
function panel(title, ...children) {
  return element('section', {class: 'panel'}, title ? element('h3', {}, title) : null, ...children);
}
function empty(title, message) {
  return element('div', {class: 'empty'}, element('h3', {}, title), paragraph(message));
}
function table(columns, rows, narrow = false) {
  const head = element('tr', {});
  for (const column of columns) head.append(element('th', {scope: 'col'}, column.label));
  const body = element('tbody', {});
  for (const row of rows) {
    const tr = element('tr', {});
    for (const column of columns) {
      const value = column.render ? column.render(row) : row[column.key];
      tr.append(element('td', {}, value === null || value === undefined ? '—' : value));
    }
    body.append(tr);
  }
  return element('div', {class: 'table-wrap', tabindex: '0', 'aria-label': 'Scrollable data table'},
    element('table', {class: narrow ? 'table-narrow' : 'table-wide'}, element('thead', {}, head), body));
}
function rowTable(columns, rows) {
  return table(items(columns).map(column => {
    const name = typeof column === 'string' ? column : column.name || column.key || column.id;
    return {label: name, render: row => {
      const value = row[name];
      if (value === null) return element('span', {class: 'muted'}, 'null');
      if (value === undefined) return '—';
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }};
  }), rows);
}
function value(form, name) { return String(new FormData(form).get(name) ?? '').trim(); }
function integer(form, name, minimum, maximum) {
  const raw = value(form, name);
  if (!/^[0-9]+$/.test(raw)) throw Error('Enter a whole number for ' + words(name) + '.');
  const result = Number(raw);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum)
    throw Error(words(name) + ' must be between ' + minimum + ' and ' + maximum + '.');
  return result;
}
function listValue(form, name) {
  return value(form, name).split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
}
function remember(form) {
  if (!form?.dataset.draft) return;
  const values = {};
  for (const control of form.elements) {
    if (!control.name || ['submit', 'button', 'file'].includes(control.type)) continue;
    values[control.name] = control.type === 'checkbox' || control.type === 'radio' ? control.checked :
      control.multiple ? [...control.selectedOptions].map(x => x.value) : control.value;
  }
  ui.drafts.set(form.dataset.draft, values);
}
function rememberAll() { document.querySelectorAll('form[data-draft]').forEach(remember); }
function restore(form) {
  const values = ui.drafts.get(form.dataset.draft);
  if (!values) return;
  for (const control of form.elements) {
    if (!control.name || !Object.hasOwn(values, control.name)) continue;
    if (control.type === 'checkbox' || control.type === 'radio') control.checked = values[control.name];
    else if (control.multiple) for (const option of control.options) option.selected = values[control.name].includes(option.value);
    else control.value = values[control.name];
  }
}
function form(name, children, submitLabel, submit) {
  const node = element('form', {'data-draft': name});
  node.append(...children, element('div', {class: 'form-actions'},
    element('button', {type: 'submit', class: 'primary', 'data-mutation': 'true'}, submitLabel)));
  node.addEventListener('input', () => remember(node));
  node.addEventListener('change', () => remember(node));
  node.addEventListener('submit', async event => {
    event.preventDefault(); remember(node);
    if (!node.reportValidity()) return;
    try { await submit(node); } catch (error) { notify(error.message, true); }
  });
  restore(node);
  return node;
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {authorization: 'Bearer ' + token, ...(body === undefined ? {} : {'content-type': 'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}), credentials: 'omit', cache: 'no-store'
  });
  let data;
  try { data = await response.json(); }
  catch { throw Object.assign(Error('The workspace returned an unreadable response. Its original action is retained for recovery.'), {status: response.status}); }
  if (!response.ok) {
    const detail = typeof data.error === 'object' ? data.error.message : data.message || data.error;
    throw Object.assign(Error(detail || 'Workspace request returned ' + response.status), {status: response.status, data});
  }
  return data;
}
async function readView() {
  const result = await api('/api/view');
  ui.view = result.view || result;
  return ui.view;
}
function updateControls() {
  const sameWorkspace = !ui.pending || ui.pending.workspaceId === workspaceId();
  $('#pending-panel').hidden = !ui.pending;
  $('#pending-description').textContent = ui.pending ? (actionLabels[ui.pending.body.action] || ui.pending.body.action) +
    (sameWorkspace ? '. The exact request and operation identity are saved in this tab.' : '. Reopen its original workspace session to recover it.') : '';
  $('#recover-action').disabled = ui.busy || !sameWorkspace;
  $('#conflict-panel').hidden = !ui.conflict;
  $('#refresh').disabled = ui.busy;
  $('#view').setAttribute('aria-busy', ui.busy ? 'true' : 'false');
  for (const node of document.querySelectorAll('[data-mutation]')) node.disabled = ui.busy || Boolean(ui.pending) || Boolean(ui.conflict) || node.dataset.unavailable === 'true';
}
function retainPending(request) {
  if (!workspaceId()) throw Error('The workspace identity is unavailable. Refresh saved state before continuing.');
  const pending = {workspaceId: workspaceId(), body: request, preparedAt: new Date().toISOString()};
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  ui.pending = pending;
}
function clearPending() {
  sessionStorage.removeItem(PENDING_KEY);
  ui.pending = null;
}
async function act(action, payload, options = {}) {
  if (ui.busy) return null;
  if (ui.pending && !options.recover) throw Error('Recover the saved action before starting another change.');
  if (ui.conflict && !options.recover) throw Error('Load current state before saving the retained draft.');
  rememberAll();
  const body = options.recover ? ui.pending.body : {
    action, payload, expectedRevision: ui.view.revision, operationId: crypto.randomUUID()
  };
  if (options.recover && ui.pending.workspaceId !== workspaceId())
    throw Error('This action belongs to another workspace. Reopen its original session.');
  if (!options.recover) retainPending(body);
  ui.busy = true; updateControls();
  notify((actionLabels[body.action] || body.action) + '…');
  try {
    const response = await api('/api/action', body);
    if (response.view) ui.view = response.view;
    else await readView();
    if (['RUNNING', 'PENDING', 'QUEUED'].includes(String(response.state || '').toUpperCase()) && !Object.hasOwn(response, 'result')) {
      notify('The saved action is still running. Refresh its state, then recover this same request.');
      return response;
    }
    clearPending();
    ui.conflict = null;
    if (options.clearDraft) ui.drafts.delete(options.clearDraft);
    ui.editionArchive = null;
    adoptActionResult(body, response);
    if (options.after) options.after(response);
    if (body.action === 'edition.select') { ui.rows = null; ui.rowOffset = 0; }
    notify(body.action.startsWith('capture.') ? 'Capture request saved. Refresh retained captures for the current progress.' :
      (actionLabels[body.action] || body.action) + ' completed.');
    return response;
  } catch (error) {
    if (error.status === 409) {
      clearPending();
      ui.conflict = {view: error.data?.view, revision: error.data?.currentRevision};
    } else if (error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status)) {
      clearPending();
    }
    notify(error.message, true);
    throw error;
  } finally {
    ui.busy = false; render(); updateControls();
  }
}
function adoptActionResult(body, response) {
  const result = response.result || response;
  if (body.action === 'dataset.prepare') ui.selectedDatasetId = result.id || result.datasetId || result.dataset?.id || null;
  if (body.action === 'edition.compare') ui.comparison = result.comparison || result;
  if (body.action === 'dataset.query') {
    ui.queryResult = result; ui.queryResultDatasetId = body.payload.datasetId;
    ui.currentQuery = body.payload.query; ui.queryHistory = [];
  }
  if (body.action.startsWith('release.')) ui.releaseResult = result;
  if (body.action.startsWith('buyer.')) ui.receivingResult = result;
}
function mutation(label, action, payload, primary = false, options = {}) {
  return button(label, () => act(action, typeof payload === 'function' ? payload() : payload, options).catch(() => {}),
    primary, {'data-mutation': 'true'});
}
function setPage(name) {
  if (!labels[name]) name = 'watchlist';
  rememberAll(); ui.page = name;
  try { sessionStorage.setItem(PAGE_KEY, name); } catch {}
  render();
}
function heading(title, description, action) {
  return element('div', {class: 'page-heading'},
    element('div', {}, element('h2', {}, title), paragraph(description, 'muted')), action || null);
}
function selectedBanner() {
  const edition = selected();
  return edition ? element('div', {class: 'selection'},
    element('strong', {}, edition.label || short(edition.id)),
    paragraph((edition.query?.network || 'Directory') + ' · ' + nameOfCapture(edition.query?.kind) + ' · ' +
      date(edition.createdAt) + ' · ' + count(edition.recordCount) + ' records', 'small'))
    : empty('Select a source edition', 'Capture provider observations, then choose the retained edition for analysis and delivery.');
}
const captureKinds = () => items(ui.schema?.captureKinds);
function kindId(kind) { return idOf(kind); }
function nameOfCapture(kind) {
  return nameOf(captureKinds().find(x => kindId(x) === kind) || kind || 'Source');
}
function descriptor(name) { return ui.schema?.fields?.[name] || {}; }
function queryField(name, initial) {
  const spec = descriptor(name);
  const supplied = spec.choices || spec.options || spec.enum;
  const choices = supplied ? supplied.map(x => typeof x === 'string' ? [x, words(x)] : x) :
    name === 'network' ? items(ui.schema?.networks).map(x => [idOf(x), nameOf(x)]) :
    name === 'order' ? [['desc', 'Descending'], ['asc', 'Ascending']] :
    name === 'sort' ? [['rating', 'Activity rating'], ['created', 'Created'], ['payments', 'Payments'],
      ['trades', 'Trades'], ['trustlines', 'Trustlines'], ['volume', 'Total volume'], ['volume7d', 'Seven-day volume']] : null;
  const titles = {
    network: 'Stellar network', asset: 'Asset identifier', search: 'Search text',
    address: 'Account addresses', tag: 'Directory tags', domain: 'Domain',
    timestamp: 'UTC timestamp or Unix seconds', sequence: 'Ledger sequence',
    sort: 'Sort by', order: 'Order', limit: 'Records per provider page'
  };
  const defaults = {network: ui.watch?.network || 'public', asset: ui.watch?.asset || '', order: 'desc', sort: 'rating', limit: 100};
  return field('capture-' + name, spec.label || titles[name] || words(name),
    initial ?? defaults[name] ?? spec.default ?? '', {
      choices, type: ['address', 'tag'].includes(name) ? 'textarea' : ['sequence', 'limit'].includes(name) ? 'number' : 'text',
      min: ['sequence', 'limit'].includes(name) ? 1 : undefined,
      max: name === 'limit' ? (spec.maximum || spec.max || 200) : undefined,
      required: Boolean(spec.required) || ['network', 'asset', 'domain', 'timestamp', 'sequence'].includes(name),
      help: spec.description || spec.help || (name === 'address' ? 'Separate up to 50 public account addresses with a comma or newline.' :
        name === 'tag' ? 'Separate directory tags with a comma or newline.' : name === 'asset' ? 'Use XLM or the provider’s complete asset code and issuer identifier.' : '')
    });
}
function captureForm() {
  const kinds = captureKinds();
  if (!kinds.length) return empty('Source types are unavailable', 'Refresh the workspace schema to load the configured source operations.');
  const preferred = ui.watch ? kinds.find(x => items(x.fields).includes('asset')) : kinds[0];
  const active = ui.drafts.get('capture')?.['capture-kind'] || kindId(preferred || kinds[0]);
  const kind = kinds.find(x => kindId(x) === active) || kinds[0];
  const queryFields = items(kind.fields);
  const controls = element('div', {class: 'grid'},
    field('capture-kind', 'Source operation', kindId(kind), {choices: kinds.map(x => [kindId(x), nameOf(x)])}),
    field('capture-label', 'Edition label', ui.watch?.label || '', {required: true, placeholder: 'Purpose of this source capture'}),
    ...queryFields.map(name => queryField(name)),
    field('capture-pageBudget', 'Maximum pages in this run', 100, {type: 'number', min: 1, max: 1000, required: true,
      help: 'Provider continuation and completed pages are retained. Continue this same capture if more pages remain.'})
  );
  const result = form('capture', [controls], 'Capture and retain source', async node => {
    const chosen = kinds.find(x => kindId(x) === value(node, 'capture-kind'));
    const query = {kind: kindId(chosen)};
    for (const name of items(chosen.fields)) {
      const raw = value(node, 'capture-' + name);
      if (raw === '') continue;
      query[name] = ['address', 'tag'].includes(name) ? listValue(node, 'capture-' + name) :
        name === 'limit' ? integer(node, 'capture-' + name, 1, 200) : raw;
    }
    const payload = {query, label: value(node, 'capture-label'), pageBudget: integer(node, 'capture-pageBudget', 1, 1000)};
    if (ui.watch && ui.watch.asset === query.asset && ui.watch.network === query.network) payload.watchId = ui.watch.id;
    await act('capture.start', payload);
  });
  result.querySelector('[name="capture-kind"]').addEventListener('change', () => { remember(result); render(); });
  return result;
}

function watchlistView() {
  const watches = items(ui.view.watchlist);
  const add = form('watch-add', [element('div', {class: 'grid'},
    field('watch-network', 'Network', 'public', {choices: items(ui.schema.networks).map(x => [idOf(x), nameOf(x)]), required: true}),
    field('watch-asset', 'Asset identifier', '', {required: true, placeholder: 'XLM or CODE-ISSUER'}),
    field('watch-label', 'Working label', '', {required: true}),
    field('watch-note', 'Research purpose', '', {type: 'textarea'})
  )], 'Save asset watch', async node => {
    await act('watch.add', {network: value(node, 'watch-network'), asset: value(node, 'watch-asset'),
      label: value(node, 'watch-label'), note: value(node, 'watch-note')}, {clearDraft: 'watch-add'});
  });
  const list = watches.length ? table([
    {label: 'Asset', render: row => element('div', {}, element('strong', {}, row.label || row.asset), paragraph(row.asset, 'small mono'))},
    {label: 'Network', key: 'network'},
    {label: 'Research purpose', render: row => paragraph(row.note || '—', 'note-text')},
    {label: 'Actions', render: row => element('div', {class: 'actions'},
      button('Use in capture', () => { rememberAll(); ui.watch = row; ui.drafts.delete('capture'); render(); $('#field-capture-label')?.focus(); }),
      mutation('Remove watch', 'watch.remove', {watchId: row.id}))}
  ], watches) : empty('Start an asset watchlist', 'Name the assets and research questions you want to follow. Captured sources remain available as separate editions.');
  return [
    heading('Watchlist', 'Keep asset identifiers, networks, and research purpose together.'),
    panel('Tracked assets', list),
    panel('Add an asset', add),
    panel('Capture provider observations', ui.watch ? paragraph('Selected watch: ' + (ui.watch.label || ui.watch.asset), 'help') : null, captureForm()),
    capturesPanel()
  ];
}
function capturesPanel() {
  const captures = items(ui.view.captures);
  return panel('Retained captures', captures.length ? table([
    {label: 'Capture', render: row => element('div', {}, element('strong', {}, row.label || short(row.id)),
      paragraph(nameOfCapture(row.query?.kind) + ' · ' + (row.query?.network || 'Directory'), 'small muted'))},
    {label: 'Progress', render: row => element('div', {}, badge(row.state),
      paragraph(count(Array.isArray(row.pages) ? row.pages.length : row.pages) + ' pages · ' + count(row.records) + ' records', 'small'))},
    {label: 'Observation', render: row => element('div', {}, paragraph(row.retryAt ? 'Available after ' + date(row.retryAt) : ''),
      row.error ? paragraph(typeof row.error === 'string' ? row.error : row.error.message || JSON.stringify(row.error), 'small') : null)},
    {label: 'Actions', render: row => element('div', {class: 'actions'},
      row.editionId ? mutation('Open edition', 'edition.select', {editionId: row.editionId}, false, {after: () => {ui.page = 'editions';}}) : null,
      row.nextUrl || (!row.editionId && !['complete', 'completed'].includes(String(row.state).toLowerCase())) ?
        mutation('Continue capture', 'capture.resume', {captureId: row.id, pageBudget: 100}) : null,
      button('Details', () => detail('Capture details', row)))}
  ], captures) : paragraph('Your completed pages and provider continuation will appear here.', 'muted'));
}
function knownEditions() {
  for (const edition of [...items(ui.view.editions), ...items(ui.editionArchive?.editions), ...(selected() ? [selected()] : [])])
    ui.editionCatalog.set(edition.id, edition);
  return [...ui.editionCatalog.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
async function loadEditionArchive(offset = 0) {
  if (ui.busy) return;
  try {
    rememberAll();
    ui.editionArchive = await api('/api/editions?offset=' + offset + '&limit=100');
    knownEditions(); render();
  } catch (error) { notify(error.message, true); }
}
function editionList() {
  knownEditions();
  const archive = ui.editionArchive;
  const editions = items(archive?.editions || ui.view.editions);
  const total = archive?.total ?? ui.view.editionCount ?? editions.length, offset = archive?.offset || 0;
  if (!editions.length && !total) return empty('No source editions yet', 'Use Watchlist to retain a provider capture and its original pages.');
  return element('div', {},
    element('div', {class: 'actions spread'},
      paragraph('Showing ' + (editions.length ? offset + 1 : 0) + '–' + (offset + editions.length) + ' of ' + total + ' retained editions.', 'small muted'),
      element('div', {class: 'actions'},
        button('Newer editions', () => loadEditionArchive(Math.max(0, offset - 100)), false, {disabled: offset === 0}),
        button('Older editions', () => loadEditionArchive(offset + editions.length), false, {disabled: offset + editions.length >= total}))),
    table([
      {label: 'Edition', render: row => element('div', {}, element('strong', {}, row.label || short(row.id)),
        paragraph(nameOfCapture(row.query?.kind) + ' · ' + (row.query?.network || 'Directory'), 'small muted'))},
      {label: 'Captured', render: row => date(row.createdAt)},
      {label: 'Coverage', render: row => element('div', {}, count(row.recordCount) + ' records / ' + count(row.pageCount) + ' pages',
        paragraph(row.complete ? 'Selected capture complete' : 'Continuation remains', 'small muted'))},
      {label: 'Actions', render: row => element('div', {class: 'actions'},
        mutation(row.id === selectionId() ? 'Selected' : 'Select edition', 'edition.select', {editionId: row.id}),
        button('Source details', () => detail('Edition and source query', row)))}
    ], editions));
}
async function loadRows(offset = 0) {
  const editionId = selectionId();
  if (!editionId) return;
  try {
    const result = await api('/api/rows?editionId=' + encodeURIComponent(editionId) + '&offset=' + offset + '&limit=100');
    if (selectionId() !== editionId) return;
    ui.rows = {...result, editionId}; ui.rowOffset = offset; render();
  } catch (error) { notify(error.message, true); }
}
function rowsPanel() {
  const edition = selected();
  if (!edition) return null;
  const loaded = ui.rows?.editionId === edition.id ? ui.rows : null;
  const columns = loaded?.columns || edition.columns || [];
  const rows = loaded?.rows || edition.previewRows || [];
  const total = loaded?.total ?? edition.recordCount ?? rows.length;
  const offset = loaded?.offset || 0;
  return panel('Selected source records',
    element('div', {class: 'actions spread'}, paragraph(
      rows.length ? 'Showing ' + (offset + 1) + '–' + (offset + rows.length) + ' of ' + total + ' retained records.' :
      'Load the retained records for this edition.', 'small muted'),
      element('div', {class: 'actions'},
        button('Previous records', () => loadRows(Math.max(0, offset - 100)), false, {disabled: offset === 0}),
        button(loaded ? 'Next records' : 'Load records', () => loadRows(loaded ? offset + rows.length : 0), false,
          {disabled: Boolean(loaded && offset + rows.length >= total)}))),
    rows.length ? rowTable(columns, rows) : paragraph('No records are displayed for the current selection.', 'muted'),
    paragraph('Exact numeric text is retained. Amount fields keep the units supplied by the source.', 'help')
  );
}
function exportsPanel() {
  const editionId = selectionId();
  const existing = items(ui.view.exports).filter(x => !editionId || x.editionId === editionId);
  return panel('Portable edition exports',
    paragraph('Create a complete selected-edition file with its source query, observation coverage and annotations.'),
    editionId ? element('div', {class: 'actions'},
      mutation('Create JSON', 'export.create', {editionId, format: 'json'}),
      mutation('Create CSV', 'export.create', {editionId, format: 'csv'}),
      mutation('Create offline report', 'export.create', {editionId, format: 'report'})) : null,
    existing.length ? table([
      {label: 'Export', render: row => row.name || row.filename || row.label || row.format || short(row.id)},
      {label: 'Created', render: row => date(row.createdAt)},
      {label: 'Bytes', render: row => count(row.bytes)},
      {label: 'File', render: row => button('Download', () => download('/api/exports/' + encodeURIComponent(row.id),
        row.filename || ('stellar-edition.' + ({json:'json',csv:'csv',report:'html'}[row.format] || 'bin'))).catch(error => notify(error.message, true)))}
    ], existing, true) : paragraph('Created exports appear here and reopen with the same workspace.', 'help')
  );
}
function originalPagePanel() {
  const edition = selected();
  if (!edition) return null;
  const node = element('form', {}, element('div', {class: 'toolbar'},
    field('raw-page', 'Original provider page', 1, {type: 'number', min: 1, max: Math.max(1, edition.pageCount || 1), required: true}),
    element('button', {type: 'submit'}, 'Inspect original response')));
  node.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const page = integer(node, 'raw-page', 1, Math.max(1, edition.pageCount || 1)) - 1;
      const response = await fetch('/api/raw?editionId=' + encodeURIComponent(edition.id) + '&page=' + page,
        {headers: {authorization: 'Bearer ' + token}, credentials: 'omit', cache: 'no-store'});
      if (!response.ok) throw Error('Original response returned ' + response.status);
      const original = await response.text();
      const area = element('div', {}, paragraph('Original page ' + (page + 1) + ' · ' + (edition.label || edition.id), 'muted'),
        element('pre', {}, original));
      detail('Retained provider response', area);
    } catch (error) { notify(error.message, true); }
  });
  return panel('Original source', node, jsonDetails('Edition metadata and exact source identity', {
    id: edition.id, sourceSha256: edition.sourceSha256, query: edition.query,
    createdAt: edition.createdAt, complete: edition.complete, summary: edition.summary
  }));
}
function editionsView() {
  return [heading('Source editions', 'Select a retained observation and inspect its complete source coverage.'),
    panel('Saved editions', editionList()), selectedBanner(), rowsPanel(), originalPagePanel(), exportsPanel(), capturesPanel()];
}

function comparisonPanel() {
  const editions = knownEditions(), choices = editions.map(x => [x.id, (x.label || short(x.id)) + ' · ' + date(x.createdAt)]);
  const compare = form('edition-compare', [element('div', {class: 'grid'},
    field('compare-left', 'Earlier / reference edition', choices[1]?.[0] || choices[0]?.[0] || '', {choices, required: true}),
    field('compare-right', 'Selected / comparison edition', selectionId() || choices[0]?.[0] || '', {choices, required: true})
  )], 'Compare retained editions', async node => {
    await act('edition.compare', {leftId: value(node, 'compare-left'), rightId: value(node, 'compare-right')},
      {after: result => {ui.comparison = result.comparison || result.result?.comparison || result.result || result;}});
  });
  const result = ui.comparison;
  let output = null;
  if (result) {
    const changes = Array.isArray(result.changes) ? result.changes : Array.isArray(result.changed) ? result.changed : null;
    output = element('div', {},
      result.summary || result.counts ? scalarRecord(result.summary || result.counts) : null,
      result.coverage ? paragraph(result.coverage.meaning, 'help') : null,
      changes ? table([
        {label: 'Record', render: row => row.key || row.id || row.subject || 'Changed record'},
        {label: 'Previous', render: row => JSON.stringify(row.before ?? row.left ?? row.previous ?? null)},
        {label: 'Current', render: row => JSON.stringify(row.after ?? row.right ?? row.current ?? null)}
      ], changes.slice(0, 100)) : null,
      changes?.length > 100 ? paragraph('Showing the first 100 changed records. Download the full comparison for all changes.', 'help') : null,
      button('Download full comparison', () => result.export?.downloadUrl ?
        download(result.export.downloadUrl, result.export.name || 'stellar-edition-comparison.json') :
        downloadObject('stellar-edition-comparison.json', result)),
      jsonDetails('Comparison preview and retained export', result));
  }
  return panel('Compare saved observations', paragraph('Compare source records from two retained editions. Their original capture times remain visible.'),
    editions.length ? compare : empty('Two editions can be compared here', 'Retain a later source capture to inspect the changes.'), output);
}
function notesPanel() {
  const edition = selected();
  const notes = items(ui.view.annotations).filter(x => !edition || x.editionId === edition.id);
  const editor = edition ? form('annotation-' + edition.id, [element('div', {class: 'grid'},
    field('annotation-subject', 'Asset, account, domain or record', edition.query?.asset || '', {required: true}),
    field('annotation-status', 'Review status', 'open', {choices: [['open', 'Open'], ['reviewed', 'Reviewed'], ['follow_up', 'Follow up']], required: true}),
    field('annotation-note', 'Observation and review note', '', {type: 'textarea', full: true, required: true,
      help: 'The note stays attached to this edition and its original source.'})
  )], 'Save source-linked note', async node => {
    await act('annotation.save', {editionId: edition.id, subject: value(node, 'annotation-subject'),
      status: value(node, 'annotation-status'), note: value(node, 'annotation-note')}, {clearDraft: 'annotation-' + edition.id});
  }) : null;
  return panel('Research and review notes', editor,
    notes.length ? element('ul', {class: 'list'}, ...notes.map(note => element('li', {},
      element('div', {class: 'actions spread'}, element('strong', {}, note.subject), badge(note.status)),
      paragraph(note.note, 'note-text'), paragraph(date(note.createdAt || note.updatedAt), 'small muted'))))
      : paragraph('Add a note to the selected source edition when a finding needs interpretation or follow-through.', 'help'));
}
function analysisView() {
  return [heading('Analysis and notes', 'Compare retained observations and attach review decisions to their source.'),
    selectedBanner(), comparisonPanel(), notesPanel(), rowsPanel(), exportsPanel()];
}

function datasetById(id) { return items(ui.view.datasets).find(x => x.id === id); }
function datasetPanel() {
  const edition = selected();
  const datasets = items(ui.view.datasets);
  const prepare = edition ? form('dataset-prepare-' + edition.id, [
    selectedBanner(),
    field('dataset-name', 'Dataset name', edition.label || 'Stellar source dataset', {required: true})
  ], 'Prepare selected edition as a dataset', async node => {
    await act('dataset.prepare', {editionId: edition.id, name: value(node, 'dataset-name')},
      {after: result => {ui.selectedDatasetId = result.datasetId || result.dataset?.id || result.result?.datasetId || result.result?.id || null;}});
  }) : selectedBanner();
  const list = datasets.length ? table([
    {label: 'Dataset', render: row => element('div', {}, element('strong', {}, row.name || row.label || short(row.id)),
      paragraph('Source edition ' + short(row.editionId), 'small muted'))},
    {label: 'Records', render: row => count(row.rows ?? row.recordCount ?? row.dataset?.rows)},
    {label: 'State', render: row => badge(row.state || row.status || 'prepared')},
    {label: 'Actions', render: row => element('div', {class: 'actions'},
      button('Use dataset', () => {rememberAll(); ui.selectedDatasetId = row.id; render();}),
      button('Dataset details', () => detail('Original dataset description', row)))}
  ], datasets) : paragraph('Prepared datasets use the selected edition and the original merchant dataset engine.', 'help');
  return panel('Prepare and select a dataset', prepare, list);
}
function selectedDataset() {
  return datasetById(ui.selectedDatasetId) || items(ui.view.datasets)[0];
}
async function runDatasetQuery(dataset, query, mode = 'new') {
  const previousQuery = ui.currentQuery, history = ui.queryHistory.slice();
  return act('dataset.query', {datasetId: dataset.id, query}, {after: response => {
    if (!Object.hasOwn(response, 'result')) return;
    ui.queryHistory = mode === 'next' ? [...history, previousQuery] :
      mode === 'previous' ? history.slice(0, -1) : [];
  }});
}
function datasetQueryBuilder(dataset) {
  const description = dataset.description || dataset.dataset || {};
  const columns = items(description.columns || dataset.columns).filter(column => column && typeof column.name === 'string');
  if (!columns.length) return null;
  const controls = [];
  const bound = (column, side) => {
    if (!column.rangeFilterable) return {node: paragraph('—')};
    const op = element('select', {name: 'range-' + side + '-' + column.name, 'aria-label': column.name + ' ' + side + ' operator'});
    const options = side === 'lower' ? [['', 'Any'], ['gt', '>'], ['gte', '≥']] : [['', 'Any'], ['lt', '<'], ['lte', '≤']];
    for (const [key, label] of options) op.append(element('option', {value: key}, label));
    const input = element('input', {type: 'text', name: 'bound-' + side + '-' + column.name,
      'aria-label': column.name + ' ' + side + ' value', autocomplete: 'off'});
    return {node: element('div', {class: 'query-bound'}, op, input), op, input};
  };
  const rows = columns.map(column => {
    const include = element('input', {type: 'checkbox', name: 'include-' + column.name, 'aria-label': 'Include ' + column.name});
    include.checked = true;
    const enabled = column.filterable ? element('input', {type: 'checkbox', name: 'equal-on-' + column.name,
      'aria-label': 'Enable ' + column.name + ' equality filter'}) : null;
    const equals = column.filterable ? element('input', {type: 'text', name: 'equals-' + column.name,
      'aria-label': column.name + ' equals', autocomplete: 'off'}) : null;
    const low = bound(column, 'lower'), high = bound(column, 'upper');
    const row = {column, include, enabled, equals, low, high};
    controls.push(row); return row;
  });
  const limits = description.limits || {};
  const maximum = description.maxLimit || limits.maxLimit || 200;
  const controlsTable = table([
    {label: 'Output field', render: row => element('label', {class: 'check'}, row.include, row.column.name)},
    {label: 'Type', render: row => row.column.type + (row.column.nullable ? ' / empty permitted' : '')},
    {label: 'Equals', render: row => row.enabled ? element('div', {class: 'query-equals'},
      element('label', {class: 'check'}, row.enabled, 'Use filter'), row.equals) : paragraph('—')},
    {label: 'Lower bound', render: row => row.low.node},
    {label: 'Upper bound', render: row => row.high.node}
  ], rows);
  controlsTable.classList.add('query-columns');
  const node = form('dataset-builder-' + dataset.id, [
    paragraph('Choose the output fields and the filters enabled for this dataset. Values keep their original text.', 'help'),
    element('div', {class: 'grid'},
      field('query-limit', 'Records per page', description.defaultLimit || limits.defaultLimit || 50,
        {type: 'number', min: 1, max: maximum, required: true}),
      field('query-sort', 'Record order', '', {choices: [['', 'Original CSV order'],
        ...columns.filter(column => column.sortable).flatMap(column =>
          [[column.name, column.name + ' · ascending'], ['-' + column.name, column.name + ' · descending']])]})),
    element('details', {}, element('summary', {}, 'Output fields and enabled filters'), controlsTable)
  ], 'Preview selected fields and filters', async formNode => {
    const query = new URLSearchParams();
    const fields = controls.filter(row => row.include.checked).map(row => row.column.name);
    if (!fields.length) throw Error('Select at least one output field.');
    query.set('fields', fields.join(','));
    query.set('limit', String(integer(formNode, 'query-limit', 1, maximum)));
    if (value(formNode, 'query-sort')) query.set('sort', value(formNode, 'query-sort'));
    for (const row of controls) {
      if (row.enabled?.checked) query.set('where_' + row.column.name, row.equals.value);
      for (const range of [row.low, row.high]) if (range.op?.value)
        query.set(range.op.value + '_' + row.column.name, range.input.value);
    }
    await runDatasetQuery(dataset, query.toString());
  });
  return node;
}
function queryPanel() {
  const dataset = selectedDataset();
  if (!dataset) return null;
  const query = form('dataset-query-' + dataset.id, [
    field('dataset-query', 'Exact dataset query parameters', 'limit=100', {type: 'textarea', spellcheck: false, required: true,
      help: 'Fields, limit, sort and enabled filters use the original dataset query contract.'}),
    jsonDetails('Dataset fields and query contract', dataset.description || dataset.dataset || dataset)
  ], 'Preview exact query', async node => runDatasetQuery(dataset, value(node, 'dataset-query')));
  const raw = ui.queryResultDatasetId === dataset.id ? ui.queryResult : null;
  const result = raw?.result || raw?.body || raw;
  const rows = result?.rows || [];
  const fields = result?.fields || result?.columns || (rows.length ? Object.keys(rows[0]) : []);
  return panel('Query the prepared dataset',
    paragraph('Selected dataset: ' + (dataset.name || dataset.label || short(dataset.id)), 'muted'),
    datasetQueryBuilder(dataset),
    element('details', {}, element('summary', {}, 'Advanced query parameters'), query),
    raw ? element('div', {},
      result.page ? scalarRecord(result.page) : null,
      element('div', {class: 'actions'},
        button('Previous query page', () => runDatasetQuery(dataset, ui.queryHistory.at(-1), 'previous'), false,
          {disabled: !ui.queryHistory.length, 'data-unavailable': String(!ui.queryHistory.length), 'data-mutation': 'true'}),
        button('Next query page', () => {
          const next = new URLSearchParams(ui.currentQuery); next.set('cursor', result.page.nextCursor);
          return runDatasetQuery(dataset, next.toString(), 'next');
        }, false, {disabled: !result.page?.nextCursor, 'data-unavailable': String(!result.page?.nextCursor), 'data-mutation': 'true'})),
      rows.length ? rowTable(fields, rows) : paragraph('The query returned no displayed rows.', 'muted'),
      button('Download this query result', () => downloadObject('stellar-dataset-query-result.json', raw)),
      jsonDetails('Query result and continuation', raw)) : null);
}
function paymentField(name, fallbackLabel) {
  const source = ui.schema.paymentFields;
  const entry = Array.isArray(source) ? source.find(x => idOf(x) === name) : source?.[name];
  const spec = ui.schema.paymentSchema?.[name] || (entry && typeof entry === 'object' ? entry : {});
  const choices = spec.choices || spec.options || spec.enum;
  return field('payment-' + name, spec.label || fallbackLabel, spec.default ?? '', {
    choices: choices?.map(x => typeof x === 'string' ? [x, x] : x),
    type: name === 'maxTimeoutSeconds' ? 'number' : 'text', min: spec.minimum,
    max: name === 'maxTimeoutSeconds' ? spec.maximum : undefined, required: true,
    help: spec.help || spec.description || (name === 'amount' ? 'Integer atomic amount from the selected payment contract.' : '')
  });
}
function releaseControls(release) {
  const publisher = release.publisher;
  if (!publisher) return paragraph('Inspect the retained release to open its original merchant controls.', 'help');
  const selection = publisher.releases?.state || {};
  const generation = selection.generation;
  const runtime = publisher.releases?.runtime || {};
  const unavailable = !Number.isSafeInteger(generation);
  const guarded = (label, action, extra = {}) => mutation(label, action,
    {releaseId: release.id, ...extra}, action === 'release.start',
    {});
  const activate = guarded('Activate release', 'release.activate', {expectedGeneration: generation});
  const start = guarded('Run merchant', 'release.start', {expectedGeneration: generation});
  const stop = guarded('Stop merchant', 'release.stop');
  const rollback = guarded('Restore previous release', 'release.rollback', {expectedGeneration: generation});
  for (const node of [activate, start, rollback]) node.dataset.unavailable = String(unavailable);
  if (!selection.previous) rollback.dataset.unavailable = 'true';
  const active = selection.active?.id || selection.active || 'No active release';
  return element('div', {},
    paragraph('Active: ' + String(active) + ' · generation ' + String(generation ?? 'unavailable'), 'small mono'),
    paragraph('Merchant: ' + (runtime.state || 'See original state'), 'small'),
    element('div', {class: 'actions'}, activate, start, stop, rollback),
    jsonDetails('Original merchant selection and runtime', {selection, runtime, ownsRelease: publisher.ownsRelease}));
}
function releasePanel() {
  const datasets = items(ui.view.datasets);
  const dataset = selectedDataset();
  const prepare = dataset ? form('release-prepare-' + dataset.id, [
    paragraph('Selected dataset: ' + (dataset.name || dataset.label || short(dataset.id)), 'muted'),
    element('div', {class: 'grid'},
      field('release-origin', 'Merchant HTTPS origin', '', {required: true, placeholder: 'https://merchant.example'}),
      field('release-path', 'Dataset route', '/stellar/assets', {required: true}),
      paymentField('scheme', 'Payment scheme'), paymentField('network', 'Payment network'),
      paymentField('asset', 'Payment asset'), paymentField('amount', 'Atomic amount'),
      paymentField('payTo', 'Receiving account'), paymentField('maxTimeoutSeconds', 'Payment timeout in seconds')
    )
  ], 'Prepare merchant release', async node => {
    const payment = Object.fromEntries(['scheme', 'network', 'asset', 'amount', 'payTo'].map(k => [k, value(node, 'payment-' + k)]));
    payment.maxTimeoutSeconds = integer(node, 'payment-maxTimeoutSeconds', 1, 86400);
    await act('release.prepare', {datasetId: dataset.id, origin: value(node, 'release-origin'),
      path: value(node, 'release-path'), payment}, {after: result => {ui.releaseResult = result.result || result;}});
  }) : paragraph('Prepare a source dataset to configure its merchant route and explicit payment terms.', 'muted');
  const releases = items(ui.view.releases);
  return panel('Merchant release', prepare,
    releases.length ? table([
      {label: 'Release', render: row => row.name || row.label || short(row.id)},
      {label: 'Dataset', render: row => datasetById(row.datasetId)?.name || short(row.datasetId)},
      {label: 'Resource', render: row => row.resource || row.resourceUrl || row.routes?.[0]?.definition?.resource || row.release?.publicOrigin || ((row.origin || '') + (row.path || '')) || '—'},
      {label: 'State', render: row => badge(row.publisher?.releases?.runtime?.state || row.state || row.status || 'prepared')},
      {label: 'Merchant controls', render: row => element('div', {}, releaseControls(row),
        mutation('Inspect original release', 'release.inspect', {releaseId: row.id}, false,
          {after: result => {ui.releaseResult = result.result || result;}}))}
    ], releases) : null,
    ui.releaseResult ? jsonDetails('Original release result and operating instructions', ui.releaseResult) : null);
}
function publicationsView() {
  return [heading('Merchant publications', 'Turn a reviewed source edition into a dataset and a release with explicit payment terms.'),
    datasetPanel(), queryPanel(), releasePanel()];
}

function receivingView() {
  const receiving = form('buyer-receiving', [
    paragraph('Inspect the startup-configured original buyer inbox, then receive the selected intent results.'),
    field('buyer-intents', 'Original buyer intent IDs', '', {type: 'textarea', required: true,
      help: 'One intent ID per line, or separated by commas. The original inbox owns its payment and delivery state.'})
  ], 'Inspect selected intents', async node => {
    await act('buyer.inspect', {intentIds: listValue(node, 'buyer-intents')},
      {after: result => {ui.receivingResult = result.result || result;}});
  });
  const receive = button('Receive selected purchases', async () => {
    try {
      remember(receiving);
      const intentIds = listValue(receiving, 'buyer-intents');
      if (!intentIds.length) throw Error('Enter the original buyer intent IDs.');
      await act('buyer.receive', {intentIds}, {after: result => {ui.receivingResult = result.result || result;}});
    } catch (error) { notify(error.message, true); }
  }, false, {'data-mutation': 'true'});
  receiving.querySelector('.form-actions').append(receive);
  const receipts = items(ui.view.receipts);
  return [
    heading('Customer receiving', 'Continue original buyer operations into their retained delivered files.'),
    panel('Original buyer inbox', receiving,
      ui.receivingResult ? jsonDetails('Selected buyer and receiving result', ui.receivingResult) : null),
    panel('Received datasets', receipts.length ? table([
      {label: 'Dataset', render: row => element('div', {}, element('strong', {text: row.dataset?.name || row.id}),
        paragraph(count(row.dataset?.rows) + ' rows · ' + count(row.dataset?.pages) + ' pages', 'help'))},
      {label: 'Original purchases', render: row => element('details', {},
        element('summary', {text: count(row.intentIds?.length) + ' ordered intents'}),
        element('ol', {}, ...(row.intentIds || []).map(id => element('li', {}, element('code', {text: id})))))},
      {label: 'Received', render: row => element('div', {}, badge(row.mode || 'received'), paragraph(date(row.createdAt), 'help'))},
      {label: 'Dataset and handover files', render: row => element('div', {class: 'form-actions'},
        ...(row.downloads || []).map(file => button('Download ' + file.name, async () => {
          try {
            if (!file.downloadUrl?.startsWith('/api/receipts/' + encodeURIComponent(row.id) + '/')) throw Error('Reopen the original receiving result to load its download.');
            await download(file.downloadUrl, file.name);
          } catch (error) { notify(error.message, true); }
        }, false, {title: count(file.bytes) + ' bytes'})))},
      {label: 'Detail', render: row => button('Open receiving details', () => detail('Retained customer dataset', row))}
    ], receipts) : empty('Receiving results appear here', 'Use the original inbox intents to receive their complete dataset and handover files.')),
    operationsPanel()
  ];
}
function operationsPanel() {
  const operations = items(ui.view.operations);
  return panel('Recent workspace operations', operations.length ? table([
    {label: 'Action', render: row => actionLabels[row.action] || words(row.action || row.kind)},
    {label: 'State', render: row => badge(row.state || row.status || 'completed')},
    {label: 'Time', render: row => date(row.completedAt || row.createdAt || row.startedAt)},
    {label: 'Details', render: row => button('Inspect', () => detail('Original workspace operation', row))}
  ], operations.slice(0, 50), true) : paragraph('Completed and continuing actions remain attached to this workspace.', 'muted'));
}
function render() {
  if (!ui.view || !ui.schema) { updateControls(); return; }
  if (!labels[ui.page]) ui.page = 'watchlist';
  for (const node of document.querySelectorAll('[data-view]')) {
    if (node.dataset.view === ui.page) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  }
  $('#session-state').textContent = 'Saved revision ' + count(ui.view.revision);
  $('#workspace-summary').replaceChildren(
    paragraph(items(ui.view.watchlist).length + ' tracked assets'),
    paragraph((ui.view.editionCount ?? items(ui.view.editions).length) + ' retained editions'),
    paragraph(items(ui.view.datasets).length + ' prepared datasets'),
    paragraph(items(ui.view.releases).length + ' merchant releases'),
    paragraph('Workspace ' + short(workspaceId()), 'mono')
  );
  const views = {watchlist: watchlistView, editions: editionsView, analysis: analysisView,
    publications: publicationsView, receiving: receivingView};
  $('#view').replaceChildren(...views[ui.page]().filter(Boolean));
  updateControls();
}
function detail(title, value) {
  $('#detail-title').textContent = title;
  $('#detail-content').replaceChildren(value instanceof Node ? value : element('pre', {}, JSON.stringify(value, null, 2)));
  $('#detail-dialog').showModal();
}
async function download(path, fallback) {
  const response = await fetch(path, {headers: {authorization: 'Bearer ' + token}, credentials: 'omit', cache: 'no-store'});
  if (!response.ok) throw Error('Download returned ' + response.status);
  const supplied = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(response.headers.get('content-disposition') || '')?.[1];
  const name = (supplied || fallback).replaceAll('/', '_').replaceAll('\\', '_').replace(/[\x00-\x1f]/g, '');
  downloadBlob(name, await response.blob());
}
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = element('a', {href: url, download: name});
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadObject(name, value) {
  downloadBlob(name, new Blob([JSON.stringify(value, null, 2) + '\n'], {type: 'application/json;charset=utf-8'}));
}
async function refresh() {
  if (ui.busy) return;
  rememberAll(); ui.busy = true; updateControls();
  try {
    await readView(); ui.rows = null; ui.rowOffset = 0; ui.editionArchive = null;
    notify('Current saved state loaded. Your drafts are retained.');
  } catch (error) { notify(error.message, true); }
  finally { ui.busy = false; render(); }
}
for (const node of document.querySelectorAll('[data-view]')) node.addEventListener('click', () => setPage(node.dataset.view));
$('#refresh').addEventListener('click', refresh);
$('#inspect-pending').addEventListener('click', refresh);
$('#recover-action').addEventListener('click', () => act(null, null, {recover: true}).catch(() => {}));
$('#load-conflict').addEventListener('click', async () => {
  rememberAll();
  try { await readView(); ui.conflict = null; ui.rows = null; notify('Current state loaded. Compare the source and save the retained draft when ready.'); render(); }
  catch (error) { notify(error.message, true); }
});
$('#close-detail').addEventListener('click', () => $('#detail-dialog').close());
window.addEventListener('pagehide', rememberAll);
(async () => {
  if (!token) { notify('Open the private session URL printed by the workspace command.', true); updateControls(); return; }
  try {
    const [schema, view] = await Promise.all([api('/api/schema'), api('/api/view')]);
    ui.schema = schema.schema && typeof schema.schema === 'object' ? schema.schema : schema;
    ui.view = view.view || view;
    if (!workspaceId()) throw Error('The service did not return its workspace identity.');
    notify('Workspace opened. Select a retained source or capture new observations.');
    render();
  } catch (error) { notify(error.message, true); updateControls(); }
})();
