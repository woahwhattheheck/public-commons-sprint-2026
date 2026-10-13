/** Per-native-model execution identity, including retained completed-stage reuse. */
const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
export const NATIVE_VERSION_POLICY='completed_stage_runtime_else_observed_run_else_labeled_requested_legacy';
export function nativeRunVersion(run){
  const requested=text(run?.selection?.invest_version),observed=text(run?.runtime?.version);
  return {requested,observed,comparison_version:observed||requested,
    basis:observed?'observed_runtime':requested?'requested_legacy':'unavailable',
    differs_from_requested:!!(observed&&requested&&observed!==requested)};
}
export function nativeModelVersions(run,models=run?.selection?.models||['ndr','sdr']){
  const parent=nativeRunVersion(run);
  return Object.fromEntries(models.map(model=>{
    const stage=run?.stages?.[model]||run?.stage_summary?.[model]||{};
    const observed=stage.completed_at?text(stage.runtime?.version):null;
    const effective=observed||parent.comparison_version;
    return [model,{model,comparison_version:effective,
      basis:observed?'completed_stage_runtime':parent.observed?'observed_run_fallback':parent.basis,
      observed_stage_version:observed,observed_run_version:parent.observed,
      requested_version:parent.requested,differs_from_requested:!!(effective&&parent.requested&&effective!==parent.requested),
      stage_completed_at:stage.completed_at||null,reused_from:stage.reused_from||null}];
  }));
}
export function nativeModelsForOutputs(outputs){
  const selected=new Set(outputs||[]);
  return [['ndr',['nitrogen_export','phosphorus_export']],['sdr',['sediment_export']]]
    .filter(([,names])=>names.some(name=>selected.has(name))).map(([model])=>model);
}
export function nativeCommonVersionIssues(runs,models){
  if(!runs?.length||runs.some(run=>!run)||!models?.length)return ['Choose completed runs with common native models.'];
  const baseline=nativeModelVersions(runs[0],models),issues=[];
  for(const run of runs){
    const current=nativeModelVersions(run,models);
    for(const model of models){
      const version=current[model].comparison_version,target=baseline[model].comparison_version;
      if(!version)issues.push(model.toUpperCase()+' has no completed-stage, observed-run or retained requested version for '+(run.id||'this run')+'.');
      else if(version!==target)issues.push(model.toUpperCase()+' execution '+version+' differs from baseline '+(target||'unavailable')+' for '+(run.id||'this run')+'.');
    }
  }
  return issues;
}
export function nativeModelVersionLabel(run,models=run?.model_versions?Object.keys(run.model_versions):run?.models||run?.selection?.models||['ndr','sdr']){
  const versions=run?.model_versions||nativeModelVersions(run,models);
  return models.map(model=>{
    const value=versions[model]||{},basis=value.basis==='completed_stage_runtime'?'stage':value.basis==='observed_run_fallback'?'run fallback':value.basis==='requested_legacy'?'legacy requested':'unavailable';
    return model.toUpperCase()+' '+(value.comparison_version||'unknown')+' ('+basis+')'+
      (value.differs_from_requested?' · declared '+value.requested_version:'');
  }).join('; ');
}
