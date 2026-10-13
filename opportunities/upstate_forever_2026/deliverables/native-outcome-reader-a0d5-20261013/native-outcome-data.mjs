/* Original native quantities only. This module reads retained report values; it does not run a model or recompute spatial summaries. */
const clone=x=>JSON.parse(JSON.stringify(x));
const fail=m=>{throw new Error(m);};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const need=(ok,m)=>{if(!ok)fail(m);};
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const count=x=>Number.isInteger(x)&&x>=0;
const FIELDS=['baseline_total','alternative_total','baseline_common','alternative_common','delta_common','percent_change'];
const COUNTS=['baseline_valid_cells','alternative_valid_cells','common_cells','baseline_only_cells','alternative_only_cells'];
const QUANTITIES={nitrogen_export:{title:'Nitrogen',units:'kg/year'},phosphorus_export:{title:'Phosphorus',units:'kg/year'},sediment_export:{title:'Sediment',units:'t/year'}};
function checkedRows(rows,kind,members,runMap,ensemble){
 need(Array.isArray(rows),'Retained '+kind+' rows are absent');
 return rows.map((row,index)=>{
  need(object(row),'A retained comparison row is invalid');
  const m=members.get(row.member_id), q=QUANTITIES[row.pollutant];
  need(m&&q,'Comparison has an unknown original member or quantity');
  need(row.profile_id===m.profile_id,'Comparison profile differs from original member');
  need(row.total_units===q.units,'Comparison does not retain annual physical units');
  for(const k of FIELDS)need(row[k]===null||finite(row[k]),'Invalid original '+k);
  for(const k of COUNTS)need(count(row[k]),'Invalid original '+k);
  need(hash(row.common_support_sha256),'Comparison lacks its exact valid-cell mask identity');
  need(row.baseline_valid_cells===row.common_cells+row.baseline_only_cells &&
       row.alternative_valid_cells===row.common_cells+row.alternative_only_cells,
       'Original comparison support counts disagree');
  const left=runMap.get(row.baseline_run_id),right=runMap.get(row.alternative_run_id);
  need(left&&right,'Comparison refers to a run absent from the retained ensemble');
  for(const [native,artifact,key] of [[left,row.baseline_artifact,'baseline_total'],[right,row.alternative_artifact,'alternative_total']]){
   const actual=native.artifacts?.[row.pollutant];
   need(actual&&artifact&&['sha256','bytes','path'].every(k=>actual[k]===artifact[k]),'Comparison raster differs from the retained original run');
   need(actual.sum===row[key],'Original total differs from its retained raster summary');
  }
  need(left.selection?.grid_id===ensemble.grid_id&&right.selection?.grid_id===ensemble.grid_id,
       'Comparison runs do not use the retained original grid');
  need(right.selection?.profile_id===row.profile_id&&right.selection?.scenario_id===row.scenario_id,
       'Right native run differs from its comparison selection');
  if(kind==='landcover'){
   need(left.selection?.profile_id===row.profile_id&&left.selection?.scenario_id===ensemble.baseline_scenario_id,
        'Land-cover pair does not hold the parameter profile fixed');
  }else{
   const reference=members.get(row.reference_member_id);
   need(reference&&reference.profile_id===row.reference_profile_id,
        'Parameter comparison lacks its original reference member');
   need(left.selection?.profile_id===reference.profile_id&&left.selection?.scenario_id===row.scenario_id,
        'Parameter pair does not hold the original land-cover scenario fixed');
  }
  if(row.common_cells===0)need(['baseline_common','alternative_common','delta_common','percent_change'].every(k=>row[k]===null),'No shared valid cells must remain undefined');
  else{
   need(['baseline_common','alternative_common','delta_common'].every(k=>finite(row[k])),'Shared-cell annual masses are incomplete');
   if(row.baseline_common===0)need(row.percent_change===null,'Zero baseline percentage must remain undefined');
  }
  return {key:kind+'-'+(index+1),kind,quantity:q.title,original:clone(row)};
 });
}

