// MIT. One complete original-SF30 merchant workflow in local Linux.
// Actual official SDK; facilitator outcomes are controlled, with no chain calls.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import { createNativeSellerServer } from '../native-factory.mjs';
import { createUpstreamHandler } from '../upstream-handler.mjs';
import { protectUpstream } from '../upstream-readiness.mjs';
import { createResponseCache } from './cache.mjs';
import { startCachedSeller } from './serve.mjs';
import { callCacheControlFile } from './control.mjs';

let backendReads = 0, verified = 0, settled = 0, admitted = 0;
const backend = createServer(async (req, res) => {
  const serial = ++backendReads;
  assert.equal(req.headers.authorization, 'Bearer local-merchant-credential');
  assert.equal(req.headers['payment-signature'], undefined);
  const query = new URL(req.url, 'http://localhost').searchParams;
  await delay(35);
  res.writeHead(200, { 'content-type': 'application/json',
    'cache-control': query.get('q') === 'private' ? 'private, no-store' : 'public, max-age=30',
    vary: 'accept-language' });
  res.end(JSON.stringify({ query: query.get('q'), language: req.headers['accept-language'] ?? '', serial }));
});
await new Promise(done => backend.listen(0, '127.0.0.1', done));
const config = { schema: 'stellar-forge.seller-service.v1', publicOrigin: 'https://merchant.example', routes: [{
  id: 'dataset', path: '/query', handler: 'readData', definition: { method: 'GET', description: 'Shared merchant read',
    queryParameters: [{ name: 'q', type: 'string', description: 'Named merchant query', required: true, example: 'one' }],
    payment: { scheme: 'exact', network: 'stellar:testnet', asset: 'LOCAL_UNVERIFIED_ASSET',
      payTo: 'LOCAL_UNVERIFIED_PAYTO', amount: '10000', maxTimeoutSeconds: 60 } },
}] };
const originalSource = protectUpstream(createUpstreamHandler({
  baseUrl: `http://127.0.0.1:${backend.address().port}`, path: '/read', query: ['q'],
  headers: { Authorization: 'Bearer local-merchant-credential' }, requestHeaders: ['accept-language'],
  responseHeaders: ['content-type', 'cache-control', 'vary'], maxInFlight: 16, allowLocal: true,
}), { failureThreshold: 3, resetAfterMs: 100, maxResetAfterMs: 1000 }, { maxInFlight: 16 });
const app = { config, handlers: { readData: originalSource } };
const originalAdmission = originalSource.admit;
app.handlers.acceptCacheRead = context => {
  admitted++;
  if (context.query.q === 'reject') return { status: 422, body: { error: 'MERCHANT_QUERY_REFUSED' } };
  return originalAdmission(context);
};
app.config.routes[0].admit = 'acceptCacheRead';
const policy = { schema: 'stellar-forge.response-cache.v1', routes: { dataset: {
  shareAcrossBuyers: true, ttlMs: 3000, maxEntries: 4, maxBytes: 8192,
  maxEntryBytes: 1024, maxResponseBytes: 1024, varyHeaders: ['accept-language'],
} } };
const facilitator = {
  async getSupported() { return { kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }], extensions: ['bazaar'], signers: {} }; },
  async verify() { verified++; return { isValid: true, payer: 'LOCAL_ACCEPTANCE_NO_WALLET' }; },
  async settle() { return { success: true, network: 'stellar:testnet',
    transaction: `LOCAL_ACCEPTANCE_NO_CHAIN_${++settled}`, payer: 'LOCAL_ACCEPTANCE_NO_WALLET' }; },
};
const directory = await mkdtemp(join(tmpdir(), 'sf30-cache-'));
let seller;
try {
  seller = await startCachedSeller({ config: app.config, handlers: app.handlers, policy,
    port: 0, controlFile: join(directory, 'control.json'),
    nativeFactory: compiled => createNativeSellerServer(compiled, { facilitatorClient: facilitator }) });
  const unsigned = await fetch(seller.url + '/query?q=one');
  assert.equal(unsigned.status, 402); assert.equal(backendReads, 0);
  const challenge = JSON.parse(Buffer.from(unsigned.headers.get('payment-required'), 'base64'));
  const attempt = (q = 'one', extra = {}) => fetch(seller.url + '/query?q=' + q, { headers: {
    'payment-signature': encodePaymentSignatureHeader({ x402Version: 2,
      resource: { ...challenge.resource, url: 'https://merchant.example/query?q=' + q },
      accepted: challenge.accepts[0], extensions: challenge.extensions,
      payload: { acceptance: 'LOCAL_ONLY_NO_SIGNATURE' } }), ...extra,
  } });
  const responses = await Promise.all(Array.from({ length: 12 }, () => attempt()));
  const receipts = responses.map(response => response.headers.get('payment-response'));
  const pages = await Promise.all(responses.map(async response => {
    assert.equal(response.status, 200); return response.json();
  }));
  assert.equal(backendReads, 1); assert.equal(verified, 12); assert.equal(settled, 12);
  assert.equal(new Set(receipts).size, 12); assert.equal(new Set(pages.map(page => page.serial)).size, 1);
  assert.equal((await attempt()).status, 200); assert.equal(backendReads, 1); assert.equal(settled, 13);
  assert.equal((await fetch(seller.url + '/query?q=one')).status, 402); assert.equal(backendReads, 1);
  const beforeRejected = verified;
  assert.equal((await attempt('reject')).status, 422); assert.equal(verified, beforeRejected);
  assert.equal((await attempt('one', { range: 'bytes=0-5' })).status, 400); assert.equal(verified, beforeRejected);
  const snapshot = await callCacheControlFile(seller.controlFile, { op: 'status' });
  assert.equal(snapshot.dataset.entries, 1); assert.equal(snapshot.dataset.hits, 1);
  assert.ok(snapshot.dataset.coalesced >= 1); assert.ok(!JSON.stringify(snapshot).includes('credential'));
  await callCacheControlFile(seller.controlFile, { op: 'invalidate', route: 'dataset' });
  assert.equal((await attempt()).status, 200); assert.equal(backendReads, 2);
  const french = await (await attempt('one', { 'accept-language': 'fr' })).json();
  assert.equal(french.language, 'fr'); assert.equal(backendReads, 3);
  const privatePages = await Promise.all([attempt('private'), attempt('private')]);
  const privateValues = await Promise.all(privatePages.map(response => response.json()));
  assert.notEqual(privateValues[0].serial, privateValues[1].serial);
  assert.equal(backendReads, 5); assert.equal(settled, 17);
  assert.equal((await attempt('one', { 'cache-control': 'no-cache' })).status, 200); assert.equal(backendReads, 6);

  let release, sourceSignal;
  const cache = createResponseCache({ shareAcrossBuyers: true, ttlMs: 20, maxEntries: 1,
    handler: async input => { sourceSignal = input.signal; await new Promise(done => { release = done; }); return { body: { stable: true } }; } });
  const context = { method: 'GET', url: new URL('https://merchant.example/query?q=one'), headers: {}, body: null };
  const firstController = new AbortController();
  const first = cache.handler({ ...context, signal: firstController.signal });
  const second = cache.handler(context);
  await Promise.resolve(); firstController.abort();
  await assert.rejects(first, { name: 'AbortError' }); assert.equal(sourceSignal.aborted, false);
  release(); const original = await second; original.body.fill(0);
  assert.deepEqual(JSON.parse((await cache.handler(context)).body), { stable: true });
  await delay(25); assert.equal(cache.stats().entries, 0);
  const inFlight = cache.handler(context); await Promise.resolve(); cache.invalidate(); release(); await inFlight;
  assert.equal(cache.stats().entries, 0); assert.equal((await cache.close()).drained, true);
  const bounded = createResponseCache({ shareAcrossBuyers: true, maxEntries: 1, maxBytes: 1024,
    maxEntryBytes: 128, handler: input => ({ body: { path: input.url.pathname } }) });
  await bounded.handler(context); await bounded.handler({ ...context, url: new URL('https://merchant.example/other') });
  assert.equal(bounded.stats().entries, 1); assert.equal(bounded.stats().evictions, 1);
  await bounded.close();
  console.log(JSON.stringify({ result: 'PASS', source: 'original SF30 seller + original upstream availability + official x402 2.28.0',
    backendReads, controlledVerifyCalls: verified, controlledSettleCalls: settled, admitted,
    initialConcurrentBuyers: 12, initialBackendReads: 1, cache: seller.binding.stats(),
    control: 'private descriptor-authenticated loopback status and invalidation', externalRequests: 0, chainTransactions: 0 }));
} finally {
  if (seller) { seller.server.closeAllConnections(); await seller.close(); }
  backend.closeAllConnections(); await new Promise(done => backend.close(done));
  await rm(directory, { recursive: true, force: true });
}
