"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const short = value => String(value || "").slice(0, 12);
  const show = value => JSON.stringify(value, null, 2);
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  let token = location.hash.slice(1);
  try {
    if (token) sessionStorage.setItem("sf360-console-token", token);
    else token = sessionStorage.getItem("sf360-console-token") || "";
  } catch {}
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  let state = null, native = null, nextCursor = null, lastQuery = null, changesOffset = null;
  const watches = new Map();
  const pendingPrefix = "sf360-request:";
  function status(message) { $("status").textContent = message || ""; }
  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options, headers: { Authorization: "Bearer " + token, ...(options.headers || {}) }
    });
    const body = await response.json();
    if (!response.ok) throw Error(body.error || "The saved operation could not be read.");
    return body;
  }
  const post = (path, body) => api(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  async function upload(file) {
    if (!file) throw Error("Choose the complete original file.");
    status("Retaining " + file.name + " (" + file.size.toLocaleString() + " bytes)…");
    return api("/api/upload", { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" } });
  }
  async function download(path, name) {
    const response = await fetch(path, { headers: { Authorization: "Bearer " + token } });
    if (!response.ok) {
      const body = await response.json();
      throw Error(body.error || "The complete handoff could not be opened.");
    }
    const blob = await response.blob(), url = URL.createObjectURL(blob), link = el("a");
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
  function act(button, fn) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await fn(); } catch (error) { status(error.message); }
      finally { button.disabled = false; updateButtons(); }
    });
  }
  function form(id, fn) {
    $(id).addEventListener("submit", async event => {
      event.preventDefault();
      const button = $(id).querySelector("button[type=submit],button:not([type])");
      button.disabled = true;
      try { await fn(); } catch (error) { status(error.message); }
      finally { button.disabled = false; updateButtons(); }
    });
  }
  function selectedEdition() { return state?.editions.find(item => item.id === $("edition").value); }
  function selectedCandidate() {
    return state?.candidates.find(item => item.id === $("candidate").value && item.editionId === $("edition").value);
  }
  function fill(node, values, placeholder, preferred) {
    node.replaceChildren();
    if (placeholder !== null) {
      const option = el("option", placeholder); option.value = ""; node.append(option);
    }
    for (const item of values) {
      const option = el("option", item.label); option.value = item.value; node.append(option);
    }
    if (values.some(item => item.value === preferred)) node.value = preferred;
    else if (placeholder === null && values.length) node.value = values[0].value;
  }
  function updateButtons() {
    const edition = selectedEdition(), decision = $("decision").value, candidate = selectedCandidate();
    $("review").disabled = !edition;
    $("make-candidate").disabled = !edition || !decision;
    $("build-original").disabled = !edition?.nativeInputReady;
    $("build-candidate").disabled = !candidate;
    $("export").disabled = !edition;
    $("changes-download").disabled = !$("comparison").value;
    $("query-next").disabled = !nextCursor;
    $("changes-next").disabled = changesOffset === null || !$("comparison").value;
  }
  function renderCandidates() {
    const edition = selectedEdition(), decision = $("decision").value, previous = $("candidate").value;
    const candidates = state.candidates.filter(item => item.editionId === edition?.id && item.decisionId === decision);
    fill($("candidate"), candidates.map(item => ({ value: item.id,
      label: short(item.id) + " · " + item.grantCorrections + " grant corrections" })),
      "Original source", candidates.some(item => item.id === previous) ? previous : candidates.at(-1)?.id);
    updateButtons();
  }
  function renderEdition() {
    const edition = selectedEdition();
    $("edition-panel").hidden = !edition;
    $("empty-editions").hidden = !!edition;
    $("edition-details").replaceChildren();
    if (!edition) { updateButtons(); return; }
    const rows = [
      ["Original source", edition.sourceUrl], ["Source SHA-256", edition.sourceSha256],
      ["Prepared", edition.preparedAt], ["Complete grants", String(edition.grantCount)],
      ["Native input", edition.nativeInputReady ? "Ready" : "Open the original schema and identifier findings"],
      ["Edition", edition.id]
    ];
    for (const [name, value] of rows) {
      $("edition-details").append(el("dt", name), el("dd", value));
    }
    const decisions = state.decisions.filter(item => item.editionId === edition.id)
      .sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)));
    fill($("decision"), decisions.map(item => ({ value: item.id,
      label: item.reviewer + " · " + (item.reviewedAt || short(item.id)) })),
      "Start a new review", decisions.some(item => item.id === $("decision").value) ? $("decision").value : decisions[0]?.id);
    renderCandidates();
    const params = new URLSearchParams({ dataset: edition.dataset, edition: edition.id });
    history.replaceState(null, "", "/?" + params);
  }
  function renderEditions(preferred) {
    const key = $("dataset").value;
    const editions = state.editions.filter(item => item.dataset === key)
      .sort((a, b) => String(b.preparedAt).localeCompare(String(a.preparedAt)));
    const keep = preferred || $("edition").value;
    fill($("edition"), editions.map(item => ({ value: item.id,
      label: item.preparedAt + " · " + item.grantCount + " grants · " + short(item.sourceSha256) })),
      "Choose a source edition", editions.some(item => item.id === keep) ? keep : editions[0]?.id);
    renderEdition();
  }
  function retainedPending() {
    const rows = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(pendingPrefix + state.id + ":")) {
          const item = JSON.parse(localStorage.getItem(key));
          if (item?.id && !state.requests.some(row => row.id === item.id)) rows.push(item);
        }
      }
    } catch {}
    return rows;
  }
  function remember(request) {
    try { localStorage.setItem(pendingPrefix + state.id + ":" + request.id, JSON.stringify(request)); } catch {}
  }
  function forget(id) {
    try { localStorage.removeItem(pendingPrefix + state.id + ":" + id); } catch {}
  }
  function requestDetail(record) {
    $("request-result").textContent = show(record);
    $("request-details").open = true;
  }
  function renderRequests() {
    $("requests").replaceChildren(); $("pending-browser").replaceChildren();
    for (const item of retainedPending()) {
      const row = el("div", undefined, "request"), info = el("div");
      info.append(el("h3", "Reopen the saved browser request"), el("p", item.id));
      const button = el("button", "Reconcile request"); button.type = "button";
      act(button, () => dispatch(item)); row.append(info, button); $("pending-browser").append(row);
    }
    if (!state.requests.length) $("requests").append(el("p", "Saved operations will appear here.", "muted"));
    for (const record of state.requests) {
      const row = el("div", undefined, "request"), info = el("div"), heading = el("h3", record.action);
      heading.append(el("span", record.status, "status-label"));
      info.append(heading, el("p", record.id), el("p", new Date(record.createdAt * 1000).toLocaleString()));
      if (record.error) info.append(el("p", record.error.message));
      const buttons = el("div", undefined, "actions"), open = el("button", "Open result"); open.type = "button";
      open.addEventListener("click", () => requestDetail(record)); buttons.append(open);
      if (record.action === "export" && record.status === "complete") {
        const save = el("button", "Download complete handoff"); save.type = "button";
        act(save, () => download("/api/download?request=" + encodeURIComponent(record.id),
          "360giving-" + short(record.input.edition) + "-handoff.zip")); buttons.append(save);
      }
      if (record.status !== "complete") {
        const resume = el("button", record.status === "running" ? "Watch operation" : "Resume original request");
        resume.type = "button";
        act(resume, async () => {
          if (record.status !== "running") await post("/api/resume", { id: record.id });
          await watch(record.id);
        }); buttons.append(resume);
      } else forget(record.id);
      row.append(info, buttons); $("requests").append(row);
    }
  }
  async function refresh(preferredEdition) {
    const previousDataset = $("dataset").value;
    state = await api("/api/state");
    const params = new URLSearchParams(location.search);
    const requested = state.editions.find(item => item.id === preferredEdition) ||
      state.editions.find(item => item.id === params.get("edition"));
    const key = requested?.dataset || previousDataset || params.get("dataset") || state.datasets[0]?.key;
    fill($("dataset"), state.datasets.map(item => ({ value: item.key, label: item.label })),
      "Choose a dataset", key);
    $("dataset-keys").replaceChildren();
    for (const dataset of state.datasets) {
      const option = el("option"); option.value = dataset.key; option.label = dataset.label;
      $("dataset-keys").append(option);
    }
    $("connection").textContent = state.datasets.length + " datasets · " + state.editions.length +
      " source editions · Workspace " + state.id;
    renderEditions(preferredEdition || requested?.id);
    renderRequests();
    await refreshNative();
  }
  async function refreshNative() {
    const key = $("dataset").value;
    if (!key) {
      native = null; $("native-panel").hidden = true; $("comparison-panel").hidden = true; return;
    }
    const previousBuild = $("build").value, previousBefore = $("before").value;
    const previousAfter = $("after").value, previousComparison = $("comparison").value;
    const result = await api("/api/native-state?dataset=" + encodeURIComponent(key));
    if ($("dataset").value !== key) return;
    native = result;
    const builds = native.builds.map(item => ({ value: item.id,
      label: short(item.id) + " · " + item.rowCount + " grants · source " + short(item.source) }));
    $("native-panel").hidden = builds.length === 0; $("comparison-panel").hidden = builds.length === 0;
    fill($("build"), builds, null, previousBuild);
    fill($("before"), builds, null, builds.some(item => item.value === previousBefore) ? previousBefore : builds[1]?.value);
    fill($("after"), builds, null, previousAfter);
    fill($("comparison"), native.comparisons.map(item => ({ value: item.id,
      label: short(item.before) + " → " + short(item.after) })), "Choose a comparison", previousComparison);
    updateButtons();
  }
  async function watch(id) {
    if (watches.has(id)) return watches.get(id);
    const operation = (async () => {
      for (;;) {
        const record = await api("/api/request?id=" + encodeURIComponent(id));
        requestDetail(record); status(record.action + ": " + record.status + " · " + id);
        if (record.status === "complete") {
          forget(id);
          const edition = record.result?.editionId ||
            (record.result?.schema?.endsWith(".edition") ? record.result.id : null);
          await refresh(edition);
          if (record.action === "decisions") { $("decision").value = record.result.id; renderCandidates(); }
          if (record.action === "candidate") { $("candidate").value = record.result.id; updateButtons(); }
          if (record.action === "build") $("build").value = record.result.build.id;
          if (record.action === "compare") {
            $("comparison").value = record.result.comparison.id;
            await showChanges(0);
          }
          status(record.action + " complete. The original request and result are saved.");
          return record;
        }
        if (record.status === "interrupted") {
          await refresh();
          throw Error(record.error?.message || "Reopen the original request to continue its retained work.");
        }
        await new Promise(resolve => setTimeout(resolve, 900));
      }
    })();
    watches.set(id, operation);
    try { return await operation; } finally { watches.delete(id); }
  }
  async function dispatch(request) {
    remember(request); requestDetail(request);
    status("Saving " + request.action + " request " + request.id + "…");
    await post("/api/requests", request);
    return watch(request.id);
  }
  function perform(action, input) {
    return dispatch({ id: action + "-" + crypto.randomUUID(), action, input });
  }
  function table(target, fields, rows) {
    target.replaceChildren();
    if (!rows.length) { target.append(el("p", "No rows on this page.", "muted")); return; }
    const out = el("table"), head = el("thead"), headers = el("tr"), body = el("tbody");
    for (const field of fields) headers.append(el("th", field)); head.append(headers); out.append(head);
    for (const row of rows) {
      const tr = el("tr");
      for (const field of fields) {
        const value = row[field], td = el("td");
        if (value !== null && typeof value === "object") td.append(el("pre", show(value)));
        else td.textContent = value === null ? "null" : value === undefined ? "" : String(value);
        tr.append(td);
      }
      body.append(tr);
    }
    out.append(body); target.append(out);
  }
  async function query(next = false) {
    const dataset = $("dataset").value, build = $("build").value;
    let params;
    if (next) {
      if (!lastQuery || lastQuery.dataset !== dataset || lastQuery.build !== build || !nextCursor)
        throw Error("Query this selected build before opening its next page.");
      params = { ...lastQuery.params, cursor: nextCursor };
    } else {
      params = JSON.parse($("query-params").value);
      if (!params || Array.isArray(params) || typeof params !== "object" ||
          Object.values(params).some(value => typeof value !== "string"))
        throw Error("Use a JSON object with string values for native query options.");
      lastQuery = { dataset, build, params };
    }
    const result = await post("/api/query", { dataset, build, query: params });
    $("query-result").textContent = show(result);
    const body = result.response?.body;
    if (result.response?.status !== 200 || !Array.isArray(body?.rows)) {
      nextCursor = null; $("query-next").disabled = true;
      throw Error(body?.message || body?.error || "The original dataset returned an unexpected response.");
    }
    table($("query-table"), body.fields, body.rows);
    nextCursor = body.page.nextCursor; $("query-next").disabled = !nextCursor;
    $("query-summary").textContent = body.page.returned + " rows on this page · " + body.page.total + " matching grants";
  }
  async function showChanges(offset) {
    const comparison = $("comparison").value;
    if (!comparison) {
      $("changes-table").replaceChildren(); $("comparison-summary").textContent = "";
      $("changes-next").disabled = true; updateButtons(); return;
    }
    const summary = native.comparisons.find(item => item.id === comparison);
    $("comparison-summary").textContent = summary ? Object.entries(summary.counts).map(([key, value]) => value + " " + key).join(" · ") : "";
    const result = await api("/api/changes?" + new URLSearchParams({
      dataset: $("dataset").value, comparison, offset: String(offset), limit: "50"
    }));
    table($("changes-table"), ["kind", "key", "fields", "before", "after"], result.rows);
    changesOffset = result.nextOffset; $("changes-next").disabled = changesOffset === null;
    updateButtons();
  }

  form("intake-form", async () => {
    const input = { dataset: $("intake-dataset").value, label: $("intake-label").value.trim(),
      sourceUrl: $("source-url").value, source: null, registry: null, capture: null, transport: null };
    for (const name of ["source", "registry", "capture", "transport"]) {
      const file = $(name + "-file").files[0];
      if (file) input[name] = (await upload(file)).id;
    }
    await perform("intake", input);
  });
  form("decision-import", async () => {
    const object = await upload($("decision-file").files[0]);
    await perform("decisions", { edition: $("edition").value, object: object.id });
  });
  form("receive-form", async () => {
    const object = await upload($("receive-file").files[0]);
    await perform("receive", { object: object.id });
  });
  form("query-form", () => query(false));
  form("compare-form", () => perform("compare", {
    dataset: $("dataset").value, before: $("before").value, after: $("after").value
  }));
  act($("refresh"), () => refresh());
  act($("refresh-native"), () => refreshNative());
  act($("review"), async () => {
    const q = new URLSearchParams({ edition: $("edition").value });
    if ($("decision").value) q.set("decision", $("decision").value);
    location.href = "/review.html?" + q + "#" + token;
  });
  act($("make-candidate"), () => perform("candidate", {
    edition: $("edition").value, decision: $("decision").value
  }));
  act($("build-original"), () => perform("build", { edition: $("edition").value, candidate: null }));
  act($("build-candidate"), () => perform("build", {
    edition: $("edition").value, candidate: $("candidate").value
  }));
  act($("export"), async () => {
    const record = await perform("export", {
      edition: $("edition").value, decision: $("decision").value || null, candidate: $("candidate").value || null
    });
    await download("/api/download?request=" + encodeURIComponent(record.id),
      "360giving-" + $("dataset").value + "-handoff.zip");
  });
  act($("query-next"), () => query(true));
  act($("changes-next"), () => showChanges(changesOffset));
  act($("changes-download"), () => download("/api/changes-file?" + new URLSearchParams({
    dataset: $("dataset").value, comparison: $("comparison").value
  }), "360giving-" + $("dataset").value + "-changes.jsonl"));
  $("dataset").addEventListener("change", async () => {
    renderEditions(); nextCursor = null; changesOffset = null; $("query-next").disabled = true;
    $("query-table").replaceChildren(); $("query-result").textContent = ""; $("query-summary").textContent = "";
    $("changes-table").replaceChildren(); $("comparison-summary").textContent = "";
    try { await refreshNative(); } catch (error) { status(error.message); }
  });
  $("edition").addEventListener("change", renderEdition);
  $("decision").addEventListener("change", renderCandidates);
  $("candidate").addEventListener("change", () => {
    const candidate = selectedCandidate();
    if (candidate) $("decision").value = candidate.decisionId;
    updateButtons();
  });
  $("build").addEventListener("change", () => {
    nextCursor = null; $("query-next").disabled = true;
    $("query-table").replaceChildren(); $("query-result").textContent = ""; $("query-summary").textContent = "";
  });
  $("comparison").addEventListener("change", () => showChanges(0).catch(error => status(error.message)));
  $("intake-dataset").addEventListener("change", () => {
    const dataset = state?.datasets.find(item => item.key === $("intake-dataset").value);
    if (dataset) $("intake-label").value = dataset.label;
  });
  $("capture-file").addEventListener("change", async () => {
    try {
      const file = $("capture-file").files[0]; if (!file) return;
      const capture = JSON.parse(await file.text());
      if (!$("source-url").value && typeof capture.sourceUrl === "string") $("source-url").value = capture.sourceUrl;
    } catch {}
  });
  refresh().catch(error => status(error.message));
})();
