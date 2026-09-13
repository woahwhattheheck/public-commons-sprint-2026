import {
  ContractError,
  canonicalStringify,
  contractAssert,
  digestObject,
  parseDecimalInteger,
  parseIsoInstant,
  rejectUnknownKeys,
  requireBoolean,
  requireSafeInteger,
  requireString,
} from './canonical.mjs';

const SHA256_RE = /^[0-9a-f]{64}$/;
const AGENT_ID_RE = /^[1-9][0-9]*:[0-9]+$/;
const CURRENCY_RE = /^[A-Z][A-Z0-9._-]{1,31}$/;
const TRUST_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function normalizeHttpsUrl(value, code) {
  requireString(value, code, { maxLength: 2048 });
  let url;
  try { url = new URL(value); } catch { throw new ContractError(code); }
  contractAssert(url.protocol === 'https:', code);
  contractAssert(!url.username && !url.password && !url.hash && url.hostname.length > 0, code);
  return url.toString();
}

function normalizeNullableRegistrationUrl(value, code) {
  if (value === null) return null;
  return normalizeHttpsUrl(value, code);
}

function normalizeOffer(input) {
  rejectUnknownKeys(input, ['schema', 'offerId', 'sellerAgentId', 'serviceKey', 'serviceUrl', 'requestDigest', 'currency', 'priceAtomic'], 'OFFER_UNKNOWN_FIELD');
  contractAssert(input.schema === 'agent-revenue-offer/v1', 'OFFER_SCHEMA');
  const offer = {
    schema: input.schema,
    offerId: requireString(input.offerId, 'OFFER_ID', { maxLength: 128 }),
    sellerAgentId: requireString(input.sellerAgentId, 'OFFER_SELLER_AGENT_ID', { pattern: AGENT_ID_RE, maxLength: 96 }),
    serviceKey: requireString(input.serviceKey, 'OFFER_SERVICE_KEY', { maxLength: 160 }),
    serviceUrl: normalizeHttpsUrl(input.serviceUrl, 'OFFER_SERVICE_URL'),
    requestDigest: requireString(input.requestDigest, 'OFFER_REQUEST_DIGEST', { pattern: SHA256_RE, maxLength: 64 }),
    currency: requireString(input.currency, 'OFFER_CURRENCY', { pattern: CURRENCY_RE, maxLength: 32 }),
    priceAtomic: requireString(input.priceAtomic, 'OFFER_PRICE_ATOMIC', { maxLength: 78 }),
  };
  parseDecimalInteger(offer.priceAtomic, 'OFFER_PRICE_ATOMIC');
  return offer;
}

function normalizePolicy(input) {
  rejectUnknownKeys(input, [
    'schema', 'currency', 'budgetRemainingAtomic', 'maxPriceAtomic', 'requireLiveData',
    'maxCaptureAgeSeconds', 'maxBlockAgeSeconds', 'maxFutureSkewSeconds', 'requireX402',
    'allowedTrustModels', 'minFeedbackCount', 'minAverageFeedbackScore', 'minPaidFeedbackCount',
    'minCompletedValidations', 'minAverageValidationScore',
  ], 'POLICY_UNKNOWN_FIELD');
  contractAssert(input.schema === 'graph-purchase-policy/v1', 'POLICY_SCHEMA');
  const allowedTrustModels = input.allowedTrustModels;
  contractAssert(Array.isArray(allowedTrustModels) && allowedTrustModels.length > 0 && allowedTrustModels.length <= 16, 'POLICY_TRUST_MODELS');
  const trusts = [...new Set(allowedTrustModels.map((trust) => requireString(trust, 'POLICY_TRUST_MODEL', { pattern: TRUST_RE, maxLength: 64 })))].sort();
  const policy = {
    schema: input.schema,
    currency: requireString(input.currency, 'POLICY_CURRENCY', { pattern: CURRENCY_RE, maxLength: 32 }),
    budgetRemainingAtomic: requireString(input.budgetRemainingAtomic, 'POLICY_BUDGET', { maxLength: 78 }),
    maxPriceAtomic: requireString(input.maxPriceAtomic, 'POLICY_MAX_PRICE', { maxLength: 78 }),
    requireLiveData: requireBoolean(input.requireLiveData, 'POLICY_REQUIRE_LIVE'),
    maxCaptureAgeSeconds: requireSafeInteger(input.maxCaptureAgeSeconds, 'POLICY_CAPTURE_AGE', { min: 1, max: 86400 }),
    maxBlockAgeSeconds: requireSafeInteger(input.maxBlockAgeSeconds, 'POLICY_BLOCK_AGE', { min: 1, max: 86400 }),
    maxFutureSkewSeconds: requireSafeInteger(input.maxFutureSkewSeconds, 'POLICY_FUTURE_SKEW', { min: 0, max: 3600 }),
    requireX402: requireBoolean(input.requireX402, 'POLICY_REQUIRE_X402'),
    allowedTrustModels: trusts,
    minFeedbackCount: requireSafeInteger(input.minFeedbackCount, 'POLICY_FEEDBACK_COUNT', { min: 0, max: 100 }),
    minAverageFeedbackScore: requireSafeInteger(input.minAverageFeedbackScore, 'POLICY_FEEDBACK_SCORE', { min: 0, max: 100 }),
    minPaidFeedbackCount: requireSafeInteger(input.minPaidFeedbackCount, 'POLICY_PAID_FEEDBACK_COUNT', { min: 0, max: 100 }),
    minCompletedValidations: requireSafeInteger(input.minCompletedValidations, 'POLICY_VALIDATION_COUNT', { min: 0, max: 100 }),
    minAverageValidationScore: requireSafeInteger(input.minAverageValidationScore, 'POLICY_VALIDATION_SCORE', { min: 0, max: 100 }),
  };
  parseDecimalInteger(policy.budgetRemainingAtomic, 'POLICY_BUDGET');
  parseDecimalInteger(policy.maxPriceAtomic, 'POLICY_MAX_PRICE');
  return policy;
}

