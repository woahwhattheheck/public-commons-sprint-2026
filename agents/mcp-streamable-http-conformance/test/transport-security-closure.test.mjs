import test from 'node:test';
import assert from 'node:assert/strict';
import { probeMcpEndpoint } from '../src/probe.mjs';

const INVALID_ORIGIN = 'https://mcp-conformance.invalid';
const PROTOCOL_VERSION = '2025-11-25';
const SESSION_ID = 'session-1';

function jsonResponse(body, status = 200, { contentType = 'application/json', headers = {} } = {}) {
  const responseHeaders = new Headers(headers);
  if (contentType !== null) responseHeaders.set('content-type', contentType);
  const encodedBody = new TextEncoder().encode(JSON.stringify(body));
  return new Response(encodedBody, { status, headers: responseHeaders });
}

function makeFetch({
  initializeContentType = 'application/json; charset=utf-8',
  responseContentTypes = {},
  invalidOriginGetStatus = 403,
  invalidOriginDeleteStatus = 403,
  expectedAuthorization = null,
} = {}) {
  const calls = [];
  let deleted = false;

  const fetchImpl = async (_url, init = {}) => {
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const origin = headers.get('origin');
    const authorization = headers.get('authorization');
    calls.push({ method, origin, authorization });

    if (expectedAuthorization !== null) assert.equal(authorization, expectedAuthorization);

    const invalidOrigin = origin === INVALID_ORIGIN;
    if (method === 'GET') {
      if (invalidOrigin) return new Response(null, { status: invalidOriginGetStatus });
      return new Response(null, { status: 405, headers: { allow: 'POST, DELETE' } });
    }

    if (method === 'DELETE') {
      if (invalidOrigin) return new Response(null, { status: invalidOriginDeleteStatus });
      if (headers.get('mcp-session-id') !== SESSION_ID || deleted) {
        return jsonResponse({ error: 'missing session' }, 404);
      }
      deleted = true;
      return new Response(null, { status: 204 });
    }

    const body = init.body === undefined ? null : JSON.parse(init.body);
    if (invalidOrigin) return jsonResponse({ error: 'invalid origin' }, 403);

    if (body?.method === 'initialize') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          serverInfo: { name: 'scripted-fixture', version: '1.0.0' },
        },
      }, 200, {
        contentType: Object.prototype.hasOwnProperty.call(responseContentTypes, 'initialize')
          ? responseContentTypes.initialize
          : initializeContentType,
        headers: { 'mcp-session-id': SESSION_ID },
      });
    }

    if (headers.get('mcp-protocol-version') === '1900-01-01') {
      return jsonResponse({ error: 'unsupported protocol version' }, 400);
    }

    if (body?.method !== 'notifications/initialized' && headers.get('mcp-session-id') !== SESSION_ID) {
      return jsonResponse({ error: 'missing session' }, 400);
    }

    if (body?.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }

    if (deleted) return jsonResponse({ error: 'missing session' }, 404);

    if (body?.method === 'ping') {
      return jsonResponse(
        { jsonrpc: '2.0', id: body.id, result: {} },
        200,
        { contentType: responseContentTypes.ping ?? 'application/json' },
      );
    }

    if (body?.method === 'conformance/unknown-method') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: 'Method not found' },
      }, 200, { contentType: responseContentTypes['conformance/unknown-method'] ?? 'application/json' });
    }

    throw new Error(`unexpected request: ${method} ${body?.method ?? '(none)'}`);
  };

  return { fetchImpl, calls };
}

async function withFetch(fetchImpl, action) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await action();
  } finally {
    globalThis.fetch = original;
  }
}

for (const contentType of ['text/plain', 'application/octet-stream', null]) {
  test(`rejects successful JSON-RPC response media type ${contentType ?? '(missing)'}`, { concurrency: false }, async () => {
    const scripted = makeFetch({ initializeContentType: contentType });
    const report = await withFetch(scripted.fetchImpl, () => probeMcpEndpoint({
      endpoint: 'http://fixture.invalid/mcp',
      requireSession: true,
    }));

    assert.equal(report.summary.ok, false);
    const failure = report.checks.find((item) => item.id === 'initialize-transport');
    assert.equal(failure.status, 'FAIL');
    assert.equal(failure.detail.code, 'INVALID_RESPONSE_MEDIA_TYPE');
    assert.equal(failure.detail.contentType, contentType);
    assert.deepEqual(failure.detail.allowed, ['application/json', 'text/event-stream']);
  });
}

