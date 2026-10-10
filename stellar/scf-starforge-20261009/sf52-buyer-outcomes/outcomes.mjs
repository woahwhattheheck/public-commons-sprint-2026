/**
 * MIT — SCF SF52: source-contract adapter for SF31 buyer + SF43 Stellar testnet verifier.
 * Pure interpretation: no wallet, signer, provider request, paid retry or funds transfer.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const VERSION = 'scf52.buyer-outcome.v1';
const STATES = new Set(['NO_PAYMENT_REQUIRED', 'DELIVERED_REPORTED_SETTLED',
  'SETTLEMENT_PENDING', 'PAYMENT_REPORTED_FAILED', 'PAYMENT_OUTCOME_UNKNOWN',
  'BLOCKED_BEFORE_SIGNATURE']);
const MAX_I128 = 170141183460469231731687303715884105727n;
const hash = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const tag = v => typeof v === 'string' && /^[\w.:-]{1,128}$/.test(v);
const amount = v => typeof v === 'string' && /^[1-9][0-9]*$/.test(v) && BigInt(v) <= MAX_I128;
function requireOk(ok, code) { if (!ok) throw new TypeError(code); }
function date(v) {
  const d = typeof v === 'string' ? new Date(v) : null;
  requireOk(d && !Number.isNaN(d.valueOf()) && d.toISOString() === v, 'OBSERVATION_TIME_INVALID');
  return v;
}
function terms(v) {
  requireOk(obj(v) && v.scheme === 'exact' &&
    ['stellar:testnet', 'stellar:pubnet'].includes(v.network) &&
    typeof v.asset === 'string' && v.asset.length > 0 && v.asset.length <= 128 &&
    typeof v.payTo === 'string' && v.payTo.length > 0 && v.payTo.length <= 128 &&
    amount(v.amount), 'BUYER_PAYMENT_TERMS_INVALID');
  return { scheme:v.scheme, network:v.network, asset:v.asset,
    payTo:v.payTo, amount:v.amount };
}

/** Transform a real SF31 result object to a serializable, non-secret observation.
 * Never serialize `Response`, signed headers, challenge, signer, body, or error cause.
 */
export function captureBuyerResult(buyer, { observedAt = new Date().toISOString() } = {}) {
  requireOk(obj(buyer) && STATES.has(buyer.status) && tag(buyer.intentId), 'BUYER_RESULT_INVALID');
  const accepted = buyer.requirement ? terms(buyer.requirement) : null;
  requireOk(Number.isSafeInteger(buyer.attempts) && buyer.attempts >= 1 && buyer.attempts <= 2,
    'BUYER_ATTEMPTS_INVALID');
  requireOk(Number.isSafeInteger(buyer.httpStatus) && buyer.httpStatus >= 100 && buyer.httpStatus <= 599,
    'BUYER_HTTP_STATUS_INVALID');
  if (buyer.status === 'NO_PAYMENT_REQUIRED') {
    requireOk(accepted === null && buyer.settlement === 'NOT_REQUESTED' && buyer.attempts === 1,
      'FREE_RESULT_INCONSISTENT');
  } else {
    requireOk(accepted !== null && buyer.attempts === 2, 'PAID_RESULT_MISSING_SIGNED_ATTEMPT');
  }
  const receipt = buyer.receipt && obj(buyer.receipt) ? {
    success: buyer.receipt.success === true,
    network: typeof buyer.receipt.network === 'string' ? buyer.receipt.network : null,
    transaction: typeof buyer.receipt.transaction === 'string' ? buyer.receipt.transaction : null,
  } : null;
  return Object.freeze({ intentId:buyer.intentId, observedAt:date(observedAt),
    buyer:{ status:buyer.status, attempts:buyer.attempts, httpStatus:buyer.httpStatus,
      settlement:buyer.settlement??null, requirement:accepted, receipt,
      reason: typeof buyer.reason === 'string' ? buyer.reason.slice(0,128) : null }});
}

/** SF31 BuyerError may be thrown after the signed request was sent. Preserve that
 * distinction without copying the error's potentially sensitive cause/stack.
 */
