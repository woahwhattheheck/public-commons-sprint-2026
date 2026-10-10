// MIT. SF54: actual SF25 catalog outcome -> x402 v2 HTTP extension sidechannel.
// Caller must supply trusted facilitator settlement facts; no settlement is performed here.
import { PaymentAutoCatalog } from '../../../stellar-forge/payment-auto-catalog/auto-catalog.mjs';

const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const STATUS_KEY = /^[a-z][a-z0-9_-]{0,63}$/;
const HEADER_NAME = 'EXTENSION-RESPONSES';
const MAX_HEADER_BYTES = 16_384;

// Existing outcomes must be from the trusted facilitator, not an HTTP caller.
function otherOutcomes(value) {
  if (value === undefined) return {};
  if (!plain(value)) throw new TypeError('OTHER_EXTENSION_OUTCOMES_INVALID');
  if (Object.keys(value).some(key => !STATUS_KEY.test(key) || key === 'bazaar'))
    throw new TypeError('OTHER_EXTENSION_KEY_INVALID');
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch { throw new TypeError('OTHER_EXTENSION_OUTCOMES_NOT_JSON'); }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > MAX_HEADER_BYTES)
    throw new RangeError('OTHER_EXTENSION_OUTCOMES_TOO_LARGE');
  const cloned = JSON.parse(serialized);
  if (!plain(cloned)) throw new TypeError('OTHER_EXTENSION_OUTCOMES_INVALID');
  return cloned;
}
function reasonCode(result) {
  const raw = typeof result?.reason === 'string' ? result.reason : '';
  // Never expose error details, arbitrary messages or stack traces to the transport.
  return /^[A-Z][A-Z0-9_]{0,95}(?::[A-Za-z0-9_.-]{1,80})?$/.test(raw)
    ? raw : 'CATALOGING_REJECTED';
}
function hasBazaar(payload) {
  return plain(payload?.extensions) && Object.hasOwn(payload.extensions, 'bazaar');
}

/**
 * The encoded header is for facilitator -> resource server ONLY.
 * It must not be forwarded by the resource server to the buyer.
 */
export function encodeCatalogSidechannel({ paymentPayload, catalogDecision, otherExtensionResponses } = {}) {
  const fields = otherOutcomes(otherExtensionResponses);
  let bazaar = null;
  if (hasBazaar(paymentPayload)) {
    const accepted = catalogDecision?.decision === 'accepted' ||
      (catalogDecision?.decision === 'soft_drop' && catalogDecision?.reason === 'EXACT_REPLAY');
    bazaar = accepted ? { status: 'success' } :
      { status: 'rejected', rejectedReason: reasonCode(catalogDecision) };
    fields.bazaar = bazaar;
  }
  if (!Object.keys(fields).length)
    return { headerName: HEADER_NAME, headerValue: null, extensionResponses: {}, bazaar: null };
  const bytes = Buffer.from(JSON.stringify(fields), 'utf8');
  if (bytes.length > MAX_HEADER_BYTES) throw new RangeError('EXTENSION_RESPONSES_TOO_LARGE');
  return { headerName: HEADER_NAME, headerValue: bytes.toString('base64'),
    extensionResponses: fields, bazaar };
}

export class BazaarSettlementSidechannel {
  #catalog;
  constructor({ catalog = new PaymentAutoCatalog() } = {}) {
    if (!catalog || typeof catalog.ingest !== 'function' ||
        typeof catalog.list !== 'function' || typeof catalog.search !== 'function')
      throw new TypeError('SF25-compatible catalog required');
    this.#catalog = catalog;
  }
  processSettled({ paymentPayload, settlement, sequence, otherExtensionResponses } = {}) {
    // The catalog mutation is permanent, so all sibling/transport constraints
    // must pass BEFORE the original SF25 ingest can commit a seller listing.
    // Retain one cloned sibling snapshot: caller getters cannot change it
    // between preflight and the final facilitator->resource-server encoding.
    const validatedSiblings = otherOutcomes(otherExtensionResponses);
    if (hasBazaar(paymentPayload)) {
      // Max possible sanitized rejection code (96 chars + ':' + 80 chars).
      // This reserves the worst wire header, not just the shorter success
      // outcome. A near-limit sibling can otherwise throw AFTER commit.
      const worst = { ...validatedSiblings, bazaar: {
        status: 'rejected', rejectedReason: 'A'.repeat(96) + ':' + 'a'.repeat(80),
      } };
      if (Buffer.byteLength(JSON.stringify(worst), 'utf8') > MAX_HEADER_BYTES)
        throw new RangeError('EXTENSION_RESPONSES_TOO_LARGE');
    }
    // SF25 enforces the verified-settlement and original seller/canonical terms gate.
    const result = this.#catalog.ingest({ paymentPayload, settlement, sequence });
    const wire = encodeCatalogSidechannel({ paymentPayload,
      catalogDecision: result, otherExtensionResponses: validatedSiblings });
    return { catalogDecision: result, ...wire,
      catalogSize: this.#catalog.size, catalogVersion: this.#catalog.version };
  }
  list(params = new URLSearchParams()) { return this.#catalog.list(params); }
  search(params = new URLSearchParams()) { return this.#catalog.search(params); }
  get size() { return this.#catalog.size; }
  get version() { return this.#catalog.version; }
}
