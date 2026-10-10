// MIT. Actual original SF31 HTTP transport -> actual SF36 Python policy validation.
// Local 402 only. No approval, signing, payment, wallet, third-party endpoint or Actions.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { X402BuyerClient, BuyerError } from '../../sf31-buyer-client/buyer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const adapter = join(here, '..', 'intent_adapter.py');
const merchant = 'https://merchant.example/paid';
const asset = 'C' + 'A'.repeat(55); // Unissued schema-valid fixture, NOT a live asset.
const payTo = 'G' + 'A'.repeat(55); // Schema-only fixture, no wallet/address claim.
const accept = {
  scheme: 'exact', network: 'stellar:testnet', amount: '42', asset, payTo,
  maxTimeoutSeconds: 60,
  extra: { intent: { id: 'merchant-v1', route: '/paid' }, paymentFlow: 'authorization' },
};
const utf8sha = body => createHash('sha256').update(body).digest('hex');
function adapterRequest(intent, { expectDenied = false } = {}) {
  const process = spawnSync('python3', [adapter, '--actor', 'agent-01', '--service', 'merchant-service'], {
    input: JSON.stringify(intent), encoding: 'utf8', timeout: 10_000, maxBuffer: 128 * 1024,
  });
  assert.ifError(process.error);
  if (expectDenied) {
    assert.equal(process.status, 2, 'invalid intent must fail: ' + process.stdout);
    assert.match(process.stderr, /DENIED:/);
    return null;
  }
  assert.equal(process.status, 0, process.stderr);
  const result = JSON.parse(process.stdout);
  assert.equal(result.schema, 'stellar-forge.sf54.governor-request.v1');
  return result.request;
}

test('source-exact SF31 approval intent maps to original SF36, without payment or signer', async () => {
  let unsigned = 0, signed = 0;
  const server = createServer(async (req, res) => {
    if (req.headers['payment-signature']) { signed++; res.writeHead(403); res.end(); return; }
    unsigned++;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/paid');
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    assert.equal(body, '{"query":"source exact"}');
    const challenge = { x402Version: 2, resource: { url: merchant }, accepts: [accept] };
    res.writeHead(402, {
      'payment-required': Buffer.from(JSON.stringify(challenge)).toString('base64'),
      'content-type': 'application/json',
    });
    res.end('{"paymentRequired":true}');
  });
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const loopback = 'http://127.0.0.1:' + server.address().port + '/paid';
    // Only the fixture's network transport is redirected to loopback. The
    // production buyer *still* inspects the exact HTTPS merchant URL/402.
    const buyer = new X402BuyerClient({ fetchImpl: async (url, options) => {
      assert.equal(url.href, merchant);
      return fetch(loopback, options);
    }});
    let captured, signedByOperator = 0;
    await assert.rejects(() => buyer.call({
      url: merchant, method: 'POST', body: '{"query":"source exact"}',
      expect: { scheme: 'exact', network: accept.network, asset, payTo,
        maxAtomic: '100', maxTimeoutSeconds: 60 },
      approve: async intent => {
        captured = structuredClone(intent);
        assert.ok(Object.isFrozen(intent));
        assert.ok(Object.isFrozen(intent.acceptedTerms.extra.intent));
        const request = adapterRequest(captured);
        assert.deepEqual(Object.keys(request).sort(), [
          'accepted_terms_sha256', 'actor', 'asset', 'body_bytes', 'body_present',
          'body_sha256', 'max_amount', 'max_timeout_seconds', 'method', 'network',
          'pay_to', 'request_id', 'resource', 'scheme', 'service',
        ].sort());
        assert.equal(request.resource, merchant);
        assert.equal(request.max_amount, '42'); // NOT caller's higher 100 cap.
        assert.equal(request.body_bytes, Buffer.byteLength('{"query":"source exact"}'));
        assert.equal(request.body_sha256, utf8sha('{"query":"source exact"}'));
        assert.equal(request.pay_to, payTo);
        return false; // No spending authority in this regression.
      },
      sign: async () => { signedByOperator++; throw Error('unreachable'); },
    }), error => error instanceof BuyerError && error.code === 'PAYMENT_NOT_APPROVED');
    assert.equal(unsigned, 1);
    assert.equal(signed, 0);
    assert.equal(signedByOperator, 0);
    assert.ok(captured);

    // Mirror drift cannot quietly authorize a different recipient.
    adapterRequest({ ...captured, payTo: 'NOT_THE_QUOTED_RECIPIENT' }, { expectDenied: true });
    // Full accepted terms (including nested "extra") affect the exact consent hash.
    const mutated = structuredClone(captured);
    mutated.acceptedTerms.extra.intent.route = '/other';
    assert.notEqual(adapterRequest(mutated).accepted_terms_sha256,
      adapterRequest(captured).accepted_terms_sha256);
    // A higher quote even with matching visible mirror cannot escape the bound cap.
    const overCap = structuredClone(captured);
    overCap.amount = overCap.acceptedTerms.amount = '101';
    adapterRequest(overCap, { expectDenied: true });
    const missingField = structuredClone(captured); delete missingField.bodySha256;
    adapterRequest(missingField, { expectDenied: true });
    const extraField = { ...captured, unauthorized: true };
    adapterRequest(extraField, { expectDenied: true });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
