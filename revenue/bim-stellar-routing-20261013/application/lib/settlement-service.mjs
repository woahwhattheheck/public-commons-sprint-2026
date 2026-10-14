import {createOriginalSettlementAnalytics} from './settlement-source.mjs';
import {normalizeSettlementSelection} from './settlement-analytics.mjs';
import {bytes,clone,need,identity,hash} from './value.mjs';
const REVIEW_SCHEMA='bim.settlement-exception-review.v1';
const DECISIONS=new Set(['ACKNOWLEDGED','RESOLVED_WITH_SOURCE','EXCLUDED_FROM_SELECTED_SCOPE']);
function noteBody(value){try{const v=JSON.parse(value);return v?.schema===REVIEW_SCHEMA?v:null;}catch{return null;}}
/**
 * Immutable reports are indexed by exact original source and report selection.
 * Tabs share this workspace service but never replace another tab's report.
 * clear() belongs to the original authenticated workspace/session teardown.
 */
export function createSettlementService({workspace,readers=[]}){
 need(workspace&&typeof workspace.portable==='function'&&typeof workspace.commandWithMeta==='function','ORIGINAL_WORKSPACE_REQUIRED');
 const analytics=createOriginalSettlementAnalytics({readers}),sources=new Map(),reports=new Map(),selections=new Map();
 const selectionKey=(sourceSha256,selection)=>sourceSha256+':'+identity(normalizeSettlementSelection(selection));
 function retain(original,report,mode){
  const sha=report.source.sha256,key=selectionKey(sha,report.selection),prior=reports.get(report.sha256);
  if(prior)need(prior.report.source.sha256===sha&&identity(prior.report)===identity(report),'REPORT_IDENTITY_CONFLICT');
  if(selections.has(key))need(selections.get(key)===report.sha256,'REPORT_SELECTION_CONFLICT');
  if(!sources.has(sha))sources.set(sha,original);
  if(!prior)reports.set(report.sha256,{original:sources.get(sha),report,mode});
  selections.set(key,report.sha256);
  return {report:clone(report),mode};
 }
 function current(sourceSha256,reportSha256,selection){
  need(sources.has(sourceSha256),'ORIGINAL_REPORT_SOURCE_NOT_OPEN');
  const key=reportSha256??(selection!==undefined?selections.get(selectionKey(sourceSha256,selection)):null),c=reports.get(key);
  need(c&&c.report.source.sha256===sourceSha256,'ORIGINAL_REPORT_SELECTION_NOT_OPEN');
  if(selection!==undefined)need(identity(normalizeSettlementSelection(selection))===identity(c.report.selection),'REPORT_SELECTION_CHANGED');
  return c;
 }
 async function build(selection={}){
  const original=await workspace.portable(),report=analytics.report(original,selection);
  return retain(original,report,'LIVE_CAPTURE');
 }
 function receive(packet){
  const value=analytics.receivePackage(packet);
  return retain(value.source,value.result,'RECEIVED_ORIGINAL');
 }
 function source(input){
  const original=sources.get(input.sourceSha256);need(original,'ORIGINAL_REPORT_SOURCE_NOT_OPEN');
  return analytics.source(original,input.ref);
 }
 function file(input){
  const c=current(input.sourceSha256,input.reportSha256,input.selection);
  const names=new Set(['report.json','complete-source.json','volume.csv','selections.csv','route-attempts.csv','balance-observations.csv','vault-activities.csv','positions.csv','execution-quality.csv','movements.csv','reconciliation.csv','fallbacks.csv','lifecycle.csv','exceptions.csv','report.html','manifest.json']);
  need(names.has(input.name),'REPORT_FILE_UNKNOWN');
  const content=analytics.reportFile(c.original,c.report.selection,input.name),data=Buffer.from(content,'utf8');
  return {name:input.name,type:input.name.endsWith('.json')?'application/json; charset=utf-8':input.name.endsWith('.html')?'text/html; charset=utf-8':'text/csv; charset=utf-8',bytes:data,sha256:hash(data)};
 }
 function retainedReviews(input,workspaceId){
  return workspace.read().notes.flatMap(note=>{const body=noteBody(note.body);return body&&body.workspaceId===workspaceId&&body.sourceSha256===input.sourceSha256&&body.reportSha256===input.reportSha256?[{...clone(body),noteId:note.id,recordedAt:note.createdAt}]:[];});
 }
 function reviews(input){
  const c=current(input.sourceSha256,input.reportSha256);
  return retainedReviews(input,c.report.source.workspaceId);
 }
 function reviewArgs(input){
  const c=current(input.sourceSha256,input.reportSha256),state=workspace.read(),original=c.original.body.workspace;
  need(state.workspace.id===original.workspace.id,'RECEIVED_REPORT_BELONGS_TO_ANOTHER_WORKSPACE');
  need(state.history.length>=original.history.length&&identity(state.history.slice(0,original.history.length))===identity(original.history),'ORIGINAL_REPORT_HISTORY_CHANGED');
  need(state.history.slice(original.history.length).every(x=>x.method==='note.save'),'NEW_SOURCE_REQUIRES_FOLLOWING_REPORT');
  const exception=c.report.exceptions.find(x=>x.id===input.exceptionId);need(exception,'ORIGINAL_EXCEPTION_NOT_FOUND');
  need(DECISIONS.has(input.decision),'REVIEW_DECISION_REQUIRED');
  need(typeof input.reason==='string'&&input.reason.trim().length>0&&input.reason.length<=10000,'REVIEW_REASON_REQUIRED');
  need(Array.isArray(input.evidenceIds)&&new Set(input.evidenceIds).size===input.evidenceIds.length&&input.evidenceIds.every(id=>typeof id==='string'),'REVIEW_EVIDENCE_REQUIRED');
  const inventory=new Map(c.report.inventory.map(x=>[x.id,x]));
  const evidence=input.evidenceIds.map(id=>{need(inventory.has(id),'REVIEW_ORIGINAL_EVIDENCE_MISSING',{id});const x=inventory.get(id);return{id,sha256:x.sha256,bytes:x.bytes};});
  need(input.decision!=='RESOLVED_WITH_SOURCE'||evidence.length>0,'RESOLUTION_REQUIRES_ORIGINAL_SOURCE');
  const body={schema:REVIEW_SCHEMA,workspaceId:original.workspace.id,sourceRevision:original.workspace.revision,sourceSha256:c.report.source.sha256,reportSha256:c.report.sha256,selection:clone(c.report.selection),exceptionId:exception.id,exception:clone(exception),decision:input.decision,reason:input.reason,evidence,policy:'A review records the operator decision; it does not delete an exception or modify the original transaction or report.'};
  return{subjectId:'settlement-report:'+c.report.sha256,title:'Settlement exception: '+exception.kind,body:JSON.stringify(body)};
 }
 function prepareReview(input){
  const args=reviewArgs(input),state=workspace.read();
  return {args,expectedRevision:state.workspace.revision,workspaceId:state.workspace.id,sourceSha256:input.sourceSha256,reportSha256:input.reportSha256};
 }
 async function review(input,envelope){
  need(envelope&&typeof envelope.requestId==='string'&&Number.isSafeInteger(envelope.expectedRevision),'ORIGINAL_MUTATION_ENVELOPE_REQUIRED');
  // Reconcile the original request before any current-source check. A completed
  // original decision keeps its exact input and response after later source work.
  let prior;try{prior=workspace.request(envelope.requestId);}catch(error){if(error.code!=='REQUEST_NOT_FOUND')throw error;}
  if(prior){
   const saved=prior.envelope,body=noteBody(saved.args?.body);
   need(saved.requestId===envelope.requestId&&saved.expectedRevision===envelope.expectedRevision&&saved.method==='note.save'&&body,'ORIGINAL_REVIEW_REQUEST_CONFLICT');
   need(body.workspaceId===workspace.read().workspace.id&&saved.args.subjectId==='settlement-report:'+body.reportSha256,'ORIGINAL_REVIEW_WORKSPACE_CONFLICT');
   const expected={sourceSha256:body.sourceSha256,reportSha256:body.reportSha256,exceptionId:body.exceptionId,decision:body.decision,reason:body.reason,evidenceIds:body.evidence.map(x=>x.id)};
   const requested={sourceSha256:input.sourceSha256,reportSha256:input.reportSha256,exceptionId:input.exceptionId,decision:input.decision,reason:input.reason,evidenceIds:input.evidenceIds};
   need(identity(expected)===identity(requested),'ORIGINAL_REVIEW_INPUT_CONFLICT');
   const result=await workspace.commandWithMeta(saved);
   return {...result,reviews:retainedReviews(input,body.workspaceId)};
  }
  const args=reviewArgs(input);
  const result=await workspace.commandWithMeta({requestId:envelope.requestId,expectedRevision:envelope.expectedRevision,method:'note.save',args});
  return{...result,reviews:reviews(input)};
 }
 return Object.freeze({build,receive,source,file,reviews,reviewArgs,prepareReview,review,clear(){reports.clear();selections.clear();sources.clear();}});
}
