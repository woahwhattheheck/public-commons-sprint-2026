// MIT. Browser-safe presentation of complete retained merchant observations.
const esc=v=>String(v??'Not observed').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show=v=>v===true?'Yes':v===false?'No':v??'Not observed';
const table=(heads,rows)=>'<div class="scroll case-table-wrap"><table class="case-table"><thead><tr>'+heads.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(show(v))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const measures=[['orders','Orders'],['receiptVerified','Recorded verified receipts'],['unresolved','Unresolved payments'],
  ['recordedResultComplete','Recorded complete results'],['receiptOutputPending','Verified receipt awaiting result'],
  ['fulfillmentInterrupted','Interrupted fulfillment'],['contradictions','Receipt/result contradictions'],
  ['authorityRejected','Recorded authority rejections'],['pendingWebhooks','Pending webhook records']];
export function x402ObservationHtml(o,{title='Merchant payment and delivery',offset=0,limit=50,all=false}={}) {
  if(!o)return '<p>No original merchant observation is retained.</p>';
  const rows=o.orders??[],selected=o.selection,chosen=all?rows:rows.slice(offset,offset+limit),summarized=o.projection==='COMPLETE_CONDITIONS_WITH_BOUNDED_ORDER_DETAILS';
  return '<section class="runtime-capture x402-observation"><h3>'+esc(title)+'</h3><p>Source coverage: '+esc(o.coverage)+
    ' · Captured '+esc(o.sourceCapturedAt)+' · Collected '+esc(o.collectedAt??o.observedAt)+'</p>'+
    table(['Measure','Original recorded value'],measures.map(([key,label])=>[label,o.counts?.[key]]))+
    (summarized?'<p>These condition totals cover every original order. Detailed rows include '+esc(o.details?.returnedOrders)+' of '+esc(o.details?.matchingOrders)+' condition-bearing orders; '+esc(o.details?.omittedOrders)+' further detail rows are omitted by the bounded projection.</p>':'')+
    (o.fullCaptureError?'<p>Complete history capture: '+esc(o.fullCaptureError)+'. The original summary remains retained with its own time and digest.</p>':'')+
    '<p>Receipt verification records the original merchant’s accepted signature and terms. Result completion records its original fulfillment receipt. This observation performs no payment, ledger query, fulfillment or output-byte verification.</p>'+
    (selected?'<details><summary>Reviewed merchant identity</summary>'+table(['Field','Retained selection'],[
      ['Store',selected.storeId],['Tenant',selected.tenantId],['Resource version',selected.resourceVersionId],
      ['Configuration SHA-256',selected.configurationSha256],['Observation endpoint',selected.endpoint],
      ['Polling mode',selected.polling??'full'],['Reviewed inputs SHA-256',selected.inputsSha256??o.binding?.inputsSha256??o.polling?.binding?.inputsSha256??'Not selected'],
      ['Credential environment reference',selected.tokenEnv],['Payment age threshold, seconds',selected.paymentAfterSeconds],
      ['Output age threshold, seconds',selected.outputAfterSeconds]])+'</details>':'')+
    (o.sourceFile?'<p>Original source: '+esc(o.sourceFile.bytes)+' bytes · SHA-256 '+esc(o.sourceFile.sha256)+'</p>':'')+
    '<h4>Original orders</h4><p>'+esc(o.orderDetails==='RETAINED_CAPTURE'?'Full order rows remain in the original capture; open an incident or its Support case for paged detail':rows.length?all?(summarized?'All retained '+rows.length+' condition detail rows':'All '+rows.length+' orders'):(offset+1)+'–'+Math.min(rows.length,offset+limit)+' of '+rows.length+' orders':(summarized?'No retained condition detail rows; total original orders: '+String(o.counts?.orders??'Unknown'):'No original orders'))+
    '. Ages use the original attempt or receipt transition, including across repeated reads.</p>'+
    table(['Order / reference','Original tenant / resource','State','Verified receipt','Unresolved since / age seconds','Fulfillment','Recorded complete result','Output wait seconds','Original issue'],
      chosen.map(r=>[r.id+' / '+r.reference,r.source?r.source.tenantId+' / '+r.source.resourceVersionId:'In original full source',r.state,r.receiptVerified,
        (r.unresolvedSince??'—')+' / '+(r.unresolvedAgeSeconds??'Unknown'),r.fulfillmentState,r.recordedResultComplete,
        r.receiptOutputAgeSeconds,[r.contradiction?'Receipt/result contradiction':'',r.authorityRejected?'Authority rejected':'',
          r.resultProjectionPending?'Order projection pending':''].filter(Boolean).join('; ')||'—']))+
    (!all&&rows.length>limit?'<p><button type="button" data-x402-page="-1"'+(offset<=0?' disabled':'')+'>Previous orders</button> '+
      '<button type="button" data-x402-page="1"'+(offset+limit>=rows.length?' disabled':'')+'>Next orders</button></p>':'')+
    (summarized?'<p>The two JSON files retain the exact bounded summary, complete condition counts, original age aggregates and selected history continuity proof. Full history and exchange descriptors remain in the merchant’s original full capture.</p>':'<p>The two original JSON files retain every order, history transition, provider exchange descriptor, webhook descriptor and fulfillment descriptor. An optional polling proof retains the earlier exact summary separately.</p>')+'</section>';
}
export function x402CaptureHtml(capture){return x402ObservationHtml(capture.x402,{title:'Merchant · '+(capture.x402?.registration?.label??capture.scope.routeId),all:true});}
export function x402ComparisonHtml(comparison) {
  const x=comparison.x402;if(!x)return '';
  return '<section><h3>Merchant outcome comparison</h3><p>'+esc(comparison.detail)+'</p>'+
    table(['Measure','Before','After'],measures.map(([k,label])=>[label,x.before.counts?.[k],x.after.counts?.[k]]))+
    '<p>Changed original order views: '+esc(x.changes.length)+'. Order counts are not monetary totals; no currencies or assets are added together.</p></section>';
}
export function mountX402Observation(root,observation,title) {
  let offset=0;const draw=()=>{root.innerHTML=x402ObservationHtml(observation,{title,offset});};
  const click=e=>{const button=e.target.closest('[data-x402-page]');if(!button||!root.contains(button))return;
    offset=Math.max(0,Math.min(Math.max(0,(observation.orders?.length??0)-1),offset+Number(button.dataset.x402Page)*50));draw();};
  root.addEventListener('click',click);draw();return ()=>{root.removeEventListener('click',click);root.replaceChildren();};
}
