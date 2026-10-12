// MIT. Customer funds, dated refunds and credit disposition over original receivables.
import {randomUUID} from 'node:crypto';
import {NETWORKS, validStrKey} from '../../sf86-rpc-transfer-reconcile/terms.mjs';
import {json, sha, need, plain, field, identifier, dateValue, currencyOf, currencyKey, minor, money,
  today, customerSnapshot, invoiceSummary, receiptSummary, receiptRefundCapacity, assertReceiptConservation,
  allocationActive, refundAccountSummary, receiptUnreconciledRefunds, csv} from './core.mjs';
import {classicAsset, stellarAmount, sep7PaymentUri, requestTransactionFingerprints} from './payment-requests.mjs';

export const REFUND_SCHEMA = 'stellar-forge.merchant-receivables-refund.v1';
export const REFUND_PROPOSAL_SCHEMA = 'stellar-forge.merchant-receivables-refund-proposal.v1';
export const DISPOSITION_SCHEMA = 'stellar-forge.merchant-receivables-credit-disposition.v1';
const HEX = /^[a-f0-9]{64}$/;
const clone = value => structuredClone(value);
export const refundRows = data => {
  need(data.refunds === undefined || Array.isArray(data.refunds), 'INVALID_REFUND_REGISTER',
    'The original customer refund register is invalid.', 409);
  return data.refunds ?? [];
};
export const dispositionRows = data => {
  need(data.creditDispositions === undefined || Array.isArray(data.creditDispositions),
    'INVALID_CREDIT_DISPOSITION_REGISTER', 'The original credit disposition register is invalid.', 409);
  return data.creditDispositions ?? [];
};
export function refundSummary(row, data, asOf = today()) {
  need(plain(row.proposal) && row.proposal.id === row.id && row.proposal.schema === REFUND_PROPOSAL_SCHEMA,
    'INVALID_RETAINED_REFUND', 'The retained refund identity is invalid.', 409);
  return refundAccountSummary(row, asOf);
}
export function dispositionSummary(row) {
  const proposal = row.proposal;
  need(plain(proposal) && proposal.schema === DISPOSITION_SCHEMA && proposal.id === row.id,
    'INVALID_RETAINED_CREDIT_DISPOSITION', 'The retained credit disposition identity is invalid.', 409);
  return {id: row.id, customerId: proposal.customerId, customerName: proposal.customer.name,
    receiptId: proposal.receiptId, receiptReference: proposal.receipt.reference, currency: clone(proposal.currency),
    effectiveDate: proposal.effectiveDate, released: proposal.released, allocated: proposal.allocated,
    unappliedAfter: row.balanceEffects.receipt.after.available, createdAt: row.createdAt,
    allocationIds: [...row.allocationIds], invoiceIds: [...row.invoiceIds]};
}
function receiptFor(data, id) {
  identifier(id, 'receipt');
  const receipt = data.receipts.find(row => row.id === id);
  need(receipt && receipt.status === 'RECORDED', 'REFUND_RECEIPT_REQUIRED',
    'Choose a current original customer payment receipt.', 409);
  return receipt;
}
function invoiceFor(data, id, receipt, effectiveDate) {
  identifier(id, 'invoice');
  const invoice = data.invoices.find(row => row.id === id);
  need(invoice?.document && invoice.status === 'ISSUED' && !invoice.voidDate,
    'REFUND_INVOICE_REQUIRED', 'Choose a current issued invoice.', 409);
  need(invoice.document.customer.id === receipt.customerId &&
    currencyKey(invoice.document.currency) === currencyKey(receipt.currency), 'REFUND_INVOICE_IDENTITY_CHANGED',
  'The receipt and invoice must have the same original customer, currency and precision.', 409);
  need(invoice.document.issueDate <= effectiveDate, 'REFUND_BEFORE_INVOICE',
    'Use a disposition date on or after the original invoice issue date.');
  return invoice;
}
function uniqueNewId(value, used, name) {
  const id = identifier(value ?? randomUUID(), name);
  need(!used.has(id), 'DISPOSITION_ALLOCATION_ID_REUSED', 'Use a new identity for each resulting original allocation.', 409);
  used.add(id); return id;
}
function receiptSnapshot(receipt) {
  return {id: receipt.id, customerId: receipt.customerId, reference: receipt.reference, method: receipt.method,
    receivedDate: receipt.receivedDate, accountingDate: receipt.accountingDate ?? receipt.receivedDate,
    currency: clone(receipt.currency), amount: receipt.amount,
    sourceKind: receipt.source?.kind ?? null, sourceKey: receipt.sourceKey};
}
function normalizeFunding(data, receipt, input, effectiveDate, usedIds) {
  need(Array.isArray(input ?? []) && (input ?? []).length <= 1000, 'INVALID_REFUND_FUNDING',
    'Choose at most 1,000 original credited allocations.');
  const seen = new Set(), invoiceTotals = new Map(), currency = receipt.currency;
  const funding = (input ?? []).map(value => {
    need(plain(value), 'INVALID_REFUND_FUNDING', 'Choose the original allocation and exact amount to release.');
    identifier(value.allocationId, 'allocation');
    need(!seen.has(value.allocationId), 'DUPLICATE_REFUND_ALLOCATION', 'Select each original allocation once.');
    seen.add(value.allocationId);
    const allocation = data.allocations.find(row => row.id === value.allocationId);
    need(allocation && allocation.receiptId === receipt.id && allocationActive(allocation, effectiveDate),
      'REFUND_ALLOCATION_REQUIRED', 'Choose an allocation of this receipt active on the disposition date.', 409);
    const invoice = invoiceFor(data, allocation.invoiceId, receipt, effectiveDate);
    const amount = minor(value.amount, currency, 'credited allocation release', {positive: true});
    const original = minor(allocation.amount, currency);
    need(amount <= original, 'REFUND_RELEASE_EXCEEDS_ALLOCATION', 'Release no more than the original allocation.', 409);
    invoiceTotals.set(invoice.id, (invoiceTotals.get(invoice.id) ?? 0n) + amount);
    const replacement = original - amount;
    return {allocationId: allocation.id, invoiceId: invoice.id, invoiceNumber: invoice.number,
      amount: money(amount, currency), originalAmount: allocation.amount, allocatedDate: allocation.allocatedDate,
      originalSha256: sha(json(allocation)), invoiceSha256: invoice.files['invoice.json'].sha256,
      previousReleasedDate: allocation.releasedDate ?? null,
      replacementAmount: money(replacement, currency), replacementReleasedDate: replacement ? allocation.releasedDate ?? null : null,
      replacementAllocationId: replacement ? uniqueNewId(value.replacementAllocationId, usedIds, 'replacement allocation') : null};
  });
  for (const [id, released] of invoiceTotals) {
    const invoice = data.invoices.find(row => row.id === id);
    const credit = minor(invoiceSummary(invoice, data, effectiveDate).creditBalance, currency);
    need(released <= credit, 'REFUND_RELEASE_EXCEEDS_CREDIT',
      'Combined releases must fit the invoice credit balance on the disposition date.', 409);
  }
  return funding;
}
function normalizeTargets(data, receipt, input, effectiveDate, usedIds) {
  need(Array.isArray(input ?? []) && (input ?? []).length <= 1000, 'INVALID_CREDIT_TARGETS',
    'Choose at most 1,000 original target invoices.');
  const seen = new Set();
  return (input ?? []).map(value => {
    need(plain(value), 'INVALID_CREDIT_TARGET', 'Choose a target invoice and its exact allocation amount.');
    const invoice = invoiceFor(data, value.invoiceId, receipt, effectiveDate);
    need(!seen.has(invoice.id), 'DUPLICATE_CREDIT_TARGET', 'Select each target invoice once.'); seen.add(invoice.id);
    const amount = minor(value.amount, receipt.currency, 'target allocation', {positive: true});
    need(amount <= minor(invoiceSummary(invoice, data, effectiveDate).amountDue, receipt.currency),
      'CREDIT_TARGET_EXCEEDS_BALANCE', 'Allocate no more than the target invoice amount due.', 409);
    return {invoiceId: invoice.id, invoiceNumber: invoice.number, amount: money(amount, receipt.currency),
      invoiceSha256: invoice.files['invoice.json'].sha256,
      allocationId: uniqueNewId(value.allocationId, usedIds, 'target allocation')};
  });
}
function baseProposal(data, customer, value, schema) {
  need(plain(value), 'INVALID_CUSTOMER_FUNDS_PROPOSAL', 'Review one original customer funds operation.');
  const receipt = receiptFor(data, value.receiptId), currency = currencyOf(receipt.currency);
  need(customer?.id === receipt.customerId, 'CUSTOMER_FUNDS_IDENTITY_CHANGED',
    'Use the original receipt customer.', 409);
  const effectiveDate = dateValue(value.effectiveDate, 'funds disposition date');
  need(effectiveDate >= (receipt.accountingDate ?? receipt.receivedDate), 'REFUND_BEFORE_RECEIPT',
    'Use a disposition date on or after the original receipt date.');
  const id = identifier(value.id ?? randomUUID(), 'funds operation');
  need(!refundRows(data).some(row => row.id === id) && !dispositionRows(data).some(row => row.id === id),
    'CUSTOMER_FUNDS_ID_REUSED', 'This identity already belongs to an original funds operation.', 409);
  const usedIds = new Set(data.allocations.map(row => row.id));
  const funding = normalizeFunding(data, receipt, value.funding, effectiveDate, usedIds);
  const proposal = {schema, id, receiptId: receipt.id, customerId: receipt.customerId,
    customer: customerSnapshot(customer), receipt: receiptSnapshot(receipt), currency, effectiveDate,
    reason: field(value.reason, 'funds disposition reason', 3000),
    customerNote: field(value.customerNote ?? '', 'customer refund note', 3000, true), funding,
    receiptSha256: sha(json(receipt)),
    allocationStateSha256: sha(json(data.allocations.filter(row => row.receiptId === receipt.id))),
    refundStateSha256: sha(json(refundRows(data).filter(row => row.proposal?.receiptId === receipt.id)))};
  return {proposal, receipt, usedIds};
}
export function normalizeRefundPayout(value, proposal, adjustment, originalReturn) {
  need(plain(value) && ['OPERATOR_RECORDED', 'STELLAR_TRANSFER', 'ORIGINAL_STELLAR_ADJUSTMENT'].includes(value.kind),
    'INVALID_REFUND_PAYOUT', 'Choose a recorded external refund, a Stellar return or an original verified adjustment.');
  if (value.kind === 'OPERATOR_RECORDED') {
    const refundDate = dateValue(value.refundDate, 'actual refund date');
    const replacesRefundId = value.replacesRefundId == null ? null : identifier(value.replacesRefundId, 'reversed refund');
    need(refundDate >= proposal.receipt.receivedDate, 'REFUND_BEFORE_RECEIPT',
      'Keep the actual refund date on or after the original receipt date.');
    need(replacesRefundId || refundDate >= proposal.effectiveDate, 'REFUND_BEFORE_FUNDING',
      'Use a refund date on or after funding, or link the actual original payment to its reversed correction.');
    const accountingDate = replacesRefundId ? [refundDate, proposal.effectiveDate].sort().at(-1) : refundDate;
    return {kind: value.kind, method: field(value.method, 'refund method', 100),
      reference: field(value.reference, 'original refund reference', 300), refundDate, accountingDate, replacesRefundId};
  }
  if (value.kind === 'ORIGINAL_STELLAR_ADJUSTMENT') {
    identifier(value.adjustmentId, 'original verified adjustment');
    need(adjustment && adjustment.adjustmentId === value.adjustmentId && adjustment.receiptId === proposal.receiptId,
      'ORIGINAL_REFUND_ADJUSTMENT_REQUIRED', 'Choose the verified original reverse transfer for this receipt.', 409);
    need(adjustment.network === 'stellar:pubnet' && adjustment.transferAt,
      'PUBLIC_REFUND_CLOSE_TIME_REQUIRED', 'Use the original public-network refund with its retained ledger close time.', 409);
    const refundDate = dateValue(adjustment.transferAt.slice(0, 10), 'original refund date');
    need(refundDate >= proposal.effectiveDate, 'REFUND_BEFORE_FUNDING',
      'Choose a funding date on or before the original reverse transfer date.');
    return {kind: value.kind, adjustmentId: value.adjustmentId,
      valuationNote: field(value.valuationNote, 'commercial refund valuation', 4000),
      ...clone(adjustment), refundDate, accountingDate: refundDate};
  }
  if (value.originalRefundId !== undefined || value.originalReturnId !== undefined) {
    identifier(value.originalRefundId, 'original refund'); identifier(value.originalReturnId, 'original refund return');
    need(originalReturn && originalReturn.originalRefundId === value.originalRefundId &&
      originalReturn.originalReturnId === value.originalReturnId && originalReturn.receiptId === proposal.receiptId &&
      originalReturn.network === 'stellar:pubnet', 'ORIGINAL_REFUND_RETURN_REQUIRED',
      'Choose a verified unposted original return for this customer payment.', 409);
    const refundDate = dateValue(originalReturn.closedAt.slice(0, 10), 'original refund date');
    need(refundDate >= proposal.effectiveDate, 'REFUND_BEFORE_FUNDING',
      'Choose a funding date on or before the original outgoing transfer.');
    return {kind:value.kind,originalRefundId:value.originalRefundId,originalReturnId:value.originalReturnId,
      observationId:originalReturn.observationId,network:originalReturn.network,
      networkPassphrase:NETWORKS[originalReturn.network].passphrase,
      sourceAccount:originalReturn.sourceAccount,destination:originalReturn.destination,
      asset:clone(originalReturn.asset),stellarAmount:originalReturn.stellarAmount,amountAtomic:originalReturn.amountAtomic,
      memo:clone(originalReturn.memo),transaction:originalReturn.transaction,
      transactionFingerprint:originalReturn.transactionFingerprint,closedAt:originalReturn.closedAt,ledger:originalReturn.ledger,
      verificationScope:originalReturn.verificationScope,proofSha256:originalReturn.proofSha256,
      valuationNote:field(value.valuationNote,'commercial refund valuation',4000),
      refundDate,accountingDate:refundDate,walletHandoff:false,msg:'',uri:null};
  }
  need(Object.hasOwn(NETWORKS, value.network) && ['stellar:pubnet', 'stellar:testnet'].includes(value.network),
    'INVALID_REFUND_NETWORK', 'Choose the original Stellar public or test network.');
  need(validStrKey(value.sourceAccount, 'G') && validStrKey(value.destination, 'G') &&
    value.sourceAccount !== value.destination, 'INVALID_REFUND_PARTIES',
  'Choose distinct valid merchant and refund beneficiary G accounts.');
  const selected = stellarAmount(value.stellarAmount), asset = classicAsset(value.asset);
  const payout = {kind: value.kind, walletHandoff: true, network: value.network, networkPassphrase: NETWORKS[value.network].passphrase,
    sourceAccount: value.sourceAccount, destination: value.destination, asset,
    stellarAmount: selected.amount, amountAtomic: selected.atomic,
    memo: {type: 'MEMO_HASH', value: Buffer.from(sha(json({schema: REFUND_PROPOSAL_SCHEMA, id: proposal.id,
      receiptId: proposal.receiptId, customerId: proposal.customerId})), 'hex').toString('base64')},
    valuationNote: field(value.valuationNote, 'commercial refund valuation', 4000),
    msg: field(value.msg ?? ('Customer refund ' + proposal.receipt.reference).slice(0, 250), 'wallet refund message', 300, true)};
  payout.uri = sep7PaymentUri(payout); return payout;
}
export function planAllocationChanges(data, proposal, actor = 'Reviewed funds operation', at = '1970-01-01T00:00:00.000Z') {
  const fundingById = new Map(proposal.funding.map(row => [row.allocationId, row]));
  const released = [], created = [];
  const allocations = data.allocations.map(original => {
    const funding = fundingById.get(original.id); if (!funding) return original;
    need(sha(json(original)) === funding.originalSha256, 'CREDIT_FUNDING_CHANGED',
      'The original allocation changed after review.', 409);
    const replacement = { ...clone(original), releasedDate: proposal.effectiveDate, reason: proposal.reason, releasedBy: actor,
      history: [...original.history, {at, actor, action: 'released', releasedDate: proposal.effectiveDate,
        reason: proposal.reason, dispositionId: proposal.id, previousReleasedDate: original.releasedDate ?? null}]};
    released.push(replacement);
    if (funding.replacementAllocationId) {
      const amount = funding.replacementAmount;
      created.push({id: funding.replacementAllocationId, invoiceId: original.invoiceId, receiptId: original.receiptId,
        customerId: original.customerId, currency: clone(original.currency), amount,
        minorAmount: minor(amount, original.currency).toString(), allocatedDate: proposal.effectiveDate,
        releasedDate: funding.replacementReleasedDate, createdAt: at, actor,
        ...(funding.replacementReleasedDate ? {releasedBy: original.releasedBy ?? null, reason: original.reason ?? ''} : {}),
        replacesAllocationId: original.id, dispositionId: proposal.id,
        history: [{at, actor, action: 'allocated', allocatedDate: proposal.effectiveDate,
          replacesAllocationId: original.id, dispositionId: proposal.id},
          ...(funding.replacementReleasedDate ? [{at, actor, action: 'original_scheduled_release_preserved',
            releasedDate: funding.replacementReleasedDate, originalAllocationId: original.id}] : [])]});
    }
    return replacement;
  });
  for (const target of proposal.allocations ?? []) {
    created.push({id: target.allocationId, invoiceId: target.invoiceId, receiptId: proposal.receiptId,
      customerId: proposal.customerId, currency: clone(proposal.currency), amount: target.amount,
      minorAmount: minor(target.amount, proposal.currency).toString(), allocatedDate: proposal.effectiveDate,
      releasedDate: null, createdAt: at, actor, dispositionId: proposal.id,
      history: [{at, actor, action: 'allocated', allocatedDate: proposal.effectiveDate, dispositionId: proposal.id}]});
  }
  return {allocations: [...created, ...allocations], released, created};
}
function assertInvoiceConservation(data, ids) {
  for (const id of ids) {
    const invoice = data.invoices.find(row => row.id === id), dates = new Set([invoice.document.issueDate]);
    for (const row of data.allocations) if (row.invoiceId === id) {
      dates.add(row.allocatedDate); if (row.releasedDate) dates.add(row.releasedDate);
    }
    for (const asOf of dates) need(
      minor(invoiceSummary(invoice, data, asOf).paid, invoice.document.currency) <=
        minor(invoice.document.totals.total, invoice.document.currency),
      'INVOICE_FUNDS_ALREADY_COMMITTED', 'Saved dated allocations already cover this invoice during part of the selected range.', 409);
  }
}
function receiptBalanceSnapshot(summary) {
  return Object.fromEntries(['id', 'customerId', 'reference', 'method', 'receivedDate', 'accountingDate', 'currency',
    'amount', 'allocated', 'refunded', 'reserved', 'netAmount', 'available', 'status', 'voidDate', 'asOf']
    .map(key => [key, summary[key] ?? null]));
}
export function proposalCandidate(data, proposal, refund = null) {
  const observationOnly = proposal.accountingScope === 'TESTNET_OBSERVATION';
  const changes = observationOnly ? {allocations: data.allocations, released: [], created: []} : planAllocationChanges(data, proposal);
  const priorRefunds = refundRows(data).map(row => proposal.sourceRefundCancellation?.refundId === row.id ?
    {...row,status:'CANCELLED',cancelledDate:proposal.sourceRefundCancellation.cancelledDate} : row);
  const candidate = {...data, allocations: changes.allocations,
    refunds: refund ? [...priorRefunds, refund] : priorRefunds};
  const receipt = receiptFor(data, proposal.receiptId), invoiceIds = [...new Set([
    ...proposal.funding.map(row => row.invoiceId), ...(proposal.allocations ?? []).map(row => row.invoiceId)])];
  assertReceiptConservation(receipt, candidate); assertInvoiceConservation(candidate, invoiceIds);
  const balanceEffects = {asOf: proposal.effectiveDate,
    receipt: {before: receiptBalanceSnapshot(receiptSummary(receipt, data, proposal.effectiveDate)),
      after: receiptBalanceSnapshot(receiptSummary(receipt, candidate, proposal.effectiveDate))},
    invoices: invoiceIds.map(invoiceId => {
      const invoice = data.invoices.find(row => row.id === invoiceId);
      return {invoiceId, invoiceNumber: invoice.number,
        before: invoiceSummary(invoice, data, proposal.effectiveDate),
        after: invoiceSummary(invoice, candidate, proposal.effectiveDate)};
    })};
  return {candidate, changes, invoiceIds, balanceEffects};
}
export function compileRefundReview(data, customer, value, {adjustment = null, originalReturn = null} = {}) {
  const {proposal, receipt} = baseProposal(data, customer, value, REFUND_PROPOSAL_SCHEMA);
  proposal.amount = money(minor(value.amount, receipt.currency, 'refund amount', {positive: true}), receipt.currency);
  proposal.payout = normalizeRefundPayout(value.payout, proposal, adjustment, originalReturn);
  const unreconciled = receiptUnreconciledRefunds(receipt, data, '9999-12-31');
  need(originalReturn || unreconciled.length === 0, 'UNRECONCILED_REFUND_RETURN',
    'Receive or adopt the original verified outgoing return before assigning more of this payment.', 409);
  proposal.accountingScope = proposal.payout.network === 'stellar:testnet' ? 'TESTNET_OBSERVATION' : 'COMMERCIAL';
  if (originalReturn?.originalStatus === 'AWAITING_TRANSFER') proposal.sourceRefundCancellation = {
    refundId: originalReturn.originalRefundId,
    cancelledDate: [proposal.effectiveDate, originalReturn.originalEffectiveDate].sort().at(-1)};
  const refundDate = proposal.payout.refundDate ?? null;
  const row = {id: proposal.id, proposal, status: refundDate ? 'RECORDED' : 'AWAITING_TRANSFER', refundDate,
    accountingDate: proposal.payout.accountingDate ?? refundDate};
  const {balanceEffects} = proposalCandidate(data, proposal, row);
  return {proposal, balanceEffects, reviewSha256: sha(json({proposal, balanceEffects}))};
}
export function compileCreditDispositionReview(data, customer, value) {
  const {proposal, receipt, usedIds} = baseProposal(data, customer, value, DISPOSITION_SCHEMA);
  proposal.accountingScope = 'COMMERCIAL';
  proposal.allocations = normalizeTargets(data, receipt, value.allocations, proposal.effectiveDate, usedIds);
  need(proposal.allocations.length === 0 || receiptUnreconciledRefunds(receipt, data, '9999-12-31').length === 0,
    'UNRECONCILED_REFUND_RETURN', 'Receive or adopt the original verified outgoing return before allocating more of this payment.', 409);
  const released = proposal.funding.reduce((sum, row) => sum + minor(row.amount, receipt.currency), 0n);
  const allocated = proposal.allocations.reduce((sum, row) => sum + minor(row.amount, receipt.currency), 0n);
  need(released > 0n || allocated > 0n, 'EMPTY_CREDIT_DISPOSITION',
    'Select a credited allocation to release or an invoice to receive available funds.');
  proposal.released = money(released, receipt.currency); proposal.allocated = money(allocated, receipt.currency);
  const {balanceEffects} = proposalCandidate(data, proposal);
  return {proposal, balanceEffects, reviewSha256: sha(json({proposal, balanceEffects}))};
}
export function customerFundsView(data, customers, adjustments, {customerId, asOf = today()} = {}) {
  dateValue(asOf, 'report date');
  const customer = customerId === undefined ? null : customers.find(row => row.id === identifier(customerId, 'customer'));
  need(customerId === undefined || customer, 'CUSTOMER_NOT_FOUND', 'Choose an original accounting customer.', 404);
  const selectedReceipts = data.receipts.filter(row => (!customerId || row.customerId === customerId) &&
    row.status === 'RECORDED' && (row.accountingDate ?? row.receivedDate) <= asOf);
  const receipts = selectedReceipts.map(row => ({...receiptSummary(row, data, asOf),
    availableToRefund: receiptRefundCapacity(row, data, asOf)}));
  const receiptIds = new Set(selectedReceipts.map(row => row.id)), eligibleFunding = [], targetInvoices = [];
  for (const invoice of data.invoices) {
    if (!invoice.document || invoice.status !== 'ISSUED' || invoice.voidDate ||
      invoice.document.issueDate > asOf || customerId && invoice.document.customer.id !== customerId) continue;
    const summary = invoiceSummary(invoice, data, asOf);
    if (minor(summary.amountDue, summary.currency) > 0n) targetInvoices.push(summary);
    const credit = minor(summary.creditBalance, summary.currency);
    if (!credit) continue;
    for (const allocation of data.allocations) if (allocation.invoiceId === invoice.id &&
      receiptIds.has(allocation.receiptId) && allocationActive(allocation, asOf)) {
      const receipt = selectedReceipts.find(row => row.id === allocation.receiptId);
      const amount = minor(allocation.amount, summary.currency);
      eligibleFunding.push({allocationId: allocation.id, receiptId: receipt.id, receiptReference: receipt.reference,
        invoiceId: invoice.id, invoiceNumber: invoice.number, customerId: receipt.customerId,
        currency: clone(summary.currency), amount: allocation.amount, allocatedDate: allocation.allocatedDate,
        scheduledReleaseDate: allocation.releasedDate ?? null,
        invoiceCreditBalance: summary.creditBalance, refundableAmount: money(amount < credit ? amount : credit, summary.currency)});
    }
  }
  return {schema: 'stellar-forge.merchant-customer-funds.v1', asOf,
    customer: customer ? customerSnapshot(customer) : null, customers: customers.map(customerSnapshot),
    receipts, eligibleFunding, targetInvoices,
    availableAdjustments: adjustments.filter(row => receiptIds.has(row.receiptId))};
}
function verifiedRefundReturnFingerprints(returned) {
  const verified = (returned.observations ?? []).filter(observation =>
    observation.verification?.status === 'VERIFIED');
  if (!verified.length) return [];
  return [sha(returned.transaction), ...verified.flatMap(observation =>
    requestTransactionFingerprints(observation.verification))];
}
export function refundTransferFingerprints(row) {
  return [...new Set([...(row.payoutRecord ? requestTransactionFingerprints(row.payoutRecord) : []),
    ...(row.returns ?? []).flatMap(verifiedRefundReturnFingerprints)])];
}
export function requireUniqueRefundTransfer(data, workspaceAdjustments, row, returned, verification) {
  const network = row.proposal.payout.network, aliases = new Set(requestTransactionFingerprints(verification));
  need(aliases.size > 0, 'REFUND_TRANSACTION_FINGERPRINT_REQUIRED', 'Retain the original refund transaction identity.', 409);
  for (const receipt of data.receipts) need(receipt.source?.network !== network ||
    !requestTransactionFingerprints(receipt.source).some(value => aliases.has(value)), 'REFUND_REUSES_RECEIPT_TRANSACTION',
  'The refund must use its own outgoing transaction rather than an original incoming receipt.', 409);
  for (const other of refundRows(data)) {
    if (other.id === row.id || other.proposal.payout.network !== network ||
      other.id === row.proposal.payout.originalRefundId) continue;
    need(!refundTransferFingerprints(other).some(value => aliases.has(value)), 'REFUND_TRANSACTION_ALREADY_ASSIGNED',
      'This original transaction already belongs to another refund.', 409);
  }
  for (const request of data.paymentRequests ?? []) if (request.proposal.network === network) {
    for (const reference of request.returns ?? []) {
      const accepted = (reference.observations ?? []).filter(observation =>
        observation.status === 'RECORDED' || observation.status === 'TESTNET_VERIFIED');
      if (!reference.receiptId && !accepted.length) continue;
      const fingerprints = [sha(reference.transaction), ...accepted.flatMap(observation =>
        requestTransactionFingerprints(observation.verification))];
      need(!fingerprints.some(value => aliases.has(value)), 'REFUND_TRANSACTION_ALREADY_ASSIGNED',
        'This transaction already belongs to an original invoice collection reference.', 409);
    }
  }
  for (const adjustment of workspaceAdjustments ?? []) {
    if (adjustment.id === row.proposal.payout.adjustmentId || adjustment.kind !== 'REFUND') continue;
    if (adjustment.original?.network !== network || !adjustment.verification?.transaction) continue;
    need(!aliases.has(sha(adjustment.verification.transaction)), 'REFUND_TRANSACTION_ALREADY_ADJUSTED',
      'This transaction already belongs to another original refund adjustment.', 409);
  }
  for (const reference of row.returns ?? []) {
    if (reference.id === returned?.id) continue;
    const fingerprints = verifiedRefundReturnFingerprints(reference);
    need(!fingerprints.some(value => aliases.has(value)), 'REFUND_RETURN_ALIAS_REUSED',
      'Recover the original reference for this same refund transaction.', 409);
  }
}
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const STYLE = 'body{font:14px/1.5 system-ui,sans-serif;color:#222;background:white;margin:32px auto;max-width:980px;padding:0 24px}h1{font-size:28px}h2{font-size:18px}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:9px;border-bottom:1px solid #bbb}.amount{text-align:right;font-variant-numeric:tabular-nums}dl{display:grid;grid-template-columns:180px 1fr;gap:8px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}a{color:inherit;overflow-wrap:anywhere}footer{border-top:1px solid #bbb;margin-top:24px;padding-top:12px}';
export function refundDocument(row, kind = 'REQUEST') {
  const proposal = row.proposal;
  return {schema: 'stellar-forge.merchant-refund-document.v1', kind, id: row.id,
    customer: clone(proposal.customer), receipt: clone(proposal.receipt), currency: clone(proposal.currency),
    amount: proposal.amount, effectiveDate: proposal.effectiveDate, refundDate: row.refundDate ?? null,
    accountingDate: row.accountingDate ?? row.refundDate ?? null,
    replacesRefundId: proposal.payout.replacesRefundId ?? null,
    reference: row.payoutRecord?.reference ?? null, transaction: row.payoutRecord?.transaction ?? null,
    method: row.payoutRecord?.method ?? proposal.payout.kind, customerNote: proposal.customerNote,
    funding: proposal.funding.map(item => ({invoiceId: item.invoiceId, invoiceNumber: item.invoiceNumber,
      allocationId: item.allocationId, amount: item.amount, replacementAmount: item.replacementAmount})),
    ...(kind === 'REQUEST' ? {reviewSha256: row.reviewSha256, payout: clone(proposal.payout)} : {}),
    ...(kind === 'REVERSAL' ? {reversedDate: row.reversedDate, reversalReason: row.reversalReason} : {})};
}
export function refundDocumentHtml(document) {
  const e = escape, title = document.kind === 'REQUEST' ? 'Customer refund request' :
    document.kind === 'REVERSAL' ? 'Refund correction' : 'Customer refund advice';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+e(title)+'</title><style>'+STYLE+'</style></head><body><main><h1>'+e(title)+'</h1><h2>'+e(document.customer.name)+
    '</h2><dl><dt>Original payment</dt><dd>'+e(document.receipt.reference)+'</dd><dt>Refund amount</dt><dd>'+
    e(document.amount)+' '+e(document.currency.code)+'</dd><dt>Funds effective date</dt><dd>'+e(document.effectiveDate)+
    '</dd><dt>Actual refund date</dt><dd>'+e(document.refundDate ?? 'Awaiting transfer')+
    '</dd><dt>Accounting date</dt><dd>'+e(document.accountingDate ?? 'Awaiting transfer')+'</dd><dt>Reference</dt><dd>'+
    e(document.reference ?? document.id)+'</dd><dt>Method</dt><dd>'+e(document.method)+'</dd>'+
    (document.replacesRefundId ? '<dt>Corrected original refund</dt><dd>'+e(document.replacesRefundId)+'</dd>' : '')+
    (document.transaction ? '<dt>Transaction</dt><dd>'+e(document.transaction)+'</dd>' : '')+
    (document.reversedDate ? '<dt>Correction date</dt><dd>'+e(document.reversedDate)+'</dd>' : '')+'</dl>'+
    (document.customerNote ? '<p>'+e(document.customerNote)+'</p>' : '')+
    (document.funding.length ? '<table><thead><tr><th>Credited invoice</th><th class="amount">Released</th><th class="amount">Retained allocation</th></tr></thead><tbody>'+
      document.funding.map(row=>'<tr><td>'+e(row.invoiceNumber)+'</td><td class="amount">'+e(row.amount)+
        '</td><td class="amount">'+e(row.replacementAmount)+'</td></tr>').join('')+'</tbody></table>' : '')+
    (document.kind === 'REQUEST' && document.payout?.uri ? '<h2>Merchant wallet handoff</h2><p><a href="'+
      e(document.payout.uri)+'">Open this reviewed refund in a Stellar wallet</a></p><dl><dt>Merchant source</dt><dd>'+
      e(document.payout.sourceAccount)+'</dd><dt>Beneficiary</dt><dd>'+e(document.payout.destination)+
      '</dd><dt>Network amount</dt><dd>'+e(document.payout.stellarAmount)+' '+e(document.payout.asset.code)+
      '</dd><dt>Network</dt><dd>'+e(document.payout.network)+'</dd></dl>' : '')+
    '<footer>Original customer refund '+e(document.id)+'</footer></main></body></html>\n';
}
export function refundDocumentFiles(row, kind) {
  const document = refundDocument(row, kind), stem = kind === 'REQUEST' ? 'request' : kind === 'REVERSAL' ? 'reversal' : 'refund';
  return [
    {name: stem+'.json', bytes: Buffer.from(json(document)), type: 'application/json; charset=utf-8'},
    {name: stem+'.html', bytes: Buffer.from(refundDocumentHtml(document)), type: 'text/html; charset=utf-8'},
    {name: stem+'.csv', bytes: Buffer.from(csv([
      ['refund_id','original_receipt','customer','currency','amount','effective_date','refund_date','accounting_date','replaces_refund_id','reference','transaction','correction_date'],
      [row.id,document.receipt.reference,document.customer.name,document.currency.code,document.amount,document.effectiveDate,
        document.refundDate ?? '',document.accountingDate ?? '',document.replacesRefundId ?? '',document.reference ?? '',document.transaction ?? '',document.reversedDate ?? '']
    ])), type: 'text/csv; charset=utf-8'}
  ];
}
