// MIT. Merchant adjustments beside the original gross-payment accounting rows.
import {createHash,randomUUID} from 'node:crypto';
import {RPC_NETWORKS} from '../sf86-rpc-transfer-reconcile/terms.mjs';

export const ADJUSTMENT_SCHEMA='stellar-forge.merchant-adjustment.v1';
export const ADJUSTMENT_EXPORT_SCHEMA='stellar-forge.merchant-adjustment-export.v1';
export const REFUND_PROOF_SCHEMA='stellar-forge.sf86.refund-reconciliation.v1';
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const AMOUNT=/^[1-9][0-9]{0,38}$/;
const I128_MAX=(1n<<127n)-1n;
const REQUEST_FIELDS=['id','runId','eventId','kind','amountAtomic','effectiveAt','reason','reference','actor','createdAt'];
export const adjustmentHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const adjustmentJson=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const adjustmentNeed=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const need=adjustmentNeed;
const copy=value=>structuredClone(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function adjustmentId(value){need(typeof value==='string'&&UUID.test(value),'INVALID_ADJUSTMENT_ID','Use the saved adjustment UUID.');return value;}
export function adjustmentText(value,name,max=1000,empty=false){
  need(typeof value==='string'&&(empty||value.trim().length>0)&&value.trim().length<=max&&!value.includes('\0'),
    'INVALID_ADJUSTMENT_FIELD','Check '+name+'.');return value.trim();
}
export function adjustmentInstant(value,name='effective date'){
  need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value),
    'INVALID_ADJUSTMENT_DATE','Use an exact UTC '+name+'.');
  const normalized=value.includes('.')?value:value.replace('Z','.000Z'),date=new Date(value);
  need(Number.isFinite(date.getTime())&&date.toISOString()===normalized,'INVALID_ADJUSTMENT_DATE','Check the UTC '+name+'.');return normalized;
}
export function adjustmentAmount(value){need(typeof value==='string'&&AMOUNT.test(value)&&BigInt(value)<=I128_MAX,
  'INVALID_ADJUSTMENT_AMOUNT','Use a positive integer amount in the original asset’s atomic units.');return value;}
