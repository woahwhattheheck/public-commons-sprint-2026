/**
 * Focused SF-08 regression: a narrow profitable range can sit between the
 * powers of two used by the former break-even search.
 * Original offline price assumptions; not real observed XLM cost or revenue.
 * Execute: node break-even.kink-check.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { optimisticBreakEven, project } from './model.mjs';

const scenario = JSON.parse(readFileSync(new URL('./inputs.json', import.meta.url), 'utf8'));
scenario.assumptions.operator_fee_usd_per_paid = 0.000461;
scenario.assumptions.subscribers = 1;
scenario.assumptions.subscriber_fee_usd_per_month = 64.05;

assert.equal(project(scenario, 1_048_576, 'edge_db').contribution_ceiling_usd, -0.04);
assert.equal(project(scenario, 1_200_000, 'edge_db').contribution_ceiling_usd, 0.01);
assert.equal(project(scenario, 2_097_152, 'edge_db').contribution_ceiling_usd, -1.12);
assert.equal(optimisticBreakEven(scenario, 'edge_db'), 1_166_667,
  'first profitable integer lies between powers of two and before second allowance kink');
assert.equal(optimisticBreakEven(scenario, 'vm_db'), 19_950_001,
  'VM economics should not inherit Workers quota discontinuities');
assert.equal(project(scenario, 1_200_000, 'edge_db').complete_budget, false,
  'optimistic result must not claim a complete real operating budget');

scenario.assumptions.operator_fee_usd_per_paid = 0.001;
scenario.assumptions.subscribers = 0;
scenario.assumptions.subscriber_fee_usd_per_month = 0;
assert.equal(optimisticBreakEven(scenario, 'edge_db'), 120_371,
  'normal positive-margin scenario remains supported');

console.log('PASS SF08 exact monetary allowance kink regression (one focused check)');