export function captureBuyerError({ intentId, error, observedAt = new Date().toISOString() }) {
  requireOk(tag(intentId) && obj(error) && typeof error.paymentSent === 'boolean', 'BUYER_ERROR_INVALID');
  return Object.freeze({ intentId, observedAt:date(observedAt), buyer:{
    status:error.paymentSent ? 'PAYMENT_OUTCOME_UNKNOWN' : 'BLOCKED_BEFORE_SIGNATURE',
    attempts:error.paymentSent ? 2 : 0, httpStatus:null, settlement:'UNKNOWN',
    requirement:null, receipt:null, reason:tag(error.code) ? error.code : 'BUYER_ERROR' }});
}

/** Interpret normalized outcomes. A positive seller HTTP/receipt is NOT an on-chain
 * transfer; SF43 proves only exact Stellar testnet transfer, not resource usefulness.
 */
export function analyzeOne(record) {
  requireOk(obj(record) && tag(record.intentId) && date(record.observedAt), 'RECORD_INVALID');
  const b=record.buyer;
  requireOk(obj(b) && STATES.has(b.status), 'BUYER_STATE_INVALID');
  const t=b.requirement === null || b.requirement === undefined ? null : terms(b.requirement);
  const paid=b.attempts===2;
  requireOk(Number.isInteger(b.attempts) && b.attempts>=0 && b.attempts<=2, 'BAD_ATTEMPT_COUNT');
  const reported=b.status==='DELIVERED_REPORTED_SETTLED';
  const c=record.chain??null;
  const d=record.delivery??null;
  let state, evidence='NONE', ledger=null;
  if (b.status==='BLOCKED_BEFORE_SIGNATURE' || b.status==='NO_PAYMENT_REQUIRED') {
    requireOk(!c && !d && !t && !paid, 'NONPAYMENT_HAS_PAID_EVIDENCE');
    state=b.status;
  } else if (!t) {
    requireOk(b.status==='PAYMENT_OUTCOME_UNKNOWN' && !c && !d, 'UNKNOWN_TERMS_WITH_PROOF');
    state='SIGNED_RESULT_UNCERTAIN';
  } else if (!paid) {
    throw new TypeError('SIGNED_ATTEMPT_REQUIRED');
  } else {
    const receipt=b.receipt;
    const receiptValid=obj(receipt) && receipt.success===true &&
      receipt.network===t.network && hash(receipt.transaction);
    const chainPositive=obj(c) && c.status==='TOKEN_TRANSFER_MATCHED_TESTNET';
    const consistent=chainPositive && t.network==='stellar:testnet' && receiptValid &&
      c.proof==='RPC_TX_AND_SEP41_TRANSFER_EVENT_MATCH' &&
      c.network===t.network && c.transaction===receipt.transaction &&
      c.contractId===t.asset && c.recipient===t.payTo &&
      c.amountAtomic===t.amount && Number.isSafeInteger(c.ledger) && c.ledger>0;
    if (chainPositive && !consistent) state='PROOF_CONFLICT';
    else if (consistent) {
      evidence='MATCHED_SF43_TESTNET_TRANSFER'; ledger=c.ledger;
      const delivered=reported && obj(d) && d.status==='HTTP_BODY_OBSERVED' &&
        Number.isInteger(d.httpStatus) && d.httpStatus>=200 && d.httpStatus<300 &&
        hash(d.bodySha256);
      state=delivered?'TRANSFER_AND_HTTP_BODY_OBSERVED':'TRANSFER_VERIFIED_DELIVERY_UNCONFIRMED';
    } else if (c && !obj(c)) state='PROOF_CONFLICT';
    else if (reported && !receiptValid) state='SELLER_RECEIPT_CONFLICT';
    else if (reported) state='SELLER_REPORTED_ONLY';
    else if (b.status==='SETTLEMENT_PENDING') state='PENDING_RECONCILIATION';
    else if (b.status==='PAYMENT_REPORTED_FAILED') state='SELLER_REPORTED_FAILED';
    else state='SIGNED_RESULT_UNCERTAIN';
  }
  return Object.freeze({ intentId:record.intentId, observedAt:record.observedAt,
    status:state, network:t?.network??null, asset:t?.asset??null,
    amountAtomic:t?.amount??null, signedAttempt:paid, sellerReportedSuccess:reported,
    independentlyVerifiedTransfer:evidence==='MATCHED_SF43_TESTNET_TRANSFER',
    observedHttpBody:state==='TRANSFER_AND_HTTP_BODY_OBSERVED',
    chainEvidence:evidence, ledger });
}

