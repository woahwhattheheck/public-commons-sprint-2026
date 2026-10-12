import { parseExactJSON as parse, stringifyExactJSON as encode } from "./json.mjs";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const text = (selector, value = "") => { $(selector).textContent = typeof value === "string" ? value : encode(value, 2); };
const val = id => $("#" + id).value.trim();
const uuid = () => crypto.randomUUID();
const formIds = ["source-root","capture-directory","selection-json","target-crs","export-directory","export-operation",
  "package-directory","package-kind","package-sha","bundle-path","receive-directory","receive-archive","archive-sha",
  "before-directory","after-directory","comparison-directory","comparison-operation","change-status","change-layer"];
const S = { root: null, python: null, operations: [], pending: null, busy: false, selectedOperation: null,
  inspection: null, capture: null, captureDirectory: null, package: null, comparison: null,
  profile: { schema: "starforge.vector-export-profile.v1", formats: ["GPKG","ESRI Shapefile"], layers: {},
    shapefile: { longValues: "reference", collections: "split" } },
  fieldOffset: 0, changeOffset: 0, changeNext: null, selectedLayer: "", filesGeneration: { selection: 0, profile: 0 },
  reads: 0, tab: "sources", fileTarget: "source-root", browsePath: ".", booted: false, profileCaptureSha: null, profiles: {}, browseGeneration: 0 };
