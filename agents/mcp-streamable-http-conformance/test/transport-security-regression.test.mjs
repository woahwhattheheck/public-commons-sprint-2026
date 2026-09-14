import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { probeMcpEndpoint } from '../src/probe.mjs';

const PROTOCOL = '2025-11-25';
const INVALID_ORIGIN = 'https://mcp-conformance.invalid';

async function startFixture(options = {}) {
  let sessionLive = true;
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push({ method: req.method, origin: req.headers.origin ?? null, auth: req.headers.authorization ?? null });
    const invalidOrigin = req.headers.origin === INVALID_ORIGIN;
    const sessionId = req.headers['mcp-session-id'];

    if (req.method === 'GET') {
      if (invalidOrigin) {
        if (options.acceptInvalidOriginGet) { res.writeHead(405); return res.end(); }
        return send(res, 403, { error: 'origin' });
      }
      res.writeHead(405); return res.end();
    }

    if (req.method === 'DELETE') {
      if (invalidOrigin) {
        if (options.acceptInvalidOriginDelete) {
          sessionLive = false;
          res.writeHead(204); return res.end();
        }
        return send(res, 403, { error: 'origin' });
      }
      if (!sessionLive || sessionId !== 'session-1') return send(res, 404, { error: 'missing' });
      sessionLive = false;
      res.writeHead(204); return res.end();
    }

    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const msg = JSON.parse(raw);
    if (invalidOrigin) return send(res, 403, { error: 'origin' });

    if (msg.method === 'initialize') {
      return sendRpc(res, 200, {
        jsonrpc: '2.0', id: msg.id,
        result: { protocolVersion: PROTOCOL, capabilities: {}, serverInfo: { name: 'fixture', version: '1' } },
      }, { 'mcp-session-id': 'session-1' });
    }

    if (sessionId !== 'session-1' || !sessionLive) return send(res, 404, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32001, message: 'Unknown session' } });
    if (req.headers['mcp-protocol-version'] !== PROTOCOL) return send(res, 400, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32002, message: 'wrong protocol' } });
    if (msg.id === undefined) { res.writeHead(202, { 'content-type': 'application/json' }); return res.end(); }
    if (msg.method === 'ping') {
      const contentType = options.badPingMediaType ? 'text/plain' : 'application/json';
      return sendRpc(res, 200, { jsonrpc: '2.0', id: msg.id, result: {} }, {}, contentType);
    }
    return sendRpc(res, 200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/mcp`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function send(res, status, body, extra = {}, contentType = 'application/json') {
  res.writeHead(status, { 'content-type': contentType, ...extra });
  res.end(JSON.stringify(body));
}
function sendRpc(res, status, body, extra = {}, contentType = 'application/json') {
  send(res, status, body, extra, contentType);
}

async function withFixture(options, fn) {
  const fixture = await startFixture(options);
  try { await fn(fixture); } finally { await fixture.close(); }
}

test('baseline unauthenticated HTTP fixture remains green', async () => {
  await withFixture({}, async ({ endpoint }) => {
    const report = await probeMcpEndpoint({ endpoint, requireSession: true, timeoutMs: 1000 });
    assert.equal(report.summary.ok, true, JSON.stringify(report.checks.filter((x) => x.status === 'FAIL')));
    assert.equal(report.checks.find((x) => x.id === 'invalid-origin-established-get-rejected').status, 'PASS');
    assert.equal(report.checks.find((x) => x.id === 'invalid-origin-established-delete-rejected').status, 'PASS');
  });
});

test('JSON-RPC request response rejects non-permitted media type', async () => {
  await withFixture({ badPingMediaType: true }, async ({ endpoint }) => {
    const report = await probeMcpEndpoint({ endpoint, requireSession: true, timeoutMs: 1000 });
    assert.equal(report.summary.ok, false);
    const failure = report.checks.find((x) => x.id === 'ping-transport');
    assert.equal(failure.status, 'FAIL');
    assert.equal(failure.detail.code, 'RESPONSE_MEDIA_TYPE');
    assert.equal(failure.detail.contentType, 'text/plain');
  });
});

test('hostile-Origin GET must be 403 even when ordinary GET is 405', async () => {
  await withFixture({ acceptInvalidOriginGet: true }, async ({ endpoint }) => {
    const report = await probeMcpEndpoint({ endpoint, requireSession: true, timeoutMs: 1000 });
    assert.equal(report.summary.ok, false);
    assert.equal(report.checks.find((x) => x.id === 'get-stream-contract').status, 'PASS');
    const failure = report.checks.find((x) => x.id === 'invalid-origin-established-get-rejected');
    assert.equal(failure.status, 'FAIL');
    assert.equal(failure.detail.httpStatus, 405);
    assert.equal(failure.detail.expected, 403);
    assert.equal(failure.detail.ordinaryGetMode, 'not-supported');
  });
});

test('accepted hostile-Origin DELETE fails and suppresses legitimate delete retry', async () => {
  await withFixture({ acceptInvalidOriginDelete: true }, async ({ endpoint, requests }) => {
    const report = await probeMcpEndpoint({ endpoint, requireSession: true, timeoutMs: 1000 });
    assert.equal(report.summary.ok, false);
    const failure = report.checks.find((x) => x.id === 'invalid-origin-established-delete-rejected');
    assert.equal(failure.status, 'FAIL');
    assert.equal(failure.detail.httpStatus, 204);
    assert.equal(report.checks.find((x) => x.id === 'session-delete').status, 'SKIP');
    assert.equal(requests.filter((x) => x.method === 'DELETE').length, 1, 'do not send a second DELETE after hostile DELETE was accepted');
  });
});

test('bearer over plain HTTP is rejected before first network request', async () => {
  await withFixture({}, async ({ endpoint, requests }) => {
    await assert.rejects(
      probeMcpEndpoint({ endpoint, authorizationHeader: 'Bearer super-secret' }),
      (error) => error?.code === 'AUTH_REQUIRES_HTTPS',
    );
    assert.equal(requests.length, 0);
  });
});

test('HTTPS authenticated path still executes and carries auth without leaking token', async () => {
  const previousFetch = globalThis.fetch;
  let sessionLive = true;
  const seenAuth = [];
  globalThis.fetch = async (_url, init = {}) => {
    const headers = new Headers(init.headers ?? {});
    seenAuth.push(headers.get('authorization'));
    const invalidOrigin = headers.get('origin') === INVALID_ORIGIN;
    const method = init.method ?? 'GET';
    const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });
    if (method === 'GET') return invalidOrigin ? json(403, { error: 'origin' }) : new Response('', { status: 405 });
    if (method === 'DELETE') {
      if (invalidOrigin) return json(403, { error: 'origin' });
      sessionLive = false;
      return new Response(null, { status: 204 });
    }
    const msg = JSON.parse(init.body);
    if (invalidOrigin) return json(403, { error: 'origin' });
    if (msg.method === 'initialize') return json(200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: PROTOCOL, capabilities: {}, serverInfo: { name: 'fixture', version: '1' } } }, { 'mcp-session-id': 's' });
    if (!sessionLive) return json(404, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32001, message: 'Unknown session' } });
    if (headers.get('mcp-session-id') !== 's') return json(400, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32001, message: 'missing session' } });
    if (headers.get('mcp-protocol-version') !== PROTOCOL) return json(400, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32002, message: 'wrong protocol' } });
    if (msg.id === undefined) return new Response(null, { status: 202, headers: { 'content-type': 'application/json' } });
    if (msg.method === 'ping') return json(200, { jsonrpc: '2.0', id: msg.id, result: {} });
    return json(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found Bearer positive-secret` } });
  };
  try {
    const secret = 'positive-secret';
    const report = await probeMcpEndpoint({ endpoint: 'https://example.test/mcp', authorizationHeader: `Bearer ${secret}`, requireSession: true, timeoutMs: 1000 });
    assert.equal(report.summary.ok, true, JSON.stringify(report.checks.filter((x) => x.status === 'FAIL')));
    assert.equal(seenAuth.some((value) => value === `Bearer ${secret}`), true);
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.equal(report.authenticated, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
