// MIT. Read an immutable original adjustment export for the existing buyer Store.
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {ADJUSTMENT_EXPORT_SCHEMA,adjustmentEventIdentity,adjustmentJson,compileAdjustmentExport,validateAdjustment,validateRefundProof} from './adjustments.mjs';
import {indexOriginalVerifications} from './reconcile.mjs';
import {validStrKey} from '../sf86-rpc-transfer-reconcile/terms.mjs';

const hash=raw=>createHash('sha256').update(raw).digest('hex');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const digest=x=>hash(JSON.stringify(stable(x)));
const same=(a,b)=>digest(a)===digest(b);
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const HEX=/^[a-f0-9]{64}$/;
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const MAX=32*1024*1024;
export const SCHEMA='stellar-forge.buyer-adjustment-source.v1';
export const INTAKE_SCHEMA='stellar-forge.buyer-adjustment-intake.v1';
const transferIdentity=p=>digest({network:p.network,asset:p.asset,transaction:p.transaction,event:p.matchingEventId,payer:p.payer,recipient:p.recipient,amount:p.atomicAmount});
const eventBinding=e=>({id:e.eventId,receiptFingerprint:e.receiptFingerprint,transactionFingerprint:e.transactionFingerprint,
  network:e.network,assetDigest:e.assetDigest,recipientDigest:e.recipientDigest??e.termsRecipientDigest??null,
  amountAtomic:e.amountAtomic,routeId:e.routeId,method:e.method,orderReferenceDigest:e.orderReferenceDigest??null});
function jobBinding(value,event){
  if(value===null||value===undefined)return null;
  need(object(value)&&Object.keys(value).every(k=>['job_id','settlement'].includes(k))&&
    typeof value.job_id==='string'&&value.job_id.length>0&&value.job_id.length<=1024&&!/[\u0000-\u001f\u007f]/.test(value.job_id)&&object(value.settlement),
    'Use the original job ID and its complete retained settlement selection.');
  const actual=eventBinding(event),expected=value.settlement;
  need(Object.keys(actual).every(k=>Object.hasOwn(expected,k)&&expected[k]===actual[k])&&
    actual.orderReferenceDigest===hash(value.job_id),'The original job settlement does not match every selected accounting-event fingerprint.');
  return {job_id:value.job_id,settlement:actual};
}
function proofFor(record,event){
  const p=record.originalProof;
  if(!p)return null;
  const fileDigest=record.originalProofFile?.sha256;
  need(HEX.test(fileDigest??'')&&fileDigest===record.original.transferEvidenceDigest,
    'The retained original payment proof does not bind to its original ledger evidence digest.');
  const accepted=indexOriginalVerifications([{data:p,fileDigest}]);
  need(accepted.ignored.length===0&&accepted.index.size===1&&event.transfer==='OFFICIAL_TRANSFER_MATCHED'&&
    p.network===event.network&&hash(p.transaction)===event.transactionFingerprint&&p.atomicAmount===event.amountAtomic&&
    hash(p.asset)===event.assetDigest&&hash(p.recipient)===(event.recipientDigest??event.termsRecipientDigest)&&
    validStrKey(p.payer,'G')&&(validStrKey(p.recipient,'G')||validStrKey(p.recipient,'C'))&&p.payer!==p.recipient,
    'The original independent payment proof differs from the selected payment, parties or native amount.');
  if(event.matchingEventDigest)need(hash(p.matchingEventId)===event.matchingEventDigest,'The original payment event differs from its retained ledger row.');
  return p;
}
async function readSource(path,sha256){
  need(typeof path==='string'&&resolve(path)===path&&typeof sha256==='string'&&HEX.test(sha256),
    'Select an absolute original adjustment-export file and its exact SHA-256.');
  const stat=await lstat(path);
  need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=MAX,'Select a regular original adjustment JSON file within 32 MiB.');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await handle.stat({bigint:true}),raw=await handle.readFile(),after=await handle.stat({bigint:true}),current=await lstat(path,{bigint:true});
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeNs===after.mtimeNs&&
      before.ctimeNs===after.ctimeNs&&current.dev===after.dev&&current.ino===after.ino&&BigInt(raw.length)===after.size&&
      raw.length<=MAX&&hash(raw)===sha256,'The selected original export changed or differs from its reviewed digest.');
    return raw;
  }finally{await handle.close();}
}

