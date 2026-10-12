// MIT. Native workbench browser. Provider and analyst text is inserted as text.
const $ = selector => document.querySelector(selector);
const storageKey = 'opendatasoft-workbench-capability';
let token = location.hash.slice(1);
try {
  if (token) { sessionStorage.setItem(storageKey, token); history.replaceState(null, '', location.pathname); }
  else token = sessionStorage.getItem(storageKey) ?? '';
} catch { if (token) history.replaceState(null, '', location.pathname); }
const view = $('#view'), notice = $('#notice');
const drafts = new Map(), editionOffsets = new Map(), offerCache = new Map();
let state, tab = 'catalog', selectedDataset = null, datasetDetail = null, catalogue = null;
let selectedEdition = null, selectedPublication = null, selectedExport = null, selectedSource = null;
let searchInput = { where: '', order_by: '', lang: 'en', offset: 0, limit: 20 };
let renderGeneration = 0, refreshGeneration = 0, formNumber = 0, activeController = new AbortController();
let polling = false, pending = null, disposed = false;

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (['checked', 'disabled', 'required', 'hidden', 'multiple'].includes(key)) node[key] = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity))
    if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const heading = text => element('h2', {}, text);
const card = (...children) => element('section', { class: 'card' }, ...children);
const row = (...children) => element('div', { class: 'row' }, ...children);
const muted = text => element('p', { class: 'muted' }, text);
const pill = text => element('span', { class: 'pill' }, text ?? 'Unspecified');
const pre = value => element('pre', {}, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const detail = (title, value) => element('details', {}, element('summary', {}, title), pre(value));
const input = (name, value = '', type = 'text', attrs = {}) => element('input', { name, value: value ?? '', type, ...attrs });
const label = (name, field, grow = false) => element('label', { class: grow ? 'grow' : '' }, element('span', {}, name), field);
const textarea = (name, value = '', rows = 3, attrs = {}) => element('textarea', { name, rows, ...attrs }, value);
const formatDate = value => value ? String(value).replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : 'Unspecified';
const count = value => value === null || value === undefined ? 'Unspecified' : String(value);
const uri = value => encodeURIComponent(String(value));
function choose(name, options, current, attrs = {}) {
  const node = element('select', { name, ...attrs });
  for (const entry of options) {
    const [value, text] = Array.isArray(entry) ? entry : [entry, entry];
    const option = element('option', { value }, text); option.selected = String(value) === String(current); node.append(option);
  }
  return node;
}
function link(text, target) {
  try {
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return element('span', {}, text);
    return element('a', { href: url.href, target: '_blank', rel: 'noopener noreferrer' }, text);
  } catch { return element('span', {}, text); }
}
function display(value) {
  if (value === null) return 'null';
  if (value === undefined) return '[missing]';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
function cell(value) {
  const text = display(value);
  if (text.length > 240) return element('details', { class: 'cell-value' }, element('summary', {}, text.slice(0, 120) + '…'), pre(text));
  return element('span', { class: value === null || value === undefined ? 'missing' : '' }, text);
}
function table(records, columns, options = {}) {
  if (!records?.length) return muted('This selection has no rows.');
  const keys = columns ?? [...new Set(records.flatMap(record => Object.keys(record)))];
  return element('div', { class: 'table-wrap' }, element('table', {},
    element('thead', {}, element('tr', {},
      options.rowAction ? element('th', { scope: 'col' }, 'Source row') : null,
      keys.map(key => element('th', { scope: 'col' }, key)))),
    element('tbody', {}, records.map((record, index) => element('tr', {},
      options.rowAction ? element('td', {}, button(String((options.offset ?? 0) + index), () => options.rowAction((options.offset ?? 0) + index, record), false, { class: 'row-number' })) : null,
      keys.map(key => element('td', {}, cell(record[key]))))))));
}
function current(generation, node) { return !disposed && generation === renderGeneration && (!node || node.isConnected); }
function message(error, kind = 'error') {
  notice.replaceChildren(element('div', { class: kind, role: kind === 'error' ? 'alert' : 'status' }, error.message ?? String(error)));
}
async function protect(action, node) {
  const generation = renderGeneration;
  if (node && !node.isConnected) return;
  notice.replaceChildren();
  try { return await action(); }
  catch (error) { if (error.name !== 'AbortError' && current(generation, node)) message(error); }
}
function button(text, action, primary = false, attrs = {}) {
  let busy = false;
  const node = element('button', { type: 'button', class: primary ? 'primary' : '', ...attrs }, text);
  node.addEventListener('click', () => {
    if (busy || !node.isConnected || node.disabled) return;
    busy = true; node.disabled = true;
    protect(action, node).finally(() => { busy = false; if (node.isConnected) node.disabled = false; updateBusy(); });
  });
  return node;
}
const submit = text => element('button', { type: 'submit', class: 'primary' }, text);
function form(key, handler, children, options = {}) {
  // Original publisher forms can use form(handler,...children).
  if (typeof key === 'function') {
    const args = [...arguments]; handler = args.shift(); children = args;
    key = tab + ':' + (selectedPublication ?? selectedExport ?? '') + ':form-' + formNumber++;
    options = {};
  } else if (!Array.isArray(children)) children = children ? [children] : [];
  const fields = element('fieldset', { class: 'form-fields' }, ...children);
  const node = element('form', { 'data-form-key': key, 'data-mutates': options.readOnly ? 'false' : 'true' }, fields);
  const controls = () => [...node.elements].filter(item => item.name && item.type !== 'submit' && item.type !== 'button');
  const saved = drafts.get(key);
  if (saved) controls().forEach((control, index) => {
    const original = saved[index];
    if (!original || control.name !== original.name || control.type !== original.type) return;
    if (control.type === 'checkbox' || control.type === 'radio') control.checked = original.checked;
    else if (control.tagName !== 'SELECT' || [...control.options].some(option => option.value === original.value)) control.value = original.value;
  });
  const remember = () => drafts.set(key, controls().map(control => ({ name: control.name, type: control.type, value: control.value, checked: control.checked })));
  node.addEventListener('input', remember); node.addEventListener('change', remember);
  node.addEventListener('submit', event => {
    event.preventDefault();
    if (!node.isConnected || node.dataset.busy === 'true') return;
    const generation = renderGeneration;
    if (!options.readOnly && state?.active) { message('The project is completing its current operation. Its progress is shown above.'); return; }
    const submitted = new FormData(node);
    node.dataset.busy = 'true'; remember(); updateBusy();
    protect(async () => {
      if (!current(generation, node)) return;
      const result = await handler(submitted, node);
      if (!options.readOnly && result?.operationId) {
        if (state?.operation?.id === result.operationId && state.operation.state === 'COMPLETE') drafts.delete(key);
        else if (pending?.id === result.operationId) pending.formKey = key;
      }
    }, node).finally(() => { node.dataset.busy = 'false'; updateBusy(); });
  });
  return node;
}
function updateBusy() {
  for (const node of document.querySelectorAll('[data-operation-button]')) node.disabled = Boolean(state?.active);
  for (const form of document.querySelectorAll('form')) {
    const busy = form.dataset.busy === 'true' || form.dataset.mutates === 'true' && Boolean(state?.active);
    const fields = form.querySelector(':scope > fieldset.form-fields');
    if (fields) fields.disabled = busy;
    for (const submit of form.querySelectorAll('button[type=submit]')) submit.disabled = busy;
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
}
function parse(data, name, fallback) {
  const text = String(data.get(name) ?? '').trim();
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { throw new Error('Enter valid JSON for ' + name + '.'); }
}
const list = value => String(value ?? '').split(',').map(value => value.trim()).filter(Boolean);
const lines = value => String(value ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
function number(data, name, minimum = 0) {
  const raw = String(data.get(name) ?? '').trim();
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < minimum)
    throw new Error('Enter a whole number of at least ' + minimum + ' for ' + name + '.');
  return Number(raw);
}
async function api(path, data, options = {}) {
  const readOnly = data === undefined || options.readOnly;
  const response = await fetch('/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + token, ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    ...(readOnly && options.scope !== false ? { signal: activeController.signal } : {}),
  });
  let value;
  try { value = await response.json(); } catch { throw new Error('The local server returned an unreadable response. Reopen the project status.'); }
  if (!response.ok) {
    const error = new Error((value.error ?? response.status) + ': ' + (value.message ?? 'Request failed.'));
    error.status = response.status; error.code = value.error; throw error;
  }
  return value;
}
async function download(path, suggestedName) {
  const generation = renderGeneration;
  const response = await fetch('/api/' + path, { headers: { authorization: 'Bearer ' + token }, signal: activeController.signal });
  if (!response.ok) { const error = await response.json(); throw new Error(error.message ?? error.error); }
  const blob = await response.blob();
  if (!current(generation)) return;
  const reported = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1];
  const objectUrl = URL.createObjectURL(blob), anchor = element('a', { href: objectUrl, download: reported ?? suggestedName });
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
function operation() {
  const slot = $('#operation'); slot.replaceChildren();
  const value = state?.operation;
  if (!value) return;
  const status = element('div', {}, element('strong', {}, value.kind + ' · ' + value.state));
  if (value.progress) status.append(element('div', { class: 'mono break' }, JSON.stringify(value.progress)));
  if (value.error) status.append(muted(typeof value.error === 'object' ? (value.error.message ?? value.error.code) : value.error));
  const actions = value.state === 'RUNNING' ? button('Stop operation', async () => { await api('cancel', {}); await refresh(false); }) : null;
  slot.append(element('div', { class: 'operation' }, status, actions));
}
function applyResult(result) {
  if (!result) return;
  if (state.editions.some(item => item.id === result.id)) selectedEdition = result.id;
  if (state.publications.some(item => item.id === result.id)) selectedPublication = result.id;
  if (state.exports.some(item => item.id === result.id)) selectedExport = result.id;
}
async function refresh(render = true) {
  const version = ++refreshGeneration;
  const received = await api('status', undefined, { scope: false });
  if (disposed || version !== refreshGeneration) return;
  state = received;
  $('#project').replaceChildren(element('div', {}, state.catalogOrigin), element('div', { class: 'project-path' }, state.directory));
  operation(); updateBusy();
  if (render) await renderView();
  if (state.active && !polling) void poll();
}
async function poll() {
  polling = true;
  try {
    while (!disposed && state?.active) {
      await new Promise(resolve => setTimeout(resolve, document.hidden ? 2500 : 900));
      if (!disposed) await refresh(false);
    }
    if (disposed) return;
    const match = pending && state.operation?.id === pending.id;
    if (match) {
      if (state.operation.state === 'COMPLETE') { applyResult(state.operation.result); if (pending.formKey) drafts.delete(pending.formKey); }
      const destination = pending.target;
      if (tab === pending.startTab || tab === destination) {
        if (destination && state.operation.state === 'COMPLETE') tab = destination;
        await renderView();
      }
      pending = null;
    } else operation();
  } catch (error) { if (!disposed) message(error); }
  finally { polling = false; updateBusy(); }
}
async function act(path, data, target) {
  const startTab = tab, generation = renderGeneration;
  const result = await api(path, data);
  pending = { id: result.operationId, startTab, target };
  if (result.editionId) selectedEdition = result.editionId;
  await refresh(false);
  if (!state.active && state.operation?.id === result.operationId) {
    if (state.operation.state === 'COMPLETE') applyResult(state.operation.result);
    if (current(generation) && target && state.operation.state === 'COMPLETE') tab = target;
    pending = null;
    if (current(generation)) await renderView();
  } else if (current(generation) && result.editionId) { tab = 'editions'; await renderView(); }
  return result;
}
function pagination(page, change) {
  const start = page.returned ? page.offset + 1 : 0, end = page.offset + page.returned;
  return row(muted('Rows ' + start + '–' + end + ' of ' + count(page.total)),
    page.offset > 0 ? button('Previous', () => change(Math.max(0, page.offset - page.limit))) : null,
    page.next !== null && page.next !== undefined ? button('Next', () => change(page.next)) : null);
}
async function renderView() {
  activeController.abort(); activeController = new AbortController();
  const generation = ++renderGeneration; formNumber = 0;
  for (const item of document.querySelectorAll('nav button')) {
    const selected = item.dataset.tab === tab; item.classList.toggle('selected', selected);
    if (selected) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  }
  view.replaceChildren();
  if (!state) return;
  if (tab === 'catalog') renderCatalogue(generation);
  else if (tab === 'editions') await renderEditions(generation);
  else if (tab === 'products') await renderProducts(generation);
  else if (tab === 'merchant') renderMerchant(generation);
  else if (tab === 'receiving') renderReceiving(generation);
  updateBusy();
}


function datasetTitle(dataset) { return dataset?.title ?? dataset?.datasetId ?? dataset?.id ?? 'Dataset'; }
async function searchCatalog(query) {
  const generation = renderGeneration;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) for (const item of value) params.append(key, item);
    else if (value !== '' && value !== undefined) params.set(key, String(value));
  }
  const result = await api('search?' + params);
  if (!current(generation)) return;
  catalogue = result; searchInput = { ...query }; await renderView();
}
async function openDataset(id) {
  id = String(id ?? '').trim();
  if (!id) throw new Error('Enter a dataset ID.');
  selectedDataset = id; datasetDetail = null; tab = 'catalog'; await renderView();
  const generation = renderGeneration;
  const result = await api('datasets/' + uri(id));
  if (!current(generation) || selectedDataset !== id) return;
  datasetDetail = result; await renderView();
}
function renderCatalogue(generation) {
  view.append(heading('Catalogue and dataset selection'),
    card(form('catalog-search', data => searchCatalog({
      where: String(data.get('where') ?? '').trim(), order_by: String(data.get('order_by') ?? '').trim(),
      refine: lines(data.get('refine')), exclude: lines(data.get('exclude')),
      lang: String(data.get('lang') ?? 'en').trim(), offset: 0, limit: 20,
    }), [
      row(label('Catalogue ODSQL filter', input('where', searchInput.where, 'text', { placeholder: 'Leave blank to browse the portal' }), true),
        label('Order by', input('order_by', searchInput.order_by, 'text', { placeholder: 'Optional ODSQL ordering' }), true),
        label('Language', input('lang', searchInput.lang ?? 'en', 'text', { maxlength: 16 })), submit('Search catalogue')),
      element('details', {}, element('summary', {}, 'Catalogue refinements'),
        row(label('Refine · one expression per line', textarea('refine', (searchInput.refine ?? []).join('\n'), 2), true),
          label('Exclude · one expression per line', textarea('exclude', (searchInput.exclude ?? []).join('\n'), 2), true))),
    ], { readOnly: true })),
    card(form('direct-dataset', data => openDataset(data.get('datasetId')), [
      row(label('Open a dataset by its original ID', input('datasetId', selectedDataset ?? '', 'text', { required: true, placeholder: 'open-data-sources' }), true),
        submit('Open dataset')),
    ], { readOnly: true })));
  if (datasetDetail && selectedDataset) renderDataset(datasetDetail, generation);
  else if (selectedDataset) view.append(card(element('h3', {}, selectedDataset), muted('Reading the original dataset metadata…')));
  if (!catalogue) { view.append(muted('Browse this portal or open a known dataset. The selected project keeps its own portal origin.')); return; }
  view.append(heading('Catalogue results'), pagination(catalogue.page, offset => searchCatalog({ ...searchInput, offset })));
  if (!catalogue.datasets.length) view.append(element('div', { class: 'empty' }, 'The portal returned no datasets for this selection.'));
  for (const dataset of catalogue.datasets) {
    view.append(card(row(element('h3', { class: 'grow' }, datasetTitle(dataset)), pill(count(dataset.rowCount) + ' records')),
      element('div', { class: 'meta' }, element('span', {}, dataset.datasetId ?? dataset.id), element('span', {}, dataset.publisher ?? 'Publisher unspecified'),
        element('span', {}, 'Modified ' + formatDate(dataset.modified))),
      muted(String(dataset.description ?? '').slice(0, 500)),
      row(element('span', { class: 'meta' }, 'License: ', dataset.license?.url ? link(dataset.license.title ?? dataset.license.url, dataset.license.url) : dataset.license?.title ?? 'Unspecified'),
        button('Inspect dataset', () => openDataset(dataset.datasetId ?? dataset.id), true))));
  }
  view.append(pagination(catalogue.page, offset => searchCatalog({ ...searchInput, offset })), detail('Catalogue response receipt', catalogue.receipt));
}
function querySelection(data) {
  const result = { lang: String(data.get('lang') ?? 'en').trim() || 'en', timezone: String(data.get('timezone') ?? 'UTC').trim() || 'UTC' };
  for (const key of ['where', 'order_by']) { const value = String(data.get(key) ?? '').trim(); if (value) result[key] = value; }
  for (const key of ['refine', 'exclude']) { const value = lines(data.get(key)); if (value.length) result[key] = value; }
  return result;
}
function renderDataset(result, generation) {
  const summary = result.summary, dataset = result.dataset, id = summary.datasetId ?? summary.id ?? selectedDataset;
  const fields = summary.fields ?? dataset.fields ?? [];
  const metadata = dataset.metas?.default ?? {};
  view.append(card(row(element('h3', { class: 'grow' }, datasetTitle(summary)), pill(count(summary.rowCount) + ' records')),
    element('div', { class: 'meta' }, 'Dataset ' + id, 'UID ' + (summary.datasetUid ?? dataset.dataset_uid ?? 'Unspecified'),
      'Modified ' + formatDate(summary.modified)),
    muted(summary.description ?? metadata.description ?? ''),
    row(element('span', {}, 'License: ', summary.license?.url ? link(summary.license.title ?? summary.license.url, summary.license.url) : summary.license?.title ?? 'Unspecified'),
      metadata.attributions ? element('span', {}, 'Attribution: ' + display(metadata.attributions)) : null),
    element('details', {}, element('summary', {}, fields.length + ' original fields'),
      table(fields.map(field => ({ field: field.id ?? field.name, label: field.label, type: field.type, annotations: field.annotations })),
        ['field', 'label', 'type', 'annotations'])),
    detail('Complete original metadata and response receipt', { dataset, receipt: result.receipt })));
  const previewSlot = element('div', { 'aria-live': 'polite' });
  let selectionForm;
  const preview = async (offset = 0) => {
    const version = renderGeneration;
    const selection = querySelection(new FormData(selectionForm));
    const received = await api('datasets/' + uri(id) + '/preview', { ...selection, limit: 100, offset }, { readOnly: true });
    if (!current(version, previewSlot)) return;
    previewSlot.replaceChildren(element('h4', {}, 'Original records preview'), pagination(received.page, preview),
      table(received.records), detail('Preview response receipt', received.receipt));
  };
  selectionForm = form('capture-selection:' + id, data => act('capture', {
    datasetId: id, ...querySelection(data), maxRows: number(data, 'maxRows', 1), maxBytes: number(data, 'maxBytes', 1),
  }, 'editions'), [
    row(label('Record filter · ODSQL where', textarea('where', '', 2, { placeholder: 'Optional filter on the original dataset fields' }), true)),
    row(label('Record ordering · ODSQL order_by', input('order_by', ''), true),
      label('Language', input('lang', 'en', 'text', { maxlength: 16 })), label('Timezone', input('timezone', 'UTC'))),
    row(label('Refine · one expression per line', textarea('refine', '', 2), true),
      label('Exclude · one expression per line', textarea('exclude', '', 2), true)),
    element('details', {}, element('summary', {}, 'Capture capacity'),
      row(label('Maximum retained rows', input('maxRows', '250000', 'number', { min: 1, required: true })),
        label('Maximum response bytes', input('maxBytes', '268435456', 'number', { min: 1, required: true })))),
    muted('Preview reads a page of original records. Capture retains the complete JSON export for these filters together with opening and closing metadata.'),
    element('div', { class: 'actions' }, button('Preview records', () => preview(0)), submit('Capture complete edition')),
  ]);
  view.append(card(element('h3', {}, 'Review the dataset query'), selectionForm, previewSlot));
  const aggregateSlot = element('div', { 'aria-live': 'polite' });
  view.append(card(element('details', {}, element('summary', {}, 'Preview an ODSQL selection or aggregation'),
    muted('Use the current record filters with explicit select and group_by expressions. The returned preview keeps its own original response receipt.'),
    form('aggregation:' + id, async data => {
      const version = renderGeneration;
      const selection = { ...querySelection(new FormData(selectionForm)), select: String(data.get('select') ?? '').trim(),
        group_by: String(data.get('group_by') ?? '').trim(), limit: number(data, 'limit', 1), offset: 0 };
      if (!selection.group_by) delete selection.group_by;
      const received = await api('datasets/' + uri(id) + '/preview', selection, { readOnly: true });
      if (current(version, aggregateSlot)) aggregateSlot.replaceChildren(muted('Returned ' + received.page.returned + ' of ' + count(received.totalCount)),
        table(received.records), detail('Original aggregation receipt', received.receipt));
    }, [
      row(label('Select expression', input('select', '*', 'text', { placeholder: 'Fields, aliases or aggregate functions', required: true }), true),
        label('Group by expression', input('group_by', '', 'text', { placeholder: 'Optional grouping fields' }), true),
        label('Preview rows', input('limit', '100', 'number', { min: 1, max: 100, required: true })), submit('Preview selection')),
    ], { readOnly: true }), aggregateSlot)));
}


