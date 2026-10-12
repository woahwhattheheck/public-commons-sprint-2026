const $ = id => document.getElementById(id);
const KINDS = { runs: "run", jobs: "job", datasets: "dataset" };
const LABELS = { runs: "Runs", jobs: "Jobs", datasets: "Datasets", sources: "Sources", editions: "Saved editions", reviews: "Reviews", results: "Attached results", diagnostics: "Events requiring attention" };
const DESCRIPTIONS = {
  runs: "Execution history from imported events.",
  jobs: "Named jobs and their declared data boundaries.",
  datasets: "Observed datasets, schema facets, and connected runs.",
  sources: "Complete original files and their import details.",
  editions: "Named event selections for comparison and review.",
  reviews: "Recorded decisions, reasons, and their history.",
  results: "Complete result files linked to an entity and a saved edition.",
  diagnostics: "Original events with details to resolve before projection."
};
const state = {
  view: null, section: "runs", edition: "", search: "", runState: "", attention: false,
  selection: null, detail: null, detailLoading: false, detailTab: "overview",
  detailVersion: 0, viewVersion: 0, lineage: null, lineageLoading: false,
  lineageDirection: "both", lineageDepth: 6, comparison: null, compareFrom: "", compareTo: "",
  pending: null, pendingBusy: false, connected: false, identity: null,
  reviewDraft: null, resultEntity: null, importBusy: false
};
const JOURNAL_KEY = location.origin + location.pathname;
const TOKEN_KEY = "openlineage-access:" + JOURNAL_KEY;
let accessToken = "";
try { accessToken = sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch {}
let journalPromise;
const formatter = new Intl.NumberFormat();
function count(value) { return formatter.format(Number(value) || 0); }
function bytes(value) {
  let n = Number(value); if (!Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(n)) + " " + units[i];
}
function when(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { timeZoneName: "short" }) : String(value);
}
function elapsed(value) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (n < 1000) return n + " ms";
  if (n < 60000) return (n / 1000).toFixed(2) + " s";
  return Math.floor(n / 60000) + " min " + Math.round(n % 60000 / 1000) + " s";
}
function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false || name === "value") continue;
    if (name.startsWith("on") && typeof value === "function") element.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === "className") element.className = value;
    else if (["disabled", "checked", "hidden", "open"].includes(name)) element[name] = Boolean(value);
    else element.setAttribute(name, value === true ? "" : String(value));
  }
  const append = child => {
    if (Array.isArray(child)) child.forEach(append);
    else if (child !== null && child !== undefined && child !== false) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  };
  children.forEach(append);
  if (attrs.value !== undefined) element.value = String(attrs.value);
  return element;
}
function button(label, handler, className = "", extra = {}) { return h("button", { type: "button", className, onclick: handler, ...extra }, label); }
function badge(label, emphasis = false) { return h("span", { className: "badge" + (emphasis ? " emphasis" : "") }, String(label ?? "—").replaceAll("-", " ")); }
function short(value, length = 12) { const text = String(value ?? ""); return text.length > length ? text.slice(0, length) + "…" : text; }
function editionName(id) { return id ? state.view?.editions?.find(item => item.id === id)?.title ?? id : "Current workspace"; }
function entityName(key) {
  const value = allEntities().find(item => item.key === key);
  if (value) return value.name + (value.runId ? " · " + short(value.runId, 8) : "");
  try { const parts = JSON.parse(key); return String(parts[2] ?? key) + (parts[0] === "run" ? " · " + short(parts[3], 8) : ""); } catch { return String(key); }
}
function kindForKey(key) { try { return JSON.parse(key)[0]; } catch { return "entity"; } }
function allEntities() { return [...(state.view?.runs ?? []), ...(state.view?.jobs ?? []), ...(state.view?.datasets ?? [])]; }
function recordFields(entries) {
  const content = [];
  for (const [label, value] of entries) content.push(h("dt", {}, label), h("dd", {}, value ?? "—"));
  return h("dl", { className: "record-fields" }, content);
}
function jsonBlock(title, value, opened = false) {
  return h("details", { className: "json-block", open: opened }, h("summary", {}, title), h("pre", {}, JSON.stringify(value, null, 2)));
}
function empty(title, description, action = null, compact = false) {
  return h("div", { className: "empty" + (compact ? " compact" : "") }, h("h3", {}, title), h("p", {}, description), action);
}
function table(headers, rows, label) {
  return h("div", { className: "table-wrap" }, h("table", {}, h("caption", { className: "sr-only" }, label),
    h("thead", {}, h("tr", {}, headers.map(value => h("th", { scope: "col" }, value)))),
    h("tbody", {}, rows)));
}
function safeLink(value, label = value) {
  try { const url = new URL(value); if (["https:", "http:"].includes(url.protocol)) return h("a", { href: url.href, target: "_blank", rel: "noopener noreferrer" }, label); } catch {}
  return h("span", {}, value || "—");
}
function notice(message, error = false) {
  $("notice").replaceChildren(document.createTextNode(message));
  $("notice").hidden = !message; $("notice").classList.toggle("error", error);
  $("notice").setAttribute("role", error ? "alert" : "status");
}
function feedback(id, message) { $(id).textContent = message ?? ""; }
function openDialog(id) { if (!$(id).open) $(id).showModal(); }
function closeDialog(id) { $(id).close(); }
function setBusyControls() {
  const disabled = !state.view || Boolean(state.pending) || state.pendingBusy || state.importBusy;
  document.querySelectorAll("[data-write]").forEach(node => { node.disabled = disabled; });
  $("refresh-button").disabled = !state.connected && $("catalog").getAttribute("aria-busy") === "true";
}
class RequestError extends Error {
  constructor(message, status = 0, details = null) { super(message); this.status = status; this.details = details; }
}
async function response(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (accessToken) headers.set("Authorization", "Bearer " + accessToken);
  if (state.identity?.workspaceId) headers.set("X-OpenLineage-Workspace", state.identity.workspaceId);
  if (state.identity?.instanceId) headers.set("X-OpenLineage-Instance", state.identity.instanceId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const result = await fetch(path, { ...options, headers, signal: controller.signal, credentials: "same-origin", cache: "no-store" });
    if (!result.ok) {
      let body;
      try { body = await result.json(); } catch { body = {}; }
      const message = typeof body.error === "string" ? body.error : body.error?.message ?? body.message ?? result.statusText;
      if (result.status === 401) {
        $("connection-description").textContent = "This workspace requires an access token. Enter it to connect or recover your saved request.";
        openDialog("connection-dialog");
      }
      throw new RequestError(message || "Request failed", result.status, body.details ?? body.error?.details ?? null);
    }
    return result;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(error.name === "AbortError" ? "The response did not arrive in time." : "The workspace connection was interrupted.", 0);
  } finally { clearTimeout(timer); }
}
async function jsonRequest(path, options = {}) {
  const result = await response(path, options);
  try { return await result.json(); } catch { throw new RequestError("The workspace returned an unreadable response.", 502); }
}
async function action(name, args = {}) {
  return jsonRequest("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: name, args }) });
}
function journalDatabase() {
  if (!journalPromise) journalPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("Browser request storage is unavailable.")); return; }
    const request = indexedDB.open("openlineage-operator", 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("pending")) request.result.createObjectStore("pending"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Your browser could not open the saved request."));
    request.onblocked = () => reject(new Error("Close other workspace tabs to finish opening saved requests."));
  });
  return journalPromise;
}
async function journal(mode, value) {
  const db = await journalDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending", mode === "read" ? "readonly" : "readwrite");
    const objectStore = tx.objectStore("pending");
    const request = objectStore.get(JOURNAL_KEY);
    let found, conflictMessage = "";
    request.onsuccess = () => {
      found = request.result;
      if (mode === "read") return;
      const currentId = found?.args?.operationId;
      const requestedId = mode === "clear" ? value : value?.args?.operationId;
      const reviewedReplacement = mode === "write" && found?.status === "conflict" && value?.previousRequest?.operationId === currentId;
      if (currentId && currentId !== requestedId && !reviewedReplacement) {
        conflictMessage = "Another saved request is active in this browser. Recover it before starting a different save.";
        tx.abort(); return;
      }
      if (mode === "clear") objectStore.delete(JOURNAL_KEY);
      else objectStore.put(value, JOURNAL_KEY);
    };
    tx.oncomplete = () => resolve(found);
    tx.onerror = tx.onabort = () => reject(new Error(conflictMessage || "Your browser could not retain this request. Free browser storage and try again."));
  });
}
async function retainPending(value) {
  try { await journal("write", value); state.pending = value; }
  catch (error) { state.pending = await journal("read").catch(() => state.pending); throw error; }
  finally { renderPending(); setBusyControls(); }
}
async function clearPending() {
  await journal("clear", state.pending?.args?.operationId);
  state.pending = null; renderPending(); setBusyControls();
}
function downloaded(blob, name) {
  const url = URL.createObjectURL(blob), link = h("a", { href: url, download: name || "download" });
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function downloadJSON(value, name) { downloaded(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), name); }
async function downloadObject(id, name) {
  try { const result = await response("/api/objects/" + encodeURIComponent(id)); downloaded(await result.blob(), name); }
  catch (error) { notice(error.message, true); }
}
function base64ToBytes(value) {
  const binary = atob(value), result = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i);
  return result;
}
function toBase64(buffer) {
  const data = new Uint8Array(buffer); let binary = "";
  for (let i = 0; i < data.length; i += 32768) binary += String.fromCharCode(...data.subarray(i, i + 32768));
  return btoa(binary);
}
function pendingSummary(pending) {
  const args = { ...pending.args };
  if (args.base64 !== undefined) args.base64 = "[Complete file retained with this request]";
  return { action: pending.label, createdAt: pending.createdAt, workspaceId: pending.workspaceId, requestId: pending.args.operationId, requestedRevision: pending.args.expectedRevision, fields: args };
}
function renderPending() {
  const host = $("pending-panel"), pending = state.pending;
  host.hidden = !pending; if (!pending) { host.replaceChildren(); return; }
  const differentWorkspace = state.view && pending.workspaceId !== state.view.workspaceId;
  const conflict = pending.status === "conflict";
  const rejected = pending.status === "rejected";
  let title = state.pendingBusy ? "Saving request" : conflict ? "Review the changed workspace" : rejected ? "This request needs a correction" : "A saved request needs recovery";
  let message = state.pendingBusy ? pending.label + " is being saved." : pending.message || "Recover the saved request to determine its outcome.";
  if (differentWorkspace) { title = "Saved request belongs to another workspace"; message = "Reconnect to the original workspace before recovering this request. Its original input remains saved in this browser."; }
  const controls = [];
  if (!differentWorkspace && !state.pendingBusy) {
    if (conflict) {
      controls.push(button("Review current workspace", () => { state.edition = ""; refresh().catch(error => notice(error.message, true)); }));
      controls.push(button("Apply to reviewed revision " + (state.view?.revision ?? ""), applyReviewedRequest, "primary", { disabled: !state.view }));
    } else if (!rejected) controls.push(button("Recover saved request", sendPending, "primary"));
    if (["prepared", "conflict", "rejected", "blocked"].includes(pending.status)) controls.push(button("Cancel this save", async () => {
      try { await clearPending(); notice("The unsaved request was cancelled. You can edit and submit the form again."); } catch (error) { notice(error.message, true); }
    }));
  }
  controls.push(button("Download saved request", () => downloadJSON(pending, "openlineage-saved-request-" + pending.args.operationId + ".json")));
  host.replaceChildren(h("h2", { id: "pending-title" }, title), h("p", {}, message),
    h("p", { className: "muted" }, pending.label + " · requested at revision " + pending.args.expectedRevision + " · " + when(pending.createdAt)),
    h("div", { className: "button-row" }, controls), jsonBlock("Saved request details", pendingSummary(pending)));
}
async function applyReviewedRequest() {
  const pending = state.pending;
  if (!pending || pending.status !== "conflict" || !state.view || pending.workspaceId !== state.view.workspaceId) return;
  const next = { ...pending, status: "prepared", message: "", createdAt: new Date().toISOString(),
    previousRequest: { operationId: pending.args.operationId, expectedRevision: pending.args.expectedRevision },
    uncertainOutcome: false, args: { ...pending.args, operationId: crypto.randomUUID(), expectedRevision: state.view.revision } };
  try { await retainPending(next); await sendPending(); } catch (error) { notice(error.message, true); }
}
async function sendPending() {
  const pending = state.pending;
  if (!pending || state.pendingBusy || !state.view || pending.workspaceId !== state.view.workspaceId) return null;
  state.pendingBusy = true; setBusyControls();
  let saved = null;
  const wasUncertain = pending.uncertainOutcome || ["uncertain", "submitting"].includes(pending.status);
  try {
    await retainPending({ ...pending, status: "submitting", message: "" });
    try {
      saved = await action(pending.action, pending.args);
      if (!saved || !Number.isSafeInteger(saved.revision)) throw new RequestError("The save response was incomplete.", 502);
    } catch (error) {
      const revisionConflict = error.status === 409 && Number.isSafeInteger(error.details?.currentRevision);
      const status = wasUncertain && !revisionConflict ? "uncertain" : revisionConflict ? "conflict" : [401, 409, 423, 429].includes(error.status) ? "blocked" : error.status >= 400 && error.status < 500 ? "rejected" : "uncertain";
      await retainPending({ ...pending, status, uncertainOutcome: status === "uncertain", message: error.message, responseStatus: error.status, currentRevision: error.details?.currentRevision });
      notice(status === "uncertain" ? "The save outcome is pending. Recover the saved request to continue." : error.message, true);
      if (revisionConflict) { state.edition = ""; await refresh().catch(() => {}); }
      return null;
    }
    await clearPending();
  } catch (error) { notice(error.message, true); return null; }
  finally { state.pendingBusy = false; renderPending(); setBusyControls(); }
  if (pending.action === "source.import") { state.edition = ""; state.section = "sources"; state.selection = saved.source ? { kind: "source", id: saved.source.id } : null; }
  if (pending.action === "edition.save" && saved.edition) { state.edition = saved.edition.id; state.section = "editions"; state.selection = { kind: "edition", id: saved.edition.id }; }
  document.querySelectorAll("dialog[open]").forEach(dialog => { if (dialog.id !== "connection-dialog") dialog.close(); });
  notice(pending.label + (saved.replayed ? " recovered at revision " : " saved at revision ") + saved.revision + ".");
  await refresh().catch(error => notice("Saved at revision " + saved.revision + ". " + error.message, true));
  return saved;
}
async function mutate(name, args, label) {
  if (state.pending || state.pendingBusy) { notice("Resolve the saved request before starting another save.", true); return null; }
  if (!state.view) throw new Error("Connect to the workspace first.");
  await retainPending({ action: name, args: { ...args, operationId: crypto.randomUUID(), expectedRevision: state.view.revision },
    label, workspaceId: state.view.workspaceId, createdAt: new Date().toISOString(), status: "prepared" });
  return sendPending();
}
async function refresh() {
  const version = ++state.viewVersion;
  $("catalog").setAttribute("aria-busy", "true");
  try {
    if (!state.identity) {
      state.identity = await jsonRequest("/api/identity");
      if (!state.identity?.workspaceId || !state.identity?.instanceId) throw new Error("The server identity is incomplete.");
    }
    const view = await jsonRequest("/api/workspace" + (state.edition ? "?edition=" + encodeURIComponent(state.edition) : ""));
    if (version !== state.viewVersion) return;
    if (view.workspaceId !== state.identity.workspaceId) throw new Error("The connected workspace changed. Open Connection to reconnect.");
    state.view = view; state.connected = true;
    renderShell(); renderCatalog();
    if (state.selection) await loadSelection(state.selection, true); else renderInspector();
    $("connection-state").textContent = "Connected · " + when(new Date().toISOString());
  } catch (error) {
    if (version !== state.viewVersion) return;
    state.connected = false; $("connection-state").textContent = "Connection needs attention";
    if (!state.view) { $("catalog").replaceChildren(empty("Workspace unavailable", error.message, button("Reconnect", () => openDialog("connection-dialog")))); }
    throw error;
  } finally { if (version === state.viewVersion) { $("catalog").setAttribute("aria-busy", "false"); setBusyControls(); renderPending(); } }
}
function fillEditions(select, selected, includeCurrent = true) {
  const values = includeCurrent ? [h("option", { value: "" }, "Current workspace")] : [h("option", { value: "" }, "Choose a saved edition")];
  for (const edition of state.view?.editions ?? []) values.push(h("option", { value: edition.id }, edition.title + " · r" + edition.sourceRevision));
  select.replaceChildren(...values); select.value = selected ?? "";
}
function renderShell() {
  const view = state.view;
  $("workspace-title").textContent = view.title || "Operations workspace";
  document.title = (view.title || "OpenLineage") + " · Operations workspace";
  $("revision-label").textContent = "Revision " + view.revision;
  fillEditions($("edition-picker"), state.edition);
  const cards = [
    ["Runs", count(view.runs.length), count(view.runs.filter(run => ["FAIL", "ABORT"].includes(run.state)).length) + " failed or aborted"],
    ["Jobs", count(view.jobs.length), count(view.edges.length) + " lineage connections"],
    ["Datasets", count(view.datasets.length), count(view.results.length) + " attached results"],
    ["Events", count(view.projectedCount) + " / " + count(view.eventCount), "projected / imported in this view"]
  ];
  $("workspace-summary").replaceChildren(...cards.map(([label, value, caption]) => h("div", { className: "summary-card" }, h("div", { className: "label" }, label), h("div", { className: "number" }, value), h("div", { className: "caption" }, caption))));
  document.querySelectorAll("[data-view]").forEach(node => { if (node.dataset.view === state.section) node.setAttribute("aria-current", "page"); else node.removeAttribute("aria-current"); });
  document.querySelectorAll("[data-count]").forEach(node => { node.textContent = count(view[node.dataset.count]?.length ?? 0); });
  $("view-title").textContent = LABELS[state.section]; $("view-description").textContent = DESCRIPTIONS[state.section];
  $("state-filter-label").hidden = state.section !== "runs";
  $("attention-filter-label").hidden = !KINDS[state.section];
  const selectedState = state.runState;
  $("state-filter").replaceChildren(h("option", { value: "" }, "All states"), ...[...new Set(view.runs.map(run => run.state))].sort().map(value => h("option", { value }, value)));
  $("state-filter").value = selectedState;
  $("workspace-footnote").textContent = editionName(state.edition) + " · revision " + view.revision + " · " + count(view.sources.length) + " retained sources";
  renderPending(); setBusyControls();
}
function isSelected(kind, id) { return state.selection?.kind === kind && state.selection.id === id; }
function matching(row) { return !state.search || JSON.stringify(row).toLowerCase().includes(state.search.toLowerCase()); }
function hasIssues(row) {
  if (row.issues?.length || row.diagnosticCount) return true;
  const ids = new Set(row.eventIds ?? []);
  return state.view.diagnostics.some(item => ids.has(item.eventId));
}
function selectEntityLink(key, label = null) {
  const kind = kindForKey(key);
  return button(label ?? entityName(key), () => { state.section = kind === "run" ? "runs" : kind === "job" ? "jobs" : "datasets"; state.search = ""; $("search-input").value = ""; renderShell(); renderCatalog(); loadSelection({ kind, id: key }).catch(error => notice(error.message, true)); }, "link-button");
}

