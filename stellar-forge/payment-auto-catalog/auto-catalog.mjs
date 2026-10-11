/** SF25 catalog ingestion. Pure metadata validation lives separately so offline
 * seller import does not load mutable catalog storage or trust dependencies. */
import { AtomicCatalogIntegration } from '../product-integration/atomic-catalog.mjs';
import { validateBazaarExtension } from './schema-validation.mjs';
export { validateBazaarExtension } from './schema-validation.mjs';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);

function settlementAuthority(settlement) {
  return {
    sellerId: settlement.sellerId,
    signer: settlement.signer,
    allowedOrigins: new Set([settlement.origin]),
    allowedRecipients: new Set([settlement.payTo]),
    allowedNetworks: new Set([settlement.network]),
    allowedSchemes: new Set([settlement.scheme]),
  };
}

export class PaymentAutoCatalog {
  #catalog;
  constructor(catalog = new AtomicCatalogIntegration()) { this.#catalog = catalog; }

  ingest({ paymentPayload, settlement, sequence }) {
    if (!plain(paymentPayload) || paymentPayload.x402Version !== 2) return { decision: 'reject', reason: 'PAYMENT_PAYLOAD_V2_REQUIRED' };
    if (!plain(settlement) || settlement.status !== 'settled') return { decision: 'reject', reason: 'SETTLEMENT_NOT_CONFIRMED' };
    if (!Number.isSafeInteger(sequence) || sequence <= 0) return { decision: 'reject', reason: 'SEQUENCE_INVALID' };
    if (!plain(paymentPayload.resource) || !plain(paymentPayload.accepted) || !plain(paymentPayload.extensions)) return { decision: 'reject', reason: 'PAYMENT_PAYLOAD_ENVELOPE_INVALID' };
    const extension = paymentPayload.extensions.bazaar;
    if (extension === undefined) return { decision: 'soft_drop', reason: 'BAZAAR_EXTENSION_ABSENT' };
    const schema = validateBazaarExtension(extension);
    if (!schema.ok) return { decision: 'soft_drop', ...schema };

    const accepted = paymentPayload.accepted;
    for (const field of ['network', 'scheme', 'payTo', 'asset', 'amount']) {
      if (typeof settlement[field] !== 'string' || accepted[field] !== settlement[field]) {
        return { decision: 'reject', reason: `SETTLEMENT_${field.toUpperCase()}_MISMATCH` };
      }
    }
    let origin;
    try { origin = new URL(paymentPayload.resource.url).origin; }
    catch { return { decision: 'reject', reason: 'RESOURCE_URL_INVALID' }; }
    if (origin !== settlement.origin) return { decision: 'reject', reason: 'SETTLEMENT_ORIGIN_MISMATCH' };
    if (!/^[a-f0-9]{64}$/.test(settlement.receiptSha256 ?? '')) return { decision: 'reject', reason: 'SETTLEMENT_RECEIPT_SHA_INVALID' };

    const entry = {
      resource: clone(paymentPayload.resource),
      accepts: [clone(accepted)],
      extensions: { bazaar: clone(extension) },
    };
    const provenance = {
      authority: 'settlement_hook',
      sellerId: settlement.sellerId,
      sourceURL: settlement.receiptURL,
      sourceSha256: settlement.receiptSha256,
      observedAt: settlement.observedAt,
    };
    return this.#catalog.ingest({
      candidate: { sellerId: settlement.sellerId, sequence, entry },
      authority: settlementAuthority(settlement),
      provenance,
    });
  }

  list(params = new URLSearchParams()) { return this.#catalog.list(params); }
  search(params = new URLSearchParams()) { return this.#catalog.search(params); }
  get size() { return this.#catalog.size; }
  get version() { return this.#catalog.version; }
}