function editionTitle(value) { return value.datasetTitle ?? value.title ?? value.datasetId ?? value.selection?.datasetId ?? 'Edition'; }
function svgNode(name, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  for (const child of children) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function geometries(value, type, depth = 0) {
  if (depth > 16 || value == null) return [];
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
  const valid = pair => Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1]) &&
    pair[0] >= -180 && pair[0] <= 180 && pair[1] >= -90 && pair[1] <= 90;
  if (type === 'geo_point_2d') return value && Number.isFinite(value.lon) && Number.isFinite(value.lat) && valid([value.lon, value.lat]) ?
    [{ point: [value.lon, value.lat] }] : [];
  if (!value || typeof value !== 'object') return [];
  if (value.type === 'Feature') return geometries(value.geometry, 'geo_shape', depth + 1);
  if (value.type === 'GeometryCollection') return (value.geometries ?? []).flatMap(item => geometries(item, 'geo_shape', depth + 1));
  if (value.type === 'Point') return valid(value.coordinates) ? [{ point: value.coordinates }] : [];
  if (value.type === 'MultiPoint') return (value.coordinates ?? []).filter(valid).map(point => ({ point }));
  const lines = value.type === 'LineString' ? [value.coordinates] :
    value.type === 'Polygon' || value.type === 'MultiLineString' ? value.coordinates :
    value.type === 'MultiPolygon' ? value.coordinates?.flat() : [];
  return Array.isArray(lines) ? lines.filter(line => Array.isArray(line) && line.length && line.every(valid)).map(line => ({ line })) : [];
}
function coordinateView(records, field, offset, inspect) {
  const wrap = element('div', { class: 'coordinate-view' });
  if (!field) { wrap.append(muted('Choose an original geographic field to inspect its coordinates.')); return wrap; }
  const drawing = svgNode('svg', { viewBox: '0 0 800 425', role: 'img', 'aria-label': 'Longitude and latitude of the displayed source rows' });
  drawing.append(svgNode('rect', { x: 40, y: 20, width: 720, height: 360, class: 'plot-background' }));
  const position = point => [40 + (point[0] + 180) * 2, 20 + (90 - point[1]) * 2];
  for (const longitude of [-180, -90, 0, 90, 180]) {
    const x = position([longitude, 0])[0];
    drawing.append(svgNode('line', { x1: x, y1: 20, x2: x, y2: 380, class: 'plot-grid' }),
      svgNode('text', { x, y: 400, 'text-anchor': 'middle', class: 'plot-label' }, longitude + '°'));
  }
  for (const latitude of [-90, -45, 0, 45, 90]) {
    const y = position([0, latitude])[1];
    drawing.append(svgNode('line', { x1: 40, y1: y, x2: 760, y2: y, class: 'plot-grid' }),
      svgNode('text', { x: 32, y: y + 4, 'text-anchor': 'end', class: 'plot-label' }, latitude + '°'));
  }
  let drawn = 0, unavailable = 0, positions = 0, limited = false;
  records.forEach((record, localIndex) => {
    const shapes = geometries(record[field.id ?? field.name], field.type);
    if (!shapes.length) { unavailable++; return; }
    const group = svgNode('g', { class: 'plot-feature', tabindex: 0, role: 'button', 'aria-label': 'Inspect source row ' + (offset + localIndex) });
    group.append(svgNode('title', {}, 'Source row ' + (offset + localIndex)));
    group.addEventListener('click', () => inspect(offset + localIndex, record));
    group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect(offset + localIndex, record); } });
    for (const shape of shapes) {
      if (positions >= 50000) { limited = true; break; }
      if (shape.point) {
        const [cx, cy] = position(shape.point); group.append(svgNode('circle', { cx, cy, r: 3, class: 'plot-point' })); positions++;
      } else {
        let path = '', previous;
        for (const point of shape.line) {
          if (positions++ >= 50000) { limited = true; break; }
          const [x, y] = position(point);
          path += (!previous || Math.abs(x - previous[0]) > 360 ? 'M' : 'L') + x + ' ' + y + ' ';
          previous = [x, y];
        }
        if (path) group.append(svgNode('path', { d: path, class: 'plot-line' }));
      }
    }
    if (group.childNodes.length > 1) { drawing.append(group); drawn++; }
  });
  wrap.append(drawing, muted(drawn + ' displayed rows with geographic coordinates · ' + unavailable +
    ' with no usable value on this page. Select a point or shape to inspect its source row.' +
    (limited ? ' The coordinate view reached its display capacity; the complete geometry remains in the GeoJSON export.' : '')));
  return wrap;
}
async function renderEditions(generation) {
  view.append(heading('Retained editions'));
  if (!state.editions.length) {
    view.append(element('div', { class: 'empty' }, 'Capture a dataset or receive an existing capture in the Receiving section.'));
    return;
  }
  if (!state.editions.some(item => item.id === selectedEdition)) selectedEdition = state.editions.at(-1).id;
  const selector = choose('edition', state.editions.map(item => [item.id, editionTitle(item) + ' · ' + item.state + ' · ' + formatDate(item.createdAt)]), selectedEdition);
  selector.addEventListener('change', () => protect(async () => { selectedEdition = selector.value; await renderView(); }, selector));
  view.append(card(label('Saved edition', selector)));
  const currentEdition = await api('editions/' + uri(selectedEdition));
  if (!current(generation)) return;
  if (currentEdition.state !== 'COMPLETE') {
    view.append(card(pill(currentEdition.state), muted(currentEdition.error ?? 'The project retains the current capture progress.'),
      detail('Original selection and retained progress', { selection: currentEdition.selection, progress: currentEdition.progress }),
      form('resume:' + currentEdition.id, data => act('editions/' + uri(currentEdition.id) + '/resume', {
        maxRows: number(data, 'maxRows', 1), maxBytes: number(data, 'maxBytes', 1),
      }, 'editions'), [
        row(label('Maximum rows', input('maxRows', currentEdition.limits?.maxRows ?? 250000, 'number', { min: 1, required: true })),
          label('Maximum bytes', input('maxBytes', currentEdition.limits?.maxBytes ?? 268435456, 'number', { min: 1, required: true }))),
        submit('Resume this capture'),
      ])));
    return;
  }
  const edition = currentEdition, note = edition.notes ?? { revision: 0, text: '', rowNotes: [] };
  const fields = edition.fields ?? [];
  view.append(card(row(element('h3', { class: 'grow' }, editionTitle(edition)), pill('Complete')),
    element('div', { class: 'meta' }, count(edition.rowCount) + ' retained rows', count(edition.pageCount) + ' original export response(s)',
      String(edition.consistency ?? ''), 'Captured ' + formatDate(edition.completedAt)),
    muted('Dataset ' + edition.datasetId + ' · UID ' + edition.datasetUid),
    row(element('span', {}, 'License: ', edition.license?.url ? link(edition.license.title ?? edition.license.url, edition.license.url) : edition.license?.title ?? 'Unspecified'),
      edition.rights?.attributions ? element('span', {}, 'Attribution: ' + display(edition.rights.attributions)) : null),
    detail('Source, rights, processing timestamps and exact response identities', edition.source)));

  const noteRows = new Map((note.rowNotes ?? []).map(item => [item.rowIndex, item.text]));
  let notesForm, rowIndexInput, rowTextInput, notesTextInput;
  const rowDetail = element('section', { class: 'row-detail', hidden: true, tabindex: -1 });
  const inspect = (rowIndex, record) => {
    rowDetail.hidden = false;
    rowDetail.replaceChildren(row(element('h3', { class: 'grow' }, 'Source row ' + rowIndex),
      button('Close row', () => { rowDetail.hidden = true; })),
      table(Object.entries(record).map(([field, value]) => ({ field, value })), ['field', 'value']),
      button('Annotate this row', () => {
        if (state?.active || notesForm?.dataset.busy === 'true') {
          message('The project is saving its current operation. Continue editing notes when it completes.'); return;
        }
        rowIndexInput.value = rowIndex; rowTextInput.value = noteRows.get(rowIndex) ?? '';
        rowIndexInput.dispatchEvent(new Event('input', { bubbles: true }));
        notesForm.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); rowTextInput.focus();
      }));
    rowDetail.focus();
  };
  const offset = editionOffsets.get(edition.id) ?? 0;
  const retained = await api('editions/' + uri(edition.id) + '/rows?' + new URLSearchParams({ offset, limit: 100 }));
  if (!current(generation)) return;
  const move = async value => { editionOffsets.set(edition.id, value); await renderView(); };
  view.append(card(element('h3', {}, 'Browse the original retained rows'), pagination(retained.page, move),
    table(retained.records, fields.map(field => field.id ?? field.name), { offset: retained.page.offset, rowAction: inspect }),
    pagination(retained.page, move), rowDetail));

  const geoFields = fields.filter(field => ['geo_point_2d', 'geo_shape'].includes(field.type));
  const geoChoices = [['', 'Choose a geographic field'], ...geoFields.map(field => [field.id ?? field.name, (field.label ?? field.id ?? field.name) + ' · ' + field.type])];
  const geo = choose('geometryField', geoChoices, geoFields.length === 1 ? (geoFields[0].id ?? geoFields[0].name) : '');
  const geoSlot = element('div');
  const draw = () => geoSlot.replaceChildren(coordinateView(retained.records, geoFields.find(field => (field.id ?? field.name) === geo.value), retained.page.offset, inspect));
  geo.addEventListener('change', draw); draw();
  if (geoFields.length) view.append(card(element('h3', {}, 'Geographic review'), label('Original coordinate field', geo), geoSlot));
  const facetSlot = element('div', { 'aria-live': 'polite' });
  view.append(card(element('h3', {}, 'Exact field-value counts'), form('facets:' + edition.id, async data => {
    const version = renderGeneration;
    const facets = await api('editions/' + uri(edition.id) + '/facets?' + new URLSearchParams({ field: data.get('field'), limit: data.get('limit'), mode: data.get('mode') }));
    if (!current(version, facetSlot)) return;
    facetSlot.replaceChildren(element('div', { class: 'stats' }, [
      ['Source rows', facets.totalRows], ['Distinct values', facets.distinct], ['Nulls', facets.nulls], ['Missing', facets.missing],
    ].map(([title, value]) => element('div', {}, element('strong', { class: 'stat' }, count(value)), element('span', {}, title)))),
    table(facets.values, ['value', 'count']),
    muted('Showing ' + facets.shown + ' of ' + facets.distinct + ' distinct values. ' + (data.get('mode') === 'members' ? 'Array members are counted once per source record; text labels remain intact.' : 'Arrays and structured objects are counted as their original complete values.')));
  }, [
    row(label('Original field', choose('field', fields.map(field => [field.id ?? field.name, field.label ?? field.id ?? field.name])), true),
      label('Interpretation', choose('mode', [['value', 'Complete original values'], ['members', 'Array members per record']], 'value')),
      label('Values to display', choose('limit', ['50', '100', '500', '1000'], '50')), submit('Read retained counts')),
  ], { readOnly: true }), facetSlot));

  notesTextInput = textarea('text', note.text, 4, { maxlength: 262144 });
  rowIndexInput = input('rowIndex', '', 'number', { min: 0, max: Math.max(0, edition.rowCount - 1), placeholder: 'Zero-based source row' });
  rowTextInput = textarea('rowText', '', 3, { maxlength: 16384 });
  const savedNotesSlot = element('div');
  const drawNotes = () => {
    savedNotesSlot.replaceChildren();
    if (!noteRows.size) { savedNotesSlot.append(muted('Choose a source row to add an annotation.')); return; }
    for (const [rowIndex, text] of [...noteRows].sort((a, b) => a[0] - b[0])) {
      savedNotesSlot.append(element('div', { class: 'saved-note' },
        row(element('strong', { class: 'grow' }, 'Source row ' + rowIndex),
          button('Edit', () => { rowIndexInput.value = rowIndex; rowTextInput.value = text; rowTextInput.focus(); }),
          button('Remove', () => { noteRows.delete(rowIndex); if (rowIndexInput.value === String(rowIndex)) { rowIndexInput.value = ''; rowTextInput.value = ''; } syncNotesDraft(); drawNotes(); })),
        element('p', { class: 'note-text' }, text)));
    }
  };
  const rowNotesInput = input('rowNotes', JSON.stringify([...noteRows].map(([rowIndex, text]) => ({ rowIndex, text }))), 'hidden');
  const syncNotesDraft = () => {
    rowNotesInput.value = JSON.stringify([...noteRows].map(([rowIndex, text]) => ({ rowIndex, text })));
    rowNotesInput.dispatchEvent(new Event('input', { bubbles: true }));
  };
  notesForm = form('notes:' + edition.id + ':' + note.revision, data => {
    const rowNotes = parse(data, 'rowNotes', []);
    const editing = String(data.get('rowIndex') ?? '').trim();
    if (editing) {
      const rowIndex = number(data, 'rowIndex', 0);
      if (rowIndex >= edition.rowCount) throw new Error('Choose an existing source row index.');
      const text = String(data.get('rowText') ?? '');
      const previous = rowNotes.findIndex(item => item.rowIndex === rowIndex);
      if (previous >= 0) rowNotes.splice(previous, 1);
      if (text.trim()) rowNotes.push({ rowIndex, text });
    }
    return act('editions/' + uri(edition.id) + '/notes', { expectedCaptureSha256: edition.manifestSha256,
      expectedRevision: note.revision, text: String(data.get('text') ?? ''), rowNotes }, 'editions');
  }, [
    label('Edition findings and decisions', notesTextInput),
    rowNotesInput,
    element('details', {}, element('summary', {}, 'Add or edit a source-row note'),
      label('Source row index', rowIndexInput), label('Row note', rowTextInput),
      button('Apply row note to draft', () => {
        const rowIndex = Number(rowIndexInput.value);
        if (!/^(0|[1-9][0-9]*)$/.test(rowIndexInput.value) || !Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= edition.rowCount)
          throw new Error('Choose an existing source row index.');
        if (!rowTextInput.value.trim()) noteRows.delete(rowIndex); else noteRows.set(rowIndex, rowTextInput.value);
        rowIndexInput.value = ''; rowTextInput.value = '';
        syncNotesDraft(); drawNotes();
      })),
    savedNotesSlot, element('div', { class: 'actions' }, submit('Save notes')),
    muted('Saved revision ' + note.revision + ' · ' + formatDate(note.updatedAt) + '. Reports include saved notes.'),
  ]);
  try { const restored = JSON.parse(rowNotesInput.value); if (Array.isArray(restored)) { noteRows.clear(); for (const item of restored) noteRows.set(item.rowIndex, item.text); } } catch {}
  drawNotes();
  view.append(card(element('h3', {}, 'Analyst notes'), notesForm));

  const formatSelect = choose('format', [['json', 'JSON · source, records and notes'], ['csv', 'CSV (JSON value cells)'],
    ['geojson', 'GeoJSON · all records and source'], ['html', 'HTML · complete readable report']], 'html');
  const exportGeometry = choose('geometryField', geoChoices, geoFields.length === 1 ? (geoFields[0].id ?? geoFields[0].name) : '');
  view.append(card(element('h3', {}, 'Export this complete edition'),
    form('export:' + edition.id, data => {
      const params = new URLSearchParams({ format: data.get('format') });
      if (data.get('format') === 'geojson' && data.get('geometryField')) params.set('geometryField', data.get('geometryField'));
      return download('editions/' + uri(edition.id) + '/download?' + params, 'opendatasoft-edition.' + data.get('format'));
    }, [
      row(label('Report format', formatSelect, true), label('GeoJSON coordinate field', exportGeometry, true), submit('Download edition')),
      muted('Every export contains all retained rows. CSV preserves each original field as a JSON value inside its cell; JSON, GeoJSON and HTML also carry source and rights information.'),
    ], { readOnly: true })));

  renderFieldSelection(edition);
  const peers = state.editions.filter(item => item.state === 'COMPLETE' && item.id !== edition.id && item.datasetUid === edition.datasetUid);
  if (peers.length) renderComparison(edition, peers);
}
function renderFieldSelection(edition) {
  const rows = edition.suggestions.map(spec => {
    const tr = element('tr', { 'data-field': spec.field },
      element('td', {}, input('selected', '', 'checkbox', { checked: true, 'aria-label': 'Use ' + spec.field })),
      element('td', {}, spec.field, element('div', { class: 'muted' }, spec.providerType ?? '')),
      element('td', {}, input('alias', spec.alias, 'text', { required: true, 'aria-label': 'Alias for ' + spec.field })),
      element('td', {}, choose('type', ['string', 'integer', 'number', 'boolean'], spec.type, { 'aria-label': 'Type for ' + spec.field })),
      element('td', {}, choose('encoding', [['native', 'Native'], ['text', 'Text'], ['json', 'JSON text']], spec.encoding, { 'aria-label': 'Encoding for ' + spec.field })),
      element('td', {}, input('nullable', '', 'checkbox', { checked: spec.nullable, 'aria-label': 'Allow null for ' + spec.field })),
      element('td', {}, spec.nulls + ' null · ' + spec.empty + ' empty · ' + spec.missing + ' missing', detail('Sample values', spec.sample)));
    tr._field = spec.field; return tr;
  });
  view.append(card(element('h3', {}, 'Select the customer product fields'),
    muted('Review each source field, alias and conversion. The selected source stays bound to this exact capture.'),
    form('projection:' + edition.id, (data, node) => {
      const projection = Object.create(null);
      for (const tr of node.querySelectorAll('tbody tr')) {
        if (!tr.querySelector('[name=selected]').checked) continue;
        const alias = tr.querySelector('[name=alias]').value.trim();
        if (!alias || ['__proto__', 'prototype', 'constructor'].includes(alias) || Object.hasOwn(projection, alias))
          throw new Error('Use a distinct, valid alias for each selected field.');
        projection[alias] = { field: tr._field, type: tr.querySelector('[name=type]').value,
          encoding: tr.querySelector('[name=encoding]').value, nullable: tr.querySelector('[name=nullable]').checked };
      }
      if (!Object.keys(projection).length) throw new Error('Select at least one product field.');
      return act('editions/' + uri(edition.id) + '/sources', { expectedCaptureSha256: edition.manifestSha256,
        title: data.get('title'), query: 'dataset', projection }, 'products');
    }, [
      label('Product title', input('title', editionTitle(edition), 'text', { maxlength: 128, required: true })),
      element('div', { class: 'table-wrap field-list' }, element('table', {},
        element('thead', {}, element('tr', {}, ['Use', 'Original field', 'Customer alias', 'Type', 'Conversion', 'Nullable', 'Observed values'].map(value => element('th', { scope: 'col' }, value)))),
        element('tbody', {}, rows))),
      submit('Save reviewed field selection'),
    ])));
}
function renderComparison(edition, peers) {
  const resultSlot = element('div', { 'aria-live': 'polite' });
  const identity = (edition.identityCandidates ?? []).find(value => value.missing === 0 && value.duplicates === 0)?.field;
  const options = (edition.fields ?? []).map(field => [field.id ?? field.name, field.label ?? field.id ?? field.name]);
  view.append(card(element('h3', {}, 'Compare exact saved editions'), form('compare:' + edition.id, async data => {
    const generation = renderGeneration;
    const result = await api('compare?' + new URLSearchParams({ before: data.get('before'), after: edition.id, key: data.get('key') }));
    if (!current(generation, resultSlot)) return;
    let page = 0; const size = 50;
    const output = element('div');
    const render = () => {
      const changes = result.changes ?? [], slice = changes.slice(page * size, (page + 1) * size);
      output.replaceChildren(table(slice.map(change => ({ change: change.kind, identity: change.key, before: change.before, after: change.after }))),
        pagination({ offset: page * size, limit: size, returned: slice.length, total: changes.length,
          next: (page + 1) * size < changes.length ? (page + 1) * size : null }, offset => { page = Math.floor(offset / size); render(); }));
    };
    resultSlot.replaceChildren(element('div', { class: 'stats' }, ['added', 'removed', 'changed', 'unchanged'].map(key =>
      element('div', {}, element('strong', { class: 'stat' }, count(result[key])), element('span', {}, key)))),
      muted('Field declarations ' + (result.fieldsChanged ? 'changed' : 'are unchanged') + '. Comparison key: ' + result.key + '.'),
      output, detail('Compared original editions', { before: result.before, after: result.after, key: result.key }));
    render();
  }, [
    row(label('Earlier saved edition', choose('before', peers.map(item => [item.id, formatDate(item.completedAt) + ' · ' + count(item.rowCount) + ' rows'])), true),
      label('Unique original key', choose('key', options, identity), true), submit('Compare retained editions')),
    muted('The key must identify each row uniquely in both editions. Exact added, removed and changed values remain available in the result.'),
  ], { readOnly: true }), resultSlot));
}


