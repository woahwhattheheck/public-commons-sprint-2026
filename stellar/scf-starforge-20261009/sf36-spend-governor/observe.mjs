// MIT. Private SF36 worker adapter: original SF86 observer and SF98 outbox only.
import {createHash} from 'node:crypto';
import {createOfficialEventDecoder} from '../sf43-agent-commerce/verify.mjs';
import {reconcileRpc} from '../sf86-rpc-transfer-reconcile/verify.mjs';
import {originalRecordFromEvidence} from '../sf86-rpc-transfer-reconcile/cli.mjs';
import {openOutbox} from '../sf98-merchant-delivery/outbox.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
let size=0;const chunks=[];
try {
  for await(const chunk of process.stdin) {
    size+=chunk.length;
    if(size>4_100_000)throw new Error('INPUT_TOO_LARGE');
    chunks.push(chunk);
  }
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const record=input.source?.schema==='scf82.checkout-evidence.v1'?
    originalRecordFromEvidence(input.source):input.source;
  if(input.action==='observe') {
    // Endpoint, decoder and fetch are fixed original production dependencies.
    // Saved verdicts and loopback replay cannot reach the privileged worker.
    const decodeContractEvent=await createOfficialEventDecoder();
    console.log(JSON.stringify(await reconcileRpc({record,payer:input.payer,decodeContractEvent})));
  } else if(input.action==='merchant') {
    const rows=await (await openOutbox(input.outbox)).rows();
    const request=record.operatorReservation.approved_request;
    const fingerprint=sha(record.receipt.transaction);
    const candidates=rows.filter(({event:e})=>e.transactionFingerprint===fingerprint);
    const matched=candidates.filter(({event:e})=>
      e.schema==='stellar-forge.sf98.delivery-event.v1'&&
      e.authority==='ORIGINAL_NATIVE_PROCESS_SETTLEMENT_SUCCESS'&&
      e.routeId===input.route&&e.method===request.method&&
      e.network===request.network&&e.amountAtomic===request.max_amount&&
      e.assetDigest===sha(request.asset)&&
      e.id===sha(['sf98.v1',e.routeId,e.method,e.network,fingerprint].join('\n')));
    const row=matched.length===1?matched[0]:null;
    console.log(JSON.stringify({
      status:matched.length>1?'AMBIGUOUS_NATIVE_EVENTS':row?
        (row.state?.state==='DELIVERED'?'MERCHANT_INBOX_ACCEPTED':'NATIVE_EVENT_AWAITING_INBOX'):
        candidates.length?'MERCHANT_TERMS_MISMATCH':'NATIVE_EVENT_RECOVERY_REQUIRED',
      ...(row?{eventId:row.event.id,orderReference:row.event.orderReference,
        callbackState:row.state?.state??'PENDING'}:{}),
      customerFulfillment:'NOT_ESTABLISHED_BY_CALLBACK',
    }));
  } else throw new Error('UNKNOWN_ACTION');
} catch(error) {
  // Never echo source JSON, environment, customer payload or module-load paths.
  console.log(JSON.stringify({error:error?.code??'ORIGINAL_ADAPTER_FAILED'}));
  process.exitCode=2;
}
