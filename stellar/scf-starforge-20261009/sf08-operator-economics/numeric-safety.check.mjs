/** SF08 source-local numeric safety, preserving the original break-even kink correction.
 * Run: node stellar/scf-starforge-20261009/sf08-operator-economics/numeric-safety.check.mjs
 * Offline only. No chain operations, providers, GitHub Actions or paid infrastructure.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { project, optimisticBreakEven } from './model.mjs';

const inputs = JSON.parse(readFileSync(new URL('./inputs.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(inputs);
assert.equal(project(inputs, 1_000, 'edge_db').ingress_http_requests_month, 7_000);
assert.equal(project(inputs, 1_000, 'edge_db').quoted_web_and_db_floor_usd, 65);
assert.equal(project(inputs, 1_000, 'edge_db').optional_costs_usd.rpc, null);
assert.equal(optimisticBreakEven(inputs, 'edge_db'), 120_371);

const narrow = clone();
narrow.assumptions.operator_fee_usd_per_paid = 0.000461;
narrow.assumptions.subscribers = 1;
narrow.assumptions.subscriber_fee_usd_per_month = 64.05;
assert.equal(project(narrow, 1_200_000, 'edge_db').contribution_ceiling_usd, 0.01);
assert.equal(optimisticBreakEven(narrow, 'edge_db'), 1_166_667);
assert.equal(optimisticBreakEven(narrow, 'vm_db'), 19_950_001);

for (const count of [0.5, 1.2, Number.MAX_SAFE_INTEGER + 1, Infinity, -1]) {
  assert.throws(() => project(inputs, count), /paidCalls|finite|nonnegative|integer/);
}
const excessiveCpu = clone();
excessiveCpu.assumptions.fixed_http_calls_month = 1e308;
excessiveCpu.assumptions.cpu_ms_per_http_call = 2;
assert.throws(() => project(excessiveCpu, 1), /finite/);
assert.throws(() => optimisticBreakEven(excessiveCpu), /finite/);

const excessiveBurst = clone();
excessiveBurst.assumptions.burst_multiplier = 1e308;
assert.throws(() => project(excessiveBurst, 10), /finite/);

const excessivePrice = clone();
excessivePrice.pricing.workers_base_usd = 1e308;
assert.throws(() => project(excessivePrice, 1), /finite/);

const excessiveRevenue = clone();
excessiveRevenue.assumptions.subscriber_fee_usd_per_month = 1e308;
excessiveRevenue.assumptions.subscribers = 10;
assert.throws(() => project(excessiveRevenue, 1), /finite/);
console.log('SF08 numeric safety: all 18 focused assertions PASS');
