import { ContractError, contractAssert, digestObject, requireString } from './canonical.mjs';

export const AGENT0_PURCHASE_POLICY_QUERY = `
query PurchasePolicyAgent($id: ID!, $feedbackFirst: Int!, $validationFirst: Int!) {
  _meta {
    deployment
    hasIndexingErrors
    block { number hash timestamp }
  }
  agent(id: $id) {
    id
    chainId
    agentId
    owner
    updatedAt
    lastActivity
    registrationFile {
      active
      x402Support
      supportedTrusts
      webEndpoint
      mcpEndpoint
      a2aEndpoint
    }
    feedback(where: { isRevoked: false }, first: $feedbackFirst, orderBy: createdAt, orderDirection: desc) {
      id
      score
      clientAddress
      createdAt
      feedbackFile { proofOfPaymentTxHash }
    }
    validations(first: $validationFirst, orderBy: createdAt, orderDirection: desc) {
      id
      validatorAddress
      response
      status
      createdAt
    }
  }
}`;

function safeSourceRef(url) {
  const marker = '/subgraphs/id/';
  const index = url.pathname.indexOf(marker);
  if (index === -1) return url.origin;
  const tail = url.pathname.slice(index + marker.length).split('/')[0];
  contractAssert(tail.length > 0, 'GRAPH_ENDPOINT_SUBGRAPH_ID_REQUIRED');
  return `${url.origin}${marker}${tail}`;
}

function validateEndpoint(raw) {
  requireString(raw, 'GRAPH_ENDPOINT', { maxLength: 4096 });
  let url;
  try { url = new URL(raw); } catch { throw new ContractError('GRAPH_ENDPOINT_INVALID'); }
  contractAssert(url.protocol === 'https:', 'GRAPH_ENDPOINT_HTTPS_REQUIRED');
  contractAssert(!url.username && !url.password, 'GRAPH_ENDPOINT_URL_CREDENTIALS_FORBIDDEN');
  contractAssert(url.hostname === 'gateway.thegraph.com', 'GRAPH_ENDPOINT_PROVIDER_NOT_ALLOWED');
  contractAssert(url.pathname.includes('/subgraphs/id/'), 'GRAPH_ENDPOINT_SUBGRAPH_ID_REQUIRED');
  return url;
}

function asString(value, code) {
  contractAssert(value !== null && value !== undefined, code);
  return String(value);
}

function asBoolean(value, code) {
  contractAssert(typeof value === 'boolean', code);
  return value;
}

function asArray(value, code) {
  contractAssert(Array.isArray(value), code);
  return value;
}

function asNullableString(value, code) {
  if (value === null) return null;
  return asString(value, code);
}

