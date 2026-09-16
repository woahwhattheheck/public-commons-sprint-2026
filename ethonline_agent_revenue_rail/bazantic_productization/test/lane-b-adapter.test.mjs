import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptLaneBReceipt } from '../src/lane-b-adapter.mjs';
import { D, G, evaluatedAt, laneBReceipt } from './runtime-helpers.mjs';

function authority(receipt) {
  return { expectedReceiptDigest: receipt.receiptDigest, sourceHead: G('a'), executionEvidenceDigest: D('a') };
}

test('current merged Lane B schema crosses B→C with exact service/provenance fields', () => {
  const receipt = laneBReceipt();
  const out = adaptLaneBReceipt(receipt, { evaluatedAt, authority: authority(receipt) });
  assert.equal(out.decision, 'BUY');
  assert.equal(out.serviceUrl, 'https://rail.example.test/report');
  assert.equal(out.priceAtomic, '2500000');
});

test('fixture provenance can never become BUY', () => {
  const receipt = laneBReceipt('BUY', {
    metrics: null,
    qualification: { evidenceTransport: 'fixture', declaredSourceMode: 'fixture', liveGraphEvidence: false, fixtureOnly: true, prizeEligibilityClaimed: false },
  });
  const out = adaptLaneBReceipt(receipt, { evaluatedAt, authority: authority(receipt) });
  assert.equal(out.decision, 'DEFER');
});

test('forged live flag cannot outrun provenance consistency', () => {
  const receipt = laneBReceipt('BUY', {
    qualification: { evidenceTransport: 'fixture', declaredSourceMode: 'live_graph', liveGraphEvidence: true, fixtureOnly: true, prizeEligibilityClaimed: false },
  });
  assert.throws(() => adaptLaneBReceipt(receipt, { evaluatedAt, authority: authority(receipt) }), /live provenance is inconsistent/);
});

test('service origin remains bound to exact service URL', () => {
  const receipt = laneBReceipt('BUY', { metrics: { ...laneBReceipt().metrics, serviceOrigin: 'https://wrong.example.test' } });
  assert.throws(() => adaptLaneBReceipt(receipt, { evaluatedAt, authority: authority(receipt) }), /serviceOrigin/);
});
