import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluatePurchase } from '../src/policy.mjs';
import { fetchLiveAgentEvidence } from '../src/live_graph.mjs';

const NOW = '2026-09-13T09:40:00.000Z';
const NOW_S = 1789292400;
const H = 'a'.repeat(64);

function offer(overrides = {}) {
  return {
    schema: 'agent-revenue-offer/v1',
    offerId: 'report-001',
    sellerAgentId: '84532:77',
    serviceKey: 'work-intelligence/v1',
    serviceUrl: 'https://seller.example/x402/report',
    requestDigest: H,
    currency: 'HBAR_TINYBAR',
    priceAtomic: '900719925474099312345',
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    schema: 'graph-purchase-policy/v1',
    currency: 'HBAR_TINYBAR',
    budgetRemainingAtomic: '900719925474099312999',
    maxPriceAtomic: '900719925474099312500',
    requireLiveData: true,
    maxCaptureAgeSeconds: 300,
    maxBlockAgeSeconds: 300,
    maxFutureSkewSeconds: 30,
    requireX402: true,
    allowedTrustModels: ['reputation'],
    minFeedbackCount: 2,
    minAverageFeedbackScore: 80,
    minPaidFeedbackCount: 1,
    minCompletedValidations: 1,
    minAverageValidationScore: 75,
    ...overrides,
  };
}

function evidence(overrides = {}) {
  const base = {
    schema: 'graph-agent-evidence/v1',
    sourceMode: 'live_graph',
    capturedAt: '2026-09-13T09:39:55.000Z',
    sourceRef: 'https://gateway.thegraph.com/subgraphs/id/QmPublic',
    rawDigest: 'b'.repeat(64),
    graph: {
      deployment: 'QmDeployment',
      blockNumber: '12345678',
      blockHash: '0xabc',
      blockTimestamp: String(NOW_S - 10),
      hasIndexingErrors: false,
    },
    agent: {
      id: '84532:77',
      chainId: '84532',
      agentId: '77',
      owner: '0xowner',
      updatedAt: String(NOW_S - 40),
      lastActivity: String(NOW_S - 20),
      registration: { active: true, x402Support: true, supportedTrusts: ['reputation', 'tee-attestation'], webEndpoint: 'https://seller.example/', mcpEndpoint: null, a2aEndpoint: null },
      feedback: [
        { id: 'f2', score: 90, clientAddress: '0xc2', createdAt: String(NOW_S - 200), proofOfPaymentTxHash: null },
        { id: 'f1', score: 80, clientAddress: '0xc1', createdAt: String(NOW_S - 100), proofOfPaymentTxHash: '0xpaid' },
      ],
      validations: [
        { id: 'v1', validatorAddress: '0xv', response: 85, status: 'COMPLETED', createdAt: String(NOW_S - 90) },
      ],
    },
  };
  return {
    ...base,
    ...overrides,
    graph: { ...base.graph, ...(overrides.graph ?? {}) },
    agent: {
      ...base.agent,
      ...(overrides.agent ?? {}),
      registration: { ...base.agent.registration, ...(overrides.agent?.registration ?? {}) },
      feedback: overrides.agent?.feedback ?? base.agent.feedback,
      validations: overrides.agent?.validations ?? base.agent.validations,
    },
  };
}

function decide(o = offer(), p = policy(), e = evidence(), evidenceTransport = 'live_graph') {
  return evaluatePurchase({ offer: o, policy: p, evidence: e, evidenceTransport, now: NOW });
}

test('BUY uses exact integer arithmetic beyond Number.MAX_SAFE_INTEGER', () => {
  const result = decide();
  assert.equal(result.decision, 'BUY');
  assert.equal(result.budgetAfterAtomic, '654');
  assert.deepEqual(result.reasons, ['POLICY_SATISFIED']);
  assert.equal(result.authority.payment, false);
  assert.equal(result.qualification.liveGraphEvidence, true);
});

