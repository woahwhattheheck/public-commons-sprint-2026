// MIT. Exact monthly tariff planning over the original SF97 merchant review.
import { createHash } from 'node:crypto';
import { analyze } from '../analyze.mjs';

export const TARIFF_REVIEW_SCHEMA = 'stellar-forge.merchant-tariff-review.v1';
export const TARIFF_QUOTE_SCHEMA = 'stellar-forge.merchant-tariff-quote.v1';
export const TARIFF_LIMITS = Object.freeze({ tariffs:12, volumes:24, tiers:64 });

const MICRO = 1_000_000n;
const MAX_QUANTITY = BigInt(Number.MAX_SAFE_INTEGER);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const canonical = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fingerprint = value => createHash('sha256').update(canonical(value)).digest('hex');
const fail = (code, message, status = 422) => Object.assign(new TypeError(message), { code, status });
const clone = value => structuredClone(value);

function record(value, label, fields = null) {
  if (!plain(value)) throw fail('TARIFF_INPUT_INVALID', label + ' must be an object.');
  if (fields) {
    const unsupported = Object.keys(value).find(key => !fields.includes(key));
    if (unsupported) throw fail('TARIFF_INPUT_INVALID', label + ' has an unsupported field: ' + unsupported + '.');
  }
  return value;
}

function quantity(value, label = 'Quantity') {
  let number;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) number = BigInt(value);
  else if (typeof value === 'string' && /^(0|[1-9]\d{0,15})$/.test(value)) number = BigInt(value);
  else throw fail('TARIFF_QUANTITY_INVALID', label + ' must be a nonnegative safe integer or its canonical integer string.');
  if (number > MAX_QUANTITY)
    throw fail('TARIFF_QUANTITY_INVALID', label + ' exceeds the original merchant monthly target range.');
  return number;
}

function microUsd(value, label = 'USD amount') {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value))
    throw fail('TARIFF_AMOUNT_INVALID', label + ' must be a nonnegative USD decimal string with at most six places.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * MICRO + BigInt(fraction.padEnd(6, '0'));
}

function decimal(value, places = 6) {
  if (value === null) return null;
  const scale = 10n ** BigInt(places), negative = value < 0n, absolute = negative ? -value : value;
  const tail = String(absolute % scale).padStart(places, '0').replace(/0+$/, '');
  return (negative ? '-' : '') + String(absolute / scale) + (tail ? '.' + tail : '');
}

const usd = value => decimal(value, 6);
const ceil = (numerator, denominator) => (numerator + denominator - 1n) / denominator;
const min = (left, right) => left < right ? left : right;

function gcd(left, right) {
  while (right) [left, right] = [right, left % right];
  return left;
}

// Fractions are authoritative; the display bounds retain twelve decimal places.
function unitFraction(totalMicroUsd, units) {
  if (!units) return null;
  const denominator = units * MICRO, divisor = gcd(totalMicroUsd, denominator);
  const scaled = totalMicroUsd * 1_000_000_000_000n;
  return {
    numerator:String(totalMicroUsd / divisor), denominator:String(denominator / divisor),
    floorUsd:decimal(scaled / denominator, 12), ceilingUsd:decimal(ceil(scaled, denominator), 12)
  };
}

function margin(contribution, gross) {
  return contribution === null || gross === 0n ? null : decimal(contribution * MICRO / gross, 4);
}

/**
 * Each upTo is a cumulative inclusive quantity. The final null is unbounded.
 * A graduated schedule prices each band separately. A volume schedule selects
 * one band from the entire monthly quantity and applies its rate to all units.
 */
