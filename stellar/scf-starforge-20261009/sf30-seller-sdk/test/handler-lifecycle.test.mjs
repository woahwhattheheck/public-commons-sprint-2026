// MIT. Real Node HTTP + original SF30 modules; native payment boundary is a test double.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { compileSellerRoutes, createSellerResourceHandler } from '../resource-server.mjs';
import { validateHandlerTimeout } from '../handler-execution.mjs';
import { createSellerLifecycle } from '../lifecycle.mjs';
const deferred = () => Promise.withResolvers();

async function fixture(t, { handler = () => ({ body: { ok: true } }), admit,
  verify, settle, cancel, timeout = 1000, challengeOnly = false, maxInFlight = 64 } = {}) {
  const calls = { verify: 0, handler: 0, cancel: [], settle: 0 };
  const started = deferred(), verified = deferred(), settling = deferred(), done = deferred(), closed = deferred();
  const compiled = compileSellerRoutes([{ id: 'item', definition: {
    url: 'https://seller.example/item', method: 'GET', description: 'Lifecycle contract exercise',
    payment: { scheme: 'exact', network: 'stellar:testnet', amount: '1',
      asset: 'TEST_ASSET_NOT_A_WALLET', payTo: 'TEST_RECIPIENT_NOT_A_WALLET', maxTimeoutSeconds: 60 },
  }, ...(admit ? { admit } : {}), handler: context => {
    calls.handler++; started.resolve(context); return handler(context);
  } }]);
  const nativeServer = {
    async processHTTPRequest() {
      calls.verify++; verified.resolve(); await verify?.();
      return { type: 'payment-verified', paymentPayload: {}, paymentRequirements: {},
        beforeHandlerSettlement: { testOnly: true },
        cancellationDispatcher: { cancel: async details => {
          calls.cancel.push(details); await cancel?.(); return { testOnly: true };
        } } };
    },
    async processSettlement() {
      calls.settle++; settling.resolve(); await settle?.();
      return { success: true, headers: { 'payment-response': 'test-only-success' } };
    },
    createFailurePathSettlementHeaders: () => ({ 'payment-response': 'test-only-cancellation' }),
  };
  const dispatch = createSellerResourceHandler({ compiled,
    nativeServer: challengeOnly ? null : nativeServer, handlerTimeoutMs: timeout });
  let received = 0;
  const server = createServer((req, res) => {
    const first = ++received === 1;
    res.once('close', () => { if (first) closed.resolve(); });
    Promise.resolve(lifecycle.handle(req, res, () => dispatch(req, res)))
      .then(value => { if (first) done.resolve(value); }, done.reject);
  });
  const lifecycle = createSellerLifecycle(server, { maxInFlight, drainGraceMs: 1000 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  let request;
  const result = new Promise((resolve, reject) => {
    request = get(`http://127.0.0.1:${server.address().port}/item`, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
        text: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    request.on('error', reject);
  });
  result.catch(() => {}); // Aborted client requests are intentional in this exercise.
  return { calls, request, result, lifecycle, url: `http://127.0.0.1:${server.address().port}/item`,
    started: started.promise, verified: verified.promise,
    settling: settling.promise, done: done.promise, closed: closed.promise };
}

test('deadline aborts handler signal, keeps native cancellation receipt and ignores late result', async t => {
  const late = deferred();
  const f = await fixture(t, { timeout: 25, handler: () => late.promise });
  const context = await f.started;
  const response = await f.result;
  assert.equal(response.status, 504);
  assert.equal(JSON.parse(response.text).error, 'APPLICATION_TIMEOUT');
  assert.equal(response.headers['payment-response'], 'test-only-cancellation');
  assert.equal(context.signal.aborted, true);
  assert.equal(f.lifecycle.snapshot().inFlight, 1);
  late.resolve({ body: 'too late' }); await f.done;
  assert.equal(f.lifecycle.snapshot().inFlight, 0);
  assert.equal(f.calls.cancel.length, 1); assert.equal(f.calls.settle, 0);
  assert.equal(f.calls.cancel[0].reason, 'handler_threw');
  assert.equal(f.calls.cancel[0].error.code, 'APPLICATION_TIMEOUT');
});

test('disconnect during handler cancels once; late rejection is consumed', async t => {
  const late = deferred();
  const f = await fixture(t, { handler: () => late.promise });
  const context = await f.started;
  f.request.destroy(); await f.closed;
  assert.equal(context.signal.aborted, true);
  late.reject(new Error('late backend rejection')); await f.done;
  assert.equal(f.calls.cancel.length, 1); assert.equal(f.calls.settle, 0);
  assert.equal(f.calls.cancel[0].error.code, 'CLIENT_DISCONNECTED');
});

test('disconnect during verification: cancel its eventual verified result without handler', async t => {
  const gate = deferred();
  const f = await fixture(t, { verify: () => gate.promise });
  await f.verified; f.request.destroy(); await f.closed;
  gate.resolve(); await f.done;
  assert.equal(f.calls.handler, 0); assert.equal(f.calls.cancel.length, 1);
  assert.equal(f.calls.settle, 0);
});

test('disconnect after settlement starts neither cancels nor times out or retries settlement', async t => {
  const gate = deferred();
  const f = await fixture(t, { timeout: 20, settle: () => gate.promise });
  await f.settling; f.request.destroy(); await f.closed; await delay(35);
  assert.equal(f.calls.cancel.length, 0); assert.equal(f.calls.settle, 1);
  assert.equal(f.lifecycle.snapshot().inFlight, 1);
  gate.resolve(); await f.done;
  assert.equal(f.calls.cancel.length, 0); assert.equal(f.calls.settle, 1);
});

test('normal, bodyless, failed, thrown, cancellation-error and unpaid paths remain distinct', async t => {
  for (const [options, status, cancels, settlements] of [
    [{}, 200, 0, 1], [{ handler: () => ({ status: 204 }) }, 204, 0, 1],
    [{ handler: () => ({ status: 422, body: { error: 'invalid' } }) }, 422, 1, 0],
    [{ handler: () => { throw new Error('private error'); } }, 500, 1, 0],
    [{ handler: () => { throw new Error('private error'); }, cancel: () => { throw new Error('private native error'); } }, 502, 1, 0],
    [{ challengeOnly: true }, 402, 0, 0],
  ]) {
    const f = await fixture(t, options), response = await f.result; await f.done;
    assert.equal(response.status, status); assert.equal(f.calls.cancel.length, cancels);
    assert.equal(f.calls.settle, settlements); assert.doesNotMatch(response.text, /private error|private native error/);
    if (status === 204) assert.equal(response.text, '');
  }
});

test('disconnect during admission does not enter verification, and timeout configuration is strict', async t => {
  const admitted = deferred();
  const f = await fixture(t, { admit: ({ signal }) => {
    admitted.resolve(signal); return new Promise(() => {});
  } });
  const signal = await admitted.promise; f.request.destroy(); await f.closed; await f.done;
  assert.equal(signal.aborted, true); assert.equal(f.calls.verify, 0); assert.equal(f.calls.cancel.length, 0);
  for (const invalid of [0, -1, NaN, 1.5, '1000', 300001]) assert.throws(() => validateHandlerTimeout(invalid));
  assert.equal(validateHandlerTimeout(30000), 30000);
});


test('abandoned native work retains capacity and prevents a false clean drain', async t => {
  const gate = deferred();
  const f = await fixture(t, { verify: () => gate.promise, maxInFlight: 1 });
  await f.verified; f.request.destroy(); await f.closed;
  assert.equal(f.lifecycle.snapshot().inFlight, 1);
  const rejected = await fetch(f.url);
  assert.equal(rejected.status, 503); await rejected.arrayBuffer();
  assert.equal(f.calls.verify, 1);
  let drained = false;
  const closing = f.lifecycle.close().then(value => { drained = true; return value; });
  await delay(20); assert.equal(drained, false);
  gate.resolve(); await f.done;
  const final = await closing;
  assert.equal(final.state, 'CLOSED'); assert.equal(final.inFlight, 0);
  assert.equal(final.capacityRejected, 1); assert.equal(f.calls.cancel.length, 1);
});

test('drain deadline reports unresolved execution even with no connected sockets', async t => {
  const gate = deferred();
  const f = await fixture(t, { verify: () => gate.promise });
  await f.verified; f.request.destroy(); await f.closed;
  await assert.rejects(f.lifecycle.close(), { code: 'SELLER_DRAIN_DEADLINE_EXCEEDED' });
  assert.equal(f.lifecycle.snapshot().forcedClose, true);
  assert.equal(f.lifecycle.snapshot().inFlight, 1);
  gate.resolve(); await f.done;
  assert.equal(f.lifecycle.snapshot().inFlight, 0); assert.equal(f.calls.cancel.length, 1);
});


test('a signal-aware merchant HTTP request actually closes its backend connection', async t => {
  const entered = deferred(), closed = deferred();
  const backend = createServer((_req, res) => {
    entered.resolve(); res.once('close', () => closed.resolve());
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => new Promise(resolve => { backend.close(resolve); backend.closeAllConnections(); }));
  const f = await fixture(t, { timeout: 100, handler: async ({ signal }) => {
    await fetch(`http://127.0.0.1:${backend.address().port}/slow`, { signal });
    return { body: 'not reached' };
  } });
  await entered.promise;
  assert.equal((await f.result).status, 504);
  await closed.promise; await f.done;
  assert.equal(f.calls.cancel.length, 1); assert.equal(f.calls.settle, 0);
  assert.equal(f.lifecycle.snapshot().inFlight, 0);
});
