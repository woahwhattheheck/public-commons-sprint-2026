// MIT. Revision comparison and outcome reconciliation for the existing SF60 workspace.
// All authority, signature verification and mutations remain in the original operator.
import { createHash } from 'node:crypto';
import { validateCatalogEntry } from '../../../scf46-stellar-bazaar/src/catalog.mjs';
import { normalizeDiscoveryRecord } from '../../../stellar-forge/catalog-lifecycle/lifecycle.mjs';
import { checkedRequest } from '../sf95-signed-seller-withdrawal/proof.mjs';

const REVIEW_SCHEMA = 'stellar-forge.catalog-workspace-revision-review/v1';
const RECOVERY_SCHEMA = 'stellar-forge.catalog-workspace-reconciliation/v1';
const SUPPORTED = new Set(['admit', 'apply-withdrawal']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const stable = value => JSON.stringify(canonical(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => sha(stable(value));
const clone = value => structuredClone(value);
const fail = code => { throw Object.assign(new Error(code), { httpStatus: 409 }); };
const caches = new WeakMap();

/** Decode, never rewrite, the exact bytes that the native SF73 verifier receives. */
function intent(record) {
  if (record.operation === 'admit') {
    const input = record.input;
    if (typeof input?.sourceBase64 !== 'string' || input.sourceBase64.length > 87384)
      fail('ORIGINAL_SOURCE_BYTES_REQUIRED');
    const source = Buffer.from(input.sourceBase64, 'base64');
    if (source.length < 10 || source.length > 65536 || source.toString('base64') !== input.sourceBase64)
      fail('ORIGINAL_SOURCE_BASE64_INVALID');
    let declaration;
    try { declaration = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source)); }
    catch { fail('ORIGINAL_SOURCE_INVALID_UTF8_JSON'); }
    if (declaration?.x402Version !== 2) fail('ORIGINAL_X402_V2_SOURCE_REQUIRED');
    const parsed = validateCatalogEntry(declaration), sourceSha256 = sha(source);
    const normalized = normalizeDiscoveryRecord(declaration, {
      authority: 'signed_export', sellerId: input.sellerId, sourceURL: input.sourceURL,
      observedAt: input.observedAt, sourceSha256,
    });
    return { catalogKey: parsed.id, sellerId: input.sellerId, sequence: input.sequence,
      sourceSha256, sourceBytes: source.length, declaration, visibleDeclaration: parsed.entry,
      normalized, inputDigest: digest({ operation: record.operation, input }) };
  }
  const envelope = record.input?.envelope, request = checkedRequest(envelope?.request);
  if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))
    fail('WITHDRAWAL_SIGNATURE_ENCODING_INVALID');
  // The same canonical request field order and envelope serialization as SF95.
  // A matching digest is an identity comparison, not a signature verification.
  const sourceSha256 = sha(JSON.stringify({ request, signature: envelope.signature }));
  return { catalogKey: request.catalogKey, sellerId: request.sellerId, sequence: request.sequence,
    sourceSha256, request, inputDigest: digest({ operation: record.operation, input: record.input }) };
}

/** Individual reads remain original operator commands. A second exact lookup
 * detects target changes during the history read without rejecting other sellers' writes.
 */
async function snapshot(call, catalogKey) {
  const first = await call('lookup', { catalogKey });
  const response = first.current ? await call('history', { lifecycleId: first.current.lifecycleId }) : { history: [] };
  const last = await call('lookup', { catalogKey });
  if (stable(first.current) !== stable(last.current)) fail('CATALOG_RESOURCE_CHANGED_REVIEW_AGAIN');
  if (!Array.isArray(response.history)) fail('ORIGINAL_HISTORY_RESPONSE_INVALID');
  const latest = response.history.at(-1) ?? null;
  if (last.current && latest?.sequence !== last.current.sequence) fail('CATALOG_HISTORY_CHANGED_REVIEW_AGAIN');
  return { catalogKey, journalHead: last.journalHead, current: last.current,
    history: response.history, latest, binding: digest({ current: last.current, latest }) };
}

function cacheFor(call) {
  if (!caches.has(call)) caches.set(call, new Map());
  return caches.get(call);
}
/** Get the actual original discovery declaration, not a reconstruction from
 * lifecycle's deliberately reduced projection. This retains ordered options,
 * timeouts, resource metadata and the complete Bazaar interface in the comparison.
 * The original filters apply to one payment option, never a hybrid option.
 */
