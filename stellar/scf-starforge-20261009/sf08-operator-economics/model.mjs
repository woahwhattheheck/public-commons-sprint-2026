/**
 * SF-08: deterministic, assumption-explicit Stellar x402 Bazaar economics.
 * Offline only. No dependencies, wallets, network calls, provider accounts or payments.
 * Values are US dollars per calendar month unless named otherwise.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const APPROX_MONTH_SECONDS = 30 * 24 * 60 * 60;
const CENT = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const SIX = (n) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;

function nonNegative(n, label) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    throw new TypeError(`${label} must be a finite, nonnegative number`);
  }
  return n;
}
function optionalRate(n, label) {
  if (n === null || n === undefined) return null;
  return nonNegative(n, label);
}
function checkValues(input) {
  if (typeof input !== 'object' || input === null) throw new TypeError('input object required');
  for (const [section, keys] of Object.entries({
    assumptions: [
      'discovery_queries_per_paid', 'http_calls_per_paid', 'fixed_http_calls_month',
      'cpu_ms_per_http_call', 'onchain_attempts_per_paid', 'xlm_per_onchain_attempt',
      'illustrative_xlm_usd', 'operator_fee_usd_per_paid',
      'subscribers', 'subscriber_fee_usd_per_month', 'rpc_calls_per_paid',
      'burst_multiplier',
    ],
    pricing: [
      'workers_base_usd', 'workers_included_requests', 'workers_overage_usd_per_million',
      'workers_included_cpu_ms', 'workers_overage_usd_per_million_cpu_ms',
      'pg_ha_usd', 'vm_monthly_usd', 'vm_nodes',
    ],
  })) {
    if (!input[section]) throw new TypeError(`missing ${section}`);
    for (const key of keys) nonNegative(input[section][key], `${section}.${key}`);
  }
  const { assumptions:a } = input;
  for (const key of ['rpc_usd_per_million', 'index_and_search_usd_per_month',
    'observability_security_support_usd_per_month', 'other_ops_usd_per_month']) {
    optionalRate(a[key], `assumptions.${key}`);
  }
  if (a.http_calls_per_paid < 1) throw new RangeError('http_calls_per_paid must include at least one client interaction');
  if (input.pricing.vm_nodes < 1) throw new RangeError('vm_nodes must be positive');
}

/**
 * Compare two SPECIFIC infrastructure sketches. This models price, not performance.
 * Required but unpriced spend stays null, never defaults silently to a real $0.
 */
export function project(input, paidCalls, architecture = 'edge_db') {
  checkValues(input);
  nonNegative(paidCalls, 'paidCalls');
  if (!['edge_db', 'vm_db'].includes(architecture)) {
    throw new RangeError('architecture must be edge_db or vm_db');
  }
  const a = input.assumptions;
  const p = input.pricing;
  const requests = paidCalls * (a.discovery_queries_per_paid + a.http_calls_per_paid)
    + a.fixed_http_calls_month;
  const cpuMs = requests * a.cpu_ms_per_http_call;
  const edgeCost = p.workers_base_usd
    + Math.max(0, requests - p.workers_included_requests) / 1e6 * p.workers_overage_usd_per_million
    + Math.max(0, cpuMs - p.workers_included_cpu_ms) / 1e6 * p.workers_overage_usd_per_million_cpu_ms;
  const webTier = architecture === 'edge_db' ? edgeCost : p.vm_monthly_usd * p.vm_nodes;
  const infrastructureQuoted = webTier + p.pg_ha_usd;
  const onchainAttempts = paidCalls * a.onchain_attempts_per_paid;
  const sponsoredXlm = onchainAttempts * a.xlm_per_onchain_attempt;
  const hypotheticalSponsorUsd = sponsoredXlm * a.illustrative_xlm_usd;
  const revenues = paidCalls * a.operator_fee_usd_per_paid
    + a.subscribers * a.subscriber_fee_usd_per_month;
  const rpcCalls = paidCalls * a.rpc_calls_per_paid;
  const optionalCosts = {
    rpc: a.rpc_usd_per_million === null || a.rpc_usd_per_million === undefined
      ? null : rpcCalls / 1e6 * a.rpc_usd_per_million,
    index_and_search: a.index_and_search_usd_per_month ?? null,
    observability_security_support: a.observability_security_support_usd_per_month ?? null,
    other_ops: a.other_ops_usd_per_month ?? null,
  };
  const omissions = Object.entries(optionalCosts).filter(([, value]) => value === null).map(([key]) => key);
  const knownOrAssumed = infrastructureQuoted + hypotheticalSponsorUsd
    + Object.values(optionalCosts).reduce((t, v) => t + (v ?? 0), 0);
  const contributionCeiling = revenues - knownOrAssumed;
  return {
    architecture,
    paid_calls_month: paidCalls,
    discovery_queries_month: paidCalls * a.discovery_queries_per_paid,
    ingress_http_requests_month: requests,
    approximate_avg_ingress_rps: SIX(requests / APPROX_MONTH_SECONDS),
    illustrative_burst_ingress_rps: SIX(requests / APPROX_MONTH_SECONDS * a.burst_multiplier),
    estimated_cpu_ms_month: cpuMs,
    estimated_rpc_calls_month: rpcCalls,
    estimated_onchain_attempts_month: onchainAttempts,
    illustrated_sponsor_xlm: SIX(sponsoredXlm),
    assumed_xlm_usd_not_spot_rate: a.illustrative_xlm_usd,
    model_operator_revenue_usd: CENT(revenues),
    quoted_web_and_db_floor_usd: CENT(infrastructureQuoted),
    estimated_fee_sponsorship_usd: CENT(hypotheticalSponsorUsd),
    optional_costs_usd: Object.fromEntries(Object.entries(optionalCosts).map(([k,v]) => [k,v === null ? null : CENT(v)])),
    modeled_known_costs_usd: CENT(knownOrAssumed),
    contribution_ceiling_usd: CENT(contributionCeiling),
    omitted_cost_categories: omissions,
    complete_budget: omissions.length === 0,
    successful_onchain_sponsor_cost_is_illustrative: true,
  };
}

