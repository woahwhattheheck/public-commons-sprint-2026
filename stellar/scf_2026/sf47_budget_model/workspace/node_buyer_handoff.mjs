// MIT. Original Node accounting carrier -> the existing Grant Operations buyer receiver.
import {inspectNodeAccountingExport,NODE_ACCOUNTING_EXPORT} from '../../../scf-starforge-20261009/sf88-operator-buyer-cli/node/operation-accounting-export.mjs';
import {analyzeOne} from '../../../scf-starforge-20261009/sf52-buyer-outcomes/outcomes.mjs';
import {canonical,sha,need,MAX_BYTES} from '../../../scf-starforge-20261009/sf88-operator-buyer-cli/operations-handoff/contract.mjs';

export {NODE_ACCOUNTING_EXPORT};
const HASH=/^[a-f0-9]{64}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeInt=value=>Number.isSafeInteger(value)&&value>=0;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FINALIZED=new Set(['FINALIZED','IDEMPOTENT_FINALIZED']);

/** Project only facts returned by the unchanged original Node/SF36/SF52 readers.
 * The carrier embeds the producing attempt and checkout evidence, not a ledger
 * snapshot or response file. A free response therefore has no purchase object.
 */
export function inspectNodeOperations(raw){
  need(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=MAX_BYTES,'BUYER_HANDOFF_SIZE');
  const inspected=inspectNodeAccountingExport(raw),identity=inspected.sourceIdentity;
  const native=inspected.native,result=native.result,approved=inspected.approvedRequest;
  const outcome=analyzeOne(inspected.observation),unpaid=native.kind==='UNPAID_RESPONSE';
  const settled=!unpaid&&native.kind==='PAID_FINALIZATION'&&FINALIZED.has(result.outcome);
  const issues=[],buyer=object(inspected.observation.buyer)?inspected.observation.buyer:{};
  const output={state:'NOT_EMBEDDED',bytes:null,sha256:null,
    captureStatus:inspected.observation.bodyCapture?.status??'UNKNOWN',
    httpStatus:buyer.httpStatus??null,observedHttpBody:outcome.observedHttpBody===true,
    reader:'ORIGINAL_NODE_ACCOUNTING_CARRIER',
    interpretation:'This carrier retains the original response observation. It embeds no response body and establishes no currently verified output file.'};
  let purchase=null,finality=null;
  if(!unpaid){
    need(object(approved)&&sha(canonical(approved))===native.approvedRequestSha256,
      'BUYER_NODE_APPROVAL_DIGEST');
    const original=inspected.originalRecord,transaction=original.receipt?.transaction??null;
    if(settled){
      need(HASH.test(transaction??'')&&result.receipt_ref===approved.network+'/'+transaction&&
        result.actual===approved.max_amount&&HASH.test(result.proof_sha256??''),
        'BUYER_NODE_FINALITY_BINDING');
      const proof=result.verifiedFacts;
      if(proof!==undefined&&proof!==null){
        need(object(proof)&&proof.schema==='stellar-forge.sf36.verified-facts.v1'&&
          proof.intentId===inspected.intentId&&proof.transaction===transaction&&
          proof.network===approved.network&&proof.asset===approved.asset&&
          proof.payer===native.operator.payer&&proof.recipient===approved.pay_to&&
          proof.atomicAmount===result.actual&&proof.request_sha256===native.approvedRequestSha256&&
          safeInt(proof.ledger)&&proof.ledger>0&&typeof proof.eventId==='string'&&
          proof.eventId.length>0&&proof.eventId.length<=500&&
          sha(canonical(proof))===result.proof_sha256,'BUYER_NODE_FINALITY_FACTS');
      }
      finality={authority:'ORIGINAL_SF36_SAVED_FINALIZATION',outcome:result.outcome,
        transaction,amountAtomic:result.actual,requestSha256:native.approvedRequestSha256,
        proofSha256:result.proof_sha256,ledger:proof?.ledger??null,eventId:proof?.eventId??'',
        recordedAt:native.completedAt,receipt:result.receipt_ref,
        chainObservation:result.chainObservation};
    }
    const signed=settled||outcome.signedAttempt===true;
    const amount=settled?result.actual:approved.max_amount;
    if(!/^[0-9]{1,30}$/.test(amount??''))issues.push('ATOMIC_AMOUNT_EXCEEDS_ORIGINAL_OPERATIONS_BOUND');
    if(['PROOF_CONFLICT','SELLER_RECEIPT_CONFLICT'].includes(outcome.status))
      issues.push('ORIGINAL_OUTCOME_CONFLICT');
    if(!settled&&outcome.signedAttempt!==true&&outcome.signedAttempt!==false)
      issues.push('SIGNED_ATTEMPT_NOT_ESTABLISHED');
    if(finality?.ledger>1e12)issues.push('LEDGER_EXCEEDS_ORIGINAL_OPERATIONS_BOUND');
    purchase={network:approved.network,asset:approved.asset,transactionHash:transaction,
      ledger:finality?.ledger??null,amountStroops:amount,feesStroops:null,
      deliveredBytes:null,deliveredSha256:null,intentId:inspected.intentId,operationId:'',
      requestId:approved.request_id,
      reservationId:typeof original.operatorReservation?.requestId==='string'?original.operatorReservation.requestId:'',
      merchantEventId:finality?.eventId??'',recipient:approved.pay_to,acceptedTermsSha256:null,
      attemptStatus:signed?'ATTEMPTED':outcome.signedAttempt===false?'NOT_ATTEMPTED':'APPROVED',
      settlementStatus:settled?'SETTLED':outcome.status==='SELLER_REPORTED_FAILED'?'FAILED':
        signed||['PENDING_RECONCILIATION','SELLER_REPORTED_ONLY'].includes(outcome.status)?'PENDING':'UNKNOWN',
      outputStatus:'UNKNOWN',orderStatus:'NOT_APPLICABLE',origin:'NATIVE',
      observedAt:native.completedAt,firstAttemptAt:null,settledAt:null,outputCompletedAt:null,
      paymentAttempted:signed};
  }else{
    need(approved===null&&outcome.status==='NO_PAYMENT_REQUIRED'&&outcome.signedAttempt===false&&
      result.actualAtomicUnits===null&&result.receipt===null&&result.requestSha256===null,
      'BUYER_NODE_UNPAID_BINDING');
  }
  const node={sourceIdentity:structuredClone(identity),sourceIdentitySha256:inspected.sourceIdentitySha256,
    commandId:inspected.commandId,contextSha256:inspected.contextSha256,
    kind:native.kind,outcome:result.outcome,recordAuthority:native.recordAuthority,
    attemptCreatedAt:inspected.attemptCreatedAt,attemptState:inspected.attemptState,
    sourceObservedAt:inspected.sourceObservedAt,accountingStartedAt:inspected.startedAt,
    accountingCompletedAt:native.completedAt,chainObservation:result.chainObservation??null};
  const sourceFiles=Object.entries(inspected.source).map(([name,value])=>({
    name:name+'.json',sha256:value.sha256,bytes:value.bytes}));
  const row={jobId:inspected.sourceIdentitySha256,intentId:inspected.intentId,
    configSha256:identity.configurationSha256,sourceConfigSha256:identity.configurationSha256,
    originalCreatedAt:inspected.attemptCreatedAt,captureStartedAt:inspected.attemptCreatedAt,
    capturedAt:inspected.sourceObservedAt,nativeState:inspected.attemptState,
    method:approved?.method??null,url:approved?.resource??null,
    operator:{actor:approved?.actor??'',service:approved?.service??''},
    bodySha256:identity.bodySha256,bodyBytes:identity.bodyBytes,sourceFiles,
    sourceRecordSha256:sha(canonical({node,sourceFiles,outcome,output,purchase,finality})),
    sourceKind:'NODE_ACCOUNTING',disposition:unpaid?'NO_PAYMENT_REQUIRED':
      settled?'ORIGINAL_SF36_FINALIZED':'ORIGINAL_ACCOUNTING_UNRESOLVED',
    node,outcome,finalization:{status:result.outcome,kind:native.kind,recordAuthority:native.recordAuthority},
    finality,output,purchase,issues,
    canReceive:!issues.some(code=>['ORIGINAL_OUTCOME_CONFLICT','ATOMIC_AMOUNT_EXCEEDS_ORIGINAL_OPERATIONS_BOUND',
      'LEDGER_EXCEEDS_ORIGINAL_OPERATIONS_BOUND'].includes(code))};
  return {schema:NODE_ACCOUNTING_EXPORT,
    source:{sha256:inspected.sourceSha256,bytes:inspected.sourceBytes,
      captureStartedAt:inspected.attemptCreatedAt,capturedAt:inspected.sourceObservedAt,
      sourceIdentitySha256:inspected.sourceIdentitySha256,commandId:inspected.commandId,
      contextSha256:inspected.contextSha256,accountingCompletedAt:native.completedAt,
      dateBasis:'Original producing-attempt creation and checkout observation; accounting completion is retained separately.'},
    reader:{product:'ORIGINAL_SF88_NODE_ACCOUNTING',outcomes:'ORIGINAL_SF52',
      finality:'ORIGINAL_SF36_SAVED_RESULT',
      transferVerification:'Unchanged Node export/result validators. No ledger, signing key, worker or RPC is opened.'},
    counts:{jobs:1,knownSignedAttempts:purchase?.paymentAttempted?1:0,settled:settled?1:0,
      verifiedRetainedOutputs:0,pendingOrUnknown:!unpaid&&!settled?1:0,
      unpaidOperationalObservations:unpaid?1:0},
    rows:[row],
    interpretation:'An original unsigned response is an operational observation without a payment asset, amount, reservation or purchase. Original paid outcomes retain their approved terms and saved SF36 finality. Deployment attribution is a named operator decision; receiving a source does not add an independent customer or external acceptance.'};
}

