// MIT. Private FHIR Bulk Data operator. Original JSON is rendered as text.
const $ = (selector, root = document) => root.querySelector(selector);
const clone = value => structuredClone(value);
const enc = value => encodeURIComponent(String(value));
const format = value => value == null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
const json = value => JSON.stringify(value, null, 2);
const words = value => String(value ?? "").replaceAll("_", " ");
const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "—";
const bytes = value => value == null ? "—" : Number(value) < 1024 ? value + " B" : Number(value) < 1048576 ? (Number(value) / 1024).toFixed(1) + " KiB" : (Number(value) / 1048576).toFixed(1) + " MiB";
const when = value => value ? new Date(value).toLocaleString() : "—";
const list = value => Array.isArray(value) ? value : [];
const nonempty = value => value === "" ? null : value;
const lines = value => String(value ?? "").split(/\r?\n/).filter(value => value !== "");
const code = value => h("code", {}, format(value));
const uid = () => crypto.randomUUID();
const terminal = value => ["complete", "failed", "cancelled", "kickoff_unknown", "cancel_unknown"].includes(value);
let fieldSerial = 0;
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class") node.className = value;
    else if (key === "value") node.value = value;
    else if (["checked", "disabled", "hidden", "selected", "multiple", "required"].includes(key)) node[key] = !!value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
