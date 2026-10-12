// MIT. Commercial scenarios over a saved SF97 review and its original analyzer.
import { createHash } from 'node:crypto';
import { analyze, merchantTerms } from '../analyze.mjs';

export const SCENARIO_REVIEW_SCHEMA = 'stellar-forge.merchant-scenario-review.v1';
const MICRO = 1_000_000n;
const MAX_TARGET = BigInt(Number.MAX_SAFE_INTEGER);
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
const canonical = value => JSON.stringify(value, (_, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const digest = value => createHash('sha256').update(value).digest('hex');
const fingerprint = value => digest(canonical(value));
const fail = (code, message) => Object.assign(new TypeError(message), {code, status:422});
const routeFields = ['unitPriceUsd','priceBasis','perFulfilledUsd','perChallengeUsd','monthlyPaidTarget'];

function record(value, label) {
  if (!object(value)) throw fail('SCENARIO_INPUT_INVALID', `${label} must be an object.`);
  return value;
}

function allowed(value, fields, label) {
  record(value, label);
  const invalid = Object.keys(value).find(key => !fields.includes(key));
  if (invalid) throw fail('SCENARIO_INPUT_INVALID', `${label} has an unsupported field: ${invalid}.`);
}

// The original analyzer validates merchant inputs. These exact conversions are
// for its returned decimal values and the additional planning equations only.
function money(value, label = 'USD amount') {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)(\.\d{1,6})?$/.test(value))
    throw fail('SCENARIO_AMOUNT_INVALID', `${label} must be a decimal string with at most six places.`);
  const negative = value.startsWith('-'), unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const result = BigInt(whole) * MICRO + BigInt(fraction.padEnd(6, '0'));
  return negative ? -result : result;
}

function decimal(value, places) {
  if (value === null) return null;
  const unit = 10n ** BigInt(places), negative = value < 0n, absolute = negative ? -value : value;
  const fraction = String(absolute % unit).padStart(places, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${absolute / unit}${fraction ? '.' + fraction : ''}`;
}

const usd = value => decimal(value, 6);
const ceil = (numerator, denominator) => numerator <= 0n ? 0n : (numerator + denominator - 1n) / denominator;
const max = (left, right) => left > right ? left : right;
const percent = (numerator, denominator) => numerator === null || denominator === 0n
  ? null : decimal(numerator * MICRO / denominator, 4);
const difference = (left, right) => left === null || right === null ? null : usd(money(left) - money(right));

function gcd(left, right) {
  while (right) [left, right] = [right, left % right];
  return left;
}

function marginInput(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d?)(\.\d{1,4})?$/.test(value))
    throw fail('SCENARIO_MARGIN_INVALID', 'Target margin must be a decimal string from 0 to less than 100, with at most four places.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
}

function goalInput(value) {
  if (value === undefined) return null;
  allowed(value, ['monthlyContributionUsd','marginPct'], 'scenario goal');
  const result = {};
  if (own(value, 'monthlyContributionUsd')) {
    if (typeof value.monthlyContributionUsd !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value.monthlyContributionUsd))
      throw fail('SCENARIO_GOAL_INVALID', 'Monthly contribution target must be a nonnegative USD string with at most six places.');
    result.monthlyContributionUsd = usd(money(value.monthlyContributionUsd));
  }
  if (own(value, 'marginPct')) result.marginPct = decimal(marginInput(value.marginPct), 4);
  return Object.keys(result).length ? result : null;
}

function commercial(terms) {
  return {merchantName:terms.merchantName, sharedMonthlyFixedUsd:terms.sharedMonthlyFixedUsd,
    routes:Object.fromEntries(Object.entries(terms.routes).map(([id, term]) => [id,
      Object.fromEntries(routeFields.map(field => [field, clone(term[field])]))]))};
}

function assumptionBasis(label, original) {
  return `Planning assumption (${label}); original basis: ${original}`.slice(0, 300);
}

function scenarioInput(value, index, sourceCommercial, selectedRoutes) {
  allowed(value, ['id','label','sharedMonthlyFixedUsd','routes','goal'], `scenario ${index + 1}`);
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.id) || value.id === 'baseline')
    throw fail('SCENARIO_ID_INVALID', 'Use a unique scenario ID of 1–64 letters, digits, underscores or hyphens; baseline is reserved.');
  if (typeof value.label !== 'string' || !value.label.trim() || value.label.length > 120)
    throw fail('SCENARIO_LABEL_INVALID', 'Give each scenario a label of 1–120 characters.');
  const input = {id:value.id, label:value.label.trim(), routes:{}};
  if (own(value, 'sharedMonthlyFixedUsd')) input.sharedMonthlyFixedUsd = value.sharedMonthlyFixedUsd;
  const patches = value.routes === undefined ? {} : record(value.routes, 'scenario routes');
  input.routes = Object.fromEntries(Object.entries(patches).map(([id, patch]) => {
    if (!own(sourceCommercial.routes, id)) throw fail('SCENARIO_ROUTE_UNKNOWN', `The saved seller has no route ${id}.`);
    if (!selectedRoutes.has(id)) throw fail('SCENARIO_ROUTE_OUTSIDE_REVIEW', `Route ${id} is outside this saved review's selected route scope.`);
    allowed(patch, routeFields, `scenario route ${id}`);
    const next = clone(patch);
    if (own(next, 'unitPriceUsd') && next.unitPriceUsd !== sourceCommercial.routes[id].unitPriceUsd && !own(next, 'priceBasis'))
      next.priceBasis = assumptionBasis(input.label, sourceCommercial.routes[id].priceBasis);
    return [id, next];
  }));
  const goal = goalInput(value.goal);
  if (goal) input.goal = goal;
  return input;
}

