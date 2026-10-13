/**
 * Verify and operate the original geographic course without executing its pending runs.
 * Source contracts: geographic_archive.reference_snapshot and headwaters_parameter_course.
 */
export async function admitGeographicCourse({workspace,record,readJSON,regular,equal,requireValue,safeId}){
 const p=record.prepared,reference=record.reference_basis??null,root='ensemble_results/'+safeId(p.ensemble_id)+'/';
 const records=[];
 async function read(path){const value=await readJSON(await regular(workspace,path));records.push({path,value});return value;}
 const plan=await read('ensembles/'+p.ensemble_id+'.json');
 const source=await read(root+'headwaters-course.json'),course=await read(root+'headwaters-results.json');
 const selection={grid_id:p.grid_id,base_profile_id:p.profile_id,baseline_scenario_id:p.baseline_scenario_id,alternative_scenario_ids:p.alternative_scenario_ids};
 requireValue(source.schema==='upstate.headwaters-parameter-course/v1'&&source.project_id===p.project_id&&source.ensemble_id===p.ensemble_id&&source.input_source_collection_id===p.source_collection_id&&equal(source.selection,selection),'The retained course names another geographic source or selection');
 requireValue(course.schema===source.schema&&course.project_id===p.project_id&&course.ensemble_id===p.ensemble_id&&equal(course.selection,selection)&&equal(course.input_classification,source.input_classification),'The original course result changed its scientific selection');
 requireValue(plan.id===p.ensemble_id&&plan.grid_id===p.grid_id&&plan.baseline_scenario_id===p.baseline_scenario_id&&equal(plan.base_profile_ids,[p.profile_id])&&equal(plan.alternative_scenario_ids,p.alternative_scenario_ids)&&plan.members?.length>0,'The original full parameter design changed');
 const scenarios=[p.baseline_scenario_id,...p.alternative_scenario_ids],referenceIds=[p.baseline_run_id,...p.alternative_run_ids];
 requireValue(referenceIds.length===3&&new Set(referenceIds).size===3&&equal(plan.members[0].runs.map(r=>r.run_id),referenceIds)&&plan.members[0].profile_id===p.profile_id,'Keep the original three reference runs and their order');
 const runs=new Map(),members=[];
 for(const member of plan.members){
  safeId(member.id);safeId(member.profile_id);
  requireValue(equal(member.runs.map(r=>r.scenario_id),scenarios),'A parameter profile changed its original baseline or alternative order');
  const current=[];
  for(const item of member.runs){
   safeId(item.run_id);
   const native=runs.get(item.run_id)??await read('runs/'+item.run_id+'/run.json');
   requireValue(native.id===item.run_id&&native.selection.grid_id===p.grid_id&&native.selection.profile_id===member.profile_id&&native.selection.scenario_id===item.scenario_id,'An original planned native run changed its source selection');
   runs.set(native.id,native);current.push({run_id:native.id,scenario_id:item.scenario_id,state:native.state});
  }
  members.push({member_id:member.id,profile_id:member.profile_id,label:member.label||member.profile_id,assignments:member.assignments,parameters:member.parameters,runs:current});
 }
 const progress={total:runs.size,complete:0,failed:0,running:0,prepared:0};
 for(const run of runs.values())progress[run.state]=(progress[run.state]||0)+1;
 requireValue(referenceIds.every(id=>runs.get(id)?.state==='complete'),'Finish the original reference trio before receiving its reports');
 const decisions=course.joint_decisions||{},comparisons=decisions.comparisons||[];
 const selected=comparisons.filter(row=>row.member_id===plan.members[0].id);
 requireValue(selected.length===1&&selected[0].profile_id===p.profile_id&&selected[0].baseline_run_id===referenceIds[0]&&equal(selected[0].alternative_run_ids,referenceIds.slice(1)),'The saved reference comparison changed its original runs');
 if(reference){
  requireValue(reference.schema==='upstate.headwaters-reference-report-basis/v1'&&reference.project_id===p.project_id&&reference.ensemble_id===p.ensemble_id&&reference.reference_ready===true&&reference.state==='reference_complete'&&['partial','complete'].includes(course.state)&&reference.course_state===course.state,'Use the explicitly completed reference edition with its actual full-course state');
  requireValue(reference.reference_member_id===plan.members[0].id&&reference.reference_profile_id===p.profile_id&&equal(reference.reference_run_ids,referenceIds)&&reference.baseline_run_id===referenceIds[0]&&equal(reference.alternative_run_ids,referenceIds.slice(1))&&reference.comparison_id===selected[0].comparison_id,'The reference basis changed its original profile, runs or comparison');
  requireValue(equal(reference.input_classification,source.input_classification)&&reference.planned_profile_count===members.length&&reference.completed_comparison_profile_count===comparisons.length&&equal(reference.native_progress,progress)&&equal(reference.pending_members,decisions.pending_members||[]),'The reference edition changed the retained full design, pending members or progress');
 }else requireValue(course.state==='complete'&&progress.complete===progress.total&&!decisions.pending_members?.length,'A full-course edition cannot contain unfinished original native runs');
 const snapshot=record.course_snapshot;
 if(snapshot){
  requireValue(snapshot.schema==='upstate.geographic-course-presentation/v1'&&snapshot.edition_kind===(reference?'reference':'complete_course')&&snapshot.state===course.state&&equal(snapshot.native_progress,progress)&&snapshot.planned_profile_count===members.length&&snapshot.completed_comparison_profile_count===comparisons.length&&equal(snapshot.members,members),'The opening page differs from its original complete design snapshot');
 }else requireValue(!reference,'The reference opening page must retain its full course snapshot');
 requireValue(equal(record.scientific.progress,progress),'The scientific report changed its original full-design progress');
 const completed=[...runs.values()].filter(r=>r.state==='complete').map(r=>r.id).sort();
 const pending=[...runs.values()].filter(r=>r.state!=='complete').map(r=>r.id).sort();
 return {completion_scope:reference?'reference':'full_course',course_state:course.state,reference_basis:reference,reference_run_ids:referenceIds,planned_run_ids:[...runs.keys()],completed_run_ids:completed,pending_run_ids:pending,native_progress:progress,planned_profile_count:members.length,completed_comparison_profile_count:comparisons.length,members,records};
}

