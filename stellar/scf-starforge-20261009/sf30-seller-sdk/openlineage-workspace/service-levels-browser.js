// MIT. Service-level operator desk on the existing workspace HTTP protocol.
const $ = id => document.getElementById(id);
const s = { identity: null, view: null, levels: null, connected: false, pending: null,
  pendingBusy: false, readBusy: false, preview: null, previewSelection: null,
  section: "overview", selectedAssessmentId: null, selectedIncidentId: null, refreshVersion: 0 };
const JOURNAL_KEY = location.origin + "/service-levels";
const TOKEN_KEY = "openlineage-access:" + JOURNAL_KEY;
let accessToken = "", dbPromise;
try { accessToken = sessionStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem("openlineage-access:" + location.origin + "/") ?? ""; } catch {}
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
const pendingStatuses = new Set(["prepared", "submitting", "uncertain", "blocked", "conflict", "rejected", "complete"]);
const cancellableStatuses = new Set(["prepared", "blocked", "conflict", "rejected"]);
const fmt = value => Number(value || 0).toLocaleString();
const when = value => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { timeZoneName: "short" }) : String(value);
};
const words = value => String(value ?? "—").replaceAll("-", " ");
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false || name === "value") continue;
    if (name.startsWith("on") && typeof value === "function") el.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === "className") el.className = value;
    else if (["disabled", "checked", "hidden", "open"].includes(name)) el[name] = Boolean(value);
    else el.setAttribute(name, value === true ? "" : String(value));
  }
  const add = value => {
    if (Array.isArray(value)) value.forEach(add);
    else if (value !== null && value !== undefined && value !== false) el.append(value instanceof Node ? value : document.createTextNode(String(value)));
  };
  children.forEach(add);
  if (attrs.value !== undefined) el.value = String(attrs.value);
  return el;
}
function btn(label, fn, attrs = {}) { return h("button", { type: "button", onclick: fn, ...attrs }, label); }
function badge(value, emphasis = false) { return h("span", { className: "badge" + (emphasis ? " emphasis" : "") }, words(value)); }
function jobParts(key) { try { const p = JSON.parse(key); return { namespace: p[1], name: p[2] }; } catch { return { namespace: "", name: String(key || "—") }; } }
function jobLabel(key) { const p = jobParts(key); return p.name + (p.namespace ? " · " + p.namespace : ""); }
function jobCell(key) { const p = jobParts(key); return h("div", {}, h("span", { className: "job-name" }, p.name), h("span", { className: "job-namespace" }, p.namespace)); }
function duration(value) {
  if (value === null || value === undefined) return "Not set";
  for (const [unit, name] of [[86400, "days"], [3600, "hours"], [60, "minutes"]]) if (value % unit === 0) return fmt(value / unit) + " " + name;
  return fmt(value) + " seconds";
}
function record(entries) { return h("dl", { className: "record-fields" }, entries.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v ?? "—")])); }
function jsonBlock(label, value, open = false) { return h("details", { className: "json-block", open }, h("summary", {}, label), h("pre", {}, JSON.stringify(value, null, 2))); }
function table(headers, rows, caption) {
  return h("div", { className: "table-wrap" }, h("table", {}, h("caption", { className: "sr-only" }, caption),
    h("thead", {}, h("tr", {}, headers.map(v => h("th", { scope: "col" }, v)))), h("tbody", {}, rows)));
}
function empty(title, text, buttons = []) { return h("div", { className: "empty" }, h("h3", {}, title), h("p", {}, text), buttons.length ? h("div", { className: "button-row" }, buttons) : null); }
function safeLink(value, label = "Open runbook") {
  try { const url = new URL(value); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return h("a", { href: url.href, target: "_blank", rel: "noopener noreferrer" }, label); } catch {}
  return value ? h("span", {}, value) : "—";
}
function notice(message, error = false) {
  $("notice").textContent = message || ""; $("notice").hidden = !message;
  $("notice").classList.toggle("error", error); $("notice").setAttribute("role", error ? "alert" : "status");
}
function failFeedback(id, error) { $(id).textContent = error.message || String(error); }
function openDialog(id) { if (!$(id).open) $(id).showModal(); }
function closeDialog(id) { $(id).close(); }
function download(blob, name) {
  const url = URL.createObjectURL(blob), link = h("a", { href: url, download: name });
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function downloadJSON(value, name) { download(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), name); }
function localTime(value = new Date().toISOString()) {
  const d = new Date(value), pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}
