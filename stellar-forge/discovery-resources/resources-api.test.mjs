import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createDiscoveryServer } from '../../scf46-stellar-bazaar/src/catalog.mjs';
import { AtomicCatalogIntegration } from '../product-integration/atomic-catalog.mjs';
import { PaymentAutoCatalog } from '../payment-auto-catalog/auto-catalog.mjs';

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
  properties: { input: { type: 'object', properties: { type: { const: 'http' }, method: { const: 'GET' } }, required: ['type', 'method'], additionalProperties: false } },
  required: ['input'], additionalProperties: false,
};

function payload(origin, payTo, amount = '20000') {
  return {
    x402Version: 2,
    resource: { url: `${origin}/weather`, description: 'Verified weather observations' },
    accepted: { network: 'stellar:testnet', scheme: 'exact', payTo, asset: 'USDC:TEST', amount, maxTimeoutSeconds: 60, extra: {} },
    payload: { transaction: 'fixture-not-a-real-transaction' },
    extensions: { bazaar: { info: { input: { type: 'http', method: 'GET' } }, schema: structuredClone(schema) } },
  };
}

function settlement(sellerId, origin, payTo, n = 1, amount = '20000') {
  return {
    status: 'settled', sellerId, signer: `G-${sellerId}-AUTHENTICATED`, origin,
    network: 'stellar:testnet', scheme: 'exact', payTo, asset: 'USDC:TEST', amount,
    receiptURL: `https://facilitator.example/receipts/${sellerId}/${n}`,
    receiptSha256: String(n).padStart(64, sellerId === 'seller-a' ? 'a' : 'b'),
    observedAt: `2026-10-10T03:4${n}:00.000Z`,
  };
}

function insert(product, sellerId, origin, payTo, sequence = 1, amount = '20000') {
  return product.ingest({ paymentPayload: payload(origin, payTo, amount), settlement: settlement(sellerId, origin, payTo, sequence, amount), sequence });
}

async function serve(product, run) {
  const server = createServer(createDiscoveryServer(product));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('resources endpoint has canonical cross-rebuild order and exact filters/pagination', async () => {
  const forward = new PaymentAutoCatalog();
  const reverse = new PaymentAutoCatalog();
  insert(forward, 'seller-b', 'https://b.example', 'GB'); insert(forward, 'seller-a', 'https://a.example', 'GA');
  insert(reverse, 'seller-a', 'https://a.example', 'GA'); insert(reverse, 'seller-b', 'https://b.example', 'GB');
  assert.deepEqual(forward.list().resources, reverse.list().resources);
  assert.deepEqual(forward.list().resources.map(row => row.resource.url), ['https://a.example/weather', 'https://b.example/weather']);

  await serve(forward, async base => {
    const query = 'type=http&payTo=GA&network=stellar:testnet&scheme=exact&extensions=bazaar&limit=1&offset=0';
    const response = await fetch(`${base}/discovery/resources?${query}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.resources.length, 1); assert.equal(body.resources[0].resource.url, 'https://a.example/weather');
    assert.deepEqual(body.pagination, { offset: 0, limit: 1, total: 1 });

    const empty = await (await fetch(`${base}/discovery/resources?limit=5&offset=99`)).json();
    assert.deepEqual(empty.resources, []); assert.equal(empty.pagination.total, 2);
    assert.equal((await fetch(`${base}/discovery/resources?offset=bad`)).status, 400);
    const before = forward.size;
    assert.equal((await fetch(`${base}/discovery/resources`, { method: 'POST' })).status, 405);
    assert.equal(forward.size, before);
  });
});

test('accepted correction and retirement are observable through the real read-only handler', async () => {
  const integrated = new AtomicCatalogIntegration();
  const product = new PaymentAutoCatalog(integrated);
  const first = insert(product, 'seller-a', 'https://a.example', 'GA');
  assert.equal(first.decision, 'accepted');
  assert.equal(insert(product, 'seller-a', 'https://a.example', 'GA', 2, '15000').decision, 'accepted');

  await serve(product, async base => {
    let body = await (await fetch(`${base}/discovery/resources`)).json();
    assert.equal(body.resources[0].accepts[0].amount, '15000');

    const proof = {
      authority: 'settlement_hook', sellerId: 'seller-a',
      sourceURL: 'https://facilitator.example/receipts/seller-a/3', sourceSha256: 'a'.repeat(64),
      observedAt: '2026-10-10T03:43:00.000Z',
    };
    assert.equal(integrated.retire({ id: first.id, sellerId: 'seller-a', sequence: 3, provenance: proof, reason: 'seller withdrew route' }).reason, 'RETIRED');
    body = await (await fetch(`${base}/discovery/resources`)).json();
    assert.deepEqual(body.resources, []); assert.equal(body.pagination.total, 0);
  });
});
