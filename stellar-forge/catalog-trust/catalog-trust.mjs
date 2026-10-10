/**
 * SF-27: fail-closed trust boundary for x402 Bazaar catalog ingestion.
 *
 * This module does not verify signatures or payments.  Its caller must provide
 * an authenticated seller context produced by the canonical facilitator.  The
 * boundary makes that authority explicit, constrains hostile metadata, and
 * only then calls the real BazaarCatalog.insertValidated parser/indexer.
 */
import { createHash } from 'node:crypto';
import { validateCatalogEntry } from '../../scf46-stellar-bazaar/src/catalog.mjs';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(canonical(value)), 'utf8');
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function reject(reason, detail = undefined) {
  return { ok: false, reason, ...(detail === undefined ? {} : { detail }) };
}

function inspectTree(value, limits, depth = 0, state = { nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > limits.maxNodes) return reject('METADATA_NODE_LIMIT');
  if (depth > limits.maxDepth) return reject('METADATA_DEPTH_LIMIT');
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > limits.maxStringBytes) return reject('METADATA_STRING_LIMIT');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return reject('METADATA_CONTROL_CHARACTER');
    return { ok: true };
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayItems) return reject('METADATA_ARRAY_LIMIT');
    for (const item of value) {
      const result = inspectTree(item, limits, depth + 1, state);
      if (!result.ok) return result;
    }
    return { ok: true };
  }
  if (value !== null && typeof value === 'object') {
    if (!plain(value)) return reject('METADATA_NON_PLAIN_OBJECT');
    const keys = Object.keys(value);
    if (keys.some(key => FORBIDDEN_KEYS.has(key))) return reject('METADATA_FORBIDDEN_KEY');
    for (const key of keys) {
      if (Buffer.byteLength(key, 'utf8') > limits.maxKeyBytes) return reject('METADATA_KEY_LIMIT');
      const result = inspectTree(value[key], limits, depth + 1, state);
      if (!result.ok) return result;
    }
  }
  return { ok: true };
}

