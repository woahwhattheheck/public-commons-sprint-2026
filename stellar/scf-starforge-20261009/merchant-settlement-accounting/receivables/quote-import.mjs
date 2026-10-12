// MIT. Exact SF74 quotation files into an editable accounting invoice draft.
import {need, plain, identifier, field, currencyOf, dateValue, normalizeDraft, minor, money, sha} from './core.mjs';

export const QUOTE_INVOICE_SOURCE_SCHEMA = 'stellar-forge.merchant-invoice-quote-source.v1';
export const QUOTE_INVOICE_REVIEW_SCHEMA = 'stellar-forge.merchant-invoice-quote-review.v1';
const DOCUMENT_SCHEMA = 'stellar-forge.merchant-commercial-document.v1';
const QUOTE_SCHEMA = 'stellar-forge.merchant-commercial-quote.v1';
const HASH = /^[a-f0-9]{64}$/;
const MICRO_CURRENCY = {code: 'USD', scale: 6};
const LINE_KINDS = new Set(['IMPLEMENTATION', 'RECURRING_SERVICE', 'ROUTE_USAGE']);
const RESPONSE_STATES = new Set(['ACCEPTED', 'REVISION_REQUESTED', 'DECLINED']);

// This is the original SF74 commercial-pricing.mjs canonical JSON contract.
export const canonicalQuoteValue = value => JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item) ?
    Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const clone = value => structuredClone(value);
function object(value, keys, name) {
  need(plain(value) && Object.keys(value).every(key => keys.includes(key)),
    'INVALID_QUOTE_IMPORT', 'Use the complete original ' + name + ' JSON file.');
}
function text(value, name, {empty = false, max = 16000} = {}) {
  need(typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    'INVALID_QUOTE_IMPORT', 'Check the original ' + name + '.');
  return value;
}
function hash(value, name) {
  need(typeof value === 'string' && HASH.test(value), 'INVALID_QUOTE_IMPORT',
    'Keep the original ' + name + ' SHA-256.');
  return value;
}
function instant(value, name) {
  need(typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value, 'INVALID_QUOTE_IMPORT',
    'Keep the original ' + name + ' UTC timestamp.');
  return value;
}
function sourceFile(content, name) {
  need(typeof content === 'string' && content.length > 0 &&
    Buffer.from(content, 'utf8').toString('utf8') === content,
    'INVALID_QUOTE_IMPORT', 'Choose the complete original UTF-8 ' + name + ' JSON file.');
  let value;
  try { value = JSON.parse(content); }
  catch { need(false, 'INVALID_QUOTE_IMPORT', 'The selected ' + name + ' file is not valid JSON.'); }
  need(plain(value), 'INVALID_QUOTE_IMPORT', 'Choose an original ' + name + ' JSON object.');
  return {value, sha256: sha(content), bytes: Buffer.byteLength(content, 'utf8')};
}
function documentEnvelope(value, kind) {
  object(value, ['schema', 'kind', 'id', 'caseId', 'createdAt', 'request', 'payload'], kind + ' document');
  need(value.schema === DOCUMENT_SCHEMA && value.kind === kind, 'INVALID_QUOTE_IMPORT',
    'Choose the original ' + kind + ' material from the merchant quotation workspace.');
  identifier(value.id, 'commercial document');
  identifier(value.caseId, 'source case');
  instant(value.createdAt, 'document recording');
  object(value.request, ['action', 'actor', 'sha256'], 'commercial request');
  need(value.request.action === (kind === 'QUOTE' ? 'publish' : 'receive'),
    'INVALID_QUOTE_IMPORT', 'The original commercial operation does not match this document.');
  text(value.request.actor, 'commercial operator', {max: 200});
  hash(value.request.sha256, 'commercial request');
  need(plain(value.payload), 'INVALID_QUOTE_IMPORT', 'Keep the complete original document payload.');
  return value;
}
function micro(value, name) {
  return minor(value, MICRO_CURRENCY, name);
}
function microText(value) {
  const negative = value < 0n, units = negative ? -value : value;
  const fraction = String(units % 1000000n).padStart(6, '0').replace(/0+$/, '');
  return (negative ? '-' : '') + String(units / 1000000n) + (fraction ? '.' + fraction : '');
}

