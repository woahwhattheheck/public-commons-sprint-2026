// MIT. Private local NDJSON console; all dataset operations use the retained source engine.
const $ = id => document.getElementById(id);
const tokenKey = "sf30-ndjson-console-token";
const token = location.hash.slice(1) || sessionStorage.getItem(tokenKey) || "";
if (location.hash) {
  sessionStorage.setItem(tokenKey, token);
  history.replaceState(null, "", location.pathname + location.search);
}
let state = { sources: [], plans: [], builds: [], comparisons: [] };
let sourceView = null, inventoryLimit = 100, selectedPlan = null;
let nextCursor = null, lastQuery = null, changesOffset = null, active = false;
const short = value => String(value || "").slice(0, 12);
const text = value => value === null ? "null" : typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
const fmt = value => new Intl.NumberFormat().format(value || 0);

function node(tag, content, attrs = {}) {
  const el = document.createElement(tag);
  if (content !== undefined) el.textContent = content;
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") el.className = value;
    else if (key === "checked") el.checked = value;
    else if (key === "value") el.value = value;
    else el.setAttribute(key, value);
  }
  return el;
}
function notify(message, error = false) {
  $("notice").textContent = message;
  $("notice").dataset.error = String(error);
  $("notice").hidden = !message;
}
async function work(message, operation) {
  if (active) return;
  active = true;
  document.body.dataset.busy = "true";
  document.querySelector("main").inert = true;
  $("refresh").disabled = true;
  document.querySelector("main").setAttribute("aria-busy", "true");
  notify(message);
  try { await operation(); }
  catch (error) { notify(error.message || String(error), true); }
  finally {
    active = false;
    document.body.dataset.busy = "false";
    document.querySelector("main").inert = false;
    document.querySelector("main").removeAttribute("aria-busy");
    $("refresh").disabled = false;
  }
}
function listen(id, event, message, callback) {
  $(id).addEventListener(event, e => { if (event === "submit") e.preventDefault(); work(message, () => callback(e)); });
}
async function api(path, { body, raw, headers = {}, download = false } = {}) {
  const init = { credentials: "omit", cache: "no-store", headers: { Authorization: "Bearer " + token, ...headers } };
  if (body !== undefined) {
    init.method = "POST"; init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json";
  } else if (raw !== undefined) { init.method = "POST"; init.body = raw; }
  const response = await fetch(path, init);
  if (!response.ok) {
    let detail;
    try { detail = await response.json(); } catch { detail = {}; }
    throw new Error(detail.error || "Local operation failed (HTTP " + response.status + ")");
  }
  return download ? response.blob() : response.json();
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), anchor = node("a", "", { href: url, download: name });
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function selection(id, options, desired) {
  const target = $(id), old = desired || target.value;
  target.replaceChildren(...options.map(item => node("option", item.label, { value: item.id })));
  if (options.some(item => item.id === old)) target.value = old;
  if (!options.length) target.append(node("option", "No retained selection", { value: "" }));
}
function details(target, rows) {
  target.replaceChildren();
  const list = node("dl");
  for (const [label, value] of rows) list.append(node("dt", label), node("dd", text(value)));
  target.append(list);
}
function table(target, names, rows) {
  target.replaceChildren();
  if (!rows.length) { target.append(node("p", "No rows in this selection.", { class: "hint" })); return; }
  const result = node("table"), head = node("tr"), body = node("tbody");
  for (const name of names) head.append(node("th", name));
  const thead = node("thead"); thead.append(head); result.append(thead);
  for (const row of rows) {
    const tr = node("tr");
    for (const name of names) tr.append(node("td", text(row[name])));
    body.append(tr);
  }
  result.append(body); target.append(result);
}
function requireValue(id, label) {
  const value = $(id).value;
  if (!value) throw new Error("Choose " + label + " first.");
  return value;
}
async function refresh(pick = {}) {
  state = await api("/api/state");
  const sources = state.sources.map(s => ({ id: s.id, label: s.label + " · " + short(s.id) }));
  const plans = state.plans.map(p => ({ id: p.id, label: p.name + " · " + short(p.id) }));
  const builds = state.builds.map(b => ({ id: b.id, label: b.native.name + " · " + fmt(b.rowCount) + " rows · " + short(b.id) }));
  const comparisons = state.comparisons.map(c => ({ id: c.id, label: short(c.before) + " → " + short(c.after) }));
  for (const id of ["source-select", "build-source"]) selection(id, sources, pick.source);
  for (const id of ["plan-select", "build-plan"]) selection(id, plans, pick.plan);
  for (const id of ["build-select", "compare-before", "compare-after", "merchant-build", "export-build"]) selection(id, builds, pick.build);
  selection("comparison-select", comparisons, pick.comparison);
  $("source-count").textContent = fmt(state.sources.length) + " retained sources";
  $("mapping-count").textContent = fmt(state.plans.length) + " immutable mappings";
  $("build-count").textContent = fmt(state.builds.length) + " completed editions";
  if ($("source-select").value) await inspectSource();
  if ($("build-select").value) await selectBuild();
  if ($("comparison-select").value) await showComparison(0);
}
async function inspectSource() {
  const id = requireValue("source-select", "a source");
  sourceView = await api("/api/source?id=" + encodeURIComponent(id));
  inventoryLimit = 100;
  const v = sourceView.inventory;
  details($("source-detail"), [["Label", sourceView.label], ["Original filename", sourceView.name],
    ["Bytes", fmt(sourceView.bytes)], ["Records", fmt(v.records)], ["Physical lines", fmt(v.physicalLines)],
    ["Blank lines", fmt(v.blankLines)], ["Source SHA-256", sourceView.id]]);
  drawInventory();
}
function recordPath() {
  let path;
  try { path = JSON.parse($("record-path").value); }
  catch { throw new Error("Object within each line must be a JSON array of exact keys and indexes."); }
  if (!Array.isArray(path)) throw new Error("Object within each line must be an array.");
  return path;
}
function relativePath(path) {
  const base = recordPath();
  if (!base.every((item, i) => path[i] === item)) return null;
  return path.slice(base.length);
}
function drawInventory() {
  const target = $("inventory-body"), find = $("inventory-filter").value.toLowerCase();
  const list = (sourceView?.inventory.paths || []).filter(p =>
    JSON.stringify(p.path).toLowerCase().includes(find) || Object.keys(p.types).join(",").includes(find));
  target.replaceChildren();
  for (const field of list.slice(0, inventoryLimit)) {
    const tr = node("tr"), path = node("td"), samples = node("td"), controls = node("td"), actions = node("div", undefined, { class: "actions" });
    path.append(node("code", JSON.stringify(field.path)));
    for (const sample of field.samples) samples.append(node("code", sample.json, { class: "sample" }));
    const allScalar = Object.keys(field.types).every(t => !["object", "array"].includes(t));
    for (const [label, mode, withState] of [
      [allScalar ? "Scalar" : "JSON", allScalar ? "scalar" : "json", false],
      ["With state", allScalar ? "scalar" : "json", true],
    ]) {
      const button = node("button", label, { type: "button", class: "small" });
      button.disabled = field.path.includes(null);
      button.title = button.disabled ? "Choose a concrete array index in a mapping column." : "Add this exact field to the editable mapping.";
      button.addEventListener("click", () => work("Adding a mapped field…", async () => {
        const path = relativePath(field.path);
        if (!path) throw new Error("Choose a field below the mapping's selected object, or change that object path.");
        const plan = readMapping();
        addField(plan, field, path, mode, withState);
        renderMapping(plan); notify("Field added to the editable mapping. Save it when the exposure policy is ready.");
      }));
      actions.append(button);
    }
    controls.append(actions);
    tr.append(path, node("td", Object.entries(field.types).map(([type, count]) => type + " " + fmt(count)).join("\n")),
      node("td", fmt(field.records)), samples, controls); target.append(tr);
  }
  if (!list.length) { const row = node("tr"); row.append(node("td", "No matching fields.", { colspan: "5", class: "empty" })); target.append(row); }
  $("inventory-page").textContent = "Showing " + Math.min(inventoryLimit, list.length) + " of " + fmt(list.length) + " field paths.";
  $("inventory-more").hidden = inventoryLimit >= list.length;
}
const defaultPlan = () => ({ schema: "stellar-forge.ndjson-mapping.v1", name: "Merchant inventory", recordPath: [],
  columns: [], filters: [], ranges: [], sorts: [], keys: [], allowEmpty: false,
  maxRows: 250000, maxBytes: 268435456, maxCellChars: 65536, maxLimit: 250, defaultLimit: 50 });
