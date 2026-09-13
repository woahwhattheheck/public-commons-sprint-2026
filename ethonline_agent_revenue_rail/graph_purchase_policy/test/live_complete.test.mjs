import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchCompleteLiveAgentEvidence,
  LIVE_EVIDENCE_ROW_LIMIT,
} from '../src/live_complete.mjs';

const ENDPOINT = 'https://gateway.thegraph.com/api/test-only-key/subgraphs/id/QmSubgraph';
const AGENT_ID = '84532:77';

function payload({ feedbackCount = 0, validationCount = 0 } = {}) {
  return {
    data: {
      _meta: {
        deployment: 'QmDeployment',
        hasIndexingErrors: false,
        block: { number: '123', hash: '0xabc', timestamp: '1789292400' },
      },
      agent: {
        id: AGENT_ID,
        chainId: '84532',
        agentId: '77',
        owner: '0xowner',
        updatedAt: '1789292390',
        lastActivity: '1789292395',
        registrationFile: {
          active: true,
          x402Support: true,
          supportedTrusts: ['reputation'],
          webEndpoint: 'https://seller.example/',
          mcpEndpoint: null,
          a2aEndpoint: null,
        },
        feedback: Array.from({ length: feedbackCount }, (_, index) => ({
          id: `feedback-${index}`,
          score: '90',
          clientAddress: `0xclient${index}`,
          createdAt: String(1789292300 - index),
          feedbackFile: { proofOfPaymentTxHash: index === 0 ? '0xpaid' : null },
        })),
        validations: Array.from({ length: validationCount }, (_, index) => ({
          id: `validation-${index}`,
          validatorAddress: `0xvalidator${index}`,
          response: '90',
          status: 'COMPLETED',
          createdAt: String(1789292200 - index),
        })),
      },
    },
  };
}

function fakeFetch(body, observations = []) {
  return async (_url, init) => {
    const request = JSON.parse(init.body);
    observations.push(request.variables);
    return {
      ok: true,
      async json() { return body; },
    };
  };
}

function request(body, observations = []) {
  return fetchCompleteLiveAgentEvidence({
    endpoint: ENDPOINT,
    agentId: AGENT_ID,
    capturedAt: '2026-09-13T09:40:00.000Z',
    fetchImpl: fakeFetch(body, observations),
  });
}

test('live qualification requests the maximum bounded reputation window', async () => {
  const observations = [];
  const result = await request(payload({ feedbackCount: 99, validationCount: 99 }), observations);
  assert.equal(result.agent.feedback.length, 99);
  assert.equal(result.agent.validations.length, 99);
  assert.deepEqual(observations, [{
    id: AGENT_ID,
    feedbackFirst: LIVE_EVIDENCE_ROW_LIMIT,
    validationFirst: LIVE_EVIDENCE_ROW_LIMIT,
  }]);
});

test('a full feedback page cannot masquerade as complete seller reputation', async () => {
  await assert.rejects(
    request(payload({ feedbackCount: LIVE_EVIDENCE_ROW_LIMIT, validationCount: 1 })),
    (error) => error?.code === 'GRAPH_FEEDBACK_COMPLETENESS_UNPROVEN',
  );
});

test('a full validation page cannot masquerade as complete validation history', async () => {
  await assert.rejects(
    request(payload({ feedbackCount: 1, validationCount: LIVE_EVIDENCE_ROW_LIMIT })),
    (error) => error?.code === 'GRAPH_VALIDATION_COMPLETENESS_UNPROVEN',
  );
});

test('callers cannot lower the completeness fence by overriding relation limits', async () => {
  await assert.rejects(
    fetchCompleteLiveAgentEvidence({
      endpoint: ENDPOINT,
      agentId: AGENT_ID,
      feedbackFirst: 1,
      fetchImpl: fakeFetch(payload()),
    }),
    (error) => error?.code === 'GRAPH_COMPLETENESS_LIMIT_OVERRIDE_FORBIDDEN',
  );
});