// The original commercial quote carries a sealed tariff projection rather than
// the tariff portfolio's file bodies. Keep that projection complete and join it
// to the quote's saved pricing source and route; the accepted price stays in the
// original calculated line. No tier selection or price recalculation occurs here.
function tariffRecord(value, keys, name) {
  object(value, keys, name);
  need(keys.every(key => Object.hasOwn(value, key)), 'INVALID_QUOTE_TARIFF',
    'Keep every field of the original ' + name + '.');
}
function tariffQuantity(value, name, {positive = false} = {}) {
  need(typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) &&
    Number.isSafeInteger(Number(value)) && (!positive || value !== '0'),
    'INVALID_QUOTE_TARIFF', 'Keep the original whole request quantity for ' + name + '.');
  return BigInt(value);
}
function tariffMaterial(value, prefix, name) {
  tariffRecord(value, ['id', 'sha256', 'bytes'], name);
  need(typeof value.id === 'string' && value.id.startsWith(prefix), 'INVALID_QUOTE_TARIFF',
    'Keep the original retained ' + name + ' identity.');
  identifier(value.id.slice(prefix.length), name);
  hash(value.sha256, name);
  need(Number.isSafeInteger(value.bytes) && value.bytes > 0, 'INVALID_QUOTE_TARIFF',
    'Keep the original byte count for ' + name + '.');
}
function tariffFiles(value, names, name) {
  need(Array.isArray(value) && value.length === names.length, 'INVALID_QUOTE_TARIFF',
    'Keep every original ' + name + ' file descriptor.');
  const used = new Set();
  for (const file of value) {
    tariffRecord(file, ['name', 'bytes', 'sha256'], name + ' file');
    need(names.includes(file.name) && !used.has(file.name) &&
      Number.isSafeInteger(file.bytes) && file.bytes > 0, 'INVALID_QUOTE_TARIFF',
      'Keep the distinct original ' + name + ' file names and byte counts.');
    used.add(file.name); hash(file.sha256, name + ' file');
  }
}
function inspectTariffBinding(quote) {
  const present = Object.hasOwn(quote.sourceBindings, 'tariff');
  if (!present) {
    need(!quote.draft.tariffSourceId, 'QUOTE_TARIFF_SOURCE_MISSING',
      'Keep the selected original tariff with this quote edition.', 409);
    return null;
  }
  const tariff = quote.sourceBindings.tariff, pricing = quote.sourceBindings.pricing;
  tariffRecord(tariff, ['id', 'pricingSourceId', 'material', 'files', 'selectionRequestId',
    'tariffPlanId', 'comparisonId', 'scenarioPlanId', 'pricingVersion', 'routeId', 'tiers', 'basis'],
    'selected tariff binding');
  hash(tariff.id, 'selected tariff source');
  hash(tariff.pricingSourceId, 'tariff pricing source');
  hash(tariff.comparisonId, 'selected tariff comparison');
  for (const key of ['selectionRequestId', 'tariffPlanId', 'scenarioPlanId', 'pricingVersion'])
    identifier(tariff[key], 'tariff ' + key);
  text(tariff.routeId, 'original tariff route', {max: 2000});
  tariffMaterial(tariff.material, 'commercial-tariff:', 'tariff material');
  tariffFiles(tariff.files, ['tariff-portfolio.json', 'saved-pricing-manifest.json'], 'tariff');

  need(plain(pricing) && tariff.id === quote.draft.tariffSourceId &&
    tariff.pricingSourceId === pricing.id && pricing.id === quote.draft.pricingSourceId &&
    pricing.sha256 === pricing.id && tariff.scenarioPlanId === pricing.planId,
    'QUOTE_TARIFF_PRICING_CHANGED', 'Keep this tariff with its exact selected pricing source and scenario plan.', 409);
  identifier(pricing.version, 'original pricing source version');
  tariffMaterial(pricing.material, 'commercial:', 'pricing material');
  const observation = pricing.files?.some(file => file?.name === 'history.json') ? 'history.json' : 'snapshot.json';
  tariffFiles(pricing.files, ['plan.json', 'manifest.json', 'seller.json', 'terms.json', observation], 'pricing source');
  // Original commercial-pricing.mjs sourceIdentity: file order belongs to the
  // saved identity. The tariff's completed pricingVersion is a distinct version.
  need(sha(canonicalQuoteValue({schema: 'stellar-forge.merchant-commercial-pricing-source.v1',
    planId: pricing.planId, scenarioId: pricing.scenarioId, version: pricing.version,
    files: pricing.files})) === pricing.id, 'QUOTE_TARIFF_PRICING_CHANGED',
    'The tariff quotation must retain its original pricing file descriptors and source identity.', 409);

  const basis = tariff.basis;
  tariffRecord(basis, ['sourceId', 'label', 'tariffLabel', 'mode', 'selectedQuantity', 'quotedQuantity',
    'uniformUnitUsd', 'originalTariffGrossUsd', 'originalRoundingDeltaUsd',
    'tariffGrossAtQuotedQuantityUsd', 'derivedUnitAtQuotedQuantityUsd', 'changedQuantity', 'text'],
    'tariff calculation basis');
  need(basis.sourceId === tariff.id && ['graduated', 'volume'].includes(basis.mode),
    'QUOTE_TARIFF_BASIS_CHANGED', 'Keep the selected tariff identity and original pricing mode.', 409);
  text(basis.label, 'tariff plan label');
  text(basis.tariffLabel, 'tariff label', {max: 120});
  text(basis.text, 'original tariff explanation');
  const selectedQuantity = tariffQuantity(basis.selectedQuantity, 'selected tariff', {positive: true});
  const quotedQuantity = tariffQuantity(basis.quotedQuantity, 'quoted route');
  const uniform = micro(basis.uniformUnitUsd, 'saved uniform tariff rate');
  const originalGross = micro(basis.originalTariffGrossUsd, 'original tariff gross amount');
  const originalRounding = micro(basis.originalRoundingDeltaUsd, 'original upward unit rounding');
  const quotedTariffGross = micro(basis.tariffGrossAtQuotedQuantityUsd, 'tariff comparison at quoted volume');
  const derived = basis.derivedUnitAtQuotedQuantityUsd === null ? null :
    micro(basis.derivedUnitAtQuotedQuantityUsd, 'original tariff comparison rate');
  need(typeof basis.changedQuantity === 'boolean' &&
    basis.changedQuantity === (basis.selectedQuantity !== basis.quotedQuantity) &&
    originalGross + originalRounding === selectedQuantity * uniform &&
    (quotedQuantity === 0n ? derived === null && quotedTariffGross === 0n : derived !== null) &&
    (basis.changedQuantity || quotedTariffGross === originalGross && derived === uniform),
    'QUOTE_TARIFF_BASIS_CHANGED', 'Keep the saved uniform rate, original rounding and separate quoted-volume comparison together.', 409);
  need(Array.isArray(tariff.tiers) && tariff.tiers.length > 0 && tariff.tiers.length <= 64,
    'INVALID_QUOTE_TARIFF', 'Keep the complete original tariff tiers.');
  let previous = 0n;
  for (const [index, tier] of tariff.tiers.entries()) {
    tariffRecord(tier, ['upTo', 'unitPriceUsd'], 'tariff tier');
    const last = index === tariff.tiers.length - 1;
    need(last ? tier.upTo === null : tier.upTo !== null, 'INVALID_QUOTE_TARIFF',
      'Keep the final unbounded tariff tier and all original finite tiers.');
    if (!last) {
      const upper = tariffQuantity(tier.upTo, 'tariff tier', {positive: true});
      need(upper > previous, 'INVALID_QUOTE_TARIFF', 'Keep the original increasing tariff tier quantities.');
      previous = upper;
    }
    micro(tier.unitPriceUsd, 'original tariff tier unit price');
  }
  const routes = quote.draft.pricing?.routes;
  need(Array.isArray(routes), 'QUOTE_TARIFF_ROUTE_CHANGED', 'Keep the original quoted route volumes.', 409);
  const selectedRoutes = routes.filter(route => route?.routeId === tariff.routeId);
  const selectedLines = quote.lines.filter(line => line.kind === 'ROUTE_USAGE' &&
    line.id === tariff.routeId && line.routeId === tariff.routeId);
  need(selectedRoutes.length === 1 && selectedLines.length === 1 &&
    selectedRoutes[0].monthlyRequests === basis.quotedQuantity &&
    selectedLines[0].quantity === basis.quotedQuantity &&
    selectedLines[0].sourcePlanId === pricing.planId && selectedLines[0].sourceScenarioId === pricing.scenarioId &&
    micro(selectedLines[0].unitUsd, 'quoted route unit price') === uniform,
    'QUOTE_TARIFF_ROUTE_CHANGED', 'Keep the original tariff route, monthly volume and accepted saved uniform price.', 409);
  return tariff;
}


