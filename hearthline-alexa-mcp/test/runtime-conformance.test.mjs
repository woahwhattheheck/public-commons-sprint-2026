import test from 'node:test';
import assert from 'node:assert/strict';
import { runConformanceProbe } from '../runtime/conformance-probe.mjs';

test('MCP 2025-11-25 Streamable HTTP conformance probe is fully green', async () => {
  const report = await runConformanceProbe();
  assert.equal(report.schema, 'hearthline.mcp-runtime-conformance/v1');
  assert.equal(report.protocolVersion, '2025-11-25');
  assert.equal(report.transport, 'Streamable HTTP');
  assert.equal(report.summary.total >= 12, true);
  assert.equal(report.summary.passed, report.summary.total, JSON.stringify(report.checks.filter((entry) => !entry.ok), null, 2));
  assert.equal(report.summary.ok, true);
  assert.match(report.sha256, /^[0-9a-f]{64}$/);
});
