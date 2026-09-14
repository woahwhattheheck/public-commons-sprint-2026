import test from 'node:test';
import assert from 'node:assert/strict';
import { probeMcpEndpoint } from '../src/probe.mjs';
import { startFixture } from './fixture-server.mjs';

async function withFixture(options, fn) {
  const fixture = await startFixture(options);
  try { await fn(fixture); } finally { await fixture.close(); }
}

test('full known 2025-11-25 ServerCapabilities surface is schema-validated', async () => {
  const malformed = [
    { prompts: true },
    { prompts: { listChanged: 'yes' } },
    { logging: 'yes' },
    { completions: [] },
    { experimental: { vendor: true } },
    { tasks: true },
    { tasks: { list: true } },
    { tasks: { cancel: 'yes' } },
    { tasks: { requests: true } },
    { tasks: { requests: { tools: true } } },
    { tasks: { requests: { tools: { call: true } } } },
  ];
  for (const capabilitiesOverride of malformed) {
    await withFixture({ capabilitiesOverride }, async ({ endpoint }) => {
      const report = await probeMcpEndpoint({ endpoint, requireSession: true });
      assert.equal(report.summary.ok, false, JSON.stringify(capabilitiesOverride));
      const initialize = report.checks.find((item) => item.id === 'initialize-envelope');
      assert.equal(initialize.status, 'FAIL');
      assert.equal(initialize.detail.requiredFields.capabilities, false);
    });
  }

  const validCapabilities = {
    experimental: { vendor: { mode: 'safe' } },
    logging: {},
    completions: {},
    prompts: { listChanged: true },
    resources: { subscribe: false, listChanged: true },
    tools: { listChanged: true },
    tasks: {
      list: {},
      cancel: {},
      requests: { tools: { call: {} } },
    },
    extensionCapability: { mode: 'safe' },
  };
  await withFixture({ capabilitiesOverride: validCapabilities }, async ({ endpoint }) => {
    const report = await probeMcpEndpoint({ endpoint, requireSession: true });
    assert.equal(report.summary.ok, true, JSON.stringify(report.checks.filter((item) => item.status === 'FAIL')));
    assert.equal(report.checks.find((item) => item.id === 'initialize-envelope').status, 'PASS');
  });
});

test('stateless servers must still reject unsupported MCP-Protocol-Version with HTTP 400', async () => {
  await withFixture({ noSession: true }, async ({ endpoint }) => {
    const report = await probeMcpEndpoint({ endpoint });
    assert.equal(report.summary.ok, true, JSON.stringify(report.checks.filter((item) => item.status === 'FAIL')));
    assert.equal(report.checks.find((item) => item.id === 'session-issued').status, 'SKIP');
    const version = report.checks.find((item) => item.id === 'wrong-protocol-rejected');
    assert.equal(version.status, 'PASS');
    assert.equal(version.detail.httpStatus, 400);
    assert.equal(version.detail.sessionBound, false);
  });

  await withFixture({ noSession: true, wrongProtocolStatus: 200 }, async ({ endpoint }) => {
    const report = await probeMcpEndpoint({ endpoint });
    assert.equal(report.summary.ok, false);
    const version = report.checks.find((item) => item.id === 'wrong-protocol-rejected');
    assert.equal(version.status, 'FAIL');
    assert.equal(version.detail.httpStatus, 200);
    assert.equal(version.detail.expected, 400);
    assert.equal(version.detail.sessionBound, false);
  });
});