function renderCatalog() {
  if (!state.view) return;
  const host = $("catalog"), view = state.view;
  let records = (view[state.section] ?? []).filter(matching);
  if (state.section === "runs" && state.runState) records = records.filter(row => row.state === state.runState);
  if (KINDS[state.section] && state.attention) records = records.filter(hasIssues);
  const rows = [];
  let headers = [];
  const choose = (kind, id) => () => loadSelection({ kind, id }).catch(error => notice(error.message, true));
  const selectedRow = (kind, id, cells) => h("tr", { className: isSelected(kind, id) ? "selected" : "" }, cells.map(cell => h("td", {}, cell)));
  const nameCell = (title, subtitle, kind, id) => h("div", { className: "cell-name" },
    button(title || "Untitled", choose(kind, id), "link-button primary-line", { "aria-label": "Inspect " + title }),
    subtitle ? h("span", { className: "secondary-line" }, subtitle) : null);
  if (state.section === "runs") {
    headers = ["Job / run", "State", "Last observed", "Events"];
    for (const run of records) rows.push(selectedRow("run", run.key, [
      nameCell(run.name, run.namespace + " · " + short(run.runId, 14), "run", run.key),
      h("div", {}, badge(run.state, run.issues.length > 0 || ["FAIL", "ABORT"].includes(run.state)), run.issues.length ? h("span", { className: "secondary-line" }, count(run.issues.length) + " issues") : null),
      h("span", { title: run.lastEventAt, className: "secondary-line" }, when(run.lastEventAt)), count(run.eventIds.length)
    ]));
  } else if (state.section === "jobs" || state.section === "datasets") {
    const kind = KINDS[state.section]; headers = ["Name", "Runs", "Events", "Updated"];
    for (const item of records) rows.push(selectedRow(kind, item.key, [
      nameCell(item.name, item.namespace, kind, item.key), count(item.runKeys?.length), count(item.eventIds.length), h("span", { className: "secondary-line", title: item.updatedAt }, when(item.updatedAt))
    ]));
  } else if (state.section === "sources") {
    headers = ["Original source", "Size", "Events", "Imported"];
    for (const item of records) rows.push(selectedRow("source", item.id, [
      nameCell(item.name, item.format + " · " + short(item.id), "source", item.id), bytes(item.bytes),
      h("div", {}, count(item.eventIds.length), item.diagnosticCount ? h("span", { className: "secondary-line" }, count(item.diagnosticCount) + " need attention") : null),
      h("span", { className: "secondary-line" }, when(item.importedAt))
    ]));
  } else if (state.section === "editions") {
    headers = ["Edition", "Revision", "Events", "Saved"];
    for (const item of records) rows.push(selectedRow("edition", item.id, [
      nameCell(item.title, item.description, "edition", item.id), "r" + item.sourceRevision, count(item.eventIds.length), h("span", { className: "secondary-line" }, when(item.createdAt))
    ]));
  } else if (state.section === "reviews") {
    headers = ["Review", "Decision", "Edition", "Updated"];
    for (const item of records) rows.push(selectedRow("review", item.id, [
      nameCell(item.title, item.entityKeys.map(entityName).join(", "), "review", item.id), badge(item.decision, item.decision === "needs-work"),
      editionName(item.editionId), h("span", { className: "secondary-line" }, when(item.updatedAt))
    ]));
  } else if (state.section === "results") {
    headers = ["Result", "Size", "Edition", "Attached"];
    for (const item of records) rows.push(selectedRow("result", item.id, [
      nameCell(item.name, item.entityKeys.map(entityName).join(", "), "result", item.id), bytes(item.bytes), editionName(item.editionId),
      h("span", { className: "secondary-line" }, when(item.attachedAt))
    ]));
  } else {
    headers = ["Event", "Details", "Original sources"];
    for (const item of records) {
      const sources = view.sources.filter(source => source.eventIds.includes(item.eventId));
      rows.push(selectedRow("diagnostic", item.eventId, [
        nameCell(short(item.eventId, 18), "Original event", "diagnostic", item.eventId),
        h("ul", { className: "detail-list" }, item.messages.map(message => h("li", {}, message))),
        h("div", { className: "source-links" }, sources.map(source => button(source.name, () => { state.section = "sources"; renderShell(); loadSelection({ kind: "source", id: source.id }).catch(error => notice(error.message, true)); }, "link-button")))
      ]));
    }
  }
  const main = rows.length ? table(headers, rows, LABELS[state.section]) : empty(
    state.search || state.runState || state.attention ? "No matching records" : "No " + LABELS[state.section].toLowerCase() + " yet",
    state.search || state.runState || state.attention ? "Change the search or filters to see more records." :
      state.section === "sources" || KINDS[state.section] ? "Import an original event file to begin exploring the workspace." :
      state.section === "editions" ? "Save the current workspace as a named edition, then compare it with later events." :
      state.section === "reviews" ? "Choose a run, job, or dataset and record a review with your decision and reason." :
      state.section === "results" ? "Choose an entity, save an edition, and attach its complete existing result." :
      "Imported events in this view have no projection diagnostics.",
    state.section === "sources" || KINDS[state.section] ? button("Import source", openImport, "", { "data-write": true }) : null);
  host.replaceChildren(...(state.section === "editions" ? [compareControls()] : []), main,
    h("div", { className: "table-footer" }, count(records.length) + " of " + count(view[state.section]?.length) + " records"));
  if (state.section === "editions" && state.comparison) host.append(renderComparison());
  setBusyControls();
}
function compareControls() {
  const from = h("select", { "aria-label": "Compare from edition" }), to = h("select", { "aria-label": "Compare to edition" });
  fillEditions(from, state.compareFrom || state.view.editions[0]?.id, false);
  fillEditions(to, state.compareTo, true);
  from.addEventListener("change", () => { state.compareFrom = from.value; });
  to.addEventListener("change", () => { state.compareTo = to.value; });
  const run = button("Compare", async () => {
    if (!from.value) { notice("Choose a saved edition to compare.", true); return; }
    state.compareFrom = from.value; state.compareTo = to.value; run.disabled = true;
    try { state.comparison = await action("edition.compare", { from: from.value, to: to.value || null }); renderCatalog(); }
    catch (error) { notice(error.message, true); } finally { run.disabled = false; }
  });
  return h("section", { className: "compare-form", "aria-label": "Compare saved editions" }, h("h3", {}, "Compare editions"),
    h("div", { className: "compare-selects" }, h("label", {}, "From", from), h("label", {}, "To", to), run));
}
function renderComparison() {
  const value = state.comparison;
  return h("section", { className: "comparison", "aria-label": "Edition comparison" },
    h("h3", {}, editionName(value.from) + " → " + editionName(value.to)),
    h("p", { className: "muted" }, count(value.changes.length) + " changed entities · " + count(value.addedEventIds.length) + " added events"),
    button("Download comparison", () => downloadJSON(value, "openlineage-edition-comparison.json"), "small"),
    value.changes.length ? value.changes.map(change => h("article", { className: "change-card" },
      h("div", { className: "change-title" }, badge(change.change), " ", entityName(change.key), " · ", change.kind),
      h("div", { className: "comparison-grid" }, jsonBlock("Before", change.before), jsonBlock("After", change.after))
    )) : h("p", {}, "The selected editions have matching entity details."),
    jsonBlock("Complete comparison", value));
}
async function loadSelection(selection, fromRefresh = false) {
  const version = ++state.detailVersion;
  state.selection = selection; state.detail = null; state.detailLoading = true; state.lineage = null; state.lineageLoading = false;
  if (!fromRefresh) state.detailTab = "overview";
  renderCatalog(); renderInspector();
  const edition = state.edition;
  try {
    let detail;
    if (["run", "job", "dataset"].includes(selection.kind)) detail = await action("entity.read", { key: selection.id, ...(edition ? { edition } : {}) });
    else {
      const section = { source: "sources", edition: "editions", review: "reviews", result: "results", diagnostic: "diagnostics" }[selection.kind];
      detail = state.view[section].find(item => (item.id ?? item.eventId) === selection.id);
      if (!detail) throw new Error("This record is not present in the selected view.");
    }
    if (version !== state.detailVersion || edition !== state.edition) return;
    state.detail = detail;
  } catch (error) {
    if (version === state.detailVersion) state.detail = { loadError: error.message };
  } finally {
    if (version === state.detailVersion) { state.detailLoading = false; renderInspector(); if (state.detailTab === "lineage" && state.detail?.key) loadLineage(); }
  }
}
function inspectorHeader(type, title, subtitle, tools = []) {
  return h("header", { className: "inspector-head" }, h("p", { className: "eyebrow" }, type),
    h("h2", { id: "selected-record-title", tabindex: "-1" }, title),
    h("p", { className: "namespace" }, subtitle), tools.length ? h("div", { className: "button-row" }, tools) : null);
}
function renderInspector() {
  const host = $("inspector"), selected = state.selection, detail = state.detail;
  if (!selected) { host.replaceChildren(empty("Inspect a record", "Choose an item to see its original events, facets, sources, reviews, and connected data.", null, true)); return; }
  if (state.detailLoading) { host.replaceChildren(h("div", { className: "loading", role: "status" }, "Loading selected record…")); return; }
  if (!detail || detail.loadError) { host.replaceChildren(empty("Record unavailable", detail?.loadError ?? "Choose a record to continue.", button("Try again", () => loadSelection(selected)), true)); return; }
  if (!["run", "job", "dataset"].includes(selected.kind)) { renderOtherInspector(); return; }
  const tools = [
    button("Record review", () => openReview(), "small", { "data-write": true }),
    button("Attach result", () => openResult(), "small", { "data-write": true })
  ];
  const tabs = [["overview", "Summary"], ["events", "Events & facets"], ["lineage", "Lineage"], ["reviews", "Reviews"], ["results", "Results"]];
  const tabNodes = tabs.map(([id, label]) => button(label, () => {
    state.detailTab = id; renderInspector(); if (id === "lineage") loadLineage();
  }, "", { role: "tab", "aria-selected": state.detailTab === id ? "true" : "false", "aria-controls": "detail-content", id: "tab-" + id, tabindex: state.detailTab === id ? "0" : "-1" }));
  const tablist = h("div", { className: "inspector-tabs", role: "tablist", "aria-label": "Record detail views" }, tabNodes);
  tablist.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.findIndex(([id]) => id === state.detailTab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    state.detailTab = tabs[next][0]; renderInspector(); $("tab-" + state.detailTab).focus(); if (state.detailTab === "lineage") loadLineage();
  });
  let content;
  if (state.detailTab === "overview") content = renderEntitySummary(detail);
  else if (state.detailTab === "events") content = renderEntityEvents(detail);
  else if (state.detailTab === "reviews") content = renderReviews(detail.reviews ?? []);
  else if (state.detailTab === "results") content = renderResults(detail.results ?? []);
  else content = renderLineage();
  host.replaceChildren(inspectorHeader(selected.kind, detail.name, detail.namespace, tools), tablist,
    h("div", { className: "inspector-body", id: "detail-content", role: "tabpanel", "aria-labelledby": "tab-" + state.detailTab }, content));
  setBusyControls();
}
function entityLinks(values) {
  if (!values?.length) return h("p", { className: "muted" }, "None recorded.");
  return h("ul", { className: "detail-list" }, values.map(item => h("li", {}, selectEntityLink(typeof item === "string" ? item : item.key))));
}
function renderEntitySummary(item) {
  const fields = [["Namespace", item.namespace], ["Name", item.name]];
  if (item.runId) fields.push(["Run ID", h("span", { className: "mono" }, item.runId)], ["State", badge(item.state)], ["Started", when(item.startedAt)], ["Ended", when(item.endedAt)], ["Duration", elapsed(item.durationMs)]);
  else fields.push(["Updated", when(item.updatedAt)], ["Observed runs", count(item.runKeys?.length)]);
  fields.push(["Original events", count(item.eventIds.length)], ["Reviews", count(item.reviews?.length)], ["Results", count(item.results?.length)]);
  const sections = [h("section", { className: "section-block" }, recordFields(fields))];
  if (item.issues?.length) sections.push(h("section", { className: "section-block" }, h("h3", {}, "Recorded issues"), h("ul", { className: "issue-list" }, item.issues.map(issue => h("li", {}, issue.message)))));
  if (item.jobKey) sections.push(h("section", { className: "section-block" }, h("h3", {}, "Job"), selectEntityLink(item.jobKey)));
  if (item.inputs || item.outputs) sections.push(h("section", { className: "section-block" }, h("h3", {}, "Inputs"), entityLinks(item.inputs), h("h3", {}, "Outputs"), entityLinks(item.outputs)));
  if (item.runKeys) sections.push(h("section", { className: "section-block" }, h("h3", {}, "Connected runs"), entityLinks(item.runKeys)));
  if (item.transitions?.length) sections.push(h("section", { className: "section-block" }, h("h3", {}, "Lifecycle"),
    table(["State", "Observed"], item.transitions.map(value => h("tr", {}, h("td", {}, badge(value.state)), h("td", { title: value.eventTime }, when(value.eventTime)))), "Run lifecycle observations")));
  sections.push(jsonBlock("Complete entity record", item));
  return sections;
}
function renderEntityEvents(item) {
  const sections = [h("section", { className: "section-block" }, h("h3", {}, "Current entity facets"),
    Object.keys(item.facets ?? {}).length ? Object.entries(item.facets).map(([key, value]) => jsonBlock(key, value)) : h("p", { className: "muted" }, "No entity facets are recorded."))];
  if (item.jobFacets && Object.keys(item.jobFacets).length) sections.push(h("section", { className: "section-block" }, h("h3", {}, "Job facets"), Object.entries(item.jobFacets).map(([key, value]) => jsonBlock(key, value))));
  sections.push(h("h3", {}, "Original events · " + count(item.events?.length)));
  for (const row of item.events ?? []) {
    const sourceLinks = (row.sources ?? []).map(reference => {
      const source = state.view.sources.find(value => value.id === reference.sourceId);
      const location = reference.line ? "line " + reference.line : "item " + ((reference.index ?? 0) + 1);
      return h("div", {}, button((source?.name ?? short(reference.sourceId)) + " · " + location, () => {
        state.section = "sources"; renderShell(); loadSelection({ kind: "source", id: reference.sourceId });
      }, "link-button"), " ", button("Download", () => downloadObject(reference.sourceId, source?.name ?? reference.sourceId), "small"));
    });
    sections.push(h("article", { className: "event-card" },
      h("header", { className: "event-meta" }, badge(row.event.eventType ?? row.kind), h("p", {}, when(row.event.eventTime)),
        h("p", { className: "mono" }, row.id),
        h("div", { className: "event-tools" }, button("Download event JSON", () => downloadJSON(row.event, "openlineage-event-" + row.id + ".json"), "small"))),
      h("div", { className: "event-content" }, h("div", { className: "source-links" }, sourceLinks),
        row.diagnostics?.length ? h("ul", { className: "issue-list" }, row.diagnostics.map(message => h("li", {}, message))) : null,
        jsonBlock("Complete original event and facets", row.event), jsonBlock("Source positions and event metadata", { ...row, event: undefined }))));
  }
  return sections;
}
function renderReviews(values) {
  const rows = values.map(review => h("article", { className: "item-card" },
    h("h3", {}, review.title), badge(review.decision, review.decision === "needs-work"),
    h("p", {}, review.reason), h("p", { className: "card-meta" }, editionName(review.editionId) + " · " + when(review.updatedAt)),
    h("div", { className: "button-row" }, button("Edit review", () => openReview(review), "small", { "data-write": true })),
    review.history?.length ? jsonBlock("Previous decisions", review.history) : null, jsonBlock("Complete review", review)));
  return rows.length ? rows : empty("No reviews recorded", "Record a named review with a decision and reason for this entity.", button("Record review", () => openReview(), "", { "data-write": true }), true);
}
function renderResults(values) {
  const rows = values.map(result => h("article", { className: "item-card" },
    h("h3", {}, result.name), h("p", { className: "card-meta" }, bytes(result.bytes) + " · " + result.mediaType),
    h("p", {}, "Edition: " + editionName(result.editionId)), h("p", {}, "Original source: ", safeLink(result.sourceReference)),
    h("p", { className: "card-meta" }, when(result.attachedAt)),
    h("div", { className: "button-row" }, button("Download complete result", () => downloadObject(result.objectId, result.name), "small")),
    result.query !== null && result.query !== undefined ? jsonBlock("Query or experiment details", result.query) : null,
    jsonBlock("Complete result record", result)));
  return rows.length ? rows : empty("No result attached", "Attach a complete existing file to this entity and a saved edition.", button("Attach result", openResult, "", { "data-write": true }), true);
}
async function loadLineage() {
  const selected = state.selection;
  if (!selected || !state.detail?.key || state.lineageLoading) return;
  const version = state.detailVersion, edition = state.edition;
  state.lineageLoading = true; state.lineage = null; renderInspector();
  try {
    const value = await action("lineage.read", { key: selected.id, ...(edition ? { edition } : {}), direction: state.lineageDirection, maxDepth: state.lineageDepth });
    if (version === state.detailVersion && edition === state.edition) state.lineage = value;
  } catch (error) { if (version === state.detailVersion) state.lineage = { error: error.message }; }
  finally { if (version === state.detailVersion) { state.lineageLoading = false; if (state.detailTab === "lineage") renderInspector(); } }
}
function renderLineage() {
  const direction = h("select", { value: state.lineageDirection }, ["both", "upstream", "downstream"].map(value => h("option", { value }, value[0].toUpperCase() + value.slice(1))));
  const depth = h("input", { type: "number", min: "0", max: "64", value: state.lineageDepth, "aria-label": "Lineage depth" });
  const update = button("Update", () => {
    const value = Number(depth.value);
    if (!Number.isInteger(value) || value < 0 || value > 64) { notice("Lineage depth must be a whole number from 0 to 64.", true); return; }
    state.lineageDirection = direction.value; state.lineageDepth = value; loadLineage();
  }, "", { disabled: state.lineageLoading });
  const controls = h("div", { className: "lineage-controls" }, h("label", {}, "Direction", direction), h("label", {}, "Depth", depth), update);
  const value = state.lineage;
  if (state.lineageLoading) return [controls, h("p", { role: "status", className: "muted" }, "Reading lineage…")];
  if (!value) return [controls, h("p", { className: "muted" }, "Choose Update to read lineage for this record.")];
  if (value.error) return [controls, h("p", { role: "alert" }, value.error)];
  const nodeMap = new Map(value.nodes.map(node => [node.key, node]));
  function edgeLink(key) {
    const node = nodeMap.get(key);
    return node?.referencedOnly ? h("span", { title: key }, entityName(key) + " (reference only)") : selectEntityLink(key);
  }
  return [controls, h("p", { className: "muted" }, count(value.nodes.length) + " nodes · " + count(value.edges.length) + " connections"),
    h("h3", {}, "Connections"), value.edges.length ? table(["From", "To", "Relationship"], value.edges.map(edge => h("tr", {},
      h("td", {}, edgeLink(edge.from)), h("td", {}, edgeLink(edge.to)), h("td", {}, badge(edge.kind), edge.declared ? h("span", { className: "secondary-line" }, "Declared") : null)
    )), "Lineage connections") : h("p", {}, "No connections within the selected direction and depth."),
    h("h3", { className: "facet-heading" }, "Nodes"), table(["Entity", "Type"], value.nodes.map(node => h("tr", {},
      h("td", {}, edgeLink(node.key)), h("td", {}, kindForKey(node.key), node.referencedOnly ? " · reference only" : "")
    )), "Lineage nodes"),
    h("div", { className: "event-tools" }, button("Download lineage", () => downloadJSON(value, "openlineage-connections.json"), "small")),
    jsonBlock("Complete nodes, edges, and provenance", value)];
}

