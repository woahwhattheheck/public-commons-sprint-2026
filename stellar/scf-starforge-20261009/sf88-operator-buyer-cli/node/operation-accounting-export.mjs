// MIT. Read an unchanged original Node accounting export; no producer or payment is run.
import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {accountingOutput,sameAccountingValue,OPERATION_ACCOUNTING_COMMAND} from './operation-accounting.mjs';
import {digest,jsonBytes,parseJson,object,need,intent} from './store.mjs';
import {analyzeOne} from '../../sf52-buyer-outcomes/outcomes.mjs';
import {originalRecordFromEvidence} from '../../sf86-rpc-transfer-reconcile/cli.mjs';
import {checkOriginalTerms} from '../../sf86-rpc-transfer-reconcile/terms.mjs';

export const NODE_ACCOUNTING_EXPORT='stellar-forge.node-operation-accounting-export.v1';
export const NODE_ACCOUNTING_INSPECTION='stellar-forge.node-operation-accounting-inspection.v1';
export const MAX_NODE_ACCOUNTING_BYTES=16_777_216;
const HASH=/^[a-f0-9]{64}$/;
const time=value=>typeof value==='string'&&/(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const exactKeys=(v,keys)=>object(v)&&Object.keys(v).sort().join('\n')===[...keys].sort().join('\n');
function descriptor(value,limit){
  need(object(value)&&typeof value.path==='string'&&value.path.startsWith('/')&&
    HASH.test(value.sha256??'')&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&value.bytes<=limit,
    'NODE_EXPORT_SOURCE_DESCRIPTOR');
}
function embedded(value,expected,limit){
  need(exactKeys(value,['bytes','sha256','base64'])&&HASH.test(value.sha256??'')&&
    Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=limit&&typeof value.base64==='string'&&
    value.base64.length<=Math.ceil(limit/3)*4,'NODE_EXPORT_EMBEDDED_SOURCE');
  const raw=Buffer.from(value.base64,'base64');
  need(raw.toString('base64')===value.base64&&raw.length===value.bytes&&digest(raw)===value.sha256&&
    expected.bytes===value.bytes&&expected.sha256===value.sha256,'NODE_EXPORT_SOURCE_BYTES_CHANGED');
  return parseJson(raw);
}
const metadata=value=>object(value)?structuredClone(value):null;

/** Validate the producer's exact serialized file and original source/result bindings.
 * Hashes identify retained bytes; provenance and acceptance remain named operator decisions.
 */
export function inspectNodeAccountingExport(input){
  need(input instanceof Uint8Array&&input.byteLength>0&&input.byteLength<=MAX_NODE_ACCOUNTING_BYTES,
    'NODE_EXPORT_SIZE');
  const raw=Buffer.from(input),value=parseJson(raw);
  need(exactKeys(value,['schema','intentId','commandId','context','contextSha256','result','source','authority'])&&
    value.schema===NODE_ACCOUNTING_EXPORT&&value.authority==='ORIGINAL_SF36_RESULT_AND_RETAINED_ORIGINAL_ATTEMPT',
    'NODE_EXPORT_FORMAT');
  // exportAccounting writes this exact original representation. This also rejects
  // duplicate JSON keys and edited/reformatted carriers without silently repairing them.
  need(raw.equals(jsonBytes(value)),'NODE_EXPORT_ORIGINAL_SERIALIZATION_REQUIRED');
  intent(value.intentId);
  const c=value.context,id=c?.identity;
  need(object(c)&&c.schema===OPERATION_ACCOUNTING_COMMAND&&object(id)&&object(c.source)&&
    object(c.request)&&object(c.execution)&&/^finalize-[A-Za-z0-9]{6}$/.test(c.commandId??'')&&
    c.commandId===value.commandId&&id.intentId===value.intentId&&HASH.test(value.contextSha256??'')&&
    digest(jsonBytes(c))===value.contextSha256&&time(c.startedAt)&&
    Number.isSafeInteger(c.resultLimit)&&c.resultLimit>=65536&&c.resultLimit<=4_194_304,
    'NODE_EXPORT_COMMAND_BINDING');
  for(const field of ['stateDirectory','operationDirectory','attemptDirectory','producerRuntimeDirectory'])
    need(typeof id[field]==='string'&&id[field].startsWith('/')&&!id[field].includes('\0'),'NODE_EXPORT_ORIGINAL_IDENTITY');
  need(id.operationDirectory===join(id.stateDirectory,digest(id.intentId))&&
    c.commandDirectory===join(id.operationDirectory,'accounting',c.commandId)&&time(id.attemptCreatedAt)&&
    ['operationSha256','configurationSha256','bodySha256'].every(k=>HASH.test(id[k]??''))&&
    typeof id.bodyPresent==='boolean'&&Number.isSafeInteger(id.bodyBytes)&&id.bodyBytes>=0&&
    (id.bodyPresent||id.bodyBytes===0&&id.bodySha256===digest(Buffer.alloc(0)))&&
    (id.ticketSha256===null||HASH.test(id.ticketSha256??'')),'NODE_EXPORT_ORIGINAL_IDENTITY');
  for(const [name,limit] of [['operation',262144],['configuration',65536],['attempt',65536],['evidence',4_194_304]])
    descriptor(c.source[name],limit);
  need(c.source.operation.sha256===id.operationSha256&&
    c.source.configuration.sha256===id.configurationSha256&&
    c.source.operation.path===join(id.operationDirectory,'operation.json')&&
    c.source.configuration.path===join(id.operationDirectory,'config.json')&&
    c.source.attempt.path===join(id.attemptDirectory,'attempt.json')&&
    (id.bodyPresent?c.source.body?.sha256===id.bodySha256&&c.source.body?.bytes===id.bodyBytes:c.source.body===null)&&
    (c.source.ticket?.sha256??null)===id.ticketSha256,'NODE_EXPORT_ORIGINAL_SOURCE_BINDING');
  need(exactKeys(value.source,['attempt','evidence']),'NODE_EXPORT_EMBEDDED_SOURCE');
  const attempt=embedded(value.source.attempt,c.source.attempt,65536);
  const evidence=embedded(value.source.evidence,c.source.evidence,4_194_304);
  need(attempt.schema==='stellar-forge.node-buyer.v1'&&attempt.kind===undefined&&
    attempt.intentId===id.intentId&&attempt.configSha256===id.configurationSha256&&
    attempt.bodySha256===id.bodySha256&&attempt.createdAt===id.attemptCreatedAt,
    'NODE_EXPORT_ATTEMPT_BINDING');
  need(evidence?.schema==='scf82.checkout-evidence.v1'&&evidence.intentId===id.intentId&&
    evidence.observation?.intentId===id.intentId&&time(evidence.observedAt)&&
    Date.parse(evidence.observedAt)>=Date.parse(id.attemptCreatedAt),'NODE_EXPORT_EVIDENCE_BINDING');
  const returned=value.result;
  need(object(returned)&&returned.commandId===c.commandId&&returned.commandDirectory===c.commandDirectory&&
    returned.startedAt===c.startedAt&&object(returned.process),'NODE_EXPORT_RETURN_BINDING');
  const native=accountingOutput(c,returned.native);
  need(native.evidencePath===c.source.evidence.path&&native.recordAuthority===
    (native.kind==='UNPAID_RESPONSE'?'ORIGINAL_UNSIGNED_RESPONSE':'ORIGINAL_SF36_LEDGER_RESULT'),
    'NODE_EXPORT_RESULT_AUTHORITY');
  let record=null,approved=null;
  if(native.kind==='UNPAID_RESPONSE'){
    const original={outcome:'NO_PAYMENT_REQUIRED',actualAtomicUnits:null,receipt:null,requestSha256:null,
      completedAt:evidence.observedAt,lastFinalized:null,
      recordAuthority:'ORIGINAL_UNSIGNED_RESPONSE; NO_LEDGER_FINALIZATION_ASSERTED'};
    need(evidence.operatorReservation===null&&evidence.observedAt===evidence.observation.observedAt&&
      analyzeOne(evidence.observation).status==='NO_PAYMENT_REQUIRED'&&
      sameAccountingValue(native.result,original),'NODE_EXPORT_UNPAID_RESULT_BINDING');
  }else{
    record=originalRecordFromEvidence(evidence);
    checkOriginalTerms(record,native.operator?.payer);
    approved=record.operatorReservation.approved_request;
    need(object(approved)&&record.operatorReservation.request_sha256===native.approvedRequestSha256&&
      approved.request_id===id.intentId&&approved.actor===native.operator.actor&&
      approved.service===native.operator.service&&approved.body_present===id.bodyPresent&&
      approved.body_bytes===id.bodyBytes&&approved.body_sha256===id.bodySha256&&
      ['scheme','network','asset'].every(k=>approved[k]===record.requirement[k])&&
      approved.pay_to===record.requirement.payTo&&approved.max_amount===record.requirement.amount,
      'NODE_EXPORT_APPROVED_REQUEST_BINDING');
    if(['FINALIZED','IDEMPOTENT_FINALIZED'].includes(native.result.outcome)){
      need(native.result.actual===approved.max_amount&&
        native.result.receipt_ref===approved.network+'/'+record.receipt.transaction&&
        HASH.test(native.result.proof_sha256??'')&&
        native.result.chainObservation===(native.result.outcome==='FINALIZED'?
          'FRESH_ORIGINAL_SF86_RPC':'ORIGINAL_AUDITED_FINALIZATION_REUSED'),
        'NODE_EXPORT_SETTLED_RESULT_BINDING');
    }
  }
  // The source identity is one original operation/attempt; selecting a later
  // finalization command does not create another financial source.
  const sourceIdentity={intentId:id.intentId,operationSha256:id.operationSha256,
    configurationSha256:id.configurationSha256,bodyPresent:id.bodyPresent,bodyBytes:id.bodyBytes,
    bodySha256:id.bodySha256,ticketSha256:id.ticketSha256,attemptCreatedAt:id.attemptCreatedAt};
  return {schema:NODE_ACCOUNTING_INSPECTION,sourceSha256:digest(raw),sourceBytes:raw.length,
    sourceIdentity,sourceIdentitySha256:digest(jsonBytes(sourceIdentity)),intentId:id.intentId,
    commandId:c.commandId,contextSha256:value.contextSha256,startedAt:c.startedAt,
    sourceObservedAt:evidence.observedAt,attemptCreatedAt:id.attemptCreatedAt,
    native,approvedRequest:approved,originalRecord:record,
    observation:structuredClone(evidence.observation),
    attemptResult:metadata(attempt.result),attemptState:attempt.state,
    source:{attempt:metadata(c.source.attempt),evidence:metadata(c.source.evidence)},
    authority:value.authority};
}
async function main(){
  need(process.argv.length===2,'NODE_EXPORT_FIXED_STDIN_ONLY');
  const chunks=[];let bytes=0;
  for await(const chunk of process.stdin){bytes+=chunk.length;need(bytes<=MAX_NODE_ACCOUNTING_BYTES,'NODE_EXPORT_SIZE');chunks.push(chunk);}
  process.stdout.write(jsonBytes(inspectNodeAccountingExport(Buffer.concat(chunks))));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??'NODE_EXPORT_INVALID',message:error.message})+'\n');process.exitCode=2;});
