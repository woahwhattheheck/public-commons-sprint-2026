// MIT. Signed merchant withdrawal over the ORIGINAL SF60 durable catalog.
// An Ed25519 website/operator key is not proof of wallet ownership or a payment.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

export const WITHDRAWAL_DOMAIN = 'stellar-forge.seller-withdrawal/v1';
const HEX64 = /^[a-f0-9]{64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
export const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
export const MAX_LIFETIME_MS = 60 * 60 * 1000;
export const DEFAULT_LIFETIME_MS = 30 * 60 * 1000;
const SKEW_MS = 30_000;
const REQUEST_FIELDS = [
  'domain', 'sellerId', 'catalogKey', 'signer', 'sequence', 'previousHead',
  'sourceURL', 'reason', 'nonce', 'issuedAt', 'expiresAt'
];
const ENVELOPE_FIELDS = ['request', 'signature'];
export const fail = code => { throw new TypeError(code); };
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function exactKeys(value, keys, code) {
  if (!obj(value) || Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key))) fail(code);
}
function sourceUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048) return null;
    const u = new URL(value);
    return u.protocol === 'https:' && u.username === '' && u.password === '' &&
      u.hash === '' && u.href === value ? value : null;
  } catch { return null; }
}
function iso(value) {
  if (typeof value !== 'string') return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}
function spki(publicKey) {
  let key;
  try { key = publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey); }
  catch { fail('PIN_INVALID'); }
  if (key.asymmetricKeyType !== 'ed25519') fail('ED25519_PIN_REQUIRED');
  return { key, signer: key.export({format:'der',type:'spki'}).toString('base64url') };
}
export function checkedRequest(input) {
  exactKeys(input, REQUEST_FIELDS, 'WITHDRAWAL_REQUEST_SCHEMA_INVALID');
  const request = Object.fromEntries(REQUEST_FIELDS.map(key => [key, input[key]]));
  if (request.domain !== WITHDRAWAL_DOMAIN || !ID.test(request.sellerId) ||
      typeof request.catalogKey !== 'string' || !request.catalogKey ||
      Buffer.byteLength(request.catalogKey, 'utf8') > 4096 ||
      typeof request.signer !== 'string' || !B64URL.test(request.signer) || request.signer.length > 256 ||
      !Number.isSafeInteger(request.sequence) || request.sequence < 1 ||
      !HEX64.test(request.previousHead) || !sourceUrl(request.sourceURL) ||
      typeof request.reason !== 'string' || !request.reason.trim() ||
      request.reason.length > 256 || /[\x00-\x1f\x7f]/.test(request.reason) ||
      typeof request.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(request.nonce)) {
    fail('WITHDRAWAL_REQUEST_FIELDS_INVALID');
  }
  const issued = iso(request.issuedAt), expires = iso(request.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) ||
      expires <= issued || expires - issued > MAX_LIFETIME_MS) fail('WITHDRAWAL_WINDOW_INVALID');
  return request;
}
function signedBytes(request) {
  return Buffer.from(WITHDRAWAL_DOMAIN + '\n' + JSON.stringify(checkedRequest(request)), 'utf8');
}
// Seller signs on its OWN machine. This intentionally does not read a wallet key.
export function signWithdrawal(request, privateKeyPem) {
  const checked = checkedRequest(request);
  let key;
  try { key = createPrivateKey(privateKeyPem); }
  catch { fail('SELLER_PRIVATE_KEY_INVALID'); }
  if (key.asymmetricKeyType !== 'ed25519') fail('SELLER_ED25519_KEY_REQUIRED');
  const {signer} = spki(createPublicKey(key));
  if (signer !== checked.signer) fail('SELLER_KEY_DOES_NOT_MATCH_ORIGINAL_CATALOG');
  return {request:checked, signature:sign(null, signedBytes(checked), key).toString('base64url')};
}

// Caller MUST supply an independent out-of-band pinned seller public key.
// Proof-embedded public keys are deliberately not supported.
export function verifyWithdrawal(envelope, pinnedPublicKey, {now = Date.now()} = {}) {
  exactKeys(envelope, ENVELOPE_FIELDS, 'WITHDRAWAL_ENVELOPE_SCHEMA_INVALID');
  const request = checkedRequest(envelope.request);
  if (!Number.isSafeInteger(now) || now + SKEW_MS < Date.parse(request.issuedAt) ||
      now >= Date.parse(request.expiresAt)) fail('WITHDRAWAL_EXPIRED_OR_EARLY');
  const {key, signer} = spki(pinnedPublicKey);
  if (signer !== request.signer) fail('INDEPENDENT_PIN_MISMATCH');
  const encoded = envelope.signature;
  if (typeof encoded !== 'string' || !B64URL.test(encoded) || encoded.length > 128)
    fail('WITHDRAWAL_SIGNATURE_ENCODING_INVALID');
  const signature = Buffer.from(encoded, 'base64url');
  if (signature.length !== 64 || signature.toString('base64url') !== encoded ||
      !verify(null, signedBytes(request), key, signature)) fail('WITHDRAWAL_SIGNATURE_INVALID');
  return {request, proofSha256: createHash('sha256')
    .update(JSON.stringify({request,signature:encoded})).digest('hex')};
}
