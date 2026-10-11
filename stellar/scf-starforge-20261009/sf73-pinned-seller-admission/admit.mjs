// MIT. SF73 bridges the ORIGINAL SF50 pinned-Ed25519 verification and SF60 durable writer.
// Proof of an advertised offer is NOT proof of payTo account ownership or settlement.
import { createHash, createPublicKey } from 'node:crypto';
import { DurableCatalogTransaction } from '../sf60-durable-catalog-transaction/journal.mjs';
import { verifyPinnedProof } from '../sf50-seller-proof/proof.mjs';

const fail = code => { throw new TypeError(code); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const goodAmount = x => typeof x === 'string' && /^(0|[1-9][0-9]*)$/.test(x) &&
  x.length <= 78 && BigInt(x) > 0n;
const isUrl = value => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash && u.href === value ? u : null;
  } catch { return null; }
};
function decodeOriginal(raw) {
  if (!(raw instanceof Uint8Array) || raw.length < 10 || raw.length > 65536)
    fail('ORIGINAL_SOURCE_BYTES_REQUIRED');
  let data;
  try { data = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
  catch { fail('ORIGINAL_SOURCE_NOT_UTF8'); }
  let entry;
  try { entry = JSON.parse(data); }
  catch { fail('ORIGINAL_SOURCE_INVALID_JSON'); }
  if (!object(entry) || entry.x402Version !== 2 || !object(entry.resource) ||
      !object(entry.extensions?.bazaar?.info) || !object(entry.extensions.bazaar.schema) ||
      !Array.isArray(entry.accepts) || entry.accepts.length < 1 || entry.accepts.length > 64)
    fail('ORIGINAL_BAZAAR_V2_CATALOG_ENVELOPE_REQUIRED');
  for (const offer of entry.accepts) {
    if (!object(offer) || !goodAmount(offer.amount) ||
        (offer.maxAmountRequired !== undefined && offer.maxAmountRequired !== offer.amount))
      fail('AMBIGUOUS_OR_INVALID_ATOMIC_PAYMENT_OFFER');
  }
  return entry;
}
function verifiedPin(pinnedPublicKey) {
  if (!pinnedPublicKey) fail('INDEPENDENT_PIN_REQUIRED');
  let der;
  try {
    const key = createPublicKey(pinnedPublicKey);
    if (key.asymmetricKeyType !== 'ed25519') fail('ED25519_PIN_REQUIRED');
    der = key.export({ format: 'der', type: 'spki' });
  } catch (error) {
    if (error?.message === 'ED25519_PIN_REQUIRED') throw error;
    fail('INVALID_INDEPENDENT_PUBLIC_KEY_PIN');
  }
  return { signer: der.toString('base64url'),
    fingerprint: createHash('sha256').update(der).digest('hex') };
}

/**
 * Verify one unchanged original-source declaration against independent seller
 * policy and ALL original SF50 quote proofs, without publishing any state.
 * The prepared operation is for a trusted original SF60 single or batch writer.
 */
export function verifyPinnedSellerAdmission({
  sourceBytes, sourceURL, observedAt, sellerId, sequence,
  authority, pinnedPublicKey, proofs, now = Date.now()
}) {
  if (!Number.isSafeInteger(now)) fail('VERIFIER_CLOCK_INVALID');
  if (!Number.isSafeInteger(sequence) || sequence < 1) fail('SELLER_SEQUENCE_INVALID');
  if (typeof sellerId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(sellerId))
    fail('SELLER_ID_INVALID');
  const entry = decodeOriginal(sourceBytes);
  const resource = isUrl(entry.resource.url);
  const source = isUrl(sourceURL);
  if (!resource || !source || source.origin !== resource.origin)
    fail('SOURCE_ORIGIN_MUST_MATCH_SIGNED_RESOURCE');
  if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt)) ||
      new Date(observedAt).toISOString() !== observedAt)
    fail('ORIGINAL_OBSERVATION_TIMESTAMP_REQUIRED');
  const pin = verifiedPin(pinnedPublicKey);
  // The trusted operator must supply this policy INDEPENDENTLY of the
  // seller's received offer/proofs. Nothing in this function mints authority.
  if (!object(authority) || authority.sellerId !== sellerId || authority.signer !== pin.signer ||
      ['allowedOrigins','allowedRecipients','allowedNetworks','allowedSchemes']
        .some(k => !(authority[k] instanceof Set) || authority[k].size === 0))
    fail('INDEPENDENT_OPERATOR_AUTHORITY_REQUIRED');
  if (!authority.allowedOrigins.has(resource.origin)) fail('RESOURCE_ORIGIN_NOT_AUTHORIZED');
  if (!Array.isArray(proofs) || proofs.length !== entry.accepts.length)
    fail('ONE_ORIGINAL_PROOF_PER_PAYMENT_OPTION_REQUIRED');
  const nonces = new Set();
  for (let i = 0; i < entry.accepts.length; i++) {
    const term = entry.accepts[i], item = proofs[i];
    if (!object(item) || typeof item.nonce !== 'string' || nonces.has(item.nonce))
      fail('MISSING_OR_REUSED_VERIFIER_NONCE');
    nonces.add(item.nonce);
    if (!authority.allowedRecipients.has(term.payTo) ||
        !authority.allowedNetworks.has(term.network) ||
        !authority.allowedSchemes.has(term.scheme))
      fail('PAYMENT_OPTION_OUTSIDE_OPERATOR_POLICY');
    // Original SF50 verifies the COMPLETE Bazaar input/schema and this exact
    // selected accept option against the truly independent public key pin.
    const result = verifyPinnedProof(entry, item.proof, {
      nonce: item.nonce, selectedAccept: i, pinnedPublicKey, now
    });
    if (result?.verified !== true || result?.origin !== resource.origin)
      fail('ORIGINAL_SELLER_PROOF_NOT_VERIFIED');
  }
  const raw = Buffer.from(sourceBytes);
  const sourceSha256 = createHash('sha256').update(raw).digest('hex');
  const candidate = { sellerId, sequence, entry };
  const provenance = {
    authority: 'signed_export', sellerId, sourceURL: source.href,
    sourceSha256, observedAt
  };
  return {
    operation: {kind:'upsert', candidate, authority, provenance},
    verification: {sourceSha256, signerPublicKeySha256:pin.fingerprint, sellerId,
      verifiedPaymentOptions:proofs.length, observedAt,
      expiresAt:Math.min(...proofs.map(item=>item.proof.statement.expiresAt))}
  };
}

/** Original single-admission API, with the same native verification and receipt. */
export async function admitPinnedSeller(options) {
  const {journal} = options;
  if (!(journal instanceof DurableCatalogTransaction)) fail('REAL_SF60_WRITER_REQUIRED');
  const {operation, verification} = verifyPinnedSellerAdmission(options);
  const commit = await journal.ingest(operation.candidate,operation.authority,operation.provenance);
  const {sourceSha256,signerPublicKeySha256,sellerId,verifiedPaymentOptions,observedAt} = verification;
  return {
    schema:'SCF-SF73/pinned-seller-durable-admission-v1',
    decision:commit.decision, reason:commit.reason,
    head:commit.head, operations:commit.operations ?? journal.count,
    sourceSha256, signerPublicKeySha256, sellerId, verifiedPaymentOptions,
    observedAt, paymentCalls:0, signaturesIssued:0
  };
}