/** Aggregate one terminal snapshot per intent: no duplicate revenue/event inflation.
 * Atomic units are grouped per network+asset, never mislabelled as USD or cash.
 */
export function aggregateOutcomes(records) {
  requireOk(Array.isArray(records) && records.length<=100_000, 'RECORDS_INVALID_OR_TOO_MANY');
  // A distinct intentId is not evidence of a distinct on-chain transfer. SF43
  // reports a matched event but does not expose an event index, so identical
  // transfer tuples must not be credited twice from a reused receipt.
  const seen=new Set(), seenChainProofs=new Set(), outcomes=[], byAsset=new Map();
  const counts={ total:0,signedAttempts:0,sellerReportedSuccess:0,verifiedTransfers:0,
    transferAndBodyObserved:0,proofConflicts:0,uncertainOrPending:0 };
  for(const record of records) {
    const result=analyzeOne(record);
    requireOk(!seen.has(result.intentId), 'DUPLICATE_INTENT_ID');seen.add(result.intentId);
    outcomes.push(result);counts.total++;
    if(result.signedAttempt)counts.signedAttempts++;
    if(result.sellerReportedSuccess)counts.sellerReportedSuccess++;
    if(result.status==='PROOF_CONFLICT'||result.status==='SELLER_RECEIPT_CONFLICT') counts.proofConflicts++;
    if(['SIGNED_RESULT_UNCERTAIN','PENDING_RECONCILIATION','SELLER_REPORTED_ONLY',
      'TRANSFER_VERIFIED_DELIVERY_UNCONFIRMED'].includes(result.status))counts.uncertainOrPending++;
    if(result.independentlyVerifiedTransfer) {
      const c=record.chain;
      const proofKey=JSON.stringify([result.network,c.transaction,result.asset,
        record.buyer.requirement.payTo,result.amountAtomic]);
      requireOk(!seenChainProofs.has(proofKey), 'DUPLICATE_CHAIN_TRANSFER_PROOF');
      seenChainProofs.add(proofKey);
      counts.verifiedTransfers++;
      const key=JSON.stringify([result.network,result.asset]);
      byAsset.set(key,(byAsset.get(key)||0n)+BigInt(result.amountAtomic));
    }
    if(result.observedHttpBody)counts.transferAndBodyObserved++;
  }
  return { schema:VERSION, generatedAt:new Date().toISOString(), counts,
    observedTransferAtomicByAsset:[...byAsset].sort(([a],[b])=>a.localeCompare(b)).map(([key,total])=>{
      const [network,asset]=JSON.parse(key);return {network,asset,atomicTotal:total.toString()};
    }), outcomes,
    interpretation:'Observed transfer amounts are testnet atomic units, NOT USD, booked revenue, customer satisfaction or an SCF funding result. HTTP body presence does not prove useful fulfillment.' };
}

export async function cli(args=process.argv.slice(2)) {
  requireOk(args.length===2 && args[0]==='--input','USAGE: node outcomes.mjs --input observations.json');
  const fs=await import('node:fs/promises');
  const stats=await fs.stat(args[1]);requireOk(stats.size<=8*1024*1024,'INPUT_TOO_LARGE');
  const records=JSON.parse(await readFile(args[1],'utf8'));
  process.stdout.write(JSON.stringify(aggregateOutcomes(records),null,2)+'\n');
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  cli().catch(e=>{console.error('SF52:',e.message);process.exitCode=2;});
