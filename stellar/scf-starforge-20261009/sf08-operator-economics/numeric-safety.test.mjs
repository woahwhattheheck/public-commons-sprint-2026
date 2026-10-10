/** Source-level regression for SF08 finite accounting and integer paid-call scenarios. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { project, optimisticBreakEven } from './model.mjs';

const fixture = JSON.parse(readFileSync(new URL('./inputs.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(fixture);

assert.equal(project(fixture, 100_000, 'edge_db').contribution_ceiling_usd, -11);
assert.equal(project(fixture, 100_000, 'edge_db').optional_costs_usd.rpc, null);
assert.equal(optimisticBreakEven(fixture, 'edge_db'), 120_371);
assert.equal(optimisticBreakEven(fixture, 'vm_db'), 155_556);
for (const volume of [0.5, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, -1, NaN]) {
  assert.throws(() => project(fixture, volume), /paidCalls/, `reject unsafe paid calls: ${volume}`);
}
assert.equal(project(fixture, 0).paid_calls_month, 0);

const cpuOverflow = clone();
cpuOverflow.assumptions.fixed_http_calls_month = 1e308;
cpuOverflow.assumptions.cpu_ms_per_http_call = 2;
assert.throws(() => project(cpuOverflow, 1, 'edge_db'), RangeError);
assert.throws(() => project(cpuOverflow, 1, 'vm_db'), RangeError);
assert.throws(() => optimisticBreakEven(cpuOverflow, 'edge_db'), RangeError);

const burstOverflow = clone();
burstOverflow.assumptions.burst_multiplier = 1e308;
assert.throws(() => project(burstOverflow, 1_000_000), RangeError);

const revenueOverflow = clone();
revenueOverflow.assumptions.subscribers = 1e308;
revenueOverflow.assumptions.subscriber_fee_usd_per_month = 1e308;
assert.throws(() => project(revenueOverflow, 1), RangeError);
assert.throws(() => optimisticBreakEven(revenueOverflow), RangeError);

const rpcOverflow = clone();
rpcOverflow.assumptions.rpc_usd_per_million = 1e308;
rpcOverflow.assumptions.rpc_calls_per_paid = 1e308;
assert.throws(() => project(rpcOverflow, 1000), RangeError);

for (const architecture of ['edge_db','vm_db']) {
  const result = project(fixture, 10_000_000, architecture);
  assert.equal(result.complete_budget, false);
  assert.ok(Object.values(result).every(v => typeof v !== 'number' || Number.isFinite(v)));
}
console.log('PASS SF08 numeric scenario guards and unchanged reference break-even');
