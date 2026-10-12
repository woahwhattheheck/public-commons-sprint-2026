// MIT. Stream invoice lines and reconcile them against an independently supplied price book.
const MAX_LINES = 250000, MAX_LINE_BYTES = 16384, MAX_PRICES = 10000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const identifier = (value, maximum = 80) => typeof value === 'string' && value.length > 0 &&
  value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
const currency = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const amount = value => {
  check(typeof value === 'string' && /^(?:0|[1-9][0-9]{0,23})$/.test(value), 'JOB_INPUT_MINOR_AMOUNT_INVALID');
  return BigInt(value);
};
async function* lines(source, signal) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '', lineNumber = 0;
  const emit = line => {
    lineNumber++;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    check(Buffer.byteLength(line) <= MAX_LINE_BYTES, 'JOB_INPUT_LEDGER_LINE_TOO_LARGE');
    return { text: line, lineNumber };
  };
  for await (const chunk of source) {
    signal.throwIfAborted();
    const text = pending + decoder.decode(chunk, { stream: true });
    let start = 0, end;
    while ((end = text.indexOf('\n', start)) >= 0) {
      yield emit(text.slice(start, end)); start = end + 1;
    }
    pending = text.slice(start);
    check(Buffer.byteLength(pending) <= MAX_LINE_BYTES, 'JOB_INPUT_LEDGER_LINE_TOO_LARGE');
  }
  pending += decoder.decode();
  if (pending) yield emit(pending);
}
/**
 * Input:
 * - ledger: UTF-8 NDJSON, one invoiceId/lineId/sku/quantity/chargedMinor/currency object per line.
 * - prices: supplier-pricebook.v1 JSON with prices [{sku,currency,unitPriceMinor}].
 * Amounts remain integers in currency minor units throughout the computation.
 */
export async function reconcile(input, context) {
  check(context.files, 'JOB_INPUT_RECEIVER_REQUIRED');
  const book = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
    await context.files.read('prices', { maxBytes: 4194304 })));
  check(object(book) && book.schema === 'supplier-pricebook.v1' &&
    identifier(book.reference, 160) && Array.isArray(book.prices) &&
    book.prices.length > 0 && book.prices.length <= MAX_PRICES, 'JOB_INPUT_PRICEBOOK_INVALID');
  const prices = new Map(), skus = new Set();
  for (const row of book.prices) {
    context.signal.throwIfAborted();
    check(object(row) && identifier(row.sku) && currency(row.currency), 'JOB_INPUT_PRICEBOOK_ROW_INVALID');
    const key = JSON.stringify([row.sku, row.currency]);
    check(!prices.has(key), 'JOB_INPUT_DUPLICATE_PRICE');
    prices.set(key, amount(row.unitPriceMinor)); skus.add(row.sku);
  }
  const maxExceptions = input.maxExceptions ?? 200;
  check(Number.isSafeInteger(maxExceptions) && maxExceptions >= 1 && maxExceptions <= 5000,
    'JOB_INPUT_EXCEPTION_LIMIT_INVALID');
  const seen = new Set(), invoices = new Set(), totals = new Map(), exceptions = [];
  const counts = { MATCH: 0, OVERCHARGED: 0, UNDERCHARGED: 0, UNKNOWN_SKU: 0, CURRENCY_MISMATCH: 0 };
  let records = 0, exceptionCount = 0;
  for await (const line of lines(context.files.stream('ledger'), context.signal)) {
    context.signal.throwIfAborted();
    if (!line.text.trim()) continue;
    check(++records <= MAX_LINES, 'JOB_INPUT_LEDGER_ROW_LIMIT');
    let row;
    try { row = JSON.parse(line.text); }
    catch { check(false, 'JOB_INPUT_LEDGER_JSON_INVALID'); }
    check(object(row) && identifier(row.invoiceId) && identifier(row.lineId) && identifier(row.sku) &&
      currency(row.currency) && Number.isSafeInteger(row.quantity) && row.quantity >= 1 &&
      row.quantity <= 1000000000, 'JOB_INPUT_LEDGER_ROW_INVALID');
    const lineId = JSON.stringify([row.invoiceId, row.lineId]);
    check(!seen.has(lineId), 'JOB_INPUT_DUPLICATE_INVOICE_LINE');
    seen.add(lineId); invoices.add(row.invoiceId);
    const charged = amount(row.chargedMinor), unitPrice = prices.get(JSON.stringify([row.sku, row.currency]));
    if (!totals.has(row.currency)) {
      check(totals.size < 64, 'JOB_INPUT_CURRENCY_LIMIT');
      totals.set(row.currency, { currency: row.currency, lines: 0, pricedLines: 0, unpricedLines: 0,
        allCharged: 0n, pricedCharged: 0n, expected: 0n, variance: 0n });
    }
    const total = totals.get(row.currency); total.lines++; total.allCharged += charged;
    let expected = null, variance = null, state;
    if (unitPrice === undefined) {
      state = skus.has(row.sku) ? 'CURRENCY_MISMATCH' : 'UNKNOWN_SKU'; total.unpricedLines++;
    } else {
      expected = unitPrice * BigInt(row.quantity); variance = charged - expected;
      state = variance === 0n ? 'MATCH' : variance > 0n ? 'OVERCHARGED' : 'UNDERCHARGED';
      total.pricedLines++; total.pricedCharged += charged; total.expected += expected; total.variance += variance;
    }
    counts[state]++;
    if (state !== 'MATCH') {
      exceptionCount++;
      if (exceptions.length < maxExceptions) exceptions.push({
        lineNumber: line.lineNumber, invoiceId: row.invoiceId, lineId: row.lineId, sku: row.sku,
        currency: row.currency, quantity: row.quantity, chargedMinor: charged.toString(),
        expectedMinor: expected === null ? null : expected.toString(),
        varianceMinor: variance === null ? null : variance.toString(), state,
      });
    }
  }
  check(records > 0, 'JOB_INPUT_LEDGER_EMPTY');
  return {
    schema: 'supplier-invoice-reconciliation.v1', reportName: input.reportName,
    jobId: context.jobId, priceBookReference: book.reference, records, invoices: invoices.size, counts,
    totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)).map(value => ({
      currency: value.currency, lines: value.lines, pricedLines: value.pricedLines, unpricedLines: value.unpricedLines,
      allChargedMinor: value.allCharged.toString(), pricedChargedMinor: value.pricedCharged.toString(),
      expectedMinor: value.expected.toString(), varianceMinor: value.variance.toString(),
    })),
    exceptions, exceptionCount, omittedExceptions: exceptionCount - exceptions.length,
    varianceMeaning: 'charged minus expected; totals include only lines with an exact SKU and currency price',
    sourceFiles: context.files.list(),
  };
}
