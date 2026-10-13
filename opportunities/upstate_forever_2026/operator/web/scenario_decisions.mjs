/**
 * Scenario decision workbench. No runtime dependencies.
 * Compares retained physical outputs; it does not run or calibrate a model.
 * See SCENARIO_DECISIONS.md for the adapter contract.
 */
export const VERSION = "1.1.1";
export const DEFAULT_METRICS = Object.freeze([
  Object.freeze({id:"nitrogen_export",label:"Nitrogen export",unit:"kg/year",nonnegative:true}),
  Object.freeze({id:"phosphorus_export",label:"Phosphorus export",unit:"kg/year",nonnegative:true}),
  Object.freeze({id:"sediment_export",label:"Sediment export",unit:"metric_tonnes/year",nonnegative:true})
]);
const list = v => Array.isArray(v) ? v : [];
const identifier = v => typeof v === "string" ? v.trim() : (typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const finite = v => typeof v === "number" && Number.isFinite(v);
const unique = values => Array.from(new Set(values));
const directionValid = v => v === "minimize" || v === "maximize";
const own = (object,key) => Object.prototype.hasOwnProperty.call(object || {},key);
const clone = v => JSON.parse(JSON.stringify(v));
const numeric = v => finite(v) ? v : null;
const PAGE_SIZES = Object.freeze([25,50,100,250]);
const numberFormatter = new Intl.NumberFormat(undefined,{maximumSignificantDigits:7});
const selected = (supplied,available) => Array.isArray(supplied) ? unique(supplied.map(identifier)).filter(id => available.includes(id)) : available.slice();

function normalizeDataset(input) {
  const data = input && typeof input === "object" ? input : {};
  const issues = [];
  const metricIds = new Set();
  const metrics = [];
  const sourceMetrics = Array.isArray(data.metrics) ? data.metrics : DEFAULT_METRICS;
  sourceMetrics.forEach((raw,index) => {
    const item = raw && typeof raw === "object" ? raw : {};
    const id = identifier(item.id);
    if (!id || metricIds.has(id)) {
      issues.push("Metric record " + (index + 1) + " has a missing or duplicate id and was excluded.");
      return;
    }
    metricIds.add(id);
    metrics.push({id,label:identifier(item.label) || id,unit:identifier(item.unit),nonnegative:item.nonnegative === true});
  });
  const alternativeIds = new Set();
  const alternatives = list(data.alternatives).map((raw,index) => {
    const source = raw && typeof raw === "object" ? raw : {};
    const sourceId = identifier(source.id);
    let id = sourceId || "__record_" + (index + 1);
    const recordIssues = [];
    if (!sourceId) recordIssues.push("Alternative id is missing.");
    if (alternativeIds.has(id)) {
      recordIssues.push("Duplicate alternative id: " + id + ".");
      id += "__duplicate_record_" + (index + 1);
    }
    while (alternativeIds.has(id)) id += "_";
    alternativeIds.add(id);
    const summaries = list(source.summaries).map((summary,summaryIndex) => {
      const item = summary && typeof summary === "object" ? summary : {};
      return Object.assign({},item,{
        catchment_id:identifier(item.catchment_id),
        label:identifier(item.label) || identifier(item.catchment_id) || "Unidentified reporting scope " + (summaryIndex + 1)
      });
    });
    summaries.filter(summary => !summary.catchment_id).forEach(() => {
      recordIssues.push("A summary has no catchment_id and cannot be selected.");
    });
    return Object.assign({},source,{
      id,source_id:sourceId,label:identifier(source.label) || sourceId || "Unidentified alternative",
      summaries,record_issues:recordIssues
    });
  });
  alternatives.forEach(a => a.record_issues.forEach(issue => issues.push(a.label + ": " + issue)));
  return {
    workspace_id:identifier(data.workspace_id),
    metrics,alternatives,issues,
    catchment_ids:unique(alternatives.flatMap(a => a.summaries.map(s => s.catchment_id)).filter(Boolean)).sort()
  };
}
function summaryFor(alternative,catchmentId) {
  if (!alternative) return {summary:null,issues:["Baseline is not selected."]};
  const matches = alternative.summaries.filter(s => s.catchment_id === catchmentId);
  if (!matches.length) return {summary:null,issues:["No summary for reporting scope " + catchmentId + "."]};
  if (matches.length > 1) return {summary:null,issues:["Duplicate summaries for reporting scope " + catchmentId + "."]};
  return {summary:matches[0],issues:alternative.record_issues.slice()};
}
function metadata(alternative,summary) {
  const a = alternative || {};
  const s = summary || {};
  const get = key => identifier(own(s,key) ? s[key] : a[key]);
  const year = get("year");
  return {
    alternative_id:identifier(a.id),
    source_id:identifier(a.source_id),
    label:identifier(a.label),
    run_id:identifier(a.run_id),
    grid_id:identifier(a.grid_id),
    profile_id:identifier(a.profile_id),
    scenario_id:identifier(a.scenario_id),
    invest_version:identifier(a.invest_version),
    domain_id:get("domain_id"),
    catchment_id:identifier(s.catchment_id),
    scope_id:get("scope_id"),
    period_id:get("period_id") || (year ? "calendar-year:" + year : ""),
    year
  };
}
function measurement(summary,metric) {
  const raw = summary && summary.metrics && summary.metrics[metric.id];
  const object = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const unit = identifier(object.unit);
  const supportId = identifier(object.support_id) || identifier(summary && summary.support_id);
  const cellsRaw = own(object,"valid_cells") ? object.valid_cells : summary && summary.valid_cells;
  const validCells = Number.isInteger(cellsRaw) && cellsRaw >= 0 ? cellsRaw : null;
  const declared = identifier(object.status).toLowerCase();
  const reasons = [];
  let value = numeric(object.value);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) reasons.push("Measurement object is missing.");
  if (declared && declared !== "valid" && declared !== "ok") {
    reasons.push("Measurement status is " + declared + ".");
    value = null;
  }
  if (!finite(object.value)) reasons.push("No finite numeric value (NoData).");
  if (validCells === 0) {
    reasons.push("No valid cells (NoData).");
    value = null;
  }
  if (!unit) reasons.push("Total unit is missing.");
  else if (!metric.unit || unit !== metric.unit) reasons.push("Total unit " + unit + " differs from expected " + (metric.unit || "unspecified") + ".");
  if (metric.nonnegative && finite(value) && value < 0) reasons.push("Negative value is invalid for this mass-export metric.");
  return {value,unit,support_id:supportId,valid_cells:validCells,eligible:reasons.length === 0,reasons};
}
function nativeChange(summary,metric,baselineMeta,alternativeMeta) {
  const raw = summary && summary.direct_changes && summary.direct_changes[metric.id];
  if (!raw || typeof raw !== "object") return null;
  const reasons = [];
  const value = numeric(raw.value);
  const unit = identifier(raw.unit);
  const cells = Number.isInteger(raw.valid_cells) && raw.valid_cells >= 0 ? raw.valid_cells : null;
  if (!finite(value)) reasons.push("No finite native change.");
  if (unit !== metric.unit) reasons.push("Native change unit differs from expected " + metric.unit + ".");
  if (identifier(raw.direction) !== "alternative minus baseline") reasons.push("Native difference direction is not alternative minus baseline.");
  if (!baselineMeta.run_id || identifier(raw.baseline_run_id) !== baselineMeta.run_id) reasons.push("Native change references a different or unidentified baseline run.");
  if (raw.alternative_run_id && identifier(raw.alternative_run_id) !== alternativeMeta.run_id) reasons.push("Native change references a different alternative run.");
  if (cells === 0) reasons.push("Native difference has no valid cells.");
  const status = identifier(raw.status).toLowerCase();
  if (status && status !== "valid" && status !== "ok") reasons.push("Native change status is " + status + ".");
  ["domain_id","scope_id","period_id","year"].forEach(key => {
    if (baselineMeta[key] && alternativeMeta[key] && baselineMeta[key] !== alternativeMeta[key]) reasons.push("Native change reporting context differs: " + key + ".");
  });
  return {
    value,unit,valid_cells:cells,direction:identifier(raw.direction),
    baseline_run_id:identifier(raw.baseline_run_id),
    alternative_run_id:identifier(raw.alternative_run_id) || alternativeMeta.run_id,
    support_id:identifier(raw.support_id),
    artifact_path:identifier(raw.artifact_path),
    artifact_sha256:identifier(raw.artifact_sha256),
    eligible:reasons.length === 0,reasons
  };
}
function contextReasons(base,candidate) {
  const reasons = [];
  ["domain_id","scope_id","period_id"].forEach(key => {
    if (!base[key] || !candidate[key]) reasons.push(key + " is missing on " + (!base[key] && !candidate[key] ? "both summaries" : !base[key] ? "the baseline" : "the alternative") + ".");
    else if (base[key] !== candidate[key]) reasons.push(key + " differs from the baseline.");
  });
  if (base.year !== candidate.year) reasons.push("Calendar-year metadata differs from the baseline.");
  return reasons;
}
function comparisonRow(baseline,alternative,catchmentId,metric) {
  const b = summaryFor(baseline,catchmentId);
  const a = summaryFor(alternative,catchmentId);
  const baselineMeta = metadata(baseline,b.summary);
  const alternativeMeta = metadata(alternative,a.summary);
  const bm = measurement(b.summary,metric);
  const am = measurement(a.summary,metric);
  const reasons = []
    .concat(b.issues.map(reason => "Baseline: " + reason))
    .concat(a.issues.map(reason => "Alternative: " + reason))
    .concat(bm.reasons.map(reason => "Baseline: " + reason))
    .concat(am.reasons.map(reason => "Alternative: " + reason))
    .concat(contextReasons(baselineMeta,alternativeMeta));
  if (!bm.support_id || !am.support_id) reasons.push("Exact valid-support identity is missing.");
  else if (bm.support_id !== am.support_id) reasons.push("Valid support differs from the baseline.");
  if (bm.valid_cells !== null && am.valid_cells !== null && bm.valid_cells !== am.valid_cells) reasons.push("Valid-cell counts differ between totals.");
  const eligible = reasons.length === 0;
  const direct = nativeChange(a.summary,metric,baselineMeta,alternativeMeta);
  let delta = null;
  let basis = null;
  if (eligible) {
    delta = numeric(am.value - bm.value);
    basis = "same_support_totals";
  } else if (direct && direct.eligible) {
    delta = direct.value;
    basis = "retained_intersection_difference";
  }
  let percent = null;
  let percentStatus = "totals_not_comparable";
  if (eligible) {
    if (bm.value === 0) percentStatus = "zero_baseline";
    else {
      percent = numeric(((bm.value - am.value) / bm.value) * 100);
      percentStatus = percent === null ? "numeric_range" : "available";
    }
  }
  const profileChanged = !!(baselineMeta.profile_id && alternativeMeta.profile_id && baselineMeta.profile_id !== alternativeMeta.profile_id);
  const versionChanged = !!(baselineMeta.invest_version && alternativeMeta.invest_version && baselineMeta.invest_version !== alternativeMeta.invest_version);
  const flags = [];
  if (profileChanged) flags.push("Profile differs: output change includes parameter effects.");
  if (versionChanged) flags.push("Model version differs.");
  if (baselineMeta.grid_id && alternativeMeta.grid_id && baselineMeta.grid_id !== alternativeMeta.grid_id) flags.push("Grid identity differs.");
  return {
    key:JSON.stringify([alternative.id,catchmentId,metric.id]),
    alternative_id:alternative.id,alternative_label:alternative.label,
    catchment_id:catchmentId,catchment_label:identifier(a.summary && a.summary.label) || catchmentId,
    metric_id:metric.id,metric_label:metric.label,unit:metric.unit,
    baseline:baselineMeta,alternative:alternativeMeta,
    baseline_measurement:bm,alternative_measurement:am,
    totals_comparable:eligible,exclusion_reasons:unique(reasons),
    delta,delta_basis:basis,reduction:delta === null ? null : -delta,
    percent_reduction:percent,percent_status:percentStatus,
    native_change:direct,flags,
    pareto_status:"unavailable",dominated_by:[],
    priority_score:null,priority_rank:null,priority_status:"disabled"
  };
}
function priorityConfig(selection,metricIds) {
  const supplied = selection.priority || {};
  const weights = supplied.weights || {};
  const directions = selection.directions || {};
  const issues = [];
  const criteria = metricIds.map(id => {
    const value = own(weights,id) ? weights[id] : 0;
    if (!finite(value) || value < 0) issues.push("Priority weight for " + id + " must be a finite nonnegative number.");
    if (finite(value) && value > 0 && !directionValid(directions[id])) issues.push("Choose a direction for weighted metric " + id + ".");
    return {metric_id:id,weight:finite(value) && value >= 0 ? value : 0,direction:directions[id] || ""};
  });
  if (!criteria.some(item => item.weight > 0)) issues.push("Enter at least one positive priority weight.");
  const maximumWeight = criteria.reduce((maximum,item) => Math.max(maximum,item.weight),0);
  const scaledSum = maximumWeight ? criteria.reduce((sum,item) => sum + item.weight / maximumWeight,0) : 0;
  criteria.forEach(item => {item.normalized_weight = scaledSum ? (item.weight / maximumWeight) / scaledSum : 0;});
  return {enabled:supplied.enabled === true,criteria,issues};
}
function preference(value,minimum,maximum,direction) {
  if (minimum === maximum) return 0;
  const range = maximum - minimum;
  const scale = Math.max(Math.abs(minimum),Math.abs(maximum),1);
  const proportion = finite(range) && range > 0 ? (value - minimum) / range : (value / scale - minimum / scale) / (maximum / scale - minimum / scale);
  const clamped = Math.max(0,Math.min(1,proportion));
  return direction === "maximize" ? clamped : 1 - clamped;
}
export function compute(input,selection = {}) {
  const data = normalizeDataset(input);
  const metricIds = selected(selection.metric_ids,data.metrics.map(m => m.id));
  const metrics = metricIds.map(id => data.metrics.find(m => m.id === id));
  const catchments = selected(selection.catchment_ids,data.catchment_ids);
  const baselineId = identifier(selection.baseline_id);
  const baseline = data.alternatives.find(a => a.id === baselineId) || null;
  const alternativeIds = selected(selection.alternative_ids,data.alternatives.map(a => a.id)).filter(id => id !== baselineId);
  const alternatives = alternativeIds.map(id => data.alternatives.find(a => a.id === id));
  const directions = Object.fromEntries(metricIds.map(id => [id,directionValid((selection.directions || {})[id]) ? selection.directions[id] : ""]));
  const priority = priorityConfig(selection,metricIds);
  const rows = [];
  const groups = [];
  const issues = data.issues.slice();
  if (!baseline) issues.push("Select an explicit baseline to calculate comparison changes.");
  if (!metrics.length) issues.push("Select at least one metric.");
  if (!alternatives.length) issues.push("Select at least one alternative.");
  if (!catchments.length) issues.push("Select at least one reporting scope.");
  catchments.forEach(catchmentId => {
    const candidates = alternatives.map(alternative => {
      const candidateRows = metrics.map(metric => comparisonRow(baseline,alternative,catchmentId,metric));
      rows.push(...candidateRows);
      return {id:alternative.id,label:alternative.label,rows:candidateRows,eligible:metrics.length > 0 && candidateRows.every(row => row.totals_comparable)};
    });
    const eligible = candidates.filter(candidate => candidate.eligible);
    const commonIds = eligible.map(candidate => candidate.id);
    const missingDirections = metricIds.filter(id => !directionValid(directions[id]));
    const group = {
      catchment_id:catchmentId,
      common_alternative_ids:commonIds,
      selected_metric_ids:metricIds.slice(),
      excluded_alternatives:candidates.filter(c => !c.eligible).map(c => ({
        alternative_id:c.id,reasons:unique(c.rows.flatMap(row => row.exclusion_reasons))
      })),
      pareto:{status:"unavailable",directions:Object.assign({},directions),issues:[]},
      priority:{enabled:priority.enabled,status:priority.enabled ? "unavailable" : "disabled",issues:[],criteria:[],normalization:"min_max_across_common_alternatives",constant_criterion_policy:"zero_contribution"}
    };
    if (missingDirections.length) group.pareto.issues.push("Choose minimize or maximize for every selected metric: " + missingDirections.join(", ") + ".");
    if (eligible.length < 2) group.pareto.issues.push("At least two alternatives with comparable totals for every selected metric are needed.");
    if (!missingDirections.length && eligible.length >= 2) {
      group.pareto.status = "available";
      eligible.forEach(candidate => {
        const dominatedBy = eligible.filter(other => {
          if (other === candidate) return false;
          let strictlyBetter = false;
          for (let index = 0; index < metrics.length; index += 1) {
            const lhs = other.rows[index].alternative_measurement.value;
            const rhs = candidate.rows[index].alternative_measurement.value;
            const minimize = directions[metrics[index].id] === "minimize";
            if (minimize ? lhs > rhs : lhs < rhs) return false;
            if (minimize ? lhs < rhs : lhs > rhs) strictlyBetter = true;
          }
          return strictlyBetter;
        }).map(other => other.id);
        candidate.rows.forEach(row => {
          row.pareto_status = dominatedBy.length ? "dominated" : "undominated";
          row.dominated_by = dominatedBy.slice();
        });
      });
    }
    if (priority.enabled) {
      group.priority.issues = priority.issues.slice();
      if (eligible.length < 2) group.priority.issues.push("At least two alternatives with comparable totals for every selected metric are needed.");
      group.priority.criteria = priority.criteria.map(criterion => {
        const index = metricIds.indexOf(criterion.metric_id);
        let minimum = null;
        let maximum = null;
        eligible.forEach(candidate => {
          const value = candidate.rows[index].alternative_measurement.value;
          minimum = minimum === null ? value : Math.min(minimum,value);
          maximum = maximum === null ? value : Math.max(maximum,value);
        });
        return Object.assign({},criterion,{minimum,maximum,constant:minimum !== null && minimum === maximum});
      });
      if (!group.priority.issues.length) {
        group.priority.status = "available";
        const scores = eligible.map(candidate => {
          const score = group.priority.criteria.reduce((sum,criterion,index) => {
            if (!criterion.normalized_weight) return sum;
            return sum + criterion.normalized_weight * preference(candidate.rows[index].alternative_measurement.value,criterion.minimum,criterion.maximum,criterion.direction);
          },0) * 100;
          return {candidate,score};
        }).sort((a,b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
        let rank = 0;
        let previous = null;
        scores.forEach((entry,index) => {
          if (previous === null || entry.score !== previous) rank = index + 1;
          previous = entry.score;
          entry.candidate.rows.forEach(row => {
            row.priority_score = entry.score;
            row.priority_rank = rank;
            row.priority_status = "available";
          });
        });
      }
      candidates.filter(candidate => !candidate.rows.some(row => row.priority_status === "available")).forEach(candidate => candidate.rows.forEach(row => {
        row.priority_status = candidate.eligible ? "configuration_unavailable" : "ineligible";
      }));
    }
    candidates.filter(candidate => !candidate.eligible).forEach(candidate => candidate.rows.forEach(row => {row.pareto_status = "ineligible";}));
    groups.push(group);
  });
  return {
    schema_version:"scenario-decisions.comparison.v1",component_version:VERSION,
    workspace_id:data.workspace_id,
    selection:{
      baseline_id:baselineId,alternative_ids:alternativeIds,metric_ids:metricIds,catchment_ids:catchments,
      directions,priority:{enabled:priority.enabled,weights:Object.fromEntries(priority.criteria.map(c => [c.metric_id,c.weight]))}
    },
    baseline:baseline ? metadata(baseline,null) : null,
    metrics,issues:unique(issues),groups,rows,
    conventions:{
      delta:"alternative minus baseline",
      reduction:"baseline minus alternative",
      percent_reduction:"100 * (baseline - alternative) / baseline; undefined at zero baseline or incomparable total support",
      native_change:"Retained raster difference on valid intersection; independent of direct total comparison",
      grouping:"Each reporting scope is independent; catchments are never added together",
      common_set:"Alternatives with comparable baseline and alternative totals for every selected metric, separately per reporting scope",
      pareto:"User-selected directions only; baseline is the reference and is excluded from the candidate set",
      priority:"Optional user weights, normalized to sum to one; selected positive-weight criteria use common-set min-max values; constant criteria contribute zero",
      visibility:"Table search, sorting and pins do not change calculation membership"
    }
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = typeof value === "string" ? value : String(value);
  if (typeof value === "string" && (/^[\t\r\n]/.test(text) || /^[\s]*[=+\-@]/.test(text))) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g,'""') + '"' : text;
}
export function toJSON(comparison) {
  return JSON.stringify(comparison,null,2) + "\n";
}
export function* toCSVChunks(comparison) {
  const headers = [
    "workspace_id","baseline_id","alternative_id","alternative_label","catchment_id","metric_id","metric_label",
    "baseline_run_id","alternative_run_id","baseline_grid_id","alternative_grid_id",
    "baseline_profile_id","alternative_profile_id","baseline_scenario_id","alternative_scenario_id",
    "baseline_invest_version","alternative_invest_version","baseline_domain_id","alternative_domain_id",
    "baseline_scope_id","alternative_scope_id","baseline_period_id","alternative_period_id","baseline_year","alternative_year",
    "baseline_value","baseline_unit","alternative_value","alternative_unit",
    "baseline_support_id","alternative_support_id","baseline_valid_cells","alternative_valid_cells",
    "delta","delta_unit","delta_basis","reduction","percent_reduction","percent_status","totals_comparable",
    "native_delta","native_delta_unit","native_valid_cells","native_eligible","native_reasons","native_artifact_sha256",
    "exclusion_reasons","flags","pareto_status","dominated_by","priority_score","priority_rank","priority_status",
    "priority_direction","priority_raw_weight","common_alternative_ids"
  ];
  const commonSets = new Map();
  comparison.groups.forEach(group => {
    if (!commonSets.has(group.catchment_id)) commonSets.set(group.catchment_id,csvCell(group.common_alternative_ids.join(" | ")));
  });
  yield headers.join(",") + "\r\n";
  const lines = [];
  for (const row of comparison.rows) {
    const b = row.baseline, a = row.alternative;
    const bm = row.baseline_measurement, am = row.alternative_measurement, native = row.native_change;
    const values = [
      comparison.workspace_id,comparison.selection.baseline_id,row.alternative_id,row.alternative_label,row.catchment_id,row.metric_id,row.metric_label,
      b.run_id,a.run_id,b.grid_id,a.grid_id,b.profile_id,a.profile_id,b.scenario_id,a.scenario_id,
      b.invest_version,a.invest_version,b.domain_id,a.domain_id,b.scope_id,a.scope_id,b.period_id,a.period_id,b.year,a.year,
      bm.value,bm.unit,am.value,am.unit,bm.support_id,am.support_id,bm.valid_cells,am.valid_cells,
      row.delta,row.unit,row.delta_basis,row.reduction,row.percent_reduction,row.percent_status,row.totals_comparable,
      native && native.value,native && native.unit,native && native.valid_cells,native && native.eligible,
      native ? native.reasons.join(" | ") : "",native && native.artifact_sha256,
      row.exclusion_reasons.join(" | "),row.flags.join(" | "),row.pareto_status,row.dominated_by.join(" | "),
      row.priority_score,row.priority_rank,row.priority_status,comparison.selection.directions[row.metric_id],
      comparison.selection.priority.weights[row.metric_id]
    ];
    lines.push(values.map(csvCell).join(",") + "," + (commonSets.get(row.catchment_id) || "") + "\r\n");
    if (lines.length === 256) {yield lines.join(""); lines.length = 0;}
  }
  if (lines.length) yield lines.join("");
}
export function toCSV(comparison) {
  return Array.from(toCSVChunks(comparison)).join("");
}
export function* toTextChunks(comparison) {
  const number = value => value === null || value === undefined ? "unavailable" : String(value);
  const lines = [
    "SCENARIO DECISION COMPARISON",
    "Workspace: " + (comparison.workspace_id || "not supplied"),
    "Baseline alternative: " + (comparison.selection.baseline_id || "not selected"),
    "Selected alternatives: " + (comparison.selection.alternative_ids.join(", ") || "none"),
    "Delta = alternative minus baseline. Reduction = baseline minus alternative.",
    "A percentage is undefined for a zero baseline or totals on different valid support.",
    "Every reporting scope is evaluated independently. Catchments are not added.",
    ""
  ];
  if (comparison.issues.length) lines.push("INPUT NOTES",...comparison.issues.map(issue => "- " + issue),"");
  yield lines.join("\n") + "\n";
  const scopeRows = new Map();
  comparison.rows.forEach(row => {
    if (!scopeRows.has(row.catchment_id)) scopeRows.set(row.catchment_id,[]);
    scopeRows.get(row.catchment_id).push(row);
  });
  for (const group of comparison.groups) {
    lines.length = 0;
    lines.push(
      "REPORTING SCOPE: " + group.catchment_id,
      "Common eligible alternative set: " + (group.common_alternative_ids.join(", ") || "none"),
      "Pareto: " + group.pareto.status + ". " + group.pareto.issues.join(" "),
      "Directions: " + JSON.stringify(group.pareto.directions),
      "User priority: " + group.priority.status + ". " + group.priority.issues.join(" ")
    );
    if (group.priority.enabled) {
      lines.push("Priority uses common-set min-max normalization. Constant criteria contribute zero. Baseline is excluded from the choice set.");
      group.priority.criteria.forEach(criterion => {
        lines.push("Criterion " + criterion.metric_id + ": direction " + (criterion.direction || "unset") +
          "; weight " + criterion.weight + "; normalized weight " + criterion.normalized_weight +
          "; minimum " + number(criterion.minimum) + "; maximum " + number(criterion.maximum) +
          "; constant " + criterion.constant + ".");
      });
    }
    (scopeRows.get(group.catchment_id) || []).forEach(row => {
      const b = row.baseline, a = row.alternative, bm = row.baseline_measurement, am = row.alternative_measurement;
      lines.push("",
        row.alternative_label + " [" + row.alternative_id + "] / " + row.metric_label,
        "Baseline total: " + number(bm.value) + " " + bm.unit + "; valid cells " + number(bm.valid_cells) + "; support " + (bm.support_id || "not supplied") + ".",
        "Alternative total: " + number(am.value) + " " + am.unit + "; valid cells " + number(am.valid_cells) + "; support " + (am.support_id || "not supplied") + ".",
        "Delta: " + number(row.delta) + " " + row.unit + "; basis " + (row.delta_basis || "unavailable") + ".",
        "Reduction: " + number(row.reduction) + " " + row.unit + "; percent reduction " + number(row.percent_reduction) + "; percentage status " + row.percent_status + ".",
        "Totals comparable: " + row.totals_comparable + ". " + row.exclusion_reasons.join(" "),
        "Baseline run " + (b.run_id || "not supplied") + "; grid " + (b.grid_id || "not supplied") + "; profile " + (b.profile_id || "not supplied") +
          "; scenario " + (b.scenario_id || "not supplied") + "; model " + (b.invest_version || "not supplied") + ".",
        "Alternative run " + (a.run_id || "not supplied") + "; grid " + (a.grid_id || "not supplied") + "; profile " + (a.profile_id || "not supplied") +
          "; scenario " + (a.scenario_id || "not supplied") + "; model " + (a.invest_version || "not supplied") + ".",
        "Baseline context: domain " + (b.domain_id || "not supplied") + "; scope " + (b.scope_id || "not supplied") + "; period " + (b.period_id || "not supplied") + "; year " + (b.year || "unspecified") + ".",
        "Alternative context: domain " + (a.domain_id || "not supplied") + "; scope " + (a.scope_id || "not supplied") + "; period " + (a.period_id || "not supplied") + "; year " + (a.year || "unspecified") + "."
      );
      if (row.native_change) {
        const native = row.native_change;
        lines.push("Retained native difference: " + number(native.value) + " " + native.unit + "; intersection valid cells " + number(native.valid_cells) +
          "; eligible " + native.eligible + "; baseline run " + native.baseline_run_id + ". " + native.reasons.join(" "));
      }
      if (row.flags.length) lines.push("Context flags: " + row.flags.join(" "));
      lines.push("Pareto: " + row.pareto_status + (row.dominated_by.length ? "; dominated by " + row.dominated_by.join(", ") : "") + ".",
        "User priority: " + row.priority_status + "; score " + number(row.priority_score) + "; rank " + number(row.priority_rank) + ".");
    });
    lines.push("");
    yield lines.join("\n") + "\n";
  }
}
export function toText(comparison) {
  return Array.from(toTextChunks(comparison)).join("");
}

let mountCount = 0;
function element(document,tag,attributes,...children) {
  const node = document.createElement(tag);
  Object.entries(attributes || {}).forEach(([key,value]) => {
    if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2),value);
    else if (key === "value" || key === "checked" || key === "selected" || key === "disabled" || key === "multiple") node[key] = value;
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key,value === true ? "" : String(value));
  });
  children.flat(Infinity).forEach(child => {
    if (child !== null && child !== undefined && child !== false) node.appendChild(typeof child === "object" && child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}
function displayNumber(value,sign = false) {
  if (!finite(value)) return "Unavailable";
  const formatted = numberFormatter.format(value === 0 ? 0 : value);
  return sign && value > 0 ? "+" + formatted : formatted;
}
function safeFilename(value) {
  return (identifier(value).replace(/[^a-zA-Z0-9._-]+/g,"_").slice(0,100) || "selection");
}
export function mount(container,input,options = {}) {
  if (!container || !container.ownerDocument) throw new TypeError("mount requires a DOM container.");
  const document = container.ownerDocument;
  const make = (tag,attributes,...children) => element(document,tag,attributes,...children);
  const prefix = "sdc-" + (++mountCount) + "-";
  let rawData = input || {};
  let data = normalizeDataset(rawData);
  let state = {
    baseline_id:"",
    alternative_ids:data.alternatives.map(a => a.id),
    metric_ids:data.metrics.map(m => m.id),
    catchment_ids:data.catchment_ids.slice(),
    directions:{},priority:{enabled:false,weights:{}},
    query:"",status_filter:"all",pinned_ids:[],only_pinned:false,
    sort_key:"alternative",sort_direction:"asc",
    table_page:1,table_page_size:50,method_catchment_id:""
  };
  let result = null;
  let calculationKey = null;
  let dataRevision = 0;
  let destroyed = false;
  let baselineSelect = null;
  let criteriaBox = null;
  let viewCache = {result:null,key:null,rows:[]};
  let countCache = {result:null,comparable:0,native:0};
  let contextResult = null;
  let searchCache = new WeakMap();
  let methodResult = null;
  let methodController = null;
  let tableView = null;
  const rowCollator = new Intl.Collator(undefined,{numeric:true});
  const panel = make("section",{"class":"sdc-panel","aria-labelledby":prefix + "title"});
  ["click","change","input"].forEach(type => panel.addEventListener(type,event => event.stopPropagation()));
  const status = make("p",{id:prefix + "status","class":"sdc-status",role:"status","aria-live":"polite"});
  const error = make("p",{"class":"sdc-notice",role:"alert",hidden:true});
  const controls = make("div",{"class":"sdc-controls"});
  const contextBox = make("div",{"class":"sdc-context"});
  const resultBox = make("div",{"class":"sdc-results"});
  const methodBox = make("div",{"class":"sdc-method-box"});
  panel.append(
    make("header",{"class":"sdc-heading"},
      make("div",{},make("h2",{id:prefix + "title"},"Scenario decisions"),
        make("p",{},"Compare retained annual outputs, physical changes and alternative choices.")),
      make("span",{"class":"sdc-version"},"Workspace " + (data.workspace_id || "unspecified"))
    ),status,error,controls,contextBox,resultBox,methodBox
  );
  container.replaceChildren(panel);

  function mergeState(patch = {}) {
    const next = patch && typeof patch === "object" ? patch : {};
    state = Object.assign({},state,next,{
      directions:Object.assign({},state.directions,next.directions || {}),
      priority:Object.assign({},state.priority,next.priority || {},{
        weights:Object.assign({},state.priority.weights,(next.priority || {}).weights || {})
      })
    });
    state.baseline_id = identifier(state.baseline_id);
    state.alternative_ids = selected(state.alternative_ids,data.alternatives.map(a => a.id));
    state.metric_ids = selected(state.metric_ids,data.metrics.map(m => m.id));
    state.catchment_ids = selected(state.catchment_ids,data.catchment_ids);
    state.pinned_ids = selected(state.pinned_ids,data.alternatives.map(a => a.id));
    state.query = typeof state.query === "string" ? state.query : "";
    if (!["all","comparable","excluded","native","undominated","dominated"].includes(state.status_filter)) state.status_filter = "all";
    if (!["alternative","catchment","metric","baseline","value","delta","percent","priority"].includes(state.sort_key)) state.sort_key = "alternative";
    if (!["asc","desc"].includes(state.sort_direction)) state.sort_direction = "asc";
    state.only_pinned = state.only_pinned === true;
    state.priority.enabled = state.priority.enabled === true;
    state.table_page = Number.isSafeInteger(Number(state.table_page)) && Number(state.table_page) > 0 ? Number(state.table_page) : 1;
    state.table_page_size = PAGE_SIZES.includes(Number(state.table_page_size)) ? Number(state.table_page_size) : 50;
    state.method_catchment_id = identifier(state.method_catchment_id);
  }
  function currentState() {
    return clone({
      baseline_id:state.baseline_id,alternative_ids:state.alternative_ids,
      metric_ids:state.metric_ids,catchment_ids:state.catchment_ids,
      directions:state.directions,priority:state.priority,query:state.query,
      status_filter:state.status_filter,pinned_ids:state.pinned_ids,
      only_pinned:state.only_pinned,sort_key:state.sort_key,sort_direction:state.sort_direction,
      table_page:state.table_page,table_page_size:state.table_page_size,method_catchment_id:state.method_catchment_id
    });
  }
  function notify() {
    if (typeof options.onChange !== "function") return;
    try {
      options.onChange(currentState(),options.notifyAssessment === false ? undefined : clone(result));
      error.hidden = true;
    } catch (problem) {
      error.textContent = "The host could not retain this view: " + (problem && problem.message ? problem.message : String(problem));
      error.hidden = false;
      if (typeof options.onError === "function") options.onError(problem);
    }
  }
  function rebuildCriteria() {
    criteriaBox.replaceChildren();
    const table = make("table",{"class":"sdc-criteria"});
    table.appendChild(make("thead",{},make("tr",{},
      make("th",{scope:"col"},"Selected metric"),
      make("th",{scope:"col"},"Direction for choices"),
      make("th",{scope:"col"},"Optional weight")
    )));
    const body = make("tbody");
    data.metrics.filter(metric => state.metric_ids.includes(metric.id)).forEach((metric,index) => {
      const direction = make("select",{
        id:prefix + "direction-" + index,"aria-label":"Preference direction for " + metric.label,
        onchange:event => {state.directions[metric.id] = event.target.value; refresh();}
      },
        make("option",{value:""},"Choose direction"),
        make("option",{value:"minimize"},"Minimize"),
        make("option",{value:"maximize"},"Maximize")
      );
      direction.value = directionValid(state.directions[metric.id]) ? state.directions[metric.id] : "";
      const weight = make("input",{
        id:prefix + "weight-" + index,type:"number",min:"0",step:"any",inputmode:"decimal",
        "aria-label":"Priority weight for " + metric.label,
        oninput:event => {
          const field = event.target;
          state.priority.weights[metric.id] = field.validity.badInput ? NaN : field.value === "" ? 0 : field.valueAsNumber;
          refresh();
        }
      });
      weight.value = own(state.priority.weights,metric.id) && finite(state.priority.weights[metric.id]) ? String(state.priority.weights[metric.id]) : "";
      body.appendChild(make("tr",{},
        make("th",{scope:"row"},metric.label,make("span",{"class":"sdc-unit"},metric.unit)),
        make("td",{},direction),make("td",{},weight)
      ));
    });
    table.appendChild(body);
    criteriaBox.append(table,
      make("p",{"class":"sdc-help"},"Directions are explicit choices. Weights start empty. A blank or zero weight omits that criterion from priority scoring. All selected metrics still define the common eligible alternative set.")
    );
  }
  function selectionControl(label,id,items,field,onSelection) {
    const select = make("select",{
      id:prefix + id,multiple:true,size:Math.min(7,Math.max(3,items.length)),
      "aria-describedby":prefix + id + "-help",
      onchange:() => {
        state[field] = Array.from(select.selectedOptions,option => option.value);
        state.table_page = 1;
        if (onSelection) onSelection();
        refresh();
      }
    });
    items.forEach(item => select.appendChild(make("option",{
      value:item.id,selected:state[field].includes(item.id)
    },item.label)));
    const selectAll = value => {
      state[field] = value ? items.map(item => item.id) : [];
      state.table_page = 1;
      Array.from(select.options).forEach(option => {option.selected = value;});
      if (onSelection) onSelection();
      refresh();
    };
    return make("div",{"class":"sdc-select-group"},
      make("label",{for:prefix + id},label),select,
      make("div",{"class":"sdc-inline"},
        make("button",{type:"button",onclick:() => selectAll(true),"aria-label":"Select all " + label.toLowerCase()},"All"),
        make("button",{type:"button",onclick:() => selectAll(false),"aria-label":"Clear all " + label.toLowerCase()},"None")
      ),
      make("small",{id:prefix + id + "-help"},"Multiple selection. Use the platform selection keys or All / None.")
    );
  }
  function rebuildControls() {
    controls.replaceChildren();
    baselineSelect = make("select",{
      id:prefix + "baseline",
      onchange:event => {
        state.baseline_id = event.target.value;
        state.table_page = 1;
        rebuildControls();
        refresh();
        baselineSelect.focus();
      }
    },make("option",{value:""},"Select a baseline"));
    data.alternatives.forEach(alternative => baselineSelect.appendChild(make("option",{value:alternative.id},
      alternative.label + " [" + alternative.id + "]"
    )));
    baselineSelect.value = state.baseline_id;
    const baselineField = make("div",{"class":"sdc-baseline-select"},
      make("label",{for:prefix + "baseline"},"Baseline retained run"),baselineSelect
    );
    criteriaBox = make("div");
    controls.appendChild(baselineField);
    const scopeLabels = new Map();
    data.alternatives.forEach(alternative => alternative.summaries.forEach(summary => {
      if (!scopeLabels.has(summary.catchment_id)) scopeLabels.set(summary.catchment_id,summary.label);
    }));
    controls.appendChild(make("div",{"class":"sdc-selections"},
      selectionControl("Alternatives","alternatives",data.alternatives.filter(a => a.id !== state.baseline_id).map(a => ({id:a.id,label:a.label + " [" + a.id + "]"})),"alternative_ids"),
      selectionControl("Metrics","metrics",data.metrics.map(m => ({id:m.id,label:m.label + " (" + m.unit + ")"})),"metric_ids",rebuildCriteria),
      selectionControl("Reporting scopes","catchments",data.catchment_ids.map(id => {
        const label = scopeLabels.get(id);
        return {id,label:label && label !== id ? label + " [" + id + "]" : id};
      }),"catchment_ids")
    ));
    const details = make("details",{"class":"sdc-preferences"});
    const enabled = make("input",{
      id:prefix + "priority",type:"checkbox",checked:state.priority.enabled,
      onchange:event => {state.priority.enabled = event.target.checked; refresh();}
    });
    details.append(make("summary",{},"Choice directions and optional user priority"),
      make("p",{"class":"sdc-help"},"Pareto tradeoffs use every selected metric and become available when each has an explicit direction. Priority scores apply your weights within each reporting scope."),
      make("label",{"class":"sdc-checkbox",for:prefix + "priority"},enabled,"Enable weighted priority"),criteriaBox
    );
    details.open = state.priority.enabled || Object.values(state.directions).some(directionValid);
    controls.appendChild(details);
    rebuildCriteria();
    const query = make("input",{
      id:prefix + "search",type:"search",value:state.query,placeholder:"Scenario, run, metric or exclusion",
      oninput:event => {state.query = event.target.value; state.table_page = 1; refresh();}
    });
    const statusFilter = make("select",{
      id:prefix + "filter",onchange:event => {state.status_filter = event.target.value; state.table_page = 1; refresh();}
    });
    [["all","All rows"],["comparable","Comparable totals"],["excluded","Excluded totals"],["native","Retained native changes"],["undominated","Pareto undominated"],["dominated","Pareto dominated"]].forEach(([value,label]) => statusFilter.appendChild(make("option",{value},label)));
    statusFilter.value = state.status_filter;
    const pinnedOnly = make("input",{
      id:prefix + "pins-only",type:"checkbox",checked:state.only_pinned,
      onchange:event => {state.only_pinned = event.target.checked; state.table_page = 1; refresh();}
    });
    controls.appendChild(make("div",{"class":"sdc-toolbar"},
      make("div",{"class":"sdc-search"},make("label",{for:prefix + "search"},"Search all selected rows"),query),
      make("div",{},make("label",{for:prefix + "filter"},"Show"),statusFilter),
      make("label",{"class":"sdc-checkbox",for:prefix + "pins-only"},pinnedOnly,"Pinned alternatives only"),
      make("div",{"class":"sdc-exports","aria-label":"Export computed comparison"},
        make("button",{type:"button",onclick:() => download("json")},"Export JSON"),
        make("button",{type:"button",onclick:() => download("csv")},"Export CSV"),
        make("button",{type:"button",onclick:() => download("txt")},"Export text")
      )
    ));
    controls.appendChild(make("p",{"class":"sdc-help"},"Exports contain the complete selected comparison, including exclusions and exact unrounded numbers. Search, sorting, pins and pages affect the table view only. Printing includes the current page; use Export text or CSV for the full comparison."));
  }
  function download(format) {
    const content = () => format === "csv" ? toCSV(result) : format === "txt" ? toText(result) : toJSON(Object.assign({},result,{view_state:currentState()}));
    const filename = "scenario-comparison-" + safeFilename(state.baseline_id) + "." + format;
    const type = format === "csv" ? "text/csv;charset=utf-8" : format === "txt" ? "text/plain;charset=utf-8" : "application/json;charset=utf-8";
    if (typeof options.onExport === "function") {
      options.onExport({format,filename,content:content(),type});
      return;
    }
    const window = document.defaultView;
    const parts = format === "csv" ? toCSVChunks(result) : format === "txt" ? toTextChunks(result) : [content()];
    const objectUrl = window.URL.createObjectURL(new window.Blob(parts,{type}));
    const link = make("a",{href:objectUrl,download:filename,hidden:true});
    panel.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(objectUrl),1000);
  }
  function identityView(meta) {
    return make("div",{"class":"sdc-identities"},
      ["run_id","grid_id","profile_id","scenario_id","invest_version"].map(key =>
        make("div",{},make("span",{"class":"sdc-key"},key.replace("_id","").replace("invest_version","model")),
          make("span",{"class":"sdc-id"},meta[key] || "Not supplied"))
      )
    );
  }
  function refreshContext() {
    if (contextResult === result) return;
    contextResult = result;
    contextBox.replaceChildren();
    if (result.baseline) {
      contextBox.append(make("h3",{},"Baseline: " + result.baseline.label + " [" + result.selection.baseline_id + "]"),
        identityView(result.baseline));
    }
    if (result.issues.length) contextBox.appendChild(make("ul",{"class":"sdc-notes"},result.issues.map(issue => make("li",{},issue))));
  }
  function viewRows() {
    const query = state.query.trim().toLocaleLowerCase();
    const key = JSON.stringify([query,state.status_filter,state.only_pinned,state.pinned_ids,state.sort_key,state.sort_direction]);
    if (viewCache.result === result && viewCache.key === key) return viewCache.rows;
    if (viewCache.result !== result) searchCache = new WeakMap();
    const pinned = new Set(state.pinned_ids);
    const rows = result.rows.filter(row => {
      if (state.only_pinned && !pinned.has(row.alternative_id)) return false;
      if (state.status_filter === "comparable" && !row.totals_comparable) return false;
      if (state.status_filter === "excluded" && row.totals_comparable) return false;
      if (state.status_filter === "native" && !(row.native_change && row.native_change.eligible)) return false;
      if (state.status_filter === "undominated" && row.pareto_status !== "undominated") return false;
      if (state.status_filter === "dominated" && row.pareto_status !== "dominated") return false;
      if (!query) return true;
      let haystack = searchCache.get(row);
      if (haystack === undefined) {
        haystack = [
          row.alternative_id,row.alternative_label,row.catchment_id,row.catchment_label,row.metric_id,row.metric_label,
          row.alternative.run_id,row.alternative.grid_id,row.alternative.profile_id,row.alternative.scenario_id,
          row.alternative.domain_id,row.alternative.period_id,...row.exclusion_reasons,...row.flags
        ].join(" ").toLocaleLowerCase();
        searchCache.set(row,haystack);
      }
      return haystack.includes(query);
    });
    const getters = {
      alternative:row => row.alternative_label,catchment:row => row.catchment_id,metric:row => row.metric_label,
      baseline:row => row.baseline_measurement.value,value:row => row.alternative_measurement.value,
      delta:row => row.delta,percent:row => row.percent_reduction,priority:row => row.priority_score
    };
    const sortValue = getters[state.sort_key];
    const direction = state.sort_direction === "asc" ? 1 : -1;
    rows.sort((left,right) => {
      const pinnedOrder = Number(pinned.has(right.alternative_id)) - Number(pinned.has(left.alternative_id));
      if (pinnedOrder) return pinnedOrder;
      const a = sortValue(left), b = sortValue(right);
      if (a === null || a === undefined) return b === null || b === undefined ? left.key.localeCompare(right.key) : 1;
      if (b === null || b === undefined) return -1;
      const order = typeof a === "number" && typeof b === "number" ? (a < b ? -1 : a > b ? 1 : 0) : rowCollator.compare(String(a),String(b));
      return order * direction || left.key.localeCompare(right.key);
    });
    viewCache = {result,key,rows};
    return rows;
  }
  function pageRows(rows) {
    const pageCount = Math.max(1,Math.ceil(rows.length / state.table_page_size));
    state.table_page = Math.min(pageCount,Math.max(1,state.table_page));
    const offset = (state.table_page - 1) * state.table_page_size;
    const shown = rows.slice(offset,offset + state.table_page_size);
    tableView = {
      page:state.table_page,page_size:state.table_page_size,page_count:pageCount,
      total_rows:result.rows.length,filtered_rows:rows.length,shown_rows:shown.length,
      first_row:shown.length ? offset + 1 : 0,last_row:shown.length ? offset + shown.length : 0,
      selected_alternatives:result.selection.alternative_ids.length,
      selected_catchments:result.selection.catchment_ids.length,
      row_keys:shown.map(row => row.key)
    };
    return shown;
  }
  function pagination(position) {
    const view = tableView;
    const base = prefix + "page-" + position + "-";
    const go = value => {
      const next = Number(value);
      state.table_page = Number.isSafeInteger(next) ? Math.min(view.page_count,Math.max(1,next)) : view.page;
      refresh();
    };
    const page = make("input",{
      id:base + "number",type:"number",min:"1",max:String(view.page_count),step:"1",value:String(view.page),inputmode:"numeric",
      "aria-label":"Page of scenario comparison rows","aria-controls":prefix + "comparison-table",
      onchange:event => go(event.target.value),
      onkeydown:event => {if (event.key === "Enter") {event.preventDefault(); go(event.target.value);}}
    });
    const button = (label,name,target,disabled) => make("button",{
      id:base + name,type:"button",disabled,
      "aria-label":label + " page of scenario comparison rows","aria-controls":prefix + "comparison-table",
      onclick:() => go(target)
    },label);
    const navigation = make("nav",{"class":"sdc-pagination","aria-label":"Scenario comparison pages (" + position + ")"},
      make("div",{"class":"sdc-page-buttons"},
        button("First","first",1,view.page === 1),
        button("Previous","previous",view.page - 1,view.page === 1),
        make("label",{"class":"sdc-page-number",for:base + "number"},"Page ",page," of " + view.page_count),
        button("Next","next",view.page + 1,view.page === view.page_count),
        button("Last","last",view.page_count,view.page === view.page_count)
      ),
      make("span",{"class":"sdc-page-count"},
        "Rows " + view.first_row + "–" + view.last_row + " of " + view.filtered_rows + " matching comparison rows")
    );
    if (position === "top") {
      const size = make("select",{
        id:base + "size","aria-controls":prefix + "comparison-table",
        onchange:event => {state.table_page_size = Number(event.target.value); state.table_page = 1; refresh();}
      },PAGE_SIZES.map(value => make("option",{value:String(value),selected:value === state.table_page_size},String(value))));
      navigation.appendChild(make("label",{"class":"sdc-page-size",for:base + "size"},"Rows per page ",size));
    }
    return navigation;
  }
  function sortHeader(label,key) {
    const active = state.sort_key === key;
    const button = make("button",{
      id:prefix + "sort-" + key,type:"button","class":"sdc-sort",
      "aria-label":"Sort by " + label + (active ? "; currently " + (state.sort_direction === "asc" ? "ascending" : "descending") : ""),
      onclick:() => {
        state.sort_direction = active && state.sort_direction === "asc" ? "desc" : "asc";
        state.sort_key = key;
        state.table_page = 1;
        refresh();
      }
    },label,active ? state.sort_direction === "asc" ? " ↑" : " ↓" : "");
    return make("th",{scope:"col","aria-sort":active ? state.sort_direction === "asc" ? "ascending" : "descending" : "none"},button);
  }
  function totalCell(measurement) {
    return make("td",{"class":"sdc-numeric"},
      make("strong",{},measurement.value === null ? "NoData" : displayNumber(measurement.value)),
      make("span",{"class":"sdc-unit"},measurement.unit || "Unit not supplied"),
      make("small",{},measurement.valid_cells === null ? "Valid cells unspecified" : measurement.valid_cells + " valid cells")
    );
  }
  function rowNotes(row) {
    const notes = make("td",{"class":"sdc-row-notes"});
    notes.appendChild(make("span",{"class":"sdc-tag"},row.totals_comparable ? "Totals comparable" : "Totals excluded"));
    if (!row.totals_comparable) notes.appendChild(make("details",{},
      make("summary",{},row.exclusion_reasons.length + " exclusion reason" + (row.exclusion_reasons.length === 1 ? "" : "s")),
      make("ul",{},row.exclusion_reasons.map(reason => make("li",{},reason)))
    ));
    if (row.percent_status === "zero_baseline") notes.appendChild(make("p",{},"Zero baseline: percentage undefined."));
    row.flags.forEach(flag => notes.appendChild(make("p",{},flag)));
    const metadataDetails = make("details",{},make("summary",{},"Reporting context and native change"));
    metadataDetails.appendChild(make("dl",{"class":"sdc-detail-list"},
      ["domain_id","scope_id","period_id","year"].map(key => [
        make("dt",{},key),make("dd",{},
          "Baseline: " + (row.baseline[key] || "Unspecified"),
          make("br"),"Alternative: " + (row.alternative[key] || "Unspecified"))
      ]),
      make("dt",{},"Valid support"),make("dd",{},
        "Baseline: " + (row.baseline_measurement.support_id || "Unspecified"),
        make("br"),"Alternative: " + (row.alternative_measurement.support_id || "Unspecified"))
    ));
    if (row.native_change) {
      const native = row.native_change;
      metadataDetails.appendChild(make("p",{},
        "Native alternative-minus-baseline change: " + displayNumber(native.value,true) + " " + native.unit +
        "; " + (native.valid_cells === null ? "unspecified" : native.valid_cells) + " intersection cells."
      ));
      if (native.reasons.length) metadataDetails.appendChild(make("ul",{},native.reasons.map(reason => make("li",{},reason))));
    } else metadataDetails.appendChild(make("p",{},"No retained native difference supplied for this row."));
    notes.appendChild(metadataDetails);
    return notes;
  }
  function methodDetails(wasOpen) {
    const details = make("details",{"class":"sdc-method"});
    const content = make("div",{"class":"sdc-method-content"});
    let scopeSelect = null;
    let scopeBox = null;
    let renderedId = null;
    details.append(make("summary",{},"Comparison membership and calculation method"),content);
    const groupMap = new Map(result.groups.map(group => [group.catchment_id,group]));
    const labels = new Map();
    result.rows.forEach(row => {if (!labels.has(row.catchment_id)) labels.set(row.catchment_id,row.catchment_label);});
    function renderScope() {
      const group = groupMap.get(state.method_catchment_id);
      if (!scopeBox || !group) return;
      if (scopeSelect) scopeSelect.value = state.method_catchment_id;
      if (renderedId === state.method_catchment_id) return;
      renderedId = state.method_catchment_id;
      scopeBox.replaceChildren();
      const label = labels.get(group.catchment_id) || group.catchment_id;
      const section = make("section",{"class":"sdc-scope-method","aria-labelledby":prefix + "method-scope-title"},
        make("h4",{id:prefix + "method-scope-title"},label + (label === group.catchment_id ? "" : " [" + group.catchment_id + "]")),
        make("p",{},"Eligible choice cohort: " + group.common_alternative_ids.length + " distinct alternatives in this reporting scope. " +
          result.selection.alternative_ids.length + " alternatives are selected across " + group.selected_metric_ids.length + " metrics."),
        make("p",{},"Selected metric IDs: " + (group.selected_metric_ids.join(", ") || "none") + "."),
        make("p",{},"Physical basis for the choices below: alternative annual totals on matching baseline support."),
        make("p",{},"Pareto: " + group.pareto.status + ". " + group.pareto.issues.join(" ")),
        make("p",{},"Directions: " + group.selected_metric_ids.map(id => id + " = " + (group.pareto.directions[id] || "unset")).join("; ") + "."),
        make("p",{},"Weighted priority: " + group.priority.status + ". " + group.priority.issues.join(" ")),
        make("div",{"class":"sdc-cohort-members",tabindex:"0","aria-label":"Complete eligible alternative identifiers"},
          make("strong",{},"Complete eligible alternative IDs"),
          make("p",{"class":"sdc-id"},group.common_alternative_ids.join(", ") || "none"))
      );
      if (group.excluded_alternatives.length) {
        const excluded = make("details",{},
          make("summary",{},"Excluded alternatives (" + group.excluded_alternatives.length + ")"));
        let expanded = false;
        excluded.addEventListener("toggle",() => {
          if (excluded.open && !expanded) {
            expanded = true;
            excluded.appendChild(make("ul",{},group.excluded_alternatives.map(item =>
              make("li",{},item.alternative_id + ": " + item.reasons.join(" ")))));
          }
        });
        section.appendChild(excluded);
      }
      if (group.priority.enabled && group.priority.criteria.length) {
        const table = make("table",{"class":"sdc-normalization",tabindex:"0"});
        table.appendChild(make("caption",{},"Full eligible cohort ranges for this scope; independent of table pages, search and pins."));
        table.appendChild(make("thead",{},make("tr",{},
          ["Metric","Direction","Raw weight","Normalized weight","Common minimum","Common maximum","Constant"].map(label => make("th",{scope:"col"},label))
        )));
        table.appendChild(make("tbody",{},group.priority.criteria.map(criterion => {
          const metric = result.metrics.find(item => item.id === criterion.metric_id);
          return make("tr",{},
            make("th",{scope:"row"},criterion.metric_id,make("span",{"class":"sdc-unit"},metric ? metric.unit : "")),
            [criterion.direction || "Unset",criterion.weight,criterion.normalized_weight,
              criterion.minimum === null ? "Unavailable" : criterion.minimum,
              criterion.maximum === null ? "Unavailable" : criterion.maximum,
              criterion.constant ? "Yes" : "No"].map(value => make("td",{},value))
          );
        })));
        section.append(make("p",{},"Min-max preference scores use the complete eligible cohort above. Positive weights sum to one after normalization. Constant criteria contribute zero. Zero-weight selected metrics still determine cohort eligibility."),table);
      }
      scopeBox.appendChild(section);
    }
    function populate() {
      if (!scopeBox) {
        content.append(
          make("p",{},"Delta is alternative minus baseline. Percent reduction is 100 × (baseline − alternative) / baseline. Native intersection changes remain visible when total support differs."),
          make("p",{},"Each reporting scope has a separate common set containing alternatives with comparable totals for every selected metric. The baseline is the reference, outside the choice set. Selected catchments are never summed. Changing the selected alternative set may change priority scores."),
          make("p",{"class":"sdc-help"},"Inspect one scope at a time below. Every scope and its full eligible cohort, exclusions and calculated ranges remain in the saved assessment and complete exports.")
        );
        scopeSelect = make("select",{
          id:prefix + "method-catchment",
          onchange:event => {
            state.method_catchment_id = event.target.value;
            renderScope();
            notify();
          }
        },result.groups.map(group => {
          const label = labels.get(group.catchment_id) || group.catchment_id;
          return make("option",{value:group.catchment_id},label + (label === group.catchment_id ? "" : " [" + group.catchment_id + "]"));
        }));
        scopeBox = make("div",{"class":"sdc-method-scope"});
        if (result.groups.length) content.append(
          make("label",{for:prefix + "method-catchment"},"Reporting scope for method details"),scopeSelect,scopeBox);
        else content.appendChild(make("p",{},"Select reporting scopes to inspect calculation membership."));
      }
      renderScope();
    }
    details.addEventListener("toggle",() => {if (details.open) populate();});
    details.open = !!wasOpen;
    if (details.open) populate();
    return {node:details,update:() => {if (details.open) populate();}};
  }
  function refreshMethod() {
    if (!result.groups.some(group => group.catchment_id === state.method_catchment_id)) {
      state.method_catchment_id = result.groups.length ? result.groups[0].catchment_id : "";
    }
    if (methodResult !== result) {
      const open = methodController && methodController.node.open;
      methodResult = result;
      methodController = methodDetails(open);
      methodBox.replaceChildren(methodController.node);
    } else if (methodController) methodController.update();
  }
  function contextLabel(row,key,label) {
    const baseline = row.baseline[key] || "Unspecified";
    const alternative = row.alternative[key] || "Unspecified";
    return label + ": " + (baseline === alternative ? alternative : "baseline " + baseline + "; alternative " + alternative);
  }
  function refreshResults() {
    const focusedId = document.activeElement && document.activeElement.id;
    const previousScrollLeft = resultBox.querySelector(".sdc-table-scroll")?.scrollLeft || 0;
    resultBox.replaceChildren();
    const matchingRows = viewRows();
    const rows = pageRows(matchingRows);
    if (countCache.result !== result) {
      countCache = {result,comparable:0,native:0};
      result.rows.forEach(row => {
        if (row.totals_comparable) countCache.comparable += 1;
        if (row.native_change && row.native_change.eligible) countCache.native += 1;
      });
    }
    status.textContent = "Showing comparison rows " + tableView.first_row + "–" + tableView.last_row + " of " + tableView.filtered_rows +
      " matching rows. Full selection: " + result.rows.length + " comparison rows, " + tableView.selected_alternatives +
      " distinct alternatives and " + tableView.selected_catchments + " reporting scopes. " + countCache.comparable +
      " comparable total pairs; " + countCache.native + " retained native changes; " + state.pinned_ids.length + " pinned alternatives.";
    resultBox.appendChild(make("p",{id:prefix + "physical-help","class":"sdc-help"},"Physical change = alternative − baseline. A negative export change is a reduction. Displayed numbers are rounded to seven significant digits; exports retain full numeric precision. Table pages and filters do not change the eligible choice cohorts."));
    if (rows.length) {
      resultBox.appendChild(pagination("top"));
      const table = make("table",{
        id:prefix + "comparison-table","class":"sdc-comparison","aria-rowcount":matchingRows.length + 1,
        "aria-describedby":prefix + "status " + prefix + "physical-help"
      });
      table.appendChild(make("caption",{"class":"sdc-visually-hidden"},"Selected retained scenario outputs and changes, page " + tableView.page + " of " + tableView.page_count + ". Baseline outputs repeat beside each alternative for direct comparison."));
      table.appendChild(make("thead",{},make("tr",{},
        make("th",{scope:"col"},"Pin"),sortHeader("Alternative","alternative"),sortHeader("Reporting scope","catchment"),
        sortHeader("Metric","metric"),sortHeader("Baseline total","baseline"),sortHeader("Alternative total","value"),
        sortHeader("Physical change","delta"),sortHeader("Reduction %","percent"),sortHeader("Choice analysis","priority"),
        make("th",{scope:"col"},"Context and exclusions")
      )));
      const body = make("tbody");
      const pinnedIds = new Set(state.pinned_ids);
      rows.forEach((row,index) => {
        const pinned = pinnedIds.has(row.alternative_id);
        const pin = make("button",{
          id:prefix + "pin-" + encodeURIComponent(row.key),type:"button","aria-pressed":pinned,
          "aria-label":(pinned ? "Unpin " : "Pin ") + row.alternative_label,
          onclick:() => {
            state.pinned_ids = pinned ? state.pinned_ids.filter(id => id !== row.alternative_id) : [...state.pinned_ids,row.alternative_id];
            state.table_page = 1;
            refresh();
          }
        },pinned ? "Pinned" : "Pin");
        const delta = make("td",{"class":"sdc-numeric"},
          make("strong",{},displayNumber(row.delta,true)),make("span",{"class":"sdc-unit"},row.unit),
          make("small",{},row.delta_basis === "same_support_totals" ? "Matching total support" :
            row.delta_basis === "retained_intersection_difference" ? "Retained valid intersection" : "No comparable change")
        );
        const choice = make("td");
        choice.appendChild(make("span",{"class":"sdc-tag"},
          row.pareto_status === "undominated" ? "Pareto undominated" :
          row.pareto_status === "dominated" ? "Pareto dominated" :
          row.pareto_status === "ineligible" ? "Outside common set" : "Directions / set needed"
        ));
        if (row.dominated_by.length) choice.appendChild(make("small",{},"Dominated by: " + row.dominated_by.join(", ")));
        if (row.priority_score !== null) choice.appendChild(make("p",{},"Priority " + displayNumber(row.priority_score) + " / 100; rank " + row.priority_rank + " in scope"));
        body.appendChild(make("tr",{"class":pinned ? "sdc-pinned" : "","aria-rowindex":tableView.first_row + index + 1,"data-sdc-row":row.key},
          make("td",{},pin),
          make("th",{scope:"row"},make("strong",{},row.alternative_label),make("span",{"class":"sdc-id"},row.alternative_id),identityView(row.alternative)),
          make("td",{},row.catchment_label,make("small",{"class":"sdc-id"},row.catchment_id),
            make("small",{"class":"sdc-id"},contextLabel(row,"domain_id","Domain")),
            make("small",{"class":"sdc-period"},contextLabel(row,"period_id","Period")),
            row.baseline.year || row.alternative.year ? make("small",{"class":"sdc-period"},contextLabel(row,"year","Year")) : null),
          make("td",{},row.metric_label,make("small",{"class":"sdc-id"},row.metric_id)),
          totalCell(row.baseline_measurement),totalCell(row.alternative_measurement),delta,
          make("td",{"class":"sdc-numeric"},row.percent_reduction === null ? "Undefined" : displayNumber(row.percent_reduction) + "%"),
          choice,rowNotes(row)
        ));
      });
      table.appendChild(body);
      const scroll = make("div",{id:prefix + "table-scroll","class":"sdc-table-scroll",tabindex:"0","aria-label":"Scenario comparison table; scroll horizontally for all columns"},table);
      resultBox.append(scroll,pagination("bottom"));
      scroll.scrollLeft = previousScrollLeft;
    } else {
      resultBox.appendChild(make("p",{"class":"sdc-empty"},result.rows.length ? "No rows match the current search, status and pin filters." : "Choose a baseline, alternatives, metrics and reporting scopes to populate this comparison."));
    }
    if (focusedId) {
      let restore = document.getElementById(focusedId);
      if ((!restore || restore.disabled) && focusedId.startsWith(prefix + "page-")) {
        restore = document.getElementById(prefix + "page-" + (focusedId.includes("-bottom-") ? "bottom" : "top") + "-number");
      }
      if (!restore && focusedId.startsWith(prefix + "pin-")) restore = document.getElementById(prefix + "page-top-number");
      if (restore && panel.contains(restore) && document.activeElement !== restore) restore.focus({preventScroll:true});
    }
  }
  function refresh() {
    if (destroyed) return;
    const nextCalculationKey = JSON.stringify({
      dataRevision,baseline_id:state.baseline_id,alternative_ids:state.alternative_ids,
      metric_ids:state.metric_ids,catchment_ids:state.catchment_ids,directions:state.directions,priority:state.priority
    });
    if (!result || nextCalculationKey !== calculationKey) {
      result = compute(rawData,state);
      calculationKey = nextCalculationKey;
    }
    refreshContext();
    refreshMethod();
    refreshResults();
    notify();
  }
  mergeState(options.initialState || {});
  rebuildControls();
  refresh();
  return {
    setData(nextData) {
      const previous = data;
      dataRevision += 1;
      rawData = nextData || {};
      data = normalizeDataset(rawData);
      if (!previous.alternatives.length && !state.alternative_ids.length) state.alternative_ids = data.alternatives.map(a => a.id);
      if (!previous.metrics.length && !state.metric_ids.length) state.metric_ids = data.metrics.map(m => m.id);
      if (!previous.catchment_ids.length && !state.catchment_ids.length) state.catchment_ids = data.catchment_ids.slice();
      mergeState();
      panel.querySelector(".sdc-version").textContent = "Workspace " + (data.workspace_id || "unspecified");
      rebuildControls();
      refresh();
    },
    setState(patch) {mergeState(patch); rebuildControls(); refresh();},
    getState:currentState,
    getComparison:() => clone(result),
    getTableView:() => tableView ? Object.assign({},tableView,{row_keys:tableView.row_keys.slice()}) : null,
    exportJSON:() => toJSON(Object.assign({},result,{view_state:currentState()})),
    exportCSV:() => toCSV(result),
    exportText:() => toText(result),
    destroy() {destroyed = true; panel.remove();}
  };
}
export function attachScenarioDecisions({container,data,initialState,onChange,onExport,onError,notifyAssessment}) {
  return mount(container,data,{initialState,onChange,onExport,onError,notifyAssessment});
}