function field(label, value, set, options = {}) {
  const id = "f-" + ++fieldSerial;
  let input;
  const common = {id, "data-field": options.key || label, required: !!options.required, disabled: !!options.disabled};
  if (options.choices) {
    input = h("select", common, options.choices.map(choice => {
      const item = typeof choice === "object" ? choice : {value: choice, label: words(choice)};
      return h("option", {value: item.value}, item.label);
    }));
    input.value = value == null ? "" : String(value);
  } else if (options.multiline) {
    input = h("textarea", {...common, rows: options.rows || 3, spellcheck: false, class: options.mono ? "mono" : "", placeholder: options.placeholder});
    input.value = value ?? "";
  } else {
    input = h("input", {...common, type: options.type || "text", value: value ?? "", min: options.min, max: options.max, step: options.step, placeholder: options.placeholder, autocomplete: "off", spellcheck: false});
  }
  if (set) input.addEventListener(options.choices ? "change" : "input", () => {
    const next = options.type === "number" ? (input.value === "" ? null : Number(input.value)) : input.value;
    set(next); saveModel();
  });
  return h("div", {class: "field" + (options.full ? " full" : "")}, h("label", {for: id}, label), input,
    options.help ? h("p", {class: "help"}, options.help) : null);
}
function check(label, checked, set, options = {}) {
  const input = h("input", {type: "checkbox", checked, disabled: !!options.disabled, "data-field": options.key || label});
  input.addEventListener("change", () => {set(input.checked); saveModel();});
  return h("label", {class: "check"}, input, h("span", {}, label, options.help ? h("small", {}, " · " + options.help) : null));
}
function action(label, callback, options = {}) {
  return h("button", {type: "button", class: options.primary ? "primary" : options.quiet ? "quiet" : options.danger ? "danger" : "", disabled: !!options.disabled, "data-action": options.key || label,
    onclick: () => task(label, callback)}, label);
}
function submit(label, options = {}) {
  return h("button", {type: "submit", class: options.primary === false ? "" : "primary", disabled: !!options.disabled, "data-action": options.key || label}, label);
}
function form(label, callback, ...children) {
  return h("form", {"aria-label": label, onsubmit: event => {event.preventDefault(); task(label, callback);}}, ...children);
}
const actions = (...children) => h("div", {class: "actions"}, children);
const panel = (title, ...children) => h("section", {class: "panel"}, title ? h("h3", {}, title) : null, children);
const empty = message => h("p", {class: "empty"}, message);
function heading(title, description, ...buttons) {
  return h("div", {class: "page-heading"}, h("div", {}, h("h2", {}, title), h("p", {}, description)), buttons.length ? h("div", {class: "actions inline"}, buttons) : null);
}
function kv(entries) {
  return h("dl", {class: "kv"}, entries.flatMap(([name, value]) => [h("dt", {}, name), h("dd", {}, value instanceof Node ? value : format(value))]));
}
function metrics(entries) {
  return h("div", {class: "metrics"}, entries.map(([label, value]) => h("div", {class: "metric"}, h("span", {class: "label"}, label), h("span", {class: "value"}, value))));
}
function detail(title, content, open = false) {
  return h("details", {open: open ? "" : null}, h("summary", {}, title), content instanceof Node ? content : h("pre", {}, typeof content === "string" ? content : json(content)));
}
function table(headers, rows, options = {}) {
  if (!rows.length) return empty(options.empty || "No retained rows.");
  return h("div", {class: "table-wrap"}, h("table", {},
    options.caption ? h("caption", {}, options.caption) : null,
    h("thead", {}, h("tr", {}, headers.map(item => h("th", {scope: "col"}, item)))),
    h("tbody", {}, rows.map(row => h("tr", {}, row.map(value => h("td", {class: value instanceof Node ? "" : "value"}, value instanceof Node ? value : format(value))))))));
}
function inspect(title, ...content) {
  $("#inspect-title").textContent = title;
  $("#inspect-content").replaceChildren(...content.filter(item => item != null).map(item => item instanceof Node ? item : h("pre", {}, typeof item === "string" ? item : json(item))));
  const dialog = $("#inspect-dialog");
  if (!dialog.open) dialog.showModal();
}
function notice(message, isError = false) {
  const node = $("#notice");
  node.hidden = !message;
  node.setAttribute("role", isError ? "alert" : "status");
  node.textContent = message || "";
}
let catalogue, state, profiles = [], db, workspaceKey, model, pending = null, renderGeneration = 0, taskCount = 0;
let writeTail = Promise.resolve(), autoTimer = null, acquisitionBusy = false, commandBusy = false;
const cache = {sources: new Map(), builds: new Map(), plans: new Map(), operations: new Map(), discoveries: new Map(), groups: new Map()};
const authKey = "sf30.fhir.private-capability";
const suppliedToken = location.hash.slice(1);
if (suppliedToken) {
  sessionStorage.setItem(authKey, suppliedToken);
  history.replaceState(null, "", location.pathname);
}
const token = sessionStorage.getItem(authKey);
async function api(path, {method = "GET", body, raw, headers = {}, download = false} = {}) {
  const init = {method, cache: "no-store", credentials: "omit", mode: "same-origin", redirect: "error",
    headers: {Authorization: "Bearer " + token, ...headers}};
  if (raw !== undefined) {init.body = raw; init.headers["Content-Type"] ||= "application/zip";}
  else if (body !== undefined) {init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json";}
  let response;
  try {response = await fetch(path, init);}
  catch (cause) {const error = new Error("The response did not arrive. Reopen the same retained operation or retry the saved request."); error.cause = cause; throw error;}
  if (!response.ok) {
    let data;
    try {data = await response.json();} catch {data = {error: "Local HTTP " + response.status};}
    const error = new Error(data.error || "Local HTTP " + response.status);
    error.status = response.status; error.data = data; throw error;
  }
  return download ? response : response.json();
}
async function download(path, filename) {
  const response = await api(path, {download: true});
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = h("a", {href: url, download: filename});
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("stellar-forge-fhir-bulk-operator", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("retained", {keyPath: "key"});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function localGet(key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("retained", "readonly");
    const request = transaction.objectStore("retained").get(key);
    request.onsuccess = () => resolve(request.result?.value ?? null);
    request.onerror = () => reject(request.error);
  });
}
function localPut(key, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("retained", "readwrite");
    const store = transaction.objectStore("retained");
    value === undefined ? store.delete(key) : store.put({key, value});
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("The browser could not retain the request."));
  });
}
function saveModel() {
  if (!db || !workspaceKey || !model) return Promise.resolve();
  const key = workspaceKey + ":model", snapshot = clone(model);
  writeTail = writeTail.catch(() => {}).then(() => localPut(key, snapshot));
  writeTail.catch(error => notice("Browser draft storage failed: " + error.message, true));
  return writeTail;
}
function freshModel() {
  return {section: "overview", connectionId: "", discoveryId: "", groupPageId: "", exportId: "", operationId: "", sourceId: "", resourceType: "", planId: "", buildId: "", comparisonId: "",
    connectionDraft: {...clone(catalogue.connectionDefaults), label: "", baseUrl: ""},
    exportDraft: {connectionId: "", label: "", scope: "system", groupId: null, method: "GET", parameters: clone(catalogue.parameterDefaults), limits: {maxBytes: catalogue.limits.maxBytes, maxFiles: catalogue.limits.maxFiles, maxLineBytes: catalogue.limits.maxLineBytes}, note: ""},
    mappingDraft: null, sourceReview: {kind: "output", offset: 0, limit: 50, query: "", previousOffsets: []},
    query: {rows: [], sort: [], fields: [], limit: 50, cursor: "", previous: []},
    composition: {baseSourceId: "", deltaSourceIds: [], label: "", resolutions: []},
    compare: {beforeId: "", afterId: "", offset: 0, limit: 50, previousOffsets: []},
    autoOperation: null, cancelReview: null, lastResult: null};
}
function pendingView() {
  const box = $("#pending");
  box.hidden = !pending;
  if (!pending) {box.replaceChildren(); return;}
  box.replaceChildren(h("strong", {}, pending.label), h("p", {}, "This exact request is saved in this browser. Its original input will be reused when you retry."),
    pending.error ? h("p", {}, pending.error) : null,
    actions(action("Retry saved request", resumePending, {primary: true, disabled: acquisitionBusy}),
      action("Return to draft", async () => {
        if (commandBusy || acquisitionBusy) throw new Error("The original request is still being received.");
        model.autoOperation = null; clearTimeout(autoTimer); await saveModel();
        await localPut(workspaceKey + ":pending", undefined);
        if (pending.fileKey) await localPut(pending.fileKey, undefined);
        pending = null; pendingView(); notice("The saved browser request was cleared. Retained server operations remain available.");
      }, {disabled: acquisitionBusy})),
    detail("Saved request details", {label: pending.label, route: pending.route, createdAt: pending.createdAt, input: pending.body, file: pending.fileName}));
}
async function applyReply(saved, result) {
  const type = saved.after?.type;
  if (type === "connection") {model.connectionId = result.id; model.exportDraft.connectionId = result.id;}
  if (type === "export") {model.exportId = result.id; model.operationId = "";}
  if (type === "source" || type === "composition") {
    model.sourceId = result.source?.id || result.id; model.resourceType = ""; model.sourceReview.offset = 0; model.sourceReview.previousOffsets = [];
    model.section = "sources"; cache.sources.delete(model.sourceId);
  }
  if (type === "plan") {model.planId = result.id;}
  if (type === "build" || type === "packet") {
    model.buildId = result.build?.id || result.id; model.section = "datasets";
    if (typeof result.source === "string") model.sourceId = result.source;
    else if (result.source?.id) model.sourceId = result.source.id;
    if (typeof result.plan === "string") model.planId = result.plan;
  }
  if (type === "comparison") {model.comparisonId = result.id; model.compare.offset = 0; model.compare.previousOffsets = [];}
  if (type === "operation") {
    model.operationId = result.operationId; cache.operations.set(result.operationId, result);
    if (result.sourceId) {model.sourceId = result.sourceId; cache.sources.delete(result.sourceId);}
  }
  model.lastResult = {kind: type, id: result.id || result.operationId || result.workspaceId, at: new Date().toISOString()};
  await saveModel();
}
async function sendSaved(saved) {
  const raw = saved.fileKey ? await localGet(saved.fileKey) : undefined;
  if (saved.fileKey && !raw) throw new Error("The original upload is not available in browser storage. Select that same file again.");
  try {
    const result = await api(saved.route, {method: "POST", body: saved.body, raw, headers: saved.headers || {}});
    await applyReply(saved, result);
    await localPut(workspaceKey + ":pending", undefined);
    if (saved.fileKey) await localPut(saved.fileKey, undefined);
    pending = null; pendingView();
    await refreshState();
    notice(saved.label + " completed.");
    return result;
  } catch (error) {
    saved.error = error.message; saved.httpStatus = error.status || null;
    pending = saved; await localPut(workspaceKey + ":pending", saved); pendingView();
    throw error;
  }
}
async function command(label, route, body, after = {}, file = null, headers = {}) {
  if (commandBusy) throw new Error("The original request is still being received.");
  if (pending) throw new Error("Retry or return to the saved request before beginning another write.");
  commandBusy = true;
  try {
  const saved = {id: uid(), label, route, body: body === undefined ? undefined : clone(body), after, headers, createdAt: new Date().toISOString()};
  if (file) {
    saved.fileKey = workspaceKey + ":upload:" + saved.id; saved.fileName = file.name;
    await localPut(saved.fileKey, file);
  }
  await localPut(workspaceKey + ":pending", saved);
  pending = saved; pendingView();
  return await sendSaved(saved);
  } finally {commandBusy = false;}
}
async function resumePending() {
  if (!pending || commandBusy) return;
  commandBusy = true;
  try {
    const result = await sendSaved(clone(pending));
    await render();
    if (model.autoOperation) setTimeout(() => task("Continue original export", autoTick), 0);
    return result;
  } finally {commandBusy = false;}
}
async function task(label, callback) {
  taskCount++; $("#connection-state").textContent = label + "…";
  try {const value = await callback(); return value;}
  catch (error) {
    notice(error.message || String(error), true);
    if (error.data?.receipt) inspect("Provider response", error.data);
  } finally {
    taskCount--; $("#connection-state").textContent = taskCount ? "Working…" : "Private workspace connected";
  }
}
function connections() {return list(state?.connections);}
function exportsList() {return list(state?.exports);}
function sources() {return list(state?.sources);}
function builds() {return list(state?.builds);}
function plans() {return list(state?.plans);}
const findConnection = id => connections().find(row => row.id === id)?.connection;
const sourceLabel = id => sources().find(row => row.id === id)?.label || id || "No source selected";
const buildLabel = id => {const item = builds().find(row => row.id === id); return item ? ((plans().find(plan => plan.id === item.plan)?.name || item.name || "Dataset") + " · " + count(item.rowCount) + " rows · " + id.slice(0, 10)) : id || "No dataset selected";};
const optionRows = (rows, label, emptyLabel) => [{value: "", label: emptyLabel}, ...rows.map(row => ({value: row.id, label: label(row)}))];
async function refreshState() {
  state = await api("/api/state");
  const nextKey = "workspace:" + state.workspaceId;
  if (workspaceKey !== nextKey) {
    workspaceKey = nextKey;
    model = await localGet(workspaceKey + ":model") || freshModel();
    pending = await localGet(workspaceKey + ":pending");
  }
  $("#workspace-label").textContent = "Workspace " + String(state.workspaceId).slice(0, 12);
  pendingView(); return state;
}
async function cached(kind, id, path) {
  if (!id) return null;
  if (!cache[kind].has(id)) cache[kind].set(id, await api(path));
  return cache[kind].get(id);
}
async function getSource(id = model.sourceId) {return cached("sources", id, "/api/sources/" + enc(id));}
async function getBuild(id = model.buildId) {return cached("builds", id, "/api/builds/" + enc(id));}
async function getPlan(id = model.planId) {return (await cached("plans", id, "/api/plans/" + enc(id)))?.plan;}
async function navigate(section) {
  model.section = section; await saveModel(); await render(); $("#main").focus();
}
async function render() {
  const generation = ++renderGeneration;
  $("#content").setAttribute("aria-busy", "true");
  for (const button of document.querySelectorAll("[data-section]")) {
    if (button.dataset.section === model.section) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  }
  $("#selection-context").replaceChildren(h("p", {}, h("strong", {}, "Source"), sourceLabel(model.sourceId)),
    h("p", {}, h("strong", {}, "Dataset"), buildLabel(model.buildId)),
    model.operationId ? h("p", {}, h("strong", {}, "Export operation"), code(model.operationId)) : "");
  const views = {overview: overviewView, exports: exportsView, sources: sourcesView, mapping: mappingView, datasets: datasetsView, query: queryView, compare: compareView, delivery: deliveryView};
  const content = await (views[model.section] || overviewView)();
  if (generation !== renderGeneration) return;
  const fragment = document.createDocumentFragment();
  fragment.append(...(Array.isArray(content) ? content : [content]));
  model.disclosures ||= {};
  const occurrences = {};
  for (const node of fragment.querySelectorAll("details")) {
    const title = node.querySelector(":scope > summary")?.textContent || "";
    const ordinal = occurrences[title] || 0; occurrences[title] = ordinal + 1;
    const key = model.section + ":" + title + ":" + ordinal;
    node.dataset.disclosureKey = key;
    if (Object.hasOwn(model.disclosures, key)) node.open = model.disclosures[key];
  }
  $("#content").replaceChildren(fragment);
  $("#content").setAttribute("aria-busy", "false");
}
async function overviewView() {
  const running = list(state.operations).filter(item => !["complete", "failed", "cancelled"].includes(item.state));
  return [
    heading("Workspace overview", "Acquire original FHIR Bulk Data, review an explicit projection and operate the same native dataset through delivery.",
      action("Connect a server", () => navigate("exports"), {primary: true}), action("Receive a workspace", () => navigate("delivery"))),
    metrics([["Connections", count(connections().length)], ["Original captures", count(sources().length)], ["Dataset editions", count(builds().length)], ["Open exports", count(running.length)]]),
    panel("Continue retained work", table(["Work", "Details", "Action"], [
      ...running.map(item => ["Server export", h("div", {}, h("strong", {}, words(item.state)), h("p", {class: "muted"}, item.progress || item.phase), code(item.operationId)),
        action("Open export", async () => {model.operationId = item.operationId; model.exportId = item.exportId; await navigate("exports");})]),
      ...builds().slice(0, 5).map(item => ["Dataset edition", buildLabel(item.id), action("Open dataset", async () => {model.buildId = item.id; await navigate("datasets");})]),
      ...sources().slice(0, 5).map(item => ["Original source", item.label, action("Inspect source", async () => {model.sourceId = item.id; model.resourceType = ""; await navigate("sources");})])
    ], {empty: "Connect a FHIR server or receive an existing complete source, dataset packet or editable workspace."})),
    panel("Operating flow",
      h("ol", {}, h("li", {}, "Connect to a server and retain its CapabilityStatement and available Groups."),
        h("li", {}, "Review a native system, patient or Group export and receive its original files."),
        h("li", {}, "Inspect source resources, exact field values, provider outcomes and explicit deletions."),
        h("li", {}, "Choose the dataset columns, value encoding and query keys, then build the native dataset."),
        h("li", {}, "Compare dataset editions, compose retained resource state and export the intended delivery."))),
    panel("Source and protocol", h("p", {}, "Source classification follows the selected publisher and original captures. Export filters and timing use the selected server's published Bulk Data contract."),
      table(["Protocol", "Published source"], catalogue.protocols.map(item => [item.label, h("a", {href: item.source, target: "_blank", rel: "noreferrer"}, item.source)])),
      detail("Workspace identity", {workspaceId: state.workspaceId, schema: state.schema, apiVersion: catalogue.apiVersion}))
  ];
}
function connectionEditor() {
  const draft = model.connectionDraft;
  return panel("Connection",
    form("Save connection", async () => {
      const result = await command("Save connection", "/api/connections", draft, {type: "connection"});
      model.connectionDraft = clone(result.connection); await saveModel(); await render();
    },
      h("div", {class: "field-grid"},
        field("Connection name", draft.label, value => draft.label = value, {required: true, key: "connection-label"}),
        field("FHIR base URL", draft.baseUrl, value => draft.baseUrl = value, {type: "url", required: true, key: "connection-url", help: "Use the FHIR base, without /$export. HTTPS is required except for a loopback server."}),
        field("Bulk Data protocol", draft.protocol, value => draft.protocol = value, {choices: catalogue.protocols, key: "connection-protocol"}),
        field("Authentication profile", draft.authProfile || "", value => draft.authProfile = nonempty(value),
          {choices: [{value: "", label: "No configured authentication"}, ...profiles.map(item => ({value: item.name, label: item.name + " · " + item.type}))], key: "connection-auth", help: "Profiles are configured in the server's local credentials file."}),
        field("Source classification", draft.origin, value => draft.origin = value, {choices: catalogue.sourceOrigins, key: "connection-origin"}),
        field("Publisher or source owner", draft.publisher, value => draft.publisher = value, {key: "connection-publisher"}),
        field("Original source description URL", draft.sourceUrl, value => draft.sourceUrl = value, {type: "url", full: true, key: "connection-source-url"}),
        field("Connection notes", draft.note, value => draft.note = value, {multiline: true, full: true, key: "connection-note"})),
      actions(submit("Save connection"), ...catalogue.examples.map(example => action("Use " + example.label, async () => {
        model.connectionDraft = clone(example.connection); await saveModel(); await render();
      })))),
    connections().length ? table(["Saved connection", "FHIR base", "Protocol", "Action"], connections().map(item => [
      item.connection.label, item.connection.baseUrl, item.connection.protocol.toUpperCase(),
      action("Select connection", async () => {
        model.connectionId = item.id; model.connectionDraft = clone(item.connection); model.exportDraft.connectionId = item.id;
        model.discoveryId = ""; model.groupPageId = ""; await saveModel(); await render();
      })])) : null);
}
async function discoveryPanel() {
  const connection = findConnection(model.connectionId);
  if (!connection) return panel("Capabilities and Groups", empty("Save or select a connection to read its published capabilities."));
  const observed = list(state.discoveries).filter(item => item.connectionId === model.connectionId);
  const pages = list(state.groupPages).filter(item => item.connectionId === model.connectionId);
  const selectedDiscovery = observed.find(item => item.id === model.discoveryId) || observed[0];
  if (selectedDiscovery) model.discoveryId = selectedDiscovery.id;
  const discovery = selectedDiscovery ? await cached("discoveries", selectedDiscovery.id, "/api/discoveries/" + enc(selectedDiscovery.id)) : null;
  const selectedPage = pages.find(item => item.id === model.groupPageId) || pages[0];
  if (selectedPage) model.groupPageId = selectedPage.id;
  const groups = selectedPage ? await cached("groups", selectedPage.id, "/api/group-pages/" + enc(selectedPage.id)) : null;
  return panel("Capabilities and Groups", kv([["Selected server", connection.label], ["FHIR base", connection.baseUrl]]),
    actions(action("Read capabilities", async () => {
      const value = await api("/api/connections/" + enc(model.connectionId) + "/discover", {method: "POST", body: {}});
      model.discoveryId = value.id; cache.discoveries.set(value.id, value); await refreshState(); await saveModel(); await render();
    }, {primary: true}),
    action("Read Groups", async () => {
      const value = await api("/api/connections/" + enc(model.connectionId) + "/groups", {method: "POST", body: {url: null}});
      model.groupPageId = value.id; cache.groups.set(value.id, value); await refreshState(); await saveModel(); await render();
    })),
    observed.length ? field("Retained discovery", model.discoveryId, value => {model.discoveryId = value; task("Open discovery", render);},
      {choices: observed.map(item => ({value: item.id, label: when(item.createdAt) + " · FHIR " + item.fhirVersion}))}) : null,
    discovery ? h("div", {}, h("h4", {}, "Observed FHIR " + discovery.fhirVersion),
      h("p", {}, list(discovery.resourceTypes).map(item => typeof item === "string" ? item : item.type).join(", ") || "No resource types were advertised."),
      detail("Advertised operations", discovery.operations),
      detail("Original CapabilityStatement", discovery.capability?.jsonText || ""),
      detail("Original SMART discovery", discovery.smart?.jsonText || ""),
      detail("Discovery files and HTTP identity", discovery.receipts)) : empty("Read the server to retain its actual capability response."),
    pages.length ? field("Retained Group page", model.groupPageId, value => {model.groupPageId = value; task("Open Group page", render);},
      {choices: pages.map(item => ({value: item.id, label: when(item.createdAt) + " · " + count(item.count) + " Groups"}))}) : null,
    groups ? h("div", {}, table(["Group", "Type", "Members", "Action"], list(groups.items).map(item => [
      h("div", {}, h("strong", {}, item.name || item.id), h("p", {class: "muted"}, item.id)), item.type, item.quantity,
      h("div", {class: "actions inline"}, action("Use Group", async () => {
        model.exportDraft.connectionId = model.connectionId; model.exportDraft.scope = "group"; model.exportDraft.groupId = item.id;
        await saveModel(); await render();
      }), action("Inspect Group", () => inspect("Original Group " + item.id, item.jsonText)))
    ])), groups.nextUrl ? actions(action("Read next Group page", async () => {
      const value = await api("/api/connections/" + enc(model.connectionId) + "/groups", {method: "POST", body: {url: groups.nextUrl}});
      model.groupPageId = value.id; cache.groups.set(value.id, value); await refreshState(); await saveModel(); await render();
    })) : null) : null);
}
function exportEditor() {
  const draft = model.exportDraft, parameters = draft.parameters;
  if (!draft.connectionId && model.connectionId) draft.connectionId = model.connectionId;
  const connection = findConnection(draft.connectionId);
  const advanced = h("div", {class: "field-grid"},
    field("Modified after (_since)", parameters.since || "", value => parameters.since = nonempty(value), {key: "export-since", help: "FHIR modification instant with timezone, such as 2026-10-01T00:00:00Z."}),
    field("Modified before (_until)", parameters.until || "", value => parameters.until = nonempty(value), {key: "export-until", help: "STU3 optional parameter. These bounds refer to resource modification, not clinical event dates."}),
    field("Root elements (_elements)", parameters.elements.join("\n"), value => parameters.elements = lines(value), {multiline: true, key: "export-elements", help: "One exact root element token per line, for example Patient.id."}),
    field("Native type filters (_typeFilter)", parameters.typeFilters.join("\n"), value => parameters.typeFilters = lines(value), {multiline: true, mono: true, key: "export-type-filters", help: "One complete ResourceType?query per line. Repeated filters for the same resource type use OR. Each type is filtered independently."}),
    field("Associated data values", parameters.includeAssociatedData.join("\n"), value => parameters.includeAssociatedData = lines(value), {multiline: true, key: "export-associated", help: "One server-supported includeAssociatedData value per line."}),
    field("Explicit Patient references", parameters.patients.join("\n"), value => parameters.patients = lines(value), {multiline: true, key: "export-patients", help: "One relative Patient/id reference per line. Requires POST and a patient or Group export."}),
    field("Organize output by resource", parameters.organizeOutputBy || "", value => parameters.organizeOutputBy = nonempty(value), {key: "export-organize", help: "STU3 optional resource type. Original Parameters headers remain separately inspectable."}),
    field("Unsupported parameter handling", parameters.handling, value => parameters.handling = value, {choices: ["strict", "lenient"], key: "export-handling"}),
    h("div", {class: "full check-grid"}, check("Allow partial manifests", parameters.allowPartialManifests, value => parameters.allowPartialManifests = value, {key: "export-partial"}),
      check("Separate HTTP and export status", parameters.separateExportStatus, value => parameters.separateExportStatus = value, {key: "export-separate"})),
    field("Maximum received bytes", draft.limits.maxBytes, value => draft.limits.maxBytes = value, {type: "number", min: 1, max: catalogue.limits.maxBytes, key: "export-max-bytes"}),
    field("Maximum original files", draft.limits.maxFiles, value => draft.limits.maxFiles = value, {type: "number", min: 1, max: catalogue.limits.maxFiles, key: "export-max-files"}),
    field("Maximum bytes per NDJSON line", draft.limits.maxLineBytes, value => draft.limits.maxLineBytes = value, {type: "number", min: 1, max: catalogue.limits.maxLineBytes, key: "export-max-line"}));
  return panel("Export definition",
    form("Save export definition", async () => {
      const result = await command("Save export definition", "/api/exports", draft, {type: "export"});
      model.exportDraft = clone(result.export);
      delete model.exportDraft.request;
      await saveModel(); await render();
    },
      h("div", {class: "field-grid"},
        field("Export name", draft.label, value => draft.label = value, {required: true, key: "export-label"}),
        field("Saved connection", draft.connectionId, value => {draft.connectionId = value; model.connectionId = value;}, {choices: optionRows(connections(), row => row.connection.label, "Select a connection"), required: true, key: "export-connection"}),
        field("Native export scope", draft.scope, value => {draft.scope = value; task("Update export scope", render);}, {choices: catalogue.scopes, key: "export-scope"}),
        field("HTTP method", draft.method, value => draft.method = value, {choices: catalogue.methods, key: "export-method"}),
        draft.scope === "group" ? field("Original Group id", draft.groupId || "", value => draft.groupId = nonempty(value), {required: true, key: "export-group", help: "Choose a discovered Group or enter its exact native id."}) : null,
        field("Resource types (_type)", parameters.types.join("\n"), value => parameters.types = lines(value), {multiline: true, full: true, key: "export-types", help: "Leave empty for the selected endpoint's full authorized scope. Otherwise enter one exact FHIR resource type per line."}),
        field("Export notes", draft.note, value => draft.note = value, {multiline: true, full: true, key: "export-note"})),
      connection ? h("p", {class: "help"}, "Selected protocol: " + connection.protocol.toUpperCase()) : null,
      detail("Native optional parameters and intake limits", advanced),
      actions(submit("Save export definition"))));
}

