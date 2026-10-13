// MIT. Original CKAN workbench observations carried by the existing Support case.
// Pure review and readable handover; the original publisher remains the writer.
import {isDeepStrictEqual} from 'node:util';

const nativeText=value=>value===null||value===undefined?'—':typeof value==='string'?value:JSON.stringify(value);
const recordState=value=>value?.state??value?.status??null;

export function ckanCaptureView(capture,currentInputs) {
  const {meta,retained,summary}=capture.original;
  const alerts=[];
  if(summary.coverage!=='COMPLETE')alerts.push('Saved source coverage is '+summary.coverage+
    '. The attached original bytes identify the available part of this observation; resolve '+(summary.sourceError??'its recorded coverage condition')+' before assessing recovery.');
  if(summary.workbench?.stable===false)alerts.push('The original workbench changed during this read. Both exact state reads are retained; repeat the observation after the publisher reaches a stable saved state.');
  if(summary.identityContradiction)alerts.push('The saved project identity differs from the registered catalog origin or creation time. Inspect the original registration and project before changing the case mapping.');
  if(summary.integrityCodes.length)alerts.push('Original source integrity conditions: '+summary.integrityCodes.join(', ')+'.');
  if(summary.refresh)alerts.push('Refresh counts describe the original comparison and its selected query windows. Review the retained selection and interpretation before treating a missing selected row as a resource deletion.');
  if(summary.operation?.state==='RUNNING')alerts.push('RUNNING is the original saved operation state. Its recorded age is available here; use the original workbench operator to inspect the current process.');
  return {kind:'CKAN_WORKBENCH',scope:capture.scope,
    caseMatches:isDeepStrictEqual(capture.scope.inputs,currentInputs),
    capturedAt:meta.generatedAt,startedAt:meta.startedAt,sessionId:summary.project?.identity??null,
    mode:'ORIGINAL_READ_ONLY_CKAN',observerAttached:null,observerErrors:0,
    route:{id:meta.registration.id,method:'GET'},native:null,
    ckan:{...summary,registrationSelection:meta.selection,
      originalDocuments:Object.fromEntries([
        ['operation',summary.operation],['source',summary.source],['effectiveSource',summary.effectiveSource],
        ['editions',summary.editions],['comparison',summary.refresh?.comparison],['decision',summary.refresh?.decision],
        ['refresh',summary.refresh?.record],['publicationReview',summary.publication?.review],
        ['candidate',summary.publication?.candidate],['publicationResult',summary.publication?.result],
        ['publication',summary.publication?.record],['exports',summary.exports]
      ].map(([key,value])=>[key,value===undefined||value===null?null:JSON.stringify(value,null,2)])),
      originalFiles:retained.files.map(({path,role,bytes,sha256})=>({path,role,bytes,sha256}))},
    alerts,files:Object.entries(capture.files).map(([name,value])=>({name,bytes:value.bytes,sha256:value.sha256}))};
}

