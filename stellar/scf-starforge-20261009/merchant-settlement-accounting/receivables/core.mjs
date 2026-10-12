// MIT. Exact merchant receivables over the existing accounting customer workspace.
import {createHash} from 'node:crypto';

export const RECEIVABLES_SCHEMA = 'stellar-forge.merchant-receivables.v1';
export const INVOICE_SCHEMA = 'stellar-forge.merchant-invoice.v1';
export const CREDIT_SCHEMA = 'stellar-forge.merchant-credit-note.v1';
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const need = (condition, code, message, status = 400) => {
  if (!condition) throw Object.assign(new Error(message), {code, status});
};
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const MAX_MINOR = (1n << 127n) - 1n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function identifier(value, name = 'record') {
  need(typeof value === 'string' && UUID.test(value), 'INVALID_RECEIVABLE_ID', 'Choose an existing ' + name + '.');
  return value;
}
export function field(value, name, max = 500, empty = false) {
  need(typeof value === 'string' && (empty || value.trim().length > 0) && value.trim().length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    'INVALID_RECEIVABLE_FIELD', 'Check ' + name + '.');
  return value.trim();
}
export function dateValue(value, name = 'date') {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'INVALID_RECEIVABLE_DATE', 'Use YYYY-MM-DD for ' + name + '.');
  const time = Date.parse(value + 'T00:00:00.000Z');
  need(Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value,
    'INVALID_RECEIVABLE_DATE', 'Use a valid calendar date for ' + name + '.');
  return value;
}
export const today = () => new Date().toISOString().slice(0, 10);
export function currencyOf(value) {
  need(plain(value) && typeof value.code === 'string' && /^[A-Z]{3}$/.test(value.code) &&
    Number.isInteger(value.scale) && value.scale >= 0 && value.scale <= 6,
    'INVALID_RECEIVABLE_CURRENCY', 'Choose a three-letter currency code and its explicit precision from zero to six places.');
  return {code: value.code, scale: value.scale};
}
export const currencyKey = value => currencyOf(value).code + ':' + value.scale;
export function minor(value, currency, name = 'amount', {signed = false, positive = false} = {}) {
  const {scale} = currencyOf(currency);
  need(typeof value === 'string' && /^-?(0|[1-9][0-9]{0,38})(?:\.[0-9]+)?$/.test(value),
    'INVALID_RECEIVABLE_AMOUNT', 'Use an exact decimal string for ' + name + '.');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  need(fraction.length <= scale && (signed || !negative),
    'INVALID_RECEIVABLE_AMOUNT', name + ' must use the selected currency precision.');
  const units = BigInt(whole + fraction.padEnd(scale, '0')) * (negative ? -1n : 1n);
  need(units >= -MAX_MINOR && units <= MAX_MINOR && (!positive || units > 0n),
    'INVALID_RECEIVABLE_AMOUNT', 'Check the supported range for ' + name + '.');
  return units;
}
export function money(units, currency) {
  const {scale} = currencyOf(currency);
  need(typeof units === 'bigint' && units >= -MAX_MINOR && units <= MAX_MINOR,
    'RECEIVABLE_AMOUNT_RANGE', 'The combined amount exceeds the supported range.');
  const sign = units < 0n ? '-' : '';
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  return sign + (scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits);
}
function quantity(value) {
  need(typeof value === 'string' && /^(0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/.test(value),
    'INVALID_RECEIVABLE_QUANTITY', 'Use a positive quantity with up to six decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const units = BigInt(whole + fraction.padEnd(6, '0'));
  need(units > 0n, 'INVALID_RECEIVABLE_QUANTITY', 'The quantity must be positive.');
  return {units, text: whole + (fraction.replace(/0+$/, '') ? '.' + fraction.replace(/0+$/, '') : '')};
}
export function normalizeIssuer(value, version = 1) {
  need(plain(value), 'INVALID_RECEIVABLE_ISSUER', 'Enter the merchant document settings.');
  const prefix = (input, fallback) => {
    const result = field(input ?? fallback, 'document prefix', 20);
    need(/^[A-Z0-9][A-Z0-9-]*$/.test(result), 'INVALID_DOCUMENT_PREFIX', 'Use uppercase letters, digits and hyphens for a document prefix.');
    return result;
  };
  return {name: field(value.name ?? '', 'merchant name', 300, true),
    address: field(value.address ?? '', 'merchant address', 2000, true),
    email: field(value.email ?? '', 'merchant email', 300, true),
    taxReference: field(value.taxReference ?? '', 'merchant registration reference', 300, true),
    paymentInstructions: field(value.paymentInstructions ?? '', 'payment instructions', 4000, true),
    invoicePrefix: prefix(value.invoicePrefix, 'INV'), creditPrefix: prefix(value.creditPrefix, 'CN'), version};
}
export function normalizeDraft(value) {
  need(plain(value), 'INVALID_INVOICE_DRAFT', 'Send an invoice draft.');
  const currency = currencyOf(value.currency), customerId = identifier(value.customerId, 'customer');
  const issueDate = dateValue(value.issueDate, 'invoice date'), dueDate = dateValue(value.dueDate, 'due date');
  need(dueDate >= issueDate, 'INVALID_INVOICE_DATES', 'The due date must be on or after the invoice date.');
  need(Array.isArray(value.lines) && value.lines.length > 0 && value.lines.length <= 250,
    'INVALID_INVOICE_LINES', 'Supply between one and 250 invoice lines.');
  let subtotal = 0n, discount = 0n, tax = 0n;
  const used = new Set();
  const lines = value.lines.map((line, index) => {
    need(plain(line), 'INVALID_INVOICE_LINE', 'Check each invoice line.');
    const id = line.id === undefined ? 'line-' + (index + 1) : field(line.id, 'line reference', 80);
    need(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) && !used.has(id), 'DUPLICATE_INVOICE_LINE', 'Each invoice line needs a unique reference.');
    used.add(id);
    const q = quantity(line.quantity), unit = minor(line.unitAmount, currency, 'unit amount');
    const gross = (unit * q.units + 500000n) / 1000000n;
    const reduction = minor(line.discountAmount ?? '0', currency, 'line discount');
    const lineTax = minor(line.taxAmount ?? '0', currency, 'line tax');
    need(reduction <= gross, 'INVALID_LINE_DISCOUNT', 'The line discount cannot exceed its subtotal.');
    subtotal += gross; discount += reduction; tax += lineTax;
    return {id, description: field(line.description, 'line description', 3000), quantity: q.text,
      unitAmount: money(unit, currency), subtotal: money(gross, currency), discountAmount: money(reduction, currency),
      netAmount: money(gross - reduction, currency), taxAmount: money(lineTax, currency),
      total: money(gross - reduction + lineTax, currency)};
  });
  return {customerId, currency, issueDate, dueDate, lines,
    purchaseOrder: field(value.purchaseOrder ?? '', 'purchase order', 300, true),
    note: field(value.note ?? '', 'customer note', 6000, true),
    replacesId: value.replacesId ? identifier(value.replacesId, 'replaced invoice') : null,
    sourceReference: field(value.sourceReference ?? '', 'commercial source reference', 1000, true),
    totals: {subtotal: money(subtotal, currency), discount: money(discount, currency),
      net: money(subtotal - discount, currency), tax: money(tax, currency), total: money(subtotal - discount + tax, currency)},
    rounding: 'Quantity × unit amount rounds half up to the selected currency precision on each line. Discounts and tax amounts are entered explicitly.'};
}
export function customerSnapshot(value) {
  need(plain(value), 'CUSTOMER_NOT_FOUND', 'Choose a saved accounting customer.', 404);
  return {id: identifier(value.id, 'customer'), version: value.version, reference: value.reference, name: value.name,
    email: value.email ?? '', address: value.address ?? ''};
}
export function invoiceDocument(invoice, customer, issuer, number = null, issuedAt = null, actor = null) {
  const draft = normalizeDraft(invoice.draft);
  need(customer.id === draft.customerId, 'INVOICE_CUSTOMER_CHANGED', 'The selected invoice customer changed.', 409);
  return {schema: INVOICE_SCHEMA, kind: 'INVOICE', id: invoice.id, number, issuedAt, actor,
    issuer: structuredClone(issuer), customer: customerSnapshot(customer), ...draft};
}
export function normalizeCredit(value, invoice, priorCredits = []) {
  need(plain(value), 'INVALID_CREDIT_NOTE', 'Enter a credit note.');
  const doc = invoice.document, currency = doc.currency;
  const creditDate = dateValue(value.creditDate, 'credit date');
  need(creditDate >= doc.issueDate, 'INVALID_CREDIT_DATE', 'The credit date must be on or after the invoice date.');
  need(Array.isArray(value.lines) && value.lines.length > 0 && value.lines.length <= doc.lines.length,
    'INVALID_CREDIT_LINES', 'Choose original invoice lines for this credit.');
  const seen = new Set(); let net = 0n, tax = 0n;
  const lines = value.lines.map(valueLine => {
    need(plain(valueLine), 'INVALID_CREDIT_LINE', 'Check the credit line.');
    const original = doc.lines.find(line => line.id === valueLine.invoiceLineId);
    need(original && !seen.has(original.id), 'INVALID_CREDIT_LINE', 'Select each original invoice line once.');
    seen.add(original.id);
    const lineNet = minor(valueLine.netAmount, currency, 'credited net amount');
    const lineTax = minor(valueLine.taxAmount ?? '0', currency, 'credited tax amount');
    need(lineNet + lineTax > 0n, 'EMPTY_CREDIT_LINE', 'A credit line needs a positive net or tax amount.');
    let previousNet = 0n, previousTax = 0n;
    for (const note of priorCredits) for (const previous of note.document.lines) {
      if (previous.invoiceLineId === original.id) {
        previousNet += minor(previous.netAmount, currency); previousTax += minor(previous.taxAmount, currency);
      }
    }
    need(previousNet + lineNet <= minor(original.netAmount, currency) && previousTax + lineTax <= minor(original.taxAmount, currency),
      'CREDIT_EXCEEDS_INVOICE_LINE', 'Cumulative net and tax credits must stay within the original invoice line.', 409);
    net += lineNet; tax += lineTax;
    return {invoiceLineId: original.id, description: original.description, netAmount: money(lineNet, currency),
      taxAmount: money(lineTax, currency), total: money(lineNet + lineTax, currency)};
  });
  return {creditDate, reason: field(value.reason, 'credit reason', 3000), lines,
    totals: {net: money(net, currency), tax: money(tax, currency), total: money(net + tax, currency)}};
}
export function allocationActive(row, asOf) {
  return row.allocatedDate <= asOf && (!row.releasedDate || row.releasedDate > asOf);
}
export function invoiceSummary(invoice, data, asOf = today()) {
  dateValue(asOf, 'report date');
  const doc = invoice.document ?? invoice.draft, currency = doc.currency;
  let paid = 0n, credited = 0n;
  for (const row of data.allocations) if (row.invoiceId === invoice.id && allocationActive(row, asOf)) paid += minor(row.amount, currency);
  for (const row of data.credits) if (row.invoiceId === invoice.id && row.document.creditDate <= asOf) credited += minor(row.document.totals.total, currency);
  const total = minor(doc.totals.total, currency);
  const effective = Boolean(invoice.document) && doc.issueDate <= asOf && !(invoice.voidDate && invoice.voidDate <= asOf);
  const balance = effective ? total - paid - credited : 0n;
  const amountDue = balance > 0n ? balance : 0n, creditBalance = balance < 0n ? -balance : 0n;
  const overdueDays = amountDue > 0n && doc.dueDate < asOf ?
    Math.floor((Date.parse(asOf + 'T00:00:00Z') - Date.parse(doc.dueDate + 'T00:00:00Z')) / 86400000) : 0;
  let paymentStatus = invoice.voidDate && invoice.voidDate <= asOf ? 'VOID' : !invoice.document ? 'DRAFT' :
    doc.issueDate > asOf ? 'FUTURE' : balance < 0n ? 'CREDIT_BALANCE' : balance === 0n ? 'PAID' : paid > 0n ? 'PARTIALLY_PAID' : 'OPEN';
  return {id: invoice.id, number: invoice.number ?? null, version: invoice.version, status: invoice.status,
    issued: Boolean(invoice.document), customerId: doc.customerId, customerName: invoice.document?.customer.name ?? invoice.customerName,
    currency, issueDate: doc.issueDate, dueDate: doc.dueDate, total: money(total, currency),
    paid: money(paid, currency), credited: money(credited, currency), balance: money(balance, currency),
    amountDue: money(amountDue, currency), creditBalance: money(creditBalance, currency),
    paymentStatus, overdueDays, voidDate: invoice.voidDate ?? null, asOf};
}
export function receiptSummary(receipt, data, asOf = today()) {
  dateValue(asOf, 'report date'); const currency = receipt.currency;
  let allocated = 0n;
  for (const row of data.allocations) if (row.receiptId === receipt.id && allocationActive(row, asOf)) allocated += minor(row.amount, currency);
  const effective = receipt.receivedDate <= asOf && (!receipt.voidDate || receipt.voidDate > asOf);
  const amount = minor(receipt.amount, currency), available = effective ? amount - allocated : 0n;
  need(available >= 0n, 'RECEIPT_ALLOCATION_INVARIANT', 'Saved allocations exceed this receipt.', 409);
  return {...structuredClone(receipt), allocated: money(allocated, currency), available: money(available, currency), asOf};
}
export function agingReport(data, asOf = today(), customerId = null) {
  dateValue(asOf, 'report date'); const groups = new Map();
  const group = currency => {
    const key = currencyKey(currency);
    if (!groups.has(key)) groups.set(key, {currency, current: 0n, days1to30: 0n, days31to60: 0n,
      days61to90: 0n, days91plus: 0n, amountDue: 0n, creditBalance: 0n, unappliedPayments: 0n, invoices: 0});
    return groups.get(key);
  };
  const invoices = data.invoices.filter(row => !customerId || row.draft.customerId === customerId)
    .map(row => invoiceSummary(row, data, asOf));
  for (const invoice of invoices) {
    if (invoice.paymentStatus === 'DRAFT' || invoice.paymentStatus === 'VOID' || invoice.paymentStatus === 'FUTURE') continue;
    const result = group(invoice.currency), amount = minor(invoice.amountDue, invoice.currency);
    const bucket = invoice.overdueDays === 0 ? 'current' : invoice.overdueDays <= 30 ? 'days1to30' :
      invoice.overdueDays <= 60 ? 'days31to60' : invoice.overdueDays <= 90 ? 'days61to90' : 'days91plus';
    result[bucket] += amount; result.amountDue += amount; result.creditBalance += minor(invoice.creditBalance, invoice.currency);
    result.invoices++;
  }
  for (const receipt of data.receipts) if (!customerId || receipt.customerId === customerId) {
    const summary = receiptSummary(receipt, data, asOf); group(receipt.currency).unappliedPayments += minor(summary.available, receipt.currency);
  }
  return {asOf, currencies: [...groups.values()].map(value => Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, typeof item === 'bigint' ? money(item, value.currency) : item]))),
    invoices};
}
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export function csv(rows) {
  const cell = value => {
    let text = String(value ?? '');
    if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  };
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
export function renderLinesCsv(doc) {
  if (doc.kind === 'CREDIT_NOTE') return csv([['credit_number', 'invoice_number', 'invoice_line', 'description', 'currency', 'net', 'tax', 'total'],
    ...doc.lines.map(line => [doc.number, doc.invoiceNumber, line.invoiceLineId, line.description, doc.currency.code, line.netAmount, line.taxAmount, line.total])]);
  return csv([['invoice_number', 'line', 'description', 'quantity', 'unit_amount', 'subtotal', 'discount', 'net', 'tax', 'total', 'currency'],
    ...doc.lines.map(line => [doc.number, line.id, line.description, line.quantity, line.unitAmount, line.subtotal, line.discountAmount,
      line.netAmount, line.taxAmount, line.total, doc.currency.code])]);
}
const STYLE = '*{box-sizing:border-box}body{margin:0;color:#222;background:white;font:14px/1.5 system-ui,sans-serif}main{max-width:980px;margin:36px auto;padding:0 24px}header{display:flex;justify-content:space-between;gap:30px;border-bottom:2px solid #222;padding-bottom:22px}h1{font-size:32px;margin:0 0 8px}h2{font-size:18px}p{margin:6px 0}.muted{color:#555}.address{white-space:pre-line}table{width:100%;border-collapse:collapse;margin:25px 0}th,td{padding:10px 8px;border-bottom:1px solid #ccc;text-align:left;vertical-align:top}th{font-size:11px;text-transform:uppercase;letter-spacing:.04em}.amount{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.totals{margin-left:auto;width:min(100%,390px)}.totals p{display:flex;justify-content:space-between;gap:30px;padding:6px}.total{border-top:2px solid #222;font-size:20px;font-weight:600}section{margin:22px 0}footer{font-size:11px;color:#555;margin-top:35px;border-top:1px solid #aaa;padding-top:12px;overflow-wrap:anywhere}@media print{main{margin:0}header,section,table{break-inside:avoid}}@media(max-width:680px){main{padding:0 12px}header{display:block}table{font-size:11px}th,td{padding:5px 3px}}';
export function renderDocumentHtml(doc) {
  const e = escape, credit = doc.kind === 'CREDIT_NOTE';
  const lines = doc.lines.map(line => '<tr><td>' + e(line.description) + '</td>' +
    (credit ? '' : '<td class="amount">' + e(line.quantity) + '</td><td class="amount">' + e(line.unitAmount) + '</td><td class="amount">' + e(line.discountAmount) + '</td>') +
    '<td class="amount">' + e(line.netAmount) + '</td><td class="amount">' + e(line.taxAmount) + '</td><td class="amount">' + e(line.total) + '</td></tr>').join('');
  const customer = doc.customer, issuer = doc.issuer;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    e(doc.number ?? 'Invoice preview') + '</title><style>' + STYLE + '</style></head><body><main><header><div><h1>' +
    (credit ? 'Credit note' : 'Invoice') + '</h1><p>' + e(doc.number ?? 'Draft preview') + '</p><p>' +
    e(credit ? doc.creditDate : doc.issueDate) + '</p>' + (credit ? '<p>Invoice ' + e(doc.invoiceNumber) + '</p>' :
      '<p>Due ' + e(doc.dueDate) + '</p>') + '</div><div><h2>' + e(issuer.name) + '</h2><p class="address">' +
    e(issuer.address) + '</p><p>' + e(issuer.email) + '</p>' + (issuer.taxReference ? '<p>' + e(issuer.taxReference) + '</p>' : '') +
    '</div></header><section><h2>Bill to</h2><p>' + e(customer.name) + '</p><p class="address">' + e(customer.address) +
    '</p><p>' + e(customer.email) + '</p><p class="muted">' + e(customer.reference) + '</p></section>' +
    (!credit && doc.purchaseOrder ? '<p>Purchase order: ' + e(doc.purchaseOrder) + '</p>' : '') +
    '<table><thead><tr><th>Description</th>' + (credit ? '' : '<th class="amount">Quantity</th><th class="amount">Unit amount</th><th class="amount">Discount</th>') +
    '<th class="amount">Net</th><th class="amount">Tax</th><th class="amount">Total</th></tr></thead><tbody>' + lines +
    '</tbody></table><div class="totals"><p><span>Net</span><span>' + e(doc.totals.net) + '</span></p><p><span>Tax</span><span>' +
    e(doc.totals.tax) + '</span></p><p class="total"><span>' + e(doc.currency.code) + ' total</span><span>' + e(doc.totals.total) +
    '</span></p></div>' + (credit ? '<section><h2>Reason</h2><p class="address">' + e(doc.reason) + '</p></section>' :
      (doc.note ? '<section><p class="address">' + e(doc.note) + '</p></section>' : '') +
      (issuer.paymentInstructions ? '<section><h2>Payment instructions</h2><p class="address">' + e(issuer.paymentInstructions) + '</p></section>' : '')) +
    '<footer>Document ' + e(doc.id) + (doc.sourceReference ? ' · Source ' + e(doc.sourceReference) : '') +
    (doc.replacesId ? ' · Replaces document ' + e(doc.replacesId) : '') + '</footer></main></body></html>\n';
}
export function customerExport(data, customer, asOf = today()) {
  const snapshot = customerSnapshot(customer), aging = agingReport(data, asOf, customer.id);
  const visibleInvoices = aging.invoices.filter(row => row.issued && row.issueDate <= asOf);
  const invoiceIds = new Set(visibleInvoices.map(row => row.id));
  const value = {schema: 'stellar-forge.merchant-receivables-customer-export.v1', asOf, customer: snapshot,
    currencies: aging.currencies, invoices: visibleInvoices,
    credits: data.credits.filter(row => invoiceIds.has(row.invoiceId) && row.document.creditDate <= asOf).map(row => ({id: row.id, invoiceId: row.invoiceId,
      number: row.number, creditDate: row.document.creditDate, currency: row.document.currency, total: row.document.totals.total, reason: row.document.reason})),
    receipts: data.receipts.filter(row => row.customerId === customer.id && row.receivedDate <= asOf).map(row => {
      const result = receiptSummary(row, data, asOf);
      return Object.fromEntries(['id', 'reference', 'method', 'receivedDate', 'currency', 'amount', 'allocated', 'available', 'voidDate'].map(key => [key, result[key] ?? null]));
    }),
    allocations: data.allocations.filter(row => invoiceIds.has(row.invoiceId) && row.allocatedDate <= asOf).map(row =>
      Object.fromEntries(['id', 'receiptId', 'invoiceId', 'amount', 'currency', 'allocatedDate', 'releasedDate'].map(key => [key, row[key] ?? null])))};
  const invoiceCsv = csv([['invoice', 'status', 'issue_date', 'due_date', 'currency', 'total', 'paid', 'credited', 'amount_due', 'credit_balance', 'overdue_days'],
    ...value.invoices.map(row => [row.number ?? row.id, row.paymentStatus, row.issueDate, row.dueDate, row.currency.code, row.total, row.paid, row.credited,
      row.amountDue, row.creditBalance, row.overdueDays])]);
  const e = escape;
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account statement — ' +
    e(customer.name) + '</title><style>' + STYLE + '</style></head><body><main><header><div><h1>Account statement</h1><p>As of ' + e(asOf) +
    '</p></div><div><h2>' + e(customer.name) + '</h2><p>' + e(customer.reference) + '</p></div></header>' +
    value.currencies.map(row => '<section><h2>' + e(row.currency.code) + '</h2><p>Amount due ' + e(row.amountDue) +
      ' · Credit balance ' + e(row.creditBalance) + ' · Unapplied payments ' + e(row.unappliedPayments) + '</p></section>').join('') +
    '<table><thead><tr><th>Invoice</th><th>Due</th><th>Currency</th><th class="amount">Amount due</th><th class="amount">Credit balance</th><th>Status</th></tr></thead><tbody>' +
    value.invoices.map(row => '<tr><td>' + e(row.number ?? 'Draft') + '</td><td>' + e(row.dueDate) + '</td><td>' + e(row.currency.code) +
      '</td><td class="amount">' + e(row.amountDue) + '</td><td class="amount">' + e(row.creditBalance) + '</td><td>' + e(row.paymentStatus) + '</td></tr>').join('') +
    '</tbody></table></main></body></html>\n';
  return {value, files: [{name: 'account.json', type: 'application/json', bytes: Buffer.from(json(value))},
    {name: 'invoices.csv', type: 'text/csv; charset=utf-8', bytes: Buffer.from(invoiceCsv)},
    {name: 'account.html', type: 'text/html; charset=utf-8', bytes: Buffer.from(html)}]};
}

/** Deterministic ustar packet of the original customer export files. */
export function renderCustomerTar(files) {
  need(Array.isArray(files) && files.length > 0, 'EMPTY_CUSTOMER_PACKET', 'Choose a customer account export.');
  const blocks = []; let total = 1024;
  const put = (header, value, offset, length) => {
    const bytes = Buffer.from(value, 'ascii');
    need(bytes.length <= length, 'CUSTOMER_PACKET_FIELD', 'The account packet field exceeds its format.');
    bytes.copy(header, offset);
  };
  const octal = (header, value, offset, length) => put(header, value.toString(8).padStart(length - 1, '0') + '\0', offset, length);
  const names = new Set();
  for (const file of files) {
    need(typeof file.name === 'string' && /^(?:documents\/)?[A-Za-z0-9._-]+$/.test(file.name) &&
      file.name.length <= 100 && !names.has(file.name), 'INVALID_CUSTOMER_PACKET_PATH', 'The account packet needs unique original filenames.');
    names.add(file.name);
    const bytes = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(file.bytes);
    const padding = (512 - bytes.length % 512) % 512;
    total += 512 + bytes.length + padding;
    need(total <= 128_000_000, 'CUSTOMER_PACKET_LIMIT', 'This customer packet exceeds 128 MB. Export an earlier account date or use its individual documents.');
    const header = Buffer.alloc(512);
    put(header, file.name, 0, 100); octal(header, 0o600, 100, 8);
    octal(header, 0, 108, 8); octal(header, 0, 116, 8); octal(header, bytes.length, 124, 12); octal(header, 0, 136, 12);
    header.fill(32, 148, 156); header[156] = 48; put(header, 'ustar\0', 257, 6); put(header, '00', 263, 2);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    put(header, checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    blocks.push(header, bytes);
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks, total);
}
