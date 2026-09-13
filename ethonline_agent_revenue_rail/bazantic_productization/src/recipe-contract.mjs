import { canonicalJson, isSha256Hex, sha256Hex } from './canonical.mjs';
import { normalizeAtomicInteger } from './atomic.mjs';
import { adaptLaneBReceipt } from './lane-b-adapter.mjs';

const VERSION = 'agent-revenue-rail/bazantic-recipe-outcome/v1';
const HEDERA_TESTNET = 'hedera:testnet';
const HBAR_TOKEN_ID = '0.0.0';
const DECISIONS = new Set(['BUY', 'REFUSE', 'DEFER']);
const PURCHASE_STATES = new Set(['SETTLED', 'PAYMENT_REQUIRED', 'FAILED']);
const REPORT_ACTIONS = new Set(['ACT', 'MONITOR', 'IGNORE']);

function assertExactObject(value, required, optional = [], label = 'object') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) throw new TypeError(`${label}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label}.${key} is unknown`);
}

function parseInstant(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new TypeError(`${label} must be canonical UTC milliseconds`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) throw new TypeError(`${label} is invalid`);
  return ms;
}

function normalizeHttpsUrl(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${label} must be an absolute URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname) throw new TypeError(`${label} must be credential-free https`);
  return url.toString();
}

function validateGraphPolicy(policy, nowMs) {
  assertExactObject(policy, ['decision','source','observedAt','expiresAt','evidenceDigest'], ['reason','agentId','provider','serviceUrl','priceAtomic','offerDigest','policyDigest','laneBReceiptDigest','evidenceTransport','declaredSourceMode'], 'graphPolicy');
  if (!DECISIONS.has(policy.decision)) throw new TypeError('graphPolicy.decision is invalid');
  if (typeof policy.source !== 'string' || policy.source.trim() === '') throw new TypeError('graphPolicy.source is required');
  if (!isSha256Hex(policy.evidenceDigest)) throw new TypeError('graphPolicy.evidenceDigest must be sha256 hex');
  const observedMs = parseInstant(policy.observedAt, 'graphPolicy.observedAt');
  const expiresMs = parseInstant(policy.expiresAt, 'graphPolicy.expiresAt');
  if (expiresMs < observedMs) throw new TypeError('graphPolicy expires before observation');
  if (observedMs > nowMs) throw new TypeError('graphPolicy observation is from the future');
  if (policy.serviceUrl !== undefined) normalizeHttpsUrl(policy.serviceUrl, 'graphPolicy.serviceUrl');
  if (policy.priceAtomic !== undefined) normalizeAtomicInteger(policy.priceAtomic, 'graphPolicy.priceAtomic');
  for (const key of ['offerDigest','policyDigest','laneBReceiptDigest']) if (policy[key] !== undefined && !isSha256Hex(policy[key])) throw new TypeError(`graphPolicy.${key} must be sha256 hex`);
  return { observedMs, expiresMs, expired: nowMs > expiresMs };
}

