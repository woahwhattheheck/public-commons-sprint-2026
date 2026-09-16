import { canonicalJson } from './canonical.mjs';
import { adaptLaneBReceipt } from './lane-b-adapter.mjs';
import { createRecipeAuthority, exact, parseInstant, validateAuthority } from './recipe-authority.mjs';
import { HBAR_TOKEN_ID, HEDERA_TESTNET, LANE_A_SCHEMA, validateLaneAReceipt } from './lane-a-receipt.mjs';
import { REPORT_SCHEMA, validateReportPayload } from './report-adapter.mjs';
import { buildOutcome, RECIPE_OUTCOME_VERSION } from './recipe-outcome.mjs';

function evaluatePurchaseFlow({ input, authority, graphPolicy, evaluatedAtMs, authorityBindingDigest }) {
  if (input.laneAReceipt === undefined) {
    if (input.report !== undefined) {
      return buildOutcome({
        state: 'GATE_VIOLATION', nextAction: 'STOP',
        reason: 'Report bytes cannot be supplied before an independently retained Lane A receipt.',
        graphPolicy, authorityBindingDigest,
      });
    }
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

export function evaluateRecipeFlow(input, authority) {
  exact(input, ['laneBReceipt'], ['laneAReceipt', 'report'], 'input');
  const { evaluatedAtMs, authorityBindingDigest } = validateAuthority(authority);
  const graphPolicy = adaptLaneBReceipt(input.laneBReceipt, {
    evaluatedAt: authority.evaluatedAt,
    authority: authority.laneB,
  });
  const expiresMs = parseInstant(graphPolicy.expiresAt, 'graphPolicy.expiresAt');

  if (evaluatedAtMs > expiresMs) {
    return buildOutcome({
      state: 'POLICY_EXPIRED', nextAction: 'REFRESH_GRAPH_POLICY',
      reason: 'Retained Graph purchase policy expired under the host evaluation clock; downstream evidence is ignored.',
      graphPolicy, authorityBindingDigest,
    });
  }

  if (graphPolicy.decision === 'REFUSE' || graphPolicy.decision === 'DEFER') {
    if (input.laneAReceipt !== undefined || input.report !== undefined) {
      return buildOutcome({
        state: 'GATE_VIOLATION', nextAction: 'STOP',
        reason: `Lane A/report evidence was supplied despite retained Lane B decision ${graphPolicy.decision}.`,
        graphPolicy, authorityBindingDigest,
      });
    }
    return buildOutcome({
      state: graphPolicy.decision === 'REFUSE' ? 'SKIP_PURCHASE' : 'DEFER_PURCHASE',
      nextAction: graphPolicy.decision === 'REFUSE' ? 'STOP' : 'RETRY_GRAPH_LATER',
      reason: graphPolicy.reason,
      graphPolicy, authorityBindingDigest,
    });
  }

  return evaluatePurchaseFlow({ input, authority, graphPolicy, evaluatedAtMs, authorityBindingDigest });
}

export { createRecipeAuthority };
export const recipeOutcomeJson = (input, authority) => canonicalJson(evaluateRecipeFlow(input, authority));
export const CONTRACT_CONSTANTS = Object.freeze({
  VERSION: RECIPE_OUTCOME_VERSION,
  LANE_A_SCHEMA,
  REPORT_SCHEMA,
  HEDERA_TESTNET,
  HBAR_TOKEN_ID,
});
