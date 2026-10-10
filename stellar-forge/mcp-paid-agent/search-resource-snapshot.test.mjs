// MIT. Source-native regression: a read result must not rewrite an approved origin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BazaarCatalog, createDiscoveryServer } from '../../scf46-stellar-bazaar/src/catalog.mjs';
import { McpPaidToolBroker } from './agent-server.mjs';

const terms = { scheme: 'exact', network: 'stellar:testnet', asset: 'TEST-ASSET',
  payTo: 'TEST-RECIPIENT', amount: '25000', maxTimeoutSeconds: 60 };

async function setup(t) {
  const catalog = new BazaarCatalog();
  const server = createServer(createDiscoveryServer(catalog));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const resource = { url: base + '/premium', serviceName: 'Snapshot Test',
    description: 'Resource snapshot discovery test', tags: ['snapshot'] };
  catalog.insertValidated({ resource, accepts: [{ ...terms }], extensions: { bazaar: {
    info: { input: { type: 'http', method: 'GET' } }, schema: { type: 'object' },
  } } });
  const broker = new McpPaidToolBroker({ discoveryUrl: base,
    allowedResourceOrigins: [base], signPayment: null });
  const result = await broker.search({ query: 'snapshot' });
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].allowedOrigin, true);
  return { broker, result, resource, base };
}

test('SF32 search URL mutation cannot bypass the approved-origin boundary', async t => {
  const { broker, result, resource } = await setup(t);
  const row = result.resources[0];
  row.resource.url = 'https://unapproved.example/collector';
  const quote = broker.preview({ handle: row.handle });
  assert.equal(quote.resource, resource.url, 'caller changed the broker private URL');
  assert.equal(quote.selected.payTo, terms.payTo);
  assert.equal(quote.attempts, 0);
  await assert.rejects(broker.execute({ quoteId: quote.quoteId }), { code: 'SIGNER_NOT_CONNECTED' });
});

test('SF32 search snapshots preserve the exact path and survive caller deletion', async t => {
  const { broker, result, resource, base } = await setup(t);
  const row = result.resources[0];
  row.resource.url = base + '/changed-operation?recipient=other';
  row.resource.tags.push('caller-only');
  assert.equal(broker.preview({ handle: row.handle }).resource, resource.url);
  delete row.resource.url;
  assert.equal(broker.preview({ handle: row.handle }).resource, resource.url);
});

test('SF32 snapshot reads retain normal preview, cancellation and independent results', async t => {
  const { broker, result, resource } = await setup(t);
  const next = await broker.search({ query: 'snapshot' });
  assert.notStrictEqual(result.resources[0].resource, next.resources[0].resource);
  const quote = broker.preview({ handle: result.resources[0].handle });
  assert.equal(quote.resource, resource.url);
  assert.equal(quote.status, 'PREVIEWED');
  assert.equal(broker.cancel({ quoteId: quote.quoteId }).status, 'CANCELLED');
  assert.equal((await broker.execute({ quoteId: quote.quoteId })).status, 'CANCELLED');
});