function applyInput(sourceCommercial, input) {
  const next = clone(sourceCommercial);
  if (own(input, 'sharedMonthlyFixedUsd')) next.sharedMonthlyFixedUsd = input.sharedMonthlyFixedUsd;
  for (const [id, patch] of Object.entries(input.routes)) next.routes[id] = {...next.routes[id], ...patch};
  return next;
}

function metrics(report) {
  const overview = report.overview, gross = money(overview.plannedMonthlyTargetGrossUsd);
  const variable = money(overview.plannedMonthlyTargetVariableCostsUsd);
  const after = money(overview.plannedMonthlyTargetContributionAfterFixedUsd);
  const before = variable === null ? null : gross - variable;
  const unknownInputs = [];
  if (overview.sharedMonthlyFixedUsd === null) unknownInputs.push('sharedMonthlyFixedUsd');
  const routes = report.routes.map(row => {
    const quote = money(row.quoteUsd), cost = money(row.variablePerFulfilledUsd);
    if (cost === null) unknownInputs.push(`routes.${row.routeId}.perFulfilledUsd`);
    const contribution = cost === null ? null : quote - cost;
    return {routeId:row.routeId, method:row.method, path:row.path, paidTargetMonth:row.paidTargetMonth,
      quoteUsd:row.quoteUsd, perFulfilledUsd:row.variablePerFulfilledUsd,
      unitContributionUsd:usd(contribution), unitMarginPct:percent(contribution, quote),
      breakEvenUnitPriceUsd:usd(cost), plannedGrossUsd:row.plannedMonthlyTargetGrossUsd,
      plannedContributionBeforeFixedUsd:row.plannedMonthlyTargetContributionBeforeFixedUsd};
  });
  return {scope:overview.sharedFixedCostApplied === false ? 'SELECTED_CURRENT_ROUTE' : 'CURRENT_SELLER',
    plannedPaidRequests:routes.reduce((sum, row) => sum + BigInt(row.paidTargetMonth), 0n).toString(),
    grossUsd:usd(gross), variableCostsUsd:usd(variable), contributionBeforeFixedUsd:usd(before),
    sharedFixedUsd:overview.sharedMonthlyFixedUsd, contributionAfterFixedUsd:usd(after),
    marginBeforeFixedPct:percent(before, gross), marginAfterFixedPct:percent(after, gross), unknownInputs, routes};
}

