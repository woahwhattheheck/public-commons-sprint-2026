import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LifecycleCatalog, STORAGE_SCHEMA, normalizeDiscoveryRecord } from './lifecycle.mjs';

const fixturePath = new URL('../../tools/stellar_bazaar_interop/official_bazaar_resource.json', import.meta.url);
const fixtureBytes = await readFile(fixturePath);
const official = JSON.parse(fixtureBytes);
const sourceSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
const provenance = (overrides = {}) => ({
  authority: 'provider_response',
  sourceURL: 'https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/e02752b69732d447e0f56a8686644e345335ae52/tools/stellar_bazaar_interop/official_bazaar_resource.json',
  sourceSha256,
  observedAt: '2026-10-10T02:00:00.000Z',
  ...overrides,
});

test('preserved canonical x402 discovery example normalizes without changing payment facts', () => {
  assert.equal(sourceSha256, 'e763de003a950eeb9855bfd9b8856d390856c2ba23e3069626b26158fe97115c');
  const record = normalizeDiscoveryRecord(official, provenance());
  assert.equal(record.schemaVersion, STORAGE_SCHEMA);
  assert.equal(record.kind, 'http');
  assert.equal(record.resourceURL, 'https://api.example.com/x402/weather');
  assert.deepEqual(record.accepts, [{
    amount: '200', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    extra: { name: 'USD Coin', version: '2' }, network: 'eip155:8453',
    payTo: '0xa2477E16dCB42E2AD80f03FE97D7F1a1646cd1c0', scheme: 'exact',
  }]);
  assert.equal(record.ownershipConfidence, 'operator_reported');
  assert.equal(record.provenance.sourceSha256, sourceSha256);
});

test('correction, freshness, retirement and snapshot round-trip are explicit', () => {
  const catalog = new LifecycleCatalog();
  const first = catalog.upsert(official, provenance({ authority: 'signed_export', sellerId: 'seller.example' }), 10);
  assert.equal(first.reason, 'NEW_RESOURCE');
  assert.equal(catalog.upsert(official, provenance({ authority: 'signed_export', sellerId: 'seller.example' }), 10).reason, 'EXACT_REPLAY');

  const corrected = structuredClone(official); corrected.accepts[0].amount = '175';
  assert.equal(catalog.upsert(corrected, provenance({ authority: 'signed_export', sellerId: 'seller.example', observedAt: '2026-10-10T03:00:00Z' }), 11).reason, 'CORRECTION');
  assert.equal(catalog.get(first.id, { asOf: '2026-10-10T03:30:00Z', maxAgeSeconds: 3600 }).freshness, 'fresh');
  assert.equal(catalog.get(first.id, { asOf: '2026-10-11T03:30:00Z', maxAgeSeconds: 3600 }).freshness, 'stale');

  const snapshot = catalog.snapshot();
  const restored = LifecycleCatalog.fromSnapshot(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  assert.equal(restored.history(first.id).length, 2);

  const retirementProof = provenance({ authority: 'signed_export', sellerId: 'seller.example', observedAt: '2026-10-10T04:00:00Z' });
  assert.equal(restored.retire(first.id, { sellerId: 'seller.example', sequence: 12, provenance: retirementProof, reason: 'seller withdrew route' }).reason, 'RETIRED');
  assert.equal(restored.get(first.id, { asOf: '2026-10-10T04:00:01Z' }), null);
  assert.equal(restored.get(first.id, { asOf: '2026-10-10T04:00:01Z', includeRetired: true }).state, 'retired');
});

test('unverifiable or lossy facts and corrupt migrations fail closed', () => {
  assert.throws(() => normalizeDiscoveryRecord(official, { ...provenance(), sourceSha256: 'unknown' }), /PROVENANCE_SHA256_INVALID/);
  const numeric = structuredClone(official); numeric.accepts[0].amount = 200;
  assert.throws(() => normalizeDiscoveryRecord(numeric, provenance()), /PAYMENT_AMOUNT_MUST_BE_POSITIVE_BASE_UNIT_STRING/);

  const catalog = new LifecycleCatalog();
  const inserted = catalog.upsert(official, provenance({ authority: 'signed_export', sellerId: 'seller.example' }), 1);
  const changedOwner = provenance({ authority: 'signed_export', sellerId: 'attacker.example' });
  assert.equal(catalog.upsert({ ...official, lastUpdated: 'changed' }, changedOwner, 2).reason, 'SELLER_IDENTITY_CHANGED');
  assert.equal(catalog.retire(inserted.id, { sellerId: 'attacker.example', sequence: 2, provenance: changedOwner, reason: 'takeover' }).reason, 'SELLER_IDENTITY_MISMATCH');

  const unknown = catalog.snapshot(); unknown.schemaVersion = 'stellar-forge.catalog-lifecycle/v2';
  assert.throws(() => LifecycleCatalog.fromSnapshot(unknown), /UNSUPPORTED_STORAGE_SCHEMA/);
  const corrupt = catalog.snapshot(); corrupt.resources[0].history[0].record.contentDigest = '0'.repeat(64);
  assert.throws(() => LifecycleCatalog.fromSnapshot(corrupt), /SNAPSHOT_DIGEST_INVALID/);
});
