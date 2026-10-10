// SF-39: focused original-source acceptance for alias correction + retirement.
// Uses the shipped SF-46 product, not a replacement parser or test double.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicCatalogIntegration } from '../../../stellar-forge/product-integration/atomic-catalog.mjs';

const origin = 'https://seller.example';
const sellerId = 'seller.one';
const entry = (unit, amount) => ({
  resource: {
    url: `${origin}/weather?units=${unit}`,
    serviceName: 'Verified weather seller',
    description: 'Paid weather observations with transparent units',
  },
  accepts: [{ network: 'stellar:testnet', scheme: 'exact', payTo: 'GSELLER', asset: 'USDC:TEST', amount }],
  extensions: { bazaar: {
    routeTemplate: '/weather',
    info: { input: { type: 'http', method: 'GET', description: 'Weather observations' } },
    schema: { type: 'object', properties: { location: { type: 'string' } } },
  } },
});
const authority = (signer = 'GSELLER-SIGNER') => ({
  sellerId, signer,
  allowedOrigins: new Set([origin]),
  allowedRecipients: new Set(['GSELLER']),
  allowedNetworks: new Set(['stellar:testnet']),
  allowedSchemes: new Set(['exact']),
});
const provenance = n => ({
  authority: 'settlement_hook', sellerId,
  sourceURL: `https://receipts.example/seq/${n}`,
  sourceSha256: String(n).padStart(64, '0'),
  observedAt: `2026-10-10T04:0${n}:00.000Z`,
});

test('changing concrete query aliases of one authorized route does not leave retired paid offers public', () => {
  const product = new AtomicCatalogIntegration();
  let lifecycleId;
  for (const [index, [unit, amount]] of [
    ['metric', '20000'], ['imperial', '21000'], ['kelvin', '22000'], ['metric', '23000'],
  ].entries()) {
    const sequence = index + 1;
    const outcome = product.ingest({
      candidate: { sellerId, sequence, entry: entry(unit, amount) },
      authority: authority(), provenance: provenance(sequence),
    });
    assert.equal(outcome.decision, 'accepted', JSON.stringify(outcome));
    if (lifecycleId === undefined) lifecycleId = outcome.id;
    assert.equal(outcome.id, lifecycleId, 'one canonical lifecycle route');
    assert.equal(product.size, 1, 'no abandoned public query variants');
    assert.deepEqual(product.list().resources.map(row => row.resource.url),
      [`${origin}/weather?units=${unit}`]);
    assert.equal(product.search(new URLSearchParams({ query: 'weather' })).resources.length, 1);
    assert.equal(product.list().resources[0].accepts[0].amount, amount);
    assert.equal(product.snapshot().projection.length, 1);
  }
  const generation = product.version;
  const rejected = product.ingest({
    candidate: { sellerId, sequence: 5, entry: entry('rogue', '99999') },
    authority: authority('G-WRONG-SIGNER'), provenance: provenance(5),
  });
  assert.equal(rejected.reason, 'SELLER_SIGNER_CONFLICT');
  assert.equal(product.version, generation);
  assert.equal(product.size, 1);
  const retired = product.retire({
    id: lifecycleId, sellerId, sequence: 5, provenance: provenance(5),
    reason: 'Seller retired this weather service',
  });
  assert.equal(retired.decision, 'accepted', JSON.stringify(retired));
  assert.equal(product.size, 0);
  assert.deepEqual(product.list().resources, []);
  assert.deepEqual(product.search(new URLSearchParams({ query: 'weather' })).resources, []);
});