test('fixture cannot satisfy a live-data-required policy', () => {
  const result = decide(offer(), policy(), evidence({ sourceMode: 'fixture' }));
  assert.equal(result.decision, 'HOLD');
  assert(result.reasons.includes('LIVE_EVIDENCE_REQUIRED'));
  assert.equal(result.qualification.prizeEligibilityClaimed, false);
});

test('fixture transport cannot spoof live authority by declaring sourceMode live_graph', () => {
  const result = decide(offer(), policy(), evidence({ sourceMode: 'live_graph' }), 'fixture');
  assert.equal(result.decision, 'HOLD');
  assert(result.reasons.includes('LIVE_EVIDENCE_REQUIRED'));
  assert.equal(result.qualification.evidenceTransport, 'fixture');
  assert.equal(result.qualification.declaredSourceMode, 'live_graph');
  assert.equal(result.qualification.liveGraphEvidence, false);
  assert.equal(result.qualification.fixtureOnly, true);
});

test('omitted transport provenance is untrusted and cannot qualify as live', () => {
  const result = evaluatePurchase({ offer: offer(), policy: policy(), evidence: evidence(), now: NOW });
  assert.equal(result.decision, 'HOLD');
  assert(result.reasons.includes('LIVE_EVIDENCE_REQUIRED'));
  assert.equal(result.qualification.evidenceTransport, 'untrusted');
  assert.equal(result.qualification.liveGraphEvidence, false);
});

test('live transport rejects evidence that declares fixture source mode', () => {
  const result = decide(offer(), policy(), evidence({ sourceMode: 'fixture' }), 'live_graph');
  assert.equal(result.decision, 'HOLD');
  assert(result.reasons.includes('LIVE_SOURCE_MODE_MISMATCH'));
  assert(result.reasons.includes('LIVE_EVIDENCE_REQUIRED'));
  assert.equal(result.qualification.liveGraphEvidence, false);
});

