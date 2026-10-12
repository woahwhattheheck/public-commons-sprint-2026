"""Neutral local operator assets for acquired DuckDB datasets."""
from . import _spatial_ui

HTML = r"""<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dataset workspace · Stellar Forge</title><link rel="stylesheet" href="/style.css"></head>
<body>
<header class="topbar"><div><span class="brand">STELLAR FORGE</span><h1>Dataset workspace</h1></div><div class="header-actions"><span class="badge">DuckDB · Local</span><button id="refresh">Refresh</button></div></header>
<div class="shell">
<aside class="sidebar"><nav aria-label="Workspace"><button class="nav active" data-screen="sources">Source delivery</button><button class="nav" data-screen="editions">Dataset editions <span id="edition-count">0</span></button><button class="nav" data-screen="query">SQL workspace</button><button class="nav" data-screen="exports">Saved exports <span id="export-count">0</span></button></nav><section class="workspace-info"><h2>Workspace</h2><p id="workspace-path" class="mono wrap">Opening…</p><p id="workspace-meta" class="muted"></p></section></aside>
<main>
<div id="message" class="notice" role="status" aria-live="polite" hidden></div>
<section id="screen-sources" class="screen">
<div class="page-title"><div><h2>Review a source delivery</h2><p>Open an acquired dataset, check its fields, then import a named edition for analysis.</p></div></div>
<section class="panel"><form id="review-form"><label for="delivery-path">Original delivery report</label><div class="inline"><input id="delivery-path" autocomplete="off" spellcheck="false" required placeholder="/absolute/path/to/dataset-delivery.json"><button class="primary" type="submit">Review delivery</button></div><p class="hint">Use the native delivery report retained on this computer.</p></form></section>
<section id="source-review" class="panel" hidden><div class="section-head"><h3>Source review</h3><button id="source-details-toggle" type="button">Source details</button></div><dl id="source-facts" class="facts"></dl><div id="source-details" hidden><pre id="source-record"></pre></div><section id="source-meanings" hidden></section><h3>Column mapping</h3><p class="muted">Choose the SQL column name and storage type. Empty type uses the source type.</p><div class="table-scroll"><table><thead><tr><th>Source field</th><th>SQL column</th><th>DuckDB type</th><th>Allow null</th><th>Sample</th></tr></thead><tbody id="mapping-rows"></tbody></table></div><div id="source-sample" class="table-scroll"></div><form id="import-form" class="stack"><label>Record key columns<input id="source-keys" placeholder="id" autocomplete="off" spellcheck="false"></label><p class="hint">Comma-separated SQL column names that identify a row, if available.</p><div class="inline"><button class="primary" type="submit">Prepare import review</button><span class="muted">The review retains this source and mapping.</span></div><div id="ready-review" hidden><dl id="review-facts" class="facts"></dl><button id="import-reviewed" class="primary" type="button">Import reviewed edition</button></div></form></section>
<div class="empty" id="source-empty"><h3>Start with a delivery you already have</h3><p>The review shows the source fields and a sample before importing. Imported editions appear in the dataset list and can be reopened at any time.</p></div>
<section class="panel"><h3>Saved import reviews</h3><div id="saved-reviews" class="item-list"></div><p id="reviews-empty" class="muted">Prepared reviews remain available here.</p></section>
</section>
<section id="screen-editions" class="screen" hidden>
<div class="page-title"><div><h2>Dataset editions</h2><p>Reopen an edition, select the active view, or compare two deliveries.</p></div><button id="new-delivery">Review another delivery</button></div>
<div class="two-column"><section class="panel"><div class="section-head"><h3>Imported editions</h3><span id="editions-summary" class="muted"></span></div><div id="edition-list" class="item-list"></div><p id="editions-empty" class="muted">Import a source delivery to begin.</p></section>
<section id="edition-detail" class="panel" hidden><div class="section-head"><h3 id="edition-title">Edition</h3><div class="toolbar"><button id="edition-query">Use in SQL</button><button id="edition-source">Export source files</button></div></div><dl id="edition-facts" class="facts"></dl><section id="edition-meanings" hidden></section><div class="table-scroll"><table><thead><tr><th>SQL column</th><th>Type</th><th>Source field</th></tr></thead><tbody id="edition-columns"></tbody></table></div><form id="activate-form" class="stack"><label>Active view name<input id="view-name" required maxlength="64" autocomplete="off" spellcheck="false" placeholder="current_activity"></label><div class="inline"><button class="primary" type="submit">Activate this edition</button><span id="activation-info" class="muted"></span></div></form><details><summary>Source and import details</summary><pre id="edition-record"></pre></details></section></div>
<section class="panel"><div class="section-head"><h3>Compare editions</h3><span class="muted">Review schema and row changes</span></div><form id="compare-form"><div class="form-grid"><label>Baseline edition<select id="compare-base" required></select></label><label>Candidate edition<select id="compare-candidate" required></select></label></div><label>Key columns<input id="compare-keys" placeholder="id" spellcheck="false" autocomplete="off"></label><p class="hint">Comma-separated SQL columns used to match records.</p><div class="toolbar"><button type="submit">Compare rows</button><button id="compare-meanings" type="button">Compare definitions</button></div></form><div id="comparison" hidden><section id="comparison-meanings" hidden></section><div id="comparison-summary" class="metric-grid"></div><div id="comparison-schema"></div><div id="comparison-table" class="table-scroll"></div><details><summary>Comparison details</summary><pre id="comparison-record"></pre></details></div></section>
</section>
<section id="screen-query" class="screen" hidden>
<div class="page-title"><div><h2>SQL workspace</h2><p>Query the imported editions and active views. Save a query to reopen it later.</p></div></div>
<div class="query-layout"><aside class="panel query-catalog"><h3>Available tables</h3><div id="query-tables" class="item-list compact"></div><h3>Saved queries</h3><div id="query-saved" class="item-list compact"></div></aside><div>
<section class="panel"><form id="query-form"><label for="sql">SQL query</label><textarea id="sql" rows="10" spellcheck="false" placeholder="SELECT * FROM current_activity LIMIT 100"></textarea><div class="form-grid"><label>Parameters (JSON array)<input id="query-parameters" value="[]" spellcheck="false" autocomplete="off"></label><label>Preview rows<input id="query-limit" type="number" min="1" max="10000" value="100"></label></div><div class="toolbar"><button class="primary" type="submit">Run preview</button><button id="export-query" type="button">Export Parquet + CSV</button><button id="export-source" type="button">Prepare workspace handoff</button></div></form><hr><form id="save-query-form"><label>Query name<input id="query-name" required maxlength="64" placeholder="monthly_totals" autocomplete="off" spellcheck="false"></label><div class="inline"><button type="submit">Save query</button><span id="query-revision" class="muted"></span></div></form></section>
<section id="query-result" class="panel" hidden><div class="section-head"><h3>Preview result</h3><span id="result-summary" class="muted"></span></div><div id="result-table" class="table-scroll"></div><p id="result-limit" class="hint"></p><section id="query-meanings" hidden></section><details><summary>Result details</summary><pre id="query-result-record"></pre></details></section>
</div></div>
</section>
<section id="screen-exports" class="screen" hidden>
<div class="page-title"><div><h2>Saved exports</h2><p>Reopen an export and download its data with the original source and query details.</p></div><button id="exports-to-query">Open SQL workspace</button></div>
<section id="pending-operations-panel" class="panel" hidden><h3>Continue a saved operation</h3><p class="muted">An interrupted request reopens its original export or handoff.</p><div id="pending-operations" class="item-list"></div></section><div class="two-column"><section class="panel"><h3>Export history</h3><div id="export-list" class="item-list"></div><p id="exports-empty" class="muted">Run a query export to create the first saved result.</p></section><section id="export-detail" class="panel" hidden><div class="section-head"><h3 id="export-title">Export</h3><button id="export-reopen-query">Reopen query</button></div><dl id="export-facts" class="facts"></dl>
<section id="export-schema" hidden><h3>Parquet column types</h3><p class="hint">SQL types describe the saved query. File types describe the downloaded Parquet data.</p><div id="export-columns" class="table-scroll export-types"></div><details id="export-read-types" hidden><summary>Read the original SQL types</summary><p class="hint">Run this query with the downloaded result.parquet to restore the saved query's column types.</p><pre id="export-read-sql"></pre></details></section><section id="export-meanings" hidden></section><h3>Files</h3><div id="export-files" class="item-list"></div><details><summary>Query and source details</summary><pre id="export-record"></pre></details></section></div>
</section>
<footer>Stellar Forge dataset operator</footer>
</main></div>
<script src="/app.js"></script></body></html>"""

