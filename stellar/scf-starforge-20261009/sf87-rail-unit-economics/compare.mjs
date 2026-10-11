/**
 * SF87: offline merchant unit-economics comparison for Stellar x402, MPP Charge,
 * and MPP Session. Monetary arithmetic is exact to one micro-USD (1e-6 USD).
 * All prices/volumes come from an explicit scenario. No network or wallets.
 */
import { readFileSync, openSync, writeFileSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const SCALE = 1000000n;
const RAILS = ['x402', 'mppCharge', 'mppSession'];
const REQUIREMENTS = Object.freeze({
  shared: ['fixedMonthlyUsd', 'perPaidUsd'],
  x402: ['fixedMonthlyUsd', 'facilitatorPerPaidUsd', 'sponsoredSettlementPerPaidUsd'],
  mppCharge: ['fixedMonthlyUsd', 'sponsoredTransferPerPaidUsd'],
  mppSession: ['fixedMonthlyUsd', 'offchainPerPaidUsd', 'channelOpenUsd', 'channelCloseUsd', 'channelPerActiveMonthUsd', 'liquidityCarryPerActiveMonthUsd'],
});

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(path + ' must be an object');
  }
  return value;
}
function has(value, key, path) {
  if (!Object.hasOwn(value, key)) throw new TypeError(path + '.' + key + ' is required; use null for an unknown cost');
  return value[key];
}
function count(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(name + ' must be a nonnegative safe integer');
  }
  return BigInt(value);
}
export function parseMicroUsd(value, name, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(value)) {
    throw new TypeError(name + ' must be an unsigned decimal USD string with at most six fractional places' + (nullable ? ', or null' : ''));
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt((fraction + '000000').slice(0, 6));
}
export function formatUsd(value) {
  if (value === null) return null;
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const fraction = String(abs % SCALE).padStart(6, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + String(abs / SCALE) + (fraction ? '.' + fraction : '');
}
const label = {
  x402: 'Stellar x402 Exact',
  mppCharge: 'Stellar MPP Charge',
  mppSession: 'Stellar MPP Session',
};
const closed = x => Object.freeze(x);

/**
 * The network-operation counts are protocol-based, but their fees and the
 * scenario's commercial terms are NOT live Stellar network observations.
 */
export function analyze(input) {
  object(input, 'input');
  if (input.schema !== 'stellar-forge.rail-economics.v1') throw new TypeError('unsupported input schema');
  const w = object(input.workload, 'workload');
  const costs = object(input.costs, 'costs');
  const counts = {};
  for (const key of ['paidRequestsMonth', 'activeChannelsAverage', 'channelsOpenedMonth', 'channelsClosedMonth']) {
    counts[key] = count(has(w, key, 'workload'), 'workload.' + key);
  }
  if (counts.paidRequestsMonth > 0n && counts.activeChannelsAverage === 0n) {
    throw new RangeError('activeChannelsAverage must be nonzero for a workload with paid requests');
  }
  const unitPrice = parseMicroUsd(has(w, 'unitPriceUsd', 'workload'), 'workload.unitPriceUsd');
  const funderDeposit = parseMicroUsd(has(w, 'funderDepositUsdPerChannel', 'workload'), 'workload.funderDepositUsdPerChannel');
  const monthlyRevenue = unitPrice * counts.paidRequestsMonth;
  const costValues = {};
  for (const [section, fields] of Object.entries(REQUIREMENTS)) {
    const values = object(has(costs, section, 'costs'), 'costs.' + section);
    costValues[section] = {};
    for (const field of fields) {
      costValues[section][field] = parseMicroUsd(has(values, field, 'costs.' + section), 'costs.' + section + '.' + field, true);
    }
  }
  const all = RAILS.map(rail => {
    const components = [];
    function add(section, field, times) {
      const rate = costValues[section][field];
      components.push(closed({
        name: section + '.' + field,
        multiplier: String(times),
        unitRateUsd: formatUsd(rate),
        amountUsd: rate === null ? null : formatUsd(rate * times),
        amountMicro: rate === null ? null : rate * times,
      }));
    }
    add('shared', 'fixedMonthlyUsd', 1n);
    add('shared', 'perPaidUsd', counts.paidRequestsMonth);
    add(rail, 'fixedMonthlyUsd', 1n);
    if (rail === 'x402') {
      add(rail, 'facilitatorPerPaidUsd', counts.paidRequestsMonth);
      add(rail, 'sponsoredSettlementPerPaidUsd', counts.paidRequestsMonth);
    } else if (rail === 'mppCharge') {
      add(rail, 'sponsoredTransferPerPaidUsd', counts.paidRequestsMonth);
    } else {
      add(rail, 'offchainPerPaidUsd', counts.paidRequestsMonth);
      add(rail, 'channelOpenUsd', counts.channelsOpenedMonth);
      add(rail, 'channelCloseUsd', counts.channelsClosedMonth);
      add(rail, 'channelPerActiveMonthUsd', counts.activeChannelsAverage);
      add(rail, 'liquidityCarryPerActiveMonthUsd', counts.activeChannelsAverage);
    }
    const omitted = components.filter(x => x.amountMicro === null).map(x => x.name);
    const known = components.reduce((total, c) => total + (c.amountMicro ?? 0n), 0n);
    const complete = omitted.length === 0;
    const cost = complete ? known : null;
    const contribution = complete ? monthlyRevenue - known : null;
    const knownContributionCeiling = monthlyRevenue - known;
    const perPaidFields = components.filter(c => c.name.endsWith('PerPaidUsd') || c.name.endsWith('PerRequestUsd'));
    const perPaid = perPaidFields.every(c => c.amountMicro !== null)
      ? perPaidFields.reduce((total, c) => total + (costValues[c.name.split('.')[0]][c.name.split('.')[1]]), 0n)
      : null;
    const baseline = components.filter(c => !perPaidFields.includes(c));
    const baseCost = baseline.every(c => c.amountMicro !== null)
      ? baseline.reduce((total, c) => total + c.amountMicro, 0n) : null;
    let breakEven = null;
    let status = 'INCOMPLETE_COST_INPUTS';
    if (perPaid !== null && baseCost !== null) {
      if (unitPrice > perPaid) {
        const n = (baseCost + (unitPrice - perPaid) - 1n) / (unitPrice - perPaid);
        breakEven = String(n);
        status = 'CALCULABLE_FIXED_CHANNEL_ASSUMPTIONS';
      } else {
        status = 'NONPOSITIVE_UNIT_MARGIN';
      }
    }
    // Open/close transactions and channel deposits are distinct from paid
    // requests. Session offchain pay updates do not each settle onchain.
    const onchainOps = rail === 'mppSession'
      ? counts.channelsOpenedMonth + counts.channelsClosedMonth : counts.paidRequestsMonth;
    return closed({
      rail, label: label[rail],
      modeledOnchainOperationsMonth: String(onchainOps),
      offchainPaidUpdatesMonth: rail === 'mppSession' ? String(counts.paidRequestsMonth) : '0',
      grossMerchantReceiptsUsd: formatUsd(monthlyRevenue),
      knownCostFloorUsd: formatUsd(known),
      contributionCeilingUsd: formatUsd(knownContributionCeiling),
      completeCosts: complete,
      modeledTotalCostUsd: formatUsd(cost),
      netContributionUsd: formatUsd(contribution),
      omittedCosts: omitted,
      perPaidCostUsd: formatUsd(perPaid),
      fixedAtStatedChannelCountsUsd: formatUsd(baseCost),
      breakEvenPaidRequestsMonth: breakEven,
      breakEvenStatus: status,
      breakdown: components.map(({ name, multiplier, unitRateUsd, amountUsd }) => ({name, multiplier, unitRateUsd, amountUsd})),
    });
  });
  const comparable = all.every(x => x.completeCosts);
  // Compare using the exact micro-USD numeric values, not formatted strings.
  const exactTotal = x => x.breakdown.reduce((s, c) => s + parseMicroUsd(c.amountUsd, c.name), 0n);
  const base = comparable ? exactTotal(all[0]) : null;
  const ranked = comparable ? [...all].sort((a, b) => {
    const d = exactTotal(a) - exactTotal(b);
    return d < 0n ? -1 : d > 0n ? 1 : RAILS.indexOf(a.rail) - RAILS.indexOf(b.rail);
  }) : [];
  const crossover = (() => {
    const session = all[2], exact = all[0];
    if (session.perPaidCostUsd === null || exact.perPaidCostUsd === null ||
        session.fixedAtStatedChannelCountsUsd === null || exact.fixedAtStatedChannelCountsUsd === null) return null;
    const deltaUnit = parseMicroUsd(exact.perPaidCostUsd, 'x402 per-call') -
      parseMicroUsd(session.perPaidCostUsd, 'session per-call');
    const sessionPremium = parseMicroUsd(session.fixedAtStatedChannelCountsUsd, 'session fixed') -
      parseMicroUsd(exact.fixedAtStatedChannelCountsUsd, 'x402 fixed');
    if (sessionPremium <= 0n && deltaUnit >= 0n) return '0';
    if (deltaUnit <= 0n) return null;
    return String((sessionPremium + deltaUnit - 1n) / deltaUnit);
  })();
  const results = all.map(r => ({
    ...r,
    savingsVsX402Usd: comparable ? formatUsd(base - exactTotal(r)) : null,
  }));
  return closed({
    schema: 'stellar-forge.rail-economics-report.v1',
    title: String(input.title || 'Illustrative seller scenario'),
    interpretation: 'Scenario arithmetic only; no observed merchant prices, onchain fee quote, transaction, SCF award, or production capacity',
    workload: {
      paidRequestsMonth: String(counts.paidRequestsMonth),
      activeChannelsAverage: String(counts.activeChannelsAverage),
      channelsOpenedMonth: String(counts.channelsOpenedMonth),
      channelsClosedMonth: String(counts.channelsClosedMonth),
      pricePerPaidRequestUsd: formatUsd(unitPrice),
      grossMerchantReceiptsUsd: formatUsd(monthlyRevenue),
    },
    sessionFunding: {
      assumedFunderDepositPerChannelUsd: formatUsd(funderDeposit),
      funderLockedLiquidityAtAverageChannelsUsd: formatUsd(funderDeposit * counts.activeChannelsAverage),
      funderNewDepositsOpenedMonthUsd: formatUsd(funderDeposit * counts.channelsOpenedMonth),
      accounting: 'Funder locked principal is NOT merchant operating expense or seller revenue. Liquidity carry is modeled separately if known. Real per-channel capacity and funding sufficiency are unverified.',
    },
    comparison: {
      allRailsCostComplete: comparable,
      lowestModeledCostRail: comparable ? ranked[0].rail : null,
      lowestModeledCostTies: comparable ? ranked.filter(x => exactTotal(x) === exactTotal(ranked[0])).map(x => x.rail) : [],
      sessionCostNotHigherThanX402FromPaidCallsAtFixedChurn: crossover,
      note: 'Break-even holds opened, closed and average-active channel counts fixed. It is not a capacity forecast. Unknown costs prohibit overall ranking.',
    },
    rails: results,
  });
}

export function renderMarkdown(report) {
  const a = [
    '# Stellar rail economics | ' + report.title,
    '',
    '**Scope:** ' + report.interpretation + '.',
    '',
    '## Monthly workload',
    '',
    '- Paid requests: ' + report.workload.paidRequestsMonth + ' at $' + report.workload.pricePerPaidRequestUsd + ' USD each.',
    '- Gross merchant receipts: $' + report.workload.grossMerchantReceiptsUsd + ' USD.',
    '- Average active MPP Sessions: ' + report.workload.activeChannelsAverage + '; opened: ' + report.workload.channelsOpenedMonth + '; closed: ' + report.workload.channelsClosedMonth + '.',
    '',
    '## Operating comparison',
    '',
    '| Protocol | Modeled onchain operations | Known cost floor USD | Full cost USD | Net contribution USD | Break-even paid calls/month* |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const r of report.rails) {
    a.push('| ' + r.label + ' | ' + r.modeledOnchainOperationsMonth + ' | $' + r.knownCostFloorUsd + ' | ' + (r.modeledTotalCostUsd === null ? 'unknown' : '$' + r.modeledTotalCostUsd) + ' | ' + (r.netContributionUsd === null ? 'unknown' : '$' + r.netContributionUsd) + ' | ' + (r.breakEvenPaidRequestsMonth ?? r.breakEvenStatus) + ' |');
  }
  a.push('', '*Break-even fixes channel opens, closes and average active channels at the stated scenario, with identical unit price. Higher paid traffic may require more channels.');
  a.push('', '## Decision', '');
  a.push('MPP Session reaches modeled cost parity with x402 from ' + (report.comparison.sessionCostNotHigherThanX402FromPaidCallsAtFixedChurn ?? 'an unknown/unreachable request count') + ' paid requests/month, holding channel churn and all input costs fixed. This is a price crossover, not a throughput or liquidity guarantee.');
  a.push(report.comparison.allRailsCostComplete
    ? 'Lowest modeled cost: **' + report.comparison.lowestModeledCostTies.map(r => label[r]).join(' and ') + '**. This comparison is conditional on the supplied assumptions.'
    : 'No valid overall winner because one or more cost inputs are unknown. Complete the named gaps before commercial selection.');
  for (const r of report.rails) {
    a.push('', '### ' + r.label, '', 'Modeled payment operations: ' + r.modeledOnchainOperationsMonth + ' onchain, ' + r.offchainPaidUpdatesMonth + ' offchain signed updates.');
    if (r.omittedCosts.length) a.push('Unknown costs: ' + r.omittedCosts.join(', ') + '.');
    a.push('Exact budget breakdown:');
    for (const c of r.breakdown) a.push('- ' + c.name + ': ' + (c.amountUsd === null ? 'UNKNOWN' : '$' + c.amountUsd) + ' (' + c.multiplier + ' × ' + (c.unitRateUsd === null ? 'unknown' : '$' + c.unitRateUsd) + ').');
  }
  a.push('', '## MPP Session funding', '', 'Assumed funder-locked principal: $' + report.sessionFunding.funderLockedLiquidityAtAverageChannelsUsd + ' USD; newly deposited principal at stated opens: $' + report.sessionFunding.funderNewDepositsOpenedMonthUsd + ' USD.', '', report.sessionFunding.accounting, '', 'Protocol mechanics: x402 Exact and MPP Charge settle per paid call in this scenario; MPP Session funds on opening and settles on closing with offchain payment updates between. Onchain operation counts omit network failures, retries and other provider-specific transactions. Fee rates, prices, channel churn and concurrency must come from an actual operator quote and workload.', '');
  return a.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 && !(args.length === 3 && args[1] === '--markdown')) throw new TypeError('usage: node compare.mjs scenario.json [--markdown new-report.md]');
    const scenario = JSON.parse(readFileSync(args[0], 'utf8'));
    const report = analyze(scenario);
    if (args.length === 3) {
      const fd = openSync(args[2], 'wx', 0o600);
      try { writeFileSync(fd, renderMarkdown(report), 'utf8'); } finally { closeSync(fd); }
    }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch (e) {
    process.stderr.write('SF87 error: ' + e.message + '\n');
    process.exitCode = 1;
  }
}