function normalizeFeedback(row) {
  rejectUnknownKeys(row, ['id', 'score', 'clientAddress', 'createdAt', 'proofOfPaymentTxHash'], 'FEEDBACK_UNKNOWN_FIELD');
  const created = requireString(row.createdAt, 'FEEDBACK_CREATED_AT', { maxLength: 32 });
  parseDecimalInteger(created, 'FEEDBACK_CREATED_AT', { maxDigits: 20 });
  let proof = null;
  if (row.proofOfPaymentTxHash !== null) {
    proof = requireString(row.proofOfPaymentTxHash, 'FEEDBACK_PAYMENT_PROOF', { maxLength: 256 });
  }
  return {
    id: requireString(row.id, 'FEEDBACK_ID', { maxLength: 256 }),
    score: requireSafeInteger(row.score, 'FEEDBACK_SCORE', { min: 0, max: 100 }),
    clientAddress: requireString(row.clientAddress, 'FEEDBACK_CLIENT', { maxLength: 256 }),
    createdAt: created,
    proofOfPaymentTxHash: proof,
  };
}

function normalizeValidation(row) {
  rejectUnknownKeys(row, ['id', 'validatorAddress', 'response', 'status', 'createdAt'], 'VALIDATION_UNKNOWN_FIELD');
  const status = requireString(row.status, 'VALIDATION_STATUS', { maxLength: 32 });
  contractAssert(['PENDING', 'COMPLETED', 'EXPIRED'].includes(status), 'VALIDATION_STATUS');
  const created = requireString(row.createdAt, 'VALIDATION_CREATED_AT', { maxLength: 32 });
  parseDecimalInteger(created, 'VALIDATION_CREATED_AT', { maxDigits: 20 });
  return {
    id: requireString(row.id, 'VALIDATION_ID', { maxLength: 256 }),
    validatorAddress: requireString(row.validatorAddress, 'VALIDATION_VALIDATOR', { maxLength: 256 }),
    response: requireSafeInteger(row.response, 'VALIDATION_RESPONSE', { min: 0, max: 100 }),
    status,
    createdAt: created,
  };
}

