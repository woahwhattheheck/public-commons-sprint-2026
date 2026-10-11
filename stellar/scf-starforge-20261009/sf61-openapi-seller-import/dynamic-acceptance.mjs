// MIT. Focused imported-offer -> service-config -> real loopback HTTP check.
// Native boundary spy below tests adapter handoff, NOT signature or settlement.
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { compileHttpSellerOffer } from '../sf30-seller-sdk/seller.mjs';
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';
import { startSellerService } from '../sf30-seller-sdk/serve.mjs';
import { createSellerServiceConfig } from './service-config.mjs';
const payment = { scheme: 'exact', network: 'stellar:testnet', amount: '1',
  asset: 'NONPAYABLE_TEST_ASSET', payTo: 'NONPAYABLE_TEST_SELLER', maxTimeoutSeconds: 60 };
function offered(method, dynamic = true) {
  const seller = compileHttpSellerOffer({ url: 'https://seller.example/api/items/' + (dynamic ? 'sample' : 'latest'),
    method, description: 'Dynamic routing fixture', payment,
    ...(method === 'POST' ? { bodyType: 'json', body: { message: 'example' } } : {}) });
  if (dynamic) {
    const b = seller.extensions.bazaar;
    b.routeTemplate = '/api/items/:id'; b.info.input.pathParams = { id: 'sample' };
    b.schema.properties.input.properties.pathParams = { type: 'object', properties: {
      id: { type: 'string', minLength: 2, maxLength: 40 } }, required: ['id'], additionalProperties: false };
    b.schema.properties.input.required.push('pathParams');
  }
  return { method, path: dynamic ? '/api/items/{id}' : '/api/items/latest', seller };
}
const imported = { schema: 'stellar.open-api-seller-import.v1',
  offers: [offered('GET'), offered('POST'), offered('HEAD'), offered('GET', false)] };
const before = JSON.stringify(imported);
const config = createSellerServiceConfig(imported, imported.offers.map((o, i) => ({
  method: o.method, path: o.path, id: 'route' + i, handler: 'application' })));
