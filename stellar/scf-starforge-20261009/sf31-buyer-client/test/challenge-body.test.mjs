// Initial 402 bodies are unused: approval reads the canonical header only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { X402BuyerClient } from '../buyer.mjs';
import { createPublicHttpsFetch } from '../public-transport.mjs';

const url = 'https://merchant.example/paid';
const terms = { scheme: 'exact', network: 'stellar:testnet', asset: 'fixture-asset',
  payTo: 'fixture-recipient', amount: '5', maxTimeoutSeconds: 60 };
const expect = { ...terms, maxAtomic: '5' };
const challenge = { x402Version: 2, resource: { url }, accepts: [terms] };
const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64');
const signNever = () => assert.fail('No signer may run');

test('streaming initial 402 closes while operator approval is still pending', async t => {
  let closed = false, resolveClose;
  const closeObserved = new Promise(resolve => { resolveClose = resolve; });
  const server = createServer((req, res) => {
    assert.equal(req.headers['payment-signature'], undefined);
    res.on('close', () => { closed = true; resolveClose(); });
    res.writeHead(402, { 'payment-required': encoded(challenge) });
    res.write('unused challenge body remains open');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  // Explicit test-only socket remap exercises the original response stream and
  // actual HTTP close. This is not a TLS or external payment acceptance claim.
  const transport = createPublicHttpsFetch({ timeoutMs: 5000,
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    requestImpl: (options, callback) => request({ ...options, protocol: 'http:',
      hostname: '127.0.0.1', port: server.address().port, lookup: undefined }, callback),
  });
  const buyer = new X402BuyerClient({ fetchImpl: transport });
  await assert.rejects(buyer.call({ url, expect, sign: signNever, approve: async () => {
    let timer;
    try { await Promise.race([closeObserved, new Promise(resolve => { timer = setTimeout(resolve, 500); })]); }
    finally { clearTimeout(timer); }
    assert.equal(closed, true, 'unused challenge socket must close before operator finishes');
    return false;
  } }), { code: 'PAYMENT_NOT_APPROVED', paymentSent: false });
});

test('malformed challenges and rejected terms release their bodies before throwing', async () => {
  for (const [header, authorized, code] of [
    ['not-base64', expect, 'BAD_PAYMENT_REQUIRED_HEADER'],
    [encoded({ ...challenge, resource: { url: url + '?other=1' } }), expect, 'RESOURCE_MISMATCH'],
    [encoded(challenge), { ...expect, maxAtomic: '1' }, 'PAYMENT_TERMS_NOT_AUTHORIZED'],
  ]) {
    let cancelled = 0;
    const buyer = new X402BuyerClient({ fetchImpl: async () => new Response(new ReadableStream({
      cancel() { cancelled++; },
    }), { status: 402, headers: { 'payment-required': header } }) });
    await assert.rejects(buyer.call({ url, expect: authorized,
      approve: () => assert.fail('Invalid challenge must not reach approval'), sign: signNever,
    }), { code, paymentSent: false });
    assert.equal(cancelled, 1);
  }
});

test('cancellation cannot stall approval or replace the original result', { timeout: 2000 }, async () => {
  for (const cancel of [() => new Promise(() => {}), () => Promise.reject(Error('cancel failed')), () => { throw Error('cancel threw'); }]) {
    let cancelled = 0, approvals = 0;
    const buyer = new X402BuyerClient({ fetchImpl: async () => ({ status: 402,
      headers: new Headers({ 'payment-required': encoded(challenge) }),
      body: { cancel: () => { cancelled++; return cancel(); } },
    }) });
    await assert.rejects(buyer.call({ url, expect, sign: signNever,
      approve: () => { approvals++; return false; },
    }), { code: 'PAYMENT_NOT_APPROVED', paymentSent: false });
    assert.equal(cancelled, 1); assert.equal(approvals, 1);
  }
});

test('free and paid response bodies remain readable by the caller', async () => {
  const free = new X402BuyerClient({ fetchImpl: async () => new Response('free body') });
  const result = await free.call({ url, expect, approve: () => assert.fail('No approval needed'), sign: signNever });
  assert.equal(await result.response.text(), 'free body');
  let requests = 0;
  const paid = new X402BuyerClient({ fetchImpl: async () => ++requests === 1
    ? new Response('unused', { status: 402, headers: { 'payment-required': encoded(challenge) } })
    : new Response('paid fixture body') });
  const paidResult = await paid.call({ url, expect, approve: () => true,
    sign: async ({ challenge, accepted }) => ({ ...challenge, accepted, payload: { fixtureOnly: true } }),
  });
  assert.equal(requests, 2); assert.equal(paidResult.status, 'PAYMENT_OUTCOME_UNKNOWN');
  assert.equal(await paidResult.response.text(), 'paid fixture body');
});
