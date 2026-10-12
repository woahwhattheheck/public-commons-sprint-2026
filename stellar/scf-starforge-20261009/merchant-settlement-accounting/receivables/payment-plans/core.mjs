// MIT. Payment schedules project the original receivables ledger without changing it.
import {randomUUID} from 'node:crypto';
import {need, plain, identifier, field, dateValue, currencyOf, currencyKey, minor, money,
  json, sha, today, invoiceSummary, csv} from '../core.mjs';

export const PLAN_SCHEMA = 'stellar-forge.merchant-payment-plans.v1';
export const SCHEDULE_SCHEMA = 'stellar-forge.merchant-payment-schedule.v1';
export const REPORT_SCHEMA = 'stellar-forge.merchant-payment-plan-collections.v1';
const activeAllocation = (row, date) => row.allocatedDate <= date && (!row.releasedDate || row.releasedDate > date);
const positive = value => value > 0n ? value : 0n;
const smaller = (a, b) => a < b ? a : b;
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export function addDays(date, days) {
  dateValue(date);
  need(Number.isSafeInteger(days), 'INVALID_PLAN_DAYS', 'Use a whole number of days.');
  const result = new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  return dateValue(result);
}
function monthLength(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
/** Calculate from the original date so a short month never shifts the next anchor. */
export function addMonths(date, months, monthAnchor = 'DAY_OF_MONTH') {
  dateValue(date);
  need(Number.isSafeInteger(months) && months >= 0, 'INVALID_PLAN_MONTHS',
    'Use a nonnegative whole number of calendar months.');
  need(['DAY_OF_MONTH', 'END_OF_MONTH'].includes(monthAnchor), 'INVALID_PLAN_MONTH_ANCHOR',
    'Choose the original day of the month or the last day of each month.');
  const [year, month, day] = date.split('-').map(Number);
  const target = year * 12 + month - 1 + months;
  need(Number.isSafeInteger(target) && target < 120000, 'PAYMENT_PLAN_DATE_RANGE',
    'Keep every installment within the supported four-digit calendar years.');
  const targetYear = Math.floor(target / 12), targetMonth = target % 12 + 1;
  const lastDay = monthLength(targetYear, targetMonth);
  const targetDay = monthAnchor === 'END_OF_MONTH' ? lastDay : Math.min(day, lastDay);
  return dateValue(String(targetYear).padStart(4, '0') + '-' +
    String(targetMonth).padStart(2, '0') + '-' + String(targetDay).padStart(2, '0'));
}
function invoiceFor(data, id) {
  identifier(id, 'invoice');
  const invoice = data.invoices.find(row => row.id === id);
  need(invoice?.document, 'PAYMENT_PLAN_INVOICE_REQUIRED', 'Choose an issued invoice.', 404);
  return invoice;
}
export function normalizePlanDraft(value, invoice, data) {
  need(plain(value), 'INVALID_PAYMENT_PLAN', 'Enter a payment schedule.');
  need(invoice.document && invoice.status === 'ISSUED', 'PAYMENT_PLAN_INVOICE_REQUIRED',
    'Choose a current issued invoice for a payment schedule.', 409);
  const invoiceId = identifier(value.invoiceId, 'invoice');
  need(invoiceId === invoice.id, 'PAYMENT_PLAN_INVOICE_CHANGED', 'Keep the schedule attached to its original invoice.', 409);
  const balanceDate = dateValue(value.balanceDate, 'balance date');
  need(balanceDate >= invoice.document.issueDate, 'PAYMENT_PLAN_DATE_BEFORE_INVOICE',
    'The schedule balance date must be on or after the invoice date.');
  const currency = currencyOf(invoice.document.currency), balance = invoiceSummary(invoice, data, balanceDate);
  const balanceUnits = minor(balance.amountDue, currency);
  need(balanceUnits > 0n, 'PAYMENT_PLAN_NO_BALANCE', 'This invoice has no amount due on the selected balance date.', 409);
  need(Array.isArray(value.installments) && value.installments.length > 0 && value.installments.length <= 1000,
    'INVALID_PLAN_INSTALLMENTS', 'Enter between one and 1,000 dated installments.');
  const used = new Set();
  let total = 0n;
  const installments = value.installments.map((row, index) => {
    need(plain(row), 'INVALID_PLAN_INSTALLMENT', 'Check each installment.');
    const id = row.id === undefined ? 'installment-' + (index + 1) : field(row.id, 'installment reference', 80);
    need(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) && !used.has(id),
      'DUPLICATE_PLAN_INSTALLMENT', 'Each installment needs a unique reference.');
    used.add(id);
    const dueDate = dateValue(row.dueDate, 'installment due date');
    need(dueDate >= balanceDate, 'INSTALLMENT_BEFORE_BALANCE', 'Installments must fall on or after the schedule balance date.');
    const amount = minor(row.amount, currency, 'installment amount', {positive: true});
    total += amount;
    return {id, dueDate, amount: money(amount, currency), label: field(row.label ?? '', 'installment label', 300, true), order: index};
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.order - b.order).map(({order, ...row}) => row);
  need(total === balanceUnits, 'PAYMENT_PLAN_TOTAL_MISMATCH',
    'The installments must equal the invoice amount due on the selected balance date.', 409,
  );
  return {invoiceId, balanceDate, currency, title: field(value.title ?? 'Payment schedule', 'schedule title', 300),
    reference: field(value.reference ?? '', 'schedule reference', 300, true),
    customerNote: field(value.customerNote ?? '', 'customer schedule note', 6000, true),
    installments, total: money(total, currency)};
}

/** Split the current due balance exactly; the final installment carries the remainder. */
export function generateInstallments(value, invoice, data) {
  const balanceDate = dateValue(value.balanceDate, 'balance date');
  const currency = currencyOf(invoice.document.currency), balance = invoiceSummary(invoice, data, balanceDate);
  const amount = minor(balance.amountDue, currency, 'invoice balance', {positive: true});
  const count = Number(value.count), calendarMonths = value.intervalMonths !== undefined;
  need(Number.isSafeInteger(count) && count >= 1 && count <= 1000,
    'INVALID_INSTALLMENT_COUNT', 'Choose one to 1,000 installments.');
  need(!calendarMonths || value.intervalDays === undefined, 'AMBIGUOUS_INSTALLMENT_INTERVAL',
    'Choose either calendar months or a fixed day interval.');
  const interval = Number(calendarMonths ? value.intervalMonths : value.intervalDays ?? 30);
  need(Number.isSafeInteger(interval) && interval >= 1 && interval <= (calendarMonths ? 120 : 3660),
    'INVALID_INSTALLMENT_INTERVAL', calendarMonths ?
      'Choose one to 120 calendar months between installments.' :
      'Choose one to 3,660 days between installments.');
  const monthAnchor = value.monthAnchor ?? 'DAY_OF_MONTH';
  need(['DAY_OF_MONTH', 'END_OF_MONTH'].includes(monthAnchor) &&
      (calendarMonths || value.monthAnchor === undefined), 'INVALID_PLAN_MONTH_ANCHOR',
    'Choose a month anchor only for a calendar-month schedule.');
  const firstDueDate = dateValue(value.firstDueDate, 'first due date');
  need(firstDueDate >= balanceDate, 'INSTALLMENT_BEFORE_BALANCE', 'The first installment must fall on or after the balance date.');
  need(!calendarMonths || monthAnchor !== 'END_OF_MONTH' ||
      addMonths(firstDueDate, 0, monthAnchor) === firstDueDate, 'PAYMENT_PLAN_FIRST_MONTH_END',
    'For an end-of-month schedule, select the last day of the first due month.');
  const each = amount / BigInt(count);
  need(each > 0n, 'INSTALLMENT_BELOW_PRECISION', 'Use fewer installments for this currency amount.');
  const installments = Array.from({length: count}, (_, index) => ({
    id: 'installment-' + (index + 1), dueDate: calendarMonths ?
      addMonths(firstDueDate, index * interval, monthAnchor) : addDays(firstDueDate, index * interval),
    amount: money(index === count - 1 ? amount - each * BigInt(count - 1) : each, currency),
    label: 'Installment ' + (index + 1),
  }));
  return normalizePlanDraft({...value, invoiceId: invoice.id, installments}, invoice, data);
}
export function compilePlanReview(plan, invoice, data) {
  const draft = normalizePlanDraft(plan.draft, invoice, data), baseline = invoiceSummary(invoice, data, draft.balanceDate);
  const invoiceFile = invoice.files?.['invoice.json'];
  need(invoiceFile && /^[a-f0-9]{64}$/.test(invoiceFile.sha256),
    'PAYMENT_PLAN_ORIGINAL_INVOICE_REQUIRED', 'Retain the original issued invoice before preparing its schedule.', 409);
  const allocations = data.allocations.filter(row => row.invoiceId === invoice.id && activeAllocation(row, draft.balanceDate))
    .map(row => ({id: row.id, receiptId: row.receiptId, amount: row.amount, currency: row.currency, allocatedDate: row.allocatedDate}));
  const credits = data.credits.filter(row => row.invoiceId === invoice.id && row.document.creditDate <= draft.balanceDate)
    .map(row => ({id: row.id, number: row.number, creditDate: row.document.creditDate, amount: row.document.totals.total,
      sha256: row.files?.['credit.json']?.sha256 ?? null}));
  const source = {invoiceId: invoice.id, invoiceNumber: invoice.number, invoiceSha256: invoiceFile.sha256,
    invoiceVersion: invoice.version, balanceDate: draft.balanceDate,
    customer: structuredClone(invoice.document.customer), issuer: structuredClone(invoice.document.issuer),
    currency: structuredClone(draft.currency), issueDate: invoice.document.issueDate, originalDueDate: invoice.document.dueDate,
    total: baseline.total, paid: baseline.paid, credited: baseline.credited, amountDue: baseline.amountDue, allocations, credits};
  const review = {schema: SCHEDULE_SCHEMA, planId: plan.id, planVersion: plan.version,
    effectiveDate: draft.balanceDate, source, schedule: draft,
    allocationMethod: 'Original payments after the retained balance cover earliest installments first. Later credit notes reduce the latest installments first. Released earlier payments appear as an unscheduled balance.'};
  return {...review, reviewSha256: sha(json(review))};
}
export function scheduleDocument(review, {editionId = randomUUID(), editionNumber, actor, createdAt}) {
  return {schema: SCHEDULE_SCHEMA, id: editionId, planId: review.planId, editionNumber,
    actor, createdAt, effectiveDate: review.effectiveDate, reviewSha256: review.reviewSha256,
    source: structuredClone(review.source), schedule: structuredClone(review.schedule), allocationMethod: review.allocationMethod};
}
export function editionAt(plan, asOf) {
  dateValue(asOf);
  return [...(plan.editions ?? [])].filter(row => row.document.effectiveDate <= asOf)
    .sort((a, b) => b.document.effectiveDate.localeCompare(a.document.effectiveDate) ||
      b.document.editionNumber - a.document.editionNumber)[0] ?? null;
}
export function planProjection(plan, data, asOf = today()) {
  dateValue(asOf, 'report date');
  const invoice = invoiceFor(data, plan.invoiceId), current = invoiceSummary(invoice, data, asOf), currency = current.currency;
  const edition = editionAt(plan, asOf), cancelled = Boolean(plan.cancelledDate && plan.cancelledDate <= asOf);
  const basic = {id: plan.id, invoiceId: plan.invoiceId, invoiceNumber: invoice.number,
    customerId: invoice.document.customer.id, customerName: invoice.document.customer.name,
    reference: plan.draft.reference, title: plan.draft.title, version: plan.version, status: plan.status,
    cancelledDate: plan.cancelledDate ?? null, createdAt: plan.createdAt, updatedAt: plan.updatedAt,
    asOf, currency, invoice: current, latestEditionId: plan.editions.at(-1)?.id ?? null,
    hasDraftChanges: !plan.editions.length || sha(json(plan.draft)) !== plan.editions.at(-1).draftSha256};
  if (!edition || cancelled) return {...basic, collectionStatus: cancelled ? 'CANCELLED' : plan.editions.length ? 'FUTURE' : 'DRAFT',
    editionId: edition?.id ?? null, installments: [], scheduledOutstanding: money(0n, currency),
    unscheduledAmount: current.amountDue, overdueAmount: money(0n, currency), nextDueDate: null, baselineChanged: false};
  const doc = edition.document, baseline = doc.source;
  const recomputed = invoiceSummary(invoice, data, baseline.balanceDate);
  const baselineChanged = ['paid','credited','amountDue'].some(key => recomputed[key] !== baseline[key]) ||
    current.voidDate !== null && current.voidDate <= baseline.balanceDate;
  const amount = minor(doc.schedule.total, currency);
  const paymentDelta = minor(current.paid, currency) - minor(baseline.paid, currency);
  const creditDelta = minor(current.credited, currency) - minor(baseline.credited, currency);
  const effectiveInvoice = !['VOID','DRAFT','FUTURE'].includes(current.paymentStatus);
  let credits = smaller(positive(creditDelta), amount);
  let payments = smaller(positive(paymentDelta), amount - credits);
  const rows = doc.schedule.installments.map(row => ({...row, amountUnits: minor(row.amount, currency), creditUnits: 0n, paidUnits: 0n}));
  for (let index = rows.length - 1; index >= 0; index--) {
    const used = smaller(rows[index].amountUnits, credits);
    rows[index].creditUnits = used; credits -= used;
  }
  for (const row of rows) {
    const used = smaller(row.amountUnits - row.creditUnits, payments);
    row.paidUnits = used; payments -= used;
  }
  let scheduled = 0n, overdue = 0n;
  const installments = rows.map(row => {
    const remaining = effectiveInvoice ? row.amountUnits - row.creditUnits - row.paidUnits : 0n;
    scheduled += remaining;
    if (row.dueDate < asOf) overdue += remaining;
    return {id: row.id, label: row.label, dueDate: row.dueDate, amount: row.amount,
      paid: money(row.paidUnits, currency), credited: money(row.creditUnits, currency), remaining: money(remaining, currency),
      status: !effectiveInvoice ? 'INVOICE_CLOSED' : remaining === 0n ? 'SATISFIED' :
        row.dueDate < asOf ? 'OVERDUE' : row.dueDate === asOf ? 'DUE_TODAY' : 'UPCOMING'};
  });
  const currentDue = minor(current.amountDue, currency), unscheduled = positive(currentDue - scheduled);
  need(scheduled <= currentDue, 'PAYMENT_PLAN_LEDGER_CHANGED',
    'The saved schedule and current invoice need a new balance review.', 409);
  return {...basic, reference: doc.schedule.reference, title: doc.schedule.title,
    collectionStatus: !effectiveInvoice ? 'INVOICE_CLOSED' : currentDue === 0n ? 'SATISFIED' :
      unscheduled > 0n ? 'REPLAN_REQUIRED' : overdue > 0n ? 'OVERDUE' : 'ACTIVE',
    editionId: edition.id, editionNumber: doc.editionNumber, effectiveDate: doc.effectiveDate,
    installments, scheduledOutstanding: money(scheduled, currency), unscheduledAmount: money(unscheduled, currency),
    overdueAmount: money(overdue, currency), nextDueDate: installments.find(row => minor(row.remaining, currency) > 0n)?.dueDate ?? null,
    paymentChange: money(paymentDelta, currency), creditChange: money(creditDelta, currency),
    baselineChanged, originalInvoiceSha256: baseline.invoiceSha256, scheduleSha256: edition.files['schedule.json'].sha256};
}
export function collectionsReport(data, plans, {asOf = today(), through = addDays(asOf, 90), customerId} = {}) {
  dateValue(asOf, 'report date'); dateValue(through, 'last collection date');
  need(through >= asOf, 'INVALID_COLLECTION_HORIZON', 'The last collection date must be on or after the report date.');
  if (customerId) identifier(customerId, 'customer');
  const groups = new Map(), rows = [], projections = [], unplanned = [];
  const group = currency => {
    const key = currencyKey(currency);
    if (!groups.has(key)) groups.set(key, {currency, amountDue: 0n, overdue: 0n, dueToday: 0n,
      upcoming: 0n, afterHorizon: 0n, unscheduled: 0n, creditBalance: 0n, invoices: 0});
    return groups.get(key);
  };
  for (const invoice of data.invoices) {
    if (!invoice.document || customerId && invoice.document.customer.id !== customerId) continue;
    const summary = invoiceSummary(invoice, data, asOf);
    if (['VOID','FUTURE','DRAFT'].includes(summary.paymentStatus)) continue;
    const total = group(summary.currency); total.invoices++;
    total.amountDue += minor(summary.amountDue, summary.currency);
    total.creditBalance += minor(summary.creditBalance, summary.currency);
    const applicable = plans.filter(plan => plan.invoiceId === invoice.id && editionAt(plan, asOf) &&
      (!plan.cancelledDate || plan.cancelledDate > asOf));
    need(applicable.length <= 1, 'OVERLAPPING_PAYMENT_PLANS', 'This invoice has overlapping saved schedules. Open its plan history.', 409);
    if (!applicable.length) {
      const due = minor(summary.amountDue, summary.currency); total.unscheduled += due;
      if (due > 0n) unplanned.push({invoiceId: invoice.id, invoiceNumber: invoice.number,
        customerId: invoice.document.customer.id, customerName: invoice.document.customer.name,
        currency: summary.currency, amount: summary.amountDue, originalDueDate: summary.dueDate, reason: 'NO_EFFECTIVE_SCHEDULE'});
      continue;
    }
    const projection = planProjection(applicable[0], data, asOf); projections.push(projection);
    const difference = minor(projection.unscheduledAmount, summary.currency); total.unscheduled += difference;
    if (difference > 0n) unplanned.push({invoiceId: invoice.id, invoiceNumber: invoice.number,
      customerId: projection.customerId, customerName: projection.customerName, currency: summary.currency,
      amount: projection.unscheduledAmount, originalDueDate: summary.dueDate, reason: 'BALANCE_CHANGED', planId: projection.id});
    for (const installment of projection.installments) {
      const remaining = minor(installment.remaining, summary.currency);
      if (remaining === 0n) continue;
      const bucket = installment.dueDate < asOf ? 'overdue' : installment.dueDate === asOf ? 'dueToday' :
        installment.dueDate <= through ? 'upcoming' : 'afterHorizon';
      total[bucket] += remaining;
      rows.push({planId: projection.id, editionId: projection.editionId, invoiceId: invoice.id,
        invoiceNumber: invoice.number, customerId: projection.customerId, customerName: projection.customerName,
        currency: summary.currency, bucket, ...installment});
    }
  }
  rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.customerName.localeCompare(b.customerName) ||
    a.invoiceId.localeCompare(b.invoiceId) || a.id.localeCompare(b.id));
  return {schema: REPORT_SCHEMA, asOf, through, customerId: customerId ?? null,
    currencies: [...groups.values()].sort((a, b) => currencyKey(a.currency).localeCompare(currencyKey(b.currency)))
      .map(row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key, typeof value === 'bigint' ? money(value, row.currency) : value]))),
    installments: rows, unplanned, plans: projections};
}
const STYLE = '*{box-sizing:border-box}body{color:#1f2328;background:#fff;font:14px/1.5 system-ui,sans-serif;margin:0}main{max-width:960px;margin:36px auto;padding:0 24px}header{display:flex;justify-content:space-between;gap:30px;border-bottom:2px solid #252525;padding-bottom:20px}h1{font-size:30px;margin:0 0 8px}h2{font-size:17px}p{margin:6px 0}.note{white-space:pre-line}.muted,footer{color:#575c63}.amount{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:10px 8px;border-bottom:1px solid #bbb;text-align:left}th{font-size:11px;text-transform:uppercase}footer{font-size:11px;margin-top:30px;border-top:1px solid #bbb;padding-top:12px;overflow-wrap:anywhere}.total{font-size:19px;font-weight:600;text-align:right}@media print{main{margin:0}header,tr{break-inside:avoid}}@media(max-width:650px){main{padding:0 12px}header{display:block}table{font-size:12px}th,td{padding:6px 4px}}';
export function scheduleFiles(document) {
  const e = escape, source = document.source, schedule = document.schedule;
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    e(schedule.title) + ' · ' + e(source.invoiceNumber) + '</title><style>' + STYLE + '</style></head><body><main><header><div><h1>' +
    e(schedule.title) + '</h1><p>Invoice ' + e(source.invoiceNumber) + '</p><p>Edition ' + e(document.editionNumber) +
    ' · Effective ' + e(document.effectiveDate) + '</p><p>' + e(schedule.reference) + '</p></div><div><h2>' +
    e(source.issuer.name) + '</h2><p class="note">' + e(source.issuer.address) + '</p><p>' + e(source.issuer.email) +
    '</p></div></header><section><h2>' + e(source.customer.name) + '</h2><p class="note">' +
    e(source.customer.address) + '</p><p>' + e(source.customer.reference) + '</p></section><p>Invoice amount ' +
    e(source.currency.code) + ' ' + e(source.total) + ' · Payments at ' + e(source.balanceDate) + ': ' + e(source.paid) +
    ' · Credits: ' + e(source.credited) + '</p><table><thead><tr><th>Installment</th><th>Due date</th><th class="amount">' +
    e(source.currency.code) + '</th></tr></thead><tbody>' + schedule.installments.map((row, index) => '<tr><td>' +
      e(row.label || 'Installment ' + (index + 1)) + '</td><td>' + e(row.dueDate) + '</td><td class="amount">' + e(row.amount) +
      '</td></tr>').join('') + '</tbody></table><p class="total">Scheduled balance ' + e(source.currency.code) + ' ' +
    e(schedule.total) + '</p>' + (schedule.customerNote ? '<section><h2>Schedule notes</h2><p class="note">' +
      e(schedule.customerNote) + '</p></section>' : '') + (source.issuer.paymentInstructions ? '<section><h2>Payment instructions</h2><p class="note">' +
      e(source.issuer.paymentInstructions) + '</p></section>' : '') + '<footer>Schedule ' + e(document.id) +
    ' · Invoice ' + e(source.invoiceId) + '<p>This schedule retains the selected invoice balance and installment dates. The current account statement records payments, credits and remaining amounts.</p></footer></main></body></html>\n';
  return [
    {name:'schedule.json',type:'application/json; charset=utf-8',bytes:Buffer.from(json(document))},
    {name:'schedule.csv',type:'text/csv; charset=utf-8',bytes:Buffer.from(csv([['invoice_number','schedule_id','edition','balance_date','installment','due_date','currency','precision','amount','label'],
      ...schedule.installments.map(row => [source.invoiceNumber,document.id,document.editionNumber,source.balanceDate,row.id,row.dueDate,
        source.currency.code,source.currency.scale,row.amount,row.label])]))},
    {name:'schedule.html',type:'text/html; charset=utf-8',bytes:Buffer.from(html)},
  ];
}
export function reportFiles(report) {
  const columns = ['invoice_number','customer','plan_id','edition_id','installment','due_date','currency','precision','scheduled','paid','credited','remaining','bucket'];
  const rows = report.installments.map(row => [row.invoiceNumber,row.customerName,row.planId,row.editionId,row.id,row.dueDate,
    row.currency.code,row.currency.scale,row.amount,row.paid,row.credited,row.remaining,row.bucket]);
  for (const row of report.unplanned) rows.push([row.invoiceNumber,row.customerName,row.planId ?? '', '', '',row.originalDueDate,
    row.currency.code,row.currency.scale,'','','',row.amount,'unscheduled']);
  return [
    {name:'collections.json',type:'application/json; charset=utf-8',bytes:Buffer.from(json(report))},
    {name:'collections.csv',type:'text/csv; charset=utf-8',bytes:Buffer.from(csv([columns,...rows]))},
  ];
}