assert.equal(config.routes[0].path, '/api/items/:id');
let calls = 0;
const handlers = { application: async ctx => { calls++; return { body: { id: ctx.pathParams.id, body: ctx.body } }; } };
const ask = (session, path, method = 'GET', body) => new Promise((resolve, reject) => {
  const req = request(session.url + path, { method, headers: { host: 'untrusted.example',
    ...(body ? { 'content-type': 'application/json' } : {}) } }, res => {
    let data = ''; res.setEncoding('utf8'); res.on('data', c => { data += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
  });
  req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
});
const session = await startSellerService({ config, handlers, port: 0 });
try {
  const reply = await ask(session, '/api/items/caf%C3%A9?q=one');
  assert.equal(reply.status, 402);
  // Muse found native case-insensitive literals returned HTTP 404 (PR710).
  // Verify the original HTTP route, trusted request identity, and seller terms.
  const mixedCase = await ask(session, '/API/ITEMS/CaF%C3%A9?q=one');
  assert.equal(mixedCase.status, 402);
  const mixedChallenge = JSON.parse(Buffer.from(mixedCase.headers['payment-required'], 'base64'));
  assert.equal(mixedChallenge.resource.url, 'https://seller.example/API/ITEMS/CaF%C3%A9?q=one');
  assert.deepEqual(mixedChallenge.extensions.bazaar.info.input.pathParams, { id: 'CaFé' });
  assert.deepEqual(mixedChallenge.accepts, [payment]);
  const challenge = JSON.parse(Buffer.from(reply.headers['payment-required'], 'base64'));
  assert.equal(challenge.resource.url, 'https://seller.example/api/items/caf%C3%A9?q=one');
  assert.deepEqual(challenge.extensions.bazaar.info.input.pathParams, { id: 'café' });
  assert.deepEqual(challenge.accepts, [payment]);
  assert.deepEqual(challenge.extensions.bazaar.schema, imported.offers[0].seller.extensions.bazaar.schema);
  assert.equal((await ask(session, '/api/items/latest', 'POST')).status, 405);
  const caseCollision = await ask(session, '/api/items/LATEST');
  assert.equal(caseCollision.status, 400);
  assert.equal(JSON.parse(caseCollision.body).error, 'NATIVE_ROUTE_CASE_COLLISION');
  assert.equal((await ask(session, '/API/ITEMS/LATEST')).status, 400);
  assert.equal((await ask(session, '/api/items/new-id', 'HEAD')).body, '');
  assert.equal((await ask(session, '/api/items/new-id', 'POST', { message: 'live input' })).status, 402);
  for (const suffix of ['a', 'bad%2Fslash', 'bad%252Fslash', '%E0%A4', 'bad%00value'])
    assert.equal((await ask(session, '/api/items/' + suffix)).status, 400, suffix);
  assert.equal((await ask(session, '/missing')).status, 404);
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(imported), before);
} finally { await session.close(); }
let observed;
const boundary = await startSellerService({ config, handlers, port: 0, nativeFactory: async compiled => {
  assert.equal(Object.keys(compiled.nativeRoutes)[0], 'GET /api/items/latest');
  assert.equal(Object.hasOwn(compiled.nativeRoutes['GET /api/items/:id'], 'resource'), false);
  return { processHTTPRequest: async ctx => { observed = ctx; return { type: 'payment-error',
      response: { status: 402, body: { boundary: 'reached' } } }; },
    processSettlement: async () => { throw new Error('Settlement must not be called'); },
    createFailurePathSettlementHeaders: () => ({}) };
} });
try {
  assert.equal((await ask(boundary, '/api/items/caf%C3%A9')).status, 402);
  assert.equal(observed.path, '/api/items/caf%C3%A9');
  assert.equal(observed.decodedPath, '/api/items/café');
  assert.equal(observed.adapter.getPath(), '/api/items/café');
  assert.equal(observed.adapter.getUrl(), 'https://seller.example/api/items/caf%C3%A9');
  assert.equal(calls, 0);
} finally { await boundary.close(); }
const fixedOnly = await startSellerService({
  config: { ...config, routes: config.routes.filter(item => item.id === 'route3') },
  handlers, port: 0,
});
try {
  const caseVariant = await ask(fixedOnly, '/API/ITEMS/LATEST?days=3');
  assert.equal(caseVariant.status, 402);
  const fixedChallenge = JSON.parse(Buffer.from(caseVariant.headers['payment-required'], 'base64'));
  assert.equal(fixedChallenge.resource.url, 'https://seller.example/API/ITEMS/LATEST?days=3');
  assert.deepEqual(fixedChallenge.accepts, [payment]);
  assert.equal((await ask(fixedOnly, '/API/ITEMS/LATEST', 'POST')).status, 405);
} finally { await fixedOnly.close(); }
const a = offered('GET').seller, b = structuredClone(a);
b.extensions.bazaar.routeTemplate = '/api/items/:other';
b.extensions.bazaar.info.input.pathParams = { other: 'sample' };
const p = b.extensions.bazaar.schema.properties.input.properties.pathParams;
p.properties = { other: p.properties.id }; p.required = ['other'];
assert.throws(() => compileSellerRoutes([{ id: 'a', offer: a, handler: handlers.application },
  { id: 'b', offer: b, handler: handlers.application }]), /Ambiguous/);
const trailing = offered('GET', false).seller;
trailing.resource.url = 'https://seller.example/api/ITEMS/latest/';
assert.throws(() => compileSellerRoutes([{ id: 'fixed', offer: trailing, handler: handlers.application },
  { id: 'dynamic', offer: a, handler: handlers.application }]), /Trailing-slash/);
const numeric = structuredClone(a);
numeric.resource.url = 'https://seller.example/api/items/42';
numeric.extensions.bazaar.info.input.pathParams.id = 42;
numeric.extensions.bazaar.schema.properties.input.properties.pathParams.properties.id = { type: 'integer' };
assert.throws(() => compileSellerRoutes([{ id: 'number', offer: numeric, handler: handlers.application }]), /string pathParams/);
console.log('PASS: imported-offer/config/HTTP dynamic routing; unchanged terms+schema; native handoff; zero application or settlement calls');
