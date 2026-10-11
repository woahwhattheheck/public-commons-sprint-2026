// MIT. One real loopback HTTP acceptance for the upstream application handler.
// No facilitator mock, blockchain receipt, external request, or SDK claim.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createUpstreamHandler } from './upstream-handler.mjs';

const seen = [], observations = [];
let slow = true, credential = 'local-fixture-one';
const server = createServer(async (req, res) => {
  const parts = []; for await (const part of req) parts.push(part);
  const item = { method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(parts).toString() };
  seen.push(item);
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.endsWith('/slow') && slow) return;
  if (path.endsWith('/redirect')) { res.writeHead(302, { location: '/never-follow' }); res.end(); return; }
  if (path.endsWith('/error')) { res.writeHead(503, { 'retry-after': '7' }); res.end('private upstream stack + credential'); return; }
  if (path.endsWith('/nested-payment')) { res.writeHead(402, { 'payment-required': 'secret' }); res.end(); return; }
  if (path.endsWith('/auth')) { res.writeHead(401); res.end('private auth failure'); return; }
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('set-cookie', 'private-session=fixture');
  res.setHeader('payment-response', 'not-a-settlement');
  res.setHeader('x-internal-secret', 'fixture');
  res.setHeader('connection', 'close, x-hop-only');
  res.setHeader('x-hop-only', 'transport-only');
  if (path.endsWith('/gzip') || path.endsWith('/large')) {
    res.setHeader('content-encoding', 'gzip');
    res.end(gzipSync(JSON.stringify({ value: path.endsWith('/large') ? 'x'.repeat(8192) : 'original bytes' }))); return;
  }
  if (path.endsWith('/broken')) { res.end('{not JSON'); return; }
  if (path.endsWith('/partial')) { res.setHeader('content-length', '999'); res.end('{"ok":true}'); return; }
  res.end(JSON.stringify({ ok: true, method: req.method, body: item.body ? JSON.parse(item.body) : null }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const make = (path, extra = {}) => createUpstreamHandler({ baseUrl, path, allowLocal: true, ...extra });
const ctx = (method = 'GET', params = {}, query = '') => ({ method, pathParams: params,
  url: new URL(`https://seller.example/resource${query}`), headers: {}, body: null });
try {
  const handler = make('/items/:id', { query: { city: 'q', tag: 'tag' }, requestHeaders: ['accept-language', 'x-hop-only'], responseHeaders: ['content-type', 'x-hop-only'],
    headers: () => ({ Authorization: `Bearer ${credential}` }), onResult: e => observations.push(e) });
  const request = ctx('GET', { id: 'Clé 1' }, '?city=Louisville&tag=a&tag=b');
  request.headers = { authorization: 'buyer-credential', cookie: 'buyer-cookie',
    'payment-signature': 'buyer-payment', 'x-forwarded-host': 'attacker', 'accept-language': 'fr', connection: 'x-hop-only', 'x-hop-only': 'transport-only' };
  const first = await handler(request);
  assert.equal(first.status, 200); assert.equal(JSON.parse(first.body).ok, true);
  assert.equal(seen.at(-1).path, '/v1/items/Cl%C3%A9%201?q=Louisville&tag=a&tag=b');
  assert.equal(seen.at(-1).headers.authorization, 'Bearer local-fixture-one');
  for (const name of ['cookie', 'payment-signature', 'x-forwarded-host', 'x-hop-only']) assert.equal(seen.at(-1).headers[name], undefined);
  assert.equal(seen.at(-1).headers['accept-language'], 'fr');
  for (const name of ['set-cookie', 'payment-response', 'x-internal-secret', 'x-hop-only']) assert.equal(first.headers[name], undefined);
  credential = 'local-fixture-two'; await handler(request);
  assert.equal(seen.at(-1).headers.authorization, 'Bearer local-fixture-two');
  const count = seen.length;
  assert.equal((await handler(ctx('GET', { id: '..' }))).status, 400);
  assert.equal((await handler(ctx('GET', { id: 'a/b' }))).status, 400);
  assert.equal((await handler(ctx('GET', { id: 'a' }, '?undeclared=1'))).status, 400);
  assert.equal(seen.length, count);
  assert.throws(() => make('/items', { requestHeaders: ['authorization'] }));
  assert.throws(() => make('/items', { responseHeaders: ['payment-response'] }));
  assert.throws(() => make('/items', { headers: { 'PAYMENT-SIGNATURE': 'fixture' } }));
  const lookups = [];
  const pinned = createUpstreamHandler({ baseUrl: baseUrl.replace('127.0.0.1', 'localhost'),
    path: '/pinned', allowLocal: true,
    lookup(hostname, options, callback) {
      lookups.push({ hostname, all: options.all === true });
      if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
      else callback(null, '127.0.0.1', 4);
    } });
  assert.equal((await pinned(ctx())).status, 200);
  assert.equal(lookups.length, 1); assert.equal(lookups[0].hostname, 'localhost');
  assert.equal(seen.at(-1).headers.host, `localhost:${server.address().port}`);
  const unresolved = createUpstreamHandler({ baseUrl: baseUrl.replace('127.0.0.1', 'localhost'),
    path: '/never-resolved', allowLocal: true, timeoutMs: 100, lookup() {} });
  const beforeLookup = seen.length;
  assert.equal((await unresolved(ctx())).body.error, 'UPSTREAM_TIMEOUT');
  assert.equal(seen.length, beforeLookup);
  assert.throws(() => make('/items', { lookup: 'not-a-function' }));
  console.log('PASS path/query mapping, credential rotation, header isolation, trusted lookup, preflight');

  const post = make('/score', { method: 'POST' }), input = ctx('POST');
  input.body = { nested: ['é', 3], flag: false };
  assert.deepEqual(JSON.parse((await post(input)).body).body, input.body);
  assert.deepEqual(JSON.parse(seen.at(-1).body), input.body);
  assert.equal(seen.at(-1).method, 'POST');
  input.body = null; assert.equal(JSON.parse((await post(input)).body).body, null);
  const head = await make('/score', { method: 'HEAD' })(ctx('HEAD'));
  assert.equal(head.status, 200); assert.equal(head.body.length, 0);
  const compressed = await make('/gzip')(ctx());
  assert.deepEqual(JSON.parse(compressed.body), { value: 'original bytes' });
  assert.equal(compressed.headers['content-encoding'], undefined);
  console.log('PASS JSON POST/null, HEAD, compressed JSON byte delivery');

  const refusals = { redirect: 'UPSTREAM_REDIRECT_REFUSED', error: 'UPSTREAM_REQUEST_FAILED',
    'nested-payment': 'UPSTREAM_PAYMENT_REQUIRED', auth: 'UPSTREAM_AUTH_FAILED',
    broken: 'UPSTREAM_JSON_INVALID', partial: 'UPSTREAM_RESPONSE_INCOMPLETE', large: 'UPSTREAM_RESPONSE_TOO_LARGE' };
  for (const [path, expected] of Object.entries(refusals)) {
    const count = seen.length;
    const result = await make('/' + path, { timeoutMs: 1000, maxResponseBytes: 1024 })(ctx());
    assert.equal(result.body.error, expected, path);
    assert.equal(seen.length, count + 1, 'one request, no retries');
    assert.ok(!JSON.stringify(result).includes('private upstream'));
    if (path === 'error') assert.equal(result.headers['retry-after'], '7');
  }
  assert.ok(!seen.some(item => item.path === '/never-follow'));
  console.log('PASS sanitized upstream failures, redirects, partial/oversized body, no retries');

  const bounded = make('/slow', { timeoutMs: 100, maxInFlight: 1 });
  const pending = bounded(ctx());
  assert.equal((await bounded(ctx())).body.error, 'UPSTREAM_CAPACITY_EXHAUSTED');
  assert.equal((await pending).body.error, 'UPSTREAM_TIMEOUT');
  slow = false;
  assert.equal((await bounded(ctx())).status, 200);
  assert.deepEqual(bounded.snapshot(), { started: 2, completed: 2, inFlight: 0, failed: 1, timedOut: 1,
    responseBytes: Buffer.byteLength(JSON.stringify({ ok: true, method: 'GET', body: null })) });
  assert.ok(observations.length === 2 && !JSON.stringify(observations).includes('fixture'));
  console.log('PASS full response deadline, capacity recovery, content-free metrics');
  console.log(JSON.stringify({ result: 'PASS', groups: 4, upstreamRequests: seen.length, externalRequests: 0,
    scope: 'real Node HTTP upstream handler; payment SDK integration not executed by this runner' }));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
