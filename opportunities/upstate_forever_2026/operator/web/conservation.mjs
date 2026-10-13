/** Conservation studies and portfolios within the existing GIS operator. */
import { renderKeoweePointCriteria } from "./keowee-method-view.mjs";
const POLLUTANTS = [
  ["nitrogen_export", "Nitrogen"],
  ["phosphorus_export", "Phosphorus"],
  ["sediment_export", "Sediment"],
];
const h = value => String(value ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const finite = value => typeof value === "number" && Number.isFinite(value);
const number = value => finite(value) ?
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value) : "—";
const percent = value => finite(value) ? number(value * 100) + "%" : "Unmapped";
const human = value => String(value ?? "").replace(/[_-]+/g, " ");
const fieldId = name => "conservation-field-" + name;
const option = (value, label, chosen) => '<option value="' + h(value) + '"' +
  (String(value) === String(chosen ?? "") ? " selected" : "") + ">" + h(label) + "</option>";
const input = (name, label, value, extras = "") =>
  '<label class="cons-field" for="' + fieldId(name) + '"><span>' + h(label) +
  '</span><input id="' + fieldId(name) + '" data-field="' + h(name) +
  '" value="' + h(value) + '" ' + extras + "></label>";
const check = (name, label, value) => '<label class="cons-check"><input type="checkbox" data-field="' +
  h(name) + '"' + (value ? " checked" : "") + "> <span>" + h(label) + "</span></label>";
const select = (name, label, selected, items) =>
  '<label class="cons-field" for="' + fieldId(name) + '"><span>' + h(label) +
  '</span><select id="' + fieldId(name) + '" data-field="' + h(name) + '">' +
  items.map(([value, text]) => option(value, text, selected)).join("") + "</select></label>";
const button = (action, label, extra = "", disabled = false) =>
  '<button type="button" data-action="conservation-' + action + '" ' + extra +
  (disabled ? " disabled" : "") + ">" + h(label) + "</button>";
function numeric(raw, label, { optional = false, min = 0, max = Infinity, integer = false } = {}) {
  if (raw === "" || raw === null || raw === undefined) {
    if (optional) return null;
    throw new Error(label + " is required.");
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(label + " must be " + (integer ? "a whole number" : "a number") +
      " from " + min + (Number.isFinite(max) ? " to " + max : " upward") + ".");
  }
  return value;
}
function link(value, text) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return '<a href="' + h(url.href) + '" target="_blank" rel="noopener noreferrer">' +
        h(text || value) + "</a>";
    }
  } catch (_) { /* A retained local reference remains visible as text. */ }
  return h(text || value || "Reference not recorded");
}
function freshStudy() {
  return {
    title: "", mode: "source_context", purpose: "screening",
    unit_type: "management_unit", planning_unit_label: "Planning unit",
    parcel_source: "", parcel_layer: "", id_field: "", label_field: "", parcel_where: "",
    reporting_source: "", reporting_layer: "", analysis_crs: "EPSG:5070",
    baseline_run_id: "", alternative_run_ids: [], score_alternative: "",
    protected_source: "", protected_layer: "", protected_reference: "", protected_meaning: "",
    protected_relation: "Area intersection",
    water_source: "", water_layer: "", water_reference: "", water_meaning: "",
    water_relation: "Area intersection with retained water-context geography",
    quality_source: "", quality_layer: "", quality_reference: "", quality_meaning: "",
    quality_relation: "Intersection with the source-designated water features", quality_buffer: "0",
    minimum_coverage: "95", maximum_protected: "100", minimum_water: "0",
    minimum_area: "0", require_quality: false, excluded_ids: "",
    score_basis: "context", score_scale: "total", weight_n: "1", weight_p: "1", weight_s: "1",
    context_water_weight: "", context_unprotected_weight: "", context_quality_weight: "",
    method_category: "land_protection", method_source: "", method_format: "json",
    method_id_column: "id", method_native_classes: false, method_headwaters: "table31",
    method_order_field: "stream_orders",
    method_interpretation: "", criterion_geometry: "whole_original_parcel",
    cost_source: "", cost_id_column: "", cost_value_column: "", currency: "", cost_reference: "",
    advanced_use: false, advanced_text: "",
  };
}
function freshSourceCapture(studyId = "") {
  return { study_id: studyId, soils: true, floodplains: true, hydric_selection: "full",
    soil_source: "", soil_layer: "", mukey_field: "MUKEY",
    floodplain_source: "", floodplain_layer: "", criterion_geometry: "whole_original_parcel" };
}
function freshPortfolio() {
  return { title: "", mode: "manual", objective: "score", area: "", cost: "",
    count: "", area_basis: "whole_units", include_ineligible: false };
}
function sourceKey(value) {
  return JSON.stringify({ source_collection_id: value.source_collection_id, source_id: value.source_id });
}
function sourceRef(raw, layer, label) {
  if (!raw) throw new Error("Choose the " + label + " source.");
  let value;
  try { value = JSON.parse(raw); } catch (_) { throw new Error("Choose a listed " + label + " source."); }
  if (!value || typeof value.source_collection_id !== "string" || typeof value.source_id !== "string") {
    throw new Error("The " + label + " source is incomplete.");
  }
  const result = { source_collection_id: value.source_collection_id, source_id: value.source_id };
  if (layer && layer.trim()) result.layer = layer.trim();
  return result;
}