test('rejects an illegal media type on a post-initialize JSON-RPC response', { concurrency: false }, async () => {
  const scripted = makeFetch({ responseContentTypes: { ping: 'text/plain' } });
  const report = await withFetch(scripted.fetchImpl, () => probeMcpEndpoint({
    endpoint: 'http://fixture.invalid/mcp',
    requireSession: true,
  }));

  assert.equal(report.summary.ok, false);
  const failure = report.checks.find((item) => item.id === 'ping-transport');
  assert.equal(failure.status, 'FAIL');
  assert.equal(failure.detail.code, 'INVALID_RESPONSE_MEDIA_TYPE');
  assert.equal(failure.detail.contentType, 'text/plain');
});

test('accepts application/json with parameters and completes the full probe', { concurrency: false }, async () => {
  const scripted = makeFetch();
  const report = await withFetch(scripted.fetchImpl, () => probeMcpEndpoint({
    endpoint: 'http://fixture.invalid/mcp',
    requireSession: true,
  }));

  assert.equal(report.summary.ok, true, JSON.stringify(report.checks, null, 2));
  assert.equal(report.checks.find((item) => item.id === 'get-stream-contract').detail.mode, 'not-supported');
  assert.equal(report.checks.find((item) => item.id === 'invalid-origin-established-get-rejected').status, 'PASS');
  assert.equal(report.checks.find((item) => item.id === 'invalid-origin-established-delete-rejected').status, 'PASS');
});

test('hostile-Origin GET and DELETE must be 403 even when ordinary GET is 405', { concurrency: false }, async () => {
  const scripted = makeFetch({
    invalidOriginGetStatus: 405,
    invalidOriginDeleteStatus: 204,
  });
  const report = await withFetch(scripted.fetchImpl, () => probeMcpEndpoint({
    endpoint: 'http://fixture.invalid/mcp',
    requireSession: true,
  }));

  assert.equal(report.summary.ok, false);
  assert.equal(report.checks.find((item) => item.id === 'get-stream-contract').status, 'PASS');

  const hostileGet = report.checks.find((item) => item.id === 'invalid-origin-established-get-rejected');
  assert.equal(hostileGet.status, 'FAIL');
  assert.equal(hostileGet.detail.httpStatus, 405);
  assert.equal(hostileGet.detail.expected, 403);
  assert.equal(hostileGet.detail.normalGetMode, 'not-supported');

  const hostileDelete = report.checks.find((item) => item.id === 'invalid-origin-established-delete-rejected');
  assert.equal(hostileDelete.status, 'FAIL');
  assert.equal(hostileDelete.detail.httpStatus, 204);
  assert.equal(hostileDelete.detail.expected, 403);
});

test('--no-delete skips both hostile-Origin and legitimate DELETE traffic', { concurrency: false }, async () => {
  const scripted = makeFetch();
  const report = await withFetch(scripted.fetchImpl, () => probeMcpEndpoint({
    endpoint: 'http://fixture.invalid/mcp',
    requireSession: true,
    terminateSession: false,
  }));

  assert.equal(report.summary.ok, true, JSON.stringify(report.checks, null, 2));
  assert.equal(report.checks.find((item) => item.id === 'invalid-origin-established-delete-rejected').status, 'SKIP');
  assert.equal(report.checks.find((item) => item.id === 'session-delete').status, 'SKIP');
  assert.equal(scripted.calls.some((call) => call.method === 'DELETE'), false);
});

test('bearer credentials on cleartext HTTP fail before any network request', { concurrency: false }, async () => {
  let networkCalls = 0;
  await withFetch(async () => {
    networkCalls += 1;
    throw new Error('network must not be reached');
  }, async () => {
    await assert.rejects(
      probeMcpEndpoint({
        endpoint: 'http://fixture.invalid/mcp',
        authorizationHeader: 'Bearer never-send-this',
      }),
      /authorizationHeader requires an https endpoint/,
    );
  });
  assert.equal(networkCalls, 0);
});

test('HTTPS bearer flow remains functional and secret-free in evidence', { concurrency: false }, async () => {
  const secret = 'transport-secret-9f15e7';
  const authorization = `Bearer ${secret}`;
  const scripted = makeFetch({ expectedAuthorization: authorization });
  const report = await withFetch(scripted.fetchImpl, () => probeMcpEndpoint({
    endpoint: 'https://fixture.invalid/mcp',
    authorizationHeader: authorization,
    requireSession: true,
  }));

  assert.equal(report.summary.ok, true, JSON.stringify(report.checks, null, 2));
  assert.equal(report.authenticated, true);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.ok(scripted.calls.length > 0);
  assert.equal(scripted.calls.every((call) => call.authorization === authorization), true);
});