function attainment(value, goal) {
  const net = money(value.contributionAfterFixedUsd), gross = money(value.grossUsd);
  const contributionTargetMet = goal?.monthlyContributionUsd === undefined ? null
    : net === null ? null : net >= money(goal.monthlyContributionUsd);
  const marginTargetMet = goal?.marginPct === undefined ? null
    : net === null || gross === 0n ? null : net * MICRO >= gross * marginInput(goal.marginPct);
  const checks = [contributionTargetMet, marginTargetMet].filter(item => item !== null);
  const expected = goal ? Object.keys(goal).length : 0;
  return {monthlyContributionUsd:value.contributionAfterFixedUsd, marginPct:value.marginAfterFixedPct,
    contributionTargetMet, marginTargetMet,
    targetMet:!expected ? null : checks.includes(false) ? false : checks.length === expected ? true : null};
}

function scopeReason(value) {
  if (value.scope !== 'CURRENT_SELLER') return {reason:'Shared monthly fixed cost has no allocation in this route-filtered review.',
    requiredInputs:['wholeSellerReview']};
  if (value.unknownInputs.length) return {reason:'Enter the unknown fulfillment and shared fixed costs to calculate this whole-seller goal.',
    requiredInputs:value.unknownInputs};
  return null;
}

function scenarioProvenance(provenance, terms) {
  return {...clone(provenance), terms:digest(JSON.stringify(terms, null, 2) + '\n'),
    ...(typeof provenance.terms === 'string' ? {planningSourceTerms:provenance.terms} : {})};
}

function evaluate(context, inputs) {
  const terms = merchantTerms(context.seller, inputs);
  const report = analyze(context.seller, context.observation, terms, scenarioProvenance(context.provenance, terms));
  report.generatedAt = context.generatedAt;
  return {commercial:commercial(terms), terms, overview:report.overview, metrics:metrics(report), report};
}