CSS = r""":root{color-scheme:light;--ink:#24292f;--muted:#57606a;--line:#d0d7de;--paper:#fff;--ground:#f4f5f6;--selected:#eaecef}*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select,textarea{font:inherit}button{border:1px solid #afb8c1;border-radius:4px;background:#fff;color:var(--ink);padding:7px 12px;cursor:pointer;font-weight:600;white-space:nowrap}button:hover{background:#eceef0}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #57606a;outline-offset:2px}button:disabled{opacity:.5;cursor:wait}.primary{background:var(--ink);color:#fff;border-color:var(--ink)}.primary:hover{background:#424a53}input,textarea,select{width:100%;border:1px solid #afb8c1;border-radius:4px;background:#fff;color:var(--ink);padding:8px}textarea{resize:vertical}textarea#sql,.mono,code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}label{display:block;font-size:13px;font-weight:600;margin:12px 0 6px}label input,label select{display:block;margin-top:5px}h1,h2,h3,p{margin:0}h1{font-size:20px;letter-spacing:-.35px;margin-top:2px}h2{font-size:22px;letter-spacing:-.3px}h3{font-size:15px;margin-bottom:10px}.topbar{min-height:83px;border-bottom:1px solid var(--line);background:#fff;padding:15px 28px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-size:10px;letter-spacing:1.6px;font-weight:750;color:var(--muted)}.header-actions,.inline,.toolbar{display:flex;align-items:center;gap:10px}.badge{font-size:12px;border:1px solid var(--line);border-radius:4px;padding:4px 9px;color:var(--muted);background:#fafbfc}.shell{display:grid;grid-template-columns:222px minmax(0,1fr);min-height:calc(100vh - 83px)}.sidebar{border-right:1px solid var(--line);padding:20px 14px;background:#fafbfc}.sidebar nav{display:grid;gap:5px}.nav{width:100%;text-align:left;display:flex;justify-content:space-between;align-items:center;border-color:transparent;background:transparent;font-size:13px;padding:10px}.nav.active{background:var(--selected);border-color:var(--line)}.nav span{font-size:11px;font-weight:500}.workspace-info{border-top:1px solid var(--line);margin:25px 7px 0;padding-top:17px}.workspace-info h2{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);margin-bottom:8px}.workspace-info p{font-size:11px;line-height:1.6;margin-top:4px}.wrap{overflow-wrap:anywhere}main{min-width:0;max-width:1700px;padding:26px 30px}.page-title{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}.page-title p{color:var(--muted);margin-top:5px}.panel{background:#fff;border:1px solid var(--line);border-radius:5px;padding:20px;margin-bottom:18px;min-width:0}.panel h3:not(:first-child){margin-top:20px}.section-head{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:12px}.section-head h3{margin:0}.inline input{flex:1;min-width:0}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.stack{margin-top:20px}.toolbar{flex-wrap:wrap;margin-top:16px}.hint,.muted{color:var(--muted);font-size:12px}.hint{margin:7px 0 12px}.facts{display:grid;grid-template-columns:minmax(110px,auto) minmax(0,1fr);gap:6px 16px;margin:12px 0 18px;font-size:13px}.facts dt{color:var(--muted)}.facts dd{margin:0;overflow-wrap:anywhere}.table-scroll{max-width:100%;overflow:auto;max-height:490px;border:1px solid var(--line);border-radius:4px;margin-top:12px}table{border-collapse:collapse;min-width:100%;font-size:12px;text-align:left}th{font-weight:600;background:#f6f7f8;position:sticky;top:0;z-index:1;color:#424a53}th,td{padding:9px 12px;border-bottom:1px solid #e5e7e9;vertical-align:top}th{white-space:nowrap}td{max-width:400px;overflow-wrap:anywhere}tr:last-child td{border-bottom:0}td input,td select{min-width:130px;font-size:12px;padding:5px}td code{font-size:11px}.empty{padding:36px 24px;text-align:center;border:1px dashed var(--line);border-radius:5px;color:var(--muted)}.empty h3{color:var(--ink)}.empty p{max-width:560px;margin:auto}.two-column{display:grid;grid-template-columns:minmax(260px,.8fr) minmax(360px,1.2fr);gap:20px;align-items:start}.item-list{display:grid;gap:8px}.item{display:block;width:100%;text-align:left;padding:12px;border:1px solid var(--line);border-radius:4px;background:#fff;white-space:normal}.item.selected{background:#f0f2f4;border-color:#8c959f}.item-title{font-weight:600;display:block;overflow-wrap:anywhere}.item-sub{display:block;font-size:11px;color:var(--muted);margin-top:3px;font-weight:400;overflow-wrap:anywhere}.compact .item{font-size:12px;padding:8px}.query-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:20px;align-items:start}.query-catalog h3{font-size:12px}.query-catalog h3:not(:first-child){margin-top:24px}.notice{background:#fff;border:1px solid #8c959f;border-left:4px solid #57606a;border-radius:4px;padding:12px 16px;margin-bottom:20px;overflow-wrap:anywhere}.notice[data-level=error]{border-left-width:6px;background:#f3f3f3;font-weight:600}.export-types td:nth-child(2),.export-types td:nth-child(3){white-space:nowrap}details{margin-top:17px;border-top:1px solid #e5e7e9;padding-top:12px}summary{cursor:pointer;font-size:12px;color:var(--muted)}pre{font-size:11px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;max-height:330px;overflow:auto;margin:10px 0 0;background:#f6f7f8;padding:12px;border-radius:4px}hr{border:0;border-top:1px solid var(--line);margin:22px 0 10px}.metric-grid{display:flex;flex-wrap:wrap;gap:20px;margin:20px 0 12px}.metric{min-width:100px}.metric strong{display:block;font-size:23px;font-weight:600}.metric span{font-size:11px;color:var(--muted)}footer{font-size:10px;color:#6e7781;padding:10px 0 18px;letter-spacing:.3px}[hidden]{display:none!important}@media(max-width:1100px){main{padding:20px}.query-layout{grid-template-columns:190px minmax(0,1fr)}.two-column{grid-template-columns:1fr}.shell{grid-template-columns:185px minmax(0,1fr)}}@media(max-width:760px){.topbar{padding:14px 16px}.badge{display:none}.shell{display:block}.sidebar{border-right:0;border-bottom:1px solid var(--line);padding:8px}.sidebar nav{grid-template-columns:repeat(4,1fr);gap:2px}.nav{font-size:11px;padding:9px 5px;text-align:center;justify-content:center;white-space:normal}.nav span,.workspace-info{display:none}main{padding:18px 12px}.page-title{align-items:flex-start;flex-direction:column}h2{font-size:21px}.query-layout{display:block}.query-catalog{display:grid;grid-template-columns:1fr 1fr;gap:12px}.query-catalog h3{display:none}.form-grid{grid-template-columns:1fr;gap:0}.panel{padding:16px}.inline{flex-wrap:wrap}.inline input{flex-basis:100%}.toolbar button{flex:1;font-size:12px}.facts{grid-template-columns:100px 1fr;gap:7px}.topbar h1{font-size:18px}}
input[type=checkbox]{width:16px;min-width:16px;height:16px;margin:0;accent-color:#424a53}
"""