function fromLocal(value, label) {
  if (!value || !Number.isFinite(new Date(value).getTime())) throw new Error("Choose a valid " + label + ".");
  return new Date(value).toISOString();
}
class RequestError extends Error {
  constructor(message, status = 0, details = null) { super(message); this.status = status; this.details = details; }
}
async function response(path, options = {}, unbound = false) {
  const headers = new Headers(options.headers ?? {});
  if (accessToken) headers.set("Authorization", "Bearer " + accessToken);
  if (!unbound && s.identity) {
    headers.set("X-OpenLineage-Workspace", s.identity.workspaceId);
    headers.set("X-OpenLineage-Instance", s.identity.instanceId);
  }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
  try {
    const result = await fetch(path, { ...options, headers, signal: controller.signal, credentials: "same-origin", cache: "no-store" });
    if (!result.ok) {
      let body; try { body = await result.json(); } catch { body = {}; }
      const message = typeof body.error === "string" ? body.error : body.error?.message ?? body.message ?? result.statusText;
      if (result.status === 401) openDialog("connection-dialog");
      throw new RequestError(message || "Workspace request failed.", result.status, body.details ?? body.error?.details ?? null);
    }
    return result;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(error.name === "AbortError" ? "The workspace response did not arrive in time." : "The workspace connection was interrupted.");
  } finally { clearTimeout(timer); }
}
async function jsonRequest(path, options = {}, unbound = false) {
  const result = await response(path, options, unbound);
  try { return await result.json(); } catch { throw new RequestError("The workspace returned an unreadable response.", 502); }
}
function action(name, args = {}) { return jsonRequest("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: name, args }) }); }
function database() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("Browser request storage is unavailable.")); return; }
    const request = indexedDB.open("openlineage-operator", 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("pending")) request.result.createObjectStore("pending"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("The browser could not open saved requests."));
    request.onblocked = () => reject(new Error("Close another workspace tab that is blocking request storage."));
  });
  return dbPromise;
}
async function journal(mode, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending", mode === "read" ? "readonly" : "readwrite"), store = tx.objectStore("pending"), read = store.get(JOURNAL_KEY);
    let found, message = "";
    read.onsuccess = () => {
      found = read.result;
      if (mode === "read") return;
      const clearing = mode === "clear" || mode === "cancel";
      const existingId = found?.args?.operationId, nextId = clearing ? value : value?.args?.operationId;
      const replacement = mode === "write" && found?.status === "conflict" && value?.previousRequest?.operationId === existingId;
      if (existingId && existingId !== nextId && !replacement) { message = "Another saved request is active. Recover it before starting a different save."; tx.abort(); return; }
      if (mode === "write" && existingId === nextId && found?.body !== value.body) { message = "The saved request body changed. Recover its original input."; tx.abort(); return; }
      if (mode === "cancel" && found && (!cancellableStatuses.has(found.status) || found.uncertainOutcome)) {
        message = "The saved request has started sending in another tab. Recover its original input."; tx.abort(); return;
      }
      if (clearing) store.delete(JOURNAL_KEY); else store.put(value, JOURNAL_KEY);
    };
    tx.oncomplete = () => resolve(found);
    tx.onerror = tx.onabort = () => reject(new Error(message || "The browser could not retain this request. Check browser storage and try again."));
  });
}
function validPending(p) {
  if (!p || typeof p.body !== "string" || !p.args?.operationId || !pendingStatuses.has(p.status) || typeof p.workspaceId !== "string") return false;
  try { const body = JSON.parse(p.body); return body.action === p.action && JSON.stringify(body.args) === JSON.stringify(p.args); } catch { return false; }
}
async function retain(p) {
  try { await journal("write", p); s.pending = p; }
  catch (error) { s.pending = await journal("read").catch(() => s.pending); throw error; }
  finally { renderPending(); controls(); }
}
async function clearPending(cancel = false) {
  try { await journal(cancel ? "cancel" : "clear", s.pending.args.operationId); s.pending = null; }
  catch (error) { s.pending = await journal("read").catch(() => s.pending); throw error; }
  finally { renderPending(); controls(); }
}
async function sendPending() {
  if (!s.pending || s.pendingBusy || !s.connected || !s.identity || s.pending.workspaceId !== s.identity.workspaceId) return;
  const retained = await journal("read");
  if (!validPending(retained) || retained.args.operationId !== s.pending.args.operationId || retained.body !== s.pending.body) { s.pending = retained; renderPending(); controls(); throw new Error("The saved request changed in another tab. Review the current saved request."); }
  const p = retained;
  if (p.status === "complete") { await clearPending(); await refresh(); return; }
  s.pendingBusy = true; controls();
  const uncertain = p.uncertainOutcome || ["submitting", "uncertain"].includes(p.status);
  let saved;
  try {
    await retain({ ...p, status: "submitting", message: "" });
    try {
      saved = await jsonRequest("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: p.body });
      if (!saved || !Number.isSafeInteger(saved.revision) || (saved.workspaceId && saved.workspaceId !== p.workspaceId)) throw new RequestError("The save response was incomplete.", 502);
    } catch (error) {
      const revision = error.details?.currentRevision ?? error.details?.actualRevision;
      const conflict = error.status === 409 && Number.isSafeInteger(revision);
      const status = conflict ? "conflict" : uncertain || !error.status || error.status >= 500 ? "uncertain" : [401, 403, 409, 423, 429].includes(error.status) ? "blocked" : "rejected";
      await retain({ ...p, status, uncertainOutcome: status === "uncertain", responseStatus: error.status, message: error.message, currentRevision: revision });
      if ([401, 403].includes(error.status) || (error.status === 409 && !conflict)) s.connected = false;
      notice(status === "uncertain" ? "The save outcome is pending. Recover the retained request to determine its result." : error.message, true);
      for (const id of ["policy-dialog", "review-dialog"]) if ($(id).open) closeDialog(id);
      $("pending-panel").scrollIntoView({ behavior: "smooth", block: "start" });
      if (conflict) await refresh().catch(() => {});
      return;
    }
    try { await clearPending(); }
    catch (error) { await retain({ ...p, status: "complete", result: saved, message: "Saved at revision " + saved.revision + ". Clear the completed request to continue." }); notice(error.message, true); }
    s.preview = null; s.previewSelection = null;
    if (saved.assessment?.id) s.selectedAssessmentId = saved.assessment.id;
    if (saved.incident?.id) s.selectedIncidentId = saved.incident.id;
    for (const id of ["policy-dialog", "review-dialog"]) if ($(id).open) closeDialog(id);
    notice(p.label + (saved.replayed ? " recovered at revision " : " saved at revision ") + saved.revision + ".");
  } finally { s.pendingBusy = false; renderPending(); controls(); }
  if (saved) await refresh().catch(error => notice("Saved at revision " + saved.revision + ". " + error.message, true));
  return saved;
}
async function mutate(name, args, label, expectedRevision = s.levels?.revision) {
  if (!s.connected || !s.levels) throw new Error("Connect to the workspace before saving.");
  if (s.pending || s.pendingBusy) throw new Error("Recover the saved request before starting another save.");
  const payload = { action: name, args: { ...args, operationId: crypto.randomUUID(), expectedRevision } };
  await retain({ ...payload, body: JSON.stringify(payload), label, workspaceId: s.identity.workspaceId, instanceId: s.identity.instanceId, createdAt: new Date().toISOString(), status: "prepared", uncertainOutcome: false });
  return sendPending();
}
function run(fn) { return (...args) => { try { return Promise.resolve(fn(...args)).catch(error => notice(error.message, true)); } catch (error) { notice(error.message, true); } }; }
function renderPending() {
  const box = $("pending-panel"), p = s.pending;
  box.hidden = !p; if (!p) { box.replaceChildren(); return; }
  if (!validPending(p)) {
    box.replaceChildren(h("h2", { id: "pending-title" }, "Saved request needs recovery"),
      h("p", {}, "The browser record is incomplete. Download it for recovery before making further changes."),
      btn("Download retained record", () => downloadJSON(p, "service-levels-retained-request.json")));
    return;
  }
  const same = s.identity?.workspaceId === p.workspaceId, pending = s.pendingBusy;
  const title = pending ? "Saving request" : p.status === "conflict" ? "Review the changed workspace" : p.status === "rejected" ? "Correct this request" : p.status === "complete" ? "Saved request completed" : "Recover a saved request";
  const buttons = [];
  if (!pending && same && s.connected) {
    if (p.status === "conflict") {
      buttons.push(btn("Refresh current workspace", run(refresh)));
      buttons.push(btn("Apply to reviewed revision " + s.levels?.revision, run(async () => {
        if (!s.levels || s.levels.revision !== s.view?.revision) throw new Error("Refresh the workspace before reviewing this revision.");
        const args = { ...p.args, operationId: crypto.randomUUID(), expectedRevision: s.levels.revision };
        const next = { ...p, args, body: JSON.stringify({ action: p.action, args }), status: "prepared", uncertainOutcome: false, message: "", createdAt: new Date().toISOString(),
          previousRequest: { operationId: p.args.operationId, expectedRevision: p.args.expectedRevision, body: p.body } };
        await retain(next); await sendPending();
      }), { disabled: !s.levels || s.readBusy }));
    } else if (p.status !== "rejected") buttons.push(btn(p.status === "complete" ? "Clear completed request" : "Recover original request", run(sendPending), { className: "primary" }));
  }
  if (!pending && cancellableStatuses.has(p.status) && !p.uncertainOutcome)
    buttons.push(btn("Cancel this unsaved request", run(async () => { await clearPending(true); notice("The unsaved request was cancelled. Edit the form to prepare a new request."); })));
  if (!same || !s.connected) buttons.push(btn("Reconnect to original workspace", () => openDialog("connection-dialog")));
  buttons.push(btn("Download saved request", () => downloadJSON(p, "service-levels-request-" + p.args.operationId + ".json")));
  box.replaceChildren(h("h2", { id: "pending-title" }, title), h("p", {}, p.message || p.label + " is retained with its exact input."),
    h("p", { className: "muted" }, p.label + " · revision " + p.args.expectedRevision + " · " + when(p.createdAt)),
    h("div", { className: "button-row" }, buttons),
    jsonBlock("Retained request", { workspaceId: p.workspaceId, status: p.status, action: p.action, args: p.args, result: p.result }));
}
function controls() {
  const disabled = !s.connected || !s.levels || Boolean(s.pending) || s.pendingBusy || s.readBusy;
  document.querySelectorAll("[data-write]").forEach(node => { node.disabled = disabled; });
  document.querySelectorAll("[data-read]").forEach(node => { node.disabled = !s.connected || s.readBusy || s.pendingBusy; });
  $("refresh-button").disabled = s.readBusy || s.pendingBusy;
  $("connection-button").disabled = s.pendingBusy || s.readBusy;
  assessmentControls();
}
async function connect() {
  if (s.pendingBusy || s.readBusy) throw new Error("Wait for the current request before reconnecting.");
  const identity = await jsonRequest("/api/identity", {}, true);
  if (!identity?.workspaceId || !identity?.instanceId) throw new Error("The server returned an incomplete workspace identity.");
  const expected = s.pending?.workspaceId ?? s.identity?.workspaceId;
  if (expected && identity.workspaceId !== expected) throw new Error("This address now serves a different workspace. Reconnect to the original workspace before continuing.");
  s.identity = identity;
  await refresh();
}
async function refresh() {
  if (!s.identity) throw new Error("Open Connection to connect to the workspace.");
  const version = ++s.refreshVersion; s.readBusy = true; controls();
  try {
    const [view, levels] = await Promise.all([action("workspace.read"), action("service-levels.read")]);
    if (version !== s.refreshVersion) return;
    if (view.workspaceId !== s.identity.workspaceId || levels.workspaceId !== s.identity.workspaceId) throw new Error("The connected workspace identity changed. Reconnect to the original workspace.");
    if (!Array.isArray(levels.policies) || !Array.isArray(levels.assessments) || !Array.isArray(levels.incidents)) throw new Error("The service-level response is incomplete.");
    if (view.revision !== levels.revision) throw new Error("The workspace changed while loading. Refresh to view one current revision.");
    s.view = view; s.levels = levels; s.connected = true;
    if (s.preview && s.preview.sourceRevision !== levels.revision) { s.preview = null; s.previewSelection = null; }
    $("workspace-title").textContent = view.title || "Operations workspace";
    $("revision-label").textContent = "Revision " + levels.revision;
    $("connection-state").textContent = "Connected · " + timeZone;
    $("last-refreshed").textContent = "Refreshed " + when(new Date().toISOString());
    const chosen = $("assessment-edition").value;
    $("assessment-edition").replaceChildren(h("option", { value: "" }, "Current workspace"), (view.editions ?? []).map(e => h("option", { value: e.id }, e.title + " · r" + e.sourceRevision)));
    if ([...$("assessment-edition").options].some(o => o.value === chosen)) $("assessment-edition").value = chosen;
    renderAll();
  } catch (error) {
    if (version !== s.refreshVersion) return;
    s.connected = false; $("connection-state").textContent = "Connection needs attention"; throw error;
  } finally { if (version === s.refreshVersion) { s.readBusy = false; controls(); renderPending(); } }
}

function showSection(name) {
  s.section = name;
  for (const section of ["overview", "policies", "assessments", "incidents"]) $(section + "-panel").hidden = section !== name;
  document.querySelectorAll("[data-section]").forEach(node => node.setAttribute("aria-current", node.dataset.section === name ? "page" : "false"));
}
function renderAll() { renderSummary(); renderPolicies(); renderAssessments(); renderIncidents(); renderPreview(); renderPending(); controls(); }
function renderSummary() {
  const levels = s.levels;
  if (!levels) return;
  const applied = levels.assessments.filter(a => a.appliedToIncidents).at(-1);
  const active = levels.incidents.filter(i => i.active);
  const actionable = levels.incidents.filter(i => ["open", "acknowledged"].includes(i.status));
  const metrics = [
    ["Enabled policies", levels.policies.filter(p => p.enabled).length, fmt(levels.policies.length) + " policies in this workspace"],
    ["Active conditions", active.length, active.filter(i => i.status === "accepted").length + " accepted by an operator"],
    ["Needs action", actionable.length, actionable.filter(i => !i.owner).length + " without an owner"],
    ["Applied assessments", levels.assessments.filter(a => a.appliedToIncidents).length, applied ? "Last as of " + when(applied.assessment.asOf) : "Save an assessment to open the incident desk"]
  ];
  $("summary").replaceChildren(...metrics.map(([label, value, note]) => h("div", { className: "metric" }, h("div", { className: "metric-label" }, label), h("div", { className: "metric-value" }, fmt(value)), h("div", { className: "metric-note" }, note))));
  $("policy-count").textContent = fmt(levels.policies.length);
  $("assessment-count").textContent = fmt(levels.assessments.length);
  $("incident-count").textContent = fmt(levels.incidents.length);
}
function policyDescription(p) {
  const values = [];
  if (p.maxCompletionAgeSeconds) values.push("Freshness " + duration(p.maxCompletionAgeSeconds));
  if (p.maxDurationSeconds) values.push("Duration " + duration(p.maxDurationSeconds));
  if (p.monitorFailures) values.push("Failures within " + duration(p.failureWindowSeconds));
  return values.join(" · ");
}
function renderPolicies() {
  const all = s.levels?.policies ?? [], search = $("policy-search").value.trim().toLowerCase(), filter = $("policy-filter").value;
  const rows = all.filter(p => (!filter || (filter === "enabled") === p.enabled) && [p.title, jobLabel(p.jobKey), p.owner].join(" ").toLowerCase().includes(search));
  if (!all.length) {
    $("policy-table").replaceChildren(empty("Create the first service policy", "Choose an observed job or enter its exact namespace and name, then set a freshness, duration or failure target.",
      [btn("New policy", () => openPolicy(), { "data-write": true })]));
    controls(); return;
  }
  if (!rows.length) { $("policy-table").replaceChildren(empty("No matching policies", "Adjust the search or state filter.")); return; }
  $("policy-table").replaceChildren(table(["Policy", "Job", "Conditions", "Owner", "State", "Actions"], rows.map(p => h("tr", {},
    h("td", {}, h("span", { className: "cell-title" }, p.title), h("small", { className: "muted" }, "Version " + p.version)),
    h("td", {}, jobCell(p.jobKey)), h("td", {}, policyDescription(p), h("small", {}, "Effective " + when(p.effectiveFrom))),
    h("td", {}, p.owner || "Unassigned"), h("td", {}, badge(p.enabled ? "enabled" : "disabled")),
    h("td", {}, h("div", { className: "button-row" }, btn("Edit", () => openPolicy(p), { "data-write": true }), btn("History", () => showPolicyHistory(p)))))),
    "Service-level policies"));
  controls();
}
function setDuration(id, value, defaultUnit) {
  const input = $(id), select = $(id + "-unit");
  let unit = defaultUnit;
  if (value) for (const candidate of [86400, 3600, 60, 1]) if (value % candidate === 0) { unit = candidate; break; }
  select.value = String(unit); input.value = value === null || value === undefined ? "" : String(value / unit);
}
function readDuration(id, optional = false) {
  if (!$(id).value && optional) return null;
  const amount = Number($(id).value), multiplier = Number($(id + "-unit").value), value = amount * multiplier;
  if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(value) || value < 1 || value > 315360000) throw new Error("Use a positive whole duration of at most 3,650 days.");
  return value;
}
function inputInstant(id, label) {
  const input = $(id);
  return input.dataset.originalValue === input.value && input.dataset.originalInstant ? input.dataset.originalInstant : fromLocal(input.value, label);
}
function openPolicy(p = null) {
  if (!s.connected || s.pending) { notice("Connect and recover any saved request before editing a policy.", true); return; }
  $("policy-form").reset(); $("policy-feedback").textContent = "";
  $("policy-form").dataset.revision = String(s.levels.revision);
  $("policy-dialog-title").textContent = p ? "Edit service policy" : "New service policy";
  $("policy-id").value = p?.id ?? ""; $("policy-title").value = p?.title ?? "";
  const jobs = [...(s.view?.jobs ?? [])].sort((a, b) => jobLabel(a.key).localeCompare(jobLabel(b.key)));
  $("policy-job").replaceChildren(h("option", { value: "" }, "Enter the job below"), jobs.map(j => h("option", { value: j.key }, jobLabel(j.key))));
  if (p && !jobs.some(j => j.key === p.jobKey)) $("policy-job").append(h("option", { value: p.jobKey }, jobLabel(p.jobKey)));
  $("policy-job").value = p?.jobKey ?? "";
  const parts = p ? jobParts(p.jobKey) : { namespace: "", name: "" };
  $("policy-namespace").value = parts.namespace; $("policy-job-name").value = parts.name;
  $("policy-owner").value = p?.owner ?? ""; $("policy-runbook").value = p?.runbook ?? "";
  $("policy-effective").value = localTime(p?.effectiveFrom ?? new Date().toISOString());
  $("policy-effective").dataset.originalValue = $("policy-effective").value;
  $("policy-effective").dataset.originalInstant = p?.effectiveFrom ?? "";
  $("policy-enabled").checked = p?.enabled ?? true; $("policy-failures").checked = p?.monitorFailures ?? true;
  setDuration("policy-freshness", p?.maxCompletionAgeSeconds, 3600);
  setDuration("policy-duration", p?.maxDurationSeconds, 60);
  setDuration("policy-window", p?.failureWindowSeconds ?? 86400, 3600);
  openDialog("policy-dialog"); controls(); $("policy-title").focus();
}
async function submitPolicy(event) {
  event.preventDefault(); $("policy-feedback").textContent = "";
  try {
    const namespace = $("policy-namespace").value, name = $("policy-job-name").value;
    if (!namespace.trim() || !name.trim()) throw new Error("Enter the job's exact namespace and name.");
    const policy = { title: $("policy-title").value.trim(), jobKey: JSON.stringify(["job", namespace, name]),
      owner: $("policy-owner").value.trim(), runbook: $("policy-runbook").value.trim(),
      effectiveFrom: inputInstant("policy-effective", "effective time"), enabled: $("policy-enabled").checked,
      maxCompletionAgeSeconds: readDuration("policy-freshness", true), maxDurationSeconds: readDuration("policy-duration", true),
      failureWindowSeconds: readDuration("policy-window"), monitorFailures: $("policy-failures").checked };
    if ($("policy-id").value) policy.id = $("policy-id").value;
    if (!policy.maxCompletionAgeSeconds && !policy.maxDurationSeconds && !policy.monitorFailures) throw new Error("Enable at least one freshness, duration or failure condition.");
    if (policy.runbook) {
      const url = new URL(policy.runbook);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTP or HTTPS runbook URL without embedded credentials.");
    }
    const reason = $("policy-reason").value.trim();
    if (!reason) throw new Error("Add the reason for this policy version.");
    await mutate("service-levels.policy.save", { policy, reason }, "Policy", Number($("policy-form").dataset.revision));
  } catch (error) { failFeedback("policy-feedback", error); }
}
function showPolicyHistory(p) {
  $("history-title").textContent = p.title + " · policy history";
  const versions = [...(p.history ?? []), { ...p, history: undefined }].reverse();
  $("history-body").replaceChildren(...versions.map(v => h("section", { className: "history-entry" },
    h("h3", {}, "Version " + v.version + " · " + (v.enabled ? "Enabled" : "Disabled")),
    record([["Saved", when(v.updatedAt)], ["Reason", v.reason], ["Job", jobLabel(v.jobKey)], ["Owner", v.owner || "Unassigned"],
      ["Effective from", when(v.effectiveFrom)], ["Completion freshness", duration(v.maxCompletionAgeSeconds)],
      ["Execution duration", duration(v.maxDurationSeconds)], ["Failure monitoring", v.monitorFailures ? duration(v.failureWindowSeconds) : "Disabled"], ["Runbook", safeLink(v.runbook)]]),
    jsonBlock("Complete version", v))));
  openDialog("history-dialog");
}
function assessmentSelection() { return { asOf: fromLocal($("assessment-time").value, "assessment time"), editionId: $("assessment-edition").value || null }; }
function selectionKey(selection) { return JSON.stringify(selection); }
function assessmentControls() {
  const edition = $("assessment-edition").value, last = s.levels?.assessments.filter(a => a.appliedToIncidents).at(-1);
  const chosen = new Date($("assessment-time").value).getTime();
  const earlier = last && Number.isFinite(chosen) && chosen < Date.parse(last.assessment.asOf);
  $("assessment-apply").disabled = Boolean(edition || earlier || s.pending || s.pendingBusy);
  if (edition || earlier) $("assessment-apply").checked = false;
  let current = false;
  try { current = s.preview && s.previewSelection === selectionKey(assessmentSelection()) && s.preview.sourceRevision === s.levels?.revision; } catch {}
  $("save-assessment-button").disabled = !s.connected || !current || Boolean(s.pending) || s.pendingBusy || s.readBusy;
  $("assessment-hint").textContent = edition ? "This saved edition will be recorded as a historical assessment."
    : earlier ? "This time precedes the latest applied assessment (" + when(last.assessment.asOf) + "). It will be saved in assessment history."
    : current ? "Preview ready at revision " + s.preview.sourceRevision + ". Saving retains these policy versions, source references and findings."
    : "Preview this time and source selection before saving.";
}
async function previewAssessment(event) {
  event?.preventDefault();
  if (!s.connected || s.readBusy || s.pendingBusy) return;
  const selected = assessmentSelection(), key = selectionKey(selected);
  s.readBusy = true; controls();
  try {
    const result = await action("service-levels.evaluate", selected);
    if (result.workspaceId !== s.identity.workspaceId || !Array.isArray(result.observations) || !Array.isArray(result.findings)) throw new Error("The assessment response is incomplete.");
    if (result.sourceRevision !== s.levels.revision) throw new Error("The workspace changed. Refresh it before previewing this assessment.");
    if (key !== selectionKey(assessmentSelection())) throw new Error("The selection changed during the preview. Preview the selected time again.");
    s.preview = result; s.previewSelection = key; renderPreview(); notice("Assessment preview ready as of " + when(result.asOf) + ".");
  } finally { s.readBusy = false; controls(); }
}
async function saveAssessment() {
  const selected = assessmentSelection();
  if (!s.preview || s.previewSelection !== selectionKey(selected) || s.preview.sourceRevision !== s.levels?.revision) throw new Error("Preview the current time and source selection before saving.");
  const result = await mutate("service-levels.assessment.save", { ...selected, applyToIncidents: $("assessment-apply").checked }, "Assessment", s.preview.sourceRevision);
  if (result?.assessment) { s.selectedAssessmentId = result.assessment.id; renderAssessments(); showSection("assessments"); }
}
function coverageBlock(coverage) {
  if (!coverage) return null;
  const values = [["Selected events", coverage.selectedEvents], ["Eligible events", coverage.eligibleEvents], ["Projected events", coverage.projectedEvents],
    ["Future events", coverage.excludedFutureEvents], ["Invalid timestamps", coverage.invalidTimeEvents ?? 0]];
  return h("div", {}, h("div", { className: "coverage" }, values.map(([label, value]) => h("span", {}, label + ": ", h("strong", {}, fmt(value))))),
    coverage.diagnostics?.length ? jsonBlock("Event diagnostics (" + coverage.diagnostics.length + ")", coverage.diagnostics) : null);
}
function observationTable(assessment) {
  if (!assessment.observations.length) return empty("No policy observations", "Create a service policy for a job, then preview the assessment.");
  return table(["Policy / job", "Condition", "Last completion", "Runs", "Owner", "Notes"], assessment.observations.map(o => h("tr", {},
    h("td", {}, h("span", { className: "cell-title" }, o.title), h("small", {}, jobLabel(o.jobKey))),
    h("td", {}, badge(o.state, o.state === "violated")), h("td", {}, when(o.lastCompletedAt)),
    h("td", {}, fmt(o.observedRuns) + " observed", h("small", {}, fmt(o.activeRuns) + " active")),
    h("td", {}, o.owner || "Unassigned"), h("td", {}, (o.notes ?? []).length ? h("ul", {}, o.notes.map(n => h("li", {}, n))) : "—"))),
    "Observed policy conditions");
}
async function downloadSource(id) {
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("The source reference is invalid.");
  const result = await response("/api/objects/" + id);
  const source = s.view?.sources?.find(row => row.id === id);
  download(await result.blob(), source?.name || "openlineage-source-" + id + ".json");
}
function findingCard(finding) {
  const details = [["Job", jobLabel(finding.jobKey)], ["Condition", words(finding.kind)], ["Owner", finding.owner || "Unassigned"],
    ["Observed at", when(finding.observedAt)], ["Due at", when(finding.dueAt)],
    ["Measured", finding.measuredSeconds === null ? "—" : duration(finding.measuredSeconds)], ["Threshold", duration(finding.thresholdSeconds)], ["Runbook", safeLink(finding.runbook)]];
  return h("article", { className: "finding-card" }, h("h3", {}, finding.summary), record(details),
    h("div", { className: "button-row" }, (finding.sourceIds ?? []).map((id, i) => btn("Download source " + (i + 1), run(() => downloadSource(id)), { "data-read": true }))),
    jsonBlock("Original event and source references", { id: finding.id, policyId: finding.policyId, policyVersion: finding.policyVersion, jobKey: finding.jobKey, runKey: finding.runKey,
      eventIds: finding.eventIds, sourceIds: finding.sourceIds, asOf: finding.asOf }));
}
function renderPreview() {
  const result = s.preview;
  if (!result) {
    $("assessment-preview").replaceChildren(empty("Ready to assess", s.levels?.policies.length ? "Choose the observation time and source selection, then preview the policy conditions." : "Start by adding a service policy for a job.", s.levels?.policies.length ? [] : [btn("Create policy", () => openPolicy(), { "data-write": true })]));
    return;
  }
  $("assessment-preview").replaceChildren(h("div", { className: "section-heading" }, h("div", {}, h("h2", {}, "Preview · " + fmt(result.findings.length) + " findings"),
    h("p", { className: "muted" }, "As of " + when(result.asOf) + " · source revision " + result.sourceRevision)), btn("Download preview", () => downloadJSON(result, "service-levels-preview.json"))),
    coverageBlock(result.coverage), observationTable(result), h("div", { className: "finding-list" }, result.findings.map(findingCard)),
    jsonBlock("Policy versions in this assessment", result.policySnapshots));
  controls();
}
function editionLabel(id) { return id ? (s.view?.editions?.find(e => e.id === id)?.title ?? id) : "Current workspace"; }
function reportButtons(saved) {
  return h("div", { className: "button-row" },
    btn("Download assessment", () => downloadJSON(saved, "service-assessment-" + saved.id + ".json")),
    ...["html", "csv", "json"].map(format => btn(format.toUpperCase() + " report", run(async () => {
      const result = await action("service-levels.report", { assessmentId: saved.id, format });
      if (typeof result.text !== "string" || typeof result.mediaType !== "string") throw new Error("The report response is incomplete.");
      download(new Blob([result.text], { type: result.mediaType }), "service-levels-" + saved.id + "." + format);
    }), { "data-read": true })));
}
function renderAssessments() {
  const items = [...(s.levels?.assessments ?? [])].reverse();
  if (!items.length) {
    $("assessment-table").replaceChildren(empty("No saved assessments", "Preview a service window, then save it to retain the selected sources, policy versions and findings.", [btn("Preview an assessment", () => showSection("overview"))]));
    $("assessment-detail").hidden = true; return;
  }
  $("assessment-table").replaceChildren(table(["As of", "Source selection", "Observations", "Findings", "Incident desk", "Saved", "Actions"], items.map(a => h("tr", {},
    h("td", {}, when(a.assessment.asOf)), h("td", {}, editionLabel(a.assessment.editionId), h("small", {}, "Source revision " + a.assessment.sourceRevision)),
    h("td", {}, fmt(a.assessment.observations.length)), h("td", {}, fmt(a.assessment.findings.length)),
    h("td", {}, a.appliedToIncidents ? badge("Applied") : badge("History only")),
    h("td", {}, when(a.createdAt)), h("td", {}, btn("Open", () => { s.selectedAssessmentId = a.id; renderAssessmentDetail(); $("assessment-detail").scrollIntoView({ behavior: "smooth", block: "start" }); })))),
    "Saved service-level assessments"));
  renderAssessmentDetail();
}
function renderAssessmentDetail() {
  const saved = s.levels?.assessments.find(a => a.id === s.selectedAssessmentId), box = $("assessment-detail");
  box.hidden = !saved; if (!saved) return;
  const a = saved.assessment;
  box.replaceChildren(h("div", { className: "section-heading" }, h("div", {}, h("h2", {}, "Assessment · " + when(a.asOf)),
    h("p", { className: "muted" }, editionLabel(a.editionId) + " · source revision " + a.sourceRevision + " · " + (saved.appliedToIncidents ? "Applied to incident desk" : "History only"))),
    btn("Close details", () => { s.selectedAssessmentId = null; box.hidden = true; })),
    reportButtons(saved),
    h("p", { className: "field-help" }, "Reports combine this saved assessment with the current policy versions and complete current incident history. The assessment download preserves this record alone."),
    coverageBlock(a.coverage), observationTable(a),
    h("h3", {}, "Findings (" + a.findings.length + ")"),
    a.findings.length ? h("div", { className: "finding-list" }, a.findings.map(findingCard)) : h("p", {}, "The selected policies have no findings at this observation time."),
    jsonBlock("Policy snapshots", a.policySnapshots),
    jsonBlock("Complete saved assessment", saved));
  controls();
}