async function selectOperation(operationId) {
  if (model.autoOperation?.operationId !== operationId) {model.autoOperation = null; clearTimeout(autoTimer);}
  model.operationId = operationId;
  const operation = await api("/api/operations/" + enc(operationId));
  cache.operations.set(operationId, operation);
  model.exportId = operation.exportId; model.connectionId = operation.connectionId;
  if (operation.sourceId) model.sourceId = operation.sourceId;
  await saveModel(); await render();
}
async function advanceOperation() {
  if (!model.exportId) throw new Error("Select a saved export definition.");
  if (acquisitionBusy) return;
  if (!model.operationId) {
    model.operationId = uid();
    await saveModel();
  }
  const operationId = model.operationId, exportId = model.exportId;
  acquisitionBusy = true;
  try {
    return await command("Advance original export", "/api/exports/" + enc(exportId) + "/advance",
      {operationId}, {type: "operation"});
  } finally {acquisitionBusy = false;}
}
async function autoTick() {
  clearTimeout(autoTimer);
  if (!model.autoOperation || document.hidden || acquisitionBusy || pending) return;
  const original = model.autoOperation;
  let operation = cache.operations.get(original.operationId);
  try {
    if (operation || list(state.operations).some(item => item.operationId === original.operationId)) {
      operation = await api("/api/operations/" + enc(original.operationId));
      cache.operations.set(original.operationId, operation);
    }
  } catch (error) {if (error.status !== 404) {notice(error.message, true); return;}}
  if (operation && terminal(operation.state)) {
    model.autoOperation = null; await saveModel();
    if (operation.sourceId) model.sourceId = operation.sourceId;
    await refreshState();
    if (model.section === "exports") await render();
    return;
  }
  const delay = operation?.notBefore ? Date.parse(operation.notBefore) - Date.now() : 0;
  if (delay > 0) {
    autoTimer = setTimeout(() => task("Continue export", autoTick), Math.min(delay, 60000));
    if (model.section === "exports") await render();
    return;
  }
  const run = async () => {
    if (model.autoOperation?.operationId !== original.operationId) return;
    model.operationId = original.operationId; model.exportId = original.exportId;
    await advanceOperation();
  };
  if (navigator.locks) {
    await navigator.locks.request("sf30-fhir:" + state.workspaceId + ":" + original.operationId, {ifAvailable: true}, async lock => {
      if (lock) await run();
    });
  } else await run();
  if (model.section === "exports") await render();
  if (model.autoOperation?.operationId === original.operationId) autoTimer = setTimeout(() => task("Continue export", autoTick), 500);
}
async function startAuto() {
  if (!model.exportId) throw new Error("Select a saved export definition.");
  if (!model.operationId) model.operationId = uid();
  model.autoOperation = {operationId: model.operationId, exportId: model.exportId};
  await saveModel(); await autoTick();
}
async function pauseAuto() {
  model.autoOperation = null; clearTimeout(autoTimer); await saveModel(); await render();
}
async function operationPanel() {
  if (!model.operationId) return panel("Export operation", empty("Save and review an export definition, then start its original operation."));
  let operation;
  try {
    if (!list(state.operations).some(item => item.operationId === model.operationId)) {const missing = new Error("Prepared browser operation"); missing.status = 404; throw missing;}
    operation = await api("/api/operations/" + enc(model.operationId)); cache.operations.set(model.operationId, operation);
  }
  catch (error) {
    if (error.status !== 404) throw error;
    operation = {operationId: model.operationId, exportId: model.exportId, state: "prepared", phase: "kickoff", files: [], manifests: [], history: [], sourceId: null};
  }
  const isAuto = model.autoOperation?.operationId === operation.operationId;
  const recoverable = ["prepared", "exporting", "waiting", "receiving"].includes(operation.state);
  const completeFiles = list(operation.files).filter(item => item.state === "complete").length;
  const notBefore = operation.notBefore && Date.parse(operation.notBefore) > Date.now();
  const controls = actions(
    action("Continue export", startAuto, {primary: true, disabled: !recoverable || isAuto || !!pending || acquisitionBusy}),
    action("Advance one step", async () => {await advanceOperation(); await render();}, {disabled: !recoverable || isAuto || !!pending || !!notBefore || acquisitionBusy}),
    action("Pause browser polling", pauseAuto, {disabled: !isAuto}),
    action("Refresh operation", () => selectOperation(operation.operationId)),
    operation.sourceId ? action("Inspect received source", async () => {model.sourceId = operation.sourceId; model.resourceType = ""; await navigate("sources");}, {primary: true}) : null,
    operation.statusUrl && !["cancelled", "complete"].includes(operation.state) ? action("Review cancellation", async () => {
      model.cancelReview = operation.operationId; await saveModel(); await render();
    }, {disabled: isAuto || acquisitionBusy}) : null);
  return panel("Original export operation",
    h("div", {class: "status-line"}, h("strong", {class: "status", "data-operation-state": operation.state}, words(operation.state)),
      h("span", {}, operation.progress || words(operation.phase)), isAuto ? h("span", {class: "muted"}, "Continues while this page is visible") : null),
    operation.files.length ? h("progress", {class: "progress", max: operation.files.length, value: completeFiles, "aria-label": "Original files received"}, completeFiles + " of " + operation.files.length) : null,
    kv([["Original operation", code(operation.operationId)], ["Saved export", code(operation.exportId)],
      ["Received files", count(completeFiles) + " / " + count(operation.files.length)],
      ["Received bytes", bytes(list(operation.files).reduce((sum, item) => sum + (item.bytes || 0), 0))],
      ["Next provider request", operation.notBefore ? when(operation.notBefore) : "Ready for the next retained step"],
      ["Provider progress", operation.progress || "—"]]),
    operation.error ? h("div", {class: "notice"}, h("strong", {}, operation.error.message), detail("Original provider outcome", operation.error)) : null,
    controls,
    operation.state === "kickoff_unknown" ? form("Attach original provider status URL", async () => {
      const target = $("#status-adoption");
      await command("Attach original provider status URL", "/api/operations/" + enc(operation.operationId) + "/status",
        {statusUrl: $('[data-field="status-url"]', target).value, reason: $('[data-field="status-reason"]', target).value}, {type: "operation"});
      await render();
    }, h("div", {id: "status-adoption", class: "field-grid"},
      field("Provider status URL", "", null, {type: "url", required: true, full: true, key: "status-url", help: "Paste the original Content-Location from this export's provider response."}),
      field("How this status URL was recovered", "", null, {multiline: true, required: true, full: true, key: "status-reason"})),
      actions(submit("Attach original status URL"))) : null,
    model.cancelReview === operation.operationId ? panel("Cancel this provider export",
      h("p", {}, "This sends the native DELETE request to the retained provider status URL. The provider may remove its export files. Original files already received remain in this workspace."),
      actions(action("Cancel provider export", async () => {
        model.cancelIds ||= {};
        model.cancelIds[operation.operationId] ||= uid();
        await saveModel();
        await command("Cancel provider export", "/api/operations/" + enc(operation.operationId) + "/cancel",
          {requestId: model.cancelIds[operation.operationId]}, {type: "operation"});
        model.cancelReview = null; model.autoOperation = null; await saveModel(); await render();
      }, {danger: true, disabled: !!pending || acquisitionBusy}),
      action("Keep export running", async () => {model.cancelReview = null; await saveModel(); await render();}))) : null,
    table(["Original file", "Kind", "Resource type", "State", "Received", "Rows"], list(operation.files).map(item => [
      code(item.id), item.kind, item.type, words(item.state), bytes(item.bytes), item.lineCount ?? item.count
    ]), {empty: "Files appear as the provider publishes their original manifests."}),
    detail("Retained manifest pages", operation.manifests),
    detail("Original request and status identity", {requestSha256: operation.requestSha256, statusUrl: operation.statusUrl, createdAt: operation.createdAt, updatedAt: operation.updatedAt}),
    detail("Retained operation history", operation.history));
}
async function exportsView() {
  const selected = exportsList().find(item => item.id === model.exportId);
  const definition = selected?.export;
  return [
    heading("Server exports", "Choose the exact native scope and parameters, then receive the provider's original manifests and files."),
    connectionEditor(), await discoveryPanel(), exportEditor(),
    panel("Saved export definitions",
      table(["Export", "Server", "Scope", "Types", "Action"], exportsList().map(item => [
        item.export.label, findConnection(item.export.connectionId)?.label || item.export.connectionId,
        item.export.scope + (item.export.groupId ? " · " + item.export.groupId : ""),
        item.export.parameters.types.length ? item.export.parameters.types.join(", ") : "Full authorized scope",
        action("Review export", async () => {
          model.exportId = item.id; model.connectionId = item.export.connectionId; model.operationId = "";
          model.exportDraft = clone(item.export); delete model.exportDraft.request;
          await saveModel(); await render();
        })
      ])),
      definition ? h("div", {"data-component": "export-request-review"}, h("h4", {}, definition.label),
        kv([["Method", definition.request?.method || definition.method], ["Provider URL", code(definition.request?.url)],
          ["Original request", code(definition.request?.requestSha256)]]),
        detail("Request headers and body", {headers: definition.request?.headers, bodyText: definition.request?.bodyText}),
        actions(action("Start original export", async () => {
          if (model.operationId) throw new Error("Open the retained operation before starting another export.");
          model.operationId = uid(); await saveModel(); await startAuto();
        }, {primary: true, disabled: !!model.operationId || !!pending || acquisitionBusy}),
        action("Prepare another operation", async () => {
          await pauseAuto(); model.operationId = ""; await saveModel(); await render();
        }, {disabled: !model.operationId || acquisitionBusy}))) : empty("Select a saved definition to review the exact provider request.")),
    panel("Retained export operations", table(["Export", "State", "Progress", "Updated", "Action"], list(state.operations).slice().reverse().map(item => [
      h("div", {"data-operation-id": item.operationId}, h("strong", {}, exportsList().find(exported => exported.id === item.exportId)?.export.label || item.exportId), h("p", {class: "mono"}, item.operationId)),
      words(item.state), item.progress || count(item.completedFiles) + " / " + count(item.fileCount) + " files",
      when(item.updatedAt), action("Reopen operation", () => selectOperation(item.operationId))
    ]))),
    await operationPanel()
  ];
}
function sourcePicker() {
  return h("div", {class: "selection-bar"}, field("Original source", model.sourceId, value => {
    model.sourceId = value; model.resourceType = ""; model.sourceReview.offset = 0; model.sourceReview.previousOffsets = []; model.fieldReview = {query: "", offset: 0};
    task("Open source", render);
  }, {choices: optionRows(sources(), row => row.label + " · " + bytes(row.bytes), "Select a retained source"), key: "source-selector"}));
}
function inspectResource(row, sourceId) {
  const refs = table(["Original path", "Reference", "Action"], list(row.references).map(reference => [
    Array.isArray(reference.path) ? reference.path.join(" / ") : reference.path, reference.reference,
    action("Find referenced text", async () => {
      $("#inspect-dialog").close(); model.sourceId = sourceId; model.resourceType = "";
      model.sourceReview.query = reference.reference; model.sourceReview.kind = "output"; model.sourceReview.offset = 0; model.sourceReview.previousOffsets = [];
      await saveModel(); await render();
    })
  ]));
  inspect((row.kind === "output" ? "Original resource" : "Original " + row.kind) + " · " + (row.resourceType || "") + "/" + (row.id || ""),
    kv([["Original file", row.fileName], ["Physical NDJSON line", row.line], ["Resource identity", (row.resourceType || "") + "/" + (row.id || "")],
      ["Version", row.versionId], ["Modified", row.lastUpdated], ["Line bytes", bytes(row.bytes)]]),
    h("h3", {}, "Exact original line"), h("pre", {"data-original-json": "true"}, row.jsonText),
    list(row.references).length ? detail("Original references", refs, true) : null,
    list(row.deleted).length ? detail("Explicit native DELETE entries", row.deleted, true) : null,
    list(row.issues).length ? detail("Original OperationOutcome issues", row.issues, true) : null,
    detail("Original line identity", {fileId: row.fileId, recordId: row.recordId, lineSha256: row.lineSha256, resourceSha256: row.resourceSha256}));
}
async function sourceRowsPanel(source) {
  const review = model.sourceReview, kind = review.kind;
  const q = new URLSearchParams({resourceType: kind === "output" ? model.resourceType : "", kind, offset: String(review.offset), limit: String(review.limit), query: review.query});
  const page = await api("/api/sources/" + enc(source.id) + "/rows?" + q);
  return panel("Original resource records",
    form("Filter original records", async () => {review.offset = 0; review.previousOffsets = []; await saveModel(); await render();},
      h("div", {class: "field-grid"},
        field("Record kind", review.kind, value => {review.kind = value; review.offset = 0; review.previousOffsets = [];}, {choices: [{value: "output", label: "Exported resources"}, {value: "error", label: "Provider outcomes"}, {value: "deleted", label: "Explicit deletion records"}], key: "source-kind"}),
        field("Resource type", model.resourceType, value => {model.resourceType = value; review.offset = 0; review.previousOffsets = [];}, {choices: [{value: "", label: "All resource types"}, ...list(source.inventory.resourceTypes).map(item => ({value: item.type, label: item.type + " · " + count(item.count)}))], key: "source-type"}),
        field("Search original text", review.query, value => review.query = value, {key: "source-search", help: "Searches the exact retained resource text."}),
        field("Rows per page", review.limit, value => review.limit = Number(value), {choices: [25, 50, 100, 250].map(value => ({value, label: String(value)})), key: "source-page-size"})),
      actions(submit("Apply resource filter"))),
    table(["Resource", "Version", "Modified", "Original file / line", "Details"], list(page.rows).map(row => [
      h("div", {}, h("strong", {}, row.resourceType || row.kind), h("p", {class: "mono"}, row.id || "(no id)")),
      row.versionId, row.lastUpdated,
      h("div", {}, row.fileName, h("p", {class: "muted"}, "Line " + row.line + " · " + bytes(row.bytes))),
      action("Inspect original", () => inspectResource(row, source.id))
    ]), {empty: "No original records match this view."}),
    h("div", {class: "pagination"}, h("span", {}, count(page.total) + " matching records · Showing " + (page.rows.length ? review.offset + 1 : 0) + "–" + (review.offset + page.rows.length)),
      h("div", {class: "actions"}, action("Previous records", async () => {review.offset = list(review.previousOffsets).pop() ?? 0; await saveModel(); await render();}, {disabled: !review.offset}),
        action("Next records", async () => {review.previousOffsets ||= []; review.previousOffsets.push(review.offset); review.offset = page.nextOffset; await saveModel(); await render();}, {disabled: page.nextOffset == null}))));
}
function fieldInventoryPanel(source) {
  model.fieldReview ||= {query: "", offset: 0};
  const review = model.fieldReview;
  const fields = list(source.inventory.fields).filter(item => (!model.resourceType || item.resourceType === model.resourceType) &&
    (!review.query || (item.pointer + " " + item.resourceType).toLowerCase().includes(review.query.toLowerCase())));
  const page = fields.slice(review.offset, review.offset + 100);
  return panel("Observed source fields",
    form("Search observed fields", async () => {review.offset = 0; await saveModel(); await render();},
      field("Field path search", review.query, value => review.query = value, {key: "field-search"}),
      actions(submit("Find fields", {primary: false}))),
    table(["Resource", "Exact path", "Observed JSON types", "Resource coverage", "Examples"], page.map(item => [
      item.resourceType, code(item.pointer), list(item.types).join(", "),
      count(item.resourceCount) + " resources / " + count(item.occurrences) + " occurrences",
      action("Inspect field", () => inspect(item.resourceType + " · " + item.pointer,
        kv([["Exact path tokens", code(json(item.path))], ["Types", item.types.join(", ")], ["Occurrences", item.occurrences], ["Resources", item.resourceCount]]),
        ...list(item.examples).map(example => h("pre", {}, example.jsonText))))
    ])),
    h("div", {class: "pagination"}, h("span", {}, count(fields.length) + " observed fields"),
      h("div", {class: "actions"}, action("Previous fields", async () => {review.offset = Math.max(0, review.offset - 100); await saveModel(); await render();}, {disabled: !review.offset}),
        action("Next fields", async () => {review.offset += 100; await saveModel(); await render();}, {disabled: review.offset + 100 >= fields.length}))));
}
async function sourcesView() {
  const source = await getSource();
  if (!source) return [heading("Original resources", "Inspect the exact source before choosing a dataset mapping."), sourcePicker(),
    panel("Receive original source", empty("Complete a server export or import a complete FHIR source packet."),
      actions(action("Server exports", () => navigate("exports"), {primary: true}), action("Import source packet", () => navigate("delivery"))))];
  const inventory = source.inventory;
  const members = await api("/api/sources/" + enc(source.id) + "/members");
  const memberRows = Array.isArray(members) ? members : members.files || members.members || [];
  return [
    heading("Original resources", "Review retained resource values, native outcomes, explicit deletion records and the original source coverage."), sourcePicker(),
    metrics([["Resources", count(inventory.totals.resources)], ["Original files", count(inventory.totals.files)], ["Provider outcomes", count(inventory.totals.outcomes)], ["DELETE entries", count(inventory.totals.deletedEntries)]]),
    panel(source.label,
      kv([["Source classification", words(inventory.classification.origin)], ["Publisher", inventory.classification.publisher],
        ["Capture mode", words(inventory.mode)], ["Coverage", words(inventory.coverage.kind)], ["Modified after", inventory.coverage.since],
        ["Modified before", inventory.coverage.until], ["Transaction time", inventory.transactionTime], ["Organized file headers", inventory.totals.organizedHeaders]]),
      inventory.classification.note ? h("p", {}, inventory.classification.note) : null,
      actions(action("Map this source", () => navigate("mapping"), {primary: true}),
        action("Download original source packet", () => download("/api/sources/" + enc(source.id) + "/packet", "fhir-original-source.zip")),
        action("Compose retained state", async () => {model.composition.baseSourceId = source.id; await navigate("compare");})),
      detail("Original source and capture lineage", {source: {id: source.id, name: source.name, bytes: source.bytes, created: source.created}, classification: inventory.classification, export: inventory.export, captures: inventory.captures, composition: inventory.composition})),
    panel("Resource identities", table(["Resource type", "Records", "Identities", "Duplicate identities", "Missing ids", "Action"], list(inventory.resourceTypes).map(item => [
      item.type, count(item.count), count(item.identities), count(item.duplicateIdentities), count(item.missingIds),
      action("View resources", async () => {model.resourceType = item.type; model.sourceReview.kind = "output"; model.sourceReview.offset = 0; model.sourceReview.previousOffsets = []; await saveModel(); await render();})
    ]))),
    list(inventory.findings).length ? panel("Source findings", table(["Finding", "Detail", "Original location"], inventory.findings.map(item => [item.code, item.message, [item.fileId, item.line].filter(value => value != null).join(" / ")]))) : null,
    await sourceRowsPanel(source), fieldInventoryPanel(source),
    panel("Retained source files", table(["Original member", "Kind", "Resource type", "Bytes", "Action"], memberRows.map(item => [
      code(item.name), item.kind || "protocol / manifest", item.type, bytes(item.bytes),
      action("Download original file", () => download("/api/sources/" + enc(source.id) + "/files/" + enc(item.name), item.name.split("/").at(-1) || "fhir-original.bin"))
    ])), detail("Full source inventory", inventory))
  ].filter(Boolean);
}

