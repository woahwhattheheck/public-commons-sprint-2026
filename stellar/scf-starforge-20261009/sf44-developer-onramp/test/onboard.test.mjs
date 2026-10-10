// MIT. Focused runtime check against the actual PR451 BazaarCatalog.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runLocalOnboarding, startLocalDevelopmentCatalog, inspectLocalDiscovery, sourceProvenance
} from '../onboard.mjs';

test('SF44 onboarding exercises original discovery HTTP and never buys', async () => {
  const result = await runLocalOnboarding();
  assert.equal(Number(process.versions.node.split('.')[0]) >= 22, true);
  assert.deepEqual(result.status, [200, 200]);
  assert.equal(result.listCount, 1);
  assert.equal(result.searchCount, 1);
  assert.equal(result.candidates[0].routeType, 'http');
  assert.equal(result.candidates[0].matchingPaymentTerms[0].network, 'stellar:testnet');
  assert.equal(result.candidates[0].disposition, 'REQUIRES_SEPARATE_SELLER_PROOF_AND_WALLET_AUTHORIZATION');
  assert.equal(result.buyerAutoPayment, false);
  assert.equal(result.settlementReceipt, null);
  assert.equal(result.elapsedMsToFirstPaidEndpoint, null);
  assert.equal(result.source.baselineMatches, true, 'PR451 upstream catalog source changed');
});

test('source-bound HTTP and network gates decline unauthorized operations', async () => {
  const service = await startLocalDevelopmentCatalog();
  try {
    const pubnet = await inspectLocalDiscovery(service.baseUrl, { network: 'stellar:pubnet' });
    assert.equal(pubnet.listCount, 0);
    assert.equal(pubnet.searchCount, 0);
    await assert.rejects(inspectLocalDiscovery('http://example.org:80/'), TypeError);
    const post = await fetch(service.baseUrl + '/discovery/resources', { method: 'POST' });
    assert.equal(post.status, 405);
    const missing = await fetch(service.baseUrl + '/discovery/search');
    assert.equal(missing.status, 400);
    assert.equal((await sourceProvenance()).baselineMatches, true);
  } finally { await service.close(); }
});
