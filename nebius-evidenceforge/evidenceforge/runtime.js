const config = JSON.parse(document.getElementById("runtimeConfig").textContent);
const $ = id => document.getElementById(id);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const STORAGE = "evidenceforge-operations-v1";
const MODES = new Set(["baseline", "corrected", "nebius"]);
const TABS = new Set(["checks", "source", "plan", "compare", "export"]);
const TASK_LABELS = {
  "invoice-import": {title:"Invoice CSV import", category:"Data intake", short:"Invoices"},
  "dependency-order": {title:"Dependency ordering", category:"Build coordination", short:"Dependencies"},
  "operation-ledger": {title:"Idempotent operation ledger", category:"Reliable operations", short:"Operation ledger"}
};
const tasks = Array.isArray(config.tasks) ? config.tasks : [];
const taskCache = new Map();
let provider = null, taskDetail = null, taskVersion = 0, current = null, recent = [];
let indexRows = [], indexPartial = false, busy = false, opening = false, downloading = false;
let verifiedRun = null, artifacts = null, journal = null, selectedTab = "checks", sourceView = "patch";
let displayedSource = "", taskView = "source", pollTimer = null, selectionVersion = 0;
let providerObservation = null;
let compareRun = null, comparisonVersion = 0, compareAfterRun = null, modeTouched = false;
let storageAvailable = true;