function progress(capture) {
  const s=capture.ckan;
  return {capturedAt:capture.capturedAt,coverage:s.coverage,workbench:s.workbench,
    selection:s.selection,operation:s.operation,
    source:{id:s.source?.id??null,effectiveId:s.effectiveSource?.id??null,
      sha256:s.effectiveSource?.sha256??s.source?.sha256??null,
      withdrawal:s.effectiveSource?.withdrawal??s.source?.withdrawal??null},
    refresh:s.refresh?{id:s.refresh.record.id,state:recordState(s.refresh.record),
      comparisonSha256:s.refresh.record.comparisonSha256??null,
      decisionSha256:s.refresh.decisionSha256,decision:s.refresh.decision,
      comparison:s.refresh.comparison}:null,
    publication:s.publication?{id:s.publication.record.id,state:recordState(s.publication.record),
      published:s.publication.published,verifiedOutput:s.publication.verifiedOutput}:null,
    pending:s.pending};
}
export function compareCkanCaptures(before,after) {
  if(before.kind!=='CKAN_WORKBENCH'||after.kind!=='CKAN_WORKBENCH')return {
    state:'DIFFERENT_OBSERVATION_KINDS',detail:'A CKAN workbench and a merchant traffic or buyer capture have different source identities. Review their original records separately.',interval:null};
  if(!isDeepStrictEqual(before.ckan.registrationSelection,after.ckan.registrationSelection))return {
    state:'CKAN_REGISTRATION_CHANGED',detail:'The pinned original project, selected records or reviewed observation limits changed. Each capture keeps the registration under which it was read.',interval:null};
  if(after.capturedAt<=before.capturedAt)return {state:'CAPTURE_ORDER',
    detail:'The after observation must be later than the before observation.',interval:null};
  const pair={before:progress(before),after:progress(after)};
  const observedIdentityDiffers=['catalogOrigin','createdAt'].some(key=>
    typeof before.ckan.project?.[key]==='string'&&typeof after.ckan.project?.[key]==='string'&&
    before.ckan.project[key]!==after.ckan.project[key]);
  if(before.ckan.identityContradiction||after.ckan.identityContradiction||observedIdentityDiffers)return {
    state:'CKAN_PROJECT_IDENTITY_CHANGED',detail:'The original project identity differs between these observations or its registered selection. The saved records remain attached for review.',interval:null,ckan:pair};
  if(before.ckan.coverage!=='COMPLETE'||after.ckan.coverage!=='COMPLETE'||
      before.ckan.workbench?.stable!==true||after.ckan.workbench?.stable!==true)return {
    state:'CKAN_COVERAGE_INCOMPLETE',detail:'At least one observation lacks complete, stable original source coverage. Both state reads and every retained source identity remain available for resolving that condition.',interval:null,ckan:pair};
  const advanced=!isDeepStrictEqual(before.ckan.selection,after.ckan.selection);
  return {state:advanced?'CKAN_SELECTED_RECORDS_CHANGED':'SAME_CKAN_PROJECT_OBSERVATIONS',
    detail:advanced?'The same original project selected different related records as its workflow advanced. Compare the retained source, refresh decision and publication identities below; the original comparison defines the meaning of its row changes.':
      'These are complete, stable observations of the same original CKAN project and selected records. Their saved operation, decision and publication states can be reviewed together under the original comparison.',
    interval:null,ckan:pair};
}

export function ckanRepairQueue(capture,side) {
  const s=capture.ckan,selected=s.registrationSelection,rows=[];
  const add=(kind,action)=>rows.push({source:side,routeId:capture.scope.routeId,kind,action});
  if(s.identityContradiction)add('identity','Compare the registered catalog origin and project creation time with the exact original workbench reads. Select the intended existing CKAN project before updating the registration.');
  if(s.integrityCodes.length)add('integrity','Inspect the retained source identities for '+s.integrityCodes.join(', ')+
    '. Restore the affected original capture, source or publisher output through the existing CKAN workspace recovery path.');
  if(s.coverage!=='COMPLETE')add('coverage','Resolve the recorded '+s.coverage+' condition'+
    (s.sourceError?' ('+s.sourceError+')':'')+'. Keep the original project and record selection; review its complete workload and repeat the read.');
  if(s.workbench?.stable===false)add('coverage','Read the original project again after its saved operation finishes changing the workbench. The two retained state hashes show this observation crossed a change.');
  if(['FAILED','INTERRUPTED'].includes(s.operation?.state))add('operation','Open the original CKAN workbench operation '+s.operation.id+
    ' and resolve its recorded '+nativeText(s.operation.error)+'. Continue through the existing workbench operation and its saved source.');
  if(s.operation?.state==='RUNNING'&&s.operation.ageSeconds!==null&&s.operation.ageSeconds>=selected.operationAfterSeconds)
    add('operation','Inspect the original workbench operation '+s.operation.id+' and its active process. Its saved RUNNING record is '+
      s.operation.ageSeconds+' seconds old against the registered '+selected.operationAfterSeconds+' second threshold.');
  if(s.pending?.review)add('refresh','Review the complete original comparison, selection windows and source semantics for refresh '+
    (s.refresh?.record.id??s.selection.refreshId??'recorded in this project')+
    '. Use the existing reviewed refresh action to accept the successor, keep the current source or withdraw it, with the original comparison identity.');
  if(s.pending?.publication)add('publication','Inspect the original publication review for source '+
    (s.effectiveSource?.id??s.selection.effectiveSourceId??s.source?.id??'selected in this project')+
    '. Complete its reviewed publisher operation and retain the resulting candidate, dataset and merchant export identities.');
  if(s.source?.withdrawal||s.effectiveSource?.withdrawal||s.refresh?.record.state==='SOURCE_WITHDRAWN')
    add('withdrawal','Use the recorded withdrawal decision to review the affected live service configuration and customer cases. Keep earlier publication records attached to the source they originally served.');
  return rows;
}

