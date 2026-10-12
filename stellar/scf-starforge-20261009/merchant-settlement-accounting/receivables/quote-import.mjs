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
  object(quote.sourceBindings, ['implementation', 'service', 'pricing'], 'quote sources');
  need(['implementation', 'service', 'pricing'].every(key => Object.hasOwn(quote.sourceBindings, key)),
    'INVALID_QUOTE_IMPORT', 'Keep every original quote source binding, including empty selections.');
  for (const [kind, binding] of Object.entries(quote.sourceBindings)) if (binding !== null) {
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
  review.sha256 = sha(canonicalQuoteValue(review));
  return {draft, source, review};
}