function incidentTitle(incident) { return s.levels?.policies.find(p => p.id === incident.policyId)?.title || incident.latestFinding?.summary || incident.id; }
function renderIncidents() {
  const all = s.levels?.incidents ?? [], query = $("incident-search").value.trim().toLowerCase(), status = $("incident-filter").value, condition = $("incident-active").value;
  const rows = all.filter(i => (!status || (status === "actionable" ? ["open", "acknowledged"].includes(i.status) : i.status === status)) &&
    (!condition || (condition === "active") === i.active) &&
    [incidentTitle(i), i.owner, i.latestFinding?.summary, jobLabel(i.originalFinding.jobKey), i.id].join(" ").toLowerCase().includes(query))
    .sort((a, b) => Number(b.active) - Number(a.active) || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt) || a.id.localeCompare(b.id));
  if (!all.length) $("incident-table").replaceChildren(empty("No incidents recorded", "Save a current assessment with incident updates enabled. Its findings will appear here for assignment and review.", [btn("Assess the workspace", () => showSection("overview"))]));
  else if (!rows.length) $("incident-table").replaceChildren(empty("No incidents match this view", "Adjust the search, status or condition filter to see the remaining records."));
  else $("incident-table").replaceChildren(table(["Policy / finding", "Job", "Status", "Condition", "Owner", "Last observed", "Actions"], rows.map(i => h("tr", {},
    h("td", {}, h("span", { className: "cell-title" }, incidentTitle(i)), h("small", {}, i.latestFinding?.summary || i.originalFinding.summary)),
    h("td", {}, jobCell(i.originalFinding.jobKey)), h("td", {}, badge(i.status)),
    h("td", {}, badge(i.active ? "Active" : "Clear", i.active)), h("td", {}, i.owner || "Unassigned"), h("td", {}, when(i.lastSeenAt)),
    h("td", {}, h("div", { className: "button-row" },
      btn("Open", () => { s.selectedIncidentId = i.id; renderIncidentDetail(); $("incident-detail").scrollIntoView({ behavior: "smooth", block: "start" }); }),
      btn("Review", () => openReview(i), { "data-write": true }))))), "Service-level incidents"));
  renderIncidentDetail(); controls();
}
function renderIncidentDetail() {
  const incident = s.levels?.incidents.find(i => i.id === s.selectedIncidentId), box = $("incident-detail");
  box.hidden = !incident; if (!incident) return;
  const f = incident.latestFinding || incident.originalFinding;
  box.replaceChildren(h("div", { className: "section-heading" }, h("div", {}, h("h2", {}, incidentTitle(incident)),
    h("p", { className: "muted" }, f.summary)), btn("Close details", () => { s.selectedIncidentId = null; box.hidden = true; })),
    h("div", { className: "button-row" }, badge(incident.status), badge(incident.active ? "Active" : "Clear", incident.active),
      btn("Review incident", () => openReview(incident), { "data-write": true, className: "primary" }),
      btn("Download incident", () => downloadJSON(incident, "service-incident-" + incident.id + ".json"))),
    record([["Owner", incident.owner || "Unassigned"], ["First observed", when(incident.firstSeenAt)], ["Last observed", when(incident.lastSeenAt)],
      ["Last evaluated", when(incident.lastEvaluatedAt)], ["Last assessment", assessmentLink(incident.lastAssessmentId)],
      ["Last finding assessment", assessmentLink(incident.lastObservedAssessmentId ?? incident.lastAssessmentId)], ["Runbook", safeLink(f.runbook)]]),
    h("h3", {}, "Latest observed finding"), findingCard(f),
    h("h3", {}, "Complete incident history"),
    table(["When", "Action", "Owner", "Reason", "Assessment"], (incident.history ?? []).map(entry => h("tr", {},
      h("td", {}, when(entry.at)), h("td", {}, words(entry.action)),
      h("td", {}, entry.owner ?? entry.after?.owner ?? "—"), h("td", {}, entry.reason || "—"),
      h("td", {}, entry.assessmentId ? assessmentLink(entry.assessmentId) : "—"))), "Incident history"),
    jsonBlock("Original finding", incident.originalFinding), jsonBlock("Complete incident record", incident));
  controls();
}
function assessmentLink(id) {
  const saved = s.levels?.assessments.find(a => a.id === id);
  return saved ? btn(when(saved.assessment.asOf), () => { s.selectedAssessmentId = id; renderAssessments(); showSection("assessments"); $("assessment-detail").scrollIntoView({ behavior: "smooth", block: "start" }); }) : h("span", { className: "mono" }, id || "—");
}
function openReview(incident) {
  if (!s.connected || s.pending) { notice("Connect and recover any saved request before reviewing an incident.", true); return; }
  $("review-form").reset(); $("review-feedback").textContent = "";
  $("review-form").dataset.revision = String(s.levels.revision);
  $("review-id").value = incident.id; $("review-owner").value = incident.owner || "";
  $("review-summary").textContent = incidentTitle(incident) + " · " + (incident.active ? "Active condition" : "Condition clear") + " · " + words(incident.status);
  [...$("review-decision").options].find(o => o.value === "resolve").disabled = incident.active;
  $("review-decision").value = incident.active ? "acknowledge" : "resolve";
  reviewExplanation(); openDialog("review-dialog");
}
function reviewExplanation() {
  const decision = $("review-decision").value;
  const text = {
    acknowledge: "Record that this incident is being handled. Its observed condition stays attached to the latest assessment.",
    assign: "Set the person or team responsible for this incident. An owner is required.",
    resolve: "Resolve an incident whose condition is clear in the saved incident desk. A later finding can reopen it.",
    accept: "Record your reason for accepting this condition. Its observed active or clear state remains visible.",
    reopen: "Return this incident to the open queue and retain the prior decisions."
  };
  $("review-explanation").textContent = text[decision] || "";
  $("review-owner").required = decision === "assign";
}
async function submitReview(event) {
  event.preventDefault(); $("review-feedback").textContent = "";
  try {
    const id = $("review-id").value, decision = $("review-decision").value, reason = $("review-reason").value.trim(), owner = $("review-owner").value.trim();
    const incident = s.levels.incidents.find(i => i.id === id);
    if (!incident) throw new Error("Refresh the incident desk before reviewing this record.");
    if (decision === "resolve" && incident.active) throw new Error("Save a later assessment showing the condition clear before resolving it.");
    if (!reason) throw new Error("Record the reason for this decision.");
    if (decision === "assign" && !owner) throw new Error("An assignment requires an owner.");
    await mutate("service-levels.incident.review", { id, decision, reason, ...(owner ? { owner } : {}) }, "Incident decision", Number($("review-form").dataset.revision));
  } catch (error) { failFeedback("review-feedback", error); }
}

