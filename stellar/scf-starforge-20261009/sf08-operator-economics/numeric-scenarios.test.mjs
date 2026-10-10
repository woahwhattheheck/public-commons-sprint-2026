import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { project, optimisticBreakEven } from './model.mjs';

const inputs = JSON.parse(readFileSync(new URL('./inputs.json', import.meta.url), 'utf8'));
const withAssumptions = (overrides) => ({
  ...inputs, assumptions: { ...inputs.assumptions, ...overrides },
});

test('published normal scenarios retain their economics and finite output', () => {
  assert.equal(project(inputs, 100_000, 'edge_db').contribution_ceiling_usd, -11);
  assert.equal(project(inputs, 100_000, 'vm_db').contribution_ceiling_usd, -30);
  assert.equal(optimisticBreakEven(inputs, 'edge_db'), 120_362);
  assert.equal(optimisticBreakEven(inputs, 'vm_db'), 155_547);
  for (const architecture of ['edge_db', 'vm_db']) {
    for (const paidCalls of inputs.scenario_paid_calls) {
      const output = project(inputs, paidCalls, architecture);
      const inspect = (value) => {
        if (typeof value === 'number') assert.ok(Number.isFinite(value));
        else if (value && typeof value === 'object') Object.values(value).forEach(inspect);
      };
      inspect(output);
    }
  }
});

test('paid call scenarios cannot be fractional or outside the safe integer range', () => {
  for (const n of [0.5, 1.25, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => project(inputs, n), /safe integer/);
  }
  assert.throws(() => project(inputs, Number.POSITIVE_INFINITY), /finite/);
  assert.throws(() => project(inputs, -1), /nonnegative/);
  assert.equal(project(inputs, 0).paid_calls_month, 0);
});

test('finite input values that overflow computed metrics fail before serialization', () => {
  const cpuOverflow = withAssumptions({ fixed_http_calls_month: 1e308, cpu_ms_per_http_call: 2 });
  for (const arch of ['edge_db','vm_db']) {
    assert.throws(() => project(cpuOverflow, 1, arch), /must be finite/);
  }
  assert.throws(() => optimisticBreakEven(cpuOverflow), /must be finite/);
  const burstOverflow = withAssumptions({ burst_multiplier: 1e308 });
  assert.throws(() => project(burstOverflow, 1_000_000_000), /project\.illustrative_burst_ingress_rps must be finite/);
  const revenueOverflow = withAssumptions({ operator_fee_usd_per_paid: 1e308 });
  assert.throws(() => project(revenueOverflow, 100), /project\.model_operator_revenue_usd must be finite/);
});
