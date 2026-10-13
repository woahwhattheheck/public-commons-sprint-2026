// MIT. Verify original saved DMN source and native results; never evaluate rules locally.
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'FLOWABLE_DECISION_PROGRAMME_REVIEW'});};
const canonical=value=>JSON.stringify(value&&typeof value==='object'?(Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))]))):value);
const ref=record=>({kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256});
export async function verifyFlowableDecisionProgrammeOperation({expectation,operation,readSource,phase}){
 need(expectation&&operation?.kind===expectation.kind&&typeof readSource==='function'&&['prepared','confirmed'].includes(phase),
  'Review the original selected DMN programme operation.');
 const v=operation.value;need(v?.selection&&v.before,'Retain the complete original selection and source preimage.');
 const selection=await readSource(v.selection),before=await readSource(v.before);
 const source=expectation.source;
 let selectedDefinition=null;
 if(operation.kind==='decisionRelease'){
  need(selection.action==='deploy'&&selection.resource.filename===source.filename,'The original deployment source changed.');
  // The maintained plan already binds every complete resource byte to the original request.
  need(v.plan,'Keep the original frozen native plan.');const plan=await readSource(v.plan);
  need(plan.source?.bytes===source.bytes&&plan.source.sha256===source.sha256,'The selected native deployment differs from the catalogue.');
 }else{
  need(canonical(selection)===canonical(expectation.selection),'The original exact typed evaluation request differs.');
  need(Array.isArray(before.definitions)&&Array.isArray(before.resources),'Keep every selected native definition and full resource.');
  const body=JSON.parse(selection.bodyText),tenant=body.tenantId??'';
  const candidates=before.definitions.filter(d=>d.key===expectation.familyKey&&(d.tenantId??'')===tenant);
  need(candidates.length>0&&candidates.every(d=>Number.isSafeInteger(Number(d.version))&&Number(d.version)>0),'Read actual versioned native definitions in the selected key and tenant.');
  const latest=Math.max(...candidates.map(d=>Number(d.version))),selected=candidates.filter(d=>Number(d.version)===latest);
  need(selected.length===1,'The native latest definition is ambiguous.');selectedDefinition=selected[0];
  need(before.resources.some(r=>r.kind==='dmn-definition-resource'&&r.deploymentId===selectedDefinition.deploymentId&&
   r.filename===source.filename&&r.bytes===source.bytes&&r.sha256===source.sha256&&
   (r.definitionId===selectedDefinition.id||r.definitionIds?.includes(selectedDefinition.id))),
   'The current native rule is not the selected source edition. Retain this original operation and review the competing deployment.');
 }
 if(phase==='prepared'){
  need(v.phase==='PREPARED'&&!v.dispatchedAt,'Review the unchanged prepared operation before its first native dispatch.');
  return{record:ref(operation),phase,source,preparedDefinition:selectedDefinition};
 }
 need(v.state==='CONFIRMED'&&v.response,'Read the actual confirmed original response.');
 const response=await readSource(v.response);
 need(response.status===201,'The original native response must be HTTP 201.');
 if(operation.kind==='decisionRelease'){
  const reconciliation=await readSource(v.reconciliation);
  need(reconciliation.evidence?.sourceSha256===source.sha256&&reconciliation.evidence.nativeAcknowledged===true&&
   response.json?.id===reconciliation.evidence.deploymentId,'Retain the native deployment receipt and exact source readback.');
  return{record:ref(operation),phase,source,deploymentId:response.json.id,response:{bytes:response.bodyBytes,sha256:response.bodySha256}};
 }
 need(Array.isArray(response.json?.resultVariables),'Retain the original native typed result variables.');
 const results=response.json.resultVariables.flatMap(value=>Array.isArray(value)?value:[value]);
 const route=results.filter(value=>value.name==='reviewRoute');
 need(route.length===1&&route[0].type==='string'&&route[0].value===expectation.expectedReviewRoute,
  'The native response differs from the authored reference route; retain the complete original result for review.');
 return{record:ref(operation),phase,source,preparedDefinition:selectedDefinition,caseId:expectation.caseId,
  response:{bytes:response.bodyBytes,sha256:response.bodySha256},resultVariables:response.json.resultVariables};
}
