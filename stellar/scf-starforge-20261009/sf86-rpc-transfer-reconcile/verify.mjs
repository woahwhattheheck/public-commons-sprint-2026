import {checkOriginalTerms, requireTruth, digest, DEFAULT_RPC, LOCAL_RPC, object, ReconciliationError} from './terms.mjs';
import {rpc} from './rpc-transport.mjs';
export {validStrKey,ReconciliationError,DEFAULT_RPC} from './terms.mjs';
export async function reconcileRpc({record,payer,fetchImpl=fetch,decodeContractEvent,
  rpcEndpoint=DEFAULT_RPC,maxEventPages=24} = {}) {
  const {intentId, requirement:q, receipt:r}=checkOriginalTerms(record,payer);
  requireTruth(rpcEndpoint === DEFAULT_RPC || LOCAL_RPC.test(rpcEndpoint), 'RPC_ENDPOINT_NOT_ALLOWED');
  requireTruth(Number.isSafeInteger(maxEventPages) && maxEventPages >= 1 &&
    maxEventPages <= 100, 'INVALID_EVENT_PAGE_BUDGET');
  requireTruth(typeof decodeContractEvent === 'function', 'STELLAR_SDK_DECODER_REQUIRED');
  const tx=await rpc('getTransaction',{hash:r.transaction},rpcEndpoint,fetchImpl);
  requireTruth(tx.status === 'SUCCESS' && tx.txHash === r.transaction &&
    Number.isSafeInteger(tx.ledger) && tx.ledger > 0, 'TX_NOT_CONFIRMED_SUCCESS');
  let cursor=null, previousCursor=null, count=0, matchedId=null;
  let eventPages=0, reachedEnd=false, lastLedger=tx.ledger;
  const seenIds=new Set(); const eventHashes=[];
  for (let i=0; i<maxEventPages; i++) {
    const params={...(cursor ? {} : {startLedger:tx.ledger}),
      filters:[{type:'contract',contractIds:[q.asset]}],
      pagination:{limit:200,...(cursor ? {cursor} : {})}};
    const out=await rpc('getEvents',params,rpcEndpoint,fetchImpl);
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
      if(event.txHash !== r.transaction || event.contractId !== q.asset) continue;
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
    const next=out.cursor ?? out.pagination?.cursor ?? null;
    if (!next) { reachedEnd=true; break; }
    requireTruth(typeof next === 'string' && next !== cursor && next !== previousCursor,
      'EVENT_CURSOR_INVALID');
    requireTruth(out.events.length > 0, 'EMPTY_PAGE_WITH_CURSOR');
    previousCursor=cursor; cursor=next;
  }
  requireTruth(reachedEnd, 'EVENT_PAGE_BUDGET_EXHAUSTED');
  requireTruth(count === 1, 'NO_EXACT_TRANSFER');
  const live=rpcEndpoint === DEFAULT_RPC;
  return {schema:'stellar-forge.sf86.rpc-reconciliation.v1',
    verdict:live?'CHAIN_TRANSFER_MATCHED_RPC_TESTNET':'LOCAL_RPC_REPLAY_MATCHED',
    source:live?'official-stellar-testnet-rpc':'127.0.0.1-loopback',
    intentId,transaction:r.transaction,network:q.network,ledger:tx.ledger,
    asset:q.asset,payer,recipient:q.payTo,atomicAmount:q.amount,
    matchingTransfers:1,matchingEventId:matchedId,eventPages,
    transactionResultSha256:digest(tx),eventPageSha256:eventHashes,
    sellerReport:r.success?'REPORTED_SUCCESS':'SETTLEMENT_PENDING',
    reservation:'UNCHANGED_VERIFY_SEPARATELY',
    limitation:'Verified transfer for seller-reported hash; original HTTP intent binding and accounting remain separate.'};
}
