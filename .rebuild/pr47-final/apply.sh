#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"
product="agents/mcp-streamable-http-conformance"

python3 - <<'PY'
from pathlib import Path

http_path = Path('agents/mcp-streamable-http-conformance/src/http-client.mjs')
http_text = http_path.read_text(encoding='utf-8')
http_old = "    if (rpcRequest && !sseResponse && !jsonResponse) {"
http_new = "    if (response.status === 200 && rpcRequest && !sseResponse && !jsonResponse) {"
if http_text.count(http_old) != 1:
    raise SystemExit(f'http-client exact-source fence failed: count={http_text.count(http_old)}')
http_path.write_text(http_text.replace(http_old, http_new), encoding='utf-8')

probe_path = Path('agents/mcp-streamable-http-conformance/src/probe.mjs')
probe_text = probe_path.read_text(encoding='utf-8')
probe_old = "  if (ping) checks.push(ping.response.status === 200 && ping.body?.result && typeof ping.body.result === 'object'"
probe_new = "  if (ping) checks.push(ping.response.status === 200 && isPlainObject(ping.body?.result)"
if probe_text.count(probe_old) != 1:
    raise SystemExit(f'probe exact-source fence failed: count={probe_text.count(probe_old)}')
probe_path.write_text(probe_text.replace(probe_old, probe_new), encoding='utf-8')
PY

cat > "$product/test/final-source-closure.test.mjs" <<'EOF'
import test from 'node:test';
import assert from 'node:assert/strict';
import { probeMcpEndpoint } from '../src/probe.mjs';

const INVALID_ORIGIN = 'https://mcp-conformance.invalid';
const PROTOCOL_VERSION = '2025-11-25';
const SESSION_ID = 'session-final-closure';

function jsonResponse(body, status = 200, { contentType = 'application/json', headers = {} } = {}) {
  const responseHeaders = new Headers(headers);
  if (contentType !== null) responseHeaders.set('content-type', contentType);
  return new Response(new TextEncoder().encode(JSON.stringify(body)), { status, headers: responseHeaders });
}

function bare(status, headers = {}) {
  return new Response(null, { status, headers });
}

function makeFetch({ pingResult = {}, pingContentType = 'application/json' } = {}) {
  let deleted = false;
  const calls = [];

  const fetchImpl = async (_url, init = {}) => {
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const origin = headers.get('origin');
    calls.push({ method, origin, protocol: headers.get('mcp-protocol-version') });

    const invalidOrigin = origin === INVALID_ORIGIN;
    if (method === 'GET') {
      if (invalidOrigin) return bare(403);
      return bare(405, { allow: 'POST, DELETE' });
    }

    if (method === 'DELETE') {
      if (invalidOrigin) return bare(403);
      if (headers.get('mcp-session-id') !== SESSION_ID || deleted) return bare(404);
      deleted = true;
      return bare(204);
    }

    const body = init.body === undefined ? null : JSON.parse(init.body);
    if (invalidOrigin) return bare(403);

    if (body?.method === 'initialize') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          serverInfo: { name: 'final-closure-fixture', version: '1.0.0' },
        },
      }, 200, { headers: { 'mcp-session-id': SESSION_ID } });
    }

    if (headers.get('mcp-protocol-version') === '1900-01-01') return bare(400);

    if (body?.method === 'notifications/initialized') return bare(202);

    if (headers.get('mcp-session-id') !== SESSION_ID) return bare(400);
    if (deleted) return bare(404);

    if (body?.method === 'ping') {
      return jsonResponse(
        { jsonrpc: '2.0', id: body.id, result: pingResult },
        200,
        { contentType: pingContentType },
      );
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

test('Ping EmptyResult rejects arrays', { concurrency: false }, async () => {
  const scripted = makeFetch({ pingResult: [] });
  const report = await withFetch(scripted.fetchImpl, () => probeMcpEndpoint({
    endpoint: 'http://fixture.invalid/mcp',
    requireSession: true,
  }));

  assert.equal(report.summary.ok, false);
  const ping = report.checks.find((item) => item.id === 'ping');
  assert.equal(ping.status, 'FAIL');
  assert.equal(ping.detail.httpStatus, 200);
});

test('bare 400, 403, and 404 control responses retain exact status authority', { concurrency: false }, async () => {
  const scripted = makeFetch();
  const report = await withFetch(scripted.fetchImpl, () => probeMcpEndpoint({
    endpoint: 'http://fixture.invalid/mcp',
    requireSession: true,
  }));

  assert.equal(report.summary.ok, true, JSON.stringify(report.checks, null, 2));
  assert.equal(report.checks.find((item) => item.id === 'invalid-origin-rejected').status, 'PASS');
  assert.equal(report.checks.find((item) => item.id === 'invalid-origin-established-post-rejected').status, 'PASS');
  assert.equal(report.checks.find((item) => item.id === 'invalid-origin-established-get-rejected').status, 'PASS');
  assert.equal(report.checks.find((item) => item.id === 'invalid-origin-established-delete-rejected').status, 'PASS');
  assert.equal(report.checks.find((item) => item.id === 'missing-session-status').status, 'PASS');
  assert.equal(report.checks.find((item) => item.id === 'wrong-protocol-rejected').status, 'PASS');
  assert.equal(report.checks.find((item) => item.id === 'deleted-session-not-found').status, 'PASS');
});

test('HTTP 200 JSON-RPC under text/plain remains a hard media-type failure', { concurrency: false }, async () => {
  const scripted = makeFetch({ pingContentType: 'text/plain' });
  const report = await withFetch(scripted.fetchImpl, () => probeMcpEndpoint({
    endpoint: 'http://fixture.invalid/mcp',
    requireSession: true,
  }));

  assert.equal(report.summary.ok, false);
  const failure = report.checks.find((item) => item.id === 'ping-transport');
  assert.equal(failure.status, 'FAIL');
  assert.equal(failure.detail.code, 'RESPONSE_MEDIA_TYPE');
  assert.equal(failure.detail.status, 200);
  assert.equal(failure.detail.contentType, 'text/plain');
});
EOF

cd "$product"
npm ci --ignore-scripts
npm run check
npm test
cd "$root"

rm -rf .rebuild/pr47-final
rm -f .github/workflows/pr47-final-source-closure.yml
