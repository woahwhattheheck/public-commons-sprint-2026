/* MIT. Original ERDDAP source, edition and receiving console. */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty = v => JSON.stringify(v, null, 2);
const clone = v => JSON.parse(JSON.stringify(v));
const list = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
const fmt = v => Number.isFinite(Number(v)) ? Number(v).toLocaleString() : String(v == null ? '—' : v);
const attr = (m, key) => m && m[key] ? m[key].value : '';
const S = {view:'catalog', state:null, meta:null, source:null, build:null, comparison:null, query:null, catalog:null,
  selected:{}, drafts:{}, cache:new Map(), sourceOffset:0, sourceRows:null, nativeRows:null, nativeCursors:[],
  changes:null, changesOffset:0, mapping:null, mappingSource:null, busy:false, storageKey:null, pending:null, review:null};
let token = location.hash.slice(1);
if (token) { sessionStorage.setItem('erddap-capability', token); history.replaceState(null, '', location.pathname); }
else token = sessionStorage.getItem('erddap-capability') || '';
function status(message) { $('#status').textContent = message || ''; }
function fail(error) { $('#error').hidden = false; $('#error').textContent = error && error.message ? error.message : String(error); }
function clearError() { $('#error').hidden = true; $('#error').textContent = ''; }
function saveDrafts() {
  if (!S.storageKey) return;
  try { localStorage.setItem(S.storageKey, JSON.stringify({selected:S.selected,drafts:S.drafts,pending:S.pending,view:S.view})); }
  catch (_) { status('This browser could not save its draft. Keep the original acquisition operation ID before closing.'); }
}
function path(id) { return encodeURIComponent(id); }
async function api(route, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization','Bearer ' + token);
  let body = options.body;
  if (body !== undefined && !(body instanceof Blob)) { headers.set('Content-Type','application/json'); body = JSON.stringify(body); }
  const response = await fetch('/api/' + route,{method:options.method || (body === undefined ? 'GET' : 'POST'),headers,body,cache:'no-store'});
  let value;
  try { value = await response.json(); } catch (_) { throw new Error('The local server returned an incomplete response. Reopen the saved operation before continuing.'); }
  if (!response.ok) {
    let message = value.error || ('Local request failed (' + response.status + ')');
    if (value.providerStatus) message += '\nProvider response: ' + value.providerStatus;
    if (value.retryAfter) message += '\nRetry after: ' + value.retryAfter + '. Continue the same saved acquisition.';
    const error = new Error(message); error.status = response.status; error.result = value; throw error;
  }
  return value;
}
async function cached(route) {
  if (!S.cache.has(route)) S.cache.set(route,await api(route));
  return S.cache.get(route);
}
async function busy(label, action) {
  if (S.busy) return;
  S.busy = true; clearError(); status(label);
  $$('button').forEach(b => { b.dataset.wasDisabled = b.disabled ? '1' : '0'; b.disabled = true; });
  try { await action(); }
  catch (error) { fail(error); status('The saved source and completed operations remain available.'); }
  finally { S.busy = false; $$('button').forEach(b => { b.disabled = b.dataset.wasDisabled === '1'; delete b.dataset.wasDisabled; }); }
}
function field(id, label, value = '', extra = '') {
  return '<label class="field"><span>' + esc(label) + '</span><input id="' + esc(id) + '" value="' + esc(value) + '" ' + extra + '></label>';
}
function select(id, label, options, value, extra = '') {
  return '<label class="field"><span>' + esc(label) + '</span><select id="' + esc(id) + '" ' + extra + '>' +
    options.map(o => { const pair = Array.isArray(o) ? o : [o,o]; return '<option value="' + esc(pair[0]) + '"' +
      (String(pair[0]) === String(value) ? ' selected' : '') + '>' + esc(pair[1]) + '</option>'; }).join('') + '</select></label>';
}
function detail(title, value, open = false) {
  return '<details' + (open ? ' open' : '') + '><summary>' + esc(title) + '</summary><pre>' + esc(typeof value === 'string' ? value : pretty(value)) + '</pre></details>';
}
function empty(title, message) { return '<div class="empty-state"><h3>' + esc(title) + '</h3><p>' + esc(message) + '</p></div>'; }
function metric(label, value) { return '<div class="metric"><strong>' + esc(fmt(value)) + '</strong><span>' + esc(label) + '</span></div>'; }
function scalar(value) {
  if (value === null) return '<span class="missing">Missing</span>';
  if (value === '') return '<span class="empty">Empty string</span>';
  return esc(typeof value === 'object' ? JSON.stringify(value) : value);
}
function table(headers, rows) {
  if (!rows.length) return empty('No rows in this page','The complete source and query conditions remain available.');
  return '<div class="table-scroll"><table><thead><tr>' + headers.map(h => '<th>' + esc(h) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(v => '<td>' + scalar(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}
function fact(label, value) { return '<dt>' + esc(label) + '</dt><dd>' + scalar(value) + '</dd>'; }
function titleOf(item) { return item.label || item.name || (item.query && item.query.label) || item.datasetId || item.id.slice(0,12); }
function reviewed(title, html, actionLabel, action) {
  S.review = action;
  $('#review-title').textContent = title; $('#review-body').innerHTML = html;
  $('#review-actions').innerHTML = '<button type="button" data-action="close-review">Back to editing</button>' +
    (action ? '<button type="button" class="primary" data-action="confirm-review">' + esc(actionLabel) + '</button>' : '');
  $('#review-dialog').showModal();
}
async function refresh(initial = false) {
  S.state = await api('state');
  if (initial) {
    S.storageKey = 'erddap:' + S.state.workspace.id + ':operator-v1';
    try {
      const saved = JSON.parse(localStorage.getItem(S.storageKey) || 'null');
      if (saved) { S.selected = saved.selected || {}; S.drafts = saved.drafts || {}; S.pending = saved.pending || null; S.view = saved.view || 'catalog'; }
    } catch (_) {}
  }
  const exists = (name,id) => (S.state[name] || []).some(x => x.id === id);
  if (S.selected.source && !exists('sources',S.selected.source)) delete S.selected.source;
  if (S.selected.build && !exists('builds',S.selected.build)) delete S.selected.build;
  if (S.selected.meta && !exists('metadata',S.selected.meta)) delete S.selected.meta;
  if (!S.selected.source && S.state.sources.length) S.selected.source = S.state.sources[0].id;
  if (!S.selected.build && S.state.builds.length) S.selected.build = S.state.builds[0].id;
  if (S.selected.source) S.source = await cached('sources/' + path(S.selected.source));
  if (S.selected.build) S.build = await cached('builds/' + path(S.selected.build));
  if (S.selected.meta) S.meta = await cached('metadata/' + path(S.selected.meta));
  if (S.selected.query) {
    try { S.query = await cached('queries/' + path(S.selected.query)); } catch (_) { delete S.selected.query; }
  }
  $('#workspace-name').textContent = S.state.workspace.name;
  $('#workspace-counts').textContent = fmt(S.state.sources.length) + ' sources · ' + fmt(S.state.builds.length) + ' editions';
  $('#source-count').textContent = S.state.sources.length; $('#edition-count').textContent = S.state.builds.length;
  saveDrafts(); render();
}
function render() {
  $$('nav [data-view]').forEach(b => b.setAttribute('aria-current',b.dataset.view === S.view ? 'page' : 'false'));
  const views = {catalog:renderCatalog,sources:renderSources,editions:renderEditions,compare:renderCompare,receive:renderReceive};
  $('#main').innerHTML = (views[S.view] || renderCatalog)();
}
function pendingPanel() {
  const operations = (S.state.operations || []).filter(op => op.status !== 'complete');
  const known = new Map(operations.map(op => [op.id,op]));
  if (S.pending && !known.has(S.pending.operationId)) known.set(S.pending.operationId,{id:S.pending.operationId,queryId:S.pending.queryId,status:'response pending'});
  if (!known.size) return '';
  return '<section class="panel"><h3>Saved acquisitions</h3><p class="muted">Continue an interrupted request with its original operation identity. Completed responses are retained.</p>' +
    Array.from(known.values()).map(op => '<div class="notice"><strong>' + esc(op.status) + '</strong> · <code>' + esc(op.id) +
      '</code>' + (op.lastError ? '<p>' + esc(op.lastError.message) + '</p>' : '') +
      '<div class="actions"><button data-action="inspect-operation" data-id="' + esc(op.id) + '">Inspect operation</button>' +
      '<button data-action="continue-operation" data-id="' + esc(op.id) + '">Continue same acquisition</button></div></div>').join('') + '</section>';
}
function renderCatalog() {
  const d = S.drafts.catalog || {server:'https://coastwatch.pfeg.noaa.gov/erddap',text:'',datasetId:'',protocol:'griddap'};
  let html = pendingPanel() + '<section class="panel"><div class="panel-head"><div><h2>Find and select a dataset</h2><p class="muted">Read the provider catalogue or open an exact ERDDAP route.</p></div></div>' +
    '<div class="form-grid">' + field('provider-server','ERDDAP server URL',d.server,'type="url"') +
    field('catalog-text','Catalogue search',d.text) + '</div><div class="actions"><button data-action="search">Search catalogue</button></div>' +
    '<details' + (!S.catalog ? ' open' : '') + '><summary>Open a dataset directly</summary><div class="row">' +
    field('dataset-id','Dataset route ID',d.datasetId) + select('dataset-protocol','Protocol',['griddap','tabledap'],d.protocol) +
    '<button data-action="load-metadata" class="primary">Read dataset metadata</button></div></details></section>';
  if (S.catalog) {
    const t = S.catalog.table, did = t.columnNames.findIndex(n => n.toLowerCase() === 'dataset id');
    const proto = t.columnNames.findIndex(n => n.toLowerCase() === 'griddap');
    html += '<section class="panel"><h3>Provider catalogue</h3><p class="muted">Page ' + esc(S.catalog.page) + ' · ' + esc(S.catalog.server) + '</p>' +
      '<div class="table-scroll"><table><thead><tr><th>Open</th>' + t.columnNames.map(n => '<th>' + esc(n) + '</th>').join('') + '</tr></thead><tbody>' +
      t.rows.map(row => '<tr><td>' + (did >= 0 ? '<button data-action="catalog-open" data-id="' + esc(row[did]) + '" data-protocol="' +
        (proto >= 0 && row[proto] ? 'griddap' : 'tabledap') + '">Read metadata</button>' : '') + '</td>' +
        row.map(v => '<td class="wrap">' + scalar(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' +
      '<div class="pagination"><span>' + fmt(t.rows.length) + ' returned rows</span><div class="actions">' +
      (S.catalog.page > 1 ? '<button data-action="catalog-page" data-page="' + (S.catalog.page - 1) + '">Previous page</button>' : '') +
      (S.catalog.nextPage ? '<button data-action="catalog-page" data-page="' + S.catalog.nextPage + '">Next page</button>' : '') + '</div></div></section>';
  }
  if ((S.state.metadata || []).length) html += '<section class="panel"><h3>Retained metadata</h3><div class="row">' +
    select('retained-metadata','Dataset metadata',S.state.metadata.map(x => [x.id,x.datasetId + ' · ' + x.protocol]),S.selected.meta || '') +
    '<button data-action="open-metadata">Open saved metadata</button></div></section>';
  if (S.meta) html += renderMetadata();
  if (S.query) html += renderQuery();
  if ((S.state.queries || []).length) html += '<section class="panel"><h3>Saved query selections</h3><div class="row">' +
    select('retained-query','Saved query',S.state.queries.map(x => [x.id,x.query.label || x.query.datasetId]),S.selected.query || '') +
    '<button data-action="open-query">Open saved query</button></div></section>';
  return html;
}
function selectedDraft() {
  const key = 'selection:' + S.meta.id;
  if (!S.drafts[key]) S.drafts[key] = {variables:[],axes:[],constraints:[],orderBy:[],label:S.meta.metadata.title || S.meta.datasetId,maxBytes:67108864};
  return S.drafts[key];
}
function axesFor(variables) {
  const entries = S.meta.metadata.variables || [];
  const first = entries.find(x => variables.includes(x.name));
  return first ? first.dimensions || [] : [];
}
function renderMetadata() {
  const item = S.meta, m = item.metadata, d = selectedDraft();
  const vars = m.variables || [];
  let html = '<section class="panel"><h2>' + esc(m.title || item.datasetId) + '</h2><dl class="fact-list">' +
    fact('Dataset route',item.datasetId) + fact('Publisher ID',m.publisherId || attr(m.globalAttributes,'id') || '—') +
    fact('Protocol',item.protocol) + fact('Server',item.server) + '</dl>' +
    detail('License and original dataset attributes',m.globalAttributes) +
    '<h3>Variables</h3><p class="muted">Select exact provider variables. All returned coordinate, quality and missing values remain in the source.</p>' +
    '<div class="variables">' + vars.map(v => '<label class="check"><input type="checkbox" data-variable="' + esc(v.name) + '"' +
      (d.variables.includes(v.name) ? ' checked' : '') + '><span><strong>' + esc(v.name) + '</strong><span class="variable-note">' +
      esc(v.type) + (attr(v.attributes,'units') ? ' · ' + esc(attr(v.attributes,'units')) : '') + '</span></span></label>').join('') + '</div>' +
    detail('Original variable declarations and quality attributes',vars);
  if (item.protocol === 'griddap') {
    const axes = axesFor(d.variables);
    html += '<h3>Axis selection</h3><p class="hint">Start and stop follow the provider’s original axis index order. Value bounds may descend on descending axes. Index mode uses ascending zero-based indexes. Stride is always positive.</p>';
    if (!axes.length) html += '<p class="muted">Select a variable to expose its original DDS dimensions.</p>';
    html += axes.map((a,i) => {
      const saved = d.axes.find(x => x.name === a.name) || {name:a.name,mode:'value',start:'',stop:'',stride:1};
      const dim = (m.dimensions || []).find(x => x.name === a.name) || {};
      return '<div class="axis-row" data-axis="' + esc(a.name) + '">' +
        '<div class="field"><span>' + esc(a.name) + '</span><span class="hint">' + fmt(a.size) + ' positions' +
        (attr(dim.attributes,'units') ? ' · ' + esc(attr(dim.attributes,'units')) : '') + '</span></div>' +
        select('axis-mode-' + i,'Bounds',['value','index'],saved.mode,'data-axis-field="mode"') +
        field('axis-start-' + i,'Start in original order',saved.start,'data-axis-field="start" required') +
        field('axis-stop-' + i,'Stop in original order',saved.stop,'data-axis-field="stop" required') +
        field('axis-stride-' + i,'Stride',saved.stride,'type="number" min="1" step="1" data-axis-field="stride" required') + '</div>';
    }).join('');
  } else {
    html += '<h3>Row constraints</h3><p class="hint">Every condition is sent explicitly. The workbench adds no hidden row limit or quality filter.</p>' +
      d.constraints.map((c,i) => '<div class="constraint-row" data-constraint="' + i + '">' +
        select('constraint-variable-' + i,'Variable',vars.map(v => v.name),c.variable,'data-constraint-field="variable"') +
        select('constraint-op-' + i,'Operator',['=','!=','<','<=','>','>=','=~'],c.operator,'data-constraint-field="operator"') +
        select('constraint-kind-' + i,'Value kind',['string','number','time'],c.kind,'data-constraint-field="kind"') +
        field('constraint-value-' + i,'Exact value',c.value,'data-constraint-field="value"') +
        '<button data-action="remove-constraint" data-index="' + i + '">Remove</button></div>').join('') +
      '<div class="actions"><button data-action="add-constraint">Add constraint</button></div>' +
      field('query-order','Order by selected variables, comma separated',(d.orderBy || []).join(', '));
  }
  html += '<div class="actions">' + (['jplMURSST41','cwwcNDBCMet'].includes(item.datasetId) ? '<button data-action="example-selection">Use documented June 2025 selection</button>' : '') +
    '</div><div class="form-grid">' + field('query-label','Selection label',d.label) +
    field('query-max','Maximum bytes per original response',d.maxBytes,'type="number" min="1024" max="268435456" step="1"') +
    '</div><div class="actions"><button data-action="save-query" class="primary">Review and save query</button></div></section>';
  return html;
}
function collectSelection() {
  if (!S.meta || !$('#query-label')) return;
  const d = selectedDraft();
  d.variables = $$('[data-variable]:checked').map(e => e.dataset.variable);
  if (S.meta.protocol === 'griddap') d.axes = $$('[data-axis]').map(row => ({name:row.dataset.axis,
    mode:$('[data-axis-field="mode"]',row).value,start:$('[data-axis-field="start"]',row).value,
    stop:$('[data-axis-field="stop"]',row).value,stride:Number($('[data-axis-field="stride"]',row).value)}));
  else {
    d.constraints = $$('[data-constraint]').map(row => ({variable:$('[data-constraint-field="variable"]',row).value,
      operator:$('[data-constraint-field="operator"]',row).value,kind:$('[data-constraint-field="kind"]',row).value,
      value:$('[data-constraint-field="value"]',row).value}));
    d.orderBy = list($('#query-order').value);
  }
  d.label = $('#query-label').value; d.maxBytes = Number($('#query-max').value); saveDrafts();
}
function renderQuery() {
  const q = S.query;
  return '<section class="panel" id="saved-query"><div class="panel-head"><div><h2>Saved request</h2><p>' + esc(q.query.label || q.query.datasetId) + '</p></div><span class="tag">' + esc(q.query.protocol) + '</span></div>' +
    '<p>Review the exact decoded request before acquiring its complete source responses.</p><pre>' + esc(q.decodedQuery) + '</pre>' +
    detail('Original request URLs',q.urls) + detail('Retained query and response budget',q.query) +
    '<div class="actions"><button data-action="acquire" class="primary">Acquire complete selection</button></div></section>';
}

function renderSources() {
  let html = '<section class="panel"><div class="panel-head"><div><h2>Original source responses</h2><p class="muted">Import a complete ERDDAP capture or reopen a retained acquisition.</p></div></div>' +
    '<div class="row"><label class="field"><span>Complete source ZIP</span><input id="source-file" type="file" accept=".zip"></label>' +
    field('source-label','Source label','') + '<button data-action="import-source" class="primary">Import source</button></div></section>';
  if (!S.state.sources.length) return html + '<section class="panel">' + empty('No source has been retained','Acquire a selection in Catalogue, or import the complete source ZIP above.') + '</section>';
  html += '<div class="grid"><aside class="panel"><h3>Saved sources</h3><div class="stack">' +
    S.state.sources.map(x => '<button class="list-button" data-action="select-source" data-id="' + esc(x.id) + '" aria-current="' +
      (S.selected.source === x.id) + '"><strong>' + esc(titleOf(x)) + '</strong><small>' + fmt(x.bytes) + ' bytes · ' +
      esc(new Date(x.created * 1000).toLocaleString()) + '</small></button>').join('') + '</div></aside><section class="panel">';
  if (!S.source) return html + empty('Select a source','The original response inventory will appear here.') + '</section></div>';
  const v = S.source.inventory, meta = v.metadata || {};
  html += '<h2>' + esc(S.source.label) + '</h2><div class="metrics">' + metric('Rows',v.rowCount) + metric('Fields',(v.columns || []).length) +
    metric('Original bytes',S.source.bytes) + '</div><dl class="fact-list">' +
    fact('Dataset route',v.datasetId) + fact('Publisher ID',meta.publisherId || attr(meta.globalAttributes,'id') || '—') +
    fact('Protocol',v.protocol) + fact('Coverage',v.completeness) + fact('JSON / CSV',v.csvComparison && v.csvComparison.status) + '</dl>' +
    detail('Original selection and exact response URLs',{selection:v.selection,query:v.query,files:v.files}) +
    detail('License, dataset and quality attributes',meta) + detail('JSON / CSV comparison',v.csvComparison);
  if (v.csvComparison && v.csvComparison.status !== 'equivalent') html += '<div class="notice">The original JSON and CSV responses differ. Inspect both originals before choosing an explicit projection policy.</div>';
  html += '<h3>Exact source rows</h3><p class="hint">Numeric source tokens remain strings. Missing and empty-string values are shown separately.</p>' +
    (S.sourceRows ? table(S.sourceRows.columns.map(c => c.name + (c.units ? ' [' + c.units + ']' : '')),S.sourceRows.rows) :
      '<div class="actions"><button data-action="source-rows">Read source rows</button></div>');
  if (S.sourceRows) html += '<div class="pagination"><span>' + fmt(S.sourceRows.offset + (S.sourceRows.rows.length ? 1 : 0)) + '–' +
    fmt(S.sourceRows.offset + S.sourceRows.rows.length) + ' of ' + fmt(S.sourceRows.rowCount) + '</span><div class="actions">' +
    (S.sourceOffset ? '<button data-action="source-page" data-offset="' + Math.max(0,S.sourceOffset - 100) + '">Previous rows</button>' : '') +
    (S.sourceRows.nextOffset != null ? '<button data-action="source-page" data-offset="' + S.sourceRows.nextOffset + '">Next rows</button>' : '') + '</div></div>';
  html += detail('Field types, units, missing values and ranges',v.columns) + '<details><summary>Download exact original responses</summary><div class="actions">' +
    ['metadata.json','dataset.dds','dataset.das','data.json','data.csv','manifest.json'].map(n => '<button data-action="source-file" data-name="' + n + '">' + n + '</button>').join('') +
    '</div></details></section></div><section class="panel"><h2>Native dataset mapping</h2><p class="muted">Preserve exact source tokens by default. Review any type conversion and choose explicit edition keys.</p>' +
    '<div class="row"><button data-action="default-mapping">Propose mapping from this source</button>' +
    (S.state.plans.length ? select('mapping-from','Use a saved mapping',S.state.plans.map(x => [x.id,x.name]),S.selected.plan || '') +
      '<button data-action="load-mapping">Load saved mapping</button>' : '') + '</div>';
  const draft = S.drafts['mapping:' + S.source.id];
  if (!S.mapping && draft) { try { S.mapping = JSON.parse(draft); S.mappingSource = S.source.id; } catch (_) {} }
  if (S.mapping && S.mappingSource === S.source.id) html += renderMapping();
  html += '</section>';
  return html;
}
function renderMapping() {
  const p = S.mapping;
  return '<div id="mapping-editor"><div class="form-grid">' + field('mapping-name','Dataset name',p.name,'data-map-key="name"') +
    select('mapping-csv','Original JSON / CSV policy',[['require-equivalent','Require equivalent responses'],['canonical-json','Explicitly use original JSON']],p.csvPolicy,'data-map-key="csvPolicy"') +
    '</div><div class="table-scroll"><table><thead><tr><th>Provider field</th><th>Original type / units</th><th>Native name</th><th>Native type</th><th>Nullable</th><th>Cell encoding</th></tr></thead><tbody>' +
    p.columns.map((c,i) => '<tr data-column="' + i + '"><td>' + esc(c.source) + '</td><td>' + esc(c.sourceType) + '<br>' + esc(c.units || '—') +
      '</td><td><input aria-label="Native name for ' + esc(c.source) + '" data-column-key="name" value="' + esc(c.name) + '"></td>' +
      '<td><select aria-label="Native type for ' + esc(c.source) + '" data-column-key="type">' +
      ['string','integer','number','boolean'].map(t => '<option' + (t === c.type ? ' selected' : '') + '>' + t + '</option>').join('') +
      '</select></td><td><input type="checkbox" aria-label="Nullable ' + esc(c.source) + '" data-column-key="nullable"' + (c.nullable ? ' checked' : '') +
      '></td><td><select aria-label="Cell encoding for ' + esc(c.source) + '" data-column-key="encoding">' +
      ['plain','json'].map(t => '<option' + (t === c.encoding ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></td></tr>').join('') +
    '</tbody></table></div><p class="hint">Native number conversion uses the original dataset parser. JSON-cell encoding distinguishes a nullable source string from an empty source string.</p>' +
    '<div class="form-grid">' + field('mapping-keys','Unique edition keys, comma separated',(p.keys || []).join(', '),'data-map-key="keys"') +
    field('mapping-filters','Equality filters, comma separated',(p.filters || []).join(', '),'data-map-key="filters"') +
    field('mapping-ranges','Range filters, comma separated',(p.ranges || []).join(', '),'data-map-key="ranges"') +
    field('mapping-sorts','Sortable columns, comma separated',(p.sorts || []).join(', '),'data-map-key="sorts"') +
    field('mapping-default','Default page rows',p.defaultLimit,'type="number" min="1" step="1" data-map-key="defaultLimit"') +
    field('mapping-limit','Maximum page rows',p.maxLimit,'type="number" min="1" step="1" data-map-key="maxLimit"') +
    field('mapping-maxrows','Complete response row budget',p.maxRows,'type="number" min="1" step="1" data-map-key="maxRows"') +
    field('mapping-maxbytes','Native source byte budget',p.maxBytes,'type="number" min="1" step="1" data-map-key="maxBytes"') +
    '</div><details><summary>Complete mapping JSON</summary><p class="hint">All original mapping fields are retained. Apply JSON edits to update the field editor.</p>' +
    '<textarea id="mapping-json" class="code" rows="18" spellcheck="false">' + esc(S.drafts['mapping:' + S.source.id] || pretty(p)) +
    '</textarea><div class="actions"><button data-action="apply-mapping-json">Apply JSON edits</button></div></details>' +
    '<div class="actions"><button data-action="review-mapping" class="primary">Review and build edition</button></div></div>';
}
function captureMapping() {
  if (!S.mapping || !$('#mapping-editor')) return;
  const p = clone(S.mapping);
  $$('[data-map-key]').forEach(el => {
    const k = el.dataset.mapKey;
    p[k] = ['keys','filters','ranges','sorts'].includes(k) ? list(el.value) :
      ['defaultLimit','maxLimit','maxRows','maxBytes'].includes(k) ? Number(el.value) : el.value;
  });
  $$('[data-column]').forEach(row => $$('[data-column-key]',row).forEach(el => {
    p.columns[Number(row.dataset.column)][el.dataset.columnKey] = el.type === 'checkbox' ? el.checked : el.value;
  }));
  S.mapping = p; S.drafts['mapping:' + S.source.id] = pretty(p);
  if ($('#mapping-json')) $('#mapping-json').value = pretty(p);
  saveDrafts();
}
function buildName(b) {
  return b.native && b.native.name || (S.state.plans.find(p => p.id === b.plan) || {}).name || 'Saved dataset';
}
function renderEditions() {
  if (!S.state.builds.length) return '<section class="panel"><h2>Dataset editions</h2>' +
    empty('No edition has been built','Open a source, review its mapping and build the complete native dataset.') + '</section>';
  const b = S.build;
  let html = '<div class="grid"><aside class="panel"><h3>Saved editions</h3><div class="stack">' +
    S.state.builds.map(x => '<button class="list-button" data-action="select-build" data-id="' + esc(x.id) + '" aria-current="' +
      (S.selected.build === x.id) + '"><strong>' + esc(buildName(x)) + '</strong><small>' + fmt(x.rowCount) + ' rows · ' + esc(x.id.slice(0,12)) +
      '</small></button>').join('') + '</div></aside><section class="panel">';
  if (!b) return html + empty('Select an edition','The original native query will run against its immutable snapshot.') + '</section></div>';
  const queryText = S.drafts['native-query:' + b.id] || 'limit=25';
  html += '<h2>' + esc(buildName(b)) + '</h2><div class="metrics">' + metric('Rows',b.rowCount) +
    metric('Columns',(b.native.columns || b.columns || []).length) + metric('Edition keys',(b.keys || []).length) + '</div>' +
    '<p class="muted">Query the complete original native dataset. Each cursor remains bound to this saved snapshot.</p>' +
    '<label class="field"><span>Native query parameters</span><textarea id="native-query" rows="3" class="code" spellcheck="false">' +
    esc(queryText) + '</textarea><span class="hint">Use fields, limit, sort and declared where_ / min_ / max_ filters. Encode values as URL query parameters. The original engine validates each parameter.</span></label>' +
    '<div class="actions"><button data-action="native-query" class="primary">Run native query</button></div>' +
    detail('Available native columns and query settings',b.native.columns || b.native);
  if (S.nativeRows) {
    const r = S.nativeRows.response, body = r.body || {};
    html += '<div id="native-result"><h3>Query result</h3>';
    if (r.status !== 200) html += '<div class="notice">Native response ' + esc(r.status) + '</div>' + detail('Native response',body,true);
    else {
      html += table(body.fields || [],(body.rows || []).map(row => (body.fields || []).map(f => row[f])));
      const page = body.page || {};
      html += '<div class="pagination"><span>' + fmt((body.rows || []).length) + ' returned rows' +
        (page.total != null ? ' · ' + fmt(page.total) + ' matching rows' : '') + '</span><div class="actions">' +
        (S.nativeCursors.length ? '<button data-action="native-previous">Previous page</button>' : '') +
        (page.nextCursor ? '<button data-action="native-next">Next page</button>' : '') + '</div></div>';
    }
    html += '</div>';
  }
  html += '<div class="actions"><button data-action="export-packet" class="primary">Export complete project</button>' +
    '<button data-action="export-dataset">Export seller dataset</button><button data-action="edition-source">Open original source</button>' +
    '<button data-action="edition-mapping">Inspect saved mapping</button></div>' +
    detail('Edition source, immutable snapshot and file identities',b) + '</section></div>';
  return html;
}
function renderCompare() {
  const options = S.state.builds.map(b => [b.id,buildName(b) + ' · ' + fmt(b.rowCount) + ' rows · ' + b.id.slice(0,12)]);
  if (!options.length) return '<section class="panel"><h2>Compare editions</h2>' + empty('Build an edition first','Comparisons join original edition keys with the same saved mapping.') + '</section>';
  let html = '<section class="panel"><h2>Compare retained editions</h2><p class="muted">The original comparison uses the same reviewed mapping and explicit unique keys. Every added, removed and changed row is retained.</p>' +
    '<div class="form-grid">' + select('compare-before','Before edition',options,S.selected.before || options[0][0]) +
    select('compare-after','After edition',options,S.selected.after || options[0][0]) + '</div><div class="actions">' +
    '<button data-action="compare" class="primary">Compare editions</button></div></section>';
  if (S.comparison) {
    const c = S.comparison;
    html += '<section class="panel"><h3>Row changes</h3><div class="metrics">' +
      ['added','removed','changed','unchanged'].map(k => metric(k,c.counts[k])).join('') + '</div>';
    if (S.changes) html += '<div class="table-scroll"><table><thead><tr><th>Change</th><th>Original key</th><th>Fields</th><th>Before</th><th>After</th></tr></thead><tbody>' +
      S.changes.rows.map(r => '<tr><td>' + esc(r.kind) + '</td><td>' + esc(pretty(r.key)) + '</td><td>' + esc((r.fields || []).join(', ')) +
        '</td><td class="wrap"><pre>' + esc(pretty(r.before)) + '</pre></td><td class="wrap"><pre>' + esc(pretty(r.after)) + '</pre></td></tr>').join('') +
      '</tbody></table></div>' + (!S.changes.rows.length ? '<p class="muted">There are no added, removed or changed rows in this comparison.</p>' : '') +
      '<div class="pagination"><span>Change offset ' + fmt(S.changesOffset) + '</span><div class="actions">' +
      (S.changesOffset ? '<button data-action="changes-page" data-offset="' + Math.max(0,S.changesOffset - 50) + '">Previous changes</button>' : '') +
      (S.changes.nextOffset != null ? '<button data-action="changes-page" data-offset="' + S.changes.nextOffset + '">Next changes</button>' : '') + '</div></div>';
    html += detail('Original comparison identity and semantics',c) + '</section>';
  }
  if (S.state.comparisons.length) html += '<section class="panel"><h3>Saved comparisons</h3><div class="stack">' +
    S.state.comparisons.map(c => '<button class="list-button" data-action="open-comparison" data-id="' + esc(c.id) + '"><strong>' +
      fmt(c.counts.changed) + ' changed · ' + fmt(c.counts.added) + ' added · ' + fmt(c.counts.removed) + ' removed</strong><small>' +
      esc(c.before.slice(0,12)) + ' → ' + esc(c.after.slice(0,12)) + '</small></button>').join('') + '</div></section>';
  return html;
}
function renderReceive() {
  const receipt = S.drafts.received;
  return '<section class="panel"><h2>Receive a complete data project</h2><p>The project carries its original source responses, reviewed mapping and native dataset. Receiving reconstructs the edition from those sources and checks its CSV, schema and snapshot.</p>' +
    '<p class="muted">Open this screen in a separately created workspace to prepare an independent customer copy.</p>' +
    '<div class="row"><label class="field"><span>Complete project ZIP</span><input id="packet-file" type="file" accept=".zip"></label>' +
    '<button data-action="import-packet" class="primary">Import and reconstruct</button></div>' +
    (receipt ? '<div class="notice" id="receiving-result"><strong>Original project reconstructed</strong><p>' + fmt(receipt.build.rowCount) + ' rows · ' +
      esc(receipt.build.native.name || 'Saved dataset') + '</p><div class="actions"><button data-action="received-edition" class="primary">Inspect received edition</button></div></div>' +
      detail('Receiving source, mapping and native snapshot',receipt) : '') + '</section>' +
    '<section class="panel"><h3>Use the received edition</h3><p>Inspect its exact source values, run the original dataset query, compare another retained edition or export the complete project again. Seller terms and purchases use the original merchant and customer commands documented with this product.</p></section>';
}

function captureInputs(eventTarget) {
  if ($('#provider-server')) S.drafts.catalog = {server:$('#provider-server').value,text:$('#catalog-text').value,
    datasetId:$('#dataset-id').value,protocol:$('#dataset-protocol').value};
  if ($('#query-label')) collectSelection();
  if ($('#native-query') && S.build) S.drafts['native-query:' + S.build.id] = $('#native-query').value;
  if (eventTarget && eventTarget.id === 'mapping-json' && S.source) S.drafts['mapping:' + S.source.id] = eventTarget.value;
  else if (eventTarget && eventTarget.closest('#mapping-editor')) captureMapping();
  if ($('#compare-before')) { S.selected.before = $('#compare-before').value; S.selected.after = $('#compare-after').value; }
  saveDrafts();
}
async function openSource(id, rows = true) {
  S.selected.source = id; S.source = await cached('sources/' + path(id)); S.sourceOffset = 0; S.sourceRows = null;
  S.mapping = null; S.mappingSource = null; S.view = 'sources'; saveDrafts();
  if (rows) S.sourceRows = await api('sources/' + path(id) + '/rows?limit=100');
  render();
}
async function openBuild(id, query = true) {
  S.selected.build = id; S.build = await cached('builds/' + path(id)); S.nativeRows = null; S.nativeCursors = [];
  S.nativeCurrentCursor = null; S.view = 'editions'; saveDrafts();
  if (query) await runQuery(null,false); else render();
}
function queryParams(text) {
  const q = new URLSearchParams(text.trim().replace(/^\?/,'')), found = new Set();
  for (const [key] of q) {
    if (found.has(key)) throw new Error('Use each native query parameter once: ' + key);
    found.add(key);
  }
  if (found.has('cursor')) throw new Error('Use the result page controls for its retained cursor. Remove cursor from the query editor.');
  return q;
}
async function runQuery(cursor = null, retainPrevious = false) {
  const text = S.drafts['native-query:' + S.build.id] || 'limit=25';
  const q = queryParams(text);
  if (cursor) q.set('cursor',cursor);
  const result = await api('builds/' + path(S.build.id) + '/query?' + q.toString());
  if (retainPrevious) S.nativeCursors.push(S.nativeCurrentCursor || null);
  S.nativeCurrentCursor = cursor; S.nativeRows = result; render();
  status('Original native query returned ' + result.response.status + '.');
}
async function sourcePage(offset) {
  S.sourceRows = await api('sources/' + path(S.source.id) + '/rows?offset=' + offset + '&limit=100');
  S.sourceOffset = offset; render();
}
async function changesPage(offset) {
  S.changes = await api('comparisons/' + path(S.comparison.id) + '/changes?offset=' + offset + '&limit=50');
  S.changesOffset = offset; render();
}
async function download(route, filename) {
  const response = await fetch('/api/' + route,{headers:{Authorization:'Bearer ' + token},cache:'no-store'});
  if (!response.ok) {
    const error = await response.json().catch(() => ({})); throw new Error(error.error || 'The original file could not be exported.');
  }
  const blob = await response.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url),30000);
  status(filename + ' exported (' + fmt(blob.size) + ' bytes).');
}
async function upload(kind, file, label) {
  if (!file) throw new Error('Choose the complete ZIP file first.');
  const headers = {'Content-Type':'application/zip'};
  if (kind === 'sources') { headers['X-Source-Name'] = encodeURIComponent(file.name); headers['X-Source-Label'] = encodeURIComponent(label || file.name); }
  return api(kind,{body:file,headers});
}
async function acquireSaved(pending) {
  S.pending = clone(pending); saveDrafts();
  const result = await api('queries/' + path(pending.queryId) + '/acquire',{body:{operationId:pending.operationId,label:pending.label}});
  if (S.pending && S.pending.operationId === pending.operationId) S.pending = null;
  saveDrafts(); await refresh(); await openSource(result.source.id);
  status(result.replayed ? 'Reopened the completed original acquisition.' : 'Complete original source responses retained.');
}
async function continueOperation(id) {
  let op;
  try { op = await api('operations/' + path(id)); }
  catch (error) { if (!S.pending || S.pending.operationId !== id) throw error; }
  if (op && op.status === 'complete') { if (S.pending && S.pending.operationId === id) S.pending = null; await refresh(); await openSource(op.sourceId); return; }
  const saved = op && op.request ? {operationId:id,queryId:op.request.queryId,label:op.request.label} :
    S.pending && S.pending.operationId === id ? S.pending : null;
  if (!saved) throw new Error('Reopen this operation with its original saved query and acquisition label.');
  await acquireSaved(saved);
}
function mappingReview(raw) {
  const p = JSON.parse(raw);
  if (!p || !Array.isArray(p.columns)) throw new Error('The complete mapping must contain its original columns.');
  return {p,html:'<p>This edition uses the complete retained source and the reviewed projection below.</p><dl class="fact-list">' +
    fact('Source',S.source.label) + fact('Dataset',p.name) + fact('Rows',S.source.inventory.rowCount) +
    fact('Edition keys',(p.keys || []).join(', ') || 'None selected') + fact('JSON / CSV policy',p.csvPolicy) + '</dl>' +
    table(['Source field','Original type','Native field','Native type','Nullable','Encoding'],
      p.columns.map(c => [c.source,c.sourceType,c.name,c.type,c.nullable,c.encoding])) + detail('Complete mapping',p)};
}
const actions = {
  refresh:async () => { captureInputs(); await refresh(); status('Saved workspace refreshed. Draft inputs retained.'); },
  search:async () => { captureInputs(); const d=S.drafts.catalog; S.catalog=await api('search',{body:{server:d.server,text:d.text,page:1,limit:25}}); render(); status('Original provider catalogue page retained.'); },
  'catalog-page':async el => { const c=S.catalog; S.catalog=await api('search',{body:{server:c.server,text:c.text,page:Number(el.dataset.page),limit:c.limit}}); render(); },
  'load-metadata':async () => {
    captureInputs(); const d=S.drafts.catalog;
    S.meta=await api('metadata',{body:{server:d.server,datasetId:d.datasetId,protocol:d.protocol}});
    S.selected.meta=S.meta.id; S.cache.set('metadata/'+path(S.meta.id),S.meta); await refresh(); status('Original metadata, DDS and DAS retained.');
  },
  'catalog-open':async el => {
    S.drafts.catalog={...(S.drafts.catalog || {}),server:S.catalog.server,datasetId:el.dataset.id,protocol:el.dataset.protocol};
    S.meta=await api('metadata',{body:{server:S.catalog.server,datasetId:el.dataset.id,protocol:el.dataset.protocol}});
    S.selected.meta=S.meta.id; S.cache.set('metadata/'+path(S.meta.id),S.meta); await refresh();
  },
  'open-metadata':async () => { S.selected.meta=$('#retained-metadata').value; S.meta=await cached('metadata/'+path(S.selected.meta)); saveDrafts(); render(); },
  'open-query':async () => { S.selected.query=$('#retained-query').value; S.query=await cached('queries/'+path(S.selected.query)); saveDrafts(); render(); },
  'add-constraint':async () => { collectSelection(); const d=selectedDraft(); d.constraints.push({variable:S.meta.metadata.variables[0].name,operator:'=',kind:'string',value:''}); saveDrafts(); render(); },
  'remove-constraint':async el => { collectSelection(); selectedDraft().constraints.splice(Number(el.dataset.index),1); saveDrafts(); render(); },
  'example-selection':async () => {
    collectSelection(); const d=selectedDraft();
    if (S.meta.datasetId==='jplMURSST41') {
      d.variables=['analysed_sst','analysis_error','mask','sea_ice_fraction'];
      d.axes=[{name:'time',mode:'value',start:'2025-06-01T09:00:00Z',stop:'2025-06-03T09:00:00Z',stride:1},
        {name:'latitude',mode:'value',start:'36.00',stop:'36.04',stride:2},{name:'longitude',mode:'value',start:'-123.00',stop:'-122.96',stride:2}];
    } else if(S.meta.datasetId==='cwwcNDBCMet') {
      d.variables=['station','longitude','latitude','time','WD','WSPD','WVHT','ATMP','WTMP'];
      d.constraints=[{variable:'station',operator:'=',kind:'string',value:'46042'},
        {variable:'time',operator:'>=',kind:'time',value:'2025-06-01T00:00:00Z'},
        {variable:'time',operator:'<',kind:'time',value:'2025-06-02T00:00:00Z'}];
    }
    const names=new Set(S.meta.metadata.variables.map(v=>v.name));
    if(d.variables.some(v=>!names.has(v))) throw new Error('The provider metadata does not contain every documented example field. Select current original variables explicitly.');
    saveDrafts(); render(); status('Documented selection loaded for review. No acquisition has been sent.');
  },
  'save-query':async () => {
    collectSelection(); const d=clone(selectedDraft());
    const selection=S.meta.protocol==='griddap'?{variables:d.variables,axes:d.axes}:{variables:d.variables,constraints:d.constraints,...(d.orderBy.length?{orderBy:d.orderBy}:{})};
    const body={metadataId:S.meta.id,selection,label:d.label,maxBytes:d.maxBytes};
    reviewed('Save the exact query selection',detail('Reviewed original selection',body,true),'Save reviewed query',async()=>{
      S.query=await api('queries',{body}); S.selected.query=S.query.id; S.cache.set('queries/'+path(S.query.id),S.query);
      await refresh(); status('Query saved. Review its exact request before acquiring source responses.');
    });
  },
  acquire:async () => {
    if(S.pending && S.pending.queryId===S.query.id) { await continueOperation(S.pending.operationId); return; }
    const pending={operationId:'erddap-'+crypto.randomUUID(),queryId:S.query.id,label:S.query.query.label};
    reviewed('Acquire the complete selection','<p>The provider will receive the saved metadata and data requests. The original operation is retained before sending.</p>'+
      '<pre>'+esc(S.query.decodedQuery)+'</pre>'+detail('Acquisition request',pending),'Acquire complete source',async()=>acquireSaved(pending));
  },
  'continue-operation':async el => continueOperation(el.dataset.id),
  'inspect-operation':async el => { const op=await api('operations/'+path(el.dataset.id)); reviewed('Original acquisition operation',detail('Saved request, responses and outcome',op,true),null,null); },
  'import-source':async () => {
    const result=await upload('sources',$('#source-file').files[0],$('#source-label').value);
    await refresh(); await openSource(result.id); status('Complete source imported. Exact response bytes are retained.');
  },
  'select-source':async el => openSource(el.dataset.id),
  'source-rows':async () => sourcePage(0),
  'source-page':async el => sourcePage(Number(el.dataset.offset)),
  'source-file':async el => download('sources/'+path(S.source.id)+'/files/'+path(el.dataset.name),el.dataset.name),
  'default-mapping':async () => {
    const next=await api('sources/'+path(S.source.id)+'/mapping',{body:{}});
    const adopt=async()=>{S.mapping=next;S.mappingSource=S.source.id;S.drafts['mapping:'+S.source.id]=pretty(next);saveDrafts();render();};
    if(S.drafts['mapping:'+S.source.id]) reviewed('Replace this mapping draft','<p>The proposed default uses this source’s original fields, types and units. The current unsaved draft will be replaced.</p>'+detail('Proposed mapping',next),'Use proposed mapping',adopt);
    else await adopt();
  },
  'load-mapping':async () => {
    const id=$('#mapping-from').value, next=await cached('plans/'+path(id));
    const adopt=async()=>{S.selected.plan=id;S.mapping=clone(next);S.mappingSource=S.source.id;S.drafts['mapping:'+S.source.id]=pretty(next);saveDrafts();render();};
    if(S.drafts['mapping:'+S.source.id]) reviewed('Use the saved mapping','<p>This replaces the current unsaved draft. The original engine will check the provider, fields, types and units against this source.</p>'+detail('Saved mapping',next),'Use saved mapping',adopt);
    else await adopt();
  },
  'apply-mapping-json':async () => { const raw=$('#mapping-json').value; const p=JSON.parse(raw); if(!p || !Array.isArray(p.columns))throw new Error('Expected a complete mapping with columns.'); S.mapping=p;S.mappingSource=S.source.id;S.drafts['mapping:'+S.source.id]=pretty(p);saveDrafts();render(); },
  'review-mapping':async () => {
    const raw=$('#mapping-json').value, r=mappingReview(raw), sid=S.source.id;
    S.drafts['mapping:'+sid]=raw;saveDrafts();
    reviewed('Build the reviewed dataset edition',r.html,'Save mapping and build',async()=>{
      const saved=await api('plans',{body:r.p}); S.selected.plan=saved.id;
      const result=await api('builds',{body:{sourceId:sid,planId:saved.id}});
      S.cache.set('builds/'+path(result.id),result);await refresh();await openBuild(result.id);
      status('Complete native edition built from the original source.');
    });
  },
  'select-build':async el => openBuild(el.dataset.id),
  'native-query':async () => { captureInputs();S.nativeCursors=[];await runQuery(); },
  'native-next':async () => { const next=S.nativeRows.response.body.page.nextCursor;await runQuery(next,true); },
  'native-previous':async () => { const previous=S.nativeCursors[S.nativeCursors.length-1];await runQuery(previous,false);S.nativeCursors.pop();render(); },
  'export-packet':async () => download('builds/'+path(S.build.id)+'/packet','erddap-project-'+S.build.id.slice(0,12)+'.zip'),
  'export-dataset':async () => download('builds/'+path(S.build.id)+'/dataset','erddap-dataset-'+S.build.id.slice(0,12)+'.zip'),
  'edition-source':async () => openSource(S.build.source),
  'edition-mapping':async () => { const p=await cached('plans/'+path(S.build.plan));reviewed('Original saved mapping',detail('Immutable mapping',p,true),null,null); },
  compare:async () => { captureInputs();S.comparison=await api('comparisons',{body:{beforeId:S.selected.before,afterId:S.selected.after}});await refresh();await changesPage(0);status('Original editions compared by their retained unique keys.'); },
  'open-comparison':async el => { S.comparison=S.state.comparisons.find(x=>x.id===el.dataset.id);await changesPage(0); },
  'changes-page':async el => changesPage(Number(el.dataset.offset)),
  'import-packet':async () => {
    const result=await upload('packets',$('#packet-file').files[0]);
    S.drafts.received=result;S.selected.build=result.build.id;S.cache.set('builds/'+path(result.build.id),result.build);
    await refresh();S.view='receive';saveDrafts();render();status('Original source, mapping and native snapshot reconstructed in this workspace.');
  },
  'received-edition':async () => openBuild(S.drafts.received.build.id)
};
document.addEventListener('input',event=>captureInputs(event.target));
document.addEventListener('change',event=>{
  captureInputs(event.target);
  if(event.target.matches('[data-variable]')) render();
});
document.addEventListener('submit',event=>event.preventDefault());
document.addEventListener('click',event=>{
  const view=event.target.closest('[data-view]');
  if(view) {
    if(S.busy)return;captureInputs();S.view=view.dataset.view;saveDrafts();render();clearError();return;
  }
  const el=event.target.closest('[data-action]');
  if(!el)return;
  event.preventDefault();
  if(el.dataset.action==='close-review') { if(!S.busy){$('#review-dialog').close();S.review=null;}return; }
  if(el.dataset.action==='confirm-review') {
    const run=S.review;
    if(run) { $('#review-dialog').close();S.review=null;void busy('Applying the exact reviewed request…',run); }
    return;
  }
  const action=actions[el.dataset.action];
  if(action) void busy(el.textContent.trim()+'…',()=>action(el));
});
void busy('Opening the original saved workspace…',async()=>{
  if(!token)throw new Error('Open the private workspace URL printed by the original server. It contains the process capability in its fragment.');
  await refresh(true);
  if(S.source && S.view==='sources')await sourcePage(0);
  if(S.build && S.view==='editions')await runQuery();
  status('Saved workspace opened.');
});
