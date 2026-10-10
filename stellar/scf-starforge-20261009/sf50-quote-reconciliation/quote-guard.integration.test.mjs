// MIT. Source-coupled focused check against the actual PR451 Bazaar catalog and handler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BazaarCatalog, createDiscoveryServer } from '../../../scf46-stellar-bazaar/src/catalog.mjs';
import { reconcileHttpQuote } from './quote-guard.mjs';

test('real catalog HTTP discovery -> resource HTTP 402 -> payee/amount integrity gate', async () => {
  const catalog = new BazaarCatalog();
  let amount = '15000';
  let origin;
  const handler = createDiscoveryServer(catalog);
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/discovery/')) return handler(req, res);
    if (req.url !== '/premium' || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
    const required = {
      x402Version: 2, resource: { url: origin + '/premium' },
      accepts: [{ scheme: 'exact', network: 'stellar:testnet', amount,
        asset: 'USDC-ISSUER-TEST', payTo: 'G-SELLER-TEST', maxTimeoutSeconds: 60 }],
      extensions: { bazaar: { info: { input: { type: 'http', method: 'GET' } }, schema: { type: 'object' } } }
    };
    res.writeHead(402, { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(required)).toString('base64') });
    res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    origin = 'http://127.0.0.1:' + server.address().port;
    catalog.insertValidated({ resource: { url: origin + '/premium' },
      accepts: [{ scheme: 'exact', network: 'stellar:testnet', amount,
        asset: 'USDC-ISSUER-TEST', payTo: 'G-SELLER-TEST', maxTimeoutSeconds: 60 }],
      extensions: { bazaar: { info: { input: { type: 'http', method: 'GET' } }, schema: { type: 'object' } } }
    });
    const listed = await fetch(origin + '/discovery/resources');
    assert.equal(listed.status, 200);
    const item = (await listed.json()).resources[0];
    const policy = { catalogEntry: item, requestUrl: origin + '/premium',
      method:'GET', selection: { scheme:'exact',network:'stellar:testnet',asset:'USDC-ISSUER-TEST',payTo:'G-SELLER-TEST' },
      maxAtomicUnits: '20000', allowLocalHttp: true };
    const ok = reconcileHttpQuote({ ...policy, response: await fetch(policy.requestUrl, { redirect: 'error' }) });
    assert.equal(ok.decision, 'allow');
    amount = '25000';
    const priceDrift = reconcileHttpQuote({ ...policy, response: await fetch(policy.requestUrl, { redirect: 'error' }) });
    assert.equal(priceDrift.reason, 'PAYMENT_TERMS_DRIFT');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