export const adjustmentEventKey=event=>event.network+'\n'+event.eventId;
export function adjustmentEventIdentity(event){
  need(object(event)&&SHA.test(event.eventId??'')&&Object.hasOwn(RPC_NETWORKS,event.network)&&SHA.test(event.assetDigest??''),
    'INVALID_ADJUSTMENT_SOURCE','Select an original retained merchant ledger event.');
  return {eventId:event.eventId,network:event.network,assetDigest:event.assetDigest,amountAtomic:adjustmentAmount(event.amountAtomic),
    transactionFingerprint:event.transactionFingerprint??null,recipientDigest:event.recipientDigest??event.termsRecipientDigest??null};
}
export function adjustmentRequest(record){return Object.fromEntries(REQUEST_FIELDS.map(key=>[key,record[key]]));}
export function validateAdjustment(record){
  need(object(record)&&record.schema===ADJUSTMENT_SCHEMA,'INVALID_RETAINED_ADJUSTMENT','The retained adjustment is invalid.',409);
  adjustmentId(record.id);adjustmentAmount(record.amountAtomic);adjustmentInstant(record.effectiveAt);adjustmentInstant(record.createdAt,'creation date');
  need(((record.kind==='CANCELLATION'&&record.status==='RECORDED')||
    (record.kind==='REFUND'&&['REQUESTED','VERIFYING','VERIFIED','WITHDRAWN'].includes(record.status)))&&
    record.eventId===record.original?.eventId&&record.runId===record.source?.runId&&SHA.test(record.source?.reportSha256??'')&&
    SHA.test(record.source?.inputManifestSha256??'')&&Array.isArray(record.history),
    'INVALID_RETAINED_ADJUSTMENT','The original adjustment binding or history is invalid.',409);
  adjustmentEventIdentity(record.original);
  need(record.requestSha256===adjustmentHash(adjustmentJson(adjustmentRequest(record))),
    'ADJUSTMENT_REQUEST_CHANGED','The retained adjustment request changed.',409);
  if(record.status==='VERIFIED'){
    const result=record.verification,proof=result?.proof;validateRefundProof(proof,record);
    need(result.transaction===proof.transaction&&result.ledger===proof.ledger&&result.transferAt===proof.transferAt&&result.verifiedAt===proof.observedAt,
      'REFUND_TRANSFER_MISMATCH','The retained refund summary differs from its original native transfer result.',409);
  }
  return record;
}
export function indexAdjustments(records){
  need(Array.isArray(records)&&records.length<=5000,'ADJUSTMENT_LIMIT','The workspace supports 5,000 retained adjustments.');
  const index=new Map(),seen=new Set();
  for(const record of records){validateAdjustment(record);need(!seen.has(record.id),'DUPLICATE_ADJUSTMENT','An adjustment UUID was reused.',409);seen.add(record.id);
    const key=adjustmentEventKey(record.original),items=index.get(key)??[];items.push(record);index.set(key,items);}
  return index;
}
export function summarizeAdjustments(event,records=[]){
  const identity=JSON.stringify(adjustmentEventIdentity(event));let returned=0n,pending=0n,cancelled=0n;
  for(const record of records){
    need(JSON.stringify(adjustmentEventIdentity(record.original))===identity,'ADJUSTMENT_PAYMENT_CHANGED',
      'The selected event has different original payment terms from its retained adjustment.',409);
    const amount=BigInt(record.amountAtomic);
    if(record.kind==='CANCELLATION'&&record.status==='RECORDED')cancelled+=amount;
    if(record.kind==='REFUND'){
      if(record.status==='VERIFIED'){validateRefundProof(record.verification?.proof,record);returned+=amount;}
      else if(['REQUESTED','VERIFYING'].includes(record.status))pending+=amount;
    }
  }
  const gross=BigInt(event.amountAtomic),remaining=gross-returned,available=remaining-pending;
  return {grossAmountAtomic:gross.toString(),refundedAmountAtomic:returned.toString(),pendingRefundAmountAtomic:pending.toString(),
    remainingAmountAtomic:remaining.toString(),availableRefundAmountAtomic:(available>0n?available:0n).toString(),
    cancelledAmountAtomic:cancelled.toString(),overRefundedAmountAtomic:(returned>gross?returned-gross:0n).toString(),
    refundStatus:returned===0n?'NONE':returned<gross?'PARTIAL':returned===gross?'FULL':'OVER_RETURNED',adjustmentCount:records.length};
}
export function previewAdjustment(detail,value={}){
  need(object(value)&&Object.keys(value).every(key=>REQUEST_FIELDS.includes(key)),'INVALID_ADJUSTMENT_REQUEST','Only the adjustment’s declared fields are accepted.');
  const request={id:adjustmentId(value.id??randomUUID()),runId:adjustmentId(value.runId),eventId:value.eventId,kind:value.kind,
    amountAtomic:adjustmentAmount(value.amountAtomic),effectiveAt:adjustmentInstant(value.effectiveAt),
    reason:adjustmentText(value.reason,'reason',4000),reference:adjustmentText(value.reference??'','merchant reference',1000,true),
    actor:adjustmentText(value.actor,'operator',1000),createdAt:adjustmentInstant(value.createdAt??new Date().toISOString(),'creation date')};
  need(request.eventId===detail.event.eventId&&request.runId===detail.source.runId,'ADJUSTMENT_SOURCE_CHANGED','Select the retained original event.');
  need(['REFUND','CANCELLATION'].includes(request.kind),'INVALID_ADJUSTMENT_KIND','Choose a refund request or merchant cancellation.');
  if(request.kind==='REFUND')need(detail.refundTerms,'ORIGINAL_REFUND_TERMS_UNAVAILABLE','Select an independently matched payment with its retained original payer and transfer proof.');
  const available=request.kind==='REFUND'?BigInt(detail.totals.availableRefundAmountAtomic):
    BigInt(detail.totals.grossAmountAtomic)-BigInt(detail.totals.cancelledAmountAtomic);
  need(BigInt(request.amountAtomic)<=available,'ADJUSTMENT_EXCEEDS_REMAINING',request.kind==='REFUND'?
    'The amount exceeds the original payment remaining after verified refunds and retained refund requests.':
    'The cancellation amount exceeds the original amount not already recorded as cancelled.',409);
  const binding={request,source:detail.source,original:detail.event,refundTerms:detail.refundTerms,totals:detail.totals};
  return {request,previewSha256:adjustmentHash(adjustmentJson(binding)),detail:copy(detail)};
}
export function validateRefundProof(proof,record,{allowLocal=false}={}){
  const terms=record.refundTerms,profile=terms&&RPC_NETWORKS[terms.network];
  need(object(proof)&&profile&&proof.schema===REFUND_PROOF_SCHEMA&&proof.origin==='MERCHANT_REFUND'&&
    proof.reservation==='NOT_APPLICABLE_MERCHANT_REFUND'&&proof.refundId===record.id&&
    proof.network===terms.network&&proof.asset===terms.asset&&proof.payer===terms.from&&proof.recipient===terms.to&&
    proof.atomicAmount===record.amountAtomic&&SHA.test(proof.transaction??'')&&proof.matchingTransfers===1&&
    Number.isSafeInteger(proof.ledger)&&proof.ledger>0&&typeof proof.matchingEventId==='string'&&proof.matchingEventId.length>0&&
    SHA.test(proof.transactionResultSha256??'')&&Array.isArray(proof.eventPageSha256)&&proof.eventPageSha256.length>0&&
    proof.eventPageSha256.length<=100&&proof.eventPageSha256.every(value=>SHA.test(value)),
    'REFUND_TRANSFER_MISMATCH','The native reverse transfer differs from the retained refund request.',409);
  if(proof.transferAt!==null)adjustmentInstant(proof.transferAt,'native transfer date');
  adjustmentInstant(proof.observedAt,'verification date');
  if(allowLocal&&proof.verdict==='LOCAL_RPC_REPLAY_MATCHED'&&proof.source==='127.0.0.1-loopback')return false;
  need(proof.verdict===profile.verdict&&proof.source===profile.source&&profile.endpoints.includes(proof.rpcEndpoint)&&
    proof.networkPassphrase===profile.passphrase&&SHA.test(proof.networkResultSha256??''),
    'OFFICIAL_REFUND_TRANSFER_REQUIRED','The refund requires the original network’s independently matched native transfer.',409);
  return true;
}
export function compileAdjustmentExport({report,source,records,workspaceRevision,exportedAt=new Date().toISOString()}){
  need(object(report)&&Array.isArray(report.ledger),'ORIGINAL_ACCOUNTING_REPORT_REQUIRED','Choose a retained original accounting report.');
  const indexed=indexAdjustments(records),events=report.ledger.map(original=>{
    const adjustments=indexed.get(adjustmentEventKey(original))??[];
    return {original:copy(original),totals:summarizeAdjustments(original,adjustments),adjustments:copy(adjustments)};
  });
  return {schema:ADJUSTMENT_EXPORT_SCHEMA,source:copy(source),workspaceRevision,exportedAt,period:report.period??null,
    dateBasis:{original:'Original accounting row and timeBasis',cancellation:'Merchant-selected effectiveAt',
      refund:'Native transferAt when returned by RPC; observedAt is the verification read'},
    originalReport:copy(report),events};
}
const string=value=>value===null||value===undefined?'':String(value);
const html=value=>string(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const csv=value=>{let text=string(value);if(/^[=+\-@\t\r\n']/.test(text)||/^\d{16,}$/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
export function renderAdjustmentCsv(value){
  const columns=['eventId','routeId','network','assetDigest','recordType','adjustmentId','status','amountAtomic','originalPaymentAt','effectiveAt',
    'nativeTransferAt','recordedAt','verifiedAt','refundTransaction','actor','reason','reference','grossAmountAtomic','refundedAmountAtomic',
    'remainingAmountAtomic','cancelledAmountAtomic','reportSha256'];
  const rows=[];
  for(const item of value.events){const event=item.original,base={eventId:event.eventId,routeId:event.routeId,network:event.network,
    assetDigest:event.assetDigest,originalPaymentAt:event.at,...item.totals,reportSha256:value.source.reportSha256};
    rows.push({...base,recordType:'ORIGINAL_PAYMENT',status:event.transfer,amountAtomic:event.amountAtomic});
    for(const adjustment of item.adjustments)rows.push({...base,recordType:adjustment.kind,adjustmentId:adjustment.id,status:adjustment.status,
      amountAtomic:adjustment.amountAtomic,effectiveAt:adjustment.effectiveAt,recordedAt:adjustment.createdAt,
      nativeTransferAt:adjustment.verification?.transferAt,verifiedAt:adjustment.verification?.verifiedAt,
      refundTransaction:adjustment.verification?.transaction,actor:adjustment.actor,reason:adjustment.reason,reference:adjustment.reference});
  }
  return Buffer.from([columns.map(csv).join(','),...rows.map(row=>columns.map(key=>csv(row[key])).join(','))].join('\r\n')+'\r\n');
}
export function renderAdjustmentHtml(value){
  const rows=value.events.map(item=>'<tr><td>'+html(item.original.routeId)+'<br><small>'+html(item.original.eventId)+'</small></td><td>'+html(item.original.network)+
    '<br><small>'+html(item.original.assetDigest)+'</small></td><td>'+html(item.original.at)+'<br>'+html(item.original.timeBasis)+'</td><td>'+html(item.totals.grossAmountAtomic)+
    '</td><td>'+html(item.totals.refundedAmountAtomic)+'</td><td>'+html(item.totals.remainingAmountAtomic)+'</td><td>'+html(item.totals.cancelledAmountAtomic)+'</td></tr>').join('');
  const history=value.events.flatMap(item=>item.adjustments.map(record=>'<tr><td>'+html(record.id)+'<br>'+html(record.eventId)+'</td><td>'+html(record.kind)+'<br>'+html(record.status)+
    '</td><td>'+html(record.amountAtomic)+'</td><td>'+html(record.effectiveAt)+'<br><small>Recorded '+html(record.createdAt)+'</small></td><td>'+html(record.verification?.transferAt??'')+
    '<br><small>'+html(record.verification?.transaction??'')+'</small></td><td>'+html(record.actor)+'<br>'+html(record.reason)+'<br>'+html(record.reference)+'</td></tr>')).join('');
  return Buffer.from('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Merchant payment adjustments</title><style>'+ 
    'body{font:14px/1.5 system-ui,sans-serif;margin:28px;color:#171717;background:white}main{max-width:1500px;margin:auto}h1{font-size:25px}h2{font-size:19px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;text-align:left;vertical-align:top;padding:9px}th{background:#eee}small{overflow-wrap:anywhere;color:#555}section{overflow:auto;margin:22px 0}p{max-width:1100px}</style></head><body><main><h1>Merchant payment adjustments</h1><p>Original gross amounts and later merchant cancellations and verified refunds, in each original asset’s atomic units. A cancellation records the merchant’s decision; verified refunds carry their separate native reverse transfer and date.</p><p>Original run '+html(value.source.runId)+' · exported '+html(value.exportedAt)+'</p><section><h2>Original payments</h2><table><thead><tr><th>Event</th><th>Network / asset</th><th>Original recorded date</th><th>Gross</th><th>Returned</th><th>Remaining</th><th>Cancelled</th></tr></thead><tbody>'+rows+'</tbody></table></section><section><h2>Adjustment history</h2><table><thead><tr><th>Adjustment / event</th><th>Kind / state</th><th>Amount</th><th>Merchant effective date</th><th>Native refund date / transaction</th><th>Operator / reason</th></tr></thead><tbody>'+history+'</tbody></table></section></main></body></html>');
}
