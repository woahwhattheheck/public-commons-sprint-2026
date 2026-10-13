/** Readable presentation of the original native snapshot; never changes a task. */
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const outputNames={nitrogen_export:'Nitrogen delivered to streams',phosphorus_export:'Phosphorus delivered to streams',sediment_export:'Sediment delivered to streams'};
const phaseLabels={
  grid:['Preparing the selected model grid','Opening the saved grid and the original selected input files.'],
  runtime:['Opening the scientific runtime','Loading the selected model implementation.'],
  sources:['Opening original source inputs','Reading the parameter table and original source editions.'],
  landcover:['Preparing the selected land-cover scenario','Retaining the actual scenario raster before model execution.'],
  stage_identity:['Matching the selected scientific inputs','Resolving the original model, parameters and input identities.'],
  waiting_stage:['Waiting for the matching calculation','The existing native scheduler owns the matching scientific stage.'],
  stage_reuse:['Receiving completed scientific work','Matching and retaining a compatible original stage before continuing.'],
  validate:['Checking scientific inputs','The selected native model is checking its actual arguments and source files.'],
  native:['Calculating the selected model','The original scientific model is running with the saved selection.'],
  retain_stage:['Saving the completed model stage','Retaining its original output files and source identity.'],
  export:['Preparing physical result rasters','Converting the retained native outputs onto their selected reporting support.']
};
const title=(row,fallback)=>text(row?.title)||text(row?.spec?.title)||text(row?.name)||fallback;
const record=(data,kind,id)=>list(data?.[kind]).find(row=>row?.id===id);
const words=value=>String(value??'').replaceAll('_',' ');
const plainIssue=value=>{const message=text(value);return message&&!/[\r\n]/.test(message)&&message.length<=360?message:'The original calculation returned an input or runtime issue. Open its saved details below.';};