function mappingBody() {
  if (!model.mappingDraft) throw new Error("Create or load a mapping first.");
  const body = clone(model.mappingDraft);
  body.columns = body.columns.map((column, index) => {
    const pathText = model.mappingPathInputs?.[index];
    if (pathText !== undefined) {
      let path;
      try {path = JSON.parse(pathText);} catch {throw new Error("Column " + (index + 1) + " has an invalid path token array.");}
      if (!Array.isArray(path) || path.some(token => typeof token !== "string")) throw new Error("Column " + (index + 1) + " requires an array of exact string path tokens.");
      column.path = path;
    }
    if (column.missing !== "default") delete column.default;
    if (column.mode !== "join") delete column.separator;
    return column;
  });
  return body;
}
function renameColumn(index, name) {
  const draft = model.mappingDraft, before = draft.columns[index].name;
  draft.columns[index].name = name;
  for (const capability of ["keys", "filters", "ranges", "sorts"]) draft[capability] = list(draft[capability]).map(item => item === before ? name : item);
}
async function loadMapping(planId) {
  model.planId = planId; model.mappingDraft = clone(await getPlan(planId));
  model.mappingPathInputs = {}; model.mappingPreview = null; await saveModel(); await render();
}
function capabilitiesEditor(draft) {
  const names = draft.columns.map(column => column.name).filter(Boolean);
  return h("div", {class: "field-grid"}, ["keys", "filters", "ranges", "sorts"].map(capability => {
    const label = {keys: "Unique identity columns", filters: "Equality filters", ranges: "Range filters", sorts: "Sort columns"}[capability];
    return h("fieldset", {}, h("legend", {}, label), h("div", {class: "check-grid"}, names.map(name =>
      check(name, list(draft[capability]).includes(name), selected => {
        draft[capability] = selected ? [...new Set([...list(draft[capability]), name])] : list(draft[capability]).filter(item => item !== name);
      }, {key: "mapping-" + capability + "-" + name}))));
  }));
}
function mappingColumnEditor(column, index, source) {
  const choices = list(source.inventory.fields).filter(item => item.resourceType === model.mappingDraft.resourceType);
  model.mappingPathInputs ||= {};
  const pathValue = model.mappingPathInputs[index] ?? json(column.path);
  const columnControls = h("div", {class: "column-heading"}, h("h4", {}, "Column " + (index + 1)),
    h("div", {class: "actions inline"},
      action("Move up", async () => {
        const draft = mappingBody(); [draft.columns[index - 1], draft.columns[index]] = [draft.columns[index], draft.columns[index - 1]];
        model.mappingDraft = draft; model.mappingPathInputs = {}; await saveModel(); await render();
      }, {disabled: index === 0, key: "column-up-" + index}),
      action("Move down", async () => {
        const draft = mappingBody(); [draft.columns[index + 1], draft.columns[index]] = [draft.columns[index], draft.columns[index + 1]];
        model.mappingDraft = draft; model.mappingPathInputs = {}; await saveModel(); await render();
      }, {disabled: index === model.mappingDraft.columns.length - 1, key: "column-down-" + index}),
      action("Remove column", async () => {
        const draft = mappingBody(), removed = draft.columns.splice(index, 1)[0].name;
        for (const capability of ["keys", "filters", "ranges", "sorts"]) draft[capability] = draft[capability].filter(name => name !== removed);
        model.mappingDraft = draft; model.mappingPathInputs = {}; await saveModel(); await render();
      }, {key: "column-remove-" + index})));
  return h("section", {class: "plan-column", "data-column-index": index}, columnControls,
    h("div", {class: "field-grid"},
      field("Column name", column.name, value => renameColumn(index, value), {required: true, key: "column-name-" + index}),
      field("Value source", column.source, value => column.source = value, {choices: [{value: "resource", label: "Original resource"}, {value: "record", label: "Retained record identity"}], key: "column-source-" + index}),
      field("Dataset value type", column.type, value => column.type = value, {choices: catalogue.projection.types, key: "column-type-" + index}),
      field("Exact path tokens", pathValue, value => model.mappingPathInputs[index] = value, {multiline: true, mono: true, full: true, rows: 2, key: "column-path-" + index, help: 'A JSON string array, such as ["name","*","family"]. Each key, array position and "*" is explicit. Empty keys and punctuation stay exact.'}),
      field("Multiple selected values", column.mode, value => column.mode = value, {choices: [
        {value: "single", label: "Require one value"}, {value: "first", label: "Choose first explicitly"},
        {value: "last", label: "Choose last explicitly"}, {value: "array", label: "Keep an array"}, {value: "join", label: "Join with a separator"}], key: "column-mode-" + index}),
      field("Cell encoding", column.encoding, value => column.encoding = value, {choices: [{value: "plain", label: "Plain typed value"}, {value: "json", label: "Exact JSON cell"}], key: "column-encoding-" + index}),
      field("Missing field", column.missing, value => column.missing = value, {choices: [{value: "error", label: "Reject missing field"}, {value: "empty", label: "Keep empty cell"}, {value: "default", label: "Use explicit default"}], key: "column-missing-" + index}),
      field("Explicit default value", column.default ?? "", value => column.default = value, {key: "column-default-" + index, help: "Used only when Missing field is set to Use explicit default."}),
      field("Join separator", column.separator ?? "", value => column.separator = value, {key: "column-separator-" + index, help: "Used only for the explicit Join policy."}),
      h("div", {class: "field"}, check("Allow native null", column.nullable, value => column.nullable = value, {key: "column-nullable-" + index}))),
    detail("Choose an observed source path",
      h("div", {}, field("Observed field", "", value => {
        if (value === "") return;
        const selected = choices[Number(value)];
        column.source = "resource"; column.path = clone(selected.path); delete model.mappingPathInputs[index];
        task("Use observed path", render);
      }, {choices: [{value: "", label: "Choose an original field"}, ...choices.map((item, position) => ({value: String(position), label: item.pointer + " · " + item.types.join(", ")}))], key: "column-observed-" + index}),
      h("p", {class: "help"}, "Retained record fields: " + catalogue.projection.recordFields.join(", ")))));
}
function projectionTable(preview) {
  const columns = list(preview.columns).map(item => typeof item === "string" ? item : item.name || item.column);
  return h("div", {}, h("p", {class: "help"}, "Showing " + count(preview.previewRows) + " preview rows from " + count(preview.totalRows) + " selected records. The full build validates every selected row."),
    table(["Original ordinal", ...columns], list(preview.rows).map(row => [row.ordinal, ...list(row.cells).map(cell => h("code", {}, format(cell)))])),
    detail("Typed native preview values", preview.rows.map(row => ({ordinal: row.ordinal, values: row.values}))));
}
async function mappingView() {
  const source = await getSource();
  const draft = model.mappingDraft;
  const overview = [heading("Dataset mapping", "Select explicit resource paths, array handling, exact value encoding and native query capabilities."), sourcePicker()];
  if (!source) return [...overview, panel("Choose a source", empty("Select or acquire a retained source before preparing its projection."))];
  const resourceTypes = list(source.inventory.resourceTypes).map(item => ({value: item.type, label: item.type + " · " + count(item.count) + " resources"}));
  if (!model.resourceType && resourceTypes.length) model.resourceType = resourceTypes[0].value;
  const prepare = panel("Mapping selection",
    h("div", {class: "field-grid"},
      field("Resource type to project", model.resourceType, value => model.resourceType = value, {choices: resourceTypes, key: "mapping-resource-type"}),
      field("Saved mapping", model.planId, value => {if (value) task("Load mapping", () => loadMapping(value));}, {choices: optionRows(plans(), row => row.name, "Choose a saved mapping"), key: "mapping-plan-selector"})),
    actions(action("Create editable default mapping", async () => {
      if (!model.resourceType) throw new Error("Select a resource type.");
      model.mappingDraft = await api("/api/sources/" + enc(source.id) + "/mapping", {method: "POST", body: {resourceType: model.resourceType}});
      model.mappingPathInputs = {}; model.mappingSourceId = source.id; model.mappingPreview = null; model.planId = "";
      await saveModel(); await render();
    }, {primary: true}),
    model.planId ? action("Build source with saved mapping", async () => {
      await command("Build native dataset", "/api/builds", {sourceId: source.id, planId: model.planId}, {type: "build"});
      await render();
    }, {disabled: !!pending}) : null),
    h("p", {class: "help"}, "Reusing the same saved mapping across source editions enables an exact identity-based comparison."));
  if (!draft) return [...overview, prepare];
  const limits = h("div", {class: "field-grid"},
    field("Default rows per query", draft.defaultLimit, value => draft.defaultLimit = value, {type: "number", min: 1, max: 1000, key: "mapping-default-limit"}),
    field("Maximum rows per query", draft.maxLimit, value => draft.maxLimit = value, {type: "number", min: 1, max: 1000, key: "mapping-max-limit"}),
    field("Maximum dataset bytes", draft.maxBytes, value => draft.maxBytes = value, {type: "number", min: 1, max: 268435456, key: "mapping-max-bytes"}),
    field("Maximum dataset rows", draft.maxRows, value => draft.maxRows = value, {type: "number", min: 1, max: 1000000, key: "mapping-max-rows"}),
    field("Maximum characters per cell", draft.maxCellChars, value => draft.maxCellChars = value, {type: "number", min: 1, max: 1048576, key: "mapping-max-cell"}),
    h("div", {class: "field"}, check("Allow an empty selected dataset", draft.allowEmpty, value => draft.allowEmpty = value, {key: "mapping-allow-empty"})));
  return [...overview, prepare,
    panel("Editable projection",
      form("Save reviewed mapping", async () => {
        const body = mappingBody();
        const result = await command("Save reviewed mapping", "/api/plans", body, {type: "plan"});
        model.mappingDraft = clone(result.plan); model.mappingPathInputs = {}; await saveModel(); await render();
      },
        h("div", {class: "field-grid"}, field("Mapping name", draft.name, value => draft.name = value, {required: true, key: "mapping-name"}),
          field("Mapped resource type", draft.resourceType, value => draft.resourceType = value, {required: true, choices: resourceTypes, key: "mapping-type"})),
        h("p", {class: "help"}, "JSON-cell encoding preserves the selected source value as explicit JSON. Plain number and integer types use the native dataset engine's numeric representation."),
        h("div", {"data-component": "mapping-columns"}, draft.columns.map((column, index) => mappingColumnEditor(column, index, source))),
        actions(action("Add projection column", async () => {
          model.mappingDraft = mappingBody();
          model.mappingDraft.columns.push({name: "column_" + (model.mappingDraft.columns.length + 1), source: "resource", path: [], mode: "single", encoding: "json", type: "string", nullable: true, missing: "empty"});
          model.mappingPathInputs = {}; await saveModel(); await render();
        }, {disabled: draft.columns.length >= catalogue.limits.maxColumns})),
        h("div", {class: "rule-line"}), h("h4", {}, "Identity and native query controls"), capabilitiesEditor(draft),
        h("p", {class: "help"}, "Identity columns must be unique for the selected dataset. Equality, range and sort capabilities are opt-in and share the original seller's parameter budget."),
        detail("Dataset and page limits", limits),
        actions(action("Preview projection", async () => {
          model.mappingPreview = await api("/api/sources/" + enc(source.id) + "/preview", {method: "POST", body: {plan: mappingBody(), limit: 25}});
          await saveModel(); await render();
        }), submit("Save reviewed mapping"),
        action("Save and build dataset", async () => {
          const saved = await command("Save reviewed mapping", "/api/plans", mappingBody(), {type: "plan"});
          model.mappingDraft = clone(saved.plan); model.mappingPathInputs = {}; await saveModel();
          await command("Build native dataset", "/api/builds", {sourceId: source.id, planId: saved.id}, {type: "build"}); await render();
        }, {primary: true, disabled: !!pending})),
        detail("Complete mapping JSON", draft))),
    model.mappingPreview ? panel("Projection preview", projectionTable(model.mappingPreview)) : null
  ].filter(Boolean);
}
function buildPicker() {
  return h("div", {class: "selection-bar"}, field("Dataset edition", model.buildId, value => {
    model.buildId = value; model.query = {rows: [], sort: [], fields: [], limit: 50, cursor: "", previous: []};
    task("Open dataset", render);
  }, {choices: optionRows(builds(), row => buildLabel(row.id), "Select a completed dataset"), key: "build-selector"}));
}
async function datasetsView() {
  const build = await getBuild();
  const plan = build ? await getPlan(build.plan) : null;
  const view = [heading("Dataset editions", "Each edition binds the original capture, saved mapping and the native dataset snapshot."), buildPicker()];
  if (build) view.push(
    metrics([["Dataset rows", count(build.rowCount)], ["Mapped columns", count(plan.columns.length)], ["Identity columns", count(build.keys.length)], ["CSV bytes", bytes(build.files["data.csv"]?.bytes)]]),
    panel(plan.name, kv([["Original source", sourceLabel(build.source)], ["Resource type", plan.resourceType],
      ["Identity columns", build.keys.join(", ")], ["Native snapshot", code(build.native.snapshot)]]),
      table(["Column", "Native type", "Encoding", "Empty cells", "Null values"], plan.columns.map(column => {
        const stats = list(build.columns).find(item => item.column === column.name) || {};
        return [column.name, column.type + (column.nullable ? " · nullable" : ""), column.encoding, count(stats.emptyCells), count(stats.nullValues)];
      })),
      actions(action("Query this dataset", () => navigate("query"), {primary: true}),
        action("Inspect original source", async () => {model.sourceId = build.source; await navigate("sources");}),
        action("Review saved mapping", async () => {model.planId = build.plan; model.sourceId = build.source; model.mappingDraft = clone(plan); model.mappingPathInputs = {}; await navigate("mapping");}),
        action("Compare another edition", async () => {model.compare.beforeId = build.id; await navigate("compare");}),
        action("Prepare delivery", () => navigate("delivery"))),
      detail("Native dataset review", build)));
  else view.push(panel("Build a dataset", empty("Select a completed dataset or build a source with a saved reviewed mapping."),
    actions(action("Dataset mapping", () => navigate("mapping"), {primary: true}))));
  view.push(panel("All retained editions", table(["Mapping", "Original source", "Rows", "Native snapshot", "Action"], builds().map(item => [
    plans().find(plan => plan.id === item.plan)?.name || item.plan, sourceLabel(item.source), count(item.rowCount), code(item.native.snapshot.slice(0, 16)),
    action("Open edition", async () => {model.buildId = item.id; await saveModel(); await render();})
  ]))));
  return view;
}
function nativeParams(query) {
  const params = {};
  for (const row of query.rows) {
    if (!row.column) throw new Error("Choose a column for each query condition.");
    const name = row.operator + "_" + row.column;
    if (name in params) throw new Error("Repeated native query parameter: " + name);
    params[name] = row.value;
  }
  if (query.fields.length) params.fields = query.fields.join(",");
  if (query.sort.length > 1) throw new Error("The native dataset engine accepts one sort column.");
  if (query.sort.length) params.sort = (query.sort[0].direction === "desc" ? "-" : "") + query.sort[0].column;
  params.limit = String(query.limit);
  if (query.cursor) params.cursor = query.cursor;
  return params;
}
let queryResponse = null, queryResponseKey = "";
function resultBody(result) {
  const response = result.response || result;
  let body = response.body ?? response;
  if (typeof body === "string") {try {body = JSON.parse(body);} catch {throw new Error("The native dataset returned an unreadable result.");}}
  if (response.status && response.status >= 400) {
    const error = new Error(body.message || body.error?.message || body.error || ("Native dataset HTTP " + response.status));
    error.nativeResult = result; throw error;
  }
  return body;
}
async function runNativeQuery() {
  if (!model.buildId) throw new Error("Select a native dataset.");
  const parameters = nativeParams(model.query);
  const result = await api("/api/builds/" + enc(model.buildId) + "/query?" + new URLSearchParams(parameters));
  const body = resultBody(result);
  queryResponse = {result, body, parameters};
  queryResponseKey = model.buildId + ":" + JSON.stringify(parameters);
  model.query.ran = true; await saveModel(); await render();
}
function queryCondition(row, index, plan) {
  const names = row.operator === "where" ? list(plan.filters) : list(plan.ranges);
  return h("div", {class: "row-editor"},
    field("Condition", row.operator, value => {row.operator = value; task("Update condition", render);},
      {choices: [{value: "where", label: "Equals"}, {value: "gt", label: "Greater than"}, {value: "gte", label: "At least"}, {value: "lt", label: "Less than"}, {value: "lte", label: "At most"}], key: "query-operator-" + index}),
    field("Query column", row.column, value => row.column = value,
      {choices: [{value: "", label: "Select a declared column"}, ...names.map(value => ({value, label: value}))], key: "query-column-" + index}),
    field("Exact scalar value", row.value, value => row.value = value, {key: "query-value-" + index}),
    action("Remove condition", async () => {model.query.rows.splice(index, 1); await saveModel(); await render();}, {key: "query-remove-" + index}));
}
async function queryView() {
  const build = await getBuild();
  const result = [heading("Native dataset query", "Prepare the same scalar query that the original dataset engine and seller accept."), buildPicker()];
  if (!build) return [...result, panel("Select a dataset", empty("Build or select an edition to query it."))];
  const plan = await getPlan(build.plan), query = model.query;
  if (query.limit > plan.maxLimit) query.limit = plan.defaultLimit;
  result.push(panel("Query controls",
    form("Run native query", async () => {query.cursor = ""; query.previous = []; await runNativeQuery();},
      h("p", {class: "help"}, "Conditions combine with AND. Strings are exact and case-sensitive. An empty equality value matches native null only for a nullable column."),
      h("div", {class: "query-rows"}, query.rows.map((row, index) => queryCondition(row, index, plan))),
      actions(action("Add query condition", async () => {
        query.rows.push({operator: plan.filters.length ? "where" : "gte", column: plan.filters[0] || plan.ranges[0] || "", value: ""});
        await saveModel(); await render();
      }, {disabled: !plan.filters.length && !plan.ranges.length})),
      h("div", {class: "rule-line"}),
      h("fieldset", {}, h("legend", {}, "Returned columns · none selected means all"),
        h("div", {class: "check-grid"}, plan.columns.map(column => check(column.name, query.fields.includes(column.name), selected => {
          query.fields = selected ? [...query.fields, column.name] : query.fields.filter(name => name !== column.name);
        }, {key: "query-field-" + column.name})))),
      h("p", {class: "help"}, "Selected columns are returned in selection order: " + (query.fields.join(", ") || "all configured columns")),
      h("div", {class: "query-rows"}, query.sort.map((row, index) => h("div", {class: "row-editor"},
        field("Sort column", row.column, value => row.column = value, {choices: plan.sorts.map(value => ({value, label: value})), key: "query-sort-column-" + index}),
        field("Sort direction", row.direction, value => row.direction = value, {choices: [{value: "asc", label: "Ascending"}, {value: "desc", label: "Descending"}], key: "query-sort-direction-" + index}),
        h("p", {class: "help"}, "One native sort column"), action("Remove sort", async () => {query.sort.splice(index, 1); await saveModel(); await render();}, {key: "query-sort-remove-" + index})))),
      actions(action("Add sort column", async () => {
        const next = plan.sorts.find(name => !query.sort.some(item => item.column === name));
        if (next) query.sort.push({column: next, direction: "asc"});
        await saveModel(); await render();
      }, {disabled: query.sort.length >= 1 || !plan.sorts.length})),
      field("Native page size", query.limit, value => query.limit = value, {type: "number", min: 1, max: plan.maxLimit, key: "query-limit"}),
      actions(submit("Run native query"), action("Clear query", async () => {
        model.query = {rows: [], sort: [], fields: [], limit: plan.defaultLimit, cursor: "", previous: []};
        queryResponse = null; queryResponseKey = ""; await saveModel(); await render();
      }))),
    h("p", {class: "help"}, "Numeric comparisons follow the mapped native type. String ranges and ordering follow UTF-16 code-unit order. Equal sort values retain original CSV order.")));
  let parameters;
  try {parameters = nativeParams(query);} catch {parameters = null;}
  const matching = parameters && queryResponseKey === model.buildId + ":" + JSON.stringify(parameters);
  if (queryResponse && matching) {
    const {body, result: native, parameters: sent} = queryResponse;
    const fields = list(body.fields);
    result.push(panel("Native query results",
      metrics([["Matching rows", count(body.page?.total)], ["Returned rows", count(body.page?.returned)], ["Page limit", count(body.page?.limit)]]),
      table(fields, list(body.rows).map(row => fields.map((name, index) => {
        const value = Array.isArray(row) ? row[index] : row[name];
        return value === null ? h("span", {class: "muted"}, "null") : typeof value === "object" ? code(json(value)) : format(value);
      }))),
      h("div", {class: "pagination"}, h("span", {}, query.cursor ? "Continuation of the original native query" : "First page"),
        h("div", {class: "actions"},
          action("Previous native page", async () => {
            query.cursor = query.previous.pop() || ""; await runNativeQuery();
          }, {disabled: !query.previous.length}),
          action("Next native page", async () => {
            query.previous.push(query.cursor); query.cursor = body.page.nextCursor; await runNativeQuery();
          }, {disabled: !body.page?.nextCursor}))),
      actions(action("Save current query result", async () => saveJSON("fhir-native-query.json", {schema: "stellar-forge.fhir-bulk-query-recipe.v1", buildId: build.id, snapshot: build.native.snapshot, parameters: sent, response: native}))),
      detail("Exact native scalar query", sent), detail("Full original dataset response", native)));
  } else result.push(panel("Results", empty(query.ran ? "Run the current saved query to reopen its native result page." : "Run the query to receive an original native result page.")));
  return result;
}
function saveJSON(filename, body) {
  const blob = new Blob([JSON.stringify(body, null, 2) + "\n"], {type: "application/json"});
  const url = URL.createObjectURL(blob), anchor = h("a", {href: url, download: filename});
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function comparisonPanel() {
  const draft = model.compare;
  const selected = list(state.comparisons).find(item => item.id === model.comparisonId);
  const before = builds().find(item => item.id === draft.beforeId);
  const after = builds().find(item => item.id === draft.afterId);
  const sameMapping = before && after && before.plan === after.plan;
  let page = null;
  if (selected) page = await api("/api/comparisons/" + enc(selected.id) + "/changes?" + new URLSearchParams({offset: String(draft.offset), limit: String(draft.limit)}));
  return panel("Compare observed dataset editions",
    form("Compare dataset editions", async () => {
      await command("Compare dataset editions", "/api/comparisons", {beforeId: draft.beforeId, afterId: draft.afterId}, {type: "comparison"});
      await render();
    },
      h("div", {class: "field-grid"},
        field("Before edition", draft.beforeId, value => {draft.beforeId = value; task("Select comparison edition", render);}, {choices: optionRows(builds(), item => buildLabel(item.id), "Select before edition"), required: true, key: "compare-before"}),
        field("After edition", draft.afterId, value => {draft.afterId = value; task("Select comparison edition", render);}, {choices: optionRows(builds(), item => buildLabel(item.id), "Select after edition"), required: true, key: "compare-after"})),
      h("p", {class: "help"}, "Both editions use the same reviewed mapping and unique keys. Added and removed rows describe observed export differences; actual provider DELETE entries remain separately available in each source. Every mapped cell participates in comparison. Omit capture-specific record_id from a content-focused mapping when comparing a full export with its composed resource state."),
      before && after && !sameMapping ? h("p", {class: "notice"}, "These editions use different mappings. Rebuild the after source with the before mapping to compare the same explicit projection.") : null,
      actions(submit("Compare editions", {disabled: !sameMapping || !!pending}),
        before && after && !sameMapping ? action("Rebuild after source and compare", async () => {
          const rebuilt = await command("Build after source with comparison mapping", "/api/builds", {sourceId: after.source, planId: before.plan}, {type: "build"});
          model.section = "compare"; draft.afterId = rebuilt.id; await saveModel();
          await command("Compare dataset editions", "/api/comparisons", {beforeId: before.id, afterId: rebuilt.id}, {type: "comparison"});
          model.section = "compare"; await saveModel(); await render();
        }, {primary: true, disabled: !!pending}) : null)),
    list(state.comparisons).length ? field("Retained comparison", model.comparisonId, value => {
      model.comparisonId = value; draft.offset = 0; draft.previousOffsets = []; task("Open comparison", render);
    }, {choices: optionRows(list(state.comparisons), item => item.id.slice(0, 12) + " · " + count(item.counts.changed) + " changed · " + count(item.counts.added) + " added", "Select retained comparison"), key: "comparison-selector"}) : null,
    selected ? h("div", {"data-component": "comparison-results"},
      metrics([["Added rows", count(selected.counts.added)], ["Removed rows", count(selected.counts.removed)], ["Changed rows", count(selected.counts.changed)], ["Unchanged rows", count(selected.counts.unchanged)]]),
      kv([["Before edition", buildLabel(selected.before)], ["After edition", buildLabel(selected.after)], ["Identity columns", selected.keys.join(", ")]]),
      table(["Observed change", "Original key", "Changed fields", "Details"], page.rows.map(row => [
        row.kind, code(typeof row.key === "string" ? row.key : json(row.key)), list(row.fields).map(item => typeof item === "string" ? item : item.name || item.column).join(", "),
        action("Inspect change", () => inspect("Observed " + row.kind + " row",
          kv([["Key", code(typeof row.key === "string" ? row.key : json(row.key))], ["Before ordinal", row.beforeRow], ["After ordinal", row.afterRow]]),
          h("h3", {}, "Before exact CSV cells"), h("pre", {}, json(row.before)),
          h("h3", {}, "After exact CSV cells"), h("pre", {}, json(row.after)),
          detail("Complete original change", row)))
      ]), {empty: "There are no changed rows on this comparison page."}),
      h("div", {class: "pagination"}, h("span", {}, "Change offset " + page.offset),
        h("div", {class: "actions"},
          action("Previous changes", async () => {draft.offset = list(draft.previousOffsets).pop() ?? 0; await saveModel(); await render();}, {disabled: !draft.offset}),
          action("Next changes", async () => {draft.previousOffsets ||= []; draft.previousOffsets.push(draft.offset); draft.offset = page.nextOffset; await saveModel(); await render();}, {disabled: page.nextOffset == null}))),
      actions(action("Download complete changes", () => download("/api/comparisons/" + enc(selected.id) + "/file", "fhir-edition-changes.jsonl"))),
      detail("Complete retained comparison", selected)) : null);
}
async function compositionPanel() {
  const draft = model.composition;
  const selectedIds = [draft.baseSourceId, ...draft.deltaSourceIds].filter(Boolean);
  const selectedSources = await Promise.all(selectedIds.map(id => getSource(id)));
  const base = selectedSources[0];
  const available = sources().filter(item => item.id !== draft.baseSourceId && !draft.deltaSourceIds.includes(item.id));
  return panel("Compose retained resource state",
    h("p", {}, "Start from a complete original export and apply its native modification exports in their original sequence. Updates replace the same resource identity; removal uses the provider's explicit DELETE references."),
    form("Compose retained resource state", async () => {
      await command("Compose retained resource state", "/api/compositions", draft, {type: "composition"}); await render();
    },
      h("div", {class: "field-grid"},
        field("Complete base source", draft.baseSourceId, value => {
          draft.baseSourceId = value; draft.deltaSourceIds = draft.deltaSourceIds.filter(id => id !== value);
          task("Select base source", render);
        }, {choices: optionRows(sources(), row => row.label, "Select a complete original export"), required: true, key: "composition-base"}),
        field("Composed source label", draft.label, value => draft.label = value, {required: true, key: "composition-label"})),
      base ? kv([["Base coverage", words(base.inventory.coverage.kind)], ["Base transaction time", base.inventory.transactionTime],
        ["Original scope", base.inventory.export.scope + (base.inventory.export.groupId ? " · " + base.inventory.export.groupId : "")]]) : null,
      h("h4", {}, "Ordered modification exports"),
      table(["Order", "Original source", "Modification coverage", "Action"], draft.deltaSourceIds.map((id, index) => {
        const source = selectedSources.find(item => item.id === id);
        return [index + 1, source.label,
          h("div", {}, "After " + format(source.inventory.coverage.since), h("p", {class: "muted"}, "Through " + format(source.inventory.coverage.until || source.inventory.transactionTime))),
          h("div", {class: "actions inline"},
            action("Move delta up", async () => {
              [draft.deltaSourceIds[index - 1], draft.deltaSourceIds[index]] = [draft.deltaSourceIds[index], draft.deltaSourceIds[index - 1]];
              await saveModel(); await render();
            }, {disabled: index === 0, key: "delta-up-" + index}),
            action("Move delta down", async () => {
              [draft.deltaSourceIds[index + 1], draft.deltaSourceIds[index]] = [draft.deltaSourceIds[index], draft.deltaSourceIds[index + 1]];
              await saveModel(); await render();
            }, {disabled: index === draft.deltaSourceIds.length - 1, key: "delta-down-" + index}),
            action("Remove delta", async () => {draft.deltaSourceIds.splice(index, 1); await saveModel(); await render();}, {key: "delta-remove-" + index}))];
      }), {empty: "Choose the modification captures to apply after the base."}),
      field("Add original modification source", "", value => {
        if (!value) return; draft.deltaSourceIds.push(value); task("Add modification source", render);
      }, {choices: optionRows(available, row => row.label, "Choose a retained modification export"), key: "composition-add-delta"}),
      h("p", {class: "help"}, "The source engine checks scope and actual modification coverage before composition. Each original capture stays accessible. Group membership history follows the provider's actual captured data."),
      detail("Resolve conflicting duplicate resource identities",
        h("div", {}, h("p", {}, "For a conflicting duplicate within the same capture, select the exact original file and physical line to keep. Use Original resources to inspect the candidates first."),
          draft.resolutions.map((resolution, index) => h("div", {class: "plan-column"},
            h("div", {class: "field-grid"},
              field("Resolution source", resolution.sourceId, value => resolution.sourceId = value, {choices: optionRows(selectedSources, row => row.label, "Select original capture"), required: true, key: "resolution-source-" + index}),
              field("Resource type", resolution.resourceType, value => resolution.resourceType = value, {required: true, key: "resolution-type-" + index}),
              field("Original resource id", resolution.id, value => resolution.id = value, {required: true, key: "resolution-id-" + index}),
              field("Original file id", resolution.fileId, value => resolution.fileId = value, {required: true, key: "resolution-file-" + index}),
              field("Original physical line", resolution.line, value => resolution.line = value, {type: "number", min: 1, required: true, key: "resolution-line-" + index})),
            actions(action("Remove duplicate resolution", async () => {draft.resolutions.splice(index, 1); await saveModel(); await render();}, {key: "resolution-remove-" + index})))),
          actions(action("Add explicit duplicate resolution", async () => {
            draft.resolutions.push({sourceId: draft.baseSourceId, resourceType: "", id: "", fileId: "", line: 1});
            await saveModel(); await render();
          })))),
      actions(submit("Compose retained resource state", {disabled: !draft.baseSourceId || !!pending}))),
    list(state.compositions).length ? detail("Retained source compositions", table(["Composed source", "Base source", "Modification captures", "Action"], state.compositions.map(item => [
      sourceLabel(item.sourceId), sourceLabel(item.baseSourceId), item.deltaSourceIds.map(sourceLabel).join(" → "),
      action("Inspect composed source", async () => {model.sourceId = item.sourceId; model.resourceType = ""; await navigate("sources");})
    ]))) : null);
}
async function compareView() {
  return [heading("Edition changes", "Compare reviewed dataset editions or compose a retained resource state from the provider's original incremental exports."),
    await comparisonPanel(), await compositionPanel()];
}
function uploadPanel(title, kind, description) {
  const id = "upload-" + kind;
  const input = h("input", {type: "file", accept: ".zip,application/zip", required: true, id: id + "-file", "data-field": id + "-file"});
  const label = h("input", {type: "text", value: "", autocomplete: "off", id: id + "-label", "data-field": id + "-label"});
  const paths = {source: "/api/sources", packet: "/api/packets", workspace: "/api/workspace/packet"};
  return panel(title, h("p", {}, description),
    form(title, async () => {
      const file = input.files?.[0];
      if (!file) throw new Error("Choose the original complete ZIP.");
      const headers = kind === "source" ? {"X-Source-Name": enc(file.name), "X-Source-Label": enc(label.value || file.name)} : {};
      await command(title, paths[kind], undefined, {type: kind === "workspace" ? "workspace" : kind}, file, headers);
      await render();
    },
      h("div", {class: "field"}, h("label", {for: id + "-file"}, "Complete original ZIP"), input),
      kind === "source" ? h("div", {class: "field"}, h("label", {for: id + "-label"}, "Source label"), label) : null,
      actions(submit(title, {disabled: !!pending}))));
}
async function deliveryView() {
  const build = await getBuild();
  const source = await getSource();
  const activeReceives = list(state.receives).filter(item => item.state !== "complete");
  const emptyWorkspace = !connections().length && !sources().length && !builds().length && !plans().length && !exportsList().length && !list(state.operations).length;
  return [
    heading("Delivery and reopen", "Export the exact delivery needed by the next operator, seller or customer, and receive it through the maintained source workspace."),
    buildPicker(),
    build ? panel("Selected dataset delivery",
      kv([["Dataset edition", buildLabel(build.id)], ["Original source", sourceLabel(build.source)], ["Native snapshot", code(build.native.snapshot)]]),
      table(["Delivery", "Contents", "Action"], [
        ["Native merchant dataset", "data.csv, dataset.json and original FHIR Bulk Data lineage for the existing SF30 dataset seller.",
          action("Download merchant dataset", () => download("/api/builds/" + enc(build.id) + "/dataset", "fhir-merchant-dataset.zip"), {primary: true})],
        ["Complete source-backed dataset packet", "Original source packet, reviewed mapping, dataset and native review. The receiver reconstructs the same dataset before operating it.",
          action("Download dataset packet", () => download("/api/builds/" + enc(build.id) + "/packet", "fhir-dataset-packet.zip"))]
      ]),
      h("p", {class: "help"}, "The merchant and customer commands in the FHIR workbench guide use the existing SF30 release store and SF88 buyer with the operator's selected payment terms and endpoints.")) : null,
    panel("Whole editable workspace",
      h("p", {}, "Includes retained connections, discoveries, export definitions, original operations, source captures, mappings, native datasets, comparisons and composition history. The receiving workspace reconstructs their original identities."),
      metrics([["Source captures", count(sources().length)], ["Saved mappings", count(plans().length)], ["Dataset editions", count(builds().length)], ["Retained operations", count(list(state.operations).length)]]),
      actions(action("Download editable workspace", () => download("/api/workspace/packet", "fhir-editable-workspace.zip"), {primary: true}),
        source ? action("Download selected original source", () => download("/api/sources/" + enc(source.id) + "/packet", "fhir-original-source.zip")) : null),
      h("p", {class: "help"}, "Receiving operators configure their own local authentication profiles. Original operations and acquired source files remain available after reopen."),
      detail("Receiving records", state.receives || [])),
    uploadPanel("Receive original source", "source", "Import a complete FHIR source ZIP with its original manifests, files and source classification."),
    uploadPanel("Receive dataset packet", "packet", "Import a complete source-backed dataset packet and reconstruct its reviewed projection through the original native engine."),
    activeReceives.length ? panel("Continue original workspace receiving", table(["Original archive", "Receiving state", "Updated"], activeReceives.map(item => [code(item.archiveSha256), words(item.state), when(item.updatedAt)])), h("p", {}, "Select this identical original archive below to continue the retained receive.")) : null,
    (emptyWorkspace || activeReceives.length) ? uploadPanel("Receive editable workspace", "workspace", "Receive the original editable workspace or continue the retained receive with its identical original archive.")
      : panel("Reopen an editable workspace", h("p", {}, "Start a fresh private workspace, open its Delivery and reopen section, then choose Receive editable workspace."),
        h("pre", {}, "python fhir_server.py --workspace /private/new-fhir-workspace"),
        h("p", {class: "help"}, "Use a new directory for a complete workspace receive. To reopen this workspace directly, start the server with its existing directory.")),
    panel("Retained browser request", pending ? h("p", {}, pending.label + " is retained above with its exact original input.") : h("p", {}, "All submitted browser requests have a received outcome."),
      detail("Workspace identity", {workspaceId: state.workspaceId, schema: state.schema, sourceCount: sources().length, buildCount: builds().length}))
  ].filter(Boolean);
}
$("#content").addEventListener("toggle", event => {
  const node = event.target;
  if (node.tagName === "DETAILS" && node.dataset.disclosureKey && $("#content").contains(node)) {
    model.disclosures ||= {}; model.disclosures[node.dataset.disclosureKey] = node.open; saveModel();
  }
}, true);
$("#inspect-dialog").addEventListener("click", event => {if (event.target.closest("[data-close-dialog]")) $("#inspect-dialog").close();});
$("#navigation").addEventListener("click", event => {
  const button = event.target.closest("[data-section]");
  if (button) task("Open " + button.textContent, () => navigate(button.dataset.section));
});
$("#refresh").addEventListener("click", () => task("Refresh workspace", async () => {await refreshState(); await render();}));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(autoTimer);
  else if (model?.autoOperation) task("Continue original export", autoTick);
});
try {
  if (!token) throw new Error("Open the private console link printed by the local FHIR server.");
  db = await openDB();
  const initial = await Promise.all([api("/api/catalogue"), api("/api/auth-profiles")]);
  catalogue = initial[0]; profiles = Array.isArray(initial[1]) ? initial[1] : initial[1].profiles || [];
  await refreshState(); await render();
  $("#connection-state").textContent = "Private workspace connected";
  if (model.autoOperation && !pending) task("Continue original export", autoTick);
} catch (error) {
  $("#content").setAttribute("aria-busy", "false");
  $("#content").replaceChildren(panel("Open the retained workspace", h("p", {}, error.message)));
  $("#connection-state").textContent = "Workspace needs attention";
  notice(error.message, true);
}
