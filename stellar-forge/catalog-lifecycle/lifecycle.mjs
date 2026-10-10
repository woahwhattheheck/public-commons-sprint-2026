/**
 * SF-21 versioned paid-resource lifecycle model.
 * Normalizes canonical Bazaar discovery records without upgrading source
 * provenance into proof of seller ownership or payment settlement.
 */
import { createHash } from 'node:crypto';
import { resolveCatalogIdentity } from '../route-identity/identity.mjs';

export const STORAGE_SCHEMA = 'stellar-forge.catalog-lifecycle/v1';
const AUTHORITIES = new Set(['provider_response', 'signed_export', 'settlement_hook']);
const safeText = (value, max = 512) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const stable = value => JSON.stringify(canonical(value));
const sha256 = value => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
const clone = value => structuredClone(value);

function sourceURL(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new TypeError('PROVENANCE_SOURCE_URL_INVALID'); }
}

function normalizeProvenance(value) {
  if (!plain(value) || !AUTHORITIES.has(value.authority)) throw new TypeError('PROVENANCE_AUTHORITY_INVALID');
  if (!/^[a-f0-9]{64}$/.test(value.sourceSha256 ?? '')) throw new TypeError('PROVENANCE_SHA256_INVALID');
  const instant = new Date(value.observedAt);
  if (!Number.isFinite(instant.getTime())) throw new TypeError('PROVENANCE_TIME_INVALID');
  if (value.authority !== 'provider_response' && !safeText(value.sellerId, 128)) {
    throw new TypeError('PROVENANCE_SELLER_REQUIRED');
  }
  return {
    authority: value.authority,
    sourceURL: sourceURL(value.sourceURL),
    sourceSha256: value.sourceSha256,
    observedAt: instant.toISOString(),
    ...(safeText(value.sellerId, 128) ? { sellerId: value.sellerId } : {}),
  };
}

function ownershipConfidence(provenance) {
  if (provenance.authority === 'settlement_hook') return 'settlement_bound';
  if (provenance.authority === 'signed_export') return 'signed_attested';
  return 'operator_reported';
}

function normalizePayment(term) {
  if (!plain(term)) throw new TypeError('PAYMENT_TERM_INVALID');
  const amount = term.amount ?? term.maxAmountRequired;
  if (typeof amount !== 'string' || !/^[0-9]+$/.test(amount) || BigInt(amount) <= 0n) {
    throw new TypeError('PAYMENT_AMOUNT_MUST_BE_POSITIVE_BASE_UNIT_STRING');
  }
  for (const field of ['asset', 'network', 'payTo', 'scheme']) {
    if (!safeText(term[field], 256)) throw new TypeError(`PAYMENT_${field.toUpperCase()}_INVALID`);
  }
  if (!/^[a-z0-9]+:[A-Za-z0-9._-]+$/.test(term.network)) throw new TypeError('PAYMENT_NETWORK_CAIP2_INVALID');
  return {
    amount,
    asset: term.asset,
    network: term.network,
    payTo: term.payTo,
    scheme: term.scheme,
    ...(plain(term.extra) ? { extra: canonical(term.extra) } : {}),
  };
}

function normalizeAccepts(accepts) {
  if (!Array.isArray(accepts) || accepts.length === 0 || accepts.length > 64) throw new TypeError('PAYMENT_TERMS_INVALID');
  const byKey = new Map();
  for (const raw of accepts) {
    const term = normalizePayment(raw);
    const key = [term.network, term.scheme, term.asset, term.payTo, term.amount].join('|');
    const encoded = stable(term);
    if (byKey.has(key) && byKey.get(key) !== encoded) throw new TypeError('PAYMENT_TERM_CONFLICT');
    byKey.set(key, encoded);
  }
  return [...byKey.values()].sort().map(JSON.parse);
}

export function normalizeDiscoveryRecord(raw, provenanceInput) {
  if (!plain(raw)) throw new TypeError('RESOURCE_INVALID');
  const provenance = normalizeProvenance(provenanceInput);
  const resourceURL = typeof raw.resource === 'string' ? raw.resource : raw.resource?.url;
  const bazaar = raw.extensions?.bazaar;
  const originalInput = bazaar?.info?.input;
  if (!plain(originalInput)) throw new TypeError('BAZAAR_INPUT_INVALID');
  const input = { ...clone(originalInput), type: originalInput.type ?? raw.type };
  const identity = resolveCatalogIdentity({ resourceURL, input, routeTemplate: bazaar.routeTemplate });
  if (identity.status === 'rejected') throw new TypeError(`IDENTITY_${identity.reason}`);
  const accepts = normalizeAccepts(raw.accepts);
  const normalized = {
    schemaVersion: STORAGE_SCHEMA,
    id: identity.catalogKey,
    kind: identity.kind,
    resourceURL: identity.resourceURL,
    accepts,
    discovery: canonical({
      input,
      ...(plain(bazaar?.info?.output) ? { output: bazaar.info.output } : {}),
      ...(plain(bazaar?.schema) ? { schema: bazaar.schema } : {}),
      ...(identity.canonicalRouteTemplate ? { routeTemplate: identity.canonicalRouteTemplate } : {}),
    }),
    provenance,
    ownershipConfidence: ownershipConfidence(provenance),
  };
  return { ...normalized, contentDigest: sha256(normalized) };
}