async function currentDeclaration(call, resource) {
  if (!resource.current) return null;
  const key = resource.catalogKey + '\n' + resource.latest.record.contentDigest;
  const cache = cacheFor(call), cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return clone(cached); }
  // Retired rows are absent from discovery. Keep their actual lifecycle record;
  // never fabricate a previous declaration that the original API no longer serves.
  if (resource.current.retired) return null;
  const params = { limit: '20', type: resource.latest.record.kind };
  const option = resource.latest.record.accepts[0];
  for (const field of ['network', 'asset', 'payTo', 'scheme']) if (option?.[field]) params[field] = option[field];
  let offset = 0;
  while (true) {
    const page = await call('list', { params: { ...params, offset: String(offset) } });
    if (!Array.isArray(page.resources) || !Number.isSafeInteger(page.pagination?.total))
      fail('ORIGINAL_DISCOVERY_RESPONSE_INVALID');
    for (const declaration of page.resources) {
      if (validateCatalogEntry(declaration).id !== resource.catalogKey) continue;
      const normalized = normalizeDiscoveryRecord(declaration, resource.latest.record.provenance);
      if (normalized.contentDigest !== resource.latest.record.contentDigest) fail('CATALOG_DECLARATION_CHANGED_REVIEW_AGAIN');
      const current = await call('lookup', { catalogKey: resource.catalogKey });
      if (stable(current.current) !== stable(resource.current)) fail('CATALOG_RESOURCE_CHANGED_REVIEW_AGAIN');
      while (cache.size >= 32) cache.delete(cache.keys().next().value);
      cache.set(key, clone(declaration));
      return declaration;
    }
    offset += page.resources.length;
    if (!page.resources.length || offset >= page.pagination.total) break;
  }
  fail('ACTIVE_DECLARATION_CHANGED_REVIEW_AGAIN');
}

