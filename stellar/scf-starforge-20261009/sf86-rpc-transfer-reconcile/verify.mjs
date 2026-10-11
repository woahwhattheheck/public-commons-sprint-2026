import {checkOriginalTerms, checkReportedTerms, checkPaymentAttemptTerms, requireTruth, digest, rpcNetwork, object,
  ReconciliationError} from './terms.mjs';
import {rpc} from './rpc-transport.mjs';
export {validStrKey,ReconciliationError,DEFAULT_RPC} from './terms.mjs';
const EVENT_PAGE_LIMIT=200;
export async function reconcileRpc({record,payer,...options} = {}) {
  const terms=checkOriginalTerms(record,payer);
  return reconcileTransfer({...options,...terms,payer,reservation:'UNCHANGED_VERIFY_SEPARATELY'});
}
export async function reconcileReportedReceipt({intentId,requirement,receipt,payer,...options}={}) {
  const terms=checkReportedTerms({intentId,requirement,receipt},payer);
  return reconcileTransfer({...options,...terms,payer,reservation:'ABSENT_NO_SF81_RECORD',
    origin:'RECOVERED_ORIGINAL_SF31_OUTCOME'});
}
// Only this new report uses sorted-key JSON digests; legacy reconciliation
// reports keep their original digest convention and return shape unchanged.
const canonicalRpcDigest=value=>{
  const ordered=v=>Array.isArray(v)?v.map(ordered):object(v)?
    Object.fromEntries(Object.keys(v).sort().map(key=>[key,ordered(v[key])])):v;
  return digest(ordered(value));
};
function reportedAttempt(receipt) {
  if (receipt === null) return null;
  const error=receipt.errorReason;
  const message=receipt.errorMessage;
  const truncated=new Set(receipt.truncatedFields ?? []);
  if (error?.length > 1024) truncated.add('errorReason');
  if (message?.length > 4096) truncated.add('errorMessage');
  return {success:receipt.success, network:receipt.network,
    ...(receipt.payer === undefined ? {} : {payer:receipt.payer}),
    transaction:receipt.transaction ?? null,
    errorReason:error == null ? null : error.slice(0,1024),
    ...(message === undefined ? {} : {errorMessage:message === null ? null : message.slice(0,4096)}),
    ...(truncated.has('errorReason') || receipt.errorReasonTruncated === true ? {errorReasonTruncated:true} : {}),
    ...(truncated.has('errorMessage') || receipt.errorMessageTruncated === true ? {errorMessageTruncated:true} : {}),
    ...(truncated.size ? {truncatedFields:[...truncated]} : {})};
}
/**
 * Observe a retained payment attempt. The optional transaction is an explicit
 * operator reference for a legacy missing hash, never a replacement receipt.
 * This operation does not sign, retry, change a quote or post accounting.
 */
