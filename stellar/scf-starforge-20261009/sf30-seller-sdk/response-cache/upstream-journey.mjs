// One real original-HTTP integration journey for the upstream/cache composition.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createCachedUpstream } from './upstream.mjs';
import { upstreamFreshness } from './http-freshness.mjs';

let calls = 0, credential = 'generation-a', headerCalls = 0, unavailable = false;
let slowStarted, releaseSlow;
const beganSlow = new Promise(resolve => { slowStarted = resolve; });
const slowDone = new Promise(resolve => { releaseSlow = resolve; });
const backend = createServer(async (request, response) => {
  const number = ++calls, url = new URL(request.url, 'http://localhost');
  const mode = url.searchParams.get('mode'), plan = request.headers.authorization === 'Bearer generation-a' ? 'a' : 'b';
  if (mode === 'slow') { slowStarted(); await slowDone; }
  else await new Promise(resolve => setTimeout(resolve, 15));
  response.setHeader('content-type', 'application/json');
  response.setHeader('vary', 'accept-language');
  if (mode !== 'unauthorized-cache') response.setHeader('cache-control', mode === 'private' ? 'private, max-age=60' : 'public, max-age=60');
  if (mode === 'stale') response.setHeader('age', '90');
  response.end(JSON.stringify({ number, plan, language: request.headers['accept-language'] ?? '', query: url.search }));
});
backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
const baseUrl = `http://127.0.0.1:${backend.address().port}`;
const upstream = { baseUrl, path: '/v1/forecast', method: 'GET', query: ['mode'],
  headers: () => { headerCalls++; if (unavailable) throw new Error('Unavailable'); return { Authorization: `Bearer ${credential}` }; },
  requestHeaders: ['accept-language'], allowLocal: true, timeoutMs: 2000 };
const policy = { shareAcrossBuyers: true, ttlMs: 60000, maxSourceInFlight: 3, maxWaiters: 12, sourceTimeoutMs: 3000 };
const cache = createCachedUpstream(upstream, policy);
const context = (mode = 'public', language = 'en', extra = {}) => ({ method: 'GET',
  url: new URL(`https://merchant.example/weather?mode=${mode}`), pathParams: {},
  headers: { 'accept-language': language, ...extra } });
const payload = result => { assert.equal(result.status, 200); return JSON.parse(result.body.toString()); };
let limited;
try {
  const simultaneous = await Promise.all(Array.from({ length: 3 }, () => cache.handler(context())));
  assert.equal(calls, 1); assert.equal(headerCalls, 3);
  assert.ok(simultaneous.every(result => payload(result).plan === 'a'));
  assert.ok(simultaneous.every(result => !('cacheMetadata' in result) && !('cache-control' in result.headers) && !('age' in result.headers)));
  payload(await cache.handler(context())); assert.equal(calls, 1); assert.equal(headerCalls, 4);
  assert.equal(payload(await cache.handler(context('public', 'fr'))).language, 'fr'); assert.equal(calls, 2);
  credential = 'generation-b'; assert.equal(payload(await cache.handler(context())).plan, 'b'); assert.equal(calls, 3);
  credential = 'generation-a'; assert.equal(payload(await cache.handler(context())).plan, 'a'); assert.equal(calls, 4);
  unavailable = true; assert.equal((await cache.handler(context())).status, 503); assert.equal(calls, 4); unavailable = false;
  const beforePrivate = calls;
  await Promise.all([cache.handler(context('private')), cache.handler(context('private'))]);
  assert.equal(calls - beforePrivate, 2);
  const beforeStale = calls;
  payload(await cache.handler(context('stale'))); payload(await cache.handler(context('stale')));
  assert.equal(calls - beforeStale, 2);
  const beforeAuth = calls;
  payload(await cache.handler(context('unauthorized-cache'))); payload(await cache.handler(context('unauthorized-cache')));
  assert.equal(calls - beforeAuth, 2);
  const beforeBypass = calls;
  payload(await cache.handler(context('public', 'en', { 'cache-control': 'no-cache' })));
  assert.equal(calls - beforeBypass, 1);
  assert.equal((await cache.handler(context('public', 'en', { 'cache-control': 'only-if-cached' }))).status, 504);
  assert.equal(calls - beforeBypass, 1);
  cache.invalidate(); payload(await cache.handler(context())); assert.equal(calls - beforeBypass, 2);

  limited = createCachedUpstream(upstream, { ...policy, maxSourceInFlight: 1 });
  credential = 'generation-a'; const prior = limited.handler(context('slow')); await beganSlow;
  credential = 'generation-b'; const capacity = await limited.handler(context());
  assert.equal(capacity.status, 503); assert.equal(limited.stats().sourceInFlight, 1);
  releaseSlow(); assert.equal(payload(await prior).plan, 'a');
  assert.equal(payload(await limited.handler(context())).plan, 'b');
  assert.equal(limited.stats().retiredGenerations, 0);

  const originTime = Date.UTC(2026, 9, 11, 15, 0, 0);
  const fresh = upstreamFreshness({ status: 200, headers: { 'cache-control': 'public, s-maxage=20, max-age=1',
    age: '5', date: new Date(originTime).toUTCString() } },
  { ttlMs: 60000, requestTime: originTime, responseTime: originTime + 2000, now: originTime + 3000, authenticated: true });
  assert.equal(fresh.ttlMs, 12000); // max(2s apparent, 5s Age + 2s delay) + 1s resident.
  assert.equal(upstreamFreshness({ status: 200, headers: { 'cache-control': 'public, max-age=1, max-age=20' } },
    { ttlMs: 60000, requestTime: originTime, responseTime: originTime, now: originTime }).cacheable, false);
  console.log(JSON.stringify({ status: 'PASS', upstreamCalls: calls, headerFactoryCalls: headerCalls,
    checks: ['original HTTP coalescing', 'locale and frozen credential isolation', 'credential failure and rotation back',
      'private, stale and authenticated response handling', 'request bypass and operator invalidation',
      'aggregate source capacity across rotations', 'RFC freshness precedence and age arithmetic'] }));
} finally {
  releaseSlow(); await Promise.all([cache.close(), limited?.close()]); backend.closeAllConnections();
  await new Promise(resolve => backend.close(resolve));
}
