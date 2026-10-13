"use strict";
(() => {
  const $ = id => document.getElementById(id);
  let state = null;
  const observed = new Map();
  const watches = new Map();
  const dirty = new Set();
  const stagedChanges = new Map();
  let changedSourceRequest = 0;
  const entity = (kind, id) => state?.entities.find(row => row.kind === kind && row.id === id);
  const entities = kind => (state?.entities || []).filter(row => row.kind === kind);
  const nameOf = (kind, id) => entity(kind, id)?.data.name || id || "—";
  const short = value => value ? String(value).slice(0, 12) : "—";
  const text = (tag, value, cls) => {
    const node = document.createElement(tag);
    node.textContent = value == null ? "—" : String(value);
    if (cls) node.className = cls;
    return node;
  };
  const clean = node => node.replaceChildren();
  const pretty = value => typeof value === "string" ? value : JSON.stringify(value, null, 2);
  function message(value, error = false) {
    $("status").textContent = value;
    $("status").className = "visible" + (error ? " error" : "");
  }
  function detail(title, value) {
    $("detail-title").textContent = title;
    $("detail-body").textContent = pretty(value);
    $("detail-dialog").showModal();
  }
  function empty(body, columns, value) {
    const row = document.createElement("tr"), cell = text("td", value, "empty");
    cell.colSpan = columns; row.append(cell); body.append(row);
  }
  function tableRow(body, values) {
    const row = document.createElement("tr");
    for (const value of values) {
      const cell = document.createElement("td");
      cell.append(value instanceof Node ? value : text("span", value));
      row.append(cell);
    }
    body.append(row);
    return row;
  }
  function labelCell(title, subtitle) {
    const node = text("div", title);
    if (subtitle) node.append(text("small", subtitle));
    return node;
  }
  function button(label, callback) {
    const node = text("button", label); node.type = "button";
    node.addEventListener("click", async () => {
      node.disabled = true;
      try { await callback(); } catch (error) { message(error.message, true); }
      finally { if (node.isConnected) node.disabled = false; }
    });
    return node;
  }
  function link(label, href, download) {
    const node = text("a", label); node.href = href;
    if (download) node.download = download;
    return node;
  }
  function options(id, rows, label = row => row.data.name || short(row.id)) {
    const select = $(id), previous = select.value;
    select.replaceChildren();
    if (!rows.length) {
      const option = text("option", "No saved selection"); option.value = ""; select.append(option);
    } else for (const row of rows) {
      const option = text("option", label(row)); option.value = row.id; select.append(option);
    }
    if (rows.some(row => row.id === previous)) select.value = previous;
  }
  function decisionSelect(values, current) {
    const select = document.createElement("select"); select.required = true;
    const placeholder = text("option", "Select decision"); placeholder.value = ""; select.append(placeholder);
    for (const [value, label] of values) {
      const option = text("option", label); option.value = value; select.append(option);
    }
    select.value = current || "";
    return select;
  }
  function reasonField(value, label) {
    const node = document.createElement("textarea"); node.required = true; node.rows = 2;
    node.value = value || ""; node.placeholder = "Observed behavior and engineering reason";
    node.setAttribute("aria-label", label); return node;
  }
  async function fetchValue(url, init) {
    const response = await fetch(url, init);
    const raw = await response.text();
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    if (!response.ok) throw new Error(value?.message || value?.error || String(value) || "The original request failed.");
    return value;
  }
  async function command(action, data = {}) {
    return fetchValue("/api/action", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({action, data})});
  }
  async function refresh() {
    state = await fetchValue("/api/state");
    render();
    return state;
  }
  function render() {
    $("workspace-name").textContent = state.name;
    $("workspace-summary").textContent = entities("edition").length + " complete editions · " +
      entities("deployment").length + " native deployments · " + entities("programme").length +
      " saved programmes. Workspace " + short(state.id) + ".";
    const editions = entities("edition"), deployments = entities("deployment"), programmes = entities("programme");
    for (const id of ["config-edition", "change-edition", "native-edition"]) options(id, editions);
    for (const id of ["run-deployment", "activate-deployment"]) options(id, deployments);
    for (const id of ["result-programme", "compare-baseline", "compare-candidate"])
      options(id, programmes, row => row.data.name + " · " + row.data.state + " · " + short(row.id));
    $("edition-count").textContent = editions.length + " saved";
    $("programme-count").textContent = programmes.length + " saved";
    const body = $("edition-rows"); clean(body);
    for (const edition of editions) {
      const actions = document.createElement("div");
      actions.append(button("Open files", () => showEdition(edition)), button("Review", () => {
        if (dirty.has("configuration-review") && $("config-edition").value !== edition.id)
          return message("Save the open configuration review before choosing another edition.", true);
        $("config-edition").value = edition.id; renderConfiguration();
        $("configuration-review").scrollIntoView({block: "start", behavior: "smooth"});
      }));
      tableRow(body, [labelCell(edition.data.name, short(edition.id)), edition.data.files.length,
        edition.data.operationCount, actions]);
    }
    if (!editions.length) empty(body, 4, "Import an application edition to begin.");
    renderConfiguration(); renderChangedFiles(); renderNative(); renderProgramme();
    renderActivation(); renderHistory();
  }
  function showEdition(edition) {
    const body = $("detail-body"); clean(body);
    $("detail-title").textContent = edition.data.name + " — original files";
    for (const file of edition.data.files) {
      const line = document.createElement("div");
      line.append(link(file.path, "/api/file/" + file.sha256 + "?name=" + encodeURIComponent(file.path.split("/").pop()), file.path.split("/").pop()));
      line.append(document.createTextNode("  " + file.bytes + " bytes"));
      body.append(line);
    }
    body.append(text("pre", pretty(edition.data.manifest)));
    $("detail-dialog").showModal();
  }
  function renderConfiguration(force = false) {
    const form = $("configuration-review"), selected = $("config-edition").value;
    if (!force && form.dataset.edition === selected && dirty.has(form.id)) return;
    const edition = entity("edition", selected), review = entity("configuration-review", selected);
    if (!force && form.dataset.edition === selected && form.dataset.revision === (review?.revision || "") &&
        form.dataset.loaded === "yes") return;
    form.dataset.edition = selected; form.dataset.revision = review?.revision || ""; form.dataset.loaded = "yes";
    dirty.delete(form.id); clean($("feature-rows"));
    for (const feature of edition?.data.features || []) {
      const previous = review?.data.decisions.find(row => row.feature === feature.feature);
      const row = document.createElement("div"); row.className = "review-row"; row.dataset.feature = feature.feature;
      const heading = text("div", "");
      heading.append(text("strong", feature.feature));
      const source = link("Original Hive implementation", feature.source); source.target = "_blank"; source.rel = "noopener";
      heading.append(source);
      const value = button("Inspect complete setting", () => detail(feature.feature, feature.value)); value.className = "feature-value";
      heading.append(value);
      row.append(heading, decisionSelect([["retain", "Retain"], ["changed", "Reviewed change"], ["needs-work", "Needs work"]], previous?.decision),
        reasonField(previous?.reason, feature.feature + " review reason"));
      $("feature-rows").append(row);
    }
    form.elements.note.value = review?.data.note || "";
    form.querySelector("button[type=submit], button.primary").disabled = !edition;
    if (!edition) $("feature-rows").append(text("p", "Select an imported edition.", "help"));
  }
  async function loadChangedSource() {
    const request = ++changedSourceRequest;
    const edition = $("change-edition").value, path = $("change-file").value;
    const editor = $("changed-source"), form = $("change-form");
    editor.disabled = true; editor.value = ""; editor.setAttribute("aria-busy", "true");
    form.dataset.loadedFile = "";
    $("stage-change").disabled = true; form.querySelector("button.primary").disabled = true;
    if (!edition || !path) { editor.removeAttribute("aria-busy"); return; }
    try {
      const response = await fetch("/api/edition-file?edition=" + encodeURIComponent(edition) + "&path=" + encodeURIComponent(path));
      const raw = await response.text();
      if (request !== changedSourceRequest || edition !== $("change-edition").value || path !== $("change-file").value) return;
      if (!response.ok) throw new Error(raw);
      editor.value = stagedChanges.get(edition)?.[path] ?? raw;
      form.dataset.loadedFile = edition + "/" + path;
      editor.disabled = false; $("stage-change").disabled = false;
      form.querySelector("button.primary").disabled = false;
      renderStagedChanges(); dirty.delete("change-form");
    } catch (error) {
      if (request === changedSourceRequest) throw error;
    } finally {
      if (request === changedSourceRequest) editor.removeAttribute("aria-busy");
    }
  }
  function renderStagedChanges() {
    const edition = $("change-edition").value, host = $("changed-files-summary");
    clean(host);
    const staged = stagedChanges.get(edition) || {};
    for (const name of Object.keys(staged)) {
      const row = text("div", name + " ");
      row.append(button("Remove staged change", () => { delete staged[name]; renderStagedChanges(); }));
      host.append(row);
    }
    if (!Object.keys(staged).length) host.append(text("p", "The current file is included when you save. Add further files here to carry the complete change together."));
  }
  function renderChangedFiles(force = false) {
    const selected = $("change-edition").value, form = $("change-form");
    if (!force && form.dataset.edition === selected) return;
    const edition = entity("edition", selected), list = $("change-file"), previous = list.value;
    list.replaceChildren();
    for (const file of edition?.data.files || []) {
      const option = text("option", file.path); option.value = file.path; list.append(option);
    }
    if ((edition?.data.files || []).some(row => row.path === previous)) list.value = previous;
    else if (edition) list.value = edition.data.manifest.supergraph_file;
    form.dataset.edition = selected;
    loadChangedSource().catch(error => message(error.message, true));
  }
  function renderNative() {
    const body = $("native-rows"); clean(body);
    const rows = entities("deployment");
    for (const saved of rows) {
      const row = observed.get(saved.id), data = saved.data;
      const local = data.installation === state.root;
      const actions = document.createElement("div");
      for (const [title, action] of [["Start", "start"], ["Inspect", "status"], ["Stop", "stop"], ["Reconcile", "reconcile"]])
        actions.append(button(title, async () => {
          message(title + " original Hive deployment: " + data.name + ".");
          const result = await command("native." + action, {deployment: saved.id});
          const snapshot = result.observation ? result : await command("native.status", {deployment: saved.id});
          observed.set(saved.id, snapshot); await refresh();
          if (action === "status" || action === "reconcile") detail(data.name + " — current native process", result);
          else if (action === "start") { message("Original start saved. Watching its native readiness."); watchNative(saved.id); }
          else { message("SIGTERM sent. Watching the original graceful shutdown."); watchNative(saved.id, "stopped"); }
        }));
      if (!local) for (const action of actions.querySelectorAll("button")) action.disabled = action.textContent !== "Inspect";
      if (data.currentAttempt) actions.append(link("Full native log",
        "/api/native-log?deployment=" + encodeURIComponent(saved.id), "hive-" + short(saved.id) + ".log"));
      tableRow(body, [labelCell(data.name, nameOf("edition", data.edition)),
        text("span", local ? (row?.observation?.observedState || data.state) : "Earlier installation", "badge"),
        labelCell(data.baseUrl + data.graphqlPath, row?.observation.readiness?.status ? "Readiness HTTP " + row.observation.readiness.status : ""),
        new Set([...(data.attempts || []).map(attempt => attempt.id), ...(data.currentAttempt ? [data.currentAttempt.id] : [])]).size, actions]);
    }
    if (!rows.length) empty(body, 5, "Prepare the original binary with a saved complete edition.");
  }
  function watchNative(id, goal = "ready") {
    if (watches.has(id)) clearTimeout(watches.get(id).timer);
    const watch = {goal, timer: null};
    watches.set(id, watch);
    const poll = async () => {
      try {
        const result = await command("native.status", {deployment: id});
        if (watches.get(id) !== watch) return;
        observed.set(id, result); await refresh();
        const observation = result.observation;
        if (goal === "stopped" && !observation.nativeAlive && !observation.supervisorAlive) {
          message(nameOf("deployment", id) + " has stopped. Open its complete original log.");
          watches.delete(id); return;
        }
        if (goal === "ready" && observation.readiness?.status === 200) {
          message(nameOf("deployment", id) + " is ready at " + result.data.baseUrl + ".");
          watches.delete(id); return;
        }
        if (["exited", "interrupted", "failed", "prepared"].includes(observation.observedState)) {
          message("Native process is " + observation.observedState + ". Open its original log and current process details.");
          watches.delete(id); return;
        }
        watch.timer = setTimeout(poll, 2000);
      } catch (error) { watches.delete(id); message(error.message, true); }
    };
    watch.timer = setTimeout(poll, 1000);
  }
  function renderProgramme(force = false) {
    const selected = $("result-programme").value, saved = entity("programme", selected);
    const body = $("result-rows"); clean(body);
    $("programme-summary").textContent = saved ? saved.data.name + " · " + saved.data.state + " · " +
      saved.data.rows.length + " / " + saved.data.operations.operations.length + " operation records · " +
      "Native attempt " + short(saved.data.nativeAttempt) : "Run a complete programme on a ready native deployment.";
    for (const row of saved?.data.rows || []) {
      const actions = document.createElement("div"), response = row.response;
      if (response) {
        actions.append(button("Full response", async () => {
          const raw = await fetch("/api/response?programme=" + encodeURIComponent(selected) + "&operation=" + encodeURIComponent(row.id));
          const original = await raw.text();
          if (!raw.ok) throw new Error(original);
          detail(row.id + " — native HTTP " + response.status, original);
        }), button("HTTP and request", () => detail(row.id + " — complete request and response record", row)));
        actions.append(link("Download body", "/api/file/" + response.body.sha256 + "?name=" + encodeURIComponent(row.id + ".json"), row.id + ".json"));
      } else actions.append(button("Open request outcome", () => detail(row.id, row)));
      tableRow(body, [labelCell(row.name || row.id, row.id), text("span", row.state, "badge"),
        response?.status || "—", response?.graphql?.errorCount ?? "—",
        response ? response.elapsedMs + " ms" : "—", actions]);
    }
    if (!saved?.data.rows.length) empty(body, 6, "Complete original responses appear as the programme runs.");
    const form = $("programme-review"), review = entity("programme-review", selected);
    if (!force && form.dataset.programme === selected && dirty.has(form.id)) return;
    if (!force && form.dataset.programme === selected && form.dataset.revision === (review?.revision || "") &&
        form.dataset.programmeRevision === (saved?.revision || "")) return;
    form.dataset.programme = selected; form.dataset.revision = review?.revision || "";
    form.dataset.programmeRevision = saved?.revision || "";
    dirty.delete(form.id); clean($("result-review-rows"));
    for (const row of saved?.data.rows || []) {
      const previous = review?.data.decisions.find(item => item.id === row.id);
      const reviewRow = document.createElement("div"); reviewRow.className = "review-row"; reviewRow.dataset.operation = row.id;
      const heading = labelCell(row.name || row.id, row.id);
      if (row.expectation) heading.append(text("small", typeof row.expectation === "string" ? row.expectation : row.expectation.description));
      reviewRow.append(heading, decisionSelect([["accept", "Accept outcome"], ["change-required", "Change required"]], previous?.decision),
        reasonField(previous?.reason, row.id + " engineering reason"));
      $("result-review-rows").append(reviewRow);
    }
    form.elements.note.value = review?.data.note || "";
    form.querySelector("button.primary").disabled = saved?.data.state !== "complete";
  }
  function renderActivation() {
    const deployment = $("activate-deployment").value, native = entity("deployment", deployment);
    const accepted = entities("programme").filter(row => row.data.deployment === deployment &&
      row.data.nativeAttempt === native?.data.currentAttempt?.id && entity("programme-review", row.id)?.data.accepted);
    options("activate-programme", accepted, row => row.data.name + " · " + short(row.id));
    for (const node of $("activate-form").querySelectorAll("button")) node.disabled = !accepted.length;
    const active = entity("active-deployment", "operator"); clean($("active-deployment"));
    if (!active) { $("active-deployment").append(text("p", "Select the first reviewed native deployment.")); return; }
    const selected = entity("deployment", active.data.deployment);
    const local = selected?.data.installation === state.root;
    const current = observed.get(active.data.deployment);
    const currentAttempt = selected?.data.currentAttempt?.id;
    const sameAttempt = current?.data.currentAttempt?.id === currentAttempt &&
      currentAttempt === active.data.nativeAttempt;
    const savedState = selected?.data.state;
    const ended = ["exited", "interrupted", "failed", "prepared"].includes(savedState);
    const serving = local && !ended && sameAttempt && current?.observation?.nativeAlive &&
      current.observation.readiness?.status === 200;
    const stopped = local && (ended || sameAttempt && current?.observation &&
      !current.observation.nativeAlive && !current.observation.supervisorAlive);
    let endpointState = "Earlier installation";
    if (local) endpointState = serving ? "Ready at last inspection" :
      stopped ? "Selected router stopped — endpoint not serving" : "Selected endpoint — inspect native readiness";
    $("active-deployment").append(text("div", endpointState, "endpoint"),
      text("p", nameOf("deployment", active.data.deployment) + " · " + active.data.action + " · " + active.data.at),
      text("p", active.data.note));
    if (!local) {
      $("active-deployment").append(text("p", "Prepare and review this installation's local deployment. The earlier endpoint remains in the saved history."));
    } else {
      $("active-deployment").append(text("p", "Selected operator endpoint: " + location.origin + "/graphql", "help"),
        text("p", stopped ? "Use the original deployment's Start control, then run and review its current native programme before selecting that new attempt." :
          "Use Inspect on the selected original deployment to refresh its process and readiness observation.", "help"));
    }
    $("active-deployment").append(text("p", "Saved native listener: " + active.data.baseUrl + active.data.graphqlPath +
      " · saved state: " + (savedState || "unavailable"), "help"));
  }
  function renderHistory() {
    const body = $("deployment-history"); clean(body);
    const history = entity("active-deployment", "operator")?.data.history || [];
    for (const row of [...history].reverse()) tableRow(body, [row.at, row.action,
      labelCell(nameOf("deployment", row.deployment), "Programme " + short(row.programme)), row.note]);
    if (!history.length) empty(body, 4, "Saved cutover and rollback decisions appear here.");
  }
  function showComparison(value) {
    const data = value.data || value, host = $("comparison-view"); clean(host);
    host.append(text("p", data.counts.operations + " operations compared · " + data.counts.changed + " changed or require review.", "result-box"));
    for (const row of data.rows) {
      const block = document.createElement("details");
      block.append(text("summary", row.id + " · " + row.state));
      block.append(text("pre", pretty(row))); host.append(block);
    }
  }
  function structuredResult(id, title, value) {
    const host = $(id); clean(host); host.className = "result-box";
    host.append(text("strong", title));
    const block = document.createElement("details"); block.append(text("summary", "Complete result"), text("pre", pretty(value))); host.append(block);
  }
  function registerForm(id, work) {
    const form = $(id);
    form.addEventListener("input", () => dirty.add(id));
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const buttons = [...form.querySelectorAll("button")], prior = buttons.map(node => node.disabled);
      buttons.forEach(node => node.disabled = true);
      try { await work(Object.fromEntries(new FormData(form)), event.submitter?.value, form); }
      catch (error) { message(error.message, true); }
      finally { buttons.forEach((node, i) => { if (node.isConnected) node.disabled = prior[i]; }); }
    });
  }
  for (const node of document.querySelectorAll("nav [data-section]")) node.addEventListener("click", () => {
    for (const section of document.querySelectorAll(".section")) section.hidden = section.id !== node.dataset.section;
    for (const item of document.querySelectorAll("nav [data-section]")) {
      if (item === node) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");
    }
  });
  $("refresh").addEventListener("click", () => refresh().then(() => message("Saved workspace refreshed.")).catch(error => message(error.message, true)));
  $("close-detail").addEventListener("click", () => $("detail-dialog").close());
  $("config-edition").addEventListener("change", () => {
    dirty.delete("configuration-review"); renderConfiguration(true);
  });
  $("change-edition").addEventListener("change", () => { dirty.delete("change-form"); renderChangedFiles(true); });
  $("stage-change").addEventListener("click", () => {
    const edition = $("change-edition").value, path = $("change-file").value;
    if (!edition || !path) return message("Select an original edition file.", true);
    const staged = stagedChanges.get(edition) || {};
    staged[path] = $("changed-source").value; stagedChanges.set(edition, staged); renderStagedChanges();
    message(path + " added to the complete changed edition.");
  });
  $("change-file").addEventListener("change", () => loadChangedSource().catch(error => message(error.message, true)));
  $("result-programme").addEventListener("change", () => { dirty.delete("programme-review"); renderProgramme(true); });
  $("activate-deployment").addEventListener("change", renderActivation);
  registerForm("import-form", async data => {
    message("Importing complete original edition.");
    const result = await command("edition.import", data); dirty.delete("import-form"); await refresh();
    $("config-edition").value = result.id; renderConfiguration(true);
    $("native-edition").value = result.id; message("Complete edition imported: " + result.data.name + ".");
  });
  registerForm("configuration-review", async (data, _, form) => {
    const edition = form.dataset.edition;
    const decisions = [...$("feature-rows").children].map(row => ({feature: row.dataset.feature,
      decision: row.querySelector("select").value, reason: row.querySelector("textarea").value}));
    await command("configuration.review", {edition, decisions, note: data.note,
      expected: form.dataset.revision || null});
    dirty.delete(form.id); await refresh(); renderConfiguration(true); message("Complete configuration review saved.");
  });
  registerForm("change-form", async (data, _, form) => {
    if ($("changed-source").disabled || form.dataset.loadedFile !== data.edition + "/" + data.path)
      throw new Error("Wait for the selected complete file to load before saving its edition.");
    const result = await command("edition.change", {edition: data.edition, name: data.name, changes: {...(stagedChanges.get(data.edition) || {}), [data.path]: data.content}});
    stagedChanges.delete(data.edition); renderStagedChanges();
    dirty.delete(form.id); await refresh(); $("config-edition").value = result.id; renderConfiguration(true);
    $("native-edition").value = result.id; message("Changed edition saved with all original supporting files.");
  });
  registerForm("prepare-form", async data => {
    data.environment_names = data.environment_names.split(/[\s,]+/).filter(Boolean);
    const result = await command("native.prepare", data); dirty.delete("prepare-form"); await refresh();
    $("run-deployment").value = result.id; message("Original native deployment prepared: " + result.data.name + ".");
  });
  registerForm("run-form", async (data, _, form) => {
    data.run_id ||= "client-" + crypto.randomUUID();
    form.elements.run_id.value = data.run_id;
    message("Running every selected client operation. Original results will appear as they are received.");
    let polling = false;
    const timer = setInterval(async () => {
      if (polling) return; polling = true;
      try { await refresh(); if (entity("programme", data.run_id)) { $("result-programme").value = data.run_id; renderProgramme(); } }
      catch (error) { message(error.message, true); } finally { polling = false; }
    }, 2000);
    try {
      const result = await command("programme.run", data);
      dirty.delete(form.id); await refresh(); $("result-programme").value = result.id; renderProgramme(true);
      message("Complete programme saved: " + result.data.state + ". Review every original outcome below.");
    } finally { clearInterval(timer); }
  });
  registerForm("programme-review", async (data, _, form) => {
    const programme = form.dataset.programme;
    const decisions = [...$("result-review-rows").children].map(row => ({id: row.dataset.operation,
      decision: row.querySelector("select").value, reason: row.querySelector("textarea").value}));
    const result = await command("programme.review", {programme, decisions, note: data.note,
      expected: form.dataset.revision || null});
    dirty.delete(form.id); await refresh(); renderProgramme(true);
    message(result.data.accepted ? "Every selected native outcome is accepted. The programme can support its current deployment."
      : "Complete review saved with the required application changes.");
  });
  registerForm("compare-form", async data => {
    const result = await command("programme.compare", data); await refresh(); showComparison(result);
    message("Full native response comparison saved.");
  });
  registerForm("activate-form", async (data, action, form) => {
    data.expected = entity("active-deployment", "operator")?.revision || null;
    await command("deployment." + action, data); dirty.delete(form.id); await refresh();
    message("Reviewed " + action + " saved. The stable endpoint selects the original native deployment.");
  });
  registerForm("export-form", async () => {
    message("Creating complete application source and saved workspace delivery.");
    const result = await command("delivery.export");
    structuredResult("export-result", "Complete receiving edition", result);
    $("export-result").prepend(link("Download complete ZIP", "/api/archive?path=" +
      encodeURIComponent(result.path) + "&sha256=" + result.sha256, result.path.split("/").pop()));
    message("Complete source, original files, native results and decisions exported.");
  });
  $("verify-workspace").addEventListener("click", async () => {
    try { detail("Complete saved workspace", await command("workspace.verify")); }
    catch (error) { message(error.message, true); }
  });
  registerForm("receive-form", async (data, action) => {
    const result = await command("delivery." + action, data);
    structuredResult("receive-result", action === "receive" ? "Complete edition received" : "Selected complete edition", result);
    if (action === "receive") $("receive-result").append(text("p", "Open the received source at " + result.source +
      " with its original workspace at " + result.path + "/workspace."));
    message(action === "receive" ? "Complete source and saved workspace received into the selected fresh directory." : "Complete receiving edition inspected.");
  });
  refresh().catch(error => message(error.message, true));
})();