export function renderNodeOperations(report){
  need(report?.schema===NODE_ACCOUNTING_EXPORT,'BUYER_NODE_REPORT_REQUIRED');
  const row=report.rows[0],node=row.node,paid=row.purchase;
  const columns=[['Intent',row.intentId],['Source disposition',row.disposition],
    ['Native accounting outcome',node.outcome],['Record authority',node.recordAuthority],
    ['Reported HTTP status',row.output.httpStatus],['Response capture',row.output.captureStatus],
    ['Response file in this carrier','Not embedded'],['Network',paid?.network??'Not applicable'],
    ['Asset',paid?.asset??'Not applicable'],['Exact atomic amount',paid?.amountStroops??'Not applicable'],
    ['Settlement',paid?.settlementStatus??'No payment required'],
    ['Transaction',paid?.transactionHash??''],['Source identity',node.sourceIdentitySha256],
    ['Original command',node.commandId],['Original context',node.contextSha256],
    ['Producing attempt created',node.attemptCreatedAt],['Checkout observed',node.sourceObservedAt],
    ['Accounting completed',node.accountingCompletedAt],['Review items',row.issues.join('; ')]];
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Original Node accounting source review</title><style>body{font:15px system-ui;color:#18242e;background:#f4f6f8;margin:0;padding:28px}main{max-width:1100px;min-width:0;margin:auto}h1{font-size:28px}p{max-width:90ch;line-height:1.6}code,td,th{overflow-wrap:anywhere}section{max-width:100%;overflow-x:auto}table{border-collapse:collapse;width:100%;background:white}td,th{border:1px solid #cad3dc;padding:10px;text-align:left;vertical-align:top}th{min-width:10rem}@media(max-width:500px){body{padding:16px}h1{font-size:24px}}@media print{body{padding:0}}</style><main>'+
    '<p>STELLAR FORGE / DELIVERY OPERATIONS</p><h1>Original Node accounting source</h1><p>'+escape(report.interpretation)+'</p>'+
    '<p>Retained source <code>'+escape(report.source.sha256)+'</code>, '+escape(report.source.bytes)+' bytes. '+escape(report.source.dateBasis)+'</p>'+
    '<p>'+escape(row.output.interpretation)+'</p><section aria-label="Original source observations"><table><tbody>'+
    columns.map(([label,value])=>'<tr><th scope="row">'+escape(label)+'</th><td>'+escape(value)+'</td></tr>').join('')+
    '</tbody></table></section><h2>Embedded original source</h2><section><table><thead><tr><th>File</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>'+
    row.sourceFiles.map(file=>'<tr><td>'+escape(file.name)+'</td><td>'+escape(file.bytes)+'</td><td><code>'+escape(file.sha256)+'</code></td></tr>').join('')+
    '</tbody></table></section></main></html>';
}