function validateSequence(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('SEQUENCE_INVALID');
}

export class LifecycleCatalog {
  #history = new Map();

  upsert(raw, provenance, sequence) {
    validateSequence(sequence);
    const record = normalizeDiscoveryRecord(raw, provenance);
    const history = this.#history.get(record.id) ?? [];
    const previous = history.at(-1);
    if (previous) {
      if (sequence === previous.sequence && record.contentDigest === previous.record.contentDigest) {
        return { decision: 'soft_drop', reason: 'EXACT_REPLAY', id: record.id, revision: history.length };
      }
      if (sequence <= previous.sequence) {
        return { decision: 'reject', reason: sequence === previous.sequence ? 'CONFLICTING_REPLAY' : 'STALE_SEQUENCE', id: record.id };
      }
      const owner = previous.record.provenance.sellerId;
      if (owner && record.provenance.sellerId !== owner) return { decision: 'reject', reason: 'SELLER_IDENTITY_CHANGED', id: record.id };
    }
    const revision = {
      sequence,
      state: 'active',
      record,
      ...(previous ? { corrects: previous.record.contentDigest } : {}),
    };
    history.push(revision);
    this.#history.set(record.id, history);
    return { decision: 'accepted', reason: previous ? 'CORRECTION' : 'NEW_RESOURCE', id: record.id, revision: history.length };
  }

  retire(id, { sellerId, sequence, provenance, reason }) {
    validateSequence(sequence);
    if (!safeText(reason, 512)) throw new TypeError('RETIREMENT_REASON_INVALID');
    const history = this.#history.get(id);
    if (!history?.length) return { decision: 'reject', reason: 'RESOURCE_UNKNOWN', id };
    const previous = history.at(-1);
    if (sequence <= previous.sequence) return { decision: 'reject', reason: 'STALE_SEQUENCE', id };
    const proof = normalizeProvenance(provenance);
    const owner = previous.record.provenance.sellerId;
    if (!owner || sellerId !== owner || proof.sellerId !== owner) return { decision: 'reject', reason: 'SELLER_IDENTITY_MISMATCH', id };
    history.push({ sequence, state: 'retired', record: previous.record, retiredBy: proof, reason, corrects: previous.record.contentDigest });
    return { decision: 'accepted', reason: 'RETIRED', id, revision: history.length };
  }

  get(id, { asOf, maxAgeSeconds = 86_400, includeRetired = false } = {}) {
    const history = this.#history.get(id);
    if (!history?.length) return null;
    const current = history.at(-1);
    if (current.state === 'retired' && !includeRetired) return null;
    const now = new Date(asOf);
    if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
      throw new TypeError('FRESHNESS_POLICY_INVALID');
    }
    const observed = new Date(current.record.provenance.observedAt);
    const ageSeconds = Math.max(0, Math.floor((now - observed) / 1000));
    return clone({ ...current, revision: history.length, freshness: ageSeconds <= maxAgeSeconds ? 'fresh' : 'stale', ageSeconds });
  }

  history(id) { return clone(this.#history.get(id) ?? []); }

  snapshot() {
    return canonical({
      schemaVersion: STORAGE_SCHEMA,
      resources: [...this.#history.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([id, history]) => ({ id, history: clone(history) })),
    });
  }

  static fromSnapshot(snapshot) {
    if (!plain(snapshot) || snapshot.schemaVersion !== STORAGE_SCHEMA || !Array.isArray(snapshot.resources)) {
      throw new TypeError('UNSUPPORTED_STORAGE_SCHEMA');
    }
    const catalog = new LifecycleCatalog();
    for (const item of snapshot.resources) {
      if (!plain(item) || !safeText(item.id, 4096) || !Array.isArray(item.history) || !item.history.length) {
        throw new TypeError('SNAPSHOT_RESOURCE_INVALID');
      }
      let sequence = 0;
      for (const revision of item.history) {
        validateSequence(revision.sequence);
        if (revision.sequence <= sequence || revision.record?.id !== item.id || revision.record?.schemaVersion !== STORAGE_SCHEMA) {
          throw new TypeError('SNAPSHOT_HISTORY_INVALID');
        }
        const { contentDigest, ...unsigned } = revision.record;
        if (contentDigest !== sha256(unsigned)) throw new TypeError('SNAPSHOT_DIGEST_INVALID');
        sequence = revision.sequence;
      }
      catalog.#history.set(item.id, clone(item.history));
    }
    return catalog;
  }
}
