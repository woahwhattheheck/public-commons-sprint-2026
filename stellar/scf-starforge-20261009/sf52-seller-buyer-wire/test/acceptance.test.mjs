import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSellerBuyerWire } from '../acceptance.mjs';

test('original SF30 seller HTTP 402 -> original SF31 buyer refusal and quote drift', async () => {
  const result = await runSellerBuyerWire();
  assert.equal(result.status, 'PASS');
  assert.equal(result.actualHttpRequests, 6);
  assert.equal(result.quoteDecisions.length, 6);
  assert.equal(result.quoteDecisions[0].approvals, 1);
  assert.equal(result.quoteDecisions.slice(1).every(row => row.approvals === 0), true);
  assert.equal(result.signedHttpRequests, 0);
  assert.equal(result.chainTransactions, 0);
});
