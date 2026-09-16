import { sha256Hex } from './canonical.mjs';
import { B_SCHEMA, validateLaneBReceipt } from './lane-b-validation.mjs';

const MAX_BLOCK_AGE_SECONDS = 300n;
const MAX_FUTURE_SKEW_SECONDS = 60n;

function common(receipt, serviceUrl, priceAtomic, receiptDigest, binding) {
  return {
    source: 'retained-lane-b-graph-purchase-policy',
    evidenceDigest: receiptDigest,
    agentId: receipt.sellerAgentId,
    provider: receipt.serviceKey,
    serviceUrl,
    priceAtomic,
    offerDigest: receipt.offerDigest,
    policyDigest: receipt.policyDigest,
    laneBReceiptDigest: receiptDigest,
    evidenceTransport: receipt.qualification.evidenceTransport,
    declaredSourceMode: receipt.qualification.declaredSourceMode,
    authorityBindingDigest: sha256Hex(binding),
  };
}

export function adaptLaneBReceipt(receipt, { evaluatedAt, authority }) {
  const { evaluatedAtMs, serviceUrl, priceAtomic, receiptDigest, binding } = validateLaneBReceipt(receipt, evaluatedAt, authority);
  const base = common(receipt, serviceUrl, priceAtomic, receiptDigest, binding);
  if (!receipt.qualification.liveGraphEvidence || receipt.qualification.evidenceTransport !== 'live_graph' || receipt.qualification.declaredSourceMode !== 'live_graph' || receipt.qualification.fixtureOnly || receipt.metrics === null) {
    const now = new Date(evaluatedAtMs).toISOString();
    return {
      decision: 'DEFER', ...base, observedAt: now, expiresAt: now,
      reason: `Lane B ${receipt.decision}: independently retained live Graph evidence unavailable.`,
    };
  }

  const blockMs = Number(BigInt(receipt.metrics.graphBlockTimestamp) * 1000n);
  if (!Number.isSafeInteger(blockMs)) throw new TypeError('laneBReceipt Graph block timestamp is out of supported time range');
  if (blockMs > evaluatedAtMs + Number(MAX_FUTURE_SKEW_SECONDS * 1000n)) throw new TypeError('laneBReceipt Graph block is from the future');
  const expiresMs = blockMs + Number(MAX_BLOCK_AGE_SECONDS * 1000n);
  const mapped = receipt.decision === 'BUY' ? 'BUY' : receipt.decision === 'SKIP' ? 'REFUSE' : 'DEFER';
  return {
    decision: mapped, ...base,
    observedAt: new Date(blockMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    reason: `Lane B ${receipt.decision}: ${receipt.reasons.join(', ')}`,
  };
}

export const LANE_B_ADAPTER_CONSTANTS = Object.freeze({
  B_SCHEMA,
  MAX_BLOCK_AGE_SECONDS: Number(MAX_BLOCK_AGE_SECONDS),
  MAX_FUTURE_SKEW_SECONDS: Number(MAX_FUTURE_SKEW_SECONDS),
});