export async function reconcilePaymentAttempt({intentId,requirement,receipt,payer,transaction,
  fetchImpl=fetch,decodeContractEvent,rpcEndpoint,maxEventPages=24,signal}={}) {
  const checked=checkPaymentAttemptTerms({intentId,requirement,receipt,transaction},payer);
  const {requirement:q,receipt:r,transaction:hash,transactionSource}=checked;
  const profile=rpcNetwork(q.network,rpcEndpoint);
  requireTruth(typeof fetchImpl === 'function', 'RPC_TRANSPORT_REQUIRED');
  requireTruth(signal === undefined || signal instanceof AbortSignal, 'INVALID_RECONCILIATION_SIGNAL');
  requireTruth(Number.isSafeInteger(maxEventPages) && maxEventPages >= 1 &&
    maxEventPages <= 100, 'INVALID_EVENT_PAGE_BUDGET');
  const readRpc=(method,params)=>rpc(method,params,profile.endpoint,fetchImpl,{signal});
  const networkResult=await readRpc('getNetwork',{});
  requireTruth(networkResult.passphrase === profile.passphrase, 'RPC_NETWORK_PASSPHRASE_MISMATCH');
  const tx=await readRpc('getTransaction',{hash});
  requireTruth(['SUCCESS','FAILED','NOT_FOUND'].includes(tx.status), 'RPC_TRANSACTION_STATUS_UNRECOGNIZED');
  if (tx.status === 'NOT_FOUND') {
    requireTruth(tx.txHash === undefined || tx.txHash === hash, 'RPC_TRANSACTION_HASH_MISMATCH');
  } else {
    requireTruth(tx.txHash === hash, 'RPC_TRANSACTION_HASH_MISMATCH');
    requireTruth(Number.isSafeInteger(tx.ledger) && tx.ledger > 0, 'RPC_TRANSACTION_LEDGER_INVALID');
  }
  const report={schema:'stellar-forge.sf86.payment-attempt.v1',
    outcome:tx.status === 'SUCCESS' ? 'TRANSFER_MATCHED' : tx.status,
    network:q.network, transaction:hash, transactionSource, intentId:checked.intentId,
    asset:q.asset, payer, recipient:q.payTo, atomicAmount:q.amount,
    rpcEndpoint:profile.endpoint, source:profile.live?profile.source:'127.0.0.1-loopback',
    networkResultSha256:canonicalRpcDigest(networkResult),
    transactionResultSha256:canonicalRpcDigest(tx),
    ledger:tx.status === 'NOT_FOUND' ? null : tx.ledger, rpcStatus:tx.status,
    reported:reportedAttempt(r), reservation:'UNCHANGED', retryAuthorization:'NONE'};
  if (tx.status !== 'SUCCESS') return report;
  requireTruth(typeof decodeContractEvent === 'function', 'STELLAR_SDK_DECODER_REQUIRED');
  const transfer=await verifyTransactionTransfer({intentId:checked.intentId,q,transaction:hash,payer,
    decodeContractEvent,profile,rpcEndpoint:profile.endpoint,maxEventPages,networkResult,tx,readRpc,
    reservation:'UNCHANGED_VERIFY_SEPARATELY',origin:'ORIGINAL_PAYMENT_ATTEMPT_RECONCILIATION',
    sellerReport:r === null ? 'ORIGINAL_RECEIPT_UNAVAILABLE' : r.success ? 'REPORTED_SUCCESS' : 'REPORTED_FAILURE',
    limitation:'Verified transfer for the recorded transaction reference; original intent binding and accounting remain separate.'});
  return {...report,transfer};
}
async function reconcileTransfer({intentId,requirement:q,receipt:r,payer,fetchImpl=fetch,
  decodeContractEvent,rpcEndpoint,maxEventPages=24,signal,reservation,origin}) {
  const profile=rpcNetwork(q.network,rpcEndpoint),{live}=profile;
  rpcEndpoint=profile.endpoint;
  const readRpc=(method,params)=>rpc(method,params,rpcEndpoint,fetchImpl,{signal});
  requireTruth(Number.isSafeInteger(maxEventPages) && maxEventPages >= 1 &&
    maxEventPages <= 100, 'INVALID_EVENT_PAGE_BUDGET');
  requireTruth(typeof decodeContractEvent === 'function', 'STELLAR_SDK_DECODER_REQUIRED');
  let networkResult;
  if(live) {
    networkResult=await readRpc('getNetwork',{});
    requireTruth(networkResult.passphrase === profile.passphrase, 'RPC_NETWORK_PASSPHRASE_MISMATCH');
  }
  const tx=await readRpc('getTransaction',{hash:r.transaction});
  requireTruth(tx.status === 'SUCCESS' && tx.txHash === r.transaction &&
    Number.isSafeInteger(tx.ledger) && tx.ledger > 0, 'TX_NOT_CONFIRMED_SUCCESS');
  return verifyTransactionTransfer({intentId,q,transaction:r.transaction,payer,decodeContractEvent,
    profile,rpcEndpoint,maxEventPages,networkResult,tx,readRpc,reservation,origin,
    sellerReport:r.success?'REPORTED_SUCCESS':'SETTLEMENT_PENDING'});
}
async function verifyTransactionTransfer({intentId,q,transaction,payer,decodeContractEvent,profile,
  rpcEndpoint,maxEventPages,networkResult,tx,readRpc,reservation,origin,sellerReport,
  limitation='Verified transfer for seller-reported hash; original HTTP intent binding and accounting remain separate.'}) {
  const {live}=profile;
  let cursor=null, previousCursor=null, count=0, matchedId=null;
  let eventPages=0, reachedEnd=false, lastLedger=tx.ledger;
  const seenIds=new Set(); const eventHashes=[];
  for (let i=0; i<maxEventPages; i++) {
    const params={...(cursor ? {} : {startLedger:tx.ledger,endLedger:tx.ledger+1}),
      filters:[{type:'contract',contractIds:[q.asset]}],
      pagination:{limit:EVENT_PAGE_LIMIT,...(cursor ? {cursor} : {})}};
    const out=await readRpc('getEvents',params);
    eventPages++;
    requireTruth(Array.isArray(out.events), 'EVENTS_SHAPE_UNRECOGNIZED');
    requireTruth(out.latestLedger === undefined ||
      (Number.isSafeInteger(out.latestLedger) && out.latestLedger >= tx.ledger),
    'EVENT_INDEX_NOT_CAUGHT_UP');
    eventHashes.push(digest(out));
    for(const event of out.events) {
      requireTruth(object(event) && Number.isSafeInteger(event.ledger) && event.ledger >= lastLedger,
        'EVENT_ORDER_UNRECOGNIZED');
      lastLedger=event.ledger;
      if(event.ledger > tx.ledger) { reachedEnd=true; break; }
      if(event.txHash !== transaction || event.contractId !== q.asset) continue;
      if(event.inSuccessfulContractCall === false) continue;
      requireTruth(typeof event.id === 'string' && event.id.length > 0 && !seenIds.has(event.id),
        'TARGET_EVENT_ID_INVALID_OR_DUPLICATE');
      seenIds.add(event.id);
      let decoded;
      try { decoded=await decodeContractEvent(event); }
      catch { throw new ReconciliationError('TARGET_EVENT_DECODING_FAILED'); }
      if (decoded?.name !== 'transfer') continue;
      if(decoded.from === payer && decoded.to === q.payTo &&
         decoded.amount === q.amount) { count++; matchedId=event.id; }
      requireTruth(count <= 1, 'AMBIGUOUS_TRANSFERS');
    }
    if(reachedEnd) break;
    // Stellar RPC also returns a cursor after exhausting its scan window. A
    // short page with an index caught up to this transaction covers its whole
    // ledger; full pages still need pagination to rule out another transfer.
    if(out.events.length < EVENT_PAGE_LIMIT &&
      Number.isSafeInteger(out.latestLedger) && out.latestLedger >= tx.ledger) {
      reachedEnd=true; break;
    }
    const next=out.cursor ?? out.pagination?.cursor ?? null;
    if (!next) { reachedEnd=true; break; }
    requireTruth(typeof next === 'string' && next !== cursor && next !== previousCursor,
      'EVENT_CURSOR_INVALID');
    requireTruth(out.events.length > 0, 'EMPTY_PAGE_WITH_CURSOR');
    previousCursor=cursor; cursor=next;
  }
  requireTruth(reachedEnd, 'EVENT_PAGE_BUDGET_EXHAUSTED');
  requireTruth(count === 1, 'NO_EXACT_TRANSFER');
  return {schema:'stellar-forge.sf86.rpc-reconciliation.v1',
    verdict:live?profile.verdict:'LOCAL_RPC_REPLAY_MATCHED',
    source:live?profile.source:'127.0.0.1-loopback',
    rpcEndpoint, ...(live?{networkPassphrase:profile.passphrase,
      networkResultSha256:digest(networkResult)}:{}),
    intentId,transaction,network:q.network,ledger:tx.ledger,
    asset:q.asset,payer,recipient:q.payTo,atomicAmount:q.amount,
    matchingTransfers:1,matchingEventId:matchedId,eventPages,
    transactionResultSha256:digest(tx),eventPageSha256:eventHashes,
    sellerReport,
    reservation,...(origin?{origin}:{}),
    limitation};
}

