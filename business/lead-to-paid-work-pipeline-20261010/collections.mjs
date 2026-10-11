// Offline, operator-recorded receipts. No provider calls, sends, or FX conversion.
const text = value => typeof value === 'string' ? value.trim() : '';
const positive = value => Number.isSafeInteger(value) && value > 0;
const https = value => { try { const u = new URL(value); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch { return false; } };
export function receiptTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const [date] = value.split('T');
  const clock = value.slice(11).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!clock || Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] || 0) > 59) return NaN;
  const [year, month, day] = date.split('-').map(Number);
  const calendar = new Date(0); calendar.setUTCFullYear(year, month - 1, day); calendar.setUTCHours(0, 0, 0, 0);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return NaN;
  return Date.parse(value);
}
export const exactUsdMinor = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const raw = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
  return positive(cents) ? cents : null;
};
const sum = (a, b) => { const result = a + b; if (!Number.isSafeInteger(result)) throw Error('Receipt total exceeds safe integer range'); return result; };
const identity = r => JSON.stringify([r.provider.toLowerCase(), r.accountId, r.transactionId]);
const signature = r => JSON.stringify([r.opportunityIndex, r.invoiceId, r.kind, r.currency, r.amountMinor, r.timestamp, r.parentTransactionId]);
const csv = value => '"' + String(value ?? '').replace(/^[\s]*[=+@-]/, "'$&").replace(/"/g, '""') + '"';

/** Inputs are supplied records, not independently authenticated financial facts. */
export function reconcileCollections(opportunities, decisions, now = new Date()) {
  const at = now.getTime();
  if (!Number.isFinite(at)) throw Error('Invalid collection assessment time');
  const issues = [], invoices = [], candidates = [];
  const byOpportunity = opportunities.map(() => ({ recordedNetUsd: 0, currencies: [], invoices: [], reviewRequired: false }));
  const problem = (opportunityIndex, code, invoiceId = null, transactionId = null) => {
    issues.push({ opportunityIndex, opportunityKey: decisions[opportunityIndex].key, invoiceId, transactionId, code });
    byOpportunity[opportunityIndex].reviewRequired = true;
  };
  for (const [opportunityIndex, op] of opportunities.entries()) {
    const decision = decisions[opportunityIndex];
    const signed = (decision.recordedReceipts ?? []).includes('SOW_SIGNED');
    const eventSow = decision.acceptedStageEvents?.find(e => e.kind === 'SOW_SIGNED');
    const sowAt = eventSow ? receiptTime(eventSow.timestamp) : Infinity;
    // Explicit receivables replace the legacy cash representation, preventing double counting.
    let supplied = op.receivables;
    if (supplied === undefined) {
      const invoiceEvent = decision.acceptedStageEvents?.find(e => e.kind === 'INVOICE_SENT');
      const paid = decision.acceptedStageEvents?.find(e => e.kind === 'PAYMENT_CONFIRMED');
      supplied = invoiceEvent ? [{ invoiceId: text(invoiceEvent.invoiceId) || 'legacy-invoice', currency: 'USD',
        amountMinor: null, issuedAt: invoiceEvent.timestamp, receiptUrl: invoiceEvent.receiptUrl,
        receipts: paid ? [{ ...paid, kind: 'PAYMENT', provider: 'legacy-unscoped', accountId: 'unknown',
          amountMinor: exactUsdMinor(paid.amountUsd), currency: 'USD' }] : [], legacy: true }] : [];
      if (paid && exactUsdMinor(paid.amountUsd) === null) problem(opportunityIndex, 'LEGACY_AMOUNT_NOT_EXACT_CENTS');
    }
    if (!Array.isArray(supplied)) { problem(opportunityIndex, 'RECEIVABLES_MUST_BE_ARRAY'); continue; }
    const invoiceIds = new Map();
    for (const inv of supplied) {
      const name = text(inv?.invoiceId);
      invoiceIds.set(name, (invoiceIds.get(name) || 0) + 1);
    }
    for (const inv of supplied) {
      const invoiceId = text(inv?.invoiceId);
      if (!inv || typeof inv !== 'object' || Array.isArray(inv)) { problem(opportunityIndex, 'INVALID_INVOICE'); continue; }
      const currency = text(inv.currency);
      const issuedAt = receiptTime(inv.issuedAt), dueAt = inv.dueAt === undefined ? null : receiptTime(inv.dueAt);
      const legacy = inv.legacy === true && op.receivables === undefined;
      const codes = [];
      if (!invoiceId || invoiceIds.get(invoiceId) !== 1) codes.push('INVOICE_ID_MISSING_OR_DUPLICATE');
      if (!signed || issuedAt < sowAt) codes.push('INVOICE_REQUIRES_PRIOR_RECORDED_SOW');
      if (!/^[A-Z]{3}$/.test(currency)) codes.push('INVALID_CURRENCY');
      if (!legacy && !positive(inv.amountMinor)) codes.push('INVOICE_AMOUNT_REQUIRES_POSITIVE_INTEGER_MINOR_UNITS');
      if (!https(inv.receiptUrl)) codes.push('INVOICE_RECEIPT_REQUIRED');
      if (!Number.isFinite(issuedAt) || issuedAt > at) codes.push('INVALID_OR_FUTURE_INVOICE_TIME');
      if (dueAt !== null && (!Number.isFinite(dueAt) || dueAt < issuedAt)) codes.push('INVALID_DUE_TIME');
      if (!Array.isArray(inv.receipts)) codes.push('RECEIPTS_MUST_BE_ARRAY');
      if (codes.length) { codes.forEach(code => problem(opportunityIndex, code, invoiceId)); continue; }
      const row = { opportunityIndex, opportunityKey: decision.key, owner: decision.owner, invoiceId, currency,
        amountMinor: legacy ? null : inv.amountMinor, issuedAt: inv.issuedAt, dueAt: inv.dueAt ?? null,
        receiptUrl: inv.receiptUrl, receivedMinor: 0, refundedMinor: 0, netMinor: 0, outstandingMinor: null,
        overpaidMinor: null, state: 'UNPAID', duplicateReplays: 0, reviewRequired: false, legacy };
      invoices.push(row); byOpportunity[opportunityIndex].invoices.push(row);
      for (const event of inv.receipts) {
        if (!event || typeof event !== 'object' || Array.isArray(event)) { problem(opportunityIndex, 'INVALID_RECEIPT', invoiceId); row.reviewRequired = true; continue; }
        const receipt = { ...event, opportunityIndex, invoiceId, provider: text(event.provider), accountId: text(event.accountId),
          transactionId: text(event.transactionId), parentTransactionId: text(event.parentTransactionId),
          currency: text(event.currency), row };
        const when = receiptTime(receipt.timestamp);
        const reason = !['PAYMENT', 'REFUND'].includes(receipt.kind) ? 'UNKNOWN_RECEIPT_KIND'
          : !receipt.provider || !receipt.accountId || !receipt.transactionId ? 'SCOPED_TRANSACTION_ID_REQUIRED'
          : !positive(receipt.amountMinor) ? 'RECEIPT_AMOUNT_REQUIRES_POSITIVE_INTEGER_MINOR_UNITS'
          : receipt.currency !== currency ? 'CURRENCY_MISMATCH'
          : !https(receipt.receiptUrl) ? 'PAYMENT_RECEIPT_REQUIRED'
          : !Number.isFinite(when) || when < issuedAt || when > at ? 'INVALID_OR_FUTURE_RECEIPT_TIME'
          : receipt.kind === 'REFUND' && !receipt.parentTransactionId ? 'REFUND_PARENT_REQUIRED' : null;
        if (reason) { problem(opportunityIndex, reason, invoiceId, receipt.transactionId); row.reviewRequired = true; continue; }
        candidates.push(receipt);
      }
    }
  }
  // Detect conflicts before assigning a cent, rather than letting input order choose a winner.
  const groups = new Map();
  for (const event of candidates) { const key = identity(event); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(event); }
  const unique = [];
  for (const events of groups.values()) {
    if (new Set(events.map(signature)).size !== 1) {
      for (const event of events) { problem(event.opportunityIndex, 'TRANSACTION_CONFLICT_QUARANTINED', event.invoiceId, event.transactionId); event.row.reviewRequired = true; }
    } else { unique.push(events[0]); events[0].row.duplicateReplays += events.length - 1; }
  }
  unique.sort((a, b) => receiptTime(a.timestamp) - receiptTime(b.timestamp) || (a.kind === b.kind ? identity(a).localeCompare(identity(b)) : a.kind === 'PAYMENT' ? -1 : 1));
  const payments = new Map(), accepted = [];
  for (const event of unique) {
    const key = identity(event);
    if (event.kind === 'PAYMENT') {
      payments.set(key, { event, refundedMinor: 0 });
      event.row.receivedMinor = sum(event.row.receivedMinor, event.amountMinor);
    } else {
      const parent = payments.get(identity({ ...event, transactionId: event.parentTransactionId }));
      const reason = !parent ? 'REFUND_PARENT_NOT_ACCEPTED'
        : parent.event.row !== event.row ? 'REFUND_PARENT_INVOICE_MISMATCH'
        : sum(parent.refundedMinor, event.amountMinor) > parent.event.amountMinor ? 'REFUND_EXCEEDS_PARENT_PAYMENT' : null;
      if (reason) { problem(event.opportunityIndex, reason, event.invoiceId, event.transactionId); event.row.reviewRequired = true; continue; }
      parent.refundedMinor = sum(parent.refundedMinor, event.amountMinor);
      event.row.refundedMinor = sum(event.row.refundedMinor, event.amountMinor);
    }
    const { row, ...record } = event;
    accepted.push(record);
  }
  const currencyTotals = new Map();
  for (const row of invoices) {
    row.netMinor = row.receivedMinor - row.refundedMinor;
    if (row.amountMinor !== null) {
      row.outstandingMinor = Math.max(0, row.amountMinor - row.netMinor);
      row.overpaidMinor = Math.max(0, row.netMinor - row.amountMinor);
    }
    row.state = row.amountMinor === null ? 'INVOICE_TOTAL_UNKNOWN'
      : row.overpaidMinor > 0 ? 'OVERPAID_REVIEW'
      : row.outstandingMinor === 0 ? 'SETTLED'
      : row.refundedMinor > 0 ? 'REOPENED_AFTER_REFUND'
      : row.netMinor > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
    row.overdue = row.outstandingMinor !== null && row.outstandingMinor > 0 && row.dueAt !== null && receiptTime(row.dueAt) < at;
    if (row.reviewRequired) row.state = 'REVIEW_REQUIRED';
    const target = byOpportunity[row.opportunityIndex];
    let t = target.currencies.find(x => x.currency === row.currency);
    if (!t) { t = { currency: row.currency, receivedMinor: 0, refundedMinor: 0, netMinor: 0 }; target.currencies.push(t); }
    for (const field of ['receivedMinor', 'refundedMinor', 'netMinor']) t[field] = sum(t[field], row[field]);
    if (!currencyTotals.has(row.currency)) currencyTotals.set(row.currency, { currency: row.currency, receivedMinor: 0, refundedMinor: 0, netMinor: 0 });
    const total = currencyTotals.get(row.currency);
    for (const field of ['receivedMinor', 'refundedMinor', 'netMinor']) total[field] = sum(total[field], row[field]);
  }
  for (const row of byOpportunity) row.recordedNetUsd = (row.currencies.find(x => x.currency === 'USD')?.netMinor ?? 0) / 100;
  return { generatedAt: now.toISOString(), evidence: 'OPERATOR_RECORDED_NOT_PROVIDER_VERIFIED',
    currencies: [...currencyTotals.values()].sort((a, b) => a.currency.localeCompare(b.currency)), invoices,
    acceptedReceipts: accepted, issues, byOpportunity };
}

export function collectionQueueCsv(ledger) {
  const fields = ['opportunityKey','owner','invoiceId','currency','amountMinor','netMinor','outstandingMinor','overpaidMinor','dueAt','state','overdue','reviewRequired','receiptUrl'];
  return fields.map(csv).join(',') + '\n' + ledger.invoices.filter(x => x.state !== 'SETTLED' || x.reviewRequired)
    .map(row => fields.map(field => csv(row[field])).join(',')).join('\n') + '\n';
}