function uniqueName(plan, raw) {
  let name = String(raw || "record").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 38);
  if (!/^[A-Za-z]/.test(name) || ["constructor", "prototype"].includes(name)) name = "field_" + name;
  let candidate = name, suffix = 2;
  while (plan.columns.some(c => c.name === candidate)) candidate = name + "_" + suffix++;
  return candidate;
}
function addField(plan, field, path, mode, withState) {
  if (plan.columns.length + (withState ? 2 : 1) > 64) throw new Error("A mapping exposes at most 64 columns.");
  const missing = field.records < sourceView.inventory.records;
  const nullable = mode === "scalar" && (missing || !!field.types.null);
  const name = uniqueName(plan, path.filter(v => typeof v === "string").at(-1) || "record");
  plan.columns.push({ name, path, mode, type: "string", nullable,
    missing: withState && missing ? "null" : "error" });
  if (withState) plan.columns.push({ name: uniqueName(plan, name + "_state"), path: [...path],
    mode: "state", type: "string", nullable: false, missing: "error" });
}
function inputCell(row, value, key, label) {
  const cell = node("td"), input = node("input", undefined, { value, "data-key": key, "aria-label": label });
  cell.append(input); row.append(cell); return input;
}
function choose(values, current, key, label) {
  const select = node("select", undefined, { "data-key": key, "aria-label": label });
  for (const value of values) select.append(node("option", value, { value }));
  select.value = current; return select;
}
function check(label, key, checked) {
  const box = node("label", undefined, { class: "check" }), input = node("input", undefined, { type: "checkbox", "data-key": key, checked });
  box.append(input, document.createTextNode(label)); return box;
}
function renderMapping(plan) {
  const full = { ...defaultPlan(), ...plan };
  $("mapping-name").value = full.name; $("record-path").value = JSON.stringify(full.recordPath);
  for (const [id, key] of [["max-rows", "maxRows"], ["max-bytes", "maxBytes"], ["max-cell", "maxCellChars"],
    ["default-limit", "defaultLimit"], ["max-limit", "maxLimit"]]) $(id).value = full[key];
  $("allow-empty").checked = full.allowEmpty;
  const target = $("columns-body"); target.replaceChildren();
  for (const [index, column] of full.columns.entries()) {
    const c = { mode: "scalar", type: "string", nullable: false, missing: "error", ...column };
    const row = node("tr");
    inputCell(row, c.name, "name", "Exposed column name").maxLength = 48;
    const path = inputCell(row, JSON.stringify(c.path), "path", "Exact source path"); path.className = "mono"; path.spellcheck = false;
    const types = node("td"), mode = choose(["scalar", "json", "state"], c.mode, "mode", "Projection mode");
    const type = choose(["string", "integer", "number", "boolean"], c.type, "type", "Native type");
    types.append(mode, type);
    const nulls = node("td"), nullable = check("Allow null", "nullable", c.nullable);
    const missing = choose(["error", "null"], c.missing, "missing", "Missing value policy");
    nulls.append(nullable, node("span", "If missing:", { class: "hint" }), missing);
    const flags = node("td"), boxes = node("div", undefined, { class: "checks" });
    for (const [label, key] of [["Equality", "filters"], ["Ranges", "ranges"], ["Sort", "sorts"], ["Unique key", "keys"]])
      boxes.append(check(label, key, full[key].includes(c.name)));
    flags.append(boxes);
    const remove = node("td"), button = node("button", "Remove", { type: "button", class: "small" });
    button.addEventListener("click", () => work("Updating mapping…", async () => {
      const current = readMapping(), removed = current.columns.splice(index, 1)[0];
      for (const key of ["filters", "ranges", "sorts", "keys"]) current[key] = current[key].filter(name => name !== removed.name);
      renderMapping(current); notify("Column removed from the editable mapping.");
    }));
    const applyMode = () => {
      const scalar = mode.value === "scalar";
      type.disabled = !scalar; nullable.querySelector("input").disabled = !scalar;
      if (!scalar) { type.value = "string"; nullable.querySelector("input").checked = false; }
    };
    mode.addEventListener("change", applyMode); applyMode();
    remove.append(button); row.append(types, nulls, flags, remove); target.append(row);
  }
}
function readMapping() {
  const plan = defaultPlan(); plan.name = $("mapping-name").value; plan.recordPath = recordPath();
  for (const row of $("columns-body").children) {
    const get = key => row.querySelector('[data-key="' + key + '"]');
    let path;
    try { path = JSON.parse(get("path").value); } catch { throw new Error("Column " + get("name").value + ": path must be a JSON array."); }
    const column = { name: get("name").value, path, mode: get("mode").value, type: get("type").value,
      nullable: get("nullable").checked, missing: get("missing").value };
    plan.columns.push(column);
    for (const key of ["filters", "ranges", "sorts", "keys"]) if (get(key).checked) plan[key].push(column.name);
  }
  for (const [id, key] of [["max-rows", "maxRows"], ["max-bytes", "maxBytes"], ["max-cell", "maxCellChars"],
    ["default-limit", "defaultLimit"], ["max-limit", "maxLimit"]]) plan[key] = Number($(id).value);
  plan.allowEmpty = $("allow-empty").checked; return plan;
}
async function loadPlan() {
  const id = requireValue("plan-select", "a mapping"), result = await api("/api/plan?id=" + encodeURIComponent(id));
  renderMapping(result.plan); $("mapping-status").textContent = "Editing a copy of retained mapping " + id;
  notify("Retained mapping loaded. Saving changes creates a new immutable mapping.");
}
async function selectBuild() {
  const id = requireValue("build-select", "an edition"), build = state.builds.find(b => b.id === id);
  selectedPlan = (await api("/api/plan?id=" + encodeURIComponent(build.plan))).plan;
  details($("build-detail"), [["Rows", fmt(build.rowCount)], ["Build", build.id], ["Source", build.source], ["Mapping", build.plan],
    ["Native snapshot", build.native.snapshot], ["Edition keys", build.keys.join(", ") || "None"],
    ["Null counts", build.columns.filter(c => c.nullValues).map(c => c.column + ": " + c.nullValues).join(", ") || "None"]]);
  $("query-limit").value = selectedPlan.defaultLimit; $("query-limit").max = selectedPlan.maxLimit;
  $("query-sort").replaceChildren(node("option", "Original record order", { value: "" }));
  for (const name of selectedPlan.sorts) {
    $("query-sort").append(node("option", name + " ascending", { value: name }), node("option", name + " descending", { value: "-" + name }));
  }
  $("query-filters").replaceChildren();
  for (const [prefix, names] of [["where_", selectedPlan.filters], ["gte_", selectedPlan.ranges], ["lte_", selectedPlan.ranges]]) {
    for (const name of names) {
      const label = node("label", name + (prefix === "where_" ? " equals" : prefix === "gte_" ? " minimum" : " maximum"));
      label.append(node("input", undefined, { "data-param": prefix + name, placeholder: "No constraint" }));
      $("query-filters").append(label);
    }
  }
  nextCursor = null; lastQuery = null; $("query-next").disabled = true;
  $("query-output").replaceChildren(); $("query-detail").textContent = "Queries use the original native dataset engine and its cursor semantics.";
}
function queryParams() {
  let extra;
  try { extra = JSON.parse($("query-extra").value); } catch { throw new Error("Additional native parameters must be a JSON object."); }
  if (!extra || Array.isArray(extra) || typeof extra !== "object" || Object.values(extra).some(v => typeof v !== "string"))
    throw new Error("Every native parameter must have one string value.");
  const query = { limit: $("query-limit").value, ...extra };
  if ($("query-fields").value) query.fields = $("query-fields").value;
  if ($("query-sort").value) query.sort = $("query-sort").value;
  for (const input of $("query-filters").querySelectorAll("input")) if (input.value !== "") query[input.dataset.param] = input.value;
  return query;
}
async function runQuery(next = false) {
  const build = requireValue("build-select", "a completed edition");
  const query = next ? { ...lastQuery, cursor: nextCursor } : queryParams();
  const result = await api("/api/query", { body: { build, query } }), response = result.response;
  if (response.status !== 200) throw new Error(response.body.message || response.body.error || "Native query was not admitted.");
  const body = response.body;
  lastQuery = { ...query }; delete lastQuery.cursor;
  nextCursor = body.page.nextCursor; $("query-next").disabled = !nextCursor;
  table($("query-output"), body.fields || Object.keys(body.rows[0] || {}), body.rows);
  $("query-detail").textContent = "Returned " + fmt(body.page.returned) + " of " + fmt(body.page.total) + " matching rows. Snapshot " + result.dataset.snapshot + (nextCursor ? " · More records available." : " · End of selection.");
  notify("Native query completed.");
}
async function showComparison(offset) {
  const id = requireValue("comparison-select", "a retained comparison"), c = state.comparisons.find(x => x.id === id);
  const summary = $("comparison-summary"); summary.replaceChildren();
  const stats = node("div", undefined, { class: "stat-row" });
  for (const key of ["added", "removed", "changed", "unchanged"]) {
    const stat = node("div"); stat.append(node("strong", fmt(c.counts[key])), node("span", key)); stats.append(stat);
  }
  summary.append(stats, node("p", c.semantics, { class: "hint" }));
  const result = await api("/api/changes?" + new URLSearchParams({ id, offset: String(offset), limit: "50" }));
  table($("changes-output"), ["kind", "key", "fields", "before", "after"], result.rows);
  changesOffset = result.nextOffset; $("changes-next").disabled = changesOffset === null; $("changes-download").disabled = false;
}
listen("refresh", "click", "Refreshing retained workspace…", async () => { await refresh(); notify("Workspace refreshed."); });
listen("source-form", "submit", "Reading and retaining the complete source…", async () => {
  const file = $("source-file").files[0];
  if (!file) throw new Error("Choose a JSON Lines file.");
  const result = await api("/api/source", { raw: file, headers: { "Content-Type": "application/x-ndjson",
    "X-NDJSON-Name": encodeURIComponent(file.name), "X-NDJSON-Label": encodeURIComponent($("source-label").value || file.name) } });
  await refresh({ source: result.id }); notify("Retained " + fmt(result.inventory.records) + " records with the complete original file.");
});
listen("source-select", "change", "Loading source inventory…", async () => { await inspectSource(); notify("Full-source inventory loaded."); });
listen("import-form", "submit", "Reconstructing the original source project…", async () => {
  const file = $("import-file").files[0]; if (!file) throw new Error("Choose a source project ZIP.");
  const result = await api("/api/import", { raw: file, headers: { "Content-Type": "application/zip" } });
  const build = result.build || result;
  await refresh({ source: build.source, plan: build.plan, build: build.id }); notify("Source project reconstructed through the original dataset engine.");
});
$("inventory-filter").addEventListener("input", () => { inventoryLimit = 100; drawInventory(); });
$("inventory-more").addEventListener("click", () => { inventoryLimit += 100; drawInventory(); });
listen("load-plan", "click", "Loading retained mapping…", loadPlan);
listen("new-plan", "click", "Starting a new mapping…", async () => { renderMapping(defaultPlan()); notify("New mapping ready for field selection."); });
listen("add-column", "click", "Adding a mapping column…", async () => {
  const plan = readMapping(); if (plan.columns.length >= 64) throw new Error("A mapping exposes at most 64 columns.");
  plan.columns.push({ name: uniqueName(plan, "field"), path: [], type: "string", mode: "scalar", nullable: false, missing: "error" });
  renderMapping(plan); notify("Choose the column's exact path, mode and native capabilities.");
});
listen("map-scalars", "click", "Adding scalar fields from the complete inventory…", async () => {
  if (!sourceView) throw new Error("Retain or select a source first.");
  const plan = readMapping(); let added = 0;
  for (const field of sourceView.inventory.paths) {
    const path = relativePath(field.path);
    if (!path || path.includes(null) || Object.keys(field.types).some(t => ["object", "array"].includes(t)) ||
        plan.columns.some(c => JSON.stringify(c.path) === JSON.stringify(path))) continue;
    const state = field.records < sourceView.inventory.records || !!field.types.null;
    if (plan.columns.length + (state ? 2 : 1) > 64) break;
    addField(plan, field, path, "scalar", state); added++;
  }
  renderMapping(plan); notify("Added " + added + " scalar fields. Review names, exact types and exposure capabilities before saving.");
});
listen("mapping-file", "change", "Loading mapping JSON…", async () => {
  const file = $("mapping-file").files[0]; if (!file) return;
  if (file.size > 65536) throw new Error("Mapping exceeds 64 KiB.");
  const plan = JSON.parse(await file.text());
  if (plan.schema !== "stellar-forge.ndjson-mapping.v1" || !Array.isArray(plan.columns)) throw new Error("Choose a Stellar Forge NDJSON mapping.");
  renderMapping(plan); notify("Mapping loaded for review. Save it to retain its immutable identity.");
});
listen("download-plan", "click", "Preparing mapping JSON…", async () => {
  download(new Blob([JSON.stringify(readMapping(), null, 2) + "\n"], { type: "application/json" }), "ndjson-mapping.json"); notify("Editable mapping downloaded.");
});
listen("mapping-form", "submit", "Validating and retaining the exposure policy…", async () => {
  const result = await api("/api/plan", { body: readMapping() }); renderMapping(result.plan);
  await refresh({ plan: result.id }); $("mapping-status").textContent = "Retained mapping SHA-256: " + result.id;
  notify("Immutable mapping saved. Build a complete edition from the selected source.");
});
listen("build-form", "submit", "Projecting the complete source and loading the original engine…", async () => {
  const result = await api("/api/build", { body: { source: requireValue("build-source", "a source"), plan: requireValue("build-plan", "a mapping") } });
  await refresh({ build: result.id }); notify("Completed edition retained with " + fmt(result.rowCount) + " original-engine rows.");
});
listen("build-select", "change", "Loading the completed edition…", async () => { await selectBuild(); notify("Edition ready to query."); });
listen("query-form", "submit", "Querying the original dataset engine…", () => runQuery(false));
listen("query-next", "click", "Reading the next native page…", () => runQuery(true));
listen("compare-form", "submit", "Comparing all keyed records…", async () => {
  const result = await api("/api/compare", { body: { before: requireValue("compare-before", "the earlier edition"), after: requireValue("compare-after", "the later edition") } });
  await refresh({ comparison: result.id }); notify("Complete keyed comparison retained.");
});
listen("comparison-select", "change", "Loading retained comparison…", async () => { await showComparison(0); notify("Comparison loaded."); });
listen("changes-next", "click", "Reading the next changes…", async () => { await showComparison(changesOffset); notify("Next changes loaded."); });
listen("changes-download", "click", "Preparing complete changes download…", async () => {
  const id = requireValue("comparison-select", "a comparison");
  download(await api("/api/changes/download?id=" + encodeURIComponent(id), { download: true }), "ndjson-edition-changes.jsonl"); notify("Complete changes file downloaded.");
});
for (const [id, route, name] of [["export-project", "/api/export", "ndjson-project.zip"], ["export-dataset", "/api/dataset-export", "sf30-dataset.zip"]]) {
  listen(id, "click", "Preparing the complete edition export…", async () => {
    download(await api(route + "?build=" + encodeURIComponent(requireValue("export-build", "an edition")), { download: true }), name); notify("Complete edition export downloaded.");
  });
}
listen("merchant-form", "submit", "Preparing the original merchant and generated customer SDK…", async () => {
  const payment = JSON.parse($("merchant-payment").value);
  const blob = await api("/api/merchant", { download: true, body: { build: requireValue("merchant-build", "a reviewed edition"),
    payment, origin: $("merchant-origin").value, path: $("merchant-path").value } });
  download(blob, "ndjson-merchant.zip"); notify("Complete merchant, original source and generated customer SDK downloaded.");
});
renderMapping(defaultPlan());
if (!token) notify("Open the private console link printed by the running NDJSON workspace.", true);
else work("Opening retained NDJSON workspace…", async () => { await refresh(); notify("Workspace ready. Start with a complete JSON Lines export or import an existing source project."); });

