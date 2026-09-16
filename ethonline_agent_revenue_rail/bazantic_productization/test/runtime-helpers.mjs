import { sha256Hex } from '../src/canonical.mjs';
import { createRecipeAuthority } from '../src/recipe-contract.mjs';

export const D = (char) => char.repeat(64);
export const G = (char) => char.repeat(40);
export const evaluatedAt = '2026-09-15T21:00:00.000Z';

export function laneBReceipt(decision = 'BUY', overrides = {}) {
  const core = {
    schema: 'graph-purchase-decision/v1',
    decision,
    reasons: [decision === 'BUY' ? 'POLICY_SATISFIED' : decision === 'SKIP' ? 'PRICE_ABOVE_MAX' : 'PROVIDER_UNAVAILABLE'],
    offerId: 'offer-1', sellerAgentId: '8453:77', serviceKey: 'agent-revenue-report',
    serviceUrl: 'https://rail.example.test/report', currency: 'TINYBAR', priceAtomic: '2500000',
    budgetBeforeAtomic: '5000000', budgetAfterAtomic: decision === 'BUY' ? '2500000' : '5000000',
    offerDigest: D('1'), policyDigest: D('2'), evidenceDigest: D('3'),
    metrics: {
      feedbackCount: 3, averageFeedbackScore: '95.00', paidFeedbackCount: 2,
      completedValidationCount: 1, averageCompletedValidationScore: '90.00',
      supportedTrustModels: ['reputation'], serviceOrigin: 'https://rail.example.test',
      matchedEndpointKinds: ['web'], graphBlockNumber: '123', graphBlockTimestamp: '1789505940',
    },
    qualification: {
      evidenceTransport: 'live_graph', declaredSourceMode: 'live_graph', liveGraphEvidence: true,
      fixtureOnly: false, prizeEligibilityClaimed: false,
    },
    authority: { payment: false, walletWrite: false, providerMutation: false, submission: false },
    ...overrides,
  };
  return { ...core, receiptDigest: sha256Hex(core) };
}

export function laneAReceipt(state = 'SETTLED', overrides = {}) {
  const stateValues = state === 'SETTLED'
    ? { httpStatus: 200, upstreamVerified: true, txHash: '0.0.4242@1789505960.123456789', paymentRequirementDigest: D('4'), serviceResponseDigest: D('5'), reportPayloadDigest: null, reason: null }
    : state === 'PAYMENT_REQUIRED'
      ? { httpStatus: 402, upstreamVerified: false, txHash: null, paymentRequirementDigest: D('4'), serviceResponseDigest: null, reportPayloadDigest: null, reason: 'payment required' }
      : { httpStatus: 500, upstreamVerified: false, txHash: null, paymentRequirementDigest: null, serviceResponseDigest: null, reportPayloadDigest: null, reason: 'provider failed' };
  const core = {
    schema: 'agent-revenue-rail/lane-a-settlement-receipt/v1', state,
    network: 'hedera:testnet', asset: '0.0.0', amountTinybar: '2500000',
    serviceUrl: 'https://rail.example.test/report', ...stateValues, ...overrides,
  };
  return { ...core, receiptDigest: sha256Hex(core) };
}

export function reportPayload(overrides = {}) {
  const core = {
    schema: 'agent-revenue-rail/report-payload/v1', reportId: 'report-001',
    generatedAt: '2026-09-15T20:59:30.000Z', summary: 'Bound report result.',
    recommendation: { action: 'ACT', rationale: 'Proceed to the bounded next step.' },
    sourceDigest: D('6'), serviceResponseDigest: D('5'), ...overrides,
  };
  return { ...core, payloadDigest: sha256Hex(core) };
}

export function completeRuntime() {
  const b = laneBReceipt();
  const report = reportPayload();
  const a = laneAReceipt('SETTLED', { reportPayloadDigest: report.payloadDigest });
  return {
    input: { laneBReceipt: b, laneAReceipt: a, report },
    authority: createRecipeAuthority({
      evaluatedAt,
      laneB: { expectedReceiptDigest: b.receiptDigest, sourceHead: G('a'), executionEvidenceDigest: D('a') },
      laneA: { expectedReceiptDigest: a.receiptDigest, sourceHead: G('b'), executionEvidenceDigest: D('b') },
      report: { expectedPayloadDigest: report.payloadDigest, expectedServiceResponseDigest: report.serviceResponseDigest, sourceHead: G('c'), executionEvidenceDigest: D('c') },
    }),
  };
}
