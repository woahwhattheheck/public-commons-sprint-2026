// MIT — SCF SF82: one original approved buyer attempt to independently observed evidence.
// Trusted operator-host adapter; not an agent-facing signer, new payment controller or ledger.
import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { checkStellarTestnetTransaction, createOfficialEventDecoder } from '../sf43-agent-commerce/verify.mjs';
import { captureBuyerResult, captureBuyerError, aggregateOutcomes } from '../sf52-buyer-outcomes/outcomes.mjs';
import { sf81ReconciliationRecord } from '../sf82-chain-transfer-reconcile/record.mjs';

const tag = /^[A-Za-z0-9._:-]{1,128}$/; // Original SF52 observation identity limit.
const payer = /^[GC][A-Z2-7]{55}$/;
const digest = s => createHash('sha256').update(s).digest('hex');
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

async function bodyEvidence(response, maxBytes, timeoutMs) {
  if (!response || typeof response.clone !== 'function' || !Number.isInteger(response.status) ||
      response.status < 200 || response.status >= 300) return { status: 'NO_SUCCESSFUL_HTTP_BODY' };
  let clone;
  try { clone = response.clone(); } catch { return { status: 'BODY_NOT_CLONEABLE' }; }
  if (!clone.body || typeof clone.body.getReader !== 'function') return { status: 'NO_BODY_STREAM' };
  const hash = createHash('sha256');
  const reader = clone.body.getReader();
  let size = 0, timer;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  try {
    for (;;) {
      // The race also handles late read rejection after a timeout; no ignored
      // read can become an unhandled rejection after evidence is returned.
      const next = await Promise.race([reader.read(), deadline]);
      if (next.timedOut) return { status: 'BODY_CAPTURE_TIMED_OUT', timeoutMs };
      const { done, value } = next;
      if (done) return { status: 'HTTP_BODY_OBSERVED', httpStatus: response.status,
        bodySha256: hash.digest('hex'), bodyBytes: size };
      if (!(value instanceof Uint8Array)) return { status: 'INVALID_BODY_CHUNK' };
      size += value.byteLength;
      if (size > maxBytes) return { status: 'BODY_OVER_LIMIT', limitBytes: maxBytes };
      hash.update(value);
    }
  } catch { return { status: 'BODY_READ_FAILED' }; }
  finally {
    clearTimeout(timer);
    try { void reader.cancel().catch(() => {}); } catch {}
    try { reader.releaseLock(); } catch {}
  }
}

// SF81's reservation is already durable in its original SF36 ledger. Export ONLY
// fixed non-secret fields; never persist operator policy, TTY transcript or wallet.
function reservationMetadata(raw) {
  if (!isObject(raw)) return null;
  const r = {};
  for (const [from, to] of [['outcome', 'outcome'], ['request_id','requestId'],
    ['network','network'], ['reserved_atomic_units','reservedAtomicUnits']]) {
    const v = raw[from];
    if (typeof v === 'string' && v.length <= 160) r[to] = v;
  }
  return Object.keys(r).length ? r : null;
}

/**
 * Invoke original SF81 exactly once; feed original SF31 result to SF52, and a
 * genuine compatible testnet receipt to ORIGINAL SF43 RPC/SEP-41 verification.
 *
 * buyer: the trusted host's existing OperatorApprovedBuyer (no new approval).
 * call:  exact existing SF81 call options, including trusted signer and intentId.
 * outputDir: pre-existing private absolute directory, chosen by the operator.
 * trustedPayer: actual payer returned/bound by the trusted signer, never seller data.
 * decodeContractEvent: original createOfficialEventDecoder() or trusted SDK decoder.
 * captureBody: bounded opt-in body-hash from cloned successful HTTP Response.
 * rpcEndpoint/rpcFetch: SF43's own restricted endpoint and HTTP implementation;
 *                     loopback override is intended ONLY for focused local tests.
 * Returns {result,error,evidencePath,report}. Never blindly retries a signed call.
 */
