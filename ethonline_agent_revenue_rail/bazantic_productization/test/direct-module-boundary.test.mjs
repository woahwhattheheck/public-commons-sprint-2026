import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipeAuthority, evaluateRecipeFlow } from '../src/recipe-contract.mjs';
import { D, G, evaluatedAt, laneBReceipt } from './runtime-helpers.mjs';

test('split purchase evaluator is not a directly importable authority path', async () => {
  await assert.rejects(
    import('../src/recipe-purchase-flow.mjs'),
    (error) => error?.code === 'ERR_MODULE_NOT_FOUND',
  );
});

test('report bytes without an independently retained Lane A receipt fail closed', () => {
  const receipt = laneBReceipt();
  const authority = createRecipeAuthority({
    evaluatedAt,
    laneB: {
      expectedReceiptDigest: receipt.receiptDigest,
      sourceHead: G('a'),
      executionEvidenceDigest: D('a'),
    },
  });
  const outcome = evaluateRecipeFlow({
    laneBReceipt: receipt,
    report: {
      schema: 'agent-revenue-rail/report-payload/v1',
      callerAuthored: true,
    },
  }, authority);
  assert.equal(outcome.state, 'GATE_VIOLATION');
  assert.equal(outcome.nextAction, 'STOP');
  assert.equal(outcome.canUseReport, false);
});
