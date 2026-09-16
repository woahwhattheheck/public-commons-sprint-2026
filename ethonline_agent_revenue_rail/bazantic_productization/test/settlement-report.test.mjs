import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipeAuthority, evaluateRecipeFlow } from '../src/recipe-contract.mjs';
import { sha256Hex } from '../src/canonical.mjs';
import { D, G, evaluatedAt, laneBReceipt, laneAReceipt, completeRuntime } from './runtime-helpers.mjs';

test('PAYMENT_REQUIRED is bound to exact HTTP 402', () => {
  const b = laneBReceipt();
  const bad = laneAReceipt('PAYMENT_REQUIRED', { httpStatus: 200 });
  const auth = createRecipeAuthority({
    evaluatedAt,
    laneB: { expectedReceiptDigest: b.receiptDigest, sourceHead: G('a'), executionEvidenceDigest: D('a') },
    laneA: { expectedReceiptDigest: bad.receiptDigest, sourceHead: G('b'), executionEvidenceDigest: D('b') },
  });
  assert.throws(() => evaluateRecipeFlow({ laneBReceipt: b, laneAReceipt: bad }, auth), /exact HTTP 402/);
});

test('matching retained HTTP 402 remains PAYMENT_REQUIRED and cannot carry a report', () => {
  const b = laneBReceipt();
  const a = laneAReceipt('PAYMENT_REQUIRED');
  const auth = createRecipeAuthority({
    evaluatedAt,
    laneB: { expectedReceiptDigest: b.receiptDigest, sourceHead: G('a'), executionEvidenceDigest: D('a') },
    laneA: { expectedReceiptDigest: a.receiptDigest, sourceHead: G('b'), executionEvidenceDigest: D('b') },
  });
  const out = evaluateRecipeFlow({ laneBReceipt: b, laneAReceipt: a }, auth);
  assert.equal(out.state, 'PAYMENT_REQUIRED');
  assert.equal(out.canUseReport, false);
});

test('self-asserted SETTLED receipt fails without exact retained Lane A binding', () => {
  const b = laneBReceipt();
  const a = laneAReceipt('SETTLED', { reportPayloadDigest: D('7') });
  const auth = createRecipeAuthority({
    evaluatedAt,
    laneB: { expectedReceiptDigest: b.receiptDigest, sourceHead: G('a'), executionEvidenceDigest: D('a') },
    laneA: { expectedReceiptDigest: D('f'), sourceHead: G('b'), executionEvidenceDigest: D('b') },
  });
  assert.throws(() => evaluateRecipeFlow({ laneBReceipt: b, laneAReceipt: a }, auth), /not the out-of-band retained receipt/);
});

test('report payload digest is recomputed and bound to Lane A service response', () => {
  const runtime = completeRuntime();
  const forged = { ...runtime.input.report, summary: 'tampered after digest' };
  assert.throws(() => evaluateRecipeFlow({ ...runtime.input, report: forged }, runtime.authority), /payloadDigest mismatch/);
});

test('fully retained Lane B + Lane A + report proof reaches USE_REPORT', () => {
  const runtime = completeRuntime();
  const out = evaluateRecipeFlow(runtime.input, runtime.authority);
  assert.equal(out.state, 'USE_REPORT');
  assert.equal(out.canUseReport, true);
  assert.equal(out.evidence.reportPayloadDigest, runtime.input.report.payloadDigest);
  assert.equal(out.evidence.serviceResponseDigest, runtime.input.laneAReceipt.serviceResponseDigest);
});

test('settled report cannot substitute another service response', () => {
  const runtime = completeRuntime();
  const reportCore = { ...runtime.input.report, serviceResponseDigest: D('d') };
  delete reportCore.payloadDigest;
  const report = { ...reportCore, payloadDigest: sha256Hex(reportCore) };
  const { receiptDigest: _oldDigest, ...laneABase } = runtime.input.laneAReceipt;
  const laneACore = { ...laneABase, reportPayloadDigest: report.payloadDigest };
  const laneAReceipt = { ...laneACore, receiptDigest: sha256Hex(laneACore) };
  const auth = createRecipeAuthority({
    evaluatedAt: runtime.authority.evaluatedAt,
    laneB: runtime.authority.laneB,
    laneA: { ...runtime.authority.laneA, expectedReceiptDigest: laneAReceipt.receiptDigest },
    report: { ...runtime.authority.report, expectedPayloadDigest: report.payloadDigest },
  });
  assert.throws(
    () => evaluateRecipeFlow({ laneBReceipt: runtime.input.laneBReceipt, laneAReceipt, report }, auth),
    /not bound to Lane A settlement/,
  );
});
