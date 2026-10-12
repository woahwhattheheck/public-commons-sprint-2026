// MIT. Kafka browser workspace; native capture and original dataset engine remain the source of record.
const sectionHash = location.hash && !/^[A-Za-z0-9_-]{43}$/.test(location.hash.slice(1)) ? location.hash : "";
if (sectionHash) history.replaceState(null, "", location.pathname + location.search);
const { api, work, refresh, notify, download, consoleReady, renderMapping } = await import("/ndjson-app.js");
await consoleReady;

const $ = id => document.getElementById(id);
const PAGE = 50;
const RUNNING = new Set(["RUNNING", "CANCELLING"]);
const RESUMABLE = new Set(["PREPARED", "CANCELLED", "INTERRUPTED", "ERROR"]);
const fmt = value => new Intl.NumberFormat().format(value ?? 0);
const short = value => String(value ?? "").slice(0, 12);
const stringify = value => JSON.stringify(value, null, 2);
const text = value => value === null ? "null" : typeof value === "object" ? stringify(value) : String(value ?? "");
let state = null, kafka = null, selectedConnection = null, selectedInspection = null;
let selectedCapture = null, selectedProjection = null, selectedMessage = null;
let editingConnection = null, editingRevision = 0, messageOffset = 0, messageTotal = 0;
let generation = 0, timer = null, polling = false, closed = false;
const pendingOperations = new Map();

