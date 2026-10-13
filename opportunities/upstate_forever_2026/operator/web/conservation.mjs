/** Conservation studies and portfolios within the existing GIS operator. */
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
    water_relation: "Area intersection with retained source-water geography",
    quality_source: "", quality_layer: "", quality_reference: "", quality_meaning: "",
    quality_relation: "Intersection with the source-designated water features", quality_buffer: "0",
    minimum_coverage: "95", maximum_protected: "100", minimum_water: "0",
    minimum_area: "0", require_quality: false, excluded_ids: "",
    score_basis: "context", score_scale: "total", weight_n: "1", weight_p: "1", weight_s: "1",
    context_water_weight: "", context_unprotected_weight: "", context_quality_weight: "",
    cost_source: "", cost_id_column: "", cost_value_column: "", currency: "", cost_reference: "",
    advanced_use: false, advanced_text: "",
  };
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
  getState, api, endpoint, submitAction, showTask, toast,
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
      search: "", eligibility: "all", sort: "score", form: null,
      draft: freshStudy(), portfolio: freshPortfolio(), detailId: null,
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
  const runs = () => (getState?.()?.data?.runs || memory().overview?.available?.runs || [])
    .filter(run => run.state === "complete");
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
    const source = state?.tasks;
    const tasks = Array.isArray(source) ? source : Array.isArray(source?.tasks) ? source.tasks :
      Array.isArray(source?.items) ? source.items : source && typeof source === "object" ?
        Object.values(source).filter(item => item && typeof item === "object" && item.action) : [];
    return tasks.filter(task => String(task.action || "").startsWith("conservation."))
      .map(task => [task.id, task.state || task.status].join(":"))
      .sort().join("|");
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
        const opened = ui.study, revision = ui.readVersion;
        const retained = opened && (response.studies || []).find(row => row.id === opened.id);
        if (retained && retained.state !== opened.state) {
          const updated = await read("study", { study_id: opened.id });
          if (updated && workspace() === key && ui.readVersion === revision && ui.study === opened)
            ui.study = updated;
        }
      }
    } catch (error) {
      if (workspace() === key) ui.notice = { kind: "error", message: error.message || String(error) };
    } finally {
      ui.overviewLoading = false;
      if (workspace() === key) paint();
    }
  }
  function candidates() {
    const values = memory().study?.candidates;
    return Array.isArray(values) ? values : Array.isArray(values?.rows) ? values.rows : [];
  }
  function filtered() {
    const ui = memory(), term = ui.search.trim().toLowerCase();
    const rows = candidates().filter(candidate => {
      if (ui.eligibility === "eligible" && !candidate.eligible) return false;
      if (ui.eligibility === "excluded" && candidate.eligible) return false;
      if (ui.eligibility === "selected" && !ui.selectedIds.has(String(candidate.id))) return false;
      return !term || [candidate.id, candidate.label, ...(candidate.exclusion_reasons || [])]
        .join(" ").toLowerCase().includes(term);
    });
    const rank = row => ui.sort === "area" ? row.reporting_area_ha :
      POLLUTANTS.some(([name]) => name === ui.sort) ? row.pollutants?.[ui.sort]?.baseline : row.score;
    rows.sort((a, b) => {
      if (ui.sort !== "id") {
        const av = rank(a), bv = rank(b);
        if (finite(av) && finite(bv) && av !== bv) return bv - av;
        if (finite(av) !== finite(bv)) return finite(av) ? -1 : 1;
      }
      return String(a.id).localeCompare(String(b.id));
    });
    return rows;
  }
  function pageRows() {
    const ui = memory(), rows = filtered();
    ui.page = Math.min(Math.max(1, ui.page), Math.max(1, Math.ceil(rows.length / ui.pageSize)));
    return rows.slice((ui.page - 1) * ui.pageSize, ui.page * ui.pageSize);
  }
  function buildSpec() {
    const d = memory().draft;
    if (d.advanced_use) {
      let spec;
      try { spec = JSON.parse(d.advanced_text); } catch (error) {
        throw new Error("The advanced study JSON is invalid: " + error.message);
      }
      if (!spec || Array.isArray(spec) || typeof spec !== "object") {
        throw new Error("The advanced study specification must be one JSON object.");
      }
      return spec;
    }
    if (!d.title.trim()) throw new Error("Give the study a title.");
    const parcels = sourceRef(d.parcel_source, d.parcel_layer, "planning-unit");
    if (d.id_field.trim()) parcels.id_field = d.id_field.trim();
    if (d.label_field.trim()) parcels.label_field = d.label_field.trim();
    if (d.parcel_where.trim()) parcels.where = d.parcel_where.trim();
    const spec = {
      title: d.title.trim(), mode: d.mode, purpose: d.purpose,
      unit_type: d.unit_type, planning_unit_label: d.planning_unit_label.trim() || "Planning unit",
      parcels, alternative_run_ids: [], contexts: {},
      rules: {
        minimum_coverage_fraction: numeric(d.minimum_coverage, "Minimum model coverage", { max: 100 }) / 100,
        maximum_protected_fraction: numeric(d.maximum_protected, "Maximum protected share", { max: 100 }) / 100,
        minimum_source_water_fraction: numeric(d.minimum_water, "Minimum source-water share", { max: 100 }) / 100,
        require_high_quality_context: !!d.require_quality,
        minimum_area_ha: numeric(d.minimum_area, "Minimum unit area"),
        excluded_ids: d.excluded_ids.split(/[\n,]+/).map(value => value.trim()).filter(Boolean),
      },
    };
    if (d.mode === "source_context") {
      spec.reporting_area = sourceRef(d.reporting_source, d.reporting_layer, "reporting-area");
      spec.analysis_crs = d.analysis_crs.trim() || "EPSG:5070";
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
      if (!d.baseline_run_id) throw new Error("Choose a completed baseline model run.");
      spec.baseline_run_id = d.baseline_run_id;
      spec.alternative_run_ids = [...new Set(d.alternative_run_ids)]
        .filter(id => id !== d.baseline_run_id);
      spec.score = {
        basis: d.score_basis === "context" ? "current_export" : d.score_basis,
        scale: d.score_scale,
        weights: {
          nitrogen_export: numeric(d.weight_n, "Nitrogen weight"),
          phosphorus_export: numeric(d.weight_p, "Phosphorus weight"),
          sediment_export: numeric(d.weight_s, "Sediment weight"),
        },
      };
      if (!Object.values(spec.score.weights).some(value => value > 0)) {
        throw new Error("At least one pollutant weight must be greater than zero.");
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
    if (spec.mode === "source_context") {
      const axes = spec.score.context_weights;
      if (axes.source_water_fraction && !spec.contexts.drinking_water) {
        throw new Error("Source-water ranking needs a retained source-water context layer.");
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
    if (p.mode === "manual" && !ui.selectedIds.size) throw new Error("Select at least one planning unit.");
    if (p.mode === "manual" && !p.include_ineligible) {
      const excluded = candidates().filter(item => ui.selectedIds.has(String(item.id)) && !item.eligible);
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
      const result = await read("study", { study_id: id });
      if (!result || version !== ui.readVersion || workspace() !== key) return;
      const same = String(ui.study?.id) === String(result.id);
      ui.study = result;
      if (!preserveSelection && !same) {
        ui.selectedIds = new Set(); ui.plan = null; ui.selectionOrigin = null;
        ui.portfolio = freshPortfolio(); ui.form = null; ui.page = 1;
        ui.displayAlternative = result.spec?.score?.alternative_run_id || "";
      }
      const present = new Set(candidates().map(candidate => String(candidate.id)));
      ui.selectedIds = new Set([...ui.selectedIds].filter(item => present.has(item)));
      if (result.mode === "source_context" && ui.portfolio.objective === "score") {
        ui.portfolio.objective = "area";
      }
      ui.detailId = null;
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
      const study = await read("study", { study_id: plan.study_id });
      if (!study || version !== ui.readVersion || workspace() !== key) return;
      ui.study = study; ui.plan = plan;
      ui.displayAlternative = study.spec?.score?.alternative_run_id || "";
      ui.selectedIds = new Set((plan.selected_ids || []).map(String));
      ui.selectionOrigin = plan.id; ui.page = 1; ui.detailId = null;
      ui.form = null; ui.notice = { kind: "status", message: "Opened " + (plan.title || plan.id) + "." };
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
        "The workspace task is running. Its results and downloads will appear in Tasks." };
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
  function studyForm() {
    const ui = memory(), d = ui.draft, native = d.mode === "native_model";
    const availableRuns = runs();
    const runItems = [["", "Choose a completed run"], ...availableRuns.map(run =>
      [run.id, (run.title || run.selection?.title || run.id) + " · " + run.id])];
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
      input("parcel_where", "Source selection condition, if needed", d.parcel_where) +
      "</div></fieldset>" +
      (native ? '<fieldset><legend>Native model runs</legend><div class="cons-grid">' +
        select("baseline_run_id", "Baseline run", d.baseline_run_id, runItems) +
        '</div><p class="cons-help">Use the retained baseline and explicit alternatives from the same study domain.</p>' +
        '<div class="cons-choice-list" role="group" aria-label="Alternative model runs">' +
        (alternatives.length ? alternatives.map(run =>
          '<label class="cons-check"><input type="checkbox" data-alt-id="' + h(run.id) + '"' +
          (d.alternative_run_ids.includes(run.id) ? " checked" : "") + "> <span>" +
          h(run.title || run.selection?.title || run.id) + " · " + h(run.id) + "</span></label>").join("") :
          "<p>No additional completed runs are available.</p>") + "</div></fieldset>" :
        '<fieldset><legend>Reporting area</legend><p class="cons-help">Area and overlap calculations use ' +
        "these retained boundaries. A reporting watershed becomes drinking-water context only when it has that documented role.</p>" +
        '<div class="cons-grid">' +
        sourceSelect("reporting_source", "Reporting-area source", d.reporting_source) +
        input("reporting_layer", "Reporting-area layer", d.reporting_layer) +
        input("analysis_crs", "Projected analysis CRS", d.analysis_crs) + "</div></fieldset>") +
      "<fieldset><legend>Source-based context</legend>" +
      contextFields("protected", "Protected lands",
        "Retain the source designation and edition. Protection overlap is an optional criterion; the default leaves all protection shares eligible.") +
      contextFields("water", "Drinking-water and source-water geography",
        "Select actual source-water or intake-related geography and describe its relationship to the planning units.") +
      contextFields("quality", "High-quality waters",
        "Use the retained outstanding-resource, trout or other relevant source designation. Record the source meaning and any explicit spatial buffer.") +
      "</fieldset><fieldset><legend>Eligibility</legend><div class=\"cons-grid\">" +
      input("minimum_area", "Minimum reporting-area footprint (ha)", d.minimum_area, 'type="number" min="0" step="any"') +
      input("maximum_protected", "Maximum protected share (%)", d.maximum_protected, 'type="number" min="0" max="100" step="any"') +
      input("minimum_water", "Minimum source-water share (%)", d.minimum_water, 'type="number" min="0" max="100" step="any"') +
      input("minimum_coverage", "Minimum native model coverage (%)", d.minimum_coverage, 'type="number" min="0" max="100" step="any"') +
      '</div><p class="cons-help">Model coverage applies when a native run is bound. Missing required context stays visible in the eligibility reasons.</p>' +
      check("require_quality", "Require the retained high-quality-water context", d.require_quality) +
      '<label class="cons-field">Exclude specific unit IDs<textarea data-field="excluded_ids" rows="2" ' +
      'placeholder="One ID per line or comma-separated">' + h(d.excluded_ids) + "</textarea></label></fieldset>" +
      '<fieldset><legend>Priority settings</legend>' +
      (native ? '<div class="cons-grid">' +
        select("score_basis", "What the priority represents", d.score_basis, [
          ["current_export", "Current modeled annual export"],
          ["scenario_reduction", "Reduction under a selected alternative"],
          ["disturbance_increase", "Increase under a disturbance alternative"]]) +
        select("score_scale", "Quantity scale", d.score_scale, [
          ["total", "Total annual quantity"], ["per_hectare", "Annual quantity per reporting hectare"]]) +
        (d.score_basis !== "current_export" ? select("score_alternative", "Scoring alternative",
          d.score_alternative, [["", "Choose the scoring alternative"], ...alternatives.map(run =>
            [run.id, (run.title || run.id) + " · " + run.id])]) : "") +
        input("weight_n", "Nitrogen weight", d.weight_n, 'type="number" min="0" step="any"') +
        input("weight_p", "Phosphorus weight", d.weight_p, 'type="number" min="0" step="any"') +
        input("weight_s", "Sediment weight", d.weight_s, 'type="number" min="0" step="any"') +
        '</div><p class="cons-help">Protection can use the increase under an explicit disturbance scenario. ' +
        "Restoration can use current export or a reduction scenario. The saved priority score retains its component weights; annual pollutant quantities remain separate.</p>" :
        '<div class="cons-grid">' +
        input("context_water_weight", "Source-water share weight", d.context_water_weight, 'type="number" min="0" step="any"') +
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
      '<p class="cons-selection-count" aria-live="polite">' + ui.selectedIds.size +
      " units are checked for manual selection.</p>" +
      (p.mode === "ranked" ? '<p class="cons-help">Ranked greedy selection adds eligible units in priority order, ' +
        "checks each new footprint against the limits and records skipped units and reasons.</p>" : "") +
      '<div class="cons-actions">' + button("save-plan", "Create saved portfolio", "", ui.busy) + "</div></form>";
  }
  function metricCell(metric, alternativeId = "", compact = true) {
    if (!metric || metric.availability === "unbound") {
      return '<span class="cons-muted">Native run unbound</span>';
    }
    const quantity = finite(metric.baseline) ? number(metric.baseline) + " " + h(metric.unit || "") :
      '<span class="cons-muted">No data</span>';
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
            (value.profile_changed ? '<span class="cons-metric-note">Model profile differs from baseline</span>' : "") + "</td>";
        }).join("") + "</tr>";
    }).join("");
    return '<div class="cons-table-wrap"><table class="cons-table"><thead><tr><th>Pollutant</th><th>Baseline</th>' +
      alternatives.map(id => "<th>Alternative " + h(id) + "</th>").join("") +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";
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
        "<dt>" + h(human(name)) + "</dt><dd>" + lineForSource(ref) +
        (ref.meaning ? "<br>" + h(ref.meaning) : "") +
        (ref.relation ? "<br>" + h(ref.relation) : "") +
        (finite(ref.buffer_m) ? "<br>Declared buffer: " + number(ref.buffer_m) + " m" : "") + "</dd>").join("") +
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
      "<dt>Source-water share</dt><dd>" + h(percent(candidate.source_water_fraction)) + "</dd>" +
      "<dt>High-quality-water context</dt><dd>" +
      (candidate.high_quality_context === null || candidate.high_quality_context === undefined ? "Unmapped" :
        candidate.high_quality_context ? "Present" : "Absent in selected context") +
      "</dd><dt>Recorded cost</dt><dd>" + (finite(candidate.cost) ? number(candidate.cost) + " " +
        h(candidate.currency || "") : "No matching cost") + "</dd>" +
      "<dt>Eligibility</dt><dd>" + (candidate.eligible ? "Eligible" :
        (candidate.exclusion_reasons || []).map(reason => h(human(reason))).join("; ") || "Excluded") +
      "</dd></dl>" + metricTable(candidate.pollutants, ui.study?.spec?.alternative_run_ids || []) +
      '<details><summary>Priority components</summary><pre>' +
      h(JSON.stringify(candidate.score_components || {}, null, 2)) + "</pre></details>" +
      '<details><summary>Original source attributes</summary><div class="cons-table-wrap"><table class="cons-table"><tbody>' +
      Object.entries(candidate.original_attributes || {}).map(([name, value]) =>
        "<tr><th scope=\"row\">" + h(name) + "</th><td>" +
        h(typeof value === "object" && value !== null ? JSON.stringify(value) : value) + "</td></tr>").join("") +
      "</tbody></table></div></details></section>";
  }
  function candidateTable() {
    const ui = memory(), all = candidates(), rows = pageRows(), shown = filtered().length;
    const pages = Math.max(1, Math.ceil(shown / ui.pageSize));
    const alternateIds = ui.study?.spec?.alternative_run_ids || [];
    const body = rows.map(candidate => {
      const id = String(candidate.id), selected = ui.selectedIds.has(id);
      return "<tr" + (selected ? ' class="cons-selected"' : "") + "><td>" +
        '<input type="checkbox" data-candidate-id="' + h(id) + '" aria-label="Select ' +
        h(candidate.label || id) + '"' + (selected ? " checked" : "") + "></td>" +
        '<th scope="row">' + button("candidate", candidate.label || id, 'data-candidate="' + h(id) +
          '" class="cons-text-button"') +
        '<span class="cons-metric-note">' + h(id) + "</span></th>" +
        "<td>" + number(candidate.reporting_area_ha) + "</td><td>" + number(candidate.score) + "</td>" +
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
      h(ui.search) + '" placeholder="ID, name or exclusion reason"></label>' +
      '<label>Show<select data-filter="eligibility">' +
      [["all", "All units"], ["eligible", "Eligible"], ["excluded", "Excluded"], ["selected", "Checked"]]
        .map(([value, label]) => option(value, label, ui.eligibility)).join("") + "</select></label>" +
      '<label>Sort by<select data-filter="sort">' +
      [["score", "Saved score"], ["area", "Reporting area"], ["id", "Identifier"], ...POLLUTANTS]
        .map(([value, label]) => option(value, label, ui.sort)).join("") + "</select></label>" +
      (alternateIds.length ? '<label>Quantity comparison<select data-filter="displayAlternative">' +
        option("", "Baseline only", ui.displayAlternative) +
        alternateIds.map(id => option(id, "Alternative " + id, ui.displayAlternative)).join("") + "</select></label>" : "") +
      "</div><div class=\"cons-toolbar\">" +
      button("select-page", "Check eligible units on this page", "", ui.busy || !rows.length) +
      button("clear-selection", "Clear checked units", "", !ui.selectedIds.size) +
      '<span class="cons-selection-count" aria-live="polite">' + ui.selectedIds.size + " checked · " +
      shown + " matching · " + all.length + " total units</span></div>" +
      '<div class="cons-table-wrap" tabindex="0" role="region" aria-label="Candidate inventory">' +
      '<table class="cons-table cons-candidates"><caption>Retained candidate inventory · ' +
      h(ui.study?.spec?.planning_unit_label || "Planning unit") +
      '</caption><thead><tr><th scope="col">Select</th><th scope="col">Unit</th><th scope="col">Area (ha)</th>' +
      '<th scope="col">Score</th>' + POLLUTANTS.map(([, title]) => '<th scope="col">' + h(title) + "</th>").join("") +
      '<th scope="col">Protected</th><th scope="col">Source water</th><th scope="col">High-quality context</th>' +
      '<th scope="col">Eligibility</th><th scope="col">Recorded cost</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="12">No planning units match these filters.</td></tr>') +
      "</tbody></table></div><div class=\"cons-toolbar cons-pagination\">" +
      button("previous-page", "Previous page", "", ui.page <= 1) +
      '<span>Page ' + ui.page + " of " + pages + "</span>" +
      button("next-page", "Next page", "", ui.page >= pages) +
      '<label>Rows per page<select data-filter="pageSize">' +
      [25, 50, 100].map(size => option(size, size, ui.pageSize)).join("") +
      "</select></label></div>";
  }
  function portfolioView(plan) {
    const summary = plan.summary || {}, study = memory().study;
    return '<section class="cons-detail" aria-label="Saved portfolio"><div class="cons-section-title"><div>' +
      "<h2>" + h(plan.title || plan.id) + '</h2><p class="cons-metric-note">Saved portfolio ' +
      h(plan.id) + "</p></div>" +
      button("export-plan", "Export this saved portfolio", 'data-plan-id="' + h(plan.id) +
        '" data-study-id="' + h(plan.study_id) + '"', memory().busy) + "</div>" +
      '<div class="cons-summary"><div><span>Selected units</span><strong>' +
      h(summary.parcels ?? (plan.selected_ids || []).length) + "</strong></div>" +
      "<div><span>Full selected footprint</span><strong>" + number(summary.whole_unit_union_area_ha) + " ha</strong></div>" +
      "<div><span>Reporting footprint</span><strong>" + number(summary.union_area_ha) + " ha</strong></div>" +
      "<div><span>Reporting overlap removed</span><strong>" + number(summary.overlap_area_ha) + " ha</strong></div>" +
      "<div><span>Recorded cost</span><strong>" + (finite(summary.cost_total) ?
        number(summary.cost_total) + " " + h(summary.currency || "") : "Unavailable") + "</strong></div></div>" +
      '<dl class="cons-definitions"><dt>Source-water overlap</dt><dd>' + number(summary.source_water_area_ha) +
      " ha</dd><dt>Protected overlap</dt><dd>" + number(summary.protected_area_ha) + " ha</dd>" +
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
      '<div class="cons-actions">' + button("new-scenario", "Create land-cover scenario", "", memory().busy) +
      button("edit-selection", "Use these units in a new portfolio",
        'data-plan-id="' + h(plan.id) + '"') + "</div></section>";
  }
  function overviewView() {
    const ui = memory(), overview = ui.overview || {};
    const studies = Array.isArray(overview.studies) ? overview.studies : [];
    const plans = Array.isArray(overview.plans) ? overview.plans : [];
    return '<section class="cons-overview"><h2>Retained studies</h2>' +
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
        "<p>Saved portfolios will appear here with their original study and selection.</p>") + "</section>";
  }
  function content() {
    const ui = memory(), study = ui.study;
    const mode = study?.mode || study?.spec?.mode;
    const selected = ui.detailId && candidates().find(candidate => String(candidate.id) === ui.detailId);
    return '<header class="cons-header"><div><h1>Conservation planning</h1><p>' +
      "Use retained planning units, source context and native model quantities to build a reproducible portfolio." +
      '</p></div><div class="cons-actions">' +
      button("new-study", "New study", "", ui.busy) +
      button("refresh", "Refresh records", "", ui.overviewLoading || ui.busy) + "</div></header>" +
      (ui.notice ? '<div class="cons-notice' + (ui.notice.kind === "error" ? " cons-error" : "") +
        '" role="' + (ui.notice.kind === "error" ? "alert" : "status") + '">' +
        h(ui.notice.message) + "</div>" : "") +
      (ui.form === "study" ? studyForm() : "") +
      (study ? '<section class="cons-study"><div class="cons-section-title"><div><h2>' +
        h(study.title || study.spec?.title || study.id) + '</h2><p class="cons-metric-note">' +
        h(study.id) + " · " + h(human(study.state || "")) + "</p></div><div class=\"cons-actions\">" +
        button("new-portfolio", "Create portfolio", "", ui.busy || !candidates().length) +
        button("export-study", "Export candidate inventory", 'data-study-id="' + h(study.id) + '"', ui.busy) +
        (study.state !== "complete" ? button("build-study", "Build this inventory",
          'data-study-id="' + h(study.id) + '"', ui.busy) : "") +
        button("close-study", "Back to all records", "", ui.busy) + "</div></div>" +
        '<p class="cons-mode">' + (mode === "source_context" ?
          "Source geometry and context: areas and mapped overlaps are available. A new study can bind a native baseline to add annual pollutant quantities." :
          "Native model quantities: pollutant units, valid coverage and alternative differences remain visible for each planning unit.") +
        "</p>" + (study.error ? '<div class="cons-notice cons-error" role="alert">' +
          h(typeof study.error === "string" ? study.error : study.error.message || JSON.stringify(study.error)) +
          "</div>" : "") + studyLineage(study) +
        (ui.plan ? portfolioView(ui.plan) : "") +
        (ui.form === "portfolio" ? portfolioForm() : "") +
        (ui.form === "scenario" ? scenarioForm() : "") +
        (selected ? candidateDetail(selected) : "") +
        candidateTable() + "</section>" : overviewView());
  }

  function scenarioForm() {
    const ui = memory();
    ui.scenario ||= { title: "", reason: "", from_codes: "", to_code: "",
      prepare_run: false, grid_id: "", profile_id: "" };
    const d = ui.scenario;
    const data = getState?.()?.data || ui.overview?.available || {};
    const choices = (rows, noun) => [["", "Choose an existing " + noun], ...(rows || []).map(row =>
      [row.id, (row.title || row.spec?.title || row.id) + " · " + row.id])];
    return '<form class="cons-editor" data-cons-form="scenario"><div class="cons-section-title">' +
      "<h2>Create land-cover scenario</h2>" + button("close-form", "Close") + "</div>" +
      "<p>Apply an explicit land-cover change inside the saved portfolio's unique selected footprint. " +
      "The new scenario becomes available in the existing modeling workflow.</p>" +
      '<div class="cons-grid">' +
      input("scenario.title", "Scenario title", d.title, 'required autocomplete="off"') +
      input("scenario.reason", "Purpose of this land-cover change", d.reason, 'required') +
      input("scenario.from_codes", "Source land-cover codes (comma-separated)", d.from_codes, 'required') +
      input("scenario.to_code", "Destination land-cover code", d.to_code, 'type="number" min="0" step="1" required') +
      "</div>" +
      check("scenario.prepare_run", "Also prepare a native model run", d.prepare_run) +
      (d.prepare_run ? '<div class="cons-grid">' +
        select("scenario.grid_id", "Existing analysis grid", d.grid_id, choices(data.grids, "grid")) +
        select("scenario.profile_id", "Existing model profile", d.profile_id, choices(data.profiles, "profile")) +
        "</div><p class=\"cons-help\">The prepared run uses the chosen grid and profile. Execute it in Runs " +
        "to measure this selected footprint's model effect.</p>" : "") +
      '<div class="cons-actions">' + button("save-scenario", "Create scenario", "", ui.busy) + "</div></form>";
  }
  function buildScenarioSpec() {
    const ui = memory(), d = ui.scenario;
    if (!ui.plan?.id) throw new Error("Open the saved portfolio whose footprint defines this scenario.");
    if (!d?.title?.trim() || !d.reason?.trim()) throw new Error("Give the scenario a title and purpose.");
    const tokens = d.from_codes.split(/[\s,]+/).filter(Boolean);
    if (!tokens.length || tokens.some(value => !/^\d+$/.test(value))) {
      throw new Error("Source land-cover codes must be comma-separated nonnegative integers.");
    }
    const from = [...new Set(tokens.map(value => numeric(value, "Source land-cover code", { integer: true })))];
    const to = numeric(d.to_code, "Destination land-cover code", { integer: true });
    if (from.every(value => value === to)) throw new Error("Choose a destination that changes at least one source land-cover code.");
    const spec = { plan_id: ui.plan.id, title: d.title.trim(), reason: d.reason.trim(),
      from_codes: from, to_code: to };
    if (d.prepare_run) {
      if (!d.grid_id || !d.profile_id) throw new Error("Choose both an existing analysis grid and model profile.");
      spec.prepare_run = { grid_id: d.grid_id, profile_id: d.profile_id };
    }
    return spec;
  }
  function captureView() {
    if (!mounted || !mounted.isConnected || activeWorkspace !== workspace()) return null;
    const ui = memory();
    ui.openDetails = new Set([...mounted.querySelectorAll("details[open]")].map(node =>
      node.querySelector(":scope > summary")?.textContent?.trim()).filter(Boolean));
    const active = document.activeElement;
    if (!active || !mounted.contains(active)) return null;
    const key = ["data-field", "data-filter", "data-candidate-id"].find(name => active.hasAttribute?.(name));
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
    const target = [...mounted.querySelectorAll("[data-field],[data-filter],[data-candidate-id]")]
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
      node.textContent = node.textContent.replace(/^\d+/, String(ui.selectedIds.size));
    }
    const clear = mounted.querySelector('[data-action="conservation-clear-selection"]');
    if (clear) clear.disabled = !ui.selectedIds.size;
  }
  function changed(event) {
    const target = event.target, ui = memory();
    if (!(target instanceof Element)) return;
    if (target.hasAttribute("data-candidate-id") && event.type === "change") {
      const id = target.getAttribute("data-candidate-id");
      if (target.checked) ui.selectedIds.add(id); else ui.selectedIds.delete(id);
      target.closest("tr")?.classList.toggle("cons-selected", target.checked);
      ui.selectionOrigin = null;
      updateSelectionCount();
      return;
    }
    if (target.hasAttribute("data-alt-id") && event.type === "change") {
      const id = target.getAttribute("data-alt-id");
      const values = new Set(ui.draft.alternative_run_ids);
      if (target.checked) values.add(id); else values.delete(id);
      ui.draft.alternative_run_ids = [...values];
      return;
    }
    const filter = target.getAttribute("data-filter");
    if (filter) {
      ui[filter] = filter === "pageSize" ? Number(target.value) : target.value;
      if (filter !== "displayAlternative") ui.page = 1;
      paint();
      return;
    }
    const name = target.getAttribute("data-field");
    if (!name) return;
    const value = target.type === "checkbox" ? target.checked : target.value;
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
    if (event.type === "change" && name === "mode") {
      ui.draft.score_basis = value === "source_context" ? "context" :
        ui.draft.purpose === "protection" ? "disturbance_increase" : "current_export";
    }
    if (event.type === "change" && name === "purpose" && ui.draft.mode === "native_model") {
      ui.draft.score_basis = value === "protection" ? "disturbance_increase" : "current_export";
    }
    if (event.type === "change" && name === "baseline_run_id") {
      ui.draft.alternative_run_ids = ui.draft.alternative_run_ids.filter(id => id !== value);
      if (ui.draft.score_alternative === value) ui.draft.score_alternative = "";
    }
    if (event.type === "change" && ["mode", "purpose", "score_basis", "baseline_run_id",
      "plan.mode", "scenario.prepare_run"].includes(name) ||
      event.type === "change" && name.endsWith("_source")) paint();
  }
  async function dispatch(node) {
    const action = node?.dataset?.action;
    if (!action?.startsWith("conservation-")) return false;
    const ui = memory(), name = action.slice("conservation-".length);
    try {
      if (!workspace()) throw new Error("Open a workspace before using conservation planning.");
      switch (name) {
        case "new-study":
          ui.form = "study"; ui.notice = null; paint(); break;
        case "close-form":
          ui.form = null; paint(); break;
        case "refresh":
          await refreshOverview(true);
          if (ui.study?.id) await openStudy(ui.study.id, true);
          break;
        case "open-study":
          await openStudy(node.dataset.studyId); break;
        case "open-plan":
          await openPlan(node.dataset.planId); break;
        case "close-study":
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
        case "save-plan":
          await queue("conservation.plan.save", buildPlanSpec()); break;
        case "export-study":
          await queue("conservation.export", { study_id: node.dataset.studyId || ui.study?.id }); break;
        case "export-plan":
          await queue("conservation.export", { study_id: node.dataset.studyId || ui.plan?.study_id,
            plan_id: node.dataset.planId || ui.plan?.id }); break;
        case "select-page":
          for (const candidate of pageRows()) if (candidate.eligible) ui.selectedIds.add(String(candidate.id));
          ui.selectionOrigin = null; paint(); break;
        case "clear-selection":
          ui.selectedIds.clear(); ui.selectionOrigin = null; paint(); break;
        case "previous-page":
          ui.page = Math.max(1, ui.page - 1); paint(); break;
        case "next-page":
          ui.page += 1; paint(); break;
        case "candidate":
          ui.detailId = node.dataset.candidate; paint(); break;
        case "close-detail":
          ui.detailId = null; paint(); break;
        case "edit-selection":
          if (!ui.plan) throw new Error("Open a saved portfolio first.");
          ui.selectedIds = new Set((ui.plan.selected_ids || []).map(String));
          ui.selectionOrigin = ui.plan.id;
          ui.portfolio = { ...freshPortfolio(), title: (ui.plan.title || "Portfolio") + " revision",
            objective: ui.study?.mode === "source_context" ? "area" : "score" };
          ui.form = "portfolio"; paint(); break;
        case "new-scenario":
          if (!ui.plan) throw new Error("Open a saved portfolio first.");
          ui.form = "scenario"; paint(); break;
        case "save-scenario":
          await queue("conservation.scenario.create", buildScenarioSpec()); break;
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
    const studyId = meta.study_id || result.study_id ||
      (["conservation.prepare", "conservation.build"].includes(task.action) ? result.id : null);
    const planId = meta.plan_id ||
      (task.action === "conservation.plan.save" ? result.id : result.plan_id);
    const scenarioId = result.scenario_id || result.scenario?.id;
    const runId = result.run_id || result.run?.id;
    const nativeButtons = (scenarioId ? '<button type="button" data-action="item" data-kind="scenarios" data-id="' +
      h(scenarioId) + '">Open land-cover scenario</button>' : "") +
      (runId ? '<button type="button" data-action="item" data-kind="runs" data-id="' +
      h(runId) + '">Open native run</button>' : "");
    return nativeButtons + (studyId ? button("open-study", "Open conservation study", 'data-study-id="' + h(studyId) + '"') : "") +
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
        const name = form.dataset.consForm === "portfolio" ? "save-plan" :
          form.dataset.consForm === "scenario" ? "save-scenario" : "submit-study";
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
  return { render, mount, detach, dispatch, taskActions };
}