function el(tag, text, className) {
  const out = document.createElement(tag);
  if (text !== undefined && text !== null) out.textContent = String(text);
  if (className) out.className = className;
  return out;
}
function taskLabel(id) { return TASK_LABELS[id]?.title || id || "Retained operation"; }
function modeLabel(mode) {
  return ({nebius:"NVIDIA model · Nebius", corrected:"Authored corrected control", baseline:"Defective source control"})[mode] || "Retained run";
}
function runMode(run) {
  if (MODES.has(run?.execution_mode)) return run.execution_mode;
  if (run?.qualifying_nebius_runtime_observed === true) return "nebius";
  const name = run?.provider?.provider || "";
  if (name.includes("corrected")) return "corrected";
  if (name.includes("baseline")) return "baseline";
  return null;
}
function validIdentity(value) {
  if (!value || typeof value !== "object" || !ID.test(value.operation_id || "")) return null;
  const out = {operation_id:value.operation_id};
  if (typeof value.task === "string" && tasks.some(t => t.task_id === value.task)) out.task = value.task;
  const mode = value.mode || value.control;
  if (MODES.has(mode)) out.mode = mode;
  if (ID.test(value.compare_to || "")) out.compare_to = value.compare_to;
  return out;
}
function notice(message, error = false) {
  $("state").hidden = !message;
  $("state").textContent = message || "";
  $("state").dataset.error = String(error);
}
function localStatus() {
  $("storageStatus").textContent = storageAvailable
    ? "Operation ID saved in this browser. Copy it to reopen the run on this runtime."
    : "Browser storage is unavailable. Copy the operation ID to reopen this run.";
}
function saveSelection() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify({schema:1,current,recent:recent.slice(0,20)}));
    storageAvailable = true;
  } catch { storageAvailable = false; }
  localStatus();
}
function readSelection() {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw || raw.length > 16384) return;
    const saved = JSON.parse(raw);
    if (saved?.schema !== 1) return;
    recent = Array.isArray(saved.recent) ? saved.recent.map(validIdentity).filter(Boolean).slice(0,20) : [];
    current = validIdentity(saved.current);
  } catch { storageAvailable = false; }
}
function remember(identity) {
  current = validIdentity(identity);
  if (!current) throw new Error("A valid operation ID is required.");
  recent = [current, ...recent.filter(x => x.operation_id !== current.operation_id)].slice(0,20);
  $("operation").value = current.operation_id;
  saveSelection();
}
function routeUpdate() {
  const p = new URLSearchParams();
  if (current) p.set("operation", current.operation_id);
  if (current && selectedTab !== "checks") p.set("tab", selectedTab);
  if (current && compareRun) p.set("compare", compareRun.operation_id);
  history.replaceState(null,"",location.pathname + location.search + (p.size ? "#" + p.toString() : ""));
}
function readRoute() {
  const p = new URLSearchParams(location.hash.slice(1));
  return {id:ID.test(p.get("operation") || "") ? p.get("operation") : null,
    tab:TABS.has(p.get("tab")) ? p.get("tab") : "checks",
    compare:ID.test(p.get("compare") || "") ? p.get("compare") : null};
}
function setBusy() {
  for (const id of ["newOperation","task","mode","model","seconds","maximumTokens","load","operation","refreshProvider","prepareControl"]) {
    $(id).disabled = busy || opening;
  }
  $("run").disabled = busy || opening || Boolean(current) || !taskDetail ||
    ($("mode").value === "nebius" && !(provider?.inventory_status === "ready" && $("model").value));
  $("maximumTokens").disabled = busy || opening || $("mode").value !== "nebius";
  $("inspectCurrent").disabled = busy || opening || !current;
  $("copyOperation").disabled = !current;
  $("copyTaskSource").disabled = !taskDetail;
  for (const id of ["downloadBundle","exportBundle","downloadSource","downloadPatch","downloadRun","refreshArtifacts"]) {
    $(id).disabled = downloading || !verifiedRun;
  }
  $("downloadSource").disabled = downloading || !getSources().after;
  $("downloadBundle").disabled = downloading || !artifacts;
  $("exportBundle").disabled = downloading || !artifacts;
  $("downloadProviderRecord").disabled = downloading || providerObservation?.download_available !== true;
  $("readProviderRecord").disabled = downloading || providerObservation?.download_available !== true;
  $("compareRun").disabled = busy || opening || !verifiedRun;
  $("main").setAttribute("aria-busy", String(busy || opening));
  renderHistory();
}
async function api(path, body) {
  const response = await fetch(path, {method:body === undefined ? "GET" : "POST",
    headers:{"X-Action-Token":config.token, ...(body === undefined ? {} : {"Content-Type":"application/json"})},
    body:body === undefined ? undefined : JSON.stringify(body), cache:"no-store"});
  let data;
  try { data = await response.json(); }
  catch { throw new Error("The runtime response could not be read. Open the saved operation ID before starting another run."); }
  if (!response.ok) {
    const error = new Error(data.message || data.error || ("Runtime returned HTTP " + response.status + "."));
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
function safeText(value) {
  if (value === undefined) return "Not reported";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
function shortTime(value) {
  if (!value) return "";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(date);
}
function seconds(value) { return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) + " s" : "—"; }
function bytes(value) {
  if (!Number.isFinite(value)) return "—";
  return value < 1024 ? value + " B" : value < 1048576 ? (value / 1024).toFixed(1) + " KiB" : (value / 1048576).toFixed(1) + " MiB";
}
function stateLabel(row) {
  const value = row?.state;
  if (value === "TERMINAL") return "Result retained";
  if (value === "INFERENCE_DISPATCHING") return "Model requested";
  if (value === "PREPARING") return "Preparing";
  if (value === "FAILED_OR_EFFECT_UNKNOWN") return "Inspect run";
  if (row?.has_result_file) return "Result file present";
  return "Open operation";
}
function renderHistory() {
  const query = $("historySearch").value.trim().toLowerCase(), filter = $("historyTask").value;
  const merged = indexRows.map(row => ({...recent.find(x => x.operation_id === row.operation_id),...row}));
  const seen = new Set(merged.map(x => x.operation_id));
  for (const item of recent) if (!seen.has(item.operation_id)) merged.push({...item,local_only:true});
  const rows = merged.filter(row => (!filter || row.task === filter) &&
    (!query || [row.operation_id,row.task,taskLabel(row.task),row.mode,row.model].join(" ").toLowerCase().includes(query)));
  $("runs").replaceChildren();
  if (!rows.length) $("runs").append(el("div",merged.length ? "No runs match this search." : "Your completed and interrupted runs will appear here.","empty-state"));
  for (const row of rows) {
    const button = el("button",null,"operation-card" + (current?.operation_id === row.operation_id ? " selected" : ""));
    button.type = "button"; button.disabled = busy || opening;
    button.setAttribute("aria-label","Open " + taskLabel(row.task) + ", operation " + row.operation_id);
    if (current?.operation_id === row.operation_id) button.setAttribute("aria-current","true");
    button.append(el("span",taskLabel(row.task),"operation-name"),el("span",row.operation_id,"operation-id"));
    const mode = row.mode || row.execution_mode;
    if (mode) button.append(el("span",modeLabel(mode),"operation-mode"));
    const meta = el("span",null,"operation-meta");
    meta.append(el("span",row.local_only ? "Saved browser ID" : stateLabel(row)),el("span",shortTime(row.modified_at || row.updated_at)));
    button.append(meta);
    button.addEventListener("click",() => openOperation({operation_id:row.operation_id,task:row.task,mode}));
    $("runs").append(button);
  }
  const parts = [indexRows.length + " retained " + (indexRows.length === 1 ? "operation" : "operations")];
  if (indexPartial) parts.push("partial directory scan · open a known ID below");
  $("runsStatus").textContent = parts.join(" · ");
  $("comparisonOptions").replaceChildren();
  for (const row of merged.filter(r => r.operation_id !== current?.operation_id && r.has_result_file)) {
    const option = el("option");
    option.value = row.operation_id;
    option.label = taskLabel(row.task) + (row.mode ? " · " + modeLabel(row.mode) : "");
    $("comparisonOptions").append(option);
  }
}
async function refreshIndex(quiet = false) {
  $("refreshRuns").disabled = true;
  try {
    const data = await api("/api/operations");
    indexRows = Array.isArray(data.operations) ? data.operations.filter(row => ID.test(row.operation_id || "")) : [];
    indexPartial = Boolean(data.truncated);
    renderHistory();
  } catch (error) {
    $("runsStatus").textContent = "Retained list could not be read. A known operation ID can still be opened.";
    if (!quiet) notice(error.message,true);
  } finally { $("refreshRuns").disabled = false; }
}
async function loadProvider() {
  $("refreshProvider").disabled = true;
  const previous = $("model").value;
  try {
    provider = await api("/api/provider");
    const models = Array.isArray(provider.models) ? provider.models.filter(x => x && typeof x.id === "string") : [];
    $("model").replaceChildren();
    if (!models.length) { const o = el("option",provider.configured ? "No available NVIDIA model" : "Set NEBIUS_API_KEY in the runtime"); o.value = ""; $("model").append(o); }
    for (const model of models) { const o = el("option",model.id); o.value = model.id; $("model").append(o); }
    const preferred = models.some(x => x.id === previous) ? previous :
      models.some(x => x.id === provider.default_model) ? provider.default_model : models[0]?.id;
    if (preferred) $("model").value = preferred;
    const observed = provider.observed_at ? " Inventory observed " + shortTime(provider.observed_at) + "." : "";
    $("providerStatus").textContent = provider.inventory_status === "ready"
      ? models.length + " NVIDIA/Nemotron " + (models.length === 1 ? "model is" : "models are") + " available from this runtime." + observed
      : provider.message || (provider.configured ? "The model inventory could not be read. Refresh it before a live run." : "Configure NEBIUS_API_KEY and NEBIUS_MODEL in the runtime environment to use an NVIDIA model. Authored controls are available now.");
    $("connectionStatus").textContent = provider.inventory_status === "ready" ? "Nebius connected · local runtime" : "Local runtime · controls available";
    if (!provider.configured && !modeTouched && !current) $("mode").value = "corrected";
  } catch (error) {
    provider = {configured:false,inventory_status:"error",models:[]};
    $("model").replaceChildren(el("option","Provider state unavailable"));
    $("model").firstElementChild.value = "";
    $("providerStatus").textContent = error.message;
    $("connectionStatus").textContent = "Local runtime";
  } finally {
    $("refreshProvider").disabled = false;
    renderMode();
    setBusy();
  }
}
function renderMode() {
  const mode = $("mode").value;
  $("providerPanel").hidden = mode !== "nebius";
  $("maximumTokens").disabled = mode !== "nebius" || busy;
  $("modeDescription").textContent = mode === "nebius"
    ? "The model receives the original module, the declared task and its observed baseline failures. Its admitted plan is executed in a fresh task copy."
    : mode === "corrected"
      ? "Run the released, authored repair through the same original checker. This is a useful comparison control and makes no model request."
      : "Run the original defective module through the original checker to inspect its observed failures. This control makes no model request.";
  $("run").replaceChildren(el("span",mode === "nebius" ? "Run NVIDIA model" : mode === "corrected" ? "Run corrected control" : "Run original control"),el("span","↗"));
  $("run").lastElementChild.setAttribute("aria-hidden","true");
  $("runHelp").textContent = mode === "nebius" ? "The API key stays in the runtime environment." : "Actual Python computation using the original declared checks.";
  setBusy();
}
function fact(container, label, value) {
  const div = el("div"); div.append(el("dt",label),el("dd",value)); container.append(div);
}
async function getTask(id) {
  if (taskCache.has(id)) return taskCache.get(id);
  const detail = await api("/api/task?id=" + encodeURIComponent(id));
  if (detail.task_id !== id || !detail.policy || !detail.source || typeof detail.source.content !== "string") throw new Error("The runtime returned a different task or incomplete source.");
  taskCache.set(id,detail);
  return detail;
}
async function loadTask() {
  const version = ++taskVersion, id = $("task").value;
  taskDetail = null; setBusy();
  $("taskTitle").textContent = taskLabel(id);
  $("taskCategory").textContent = TASK_LABELS[id]?.category || "Python";
  $("goal").textContent = tasks.find(t => t.task_id === id)?.goal || "";
  $("taskSource").textContent = "Reading the original source…";
  $("policyFacts").replaceChildren();
  try {
    const detail = await getTask(id);
    if (version !== taskVersion) return;
    taskDetail = detail;
    $("goal").textContent = detail.policy.goal;
    $("taskPath").textContent = detail.source.path;
    $("taskSource").textContent = detail.source.content;
    $("checkerSource").textContent = safeText(detail.checker?.source);
    $("checkerIdentity").textContent = "Original checker SHA-256: " + (detail.checker?.sha256 || "not supplied");
    fact($("policyFacts"),"Allowed module",detail.policy.allowed_paths.join(", "));
    fact($("policyFacts"),"Declared check",detail.policy.required_tests.join(", "));
    fact($("policyFacts"),"Write budget",String(detail.policy.max_writes));
  } catch (error) {
    if (version !== taskVersion) return;
    $("taskSource").textContent = "The task could not be read. Select a workload again to refresh its source.";
    notice(error.message,true);
  } finally { if (version === taskVersion) setBusy(); }
}
function switchTaskView(view, focus = false) {
  taskView = view === "checks" ? "checks" : "source";
  for (const button of document.querySelectorAll("[data-task-view]")) {
    const selected = button.dataset.taskView === taskView;
    button.classList.toggle("active",selected); button.setAttribute("aria-selected",String(selected)); button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }
  $("taskSourcePanel").hidden = taskView !== "source"; $("taskChecksPanel").hidden = taskView !== "checks";
}
function switchTab(tab, focus = false) {
  selectedTab = TABS.has(tab) ? tab : "checks";
  for (const button of document.querySelectorAll("[data-tab]")) {
    const selected = button.dataset.tab === selectedTab;
    button.classList.toggle("active",selected); button.setAttribute("aria-selected",String(selected)); button.tabIndex = selected ? 0 : -1;
    $("pane-" + button.dataset.tab).hidden = !selected;
    if (selected && focus) button.focus();
  }
  routeUpdate();
}
function showWorkspace() {
  $("setupPanel").hidden = Boolean(current);
  $("operationPanel").hidden = !current;
  if (current) {
    $("currentOperation").textContent = current.operation_id;
    $("operationMode").textContent = modeLabel(current.mode);
    $("operationTitle").textContent = current.task ? taskLabel(current.task) : "Retained operation";
  }
  localStatus(); setBusy();
}
function clearResult() {
  verifiedRun = null; artifacts = null; journal = null; compareRun = null; providerObservation = null;
  $("providerObservation").hidden = true; $("providerResponse").textContent = ""; $("providerResponse").hidden = true;
  $("providerResponseDetails").open = false;
  comparisonVersion++; $("comparisonResult").replaceChildren(); $("comparisonResult").hidden = true;
  $("comparisonStatus").hidden = true; $("compareOperation").value = "";
  $("result").hidden = true; $("envelopeDetails").hidden = true; $("waitingPanel").hidden = false;
  $("journal").textContent = "No journal has been read yet.";
  $("envelope").textContent = ""; $("artifactStatus").textContent = "";
  $("artifactList").replaceChildren(); $("progress").replaceChildren();
  $("operationMessage").textContent = "Opening the original journal and retained result.";
  $("waitingHeading").textContent = "Reading the retained operation";
  $("waitingDescription").textContent = "This reads the saved operation without dispatching a new run.";
  $("journalState").textContent = "Opening"; $("journalState").dataset.state = "";
}

function renderProviderObservation(observation) {
  providerObservation = observation;
  $("providerObservation").hidden = !observation || Boolean(verifiedRun);
  if (!observation) return;
  $("providerObservationFacts").replaceChildren();
  const labels = {DISPATCHING:"Request recorded",RESPONSE_RECEIVED:"HTTP response received",FAILED:"Provider request failed"};
  $("providerObservationMessage").textContent = observation.state === "RESPONSE_RECEIVED"
    ? "The original HTTP response is retained. Its returned plan is separate from the executed check result; a plan that could not be admitted is still available here for inspection."
    : observation.state === "DISPATCHING"
      ? "The original request was recorded before dispatch. Inspect this operation for a returned response."
      : "Inspect the returned status and original response to understand this provider attempt.";
  const fields = [["State",labels[observation.state] || observation.state],["HTTP status",observation.http_status],
    ["Model",observation.model],["Response ID",observation.response_id],["Request ID",observation.request_id],
    ["Finish reason",observation.finish_reason],["Reported usage",observation.usage],["Record SHA-256",observation.record_sha256]];
  for (const [label,value] of fields) if (value !== undefined && value !== null) {
    $("providerObservationFacts").append(el("dt",label),el("dd",safeText(value)));
  }
  $("downloadProviderRecord").disabled = downloading || observation.download_available !== true;
  $("readProviderRecord").disabled = downloading || observation.download_available !== true;
}
async function providerRecord(download = false) {
  if (!current || providerObservation?.download_available !== true || downloading) return;
  const id=current.operation_id; downloading=true; setBusy();
  try {
    const response=await fetch("/api/provider-record?id="+encodeURIComponent(id),{headers:{"X-Action-Token":config.token},cache:"no-store"});
    if (!response.ok) {
      let error; try {error=await response.json();} catch {}
      throw new Error(error?.message || "The original provider record could not be read.");
    }
    if(download) saveBlob(await response.blob(),id+"-provider-api.json");
    else {
      const value=await response.json();
      if(current?.operation_id!==id)return;
      $("providerResponse").textContent=JSON.stringify(value,null,2);
      $("providerResponse").hidden=false;
      $("providerResponseDetails").open=true;
    }
  }catch(error){notice(error.message,true);}
  finally{downloading=false;setBusy();}
}

function renderProgress() {
  const mode = runMode(verifiedRun) || current?.mode;
  const state = journal?.state;
  const labels = ["Starting source",mode === "nebius" ? "NVIDIA plan" : "Authored control","Execute checks","Retain output"];
  let at = -1;
  if (state === "PREPARING") at = 0;
  if (state === "INFERENCE_DISPATCHING") at = 1;
  if (verifiedRun) at = 4;
  if (state === "FAILED_OR_EFFECT_UNKNOWN") at = journal?.inference_attempted ? 1 : 0;
  $("progress").replaceChildren();
  labels.forEach((label,index) => {
    const item = el("li",label,index < at ? "complete" : index === at ? "current" : "");
    if (state === "FAILED_OR_EFFECT_UNKNOWN" && !verifiedRun && index === at) item.classList.add("failed");
    if (index === at) item.setAttribute("aria-current","step");
    $("progress").append(item);
  });
}
function renderJournal(view) {
  journal = view.journal || null;
  renderProviderObservation(view.provider_observation || null);
  $("journal").textContent = journal ? JSON.stringify(journal,null,2) : "No readable journal is present for this operation.";
  const state = journal?.state;
  $("journalState").textContent = verifiedRun ? "Result ready" : stateLabel(journal);
  $("journalState").dataset.state = verifiedRun ? "complete" : state === "FAILED_OR_EFFECT_UNKNOWN" ? "failed" : state ? "active" : "";
  if (!verifiedRun) {
    $("operationMessage").textContent = view.message || "Reading the retained operation.";
    if (state === "INFERENCE_DISPATCHING") {
      $("waitingHeading").textContent = "Waiting for the NVIDIA plan";
      $("waitingDescription").textContent = "The inference request has been recorded. The runtime will retain the plan and run the declared checks when it returns.";
    } else if (state === "PREPARING") {
      $("waitingHeading").textContent = "Running the original source";
      $("waitingDescription").textContent = "The runtime is preparing the task copy and measuring the starting source with the original checker.";
    } else if (state === "FAILED_OR_EFFECT_UNKNOWN") {
      $("waitingHeading").textContent = "This operation needs inspection";
      $("waitingDescription").textContent = "The run did not produce a complete readable result. Its original journal remains available below. Refresh this operation to read any later result; a new attempt requires a separate New run action.";
    } else {
      $("waitingHeading").textContent = "No complete result is available";
      $("waitingDescription").textContent = view.message || "Refresh this operation to inspect its retained state.";
    }
  }
  renderProgress();
}
async function inspectSelected(quiet = false) {
  if (!current) return null;
  const id = current.operation_id, version = selectionVersion;
  try {
    const view = await api("/api/operation?id=" + encodeURIComponent(id));
    if (!current || current.operation_id !== id || selectionVersion !== version) return null;
    if (view.operation_id !== id) throw new Error("The runtime returned a different operation ID.");
    renderJournal(view);
    if (view.result_verified === true && view.run?.operation_id === id) {
      if (verifiedRun?.run_sha256 !== view.run.run_sha256) {
        verifiedRun = view.run;
        const mode = runMode(verifiedRun);
        remember({...current,task:verifiedRun.task_id,...(mode ? {mode} : {})});
        renderResult(); await loadArtifacts(true);
      }
      if (!artifacts) await loadArtifacts(true);
      $("journalState").textContent = "Result ready"; $("journalState").dataset.state = "complete";
      renderProgress();
    }
    return view;
  } catch (error) {
    if (!quiet) notice(error.message + " The saved operation ID remains " + id + ".",true);
    return null;
  }
}
async function openOperation(identity, options = {}) {
  if (busy || opening) return;
  const normalized = validIdentity(identity);
  if (!normalized) { notice("Enter an operation ID using letters, numbers, hyphens or underscores.",true); return; }
  opening = true; selectionVersion++; clearTimeout(pollTimer); clearResult(); remember(normalized);
  selectedTab = options.tab || "checks"; compareAfterRun = null;
  showWorkspace(); switchTab(selectedTab); notice("");
  try {
    await inspectSelected();
    if (options.compare && verifiedRun) await compareWith(options.compare,true);
  } finally { opening = false; setBusy(); }
}
function schedulePoll(id, version) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!busy || current?.operation_id !== id || selectionVersion !== version) return;
    await inspectSelected(true);
    if (busy && current?.operation_id === id && selectionVersion === version) schedulePoll(id,version);
  },1800);
}
async function startRun(event) {
  event.preventDefault();
  if (busy || opening || current || !taskDetail) return;
  const mode = $("mode").value, task = $("task").value;
  const runSeconds = Number($("seconds").value), maximumTokens = Number($("maximumTokens").value);
  if (!MODES.has(mode) || !Number.isInteger(runSeconds) || runSeconds < 5 || runSeconds > 120 ||
      !Number.isInteger(maximumTokens) || maximumTokens < 128 || maximumTokens > 8192) {
    notice("Choose a whole run limit of 5–120 seconds and an output limit of 128–8192 tokens.",true); return;
  }
  const model = mode === "nebius" ? $("model").value : null;
  if (mode === "nebius" && !(provider?.inventory_status === "ready" && provider.models.some(x => x.id === model))) {
    notice("Refresh the provider inventory and select an available NVIDIA model.",true); return;
  }
  const operationId = crypto.randomUUID();
  const request = {task,mode,operation_id:operationId,model,maximum_output_tokens:maximumTokens,seconds:runSeconds};
  busy = true; selectionVersion++; clearResult();
  remember({operation_id:operationId,task,mode,...(compareAfterRun ? {compare_to:compareAfterRun} : {})});
  showWorkspace(); switchTab("checks"); notice("");
  $("operationMessage").textContent = "Operation ID saved. Sending this run once to the original executor.";
  $("waitingHeading").textContent = "Starting the run";
  $("waitingDescription").textContent = "You can reopen this operation if the connection is interrupted.";
  $("journalState").textContent = "Dispatching";
  const version = selectionVersion; schedulePoll(operationId,version);
  let dispatchError = null;
  try {
    const response = await api("/api/run",request);
    if (response.operation_id !== operationId) throw new Error("The run response did not match the saved operation ID.");
  } catch (error) { dispatchError = error; }
  finally {
    clearTimeout(pollTimer);
    await inspectSelected(true);
    busy = false; setBusy();
    await refreshIndex(true);
  }
  if (verifiedRun) {
    notice("Run complete. Review the actual checks and source change below.");
    const compareId = current?.compare_to;
    if (compareId) { await compareWith(compareId,true); switchTab("compare"); }
  } else if (dispatchError) {
    notice(dispatchError.message + " Inspect the retained operation before choosing a new attempt.",true);
  } else {
    notice("The response returned, but a complete result has not yet been read. Refresh this operation.",true);
  }
}
async function newOperation(options = {}) {
  if (busy || opening) return;
  selectionVersion++; clearTimeout(pollTimer);
  current = null; verifiedRun = null; artifacts = null; compareRun = null;
  compareAfterRun = options.compareTo || null; selectedTab = "checks";
  $("operation").value = ""; saveSelection(); clearResult(); showWorkspace(); routeUpdate();
  notice(options.message || "");
  if (options.task) $("task").value = options.task;
  if (options.mode) { $("mode").value = options.mode; modeTouched = true; }
  await loadTask(); renderMode();
  if (options.focus !== false) $("task").focus();
}
function caseRows(run) {
  const baseline = new Map(), final = new Map();
  const defaultName = run?.receipt?.request?.required_tests?.[0] || "declared-check";
  for (const c of run?.baseline?.cases || []) baseline.set(defaultName + "\u0000" + c.name,{...c,suite:defaultName});
  for (const group of run?.checks || []) for (const c of group.cases || []) final.set(group.name + "\u0000" + c.name,{...c,suite:group.name});
  const keys = [...new Set([...baseline.keys(),...final.keys()])];
  return keys.map(key => ({key,name:(final.get(key) || baseline.get(key)).name,suite:(final.get(key) || baseline.get(key)).suite,before:baseline.get(key),after:final.get(key)}));
}
function checkStatus(value) {
  return el("span",value?.passed === true ? "Passed" : value?.passed === false ? "Failed" : "Not reported",
    "check-status " + (value?.passed === true ? "pass" : value?.passed === false ? "fail" : "missing"));
}
function caseText(c) {
  if (!c) return "No case output was reported.";
  const out = {};
  for (const [key,value] of Object.entries(c)) if (!["name","suite","passed"].includes(key)) out[key] = value;
  return Object.keys(out).length ? JSON.stringify(out,null,2) : (c.passed ? "Passed" : "Failed");
}
function metric(label,value,detail) {
  const div = el("div"); div.append(el("dt",label),el("dd",value)); if (detail) div.append(el("small",detail)); $("metrics").append(div);
}
function renderChecks() {
  const rows = caseRows(verifiedRun), good = rows.filter(x => x.after?.passed === true).length;
  $("checks").replaceChildren(); $("checkErrors").replaceChildren();
  $("checkCount").textContent = good + " / " + rows.length + " reported cases passed";
  $("checkSummary").textContent = "Named check: " + (verifiedRun.receipt?.request?.required_tests || []).join(", ") + ". Expand a case to read its original observed output.";
  const errors = [["Original source",verifiedRun.baseline],...(verifiedRun.checks || []).map(x => [x.name,x])];
  for (const [name,result] of errors) if (result?.error) {
    $("checkErrors").append(el("p",name + ": " + result.error + (result.error_message ? " · " + result.error_message : ""),"notice"));
  }
  for (const row of rows) {
    const tr = el("tr"), first = el("td");
    first.append(el("span",row.name,"check-name"),el("span",row.suite,"check-group"));
    const before = el("td"), after = el("td"), action = el("td");
    before.append(checkStatus(row.before)); after.append(checkStatus(row.after));
    const detail = el("tr",null,"check-details"); detail.hidden = true;
    const cell = el("td"); cell.colSpan = 4;
    const layout = el("div",null,"case-output");
    for (const [label,value] of [["Original source",row.before],["Final source",row.after]]) {
      const block = el("div"); block.append(el("h4",label),el("pre",caseText(value))); layout.append(block);
    }
    cell.append(layout); detail.append(cell);
    const button = el("button","Details","text-button"); button.type = "button"; button.setAttribute("aria-expanded","false");
    button.setAttribute("aria-label","Show observed output for " + row.name);
    button.addEventListener("click",() => { detail.hidden = !detail.hidden; button.setAttribute("aria-expanded",String(!detail.hidden)); button.textContent = detail.hidden ? "Details" : "Hide"; });
    action.append(button); tr.append(first,before,after,action); $("checks").append(tr,detail);
  }
  if (!rows.length) { const tr = el("tr"), td = el("td","The checker returned no case rows. Its execution output is shown above and in the complete result."); td.colSpan = 4; tr.append(td); $("checks").append(tr); }
}
function getSources() {
  if (artifacts?.source_before && artifacts?.source_after) return {before:artifacts.source_before,after:artifacts.source_after};
  if (verifiedRun?.task_source && typeof verifiedRun.task_source.before === "string" && typeof verifiedRun.task_source.after === "string") {
    return {before:{path:verifiedRun.task_source.path,content:verifiedRun.task_source.before,sha256:verifiedRun.source_before_sha256},
      after:{path:verifiedRun.task_source.path,content:verifiedRun.task_source.after,sha256:verifiedRun.source_after_sha256}};
  }
  return {before:null,after:null};
}
function renderSource() {
  if (!verifiedRun) return;
  const sources = getSources(), path = sources.after?.path || verifiedRun.receipt?.request?.allowed_paths?.[0] || "task module";
  const selected = sourceView === "before" ? sources.before : sources.after;
  displayedSource = sourceView === "patch" ? verifiedRun.patch || "" : selected?.content ?? "";
  $("patch").replaceChildren();
  if (sourceView === "patch") {
    if (!displayedSource) $("patch").textContent = "The final source is unchanged from the original.";
    else for (const line of displayedSource.split("\n")) {
      $("patch").append(el("span",line || " ","patch-line " + (/^(---|\+\+\+|@@)/.test(line) ? "header" : line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : "")));
    }
  } else $("patch").textContent = selected ? selected.content : "This retained run has no readable source artifact. Refresh package contents to inspect its original files.";
  $("sourceCaption").textContent = sourceView === "patch" ? "change.patch → " + path : path + (sourceView === "before" ? " · original" : " · final");
  $("sourceLineCount").textContent = displayedSource ? displayedSource.split("\n").length - (displayedSource.endsWith("\n") ? 1 : 0) + " lines" : "";
  $("sourceIdentity").textContent = sourceView === "patch"
    ? "Original SHA-256: " + verifiedRun.source_before_sha256 + "\nFinal SHA-256: " + verifiedRun.source_after_sha256
    : "Source SHA-256: " + (selected?.sha256 || "not supplied");
  for (const button of document.querySelectorAll("[data-source-view]")) {
    const active = button.dataset.sourceView === sourceView;
    button.classList.toggle("active",active); button.setAttribute("aria-selected",String(active)); button.tabIndex = active ? 0 : -1;
  }
}
function detailFact(label,value) {
  $("providerFacts").append(el("dt",label),el("dd",safeText(value)));
}
function renderPlan() {
  const run = verifiedRun, plan = run.receipt?.plan || {}, p = run.provider || {}, mode = runMode(run);
  $("planHeading").textContent = mode === "nebius" ? "NVIDIA model plan" : mode === "corrected" || mode === "baseline" ? "Authored control plan" : "Retained plan";
  $("planSummary").textContent = plan.summary || "No plan summary was retained.";
  $("planSteps").replaceChildren();
  for (let index=0;index<(plan.operations || []).length;index++) {
    const operation = plan.operations[index], event = run.receipt?.events?.find(x => x.seq === index+1);
    const li = el("li",null,"plan-step"), content = el("div");
    content.append(el("h4",({read:"Read original module",write:"Write candidate module",test:"Run declared checker"})[operation.kind] || operation.kind));
    content.append(el("p",operation.path || operation.name || ""));
    if (event?.kind === "test") content.append(el("p","Observed exit code: " + event.exit_code));
    if (event?.kind === "write") content.append(el("p","Final source SHA-256: " + event.after_sha256));
    li.append(el("span",String(index+1),"step-number"),content); $("planSteps").append(li);
  }
  $("providerFacts").replaceChildren();
  detailFact("Execution",modeLabel(mode));
  detailFact("Provider",p.provider || "Not recorded");
  if (mode === "nebius" || p.response_id) {
    for (const [label,key] of [["Requested model","requested_model"],["Returned model","model"],["Response ID","response_id"],["Request ID","request_id"],["Finish reason","finish_reason"]]) {
      if (p[key] !== undefined && p[key] !== null) detailFact(label,p[key]);
    }
    if (p.created) detailFact("Provider timestamp",new Date(p.created * 1000).toISOString());
    if (p.usage) detailFact("Reported token usage",p.usage);
    if (typeof p.model_inventory_checked === "boolean") detailFact("Model inventory checked",p.model_inventory_checked ? "Yes" : "No");
  } else detailFact("Inference","No new provider inference is recorded for this control.");
  if (run.created_at) detailFact("Run started",run.created_at);
  if (run.finished_at) detailFact("Run finished",run.finished_at);
  detailFact("Measured whole run",seconds(run.wall_seconds));
  detailFact("Original checker",run.task_contract?.checker_sha256 || "Legacy run: no checker identity retained");
}
function renderUsage() {
  const run = verifiedRun, path = getSources().after?.path || run.receipt?.request?.allowed_paths?.[0] || "the declared module";
  $("useOutput").replaceChildren();
  $("useOutput").append(el("h3","Apply to the matching starting source"),
    el("p","Place the downloaded final module at " + path + ", or extract the package's change.patch and run these commands from the root of a copy containing the original module."),
    el("pre","git apply --check change.patch\ngit apply change.patch","code-block"),
    el("p","Compare the original module's SHA-256 with " + run.source_before_sha256 + " before applying the change. The Checks tab reports the released task's actual cases."));
  if (run.receipt?.required_tests_green !== true) {
    $("useOutput").prepend(el("p","This candidate still has failing declared checks. Inspect those failures before using the change.","notice"));
  }
}
function renderResult() {
  const run = verifiedRun, rows = caseRows(run), mode = runMode(run);
  $("result").hidden = false; $("waitingPanel").hidden = true; $("envelopeDetails").hidden = false; $("providerObservation").hidden = true;
  $("operationTitle").textContent = taskLabel(run.task_id);
  $("operationMode").textContent = modeLabel(mode);
  $("heading").textContent = run.receipt?.required_tests_green === true ? "Declared checks passed" : "The change needs more work";
  $("facts").textContent = [mode === "nebius" ? run.provider?.model || "NVIDIA model" : modeLabel(mode),run.created_at ? shortTime(run.created_at) : null,run.operation_id].filter(Boolean).join(" · ");
  const passed = rows.filter(x => x.after?.passed === true).length, baselineFailed = rows.filter(x => x.before?.passed === false).length;
  const repaired = rows.filter(x => x.before?.passed === false && x.after?.passed === true).length;
  $("operationMessage").textContent = "The original executor retained this completed run. Review the check outcomes and source change, then download the exact output.";
  $("metrics").replaceChildren();
  metric("Final cases",passed + " / " + rows.length,"Reported cases passed");
  metric("Failures repaired",String(repaired),baselineFailed + " failures observed initially");
  metric("Whole run",seconds(run.wall_seconds),"Measured elapsed time");
  const writes = (run.receipt?.events || []).filter(x => x.kind === "write").length;
  metric("Module writes",String(writes),"Budget " + (run.receipt?.request?.max_writes ?? "—"));
  renderChecks(); renderSource(); renderPlan(); renderUsage();
  $("envelope").textContent = JSON.stringify(run,null,2);
  $("artifactStatus").textContent = "Reading this operation's original files…";
  switchTab(selectedTab); renderProgress(); setBusy();
}
function renderArtifacts() {
  $("artifactList").replaceChildren();
  if (!artifacts) return;
  const list = Array.isArray(artifacts.available) ? artifacts.available : [];
  $("artifactStatus").textContent = list.length + " exact retained files · " + bytes(list.reduce((sum,x) => sum + (Number(x.bytes) || 0),0)) + " before ZIP packaging";
  const wrapper = el("div",null,"table-scroll"), table = el("table",null,"artifact-table"), thead = el("thead"), header = el("tr");
  for (const name of ["Retained file","Size"]) header.append(el("th",name));
  thead.append(header); table.append(thead);
  const tbody = el("tbody");
  for (const file of list) {
    const tr = el("tr"), name = el("td");
    name.append(el("span",file.name),el("span",file.sha256,"artifact-hash"));
    tr.append(name,el("td",bytes(file.bytes))); tbody.append(tr);
  }
  table.append(tbody); wrapper.append(table); $("artifactList").append(wrapper);
}
async function loadArtifacts(quiet = false) {
  if (!verifiedRun) return;
  const id = verifiedRun.operation_id, digest = verifiedRun.run_sha256;
  try {
    const data = await api("/api/artifacts?id=" + encodeURIComponent(id));
    if (verifiedRun?.operation_id !== id || verifiedRun?.run_sha256 !== digest) return;
    if (data.operation_id !== id || data.run_sha256 !== digest) throw new Error("The artifact inventory does not match the opened result.");
    artifacts = data; renderArtifacts(); renderSource(); renderUsage(); setBusy();
  } catch (error) {
    $("artifactStatus").textContent = error.message;
    if (!quiet) notice(error.message,true);
  }
}
function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function comparisonMismatch(a,b) {
  if (a.operation_id === b.operation_id) return "Choose a different retained operation.";
  if (a.task_id !== b.task_id) return "These runs used different workloads.";
  if (!a.task_contract?.checker_sha256 || !b.task_contract?.checker_sha256) return "A legacy run does not retain the checker identity needed for an exact comparison. Its original checks and source remain available when opened separately.";
  if (a.source_before_sha256 !== b.source_before_sha256 || a.task_contract.source_before_sha256 !== b.task_contract.source_before_sha256) return "These runs started from different source bytes.";
  if (a.task_contract.checker_sha256 !== b.task_contract.checker_sha256) return "These runs used different original checkers.";
  if (a.task_contract.policy_sha256 !== b.task_contract.policy_sha256 || stable(a.receipt?.request) !== stable(b.receipt?.request)) return "These runs used different declared policies.";
  return null;
}
function comparisonPanel(run,label) {
  const section = el("div"); section.append(el("h4",label),el("code",run.operation_id));
  const rows = caseRows(run), passed = rows.filter(x => x.after?.passed === true).length;
  section.append(el("p",modeLabel(runMode(run))),el("p",passed + " / " + rows.length + " reported cases passed · " + seconds(run.wall_seconds)));
  if (runMode(run) === "nebius") section.append(el("p",run.provider?.model || ""));
  return section;
}
function renderComparison() {
  const left = verifiedRun, right = compareRun;
  if (!left || !right) return;
  const root = $("comparisonResult"); root.replaceChildren(); root.hidden = false;
  const heading = el("div",null,"comparison-summary");
  heading.append(comparisonPanel(left,"Current run"),comparisonPanel(right,"Comparison run")); root.append(heading);
  const leftRows = new Map(caseRows(left).map(x => [x.key,x])), rightRows = new Map(caseRows(right).map(x => [x.key,x]));
  const wrapper = el("div",null,"table-scroll"), table = el("table"), thead = el("thead"), trh = el("tr");
  for (const label of ["Original declared case","Current run","Comparison run"]) trh.append(el("th",label));
  thead.append(trh); table.append(thead);
  const tbody = el("tbody");
  let different = 0;
  for (const key of new Set([...leftRows.keys(),...rightRows.keys()])) {
    const a = leftRows.get(key), b = rightRows.get(key), tr = el("tr"), td1 = el("td",(a || b).name), td2 = el("td"), td3 = el("td");
    td2.append(checkStatus(a?.after)); td3.append(checkStatus(b?.after)); tr.append(td1,td2,td3); tbody.append(tr);
    if (a?.after?.passed !== b?.after?.passed) different++;
  }
  table.append(tbody); wrapper.append(table); root.append(wrapper);
  root.append(el("p",different + " case outcomes differ. " + (left.source_after_sha256 === right.source_after_sha256 ? "Both final modules are byte-identical." : "The final source bytes differ; matching check outcomes can still represent different implementations."),"small muted subheading"));
  const source = el("details",null,"comparison-source"); source.append(el("summary","Inspect the comparison run's patch"));
  source.append(el("pre",right.patch || "No source change.","code-block")); root.append(source);
  const open = el("button","Open comparison run","text-button"); open.type = "button";
  open.addEventListener("click",() => openOperation({operation_id:right.operation_id,task:right.task_id,mode:runMode(right)},{tab:"checks"}));
  root.append(open); routeUpdate();
}
async function compareWith(id, quiet = false) {
  if (!verifiedRun || !ID.test(id || "")) { notice("Enter a valid comparison operation ID.",true); return; }
  const currentId = verifiedRun.operation_id, version = ++comparisonVersion;
  $("compareOperation").value = id; $("compareRun").disabled = true; $("comparisonStatus").hidden = false;
  $("comparisonStatus").textContent = "Reading the retained comparison result…"; $("comparisonStatus").dataset.error = "false";
  $("comparisonResult").hidden = true; compareRun = null;
  try {
    const view = await api("/api/operation?id=" + encodeURIComponent(id));
    if (verifiedRun?.operation_id !== currentId || comparisonVersion !== version) return;
    if (view.operation_id !== id || view.result_verified !== true || view.run?.operation_id !== id) throw new Error(view.message || "The comparison operation does not have a complete verified result.");
    const reason = comparisonMismatch(verifiedRun,view.run);
    if (reason) throw new Error(reason);
    compareRun = view.run;
    $("comparisonStatus").textContent = "Same starting source, declared policy and original checker. The table aligns their actual case outcomes.";
    renderComparison();
  } catch (error) {
    if (verifiedRun?.operation_id !== currentId || comparisonVersion !== version) return;
    $("comparisonStatus").textContent = error.message; $("comparisonStatus").dataset.error = "true";
    if (!quiet) notice(error.message,true);
  } finally { $("compareRun").disabled = busy || opening || !verifiedRun; }
}
async function prepareControl() {
  if (!verifiedRun || busy || opening) return;
  const run = verifiedRun;
  try {
    const detail = await getTask(run.task_id);
    if (detail.source.sha256 !== run.source_before_sha256 || detail.checker?.sha256 !== run.task_contract?.checker_sha256) {
      throw new Error("This installed workload differs from the retained run's source or checker. Use its original build for a matching control; New run remains available for this build.");
    }
    await newOperation({task:run.task_id,mode:"corrected",compareTo:run.operation_id,
      message:"Corrected control prepared for the same original source and checker. Run it to compare with operation " + run.operation_id + "."});
  } catch (error) { notice(error.message,true); }
}
function fileName(name) { return String(name || "download").replace(/[^A-Za-z0-9._-]/g,"_").slice(0,160); }
function saveBlob(blob,name) {
  const url = URL.createObjectURL(blob), link = el("a");
  link.href = url; link.download = fileName(name); document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
function saveText(text,name,type = "text/plain;charset=utf-8") { saveBlob(new Blob([text],{type}),name); }
async function downloadPackage() {
  if (!verifiedRun || downloading) return;
  downloading = true; setBusy();
  const id = verifiedRun.operation_id;
  try {
    const response = await fetch("/api/download?id=" + encodeURIComponent(id),{headers:{"X-Action-Token":config.token},cache:"no-store"});
    if (!response.ok) {
      let data; try { data = await response.json(); } catch {}
      throw new Error(data?.message || data?.error || "The run package could not be downloaded.");
    }
    const blob = await response.blob();
    saveBlob(blob,"evidenceforge-" + id + ".zip");
    notice("The complete run package was downloaded.");
  } catch (error) { notice(error.message,true); }
  finally { downloading = false; setBusy(); }
}
async function copy(text,button) {
  if (!text) return;
  const original = button.textContent;
  try { await navigator.clipboard.writeText(text); button.textContent = "Copied"; }
  catch { notice("Clipboard access is unavailable. Select and copy the visible text.",true); }
  setTimeout(() => { button.textContent = original; },1500);
}
function wireTabs(selector,key,switcher) {
  const buttons = [...document.querySelectorAll(selector)];
  for (const button of buttons) {
    button.addEventListener("click",() => switcher(button.dataset[key],false));
    button.addEventListener("keydown",event => {
      if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
      event.preventDefault();
      let index = buttons.indexOf(button);
      index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length-1 :
        (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      switcher(buttons[index].dataset[key],true);
    });
  }
}
for (const task of tasks) {
  const option = el("option",taskLabel(task.task_id)); option.value = task.task_id; $("task").append(option);
  const filter = el("option",taskLabel(task.task_id)); filter.value = task.task_id; $("historyTask").append(filter);
}
$("task").addEventListener("change",loadTask);
$("mode").addEventListener("change",() => { modeTouched = true; renderMode(); });
$("model").addEventListener("change",setBusy);
$("refreshProvider").addEventListener("click",loadProvider);
$("historySearch").addEventListener("input",renderHistory);
$("historyTask").addEventListener("change",renderHistory);
$("refreshRuns").addEventListener("click",() => refreshIndex());
$("runForm").addEventListener("submit",startRun);
$("openForm").addEventListener("submit",event => { event.preventDefault(); openOperation({operation_id:$("operation").value.trim()}); });
$("newOperation").addEventListener("click",() => newOperation());
$("brandHome").addEventListener("click",event => { event.preventDefault(); newOperation(); });
$("inspectCurrent").addEventListener("click",async () => {
  if (busy || opening || !current) return;
  opening = true; setBusy(); notice("");
  try { await inspectSelected(); await refreshIndex(true); } finally { opening = false; setBusy(); }
});
$("copyOperation").addEventListener("click",() => copy(current?.operation_id,$("copyOperation")));
$("copyTaskSource").addEventListener("click",() => copy(taskDetail?.source?.content,$("copyTaskSource")));
$("copyDisplayedSource").addEventListener("click",() => copy(displayedSource,$("copyDisplayedSource")));
$("prepareControl").addEventListener("click",prepareControl);
$("compareForm").addEventListener("submit",event => { event.preventDefault(); compareWith($("compareOperation").value.trim()); });
$("refreshArtifacts").addEventListener("click",() => loadArtifacts());
$("downloadProviderRecord").addEventListener("click",() => providerRecord(true));
$("readProviderRecord").addEventListener("click",() => providerRecord(false));
$("downloadBundle").addEventListener("click",downloadPackage);
$("exportBundle").addEventListener("click",downloadPackage);
$("downloadRun").addEventListener("click",() => { if (verifiedRun) saveText(JSON.stringify(verifiedRun,null,2) + "\n",verifiedRun.operation_id + "-run.json","application/json"); });
$("downloadPatch").addEventListener("click",() => { if (verifiedRun) saveText(verifiedRun.patch || "","change.patch","text/x-diff"); });
$("downloadSource").addEventListener("click",() => { const source = getSources().after; if (source) saveText(source.content,source.path.split("/").pop(),"text/x-python"); });
wireTabs("[data-task-view]","taskView",switchTaskView);
wireTabs("[data-tab]","tab",switchTab);
wireTabs("[data-source-view]","sourceView",(view,focus) => {
  sourceView = view; renderSource();
  if (focus) document.querySelector('[data-source-view="' + view + '"]').focus();
});
window.addEventListener("hashchange",() => {
  const route = readRoute();
  if (busy || opening) { routeUpdate(); return; }
  if (!route.id) { newOperation({focus:false}); return; }
  if (route.id === current?.operation_id) {
    switchTab(route.tab);
    if (route.compare && verifiedRun && route.compare !== compareRun?.operation_id) compareWith(route.compare,true);
  } else openOperation({operation_id:route.id},{tab:route.tab,compare:route.compare});
});
async function boot() {
  readSelection();
  const route = readRoute(), saved = current;
  current = null; showWorkspace();
  switchTaskView("source"); switchTab("checks");
  const results = await Promise.allSettled([loadTask(),loadProvider(),refreshIndex(true)]);
  const failure = results.find(x => x.status === "rejected");
  if (failure) notice(failure.reason?.message || "The workspace could not finish loading.",true);
  if (route.id || saved) await openOperation(route.id ? {operation_id:route.id} : saved,{tab:route.tab,compare:route.id ? route.compare : saved?.compare_to});
  setBusy();
}
boot().catch(error => notice(error.message,true));
