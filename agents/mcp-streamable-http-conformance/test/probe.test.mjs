import test from 'node:test';
import assert from 'node:assert/strict';
import { probeMcpEndpoint } from '../src/probe.mjs';
import { validateEndpoint } from '../src/http-client.mjs';
import { startFixture } from './fixture-server.mjs';

async function withFixture(options, fn) {
  const fixture = await startFixture(options);
  try { await fn(fixture); } finally { await fixture.close(); }
}

test('green fixture passes protocol/security matrix without invoking tools', async () => {
  await withFixture({}, async ({ endpoint, methods, rpcMethods }) => {
    const report = await probeMcpEndpoint({ endpoint, requireSession: true, timeoutMs: 1000 });
    assert.equal(report.summary.ok, true, JSON.stringify(report.checks.filter((x) => x.status === 'FAIL')));
    assert.equal(report.summary.fail, 0);
    assert.match(report.evidenceSha256, /^[0-9a-f]{64}$/);
    assert.equal(report.checks.find((x) => x.id === 'version-negotiation').status, 'PASS');
    assert.equal(report.checks.find((x) => x.id === 'jsonrpc-method-not-found').status, 'PASS');
    assert.ok(methods.includes('DELETE'));
    assert.equal(rpcMethods.includes('notifications/initialized'), true);
    assert.equal(rpcMethods.includes('tools/call'), false);
  });
});

test('semantic evidence hash is stable across capture time and transport timing with RTT gate enabled', async () => {
  await withFixture({}, async ({ endpoint }) => {
    const first = await probeMcpEndpoint({ endpoint, requireSession: true, maxRttMs: 10_000 });
    const second = await probeMcpEndpoint({ endpoint, requireSession: true, maxRttMs: 10_000 });
    assert.equal(first.summary.ok, true);
    assert.equal(second.summary.ok, true);
    assert.equal(first.checks.find((x) => x.id === 'rtt-budget').status, 'PASS');
    assert.equal(second.checks.find((x) => x.id === 'rtt-budget').status, 'PASS');
    assert.equal(first.evidenceSha256, second.evidenceSha256);
  });
});

test('bad JSON-RPC unknown-method code is a conformance failure', async () => {
  await withFixture({ unknownMethodCode: -32010 }, async ({ endpoint }) => {
    const report = await probeMcpEndpoint({ endpoint, requireSession: true });
    assert.equal(report.summary.ok, false);
    assert.equal(report.checks.find((x) => x.id === 'jsonrpc-method-not-found').status, 'FAIL');
  });
});

test('invalid Origin acceptance is a hard failure', async () => {
  await withFixture({ acceptInvalidOrigin: true }, async ({ endpoint }) => {
    const report = await probeMcpEndpoint({ endpoint });
    assert.equal(report.checks.find((x) => x.id === 'invalid-origin-rejected').status, 'FAIL');
  });
});

test('redirects fail closed without following cross-origin Location', async () => {
  await withFixture({ redirect: true }, async ({ endpoint }) => {
    const report = await probeMcpEndpoint({ endpoint });
    assert.equal(report.summary.ok, false);
    assert.equal(report.checks[0].detail.code, 'REDIRECT');
  });
});

test('oversized responses are aborted at the configured byte ceiling', async () => {
  await withFixture({ oversized: 20_000 }, async ({ endpoint }) => {
    const report = await probeMcpEndpoint({ endpoint, maxResponseBytes: 2048 });
    assert.equal(report.summary.ok, false);
    assert.equal(report.checks.find((x) => x.id === 'tools-list-transport').detail.code, 'BODY_LIMIT');
  });
});

test('timeouts fail closed', async () => {
  await withFixture({ delayMs: 80 }, async ({ endpoint }) => {
    const report = await probeMcpEndpoint({ endpoint, timeoutMs: 20 });
    assert.equal(report.summary.ok, false);
    assert.equal(report.checks[0].detail.code, 'TIMEOUT');
  });
});

test('bearer secrets are scrubbed even if a malicious server echoes them', async () => {
  await withFixture({ unknownMethodCode: -32010, echoAuthInError: true }, async ({ endpoint, authValues }) => {
    const secret = 'test-secret-9e84a3';
    const report = await probeMcpEndpoint({ endpoint, authorizationHeader: `Bearer ${secret}` });
    const json = JSON.stringify(report);
    assert.equal(json.includes(secret), false);
    assert.equal(json.includes(`Bearer ${secret}`), false);
    assert.ok(authValues.some((value) => value === `Bearer ${secret}`));
    assert.equal(report.authenticated, true);
  });
});

test('endpoint rejects embedded credentials and non-http schemes', () => {
  assert.throws(() => validateEndpoint('https://user:pass@example.com/mcp'), /must not contain credentials/);
  assert.throws(() => validateEndpoint('file:///tmp/mcp'), /http or https/);
});
