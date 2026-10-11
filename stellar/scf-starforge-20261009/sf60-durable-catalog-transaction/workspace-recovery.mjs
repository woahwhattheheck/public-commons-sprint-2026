// MIT. Recover original catalog effects from native append-only lifecycle history.
// This module never signs, submits, retires, retries, or writes a catalog/store.
import { createHash } from 'node:crypto';
import { requestCatalogOperator } from './operator.mjs';
import { validateCatalogEntry } from '../../../scf46-stellar-bazaar/src/catalog.mjs';
import { checkedRequest } from '../sf95-signed-seller-withdrawal/proof.mjs';
import { revisionTargetKey, revisionTargetsDigest, validateRevisionPage, MAX_REVISION_PAGE_BYTES } from './revision-snapshot.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw new TypeError(code); };
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const ISO = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const errorCode = error => /^[A-Z][A-Z0-9_]{0,159}$/.test(error?.message ?? '') ? error.message : 'NATIVE_CATALOG_READ_UNAVAILABLE';

function admissionIntent(input, index) {
  if (!object(input) || !ID.test(input.sellerId ?? '') || !Number.isSafeInteger(input.sequence) || input.sequence < 1 ||
      typeof input.sourceBase64 !== 'string' || input.sourceBase64.length > 87384 || !ISO(input.observedAt)) fail('ORIGINAL_ADMISSION_INPUT_REQUIRED');
  const bytes = Buffer.from(input.sourceBase64, 'base64');
  if (!bytes.length || bytes.length > 65536 || bytes.toString('base64') !== input.sourceBase64) fail('CANONICAL_ORIGINAL_SOURCE_BYTES_REQUIRED');
  let entry;
  try { entry = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('ORIGINAL_SOURCE_UTF8_JSON_REQUIRED'); }
  if (entry.x402Version !== 2) fail('ORIGINAL_V2_ADMISSION_REQUIRED');
  const { id: catalogKey } = validateCatalogEntry(entry);
  let source;
  try { source = new URL(input.sourceURL); } catch { fail('ORIGINAL_SOURCE_URL_REQUIRED'); }
  if (source.protocol !== 'https:' || source.href !== input.sourceURL || source.username || source.password || source.hash ||
      source.origin !== new URL(entry.resource.url).origin) fail('ORIGINAL_SOURCE_ORIGIN_MISMATCH');
  if (!Array.isArray(input.proofs) || input.proofs.length !== entry.accepts.length || !input.proofs.length) fail('ORIGINAL_ORDERED_PROOFS_REQUIRED');
  const signer = input.proofs[0]?.proof?.publicKey;
  if (typeof signer !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(signer) ||
      input.proofs.some(item => item?.proof?.publicKey !== signer)) fail('ORIGINAL_PROOF_SIGNER_REQUIRED');
  return { index, kind: 'admission', catalogKey, sellerId: input.sellerId, sequence: input.sequence,
    signer, sourceSha256: sha(bytes), sourceURL: input.sourceURL, observedAt: input.observedAt };
}
function withdrawalIntent(input) {
  const envelope = input?.envelope;
  if (!object(envelope) || Object.keys(envelope).length !== 2 || typeof envelope.signature !== 'string') fail('ORIGINAL_WITHDRAWAL_ENVELOPE_REQUIRED');
  const request = checkedRequest(envelope.request), signature = Buffer.from(envelope.signature, 'base64url');
  if (signature.length !== 64 || signature.toString('base64url') !== envelope.signature) fail('ORIGINAL_WITHDRAWAL_SIGNATURE_ENCODING_REQUIRED');
  // Exactly the original SF95 verified proof digest. It is not a new signature verifier.
  const proofSha256 = sha(JSON.stringify({ request, signature: envelope.signature }));
  return { index: 0, kind: 'withdrawal', catalogKey: request.catalogKey, sellerId: request.sellerId,
    sequence: request.sequence, signer: request.signer, sourceURL: request.sourceURL, sourceSha256: proofSha256,
    reason: request.reason, requestedPreviousHead: request.previousHead };
}
export function catalogOperationIntents({ operation, input } = {}) {
  if (!object(input)) fail('ORIGINAL_OPERATOR_INPUT_REQUIRED');
  if (operation === 'admit') return [admissionIntent(input, 0)];
  if (operation === 'apply-withdrawal') return [withdrawalIntent(input)];
  if (operation === 'apply-batch') {
    const batch = input.batch;
    if (!object(batch) || batch.schema !== 'stellar-forge.catalog-signed-batch/v1' || !Array.isArray(batch.admissions) ||
        !batch.admissions.length || batch.admissions.length > 1000) fail('ORIGINAL_SIGNED_BATCH_REQUIRED');
    return batch.admissions.map(admissionIntent);
  }
  fail('RECOVERY_REQUIRES_ORIGINAL_MUTATION_COMMAND');
}