export async function fetchLiveAgentEvidence({
  endpoint,
  agentId,
  feedbackFirst = 50,
  validationFirst = 50,
  capturedAt = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
  timeoutMs = 12_000,
}) {
  const url = validateEndpoint(endpoint);
  requireString(agentId, 'GRAPH_AGENT_ID', { maxLength: 96 });
  contractAssert(Number.isSafeInteger(feedbackFirst) && feedbackFirst >= 1 && feedbackFirst <= 100, 'GRAPH_FEEDBACK_FIRST');
  contractAssert(Number.isSafeInteger(validationFirst) && validationFirst >= 1 && validationFirst <= 100, 'GRAPH_VALIDATION_FIRST');
  contractAssert(typeof fetchImpl === 'function', 'GRAPH_FETCH_UNAVAILABLE');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: AGENT0_PURCHASE_POLICY_QUERY, variables: { id: agentId, feedbackFirst, validationFirst } }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new ContractError('GRAPH_REQUEST_TIMEOUT');
    throw new ContractError('GRAPH_REQUEST_FAILED');
  } finally {
    clearTimeout(timer);
  }
  contractAssert(response && response.ok === true, 'GRAPH_HTTP_FAILURE');
  let payload;
  try { payload = await response.json(); } catch { throw new ContractError('GRAPH_RESPONSE_NOT_JSON'); }
  contractAssert(payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object', 'GRAPH_RESPONSE_MALFORMED');
  const nonIndexingErrors = Array.isArray(payload.errors) ? payload.errors.filter((error) => error?.message !== 'indexing_error') : [];
  contractAssert(nonIndexingErrors.length === 0, 'GRAPH_GRAPHQL_ERROR');
  const { _meta: meta, agent } = payload.data;
  contractAssert(meta && meta.block && agent && agent.registrationFile, 'GRAPH_AGENT_OR_META_MISSING');
  contractAssert(agent.id === agentId, 'GRAPH_AGENT_ID_MISMATCH');

  const feedback = asArray(agent.feedback, 'GRAPH_FEEDBACK_ARRAY').map((row) => ({
    id: asString(row.id, 'GRAPH_FEEDBACK_ID'),
    score: Number(row.score),
    clientAddress: asString(row.clientAddress, 'GRAPH_FEEDBACK_CLIENT'),
    createdAt: asString(row.createdAt, 'GRAPH_FEEDBACK_CREATED_AT'),
    proofOfPaymentTxHash: row.feedbackFile?.proofOfPaymentTxHash ? String(row.feedbackFile.proofOfPaymentTxHash) : null,
  }));
  const validations = asArray(agent.validations, 'GRAPH_VALIDATIONS_ARRAY').map((row) => ({
    id: asString(row.id, 'GRAPH_VALIDATION_ID'),
    validatorAddress: asString(row.validatorAddress, 'GRAPH_VALIDATION_VALIDATOR'),
    response: Number(row.response ?? 0),
    status: asString(row.status, 'GRAPH_VALIDATION_STATUS'),
    createdAt: asString(row.createdAt, 'GRAPH_VALIDATION_CREATED_AT'),
  }));
  const rawDigest = digestObject(payload.data);

  return {
    schema: 'graph-agent-evidence/v1',
    sourceMode: 'live_graph',
    capturedAt: new Date(capturedAt).toISOString(),
    sourceRef: safeSourceRef(url),
    rawDigest,
    graph: {
      deployment: asString(meta.deployment, 'GRAPH_DEPLOYMENT'),
      blockNumber: asString(meta.block.number, 'GRAPH_BLOCK_NUMBER'),
      blockHash: asString(meta.block.hash, 'GRAPH_BLOCK_HASH'),
      blockTimestamp: asString(meta.block.timestamp, 'GRAPH_BLOCK_TIMESTAMP'),
      hasIndexingErrors: asBoolean(meta.hasIndexingErrors, 'GRAPH_INDEXING_ERRORS'),
    },
    agent: {
      id: asString(agent.id, 'GRAPH_AGENT_ID'),
      chainId: asString(agent.chainId, 'GRAPH_CHAIN_ID'),
      agentId: asString(agent.agentId, 'GRAPH_NUMERIC_AGENT_ID'),
      owner: asString(agent.owner, 'GRAPH_AGENT_OWNER'),
      updatedAt: asString(agent.updatedAt, 'GRAPH_AGENT_UPDATED_AT'),
      lastActivity: asString(agent.lastActivity, 'GRAPH_AGENT_LAST_ACTIVITY'),
      registration: {
        active: asBoolean(agent.registrationFile.active, 'GRAPH_REGISTRATION_ACTIVE'),
        x402Support: asBoolean(agent.registrationFile.x402Support, 'GRAPH_REGISTRATION_X402'),
        supportedTrusts: asArray(agent.registrationFile.supportedTrusts, 'GRAPH_REGISTRATION_TRUSTS').map(String),
        webEndpoint: asNullableString(agent.registrationFile.webEndpoint, 'GRAPH_REGISTRATION_WEB_ENDPOINT'),
        mcpEndpoint: asNullableString(agent.registrationFile.mcpEndpoint, 'GRAPH_REGISTRATION_MCP_ENDPOINT'),
        a2aEndpoint: asNullableString(agent.registrationFile.a2aEndpoint, 'GRAPH_REGISTRATION_A2A_ENDPOINT'),
      },
      feedback,
      validations,
    },
  };
}