function originOf(entry) {
  try {
    const url = new URL(entry?.resource?.url);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

function inspectAccepts(accepts, authority) {
  if (!Array.isArray(accepts) || accepts.length === 0) return reject('PAYMENT_TERMS_MISSING');
  const seen = new Map();
  for (const term of accepts) {
    if (!plain(term)) return reject('PAYMENT_TERM_INVALID');
    if (!authority.allowedRecipients.has(term.payTo)) return reject('PAYMENT_RECIPIENT_UNAUTHORIZED', term.payTo);
    if (!authority.allowedNetworks.has(term.network)) return reject('PAYMENT_NETWORK_UNAUTHORIZED', term.network);
    if (!authority.allowedSchemes.has(term.scheme)) return reject('PAYMENT_SCHEME_UNAUTHORIZED', term.scheme);
    const key = `${term.network}|${term.scheme}|${term.payTo}`;
    const hash = digest(term);
    if (seen.has(key) && seen.get(key) !== hash) return reject('PAYMENT_TERM_CONFLICT', key);
    seen.set(key, hash);
  }
  return { ok: true };
}

/**
 * authority shape (trusted caller only):
 * { sellerId, signer, allowedOrigins, allowedRecipients, allowedNetworks,
 *   allowedSchemes }
 *
 * candidate shape (untrusted): { sellerId, sequence, entry }
 */
export class CatalogTrustBoundary {
  #catalog;
  #limits;
  #resources = new Map();
  #sellerSigners = new Map();
  #originOwners = new Map();
  #audit = [];
  #auditHead = '0'.repeat(64);

  constructor(catalog, limits = {}) {
    if (!catalog || typeof catalog.insertValidated !== 'function') throw new TypeError('Bazaar catalog required');
    this.#catalog = catalog;
    this.#limits = Object.freeze({
      maxDocumentBytes: limits.maxDocumentBytes ?? 65_536,
      maxStringBytes: limits.maxStringBytes ?? 4_096,
      maxKeyBytes: limits.maxKeyBytes ?? 256,
      maxArrayItems: limits.maxArrayItems ?? 64,
      maxDepth: limits.maxDepth ?? 12,
      maxNodes: limits.maxNodes ?? 2_048,
    });
  }

  #record(decision, reason, facts = {}) {
    const event = canonical({ index: this.#audit.length + 1, decision, reason, ...facts });
    const eventHash = digest({ previousHash: this.#auditHead, event });
    this.#auditHead = eventHash;
    this.#audit.push(Object.freeze({ ...event, previousHash: this.#audit.at(-1)?.eventHash ?? '0'.repeat(64), eventHash }));
  }

  #finish(decision, reason, facts = {}, extra = {}) {
    this.#record(decision, reason, facts);
    return { decision, reason, auditHead: this.#auditHead, ...extra };
  }

  ingest(candidate, authority) {
    const sellerId = candidate?.sellerId;
    const sequence = candidate?.sequence;
    const entry = candidate?.entry;
    const signer = authority?.signer;
    const facts = { sellerId, sequence };

    if (!plain(candidate) || !plain(authority) || !plain(entry)) {
      return this.#finish('quarantine', 'ENVELOPE_INVALID', facts);
    }
    if (typeof sellerId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(sellerId) ||
        authority.sellerId !== sellerId) {
      return this.#finish('quarantine', 'SELLER_IDENTITY_MISMATCH', facts);
    }
    if (typeof signer !== 'string' || signer.length < 3 || signer.length > 256) {
      return this.#finish('quarantine', 'SELLER_SIGNER_INVALID', facts);
    }
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      return this.#finish('quarantine', 'SEQUENCE_INVALID', facts);
    }
    for (const field of ['allowedOrigins', 'allowedRecipients', 'allowedNetworks', 'allowedSchemes']) {
      if (!(authority[field] instanceof Set) || authority[field].size === 0) {
        return this.#finish('quarantine', 'AUTHORITY_POLICY_INVALID', { ...facts, field });
      }
    }
    const knownSigner = this.#sellerSigners.get(sellerId);
    if (knownSigner !== undefined && knownSigner !== signer) {
      return this.#finish('quarantine', 'SELLER_SIGNER_CONFLICT', facts);
    }
    const origin = originOf(entry);
    if (!origin || !authority.allowedOrigins.has(origin)) {
      return this.#finish('quarantine', 'RESOURCE_ORIGIN_UNAUTHORIZED', { ...facts, origin });
    }
    const originOwner = this.#originOwners.get(origin);
    if (originOwner !== undefined && originOwner !== sellerId) {
      return this.#finish('quarantine', 'SELLER_ORIGIN_CONFLICT', { ...facts, origin, owner: originOwner });
    }
    let documentBytes;
    try { documentBytes = bytes(entry); }
    catch { return this.#finish('quarantine', 'METADATA_NOT_SERIALIZABLE', facts); }
    if (documentBytes > this.#limits.maxDocumentBytes) {
      return this.#finish('quarantine', 'METADATA_DOCUMENT_LIMIT', { ...facts, documentBytes });
    }
    const tree = inspectTree(entry, this.#limits);
    if (!tree.ok) return this.#finish('quarantine', tree.reason, facts);
    const payments = inspectAccepts(entry.accepts, authority);
    if (!payments.ok) return this.#finish('quarantine', payments.reason, { ...facts, detail: payments.detail });

    const candidateHash = digest({ sellerId, sequence, entry });
    let catalogKey, validatedEntry;
    try {
      // Compute the exact parser key and sanitized entry without mutating the
      // live catalog. Replay, sequence and ownership gates run before commit.
      ({ id: catalogKey, entry: validatedEntry } = validateCatalogEntry(entry));
    } catch (error) {
      return this.#finish('quarantine', 'CATALOG_PARSER_REJECTED', { ...facts, error: error?.name ?? 'Error' });
    }
    const previous = this.#resources.get(catalogKey);
    if (previous && sequence === previous.sequence && candidateHash === previous.candidateHash) {
      return this.#finish('soft_drop', 'EXACT_REPLAY', { ...facts, catalogKey }, { catalogKey });
    }
    if (previous && sequence <= previous.sequence) {
      return this.#finish('quarantine', sequence === previous.sequence ? 'CONFLICTING_REPLAY' : 'STALE_SEQUENCE',
        { ...facts, catalogKey, previousSequence: previous.sequence });
    }
    if (previous && previous.sellerId !== sellerId) {
      return this.#finish('quarantine', 'RESOURCE_SELLER_CONFLICT', { ...facts, catalogKey, owner: previous.sellerId });
    }

    this.#catalog.insertValidated(validatedEntry);

    this.#sellerSigners.set(sellerId, signer);
    this.#originOwners.set(origin, sellerId);
    this.#resources.set(catalogKey, { sellerId, sequence, candidateHash, entry: structuredClone(entry) });
    return this.#finish('accepted', previous ? 'AUTHORIZED_UPDATE' : 'NEW_RESOURCE',
      { ...facts, catalogKey, documentBytes }, { catalogKey });
  }

  auditTrail() { return structuredClone(this.#audit); }
  get auditHead() { return this.#auditHead; }
}

export function verifyAuditTrail(events) {
  let head = '0'.repeat(64);
  for (let index = 0; index < events.length; index++) {
    const { previousHash, eventHash, ...event } = events[index];
    if (previousHash !== head || event.index !== index + 1) return false;
    const expected = digest({ previousHash: head, event: canonical(event) });
    if (eventHash !== expected) return false;
    head = eventHash;
  }
  return true;
}