function el(tag, content, attributes = {}) {
  const item = document.createElement(tag);
  if (content !== undefined) item.textContent = content;
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "class") item.className = value;
    else if (key === "value" || key === "checked" || key === "disabled") item[key] = value;
    else item.setAttribute(key, value);
  }
  return item;
}
function details(id, rows) {
  const list = el("dl");
  for (const [name, value] of rows) list.append(el("dt", name), el("dd", text(value)));
  $(id).replaceChildren(list); $(id).classList.remove("empty");
}
function table(id, headers, rows, empty = "No retained records.") {
  const target = $(id); target.replaceChildren();
  if (!rows.length) { target.append(el("p", empty, { class: "hint" })); return; }
  const result = el("table"), head = el("tr"), body = el("tbody");
  for (const header of headers) head.append(el("th", header));
  const thead = el("thead"); thead.append(head); result.append(thead);
  for (const cells of rows) {
    const row = el("tr");
    for (const value of cells) row.append(el("td", text(value)));
    body.append(row);
  }
  result.append(body); target.append(result);
}
function options(id, rows, label, chosen) {
  const target = $(id), previous = chosen ?? target.value;
  target.replaceChildren(...rows.map(row => el("option", label(row), { value: row.id })));
  if (rows.some(row => row.id === previous)) target.value = previous;
  if (!rows.length) target.append(el("option", "No retained selection", { value: "" }));
}
function required(id, label) {
  const value = $(id).value;
  if (!value) throw new Error("Choose " + label + " first.");
  return value;
}
function integer(id, minimum, maximum) {
  const raw = $(id).value;
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new Error("Enter an integer for " + $(id).closest("label").textContent.trim() + ".");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("The selected limit is outside its permitted range.");
  return value;
}
function offset(raw) {
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || BigInt(raw) > 9223372036854775807n) throw new Error("Use an exact nonnegative 64-bit decimal offset.");
  return raw;
}
function invoke(id, event, message, action) {
  $(id).addEventListener(event, eventObject => {
    if (event === "submit") eventObject.preventDefault();
    act(message, () => action(eventObject));
  });
}
function act(message, action) {
  if (document.body.dataset.busy === "true") return;
  generation += 1; clearTimeout(timer);
  return work(message, async () => {
    try { await action(); } finally { schedulePoll(); }
  });
}
async function operation(kind, route, arguments_) {
  const key = "sf30-kafka-operation:" + kafka.workspaceId + ":" + kind;
  const signature = JSON.stringify(arguments_);
  let prior = pendingOperations.get(key);
  if (!prior) {
    try { prior = JSON.parse(sessionStorage.getItem(key) || "null"); } catch {}
  }
  if (!prior || prior.signature !== signature || typeof prior.operation !== "string") {
    prior = { signature, operation: "kafka-" + kind + "-" + crypto.randomUUID() };
    pendingOperations.set(key, prior);
    try { sessionStorage.setItem(key, JSON.stringify(prior)); } catch {}
  }
  const result = await api(route, { body: { ...arguments_, operation: prior.operation } });
  pendingOperations.delete(key);
  try { sessionStorage.removeItem(key); } catch {}
  return result;
}
function sourceExists(value) { return Array.isArray(value) && value.every(item => item && typeof item.id === "string"); }
function validateState(value) {
  if (!value || !value.kafka || value.kafka.schema !== "stellar-forge.kafka-state.v1" ||
      !sourceExists(value.kafka.connections) || !sourceExists(value.kafka.inspections) ||
      !sourceExists(value.kafka.captures) || !sourceExists(value.kafka.projections)) {
    throw new Error("The running console did not return its retained Kafka workspace.");
  }
  return value;
}
function syncControls() {
  const sasl = $("kafka-protocol").value.startsWith("SASL_");
  const tls = $("kafka-protocol").value.endsWith("SSL");
  $("kafka-sasl-fields").hidden = !sasl;
  $("kafka-sasl-fields").disabled = !sasl;
  for (const id of ["kafka-username-env", "kafka-password-env"]) $(id).required = sasl;
  $("kafka-tls-fields").hidden = !tls;
  for (const input of $("kafka-tls-fields").querySelectorAll("input")) input.disabled = !tls;
}
function connectionConfig() {
  const security = { protocol: $("kafka-protocol").value };
  if (security.protocol.startsWith("SASL_")) {
    security.mechanism = $("kafka-mechanism").value;
    security.usernameEnv = $("kafka-username-env").value.trim();
    security.passwordEnv = $("kafka-password-env").value.trim();
  }
  if (security.protocol.endsWith("SSL")) {
    for (const [name, id] of [["caFileEnv", "kafka-ca-env"], ["certificateFileEnv", "kafka-certificate-env"],
      ["keyFileEnv", "kafka-key-env"], ["keyPasswordEnv", "kafka-key-password-env"]]) {
      if ($(id).value.trim()) security[name] = $(id).value.trim();
    }
  }
  return {
    schema: "stellar-forge.kafka-connection.v1", label: $("kafka-connection-label").value.trim(),
    brokers: $("kafka-brokers").value.split(/[\n,]+/).map(value => value.trim()).filter(Boolean),
    topic: $("kafka-topic").value.trim(), security,
    requestTimeoutSeconds: integer("kafka-timeout", 1, 120), maxMessageBytes: integer("kafka-max-message", 1, 16777216),
    maxCaptureBytes: integer("kafka-max-bytes", 1, 268435456), maxCaptureRecords: integer("kafka-max-records", 1, 1000000),
  };
}
function loadConnectionEditor(record) {
  const config = record.config, security = config.security;
  editingConnection = record.id; editingRevision = record.revision;
  for (const [id, value] of [
    ["kafka-connection-id", record.id], ["kafka-connection-label", config.label], ["kafka-brokers", config.brokers.join("\n")],
    ["kafka-topic", config.topic], ["kafka-protocol", security.protocol], ["kafka-mechanism", security.mechanism ?? "SCRAM-SHA-512"],
    ["kafka-username-env", security.usernameEnv ?? ""], ["kafka-password-env", security.passwordEnv ?? ""],
    ["kafka-ca-env", security.caFileEnv ?? ""], ["kafka-certificate-env", security.certificateFileEnv ?? ""],
    ["kafka-key-env", security.keyFileEnv ?? ""], ["kafka-key-password-env", security.keyPasswordEnv ?? ""],
    ["kafka-timeout", config.requestTimeoutSeconds], ["kafka-max-message", config.maxMessageBytes],
    ["kafka-max-bytes", config.maxCaptureBytes], ["kafka-max-records", config.maxCaptureRecords],
  ]) $(id).value = value;
  $("kafka-connection-edit-state").textContent = "Editing retained revision " + record.revision + ". Saving creates revision " + (record.revision + 1) + ".";
  syncControls();
}
async function loadConnection() {
  const id = $("kafka-connection-select").value;
  selectedConnection = id ? await api("/api/kafka/connection?id=" + encodeURIComponent(id)) : null;
  if (!selectedConnection) {
    $("kafka-connection-detail").textContent = "Save a connection to review its configuration.";
    $("kafka-revisions").replaceChildren(); $("kafka-inspect").disabled = true; $("kafka-load-connection").disabled = true; return;
  }
  const record = selectedConnection, config = record.config;
  details("kafka-connection-detail", [
    ["Name", config.label], ["Connection", record.id], ["Revision", record.revision], ["Saved", record.createdAt],
    ["Topic", config.topic], ["Brokers", config.brokers.join("\n")], ["Security", config.security.protocol],
    ["Configuration SHA-256", record.sha256],
  ]);
  table("kafka-revisions", ["Revision", "Saved", "Configuration"], (record.revisions ?? [record]).map(item => [item.revision, item.createdAt, item.sha256]));
  $("kafka-inspect").disabled = !kafka.client.available;
  $("kafka-load-connection").disabled = false;
}
async function loadInspection() {
  const id = $("kafka-inspection-select").value;
  selectedInspection = id ? await api("/api/kafka/inspection?id=" + encodeURIComponent(id)) : null;
  $("kafka-range-body").replaceChildren();
  if (!selectedInspection) { $("kafka-inspection-detail").textContent = "Inspect a saved connection to obtain exact source offsets."; return; }
  const inspection = selectedInspection;
  details("kafka-inspection-detail", [
    ["Topic", inspection.topic], ["Connection revision", inspection.connection + " / " + inspection.connectionRevision],
    ["Observed", inspection.observedAt], ["Cluster ID", inspection.clusterId], ["Topic UUID", inspection.topicId],
  ]);
  for (const range of inspection.partitions) {
    const row = el("tr", undefined, { "data-partition": range.partition });
    const choose = el("input", undefined, { type: "checkbox", checked: true, class: "range-choice", "aria-label": "Include partition " + range.partition });
    const choiceCell = el("td"); choiceCell.append(choose); row.append(choiceCell);
    for (const value of [range.partition, range.low, range.high, range.end]) row.append(el("td", value));
    for (const [name, value] of [["start", range.low], ["end", range.end]]) {
      const cell = el("td"), input = el("input", undefined, { type: "text", value, inputmode: "numeric", pattern: "0|[1-9][0-9]*",
        required: "", class: "range-input", "data-bound": name, "aria-label": name + " offset, partition " + range.partition });
      input.spellcheck = false; cell.append(input); row.append(cell);
    }
    choose.addEventListener("change", () => { for (const input of row.querySelectorAll(".range-input")) input.disabled = !choose.checked; });
    $("kafka-range-body").append(row);
  }
}
function captureLabel(value) { return value.topic + " · " + value.status + " · " + fmt(value.records) + " records · " + short(value.id); }
function updateCapture(value) {
  const index = kafka.captures.findIndex(item => item.id === value.id);
  if (index < 0) kafka.captures.unshift(value);
  else if (value.revision >= kafka.captures[index].revision) kafka.captures[index] = value;
  if (RUNNING.has(value.status)) kafka.activeCapture = value.id;
  else if ((typeof kafka.activeCapture === "object" ? kafka.activeCapture?.id : kafka.activeCapture) === value.id) kafka.activeCapture = null;
  if (selectedCapture?.id === value.id && value.revision >= selectedCapture.revision) selectedCapture = value;
}
function renderCapture() {
  const capture = selectedCapture;
  $("kafka-capture-status").textContent = capture?.status ?? "No selection";
  $("kafka-capture-status").dataset.active = String(Boolean(capture && RUNNING.has(capture.status)));
  $("kafka-run").disabled = !capture || !RESUMABLE.has(capture.status) || !kafka.client.available;
  $("kafka-run").textContent = !capture || capture.status === "PREPARED" ? "Start capture" : "Resume this capture";
  $("kafka-cancel").disabled = !capture || capture.status !== "RUNNING";
  $("kafka-reload-capture").disabled = !capture;
  if (!capture) {
    $("kafka-capture-detail").textContent = "Prepare a capture to retain its source identity and ranges.";
    $("kafka-capture-ranges").replaceChildren(); $("kafka-attempts").textContent = "No capture selected."; return;
  }
  details("kafka-capture-detail", [
    ["Topic", capture.topic], ["Capture", capture.id], ["Revision", capture.revision],
    ["Connection revision", capture.connection + " / " + capture.connectionRevision],
    ["Records", fmt(capture.records)], ["Selected wire record bytes", fmt(capture.bytes)],
    ["Boundary observations", fmt(capture.boundaryRecords ?? 0)], ["Total retained wire bytes", fmt(capture.retainedBytes ?? capture.bytes)], ["Updated", capture.updatedAt],
    ["Topic UUID", capture.topicId], ["Source cluster", capture.clusterId], ...(capture.error ? [["Last result", capture.error]] : []),
  ]);
  table("kafka-capture-ranges", ["Partition", "Start", "Selected end", "Next offset", "Status", "Records", "Bytes"],
    capture.ranges.map(range => [range.partition, range.start, range.end, range.next, range.status, fmt(range.records), fmt(range.bytes)]));
  $("kafka-attempts").textContent = stringify({ attempts: capture.attempts, ranges: capture.ranges.map(range => ({
    partition: range.partition, terminalEvidence: range.terminalEvidence,
  })) });
}
function renderSelections() {
  const selected = new Set([...$("kafka-project-captures").querySelectorAll("input:checked")].map(input => input.value));
  const target = $("kafka-project-captures"); target.replaceChildren();
  for (const capture of kafka.captures) {
    const label = el("label", undefined, { class: "capture-option" });
    const input = el("input", undefined, { type: "checkbox", value: capture.id,
      checked: selected.has(capture.id), disabled: RUNNING.has(capture.status) });
    const value = el("span", capture.topic + " · " + capture.status);
    value.append(el("small", fmt(capture.records) + " records · revision " + capture.revision + " · " + short(capture.id)));
    label.append(input, value); target.append(label);
  }
}
function activeCapture() {
  return kafka?.captures.find(item => RUNNING.has(item.status)) ?? null;
}
function renderCounts() {
  $("kafka-connections-count").textContent = fmt(kafka.connections.length);
  $("kafka-captures-count").textContent = fmt(kafka.captures.length);
  $("kafka-projections-count").textContent = fmt(kafka.projections.length);
  const running = activeCapture();
  $("kafka-active-summary").textContent = running ? running.topic + " · " + running.status : "No capture running";
}
async function loadCapture(resetPage = true) {
  const id = $("kafka-capture-select").value;
  selectedCapture = id ? await api("/api/kafka/capture?id=" + encodeURIComponent(id)) : null;
  if (selectedCapture) updateCapture(selectedCapture);
  if (resetPage) { messageOffset = 0; selectedMessage = null; $("kafka-message-panel").hidden = true; }
  renderCapture(); renderCounts(); renderSelections();
  await loadMessages(messageOffset); schedulePoll();
}
async function loadMessages(start = 0) {
  const id = selectedCapture?.id;
  $("kafka-message-body").replaceChildren();
  if (!id) {
    messageOffset = messageTotal = 0; $("kafka-message-count").textContent = "";
    $("kafka-message-page").textContent = "No capture selected";
    $("kafka-messages-previous").disabled = $("kafka-messages-next").disabled = true; return;
  }
  const page = await api("/api/kafka/messages?capture=" + encodeURIComponent(id) + "&offset=" + start + "&limit=" + PAGE);
  messageOffset = page.offset; messageTotal = page.total;
  for (const record of page.messages) {
    const row = el("tr");
    for (const value of [record.partition, record.offset, record.timestampMs ?? "Unavailable", record.valueState, record.goldskyOperation ?? "—"]) row.append(el("td", value));
    const keyPreview = record.keyState === "null" ? "null key" : record.keyState === "empty" ? "empty key" :
      record.keyState === "binary" ? "Binary key" : (record.keyUtf8Preview ?? "") + (record.keyPreviewTruncated ? "…" : "");
    row.append(el("td", keyPreview, { class: "key-preview" }));
    const cell = el("td"), open = el("button", "Inspect", { type: "button", class: "small", "aria-label": "Inspect partition " + record.partition + " offset " + record.offset });
    open.addEventListener("click", () => act("Opening the original event bytes…", async () => {
      selectedMessage = await api("/api/kafka/message?id=" + encodeURIComponent(record.id));
      renderMessage(); notify("Original event opened.");
      $("kafka-message-panel").scrollIntoView({ block: "start" });
    }));
    cell.append(open); row.append(cell); $("kafka-message-body").append(row);
  }
  if (!page.messages.length) {
    const row = el("tr", undefined, { class: "empty-row" }); row.append(el("td", "No retained events in this page.", { colspan: "7" })); $("kafka-message-body").append(row);
  }
  $("kafka-message-count").textContent = fmt(page.total) + " retained events";
  $("kafka-message-page").textContent = page.total ? fmt(page.offset + 1) + "–" + fmt(page.offset + page.messages.length) + " of " + fmt(page.total) : "No events captured";
  $("kafka-messages-previous").disabled = page.offset === 0;
  $("kafka-messages-next").disabled = page.offset + page.messages.length >= page.total;
}
function decodeBase64(value) {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function renderMessage() {
  const record = selectedMessage;
  if (!record) { $("kafka-message-panel").hidden = true; return; }
  $("kafka-message-panel").hidden = false;
  details("kafka-message-detail", [
    ["Event ID", record.id], ["Original SHA-256", record.sha256], ["Topic", record.topic], ["Topic UUID", record.topicId],
    ["Partition", record.partition], ["Offset", record.offset], ["Value state", record.valueState], ["Timestamp type", record.timestampType],
    ["Timestamp, milliseconds", record.timestampMs], ["Leader epoch", record.leaderEpoch], ["Goldsky operation", record.goldskyOperation],
    ...(record.parseError ? [["Value decoding", record.parseError]] : []),
  ]);
  if (record.valueBase64 === null) $("kafka-message-value").textContent = "null — Kafka tombstone";
  else if ($("kafka-value-view").value === "base64") $("kafka-message-value").textContent = record.valueBase64 || "(empty byte string)";
  else if ($("kafka-value-view").value === "json") $("kafka-message-value").textContent =
    typeof record.valueJson === "string" ? record.valueJson : record.parseError || "This value has no decoded JSON view. Select its original text or bytes.";
  else {
    try { $("kafka-message-value").textContent = new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64(record.valueBase64)) || "(empty byte string)"; }
    catch { $("kafka-message-value").textContent = "The original value is binary. Select the base64 view to inspect every byte."; }
  }
  $("kafka-message-headers").textContent = stringify({ keyBase64: record.keyBase64, keyUtf8: record.keyUtf8, headers: record.headers });
}
async function loadProjection() {
  const id = $("kafka-projection-select").value;
  selectedProjection = id ? await api("/api/kafka/projection?id=" + encodeURIComponent(id)) : null;
  $("kafka-open-projection").disabled = $("kafka-download-default-plan").disabled = !selectedProjection;
  if (!selectedProjection) { $("kafka-projection-detail").textContent = "A source projection retains its selected capture revisions."; return; }
  const item = selectedProjection;
  details("kafka-projection-detail", [
    ["Label", item.selection.label], ["Projection", item.id], ["Native source", item.source], ["Created", item.createdAt],
    ["Record view", item.selection.view], ["Value decoding", item.selection.decode], ["Deletion handling", item.selection.deletePolicy],
    ["Records", fmt(item.records)], ["Source bytes", fmt(item.bytes)], ["Excluded", fmt(item.excluded)],
    ["Saved coverage", item.coverage.map(capture => ({ topic: capture.topic, status: capture.status, revision: capture.revision, ranges: capture.ranges }))],
  ]);
}
async function openProjection(item) {
  await refresh({ source: item.source });
  if (item.defaultPlan) renderMapping(item.defaultPlan);
  $("dataset-workspace").open = true;
  $("mapping").scrollIntoView({ block: "start" });
  notify("Source opened. Review the suggested fields, save the mapping, then build the dataset.");
}
function renderExportBuilds() {
  const projections = kafka.projections.filter(item => state.builds.some(build => build.source === item.source));
  options("kafka-export-projection", projections, item => (item.selection?.label ?? item.operation) + " · " + short(item.id));
  const selected = projections.find(item => item.id === $("kafka-export-projection").value);
  const builds = selected ? state.builds.filter(build => build.source === selected.source) : [];
  options("kafka-export-build", builds, item => (item.native?.name ?? "Dataset") + " · " + fmt(item.rowCount) + " rows · " + short(item.id));
  $("kafka-export-form").querySelector("button").disabled = !builds.length;
}
async function refreshKafka(pick = {}) {
  state = validateState(await api("/api/state")); kafka = state.kafka;
  const client = kafka.client;
  $("kafka-client").textContent = client.available ? "Available · " + client.version : "Install native client";
  $("kafka-client-detail").textContent = client.available ? "Native broker client: " + client.pythonPackage + " " + client.version + " · librdkafka " + client.libraryVersion :
    client.message || "Install " + client.requirement + " in the selected Python environment to inspect and capture a broker.";
  options("kafka-connection-select", kafka.connections, item => item.config.label + " · revision " + item.revision, pick.connection);
  options("kafka-inspection-select", kafka.inspections, item => item.topic + " · " + item.observedAt + " · " + short(item.id), pick.inspection);
  options("kafka-capture-select", kafka.captures, captureLabel, pick.capture);
  options("kafka-projection-select", kafka.projections, item => (item.selection?.label ?? item.operation) + " · " + short(item.id), pick.projection);
  renderCounts(); renderSelections(); renderExportBuilds();
  await loadConnection(); await loadInspection(); await loadCapture(pick.resetPage !== false); await loadProjection();
}
function schedulePoll() {
  clearTimeout(timer);
  if (!closed && !document.hidden && activeCapture()) timer = setTimeout(pollCapture, 2000);
}
async function pollCapture() {
  const current = activeCapture();
  if (!current || closed || document.hidden) return;
  if (polling || document.body.dataset.busy === "true") { schedulePoll(); return; }
  const started = generation;
  polling = true;
  try {
    const value = await api("/api/kafka/capture?id=" + encodeURIComponent(current.id));
    if (started !== generation || document.body.dataset.busy === "true") return;
    updateCapture(value);
    options("kafka-capture-select", kafka.captures, captureLabel);
    renderCounts(); renderCapture(); renderSelections();
    if (!RUNNING.has(value.status)) notify("Capture " + value.status.toLowerCase().replaceAll("_", " ") + ". " + fmt(value.records) + " records retained. Refresh the capture to review its current message pages.", Boolean(value.error));
  } catch (error) {
    if (started === generation) notify("Capture status could not be refreshed: " + (error.message || String(error)) + ". Reopen or refresh this retained capture.", true);
  } finally { polling = false; schedulePoll(); }
}

