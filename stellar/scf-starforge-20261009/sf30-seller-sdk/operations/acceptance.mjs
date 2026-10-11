// MIT. One real HTTP integration exercise; controlled statuses, no facilitator or payment.
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { EventEmitter } from 'node:events';
import { compileServicePath, orderServiceRoutes, selectServiceRoute } from '../route-path.mjs';
import { startSellerOperations } from './server.mjs';
import { observeSellerTraffic } from './traffic.mjs';

const fixed = { resource: { url: 'https://seller.example/dataset' } };
const dynamic = { resource: { url: 'https://seller.example/items/example' }, extensions: { bazaar: {
  routeTemplate: '/items/:id', info: { input: { pathParams: { id: 'example' } } },
  schema: { properties: { input: { properties: { pathParams: { type: 'object',
    properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } } } } },
} } };
const routes = orderServiceRoutes([['dataset', fixed], ['item', dynamic]].map(([id, offer]) => {
  const binding = compileServicePath(offer);
  return { id, offer, binding, path: binding.path, method: 'GET' };
}));
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/_seller/')) { res.end('{}'); return; }
  let selected;
  try { selected = selectServiceRoute(routes, url.pathname, req.method); }
  catch { res.writeHead(400); res.end(); return; }
  if (!selected) { res.writeHead(404); res.end(); return; }
  if (!selected.route) { res.writeHead(405); res.end(); return; }
  if (url.searchParams.has('disconnect')) { res.destroy(); return; }
  const code = Number(url.searchParams.get('status') || 402);
  setTimeout(() => { res.writeHead(code); res.end('controlled response'); }, 5);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const seller = `http://127.0.0.1:${server.address().port}`;
const session = { server, compiled: { routes }, mode: 'CHALLENGE_ONLY' };
const ops = await startSellerOperations(session, { port: 0 });
const call = (url, options) => fetch(url, options).then(async response => { await response.text(); return response.status; });
try {
  await Promise.all([call(seller + '/dataset'), call(seller + '/dataset?status=200&api_key=NEVER_RETAIN_ME'),
    call(seller + '/items/PRIVATE_PERSON?status=503', { headers: { authorization: 'NEVER_RETAIN_ME' } }),
    call(seller + '/dataset', { method: 'POST' }), call(seller + '/no-such-user-SECRET'),
    call(seller + '/_seller/health'), call(seller + '/items/%ZZ')]);
  await call(seller + '/dataset?disconnect=1').catch(() => {});
  await new Promise(done => setTimeout(done, 20));
  const snapshot = await fetch(ops.url + '/api/snapshot').then(r => r.json());
  assert.equal(snapshot.totals.started, 7); assert.equal(snapshot.totals.completed, 7);
  assert.equal(snapshot.totals.responses, 6); assert.equal(snapshot.totals.inFlight, 0);
  assert.equal(snapshot.totals.success, 1); assert.equal(snapshot.totals.challenge, 1);
  assert.equal(snapshot.totals.serverError, 1); assert.equal(snapshot.totals.clientError, 3);
  assert.equal(snapshot.totals.disconnected, 1); assert.equal(snapshot.ignoredMetadata, 1);
  assert.equal(snapshot.routes.find(r => r.id === 'item').serverError, 1);
  assert.equal(snapshot.minutes.length, 60); assert.equal(snapshot.observerErrors, 0);
  assert(!/NEVER_RETAIN_ME|PRIVATE_PERSON|no-such-user-SECRET|api_key|authorization/.test(JSON.stringify(snapshot)));
  const csv = await fetch(ops.url + '/export.csv').then(r => r.text());
  assert(csv.includes('"\'@unmatched"')); assert.equal(csv.split('\r\n').length, 7);
  assert.equal(await call(ops.url + '/api/snapshot', { headers: { origin: 'https://evil.example' } }), 403);
  assert.equal(await new Promise((done, fail) => {
    const r = request(ops.url + '/api/snapshot', { headers: { host: 'evil.example' } }, res => { res.resume(); res.on('end', () => done(res.statusCode)); });
    r.once('error', fail); r.end();
  }), 403);
  assert.equal(await call(ops.url + '/api/snapshot', { method: 'POST' }), 405);
  assert.equal(await call(ops.url + '/style.css'), 200); assert.equal(await call(ops.url + '/console.mjs'), 200);
  const head = await fetch(ops.url + '/', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  ops.observer.detach(); await call(seller + '/dataset');
  assert.equal(ops.observer.snapshot().totals.started, 7);
  console.log('PASS: real HTTP outcomes, dynamic route identity, disconnect de-duplication, privacy, exports, origin/method controls and detach');
} finally { await ops.close(); await new Promise(done => server.close(done)); }

// Advance a clock to exercise the bounded rolling ring without a long-running timer.
const fakeServer = new EventEmitter(); let now = 0, tick = 0;
const observer = observeSellerTraffic({ ...session, server: fakeServer }, { now: () => now, monotonic: () => tick });
for (let i = 0; i < 180; i++) {
  now = i * 60000; const res = new EventEmitter(); res.statusCode = 200;
  fakeServer.emit('request', { url: '/dataset', method: 'GET' }, res);
  tick += 7; res.writableFinished = true; res.emit('finish'); res.emit('close');
}
const rolling = observer.snapshot();
assert.equal(rolling.totals.started, 180); assert.equal(rolling.minutes.length, 60);
assert.equal(rolling.minutes.reduce((n, row) => n + row.started, 0), 60);
assert.equal(rolling.totals.latencyP95UpperBoundMs, 10); observer.detach();
console.log('PASS: bounded 60-minute aggregates and measured histogram upper bound');
