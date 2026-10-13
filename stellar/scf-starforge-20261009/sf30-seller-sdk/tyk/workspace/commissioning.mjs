// MIT. Whole-cohort commissioning over the original Tyk requests and operating-plan history.
import { createOperatingPlan, createOperatingStep, operatingPlanDraft, saveOperatingPlanRevision,
  createOperatingFile, inspectOperatingPlan } from '../../../distribution/discovery/operating-plan.mjs';
export const TYK_COMMISSIONING_SCHEMA = 'stellar-forge.tyk-commissioning.v1';
export const COMMISSIONING_STEPS = Object.freeze([
  ['conversion','Native conversion','Run the original Dashboard dry run for the complete saved Classic cohort.'],
  ['conversion-review','Conversion review','Review every original Classic source and the complete native converted definitions.'],
  ['staging','Stage the cohort','Create the native staged OAS definitions through the reviewed Dashboard request.'],
  ['staged-capture','Capture staged definitions','Capture the current complete native staged definitions, including operator edits.'],
  ['production-review','Production acceptance','Record the selected operational checks for every API against these exact staged definitions.'],
  ['promotion','Promote the cohort','Promote the reviewed staged definitions while retaining each canonical API identity.'],
  ['final-capture','Final portfolio','Capture the complete current portfolio and match every promoted API to its native returned definition.'],
]);
const need=(condition,message)=>{if(!condition)throw Object.assign(new Error(message),{code:'TYK_COMMISSIONING_INVALID',status:400});};
const text=(value,max=20000,required=false)=>{need(typeof value==='string'&&value.length<=max&&!value.includes('\0')&&(!required||value.trim()),'Use complete commissioning text within its declared size.');return value;};
export function commissioningChecks(value) {
  need(Array.isArray(value)&&value.length>0&&value.length<=50,'Select one to fifty operational checks.');
  const checks=value.map(item=>text(item,200,true).trim());
  need(new Set(checks).size===checks.length,'Operational check names must be unique.'); return checks;
}
export function createTykCommissioningPlan({id,label,customer='',operator='',apiIds,checks,workshare=null,savedAt}) {
  checks=commissioningChecks(checks);
  need(Array.isArray(apiIds)&&apiIds.length>0,'Select a complete saved cohort.');
  return createOperatingPlan({id,title:text(label,300,true),customer:text(customer,300),owner:text(operator,300),
    purpose:'Commission the complete saved Tyk API cohort through original native conversion, staged operation and production promotion.',
    receiving:'Use the complete Tyk workspace handover to retain all record revisions, original definitions, native requests and results. Reopen the same commissioning record to continue.',
    notes:'Selected APIs: '+apiIds.length+' (complete selection in selected-api-ids.json).\nOperational checks: '+checks.join('; '),
    steps:COMMISSIONING_STEPS.map(([id,title,instruction])=>createOperatingStep({id,title,instruction,
      inputs:id==='production-review'?checks.join('\n'):apiIds.length+' selected APIs; use the complete original selected-api-ids.json and cohort record.',owner:operator,
      ...(id==='conversion'?{files:[createOperatingFile({id:'selected-api-ids',name:'selected-api-ids.json',mediaType:'application/json',bytes:new TextEncoder().encode(JSON.stringify(apiIds,null,2)+'\n')}),...(workshare?[workshare.source]:[])]}:{}),
      expectedResult:id==='production-review'?'An explicit result and supporting material for every selected API/check pair.':'The saved original source and outcome remain available in the Tyk workspace.'})),savedAt});
}
export function commissioningRecordRef(record) {
  return record?{kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256}:null;
}
function confirmed(record) {return record?.value?.state==='CONFIRMED'&&record?.value?.phase==='COMPLETED';}
function completeConversion(record,ids) {
  return confirmed(record)&&migrationAccepted(record,'dryRun',ids)&&
    record.definitionCoverage?.planSha256===record.value.planSha256&&
    ids.every(id=>record.definitionCoverage.apis.some(row=>row.apiId===id&&row.before==='PRESENT'&&row.after==='PRESENT'));
}
function migrationAccepted(record,mode,ids) {
  const result=record?.reconciliation,success=result?.evidence?.migration?.success;
  if(!record||record.plan?.operation!=='migrate'||record.plan.mode!==mode||!result?.response?.acknowledged||!success)return false;
  const migration=result.evidence.migration,failures=migration.failure;
  if((failures?.count??0)>0||(failures?.errors??[]).length||(migration.skipped?.apis??[]).length||migration.abortedOnFailure)return false;
  const covered=new Set([...(success.apiIDs??[]),...(success.stagedAPIs??[]).map(row=>row.classicAPIID),...(success.definitions??[]).map(row=>row.apiID)]);
  return ids.every(id=>covered.has(id));
}
export function commissioningStagedMapping(record,apiIds) {
  if(!migrationAccepted(record,'stage',apiIds))return [];
  const rows=record.reconciliation.evidence.migration.success.stagedAPIs??[];
  const selected=apiIds.map(apiId=>{
    const matches=rows.filter(row=>row.classicAPIID===apiId);
    if(matches.length!==1||typeof matches[0].oasAPIID!=='string'||!matches[0].oasAPIID)return null;
    return {apiId,stagedApiId:matches[0].oasAPIID};
  });
  return selected.every(Boolean)&&new Set(selected.map(row=>row.stagedApiId)).size===apiIds.length?selected:[];
}
export function commissioningObservation({cohort,staging,promotion,capture,inventory,phase}) {
  if(!capture||capture.value.phase!=='COMPLETED'||!inventory||capture.value.connectionId!==cohort.value.connectionId)return null;
  const ids=cohort.value.apiIds;
  const mapping=phase==='staged'?commissioningStagedMapping(staging,ids):ids.map(apiId=>({apiId,stagedApiId:apiId}));
  if(mapping.length!==ids.length)return null;
  const apis=mapping.map(row=>{
    const observed=inventory.items.find(item=>item.apiId===row.stagedApiId);
    if(!observed||observed.found===false||observed.kind!=='oas'||!observed.sha256)return null;
    if(phase==='final'){
      const matched=promotion?.reconciliation?.evidence?.migration?.readbackDefinitionMatches?.find(item=>item.apiId===row.apiId);
      const native=promotion?.reconciliation?.items?.find(item=>item.apiId===row.apiId);
      if(!confirmed(promotion)||!matched?.originalDefinitionReturned||!matched.correspondence?.matched||native?.afterSha256!==observed.sha256)return null;
    }
    return {...row,sha256:observed.sha256,bytes:observed.bytes,definitionRef:observed.definitionRef??null,summary:observed.summary??null};
  });
  return apis.every(Boolean)?{phase,capture:commissioningRecordRef(capture),apis}:null;
}
export function commissioningReviewContext(value,details,stepId) {
  const {cohort,conversion,staging,observation}=details;
  const common={schema:TYK_COMMISSIONING_SCHEMA,cohort:value.cohort,connectionId:value.connectionId,
    configurationSha256:value.configurationSha256,apiIds:cohort.value.apiIds};
  if(stepId==='conversion-review'){
    need(completeConversion(conversion,cohort.value.apiIds),'Complete the original conversion before reviewing it.');
    return {...common,stepId,rolloutId:conversion.id,planSha256:conversion.value.planSha256,
      review:conversion.value.review,response:conversion.value.response};
  }
  need(stepId==='production-review'&&observation?.phase==='staged'&&commissioningStagedMapping(staging,cohort.value.apiIds).length===cohort.value.apiIds.length,
    'Capture every current staged OAS definition before production acceptance.');
  return {...common,stepId,stagingResponse:staging.value.response,stagingPlanSha256:staging.value.planSha256,
    observation,checks:value.checkNames};
}
export function validateCommissioningReview({stepId,reviewer,note,checks=[],files=[]},value,context) {
  text(reviewer,300,true);text(note,20000,true);
  need(Array.isArray(files)&&files.length<=50,'Retain at most fifty complete supporting files per review.');
  if(stepId==='production-review'){
    const expected=context.apiIds.flatMap(apiId=>value.checkNames.map(name=>apiId+'\0'+name));
    need(checks.length===expected.length,'Record every selected API/check pair.');
    const found=checks.map(row=>{
      need(row&&typeof row==='object'&&['passed','failed'].includes(row.outcome),'Each check needs its explicit passed or failed result.');
      text(row.apiId,1000,true);text(row.name,200,true);text(row.note,20000,true);return row.apiId+'\0'+row.name;
    });
    need(new Set(found).size===found.length&&expected.every(key=>found.includes(key)),'Use exactly the selected API/check pairs.');
  } else need(stepId==='conversion-review'&&checks.length===0,'Conversion acceptance uses its complete native source review.');
  return {reviewer:reviewer.trim(),note,checks,accepted:checks.every(row=>row.outcome==='passed')};
}
export function commissioningProgress(value,details,{hash}) {
  const {cohort,conversion,staging,promotion,observation,finalObservation}=details, reviews=value.reviews??{};
  const accepted=(stepId)=>{
    try {const context=commissioningReviewContext(value,details,stepId);return reviews[stepId]?.accepted===true&&reviews[stepId].contextSha256===hash(context);}
    catch{return false;}
  };
  const conversionDone=completeConversion(conversion,cohort.value.apiIds);
  const conversionReview=accepted('conversion-review');
  const stagingDone=commissioningStagedMapping(staging,cohort.value.apiIds).length===cohort.value.apiIds.length;
  const observed=Boolean(observation?.phase==='staged');
  const productionReview=accepted('production-review');
  const promotionDone=confirmed(promotion)&&migrationAccepted(promotion,'promote',cohort.value.apiIds);
  const finalDone=Boolean(finalObservation?.phase==='final')&&promotionDone;
  const completed=[conversionDone,conversionReview,stagingDone,observed,productionReview,promotionDone,finalDone];
  const records={conversion,staging,promotion};
  const steps=COMMISSIONING_STEPS.map(([id,title,instruction],index)=>{
    const ready=completed.slice(0,index).every(Boolean),record=records[id];
    return {id,title,instruction,status:completed[index]?'completed':ready?(record?'in-progress':'planned'):'planned',
      ready:ready&&!completed[index],complete:completed[index],record:commissioningRecordRef(record),
      nativeState:record?.value.state??null};
  });
  return {schema:TYK_COMMISSIONING_SCHEMA,state:completed.every(Boolean)?'COMPLETE':'IN_PROGRESS',steps,
    next:steps.find(step=>!step.complete)?.id??null,summary:{apis:cohort.value.apiIds.length,steps:steps.length,
      completed:completed.filter(Boolean).length,checks:cohort.value.apiIds.length*value.checkNames.length}};
}
export function updateCommissioningPlan(plan,progress,reviews={},filesByStep={},savedAt) {
  inspectOperatingPlan(plan); const draft=operatingPlanDraft(plan);
  for(const step of draft.content.steps){
    const current=progress.steps.find(item=>item.id===step.id);if(!current)continue;
    step.status=current.status;
    const review=reviews[step.id];
    step.recordedResult=review?JSON.stringify({reviewer:review.reviewer,note:review.note,
      accepted:review.accepted,checks:{total:review.checks?.length??0,passed:review.checks?.filter(row=>row.outcome==='passed').length??0,
        failed:review.checks?.filter(row=>row.outcome==='failed').length??0},contextSha256:review.contextSha256,recordedAt:review.recordedAt},null,2):
      current.record?JSON.stringify({nativeState:current.nativeState,record:current.record},null,2):
      current.complete?'Complete original source retained with this commissioning record.':'';
    if(review)step.files=[createOperatingFile({id:'complete-review',name:step.id+'-complete-review.json',mediaType:'application/json',
      bytes:new TextEncoder().encode(JSON.stringify(review,null,2)+'\n')}),...(filesByStep[step.id]??[])];
    else if(filesByStep[step.id])step.files=filesByStep[step.id];
  }
  return saveOperatingPlanRevision(plan,draft,{savedAt});
}
export function commissioningSupportingFile({id,name,mediaType,bytes,note=''}) {
  return createOperatingFile({id,name,mediaType,bytes,note});
}
