import { canonicalJson } from './canonical.mjs';
import { adaptLaneBReceipt } from './lane-b-adapter.mjs';
import { createRecipeAuthority, exact, parseInstant, validateAuthority } from './recipe-authority.mjs';
import { HBAR_TOKEN_ID, HEDERA_TESTNET, LANE_A_SCHEMA } from './lane-a-receipt.mjs';
import { REPORT_SCHEMA } from './report-adapter.mjs';
import { buildOutcome, RECIPE_OUTCOME_VERSION } from './recipe-outcome.mjs';
import { evaluatePurchaseFlow } from './recipe-purchase-flow.mjs';

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
