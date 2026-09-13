import { requestHeadersOnly, requestJson, validateEndpoint } from './http-client.mjs';
import { scrubSecrets, sha256Canonical } from './canonical.mjs';

export const DEFAULT_MIN_PROTOCOL_VERSION = '2025-11-25';
export const LAST_HANDSHAKE_PROTOCOL_VERSION = '2025-11-25';
const IMPOSSIBLE_OLD_VERSION = '1900-01-01';
const POST_ACCEPT = 'application/json, text/event-stream';

function versionAtLeast(actual, minimum) {
  return /^\d{4}-\d{2}-\d{2}$/.test(actual) && /^\d{4}-\d{2}-\d{2}$/.test(minimum) && actual >= minimum;
}

function rpc(id, method, params = {}) { return { jsonrpc: '2.0', id, method, params }; }
function note(method, params = {}) { return { jsonrpc: '2.0', method, params }; }
function check(id, status, detail = {}) { return { id, status, detail }; }
function pass(id, detail) { return check(id, 'PASS', detail); }
function fail(id, detail) { return check(id, 'FAIL', detail); }
function warn(id, detail) { return check(id, 'WARN', detail); }
function skip(id, detail) { return check(id, 'SKIP', detail); }

function baseHeaders(authorizationHeader) {
  return {
    'content-type': 'application/json',
    accept: POST_ACCEPT,
    ...(authorizationHeader ? { authorization: authorizationHeader } : {}),
  };
}

function sessionHeaders(authorizationHeader, sessionId, protocolVersion) {
  return {
    ...baseHeaders(authorizationHeader),
    ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    'mcp-protocol-version': protocolVersion,
  };
}

function transportFailure(id, error) {
  return fail(id, { code: error?.code ?? 'ERROR', message: error?.message ?? String(error), ...(error?.details ?? {}) });
}

async function safeJson(checks, id, request) {
  try { return await requestJson(request); }
  catch (error) { checks.push(transportFailure(id, error)); return null; }
}

