import { isSha256Hex, sha256Hex } from './canonical.mjs';
import { normalizeAtomicInteger } from './atomic.mjs';

const B_SCHEMA = 'graph-purchase-decision/v1';
const MAX_BLOCK_AGE_SECONDS = 300n;
const MAX_FUTURE_SKEW_SECONDS = 60n;

function exact(value, required, optional = [], label = 'object') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) throw new TypeError(`${label}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label}.${key} is unknown`);
}
function instant(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new TypeError(`${label} must be canonical UTC milliseconds`);
  const ms=Date.parse(value); if (!Number.isFinite(ms) || new Date(ms).toISOString()!==value) throw new TypeError(`${label} is invalid`); return ms;
}
function sha(value,label){if(!isSha256Hex(value)) throw new TypeError(`${label} must be sha256 hex`);}
function boolFalse(value,label){if(value!==false) throw new TypeError(`${label} must be false`);}
function httpsUrl(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${label} must be an absolute URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname) throw new TypeError(`${label} must be credential-free https`);
  return url.toString();
}
function safeCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
}
function scoreString(value, label) {
  if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) throw new TypeError(`${label} must be a fixed two-decimal score string`);
}
function validateMetrics(metrics, serviceUrl) {
  exact(metrics, ['feedbackCount','averageFeedbackScore','paidFeedbackCount','completedValidationCount','averageCompletedValidationScore','supportedTrustModels','serviceOrigin','matchedEndpointKinds','graphBlockNumber','graphBlockTimestamp'], [], 'laneBReceipt.metrics');
  for (const key of ['feedbackCount','paidFeedbackCount','completedValidationCount']) safeCount(metrics[key], `laneBReceipt.metrics.${key}`);
  for (const key of ['averageFeedbackScore','averageCompletedValidationScore']) scoreString(metrics[key], `laneBReceipt.metrics.${key}`);
  if (!Array.isArray(metrics.supportedTrustModels) || metrics.supportedTrustModels.some((x)=>typeof x!=='string' || !x)) throw new TypeError('laneBReceipt.metrics.supportedTrustModels must be string[]');
  if (!Array.isArray(metrics.matchedEndpointKinds) || metrics.matchedEndpointKinds.some((x)=>!['web','mcp','a2a'].includes(x))) throw new TypeError('laneBReceipt.metrics.matchedEndpointKinds is invalid');
  normalizeAtomicInteger(metrics.graphBlockNumber,'laneBReceipt.metrics.graphBlockNumber');
  normalizeAtomicInteger(metrics.graphBlockTimestamp,'laneBReceipt.metrics.graphBlockTimestamp');
  const expectedOrigin = new URL(serviceUrl).origin;
  if (metrics.serviceOrigin !== expectedOrigin) throw new TypeError('laneBReceipt.metrics.serviceOrigin does not match serviceUrl');
}

