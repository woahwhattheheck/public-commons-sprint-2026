import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, validateEndpoint } from '../src/http-client.mjs';

const RPC = { jsonrpc: '2.0', id: 1, method: 'ping', params: {} };
const encoder = new TextEncoder();

function bytesWithInvalidUtf8(prefix, suffix) {
  const left = encoder.encode(prefix);
  const right = encoder.encode(suffix);
  const out = new Uint8Array(left.length + 1 + right.length);
  out.set(left, 0);
  out[left.length] = 0xff;
  out.set(right, left.length + 1);
  return out;
}

async function withFetch(implementation, action) {
  const previous = globalThis.fetch;
  globalThis.fetch = implementation;
  try { return await action(); }
  finally { globalThis.fetch = previous; }
}

function call(headers = {}, body = RPC) {
  return requestJson({
    url: 'https://example.test/mcp',
    headers,
    body,
    timeoutMs: 1_000,
    maxResponseBytes: 64 * 1024,
  });
}

test('endpoint queries are rejected because evidence does not bind query identity', () => {
  assert.throws(
    () => validateEndpoint('https://example.test/mcp?tenant=a'),
    (error) => error?.code === 'ENDPOINT_QUERY',
  );
});

test('JSON response decoding rejects malformed UTF-8 instead of replacement decoding', async () => {
  const raw = bytesWithInvalidUtf8(
    '{"jsonrpc":"2.0","id":1,"result":{"name":"fi',
    'xture"}}',
  );
  await withFetch(
    async () => new Response(raw, { status: 200, headers: { 'content-type': 'application/json' } }),
    async () => assert.rejects(call(), (error) => error?.code === 'INVALID_UTF8'),
  );
});

test('SSE response decoding rejects malformed UTF-8 instead of replacement decoding', async () => {
  const raw = bytesWithInvalidUtf8(
    'data: {"jsonrpc":"2.0","id":1,"result":{"name":"fi',
    'xture"}}\n\n',
  );
  await withFetch(
    async () => new Response(raw, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    async () => assert.rejects(call(), (error) => error?.code === 'INVALID_UTF8'),
  );
});

test('SSE accepts LF, CRLF, and CR line endings only after a blank-line dispatch boundary', async () => {
  for (const lineEnding of ['\n', '\r\n', '\r']) {
    const body = `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })}${lineEnding}${lineEnding}`;
    await withFetch(
      async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      async () => {
        const result = await call();
        assert.equal(result.responseMode, 'sse');
        assert.deepEqual(result.body.result, {});
      },
    );
  }
});

test('SSE discards an unterminated event at EOF', async () => {
  const body = `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })}\n`;
  await withFetch(
    async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    async () => assert.rejects(call(), (error) => error?.code === 'SSE_RESPONSE_MISSING'),
  );
});

test('invalid-Origin HTTP 403 is credited without requiring a response media type or body', async () => {
  await withFetch(
    async () => new Response(null, { status: 403 }),
    async () => {
      const result = await call({ origin: 'https://mcp-conformance.invalid' });
      assert.equal(result.response.status, 403);
      assert.equal(result.body, null);
      assert.equal(result.responseMode, 'empty');
    },
  );
});

test('non-Origin HTTP 403 is also retained as protocol-control status', async () => {
  await withFetch(
    async () => new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } }),
    async () => {
      const result = await call();
      assert.equal(result.response.status, 403);
      assert.equal(result.body, null);
      assert.equal(result.responseMode, 'opaque');
    },
  );
});

test('ping rejects array results in JSON mode', async () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: [] });
  await withFetch(
    async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
    async () => assert.rejects(call(), (error) => error?.code === 'RPC_RESPONSE_MISMATCH'),
  );
});

test('ping rejects array results in SSE mode', async () => {
  const body = `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: [] })}\n\n`;
  await withFetch(
    async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    async () => assert.rejects(call(), (error) => error?.code === 'SSE_RESPONSE_MISSING'),
  );
});

test('malformed UTF-8 application/json on non-200 remains opaque', async () => {
  const raw = bytesWithInvalidUtf8(
    '{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"bad',
    '"}}',
  );
  await withFetch(
    async () => new Response(raw, { status: 400, headers: { 'content-type': 'application/json' } }),
    async () => {
      const result = await call();
      assert.equal(result.response.status, 400);
      assert.equal(result.body, null);
      assert.equal(result.responseMode, 'opaque');
    },
  );
});
