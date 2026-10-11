// MIT. One source-native export -> backend -> seller cancellation/delivery journey.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { run } from './cli.mjs';
import { importOpenApi } from './importer.mjs';
import { compileOpenApiResponseContract } from './response-contracts.mjs';
import { readSellerConfig, startSellerService } from '../sf30-seller-sdk/serve.mjs';
import { readUpstreamBindings, compileUpstreamBindings, validateUpstreamService, createUpstreamHandlers } from '../sf30-seller-sdk/upstream.mjs';

const dir = await mkdtemp(join(tmpdir(), 'scf-response-contract-'));
const counts = { backend: 0, verified: 0, cancelled: 0, settled: 0 };
let outcome = 'invalid', seller, challenge;
const goodBody = '{ "items": [{"id":"item-1","quantity":7,"note":null}] }\n';
const backend = createServer((_req, res) => {
  counts.backend++;
  if (outcome === 'empty') { res.writeHead(204); res.end(); return; }
  if (outcome === 'head') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(); return; }
  const code = outcome === 'fallback' ? 201 : outcome === 'undeclared' ? 202 : 200;
  res.writeHead(code, { 'content-type': outcome === 'media' ? 'application/problem+json' : 'application/json' });
  res.end(outcome === 'valid' || outcome === 'media' ? goodBody : '{"accepted":true}');
});
try {
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + backend.address().port;
  const spec = { openapi: '3.0.4', info: { title: 'Merchant inventory', version: '1' },
    servers: [{ url: 'https://merchant.example/api' }],
    components: { schemas: { Inventory: { type: 'object', required: ['items'], additionalProperties: false,
      properties: { items: { type: 'array', minItems: 1, items: { type: 'object', required: ['id', 'quantity'],
        properties: { id: { type: 'string' }, quantity: { type: 'integer', minimum: 0 },
          note: { type: 'string', nullable: true } }, additionalProperties: false } } } } },
      responses: { Inventory: { description: 'Current inventory', content: { 'application/json': { schema: { $ref: '#/components/schemas/Inventory' } } } } } },
    paths: { '/inventory': { get: { responses: {
      '200': { $ref: '#/components/responses/Inventory' },
      '201': { description: 'Accepted', content: { 'application/json': { schema: { type: 'object', required: ['accepted'], properties: { accepted: { type: 'boolean' } } } } } },
      '204': { description: 'No inventory' },
    } } }, '/inventory-head': { head: { responses: { '200': { $ref: '#/components/responses/Inventory' } } } } } };
  const terms = { network: 'stellar:testnet', scheme: 'exact', amount: '10000', asset: 'UNVERIFIED_DEMO_ASSET', payTo: 'UNVERIFIED_DEMO_RECIPIENT', maxTimeoutSeconds: 60 };
  const selections = [ { method: 'GET', path: '/inventory', accepts: [terms] },
    { method: 'HEAD', path: '/inventory-head', accepts: [terms] } ];
  const bindings = [ { id: 'inventory', method: 'GET', path: '/inventory', handler: 'inventory' },
    { id: 'inventoryHead', method: 'HEAD', path: '/inventory-head', handler: 'inventoryHead' } ];
  const upstreams = { schema: 'stellar-forge.seller-upstreams.v1', bindings: {
    inventory: { origin, path: '/inventory', method: 'GET' },
    inventoryHead: { origin, path: '/inventory', method: 'HEAD' },
  } };
  for (const [name, data] of Object.entries({ spec, selections, bindings, upstreams }))
    await writeFile(join(dir, name + '.json'), JSON.stringify(data), { mode: 0o600 });
  const output = join(dir, 'export');
  await run(['--spec', join(dir, 'spec.json'), '--config', join(dir, 'selections.json'),
    '--service-bindings', join(dir, 'bindings.json'), '--upstream-bindings', join(dir, 'upstreams.json'), '--out', output]);
  const config = await readSellerConfig(join(output, 'seller-service.json'));
  const exported = await readUpstreamBindings(join(output, 'upstreams.json'));
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.upstreamConfigSha256, createHash('sha256').update(await readFile(join(output, 'upstreams.json'))).digest('hex'));
  assert.equal((await stat(join(output, 'upstreams.json'))).mode & 0o777, 0o600);
  assert.equal(exported.bindings.inventory.responseContract.source.specSha256, manifest.specSha256);
  assert.equal(exported.bindings.inventory.responseContract.source.operationPointer, '#/paths/~1inventory/get');
  assert.deepEqual(config.routes[0].offer, importOpenApi(spec, selections).offers[0].seller);
  assert.equal(validateUpstreamService(config, compileUpstreamBindings(exported, { allowLoopback: true })), true);
  const handlers = createUpstreamHandlers(exported, { allowLoopback: true });
  challenge = await startSellerService({ config, handlers, port: 0 });
  assert.equal((await fetch(challenge.url + '/api/inventory')).status, 402);
  assert.equal(counts.backend, 0);
  await challenge.close(); challenge = null;
  // The original resource-server runs unchanged. This collaborator makes its
  // lifecycle deterministic; it does not represent an SDK/chain payment.
  seller = await startSellerService({ config, handlers, port: 0, nativeFactory: async () => ({
    processHTTPRequest: async () => {
      counts.verified++;
      return { type: 'payment-verified', paymentPayload: {}, paymentRequirements: {},
        cancellationDispatcher: { cancel: async () => { counts.cancelled++; return {}; } } };
    },
    processSettlement: async () => { counts.settled++; return { success: true, headers: {} }; },
    createFailurePathSettlementHeaders: () => ({}),
  }) });
  let response = await fetch(seller.url + '/api/inventory');
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'UPSTREAM_RESPONSE_CONTRACT_SCHEMA', upstreamStatus: 200 });
  assert.equal(counts.cancelled, 1); assert.equal(counts.settled, 0);
  outcome = 'valid'; response = await fetch(seller.url + '/api/inventory');
  assert.equal(response.status, 200); assert.equal(await response.text(), goodBody);
  assert.equal(counts.settled, 1);
  outcome = 'media'; response = await fetch(seller.url + '/api/inventory');
  assert.equal(response.status, 502); assert.equal((await response.json()).error, 'UPSTREAM_RESPONSE_CONTRACT_MEDIA_TYPE');
  outcome = 'undeclared'; response = await fetch(seller.url + '/api/inventory');
  assert.equal(response.status, 502); assert.equal((await response.json()).error, 'UPSTREAM_RESPONSE_CONTRACT_STATUS');
  outcome = 'fallback'; response = await fetch(seller.url + '/api/inventory');
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), { accepted: true });
  outcome = 'empty'; response = await fetch(seller.url + '/api/inventory');
  assert.equal(response.status, 204); assert.equal(await response.text(), '');
  outcome = 'head'; response = await fetch(seller.url + '/api/inventory-head', { method: 'HEAD' });
  assert.equal(response.status, 200); assert.equal(await response.text(), '');
  assert.deepEqual(counts, { backend: 7, verified: 7, cancelled: 3, settled: 4 });
  // Status precedence and assertion rejection use the very same imported source.
  const extended = structuredClone(spec);
  extended.paths['/inventory'].get.responses['2XX'] = extended.paths['/inventory'].get.responses['201'];
  const contract = compileOpenApiResponseContract(extended, importOpenApi(spec, selections).offers[0]);
  const { compileResponseContract } = await import('../sf30-seller-sdk/response-contract.mjs');
  const check = compileResponseContract(contract);
  const alternate = { accepted: true }, body = Buffer.from(JSON.stringify(alternate));
  assert.equal(check.validate({ status: 200, contentType: 'application/json', body, value: alternate }), 'UPSTREAM_RESPONSE_CONTRACT_SCHEMA');
  assert.equal(check.validate({ status: 202, contentType: 'application/json', body, value: alternate }), null);
  extended.components.schemas.Inventory.properties.items.items.properties.id.pattern = '^item-';
  assert.throws(() => compileOpenApiResponseContract(extended, importOpenApi(spec, selections).offers[0]), /Unsupported response schema/);
  console.log(JSON.stringify({ status: 'PASS', journey: 'original OpenAPI export -> original upstream -> original SF30 cancellation/delivery',
    ...counts, originalChallengeOnlyBackendCalls: 0, responseBytesPreserved: true, chainPayments: 0, githubActions: 0 }));
} finally {
  if (challenge) await challenge.close();
  if (seller) await seller.close();
  await new Promise(resolve => backend.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
