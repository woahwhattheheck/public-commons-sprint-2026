/**
 * Continue the original Geographic case through the maintained Programme UI.
 * The caller owns Chromium, receiving admission, retained files and cutoff.
 * Only adopt_completed may queue the existing completed-output adoption action.
 */
const rows=value=>Array.isArray(value)?value:[];
const nativeIds=prepared=>[prepared.baseline_run_id,...rows(prepared.alternative_run_ids)];
const scenarios=prepared=>[prepared.baseline_scenario_id,...rows(prepared.alternative_scenario_ids)];
const terminal=new Set(['complete','failed','interrupted','cancelled']);
const annualUnits={nitrogen_export:'kg/year',phosphorus_export:'kg/year',sediment_export:'metric_tonnes/year'};
const ident=value=>{
 if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(value))throw new Error('Use the original retained Programme identifier');
 return value;
};

export function validateGeographicProgramme(prepared,preview,result,equal,requireValue){
 const binding=preview?.binding,ids=nativeIds(prepared);
 requireValue(preview?.schema==='upstate.geographic-programme-preview/v1'&&binding?.geographic_id===prepared.id&&
  binding.project_id===prepared.project_id&&binding.grid_id===prepared.grid_id&&binding.profile_id===prepared.profile_id&&
  binding.source_collection_id===prepared.source_collection_id&&equal(binding.run_ids,ids)&&
  equal(binding.scenario_ids,scenarios(prepared)),'The Programme preview differs from the original Geographic cohort');
 requireValue(ids.length===3&&new Set(ids).size===3&&
  equal(rows(preview.selection?.runs).map(row=>row.native_run_id),ids)&&
  equal(rows(preview.runs).map(row=>row.run_id),ids),'The Programme must retain baseline, restoration and matched control');
 if(!result)return;
 requireValue(result.schema==='upstate.geographic-programme-adoption/v1'&&
  result.project_id===prepared.project_id&&result.geographic_id===prepared.id&&
  result.preview_id===preview.id&&equal(result.binding,binding)&&result.programme_state==='complete',
  'The completed Programme operation belongs to another original source selection');
 ident(result.programme_id);
 requireValue(equal(rows(result.native_runs).map(row=>row.run_id),ids),'Programme adoption replaced an original native run');
 const expected=new Set(ids.flatMap(id=>Object.keys(annualUnits).map(p=>id+':'+p)));
 const actual=rows(result.report?.rows);
 requireValue(actual.length===9&&new Set(actual.map(row=>row.run_id+':'+row.pollutant)).size===9&&
  actual.every(row=>expected.has(row.run_id+':'+row.pollutant)&&row.state==='complete'&&row.artifact&&row.units===annualUnits[row.pollutant]),
  'The original Programme catalogue must contain each completed N/P/sediment quantity once');
}