// The native performance reader has already replayed its source before the
// Commercial writer seals this binding. Retain its complete measured projection;
// only the explicit proposal joins to the current invoice's quoted route.
function inspectPerformanceBinding(quote) {
  if (!Object.hasOwn(quote.sourceBindings, 'performance')) {
    need(!quote.draft.performanceSourceId, 'QUOTE_PERFORMANCE_SOURCE_MISSING',
      'Keep the original recorded-usage source with this quotation revision.', 409);
    return null;
  }
  const performance = quote.sourceBindings.performance;
  tariffRecord(performance, ['id', 'nativeSourceId', 'performanceId', 'performanceSha256', 'label', 'savedAt',
    'material', 'file', 'measuredQuote', 'measuredTariffSourceId', 'selectionRequestId',
    'usageVersion', 'usageRevision', 'route', 'period', 'basis', 'quoted', 'tariff', 'costs', 'issues', 'proposed'],
    'recorded-usage binding');
  for (const key of ['id', 'nativeSourceId', 'performanceSha256', 'measuredTariffSourceId'])
    hash(performance[key], 'recorded-usage ' + key);
  identifier(performance.performanceId, 'saved performance review');
  identifier(performance.selectionRequestId, 'measured tariff selection');
  instant(performance.savedAt, 'performance source save');
  text(performance.label, 'recorded-usage label');
  tariffMaterial(performance.material, 'commercial:', 'recorded-usage material');
  tariffFiles([performance.file], ['merchant-tariff-performance-source.json'], 'recorded-usage source');
  tariffRecord(performance.measuredQuote, ['id', 'sha256', 'title'], 'measured quote identity');
  identifier(performance.measuredQuote.id, 'measured quote');
  hash(performance.measuredQuote.sha256, 'measured quote');
  text(performance.measuredQuote.title, 'measured quote title', {max: 400});
  need(performance.id === quote.draft.performanceSourceId && quote.parentId !== null &&
    performance.measuredQuote.id !== quote.id &&
    sha(canonicalQuoteValue({schema: 'stellar-forge.merchant-commercial-performance-source.v1',
      tariffSourceId: performance.measuredTariffSourceId,
      quote: {id: performance.measuredQuote.id, sha256: performance.measuredQuote.sha256},
      file: performance.file})) === performance.id,
    'QUOTE_PERFORMANCE_SOURCE_CHANGED', 'Keep the complete original measured quote, tariff and native file identity.', 409);
  // These are the native reader's original period, quantity/cost meanings and
  // source revision, not inputs for deriving a monthly billing quantity.
  need(['route', 'period', 'basis', 'quoted', 'tariff', 'costs'].every(key => plain(performance[key])) &&
    Array.isArray(performance.issues), 'INVALID_QUOTE_PERFORMANCE',
    'Keep the complete original recorded period, quantity, price and cost review.');
  text(performance.route.routeId, 'measured route', {max: 2000});
  text(performance.route.method, 'measured route method', {max: 100});
  text(performance.route.path, 'measured route path', {max: 2000});
  const proposed = performance.proposed, tariff = quote.sourceBindings.tariff;
  tariffRecord(proposed, ['monthlyRequests', 'tariffSourceId', 'pricingSourceId', 'unitUsd', 'amountUsd', 'rateChanged'],
    'explicit recorded-usage quote proposal');
  tariffQuantity(proposed.monthlyRequests, 'proposed monthly route');
  hash(proposed.tariffSourceId, 'proposed tariff source');
  hash(proposed.pricingSourceId, 'proposed pricing source');
  const proposedUnit = micro(proposed.unitUsd, 'proposed quoted unit rate');
  const proposedAmount = micro(proposed.amountUsd, 'proposed quoted monthly amount');
  const measuredUnit = micro(performance.quoted.savedUnitUsd, 'measured quotation unit rate');
  const line = quote.lines.find(row => row.kind === 'ROUTE_USAGE' && row.routeId === performance.route.routeId);
  need(tariff && line && performance.route.routeId === tariff.routeId &&
    line.title === performance.route.method + ' ' + performance.route.path &&
    proposed.tariffSourceId === tariff.id && proposed.pricingSourceId === tariff.pricingSourceId &&
    proposed.monthlyRequests === tariff.basis.quotedQuantity && proposed.monthlyRequests === line.quantity &&
    proposedUnit === micro(line.unitUsd, 'accepted revised unit price') &&
    proposedAmount === micro(line.amountUsd, 'accepted revised monthly charge') &&
    typeof proposed.rateChanged === 'boolean' && proposed.rateChanged === (proposedUnit !== measuredUnit),
    'QUOTE_PERFORMANCE_PROPOSAL_CHANGED',
    'Keep the explicit proposed monthly volume, selected tariff and accepted rate with this revised quote route.', 409);
  return performance;
}