function suggestion(context, current, goal, kind) {
  const byPrice = kind.endsWith('_PRICE'), isBreakEven = kind.startsWith('BREAK_EVEN');
  const label = `${isBreakEven ? 'Break even' : 'Reach target'} by ${byPrice ? 'unit price' : 'planned volume'}`;
  const base = {kind, label, status:'UNAVAILABLE'};
  const blocked = scopeReason(current.metrics);
  if (blocked) return {...base, ...blocked};
  const totalCost = money(current.metrics.variableCostsUsd) + money(current.metrics.sharedFixedUsd);
  const netTarget = goal.monthlyContributionUsd === undefined ? 0n : money(goal.monthlyContributionUsd);
  const margin = goal.marginPct === undefined ? null : marginInput(goal.marginPct);
  const proposed = clone(current.commercial), details = {};

  if (byPrice) {
    const volume = BigInt(current.metrics.plannedPaidRequests);
    if (!volume) return {...base, reason:'Enter a positive monthly paid target to solve a unit price at that volume.',
      requiredInputs:['routes.monthlyPaidTarget']};
    let requiredGross = totalCost + netTarget;
    if (margin !== null) requiredGross = max(requiredGross, max(1n, ceil(totalCost * MICRO, MICRO - margin)));
    const currentGross = money(current.metrics.grossUsd);
    const uplift = ceil(requiredGross - currentGross, volume);
    details.priceUpliftUsd = usd(uplift);
    details.requiredGrossUsd = usd(requiredGross);
    details.method = 'COMMON_MICRO_USD_UPLIFT_AT_SELECTED_TARGETS';
    for (const route of current.metrics.routes) {
      if (!BigInt(route.paidTargetMonth) || !uplift) continue;
      proposed.routes[route.routeId].unitPriceUsd = usd(money(route.quoteUsd) + uplift);
      proposed.routes[route.routeId].priceBasis = assumptionBasis(label, proposed.routes[route.routeId].priceBasis);
    }
  } else {
    const active = current.metrics.routes.filter(row => BigInt(row.paidTargetMonth) > 0n);
    if (!active.length) return {...base, reason:'Enter a positive monthly paid target to define the route mix.',
      requiredInputs:['routes.monthlyPaidTarget']};
    const divisor = active.reduce((value, row) => gcd(value, BigInt(row.paidTargetMonth)), 0n);
    const basket = active.map(row => ({routeId:row.routeId, requests:BigInt(row.paidTargetMonth) / divisor,
      quote:money(row.quoteUsd), cost:money(row.perFulfilledUsd)}));
    const basketGross = basket.reduce((sum, row) => sum + row.requests * row.quote, 0n);
    const basketVariable = basket.reduce((sum, row) => sum + row.requests * row.cost, 0n);
    const basketContribution = basketGross - basketVariable, fixed = money(current.metrics.sharedFixedUsd);
    details.currentBaskets = divisor.toString();
    details.basketGrossUsd = usd(basketGross);
    details.basketContributionUsd = usd(basketContribution);
    details.method = 'SMALLEST_INTEGER_BASKET_PRESERVING_SELECTED_ROUTE_MIX';
    if (basketContribution <= 0n) return {...base, ...details,
      reason:'The selected route mix has no positive contribution per basket. A higher volume cannot cover fixed costs or a positive contribution target.'};
    let requiredBaskets = ceil(fixed + netTarget, basketContribution);
    if (margin !== null) {
      if (basketGross === 0n) return {...base, ...details, reason:'A zero-gross route mix has no defined contribution margin.'};
      const denominator = basketContribution * MICRO - basketGross * margin;
      if (denominator < 0n || (denominator === 0n && fixed > 0n))
        return {...base, ...details, reason:'The route mix cannot reach the requested margin at these unit prices and fulfillment costs.'};
      const marginBaskets = denominator === 0n ? 1n : max(1n, ceil(fixed * MICRO, denominator));
      requiredBaskets = max(requiredBaskets, marginBaskets);
    }
    details.requiredBaskets = requiredBaskets.toString();
    const targets = new Map(basket.map(row => [row.routeId, row.requests * requiredBaskets]));
    details.volumes = current.metrics.routes.map(row => ({routeId:row.routeId,
      monthlyPaidTarget:(targets.get(row.routeId) ?? 0n).toString()}));
    if (details.volumes.some(row => BigInt(row.monthlyPaidTarget) > MAX_TARGET))
      return {...base, ...details, reason:'The required route volume exceeds the original analyzer\'s safe-integer monthly target range.'};
    for (const row of details.volumes) proposed.routes[row.routeId].monthlyPaidTarget = Number(row.monthlyPaidTarget);
  }

  const result = evaluate(context, proposed), goalMet = attainment(result.metrics, goal);
  if (goalMet.targetMet !== true) throw fail('SCENARIO_GOAL_UNRESOLVED', 'The original analyzer did not confirm the proposed planning goal.');
  return {...base, status:'READY', ...details, commercial:result.commercial, terms:result.terms,
    overview:result.overview, metrics:result.metrics, goalMet};
}

function goals(context, current, requested) {
  const breakEven = {monthlyContributionUsd:'0'};
  const suggestions = [suggestion(context, current, breakEven, 'BREAK_EVEN_PRICE'),
    suggestion(context, current, breakEven, 'BREAK_EVEN_VOLUME')];
  if (requested) suggestions.push(suggestion(context, current, requested, 'TARGET_PRICE'),
    suggestion(context, current, requested, 'TARGET_VOLUME'));
  return {requested, current:attainment(current.metrics, requested), suggestions};
}

function marginDifference(leftNet, leftGross, rightNet, rightGross) {
  const left = money(leftNet), right = money(rightNet), lg = money(leftGross), rg = money(rightGross);
  return left === null || right === null || lg === 0n || rg === 0n ? null
    : decimal((left * rg - right * lg) * MICRO / (lg * rg), 4);
}

