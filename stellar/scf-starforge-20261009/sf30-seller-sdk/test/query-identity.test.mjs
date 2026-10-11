// Run: node --test stellar/scf-starforge-20261009/sf30-seller-sdk/test/query-identity.test.mjs
// Actual loopback HTTP and original SF31 transport; no signer, wallet or settlement.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { compileSellerRoutes, createSellerResourceHandler } from '../resource-server.mjs';
import { compileHttpSellerOffer } from '../seller.mjs';
import { X402BuyerClient } from '../../sf31-buyer-client/buyer.mjs';

const payment = { scheme: 'exact', network: 'stellar:testnet', amount: '100',
  asset: 'FIXTURE_ASSET', payTo: 'FIXTURE_SELLER', maxTimeoutSeconds: 60 };
const expect = { ...payment, maxAtomic: payment.amount };
const queryParameters = [{ name: 'city', type: 'string', required: true,
  description: 'Forecast city', example: 'Indianapolis' }];
const decode = response => JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64').toString());

async function fixture(run, { native = false } = {}) {
  let handler, applications = 0;
  const requests = [];
  const server = createServer((req, res) => handler(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const definitions = ['GET', 'HEAD', 'POST'].map(method => ({ id: method, definition: {
      url: `${origin}/forecast`, method, description: 'Query identity fixture', payment, queryParameters,
      ...(method === 'POST' ? { bodyType: 'json', body: { days: 1 } } : {}),
    }, handler: () => { applications++; throw new Error('Unpaid application must not execute'); } }));
    const dynamic = compileHttpSellerOffer({ ...definitions[0].definition,
      url: `${origin}/forecast/sample`, routeTemplate: '/forecast/:city' }, { allowLocalhost: true });
    const input = dynamic.extensions.bazaar.info.input;
    input.pathParams = { city: 'sample' };
    const schema = dynamic.extensions.bazaar.schema.properties.input;
    schema.properties.pathParams = { type: 'object', properties: { city: { type: 'string' } },
      required: ['city'], additionalProperties: false };
    schema.required.push('pathParams');
    definitions.push({ id: 'dynamic', offer: dynamic, handler: definitions[0].handler });
    const compiled = compileSellerRoutes(definitions, { allowLocalhost: true });
    // This is a native API boundary spy, not a payment implementation or native checkout.
    const nativeServer = native ? {
      processHTTPRequest: async context => {
        requests.push({ url: context.adapter.getUrl(), query: context.adapter.getQueryParams(),
          body: context.adapter.getBody(), method: context.method });
        return { type: 'payment-error', response: { status: 402, body: { error: 'UNSIGNED_BOUNDARY_FIXTURE' } } };
      },
      processSettlement: () => assert.fail('No settlement permitted'),
      createFailurePathSettlementHeaders: () => assert.fail('No payment cancellation permitted'),
    } : null;
    handler = createSellerResourceHandler({ compiled, nativeServer });
    await run({ origin, compiled, requests, applications: () => applications });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('fixed GET/HEAD/JSON POST challenges bind the exact query and reach original buyer approval', async () => {
  await fixture(async ({ origin, compiled, applications }) => {
    const before = JSON.stringify(compiled.routes.map(route => route.offer));
    const buyer = new X402BuyerClient({ allowLocal: true });
    let approvals = 0, signatures = 0;
    for (const method of ['GET', 'HEAD', 'POST']) {
      for (const suffix of ['', '?city=Indianapolis', '?city=New%20York&city=C%2B%2B&empty=&flag', '?']) {
        const url = `${origin}/forecast${suffix}`;
        const body = method === 'POST' ? '{"days":1}' : undefined;
        const headers = method === 'POST' ? { 'content-type': 'application/json' } : {};
        const response = await fetch(url, { method, headers, body });
        assert.equal(response.status, 402);
        const challenge = decode(response);
        assert.equal(challenge.resource.url, url);
        assert.deepEqual(challenge.accepts, [payment]);
        assert.deepEqual(challenge.extensions, compiled.routes.find(route => route.method === method).offer.extensions);
        if (method === 'HEAD') assert.equal(await response.text(), '');
        else await response.arrayBuffer();
        await assert.rejects(buyer.call({ url, method, body, headers, expect,
          approve: intent => { approvals++; assert.equal(intent.url, url); return false; },
          sign: () => { signatures++; assert.fail('No signing permitted'); },
        }), { code: 'PAYMENT_NOT_APPROVED' });
      }
    }
    assert.equal(approvals, 12); assert.equal(signatures, 0); assert.equal(applications(), 0);
    assert.equal(JSON.stringify(compiled.routes.map(route => route.offer)), before);
  });
});

test('trusted origin and dynamic request identity survive fixed-query handling', async () => {
  await fixture(async ({ origin, compiled }) => {
    const url = `${origin}/forecast/Indianapolis?city=Chicago&units=metric`;
    const response = await fetch(url, { headers: { host: 'untrusted.invalid', 'x-forwarded-host': 'untrusted.invalid' } });
    assert.equal(response.status, 402);
    const challenge = decode(response);
    assert.equal(challenge.resource.url, url);
    assert.deepEqual(challenge.extensions.bazaar.info.input.pathParams, { city: 'Indianapolis' });
    assert.deepEqual(challenge.accepts, [payment]);
    await response.arrayBuffer();
    const fixed = await fetch(`${origin}/forecast?city=Indianapolis`, { headers: { host: 'untrusted.invalid' } });
    assert.equal(decode(fixed).resource.url, `${origin}/forecast?city=Indianapolis`);
    await fixed.arrayBuffer();
    for (const config of Object.values(compiled.nativeRoutes)) assert.equal(Object.hasOwn(config, 'resource'), false);
  });
});

test('native handoff retains exact query URL and rejects excessive targets before SDK entry', async () => {
  await fixture(async ({ origin, compiled, requests, applications }) => {
    for (const method of ['GET', 'HEAD', 'POST']) {
      const url = `${origin}/forecast?city=New%20York&city=C%2B%2B`;
      const response = await fetch(url, { method, headers: { host: 'untrusted.invalid', 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{"days":1}' } : {}) });
      assert.equal(response.status, 402); await response.arrayBuffer();
      assert.equal(requests.at(-1).url, url);
      assert.deepEqual({ ...requests.at(-1).query }, { city: ['New York', 'C++'] });
      assert.equal(Object.hasOwn(compiled.nativeRoutes[`${method} /forecast`], 'resource'), false);
    }
    assert.deepEqual(requests.at(-1).body, { days: 1 });
    const response = await fetch(`${origin}/forecast?city=${'x'.repeat(2048)}`);
    assert.equal(response.status, 414); assert.equal(response.headers.has('payment-required'), false);
    await response.arrayBuffer();
    assert.equal(requests.length, 3); assert.equal(applications(), 0);
  }, { native: true });
  await fixture(async ({ origin }) => {
    const response = await fetch(`${origin}/forecast?city=${'x'.repeat(2048)}`);
    assert.equal(response.status, 414); await response.arrayBuffer();
  });
});

test('original buyer still rejects a challenge for a different query before approval', async () => {
  const url = 'https://seller.example/forecast?city=Indianapolis';
  const offer = compileHttpSellerOffer({ url: 'https://seller.example/forecast', method: 'GET',
    description: 'Mismatch fixture', payment, queryParameters });
  offer.resource.url = 'https://seller.example/forecast?city=Chicago';
  let approvals = 0, signatures = 0;
  const buyer = new X402BuyerClient({ fetchImpl: async () => new Response(null, { status: 402,
    headers: { 'payment-required': Buffer.from(JSON.stringify(offer)).toString('base64') } }) });
  await assert.rejects(buyer.call({ url, expect, approve: () => { approvals++; return false; },
    sign: () => { signatures++; assert.fail('No signing permitted'); } }), { code: 'RESOURCE_MISMATCH' });
  assert.equal(approvals, 0); assert.equal(signatures, 0);
});