function validatePurchase(purchase) {
  assertExactObject(purchase, ['state','httpStatus','network','asset','amountTinybar','upstreamVerified'], ['txHash','reason','paymentRequirementDigest','feePayer','serviceUrl'], 'purchase');
  if (!PURCHASE_STATES.has(purchase.state)) throw new TypeError('purchase.state is invalid');
  if (!Number.isInteger(purchase.httpStatus) || purchase.httpStatus < 100 || purchase.httpStatus > 599) throw new TypeError('purchase.httpStatus is invalid');
  const amountTinybar = normalizeAtomicInteger(purchase.amountTinybar, 'purchase.amountTinybar');
  if (purchase.network !== HEDERA_TESTNET) throw new TypeError(`purchase.network must be ${HEDERA_TESTNET}`);
  if (purchase.asset !== HBAR_TOKEN_ID) throw new TypeError(`purchase.asset must be ${HBAR_TOKEN_ID}`);
  if (typeof purchase.upstreamVerified !== 'boolean') throw new TypeError('purchase.upstreamVerified must be boolean');
  const serviceUrl = purchase.serviceUrl === undefined ? null : normalizeHttpsUrl(purchase.serviceUrl, 'purchase.serviceUrl');
  if (purchase.state === 'SETTLED') {
    if (!purchase.upstreamVerified) throw new TypeError('SETTLED purchase requires upstreamVerified=true');
    if (typeof purchase.txHash !== 'string' || purchase.txHash.trim() === '') throw new TypeError('SETTLED purchase requires txHash');
    if (purchase.httpStatus < 200 || purchase.httpStatus >= 300) throw new TypeError('SETTLED purchase requires 2xx service response');
  }
  if (purchase.paymentRequirementDigest !== undefined && !isSha256Hex(purchase.paymentRequirementDigest)) throw new TypeError('purchase.paymentRequirementDigest must be sha256 hex');
  return { amountTinybar, serviceUrl };
}

function validateReport(report, nowMs) {
  assertExactObject(report, ['reportId','reportDigest','generatedAt','summary','recommendation'], ['sourceDigest'], 'report');
  if (typeof report.reportId !== 'string' || report.reportId.trim() === '') throw new TypeError('report.reportId is required');
  if (!isSha256Hex(report.reportDigest)) throw new TypeError('report.reportDigest must be sha256 hex');
  const generatedMs = parseInstant(report.generatedAt, 'report.generatedAt');
  if (generatedMs > nowMs) throw new TypeError('report generatedAt is from the future');
  if (typeof report.summary !== 'string' || report.summary.trim() === '') throw new TypeError('report.summary is required');
  assertExactObject(report.recommendation, ['action','rationale'], [], 'report.recommendation');
  if (!REPORT_ACTIONS.has(report.recommendation.action)) throw new TypeError('report.recommendation.action is invalid');
  if (typeof report.recommendation.rationale !== 'string' || report.recommendation.rationale.trim() === '') throw new TypeError('report.recommendation.rationale is required');
  if (report.sourceDigest !== undefined && !isSha256Hex(report.sourceDigest)) throw new TypeError('report.sourceDigest must be sha256 hex');
}

function buildOutcome({ state, nextAction, reason, graphPolicy, purchase = null, report = null }) {
  const evidence = {
    graphPolicyDigest: sha256Hex(graphPolicy),
    graphDecision: graphPolicy.decision,
    boundServiceUrl: graphPolicy.serviceUrl ?? null,
    purchaseState: purchase?.state ?? null,
    settlementTxHash: purchase?.state === 'SETTLED' ? purchase.txHash : null,
    reportDigest: report?.reportDigest ?? null,
  };
  const core = { version: VERSION, state, nextAction, reason, canUseReport: state === 'USE_REPORT', evidence };
  return { ...core, outcomeDigest: sha256Hex(core) };
}

/**
 * Normalize Lane A (x402/Hedera) + Lane B (Graph policy) truth into a Bazantic-facing result.
 * This layer does not create payment authority or verify Hedera itself. upstreamVerified
 * is an explicit dependency on Lane A's verifier; false can never become success here.
 */