function checkedJointReports(course,reports,plan,receipt,runMap){
 if(course==null&&reports.length===0)return {state:'not_retained_in_reading',rows:[],course:null,reports:[]};
 need(object(course)&&course.schema==='upstate.headwaters-parameter-course/v1',
      'Joint comparisons require the original headwaters course');
 need(course.project_id===receipt.project_id&&course.ensemble_id===plan.id,
      'Joint comparison course belongs to another original project or ensemble');
 const joint=course.joint_decisions;
 need(course.state==='complete'&&joint?.state==='complete'&&
      Array.isArray(joint.comparisons)&&Array.isArray(joint.support_group_reports),
      'Select the completed original joint-comparison course');
 need(Array.isArray(joint.pending_members)&&joint.pending_members.length===0,
      'Joint comparisons still contain pending original members');
 need(Array.isArray(reports),'Retain the complete selected joint decision reports');
 const byComparison=new Map(),byReport=new Map(),rows=new Map(),memberIds=new Set();
 for(const comparison of joint.comparisons){
  const member=plan.members.find(m=>m.id===comparison.member_id);
  need(member&&member.profile_id===comparison.profile_id&&hash(comparison.comparison_id)&&
       !byComparison.has(comparison.comparison_id)&&!memberIds.has(member.id),'Joint comparison identity differs from its ensemble member');
  const selected=member.runs.map(r=>r.run_id);
  need(comparison.baseline_run_id===selected[0]&&
       JSON.stringify(comparison.alternative_run_ids)===JSON.stringify(selected.slice(1)),
       'Joint comparison changes the original baseline or alternative order');
  memberIds.add(member.id);
  byComparison.set(comparison.comparison_id,{comparison,member,selected});
 }
 need(byComparison.size===plan.members.length,'Joint course omits an original ensemble member');
 for(const report of reports){
  need(object(report)&&report.schema==='upstate.decision-report/v1'&&hash(report.id)&&
       !byReport.has(report.id),'Invalid or duplicate retained joint decision report');
  byReport.set(report.id,report);
 }
 need(byReport.size===joint.support_group_reports.length,
      'Retain each original joint support-group report exactly once');
 const sourceReports=[];
 for(const descriptor of joint.support_group_reports){
  const report=byReport.get(descriptor.report_id),scope=report?.scope;
  need(report&&report.project?.id===receipt.project_id&&
       scope?.grid_id===plan.grid_id&&scope.comparison_id===descriptor.reference_comparison_id&&
       scope.reference_profile_id===descriptor.reference_profile_id&&
       scope.benefit_direction==='baseline minus alternative',
       'Joint report differs from the original project, reference or scientific direction');
  need(report.baseline?.run_id===scope.baseline_run_id&&report.baseline?.profile_id===scope.reference_profile_id&&report.baseline?.grid_id===scope.grid_id,
       'Joint report baseline differs from its original scope');
  need(hash(descriptor.archive_identity?.sha256)&&count(descriptor.archive_identity?.bytes)&&
       typeof descriptor.archive_identity?.path==='string',
       'Retain the original joint decision package identity');
  const groups=[{comparison_id:scope.comparison_id,baseline_run_id:scope.baseline_run_id,
                 profile_id:scope.reference_profile_id,grid_id:scope.grid_id,
                 alternatives:report.alternatives},...(report.sensitivity_members||[])];
  const seen=new Set();
  for(const group of groups){
   const expected=byComparison.get(group.comparison_id);
   need(expected&&!seen.has(group.comparison_id)&&group.grid_id===plan.grid_id&&
        group.profile_id===expected.member.profile_id&&
        group.baseline_run_id===expected.selected[0],
        'Joint report comparison differs from its retained native selections');
   seen.add(group.comparison_id);
   need(Array.isArray(group.alternatives)&&group.alternatives.length===expected.selected.length-1,
        'Joint report does not preserve every original alternative');
   const alternatives=new Set();
   for(const alternative of group.alternatives){
    const native=runMap.get(alternative.run_id);
    need(native&&expected.selected.slice(1).includes(native.id)&&!alternatives.has(native.id)&&
         alternative.profile_id===expected.member.profile_id&&
         alternative.scenario_id===native.selection.scenario_id,
         'Joint alternative differs from its native run or profile');
    alternatives.add(native.id);
    need(Array.isArray(scope.modeled_metrics)&&scope.modeled_metrics.length>0&&
         Object.keys(alternative.outputs||{}).length===scope.modeled_metrics.length&&
         scope.modeled_metrics.every(k=>QUANTITIES[k]&&Object.prototype.hasOwnProperty.call(alternative.outputs,k)),
         'Joint alternative omits an original modeled quantity');
    for(const [pollutant,value] of Object.entries(alternative.outputs||{})){
     const quantity=QUANTITIES[pollutant],support=value?.support;
     need(quantity&&value.units===quantity.units&&
          ['baseline','alternative','delta','reduction'].every(k=>finite(value[k]))&&
          (value.reduction_percent===null||finite(value.reduction_percent)),
          'Joint report lacks an original finite annual mass or physical unit');
     need(support?.status==='paired'&&hash(support.id)&&count(value.comparison_valid_cells)&&
          value.comparison_valid_cells>0&&support.valid_cells===value.comparison_valid_cells&&
          Array.isArray(support.members)&&support.members.length===expected.selected.length&&
          new Set(support.members).size===support.members.length&&
          expected.selected.every(id=>support.members.includes(id)),
          'Joint support does not identify every original baseline/alternative run');
     need(hash(value.artifact?.sha256)&&count(value.artifact?.bytes)&&typeof value.artifact?.path==='string',
          'Joint quantity lacks its original comparison-artifact descriptor');
     if(value.baseline===0)need(value.reduction_percent===null,
          'A zero joint baseline must retain its undefined percentage');
     const key=group.comparison_id+' / '+native.id+' / '+pollutant;
     const previous=rows.get(key);
     if(previous){
      need(JSON.stringify(previous.original.output)===JSON.stringify(value),
           'Original support reports disagree on a retained comparison row');
      previous.report_ids.push(report.id);
     }else rows.set(key,{member_id:expected.member.id,member_label:expected.member.label,
       profile_id:expected.member.profile_id,scenario_id:alternative.scenario_id,
       scenario_label:alternative.label||alternative.scenario_id,pollutant,quantity:quantity.title,
       comparison_id:group.comparison_id,baseline_run_id:group.baseline_run_id,
       alternative_run_id:native.id,baseline:value.baseline,alternative:value.alternative,
       delta:value.delta,reduction:value.reduction,reduction_percent:value.reduction_percent,
       units:value.units,common_cells:value.comparison_valid_cells,support_id:support.id,
       report_ids:[report.id],original:{comparison_id:group.comparison_id,
        baseline_run_id:group.baseline_run_id,alternative_run_id:native.id,
        profile_id:expected.member.profile_id,scenario_id:alternative.scenario_id,
        pollutant,output:clone(value)}});
    }
   }
  }
  need(seen.size===byComparison.size,'Joint report omits an original sensitivity comparison');
  sourceReports.push({descriptor:clone(descriptor),report:clone(report)});
 }
 return {state:'retained',rows:[...rows.values()],course:clone(course),reports:sourceReports};
}