export async function operateGeographicCourse({page,course,record,screenshot,action,requireValue,equal}){
 if(!record.course_snapshot)return;
 const section=page.locator('#course');await section.waitFor({state:'visible'});
 requireValue(await section.locator('h2').textContent()===(course.completion_scope==='reference'?'Completed reference scenarios':'Completed parameter study'),'The opening page mislabels this reference or full-course edition');
 const rows=await section.locator('tbody tr').evaluateAll(nodes=>nodes.map(row=>[...row.querySelectorAll('td')].map(cell=>cell.textContent.trim())));
 requireValue(rows.length===course.members.length,'The opening page omits original planned profiles');
 for(let i=0;i<rows.length;i++)requireValue(equal(rows[i].slice(2),course.members[i].runs.map(run=>run.state)),'The opening page misstates a retained native run state');
 const details=section.locator('details');await details.locator('summary').click();
 requireValue(await details.evaluate(node=>node.open),'The original course identities did not open');
 requireValue(equal(JSON.parse(await details.locator('pre').textContent()),course.members),'The displayed parameter choices or original run IDs changed');
 await screenshot(page,'geographic-course-'+course.completion_scope,1440);
 await screenshot(page,'geographic-course-'+course.completion_scope,390);
 await details.locator('summary').click();
 action('original_course_opened',{completion_scope:course.completion_scope,course_state:course.course_state,completed_run_ids:course.completed_run_ids,pending_run_ids:course.pending_run_ids,native_progress:course.native_progress});
}

export function selectGeographicReceivingEdition(settings,state,{requireValue}){
 requireValue(state.schema==='upstate.geographic-headwaters-receiving/v1','Use the original geographic receiving state');
 let scope=settings.completion_scope;
 if(scope===undefined&&settings.archive_sha256){
  if(state.archive?.sha256===settings.archive_sha256)scope='full_course';
  else if(Object.values(state.reference_handover_editions||{}).some(item=>item.archive?.sha256===settings.archive_sha256))scope='reference';
 }
 scope??=state.selected_completion_scope??(state.state==='complete'?'full_course':'reference');
 requireValue(['reference','full_course'].includes(scope),'Select an actual reference or full-course receiving edition');
 if(scope==='full_course'){
  requireValue(state.state==='complete'&&state.independent_reopen?.identity==='MATCH','Finish the full course archive and contained-application cold receiving first');
  return {completion_scope:scope,archive:state.archive,handover:state.handover,restored:state.restored,delivery_id:state.delivery_id,reference_basis:null,cold:state.independent_reopen};
 }
 const candidates=Object.values(state.reference_handover_editions||{}).filter(item=>
  (!settings.archive_sha256||item.archive?.sha256===settings.archive_sha256)&&
  (!settings.handover_id||item.handover?.id===settings.handover_id));
 const selected=candidates.find(item=>item.archive?.sha256===state.reference_archive?.sha256&&item.handover?.id===state.reference_handover?.id)??(candidates.length===1?candidates[0]:null);
 requireValue(selected&&selected.independent_reopen?.identity==='MATCH'&&selected.independent_reopen.completion_scope==='reference'&&selected.reference_report?.report_state==='complete'&&selected.reference_basis?.reference_ready===true,'Finish the selected reference archive and original contained-application cold receiving first');
 requireValue(selected.independent_reopen.archive_sha256===selected.archive?.sha256&&selected.independent_reopen.delivery_id===selected.reference_report.delivery_id,'The reference cold receipt selects another archive or delivery');
 return {completion_scope:scope,archive:selected.archive,handover:selected.handover,restored:selected.restored,delivery_id:selected.reference_report.delivery_id,reference_basis:selected.reference_basis,cold:selected.independent_reopen};
}
