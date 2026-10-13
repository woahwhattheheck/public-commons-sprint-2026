// MIT. Source-bound Gateway cohort course over the original Tyk rollout engine.
import { createOperatingPlan, createOperatingStep, createOperatingFile, operatingPlanDraft,
  saveOperatingPlanRevision, inspectOperatingPlan } from '../../../distribution/discovery/operating-plan.mjs';
import { planTykRequest, inspectTykDefinition } from '../native.mjs';
export const TYK_GATEWAY_COMMISSIONING_SCHEMA='stellar-forge.tyk-gateway-commissioning.v1';
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'TYK_GATEWAY_COURSE_INVALID',status:400});};
const text=(v,max=20000,required=false)=>{need(typeof v==='string'&&v.length<=max&&!v.includes('\0')&&(!required||v.trim()),'Use complete text within its declared bound.');return v;};
export const gatewayRecordRef=r=>r?{kind:r.kind,id:r.id,revision:r.revision,sha256:r.sha256}:null;
export function gatewayEntries(entries,connection) {
  need(Array.isArray(entries)&&entries.length>0&&entries.length<=200,'Select one to 200 complete API source entries.');
  need(entries.reduce((bytes,entry)=>bytes+new TextEncoder().encode(entry?.selection?.definitionText??'').length,0)<=16*1024*1024,'The complete selected native definition sources must fit within 16 MiB.');
  const selected=entries.map(entry=>{
    need(entry&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(entry.key),'Each source entry needs a unique stable key.');
    const label=text(entry.label??entry.key,300,true);
    need(['create','import','update'].includes(entry.selection?.operation),'Select the original Gateway create, import or update operation.');
    need(['create','update'].includes(entry.productionOperation),'Choose production create or update explicitly for every API.');
    const plan=planTykRequest(connection,entry.selection);
    need(!plan.relatedApiIds.length&&!Object.keys(plan.query).some(k=>['base_api_id','base_api_version_name','new_version_name','set_default'].includes(k)),
      'Version-family changes use a separate original native rollout; this course retains one exact ID per API.');
    const inspection=inspectTykDefinition(plan.bodyText,{kind:plan.kind});
    need(plan.operation==='import'||inspection.apiId,'Create and update sources must retain their exact native API ID.');
    return {key:entry.key,label,selection:{...entry.selection},productionOperation:entry.productionOperation,sourceSha256:inspection.sha256,sourceBytes:inspection.bytes};
  });
  need(new Set(selected.map(e=>e.key)).size===selected.length,'Source entry keys must be unique.');
  const ids=selected.map(e=>inspectTykDefinition(e.selection.definitionText).apiId).filter(Boolean);
  need(new Set(ids).size===ids.length,'Each selected native API ID must occur once.');
  return selected;
}
export function gatewayCheckNames(values){
  need(Array.isArray(values)&&values.length>0&&values.length<=50,'Select one to fifty operational checks.');
  const result=values.map(v=>text(v,200,true).trim());
  need(new Set(result).size===result.length,'Check names must be unique.');return result;
}
export function gatewaySteps(entries){
  return [
    ...entries.map(e=>({id:'stage:'+e.key,phase:'staging',key:e.key,title:'Stage · '+e.label,type:'native'})),
    {id:'stage-reload',phase:'staging',title:'Reload staging Gateway',type:'native'},
    {id:'stage-capture',phase:'staging',title:'Capture active staging definitions',type:'capture'},
    {id:'stage-review',phase:'staging',title:'Accept staging operation',type:'review'},
    ...entries.map(e=>({id:'production:'+e.key,phase:'production',key:e.key,title:'Production · '+e.label,type:'native'})),
    {id:'production-reload',phase:'production',title:'Reload production Gateway',type:'native'},
    {id:'production-capture',phase:'production',title:'Capture active production definitions',type:'capture'},
    {id:'production-review',phase:'production',title:'Accept production operation',type:'review'},
  ];
}
export function gatewayApiId(rollout){
  const ids=rollout?.reconciliation?.evidence?.providerReturnedApiIds??[];
  const selected=rollout?.plan?.apiIds??[];
  const complete=rollout?.plan?.operation==='import'?ids:(ids.length?ids:selected);
  return complete.length===1?complete[0]:null;
}
const confirmed=r=>r?.value.phase==='COMPLETED'&&r.value.state==='CONFIRMED'&&r.reconciliation?.evidence?.confirmation==='CURRENT_NATIVE_CONFIGURATION_MATCH';
export function gatewayWriteRetained(r){
  return Boolean(r?.value.dispatchedAt&&r.value.phase==='COMPLETED'&&gatewayApiId(r)&&
    (confirmed(r)||r.value.state==='ACCEPTED'&&r.reconciliation?.response?.acknowledged));
}
export function gatewayUncertainKnown(r){
  return Boolean(r?.value.dispatchedAt&&gatewayApiId(r)&&!r.reconciliation?.response?.acknowledged&&!confirmed(r)&&
    !['DIVERGED','PARTIAL'].includes(r.value.state));
}
export function gatewayObservation(value,details,phase,capture,inventory){
  if(!capture||capture.value.phase!=='COMPLETED'||!inventory)return null;
  const target=value.targets[phase];
  if(capture.value.connectionId!==target.id||capture.value.configurationSha256!==target.configurationSha256)return null;
  const rows=value.entries.map(entry=>{
    const rollout=details.rollouts[(phase==='staging'?'stage:':'production:')+entry.key],apiId=gatewayApiId(rollout);
    const item=inventory.items.find(row=>row.apiId===apiId);
    const matched=rollout?.reconciliation?.items?.find(row=>row.apiId===apiId);
    const imported=phase==='staging'&&rollout?.plan?.operation==='import';
    const importObserved=imported&&rollout.value.phase==='COMPLETED'&&rollout.reconciliation?.response?.acknowledged&&
      rollout.reconciliation.evidence.providerReturnedApiIds?.length===1&&item?.kind==='oas';
    if(!apiId||!item||item.found===false||matched?.afterSha256!==item.sha256||
      !(importObserved||confirmed(rollout)&&matched?.correspondence?.matched))return null;
    if(phase==='production'){
      const staged=details.observations.staging?.apis.find(row=>row.key===entry.key);
      if(!staged||staged.apiId!==apiId||staged.kind!==item.kind)return null;
    }
    return {key:entry.key,label:entry.label,apiId,kind:item.kind,sha256:item.sha256,bytes:item.bytes,summary:item.summary,definitionRef:item.definitionRef??null,
      rolloutId:rollout.id,planSha256:rollout.value.planSha256,confirmation:importObserved?'NATIVE_IMPORT_RECEIPT_AND_ACTIVE_SOURCE':rollout.reconciliation.evidence.confirmation,
      transformationRequired:importObserved,submittedSha256:entry.sourceSha256,
      nativeAcknowledged:rollout.reconciliation.evidence.nativeAcknowledged};
  });
  if(rows.some(row=>!row)||new Set(rows.map(row=>row.apiId)).size!==rows.length)return null;
  return {phase,capture:gatewayRecordRef(capture),apis:rows};
}
export function gatewayReviewContext(value,details,phase){
  const observation=details.observations[phase];
  need(observation&&observation.apis.length===value.entries.length,'Capture every complete active API and its corresponding original request before review.');
  return {schema:TYK_GATEWAY_COMMISSIONING_SCHEMA,phase,targets:value.targets,source:value.source,checkNames:value.checkNames,observation};
}
export function gatewayReview(input,value,context){
  const reviewer=text(input.reviewer,300,true),note=text(input.note,20000,true),checks=input.checks;
  need(Array.isArray(checks),'Record the complete operational check matrix.');
  const expected=context.observation.apis.flatMap(api=>value.checkNames.map(name=>api.apiId+'\0'+name));
  need(checks.length===expected.length,'Record every selected API/check pair.');
  const keys=checks.map(row=>{need(['passed','failed'].includes(row.outcome),'Checks require a passed or failed outcome.');
    text(row.apiId,1000,true);text(row.name,200,true);text(row.note,20000,true);return row.apiId+'\0'+row.name;});
  need(new Set(keys).size===keys.length&&expected.every(key=>keys.includes(key)),'Use each selected API/check pair exactly once.');
  const expectedTransformations=context.observation.apis.filter(api=>api.transformationRequired),transformations=input.transformations??[];
  need(Array.isArray(transformations)&&transformations.length===expectedTransformations.length,'Explicitly review every native-generated OpenAPI transformation.');
  need(new Set(transformations.map(row=>row.key)).size===transformations.length,'Use each transformed source once.');
  for(const api of expectedTransformations){
    const decision=transformations.find(row=>row.key===api.key);
    need(decision&&decision.apiId===api.apiId&&decision.submittedSha256===api.submittedSha256&&decision.observedSha256===api.sha256&&
      ['accepted','changes-requested'].includes(decision.decision),'The transformation review must bind both exact submitted and active native sources.');
    text(decision.note,20000,true);
  }
  return {reviewer,note,checks,transformations,accepted:checks.every(row=>row.outcome==='passed')&&transformations.every(row=>row.decision==='accepted')};
}
export function gatewayProgress(value,details,{hash}){
  const steps=gatewaySteps(value.entries),done={};
  for(const phase of ['staging','production']){
    const prefix=phase==='staging'?'stage':'production';
    for(const entry of value.entries)done[prefix+':'+entry.key]=gatewayWriteRetained(details.rollouts[prefix+':'+entry.key]);
    const reload=details.rollouts[prefix+'-reload'];
    const source=details.observations[phase];
    done[prefix+'-reload']=Boolean(reload?.value.dispatchedAt&&
      (reload.reconciliation?.response?.acknowledged||source&&source.apis.every(api=>['CURRENT_NATIVE_CONFIGURATION_MATCH','NATIVE_IMPORT_RECEIPT_AND_ACTIVE_SOURCE'].includes(api.confirmation))));
    done[prefix+'-capture']=Boolean(source);
    try{const context=gatewayReviewContext(value,details,phase);done[prefix+'-review']=value.reviews[phase]?.accepted===true&&value.reviews[phase].contextSha256===hash(context);}catch{done[prefix+'-review']=false;}
  }
  const rows=steps.map((step,index)=>{
    let ready=steps.slice(0,index).every(previous=>done[previous.id]||(step.type==='native'&&step.key&&previous.key&&previous.phase===step.phase&&gatewayUncertainKnown(details.rollouts[previous.id])));
    if(step.id.endsWith('-reload')){
      const phase=step.phase,prefix=phase==='staging'?'stage':'production';
      const beforePhase=phase==='staging'||done['stage-review'];
      ready=Boolean(beforePhase&&value.entries.every(e=>gatewayWriteRetained(details.rollouts[prefix+':'+e.key])||gatewayUncertainKnown(details.rollouts[prefix+':'+e.key])));
    }else if(step.type==='capture'){
      const prefix=step.phase==='staging'?'stage':'production';
      ready=Boolean(details.rollouts[prefix+'-reload']?.value.dispatchedAt);
    }
    const rollout=details.rollouts[step.id]??null;
    return {...step,complete:Boolean(done[step.id]),ready:ready&&!done[step.id],status:done[step.id]?'completed':rollout?'in-progress':'planned',
      record:gatewayRecordRef(rollout),nativeState:rollout?.value.state??null,
      uncertainWrites:step.id.endsWith('-reload')?value.entries.filter(e=>gatewayUncertainKnown(details.rollouts[(step.phase==='staging'?'stage:':'production:')+e.key])).map(e=>e.key):[]};
  });
  return {schema:TYK_GATEWAY_COMMISSIONING_SCHEMA,state:rows.every(row=>row.complete)?'COMPLETE':'IN_PROGRESS',
    steps:rows,next:rows.find(row=>!row.complete)?.id??null,summary:{apis:value.entries.length,steps:rows.length,completed:rows.filter(row=>row.complete).length,checks:value.entries.length*value.checkNames.length*2}};
}
export function createGatewayPlan({id,label,customer='',operator='',entries,checks,sourceFile,workshare,savedAt}){
  return createOperatingPlan({id,title:label,customer,owner:operator,
    purpose:'Commission complete source-bound APIs through staging and production Gateways with explicit native writes, reloads and actual operational acceptance.',
    receiving:'Retain the complete Tyk workspace and original operating plan. Reopen the same Gateway commissioning record after independent receiving.',
    notes:'Native write acknowledgement and active configuration correspondence remain separate. Unknown dispatched requests are never sent again.',
    steps:gatewaySteps(entries).map((step,index)=>createOperatingStep({id:step.id.replace(':','-api-'),title:step.title,
      instruction:step.type==='capture'?'Capture the complete active portfolio and reconcile each original dispatched request.':step.type==='review'?
        'Review exact active definitions and record every API/check outcome with actual supporting results.':step.id.endsWith('-reload')?
        'Review and explicitly dispatch the original Gateway reload. Inspect any uncertain original writes first.':
        'Prepare and review the complete native request, then explicitly dispatch that saved original request once.',
      owner:operator,inputs:checks.join('\n'),expectedResult:'Complete original source, request, native result and receiving history remain available.',
      ...(index===0?{files:[sourceFile,...(workshare?[workshare.source]:[])]}:{} )})),savedAt});
}
export function updateGatewayPlan(plan,progress,reviews,files,savedAt){
  inspectOperatingPlan(plan);const draft=operatingPlanDraft(plan);
  for(const step of draft.content.steps){
    const row=progress.steps.find(row=>row.id.replace(':','-api-')===step.id);if(!row)continue;
    step.status=row.status;
    const review=row.type==='review'?reviews[row.phase]:null;
    step.recordedResult=JSON.stringify(review?{reviewer:review.reviewer,note:review.note,accepted:review.accepted,
      checks:review.checks.length,contextSha256:review.contextSha256,recordedAt:review.recordedAt}:
      {complete:row.complete,nativeState:row.nativeState,record:row.record},null,2);
    if(review)step.files=[createOperatingFile({id:'complete-review',name:step.id+'-complete-review.json',mediaType:'application/json',
      bytes:new TextEncoder().encode(JSON.stringify(review,null,2)+'\n')}),...(files[row.phase]??[])];
  }
  return saveOperatingPlanRevision(plan,draft,{savedAt});
}
