// MIT. Focused real HTTP checks of the original seller service with a controlled
// native-server collaborator. No chain request, wallet or optional SDK package.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { startSellerService } from '../serve.mjs';
import { evaluateAdmission } from '../admission.mjs';
import { admitCityQuery } from '../examples/admission.mjs';

function configuration(extra = {}, routeExtra = {}) {
  return { schema: 'stellar-forge.seller-service.v1', ...extra, routes: [{
    id: 'data', path: '/data', admit: 'admit', handler: 'data',
    definition: { method: 'POST', description: 'Admission HTTP acceptance fixture',
      bodyType: 'json', body: { city: 'Louisville' },
      payment: { scheme: 'exact', network: 'stellar:testnet', amount: '10000',
        asset: 'UNVERIFIED_TEST_ASSET', payTo: 'UNVERIFIED_TEST_RECIPIENT', maxTimeoutSeconds: 60 } },
    ...routeExtra,
  }] };
}
async function service(t, admit, options = {}) {
  const calls = [], seen = {};
  const nativeFactory = async () => ({
    async processHTTPRequest(context) {
      calls.push('verify'); seen.nativeBody = structuredClone(context.adapter.getBody());
      seen.nativeQuery = structuredClone(context.adapter.getQueryParams());
      return { type: 'payment-verified', paymentPayload: {}, paymentRequirements: {}, declaredExtensions: {},
        cancellationDispatcher: { async cancel() { calls.push('cancel'); return {}; } } };
    },
    async processSettlement() { calls.push('settle'); return { success: true, headers: { 'payment-response': 'controlled-fixture' } }; },
    createFailurePathSettlementHeaders() { return {}; },
  });
  const session = await startSellerService({ config: configuration(options.config), port: 0,
    handlers: { admit, async data(input) { calls.push('handler'); seen.application = input;
      return { body: { protected: true, city: input.body?.city } }; } },
    nativeFactory: options.challengeOnly ? null : nativeFactory });
  t.after(() => session.close());
  return { ...session, calls, seen };
}
async function post(s, path = '/data?city=Louisville') {
  const response = await fetch(s.url + path, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ city: 'Louisville' }) });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

test('rejection happens before native verify; accepted isolated input preserves original paid lifecycle', async t => {
  const s = await service(t, input => {
    if (input.query.reject === '1') return { status: 422, body: { error: 'BAD_QUERY' } };
    input.body.city = 'MUTATED'; input.query.city = 'MUTATED'; input.url.pathname = '/changed';
    return true;
  });
  assert.equal((await post(s, '/data?reject=1')).status, 422);
  assert.deepEqual(s.calls, []);
  const response = await post(s);
  assert.equal(response.status, 200); assert.deepEqual(s.calls, ['verify', 'handler', 'settle']);
  assert.equal(response.headers.get('payment-response'), 'controlled-fixture');
  assert.equal(response.body.city, 'Louisville'); assert.equal(s.seen.nativeBody.city, 'Louisville');
  assert.equal(s.seen.nativeQuery.city, 'Louisville'); assert.equal(s.seen.application.url.pathname, '/data');
  assert.equal((await (await fetch(s.url + '/_seller/health')).json()).routes[0].admission, true);
});

test('faulty callbacks and invalid response shapes cannot enter native payment', async t => {
  let current = () => false;
  const s = await service(t, input => current(input));
  assert.equal((await post(s)).status, 422);
  for (const answer of [undefined, null, 'yes', { status: 200 }, { status: 302 }, { status: 402 },
    { status: 422, headers: { 'PAYMENT-REQUIRED': 'untrusted' } },
    { status: 422, body: 'x'.repeat(1024 * 1024 + 1) }]) {
    current = () => answer; const response = await post(s);
    assert.equal(response.status, 503); assert.deepEqual(response.body, { error: 'REQUEST_ADMISSION_UNAVAILABLE' });
    assert.equal(response.headers.get('payment-required'), null);
  }
  current = () => { throw new Error('private-fixture-detail'); };
  assert.deepEqual((await post(s)).body, { error: 'REQUEST_ADMISSION_UNAVAILABLE' });
  assert.deepEqual(s.calls, []);
});

test('timeout and real client disconnect abort admission; late true does not process payment', async t => {
  let signal, resolveLate;
  const s = await service(t, input => { signal = input.signal; return new Promise(r => { resolveLate = r; }); },
    { config: { admissionTimeoutMs: 30 } });
  assert.equal((await post(s)).status, 503); assert.equal(signal.aborted, true);
  resolveLate(true); await delay(10); assert.deepEqual(s.calls, []);
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const disconnected = await service(t, input => { signal = input.signal; started(); return new Promise(r => { resolveLate = r; }); });
  const req = request(disconnected.url + '/data', { method: 'POST', headers: { 'content-type': 'application/json' } });
  req.on('error', () => {}); req.end('{"city":"Louisville"}'); await ready; req.destroy();
  for (let n = 0; n < 50 && !signal.aborted; n++) await delay(10);
  assert.equal(signal.aborted, true); resolveLate(true); await delay(10); assert.deepEqual(disconnected.calls, []);
});

test('configuration rejects absent exports; challenge-only and explicit no-admission routes preserve behavior', async t => {
  await assert.rejects(startSellerService({ config: configuration(), port: 0, handlers: { data() {} } }), /Admission export missing/);
  await assert.rejects(startSellerService({ config: configuration({ admissionTimeoutMs: 0 }), port: 0 }), /admissionTimeoutMs/);
  const s = await service(t, () => { throw new Error('must not run'); }, { challengeOnly: true });
  assert.equal((await post(s)).status, 402); assert.deepEqual(s.calls, []);
  const config = configuration({}, { response: { fixture: true } }); delete config.routes[0].admit; delete config.routes[0].handler;
  const plain = await startSellerService({ config, port: 0 }); t.after(() => plain.close());
  assert.equal((await post(plain)).status, 402);
  assert.equal((await (await fetch(plain.url + '/_seller/health')).json()).routes[0].admission, false);
  const input = { method: 'GET', url: new URL('https://seller.example/data?city=Louisville'), query: { city: 'Louisville' }, body: null, headers: {} };
  assert.equal(await evaluateAdmission(admitCityQuery, input), true);
  assert.equal((await evaluateAdmission(admitCityQuery, { ...input, query: { city: ['a', 'b'] } })).status, 422);
});