invoke("kafka-refresh", "click", "Opening retained Kafka source history…", async () => { await refresh(); await refreshKafka(); notify("Kafka workspace refreshed."); });
$("kafka-protocol").addEventListener("change", syncControls);
$("kafka-connection-id").addEventListener("input", () => {
  $("kafka-connection-edit-state").textContent = $("kafka-connection-id").value.trim() === editingConnection
    ? "Editing retained revision " + editingRevision + "."
    : "A new connection starts at revision 1. To revise a saved connection, select it and choose Edit.";
});
invoke("kafka-new-connection", "click", "Preparing a new connection…", async () => {
  $("kafka-connection-form").reset(); editingConnection = null; editingRevision = 0;
  $("kafka-connection-id").value = ""; $("kafka-connection-label").value = "";
  $("kafka-connection-edit-state").textContent = "A new connection starts at revision 1.";
  syncControls(); $("kafka-connection-id").focus(); notify("Enter the new connection's topic and environment references.");
});
invoke("kafka-connection-form", "submit", "Saving the exact connection revision…", async () => {
  const id = $("kafka-connection-id").value.trim();
  const result = await operation("connection", "/api/kafka/connection", {
    connection: id, expectedRevision: id === editingConnection ? editingRevision : 0, config: connectionConfig(),
  });
  loadConnectionEditor(result); await refreshKafka({ connection: result.id });
  notify("Connection revision " + result.revision + " saved. Inspect the source to select capture ranges.");
});
invoke("kafka-connection-select", "change", "Opening the saved connection…", async () => { await loadConnection(); notify("Saved connection opened."); });
invoke("kafka-load-connection", "click", "Opening the retained connection for revision…", async () => {
  if (!selectedConnection) throw new Error("Choose a connection first.");
  loadConnectionEditor(selectedConnection); notify("Connection loaded. Save retains a new revision.");
});
invoke("kafka-inspect", "click", "Reading native cluster, topic identity and committed offsets…", async () => {
  if (!selectedConnection) throw new Error("Choose a saved connection first.");
  const result = await operation("inspect", "/api/kafka/inspect", { connection: selectedConnection.id, revision: selectedConnection.revision });
  await refreshKafka({ inspection: result.id }); $("capture").scrollIntoView({ block: "start" });
  notify("Topic inspection retained. Review the start and end for each selected partition.");
});
invoke("kafka-inspection-select", "change", "Opening the retained topic inspection…", async () => { await loadInspection(); notify("Retained partition offsets opened."); });
invoke("kafka-capture-form", "submit", "Retaining the exact partition ranges…", async () => {
  if (!selectedInspection) throw new Error("Inspect a source topic first.");
  const ranges = [];
  for (const row of $("kafka-range-body").querySelectorAll("tr")) {
    if (!row.querySelector("input[type=checkbox]").checked) continue;
    const partition = Number(row.dataset.partition);
    const start = offset(row.querySelector('[data-bound="start"]').value.trim()), end = offset(row.querySelector('[data-bound="end"]').value.trim());
    const original = selectedInspection.partitions.find(item => item.partition === partition);
    if (BigInt(start) < BigInt(original.low) || BigInt(end) > BigInt(original.end) || BigInt(start) > BigInt(end))
      throw new Error("Partition " + partition + " must stay within its inspected committed range.");
    ranges.push({ partition, start, end });
  }
  if (!ranges.length) throw new Error("Select at least one partition.");
  const result = await operation("capture", "/api/kafka/capture", { inspection: selectedInspection.id, ranges });
  await refreshKafka({ capture: result.id }); notify("Capture prepared. Start reads these exact ranges through the native consumer.");
});
invoke("kafka-capture-select", "change", "Opening retained capture and message history…", async () => { await loadCapture(); notify("Capture opened."); });
invoke("kafka-reload-capture", "click", "Refreshing the original capture and current message page…", async () => { await loadCapture(false); notify("Capture and message page refreshed."); });
invoke("kafka-run", "click", "Starting the same retained capture from its saved offsets…", async () => {
  const id = required("kafka-capture-select", "a capture");
  const current = await api("/api/kafka/capture?id=" + encodeURIComponent(id));
  const result = await api("/api/kafka/run", { body: { capture: id, expectedRevision: current.revision } });
  selectedCapture = result; updateCapture(result); renderCapture(); renderCounts(); renderSelections();
  notify("Native capture " + result.status.toLowerCase().replaceAll("_", " ") + ". Progress is saved with its next offsets.");
});
invoke("kafka-cancel", "click", "Closing the existing native consumer…", async () => {
  const result = await api("/api/kafka/cancel", { body: { capture: required("kafka-capture-select", "a running capture") } });
  selectedCapture = result; updateCapture(result); renderCapture(); renderCounts(); renderSelections();
  notify("Capture " + result.status.toLowerCase().replaceAll("_", " ") + ". Its completed batches remain retained.");
});
invoke("kafka-messages-previous", "click", "Reading the previous retained messages…", async () => { await loadMessages(Math.max(0, messageOffset - PAGE)); notify("Previous message page opened."); });
invoke("kafka-messages-next", "click", "Reading the next retained messages…", async () => { await loadMessages(messageOffset + PAGE); notify("Next message page opened."); });
$("kafka-value-view").addEventListener("change", renderMessage);
invoke("kafka-download-message", "click", "Downloading the original event record…", async () => {
  if (!selectedMessage) throw new Error("Select an event first.");
  download(await api("/api/kafka/message?id=" + encodeURIComponent(selectedMessage.id), { download: true }), "kafka-event-" + selectedMessage.id + ".json");
  notify("Exact native event record downloaded.");
});
invoke("kafka-project-form", "submit", "Freezing the selected events into an original dataset source…", async () => {
  const ids = [...$("kafka-project-captures").querySelectorAll("input:checked")].map(input => input.value);
  if (!ids.length) throw new Error("Select at least one retained capture.");
  const captures = ids.map(id => kafka.captures.find(item => item.id === id));
  if (captures.some(item => !item || RUNNING.has(item.status))) throw new Error("Finish or stop the selected captures before creating a source.");
  const acceptIncomplete = $("kafka-project-incomplete").checked;
  if (!acceptIncomplete && captures.some(item => item.status !== "COMPLETE")) throw new Error("Complete each selected capture, or explicitly include its saved incomplete coverage.");
  const result = await operation("project", "/api/kafka/project", {
    captures: captures.map(item => ({ id: item.id, revision: item.revision })), view: $("kafka-project-view").value,
    decode: $("kafka-project-decode").value, deletePolicy: $("kafka-project-deletes").value, acceptIncomplete,
    label: $("kafka-project-label").value.trim(),
  });
  await refreshKafka({ projection: result.id }); await openProjection(result);
});
invoke("kafka-projection-select", "change", "Opening the fixed source projection…", async () => { await loadProjection(); notify("Source projection opened."); });
invoke("kafka-open-projection", "click", "Opening the source and suggested mapping…", async () => {
  if (!selectedProjection) throw new Error("Choose a source projection first.");
  await openProjection(selectedProjection);
});
invoke("kafka-download-default-plan", "click", "Preparing the source's suggested mapping…", async () => {
  if (!selectedProjection?.defaultPlan) throw new Error("Choose a source projection first.");
  download(new Blob([stringify(selectedProjection.defaultPlan) + "\n"], { type: "application/json" }), "kafka-suggested-mapping.json");
  notify("Suggested mapping downloaded for review.");
});
invoke("kafka-export-form", "submit", "Preparing the complete Kafka source and native dataset…", async () => {
  download(await api("/api/kafka/export?build=" + encodeURIComponent(required("kafka-export-build", "a Kafka-backed edition")) + "&projection=" + encodeURIComponent(required("kafka-export-projection", "a source projection")), { download: true }), "kafka-project.zip");
  notify("Complete Kafka source and native dataset project downloaded.");
});
invoke("kafka-import-form", "submit", "Receiving and reconstructing the complete Kafka project…", async () => {
  const file = $("kafka-import-file").files[0]; if (!file) throw new Error("Choose a complete Kafka project ZIP.");
  await api("/api/kafka/import", { raw: file, headers: { "Content-Type": "application/zip" } });
  await refresh(); await refreshKafka(); $("kafka-import-form").reset();
  notify("Complete Kafka source history and dataset received. Open its projection or edition to continue.");
});
$("kafka-export-projection").addEventListener("change", renderExportBuilds);
document.addEventListener("sf30:ndjson-state", event => {
  if (!event.detail?.kafka || !kafka) return;
  state = validateState(event.detail); kafka = state.kafka;
  renderExportBuilds();
});
for (const anchor of document.querySelectorAll('a[href^="#"]')) {
  anchor.addEventListener("click", () => {
    const target = document.getElementById(anchor.getAttribute("href").slice(1));
    if (target?.closest("#dataset-workspace")) $("dataset-workspace").open = true;
  });
}
document.addEventListener("visibilitychange", () => { clearTimeout(timer); if (!document.hidden) schedulePoll(); });
window.addEventListener("pagehide", () => { closed = true; clearTimeout(timer); });
window.addEventListener("pageshow", () => { closed = false; schedulePoll(); });
syncControls();
await act("Opening retained Kafka sources and captures…", async () => {
  await refreshKafka(); notify("Workspace ready. Select a saved source connection or receive an existing Kafka project.");
});
if (sectionHash) {
  const target = document.getElementById(sectionHash.slice(1));
  if (target) { if (target.closest("#dataset-workspace")) $("dataset-workspace").open = true; target.scrollIntoView({ block: "start" }); }
}
