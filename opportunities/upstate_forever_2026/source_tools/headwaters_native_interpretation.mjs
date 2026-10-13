/** Interpret the retained twelve-run teaching case; never dispatch native models. */
const POLLUTANTS = ["nitrogen_export", "phosphorus_export", "sediment_export"];
const BASELINE = "63f5d52029585807ff8f4d5e8d5fff0972adf7c01811d97cab3edbee3d9658d7";
const RIPARIAN = "8d419f1c618cc7a5025c01eb40f173afbbe6919e4ba96580f6e7e1e36943d65d";
const CONTROL = "28044212ab992451e31b5e9e6dc831a9221a5ef53ac136ea56b2af063f70f223";
function demand(ok, message) { if (!ok) throw new Error(message); }
function sameNumber(a,b) { return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= Math.max(1e-8, Math.abs(a)*1e-10, Math.abs(b)*1e-10); }
export function analyzeNative(originals, inputAnalysis) {
  const report = JSON.parse(originals["numeric/report.json"]);
  const release = JSON.parse(originals["numeric/release.json"]);
  const runs = JSON.parse(originals["original/native-runs.json"]);
  const ensemble = JSON.parse(originals["original/ensemble.json"]);
  const profiles = Object.fromEntries(Object.entries(originals).filter(([p])=>p.startsWith("original/profiles/")).map(([,s])=>{const p=JSON.parse(s);return [p.id,p];}));
  demand(report.report.state==="complete" && report.report.report_state==="current", "Use the original complete current native report");
  demand(report.report.progress.complete===12 && report.report.progress.total===12, "The original twelve-run course must be complete");
  demand(report.report.errors.length===0 && report.report.run_errors.length===0, "Retain and resolve original native report errors");
  demand(report.ensemble_id===ensemble.id && release.ensemble_id===ensemble.id && release.run_signature===report.report.run_signature, "Original ensemble/release identity mismatch");
  demand(report.paired_rows.length===24 && report.parameter_rows.length===9 && Object.keys(runs).length===12, "Use the complete original source cohort");
  const profileRows = report.report.members.map(m=>{
    const p=profiles[m.profile_id];
    demand(p && p.table_summary.sha256==="bd5d7a436a302df751e57f63c188216402f13acdfff26c847b9b83733651fd94", "Original coefficient table changed");
    demand(p.ndr.flow_dir_algorithm===p.sdr.flow_dir_algorithm, "Mixed original routing profile");
    return {profile_id:p.id,member_id:m.id,routing:p.ndr.flow_dir_algorithm,l_max:p.sdr.l_max,runs:m.runs.map(x=>({...x}))};
  });
  demand(new Set(profileRows.map(p=>p.routing+"/"+p.l_max)).size===4, "Preserve all four original profiles");
  const byProfile=Object.fromEntries(profileRows.map(p=>[p.profile_id,p]));
  const inventory=[];
  for (const p of profileRows) for (const selected of p.runs) {
    const run=runs[selected.run_id];
    demand(run && run.id===selected.run_id && run.state==="complete" && run.selection.profile_id===p.profile_id && run.selection.scenario_id===selected.scenario_id, "Original run binding differs");
    demand(run.runtime.version==="3.20.0", "Expected retained InVEST 3.20.0");
    for (const model of ["ndr","sdr"]) {
      const signature=run.stages[model].input_signature.selection;
      demand(signature.arguments.flow_dir_algorithm===p.routing && signature.inputs.biophysical_table_path.sha256==="bd5d7a436a302df751e57f63c188216402f13acdfff26c847b9b83733651fd94", "Native stage arguments/table differ from profile");
    }
    demand(run.stages.sdr.input_signature.selection.arguments.l_max===p.l_max && !run.stages.sdr.reused_from, "Preserve the original independently executed SDR cap");
    for (const pollutant of POLLUTANTS) {
      const a=run.artifacts[pollutant];
      demand(a && Number.isFinite(a.sum) && a.pixel_area_ha===0.09 && a.valid_cells>0, "Missing original native artifact");
      inventory.push({run_id:run.id,profile_id:p.profile_id,routing:p.routing,l_max:p.l_max,scenario_id:selected.scenario_id,pollutant,sum:a.sum,units:a.sum_units,valid_cells:a.valid_cells,pixel_area_ha:a.pixel_area_ha,sha256:a.sha256,native_sha256:a.native_output.sha256,native_units:a.native_units,completed_at:run.completed_at,source_pointer:"/original/native-runs.json#/"+run.id+"/artifacts/"+pollutant});
    }
  }
  const scenarioRows=report.paired_rows.map((row,index)=>{
    const p=byProfile[row.profile_id];
    demand(p && POLLUTANTS.includes(row.pollutant) && [RIPARIAN,CONTROL].includes(row.scenario_id), "Unexpected original scenario comparison");
    const b=runs[row.baseline_run_id],a=runs[row.alternative_run_id];
    demand(b.selection.scenario_id===BASELINE && a.selection.scenario_id===row.scenario_id && b.selection.profile_id===p.profile_id && a.selection.profile_id===p.profile_id,"Comparison/run selections disagree");
    for(const [run,artifact] of [[b,row.baseline_artifact],[a,row.alternative_artifact]]) demand(run.artifacts[row.pollutant].sha256===artifact.sha256, "Original comparison artifact identity changed");
    demand(sameNumber(row.alternative_common-row.baseline_common,row.delta_common), "Original comparison arithmetic differs");
    demand(row.baseline_only_cells===0 && row.alternative_only_cells===0 && row.common_cells===row.baseline_valid_cells && row.common_cells===row.alternative_valid_cells, "This interpretation requires the original equal scenario supports");
    return {profile_id:p.profile_id,member_id:row.member_id,routing:p.routing,l_max:p.l_max,scenario:row.scenario_id===RIPARIAN?"riparian":"matched_control",scenario_id:row.scenario_id,pollutant:row.pollutant,units:row.total_units,baseline:row.baseline_common,alternative:row.alternative_common,reduction:-row.delta_common,reduction_percent:-row.percent_change,common_cells:row.common_cells,common_area_ha:row.common_cells*0.09,support_sha256:row.common_support_sha256,baseline_run_id:row.baseline_run_id,alternative_run_id:row.alternative_run_id,comparison_id:row.comparison_id,source_pointer:"numeric/report.json#/paired_rows/"+index};
  });
  const placement=[];
  for(const p of profileRows) for(const pollutant of POLLUTANTS) {
    const a=scenarioRows.filter(x=>x.profile_id===p.profile_id&&x.pollutant===pollutant);
    demand(a.length===2, "One original scenario pair is missing");
    const rip=a.find(x=>x.scenario==="riparian"),ctrl=a.find(x=>x.scenario==="matched_control");
    demand(rip.support_sha256===ctrl.support_sha256 && rip.common_cells===ctrl.common_cells && rip.baseline===ctrl.baseline && rip.baseline_run_id===ctrl.baseline_run_id,"Use an identical original all-three support");
    placement.push({profile_id:p.profile_id,routing:p.routing,l_max:p.l_max,pollutant,units:rip.units,baseline:rip.baseline,riparian:rip.alternative,matched_control:ctrl.alternative,riparian_reduction:rip.reduction,control_reduction:ctrl.reduction,placement_margin:ctrl.alternative-rip.alternative,reduction_ratio:ctrl.reduction===0?null:rip.reduction/ctrl.reduction,common_cells:rip.common_cells,common_area_ha:rip.common_area_ha,support_sha256:rip.support_sha256,source_pointers:[rip.source_pointer,ctrl.source_pointer]});
  }
  const parameterRows=report.parameter_rows.map((r,i)=>{
    demand(sameNumber(r.alternative_common-r.baseline_common,r.delta_common), "Original parameter arithmetic differs");
    const p=byProfile[r.profile_id],ref=byProfile[r.reference_profile_id];
    demand(p&&ref,"Original parameter profiles missing");
    return {profile_id:p.profile_id,reference_profile_id:ref.profile_id,routing:p.routing,l_max:p.l_max,reference_routing:ref.routing,reference_l_max:ref.l_max,pollutant:r.pollutant,units:r.total_units,reference_common:r.baseline_common,alternative_common:r.alternative_common,delta_common:r.delta_common,percent_change:r.percent_change,reference_total:r.baseline_total,alternative_total:r.alternative_total,whole_total_difference:r.alternative_total-r.baseline_total,support_only_difference:r.alternative_only_total-r.baseline_only_total,decomposition_residual:(r.alternative_total-r.baseline_total)-(r.delta_common+r.alternative_only_total-r.baseline_only_total),common_cells:r.common_cells,common_area_ha:r.common_cells*0.09,support_sha256:r.common_support_sha256,reference_only_cells:r.baseline_only_cells,alternative_only_cells:r.alternative_only_cells,alternative_only_total:r.alternative_only_total,comparison_id:r.comparison_id,source_pointer:"numeric/report.json#/parameter_rows/"+i};
  });
  const capChecks=[];
  for(const routing of ["mfd","d8"]) for(const scenario_id of [BASELINE,RIPARIAN,CONTROL]) for(const pollutant of POLLUTANTS) {
    const a=inventory.find(x=>x.routing===routing&&x.l_max===122&&x.scenario_id===scenario_id&&x.pollutant===pollutant);
    const b=inventory.find(x=>x.routing===routing&&x.l_max===333&&x.scenario_id===scenario_id&&x.pollutant===pollutant);
    demand(a&&b,"Missing original cap comparison");
    capChecks.push({routing,scenario_id,pollutant,run_122:a.run_id,run_333:b.run_id,sum_122:a.sum,sum_333:b.sum,units:a.units,sum_identical:a.sum===b.sum,native_sha_identical:a.native_sha256===b.native_sha256,converted_sha_identical:a.sha256===b.sha256,native_sha_122:a.native_sha256,native_sha_333:b.native_sha256,converted_sha_122:a.sha256,converted_sha_333:b.sha256,source_pointers:[a.source_pointer,b.source_pointer]});
  }
  const inputRows=inputAnalysis.quantities.map(x=>({...x}));
  demand(inputAnalysis.demo_id==="upstate-simulated-piedmont-headwaters-v1" && inputRows.find(x=>x.id==="riparian").changed_cells===635 && inputRows.find(x=>x.id==="matched_control").changed_cells===635, "Use the retained original input interpretation");
  const timeRows=Object.values(runs).map(r=>({run_id:r.id,created_at:r.created_at,completed_at:r.completed_at,stages:Object.fromEntries(Object.entries(r.stages||{}).map(([k,v])=>[k,{state:v.state,started_at:v.started_at,completed_at:v.completed_at,reused_from:v.reused_from,reused_at:v.reused_at,input_signature_id:v.input_signature?.id,model_arguments:v.input_signature?.selection?.arguments}]))}));
  const modelStages=Object.values(runs).flatMap(r=>["ndr","sdr"].map(k=>r.stages[k]));
  const firstStart=modelStages.map(x=>x.started_at).sort()[0], lastComplete=Object.values(runs).map(x=>x.completed_at).sort().at(-1);
  const timing={first_retained_model_stage_start:firstStart,last_run_complete:lastComplete,stage_window_seconds:(Date.parse(lastComplete)-Date.parse(firstStart))/1000,reused_model_stages:modelStages.filter(x=>x.reused_from).length,retained_model_stages:modelStages.length,basis:"Wall-clock interval between first retained model-stage start and last original run completion; includes original reuse and excludes setup, source preparation, report generation and handover."};
  return {schema:"upstate.headwaters-native-interpretation/v1",classification:"SIMULATED DEMONSTRATION INPUTS; ORIGINAL COMPLETED NATIVE OUTPUTS",scope:{demo_id:inputAnalysis.demo_id,grid_cells:14400,pixel_area_ha:0.09,grid_area_ha:1296,changed_cells:635,changed_area_ha:57.15,interpretation:"Original teaching-case geometry and assumed input fields; separate from the Upper Savannah geographic edition."},source:{ensemble_id:ensemble.id,report_id:release.id,run_signature:release.run_signature,report_created_at:release.created_at,native_version:"3.20.0",progress:report.report.progress},profiles:profileRows,scenario_rows:scenarioRows,placement_rows:placement,parameter_rows:parameterRows,cap_identity:capChecks,native_inventory:inventory,input_quantities:inputRows,timing,run_timing:timeRows};
}
