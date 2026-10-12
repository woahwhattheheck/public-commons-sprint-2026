// MIT. Calendar terms and complete periods over original quotation and invoice records.
import {need, plain, field, dateValue, currencyOf, json, sha} from '../receivables/core.mjs';

export const AGREEMENTS_SCHEMA = 'stellar-forge.merchant-service-agreements.v1';
export const AGREEMENT_EXPORT_SCHEMA = 'stellar-forge.merchant-service-agreement-export.v1';
export const clone = value => structuredClone(value);

export function integer(value, name, minimum, maximum) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    'INVALID_AGREEMENT_NUMBER', name + ' must be a whole number from ' + minimum + ' to ' + maximum + '.');
  return value;
}
export function normalizeTerms(value, fallback = {}) {
  const billingMonths = integer(value.billingMonths ?? fallback.billingMonths ?? 1, 'Billing months', 1, 12);
  const invoiceTiming = value.invoiceTiming ?? fallback.invoiceTiming ?? 'START';
  need(invoiceTiming === 'START' || invoiceTiming === 'END', 'INVALID_AGREEMENT_TIMING',
    'Choose billing at the start or end of each service period.');
  return {billingMonths, invoiceTiming,
    dueDays: integer(value.dueDays ?? fallback.dueDays ?? 30, 'Days until payment is due', 0, 365)};
}
export function monthDate(anchor, offset) {
  dateValue(anchor, 'original service start');
  integer(offset, 'Monthly boundary', 0, 1200);
  const [year, month, day] = anchor.split('-').map(Number);
  const index = year * 12 + month - 1 + offset;
  const nextYear = Math.floor(index / 12), nextMonth = index % 12;
  need(nextYear <= 9999, 'AGREEMENT_CALENDAR_RANGE', 'The service term exceeds the supported calendar.');
  const last = new Date(0);
  last.setUTCHours(0, 0, 0, 0);
  last.setUTCFullYear(nextYear, nextMonth + 1, 0);
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(nextYear, nextMonth, Math.min(day, last.getUTCDate()));
  return result.toISOString().slice(0, 10);
}
export function monthIndex(anchor, value, maximum) {
  dateValue(value, 'effective service date');
  const [year, month] = value.split('-').map(Number);
  const [firstYear, firstMonth] = anchor.split('-').map(Number);
  const index = (year - firstYear) * 12 + month - firstMonth;
  need(index >= 0 && index <= maximum && monthDate(anchor, index) === value,
    'AGREEMENT_MONTH_BOUNDARY_REQUIRED',
    'Choose an original monthly service boundary between ' + anchor + ' and ' + monthDate(anchor, maximum) + '.');
  return index;
}
export function shiftDays(value, days) {
  dateValue(value);
  integer(days, 'Payment term days', 0, 365);
  const date = new Date(value + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  const result = date.toISOString().slice(0, 10);
  return dateValue(result, 'payment due date');
}
export function normalizedCreation(value) {
  need(plain(value), 'INVALID_SERVICE_AGREEMENT', 'Supply a complete service agreement.');
  const startDate = dateValue(value.startDate, 'service start');
  const termMonths = integer(value.termMonths, 'Initial service term months', 1, 120);
  const currency = currencyOf({code: 'USD', scale: value.currencyScale ?? 2});
  return {reference: field(value.reference, 'agreement reference', 120),
    title: field(value.title, 'agreement title', 500),
    startDate, termMonths, endDate: monthDate(startDate, termMonths),
    currency, ...normalizeTerms(value)};
}
export function linkedInvoice(billing, receivables) {
  const request = receivables.requests.find(row => row.id === billing.invoiceRequestId);
  if (!request) return null;
  const id = request.result?.invoiceId;
  const invoice = receivables.invoices.find(row => row.id === id);
  need(invoice, 'AGREEMENT_INVOICE_LINK_CHANGED',
    'The original billing request no longer has its recorded invoice.', 409);
  return invoice;
}
export function billingOccupied(billing, receivables) {
  const invoice = linkedInvoice(billing, receivables);
  return !invoice || invoice.status !== 'VOID';
}
export function assertUnbilledFrom(agreement, fromMonth, receivables) {
  const conflict = agreement.billings.find(row => row.endMonth > fromMonth && billingOccupied(row, receivables));
  need(!conflict, 'AGREEMENT_PERIOD_ALREADY_BILLED',
    'An invoice or retained billing request covers the affected service months. Complete its original recovery or void the applicable invoice before changing those months.', 409);
}
export function effectiveEnd(agreement) {
  return Math.min(agreement.termMonths, agreement.cancellation?.endMonth ?? agreement.termMonths);
}
export function agreementStatus(agreement, asOf) {
  const end = monthDate(agreement.startDate, effectiveEnd(agreement));
  if (agreement.cancellation && asOf >= end) return 'CANCELLED';
  return asOf >= end ? 'ENDED' : 'ACTIVE';
}
export function assertRenewalServicePeriod(edition, startDate, endDate) {
  if (!edition.renewal) return;
  const period = edition.renewal.servicePeriod;
  const start = period && Date.parse(period.effectiveFrom);
  const end = period?.effectiveUntil === null ? null : Date.parse(period?.effectiveUntil);
  need(plain(period) && Number.isFinite(start) && (end === null || Number.isFinite(end)),
    'AGREEMENT_RENEWAL_SERVICE_CHANGED', 'Keep the accepted renewal with its original exact service interval.', 409);
  need(Date.parse(startDate + 'T00:00:00.000Z') >= start &&
    (end === null || Date.parse(endDate + 'T00:00:00.000Z') <= end),
    'AGREEMENT_RENEWAL_SERVICE_PERIOD',
    'Keep each billed service period within the accepted renewal interval. Attach the next accepted continuation at the original monthly boundary before extending its calendar.', 409);
}
export function schedule(agreement, receivables, asOf) {
  dateValue(asOf, 'calendar date');
  const end = effectiveEnd(agreement);
  const editions = [...agreement.editions].sort((a, b) => a.fromMonth - b.fromMonth);
  const periods = [];
  // Retain each earlier term boundary when a renewal extends the agreement, so
  // a billed final short cycle never grows into a different invoice period.
  const boundaries = [...new Set([0, end, ...(agreement.calendarBreaks ?? [agreement.termMonths]),
    ...editions.map(row => row.fromMonth)].filter(value => value >= 0 && value <= end))].sort((a, b) => a - b);
  for (let index = 0; index < boundaries.length - 1; index++) {
    const segmentStart = boundaries[index], segmentEnd = boundaries[index + 1];
    const edition = editions.filter(row => row.fromMonth <= segmentStart).at(-1);
    need(edition, 'AGREEMENT_PRICE_EDITION_CHANGED', 'The service calendar needs its original quotation edition.', 409);
    for (let first = segmentStart; first < segmentEnd; first += edition.billingMonths) {
      const last = Math.min(first + edition.billingMonths, segmentEnd);
      const startDate = monthDate(agreement.startDate, first), endDate = monthDate(agreement.startDate, last);
      assertRenewalServicePeriod(edition, startDate, endDate);
      const issueDate = edition.invoiceTiming === 'START' ? startDate : endDate;
      const matches = agreement.billings.filter(row => row.startMonth < last && row.endMonth > first);
      const occupied = matches.find(row => billingOccupied(row, receivables));
      if (occupied) need(occupied.startMonth === first && occupied.endMonth === last &&
        occupied.editionId === edition.id, 'AGREEMENT_BILLING_CALENDAR_CHANGED',
        'A retained billing request differs from its original calendar period.', 409);
      const selected = occupied ?? matches.at(-1);
      const invoice = selected ? linkedInvoice(selected, receivables) : null;
      const status = occupied ? invoice?.status ?? 'PREPARING' : invoice?.status === 'VOID' ? 'VOID' :
        issueDate <= asOf ? 'DUE' : 'UPCOMING';
      const amount = edition.amountsByPeriods[String(last - first)];
      need(typeof amount === 'string', 'AGREEMENT_PRICE_EDITION_CHANGED',
        'The retained quote is missing its original whole-period amount.', 409);
      periods.push({id: 'p-' + first + '-' + last, startMonth: first, endMonth: last,
        startDate, endDate, periodCount: last - first, issueDate,
        dueDate: shiftDays(issueDate, edition.dueDays), editionId: edition.id, sourceId: edition.sourceId,
        currency: clone(edition.currency), amount, status, due: issueDate <= asOf,
        canPrepare: !occupied || !invoice, invoiceId: invoice?.id ?? null,
        invoiceNumber: invoice?.number ?? null, billingId: occupied?.id ?? null,
        billingRequestId: occupied?.requestId ?? null,
        previousInvoices: matches.map(row => {
          const original = linkedInvoice(row, receivables);
          return {billingId: row.id, invoiceId: original?.id ?? null,
            number: original?.number ?? null, status: original?.status ?? 'PREPARING'};
        })});
    }
  }
  return periods;
}
export function periodLabel(agreement, period) {
  return field('Agreement ' + agreement.reference + ': ' + period.startDate + ' to ' + period.endDate +
    ' (end exclusive)', 'source billing period', 300);
}
export function previewIdentity(value) { return sha(json(value)); }
const esc = value => String(value ?? '').replace(/[&<>"']/g,
  character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const csvCell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
export function scheduleCsv(agreement, periods) {
  const columns = ['agreement', 'customer', 'period', 'service_start', 'service_end_exclusive',
    'months', 'invoice_date', 'due_date', 'currency', 'precision', 'quoted_amount', 'status', 'invoice_number', 'invoice_id'];
  return columns.map(csvCell).join(',') + '\r\n' + periods.map(row => [
    agreement.reference, agreement.customerName, row.id, row.startDate, row.endDate,
    row.periodCount, row.issueDate, row.dueDate, row.currency.code, row.currency.scale, row.amount,
    row.status, row.invoiceNumber, row.invoiceId].map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export function agreementHtml(agreement, periods, asOf) {
  const rows = periods.map(row => '<tr><td>' + esc(row.startDate) + '</td><td>' + esc(row.endDate) +
    '</td><td>' + row.periodCount + '</td><td>' + esc(row.issueDate) + '</td><td>' + esc(row.dueDate) +
    '</td><td class="number">' + esc(row.currency.code + ' ' + row.amount) + '</td><td>' + esc(row.status) +
    '</td><td>' + esc(row.invoiceNumber ?? '') + '</td></tr>').join('');
  const editions = agreement.editions.map(row => '<li>' + esc(row.effectiveDate) + ': ' +
    esc(row.quote.title) + ' · ' + row.billingMonths + ' month billing · ' +
    esc(row.invoiceTiming === 'START' ? 'period start' : 'period end') + ' · due in ' + row.dueDays +
    ' days. ' + esc(row.reason) + '</li>').join('');
  const history = agreement.history.map(row => '<tr><td>' + esc(row.at) + '</td><td>' + esc(row.actor) +
    '</td><td>' + esc(row.action) + '</td><td>' + esc(row.reason ?? '') + '</td></tr>').join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<title>' + esc(agreement.reference) + ' — Service agreement</title><style>' +
    'body{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#fff;max-width:1200px;margin:40px auto;padding:0 24px}' +
    'h1{font-size:28px}h2{font-size:20px;margin-top:32px}table{border-collapse:collapse;width:100%;font-size:13px}' +
    'th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}th{background:#eee}.number{text-align:right;font-variant-numeric:tabular-nums}' +
    '.muted{color:#555}@media print{body{margin:0;padding:0}tr{break-inside:avoid}h2{break-after:avoid}}' +
    '</style><h1>' + esc(agreement.title) + '</h1><p>' + esc(agreement.reference) + ' · ' +
    esc(agreement.customerName) + '</p><p>Service starts ' + esc(agreement.startDate) + '. Service ends ' +
    esc(agreement.endDate) + ' (exclusive). Calendar as of ' + esc(asOf) + '.</p>' +
    '<p class="muted">Each line is an original whole-month quotation period. Amounts use its selected quote edition. ' +
    'Prepared invoice drafts continue through the original receivables review and issue workflow.</p>' +
    '<h2>Billing calendar</h2><table><thead><tr><th>Start</th><th>End, exclusive</th><th>Months</th><th>Invoice date</th>' +
    '<th>Due date</th><th>Quoted amount</th><th>Status</th><th>Invoice</th></tr></thead><tbody>' + rows +
    '</tbody></table><h2>Accepted quote editions</h2><ul>' + editions + '</ul><h2>Operating history</h2>' +
    '<table><thead><tr><th>Recorded</th><th>Operator</th><th>Action</th><th>Reason</th></tr></thead><tbody>' +
    history + '</tbody></table></html>\n';
}