/** All UI actions use the original page; api is the caller's authenticated GET reader. */
export async function operateGeographicProgramme(options){
 const {page,prepared,record,completion,delivered,course,mode='inspect',api,readJSON,verified,equal,requireValue,check,waitFor,
  saveRecord,screenshot,action,download,ticketDownloads,click,closeDialog,navigate}=options;
 requireValue(['inspect','adopt_completed'].includes(mode),'Choose inspect or adopt_completed for the original Programme');
 const caseId=ident(prepared.id),deliveryId=ident(record.delivery_id);
 const label='geographic-programme',query={case_id:caseId,delivery_id:deliveryId};
 const programmeBody='[data-geo-programme-body]';
 await waitFor(async()=>await page.locator('[data-geo-programme-delivery]').count()===1,'Geographic Programme controls');
 const before=await api('/api/state');
 const originalRows=state=>rows(state.data?.runs).filter(row=>rows(course.planned_run_ids).includes(row.id))
  .map(row=>({id:row.id,state:row.state})).sort((a,b)=>a.id.localeCompare(b.id));
 const beforeRuns=originalRows(before);
 requireValue(beforeRuns.length===rows(course.planned_run_ids).length,'The restored Programme course omits original planned native runs');
 const snapshot=async()=>{
  const [saved,state]=await Promise.all([api('/api/geographic-headwaters/case',{case_id:caseId}),api('/api/state')]);
  requireValue(equal(saved.case,prepared),'The Geographic preparation changed during Programme inspection');
  const operations=new Map(rows(saved.programme_operations).map(row=>[row.id,row]));
  for(const row of rows(state.tasks))if(row.action==='geography.adopt-programme'&&row.payload?.case_id===caseId)
   operations.set(row.id,{...operations.get(row.id),...row,restored:false});
  return {saved,state,operations:[...operations.values()].filter(row=>(row.payload?.delivery_id||'')===deliveryId)
   .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))};
 };
 const assertUnchanged=async()=>{
  const after=await api('/api/state');
  for(const kind of ['sources','profiles','grids','scenarios','runs','deliveries']){
   const ids=state=>rows(state.data?.[kind]).map(row=>row.id).sort();
   requireValue(equal(ids(before),ids(after)),'Programme adoption changed original '+kind+' identities');
  }
  requireValue(equal(beforeRuns,originalRows(after)),'Programme inspection changed native parameter-course progress');
  await saveRecord(label+'-native-preservation',{planned_run_ids:course.planned_run_ids,before:beforeRuns,after:originalRows(after)});
 };
 const returnToCase=async()=>{
  await closeDialog();
  await navigate('geographic-headwaters');
  await waitFor(async()=>await page.locator('[data-geo-case="'+caseId+'"]').count()>0,'original Geographic case after Programme');
  await click('[data-geo-case="'+caseId+'"]');
  await waitFor(async()=>await page.locator('[data-geo-programme-delivery]').count()===1,'reopened Programme controls');
  await page.locator('[data-geo-programme-delivery]').selectOption(deliveryId);
  await waitFor(async()=>!(await page.locator('[data-geo-programme-refresh]').isDisabled()),'reopened Programme preview');
 };
 // Exercise the original delivery selector and explicit refresh, retaining the exact outgoing maps/report choice.
 await page.locator('[data-geo-programme-delivery]').selectOption(deliveryId);
 action('programme_delivery_selection',{case_id:caseId,delivery_id:deliveryId,mode});
 await waitFor(async()=>!(await page.locator('[data-geo-programme-refresh]').isDisabled()),'original Programme preview');
 await click('[data-geo-programme-refresh]');
 await waitFor(async()=>!(await page.locator('[data-geo-programme-refresh]').isDisabled()),'refreshed original Programme run states');
 const preview=await api('/api/geographic-headwaters/programme-preview',query);
 validateGeographicProgramme(prepared,preview,null,equal,requireValue);
 await saveRecord(label+'-preview',preview);
 requireValue(await page.locator(programmeBody+' .geo-error').count()===0,'The original Programme control reports a source or preview error');
 await screenshot(page,label+'-original-runs',1440);await screenshot(page,label+'-original-runs',390);
 let retainedProgramme=null,programmeSource=null;
 const archivedDescriptor=completion?.files?.geographic_programme;
 const archivedBody=record.geographic_programme;
 if(archivedDescriptor!=null||archivedBody!=null){
  requireValue(archivedDescriptor?.path==='geographic-programme.json'&&archivedBody&&
   typeof verified==='function'&&typeof delivered==='string',
   'Retain the original archived Programme body and its exact handover file descriptor');
  const originalPath=await verified(delivered,archivedDescriptor);
  retainedProgramme=await readJSON(originalPath);
  requireValue(equal(retainedProgramme,archivedBody),
   'The archived Programme differs from its immutable geographic handover record');
  validateGeographicProgramme(prepared,preview,retainedProgramme,equal,requireValue);
  requireValue(retainedProgramme.existing_delivery_id===deliveryId&&
   equal(retainedProgramme.native_study_selection,preview.native_study_selection),
   'The archived Programme belongs to another original mapped delivery');
  programmeSource={kind:'archived_cli',member:{...archivedDescriptor}};
  await saveRecord(label+'-archived-adoption',{source:programmeSource,result:retainedProgramme});
  action('programme_archived_adoption_opened',{programme_id:retainedProgramme.programme_id,
   delivery_id:deliveryId,member:archivedDescriptor.path});
 }
 let state=await snapshot(),operation=retainedProgramme?null:(state.operations[0]||null);
 if(!retainedProgramme&&!operation&&mode==='inspect'){
  await saveRecord(label+'-inspection',{mode,state:'preview_inspected',geographic_id:caseId,delivery_id:deliveryId,
   ready:preview.ready,issues:preview.issues,programme_operations:[]});
  action('programme_preview_inspected',{case_id:caseId,ready:preview.ready,mode});
  await assertUnchanged();return;
 }
 requireValue(preview.ready===true,'Complete the three original reference runs before the Programme adoption chapter');
 let operationId=null,result=retainedProgramme;
 // A verified CLI adoption is already complete. Otherwise reuse the original accepted request or its own Resume control.
 if(!retainedProgramme){
 if(!operation){
  requireValue(mode==='adopt_completed','Choose the completed adoption course to save this Programme');
  await waitFor(async()=>await page.locator('[data-geo-programme-adopt]').isEnabled(),'original completed-output adoption');
  const [response]=await Promise.all([page.waitForResponse(value=>new URL(value.url()).pathname==='/api/actions'&&value.request().method()==='POST'),click('[data-geo-programme-adopt]')]);
  requireValue(response.ok(),'The original Programme adoption request failed');
  const accepted=await response.json();ident(accepted.id);
  action('programme_adoption_requested',{case_id:caseId,delivery_id:deliveryId,preview_id:preview.id});
  await waitFor(async()=>{state=await snapshot();operation=state.operations.find(row=>row.id===accepted.id)||null;return Boolean(operation);},'retained original Programme operation');
 }else if(['failed','interrupted','cancelled'].includes(operation.state)&&mode==='adopt_completed'){
  requireValue(!operation.restored,'The restored failed operation must be continued by its original operation owner');
  const [response]=await Promise.all([page.waitForResponse(value=>new URL(value.url()).pathname==='/api/task/resume'&&value.request().method()==='POST'),click('[data-geo-programme-resume="'+ident(operation.id)+'"]')]);
  requireValue(response.ok(),'The original Programme resume request failed');
  action('programme_original_operation_resumed',{task_id:operation.id});
 }
 operationId=ident(operation.id);
 await waitFor(async()=>{
  const latest=await snapshot();operation=latest.operations.find(row=>row.id===operationId)||operation;
  return terminal.has(operation.state);
 },'completed original Programme operation',120000);
 const operationResult=await api('/api/geographic-headwaters/result',{task_id:operationId});
 await saveRecord(label+'-operation',operationResult);
 if(!operation.restored){
  await waitFor(async()=>await page.locator('[data-geo-programme-task="'+operationId+'"]').count()>0,'original Programme task control');
  await click('[data-geo-programme-task="'+operationId+'"]');
  await page.locator('#detail-dialog').waitFor({state:'visible'});
  const task=await api('/api/task',{id:operationId});
  requireValue(task.id===operationId&&task.action==='geography.adopt-programme'&&task.payload?.case_id===caseId,
   'The displayed Programme operation belongs to another case');
  await saveRecord(label+'-task',task);
  if(rows(task._downloads).length)await ticketDownloads('#detail-body',task._downloads,label+'-operation-download');
  await screenshot(page,label+'-operation',1440);await screenshot(page,label+'-operation',390);
  await closeDialog();
 }else{
  const current=await snapshot(),tickets=current.saved.programme_operations.flatMap(row=>rows(row._downloads));
  if(tickets.length)await ticketDownloads('.geo-programme-tasks',tickets,label+'-retained-operation-download');
  action('programme_restored_operation',{task_id:operationId,state:operation.state});
 }
 requireValue(operation.state==='complete','The retained Programme operation needs its original failure resolved: '+operationId);
 result=operationResult.result;
 programmeSource={kind:'operator_task',task_id:operationId,restored:Boolean(operation.restored)};
 }
 validateGeographicProgramme(prepared,preview,result,equal,requireValue);
 requireValue(result.existing_delivery_id===deliveryId&&equal(result.native_study_selection,preview.native_study_selection),
  'Programme adoption changed the outgoing delivery selections');
 const programmeId=ident(result.programme_id),button=name=>'[data-programme-action="'+name+'"][data-value="'+programmeId+'"]';
 const openProgramme=async()=>{
  const original='[data-action="programme-open"][data-id="'+programmeId+'"]';
  if(await page.locator(original).count())await click(original);
  else{
   await navigate('programmes');
   await waitFor(async()=>await page.locator('[data-programme-action="open"][data-value="'+programmeId+'"]').count()>0,'saved original Programme catalogue');
   await click('[data-programme-action="open"][data-value="'+programmeId+'"]');
  }
  await waitFor(async()=>await page.locator(button('selection')).count()>0,'original Programme detail');
 };
 await openProgramme();
 const savedProgramme=await api('/api/programmes/page',{programme_id:programmeId,offset:'0',limit:'100',case_filter:'all',query:''});
 requireValue(savedProgramme.id===programmeId&&savedProgramme.state==='complete'&&
  equal(rows(savedProgramme.runs).map(row=>row.run_id),nativeIds(prepared))&&
  Number(savedProgramme.counts?.total)===3&&Number(savedProgramme.counts?.complete)===3,'The saved Programme changed the original reference cohort');
 await saveRecord(label+'-saved',savedProgramme);
 const selection=await api('/api/programmes/selection',{programme_id:programmeId});
 requireValue(selection.programme_id===programmeId&&equal(selection.selection,preview.selection),'The saved Programme selections differ from the original preview');
 const selectedDownload=await download(page.locator(button('selection')),label+'-selections');
 requireValue(equal(await readJSON(selectedDownload.file),selection.selection),'The Programme selection download differs from its original source');
 await screenshot(page,label+'-saved',1440);await screenshot(page,label+'-saved',390);
 await click(button('open-report'));await page.locator('#detail-dialog').waitFor({state:'visible'});
 const report=await api('/api/programmes/report',{programme_id:programmeId});
 requireValue(report.programme_id===programmeId&&report.id===result.report.id&&equal(report.rows,result.report.rows),
  'The opened Programme catalogue differs from the original completed operation');
 await saveRecord(label+'-report',report);
 requireValue(rows(report._downloads).length>0,'The original Programme result catalogue has no file controls');
 await ticketDownloads('#detail-body',report._downloads,label+'-catalogue-download');
 await screenshot(page,label+'-catalogue',1440);await screenshot(page,label+'-catalogue',390);
 await closeDialog();
 for(const runId of nativeIds(prepared)){
  check();
  await click('[data-programme-action="log"][data-value="'+ident(runId)+'"]');
  await page.locator('#detail-dialog pre.logs').waitFor({state:'visible'});
  const log=await api('/api/run-log',{id:runId,offset:'0'});
  await saveRecord(label+'-log-'+runId,log);
  requireValue(typeof log.text==='string','The original native log response is incomplete');
  await screenshot(page,label+'-log-'+runId,1440);await closeDialog();
 }
 // Open the existing source-update workflow. The separate source-update course owns plan selection and execution.
 await click(button('source-update'));
 await page.locator('#form-dialog [data-source-successor-form]').waitFor({state:'visible'});
 const update=await api('/api/programme-source-updates/catalog',{programme_id:programmeId});
 requireValue(update.programme?.id===programmeId,'The source-update catalogue belongs to another Programme');
 await saveRecord(label+'-source-update-catalogue',update);
 requireValue(await page.locator('#form-dialog [name="successor_plan"]').inputValue()==='',
  'Opening source updates must retain the original unselected plan choice');
 await screenshot(page,label+'-source-updates',1440);await screenshot(page,label+'-source-updates',390);
 await click('#form-dialog [data-action="form-close"]');
 await page.locator('#form-dialog').waitFor({state:'hidden'});
 // Reload the actual application, then reopen the exact saved Programme through its original catalogue control.
 await page.reload({waitUntil:'domcontentloaded'});
 await navigate('programmes');
 await waitFor(async()=>await page.locator('[data-programme-action="open"][data-value="'+programmeId+'"]').count()>0,'same Programme after actual reload');
 await click('[data-programme-action="open"][data-value="'+programmeId+'"]');
 await waitFor(async()=>await page.locator(button('selection')).count()>0,'reopened original Programme');
 const reopened=await api('/api/programmes/selection',{programme_id:programmeId});
 requireValue(equal(reopened.selection,selection.selection),'Actual application reload changed the saved Programme selections');
 const reopenedDownload=await download(page.locator(button('selection')),label+'-reopened-selections');
 requireValue(equal(await readJSON(reopenedDownload.file),selection.selection),'The reopened selection download changed');
 await screenshot(page,label+'-reopened',1440);await screenshot(page,label+'-reopened',390);
 await assertUnchanged();
 await saveRecord(label+'-completion',{schema:'upstate.geographic-programme-browser/v1',mode,state:'programme_browser_completed',
  project_id:prepared.project_id,geographic_id:caseId,delivery_id:deliveryId,programme_id:programmeId,task_id:operationId,
  preview_id:preview.id,native_run_ids:nativeIds(prepared),planned_run_ids:course.planned_run_ids,
  report_id:report.id,report_rows:report.rows.length,source:programmeSource,source_update_plan_selected:false});
 action('programme_browser_completed',{programme_id:programmeId,task_id:operationId,mode,report_rows:report.rows.length});
 await returnToCase();
}
