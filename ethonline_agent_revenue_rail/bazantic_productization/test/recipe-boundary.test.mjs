import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipeAuthority, evaluateRecipeFlow } from '../src/recipe-contract.mjs';
import { D, G, evaluatedAt, laneBReceipt } from './runtime-helpers.mjs';

function laneBOnly(receipt = laneBReceipt(), at = evaluatedAt) {
  return {
    input: { laneBReceipt: receipt },
    authority: createRecipeAuthority({ evaluatedAt: at, laneB: { expectedReceiptDigest: receipt.receiptDigest, sourceHead: G('a'), executionEvidenceDigest: D('a') } }),
  };
}

test('serialized authority lookalike is rejected before evidence evaluation', () => {
  const runtime = laneBOnly();
  const serialized = JSON.parse(JSON.stringify(runtime.authority));
  assert.throws(() => evaluateRecipeFlow(runtime.input, serialized), /non-serializable capability/);
});

test('direct caller-authored graphPolicy path is rejected at the public boundary', () => {
  const b = laneBReceipt();
  const authority = laneBOnly(b).authority;
  assert.throws(() => evaluateRecipeFlow({ laneBReceipt: b, graphPolicy: { decision: 'BUY' } }, authority), /graphPolicy is unknown/);
});

test('self-hashed Lane B receipt cannot outrun the out-of-band retained digest', () => {
  const forged = laneBReceipt('BUY', { offerId: 'attacker-offer' });
  const trusted = laneBReceipt();
  const authority = laneBOnly(trusted).authority;
  assert.throws(() => evaluateRecipeFlow({ laneBReceipt: forged }, authority), /not the out-of-band retained receipt/);
});

test('retained current Lane B BUY advances only to Lane A acquisition', () => {
  const { input, authority } = laneBOnly();
  const out = evaluateRecipeFlow(input, authority);
  assert.equal(out.state, 'PURCHASE_NEEDED');
  assert.equal(out.canUseReport, false);
  assert.match(out.evidence.authorityBindingDigest, /^[0-9a-f]{64}$/);
});

test('host clock expires an old otherwise-valid BUY receipt', () => {
  const old = laneBReceipt('BUY', { metrics: { ...laneBReceipt().metrics, graphBlockTimestamp: '1789505940' } });
  const { input, authority } = laneBOnly(old, '2026-09-15T22:00:00.000Z');
  const out = evaluateRecipeFlow(input, authority);
  assert.equal(out.state, 'POLICY_EXPIRED');
});
