// MIT. Source-exact SF45 outbound read-only HTTP GET: body EOF is a transport failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DiscoveryError, fetchDiscoveryCatalog } from '../recovery.mjs';

const healthyCatalog = JSON.stringify({
  resources: [{ resource: { url: 'https://buyer.example.test/data' },
    extensions: { bazaar: { routeTemplate: '/data', info: { input: { type: 'http', method: 'GET' } } } } }],
  pagination: { cursor: null }
});
async function serve(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/`;
}
const policy = baseUrl => ({ baseUrl, query: 'data', maxRetries: 1, backoffMs: 1, timeoutMs: 1500 });

function partialBodyThenBreak(res) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.write('{"resources": [');
  setTimeout(() => res.destroy(), 10);
}

test('native streamed HTTP 200 EOF retries one identical unpaid GET and obtains complete catalog', async t => {
  let calls = 0;
  const baseUrl = await serve(t, (_req, res) => {
    calls++;
    if (calls === 1) return partialBodyThenBreak(res);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(healthyCatalog);
  });
  const report = await fetchDiscoveryCatalog(policy(baseUrl));
  assert.equal(calls, 2);
  assert.equal(report.resources.length, 1);
  assert.equal(report.attempts, 2);
  assert.equal(report.retries, 1);
  assert.equal(report.pages, 1);
  assert.equal(report.paymentCalls, 0);
  assert.equal(report.settlementReceipts, 0);
});

test('complete malformed HTTP 200 JSON is a schema failure, never network-retried', async t => {
  let calls = 0;
  const baseUrl = await serve(t, (_req, res) => {
    calls++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{not json');
  });
  await assert.rejects(fetchDiscoveryCatalog(policy(baseUrl)),
    err => err instanceof DiscoveryError && err.code === 'DISCOVERY_INVALID_JSON');
  assert.equal(calls, 1);
});

test('caller abort mid-body stops without unauthorized read retry', async t => {
  let calls = 0;
  const baseUrl = await serve(t, (_req, res) => {
    calls++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"resources": [');
  });
  const controller = new AbortController();
  const stopped = new Error('owner cancelled discovery');
  const job = fetchDiscoveryCatalog({ ...policy(baseUrl), signal: controller.signal });
  setTimeout(() => controller.abort(stopped), 45);
  await assert.rejects(job, error => error === stopped);
  assert.equal(calls, 1);
});

test('native repeated streamed transport EOF exhausts exact bounded GET retry budget', async t => {
  let calls = 0;
  const baseUrl = await serve(t, (_req, res) => { calls++; partialBodyThenBreak(res); });
  await assert.rejects(fetchDiscoveryCatalog(policy(baseUrl)),
    err => err instanceof DiscoveryError && err.code === 'DISCOVERY_NETWORK_EXHAUSTED');
  assert.equal(calls, 2);
});