function deltas(current, baseline) {
  const result = {plannedPaidRequests:(BigInt(current.metrics.plannedPaidRequests) - BigInt(baseline.metrics.plannedPaidRequests)).toString()};
  for (const field of ['grossUsd','variableCostsUsd','contributionBeforeFixedUsd','sharedFixedUsd','contributionAfterFixedUsd'])
    result[field] = difference(current.metrics[field], baseline.metrics[field]);
  result.marginBeforeFixedPercentagePoints = marginDifference(current.metrics.contributionBeforeFixedUsd,
    current.metrics.grossUsd, baseline.metrics.contributionBeforeFixedUsd, baseline.metrics.grossUsd);
  result.marginAfterFixedPercentagePoints = marginDifference(current.metrics.contributionAfterFixedUsd,
    current.metrics.grossUsd, baseline.metrics.contributionAfterFixedUsd, baseline.metrics.grossUsd);
  result.routeChanges = Object.keys(current.commercial.routes).flatMap(routeId => {
    const before = baseline.commercial.routes[routeId], after = current.commercial.routes[routeId];
    const fields = routeFields.filter(field => before[field] !== after[field]);
    return fields.length ? [{routeId, fields, before:clone(before), after:clone(after)}] : [];
  });
  return result;
}

/**
 * Review up to twelve explicit commercial plans against one immutable source.
 * The caller owns private version storage, byte-source hashes and the selected
 * plan's application. Every report and proposed goal uses the original analyzer.
 * Pass includeReports:false for compact comparisons: each full analyzer report
 * is released after extracting the source-bound calculations and terms. Full
 * and compact modes have the same review identity. The selected full report can
 * be generated again from these immutable inputs for its original HTML export.
 */
export function createScenarioReview({seller, observation, terms, scenarios = [], provenance = {}, includeReports = true} = {}) {
  record(provenance, 'source provenance');
  if (typeof includeReports !== 'boolean') throw fail('SCENARIO_INPUT_INVALID', 'includeReports must be a boolean.');
  if (!Array.isArray(scenarios) || scenarios.length > 12)
    throw fail('SCENARIO_COUNT_INVALID', 'A comparison accepts at most twelve scenarios.');
  const generatedAt = new Date().toISOString();
  // Validate the saved binding before normalizing any alternative. In particular,
  // merchantTerms must not be allowed to rebind stale source terms silently.
  const original = analyze(seller, observation, terms, clone(provenance));
  original.generatedAt = generatedAt;
  const sourceCommercial = commercial(terms);
  const source = {sellerCanonicalSha256:fingerprint(seller), observationCanonicalSha256:fingerprint(observation),
    termsCanonicalSha256:fingerprint(terms), provenance:clone(provenance)};
  const selectedRoutes = new Set(original.routes.map(row => row.routeId));
  const inputs = scenarios.map((value, index) => scenarioInput(value, index, sourceCommercial, selectedRoutes));
  if (new Set(inputs.map(value => value.id)).size !== inputs.length)
    throw fail('SCENARIO_ID_DUPLICATE', 'Every scenario in a comparison needs its own ID.');
  const context = {seller, observation, provenance, generatedAt};
  const baseline = {id:'baseline', label:'Saved review', input:null, commercial:sourceCommercial,
    terms:clone(terms), overview:original.overview, metrics:metrics(original),
    ...(includeReports ? {report:original} : {}), delta:null};
  baseline.goals = goals(context, baseline, null);
  const alternatives = inputs.map(input => {
    const result = evaluate(context, applyInput(sourceCommercial, input));
    if (!includeReports) delete result.report;
    const row = {id:input.id, label:input.label, input, ...result};
    row.delta = deltas(row, baseline);
    row.goals = goals(context, row, input.goal ?? null);
    return row;
  });
  return {schema:SCENARIO_REVIEW_SCHEMA, reviewSha256:fingerprint({schema:SCENARIO_REVIEW_SCHEMA, source, inputs}),
    source, generatedAt, baseline, scenarios:alternatives};
}