function mutation(text, action, primary = false) {
  return button(text, action, primary, { 'data-operation-button': 'true', disabled: Boolean(state.active) });
}
function schemaChoices(source) {
  return Object.entries(source.projection).map(([alias, spec]) => ({ alias, field: spec.field, type: spec.type, encoding: spec.encoding, nullable: spec.nullable }));
}
async function renderProducts(generation) {
  view.append(heading('Data products'));
  if (!state.sources.length) {
    view.append(card(muted('Choose and save a field mapping from a retained edition to create a data product.'),
      button('Open saved editions', async () => { tab = 'editions'; await renderView(); }, true))); return;
  }
  const currentPublication = state.publications.find(item => item.id === selectedPublication);
  const selected = selectedSource ?? currentPublication?.sourceId ?? state.sources.at(-1).id;
  const sourceSelect = choose('source', state.sources.map(item => [item.id, item.title + ' · ' + formatDate(item.createdAt)]), selected);
  selectedSource = sourceSelect.value;
  sourceSelect.addEventListener('change', () => protect(async () => { selectedSource = sourceSelect.value; await renderView(); }, sourceSelect));
  const source = state.sources.find(item => item.id === selectedSource), columns = Object.keys(source.projection);
  const policyTable = element('div', { class: 'table-wrap' }, element('table', {},
    element('thead', {}, element('tr', {}, ['Field alias', 'Source field', 'Published type', 'Equality filter', 'Range filter', 'Customer sort'].map(value => element('th', { scope: 'col' }, value)))),
    element('tbody', {}, Object.entries(source.projection).map(([alias, spec]) => element('tr', {},
      element('td', {}, alias), element('td', {}, spec.field), element('td', {}, spec.type + ' / ' + spec.encoding),
      ['filter', 'range', 'sort'].map(kind => element('td', {}, input(kind, alias, 'checkbox', { 'aria-label': kind + ' ' + alias }))))))));
  view.append(card(label('Saved field mapping', sourceSelect),
    table(schemaChoices(source), ['alias', 'field', 'type', 'encoding', 'nullable']),
    row(button('Download original source selection', () => download('sources/' + uri(source.id) + '/download', 'opendatasoft-source.json')),
      button('Review source edition', async () => { selectedEdition = source.editionId; tab = 'editions'; await renderView(); })),
    element('h3', {}, 'Prepare a complete dataset candidate'),
    muted('Select the fields customers may filter or sort. Extraction uses the complete saved edition and the order below.'),
    form('publication-policy:' + source.id, data => {
      const defaultLimit = number(data, 'defaultLimit', 1), maxLimit = number(data, 'maxLimit', 1);
      if (defaultLimit > maxLimit) throw new Error('The default page size must fit within the maximum page size.');
      const extraOrder = parse(data, 'additionalOrder', []);
      if (!Array.isArray(extraOrder)) throw new Error('Additional ordering must be a JSON array.');
      const order = [{ column: String(data.get('orderColumn')), direction: String(data.get('direction')) }, ...extraOrder];
      if (order.some(item => !item || !columns.includes(item.column) || !['asc', 'desc'].includes(item.direction)))
        throw new Error('Each order entry must name a selected field alias and an asc or desc direction.');
      if (new Set(order.map(item => item.column)).size !== order.length) throw new Error('Use each field once in the extraction order.');
      return act('sources/' + uri(source.id) + '/publications', {
        filters: data.getAll('filter'), ranges: data.getAll('range'), sorts: data.getAll('sort'),
        defaultLimit, maxLimit, order, maxRows: number(data, 'maxRows', 1),
        maxBytes: number(data, 'maxBytes', 1), timeoutMs: number(data, 'timeoutMs', 1),
      }, 'products');
    }, [
      policyTable,
      row(label('Primary extraction order', choose('orderColumn', columns), true),
        label('Direction', choose('direction', [['asc', 'Ascending'], ['desc', 'Descending']], 'asc')),
        label('Default page size', input('defaultLimit', '50', 'number', { min: 1, required: true })),
        label('Maximum page size', input('maxLimit', '250', 'number', { min: 1, required: true }))),
      element('details', {}, element('summary', {}, 'Extraction order and capacity'),
        label('Additional order entries (JSON array)', textarea('additionalOrder', '[]', 2, { placeholder: '[{"column":"url","direction":"asc"}]' })),
        row(label('Maximum rows', input('maxRows', '250000', 'number', { min: 1, required: true })),
          label('Maximum bytes', input('maxBytes', '67108864', 'number', { min: 1, required: true })),
          label('Timeout in milliseconds', input('timeoutMs', '120000', 'number', { min: 1, required: true })))),
      submit('Prepare dataset candidate'),
    ])));
  if (!state.publications.length) return;
  const selection = choose('publication', state.publications.map(item => [item.id, item.title + ' · ' + item.state + ' · ' + formatDate(item.createdAt)]),
    selectedPublication ?? state.publications.at(-1).id);
  selectedPublication = selection.value;
  selection.addEventListener('change', () => protect(async () => { selectedPublication = selection.value; await renderView(); }, selection));
  view.append(card(label('Prepared dataset edition', selection)));
  const publication = await api('publications/' + uri(selectedPublication));
  if (!current(generation)) return;
  const run = publication.run, candidate = run?.data?.candidate;
  const previewSlot = element('div', { 'aria-live': 'polite' });
  const showPreview = result => {
    if (!result) { previewSlot.replaceChildren(muted('The candidate preview becomes available after extraction.')); return; }
    previewSlot.replaceChildren(
      element('div', { class: 'meta' }, 'Matched rows: ' + count(result.page?.total ?? result.total ?? result.rowCount ?? result.count),
        'Snapshot: ' + (result.snapshot ?? candidate?.dataset?.snapshot ?? 'Unspecified')),
      table(result.rows ?? result.data ?? []), detail('Complete page response', result));
  };
  showPreview(publication.detail?.preview);
  view.append(card(row(element('h3', { class: 'grow' }, publication.title), pill(run?.state ?? publication.state)),
    form('publication-preview:' + publication.id, async data => {
      const version = renderGeneration, result = await api('publications/' + uri(publication.id) + '?' + new URLSearchParams({ query: data.get('query') }));
      if (current(version, previewSlot)) showPreview(result.detail?.preview);
    }, [
      row(label('Customer query parameters', input('query', '', 'text', { placeholder: 'where_country=United%20States&limit=250', maxlength: 8192 }), true), submit('Preview customer query')),
      muted('Use published aliases with the original dataset API, such as where_country=United%20States. The full response below includes its snapshot and page information.'),
    ], { readOnly: true }), previewSlot, detail('Candidate, review and publication history', run),
    detail('Native publication inspection', publication.detail)));
  if (candidate && ['READY', 'REVIEWED'].includes(run.state)) {
    view.append(card(element('h3', {}, 'Review this dataset edition'),
      muted('The recorded review binds this exact candidate, its field mapping and customer query policy.'),
      element('div', { class: 'mono break' }, candidate.candidateDigest),
      form('publication-review:' + publication.id + ':' + candidate.candidateDigest, data => act('publications/' + uri(publication.id) + '/review', {
        expectedCandidateDigest: candidate.candidateDigest, reviewer: String(data.get('reviewer')), note: String(data.get('note')),
      }, 'products'), [
        label('Reviewer', input('reviewer', '', 'text', { required: true, maxlength: 128 })),
        label('Source, field mapping and use review', textarea('note', '', 4, { required: true })),
        submit('Record dataset review'),
      ])));
  }
  if (run?.state === 'REVIEWED') {
    view.append(card(element('h3', {}, 'Publish the reviewed version'),
      muted('Review ' + run.data.review.id + ' · ' + run.data.review.reviewer),
      mutation('Publish dataset version', () => act('publications/' + uri(publication.id) + '/publish', { reviewId: run.data.review.id }, 'products'), true)));
  }
  if (['PUBLICATION_UNKNOWN', 'INTERRUPTED'].includes(run?.state))
    view.append(card(element('h3', {}, 'Resume the retained publication'),
      muted('Recover the existing candidate and publication state before continuing this edition.'),
      mutation('Recover this publication', () => act('publications/' + uri(publication.id) + '/recover', {}, 'products'), true)));
  if (candidate && ['REVIEWED', 'PUBLISHED'].includes(run.state)) {
    view.append(card(element('h3', {}, 'Create a merchant package'),
      muted('The package carries the complete reviewed dataset, its source information and the original seller runtime. Enter the merchant’s public resource address and payment terms.'),
      form('merchant-export:' + publication.id, data => {
        const amount = String(data.get('amount')).trim();
        if (!/^[0-9]+$/.test(amount)) throw new Error('Enter the payment amount as whole base units.');
        return act('publications/' + uri(publication.id) + '/exports', {
          expectedCandidateDigest: candidate.candidateDigest,
          origin: String(data.get('origin')).trim(), path: String(data.get('path')).trim(),
          payment: { scheme: String(data.get('scheme')).trim(), network: String(data.get('network')).trim(),
            asset: String(data.get('asset')).trim(), amount, payTo: String(data.get('payTo')).trim(),
            maxTimeoutSeconds: number(data, 'timeout', 1) },
        }, 'merchant');
      }, [
        row(label('Public merchant origin', input('origin', '', 'url', { required: true, placeholder: 'https://data.example.com' }), true),
          label('Resource path', input('path', '/data', 'text', { required: true }))),
        row(label('Scheme', input('scheme', 'exact', 'text', { required: true })),
          label('Network', input('network', '', 'text', { required: true }), true),
          label('Asset', input('asset', '', 'text', { required: true }), true)),
        row(label('Amount in base units', input('amount', '', 'text', { required: true, inputmode: 'numeric' })),
          label('Merchant pay-to address', input('payTo', '', 'text', { required: true }), true),
          label('Payment timeout (seconds)', input('timeout', '300', 'number', { min: 1, required: true }))),
        submit('Export merchant package'),
      ])));
  }
}


