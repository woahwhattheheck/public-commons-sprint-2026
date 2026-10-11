// MIT. One source-native loopback acceptance, using the ORIGINAL importer/router.
// No wallet, facilitator, SDK installation, payment, or hosted CI.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { importOpenApi } from '../../sf61-openapi-seller-import/importer.mjs';
import { compileSellerRoutes, createSellerResourceHandler } from '../../sf30-seller-sdk/resource-server.mjs';
import { admissionForServiceRoute } from '../index.mjs';

const document = JSON.parse(readFileSync(
  new URL('../../sf61-openapi-seller-import/openapi.example.json', import.meta.url), 'utf8'));
const accepts = [{
  scheme: 'exact', network: 'stellar:testnet', amount: '10000',
  asset: 'UNPAYABLE_SF89_TEST_ASSET', payTo: 'UNPAYABLE_SF89_TEST_RECIPIENT',
  maxTimeoutSeconds: 60,
}];
const imported = importOpenApi(document, [
  { method: 'GET', path: '/forecast/{city}', accepts },
  { method: 'POST', path: '/forecast', accepts },
]);
const config = { schema: 'stellar-forge.seller-service.v1', routes: imported.offers.map((entry, index) =>
  ({ id: 'weather-' + index, offer: entry.seller })) };
const decisions = config.routes.map(route => admissionForServiceRoute(config, route.id));
assert.equal(decisions[0]({
  method: 'GET', query: { days: '3' }, pathParams: { city: 'Berlin' }, body: null,
}), true);
assert.equal(decisions[0]({
  method: 'GET', query: { days: '0' }, pathParams: { city: 'Berlin' }, body: null,
}).status, 422);
assert.equal(decisions[0]({
  method: 'GET', query: { days: ['3', '4'] }, pathParams: { city: 'Berlin' }, body: null,
}).status, 422);
assert.equal(decisions[1]({
  method: 'POST', query: {}, pathParams: {},
  body: { latitude: 38.25, longitude: -85.76 },
}), true);
assert.equal(decisions[1]({
  method: 'POST', query: {}, pathParams: {},
  body: { latitude: '38.25', longitude: -85.76 },
}).status, 422);

// A live HTTP loopback through existing original seller router proves rejected
// inputs do not enter even the native HTTP payment collaborator.
let nativeCalls = 0;
const nativeServer = {
  async processHTTPRequest() {
    nativeCalls++;
    return { type: 'payment-error',
      response: { status: 402, body: { error: 'DEMO_NO_PAYMENT_SUBMITTED' } } };
  },
  async processSettlement() { throw new Error('Native settlement was not authorized'); },
  createFailurePathSettlementHeaders() { return {}; },
};
const compiled = compileSellerRoutes(config.routes.map((route, index) => ({
  id: route.id, offer: route.offer, admit: decisions[index],
  async handler() { throw new Error('Protected merchant response must not execute'); },
})));
const handler = createSellerResourceHandler({ compiled, nativeServer });
const server = createServer((req, res) => { Promise.resolve(handler(req, res)).catch(error => {
  res.statusCode = 500; res.end(String(error.message));
}); });
await new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
});
const base = 'http://127.0.0.1:' + server.address().port;
try {
  const rejectedGet = await fetch(base + '/api/v1/forecast/Berlin?days=0');
  assert.equal(rejectedGet.status, 422);
  assert.equal(nativeCalls, 0);
  const admittedGet = await fetch(base + '/api/v1/forecast/Berlin?days=3');
  assert.equal(admittedGet.status, 402);
  assert.equal(nativeCalls, 1);
  const rejectedPost = await fetch(base + '/api/v2/forecast', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ latitude: '38.25', longitude: -85.76 }),
  });
  assert.equal(rejectedPost.status, 422);
  assert.equal(nativeCalls, 1);
  const admittedPost = await fetch(base + '/api/v2/forecast', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ latitude: 38.25, longitude: -85.76 }),
  });
  assert.equal(admittedPost.status, 402);
  assert.equal(nativeCalls, 2);
  process.stdout.write(JSON.stringify({
    status: 'PASS', originalOpenApiVersion: imported.openapiVersion,
    originalOffers: imported.offers.length, rejectedBeforeNative: 2,
    enteredNativeForValidInput: nativeCalls, signedRequests: 0,
    executedMerchantHandlers: 0, testnetPayments: 0,
  }) + '\n');
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