export function matchCatalogEffect(intent, observation) {
  const base = { index: intent.index, kind: intent.kind, catalogKey: intent.catalogKey,
    sellerId: intent.sellerId, sequence: intent.sequence, sourceSha256: intent.sourceSha256 };
  if (observation.error) return { ...base, state: 'unavailable', effectObserved: false, error: observation.error };
  const current = observation.lookup.current;
  const history = observation.history?.history ?? [];
  if (!current || !history.length) return { ...base, state: 'not-observed', effectObserved: false,
    explanation: 'The expected effect is not present in the returned native snapshot. This is not proof that an in-flight command cannot finish.' };
  const atSequence = history.filter(item => item.sequence === intent.sequence);
  const desiredState = intent.kind === 'withdrawal' ? 'retired' : 'active';
  const match = atSequence.find(item => {
    const provenance = intent.kind === 'withdrawal' ? item.retiredBy : item.record?.provenance;
    return item.state === desiredState && provenance?.authority === 'signed_export' &&
      provenance.sellerId === intent.sellerId && provenance.sourceSha256 === intent.sourceSha256 &&
      provenance.sourceURL === intent.sourceURL && (intent.kind === 'withdrawal' ? item.reason === intent.reason : provenance.observedAt === intent.observedAt);
  });
  if (match && current.sellerId === intent.sellerId && current.signer === intent.signer) {
    const atCurrent = current.sequence === intent.sequence && Boolean(current.retired) === (intent.kind === 'withdrawal');
    return { ...base, state: atCurrent ? 'observed-current' : 'observed-superseded', effectObserved: true,
      lifecycleId: current.lifecycleId, currentSequence: current.sequence,
      evidence: { sequence: match.sequence, state: match.state,
        provenance: intent.kind === 'withdrawal' ? match.retiredBy : match.record.provenance,
        ...(intent.kind === 'withdrawal' ? { reason: match.reason } : { contentDigest: match.record.contentDigest }) },
      explanation: atCurrent ? 'The exact expected catalog effect is present and current.' : 'The exact expected catalog effect exists in native history; a later change is now current.' };
  }
  if (current.sellerId !== intent.sellerId || current.signer !== intent.signer)
    return { ...base, state: 'identity-conflict', effectObserved: false, currentSellerId: current.sellerId,
      currentSequence: current.sequence, explanation: 'The native identity differs from this retained original command.' };
  if (atSequence.length) return { ...base, state: 'sequence-conflict', effectObserved: false,
    currentSequence: current.sequence, explanation: 'This sequence exists with different native content, provenance, or operation type. It does not match this exact command.' };
  return { ...base, state: 'not-observed', effectObserved: false, currentSequence: current.sequence,
    explanation: 'No exact matching effect exists in the returned history. No replay or failed-outcome conclusion was made.' };
}

/** Recover through one native selected-revision snapshot (or head-bound pages).
 * Older daemons use the original lookup/history API only after their exact
 * unsupported-command response. Caller cancellation and one total deadline cover
 * every request. Effects never become inferred socket receipts or payment claims.
 */