JS = r"""'use strict';
const $ = function(id) { return document.getElementById(id); };
const state = {data:null,source:null,review:null,edition:null,query:null,export:null,lastPreview:null,busy:false,pending:{},pendingKey:null};
let capability = location.hash.slice(1);
try { if(capability) sessionStorage.setItem('stellar_duckdb_capability',capability); else capability=sessionStorage.getItem('stellar_duckdb_capability')||''; } catch(error) {}
if(location.hash) history.replaceState(null,'',location.pathname);
function element(tag,text,cls) { const item=document.createElement(tag); if(text!==undefined) item.textContent=String(text); if(cls) item.className=cls; return item; }
function text(value) { if(value===null||value===undefined) return ''; if(typeof value==='object' && 'text' in value && 'type' in value) return value.type==='null'?'NULL':String(value.text); if(typeof value==='object') return JSON.stringify(value); return String(value); }
function pretty(value) { return JSON.stringify(value,null,2); }
function notice(message,level) { $('message').textContent=message; $('message').dataset.level=level||'info'; $('message').hidden=!message; }
function short(value) { const string=text(value); return string.length>20?string.slice(0,12)+'…'+string.slice(-6):string; }
function count(value) { return typeof value==='number'?value.toLocaleString():text(value); }
function timestamp(value) { if(!value) return ''; const date=new Date(value); return Number.isNaN(date.getTime())?text(value):date.toLocaleString(); }
function pendingStorageKey() { return 'stellar_duckdb_pending:'+state.data.directory; }
function storePending() { try{localStorage.setItem(pendingStorageKey(),JSON.stringify(state.pending));}catch(error){} }
function reconcilePending() {
  const key=pendingStorageKey();
  if(state.pendingKey!==key) {state.pendingKey=key;try{state.pending=JSON.parse(localStorage.getItem(key)||'{}');}catch(error){state.pending={};}if(!state.pending||typeof state.pending!=='object'||Array.isArray(state.pending)) state.pending={};}
  (state.data.operations||[]).forEach(function(operation){if(operation.state==='COMPLETE') delete state.pending[operation.request_id];});
  storePending();
}
function operationName(route) { return route==='/api/spatial/exports'?'GIS query export':route==='/api/exports'?'Query export':route==='/api/source-handoffs'?'Edition source files':'Workspace handoff'; }
function pendingOperations() {
  const values=new Map();
  (state.data.operations||[]).filter(function(operation){return operation.state!=='COMPLETE';}).forEach(function(operation){values.set(operation.request_id,operation);});
  Object.values(state.pending).forEach(function(operation){if(operation&&operation.request_id&&!values.has(operation.request_id)) values.set(operation.request_id,operation);});
  return Array.from(values.values());
}
function requestMeaning(route,body) {
  if(route==='/api/spatial/exports') return JSON.stringify([route,body.query_id,body.expected_revision,body.geometry_column||'geometry',body.target_crs||null,body.expected_bindings||null]);
  return route==='/api/exports'?route+':'+body.query_id+':'+body.expected_revision:route==='/api/source-handoffs'?route+':'+body.edition_id:route;
}
async function retainedAction(route,body) {
  const meaning=requestMeaning(route,body);
  const previous=pendingOperations().find(function(operation){return operation.route===route&&operation.body&&requestMeaning(route,operation.body)===meaning;});
  const request=previous?previous.body:Object.assign({},body,{request_id:Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function(value){return value.toString(16).padStart(2,'0');}).join('')});
  state.pending[request.request_id]={request_id:request.request_id,route:route,body:request,state:'PREPARED',created_at:previous?previous.created_at:new Date().toISOString()};
  storePending();
  if(previous) notice('Continuing the saved '+operationName(route).toLowerCase()+'…');
  try {
    const result=await api(route,request);
    delete state.pending[request.request_id];storePending();return result;
  } catch(error) {
    state.pending[request.request_id].state='INTERRUPTED';storePending();render();show('exports');throw error;
  }
}
function keyList(value) { return value.split(',').map(function(item){return item.trim();}).filter(Boolean); }
function sqlName(value) { return '"'+String(value).replaceAll('"','""')+'"'; }
function records(value,key) { return Array.isArray(value)?value:(value&&Array.isArray(value[key])?value[key]:[]); }
async function api(path,body) {
  const options={method:body===undefined?'GET':'POST',headers:{'X-DuckDB-Capability':capability},cache:'no-store'};
  if(body!==undefined) { options.headers['Content-Type']='application/json'; options.body=JSON.stringify(body); }
  let response;
  try { response=await fetch(path,options); } catch(error) { throw new Error('The local workspace could not be reached. Keep its server running and refresh.'); }
  let result;
  try { result=await response.json(); } catch(error) { throw new Error('The workspace returned an unreadable response.'); }
  if(!response.ok) {
    if(response.status===403) throw new Error('Open the private launch link for this workspace again.');
    throw new Error(result.detail?(result.error+'\n'+result.detail):(result.error||('Workspace request failed ('+response.status+').')));
  }
  return result;
}
async function run(label,operation) {
  if(state.busy) return;
  state.busy=true;
  document.querySelectorAll('button').forEach(function(button){button.disabled=true;});
  notice(label+'…');
  try { await operation(); }
  catch(error) { notice(error.message||String(error),'error'); }
  finally { state.busy=false; document.querySelectorAll('button').forEach(function(button){button.disabled=false;}); }
}
function bind(id,label,operation) { $(id).addEventListener('click',function(event){event.preventDefault();run(label,operation);}); }
function submit(id,label,operation) { $(id).addEventListener('submit',function(event){event.preventDefault();run(label,operation);}); }
function show(screen) {
  document.querySelectorAll('.screen').forEach(function(item){item.hidden=item.id!=='screen-'+screen;});
  document.querySelectorAll('.nav').forEach(function(item){item.classList.toggle('active',item.dataset.screen===screen);});
  try { sessionStorage.setItem('stellar_duckdb_screen',screen); } catch(error) {}
}
function fact(container,label,value) {
  if(value===undefined||value===null||value==='') return;
  container.append(element('dt',label),element('dd',text(value)));
}
function table(container,columns,rows) {
  container.replaceChildren();
  if(!columns.length) { container.append(element('p','No tabular rows to display.','hint')); return; }
  const grid=element('table'), head=element('thead'), header=element('tr'), body=element('tbody');
  columns.forEach(function(column){const name=typeof column==='string'?column:column.name||column.column||column.source;const th=element('th',name);if(column.type) th.title=column.type;header.append(th);});
  head.append(header); grid.append(head,body);
  rows.forEach(function(row){
    const tr=element('tr');
    columns.forEach(function(column,index){const name=typeof column==='string'?column:column.name||column.column||column.source;const value=Array.isArray(row)?row[index]:row[name];const td=element('td',value===null?'NULL':text(value));if(value===null) td.className='muted';tr.append(td);});
    body.append(tr);
  });
  if(!rows.length) { const tr=element('tr'),td=element('td','No rows matched this query.','muted');td.colSpan=columns.length;tr.append(td);body.append(tr); }
  container.append(grid);
}
function item(container,title,subtitle,action,selected) {
  const button=element('button',undefined,'item'+(selected?' selected':''));
  button.type='button';button.append(element('span',title,'item-title'));
  if(subtitle) button.append(element('span',subtitle,'item-sub'));
  button.addEventListener('click',action);container.append(button);return button;
}
function editionLabel(edition) { return 'Edition '+(edition.sequence||short(edition.edition_id))+' · '+count(edition.row_count)+' rows'; }
function fillEditionSelect(id,editions) {
  const select=$(id), previous=select.value;select.replaceChildren(element('option','Choose an edition'));
  select.firstChild.value='';
  editions.forEach(function(edition){const option=element('option',editionLabel(edition));option.value=edition.edition_id;select.append(option);});
  if(editions.some(function(edition){return edition.edition_id===previous;})) select.value=previous;
}
function activeView(name) { return (state.data.views||[]).find(function(view){return view.name.toLowerCase()===name.toLowerCase();}); }
function queryChanged() { state.lastPreview=null; }
function render() {
  const data=state.data, editions=data.editions||[], exports=(data.exports||[]).concat(data.handoffs||[]).sort(function(a,b){return (b.completed_at||b.created_at||'').localeCompare(a.completed_at||a.created_at||'');});
  $('workspace-path').textContent=data.directory||'Local workspace';
  $('workspace-meta').textContent=count(editions.length)+' editions · '+count((data.views||[]).length)+' active views';
  $('edition-count').textContent=count(editions.length);$('export-count').textContent=count(exports.length);
  $('editions-summary').textContent=data.next_before?'Latest '+editions.length:editions.length+' total';
  $('edition-list').replaceChildren();$('editions-empty').hidden=editions.length>0;
  editions.forEach(function(edition){item($('edition-list'),editionLabel(edition),timestamp(edition.created_at)+' · '+short(edition.edition_id),function(){run('Opening edition',async function(){await selectEdition(edition.edition_id);notice('Edition opened.');});},state.edition&&state.edition.edition_id===edition.edition_id);});
  if(data.next_before!==null && data.next_before!==undefined) item($('edition-list'),'Load earlier editions','',function(){run('Loading earlier editions',async function(){const page=await api('/api/editions?before='+encodeURIComponent(data.next_before)+'&limit=100');const known=new Set(data.editions.map(function(e){return e.edition_id;}));data.editions=data.editions.concat(records(page,'editions').filter(function(e){return !known.has(e.edition_id);}));data.next_before=page.next_before;render();notice('Earlier editions loaded.');});});
  fillEditionSelect('compare-base',editions);fillEditionSelect('compare-candidate',editions);
  $('query-tables').replaceChildren();
  (data.views||[]).forEach(function(view){item($('query-tables'),view.name,'Active view · revision '+view.revision,function(){useTable(view.name);});});
  editions.forEach(function(edition){item($('query-tables'),editionLabel(edition),short(edition.table),function(){useTable(edition.table);});});
  if(!editions.length) $('query-tables').append(element('p','Import an edition to query it.','muted'));
  $('query-saved').replaceChildren();
  (data.queries||[]).forEach(function(query){item($('query-saved'),query.name,'Revision '+query.revision,function(){run('Opening saved query',async function(){loadQuery(await api('/api/queries/'+encodeURIComponent(query.query_id)));notice('Saved query reopened.');});});});
  if(!(data.queries||[]).length) $('query-saved').append(element('p','Save a query from the editor.','muted'));
  $('saved-reviews').replaceChildren();$('reviews-empty').hidden=(data.reviews||[]).length>0;
  (data.reviews||[]).forEach(function(review){item($('saved-reviews'),count(review.row_count)+' rows · '+short(review.review_id),review.report_path||'',function(){run('Opening import review',async function(){const full=await api('/api/reviews/'+encodeURIComponent(review.review_id));await reopenReview(full);notice('Saved review opened.');});});});
  $('pending-operations').replaceChildren();
  const pending=pendingOperations();$('pending-operations-panel').hidden=!pending.length;
  pending.forEach(function(operation){item($('pending-operations'),'Continue '+operationName(operation.route).toLowerCase(),timestamp(operation.created_at)+(operation.state==='RUNNING'?' · In progress':' · Saved request'),function(){run('Continuing saved operation',async function(){const result=await retainedAction(operation.route,operation.body);await refresh();await selectExport(result.export_id);notice('Saved operation completed.');});});});
  $('export-list').replaceChildren();$('exports-empty').hidden=exports.length>0;
  exports.forEach(function(record){item($('export-list'),record.kind==='source-handoff'?'Portable workspace handoff':record.kind==='edition-source'?'Original edition source files':(record.query&&record.query.name)||'Query export',timestamp(record.created_at)+' · '+short(record.export_id),function(){run('Opening saved export',async function(){await selectExport(record.export_id);notice('Saved export opened.');});},state.export&&state.export.export_id===record.export_id);});
  updateActivation();
  if(window.stellarDuckDBSpatialRender) window.stellarDuckDBSpatialRender();
}
async function refresh() { state.data=await api('/api/state');reconcilePending();render(); }
function useTable(name) { $('sql').value='SELECT * FROM '+sqlName(name);state.lastPreview=null;show('query');$('sql').focus();notice('Table selected in the SQL editor.'); }
function sourceColumns(source) {
  if(Array.isArray(source.default_columns)) return source.default_columns;
  return (source.fields||[]).map(function(field){const value=typeof field==='string'?{source:field,name:field,type:'VARCHAR',nullable:true}:field;return {source:value.source||value.name,name:value.name||value.source,type:value.type||'VARCHAR',nullable:value.nullable!==false};});
}

function sourceMeaningTable(container,descriptor,document,columns,editionId) {
  container.replaceChildren();container.hidden=false;container.append(element('h3','Source definitions'));
  if(!descriptor||!document) {container.append(element('p','This edition has no source dictionary. Its reviewed SQL columns remain available below.','hint'));return;}
  const facts=element('dl',undefined,'facts'),bySource=new Map((columns||[]).map(function(c){return [c.source,c.name];}));
  const primary=document.primaryKey||{},key=primary.projected||[],mappedKey=key.filter(function(name){return bySource.has(name);}).map(function(name){return bySource.get(name);});
  fact(facts,'Definitions',descriptor.definition_sha256);fact(facts,'Capture',descriptor.capture_manifest_sha256);
  fact(facts,'Dictionary file',descriptor.file&&descriptor.file.sha256);fact(facts,'Source key',key.join(', ')||'None declared');
  fact(facts,'SQL key mapping',mappedKey.join(', ')||'No selected key columns');
  fact(facts,'Key coverage',primary.complete&&mappedKey.length===key.length&&key.length?'Complete source key mapped':'Source key is incomplete in this mapping');
  fact(facts,'Observation URI (source fields)',document.aboutUrl&&document.aboutUrl.projected);
  container.append(facts,element('p','Definitions describe the delivered source fields. SQL aliases and types follow the reviewed mapping. Import key checks use the separately selected record keys.','hint'));
  const records=new Map((document.columns||[]).map(function(c){return [c.name,c];})),grid=element('table'),head=element('thead'),hr=element('tr'),body=element('tbody');
  ['Source field','SQL column','Meaning','Definition'].forEach(function(title){hr.append(element('th',title));});head.append(hr);grid.append(head,body);
  (columns||[]).forEach(function(mapping){
    const column=records.get(mapping.source);if(!column)return;
    const definition=column.projectedDefinition||{},row=element('tr'),meaning=element('td'),detail=element('td');
    const label=definition.titles||definition.title||definition.description||(column.dictionary&&column.dictionary.label)||'';
    if(label)meaning.append(element('div',text(label)));
    if(definition.description&&definition.description!==label)meaning.append(element('div',text(definition.description),'hint'));
    meaning.append(element('div',[column.role,column.encoding,definition.datatype||column.type,column.nullable===false?'Required':'Nullable'].filter(Boolean).map(text).join(' · '),'hint'));
    const description=element('details');description.append(element('summary','Open definition'),element('pre',pretty(column)));detail.append(description);
    row.append(element('td',mapping.source),element('td',mapping.name),meaning,detail);body.append(row);
  });
  const scroll=element('div',undefined,'table-scroll');scroll.append(grid);container.append(scroll);
  if((document.virtualColumns||[]).length){const virtual=element('details');virtual.append(element('summary','Virtual source definitions'),element('pre',pretty(document.virtualColumns)));container.append(virtual);}
  if((document.issues||[]).length){const issues=element('details');issues.append(element('summary','Source interpretation notes'),element('pre',pretty(document.issues)));container.append(issues);}
  if(editionId){const button=element('button','Download original dictionary');button.type='button';button.addEventListener('click',function(){run('Downloading source dictionary',async function(){
    const response=await fetch('/api/editions/'+encodeURIComponent(editionId)+'/semantics-file',{headers:{'X-DuckDB-Capability':capability},cache:'no-store'});
    if(!response.ok){let result;try{result=await response.json();}catch{}throw new Error(result&&(result.detail||result.error)||'The source dictionary could not be downloaded.');}
    const blob=await response.blob(),url=URL.createObjectURL(blob),link=element('a');link.href=url;link.download='semantics.json';document.body.append(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url);},10000);notice('Original source dictionary downloaded.');
  });});container.append(button);}
}
function queryMeanings(container,context) {
  container.replaceChildren();container.hidden=!context;if(!context)return;
  container.append(element('h3','Imported source definitions'),element('p','These definitions belong to the imported source editions used by this query. The saved SQL describes calculations and result columns.','hint'));
  if(!context.resolved)container.append(element('p','This query uses a relation whose imported edition could not be resolved automatically.','hint'));
  if(!(context.editions||[]).length){container.append(element('p','No imported source edition was associated with this query.','hint'));return;}
  context.editions.forEach(function(item){
    const row=element('div',undefined,'list-item'),content=element('div'),button=element('button','Open source');
    content.append(element('strong',short(item.edition_id)),element('div',item.semantics?'Definition '+short(item.semantics.definition_sha256):'No source dictionary','hint'));
    if(item.dictionary_file)content.append(element('div','Export file: '+item.dictionary_file,'hint'));
    button.type='button';button.addEventListener('click',function(){run('Opening source edition',async function(){await selectEdition(item.edition_id);});});row.append(content,button);container.append(row);
  });
}
function meaningComparison(result) {
  const container=$('comparison-meanings');container.replaceChildren();container.hidden=!result;if(!result)return;
  container.append(element('h3','Source definition changes'));
  const facts=element('dl',undefined,'facts');
  [['Definition',result.definition_changed],['Source capture',result.capture_changed],['SQL mapping',result.mapping_changed],['Source key',result.primary_key_changed],['Observation URI',result.observation_uri_changed],['Virtual fields',result.virtual_columns_changed]].forEach(function(pair){fact(facts,pair[0],pair[1]?'Changed':'Unchanged');});container.append(facts);
  const columns=result.columns||{},rows=[];
  (columns.added||[]).forEach(function(value){rows.push({Change:'Added source definition',Field:value.source,Before:'',After:pretty(value)});});
  (columns.removed||[]).forEach(function(value){rows.push({Change:'Removed source definition',Field:value.source,Before:pretty(value),After:''});});
  (columns.changed||[]).forEach(function(value){rows.push({Change:'Definition or mapping changed',Field:value.source,Before:pretty(value.before),After:pretty(value.after)});});
  if(rows.length){const target=element('div',undefined,'table-scroll');table(target,['Change','Field','Before','After'],rows);container.append(target);}
  else container.append(element('p','Selected field definitions and SQL mappings are unchanged.','hint'));
}

function renderSource(source,columns) {
  state.source=source;state.review=null;
  $('delivery-path').value=source.report_path||$('delivery-path').value;
  $('source-review').hidden=false;$('source-empty').hidden=true;$('ready-review').hidden=true;
  $('source-facts').replaceChildren();fact($('source-facts'),'Rows',count(source.row_count));fact($('source-facts'),'Fields',(columns||sourceColumns(source)).length);fact($('source-facts'),'Delivery report',source.report_path);fact($('source-facts'),'Manifest',source.manifest_sha256||(source.manifest&&source.manifest.sha256));
  $('source-record').textContent=pretty(source);$('mapping-rows').replaceChildren();
  const sample=Array.isArray(source.preview)?source.preview:(source.preview&&source.preview.rows)||[];
  (columns||sourceColumns(source)).forEach(function(column,index){
    const tr=element('tr');tr.dataset.source=column.source;tr.dataset.defaultType=column.type||'VARCHAR';
    tr.append(element('td',column.source));
    const name=element('input');name.value=column.name||column.source;name.required=true;name.maxLength=128;name.dataset.mapping='name';name.setAttribute('aria-label','SQL column for '+column.source);
    const type=element('input');type.value=column.type||'VARCHAR';type.dataset.mapping='type';type.setAttribute('list','duckdb-types');type.setAttribute('aria-label','DuckDB type for '+column.source);
    const nullable=element('input');nullable.type='checkbox';nullable.checked=column.nullable!==false;nullable.dataset.mapping='nullable';nullable.setAttribute('aria-label','Allow null in '+column.source);
    for(const control of [name,type,nullable]) {const td=element('td');td.append(control);tr.append(td);control.addEventListener('input',invalidateReview);}
    const first=sample[0];tr.append(element('td',first?text(Array.isArray(first)?first[index]:first[column.source]):''));$('mapping-rows').append(tr);
  });
  sourceMeaningTable($('source-meanings'),source.semantics,source.semantic_dictionary,columns||sourceColumns(source));
  const displayColumns=(columns||sourceColumns(source)).map(function(column){return column.source;});
  if(sample.length) table($('source-sample'),displayColumns,sample.slice(0,20));else $('source-sample').replaceChildren();
}
function mapping() {
  return Array.from($('mapping-rows').children).map(function(row){return {source:row.dataset.source,name:row.querySelector('[data-mapping=name]').value.trim(),type:row.querySelector('[data-mapping=type]').value.trim()||row.dataset.defaultType,nullable:row.querySelector('[data-mapping=nullable]').checked};});
}
function invalidateReview() { state.review=null;$('ready-review').hidden=true;if(state.source)sourceMeaningTable($('source-meanings'),state.source.semantics,state.source.semantic_dictionary,mapping()); }
function showReview(review) {
  state.review=review;$('ready-review').hidden=false;$('review-facts').replaceChildren();
  fact($('review-facts'),'Import review',review.review_id);fact($('review-facts'),'Rows',count(review.row_count));fact($('review-facts'),'Record keys',(review.keys||[]).join(', ')||'None selected');
}
async function reopenReview(review) {
  const source=Object.assign({},review,{fields:review.columns.map(function(column){return column.source;}),default_columns:review.columns});
  renderSource(source,review.columns);$('source-keys').value=(review.keys||[]).join(', ');showReview(review);show('sources');
}
async function selectEdition(id) {
  const edition=await api('/api/editions/'+encodeURIComponent(id));state.edition=edition;
  $('edition-detail').hidden=false;$('edition-title').textContent='Edition '+(edition.sequence||short(edition.edition_id));$('edition-facts').replaceChildren();
  fact($('edition-facts'),'Edition',edition.edition_id);fact($('edition-facts'),'SQL table',edition.table);fact($('edition-facts'),'Rows',count(edition.row_count));fact($('edition-facts'),'Imported',timestamp(edition.created_at));fact($('edition-facts'),'Record keys',(edition.keys||[]).join(', ')||'None');fact($('edition-facts'),'Status',edition.import_status);
  $('edition-columns').replaceChildren();
  (edition.columns||[]).forEach(function(column){const row=element('tr');row.append(element('td',column.name),element('td',column.type),element('td',column.source));$('edition-columns').append(row);});
  $('edition-record').textContent=pretty(edition);
  sourceMeaningTable($('edition-meanings'),edition.semantics,edition.semantic_dictionary,edition.columns,edition.edition_id);
  const view=(state.data.views||[]).find(function(v){return v.edition_id===id;});
  $('view-name').value=view?view.name:'current_dataset';
  updateActivation();render();show('editions');
}
function updateActivation() {
  if(!state.edition) return;
  const view=activeView($('view-name').value.trim());
  $('activation-info').textContent=view?'Current revision '+view.revision+' · '+short(view.edition_id):'This creates a new active view.';
}
function queryRequest() {
  const sql=$('sql').value.trim();if(!sql) throw new Error('Enter a SQL query first.');
  let parameters;try{parameters=JSON.parse($('query-parameters').value);}catch(error){throw new Error('Query parameters must be a valid JSON array.');}
  if(!Array.isArray(parameters)) throw new Error('Query parameters must be a JSON array.');
  if(parameters.some(function(value){return typeof value==='number'&&(!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value)));})) throw new Error('Put large integer parameters in quotes to preserve their exact value.');
  const limit=Number($('query-limit').value);if(!Number.isInteger(limit)||limit<1||limit>10000) throw new Error('Preview rows must be between 1 and 10,000.');
  return {sql:sql,parameters:parameters,max_rows:limit};
}
function loadQuery(query) {
  state.query=query;$('sql').value=query.sql;$('query-parameters').value=JSON.stringify(query.parameters||[]);$('query-name').value=query.name;$('query-revision').textContent='Saved revision '+query.revision;state.lastPreview=null;show('query');
}
async function saveQuery() {
  const request=queryRequest();
  let name=$('query-name').value.trim();
  if(!name) {name='analysis_'+new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);$('query-name').value=name;}
  const existing=(state.data.queries||[]).find(function(query){return query.name.toLowerCase()===name.toLowerCase();});
  if(existing&&existing.sql===request.sql&&JSON.stringify(existing.parameters||[])===JSON.stringify(request.parameters)) {state.query=existing;return existing;}
  const saved=await api('/api/queries',{name:name,sql:request.sql,parameters:request.parameters,expected_revision:existing?existing.revision:0});
  state.query=saved;$('query-revision').textContent='Saved revision '+saved.revision;await refresh();return saved;
}
function exportFiles(record) {
  if(Array.isArray(record.files)) return record.files;
  return Object.entries(record.files||{}).map(function(pair){return typeof pair[1]==='object'?Object.assign({name:pair[0]},pair[1]):{name:pair[0],path:pair[1]};});
}
function fileName(file) { return file.name||(file.path||'').split('/').pop(); }
async function download(record,file) {
  const name=fileName(file);
  const response=await fetch('/api/exports/'+encodeURIComponent(record.export_id)+'/file?name='+encodeURIComponent(name),{headers:{'X-DuckDB-Capability':capability},cache:'no-store'});
  if(!response.ok) {let result={};try{result=await response.json();}catch(error){}throw new Error(result.error||'The saved file could not be opened.');}
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=element('a');
  link.href=url;link.download=name.split('/').pop();document.body.append(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url);},10000);
}
function renderExportSchema(record) {
  const columns=Array.isArray(record.columns)?record.columns:[];
  $('export-schema').hidden=!columns.length;
  $('export-columns').replaceChildren();$('export-read-sql').textContent='';$('export-read-types').hidden=true;
  if(!columns.length) return;
  const originalColumns=new Map((record.query_columns||columns).map(function(column){return [column.name,column];}));
  const encodings=new Map((record.column_encodings||[]).map(function(column){return [column.name,column];}));
  const labels={native:'Native type',decimal128:'Exact decimal',duckdb_text:'Exact text'};
  let restore=false;
  const rows=columns.map(function(column){
    const original=originalColumns.get(column.name)||column,encoding=encodings.get(column.name);
    const kind=encoding&&encoding.encoding||'native';
    if(original.type!==column.type||kind!=='native') restore=true;
    return [column.name,original.type,column.type,labels[kind]||kind];
  });
  table($('export-columns'),['Column','SQL type','File type','Representation'],rows);
  if(restore) {
    const projections=columns.map(function(column){
      const original=originalColumns.get(column.name)||column,name=sqlName(column.name);
      return '  '+(original.type===column.type?name:'CAST('+name+' AS '+original.type+') AS '+name);
    });
    $('export-read-sql').textContent='SELECT\n'+projections.join(',\n')+"\nFROM read_parquet('result.parquet');";
    $('export-read-types').hidden=false;
  }
}
async function selectExport(id) {
  const record=await api('/api/exports/'+encodeURIComponent(id));state.export=record;
  $('export-detail').hidden=false;$('export-title').textContent=record.kind==='source-handoff'?'Portable workspace handoff':record.kind==='edition-source'?'Original edition source files':'Saved query export';$('export-facts').replaceChildren();
  fact($('export-facts'),'Export',record.export_id);fact($('export-facts'),'Edition',record.edition_id);fact($('export-facts'),'Rows',count(record.rows));fact($('export-facts'),'Saved',timestamp(record.created_at));fact($('export-facts'),'Directory',record.directory);fact($('export-facts'),'Query',record.query&&record.query.name);
  renderExportSchema(record);
  if(window.stellarDuckDBSpatialExportSchema) window.stellarDuckDBSpatialExportSchema(record);
  $('export-files').replaceChildren();
  exportFiles(record).forEach(function(file){const name=fileName(file);item($('export-files'),name,count(file.bytes===undefined?file.size:file.bytes)+' bytes',function(){run('Opening saved file',async function(){await download(record,file);notice('Download prepared: '+name);});});});
  queryMeanings($('export-meanings'),record.source_meanings);$('export-record').textContent=pretty(record);$('export-reopen-query').hidden=!(record.query&&record.query.sql);show('exports');render();
}
function renderComparison(result) {
  meaningComparison(result.source_meanings);
  $('comparison').hidden=false;$('comparison-summary').replaceChildren();
  const summary=result.summary||{};
  Object.entries(summary).filter(function(pair){return typeof pair[1]==='number'||typeof pair[1]==='string';}).forEach(function(pair){const metric=element('div',undefined,'metric');metric.append(element('strong',count(pair[1])),element('span',pair[0].replaceAll('_',' ')));$('comparison-summary').append(metric);});
  $('comparison-schema').replaceChildren();
  $('comparison-schema').append(element('p',result.comparison_basis||'Row comparison uses compatible columns and the selected record keys.','hint'));
  const schema=result.columns||{},schemaRows=[];
  (schema.added||[]).forEach(function(name){schemaRows.push({'Change':'Added column','Column':name,'Before':'','After':name});});
  (schema.removed||[]).forEach(function(name){schemaRows.push({'Change':'Removed column','Column':name,'Before':name,'After':''});});
  (schema.changed||[]).forEach(function(change){schemaRows.push({'Change':'Mapping changed','Column':change.name,'Before':text(change.before),'After':text(change.after)});});
  if(schemaRows.length) {const target=element('div',undefined,'table-scroll');table(target,['Change','Column','Before','After'],schemaRows);$('comparison-schema').append(target);}
  else $('comparison-schema').append(element('p','Column mappings unchanged.','hint'));
  if(result.truncated) $('comparison-schema').append(element('p','Showing the first 200 row differences. Summary counts cover the full comparison.','hint'));
  const changes=Array.isArray(result.changes)?result.changes:[];
  if(changes.length) {
    const columns=Array.from(changes.reduce(function(keys,row){Object.keys(row).forEach(function(key){keys.add(key);});return keys;},new Set()));
    table($('comparison-table'),columns,changes);
  } else { $('comparison-table').replaceChildren(element('p',result.truncated?'The comparison preview reached its row limit.':'No row differences in this comparison preview.','hint')); }
  $('comparison-record').textContent=pretty(result);
}
document.querySelectorAll('.nav').forEach(function(button){button.addEventListener('click',function(){show(button.dataset.screen);});});
bind('refresh','Refreshing workspace',async function(){await refresh();notice('Workspace refreshed.');});
$('new-delivery').addEventListener('click',function(){show('sources');$('delivery-path').focus();});
$('exports-to-query').addEventListener('click',function(){show('query');});
$('source-details-toggle').addEventListener('click',function(){const panel=$('source-details');panel.hidden=!panel.hidden;});
$('source-keys').addEventListener('input',invalidateReview);
$('view-name').addEventListener('input',updateActivation);
$('sql').addEventListener('input',queryChanged);$('query-parameters').addEventListener('input',queryChanged);
$('sql').addEventListener('keydown',function(event){if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();$('query-form').requestSubmit();}});
submit('review-form','Reviewing source delivery',async function(){
  const report=$('delivery-path').value.trim();if(!report) throw new Error('Choose an original delivery report.');
  const source=await api('/api/inspect-delivery',{report_path:report});renderSource(source);$('source-keys').value='';notice('Delivery reviewed. Choose the SQL mapping and record keys.');
});
submit('import-form','Preparing import review',async function(){
  if(!state.source) throw new Error('Review a source delivery first.');
  const review=await api('/api/reviews',{report_path:state.source.report_path||$('delivery-path').value.trim(),columns:mapping(),keys:keyList($('source-keys').value)});showReview(review);await refresh();notice('Import review saved. Import the reviewed edition when ready.');
});
bind('import-reviewed','Importing reviewed edition',async function(){
  if(!state.review) throw new Error('Prepare an import review first.');
  const edition=await api('/api/import',{review_id:state.review.review_id});await refresh();await selectEdition(edition.edition_id);notice('Edition imported. It is ready for SQL or an active view.');
});
submit('activate-form','Activating edition',async function(){
  if(!state.edition) throw new Error('Select an edition first.');
  const name=$('view-name').value.trim(),view=activeView(name);
  await api('/api/activate',{name:name,edition_id:state.edition.edition_id,expected_revision:view?view.revision:0});await refresh();notice('Active view '+name+' now selects this edition.');
});
$('edition-query').addEventListener('click',function(){if(state.edition) useTable(state.edition.table);});
bind('edition-source','Exporting original source files',async function(){
  if(!state.edition) throw new Error('Select an edition first.');
  const record=await retainedAction('/api/source-handoffs',{edition_id:state.edition.edition_id});await refresh();await selectExport(record.export_id);notice('Original edition source files are ready to download.');
});
$('compare-base').addEventListener('change',function(){const edition=(state.data.editions||[]).find(function(row){return row.edition_id===$('compare-base').value;});if(edition) $('compare-keys').value=(edition.keys||[]).join(', ');});
submit('compare-form','Comparing editions',async function(){
  const before=$('compare-base').value,after=$('compare-candidate').value;if(!before||!after) throw new Error('Select both editions.');
  if(before===after) throw new Error('Select two different editions.');
  const keys=keyList($('compare-keys').value),body={before_id:before,after_id:after,max_rows:200};if(keys.length) body.keys=keys;
  renderComparison(await api('/api/compare',body));notice('Edition comparison opened.');
});
bind('compare-meanings','Comparing source definitions',async function(){
  const before=$('compare-base').value,after=$('compare-candidate').value;if(!before||!after)throw new Error('Select both editions.');
  const result=await api('/api/compare-meanings',{before_id:before,after_id:after});$('comparison').hidden=false;for(const id of ['comparison-summary','comparison-schema','comparison-table'])$(id).replaceChildren();meaningComparison(result);$('comparison-record').textContent=pretty(result);notice('Source definition comparison opened.');
});
submit('query-form','Running query preview',async function(){
  const request=queryRequest(),result=await api('/api/query',request);state.lastPreview={request:request,views:result.views};
  table($('result-table'),result.columns||[],result.rows||[]);$('query-result').hidden=false;$('result-summary').textContent=count((result.rows||[]).length)+' preview rows';
  $('result-limit').textContent=result.truncated?'More rows are available. Export the saved query for the complete result.':'The preview contains the complete result.';
  queryMeanings($('query-meanings'),result.source_meanings);$('query-result-record').textContent=pretty({columns:result.columns,views:result.views,truncated:result.truncated,source_meanings:result.source_meanings});notice('Query preview complete.');
});
submit('save-query-form','Saving query',async function(){const query=await saveQuery();notice('Saved '+query.name+' at revision '+query.revision+'.');});
bind('export-query','Exporting query to Parquet and CSV',async function(){
  const query=await saveQuery(),body={query_id:query.query_id,expected_revision:query.revision};
  if(state.lastPreview) body.expected_views=state.lastPreview.views;
  const record=await retainedAction('/api/exports',body);await refresh();await selectExport(record.export_id);notice('Query export saved with Parquet, CSV and source details.');
});
bind('export-source','Preparing portable source handoff',async function(){
  const record=await retainedAction('/api/handoffs',{});await refresh();await selectExport(record.export_id);notice('Portable workspace handoff prepared.');
});
$('export-reopen-query').addEventListener('click',function(){if(state.export&&state.export.query) {if(state.export.kind==='gis-query'&&window.stellarDuckDBSpatialLoadQuery) window.stellarDuckDBSpatialLoadQuery(state.export.query);else loadQuery(state.export.query);}});
const types=element('datalist');types.id='duckdb-types';['VARCHAR','BOOLEAN','BIGINT','HUGEINT','DOUBLE','DECIMAL(38,10)','DATE','TIMESTAMP','TIMESTAMPTZ','JSON'].forEach(function(type){const option=element('option');option.value=type;types.append(option);});document.body.append(types);
run('Opening workspace',async function(){
  if(!capability) throw new Error('Open this workspace using its private launch link.');
  await refresh();
  let screen='sources';try{screen=sessionStorage.getItem('stellar_duckdb_screen')||screen;}catch(error){}
  show(['sources','editions','query','spatial','exports'].includes(screen)?screen:'sources');notice('');
});
"""

HTML = HTML.replace('<button class="nav" data-screen="exports">', '<button class="nav" data-screen="spatial">GIS workspace</button><button class="nav" data-screen="exports">')
HTML = HTML.replace("<footer>", _spatial_ui.HTML + "<footer>")
HTML = HTML.replace('<script src="/app.js"></script>', '<script src="/app.js"></script><script src="/spatial.js"></script>')
CSS += _spatial_ui.CSS + "@media(max-width:760px){.sidebar nav{grid-template-columns:repeat(5,1fr)}}"