const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
function renderMerchant(generation) {
  view.append(heading('Merchant releases and buyer requests'));
  if (!state.exports.length) {
    view.append(card(muted('Export a reviewed data product to create its complete merchant package.'),
      button('Open data products', async () => { tab = 'products'; await renderView(); }, true))); return;
  }
  const selection = choose('export', state.exports.map(item => [item.id, item.resource + ' · ' + formatDate(item.createdAt)]),
    selectedExport ?? state.exports.at(-1).id);
  selectedExport = selection.value;
  selection.addEventListener('change', () => protect(async () => { selectedExport = selection.value; await renderView(); }, selection));
  const exported = state.exports.find(item => item.id === selectedExport);
  view.append(card(label('Merchant package', selection),
    element('div', { class: 'meta' }, 'Resource: ' + exported.resource, 'Created: ' + formatDate(exported.createdAt)),
    muted(exported.directory), detail('Complete package manifest and release information', exported),
    row(button('Download complete merchant package', () => download('exports/' + uri(exported.id) + '/download', 'opendatasoft-merchant.tar.gz')),
      button('Download receiving guide', () => download('exports/' + uri(exported.id) + '/guide', 'opendatasoft-receiving.md')),
      button('Open receiving and handoff', async () => { tab = 'receiving'; await renderView(); }))));
  const stageForm = form('stage:' + exported.id, data => {
    const port = number(data, 'port', 1);
    if (port > 65535) throw new Error('The seller port must be between 1 and 65535.');
    const facilitator = String(data.get('facilitator') ?? '').trim();
    const runtime = { port };
    if (facilitator) {
      const endpoint = new URL(facilitator);
      const local = endpoint.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
      if (endpoint.username || endpoint.password || endpoint.hash ||
          endpoint.protocol !== 'https:' && !local)
        throw new Error('Enter the configured HTTPS facilitator, or an explicitly enabled local facilitator.');
      if (local && data.get('allowLocalFacilitator') !== 'on')
        throw new Error('Enable the local facilitator option for this loopback address.');
      runtime.facilitator = facilitator;
      if (local) runtime.allowLocalFacilitator = true;
    }
    return act('exports/' + uri(exported.id) + '/stage', {
      expectedManifestSha256: exported.manifestSha256,
      releaseId: String(data.get('releaseId')).trim(), label: String(data.get('label')).trim(),
      runtime,
    }, 'merchant');
  }, [
    row(label('Release ID', input('releaseId', 'opendatasoft-' + exported.id.slice(0, 8), 'text', { required: true }), true),
      label('Release label', input('label', 'Huwise dataset edition', 'text', { required: true }), true),
      label('Seller port', input('port', '8423', 'number', { min: 1, max: 65535, required: true }))),
    label('Payment facilitator URL', input('facilitator', '', 'url', { placeholder: 'https://your-configured-facilitator' })),
    label('Enable the selected local facilitator', input('allowLocalFacilitator', 'on', 'checkbox')),
    muted('Choose the configured facilitator for native payment verification and settlement. An empty facilitator selects the original offer-only deployment.'),
    submit('Stage retained merchant package'),
  ]);
  view.append(card(element('h3', {}, 'Seller release'),
    exported.staged ? element('div', {},
      pill('Staged'), muted(exported.staged.root),
      muted('Open the original release console to inspect, activate and run this staged edition.'),
      pre('node sf82-seller-pilot/release-cli.mjs console --store ' + shellQuote(exported.staged.root) + ' --port 8425'),
      detail('Staged release', exported.staged),
      element('details', {}, element('summary', {}, 'Stage another named release from this package'), stageForm)) :
      element('div', {}, muted('Stage the exact package in this project’s original seller release store.'), stageForm)));
  const offerSlot = element('div', { 'aria-live': 'polite' });
  const cached = offerCache.get(exported.id);
  const sellerInput = input('seller', cached?.request.seller ?? 'http://127.0.0.1:8423', 'url', { required: true });
  const queryInput = input('query', cached?.request.query ?? '', 'text', { maxlength: 8192, placeholder: 'where_country=United%20States&limit=250' });
  const drawOffer = saved => {
    const { request, offer } = saved;
    offerSlot.replaceChildren(
      element('div', { class: 'meta' }, 'Seller mode: ' + offer.mode, 'Snapshot: ' + offer.snapshot),
      element('p', { class: 'mono break' }, offer.url),
      element('h4', {}, 'Current payment alternatives'),
      table(offer.accepts.map((value, index) => ({ index, scheme: value.scheme, network: value.network,
        asset: value.asset, amount: value.amount, payTo: value.payTo, maxTimeoutSeconds: value.maxTimeoutSeconds })),
      ['index', 'scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds']),
      detail('Complete advertised offer and selected dataset', offer),
      form('buyer:' + exported.id + ':' + offer.offerSha256 + ':' + offer.url, data => {
        if (sellerInput.value.trim() !== request.seller || queryInput.value !== request.query)
          throw new Error('Read the live offer for the selected seller address and query before preparing its buyer request.');
        return act('exports/' + uri(exported.id) + '/buyer', {
          ...request, offerSha256: offer.offerSha256, intentId: String(data.get('intentId')).trim(),
          acceptIndex: number(data, 'acceptIndex', 0),
        }, 'merchant');
      }, [
        row(label('Unique buyer intent ID', input('intentId', 'opendatasoft-' + Date.now(), 'text', { required: true }), true),
          label('Payment alternative', choose('acceptIndex', offer.accepts.map((value, index) => [String(index),
            index + ' · ' + value.scheme + ' · ' + value.network + ' · ' + value.amount + ' base units']), '0'), true)),
        muted('Preparation rereads the running seller and binds this exact offer, snapshot, request and intent. The resulting configuration opens in the original buyer operator.'),
        submit('Prepare original buyer request'),
      ]));
    updateBusy();
  };
  const offerForm = form('offer:' + exported.id, async () => {
    const request = { seller: sellerInput.value.trim(), query: queryInput.value };
    const version = renderGeneration;
    const offer = await api('exports/' + uri(exported.id) + '/offer', request, { readOnly: true });
    if (!current(version, offerSlot) || sellerInput.value.trim() !== request.seller || queryInput.value !== request.query) return;
    const saved = { request, offer }; offerCache.set(exported.id, saved); drawOffer(saved);
  }, [
    row(label('Running seller address', sellerInput, true), label('Dataset query parameters', queryInput, true), submit('Read live offer')),
    muted('Use the original seller’s loopback address. Its public resource and exact saved snapshot come from the selected package.'),
  ], { readOnly: true });
  const clearOffer = () => {
    offerCache.delete(exported.id); offerSlot.replaceChildren(muted('Read the live offer for the updated seller and query.'));
  };
  sellerInput.addEventListener('input', clearOffer); queryInput.addEventListener('input', clearOffer);
  view.append(card(element('h3', {}, 'Review the running seller offer'), offerForm, offerSlot));
  if (cached && sellerInput.value.trim() === cached.request.seller && queryInput.value === cached.request.query) drawOffer(cached);
  const requests = state.buyerRequests.filter(item => item.exportId === exported.id);
  if (requests.length) view.append(card(element('h3', {}, 'Retained buyer requests'),
    muted('Continue the existing intent in the original buyer operator. Each configuration retains its offer and snapshot selection.'),
    requests.map(request => element('article', { class: 'entry' },
      row(element('strong', { class: 'grow' }, request.config?.intentId ?? request.id), pill(request.mode ?? 'Prepared')),
      muted(formatDate(request.createdAt)), element('p', { class: 'mono break' }, request.out),
      detail('Original buyer preparation', request),
      button('Download buyer configuration', () => download('buyer-requests/' + uri(request.id) + '/download', 'opendatasoft-buyer.json'))))));
}
function renderReceiving(generation) {
  view.append(heading('Receiving and handoff'),
    card(element('h3', {}, 'Receive an existing complete capture'),
      muted('Import the original capture manifest from this host. Keep its complete capture directory together, including the original export and opening and closing metadata.'),
      form('import-capture', data => act('import', { manifestFile: String(data.get('manifestFile')).trim() }, 'editions'), [
        row(label('Existing capture.json path', input('manifestFile', '', 'text', { required: true,
          placeholder: '/absolute/path/to/capture/capture.json' }), true), submit('Import complete capture')),
      ])));
  const complete = state.editions.filter(item => item.state === 'COMPLETE');
  view.append(card(element('h3', {}, 'Retained research editions'),
    complete.length ? complete.map(edition => element('article', { class: 'entry' },
      row(element('strong', { class: 'grow' }, edition.datasetTitle ?? edition.datasetId), pill(count(edition.rowCount) + ' rows')),
      muted(formatDate(edition.completedAt)), element('div', { class: 'mono break' }, edition.id),
      row(button('Review records and saved notes', async () => { selectedEdition = edition.id; tab = 'editions'; await renderView(); }),
        button('Download complete JSON', () => download('editions/' + uri(edition.id) + '/download?format=json', 'opendatasoft-edition.json')),
        button('Download complete HTML', () => download('editions/' + uri(edition.id) + '/download?format=html', 'opendatasoft-edition.html'))))) :
      muted('Completed and imported captures appear here.')));

  view.append(card(element('h3', {}, 'Transfer a merchant release'),
    muted('Download the complete package and its receiving guide. New exports include the guide in their manifest; the companion download supplies the same instructions and exact selected identities for every retained package.'),
    state.exports.length ? state.exports.map(exported => element('article', { class: 'entry' },
      element('strong', {}, exported.resource), muted(formatDate(exported.createdAt)),
      element('div', { class: 'mono break' }, 'Manifest SHA-256: ' + exported.manifestSha256),
      row(button('Download complete package', () => download('exports/' + uri(exported.id) + '/download', 'opendatasoft-merchant.tar.gz')),
        button('Download receiving guide', () => download('exports/' + uri(exported.id) + '/guide', 'opendatasoft-receiving.md')),
        button('Open release and offer', async () => { selectedExport = exported.id; tab = 'merchant'; await renderView(); })))) :
      muted('Create a package from the reviewed dataset to enable this handoff.')));

  view.append(card(element('h3', {}, 'Continue a prepared buyer intent'),
    muted('Download the existing buyer configuration and follow the original SF88 operator workflow. Inspect, review, collect and recover that retained intent in the same operator workspace. Keep its original operation directory and receiving artifacts together.'),
    state.buyerRequests.length ? state.buyerRequests.map(request => element('article', { class: 'entry' },
      element('strong', {}, request.config?.intentId ?? request.id),
      element('p', { class: 'mono break' }, request.url), muted(formatDate(request.createdAt)),
      detail('Retained buyer request', request),
      button('Download original buyer configuration', () => download('buyer-requests/' + uri(request.id) + '/download', 'opendatasoft-buyer.json')))) :
      muted('Prepare a request from the running seller’s current offer to retain its exact buyer configuration.')));

  view.append(card(element('h3', {}, 'Project continuity'),
    muted('This project retains source editions, notes, field selections, publication history, merchant packages, seller releases and original buyer requests. Close the serving command before opening this project in another CLI process.'),
    element('div', { class: 'mono break' }, state.directory),
    pre('node sf30-seller-sdk/opendatasoft/cli.mjs serve --project ' + shellQuote(state.directory) + ' --port 0'),
    detail('Current project inventory', {
      catalogOrigin: state.catalogOrigin,
      editions: state.editions.map(item => ({ id: item.id, state: item.state, rows: item.rowCount, captureSha256: item.manifestSha256 })),
      sources: state.sources.map(item => ({ id: item.id, editionId: item.editionId, sha256: item.sha256 })),
      publications: state.publications.map(item => ({ id: item.id, sourceId: item.sourceId, state: item.state })),
      packages: state.exports.map(item => ({ id: item.id, publicationId: item.publicationId, manifestSha256: item.manifestSha256 })),
      buyerRequests: state.buyerRequests.map(item => ({ id: item.id, exportId: item.exportId, configSha256: item.configSha256 })),
    })));
}


