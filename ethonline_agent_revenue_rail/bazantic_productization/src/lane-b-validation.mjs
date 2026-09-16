import { sha256Hex } from './canonical.mjs';
import { normalizeAtomicInteger } from './atomic.mjs';
import { exact, normalizeHttpsUrl, parseInstant, sha, validateBinding } from './recipe-authority.mjs';
import { validateLaneBMetrics } from './lane-b-metrics.mjs';

export const B_SCHEMA = 'graph-purchase-decision/v1';

function boolFalse(value, label) {
  if (value !== false) throw new TypeError(`${label} must be false`);
}

export function validateLaneBReceipt(receipt, evaluatedAt, authority) {
  validateBinding(authority, 'laneBAuthority');
  const evaluatedAtMs = parseInstant(evaluatedAt, 'evaluatedAt');
  exact(receipt, [
    'schema', 'decision', 'reasons', 'offerId', 'sellerAgentId', 'serviceKey', 'serviceUrl',
    'currency', 'priceAtomic', 'budgetBeforeAtomic', 'budgetAfterAtomic', 'offerDigest',
    'policyDigest', 'evidenceDigest', 'metrics', 'qualification', 'authority', 'receiptDigest',
  ], [], 'laneBReceipt');
  if (receipt.schema !== B_SCHEMA) throw new TypeError(`laneBReceipt.schema must be ${B_SCHEMA}`);
  if (!['BUY', 'SKIP', 'HOLD'].includes(receipt.decision)) throw new TypeError('laneBReceipt.decision is invalid');
  if (!Array.isArray(receipt.reasons) || receipt.reasons.some((entry) => typeof entry !== 'string' || !entry)) throw new TypeError('laneBReceipt.reasons must be non-empty strings');
  const serviceUrl = normalizeHttpsUrl(receipt.serviceUrl, 'laneBReceipt.serviceUrl');
  for (const [key, value] of Object.entries({ offerDigest: receipt.offerDigest, policyDigest: receipt.policyDigest, receiptDigest: receipt.receiptDigest })) sha(value, `laneBReceipt.${key}`);
  if (receipt.evidenceDigest !== null) sha(receipt.evidenceDigest, 'laneBReceipt.evidenceDigest');
  const priceAtomic = normalizeAtomicInteger(receipt.priceAtomic, 'laneBReceipt.priceAtomic');
  normalizeAtomicInteger(receipt.budgetBeforeAtomic, 'laneBReceipt.budgetBeforeAtomic');
  normalizeAtomicInteger(receipt.budgetAfterAtomic, 'laneBReceipt.budgetAfterAtomic');

  exact(receipt.qualification, ['evidenceTransport', 'declaredSourceMode', 'liveGraphEvidence', 'fixtureOnly', 'prizeEligibilityClaimed'], [], 'laneBReceipt.qualification');
  if (!['live_graph', 'fixture', 'untrusted'].includes(receipt.qualification.evidenceTransport)) throw new TypeError('laneBReceipt.qualification.evidenceTransport is invalid');
  if (![null, 'live_graph', 'fixture'].includes(receipt.qualification.declaredSourceMode)) throw new TypeError('laneBReceipt.qualification.declaredSourceMode is invalid');
  if (typeof receipt.qualification.liveGraphEvidence !== 'boolean' || typeof receipt.qualification.fixtureOnly !== 'boolean') throw new TypeError('laneBReceipt qualification booleans are invalid');
  boolFalse(receipt.qualification.prizeEligibilityClaimed, 'laneBReceipt.qualification.prizeEligibilityClaimed');
  const expectedLive = receipt.qualification.evidenceTransport === 'live_graph' && receipt.qualification.declaredSourceMode === 'live_graph';
  if (receipt.qualification.liveGraphEvidence !== expectedLive) throw new TypeError('laneBReceipt qualification live provenance is inconsistent');
  if (receipt.qualification.fixtureOnly !== (receipt.qualification.evidenceTransport === 'fixture')) throw new TypeError('laneBReceipt qualification fixture provenance is inconsistent');
  exact(receipt.authority, ['payment', 'walletWrite', 'providerMutation', 'submission'], [], 'laneBReceipt.authority');
  for (const key of ['payment', 'walletWrite', 'providerMutation', 'submission']) boolFalse(receipt.authority[key], `laneBReceipt.authority.${key}`);

  const { receiptDigest, ...core } = receipt;
  if (sha256Hex(core) !== receiptDigest) throw new TypeError('laneBReceipt.receiptDigest mismatch');
  if (receiptDigest !== authority.expectedReceiptDigest) throw new TypeError('laneBReceipt is not the out-of-band retained receipt');
  if (receipt.metrics !== null) validateLaneBMetrics(receipt.metrics, serviceUrl);
  const binding = {
    expectedReceiptDigest: authority.expectedReceiptDigest,
    sourceHead: authority.sourceHead,
    executionEvidenceDigest: authority.executionEvidenceDigest,
  };
  return { evaluatedAtMs, serviceUrl, priceAtomic, receiptDigest, binding };
}
