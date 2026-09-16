import { validateLaneAReceipt } from './lane-a-receipt.mjs';
import { validateReportPayload } from './report-adapter.mjs';
import { buildOutcome } from './recipe-outcome.mjs';

export function evaluatePurchaseFlow({ input, authority, graphPolicy, evaluatedAtMs, authorityBindingDigest }) {
  if (input.laneAReceipt === undefined) {
    return buildOutcome({
      state: 'PURCHASE_NEEDED', nextAction: 'CALL_X402_REPORT_SERVICE',
      reason: 'Retained Lane B policy is BUY; obtain an independently retained Lane A receipt.',
      graphPolicy, authorityBindingDigest,
    });
  }
  if (authority.laneA === undefined) throw new TypeError('authority.laneA is required when laneAReceipt is supplied');
  const laneA = validateLaneAReceipt(input.laneAReceipt, authority.laneA);
  if (laneA.serviceUrl !== graphPolicy.serviceUrl) throw new TypeError('laneAReceipt.serviceUrl does not match retained Lane B serviceUrl');
  if (laneA.amountTinybar !== graphPolicy.priceAtomic) throw new TypeError('laneAReceipt.amountTinybar does not match retained Lane B priceAtomic');

  if (input.laneAReceipt.state === 'PAYMENT_REQUIRED') {
    if (input.report !== undefined) return buildOutcome({
      state: 'GATE_VIOLATION', nextAction: 'STOP', reason: 'Report bytes cannot accompany PAYMENT_REQUIRED.',
      graphPolicy, purchase: input.laneAReceipt, authorityBindingDigest,
    });
    return buildOutcome({
      state: 'PAYMENT_REQUIRED', nextAction: 'SATISFY_X402_REQUIREMENT',
      reason: input.laneAReceipt.reason || 'Lane A retained exact HTTP 402 payment requirement.',
      graphPolicy, purchase: input.laneAReceipt, authorityBindingDigest,
    });
  }
  if (input.laneAReceipt.state === 'FAILED') {
    if (input.report !== undefined) return buildOutcome({
      state: 'GATE_VIOLATION', nextAction: 'STOP', reason: 'Report bytes cannot accompany a failed Lane A receipt.',
      graphPolicy, purchase: input.laneAReceipt, authorityBindingDigest,
    });
    return buildOutcome({
      state: 'PURCHASE_FAILED', nextAction: 'STOP_OR_RETRY_PER_UPSTREAM',
      reason: input.laneAReceipt.reason,
      graphPolicy, purchase: input.laneAReceipt, authorityBindingDigest,
    });
  }

  if (input.report === undefined) return buildOutcome({
    state: 'REPORT_MISSING', nextAction: 'FETCH_RETAINED_REPORT_RESULT',
    reason: 'Lane A settlement is independently retained, but no provider-bound report payload was supplied.',
    graphPolicy, purchase: input.laneAReceipt, authorityBindingDigest,
  });
  if (authority.report === undefined) throw new TypeError('authority.report is required when report is supplied');
  validateReportPayload(input.report, authority.report, input.laneAReceipt, evaluatedAtMs);
  return buildOutcome({
    state: 'USE_REPORT', nextAction: `REPORT_${input.report.recommendation.action}`,
    reason: input.report.recommendation.rationale,
    graphPolicy, purchase: input.laneAReceipt, report: input.report, authorityBindingDigest,
  });
}