export function nativePresentation(snapshot,state){
  const task=snapshot?.task||{},native=snapshot?.native_job||{},data=state?.data||{};
  const selection=native.selection||{},scenario=record(data,'scenarios',selection.scenario_id);
  const profile=record(data,'profiles',selection.profile_id),grid=record(data,'grids',selection.grid_id);
  const chosen=selection.models===undefined?['ndr','sdr']:list(selection.models);
  const models=['ndr','sdr'].filter(name=>chosen.includes(name));
  const stages=native.stages||{},artifacts=native.artifacts||{};
  const context=native.study_context?'Parameter-study case':native.programme_context?'Programme case':native.ensemble_context?'Ensemble case':'Selected calculation';
  const fields=[
    {label:'Scenario',value:title(scenario,'Saved scenario'),kind:'scenarios',id:selection.scenario_id},
    {label:'Parameter profile',value:title(profile,'Saved parameter profile'),kind:'profiles',id:selection.profile_id},
    {label:'Model grid',value:title(grid,'Saved model grid'),kind:'grids',id:selection.grid_id},
    {label:'Scientific models',value:models.map(name=>name==='ndr'?'Nutrients (NDR)':'Sediment (SDR)').join(' + ')||'Read the selected model record'}
  ];
  if(text(profile?.model_period))fields.push({label:'Model period',value:profile.model_period});
  const gridBody=grid?.grid||{};
  const crs=text(gridBody.crs_name)||text(gridBody.crs);
  if(crs)fields.push({label:'Coordinate system',value:crs});
  const collection=record(data,'sources',profile?.source_collection_id);
  const entry=list(collection?.entries).find(row=>row.id===profile?.biophysical_source_id);
  if(entry){
    fields.push({label:'Biophysical source',value:title(entry,'Retained biophysical table')});
    if(text(entry.vintage))fields.push({label:'Source edition',value:entry.vintage});
  }
  const resultState=native.run_state==='complete'?'complete':Object.keys(artifacts).length?'partial':'pending';
  const outputs=Object.entries(artifacts).map(([name,value])=>({
    key:name,label:outputNames[name]||words(name),state:resultState,
    total:finite(value?.sum)?value.sum:null,units:text(value?.sum_units)||text(value?.units),
    bytes:finite(value?.bytes)?value.bytes:null,path:text(value?.path)
  }));
  const completeStages=models.filter(name=>Boolean(stages[name]));
  const retainedText=completeStages.length?
    completeStages.map(name=>name.toUpperCase()).join(' and ')+' completed '+(completeStages.length===1?'stage is':'stages are')+' retained.':
    'No completed selected model stage has been recorded yet.';
  let heading='Prepared calculation',message='The saved scientific selection is ready for its original execution task.',tone='normal';
  if(native.stop_requested&&(native.alive||(native.ensemble_context&&task.state==='running'))){
    if(native.alive){
      heading='Stopping this calculation';message='The original worker is closing. Its completed stages remain saved; wait for the stopped state before continuing.';
    }else{
      heading='Stopping saved ensemble';message='Stop is saved for this same ensemble. The coordinator will pause at the case boundary; completed case outputs remain available.';
    }
  }else if(native.alive){
    [heading,message]=phaseLabels[native.native_execution?.phase]||['Calculation running','The original worker is running the saved scientific selection.'];
    if(native.native_execution?.model)heading+=' · '+String(native.native_execution.model).toUpperCase();
    if(task.state==='interrupted')message+=' Reconnect to follow this same running worker.';
  }else if(native.run_state==='complete'){
    heading='Selected case complete';message='Open the native result to inspect its maps, physical quantities and original files.';
    if(native.study_context||native.programme_context||native.ensemble_context)message+=' This is the selected case; the parent task determines whether the whole study, programme or ensemble has finished.';
  }else if(task.state==='queued'){
    heading='Waiting in the calculation queue';message='The original task is queued with this saved input selection.';
  }else if(task.state==='cancelled'||native.run_error?.kind==='interrupted'){
    heading='Calculation stopped';message='The saved selection and completed stages remain available. Resume the original task when ready.';
  }else if(task.state==='interrupted'){
    heading='Saved calculation available to continue';message='The operator reopened. Resume the original task to reconcile its saved worker and completed stages.';
  }else if(task.state==='failed'||native.run_state==='failed'){
    tone='attention';heading='Calculation needs attention';
    message='Read the saved issue and correct its input or runtime cause before resuming the same task.';
  }
  const taskIssue=task.error?.code==='NATIVE_DETACHED'?null:task.error;
  const currentTaskIssue=taskIssue&&['failed','interrupted','cancelled'].includes(task.state)?taskIssue:null;
  const issue=currentTaskIssue||native.run_error||taskIssue||native.failure||null;
  let problem=null;
  if(issue){
    const historical=!currentTaskIssue&&(native.alive||native.run_state==='complete');
    let label='Saved calculation issue',explanation=plainIssue(issue.message),next=text(issue.recovery)||'Read the original issue details, correct the reported cause, then continue this same saved task.';
    if(issue.kind==='storage_exhausted'){
      label='The calculation ran out of storage';
      explanation='The native run could not write to its selected workspace filesystem.';
      next='Make space on that workspace volume, preserving original inputs and completed results, then resume this same task.';
    }else if(issue.kind==='native_process_interrupted'){
      label='The scientific worker ended before completion';
      explanation=issue.exit_observation==='signal'&&text(issue.signal?.name)?
        'The saved process observation records '+issue.signal.name+'.':'The saved worker is no longer running and has no completed result.';
      next='Check the saved host and process observations, resolve the interruption, then resume the same study, programme or run.';
    }else if(issue.kind==='interrupted'||task.error?.code==='NATIVE_STOPPED'){
      label='The original calculation was stopped';explanation='The stopped attempt retained its completed scientific stages.';
      next='Resume the same original task when ready to continue its unfinished work.';
    }
    problem={label,explanation,next,historical,original:issue,technicalMessage:text(issue.message)};
  }
  const filename=outputs.find(row=>row.key===native.native_execution?.artifact)?.label;
  if(filename&&native.alive&&native.native_execution?.phase==='export')message+=' Current result: '+filename+'.';
  return {
    context,title:title(scenario,'Saved scenario')+' · '+title(profile,'Saved parameter profile'),
    fields,models,heading,message,tone,retainedText,outputs,resultState,problem,
    outputNote:'These annual model exports describe delivery to streams on the saved reporting support. Interpret the original units and model period with the source profile; they are not intake concentrations.',
    runId:native.run_id,taskId:task.id,
    canOpenResult:Boolean(native.run_id),
    originalIdentity:{selection,run_id:native.run_id,task_id:task.id,
      execution_id:native.execution_id,programme:native.programme_context,parameter_study:native.study_context,ensemble:native.ensemble_context}
  };
}

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const quantity=value=>finite(value)?value.toLocaleString(undefined,{maximumFractionDigits:6}):'No total recorded';
const action=(kind,id,label)=>id?'<button type="button" data-action="native-job-input" data-kind="'+escape(kind)+'" data-id="'+escape(id)+'">'+escape(label)+'</button>':'';
export function selectionMarkup(view){
  return '<p class="native-eyebrow">'+escape(view.context)+'</p><h3>'+escape(view.title)+'</h3>'+
    '<dl class="native-selection-fields">'+view.fields.map(row=>'<div><dt>'+escape(row.label)+'</dt><dd>'+escape(row.value)+
      (row.kind?action(row.kind,row.id,'Open '+row.label.toLowerCase()):'')+'</dd></div>').join('')+'</dl>';
}
export function outputsMarkup(view){
  if(!view.outputs.length)return '<h3>Saved physical results</h3><p class="note">Results will appear as the original calculation retains them.</p>';
  return '<h3>Saved physical results</h3><p class="note">'+
    (view.resultState==='complete'?'The selected case is complete.':'The calculation is unfinished; these are its currently retained outputs.')+'</p>'+
    '<div class="table-scroll"><table><thead><tr><th scope="col">Result</th><th scope="col">Retained total</th><th scope="col">Original units</th></tr></thead><tbody>'+
    view.outputs.map(row=>'<tr><th scope="row">'+escape(row.label)+'</th><td>'+escape(quantity(row.total))+'</td><td>'+escape(row.units||'Read original artifact metadata')+'</td></tr>').join('')+
    '</tbody></table></div><p class="note">'+escape(view.outputNote)+'</p>';
}
export function issueMarkup(view){
  const issue=view.problem;if(!issue)return '';
  return '<div class="native-issue-summary"><h3>'+escape(issue.historical?'Earlier saved issue':issue.label)+'</h3>'+
    '<p>'+escape(issue.explanation)+'</p>'+(!issue.historical?'<p><strong>Continue:</strong> '+escape(issue.next)+'</p>':'<p class="note">The current calculation state is shown above. This original issue remains available as history.</p>')+'</div>'+
    '<details data-native-issue-details><summary>Original issue and technical details</summary><pre>'+escape(JSON.stringify(issue.original,null,2))+'</pre></details>';
}
