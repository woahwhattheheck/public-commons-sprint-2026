// MIT. Invoice collections casework projects the original receivables ledger.
import {json, sha, need, plain, field, identifier, dateValue, currencyKey, minor, money,
  invoiceSummary, today} from './core.mjs';

export const COLLECTION_CASE_SCHEMA = 'stellar-forge.merchant-collection-case.v1';
export const COLLECTION_REPORT_SCHEMA = 'stellar-forge.merchant-collections.v1';
export const PRIORITIES = ['NORMAL', 'HIGH', 'URGENT'];
export const ACTIVITY_KINDS = ['NOTE', 'CONTACT', 'PROMISE', 'PROMISE_OUTCOME', 'DISPUTE', 'DISPUTE_RESOLUTION'];

export function collectionRows(data) {
  need(data.collectionCases === undefined || Array.isArray(data.collectionCases),
    'INVALID_COLLECTION_REGISTER', 'The saved collections register is invalid.', 409);
  return data.collectionCases ?? [];
}
export function collectionTerms(value) {
  need(plain(value), 'INVALID_COLLECTION_CASE', 'Enter the collection case details.');
  const priority = value.priority ?? 'NORMAL';
  need(PRIORITIES.includes(priority), 'INVALID_COLLECTION_PRIORITY', 'Choose Normal, High or Urgent priority.');
  return {title: field(value.title, 'case title', 300), owner: field(value.owner, 'case owner', 160),
    priority, nextActionDate: dateValue(value.nextActionDate, 'next follow-up date')};
}
export function collectionDate(record, value) {
  const effectiveDate = dateValue(value, 'case effective date');
  const latest = record?.events?.at(-1)?.effectiveDate ?? record?.openedDate;
  need(!latest || effectiveDate >= latest, 'COLLECTION_DATE_PRECEDES_HISTORY',
    'Use an effective date on or after the latest saved case event. Record an earlier contact in Occurred date.');
  return effectiveDate;
}
function boundInvoice(record, data) {
  const invoice = data.invoices.find(row => row.id === record.invoiceId);
  need(invoice?.document && invoice.document.customer.id === record.customerId &&
    currencyKey(invoice.document.currency) === currencyKey(record.currency),
    'COLLECTION_INVOICE_CHANGED', 'The case must retain its original issued invoice, customer and currency.', 409);
  return invoice;
}
export function projectCollection(record, data, asOf = today()) {
  dateValue(asOf, 'collections date');
  need(record?.schema === COLLECTION_CASE_SCHEMA && Array.isArray(record.events) && record.events.length,
    'INVALID_COLLECTION_CASE', 'The saved collection case is invalid.', 409);
  const invoice = invoiceSummary(boundInvoice(record, data), data, asOf);
  let terms = null, status = 'FUTURE', promise = null, dispute = null, lastContact = null;
  const events = record.events.filter(event => event.effectiveDate <= asOf);
  for (const event of events) {
    if (event.kind === 'OPEN' || event.kind === 'UPDATE') terms = event.terms;
    if (event.kind === 'OPEN' || event.kind === 'REOPEN') status = 'OPEN';
    if (event.kind === 'CLOSE') status = 'CLOSED';
    if (event.nextActionDate) terms = {...terms, nextActionDate: event.nextActionDate};
    if (event.kind === 'CONTACT') lastContact = event;
    if (event.kind === 'PROMISE') promise = {...event, status: 'OPEN', outcome: null};
    if (event.kind === 'PROMISE_OUTCOME' && promise?.id === event.promiseId)
      promise = {...promise, status: event.outcome, outcome: event};
    if (event.kind === 'DISPUTE') dispute = {...event, status: 'OPEN', resolution: null};
    if (event.kind === 'DISPUTE_RESOLUTION' && dispute?.id === event.disputeId)
      dispute = {...dispute, status: 'RESOLVED', resolution: event};
  }
  const activePromise = promise?.status === 'OPEN', activeDispute = dispute?.status === 'OPEN';
  const dates = [terms?.nextActionDate, activePromise ? promise.dueDate : null].filter(Boolean).sort();
  const actionDate = dates[0] ?? null, hasBalance = minor(invoice.amountDue, invoice.currency) > 0n;
  const accountClosed = invoice.paymentStatus === 'VOID' || !hasBalance;
  const queueStatus = status !== 'OPEN' ? status : accountClosed ? 'ACCOUNT_SETTLED' :
    activeDispute ? 'DISPUTED' : activePromise && promise.dueDate < asOf ? 'PROMISE_OVERDUE' :
    actionDate && actionDate <= asOf ? 'FOLLOW_UP_DUE' : 'SCHEDULED';
  return structuredClone({id: record.id, version: record.version, invoiceId: record.invoiceId, customerId: record.customerId,
    currency: {...record.currency}, openedDate: record.openedDate, createdAt: record.createdAt,
    updatedAt: record.updatedAt, status, ...(terms ?? record.events[0].terms), actionDate, queueStatus,
    followUpDue: status === 'OPEN' && hasBalance && Boolean(actionDate && actionDate <= asOf),
    invoice, promise: promise ? {...promise, dueStatus: activePromise ?
      (promise.dueDate < asOf ? 'OVERDUE' : promise.dueDate === asOf ? 'DUE_TODAY' : 'UPCOMING') : null} : null,
    dispute, lastContact, eventCount: events.length, totalEventCount: record.events.length, asOf});
}
export function normalizeCollectionActivity(value, summary) {
  need(plain(value) && ACTIVITY_KINDS.includes(value.kind),
    'INVALID_COLLECTION_ACTIVITY', 'Choose a supported case activity.');
  const effectiveDate = dateValue(value.effectiveDate, 'activity effective date');
  const occurredDate = dateValue(value.occurredDate ?? effectiveDate, 'occurred date');
  need(occurredDate <= effectiveDate,
    'INVALID_COLLECTION_OCCURRED_DATE', 'Occurred date must be on or before this effective date.');
  const result = {kind: value.kind, effectiveDate, occurredDate,
    note: field(value.note, 'activity note', 6000), reference: field(value.reference ?? '', 'source reference', 1500, true)};
  if (value.nextActionDate) {
    result.nextActionDate = dateValue(value.nextActionDate, 'next follow-up date');
    need(result.nextActionDate >= effectiveDate, 'INVALID_COLLECTION_FOLLOW_UP',
      'The next follow-up date must be on or after this activity.');
  }
  if (value.kind === 'CONTACT') {
    need(['EMAIL', 'PHONE', 'MEETING', 'OTHER'].includes(value.channel) && ['INBOUND', 'OUTBOUND'].includes(value.direction),
      'INVALID_COLLECTION_CONTACT', 'Choose the contact channel and direction.');
    Object.assign(result, {channel: value.channel, direction: value.direction,
      contact: field(value.contact ?? '', 'contact name', 300, true)});
  }
  if (value.kind === 'PROMISE' || value.kind === 'DISPUTE') {
    const amount = minor(value.amount, summary.currency, 'recorded amount', {positive: true});
    need(amount <= minor(summary.invoice.amountDue, summary.currency), 'COLLECTION_AMOUNT_EXCEEDS_BALANCE',
      'Use an amount no greater than the original invoice balance on this effective date.');
    Object.assign(result, {amount: money(amount, summary.currency), invoiceBasis: summary.invoice});
  }
  if (value.kind === 'PROMISE') {
    need(summary.promise?.status !== 'OPEN', 'COLLECTION_PROMISE_OPEN',
      'Record the outcome of the current promise before adding another.', 409);
    result.dueDate = dateValue(value.dueDate, 'promised payment date');
    need(result.dueDate >= occurredDate, 'INVALID_COLLECTION_PROMISE_DATE',
      'The promised payment date must be on or after the original conversation.');
  }
  if (value.kind === 'PROMISE_OUTCOME') {
    need(summary.promise?.status === 'OPEN' && value.promiseId === summary.promise.id,
      'COLLECTION_PROMISE_CHANGED', 'Choose the current open promise.', 409);
    need(['KEPT', 'BROKEN', 'WITHDRAWN'].includes(value.outcome), 'INVALID_COLLECTION_PROMISE_OUTCOME',
      'Choose Kept, Broken or Withdrawn.');
    Object.assign(result, {promiseId: identifier(value.promiseId, 'promise'), outcome: value.outcome});
  }
  if (value.kind === 'DISPUTE') {
    need(summary.dispute?.status !== 'OPEN', 'COLLECTION_DISPUTE_OPEN',
      'Resolve the current dispute before recording another.', 409);
    need(['PRICING', 'DELIVERY', 'DUPLICATE', 'OTHER'].includes(value.category),
      'INVALID_COLLECTION_DISPUTE_CATEGORY', 'Choose the dispute category.');
    result.category = value.category;
  }
  if (value.kind === 'DISPUTE_RESOLUTION') {
    need(summary.dispute?.status === 'OPEN' && value.disputeId === summary.dispute.id,
      'COLLECTION_DISPUTE_CHANGED', 'Choose the current open dispute.', 409);
    result.disputeId = identifier(value.disputeId, 'dispute');
  }
  return result;
}
function matching(row, query) {
  if (query.customerId && row.customerId !== query.customerId) return false;
  if (query.owner && row.owner !== query.owner) return false;
  if (query.status && query.status !== 'ALL' && row.status !== query.status) return false;
  const search = String(query.search ?? '').trim().toLowerCase();
  return !search || [row.title, row.owner, row.invoice.number, row.invoice.customerName, row.id]
    .some(value => String(value ?? '').toLowerCase().includes(search));
}
export function collectionsReport(data, query = {}) {
  const asOf = dateValue(query.asOf ?? today(), 'collections date');
  need(!query.status || ['ALL', 'OPEN', 'CLOSED', 'FUTURE'].includes(query.status),
    'INVALID_COLLECTION_FILTER', 'Choose All, Open, Closed or Future cases.');
  const rows = collectionRows(data).map(row => projectCollection(row, data, asOf)).filter(row => matching(row, query));
  rows.sort((a, b) => Number(b.followUpDue) - Number(a.followUpDue) ||
    PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority) ||
    (a.actionDate ?? '9999').localeCompare(b.actionDate ?? '9999') || a.id.localeCompare(b.id));
  const groups = new Map();
  for (const row of rows) {
    if (row.status !== 'OPEN') continue;
    const key = currencyKey(row.currency);
    if (!groups.has(key)) groups.set(key, {currency: row.currency, cases: 0, followUpsDue: 0, amount: 0n});
    const group = groups.get(key); group.cases++; group.followUpsDue += Number(row.followUpDue);
    group.amount += minor(row.invoice.amountDue, row.currency);
  }
  const unassigned = query.owner ? [] : data.invoices.filter(row => row.document).map(row => invoiceSummary(row, data, asOf))
    .filter(row => row.overdueDays > 0 && minor(row.amountDue, row.currency) > 0n &&
      (!query.customerId || row.customerId === query.customerId) &&
      (!String(query.search ?? '').trim() || [row.number,row.customerName].some(value =>
        String(value ?? '').toLowerCase().includes(String(query.search).trim().toLowerCase()))) &&
      !rows.some(item => item.invoiceId === row.id && item.status === 'OPEN') &&
      !collectionRows(data).some(item => item.invoiceId === row.id && projectCollection(item, data, asOf).status === 'OPEN'))
    .map(row => ({...row, existingCaseId: collectionRows(data).find(item => item.invoiceId === row.id)?.id ?? null}))
    .sort((a, b) => b.overdueDays - a.overdueDays || a.id.localeCompare(b.id));
  return {schema: COLLECTION_REPORT_SCHEMA, asOf, filters: {customerId: query.customerId ?? null,
    owner: query.owner ?? null, status: query.status ?? 'ALL', search: query.search ?? ''}, cases: rows, unassigned,
    totals: [...groups.values()].map(group => ({currency: group.currency, cases: group.cases,
      followUpsDue: group.followUpsDue, amountDue: money(group.amount, group.currency)}))};
}
export function collectionReminder(summary, issuer) {
  need(summary.status !== 'FUTURE', 'COLLECTION_CASE_FUTURE', 'Use a date on or after this case opened.');
  const invoice = summary.invoice, due = minor(invoice.amountDue, invoice.currency) > 0n;
  const subject = (due ? 'Invoice reminder ' : 'Invoice balance update ') + invoice.number;
  const text = ['Hello ' + invoice.customerName + ',', '',
    due ? 'Our account shows ' + invoice.currency.code + ' ' + invoice.amountDue + ' outstanding on invoice ' +
      invoice.number + ', originally due ' + invoice.dueDate + ', as of ' + summary.asOf + '.' :
      'Our account shows no payment remaining due on invoice ' + invoice.number + ' as of ' + summary.asOf + '.',
    ...(due && summary.dispute?.status === 'OPEN' ? ['', 'We have your invoice query recorded. Please refer to this invoice number when continuing that discussion.'] : []),
    ...(due && summary.promise?.status === 'OPEN' ? ['', 'The payment date recorded in our correspondence is ' +
      summary.promise.dueDate + ' for ' + invoice.currency.code + ' ' + summary.promise.amount + '.'] : []),
    ...(due && issuer.paymentInstructions ? ['', issuer.paymentInstructions] : []),
    '', 'If your payment is already in progress, please include the invoice number with its remittance reference.',
    '', 'Thank you,', issuer.name || 'Accounts receivable'].join('\n') + '\n';
  return {subject, text, invoiceId: invoice.id, invoiceNumber: invoice.number, asOf: summary.asOf,
    amountDue: invoice.amountDue, currency: invoice.currency, sourceCaseId: summary.id};
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function csv(rows) { return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
export function collectionsCsv(report) {
  return csv([['case_id', 'invoice', 'customer', 'owner', 'priority', 'case_status', 'queue_status',
    'next_action', 'currency', 'precision', 'amount_due', 'promise_due', 'promise_amount', 'promise_status', 'dispute_amount', 'dispute_status'],
    ...report.cases.map(row => [row.id, row.invoice.number, row.invoice.customerName, row.owner, row.priority, row.status,
      row.queueStatus, row.actionDate, row.currency.code, row.currency.scale, row.invoice.amountDue,
      row.promise?.dueDate, row.promise?.amount, row.promise?.status, row.dispute?.amount, row.dispute?.status])]);
}
export function collectionCaseFiles(record, data, asOf, issuer) {
  const summary = projectCollection(record, data, asOf);
  const reminder = summary.status === 'FUTURE' ? null : collectionReminder(summary, issuer);
  const events = record.events.filter(event => event.effectiveDate <= asOf);
  const metadata = {schema: COLLECTION_CASE_SCHEMA, asOf, summary, record: structuredClone(record)};
  const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<title>' + escape(summary.title) + '</title><style>body{font:15px system-ui;margin:36px;color:#191919;max-width:1000px}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{text-align:left;padding:9px;border-bottom:1px solid #ccc;vertical-align:top}pre{white-space:pre-wrap}h1{font-size:26px}.meta{color:#555}</style>' +
    '<h1>' + escape(summary.title) + '</h1><p>' + escape(summary.invoice.number) + ' · ' + escape(summary.invoice.customerName) +
    '</p><p>Owner: ' + escape(summary.owner) + ' · ' + escape(summary.priority) + ' · ' + escape(summary.queueStatus) +
    '</p><p>As of ' + escape(asOf) + ': ' + escape(summary.currency.code + ' ' + summary.invoice.amountDue) +
    ' outstanding. Next follow-up: ' + escape(summary.actionDate) + '.</p><h2>Case history</h2><table><thead><tr><th>Effective</th><th>Activity</th><th>Operator</th><th>Details</th></tr></thead><tbody>' +
    events.map(event => '<tr><td>' + escape(event.effectiveDate) + '</td><td>' + escape(event.kind) +
      '</td><td>' + escape(event.actor) + '</td><td><pre>' + escape(event.note ?? '') +
      '</pre>' + (event.amount ? escape(summary.currency.code + ' ' + event.amount) : '') +
      (event.dueDate ? ' · Due ' + escape(event.dueDate) : '') + '<p>' + escape(event.reference ?? '') + '</p></td></tr>').join('') +
    '</tbody></table>' + (reminder ? '<h2>Prepared customer message</h2><p>' + escape(reminder.subject) + '</p><pre>' +
    escape(reminder.text) + '</pre><p class="meta">Customer message preparation and recorded contact history are separate operations.</p>' :
    '<p class="meta">This case opens on ' + escape(record.openedDate) + '. Customer reminders are available from that date.</p>') + '</html>';
  const files = [
    {name: 'case.json', type: 'application/json; charset=utf-8', bytes: Buffer.from(json(metadata))},
    {name: 'case.csv', type: 'text/csv; charset=utf-8', bytes: Buffer.from(csv([
      ['event_id', 'effective_date', 'occurred_date', 'kind', 'operator', 'amount', 'currency', 'promised_date', 'outcome', 'note', 'source_reference'],
      ...events.map(event => [event.id, event.effectiveDate, event.occurredDate, event.kind, event.actor, event.amount,
        record.currency.code, event.dueDate, event.outcome, event.note, event.reference])]))},
    {name: 'case.html', type: 'text/html; charset=utf-8', bytes: Buffer.from(html)},
    ...(reminder ? [{name: 'reminder.txt', type: 'text/plain; charset=utf-8',
      bytes: Buffer.from('Subject: ' + reminder.subject + '\n\n' + reminder.text)}] : []),
  ];
  files.push({name: 'manifest.json', type: 'application/json; charset=utf-8', bytes: Buffer.from(json({
    schema: 'stellar-forge.merchant-collection-files.v1', caseId: record.id, asOf,
    files: Object.fromEntries(files.map(file => [file.name, {bytes: file.bytes.length, sha256: sha(file.bytes)}]))}))});
  return files;
}