function dedupeRows(rows, normalizer, conflictCode) {
  contractAssert(Array.isArray(rows) && rows.length <= 100, conflictCode);
  const byId = new Map();
  for (const input of rows) {
    const row = normalizer(input);
    const encoded = canonicalStringify(row);
    const prior = byId.get(row.id);
    if (prior && prior.encoded !== encoded) throw new ContractError(conflictCode);
    if (!prior) byId.set(row.id, { row, encoded });
  }
  return [...byId.values()].map(({ row }) => row).sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeEvidence(input) {
  rejectUnknownKeys(input, ['schema', 'sourceMode', 'capturedAt', 'sourceRef', 'rawDigest', 'graph', 'agent'], 'EVIDENCE_UNKNOWN_FIELD');
  contractAssert(input.schema === 'graph-agent-evidence/v1', 'EVIDENCE_SCHEMA');
  const sourceMode = requireString(input.sourceMode, 'EVIDENCE_SOURCE_MODE', { maxLength: 32 });
  contractAssert(sourceMode === 'live_graph' || sourceMode === 'fixture', 'EVIDENCE_SOURCE_MODE');
  const captured = parseIsoInstant(input.capturedAt, 'EVIDENCE_CAPTURED_AT');
  const rawDigest = requireString(input.rawDigest, 'EVIDENCE_RAW_DIGEST', { pattern: SHA256_RE, maxLength: 64 });

  rejectUnknownKeys(input.graph, ['deployment', 'blockNumber', 'blockHash', 'blockTimestamp', 'hasIndexingErrors'], 'GRAPH_UNKNOWN_FIELD');
  const blockNumber = requireString(input.graph.blockNumber, 'GRAPH_BLOCK_NUMBER', { maxLength: 40 });
  const blockTimestamp = requireString(input.graph.blockTimestamp, 'GRAPH_BLOCK_TIMESTAMP', { maxLength: 32 });
  parseDecimalInteger(blockNumber, 'GRAPH_BLOCK_NUMBER', { maxDigits: 40 });
  parseDecimalInteger(blockTimestamp, 'GRAPH_BLOCK_TIMESTAMP', { maxDigits: 20 });
  const graph = {
    deployment: requireString(input.graph.deployment, 'GRAPH_DEPLOYMENT', { maxLength: 128 }),
    blockNumber,
    blockHash: requireString(input.graph.blockHash, 'GRAPH_BLOCK_HASH', { maxLength: 256 }),
    blockTimestamp,
    hasIndexingErrors: requireBoolean(input.graph.hasIndexingErrors, 'GRAPH_INDEXING_ERRORS'),
  };

  rejectUnknownKeys(input.agent, ['id', 'chainId', 'agentId', 'owner', 'updatedAt', 'lastActivity', 'registration', 'feedback', 'validations'], 'AGENT_UNKNOWN_FIELD');
  rejectUnknownKeys(input.agent.registration, ['active', 'x402Support', 'supportedTrusts', 'webEndpoint', 'mcpEndpoint', 'a2aEndpoint'], 'REGISTRATION_UNKNOWN_FIELD');
  const id = requireString(input.agent.id, 'AGENT_ID', { pattern: AGENT_ID_RE, maxLength: 96 });
  const chainId = requireString(input.agent.chainId, 'AGENT_CHAIN_ID', { maxLength: 40 });
  const agentId = requireString(input.agent.agentId, 'AGENT_NUMERIC_ID', { maxLength: 40 });
  parseDecimalInteger(chainId, 'AGENT_CHAIN_ID', { min: 1n, maxDigits: 40 });
  parseDecimalInteger(agentId, 'AGENT_NUMERIC_ID', { maxDigits: 40 });
  contractAssert(id === `${chainId}:${agentId}`, 'AGENT_ID_COMPONENT_MISMATCH');
  const updatedAt = requireString(input.agent.updatedAt, 'AGENT_UPDATED_AT', { maxLength: 32 });
  const lastActivity = requireString(input.agent.lastActivity, 'AGENT_LAST_ACTIVITY', { maxLength: 32 });
  parseDecimalInteger(updatedAt, 'AGENT_UPDATED_AT', { maxDigits: 20 });
  parseDecimalInteger(lastActivity, 'AGENT_LAST_ACTIVITY', { maxDigits: 20 });
  contractAssert(Array.isArray(input.agent.registration.supportedTrusts) && input.agent.registration.supportedTrusts.length <= 32, 'REGISTRATION_TRUSTS');
  const supportedTrusts = [...new Set(input.agent.registration.supportedTrusts.map((trust) => requireString(trust, 'REGISTRATION_TRUST', { pattern: TRUST_RE, maxLength: 64 })))].sort();
  const agent = {
    id,
    chainId,
    agentId,
    owner: requireString(input.agent.owner, 'AGENT_OWNER', { maxLength: 256 }),
    updatedAt,
    lastActivity,
    registration: {
      active: requireBoolean(input.agent.registration.active, 'REGISTRATION_ACTIVE'),
      x402Support: requireBoolean(input.agent.registration.x402Support, 'REGISTRATION_X402'),
      supportedTrusts,
      webEndpoint: normalizeNullableRegistrationUrl(input.agent.registration.webEndpoint, 'REGISTRATION_WEB_ENDPOINT'),
      mcpEndpoint: normalizeNullableRegistrationUrl(input.agent.registration.mcpEndpoint, 'REGISTRATION_MCP_ENDPOINT'),
      a2aEndpoint: normalizeNullableRegistrationUrl(input.agent.registration.a2aEndpoint, 'REGISTRATION_A2A_ENDPOINT'),
    },
    feedback: dedupeRows(input.agent.feedback, normalizeFeedback, 'CONFLICTING_FEEDBACK_DUPLICATE'),
    validations: dedupeRows(input.agent.validations, normalizeValidation, 'CONFLICTING_VALIDATION_DUPLICATE'),
  };

  return {
    schema: input.schema,
    sourceMode,
    capturedAt: captured.iso,
    sourceRef: requireString(input.sourceRef, 'EVIDENCE_SOURCE_REF', { maxLength: 512 }),
    rawDigest,
    graph,
    agent,
  };
}

function decimalAverage(sum, count) {
  if (count === 0) return '0.00';
  const scaled = BigInt(sum) * 100n;
  const hundredths = scaled / BigInt(count);
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
}

function safeDigest(value) {
  try { return digestObject(value); } catch { return null; }
}

function buildReceipt({ decision, reasons, offer, policy, evidence, metrics, budgetAfterAtomic, evidenceValid }) {
  const live = evidenceValid && evidence?.sourceMode === 'live_graph';
  const receipt = {
    schema: 'graph-purchase-decision/v1',
    decision,
    reasons: [...new Set(reasons)].sort(),
    offerId: offer.offerId,
    sellerAgentId: offer.sellerAgentId,
    serviceKey: offer.serviceKey,
    serviceUrl: offer.serviceUrl,
    currency: offer.currency,
    priceAtomic: offer.priceAtomic,
    budgetBeforeAtomic: policy.budgetRemainingAtomic,
    budgetAfterAtomic,
    offerDigest: digestObject(offer),
    policyDigest: digestObject(policy),
    evidenceDigest: evidenceValid ? digestObject(evidence) : safeDigest(evidence),
    metrics,
    qualification: {
      liveGraphEvidence: live,
      fixtureOnly: !live,
      prizeEligibilityClaimed: false,
    },
    authority: {
      payment: false,
      walletWrite: false,
      providerMutation: false,
      submission: false,
    },
  };
  return { ...receipt, receiptDigest: digestObject(receipt) };
}

export function evaluatePurchase({ offer: offerInput, policy: policyInput, evidence: evidenceInput, now = new Date().toISOString() }) {
  const offer = normalizeOffer(offerInput);
  const policy = normalizePolicy(policyInput);
  const nowInstant = parseIsoInstant(now, 'NOW_INVALID');
  const nowSeconds = BigInt(Math.floor(nowInstant.millis / 1000));
  const futureSkew = BigInt(policy.maxFutureSkewSeconds);

  let evidence;
  try {
    evidence = normalizeEvidence(evidenceInput);
  } catch (error) {
    const code = error instanceof ContractError ? error.code : 'EVIDENCE_INVALID';
    return buildReceipt({
      decision: 'HOLD', reasons: [`EVIDENCE_INVALID:${code}`], offer, policy, evidence: evidenceInput,
      metrics: null, budgetAfterAtomic: policy.budgetRemainingAtomic, evidenceValid: false,
    });
  }

  const hold = [];
  if (evidence.agent.id !== offer.sellerAgentId) hold.push('SELLER_EVIDENCE_MISMATCH');
  const serviceOrigin = new URL(offer.serviceUrl).origin;
  const registeredEndpoints = [
    ['web', evidence.agent.registration.webEndpoint],
    ['mcp', evidence.agent.registration.mcpEndpoint],
    ['a2a', evidence.agent.registration.a2aEndpoint],
  ];
  const matchedEndpointKinds = registeredEndpoints
    .filter(([, endpoint]) => endpoint !== null && new URL(endpoint).origin === serviceOrigin)
    .map(([kind]) => kind)
    .sort();
  if (matchedEndpointKinds.length === 0) hold.push('SERVICE_ORIGIN_UNBOUND');
  if (policy.requireLiveData && evidence.sourceMode !== 'live_graph') hold.push('LIVE_EVIDENCE_REQUIRED');
  if (evidence.graph.hasIndexingErrors) hold.push('GRAPH_INDEXING_ERRORS');

  const capturedSeconds = BigInt(Math.floor(Date.parse(evidence.capturedAt) / 1000));
  const blockSeconds = parseDecimalInteger(evidence.graph.blockTimestamp, 'GRAPH_BLOCK_TIMESTAMP');
  if (capturedSeconds > nowSeconds + futureSkew) hold.push('CAPTURE_FROM_FUTURE');
  if (nowSeconds > capturedSeconds + BigInt(policy.maxCaptureAgeSeconds)) hold.push('CAPTURE_STALE');
  if (blockSeconds > nowSeconds + futureSkew) hold.push('GRAPH_BLOCK_FROM_FUTURE');
  if (nowSeconds > blockSeconds + BigInt(policy.maxBlockAgeSeconds)) hold.push('GRAPH_BLOCK_STALE');
  if (blockSeconds > capturedSeconds + futureSkew) hold.push('GRAPH_BLOCK_AFTER_CAPTURE');

  for (const row of evidence.agent.feedback) {
    const created = parseDecimalInteger(row.createdAt, 'FEEDBACK_CREATED_AT');
    if (created > nowSeconds + futureSkew) hold.push('FEEDBACK_FROM_FUTURE');
  }
  for (const row of evidence.agent.validations) {
    const created = parseDecimalInteger(row.createdAt, 'VALIDATION_CREATED_AT');
    if (created > nowSeconds + futureSkew) hold.push('VALIDATION_FROM_FUTURE');
  }

  const feedback = evidence.agent.feedback;
  const feedbackSum = feedback.reduce((sum, row) => sum + row.score, 0);
  const paidFeedbackCount = feedback.filter((row) => row.proofOfPaymentTxHash !== null && row.proofOfPaymentTxHash.length > 0).length;
  const completedValidations = evidence.agent.validations.filter((row) => row.status === 'COMPLETED');
  const validationSum = completedValidations.reduce((sum, row) => sum + row.response, 0);
  const metrics = {
    feedbackCount: feedback.length,
    averageFeedbackScore: decimalAverage(feedbackSum, feedback.length),
    paidFeedbackCount,
    completedValidationCount: completedValidations.length,
    averageCompletedValidationScore: decimalAverage(validationSum, completedValidations.length),
    supportedTrustModels: evidence.agent.registration.supportedTrusts,
    serviceOrigin,
    matchedEndpointKinds,
    graphBlockNumber: evidence.graph.blockNumber,
    graphBlockTimestamp: evidence.graph.blockTimestamp,
  };

  if (hold.length) {
    return buildReceipt({ decision: 'HOLD', reasons: hold, offer, policy, evidence, metrics, budgetAfterAtomic: policy.budgetRemainingAtomic, evidenceValid: true });
  }

  const skip = [];
  if (offer.currency !== policy.currency) skip.push('CURRENCY_NOT_ALLOWED');
  const price = parseDecimalInteger(offer.priceAtomic, 'OFFER_PRICE_ATOMIC');
  const budget = parseDecimalInteger(policy.budgetRemainingAtomic, 'POLICY_BUDGET');
  const maxPrice = parseDecimalInteger(policy.maxPriceAtomic, 'POLICY_MAX_PRICE');
  if (price > maxPrice) skip.push('PRICE_ABOVE_MAX');
  if (price > budget) skip.push('PRICE_ABOVE_BUDGET');
  if (!evidence.agent.registration.active) skip.push('SELLER_INACTIVE');
  if (policy.requireX402 && !evidence.agent.registration.x402Support) skip.push('X402_UNSUPPORTED');
  if (!policy.allowedTrustModels.some((trust) => evidence.agent.registration.supportedTrusts.includes(trust))) skip.push('TRUST_MODEL_UNSATISFIED');
  if (feedback.length < policy.minFeedbackCount) skip.push('INSUFFICIENT_FEEDBACK');
  if (feedback.length > 0 && feedbackSum < policy.minAverageFeedbackScore * feedback.length) skip.push('AVERAGE_FEEDBACK_SCORE_BELOW_MINIMUM');
  if (feedback.length === 0 && policy.minAverageFeedbackScore > 0) skip.push('AVERAGE_FEEDBACK_SCORE_BELOW_MINIMUM');
  if (paidFeedbackCount < policy.minPaidFeedbackCount) skip.push('INSUFFICIENT_PAID_FEEDBACK');
  if (completedValidations.length < policy.minCompletedValidations) skip.push('INSUFFICIENT_COMPLETED_VALIDATIONS');
  if (completedValidations.length > 0 && validationSum < policy.minAverageValidationScore * completedValidations.length) skip.push('AVERAGE_VALIDATION_SCORE_BELOW_MINIMUM');
  if (completedValidations.length === 0 && policy.minAverageValidationScore > 0) skip.push('AVERAGE_VALIDATION_SCORE_BELOW_MINIMUM');

  if (skip.length) {
    return buildReceipt({ decision: 'SKIP', reasons: skip, offer, policy, evidence, metrics, budgetAfterAtomic: policy.budgetRemainingAtomic, evidenceValid: true });
  }

  return buildReceipt({
    decision: 'BUY', reasons: ['POLICY_SATISFIED'], offer, policy, evidence, metrics,
    budgetAfterAtomic: (budget - price).toString(), evidenceValid: true,
  });
}
