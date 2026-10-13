/* Water designation workbench. Framework-free browser module. */
let mountSequence = 0;
const SVG_NS = "http://www.w3.org/2000/svg";
const PAGE_SIZE = 500;
const PURPOSES = {
  high_quality_waters: "High-quality waters",
  drinking_water: "Drinking water",
  protected_lands: "Protected lands"
};
const ROLE_LABELS = {
  water_classification: "Water classification",
  water_classifications: "Water classification",
  high_quality_waters: "High-quality waters",
  drinking_water: "Drinking water",
  protected_lands: "Protected lands",
  classification: "Classification",
  reference: "Reference"
};

export function mountWaterDesignations({
  container,
  request,
  workspaceId,
  onSaved,
  onError,
  onUseInDelivery,
  taskStatusPath = "/api/task",
  pollIntervalMs = 1500
} = {}) {
  if (!container || typeof container.appendChild !== "function") {
    throw new TypeError("A container is required for the water designation workbench.");
  }
  if (typeof request !== "function") {
    throw new TypeError("A JSON request function is required.");
  }
  const mountId = "water-designations-" + (++mountSequence);
  const root = document.createElement("section");
  root.className = "wd";
  root.setAttribute("aria-label", "Water designation workbench");
  root.innerHTML = [
    '<header class="wd-header"><div><p class="wd-kicker">Designation workbench</p><h2>Water and land designations</h2>',
    '<p class="wd-intro">Choose native source classes or exact features, record the governing reference, and save a revision for delivery.</p></div>',
    '<button type="button" class="wd-button wd-button-quiet" data-action="refresh">Refresh sources</button></header>',
    '<div class="wd-notice" data-ref="notice" role="status" aria-live="polite" hidden></div>',
    '<div class="wd-saved-bar"><label>Saved revision<select data-ref="savedSelect"><option value="">Choose a saved revision</option></select></label>',
    '<button type="button" class="wd-button" data-action="open-saved">Open revision</button>',
    '<button type="button" class="wd-button wd-button-quiet" data-action="copy-delivery" disabled>Copy for delivery</button>',
    '<button type="button" class="wd-button" data-action="use-delivery" disabled hidden>Open in delivery</button>',
    '<span class="wd-small" data-ref="savedInfo"></span></div>',
    '<textarea class="wd-copy-fallback" data-ref="copyFallback" aria-label="Saved delivery selection to copy" readonly hidden></textarea>',
    '<div class="wd-source-grid"><label>Source role<select data-ref="roleSelect"><option value="">All roles</option></select></label>',
    '<label class="wd-source-picker">Source<select data-ref="sourceSelect"><option value="">Choose a source</option></select></label>',
    '<label>Designation purpose<select data-ref="purpose">',
    '<option value="high_quality_waters">High-quality waters</option><option value="drinking_water">Drinking water</option><option value="protected_lands">Protected lands</option>',
    '</select></label></div>',
    '<details class="wd-source-options"><summary>Source options</summary><div><label>Native feature ID field<input type="text" data-ref="idFieldOverride" placeholder="Use the published identity field"></label>',
    '<button type="button" class="wd-button" data-action="reload-source">Reload source</button><p class="wd-help">Leave blank to use the source’s identity field. Use an exact field name when a particular source edition requires it.</p></div></details>',
    '<div class="wd-source-detail" data-ref="sourceDetail">Choose a source to inspect its native features and classifications.</div>',
    '<div class="wd-version-notice" data-ref="versionNotice" hidden><span>The source has changed since this selection was recorded.</span>',
    '<button type="button" class="wd-button" data-action="use-current-version">Use current source for a new revision</button></div>',
    '<div class="wd-layout"><aside class="wd-selection-panel">',
    '<div class="wd-section-head"><h3>Select features</h3><span class="wd-small" data-ref="loadedCount">No source loaded</span></div>',
    '<div class="wd-mode-switch" role="group" aria-label="Selection method">',
    '<button type="button" data-mode="classes" aria-pressed="true">By class</button>',
    '<button type="button" data-mode="features" aria-pressed="false">Exact features</button>',
    '<button type="button" data-mode="all" aria-pressed="false">All features</button></div>',
    '<p class="wd-help" data-ref="modeHelp">Class values are matched exactly as written in the source.</p>',
    '<section data-ref="classPane"><label class="wd-search-label">Find a class<input type="search" data-ref="classSearch" placeholder="Search native class values"></label>',
    '<div class="wd-class-actions"><button type="button" class="wd-text-button" data-action="select-classes">Select visible classes</button>',
    '<button type="button" class="wd-text-button" data-action="clear-classes">Clear classes</button><span data-ref="classCount" class="wd-small"></span></div>',
    '<div class="wd-class-list" data-ref="classList"><p class="wd-empty">Load a source to see its classes.</p></div></section>',
    '<section class="wd-feature-section"><div class="wd-section-head"><h4>Source features</h4><span class="wd-small" data-ref="featureMatchCount"></span></div>',
    '<label class="wd-search-label">Search loaded features<input type="search" data-ref="featureSearch" placeholder="Name, native ID or source value"></label>',
    '<div class="wd-feature-actions"><button type="button" class="wd-text-button" data-action="select-filtered" disabled>Select loaded matches</button>',
    '<button type="button" class="wd-text-button" data-action="clear-filtered" disabled>Clear loaded matches</button></div>',
    '<div class="wd-feature-table-wrap"><table class="wd-feature-table"><thead><tr><th scope="col" class="wd-check-col">',
    '<input type="checkbox" data-ref="allLoaded" aria-label="Select all loaded matches" disabled></th>',
    '<th scope="col">Feature / native ID</th><th scope="col">Class</th><th scope="col">Exclusion</th></tr></thead>',
    '<tbody data-ref="featureRows"><tr><td colspan="4" class="wd-empty">No source features loaded.</td></tr></tbody></table></div>',
    '<div class="wd-pagination"><button type="button" class="wd-button wd-button-quiet" data-action="more-rows" hidden>Show more loaded rows</button>',
    '<button type="button" class="wd-button" data-action="load-more" hidden>Load more source features</button>',
    '<span class="wd-small" data-ref="paginationInfo"></span></div></section>',
    '<section class="wd-exclusions"><div class="wd-section-head"><h4>Excluded native IDs</h4><button type="button" class="wd-text-button" data-action="clear-exclusions">Clear</button></div>',
    '<div data-ref="exclusionList"><span class="wd-small">No exclusions.</span></div></section>',
    '</aside><main class="wd-main">',
    '<section class="wd-map-panel" aria-label="Source geometry preview"><div class="wd-section-head"><h3>Geometry preview</h3>',
    '<div class="wd-map-tools" role="group" aria-label="Map controls"><button type="button" class="wd-button" data-action="zoom-in" aria-label="Zoom in">+</button>',
    '<button type="button" class="wd-button" data-action="zoom-out" aria-label="Zoom out">−</button>',
    '<button type="button" class="wd-button" data-action="fit-map">Fit selection</button></div></div>',
    '<div class="wd-map-stage" data-ref="mapStage"><svg data-ref="map" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Native source geometry; drag to pan and use map controls to zoom" viewBox="0 0 100 100">',
    '<g data-ref="mapGeometry"></g></svg><div class="wd-map-empty" data-ref="mapEmpty">Load a source to view its geometry.</div>',
    '<div class="wd-map-hover" data-ref="mapHover" hidden></div><div class="wd-map-scale" data-ref="mapScale" hidden></div></div>',
    '<div class="wd-map-footer"><div class="wd-map-legend"><span><i class="wd-legend-source"></i>Source</span><span><i class="wd-legend-selected"></i>Included</span>',
    '<span><i class="wd-legend-excluded"></i>Excluded</span></div><span class="wd-small">WGS 84 · source geometry</span></div>',
    '<p class="wd-map-caption" data-ref="mapCaption">The preview uses the source geometry.</p>',
    '<button type="button" class="wd-text-button" data-action="more-preview" hidden>Load more selected geometry</button></section>',
    '<section class="wd-preview-panel"><div class="wd-section-head"><h3>Selection summary</h3><span class="wd-status-badge" data-ref="previewState">Preview needed</span></div>',
    '<div class="wd-metrics"><div><span>Selected features</span><strong data-ref="metricFeatures">—</strong></div>',
    '<div><span>Mapped line length</span><strong data-ref="metricLength">—</strong></div>',
    '<div><span>Mapped polygon area</span><strong data-ref="metricArea">—</strong></div></div>',
    '<p class="wd-help" data-ref="previewDetails">Preview the selection to calculate totals across the complete source.</p>',
    '<p class="wd-help wd-measure-notes" data-ref="measureNotes" hidden></p>',
    '<div class="wd-preview-actions"><button type="button" class="wd-button wd-button-primary" data-action="preview" disabled>Preview selection</button>',
    '<span class="wd-small" data-ref="draftCount"></span></div></section>',
    '<section class="wd-inspector"><div class="wd-section-head"><h3>Feature details</h3><span class="wd-small" data-ref="inspectorId"></span></div>',
    '<div data-ref="inspector"><p class="wd-empty">Choose a feature in the table or map to inspect its source fields.</p></div></section>',
    '</main></div>',
    '<section class="wd-revision-panel"><div class="wd-section-head"><h3>Revision and governing reference</h3><span class="wd-small">Saved with the selection</span></div>',
    '<div class="wd-revision-grid"><label>Revision name<input type="text" data-ref="title" maxlength="240" placeholder="Name this designation revision"></label>',
    '<label>Authority / rule title<input type="text" data-ref="ruleTitle" maxlength="500" placeholder="Governing rule, designation or published authority"></label>',
    '<label class="wd-rule-link">Reference link<input type="url" data-ref="ruleUri" placeholder="https://…"></label>',
    '<label>Edition / effective date<input type="text" data-ref="ruleEdition" maxlength="160" placeholder="Published edition or effective date"></label>',
    '<label>Section / page<input type="text" data-ref="ruleSection" maxlength="240" placeholder="Relevant section, table or page"></label>',
    '<label class="wd-notes-label">Selection notes<textarea data-ref="notes" rows="3" maxlength="10000" placeholder="Explain the selected classes, exact features or exclusions."></textarea></label></div>',
    '<p class="wd-help">Use the published authority that supports this revision. Source class names are retained exactly.</p>',
    '<details class="wd-review-context" data-ref="reviewContext" hidden><summary>Related source review <span class="wd-small" data-ref="reviewContextCount"></span></summary>',
    '<p class="wd-help">Original feature links and recorded reach relationships are retained with this revision.</p>',
    '<div data-ref="reviewContextBody"></div><button type="button" class="wd-button wd-button-quiet" data-action="export-context">Source review JSON</button></details>',
    '<div class="wd-save-row"><button type="button" class="wd-button wd-button-primary" data-action="save" disabled>Save revision</button>',
    '<button type="button" class="wd-button" data-action="resume-save" hidden>Check save status</button>',
    '<span class="wd-small" data-ref="readiness">Choose a source to begin.</span></div>',
    '<div class="wd-task-panel" data-ref="taskPanel" role="status" aria-live="polite" hidden><strong data-ref="taskStatus"></strong><span data-ref="taskDetail"></span>',
    '<progress data-ref="taskProgress" max="100" hidden></progress></div></section>',
    '<footer class="wd-export-bar"><strong>Export</strong><button type="button" class="wd-button" data-action="export-selection" disabled>Selection JSON</button>',
    '<button type="button" class="wd-button" data-action="export-geojson" disabled>Selected GeoJSON</button>',
    '<button type="button" class="wd-button" data-action="export-csv" disabled>Selected source rows CSV</button>',
    '<span class="wd-small" data-ref="exportInfo">Data exports include the complete selected features.</span></footer>'
  ].join("");
  container.appendChild(root);
  const refs = Object.fromEntries(
    Array.from(root.querySelectorAll("[data-ref]")).map(function (node) {
      return [node.dataset.ref, node];
    })
  );
  root.querySelectorAll("label").forEach(function (label, i) {
    const input = label.querySelector("input,select,textarea");
    if (input) { input.id = mountId + "-" + i; label.htmlFor = input.id; }
  });
  const abort = new AbortController();
  const state = {
    sources: [], selections: [], source: null, sourceChoice: null, data: null,
    entries: [], byId: new Map(), idValues: new Map(), classes: [],
    classValues: new Map(), featureIds: new Set(), excludeIds: new Set(),
    mode: "classes", idField: "", classField: "", expectedSHA: "", sourceContext: null,
    totalFeatures: 0, nextOffset: null, visibleRows: 100, inspectedId: null,
    preview: null, previewFingerprint: "", previewFeatures: [], previewNext: null,
    savedRecord: null, savedFingerprint: "", revisionOf: null, loading: false, inventoryLoading: false,
    loadingMore: false, previewBusy: false, previewMoreBusy: false,
    exportBusy: false, deliveryBusy: false, saveBusy: false, saveAttempt: null,
    sourceEpoch: 0, previewEpoch: 0,
    map: { latitude: 0, cosLatitude: 1, home: null, view: null, entries: new Map(), drag: null }
  };
  let destroyed = false;
  let pollTimer = null;
  let searchTimer = null;
  let previewSearchTimer = null;

  function workspace() {
    return String(typeof workspaceId === "function" ? workspaceId() : (workspaceId || ""));
  }
  function query(path, params) {
    const search = new URLSearchParams();
    Object.keys(params).forEach(function (key) {
      if (params[key] !== undefined && params[key] !== null) search.set(key, String(params[key]));
    });
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + search.toString();
  }
  async function api(path, options) {
    const opts = Object.assign({}, options || {});
    opts.headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    if (opts.body) opts.headers["Content-Type"] = "application/json";
    opts.signal = abort.signal;
    const value = await request(path, opts);
    if (value && value.ok === false && (value.error || value.message)) {
      throw new Error(errorMessage(value.error || value.message));
    }
    return value;
  }
  function post(path, body) {
    return api(path, { method: "POST", body: JSON.stringify(body) });
  }
  function errorMessage(value) {
    if (!value) return "The request could not be completed.";
    if (typeof value === "string") return value;
    return value.message || value.detail || value.error || JSON.stringify(value);
  }
  function notice(message, tone) {
    if (destroyed) return;
    refs.notice.textContent = message || "";
    refs.notice.hidden = !message;
    refs.notice.dataset.tone = tone || "info";
  }
  function fail(error, context) {
    if (destroyed || (error && error.name === "AbortError")) return;
    const err = error instanceof Error ? error : new Error(errorMessage(error));
    notice((context ? context + " " : "") + err.message, "error");
    if (typeof onError === "function") {
      try { onError(err); } catch (_) { /* Preserve the original error in the workbench. */ }
    }
  }
  function e(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
    });
  }
  function textValue(value) {
    if (value === null || value === undefined || value === "") return "—";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  function number(value, digits) {
    return Number.isFinite(Number(value)) && value !== null && value !== undefined
      ? Number(value).toLocaleString(undefined, { maximumFractionDigits: digits === undefined ? 0 : digits })
      : "—";
  }
  function titleCase(value) {
    return String(value || "").replace(/[_-]+/g, " ").replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
  }
  function roleLabel(value) { const key = String(value || "").toLowerCase(); return ROLE_LABELS[key] || titleCase(key) || "Other sources"; }
  function sourceKey(source) {
    return JSON.stringify([source.source_collection_id || "", source.source_id || "", source.layer || ""]);
  }
  function sameSource(a, b) {
    return !!a && !!b && a.source_collection_id === b.source_collection_id &&
      a.source_id === b.source_id && (!a.layer || !b.layer || a.layer === b.layer);
  }
  function sourceTitle(source) {
    return source ? String(source.title || source.name || source.source_id || "Source") : "";
  }
  function classKey(value) { return JSON.stringify(value === undefined ? null : value); }
  function classLabel(value) {
    return value === null || value === undefined ? "(No class value)" : value === "" ? "(Empty class value)" : String(value);
  }
  function nativeId(feature) {
    const properties = feature.properties || {};
    const value = state.idField && Object.prototype.hasOwnProperty.call(properties, state.idField)
      ? properties[state.idField] : feature.id;
    return value === null || value === undefined || value === "" ? null : value;
  }
  function makeEntry(feature, index, prefix) {
    const properties = feature.properties || {};
    const rawId = nativeId(feature);
    const id = rawId === null ? "__missing_" + prefix + "_" + index : String(rawId);
    const candidates = ["H2ONAME", "WATERBODY_NAME", "WATERBODY", "GNIS_NAME", "STREAM_NAME", "STREAM_NM", "NAME", "Name", "name", "SITE_NAME", "PARK_NAME", "COMMON_NAME"];
    let name = "";
    for (const key of candidates) {
      if (properties[key] !== null && properties[key] !== undefined && String(properties[key]).trim()) {
        name = String(properties[key]); break;
      }
    }
    if (!name) {
      const nameField = Object.keys(properties).find(function (key) { return /(^|_)(name|nam|label)($|_)/i.test(key) && properties[key]; });
      if (nameField) name = String(properties[nameField]);
    }
    if (!name) name = rawId === null ? "Unnamed feature" : "Feature " + String(rawId);
    const cls = properties[state.classField];
    return {
      feature: feature, properties: properties, rawId: rawId, id: id, name: name,
      classValue: cls === undefined ? null : cls,
      search: (name + " " + (rawId === null ? "" : rawId) + " " +
        Object.values(properties).map(textValue).join(" ")).toLocaleLowerCase()
    };
  }
  function baseIncludes(entry) {
    if (state.mode === "all") return true;
    if (state.mode === "features") return state.featureIds.has(entry.id);
    return state.classValues.has(classKey(entry.classValue));
  }
  function includes(entry) {
    return baseIncludes(entry) && !state.excludeIds.has(entry.id);
  }
  function selectedValues(ids) {
    return Array.from(ids).sort().map(function (id) { return state.idValues.has(id) ? state.idValues.get(id) : id; });
  }
  function selection() {
    const source = state.source || {};
    return {
      source_collection_id: source.source_collection_id || "",
      source_id: source.source_id || "",
      layer: source.layer || undefined,
      id_field: state.idField || undefined,
      class_field: state.classField || undefined,
      class_values: Array.from(state.classValues.keys()).sort().map(function (key) { return state.classValues.get(key); }),
      feature_ids: selectedValues(state.featureIds),
      exclude_ids: selectedValues(state.excludeIds),
      selection_mode: state.mode,
      purpose: refs.purpose.value,
      rule_reference: {
        title: refs.ruleTitle.value.trim(), uri: refs.ruleUri.value.trim(),
        edition: refs.ruleEdition.value.trim(), section: refs.ruleSection.value.trim()
      },
      title: refs.title.value.trim(),
      notes: refs.notes.value.trim(),
      expected_source_sha256: state.expectedSHA,
      source_context: state.sourceContext || undefined,
      revision_of: state.revisionOf || undefined
    };
  }
  function geometryFingerprint(value) {
    const current = value || selection();
    return JSON.stringify({
      source_collection_id: current.source_collection_id, source_id: current.source_id,
      layer: current.layer, id_field: current.id_field, class_field: current.class_field,
      class_values: current.class_values, feature_ids: current.feature_ids,
      exclude_ids: current.exclude_ids, selection_mode: current.selection_mode,
      purpose: current.purpose, expected_source_sha256: current.expected_source_sha256
    });
  }
  function previewCurrent() {
    return !!state.preview && state.previewFingerprint === geometryFingerprint();
  }
  function hasSelection() {
    return !!state.source && (state.mode === "all" ||
      (state.mode === "classes" && state.classValues.size > 0) ||
      (state.mode === "features" && state.featureIds.size > 0));
  }
  function versionChanged() {
    return !!state.source && !!state.expectedSHA && !!state.source.sha256 && state.expectedSHA !== state.source.sha256;
  }
  function matchedEntries() {
    const words = refs.featureSearch.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? state.entries.filter(function (entry) {
      return words.every(function (word) { return entry.search.indexOf(word) >= 0; });
    }) : state.entries;
  }
  function visibleClasses() {
    const needle = refs.classSearch.value.trim().toLocaleLowerCase();
    return needle ? state.classes.filter(function (item) {
      return classLabel(item.value).toLocaleLowerCase().indexOf(needle) >= 0;
    }) : state.classes;
  }
  function setButton(action, disabled, label) {
    const button = root.querySelector('[data-action="' + action + '"]');
    if (!button) return;
    button.disabled = !!disabled;
    if (label) button.textContent = label;
  }
  function setVisible(action, visible) {
    const button = root.querySelector('[data-action="' + action + '"]');
    if (button) button.hidden = !visible;
  }
  function updateControls() {
    if (destroyed) return;
    const current = previewCurrent();
    const selectedCount = current && state.preview.summary ? Number(state.preview.summary.selected_features || 0) : 0;
    const loading = state.loading || state.saveBusy;
    const unresolved = !!state.saveAttempt && state.saveAttempt.status === "unknown";
    const editingLocked = loading || unresolved;
    const alreadySaved = (!!state.saveAttempt && state.saveAttempt.status === "succeeded" && state.saveAttempt.fingerprint === JSON.stringify(selection())) || (!!state.savedRecord && state.savedFingerprint === JSON.stringify(selection()));
    const canPreview = hasSelection() && !loading && !versionChanged();
    const canExport = current && selectedCount > 0 && !state.exportBusy;
    const named = !!refs.title.value.trim();
    const referenced = refs.purpose.value !== "high_quality_waters" || (!!refs.ruleTitle.value.trim() && !!refs.ruleUri.value.trim() && !!refs.ruleEdition.value.trim());
    const canSave = current && selectedCount > 0 && named && referenced &&
      !loading && !state.previewBusy && !versionChanged() && !alreadySaved;
    setButton("preview", !canPreview || state.previewBusy, state.previewBusy ? "Calculating…" : "Preview selection");
    const retry = state.saveAttempt && ["failed", "unknown"].indexOf(state.saveAttempt.status) >= 0;
    setButton("save", !canSave, state.saveBusy ? "Saving…" : alreadySaved ? "Revision saved" : retry ? "Retry save" : "Save revision");
    setButton("refresh", state.inventoryLoading, state.inventoryLoading ? "Refreshing…" : "Refresh sources");
    setButton("open-saved", !refs.savedSelect.value || state.loading || state.saveBusy);
    setButton("copy-delivery", !(state.savedRecord && state.savedRecord.delivery_overlay) || state.deliveryBusy);
    setVisible("use-delivery", typeof onUseInDelivery === "function");
    setButton("use-delivery", !(state.savedRecord && state.savedRecord.delivery_overlay) || state.deliveryBusy || typeof onUseInDelivery !== "function");
    setButton("export-selection", !state.source);
    setButton("export-geojson", !canExport);
    setButton("export-csv", !canExport);
    setButton("select-filtered", !state.source || state.mode !== "features" || loading);
    setButton("clear-filtered", !state.source || state.mode !== "features" || loading);
    setButton("select-classes", !state.source || state.mode !== "classes" || loading);
    setButton("clear-classes", !state.source || state.mode !== "classes" || loading);
    setButton("clear-exclusions", !state.excludeIds.size || loading);
    setButton("load-more", state.loadingMore || loading, state.loadingMore ? "Loading features…" : "Load more source features");
    setVisible("load-more", state.nextOffset !== null && !!state.source);
    setButton("more-preview", state.previewMoreBusy || !current, state.previewMoreBusy ? "Loading geometry…" : "Load more selected geometry");
    setVisible("more-preview", current && state.previewNext !== null);
    refs.sourceSelect.disabled = state.loading || state.saveBusy;
    refs.roleSelect.disabled = state.loading || state.saveBusy;
    refs.purpose.disabled = state.loading || state.saveBusy;
    refs.savedSelect.disabled = state.loading || state.saveBusy;
    root.querySelectorAll("[data-mode]").forEach(function (button) { button.disabled = loading || !state.source; });
    refs.allLoaded.disabled = !state.source || state.mode !== "features" || editingLocked;
    refs.idFieldOverride.disabled = editingLocked;
    setButton("reload-source", editingLocked || !(state.sourceChoice || state.source));
    refs.sourceSelect.disabled = editingLocked;
    refs.roleSelect.disabled = editingLocked;
    refs.purpose.disabled = editingLocked;
    refs.savedSelect.disabled = editingLocked;
    [refs.title, refs.notes, refs.ruleTitle, refs.ruleUri, refs.ruleEdition, refs.ruleSection].forEach(function (input) { input.disabled = editingLocked; });
    root.querySelectorAll("[data-class-key]").forEach(function (input) { input.disabled = editingLocked; });
    root.querySelectorAll("[data-feature-key]").forEach(function (input) {
      const entry = state.byId.get(input.dataset.featureKey);
      input.disabled = editingLocked || state.mode !== "features" || !entry || entry.rawId === null;
    });
    root.querySelectorAll("[data-mode]").forEach(function (button) { button.disabled = editingLocked || !state.source; });
    root.querySelectorAll('[data-action="toggle-exclusion"],[data-action="toggle-exact"]').forEach(function (button) {
      const entry = state.byId.get(button.dataset.key) || state.map.entries.get(button.dataset.key);
      button.disabled = editingLocked || (!!entry && entry.rawId === null);
    });
    if (editingLocked) {
      ["select-classes", "clear-classes", "select-filtered", "clear-filtered", "clear-exclusions", "open-saved", "use-current-version"].forEach(function (action) { setButton(action, true); });
    } else setButton("use-current-version", false);
    refs.versionNotice.hidden = !versionChanged();
    refs.previewState.textContent = state.previewBusy ? "Calculating" : current ? "Current preview" : state.preview ? "Selection changed" : "Preview needed";
    refs.previewState.dataset.current = String(current);
    if (!state.source) refs.readiness.textContent = "Choose a source to begin.";
    else if (versionChanged()) refs.readiness.textContent = "Use the current source version to create a new revision.";
    else if (!hasSelection()) refs.readiness.textContent = state.mode === "features" ? "Choose exact features to include." : "Choose one or more native classes.";
    else if (!current) refs.readiness.textContent = "Preview the current selection before saving.";
    else if (!selectedCount) refs.readiness.textContent = "The current selection contains no features.";
    else if (!named) refs.readiness.textContent = "Name this revision before saving.";
    else if (!referenced) refs.readiness.textContent = "Enter the classification authority title, reference link and edition before saving.";
    else refs.readiness.textContent = "Ready to save " + number(selectedCount) + " selected features.";
    const draftCount = state.entries.filter(includes).length;
    refs.draftCount.textContent = state.source ? number(draftCount) + " of " + number(state.entries.length) + " loaded features included" : "";
    refs.exportInfo.textContent = state.exportBusy ? "Preparing the complete selected data…" : "Data exports include the complete selected features.";
  }
  function changed(options) {
    state.savedRecord = null;
    state.savedFingerprint = "";
    refs.savedInfo.textContent = "";
    refs.copyFallback.hidden = true;
    if (state.saveAttempt && state.saveAttempt.status !== "running" && state.saveAttempt.status !== "unknown") {
      state.saveAttempt = null;
      refs.taskPanel.hidden = true;
    }
    if (!options || options.features !== false) renderFeatureRows();
    renderExclusions();
    updateMapStyles();
    renderInspector();
    updateControls();
  }
  function renderSources() {
    const chosen = state.sourceChoice ? sourceKey(state.sourceChoice) : state.source ? sourceKey(state.source) : refs.sourceSelect.value;
    const role = refs.roleSelect.value;
    const roles = Array.from(new Set(state.sources.map(function (item) { return item.role || ""; }).filter(Boolean))).sort();
    refs.roleSelect.innerHTML = '<option value="">All roles</option>' +
      roles.map(function (value) { return '<option value="' + e(value) + '">' + e(roleLabel(value)) + '</option>'; }).join("");
    refs.roleSelect.value = roles.indexOf(role) >= 0 ? role : "";
    const visible = state.sources.filter(function (item) { return !refs.roleSelect.value || item.role === refs.roleSelect.value; });
    const activeChoice = state.sourceChoice || state.source;
    if (activeChoice && !visible.some(function (item) { return sourceKey(item) === chosen; })) visible.unshift(activeChoice);
    refs.sourceSelect.innerHTML = '<option value="">Choose a source</option>' + visible.map(function (item) {
      const vintage = item.vintage ? " · " + textValue(item.vintage) : "";
      return '<option value="' + e(sourceKey(item)) + '">' + e(sourceTitle(item) + vintage) + '</option>';
    }).join("");
    if (visible.some(function (item) { return sourceKey(item) === chosen; })) refs.sourceSelect.value = chosen;
  }
  function renderSaved() {
    const chosen = refs.savedSelect.value;
    refs.savedSelect.innerHTML = '<option value="">Choose a saved revision</option>' + state.selections.map(function (record) {
      const id = record.id || record.selection_id;
      const stamp = record.saved_at || record.created_at || record.updated_at || "";
      return '<option value="' + e(id || "") + '">' + e(record.title || (record.selection && record.selection.title) || id || "Saved revision") +
        (stamp ? " · " + e(String(stamp).slice(0, 10)) : "") + '</option>';
    }).join("");
    if (state.selections.some(function (record) { return String(record.id || record.selection_id) === chosen; })) refs.savedSelect.value = chosen;
  }
  function renderSourceDetail() {
    if (!state.source) {
      refs.sourceDetail.textContent = "Choose a source to inspect its native features and classifications.";
      return;
    }
    const source = state.source;
    refs.sourceDetail.innerHTML = '<strong>' + e(sourceTitle(source)) + '</strong><span>' +
      e(roleLabel(source.role)) + '</span>' +
      (source.vintage ? '<span>Vintage: ' + e(textValue(source.vintage)) + '</span>' : "") +
      '<span>Feature ID: <b>' + e(state.idField || "Source feature ID") + '</b></span>' +
      '<span>Class field: <b>' + e(state.classField || "None") + '</b></span>' +
      (source.sha256 ? '<details><summary>Source fingerprint</summary><code>' + e(source.sha256) + '</code></details>' : "");
  }
  function renderClassList() {
    refs.classPane.hidden = state.mode !== "classes";
    root.querySelectorAll("[data-mode]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
    });
    refs.modeHelp.textContent = state.mode === "classes"
      ? "Class values are matched exactly as written. Counts cover the complete source."
      : state.mode === "features"
        ? "Choose exact native IDs from loaded records. Exclusions are applied after inclusion."
        : "Every source feature is included, with any explicit exclusions removed.";
    const items = visibleClasses();
    refs.classCount.textContent = state.classes.length ? number(state.classValues.size) + " selected" : "";
    refs.classList.innerHTML = items.length ? items.map(function (item) {
      const key = classKey(item.value);
      return '<label class="wd-class-row"><input type="checkbox" data-class-key="' + e(key) + '"' +
        (state.classValues.has(key) ? " checked" : "") + (state.loading || state.saveBusy ? " disabled" : "") + '>' +
        '<span>' + e(classLabel(item.value)) + '</span><span class="wd-count">' + number(item.count) + '</span></label>';
    }).join("") : '<p class="wd-empty">' + (state.source ? "No matching native class values." : "Load a source to see its classes.") + '</p>';
  }
  function renderFeatureRows() {
    const matched = matchedEntries();
    const rows = matched.slice(0, state.visibleRows);
    refs.featureRows.innerHTML = rows.length ? rows.map(function (entry) {
      const excluded = state.excludeIds.has(entry.id);
      const disabled = state.mode !== "features" || entry.rawId === null || state.loading || state.saveBusy;
      return '<tr class="' + (includes(entry) ? "wd-row-included " : "") + (excluded ? "wd-row-excluded " : "") +
        (state.inspectedId === entry.id ? "wd-row-inspected" : "") + '">' +
        '<td class="wd-check-col"><input type="checkbox" data-feature-key="' + e(entry.id) + '" aria-label="Include ' + e(entry.name) + '"' +
        (baseIncludes(entry) ? " checked" : "") + (disabled ? " disabled" : "") + '></td>' +
        '<td><button type="button" class="wd-feature-name" data-action="inspect-feature" data-key="' + e(entry.id) + '">' + e(entry.name) + '</button>' +
        '<span class="wd-native-id">' + e(entry.rawId === null ? "Native ID missing" : String(entry.rawId)) + '</span></td>' +
        '<td class="wd-class-cell">' + e(classLabel(entry.classValue)) + '</td>' +
        '<td><button type="button" class="wd-exclude-button" data-action="toggle-exclusion" data-key="' + e(entry.id) + '"' +
        (entry.rawId === null || state.loading || state.saveBusy ? " disabled" : "") + ' aria-pressed="' + excluded + '">' +
        (excluded ? "Restore" : "Exclude") + '</button></td></tr>';
    }).join("") : '<tr><td colspan="4" class="wd-empty">' + (state.source ? "No loaded features match this search." : "No source features loaded.") + '</td></tr>';
    const selectable = matched.filter(function (entry) { return entry.rawId !== null; });
    const checked = selectable.filter(function (entry) { return state.featureIds.has(entry.id); }).length;
    refs.allLoaded.checked = state.mode === "features" && selectable.length > 0 && checked === selectable.length;
    refs.allLoaded.indeterminate = state.mode === "features" && checked > 0 && checked < selectable.length;
    refs.loadedCount.textContent = state.source ? number(state.entries.length) + " / " + number(state.totalFeatures) + " loaded" : "No source loaded";
    refs.featureMatchCount.textContent = state.source ? number(matched.length) + " loaded matches" : "";
    refs.paginationInfo.textContent = matched.length > rows.length
      ? "Showing " + number(rows.length) + " of " + number(matched.length) + " loaded matches"
      : state.source && state.entries.length < state.totalFeatures
        ? "Search currently covers " + number(state.entries.length) + " loaded features."
        : "";
    setVisible("more-rows", matched.length > rows.length);
  }
  function renderExclusions() {
    refs.exclusionList.innerHTML = state.excludeIds.size ? Array.from(state.excludeIds).sort().map(function (id) {
      return '<button type="button" class="wd-id-chip" data-action="toggle-exclusion" data-key="' + e(id) + '" aria-label="Remove exclusion for native ID ' + e(id) + '">' +
        e(id) + '<span aria-hidden="true"> ×</span></button>';
    }).join("") : '<span class="wd-small">No exclusions.</span>';
  }
  function renderMetrics() {
    const data = state.preview;
    const summary = data && data.summary;
    refs.metricFeatures.textContent = summary ? number(summary.selected_features) : "—";
    refs.metricLength.textContent = summary && summary.length_km !== null && summary.length_km !== undefined
      ? number(summary.length_km, 3) + " km" : "—";
    refs.metricArea.textContent = summary && summary.area_km2 !== null && summary.area_km2 !== undefined
      ? number(summary.area_km2, 3) + " km²" : "—";
    refs.previewDetails.textContent = summary
      ? number(summary.selected_features) + " selected from " + number(summary.total_features === undefined ? state.totalFeatures : summary.total_features) +
        " source features. Totals include the complete selection."
      : "Preview the selection to calculate totals across the complete source.";
    let notes = data && (data.measure_notes || (summary && summary.measure_notes));
    if (notes && typeof notes === "object" && !Array.isArray(notes)) notes = Object.values(notes);
    refs.measureNotes.textContent = Array.isArray(notes) ? notes.filter(Boolean).join(" ") : notes || "";
    refs.measureNotes.hidden = !refs.measureNotes.textContent;
  }
  function inspectorEntry() {
    return state.byId.get(state.inspectedId) || state.map.entries.get(state.inspectedId);
  }
  function renderInspector() {
    const entry = inspectorEntry();
    if (!entry) {
      refs.inspectorId.textContent = "";
      refs.inspector.innerHTML = '<p class="wd-empty">Choose a feature in the table or map to inspect its source fields.</p>';
      return;
    }
    refs.inspectorId.textContent = entry.rawId === null ? "Native ID missing" : "Native ID " + entry.rawId;
    const excluded = state.excludeIds.has(entry.id);
    const keys = Object.keys(entry.properties);
    refs.inspector.innerHTML = '<div class="wd-inspector-title"><strong>' + e(entry.name) + '</strong><span class="wd-status-badge">' +
      (excluded ? "Excluded" : includes(entry) ? "Included" : "Outside selection") + '</span></div>' +
      '<div class="wd-inspector-actions">' +
      (state.mode === "features" && entry.rawId !== null
        ? '<button type="button" class="wd-button" data-action="toggle-exact" data-key="' + e(entry.id) + '">' +
          (state.featureIds.has(entry.id) ? "Remove exact feature" : "Include exact feature") + '</button>' : "") +
      (entry.rawId !== null ? '<button type="button" class="wd-button" data-action="toggle-exclusion" data-key="' + e(entry.id) + '">' +
        (excluded ? "Remove exclusion" : "Exclude this feature") + '</button>' : "") + '</div>' +
      '<div class="wd-properties-wrap"><table class="wd-properties"><tbody>' + keys.map(function (key) {
        return '<tr><th scope="row">' + e(key) + '</th><td>' + e(textValue(entry.properties[key])) + '</td></tr>';
      }).join("") + '</tbody></table></div>';
  }
  function appendFeatures(features, prefix) {
    (features || []).forEach(function (feature, index) {
      const entry = makeEntry(feature, index, prefix || "source");
      if (state.byId.has(entry.id)) return;
      state.entries.push(entry);
      state.byId.set(entry.id, entry);
      if (entry.rawId !== null) state.idValues.set(entry.id, entry.rawId);
    });
  }
  function readPageOffset(data, received, previousOffset) {
    if (Object.prototype.hasOwnProperty.call(data, "next_offset")) {
      return data.next_offset === null || data.next_offset === undefined ? null : Number(data.next_offset);
    }
    const total = Number(data.total_features || state.totalFeatures || 0);
    const offset = Number(previousOffset || 0) + received;
    return received > 0 && offset < total ? offset : null;
  }
  function renderSourceContext() {
    const context = state.sourceContext;
    refs.reviewContext.hidden = !context;
    if (!context) {
      refs.reviewContextCount.textContent = "";
      refs.reviewContextBody.innerHTML = "";
      return;
    }
    const legal = context.legal_record_context;
    const records = Array.isArray(legal) ? legal : (legal && Array.isArray(legal.records) ? legal.records : []);
    const links = Array.isArray(context.source_feature_refs) ? context.source_feature_refs : [];
    const associations = Array.isArray(context.legal_associations) ? context.legal_associations : [];
    const relations = { coextensive: "Explicit coextensive geometry", partial: "Partial geometry association", candidate: "Candidate for reach review" };
    refs.reviewContextCount.textContent = number(records.length) + " legal records · " + number(links.length) + " native references";
    const ids = links.map(function (reference) {
      return reference && typeof reference === "object" ? reference.feature_id : reference;
    });
    refs.reviewContextBody.innerHTML = '<p class="wd-small">Original native IDs: ' + e(ids.map(textValue).join(", ")) + '</p>' +
      (records.length ? '<div class="wd-properties-wrap"><table class="wd-properties"><tbody>' + records.map(function (item) {
        const record = item.record || item;
        const id = record.id || item.record_id || "";
        const edition = item.edition || record.edition || {};
        const linked = associations.filter(function (association) { return String(association.registry_record_id) === String(id); });
        const relation = Array.from(new Set(linked.map(function (association) { return association.geometry_relation; }).filter(Boolean)))
          .map(function (value) { return relations[value] || value; }).join("; ");
        return '<tr><th scope="row">' + e(record.waterbody_name || id || "Legal record") +
          (id ? '<br><span class="wd-small">' + e(id) + '</span>' : "") +
          (edition.id ? '<br><span class="wd-small">' + e(edition.id) + '</span>' : "") + '</th><td>' +
          (record.reach_description ? '<p>' + e(record.reach_description) + '</p>' : "") +
          (relation ? '<p>' + e(relation) + '</p>' : "") + '</td></tr>';
      }).join("") + '</tbody></table></div>' : "");
  }
  function applyDraft(draft) {
    state.mode = ["classes", "features", "all"].indexOf(draft.selection_mode) >= 0 ? draft.selection_mode : "classes";
    state.classValues = new Map((draft.class_values || []).map(function (value) { return [classKey(value), value]; }));
    state.featureIds = new Set((draft.feature_ids || []).map(String));
    state.excludeIds = new Set((draft.exclude_ids || []).map(String));
    (draft.feature_ids || []).concat(draft.exclude_ids || []).forEach(function (id) { state.idValues.set(String(id), id); });
    refs.purpose.value = PURPOSES[draft.purpose] ? draft.purpose : "high_quality_waters";
    refs.title.value = draft.title || "";
    refs.notes.value = Array.isArray(draft.notes) ? draft.notes.join("\n") : draft.notes || "";
    const rule = draft.rule_reference || {};
    refs.ruleTitle.value = rule.title || "";
    refs.ruleUri.value = rule.uri || "";
    refs.ruleEdition.value = rule.edition || "";
    refs.ruleSection.value = rule.section || "";
    state.expectedSHA = draft.expected_source_sha256 || (state.source && state.source.sha256) || "";
    state.sourceContext = draft.source_context && typeof draft.source_context === "object" && !Array.isArray(draft.source_context)
      ? draft.source_context : null;
    renderSourceContext();
  }
  async function refresh() {
    if (destroyed) return;
    state.inventoryLoading = true; updateControls();
    try {
      const data = await api(query("/api/water-designations", { workspace: workspace() }));
      if (destroyed) return;
      state.sources = Array.isArray(data.sources) ? data.sources : [];
      state.selections = Array.isArray(data.selections) ? data.selections : [];
      renderSources(); renderSaved();
      if (!state.sources.length) notice("No designation sources are available in this workspace yet.", "info");
    } catch (error) { fail(error, "Could not refresh designation sources."); }
    finally { state.inventoryLoading = false; updateControls(); }
  }
  async function loadSource(source, saved) {
    if (!source || destroyed) return;
    const epoch = ++state.sourceEpoch;
    state.sourceChoice = source;
    state.loading = true; notice("Loading " + sourceTitle(source) + "…"); updateControls();
    try {
      const draft = saved && saved.selection;
      const data = await post("/api/water-designations/inspect", {
        workspace: workspace(), source_collection_id: source.source_collection_id,
        source_id: source.source_id, layer: (draft && draft.layer) || source.layer || undefined,
        id_field: (draft && draft.id_field) || refs.idFieldOverride.value.trim() || undefined,
        class_field: (draft && draft.class_field) || source.class_field || undefined,
        offset: 0, limit: PAGE_SIZE
      });
      if (destroyed || epoch !== state.sourceEpoch) return;
      state.source = Object.assign({}, source, data.source || {});
      state.sourceChoice = state.source;
      state.data = data;
      state.idField = data.id_field || state.source.id_field || (draft && draft.id_field) || "";
      state.classField = Object.prototype.hasOwnProperty.call(data, "class_field") ? (data.class_field || "") : ((draft && draft.class_field) || state.source.class_field || "H2OCLASS");
      refs.idFieldOverride.value = state.idField;
      state.entries = []; state.byId = new Map(); state.idValues = new Map();
      state.classes = Array.isArray(data.classes) ? data.classes.map(function (item) {
        return { value: item.value === undefined ? null : item.value, count: Number(item.count || 0) };
      }) : [];
      state.totalFeatures = Number(data.total_features || 0);
      state.nextOffset = readPageOffset(data, (data.features || []).length, 0);
      state.visibleRows = 100; state.inspectedId = null;
      state.preview = null; state.previewFingerprint = ""; state.previewFeatures = []; state.previewNext = null;
      state.map.home = null; state.map.view = null;
      state.saveAttempt = null; refs.taskPanel.hidden = true;
      refs.featureSearch.value = ""; refs.classSearch.value = "";
      appendFeatures(data.features || [], "source");
      applyDraft(draft || {
        title: "", purpose: refs.purpose.value, selection_mode: state.classField ? "classes" : "features",
        rule_reference: state.source.rule_reference || {}, expected_source_sha256: state.source.sha256
      });
      state.savedRecord = saved ? saved.record : null;
      state.revisionOf = state.savedRecord ? state.savedRecord.id || state.savedRecord.selection_id : (draft && draft.revision_of) || null;
      state.savedFingerprint = state.savedRecord ? JSON.stringify(selection()) : "";
      if (state.savedRecord && state.savedRecord.summary && !versionChanged()) {
        state.preview = { summary: state.savedRecord.summary, measure_notes: state.savedRecord.measure_notes || [], geojson: { type: "FeatureCollection", features: [] } };
        state.previewFingerprint = geometryFingerprint();
        state.previewFeatures = state.entries.filter(includes).map(function (entry) { return entry.feature; });
        const savedCount = Number(state.savedRecord.summary.selected_features || 0);
        state.previewNext = state.previewFeatures.length < savedCount ? state.previewFeatures.length : null;
      }
      if (!state.sources.some(function (item) { return sameSource(item, state.source); })) state.sources.push(state.source);
      if (refs.roleSelect.value && state.source.role !== refs.roleSelect.value) refs.roleSelect.value = "";
      renderSources(); renderSourceDetail(); renderClassList(); renderFeatureRows(); renderExclusions();
      renderMetrics(); renderInspector(); renderMap(true);
      refs.savedInfo.textContent = state.savedRecord ? "Opened " + (state.savedRecord.title || refs.title.value || "saved revision") : "";
      notice("Loaded " + number(state.entries.length) + " of " + number(state.totalFeatures) + " source features.", "success");
      return true;
    } catch (error) { fail(error, "Could not load this source."); return false; }
    finally {
      if (epoch === state.sourceEpoch) { state.loading = false; renderSources(); renderClassList(); renderFeatureRows(); updateControls(); }
    }
  }
  async function loadMore() {
    if (!state.source || state.nextOffset === null || state.loadingMore) return;
    const epoch = state.sourceEpoch;
    const offset = state.nextOffset;
    state.loadingMore = true; updateControls();
    try {
      const data = await post("/api/water-designations/inspect", {
        workspace: workspace(), source_collection_id: state.source.source_collection_id,
        source_id: state.source.source_id, layer: state.source.layer || undefined,
        id_field: state.idField || undefined, class_field: state.classField || undefined,
        offset: offset, limit: PAGE_SIZE
      });
      if (destroyed || epoch !== state.sourceEpoch) return;
      if (data.source && data.source.sha256 && state.source.sha256 && data.source.sha256 !== state.source.sha256) {
        throw new Error("The source changed while paging. Reload it to work with one consistent version.");
      }
      appendFeatures(data.features || [], String(offset));
      state.nextOffset = readPageOffset(data, (data.features || []).length, offset);
      if (state.nextOffset !== null && state.nextOffset <= offset) {
        state.nextOffset = null;
        throw new Error("The source did not advance to the next page. Reload the source before continuing.");
      }
      renderFeatureRows(); renderMap(false);
      notice("Loaded " + number(state.entries.length) + " of " + number(state.totalFeatures) + " source features.");
    } catch (error) { fail(error, "Could not load more source features."); }
    finally { state.loadingMore = false; updateControls(); }
  }
  async function openSaved() {
    const id = refs.savedSelect.value;
    if (!id || state.loading || state.saveBusy) return;
    try {
      const response = await api(query("/api/water-designations/item", { workspace: workspace(), id: id }));
      const record = response.record || response.item || response;
      const draft = record.selection || record;
      const source = state.sources.find(function (item) { return sameSource(item, draft); }) || {
        source_collection_id: draft.source_collection_id, source_id: draft.source_id,
        layer: draft.layer, title: record.source_title || draft.source_id
      };
      await loadSource(source, { selection: draft, record: record });
    } catch (error) { fail(error, "Could not open this saved revision."); }
  }
  async function preview(more) {
    if (!hasSelection() || state.previewBusy || state.previewMoreBusy || versionChanged()) return;
    if (more && (!previewCurrent() || state.previewNext === null)) return;
    const current = selection();
    const fingerprint = geometryFingerprint(current);
    const epoch = ++state.previewEpoch;
    const sourceEpoch = state.sourceEpoch;
    const offset = more ? state.previewNext : 0;
    if (more) state.previewMoreBusy = true; else state.previewBusy = true;
    updateControls();
    try {
      const response = await post("/api/water-designations/preview", {
        workspace: workspace(), selection: current, offset: offset, limit: PAGE_SIZE
      });
      if (destroyed || epoch !== state.previewEpoch || sourceEpoch !== state.sourceEpoch) return;
      if (!response.summary || !response.geojson || !Array.isArray(response.geojson.features)) {
        throw new Error("The server did not return a selection summary and feature geometry.");
      }
      const incoming = response.geojson.features;
      if (more) {
        const seen = new Set(state.previewFeatures.map(function (feature) { return String(nativeId(feature)); }));
        incoming.forEach(function (feature) {
          const id = nativeId(feature);
          if (id === null || !seen.has(String(id))) {
            state.previewFeatures.push(feature);
            if (id !== null) seen.add(String(id));
          }
        });
      } else {
        state.previewFeatures = incoming.slice();
      }
      state.preview = response;
      state.previewFingerprint = fingerprint;
      const total = Number(response.summary.selected_features || 0);
      if (Object.prototype.hasOwnProperty.call(response, "next_offset")) {
        state.previewNext = response.next_offset === null ? null : Number(response.next_offset);
      } else {
        const next = Number(offset || 0) + incoming.length;
        state.previewNext = incoming.length > 0 && next < total ? next : null;
      }
      if (more && state.previewNext !== null && state.previewNext <= Number(offset)) state.previewNext = null;
      renderMetrics(); renderMap(!more); renderInspector();
      notice(previewCurrent()
        ? "Preview updated: " + number(total) + " selected features across the complete source."
        : "The earlier preview finished. Preview again to calculate the current selection.", "success");
    } catch (error) { fail(error, "Could not preview the selection."); }
    finally {
      if (epoch === state.previewEpoch) { state.previewBusy = false; state.previewMoreBusy = false; updateControls(); }
    }
  }
  function eachCoordinate(geometry, visit) {
    if (!geometry) return;
    if (geometry.type === "GeometryCollection") {
      (geometry.geometries || []).forEach(function (item) { eachCoordinate(item, visit); }); return;
    }
    function walk(value) {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
        if (Number.isFinite(value[0]) && Number.isFinite(value[1])) visit(value[0], value[1]);
      } else value.forEach(walk);
    }
    walk(geometry.coordinates);
  }
  function geometryBounds(entries) {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    entries.forEach(function (entry) {
      eachCoordinate(entry.feature.geometry, function (x, y) {
        box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
      });
    });
    return box.every(Number.isFinite) ? box : null;
  }
  function validBBox(box) {
    return Array.isArray(box) && box.length >= 4 && box.slice(0, 4).every(Number.isFinite) && box[2] >= box[0] && box[3] >= box[1];
  }
  function project(coordinate) {
    return [coordinate[0] * state.map.cosLatitude, -coordinate[1]];
  }
  function pathData(geometry) {
    const out = { polygon: [], line: [], point: [] };
    function point(value) {
      if (!Array.isArray(value) || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) return null;
      const p = project(value);
      return p[0].toFixed(7) + " " + p[1].toFixed(7);
    }
    function line(values, close) {
      let result = "", open = false;
      (values || []).forEach(function (value) {
        const p = point(value);
        if (!p) { open = false; return; }
        result += (open ? "L" : "M") + p;
        open = true;
      });
      return result && close ? result + "Z" : result;
    }
    function walk(item) {
      if (!item) return;
      const c = item.coordinates;
      if (item.type === "Point") { const p = point(c); if (p) out.point.push("M" + p + "l0.000000001 0"); }
      else if (item.type === "MultiPoint") (c || []).forEach(function (p) { walk({ type: "Point", coordinates: p }); });
      else if (item.type === "LineString") out.line.push(line(c, false));
      else if (item.type === "MultiLineString") (c || []).forEach(function (l) { out.line.push(line(l, false)); });
      else if (item.type === "Polygon") out.polygon.push((c || []).map(function (ring) { return line(ring, true); }).join(""));
      else if (item.type === "MultiPolygon") (c || []).forEach(function (p) { walk({ type: "Polygon", coordinates: p }); });
      else if (item.type === "GeometryCollection") (item.geometries || []).forEach(walk);
    }
    walk(geometry);
    return out;
  }
  function projectedView(box) {
    const lower = project([box[0], box[3]]);
    const upper = project([box[2], box[1]]);
    const width = Math.max(upper[0] - lower[0], 0.001);
    const height = Math.max(upper[1] - lower[1], 0.001);
    return [lower[0] - width * 0.06, lower[1] - height * 0.06, width * 1.12, height * 1.12];
  }
  function renderMap(fit) {
    const entries = new Map(state.byId);
    if (previewCurrent()) {
      state.previewFeatures.forEach(function (feature, index) {
        const entry = makeEntry(feature, index, "preview");
        if (!entries.has(entry.id)) entries.set(entry.id, entry);
        if (entry.rawId !== null) state.idValues.set(entry.id, entry.rawId);
      });
    }
    state.map.entries = entries;
    const array = Array.from(entries.values());
    const sourceBox = state.data && validBBox(state.data.bbox) ? state.data.bbox.slice(0, 4) : geometryBounds(array);
    const selectedBox = previewCurrent() && state.preview.summary && validBBox(state.preview.summary.bbox)
      ? state.preview.summary.bbox.slice(0, 4) : null;
    const homeBox = selectedBox || sourceBox;
    if (!homeBox) {
      refs.mapGeometry.replaceChildren(); refs.mapEmpty.hidden = false; refs.mapScale.hidden = true;
      refs.mapEmpty.textContent = state.source ? "The loaded features have no displayable geometry." : "Load a source to view its geometry.";
      refs.mapCaption.textContent = state.source ? "No displayable geometry in the currently loaded records." : "The preview uses the source geometry.";
      return;
    }
    if (!state.map.home || fit) {
      state.map.latitude = ((sourceBox || homeBox)[1] + (sourceBox || homeBox)[3]) / 2;
      state.map.cosLatitude = Math.max(0.01, Math.cos(state.map.latitude * Math.PI / 180));
    }
    state.map.home = projectedView(homeBox);
    if (!state.map.view || fit) state.map.view = state.map.home.slice();
    const fragment = document.createDocumentFragment();
    array.forEach(function (entry) {
      const parts = pathData(entry.feature.geometry);
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("data-map-key", entry.id);
      Object.keys(parts).forEach(function (kind) {
        const d = parts[kind].filter(Boolean).join("");
        if (!d) return;
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        path.setAttribute("class", "wd-geometry-" + kind);
        path.setAttribute("vector-effect", "non-scaling-stroke");
        if (kind === "polygon") path.setAttribute("fill-rule", "evenodd");
        group.appendChild(path);
      });
      if (group.childNodes.length) fragment.appendChild(group);
    });
    refs.mapGeometry.replaceChildren(fragment);
    refs.mapEmpty.hidden = !!refs.mapGeometry.childNodes.length;
    updateMapStyles(); setView(state.map.view);
    const sourceTotal = number(state.totalFeatures);
    const shown = number(entries.size);
    const previewText = previewCurrent()
      ? " Selected geometry loaded: " + number(state.previewFeatures.length) + " / " + number(state.preview.summary.selected_features) + "."
      : " Preview the selection for complete totals.";
    refs.mapCaption.textContent = sourceTitle(state.source) + " · " + shown + " loaded feature records from " + sourceTotal + " source features." + previewText;
  }
  function updateMapStyles() {
    refs.mapGeometry.querySelectorAll("[data-map-key]").forEach(function (group) {
      const entry = state.map.entries.get(group.getAttribute("data-map-key"));
      if (!entry) return;
      const excluded = state.excludeIds.has(entry.id);
      group.setAttribute("class", "wd-map-feature" + (includes(entry) ? " wd-map-included" : "") +
        (excluded ? " wd-map-excluded" : "") + (entry.id === state.inspectedId ? " wd-map-inspected" : ""));
    });
    if (state.preview && !previewCurrent()) {
      refs.mapCaption.textContent = sourceTitle(state.source) + " · " + number(state.entries.length) + " loaded source features. Selection changed; update the preview for complete totals.";
    }
  }
  function setView(view) {
    if (!view || !view.every(Number.isFinite) || view[2] <= 0 || view[3] <= 0) return;
    state.map.view = view;
    refs.map.setAttribute("viewBox", view.join(" "));
    const width = refs.map.clientWidth || 600;
    const height = refs.map.clientHeight || 380;
    const degreesPerPixel = Math.max(view[2] / width, view[3] / height);
    const targetKm = degreesPerPixel * 100 * 111.195;
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(targetKm, 0.000001))));
    const distance = [1, 2, 5, 10].map(function (n) { return n * magnitude; })
      .filter(function (n) { return n <= targetKm; }).pop() || magnitude;
    const scaleWidth = distance / (111.195 * degreesPerPixel);
    refs.mapScale.hidden = false;
    refs.mapScale.style.width = Math.max(15, Math.min(160, scaleWidth)) + "px";
    refs.mapScale.textContent = distance < 1 ? number(distance * 1000, 1) + " m" : number(distance, 2) + " km";
    refs.mapScale.title = "Approximate map scale at " + state.map.latitude.toFixed(3) + "° latitude";
  }
  function mapPoint(event) {
    const matrix = refs.map.getScreenCTM();
    if (!matrix) return null;
    const point = refs.map.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const result = point.matrixTransform(matrix.inverse());
    return [result.x, result.y];
  }
  function zoom(factor, anchor) {
    const view = state.map.view;
    if (!view) return;
    const point = anchor || [view[0] + view[2] / 2, view[1] + view[3] / 2];
    const width = view[2] * factor, height = view[3] * factor;
    if (width < 0.0000001 || width > 720) return;
    setView([point[0] - (point[0] - view[0]) * factor, point[1] - (point[1] - view[1]) * factor, width, height]);
  }
  function inspectFeature(id) {
    state.inspectedId = id;
    renderFeatureRows(); renderInspector(); updateMapStyles();
  }
  function toggleExclusion(id) {
    if (!id || state.saveBusy || state.loading) return;
    if (state.excludeIds.has(id)) state.excludeIds.delete(id);
    else state.excludeIds.add(id);
    changed();
  }
  function toggleExact(id) {
    if (!id || state.mode !== "features" || state.saveBusy || state.loading) return;
    if (state.featureIds.has(id)) state.featureIds.delete(id); else state.featureIds.add(id);
    changed();
  }
  function chooseFiltered(include) {
    if (state.mode !== "features" || state.saveBusy || state.loading) return;
    matchedEntries().forEach(function (entry) {
      if (entry.rawId === null) return;
      if (include) state.featureIds.add(entry.id); else state.featureIds.delete(entry.id);
    });
    changed();
  }
  function operationId() {
    const uuid = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Date.now().toString(36) + "_" + Math.random().toString(36).slice(2) + "_" + Math.random().toString(36).slice(2);
    return "water-designation_" + uuid;
  }
  function taskObject(response) {
    return response && (response.task || response);
  }
  function taskState(task) {
    return String((task && (task.status || task.state)) || "queued").toLowerCase().replace(/[ -]/g, "_");
  }
  function showTask(task, label) {
    const status = taskState(task);
    refs.taskPanel.hidden = false;
    refs.taskStatus.textContent = label || (status === "queued" || status === "pending" ? "Save queued" :
      status === "running" || status === "in_progress" ? "Saving revision" : titleCase(status));
    const detail = task && (task.message || task.detail || task.stage || task.progress_message);
    refs.taskDetail.textContent = typeof detail === "string" ? detail : state.saveAttempt && state.saveAttempt.taskId
      ? "Task " + state.saveAttempt.taskId : "";
    const progress = task && task.progress;
    const percent = typeof progress === "number" ? (progress >= 0 && progress <= 1 ? progress * 100 : progress)
      : progress && typeof progress.percent === "number" ? progress.percent : null;
    refs.taskProgress.hidden = percent === null;
    if (percent !== null) refs.taskProgress.value = Math.max(0, Math.min(100, percent));
  }
  function findSavedId(task) {
    const result = task && (task.result || task.output || task.outcome || {});
    return (result && (result.selection_id || result.saved_selection_id || result.id ||
      (result.record && (result.record.id || result.record.selection_id)) ||
      (result.selection && (result.selection.id || result.selection.selection_id)))) ||
      (task && task.selection_id) || null;
  }
  async function finishSave(task, attempt) {
    attempt.status = "succeeded";
    showTask(task, "Revision saved");
    setVisible("resume-save", false);
    await refresh();
    if (destroyed || state.saveAttempt !== attempt) return;
    let id = findSavedId(task);
    if (!id) {
      const match = state.selections.find(function (record) { return record.operation_id === attempt.operationId; });
      if (match) id = match.id || match.selection_id;
    }
    if (id) {
      const response = await api(query("/api/water-designations/item", { workspace: workspace(), id: id }));
      if (destroyed || state.saveAttempt !== attempt) return;
      state.savedRecord = response.record || response.item || response;
      state.savedFingerprint = attempt.fingerprint;
      refs.savedSelect.value = String(id);
      refs.savedInfo.textContent = "Saved: " + (state.savedRecord.title || attempt.selection.title);
    }
    state.saveBusy = false;
    notice("Saved revision “" + attempt.selection.title + "”.", "success");
    updateControls();
    if (typeof onSaved === "function") {
      try {
        await onSaved({ task: task, record: state.savedRecord, selection: attempt.selection, operation_id: attempt.operationId });
      } catch (error) { fail(error, "The revision was saved, but the workspace refresh failed."); }
    }
  }
  async function pollSave() {
    const attempt = state.saveAttempt;
    if (!attempt || !attempt.taskId || destroyed) return;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    state.saveBusy = true; setVisible("resume-save", false); updateControls();
    try {
      const response = await api(query(taskStatusPath, { id: attempt.taskId }));
      if (destroyed || state.saveAttempt !== attempt) return;
      const task = taskObject(response);
      const status = taskState(task);
      showTask(task);
      if (["succeeded", "success", "completed", "complete", "done", "finished"].indexOf(status) >= 0) {
        try { await finishSave(task, attempt); }
        catch (error) {
          state.saveBusy = false;
          showTask(task, "Revision saved · refresh needed");
          fail(error, "The save completed, but its saved revision could not be reopened.");
          updateControls();
        }
        return;
      }
      if (["failed", "error", "cancelled", "canceled", "rejected", "interrupted", "aborted"].indexOf(status) >= 0) {
        state.saveBusy = false; attempt.status = "failed";
        const detail = task.error || task.message || task.detail || "The background save did not complete.";
        showTask(task, "Save failed");
        fail(new Error(errorMessage(detail)));
        updateControls(); return;
      }
      attempt.status = "running";
      pollTimer = setTimeout(pollSave, Math.max(750, Number(pollIntervalMs) || 1500));
    } catch (error) {
      if (destroyed) return;
      state.saveBusy = false; attempt.status = "unknown";
      showTask({ status: "unknown", message: "The task is retained. Check its status to continue." }, "Save status unavailable");
      setVisible("resume-save", true);
      fail(error, "Could not read the save task.");
      updateControls();
    }
  }
  async function save() {
    if (!previewCurrent() || !hasSelection() || state.saveBusy || versionChanged()) return;
    if (!refs.title.value.trim()) { refs.title.focus(); notice("Name this revision before saving.", "error"); return; }
    if (refs.purpose.value === "high_quality_waters") {
      const missing = [refs.ruleTitle, refs.ruleUri, refs.ruleEdition].find(function (input) { return !input.value.trim(); });
      if (missing) { missing.focus(); notice("Enter the classification authority title, reference link and edition before saving.", "error"); return; }
    }
    const draft = selection();
    const fingerprint = JSON.stringify(draft);
    if (state.saveAttempt && state.saveAttempt.taskId && state.saveAttempt.status === "unknown") { await pollSave(); return; }
    const prior = state.saveAttempt;
    const reuse = prior && !prior.taskId && prior.fingerprint === fingerprint && prior.status === "unknown";
    const attempt = reuse ? prior : {
      operationId: operationId(), fingerprint: fingerprint, selection: draft, status: "starting", taskId: null
    };
    state.saveAttempt = attempt; state.saveBusy = true;
    showTask({ status: "queued", message: "Submitting this revision to the workspace task queue." }, "Submitting save");
    setVisible("resume-save", false); updateControls(); renderFeatureRows(); renderClassList();
    try {
      const response = await post("/api/actions", {
        workspace: workspace(), action: "water-designation.save",
        payload: { selection: attempt.selection }, operation_id: attempt.operationId
      });
      if (destroyed || state.saveAttempt !== attempt) return;
      const task = taskObject(response);
      const id = (task && (task.task_id || task.id)) || response.task_id;
      if (!id) throw new Error("The save request returned no task ID. Retry will reuse the same operation ID.");
      attempt.taskId = String(id); attempt.status = "running";
      showTask(task);
      await pollSave();
    } catch (error) {
      if (destroyed) return;
      state.saveBusy = false; attempt.status = "unknown";
      showTask({ status: "unknown", message: "Retry keeps the same operation ID to avoid creating a duplicate revision." }, "Save receipt unavailable");
      fail(error, "Could not obtain the save task.");
      updateControls(); renderFeatureRows(); renderClassList();
    }
  }
  function filename(extension) {
    return (refs.title.value.trim() || sourceTitle(state.source) || "water-designation")
      .replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) + extension;
  }
  function downloadBlob(data, type, name) {
    const blob = new Blob([data], { type: type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = name;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }
  async function exportData(format) {
    if (!previewCurrent() || state.exportBusy) return;
    state.exportBusy = true; updateControls();
    try {
      const response = await post("/api/water-designations/export", {
        workspace: workspace(), selection: selection(), format: format
      });
      if (destroyed) return;
      const url = response.download_url || response.url;
      if (url) {
        const parsed = new URL(url, window.location.href);
        if (["http:", "https:", "blob:"].indexOf(parsed.protocol) < 0) throw new Error("The server returned an unsupported download URL.");
        const anchor = document.createElement("a");
        anchor.href = parsed.href;
        anchor.download = response.filename || filename(format === "geojson" ? ".geojson" : ".csv");
        anchor.rel = "noopener";
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
      } else if (format === "geojson" && response.geojson) {
        const data = response.geojson;
        const count = Array.isArray(data.features) ? data.features.length : 0;
        if (response.partial || count < Number(response.total_features === undefined ? state.preview.summary.selected_features : response.total_features)) {
          throw new Error("The export response contains only part of the selection. Request the full download again.");
        }
        downloadBlob(JSON.stringify(data, null, 2), "application/geo+json", response.filename || filename(".geojson"));
      } else if (format === "csv" && typeof response.csv === "string") {
        if (response.partial) throw new Error("The export response contains only part of the selected rows.");
        downloadBlob(response.csv, "text/csv;charset=utf-8", response.filename || filename(".csv"));
      } else throw new Error("The server did not provide the requested full data download.");
      notice("Prepared the complete selected " + (format === "geojson" ? "GeoJSON" : "source rows CSV") + " download.", "success");
    } catch (error) { fail(error, "Could not export the selected data."); }
    finally { state.exportBusy = false; updateControls(); }
  }
  async function prepareDeliverySelection() {
    const record = state.savedRecord;
    const selectionId = record && (record.id || record.selection_id);
    if (!selectionId || !record.delivery_overlay) throw new Error("Open a saved revision before using it in delivery.");
    const selectedWorkspace = workspace();
    state.deliveryBusy = true; updateControls();
    try {
      const delivery = await post("/api/water-designations/apply", {
        workspace: selectedWorkspace, selection_id: selectionId, delivery_selection: {}
      });
      if (destroyed || workspace() !== selectedWorkspace || state.savedRecord !== record) {
        throw new Error("The saved revision changed before the delivery choice was ready.");
      }
      if (!delivery || !delivery.overlays || !delivery.source_roles) {
        throw new Error("The operator did not return the saved overlay and its source references.");
      }
      return { record: record, delivery: delivery };
    } finally {
      state.deliveryBusy = false; updateControls();
    }
  }
  async function copyDelivery() {
    if (!state.savedRecord || !state.savedRecord.delivery_overlay || state.deliveryBusy) return;
    let prepared;
    try { prepared = await prepareDeliverySelection(); }
    catch (error) { fail(error, "Could not prepare the saved delivery selection."); return; }
    const value = JSON.stringify(prepared.delivery, null, 2);
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      notice("Saved delivery selection copied.", "success");
    } catch (_) {
      refs.copyFallback.value = value; refs.copyFallback.hidden = false;
      refs.copyFallback.focus(); refs.copyFallback.select();
      notice("Select and copy the saved delivery selection shown above.");
    }
  }
  root.addEventListener("click", function (event) {
    const mode = event.target.closest("[data-mode]");
    if (mode && root.contains(mode) && !mode.disabled) {
      state.mode = mode.dataset.mode; renderClassList(); changed(); return;
    }
    const button = event.target.closest("[data-action]");
    if (!button || !root.contains(button) || button.disabled) return;
    const action = button.dataset.action;
    const id = button.dataset.key;
    if (action === "refresh") refresh();
    else if (action === "open-saved") openSaved();
    else if (action === "reload-source") loadSource(state.sourceChoice || state.source);
    else if (action === "copy-delivery") copyDelivery();
    else if (action === "use-delivery" && state.savedRecord && typeof onUseInDelivery === "function") {
      prepareDeliverySelection()
        .then(function (prepared) {
          return onUseInDelivery(prepared.record.delivery_overlay, prepared.record, prepared.delivery);
        })
        .catch(function (error) { fail(error, "Could not open the delivery editor."); });
    }
    else if (action === "select-classes") {
      visibleClasses().forEach(function (item) { state.classValues.set(classKey(item.value), item.value); });
      renderClassList(); changed();
    } else if (action === "clear-classes") { state.classValues.clear(); renderClassList(); changed(); }
    else if (action === "select-filtered") chooseFiltered(true);
    else if (action === "clear-filtered") chooseFiltered(false);
    else if (action === "more-rows") { state.visibleRows += 100; renderFeatureRows(); updateControls(); }
    else if (action === "load-more") loadMore();
    else if (action === "more-preview") preview(true);
    else if (action === "inspect-feature") inspectFeature(id);
    else if (action === "toggle-exclusion") toggleExclusion(id);
    else if (action === "toggle-exact") toggleExact(id);
    else if (action === "clear-exclusions") { state.excludeIds.clear(); changed(); }
    else if (action === "preview") preview(false);
    else if (action === "save") save();
    else if (action === "resume-save") pollSave();
    else if (action === "zoom-in") zoom(0.75);
    else if (action === "zoom-out") zoom(1 / 0.75);
    else if (action === "fit-map") { if (state.map.home) setView(state.map.home.slice()); }
    else if (action === "use-current-version") {
      state.expectedSHA = state.source.sha256 || "";
      state.sourceContext = null; renderSourceContext();
      changed(); notice("Current source version selected. Preview it before saving a new revision.");
    } else if (action === "export-selection" && state.source) {
      downloadBlob(JSON.stringify({ workspace: workspace(), selection: selection() }, null, 2), "application/json", filename(".selection.json"));
      notice("Selection JSON downloaded.", "success");
    } else if (action === "export-context" && state.sourceContext) {
      downloadBlob(JSON.stringify(state.sourceContext, null, 2), "application/json", filename(".source-review.json"));
      notice("Complete source review context downloaded.", "success");
    } else if (action === "export-geojson") exportData("geojson");
    else if (action === "export-csv") exportData("csv");
  }, { signal: abort.signal });
  root.addEventListener("change", function (event) {
    const input = event.target;
    if (input.dataset.classKey !== undefined) {
      const key = input.dataset.classKey;
      if (input.checked) state.classValues.set(key, JSON.parse(key)); else state.classValues.delete(key);
      renderClassList(); changed();
    } else if (input.dataset.featureKey !== undefined) {
      if (input.checked) state.featureIds.add(input.dataset.featureKey); else state.featureIds.delete(input.dataset.featureKey);
      changed();
    } else if (input === refs.allLoaded) chooseFiltered(input.checked);
    else if (input === refs.sourceSelect) {
      const source = state.sources.find(function (item) { return sourceKey(item) === input.value; });
      if (source) {
        if (!sameSource(source, state.sourceChoice || state.source)) refs.idFieldOverride.value = "";
        loadSource(source);
      }
    } else if (input === refs.roleSelect) renderSources();
    else if (input === refs.savedSelect) updateControls();
    else if (input === refs.purpose) changed();
  }, { signal: abort.signal });
  refs.featureSearch.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { state.visibleRows = 100; renderFeatureRows(); updateControls(); }, 120);
  }, { signal: abort.signal });
  refs.classSearch.addEventListener("input", function () {
    clearTimeout(previewSearchTimer);
    previewSearchTimer = setTimeout(renderClassList, 90);
  }, { signal: abort.signal });
  [refs.title, refs.notes, refs.ruleTitle, refs.ruleUri, refs.ruleEdition, refs.ruleSection].forEach(function (input) {
    input.addEventListener("input", function () { changed({ features: false }); }, { signal: abort.signal });
  });
  refs.map.addEventListener("wheel", function (event) {
    if (!state.map.view) return;
    event.preventDefault();
    zoom(event.deltaY > 0 ? 1.15 : 1 / 1.15, mapPoint(event));
  }, { passive: false, signal: abort.signal });
  refs.map.addEventListener("pointerdown", function (event) {
    if (!state.map.view || event.button !== 0) return;
    const point = mapPoint(event);
    if (!point) return;
    state.map.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, point: point, view: state.map.view.slice(), moved: false, target: event.target };
    refs.map.setPointerCapture(event.pointerId);
    refs.map.classList.add("wd-map-dragging");
  }, { signal: abort.signal });
  refs.map.addEventListener("pointermove", function (event) {
    const drag = state.map.drag;
    if (drag && event.pointerId === drag.pointerId) {
      if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 5) drag.moved = true;
      const matrix = refs.map.getScreenCTM();
      if (matrix) {
        const dx = (event.clientX - drag.x) / matrix.a;
        const dy = (event.clientY - drag.y) / matrix.d;
        setView([drag.view[0] - dx, drag.view[1] - dy, drag.view[2], drag.view[3]]);
      }
      refs.mapHover.hidden = true;
      return;
    }
    const group = event.target.closest("[data-map-key]");
    const entry = group && state.map.entries.get(group.getAttribute("data-map-key"));
    refs.mapHover.hidden = !entry;
    if (entry) refs.mapHover.textContent = entry.name + " · " + (entry.rawId === null ? "Native ID missing" : entry.rawId) + " · " + classLabel(entry.classValue);
  }, { signal: abort.signal });
  function endDrag(event, cancelled) {
    const drag = state.map.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!cancelled && !drag.moved) {
      const group = drag.target.closest("[data-map-key]");
      if (group) inspectFeature(group.getAttribute("data-map-key"));
    }
    state.map.drag = null; refs.map.classList.remove("wd-map-dragging");
    if (refs.map.hasPointerCapture(event.pointerId)) refs.map.releasePointerCapture(event.pointerId);
  }
  refs.map.addEventListener("pointerup", function (event) { endDrag(event, false); }, { signal: abort.signal });
  refs.map.addEventListener("pointercancel", function (event) { endDrag(event, true); }, { signal: abort.signal });
  refs.map.addEventListener("pointerleave", function () { refs.mapHover.hidden = true; }, { signal: abort.signal });
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(function () {
    if (state.map.view) setView(state.map.view);
  }) : null;
  if (resize) resize.observe(refs.mapStage);

  async function openSelection(input) {
    if (!input || typeof input !== "object") throw new TypeError("A source selection context is required.");
    if (state.saveBusy || (state.saveAttempt && state.saveAttempt.status === "unknown")) {
      throw new Error("Check the current save task before opening a different selection.");
    }
    const collection = input.collection_id;
    const sourceId = input.source_id;
    if (typeof collection !== "string" || !collection.trim() || typeof sourceId !== "string" || !sourceId.trim()) {
      throw new Error("Provide the original collection_id and source_id for these feature references.");
    }
    const references = input.source_feature_refs || [];
    if (!Array.isArray(references)) throw new TypeError("source_feature_refs must be a list of native feature IDs or explicit feature_id records.");
    const ids = references.map(function (reference) {
      const object = reference !== null && typeof reference === "object";
      if (object && ((reference.collection_id && reference.collection_id !== collection) ||
        (reference.source_id && reference.source_id !== sourceId))) {
        throw new Error("A feature reference belongs to a different source. Map it to this exact source edition before opening it.");
      }
      const id = object ? reference.feature_id : reference;
      if (!((typeof id === "string" && id.trim()) || (typeof id === "number" && Number.isSafeInteger(id)))) {
        throw new Error("Each source feature reference needs its original feature_id as text or an integer.");
      }
      return id;
    });
    const sourceContext = JSON.parse(JSON.stringify(input));
    const legal = input.legal_record_context && !Array.isArray(input.legal_record_context) ? input.legal_record_context : {};
    const ruleReference = input.rule_reference || legal.rule_reference || {};
    const idField = input.id_field || input.native_oid_field || "";
    const source = state.sources.find(function (item) {
      return item.source_collection_id === collection && item.source_id === sourceId &&
        (!input.layer || !item.layer || item.layer === input.layer);
    }) || { source_collection_id: collection, source_id: sourceId, layer: input.layer, title: sourceId };
    const notes = Array.isArray(legal.notes) ? legal.notes.slice() : legal.notes ? [String(legal.notes)] : [];
    if (legal.record_id !== undefined && legal.record_id !== null) notes.push("Related legal record: " + String(legal.record_id));
    refs.idFieldOverride.value = idField;
    const draft = {
      source_collection_id: collection, source_id: sourceId, layer: input.layer || source.layer,
      id_field: idField || undefined, class_field: input.class_field || undefined,
      expected_source_sha256: input.expected_source_sha256 || undefined,
      selection_mode: "features", feature_ids: ids,
      class_values: [], exclude_ids: [], purpose: input.purpose || refs.purpose.value,
      title: input.title || legal.title || "",
      notes: notes, rule_reference: ruleReference, source_context: sourceContext
    };
    const loaded = await loadSource(source, { selection: draft, record: null });
    if (!loaded) throw new Error("The requested source could not be opened. The workbench shows the source error.");
    if (!draft.title) refs.title.value = sourceTitle(state.source) + " selection";
    if (ids.length && !versionChanged()) await preview(false);
    updateControls();
    return {
      source_collection_id: state.source.source_collection_id, source_id: state.source.source_id,
      id_field: state.idField, source_version_changed: versionChanged(),
      selection: selection(), summary: previewCurrent() ? state.preview.summary : null
    };
  }

  renderClassList(); renderFeatureRows(); renderExclusions(); updateControls();
  refresh();
  return {
    refresh: refresh,
    openSelection: openSelection,
    destroy: function () {
      destroyed = true; state.sourceEpoch++; state.previewEpoch++;
      abort.abort();
      if (pollTimer) clearTimeout(pollTimer);
      if (searchTimer) clearTimeout(searchTimer);
      if (previewSearchTimer) clearTimeout(previewSearchTimer);
      if (resize) resize.disconnect();
      root.remove();
    }
  };
}


