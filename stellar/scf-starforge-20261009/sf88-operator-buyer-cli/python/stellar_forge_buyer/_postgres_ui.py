"""Neutral PostgreSQL receiving operator assets."""

HTML = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PostgreSQL receiving · Stellar Forge</title><link rel="stylesheet" href="/style.css"></head>
<body><header class="topbar"><div><span class="brand">STELLAR FORGE</span><h1>PostgreSQL receiving</h1></div><div class="header-actions"><span id="database-label" class="badge">Opening database</span><button id="refresh" type="button">Refresh</button></div></header>
<div class="shell"><aside class="sidebar"><nav aria-label="Receiving workspace"><button class="nav active" data-screen="source">Source review</button><button class="nav" data-screen="editions">Retained editions</button><button class="nav" data-screen="views">Application views</button><button class="nav" data-screen="compare">Compare editions</button><button class="nav" data-screen="recovery">Operations</button></nav><section class="workspace-info"><h2>Receiving workspace</h2><p id="workspace-path" class="mono wrap">Opening…</p><p id="warehouse-id" class="mono wrap"></p></section></aside>
<main><div id="message" class="notice" role="status" aria-live="polite" hidden></div>
<section id="screen-source" class="screen"><div class="page-title"><div><h2>Review and receive a dataset</h2><p>Inspect the complete original delivery, choose its database mapping, then retain an immutable edition.</p></div></div>
<section class="panel"><form id="source-form"><label for="report-path">Original delivery report on this computer</label><div class="inline"><input id="report-path" autocomplete="off" spellcheck="false" required placeholder="/absolute/path/to/dataset-delivery.json"><button class="primary" type="submit">Inspect delivery</button></div><p class="hint">Open the original SF88 delivery report or finalized SF100 scan. Its original files remain the receiving input.</p></form></section>
<section id="source-panel" class="panel" hidden><h3>Complete source review</h3><dl id="source-facts" class="facts"></dl><div id="source-meanings"></div><h3>Field and key mapping</h3><p class="hint">Suggested types come from every delivered row. Review all columns. Keys use non-null comparable fields; PostgreSQL checks uniqueness during import.</p><div class="table-scroll"><table><thead><tr><th>Original field</th><th>Database column</th><th>PostgreSQL type</th><th>Allow null</th><th>Key</th><th>Observed values</th></tr></thead><tbody id="mapping-rows"></tbody></table></div><details><summary>First five original rows</summary><div id="source-preview"></div></details><form id="mapping-form"><div class="form-grid"><label>Reviewer<input id="reviewer" required maxlength="160" autocomplete="name"></label><label>Review note<textarea id="review-note" rows="2" maxlength="4000" placeholder="Describe the selected fields, types and keys."></textarea></label></div><button class="primary" type="submit">Save complete mapping review</button></form></section>
<section id="review-panel" class="panel" hidden><div class="section-head"><h3>Saved receiving review</h3><button id="import-review" class="primary" type="button">Import reviewed edition</button></div><div id="review-details"></div></section>
<section class="panel"><div class="section-head"><h3>Previous reviews</h3><button id="more-reviews" type="button" hidden>More reviews</button></div><div id="review-list" class="item-list"></div></section></section>
<section id="screen-editions" class="screen" hidden><div class="page-title"><div><h2>Retained dataset editions</h2><p>Read typed records with their original field meanings. Download the source dictionary, manifest and receiving mapping.</p></div></div><div class="two-column"><section class="panel"><div id="edition-list" class="item-list"></div><button id="more-editions" class="stack" type="button" hidden>More editions</button></section><section id="edition-panel" class="panel" hidden><div id="edition-facts"></div><div class="toolbar"><button id="download-manifest" type="button">Original manifest</button><button id="download-mapping" type="button">Column mapping</button><button id="download-edition" type="button">Receiving record</button><button id="download-semantics" type="button" hidden>Original dictionary</button><button id="use-edition" type="button">Use in application view</button></div><div id="edition-meanings" class="stack"></div><div id="edition-rows"></div><div class="toolbar"><button id="rows-previous" type="button">Previous rows</button><span id="rows-label" class="muted"></span><button id="rows-next" type="button">Next rows</button></div><details><summary>Complete edition and mapping</summary><pre id="edition-json"></pre></details></section></div></section>
<section id="screen-views" class="screen" hidden><div class="page-title"><div><h2>Select the application’s dataset</h2><p>Keep a stable SQL view while retaining each selected edition and its complete history.</p></div></div><section class="panel"><h3>Current application views</h3><div id="view-list" class="item-list"></div></section>
<section class="panel"><form id="view-form"><div class="form-grid"><label>View name<input id="view-name" required maxlength="63" autocomplete="off" spellcheck="false" placeholder="customer_inventory"></label><label>Retained edition<select id="view-version" required></select></label></div><button type="submit">Review current view and selection</button></form><div id="view-review" class="stack" hidden><div id="view-facts"></div><div id="view-meanings"></div><div id="view-meaning-comparison"></div><button id="activate-view" class="primary" type="button">Select this edition</button><p class="hint">The reviewed current revision is checked by PostgreSQL. A changed column signature requires a new view name.</p></div><div id="view-history" class="stack"></div><button id="more-history" type="button" hidden>More history</button></section></section>
<section id="screen-compare" class="screen" hidden><div class="page-title"><div><h2>Compare complete editions</h2><p>Compare original field meanings and database mappings, then compare every row by the reviewed source keys.</p></div></div><section class="panel"><form id="compare-form"><div class="form-grid"><label>Previous edition<select id="compare-previous" required></select></label><label>Following edition<select id="compare-current" required></select></label></div><div class="toolbar"><button class="primary" type="submit">Compare all rows</button><button id="compare-meanings" type="button">Compare source meanings</button></div></form><div id="compare-meaning-result" class="stack"></div><div id="compare-result" class="stack"></div><div class="toolbar"><button id="compare-back" type="button" hidden>Previous changes</button><span id="compare-label" class="muted"></span><button id="compare-next" type="button" hidden>More changes</button></div></section></section>
<section id="screen-recovery" class="screen" hidden><div class="page-title"><div><h2>Operations and recovery</h2><p>Reopen the saved import or view selection after a lost response or process restart.</p></div></div><section class="panel"><div id="request-list" class="item-list"></div><button id="more-requests" class="stack" type="button" hidden>More operations</button></section><section id="request-panel" class="panel" hidden><div id="request-details"></div></section><section class="panel"><h3>Reopen and hand over</h3><p>The operator directory retains mapping reviews and original requests. PostgreSQL retains complete imported rows, original dictionaries and manifests, immutable editions and selected view history. Reopen this directory with the same restored database and schema.</p><p class="hint">Use the database owner’s PostgreSQL backup and restore procedure for the complete receiving schema. Download a selected edition’s mapping, manifest and receiving record from Retained editions for the handover.</p><dl id="reopen-facts" class="facts"></dl></section></section>
<footer>STELLAR FORGE · CUSTOMER DATA RECEIVING</footer></main></div><script src="/app.js" defer></script></body></html>
"""

CSS = r""":root{color-scheme:light;--ink:#24292f;--muted:#57606a;--line:#d0d7de;--paper:#fff;--ground:#f4f5f6;--selected:#eaecef}*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select,textarea{font:inherit}button{border:1px solid #afb8c1;border-radius:4px;background:#fff;color:var(--ink);padding:7px 12px;cursor:pointer;font-weight:600;white-space:nowrap}button:hover{background:#eceef0}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #57606a;outline-offset:2px}button:disabled{opacity:.5;cursor:wait}.primary{background:var(--ink);color:#fff;border-color:var(--ink)}.primary:hover{background:#424a53}input,textarea,select{width:100%;border:1px solid #afb8c1;border-radius:4px;background:#fff;color:var(--ink);padding:8px}textarea{resize:vertical}textarea#sql,.mono,code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}label{display:block;font-size:13px;font-weight:600;margin:12px 0 6px}label input,label select{display:block;margin-top:5px}h1,h2,h3,p{margin:0}h1{font-size:20px;letter-spacing:-.35px;margin-top:2px}h2{font-size:22px;letter-spacing:-.3px}h3{font-size:15px;margin-bottom:10px}.topbar{min-height:83px;border-bottom:1px solid var(--line);background:#fff;padding:15px 28px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-size:10px;letter-spacing:1.6px;font-weight:750;color:var(--muted)}.header-actions,.inline,.toolbar{display:flex;align-items:center;gap:10px}.badge{font-size:12px;border:1px solid var(--line);border-radius:4px;padding:4px 9px;color:var(--muted);background:#fafbfc}.shell{display:grid;grid-template-columns:222px minmax(0,1fr);min-height:calc(100vh - 83px)}.sidebar{border-right:1px solid var(--line);padding:20px 14px;background:#fafbfc}.sidebar nav{display:grid;gap:5px}.nav{width:100%;text-align:left;display:flex;justify-content:space-between;align-items:center;border-color:transparent;background:transparent;font-size:13px;padding:10px}.nav.active{background:var(--selected);border-color:var(--line)}.nav span{font-size:11px;font-weight:500}.workspace-info{border-top:1px solid var(--line);margin:25px 7px 0;padding-top:17px}.workspace-info h2{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);margin-bottom:8px}.workspace-info p{font-size:11px;line-height:1.6;margin-top:4px}.wrap{overflow-wrap:anywhere}main{min-width:0;max-width:1700px;padding:26px 30px}.page-title{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}.page-title p{color:var(--muted);margin-top:5px}.panel{background:#fff;border:1px solid var(--line);border-radius:5px;padding:20px;margin-bottom:18px;min-width:0}.panel h3:not(:first-child){margin-top:20px}.section-head{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:12px}.section-head h3{margin:0}.inline input{flex:1;min-width:0}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.stack{margin-top:20px}.toolbar{flex-wrap:wrap;margin-top:16px}.hint,.muted{color:var(--muted);font-size:12px}.hint{margin:7px 0 12px}.facts{display:grid;grid-template-columns:minmax(110px,auto) minmax(0,1fr);gap:6px 16px;margin:12px 0 18px;font-size:13px}.facts dt{color:var(--muted)}.facts dd{margin:0;overflow-wrap:anywhere}.table-scroll{max-width:100%;overflow:auto;max-height:490px;border:1px solid var(--line);border-radius:4px;margin-top:12px}table{border-collapse:collapse;min-width:100%;font-size:12px;text-align:left}th{font-weight:600;background:#f6f7f8;position:sticky;top:0;z-index:1;color:#424a53}th,td{padding:9px 12px;border-bottom:1px solid #e5e7e9;vertical-align:top}th{white-space:nowrap}td{max-width:400px;overflow-wrap:anywhere}tr:last-child td{border-bottom:0}td input,td select{min-width:130px;font-size:12px;padding:5px}td code{font-size:11px}.empty{padding:36px 24px;text-align:center;border:1px dashed var(--line);border-radius:5px;color:var(--muted)}.empty h3{color:var(--ink)}.empty p{max-width:560px;margin:auto}.two-column{display:grid;grid-template-columns:minmax(260px,.8fr) minmax(360px,1.2fr);gap:20px;align-items:start}.item-list{display:grid;gap:8px}.item{display:block;width:100%;text-align:left;padding:12px;border:1px solid var(--line);border-radius:4px;background:#fff;white-space:normal}.item.selected{background:#f0f2f4;border-color:#8c959f}.item-title{font-weight:600;display:block;overflow-wrap:anywhere}.item-sub{display:block;font-size:11px;color:var(--muted);margin-top:3px;font-weight:400;overflow-wrap:anywhere}.compact .item{font-size:12px;padding:8px}.query-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:20px;align-items:start}.query-catalog h3{font-size:12px}.query-catalog h3:not(:first-child){margin-top:24px}.notice{background:#fff;border:1px solid #8c959f;border-left:4px solid #57606a;border-radius:4px;padding:12px 16px;margin-bottom:20px;overflow-wrap:anywhere}.notice[data-level=error]{border-left-width:6px;background:#f3f3f3;font-weight:600}details{margin-top:17px;border-top:1px solid #e5e7e9;padding-top:12px}summary{cursor:pointer;font-size:12px;color:var(--muted)}pre{font-size:11px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;max-height:330px;overflow:auto;margin:10px 0 0;background:#f6f7f8;padding:12px;border-radius:4px}hr{border:0;border-top:1px solid var(--line);margin:22px 0 10px}.metric-grid{display:flex;flex-wrap:wrap;gap:20px;margin:20px 0 12px}.metric{min-width:100px}.metric strong{display:block;font-size:23px;font-weight:600}.metric span{font-size:11px;color:var(--muted)}footer{font-size:10px;color:#6e7781;padding:10px 0 18px;letter-spacing:.3px}[hidden]{display:none!important}@media(max-width:1100px){main{padding:20px}.query-layout{grid-template-columns:190px minmax(0,1fr)}.two-column{grid-template-columns:1fr}.shell{grid-template-columns:185px minmax(0,1fr)}}@media(max-width:760px){.topbar{padding:14px 16px}.badge{display:none}.shell{display:block}.sidebar{border-right:0;border-bottom:1px solid var(--line);padding:8px}.sidebar nav{grid-template-columns:repeat(4,1fr);gap:2px}.nav{font-size:11px;padding:9px 5px;text-align:center;justify-content:center;white-space:normal}.nav span,.workspace-info{display:none}main{padding:18px 12px}.page-title{align-items:flex-start;flex-direction:column}h2{font-size:21px}.query-layout{display:block}.query-catalog{display:grid;grid-template-columns:1fr 1fr;gap:12px}.query-catalog h3{display:none}.form-grid{grid-template-columns:1fr;gap:0}.panel{padding:16px}.inline{flex-wrap:wrap}.inline input{flex-basis:100%}.toolbar button{flex:1;font-size:12px}.facts{grid-template-columns:100px 1fr;gap:7px}.topbar h1{font-size:18px}}
input[type=checkbox]{width:16px;min-width:16px;height:16px;margin:0;accent-color:#424a53}

.cell-original{min-width:180px}.cell-original details{margin:0;padding:0;border:0}.cell-original pre{max-height:180px}
.check-cell{text-align:center}.record-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
#source-preview{overflow:auto}.meanings{margin:18px 0}.meaning-cell{min-width:150px;max-width:320px}.meaning-cell .hint{margin:4px 0}.meanings .table-scroll{max-height:520px}.mapping-sample{font-size:11px;max-width:220px}
@media(max-width:760px){.sidebar nav{grid-template-columns:repeat(3,1fr)}.two-column{display:block}.form-grid{display:block}.header-actions{gap:5px}.topbar{gap:8px}.topbar h1{font-size:17px}}
"""

JS = r"""'use strict';
const $ = id => document.getElementById(id);
const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
let token = location.hash.slice(1) || sessionStorage.getItem('postgres-capability');
if (location.hash) {
  sessionStorage.setItem('postgres-capability', token);
  history.replaceState(null, '', location.pathname);
}
let state = null, busy = false, source = null, selectedReview = null, selectedEdition = null;
let versionRows = [], reviewRows = [], requestRows = [], versionBefore = null, reviewBefore = null, requestBefore = null;
let rowsAfter = 0, rowBack = [], nextRow = null, viewReview = null, historyRows = [], historyBefore = null;
let comparison = null, compareOffset = 0, compareBack = [], compareNext = null;
const editions = new Map();
const types = ['text','boolean','bigint','numeric','double precision','date','timestamp with time zone','json'];
const errors = {
  DATASET_PG_DUPLICATE_KEY: 'A declared key occurs more than once. Review the original rows and save a corrected key mapping before importing again.',
  DATASET_PG_REVIEWED_INPUT_CHANGED: 'The source changed after review. Inspect the current original delivery and save a new mapping review.',
  DATASET_PG_VIEW_CHANGED: 'The application view changed after this selection was reviewed. Reopen its current view and history before selecting an edition.',
  DATASET_PG_VIEW_SCHEMA_CHANGED_USE_NEW_VIEW: 'This edition changes the view’s columns or database types. Choose a new application view name.',
  DATASET_PG_COMPARE_REQUIRES_SAME_MAPPING_AND_KEYS: 'Choose two editions with the same complete mapping and at least one reviewed source key.',
  DATASET_PG_OPERATOR_WAREHOUSE_CHANGED: 'This operator directory belongs to a different database identity or schema. Reopen it with its original restored warehouse.',
  DATASET_PG_KEYS_REQUIRE_NONNULL_COMPARABLE_COLUMNS: 'Keys must use non-null comparable fields. Review the selected key and null settings.',
  DATASET_PG_REIMPORT_ORIGINAL_DICTIONARY_REQUIRED: 'This edition predates dictionary receiving. Reopen its original saved review and import it again to attach the bound original dictionary to the same edition.',
  DATASET_PG_LEGACY_EDITION_HAS_NO_DICTIONARY: 'This original delivery has no source dictionary.',
  DATASET_SQL_SEMANTIC_MAPPING_INVALID: 'Use distinct database column names, including capitalization, for the retained source dictionary.',
  DATASET_PG_OPERATOR_CAPABILITY_REQUIRED: 'Open the private URL from this application’s current launch record.',
};
function message(text, error = false) {
  $('message').textContent = text;
  $('message').hidden = !text;
  $('message').dataset.level = error ? 'error' : 'info';
}
function errorText(error) {
  const value = error.payload || {};
  let text = errors[value.error] || error.message || 'The operation could not complete.';
  if (value.field) text += ' Field: ' + value.field + '.';
  if (value.row !== undefined) text += ' Row: ' + value.row + '.';
  if (value.sqlstate) text += ' PostgreSQL state: ' + value.sqlstate + '.';
  return text;
}
async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {'X-Postgres-Capability': token || '', ...(body === undefined ? {} : {'Content-Type':'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error || 'Request failed');
    error.payload = value;
    throw error;
  }
  return value;
}
function controls() {
  for (const node of document.querySelectorAll('button,input,select,textarea')) node.disabled = busy;
  $('import-review').disabled = busy || !selectedReview;
  $('activate-view').disabled = busy || !viewReview;
  $('rows-previous').disabled = busy || !rowBack.length;
  $('rows-next').disabled = busy || nextRow === null;
  $('compare-back').disabled = busy || !compareBack.length;
  $('compare-next').disabled = busy || compareNext === null;
}
async function run(task) {
  if (busy) return;
  busy = true; message(''); controls();
  try { await task(); }
  catch (error) { message(errorText(error), true); }
  finally { busy = false; controls(); }
}
function show(screen) {
  for (const node of document.querySelectorAll('.screen')) node.hidden = node.id !== 'screen-' + screen;
  for (const node of document.querySelectorAll('.nav')) node.classList.toggle('active', node.dataset.screen === screen);
}
function button(text, action, className) {
  const node = make('button', text, className);
  node.type = 'button';
  node.addEventListener('click', () => run(action));
  return node;
}
function facts(pairs) {
  const node = make('dl', undefined, 'facts');
  for (const [key, value] of pairs) {
    node.append(make('dt', key), make('dd', value === null || value === undefined ? '—' : String(value)));
  }
  return node;
}
function details(title, value) {
  const node = make('details');
  node.append(make('summary', title), make('pre', JSON.stringify(value, null, 2)));
  return node;
}
function empty(text) { return make('p', text, 'empty'); }
function cell(value) {
  if (value instanceof Node) return value;
  if (value === null) return make('span', 'NULL', 'muted mono');
  return make('span', typeof value === 'object' ? JSON.stringify(value) : String(value));
}
function table(headings, rows) {
  const wrap = make('div', undefined, 'table-scroll'), node = make('table'), head = make('thead'), body = make('tbody');
  const labels = make('tr'); headings.forEach(value => labels.append(make('th', value))); head.append(labels);
  rows.forEach(values => { const row = make('tr'); values.forEach(value => {const td = make('td'); td.append(cell(value)); row.append(td);}); body.append(row); });
  node.append(head, body); wrap.append(node); return wrap;
}
function meaningText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(meaningText).filter(Boolean).join('; ');
  return JSON.stringify(value);
}
function meaningCell(column) {
  if (!column) return make('span', 'No dictionary definition', 'muted');
  const node = make('div', undefined, 'meaning-cell'), definition = column.projectedDefinition || {};
  const title = meaningText(definition.titles || definition.title);
  if (title) node.append(make('strong', title));
  if (definition.description) node.append(make('p', meaningText(definition.description)));
  const entries = [['Source field',column.sourceField],['Source type',column.type],
    ['Encoding',column.encoding],['Units',definition.unit || definition.units],
    ['Datatype',definition.datatype],['Format',definition.format]];
  for (const [label, value] of entries) if (value !== undefined && value !== null && value !== '')
    node.append(make('p', label + ': ' + meaningText(value), 'hint'));
  return node;
}
function meanings(record, currentMapping) {
  const node = make('section', undefined, 'meanings');
  node.append(make('h3', 'Original field meanings'));
  if (record.semantics_status === 'SOURCE_REQUIRED') {
    node.append(make('p', 'The original manifest includes a dictionary that this earlier import did not retain. Open its saved review and import the same edition to receive that dictionary.', 'notice'),
      button('Open original receiving review', () => openOriginalMeaningReview(record.version_id)));
    return node;
  }
  const document = record.semantic_dictionary || record.document;
  const descriptor = record.semantics || (record.document ? record : null);
  if (!document || !descriptor) {
    node.append(make('p', record.semantics_status === 'NONE'
      ? 'This delivery has no source dictionary. The reviewed mapping and original rows remain available.'
      : 'This older saved review did not record source meanings. Reopen the original delivery to inspect its dictionary, or import the same reviewed edition to retain it.', 'hint'));
    return node;
  }
  const mapping = currentMapping || record.mapping;
  const aliases = new Map((mapping?.columns || descriptor.columns).map(column => [column.source,column.column]));
  const sourceKeys = document.primaryKey.projected || [];
  const key = descriptor.primary_key;
  const sourceKeySelected = sourceKeys.length > 0 && document.primaryKey.complete &&
    !!mapping && mapping.keys.length === sourceKeys.length && sourceKeys.every(name => mapping.keys.includes(name));
  node.append(facts([
    ['Dictionary',record.semantics_status === 'AVAILABLE' ? 'Verified original delivery' : 'Retained original delivery'],
    ['Source primary key',sourceKeys.join(', ') || 'Not declared'],
    ['Key coverage',document.primaryKey.complete && sourceKeys.every(name => aliases.has(name)) ? 'All source key fields are mapped' : 'Source key is incomplete or outside this projection'],
    ['Receiving key',mapping ? mapping.keys.join(', ') || 'Original row order' : key.columns.join(', ') || 'Original row order'],
    ['Source key enforced',record.semantics_status === 'AVAILABLE'
      ? sourceKeySelected ? 'Selected for PostgreSQL enforcement on import' : 'The selected receiving key does not enforce the source key'
      : key.enforced ? 'Yes, by this edition’s PostgreSQL primary key' : 'No'],
  ]));
  const definitions = document.columns.filter(column => aliases.has(column.name));
  node.append(table(['Delivered field','Database column','Meaning','Original definition'], definitions.map(column => [
    column.name, aliases.get(column.name), meaningCell(column),
    details('Full field definition', column),
  ])));
  if (document.issues.length) node.append(details('Source definition issues',document.issues));
  if (document.virtualColumns.length) node.append(details('Source virtual columns',document.virtualColumns));
  node.append(details('Original dictionary and source capture',document),
    details('Dictionary file and SQL binding',descriptor));
  return node;
}
function renderMeaningComparison(value) {
  const node = make('section', undefined, 'meanings');
  node.append(make('h3','Source meaning comparison'), facts([
    ['Field definitions',value.definition_changed ? 'Changed' : 'Unchanged'],
    ['Source capture',value.capture_changed ? 'Changed' : 'Unchanged'],
    ['Receiving mapping',value.mapping_changed ? 'Changed' : 'Unchanged'],
    ['Fields with changes',value.columns.length],
  ]));
  if (value.columns.length) node.append(table(['Field','Previous meaning and mapping','Following meaning and mapping'],
    value.columns.map(column => [column.source,
      column.before === null ? null : details('Previous field',column.before),
      column.after === null ? null : details('Following field',column.after)])));
  else node.append(make('p',value.mapping_changed
    ? 'Field definitions, aliases, types and key membership are unchanged. The complete mappings below show the remaining mapping change.'
    : 'The source fields and receiving mappings are unchanged.','hint'));
  if (value.mapping_changed) node.append(details('Previous complete receiving mapping',value.before_mapping),
    details('Following complete receiving mapping',value.after_mapping));
  node.append(button('Download complete meaning comparison', () => download(
    '/api/semantic-compare?previous=' + value.before_version + '&current=' + value.after_version,
    'postgres-meanings-' + value.before_version + '-' + value.after_version + '.json')),
    details('Complete source meaning comparison',value));
  return node;
}
async function openOriginalMeaningReview(versionId) {
  let found = reviewRows.find(row => row.version_id === versionId);
  while (!found && reviewBefore) {
    const page = await api('/api/reviews?before=' + encodeURIComponent(reviewBefore) + '&limit=100');
    reviewRows.push(...page.reviews); reviewBefore = page.next_before;
    found = reviewRows.find(row => row.version_id === versionId);
  }
  renderReviews(); show('source');
  if (!found) {
    message('Open this edition’s original delivery report, save its complete mapping review, then import the unchanged edition to retain the dictionary.');
    $('report-path').focus(); return;
  }
  renderReview(await api('/api/reviews/' + found.record_id));
  $('review-panel').scrollIntoView({block:'start'});
  message('Import this original review to attach the dictionary to its existing edition.');
}
function editionLabel(record) {
  return (record.dataset?.name || 'Dataset') + ' · ' + record.row_count + ' rows · ' + record.version_id.slice(0, 12);
}
function remember(values) {
  for (const value of values) editions.set(value.version_id, value);
}
function fillSelect(node) {
  const selected = node.value;
  node.replaceChildren(...[...editions.values()].map(value => new Option(editionLabel(value), value.version_id)));
  if (editions.has(selected)) node.value = selected;
}
function pendingKey() { return 'postgres-pending:' + state.identity.operator_id; }
function pending() {
  const value = JSON.parse(localStorage.getItem(pendingKey()) || '{}');
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('The browser recovery record is invalid.');
  return value;
}
function keepPending(id, record) {
  const saved = pending();
  if (record) saved[id] = record; else delete saved[id];
  localStorage.setItem(pendingKey(), JSON.stringify(saved));
}
async function request(route, body, existingId) {
  const requestId = existingId || crypto.randomUUID().replaceAll('-', '');
  const original = {...body, request_id: requestId};
  keepPending(requestId, {route, body: original});
  const result = await api(route, original);
  if (result.state === 'COMPLETE') keepPending(requestId, null);
  await refresh();
  return result;
}
async function resume(id, local) {
  let result;
  if (local) result = await api(local.route, local.body);
  else result = await api('/api/requests/' + encodeURIComponent(id) + '/resume', {});
  if (result.state === 'COMPLETE') keepPending(id, null);
  await refresh();
  renderRequest(result);
  message('The original saved operation is ' + result.state.toLowerCase() + '.');
}
async function download(path, filename) {
  const response = await fetch(path, {headers:{'X-Postgres-Capability':token || ''}});
  if (!response.ok) {
    const payload = await response.json(), error = new Error(payload.error); error.payload = payload; throw error;
  }
  const blob = await response.blob(), url = URL.createObjectURL(blob), link = make('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function refresh() {
  state = await api('/api/state');
  versionRows = state.versions.versions; versionBefore = state.versions.next_before;
  reviewRows = state.reviews.reviews; reviewBefore = state.reviews.next_before;
  requestRows = state.requests.requests; requestBefore = state.requests.next_before;
  remember(versionRows);
  $('database-label').textContent = 'PostgreSQL ' + state.warehouse.postgresql_version;
  $('workspace-path').textContent = state.directory;
  $('warehouse-id').textContent = state.identity.warehouse_schema + ' · ' + state.identity.warehouse_id;
  $('reopen-facts').replaceChildren(...facts([
    ['Operator directory',state.directory],['Database schema',state.identity.warehouse_schema],
    ['Warehouse identity',state.identity.warehouse_id],['Retained editions',state.warehouse.editions],
  ]).children);
  viewReview = null; $('view-review').hidden = true;
  renderEditions(); renderReviews(); renderViews(); renderRequests();
  for (const id of ['view-version','compare-previous','compare-current']) fillSelect($(id));
}

function renderMapping() {
  const rows = source.mapping.columns.map((column, index) => {
    const row = make('tr'); row.dataset.index = String(index);
    const original = make('td'); original.append(make('code', column.source));
    const meaning = source.semantic_dictionary?.columns.find(value => value.name === column.source);
    if (meaning) original.append(meaningCell(meaning));
    const nameCell = make('td'), name = make('input'); name.value = column.column; name.dataset.field = 'column';
    name.setAttribute('aria-label', 'Database column for ' + column.source); name.spellcheck = false; nameCell.append(name);
    const typeCell = make('td'), type = make('select'); type.dataset.field = 'type';
    type.setAttribute('aria-label', 'PostgreSQL type for ' + column.source);
    type.append(...types.map(value => new Option(value, value))); type.value = column.type; typeCell.append(type);
    const nullableCell = make('td', undefined, 'check-cell'), nullable = make('input'); nullable.type = 'checkbox';
    nullable.checked = column.nullable; nullable.dataset.field = 'nullable'; nullable.setAttribute('aria-label','Allow null for ' + column.source); nullableCell.append(nullable);
    const keyCell = make('td', undefined, 'check-cell'), key = make('input'); key.type = 'checkbox'; key.dataset.field = 'key';
    key.setAttribute('aria-label','Use ' + column.source + ' as key'); keyCell.append(key);
    key.addEventListener('change', () => {if (key.checked) nullable.checked = false;});
    nullable.addEventListener('change', () => {if (nullable.checked) key.checked = false;});
    const observed = source.columns[index];
    const sample = make('td', (observed.json_types.join(', ') || 'No rows') + ' · ' + observed.nulls + ' nulls', 'mapping-sample');
    row.append(original, nameCell, typeCell, nullableCell, keyCell, sample); return row;
  });
  $('mapping-rows').replaceChildren(...rows);
}
function mapping() {
  const columns = [], keys = [];
  for (const row of $('mapping-rows').children) {
    const original = source.mapping.columns[Number(row.dataset.index)].source;
    columns.push({source:original,column:row.querySelector('[data-field=column]').value,
      type:row.querySelector('[data-field=type]').value,nullable:row.querySelector('[data-field=nullable]').checked});
    if (row.querySelector('[data-field=key]').checked) keys.push(original);
  }
  return {schema:'stellar-forge.postgres-dataset-mapping.v1',columns,keys};
}
async function inspectSource() {
  const path = $('report-path').value;
  const result = await api('/api/inspect-delivery', {report_path:path});
  if ($('report-path').value !== path) throw new Error('The input path changed. Inspect the selected delivery again.');
  source = result; selectedReview = null; $('review-panel').hidden = true;
  $('source-panel').hidden = false;
  $('source-facts').replaceChildren(...facts([
    ['Original report',source.source_path],['Dataset',source.dataset.name || 'Dataset'],
    ['Complete rows',source.row_count],['Source pages',source.source_pages],
    ['Original snapshot',source.dataset.snapshot],['Original payment status',JSON.stringify(source.payment_status)],
  ]).children);
  renderMapping();
  $('source-meanings').replaceChildren(meanings(source));
  const names = source.mapping.columns.map(column => column.source);
  $('source-preview').replaceChildren(table(names, source.preview.map(row => names.map(name => row[name]))));
}
function renderReview(record) {
  selectedReview = record; $('review-panel').hidden = false;
  $('review-details').replaceChildren(
    facts([['Reviewer',record.reviewer],['Note',record.note || '—'],['Complete rows',record.row_count],
      ['Source',record.source_path],['Keys',record.mapping.keys.join(', ') || 'Original row order'],
      ['Retained edition',record.version_id]]),
    table(['Source','Column','Type','Null allowed'],record.mapping.columns.map(column =>
      [column.source,column.column,column.type,column.nullable ? 'Yes' : 'No'])),
    meanings({...record.review,mapping:record.mapping}), details('Complete saved review',record));
}
function renderReviews() {
  $('more-reviews').hidden = !reviewBefore;
  $('review-list').replaceChildren(...(reviewRows.length ? reviewRows.map(record => {
    const item = button('', async () => {renderReview(await api('/api/reviews/' + record.record_id));show('source');});
    item.className = 'item';
    item.append(make('span',record.row_count + ' rows · ' + record.reviewer,'item-title'),
      make('span',record.source_path,'item-sub'),make('span',record.created_at,'item-sub'));
    return item;
  }) : [empty('Saved mapping reviews will appear here.')]));
}
async function saveReview() {
  if (!source) throw new Error('Inspect the original delivery first.');
  const result = await api('/api/reviews', {
    report_path:source.source_path,expected_report_sha256:source.source_sha256,mapping:mapping(),
    reviewer:$('reviewer').value,note:$('review-note').value,
  });
  renderReview(result); await refresh();
  message('The complete mapping review is saved. Import this reviewed edition when ready.');
}
async function importReview() {
  if (!selectedReview) throw new Error('Open a saved mapping review first.');
  const result = await request('/api/import', {review_id:selectedReview.record_id});
  await openEdition(result.result.version_id); show('editions');
  message(result.result.import_status === 'UNCHANGED' ? 'This exact edition is already retained in the warehouse.' : 'The complete reviewed edition is imported.');
}
function renderEditions() {
  $('more-editions').hidden = !versionBefore;
  $('edition-list').replaceChildren(...(versionRows.length ? versionRows.map(record => {
    const item = button('', () => openEdition(record.version_id)); item.className = 'item';
    item.classList.toggle('selected',selectedEdition?.version_id === record.version_id);
    item.append(make('span',editionLabel(record),'item-title'),
      make('span',record.created_at,'item-sub'),make('span',record.qualified_table,'item-sub mono'));
    return item;
  }) : [empty('Import a reviewed source to create the first retained edition.')]));
}
async function openEdition(id) {
  selectedEdition = await api('/api/versions/' + encodeURIComponent(id));
  editions.set(id,selectedEdition);
  $('edition-panel').hidden = false;
  $('edition-facts').replaceChildren(make('h3', selectedEdition.dataset?.name || 'Dataset edition'),
    facts([['Rows',selectedEdition.row_count],['Retained table',selectedEdition.qualified_table],
      ['Created',selectedEdition.created_at],['Source snapshot',selectedEdition.dataset?.snapshot],
      ['Keys',selectedEdition.mapping.keys.join(', ') || 'Original row order']]));
  $('edition-json').textContent = JSON.stringify(selectedEdition,null,2);
  $('edition-meanings').replaceChildren(meanings(selectedEdition));
  $('download-semantics').hidden = selectedEdition.semantics_status !== 'RETAINED';
  rowsAfter = 0; rowBack = []; nextRow = null; $('edition-rows').replaceChildren(empty('Opening retained rows…')); await showRows(); renderEditions();
  for (const key of ['view-version','compare-previous','compare-current']) fillSelect($(key));
}
async function showRows(after = rowsAfter) {
  const page = await api('/api/rows?version_id=' + encodeURIComponent(selectedEdition.version_id) + '&after=' + after + '&limit=50&include_original=true');
  rowsAfter = after; nextRow = page.next_after;
  const columns = selectedEdition.mapping.columns;
  const rows = page.rows.map(row => {
    const original = make('details'); original.append(make('summary','Original JSON'),make('pre',row.original_json));
    return [row.row_number, ...columns.map(column => row.values[column.column]), original];
  });
  $('edition-rows').replaceChildren(rows.length ? table(['Row',...columns.map(column => column.column),'Original source'],rows) : empty('This retained edition has no rows.'));
  $('rows-label').textContent = rows.length ? 'Rows ' + page.rows[0].row_number + '–' + page.rows.at(-1).row_number + ' of ' + selectedEdition.row_count : '0 rows';
}

let historyName = null;
function invalidateView() {
  viewReview = null; $('view-review').hidden = true; historyName = null;
  historyRows = []; historyBefore = null; $('view-history').replaceChildren(); $('more-history').hidden = true;
  controls();
}
function renderViews() {
  $('view-list').replaceChildren(...(state.warehouse.views.length ? state.warehouse.views.map(record => {
    const item = button('', async () => {
      if (!editions.has(record.version_id)) editions.set(record.version_id, await api('/api/versions/' + record.version_id));
      fillSelect($('view-version')); $('view-name').value = record.name; $('view-version').value = record.version_id;
      await reviewView();
    }); item.className = 'item';
    item.append(make('span',record.name + ' · revision ' + record.revision,'item-title'),
      make('span',record.version_id,'item-sub mono')); return item;
  }) : [empty('Create a named SQL view by selecting a retained edition below.')]));
}
async function reviewView() {
  const name = $('view-name').value, versionId = $('view-version').value;
  if (!name || !versionId) throw new Error('Enter a view name and choose its retained edition.');
  const current = await api('/api/current?name=' + encodeURIComponent(name));
  const target = await api('/api/versions/' + versionId);
  editions.set(versionId, target);
  let meaningComparison = null;
  if (current.version && current.version.semantics_status !== 'SOURCE_REQUIRED' &&
      target.semantics_status !== 'SOURCE_REQUIRED') {
    meaningComparison = await api('/api/semantic-compare?previous=' + current.version.version_id +
                                  '&current=' + versionId);
  }
  const history = await api('/api/history?name=' + encodeURIComponent(name) + '&limit=50');
  if ($('view-name').value !== name || $('view-version').value !== versionId)
    throw new Error('The selected view or edition changed. Review the current choice again.');
  viewReview = {name,version_id:versionId,expected_revision:current.revision,current,target};
  historyName = name; historyRows = history.history; historyBefore = history.next_before;
  $('view-review').hidden = false;
  $('view-facts').replaceChildren(facts([
    ['Stable SQL view',current.qualified_view],['Current revision',current.revision],
    ['Current edition',current.version ? editionLabel(current.version) : 'No view yet'],
    ['Selected edition',editionLabel(target)],['Complete rows',target.row_count],
  ]),table(['Database column','PostgreSQL type'],target.mapping.columns.map(column => [column.column,column.type])));
  $('view-meanings').replaceChildren(meanings(target));
  $('view-meaning-comparison').replaceChildren(...(meaningComparison ? [renderMeaningComparison(meaningComparison)] : []));
  $('activate-view').textContent = current.version?.version_id === versionId ? 'Keep this selected edition' : 'Select this edition';
  renderHistory();
}
function renderHistory() {
  $('more-history').hidden = !historyBefore;
  $('view-history').replaceChildren(make('h3','Saved selection history'),
    historyRows.length ? table(['Revision','Selected at','Edition','Action'],historyRows.map(row =>
      [row.revision,row.activated_at,row.version_id,button('Review this edition',async () => {
        if (!editions.has(row.version_id)) editions.set(row.version_id,await api('/api/versions/' + row.version_id));
        fillSelect($('view-version')); $('view-name').value = historyName; $('view-version').value = row.version_id;
        await reviewView();
        $('view-review').scrollIntoView({block:'nearest'});
      })])) : empty('The first selection will create its history entry.'));
}
async function activateView() {
  if (!viewReview) throw new Error('Review the current view and selected edition first.');
  const saved = viewReview;
  if (!Number.isSafeInteger(saved.expected_revision)) throw new Error('The database revision cannot be represented by this browser.');
  const result = await request('/api/activate', {
    name:saved.name,version_id:saved.version_id,expected_revision:saved.expected_revision,
  });
  $('view-name').value = saved.name; $('view-version').value = saved.version_id;
  await reviewView();
  message('The original view selection is ' + result.result.status.toLowerCase() + ' at revision ' + result.result.revision + '.');
}
async function useEdition() {
  if (!selectedEdition) return;
  fillSelect($('view-version')); $('view-version').value = selectedEdition.version_id;
  invalidateView(); show('views'); $('view-name').focus();
}
async function compareMeanings() {
  const previous = $('compare-previous').value, current = $('compare-current').value;
  if (!previous || !current) throw new Error('Choose two retained editions.');
  const result = await api('/api/semantic-compare?previous=' + previous + '&current=' + current);
  $('compare-meaning-result').replaceChildren(renderMeaningComparison(result));
}
async function compareEditions(offset = 0) {
  if (!comparison) throw new Error('Choose the two retained editions.');
  const result = await api('/api/compare?previous=' + comparison.previous + '&current=' + comparison.current + '&offset=' + offset + '&limit=50');
  compareOffset = offset; compareNext = result.next_offset;
  const totals = make('div',undefined,'metric-grid');
  for (const kind of ['ADDED','REMOVED','CHANGED','UNCHANGED']) {
    const metric = make('div',undefined,'metric'); metric.append(make('strong',result.totals[kind]),make('span',kind.toLowerCase())); totals.append(metric);
  }
  const rows = result.changes.map(change => [
    change.kind,change.before_row,change.after_row,
    change.before === null ? null : make('pre',JSON.stringify(change.before,null,2)),
    change.after === null ? null : make('pre',JSON.stringify(change.after,null,2)),
  ]);
  $('compare-result').replaceChildren(totals,
    rows.length ? table(['Change','Previous row','Following row','Previous values','Following values'],rows) :
      empty('Every compared row is unchanged.'),
    details('Complete comparison page',result));
  $('compare-back').hidden = !compareBack.length; $('compare-next').hidden = compareNext === null;
  $('compare-label').textContent = rows.length ? 'Changes ' + (offset + 1) + '–' + (offset + rows.length) : '';
}
function renderRequests() {
  $('more-requests').hidden = !requestBefore;
  const local = pending();
  for (const record of requestRows) if (record.state === 'COMPLETE' && local[record.record_id]) {
    delete local[record.record_id]; keepPending(record.record_id,null);
  }
  const known = new Set(requestRows.map(record => record.record_id));
  const rows = requestRows.map(record => {
    const item = make('div',undefined,'item');
    item.append(make('span',(record.route === '/api/import' ? 'Import edition' : 'Select application view') + ' · ' + record.state.toLowerCase(),'item-title'),
      make('span',record.created_at,'item-sub'));
    if (record.body.name) item.append(make('span',record.body.name,'item-sub'));
    if (record.error) item.append(make('p',errorText({payload:record.error}), 'hint'));
    const actions = make('div',undefined,'record-actions');
    actions.append(button('Open saved result',async () => renderRequest(await api('/api/requests/' + record.record_id))));
    if (record.state !== 'COMPLETE') actions.append(button('Recover original operation',() => resume(record.record_id)));
    item.append(actions); return item;
  });
  for (const [id, value] of Object.entries(local)) if (!known.has(id)) {
    const item = make('div',undefined,'item');
    item.append(make('span','Browser request awaiting receiving state','item-title'),
      make('span',id,'item-sub mono'),button('Recover original request',() => resume(id,value)));
    rows.unshift(item);
  }
  $('request-list').replaceChildren(...(rows.length ? rows : [empty('Saved imports and application view selections will appear here.')]));
}
function renderRequest(record) {
  $('request-panel').hidden = false; show('recovery');
  $('request-details').replaceChildren(make('h3',record.route === '/api/import' ? 'Dataset import' : 'Application view selection'),
    facts([['State',record.state],['Created',record.created_at],['Updated',record.updated_at],
      ['Original request',record.record_id],['Warehouse',record.warehouse_id]]));
  if (record.error) $('request-details').append(make('p',errorText({payload:record.error}),'notice'));
  if (record.result) {
    const value = record.result;
    $('request-details').append(facts([['Outcome',value.import_status || value.status],['Edition',value.version_id || value.version?.version_id],
      ['View',value.qualified_view],['Original selection revision',value.revision]]));
    if (value.observed_current) $('request-details').append(make('p',
      'Recovered the saved selection from its history. The current view remains at revision ' + value.observed_current.revision + '.','hint'));
  }
  $('request-details').append(details('Complete original request and result',record));
  if (record.state !== 'COMPLETE') $('request-details').append(button('Recover original operation',() => resume(record.record_id)));
}

for (const node of document.querySelectorAll('.nav')) node.addEventListener('click',() => show(node.dataset.screen));
$('refresh').addEventListener('click',() => run(refresh));
$('source-form').addEventListener('submit',event => {event.preventDefault();run(inspectSource);});
$('mapping-form').addEventListener('submit',event => {event.preventDefault();run(saveReview);});
$('report-path').addEventListener('input',() => {source = null;$('source-panel').hidden = true;});
$('import-review').addEventListener('click',() => run(importReview));
$('more-reviews').addEventListener('click',() => run(async () => {
  const page = await api('/api/reviews?before=' + encodeURIComponent(reviewBefore) + '&limit=50');
  reviewRows.push(...page.reviews); reviewBefore = page.next_before; renderReviews();
}));
$('more-editions').addEventListener('click',() => run(async () => {
  const page = await api('/api/versions?before=' + versionBefore + '&limit=50');
  versionRows.push(...page.versions); versionBefore = page.next_before; remember(page.versions); renderEditions();
  for (const id of ['view-version','compare-previous','compare-current']) fillSelect($(id));
}));
$('rows-next').addEventListener('click',() => run(async () => {
  if (nextRow === null) return;
  const previous = rowsAfter; await showRows(nextRow); rowBack.push(previous);
}));
$('rows-previous').addEventListener('click',() => run(async () => {
  if (!rowBack.length) return;
  await showRows(rowBack.at(-1)); rowBack.pop();
}));
for (const [id, route, prefix] of [
  ['download-manifest','manifest','manifest'],['download-mapping','mapping','postgres-mapping'],['download-edition','edition','postgres-edition'],
  ['download-semantics','semantics-file','semantics'],
]) $(id).addEventListener('click',() => run(() => download('/api/' + route + '?version_id=' + selectedEdition.version_id,prefix + '-' + selectedEdition.version_id + '.json')));
$('use-edition').addEventListener('click',() => run(useEdition));
$('view-name').addEventListener('input',invalidateView);
$('view-version').addEventListener('change',invalidateView);
$('view-form').addEventListener('submit',event => {event.preventDefault();run(reviewView);});
$('activate-view').addEventListener('click',() => run(activateView));
$('more-history').addEventListener('click',() => run(async () => {
  const page = await api('/api/history?name=' + encodeURIComponent(historyName) + '&before=' + historyBefore + '&limit=50');
  historyRows.push(...page.history); historyBefore = page.next_before; renderHistory();
}));
function invalidateComparison() {
  comparison = null; compareBack = []; compareNext = null;
  $('compare-result').replaceChildren(); $('compare-meaning-result').replaceChildren(); $('compare-label').textContent = '';
  $('compare-back').hidden = $('compare-next').hidden = true; controls();
}
$('compare-previous').addEventListener('change',invalidateComparison);
$('compare-current').addEventListener('change',invalidateComparison);
$('compare-meanings').addEventListener('click', () => run(compareMeanings));
$('mapping-rows').addEventListener('change', () => {
  if (source) $('source-meanings').replaceChildren(meanings(source, mapping()));
});
$('compare-form').addEventListener('submit',event => {
  event.preventDefault(); run(async () => {
    comparison = {previous:$('compare-previous').value,current:$('compare-current').value};
    if (!comparison.previous || !comparison.current) throw new Error('Choose two retained editions.');
    compareBack = []; compareNext = null;
    $('compare-result').replaceChildren(empty('Comparing complete retained editions…'));
    try { await compareMeanings(); }
    catch (error) { $('compare-meaning-result').replaceChildren(make('p',errorText(error),'notice')); }
    await compareEditions(0);
  });
});
$('compare-next').addEventListener('click',() => run(async () => {
  if (compareNext === null) return;
  const previous = compareOffset; await compareEditions(compareNext); compareBack.push(previous);
  $('compare-back').hidden = false;
}));
$('compare-back').addEventListener('click',() => run(async () => {
  if (!compareBack.length) return;
  await compareEditions(compareBack.at(-1)); compareBack.pop(); $('compare-back').hidden = !compareBack.length;
}));
$('more-requests').addEventListener('click',() => run(async () => {
  const page = await api('/api/requests?before=' + encodeURIComponent(requestBefore) + '&limit=50');
  requestRows.push(...page.requests); requestBefore = page.next_before; renderRequests();
}));
run(refresh);
"""
