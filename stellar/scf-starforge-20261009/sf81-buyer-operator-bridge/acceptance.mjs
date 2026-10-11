// Focused native-module integration fixture. No real wallet, seller or chain.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OperatorApprovedBuyer } from './bridge.mjs';

const dir = process.env.SF81_FIXTURE_DIR;
const terms = { scheme: 'exact', network: 'stellar:testnet', asset: 'C' + 'A'.repeat(55),
  payTo: 'G' + 'A'.repeat(55), amount: '7', maxTimeoutSeconds: 60,
  extra: { memo: 'Original Unicode terms: café', paymentFlow: 'authorization' } };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');
const sends = [], signatures = [];
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  const signed = Boolean(req.headers['payment-signature']);
  sends.push({ path: req.url, method: req.method, body, signed });
  if (req.url === '/free') { res.end('free'); return; }
  if (!signed) {
    res.writeHead(402, { 'payment-required': encode({ x402Version: 2,
      resource: { url: 'https://merchant.example' + req.url }, accepts: [terms] }) });
    res.end('payment required'); return;
  }
  if (req.url === '/lost') { res.destroy(); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ delivered: true })); // no fabricated settlement receipt
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
// Only the transport is redirected to our real loopback HTTP fixture. The
// unchanged SF31 and SF36 modules both validate the original HTTPS identity.
const fetchImpl = (url, options) => {
  assert.equal(url.origin, 'https://merchant.example');
  return fetch(`http://127.0.0.1:${server.address().port}${url.pathname}`, options);
};
const operator = { python: process.env.SF81_PYTHON, actor: 'fixture-actor',
  service: 'fixture-seller', policy: join(dir, 'policy.json'),
  ledger: join(dir, 'ledger.sqlite'), timeoutMs: 3000 };
const buyer = new OperatorApprovedBuyer({ operator, fetchImpl });
const sign = async ({ intent, challenge, accepted }) => {
  assert.ok(Object.isFrozen(intent) && Object.isFrozen(intent.acceptedTerms));
  assert.equal(intent.bodyBytes, Buffer.byteLength('{"city":"Zürich"}'));
  signatures.push(intent.intentId);
  return { x402Version: 2, accepted, resource: challenge.resource,
    payload: { fixtureOnly: true } };
};
const call = (intentId, path = '/' + intentId, extra = {}, client = buyer) =>
  client.call({ intentId, url: 'https://merchant.example' + path, method: 'POST',
    body: '{"city":"Zürich"}', expect: { ...terms, maxAtomic: '9' }, sign, ...extra });
try {
  if (process.argv.includes('--no-tty')) {
    await assert.rejects(call('no-tty'), e => e.code === 'OPERATOR_NO_APPROVAL');
    assert.equal(signatures.length, 0); assert.equal(sends.length, 1);
    console.log('NO_TTY_PASS');
  } else {
    const free = await call('free');
    assert.equal(free.status, 'NO_PAYMENT_REQUIRED');
    assert.equal(free.operatorReservation, null);
    console.log('STEP deny');
    await assert.rejects(call('deny'), e => e.code === 'OPERATOR_NO_APPROVAL');
    console.log('STEP approved');
    const good = await call('approved');
    assert.equal(good.status, 'PAYMENT_OUTCOME_UNKNOWN');
    assert.equal(good.reason, 'MISSING_PAYMENT_RESPONSE');
    assert.equal(good.operatorReservation.reserved_atomic_units, '7');
    assert.deepEqual(await good.response.json(), { delivered: true });
    console.log('STEP duplicate');
    await assert.rejects(call('approved'), e => e.code === 'OPERATOR_NO_APPROVAL');
    console.log('STEP lost');
    await assert.rejects(call('lost'), e => e.code === 'PAYMENT_OUTCOME_UNKNOWN' &&
      e.paymentSent === true && e.operatorReservation?.request_id === 'lost');
    console.log('STEP cancel');
    const controller = new AbortController();
    const pending = call('cancel', '/cancel', { signal: controller.signal });
    const denied = assert.rejects(pending, e => e.code === 'OPERATOR_ABORTED');
    await new Promise(resolve => setTimeout(resolve, 100));
    await assert.rejects(call('busy'), e => e.code === 'OPERATOR_BUSY');
    controller.abort(); await denied;
    console.log('STEP timeout');
    const short = new OperatorApprovedBuyer({ operator: { ...operator, timeoutMs: 200 }, fetchImpl });
    await assert.rejects(call('timeout', '/timeout', {}, short), e => e.code === 'OPERATOR_TIMEOUT');
    assert.deepEqual(signatures, ['approved', 'lost']);
    assert.equal(sends.filter(x => x.signed).length, 2);
    assert.equal(sends.filter(x => x.path === '/approved').length, 3);
    assert.equal(sends.filter(x => x.path === '/lost').length, 2);
    assert.ok(sends.every(x => x.method === 'POST' && x.body === '{"city":"Zürich"}'));
    const result = { status: 'PASS', nativeModuleClosure: ['SF31', 'SF62', 'SF54', 'SF59', 'SF36'],
      scenarios: ['free', 'denied', 'fresh', 'duplicate', 'lost response', 'concurrent review', 'cancel', 'timeout'],
      fixtureSignedRequests: 2, realPayments: 0, signatures, sends };
    writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log('NATIVE_BRIDGE_PASS');
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
