import { discoveryTools, releaseId, routeId, digest } from './catalog/discovery.mjs';
export { discoveryTools } from './catalog/discovery.mjs';
// MIT. Agent-facing operation of the original SF82 signed catalog lifecycle.
import { releaseCatalogStatus, reviewReleaseCatalog, applyReleaseCatalog }
  from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-catalog.mjs';
import { failure, identifier } from './config.mjs';






// The original review stays on the host. Agents receive its public comparison
// and exact ID, without the catalog directory or signing-key file reference.
function publicView(value) {
  const result = structuredClone(value);
  if (result.catalog) delete result.catalog.directory;
  if (result.status?.catalog) delete result.status.catalog.directory;
  return result;
}
function publicFailure(error) {
  const code = [error?.code, error?.message].find(value =>
    typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/.test(value)) ?? 'MERCHANT_DISCOVERY_FAILED';
  return failure(code, `Catalog operation returned ${code}. Read merchant_discovery_status for current listings; check the host connection if it is unavailable.`);
}

/** One pending host review; the original journal remains the durable record. */
export class MerchantDiscovery {
  #root; #config; #review = null; #lastApply = null;
  constructor({ releaseStore, catalog }) { this.#root = releaseStore; this.#config = catalog; }
  get summary() {
    return { configured: Boolean(this.#config),
      review: this.#review ? { id: this.#review.id, releaseId: this.#review.release.id,
        action: this.#review.action, changes: this.#review.changes.length } : null,
      lastApply: structuredClone(this.#lastApply) };
  }
  #connection() {
    if (!this.#config) throw failure('MERCHANT_CATALOG_NOT_CONFIGURED',
      'Configure catalogConnection in the merchant host file, or initialize with --catalog CONNECTION_JSON.');
    return this.#config;
  }
  async status({ id }) {
    identifier(id, 'Release ID');
    if (!this.#config) return { ...this.summary, releaseId: id };
    try {
      return { ...publicView(await releaseCatalogStatus(this.#root, {
        config: this.#config, releaseId: id })), ...this.summary };
    } catch (error) { throw publicFailure(error); }
  }
  async review({ id, action = 'publish', routeId, reason }) {
    identifier(id, 'Release ID');
    const config = this.#connection();
    this.#review = null;
    try {
      const review = await reviewReleaseCatalog(this.#root, { config, releaseId: id, action, routeId, reason });
      this.#review = review;
      return publicView(review);
    } catch (error) { throw publicFailure(error); }
  }
  async apply({ reviewId }) {
    if (typeof reviewId !== 'string' || !/^[a-f0-9]{64}$/.test(reviewId) || this.#review?.id !== reviewId)
      throw failure('MERCHANT_CATALOG_REVIEW_REQUIRED', 'Use the exact latest merchant_discovery_review ID from this host.');
    const config = this.#connection(), review = this.#review;
    // Consume before awaiting: neither another caller nor a lost MCP response
    // can use this handle to blindly repeat the original signed write.
    this.#review = null;
    this.#lastApply = { reviewId, releaseId: review.release.id, action: review.action, phase: 'APPLYING' };
    try {
      const result = await applyReleaseCatalog(this.#root, { config, review });
      this.#lastApply = { ...this.#lastApply, phase: 'RETURNED', decision: result.decision,
        signaturesIssued: result.signaturesIssued,
        ...(result.receipt ? { receipt: structuredClone(result.receipt) } : {}) };
      return { ...publicView(result), lastApply: structuredClone(this.#lastApply) };
    } catch (error) {
      const problem = publicFailure(error);
      this.#lastApply = { ...this.#lastApply, phase: 'RETURNED_ERROR', error: { code: problem.code },
        ...(typeof error.commandSent === 'boolean' ? { commandSent: error.commandSent } : {}),
        ...(typeof error.requestId === 'string' ? { requestId: error.requestId } : {}),
        ...(Number.isInteger(error.statusCode) ? { httpStatus: error.statusCode } : {}) };
      throw problem;
    }
  }
}
