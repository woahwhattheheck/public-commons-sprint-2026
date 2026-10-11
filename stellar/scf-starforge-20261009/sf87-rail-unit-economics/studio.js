/* SF87 local-only UI. Numeric modeling lives solely in original compare.mjs. */
'use strict';
const GROUPS = [
  ['Workload and pricing', 'workload', [
    ['paidRequestsMonth', 'Monthly successful paid requests', 'integer'],
    ['unitPriceUsd', 'Price per paid request, USD', 'money'],
    ['activeChannelsAverage', 'Average funded MPP Sessions', 'integer'],
    ['channelsOpenedMonth', 'Sessions opened per month', 'integer'],
    ['channelsClosedMonth', 'Sessions closed per month', 'integer'],
    ['funderDepositUsdPerChannel', 'Funder-locked USD per session', 'money'],
  ]],
  ['Shared platform cost', 'shared', [
    ['fixedMonthlyUsd', 'Common fixed cost, USD/mo', 'cost'],
    ['perPaidUsd', 'Common cost per paid request, USD', 'cost'],
  ]],
  ['x402 Exact', 'x402', [
    ['fixedMonthlyUsd', 'x402 fixed USD/mo', 'cost'],
    ['facilitatorPerPaidUsd', 'Facilitator fee per paid request', 'cost'],
    ['sponsoredSettlementPerPaidUsd', 'Seller-sponsored ledger fee per paid request', 'cost'],
  ]],
  ['MPP Charge', 'mppCharge', [
    ['fixedMonthlyUsd', 'MPP Charge fixed USD/mo', 'cost'],
    ['sponsoredTransferPerPaidUsd', 'Seller-sponsored onchain transfer fee', 'cost'],
  ]],
  ['MPP Session', 'mppSession', [
    ['fixedMonthlyUsd', 'MPP Session fixed USD/mo', 'cost'],
    ['offchainPerPaidUsd', 'Offchain signature handling cost per paid call', 'cost'],
    ['channelOpenUsd', 'Ledger charge per new session', 'cost'],
    ['channelCloseUsd', 'Ledger charge per closed session', 'cost'],
    ['channelPerActiveMonthUsd', 'Active session maintenance USD/mo', 'cost'],
    ['liquidityCarryPerActiveMonthUsd', 'Capital carry cost per active session USD/mo', 'cost'],
  ]],
];
const $ = id => document.getElementById(id);
let sample = null;
let last = null;
const groupParent = $('field-groups');
function cell(tag, value) {
  const el = document.createElement(tag);
  el.textContent = value;
  return el;
}
function addInputs() {
  for (const [title, key, fields] of GROUPS) {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend'); legend.textContent = title;
    fieldset.append(legend);
    const grid = document.createElement('div'); grid.className = 'fields';
    for (const [field, titleText, type] of fields) {
      const div = document.createElement('div'); div.className = 'field';
      const label = document.createElement('label'); label.textContent = titleText;
      const id = key + '-' + field; label.htmlFor = id;
      const input = document.createElement('input'); input.id = id;
      input.name = id; input.type = 'text'; input.inputMode = type === 'integer' ? 'numeric' : 'decimal';
      input.placeholder = type === 'cost' ? 'Unknown until quoted' : 'Required';
      input.spellcheck = false;
      div.append(label, input); grid.append(div);
    }
    fieldset.append(grid); groupParent.append(fieldset);
  }
}
function setSample() {
  for (const [, group, fields] of GROUPS) {
    for (const [key] of fields) {
      const original = group === 'workload' ? sample.workload[key] : sample.costs[group][key];
      $(group + '-' + key).value = original === null ? '' : String(original);
    }
  }
  $('error').textContent = '';
}
function formScenario() {
  const values = structuredClone(sample);
  for (const [, group, fields] of GROUPS) {
    for (const [key, , type] of fields) {
      const val = $(group + '-' + key).value.trim();
      const target = group === 'workload' ? values.workload : values.costs[group];
      if (type === 'integer') {
        if (!/^(0|[1-9][0-9]*)$/.test(val)) throw Error(group + '.' + key + ': enter a nonnegative whole count');
        target[key] = Number(val);
      } else {
        target[key] = type === 'cost' && val === '' ? null : val;
      }
    }
  }
  return values;
}
function metric(label, value, foot) {
  const outer = document.createElement('div'); outer.className = 'metric';
  const small = cell('div', label); small.className = 'eyebrow';
  const amount = cell('strong', value); amount.className = 'metric-value';
  const note = cell('div', foot); note.className = 'metric-foot';
  outer.append(small, amount, note); return outer;
}
function showReport(report) {
  $('results').classList.remove('hidden');
  const m = $('metrics'); m.replaceChildren();
  m.append(
    metric('MONTHLY GROSS', '$' + report.workload.grossMerchantReceiptsUsd, 'Model revenue only, not collected'),
    metric('LEAST COSTED RAIL', report.comparison.allRailsCostComplete ? report.rails.find(r => r.rail === report.comparison.lowestModeledCostRail).label : 'Not rankable', 'Requires all provider costs'),
    metric('SESSION/X402 CROSSOVER', report.comparison.sessionCostNotHigherThanX402FromPaidCallsAtFixedChurn ?? 'Unknown', 'Paid calls/mo, fixed churn'),
    metric('FUNDER-LOCKED CAPITAL', '$' + report.sessionFunding.funderLockedLiquidityAtAverageChannelsUsd, 'Separate from seller operating cost'),
  );
  const body = $('rail-rows'); body.replaceChildren();
  for (const rail of report.rails) {
    const tr = document.createElement('tr');
    const fields = [rail.label, rail.modeledOnchainOperationsMonth,
      rail.modeledTotalCostUsd === null ? 'Unknown' : '$' + rail.modeledTotalCostUsd,
      rail.netContributionUsd === null ? 'Unknown' : '$' + rail.netContributionUsd,
      rail.breakEvenPaidRequestsMonth ?? rail.breakEvenStatus];
    for (let i = 0; i < fields.length; i++) {
      const td = cell(i === 0 ? 'th' : 'td', fields[i]);
      if (i === 0) td.scope = 'row';
      tr.append(td);
    }
    body.append(tr);
  }
  const best = report.comparison.lowestModeledCostTies;
  $('decision').textContent = report.comparison.allRailsCostComplete
    ? 'Conditional cheapest: ' + best.map(k => report.rails.find(r => r.rail === k).label).join(' / ') + '. Fixed channel churn and operator-entered pricing; no settlement or demand measurement.'
    : 'No overall winner: unknown costs must be supplied first. Known cost floors are not full operating costs.';
  const notes = report.rails.map(r => r.label + '\n' +
    r.breakdown.map(c => '  ' + c.name + ': ' + (c.amountUsd === null ? 'UNKNOWN' : '$' + c.amountUsd)).join('\n') +
    (r.omittedCosts.length ? '\n  MISSING: ' + r.omittedCosts.join(', ') : '')).join('\n\n');
  $('details').textContent = notes + '\n\n' + report.comparison.note + '\n' + report.sessionFunding.accounting;
}
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const a = document.createElement('a'); a.href = url; a.download = filename;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function calculate(event) {
  event.preventDefault(); $('error').textContent = '';
  $('calculate').disabled = true;
  try {
    const scenario = formScenario();
    const res = await fetch('/evaluate', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(scenario)});
    const output = await res.json();
    if (!res.ok) throw Error(output.error || 'Evaluation failed');
    last = output; showReport(output.report);
    $('results').scrollIntoView({behavior:'smooth', block:'start'});
  } catch (e) { $('error').textContent = String(e.message); }
  finally { $('calculate').disabled = false; }
}
async function start() {
  try {
    const res = await fetch('/sample.json');
    if (!res.ok) throw Error('Unable to load local sample');
    sample = await res.json();
    addInputs(); setSample();
    $('inputs').addEventListener('submit', calculate);
    $('reset').addEventListener('click', () => {setSample(); $('results').classList.add('hidden'); last=null;});
    $('download-json').addEventListener('click', () => {if(last) download('merchant-rail-economics.json', JSON.stringify(last.report,null,2)+'\n', 'application/json');});
    $('download-md').addEventListener('click', () => {if(last) download('merchant-rail-economics.md', last.markdown, 'text/markdown');});
  } catch (e) { $('error').textContent = String(e.message); }
}
start();