const present = (value, key) => Object.hasOwn(value ?? {}, key) ? value[key] : null;
function differences(before, after) {
  const changes = [];
  const append = (path, label, previous, next) => {
    if (stable(previous) !== stable(next)) changes.push({ path, label, before: previous, after: next });
  };
  append('/x402Version', 'Protocol version', before?.x402Version ?? null, after?.x402Version ?? null);
  for (const key of [...new Set([...Object.keys(before?.resource ?? {}), ...Object.keys(after?.resource ?? {})])].sort())
    append('/resource/' + key, 'Resource · ' + key, present(before?.resource, key), present(after?.resource, key));
  append('/accepts', 'Payment alternatives · original order and exact atomic amounts', before?.accepts ?? null, after?.accepts ?? null);
  const previousExtensions = before?.extensions ?? {}, nextExtensions = after?.extensions ?? {};
  for (const key of [...new Set([...Object.keys(previousExtensions), ...Object.keys(nextExtensions)])].sort()) {
    if (key !== 'bazaar') {
      append('/extensions/' + key, 'Extension · ' + key, present(previousExtensions, key), present(nextExtensions, key));
      continue;
    }
    const previous = previousExtensions.bazaar ?? {}, next = nextExtensions.bazaar ?? {};
    for (const field of [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort())
      append('/extensions/bazaar/' + field, 'Bazaar · ' + field, present(previous, field), present(next, field));
  }
  return changes;
}

/** Attach this result to record.revisionReview before the workspace's existing
 * create-only save. Batch records retain the original native batch review instead.
 */
export async function reviewCatalogRevision(record, call) {
  if (!SUPPORTED.has(record.operation)) return null;
  const wanted = intent(record), resource = await snapshot(call, wanted.catalogKey);
  const declaration = await currentDeclaration(call, resource);
  const warnings = [];
  if (resource.current && resource.current.sellerId !== wanted.sellerId)
    warnings.push('The current resource has a different seller. The native writer will enforce ownership.');
  if (resource.current && wanted.sequence <= resource.current.sequence)
    warnings.push('The proposed sequence is not newer. Native admission permits only its exact replay semantics.');
  if (record.operation === 'apply-withdrawal') {
    if (wanted.request.previousHead !== resource.journalHead)
      warnings.push('The signed withdrawal refers to an older journal head; prepare and sign a current request.');
    if (Date.parse(wanted.request.expiresAt) <= Date.now()) warnings.push('The signed withdrawal is expired.');
  }
  const after = record.operation === 'admit' ? wanted.visibleDeclaration : null;
  const expiries = record.operation === 'admit' ? (record.input.proofs ?? []).map(pair => pair?.proof?.statement?.expiresAt) : [Date.parse(wanted.request.expiresAt)];
  const expiry = expiries.length && expiries.every(value => Number.isSafeInteger(value) && Math.abs(value) <= 8640000000000000) ? Math.min(...expiries) : null;
  const proofWindow = { expiresAt: expiry === null ? null : new Date(expiry).toISOString(),
    source: record.operation === 'admit' ? 'earliest-received-proof-statement' : 'signed-withdrawal-request',
    verified: false };
  const review = {
    schema: REVIEW_SCHEMA, capturedAt: new Date().toISOString(), operation: record.operation,
    catalogKey: wanted.catalogKey, inputDigest: wanted.inputDigest,
    journalHead: resource.journalHead, resourceBinding: resource.binding,
    before: { state: resource.current ? resource.current.retired ? 'retired' : 'active' : 'absent',
      sellerId: resource.current?.sellerId ?? null, sequence: resource.current?.sequence ?? null,
      declaration, normalized: resource.latest?.record ?? null,
      declarationSource: declaration ? 'original-discovery-or-exact-revision-cache' : 'not-in-live-discovery' },
    after: { state: record.operation === 'admit' ? 'active' : 'retired',
      sellerId: wanted.sellerId, sequence: wanted.sequence, declaration: after,
      normalized: wanted.normalized ?? null, sourceSha256: wanted.sourceSha256 },
    changes: record.operation === 'admit' ? differences(declaration, after) :
      [{ path: '/state', label: 'Catalog state', before: resource.current?.retired ? 'retired' : resource.current ? 'active' : 'absent', after: 'retired' }],
    warnings, proofWindow, structuralOnly: true, paymentCalls: 0,
    originalSourceRetained: true,
  };
  review.digest = digest(review);
  return review;
}

/** Call immediately before the existing phase=sending save. SF73 remains the
 * authority if a later race occurs. SF95 still enforces its own strict global head.
 * Older saved work without this optional comparison keeps its original semantics.
 */
export async function assertReviewedRevision(record, call) {
  if (!SUPPORTED.has(record.operation) || !record.revisionReview) return;
  const review = record.revisionReview, wanted = intent(record);
  const { digest: recordedDigest, ...body } = review;
  if (review.schema !== REVIEW_SCHEMA || recordedDigest !== digest(body) || review.inputDigest !== wanted.inputDigest)
    fail('REVISION_REVIEW_INPUT_CHANGED');
  const current = await snapshot(call, wanted.catalogKey);
  if (current.binding !== review.resourceBinding) fail('REVIEWED_RESOURCE_CHANGED_REVIEW_AGAIN');
}

/** An observation of original history, never a reconstructed command receipt.
 * A historical match can be found even after a later revision/withdrawal/restart.
 * Persist the returned value as record.reconciliation without altering phase/result.
 */
export async function reconcileCatalogRevision(record, call, { includeInspection = false } = {}) {
  if (!SUPPORTED.has(record.operation)) return null;
  const wanted = intent(record), resource = await snapshot(call, wanted.catalogKey);
  const matches = [];
  for (const [index, revision] of resource.history.entries()) {
    const matched = record.operation === 'admit' ?
      revision.state === 'active' && revision.sequence === wanted.sequence &&
      revision.record?.contentDigest === wanted.normalized.contentDigest &&
      revision.record?.provenance?.sourceSha256 === wanted.sourceSha256 :
      revision.state === 'retired' && revision.sequence === wanted.sequence &&
      revision.retiredBy?.sellerId === wanted.sellerId &&
      revision.retiredBy?.sourceURL === wanted.request.sourceURL &&
      revision.retiredBy?.sourceSha256 === wanted.sourceSha256;
    if (matched) matches.push({ historyIndex: index, sequence: revision.sequence, state: revision.state,
      sourceSha256: wanted.sourceSha256, superseded: index < resource.history.length - 1 });
  }
  return { schema: RECOVERY_SCHEMA, checkedAt: new Date().toISOString(), operationId: record.id,
    inputDigest: wanted.inputDigest, catalogKey: wanted.catalogKey, journalHead: resource.journalHead,
    recordedCommandPhase: record.phase, recordedReceiptAvailable: Boolean(record.result),
    ...(includeInspection ? { inspection: { lookup: { journalHead: resource.journalHead, current: resource.current },
      history: { journalHead: resource.journalHead, history: resource.history } } } : {}),
    verdict: matches.length ? 'MATCHING_ORIGINAL_REVISION_PRESENT' : 'NO_MATCHING_REVISION_OBSERVED',
    matches, current: resource.current, historyRevisions: resource.history.length,
    commandResent: false, paymentCalls: 0,
    interpretation: matches.length ?
      'The exact requested revision exists in original history. This does not attribute the write to this request or replace its native receipt. The current resource may have advanced.' :
      'No exact matching revision was observed at this journal head. A previously sent command may still be completing. Nothing was retried and the recorded command outcome is unchanged.' };
}