export async function probeMcpEndpoint(options) {
  const endpoint = validateEndpoint(options?.endpoint).toString();
  const minimumProtocolVersion = options?.minimumProtocolVersion ?? DEFAULT_MIN_PROTOCOL_VERSION;
  const timeoutMs = options?.timeoutMs ?? 3_000;
  const maxResponseBytes = options?.maxResponseBytes ?? 256 * 1024;
  const maxRttMs = options?.maxRttMs ?? null;
  const requireSession = options?.requireSession ?? false;
  const requireTools = options?.requireTools ?? false;
  const terminateSession = options?.terminateSession ?? true;
  const authorizationHeader = options?.authorizationHeader ?? null;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be finite and > 0');
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1024) throw new TypeError('maxResponseBytes must be an integer >= 1024');
  if (maxRttMs !== null && (!Number.isFinite(maxRttMs) || maxRttMs <= 0)) throw new TypeError('maxRttMs must be null or finite and > 0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(minimumProtocolVersion)) throw new TypeError('minimumProtocolVersion must be YYYY-MM-DD');

  const checks = [];
  const timings = [];
  const request = (args) => ({ url: endpoint, timeoutMs, maxResponseBytes, ...args });
  const recordTiming = (name, result) => { if (result) timings.push({ name, elapsedMs: Math.round(result.elapsedMs * 100) / 100 }); };

  const init = await safeJson(checks, 'initialize-transport', request({
    headers: baseHeaders(authorizationHeader),
    body: rpc(1, 'initialize', {
      protocolVersion: IMPOSSIBLE_OLD_VERSION,
      capabilities: {},
      clientInfo: { name: 'mcp-streamable-http-conformance', version: '0.1.0' },
    }),
  }));
  recordTiming('initialize', init);
  if (!init) return finalize();

  const negotiated = init.body?.result?.protocolVersion;
  const sessionId = init.response.headers.get('mcp-session-id');
  const initOk = init.response.status === 200 && init.body?.jsonrpc === '2.0' && init.body?.id === 1 && typeof negotiated === 'string';
  checks.push(initOk ? pass('initialize-envelope', { httpStatus: init.response.status, negotiatedProtocolVersion: negotiated, sessionIssued: Boolean(sessionId) }) : fail('initialize-envelope', { httpStatus: init.response.status, errorCode: init.body?.error?.code ?? null }));
  if (!initOk) return finalize();
  checks.push(versionAtLeast(negotiated, minimumProtocolVersion)
    ? pass('protocol-minimum', { minimumProtocolVersion, negotiatedProtocolVersion: negotiated })
    : fail('protocol-minimum', { minimumProtocolVersion, negotiatedProtocolVersion: negotiated }));
  checks.push(versionAtLeast(LAST_HANDSHAKE_PROTOCOL_VERSION, negotiated)
    ? pass('handshake-era-version', { lastHandshakeProtocolVersion: LAST_HANDSHAKE_PROTOCOL_VERSION, negotiatedProtocolVersion: negotiated })
    : fail('handshake-era-version', { lastHandshakeProtocolVersion: LAST_HANDSHAKE_PROTOCOL_VERSION, negotiatedProtocolVersion: negotiated, reason: 'modern MCP revisions use a different lifecycle and require a modern-era probe' }));
  checks.push(negotiated !== IMPOSSIBLE_OLD_VERSION
    ? pass('version-negotiation', { requestedProtocolVersion: IMPOSSIBLE_OLD_VERSION, negotiatedProtocolVersion: negotiated })
    : fail('version-negotiation', { requestedProtocolVersion: IMPOSSIBLE_OLD_VERSION, negotiatedProtocolVersion: negotiated }));
  checks.push(sessionId
    ? pass('session-issued', { required: requireSession })
    : (requireSession ? fail('session-issued', { required: true }) : skip('session-issued', { required: false, reason: 'sessions are optional for stateless MCP servers' })));

  const headers = sessionHeaders(authorizationHeader, sessionId, negotiated);
  const initialized = await safeJson(checks, 'initialized-notification-transport', request({ headers, body: note('notifications/initialized') }));
  recordTiming('initialized', initialized);
  if (initialized) checks.push(initialized.response.status === 202 && initialized.body === null
    ? pass('initialized-notification', { httpStatus: 202 })
    : fail('initialized-notification', { httpStatus: initialized.response.status, bodyPresent: initialized.body !== null }));

  const ping = await safeJson(checks, 'ping-transport', request({ headers, body: rpc(2, 'ping') }));
  recordTiming('ping', ping);
  if (ping) checks.push(ping.response.status === 200 && ping.body?.jsonrpc === '2.0' && ping.body?.id === 2 && ping.body?.result && typeof ping.body.result === 'object'
    ? pass('ping', { httpStatus: 200 })
    : fail('ping', { httpStatus: ping.response.status, errorCode: ping.body?.error?.code ?? null }));

  const toolsCap = init.body?.result?.capabilities?.tools;
  if (toolsCap) {
    const tools = await safeJson(checks, 'tools-list-transport', request({ headers, body: rpc(3, 'tools/list') }));
    recordTiming('tools/list', tools);
    const toolNames = Array.isArray(tools?.body?.result?.tools) ? tools.body.result.tools.map((tool) => tool?.name).filter((name) => typeof name === 'string').sort() : [];
    if (tools) {
      const validList = tools.response.status === 200 && Array.isArray(tools.body?.result?.tools);
      const requirementMet = !requireTools || toolNames.length > 0;
      checks.push(validList && requirementMet
        ? pass('tools-discovery', { httpStatus: 200, toolCount: toolNames.length, toolNames, required: requireTools })
        : fail('tools-discovery', { httpStatus: tools.response.status, toolCount: toolNames.length, required: requireTools, errorCode: tools.body?.error?.code ?? null }));
    }
  } else checks.push(requireTools
    ? fail('tools-discovery', { required: true, reason: 'server did not advertise tools capability' })
    : skip('tools-discovery', { required: false, reason: 'server did not advertise tools capability' }));

  const resourcesCap = init.body?.result?.capabilities?.resources;
  if (resourcesCap) {
    const resources = await safeJson(checks, 'resources-list-transport', request({ headers, body: rpc(4, 'resources/list') }));
    recordTiming('resources/list', resources);
    const uris = Array.isArray(resources?.body?.result?.resources) ? resources.body.result.resources.map((item) => item?.uri).filter((uri) => typeof uri === 'string').sort() : [];
    if (resources) checks.push(resources.response.status === 200 && Array.isArray(resources.body?.result?.resources)
      ? pass('resources-discovery', { httpStatus: 200, resourceCount: uris.length, resourceUris: uris })
      : fail('resources-discovery', { httpStatus: resources.response.status, errorCode: resources.body?.error?.code ?? null }));
  } else checks.push(skip('resources-discovery', { reason: 'server did not advertise resources capability' }));

  const unknown = await safeJson(checks, 'unknown-method-transport', request({ headers, body: rpc(5, 'conformance/unknown-method') }));
  recordTiming('unknown-method', unknown);
  if (unknown) checks.push(unknown.response.status === 200 && unknown.body?.error?.code === -32601
    ? pass('jsonrpc-method-not-found', { httpStatus: 200, errorCode: -32601 })
    : fail('jsonrpc-method-not-found', { httpStatus: unknown.response.status, errorCode: unknown.body?.error?.code ?? null }));

  const invalidOrigin = await safeJson(checks, 'invalid-origin-transport', request({
    headers: { ...baseHeaders(authorizationHeader), origin: 'https://mcp-conformance.invalid' },
    body: rpc(6, 'initialize', { protocolVersion: minimumProtocolVersion, capabilities: {}, clientInfo: { name: 'origin-probe', version: '0.1.0' } }),
  }));
  recordTiming('invalid-origin', invalidOrigin);
  if (invalidOrigin) checks.push(invalidOrigin.response.status === 403
    ? pass('invalid-origin-rejected', { httpStatus: 403 })
    : fail('invalid-origin-rejected', { httpStatus: invalidOrigin.response.status }));

  try {
    const get = await requestHeadersOnly({ url: endpoint, method: 'GET', timeoutMs, headers: {
      accept: 'text/event-stream',
      ...(authorizationHeader ? { authorization: authorizationHeader } : {}),
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      'mcp-protocol-version': negotiated,
    } });
    recordTiming('GET', get);
    const sseOk = get.response.status === 200 && /^text\/event-stream(?:;|$)/i.test(get.contentType ?? '');
    const noSseOk = get.response.status === 405;
    checks.push(sseOk || noSseOk
      ? pass('get-stream-contract', { httpStatus: get.response.status, mode: sseOk ? 'sse' : 'not-supported' })
      : fail('get-stream-contract', { httpStatus: get.response.status, contentType: get.contentType }));
  } catch (error) { checks.push(transportFailure('get-stream-contract', error)); }

  if (sessionId) {
    const noSession = await safeJson(checks, 'missing-session-transport', request({ headers: { ...baseHeaders(authorizationHeader), 'mcp-protocol-version': negotiated }, body: rpc(7, 'ping') }));
    recordTiming('missing-session', noSession);
    if (noSession) checks.push(noSession.response.status === 400
      ? pass('missing-session-status', { httpStatus: 400, normativeStrength: 'SHOULD' })
      : warn('missing-session-status', { httpStatus: noSession.response.status, normativeStrength: 'SHOULD', expected: 400 }));

    const wrongVersion = await safeJson(checks, 'wrong-protocol-transport', request({ headers: { ...headers, 'mcp-protocol-version': IMPOSSIBLE_OLD_VERSION }, body: rpc(8, 'ping') }));
    recordTiming('wrong-protocol', wrongVersion);
    if (wrongVersion) checks.push(wrongVersion.response.status >= 400
      ? pass('wrong-protocol-rejected', { httpStatus: wrongVersion.response.status })
      : warn('wrong-protocol-rejected', { httpStatus: wrongVersion.response.status, reason: 'server accepted a non-negotiated protocol header' }));
  } else {
    checks.push(skip('missing-session-status', { reason: 'server did not issue a session' }));
    checks.push(skip('wrong-protocol-rejected', { reason: 'no session-bound request to test' }));
  }

  if (maxRttMs !== null) {
    const observed = timings.filter(({ name }) => ['initialize', 'ping', 'tools/list'].includes(name)).map(({ elapsedMs }) => elapsedMs);
    const maxObserved = observed.length ? Math.max(...observed) : Infinity;
    checks.push(maxObserved <= maxRttMs
      ? pass('rtt-budget', { maxRttMs })
      : fail('rtt-budget', { maxRttMs }));
  } else checks.push(skip('rtt-budget', { reason: 'no maxRttMs configured' }));

  if (sessionId && terminateSession) {
    const deleted = await safeJson(checks, 'session-delete-transport', request({ method: 'DELETE', headers, body: undefined }));
    recordTiming('DELETE', deleted);
    if (deleted) {
      const accepted = deleted.response.status === 204 || deleted.response.status === 200;
      const unsupported = deleted.response.status === 405;
      checks.push(accepted || unsupported
        ? pass('session-delete', { httpStatus: deleted.response.status, supported: accepted })
        : fail('session-delete', { httpStatus: deleted.response.status }));
      if (accepted) {
        const afterDelete = await safeJson(checks, 'post-delete-transport', request({ headers, body: rpc(9, 'ping') }));
        recordTiming('post-delete', afterDelete);
        if (afterDelete) checks.push(afterDelete.response.status === 404
          ? pass('deleted-session-not-found', { httpStatus: 404 })
          : warn('deleted-session-not-found', { httpStatus: afterDelete.response.status, expected: 404 }));
      } else checks.push(skip('deleted-session-not-found', { reason: 'server does not support client session termination' }));
    }
  } else {
    checks.push(skip('session-delete', { reason: sessionId ? 'terminateSession=false' : 'server did not issue a session' }));
    checks.push(skip('deleted-session-not-found', { reason: 'no deleted session to verify' }));
  }

  return finalize();

  function finalize() {
    const secrets = [authorizationHeader, authorizationHeader?.replace(/^Bearer\s+/i, '')].filter(Boolean);
    const semanticChecks = checks.map(({ id, status, detail }) => ({ id, status, detail }));
    const summary = {
      pass: semanticChecks.filter(({ status }) => status === 'PASS').length,
      fail: semanticChecks.filter(({ status }) => status === 'FAIL').length,
      warn: semanticChecks.filter(({ status }) => status === 'WARN').length,
      skip: semanticChecks.filter(({ status }) => status === 'SKIP').length,
    };
    summary.ok = summary.fail === 0;
    const evidence = {
      schema: 'public-commons.mcp-streamable-http-conformance/v1',
      endpointOrigin: new URL(endpoint).origin,
      endpointPath: new URL(endpoint).pathname,
      minimumProtocolVersion,
      authenticated: Boolean(authorizationHeader),
      requireSession,
      requireTools,
      checks: semanticChecks,
      summary,
    };
    const scrubbedEvidence = scrubSecrets(evidence, secrets);
    const report = {
      ...scrubbedEvidence,
      capturedAt: new Date().toISOString(),
      timings,
      evidenceSha256: sha256Canonical(scrubbedEvidence),
    };
    return scrubSecrets(report, secrets);
  }
}