function accessScreen(error) {
  activeController.abort(); activeController = new AbortController(); renderGeneration++;
  state = null; operation(); $('#project').replaceChildren();
  view.replaceChildren(heading('Open the local project'), card(
    muted('Open the complete loopback link printed by the serving command, or paste that link below.'),
    form('project-access', async data => {
      let value = String(data.get('access')).trim();
      if (/^https?:\/\//i.test(value)) {
        const url = new URL(value);
        if (url.origin !== location.origin || !url.hash) throw new Error('Use the complete link for this local project address.');
        value = url.hash.slice(1);
      }
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(value)) throw new Error('Paste the complete project link printed by the serving command.');
      token = value;
      try { sessionStorage.setItem(storageKey, token); } catch {}
      await refresh();
    }, [
      label('Project link or capability', input('access', '', 'password', { required: true, autocomplete: 'off', spellcheck: 'false' })),
      submit('Open project'),
    ], { readOnly: true })));
  if (error) message(error);
}
for (const node of document.querySelectorAll('nav button')) node.addEventListener('click', () => {
  if (!state || node.dataset.tab === tab) return;
  void protect(async () => { tab = node.dataset.tab; await renderView(); if (!disposed) view.focus({ preventScroll: true }); }, node);
});
$('#refresh-project').addEventListener('click', () => {
  if (!token) { accessScreen(); return; }
  void protect(async () => {
    try { await refresh(); } catch (error) { if (error.status === 401) accessScreen(error); else throw error; }
  }, $('#refresh-project'));
});
window.addEventListener('pagehide', () => { disposed = true; activeController.abort(); });
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  disposed = false; activeController = new AbortController();
  if (token) void protect(() => refresh());
});
if (!token) accessScreen();
else void refresh().catch(error => { if (error.status === 401) accessScreen(error); else message(error); });