function inspectQuote(file) {
  const envelope = file.value.schema === DOCUMENT_SCHEMA ? documentEnvelope(file.value, 'QUOTE') : null;
  const quote = envelope ? envelope.payload : file.value;
  object(quote, ['schema', 'id', 'parentId', 'createdAt', 'title', 'draft', 'reviewSha256', 'draftSha256',
    'sourceBindings', 'lines', 'totals', 'issues', 'pricingReview', 'customerDocument', 'sha256'], 'sealed quote');
  need(quote.schema === QUOTE_SCHEMA, 'INVALID_QUOTE_IMPORT',
    'Choose the original QUOTE_JSON download or retained QUOTE material.');
  identifier(quote.id, 'quote');
  if (quote.parentId !== null) identifier(quote.parentId, 'parent quote');
  instant(quote.createdAt, 'quote creation');
  text(quote.title, 'quote title', {max: 400});
  hash(quote.sha256, 'quote');
  const {sha256: expected, ...unsealed} = quote;
  need(sha(canonicalQuoteValue(unsealed)) === expected, 'QUOTE_DOCUMENT_SEAL_MISMATCH',
    'The selected quote differs from its sealed original edition.', 409);
  need(!envelope || envelope.id === quote.id && envelope.createdAt === quote.createdAt,
    'QUOTE_DOCUMENT_BINDING_CHANGED', 'Keep the original quote and its matching material together.', 409);
  need(plain(quote.draft) && quote.draft.currency === 'USD' &&
    quote.draft.service?.period === 'MONTH' && quote.draft.title === quote.title &&
    (quote.draft.parentId ?? null) === quote.parentId,
    'INVALID_QUOTE_IMPORT', 'Keep the original quote draft and its USD monthly pricing basis.');
  object(quote.draft.customer, ['name', 'contact'], 'quoted customer');
  text(quote.draft.customer.name, 'quoted customer name', {max: 500});
  text(quote.draft.customer.contact, 'quoted customer contact', {empty: true, max: 2000});
  if (quote.draft.validThrough !== '') dateValue(quote.draft.validThrough, 'quote validity date');
  hash(quote.draftSha256, 'quote draft');
  hash(quote.reviewSha256, 'quote review');
  need(sha(canonicalQuoteValue(quote.draft)) === quote.draftSha256, 'QUOTE_DRAFT_CHANGED',
    'The retained quote draft differs from its original identity.', 409);
  object(quote.sourceBindings, ['implementation', 'service', 'pricing', 'tariff', 'performance'], 'quote sources');
  need(['implementation', 'service', 'pricing'].every(key => Object.hasOwn(quote.sourceBindings, key)),
    'INVALID_QUOTE_IMPORT', 'Keep every original quote source binding, including empty selections.');
  for (const [kind, binding] of Object.entries(quote.sourceBindings)) if (kind !== 'tariff' && kind !== 'performance' && binding !== null) {
    need(plain(binding), 'INVALID_QUOTE_IMPORT', 'Keep each complete original quote source binding.');
    text(binding.id, 'selected quote source identity', {max: 200});
    hash(binding.sha256, 'selected quote source');
    if (kind === 'pricing') {
      identifier(binding.planId, 'selected pricing plan');
      text(binding.scenarioId, 'selected pricing scenario', {max: 200});
      hash(binding.reviewSha256, 'selected pricing review');
    }
  }
  need(Array.isArray(quote.lines) && quote.lines.length > 0 && Array.isArray(quote.issues) &&
    (quote.pricingReview === null || plain(quote.pricingReview)) &&
    typeof quote.customerDocument === 'string', 'INVALID_QUOTE_IMPORT',
    'Keep the original calculated quote lines, review and customer document.');
  const pricingReview = clone(quote.pricingReview);
  if (pricingReview) delete pricingReview.generatedAt;
  const review = {schema: 'stellar-forge.merchant-commercial-review.v1', draftSha256: quote.draftSha256,
    sourceBindings: quote.sourceBindings, lines: quote.lines, totals: quote.totals,
    issues: quote.issues, pricingReview};
  need(sha(canonicalQuoteValue(review)) === quote.reviewSha256, 'QUOTE_REVIEW_CHANGED',
    'The selected quote differs from its original calculation review.', 409);
  object(quote.totals, ['currency', 'implementationUsd', 'recurringServiceUsd', 'routeUsageUsd',
    'recurringUsd', 'recurringPeriod'], 'quote totals');
  need(quote.totals.currency === 'USD' && quote.totals.recurringPeriod === 'MONTH',
    'INVALID_QUOTE_IMPORT', 'Use the original USD quote and its monthly recurring basis.');
  const sums = {IMPLEMENTATION: 0n, RECURRING_SERVICE: 0n, ROUTE_USAGE: 0n}, used = new Set();
  for (const line of quote.lines) {
    need(plain(line) && LINE_KINDS.has(line.kind), 'INVALID_QUOTE_IMPORT', 'Keep the original quote line kind.');
    text(line.id, 'quote line identity', {max: 200});
    text(line.title, 'quoted line title', {max: 2400});
    text(line.quantity, 'quoted quantity', {max: 80});
    micro(line.quantity, 'original quoted quantity');
    micro(line.unitUsd, 'original quoted unit price');
    const key = canonicalQuoteValue({kind: line.kind, id: line.id});
    need(!used.has(key), 'DUPLICATE_QUOTE_LINE', 'Each original quote line needs its own kind and identity.');
    used.add(key);
    sums[line.kind] += micro(line.amountUsd, 'original extended quote amount');
  }
  need(sums.IMPLEMENTATION === micro(quote.totals.implementationUsd, 'implementation total') &&
    sums.RECURRING_SERVICE === micro(quote.totals.recurringServiceUsd, 'recurring service total') &&
    sums.ROUTE_USAGE === micro(quote.totals.routeUsageUsd, 'planned route total') &&
    sums.RECURRING_SERVICE + sums.ROUTE_USAGE === micro(quote.totals.recurringUsd, 'recurring total'),
    'QUOTE_TOTALS_CHANGED', 'The complete original quote lines must match their saved totals.', 409);
  inspectTariffBinding(quote);
  inspectPerformanceBinding(quote);
  return {quote, envelope, sums};
}
function inspectResponse(content, quote) {
  if (content === undefined || content === null) return null;
  const file = sourceFile(content, 'customer response');
  const envelope = documentEnvelope(file.value, 'RESPONSE'), value = envelope.payload;
  object(value, ['quoteId', 'quoteSha256', 'status', 'observedAt', 'source', 'note'], 'customer response');
  identifier(value.quoteId, 'response quote');
  hash(value.quoteSha256, 'response quote');
  need(value.quoteId === quote.id && value.quoteSha256 === quote.sha256,
    'QUOTE_RESPONSE_BINDING_CHANGED', 'Select a customer response to this exact quote edition.', 409);
  need(RESPONSE_STATES.has(value.status), 'INVALID_QUOTE_IMPORT', 'Keep the original customer response status.');
  instant(value.observedAt, 'customer response');
  text(value.source, 'customer response reference', {max: 4096});
  text(value.note, 'customer response note', {empty: true});
  // A received case may record a new response to a quote retained from its source case.
  return {documentId: envelope.id, materialId: 'commercial:' + envelope.id,
    documentSha256: file.sha256, documentBytes: file.bytes, sourceCaseId: envelope.caseId,
    createdAt: envelope.createdAt, requestSha256: envelope.request.sha256, actor: envelope.request.actor,
    quoteId: value.quoteId, quoteSha256: value.quoteSha256, status: value.status,
    observedAt: value.observedAt, source: value.source, note: value.note};
}
function sourceBindings(value) {
  return Object.fromEntries(Object.entries(value).map(([kind, binding]) => [kind, binding === null ? null :
    kind === 'tariff' || kind === 'performance' || kind === 'pricing' && value.tariff ? clone(binding) :
      {id: binding.id, sha256: binding.sha256,
        ...(kind === 'pricing' ? {planId: binding.planId, scenarioId: binding.scenarioId,
          reviewSha256: binding.reviewSha256} : {})}]));
}