export function normalizeTariff(input) {
  record(input, 'Tariff', ['id', 'label', 'routeId', 'mode', 'tiers']);
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(input.id) || input.id === 'baseline')
    throw fail('TARIFF_ID_INVALID', 'Use a tariff ID of 1-64 letters, digits, underscores or hyphens; baseline is reserved.');
  if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 120
      || /[\u0000-\u001f\u007f]/.test(input.label))
    throw fail('TARIFF_LABEL_INVALID', 'Give each tariff a label of 1-120 printable characters.');
  if (typeof input.routeId !== 'string' || !input.routeId || input.routeId.length > 2000
      || /[\u0000-\u001f\u007f]/.test(input.routeId))
    throw fail('TARIFF_ROUTE_INVALID', 'Select an original merchant route ID.');
  if (!['graduated', 'volume'].includes(input.mode))
    throw fail('TARIFF_MODE_INVALID', 'Choose graduated or volume pricing.');
  if (!Array.isArray(input.tiers) || !input.tiers.length || input.tiers.length > TARIFF_LIMITS.tiers)
    throw fail('TARIFF_TIERS_INVALID', 'A tariff needs 1-' + TARIFF_LIMITS.tiers + ' tiers.');

  let previous = 0n;
  const tiers = input.tiers.map((tier, index) => {
    record(tier, 'Tier ' + (index + 1), ['upTo', 'unitPriceUsd']);
    const last = index === input.tiers.length - 1;
    if (last ? tier.upTo !== null : tier.upTo === null)
      throw fail('TARIFF_BAND_INVALID', 'Only the final tier has an unbounded null upTo.');
    let cap = null;
    if (tier.upTo !== null) {
      cap = quantity(tier.upTo, 'Tier ' + (index + 1) + ' upper quantity');
      if (cap <= previous)
        throw fail('TARIFF_BAND_INVALID', 'Finite tier quantities must be positive and strictly increasing.');
      previous = cap;
    }
    if (typeof tier.unitPriceUsd !== 'string' || tier.unitPriceUsd.length > 64)
      throw fail('TARIFF_AMOUNT_INVALID', 'Tier unit price must be a USD string of at most 64 characters.');
    const rate = microUsd(tier.unitPriceUsd, 'Tier ' + (index + 1) + ' unit price');
    return { upTo:cap === null ? null : String(cap), unitPriceUsd:usd(rate) };
  });
  return { id:input.id, label:input.label.trim(), routeId:input.routeId, mode:input.mode, tiers };
}

function calculate(tariff, units) {
  if (!units) return { total:0n, lines:[], selectedTier:null };
  let lower = 0n, total = 0n, selectedTier = null;
  const lines = [];
  for (let index = 0; index < tariff.tiers.length; index++) {
    const tier = tariff.tiers[index], cap = tier.upTo === null ? null : BigInt(tier.upTo);
    const price = microUsd(tier.unitPriceUsd);
    if (tariff.mode === 'volume') {
      if (cap !== null && units > cap) { lower = cap; continue; }
      total = units * price;
      lines.push({ tierIndex:index, lowerExclusiveQuantity:String(lower), upTo:tier.upTo,
        quantity:String(units), unitPriceUsd:tier.unitPriceUsd, subtotalUsd:usd(total) });
      selectedTier = index;
      break;
    }
    const upper = cap === null ? units : min(units, cap), used = upper - lower;
    if (used > 0n) {
      const subtotal = used * price;
      total += subtotal;
      lines.push({ tierIndex:index, lowerExclusiveQuantity:String(lower), upTo:tier.upTo,
        quantity:String(used), unitPriceUsd:tier.unitPriceUsd, subtotalUsd:usd(subtotal) });
      selectedTier = index;
    }
    if (units <= upper) break;
    lower = cap;
  }
  return { total, lines, selectedTier };
}

/** Exact schedule result and the separately derived six-place uniform quote. */
export function quoteTariff(input, requestedQuantity) {
  const tariff = normalizeTariff(input), units = quantity(requestedQuantity);
  const calculation = calculate(tariff, units);
  const uniform = units ? ceil(calculation.total, units) : null;
  const uniformGross = uniform === null ? null : uniform * units;
  const next = units < MAX_QUANTITY ? calculate(tariff, units + 1n) : null;
  return {
    schema:TARIFF_QUOTE_SCHEMA, tariffId:tariff.id, tariffSha256:fingerprint(tariff), mode:tariff.mode,
    quantity:String(units), totalMicroUsd:String(calculation.total), totalUsd:usd(calculation.total),
    selectedTier:calculation.selectedTier, lines:calculation.lines,
    effectiveUnitUsd:unitFraction(calculation.total, units),
    chosenUniformQuoteUsd:usd(uniform), uniformGrossUsd:usd(uniformGross),
    roundingDeltaUsd:uniformGross === null ? null : usd(uniformGross - calculation.total),
    rounding:'CEILING_TO_MICRO_USD_PER_REQUEST',
    nextQuantity:next === null ? null : String(units + 1n),
    nextTotalUsd:next === null ? null : usd(next.total),
    nextGrossChangeUsd:next === null ? null : usd(next.total - calculation.total),
    nextUnitPriceUsd:next === null ? null : tariff.tiers[next.selectedTier].unitPriceUsd
  };
}

