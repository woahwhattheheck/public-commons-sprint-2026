// MIT. Original ObjectSession observations carried by the existing Support case.
// Pure capture review and readable handover; no path is opened or buyer invoked.
import {isDeepStrictEqual} from 'node:util';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nativeText=value=>value===null||value===undefined?'—':typeof value==='string'?value:JSON.stringify(value);
const table=(heads,rows)=>'<div class="scroll"><table><thead><tr>'+heads.map(value=>'<th>'+esc(value)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+esc(value??'—')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
export function objectCaptureView(capture,currentInputs) {
  const {meta,report,accounting,summary}=capture.original;
  const current=accounting.after??accounting.before;
  const entries=current?.pages.flatMap(page=>page.entries)??[];
  const paymentTermsMatch=summary.terms===null?null:
    currentInputs.network===summary.terms.network&&currentInputs.payTo===summary.terms.payTo;
  return {kind:'OBJECT_SESSION',scope:capture.scope,
    caseMatches:isDeepStrictEqual(capture.scope.inputs,currentInputs),
    capturedAt:meta.generatedAt,startedAt:summary.sessionCreatedAt,sessionId:meta.selection.sessionId,
    mode:'ORIGINAL_READ_ONLY_BUYER',observerAttached:null,observerErrors:0,
    route:{id:meta.registration.id,method:'GET'},native:null,
    object:{...summary,paymentTermsMatch,entries,accountingRead:accounting.after?'AFTER_VERIFICATION':
      accounting.before?'BEFORE_VERIFICATION_ONLY':'UNAVAILABLE',
      originalReportStatus:report?.status??null},
    alerts:[...(summary.coverage==='COMPLETE'?[]:['The original observation coverage is '+summary.coverage+'. Missing views or bytes are not a zero balance or a completed delivery.']),
      ...(paymentTermsMatch===false?['The selected case network or recipient differs from this original ObjectSession. Review that mapping before using these payment terms.']:[]),
      'Finalization results are retained per-request native views. This file intake does not revalidate a ledger or execute a payment.',
      'Recorded assembly receipts remain historical; this observation verified the original saved chunks, not an external assembly destination.'],
    files:Object.entries(capture.files).map(([name,value])=>({name,bytes:value.bytes,sha256:value.sha256}))};
}
export function compareObjectCaptures(before,after) {
  if(before.kind!=='OBJECT_SESSION'||after.kind!=='OBJECT_SESSION')return {state:'DIFFERENT_OBSERVATION_KINDS',
    detail:'Buyer output and merchant traffic have different source identities. Review each original capture separately.',interval:null};
  if(!isDeepStrictEqual(before.object.selection,after.object.selection))return {state:'OBJECT_SELECTION_CHANGED',
    detail:'The selected original session, exact manifest or reviewed observation limits changed. The captures retain separate source bindings.',interval:null};
  if(after.capturedAt<=before.capturedAt)return {state:'CAPTURE_ORDER',
    detail:'The after observation must be later than the before observation.',interval:null};
  const complete=before.object.coverage==='COMPLETE'&&after.object.coverage==='COMPLETE';
  return {state:complete?'SAME_OBJECT_OBSERVATIONS':'OBJECT_COVERAGE_INCOMPLETE',
    detail:complete?'These are two complete read-only observations of the same selected ObjectSession. Compare the original request outcomes and verified output independently; a status change does not prove which action caused it.':
      'At least one observation has incomplete source coverage. Its retained failures remain visible, and the case does not infer recovered financial state or output from missing data.',
    interval:null,object:{before:{financial:before.object.financial,output:before.object.output},
      after:{financial:after.object.financial,output:after.object.output}}};
}
export function objectRepairQueue(capture,side) {
  const s=capture.object,rows=[],add=(kind,action)=>rows.push({source:side,routeId:capture.scope.routeId,kind,action});
  if(s.identityContradiction)add('identity','Compare the saved session-file hash, configuration and original intent with the reviewed registration. Preserve the original request and affected files; do not authorize a replacement payment to clear this incident.');
  if(s.integrityCodes.length)add('integrity','Inspect the exact original evidence and saved bytes for '+s.integrityCodes.join(', ')+'. Retain the failed output and use the existing native recovery operation.');
  if(s.coverage!=='COMPLETE')add('coverage','Resolve the original source coverage condition '+s.coverage+' and repeat a read-only observation under the same selection. An unavailable source cannot establish recovery.');
  if(s.financial.unresolvedRequests)add('financial','Reconcile '+s.financial.unresolvedRequests+' selected request(s) through the original financial operator. Keep any previous finalized view as history; this watcher never retries, settles or releases a payment.');
  if(s.financial.finalizedRequests&&s.output.state!=='VERIFIED_COMPLETE')add('output','Review the finalized request(s) and original incomplete output separately. Use the existing saved-session delivery/recovery path without acquiring an already attempted request again.');
  if(s.financial.unresolvedAgeUnknown||s.financial.finalizedAgeUnknown)add('coverage','Some original attempt or completion timestamps are unavailable. Their age condition remains unknown; the watcher did not substitute the capture time as the request start.');
  if(s.paymentTermsMatch===false)add('mapping','The case network or recipient differs from the captured original buyer terms. Select the actual intended case before continuing.');
  return rows;
}
export function objectCaptureHtml(c) {
  const s=c.object,f=s.financial,o=s.output,selected=s.selection;
  return '<h3>Original buyer selection</h3>'+
    table(['Session','Original intent','Session file SHA-256','Configuration SHA-256'],[[selected.sessionId,selected.sourceIntentId,selected.sessionSha256,selected.configurationSha256]])+
    '<p>Saved source: '+esc(selected.directory)+' · Resource: '+esc(s.sourceUrl??'Unavailable in this observation')+'</p>'+
    '<h3>Recorded financial outcomes</h3>'+
    '<p>Current capture coverage: '+esc(s.coverage)+' · Accounting read: '+esc(s.accountingRead)+
      '. Finalized request counts do not represent a monetary total or a new ledger query.</p>'+
    table(['Finalized requests','Unresolved views','Not attempted','No payment required','Earlier finalized histories'],
      [[f.finalizedRequests,f.unresolvedRequests,f.notAttemptedRequests,f.noPaymentRequests,f.historicalFinalizedRequests]])+
    table(['Unresolved age / threshold','Finalized-output age / threshold','Unknown timestamps'],
      [[nativeText(f.unresolvedAgeSeconds)+' / '+selected.financialAfterSeconds+' seconds',
        nativeText(f.finalizedAgeSeconds)+' / '+selected.outputAfterSeconds+' seconds',
        f.unresolvedAgeUnknown+' unresolved; '+f.finalizedAgeUnknown+' finalized']])+
    '<h3>Verified customer output</h3>'+
    table(['Output state','Verified / expected bytes','Verified / total chunks','Complete SHA-256'],
      [[o.state,nativeText(o.verifiedBytes)+' / '+nativeText(o.expectedBytes),
        nativeText(o.verifiedChunks)+' / '+nativeText(o.chunks),o.sha256]])+
    '<p>Original process observation: '+esc(s.process?nativeText(s.process):'No active lock reported')+
      '. Process state, recorded finalization and verified output retain separate meanings.</p>'+
    '<details><summary>Every original request outcome</summary>'+
    table(['Index / original intent','Current native outcome','Native actual value','Completion / view','Receipt / request SHA-256','Earlier finalized history'],
      s.entries.map(entry=>[entry.index+' / '+entry.intentId,entry.outcome,nativeText(entry.actualAtomicUnits),
        (entry.completedAt??'No completion')+' / '+(entry.viewStatus??'—'),
        nativeText(entry.receipt)+' / '+(entry.requestSha256??'—'),nativeText(entry.lastFinalized)]))+'</details>'+
    '<details><summary>Original buyer terms</summary><pre>'+esc(nativeText(s.terms))+'</pre></details>';
}
