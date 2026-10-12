// MIT. Portable original Inbox observations for delivery operations; no payment execution.
import {createHash} from 'node:crypto';
import {analyzeOne} from '../../sf52-buyer-outcomes/outcomes.mjs';
import {summarizeFinalization} from '../finalization.mjs';

export const SCHEMA='stellar-forge.sf88.operations-handoff.v1';
export const MAX_BYTES=8*1024*1024;
export const MAX_JOBS=100;
export const FILES=Object.freeze(['request.json','attempt.json','terminal.json','recovery.json','finalization.json','evidence.json']);
const HASH=/^[a-f0-9]{64}$/;
const INTENT=/^[A-Za-z0-9._:-]{1,128}$/;
const QUEUE_SCHEMA='stellar-forge.sf88.buyer-inbox.v1';
const FINALIZED=new Set(['FINALIZED','IDEMPOTENT_FINALIZED']);
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const sha=v=>createHash('sha256').update(v).digest('hex');
export function canonical(v){
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  if(obj(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
export function need(ok,code){if(!ok)throw Object.assign(new Error(code),{code});}
const same=(a,b)=>canonical(a)===canonical(b);
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const atom=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(v);
const safeInt=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const escrow=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function originalFile(item,name){
  need(obj(item)&&item.name===name&&safeInt(item.bytes,MAX_BYTES)&&item.bytes>0&&HASH.test(item.sha256??'')&&
    typeof item.contentBase64==='string'&&item.contentBase64.length<=Math.ceil(MAX_BYTES/3)*4,'BUYER_SOURCE_FILE_INVALID');
  const raw=Buffer.from(item.contentBase64,'base64');
  need(raw.length===item.bytes&&raw.toString('base64')===item.contentBase64&&sha(raw)===item.sha256,'BUYER_SOURCE_FILE_CHANGED');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{need(false,'BUYER_SOURCE_JSON_INVALID');}
  need(obj(value),'BUYER_SOURCE_OBJECT_REQUIRED');return {raw,value,bytes:item.bytes,sha256:item.sha256};
}
function nativeBinding(entry){
  need(obj(entry)&&obj(entry.native)&&Array.isArray(entry.files)&&entry.files.length<=FILES.length&&
    stamp(entry.capturedAt)&&stamp(entry.captureStartedAt)&&entry.capturedAt>=entry.captureStartedAt,'BUYER_JOB_INVALID');
  const files={};for(const item of entry.files){
    need(FILES.includes(item?.name)&&!files[item.name],'BUYER_SOURCE_NAME_INVALID');
    files[item.name]=originalFile(item,item.name);
  }
  need(files['request.json'],'BUYER_ORIGINAL_REQUEST_REQUIRED');
  const request=files['request.json'].value,native=entry.native,id=native.id,intent=native.operation?.intentId;
  need(HASH.test(id??'')&&INTENT.test(intent??'')&&sha(intent)===id&&request.schema===QUEUE_SCHEMA&&native.schema===QUEUE_SCHEMA&&
    request.id===id&&request.operation?.intentId===intent,'BUYER_ORIGINAL_IDENTITY_INVALID');
  for(const key of ['createdAt','configSha256','sourceConfigSha256','bodySha256','bodyBytes','operation','operator','dependencies','evidencePath','responseDestination'])
    need(same(request[key],native[key]),'BUYER_NATIVE_REQUEST_MISMATCH');
  need(stamp(request.createdAt)&&HASH.test(request.configSha256??'')&&HASH.test(request.sourceConfigSha256??'')&&
    (request.bodySha256===null||HASH.test(request.bodySha256??''))&&safeInt(request.bodyBytes)&&
    (request.bodySha256!==null||request.bodyBytes===0),'BUYER_REQUEST_BINDING_INVALID');
  const attempt=files['attempt.json']?.value??null,terminal=files['terminal.json']?.value??null,
    recovery=files['recovery.json']?.value??null,finalization=files['finalization.json']?.value??null;
  need(same(native.attempt,attempt)&&same(native.recovery,recovery)&&same(native.finalization,finalization)&&
    same(native.outcome,terminal?.summary??null)&&same(native.lastError,terminal?.error??null),'BUYER_NATIVE_SOURCE_MISMATCH');
  if(attempt)need(attempt.schema===QUEUE_SCHEMA&&attempt.intentId===intent&&attempt.configSha256===request.configSha256&&
    ['EXECUTE','CANCELLED'].includes(attempt.kind)&&typeof attempt.id==='string'&&stamp(attempt.startedAt)&&attempt.startedAt>=request.createdAt,
    'BUYER_ATTEMPT_BINDING_INVALID');
  if(terminal)need(attempt&&terminal.schema===QUEUE_SCHEMA&&terminal.attemptId===attempt.id&&terminal.intentId===intent&&
    stamp(terminal.completedAt)&&terminal.completedAt>=attempt.startedAt,'BUYER_TERMINAL_BINDING_INVALID');
  if(terminal?.summary)need(terminal.summary.mode==='ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT'&&
    terminal.summary.intentId===intent,'BUYER_OUTCOME_BINDING_INVALID');
  if(recovery)need(attempt&&recovery.schema===QUEUE_SCHEMA&&recovery.attemptId===attempt.id&&recovery.intentId===intent&&
    stamp(recovery.recoveredAt)&&recovery.recoveredAt>=attempt.startedAt,'BUYER_RECOVERY_BINDING_INVALID');
  if(finalization)need(attempt&&finalization.schema==='stellar-forge.sf88.inbox-finalization.v1'&&
    finalization.attemptId===attempt.id&&finalization.intentId===intent&&finalization.configSha256===request.configSha256&&
    stamp(finalization.completedAt)&&finalization.completedAt>=attempt.startedAt,'BUYER_FINALITY_BINDING_INVALID');
  const state=attempt?.kind==='CANCELLED'?'CANCELLED':recovery?'RECOVERED':terminal?'ATTEMPT_RECORDED':attempt?'RUNNING_OR_INTERRUPTED':'QUEUED';
  need(native.state===state,'BUYER_NATIVE_STATE_MISMATCH');
  for(const date of [terminal?.completedAt,recovery?.recoveredAt,finalization?.completedAt])
    if(date)need(date<=entry.capturedAt,'BUYER_SOURCE_AFTER_CAPTURE');
  return {files,request,native,attempt,terminal,recovery,finalization};
}
function outputView(entry,bound){
  const value=entry.output;
  need(obj(value)&&['VERIFIED','NOT_SAVED','UNAVAILABLE','OVER_LIMIT','NOT_REQUESTED'].includes(value.state),'BUYER_OUTPUT_REVIEW_INVALID');
  const saved=bound.native.outcome?.responseFile;
  if(value.state==='VERIFIED'){
    need(saved?.status==='SAVED'&&safeInt(saved.bytes)&&HASH.test(saved.sha256??'')&&
      value.bytes===saved.bytes&&value.sha256===saved.sha256&&saved.path===bound.request.responseDestination&&
      value.reader==='ORIGINAL_SF88_INBOX_RESPONSE_VERIFY','BUYER_OUTPUT_BINDING_INVALID');
  }else need(value.bytes==null&&value.sha256==null,'BUYER_UNVERIFIED_OUTPUT_CLAIM');
  return value;
}
function interpret(entry){
  const bound=nativeBinding(entry),{files,request,native,attempt,terminal,recovery,finalization}=bound;
  const intent=native.operation.intentId,expected=request.operation.expect;
  need(obj(expected)&&['stellar:testnet','stellar:pubnet'].includes(expected.network)&&
    typeof expected.asset==='string'&&typeof expected.payTo==='string'&&atom(expected.maxAtomic)&&BigInt(expected.maxAtomic)>0n,
    'BUYER_STELLAR_TERMS_REQUIRED');
  const evidence=files['evidence.json']?.value??null;
  let outcome=null,terms=null,observation=null;
  if(evidence){
    observation=evidence.observation;
    need(attempt?.kind==='EXECUTE'&&evidence.schema==='scf82.checkout-evidence.v1'&&evidence.intentId===intent&&
      observation?.intentId===intent&&stamp(evidence.observedAt)&&evidence.observedAt===observation.observedAt&&
      evidence.observedAt>=attempt.startedAt&&evidence.observedAt<=entry.capturedAt,'BUYER_EVIDENCE_BINDING_INVALID');
    outcome=analyzeOne(observation);terms=observation.buyer?.requirement??null;
    if(terms)need(['scheme','network','asset','payTo'].every(k=>terms[k]===expected[k])&&
      BigInt(terms.amount)<=BigInt(expected.maxAtomic),'BUYER_EVIDENCE_TERMS_MISMATCH');
  }
  const output=outputView(entry,bound),issues=[];
  if(outcome?.status==='PROOF_CONFLICT'||outcome?.status==='SELLER_RECEIPT_CONFLICT')issues.push('ORIGINAL_OUTCOME_CONFLICT');
  const view=summarizeFinalization(finalization);
  const final=FINALIZED.has(finalization?.result?.outcome)?{result:finalization.result,completedAt:finalization.completedAt}:
    FINALIZED.has(finalization?.lastFinalized?.result?.outcome)?finalization.lastFinalized:null;
  let finality=null;
  if(final){
    const result=final.result,original=evidence?.reconciliation?.record,approved=original?.operatorReservation?.approved_request,
      approvedSha=original?.operatorReservation?.request_sha256;
    need(evidence&&finalization.evidenceSha256===files['evidence.json'].sha256&&HASH.test(approvedSha??'')&&
      approvedSha===finalization.approvedRequestSha256&&result.request_id===intent&&result.request_sha256===approvedSha&&
      atom(result.actual)&&BigInt(result.actual)>0n&&HASH.test(result.proof_sha256??'')&&stamp(final.completedAt),
      'BUYER_FINALITY_SOURCE_MISMATCH');
    need(original.intentId===intent&&approved?.request_id===intent&&approved.actor===request.operator?.actor&&
      approved.service===request.operator?.service&&approved.resource===new URL(request.operation.url).href&&
      approved.method===request.operation.method&&approved.body_present===(request.bodySha256!==null)&&
      approved.body_bytes===request.bodyBytes&&approved.body_sha256===(request.bodySha256??sha(''))&&
      ['scheme','network','asset'].every(k=>approved[k]===expected[k])&&approved.pay_to===expected.payTo&&
      approved.max_amount===result.actual&&terms?.amount===result.actual,'BUYER_FINALITY_APPROVAL_MISMATCH');
    const tx=original.receipt?.transaction;
    need(HASH.test(tx??'')&&original.receipt.success===true&&original.receipt.network===expected.network&&
      result.receipt_ref===expected.network+'/'+tx,'BUYER_FINALITY_RECEIPT_MISMATCH');
    if(result.verifiedFacts){
      const f=result.verifiedFacts;
      need(f.schema==='stellar-forge.sf36.verified-facts.v1'&&f.intentId===intent&&f.transaction===tx&&
        f.network===expected.network&&f.asset===expected.asset&&f.recipient===expected.payTo&&
        f.atomicAmount===result.actual&&f.request_sha256===approvedSha&&safeInt(f.ledger,1e12)&&f.ledger>0&&
        typeof f.eventId==='string'&&f.eventId.length>0&&sha(canonical(f))===result.proof_sha256,'BUYER_FINALITY_FACTS_MISMATCH');
    }
    finality={authority:'ORIGINAL_SF36_SAVED_FINALIZATION',outcome:result.outcome,transaction:tx,
      amountAtomic:result.actual,requestSha256:approvedSha,proofSha256:result.proof_sha256,
      ledger:result.verifiedFacts?.ledger??null,eventId:result.verifiedFacts?.eventId??'',
      recordedAt:final.completedAt,receipt:result.receipt_ref};
  }
  const signed=outcome?.signedAttempt===true||native.outcome?.error?.paymentSent===true||native.lastError?.paymentSent===true||finality!==null;
  const noSigned=outcome&&outcome.signedAttempt===false||native.outcome?.error?.paymentSent===false||native.lastError?.paymentSent===false;
  const attemptStatus=attempt?.kind==='CANCELLED'?'CANCELLED':signed?'ATTEMPTED':noSigned?'NOT_ATTEMPTED':'APPROVED';
  if(attempt?.kind==='EXECUTE'&&!signed&&!noSigned)issues.push('SIGNED_ATTEMPT_NOT_ESTABLISHED');
  if(!evidence&&attempt?.kind==='EXECUTE')issues.push('ORIGINAL_CHECKOUT_EVIDENCE_UNAVAILABLE');
  const chain=outcome?.independentlyVerifiedTransfer?observation.chain:null;
  const tx=finality?.transaction??chain?.transaction??(HASH.test(observation?.buyer?.receipt?.transaction??'')?observation.buyer.receipt.transaction:null);
  if(finality&&chain)need(finality.transaction===chain.transaction&&finality.amountAtomic===chain.amountAtomic&&
    (finality.ledger===null||finality.ledger===chain.ledger),'BUYER_FINALITY_OUTCOME_CONFLICT');
  const settlement=finality||chain?'SETTLED':['PENDING_RECONCILIATION','SELLER_REPORTED_ONLY'].includes(outcome?.status)?'PENDING':
    outcome?.status==='SELLER_REPORTED_FAILED'?'FAILED':'UNKNOWN';
  const outputStatus=output.state==='VERIFIED'?'COMPLETE':output.state==='UNAVAILABLE'?'FAILED':
    native.outcome?.responseFile?.stream?.lastCompleteByte>0?'PARTIAL':'UNKNOWN';
  if(output.state==='OVER_LIMIT')issues.push('OUTPUT_EXCEEDS_SELECTED_VERIFICATION_LIMIT');
  if(output.state==='UNAVAILABLE')issues.push('RETAINED_OUTPUT_UNAVAILABLE');
  if(native.outcome?.responseFile?.status==='SAVED'&&output.state!=='VERIFIED')issues.push('SAVED_OUTPUT_NOT_CURRENTLY_VERIFIED');
  const amount=finality?.amountAtomic??terms?.amount??'0';
  if(amount.length>30)issues.push('ATOMIC_AMOUNT_EXCEEDS_ORIGINAL_OPERATIONS_BOUND');
  const purchase={
    network:expected.network,asset:expected.asset,transactionHash:tx,ledger:finality?.ledger??chain?.ledger??null,
    amountStroops:amount,feesStroops:null,
    deliveredBytes:output.state==='VERIFIED'?output.bytes:null,deliveredSha256:output.state==='VERIFIED'?output.sha256:null,
    intentId:intent,operationId:'',requestId:evidence?.operatorReservation?.requestId??'',
    reservationId:evidence?.operatorReservation?.requestId??'',merchantEventId:finality?.eventId??'',
    recipient:terms?.payTo??'',acceptedTermsSha256:null,
    attemptStatus,settlementStatus:settlement,outputStatus,orderStatus:'NOT_APPLICABLE',
    origin:recovery?'RECOVERED':'NATIVE',observedAt:entry.capturedAt,firstAttemptAt:attempt?.startedAt??null,
    settledAt:null,outputCompletedAt:null,paymentAttempted:signed,
  };
  return {jobId:native.id,intentId:intent,configSha256:native.configSha256,sourceConfigSha256:native.sourceConfigSha256,
    originalCreatedAt:native.createdAt,captureStartedAt:entry.captureStartedAt,capturedAt:entry.capturedAt,
    nativeState:native.state,method:request.operation.method,url:request.operation.url,
    operator:{actor:request.operator?.actor??'',service:request.operator?.service??''},
    bodySha256:native.bodySha256,bodyBytes:native.bodyBytes,
    sourceFiles:entry.files.map(({name,bytes,sha256})=>({name,bytes,sha256})),
    sourceRecordSha256:sha(canonical({native:entry.native,files:entry.files.map(({name,sha256,bytes})=>({name,sha256,bytes})),output:entry.output})),
    outcome,finalization:view,finality,output,purchase,issues,
    canReceive:!issues.some(code=>['ORIGINAL_OUTCOME_CONFLICT','ATOMIC_AMOUNT_EXCEEDS_ORIGINAL_OPERATIONS_BOUND'].includes(code))};
}
export function inspectHandoff(raw){
  need(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=MAX_BYTES,'BUYER_HANDOFF_SIZE');
  let packet;try{packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{need(false,'BUYER_HANDOFF_JSON_INVALID');}
  need(obj(packet)&&packet.schema===SCHEMA&&stamp(packet.captureStartedAt)&&stamp(packet.capturedAt)&&
    packet.capturedAt>=packet.captureStartedAt&&Array.isArray(packet.jobs)&&packet.jobs.length>0&&packet.jobs.length<=MAX_JOBS,
    'BUYER_HANDOFF_INVALID');
  const inbox=originalFile(packet.inbox,'inbox.json');
  need(inbox.value.schema===QUEUE_SCHEMA&&stamp(inbox.value.createdAt),'BUYER_INBOX_SOURCE_INVALID');
  const rows=packet.jobs.map(interpret),seen=new Set();
  for(const row of rows){need(!seen.has(row.intentId),'BUYER_DUPLICATE_INTENT');seen.add(row.intentId);
    need(row.captureStartedAt>=packet.captureStartedAt&&row.capturedAt<=packet.capturedAt,'BUYER_CAPTURE_WINDOW_INVALID');}
  const txs=new Map();for(const row of rows){if(!row.purchase.transactionHash)continue;
    const key=row.purchase.network+'/'+row.purchase.transactionHash;
    if(txs.has(key)){row.issues.push('REPEATED_TRANSACTION_IN_SOURCE');rows[txs.get(key)].issues.push('REPEATED_TRANSACTION_IN_SOURCE');}
    else txs.set(key,rows.indexOf(row));
  }
  const report={schema:SCHEMA,source:{sha256:sha(raw),bytes:raw.length,captureStartedAt:packet.captureStartedAt,capturedAt:packet.capturedAt,
      inboxSha256:packet.inbox.sha256,inboxCreatedAt:inbox.value.createdAt},
    reader:{product:'ORIGINAL_SF88_INBOX',outcomes:'ORIGINAL_SF52',finality:'ORIGINAL_SF36_SAVED_VIEW',
      transferVerification:'Retained original evidence; this reader makes no new ledger or RPC request.'},
    counts:{jobs:rows.length,knownSignedAttempts:rows.filter(x=>x.purchase.paymentAttempted).length,
      settled:rows.filter(x=>x.purchase.settlementStatus==='SETTLED').length,verifiedRetainedOutputs:rows.filter(x=>x.output.state==='VERIFIED').length,
      pendingOrUnknown:rows.filter(x=>['UNKNOWN','PENDING'].includes(x.purchase.settlementStatus)).length},
    rows,interpretation:'An Inbox, native payment and verified retained file do not establish an independent customer, useful business result, commercial acceptance, grant award or cash income. Operator attribution and receiving remain explicit case decisions.'};
  return report;
}
export function renderHandoff(report){
  const cell=v=>'<td>'+escrow(v)+'</td>';
  const rows=report.rows.map(row=>'<tr>'+[
    row.intentId,row.nativeState,row.purchase.network,row.purchase.asset,row.purchase.amountStroops,
    row.purchase.attemptStatus,row.purchase.settlementStatus,row.purchase.transactionHash??'',
    row.output.state,row.output.bytes??'',row.output.sha256??'',row.issues.join('; ')].map(cell).join('')+'</tr>').join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Original buyer operations handoff</title><style>body{font:15px system-ui;color:#18242e;background:#f4f6f8;margin:0;padding:32px}main{max-width:1440px;margin:auto}h1{font-size:28px}p{max-width:95ch;line-height:1.6}table{border-collapse:collapse;background:white;width:100%;font-size:12px}td,th{text-align:left;border:1px solid #cad3dc;padding:10px;vertical-align:top;overflow-wrap:anywhere}section{overflow:auto}code{overflow-wrap:anywhere}@media print{body{padding:0;font-size:10px}table{font-size:7px}}</style><main>'+
    '<p>STELLAR FORGE / DELIVERY OPERATIONS</p><h1>Original buyer source review</h1><p>'+escrow(report.interpretation)+'</p>'+
    '<p>Source SHA-256 <code>'+escrow(report.source.sha256)+'</code>. Captured '+escrow(report.source.captureStartedAt)+' to '+escrow(report.source.capturedAt)+
    '. '+report.counts.jobs+' original jobs; '+report.counts.knownSignedAttempts+' established signed attempts; '+report.counts.settled+
    ' retained settled observations; '+report.counts.verifiedRetainedOutputs+' files verified at capture.</p>'+
    '<p>Atomic amounts retain each original network and asset. An accepted amount is not a settled transfer until the original evidence establishes settlement. Native finalization time is an accounting observation; it is not substituted for chain settlement or output completion time.</p>'+
    '<section><table><thead><tr>'+['Intent','Native state','Network','Asset','Atomic amount','Attempt','Settlement','Transaction','Retained output','Bytes','SHA-256','Review items'].map(x=>'<th>'+x+'</th>').join('')+
    '</tr></thead><tbody>'+rows+'</tbody></table></section></main></html>';
}