export function attachConservation({
  getState, api, endpoint, submitAction, showTask, toast, fileList,
} = {}) {
  const memories = new Map();
  let mounted = null;
  let listener = null;
  let activeWorkspace = null;
  const workspace = () => getState?.()?.workspace_key || null;
  function memory(key = workspace()) {
    if (!memories.has(key)) memories.set(key, {
      overview: null, overviewLoading: false, taskStamp: "", readVersion: 0,
      study: null, plan: null, selectedIds: new Set(), page: 1, pageSize: 25,
      search: "", eligibility: "all", sort: "score", direction: "desc", form: null,
      ranges: Object.fromEntries(["rank", "score", "area_ha", "reporting_area_ha", "cost", "protected_fraction", "source_water_fraction"].flatMap(name => [[name + "_min", ""], [name + "_max", ""]])),
      metricFilter: { pollutant: "", case: "baseline", field: "value", min: "", max: "", availability: "" },
      catalogStatus: null, catalogPage: null, catalogQueryKey: null, catalogLoading: false,
      catalogVersion: 0, catalogController: null, catalogTimer: null,
      retainedSelection: null, excludedIds: new Set(), selectedPage: new Set(),
      detailVersion: 0, detailRow: null, detailLoading: false,
      draft: freshStudy(), portfolio: freshPortfolio(), detailId: null,
      acquisition: freshSourceCapture(), sourceCapture: null,
      optimization: null, optimizationResult: null, optimizationPage: 1,
      optimizationSearch: "", optimizationFilter: "all",
      notice: null, busy: false, pending: new Set(), selectionOrigin: null,
    });
    return memories.get(key);
  }
  const sources = () => {
    const available = getState?.()?.data?.sources || memory().overview?.available?.sources || [];
    return available.flatMap(collection => (collection.entries || []).map(entry => ({
      ...entry, source_collection_id: collection.id, source_id: entry.id,
      collection_title: collection.title || collection.id,
    })));
  };
  const runs = () => {
    const retained = new Map((memory().overview?.available?.runs || []).map(run => [run.id, run]));
    return (getState?.()?.data?.runs || [...retained.values()])
      .filter(run => run.state === "complete")
      .map(run => ({ ...retained.get(run.id), ...run,
        execution: retained.get(run.id)?.execution || run.execution }));
  };
  const publishedMethod = () => memory().overview?.published_methods || {};
  const publishedCategories = () => publishedMethod().categories || [];
  const methodCategory = id => publishedCategories().find(category => category.id === id);
  const exportCategory = id => ["agricultural_bmps", "wetland_restoration", "riparian_restoration",
    "shoreline_management", "stormwater_bmps"].includes(id);
  const allNativeClasses = d => ["ndr", "sdr"].every(model =>
    runModels(runs().find(run => run.id === d.baseline_run_id)).includes(model));
  function runModels(run) {
    if (!run) return [];
    const selected = run.selection?.models;
    return selected === undefined ? ["ndr", "sdr"] :
      Array.isArray(selected) ? selected.filter(name => name === "ndr" || name === "sdr") : [];
  }
  function runQuantityLabel(run) {
    const models = runModels(run);
    const quantities = [models.includes("ndr") ? "nitrogen + phosphorus" : "",
      models.includes("sdr") ? "sediment" : ""].filter(Boolean).join(" · ") || "No selected native outputs";
    const versions = Object.entries(run?.execution?.model_versions || {}).map(([model, value]) =>
      model.toUpperCase() + " " + (value.comparison_version || "version not recorded")).join(", ");
    return quantities + (versions ? " · " + versions : "") +
      (run?.execution?.supported === false ? " · Outside the quantity adapter" : "");
  }
  function scoreOutputs(draft = memory().draft) {
    const available = runs();
    const baseline = available.find(run => run.id === draft.baseline_run_id);
    let models = runModels(baseline);
    if (["scenario_reduction", "disturbance_increase"].includes(draft.score_basis)) {
      const alternative = available.find(run => run.id === draft.score_alternative);
      const comparison = new Set(runModels(alternative));
      models = models.filter(model => comparison.has(model));
    }
    return new Set(POLLUTANTS.filter(([name]) =>
      models.includes(name === "sediment_export" ? "sdr" : "ndr")).map(([name]) => name));
  }
  function entry(raw) {
    return sources().find(item => sourceKey(item) === raw);
  }
  function sourceSelect(name, label, selected, optional = false) {
    const rows = sources(), chosen = entry(selected);
    return '<div class="cons-source-choice">' + select(name, label, selected, [
      ["", optional ? "No source selected" : "Choose an imported source"],
      ...rows.map(item => [sourceKey(item), item.collection_title + " / " +
        (item.title || item.source_id) + (item.kind ? " · " + item.kind : "") +
        (item.vintage ? " · " + item.vintage : "")]),
    ]) + (chosen ? '<button type="button" data-action="source-inspect" data-collection="' +
      h(chosen.source_collection_id) + '" data-source="' + h(chosen.source_id) +
      '">Inspect retained source</button>' : "") + "</div>";
  }
  function lineForSource(ref) {
    if (!ref) return "No source selected";
    const item = sources().find(row => row.source_collection_id === ref.source_collection_id &&
      row.source_id === ref.source_id);
    const label = item ? item.collection_title + " / " + (item.title || item.source_id) :
      [ref.source_collection_id, ref.source_id].filter(Boolean).join(" / ");
    return h(label || "Retained source") + (item?.vintage ? " · " + h(item.vintage) : "") +
      (ref.layer ? " · layer " + h(ref.layer) : "") +
      ((ref.reference || item?.uri) ? " · " + link(ref.reference || item.uri, "Source reference") : "");
  }
  function waterContextMeaning(study = memory().study) {
    const reference = study?.spec?.contexts?.drinking_water;
    return reference ? reference.meaning || reference.relation || "Retained water-context geography" :
      "No water-context layer selected";
  }
  function notify(message, kind = "status") {
    memory().notice = { message, kind };
    paint();
  }
  async function read(operation, params = {}) {
    const key = workspace();
    const result = await api(endpoint("/api/conservation/" + operation, params));
    if (workspace() !== key) return null;
    return result;
  }
  function taskStamp(state) {
    const source = state?.data?.tasks ?? state?.tasks;
    const tasks = Array.isArray(source) ? source : Array.isArray(source?.tasks) ? source.tasks :
      Array.isArray(source?.items) ? source.items : source && typeof source === "object" ?
        Object.values(source).filter(item => item && typeof item === "object" && item.action) : [];
    const experimentActions = new Set(["experiment.save", "experiment.run", "experiment.summarize"]);
    const operations = tasks.filter(task => String(task.action || "").startsWith("conservation.") ||
      experimentActions.has(task.action))
      .map(task => JSON.stringify([task.id, task.state || task.status,
        task.updated_at || null, task.progress || null]))
      .sort();
    const nativeRuns = (state?.data?.runs || []).map(run => JSON.stringify([
      run.id, run.state, run.selection?.invest_version || null,
      run.runtime?.version || null, run.selection?.models || null,
      ["ndr", "sdr"].map(model => {
        const stage = run.stages?.[model];
        return [model, stage?.completed_at || null, stage?.runtime?.version || null];
      }),
    ])).sort();
    return JSON.stringify([operations, nativeRuns]);
  }
  async function refreshOverview(force = false) {
    const key = workspace(), ui = memory(key), requestedStamp = taskStamp(getState?.());
    if (!key || ui.overviewLoading || (!force && ui.overview)) return;
    ui.overviewLoading = true;
    paint();
    try {
      const response = await read("overview");
      if (response && workspace() === key) {
        ui.overview = response;
        ui.taskStamp = requestedStamp;
        const openedSource = ui.sourceCapture, sourceId = sourceCaptureId(openedSource), revision = ui.readVersion;
        if (sourceId) {
          const updatedSource = await read("source-capture", { operation_id: sourceId });
          if (updatedSource && workspace() === key && ui.readVersion === revision && ui.sourceCapture === openedSource)
            ui.sourceCapture = updatedSource;
        }
        const opened = ui.study;
        const retained = opened && (response.studies || []).find(row => row.id === opened.id);
        if (retained && retained.state !== opened.state) {
          const updated = await catalogRead("study", { study_id: opened.id });
          if (updated && workspace() === key && ui.readVersion === revision && ui.study === opened)
            ui.study = updated;
        }
        if (ui.study?.state === "complete") await refreshCatalog();
      }
    } catch (error) {
      if (workspace() === key) ui.notice = { kind: "error", message: error.message || String(error) };
    } finally {
      ui.overviewLoading = false;
      if (workspace() === key) paint();
    }
  }
  async function catalogRead(operation, value = {}, signal) {
    const key = workspace();
    const result = await api(endpoint("/api/conservation-catalog/" + operation),
      { method: "POST", body: value, signal });
    return workspace() === key ? result : null;
  }
  function checkedCount(ui = memory()) {
    return ui.retainedSelection ?
      Math.max(0, ui.retainedSelection.count + ui.selectedIds.size - ui.excludedIds.size) :
      ui.selectedIds.size;
  }
  function checked(candidate, ui = memory()) {
    const id = String(candidate.id);
    return ui.retainedSelection ? ui.selectedPage.has(id) : ui.selectedIds.has(id);
  }
  function setChecked(id, value, ui = memory()) {
    id = String(id);
    if (!ui.retainedSelection) {
      if (value) ui.selectedIds.add(id); else ui.selectedIds.delete(id);
      return;
    }
    const original = ui.excludedIds.has(id) ||
      (!ui.selectedIds.has(id) && ui.selectedPage.has(id));
    ui.selectedIds.delete(id); ui.excludedIds.delete(id);
    if (value && !original) ui.selectedIds.add(id);
    if (!value && original) ui.excludedIds.add(id);
    if (value) ui.selectedPage.add(id); else ui.selectedPage.delete(id);
  }
  function clearChecked(ui = memory()) {
    ui.retainedSelection = null; ui.selectedIds.clear();
    ui.excludedIds.clear(); ui.selectedPage.clear(); ui.selectionOrigin = null;
  }
  function retainedRequest(selectedOnly = false, ui = memory()) {
    return ui.retainedSelection ? {
      selection_id: ui.retainedSelection.selection_id,
      include_ids: [...ui.selectedIds].sort(), exclude_ids: [...ui.excludedIds].sort(),
      selected_only: selectedOnly,
    } : undefined;
  }
  async function checkedCandidateIds() {
    const key = workspace(), ui = memory(key), studyId = ui.study?.id;
    if (!ui.retainedSelection) return [...ui.selectedIds].sort();
    const retained = retainedRequest(true, ui), identity = JSON.stringify(retained);
    const selected = [], seen = new Set();
    let offset = 0, sourceIdentity = null;
    const wasBusy = ui.busy;
    ui.busy = true; paint();
    try {
      while (true) {
        const page = await catalogRead("query", { study_id: studyId, retained,
          selection: { filters: {}, sort: "id", direction: "asc", offset, limit: 1000 } });
        if (!page || workspace() !== key || ui.study?.id !== studyId) return null;
        if (JSON.stringify(retainedRequest(true, ui)) !== identity) {
          throw new Error("The checked cohort changed while its original IDs were opening. Use the current selection again.");
        }
        if (page.study_id !== studyId || !Number.isSafeInteger(page.total) || page.total < 0 ||
            page.offset !== offset || !Array.isArray(page.candidates)) {
          throw new Error("The retained candidate page differs from its original study or page.");
        }
        const original = JSON.stringify([page.index_id, page.source_inventory, page.total]);
        if (sourceIdentity !== null && sourceIdentity !== original) {
          throw new Error("The retained candidate inventory changed while its full selection was opening.");
        }
        sourceIdentity = original;
        for (const row of page.candidates) {
          if (typeof row.id !== "string" || !row.id.length || seen.has(row.id)) {
            throw new Error("The complete retained cohort needs each original candidate ID exactly once.");
          }
          seen.add(row.id); selected.push(row.id);
        }
        if (page.next_offset === null) {
          if (selected.length !== page.total) throw new Error("Open every page of the retained candidate selection.");
          return selected;
        }
        if (!Number.isSafeInteger(page.next_offset) || page.next_offset !== offset + page.candidates.length ||
            page.next_offset <= offset || page.next_offset >= page.total) {
          throw new Error("The retained candidate page does not continue through its original inventory.");
        }
        offset = page.next_offset;
      }
    } finally {
      ui.busy = wasBusy;
      if (workspace() === key) paint();
    }
  }
  function querySelection(ui = memory()) {
    const filters = { search: ui.search.trim(),
      eligible: ui.eligibility === "eligible" ? "yes" : ui.eligibility === "excluded" ? "no" : "all" };
    if (ui.eligibility === "selected" && !ui.retainedSelection) filters.ids = [...ui.selectedIds].sort();
    const range = (name, factor = 1) => {
      const lower = ui.ranges[name + "_min"], upper = ui.ranges[name + "_max"];
      if (lower === "" && upper === "") return;
      const values = {};
      if (lower !== "") values.min = numeric(lower, human(name) + " minimum", { min: -Infinity }) / factor;
      if (upper !== "") values.max = numeric(upper, human(name) + " maximum", { min: -Infinity }) / factor;
      if (values.min !== undefined && values.max !== undefined && values.min > values.max)
        throw new Error(human(name) + " minimum must not exceed the maximum.");
      filters[name] = values;
    };
    for (const name of ["score", "rank", "area_ha", "reporting_area_ha", "cost"]) range(name);
    for (const name of ["protected_fraction", "source_water_fraction"]) range(name, 100);
    if (ui.metricFilter.pollutant) {
      const value = ui.metricFilter, rule = { pollutant: value.pollutant,
        case: value.case || "baseline", field: value.field || "value" };
      if (rule.case === "baseline" && ["delta", "reduction", "common_coverage_fraction"].includes(rule.field))
        throw new Error("Choose a retained alternative for a paired metric filter.");
      const fractional = ["coverage_fraction", "common_coverage_fraction"].includes(rule.field);
      if (value.min !== "") rule.min = numeric(value.min, "Metric minimum", { min: -Infinity }) / (fractional ? 100 : 1);
      if (value.max !== "") rule.max = numeric(value.max, "Metric maximum", { min: -Infinity }) / (fractional ? 100 : 1);
      if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max)
        throw new Error("Metric minimum must not exceed the maximum.");
      if (value.availability) rule.availability = value.availability;
      filters.metrics = [rule];
    }
    return { filters, sort: ui.sort === "area" ? "reporting_area_ha" : ui.sort,
      direction: ui.direction, offset: (ui.page - 1) * ui.pageSize, limit: ui.pageSize };
  }
  function catalogRequest(ui = memory()) {
    const result = { study_id: ui.study.id, selection: querySelection(ui) };
    const retained = retainedRequest(ui.eligibility === "selected", ui);
    if (retained) result.retained = retained;
    return result;
  }
  async function loadCandidatePage(force = false) {
    const key = workspace(), ui = memory(key);
    if (!ui.study?.id || ui.catalogStatus?.state !== "complete") return;
    let request;
    try { request = catalogRequest(ui); }
    catch (error) { ui.catalogLoading = false; ui.notice = { kind: "error", message: error.message }; paint(); return; }
    const identity = JSON.stringify(request);
    if (!force && ui.catalogQueryKey === identity && ui.catalogPage) return;
    ui.catalogController?.abort();
    const controller = new AbortController(), version = ++ui.catalogVersion;
    ui.catalogController = controller; ui.catalogLoading = true; paint();
    try {
      const result = await catalogRead("query", request, controller.signal);
      if (!result || workspace() !== key || version !== ui.catalogVersion || ui.study.id !== request.study_id) return;
      if (result.study_id !== request.study_id) throw new Error("The candidate page belongs to another study.");
      ui.catalogPage = result; ui.catalogQueryKey = identity;
      ui.selectedPage = new Set((result.selected_ids_on_page || []).map(String));
      if (!result.candidates.length && result.total > 0 && request.selection.offset >= result.total) {
        ui.page = Math.ceil(result.total / ui.pageSize);
        ui.catalogQueryKey = null;
        await loadCandidatePage(true);
      }
    } catch (error) {
      if (error.name !== "AbortError" && workspace() === key && version === ui.catalogVersion)
        ui.notice = { kind: "error", message: error.message || String(error) };
    } finally {
      if (version === ui.catalogVersion) ui.catalogLoading = false;
      if (workspace() === key) paint();
    }
  }
  async function refreshCatalog(force = false) {
    const key = workspace(), ui = memory(key), id = ui.study?.id, version = ui.readVersion;
    if (!id || ui.study.state !== "complete") return;
    const status = await catalogRead("status", { study_id: id });
    if (!status || workspace() !== key || ui.readVersion !== version || ui.study?.id !== id) return;
    const changed = ui.catalogStatus?.id !== status.id;
    ui.catalogStatus = status;
    if (status.state === "complete") await loadCandidatePage(force || changed);
    else { ui.catalogPage = null; ui.catalogQueryKey = null; }
  }
  async function openCandidate(id) {
    const key = workspace(), ui = memory(key), studyId = ui.study?.id;
    const version = ++ui.detailVersion;
    ui.detailId = id; ui.detailRow = null; ui.detailLoading = true; paint();
    try {
      const candidate = await catalogRead("candidate", { study_id: studyId, candidate_id: id });
      if (!candidate || workspace() !== key || ui.study?.id !== studyId || version !== ui.detailVersion) return;
      ui.detailRow = candidate.candidate;
    } catch (error) {
      if (workspace() === key && version === ui.detailVersion)
        ui.notice = { kind: "error", message: error.message || String(error) };
    } finally {
      if (version === ui.detailVersion) ui.detailLoading = false;
      if (workspace() === key) paint();
    }
  }
  async function useRetainedSelection(id) {
    const key = workspace(), ui = memory(key), studyId = ui.study?.id;
    const result = await catalogRead("selection", { study_id: studyId, selection_id: id });
    if (!result || workspace() !== key || ui.study?.id !== studyId) return;
    if (result.study_id !== studyId) throw new Error("The retained selection belongs to another study.");
    clearChecked(ui);
    ui.retainedSelection = result;
    ui.page = 1; ui.notice = { kind: "status", message:
      "Opened the complete retained cohort. Checked units can be adjusted on every page." };
    await loadCandidatePage(true);
  }
  function resetCatalogFilters(ui = memory()) {
    ui.search = ""; ui.eligibility = "all"; ui.page = 1;
    for (const key of Object.keys(ui.ranges)) ui.ranges[key] = "";
    ui.metricFilter = { pollutant: "", case: "baseline", field: "value", min: "", max: "", availability: "" };
  }
  function resetCatalog(ui = memory()) {
    ui.catalogController?.abort(); clearTimeout(ui.catalogTimer);
    ui.catalogVersion++; ui.detailVersion++; ui.catalogLoading = false;
    ui.catalogPage = null; ui.catalogStatus = null; ui.catalogQueryKey = null;
    ui.detailRow = null; ui.detailLoading = false;
  }
  function candidates() {
    return memory().catalogPage?.candidates || [];
  }
  function filtered() { return candidates(); }
  function pageRows() { return candidates(); }
  function buildSpec({ forCriteria = false } = {}) {
    const d = memory().draft;
    if (d.advanced_use) {
      let spec;
      try { spec = JSON.parse(d.advanced_text); } catch (error) {
        throw new Error("The advanced study JSON is invalid: " + error.message);
      }
      if (!spec || Array.isArray(spec) || typeof spec !== "object") {
        throw new Error("The advanced study specification must be one JSON object.");
      }
      return forCriteria ? { ...spec, score: { basis: "context", context_weights: {} } } : spec;
    }
    if (!d.title.trim()) throw new Error("Give the study a title.");
    const parcels = sourceRef(d.parcel_source, d.parcel_layer, "planning-unit");
    if (d.id_field.trim()) parcels.id_field = d.id_field.trim();
    if (d.label_field.trim()) parcels.label_field = d.label_field.trim();
    if (d.parcel_where.trim()) {
      let where;
      try { where = JSON.parse(d.parcel_where); } catch (error) {
        throw new Error("The exact unit selection must be valid JSON: " + error.message);
      }
      if (!where || Array.isArray(where) || typeof where !== "object") {
        throw new Error("The exact unit selection must map native field names to typed values.");
      }
      for (const [field, value] of Object.entries(where)) {
        if (!field.trim() || (value !== null && !["string", "number", "boolean"].includes(typeof value)) ||
          (typeof value === "number" && (!Number.isFinite(value) ||
            (Number.isInteger(value) && !Number.isSafeInteger(value))))) {
          throw new Error("Each selected field needs its original name and a text, finite number, boolean or null value. Keep identifiers as quoted text.");
        }
      }
      if (Object.keys(where).length) parcels.where = where;
    }
    const spec = {
      title: d.title.trim(), mode: d.mode, purpose: d.purpose,
      unit_type: d.unit_type, planning_unit_label: d.planning_unit_label.trim() || "Planning unit",
      parcels, alternative_run_ids: [], contexts: {},
      rules: {
        minimum_coverage_fraction: numeric(d.minimum_coverage, "Minimum model coverage", { max: 100 }) / 100,
        maximum_protected_fraction: numeric(d.maximum_protected, "Maximum protected share", { max: 100 }) / 100,
        minimum_source_water_fraction: numeric(d.minimum_water, "Minimum water-context share", { max: 100 }) / 100,
        require_high_quality_context: !!d.require_quality,
        minimum_area_ha: numeric(d.minimum_area, "Minimum unit area"),
        excluded_ids: d.excluded_ids.split(/[\n,]+/).map(value => value.trim()).filter(Boolean),
      },
    };
    if (d.mode === "source_context") {
      spec.reporting_area = sourceRef(d.reporting_source, d.reporting_layer, "reporting-area");
      spec.analysis_crs = d.analysis_crs.trim() || "EPSG:5070";
    } else {
      if (!d.baseline_run_id) throw new Error("Choose a completed baseline model run.");
      if (!runs().some(run => run.id === d.baseline_run_id)) {
        throw new Error("Choose a completed baseline from this workspace.");
      }
      spec.baseline_run_id = d.baseline_run_id;
      spec.alternative_run_ids = [...new Set(d.alternative_run_ids)]
        .filter(id => id !== d.baseline_run_id);
    }
    if (forCriteria) {
      spec.score = { basis: "context", context_weights: {} };
    } else if (d.score_basis === "published_method") {
      const method = publishedMethod(), category = methodCategory(d.method_category);
      if (!method.id || !category) throw new Error("Choose a published practice category.");
      if (d.unit_type !== "parcel") {
        throw new Error("Published practice scores require parcel geometry and Parcel as the source unit type.");
      }
      if (d.purpose !== "screening" && d.purpose !== category.purpose) {
        throw new Error(category.title + " uses the " + category.purpose + " planning purpose.");
      }
      const idColumn = d.method_id_column.trim();
      if (!idColumn) throw new Error("Record the parcel ID column in the criterion table.");
      spec.score = {
        basis: "published_method", scale: "total", method_id: method.id, category_id: category.id,
        metrics: { ...sourceRef(d.method_source, "", "parcel-criterion table"),
          format: d.method_format, id_column: idColumn },
        bindings: {}, headwater_orders: category.id === "land_protection" && d.method_headwaters === "appendix_d" ? [1] : [1, 2],
        interpretation: d.method_interpretation.trim() ||
          "Published Lake Keowee practice points using the retained parcel criterion table.",
      };
      if (category.id === "land_protection" && d.method_headwaters === "appendix_d") {
        const field = d.method_order_field.trim();
        if (!field) throw new Error("Record the original stream-order column for the first-order variant.");
        spec.score.bindings.headwater_stream = {
          kind: "stream_order", input: "table", field,
          reference: "Lake Keowee 2020 Appendix D protection: first-order streams; recomputed from retained stream orders.",
        };
      }
      if (d.method_native_classes && d.mode === "native_model" && exportCategory(category.id)) {
        if (!allNativeClasses(d)) throw new Error("Current export classes need a baseline containing nitrogen, phosphorus and sediment.");
        for (const [pollutant] of POLLUTANTS) {
          spec.score.bindings[pollutant.replace("_export", "_export_priority")] = {
            kind: "native_export", pollutant, statistic: "parcel_mean_cell_mass",
            band_method: "current_tertiles",
            reference: "Current-study parcel-mean classification; Lake Keowee 2020 Appendix D p143 point weights.",
          };
        }
        spec.score.interpretation += " Native export classes use current-study tertiles as an adaptation of the published point method.";
      }
    } else if (d.mode === "source_context") {
      const weights = {};
      for (const [field, name] of [
        ["context_water_weight", "source_water_fraction"],
        ["context_unprotected_weight", "unprotected_fraction"],
        ["context_quality_weight", "high_quality_context"],
      ]) {
        const value = numeric(d[field], human(name) + " weight", { optional: true });
        if (value !== null && value > 0) weights[name] = value;
      }
      spec.score = { basis: "context", context_weights: weights };
    } else {
      spec.score = {
        basis: d.score_basis === "context" ? "current_export" : d.score_basis,
        scale: d.score_scale,
        weights: Object.fromEntries([
          ["nitrogen_export", "weight_n", "Nitrogen"],
          ["phosphorus_export", "weight_p", "Phosphorus"],
          ["sediment_export", "weight_s", "Sediment"],
        ].map(([name, field, title]) => [name,
          scoreOutputs(d).has(name) ? numeric(d[field], title + " weight") : 0])),
      };
      if (!Object.values(spec.score.weights).some(value => value > 0)) {
        throw new Error("Choose completed runs with a shared selected pollutant and give at least one available pollutant a positive weight.");
      }
      if (spec.score.basis !== "current_export") {
        if (!d.score_alternative) throw new Error("Choose the alternative that defines the scoring change.");
        if (d.score_alternative === d.baseline_run_id) throw new Error("Baseline and alternative must be different runs.");
        spec.score.alternative_run_id = d.score_alternative;
        if (!spec.alternative_run_ids.includes(d.score_alternative)) spec.alternative_run_ids.push(d.score_alternative);
      }
    }
    for (const [prefix, name] of [
      ["protected", "protected_lands"], ["water", "drinking_water"], ["quality", "high_quality_waters"],
    ]) {
      if (!d[prefix + "_source"]) continue;
      const ref = sourceRef(d[prefix + "_source"], d[prefix + "_layer"], human(name));
      const found = entry(d[prefix + "_source"]);
      ref.reference = d[prefix + "_reference"].trim() || found?.uri || "";
      ref.meaning = d[prefix + "_meaning"].trim() || found?.description || found?.title || "";
      ref.relation = d[prefix + "_relation"].trim();
      if (prefix === "quality") {
        ref.buffer_m = numeric(d.quality_buffer, "High-quality-water context buffer");
        if (!ref.reference) throw new Error("Record the retained high-quality-water source reference.");
      }
      spec.contexts[name] = ref;
    }
    if (spec.mode === "source_context" && spec.score.basis === "context") {
      const axes = spec.score.context_weights;
      if (axes.source_water_fraction && !spec.contexts.drinking_water) {
        throw new Error("Water-context ranking needs a retained water-context layer.");
      }
      if (axes.unprotected_fraction && !spec.contexts.protected_lands) {
        throw new Error("Unprotected-share ranking needs a retained protected-lands layer.");
      }
      if (axes.high_quality_context && !spec.contexts.high_quality_waters) {
        throw new Error("High-quality-water ranking needs its retained designation layer.");
      }
    }
    if (d.cost_source) {
      if (!d.cost_id_column.trim() || !d.cost_value_column.trim() || !d.currency.trim()) {
        throw new Error("The cost table needs its unit ID column, value column and currency.");
      }
      const ref = sourceRef(d.cost_source, "", "cost-table");
      spec.costs = {
        ...ref, id_column: d.cost_id_column.trim(), value_column: d.cost_value_column.trim(),
        currency: d.currency.trim(),
        reference: d.cost_reference.trim() || entry(d.cost_source)?.uri || "",
      };
    }
    return spec;
  }
  function draftFromStudy(spec, previous = freshStudy()) {
    if (!spec || typeof spec !== "object" || !spec.parcels) {
      throw new Error("The prepared criterion table needs its original retained parcel study.");
    }
    const d = freshStudy(), refKey = ref => ref?.source_collection_id && ref?.source_id ? sourceKey(ref) : "";
    for (const name of ["title", "mode", "purpose", "unit_type", "planning_unit_label", "analysis_crs"]) {
      if (spec[name] !== undefined) d[name] = String(spec[name]);
    }
    d.parcel_source = refKey(spec.parcels); d.parcel_layer = spec.parcels.layer || "";
    d.id_field = spec.parcels.id_field || ""; d.label_field = spec.parcels.label_field || "";
    d.parcel_where = spec.parcels.where ? JSON.stringify(spec.parcels.where, null, 2) : "";
    d.reporting_source = refKey(spec.reporting_area); d.reporting_layer = spec.reporting_area?.layer || "";
    d.baseline_run_id = spec.baseline_run_id || "";
    d.alternative_run_ids = [...(spec.alternative_run_ids || [])];
    const rules = spec.rules || {};
    for (const [field, name] of [["minimum_coverage", "minimum_coverage_fraction"],
      ["maximum_protected", "maximum_protected_fraction"], ["minimum_water", "minimum_source_water_fraction"]]) {
      if (finite(rules[name])) d[field] = String(rules[name] * 100);
    }
    if (finite(rules.minimum_area_ha)) d.minimum_area = String(rules.minimum_area_ha);
    d.require_quality = !!rules.require_high_quality_context;
    d.excluded_ids = (rules.excluded_ids || []).join("\n");
    for (const [prefix, role] of [["protected", "protected_lands"], ["water", "drinking_water"],
      ["quality", "high_quality_waters"]]) {
      const ref = spec.contexts?.[role]; if (!ref) continue;
      d[prefix + "_source"] = refKey(ref); d[prefix + "_layer"] = ref.layer || "";
      d[prefix + "_reference"] = ref.reference || ""; d[prefix + "_meaning"] = ref.meaning || "";
      d[prefix + "_relation"] = ref.relation || d[prefix + "_relation"];
      if (prefix === "quality" && finite(ref.buffer_m)) d.quality_buffer = String(ref.buffer_m);
    }
    if (spec.costs) {
      d.cost_source = refKey(spec.costs);
      for (const [field, key] of [["cost_id_column", "id_column"], ["cost_value_column", "value_column"],
        ["currency", "currency"], ["cost_reference", "reference"]]) d[field] = spec.costs[key] || "";
    }
    for (const name of Object.keys(d).filter(key => key.startsWith("method_"))) {
      if (previous[name] !== undefined) d[name] = previous[name];
    }
    d.score_basis = "published_method";
    if (!allNativeClasses(d)) d.method_native_classes = false;
    const category = methodCategory(d.method_category);
    if (category && d.purpose !== "screening" && d.purpose !== category.purpose) {
      d.method_category = publishedCategories().find(row => row.purpose === d.purpose)?.id || d.method_category;
    }
    return d;
  }

  function buildCriteriaSpec() {
    const study = buildSpec({ forCriteria: true });
    if (study.unit_type !== "parcel") {
      throw new Error("Choose the original parcel geometry and Parcel as the source unit type.");
    }
    return { schema: "upstate.parcel-criteria-selection/v1",
      title: study.title + " — parcel criteria", study,
      settings: { spatial_criteria_basis: memory().draft.criterion_geometry || "whole_original_parcel" } };
  }
  function buildPlanSpec() {
    const ui = memory(), p = ui.portfolio;
    if (!ui.study?.id) throw new Error("Open a completed candidate inventory first.");
    if (!p.title.trim()) throw new Error("Give the portfolio a title.");
    const limits = { area_basis: p.area_basis || "whole_units" };
    const area = numeric(p.area, "Area limit", { optional: true });
    const cost = numeric(p.cost, "Cost limit", { optional: true });
    const count = numeric(p.count, "Planning-unit limit", { optional: true, integer: true });
    if (area !== null) limits.maximum_area_ha = area;
    if (cost !== null) limits.maximum_cost = cost;
    if (count !== null) limits.maximum_parcels = count;
    if (cost !== null && !ui.study.spec?.costs) {
      throw new Error("A cost limit needs a study with a retained cost table and currency.");
    }
    if (p.mode === "manual" && !checkedCount(ui)) throw new Error("Select at least one planning unit.");
    if (p.mode === "manual" && !p.include_ineligible) {
      const excluded = candidates().filter(item => checked(item, ui) && !item.eligible);
      if (excluded.length) throw new Error("The checked selection contains " + excluded.length +
        " excluded units. Review their reasons or explicitly include units with eligibility exclusions.");
    }
    if (p.mode === "ranked" && p.objective === "score_per_cost" && !ui.study.spec?.costs) {
      throw new Error("Score per cost needs a study with a retained cost table.");
    }
    return { title: p.title.trim(), study_id: ui.study.id, mode: p.mode,
      selected_ids: p.mode === "manual" ? [...ui.selectedIds].sort() : [],
      objective: p.objective, limits, include_ineligible: !!p.include_ineligible };
  }
  async function openStudy(id, preserveSelection = false) {
    const key = workspace(), ui = memory(key), version = ++ui.readVersion;
    ui.busy = true;
    paint();
    try {
      const result = await catalogRead("study", { study_id: id });
      if (!result || version !== ui.readVersion || workspace() !== key) return;
      const same = String(ui.study?.id) === String(result.id);
      if (!same) { resetCatalog(ui); resetCatalogFilters(ui); }
      ui.study = result;
      if (!preserveSelection && !same) {
        clearChecked(ui); ui.plan = null; ui.selectionOrigin = null;
        ui.portfolio = freshPortfolio(); ui.optimization = null; ui.optimizationResult = null; ui.form = null; ui.page = 1;
        ui.displayAlternative = result.spec?.score?.alternative_run_id || "";
      }
      ui.detailId = null; ui.detailRow = null;
      if (result.state === "complete") await refreshCatalog(true);
      if (result.mode === "source_context" && result.spec?.score?.basis === "context" &&
          !Object.values(result.spec?.score?.context_weights || {}).some(value => finite(value) && value !== 0) &&
          ui.portfolio.objective === "score") ui.portfolio.objective = "area";
    } catch (error) {
      if (workspace() === key) ui.notice = { kind: "error", message: error.message || String(error) };
    } finally {
      if (version === ui.readVersion) ui.busy = false;
      if (workspace() === key) paint();
    }
  }
  async function openPlan(id) {
    const key = workspace(), ui = memory(key), version = ++ui.readVersion;
    ui.busy = true; paint();
    try {
      const plan = await read("plan", { plan_id: id });
      if (!plan || version !== ui.readVersion || workspace() !== key) return;
      const study = await catalogRead("study", { study_id: plan.study_id });
      if (!study || version !== ui.readVersion || workspace() !== key) return;
      resetCatalog(ui); resetCatalogFilters(ui); clearChecked(ui);
      ui.study = study; ui.plan = plan;
      ui.displayAlternative = study.spec?.score?.alternative_run_id || "";
      ui.selectedIds = new Set((plan.selected_ids || []).map(String));
      ui.selectionOrigin = plan.id; ui.page = 1; ui.detailId = null;
      ui.form = null; ui.notice = { kind: "status", message: "Opened " + (plan.title || plan.id) + "." };
      const cohort = plan.selection?.catalog_selection;
      if (cohort?.selection_id) {
        const retained = await catalogRead("selection", { study_id: study.id, selection_id: cohort.selection_id });
        if (workspace() !== key || version !== ui.readVersion) return;
        ui.retainedSelection = retained;
        ui.selectedIds = new Set((cohort.include_ids || []).map(String));
        ui.excludedIds = new Set((cohort.exclude_ids || []).map(String));
      }
      if (study.state === "complete") await refreshCatalog(true);
    } catch (error) {
      if (workspace() === key) ui.notice = { kind: "error", message: error.message || String(error) };
    } finally {
      if (version === ui.readVersion) ui.busy = false;
      if (workspace() === key) paint();
    }
  }
  async function queue(action, payload) {
    const key = workspace(), ui = memory(key);
    if (ui.busy) return;
    ui.busy = true; paint();
    try {
      await submitAction(action, payload);
      if (workspace() !== key) return;
      ui.form = null;
      ui.notice = { kind: "status", message:
        "Open the workspace task in Tasks for its progress, results and downloads." };
      ui.taskStamp = "";
      await refreshOverview(true);
    } catch (error) {
      if (workspace() === key) ui.notice = { kind: "error", message: error.message || String(error) };
    } finally {
      ui.busy = false;
      if (workspace() === key) paint();
    }
  }

  function contextFields(prefix, title, note) {
    const d = memory().draft;
    return '<details class="cons-disclosure"><summary>' + h(title) + "</summary><p>" + h(note) +
      '</p><div class="cons-grid">' +
      sourceSelect(prefix + "_source", "Retained source", d[prefix + "_source"], true) +
      input(prefix + "_layer", "Layer, when the source has several", d[prefix + "_layer"]) +
      input(prefix + "_reference", "Source reference (uses imported URI when blank)", d[prefix + "_reference"]) +
      input(prefix + "_meaning", "Meaning of this source", d[prefix + "_meaning"]) +
      input(prefix + "_relation", "Relationship to planning units", d[prefix + "_relation"]) +
      (prefix === "quality" ? input("quality_buffer", "Declared context buffer (metres)",
        d.quality_buffer, 'type="number" min="0" step="any"') : "") + "</div></details>";
  }
  function publishedMethodFields(d) {
    const method = publishedMethod(), category = methodCategory(d.method_category);
    const categories = publishedCategories();
    if (!categories.length) return '<p class="cons-help">Loading the published practice definitions.</p>';
    const ranges = category?.priority || [];
    return select("criterion_geometry", "Source criterion geometry", d.criterion_geometry || "whole_original_parcel",
      [["whole_original_parcel", "Whole original parcel · published method"],
       ["reporting_parcel", "Reporting intersection · regional adaptation"]]) +
      '<div class="cons-actions">' + button("prepare-criteria", "Build criteria from imported layers", "", memory().busy) +
      '</div><p class="cons-help">Prepare the parcel criterion table from the selected geometry and the imported source layers. Use its completed task to attach the table here.</p><div class="cons-grid">' +
      select("method_category", "Published practice category", d.method_category,
        categories.map(item => [item.id, item.title + " · " + item.maximum + " points"])) +
      sourceSelect("method_source", "Retained parcel criterion table", d.method_source) +
      select("method_format", "Criterion table format", d.method_format, [["json", "JSON"], ["csv", "CSV"]]) +
      input("method_id_column", "Parcel ID column", d.method_id_column) +
      (d.method_category === "land_protection" ?
        select("method_headwaters", "Headwater criterion", d.method_headwaters, [
          ["table31", "Stream orders 1 and 2 · Table 31"],
          ["appendix_d", "Stream order 1 · Appendix D wording"],
        ]) + (d.method_headwaters === "appendix_d" ?
          input("method_order_field", "Original stream-order column", d.method_order_field) : "") : "") +
      "</div><p class=\"cons-help\">" + h(category?.title || "") +
      (category ? " uses the " + h(category.purpose) + " purpose and a maximum of " + number(category.maximum) + " points." : "") +
      " Select actual parcel geometry for these criteria.</p>" +
      (ranges.length ? '<p class="cons-help">Published classes: ' +
        ranges.map(range => h(human(range.label)) + " " + number(range.min) + "–" + number(range.max)).join(" · ") + ".</p>" : "") +
      (d.mode === "native_model" && exportCategory(d.method_category) && allNativeClasses(d) ?
        check("method_native_classes", "Use current model export classes", d.method_native_classes) +
        '<p class="cons-help">This option groups the current study’s positive parcel-mean nitrogen, phosphorus and sediment exports into tertiles. ' +
        "The saved cutoffs document this adaptation of the published point method.</p>" :
        d.mode === "native_model" && exportCategory(d.method_category) ?
          '<p class="cons-help">The retained criterion table supplies the published export classes. Choose a baseline containing NDR and SDR to derive all three classes from current model quantities.</p>' : "") +
      '<label class="cons-field"><span>Study interpretation</span><textarea data-field="method_interpretation" rows="3" ' +
      'placeholder="Record the source edition and any study-specific interpretation.">' +
      h(d.method_interpretation) + "</textarea></label>" +
      '<details class="cons-disclosure"><summary>Criteria and published source</summary>' +
      '<p>' + h(method.title || "Lake Keowee practice points") + " · " +
      link(method.source_uri || method.reference, "Published method") + "</p>" +
      '<p class="cons-help">The table joins these criterion names to each parcel’s stable source ID. Criterion values and references travel with the saved study.</p>' +
      '<ul class="cons-criterion-list">' + (category?.required_metrics || []).map(name =>
        "<li><code>" + h(name) + "</code></li>").join("") + "</ul></details>";
  }
  function attainablePoints(values) {
    return Array.isArray(values) ? [...new Set(values.filter(finite))].sort((a, b) => a - b) : [];
  }
  function pointScore(candidate) {
    const isPoints = memory().study?.spec?.score?.basis === "published_method";
    if (!isPoints) return number(candidate.score);
    const options = attainablePoints(candidate.point_score?.score_options);
    const score = finite(candidate.score) ? number(candidate.score) + " points" :
      options.length ? options.map(number).join(", ") + " points" : "Unresolved";
    return score + (options.length > 1 ?
      '<span class="cons-metric-note">Possible point totals; unlisted intermediate values are not implied</span>' : "") +
      (candidate.point_priority ? '<span class="cons-metric-note">' + h(human(candidate.point_priority)) + " priority</span>" :
        Array.isArray(candidate.point_score?.priority_options) && candidate.point_score.priority_options.length ?
          '<span class="cons-metric-note">Attainable priorities: ' +
          h(candidate.point_score.priority_options.map(human).join(", ")) + "</span>" : "");
  }
  function criterionReference(reference) {
    if (!reference) return "Reference not recorded";
    if (typeof reference === "string") return link(reference);
    const label = [
      reference.table ? "Table " + reference.table : "",
      reference.printed_page ? "printed page " + reference.printed_page : "",
      reference.edition ? String(reference.edition) : "",
    ].filter(Boolean).join(" · ") || "Original method reference";
    return reference.source_uri ? link(reference.source_uri, label) : h(label);
  }
  function pointCriteria(candidate) {
    return renderKeoweePointCriteria(candidate, {
      formatNumber: number,
      originalReference: criterionReference,
    });
  }
  function studyForm() {
    const ui = memory(), d = ui.draft, native = d.mode === "native_model";
    const availableRuns = runs(), activeOutputs = scoreOutputs(d);
    const weightControl = (field, name, title) => input(field,
      title + " weight" + (activeOutputs.has(name) ? "" : " (unavailable for this selection)"),
      activeOutputs.has(name) ? d[field] : "0",
      'type="number" min="0" step="any" aria-describedby="conservation-score-outputs"' +
      (activeOutputs.has(name) ? "" : " disabled"));
    const runItems = [["", "Choose a completed run"], ...availableRuns.map(run =>
      [run.id, (run.title || run.selection?.title || run.id) + " · " + runQuantityLabel(run) + " · " + run.id])];
    const alternatives = availableRuns.filter(run => run.id !== d.baseline_run_id);
    return '<form class="cons-editor" data-cons-form="study"><div class="cons-section-title">' +
      "<h2>New conservation study</h2>" + button("close-form", "Close") + "</div>" +
      '<p class="cons-help">A study preserves its input choices and rules. Choose the actual unit type ' +
      "so watersheds and management zones keep their source meaning.</p>" +
      '<div class="cons-grid">' +
      input("title", "Study title", d.title, 'required autocomplete="off"') +
      select("mode", "Analysis mode", d.mode, [
        ["source_context", "Source geometry and context"], ["native_model", "Native model quantities and context"]]) +
      select("purpose", "Planning purpose", d.purpose, [
        ["screening", "General screening"], ["protection", "Protection"], ["restoration", "Restoration"]]) +
      select("unit_type", "Source unit type", d.unit_type, [
        ["management_unit", "Management unit"], ["parcel", "Parcel"], ["watershed", "Watershed"]]) +
      input("planning_unit_label", "Unit label shown in results", d.planning_unit_label) +
      "</div><fieldset><legend>Planning-unit geometry</legend><div class=\"cons-grid\">" +
      sourceSelect("parcel_source", "Planning-unit source", d.parcel_source) +
      input("parcel_layer", "Layer, when the source has several", d.parcel_layer) +
      input("id_field", "Stable unit ID field (blank uses source handling)", d.id_field) +
      input("label_field", "Unit name field, if available", d.label_field) +
      input("parcel_where", "Exact native field selection (JSON, optional)", d.parcel_where,
        'aria-describedby="conservation-where-help" placeholder="{&quot;HUC12&quot;:&quot;030601010703&quot;}"') +
      '</div><p class="cons-help" id="conservation-where-help">Use original field names and exact values, ' +
      'for example <code>{&quot;HUC12&quot;:&quot;030601010703&quot;}</code>. ' +
      'Keep identifiers in quotes so their leading zeroes remain intact. Leave empty to use every source feature.</p></fieldset>' +
      (native ? '<fieldset><legend>Native model runs</legend><div class="cons-grid">' +
        select("baseline_run_id", "Baseline run", d.baseline_run_id, runItems) +
        '</div><p class="cons-help">Use the retained baseline and explicit alternatives from the same study domain.</p>' +
        '<div class="cons-choice-list" role="group" aria-label="Alternative model runs">' +
        (alternatives.length ? alternatives.map(run =>
          '<label class="cons-check"><input type="checkbox" data-alt-id="' + h(run.id) + '"' +
          (d.alternative_run_ids.includes(run.id) ? " checked" : "") + "> <span>" +
          h(run.title || run.selection?.title || run.id) + " · " + h(runQuantityLabel(run)) + " · " + h(run.id) + "</span></label>").join("") :
          "<p>No additional completed runs are available.</p>") + "</div>" +
        nativeExecution({spec: d, native_execution: Object.fromEntries(availableRuns.filter(run =>
          run.id === d.baseline_run_id || d.alternative_run_ids.includes(run.id))
          .filter(run => run.execution).map(run => [run.id, run.execution]))}) + "</fieldset>" :
        '<fieldset><legend>Reporting area</legend><p class="cons-help">Area and overlap calculations use ' +
        "these retained boundaries. A reporting watershed becomes drinking-water context only when it has that documented role.</p>" +
        '<div class="cons-grid">' +
        sourceSelect("reporting_source", "Reporting-area source", d.reporting_source) +
        input("reporting_layer", "Reporting-area layer", d.reporting_layer) +
        input("analysis_crs", "Projected analysis CRS", d.analysis_crs) + "</div></fieldset>") +
      "<fieldset><legend>Source-based context</legend>" +
      contextFields("protected", "Protected lands",
        "Retain the source designation and edition. Protection overlap is an optional criterion; the default leaves all protection shares eligible.") +
      contextFields("water", "Water-context geography",
        "Choose retained geography and record whether it represents source-water areas, intake-related geography or utility-focus watersheds. Describe its actual relationship to the planning units.") +
      contextFields("quality", "High-quality waters",
        "Use the retained outstanding-resource, trout or other relevant source designation. Record the source meaning and any explicit spatial buffer.") +
      "</fieldset><fieldset><legend>Eligibility</legend><div class=\"cons-grid\">" +
      input("minimum_area", "Minimum reporting-area footprint (ha)", d.minimum_area, 'type="number" min="0" step="any"') +
      input("maximum_protected", "Maximum protected share (%)", d.maximum_protected, 'type="number" min="0" max="100" step="any"') +
      input("minimum_water", "Minimum mapped water-context share (%)", d.minimum_water, 'type="number" min="0" max="100" step="any"') +
      input("minimum_coverage", "Minimum native model coverage (%)", d.minimum_coverage, 'type="number" min="0" max="100" step="any"') +
      '</div><p class="cons-help">Model coverage applies when a native run is bound. Missing required context stays visible in the eligibility reasons.</p>' +
      check("require_quality", "Require the retained high-quality-water context", d.require_quality) +
      '<label class="cons-field">Exclude specific unit IDs<textarea data-field="excluded_ids" rows="2" ' +
      'placeholder="One ID per line or comma-separated">' + h(d.excluded_ids) + "</textarea></label></fieldset>" +
      '<fieldset><legend>Priority settings</legend><div class="cons-grid">' +
      select("score_basis", "What the priority represents", d.score_basis,
        (native ? [
          ["current_export", "Current modeled annual export"],
          ["scenario_reduction", "Reduction under a selected alternative"],
          ["disturbance_increase", "Increase under a disturbance alternative"],
        ] : [["context", "Source geometry and context weights"]]).concat([
          ["published_method", "Published practice points"],
        ])) + "</div>" +
      (d.score_basis === "published_method" ? publishedMethodFields(d) :
        native ? '<div class="cons-grid">' +
        select("score_scale", "Quantity scale", d.score_scale, [
          ["total", "Total annual quantity"], ["per_hectare", "Annual quantity per reporting hectare"]]) +
        (d.score_basis !== "current_export" ? select("score_alternative", "Scoring alternative",
          d.score_alternative, [["", "Choose the scoring alternative"], ...alternatives.map(run =>
            [run.id, (run.title || run.id) + " · " + runQuantityLabel(run) + " · " + run.id])]) : "") +
        weightControl("weight_n", "nitrogen_export", "Nitrogen") +
        weightControl("weight_p", "phosphorus_export", "Phosphorus") +
        weightControl("weight_s", "sediment_export", "Sediment") +
        '</div><p class="cons-help" id="conservation-score-outputs">Scoring uses ' +
        (activeOutputs.size ? POLLUTANTS.filter(([name]) => activeOutputs.has(name)).map(([, title]) => h(title)).join(", ") :
          "the pollutants shared by your selected completed baseline and scoring alternative") +
        '. Unavailable pollutant weights are zero. Their physical quantities retain their recorded availability. ' +
        'Your entered weights return when their native outputs are selected again.</p>' +
        '<p class="cons-help">Protection can use the increase under an explicit disturbance scenario. ' +
        "Restoration can use current export or a reduction scenario. The saved priority score retains its component weights; annual pollutant quantities remain separate.</p>" :
        '<div class="cons-grid">' +
        input("context_water_weight", "Mapped water-context share weight", d.context_water_weight, 'type="number" min="0" step="any"') +
        input("context_unprotected_weight", "Unprotected share weight", d.context_unprotected_weight, 'type="number" min="0" step="any"') +
        input("context_quality_weight", "High-quality-water context weight", d.context_quality_weight, 'type="number" min="0" step="any"') +
        '</div><p class="cons-help">Each active weight requires its corresponding retained source layer. ' +
        "Leave weights blank for manual selection or an area-ranked portfolio.</p>") +
      "</fieldset><details class=\"cons-disclosure\"><summary>Optional cost table</summary>" +
      '<p class="cons-help">Use recorded costs and a declared currency. Units without matching costs remain identifiable.</p><div class="cons-grid">' +
      sourceSelect("cost_source", "Cost source", d.cost_source, true) +
      input("cost_id_column", "Matching unit ID column", d.cost_id_column) +
      input("cost_value_column", "Cost value column", d.cost_value_column) +
      input("currency", "Currency or cost unit", d.currency, 'placeholder="Declared source currency"') +
      input("cost_reference", "Cost source reference", d.cost_reference) +
      "</div></details><details class=\"cons-disclosure\"><summary>Advanced specification</summary>" +
      '<p class="cons-help">Use the full specification for additional source or ranking settings. ' +
      "When enabled, the JSON below is the complete specification submitted.</p>" +
      button("populate-json", "Copy form values into JSON editor") +
      check("advanced_use", "Use this edited JSON as the full study specification", d.advanced_use) +
      '<label class="cons-field">Study JSON<textarea data-field="advanced_text" rows="14" spellcheck="false">' +
      h(d.advanced_text) + "</textarea></label></details>" +
      '<div class="cons-actions">' + button("submit-study", "Build candidate inventory", "", ui.busy) +
      button("prepare-study", "Save inputs without building", "", ui.busy) +
      "</div></form>";
  }
  function optimizationAxes(draft = memory().optimization) {
    const study = memory().study, kind = draft?.kind || "source-context";
    const bindings = study?.selection?.bindings || {};
    if (kind === "published-method") {
      return study?.spec?.score?.basis === "published_method" && bindings.published_method
        ? [["published_points", "Published practice points", draft?.basis === "per-reporting-hectare" ? "points/reporting ha" : "points"]] : [];
    }
    if (kind === "source-context") {
      const sources = bindings.sources || {};
      return [["reporting_area_ha", "Reporting area", "ha"],
        ...(sources.drinking_water ? [["source_water_area_ha", "Source-water area", "ha"]] : []),
        ...(sources.protected_lands ? [["unprotected_area_ha", "Unprotected area", "ha"]] : []),
        ...(sources.high_quality_waters ? [["high_quality_context", "High-quality-water context", "presence"]] : [])];
    }
    const baseline = bindings.runs?.[study?.spec?.baseline_run_id];
    let available = new Set(Object.keys(baseline?.outputs || {}));
    if (kind !== "current-export") {
      const alternative = bindings.runs?.[draft?.scenario_run_id];
      const shared = new Set(Object.keys(alternative?.outputs || {}));
      available = new Set([...available].filter(axis => shared.has(axis)));
    }
    return POLLUTANTS.filter(([axis]) => available.has(axis)).map(([axis, label]) =>
      [axis, label, axis === "sediment_export" ? "metric tonnes/year" : "kg/year"]);
  }

  function optimizationDraft(study, request = null) {
    const kinds = { context: "source-context", current_export: "current-export",
      scenario_reduction: "restoration", disturbance_increase: "avoided-conversion", published_method: "published-method" };
    const kind = request?.objective?.kind || kinds[study?.spec?.score?.basis] ||
      (study?.mode === "source_context" ? "source-context" : "current-export");
    const draft = {
      title: request?.title || (study?.title || "Conservation study") + " — optimized portfolio",
      purpose: request?.purpose || "Select land priorities under explicit area, cost and coverage limits.",
      kind, basis: request?.objective?.basis || "total",
      scenario_run_id: request?.objective?.scenario_run_id || study?.spec?.score?.alternative_run_id ||
        study?.spec?.alternative_run_ids?.[0] || "",
      area: request?.constraints?.area_ha ?? "", budget: request?.constraints?.budget_usd ?? "",
      count: request?.constraints?.max_count ?? "", area_basis: request?.constraints?.area_basis || "whole_units",
      minimum_coverage: String(100 * (request?.filters?.min_coverage_fraction ??
        study?.spec?.rules?.minimum_coverage_fraction ?? .95)),
      maximum_protected: String(100 * (request?.filters?.max_protected_fraction ?? 1)),
      source_water: request?.filters?.source_water || "any",
      high_quality_water: request?.filters?.high_quality_water || "any",
      include_ids: JSON.stringify(request?.filters?.include_ids || []),
      exclude_ids: JSON.stringify(request?.filters?.exclude_ids || []),
      include_ineligible: !!request?.include_ineligible,
      solver: request?.solver || "deterministic",
      solver_seconds: String(request?.solver_time_limit_seconds || 20),
      stability: request?.stability?.enabled ?? true,
      preference_profiles: request?.stability?.profiles?.length ? JSON.stringify(request.stability.profiles, null, 2) : "",
    };
    for (const [axis] of [...POLLUTANTS, ["reporting_area_ha"], ["source_water_area_ha"],
      ["unprotected_area_ha"], ["high_quality_context"], ["published_points"]]) {
      draft["weight_" + axis] = String(request?.weights?.[axis] ??
        (kind === "published-method" ? (axis === "published_points" ? 1 : 0) :
          kind === "source-context" ? (axis === "reporting_area_ha" ? 1 : 0) :
          POLLUTANTS.some(([name]) => name === axis) ? 1 : 0));
    }
    return draft;
  }

  function optimizationIds(raw, label) {
    if (!String(raw || "").trim()) return [];
    let values;
    try { values = JSON.parse(raw); } catch (_) { throw new Error(label + " must be a JSON array of original unit IDs."); }
    if (!Array.isArray(values) || values.some(value => typeof value !== "string" || !value.length)) {
      throw new Error(label + " must contain the original nonempty string IDs.");
    }
    return [...new Set(values)].sort();
  }

  function buildOptimizationSpec() {
    const ui = memory(), d = ui.optimization, study = ui.study;
    if (!study?.id || study.state !== "complete") throw new Error("Open a completed conservation inventory.");
    if (!d?.title?.trim()) throw new Error("Give this portfolio decision a title.");
    const axes = optimizationAxes(d);
    if (!axes.length) throw new Error("Choose an available objective from the original study and its retained cases.");
    const weights = Object.fromEntries(axes.map(([axis, label]) =>
      [axis, numeric(d["weight_" + axis], label + " weight")]));
    if (!Object.values(weights).some(weight => weight > 0)) throw new Error("Give at least one available objective a positive weight.");
    const objective = { kind: d.kind, basis: d.kind === "source-context" ? "total" : d.basis };
    if (["restoration", "avoided-conversion"].includes(d.kind)) {
      if (!(study.spec?.alternative_run_ids || []).includes(d.scenario_run_id)) {
        throw new Error("Choose an original alternative retained by this study.");
      }
      objective.scenario_run_id = d.scenario_run_id;
    }
    const constraints = { area_basis: d.area_basis };
    for (const [key, value, label, integer] of [
      ["area_ha", d.area, "Area limit", false], ["max_count", d.count, "Unit limit", true]]) {
      const parsed = numeric(value, label, { optional: true, integer });
      if (parsed !== null) constraints[key] = parsed;
    }
    if (String(d.budget ?? "").trim()) {
      if (study.spec?.costs?.currency !== "USD") throw new Error("A USD budget needs this study's original USD cost table.");
      const budget = String(d.budget).trim();
      if (!/^\d+(?:\.\d{1,2})?$/.test(budget)) throw new Error("Enter the original USD budget with at most two decimal places.");
      constraints.budget_usd = budget;
    }
    const include_ids = optimizationIds(d.include_ids, "Candidate universe"),
      exclude_ids = optimizationIds(d.exclude_ids, "Excluded units");
    // The native optimizer validates IDs against the complete original inventory.
    // The candidate desk retains only the current visible page in this browser.
    if (include_ids.some(id => exclude_ids.includes(id))) throw new Error("A unit cannot appear in both the candidate universe and exclusions.");
    const stability = { enabled: !!d.stability };
    if (d.stability && d.preference_profiles.trim()) {
      try { stability.profiles = JSON.parse(d.preference_profiles); }
      catch (_) { throw new Error("Named preference comparisons must be a JSON array."); }
      if (!Array.isArray(stability.profiles)) throw new Error("Named preference comparisons must be a JSON array.");
    }
    return { study_id: study.id, title: d.title.trim(), purpose: d.purpose.trim(), objective, weights,
      filters: { min_coverage_fraction: numeric(d.minimum_coverage, "Native coverage", { max: 100 }) / 100,
        max_protected_fraction: numeric(d.maximum_protected, "Protected fraction", { max: 100 }) / 100,
        source_water: d.source_water, high_quality_water: d.high_quality_water, include_ids, exclude_ids },
      include_ineligible: !!d.include_ineligible, constraints, solver: d.solver,
      solver_time_limit_seconds: numeric(d.solver_seconds, "Solver time per preference", { min: .001 }), stability };
  }

  function optimizationForm() {
    const ui = memory(), study = ui.study;
    ui.optimization ||= optimizationDraft(study);
    const d = ui.optimization, native = study?.mode === "native_model",
      paired = ["restoration", "avoided-conversion"].includes(d.kind), axes = optimizationAxes(d);
    const choices = [["source-context", "Geographic source context"],
      ...(study?.spec?.score?.basis === "published_method" && study?.selection?.bindings?.published_method
        ? [["published-method", "Original published practice points"]] : []),
      ...(native ? [["current-export", "Current modeled export"],
        ["restoration", "Reduction from the selected restoration case"],
        ["avoided-conversion", "Increase from the selected conversion case"]] : [])];
    const textArea = (name, label, value, rows = 3) => '<label class="cons-field" for="' + fieldId(name) +
      '"><span>' + h(label) + '</span><textarea id="' + fieldId(name) + '" data-field="' + h(name) +
      '" rows="' + rows + '" spellcheck="false">' + h(value) + '</textarea></label>';
    return '<form class="cons-editor" data-cons-form="optimization"><div class="cons-section-title">' +
      '<h2>Optimize a portfolio</h2>' + button("close-form", "Close") + '</div><p>Compare the full retained inventory under ' +
      'explicit resource limits. The saved portfolio recomputes areas and native quantities across the selected geometry union.</p>' +
      '<div class="cons-grid">' + input("optimization.title", "Portfolio title", d.title, "required") +
      input("optimization.purpose", "Decision purpose", d.purpose) +
      select("optimization.kind", "Decision objective", d.kind, choices) +
      (d.kind !== "source-context" ? select("optimization.basis", "Quantity basis", d.basis,
        (d.kind === "published-method"
          ? [["total", "Published points from the original practice rule"], ["per-reporting-hectare", "Published points per reporting hectare"]]
          : [["total", "Annual quantity in the reporting footprint"], ["per-reporting-hectare", "Annual quantity per reporting hectare"]])) : "") +
      (paired ? select("optimization.scenario_run_id", "Retained alternative case", d.scenario_run_id,
        [["", "Choose a retained alternative"], ...(study.spec?.alternative_run_ids || []).map(id => {
          const run = runs().find(row => row.id === id); return [id, (run?.title || id) + " · " + runQuantityLabel(run)];
        })]) : "") + '</div><fieldset><legend>Objective weights</legend><div class="cons-grid">' +
      axes.map(([axis,label,unit]) => input("optimization.weight_" + axis, label + " (" + unit + ")",
        d["weight_" + axis], 'type="number" min="0" step="any"')).join("") +
      '</div><p class="cons-help">' + (d.kind === "published-method"
        ? 'The objective uses completed points from the original retained practice rule, with its prerequisites, source definitions and native criterion support. The result retains every criterion and its known or possible points.'
        : 'Weights apply to normalized quantities from the retained inventory. Only outputs selected by the original cases are available; adverse modeled changes keep their sign.') + '</p></fieldset>' +
      '<fieldset><legend>Resource limits</legend><div class="cons-grid">' +
      input("optimization.area", "Maximum area (ha), optional", d.area, 'type="number" min="0" step="any"') +
      select("optimization.area_basis", "Area limit measures", d.area_basis,
        [["whole_units", "Full original planning units"], ["reporting", "Within the reporting area"]]) +
      input("optimization.count", "Maximum units, optional", d.count, 'type="number" min="0" step="1"') +
      input("optimization.budget", "Original USD budget, optional", d.budget,
        'inputmode="decimal"' + (study.spec?.costs?.currency === "USD" ? "" : " disabled")) +
      '</div><p class="cons-help">The solver uses additive source-unit area for resource feasibility; the result also reports ' +
      'the actual union and removed overlap.' + (study.spec?.costs?.currency === "USD" ? "" :
      " Add an original USD cost table to the study to enable a dollar budget.") + '</p></fieldset>' +
      '<details class="cons-disclosure"><summary>Candidate and coverage filters</summary><div class="cons-grid">' +
      input("optimization.minimum_coverage", "Minimum native coverage (%)", d.minimum_coverage, 'type="number" min="0" max="100" step="any"') +
      input("optimization.maximum_protected", "Maximum protected share (%)", d.maximum_protected, 'type="number" min="0" max="100" step="any"') +
      select("optimization.source_water", "Mapped source-water relation", d.source_water,
        [["any", "Any"], ["yes", "Present"], ["no", "Absent in the retained mapping"]]) +
      select("optimization.high_quality_water", "High-quality-water relation", d.high_quality_water,
        [["any", "Any"], ["yes", "Present"], ["no", "Absent in the retained mapping"]]) +
      '</div>' + check("optimization.include_ineligible", "Include units excluded by the original study rules", d.include_ineligible) +
      textArea("optimization.include_ids", "Candidate universe: original IDs as JSON; [] uses the full inventory", d.include_ids) +
      button("optimization-use-checked", "Use checked units as the candidate universe", "", ui.busy || !checkedCount(ui)) +
      textArea("optimization.exclude_ids", "Excluded original IDs as JSON", d.exclude_ids) + '</details>' +
      '<details class="cons-disclosure"><summary>Solver and preference comparisons</summary><div class="cons-grid">' +
      select("optimization.solver", "Selection method", d.solver,
        [["deterministic", "Deterministic selection with a retained bound"], ["scipy-milp", "SciPy mixed-integer optimization"]]) +
      input("optimization.solver_seconds", "Solver time per preference (seconds)", d.solver_seconds, 'type="number" min="0.001" step="any"') +
      '</div>' + check("optimization.stability", "Compare selection across named preferences", d.stability) +
      '<p>Leaving the profile list empty compares the individual available objectives. Frequency means how often a unit ' +
      'is selected across these decision preferences.</p>' +
      textArea("optimization.preference_profiles", "Optional preference profiles: [{name, weights}]", d.preference_profiles, 5) +
      '</details><div class="cons-actions">' + button("optimization-preview", "Preview portfolio selection", "", ui.busy || !axes.length) +
      button("optimization-save", "Optimize and save portfolio", "", ui.busy || !axes.length) + '</div></form>';
  }

  async function openOptimization({ taskId = null, studyId = null, analysisId = null } = {}) {
    const key = workspace(), ui = memory(key), version = ++ui.readVersion;
    ui.busy = true; paint();
    try {
      let analysis, downloads = [], task = null;
      if (taskId) {
        task = await api(endpoint("/api/task", { id: taskId }));
        if (workspace() !== key || version !== ui.readVersion) return;
        if (task.workspace !== key || task.action !== "conservation.optimization.preview" ||
            task.state !== "complete" || !task.result?.request) {
          throw new Error("Open a completed portfolio optimization preview in this workspace.");
        }
        analysis = task.result;
        studyId = analysis.input?.study_id;
      } else {
        const retained = await api(endpoint("/api/conservation-optimization/analysis",
          { study_id: studyId, analysis_id: analysisId }));
        if (workspace() !== key || version !== ui.readVersion) return;
        analysis = retained.analysis; downloads = retained._downloads || [];
      }
      if (!analysis?.request || !studyId || analysis.input?.study_id !== studyId) {
        throw new Error("The original analysis does not identify this conservation study.");
      }
      const study = await catalogRead("study", { study_id: studyId });
      if (!study || workspace() !== key || version !== ui.readVersion) return;
      if (ui.study?.id !== study.id) {
        resetCatalog(ui); resetCatalogFilters(ui); clearChecked(ui); ui.plan = null;
      }
      ui.study = study;
      ui.optimization = optimizationDraft(study, analysis.request);
      ui.optimizationResult = { analysis, downloads, task_id: task?.id || null };
      ui.optimizationPage = 1; ui.optimizationFilter = "all"; ui.optimizationSearch = "";
      ui.form = "optimization-result"; ui.detailId = null; ui.detailRow = null; ui.notice = null;
      if (study.state === "complete") await refreshCatalog(true);
    } finally {
      if (version === ui.readVersion) ui.busy = false;
      if (workspace() === key) paint();
    }
  }

  function optimizationRequestForSave() {
    const result = memory().optimizationResult, analysis = result?.analysis;
    if (!analysis?.selected_ids?.length || !result.task_id) {
      throw new Error("Open the completed original preview before saving its selection.");
    }
    if (analysis.input?.study_id !== memory().study?.id) throw new Error("Reopen this decision's original study.");
    return { preview_task_id: result.task_id };
  }

  function optimizationResultView() {
    const ui = memory(), result = ui.optimizationResult, a = result?.analysis;
    if (!a) return "";
    const chosen = a.selection || {}, geometry = chosen.geometry || {}, outcome = a.optimization || {};
    const search = (ui.optimizationSearch || "").toLocaleLowerCase(), mode = ui.optimizationFilter || "all";
    const filteredRows = (a.candidates || []).filter(row =>
      (mode === "all" || (mode === "selected" ? row.selected : mode === "eligible" ? row.eligible : !row.eligible)) &&
      (!search || [row.feature_id, row.label].some(value => String(value || "").toLocaleLowerCase().includes(search))));
    const pageCount = Math.max(1, Math.ceil(filteredRows.length / 25));
    ui.optimizationPage = Math.min(Math.max(1, ui.optimizationPage || 1), pageCount);
    const rows = filteredRows.slice((ui.optimizationPage - 1) * 25, ui.optimizationPage * 25);
    const axes = (a.request.available_axes || []).filter(axis => a.request.weights?.[axis] > 0);
    const label = axis => POLLUTANTS.find(([name]) => name === axis)?.[1] || human(axis);
    const valueCell = (row, axis) => {
      const support = row.axis_support?.[axis] || {};
      return '<td>' + number(row.objective_values?.[axis]) + '<span class="cons-metric-note">' +
        h(row.objective_units?.[axis] || "") +
        (finite(support.coverage_fraction) ? " · " + h(percent(support.coverage_fraction)) + " coverage" : "") +
        (!support.eligible_support ? " · " + h(support.availability_reason || human(support.availability || "Unavailable")) : "") +
        '</span></td>';
    };
    const solver = '<dl class="cons-definitions"><dt>Selection method</dt><dd>' + h(outcome.algorithm || a.request.solver) +
      '</dd><dt>Solver result</dt><dd>' + h(human(outcome.status || "")) +
      '</dd><dt>Objective score</dt><dd>' + number(outcome.objective_score) +
      '</dd><dt>Retained upper bound</dt><dd>' + number(outcome.upper_bound) +
      '</dd><dt>Relative gap</dt><dd>' + h(percent(outcome.relative_gap)) + '</dd></dl>';
    return '<section class="cons-editor" aria-label="Portfolio optimization result"><div class="cons-section-title"><div><h2>' +
      h(a.request.title) + '</h2><p>' + h(a.methods?.objective_scope || human(a.request.objective.kind)) +
      '</p></div>' + button("close-form", "Close analysis") + '</div><div class="cons-summary">' +
      [["Retained units", a.counts?.inventory], ["Eligible units", a.counts?.eligible], ["Selected units", a.counts?.selected],
        ["Full selected union (ha)", geometry.whole_unit_union_area_ha], ["Reporting union (ha)", geometry.reporting_union_area_ha],
        ["Reporting overlap removed (ha)", geometry.reporting_overlap_area_ha]].map(([name,value]) =>
          '<div><span>' + h(name) + '</span><strong>' + number(value) + '</strong></div>').join("") +
      '</div>' + solver + '<p>Recorded cost: ' + (finite(chosen.supplied_cost_total) ?
        number(chosen.supplied_cost_total) + " " + h(chosen.currency || "") :
        "Known subtotal " + number(chosen.known_supplied_cost_subtotal) + " " + h(chosen.currency || "") +
          "; " + number(chosen.units_without_supplied_cost) + " selected units have no recorded cost") + '.</p>' +
      '<div class="cons-actions">' +
      (result.task_id ? button("optimization-save-preview", "Save this decision as a portfolio", "", ui.busy || !a.selected_ids?.length) : "") +
      button("optimization-adjust", "Adjust objectives and limits") +
      button("optimization-select-results", "Show selected units in the inventory", "", !a.selected_ids?.length) +
      '</div>' + (result.downloads?.length && fileList ? fileList(result.downloads) : "") +
      '<details class="cons-disclosure"><summary>Preference comparisons</summary><p>' + h(a.stability?.interpretation || "") +
      '</p><div class="cons-table-wrap"><table class="cons-table"><thead><tr><th>Preference</th><th>Eligible</th>' +
      '<th>Selected</th><th>Solver result</th><th>Relative gap</th></tr></thead><tbody>' +
      (a.stability?.profiles || []).map(profile => '<tr><th scope="row">' + h(profile.name) + '</th><td>' +
        number(profile.eligible_count) + '</td><td>' + number(profile.selected_ids?.length) + '</td><td>' +
        h(human(profile.optimization?.status)) + '</td><td>' + h(percent(profile.optimization?.relative_gap)) + '</td></tr>').join("") +
      '</tbody></table></div></details><div class="cons-filters">' +
      '<label class="cons-field"><span>Find an original unit</span><input data-optimization-filter="search" value="' +
      h(ui.optimizationSearch || "") + '"></label><label class="cons-field"><span>Candidate view</span>' +
      '<select data-optimization-filter="mode">' + [["all","All retained units"],["selected","Selected"],["eligible","Eligible"],["excluded","Excluded"]]
        .map(([value,label]) => option(value,label,mode)).join("") + '</select></label></div>' +
      '<div class="cons-table-wrap"><table class="cons-table"><thead><tr><th>Original unit</th><th>Selection</th><th>Rank</th>' +
      axes.map(axis => '<th>' + h(label(axis)) + '</th>').join("") +
      '<th>Preference frequency</th><th>Reasons</th></tr></thead><tbody>' +
      rows.map(row => '<tr><th scope="row">' + button("candidate", row.label || row.feature_id,
        'data-candidate="' + h(row.feature_id) + '"') + '<span class="cons-metric-note">' + h(row.feature_id) +
        '</span></th><td>' + (row.selected ? "Selected" : row.eligible ? "Eligible" : "Excluded") + '</td><td>' +
        number(row.rank) + '</td>' + axes.map(axis => valueCell(row,axis)).join("") + '<td>' +
        number(row.preference_stability?.selected_profiles) + " / " + number(row.preference_stability?.profile_count) +
        '</td><td>' + h((row.exclusions || []).join("; ")) + '</td></tr>').join("") +
      '</tbody></table></div><div class="cons-actions">' +
      button("optimization-previous", "Previous", "", ui.optimizationPage <= 1) +
      '<span>' + number(filteredRows.length) + ' units · page ' + ui.optimizationPage + ' of ' + pageCount + '</span>' +
      button("optimization-next", "Next", "", ui.optimizationPage >= pageCount) +
      '</div><details class="cons-disclosure"><summary>Original decision and normalization</summary><pre>' +
      h(JSON.stringify({ request:a.request, normalization:a.normalization, methods:a.methods }, null, 2)) +
      '</pre></details></section>';
  }

  function portfolioForm() {
    const ui = memory(), p = ui.portfolio;
    return '<form class="cons-editor" data-cons-form="portfolio"><div class="cons-section-title">' +
      "<h2>Create portfolio</h2>" + button("close-form", "Close") + "</div>" +
      '<p class="cons-help">The saved portfolio retains its selection, limits and source study. ' +
      "Unique footprint and pollutant totals are recomputed across overlapping selected units.</p>" +
      '<div class="cons-grid">' +
      input("plan.title", "Portfolio title", p.title, 'required autocomplete="off"') +
      select("plan.mode", "Selection", p.mode, [
        ["manual", "Use my checked units"], ["ranked", "Add units by ranked priority"]]) +
      (p.mode === "ranked" ? select("plan.objective", "Ranking objective", p.objective, [
        ["score", "Saved priority score"], ["score_per_hectare", "Saved score per hectare"],
        ["score_per_cost", "Saved score per recorded cost"], ["area", "Reporting footprint area"]]) : "") +
      select("plan.area_basis", "Area limit measures", p.area_basis, [
        ["whole_units", "Full selected source units"], ["reporting", "Within reporting area"]]) +
      input("plan.area", "Maximum selected footprint (ha), optional", p.area, 'type="number" min="0" step="any"') +
      input("plan.cost", "Maximum recorded cost, optional", p.cost, 'type="number" min="0" step="any"') +
      input("plan.count", "Maximum number of units, optional", p.count, 'type="number" min="0" step="1"') +
      "</div>" + check("plan.include_ineligible", "Include units with eligibility exclusions", p.include_ineligible) +
      '<p class="cons-selection-count" aria-live="polite">' + checkedCount(ui) +
      " units are checked for manual selection.</p>" +
      (p.mode === "ranked" ? '<p class="cons-help">Ranked greedy selection adds eligible units in priority order, ' +
        "uses the complete study inventory, checks each new footprint against the limits and records skipped units and reasons.</p>" : "") +
      '<div class="cons-actions">' + button("save-plan", "Create saved portfolio", "", ui.busy) + "</div></form>";
  }
  function metricCell(metric, alternativeId = "", compact = true) {
    if (!metric) return '<span class="cons-muted">Native quantity unavailable</span>';
    if (metric.availability === "unbound") {
      return '<span class="cons-muted">Native run unbound</span>';
    }
    const quantity = finite(metric.baseline) ? number(metric.baseline) + " " + h(metric.unit || "") :
      '<span class="cons-muted">' + h(metric.reason || metric.availability_reason ||
        (metric.availability && metric.availability !== "modeled" ?
          human(metric.availability) : "No data")) + '</span>';
    const coverage = finite(metric.coverage_fraction) ? percent(metric.coverage_fraction) + " coverage" :
      "Coverage unavailable";
    const alternative = metric.alternatives?.[alternativeId];
    const change = alternative ? '<span class="cons-metric-note">Alternative ' +
      (finite(alternative.value) ? number(alternative.value) : "no data") +
      " · Δ " + (finite(alternative.delta) ? (alternative.delta > 0 ? "+" : "") +
      number(alternative.delta) : "—") + "</span>" +
      '<span class="cons-metric-note">Alternative support ' +
      (finite(alternative.coverage_fraction) ? percent(alternative.coverage_fraction) : "unavailable") +
      " · shared support " + (finite(alternative.common_coverage_fraction) ?
        percent(alternative.common_coverage_fraction) : "unavailable") + "</span>" +
      (alternative.reason || alternative.availability_reason ? '<span class="cons-metric-note">' +
        h(alternative.reason || alternative.availability_reason) + "</span>" : "") +
      (alternative.comparison_availability_reason ? '<span class="cons-metric-note">' +
        h(alternative.comparison_availability_reason) + "</span>" : "") +
      (alternative.profile_changed ? '<span class="cons-metric-note">Model profile differs from baseline</span>' : "") : "";
    return '<span class="cons-quantity">' + quantity + '</span><span class="cons-metric-note">' +
      h(coverage) + "</span>" + change;
  }
  function metricTable(pollutants, alternatives = []) {
    const rows = POLLUTANTS.map(([name, title]) => {
      const metric = pollutants?.[name];
      return "<tr><th scope=\"row\">" + h(title) + "</th><td>" +
        metricCell(metric, "", false) + "</td>" + alternatives.map(id => {
          const value = metric?.alternatives?.[id];
          if (!value) return '<td class="cons-muted">Unavailable</td>';
          return "<td>" + number(value.value) + " " + h(metric.unit || "") +
            '<span class="cons-metric-note">Δ ' + (finite(value.delta) && value.delta > 0 ? "+" : "") +
            number(value.delta) + " · reduction " + number(value.reduction) +
            "</span><span class=\"cons-metric-note\">" +
            "Alternative support " + (finite(value.coverage_fraction) ? percent(value.coverage_fraction) : "unavailable") +
            " · shared support " + (finite(value.common_coverage_fraction) ?
              percent(value.common_coverage_fraction) : "unavailable") + "</span>" +
            (value.reason || value.availability_reason ? '<span class="cons-metric-note">' +
              h(value.reason || value.availability_reason) + "</span>" : "") +
            (value.comparison_availability_reason ? '<span class="cons-metric-note">' +
              h(value.comparison_availability_reason) + "</span>" : "") +
            (value.profile_changed ? '<span class="cons-metric-note">Model profile differs from baseline</span>' : "") + "</td>";
        }).join("") + "</tr>";
    }).join("");
    return '<div class="cons-table-wrap"><table class="cons-table"><thead><tr><th>Pollutant</th><th>Baseline</th>' +
      alternatives.map(id => "<th>Alternative " + h(id) + "</th>").join("") +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";
  }
  function nativeExecution(study) {
    const entries = Object.entries(study?.native_execution || {});
    if (!entries.length) return "";
    const spec = study.spec || {}, basis = {
      completed_stage_runtime: "Recorded on the completed model stage",
      observed_run_fallback: "Observed run runtime; stage version not recorded",
      observed_runtime: "Observed run runtime",
      requested_legacy: "Requested version retained by a legacy record",
      unavailable: "No version recorded",
    };
    const version = value => h(value || "Not recorded");
    return '<details class="cons-disclosure"><summary>Native execution versions</summary>' +
      '<p class="cons-help">Each model keeps the execution version used to interpret its outputs. ' +
      'A completed stage takes precedence over the observed run runtime; a requested-only legacy record is labelled explicitly.</p>' +
      entries.map(([id, execution]) => {
        const role = id === spec.baseline_run_id ? "Baseline" :
          (spec.alternative_run_ids || []).includes(id) ? "Alternative" : "Retained run";
        const models = Object.entries(execution.model_versions || {});
        const support = execution.supported === true ? "Supported by this quantity adapter" :
          execution.supported === false ? "Outside this quantity adapter's supported version" :
          "Adapter compatibility not recorded";
        const rows = models.map(([model, value]) => '<tr><th scope="row">' + h(model.toUpperCase()) +
          "</th><td>" + version(value.comparison_version) + "</td><td>" +
          h(basis[value.basis] || value.basis || "No version recorded") + "</td><td>" +
          version(value.requested_version) + "</td><td>" + version(value.observed_run_version) +
          "</td><td>" + h(value.stage_completed_at || "Not recorded") + "</td><td>" +
          (value.reused_from ? '<details><summary>Original reused stage</summary><pre>' +
            h(JSON.stringify(value.reused_from, null, 2)) + "</pre></details>" : "No reuse recorded") +
          "</td></tr>").join("");
        return '<section aria-label="' + h(role + " native execution") + '"><div class="cons-section-title"><h4>' +
          h(role) + " · " + h(id) + '</h4><button type="button" data-action="item" data-kind="runs" data-id="' +
          h(id) + '">Open original run</button></div><p>' +
          "Quantity adapter " + version(execution.unit_contract_version) + " · " + h(support) +
          '</p><div class="cons-table-wrap"><table class="cons-table"><caption>Retained execution source for each selected model</caption>' +
          "<thead><tr><th>Model</th><th>Version used for quantities</th><th>Recorded basis</th>" +
          "<th>Requested version</th><th>Observed run version</th><th>Stage completed</th><th>Stage source</th></tr></thead>" +
          "<tbody>" + (rows || '<tr><td colspan="7">Per-model execution was not recorded.</td></tr>') +
          "</tbody></table></div>" +
          (execution.runtime_history?.length ? '<details><summary>Original run runtime history</summary><pre>' +
            h(JSON.stringify(execution.runtime_history, null, 2)) + "</pre></details>" : "") + "</section>";
      }).join("") + "</details>";
  }

  function studyLineage(study) {
    const spec = study?.spec || {};
    return '<details class="cons-disclosure"><summary>Sources and saved choices</summary><dl class="cons-definitions">' +
      "<dt>Planning units</dt><dd>" + lineForSource(spec.parcels) + "</dd>" +
      (spec.reporting_area ? "<dt>Reporting area</dt><dd>" + lineForSource(spec.reporting_area) + "</dd>" : "") +
      "<dt>Analysis</dt><dd>" + h(human(study.mode || spec.mode || "")) +
      (spec.analysis_crs ? " · " + h(spec.analysis_crs) : "") + "</dd>" +
      "<dt>Planning purpose</dt><dd>" + h(human(spec.purpose || "screening")) + "</dd>" +
      (spec.baseline_run_id ? "<dt>Baseline run</dt><dd>" + h(spec.baseline_run_id) + "</dd>" : "") +
      ((spec.alternative_run_ids || []).length ? "<dt>Alternative runs</dt><dd>" +
        spec.alternative_run_ids.map(h).join(", ") + "</dd>" : "") +
      Object.entries(spec.contexts || {}).map(([name, ref]) =>
        "<dt>" + h(name === "drinking_water" ? "Water-context geography" : human(name)) + "</dt><dd>" + lineForSource(ref) +
        (ref.meaning ? "<br>" + h(ref.meaning) : "") +
        (ref.relation ? "<br>" + h(ref.relation) : "") +
        (finite(ref.buffer_m) ? "<br>Declared buffer: " + number(ref.buffer_m) + " m" : "") + "</dd>").join("") +
      (spec.score?.basis === "published_method" ? "<dt>Published practice</dt><dd>" +
        h(human(spec.score.category_id)) + " · " + h(spec.score.method_id) + "</dd>" +
        (spec.score.metrics ? "<dt>Parcel criteria</dt><dd>" + lineForSource(spec.score.metrics) + "</dd>" : "") +
        "<dt>Study interpretation</dt><dd>" + h(spec.score.interpretation || "") + "</dd>" : "") +
      (spec.costs ? "<dt>Cost table</dt><dd>" + lineForSource(spec.costs) + " · " + h(spec.costs.currency) + "</dd>" : "") +
      "</dl><details><summary>Complete retained specification</summary><pre>" +
      h(JSON.stringify(spec, null, 2)) + "</pre></details></details>";
  }
  function candidateDetail(candidate) {
    const ui = memory();
    return '<section class="cons-detail" aria-label="Planning unit details"><div class="cons-section-title"><h3>' +
      h(candidate.label || candidate.id) + "</h3>" + button("close-detail", "Close details") +
      '</div><dl class="cons-definitions"><dt>Source unit ID</dt><dd>' + h(candidate.id) +
      "</dd><dt>Full unit area</dt><dd>" + number(candidate.area_ha) + " ha</dd>" +
      "<dt>Within reporting area</dt><dd>" + number(candidate.reporting_area_ha) + " ha</dd>" +
      "<dt>Protected share</dt><dd>" + h(percent(candidate.protected_fraction)) + "</dd>" +
      "<dt>Mapped water-context share</dt><dd>" + h(percent(candidate.source_water_fraction)) +
      '<span class="cons-metric-note">' + h(waterContextMeaning()) + "</span></dd>" +
      "<dt>High-quality-water context</dt><dd>" +
      (candidate.high_quality_context === null || candidate.high_quality_context === undefined ? "Unmapped" :
        candidate.high_quality_context ? "Present" : "Absent in selected context") +
      "</dd><dt>Recorded cost</dt><dd>" + (finite(candidate.cost) ? number(candidate.cost) + " " +
        h(candidate.currency || "") : "No matching cost") + "</dd>" +
      "<dt>Priority</dt><dd>" + pointScore(candidate) + "</dd>" +
      "<dt>Eligibility</dt><dd>" + (candidate.eligible ? "Eligible" :
        (candidate.exclusion_reasons || []).map(reason => h(human(reason))).join("; ") || "Excluded") +
      "</dd></dl>" + pointCriteria(candidate) + metricTable(candidate.pollutants, ui.study?.spec?.alternative_run_ids || []) +
      '<details><summary>Priority components</summary><pre>' +
      h(JSON.stringify(candidate.score_components || {}, null, 2)) + "</pre></details>" +
      '<details><summary>Original source attributes</summary><div class="cons-table-wrap"><table class="cons-table"><tbody>' +
      Object.entries(candidate.original_attributes || {}).map(([name, value]) =>
        "<tr><th scope=\"row\">" + h(name) + "</th><td>" +
        h(typeof value === "object" && value !== null ? JSON.stringify(value) : value) + "</td></tr>").join("") +
      "</tbody></table></div></details></section>";
  }
  function catalogFilterFields() {
    const ui = memory(), metric = ui.metricFilter;
    const bounds = [
      ["rank", "Retained rank"], ["score", "Saved score"],
      ["area_ha", "Full unit area (ha)"], ["reporting_area_ha", "Reporting area (ha)"],
      ["cost", "Recorded cost"], ["protected_fraction", "Protected share (%)"],
      ["source_water_fraction", "Water-context share (%)"],
    ];
    const fields = bounds.map(([name, title]) => '<fieldset class="cons-filter-range"><legend>' + h(title) +
      '</legend><div class="cons-grid">' + ["min", "max"].map(bound =>
        '<label>' + (bound === "min" ? "Minimum" : "Maximum") +
        '<input type="number" step="any" data-catalog-range="' + name + "_" + bound +
        '" value="' + h(ui.ranges[name + "_" + bound]) + '"></label>').join("") + "</div></fieldset>").join("");
    const control = (name, label, rows) => '<label>' + h(label) +
      '<select data-catalog-metric="' + name + '">' +
      rows.map(([value, title]) => option(value, title, metric[name])).join("") + "</select></label>";
    const cases = [["baseline", "Original baseline"], ...(ui.study?.spec?.alternative_run_ids || [])
      .map(id => [id, "Alternative " + id])];
    return '<details class="cons-disclosure"><summary>Area, priority, context and quantity filters</summary>' +
      '<p class="cons-help">Filters apply together to the full original inventory. Missing values remain missing. ' +
      "Quantity bounds use the retained metric's stated units; coverage bounds use percentages.</p>" +
      '<div class="cons-grid">' + fields + '</div><fieldset><legend>Native quantity</legend><div class="cons-grid">' +
      control("pollutant", "Pollutant", [["", "No quantity filter"], ...POLLUTANTS]) +
      control("case", "Native case", cases) +
      control("field", "Quantity or support", [["value", "Annual quantity"], ["coverage_fraction", "Own valid support (%)"],
        ["delta", "Alternative minus baseline"], ["reduction", "Baseline minus alternative"],
        ["common_coverage_fraction", "Shared native support (%)"]]) +
      control("availability", "Recorded availability", [["", "Any availability"], ["modeled", "Modeled"],
        ["not_selected", "Model not selected"], ["unbound", "Native run unbound"]]) +
      ["min", "max"].map(bound => '<label>' + (bound === "min" ? "Minimum" : "Maximum") +
        '<input type="number" step="any" data-catalog-metric="' + bound + '" value="' +
        h(metric[bound]) + '"></label>').join("") + '</div></fieldset><div class="cons-actions">' +
      button("apply-filters", "Apply filters", "", ui.catalogLoading) +
      button("clear-filters", "Clear numeric and quantity filters", "", ui.catalogLoading) + "</div></details>";
  }
  function candidateTable() {
    const ui = memory(), rows = pageRows(), shown = ui.catalogPage?.total || 0;
    const total = ui.catalogPage?.original_count ?? ui.catalogStatus?.original_count;
    if (ui.study?.state !== "complete") return "";
    if (!ui.catalogStatus) return '<p role="status">Opening the original candidate catalog…</p>';
    if (ui.catalogStatus.state !== "complete") return '<section class="cons-editor"><h3>Candidate search</h3>' +
      '<p>Prepare the retained inventory for paging, source-bound selection and complete filtered exports.</p>' +
      button("catalog-prepare", "Prepare candidate search", "", ui.busy) + "</section>";
    const pages = Math.max(1, Math.ceil(shown / ui.pageSize));
    const alternateIds = ui.study?.spec?.alternative_run_ids || [];
    const body = rows.map(candidate => {
      const id = String(candidate.id), selected = checked(candidate, ui);
      return "<tr" + (selected ? ' class="cons-selected"' : "") + "><td>" +
        '<input type="checkbox" data-candidate-id="' + h(id) + '" aria-label="Select ' +
        h(candidate.label || id) + '"' + (selected ? " checked" : "") + (ui.catalogLoading ? " disabled" : "") + "></td>" +
        '<th scope="row">' + button("candidate", candidate.label || id, 'data-candidate="' + h(id) +
          '" class="cons-text-button"') +
        '<span class="cons-metric-note">' + h(id) + "</span></th>" +
        "<td>" + number(candidate.reporting_area_ha) + "</td><td>" + pointScore(candidate) + "</td>" +
        POLLUTANTS.map(([name]) => "<td>" + metricCell(candidate.pollutants?.[name],
          ui.displayAlternative || "") + "</td>").join("") +
        "<td>" + h(percent(candidate.protected_fraction)) + "</td><td>" +
        h(percent(candidate.source_water_fraction)) + "</td><td>" +
        (candidate.high_quality_context === null || candidate.high_quality_context === undefined ? "Unmapped" :
          candidate.high_quality_context ? "Present" : "Absent") + "</td>" +
        "<td>" + (candidate.eligible ? "Eligible" : '<span class="cons-excluded">Excluded</span>' +
          '<span class="cons-metric-note">' +
          h((candidate.exclusion_reasons || []).map(human).join("; ")) + "</span>") + "</td>" +
        "<td>" + (finite(candidate.cost) ? number(candidate.cost) + " " + h(candidate.currency || "") :
          '<span class="cons-muted">Unmatched</span>') + "</td></tr>";
    }).join("");
    return '<div class="cons-toolbar"><label>Find units<input type="search" data-filter="search" value="' +
      h(ui.search) + '" placeholder="ID, name or original attribute"></label>' +
      '<label>Show<select data-filter="eligibility">' +
      [["all", "All units"], ["eligible", "Eligible"], ["excluded", "Excluded"], ["selected", "Checked"]]
        .map(([value, label]) => option(value, label, ui.eligibility)).join("") + "</select></label>" +
      '<label>Sort by<select data-filter="sort">' +
      [["rank", "Retained rank"], ["score", "Saved score"], ["area", "Reporting area"], ["area_ha", "Full source unit area"], ["id", "Identifier"], ["label", "Name"], ["cost", "Recorded cost"], ["protected_fraction", "Protected share"], ["source_water_fraction", "Water-context share"], ...POLLUTANTS]
        .map(([value, label]) => option(value, label, ui.sort)).join("") + "</select></label>" +
      '<label>Order<select data-filter="direction">' + [["desc", "Descending"], ["asc", "Ascending"]]
        .map(([value, label]) => option(value, label, ui.direction)).join("") + "</select></label>" +
      (alternateIds.length ? '<label>Quantity comparison<select data-filter="displayAlternative">' +
        option("", "Baseline only", ui.displayAlternative) +
        alternateIds.map(id => option(id, "Alternative " + id, ui.displayAlternative)).join("") + "</select></label>" : "") +
      "</div>" + catalogFilterFields() + '<div class="cons-toolbar">' +
      button("select-matching", "Retain all eligible matches", "", ui.busy || ui.catalogLoading || !shown || ui.eligibility === "excluded" || (ui.eligibility === "selected" && !!ui.retainedSelection)) +
      button("export-matching", "Export all matching rows", "", ui.busy || ui.catalogLoading) +
      button("select-page", "Check eligible units on this page", "", ui.busy || ui.catalogLoading || !rows.length) +
      button("clear-selection", "Clear checked units", "", !checkedCount(ui)) +
      '<span class="cons-selection-count" aria-live="polite">' + checkedCount(ui) + " checked · " +
      shown + " matching · " + (total ?? "Opening") + " total units</span></div>" +
      (ui.retainedSelection ? '<p class="cons-help">Complete retained cohort: ' + h(ui.retainedSelection.selection_id) +
        ". Filtering or paging preserves your checked selection. Page changes can add or remove units from this cohort.</p>" : "") +
      (ui.catalogLoading ? '<p role="status">Loading the selected candidate page…</p>' : "") +
      '<div class="cons-table-wrap" tabindex="0" role="region" aria-label="Candidate inventory">' +
      '<table class="cons-table cons-candidates"><caption>Retained candidate inventory · ' +
      h(ui.study?.spec?.planning_unit_label || "Planning unit") +
      '</caption><thead><tr><th scope="col">Select</th><th scope="col">Unit</th><th scope="col">Area (ha)</th>' +
      '<th scope="col">Score</th>' + POLLUTANTS.map(([, title]) => '<th scope="col">' + h(title) + "</th>").join("") +
      '<th scope="col">Protected</th><th scope="col">Water context<span class="cons-metric-note">' +
      h(waterContextMeaning()) + '</span></th><th scope="col">High-quality context</th>' +
      '<th scope="col">Eligibility</th><th scope="col">Recorded cost</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="12">No planning units match these filters.</td></tr>') +
      "</tbody></table></div><div class=\"cons-toolbar cons-pagination\">" +
      button("previous-page", "Previous page", "", ui.catalogLoading || ui.page <= 1) +
      '<span>Page ' + ui.page + " of " + pages + "</span>" +
      button("next-page", "Next page", "", ui.catalogLoading || ui.page >= pages) +
      '<label>Rows per page<select data-filter="pageSize">' +
      [25, 50, 100].map(size => option(size, size, ui.pageSize)).join("") +
      "</select></label></div>";
  }
  function portfolioView(plan) {
    const summary = plan.summary || {}, study = memory().study, optimization = plan.selection?.optimization;
    return '<section class="cons-detail" aria-label="Saved portfolio"><div class="cons-section-title"><div>' +
      "<h2>" + h(plan.title || plan.id) + '</h2><p class="cons-metric-note">Saved portfolio ' +
      h(plan.id) + "</p></div>" +
      button(optimization ? "optimization-export" : "export-plan", "Export this saved portfolio", 'data-plan-id="' + h(plan.id) +
        '" data-study-id="' + h(plan.study_id) + '"', memory().busy) + "</div>" +
      '<div class="cons-summary"><div><span>Selected units</span><strong>' +
      h(summary.parcels ?? (plan.selected_ids || []).length) + "</strong></div>" +
      "<div><span>Full selected footprint</span><strong>" + number(summary.whole_unit_union_area_ha) + " ha</strong></div>" +
      "<div><span>Reporting footprint</span><strong>" + number(summary.union_area_ha) + " ha</strong></div>" +
      "<div><span>Reporting overlap removed</span><strong>" + number(summary.overlap_area_ha) + " ha</strong></div>" +
      "<div><span>Recorded cost</span><strong>" + (finite(summary.cost_total) ?
        number(summary.cost_total) + " " + h(summary.currency || "") : "Unavailable") + "</strong></div></div>" +
      '<dl class="cons-definitions"><dt>Mapped water-context overlap</dt><dd>' + number(summary.source_water_area_ha) +
      ' ha<span class="cons-metric-note">' + h(waterContextMeaning(study)) +
      "</span></dd><dt>Protected overlap</dt><dd>" + number(summary.protected_area_ha) + " ha</dd>" +
      "<dt>Selection method</dt><dd>" + h(human(plan.selection?.algorithm || plan.selection?.mode ||
        plan.algorithm || plan.mode || "Recorded selection")) + "</dd>" +
      "<dt>Area limit basis</dt><dd>" + (plan.selection?.limits?.area_basis === "reporting" ?
        "Within reporting area" : "Full selected source units") + "</dd>" +
      (!finite(summary.cost_total) ? "<dt>Known cost subtotal</dt><dd>" +
        number(summary.known_cost_subtotal) + " " + h(summary.currency || "") +
        "</dd><dt>Units without recorded cost</dt><dd>" + h(summary.units_without_cost ?? "Unavailable") +
        "</dd>" : "") + "</dl>" +
      metricTable(summary.pollutants, study?.spec?.alternative_run_ids || []) +
      '<details class="cons-disclosure"><summary>Selected unit IDs (' + (plan.selected_ids || []).length +
      ")</summary><p class=\"cons-id-list\">" + (plan.selected_ids || []).map(h).join(", ") + "</p></details>" +
      ((plan.skipped || []).length ? '<details class="cons-disclosure"><summary>Skipped units (' +
        plan.skipped.length + ')</summary><div class="cons-table-wrap"><table class="cons-table"><thead><tr>' +
        "<th>Unit</th><th>Reasons</th></tr></thead><tbody>" +
        plan.skipped.map(item => "<tr><td>" + h(item.id) + "</td><td>" +
          h((item.reasons || []).map(human).join("; ")) + "</td></tr>").join("") +
        "</tbody></table></div></details>" : "") +
      (optimization?.analysis_id ? '<div class="cons-actions">' + button("optimization-open-analysis",
        "Reopen portfolio decision", 'data-study-id="' + h(plan.study_id) + '" data-analysis-id="' +
        h(optimization.analysis_id) + '"') + '</div>' : "") +
      '<div class="cons-actions">' + button("new-scenario", "Create land-cover scenario", "", memory().busy) +
      button("edit-selection", "Use these units in a new portfolio",
        'data-plan-id="' + h(plan.id) + '"') + "</div></section>";
  }
  function experimentButton(id, label = "Open paired experiment") {
    return id ? '<button type="button" data-action="experiment-show" data-id="' + h(id) + '">' + h(label) + '</button>' : "";
  }
  function scenarioBridgesView(studyId = null) {
    const ui = memory();
    const bridges = (ui.overview?.scenario_bridges || []).filter(row => !studyId || row.study_id === studyId);
    if (!bridges.length) return "";
    return '<section class="cons-scenario-bridges"><h2>Saved conservation scenarios</h2>' +
      '<div class="cons-table-wrap"><table class="cons-table"><thead><tr><th>Selected footprint</th>' +
      '<th>Native models</th><th>Paired experiments</th><th>Open</th></tr></thead><tbody>' +
      bridges.map(row => {
        const experiments = row.experiments || [];
        const models = row.models || row.prepare_run?.models || (row.prepare_run ? ["ndr", "sdr"] : []);
        const actions = (row.scenario_id ? '<button type="button" data-action="item" data-kind="scenarios" data-id="' +
          h(row.scenario_id) + '">Land-cover scenario</button>' : "") +
          (row.run_id ? '<button type="button" data-action="item" data-kind="runs" data-id="' +
            h(row.run_id) + '">Native run</button>' : "") +
          (row.plan_id ? button("open-plan", "Source portfolio", 'data-plan-id="' + h(row.plan_id) + '"') : "") +
          (row.state === "complete" ? button("new-experiment", experiments.length ? "Prepare another experiment" : "Prepare paired experiment",
            'data-bridge-id="' + h(row.id) + '"', ui.busy) : "");
        return '<tr><th scope="row">' + h(row.title || row.id) + '<span class="cons-metric-note">' +
          h(row.id) + '</span></th><td>' + h(models.length ? models.map(model => model.toUpperCase()).join(" + ") :
            "Choose a grid and profile from the portfolio") + '</td><td>' +
          (experiments.length ? experiments.map(item => '<div class="cons-saved-experiment">' +
            experimentButton(item.experiment_id, item.title || "Open paired experiment") +
            '<span class="cons-metric-note">' + h(human(item.state || item.preparation_state || "prepared")) +
            (finite(item.progress?.complete) ? " · " + number(item.progress.complete) + " completed cases" : "") +
            '</span></div>').join("") : "No experiment prepared") +
          '</td><td><div class="cons-actions">' + actions + '</div></td></tr>';
      }).join("") + '</tbody></table></div></section>';
  }

  function sourceAcquisitionForm() {
    const ui = memory(), d = ui.acquisition;
    const studies = [...new Map([...(ui.overview?.studies || []), ...(ui.study ? [ui.study] : [])]
      .map(row => [row.id, row])).values()];
    return '<form class="cons-editor" data-cons-form="sources"><div class="cons-section-title">' +
      '<div><h2>Acquire soil and floodplain sources</h2><p>Use the original study extent to import ' +
      'soil map units, their hydric classifications and the mapped annual 1% floodplain.</p></div>' +
      button("close-form", "Close", "", ui.busy) + '</div><div class="cons-grid">' +
      select("acquisition.study_id", "Original study extent", d.study_id,
        [["", "Choose a retained study"], ...studies.map(row =>
          [row.id, row.title || row.spec?.title || row.id])]) +
      '<fieldset class="cons-fieldset"><legend>Source families</legend>' +
      check("acquisition.soils", "Soil map units and hydric classifications", d.soils) +
      check("acquisition.floodplains", "Annual 1% floodplain", d.floodplains) + '</fieldset>' +
      (d.soils ? select("acquisition.hydric_selection", "Hydric map-unit interpretation", d.hydric_selection, [
        ["full", "Fully hydric map units"], ["predominant", "Predominantly hydric map units (at least 66%)"],
        ["any_component", "Any hydric component"]]) : "") +
      '</div><p class="cons-metric-note">Selected footprints and the area with a known classification ' +
      'remain separate. Coverage records show where a parcel criterion can be resolved.</p>' +
      '<details><summary>Use original layers already imported into this workspace</summary>' +
      '<div class="cons-grid">' +
      (d.soils ? sourceSelect("acquisition.soil_source", "Original soil map-unit source", d.soil_source, true) +
        input("acquisition.soil_layer", "Soil layer, if the source contains several layers", d.soil_layer) +
        input("acquisition.mukey_field", "Original map-unit key field", d.mukey_field) : "") +
      (d.floodplains ? sourceSelect("acquisition.floodplain_source", "Original flood hazard source", d.floodplain_source, true) +
        input("acquisition.floodplain_layer", "Flood hazard layer, if needed", d.floodplain_layer) : "") +
      '</div></details><div class="cons-actions">' +
      button("acquire-sources", "Acquire original sources", "", ui.busy || !d.study_id) +
      '</div></form>';
  }

  function buildSourceCaptureSpec() {
    const ui = memory(), d = ui.acquisition;
    const study = [...(ui.overview?.studies || []), ...(ui.study ? [ui.study] : [])]
      .find(row => row.id === d.study_id);
    if (!study) throw new Error("Choose an original study retained in this workspace.");
    const families = [];
    if (d.soils) families.push("soils");
    if (d.floodplains) families.push("floodplains");
    if (!families.length) throw new Error("Choose at least one source family.");
    if (!["full", "predominant", "any_component"].includes(d.hydric_selection)) {
      throw new Error("Choose the hydric map-unit interpretation.");
    }
    const spec = { schema: "upstate.soil-floodplain-selection/v1", study_id: study.id, families };
    if (d.soils) {
      spec.soils = { hydric_selection: d.hydric_selection };
      if (d.soil_source) {
        spec.soils.reuse_source = sourceRef(d.soil_source, d.soil_layer, "original soil map unit");
        if (!d.mukey_field.trim()) throw new Error("Name the original map-unit key field.");
        spec.soils.mukey_field = d.mukey_field.trim();
      }
    }
    if (d.floodplains && d.floodplain_source) {
      spec.floodplains = { reuse_source:
        sourceRef(d.floodplain_source, d.floodplain_layer, "original flood hazard") };
    }
    return spec;
  }

  function sourceCaptureId(value) {
    return value?.operation_id || value?.id || "";
  }

  function sourceFamilies(value) {
    const raw = value?.families || {};
    return Array.isArray(raw) ? raw.map(row => typeof row === "string" ? [row, {}] : [row.family || row.name, row]) :
      Object.entries(raw);
  }

  function sourceFamilyTable(value) {
    const rows = sourceFamilies(value);
    if (!rows.length) return "";
    return '<div class="cons-table-wrap"><table class="cons-table"><thead><tr><th>Original source family</th>' +
      '<th>State</th><th>Recorded source counts</th><th>Acquisition detail</th></tr></thead><tbody>' +
      rows.map(([name, row]) => {
        if (!row || typeof row !== "object") row = { state: row };
        const counts = Object.entries(row.counts || {}).filter(([,count]) => finite(count))
          .map(([label,count]) => h(human(label)) + ": " + number(count)).join("<br>");
        const error = row.error || row.last_error;
        const detail = error ? (typeof error === "string" ? error : error.message || error.type || "") :
          row.message || row.progress?.stage || "";
        return '<tr><th scope="row">' + h(name === "soils" ? "Soil map units and hydric classifications" :
          name === "floodplains" ? "Annual 1% floodplain" : human(name)) + '</th><td>' +
          h(human(row.state || row.status || "prepared")) + '</td><td>' + (counts || "—") +
          '</td><td>' + h(detail) + '</td></tr>';
      }).join("") + '</tbody></table></div>';
  }

  function sourceSuccessors(row) {
    const id = sourceCaptureId(row);
    return (Array.isArray(row?.continued_as) ? row.continued_as : [])
      .filter(item => sourceCaptureId(item) && sourceCaptureId(item) !== id)
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")) ||
        sourceCaptureId(a).localeCompare(sourceCaptureId(b)));
  }

  function sourceContinuationView(row) {
    const prior = row.continuation, successors = sourceSuccessors(row);
    if (!prior && !successors.length && !row.implementation_changed) return "";
    let html = '<section class="cons-source-continuation"><h3>Acquisition history</h3>';
    if (prior?.previous_operation_id) {
      html += '<p>This acquisition continues the original study extent, source choices and provider requests ' +
        'from an earlier saved acquisition.</p><div class="cons-actions">' +
        button("open-source-capture", "Open previous acquisition",
          'data-operation-id="' + h(prior.previous_operation_id) + '"', memory().busy) + '</div>';
      if (finite(prior.reused_requests)) {
        html += '<p>' + number(prior.reused_requests) + ' retained provider responses reused' +
          (finite(prior.reused_bytes) ? ' · ' + number(prior.reused_bytes) + ' bytes' : '') +
          '. Coverage and parcel-source classifications are recalculated by the current application.</p>';
        if (finite(prior.successful_responses) || finite(prior.retained_failures)) {
          html += '<p class="cons-metric-note">' +
            (finite(prior.successful_responses) ? number(prior.successful_responses) + ' successful responses' : '') +
            (finite(prior.successful_responses) && finite(prior.retained_failures) ? ' · ' : '') +
            (finite(prior.retained_failures) ? number(prior.retained_failures) + ' retained failed attempts' : '') +
            '</p>';
        }
      }
    }
    if (row.implementation_changed) {
      html += '<p>A newer version of the source-processing application is installed. ' +
        'Continue from the saved requests to create an updated acquisition.</p>';
    }
    if (successors.length) {
      html += '<div class="cons-table-wrap"><table class="cons-table"><thead><tr>' +
        '<th>Continued acquisition</th><th>State</th><th>Open</th></tr></thead><tbody>' +
        successors.map(item => '<tr><th scope="row">' + h(item.title || sourceCaptureId(item)) +
          '</th><td>' + h(human(item.state || "prepared")) + '</td><td>' +
          button("open-source-capture", "Open continued acquisition",
            'data-operation-id="' + h(sourceCaptureId(item)) + '"', memory().busy) +
          '</td></tr>').join("") + '</tbody></table></div>';
    }
    return html + '</section>';
  }

  function sourceCaptureButtons(row) {
    const id = sourceCaptureId(row);
    if (!id) return "";
    let result = button("open-source-capture", "Open sources and coverage",
      'data-operation-id="' + h(id) + '"', memory().busy);
    if (row.parcel_criteria_selection || row.criteria_ready) {
      result += button("criteria-from-sources", "Prepare parcel criteria",
        'data-operation-id="' + h(id) + '"', memory().busy);
    }
    const current = memory().overview?.source_acquisitions?.find(item => sourceCaptureId(item) === id);
    if (current) row = { ...row, ...current };
    const continued = sourceSuccessors(row)[0];
    if (continued) {
      result += button("open-source-capture", "Open continued acquisition",
        'data-operation-id="' + h(sourceCaptureId(continued)) + '"', memory().busy);
    } else if (row.state !== "complete" || row.implementation_changed) {
      result += button("resume-sources", row.implementation_changed ?
        "Continue with current application" : "Continue acquisition",
        'data-operation-id="' + h(id) + '"', memory().busy);
    }
    return result;
  }

  function sourceAcquisitionsView() {
    const ui = memory(), rows = ui.overview?.source_acquisitions || [];
    if (!rows.length) return "";
    return '<section class="cons-source-acquisitions"><h2>Original soil and floodplain acquisitions</h2>' +
      '<div class="cons-table-wrap"><table class="cons-table"><thead><tr><th>Study extent</th>' +
      '<th>State</th><th>Current stage</th><th>Continue</th></tr></thead><tbody>' +
      rows.map(row => '<tr><th scope="row">' + h(row.title || row.study_title || row.study_id || sourceCaptureId(row)) +
        '</th><td>' + h(human(row.state || "prepared")) + '</td><td>' +
        h(human(row.progress?.stage || "")) +
        (row.continuation?.previous_operation_id ?
          '<span class="cons-metric-note">Continues a saved acquisition</span>' :
          row.implementation_changed ? '<span class="cons-metric-note">Application updated</span>' : "") +
        (finite(row.progress?.completed) ? '<span class="cons-metric-note">' + number(row.progress.completed) +
          (finite(row.progress?.total) ? " / " + number(row.progress.total) : "") + '</span>' : "") +
        '</td><td><div class="cons-actions">' + sourceCaptureButtons(row) + '</div></td></tr>').join("") +
      '</tbody></table></div></section>';
  }

  function sourceCoverageFacts(value) {
    const rows = [];
    function visit(item, label, depth) {
      if (item === null || item === undefined || depth > 3) return;
      if (["number", "string", "boolean"].includes(typeof item)) {
        if (typeof item === "string" && item.length > 700) return;
        rows.push([label, typeof item === "number" ? number(item) :
          typeof item === "boolean" ? (item ? "Yes" : "No") : item]);
      } else if (Array.isArray(item)) {
        if (item.length > 12) rows.push([label + " · records", number(item.length)]);
        else for (const [index, child] of item.entries()) visit(child, label + " " + (index + 1), depth + 1);
      } else if (typeof item === "object") {
        for (const [key, child] of Object.entries(item)) {
          if (["sha256", "path", "source_collection_id", "source_id", "operation_id"].includes(key)) continue;
          visit(child, (label ? label + " · " : "") + human(key), depth + 1);
        }
      }
    }
    visit(value, "", 0);
    return rows.length ? '<dl class="cons-definitions">' + rows.map(([label,value]) =>
      '<dt>' + h(label) + '</dt><dd>' + h(value) + '</dd>').join("") + '</dl>' : "";
  }

  function sourceCaptureView() {
    const ui = memory(), row = ui.sourceCapture;
    if (!row) return "";
    const id = sourceCaptureId(row), error = row.error || row.last_error;
    return '<section class="cons-detail cons-source-capture"><div class="cons-section-title"><div>' +
      '<h2>Original soils and floodplain coverage</h2><p>' + h(row.title || row.study_title || row.study_id || id) +
      ' · ' + h(human(row.state || "prepared")) + '</p></div>' +
      button("close-form", "Close", "", ui.busy) + '</div>' +
      (error ? '<div class="cons-notice cons-error" role="alert">' +
        h(typeof error === "string" ? error : error.message || error.type || "") + '</div>' : "") +
      sourceContinuationView(row) +
      sourceFamilyTable(row) +
      (row.coverage ? '<h3>Source coverage and interpretation</h3>' + sourceCoverageFacts(row.coverage) : "") +
      (row.counts ? '<h3>Retained source quantities</h3>' + sourceCoverageFacts(row.counts) : "") +
      '<p class="cons-metric-note">Parcel criteria use the retained selected footprints and known-classification ' +
      'coverage. Areas outside that coverage retain an unknown criterion when presence cannot be established.</p>' +
      select("acquisition.criterion_geometry", "Source criterion geometry", ui.acquisition.criterion_geometry || "whole_original_parcel",
        [["whole_original_parcel", "Whole original parcel · published method"],
         ["reporting_parcel", "Reporting intersection · regional adaptation"]]) +
      '<div class="cons-actions">' + sourceCaptureButtons(row) + '</div>' +
      (row._downloads?.length && fileList ? fileList(row._downloads) : "") + '</section>';
  }

  function criteriaOperationsView() {
    const ui = memory(), operations = ui.overview?.criteria_operations || [];
    if (!operations.length) return "";
    return '<section class="cons-criteria-operations"><h2>Parcel criterion preparations</h2>' +
      '<div class="cons-table-wrap"><table class="cons-table"><thead><tr><th>Original parcel study</th>' +
      '<th>State</th><th>Parcels</th><th>Continue</th></tr></thead><tbody>' +
      operations.map(row => {
        const use = row.state === "complete" && row.source_collection_id && row.source_id;
        const action = use ? button("use-criteria", "Use prepared criteria",
          'data-source-collection="' + h(row.source_collection_id) + '" data-source-id="' + h(row.source_id) +
          '" data-study-id="' + h(row.study_id) + '" data-table-format="json" data-id-column="id"', ui.busy) :
          button("resume-criteria", "Resume preparation", 'data-operation-id="' + h(row.id) + '"', ui.busy);
        return '<tr><th scope="row">' + h(row.title || row.id) + '<span class="cons-metric-note">' +
          h(row.study_id || "") + '</span></th><td>' + h(human(row.state || "prepared")) +
          '</td><td>' + (finite(row.progress?.completed) ? number(row.progress.completed) : "—") +
          (finite(row.progress?.total) ? " / " + number(row.progress.total) : "") +
          '</td><td>' + action + '</td></tr>';
      }).join("") + '</tbody></table></div></section>';
  }

  function overviewView() {
    const ui = memory(), overview = ui.overview || {};
    const studies = Array.isArray(overview.studies) ? overview.studies : [];
    const plans = Array.isArray(overview.plans) ? overview.plans : [];
    return '<section class="cons-overview">' + sourceAcquisitionsView() + criteriaOperationsView() + "<h2>Retained studies</h2>" +
      (studies.length ? '<div class="cons-table-wrap"><table class="cons-table"><thead><tr><th>Study</th>' +
        "<th>Mode</th><th>State</th><th>Open</th></tr></thead><tbody>" +
        studies.map(study => "<tr><th scope=\"row\">" + h(study.title || study.spec?.title || study.id) +
          '<span class="cons-metric-note">' + h(study.id) + "</span></th><td>" +
          h(human(study.mode || study.spec?.mode || "Recorded study")) + "</td><td>" +
          h(human(study.state || "")) + "</td><td>" +
          button("open-study", "Open", 'data-study-id="' + h(study.id) + '"', ui.busy) +
          "</td></tr>").join("") + "</tbody></table></div>" :
        "<p>" + (ui.overviewLoading ? "Loading retained studies…" :
          "Create a study from the imported planning-unit and reporting-area sources.") + "</p>") +
      "<h2>Saved portfolios</h2>" +
      (plans.length ? '<div class="cons-table-wrap"><table class="cons-table"><thead><tr><th>Portfolio</th>' +
        "<th>Source study</th><th>Open</th></tr></thead><tbody>" +
        plans.map(plan => "<tr><th scope=\"row\">" + h(plan.title || plan.id) +
          '<span class="cons-metric-note">' + h(plan.id) + "</span></th><td>" +
          h(plan.study_id || "") + "</td><td>" +
          button("open-plan", "Open", 'data-plan-id="' + h(plan.id) + '"', ui.busy) +
          "</td></tr>").join("") + "</tbody></table></div>" :
        "<p>Saved portfolios will appear here with their original study and selection.</p>") + scenarioBridgesView() + "</section>";
  }
  function content() {
    const ui = memory(), study = ui.study;
    const mode = study?.mode || study?.spec?.mode;
    const selected = ui.detailId && ui.detailRow;
    return '<header class="cons-header"><div><h1>Conservation planning</h1><p>' +
      "Use retained planning units, source context and native model quantities to build a reproducible portfolio." +
      '</p></div><div class="cons-actions">' +
      button("new-study", "New study", "", ui.busy) +
      button("new-source-capture", "Acquire source layers", "", ui.busy || !(ui.overview?.studies?.length || ui.study)) +
      button("refresh", "Refresh records", "", ui.overviewLoading || ui.busy) + "</div></header>" +
      (ui.notice ? '<div class="cons-notice' + (ui.notice.kind === "error" ? " cons-error" : "") +
        '" role="' + (ui.notice.kind === "error" ? "alert" : "status") + '">' +
        h(ui.notice.message) + "</div>" : "") +
      (ui.form === "study" ? studyForm() : "") +
      (ui.form === "sources" ? sourceAcquisitionForm() : "") +
      (ui.form === "source-result" ? sourceCaptureView() : "") +
      (ui.form === "scenario" && ui.scenario?.conservation_scenario_id ? scenarioForm() : "") +
      (study ? '<section class="cons-study"><div class="cons-section-title"><div><h2>' +
        h(study.title || study.spec?.title || study.id) + '</h2><p class="cons-metric-note">' +
        h(study.id) + " · " + h(human(study.state || "")) + "</p></div><div class=\"cons-actions\">" +
        button("new-source-capture", "Acquire soils and floodplains", 'data-study-id="' + h(study.id) + '"', ui.busy) +
        button("new-portfolio", "Create portfolio", "", ui.busy || study.state !== "complete") +
        button("optimization-new", "Optimize portfolio", "", ui.busy || study.state !== "complete") +
        button("export-study", "Export candidate inventory", 'data-study-id="' + h(study.id) + '"', ui.busy) +
        (study.state !== "complete" ? button("build-study", "Build this inventory",
          'data-study-id="' + h(study.id) + '"', ui.busy) : "") +
        button("close-study", "Back to all records", "", ui.busy) + "</div></div>" +
        '<p class="cons-mode">' + (mode === "source_context" ?
          "Source geometry and context: areas and mapped overlaps are available. A new study can bind a native baseline to add annual pollutant quantities." :
          "Native model quantities: pollutant units, valid coverage and alternative differences remain visible for each planning unit.") +
        "</p>" + (study.error ? '<div class="cons-notice cons-error" role="alert">' +
          h(typeof study.error === "string" ? study.error : study.error.message || JSON.stringify(study.error)) +
          "</div>" : "") + studyLineage(study) + nativeExecution(study) +
        (ui.plan ? portfolioView(ui.plan) : "") +
        (ui.form === "portfolio" ? portfolioForm() : "") +
        (ui.form === "optimization" ? optimizationForm() : "") +
        (ui.form === "optimization-result" ? optimizationResultView() : "") +
        (ui.form === "scenario" && !ui.scenario?.conservation_scenario_id ? scenarioForm() : "") +
        (ui.detailLoading ? '<p role="status">Opening the complete original candidate…</p>' : "") +
        (selected ? candidateDetail(selected) : "") +
        candidateTable() + scenarioBridgesView(study.id) + "</section>" : overviewView());
  }

  function scenarioDraft(bridge = null, originalBaseline = null) {
    const ui = memory(), baseline = originalBaseline || ((!bridge || bridge.study_id === ui.study?.id) ?
      runs().find(run => run.id === ui.study?.spec?.baseline_run_id) : null);
    const prepared = bridge?.prepare_run || baseline?.selection || {};
    const chosen = bridge?.models?.length ? bridge.models : prepared.models || (baseline ? runModels(baseline) : []);
    return { conservation_scenario_id: bridge?.id || "", title: bridge?.title || "",
      reason: "", from_codes: "", to_code: "",
      output: bridge || baseline ? "experiment" : "scenario",
      grid_id: prepared.grid_id || "", profile_id: prepared.profile_id || "",
      models: chosen.join(","), models_explicit: chosen.length > 0, for_plan_id: bridge?.plan_id || ui.plan?.id || "",
      baseline_run_id: "",
      experiment_title: bridge?.title ? bridge.title + " — paired experiment" : "",
      experiment_profile_ids: [], design: "one_at_a_time", axes_text: "" };
  }
  function scenarioNativeScope() {
    const ui = memory();
    ui.scenario ||= scenarioDraft();
    const d = ui.scenario, current = getState?.()?.data || {}, retained = ui.overview?.available || {};
    const mergeRows = name => [...new Map([...(current[name] || []), ...(retained[name] || [])]
      .map(row => [row.id, row])).values()];
    const data = { grids: mergeRows("grids"), profiles: mergeRows("profiles"), runs: mergeRows("runs"),
      scenarios: mergeRows("scenarios"), invest_version: retained.invest_version || getState?.()?.invest_version };
    const grids = data.grids.filter(row => row.state === "complete"), profiles = data.profiles;
    const grid = grids.find(row => row.id === d.grid_id), profile = profiles.find(row => row.id === d.profile_id);
    const gridModels = grid ? runModels({ selection: grid.spec || {} }) : [];
    const profileModels = new Set(profile ? runModels({ selection: profile }) : []);
    const available = gridModels.filter(model => profileModels.has(model));
    const selected = Array.isArray(d.models) ? d.models : String(d.models || "").split(",").filter(Boolean);
    const retainedModels = available.filter(model => selected.includes(model));
    const models = d.models_explicit ? retainedModels : retainedModels.length ? retainedModels : available;
    d.models = models.join(",");
    return { draft: d, data, grids, profiles, grid, profile, available, models };
  }

  function scenarioNativeFields(scope) {
    const d = scope.draft, labels = { ndr: "Nitrogen and phosphorus (NDR)", sdr: "Sediment (SDR)" };
    const choices = (rows, noun) => [["", "Choose an existing " + noun], ...rows.map(row =>
      [row.id, (row.title || row.spec?.title || row.id) + " · " + row.id])];
    return '<div class="cons-grid">' +
      select("scenario.grid_id", "Complete analysis grid", d.grid_id, choices(scope.grids, "complete grid")) +
      select("scenario.profile_id", "Existing model profile", d.profile_id, choices(scope.profiles, "profile")) +
      '</div><fieldset><legend id="conservation-scenario-models">Native model scope</legend>' +
      '<div role="group" aria-labelledby="conservation-scenario-models">' +
      ["ndr", "sdr"].map(model => '<label class="cons-check"><input type="checkbox" data-scenario-model="' +
        model + '"' + (scope.models.includes(model) ? " checked" : "") +
        (scope.available.includes(model) ? "" : " disabled") + '> <span>' + h(labels[model]) +
        (scope.available.includes(model) ? "" : " — unavailable for the selected grid and profile") +
        '</span></label>').join("") + '</div><p class="cons-help">' +
      (scope.models.length ? "The prepared native cases will measure " +
        scope.models.map(model => h(labels[model])).join(" and ") + " using the selected grid and profile." :
        "Choose a complete grid and a compatible profile, then select at least one supported native model.") +
      '</p></fieldset>';
  }

  function scenarioRunSelection() {
    const scope = scenarioNativeScope(), d = scope.draft;
    if (!scope.grid || !scope.profile) throw new Error("Choose a completed analysis grid and a retained model profile.");
    if (!scope.models.length) throw new Error("Choose a native model supported by both the selected grid and profile.");
    const selection = { grid_id: d.grid_id, profile_id: d.profile_id };
    if (scope.models.length !== 2) selection.models = [...scope.models];
    return selection;
  }

  function experimentBaselines(scope) {
    const { draft: d, data } = scope;
    if (!scope.grid || !scope.profile || !scope.models.length) return [];
    const original = new Set((data.scenarios || []).filter(row => row.kind === "baseline").map(row => row.id));
    return runs().filter(run => {
      const value = run.selection || {};
      return value.grid_id === d.grid_id && value.profile_id === d.profile_id &&
        original.has(value.scenario_id) &&
        run.execution?.supported === true &&
        runModels(run).join(",") === scope.models.join(",");
    });
  }
  function experimentFields(d, scope) {
    const profiles = scope.profiles.filter(row => row.id !== d.profile_id);
    const baselines = experimentBaselines(scope);
    const missingBaseline = d.baseline_run_id && !baselines.some(run => run.id === d.baseline_run_id);
    return '<details class="cons-disclosure" open><summary>Paired experiment</summary>' +
      '<p>The baseline and the selected land-cover change use the same grid, native model choices and each profile. ' +
      'The experiment runs and compares the original native outputs. Completed original runs keep their IDs and outputs; ' +
      'compatibility uses the retained version metadata for each native model.</p><div class="cons-grid">' +
      input("scenario.experiment_title", "Experiment title", d.experiment_title || "") +
      select("scenario.baseline_run_id", "Original land-cover baseline", d.baseline_run_id, [
        ["", "Reuse or prepare a matching original baseline"],
        ...(missingBaseline ? [[d.baseline_run_id, "Choose again: this baseline does not match the current native scope"]] : []),
        ...baselines.map(run => [run.id, (run.title || run.id) + " · " + runQuantityLabel(run)]),
      ]) +
      select("scenario.design", "Parameter design", d.design, [
        ["one_at_a_time", "One parameter at a time"], ["factorial", "Every selected parameter combination"],
      ]) + '</div>' +
      '<p class="cons-help">Listed baselines use original land cover and the selected grid, profile, models and InVEST version. ' +
      'Automatic preparation also reuses a matching retained baseline. Each additional profile receives its own matched original case.</p>' +
      (profiles.length ? '<fieldset class="cons-profile-choices"><legend>Additional retained profiles</legend>' +
        profiles.map(profile => {
          const selected = d.experiment_profile_ids.includes(profile.id);
          const supported = scope.models.length && scope.models.every(model =>
            runModels({ selection: profile }).includes(model));
          return '<label class="cons-check"><input type="checkbox" data-scenario-profile="' +
            h(profile.id) + '"' + (selected ? " checked" : "") + (!supported && !selected ? " disabled" : "") +
            '> <span>' + h(profile.title || profile.id) +
            (supported ? "" : " — does not support the selected native model scope") + '</span></label>';
        }).join("") + '</fieldset>' : "") +
      '<p class="cons-help">Preparation checks every chosen profile’s original coefficient table against the grid’s land-cover classes ' +
      'and the replacement class, then retains the exact source references.</p>' +
      '<details class="cons-disclosure"><summary>Native parameter axes</summary>' +
      '<p>Optional JSON array. Each axis records a native parameter path, its values, and the scientific source ' +
      'or rationale. Existing profile values are used when this is empty.</p>' +
      '<label class="cons-field" for="' + fieldId("scenario.axes_text") + '"><span>Parameter axes</span>' +
      '<textarea id="' + fieldId("scenario.axes_text") + '" data-field="scenario.axes_text" rows="5" ' +
      'spellcheck="false">' + h(d.axes_text || "") + '</textarea></label>' +
      '<p class="cons-help">Fields: path, values, reference. The experiment validates each value against its selected native model.</p>' +
      '</details></details>';
  }
  function scenarioForm() {
    const ui = memory(), scope = scenarioNativeScope();
    const d = scope.draft, continuation = !!d.conservation_scenario_id;
    const data = scope.data;
    const choices = (rows, noun) => [["", "Choose an existing " + noun], ...(rows || []).map(row =>
      [row.id, (row.title || row.spec?.title || row.id) + " · " + row.id])];
    return '<form class="cons-editor" data-cons-form="scenario"><div class="cons-section-title">' +
      "<h2>" + (continuation ? "Prepare a paired experiment" : "Create land-cover scenario") + "</h2>" +
      button("close-form", "Close") + "</div>" +
      (continuation ? "<p>Use the saved conservation scenario and its original selected footprint.</p>" :
        "<p>Apply an explicit land-cover change inside the saved portfolio's unique selected footprint.</p>") +
      '<div class="cons-grid">' +
      (continuation ? "" : input("scenario.title", "Scenario title", d.title, 'required autocomplete="off"')) +
      input("scenario.reason", "Purpose of the scenario or experiment", d.reason, 'required') +
      (continuation ? "" :
        input("scenario.from_codes", "Source land-cover codes (comma-separated)", d.from_codes, 'required') +
        input("scenario.to_code", "Destination land-cover code", d.to_code, 'type="number" min="0" step="1" required') +
        select("scenario.output", "Continue with", d.output, [
          ["scenario", "Save the land-cover scenario"],
          ["run", "Prepare its native model run"],
          ["experiment", "Prepare a paired baseline and alternative experiment"],
        ])) + "</div>" +
      (d.output !== "scenario" ? scenarioNativeFields(scope) : "") +
      (d.output === "experiment" ? experimentFields(d, scope) : "") +
      '<div class="cons-actions">' + button("save-scenario",
        continuation ? "Prepare experiment" : d.output === "experiment" ? "Create scenario and paired experiment" :
          d.output === "run" ? "Create scenario and prepare run" : "Create scenario", "", ui.busy) +
      "</div></form>";
  }
  function experimentSelection(d, scope = scenarioNativeScope()) {
    const value = { title: (d.experiment_title || d.title + " — paired experiment").trim(),
      reason: String(d.reason || "").trim(), design: d.design || "one_at_a_time",
      profile_ids: [...new Set(d.experiment_profile_ids || [])].filter(id => id !== d.profile_id) };
    if (!value.title || !value.reason) throw new Error("Give the paired experiment a title and purpose.");
    for (const id of value.profile_ids) {
      const profile = scope.profiles.find(row => row.id === id);
      if (!profile || !scope.models.every(model => runModels({ selection: profile }).includes(model))) {
        throw new Error("Additional profile " + id + " does not support the selected native models. Choose a compatible profile or remove it.");
      }
    }
    if (d.baseline_run_id) {
      if (!experimentBaselines(scope).some(run => run.id === d.baseline_run_id)) {
        throw new Error("Choose a matching original-land-cover baseline, or use automatic baseline preparation.");
      }
      value.baseline_run_id = d.baseline_run_id;
    }
    if (d.axes_text?.trim()) {
      try { value.axes = JSON.parse(d.axes_text); } catch (error) {
        throw new Error("The native parameter axes are invalid JSON: " + error.message);
      }
      if (!Array.isArray(value.axes) || value.axes.some(axis => !axis || typeof axis !== "object" ||
          Array.isArray(axis) || Object.keys(axis).sort().join(",") !== "path,reference,values" ||
          typeof axis.path !== "string" || typeof axis.reference !== "string" || !axis.reference.trim() ||
          !Array.isArray(axis.values) || !axis.values.length)) {
        throw new Error("Each native parameter axis needs path, a nonempty values array, and its reference.");
      }
    }
    return value;
  }
  function buildScenarioSpec() {
    const ui = memory(), d = ui.scenario;
    if (d?.conservation_scenario_id) {
      const value = { conservation_scenario_id: d.conservation_scenario_id, ...experimentSelection(d) };
      if (d.grid_id || d.profile_id) {
        if (!d.grid_id || !d.profile_id) throw new Error("Choose both an existing grid and profile for this saved footprint.");
        value.prepare_run = scenarioRunSelection();
      }
      return value;
    }
    if (!ui.plan?.id) throw new Error("Open the saved portfolio whose footprint defines this scenario.");
    if (!d?.title?.trim() || !d.reason?.trim()) throw new Error("Give the scenario a title and purpose.");
    const tokens = d.from_codes.split(/[\s,]+/).filter(Boolean);
    if (!tokens.length || tokens.some(value => !/^\d+$/.test(value))) {
      throw new Error("Source land-cover codes must be comma-separated nonnegative integers.");
    }
    const from = [...new Set(tokens.map(value => numeric(value, "Source land-cover code", { integer: true })))];
    const to = numeric(d.to_code, "Destination land-cover code", { integer: true });
    if (from.includes(to)) throw new Error("Exclude the destination class from the source land-cover codes.");
    const spec = { plan_id: ui.plan.id, title: d.title.trim(), reason: d.reason.trim(),
      from_codes: from, to_code: to };
    if (d.output !== "scenario") {
      if (!d.grid_id || !d.profile_id) throw new Error("Choose both an existing analysis grid and model profile.");
      spec.prepare_run = scenarioRunSelection();
    }
    if (d.output === "experiment") spec.prepare_experiment = experimentSelection(d);
    return spec;
  }
  function captureView() {
    if (!mounted || !mounted.isConnected || activeWorkspace !== workspace()) return null;
    const ui = memory();
    ui.openDetails = new Set([...mounted.querySelectorAll("details[open]")].map(node =>
      node.querySelector(":scope > summary")?.textContent?.trim()).filter(Boolean));
    const active = document.activeElement;
    if (!active || !mounted.contains(active)) return null;
    const key = ["data-field", "data-filter", "data-candidate-id", "data-scenario-model", "data-scenario-profile", "data-optimization-filter", "data-catalog-range", "data-catalog-metric"].find(name => active.hasAttribute?.(name));
    if (!key) return null;
    return { key, value: active.getAttribute(key),
      start: typeof active.selectionStart === "number" ? active.selectionStart : null,
      end: typeof active.selectionEnd === "number" ? active.selectionEnd : null };
  }
  function restoreView(focus) {
    if (!mounted) return;
    const ui = memory();
    for (const node of mounted.querySelectorAll("details")) {
      const title = node.querySelector(":scope > summary")?.textContent?.trim();
      if (ui.openDetails?.has(title)) node.open = true;
    }
    if (!focus) return;
    const target = [...mounted.querySelectorAll("[data-field],[data-filter],[data-candidate-id],[data-scenario-model],[data-scenario-profile],[data-optimization-filter],[data-catalog-range],[data-catalog-metric]")]
      .find(node => node.getAttribute(focus.key) === focus.value);
    if (target) {
      target.focus({ preventScroll: true });
      if (focus.start !== null && typeof target.setSelectionRange === "function") {
        try { target.setSelectionRange(focus.start, focus.end); } catch (_) { /* Numeric inputs have no text selection. */ }
      }
    }
  }
  function paint() {
    if (!mounted || !mounted.isConnected || activeWorkspace !== workspace()) return;
    const focus = captureView();
    mounted.innerHTML = content();
    restoreView(focus);
  }
  function updateSelectionCount() {
    if (!mounted) return;
    const ui = memory();
    for (const node of mounted.querySelectorAll(".cons-selection-count")) {
      node.textContent = node.textContent.replace(/^\d+/, String(checkedCount(ui)));
    }
    const clear = mounted.querySelector('[data-action="conservation-clear-selection"]');
    if (clear) clear.disabled = !checkedCount(ui);
  }
  function changed(event) {
    const target = event.target, ui = memory();
    if (!(target instanceof Element)) return;
    if (target.hasAttribute("data-candidate-id") && event.type === "change") {
      const id = target.getAttribute("data-candidate-id");
      setChecked(id, target.checked, ui);
      target.closest("tr")?.classList.toggle("cons-selected", target.checked);
      ui.selectionOrigin = null;
      updateSelectionCount();
      return;
    }
    if (target.hasAttribute("data-scenario-model") && event.type === "change") {
      const scope = scenarioNativeScope(), model = target.getAttribute("data-scenario-model");
      const selected = new Set(scope.models);
      if (scope.available.includes(model) && target.checked) selected.add(model);
      else selected.delete(model);
      scope.draft.models = ["ndr", "sdr"].filter(name => selected.has(name)).join(",");
      scope.draft.models_explicit = true;
      paint();
      return;
    }
    if (target.hasAttribute("data-scenario-profile") && event.type === "change") {
      const id = target.getAttribute("data-scenario-profile");
      const selected = new Set(ui.scenario?.experiment_profile_ids || []);
      if (target.checked) selected.add(id); else selected.delete(id);
      if (ui.scenario) ui.scenario.experiment_profile_ids = [...selected];
      return;
    }
    if (target.hasAttribute("data-alt-id") && event.type === "change") {
      const id = target.getAttribute("data-alt-id");
      const values = new Set(ui.draft.alternative_run_ids);
      if (target.checked) values.add(id); else values.delete(id);
      ui.draft.alternative_run_ids = [...values];
      return;
    }
    const optimizationFilter = target.getAttribute("data-optimization-filter");
    if (optimizationFilter) {
      ui[optimizationFilter === "search" ? "optimizationSearch" : "optimizationFilter"] = target.value;
      ui.optimizationPage = 1; paint(); return;
    }
    const range = target.getAttribute("data-catalog-range");
    if (range) { ui.ranges[range] = target.value; return; }
    const metric = target.getAttribute("data-catalog-metric");
    if (metric) { ui.metricFilter[metric] = target.value; return; }
    const filter = target.getAttribute("data-filter");
    if (filter) {
      ui[filter] = filter === "pageSize" ? Number(target.value) : target.value;
      if (filter !== "displayAlternative") {
        ui.page = 1;
        if (filter === "sort") ui.direction = ["id", "label", "rank"].includes(ui.sort) ? "asc" : "desc";
        ui.catalogController?.abort(); ui.catalogVersion++; ui.catalogLoading = true;
        clearTimeout(ui.catalogTimer);
        ui.catalogTimer = setTimeout(() => void loadCandidatePage(true), filter === "search" ? 180 : 0);
      }
      paint();
      return;
    }
    const name = target.getAttribute("data-field");
    if (!name) return;
    const value = target.type === "checkbox" ? target.checked : target.value;
    if (name.startsWith("optimization.")) {
      const field = name.slice("optimization.".length);
      ui.optimization[field] = value;
      if (event.type === "change" && ["kind", "scenario_run_id"].includes(field)) {
        const axes = optimizationAxes(ui.optimization);
        if (axes.length && !axes.some(([axis]) => Number(ui.optimization["weight_" + axis]) > 0)) {
          for (const [axis] of axes) ui.optimization["weight_" + axis] =
            ui.optimization.kind === "source-context" ? (axis === "reporting_area_ha" ? "1" : "0") : "1";
        }
      }
      if (event.type === "change" && ["kind", "scenario_run_id", "stability"].includes(field)) paint();
      return;
    }
    if (name.startsWith("acquisition.")) {
      const field = name.slice("acquisition.".length);
      ui.acquisition[field] = value;
      if (event.type === "change" && field.endsWith("_source")) {
        const declared = entry(value);
        ui.acquisition[field.slice(0, -7) + "_layer"] = declared?.layer || "";
      }
      if (event.type === "change") paint();
      return;
    }
    if (event.type === "change" && name.endsWith("_source")) {
      const declared = entry(value), prefix = name.slice(0, -7);
      if (Object.prototype.hasOwnProperty.call(ui.draft, prefix + "_layer"))
        ui.draft[prefix + "_layer"] = declared?.layer || "";
      if (name === "parcel_source") {
        ui.draft.id_field = declared?.id_field || "";
        ui.draft.label_field = declared?.label_field || "";
        ui.draft.parcel_where = "";
      }
      for (const suffix of ["_reference", "_meaning"]) {
        if (Object.prototype.hasOwnProperty.call(ui.draft, prefix + suffix)) ui.draft[prefix + suffix] = "";
      }
    }
    if (name.startsWith("plan.")) ui.portfolio[name.slice(5)] = value;
    else if (name.startsWith("scenario.")) {
      ui.scenario ||= {};
      ui.scenario[name.slice(9)] = value;
    } else ui.draft[name] = value;
    if (event.type === "change" && name === "mode" && ui.draft.score_basis !== "published_method") {
      ui.draft.score_basis = value === "source_context" ? "context" :
        ui.draft.purpose === "protection" ? "disturbance_increase" : "current_export";
    }
    if (event.type === "change" && name === "purpose" && ui.draft.mode === "native_model" &&
      ui.draft.score_basis !== "published_method") {
      ui.draft.score_basis = value === "protection" ? "disturbance_increase" : "current_export";
    }
    if (event.type === "change" && name === "purpose" && ui.draft.score_basis === "published_method" &&
        value !== "screening" && methodCategory(ui.draft.method_category)?.purpose !== value) {
      ui.draft.method_category = publishedCategories().find(category => category.purpose === value)?.id || "";
    }
    if (event.type === "change" && name === "method_category" && ui.draft.purpose !== "screening") {
      const category = methodCategory(value);
      if (category) ui.draft.purpose = category.purpose;
    }
    if (event.type === "change" && name === "baseline_run_id") {
      ui.draft.alternative_run_ids = ui.draft.alternative_run_ids.filter(id => id !== value);
      if (ui.draft.score_alternative === value) ui.draft.score_alternative = "";
      if (!allNativeClasses(ui.draft)) ui.draft.method_native_classes = false;
    }
    if (event.type === "change" && ["mode", "purpose", "score_basis", "baseline_run_id", "score_alternative",
      "method_category", "method_native_classes", "method_headwaters", "plan.mode", "scenario.output", "scenario.grid_id", "scenario.profile_id"].includes(name) ||
      event.type === "change" && name.endsWith("_source")) paint();
  }
  async function dispatch(node) {
    const action = node?.dataset?.action;
    if (!action?.startsWith("conservation-")) return false;
    const ui = memory(), name = action.slice("conservation-".length);
    try {
      if (!workspace()) throw new Error("Open a workspace before using conservation planning.");
      switch (name) {
        case "optimization-new":
          ui.optimization = optimizationDraft(ui.study); ui.form = "optimization"; ui.notice = null; paint(); break;
        case "optimization-use-checked": {
          if (!checkedCount(ui)) throw new Error("Check original candidate units first.");
          const ids = await checkedCandidateIds();
          if (ids === null) return true;
          ui.optimization.include_ids = JSON.stringify(ids); paint(); break;
        }
        case "optimization-preview":
          await queue("conservation.optimization.preview", { spec: buildOptimizationSpec() }); break;
        case "optimization-save":
          await queue("conservation.optimization.save", { spec: buildOptimizationSpec() }); break;
        case "optimization-save-preview":
          await queue("conservation.optimization.save", optimizationRequestForSave()); break;
        case "optimization-open-preview":
          await openOptimization({ taskId: node.dataset.taskId }); break;
        case "optimization-open-analysis":
          await openOptimization({ studyId: node.dataset.studyId, analysisId: node.dataset.analysisId }); break;
        case "optimization-adjust":
          if (!ui.optimizationResult?.analysis) throw new Error("Open an original decision analysis.");
          ui.optimization = optimizationDraft(ui.study, ui.optimizationResult.analysis.request);
          ui.form = "optimization"; paint(); break;
        case "optimization-select-results":
          clearChecked(ui); resetCatalogFilters(ui);
          ui.selectedIds = new Set((ui.optimizationResult?.analysis?.selected_ids || []).map(String));
          ui.form = null;
          ui.notice = { kind:"status", message:ui.selectedIds.size + " original units selected from the decision analysis." };
          await refreshCatalog(true); paint(); break;
        case "optimization-previous":
          ui.optimizationPage = Math.max(1, (ui.optimizationPage || 1) - 1); paint(); break;
        case "optimization-next":
          ui.optimizationPage = (ui.optimizationPage || 1) + 1; paint(); break;
        case "optimization-export":
          await queue("conservation.optimization.export", { plan_id: node.dataset.planId || ui.plan?.id }); break;
        case "new-source-capture": {
          const key = workspace();
          if (!ui.overview) await refreshOverview(true);
          if (workspace() !== key) return true;
          ui.acquisition = freshSourceCapture(node.dataset.studyId || ui.study?.id || "");
          ui.form = "sources"; ui.notice = null; paint(); break;
        }
        case "acquire-sources":
          await queue("conservation.sources.capture", buildSourceCaptureSpec()); break;
        case "resume-sources":
          if (!node.dataset.operationId) throw new Error("Choose the retained source acquisition.");
          await queue("conservation.sources.capture", { operation_id: node.dataset.operationId }); break;
        case "criteria-from-sources":
          if (!node.dataset.operationId) throw new Error("Choose the retained source acquisition.");
          await queue("conservation.criteria.prepare", { source_operation_id: node.dataset.operationId,
            settings: { spatial_criteria_basis: ui.acquisition.criterion_geometry || "whole_original_parcel" } }); break;
        case "open-source-capture": {
          const result = await read("source-capture", { operation_id: node.dataset.operationId });
          if (result) { ui.sourceCapture = result; ui.form = "source-result"; paint(); }
          break;
        }
        case "prepare-criteria":
          await queue("conservation.criteria.prepare", buildCriteriaSpec()); break;
        case "resume-criteria":
          if (!node.dataset.operationId) throw new Error("Choose the retained parcel criterion preparation.");
          await queue("conservation.criteria.prepare", { operation_id: node.dataset.operationId }); break;
        case "use-criteria": {
          const key = workspace(), collection = node.dataset.sourceCollection, source = node.dataset.sourceId;
          if (!collection || !source) throw new Error("Open the completed criterion preparation task.");
          if (!ui.overview) await refreshOverview(true);
          if (workspace() !== key) return true;
          if (node.dataset.studyId) {
            const retained = await catalogRead("study", { study_id: node.dataset.studyId });
            if (!retained || workspace() !== key) return true;
            ui.draft = draftFromStudy(retained.spec, ui.draft);
          }
          ui.draft.method_source = JSON.stringify({ source_collection_id: collection, source_id: source });
          ui.draft.method_format = node.dataset.tableFormat || "json";
          ui.draft.method_id_column = node.dataset.idColumn || "id";
          ui.draft.score_basis = "published_method";
          ui.form = "study"; ui.notice = { kind: "status", message: "The prepared parcel criterion table is selected." };
          await refreshOverview(true); paint(); break;
        }
        case "new-parcel-study": {
          const key = workspace(), collection = node.dataset.sourceCollection, source = node.dataset.sourceId;
          if (!collection || !source) throw new Error("Choose the imported original parcel source.");
          if (!ui.overview) await refreshOverview(true);
          if (workspace() !== key) return true;
          const selected = sourceKey({ source_collection_id: collection, source_id: source });
          const declared = entry(selected);
          if (!declared) throw new Error("Refresh this workspace's imported parcel source before opening the study.");
          const draft = freshStudy();
          draft.title = node.dataset.studyTitle || (declared.title || "Original parcels") + " — conservation study";
          draft.unit_type = "parcel"; draft.planning_unit_label = "Parcels";
          draft.parcel_source = selected;
          draft.parcel_layer = node.dataset.layer || declared.layer || "";
          draft.id_field = node.dataset.idField || declared.id_field || "";
          draft.label_field = node.dataset.labelField || declared.label_field || "";
          draft.parcel_where = node.dataset.where || "";
          if (draft.parcel_where) {
            const where = JSON.parse(draft.parcel_where);
            if (!where || Array.isArray(where) || typeof where !== "object") {
              throw new Error("The original parcel filter must be a JSON object with typed field values.");
            }
          }
          ui.draft = draft; ui.form = "study"; ui.notice = null; paint(); break;
        }
        case "new-study":
          ui.form = "study"; ui.notice = null; paint(); break;
        case "close-form":
          ui.form = null; paint(); break;
        case "refresh":
          await refreshOverview(true);
          if (ui.study?.id) await openStudy(ui.study.id, true);
          break;
        case "open-study":
          await openStudy(node.dataset.studyId);
          if (node.dataset.selectionId) await useRetainedSelection(node.dataset.selectionId);
          break;
        case "open-plan":
          await openPlan(node.dataset.planId); break;
        case "close-study":
          resetCatalog(ui); ui.readVersion++; clearChecked(ui);
          resetCatalog(ui); clearChecked(ui);
          ui.study = null; ui.plan = null; ui.detailId = null; ui.form = null; paint(); break;
        case "populate-json": {
          const original = ui.draft.advanced_use;
          ui.draft.advanced_use = false;
          try {
            ui.draft.advanced_text = JSON.stringify(buildSpec(), null, 2);
            ui.draft.advanced_use = true;
          } catch (error) { ui.draft.advanced_use = original; throw error; }
          paint(); break;
        }
        case "submit-study":
          await queue("conservation.build", { spec: buildSpec() }); break;
        case "prepare-study":
          await queue("conservation.prepare", { spec: buildSpec() }); break;
        case "build-study":
          await queue("conservation.build", { study_id: node.dataset.studyId || ui.study?.id }); break;
        case "new-portfolio":
          ui.form = "portfolio";
          if (!ui.portfolio.title) ui.portfolio.title = (ui.study?.title || ui.study?.spec?.title || "Study") + " portfolio";
          paint(); break;
        case "save-plan": {
          const spec = buildPlanSpec();
          if (ui.retainedSelection && spec.mode === "manual") {
            const { selected_ids, ...plan } = spec;
            await queue("conservation.catalog.plan.save", { study_id: ui.study.id,
              selection_id: ui.retainedSelection.selection_id, plan,
              include_ids: [...ui.selectedIds].sort(), exclude_ids: [...ui.excludedIds].sort() });
          } else await queue("conservation.plan.save", spec);
          break;
        }
        case "catalog-prepare":
          await queue("conservation.catalog.prepare", { study_id: ui.study.id }); break;
        case "select-matching": {
          if (ui.eligibility === "excluded") throw new Error("Show all or eligible units before retaining eligible matches.");
          if (ui.eligibility === "selected" && ui.retainedSelection) throw new Error("This complete cohort is already retained. Use a different inventory filter to replace it.");
          const selection = querySelection(ui);
          selection.filters.eligible = "yes";
          await queue("conservation.catalog.select", { study_id: ui.study.id, selection });
          break;
        }
        case "export-matching":
          await queue("conservation.catalog.export", catalogRequest(ui)); break;
        case "apply-filters":
          ui.page = 1; await loadCandidatePage(true); break;
        case "clear-filters":
          for (const key of Object.keys(ui.ranges)) ui.ranges[key] = "";
          ui.metricFilter = { pollutant: "", case: "baseline", field: "value", min: "", max: "", availability: "" };
          ui.page = 1; await loadCandidatePage(true); break;
        case "export-study":
          await queue("conservation.export", { study_id: node.dataset.studyId || ui.study?.id }); break;
        case "export-plan":
          await queue("conservation.export", { study_id: node.dataset.studyId || ui.plan?.study_id,
            plan_id: node.dataset.planId || ui.plan?.id }); break;
        case "select-page":
          for (const candidate of pageRows()) if (candidate.eligible) setChecked(candidate.id, true, ui);
          ui.selectionOrigin = null; paint(); break;
        case "clear-selection":
          clearChecked(ui); await loadCandidatePage(true); paint(); break;
        case "previous-page":
          ui.page = Math.max(1, ui.page - 1); await loadCandidatePage(true); break;
        case "next-page":
          ui.page += 1; await loadCandidatePage(true); break;
        case "candidate":
          await openCandidate(node.dataset.candidate); break;
        case "close-detail":
          ui.detailVersion++; ui.detailId = null; ui.detailRow = null; ui.detailLoading = false; paint(); break;
        case "edit-selection": {
          if (!ui.plan) throw new Error("Open a saved portfolio first.");
          const cohort = ui.plan.selection?.catalog_selection;
          if (cohort?.selection_id) {
            await useRetainedSelection(cohort.selection_id);
            ui.selectedIds = new Set((cohort.include_ids || []).map(String));
            ui.excludedIds = new Set((cohort.exclude_ids || []).map(String));
            await loadCandidatePage(true);
          } else {
            clearChecked(ui);
            ui.selectedIds = new Set((ui.plan.selected_ids || []).map(String));
          }
          ui.selectionOrigin = ui.plan.id;
          ui.portfolio = { ...freshPortfolio(), title: (ui.plan.title || "Portfolio") + " revision",
            objective: ui.study?.spec?.score?.basis === "context" &&
              !Object.values(ui.study?.spec?.score?.context_weights || {}).some(value => finite(value) && value !== 0) ? "area" : "score" };
          ui.form = "portfolio"; paint(); break;
        }
        case "new-scenario":
          if (!ui.plan) throw new Error("Open a saved portfolio first.");
          ui.scenario = scenarioDraft(); ui.form = "scenario"; paint(); break;
        case "new-experiment": {
          const key = workspace();
          let bridge = (ui.overview?.scenario_bridges || []).find(row => row.id === node.dataset.bridgeId);
          if (!bridge) {
            await refreshOverview(true);
            if (workspace() !== key) return true;
            bridge = (ui.overview?.scenario_bridges || []).find(row => row.id === node.dataset.bridgeId);
          }
          if (!bridge) throw new Error("Refresh the retained conservation scenarios and reopen this record.");
          let baseline = null;
          if (!bridge.prepare_run && bridge.study_id) {
            const original = await read("study", { study_id: bridge.study_id });
            if (workspace() !== key) return true;
            baseline = runs().find(run => run.id === original?.spec?.baseline_run_id) || null;
          }
          ui.scenario = scenarioDraft(bridge, baseline); ui.form = "scenario"; ui.notice = null; paint(); break;
        }
        case "save-scenario":
          await queue(ui.scenario?.conservation_scenario_id ? "conservation.experiment.prepare" :
            "conservation.scenario.create", buildScenarioSpec()); break;
        case "show-task":
          if (showTask) await showTask(node.dataset.taskId); break;
        default:
          throw new Error("Unknown conservation control.");
      }
    } catch (error) {
      const message = error?.message || String(error);
      ui.notice = { kind: "error", message };
      paint();
      if (toast) toast(message);
    }
    return true;
  }
  function taskActions(task) {
    if (!String(task?.action || "").startsWith("conservation.")) return "";
    const result = task.result || task.output || {};
    const meta = task._conservation || {};
    if (task.action === "conservation.catalog.select" && task.state === "complete" && result.selection_id) {
      return button("open-study", "Use complete retained selection", 'data-study-id="' + h(result.study_id) +
        '" data-selection-id="' + h(result.selection_id) + '"') +
        "<p>" + number(result.count) + " original units retained across all candidate pages.</p>";
    }
    if (task.action === "conservation.optimization.preview" && task.state === "complete" && result.request) {
      return '<p>' + number(result.counts?.selected) + ' selected from ' + number(result.counts?.inventory) +
        ' retained units · ' + h(human(result.optimization?.status)) + '</p><div class="cons-actions">' +
        button("optimization-open-preview", "Review portfolio decision", 'data-task-id="' + h(task.id) + '"') + '</div>';
    }
    if (task.action === "conservation.optimization.save" && result.plan?.id) {
      return '<div class="cons-actions">' + button("open-plan", "Open optimized portfolio",
        'data-plan-id="' + h(result.plan.id) + '"') +
        button("optimization-open-analysis", "Open retained decision analysis",
          'data-study-id="' + h(result.plan.study_id) + '" data-analysis-id="' + h(result.analysis?.id || "") + '"') + '</div>';
    }
    if (task.action === "conservation.sources.capture") {
      return '<div class="cons-actions">' + sourceCaptureButtons(result) + "</div>";
    }
    if (task.action === "conservation.criteria.prepare" && result.state === "complete" &&
        result.source_collection_id && result.source_id) {
      return '<div class="cons-actions">' + button("use-criteria", "Use prepared parcel criteria",
        'data-source-collection="' + h(result.source_collection_id) + '" data-source-id="' + h(result.source_id) +
        '" data-study-id="' + h(result.study_id || "") + '" data-table-format="' + h(result.table?.format || "json") + '" data-id-column="' + h(result.table?.id_column || "id") + '"') +
        '</div>' + (finite(result.coverage?.parcels) ? "<p>Criteria prepared for " + number(result.coverage.parcels) + " parcels.</p>" : "");
    }
    const studyId = meta.study_id || result.study_id ||
      (["conservation.prepare", "conservation.build"].includes(task.action) ? result.id : null);
    const planId = meta.plan_id || result.plan_id ||
      (task.action === "conservation.plan.save" ? result.id : null);
    const scenarioId = result.scenario_id || result.scenario?.id;
    const runId = result.run_id || result.run?.id || result.alternative_run_id;
    const experimentId = result.experiment_id || result.experiment?.id;
    const nativeButtons = (scenarioId ? '<button type="button" data-action="item" data-kind="scenarios" data-id="' +
      h(scenarioId) + '">Open land-cover scenario</button>' : "") +
      (runId ? '<button type="button" data-action="item" data-kind="runs" data-id="' +
      h(runId) + '">Open native run</button>' : "");
    return experimentButton(experimentId) + nativeButtons + (studyId ? button("open-study", "Open conservation study", 'data-study-id="' + h(studyId) + '"') : "") +
      (planId ? button("open-plan", "Open saved portfolio", 'data-plan-id="' + h(planId) + '"') : "");
  }
  function ensureStyle() {
    if (document.querySelector("link[data-conservation-style]")) return;
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = new URL("./conservation.css", import.meta.url).href;
    style.dataset.conservationStyle = "true";
    document.head.append(style);
  }
  function render(state = getState?.()) {
    if (mounted && activeWorkspace === workspace()) memory().focusMemo = captureView();
    if (!state?.workspace_key) {
      return '<section id="conservation-workspace" class="cons-root"><h1>Conservation planning</h1>' +
        "<p>Open an existing workspace to use its retained sources and model runs.</p></section>";
    }
    return '<section id="conservation-workspace" class="cons-root">' + content() + "</section>";
  }
  function mount(root, state = getState?.()) {
    ensureStyle();
    const node = root?.matches?.("#conservation-workspace") ? root :
      root?.querySelector?.("#conservation-workspace") || document.getElementById("conservation-workspace");
    if (!node) return;
    if (mounted !== node) {
      listener?.abort();
      mounted = node;
      listener = new AbortController();
      for (const type of ["input", "change"]) node.addEventListener(type, changed, { signal: listener.signal });
      node.addEventListener("submit", event => {
        const form = event.target?.closest?.("[data-cons-form]");
        if (!form) return;
        event.preventDefault();
        const name = form.dataset.consForm === "optimization" ? "optimization-preview" :
          form.dataset.consForm === "portfolio" ? "save-plan" :
          form.dataset.consForm === "scenario" ? "save-scenario" :
          form.dataset.consForm === "sources" ? "acquire-sources" : "submit-study";
        const control = form.querySelector('[data-action="conservation-' + name + '"]');
        if (control) void dispatch(control);
      }, { signal: listener.signal });
    }
    activeWorkspace = state?.workspace_key || workspace();
    const ui = memory();
    restoreView(ui.focusMemo);
    ui.focusMemo = null;
    if (!workspace()) return;
    const stamp = taskStamp(state);
    if (!ui.overview || stamp !== ui.taskStamp) void refreshOverview(!!ui.overview);
  }
  function detach() {
    if (mounted && activeWorkspace === workspace()) captureView();
    listener?.abort(); listener = null; mounted = null; activeWorkspace = null;
  }
  return { render, mount, detach, dispatch, taskActions, integratedOptimization: true };
}
