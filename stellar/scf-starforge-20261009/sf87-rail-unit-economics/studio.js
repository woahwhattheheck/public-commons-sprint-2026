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
const SCHEMA = 'stellar-forge.rail-economics.v1';
const MAX_FILE_BYTES = 128 * 1024;
let revision = 0, active = null, previous = null;
function object(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key)))
    throw Error(path + ': unsupported fields or object shape');
  return value;
}
// Reconstruct only editable source fields. Arithmetic/relationships remain in
// the original /evaluate engine; never accept a derived report as input.
function scenarioInput(raw) {
  object(raw, ['schema','title','workload','costs'], 'Scenario');
  if (raw.schema !== SCHEMA) throw Error('Open an editable scenario JSON, not a calculated report.');
  const title = raw.title ?? 'Untitled scenario';
  if (typeof title !== 'string' || !title.trim() || title.length > 160 || /[\u0000-\u001f\u007f]/.test(title))
    throw Error('Scenario name must be 1–160 characters on one line.');
  object(raw.workload, GROUPS[0][2].map(f => f[0]), 'workload');
  object(raw.costs, GROUPS.slice(1).map(g => g[1]), 'costs');
  const value = {schema:SCHEMA,title,workload:{},costs:{}};
  for (const [, group, fields] of GROUPS) {
    const source = group === 'workload' ? raw.workload : object(raw.costs[group], fields.map(f => f[0]), 'costs.' + group);
    const target = group === 'workload' ? value.workload : (value.costs[group] = {});
    for (const [key, , type] of fields) {
      const field = source[key];
      if (!Object.hasOwn(source,key)) throw Error(group + '.' + key + ': missing input');
      if (type === 'integer') {
        if (!Number.isSafeInteger(field) || field < 0) throw Error(group + '.' + key + ': enter a nonnegative safe whole count');
      } else if (!(type === 'cost' && field === null) &&
          (typeof field !== 'string' || field.length > 128 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(field))) {
        throw Error(group + '.' + key + ': use an exact USD string (up to six decimal places), or leave an unknown cost blank');
      }
      target[key] = field;
    }
  }
  return value;
}
function snapshot() {
  const result = {title:$('scenario-name').value,fields:{}};
  for (const [, group, fields] of GROUPS)
    for (const [key] of fields) result.fields[group + '-' + key] = $(group + '-' + key).value;
  return result;
}
function restore(snapshot) {
  $('scenario-name').value = snapshot.title;
  for (const [id,value] of Object.entries(snapshot.fields)) $(id).value = value;
}
function applyScenario(scenario) {
  $('scenario-name').value = scenario.title;
  for (const [, group, fields] of GROUPS) {
    for (const [key] of fields) {
      const original = group === 'workload' ? scenario.workload[key] : scenario.costs[group][key];
      $(group + '-' + key).value = original === null ? '' : String(original);
    }
  }
}
function busy(value) {
  for (const id of ['calculate','save-scenario','open-scenario','reset']) $(id).disabled = value;
  $('undo-scenario').disabled = value || previous === null;
  $('inputs').setAttribute('aria-busy',String(value));
}
function invalidate(message) {
  revision++;
  if (active) active.controller.abort();
  active = null; last = null;
  $('results').classList.add('hidden');
  $('download-json').disabled = true; $('download-md').disabled = true;
  $('error').textContent = '';
  $('scenario-status').textContent = message;
  busy(false);
}
function begin(message) {
  invalidate(message);
  const operation = {revision,controller:new AbortController()};
  active = operation; busy(true); return operation;
}
const current = operation => active === operation && operation.revision === revision;
function finish(operation) { if (current(operation)) { active = null; busy(false); } }
function formScenario() {
  const values = {schema:SCHEMA,title:$('scenario-name').value,workload:{},costs:{}};
  for (const [, group, fields] of GROUPS) {
    const target = group === 'workload' ? values.workload : (values.costs[group] = {});
    for (const [key, , type] of fields) {
      const val = $(group + '-' + key).value.trim();
      if (type === 'integer') {
        if (!/^(0|[1-9][0-9]*)$/.test(val) || val.length > 16) throw Error(group + '.' + key + ': enter a nonnegative safe whole count');
        target[key] = Number(val);
      } else target[key] = type === 'cost' && val === '' ? null : val;
    }
  }
  return scenarioInput(values);
}
async function evaluate(scenario, operation) {
  const res = await fetch('/evaluate', {method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(scenario),signal:operation.controller.signal});
  const output = await res.json();
  if (!res.ok) throw Error(output.error || 'Evaluation failed');
  return output;
}
function publishResult(output) {
  last = output;
  showReport(output.report);
  $('results-title').textContent = output.report.title + ' — monthly results';
  $('download-json').disabled = false; $('download-md').disabled = false;
}
function operationError(error, operation) {
  if (!current(operation)) return;
  $('error').textContent = String(error.message);
  $('scenario-status').textContent = 'Inputs retained. Correct the issue and calculate again.';
}
async function calculate(event, save = false) {
  event?.preventDefault();
  const operation = begin(save ? 'Validating editable scenario…' : 'Calculating current assumptions…');
  try {
    const scenario = formScenario();
    const output = await evaluate(scenario, operation);
    if (!current(operation)) return;
    publishResult(output);
    if (save) download('merchant-rail-scenario.json',JSON.stringify(scenario,null,2)+'\n','application/json');
    $('scenario-status').textContent = save
      ? 'Scenario download prepared. Reopen this JSON to restore these assumptions.'
      : 'Results reflect the current assumptions. Save scenario JSON to keep an editable copy.';
    if (!save) $('results').scrollIntoView({behavior:'smooth', block:'start'});
  } catch (e) { operationError(e,operation); }
  finally { finish(operation); }
}
async function openScenario(file) {
  if (!file) return;
  const before = snapshot();
  const operation = begin('Opening and validating scenario…');
  try {
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES)
      throw Error('Choose a scenario JSON file no larger than 128 KiB.');
    const data = await file.arrayBuffer();
    if (data.byteLength > MAX_FILE_BYTES) throw Error('Scenario exceeds 128 KiB.');
    let raw;
    try { raw = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)); }
    catch { throw Error('This file is not valid UTF-8 scenario JSON.'); }
    const scenario = scenarioInput(raw);
    if (!current(operation)) return;
    const output = await evaluate(scenario,operation);
    if (!current(operation)) return;
    previous = before; applyScenario(scenario); publishResult(output);
    $('scenario-status').textContent = 'Scenario opened. Original inputs restored; results recalculated locally. Undo restores the previous form.';
    $('scenario-name').focus();
  } catch (e) { operationError(e,operation); }
  finally { finish(operation); }
}
async function start() {
  busy(true);
  try {
    const res = await fetch('/sample.json');
    if (!res.ok) throw Error('Unable to load local sample');
    sample = scenarioInput(await res.json());
    addInputs(); applyScenario(sample);
    invalidate('Illustrative sample loaded. Save scenario JSON to keep your edits.');
    $('inputs').addEventListener('input', event => {
      if (event.target === $('scenario-file')) return;
      invalidate('Assumptions changed. Calculate again before downloading a report.');
    });
    $('inputs').addEventListener('submit', calculate);
    $('save-scenario').addEventListener('click', event => calculate(event,true));
    $('open-scenario').addEventListener('click', () => $('scenario-file').click());
    $('scenario-file').addEventListener('change', () => {
      const file = $('scenario-file').files?.[0]; $('scenario-file').value = '';
      return openScenario(file);
    });
    $('reset').addEventListener('click', () => {
      previous = snapshot(); applyScenario(sample);
      invalidate('Illustrative sample restored. Undo restores the previous form.');
    });
    $('undo-scenario').addEventListener('click', () => {
      if (!previous) return;
      restore(previous); previous = null;
      invalidate('Previous form restored. Calculate again for current results.');
      $('scenario-name').focus();
    });
    $('download-json').addEventListener('click', () => {if(last) download('merchant-rail-economics.json', JSON.stringify(last.report,null,2)+'\n', 'application/json');});
    $('download-md').addEventListener('click', () => {if(last) download('merchant-rail-economics.md', last.markdown, 'text/markdown');});
  } catch (e) { $('error').textContent = String(e.message); }
}
start();
