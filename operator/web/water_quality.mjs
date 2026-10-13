const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
const number = value => value === null || value === undefined ? "—" : new Intl.NumberFormat(undefined, {maximumFractionDigits: 2}).format(value);
const words = value => String(value ?? "unspecified").replaceAll("_", " ").replace(/\b[a-z]/g, character => character.toUpperCase());
const asArray = value => Array.isArray(value) ? value : [];
const classificationLabels = {"ONRW":"Outstanding National Resource Waters","ORW":"Outstanding Resource Waters","TN":"Trout Natural","TPGT":"Trout Put, Grow, and Take","TPT":"Trout Put and Take","FW":"Freshwaters","SA":"Saltwaters SA","SB":"Saltwaters SB","SFH":"Shellfish Harvesting Waters"};
const classificationLabelSource = "https://des.sc.gov/sites/des/files/Library/Regulations/R.61-68.pdf";
const classificationText = (codes, raw = "") => asArray(codes).map(code => classificationLabels[code] ? classificationLabels[code] + " (" + code + ")" : String(code)).join("; ") || String(raw || "");
const keyOf = reference => reference ? JSON.stringify({collection_id: reference.collection_id, source_id: reference.source_id}) : "";
const refOf = value => value ? JSON.parse(value) : null;
const sourceName = source => source.title || source.source_id || source.id || "Source";
const sourceEditionKey = source => JSON.stringify([
  source.original_source_id || source.source_id,
  source.original_source_sha256 || source.sha256,
  source.evidence_kind || ""
]);
const sourceHref = value => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; }
  catch { return ""; }
};
const link = (uri, label) => sourceHref(uri) ? '<a href="' + esc(sourceHref(uri)) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>" : esc(label);
const button = (action, label, attributes = "") => '<button type="button" data-action="' + esc(action) + '" ' + attributes + ">" + esc(label) + "</button>";
const option = (value, label, selected) => '<option value="' + esc(value) + '"' + (String(value) === String(selected ?? "") ? " selected" : "") + ">" + esc(label) + "</option>";
function sourceOptions(sources, selected, emptyLabel = "Choose a source") {
  return option("", emptyLabel, selected) + sources.map(source => option(keyOf(source), sourceName(source) + " · " + (source.vintage || "edition unspecified") + " · " + source.collection_title, selected)).join("");
}
function columnOptions(columns, selected, label = "Choose a column") {
  return option("", label, selected) + columns.filter(Boolean).map(column => option(column, column, selected)).join("");
}
function compactReference(source) {
  return source ? {collection_id: source.collection_id, source_id: source.source_id} : null;
}
function statusLine(source) {
  return [source.status_date || source.source_vintage || source.vintage, words(source.publication_status),
    source.assessment_period ? "Sampling " + source.assessment_period : null,
    source.classification_status ? words(source.classification_status) + " classification" : null].filter(Boolean).join(" · ");
}
function editionTable(sources) {
  return '<div class="wq-scroll"><table class="wq-table"><thead><tr><th>Source</th><th>Edition and status</th><th>Original identity</th></tr></thead><tbody>' +
    sources.filter(Boolean).map(source => "<tr><td>" + link(source.source_uri || source.uri, source.title || source.source_id || source.id) +
      "</td><td>" + esc(statusLine(source)) + '</td><td><code title="' + esc(source.source_sha256 || source.sha256 || "") + '">' +
      esc((source.source_sha256 || source.sha256 || "").slice(0, 16)) + "</code></td></tr>").join("") + "</tbody></table></div>";
}

