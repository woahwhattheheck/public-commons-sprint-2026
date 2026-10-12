// MIT. Invoice-bound SEP-7 requests over the original receivables documents.
import {randomUUID} from 'node:crypto';
import {NETWORKS, validStrKey} from '../../sf86-rpc-transfer-reconcile/terms.mjs';
import {json, sha, need, plain, field, identifier, currencyOf, currencyKey, minor,
  money, today, dateValue, invoiceSummary, receiptSummary, allocationActive} from './core.mjs';

export const PAYMENT_REQUEST_SCHEMA = 'stellar-forge.invoice-payment-request.v1';
export const PAYMENT_PROPOSAL_SCHEMA = 'stellar-forge.invoice-payment-proposal.v1';
export const PAYMENT_TRANSFER_SCHEMA = 'stellar-forge.invoice-stellar-transfer.v1';
const HEX = /^[a-f0-9]{64}$/;
const I64_MAX = (1n << 63n) - 1n;
const U64_MAX = (1n << 64n) - 1n;
const STROOPS = 10000000n;
export const timestamp = () => new Date().toISOString();
export const requestRows = data => {
  need(data.paymentRequests === undefined || Array.isArray(data.paymentRequests),
    'INVALID_PAYMENT_REQUEST_REGISTER', 'The saved payment-request register is invalid.', 409);
  return data.paymentRequests ?? [];
};
export function paymentTimestamp(value, name) {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value),
    'INVALID_PAYMENT_REQUEST_TIME', 'Use a UTC date and time for ' + name + '.');
  const time = Date.parse(value);
  need(Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value.slice(0, 10),
    'INVALID_PAYMENT_REQUEST_TIME', 'Use a valid date and time for ' + name + '.');
  return new Date(time).toISOString();
}
export function stellarAmount(value) {
  need(typeof value === 'string' && /^(0|[1-9][0-9]{0,18})(?:\.[0-9]{1,7})?$/.test(value),
    'INVALID_STELLAR_PAYMENT_AMOUNT', 'Enter an exact positive Stellar amount with at most seven decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const atomic = BigInt(whole) * STROOPS + BigInt(fraction.padEnd(7, '0'));
  need(atomic > 0n && atomic <= I64_MAX, 'INVALID_STELLAR_PAYMENT_AMOUNT',
    'The Stellar amount must be positive and fit the native payment range.');
  return {amount: (atomic / STROOPS).toString() + '.' + (atomic % STROOPS).toString().padStart(7, '0'),
    atomic: atomic.toString()};
}
export function classicAsset(value) {
  need(plain(value), 'INVALID_STELLAR_PAYMENT_ASSET', 'Choose native XLM or an issued Stellar asset.');
  if (value.kind === 'native') {
    need((value.code === undefined || value.code === 'XLM') && (value.issuer === undefined || value.issuer === null),
      'INVALID_NATIVE_PAYMENT_ASSET', 'Native XLM has no issuer.');
    return {kind: 'native', code: 'XLM', issuer: null};
  }
  need(value.kind === 'credit' && typeof value.code === 'string' && /^[A-Za-z0-9]{1,12}$/.test(value.code) &&
    validStrKey(value.issuer, 'G'), 'INVALID_STELLAR_PAYMENT_ASSET',
    'An issued asset needs its exact code and valid issuer account.');
  return {kind: 'credit', code: value.code, issuer: value.issuer};
}
export function paymentMemo(value, fallback) {
  const selected = value ?? fallback;
  need(plain(selected) && typeof selected.value === 'string', 'INVALID_STELLAR_PAYMENT_MEMO',
    'Choose a complete transaction memo.');
  const text = selected.value;
  need(text.isWellFormed(), 'INVALID_STELLAR_PAYMENT_MEMO', 'Use valid Unicode for the transaction memo.');
  if (selected.type === 'MEMO_TEXT') {
    need(Buffer.byteLength(text, 'utf8') <= 28 && !/[\u0000-\u001f\u007f]/.test(text),
      'INVALID_STELLAR_PAYMENT_MEMO', 'A text memo supports at most 28 UTF-8 bytes.');
  } else if (selected.type === 'MEMO_ID') {
    need(/^(0|[1-9][0-9]{0,19})$/.test(text) && BigInt(text) <= U64_MAX,
      'INVALID_STELLAR_PAYMENT_MEMO', 'Use an unsigned 64-bit decimal memo ID.');
  } else {
    need(['MEMO_HASH', 'MEMO_RETURN'].includes(selected.type) &&
      /^[A-Za-z0-9+/]{43}=$/.test(text) && Buffer.from(text, 'base64').length === 32 &&
      Buffer.from(text, 'base64').toString('base64') === text,
    'INVALID_STELLAR_PAYMENT_MEMO', 'A hash or return memo needs exactly 32 bytes encoded as base64.');
  }
  return {type: selected.type, value: text};
}
export function sep7PaymentUri(proposal) {
  const params = [['destination', proposal.destination], ['amount', proposal.stellarAmount]];
  if (proposal.asset.kind === 'credit') params.push(['asset_code', proposal.asset.code], ['asset_issuer', proposal.asset.issuer]);
  params.push(['memo', proposal.memo.value], ['memo_type', proposal.memo.type]);
  if (proposal.msg) params.push(['msg', proposal.msg]);
  if (proposal.network !== 'stellar:pubnet') params.push(['network_passphrase', proposal.networkPassphrase]);
  return 'web+stellar:pay?' + params.map(([key, value]) => key + '=' + encodeURIComponent(value)).join('&');
}
export function paymentDocument(row) {
  return {schema: PAYMENT_REQUEST_SCHEMA, id: row.id, issuedAt: row.issuedAt,
    proposal: structuredClone(row.proposal), reviewSha256: row.reviewSha256};
}
function hasReceivedTransfer(row) { return (row.returns ?? []).some(item => Boolean(item.receiptId)); }
export function reservedInvoiceAmount(data, invoiceId, network, now = timestamp(), exceptId = null) {
  const rows = requestRows(data).filter(row => row.invoiceId === invoiceId && row.id !== exceptId &&
    row.proposal.network === network && !row.cancelledAt && !hasReceivedTransfer(row) &&
    (!row.proposal.expiresAt || row.proposal.expiresAt > now));
  return rows.reduce((sum, row) => sum + minor(row.proposal.invoiceAmount, row.proposal.invoice.currency), 0n);
}
export function compilePaymentProposal(invoice, data, input, {now = timestamp(), id = input?.id ?? randomUUID()} = {}) {
  need(plain(input), 'INVALID_PAYMENT_PROPOSAL', 'Enter the invoice collection terms.');
  identifier(id, 'payment request');
  need(invoice.status === 'ISSUED' && invoice.document && HEX.test(invoice.files?.['invoice.json']?.sha256 ?? '') &&
    sha(json(invoice.document)) === invoice.files['invoice.json'].sha256,
  'ISSUED_INVOICE_REQUIRED', 'Choose the retained issued invoice for this payment request.', 409);
  const current = invoiceSummary(invoice, data, today());
  need(['OPEN', 'PARTIALLY_PAID'].includes(current.paymentStatus), 'INVOICE_NOT_COLLECTIBLE',
    'This invoice has no current amount due for a new payment request.', 409);
  const invoiceCurrency = currencyOf(current.currency);
  const units = minor(input.invoiceAmount ?? current.amountDue, invoiceCurrency, 'requested invoice amount', {positive: true});
  need(Object.hasOwn(NETWORKS, input.network), 'INVALID_STELLAR_PAYMENT_NETWORK',
    'Select the public Stellar network or the Stellar test network.');
  const reserved = reservedInvoiceAmount(data, invoice.id, input.network, now, id);
  need(units + reserved <= minor(current.amountDue, invoiceCurrency), 'INVOICE_PAYMENT_REQUESTS_EXCEED_DUE',
    'The requested amount plus current payment requests exceeds the invoice amount due. Cancel a replaced request or choose the remaining amount.', 409);
  need(validStrKey(input.destination, 'G'), 'INVALID_STELLAR_PAYMENT_DESTINATION',
    'Use the merchant’s exact Stellar G account.');
  const asset = classicAsset(input.asset), amount = stellarAmount(input.stellarAmount);
  const memo = paymentMemo(input.memo, {type: 'MEMO_HASH', value: Buffer.from(sha(json({
    schema: PAYMENT_PROPOSAL_SCHEMA, id, invoiceSha256: invoice.files['invoice.json'].sha256})), 'hex').toString('base64')});
  const expiresAt = input.expiresAt == null || input.expiresAt === '' ? null :
    paymentTimestamp(input.expiresAt, 'payment-request expiry');
  need(expiresAt === null || expiresAt > now, 'PAYMENT_REQUEST_ALREADY_EXPIRED', 'Choose a future payment-request expiry.');
  const msg = field(input.msg ?? 'Payment for invoice ' + invoice.number, 'wallet message', 1200, true);
  need(msg.isWellFormed() && [...msg].length <= 300, 'PAYMENT_REQUEST_MESSAGE_TOO_LONG',
    'Use at most 300 characters for the wallet message.');
  const faceValue = asset.kind === 'native' && invoiceCurrency.code === 'XLM' &&
    BigInt(amount.atomic) === units * 10n ** BigInt(7 - invoiceCurrency.scale);
  const valuationNote = field((typeof input.valuationNote === 'string' && input.valuationNote.trim()) ||
    (faceValue ? 'Native XLM at the exact invoice face amount.' : ''),
    'invoice valuation basis', 4000);
  const proposal = {schema: PAYMENT_PROPOSAL_SCHEMA, id,
    invoice: {id: invoice.id, number: invoice.number, sha256: invoice.files['invoice.json'].sha256,
      version: invoice.version, currency: invoiceCurrency, total: current.total, amountDue: current.amountDue,
      asOf: current.asOf, customer: structuredClone(invoice.document.customer), issuer: structuredClone(invoice.document.issuer)},
    invoiceAmount: money(units, invoiceCurrency), network: input.network,
    networkPassphrase: NETWORKS[input.network].passphrase, destination: input.destination, asset,
    stellarAmount: amount.amount, amountAtomic: amount.atomic, memo, msg, expiresAt, valuationNote};
  proposal.uri = sep7PaymentUri(proposal);
  return proposal;
}
export function requestTransactionFingerprints(value) {
  const candidates = [value?.transactionFingerprint, ...(value?.transactionFingerprints ?? []),
    ...(value?.proof?.transactionFingerprints ?? [])];
  if (typeof value?.transaction === 'string' && HEX.test(value.transaction)) candidates.push(sha(value.transaction));
  for (const hash of value?.proof?.transactionHashes ?? []) if (typeof hash === 'string' && HEX.test(hash)) candidates.push(sha(hash));
  return [...new Set(candidates.filter(item => typeof item === 'string' && HEX.test(item)))];
}
export function paymentReturnInput(input) {
  need(plain(input) && typeof input.transaction === 'string' && HEX.test(input.transaction),
    'INVALID_PAYMENT_TRANSACTION', 'Enter the exact 64-character lowercase transaction hash returned by the wallet.');
  const payer = input.payer == null || input.payer === '' ? null : input.payer;
  need(payer === null || validStrKey(payer, 'G'), 'INVALID_PAYMENT_PAYER',
    'Use a valid sending Stellar G account when selecting a sender constraint.');
  return {transaction: input.transaction, payer,
    note: field(input.note ?? '', 'returned-payment note', 4000, true)};
}
export function validatePaymentVerification(proposal, returned, verification) {
  need(plain(verification) && ['VERIFIED', 'NOT_FOUND', 'FAILED'].includes(verification.status) &&
    verification.network === proposal.network && verification.transaction === returned.transaction,
  'INVALID_INVOICE_TRANSFER_VERIFICATION', 'The native payment verification does not match the saved transaction reference.', 409);
  let originalEndpoint = false;
  try {
    originalEndpoint = plain(verification.proof) && typeof verification.proof.rpcEndpoint === 'string' &&
      NETWORKS[proposal.network].rpcEndpoints.some(endpoint =>
        new URL(endpoint).href === new URL(verification.proof.rpcEndpoint).href);
  } catch {}
  need(originalEndpoint && (verification.status === 'FAILED' ||
    verification.proof.networkResponse?.passphrase === NETWORKS[proposal.network].passphrase),
  'ORIGINAL_INVOICE_TRANSFER_REQUIRED', 'Use the original network-verified Stellar RPC response for this payment.', 409);
  const observedAt = paymentTimestamp(verification.observedAt ?? timestamp(), 'transfer observation');
  if (verification.status !== 'VERIFIED') return {...structuredClone(verification), observedAt};
  need(verification.schema === PAYMENT_TRANSFER_SCHEMA &&
    verification.networkPassphrase === NETWORKS[proposal.network].passphrase &&
    validStrKey(verification.payer, 'G') && verification.payer !== proposal.destination &&
    (returned.payer === null || returned.payer === undefined || verification.payer === returned.payer) &&
    verification.recipient === proposal.destination &&
    verification.amountAtomic === proposal.amountAtomic &&
    json(classicAsset(verification.asset)) === json(proposal.asset) &&
    json(paymentMemo(verification.memo)) === json(proposal.memo) &&
    Number.isSafeInteger(verification.ledger) && verification.ledger > 0 &&
    verification.transactionFingerprint === sha(returned.transaction) &&
    verification.verificationScope === (proposal.network === 'stellar:pubnet' ? 'OFFICIAL_PUBNET_RPC' : 'OFFICIAL_TESTNET_RPC'),
  'INVOICE_TRANSFER_TERMS_MISMATCH', 'The verified payment must match the saved network, sender, merchant, asset, amount and memo.', 409);
  const closedAt = paymentTimestamp(verification.closedAt, 'transaction close time');
  const transactionFingerprints = requestTransactionFingerprints(verification);
  need(transactionFingerprints.length > 0, 'INVOICE_TRANSFER_FINGERPRINT_REQUIRED',
    'Retain the original transaction fingerprint.', 409);
  return {...structuredClone(verification), observedAt, closedAt, transactionFingerprints};
}
export function paymentRequestSummary(row, data, asOf = today(), observedAt = timestamp()) {
  dateValue(asOf, 'report date');
  const invoice = data.invoices.find(item => item.id === row.invoiceId);
  need(invoice, 'PAYMENT_REQUEST_INVOICE_MISSING', 'The original payment-request invoice is missing.', 409);
  const current = invoiceSummary(invoice, data, asOf), currency = row.proposal.invoice.currency;
  const returns = row.returns ?? [], receiptIds = new Set(returns.map(item => item.receiptId).filter(Boolean));
  const receipts = data.receipts.filter(item => receiptIds.has(item.id));
  const allocations = data.allocations.filter(item => receiptIds.has(item.receiptId) && item.invoiceId === row.invoiceId);
  let received = 0n, applied = 0n, available = 0n;
  for (const receipt of receipts) {
    const summary = receiptSummary(receipt, data, asOf);
    if (receipt.receivedDate <= asOf && (!receipt.voidDate || receipt.voidDate > asOf)) {
      received += minor(receipt.amount, currency); available += minor(summary.available, currency);
    }
  }
  for (const allocation of allocations) if (allocationActive(allocation, asOf)) applied += minor(allocation.amount, currency);
  const expires = row.proposal.expiresAt, expired = Boolean(expires && expires <= observedAt);
  const lastObservation = [...returns.flatMap(item => item.observations ?? [])]
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0] ?? null;
  let status = applied >= minor(row.proposal.invoiceAmount, currency) ? 'SATISFIED' :
    received > 0n ? (applied > 0n ? 'PARTIALLY_APPLIED' : 'RECEIVED_UNAPPLIED') :
    row.cancelledAt ? 'CANCELLED' : expired ? 'EXPIRED' :
    lastObservation?.status === 'TESTNET_VERIFIED' ? 'TESTNET_VERIFIED' :
    lastObservation && /^(TRANSFER_|FAILED|NOT_FOUND|VERIFICATION_UNAVAILABLE)/.test(lastObservation.status) ? lastObservation.status :
    returns.length ? 'AWAITING_VERIFICATION' : 'OPEN';
  if (receipts.length && received === 0n && applied === 0n) status = 'RECEIPT_REVERSED';
  return {id: row.id, invoiceId: row.invoiceId, invoiceNumber: row.proposal.invoice.number,
    customerId: row.customerId, customerName: row.proposal.invoice.customer.name,
    status, issuedAt: row.issuedAt, expiresAt: expires, cancelledAt: row.cancelledAt ?? null,
    currency, invoiceAmount: row.proposal.invoiceAmount, currentAmountDue: current.amountDue,
    balanceChanged: current.amountDue !== row.proposal.invoice.amountDue,
    received: money(received, currency), applied: money(applied, currency), unapplied: money(available, currency),
    payable: ['OPEN', 'FAILED'].includes(status) && invoice.status === 'ISSUED' && !expired &&
      minor(current.amountDue, currency) >= minor(row.proposal.invoiceAmount, currency),
    network: row.proposal.network, asset: structuredClone(row.proposal.asset),
    stellarAmount: row.proposal.stellarAmount, destination: row.proposal.destination,
    memo: structuredClone(row.proposal.memo), uri: row.proposal.uri, valuationNote: row.proposal.valuationNote,
    documentSha256: row.documentSha256, returnCount: returns.length, receiptIds: [...receiptIds],
    lastObservation: lastObservation ? {status: lastObservation.status, recordedAt: lastObservation.recordedAt,
      transaction: lastObservation.verification.transaction} : null, asOf, observedAt};
}
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export function paymentRequestHtml(row, data) {
  const p = row.proposal, s = paymentRequestSummary(row, data), e = escape;
  const line = (label, value) => '<tr><th>' + e(label) + '</th><td>' + e(value) + '</td></tr>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Payment request · ' + e(p.invoice.number) + '</title><style>*{box-sizing:border-box}body{margin:0;color:#202020;background:#fff;font:15px/1.5 system-ui,sans-serif}' +
    'main{max-width:900px;margin:40px auto;padding:0 24px}header{border-bottom:2px solid #222;padding-bottom:20px}h1{font-size:28px;margin:0 0 6px}' +
    'h2{font-size:18px;margin:30px 0 10px}p{margin:8px 0}table{border-collapse:collapse;width:100%}th,td{padding:10px 8px;text-align:left;vertical-align:top;border-bottom:1px solid #d2d2d2}' +
    'th{width:28%;color:#555;font-weight:500}td,code{overflow-wrap:anywhere}.amount{font-size:26px;font-variant-numeric:tabular-nums}.wallet{display:inline-block;padding:11px 18px;border:1px solid #222;background:#222;color:#fff;text-decoration:none}' +
    'details{margin-top:24px}footer{margin-top:32px;padding-top:16px;border-top:1px solid #aaa;font-size:12px;color:#555}@media print{main{margin:0}.wallet{color:#222;background:#fff}details{display:block}}</style></head><body><main>' +
    '<header><h1>Invoice payment request</h1><p>' + e(p.invoice.issuer.name) + '</p><p>Invoice ' + e(p.invoice.number) +
    ' · ' + e(p.invoice.customer.name) + '</p></header><section><h2>Invoice amount selected</h2><p class="amount">' +
    e(p.invoice.currency.code + ' ' + p.invoiceAmount) + '</p><p>Status: ' + e(s.status.replaceAll('_', ' ')) +
    '</p><p>Current invoice amount due: ' + e(p.invoice.currency.code + ' ' + s.currentAmountDue) + '</p></section>' +
    '<section><h2>Exact wallet payment</h2><table>' + line('Network', p.network === 'stellar:pubnet' ? 'Stellar public network' : 'Stellar test network') +
    line('Destination', p.destination) + line('Asset', p.asset.kind === 'native' ? 'Native XLM' : p.asset.code) +
    (p.asset.issuer ? line('Asset issuer', p.asset.issuer) : '') + line('Amount received', p.stellarAmount) +
    line('Memo type', p.memo.type) + line('Memo', p.memo.value) + line('Valuation', p.valuationNote) +
    line('Expires', p.expiresAt ?? 'No specified expiry') + '</table>' +
    (s.payable ? '<p><a class="wallet" href="' + e(p.uri) + '">Open wallet payment</a></p>' : '') +
    '<p>The wallet shows the payment for its owner to approve. The transaction memo connects the returned transfer to this invoice request.</p></section>' +
    '<details><summary>Payment request details</summary><p><code>' + e(p.uri) + '</code></p><p>Request ' + e(row.id) +
    '</p><p>Issued ' + e(row.issuedAt) + '</p><p>Invoice document SHA-256: ' + e(p.invoice.sha256) +
    '</p></details><footer>Payment-request status observed ' + e(s.observedAt) + '</footer></main></body></html>\n';
}