/** No merchant controller, network, signer or database is opened. Source metadata
 * and job selection are retained separately from original producer bytes. */
export async function captureBuyerAdjustments({sourceFile,sourceSha256,eventId,expectedJob=null}){
  need(HEX.test(eventId??''),'Select the original 64-character accounting event ID.');
  const raw=await readSource(sourceFile,sourceSha256);
  const doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  need(object(doc)&&doc.schema===ADJUSTMENT_EXPORT_SCHEMA&&object(doc.source)&&Array.isArray(doc.events)&&
    object(doc.originalReport)&&Array.isArray(doc.originalReport.ledger)&&doc.events.length<=50000&&
    Number.isSafeInteger(doc.workspaceRevision)&&doc.workspaceRevision>=0&&typeof doc.exportedAt==='string'&&
    Number.isFinite(Date.parse(doc.exportedAt)),'Use the unchanged original AdjustmentWorkspace JSON export.');
  need(['reportSha256','manifestSha256','inputManifestSha256'].every(k=>HEX.test(doc.source[k]??'')),
    'The original export must retain its report and input-manifest source digests.');
  const records=doc.events.flatMap(e=>{need(object(e)&&Array.isArray(e.adjustments),'The original adjustment event is incomplete.');return e.adjustments;});
  const compiled=compileAdjustmentExport({report:doc.originalReport,source:doc.source,records,workspaceRevision:doc.workspaceRevision,exportedAt:doc.exportedAt});
  need(same(compiled.events,doc.events),'The export events, original ledger or exact native totals differ from the original compiler.');
  const selected=doc.events.filter(e=>e.original.eventId===eventId);
  need(selected.length===1,'The original event selection is absent or ambiguous.');
  const {original:event,adjustments:entries,totals}=selected[0];
  adjustmentEventIdentity(event);
  const expected=jobBinding(expectedJob,event),identity=eventBinding(event);
  const proofs=[];
  for(const record of entries){
    validateAdjustment(record);
    need(same(eventBinding(record.original),identity),'An adjustment belongs to another original receipt, route or settlement.');
    const proof=proofFor(record,event);if(proof)proofs.push(proof);
  }
  const paid=proofs[0]??null;
  if(paid)for(const p of proofs)need(transferIdentity(p)===transferIdentity(paid),'The selected adjustments disagree about the original payment transfer.');
  const purchase=paid?{source_kind:'merchant_adjustments',event_id:event.eventId,identity_sha256:digest(identity),
    transaction:paid.transaction,network:paid.network,asset:paid.asset,payer:paid.payer,recipient:paid.recipient,
    amount:paid.atomicAmount,transfer_identity:transferIdentity(paid),matching_event_id:paid.matchingEventId,
    route_id:event.routeId,method:event.method,source_time:event.at,
    native_date_basis:event.timeBasis??'Original merchant settlement-event day',original_snapshot_at:doc.exportedAt,
    observation:paid,source_reference:expected?.job_id??event.eventId,...(expected?{job_id:expected.job_id}:{}),
    merchant_quoted_value_usd:event.verifiedQuotedValueUsd??null,merchant_price_basis:event.merchantPriceBasis??null}:null;
  const credits=[],outcomes=[];
  for(const record of entries){
    const verified=record.kind==='REFUND'&&record.status==='VERIFIED';
    if(verified)validateRefundProof(record.verification.proof,record);
    const proof=verified?record.verification.proof:null;
    if(verified&&paid){
      const terms=record.refundTerms;
      need(terms.network===paid.network&&terms.asset===paid.asset&&terms.from===paid.recipient&&terms.to===paid.payer&&
        terms.maxAmountAtomic===paid.atomicAmount,'The native reverse transfer does not return the selected original purchase.');
      credits.push({source_kind:'merchant_adjustments',adjustment_id:record.id,event_id:event.eventId,
        original_transaction:paid.transaction,original_operation_status:record.status,refund_id:proof.refundId,
        amount:record.amountAtomic,network:proof.network,asset:proof.asset,payer:proof.payer,recipient:proof.recipient,
        transaction:proof.transaction,transfer_identity:transferIdentity(proof),transfer_at:proof.transferAt,
        matching_event_id:proof.matchingEventId,observed_at:proof.observedAt,observation:proof,observation_sha256:digest(proof),
        reason:record.reason,request_sha256:record.requestSha256,source_sha256:sourceSha256,
        source_reference:expected?.job_id??event.eventId,...(expected?{job_id:expected.job_id}:{}),
        original_source:record.source,original_event:record.original});
    }
    outcomes.push({adjustment_id:record.id,event_id:event.eventId,kind:record.kind,status:record.status,amount:record.amountAtomic,
      effective_at:record.effectiveAt,recorded_at:record.createdAt,operator:record.actor,reason:record.reason,reference:record.reference,
      native_verified:verified,eligible_return:verified&&!!paid,transaction:proof?.transaction??null,
      transfer_at:proof?.transferAt??null,observed_at:proof?.observedAt??null,
      eligibility:verified?(paid?'VERIFIED_RETURN':'ORIGINAL_PAYMENT_PROOF_UNAVAILABLE'):'ORIGINAL_DECISION_WITHOUT_VERIFIED_RETURN'});
  }
  const manifest={schema:INTAKE_SCHEMA,producer_schema:doc.schema,
    original_file:{name:basename(sourceFile),bytes:raw.length,sha256:sourceSha256},
    selection:{event_id:eventId,expected_job:expected}};
  const manifestRaw=adjustmentJson(manifest);
  return {schema:SCHEMA,source_kind:'merchant_adjustments',captured_at:new Date().toISOString(),
    source_file:sourceFile,source_directory:dirname(sourceFile),source_sha256:sourceSha256,
    source_identity:{network:event.network,event_id:event.eventId},source_reference:expected?.job_id??event.eventId,
    manifest_sha256:hash(manifestRaw),manifest_kind:'BUYER_INTAKE_SELECTION',manifest_base64:manifestRaw.toString('base64'),
    receipt:{schema:INTAKE_SCHEMA,source:doc.source,workspaceRevision:doc.workspaceRevision,exportedAt:doc.exportedAt,
      selected_event:identity,expected_job:expected,totals},
    original_event:event,purchase,credits,adjustments:outcomes,payment_status:event.transfer,
    files:[{name:'merchant-adjustments.json',original_name:basename(sourceFile),bytes:raw.length,sha256:sourceSha256,base64:raw.toString('base64')}],
    basis:'Unchanged original AdjustmentWorkspace export, original adjustment compiler and independent native payment/reverse-transfer validators; no network operation'};
}
export async function main(args=process.argv.slice(2)){
  const values={};
  for(let i=0;i<args.length;i+=2){
    need(['--source-file','--source-sha256','--event-id','--expected-job'].includes(args[i])&&typeof args[i+1]==='string'&&!Object.hasOwn(values,args[i]),
      'Use each declared original-source option once.');values[args[i]]=args[i+1];
  }
  const result=await captureBuyerAdjustments({sourceFile:values['--source-file'],sourceSha256:values['--source-sha256'],
    eventId:values['--event-id'],expectedJob:values['--expected-job']?JSON.parse(values['--expected-job']):null});
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{
  process.stderr.write(String(e.message||e)+'\n');process.exitCode=1;
});
