import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from '../src/http-client.mjs';
import { probeMcpEndpoint } from '../src/probe.mjs';

const INVALID_ORIGIN = 'https://mcp-conformance.invalid';
const PROTOCOL_VERSION = '2025-11-25';
const SESSION_ID = 'session-non-json-control';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function textResponse(status, body, contentType = 'text/plain') {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType },
  });
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

test('requestJson treats bounded non-200 non-JSON bodies as opaque', { concurrency: false }, async () => {
  for (const [status, body, contentType] of [
    [400, 'Bad Request', 'text/plain'],
    [403, '<html><body>denied</body></html>', 'text/html'],
    [404, 'missing', 'text/plain'],
  ]) {
    const result = await withFetch(
      async () => textResponse(status, body, contentType),
      () => requestJson({
        url: 'https://fixture.invalid/mcp',
        body: { jsonrpc: '2.0', id: 1, method: 'ping' },
        timeoutMs: 1_000,
        maxResponseBytes: 4_096,
      }),
    );
    assert.equal(result.response.status, status);
    assert.equal(result.body, null);
    assert.equal(result.responseMode, 'opaque');
  }
});

test('requestJson preserves strict HTTP 200 media and JSON enforcement', { concurrency: false }, async () => {
  await assert.rejects(
    withFetch(
      async () => textResponse(200, '{"jsonrpc":"2.0","id":1,"result":{}}'),
      () => requestJson({
        url: 'https://fixture.invalid/mcp',
        body: { jsonrpc: '2.0', id: 1, method: 'ping' },
        timeoutMs: 1_000,
        maxResponseBytes: 4_096,
      }),
    ),
    (error) => error?.code === 'RESPONSE_MEDIA_TYPE' && error?.details?.status === 200,
  );

  await assert.rejects(
    withFetch(
      async () => textResponse(200, 'not-json', 'application/json'),
      () => requestJson({
        url: 'https://fixture.invalid/mcp',
        body: { jsonrpc: '2.0', id: 1, method: 'ping' },
        timeoutMs: 1_000,
        maxResponseBytes: 4_096,
      }),
    ),
    (error) => error?.code === 'INVALID_JSON' && error?.details?.status === 200,
  );
});

test('non-200 opaque bodies remain byte bounded', { concurrency: false }, async () => {
  await assert.rejects(
    withFetch(
      async () => textResponse(403, 'x'.repeat(33), 'text/html'),
      () => requestJson({
        url: 'https://fixture.invalid/mcp',
        body: { jsonrpc: '2.0', id: 1, method: 'ping' },
        timeoutMs: 1_000,
        maxResponseBytes: 32,
      }),
    ),
    (error) => error?.code === 'BODY_LIMIT' && error?.details?.status === 403,
  );
});

test('probe accepts non-empty non-JSON 400, 403, and 404 control bodies', { concurrency: false }, async () => {
  let deleted = false;
  const fetchImpl = async (_url, init = {}) => {
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const origin = headers.get('origin');
    const invalidOrigin = origin === INVALID_ORIGIN;

    if (method === 'GET') {
      if (invalidOrigin) return textResponse(403, '<html>origin denied</html>', 'text/html');
      return new Response(null, { status: 405, headers: { allow: 'POST, DELETE' } });
    }

    if (method === 'DELETE') {
      if (invalidOrigin) return textResponse(403, '<html>origin denied</html>', 'text/html');
      if (headers.get('mcp-session-id') !== SESSION_ID || deleted) {
        return textResponse(404, 'session missing', 'text/plain');
      }
      deleted = true;
      return new Response(null, { status: 204 });
    }

    const body = init.body === undefined ? null : JSON.parse(init.body);
    if (invalidOrigin) return textResponse(403, '<html>origin denied</html>', 'text/html');

    if (body?.method === 'initialize') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          serverInfo: { name: 'non-json-control-fixture', version: '1.0.0' },
        },
      }, 200, { 'mcp-session-id': SESSION_ID });
    }

    if (headers.get('mcp-protocol-version') === '1900-01-01') {
      return textResponse(400, 'unsupported protocol version', 'text/plain');
    }

    if (body?.method === 'notifications/initialized') return new Response(null, { status: 202 });

    if (headers.get('mcp-session-id') !== SESSION_ID) {
      return textResponse(400, 'missing session id', 'text/plain');
    }
    if (deleted) return textResponse(404, 'session deleted', 'text/plain');

    if (body?.method === 'ping') {
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
    }

    if (body?.method === 'conformance/unknown-method') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: 'Method not found' },
      });
    }

    throw new Error(`unexpected request: ${method} ${body?.method ?? '(none)'}`);
  };

  const report = await withFetch(fetchImpl, () => probeMcpEndpoint({
    endpoint: 'http://fixture.invalid/mcp',
    requireSession: true,
  }));

  assert.equal(report.summary.ok, true, JSON.stringify(report.checks, null, 2));
  for (const id of [
    'invalid-origin-rejected',
    'invalid-origin-established-post-rejected',
    'invalid-origin-established-get-rejected',
    'invalid-origin-established-delete-rejected',
    'missing-session-status',
    'wrong-protocol-rejected',
    'deleted-session-not-found',
  ]) {
    assert.equal(report.checks.find((item) => item.id === id)?.status, 'PASS', id);
  }
});