test('fixture CLI overrides a forged live source declaration out of band', () => {
  const dir = mkdtempSync(join(tmpdir(), 'graph-policy-fixture-'));
  try {
    const offerPath = join(dir, 'offer.json');
    const policyPath = join(dir, 'policy.json');
    const evidencePath = join(dir, 'evidence.json');
    writeFileSync(offerPath, JSON.stringify(offer()));
    writeFileSync(policyPath, JSON.stringify(policy()));
    writeFileSync(evidencePath, JSON.stringify(evidence({ sourceMode: 'live_graph' })));
    const cliPath = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [
      cliPath, 'fixture', '--offer', offerPath, '--policy', policyPath, '--evidence', evidencePath, '--now', NOW,
    ], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const receipt = JSON.parse(run.stdout);
    assert.equal(receipt.decision, 'HOLD');
    assert(receipt.reasons.includes('LIVE_EVIDENCE_REQUIRED'));
    assert.equal(receipt.qualification.evidenceTransport, 'fixture');
    assert.equal(receipt.qualification.declaredSourceMode, 'live_graph');
    assert.equal(receipt.qualification.liveGraphEvidence, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('authority timestamps require an explicit RFC3339 timezone', () => {
  assert.throws(
    () => evaluatePurchase({ offer: offer(), policy: policy(), evidence: evidence(), evidenceTransport: 'live_graph', now: '2026-09-13T09:40:00' }),
    (error) => error.code === 'NOW_INVALID',
  );
  const badEvidence = decide(offer(), policy(), evidence({ capturedAt: '2026-09-13T09:39:55' }));
  assert.equal(badEvidence.decision, 'HOLD');
  assert(badEvidence.reasons.includes('EVIDENCE_INVALID:EVIDENCE_CAPTURED_AT'));
});

test('explicit-offset decision digest is identical across host timezones', () => {
  const moduleUrl = new URL('../src/policy.mjs', import.meta.url).href;
  const input = {
    offer: offer(),
    policy: policy(),
    evidence: evidence({ capturedAt: '2026-09-13T05:39:55-04:00' }),
    evidenceTransport: 'live_graph',
    now: '2026-09-13T05:40:00-04:00',
  };
  const program = `import { evaluatePurchase } from ${JSON.stringify(moduleUrl)}; const input = ${JSON.stringify(input)}; process.stdout.write(evaluatePurchase(input).receiptDigest);`;
  const run = (TZ) => spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    encoding: 'utf8', env: { ...process.env, TZ },
  });
  const utc = run('UTC');
  const ny = run('America/New_York');
  assert.equal(utc.status, 0, utc.stderr);
  assert.equal(ny.status, 0, ny.stderr);
  assert.equal(utc.stdout, ny.stdout);
  assert.match(utc.stdout, /^[0-9a-f]{64}$/);
});

test('seller identity mismatch is HOLD, not SKIP', () => {
  const result = decide(offer({ sellerAgentId: '84532:78' }));
  assert.equal(result.decision, 'HOLD');
  assert(result.reasons.includes('SELLER_EVIDENCE_MISMATCH'));
});

test('trusted agent evidence cannot authorize an unrelated paid service origin', () => {
  const result = decide(offer({ serviceUrl: 'https://attacker.example/x402/report' }));
  assert.equal(result.decision, 'HOLD');
  assert(result.reasons.includes('SERVICE_ORIGIN_UNBOUND'));
  assert.deepEqual(result.metrics.matchedEndpointKinds, []);
});

test('registered service origin binds a different HTTPS route on that origin', () => {
  const result = decide(offer({ serviceUrl: 'https://seller.example/v2/paid-report' }));
  assert.equal(result.decision, 'BUY');
  assert.equal(result.metrics.serviceOrigin, 'https://seller.example');
  assert.deepEqual(result.metrics.matchedEndpointKinds, ['web']);
});

test('offer service URL must be canonical HTTPS without credentials or fragment', () => {
  assert.throws(() => decide(offer({ serviceUrl: 'http://seller.example/report' })), (error) => error.code === 'OFFER_SERVICE_URL');
  assert.throws(() => decide(offer({ serviceUrl: 'https://user:pass@seller.example/report' })), (error) => error.code === 'OFFER_SERVICE_URL');
  assert.throws(() => decide(offer({ serviceUrl: 'https://seller.example/report#frag' })), (error) => error.code === 'OFFER_SERVICE_URL');
});

test('malformed registered endpoint metadata makes evidence HOLD', () => {
  const result = decide(offer(), policy(), evidence({ agent: { registration: { webEndpoint: 'http://seller.example/' } } }));
  assert.equal(result.decision, 'HOLD');
  assert(result.reasons.includes('EVIDENCE_INVALID:REGISTRATION_WEB_ENDPOINT'));
});

test('stale capture and stale Graph block both fail closed', () => {
  const result = decide(offer(), policy(), evidence({
    capturedAt: '2026-09-13T09:00:00.000Z',
    graph: { blockTimestamp: String(NOW_S - 4000) },
  }));
  assert.equal(result.decision, 'HOLD');
  assert(result.reasons.includes('CAPTURE_STALE'));
  assert(result.reasons.includes('GRAPH_BLOCK_STALE'));
});

test('future Graph block is HOLD', () => {
  const result = decide(offer(), policy(), evidence({ graph: { blockTimestamp: String(NOW_S + 120) } }));
  assert.equal(result.decision, 'HOLD');
  assert(result.reasons.includes('GRAPH_BLOCK_FROM_FUTURE'));
});

test('indexing errors are HOLD', () => {
  const result = decide(offer(), policy(), evidence({ graph: { hasIndexingErrors: true } }));
  assert.equal(result.decision, 'HOLD');
  assert(result.reasons.includes('GRAPH_INDEXING_ERRORS'));
});

test('conflicting duplicate feedback IDs are HOLD', () => {
  const rows = evidence().agent.feedback;
  const result = decide(offer(), policy(), evidence({ agent: { feedback: [...rows, { ...rows[0], score: 1 }] } }));
  assert.equal(result.decision, 'HOLD');
  assert(result.reasons.includes('EVIDENCE_INVALID:CONFLICTING_FEEDBACK_DUPLICATE'));
});

test('exact duplicate evidence rows collapse deterministically', () => {
  const rows = evidence().agent.feedback;
  const a = decide(offer(), policy(), evidence({ agent: { feedback: [rows[0], rows[1], rows[0]] } }));
  const b = decide(offer(), policy(), evidence({ agent: { feedback: [rows[1], rows[0]] } }));
  assert.equal(a.decision, 'BUY');
  assert.equal(a.receiptDigest, b.receiptDigest);
});

test('order of independent evidence rows does not change receipt', () => {
  const rows = evidence().agent.feedback;
  const a = decide(offer(), policy(), evidence({ agent: { feedback: rows } }));
  const b = decide(offer(), policy(), evidence({ agent: { feedback: [...rows].reverse() } }));
  assert.equal(a.receiptDigest, b.receiptDigest);
});

test('price over exact budget SKIPs without mutating budget', () => {
  const result = decide(offer({ priceAtomic: '900719925474099313000' }), policy({ maxPriceAtomic: '900719925474099313500' }));
  assert.equal(result.decision, 'SKIP');
  assert(result.reasons.includes('PRICE_ABOVE_BUDGET'));
  assert.equal(result.budgetAfterAtomic, policy().budgetRemainingAtomic);
});

test('currency mismatch SKIPs', () => {
  const result = decide(offer({ currency: 'USDC_ATOMIC' }));
  assert.equal(result.decision, 'SKIP');
  assert(result.reasons.includes('CURRENCY_NOT_ALLOWED'));
});

test('inactive or non-x402 seller SKIPs', () => {
  const result = decide(offer(), policy(), evidence({ agent: { registration: { active: false, x402Support: false } } }));
  assert.equal(result.decision, 'SKIP');
  assert(result.reasons.includes('SELLER_INACTIVE'));
  assert(result.reasons.includes('X402_UNSUPPORTED'));
});

test('trust-model mismatch SKIPs', () => {
  const result = decide(offer(), policy(), evidence({ agent: { registration: { supportedTrusts: ['cryptoeconomic'] } } }));
  assert.equal(result.decision, 'SKIP');
  assert(result.reasons.includes('TRUST_MODEL_UNSATISFIED'));
});

test('low feedback and validation quality SKIPs', () => {
  const e = evidence({ agent: {
    feedback: [{ id: 'f1', score: 20, clientAddress: '0xc', createdAt: String(NOW_S - 1), proofOfPaymentTxHash: null }],
    validations: [{ id: 'v1', validatorAddress: '0xv', response: 20, status: 'COMPLETED', createdAt: String(NOW_S - 1) }],
  } });
  const result = decide(offer(), policy(), e);
  assert.equal(result.decision, 'SKIP');
  assert(result.reasons.includes('INSUFFICIENT_FEEDBACK'));
  assert(result.reasons.includes('AVERAGE_FEEDBACK_SCORE_BELOW_MINIMUM'));
  assert(result.reasons.includes('INSUFFICIENT_PAID_FEEDBACK'));
  assert(result.reasons.includes('AVERAGE_VALIDATION_SCORE_BELOW_MINIMUM'));
});

test('future feedback is HOLD even when averages would pass', () => {
  const rows = evidence().agent.feedback;
  const result = decide(offer(), policy(), evidence({ agent: { feedback: [{ ...rows[0], createdAt: String(NOW_S + 100) }, rows[1]] } }));
  assert.equal(result.decision, 'HOLD');
  assert(result.reasons.includes('FEEDBACK_FROM_FUTURE'));
});

test('live adapter strips API-key path from sourceRef and maps Agent0 data', async () => {
  let requestedUrl;
  const fakeFetch = async (url, options) => {
    requestedUrl = String(url);
    assert.match(options.body, /PurchasePolicyAgent/);
    return {
      ok: true,
      async json() {
        return { data: {
          _meta: { deployment: 'QmDep', hasIndexingErrors: false, block: { number: '9', hash: '0x9', timestamp: String(NOW_S - 1) } },
          agent: {
            id: '84532:77', chainId: '84532', agentId: '77', owner: '0xo', updatedAt: String(NOW_S - 4), lastActivity: String(NOW_S - 2),
            registrationFile: { active: true, x402Support: true, supportedTrusts: ['reputation'], webEndpoint: 'https://seller.example/', mcpEndpoint: null, a2aEndpoint: null },
            feedback: [{ id: 'f', score: 99, clientAddress: '0xc', createdAt: String(NOW_S - 3), feedbackFile: { proofOfPaymentTxHash: '0xp' } }],
            validations: [{ id: 'v', validatorAddress: '0xv', response: 90, status: 'COMPLETED', createdAt: String(NOW_S - 3) }],
          },
        } };
      },
    };
  };
  const e = await fetchLiveAgentEvidence({
    endpoint: 'https://gateway.thegraph.com/api/SECRET_KEY_VALUE/subgraphs/id/QmSubgraph',
    agentId: '84532:77',
    capturedAt: NOW,
    fetchImpl: fakeFetch,
  });
  assert(requestedUrl.includes('SECRET_KEY_VALUE'));
  assert.equal(e.sourceRef, 'https://gateway.thegraph.com/subgraphs/id/QmSubgraph');
  assert(!JSON.stringify(e).includes('SECRET_KEY_VALUE'));
  assert.equal(e.sourceMode, 'live_graph');
  assert.equal(e.agent.feedback[0].score, 99);
  assert.equal(e.agent.registration.webEndpoint, 'https://seller.example/');
});

test('live adapter refuses non-The-Graph or non-HTTPS endpoints before I/O', async () => {
  let calls = 0;
  const fakeFetch = async () => { calls += 1; throw new Error('should not run'); };
  await assert.rejects(
    fetchLiveAgentEvidence({ endpoint: 'http://127.0.0.1:8000/subgraphs/id/x', agentId: '84532:77', fetchImpl: fakeFetch }),
    (error) => error.code === 'GRAPH_ENDPOINT_HTTPS_REQUIRED',
  );
  await assert.rejects(
    fetchLiveAgentEvidence({ endpoint: 'https://evil.example/subgraphs/id/x', agentId: '84532:77', fetchImpl: fakeFetch }),
    (error) => error.code === 'GRAPH_ENDPOINT_PROVIDER_NOT_ALLOWED',
  );
  assert.equal(calls, 0);
});


test('live adapter rejects structurally missing authority fields instead of coercing them', async () => {
  const fakeFetch = async () => ({
    ok: true,
    async json() {
      return { data: {
        _meta: { deployment: 'QmDep', hasIndexingErrors: false, block: { number: '9', hash: '0x9', timestamp: String(NOW_S - 1) } },
        agent: {
          id: '84532:77', chainId: '84532', agentId: '77', owner: '0xo', updatedAt: String(NOW_S - 4), lastActivity: String(NOW_S - 2),
          registrationFile: { x402Support: true, supportedTrusts: ['reputation'], webEndpoint: 'https://seller.example/', mcpEndpoint: null, a2aEndpoint: null },
          feedback: [], validations: [],
        },
      } };
    },
  });
  await assert.rejects(
    fetchLiveAgentEvidence({ endpoint: 'https://gateway.thegraph.com/api/key/subgraphs/id/x', agentId: '84532:77', fetchImpl: fakeFetch }),
    (error) => error.code === 'GRAPH_REGISTRATION_ACTIVE',
  );
});

test('live adapter fails closed on GraphQL errors', async () => {
  const fakeFetch = async () => ({ ok: true, async json() { return { data: {}, errors: [{ message: 'bad query' }] }; } });
  await assert.rejects(
    fetchLiveAgentEvidence({ endpoint: 'https://gateway.thegraph.com/api/key/subgraphs/id/x', agentId: '84532:77', fetchImpl: fakeFetch }),
    (error) => error.code === 'GRAPH_GRAPHQL_ERROR',
  );
});