/** An optimistic break-even bound (omitted costs assumed zero ONLY for bound calculation). */
export function optimisticBreakEven(input, architecture = 'edge_db') {
  checkValues(input);
  if (!['edge_db', 'vm_db'].includes(architecture)) {
    throw new RangeError('architecture must be edge_db or vm_db');
  }
  const a = input.assumptions;
  const p = input.pricing;
  const callsPerPaid = a.discovery_queries_per_paid + a.http_calls_per_paid;
  const fixedRequests = a.fixed_http_calls_month;
  // Use raw dollars for the threshold: project() rounds reported dollars to cents.
  const profit = n => {
    const requests = n * callsPerPaid + fixedRequests;
    const cpuMs = requests * a.cpu_ms_per_http_call;
    const web = architecture === 'edge_db'
      ? p.workers_base_usd
        + Math.max(0, requests - p.workers_included_requests) / 1e6 * p.workers_overage_usd_per_million
        + Math.max(0, cpuMs - p.workers_included_cpu_ms) / 1e6 * p.workers_overage_usd_per_million_cpu_ms
      : p.vm_monthly_usd * p.vm_nodes;
    const optional = (a.rpc_usd_per_million ?? 0) * n * a.rpc_calls_per_paid / 1e6
      + (a.index_and_search_usd_per_month ?? 0)
      + (a.observability_security_support_usd_per_month ?? 0)
      + (a.other_ops_usd_per_month ?? 0);
    const cost = web + p.pg_ha_usd + optional
      + n * a.onchain_attempts_per_paid * a.xlm_per_onchain_attempt * a.illustrative_xlm_usd;
    const revenue = n * a.operator_fee_usd_per_paid
      + a.subscribers * a.subscriber_fee_usd_per_month;
    return revenue - cost;
  };
  if (profit(0) >= 0) return 0;
  const maxCalls = 1e12;
  const kinks = [];
  if (architecture === 'edge_db') {
    // At most two affine slope changes: Workers request and CPU allowances.
    const addKink = (included, base, rate) => {
      if (rate <= 0) return;
      const at = (included - base) / rate;
      if (!Number.isFinite(at) || at < 0 || at > maxCalls) return;
      kinks.push(Math.floor(at), Math.ceil(at));
    };
    addKink(p.workers_included_requests, fixedRequests, callsPerPaid);
    addKink(p.workers_included_cpu_ms, fixedRequests * a.cpu_ms_per_http_call,
      callsPerPaid * a.cpu_ms_per_http_call);
  }
  const points = [...new Set([0, ...kinks])]
    .filter(n => Number.isSafeInteger(n) && n >= 0 && n <= maxCalls)
    .sort((a, b) => a - b);
  const firstNonnegative = (lo, hi) => {
    while (lo + 1 < hi) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (profit(mid) >= 0) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  let lo = 0;
  // Each piece is affine. Inspect every allowance boundary, since a narrow
  // profitable interval may disappear before the next geometric doubling.
  for (const hi of points.slice(1)) {
    if (profit(hi) >= 0) return firstNonnegative(lo, hi);
    lo = hi;
  }
  let hi = Math.max(lo + 1, 1);
  while (hi < maxCalls && profit(hi) < 0) hi = Math.min(maxCalls, hi * 2);
  return profit(hi) >= 0 ? firstNonnegative(lo, hi) : null;
}

// Node CLI. Does not execute when imported by a separate local focused check.
const isCLI = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCLI) {
  const filename = process.argv[2] ?? fileURLToPath(new URL('./inputs.json', import.meta.url));
  const input = JSON.parse(readFileSync(filename, 'utf8'));
  const scenarios = input.scenario_paid_calls ?? [1_000, 100_000, 1_000_000, 10_000_000];
  const output = {
    context: 'SCF-SF08 offline hypothetical calculation, not a grant or real deployed spend/revenue',
    inputs: filename,
    break_even_optimistic_calls_month: {
      edge_db: optimisticBreakEven(input, 'edge_db'),
      vm_db: optimisticBreakEven(input, 'vm_db'),
    },
    scenarios: scenarios.flatMap(n => ['edge_db','vm_db'].map(arch => project(input,n,arch))),
  };
  console.log(JSON.stringify(output, null, 2));
}