export async function executeWithEvidence({buyer, call, outputDir, trustedPayer,
  decodeContractEvent, rpcEndpoint, rpcFetch, captureBody = false,
  maxBodyBytes = 1_048_576, bodyCaptureTimeoutMs = 15000,
  observedAt = new Date().toISOString()} = {}) {
  if (!isObject(buyer) || typeof buyer.call !== 'function' || !isObject(call) ||
      typeof call.intentId !== 'string' || !tag.test(call.intentId))
    throw new TypeError('TRUSTED_BUYER_AND_STABLE_INTENT_REQUIRED');
  if (typeof outputDir !== 'string' || !isAbsolute(outputDir) || outputDir.includes('\0'))
    throw new TypeError('ABSOLUTE_PRIVATE_EVIDENCE_DIRECTORY_REQUIRED');
  if (trustedPayer !== undefined && (typeof trustedPayer !== 'string' || !payer.test(trustedPayer)))
    throw new TypeError('TRUSTED_STELLAR_PAYER_INVALID');
  if (decodeContractEvent !== undefined && typeof decodeContractEvent !== 'function')
    throw new TypeError('DECODER_MUST_BE_TRUSTED_FUNCTION');
  if (rpcFetch !== undefined && typeof rpcFetch !== 'function') throw new TypeError('RPC_FETCH_INVALID');
  if (typeof captureBody !== 'boolean' || !Number.isSafeInteger(maxBodyBytes) ||
      maxBodyBytes < 1 || maxBodyBytes > 8_388_608)
    throw new TypeError('BODY_CAPTURE_LIMIT_INVALID');
  if (!Number.isSafeInteger(bodyCaptureTimeoutMs) || bodyCaptureTimeoutMs < 1 || bodyCaptureTimeoutMs > 60000)
    throw new TypeError('BODY_CAPTURE_TIMEOUT_INVALID');
  // Validate original SF52's exact timestamp contract before a buyer can sign.
  // This preflight observation is never persisted as an actual buyer attempt.
  captureBuyerError({intentId:call.intentId,error:{paymentSent:false,code:'EVIDENCE_PREFLIGHT'},observedAt});
  const directory = await stat(outputDir);
  if (!directory.isDirectory()) throw new TypeError('EVIDENCE_PATH_NOT_DIRECTORY');
  const evidencePath = join(outputDir, digest(call.intentId) + '.json');
  // Fail before invoking a signer when this exact intent already has a terminal
  // report. Cross-process paid-attempt uniqueness remains SF36's original job.
  try {
    await stat(evidencePath);
    throw new Error('TERMINAL_EVIDENCE_ALREADY_EXISTS_USE_EXISTING_SF36_LEDGER');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  let result = null, error = null;
  try { result = await buyer.call(call); }
  catch (e) { error = e; }
  // Retain the original approved record while it is still available. The
  // smaller SF52 observation/reservation summary cannot reconstruct this later.
  let reconciliation = {status:'UNAVAILABLE', reason:'NO_ELIGIBLE_ORIGINAL_SF81_RESULT'};
  if (!error) {
    try { reconciliation = {status:'AVAILABLE', record:sf81ReconciliationRecord(result)}; }
    catch { /* Free, unsupported or incomplete outcomes retain no invented record. */ }
  }
  // The error adapter conservatively marks errors with UNKNOWN paymentSent as
  // potentially signed, not an unapproved, safely repeatable operation.
  const observedError = error && typeof error.paymentSent !== 'boolean' ?
    { paymentSent: true, code: 'UNKNOWN_EXECUTION_PHASE' } : error;
  const base = error ? captureBuyerError({intentId:call.intentId,error:observedError,observedAt}) :
    captureBuyerResult(result,{observedAt});
  let chain = null, delivery = null;
  let bodyCapture = {status:captureBody ? 'NO_SUCCESSFUL_PAID_BODY' : 'NOT_REQUESTED'};
  if (!error) {
    if (captureBody && base.buyer.requirement) {
      const candidate = await bodyEvidence(result.response,maxBodyBytes,bodyCaptureTimeoutMs);
      bodyCapture = candidate;
      if (candidate.status === 'HTTP_BODY_OBSERVED') {
        delivery = {status:candidate.status,httpStatus:candidate.httpStatus,
          bodySha256:candidate.bodySha256};
      }
    }
    // Seller receipt alone cannot prove a transfer. SF43 queries ORIGINAL
    // Stellar testnet RPC and validates a canonical transfer event when present.
    const terms = base.buyer.requirement, receipt = base.buyer.receipt;
    if (trustedPayer && terms?.network === 'stellar:testnet' &&
        receipt?.success === true && receipt.network === 'stellar:testnet' &&
        /^[0-9a-f]{64}$/.test(receipt.transaction || '')) {
      let decoder = decodeContractEvent;
      if (!decoder) {
        try { decoder = await createOfficialEventDecoder(); }
        catch { decoder = undefined; } // SF43 still checks tx inclusion; never claims a matched transfer.
      }
      chain = await checkStellarTestnetTransaction({
        receipt: { ...receipt, payer: trustedPayer },
        expected: { network:'stellar:testnet', asset:terms.asset, payTo:terms.payTo,
          amount:terms.amount, payer:trustedPayer },
        ...(decoder ? {decodeContractEvent:decoder} : {}),
        ...(rpcEndpoint !== undefined ? {rpcEndpoint} : {}),
        ...(rpcFetch !== undefined ? {fetchImpl:rpcFetch} : {}),
      });
    }
  }
  const observation = {...base, ...(chain ? {chain} : {}), ...(delivery ? {delivery} : {})};
  const report = aggregateOutcomes([observation]);
  const envelope = {
    schema:'scf82.checkout-evidence.v1', intentId:call.intentId, observedAt,
    operatorReservation:reservationMetadata(result?.operatorReservation ?? error?.operatorReservation),
    observation, report, bodyCapture, reconciliation,
    notes:'Independent testnet proof is credited only by original SF43. No seller receipt, HTTP response, or local simulator equals a payment, customer, grant or revenue claim.',
  };
  // Create-only terminal evidence. Never overwrite/release reservations after
  // crashed sends, lost replies, partial writes or duplicate intent collisions.
  const handle = await open(evidencePath,'wx',0o600);
  try { await handle.writeFile(JSON.stringify(envelope,null,2) + '\n','utf8'); await handle.sync(); }
  finally { await handle.close(); }
  return { result, error, evidencePath, report };
}
