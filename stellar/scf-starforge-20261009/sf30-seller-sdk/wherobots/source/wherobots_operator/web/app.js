"use strict";
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const pretty = (value) => JSON.stringify(value, null, 2);
const uid = () => crypto.randomUUID();
const auth = new URLSearchParams(location.hash.slice(1)).get("token");
if (auth) { sessionStorage.setItem("wherobots_operator_token", auth); history.replaceState(null, "", location.pathname); }
const token = sessionStorage.getItem("wherobots_operator_token") || "";
let state = null, runtime = {}, selection = null, selectedRecord = null, draft = null;
let intake = null, intakeObject = null, intakeFiles = {}, rowOffset = 0, rowDataset = null, lastRows = null;
let refreshing = false, pendingTasks = new Set(), workflowDirty = false, navigationSequence = 0;
let operationDetail = null, logCapture = null, logOffset = 0, lastLogs = null;
let eventCursor = 0, eventRows = [], eventHasMore = false;

function notice(message, error=false) {
  $("notice").hidden = !message; $("notice").textContent = message;
  $("notice").className = error ? "error" : "";
}
async function api(path, body, raw=false) {
  const options = {headers:{Authorization:"Bearer " + token}, credentials:"same-origin"};
  if (body !== undefined) {
    options.method = "POST";
    if (raw) options.body = body;
    else { options.headers["Content-Type"] = "application/json"; options.body = JSON.stringify(body); }
  }
  const response = await fetch("/api/" + path, options);
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.message || value.error || "The operation failed.");
    error.detail = value; throw error;
  }
  return value;
}
function displayError(error) {
  notice(error.message + (error.detail?.details ? "\n" + pretty(error.detail.details) : ""), true);
}
function sourceLink(ref, filename, text) {
  return '<a href="/api/objects/' + esc(ref.sha256) + '?filename=' + encodeURIComponent(filename || ref.sha256) + '">' + esc(text || filename || "Original file") + "</a>";
}
function field(label, name, value, type="text", extra="") {
  return '<label>' + esc(label) + '<input name="' + esc(name) + '" value="' + esc(value) + '" type="' + type + '" ' + extra + "></label>";
}
function area(label, name, value, rows=3) {
  return '<label>' + esc(label) + '<textarea name="' + esc(name) + '" rows="' + rows + '">' + esc(value) + "</textarea></label>";
}
function option(value, selected, text) {
  return '<option value="' + esc(value) + '"' + (value === selected ? " selected" : "") + ">" + esc(text || value) + "</option>";
}
function valueText(value) {
  if (value === null) return "null";
  if (typeof value !== "object") return String(value);
  for (const key of ["$number","$decimal","$integer"]) if (key in value) return value[key];
  if ("$binary" in value) return "[binary · " + value.encoding + "] " + value.$binary;
  if ("$timestamp" in value) return value.$timestamp + " " + value.unit + (value.timezone ? " · " + value.timezone : "");
  return JSON.stringify(value);
}
function renderTable(rows, columns) {
  if (!rows.length) return '<p class="empty">This selection contains no rows.</p>';
  const names = columns?.map((x) => typeof x === "string" ? x : x.name) || [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return '<div class="table-scroll"><table><thead><tr>' + names.map((name) => "<th>" + esc(name) + "</th>").join("") + "</tr></thead><tbody>" +
    rows.map((row) => "<tr>" + names.map((name) => "<td>" + (Object.hasOwn(row,name) ? esc(valueText(row[name])) : '<span class="muted">missing</span>') + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";
}
function renderNavigation() {
  $("workspace-title").textContent = state.title;
  for (const [kind, container, rows] of [["workflow","workflows",state.workflows],["operation","operations",state.operations],["edition","editions",state.editions]]) {
    $(container).innerHTML = rows.length ? rows.slice().reverse().map((row) =>
      '<button data-select="' + kind + '" data-id="' + esc(row.id) + '" class="' + (selection?.kind === kind && selection.id === row.id ? "selected" : "") + '">' +
      esc(row.title || row.id) + "<small>" + esc(kind === "operation" ? (row.native_status || row.state) : row.workflow_id || row.updated_at || "") + "</small></button>").join("") :
      '<p class="empty">None saved</p>';
  }
  $("tasks").innerHTML = state.tasks.slice(0,12).map((task) => '<div class="task"><button class="link-button" data-task="' + esc(task.id) + '">' + esc(task.action) +
    "</button> · " + esc(task.state.toLowerCase()) + "<small>" + esc(task.operation_id || task.workflow_id || task.id) + "</small></div>").join("") || '<p class="empty">No background work</p>';
}
async function refreshState() {
  if (refreshing) return;
  refreshing = true;
  try {
    state = await api("state"); renderNavigation();
    const active = state.tasks.some((task) => ["QUEUED","RUNNING"].includes(task.state));
    $("connection").textContent = active ? "Connected · work in progress" : "Connected · " + state.workspace_id.slice(0,12);
    if (selection?.kind === "operation" && !document.querySelector("input:focus,textarea:focus,select:focus")) {
      const summary = state.operations.find((x) => x.id === selection.id);
      if (summary && selectedRecord?.revision_sha256 !== summary.revision_sha256) await show("operation", selection.id);
    }
  } finally { refreshing = false; }
}
async function show(kind, id, dataset = null) {
  const sameOperation = kind === "operation" && selection?.kind === kind && selection?.id === id;
  const requested = ++navigationSequence;
  selection = {kind,id}; sessionStorage.setItem("wherobots_selection",JSON.stringify(selection));
  const record = await api(({workflow:"workflows",operation:"operations",edition:"editions"})[kind] + "/" + encodeURIComponent(id));
  if (requested !== navigationSequence) return;
  selectedRecord = record;
  rowOffset = 0; rowDataset = dataset;
  if (!sameOperation) {
    operationDetail = null; logCapture = null; logOffset = 0; lastLogs = null;
    eventCursor = 0; eventRows = []; eventHasMore = false;
  }
  if (kind === "workflow") { draft = structuredClone(selectedRecord.definition); workflowDirty=false; renderWorkflow(); }
  else if (kind === "operation") {
    renderOperation();
    if (operationDetail === "logs") await loadLogs();
    else if (operationDetail === "events") await loadEvents();
  } else await renderEdition();
  renderNavigation();
}
function newWorkflow() {
  navigationSequence++;
  selection = {kind:"workflow",id:null}; selectedRecord = null;
  draft = {schema:"starforge.wherobots.workflow.v1",id:"",title:"",
    account:{organization_id:runtime.organization_id || "",region:runtime.region || "",runtime:runtime.runtimes?.[0] || "",version:"latest",api_base_url:runtime.api_base_url || "https://api.cloud.wherobots.com"},
    job:{name:"",script:null,args:[],timeout_seconds:3600,spark_configs:{},dependencies:[]},sources:[],outputs:[],limits:{max_objects:100,max_bytes:2147483648}};
  workflowDirty=false; renderWorkflow(); if (state) renderNavigation();
}
function outputForm(output, index) {
  const prefix = "output_" + index + "_";
  const csv = output.csv || {};
  const header = csv.header === true ? "true" : csv.header === false ? "false" : "";
  return '<section class="output"><div class="section-title"><h3>Output dataset ' + (index+1) + '</h3><button type="button" class="secondary" data-action="remove-output" data-index="' + index + '">Remove</button></div><div class="grid">' +
    field("Dataset ID",prefix+"id",output.id,"text","required") +
    '<label>Original store<select name="' + prefix + 'store">' + option("my_files",output.store,"My Files") + option("s3",output.store,"Existing S3 integration") + "</select></label>" +
    '<label class="full">Native path or S3 prefix<input name="' + prefix + 'path" value="' + esc(output.path) + '" required></label>' +
    '<label>Output format<select name="' + prefix + 'format">' + ["geoparquet","parquet","geojson-seq","csv","ndjson","json"].map((x) => option(x,output.format)).join("") + "</select></label>" +
    field("Comparison key columns (comma separated)",prefix+"keys",(output.primary_key||[]).join(", ")) +
    field("Primary geometry column",prefix+"geometry",output.geometry_column || "") +
    field("Axis order, when supplied by source",prefix+"axis",output.axis_order || "") +
    "</div><details><summary>CSV and coordinate metadata</summary><div class=\"grid\">" +
    '<label>Original CSV header<select name="' + prefix + 'header">' + option("",header,"Select when using CSV") + option("true",header,"First row contains column names") + option("false",header,"First row contains data") + "</select></label>" +
    field("CSV delimiter",prefix+"delimiter",csv.delimiter || ",") +
    area("Headerless CSV column names (JSON array)",prefix+"columns",pretty(csv.columns || []),2) +
    area("Declared coordinate reference system (JSON value)",prefix+"crs",Object.hasOwn(output,"crs") ? pretty(output.crs) : "",2) +
    "</div></details></section>";
}
function renderWorkflow() {
  if (draft.schema !== "starforge.wherobots.workflow.v1") return renderRetainedSourceWorkflow();
  const account = draft.account, job = draft.job, script = job.script;
  $("content").innerHTML = '<div class="section-title"><div><h2>' + esc(draft.title || "New workflow") + '</h2><p class="muted">Save the source and output definition, review a run, then operate it from its retained record.</p></div>' +
    (selectedRecord ? '<button class="secondary" data-action="export">Export complete handover</button>' : "") + '</div><form id="workflow-form"><div class="grid">' +
    field("Workflow ID","id",draft.id,"text",selectedRecord ? "readonly" : "required") + field("Title","title",draft.title,"text","required") +
    field("Existing organization ID","organization_id",account.organization_id,"text","required") + field("Region","region",account.region,"text","required") +
    field("Runtime","runtime",account.runtime,"text","required") + field("Runtime version","version",account.version,"text","required") +
    field("Native job name","name",job.name,"text","required minlength=\"8\" maxlength=\"255\"") +
    field("Native timeout (seconds)","timeout_seconds",job.timeout_seconds,"number","required min=\"1\"") +
    '</div><h3>Original script</h3><div class="source">' +
    (script ? "<p>" + sourceLink(script.object,script.filename,script.filename) + '</p><p class="identity">' + esc(script.object.sha256) + " · " + script.object.bytes + " bytes</p>" : "<p>Select the existing Python script or JAR.</p>") +
    '<label class="check-row">Select source file<input type="file" id="script-file" accept=".py,.jar"></label></div>' +
    field("Existing native script URI (for attaching an earlier run)","script_uri",script?.uri || "") +
    area("Ordered native arguments (JSON array)","args",pretty(job.args)) +
    '<h3>Output editions</h3><p class="muted">Use the output paths written by this script. A corrected run receives its own edition prefix.</p><div id="output-forms">' +
    draft.outputs.map(outputForm).join("") + '</div><button type="button" class="secondary" data-action="add-output">Add output dataset</button>' +
    '<details><summary>Source collections and native settings</summary>' + area("Original source collections (JSON array)","sources",pretty(draft.sources || []),5) +
    area("Spark configuration (JSON object)","spark_configs",pretty(job.spark_configs || {}),4) +
    area("Native dependencies (JSON array)","dependencies",pretty(job.dependencies || []),4) +
    (script?.filename?.toLowerCase().endsWith(".jar") ? field("JAR main class","jar_main_class",job.jar_main_class || "") : "") +
    '<div class="grid">' + field("Maximum output objects","max_objects",draft.limits.max_objects,"number","min=\"1\"") +
    field("Maximum output bytes","max_bytes",draft.limits.max_bytes,"number","min=\"1\"") + '</div></details>' +
    field("Reviewing operator","actor",selectedRecord?.updated_by || draft.adoption?.receiving?.operator || "operator") +
    '<div class="toolbar"><button type="submit">Save workflow</button>' + (selectedRecord ? '<button type="button" class="secondary" data-action="review-view">Review a native run</button>' : "") + "</div></form>" +
    (draft.adoption ? '<details><summary>Original customer intake</summary><p>' + sourceLink(draft.adoption.original_input,draft.id+"-original-input.json","Download unchanged customer document") + '</p><pre>' + esc(pretty(draft.adoption)) + "</pre></details>" : "");
}
function datasetId(dataset) { return dataset.id || dataset.dataset_id; }
function originalFile(ref, filename, label) {
  if (!ref?.sha256) return "";
  return '<p>' + sourceLink(ref, filename, label || filename) + '<br><span class="identity">' +
    esc(ref.sha256) + ' · ' + esc(ref.bytes) + ' bytes</span></p>';
}
function sourceOrigin(uri) {
  try {
    const parsed = new URL(uri);
    if (["https:", "http:"].includes(parsed.protocol))
      return '<a href="' + esc(parsed.href) + '" target="_blank" rel="noopener noreferrer">' + esc(uri) + '</a>';
  } catch {}
  return esc(uri || "");
}
function editionLinks(editions, dataset = null) {
  if (!editions.length) return '<p class="empty">No received editions are saved for this selection.</p>';
  return '<div class="table-scroll"><table><thead><tr><th>Edition</th><th>Source operation</th><th>Received</th></tr></thead><tbody>' +
    editions.map((edition) => '<tr><td><button class="link-button" data-select="edition" data-id="' + esc(edition.id) + '"' +
      (dataset ? ' data-dataset="' + esc(dataset) + '"' : "") + '>' + esc(edition.id) + '</button></td><td>' +
      esc(edition.operation_id || "") + '</td><td>' + esc(edition.created_at || "") + '</td></tr>').join("") + '</tbody></table></div>';
}
function renderRetainedSourceWorkflow() {
  const definition = draft, script = definition.job?.script;
  const editions = state.editions.filter((edition) => edition.workflow_id === selectedRecord.id);
  const operations = state.operations.filter((operation) => operation.workflow_id === selectedRecord.id);
  $("content").innerHTML = '<div class="section-title"><div><h2>' + esc(definition.title || definition.id) +
    '</h2><p class="muted">Open the retained source collection, its transformation and every received output edition.</p></div>' +
    '<button class="secondary" data-action="export">Export complete handover</button></div>' +
    '<dl><dt>Workflow</dt><dd class="identity">' + esc(selectedRecord.id) + '</dd><dt>Source profile</dt><dd>' +
    esc(definition.schema) + '</dd><dt>Saved revision</dt><dd class="identity">' + esc(selectedRecord.revision_sha256) +
    '</dd></dl><h3>Original source and transformation</h3>' +
    originalFile(script?.object, script?.filename || "source.py", script?.filename || "Original transformation") +
    originalFile(definition.input_manifest?.object, "source-manifest.json", "Original source manifest") +
    (Array.isArray(definition.sources) && definition.sources.length ?
      '<div class="table-scroll"><table><thead><tr><th>Source</th><th>Original location</th><th>Retained file</th></tr></thead><tbody>' +
      definition.sources.map((source) => '<tr><td>' + esc(source.id || source.title || "") + '</td><td>' +
        sourceOrigin(source.uri || source.url) + (source.git_blob_sha ? '<p class="identity">Git blob ' + esc(source.git_blob_sha) + '</p>' : "") +
        '</td><td>' + originalFile(source.object, source.filename || source.id || "original-source", "Download original bytes") +
        '</td></tr>').join("") + '</tbody></table></div>' : '<p class="empty">This retained definition has no separate source file collection.</p>') +
    '<h3>Output datasets</h3>' + (definition.outputs || []).map((dataset) => '<section class="source"><h3>' +
      esc(dataset.title || datasetId(dataset)) + '</h3><dl><dt>Dataset</dt><dd>' + esc(datasetId(dataset)) +
      '</dd><dt>Format</dt><dd>' + esc(dataset.format) + '</dd><dt>Comparison key</dt><dd>' +
      esc(dataset.primary_key?.join(", ") || "Complete row multiset") + '</dd>' +
      (dataset.geometry_column ? '<dt>Geometry</dt><dd>' + esc(dataset.geometry_column + (dataset.geometry_encoding ? " · " + dataset.geometry_encoding : "")) + '</dd>' : "") +
      '</dl><details><summary>Complete dataset definition</summary><pre>' + esc(pretty(dataset)) + '</pre></details>' +
      editionLinks(editions, datasetId(dataset)) + '</section>').join("") +
    '<h3>Received editions</h3>' + editionLinks(editions) +
    '<h3>Source operations</h3>' + (operations.map((operation) => '<p><button class="link-button" data-select="operation" data-id="' +
      esc(operation.id) + '">' + esc(operation.id) + '</button> · ' + esc(operation.state) + '</p>').join("") ||
      '<p class="empty">No source operations are saved for this collection.</p>') +
    '<details><summary>Complete retained workflow definition</summary><pre>' + esc(pretty(definition)) + '</pre></details>';
}
function renderRetainedSourceOperation() {
  const operation = selectedRecord, definition = operation.reviewed_definition || {};
  const editions = state.editions.filter((edition) => edition.operation_id === operation.id);
  $("content").innerHTML = '<div class="section-title"><div><h2>Source receiving operation</h2><p class="identity">' +
    esc(operation.id) + '</p></div><span class="pill">' + esc(operation.state) + '</span></div>' +
    '<dl><dt>Workflow</dt><dd><button class="link-button" data-select="workflow" data-id="' + esc(operation.workflow_id) +
    '">' + esc(definition.title || operation.workflow_id) + '</button></dd><dt>Source profile</dt><dd>' +
    esc(definition.schema || operation.schema) + '</dd><dt>Source definition</dt><dd class="identity">' + esc(operation.review_sha256) +
    '</dd><dt>Last update</dt><dd>' + esc(operation.updated_at) + '</dd></dl>' +
    originalFile(definition.job?.script?.object, definition.job?.script?.filename || "source.py", "Original source transformation") +
    '<div class="toolbar"><button class="secondary" data-action="export">Export complete handover</button>' +
    '<button class="secondary" data-action="show-events">Open receiving progress</button></div>' +
    '<h3>Received editions</h3>' + editionLinks(editions) +
    '<details><summary>Complete original operation</summary><pre>' + esc(pretty(operation)) + '</pre></details><div id="operation-detail"></div>';
}
function renderComparisons(comparisons) {
  return comparisons.map((comparison) => '<section class="source"><h3>Complete edition comparison</h3><dl><dt>Earlier edition</dt><dd class="identity">' +
    esc(comparison.left_edition_id) + '</dd><dt>Later edition</dt><dd class="identity">' + esc(comparison.right_edition_id) + '</dd></dl>' +
    renderTable(comparison.datasets || [], ["dataset_id", "before_rows", "after_rows", "added", "removed", "changed", "unchanged", "schema_changed", "geometry_changed"]) +
    originalFile(comparison.report_object, comparison.id + "-comparison.json", "Download complete comparison report") +
    originalFile(comparison.changes_object, comparison.id + "-changes.ndjson", "Download every row change") +
    '<details><summary>Row change preview</summary>' + renderTable(comparison.preview || []) + '</details>' +
    '<details><summary>Original comparison metadata</summary><pre>' + esc(pretty(comparison)) + '</pre></details></section>').join("");
}

function collectWorkflow() {
  const form = $("workflow-form");
  const get = (name) => form.elements.namedItem(name)?.value ?? "";
  const parse = (name,fallback) => get(name).trim() ? JSON.parse(get(name)) : fallback;
  const value = structuredClone(draft);
  value.id=get("id");value.title=get("title");
  value.account={...value.account,organization_id:get("organization_id"),region:get("region"),runtime:get("runtime"),version:get("version")};
  value.job={...value.job,name:get("name"),args:parse("args",[]),timeout_seconds:Number(get("timeout_seconds")),
    spark_configs:parse("spark_configs",{}),dependencies:parse("dependencies",[])};
  if (value.job.script) {
    if (get("script_uri")) value.job.script.uri=get("script_uri"); else delete value.job.script.uri;
  }
  if (get("jar_main_class")) value.job.jar_main_class=get("jar_main_class");
  value.sources=parse("sources",[]);
  value.limits={max_objects:Number(get("max_objects")),max_bytes:Number(get("max_bytes"))};
  value.outputs=value.outputs.map((output,index) => {
    const prefix="output_"+index+"_";
    const result={...output,id:get(prefix+"id"),store:get(prefix+"store"),path:get(prefix+"path"),format:get(prefix+"format"),
      primary_key:get(prefix+"keys").split(",").map((x)=>x.trim()).filter(Boolean)};
    if (get(prefix+"geometry")) result.geometry_column=get(prefix+"geometry"); else delete result.geometry_column;
    if (get(prefix+"axis")) result.axis_order=get(prefix+"axis"); else delete result.axis_order;
    if (get(prefix+"crs").trim()) result.crs=parse(prefix+"crs",null); else delete result.crs;
    if (result.format==="csv") {
      const header=get(prefix+"header");
      if (!header) throw new Error("Select whether the original CSV contains a header.");
      result.csv={...output.csv,header:header==="true",delimiter:get(prefix+"delimiter"),encoding:output.csv?.encoding || "utf-8"};
      if (!result.csv.header) result.csv.columns=parse(prefix+"columns",[]);
    }
    return result;
  });
  return {definition:value,actor:get("actor") || "operator"};
}
function renderReview() {
  const def=selectedRecord.definition;
  $("content").innerHTML='<h2>Review native run</h2><p>The saved workflow below becomes the source of this operation.</p><dl><dt>Organization</dt><dd>'+esc(def.account.organization_id)+'</dd><dt>Runtime</dt><dd>'+esc(def.account.region+" · "+def.account.runtime+" · "+def.account.version)+'</dd><dt>Script</dt><dd>'+sourceLink(def.job.script.object,def.job.script.filename)+"<br><span class=\"identity\">"+esc(def.job.script.object.sha256)+'</span></dd><dt>Arguments</dt><dd><pre>'+esc(pretty(def.job.args))+'</pre></dd><dt>Outputs</dt><dd>'+def.outputs.map((o)=>'<p>'+esc(o.id+" · "+o.store+" · "+o.path)+'</p>').join("")+'</dd></dl><form id="review-form">' +
    field("Operation ID","operation_id","op-"+uid(),"text","required")+
    '<label>Operation mode<select name="mode">'+option("submit","submit","Submit this workflow as a new native run")+option("attach","","Attach an existing native run")+'</select></label>'+
    field("Reviewing operator","actor",selectedRecord.updated_by || "operator")+
    '<div class="toolbar"><button type="submit">Retain reviewed operation</button><button type="button" class="secondary" data-action="edit-workflow">Back to workflow</button></div></form>';
}
function renderOperation() {
  const op=selectedRecord, def=op.reviewed_definition;
  if (def?.schema !== "starforge.wherobots.workflow.v1") return renderRetainedSourceOperation();
  $("content").innerHTML='<div class="section-title"><div><h2>Native operation</h2><p class="identity">'+esc(op.id)+'</p></div><span class="pill">'+esc(op.native_status || op.state)+'</span></div>'+
    '<dl><dt>Workflow</dt><dd><button class="link-button" data-select="workflow" data-id="'+esc(op.workflow_id)+'">'+esc(def.title)+'</button></dd><dt>Native run</dt><dd>'+esc(op.native_run_id || "Awaiting submission or attachment")+'</dd><dt>Runtime</dt><dd>'+esc(def.account.region+" · "+def.account.runtime)+'</dd><dt>Native job name</dt><dd>'+esc(op.native_name)+'</dd><dt>Original script</dt><dd>'+sourceLink(def.job.script.object,def.job.script.filename)+'</dd><dt>Reviewed by</dt><dd>'+esc(op.reviewed_by)+'</dd><dt>Last update</dt><dd>'+esc(op.updated_at)+'</dd></dl>'+
    '<div class="toolbar">'+(op.mode==="submit" && !op.native_run_id?'<button data-action="native" data-native="submit">Submit reviewed run</button>':"")+
    (op.native_run_id?'<button class="secondary" data-action="native" data-native="refresh">Refresh status and logs</button><button class="secondary" data-action="native" data-native="capture" '+(op.native_status==="COMPLETED"?"":"disabled")+'>Receive complete outputs</button><button class="secondary" data-action="native" data-native="cancel">Request native cancellation</button>':"")+
    '<button class="secondary" data-action="export">Export handover</button></div>'+
    (!op.native_run_id?'<form id="recover-form">'+field("Existing native run ID (leave blank to reconcile the original submission)","native_run_id","")+'<button type="submit" class="secondary">Recover original run</button></form>':"")+
    '<h3>Received editions</h3>'+((op.output_editions||[]).map((id)=>'<p><button class="link-button" data-select="edition" data-id="'+esc(id)+'">'+esc(id)+'</button></p>').join("") || '<p class="empty">No output edition has been received yet.</p>')+
    '<details><summary>Reviewed source and native response</summary><pre>'+esc(pretty(op))+'</pre></details><div class="toolbar"><button class="secondary" data-action="show-logs">Open captured logs</button><button class="secondary" data-action="show-events">Open receiving progress</button></div><div id="operation-detail"></div>';
}

async function loadLogs() {
  const operationId = selectedRecord.id;
  const query = "?offset=" + logOffset + "&limit=100" + (logCapture === null ? "" : "&capture=" + logCapture);
  const result = await api("operations/" + encodeURIComponent(operationId) + "/logs" + query);
  if (selection?.kind !== "operation" || selection.id !== operationId || operationDetail !== "logs") return;
  lastLogs = result; logCapture = result.capture;
  const captures = result.captures || [];
  const position = result.items.length ? (result.offset + 1) + "–" + (result.offset + result.items.length) + " of " + result.total : "0 entries";
  $("operation-detail").innerHTML = '<h3>Captured native logs</h3>' +
    (captures.length ? '<label>Capture<select id="log-capture">' + captures.map((capture) =>
      option(String(capture.index), String(result.capture), (capture.captured_at || "Capture " + (capture.index + 1)) +
        " · " + (capture.entries ?? "?") + " entries" + (capture.complete ? "" : " · partial"))).join("") + '</select></label>' :
      '<p class="empty">Refresh the native run with logs to retain its current log stream.</p>') +
    (result.error ? '<p class="error">' + esc(result.error.message) + '</p>' : '') +
    '<p class="muted">Original log pages remain available in the complete handover.</p>' +
    renderTable(result.items) +
    '<div class="pagination"><button class="secondary" data-action="previous-logs" ' + (logOffset === 0 ? "disabled" : "") +
      '>Previous</button><span>' + esc(position) + '</span><button class="secondary" data-action="next-logs" ' +
      (result.next_offset === null ? "disabled" : "") + '>Next</button></div>';
}
async function loadEvents() {
  const operationId = selectedRecord.id;
  const result = await api("operations/" + encodeURIComponent(operationId) + "/events?after=" + eventCursor + "&limit=100");
  if (selection?.kind !== "operation" || selection.id !== operationId || operationDetail !== "events") return;
  const seen = new Set(eventRows.map((row) => row.seq));
  eventRows.push(...result.items.filter((row) => !seen.has(row.seq)));
  eventCursor = result.next_cursor; eventHasMore = result.has_more;
  $("operation-detail").innerHTML = '<h3>Receiving progress</h3><p class="muted">' + eventRows.length +
    ' retained events loaded.</p>' + renderTable(eventRows, ["seq", "recorded_at", "event"]) +
    '<button class="secondary" data-action="more-events">' + (eventHasMore ? "Load next events" : "Refresh progress") + '</button>';
}

async function renderEdition() {
  const edition=selectedRecord, datasets=edition.datasets || [];
  if (!datasets.some((dataset) => datasetId(dataset) === rowDataset)) rowDataset=datasetId(datasets[0] || {});
  const others=state.editions.filter((x)=>x.workflow_id===edition.workflow_id && x.id!==edition.id);
  $("content").innerHTML='<div class="section-title"><div><h2>Received output edition</h2><p class="identity">'+esc(edition.id)+'</p></div><button class="secondary" data-action="export">Export complete handover</button></div>'+
    '<dl><dt>'+(edition.native_run_id?'Native run':'Source operation')+'</dt><dd>'+esc(edition.native_run_id || edition.operation_id)+'</dd><dt>Source binding</dt><dd class="identity">'+esc(edition.source_binding_sha256)+'</dd></dl>'+
    '<label>Dataset<select id="dataset-select">'+datasets.map((d)=>option(datasetId(d),rowDataset,(d.definition?.title || datasetId(d))+" · "+d.row_count+" rows")).join("")+'</select></label>'+
    '<div id="dataset-summary"></div><div id="rows"></div><div class="pagination"><button class="secondary" data-action="previous-rows">Previous</button><span id="row-position"></span><button class="secondary" data-action="next-rows">Next</button></div>'+
    '<div class="divider"></div><h3>Compare complete editions</h3>'+
    (others.length?'<form id="compare-form"><label>Earlier edition<select name="left_id">'+others.map((e)=>option(e.id,others[0].id)).join("")+'</select></label><button type="submit">Compare every row</button></form>':'<p class="empty">Receive a corrected output edition to compare schema, geometry and every record.</p>')+
    '<div id="comparison"></div><details><summary>Complete edition metadata</summary><pre>'+esc(pretty(edition))+'</pre></details>';
  await loadRows();
  if (selection?.kind === "edition" && selection.id === edition.id && edition.comparisons?.length) $("comparison").innerHTML=renderComparisons(edition.comparisons);
}
async function loadRows() {
  if (!rowDataset) return;
  const editionId=selectedRecord.id, datasetSelection=rowDataset, requestedOffset=rowOffset;
  const dataset=selectedRecord.datasets.find((d)=>datasetId(d)===datasetSelection);
  $("dataset-summary").innerHTML='<dl><dt>Rows</dt><dd>'+esc(dataset.row_count)+'</dd><dt>Original files</dt><dd>'+dataset.files.length+'</dd><dt>Comparison key</dt><dd>'+esc(dataset.primary_key?.join(", ") || "Complete row multiset")+'</dd></dl>'+
    '<details><summary>Original output parts and metadata</summary><ul>'+dataset.files.map((p)=>'<li>'+sourceLink(p.object,p.relative_path,p.relative_path)+' · '+p.object.bytes+' bytes · '+esc(p.role)+'</li>').join("")+'</ul><pre>'+esc(pretty({columns:dataset.columns,geometry:dataset.geometry}))+'</pre></details>';
  const result=await api("editions/"+encodeURIComponent(editionId)+"/rows?dataset="+encodeURIComponent(datasetSelection)+"&offset="+requestedOffset+"&limit=100");
  if (selection?.kind !== "edition" || selection.id !== editionId || rowDataset !== datasetSelection || rowOffset !== requestedOffset) return;
  lastRows=result;
  $("rows").innerHTML=renderTable(lastRows.rows,lastRows.columns);
  $("row-position").textContent=lastRows.total ? (rowOffset+1)+"–"+(rowOffset+lastRows.rows.length)+" of "+lastRows.total : "0 rows";
  document.querySelector('[data-action="previous-rows"]').disabled=rowOffset===0;
  document.querySelector('[data-action="next-rows"]').disabled=lastRows.next_offset===null;
}
async function waitTask(task) {
  pendingTasks.add(task.id); await refreshState();
  let current=task;
  while (["QUEUED","RUNNING"].includes(current.state)) {
    await new Promise((resolve)=>setTimeout(resolve,1500));
    current=await api("tasks/"+encodeURIComponent(task.id));
  }
  pendingTasks.delete(task.id); await refreshState();
  if (current.state!=="COMPLETE") {
    const error=new Error(current.error?.message || current.message || "The original operation was interrupted.");
    error.detail=current.error; throw error;
  }
  return current.result;
}
async function startNative(name,body={}) {
  const originalId=selectedRecord.id;
  notice("Running "+name+" for "+originalId+". You can reopen its saved status while work continues.");
  await waitTask(await api("operations/"+encodeURIComponent(originalId)+"/"+name,{...body,request_id:uid()}));
  if (selection?.kind==="operation" && selection.id===originalId) await show("operation",originalId);
  notice("The original "+name+" operation completed.");
}
async function exportSelected() {
  const workflowId=selection.kind==="workflow"?selectedRecord.id:selectedRecord.workflow_id;
  notice("Preparing the complete "+workflowId+" handover.");
  const result=await waitTask(await api("export",{workflow_id:workflowId,request_id:uid()}));
  notice("Complete handover ready · "+result.bytes+" bytes.");
  const link=document.createElement("a");link.href="/api/exports/"+encodeURIComponent(result.export_id);link.download=result.filename;
  link.textContent="Download "+result.filename;$("notice").append(document.createElement("br"),link);link.click();
}
document.addEventListener("click",async(event)=>{
  const button=event.target.closest("button");
  if (!button) return;
  try {
    if (button.dataset.select) { await show(button.dataset.select,button.dataset.id,button.dataset.dataset || null);return; }
    if (button.dataset.task) {
      const task=await api("tasks/"+encodeURIComponent(button.dataset.task));
      notice(pretty(task));return;
    }
    const action=button.dataset.action;
    if (action==="add-output") {
      draft=collectWorkflow().definition;workflowDirty=true;draft.outputs.push({id:"",store:"my_files",path:"",format:"geoparquet",primary_key:[]});renderWorkflow();
    } else if(action==="remove-output") {
      draft=collectWorkflow().definition;workflowDirty=true;draft.outputs.splice(Number(button.dataset.index),1);renderWorkflow();
    } else if(action==="review-view") {
      if (workflowDirty) throw new Error("Save your workflow changes before reviewing its native run.");
      renderReview();
    } else if(action==="edit-workflow") { draft=structuredClone(selectedRecord.definition);renderWorkflow(); }
    else if(action==="native") await startNative(button.dataset.native,{include_logs:button.dataset.native==="refresh"});
    else if(action==="export") await exportSelected();
    else if(action==="previous-rows") {rowOffset=Math.max(0,rowOffset-100);await loadRows();}
    else if(action==="next-rows" && lastRows?.next_offset!==null) {rowOffset=lastRows.next_offset;await loadRows();}
    else if(action==="close-intake") $("intake-dialog").close();
    else if(action==="show-logs") {
      operationDetail="logs"; logCapture=null; logOffset=0; await loadLogs();
    } else if(action==="previous-logs") {
      logOffset=Math.max(0,logOffset-100); await loadLogs();
    } else if(action==="next-logs" && lastLogs?.next_offset!==null) {
      logOffset=lastLogs.next_offset; await loadLogs();
    } else if(action==="show-events") {
      operationDetail="events"; eventCursor=0; eventRows=[]; await loadEvents();
    } else if(action==="more-events") {
      await loadEvents();
    }
  } catch(error){displayError(error);}
});
document.addEventListener("submit",async(event)=>{
  const form=event.target;
  if (!["workflow-form","review-form","recover-form","compare-form","intake-form"].includes(form.id))return;
  event.preventDefault();
  const submit=form.querySelector('button[type="submit"]');if(submit)submit.disabled=true;
  try {
    if(form.id==="workflow-form") {
      const body=collectWorkflow();body.expected_revision=selectedRecord?.revision_sha256;
      const saved=await api("workflows",body);await refreshState();await show("workflow",saved.id);notice("Workflow saved.");
    } else if(form.id==="review-form") {
      const input=Object.fromEntries(new FormData(form));
      const op=await api("workflows/"+encodeURIComponent(selectedRecord.id)+"/review",{...input,expected_revision:selectedRecord.revision_sha256});
      await refreshState();await show("operation",op.id);notice("Reviewed operation saved.");
    } else if(form.id==="recover-form") {
      const id=new FormData(form).get("native_run_id");await startNative("recover",id?{native_run_id:id}:{});
    } else if(form.id==="compare-form") {
      const right=selectedRecord.id,left=new FormData(form).get("left_id");
      notice("Comparing complete editions.");
      const result=await waitTask(await api("compare",{left_id:left,right_id:right,request_id:uid()}));
      if(selection.kind==="edition" && selection.id===right){await show("edition",right);$("comparison").innerHTML=renderComparisons([result]);}
      notice("Complete edition comparison saved.");
    } else if(form.id==="intake-form") {
      if(!intake || !intakeObject)throw new Error("Select the original workflow document.");
      for(const original of intake.sourceFiles || []) {
        const file=$("intake-source-"+original.id).files[0];
        if(!file)throw new Error("Select "+original.filename+".");
        notice("Retaining "+original.filename+".");
        const uploaded=await api("files?filename="+encodeURIComponent(file.name)+"&max_bytes=2147483648",file,true);
        intakeFiles[original.id]=uploaded.object;
      }
      const saved=await api("adopt",{input_object:intakeObject,files:intakeFiles,
        account:{organization_id:$("intake-organization").value},actor:$("intake-actor").value});
      $("intake-dialog").close();await refreshState();await show("workflow",saved.id);notice("Original customer workflow adopted.");
    }
  } catch(error){displayError(error);}
  finally{if(submit && submit.isConnected)submit.disabled=false;}
});
document.addEventListener("input",(event)=>{if(event.target.closest("#workflow-form"))workflowDirty=true;});
document.addEventListener("change",async(event)=>{
  try {
    if(event.target.id==="script-file") {
      const file=event.target.files[0];if(!file)return;
      draft=collectWorkflow().definition;
      notice("Retaining "+file.name+".");
      const source=await api("files?filename="+encodeURIComponent(file.name),file,true);
      draft.job.script={filename:file.name,object:source.object};workflowDirty=true;renderWorkflow();notice("Original script retained. Save the workflow to include it.");
    } else if(event.target.id==="dataset-select") {
      rowDataset=event.target.value;rowOffset=0;await loadRows();
    } else if(event.target.id==="log-capture") {
      logCapture=Number(event.target.value); logOffset=0; await loadLogs();
    } else if(event.target.id==="intake-document") {
      const file=event.target.files[0];if(!file)return;
      if(file.size>1048576)throw new Error("Select an original workflow document within 1 MiB.");
      intake=JSON.parse(await file.text());
      if(intake.schema!=="wherobots.customer-workflow.v1")throw new Error("Select a wherobots.customer-workflow.v1 document.");
      const ref=await api("files?filename="+encodeURIComponent(file.name),file,true);intakeObject=ref.object;intakeFiles={};
      $("intake-required").innerHTML='<h3>Original source files</h3>'+intake.sourceFiles.map((f)=>'<label>'+esc(f.filename+" · "+f.role+" · "+f.bytes+" bytes")+'<input type="file" id="intake-source-'+esc(f.id)+'" required><span class="identity">'+esc(f.sha256)+'</span></label>').join("");
    } else if(event.target.id==="package-file") {
      const file=event.target.files[0];if(!file)return;
      notice("Receiving the complete handover.");
      const result=await waitTask(await api("import/handover?request_id="+uid(),file,true));await refreshState();
      notice("Handover received.\n"+pretty(result));
      const id=result.workflow_id || result.workflowId;
      if(id && state.workflows.some((w)=>w.id===id))await show("workflow",id);
    }
  } catch(error){displayError(error);}
});
$("new-workflow").onclick=()=>newWorkflow();
$("adopt-intake").onclick=()=>{$("intake-organization").value=runtime.organization_id || "";$("intake-dialog").showModal();};
$("import-package").onclick=()=>$("package-file").click();
(async()=>{
  try {
    await api("session",{});runtime=await api("runtime");await refreshState();
    const previous=JSON.parse(sessionStorage.getItem("wherobots_selection") || "null");
    if(previous?.id){try{await show(previous.kind,previous.id);}catch{newWorkflow();}}
    else if(state.workflows.length)await show("workflow",state.workflows[0].id);
    else newWorkflow();
    setInterval(()=>refreshState().catch(displayError),5000);
  } catch(error){$("connection").textContent="Connection required";displayError(error);}
})();
