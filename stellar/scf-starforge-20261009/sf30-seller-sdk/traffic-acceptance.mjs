// MIT. One real HTTP exercise of the observer/panel, not a payment simulation.
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { compileServicePath, orderServiceRoutes, selectServiceRoute } from './route-path.mjs';
import { startSellerOperations } from './operate.mjs';
import { attachSellerTraffic } from './traffic.mjs';

function route(id, path, dynamic = false) {
  const offer = { resource: { url: 'https://seller.example' + (dynamic ? '/items/example' : path) },
    extensions: { bazaar: dynamic ? { routeTemplate: path,
      info: { input: { pathParams: { key: 'example' } } },
      schema: { properties: { input: { properties: { pathParams: {
        type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false,
      } } } } },
    } : {} } };
  return { id, path, method: 'GET', binding: compileServicePath(offer) };
}
const routes = orderServiceRoutes([route('dataset', '/dataset'), route('items', '/items/:key', true),
  route('unavailable', '/unavailable'), route('slow', '/slow'), route('abort', '/abort')]);
const server = createServer((req, res) => {
  let found;
  try { found = selectServiceRoute(routes, req.url.split('?')[0], req.method); }
  catch { res.writeHead(400); res.end('invalid'); return; }
  if (req.url.startsWith('/_seller/')) { res.end('metadata'); return; }
  if (!found?.route) { res.writeHead(found ? 405 : 404); res.end('missing'); return; }
  const id = found.route.id;
  if (id === 'abort') return; // Client terminates before any HTTP response exists.
  if (id === 'slow') {
    const timer = setTimeout(() => { res.writeHead(200); res.end('slow content'); }, 45);
    res.once('close', () => clearTimeout(timer)); return;
  }
  res.writeHead(id === 'unavailable' ? 503 : id === 'dataset' ? 402 : 200,
    { 'x-original-header': 'untouched', 'content-type': 'text/plain' });
  res.end('original content');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
const session = { server, compiled: { routes }, url, mode: 'CHALLENGE_ONLY' };
const panel = await startSellerOperations(session, { port: 0, recentLimit: 20 });
const stop = async () => {
  await panel.close();
  await new Promise((done, fail) => { server.close(err => err ? fail(err) : done()); server.closeAllConnections(); });
};
try {
  assert.throws(() => attachSellerTraffic(session), /already/);
  const canary = 'private-customer-token-9283';
  const first = await fetch(url + '/dataset?secret=' + canary, { headers: { authorization: 'Bearer ' + canary } });
  assert.equal(first.status, 402); assert.equal(first.headers.get('x-original-header'), 'untouched');
  assert.equal(await first.text(), 'original content');
  await Promise.all(Array.from({ length: 90 }, async (_, i) => {
    const response = await fetch(url + `/items/${canary}-${i}?token=${canary}`);
    assert.equal(response.status, 200); await response.text();
  }));
  for (const path of ['/_seller/health', '/unavailable', '/missing-' + canary, '/items/%ZZ'])
    await (await fetch(url + path)).text();
  const slow = fetch(url + '/slow').then(r => r.text());
  await delay(10); assert.ok(panel.observer.snapshot().totals.active >= 1);
  await slow;
  const aborted = request(url + '/abort'); aborted.on('error', () => {}); aborted.end();
  for (let tries = 0; panel.observer.snapshot().totals.active === 0 && tries < 100; tries++) await delay(2);
  assert.equal(panel.observer.snapshot().totals.active, 1);
  aborted.destroy(); await delay(20);
  const result = panel.observer.snapshot();
  assert.equal(result.totals.received, 97); assert.equal(result.totals.completed, 96);
  assert.equal(result.totals.aborted, 1); assert.equal(result.totals.active, 0);
  assert.equal(result.totals.latency.count, 96);
  assert.equal(result.recent.length, 20); assert.equal(result.recent[0].status, null);
  assert.equal(result.routes.find(row => row.routeId === 'items').received, 90);
  assert.equal(result.routes.length, 8); assert.ok(!JSON.stringify(result).includes(canary));
  const metrics = panel.observer.prometheus();
  assert.ok(!metrics.includes(canary));
  assert.match(metrics, /sf30_http_response_duration_seconds_bucket\{route_id="items",method="GET",le="\+Inf"\} 90/);
  const page = await fetch(panel.url); assert.equal(page.status, 200);
  assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.ok((await page.text()).includes('Your service, in view.'));
  assert.equal((await fetch(panel.url + '/app.mjs')).status, 200);
  assert.equal((await fetch(panel.url + '/api/traffic')).status, 200);
  assert.equal((await fetch(panel.url + '/metrics')).status, 200);
  assert.equal((await fetch(panel.url + '/traffic.json')).status, 200);
  assert.equal((await fetch(panel.url + '/api/traffic', { method: 'POST' })).status, 405);
  assert.equal((await fetch(panel.url + '/api/traffic', { headers: { origin: 'https://elsewhere.example' } })).status, 403);
  assert.equal((await fetch(panel.url + '/api/traffic', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(panel.url + '/../../etc/passwd')).status, 404);
  assert.equal((await fetch(panel.url + '/api/traffic', { method: 'HEAD' })).status, 200);
  const badHost = await new Promise((done, fail) => {
    const req = request(panel.url + '/api/traffic', { headers: { host: 'evil.example' } }, res => {
      res.resume(); res.on('end', () => done(res.statusCode));
    }); req.on('error', fail); req.end();
  });
  assert.equal(badHost, 403);
  assert.equal(panel.observer.snapshot().totals.received, 97); // Reading the panel generates no seller traffic.
  console.log(JSON.stringify({ status: 'PASS', actualHttpRequests: 97, completed: 96, aborted: 1,
    canonicalRouteGroups: result.routes.length, privateCanaryRetained: false, operations: panel.url,
    scope: 'Real Node HTTP observer/panel and original route matcher; no native payment/settlement run' }));
  if (process.argv.includes('--serve')) {
    process.once('SIGTERM', async () => { await stop(); process.exit(0); });
    process.once('SIGINT', async () => { await stop(); process.exit(0); });
    await new Promise(() => {});
  }
} finally { await stop(); }