export async function reconcileCatalogOperation({ directory, operation, input, timeoutMs = 30000,
  expectedPolicySha256 = null, concurrency = 4, signal, readMode = 'auto',
  pageBytes = MAX_REVISION_PAGE_BYTES } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) fail('CATALOG_DIRECTORY_REQUIRED');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) fail('READ_CONCURRENCY_INVALID');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) fail('TIMEOUT_INVALID');
  if (signal !== undefined && !(signal instanceof AbortSignal)) fail('ABORT_SIGNAL_REQUIRED');
  if (!['auto', 'snapshot', 'legacy'].includes(readMode)) fail('RECOVERY_READ_MODE_INVALID');
  if (!Number.isSafeInteger(pageBytes) || pageBytes < 16384 || pageBytes > MAX_REVISION_PAGE_BYTES) fail('REVISION_PAGE_BYTES_INVALID');
  if (expectedPolicySha256 !== null && !/^[a-f0-9]{64}$/.test(expectedPolicySha256)) fail('POLICY_DIGEST_INVALID');
  const deadline = performance.now() + timeoutMs;
  const budget = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, budget]) : budget;
  const check = () => {
    if (signal?.aborted) fail('CATALOG_RECOVERY_ABORTED');
    if (budget.aborted || performance.now() >= deadline) fail('CATALOG_RECOVERY_DEADLINE');
  };
  check();
  const intents = catalogOperationIntents({ operation, input });
  let readCalls = 0, snapshotPages = 0;
  const native = async (name, value = {}) => {
    check(); readCalls++;
    try {
      const result = await requestCatalogOperator({ directory, operation: name, input: value,
        timeoutMs: Math.max(100, Math.ceil(deadline - performance.now())), signal: combined });
      check(); return result;
    } catch (error) { check(); throw error; }
  };
  let before, after, coherentSnapshot = false, finalError, strategy = 'selected-revisions';
  const observations = new Map();
  const targetMap = new Map(intents.map(item => {
    const target = { catalogKey: item.catalogKey, sequence: item.sequence };
    return [revisionTargetKey(target), target];
  }));
  const targets = [...targetMap.values()], targetHash = revisionTargetsDigest(targets);
  let legacy = readMode === 'legacy';
  if (!legacy) {
    let offset = 0;
    while (offset !== null) {
      try {
        const page = await native('inspect-revisions', { targets, offset, pageBytes,
          ...(before ? { expectedHead: before.journalHead, expectedTargets: targetHash } : {}) });
        validateRevisionPage(page, { targets, offset, head: before?.journalHead, policySha256: before?.policySha256 });
        before ??= page; after = page; snapshotPages++;
        for (const row of page.rows) observations.set(revisionTargetKey(row), {
          lookup: { journalHead: page.journalHead, current: row.current },
          history: { journalHead: page.journalHead, history: row.history },
        });
        offset = page.nextOffset;
      } catch (error) {
        check();
        if (readMode === 'auto' && snapshotPages === 0 && error.statusCode === 422 &&
            error.message === 'UNKNOWN_OPERATOR_COMMAND') { legacy = true; break; }
        if (!before) throw error;
        // Earlier pages remain observations at their named head. An intervening
        // write or unavailable page never restarts/retries the read or hides rows.
        finalError = errorCode(error); after = null;
        for (const target of targets) if (!observations.has(revisionTargetKey(target)))
          observations.set(revisionTargetKey(target), { error: finalError });
        break;
      }
    }
    coherentSnapshot = Boolean(after && observations.size === targets.length && !finalError);
  }
  if (legacy) {
    strategy = 'legacy-history';
    before = await native('status');
    const keys = [...new Set(intents.map(item => item.catalogKey))], byKey = new Map();
    let next = 0;
    const jobs = Array.from({ length: Math.min(concurrency, keys.length) }, async () => {
      while (next < keys.length) {
        check(); const key = keys[next++];
        try {
          const lookup = await native('lookup', { catalogKey: key });
          const history = lookup.current?.lifecycleId ? await native('history', { lifecycleId: lookup.current.lifecycleId }) : null;
          byKey.set(key, { lookup, history });
        } catch (error) { check(); byKey.set(key, { error: errorCode(error) }); }
      }
    });
    // Always retire all owned reads before returning, including cancellation.
    const completed = await Promise.allSettled(jobs);
    check();
    const rejected = completed.find(result => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    try { after = await native('status'); } catch (error) { check(); finalError = errorCode(error); after = null; }
    for (const target of targets) observations.set(revisionTargetKey(target), byKey.get(target.catalogKey));
    coherentSnapshot = Boolean(after && before.journalHead === after.journalHead &&
      [...byKey.values()].every(item => !item.error && item.lookup.journalHead === before.journalHead &&
        (!item.history || item.history.journalHead === before.journalHead)));
  }
  check();
  const items = intents.map(intent => matchCatalogEffect(intent, observations.get(revisionTargetKey(intent))));
  const observed = items.filter(item => item.effectObserved).length;
  check();
  return { schema: 'stellar-forge.catalog-effect-recovery/v1', operation, observedAt: new Date().toISOString(),
    requestOutcome: 'not-inferred', catalogEffects: observed === items.length ? 'all-observed' : observed ? 'partially-observed' : 'not-observed',
    counts: { requested: items.length, observed, unavailable: items.filter(item => item.state === 'unavailable').length },
    coherentSnapshot, beforeHead: before.journalHead, afterHead: after?.journalHead ?? null,
    policySha256: after?.policySha256 ?? before.policySha256,
    policyChanged: expectedPolicySha256 === null ? null : (after?.policySha256 ?? before.policySha256) !== expectedPolicySha256,
    ...(finalError ? { finalReadError: finalError } : {}), items,
    interpretation: operation === 'apply-batch'
      ? 'Matches individual native catalog effects. This does not attribute them to a particular batch request or establish its atomic commit boundary.'
      : 'Matches the expected native catalog effect, not a particular socket request. Original journal and saved native response remain authoritative.',
    readStrategy: strategy, snapshotPages, nativeReadCalls: readCalls,
    nativeMutationCalls: 0, signaturesIssued: 0, paymentCalls: 0 };
}