function boundaries(tariff) {
  return tariff.tiers.flatMap((tier, index) => {
    if (tier.upTo === null || BigInt(tier.upTo) === MAX_QUANTITY) return [];
    const beforeQuantity = BigInt(tier.upTo), before = calculate(tariff, beforeQuantity);
    const after = calculate(tariff, beforeQuantity + 1n), change = after.total - before.total;
    return [{
      afterTierIndex:index, beforeQuantity:String(beforeQuantity), afterQuantity:String(beforeQuantity + 1n),
      beforeTotalUsd:usd(before.total), afterTotalUsd:usd(after.total),
      grossChangeUsd:usd(change), decreasesGross:change < 0n
    }];
  });
}

function scenarioFor(tariff, quote, comparisonId) {
  if (quote.quantity === '0') return null;
  return {
    id:comparisonId,
    label:(tariff.label.slice(0, 75) + ' at ' + quote.quantity + ' requests/month').slice(0, 120),
    routes:{
      [tariff.routeId]:{
        unitPriceUsd:quote.chosenUniformQuoteUsd,
        priceBasis:'Uniform quote from ' + tariff.mode + ' tariff ' + quote.tariffSha256
          + ' at ' + quote.quantity + ' planned requests/month; CEILING(total micro-USD / quantity).',
        monthlyPaidTarget:Number(quote.quantity)
      }
    }
  };
}

function comparison(tariff, requestedQuantity, row, reviewSha256) {
  const quote = quoteTariff(tariff, requestedQuantity), units = BigInt(quote.quantity);
  const baselineGross = microUsd(row.quoteUsd) * units;
  const unitCost = row.variablePerFulfilledUsd === null ? null : microUsd(row.variablePerFulfilledUsd);
  const cost = unitCost === null ? null : unitCost * units;
  const gross = BigInt(quote.totalMicroUsd);
  const baselineContribution = cost === null ? null : baselineGross - cost;
  const contribution = cost === null ? null : gross - cost;
  const uniformGross = quote.uniformGrossUsd === null ? null : microUsd(quote.uniformGrossUsd);
  const uniformContribution = uniformGross === null || cost === null ? null : uniformGross - cost;
  const comparisonId = fingerprint({ reviewSha256, tariffId:tariff.id, quantity:quote.quantity });
  return {
    id:comparisonId, tariffId:tariff.id, routeId:tariff.routeId, quantity:quote.quantity,
    method:row.method, path:row.path, quote,
    baseline:{
      quoteUsd:row.quoteUsd, priceBasis:row.priceBasis, totalUsd:usd(baselineGross),
      contributionBeforeFixedUsd:usd(baselineContribution),
      marginBeforeFixedPct:margin(baselineContribution, baselineGross)
    },
    costs:{
      basis:'FULFILLED_REQUESTS_ONLY', perFulfilledUsd:row.variablePerFulfilledUsd,
      perChallengeUsd:row.perChallengeUsd, variableCostsUsd:usd(cost),
      unknownInputs:unitCost === null ? ['routes.' + tariff.routeId + '.perFulfilledUsd'] : []
    },
    contributionBeforeFixedUsd:usd(contribution), marginBeforeFixedPct:margin(contribution, gross),
    grossDeltaUsd:usd(gross - baselineGross),
    contributionDeltaUsd:cost === null ? null : usd(contribution - baselineContribution),
    uniformProjection:{
      grossUsd:usd(uniformGross), variableCostsUsd:quote.quantity === '0' ? null : usd(cost),
      contributionBeforeFixedUsd:usd(uniformContribution),
      marginBeforeFixedPct:uniformGross === null ? null : margin(uniformContribution, uniformGross),
      grossDeltaUsd:uniformGross === null ? null : usd(uniformGross - baselineGross)
    },
    scenario:scenarioFor(tariff, quote, comparisonId)
  };
}

/**
 * Evaluate explicit monthly targets from the saved native seller review.
 * The original analyzer validates payment bindings and selected route scope.
 * Each comparison changes one route at one volume; shared fixed cost remains
 * on the whole-seller review. Explicit selection passes the included scenario
 * to the original planner, which calculates the complete merchant forecast.
 */