function renderOtherInspector() {
  const host = $("inspector"), item = state.detail, kind = state.selection.kind;
  const children = [];
  if (kind === "source") {
    children.push(inspectorHeader("Original source", item.name, item.sourceUrl || item.id), recordFields([
      ["Source ID", item.id], ["Format", item.format], ["Size", bytes(item.bytes)], ["Imported", when(item.importedAt)],
      ["Events", count(item.eventIds?.length)], ["Attention", count(item.diagnosticCount)],
      ["Original reference", item.sourceUrl ? safeLink(item.sourceUrl) : "—"]
    ]));
    const originalHost = h("div", { className: "original-content" });
    const readOriginal = button("Read complete original", async () => {
      readOriginal.disabled = true; originalHost.replaceChildren(h("p", { className: "muted", role: "status" }, "Opening original source…"));
      const version = state.detailVersion;
      try {
        const value = await action("source.read", { id: item.id });
        if (version !== state.detailVersion) return;
        const data = base64ToBytes(value.base64);
        originalHost.replaceChildren(h("details", { className: "json-block", open: true },
          h("summary", {}, item.name + " · " + bytes(data.byteLength)),
          h("pre", { className: "source-text", tabIndex: "0" }, new TextDecoder().decode(data))));
      } catch (error) { originalHost.replaceChildren(h("p", { role: "alert" }, error.message)); }
      finally { readOriginal.disabled = false; }
    }, "small");
    children.push(h("div", { className: "event-tools" }, readOriginal,
      button("Download original file", () => downloadObject(item.id, item.name), "small")), originalHost,
      jsonBlock("Complete source record", item), jsonBlock("Imported event identifiers", item.eventIds ?? []));
  } else if (kind === "edition") {
    children.push(inspectorHeader("Saved edition", item.title, "Revision " + item.sourceRevision), h("p", { className: "record-description" }, item.description || "No description recorded."),
      recordFields([["Edition ID", item.id], ["Saved", when(item.createdAt)], ["Source revision", item.sourceRevision],
        ["Events", count(item.eventIds?.length)], ["Sources", count(item.sourceIds?.length)]]),
      h("div", { className: "event-tools" },
        button("Open this edition", async () => { state.edition = item.id; state.comparison = null; await refresh().catch(error => notice(error.message, true)); }, "primary small"),
        button("Compare with current", async () => {
          state.compareFrom = item.id; state.compareTo = ""; state.section = "editions";
          try { state.comparison = await action("edition.compare", { from: item.id, to: null }); renderShell(); renderCatalog(); $("catalog").focus(); }
          catch (error) { notice(error.message, true); }
        }, "small")),
      jsonBlock("Complete edition record", item));
  } else if (kind === "review") {
    children.push(inspectorHeader("Review", item.title, editionName(item.editionId)), h("h3", {}, "Linked entities"), entityLinks(item.entityKeys ?? []), ...renderReviews([item]));
  } else if (kind === "result") {
    children.push(inspectorHeader("Attached result", item.name, editionName(item.editionId)), h("h3", {}, "Linked entities"), entityLinks(item.entityKeys ?? []), ...renderResults([item]));
  } else {
    children.push(inspectorHeader("Source diagnostic", "Event requiring attention", item.eventId || ""),
      h("p", { className: "record-description" }, item.message ?? item.reason ?? "Open the original source to inspect this event."),
      recordFields([["Event ID", item.eventId], ["Source ID", item.sourceId], ["Source line", item.line], ["Source index", item.index]]));
    const source = state.view.sources.find(value => value.id === item.sourceId);
    if (source) children.push(h("div", { className: "event-tools" },
      button("Inspect original source", () => loadSelection({ kind: "source", id: source.id }), "small"),
      button("Download original file", () => downloadObject(source.id, source.name), "small")));
    children.push(jsonBlock("Complete diagnostic record", item, true));
  }
  host.replaceChildren(...children); setBusyControls();
}
function canOpenWrite() {
  if (!state.view) { notice("Connect to the workspace first.", true); return false; }
  if (state.pending || state.pendingBusy || state.importBusy) { notice("Resolve the saved request before starting another save.", true); $("pending-panel").scrollIntoView({ block: "nearest" }); return false; }
  return true;
}
function openImport() {
  if (!canOpenWrite()) return;
  feedback("import-feedback", ""); openDialog("import-dialog");
}
function openEdition() {
  if (!canOpenWrite()) return;
  $("edition-context").textContent = "Saving all events and sources in the current workspace at revision " + state.view.revision + ".";
  feedback("edition-feedback", ""); openDialog("edition-dialog");
}
function openReview(existing = null) {
  if (!canOpenWrite()) return;
  const entityKeys = existing?.entityKeys ?? (state.detail?.key ? [state.detail.key] : []);
  if (!entityKeys.length) { notice("Select a run, job, or dataset to review.", true); return; }
  state.reviewDraft = { ...(existing?.id ? { id: existing.id } : {}), entityKeys: [...entityKeys], editionId: existing ? existing.editionId ?? null : state.edition || null };
  $("review-name").value = existing?.title ?? "";
  $("review-decision").value = existing?.decision ?? "observed";
  $("review-reason").value = existing?.reason ?? "";
  $("review-context").textContent = entityKeys.map(entityName).join("; ") + " · " + editionName(state.reviewDraft.editionId);
  $("review-title").textContent = existing ? "Update a review" : "Record a review";
  feedback("review-feedback", ""); openDialog("review-dialog");
}
function openResult() {
  if (!canOpenWrite()) return;
  if (!state.detail?.key) { notice("Select a run, job, or dataset for this result.", true); return; }
  if (!state.view.editions.length) {
    notice("Save an edition first so the result remains linked to its event selection."); openEdition(); return;
  }
  state.resultEntity = state.detail.key;
  $("result-context").textContent = entityName(state.resultEntity);
  fillEditions($("result-edition"), state.edition || state.view.editions.at(-1)?.id, false);
  feedback("result-feedback", ""); openDialog("result-dialog");
}
function openConnection() {
  $("access-token").value = accessToken;
  $("connection-description").textContent = state.pending
    ? "Reconnect to the same workspace. Your saved request will remain available for explicit recovery."
    : "Use the access token configured for this workspace, or leave it empty when no token is required.";
  openDialog("connection-dialog");
}
function showExport() {
  if (!state.view) { notice("Connect to the workspace first.", true); return; }
  $("report-context").textContent = editionName(state.edition) + " · revision " + state.view.revision + " · " + count(state.view.runs.length) + " runs.";
  feedback("export-feedback", ""); openDialog("export-dialog");
}
function formFailure(id, error) { feedback(id, error.message); }
function pendingFormFeedback(id, saved) {
  if (!saved && state.pending) feedback(id, state.pending.message || "Your complete request is saved. Use the recovery panel to continue.");
}
async function importSource(event) {
  event.preventDefault();
  if (!canOpenWrite()) return;
  const file = $("source-file").files[0], pasted = $("source-text").value;
  if (file && pasted.trim()) { feedback("import-feedback", "Choose one source: clear the pasted text or remove the selected file."); return; }
  if (!file && !pasted.trim()) { feedback("import-feedback", "Choose a source file or paste JSON or NDJSON events."); return; }
  state.importBusy = true; setBusyControls(); feedback("import-feedback", "Reading complete source…");
  try {
    const original = file ? await file.arrayBuffer() : new TextEncoder().encode(pasted).buffer;
    const args = { name: $("source-name").value.trim() || file?.name || "pasted-events.ndjson", base64: toBase64(original) };
    const reference = $("source-url").value.trim(); if (reference) args.sourceUrl = reference;
    feedback("import-feedback", "Saving original source…");
    const saved = await mutate("source.import", args, "Source import");
    if (saved) { $("import-form").reset(); feedback("import-feedback", ""); }
    else pendingFormFeedback("import-feedback", saved);
  } catch (error) { formFailure("import-feedback", error); }
  finally { state.importBusy = false; setBusyControls(); }
}
async function saveEdition(event) {
  event.preventDefault();
  if (!canOpenWrite()) return;
  try {
    feedback("edition-feedback", "Saving edition…");
    const saved = await mutate("edition.save", { title: $("edition-name").value.trim(), description: $("edition-description").value.trim() }, "Edition");
    if (saved) $("edition-form").reset(); else pendingFormFeedback("edition-feedback", saved);
  } catch (error) { formFailure("edition-feedback", error); }
}
async function saveReview(event) {
  event.preventDefault();
  if (!canOpenWrite() || !state.reviewDraft) return;
  try {
    feedback("review-feedback", "Saving review…");
    const saved = await mutate("review.save", { ...state.reviewDraft, title: $("review-name").value.trim(), reason: $("review-reason").value.trim(), decision: $("review-decision").value }, "Review");
    if (saved) $("review-form").reset(); else pendingFormFeedback("review-feedback", saved);
  } catch (error) { formFailure("review-feedback", error); }
}
async function attachResult(event) {
  event.preventDefault();
  if (!canOpenWrite() || !state.resultEntity) return;
  const file = $("result-file").files[0], editionId = $("result-edition").value;
  if (!file || !editionId) { feedback("result-feedback", "Choose a complete result file and a saved edition."); return; }
  state.importBusy = true; setBusyControls(); feedback("result-feedback", "Reading complete result…");
  try {
    const original = await file.arrayBuffer();
    const args = { name: $("result-name").value.trim() || file.name, base64: toBase64(original),
      mediaType: file.type || "application/octet-stream", entityKeys: [state.resultEntity], editionId,
      sourceReference: $("result-reference").value.trim() };
    const query = $("result-query").value.trim(); if (query) args.query = query;
    feedback("result-feedback", "Saving complete result…");
    const saved = await mutate("result.attach", args, "Result attachment");
    if (saved) $("result-form").reset(); else pendingFormFeedback("result-feedback", saved);
  } catch (error) { formFailure("result-feedback", error); }
  finally { state.importBusy = false; setBusyControls(); }
}
async function exportWorkspace() {
  const control = $("download-workspace"); control.disabled = true;
  feedback("export-feedback", "Preparing complete workspace and application…");
  try {
    const value = await action("workspace.export", { includeApplication: true });
    if (!value?.id || !value.name) throw new Error("The export response was incomplete.");
    const result = await response("/api/exports/" + encodeURIComponent(value.id));
    downloaded(await result.blob(), value.name);
    feedback("export-feedback", "Complete workspace download prepared: " + bytes(value.bytes) + " · revision " + value.revision + ".");
    $("reopen-help").hidden = false; $("reopen-help").open = true;
  } catch (error) { formFailure("export-feedback", error); }
  finally { control.disabled = false; }
}
async function exportReport() {
  const control = $("download-report"); control.disabled = true;
  feedback("export-feedback", "Preparing view report…");
  try {
    const format = $("report-format").value;
    const value = await action("report.read", { edition: state.edition || null, format });
    if (typeof value.text !== "string") throw new Error("The report response was incomplete.");
    downloaded(new Blob([value.text], { type: value.mediaType || "text/plain" }), "openlineage-report-r" + state.view.revision + "." + format);
    feedback("export-feedback", editionName(state.edition) + " report download prepared.");
  } catch (error) { formFailure("export-feedback", error); }
  finally { control.disabled = false; }
}
document.querySelectorAll("[data-close]").forEach(control => control.addEventListener("click", () => closeDialog(control.dataset.close)));
$("import-button").addEventListener("click", openImport);
$("save-edition-button").addEventListener("click", openEdition);
$("export-button").addEventListener("click", showExport);
$("connection-button").addEventListener("click", openConnection);
$("refresh-button").addEventListener("click", () => refresh().catch(error => notice(error.message, true)));
$("import-form").addEventListener("submit", importSource);
$("edition-form").addEventListener("submit", saveEdition);
$("review-form").addEventListener("submit", saveReview);
$("result-form").addEventListener("submit", attachResult);
$("download-workspace").addEventListener("click", exportWorkspace);
$("download-report").addEventListener("click", exportReport);
$("source-file").addEventListener("change", () => { const file = $("source-file").files[0]; if (file && !$("source-name").value.trim()) $("source-name").value = file.name; });
$("result-file").addEventListener("change", () => { const file = $("result-file").files[0]; if (file) $("result-name").value = file.name; });
$("connection-form").addEventListener("submit", async event => {
  event.preventDefault();
  accessToken = $("access-token").value.trim();
  try { if (accessToken) sessionStorage.setItem(TOKEN_KEY, accessToken); else sessionStorage.removeItem(TOKEN_KEY); }
  catch { notice("The token is available for this page. Browser session storage could not retain it.", true); }
  state.identity = null;
  try { await refresh(); closeDialog("connection-dialog"); notice(state.pending ? "Connected. Recover the saved request to continue." : "Connected to " + state.view.title + "."); }
  catch (error) { $("connection-description").textContent = error.message; }
});
$("edition-picker").addEventListener("change", async () => {
  state.edition = $("edition-picker").value; state.selection = null; state.detail = null; state.comparison = null;
  await refresh().catch(error => notice(error.message, true));
});
document.querySelectorAll("[data-view]").forEach(control => control.addEventListener("click", () => {
  if (!state.view) return;
  state.section = control.dataset.view; state.selection = null; state.detail = null; state.detailVersion++;
  renderShell(); renderCatalog(); renderInspector();
}));
$("search-input").addEventListener("input", () => { state.search = $("search-input").value; renderCatalog(); });
$("state-filter").addEventListener("change", () => { state.runState = $("state-filter").value; renderCatalog(); });
$("attention-filter").addEventListener("change", () => { state.attention = $("attention-filter").checked; renderCatalog(); });
async function start() {
  try {
    const saved = await journal("read");
    if (saved) state.pending = { ...saved, status: saved.status === "submitting" ? "uncertain" : saved.status,
      message: saved.status === "submitting" ? "The page closed while saving. Recover this same request to determine its outcome." : saved.message };
  } catch (error) { notice(error.message + " Reading and exports remain available.", true); }
  renderPending(); setBusyControls();
  try { await refresh(); }
  catch (error) { notice(error.message, true); }
}
start();
