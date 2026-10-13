/**
 * Source-loading interpretation for the existing actual-geography headwaters case.
 * Consumes retained preparation only; native model results remain in their original
 * ensemble / comparison / joint-support decision services.
 */
export const SCHEMA = "upstate.geographic-scenario-interpretation/v1";
const OWNER = "CURRENT_OWNER_DIRECTION.md v2026-10-13.3";
const NDR = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html";
const SDR = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html";

function fail(message) { throw new Error(message); }
function number(value, name, positive = false) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || (positive && n <= 0))
    fail("Supply finite " + name + (positive ? " greater than zero" : ""));
  return n;
}
function count(value, name) {
  const n = number(value, name);
  if (!Number.isSafeInteger(n) || n < 0) fail(name + " must be a nonnegative safe integer");
  return n;
}
function equal(a, b, name) {
  a = number(a, name + " left"); b = number(b, name + " right");
  if (Math.abs(a - b) > 1e-8 * Math.max(1, Math.abs(a), Math.abs(b))) fail(name + " differs");
}
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function sum(values) {
  let total = 0, correction = 0;
  for (const value of values) {
    const y = value - correction, next = total + y;
    correction = (next - total) - y;
    total = next;
  }
  return total;
}
function coefficient(row, pollutant) {
  let value = number(row["load_" + pollutant], "load_" + pollutant);
  if (value < 0) fail("Nutrient loading coefficients must be nonnegative");
  const kind = row["load_type_" + pollutant];
  if (kind === "application-rate") {
    const efficiency = number(row["eff_" + pollutant], "eff_" + pollutant);
    if (efficiency < 0 || efficiency > 1) fail("Retention efficiency must be in [0,1]");
    value *= 1 - efficiency;
  } else if (kind !== "measured-runoff") {
    fail("Retain an explicit native load_type_" + pollutant);
  }
  return value;
}
function hucs(value, name) {
  if (!Array.isArray(value) || value.some(x => !/^\d{12}$/.test(x)) ||
      new Set(value).size !== value.length) fail("Retain distinct original " + name);
  return [...value].sort();
}
export function parseCsv(text) {
  const rows = []; let row = [], field = "", quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') {
      if (field) fail("Unexpected CSV quote"); quoted = true;
    } else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i+1] === "\n") i++;
      row.push(field); if (row.some(x => x !== "")) rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (quoted) fail("Unclosed CSV quote");
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) fail("Empty coefficient CSV");
  const header = rows.shift();
  if (new Set(header).size !== header.length) fail("Duplicate CSV columns");
  return rows.map((values, i) => {
    if (values.length !== header.length) fail("CSV column mismatch at record " + (i+2));
    return Object.fromEntries(header.map((key, j) => [key, values[j]]));
  });
}
function csv(columns, rows) {
  const cell = value => {
    const text = value == null ? "" : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  };
  return [columns, ...rows.map(row => columns.map(key => row[key]))].map(row => row.map(cell).join(",")).join("\n") + "\n";
}