export function createTariffReview({ seller, observation, terms, tariffs, volumes, provenance = {} } = {}) {
  record(provenance, 'Source provenance');
  if (!Array.isArray(tariffs) || !tariffs.length || tariffs.length > TARIFF_LIMITS.tariffs)
    throw fail('TARIFF_COUNT_INVALID', 'Compare 1-' + TARIFF_LIMITS.tariffs + ' tariff schedules.');
  if (!Array.isArray(volumes) || !volumes.length || volumes.length > TARIFF_LIMITS.volumes)
    throw fail('TARIFF_VOLUMES_INVALID', 'Enter 1-' + TARIFF_LIMITS.volumes + ' explicit monthly quantities.');
  const normalized = tariffs.map(normalizeTariff);
  if (new Set(normalized.map(tariff => tariff.id)).size !== normalized.length)
    throw fail('TARIFF_ID_DUPLICATE', 'Every tariff in a review needs its own ID.');
  const quantities = volumes.map((value, index) => String(quantity(value, 'Monthly quantity ' + (index + 1))));
  if (new Set(quantities).size !== quantities.length)
    throw fail('TARIFF_VOLUME_DUPLICATE', 'Each monthly quantity must appear once in a review.');

  // Preserve the analyzer's exact checks before using any commercial term.
  const original = analyze(seller, observation, terms, clone(provenance));
  const byRoute = new Map(original.routes.map(row => [row.routeId, row]));
  const sellerRoutes = new Set(seller.routes.map(route => route.id));
  for (const tariff of normalized) {
    if (!sellerRoutes.has(tariff.routeId))
      throw fail('TARIFF_ROUTE_UNKNOWN', 'The saved seller has no route ' + tariff.routeId + '.');
    if (!byRoute.has(tariff.routeId))
      throw fail('TARIFF_ROUTE_OUTSIDE_REVIEW', 'Route ' + tariff.routeId + ' is outside the saved review route selection.');
  }
  const source = {
    sellerCanonicalSha256:fingerprint(seller), observationCanonicalSha256:fingerprint(observation),
    termsCanonicalSha256:fingerprint(terms), provenance:clone(provenance)
  };
  const tariffReviewSha256 = fingerprint({ schema:TARIFF_REVIEW_SCHEMA, source, tariffs:normalized, volumes:quantities });
  const comparisons = normalized.flatMap(tariff => quantities.map(value =>
    comparison(tariff, value, byRoute.get(tariff.routeId), tariffReviewSha256)));
  return {
    schema:TARIFF_REVIEW_SCHEMA, tariffReviewSha256, source, generatedAt:new Date().toISOString(),
    tariffs:normalized, volumes:quantities, comparisons,
    tariffDetails:normalized.map(tariff => ({
      tariffId:tariff.id, tariffSha256:fingerprint(tariff), boundaries:boundaries(tariff)
    })),
    baseline:{
      merchantName:terms.merchantName,
      scope:original.overview.sharedFixedCostApplied === false ? 'SELECTED_CURRENT_ROUTE' : 'CURRENT_SELLER',
      sharedMonthlyFixedUsd:original.overview.sharedMonthlyFixedUsd,
      sharedFixedCostApplied:original.overview.sharedFixedCostApplied !== false,
      monthlyTargets:Object.fromEntries(original.routes.map(row => [row.routeId, row.paidTargetMonth]))
    }
  };
}

/** Return a mutable copy for the caller's explicit original-plan selection. */
export function selectionScenario(review, comparisonId) {
  record(review, 'Tariff review');
  if (review.schema !== TARIFF_REVIEW_SCHEMA || !/^[a-f0-9]{64}$/.test(review.tariffReviewSha256 ?? '')
      || !Array.isArray(review.comparisons))
    throw fail('TARIFF_REVIEW_INVALID', 'Use a complete saved tariff review.');
  if (typeof comparisonId !== 'string' || !/^[a-f0-9]{64}$/.test(comparisonId))
    throw fail('TARIFF_COMPARISON_NOT_FOUND', 'Select a comparison from this tariff review.', 404);
  const row = review.comparisons.find(item => item.id === comparisonId);
  if (!row) throw fail('TARIFF_COMPARISON_NOT_FOUND', 'The selected comparison is unavailable in this review.', 404);
  if (row.quantity === '0' || row.scenario === null)
    throw fail('TARIFF_ZERO_VOLUME', 'A uniform per-request quote requires a positive monthly quantity.');
  const expectedId = fingerprint({ reviewSha256:review.tariffReviewSha256, tariffId:row.tariffId, quantity:row.quantity });
  if (row.id !== expectedId || !plain(row.scenario) || row.scenario.id !== row.id)
    throw fail('TARIFF_REVIEW_INVALID', 'The selected comparison differs from its saved tariff identity.');
  return clone(row.scenario);
}
