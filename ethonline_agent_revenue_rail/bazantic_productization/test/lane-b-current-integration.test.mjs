import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipeAuthority, evaluateRecipeFlow } from '../src/recipe-contract.mjs';

const NOW = '2026-09-13T09:40:00.000Z';
const NOW_S = 1789292400;
const H = 'a'.repeat(64);
let evaluatePurchase = null;
let importFailure = null;
try {
  ({ evaluatePurchase } = await import('../../graph_purchase_policy/src/policy.mjs'));
} catch (error) {
  importFailure = error;
}

function offer() {
  return {
    schema: 'agent-revenue-offer/v1', offerId: 'report-001', sellerAgentId: '84532:77',
    serviceKey: 'work-intelligence/v1', serviceUrl: 'https://seller.example/x402/report',
    requestDigest: H, currency: 'HBAR_TINYBAR', priceAtomic: '900719925474099312345',
  };
}

function policy() {
  return {
    schema: 'graph-purchase-policy/v1', currency: 'HBAR_TINYBAR',
    budgetRemainingAtomic: '900719925474099312999', maxPriceAtomic: '900719925474099312500',
    requireLiveData: true, maxCaptureAgeSeconds: 300, maxBlockAgeSeconds: 300,
    maxFutureSkewSeconds: 30, requireX402: true, allowedTrustModels: ['reputation'],
    minFeedbackCount: 2, minAverageFeedbackScore: 80, minPaidFeedbackCount: 1,
    minCompletedValidations: 1, minAverageValidationScore: 75,
  };
}

function evidence(sourceMode = 'live_graph') {
  return {
    schema: 'graph-agent-evidence/v1', sourceMode, capturedAt: '2026-09-13T09:39:55.000Z',
    sourceRef: 'https://gateway.thegraph.com/subgraphs/id/QmPublic', rawDigest: 'b'.repeat(64),
    graph: { deployment: 'QmDeployment', blockNumber: '12345678', blockHash: '0xabc', blockTimestamp: String(NOW_S - 10), hasIndexingErrors: false },
    agent: {
      id: '84532:77', chainId: '84532', agentId: '77', owner: '0xowner',
      updatedAt: String(NOW_S - 40), lastActivity: String(NOW_S - 20),
      registration: { active: true, x402Support: true, supportedTrusts: ['reputation', 'tee-attestation'], webEndpoint: 'https://seller.example/', mcpEndpoint: null, a2aEndpoint: null },
      feedback: [
        { id: 'f2', score: 90, clientAddress: '0xc2', createdAt: String(NOW_S - 200), proofOfPaymentTxHash: null },
        { id: 'f1', score: 80, clientAddress: '0xc1', createdAt: String(NOW_S - 100), proofOfPaymentTxHash: '0xpaid' },
      ],
      validations: [{ id: 'v1', validatorAddress: '0xv', response: 85, status: 'COMPLETED', createdAt: String(NOW_S - 90) }],
    },
  };
}

const skip = evaluatePurchase ? false : `landed Lane B module unavailable in isolated package checkout: ${importFailure?.code ?? importFailure?.message}`;

test('actual landed Lane B BUY receipt crosses the branded Lane C boundary', { skip }, () => {
  const receipt = evaluatePurchase({ offer: offer(), policy: policy(), evidence: evidence(), evidenceTransport: 'live_graph', now: NOW });
  assert.equal(receipt.decision, 'BUY');
  assert.equal(receipt.qualification.evidenceTransport, 'live_graph');
  assert.equal(receipt.qualification.declaredSourceMode, 'live_graph');
  assert.equal(receipt.serviceUrl, offer().serviceUrl);
  const authority = createRecipeAuthority({
    evaluatedAt: NOW,
    laneB: { expectedReceiptDigest: receipt.receiptDigest, sourceHead: 'a'.repeat(40), executionEvidenceDigest: 'c'.repeat(64) },
  });
  const outcome = evaluateRecipeFlow({ laneBReceipt: receipt }, authority);
  assert.equal(outcome.state, 'PURCHASE_NEEDED');
  assert.equal(outcome.evidence.boundServiceUrl, 'https://seller.example/x402/report');
  assert.equal(outcome.evidence.laneBReceiptDigest, receipt.receiptDigest);
});

test('actual landed Lane B fixture transport cannot become a Lane C BUY', { skip }, () => {
  const receipt = evaluatePurchase({ offer: offer(), policy: policy(), evidence: evidence('live_graph'), evidenceTransport: 'fixture', now: NOW });
  assert.equal(receipt.decision, 'HOLD');
  assert.equal(receipt.qualification.liveGraphEvidence, false);
  const authority = createRecipeAuthority({
    evaluatedAt: NOW,
    laneB: { expectedReceiptDigest: receipt.receiptDigest, sourceHead: 'a'.repeat(40), executionEvidenceDigest: 'd'.repeat(64) },
  });
  const outcome = evaluateRecipeFlow({ laneBReceipt: receipt }, authority);
  assert.equal(outcome.state, 'DEFER_PURCHASE');
});
