import { sha256Hex } from './canonical.mjs';

export const RECIPE_OUTCOME_VERSION = 'agent-revenue-rail/bazantic-recipe-outcome/v2';

export function buildOutcome({ state, nextAction, reason, graphPolicy, authorityBindingDigest, purchase = null, report = null }) {
  const evidence = {
    authorityBindingDigest,
    laneBReceiptDigest: graphPolicy.laneBReceiptDigest,
    graphPolicyDigest: sha256Hex(graphPolicy),
    graphDecision: graphPolicy.decision,
    boundServiceUrl: graphPolicy.serviceUrl,
    purchaseReceiptDigest: purchase?.receiptDigest ?? null,
    purchaseState: purchase?.state ?? null,
    settlementTxHash: purchase?.state === 'SETTLED' ? purchase.txHash : null,
    serviceResponseDigest: purchase?.serviceResponseDigest ?? null,
    reportPayloadDigest: report?.payloadDigest ?? null,
  };
  const core = {
    version: RECIPE_OUTCOME_VERSION,
    state,
    nextAction,
    reason,
    canUseReport: state === 'USE_REPORT',
    evidence,
  };
  return { ...core, outcomeDigest: sha256Hex(core) };
}
