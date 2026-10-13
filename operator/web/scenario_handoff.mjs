import {nativeModelVersions,nativeModelsForOutputs,nativeCommonVersionIssues} from './native_versions.mjs';
/** Native selection handoff into the maintained fixed-scale scenario-analysis form.
 * Scope contract: OP12 selected-model V3 and model/model_selection.py.
 */
const OUTPUTS = Object.freeze({
  nitrogen_export:{unit:"kg/pixel/year",model:"ndr"},
  phosphorus_export:{unit:"kg/pixel/year",model:"ndr"},
  sediment_export:{unit:"metric_tonnes/pixel/year",model:"sdr"}
});
const OUTPUT_IDS = Object.keys(OUTPUTS);
const rows = value => Array.isArray(value) ? value : [];
const id = value => typeof value === "string" ? value.trim() : "";
const unique = values => [...new Set(values)];

/** Observed executor version takes precedence; old retained runs keep a labeled fallback. */
export function scenarioNativeVersion(run){
  const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
  const requested=text(run?.selection?.invest_version??run?.native_version?.requested);
  const observed=text(run?.runtime?.version??run?.native_version?.observed);
  return {requested,observed,comparison_version:observed||requested,
    basis:observed?'observed_runtime':requested?'requested_legacy':'unavailable',
    differs_from_requested:Boolean(observed&&requested&&observed!==requested)};
}

function expectedOutputs(run) {
  const models = run && run.selection && run.selection.models != null ? run.selection.models : ["ndr","sdr"];
  if (!Array.isArray(models) || !models.length || models.some(name => !["ndr","sdr"].includes(name))) return [];
  return OUTPUT_IDS.filter(metric => models.includes(OUTPUTS[metric].model));
}
function validArtifact(run,metric) {
  const artifact = run && run.artifacts && run.artifacts[metric];
  return Boolean(artifact && typeof artifact.path === "string" &&
    Number.isFinite(artifact.bytes) && artifact.bytes > 0 &&
    typeof artifact.sha256 === "string" && /^[0-9a-f]{64}$/.test(artifact.sha256) &&
    artifact.units === OUTPUTS[metric].unit);
}
function runReasons(run) {
  if (!run) return ["The original run is absent from the current workspace."];
  const reasons = [];
  if (run.state !== "complete") reasons.push("The original run is not complete.");
  if (run.model_scope && run.model_scope.selected_models_complete === false) {
    reasons.push("The run has not completed every native model selected for it.");
  }
  const expected = expectedOutputs(run);
  if (!expected.length) reasons.push("The original run has no valid retained NDR or SDR model selection.");
  for (const metric of expected) {
    if (!validArtifact(run,metric)) reasons.push("Completed original " + metric + " output is required in " + OUTPUTS[metric].unit + ".");
  }
  return reasons;
}
function nativeOutputs(run) {
  return runReasons(run).length ? [] : expectedOutputs(run);
}
function commonOutputs(runs) {
  const available = runs.map(nativeOutputs);
  return available.length ? OUTPUT_IDS.filter(metric => available.every(outputs => outputs.includes(metric))) : [];
}
/**
 * Uses the current native catalog behind the displayed decision cases.
 * Every accepted/rejected case retains its original identity. Main readiness
 * requires the whole accepted cohort to share an actual output; compatible
 * subsets are explicit alternatives when a mixed cohort has no intersection.
 */