export function interpretGeographicScenario({prepared, matching, coefficients, sourceIdentities = []}) {
  if (prepared?.schema !== "upstate.geographic-headwaters-prepared/v1")
    fail("Select the existing geographic-headwaters prepared record");
  if (matching?.schema !== "upstate.regional-matched-control-summary/v1")
    fail("Select its complete regional matched-control summary");
  const geo = prepared.geography, summary = prepared.input_summary;
  if (canonical(summary?.control?.preparation?.summary) !== canonical(matching))
    fail("Matching summary is not the original preparation embedded in this geographic edition");
  if (!geo || !summary || !prepared.id || !prepared.project_id) fail("Incomplete original geographic preparation");
  const modelIds = hucs(geo.model_domain_huc12s, "model-domain HUC12s");
  const reportIds = hucs(geo.reporting_huc12s, "reporting HUC12s");
  if (reportIds.some(id => !modelIds.includes(id))) fail("Reporting HUCs are outside the prepared model domain");
  const area = number(matching.grid?.pixel_area_ha, "original grid pixel_area_ha", true);
  equal(area, number(geo.grid?.pixel_area_ha, "geographic grid pixel_area_ha", true), "Pixel area");
  if (matching.grid.crs !== geo.grid.crs) fail("Original geographic and control CRS differ");
  if (JSON.stringify(matching.grid.transform) !== JSON.stringify(geo.grid.transform) ||
      matching.grid.width !== geo.grid.width || matching.grid.height !== geo.grid.height)
    fail("Original geographic and control raster grids differ");
  const changed = count(matching.changed_cells, "changed_cells");
  equal(changed, count(summary.changed_cells, "geographic changed_cells"), "Changed cell count");
  equal(matching.changed_area_ha, changed * area, "Changed area");
  equal(summary.changed_hectares, changed * area, "Geographic changed area");
  if (matching.overlap_with_restoration_corridor_cells !== 0) fail("Control overlaps the retained complete corridor");
  const meanRain = number(matching.selected_domain_precipitation_mean_mm_year, "selected-domain precipitation mean", true);
  const table = new Map();
  for (const row of coefficients) {
    const code = count(row.lucode, "lucode");
    if (table.has(code)) fail("Duplicate biophysical class " + code);
    table.set(code, row);
  }
  const byClass = matching.by_original_class;
  if (!Array.isArray(byClass) || !byClass.length) fail("Retain every matching class summary");
  const seen = new Set(), rows = [];
  for (const group of byClass) {
    const from = count(group.from_code, "from_code"), to = count(group.to_code, "to_code");
    if (seen.has(from)) fail("Duplicate matching class"); seen.add(from);
    const n = count(group.target_cells, "target_cells");
    if (count(group.control_cells, "control_cells") !== n) fail("Matched class counts differ");
    const expected = summary.restoration_original_class_counts?.[String(from)];
    if (expected == null || count(expected, "restoration original class count") !== n)
      fail("Original treatment class differs from control summary");
    const before = table.get(from), after = table.get(to);
    if (!before || !after) fail("Original biophysical class is absent");
    const targetRain = number(group.target_precipitation_sum_mm_year, "target precipitation sum");
    const controlRain = number(group.control_precipitation_sum_mm_year, "control precipitation sum");
    const residual = number(group.precipitation_sum_residual_mm_year, "paired precipitation residual");
    const absoluteResidual = number(group.sum_absolute_paired_precipitation_residual_mm_year, "absolute paired precipitation residual");
    if (targetRain < 0 || controlRain < 0 || absoluteResidual < 0) fail("Negative precipitation aggregate");
    equal(residual, controlRain - targetRain, "Paired precipitation aggregate");
    if (Math.abs(residual) > absoluteResidual + 1e-7 * Math.max(1, absoluteResidual))
      fail("Paired absolute residual cannot be smaller than its signed sum");
    for (const pollutant of ["n", "p"]) {
      const beforeCoefficient = coefficient(before, pollutant), afterCoefficient = coefficient(after, pollutant);
      const change = beforeCoefficient - afterCoefficient;
      const target = area * change * targetRain / meanRain;
      const control = area * change * controlRain / meanRain;
      rows.push({
        pollutant: pollutant === "n" ? "Nitrogen" : "Phosphorus",
        units: "kg/year", from_code: from, to_code: to, cells_each: n,
        treated_hectares_each: n * area,
        before_load_type: before["load_type_" + pollutant],
        after_load_type: after["load_type_" + pollutant],
        before_effective_coefficient_kg_ha_year: beforeCoefficient,
        after_effective_coefficient_kg_ha_year: afterCoefficient,
        unweighted_source_reduction_each_kg_year: n * area * change,
        corridor_precipitation_sum_mm_year: targetRain,
        control_precipitation_sum_mm_year: controlRain,
        selected_domain_mean_precipitation_mm_year: meanRain,
        corridor_proxy_weighted_source_reduction_kg_year: target,
        control_proxy_weighted_source_reduction_kg_year: control,
        corridor_minus_control_source_reduction_kg_year: target - control,
        absolute_paired_residual_bound_kg_year: area * Math.abs(change) * absoluteResidual / meanRain,
        quantity_kind: "assumed_source_loading_reduction_on_preparation_support"
      });
    }
  }
  if (sum(byClass.map(x => x.target_cells)) !== changed) fail("Class rows do not cover all changed cells");
  const totals = ["Nitrogen", "Phosphorus"].map(pollutant => {
    const selected = rows.filter(row => row.pollutant === pollutant);
    const names = ["unweighted_source_reduction_each_kg_year",
      "corridor_proxy_weighted_source_reduction_kg_year", "control_proxy_weighted_source_reduction_kg_year",
      "corridor_minus_control_source_reduction_kg_year", "absolute_paired_residual_bound_kg_year"];
    return {pollutant, units: "kg/year", ...Object.fromEntries(names.map(name => [name, sum(selected.map(row => row[name]))]))};
  });
  const width = number(prepared.selection.corridor_width_m, "corridor per-side buffer distance", true);
  const report = {
    schema: SCHEMA, geographic_preparation_id: prepared.id, project_id: prepared.project_id,
    ensemble_id: prepared.ensemble_id,
    original_run_selection: {baseline: prepared.baseline_run_id, alternatives: prepared.alternative_run_ids},
    input_source_collection_id: prepared.source_collection_id, grid_id: prepared.grid_id,
    classification: prepared.classification, owner_direction: OWNER,
    source_identities: sourceIdentities, matching_method: matching.method,
    support: {
      model_domain_huc12s: modelIds, reporting_huc12s: reportIds,
      selected_upstream_huc12s: hucs(geo.upstream_huc12s, "additional upstream HUC12s"),
      original_vector_areas_ha: geo.areas_ha,
      domain_cells: summary.domain_cells, reporting_cells: summary.reporting_cells,
      original_raster_areas_ha: {domain: summary.domain_cells * area, reporting: summary.reporting_cells * area},
      changed_cells_each: changed, changed_hectares_each: changed * area,
      pixel_area_ha: area, corridor_buffer_distance_each_side_m: width,
      approximate_full_corridor_width_m: width * 2,
      normalization: {
        value_mm_year: meanRain,
        support: matching.normalization_scope,
        quantity_basis: "Original preparation support and its retained precipitation mean",
        native_comparison: "Use the native run's actual runoff normalization and common finite output support for native stream-load comparisons."
      },
      utility_source_selections: prepared.selection.utility_focus,
      utility_bindings: geo.utility_sources,
      interpretation: "Utility protection polygons, four original focus HUCs and complete utility upstream HUC groups have separate source identities. Reported source-cell export inside a polygon describes those contributing cells."
    },
    class_source_loading: rows, total_source_loading: totals,
    scenario_interpretation: [
      "Both alternatives convert the same number of cells in each original class to the selected destination class. Their unweighted assumed nutrient-source coefficient reduction is identical.",
      "The class-specific precipitation sums quantify their remaining runoff-proxy source-loading difference. The signed corridor-minus-control quantity is positive when the corridor reduces more assumed source loading.",
      "These source-loading quantities precede modeled delivery. Native export reduction also responds to downslope retention and connectivity; use the original baseline/restoration/control common-finite comparisons for annual stream-delivered loads.",
      "Equal class area and precipitation matching do not match erosivity, erodibility, slope-length, distance to the native stream or contributing area. Sediment differences combine altered erosion generation and delivery.",
      "The planting corridor is buffered around the declared hypothetical valley. Read actual native stream alignment from the completed model rather than interpreting that buffer as observed hydrography.",
      "For each unchanged native profile, compare baseline minus restoration and baseline minus control on the same common support. Their difference equals control minus restoration; per-treated-hectare division uses the actual changed area.",
      "Keep reporting-area, utility protection-polygon and full upstream-group totals separately named. A spatial sum of hillslope-to-stream contributions does not add channel/lake routing or a drinking-water intake concentration.",
      "Routing/Lmax parameter choices retain the original support-group decision editions. Their spread describes these selected parameter choices."
    ],
    references: [NDR, SDR]
  };
  return report;
}
export function reportSection(report) {
  const f = value => typeof value === "number" ? value.toLocaleString("en-US", {maximumFractionDigits: 6}) : String(value ?? "");
  return ["Geographic restoration and matched control: source loading and spatial support", [
    "The original geographic preparation " + report.geographic_preparation_id + " retains model domain, South Carolina reporting intersection and selected utility protection geometries. The physical fields and source coefficients are the declared simulated edition.",
    {kind: "table", columns: ["Support", "Retained quantity"], rows: [
      ["Model-domain original HUC12 units", f(report.support.model_domain_huc12s.length)],
      ["Selected reporting HUC12 units before boundary intersection", f(report.support.reporting_huc12s.length)],
      ["Additional upstream HUC12 units", f(report.support.selected_upstream_huc12s.length)],
      ["Changed area in each alternative (ha)", f(report.support.changed_hectares_each)],
      ["Hypothetical corridor buffer on each side (m)", f(report.support.corridor_buffer_distance_each_side_m)],
      ["Approximate full corridor width (m)", f(report.support.approximate_full_corridor_width_m)]
    ], widths: [0.67, 0.33]},
    "The following values are assumed source-loading reductions on the original preparation support, in kg/year. Native stream-delivered reductions remain in the original completed comparison.",
    {kind: "table", columns: ["Nutrient", "Unweighted, each", "Corridor, proxy weighted", "Control, proxy weighted", "Corridor minus control"], rows:
      report.total_source_loading.map(row => [row.pollutant, ...[
        "unweighted_source_reduction_each_kg_year", "corridor_proxy_weighted_source_reduction_kg_year",
        "control_proxy_weighted_source_reduction_kg_year", "corridor_minus_control_source_reduction_kg_year"
      ].map(key => f(row[key]))]), widths: [.14,.20,.23,.23,.20]},
    ...report.scenario_interpretation
  ]];
}
export async function writeEdition({preparedPath, matchingPath, coefficientPath, receiptPath, outputDirectory}) {
  const fs = await import("node:fs/promises"), path = await import("node:path"), crypto = await import("node:crypto");
  const descriptors = [], bodies = {};
  for (const [name, filename] of [["geographic-prepared.json", preparedPath],
      ["matching-summary.json", matchingPath], ["biophysical.csv", coefficientPath], ["input-receipt.json", receiptPath]]) {
    const body = await fs.readFile(filename);
    bodies[name] = body;
    descriptors.push({path: "originals/" + name, bytes: body.length,
      sha256: crypto.createHash("sha256").update(body).digest("hex")});
  }
  const prepared = JSON.parse(bodies["geographic-prepared.json"].toString("utf8"));
  const receipt = JSON.parse(bodies["input-receipt.json"].toString("utf8"));
  if (receipt.identity?.id !== prepared.id || canonical(receipt.input_summary) !== canonical(prepared.input_summary))
    fail("Input receipt differs from the saved geographic preparation");
  const originalTable = receipt.files?.find(item => item.path === "biophysical.csv");
  const actualTable = descriptors.find(item => item.path === "originals/biophysical.csv");
  if (!originalTable || originalTable.sha256 !== actualTable.sha256 || originalTable.bytes !== actualTable.bytes)
    fail("Biophysical CSV differs from the original geographic input receipt");
  const report = interpretGeographicScenario({prepared,
    matching: JSON.parse(bodies["matching-summary.json"].toString("utf8")),
    coefficients: parseCsv(bodies["biophysical.csv"].toString("utf8")), sourceIdentities: descriptors});
  const output = path.resolve(outputDirectory);
  await fs.mkdir(output, {recursive:true});
  const implementation = await fs.readFile(new URL(import.meta.url));
  const files = {
    "interpretation.json": Buffer.from(JSON.stringify(report, null, 2) + "\n"),
    "source-loading-by-class.csv": Buffer.from(csv(Object.keys(report.class_source_loading[0]), report.class_source_loading)),
    "source-loading-totals.csv": Buffer.from(csv(Object.keys(report.total_source_loading[0]), report.total_source_loading)),
    "geographic_scenario_interpretation.mjs": implementation,
    ...Object.fromEntries(Object.entries(bodies).map(([name, body]) => ["originals/" + name, body]))
  };
  const describe = (name, body) => ({path:name, bytes:body.length, sha256:crypto.createHash("sha256").update(body).digest("hex")});
  const inputs = Object.entries(files).map(([name, body]) => describe(name, body));
  const recipe = {schema:"upstate.observed-report/v1", title:"Original geographic scenario: source-loading interpretation",
    edition:prepared.id, vintage:"2026-10-13", interpretation_kind:"modeled_scenario_source_context",
    inputs, sections:[reportSection(report)], source_links:inputs.map(x => x.path)};
  files["observed-report.json"] = Buffer.from(JSON.stringify(recipe, null, 2) + "\n");
  const key = crypto.createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
  const tableId = "geographic-scenario-source-loading-" + key;
  const manifest = {schema:"upstate.sources/v1", title:recipe.title,
    notes:report.scenario_interpretation, scope:{geographic_preparation_id:prepared.id, ensemble_id:prepared.ensemble_id},
    entries:[
      {id:tableId, title:"Source-loading reductions by original class", kind:"table", role:"SCENARIO_SOURCE_LOADING",
        ...describe("source-loading-by-class.csv", files["source-loading-by-class.csv"]),
        uri:"urn:upstate:geographic-scenario-interpretation:"+key, vintage:"2026-10-13",
        companions:inputs.filter(x => x.path !== "source-loading-by-class.csv")},
      {id:"geographic-scenario-source-report-"+key, title:recipe.title, kind:"document", role:"OBSERVED_CONTEXT",
        ...describe("observed-report.json",files["observed-report.json"]),
        uri:"urn:upstate:geographic-scenario-interpretation:"+key, vintage:"2026-10-13",
        companions:inputs, metadata:{related_source_ids:[tableId], quantity_basis:"modeled_source_loading"}}
    ]};
  files["sources.json"] = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  for (const [name, body] of Object.entries(files)) {
    const destination = path.join(output, name);
    await fs.mkdir(path.dirname(destination), {recursive:true});
    try {
      const prior = await fs.readFile(destination);
      if (!prior.equals(body)) {
        if (name === "sources.json") {
          const old = JSON.parse(prior.toString("utf8"));
          if (JSON.stringify(old.entries) === JSON.stringify(manifest.entries)) continue;
        }
        fail("Existing output differs: " + destination);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.writeFile(destination, body, {flag:"wx"});
    }
  }
  return {schema:SCHEMA, geographic_preparation_id:prepared.id, source_manifest:path.join(output,"sources.json"),
    report:path.join(output,"interpretation.json"), recipe:path.join(output,"observed-report.json"),
    source_rows:report.class_source_loading.length, files:Object.entries(files).map(([name,body])=>describe(name,body))};
}
async function cli() {
  const args = process.argv.slice(2), options = {};
  for (let i=0; i<args.length; i+=2) {
    if (!["--prepared","--matching-summary","--biophysical","--input-receipt","--output"].includes(args[i]) || !args[i+1])
      fail("Use --prepared FILE --matching-summary FILE --biophysical FILE --input-receipt FILE --output DIRECTORY");
    if (options[args[i]]) fail("Duplicate argument " + args[i]); options[args[i]] = args[i+1];
  }
  if (Object.keys(options).length !== 5) fail("Supply all five source/output arguments");
  console.log(JSON.stringify(await writeEdition({preparedPath:options["--prepared"],
    matchingPath:options["--matching-summary"], coefficientPath:options["--biophysical"],
    receiptPath:options["--input-receipt"], outputDirectory:options["--output"]}),null,2));
}
if (typeof process !== "undefined" && process.argv?.[1] &&
    import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href)
  await cli();
