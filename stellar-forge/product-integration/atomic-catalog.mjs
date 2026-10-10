/**
 * SF-46 atomic projection across the accepted SF-21, SF-27 and PR451 modules.
 *
 * No network payment or signature verification happens here. The caller must
 * supply authenticated authority and immutable provenance from its canonical
 * facilitator hook. All mutable product state is staged before a pointer swap.
 */
import { BazaarCatalog } from '../../scf46-stellar-bazaar/src/catalog.mjs';
import { CatalogTrustBoundary } from '../catalog-trust/catalog-trust.mjs';
import { LifecycleCatalog } from '../catalog-lifecycle/lifecycle.mjs';

const clone = value => structuredClone(value);

export class AtomicCatalogIntegration {
  #live = new BazaarCatalog();
  #lifecycle = new LifecycleCatalog();
  #catalogKeys = new Map();
  #trust = new CatalogTrustBoundary(new BazaarCatalog());

  ingest({ candidate, authority, provenance }) {
    const sequence = candidate?.sequence;
    if (!Number.isSafeInteger(sequence) || sequence <= 0) {
      return { decision: 'reject', reason: 'SEQUENCE_INVALID' };
    }
    if (provenance?.sellerId !== candidate?.sellerId) {
      return { decision: 'reject', reason: 'PROVENANCE_SELLER_MISMATCH' };
    }

    // Stage lifecycle and public projection first. Neither is externally
    // visible until the trust boundary accepts the same immutable candidate.
    let stagedLifecycle;
    let lifecycleResult;
    let stagedLive;
    let catalogKey;
    try {
      stagedLifecycle = LifecycleCatalog.fromSnapshot(this.#lifecycle.snapshot());
      lifecycleResult = stagedLifecycle.upsert(candidate.entry, provenance, sequence);
      if (lifecycleResult.decision !== 'accepted') return lifecycleResult;
      stagedLive = this.#live.clone();
      catalogKey = stagedLive.insertValidated(candidate.entry);
    } catch (error) {
      return { decision: 'reject', reason: 'INTEGRATION_PREFLIGHT_REJECTED', detail: error?.message ?? 'Error' };
    }

    const trustResult = this.#trust.ingest(candidate, authority);
    if (trustResult.decision !== 'accepted') return trustResult;
    if (trustResult.catalogKey !== catalogKey) {
      return { decision: 'reject', reason: 'CATALOG_KEY_DIVERGENCE' };
    }

    // Atomic publication point for readers of this coordinator.
    this.#lifecycle = stagedLifecycle;
    this.#live = stagedLive;
    this.#catalogKeys.set(lifecycleResult.id, catalogKey);
    return {
      decision: 'accepted',
      reason: lifecycleResult.reason,
      id: lifecycleResult.id,
      catalogKey,
      revision: lifecycleResult.revision,
      catalogVersion: this.#live.version,
      auditHead: trustResult.auditHead,
    };
  }

  retire({ id, sellerId, sequence, provenance, reason }) {
    const catalogKey = this.#catalogKeys.get(id);
    if (!catalogKey) return { decision: 'reject', reason: 'RESOURCE_UNKNOWN', id };
    let stagedLifecycle;
    let lifecycleResult;
    let stagedLive;
    try {
      stagedLifecycle = LifecycleCatalog.fromSnapshot(this.#lifecycle.snapshot());
      lifecycleResult = stagedLifecycle.retire(id, { sellerId, sequence, provenance, reason });
      if (lifecycleResult.decision !== 'accepted') return lifecycleResult;
      stagedLive = this.#live.clone();
      if (!stagedLive.removeValidated(catalogKey)) {
        return { decision: 'reject', reason: 'PROJECTION_MISSING', id };
      }
    } catch (error) {
      return { decision: 'reject', reason: 'INTEGRATION_PREFLIGHT_REJECTED', detail: error?.message ?? 'Error' };
    }

    this.#lifecycle = stagedLifecycle;
    this.#live = stagedLive;
    this.#catalogKeys.delete(id);
    return { ...lifecycleResult, catalogKey, catalogVersion: this.#live.version };
  }

  list(params = new URLSearchParams()) { return this.#live.list(params); }
  search(params = new URLSearchParams()) { return this.#live.search(params); }
  lifecycle(id, options) { return this.#lifecycle.get(id, options); }
  snapshot() {
    return clone({
      lifecycle: this.#lifecycle.snapshot(),
      projection: [...this.#catalogKeys].sort(([a], [b]) => a.localeCompare(b)),
      catalogVersion: this.#live.version,
    });
  }
  get size() { return this.#live.size; }
  get version() { return this.#live.version; }
}