export function adaptLaneBReceipt(receipt, { now }) {
  exact(receipt, ['schema','decision','reasons','offerId','sellerAgentId','serviceKey','serviceUrl','currency','priceAtomic','budgetBeforeAtomic','budgetAfterAtomic','offerDigest','policyDigest','evidenceDigest','metrics','qualification','authority','receiptDigest'], [], 'laneBReceipt');
  if (receipt.schema !== B_SCHEMA) throw new TypeError(`laneBReceipt.schema must be ${B_SCHEMA}`);
  if (!['BUY','SKIP','HOLD'].includes(receipt.decision)) throw new TypeError('laneBReceipt.decision is invalid');
  if (!Array.isArray(receipt.reasons) || receipt.reasons.some((x)=>typeof x!=='string' || !x)) throw new TypeError('laneBReceipt.reasons must be non-empty strings');
  const serviceUrl = httpsUrl(receipt.serviceUrl, 'laneBReceipt.serviceUrl');
  for (const [key,value] of Object.entries({offerDigest:receipt.offerDigest,policyDigest:receipt.policyDigest,receiptDigest:receipt.receiptDigest})) sha(value,`laneBReceipt.${key}`);
  if (receipt.evidenceDigest !== null) sha(receipt.evidenceDigest,'laneBReceipt.evidenceDigest');
  const priceAtomic=normalizeAtomicInteger(receipt.priceAtomic,'laneBReceipt.priceAtomic');
  normalizeAtomicInteger(receipt.budgetBeforeAtomic,'laneBReceipt.budgetBeforeAtomic');
  normalizeAtomicInteger(receipt.budgetAfterAtomic,'laneBReceipt.budgetAfterAtomic');

  exact(receipt.qualification, ['evidenceTransport','declaredSourceMode','liveGraphEvidence','fixtureOnly','prizeEligibilityClaimed'], [], 'laneBReceipt.qualification');
  if (!['live_graph','fixture','untrusted'].includes(receipt.qualification.evidenceTransport)) throw new TypeError('laneBReceipt.qualification.evidenceTransport is invalid');
  if (![null,'live_graph','fixture'].includes(receipt.qualification.declaredSourceMode)) throw new TypeError('laneBReceipt.qualification.declaredSourceMode is invalid');
  if (typeof receipt.qualification.liveGraphEvidence!=='boolean' || typeof receipt.qualification.fixtureOnly!=='boolean') throw new TypeError('laneBReceipt qualification booleans are invalid');
  boolFalse(receipt.qualification.prizeEligibilityClaimed,'laneBReceipt.qualification.prizeEligibilityClaimed');
  const expectedLive = receipt.qualification.evidenceTransport === 'live_graph' && receipt.qualification.declaredSourceMode === 'live_graph';
  if (receipt.qualification.liveGraphEvidence !== expectedLive) throw new TypeError('laneBReceipt qualification live provenance is inconsistent');
  if (receipt.qualification.fixtureOnly !== (receipt.qualification.evidenceTransport === 'fixture')) throw new TypeError('laneBReceipt qualification fixture provenance is inconsistent');
  exact(receipt.authority, ['payment','walletWrite','providerMutation','submission'], [], 'laneBReceipt.authority');
  for (const key of ['payment','walletWrite','providerMutation','submission']) boolFalse(receipt.authority[key],`laneBReceipt.authority.${key}`);

  const { receiptDigest, ...core } = receipt;
  if (sha256Hex(core) !== receiptDigest) throw new TypeError('laneBReceipt.receiptDigest mismatch');
  const nowMs=instant(now,'now');

  if (receipt.metrics !== null) validateMetrics(receipt.metrics, serviceUrl);

  // Non-live/invalid Graph evidence can never be upgraded to a purchase path by Lane C.
  if (!receipt.qualification.liveGraphEvidence || receipt.qualification.evidenceTransport !== 'live_graph' || receipt.qualification.declaredSourceMode !== 'live_graph' || receipt.qualification.fixtureOnly || receipt.metrics === null) {
    return {
      decision:'DEFER', source:'lane-b-graph-purchase-policy', observedAt:new Date(nowMs).toISOString(), expiresAt:new Date(nowMs).toISOString(),
      evidenceDigest:receiptDigest, reason:`Lane B ${receipt.decision}: live Graph evidence unavailable.`, agentId:receipt.sellerAgentId,
      provider:receipt.serviceKey, serviceUrl, priceAtomic, offerDigest:receipt.offerDigest, policyDigest:receipt.policyDigest, laneBReceiptDigest:receiptDigest,
      evidenceTransport:receipt.qualification.evidenceTransport, declaredSourceMode:receipt.qualification.declaredSourceMode,
    };
  }

  const blockMs=Number(BigInt(receipt.metrics.graphBlockTimestamp)*1000n);
  if (!Number.isSafeInteger(blockMs)) throw new TypeError('laneBReceipt Graph block timestamp is out of supported time range');
  if (blockMs > nowMs + Number(MAX_FUTURE_SKEW_SECONDS*1000n)) throw new TypeError('laneBReceipt Graph block is from the future');
  const expiresMs=blockMs + Number(MAX_BLOCK_AGE_SECONDS*1000n);
  const mapped = receipt.decision === 'BUY' ? 'BUY' : receipt.decision === 'SKIP' ? 'REFUSE' : 'DEFER';
  return {
    decision:mapped,
    source:'lane-b-graph-purchase-policy',
    observedAt:new Date(blockMs).toISOString(),
    expiresAt:new Date(expiresMs).toISOString(),
    evidenceDigest:receiptDigest,
    reason:`Lane B ${receipt.decision}: ${receipt.reasons.join(', ')}`,
    agentId:receipt.sellerAgentId,
    provider:receipt.serviceKey,
    serviceUrl,
    priceAtomic,
    offerDigest:receipt.offerDigest,
    policyDigest:receipt.policyDigest,
    laneBReceiptDigest:receiptDigest,
    evidenceTransport:receipt.qualification.evidenceTransport,
    declaredSourceMode:receipt.qualification.declaredSourceMode,
  };
}

export const LANE_B_ADAPTER_CONSTANTS = Object.freeze({ B_SCHEMA, MAX_BLOCK_AGE_SECONDS:Number(MAX_BLOCK_AGE_SECONDS), MAX_FUTURE_SKEW_SECONDS:Number(MAX_FUTURE_SKEW_SECONDS) });
