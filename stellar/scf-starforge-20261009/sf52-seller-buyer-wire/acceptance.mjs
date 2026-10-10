// MIT. SF52: current original seller compiler -> actual HTTP 402 -> current buyer client.
// Negative-path integration only: no wallet, no signer, no settlement and no paid retry.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { compileHttpSellerOffer, paymentRequiredResponse } from '../sf30-seller-sdk/seller.mjs';
import { X402BuyerClient, BuyerError } from '../sf31-buyer-client/buyer.mjs';

const TERMS = Object.freeze({
  scheme: 'exact', network: 'stellar:testnet', amount: '17000',
  asset: 'UNPAYABLE_LOCAL_ASSET', payTo: 'UNPAYABLE_LOCAL_RECIPIENT',
  maxTimeoutSeconds: 60,
});
const BODY = JSON.stringify({ query: 'source-exact commerce acceptance' });

/** Exercise original exported SF30/SF31 codepaths over an actual loopback HTTP socket. */
export async function runSellerBuyerWire() {
  const captures = [];
  let activeOffer;
  const server = createServer(async (req, res) => {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 8192) {
        res.writeHead(413); res.end(); return;
      }
      chunks.push(chunk);
    }
    const signature = req.headers['payment-signature'];
    captures.push({ method: req.method, path: req.url,
      body: Buffer.concat(chunks).toString('utf8'), signed: !!signature });
    if (req.url !== '/paid' || req.method !== 'POST') {
      res.writeHead(405); res.end(); return;
    }
    if (signature) {
      // A signed request reaching this nonpayable fixture is a test failure.
      res.writeHead(403); res.end(); return;
    }
    const reply = paymentRequiredResponse(activeOffer);
    res.writeHead(reply.statusCode, reply.headers);
    res.end(reply.body);
  });
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const url = 'http://127.0.0.1:' + server.address().port + '/paid';
    const offer = compileHttpSellerOffer({
      url, method: 'POST', description: 'Original 402 buyer/seller wire acceptance',
      serviceName: 'SF52 Offline', tags: ['stellar'],
      bodyType: 'json', body: { query: 'source-exact commerce acceptance' },
      payment: TERMS,
    }, { allowLocalhost: true });
    activeOffer = offer;
    assert.equal(offer.resource.url, url);
    assert.equal(offer.extensions.bazaar.info.input.method, 'POST');
    const expectation = { scheme: 'exact', network: TERMS.network,
      asset: TERMS.asset, payTo: TERMS.payTo, maxAtomic: TERMS.amount,
      maxTimeoutSeconds: TERMS.maxTimeoutSeconds };
    const buyer = new X402BuyerClient({ allowLocal: true });
    const decisions = [];
    async function denied(label, expect, expectedCode, challenge = offer, expectedApprovals = 0) {
      activeOffer = challenge;
      let approvals = 0, signing = 0;
      const before = captures.length;
      await assert.rejects(() => buyer.call({
        url, method: 'POST', body: BODY, expect,
        approve: async intent => {
          approvals++;
          assert.equal(intent.url, url);
          assert.equal(intent.method, 'POST');
          assert.equal(intent.bodyPresent, true);
          assert.equal(intent.bodyBytes, Buffer.byteLength(BODY));
          assert.ok(Object.isFrozen(intent.acceptedTerms));
          return false; // Deliberately no spending authority in this acceptance harness.
        },
        sign: async () => { signing++; throw new Error('UNEXPECTED_SIGNING_CALLBACK'); },
      }), error => error instanceof BuyerError && error.code === expectedCode, label);
      assert.equal(approvals, expectedApprovals, label + ' approval count');
      assert.equal(signing, 0, label + ' signing count');
      assert.equal(captures.length, before + 1, label + ' HTTP request count');
      const req = captures.at(-1);
      assert.deepEqual(req, { method: 'POST', path: '/paid', body: BODY, signed: false }, label);
      decisions.push({ label, denied: expectedCode, requests: 1, approvals, signatures: 0 });
    }
    await denied('approved terms, operator refuses', expectation, 'PAYMENT_NOT_APPROVED', offer, 1);
    await denied('atomic spend cap below original seller offer',
      { ...expectation, maxAtomic: '16999' }, 'PAYMENT_TERMS_NOT_AUTHORIZED');
    await denied('buyer-authorized recipient differs from original seller',
      { ...expectation, payTo: 'NOT_THE_SELLER' }, 'PAYMENT_TERMS_NOT_AUTHORIZED');
    await denied('seller quote amount changes after expectation recorded',
      expectation, 'PAYMENT_TERMS_NOT_AUTHORIZED', {
        ...offer, accepts: [{ ...offer.accepts[0], amount: '17001' }],
      });
    await denied('seller network changes after expectation recorded',
      expectation, 'PAYMENT_TERMS_NOT_AUTHORIZED', {
        ...offer, accepts: [{ ...offer.accepts[0], network: 'stellar:pubnet' }],
      });
    await denied('merchant 402 resource URL differs from actual HTTP request',
      expectation, 'RESOURCE_MISMATCH', {
        ...offer, resource: { ...offer.resource, url: url + '/wrong' },
      });
    assert.equal(captures.filter(x => x.signed).length, 0);
    return Object.freeze({ status: 'PASS',
      origin: 'current original SF30 compileHttpSellerOffer/paymentRequiredResponse + SF31 X402BuyerClient',
      actualHttpRequests: captures.length, quoteDecisions: decisions,
      signedHttpRequests: 0, signingCallbacks: 0, amountAtomic: TERMS.amount,
      network: TERMS.network, chainTransactions: 0, sellerPayments: 0 });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  runSellerBuyerWire().then(result => console.log(JSON.stringify(result, null, 2)),
    error => { console.error(error); process.exitCode = 1; });
}