/**
 * Compile a draft only. Original quote/response UTF-8 bodies remain the caller's
 * retained source files; this result identifies their exact bytes for storage.
 * IMPLEMENTATION selects the once-only fees. RECURRING needs an explicit integer
 * count of monthly quoted periods and carries the selected period label.
 */
export function compileQuoteInvoice({quoteContent, responseContent, customerId, issueDate, dueDate,
  currencyScale = 2, scope, periodCount, periodLabel = ''} = {}) {
  identifier(customerId, 'accounting customer');
  const currency = currencyOf({code: 'USD', scale: currencyScale});
  need(scope === 'IMPLEMENTATION' || scope === 'RECURRING', 'QUOTE_INVOICE_SCOPE_REQUIRED',
    'Choose one-time implementation or monthly recurring fees.');
  const recurring = scope === 'RECURRING';
  if (recurring) need(Number.isSafeInteger(periodCount) && periodCount > 0, 'QUOTE_PERIOD_COUNT_REQUIRED',
    'Enter the positive whole number of quoted monthly periods to bill.');
  else need(periodCount === undefined || periodCount === null || periodCount === 1,
    'QUOTE_ONE_TIME_SCOPE', 'Implementation fees are billed once for the selected quote scope.');
  const periods = recurring ? periodCount : 1;
  const label = field(periodLabel, 'billing period label', 300, true);
  const file = sourceFile(quoteContent, 'quote');
  const {quote, envelope, sums} = inspectQuote(file), response = inspectResponse(responseContent, quote);
  const tariff = quote.sourceBindings.tariff ?? null, performance = quote.sourceBindings.performance ?? null;
  const selected = quote.lines.filter(line => recurring ? line.kind !== 'IMPLEMENTATION' : line.kind === 'IMPLEMENTATION');
  need(selected.length > 0, 'QUOTE_SCOPE_EMPTY', 'This quote has no lines in the selected billing scope.');
  need(selected.length <= 250, 'QUOTE_INVOICE_LINE_LIMIT',
    'This selected scope exceeds the invoice limit of 250 lines. Split its billing scope explicitly before importing.');
  const factor = 10n ** BigInt(6 - currency.scale);
  let quotedMicro = 0n, selectedMicro = 0n, invoiceUnits = 0n, roundedLines = 0;
  const lineSources = [];
  const lines = selected.map((line, index) => {
    const original = micro(line.amountUsd, 'original extended quote amount'), extended = original * BigInt(periods);
    const units = factor === 1n ? extended : (extended + factor / 2n) / factor;
    const roundingDifference = units * factor - extended;
    const invoiceLineId = 'quote-' + (index + 1) + '-' +
      sha(quote.id + '\0' + line.kind + '\0' + line.id).slice(0, 16);
    const amount = money(units, currency);
    const periodText = periods + ' month' + (periods === 1 ? '' : 's') + (label ? ' (' + label + ')' : '');
    const description = (line.kind === 'ROUTE_USAGE' ? 'Planned route usage: ' : '') +
      line.title + (recurring ? ' — ' + periodText : '');
    quotedMicro += original; selectedMicro += extended; invoiceUnits += units;
    if (roundingDifference !== 0n) roundedLines++;
    lineSources.push({invoiceLineId, quoteLineId: line.id, kind: line.kind,
      sourceId: line.sourceId ?? null, sourceRowId: line.sourceRowId ?? null,
      sourcePlanId: line.sourcePlanId ?? null, sourceScenarioId: line.sourceScenarioId ?? null,
      originalQuantity: line.quantity, originalUnitUsd: line.unitUsd, originalAmountUsd: line.amountUsd,
      ...(tariff && line.kind === 'ROUTE_USAGE' && line.id === tariff.routeId ?
        {tariffSourceId: tariff.id, tariffComparisonId: tariff.comparisonId} : {}),
      ...(performance && line.kind === 'ROUTE_USAGE' && line.routeId === performance.route.routeId ?
        {performanceSourceId: performance.id} : {}),
      periodCount: periods, selectedAmountUsd: microText(extended),
      invoiceAmount: amount, roundingDifferenceUsd: microText(roundingDifference)});
    return {id: invoiceLineId, description, quantity: '1', unitAmount: amount,
      discountAmount: '0', taxAmount: '0'};
  });
  const quoteReference = 'Q-' + quote.createdAt.slice(0, 10).replaceAll('-', '') + '-' + quote.id.slice(0, 8);
  const basis = recurring ? periods + ' quoted monthly period' + (periods === 1 ? '' : 's') +
    (label ? ': ' + label : '') : 'One-time implementation fees';
  const draft = normalizeDraft({customerId, currency, issueDate, dueDate, lines,
    sourceReference: 'SF74 quotation ' + quoteReference,
    note: basis + '. Original quotation: ' + quote.title + '.', purchaseOrder: '', replacesId: null});
  const source = {schema: QUOTE_INVOICE_SOURCE_SCHEMA, customerId,
    quote: {id: quote.id, sha256: quote.sha256, title: quote.title, createdAt: quote.createdAt,
      draftSha256: quote.draftSha256, reviewSha256: quote.reviewSha256,
      documentKind: envelope ? 'QUOTE' : 'QUOTE_JSON', documentId: envelope?.id ?? null,
      materialId: envelope ? 'commercial:' + envelope.id : null, sourceCaseId: envelope?.caseId ?? null,
      documentSha256: file.sha256, documentBytes: file.bytes, bindings: sourceBindings(quote.sourceBindings)},
    response, selection: {scope, periodUnit: recurring ? 'MONTH' : 'ONCE', periodCount: periods,
      periodLabel: label, currency, rounding: 'HALF_UP_EACH_EXTENDED_LINE'}, lines: lineSources,
    totals: {quotedAmountUsd: microText(quotedMicro), selectedAmountUsd: microText(selectedMicro),
      invoiceAmount: money(invoiceUnits, currency), roundingDifferenceUsd: microText(invoiceUnits * factor - selectedMicro)}};
  source.sha256 = sha(canonicalQuoteValue(source));
  const review = {schema: QUOTE_INVOICE_REVIEW_SCHEMA, sourceSha256: source.sha256,
    quote: {id: quote.id, sha256: quote.sha256, reference: quoteReference, title: quote.title,
      customer: clone(quote.draft.customer), validThrough: quote.draft.validThrough},
    customerId, customerResponse: response ? {status: response.status, documentId: response.documentId,
      observedAt: response.observedAt, source: response.source} : null,
    accepted: response?.status === 'ACCEPTED', selection: clone(source.selection),
    lines: clone(lineSources), totals: clone(source.totals), roundedLines,
    plannedRouteLines: selected.filter(line => line.kind === 'ROUTE_USAGE').length,
    originalScopeTotals: {implementationUsd: microText(sums.IMPLEMENTATION),
      recurringServiceUsd: microText(sums.RECURRING_SERVICE), routeUsageUsd: microText(sums.ROUTE_USAGE)},
    calculation: 'Each original extended USD line is multiplied by the selected period count, then rounded half up to the chosen currency precision. The invoice uses quantity one for each resulting charge.'};
  if (tariff) {
    const route = quote.lines.find(line => line.kind === 'ROUTE_USAGE' && line.id === tariff.routeId);
    const included = lineSources.find(line => line.tariffSourceId === tariff.id);
    review.tariff = {binding: clone(tariff), includedInScope: Boolean(included),
      invoiceLineId: included?.invoiceLineId ?? null, periodCount: included ? periods : 0,
      originalMonthlyAmountUsd: route.amountUsd, selectedAmountUsd: included?.selectedAmountUsd ?? '0',
      invoiceAmount: included?.invoiceAmount ?? money(0n, currency),
      calculation: 'The original quoted route line uses the saved uniform rate and explicit monthly request volume. Its accepted extended amount is multiplied by the selected whole monthly periods. The original tier comparison and selected-volume rounding remain attached to the source.'};
  }
  if (performance) {
    const included = lineSources.find(line => line.performanceSourceId === performance.id);
    review.performance = {binding: clone(performance), includedInScope: Boolean(included),
      invoiceLineId: included?.invoiceLineId ?? null, periodCount: included ? periods : 0,
      selectedAmountUsd: included?.selectedAmountUsd ?? '0', invoiceAmount: included?.invoiceAmount ?? money(0n, currency),
      calculation: 'The measured period, quantity, source revisions and cost view remain the original saved observation. Billing uses the revised quote\'s explicit proposed monthly requests and accepted extended line amount for the selected whole periods.'};
  }
  review.sha256 = sha(canonicalQuoteValue(review));
  return {draft, source, review};
}
