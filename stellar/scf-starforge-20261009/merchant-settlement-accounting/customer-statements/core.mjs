// MIT. Customer statements over retained native accounting and original service orders.
import {createHash} from 'node:crypto';
import {compileAccountingPeriod} from '../reconcile.mjs';
import {indexAdjustments,summarizeAdjustments,adjustmentEventKey} from '../adjustments.mjs';
import {projectApiPassExport} from './native-usage.mjs';

export const STATEMENT_SCHEMA='stellar-forge.merchant-customer-statement.v1';
export const USAGE_SCHEMA='stellar-forge.sf101.service-usage-export.v1';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const json=value=>JSON.stringify(value,null,2)+'\n';
export const need=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const HEX=/^[a-f0-9]{64}$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const MAX=(1n<<127n)-1n;
export function label(value,name,max=160,empty=false){
  need(typeof value==='string'&&(empty||value.trim().length>0)&&value.trim().length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    'INVALID_STATEMENT_FIELD','Check '+name+'.');return value.trim();
}
export function orderReference(value){
  need(typeof value==='string'&&/^[A-Za-z0-9._:-]{1,80}$/.test(value),'INVALID_ORDER_REFERENCE','Use the original order reference.');return value;
}
export function integer(value,name='quantity',positive=false){
  need(typeof value==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(value)&&BigInt(value)<=MAX&&(!positive||BigInt(value)>0n),
    'INVALID_STATEMENT_INTEGER','Use an exact '+(positive?'positive ':'')+'integer string for '+name+'.');return value;
}
function digest(value,name,nullable=false){
  if(nullable&&(value===null||value===undefined))return null;
  need(typeof value==='string'&&HEX.test(value),'INVALID_STATEMENT_DIGEST','Check '+name+'.');return value;
}
function instant(value,name){
  need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value)),
    'INVALID_STATEMENT_DATE','Use an explicit timestamp for '+name+'.');return value;
}
export function normalizeUsage(value){
  if(value?.schema==='stellar-forge.sf101.api-pass-export.v1'){
    const projected=projectApiPassExport(value),normalized=normalizeUsage(projected.usage);
    normalized.sourceSchema=value.schema;Object.assign(normalized.orders[0],projected.extras);return normalized;
  }
  need(object(value)&&value.schema===USAGE_SCHEMA&&Array.isArray(value.orders)&&value.orders.length<=20000,
    'INVALID_SERVICE_USAGE','Import the original SF101 service usage export with up to 20,000 orders.');
  const createdAt=instant(value.createdAt,'usage capture time');
  need((Number.isSafeInteger(value.revision)&&value.revision>=0)||(typeof value.revision==='string'&&value.revision.trim().length>0&&value.revision.length<=160),
    'INVALID_SERVICE_REVISION','The service usage export needs its original snapshot revision.');
  const seenOrders=new Set(),seenEvents=new Set();
  const orders=value.orders.map(row=>{
    need(object(row),'INVALID_SERVICE_ORDER','Check the original service order.');
    const orderRef=orderReference(row.orderRef),eventId=digest(row.eventId,'event ID',true);
    need(!seenOrders.has(orderRef)&&(!eventId||!seenEvents.has(eventId)),'DUPLICATE_SERVICE_ORDER','Each original order and event may occur only once.');
    seenOrders.add(orderRef);if(eventId)seenEvents.add(eventId);
    const routeId=label(row.routeId,'route ID',160),method=label(row.method,'HTTP method',10),network=label(row.network,'network',40);
    need(['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(method)&&['stellar:testnet','stellar:pubnet'].includes(network),
      'INVALID_SERVICE_TERMS','Check the original service method and network.');
    const entitledAt=row.entitledAt===null||row.entitledAt===undefined?null:instant(row.entitledAt,'entitlement time');
    need(Boolean(eventId)===Boolean(entitledAt),'INVALID_SERVICE_ENTITLEMENT','An entitled order needs its original event and entitlement time together.');
    if(entitledAt)need(Date.parse(entitledAt)<=Date.parse(createdAt),'SERVICE_SNAPSHOT_TIME','The usage capture precedes its entitlement.');
    const unitsPurchased=integer(row.unitsPurchased,'purchased units',true),unitsUsed=integer(row.unitsUsed,'used units'),
      unitsReserved=integer(row.unitsReserved,'reserved units'),unitsRemaining=integer(row.unitsRemaining,'remaining units');
    need(BigInt(unitsUsed)+BigInt(unitsReserved)+BigInt(unitsRemaining)===BigInt(unitsPurchased),
      'SERVICE_UNIT_BALANCE','Used, reserved and remaining units must equal the purchased units.');
    return {orderRef,eventId,routeId,method,network,amountAtomic:integer(row.amountAtomic,'original payment',true),
      assetDigest:digest(row.assetDigest,'asset digest'),recipientDigest:digest(row.recipientDigest,'recipient digest',true),
      entitledAt,planId:label(row.planId,'plan ID',160),planLabel:label(row.planLabel,'plan label',300),
      planRevision:digest(row.planRevision,'immutable purchased plan digest'),unitsPurchased,unitsUsed,unitsReserved,unitsRemaining};
  }).sort((a,b)=>a.orderRef.localeCompare(b.orderRef));
  return {schema:USAGE_SCHEMA,sourceSchema:USAGE_SCHEMA,createdAt,revision:value.revision,orders};
}
export function normalizeCustomer(value){
  need(object(value),'INVALID_CUSTOMER','Enter a customer profile.');
  const reference=label(value.reference,'customer reference',80);
  need(REF.test(reference),'INVALID_CUSTOMER_REFERENCE','Use letters, digits, dots, colons, underscores or hyphens for the customer reference.');
  const email=label(value.email??'','email',320,true);
  need(!email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'INVALID_CUSTOMER_EMAIL','Check the customer email.');
  return {reference,name:label(value.name,'customer name',200),email,address:label(value.address??'','address',2000,true),
    note:label(value.note??'','internal note',2000,true)};
}
const safeCustomer=customer=>Object.fromEntries(['id','reference','name','email','address','version'].map(key=>[key,customer[key]??null]));
const selectedRecipient=row=>row.recipientDigest??row.termsRecipientDigest??null;
const sameTerms=(payment,service)=>payment.eventId===service.eventId&&payment.orderReferenceDigest===sha(service.orderRef)&&
  ['routeId','method','network','amountAtomic','assetDigest'].every(key=>payment[key]===service[key])&&(payment.recipientDigest??null)===(service.recipientDigest??null);
const safeAdjustment=row=>({id:row.id,kind:row.kind,status:row.status,amountAtomic:row.amountAtomic,effectiveAt:row.effectiveAt,
  createdAt:row.createdAt,verifiedAt:row.verification?.verifiedAt??null,transferAt:row.verification?.transferAt??null});
const microUsd=value=>{
  if(value===null||value===undefined)return null;
  need(typeof value==='string'&&/^(0|[1-9][0-9]*)\.[0-9]{6}$/.test(value),'INVALID_MERCHANT_QUOTE','The original merchant quote must retain six decimal places.',409);
  const [whole,fraction]=value.split('.');return BigInt(whole)*1000000n+BigInt(fraction);
};
const formatUsd=value=>(value/1000000n).toString()+'.'+(value%1000000n).toString().padStart(6,'0');

export function compileCustomerStatement({report,run,customer,bindings,usage=null,usageSource=null,from,until,adjustments=[]}){
  need(object(report)&&report.schema==='stellar-forge.merchant-reconciliation.v1'&&Array.isArray(report.ledger),
    'ORIGINAL_ACCOUNTING_REQUIRED','Choose a completed original merchant accounting run.',409);
  need(object(run)&&HEX.test(run.reportSha256??''),'ORIGINAL_REPORT_HASH_REQUIRED','The original report needs its retained file hash.',409);
  let period=null;
  if(from!==undefined||until!==undefined){try{period=compileAccountingPeriod({from,until});}catch{need(false,'INVALID_STATEMENT_PERIOD','Use exact UTC period bounds with the end after the start.');}}
  const selected=bindings.filter(row=>row.customerId===customer.id).sort((a,b)=>a.orderRef.localeCompare(b.orderRef));
  need(selected.length>0,'CUSTOMER_HAS_NO_ORDERS','Assign original order references to this customer before preparing a statement.');
  const ledger=new Map(),usageOrders=new Map((usage?.orders??[]).map(row=>[row.orderRef,row])),adjustmentIndex=indexAdjustments(adjustments);
  for(const row of report.ledger){
    if(row.orderReferenceDigest){const rows=ledger.get(row.orderReferenceDigest)??[];rows.push(row);ledger.set(row.orderReferenceDigest,rows);}
  }
  const items=[],excluded=[],groups=new Map();let quoted=0n,quotedCount=0;
  for(const binding of selected){
    need(sha(orderReference(binding.orderRef))===binding.orderReferenceDigest,'CUSTOMER_BINDING_CHANGED','An original customer order binding changed.',409);
    let rows=ledger.get(binding.orderReferenceDigest)??[];
    if(period)rows=rows.filter(row=>Date.parse(row.at)>=Date.parse(period.from)&&Date.parse(row.at)<Date.parse(period.until));
    if(rows.length!==1){
      excluded.push({orderRef:binding.orderRef,code:rows.length?'AMBIGUOUS_ORDER_EVENTS':'ORDER_NOT_IN_SELECTED_REPORT',events:rows.length});continue;
    }
    const row=rows[0];
    if(row.origin!=='SF98_NATIVE_CAPTURE'){
      excluded.push({orderRef:binding.orderRef,code:'ORIGINAL_NATIVE_ORDER_REQUIRED',events:1});continue;
    }
    integer(row.amountAtomic,'original payment',true);digest(row.eventId,'original event');digest(row.assetDigest,'original asset');
    const service=usageOrders.get(binding.orderRef);
    if(service&&!sameTerms(row,service)){
      excluded.push({orderRef:binding.orderRef,code:'SERVICE_PAYMENT_IDENTITY_MISMATCH',events:1});continue;
    }
    const records=adjustmentIndex.get(adjustmentEventKey(row))??[],adjustmentSummary=summarizeAdjustments(row,records);
    const item={orderRef:binding.orderRef,label:binding.label||binding.orderRef,eventId:row.eventId,recordedAt:row.at,
      routeId:row.routeId,method:row.method,network:row.network,amountAtomic:row.amountAtomic,assetDigest:row.assetDigest,
      recipientDigest:row.recipientDigest??null,termsRecipientDigest:row.termsRecipientDigest??null,
      receiptFingerprint:row.receiptFingerprint,transactionFingerprint:row.transactionFingerprint??null,
      orderReferenceDigest:row.orderReferenceDigest,optionId:row.optionId,termsMatch:row.termsMatch,
      transfer:row.transfer,verificationScope:row.verificationScope,delivery:row.delivery,exception:row.exception??null,
      merchantQuoteUsd:row.merchantQuoteUsd??null,merchantPriceBasis:row.merchantPriceBasis??null,
      transferEvidenceDigest:row.transferEvidenceDigest??null,ledger:row.ledger??null,matchingEventDigest:row.matchingEventDigest??null,
      adjustments:records.map(safeAdjustment).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)),adjustmentSummary,
      usageStatus:service?'EXACT_ORIGINAL_ORDER_AND_EVENT':usage?'ORDER_ABSENT_FROM_USAGE_SNAPSHOT':'NO_USAGE_SNAPSHOT',
      service:service?{...Object.fromEntries(['planId','planLabel','planRevision','entitledAt','unitsPurchased','unitsUsed','unitsReserved','unitsRemaining'].map(key=>[key,service[key]])),
        ...(service.callsComplete?{planSha256:service.planSha256,manifestSha256:service.manifestSha256,callsComplete:true,calls:service.calls}:{} )}:null};
    items.push(item);
    const key=JSON.stringify([row.network,row.assetDigest,selectedRecipient(row)]);
    const group=groups.get(key)??{network:row.network,assetDigest:row.assetDigest,recipientDigest:selectedRecipient(row),orders:0,
      reportedAmountAtomic:0n,officialMatchedAmountAtomic:0n,refundedAmountAtomic:0n,pendingRefundAmountAtomic:0n,cancelledAmountAtomic:0n};
    group.orders++;group.reportedAmountAtomic+=BigInt(row.amountAtomic);
    if(row.transfer==='OFFICIAL_TRANSFER_MATCHED')group.officialMatchedAmountAtomic+=BigInt(row.amountAtomic);
    for(const name of ['refundedAmountAtomic','pendingRefundAmountAtomic','cancelledAmountAtomic'])group[name]+=BigInt(adjustmentSummary[name]);
    groups.set(key,group);
    const quote=microUsd(row.merchantQuoteUsd);if(quote!==null){quoted+=quote;quotedCount++;}
  }
  items.sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt)||a.orderRef.localeCompare(b.orderRef));
  const totals=[...groups.values()].map(group=>Object.fromEntries(Object.entries(group).map(([key,value])=>[key,typeof value==='bigint'?value.toString():value])))
    .sort((a,b)=>a.network.localeCompare(b.network)||a.assetDigest.localeCompare(b.assetDigest)||String(a.recipientDigest).localeCompare(String(b.recipientDigest)));
  return {schema:STATEMENT_SCHEMA,customer:safeCustomer(customer),
    source:{runId:run.id,reportSha256:run.reportSha256,inputManifestSha256:run.inputManifestSha256??null,reportCreatedAt:report.createdAt,
      originalPeriod:report.period??null,usage:usage?{id:usageSource?.id??null,sha256:usageSource?.sha256??null,sourceSchema:usage.sourceSchema,createdAt:usage.createdAt,revision:usage.revision}:null},
    selection:{from:period?.from??null,until:period?.until??null,timeBasis:'NATIVE_SETTLEMENT_CAPTURED_AT',
      usageBasis:usage?'CUMULATIVE_AS_OF_SERVICE_SNAPSHOT':null},
    items,excluded,totals:{orders:items.length,excludedOrders:excluded.length,serviceOrders:items.filter(row=>row.service).length,
      requiringReconciliation:items.filter(row=>row.transfer!=='OFFICIAL_TRANSFER_MATCHED').length,byAsset:totals,
      merchantQuotedUsd:{knownOrders:quotedCount,unknownOrders:items.length-quotedCount,knownTotal:formatUsd(quoted)}}};
}

