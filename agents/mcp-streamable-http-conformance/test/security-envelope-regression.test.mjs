import test from 'node:test';
import assert from 'node:assert/strict';
import { probeMcpEndpoint } from '../src/probe.mjs';
import { startFixture } from './fixture-server.mjs';

async function withFixture(options, fn) {
  const fixture = await startFixture(options);
  try { await fn(fixture); } finally { await fixture.close(); }
}

const responseChecks = new Map([
  ['tools/list', 'tools-list-transport'],
  ['resources/list', 'resources-list-transport'],
  ['conformance/unknown-method', 'unknown-method-transport'],
]);

for (const [method, transportCheck] of responseChecks) {
  test(`JSON response for ${method} rejects a wrong request id`, async () => {
    await withFixture({ wrongIdMethod: method }, async ({ endpoint }) => {
      const report = await probeMcpEndpoint({ endpoint, requireSession: true });
      assert.equal(report.summary.ok, false);
      const failure = report.checks.find((item) => item.id === transportCheck);
      assert.equal(failure.status, 'FAIL');
      assert.equal(failure.detail.code, 'RPC_RESPONSE_MISMATCH');
    });
  });

  test(`JSON response for ${method} rejects a wrong jsonrpc version`, async () => {
    await withFixture({ badJsonrpcMethod: method }, async ({ endpoint }) => {
      const report = await probeMcpEndpoint({ endpoint, requireSession: true });
      assert.equal(report.summary.ok, false);
      const failure = report.checks.find((item) => item.id === transportCheck);
      assert.equal(failure.status, 'FAIL');
      assert.equal(failure.detail.code, 'RPC_RESPONSE_MISMATCH');
    });
  });

  test(`JSON response for ${method} rejects a missing jsonrpc version`, async () => {
    await withFixture({ omitJsonrpcMethod: method }, async ({ endpoint }) => {
      const report = await probeMcpEndpoint({ endpoint, requireSession: true });
      assert.equal(report.summary.ok, false);
      const failure = report.checks.find((item) => item.id === transportCheck);
      assert.equal(failure.status, 'FAIL');
      assert.equal(failure.detail.code, 'RPC_RESPONSE_MISMATCH');
    });
  });
}

test('invalid Origin must be rejected after initialization, not only during initialize', async () => {
  await withFixture({ acceptInvalidOriginAfterInitialize: true }, async ({ endpoint }) => {
    const report = await probeMcpEndpoint({ endpoint, requireSession: true });
    assert.equal(report.summary.ok, false);
    assert.equal(report.checks.find((item) => item.id === 'invalid-origin-rejected').status, 'PASS');
    const established = report.checks.find((item) => item.id === 'invalid-origin-established-post-rejected');
    assert.equal(established.status, 'FAIL');
    assert.equal(established.detail.httpStatus, 200);
    assert.equal(established.detail.expected, 403);
  });
});

test('invalid Origin must be rejected on an established GET SSE path', async () => {
  await withFixture({ acceptInvalidOriginAfterInitialize: true, getSse: true }, async ({ endpoint }) => {
    const report = await probeMcpEndpoint({ endpoint, requireSession: true });
    assert.equal(report.summary.ok, false);
    assert.equal(report.checks.find((item) => item.id === 'get-stream-contract').status, 'PASS');
    const established = report.checks.find((item) => item.id === 'invalid-origin-established-get-rejected');
    assert.equal(established.status, 'FAIL');
    assert.equal(established.detail.httpStatus, 200);
    assert.equal(established.detail.expected, 403);
  });
});

for (const malformedSessionId of ['abc def', 'abc\tdef']) {
  test(`malformed issued session id is rejected before reflection: ${JSON.stringify(malformedSessionId)}`, async () => {
    await withFixture({ sessionId: malformedSessionId }, async ({ endpoint, rpcMethods }) => {
      const report = await probeMcpEndpoint({ endpoint, requireSession: true });
      assert.equal(report.summary.ok, false);
      assert.equal(report.checks.find((item) => item.id === 'session-id-syntax').status, 'FAIL');
      assert.equal(report.checks.find((item) => item.id === 'session-issued').status, 'FAIL');
      assert.deepEqual(rpcMethods, ['initialize'], 'malformed session id must never be reflected in a follow-up request');
    });
  });
}

test('punctuation-heavy visible ASCII session id is accepted and reflected', async () => {
  const sessionId = 'azAZ09-._~!$&()+,;=:@';
  await withFixture({ sessionId }, async ({ endpoint }) => {
    const report = await probeMcpEndpoint({ endpoint, requireSession: true });
    assert.equal(report.summary.ok, true, JSON.stringify(report.checks.filter((item) => item.status === 'FAIL')));
    const syntax = report.checks.find((item) => item.id === 'session-id-syntax');
    assert.equal(syntax.status, 'PASS');
    assert.equal(syntax.detail.visibleAsciiOnly, true);
  });
});
