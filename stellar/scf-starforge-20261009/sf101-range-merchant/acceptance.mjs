// MIT. One focused original-source acceptance: HTTP 402 seller + real loopback
// application transport. No paid payment, wallet, Range key, or external request.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { readSellerConfig, startSellerService } from '../sf30-seller-sdk/serve.mjs';
import { createRangeStellarHandler, admitRangeStellar, isStellarAccount } from './range.mjs';

const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const path = '/range/stellar/address-transactions';
const requestUrl = `http://127.0.0.1:8423${path}?address=${G}&page=2&limit=3`;
const application = (url, method = 'GET') => ({ url:new URL(url),method,headers:{},query:{},pathParams:{},body:null });

export async function main(configPath = process.argv[2]) {
  if (!configPath) throw new TypeError('Usage: node acceptance.mjs PRIVATE_DIR/seller.json');
  assert.equal(isStellarAccount(G), true);
  assert.equal(isStellarAccount(G.slice(0, -1) + 'A'), false);
  assert.equal(admitRangeStellar(application(requestUrl)), true);
  for (const extra of ['&network=ethereum', '&limit=101', '&page=0', '&address=' + G]) {
    assert.equal(admitRangeStellar(application(requestUrl + extra)).status, 400);
  }

  const config = await readSellerConfig(resolve(configPath));
  const { rangeStellarTransactions, admitRangeStellar: admission } = await import('./handlers.mjs');
  const seller = await startSellerService({ config, port:0, handlers:{rangeStellarTransactions,admitRangeStellar:admission} });
  let original402;
  try {
    const [health, offers] = await Promise.all([
      fetch(seller.url + '/_seller/health'), fetch(seller.url + '/_seller/offers'),
    ]);
    assert.equal(health.status, 200); assert.equal((await health.json()).mode, 'CHALLENGE_ONLY');
    assert.equal(offers.status, 200);
    const offer = (await offers.json())[0];
    assert.equal(offer.accepts[0].network, config.routes[0].definition.payment.network);
    const unpaid = await fetch(seller.url + path + '?address=' + G + '&page=2&limit=3');
    original402 = unpaid.status;
    assert.equal(unpaid.status, 402);
    assert.equal(JSON.parse(await unpaid.text()).x402Version, 2);
    assert.ok(unpaid.headers.get('payment-required'));
  } finally { await seller.close(); }

  const received = [];
  const server = createServer((req, res) => {
    received.push({ method:req.method, path:req.url, authorization:req.headers.authorization });
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ data:[], meta:{ page:2, limit:3, total:0 } }));
  });
  await new Promise((ok, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ok); });
  try {
    const backend = createRangeStellarHandler({
      baseUrl:`http://127.0.0.1:${server.address().port}`, allowLocal:true,
      credential:()=>'Bearer isolated-local-credential',
    });
    const paidApplicationResult = await backend(application(requestUrl));
    assert.equal(paidApplicationResult.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0].method, 'GET');
    assert.equal(received[0].authorization, 'Bearer isolated-local-credential');
    assert.equal(new URL(received[0].path, 'http://localhost').pathname, '/v1/address/transactions');
    const forwarded = new URL(received[0].path, 'http://localhost').searchParams;
    assert.equal(forwarded.get('network'), 'stellar');
    assert.equal(forwarded.get('address'), G);
    assert.equal(forwarded.get('page'), '2');
    assert.equal(forwarded.get('limit'), '3');
    const bad = await backend(application(requestUrl + '&network=ethereum'));
    assert.equal(bad.status, 400); assert.equal(received.length, 1);
    process.stdout.write(JSON.stringify({ status:'PASS', originalSeller402:original402,
      nativeSellerMode:'CHALLENGE_ONLY', upstreamRequests:received.length,
      backendHost:'127.0.0.1', effectiveBackendNetwork:'stellar',
      paidSettlementAttempted:false, externalProviderRequests:0 }) + '\n');
  } finally { await new Promise((ok, reject) => server.close(e => e ? reject(e) : ok())); }
}
if (process.argv[1] && process.argv[1].endsWith('/acceptance.mjs')) {
  main().catch(e=>{ process.stderr.write(e.stack + '\n');process.exitCode=1; });
}
