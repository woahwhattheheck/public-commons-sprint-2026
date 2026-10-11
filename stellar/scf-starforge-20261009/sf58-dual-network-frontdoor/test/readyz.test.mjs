import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { makeFrontdoor } from '../frontdoor.mjs';

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}
async function close(server) { await new Promise(resolve => server.close(resolve)); }

// Readiness *HTTP contract* only; mock upstreams must never be described as
// real funded facilitators or proof of Stellar settlement.
test('authenticated native dual-network readiness is fail-closed and never calls settlement', async () => {
  const servers = [];
  let edge;
  const calls = [];
  let stale = null;
  let down = null;
  const origins = {};
  try {
    for (const name of ['testnet', 'pubnet']) {
      const network = 'stellar:' + name;
      const peer = createServer((req, res) => {
        calls.push({name, method: req.method, path: req.url});
        if (req.url !== '/supported') { res.writeHead(404); res.end('{}'); return; }
        if (down === name) { res.writeHead(503); res.end('{"error":"temporarily unavailable"}'); return; }
        const actual = stale === name ? 'stellar:pubnet' : network;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          kinds: [{x402Version: 2, scheme: 'exact', network: actual}],
          extensions: [], signers: {'stellar:*': [name + '-signer']}
        }));
      });
      servers.push(peer);
      origins[network] = {origin: await listen(peer)};
    }
    edge = makeFrontdoor({upstreams: origins, allowLoopbackHttp: true,
      inboundToken: 'long-private-readiness-token'});
    const base = await listen(edge);
    const authorization = {authorization: 'Bearer long-private-readiness-token'};
    const health = await fetch(base + '/healthz');
    assert.equal(health.status, 200);
    assert.equal(calls.length, 0, 'configuration health must not probe original providers');
    const unauthenticated = await fetch(base + '/readyz');
    assert.equal(unauthenticated.status, 401);
    assert.equal(calls.length, 0, 'unauthorized readiness must not probe providers');
    const ready = await fetch(base + '/readyz', {headers: authorization});
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), {status: 'ready', networks: [
      {network: 'stellar:testnet', schemes: ['exact']},
      {network: 'stellar:pubnet', schemes: ['exact']}
    ]});
    assert.equal(calls.length, 2);
    stale = 'testnet';
    const mismatched = await fetch(base + '/readyz', {headers: authorization});
    assert.equal(mismatched.status, 503);
    assert.deepEqual(await mismatched.json(), {error: 'NOT_READY'});
    stale = null;
    down = 'pubnet';
    const unavailable = await fetch(base + '/readyz', {headers: authorization});
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), {error: 'NOT_READY'});
    assert.deepEqual(new Set(calls.map(c => c.method + ' ' + c.path)), new Set(['GET /supported']));
    down = null;
    const recovered = await fetch(base + '/readyz', {headers: authorization});
    assert.equal(recovered.status, 200);
  } finally {
    if (edge) await close(edge);
    for (const server of servers) await close(server);
  }
});