const csvCell=value=>{
  let text=value===null||value===undefined?'':String(value);
  if(/^\s*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
};
export function renderStatementCsv(statement){
  const headers=['statementNumber','customerReference','orderRef','description','eventId','recordedAt','network','assetDigest','recipientDigest',
    'termsRecipientDigest','amountAtomic','transfer','verificationScope','delivery','exception','merchantQuoteUsd','refundedAmountAtomic','pendingRefundAmountAtomic',
    'cancelledAmountAtomic','planId','planRevision','unitsPurchased','unitsUsed','unitsReserved','unitsRemaining','usageCapturedAt'];
  const rows=statement.items.map(row=>[statement.number??'',statement.customer.reference,row.orderRef,row.label,row.eventId,row.recordedAt,row.network,
    row.assetDigest,row.recipientDigest,row.termsRecipientDigest,row.amountAtomic,row.transfer,row.verificationScope,row.delivery,row.exception,
    row.merchantQuoteUsd,row.adjustmentSummary.refundedAmountAtomic,row.adjustmentSummary.pendingRefundAmountAtomic,row.adjustmentSummary.cancelledAmountAtomic,
    row.service?.planId,row.service?.planRevision,row.service?.unitsPurchased,row.service?.unitsUsed,row.service?.unitsReserved,row.service?.unitsRemaining,
    statement.source.usage?.createdAt]);
  return [headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}

export function renderStatementUsageCsv(statement){
  const headers=['statementNumber','customerReference','orderRef','originalEventId','planSha256','manifestSha256','usageCapturedAt',
    'requestId','routeId','method','path','routeUnitPrice','consumedUnits','reservedUnits','storedStatus','status','callRevision','startedAt','deadlineAt','updatedAt',
    'errorCode','requestSha256','responseStatus','responseContentType','responseSha256','responseBytes'];
  const rows=[];
  for(const row of statement.items)for(const call of row.service?.calls??[]){
    rows.push([statement.number??'',statement.customer.reference,row.orderRef,row.eventId,row.service.planSha256,row.service.manifestSha256,
      statement.source.usage?.createdAt,call.requestId,call.routeId,call.method,call.path,call.units,call.consumedUnits,call.reservedUnits,call.storedStatus,call.status,call.revision,
      call.startedAt,call.deadlineAt,call.updatedAt,call.errorCode,call.requestSha256,call.result?.status,call.result?.contentType,call.result?.sha256,call.result?.bytes]);
  }
  return [headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}

const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
export function renderStatementHtml(statement){
  const e=escape,c=statement.customer,scope=statement.selection.from?statement.selection.from+' to '+statement.selection.until:'All recorded purchases in the selected report';
  const assetRows=statement.totals.byAsset.map(row=>'<tr><td>'+e(row.network)+'<small>Asset '+e(row.assetDigest)+'</small><small>Selected recipient '+e(row.recipientDigest??'unrecorded')+'</small></td><td>'+row.orders+'</td><td>'+e(row.reportedAmountAtomic)+'</td><td>'+e(row.officialMatchedAmountAtomic)+'</td><td>'+e(row.refundedAmountAtomic)+'</td><td>'+e(row.pendingRefundAmountAtomic)+'</td></tr>').join('');
  const orderRows=statement.items.map(row=>{
    const s=row.service,a=row.adjustmentSummary;
    const usage=s?'<section><h3>'+e(s.planLabel)+'</h3><div class="units"><span>Purchased <b>'+e(s.unitsPurchased)+'</b></span><span>Used <b>'+e(s.unitsUsed)+'</b></span><span>Reserved <b>'+e(s.unitsReserved)+'</b></span><span>Remaining <b>'+e(s.unitsRemaining)+'</b></span></div><p>Entitled '+e(s.entitledAt)+'. Plan '+e(s.planId)+'; immutable revision <code>'+e(s.planRevision)+'</code>.</p></section>':
      '<p>Service usage: '+e(row.usageStatus)+'.</p>';
    const calls=s?.callsComplete?'<h3>Original service call history</h3><table><thead><tr><th>Request / route</th><th>Unit price / consumed / reserved</th><th>Durable outcome</th><th>Updated at</th></tr></thead><tbody>'+
      s.calls.map(call=>'<tr><td><code>'+e(call.requestId)+'</code><small>'+e(call.method)+' '+e(call.path)+'</small></td><td>'+e(call.units)+' / '+e(call.consumedUnits)+' / '+e(call.reservedUnits)+'</td><td>'+e(call.storedStatus)+(call.status!==call.storedStatus?'<small>'+e(call.status)+'</small>':'')+'</td><td>'+e(call.updatedAt)+'</td></tr>').join('')+'</tbody></table>':'';
    const adjustments=row.adjustments.length?'<h3>Recorded adjustments</h3><table><thead><tr><th>Kind</th><th>Status</th><th>Atomic units</th><th>Effective at</th></tr></thead><tbody>'+row.adjustments.map(a=>'<tr><td>'+e(a.kind)+'</td><td>'+e(a.status)+'</td><td>'+e(a.amountAtomic)+'</td><td>'+e(a.effectiveAt)+'</td></tr>').join('')+'</tbody></table>':'';
    return '<article><div class="order-head"><div><h2>'+e(row.label)+'</h2><p>Order <code>'+e(row.orderRef)+'</code> · '+e(row.recordedAt)+'</p></div><strong>'+e(row.amountAtomic)+' atomic units</strong></div>'+
      '<dl><dt>Network / asset</dt><dd>'+e(row.network)+' / <code>'+e(row.assetDigest)+'</code></dd><dt>'+e(row.recipientDigest?'Recorded recipient':row.termsRecipientDigest?'Recipient from selected terms':'Recipient')+'</dt><dd><code>'+e(row.recipientDigest??row.termsRecipientDigest??'Unrecorded')+'</code></dd>'+
      '<dt>Transfer outcome</dt><dd>'+e(row.transfer)+' · '+e(row.verificationScope)+'</dd><dt>Delivery</dt><dd>'+e(row.delivery)+'</dd>'+
      '<dt>Merchant USD quote</dt><dd>'+e(row.merchantQuoteUsd??'Unrecorded')+(row.merchantPriceBasis?' · '+e(row.merchantPriceBasis):'')+'</dd>'+
      (row.exception?'<dt>Reconciliation</dt><dd>'+e(row.exception)+'</dd>':'')+
      '<dt>Adjustments in atomic units</dt><dd>Verified refunds '+e(a.refundedAmountAtomic)+' · Pending refunds '+e(a.pendingRefundAmountAtomic)+' · Recorded cancellations '+e(a.cancelledAmountAtomic)+ '</dd></dl>'+usage+calls+adjustments+
      '<details><summary>Original source identifiers</summary><dl><dt>Event</dt><dd><code>'+e(row.eventId)+'</code></dd><dt>Order digest</dt><dd><code>'+e(row.orderReferenceDigest)+'</code></dd>'+
      '<dt>Receipt fingerprint</dt><dd><code>'+e(row.receiptFingerprint)+'</code></dd><dt>Transaction fingerprint</dt><dd><code>'+e(row.transactionFingerprint??'Unrecorded')+'</code></dd>'+
      '<dt>Transfer evidence digest</dt><dd><code>'+e(row.transferEvidenceDigest??'Unrecorded')+'</code></dd><dt>Ledger</dt><dd>'+e(row.ledger??'Unrecorded')+'</dd></dl></details></article>';
  }).join('');
  const excluded=statement.excluded.length?'<section><h2>Assigned orders outside this statement</h2><table><thead><tr><th>Order</th><th>Reason</th></tr></thead><tbody>'+
    statement.excluded.map(row=>'<tr><td>'+e(row.orderRef)+'</td><td>'+e(row.code)+'</td></tr>').join('')+'</tbody></table></section>':'';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+e(statement.number??'Customer statement')+' — '+e(c.name)+'</title><style>'+
    '*{box-sizing:border-box}body{margin:0;color:#202020;background:#fff;font:14px/1.5 system-ui,sans-serif}main{max-width:1040px;margin:32px auto;padding:0 24px}header,.order-head{display:flex;justify-content:space-between;gap:24px}h1{font-size:30px;margin:6px 0}h2{font-size:19px;margin:0 0 8px}h3{font-size:15px;margin:18px 0 8px}p{margin:6px 0 14px}small{display:block;font-size:11px;overflow-wrap:anywhere}code{font:12px ui-monospace,monospace;overflow-wrap:anywhere}.eyebrow{font-size:12px;letter-spacing:.1em;text-transform:uppercase}article,section.summary{border-top:1px solid #777;margin-top:28px;padding-top:20px}table{width:100%;border-collapse:collapse;text-align:left;margin:14px 0}th,td{padding:10px 8px;border-bottom:1px solid #ccc;vertical-align:top}th{font-size:11px;text-transform:uppercase;letter-spacing:.04em}td:not(:first-child){font-variant-numeric:tabular-nums}dl{display:grid;grid-template-columns:180px 1fr;gap:8px 14px}dt{color:#555}dd{margin:0;overflow-wrap:anywhere}.units{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:14px;background:#f2f2f2}.units b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.address{white-space:pre-line}footer{margin-top:36px;border-top:1px solid #777;padding:18px 0;font-size:12px;overflow-wrap:anywhere}details{margin-top:18px}summary{cursor:pointer}@media(max-width:680px){main{padding:0 14px}header,.order-head{display:block}dl{grid-template-columns:1fr;gap:3px}.units{grid-template-columns:repeat(2,1fr)}table{font-size:11px}th,td{padding:6px 3px}}@media print{main{margin:0;max-width:none}article{break-inside:avoid}details{display:none}}'+
    '</style></head><body><main><header><div><div class="eyebrow">Customer purchase statement</div><h1>'+e(statement.number??'Statement preview')+'</h1><p>'+e(statement.createdAt??'Prepared from retained original sources')+'</p></div><div><h2>'+e(c.name)+'</h2><p>'+e(c.reference)+(c.email?'<br>'+e(c.email):'')+'</p>'+(c.address?'<p class="address">'+e(c.address)+'</p>':'')+'</div></header>'+
    (statement.replacesId?'<p>Corrected statement replacing retained document '+e(statement.replacesId)+'.</p>':'')+
    '<section class="summary"><h2>Original purchases</h2><p>'+e(scope)+'. '+statement.totals.orders+' orders; '+statement.totals.requiringReconciliation+' requiring transfer reconciliation.</p>'+
    '<p>Payments are recorded once per original order. Amounts remain in each original asset’s atomic units. Merchant USD quotes retain their stated valuation basis.</p>'+
    '<table><thead><tr><th>Network / asset / selected recipient</th><th>Orders</th><th>Original amount</th><th>Officially matched</th><th>Verified refunds</th><th>Pending refunds</th></tr></thead><tbody>'+assetRows+'</tbody></table>'+
    '<p>Known merchant USD quotes total '+e(statement.totals.merchantQuotedUsd.knownTotal)+' across '+statement.totals.merchantQuotedUsd.knownOrders+' orders; '+statement.totals.merchantQuotedUsd.unknownOrders+' orders have no quote.</p>'+
    (statement.source.usage?'<p>Service units are cumulative as of '+e(statement.source.usage.createdAt)+' (source revision '+e(statement.source.usage.revision)+'). The selected purchase period does not change that usage snapshot.</p>':'')+'</section>'+
    orderRows+excluded+'<footer>Original accounting run '+e(statement.source.runId)+'<br>Report SHA-256: <code>'+e(statement.source.reportSha256)+'</code>'+
    (statement.source.usage?'<br>Service usage SHA-256: <code>'+e(statement.source.usage.sha256)+'</code>':'')+'</footer></main></body></html>\n';
}