export function buildScenarioAnalysisSeed({
  data,selection,nativeRuns,workspaceKey,title
} = {}) {
  const cases = new Map(rows(data && data.alternatives).filter(item => item && typeof item === "object" && id(item.id)).map(item => [id(item.id),item]));
  const runs = new Map(rows(nativeRuns).filter(run => run && typeof run === "object" && id(run.id)).map(run => [id(run.id),run]));
  const state = selection || {};
  const baselineCase = cases.get(id(state.baseline_id));
  const baselineRunId = id(baselineCase && baselineCase.run_id);
  const baseline = runs.get(baselineRunId);
  const baselineIssues = [];
  if (!baselineCase) baselineIssues.push("Choose a baseline from the current comparison.");
  if (!baselineRunId) baselineIssues.push("The selected baseline has no retained native run identity.");
  baselineIssues.push(...runReasons(baseline));
  const gridId = id(baseline && baseline.selection && baseline.selection.grid_id);
  const baselineVersion = scenarioNativeVersion(baseline);
  if (baseline && !gridId) baselineIssues.push("The selected baseline has no retained model-grid identity.");
  const baselineOutputs = nativeOutputs(baseline);
  const selectedCaseIds = unique(rows(state.alternative_ids).map(id).filter(value => value && value !== id(state.baseline_id)));
  const accepted = [],rejected = [];
  for (const caseId of selectedCaseIds) {
    const item = cases.get(caseId),runId = id(item && item.run_id),run = runs.get(runId);
    const reasons = [];
    if (!item) reasons.push("This case is absent from the current comparison source.");
    if (!runId) reasons.push("This case has no retained native run identity.");
    reasons.push(...runReasons(run));
    if (run && runId === baselineRunId) reasons.push("The baseline reference is outside the alternative choice set.");
    if (run && id(run.selection && run.selection.grid_id) !== gridId) reasons.push("The native run uses a different model grid from the baseline.");
    const version = scenarioNativeVersion(run);
    const available = nativeOutputs(run);
    if (baselineOutputs.length && available.length && !baselineOutputs.some(metric => available.includes(metric))) {
      reasons.push("The native run and selected baseline have no shared nutrient or sediment output.");
    }
    const row = {
      case_id:caseId,run_id:runId,label:id(item && item.label) || caseId,
      available_metric_ids:available,native_version:version,
      native_model_versions:run?nativeModelVersions(run):{}
    };
    if (reasons.length) rejected.push({...row,reasons:unique(reasons)});
    else accepted.push(row);
  }
  const scenarioRunIds = unique(accepted.map(item => item.run_id));
  const shared = commonOutputs([baseline,...scenarioRunIds.map(runId => runs.get(runId))]);
  const cohortIssues = [];
  const versionIssues=shared.length?nativeCommonVersionIssues([baseline,...scenarioRunIds.map(runId=>runs.get(runId))],nativeModelsForOutputs(shared)):[];
  cohortIssues.push(...versionIssues);
  if (scenarioRunIds.length && !shared.length) {
    cohortIssues.push("The accepted runs have no native output shared by the entire cohort. Choose an explicit nutrient or sediment continuation.");
  }
  if (selectedCaseIds.length && !scenarioRunIds.length) {
    cohortIssues.push("None of the selected alternatives is compatible with this native baseline. Review the case reasons or select a baseline analysis.");
  }
  const baseTitle = (id(title) || "Watershed scenario analysis").slice(0,240);
  const requestFor = (runIds,requestTitle=baseTitle) => ({
    workspace_key:id(workspaceKey),
    selection:{title:requestTitle,baseline_run_id:baselineRunId,scenario_run_ids:runIds.slice()}
  });
  const compatibleCohorts = [];
  if (!baselineIssues.length && scenarioRunIds.length && (!shared.length||versionIssues.length)) {
    for (const model of ["ndr","sdr"]) {
      const wanted = OUTPUT_IDS.filter(metric => OUTPUTS[metric].model === model);
      if (!wanted.every(metric => baselineOutputs.includes(metric))) continue;
      const coveredCases = accepted.filter(item => wanted.every(metric => item.available_metric_ids.includes(metric))&&
        !nativeCommonVersionIssues([baseline,runs.get(item.run_id)],[model]).length);
      const runIds = unique(coveredCases.map(item => item.run_id));
      if (!runIds.length) continue;
      const metricIds = commonOutputs([baseline,...runIds.map(runId => runs.get(runId))]);
      if (!metricIds.length||nativeCommonVersionIssues([baseline,...runIds.map(runId=>runs.get(runId))],nativeModelsForOutputs(metricIds)).length) continue;
      const cohortTitle = model === "ndr" ? "Nutrient scenarios" : "Sediment scenarios";
      compatibleCohorts.push({
        id:model,title:cohortTitle,metric_ids:metricIds,
        baseline_run_id:baselineRunId,scenario_run_ids:runIds,
        case_ids:coveredCases.map(item => item.case_id),
        case_count:coveredCases.length,alternative_count:runIds.length,
        request:requestFor(runIds,baseTitle.slice(0,210) + " — " + cohortTitle)
      });
    }
  }
  return {
    ready:baselineIssues.length === 0 && cohortIssues.length === 0 && shared.length > 0,
    target_extension_id:"scenario-analysis",target_method:"create",
    request:requestFor(scenarioRunIds),
    baseline_issues:unique(baselineIssues),cohort_issues:cohortIssues,
    accepted_cases:accepted,rejected_cases:rejected,
    selected_case_count:selectedCaseIds.length,accepted_run_count:scenarioRunIds.length,
    compatible_cohorts:compatibleCohorts,
    source_context:{
      workspace_id:id(data && data.workspace_id),
      baseline_case_id:id(state.baseline_id),alternative_case_ids:selectedCaseIds,
      metric_ids:rows(state.metric_ids).map(id),catchment_ids:rows(state.catchment_ids).map(id)
    },
    target_metric_ids:shared,baseline_native_version:baselineVersion,
    baseline_native_model_versions:baseline?nativeModelVersions(baseline):{},
    method:"The target form uses the cohort's actual shared native outputs, fixed baseline caps, explicit planning weights and retained source areas."
  };
}