/** Shared operator extension host adapter. The host API accepts object bodies. */
export function createWaterDesignationsExtension(context) {
  if (!context || typeof context.api !== "function") {
    throw new TypeError("The operator extension requires its native API context.");
  }
  let controller = null;
  let mountedWorkspace = "";
  let catalogStamp = "";
  let pendingSelections = [];
  let drainingSelections = false;
  async function drainSelections() {
    if (drainingSelections || !controller) return;
    drainingSelections = true;
    try {
      while (pendingSelections.length && controller) {
        const pending = pendingSelections.shift();
        if (pending.workspace !== currentWorkspace()) {
          pending.reject(new Error("The workspace changed before the source selection opened."));
          continue;
        }
        const mounted = controller;
        try {
          const result = await mounted.openSelection(pending.input);
          pending.resolve(result);
        } catch (error) { pending.reject(error); }
      }
    } finally { drainingSelections = false; }
  }
  function currentWorkspace() {
    const value = typeof context.getWorkspace === "function" ? context.getWorkspace() : null;
    if (typeof value === "string") return value;
    const state = typeof context.getState === "function" ? context.getState() : {};
    return String((value && (value.workspace_key || value.key || value.id)) || state.workspace_key || "");
  }
  function stamp(state) {
    const data = state && state.data && state.data.water_designations;
    return data ? JSON.stringify(data) : "";
  }
  function nativeRequest(path, options) {
    const opts = Object.assign({}, options || {});
    if (typeof opts.body === "string") opts.body = JSON.parse(opts.body);
    return context.api(path, opts);
  }
  return {
    mount: function (containerNode, hostState) {
      if (controller) controller.destroy();
      mountedWorkspace = currentWorkspace();
      const originWorkspace = mountedWorkspace;
      catalogStamp = stamp(hostState);
      controller = mountWaterDesignations({
        container: containerNode,
        request: nativeRequest,
        workspaceId: currentWorkspace,
        onSaved: async function () {
          if (typeof context.refreshState === "function") await context.refreshState();
          else if (typeof context.refresh === "function") await context.refresh();
        },
        onUseInDelivery: (typeof context.openExtension === "function" || typeof context.openDelivery === "function")
          ? async function (_overlay, _record, delivery) {
              function requireOrigin() {
                if (currentWorkspace() !== originWorkspace) {
                  throw new Error("The originating workspace changed before the saved water selection opened.");
                }
              }
              requireOrigin();
              if (typeof context.openExtension === "function") {
                const catalogue = await context.api("/api/extensions");
                requireOrigin();
                if ((catalogue.extensions || []).some(function (entry) {
                  return entry.id === "map-atlas" && entry.client && entry.client.view;
                })) {
                  return context.openExtension("map-atlas", "create", {
                    workspace_key: originWorkspace, selection: delivery
                  });
                }
              }
              if (typeof context.openDelivery !== "function") {
                throw new Error("Open an installed delivery editor for this saved selection.");
              }
              return context.openDelivery(delivery);
            } : undefined
      });
      drainSelections();
    },
    update: function (hostState) {
      if (!controller) return;
      const nextWorkspace = currentWorkspace();
      const nextStamp = stamp(hostState);
      if (nextWorkspace !== mountedWorkspace) {
        mountedWorkspace = nextWorkspace;
        controller.destroy();
        controller = null;
        return;
      }
      if (nextStamp && nextStamp !== catalogStamp) {
        catalogStamp = nextStamp;
        controller.refresh();
      }
    },
    openSelection: function (input) {
      return new Promise(function (resolve, reject) {
        const pending = { input: input, workspace: currentWorkspace(), resolve: resolve, reject: reject };
        pendingSelections.push(pending);
        function navigationFailed(error) {
          pendingSelections = pendingSelections.filter(function (entry) { return entry !== pending; });
          reject(error);
        }
        try {
          if (typeof context.navigate === "function") {
            Promise.resolve(context.navigate("water-designations")).then(drainSelections, navigationFailed);
          } else if (!controller) {
            navigationFailed(new Error("The operator navigation context is required to open this designation desk."));
          } else {
            drainSelections();
          }
        } catch (error) { navigationFailed(error); }
      });
    },
    detach: function () {
      if (controller) controller.destroy();
      controller = null;
      catalogStamp = "";
    }
  };
}
