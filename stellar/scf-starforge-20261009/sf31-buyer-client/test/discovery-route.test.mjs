// MIT. Focused actual SF31 buyer-module discover() routing and pagination regression.
import test from 'node:test';
import assert from 'node:assert/strict';
import { X402BuyerClient, BuyerError } from '../buyer.mjs';

function fixture() {
  const requests = [];
  const buyer = new X402BuyerClient({
    fetchImpl: async (url, options) => {
      requests.push({url: String(url), method: options.method, redirect: options.redirect});
      return new Response(JSON.stringify({
        resources: [{id: 'source-backed-page'}],
        pagination: {limit: 20, offset: 0, total: 1}
      }), {status: 200, headers: {'content-type': 'application/json'}});
    }
  });
  return {buyer, requests};
}

test('root-origin resource URL remains byte-for-byte compatible', async () => {
  const {buyer, requests} = fixture();
  const page = await buyer.discover({origin: 'https://bazaar.example/'});
  assert.deepEqual(requests, [{
    url: 'https://bazaar.example/discovery/resources?limit=20',
    method: 'GET', redirect: 'manual'
  }]);
  assert.equal(page.resources[0].id, 'source-backed-page');
  assert.equal(page.source, requests[0].url);
});

test('provider API prefix survives search, filters and offset', async () => {
  const {buyer, requests} = fixture();
  const page = await buyer.discover({
    origin: 'https://bazaar.example/platform/v2/x402/?ignored=1',
    query: 'Stellar API', filters: {network: 'stellar:testnet'},
    limit: 10, offset: 40
  });
  assert.equal(requests[0].url,
    'https://bazaar.example/platform/v2/x402/discovery/search?query=Stellar+API&network=stellar%3Atestnet&limit=10&offset=40');
  assert.equal(page.source, requests[0].url);
  assert.equal(requests[0].redirect, 'manual');
});

test('nested base path works for resources without search', async () => {
  const {buyer, requests} = fixture();
  await buyer.discover({origin: 'https://bazaar.example/api/v1', offset: 1});
  assert.equal(requests[0].url,
    'https://bazaar.example/api/v1/discovery/resources?limit=20&offset=1');
});

test('invalid pagination offsets fail before any network call', async () => {
  const {buyer, requests} = fixture();
  for (const offset of [-1, 0.5, '1', Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      () => buyer.discover({origin: 'https://bazaar.example/', offset}),
      error => error instanceof BuyerError && error.code === 'BAD_DISCOVERY_OFFSET',
      'offset ' + String(offset)
    );
  }
  assert.equal(requests.length, 0);
});

test('provider prefix does not weaken the original unsafe-destination fence', async () => {
  const {buyer, requests} = fixture();
  await assert.rejects(
    () => buyer.discover({origin: 'https://127.0.0.1/platform/v2/x402/', offset: 1}),
    error => error instanceof BuyerError && error.code === 'UNSAFE_RESOURCE_HOST'
  );
  assert.equal(requests.length, 0);
});
