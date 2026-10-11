// One focused offline check of OpenAPI -> config -> original native HTTP runtime.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importOpenApi } from './importer.mjs';
import { createSellerServiceConfig } from './service-config.mjs';
import { run } from './cli.mjs';
import { readSellerConfig, startSellerService } from '../sf30-seller-sdk/serve.mjs';

const payment = { scheme: 'exact', network: 'stellar:testnet', amount: '1',
  asset: 'UNVERIFIED_DEMO_ASSET', payTo: 'UNVERIFIED_DEMO_RECIPIENT', maxTimeoutSeconds: 60 };
const document = { openapi: '3.1.1', info: { title: 'Runtime integration fixture' },
  servers: [{ url: 'https://seller.example/v1' }], paths: {
    '/lookup': { get: { summary: 'Lookup records', parameters: [{ name: 'count', in: 'query', required: true,
      schema: { type: 'integer', minimum: 1, maximum: 5, examples: [2] } }], responses: { 200: { description: 'Rows' } } } },
    '/compute': { post: { summary: 'Compute a result', requestBody: { required: true, content: {
      'application/json': { schema: { type: 'object', properties: { value: { type: 'number', minimum: 0 } },
        required: ['value'], additionalProperties: false }, example: { value: 2 } } } }, responses: { 200: { description: 'Result' } } } },
  } };
const selections = [{ method: 'GET', path: '/lookup', accepts: [payment] },
  { method: 'POST', path: '/compute', accepts: [payment] }];
const bindings = [{ method: 'GET', path: '/lookup', id: 'lookup', response: null },
  { method: 'POST', path: '/compute', id: 'compute', handler: 'compute' }];
const imported = importOpenApi(document, selections);
const dir = await mkdtemp(join(tmpdir(), 'sf61-runtime-'));
let session, invoked = 0;
try {
  for (const [name, value] of [['spec', document], ['selections', selections], ['bindings', bindings]])
    await writeFile(join(dir, name + '.json'), JSON.stringify(value));
  const manifest = await run(['--spec', join(dir, 'spec.json'), '--config', join(dir, 'selections.json'),
    '--out', join(dir, 'out'), '--service-bindings', join(dir, 'bindings.json')]);
  assert.equal(manifest.serviceConfigSha256.length, 64);
  const config = await readSellerConfig(join(dir, 'out', 'seller-service.json'));
  assert.deepEqual(config.routes.map(route => route.offer), imported.offers.map(offer => offer.seller));
  session = await startSellerService({ config, port: 0,
    handlers: { compute: async () => { invoked++; return { body: { result: 4 } }; } } });
  const health = await (await fetch(session.url + '/_seller/health')).json();
  assert.equal(health.mode, 'CHALLENGE_ONLY');
  assert.deepEqual(health.routes.map(route => route.method), ['GET', 'POST']);
  assert.deepEqual(await (await fetch(session.url + '/_seller/offers')).json(), imported.offers.map(offer => offer.seller));
  for (const [i, path] of ['/v1/lookup?count=2', '/v1/compute'].entries()) {
    const response = await fetch(session.url + path, i ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"value":2}' } : {});
    assert.equal(response.status, 402);
    const expected = structuredClone(imported.offers[i].seller);
    expected.resource.url = config.publicOrigin + path;
    assert.deepEqual(JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64')), expected);
  }
  assert.equal(invoked, 0);
  assert.equal((await fetch(session.url + '/v1/lookup', { method: 'POST' })).status, 405);
  assert.throws(() => createSellerServiceConfig(imported, [bindings[0]]), /binding/);
  const mismatch = structuredClone(config); mismatch.routes[0].path = '/other';
  await assert.rejects(startSellerService({ config: mismatch, port: 0 }), /exactly match/);
  const unsupported = structuredClone(imported); unsupported.offers[0].seller.accepts.push(payment);
  assert.throws(() => createSellerServiceConfig(unsupported, bindings), /one exact payment/);
  const dynamic = structuredClone(imported); dynamic.offers[0].seller.extensions.bazaar.routeTemplate = '/v1/:name';
  assert.throws(() => createSellerServiceConfig(dynamic, bindings), /string pathParams/);
  assert.equal(JSON.parse(await readFile(join(dir, 'out', 'offers.json'))).offers.length, 2);
  console.log('PASS: original schemas/terms survive CLI, config, inspection and two real HTTP 402 routes; zero handler calls; unsupported bindings/routes rejected');
} finally { if (session) await session.close(); await rm(dir, { recursive: true, force: true }); }