$("timezone-label").textContent = "(" + timeZone + ")";
document.querySelectorAll(".time-zone").forEach(node => { node.textContent = "(" + timeZone + ")"; });
$("assessment-time").value = localTime();
$("access-token").value = accessToken;
document.querySelectorAll("[data-section]").forEach(node => node.addEventListener("click", () => showSection(node.dataset.section)));
document.querySelectorAll("[data-close]").forEach(node => node.addEventListener("click", () => closeDialog(node.dataset.close)));
$("refresh-button").addEventListener("click", run(refresh));
$("connection-button").addEventListener("click", () => { $("connection-feedback").textContent = ""; openDialog("connection-dialog"); });
$("connection-form").addEventListener("submit", async event => {
  event.preventDefault(); $("connection-feedback").textContent = "";
  if (s.pendingBusy || s.readBusy) { $("connection-feedback").textContent = "Wait for the current request before reconnecting."; return; }
  accessToken = $("access-token").value;
  try {
    await connect();
    try { sessionStorage.setItem(TOKEN_KEY, accessToken); } catch {}
    closeDialog("connection-dialog"); notice("Connected to " + (s.view.title || "the operations workspace") + ".");
  } catch (error) { failFeedback("connection-feedback", error); controls(); }
});
$("assessment-form").addEventListener("submit", run(previewAssessment));
$("save-assessment-button").addEventListener("click", run(saveAssessment));
$("use-now-button").addEventListener("click", () => { $("assessment-time").value = localTime(); s.preview = null; s.previewSelection = null; renderPreview(); assessmentControls(); });
for (const id of ["assessment-time", "assessment-edition"]) $(id).addEventListener("change", () => { s.preview = null; s.previewSelection = null; renderPreview(); assessmentControls(); });
$("assessment-apply").addEventListener("change", assessmentControls);
$("new-policy-button").addEventListener("click", () => openPolicy());
$("start-assessment-button").addEventListener("click", () => { showSection("overview"); $("assessment-time").focus(); });
$("policy-form").addEventListener("submit", submitPolicy);
$("policy-job").addEventListener("change", () => {
  if (!$("policy-job").value) return;
  const p = jobParts($("policy-job").value); $("policy-namespace").value = p.namespace; $("policy-job-name").value = p.name;
});
for (const id of ["policy-namespace", "policy-job-name"]) $(id).addEventListener("input", () => { $("policy-job").value = ""; });
$("policy-search").addEventListener("input", renderPolicies);
$("policy-filter").addEventListener("change", renderPolicies);
$("incident-search").addEventListener("input", renderIncidents);
$("incident-filter").addEventListener("change", renderIncidents);
$("incident-active").addEventListener("change", renderIncidents);
$("review-decision").addEventListener("change", reviewExplanation);
$("review-form").addEventListener("submit", submitReview);
window.addEventListener("focus", () => {
  if (s.pendingBusy) return;
  journal("read").then(p => { s.pending = p; renderPending(); controls(); }).catch(error => notice(error.message, true));
});
async function initialize() {
  controls(); renderPreview();
  try { s.pending = await journal("read"); renderPending(); } catch (error) { notice(error.message, true); }
  try { await connect(); } catch (error) { notice(error.message, true); openDialog("connection-dialog"); }
  controls();
}
initialize();
