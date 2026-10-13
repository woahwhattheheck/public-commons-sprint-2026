/** Readable retained Keowee method results inside the existing Conservation desk.
 * Pure presentation: no scoring, source acquisition, selection or model mutation.
 */
const CLASS_SCHEMA = "upstate.keowee-classification/v1";
const OBSERVATION_SCHEMA = "upstate.keowee-observations/v1";
const METHOD_URI = "https://www.des.sc.gov/sites/des/files/media/document/WBP_for_Lake_Keowee_Watersheds_2020.pdf";
const finite = value => typeof value === "number" && Number.isFinite(value);
const escape = value => String(value ?? "").replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const human = value => String(value ?? "").replace(/[_-]+/g, " ");
const label = value => {
  const text = human(value);
  return text ? text[0].toUpperCase() + text.slice(1) : "";
};
const scalar = value => {
  if (value === null || value === undefined || value === "") return "Unresolved";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map(scalar).join(", ") : "None observed";
  if (typeof value === "object") return "Structured source value";
  return String(value);
};
const units = {
  acre: "acres", hectare: "hectares", metre: "metres", mile: "miles", foot: "feet",
  "kg/pixel/year": "kg per pixel per year", "tons/pixel/year": "tons per pixel per year",
  "kg/ha/year": "kg per hectare per year", "tonnes/ha/year": "metric tonnes per hectare per year",
  dimensionless_index: "dimensionless index", fraction: "fraction", year: "year",
};
function unitLabel(unit) { return units[unit] || String(unit || ""); }
function safeLink(uri, text) {
  try {
    const url = new URL(uri);
    if (["http:", "https:"].includes(url.protocol)) {
      return '<a href="' + escape(url.href) + '" target="_blank" rel="noopener noreferrer">' +
        escape(text || uri) + "</a>";
    }
  } catch (_) { /* Local references remain visible as text. */ }
  return escape(text || uri || "Reference not recorded");
}
function note(text) {
  return text ? '<span class="cons-metric-note">' + escape(text) + "</span>" : "";
}
function isClassification(value) {
  return value && typeof value === "object" && value.schema === CLASS_SCHEMA;
}
function uniquePoints(value) {
  if (!Array.isArray(value) || !value.length || value.some(item => !finite(item))) return null;
  return [...new Set(value)].sort((left, right) => left - right);
}
/** Compress only consecutive integer runs; never fill a gap in attained points. */
export function formatPointAlternatives(value) {
  const points = uniquePoints(value);
  if (!points) return "";
  const ranges = [];
  for (let start = 0; start < points.length;) {
    let end = start;
    while (end + 1 < points.length && Number.isInteger(points[end]) &&
           Number.isInteger(points[end + 1]) && points[end + 1] === points[end] + 1) end += 1;
    if (end - start >= 2) ranges.push(String(points[start]) + "–" + String(points[end]));
    else for (let index = start; index <= end; index += 1) ranges.push(String(points[index]));
    start = end + 1;
  }
  return ranges.join(", ");
}
function classificationDetail(value) {
  const matched = Array.isArray(value.matched_classes) ? value.matched_classes : [];
  const labels = matched.map(label).join(", ");
  const alternatives = formatPointAlternatives(value.score_options);
  const explanation = {
    scored: labels ? "Published class: " + labels : "Published interval matched",
    ambiguous: "Overlapping printed intervals" + (labels ? ": " + labels : ""),
    unclassified: "Value falls in a printed gap or outside the published intervals",
    missing: "The original input is unobserved",
    bounded_interval: "Original published bins evaluated across the retained acreage interval",
  }[value.state] || "Retained source classification";
  const attainableStates = Array.isArray(value.attainable_states) ?
    [...new Set(value.attainable_states)].map(state => ({
      scored:"published interval matched", ambiguous:"printed intervals overlap",
      unclassified:"printed gap or value outside the published intervals", missing:"input unobserved",
    }[state] || human(state))) : [];
  return note(explanation) + (attainableStates.length ?
    note("Attainable classification states: " + attainableStates.join("; ")) : "") +
    (alternatives && value.state !== "scored" ? note("Attainable points: " + alternatives) : "");
}
function intervalMarkup(bound) {
  if (!bound || !finite(bound.lower) || !finite(bound.upper)) return "";
  const text = bound.lower === bound.upper ? String(bound.lower) :
    "[" + String(bound.lower) + ", " + String(bound.upper) + "]";
  const basis = bound.area_basis ? " · " + human(bound.area_basis) : "";
  return escape(text) + " " + escape(unitLabel(bound.unit || "acres")) +
    note((bound.exact ? "Exact observed acreage" : bound.structural_only ?
      "Original parcel area bounds this unresolved criterion" :
      "Closed acreage bounds from observed positive area and unresolved area") + basis);
}
/** Render exact observed numbers rather than rounding away interval boundaries. */
export function renderMethodValue(value, unit = null) {
  if (isClassification(value)) {
    const interval = intervalMarkup(value.value_interval);
    const raw = escape(scalar(value.value));
    const suffix = value.value === null || value.value === undefined ? "" : " " + escape(unitLabel(value.unit));
    return (interval || raw + suffix) + classificationDetail(value);
  }
  const text = escape(scalar(value));
  const suffix = value === null || value === undefined || value === "" || !unit ? "" : " " + escape(unitLabel(unit));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return '<details><summary>' + text + "</summary><pre>" +
      escape(JSON.stringify(value, null, 2)) + "</pre></details>";
  }
  return text + suffix;
}
function referenceMarkup(reference, originalReference) {
  if (!reference) return "Reference not recorded";
  if (typeof reference === "string") return safeLink(reference);
  const pages = Array.isArray(reference.printed_pages) ? reference.printed_pages :
    reference.printed_page !== undefined ? [reference.printed_page] : [];
  if (!pages.length && originalReference && !reference.source_id) return originalReference(reference);
  const title = [
    reference.table ? "Table " + reference.table : "",
    pages.length ? (pages.length === 1 ? "Printed page " : "Printed pages ") + pages.join(", ") : "",
    reference.edition ? String(reference.edition) : "",
  ].filter(Boolean).join(" · ") || "Original method reference";
  const uri = reference.source_uri || reference.uri ||
    (reference.source_id === "keowee-wbp-2020" ? METHOD_URI : null);
  return (uri ? safeLink(uri, title) : escape(title)) + note(reference.detail);
}
function referencesMarkup(item, originalReference) {
  const classification = item.classification || (isClassification(item.value) ? item.value : null);
  const references = classification?.references;
  return Array.isArray(references) && references.length ?
    references.map(value => referenceMarkup(value, originalReference)).join("<br>") :
    referenceMarkup(item.reference, originalReference);
}
function pointMarkup(item, formatNumber) {
  if (finite(item.points)) return escape(formatNumber(item.points));
  const options = formatPointAlternatives(item.score_options || item.classification?.score_options);
  if (options) return escape(options) + note("Attainable contributions; unlisted intermediate values are not implied");
  return escape(formatNumber(item.known_points)) + "–" + escape(formatNumber(item.possible_points)) +
    note("Known–possible bounds");
}
function sourceRecord(binding) {
  if (!binding || typeof binding !== "object") return "";
  const fields = Array.isArray(binding.original_fields) ? binding.original_fields :
    binding.field ? [binding.field] : [];
  const parts = [];
  if (fields.length) parts.push(fields.map(field => "<code>" + escape(field) + "</code>").join(", "));
  if (binding.source_uri || binding.uri) parts.push(safeLink(binding.source_uri || binding.uri, "Original source"));
  if (binding.source_entry_id || binding.source_id) {
    parts.push(escape(binding.source_entry_id || binding.source_id));
  }
  if (binding.kind && binding.kind !== "unbound") parts.push(escape(label(binding.kind)));
  return parts.join("<br>");
}
function conversionText(conversion) {
  if (!conversion || typeof conversion !== "object") return "";
  const operation = finite(conversion.divisor) ? "divide by " + String(conversion.divisor) :
    finite(conversion.factor) ? "multiply by " + String(conversion.factor) : "";
  return [
    conversion.from && conversion.to ? unitLabel(conversion.from) + " to " + unitLabel(conversion.to) : "",
    operation,
  ].filter(Boolean).join("; ");
}
function evidenceDetails(observation) {
  const evidence = observation.source_evidence || {};
  const binding = observation.source_binding || {};
  const fields = Array.isArray(observation.original_fields) ? observation.original_fields : [];
  const featureIds = observation.feature_ids || evidence.feature_ids;
  const lines = [];
  if (observation.method) lines.push(["Method", escape(observation.method)]);
  if (fields.length) lines.push(["Original fields", fields.map(field => "<code>" + escape(field) + "</code>").join(", ")]);
  if (Object.hasOwn(observation, "original_value")) {
    lines.push(["Original scalar", renderMethodValue(observation.original_value)]);
  }
  if (observation.conversion) lines.push(["Unit conversion", escape(conversionText(observation.conversion))]);
  const providerValues = observation.source_class_values || observation.original_values;
  if (providerValues) lines.push(["Original class values", renderMethodValue(providerValues)]);
  if (observation.provider_adapter) lines.push(["Provider adaptation", escape(human(observation.provider_adapter))]);
  if (Array.isArray(observation.changes) && observation.changes.length) {
    lines.push(["Original → method class", observation.changes.map(change =>
      escape(scalar(change.source)) + " → " + escape(scalar(change.target))).join("; ")]);
  }
  if (observation.source_class_scope) {
    lines.push(["Captured classification scope", renderMethodValue(observation.source_class_scope)]);
  }
  const source = sourceRecord({ ...evidence, ...binding, ...observation });
  if (source) lines.push(["Retained source", source]);
  const collection = observation.source_collection_id || binding.source_collection_id || evidence.source_collection_id;
  if (collection) lines.push(["Source collection", escape(collection)]);
  if (Array.isArray(featureIds)) {
    lines.push(["Original features", featureIds.length ?
      escape(featureIds.map(String).join(", ")) : "None intersect the selected source geometry"]);
  }
  if (Object.hasOwn(evidence, "coverage_contains_analysis_geometry")) {
    lines.push(["Source covers analysis geometry", escape(scalar(evidence.coverage_contains_analysis_geometry))]);
  }
  const transfer = observation.unit_interpretation || observation.profile_transfer || binding.profile_transfer;
  if (transfer && typeof transfer === "object") {
    if (finite(transfer.pixel_area_m2)) lines.push(["Current native pixel area", escape(String(transfer.pixel_area_m2)) + " m²"]);
    if (transfer.reference) lines.push(["Current-grid interpretation", escape(transfer.reference)]);
    if (transfer.sediment_ton_definition) lines.push(["Native sediment unit", escape(human(transfer.sediment_ton_definition))]);
    if (Object.hasOwn(transfer, "original_raster_pixel_area_m2")) {
      lines.push(["Original profile pixel area", finite(transfer.original_raster_pixel_area_m2) ?
        escape(String(transfer.original_raster_pixel_area_m2)) + " m²" : "Not recorded in the original source profile"]);
    }
    if (transfer.native_unit || transfer.profile_unit) lines.push(["Native → profile units",
      escape(unitLabel(transfer.native_unit)) + " → " + escape(unitLabel(transfer.profile_unit))]);
  }
  if (!lines.length) return "";
  return '<details><summary>Source inputs</summary><dl class="cons-definitions">' +
    lines.map(([term, value]) => "<dt>" + escape(term) + "</dt><dd>" + value + "</dd>").join("") +
    "</dl></details>";
}
function observationsMarkup(score) {
  const bundle = score.profile_observations;
  if (!bundle || bundle.schema !== OBSERVATION_SCHEMA ||
      !bundle.observations || typeof bundle.observations !== "object") return "";
  const rows = Object.entries(bundle.observations);
  if (!rows.length) return "";
  return '<details class="cons-disclosure"><summary>Original method observations (' + rows.length + ")</summary>" +
    '<p class="cons-help">Observed values retain their source units, original fields and recorded conversions.</p>' +
    '<div class="cons-table-wrap"><table class="cons-table"><thead><tr>' +
    '<th scope="col">Observation</th><th scope="col">Value and units</th><th scope="col">Original source</th>' +
    "</tr></thead><tbody>" + rows.map(([name, observation]) => {
      const value = observation && typeof observation === "object" ? observation : { value: observation };
      const detail = sourceRecord(value) || sourceRecord(value.source_evidence) || sourceRecord(value.source_binding);
      return '<tr><th scope="row">' + escape(label(name)) + "</th><td>" +
        renderMethodValue(value.value, value.unit) +
        (value.interval ? note("Retained acreage bounds") + intervalMarkup(value.interval) : "") +
        "</td><td>" + detail + evidenceDetails(value) + "</td></tr>";
    }).join("") + "</tbody></table></div></details>";
}
function editionMarkup(score) {
  const profile = score.source_profile;
  if (!profile || typeof profile !== "object") return "";
  return '<details><summary>Method source edition</summary><dl class="cons-definitions">' +
    "<dt>Published method</dt><dd>" + safeLink(METHOD_URI, "Lake Keowee Watershed-Based Plan, 2020") +
    "</dd><dt>Source profile</dt><dd>" + escape(profile.id || "") +
    (profile.version ? " · " + escape(profile.version) : "") +
    "</dd>" + (profile.package_revision ? "<dt>Retained source package</dt><dd>" +
      escape(profile.package_revision) + "</dd>" : "") +
    (profile.sha256 ? "<dt>Retained profile SHA256</dt><dd><code>" + escape(profile.sha256) + "</code></dd>" : "") +
    "</dl></details>";
}
/** Existing point-record shape plus additive profile fields; compatible with v8. */
export function renderKeoweePointCriteria(candidate, {
  formatNumber = value => finite(value) ? String(value) : "—",
  originalReference = null,
} = {}) {
  if (!candidate?.point_score) return "";
  const score = candidate.point_score, bounds = score.metric_bounds || {};
  const rows = (items, nested = false) => items.map(item => {
    const group = Array.isArray(item.terms) && item.terms.length > 0;
    const classification = item.classification || (isClassification(item.value) ? item.value : null);
    let value = group ? "See contributing terms" :
      intervalMarkup(item.value_interval || classification?.value_interval) || renderMethodValue(item.value, classification?.unit);
    if (classification && (!isClassification(item.value) || item.value_interval || classification.value_interval)) {
      value += classificationDetail(classification);
    }
    if (item.points_determined_by_interval) {
      value += note("The retained acreage bounds determine this exact published contribution");
    }
    return '<tr' + (nested ? ' class="cons-criterion-term"' : "") + '><th scope="row">' +
      escape(item.title || item.label || label(item.id || item.metric)) + (group ? note("Combined criterion") : "") +
      "</th><td>" + value + "</td><td>" + pointMarkup(item, formatNumber) +
      "</td><td>" + referencesMarkup(item, originalReference) + "</td></tr>" +
      (group ? rows(item.terms, true) : "");
  }).join("");
  const components = Object.values(candidate.score_components || {}).filter(item =>
    item && typeof item === "object" && (item.id || item.metric));
  const scoreText = finite(score.points) ? escape(formatNumber(score.points)) + " points" :
    score.prerequisite === false ? "Practice prerequisite is absent" :
      "Awaiting complete criteria and a satisfied practice prerequisite";
  const prerequisiteText = score.prerequisite === true ? "Satisfied" :
    score.prerequisite === false ? "Absent in the selected source criteria" : "Unresolved";
  const alternatives = formatPointAlternatives(score.score_options);
  const priorities = Array.isArray(score.priority_options) ? score.priority_options.map(label) : [];
  const totalText = alternatives || String(formatNumber(score.known_points)) + "–" + String(formatNumber(score.possible_points));
  const inputs = [...new Set([...Object.keys(score.metric_values || {}), ...Object.keys(bounds)])]
    .map(name => [name, score.metric_values?.[name]]);
  return '<details class="cons-disclosure"><summary>Published point criteria</summary>' +
    '<dl class="cons-definitions"><dt>Published practice score</dt><dd>' + scoreText +
    "</dd><dt>Practice prerequisite</dt><dd>" + escape(prerequisiteText) +
    "</dd><dt>" + (alternatives ? "Possible point totals" : "Known–possible contribution bounds") + "</dt><dd>" +
    escape(totalText) + " points" + (alternatives ?
      note("Unlisted intermediate totals are not implied. Combinations across unresolved criteria remain conservative; correlations between missing observations are not inferred.") : "") +
    "</dd><dt>Category maximum</dt><dd>" +
    escape(formatNumber(score.maximum)) + " points</dd>" +
    (priorities.length && score.prerequisite !== false ?
      "<dt>" + (finite(score.points) ? "Published priority" : "Potential priorities") + "</dt><dd>" +
      escape(priorities.join(", ")) +
      (score.prerequisite === null || score.prerequisite === undefined ?
        note("Practice eligibility remains unresolved") : "") + "</dd>" : "") +
    "</dl>" + (components.length ?
      '<div class="cons-table-wrap"><table class="cons-table"><thead><tr>' +
      '<th scope="col">Criterion</th><th scope="col">Original value or acreage range</th><th scope="col">Points</th>' +
      '<th scope="col">Published reference</th></tr></thead><tbody>' +
      rows(components) + "</tbody></table></div>" : "") +
    (inputs.length ? '<details><summary>Complete retained input values</summary><div class="cons-table-wrap">' +
      '<table class="cons-table"><thead><tr><th scope="col">Input</th><th scope="col">Value</th>' +
      '<th scope="col">Observed acreage bounds</th><th scope="col">Original source field</th></tr></thead><tbody>' +
      inputs.map(([name, value]) => '<tr><th scope="row">' + escape(label(name)) +
        "</th><td>" + renderMethodValue(value) + "</td><td>" +
        (intervalMarkup(bounds[name]) || "—") + "</td><td>" +
        sourceRecord(score.metric_sources?.[name]) +
        evidenceDetails(score.metric_sources?.[name] || {}) + "</td></tr>").join("") +
      "</tbody></table></div><p class=\"cons-help\">An original acreage interval may determine an exact published " +
      "contribution while its underlying acreage remains bounded. Printed gaps and overlaps remain visible in the attainable values.</p></details>" : "") +
    observationsMarkup(score) + editionMarkup(score) +
    '<details><summary>Complete criterion source references and acreage coverage</summary><pre>' +
    escape(JSON.stringify({ sources:score.metric_sources || {}, acreage_bounds:bounds,
      original_criterion_evidence:score.original_criterion_evidence || null }, null, 2)) +
    "</pre></details></details>";
}
