// MIT. Paid-job resolution binds the original job, native event and accounting row.
import {createHash} from 'node:crypto';
import {SCHEMA as EVENT_SCHEMA} from '../../../sf98-merchant-delivery/outbox.mjs';
import {validateAdjustment,validateRefundProof,summarizeAdjustments,adjustmentEventIdentity} from '../../../merchant-settlement-accounting/adjustments.mjs';

export const CASE_SCHEMA='stellar-forge.job-resolution-case.v1';
export const RECEIPT_SCHEMA='stellar-forge.job-resolution.v1';
export const EXPORT_SCHEMA='stellar-forge.job-resolution-export.v1';
export {RESOLUTION_DOCUMENT_BYTES,RESOLUTION_RECEIPT_BYTES,RESOLUTION_RECEIVING_BYTES} from './limits.mjs';
export const SHA=/^[a-f0-9]{64}$/;
export const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const JOB_ID=/^[A-Za-z0-9._:-]{1,80}$/;
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const copy=value=>structuredClone(value);
export const now=()=>new Date().toISOString();
export const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
export function need(ok,code,status=400){if(!ok)throw Object.assign(new Error(code),{code,status});}
export function id(value){need(typeof value==='string'&&UUID.test(value),'JOB_RESOLUTION_REQUEST_ID_REQUIRED');return value;}
export function text(value,max=4000,{empty=false}={}){
  need(typeof value==='string'&&value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)&&
    (empty||value.trim().length>0),'JOB_RESOLUTION_TEXT_INVALID');return value.trim();
}
export function revision(value){need(Number.isSafeInteger(value)&&value>=0,'JOB_RESOLUTION_REVISION_REQUIRED');return value;}
export function requestHash(value){return hash(json(value));}
export function same(a,b){return requestHash(a)===requestHash(b);}
export function jobBinding(row){
  const e=row?.settlement,p=row?.payment;
  need(object(row)&&JOB_ID.test(row.id??'')&&SHA.test(row.inputSha256??'')&&object(p)&&
    e?.schema===EVENT_SCHEMA&&e.authority==='ORIGINAL_NATIVE_PROCESS_SETTLEMENT_SUCCESS'&&SHA.test(e.id??'')&&
    SHA.test(e.receiptFingerprint??'')&&(e.transactionFingerprint===null||SHA.test(e.transactionFingerprint??''))&&
    e.orderReference===row.id&&e.routeId===row.functionId&&e.method==='POST'&&e.network===p.network&&
    e.amountAtomic===p.amount&&e.assetDigest===hash(p.asset)&&e.recipientDigest===hash(p.payTo),
    'JOB_RESOLUTION_PAID_JOB_REQUIRED',409);
  return {jobId:row.id,functionId:row.functionId,inputSha256:row.inputSha256,
    payment:{network:p.network,asset:p.asset,payTo:p.payTo,amountAtomic:p.amount},
    settlement:copy(e)};
}
export function bindAccounting(binding,detail,pinned=null){
  need(object(detail)&&object(detail.event)&&object(detail.source)&&Array.isArray(detail.adjustments),
    'JOB_RESOLUTION_ACCOUNTING_SOURCE_REQUIRED',409);
  const e=detail.event,n=binding.settlement,s=detail.source;
  adjustmentEventIdentity(e);
  need(e.eventId===n.id&&e.routeId===n.routeId&&e.method===n.method&&e.network===n.network&&
    e.amountAtomic===n.amountAtomic&&e.assetDigest===n.assetDigest&&
    (e.recipientDigest??e.termsRecipientDigest)===n.recipientDigest&&e.receiptFingerprint===n.receiptFingerprint&&
    (e.transactionFingerprint??null)===n.transactionFingerprint&&e.orderReferenceDigest===hash(binding.jobId)&&
    UUID.test(s.runId??'')&&SHA.test(s.reportSha256??'')&&SHA.test(s.inputManifestSha256??''),
    'JOB_RESOLUTION_ACCOUNTING_PAYMENT_MISMATCH',409);
  const source={runId:s.runId,eventId:e.eventId,reportSha256:s.reportSha256,
    manifestSha256:s.manifestSha256??null,inputManifestSha256:s.inputManifestSha256};
  if(pinned)need(same(source,pinned),'JOB_RESOLUTION_ACCOUNTING_SOURCE_CHANGED',409);
  for(const record of detail.adjustments){
    validateAdjustment(record);
    need(record.original.eventId===n.id&&record.original.network===n.network&&
      record.original.assetDigest===n.assetDigest&&record.original.amountAtomic===n.amountAtomic&&
      record.original.transactionFingerprint===n.transactionFingerprint&&
      (record.original.recipientDigest??record.original.termsRecipientDigest)===n.recipientDigest,
      'JOB_RESOLUTION_ADJUSTMENT_PAYMENT_MISMATCH',409);
  }
  const totals=summarizeAdjustments(e,detail.adjustments);
  need(same(totals,detail.totals),'JOB_RESOLUTION_ACCOUNTING_TOTALS_CHANGED',409);
  return {source,detail:copy(detail)};
}
export function newCase(binding){
  const at=binding.settlement.at;
  return {schema:CASE_SCHEMA,job:copy(binding),revision:0,state:'OPEN',createdAt:at,updatedAt:at,
    issues:[],messages:[],decisions:[],operations:[],previews:[],accounting:null,history:[]};
}
export function validateCase(value,binding){
  need(value?.schema===CASE_SCHEMA&&same(value.job,binding)&&
    Number.isSafeInteger(value.revision)&&value.revision>=0&&['OPEN','CLOSED'].includes(value.state)&&
    ['issues','messages','decisions','operations','previews','history'].every(k=>Array.isArray(value[k]))&&
    value.issues.length<=256&&value.messages.length<=1000&&value.operations.length<=1000&&value.previews.length<=1000,
    'JOB_RESOLUTION_RETAINED_CASE_CHANGED',409);
  if(value.accounting)bindAccounting(binding,value.accounting.detail,value.accounting.source);
  const seen=new Set();
  for(const op of value.operations){id(op.id);need(!seen.has(op.id)&&op.requestSha256===requestHash(op.request)&&
    ['PREPARED','DISPATCHING','RECORDED','FAILED','UNKNOWN'].includes(op.state),'JOB_RESOLUTION_OPERATION_CHANGED',409);seen.add(op.id);}
  return value;
}
export function publicReceipt(value,row){
  const binding=jobBinding(row);validateCase(value,binding);
  const a=value.accounting,details=a?.detail;
  // This projection contains only the selected customer's case. Original full
  // accounting records remain in the private merchant export.
  const adjustments=(details?.adjustments??[]).map(r=>({
    id:r.id,kind:r.kind,status:r.status,amountAtomic:r.amountAtomic,effectiveAt:r.effectiveAt,recordedAt:r.createdAt,
    requestSha256:r.requestSha256,source:{runId:r.source.runId,reportSha256:r.source.reportSha256,
      inputManifestSha256:r.source.inputManifestSha256},
    verification:r.verification?{transaction:r.verification.transaction,ledger:r.verification.ledger,
      transferAt:r.verification.transferAt,verifiedAt:r.verification.verifiedAt,
      proof:copy(r.verification.proof)}:null
  }));
  return {schema:RECEIPT_SCHEMA,jobId:binding.jobId,functionId:binding.functionId,inputSha256:binding.inputSha256,
    revision:value.revision,state:value.state,createdAt:value.createdAt,updatedAt:value.updatedAt,
    jobState:row.state,nativeSettlement:{id:binding.settlement.id,at:binding.settlement.at,
      receiptFingerprint:binding.settlement.receiptFingerprint,transactionFingerprint:binding.settlement.transactionFingerprint},
    payment:copy(binding.payment),issues:copy(value.issues),messages:copy(value.messages),
    decisions:value.decisions.map(d=>({id:d.id,kind:d.kind,at:d.at,message:d.message,state:d.state})),
    accounting:a?{source:copy(a.source),observedAt:a.observedAt,totals:copy(details.totals),
      originalProof:copy(details.originalProof??null),proofSource:details.originalProofFile?{sha256:details.originalProofFile.sha256,bytes:details.originalProofFile.bytes}:null,adjustments}:null};
}
export function validateReceipt(value,acceptance){
  need(value?.schema===RECEIPT_SCHEMA&&value.jobId===acceptance.jobId&&value.functionId===acceptance.functionId&&
    value.inputSha256===acceptance.inputSha256&&Number.isSafeInteger(value.revision)&&value.revision>=0&&
    SHA.test(value.nativeSettlement?.id??'')&&SHA.test(value.nativeSettlement?.receiptFingerprint??'')&&
    object(value.payment)&&typeof value.payment.amountAtomic==='string'&&/^[1-9][0-9]{0,38}$/.test(value.payment.amountAtomic)&&
    Array.isArray(value.issues)&&Array.isArray(value.messages)&&Array.isArray(value.decisions)&&
    ['OPEN','CLOSED'].includes(value.state),'JOB_RESOLUTION_RECEIPT_INVALID',409);
  if(value.accounting){
    const {source,totals,adjustments}=value.accounting;
    need(source?.eventId===value.nativeSettlement.id&&SHA.test(source.reportSha256??'')&&
      SHA.test(source.inputManifestSha256??'')&&Array.isArray(adjustments)&&object(totals)&&
      totals.grossAmountAtomic===value.payment.amountAtomic,'JOB_RESOLUTION_RECEIPT_ACCOUNTING_INVALID',409);
    let returned=0n,pending=0n,cancelled=0n;const seen=new Set();
    for(const record of adjustments){
      need(!seen.has(record.id),'JOB_RESOLUTION_RECEIPT_ADJUSTMENT_DUPLICATE',409);seen.add(record.id);
      id(record.id);need(/^[1-9][0-9]{0,38}$/.test(record.amountAtomic??'')&&SHA.test(record.requestSha256??''),
        'JOB_RESOLUTION_RECEIPT_ADJUSTMENT_INVALID',409);
      if(record.kind==='REFUND'&&record.status==='VERIFIED'){
        const proof=record.verification?.proof,original=value.accounting.originalProof;
        need(original&&original.network===value.payment.network&&original.asset===value.payment.asset&&
          original.recipient===value.payment.payTo&&original.atomicAmount===value.payment.amountAtomic&&
          hash(original.transaction)===value.nativeSettlement.transactionFingerprint,
          'JOB_RESOLUTION_RECEIPT_REFUND_MISMATCH',409);
        validateRefundProof(proof,{id:record.id,amountAtomic:record.amountAtomic,
          refundTerms:{network:value.payment.network,asset:value.payment.asset,from:value.payment.payTo,to:original.payer}});
        need(record.verification.transaction===proof.transaction&&record.verification.ledger===proof.ledger&&
          record.verification.transferAt===proof.transferAt&&record.verification.verifiedAt===proof.observedAt,
          'JOB_RESOLUTION_RECEIPT_REFUND_MISMATCH',409);
        returned+=BigInt(record.amountAtomic);
      }else if(record.kind==='REFUND'&&['REQUESTED','VERIFYING'].includes(record.status))pending+=BigInt(record.amountAtomic);
      else if(record.kind==='CANCELLATION'&&record.status==='RECORDED')cancelled+=BigInt(record.amountAtomic);
      else need(record.kind==='REFUND'&&record.status==='WITHDRAWN','JOB_RESOLUTION_RECEIPT_ADJUSTMENT_INVALID',409);
    }
    need(totals.refundedAmountAtomic===String(returned)&&totals.pendingRefundAmountAtomic===String(pending)&&
      totals.remainingAmountAtomic===String(BigInt(value.payment.amountAtomic)-returned)&&
      totals.cancelledAmountAtomic===String(cancelled),'JOB_RESOLUTION_RECEIPT_TOTALS_INVALID',409);
  }
  return value;
}