function makeOutcomeView({packetIdentity,report,plan,runs,receipt,preview=null,sourcePaths={},links=[],course=null,jointReports=[]}){
 need(hash(packetIdentity?.sha256)&&count(packetIdentity?.bytes),'Original packet identity is required');
 need(object(report)&&['upstate.ensemble-report-release/v1','upstate.ensemble-report/v1'].includes(report.schema),'Select the retained complete numeric report or original ensemble summary');
 const release=report.schema==='upstate.ensemble-report-release/v1',summary=release?report.report:report;
 need(object(plan)&&Array.isArray(plan.members),'Select the original ensemble plan');
 need((release?report.ensemble_id:summary.id)===plan.id&&summary.id===plan.id,'Numeric report and ensemble identities differ');
 const receivingReceipt=receipt?.schema==='upstate.simulated-demo-receiving/v1';
 const sourcePreview=!receivingReceipt&&object(receipt)&&Array.isArray(receipt.files)&&object(preview)&&
   preview.plan?.schema==='upstate.study-transfer-plan/v1';
 need((receivingReceipt||sourcePreview)&&receipt.ensemble_id===plan.id,
      'Select the original receiving receipt or retained source-and-Study preview for this ensemble');
 need(typeof receipt.project_id==='string'&&receipt.project_id.length>0,'The original project identity is absent');
 if(sourcePreview){
  need(preview.project_id===receipt.project_id&&preview.plan.project?.id===receipt.project_id&&
       hash(receipt.source_operation_id)&&hash(receipt.report_id)&&hash(preview.plan.preview_token),
       'Source and Study preview identities disagree');
  need(receipt.files.some(f=>f.path==='numeric/report.json')&&receipt.files.some(f=>f.path==='original/ensemble.json'),
       'Retain the complete original source files');
 }
 need(!summary.report_state||summary.report_state==='current','Retained numeric report is not current for its native run signature');
 need(hash(summary.run_signature),'Original numeric report lacks its run signature');
 need(!summary.errors?.length&&!summary.run_errors?.length,'Retained report has unresolved native comparison errors');
 const members=new Map(),runMap=new Map(),selections=[];
 const allRuns=Array.isArray(runs)?runs:Object.values(runs||{});
 for(const r of allRuns){need(object(r)&&hash(r.id),'Native run has no original identity');need(!runMap.has(r.id),'Duplicate native run identity');runMap.set(r.id,r);}
 for(const member of plan.members){
  need(hash(member.id)&&hash(member.profile_id)&&!members.has(member.id),'Original member identity is invalid or duplicated');
  members.set(member.id,member);
  need(Array.isArray(member.runs)&&member.runs.length,'Original member has no native selections');
  for(const selected of member.runs){
   const run=runMap.get(selected.run_id);
   need(run&&run.state==='complete','A selected native run is absent or incomplete');
   need(run.selection?.grid_id===plan.grid_id&&run.selection?.profile_id===member.profile_id&&run.selection?.scenario_id===selected.scenario_id,
        'Native run does not match the exact original member selection');
   const totals=[];
   for(const [key,q] of Object.entries(QUANTITIES)){
    const a=run.artifacts?.[key];need(a&&finite(a.sum)&&count(a.valid_cells),'A complete native annual-mass artifact is absent');
    const equivalent={ 'kg/year':'kg/year','t/year':'t/year','metric_tonnes/year':'t/year','metric_tons/year':'t/year','tonnes/year':'t/year' };
    need(equivalent[a.sum_units]===q.units,'Native artifact requires a retained annual unit, not an inferred conversion');
    need(hash(a.sha256)&&count(a.bytes)&&typeof a.path==='string','Native raster identity is incomplete');
    totals.push({pollutant:key,quantity:q.title,value:a.sum,units:a.sum_units,valid_cells:a.valid_cells,artifact:clone(a)});
   }
   selections.push({member_id:member.id,member_label:member.label,profile_id:member.profile_id,
      parameters:clone(member.parameters),assignments:clone(member.assignments||[]),
      run_id:run.id,scenario_id:selected.scenario_id,scenario_label:selected.label,role:selected.role,
      state:run.state,created_at:run.created_at??null,completed_at:run.completed_at??null,
      runtime:clone(run.runtime??null),totals});
  }
 }
 const landcover=checkedRows(release?report.paired_rows:summary.rows,'landcover',members,runMap,plan);
 const parameter=checkedRows(release?report.parameter_rows:summary.sensitivity,'parameter',members,runMap,plan);
 const groups=(release?report.support_groups:summary.robustness)||[];
 const supportGroups=groups.map(r=>({original:clone(r),scenario_id:r.scenario_id,scenario_label:r.scenario_label??null,pollutant:r.pollutant,total_units:r.total_units,common_support_sha256:r.common_support_sha256,common_cells:r.common_cells,members:release?r.members:r.members_complete_on_this_support,minimum_delta:release?r.minimum_delta:r.min_delta,maximum_delta:release?r.maximum_delta:r.max_delta,direction:r.direction,coverage_complete:release?r.coverage_complete:null,source_schema:report.schema}));
 const ids=new Set(selections.map(r=>r.run_id));need(ids.size===selections.length,'Original member selections contain duplicate runs');
 const joint=checkedJointReports(course,jointReports,plan,receipt,runMap);
 const stages=Object.entries(receipt.stages||{}).map(([name,v])=>({name,...clone(v)}));
 return {schema:'upstate.native-outcome-reading/v1',packet:clone(packetIdentity),
   identity:{project_id:receipt.project_id,ensemble_id:plan.id,grid_id:plan.grid_id,
      source_collection_id:receipt.source_collection_id,profile_id:receipt.profile_id,
      baseline_run_id:receipt.baseline_run_id,run_signature:summary.run_signature,
      scientific_source:receipt.scientific_study?.source??null},
   title:plan.title,classification:receivingReceipt?receipt.classification:preview.plan.project.title,
   receiving_evidence:{kind:receivingReceipt?'original_receiving_receipt':'original_source_and_study_preview',source_operation_id:receipt.source_operation_id??null,report_id:receipt.report_id??null,preview_token:preview?.plan?.preview_token??null},
   input_summary:clone(receipt.input_summary||{}),source_paths:clone(sourcePaths),
   selections,landcover,parameter,support_groups:supportGroups,joint,
   stages,links:clone(links),original_plan:clone(plan)};
}
export {makeOutcomeView,QUANTITIES};