const fragment = new URLSearchParams(location.hash.slice(1));
const sessionKey = "vector-session:" + location.origin;
if (fragment.get("session")) {
  sessionStorage.setItem(sessionKey, fragment.get("session"));
  history.replaceState(null, "", location.pathname + location.search);
}
const token = () => sessionStorage.getItem(sessionKey) || "";
function message(value, kind = "") {
  $("#notice").dataset.kind = kind; text("#notice", value || "");
}
function errText(exc) {
  return exc?.detail === undefined ? String(exc.message || exc) :
    (exc.code || "Operation failed") + "\n" + (typeof exc.detail === "string" ? exc.detail : encode(exc.detail, 2));
}
async function api(path, options = {}) {
  const headers = { authorization: "Bearer " + token(), ...(options.body ? { "content-type": "application/json" } : {}) };
  const response = await fetch(path, { ...options, headers: { ...headers, ...options.headers }, credentials: "same-origin" });
  const raw = await response.text(); let result;
  try { result = parse(raw); } catch { throw new Error("The operator returned an unreadable response (" + response.status + ")."); }
  if (!response.ok) throw Object.assign(new Error(result.error?.code || "Request failed"), result.error || {}, { status: response.status });
  return result;
}
function draftKey() { return "vector-draft-v1:" + S.root; }
function save() {
  if (!S.root || !S.booted) return;
  if (S.profileCaptureSha) S.profiles[S.profileCaptureSha] = S.profile;
  const data = { root: S.root, tab: S.tab, profileCaptureSha: S.profileCaptureSha, profiles: S.profiles, fields: Object.fromEntries(formIds.map(id => [id, $("#" + id).value])),
    profile: S.profile, pending: S.pending, captureOperation: S.captureOperation, packageOperation: S.packageOperation,
    comparisonOperation: S.comparisonOperation };
  try { localStorage.setItem(draftKey(), encode(data)); } catch { message("The browser could not save this draft. Original server requests and results remain available in Operations.", "error"); }
}
function restore() {
  const raw = localStorage.getItem(draftKey()); if (!raw) return;
  const data = parse(raw); if (data.root !== S.root) return;
  for (const id of formIds) if (typeof data.fields?.[id] === "string") $("#" + id).value = data.fields[id];
  if (data.profile?.schema === "starforge.vector-export-profile.v1") S.profile = data.profile;
  S.profileCaptureSha = data.profileCaptureSha || null; S.profiles = data.profiles || {};
  S.pending = data.pending || null; S.restoreCapture = data.captureOperation;
  S.restorePackage = data.packageOperation; S.restoreComparison = data.comparisonOperation;
  S.tab = data.tab || "sources";
}
function setBusy(value) {
  S.busy = value;
  const disabled = value || S.reads > 0;
  $$("main input,main select,main textarea,main button").forEach(element => { element.disabled = disabled; });
  $("#capabilities").disabled = disabled;
  if (!disabled) {
    $("#fields-previous").disabled = S.fieldOffset === 0;
    $("#changes-previous").disabled = S.changeOffset === 0;
    $("#changes-next").disabled = S.changeNext === null;
  }
}
function tab(name) {
  if (!["sources","mapping","packages","comparison","operations"].includes(name)) name = "sources";
  S.tab = name; $$("[data-panel]").forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
  $$("[data-tab]").forEach(button => button.setAttribute("aria-current", button.dataset.tab === name ? "page" : "false"));
  save();
}
function button(label, action) {
  const element = document.createElement("button"); element.type = "button"; element.textContent = label;
  element.disabled = S.busy || S.reads > 0;
  element.addEventListener("click", () => guarded(action)); return element;
}
function cell(row, value, className = "") {
  const td = document.createElement("td"); if (className) td.className = className;
  td.textContent = value == null ? "" : typeof value === "string" ? value : encode(value);
  row.append(td); return td;
}
function emptyRows(selector, count, message) {
  const tbody = $(selector); tbody.replaceChildren();
  if (message) { const row = document.createElement("tr"), td = cell(row, message); td.colSpan = count; td.className = "empty"; tbody.append(row); }
  return tbody;
}
function metric(selector, counts) {
  const target = $(selector); target.replaceChildren();
  for (const [name, value] of Object.entries(counts || {})) {
    if (value === null || typeof value === "object") continue;
    const element = document.createElement("div"); element.className = "metric";
    const strong = document.createElement("strong"), label = document.createElement("span");
    strong.textContent = String(value); label.textContent = name.replace(/([a-z])([A-Z])/g, "$1 $2");
    element.append(strong, label); target.append(element);
  }
}
function downloadJSON(name, value) {
  const blob = new Blob([typeof value === "string" ? value : encode(value, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadPath(path) { return "/api/download?" + new URLSearchParams({ path }); }
async function guarded(action) {
  try { await action(); } catch (exc) { message(errText(exc), "error"); }
}
async function perform(action) {
  if (S.busy || S.reads) return;
  setBusy(true);
  try { await action(); }
  finally { setBusy(false); save(); }
}
async function refresh() {
  const state = await api("/api/state");
  if (S.root && state.root !== S.root) throw new Error("The operator data directory changed. Open its new session before selecting work.");
  S.root = state.root; S.python = state.python; S.operations = state.operations;
  text("#root-label", state.root); text("#python-label", state.python); text("#connection", "Connected");
  renderOperations(); return state;
}
async function run(request, requestId = uuid()) {
  const pending = { requestId, request, root: S.root };
  S.pending = pending; S.selectedOperation = requestId; save();
  message("Running " + request.command + " · " + requestId, "busy");
  let status = await api("/api/run", { method: "POST", body: encode(pending) });
  renderOperations();
  while (status.state === "RUNNING") {
    await new Promise(resolve => setTimeout(resolve, 1200));
    status = await api("/api/operations/" + encodeURIComponent(requestId));
    text("#connection", request.command + " / " + status.state.toLowerCase());
  }
  if (status.state === "INTERRUPTED" || status.state === "RETAINED")
    throw new Error("The original request is retained. Use Continue original request in Operations to resume it.");
  const outcome = await api("/api/operations/" + encodeURIComponent(requestId) + "/result");
  S.lastResult = outcome; S.lastRequestId = requestId;
  await refresh();
  if (!outcome.ok) throw Object.assign(new Error(outcome.error?.code || "Native operation failed"), outcome.error || {});
  S.pending = null; save();
  message("Completed " + request.command + " · " + requestId);
  return { result: outcome.result, requestId };
}
function selectionView() {
  try {
    const value = parse($("#selection-json").value || "{}");
    const rows = emptyRows("#selection-rows", 5, value.sources?.length ? null : "Import a complete original selection to begin.");
    for (const source of value.sources || []) {
      const row = document.createElement("tr");
      cell(row, source.id); cell(row, source.path); cell(row, source.bytes);
      cell(row, source.sha256, "mono source-key"); cell(row, source.identity || { mode: "feature-id" }); rows.append(row);
    }
    text("#selection-count", (value.sources?.length || 0) + " selected original files");
  } catch (exc) { text("#selection-count", exc.message); }
}
function adoptCapture(result, requestId) {
  if (!result.inspection) return;
  const nextSha = result.manifestFile.sha256;
  if (S.profileCaptureSha !== nextSha) ++S.filesGeneration.profile;
  if (S.profileCaptureSha && S.profileCaptureSha !== nextSha) {
    S.profiles[S.profileCaptureSha] = S.profile;
    S.profile = S.profiles[nextSha] || { schema: "starforge.vector-export-profile.v1",
      formats: ["GPKG","ESRI Shapefile"], layers: {}, shapefile: { longValues: "reference", collections: "split" } };
  }
  S.profileCaptureSha = nextSha;
  S.capture = result.manifest; S.inspection = result.inspection; S.captureDirectory = result.directory;
  S.captureOperation = requestId; $("#capture-directory").value = result.directory;
  text("#capture-identity", result.manifestFile.sha256);
  text("#mapping-capture", result.manifest.selection.id + " / " + result.inspection.counts.features + " features");
  text("#source-details", { manifest: result.manifest, inspection: result.inspection });
  const tbody = emptyRows("#source-layers", 6, result.inspection.layers.length ? null : "The original selection has no layers.");
  const select = $("#mapping-layer"); select.replaceChildren();
  for (const layer of result.inspection.layers) {
    const row = document.createElement("tr"); cell(row, layer.id); cell(row, layer.counts.features);
    cell(row, layer.schema.geometry); cell(row, layer.crs || "Unassigned"); cell(row, layer.identity);
    cell(row, "").append(button("Review mapping", () => { chooseLayer(layer.id); tab("mapping"); }));
    tbody.append(row); const option = document.createElement("option"); option.value = layer.id; option.textContent = layer.id + " / " + layer.name; select.append(option);
  }
  if (!result.inspection.layers.some(layer => layer.id === S.selectedLayer)) S.selectedLayer = result.inspection.layers[0]?.id || "";
  $("#mapping-layer").value = S.selectedLayer; profileControls(); renderMapping(); save();
}
function layerProfile() {
  if (!S.selectedLayer) return null;
  const value = S.profile.layers?.[S.selectedLayer];
  return value ? { ...value, fields: { ...(value.fields || {}) } } : { fields: {} };
}
function editLayer(change, id = S.selectedLayer) {
  if (!id) return;
  S.profile.layers ||= {};
  const profile = S.profile.layers[id] ||= {};
  profile.fields ||= {};
  change(profile); updateProfileText();
}
function chooseLayer(id) {
  S.selectedLayer = id; S.fieldOffset = 0; $("#mapping-layer").value = id; renderMapping(); save();
}
function updateProfileText() { $("#profile-json").value = encode(S.profile, 2); save(); }
function profileControls() {
  $("#format-gpkg").checked = S.profile.formats?.includes("GPKG");
  $("#format-shp").checked = S.profile.formats?.includes("ESRI Shapefile");
  $("#target-crs").value = S.profile.targetCrs || ""; updateProfileText();
}
function renderMapping() {
  const layer = S.inspection?.layers.find(item => item.id === S.selectedLayer);
  if (!layer) { emptyRows("#mapping-fields", 6, "Open a retained capture to review all original fields."); return; }
  const profile = layerProfile();
  $("#layer-name").value = profile.name || "";
  $("#assign-crs").value = profile.assignSourceCrs || "";
  $("#layer-target-crs").value = profile.targetCrs || "";
  text("#layer-details", layer);
  const filter = val("field-filter").toLowerCase();
  const names = layer.fieldOrder.filter(name => name.toLowerCase().includes(filter));
  S.fieldOffset = Math.min(S.fieldOffset, Math.max(0, Math.floor((names.length - 1) / 50) * 50));
  const shown = names.slice(S.fieldOffset, S.fieldOffset + 50);
  const tbody = emptyRows("#mapping-fields", 6, shown.length ? null : "No original fields match this filter.");
  for (const name of shown) {
    const stat = layer.fields[name], rule = profile.fields[name] || {}, row = document.createElement("tr");
    cell(row, name); cell(row, stat.kinds.join(", ") + "\n" + stat.present + " present / " + stat.absent + " absent / " + stat.nulls + " null");
    const mode = document.createElement("select"); mode.setAttribute("aria-label", "Representation for " + name);
    mode.disabled = S.busy || S.reads > 0;
    for (const value of ["auto","native","json","reference"]) {
      const option = document.createElement("option"); option.value = value; option.textContent = value; mode.append(option);
    }
    mode.value = rule.mode || "auto";
    mode.onchange = () => editLayer(current => { (current.fields[name] ||= {}).mode = mode.value; }, layer.id);
    cell(row, "").append(mode);
    for (const format of ["GPKG","ESRI Shapefile"]) {
      const input = document.createElement("input"); input.value = rule.names?.[format] || rule.name || "";
      input.disabled = S.busy || S.reads > 0;
      input.placeholder = "Automatic"; input.setAttribute("aria-label", format + " field name for " + name);
      input.onchange = () => editLayer(current => { const r = current.fields[name] ||= {}; r.names ||= {};
        if (input.value) r.names[format] = input.value; else delete r.names[format]; }, layer.id);
      cell(row, "").append(input);
    }
    const physical = document.createElement("input"); physical.value = rule.physicalType || ""; physical.placeholder = "e.g. int64";
    physical.disabled = S.busy || S.reads > 0;
    physical.setAttribute("aria-label", "Explicit native type for " + name);
    physical.onchange = () => editLayer(current => { const r = current.fields[name] ||= {};
      if (physical.value) r.physicalType = physical.value; else delete r.physicalType; }, layer.id);
    cell(row, "").append(physical); tbody.append(row);
  }
  text("#field-page", names.length ? (S.fieldOffset + 1) + "–" + (S.fieldOffset + shown.length) + " of " + names.length : "0 fields");
  $("#fields-previous").disabled = S.busy || S.reads > 0 || S.fieldOffset === 0;
  $("#fields-next").disabled = S.busy || S.reads > 0 || S.fieldOffset + 50 >= names.length; updateProfileText();
}
function applyProfile(value) {
  ++S.filesGeneration.profile;
  if (value.schema !== "starforge.vector-export-profile.v1" || !Array.isArray(value.formats) || !value.formats.length)
    throw new Error("Use a complete starforge.vector-export-profile.v1 profile with selected formats.");
  S.profile = value; S.profile.layers ||= {}; profileControls(); renderMapping(); save();
}
function adoptPackage(result, requestId) {
  if (!["starforge.vector-export.v1","starforge.vector-comparison.v1"].includes(result.manifest?.schema)) return;
  S.package = result; S.packageOperation = requestId;
  const comparison = result.manifest.schema === "starforge.vector-comparison.v1";
  $("#package-directory").value = result.directory; $("#package-kind").value = comparison ? "comparison" : "export";
  $("#package-sha").value = result.manifestFile.sha256;
  metric("#package-summary", result.manifest.counts); text("#package-details", result);
  const layers = result.manifest.native?.layers || [];
  const tbody = emptyRows("#native-layers", 6, layers.length ? null : comparison ? "This package contains both complete source editions and every recorded change." : "No native layers.");
  for (const layer of layers) {
    const row = document.createElement("tr"); cell(row, layer.layer); cell(row, layer.driver);
    cell(row, layer.sourceFeatureCount + " → " + layer.featureCount);
    cell(row, layer.geometry); const crs = cell(row, layer.crsWkt ? layer.crsWkt.slice(0, 110) + (layer.crsWkt.length > 110 ? "…" : "") : "Unassigned"); crs.title = layer.crsWkt || "";
    const a = document.createElement("a"); a.className = "mono"; a.href = downloadPath(result.directory + "/" + layer.path);
    a.textContent = layer.path; a.download = ""; cell(row, "").append(a); tbody.append(row);
  }
  save();
}
async function readChanges() {
  if (!S.comparison) throw new Error("Open a retained source comparison first.");
  const { result } = await run({ command: "changes", directory: S.comparison.directory,
    expectedManifestSha256: S.comparison.manifestFile.sha256, offset: S.changeOffset, limit: 100,
    ...(val("change-layer") ? { layerId: val("change-layer") } : {}),
    ...(val("change-status") ? { status: val("change-status") } : {}) });
  S.changeNext = result.nextOffset;
  text("#changes-page", result.total ? (result.offset + 1) + "–" + (result.offset + result.changes.length) + " of " + result.total : "0 changes");
  const tbody = emptyRows("#change-rows", 7, result.changes.length ? null : "No original features match these changes.");
  for (const item of result.changes) {
    const change = parse(item.valueJson), row = document.createElement("tr");
    cell(row, change.status); cell(row, change.identity, "mono"); cell(row, change.layerId);
    cell(row, change.identityBasis + (change.identityMultiplicity ? "\n" + change.identityMultiplicity.before + " before / " + change.identityMultiplicity.after + " after" : "") +
      (change.identityIssues?.length ? "\n" + change.identityIssues.join(", ") : ""));
    cell(row, change.propertyChanges.length + (change.propertiesContainerChanged ? " / container changed" : ""));
    cell(row, change.geometryChanged ? "Changed" : "");
    cell(row, "").append(button("Read values", () => text("#change-details", encode(change, 2)))); tbody.append(row);
  }
  $("#changes-previous").disabled = S.busy || S.reads > 0 || S.changeOffset === 0;
  $("#changes-next").disabled = S.busy || S.reads > 0 || S.changeNext === null;
}
function adoptComparison(result, requestId) {
  S.comparison = result; S.comparisonOperation = requestId; S.changeOffset = 0;
  $("#comparison-directory").value = result.directory;
  metric("#comparison-summary", result.manifest.counts); text("#comparison-details", result.manifest); save();
}
function renderOperations() {
  const values = [...S.operations];
  if (S.pending && !values.some(item => item.id === S.pending.requestId))
    values.unshift({ id: S.pending.requestId, state: "RESPONSE_PENDING", request: S.pending.request });
  const tbody = emptyRows("#operation-rows", 5, values.length ? null : "Original native requests appear here as work begins.");
  for (const item of values) {
    const row = document.createElement("tr"); cell(row, item.id, "mono"); cell(row, item.state, "state");
    cell(row, item.request?.command || item.command); cell(row, item.summary?.directory || item.request?.directory || "");
    cell(row, "").append(button("Open", () => { S.selectedOperation = item.id; text("#operation-details", item); tab("operations"); }));
    tbody.append(row);
  }
}
async function resultFor(id, adopt = false) {
  const outcome = await api("/api/operations/" + encodeURIComponent(id) + "/result");
  S.lastResult = outcome; S.selectedOperation = id; text("#operation-details", outcome);
  if (adopt && outcome.ok) {
    const result = outcome.result;
    if (result.inspection) adoptCapture(result, id);
    else if (result.manifest?.schema === "starforge.vector-comparison.v1") adoptComparison(result, id);
    else if (result.manifest?.schema === "starforge.vector-export.v1") adoptPackage(result, id);
  }
  return outcome;
}
async function showFiles(path = ".", target = S.fileTarget) {
  const generation = ++S.browseGeneration;
  const listing = await api("/api/files?" + new URLSearchParams({ path }));
  if (generation !== S.browseGeneration) return;
  S.fileTarget = target; S.browsePath = listing.path; text("#browse-path", listing.path);
  const entries = $("#browse-entries"); entries.replaceChildren();
  for (const entry of listing.entries) {
    const row = document.createElement("div"); row.className = "file-entry";
    const kind = document.createElement("span"); kind.textContent = entry.kind;
    const name = document.createElement("span"); name.textContent = entry.name; row.append(kind, name);
    row.append(button(entry.kind === "directory" ? "Open" : target === "selection-json" ? "Read JSON" : "Use path", async () => {
      if (entry.kind === "directory") return showFiles(entry.path, target);
      if (target === "selection-json") {
        const generation = ++S.filesGeneration.selection, root = S.root;
        S.reads++; setBusy(S.busy);
        try {
          const value = await api("/api/document?" + new URLSearchParams({ path: entry.path }));
          if (generation !== S.filesGeneration.selection || root !== S.root || S.busy) return;
          $("#selection-json").value = encode(value, 2); selectionView();
        } finally { S.reads--; setBusy(S.busy); }
      } else $("#" + target).value = entry.path;
      $("#file-dialog").close(); save();
    })); entries.append(row);
  }
  $("#browse-select").hidden = target === "selection-json";
  if (!$("#file-dialog").open) $("#file-dialog").showModal();
}
function bind(id, action) { $("#" + id).addEventListener("click", () => guarded(() => perform(action))); }
$$("[data-tab]").forEach(element => element.addEventListener("click", () => tab(element.dataset.tab)));
$$("[data-browse-target]").forEach(element => element.addEventListener("click", () => guarded(() => showFiles(".", element.dataset.browseTarget))));
$("#refresh").onclick = () => guarded(refresh);
$("#selection-json").addEventListener("input", () => { ++S.filesGeneration.selection; selectionView(); save(); });
$("#profile-json").addEventListener("input", () => { ++S.filesGeneration.profile; });
for (const id of formIds) $("#" + id).addEventListener("change", save);
$("#selection-read").onclick = () => guarded(() => showFiles(".", "selection-json"));
$("#selection-download").onclick = () => guarded(() => downloadJSON("vector-selection.json", parse($("#selection-json").value)));
$("#profile-download").onclick = () => downloadJSON("vector-export-profile.json", S.profile);
$("#profile-apply").onclick = () => guarded(() => applyProfile(parse($("#profile-json").value)));
for (const kind of ["selection","profile"]) $("#" + kind + "-file").addEventListener("change", async event => {
  const generation = ++S.filesGeneration[kind], file = event.target.files?.[0], root = S.root,
    captureSha = S.profileCaptureSha;
  if (!file) return;
  S.reads++; setBusy(S.busy);
  try {
    await guarded(async () => {
      if (file.size > 16 * 1024 * 1024) throw new Error("The selection or profile JSON exceeds 16 MiB.");
      const raw = await file.text();
      if (generation !== S.filesGeneration[kind] || S.root !== root ||
          kind === "profile" && captureSha !== S.profileCaptureSha || S.busy) return;
      const value = parse(raw);
      if (kind === "selection") { $("#selection-json").value = raw; selectionView(); save(); }
      else applyProfile(value);
    });
  } finally { S.reads--; setBusy(S.busy); }
});
bind("capabilities", async () => { const { result, requestId } = await run({ command: "capabilities" });
  S.selectedOperation = requestId; text("#operation-details", result); tab("operations"); });
bind("capture", async () => {
  const selection = parse($("#selection-json").value), directory = val("capture-directory");
  const captured = await run({ command: "capture", selection, sourceRoot: val("source-root"), directory });
  const opened = await run({ command: "inspect", directory: captured.result.directory,
    expectedManifestSha256: captured.result.manifestFile.sha256 });
  adoptCapture(opened.result, opened.requestId);
});
bind("inspect", async () => { const opened = await run({ command: "inspect", directory: val("capture-directory") }); adoptCapture(opened.result, opened.requestId); });
$("#mapping-layer").onchange = () => chooseLayer(val("mapping-layer"));
$("#field-filter").oninput = () => { S.fieldOffset = 0; renderMapping(); };
$("#fields-previous").onclick = () => { S.fieldOffset = Math.max(0, S.fieldOffset - 50); renderMapping(); };
$("#fields-next").onclick = () => { S.fieldOffset += 50; renderMapping(); };
for (const id of ["format-gpkg","format-shp"]) $("#" + id).onchange = () => {
  S.profile.formats = [$("#format-gpkg").checked && "GPKG", $("#format-shp").checked && "ESRI Shapefile"].filter(Boolean); updateProfileText(); };
$("#target-crs").onchange = () => { if (val("target-crs")) S.profile.targetCrs = val("target-crs"); else delete S.profile.targetCrs; updateProfileText(); };
for (const [id, key] of [["layer-name","name"],["assign-crs","assignSourceCrs"],["layer-target-crs","targetCrs"]]) $("#" + id).onchange = () => {
  editLayer(profile => { if (val(id)) profile[key] = val(id); else delete profile[key]; }); };
bind("export", async () => {
  if (!S.captureDirectory) throw new Error("Open a retained capture before exporting.");
  const exported = await run({ command: "export", captureDirectory: S.captureDirectory,
    directory: val("export-directory"), operationId: val("export-operation"), profile: S.profile });
  adoptPackage(exported.result, exported.requestId); tab("packages");
});
bind("package-open", async () => { const opened = await run({
  command: val("package-kind") === "comparison" ? "open-comparison" : "open",
  directory: val("package-directory"), ...(val("package-sha") ? { expectedManifestSha256: val("package-sha") } : {}) });
  adoptPackage(opened.result, opened.requestId); });
$("#package-manifest").onclick = () => guarded(() => {
  if (!S.package) throw new Error("Open a complete package first.");
  const a = document.createElement("a"); a.href = downloadPath(S.package.directory + "/" + S.package.manifestFile.path); a.download = ""; a.click();
});
bind("bundle", async () => {
  if (!S.package || S.package.directory !== val("package-directory")) throw new Error("Open the selected package first.");
  const packed = await run({ command: "bundle", directory: S.package.directory, archivePath: val("bundle-path"),
    expectedManifestSha256: S.package.manifestFile.sha256 });
  $("#bundle-download").href = downloadPath(packed.result.path); $("#bundle-download").hidden = false;
  $("#receive-archive").value = packed.result.path; $("#archive-sha").value = packed.result.file.sha256;
  text("#package-details", { package: S.package.manifest, archive: packed.result });
});
bind("receive-directory-button", async () => {
  if (!S.package || S.package.directory !== val("package-directory")) throw new Error("Open the selected package first.");
  const received = await run({ command: S.package.manifest.schema === "starforge.vector-comparison.v1" ? "receive-comparison" : "receive",
    sourceDirectory: S.package.directory, directory: val("receive-directory"), expectedManifestSha256: S.package.manifestFile.sha256 });
  adoptPackage(received.result, received.requestId);
});
bind("receive-bundle", async () => {
  const received = await run({ command: "receive-bundle", archivePath: val("receive-archive"), directory: val("receive-directory"),
    ...(val("archive-sha") ? { expectedArchiveSha256: val("archive-sha") } : {}),
    ...(val("package-sha") ? { expectedManifestSha256: val("package-sha") } : {}) });
  adoptPackage(received.result, received.requestId);
});
bind("compare", async () => {
  const compared = await run({ command: "compare", beforeDirectory: val("before-directory"), afterDirectory: val("after-directory"),
    directory: val("comparison-directory"), operationId: val("comparison-operation") });
  adoptComparison(compared.result, compared.requestId); await readChanges();
});
bind("comparison-open", async () => {
  const opened = await run({ command: "open-comparison", directory: val("comparison-directory") });
  adoptComparison(opened.result, opened.requestId); await readChanges();
});
$("#comparison-package").onclick = () => guarded(() => {
  if (!S.comparison) throw new Error("Open the source comparison first.");
  adoptPackage(S.comparison, S.comparisonOperation); tab("packages");
});
bind("changes-apply", async () => { S.changeOffset = 0; await readChanges(); });
bind("changes-previous", async () => { S.changeOffset = Math.max(0, S.changeOffset - 100); await readChanges(); });
bind("changes-next", async () => { if (S.changeNext !== null) { S.changeOffset = S.changeNext; await readChanges(); } });
bind("operation-continue", async () => {
  const id = S.selectedOperation || S.pending?.requestId; if (!id) throw new Error("Select an original operation.");
  let request;
  try { request = (await api("/api/operations/" + encodeURIComponent(id))).request; }
  catch (exc) { if (exc.status !== 404 || S.pending?.requestId !== id) throw exc; request = S.pending.request; }
  const completed = await run(request, id); await resultFor(id, true);
  if (completed.result.manifest?.schema === "starforge.vector-capture.v1" && !completed.result.inspection) {
    const opened = await run({ command: "inspect", directory: completed.result.directory,
      expectedManifestSha256: completed.result.manifestFile.sha256 }); adoptCapture(opened.result, opened.requestId);
  }
});
bind("operation-result", async () => {
  if (!S.selectedOperation) throw new Error("Select an original operation.");
  await resultFor(S.selectedOperation, true);
});
$("#operation-download").onclick = () => guarded(() => {
  if (!S.lastResult) throw new Error("Read an original result first.");
  downloadJSON((S.selectedOperation || "vector") + ".result.json", S.lastResult);
});
$("#browse-up").onclick = () => guarded(() => {
  const parts = S.browsePath.split("/"); parts.pop(); return showFiles(parts.join("/") || ".", S.fileTarget); });
$("#browse-select").onclick = () => { $("#" + S.fileTarget).value = S.browsePath; $("#file-dialog").close(); save(); };
async function boot() {
  if (!token()) throw new Error("Open the local session URL printed by the vector operator.");
  await refresh(); restore();
  if (!val("export-operation")) $("#export-operation").value = uuid();
  if (!val("comparison-operation")) $("#comparison-operation").value = uuid();
  S.booted = true; profileControls(); selectionView(); renderMapping(); renderOperations(); tab(S.tab);
  for (const id of [S.restoreCapture, S.restorePackage, S.restoreComparison].filter(Boolean)) {
    try { await resultFor(id, true); } catch (exc) { message("A saved view could not reopen: " + errText(exc), "error"); }
  }
  if (S.pending) {
    S.selectedOperation = S.pending.requestId; tab("operations");
    message("The original " + S.pending.request.command + " request is retained. Open its result or continue the same request.");
  }
  save();
}
guarded(() => perform(boot));
