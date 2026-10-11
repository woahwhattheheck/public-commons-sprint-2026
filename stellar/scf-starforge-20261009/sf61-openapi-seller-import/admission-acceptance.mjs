// MIT. Original OpenAPI CLI -> config readback -> real HTTP seller admission.
// Native payment boundary is a controlled collaborator, not chain settlement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './cli.mjs';
import { importOpenApi } from './importer.mjs';
import { createSellerServiceConfig } from './service-config.mjs';
import { readSellerConfig, startSellerService } from '../sf30-seller-sdk/serve.mjs';

const payment = { scheme: 'exact', network: 'stellar:testnet', amount: '1',
  asset: 'UNVERIFIED_TEST_ASSET', payTo: 'UNVERIFIED_TEST_RECIPIENT', maxTimeoutSeconds: 60 };
const document = { openapi: '3.1.1', info: { title: 'Admission export fixture' },
  servers: [{ url: 'https://seller.example/v1' }], paths: {
    '/forecast/{city}': { get: { parameters: [{ name: 'city', in: 'path', required: true,
      schema: { type: 'string', examples: ['Louisville'] } }], responses: { 200: { description: 'Data' } } } },
    '/static': { get: { responses: { 200: { description: 'Data' } } } },
  } };
for (const item of Object.values(document.paths)) {
  (item.get.parameters ??= []).push({ name: 'ok', in: 'query',
    schema: { type: 'string', enum: ['0', '1'], examples: ['1'] } });
}
const selections = Object.keys(document.paths).map(path => ({ method: 'GET', path, accepts: [payment] }));
const bindings = [{ validateInput: true, method: 'GET', path: '/forecast/{city}', id: 'forecast', handler: 'forecast', admit: 'checkCity' },
  { validateInput: true, method: 'GET', path: '/static', id: 'static', response: { protected: 'static' }, admit: 'checkCity' }];

test('exported admission executes before native payment for dynamic and static applications', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sf61-admission-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, value] of [['spec', document], ['selections', selections], ['bindings', bindings]])
    await writeFile(join(dir, name + '.json'), JSON.stringify(value));
  const manifest = await run(['--spec', join(dir, 'spec.json'), '--config', join(dir, 'selections.json'),
    '--service-bindings', join(dir, 'bindings.json'), '--out', join(dir, 'out')]);
  assert.equal(manifest.serviceConfigSha256.length, 64);
  const config = await readSellerConfig(join(dir, 'out', 'seller-service.json'));
  assert.deepEqual(config.routes.map(r => r.admit), ['checkCity', 'checkCity']);
  assert.deepEqual(config.routes.map(r => r.validateInput), [true, true]);
  assert.deepEqual(config.routes.map(r => r.offer), importOpenApi(document, selections).offers.map(o => o.seller));
  const calls = [];
  const handlers = {
    checkCity({ query, pathParams }) {
      calls.push(['admit', pathParams.city ?? null]);
      return query.ok === '1' ? true : { status: 422, body: { error: 'FIXTURE_NOT_ADMITTED' } };
    },
    forecast({ pathParams }) { calls.push(['handler', pathParams.city]); return { body: { city: pathParams.city } }; },
  };
  const nativeFactory = async () => ({
    async processHTTPRequest(context) {
      calls.push(['verify', context.adapter.getUrl()]);
      return { type: 'payment-verified', paymentPayload: {}, paymentRequirements: {}, declaredExtensions: {},
        cancellationDispatcher: { async cancel() { calls.push(['cancel']); return {}; } } };
    },
    async processSettlement() { calls.push(['settle']); return { success: true, headers: { 'payment-response': 'fixture-only' } }; },
    createFailurePathSettlementHeaders() { return {}; },
  });
  await assert.rejects(startSellerService({ config, port: 0, handlers: { forecast: handlers.forecast }, nativeFactory }), /Admission export missing/);
  const session = await startSellerService({ config, port: 0, handlers, nativeFactory });
  t.after(() => session.close());
  const health = await fetch(session.url + '/_seller/health').then(r => r.json());
  assert.ok(health.routes.every(r => r.inputValidation && r.admission));
  for (const path of ['/v1/forecast/New%20York', '/v1/static']) {
    calls.length = 0;
    const invalid = await fetch(session.url + path + '?ok=INVALID');
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).error, 'LIVE_REQUEST_SCHEMA_REJECTED');
    assert.deepEqual(calls, []); // Schema rejection never enters business or payment.
    const denied = await fetch(session.url + path);
    assert.equal(denied.status, 422);
    assert.deepEqual(await denied.json(), { error: 'FIXTURE_NOT_ADMITTED' });
    assert.deepEqual(calls.map(c => c[0]), ['admit']);
    calls.length = 0;
    const accepted = await fetch(session.url + path + '?ok=1');
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get('payment-response'), 'fixture-only');
    assert.deepEqual(await accepted.json(), path.includes('forecast') ? { city: 'New York' } : { protected: 'static' });
    assert.deepEqual(calls.map(c => c[0]), path.includes('forecast') ? ['admit', 'verify', 'handler', 'settle'] : ['admit', 'verify', 'settle']);
    assert.equal(calls[1][1], 'https://seller.example' + path + '?ok=1');
  }
  const challenge = await startSellerService({ config, port: 0,
    handlers: { forecast: handlers.forecast, checkCity() { throw new Error('must not execute in challenge-only mode'); } } });
  t.after(() => challenge.close());
  assert.equal((await fetch(challenge.url + '/v1/forecast/New%20York?ok=INVALID')).status, 402);
});

test('invalid admission names fail export; omitted admission preserves existing bindings', () => {
  const imported = importOpenApi(document, selections);
  for (const admit of [undefined, null, false, '', [], ['checkCity'], {}, 'object.method', 'bad-name', 'x'.repeat(129)]) {
    assert.throws(() => createSellerServiceConfig(imported, [{ ...bindings[0], admit }, bindings[1]]), /admission binding/);
  }
  for (const validateInput of [undefined, null, 'true', 1, [], {}]) {
    assert.throws(() => createSellerServiceConfig(imported, [{ ...bindings[0], validateInput }, bindings[1]]), /validateInput/);
  }
  const plain = bindings.map(({ admit, validateInput, ...binding }) => binding);
  assert.ok(createSellerServiceConfig(imported, plain).routes.every(r => !Object.hasOwn(r, 'admit') && !Object.hasOwn(r, 'validateInput')));
  assert.ok(createSellerServiceConfig(imported, plain.map(r => ({...r, validateInput: false}))).routes.every(r => r.validateInput === false));
  assert.throws(() => createSellerServiceConfig(imported, [{ ...bindings[0], handler: ['forecast'] }, bindings[1]]), /handler/);
  assert.deepEqual(bindings.map(r => r.admit), ['checkCity', 'checkCity']);
});
