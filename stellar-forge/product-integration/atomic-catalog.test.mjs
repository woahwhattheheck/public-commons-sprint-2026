import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicCatalogIntegration } from './atomic-catalog.mjs';

const entry = (origin, amount = '20000') => ({
  resource: { url: `${origin}/weather`, description: 'Verified weather observations', serviceName: 'Weather seller' },
  accepts: [{ network: 'stellar:testnet', scheme: 'exact', payTo: `G${origin.includes('two') ? 'TWO' : 'ONE'}`, amount, asset: 'USDC:TEST' }],
  extensions: { bazaar: {
    info: { input: { type: 'http', method: 'GET', description: 'City weather' }, output: { type: 'json' } },
    schema: { type: 'object', properties: { city: { type: 'string' } } },
  } },
});

const authority = (sellerId, origin, signer = `G-${sellerId}-SIGNER`) => ({
  sellerId, signer,
  allowedOrigins: new Set([origin]),
  allowedRecipients: new Set([`G${origin.includes('two') ? 'TWO' : 'ONE'}`]),
  allowedNetworks: new Set(['stellar:testnet']),
  allowedSchemes: new Set(['exact']),
});

const provenance = (sellerId, n = 1) => ({
  authority: 'settlement_hook', sellerId,
  sourceURL: `https://facilitator.example/receipts/${sellerId}/${n}`,
  sourceSha256: String(n).padStart(64, '0'),
  observedAt: `2026-10-10T03:0${n}:00.000Z`,
});

test('replay, stale and rejected authority never mutate public catalog generation', () => {
  const product = new AtomicCatalogIntegration();
  const one = { sellerId: 'seller-1', sequence: 1, entry: entry('https://one.example') };
  const two = { sellerId: 'seller-2', sequence: 1, entry: entry('https://two.example') };
  const first = product.ingest({ candidate: one, authority: authority('seller-1', 'https://one.example'), provenance: provenance('seller-1') });
  product.ingest({ candidate: two, authority: authority('seller-2', 'https://two.example'), provenance: provenance('seller-2') });
  assert.equal(first.decision, 'accepted');
  assert.equal(product.version, 2);

  const page1 = product.search(new URLSearchParams({ query: 'weather', limit: '1' }));
  assert.ok(page1.pagination.cursor);
  const version = product.version;
  assert.equal(product.ingest({ candidate: one, authority: authority('seller-1', 'https://one.example'), provenance: provenance('seller-1') }).reason, 'EXACT_REPLAY');
  assert.equal(product.ingest({ candidate: { ...one, sequence: 0 }, authority: authority('seller-1', 'https://one.example'), provenance: provenance('seller-1') }).reason, 'SEQUENCE_INVALID');

  const changed = { sellerId: 'seller-1', sequence: 2, entry: entry('https://one.example', '15000') };
  const rejected = product.ingest({ candidate: changed, authority: authority('seller-1', 'https://one.example', 'G-WRONG-SIGNER'), provenance: provenance('seller-1', 2) });
  assert.equal(rejected.reason, 'SELLER_SIGNER_CONFLICT');
  assert.equal(product.version, version);
  assert.doesNotThrow(() => product.search(new URLSearchParams({ query: 'weather', limit: '1', cursor: page1.pagination.cursor })));
});

test('accepted update invalidates old cursor and retirement removes public listing atomically', () => {
  const product = new AtomicCatalogIntegration();
  const one = { sellerId: 'seller-1', sequence: 1, entry: entry('https://one.example') };
  const two = { sellerId: 'seller-2', sequence: 1, entry: entry('https://two.example') };
  const accepted = product.ingest({ candidate: one, authority: authority('seller-1', 'https://one.example'), provenance: provenance('seller-1') });
  product.ingest({ candidate: two, authority: authority('seller-2', 'https://two.example'), provenance: provenance('seller-2') });
  const cursor = product.search(new URLSearchParams({ query: 'weather', limit: '1' })).pagination.cursor;

  const changed = { sellerId: 'seller-1', sequence: 2, entry: entry('https://one.example', '15000') };
  assert.equal(product.ingest({ candidate: changed, authority: authority('seller-1', 'https://one.example'), provenance: provenance('seller-1', 2) }).decision, 'accepted');
  assert.throws(() => product.search(new URLSearchParams({ query: 'weather', limit: '1', cursor })), /Stale or invalid cursor/);
  assert.equal(product.list().resources.find(row => row.resource.url.includes('one.example')).accepts[0].amount, '15000');

  const retired = product.retire({ id: accepted.id, sellerId: 'seller-1', sequence: 3, provenance: provenance('seller-1', 3), reason: 'seller withdrew route' });
  assert.equal(retired.reason, 'RETIRED');
  assert.equal(product.size, 1);
  assert.equal(product.list().resources.some(row => row.resource.url.includes('one.example')), false);
  assert.equal(product.lifecycle(accepted.id, { asOf: '2026-10-10T03:04:00Z' }), null);
});