export function evaluateRecipeFlow(input) {
  assertExactObject(input, ['now'], ['graphPolicy','laneBReceipt','purchase','report'], 'input');
  if ((input.graphPolicy === undefined) === (input.laneBReceipt === undefined)) throw new TypeError('input requires exactly one of graphPolicy or laneBReceipt');
  const nowMs = parseInstant(input.now, 'input.now');
  const graphPolicy = input.laneBReceipt === undefined ? input.graphPolicy : adaptLaneBReceipt(input.laneBReceipt, { now: input.now });
  const graph = validateGraphPolicy(graphPolicy, nowMs);

  if (graph.expired) {
    return buildOutcome({
      state: 'POLICY_EXPIRED',
      nextAction: 'REFRESH_GRAPH_POLICY',
      reason: input.purchase !== undefined || input.report !== undefined
        ? 'Graph purchase policy expired before this recipe step; downstream purchase/report evidence is ignored.'
        : 'Graph purchase policy expired before purchase.',
      graphPolicy,
    });
  }

  if (graphPolicy.decision === 'REFUSE') {
    if (input.purchase !== undefined || input.report !== undefined) return buildOutcome({
      state: 'GATE_VIOLATION', nextAction: 'STOP',
      reason: 'Purchase/report evidence was supplied despite a REFUSE policy; recipe refuses to normalize it as success.',
      graphPolicy,
    });
    return buildOutcome({ state: 'SKIP_PURCHASE', nextAction: 'STOP', reason: graphPolicy.reason || 'The Graph policy refused the purchase.', graphPolicy });
  }

  if (graphPolicy.decision === 'DEFER') {
    if (input.purchase !== undefined || input.report !== undefined) return buildOutcome({
      state: 'GATE_VIOLATION', nextAction: 'STOP',
      reason: 'Purchase/report evidence was supplied despite a DEFER policy; recipe refuses to normalize it as success.',
      graphPolicy,
    });
    return buildOutcome({ state: 'DEFER_PURCHASE', nextAction: 'RETRY_GRAPH_LATER', reason: graphPolicy.reason || 'The Graph policy deferred the purchase.', graphPolicy });
  }

  if (input.purchase === undefined) return buildOutcome({
    state: 'PURCHASE_NEEDED', nextAction: 'CALL_X402_REPORT_SERVICE',
    reason: 'The Graph policy is BUY; call the Lane A report service and preserve its exact payment/settlement truth.',
    graphPolicy,
  });

  const purchaseValidation = validatePurchase(input.purchase);
  if (graphPolicy.serviceUrl !== undefined) {
    const boundServiceUrl = normalizeHttpsUrl(graphPolicy.serviceUrl, 'graphPolicy.serviceUrl');
    if (purchaseValidation.serviceUrl === null) throw new TypeError('purchase.serviceUrl is required for Lane B bound service');
    if (purchaseValidation.serviceUrl !== boundServiceUrl) throw new TypeError('purchase.serviceUrl does not match Lane B serviceUrl');
  }
  if (graphPolicy.priceAtomic !== undefined && purchaseValidation.amountTinybar !== graphPolicy.priceAtomic) throw new TypeError('purchase.amountTinybar does not match Lane B offer priceAtomic');
  if (input.purchase.state === 'PAYMENT_REQUIRED') return buildOutcome({
    state: 'PAYMENT_REQUIRED', nextAction: 'SATISFY_X402_REQUIREMENT',
    reason: input.purchase.reason || 'Service returned an x402 payment requirement.',
    graphPolicy, purchase: input.purchase,
  });
  if (input.purchase.state === 'FAILED') return buildOutcome({
    state: 'PURCHASE_FAILED', nextAction: 'STOP_OR_RETRY_PER_UPSTREAM',
    reason: input.purchase.reason || 'Lane A reported a failed purchase.',
    graphPolicy, purchase: input.purchase,
  });
  if (input.report === undefined) return buildOutcome({
    state: 'REPORT_MISSING', nextAction: 'FETCH_SETTLED_REPORT_RESULT',
    reason: 'Settlement is upstream-verified but no report result was supplied.',
    graphPolicy, purchase: input.purchase,
  });

  validateReport(input.report, nowMs);
  return buildOutcome({
    state: 'USE_REPORT', nextAction: `REPORT_${input.report.recommendation.action}`,
    reason: input.report.recommendation.rationale,
    graphPolicy, purchase: input.purchase, report: input.report,
  });
}

export const recipeOutcomeJson = (input) => canonicalJson(evaluateRecipeFlow(input));
export const CONTRACT_CONSTANTS = Object.freeze({ VERSION, HEDERA_TESTNET, HBAR_TOKEN_ID });