export function attachWaterQuality(helpers) {
  const {getState, api, endpoint, openForm, submitAction, detail, fileList, showTask, toast, openItem, sourceForm} = helpers;
  let host = null;
  let generation = 0;
  let listenerController = null;
  let selectedContext = "";
  let selectedWorkspace = "";
  let currentCatalog = null;
  let currentItem = null;
  const catalogCache = new Map();
  const itemCache = new Map();
  const filters = {search: "", focus: false, nonattaining: false, highQuality: false, cause: ""};

  function data(state = getState()) { return state.data?.water_quality || {}; }
  function workspaceKey() { return getState().workspace_key; }
  function stillHere(key, token, node = host) {
    return key === workspaceKey() && token === generation && host === node && Boolean(node?.isConnected);
  }
  function reportError(error) {
    if (error?.name !== "AbortError") toast(error?.message || String(error));
  }
  function cacheKey(state = getState()) {
    return state.workspace_key + ":" + asArray(state.registered_sources).map(source => source.id + ":" + (source.sha256 || "")).sort().join(",") +
      ":" + asArray(state.data?.sources).map(source => source.id).sort().join(",") +
      ":" + asArray(state.data?.water_quality?.water_quality_acquisitions).map(record => record.id).sort().join(",") +
      ":" + asArray(state.tasks).map(task => task.id + ":" + task.state).sort().join(",");
  }
  async function catalog() {
    const state = getState();
    const key = cacheKey(state);
    if (!catalogCache.has(key)) {
      const promise = api(endpoint("/api/extensions/water-quality/catalog"));
      catalogCache.set(key, promise);
      promise.catch(() => catalogCache.delete(key));
    }
    return catalogCache.get(key);
  }
  async function item(id, key = workspaceKey()) {
    const cache = key + ":" + id;
    if (!itemCache.has(cache)) {
      if (workspaceKey() !== key) throw new Error("The active workspace changed. Open this context in its original workspace.");
      const promise = api(endpoint("/api/item", {kind: "water_quality_contexts", id}));
      itemCache.set(cache, promise);
      promise.catch(() => itemCache.delete(cache));
    }
    return itemCache.get(cache);
  }
  async function inspect(reference, format, layer, key) {
    if (workspaceKey() !== key) throw new Error("The active workspace changed. Reopen the source form in the intended workspace.");
    const result = await api(endpoint("/api/extensions/water-quality/inspect", {
      ...reference, format, ...(layer ? {layer} : {})
    }));
    if (workspaceKey() !== key) throw new Error("The active workspace changed while the source was being read.");
    return result;
  }
  function sourcePreview(inspection) {
    if (!inspection) return "";
    if (inspection.kind === "vector") {
      return "<p>" + esc(inspection.geometry_type) + " · " + number(inspection.feature_count) +
        " source features</p><details><summary>Original field preview</summary><pre class=\"wq-pre\">" +
        esc(JSON.stringify(inspection.preview, null, 2)) + "</pre></details>";
    }
    if (inspection.kind === "tmdl_pdf") {
      return "<p>" + number(inspection.page_count) + " pages · Table status " +
        esc(inspection.status_date_candidates?.join(", ") || "shown in the original source") +
        '</p><details><summary>Original PDF preview</summary><pre class="wq-pre">' +
        esc(asArray(inspection.preview).join("\n\n")) + "</pre></details>";
    }
    if (inspection.kind === "normalized") {
      return "<p>" + number(inspection.row_count) + " assessment records · " +
        (inspection.complete ? "Complete selected source" : "Source contains unresolved rows") +
        '</p><details><summary>Assessment preview</summary><pre class="wq-pre">' +
        esc(JSON.stringify(inspection.preview, null, 2)) + "</pre></details>";
    }
    return "";
  }
  function taskSection(state) {
    const tasks = asArray(state.tasks).filter(task => String(task.action).startsWith("water.quality."));
    if (!tasks.length) return "";
    return '<section class="wq-section"><h3>Work in this workspace</h3><div class="wq-scroll"><table class="wq-table"><thead><tr><th>Operation</th><th>Status</th><th>Started</th><th></th></tr></thead><tbody>' +
      tasks.slice(0, 12).map(task => "<tr><td>" + esc(task.action === "water.quality.context.build" ? "Build water-quality context" : "Acquire official sources") +
        "</td><td>" + esc(words(task.state)) + "</td><td>" + esc(task.created_at || "") + "</td><td>" +
        button("waterquality-task", "Open task", 'data-id="' + esc(task.id) + '"') + "</td></tr>").join("") + "</tbody></table></div></section>";
  }
  function acquisitionSection(state) {
    const records = asArray(data(state).water_quality_acquisitions);
    if (!records.length) return "";
    return '<section class="wq-section"><h3>Acquired source editions</h3><div class="wq-scroll"><table class="wq-table"><thead><tr><th>Received</th><th>Publisher files</th><th></th></tr></thead><tbody>' +
      records.map(record => "<tr><td>" + esc(record.created_at || "") + "</td><td>" +
        asArray(record.entries).map(entry => link(entry.uri, entry.title || entry.id) + " · " + esc(entry.status_date || entry.vintage)).join("<br>") +
        "</td><td>" + button("waterquality-acquisition", "Open source files", 'data-id="' + esc(record.id) + '"') + "</td></tr>").join("") +
      "</tbody></table></div></section>";
  }
  function renderShell(state) {
    const contexts = asArray(data(state).water_quality_contexts);
    if (selectedContext && !contexts.some(context => context.id === selectedContext)) selectedContext = "";
    if (!selectedContext && contexts.length) selectedContext = contexts[0].id;
    host.innerHTML = '<div class="wq-panel"><header class="wq-header"><div><h2>Water-quality context</h2>' +
      "<p>Connect official assessments and classified waters to your watershed study. Inspect local and upstream evidence alongside the model results.</p></div>" +
      '<div class="wq-actions">' + button("waterquality-build", "Build context") + button("waterquality-acquire", "Acquire official sources") +
      button("waterquality-import", "Import sources") + '</div></header><section class="wq-section"><div class="wq-row"><label class="wq-grow">Saved context<select data-wq-context>' +
      option("", contexts.length ? "Choose a saved context" : "No context built yet", selectedContext) +
      contexts.map(context => option(context.id, context.title || context.id, selectedContext)).join("") + "</select></label>" +
      (selectedContext ? button("waterquality-record", "Open full record", 'data-id="' + esc(selectedContext) + '"') : "") +
      '</div><div data-wq-results><p class="wq-muted">' +
      (selectedContext ? "Opening watershed context…" : "Acquire or import the original source editions, then select the watershed domain and build a context.") +
      '</p></div></section><div data-wq-catalog><p class="wq-muted">Opening the official source catalogue…</p></div>' + acquisitionSection(state) + taskSection(state) + "</div>";
  }
  function renderCatalog(value) {
    const target = host?.querySelector("[data-wq-catalog]");
    if (!target) return;
    const entries = asArray(value.catalog?.entries);
    const existing = new Set(asArray(value.sources).map(source => source.source_id));
    const classifiedAvailable = asArray(value.sources).some(source => ["WATER_CLASSIFICATION", "HIGH_QUALITY_WATERS"].includes(source.role));
    target.innerHTML = '<section class="wq-section"><details><summary>Official source catalogue and editions</summary>' +
      '<p>The published listing, current TMDL attainment, effective rules and proposed revisions keep their distinct source editions.</p>' +
      '<div class="wq-scroll"><table class="wq-table"><thead><tr><th>Official source</th><th>Edition</th><th>Status</th><th>Workspace</th></tr></thead><tbody>' +
      entries.map(entry => "<tr><td>" + link(entry.uri, entry.title) + "</td><td>" + esc(entry.status_date || entry.vintage) +
        "</td><td>" + esc(words(entry.publication_status)) + (entry.classification_status ? "<br>" + esc(words(entry.classification_status) + " geometry") : "") +
        "</td><td>" + (existing.has(entry.id) ? "Source available" : existing.has(entry.retained_source_id) || (["WATER_CLASSIFICATION", "HIGH_QUALITY_WATERS"].includes(entry.role) && classifiedAvailable) ? "Retained classification layer available" : "Available to acquire") + "</td></tr>").join("") +
      "</tbody></table></div><h4>Focus watersheds</h4><p>" +
      asArray(value.focus_watersheds).map(row => esc(row.name) + " (" + esc(row.huc12) + ", " + esc(row.utility) + ")").join(" · ") +
      "</p><p>" + number(asArray(value.sources).length) + " original sources are available in this workspace.</p></details></section>";
  }
  function renderContext(record) {
    const target = host?.querySelector("[data-wq-results]");
    if (!target) return;
    const context = record.context;
    currentItem = record;
    const summary = context.summary || {};
    const causes = [...new Set(asArray(context.assessments).map(row => row.cause_family).filter(Boolean))].sort();
    if (filters.cause && !causes.includes(filters.cause)) filters.cause = "";
    target.innerHTML = '<div class="wq-stats">' +
      [["Watersheds", summary.huc12_count], ["Assessment sites", summary.assessment_site_count],
        ["Nonattaining sites", summary.nonattaining_site_count], ["Classified reaches / waters", summary.classified_feature_count]]
        .map(([label, value]) => '<div><strong>' + number(value) + "</strong><span>" + esc(label) + "</span></div>").join("") +
      '</div><div class="wq-filters"><label class="wq-grow">Find a watershed<input type="search" data-wq-filter="search" value="' + esc(filters.search) +
      '" placeholder="HUC12, watershed or utility"></label><label>Assessment cause<select data-wq-filter="cause">' +
      option("", "All causes", filters.cause) + causes.map(cause => option(cause, words(cause), filters.cause)).join("") +
      '</select></label><label class="wq-check"><input type="checkbox" data-wq-filter="focus"' + (filters.focus ? " checked" : "") +
      '>Utility focus only</label><label class="wq-check"><input type="checkbox" data-wq-filter="nonattaining"' + (filters.nonattaining ? " checked" : "") +
      '>Nonattaining sites</label><label class="wq-check"><input type="checkbox" data-wq-filter="highQuality"' + (filters.highQuality ? " checked" : "") +
      '>High-quality-water context</label></div><div data-wq-table></div>' +
      '<p class="wq-muted">Counts describe the selected source editions. An empty count means no record in those sources. TMDL-covered sites can remain nonattaining after leaving the 303(d) list.</p>' +
      '<h3>Editable outputs and original evidence</h3>' + fileList(record._downloads || []) +
      '<h3>Source editions used</h3>' + editionTable([context.domain_source, ...asArray(context.assessment_sources), context.classification_source]) +
      '<details><summary>Geographic method</summary><p>' + esc(context.method?.assessment_join) + " " + esc(context.method?.classified_reach_join) +
      " " + esc(context.method?.classification_boundary_rule) + "</p><p>" + esc(context.method?.upstream_context) +
      " Measurements use " + esc(context.method?.spatial_measurement_crs) + "; editable geographic exports use " + esc(context.method?.export_crs) +
      ".</p><p>" + esc(context.method?.model_use) + "</p><p>Classification TN means Trout Natural; assessment-cause TN means Total nitrogen. " +
      link(context.method?.classification_label_source_uri || classificationLabelSource, "SCDES classification names: R.61-68, Section G") + "</p></details>";
    paintTable();
  }
  function paintTable() {
    const target = host?.querySelector("[data-wq-table]");
    const context = currentItem?.context;
    if (!target || !context) return;
    const highQualityCodes = new Set(asArray(context.method?.high_quality_codes));
    const search = filters.search.trim().toLowerCase();
    const rows = asArray(context.watersheds).filter(row => {
      if (search && ![row.huc12, row.name, row.focus_utility].join(" ").toLowerCase().includes(search)) return false;
      if (filters.focus && !row.focus_utility) return false;
      if (filters.nonattaining && !row.nonattaining_site_count) return false;
      if (filters.highQuality && !asArray(row.upstream_of_high_quality_codes).length &&
          !asArray(row.direct_classification_codes).some(code => highQualityCodes.has(code))) return false;
      if (filters.cause && !Object.values(row.assessment_cause_counts?.[filters.cause] || {}).some(count => Number(count) > 0)) return false;
      return true;
    });
    target.innerHTML = '<p class="wq-result-count">' + number(rows.length) + " of " + number(asArray(context.watersheds).length) +
      ' watersheds</p><div class="wq-scroll wq-watersheds"><table class="wq-table"><thead><tr><th>HUC12</th><th>Watershed</th><th>Utility</th><th>Sites</th>' +
      "<th>Nonattaining</th><th>TMDL nonattaining</th><th>Direct classes</th><th>Downstream high-quality classes</th><th>Upstream nonattaining sites</th><th></th></tr></thead><tbody>" +
      rows.map(row => "<tr><td><code>" + esc(row.huc12) + "</code></td><td>" + esc(row.name) + "</td><td>" + esc(row.focus_utility || "—") +
        '</td><td class="wq-number">' + number(row.assessment_site_count) + '</td><td class="wq-number">' + number(row.nonattaining_site_count) +
        '</td><td class="wq-number">' + number(row.tmdl_nonattaining_site_count) + "</td><td>" + esc(classificationText(row.direct_classification_codes) || "—") +
        "</td><td>" + esc(classificationText(row.upstream_of_high_quality_codes) || "—") + '</td><td class="wq-number">' +
        number(row.upstream_nonattaining_site_count) + "</td><td>" + button("waterquality-watershed", "Evidence", 'data-huc="' + esc(row.huc12) + '"') + "</td></tr>").join("") +
      (rows.length ? "" : '<tr><td colspan="10">No watersheds match these filters.</td></tr>') + "</tbody></table></div>";
  }
  async function loadContext(id, key, token, node) {
    if (!id) return;
    try {
      const result = await item(id, key);
      if (stillHere(key, token, node) && selectedContext === id) renderContext(result);
    } catch (error) {
      if (stillHere(key, token, node)) {
        node.querySelector("[data-wq-results]").innerHTML = '<p role="alert">' + esc(error.message || error) + "</p>";
      }
    }
  }
  function openWatershed(huc) {
    const context = currentItem?.context;
    const row = asArray(context?.watersheds).find(item => item.huc12 === huc);
    if (!row) return;
    const ids = new Set(asArray(row.assessment_ids));
    const assessments = asArray(context.assessments).filter(assessment => ids.has(assessment.id));
    const links = asArray(context.classification_links).filter(item => item.huc12 === huc);
    const reaches = new Map(asArray(currentItem.classified_reaches).map(reach => [String(reach.source_feature_id ?? reach.id), reach]));
    const html = '<div class="wq-panel"><p><code>' + esc(row.huc12) + "</code> · " + esc(row.focus_utility || "Reporting / upstream domain") +
      " · " + number(row.area_km2) + " km²</p><p>Downstream HUC: " + esc(row.downstream_huc12 || "Source terminal") +
      (row.downstream_outside_selection ? " (outside this selected domain)" : "") + " · " + number(row.upstream_huc12_count) +
      " HUCs in the retained upstream context.</p><h3>Assessment evidence</h3>" +
      (assessments.length ? '<div class="wq-scroll"><table class="wq-table"><thead><tr><th>Site and location</th><th>Use</th><th>Cause</th><th>Support</th><th>TMDL</th><th>Source</th></tr></thead><tbody>' +
        assessments.map(assessment => "<tr><td><strong>" + esc(assessment.site) + "</strong><br>" + esc(assessment.description) +
          "</td><td>" + esc(assessment.use) + "</td><td>" + esc(assessment.cause_label || assessment.cause_raw) + "<br>" +
          esc(words(assessment.cause_family)) +
          (assessment.cause_source_cell && assessment.cause_source_cell !== assessment.cause_raw ? "<br>Source cell: " + esc(assessment.cause_source_cell) : "") +
          asArray(assessment.cause_annotations).map(note => "<br>" + esc(note.marker + " " + note.text)).join("") +
          "</td><td>" + esc(words(assessment.use_support)) + "</td><td>" +
          esc([assessment.tmdl_relation, assessment.tmdl_report, assessment.approval_date].filter(Boolean).join(" · ")) +
          "</td><td>" + link(assessment.source_uri, assessment.source_id) + "<br>" + esc(statusLine(assessment)) +
          (assessment.source_page ? "<br>Page " + esc(assessment.source_page) : "") +
          (assessment.source_table_row ? "<br>" + esc(assessment.sheet || "Source table") + ", row " + esc(assessment.source_table_row) : "") + "</td></tr>").join("") +
        "</tbody></table></div>" : "<p>No assessment record for this HUC appears in the selected editions.</p>") +
      "<h3>Classified reaches and waters</h3>" +
      (links.length ? '<div class="wq-scroll"><table class="wq-table"><thead><tr><th>Native feature</th><th>Waterbody</th><th>Classification</th><th>Intersecting length</th><th>Intersecting area</th></tr></thead><tbody>' +
        links.map(relation => {
          const reach = reaches.get(String(relation.source_feature_id)) || {};
          return "<tr><td><code>" + esc(relation.source_feature_id) + "</code></td><td>" + esc(reach.waterbody_name || reach.HYDNAME || "") +
            "</td><td>" + esc(classificationText(relation.classification_codes, relation.classification_raw)) +
            "<br><small>Source field: " + esc(relation.classification_raw) + "</small></td><td>" +
            (relation.intersection_length_m === null ? "—" : number(relation.intersection_length_m) + " m") +
            "</td><td>" + (relation.intersection_area_m2 === null ? "—" : number(relation.intersection_area_m2) + " m²") + "</td></tr>";
        }).join("") + "</tbody></table></div>" : "<p>No classified reach with a positive intersection is present in the selected layer.</p>") +
      "<h3>High-quality-water connection</h3><p>Direct classifications: " + esc(classificationText(row.direct_classification_codes) || "No source code") +
      ". Downstream high-quality codes connected through the retained HUC topology: " +
      esc(classificationText(row.upstream_of_high_quality_codes) || "No source code") + ".</p>" +
      editionTable([context.classification_source, ...asArray(context.assessment_sources)]) + "</div>";
    detail(row.name || row.huc12, html, {kind: "water_quality_contexts", id: currentItem.id});
  }

  async function openAcquisition() {
    const key = workspaceKey();
    const value = await catalog();
    if (key !== workspaceKey()) return;
    const existing = new Set(asArray(value.sources).map(source => source.source_id));
    const classifiedAvailable = asArray(value.sources).some(source => ["WATER_CLASSIFICATION", "HIGH_QUALITY_WATERS"].includes(source.role));
    const entries = asArray(value.catalog.entries);
    const html = '<div class="wq-form" id="wq-acquire-form"><p>Receive the selected publisher files into this workspace. Completed source captures are retained with their original documents and editions.</p>' +
      entries.map(entry => '<label class="wq-source-choice"><input type="checkbox" name="wq-acquire-source" value="' + esc(entry.id) + '"' +
        (entry.acquire_by_default !== false && !existing.has(entry.id) ? " checked" : "") + '><span><strong>' + esc(entry.title) + "</strong><br>" +
        esc(entry.status_date || entry.vintage) + " · " + esc(words(entry.publication_status)) +
        (existing.has(entry.id) ? " · Already available in this workspace" : "") +
        (entry.acquire_by_default === false ? "<br>" + (classifiedAvailable ? "A retained classification layer is already available in this workspace." : "This acquires complete statewide classification geometry.") : "") +
        "<br>" + link(entry.uri, "Publisher source") + "</span></label>").join("") + "</div>";
    openForm("Acquire official water-quality sources", "The original task queue receives and imports these source files.", html, "Acquire selected sources", async () => {
      if (workspaceKey() !== key) throw new Error("The active workspace changed. Reopen acquisition in the intended workspace.");
      const selected = [...document.querySelectorAll('#wq-acquire-form input[name="wq-acquire-source"]:checked')].map(input => input.value);
      if (!selected.length) throw new Error("Choose at least one source.");
      await submitAction("water.quality.sources.acquire", {source_ids: selected});
    });
  }

  async function openBuild() {
    const key = workspaceKey();
    const value = await catalog();
    if (key !== workspaceKey()) return;
    const allSources = asArray(value.sources);
    const vectors = allSources.filter(source => source.kind === "vector");
    const assessments = allSources.filter(source => ["table", "document"].includes(source.kind));
    if (!vectors.length) {
      toast("Import the original watershed layer, then build its water-quality context.");
      sourceForm();
      return;
    }
    const byKey = new Map(allSources.map(source => [keyOf(source), source]));
    const preferredDomain = value.defaults?.domain || vectors.find(source => /domain|watershed|huc/i.test(source.title)) || vectors[0];
    const preferredClass = value.defaults?.classifications || vectors.find(source => ["WATER_CLASSIFICATION", "HIGH_QUALITY_WATERS"].includes(source.role));
    const selection = {
      domain: {reference: compactReference(preferredDomain), inspection: null, huc_field: "", to_field: "", topology_companion: "", layer: ""},
      classification: {reference: compactReference(preferredClass), inspection: null, class_field: "", id_field: "", layer: ""},
      assessments: []
    };
    let nextCard = 1;
    let formRoot;
    const initialAssessments = assessments.filter(source => source.role === "WATER_QUALITY_ASSESSMENT" &&
      ["303d_listing", "tmdl_attainment"].includes(source.evidence_kind) &&
      !["draft", "proposed"].includes(source.publication_status));
    const selectedEditions = new Map();
    for (const source of initialAssessments) {
      const identity = sourceEditionKey(source);
      const previous = selectedEditions.get(identity);
      if (!previous || (source.suggested_format === "normalized" && previous.suggested_format !== "normalized"))
        selectedEditions.set(identity, source);
    }
    const chosenInitial = [...selectedEditions.values()];
    function addCard(source = null) {
      selection.assessments.push({
        id: nextCard++, reference: compactReference(source), format: source?.suggested_format || "table",
        evidence_kind: source?.evidence_kind || "303d_listing", inspection: null, sheet: "", header_row: 1,
        bindings: {}, busy: false, error: "", request: 0
      });
    }
    chosenInitial.forEach(source => addCard(source));
    if (!selection.assessments.length && assessments.length) addCard();
    const html = '<div class="wq-form" id="wq-build-form"><label>Context title<input data-wq-title value="Upper Savannah water-quality context" required></label>' +
      '<fieldset><legend>Watershed domain</legend><label>Original HUC layer<select data-wq-domain-source>' +
      sourceOptions(vectors, keyOf(selection.domain.reference)) + '</select></label><div data-wq-domain-fields><p>Reading original fields…</p></div></fieldset>' +
      '<fieldset><legend>Classified reaches and waters</legend><label>Original classification layer<select data-wq-class-source>' +
      sourceOptions(vectors, keyOf(selection.classification.reference), "Use assessment evidence only") +
      '</select></label><div data-wq-class-fields></div></fieldset><fieldset><legend>Assessment source editions</legend>' +
      '<p>Select each source edition and its original format. Table sources use the actual inspected column names.</p><div data-wq-assessment-cards></div>' +
      '<button type="button" data-wq-add-assessment>Add assessment source</button></fieldset>' +
      '<label class="wq-check"><input type="checkbox" data-wq-include-draft>Include selected draft or proposed assessment editions, retaining their status</label>' +
      '<p class="wq-muted">The context follows the selected watershed boundary and original topology. Site assessments and classified waters remain separate evidence alongside physical model results.</p></div>';

    function alive() { return formRoot?.isConnected && workspaceKey() === key; }
    function matchColumn(columns, names) {
      const normalized = text => String(text).replace(/[^a-z0-9]/gi, "").toLowerCase();
      for (const name of names) {
        const match = columns.find(column => normalized(column) === normalized(name));
        if (match) return match;
      }
      return "";
    }
    function renderVectorFields(kind) {
      if (!alive()) return;
      const model = kind === "domain" ? selection.domain : selection.classification;
      const target = formRoot.querySelector(kind === "domain" ? "[data-wq-domain-fields]" : "[data-wq-class-fields]");
      if (!model.reference) { target.innerHTML = ""; return; }
      if (model.error) { target.innerHTML = '<p role="alert">' + esc(model.error) + "</p>"; return; }
      if (!model.inspection) { target.innerHTML = "<p>Reading original source fields…</p>"; return; }
      const inspection = model.inspection;
      const columns = inspection.fields.map(field => field.name);
      const source = byKey.get(keyOf(model.reference));
      let fields = '<div class="wq-field-grid"><label>Source layer<select data-wq-vector-layer="' + kind + '">' +
        inspection.layers.map(layer => option(layer, layer, model.layer)).join("") + "</select></label>";
      if (kind === "domain") {
        fields += '<label>HUC12 field<select data-wq-domain-huc>' + columnOptions(columns, model.huc_field) + "</select></label>" +
          '<label>Downstream HUC field<select data-wq-domain-to>' + columnOptions(columns, model.to_field, "Use the retained topology companion") + "</select></label>" +
          '<label>Original topology companion<select data-wq-domain-topology>' + option("", "Use the downstream HUC field", model.topology_companion) +
          asArray(inspection.topology_companions).map(companion => option(companion.path, companion.path, model.topology_companion)).join("") + "</select></label>";
      } else {
        fields += '<label>Classification field<select data-wq-class-field>' + columnOptions(columns, model.class_field) + "</select></label>" +
          '<label>Original feature ID field<select data-wq-class-id>' + columnOptions(columns, model.id_field) + "</select></label>";
      }
      target.innerHTML = "<p>" + esc(statusLine(source || {})) + "</p>" + fields + "</div>" + sourcePreview(inspection);
      target.querySelector("[data-wq-vector-layer]")?.addEventListener("change", event => { model.layer = event.target.value; void inspectVector(kind); });
      if (kind === "domain") {
        target.querySelector("[data-wq-domain-huc]").addEventListener("change", event => { model.huc_field = event.target.value; });
        target.querySelector("[data-wq-domain-to]").addEventListener("change", event => { model.to_field = event.target.value; });
        target.querySelector("[data-wq-domain-topology]").addEventListener("change", event => { model.topology_companion = event.target.value; });
      } else {
        target.querySelector("[data-wq-class-field]").addEventListener("change", event => { model.class_field = event.target.value; });
        target.querySelector("[data-wq-class-id]").addEventListener("change", event => { model.id_field = event.target.value; });
      }
    }
    async function inspectVector(kind) {
      const model = kind === "domain" ? selection.domain : selection.classification;
      if (!model.reference) { model.inspection = null; renderVectorFields(kind); return; }
      const requested = keyOf(model.reference) + ":" + model.layer;
      model.request = requested; model.error = ""; model.inspection = null; renderVectorFields(kind);
      try {
        const result = await inspect(model.reference, "vector", model.layer, key);
        if (!alive() || model.request !== requested) return;
        model.inspection = result.inspection;
        model.layer = result.inspection.selected_layer || "";
        const columns = result.inspection.fields.map(field => field.name);
        if (kind === "domain") {
          if (!columns.includes(model.huc_field)) model.huc_field = matchColumn(columns, ["HUC12", "HUC_12"]);
          if (!columns.includes(model.to_field)) model.to_field = matchColumn(columns, ["ToHUC", "ToHUC12", "To_HUC"]);
          if (!model.to_field && !model.topology_companion && result.inspection.topology_companions.length)
            model.topology_companion = result.inspection.topology_companions[0].path;
        } else {
          const selectedSource = byKey.get(keyOf(model.reference)) || {};
          if (!columns.includes(model.class_field)) model.class_field = matchColumn(columns,
            [selectedSource.class_field, selectedSource.field_hints?.class, "H2OCLASS"].filter(Boolean));
          if (!columns.includes(model.id_field)) model.id_field = matchColumn(columns,
            [selectedSource.object_id_field, selectedSource.field_hints?.object_id].filter(Boolean));
        }
      } catch (error) { if (alive() && model.request === requested) model.error = error.message || String(error); }
      renderVectorFields(kind);
    }
    function tableSheet(card) {
      const inspection = card.inspection;
      if (!inspection) return null;
      if (inspection.sheets) return inspection.sheets.find(sheet => sheet.name === card.sheet) || inspection.sheets[0];
      return {name: "", preview: inspection.preview || []};
    }
    function tableColumns(card) {
      return asArray(tableSheet(card)?.preview?.[card.header_row - 1]).map(String);
    }
    function defaultBindings(card) {
      const columns = tableColumns(card);
      const hints = {
        site: ["SITE", "SITE ID", "STATION", "STATION ID", "STATION NUMBER"],
        huc12: ["HUC12", "HUC_12", "HUC 12", "12 DIGIT HUC"],
        cause: ["CAUSE", "PARAMETER", "POLLUTANT", "IMPAIRMENT"],
        description: ["DESCRIPTION", "LOCATION", "STATION DESCRIPTION", "SITE DESCRIPTION"],
        county: ["COUNTY"], use: ["USE", "IMPAIRED USE", "DESIGNATED USE"],
        use_support: ["USE SUPPORT", "SUPPORT", "USE_SUPPORT"],
        tmdl_relation: ["TMDL", "TMDL RELATION"], tmdl_report: ["REPORT", "TMDL REPORT"],
        approval_date: ["APPROVAL DATE", "TMDL APPROVAL DATE"], source_page: ["SOURCE PAGE", "SOURCE_PAGE", "PAGE"]
      };
      for (const [field, names] of Object.entries(hints)) {
        if (!columns.includes(card.bindings[field])) card.bindings[field] = matchColumn(columns, names);
      }
    }
    function tablePreview(card) {
      const sheet = tableSheet(card);
      const rows = asArray(sheet?.preview);
      if (!rows.length) return "<p>The selected sheet has no preview rows.</p>";
      return '<details><summary>Original table rows</summary><div class="wq-scroll"><table class="wq-table"><tbody>' +
        rows.map((row, index) => '<tr' + (index + 1 === Number(card.header_row) ? ' class="wq-header-row"' : "") + "><th>" + (index + 1) + "</th>" +
          row.map(cell => "<td>" + esc(cell) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div></details>";
    }
    function assessmentFields(card) {
      if (card.busy) return "<p>Reading original source…</p>";
      if (card.error) return '<p role="alert">' + esc(card.error) + "</p>";
      if (!card.inspection) return "<p>Select a source to inspect its original fields.</p>";
      if (card.format !== "table") return sourcePreview(card.inspection);
      const sheet = tableSheet(card);
      const columns = tableColumns(card);
      const validHeader = columns.length && columns.every(Boolean) && new Set(columns).size === columns.length;
      const headerOptions = asArray(sheet?.preview).map((row, index) => option(index + 1, "Row " + (index + 1) + " · " + row.filter(Boolean).slice(0, 4).join(" / "), card.header_row)).join("");
      const fields = [
        ["site", "Site identifier", true], ["huc12", "HUC12", true], ["cause", "Assessment cause", true],
        ["description", "Location / description"], ["county", "County"], ["use", "Designated use"],
        ["use_support", "Use support"], ["tmdl_relation", "TMDL relation"], ["tmdl_report", "TMDL report"], ["approval_date", "Approval date"], ["source_page", "Source page"]
      ];
      return '<div class="wq-field-grid">' +
        (card.inspection.sheets ? '<label>Workbook sheet<select data-card-sheet>' + card.inspection.sheets.map(sheet => option(sheet.name, sheet.name, card.sheet)).join("") + "</select></label>" : "") +
        '<label>Header row<select data-card-header' + (card.inspection.suffix === ".csv" ? " disabled" : "") + ">" + headerOptions + "</select></label>" +
        '<label>Evidence kind<select data-card-kind>' + option("303d_listing", "303(d) listing", card.evidence_kind) +
        option("tmdl_attainment", "TMDL attainment", card.evidence_kind) + "</select></label></div>" +
        (validHeader ? '<div class="wq-field-grid">' + fields.map(([field, label, required]) => "<label>" + esc(label) + (required ? " *" : "") +
          '<select data-card-binding="' + field + '">' + columnOptions(columns, card.bindings[field], required ? "Choose a column" : "Not present in this source") +
          "</select></label>").join("") + "</div>" : '<p role="alert">Choose the actual row containing unique, nonempty column names.</p>') +
        tablePreview(card);
    }
    function renderCards() {
      if (!alive()) return;
      const target = formRoot.querySelector("[data-wq-assessment-cards]");
      target.innerHTML = selection.assessments.map(card => '<section class="wq-assessment-card" data-card-id="' + card.id + '">' +
        '<div class="wq-row"><h4>Assessment source ' + card.id + '</h4><button type="button" data-card-remove>Remove</button></div>' +
        '<div class="wq-field-grid"><label>Original source<select data-card-source>' + sourceOptions(assessments, keyOf(card.reference)) +
        '</select></label><label>Source format<select data-card-format>' + option("table", "XLSX / CSV assessment table", card.format) +
        option("tmdl_pdf", "SCDES TMDL attainment PDF", card.format) + option("normalized", "Normalized assessment data", card.format) +
        '</select></label></div><p class="wq-muted">' + esc(statusLine(byKey.get(keyOf(card.reference)) || {})) +
        "</p>" + assessmentFields(card) + "</section>").join("");
      for (const element of target.querySelectorAll("[data-card-id]")) {
        const card = selection.assessments.find(item => item.id === Number(element.dataset.cardId));
        element.querySelector("[data-card-remove]").addEventListener("click", () => {
          selection.assessments = selection.assessments.filter(item => item.id !== card.id); card.request++; renderCards();
        });
        element.querySelector("[data-card-source]").addEventListener("change", event => {
          card.reference = refOf(event.target.value); card.inspection = null; card.bindings = {}; card.sheet = ""; card.header_row = 1;
          const source = byKey.get(event.target.value);
          if (source) { card.format = source.suggested_format; card.evidence_kind = source.evidence_kind || "303d_listing"; }
          void inspectCard(card);
        });
        element.querySelector("[data-card-format]").addEventListener("change", event => { card.format = event.target.value; card.inspection = null; void inspectCard(card); });
        element.querySelector("[data-card-sheet]")?.addEventListener("change", event => {
          card.sheet = event.target.value; card.header_row = 1; defaultBindings(card); renderCards();
        });
        element.querySelector("[data-card-header]")?.addEventListener("change", event => {
          card.header_row = Number(event.target.value); defaultBindings(card); renderCards();
        });
        element.querySelector("[data-card-kind]")?.addEventListener("change", event => { card.evidence_kind = event.target.value; });
        for (const input of element.querySelectorAll("[data-card-binding]")) {
          input.addEventListener("change", event => { card.bindings[input.dataset.cardBinding] = event.target.value; });
        }
      }
    }
    async function inspectCard(card) {
      if (!card.reference) { card.inspection = null; card.error = ""; card.busy = false; renderCards(); return; }
      const request = ++card.request; card.busy = true; card.error = ""; renderCards();
      try {
        const result = await inspect(card.reference, card.format, null, key);
        if (!alive() || card.request !== request || !selection.assessments.includes(card)) return;
        card.inspection = result.inspection;
        if (card.format === "table") {
          card.sheet = result.inspection.sheets?.[0]?.name || "";
          const preview = tableSheet(card)?.preview || [];
          let bestScore = -1, bestRow = 1;
          preview.forEach((row, index) => {
            const columns = row.map(String);
            const score = ["site", "station"].some(name => matchColumn(columns, [name, name + " id"])) +
              (matchColumn(columns, ["huc12", "huc_12", "huc 12"]) ? 1 : 0) +
              (matchColumn(columns, ["cause", "parameter", "pollutant"]) ? 1 : 0);
            if (score > bestScore) { bestScore = score; bestRow = index + 1; }
          });
          card.header_row = result.inspection.suffix === ".csv" ? 1 : bestRow;
          defaultBindings(card);
        }
      } catch (error) { if (alive() && card.request === request) card.error = error.message || String(error); }
      if (card.request === request) card.busy = false;
      renderCards();
    }
    openForm("Build water-quality context", "Select the retained watershed domain and original evidence sources.", html, "Build context", async () => {
      if (!alive()) throw new Error("Reopen the build form in the intended workspace.");
      const domain = selection.domain;
      if (!domain.reference || !domain.inspection || domain.error || !domain.huc_field) throw new Error("Inspect the original watershed source and select its HUC12 field.");
      if (!domain.to_field && !domain.topology_companion) throw new Error("Select its original downstream HUC field or retained topology companion.");
      const result = {
        title: formRoot.querySelector("[data-wq-title]").value.trim() || "Upper Savannah water-quality context",
        domain: {...domain.reference, huc_field: domain.huc_field, to_field: domain.to_field || null,
          ...(domain.layer ? {layer: domain.layer} : {}), ...(domain.topology_companion ? {topology_companion: domain.topology_companion} : {})},
        assessments: [], include_draft: formRoot.querySelector("[data-wq-include-draft]").checked,
      };
      const classified = selection.classification;
      if (classified.reference) {
        if (!classified.inspection || classified.error || !classified.class_field || !classified.id_field)
          throw new Error("Inspect the classification layer and select its original classification and feature-ID fields.");
        result.classifications = {...classified.reference, class_field: classified.class_field, id_field: classified.id_field,
          ...(classified.layer ? {layer: classified.layer} : {})};
      }
      const used = new Set();
      for (const card of selection.assessments) {
        if (!card.reference) throw new Error("Choose a source in each assessment card, or remove the empty card.");
        if (card.busy || !card.inspection || card.error) throw new Error("Finish inspecting each selected assessment source.");
        const selectedSource = byKey.get(keyOf(card.reference));
        const identity = selectedSource ? sourceEditionKey(selectedSource) : keyOf(card.reference);
        if (used.has(identity)) throw new Error("This source edition is selected twice. Remove one assessment selection.");
        used.add(identity);
        const reference = {...card.reference, format: card.format, evidence_kind: card.evidence_kind};
        if (card.format === "table") {
          const columns = tableColumns(card);
          if (!columns.length || !columns.every(Boolean) || new Set(columns).size !== columns.length)
            throw new Error("Choose each table's actual unique header row.");
          if (!["site", "huc12", "cause"].every(field => columns.includes(card.bindings[field])))
            throw new Error("Select the actual site, HUC12 and cause columns.");
          if (card.evidence_kind === "tmdl_attainment" && !columns.includes(card.bindings.use_support))
            throw new Error("Select the actual use-support column for the TMDL attainment table.");
          reference.bindings = Object.fromEntries(Object.entries(card.bindings).filter(([, column]) => column));
          reference.header_row = card.header_row;
          if (card.sheet) reference.sheet = card.sheet;
        }
        if (card.format === "normalized" && !card.inspection.complete)
          throw new Error("The selected normalized source contains unresolved source rows.");
        result.assessments.push(reference);
      }
      if (!result.classifications && !result.assessments.length) throw new Error("Choose assessment evidence or the classified-water layer.");
      await submitAction("water.quality.context.build", {selection: result});
    }, () => {
      formRoot = document.getElementById("wq-build-form");
      if (!formRoot) return;
      formRoot.querySelector("[data-wq-domain-source]").addEventListener("change", event => {
        selection.domain = {reference: refOf(event.target.value), inspection: null, huc_field: "", to_field: "", topology_companion: "", layer: ""};
        void inspectVector("domain");
      });
      formRoot.querySelector("[data-wq-class-source]").addEventListener("change", event => {
        selection.classification = {reference: refOf(event.target.value), inspection: null, class_field: "", id_field: "", layer: ""};
        void inspectVector("classification");
      });
      formRoot.querySelector("[data-wq-add-assessment]").addEventListener("click", () => { addCard(); renderCards(); });
      renderCards();
      void inspectVector("domain"); void inspectVector("classification");
      selection.assessments.forEach(card => { if (card.reference) void inspectCard(card); });
    });
  }

  function mount(container, state) {
    listenerController?.abort();
    listenerController = new AbortController();
    host = container;
    const token = ++generation;
    const key = state.workspace_key;
    if (selectedWorkspace !== key) {
      selectedWorkspace = key; selectedContext = ""; currentItem = null; currentCatalog = null;
      Object.assign(filters, {search: "", focus: false, nonattaining: false, highQuality: false, cause: ""});
    }
    renderShell(state);
    container.addEventListener("change", event => {
      if (event.target.matches("[data-wq-context]")) {
        selectedContext = event.target.value; currentItem = null;
        const target = host.querySelector("[data-wq-results]");
        target.innerHTML = selectedContext ? "<p>Opening watershed context…</p>" : "<p>Choose a saved context.</p>";
        void loadContext(selectedContext, key, token, container);
      }
    }, {signal: listenerController.signal});
    const applyFilter = event => {
      const name = event.target.dataset?.wqFilter;
      if (!(name in filters)) return;
      filters[name] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
      paintTable();
    };
    container.addEventListener("input", applyFilter, {signal: listenerController.signal});
    container.addEventListener("change", applyFilter, {signal: listenerController.signal});
    void catalog().then(value => {
      if (stillHere(key, token, container)) { currentCatalog = value; renderCatalog(value); }
    }).catch(error => {
      if (stillHere(key, token, container)) container.querySelector("[data-wq-catalog]").innerHTML = '<p role="alert">' + esc(error.message || error) + "</p>";
    });
    void loadContext(selectedContext, key, token, container);
  }
  function update(state) {
    if (host?.isConnected) mount(host, state);
  }
  function detach() {
    generation++;
    listenerController?.abort();
    listenerController = null;
    host = null; currentItem = null;
  }
  function dispatch(element) {
    const action = element.dataset.action;
    if (action === "waterquality-build") { void openBuild().catch(reportError); return true; }
    if (action === "waterquality-acquire") { void openAcquisition().catch(reportError); return true; }
    if (action === "waterquality-import") { sourceForm(); return true; }
    if (action === "waterquality-task") { Promise.resolve(showTask(element.dataset.id)).catch(reportError); return true; }
    if (action === "waterquality-record") { Promise.resolve(openItem("water_quality_contexts", selectedContext || element.dataset.id)).catch(reportError); return true; }
    if (action === "waterquality-acquisition") { Promise.resolve(openItem("water_quality_acquisitions", element.dataset.id)).catch(reportError); return true; }
    if (action === "waterquality-watershed") { openWatershed(element.dataset.huc); return true; }
    return false;
  }
  return {mount, update, detach, dispatch};
}
