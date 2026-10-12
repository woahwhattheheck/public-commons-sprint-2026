import {createArchivePanel} from "/assets/archive.js";
import {createCompanionPanel} from "/assets/companions.js";
const $ = id => document.getElementById(id);
const terminal = new Set(["COMPLETE", "FAILED"]);
const S = {token: "", workspace: "", state: null, sourceId: "", source: null, rows: [], selectedRow: null,
  family: "tasks", offset: 0, profile: "mspdi", probes: {}, deployId: "", deployment: null,
  comparison: null, comparisonLimit: 50, definitionLimit: 50, pending: null, posting: false, polling: false, timer: null,
  corrections: [], sourceReview: null, sourceArtifacts: [], handoverArtifacts: [], editions: [], deployments: [],
  requests: [], requestCursor: "", editionCursor: "", deploymentCursor: "", draftVersion: 0, mappings: null};
const defaults = [
  {field: "NAME", target: "msdyn_subject", convert: "text", options: ""},
  {field: "START", target: "msdyn_scheduledstart", convert: "utc", options: ""},
  {field: "FINISH", target: "msdyn_scheduledend", convert: "utc", options: ""}
];
const el = (name, text, cls) => { const n = document.createElement(name); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const pretty = value => JSON.stringify(value, null, 2);
const short = value => value ? String(value).slice(0, 12) : "—";
const stable = value => JSON.stringify(sort(value));
function sort(value) { if (Array.isArray(value)) return value.map(sort); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])])); return value; }
function id() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, "0")).join(""); }
function notice(message, error=false) { $("notice").textContent = message || ""; $("notice").classList.toggle("error", error); }
function key(name) { return "portfolio-desk:" + S.workspace + ":" + name; }
function store(name, value) { localStorage.setItem(key(name), JSON.stringify(value)); }
function stored(name, fallback) { try { const raw = localStorage.getItem(key(name)); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
function object(id, fallback={}) { const raw = $(id).value.trim(); const value = raw ? JSON.parse(raw) : fallback; if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(id + " must be a JSON object."); return value; }
function available(id, yes) { $(id).dataset.unavailable = yes ? "false" : "true"; }
function lock() {
  const busy = S.posting || !!S.pending;
  document.querySelectorAll("#workspace input, #workspace textarea, #workspace select, #workspace button").forEach(n => {
    if (n.matches("[data-read],[data-tab],#pause-request,#recover-request,#discard-request")) return;
    n.disabled = busy || n.dataset.unavailable === "true";
  });
  $("active-label").textContent = S.pending ? "Saved request · " + S.pending.kind : S.posting ? "Saving local request…" : "No active request";
  $("active-detail").textContent = S.pending ? S.pending.request_id + " · " + (S.pending.observed_state || "Awaiting saved response") : "";
  $("recover-request").hidden = !S.pending || S.posting;
  $("discard-request").hidden = !S.pending || S.pending.observed_state !== "NOT_STARTED";
  $("pause-request").hidden = !(S.pending && S.pending.arguments.deployment_id &&
    ["continue", "abandon_set"].includes(S.pending.kind));
}
function formDraft() {
  const values = {};
  document.querySelectorAll("[data-draft]").forEach(n => values[n.id] = n.type === "checkbox" ? n.checked : n.value);
  return {values, sourceId:S.sourceId, deployId:S.deployId, profile:S.profile,
    mappings:readMappings(false), corrections:S.corrections, sourceReview:S.sourceReview ? {id:S.sourceReview.id,ready:S.sourceReview.ready,edition_id:S.sourceReview.edition_id} : null,
    sourceArtifacts:S.sourceArtifacts, handoverArtifacts:S.handoverArtifacts, probes:S.probes,
    archive:archivePanel.snapshot(),companions:companionPanel.snapshot()};
}
function saveDraft() { if (!S.workspace) return; S.draftVersion++; store("draft", formDraft()); }
function showTab(name) {
  document.querySelectorAll("[data-tab]").forEach(n => n.classList.toggle("selected", n.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(n => n.hidden = n.id !== "panel-" + name);
}
function details(target, values) {
  const dl = el("dl");
  for (const [label,value] of Object.entries(values)) {
    dl.append(el("dt", label), el("dd", typeof value === "object" ? pretty(value) : String(value ?? "—")));
  }
  target.replaceChildren(dl);
}
async function api(path, {method="GET", body, raw, headers={}}={}) {
  const response = await fetch(path, {method, credentials:"omit", cache:"no-store",
    headers:{"Authorization":"Bearer " + S.token, ...(body === undefined ? {} : {"Content-Type":"application/json"}), ...headers},
    body:body === undefined ? raw : JSON.stringify(body)});
  let value;
  try { value = await response.json(); } catch { throw Object.assign(new Error("The local response ended before complete JSON."), {status:response.status}); }
  if (!response.ok) {
    const error = Object.assign(new Error(value.error?.message || "Local request failed."), {status:response.status, code:value.error?.code});
    if (response.status === 401 || response.status === 403) { $("signin").hidden = false; notice("Open the current local link or sign in again. The saved request remains available.", true); }
    throw error;
  }
  return value;
}
async function download(path, filename) {
  const response = await fetch(path, {headers:{"Authorization":"Bearer " + S.token}, credentials:"omit", cache:"no-store"});
  if (!response.ok) { const value = await response.json().catch(() => ({})); throw new Error(value.error?.message || "Artifact download failed."); }
  const blob = await response.blob(), url = URL.createObjectURL(blob), a = el("a");
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function mergeArtifacts(...groups) {
  const seen=new Set(), result=[];
  for (const items of groups) for (const item of items || []) {
    const identity=stable(item);
    if (!seen.has(identity)) {seen.add(identity);result.push(item);}
  }
  return result;
}
function artifacts(node, items) {
  node.replaceChildren();
  for (const item of mergeArtifacts(items)) {
    const b = el("button", item.filename + " · " + (item.bytes ?? "saved") + " bytes");
    b.dataset.read = ""; b.title = item.sha256 || "";
    b.addEventListener("click", () => safe(() => download(item.kind === "workspace_archive" ?
      "/api/archives/" + item.request_id : "/api/download/" + item.sha256 + "?filename=" + encodeURIComponent(item.filename), item.filename)));
    node.append(b);
  }
}
function mergeRows(old, incoming) { const index = new Map(old.map(row => [row.id,row])); for (const row of incoming) index.set(row.id,row); return [...index.values()].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id.localeCompare(a.id)); }
function options(select, rows, selected, label) {
  select.replaceChildren();
  select.append(new Option("Select a saved item", ""));
  for (const row of rows) select.append(new Option(label(row), row.id));
  if (selected && !rows.some(row=>row.id===selected)) select.append(new Option(short(selected) + " · selected saved item", selected));
  select.value = selected;
}
async function refreshState() {
  const value = await api("/api/state");
  const first = S.state === null;
  S.state = value;
  S.editions = mergeRows(S.editions, value.editions.items);
  S.deployments = mergeRows(S.deployments, value.deployments.items);
  S.requests = mergeRows(S.requests, value.requests.items);
  if (first) {
    S.editionCursor = value.editions.next_cursor || "";
    S.deploymentCursor = value.deployments.next_cursor || "";
    S.requestCursor = value.requests.next_cursor || "";
  }
  renderSelectors(); renderHistory(); renderTarget(); lock();
}
function renderSelectors() {
  archivePanel.updateState(S.state||{},S.editions);
  options($("source-edition"), S.editions, S.sourceId, row => short(row.id) + " · " + row.kind + " · " + String(row.created_at || ""));
  options($("deployment-select"), S.deployments, S.deployId, row => (row.project_name || short(row.id)) + " · " + row.state);
  $("more-editions").hidden = !S.editionCursor; $("more-deployments").hidden = !S.deploymentCursor;
}
async function loadSource(selected=S.sourceId) {
  if (!selected) { S.source=null; S.rows=[]; renderSource(); await companionPanel.load(""); return; }
  const value = await api("/api/editions/" + selected);
  if (S.sourceId !== selected) return;
  S.source = value; renderSource(); await loadRows();await companionPanel.load(selected);
}
function renderSource() {
  if (!S.source) { $("source-summary").replaceChildren(el("p", "Retain or select an original source edition.", "empty")); return; }
  details($("source-summary"), {"Edition":S.source.id,"Kind":S.source.kind,"Source files":S.source.source_ids,"Native row counts":S.source.model.counts,"Original findings":S.source.findings});
  available("export-source",true); available("prepare-target",true);
  $("prepare-context").textContent = "Selected source edition: " + S.source.id;
  lock();
}
async function loadRows() {
  if (!S.sourceId) return;
  const selected=S.sourceId, family=S.family, offset=S.offset;
  const value = await api("/api/editions/" + selected + "?family=" + family + "&offset=" + offset + "&limit=50");
  if (selected!==S.sourceId || family!==S.family || offset!==S.offset) return;
  S.rows=value.items; S.nextOffset=value.next_offset;
  $("source-range").textContent = value.total ? "Rows " + (offset+1) + "–" + (offset+value.items.length) + " of " + value.total : "This original family has no rows.";
  $("source-previous").disabled = offset===0; $("source-next").disabled = value.next_offset===null;
  const tbody=$("source-table").tBodies[0]; tbody.replaceChildren();
  for (const row of value.items) {
    const tr=el("tr"), button=el("button","Inspect fields"); button.dataset.read="";
    button.onclick=()=>selectRow(row);
    tr.append(el("td",row.key,"mono"),el("td",String(row.fields?.NAME?.value ?? row.guid ?? row.key)),el("td",row.uid ?? "—"),el("td")); tr.lastChild.append(button); tbody.append(tr);
  }
}
function selectRow(row) {
  S.selectedRow=row; $("correction-row").value=S.family + " / " + row.key;
  const select=$("correction-field"); select.replaceChildren();
  for (const field of Object.keys(row.fields || {}).sort()) select.append(new Option(field,field));
  const holder=$("source-row-detail"); holder.replaceChildren(el("h3","Original fields · " + row.key));
  const pre=el("pre",pretty(row)); holder.append(pre);
  setCorrectionField(); lock();
}
function setCorrectionField() {
  const value=S.selectedRow?.fields?.[$("correction-field").value];
  $("correction-before").textContent=pretty(value);
  $("correction-after").value=value ? pretty(value) : "";
}
function renderCorrections() {
  const node=$("correction-list"); node.replaceChildren();
  for (const [i, change] of S.corrections.entries()) {
    const detail=el("details"),summary=el("summary",change.family + "/" + change.key + " · " + change.field);
    detail.append(summary,el("pre",pretty({before:change.before,after:change.after})));
    const b=el("button","Remove correction"); b.onclick=()=>{S.corrections.splice(i,1);renderCorrections();saveDraft();};detail.append(b);node.append(detail);
  }
  $("source-review").replaceChildren();
  if (S.sourceReview) { details($("source-review"),{"Saved review":S.sourceReview.id,"Ready":S.sourceReview.ready,"Findings":S.sourceReview.findings}); }
  available("apply-source",!!S.sourceReview?.ready); lock();
}
function renderMappingRows(rows) {
  const tbody=$("mapping-table").tBodies[0]; tbody.replaceChildren();
  for (const row of rows) {
    const tr=el("tr");
    const field=el("input"),target=el("input"),choice=el("select"),options=el("input");
    field.value=row.field;target.value=row.target;options.value=row.options || "";
    field.dataset.mapping="field";target.dataset.mapping="target";choice.dataset.mapping="convert";options.dataset.mapping="options";
    for (const value of ["text","utc","integer","number","percent_fraction","boolean","choice"]) choice.append(new Option(value,value));
    choice.value=row.convert;
    for (const n of [field,target,choice,options]) {const td=el("td");td.append(n);tr.append(td);n.oninput=()=>safe(()=>saveDraft());}
    const td=el("td"),remove=el("button","Remove");remove.onclick=()=>{tr.remove();saveDraft();};td.append(remove);tr.append(td);tbody.append(tr);
  } lock();
}
function readMappings(validate=true) {
  return [...$("mapping-table").tBodies[0].rows].map(row => {
    const item=Object.fromEntries([...row.querySelectorAll("[data-mapping]")].map(n=>[n.dataset.mapping,n.value.trim()]));
    if (validate && (!item.field || !item.target)) throw new Error("Each task mapping needs a source field and native target field.");
    return item;
  });
}
function mappingArguments() {
  const result={...object("extra-mappings"),task_fields:{},dependency_types:object("dependency-map"),resource_team_members:object("resource-map")};
  for (const item of readMappings()) {
    if (result.task_fields[item.field]) throw new Error("A source field appears twice in the mappings.");
    const rule={target:item.target,convert:item.convert};
    if (item.options) {
      if (item.convert==="choice") rule.values=JSON.parse(item.options);
      else if (item.options.startsWith("{")) Object.assign(rule,JSON.parse(item.options));
      else rule.timezone=item.options;
    }
    result.task_fields[item.field]=rule;
  }
  const name=$("project-name").value.trim(); if (name) result.project_name=name;
  result.existing_project=$("existing-project").checked;
  if (result.existing_project) result.project_id=$("project-guid").value.trim();
  return result;
}
function renderTarget() {
  const select=$("target-profile"),profiles=S.state?.profiles || [];
  select.replaceChildren();for (const p of profiles) select.append(new Option(p.label || p.id,p.id));
  if (!profiles.some(p=>p.id===S.profile)) S.profile=profiles[0]?.id || "mspdi"; select.value=S.profile;
  const p=profiles.find(p=>p.id===S.profile);
  details($("target-description"),p ? {"Type":p.kind,"Origin":p.api_origin || "Retained Project XML","User":p.user_id || "Receiving file operator","Source time zone":p.source_timezone || "Select per date mapping"} : {});
  const probe=S.probes[S.profile]; $("target-probe").replaceChildren();$("dependency-options").replaceChildren();
  if (probe) {
    details($("target-probe"),{"Saved native probe":probe.object_sha256 || "Local native reader","Captured":probe.probe?.captured_at || probe.probe?.at || "Retained","Identity":probe.probe?.identity || probe.native});
    if (probe.probe?.link_type_choices) details($("dependency-options"),{"Native dependency choices":probe.probe.link_type_choices});
  }
  lock();
}
async function loadDeployment(selected=S.deployId) {
  if (!selected) {S.deployment=null;renderDeployment();return;}
  const value=await api("/api/deployments/" + selected);
  if (selected!==S.deployId) return;
  S.deployment=value;renderDeployment();
  if (value.comparison_sha256) {
    const comparison=await api("/api/objects/" + value.comparison_sha256);
    if (S.deployId!==selected || S.deployment.comparison_sha256!==value.comparison_sha256) return;
    S.comparison=comparison;S.comparisonLimit=50;S.definitionLimit=50;renderComparison();
  } else {S.comparison=null;renderComparison();}
  if (value.export_result_sha256) {
    const exported=await api("/api/objects/" + value.export_result_sha256);
    if (selected===S.deployId) artifacts($("export-artifacts"),exported.download ? [exported.download] : []);
  } else $("export-artifacts").replaceChildren();
  if (value.pending_detail_observation_sha256) {
    const native=await api("/api/objects/" + value.pending_detail_observation_sha256);
    if (selected===S.deployId) {
      const holder=$("native-detail-source"); holder.replaceChildren();
      for (const row of native.review_rows || []) {
        const detail=el("details");detail.append(el("summary",row.entity+" / "+row.record_id),el("pre",pretty(row.native)));
        const use=el("button","Select this exact native detail");use.dataset.read="";
        use.onclick=()=>{$("detail-id").value=row.detail_id;$("detail-sha").value=row.sha256;};
        detail.append(use);holder.append(detail);
      }
      const source=el("details");source.append(el("summary","Complete native collection and pages"),el("pre",pretty(native.native_collection || native)));holder.append(source);
    }
  } else $("native-detail-source").replaceChildren();
}
function renderDeployment() {
  const d=S.deployment,plan=d?.plan;
  $("deployment-summary").replaceChildren();$("plan-findings").replaceChildren();$("native-calls").replaceChildren();$("native-batches").replaceChildren();
  if (!d) { $("deployment-summary").append(el("p","Select or prepare a migration.","empty")); return; }
  details($("deployment-summary"),{"Migration":d.id,"State":d.state,"Revision":d.revision,"Original source":d.source_edition_id,
    "Target project":d.project_id || "Project XML","Saved review":d.review_sha256 || "Awaiting review","Following":d.parent_deployment_id || "Original migration"});
  details($("plan-summary"),{"Plan":d.plan_digest,"Target":plan.project_name || plan.profile?.label,"Native counts":plan.counts || "Original native Project XML export",
    "Source review":plan.source_review || "Prepared field mappings and target findings"});
  $("plan-json").textContent=pretty(plan);
  for (const item of plan.findings || []) {
    const wrap=el("div",undefined,"finding"),label=el("label",undefined,"check"),cb=el("input");
    cb.type="checkbox";cb.dataset.finding=item.id;
    cb.checked=d.review?.accepted_findings?.includes(item.id) || false;
    label.append(cb,el("span",item.code));wrap.append(label,el("p",item.message));
    if (item.fields?.length || item.keys?.length) { const details=el("details");details.append(el("summary","Selected source values"),el("pre",pretty({keys:item.keys,fields:item.fields})));wrap.append(details); }
    $("plan-findings").append(wrap);
  }
  for (const batch of d.batches || []) details($("native-batches").appendChild(el("section",undefined,"well")),
    {"Set":batch.operation_set_id,"Batch":batch.number,"State":batch.state,"Native state":batch.native_status?.label || batch.native_status?.status});
  $("detail-call").replaceChildren();$("abandon-set").replaceChildren();
  for (const [callKey,call] of Object.entries(d.calls || {})) {
    const row=el("details");row.append(el("summary",callKey + " · " + call.state),el("pre",pretty(call)));
    const b=el("button","Read original call request");b.dataset.read="";b.onclick=()=>safe(async()=>{const raw=await api("/api/objects/"+call.request_sha256);row.append(el("pre",pretty(raw)));});row.append(b);
    $("native-calls").append(row);
    if (["INVOKING","UNKNOWN"].includes(call.state) && callKey.includes(":row:")) $("detail-call").append(new Option(callKey,callKey));
  }
  for (const batch of d.batches || []) if (batch.state!=="COMPLETE" && batch.state!=="ABANDONED") $("abandon-set").append(new Option("Batch " + batch.number + " · " + batch.operation_set_id,batch.operation_set_id));
  $("native-error").replaceChildren(d.error ? el("pre",pretty(d.error),"well") : el("span"));
  $("receiving-context").textContent="Selected migration " + d.id + " · " + d.state;
  const native=plan.schema==="portfolio.target-plan.v1";
  $("capture-target").hidden=!native; $("receive-file-form").hidden=native;
  available("review-target",["PREPARED","REVIEWED"].includes(d.state));
  available("continue-target",!!d.review_sha256 && !["NATIVE_COMPLETE","CAPTURED","ACCEPTED","EXPORTED"].includes(d.state));
  available("capture-target",native && ["NATIVE_COMPLETE","CAPTURED","ACCEPTED"].includes(d.state));
  available("accept-target",["CAPTURED","ACCEPTED"].includes(d.state) && !!d.comparison_sha256);
  available("build-handover",d.state==="ACCEPTED");
  available("prepare-correction",native && ["NATIVE_COMPLETE","CAPTURED","ACCEPTED"].includes(d.state) && !!S.sourceId);
  available("adopt-detail",$("detail-call").options.length>0);
  available("abandon-native",$("abandon-set").options.length>0);
  details($("acceptance-summary"),d.acceptance ? {"Accepted":d.acceptance.accepted_at,"Operator":d.acceptance.reviewer,"Decision":d.acceptance.note,"Retained differences":d.acceptance.exceptions} : {"Acceptance":"Review the actual current target comparison."});
  lock();
}
function renderComparison() {
  const c=S.comparison, body=$("comparison-table").tBodies[0], definitions=$("definition-table").tBodies[0];
  body.replaceChildren();definitions.replaceChildren();
  $("comparison-summary").replaceChildren();$("identity-findings").replaceChildren();
  $("definition-summary").replaceChildren();$("definition-sources").replaceChildren();
  $("definition-section").hidden=!c;$("definition-more").hidden=true;
  if (!c) { $("comparison-summary").append(el("p","Receive the actual target to compare original typed fields.","empty"));$("comparison-more").hidden=true;return; }
  details($("comparison-summary"),{"Comparison":c.id,"Summary":c.summary,"Original":c.left_id,"Received":c.right_id,
    "Strict native identities":c.strict_identity ?? false,"Findings":c.findings || []});
  if (S.deployment?.capture_identity_findings?.length) $("identity-findings").append(el("pre",pretty(S.deployment.capture_identity_findings),"well"));
  for (const change of (c.changes || []).slice(0,S.comparisonLimit)) {
    const tr=el("tr");tr.append(el("td",change.family + " / " + (change.left_key || "—")),el("td",(change.right_key || "—") + " / " + change.path),el("td",change.kind),
      el("td",pretty(change.before)),el("td",pretty(change.after)));body.append(tr);
  }
  $("comparison-more").hidden=(c.changes || []).length<=S.comparisonLimit;
  if (!Array.isArray(c.definition_changes) || !c.definition_sources) {
    $("definition-summary").append(el("p","This saved comparison has no native definition coverage.","empty"));return;
  }
  const changes=c.definition_changes;
  $("definition-summary").append(el("p","Showing " + Math.min(S.definitionLimit,changes.length) + " of " + changes.length +
    " native definition changes. Paths identify the original field catalogue or native JSON collection."));
  const sourceTable=el("table"),head=el("thead"),headRow=el("tr"),sourceBody=el("tbody");
  for (const heading of ["Compared edition","Field catalogue SHA-256","Native JSON identity","Retained collections SHA-256"]) headRow.append(el("th",heading));
  head.append(headRow);sourceTable.append(head,sourceBody);
  for (const [side,label] of [["left","Original / intended"],["right","Received"]]) {
    const source=c.definition_sources[side] || {},tr=el("tr");tr.append(el("td",label));
    for (const field of ["field_catalogue_sha256","native_json_identity","retained_collections_sha256"]) {
      const cell=el("td");cell.append(el("pre",pretty(source[field])));tr.append(cell);
    }
    sourceBody.append(tr);
  }
  $("definition-sources").append(sourceTable);
  for (const change of changes.slice(0,S.definitionLimit)) {
    const tr=el("tr");tr.append(el("td",change.scope),el("td",change.path),el("td",change.kind));
    for (const value of [change.before,change.after]) {const cell=el("td");cell.append(el("pre",pretty(value)));tr.append(cell);}
    definitions.append(tr);
  }
  $("definition-more").hidden=changes.length<=S.definitionLimit;
}
function renderHistory() {
  const node=$("history-table");node.replaceChildren();
  for (const request of S.requests) {
    const item=el("div",undefined,"finding"),b=el("button",request.kind + " · " + request.state + " · " + short(request.id));
    b.dataset.read="";b.onclick=()=>safe(async()=>{const value=await api("/api/requests/"+request.id);$("history-result").replaceChildren(el("pre",pretty(value)));const open=el("button","Open saved result");open.dataset.read="";open.onclick=()=>safe(()=>applyResult(value,{sourceId:S.sourceId,deployId:S.deployId}));$("history-result").append(open);
      if (value.error?.evidence_sha256) {const evidence=el("button","Read original provider response");evidence.dataset.read="";evidence.onclick=()=>safe(async()=>{$("history-result").append(el("pre",pretty(await api("/api/objects/"+value.error.evidence_sha256))));});$("history-result").append(evidence);}
      if (value.state!=="COMPLETE") {const resume=el("button",value.state==="FAILED" ? "Retry this same saved request" : "Resume this same saved request");resume.onclick=()=>safe(()=>adoptRequest(value));$("history-result").append(resume);}
    });item.append(b,el("p",request.id,"mono"));node.append(item);
  }
  if (S.requestCursor) {const more=el("button","More original requests");more.dataset.read="";more.onclick=()=>safe(async()=>{const value=await api("/api/requests?cursor="+S.requestCursor);S.requests=mergeRows(S.requests,value.items);S.requestCursor=value.next_cursor || "";renderHistory();});node.append(more);}
}
function savePending(value) {
  // Persist exact input before admission. A storage failure leaves it unsent.
  store("pending",value); S.pending=value; lock();
}
async function action(kind,args,extraContext={}) {
  if (S.pending || S.posting) throw new Error("Finish or reopen the saved request first.");
  saveDraft();
  const value={request_id:id(),kind,arguments:args,context:{sourceId:S.sourceId,deployId:S.deployId,draftVersion:S.draftVersion,...extraContext},observed_state:"PREPARED"};
  savePending(value); await sendPending(false);
}
async function sendPending(resume) {
  if (!S.pending || S.posting) return;
  const value=S.pending;S.posting=true;lock();
  try {
    const response=await api(resume ? "/api/requests/"+value.request_id+"/resume" : "/api/actions",
      {method:"POST",body:resume ? {retry_failed:true} : {request_id:value.request_id,kind:value.kind,arguments:value.arguments}});
    if (S.pending?.request_id===value.request_id) {savePending({...S.pending,observed_state:response.state});schedulePoll(0);}
  } catch(error) {notice(error.message,true);schedulePoll(500);}
  finally {S.posting=false;lock();}
}
function schedulePoll(delay=1800) {clearTimeout(S.timer);if (S.pending) S.timer=setTimeout(()=>safe(poll),delay);}
async function poll() {
  if (!S.pending || S.polling) return;
  const original=S.pending;S.polling=true;
  try {
    const current=await api("/api/requests/"+original.request_id);
    if (S.pending?.request_id!==original.request_id) return;
    if (current.kind!==original.kind || stable(current.arguments)!==stable(original.arguments)) throw new Error("The saved request has different original input. Reopen its retained history.");
    if (terminal.has(current.state)) {
      store("pending",null);S.pending=null;lock();
      S.requests=mergeRows(S.requests,[current]);renderHistory();
      await applyResult(current,original.context);
      notice(current.state==="FAILED" ? current.error?.message || "The saved action failed; its original result is retained." : "Saved action complete · "+current.kind,current.state==="FAILED");
    } else {savePending({...original,observed_state:current.state});}
  } catch(error) {
    if (error.status===404 && S.pending?.request_id===original.request_id) savePending({...original,observed_state:"NOT_STARTED"});
    else notice(error.message,true);
  } finally {S.polling=false;lock();if (S.pending && S.pending.observed_state!=="NOT_STARTED") schedulePoll();}
}
async function adoptRequest(request) {
  if (S.pending && S.pending.request_id!==request.id) throw new Error("Keep the current saved request until it finishes.");
  savePending({request_id:request.id,kind:request.kind,arguments:request.arguments,
    context:{sourceId:S.sourceId,deployId:S.deployId},observed_state:request.state});
  await sendPending(true);
}
async function applyResult(request,context={}) {
  if (!request.result_sha256 && !request.result) {await refreshState();return;}
  const result=request.result || await api("/api/objects/"+request.result_sha256);
  $("history-result").replaceChildren(el("pre",pretty({request_id:request.id,kind:request.kind,state:request.state,result})));
  if (request.state!=="COMPLETE") {await refreshState();return;}
  if(await archivePanel.acceptResult(request,result,context)){await refreshState();saveDraft();lock();return;}
  const sourceCurrent=context.sourceId===undefined || context.sourceId===S.sourceId;
  const deploymentCurrent=context.deployId===undefined || context.deployId===S.deployId || result.id===S.deployId;
  if (request.kind==="intake" && sourceCurrent) {S.sourceId=result.id;S.offset=0;S.sourceReview=null;S.corrections=[];$("source-decisions").value="{}";}
  if (request.kind==="source_review" && sourceCurrent) {S.sourceReview=result;renderCorrections();}
  if (request.kind==="source_apply" && sourceCurrent) {S.sourceId=result.edition_id;S.offset=0;S.sourceReview=null;S.corrections=[];$("source-decisions").value="{}";renderCorrections();}
  if (request.kind==="mspdi_export" && result.download) {S.sourceArtifacts=mergeArtifacts(S.sourceArtifacts,[result.download]);artifacts($("source-artifacts"),S.sourceArtifacts);}
  if (request.kind==="probe") {
    const profile=request.arguments.profile_id,p=result.probe;
    S.probes[profile]=p ? {object_sha256:result.object_sha256,probe:{
      schema:p.schema,captured_at:p.captured_at,profile:p.profile,identity:p.identity,user:p.user,
      sha256:p.sha256,status_semantics:p.status_semantics,link_type_choices:p.link_type_choices
    }} : result;renderTarget();
  }
  if (["prepare","prepare_adjustment","review","continue","adopt_detail","capture_target","receive_target_file","accept","abandon_set"].includes(request.kind) && deploymentCurrent) {
    S.deployId=result.id;await loadDeployment();if (request.kind==="prepare" || request.kind==="prepare_adjustment") showTab("migration");
  }
  if (request.kind==="handover") {S.handoverArtifacts=mergeArtifacts(S.handoverArtifacts,[result.html,result.json]);artifacts($("handover-artifacts"),S.handoverArtifacts);}
  if (request.kind==="archive") {S.handoverArtifacts=mergeArtifacts(S.handoverArtifacts,[{...result.archive,filename:result.filename}]);artifacts($("handover-artifacts"),S.handoverArtifacts);}
  await refreshState();if (S.sourceId && sourceCurrent) await loadSource();saveDraft();lock();
}
async function uploadArchive(file) {
  if(!file||file.size>8*1024**3)throw new Error("Select the complete original reporting archive up to 8 GiB.");
  return api("/api/archive-upload",{method:"POST",raw:file,headers:{"Content-Type":"application/octet-stream","X-Source-Name":encodeURIComponent(file.name)}});
}
async function upload(file) {
  if (!file || file.size>256*1024*1024) throw new Error("Select a complete source file up to 256 MiB.");
  return api("/api/upload",{method:"POST",raw:file,headers:{"Content-Type":"application/octet-stream","X-Source-Name":encodeURIComponent(file.name)}});
}
async function safe(fn) {try {await fn();} catch(error) {notice(error.message || String(error),true);lock();}}
function requireSource() {if (!S.sourceId) throw new Error("Select the original source edition.");return S.sourceId;}
function requireDeployment() {if (!S.deployment) throw new Error("Select the original saved migration.");return S.deployment;}
function selectedReviewArgs() {const d=requireDeployment();if(!d.review_sha256)throw new Error("Save the exact target review first.");return{deployment_id:d.id,review_sha256:d.review_sha256};}

const sharedPanelContext={$,el,pretty,short,api,safe,artifacts,notice,lock,saveDraft,action,upload,uploadArchive,showTab,
  busy:()=>S.posting||!!S.pending,sourceId:()=>S.sourceId,
  setPosting:value=>{S.posting=value;lock();}};
const archivePanel=createArchivePanel(sharedPanelContext);
const companionPanel=createCompanionPanel({...sharedPanelContext,
  invalidateReview:()=>{S.sourceReview=null;renderCorrections();}});

document.querySelectorAll("[data-tab]").forEach(n=>n.onclick=()=>showTab(n.dataset.tab));
document.querySelectorAll("[data-draft]").forEach(n=>n.addEventListener("input",()=>safe(()=>saveDraft())));
$("source-edition").onchange=()=>safe(async()=>{S.sourceId=$("source-edition").value;S.offset=0;S.selectedRow=null;S.corrections=[];S.sourceReview=null;$("source-decisions").value="{}";renderCorrections();await loadSource();saveDraft();});
$("source-family").onchange=()=>safe(async()=>{S.family=$("source-family").value;S.offset=0;S.selectedRow=null;await loadRows();});
$("source-previous").onclick=()=>safe(async()=>{S.offset=Math.max(0,S.offset-50);await loadRows();});
$("source-next").onclick=()=>safe(async()=>{if(S.nextOffset!==null){S.offset=S.nextOffset;await loadRows();}});
$("correction-field").onchange=setCorrectionField;
$("add-correction").onclick=()=>safe(()=>{requireSource();const row=S.selectedRow,field=$("correction-field").value;if(!row || !field)throw new Error("Choose an original field.");
 const after=JSON.parse($("correction-after").value);if(!after || typeof after!=="object" || !("type"in after) || !("value"in after))throw new Error("Use the full original typed-value shape.");
 const change={family:S.family,key:row.key,field,before:row.fields[field],after};const i=S.corrections.findIndex(x=>x.family===change.family&&x.key===change.key&&x.field===field);if(i>=0)S.corrections[i]=change;else S.corrections.push(change);S.sourceReview=null;renderCorrections();saveDraft();});
$("clear-corrections").onclick=()=>safe(()=>{S.corrections=[];S.sourceReview=null;renderCorrections();saveDraft();});
$("review-source").onclick=()=>safe(()=>action("source_review",{edition_id:requireSource(),target_profile:{kind:"mspdi",...object("export-profile")},decisions:object("source-decisions"),corrections:S.corrections,mappings:companionPanel.mappings()}));
$("apply-source").onclick=()=>safe(()=>{if(!S.sourceReview?.ready)throw new Error("Finish the saved source review.");return action("source_apply",{review_id:S.sourceReview.id});});
$("export-source").onclick=()=>safe(()=>action("mspdi_export",{edition_id:requireSource(),profile:object("export-profile")}));
$("intake-form").onsubmit=event=>{event.preventDefault();safe(async()=>{
 if(S.pending||S.posting)throw new Error("Finish the saved request first.");
 const selectedFile=$("source-file").files[0],selectedCompanions=companionPanel.descriptors(),selectedLabel=$("source-label").value.trim(),selectedProfile=object("read-profile");
 S.posting=true;lock();let source,companions;
 try {source=await upload(selectedFile);companions=[];for(const selected of selectedCompanions)companions.push({source:await upload(selected.file),label:selected.label,profile:selected.profile});}
 finally {S.posting=false;lock();}
 await action("intake",{source,companions,label:selectedLabel||source.filename,profile:selectedProfile});
});};
$("target-profile").onchange=()=>safe(()=>{S.profile=$("target-profile").value;renderTarget();saveDraft();});
$("probe-target").onclick=()=>safe(()=>action("probe",{profile_id:S.profile}));
$("add-mapping").onclick=()=>safe(()=>{renderMappingRows([...readMappings(false),{field:"",target:"",convert:"text",options:""}]);saveDraft();});
$("prepare-target").onclick=()=>safe(()=>{const edition_id=requireSource(),profile_id=S.profile,p=S.state.profiles.find(p=>p.id===profile_id);
 if(p.kind==="mspdi")return action("prepare",{edition_id,profile_id,export_profile:object("export-profile"),decisions:object("source-decisions"),corrections:[]});
 const probe=S.probes[profile_id];if(!probe?.object_sha256)throw new Error("Read the actual target capabilities first.");
 return action("prepare",{edition_id,profile_id,probe_sha256:probe.object_sha256,mappings:mappingArguments()});});
$("prepare-correction").onclick=()=>safe(()=>{const d=requireDeployment(),maps=mappingArguments();return action("prepare_adjustment",{deployment_id:d.id,expected_revision:d.revision,edition_id:requireSource(),mappings:{task_fields:maps.task_fields,date_decisions:maps.date_decisions||{}}});});
$("deployment-select").onchange=()=>safe(async()=>{S.deployId=$("deployment-select").value;await loadDeployment();saveDraft();});
$("review-target").onclick=()=>safe(()=>{const d=requireDeployment();return action("review",{deployment_id:d.id,expected_revision:d.revision,reviewer:$("reviewer").value.trim(),note:$("review-note").value.trim(),accepted_findings:[...document.querySelectorAll("[data-finding]:checked")].map(x=>x.dataset.finding)});});
$("continue-target").onclick=()=>safe(()=>action("continue",{...selectedReviewArgs(),retry_rejected:$("retry-rejected").checked}));
$("adopt-detail").onclick=()=>safe(()=>action("adopt_detail",{...selectedReviewArgs(),call_key:$("detail-call").value,detail_id:$("detail-id").value.trim(),detail_sha256:$("detail-sha").value.trim(),reviewer:$("reviewer").value.trim(),note:$("detail-note").value.trim()}));
$("abandon-native").onclick=()=>safe(()=>{const d=requireDeployment();return action("abandon_set",{...selectedReviewArgs(),expected_revision:d.revision,operation_set_id:$("abandon-set").value,reviewer:$("reviewer").value.trim(),note:$("abandon-note").value.trim(),retry_rejected:$("retry-rejected").checked});});
$("capture-target").onclick=()=>safe(()=>action("capture_target",{deployment_id:requireDeployment().id,expected_revision:requireDeployment().revision}));
$("receive-file-form").onsubmit=event=>{event.preventDefault();safe(async()=>{const d=requireDeployment();if(S.pending||S.posting)throw new Error("Finish the saved request first.");S.posting=true;lock();let source;try{source=await upload($("target-file").files[0]);}finally{S.posting=false;lock();}return action("receive_target_file",{deployment_id:d.id,expected_revision:d.revision,source,label:$("target-file-label").value.trim()||source.filename,identity_map:object("receive-identity-map")});});};
$("comparison-more").onclick=()=>{S.comparisonLimit+=100;renderComparison();};
$("definition-more").onclick=()=>{S.definitionLimit+=100;renderComparison();};
$("accept-target").onclick=()=>safe(()=>{const d=requireDeployment();return action("accept",{deployment_id:d.id,expected_revision:d.revision,comparison_sha256:d.comparison_sha256,reviewer:$("accept-reviewer").value.trim(),note:$("accept-note").value.trim(),exceptions:$("accept-exceptions").value.split("\n").map(x=>x.trim()).filter(Boolean)});});
$("build-handover").onclick=()=>safe(()=>action("handover",{deployment_id:requireDeployment().id}));
$("export-workspace").onclick=()=>safe(()=>action("archive",{}));
$("pause-request").onclick=()=>safe(async()=>{const deployment_id=S.pending?.arguments.deployment_id;if(!deployment_id)return;await api("/api/deployments/"+deployment_id+"/pause",{method:"POST",body:{request_id:id()}});notice("Pause saved. The current native reply is retained before the next call.");});
$("recover-request").onclick=()=>safe(async()=>{if(!S.pending)return;let current;try{current=await api("/api/requests/"+S.pending.request_id);}catch(error){if(error.status!==404)throw error;}if(current){if(current.state==="COMPLETE")return poll();return sendPending(true);}return sendPending(false);});
$("discard-request").onclick=()=>safe(async()=>{if(!S.pending)return;try{await api("/api/requests/"+S.pending.request_id);throw new Error("The original request now exists; reopen it.");}catch(error){if(error.status!==404)throw error;}store("pending",null);S.pending=null;lock();notice("The absent local request was discarded. Its draft fields remain.");});
$("refresh").onclick=()=>safe(async()=>{await refreshState();if(S.deployId)await loadDeployment();if(S.sourceId)await loadSource();await archivePanel.refresh();if(S.pending)await poll();});
$("more-editions").onclick=()=>safe(async()=>{const v=await api("/api/editions?cursor="+S.editionCursor);S.editions=mergeRows(S.editions,v.items);S.editionCursor=v.next_cursor||"";renderSelectors();});
$("more-deployments").onclick=()=>safe(async()=>{const v=await api("/api/state?cursor="+S.deploymentCursor);S.deployments=mergeRows(S.deployments,v.deployments.items);S.deploymentCursor=v.deployments.next_cursor||"";renderSelectors();});
$("signin-form").onsubmit=event=>{event.preventDefault();safe(async()=>{S.token=$("access-token").value.trim();await boot();$("access-token").value="";});};

async function boot() {
  const hello=await api("/api/hello");
  S.workspace=hello.workspace_id;sessionStorage.setItem("portfolio-token:"+location.origin,S.token);
  $("signin").hidden=true;$("workspace").hidden=false;$("connection").textContent="Local workspace · "+short(S.workspace);
  const draft=stored("draft",{});for(const [identity,value]of Object.entries(draft.values||{})){const n=$(identity);if(n?.hasAttribute("data-draft")){if(n.type==="checkbox")n.checked=!!value;else n.value=value;}}
  archivePanel.restore(draft.archive||{});companionPanel.restore(draft.companions||{});
  S.sourceId=draft.sourceId||"";S.deployId=draft.deployId||"";S.profile=draft.profile||"mspdi";
  S.corrections=draft.corrections||[];S.sourceReview=draft.sourceReview||null;S.probes=draft.probes||{};
  S.sourceArtifacts=mergeArtifacts(draft.sourceArtifacts);S.handoverArtifacts=mergeArtifacts(draft.handoverArtifacts);
  if (S.sourceReview?.id) S.sourceReview=await api("/api/source-reviews/"+S.sourceReview.id);
  renderMappingRows(draft.mappings||defaults);renderCorrections();
  artifacts($("source-artifacts"),S.sourceArtifacts);artifacts($("handover-artifacts"),S.handoverArtifacts);
  S.pending=stored("pending",null);lock();
  await refreshState();if(S.sourceId)await loadSource();if(S.deployId)await loadDeployment();await archivePanel.reopen();
  if(S.pending)schedulePoll(0);notice("Original source, target operations and saved delivery are ready.");
}
const fragment=new URLSearchParams(location.hash.slice(1));S.token=fragment.get("token")||sessionStorage.getItem("portfolio-token:"+location.origin)||"";
if(fragment.has("token"))history.replaceState(null,"",location.pathname+location.search);
renderMappingRows(defaults);
for(const identity of ["apply-source","export-source","prepare-target","prepare-correction","review-target","continue-target","capture-target","accept-target","build-handover","adopt-detail","abandon-native"]) available(identity,false);
if(S.token)safe(boot);else{$("signin").hidden=false;$("connection").textContent="Open the private local link";}
