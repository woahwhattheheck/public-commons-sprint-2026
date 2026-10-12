// MIT. Native invoice collection shares the original accounting lease and journal.
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open, mkdir, lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {json, sha, need, plain, field, identifier, dateValue, currencyKey, minor, money,
  today, invoiceSummary, receiptSummary} from './core.mjs';
import {refundRows, refundTransferFingerprints} from './refunds.mjs';
import {PAYMENT_REQUEST_SCHEMA, compilePaymentProposal, paymentDocument, requestRows,
  paymentRequestSummary, paymentRequestHtml, paymentReturnInput, validatePaymentVerification,
  requestTransactionFingerprints, timestamp} from './payment-requests.mjs';

const clone = value => structuredClone(value);
const HEX = /^[a-f0-9]{64}$/;
const PROOF_NAME = 'transfer-proof.json';
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
function retainedVerification(verification, artifact) {
  const original = verification.proof, proof = {};
  for (const key of ['rpcEndpoint', 'networkResultSha256', 'transactionResultSha256', 'operationIndex',
    'operationType', 'payer', 'recipient', 'asset', 'amountAtomic', 'memo', 'envelopeHash',
    'innerTransactionHash', 'transactionHashes', 'transactionFingerprints', 'envelopeXdrSha256', 'resultXdrSha256'])
    if (Object.hasOwn(original, key)) proof[key] = clone(original[key]);
  proof.networkResponse = original.networkResponse == null ? null :
    {passphrase: original.networkResponse.passphrase ?? null};
  proof.transactionResponse = original.transactionResponse == null ? null :
    Object.fromEntries(['status', 'txHash', 'ledger', 'createdAt'].map(key => [key, original.transactionResponse[key] ?? null]));
  return {...clone(verification), proof, proofArtifact: clone(artifact)};
}
function page(query = {}) {
  const offset = Number(query.offset ?? 0), limit = Number(query.limit ?? 100);
  need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 500,
    'INVALID_PAYMENT_REQUEST_PAGE', 'Use a nonnegative offset and a page size from one to 500.');
  return {offset, limit};
}
function sameTransfer(source, network, fingerprints) {
  return source?.network === network && requestTransactionFingerprints(source).some(item => fingerprints.has(item));
}
function requireUniqueTransfer(data, request, returned, fingerprints) {
  need(!data.receipts.some(row => sameTransfer(row.source, request.proposal.network, fingerprints)),
    'STELLAR_PAYMENT_ALREADY_RECORDED', 'This original Stellar transaction already has a payment receipt. Open that receipt instead of importing it again.', 409);
  need(!refundRows(data).some(row => row.proposal.payout.network === request.proposal.network &&
    refundTransferFingerprints(row).some(value => fingerprints.has(value))), 'STELLAR_PAYMENT_ASSIGNED_AS_REFUND',
  'This original transaction already belongs to a customer refund. Recover that refund record.', 409);
  for (const row of requestRows(data)) for (const item of row.returns ?? []) {
    if (row.id === request.id && item.id === returned.id) continue;
    if (row.proposal.network !== request.proposal.network) continue;
    // A reported hash is evidence to check, not a reservation of someone else's transfer.
    // Retain wrong-request and unsuccessful reports while allowing the correct request to receive it.
    const accepted = (item.observations ?? []).filter(observation =>
      observation.status === 'RECORDED' || observation.status === 'TESTNET_VERIFIED');
    if (!item.receiptId && !accepted.length) continue;
    const aliases = new Set([sha(item.transaction), ...accepted.flatMap(observation =>
      requestTransactionFingerprints(observation.verification))]);
    need(![...aliases].some(value => fingerprints.has(value)), 'STELLAR_PAYMENT_REFERENCE_ALREADY_ASSIGNED',
      'This transaction already has a verified receiving result on another saved reference. Open that original reference.', 409);
  }
}
function allocationCapacity(invoice, data, allocatedDate) {
  if (invoice.status !== 'ISSUED' || invoice.voidDate) return 0n;
  const dates = new Set([allocatedDate]);
  for (const row of data.allocations) if (row.invoiceId === invoice.id) {
    if (row.allocatedDate >= allocatedDate) dates.add(row.allocatedDate);
    if (row.releasedDate && row.releasedDate >= allocatedDate) dates.add(row.releasedDate);
  }
  for (const row of data.credits) if (row.invoiceId === invoice.id && row.document.creditDate >= allocatedDate)
    dates.add(row.document.creditDate);
  let available = null;
  for (const date of dates) {
    const amount = minor(invoiceSummary(invoice, data, date).amountDue, invoice.document.currency);
    if (available === null || amount < available) available = amount;
  }
  return available ?? 0n;
}
function receiptPlan(data, invoice, request, returned, verification, input, actor, recordedAt) {
  const proposal = request.proposal, currency = proposal.invoice.currency;
  need(invoice.document && invoice.files?.['invoice.json']?.sha256 === proposal.invoice.sha256 &&
    sha(json(invoice.document)) === proposal.invoice.sha256 &&
    currencyKey(invoice.document.currency) === currencyKey(currency) &&
    invoice.document.customer.id === request.customerId,
  'PAYMENT_REQUEST_INVOICE_CHANGED', 'The receiving request must remain attached to its original issued invoice.', 409);
  const amountUnits = minor(proposal.invoiceAmount, currency, 'invoice payment valuation', {positive: true});
  const receivedDate = dateValue(verification.closedAt.slice(0, 10), 'ledger received date');
  const allocatedDate = dateValue(input.allocatedDate ?? [today(), receivedDate, invoice.document.issueDate].sort().at(-1),
    'allocation date');
  need(allocatedDate >= receivedDate && allocatedDate >= invoice.document.issueDate, 'INVALID_ALLOCATION_DATE',
    'Allocate on or after both the invoice date and the ledger received date.');
  need(input.allocate === undefined || typeof input.allocate === 'boolean', 'INVALID_PAYMENT_ALLOCATION',
    'Choose whether to allocate this receipt to the invoice.');
  need(input.allocate !== false || input.allocationAmount === undefined, 'INVALID_PAYMENT_ALLOCATION',
    'Choose an allocation amount only when applying the receipt to the invoice.');
  const capacity = allocationCapacity(invoice, data, allocatedDate);
  const allocatedUnits = input.allocate === false ? 0n : input.allocationAmount === undefined ?
    (amountUnits < capacity ? amountUnits : capacity) :
    minor(input.allocationAmount, currency, 'invoice allocation', {positive: true});
  need(allocatedUnits <= amountUnits && allocatedUnits <= capacity, 'ALLOCATION_EXCEEDS_BALANCE',
    'The allocation must fit the received amount and every retained invoice balance from the selected date.', 409);
  const sourceKey = sha(json({kind: 'ORIGINAL_STELLAR_SETTLEMENT', network: proposal.network,
    transactionFingerprint: verification.transactionFingerprint}));
  const receiptId = randomUUID(), allocationId = allocatedUnits > 0n ? randomUUID() : null;
  const source = {kind: 'ORIGINAL_STELLAR_INVOICE_TRANSFER', paymentRequestId: request.id,
    paymentReturnId: returned.id, invoiceId: invoice.id, invoiceSha256: proposal.invoice.sha256,
    paymentRequestSha256: request.documentSha256, network: proposal.network,
    transaction: returned.transaction, transactionFingerprint: verification.transactionFingerprint,
    transactionFingerprints: verification.transactionFingerprints, asset: clone(proposal.asset),
    amountAtomic: proposal.amountAtomic, recipient: proposal.destination, payer: verification.payer,
    memo: clone(proposal.memo), ledger: verification.ledger, closedAt: verification.closedAt,
    verificationScope: verification.verificationScope, valuationNote: proposal.valuationNote,
    invoiceAmount: proposal.invoiceAmount, verificationSha256: sha(json(verification)), proof: clone(verification.proof)};
  const receipt = {id: receiptId, customerId: request.customerId, customer: clone(invoice.document.customer),
    currency: clone(currency), amount: money(amountUnits, currency), receivedDate,
    method: 'Stellar invoice payment', reference: invoice.number + ' / ' + returned.transaction,
    note: field(input.note ?? returned.note ?? '', 'internal payment note', 4000, true),
    sourceKey, source, createdAt: recordedAt, actor, status: 'RECORDED',
    history: [{at: recordedAt, actor, action: 'original_invoice_transfer_imported',
      paymentRequestId: request.id, paymentReturnId: returned.id}]};
  const allocation = allocationId ? {id: allocationId, invoiceId: invoice.id, receiptId,
    customerId: request.customerId, currency: clone(currency), amount: money(allocatedUnits, currency),
    minorAmount: allocatedUnits.toString(), allocatedDate, releasedDate: null, createdAt: recordedAt, actor,
    history: [{at: recordedAt, actor, action: 'allocated', allocatedDate}]} : null;
  if (allocation) receipt.history.push({at: recordedAt, actor, action: 'allocated', invoiceId: invoice.id,
    allocationId, amount: allocation.amount, allocatedDate});
  return {receipt, allocation};
}
function immutableRequest(row) {
  need(row.schema === PAYMENT_REQUEST_SCHEMA && HEX.test(row.documentSha256 ?? '') &&
    sha(json(paymentDocument(row))) === row.documentSha256,
  'PAYMENT_REQUEST_DOCUMENT_CHANGED', 'The saved payment-request document differs from its issued version.', 409);
}

export class PaymentRequestsWorkspace {
  constructor(receivables, {verifyTransfer} = {}) {
    this.receivables = receivables;
    this.workspace = receivables.workspace;
    this.verifyTransfer = verifyTransfer;
  }
  data() { return this.receivables.data(); }
  async _retainProof(verification, observationId) {
    const directoryId = identifier(observationId, 'transfer observation');
    const root = join(this.workspace.directory, 'exports'), directory = join(root, directoryId);
    const parent = await lstat(root);
    need(parent.isDirectory() && !parent.isSymbolicLink(), 'PAYMENT_PROOF_DIRECTORY_CHANGED',
      'The original accounting export directory changed.', 409);
    const bytes = Buffer.from(json(verification));
    const artifact = {directoryId, name: PROOF_NAME, bytes: bytes.length, sha256: sha(bytes)};
    await mkdir(directory, {mode: 0o700});
    const handle = await open(join(directory, PROOF_NAME),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(directory); await syncDirectory(root);
    return artifact;
  }
  async _proof(observation) {
    const metadata = observation.verification.proofArtifact;
    // Saved records from the first source revision retain their original inline proof.
    if (!metadata) return clone(observation.verification);
    identifier(metadata.directoryId, 'transfer observation');
    need(metadata.name === PROOF_NAME && HEX.test(metadata.sha256 ?? '') &&
      Number.isSafeInteger(metadata.bytes) && metadata.bytes > 0 && metadata.bytes <= 128_000_000,
    'INVALID_PAYMENT_PROOF_REFERENCE', 'The saved native transfer proof reference is invalid.', 409);
    const directory = join(this.workspace.directory, 'exports', metadata.directoryId), stat = await lstat(directory);
    need(stat.isDirectory() && !stat.isSymbolicLink(), 'PAYMENT_PROOF_DIRECTORY_CHANGED',
      'The retained native transfer proof directory changed.', 409);
    const handle = await open(join(directory, PROOF_NAME), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes;
    try {
      const file = await handle.stat();
      need(file.isFile() && file.size === metadata.bytes, 'PAYMENT_PROOF_FILE_CHANGED',
        'The native transfer proof size differs from its original record.', 409);
      bytes = await handle.readFile();
    } finally { await handle.close(); }
    need(bytes.length === metadata.bytes && sha(bytes) === metadata.sha256, 'PAYMENT_PROOF_FILE_CHANGED',
      'The native transfer proof differs from its original bytes.', 409);
    let verification;
    try { verification = JSON.parse(bytes.toString('utf8')); }
    catch { need(false, 'INVALID_PAYMENT_PROOF_JSON', 'The retained native transfer proof is not valid JSON.', 409); }
    need(verification.network === observation.verification.network &&
      verification.transaction === observation.verification.transaction &&
      verification.status === observation.verification.status, 'PAYMENT_PROOF_IDENTITY_CHANGED',
    'The native transfer proof belongs to a different saved observation.', 409);
    return verification;
  }
  async _fullReturn(returned) {
    const result = clone(returned);
    for (const observation of result.observations) observation.verification = await this._proof(observation);
    return result;
  }
  _request(id) {
    identifier(id, 'payment request');
    const row = requestRows(this.data()).find(item => item.id === id);
    need(row, 'PAYMENT_REQUEST_NOT_FOUND', 'Choose a saved invoice payment request.', 404);
    immutableRequest(row);
    return row;
  }
  _return(row, id) {
    identifier(id, 'returned payment');
    const returned = row.returns.find(item => item.id === id);
    need(returned, 'PAYMENT_RETURN_NOT_FOUND', 'Choose a transaction reported for this payment request.', 404);
    return returned;
  }
  summaries(data = this.data(), asOf = today()) {
    return requestRows(data).map(row => paymentRequestSummary(row, data, asOf));
  }
  summary(id, data = this.data(), asOf = today()) {
    const row = requestRows(data).find(item => item.id === id);
    need(row, 'PAYMENT_REQUEST_NOT_FOUND', 'Choose a saved invoice payment request.', 404);
    return paymentRequestSummary(row, data, asOf);
  }
  async preview(invoiceId, input) {
    identifier(invoiceId, 'invoice');
    return this.workspace.serial(async () => {
      const invoice = this.receivables._invoice(invoiceId), data = this.data();
      await this.receivables._file(invoiceId, 'invoice.json');
      const proposal = compilePaymentProposal(invoice, data, input);
      return {proposal, reviewSha256: sha(json(proposal)), invoice: invoiceSummary(invoice, data),
        revision: this.workspace.state.revision};
    });
  }
  async create(invoiceId, input) {
    identifier(invoiceId, 'invoice');
    return this.receivables._mutate('payment_request_issued', {...input, invoiceId}, async (data, actor) => {
      need(plain(input.proposal) && input.proposal.invoice?.id === invoiceId &&
        typeof input.reviewSha256 === 'string' && HEX.test(input.reviewSha256) &&
        sha(json(input.proposal)) === input.reviewSha256,
      'PAYMENT_REQUEST_REVIEW_REQUIRED', 'Issue the exact proposal returned by the payment-request preview.', 409);
      const invoice = this.receivables._invoice(invoiceId), issuedAt = timestamp();
      const proposal = compilePaymentProposal(invoice, data, input.proposal, {now: issuedAt, id: input.proposal.id});
      need(sha(json(proposal)) === input.reviewSha256, 'PAYMENT_REQUEST_REVIEW_CHANGED',
        'The invoice balance or selected payment terms changed. Review the current payment request.', 409);
      need(!requestRows(data).some(row => row.id === proposal.id), 'PAYMENT_REQUEST_EXISTS',
        'This payment request already has an issued record. Recover its original operation.', 409);
      await this.receivables._file(invoiceId, 'invoice.json');
      const row = {schema: PAYMENT_REQUEST_SCHEMA, id: proposal.id, invoiceId,
        customerId: proposal.invoice.customer.id, issuedAt, actor, proposal,
        reviewSha256: input.reviewSha256, returns: [], cancelledAt: null,
        history: [{at: issuedAt, actor, action: 'issued', invoiceSha256: proposal.invoice.sha256,
          invoiceAmount: proposal.invoiceAmount}]};
      row.documentSha256 = sha(json(paymentDocument(row)));
      data.paymentRequests ??= [];
      data.paymentRequests.unshift(row);
      invoice.history.push({at: issuedAt, actor, action: 'payment_request_issued', paymentRequestId: row.id,
        invoiceAmount: proposal.invoiceAmount, network: proposal.network});
      invoice.version++; invoice.updatedAt = issuedAt;
      return {invoiceId, paymentRequestId: row.id};
    });
  }
  async list(query = {}) {
    return this.workspace.serial(async () => {
      const data = this.data(), {offset, limit} = page(query);
      if (query.invoiceId) this.receivables._invoice(query.invoiceId);
      if (query.customerId) this.receivables._customer(query.customerId);
      const rows = requestRows(data).filter(row => (!query.invoiceId || row.invoiceId === query.invoiceId) &&
        (!query.customerId || row.customerId === query.customerId));
      const summaries = rows.map(row => paymentRequestSummary(row, data, query.asOf ?? today()));
      const matching = query.status ? summaries.filter(row => row.status === query.status) : summaries;
      return {items: matching.slice(offset, offset + limit),
        total: matching.length, offset, limit, revision: this.workspace.state.revision};
    });
  }
  _detail(id, query = {}) {
    const row = this._request(id), data = this.data(), asOf = query.asOf ?? today();
    const receiptIds = new Set(row.returns.map(item => item.receiptId).filter(Boolean));
    return clone({paymentRequest: paymentRequestSummary(row, data, asOf), proposal: row.proposal,
      issuedAt: row.issuedAt, reviewSha256: row.reviewSha256, documentSha256: row.documentSha256,
      returns: row.returns, receipts: data.receipts.filter(item => receiptIds.has(item.id))
        .map(item => receiptSummary(item, data, asOf)),
      allocations: data.allocations.filter(item => receiptIds.has(item.receiptId)),
      cancelledAt: row.cancelledAt, cancellationReason: row.cancellationReason ?? null,
      history: row.history, revision: this.workspace.state.revision});
  }
  async detail(id, query = {}) { return this.workspace.serial(async () => this._detail(id, query)); }
  async cancel(id, input) {
    return this.receivables._mutate('payment_request_cancelled', {...input, paymentRequestId: id}, async (data, actor) => {
      const row = this._request(id);
      need(!row.cancelledAt, 'PAYMENT_REQUEST_ALREADY_CANCELLED', 'This payment request already has a retained cancellation.', 409);
      const reason = field(input.reason, 'cancellation reason', 3000), cancelledAt = timestamp();
      const invoice = this.receivables._invoice(row.invoiceId);
      row.cancelledAt = cancelledAt; row.cancelledBy = actor; row.cancellationReason = reason;
      row.history.push({at: cancelledAt, actor, action: 'cancelled', reason});
      invoice.history.push({at: cancelledAt, actor, action: 'payment_request_cancelled', paymentRequestId: id, reason});
      invoice.version++; invoice.updatedAt = cancelledAt;
      return {invoiceId: row.invoiceId, paymentRequestId: id};
    });
  }
  async reportReturn(id, input) {
    return this.receivables._mutate('payment_return_reported', {...input, paymentRequestId: id}, async (data, actor) => {
      const row = this._request(id), selected = paymentReturnInput(input);
      const existing = row.returns.find(item => item.transaction === selected.transaction);
      if (existing) {
        // Omitting payer is a replay/reselection of the existing reference. Explicit null
        // clears an unverified sender constraint so the original envelope can determine it.
        if (Object.hasOwn(input, 'payer') && (existing.payer ?? null) !== selected.payer) {
          need(!existing.receiptId && !(existing.observations ?? []).some(observation =>
            observation.verification?.status === 'VERIFIED'), 'PAYMENT_RETURN_PAYER_LOCKED',
          'The sending account cannot change after this reference has a verified transfer. Open its original receiving result.', 409);
          const correctionNote = field(input.note, 'payer correction note', 4000);
          const previousPayer = existing.payer ?? null, correctedAt = timestamp();
          existing.payer = selected.payer;
          row.history.push({at: correctedAt, actor, action: 'transaction_payer_corrected',
            paymentReturnId: existing.id, transaction: existing.transaction,
            previousPayer, payer: selected.payer, note: correctionNote});
        }
        return {invoiceId: row.invoiceId, paymentRequestId: id, paymentReturnId: existing.id,
          ...(existing.receiptId ? {receiptId: existing.receiptId} : {}),
          ...(existing.allocationId ? {allocationId: existing.allocationId} : {})};
      }
      const returned = {id: randomUUID(), ...selected, reportedAt: timestamp(), actor,
        observations: [], receiptId: null, allocationId: null};
      requireUniqueTransfer(data, row, returned, new Set([sha(selected.transaction)]));
      row.returns.push(returned);
      row.history.push({at: returned.reportedAt, actor, action: 'transaction_reported',
        paymentReturnId: returned.id, transaction: returned.transaction});
      return {invoiceId: row.invoiceId, paymentRequestId: id, paymentReturnId: returned.id};
    });
  }
  async receive(id, input) {
    return this.receivables._mutate('invoice_payment_received', {...input, paymentRequestId: id}, async (data, actor) => {
      const row = this._request(id), returned = this._return(row, input.returnId);
      if (returned.receiptId) return {invoiceId: row.invoiceId, paymentRequestId: id,
        paymentReturnId: returned.id, receiptId: returned.receiptId,
        ...(returned.allocationId ? {allocationId: returned.allocationId} : {})};
      const prior = returned.observations.at(-1);
      if (prior?.status === 'TESTNET_VERIFIED' || prior?.status?.startsWith('TRANSFER_'))
        return {invoiceId: row.invoiceId, paymentRequestId: id, paymentReturnId: returned.id};
      need(typeof this.verifyTransfer === 'function', 'NATIVE_INVOICE_VERIFIER_REQUIRED',
        'Connect the original native invoice transfer verifier before receiving this transaction.', 503);
      const verification = validatePaymentVerification(row.proposal, returned,
        await this.verifyTransfer({request: clone(row.proposal), returned: clone(returned)}));
      const recordedAt = timestamp();
      let status = verification.status;
      if (status === 'FAILED' && verification.proof.transactionResponse?.status !== 'FAILED')
        status = 'VERIFICATION_UNAVAILABLE';
      if (status === 'VERIFIED') {
        // Ledger closeTime has whole-second precision; compare the same time unit.
        const seconds = value => Math.floor(Date.parse(value) / 1000);
        status = seconds(verification.closedAt) < seconds(row.issuedAt) ? 'TRANSFER_PRECEDES_REQUEST' :
          row.proposal.expiresAt && seconds(verification.closedAt) > seconds(row.proposal.expiresAt) ? 'TRANSFER_AFTER_EXPIRY' :
          row.cancelledAt && seconds(verification.closedAt) > seconds(row.cancelledAt) ? 'TRANSFER_AFTER_CANCELLATION' :
          row.proposal.network === 'stellar:testnet' ? 'TESTNET_VERIFIED' : 'RECORDED';
      }
      const observationId = randomUUID();
      let planned = null;
      if (status === 'RECORDED' || status === 'TESTNET_VERIFIED')
        requireUniqueTransfer(data, row, returned, new Set(verification.transactionFingerprints));
      if (status === 'RECORDED') {
        const invoice = this.receivables._invoice(row.invoiceId);
        await this.receivables._file(row.invoiceId, 'invoice.json');
        planned = receiptPlan(data, invoice, row, returned, verification, input, actor, recordedAt);
      }
      const artifact = await this._retainProof(verification, observationId);
      const compact = retainedVerification(verification, artifact);
      const observation = {id: observationId, recordedAt, actor, status, verification: compact};
      if (planned) {
        planned.receipt.source.proof = clone(compact.proof);
        planned.receipt.source.proofArtifact = clone(artifact);
      }
      // All native matching, document checks and dated conservation precede journal mutation.
      returned.observations.push(observation);
      row.history.push({at: recordedAt, actor, action: 'transaction_observed',
        paymentReturnId: returned.id, transaction: returned.transaction, status});
      if (planned) {
        const {receipt, allocation} = planned, invoice = this.receivables._invoice(row.invoiceId);
        data.receipts.unshift(receipt); returned.receiptId = receipt.id;
        if (allocation) {
          data.allocations.unshift(allocation); returned.allocationId = allocation.id;
          invoice.history.push({at: recordedAt, actor, action: 'payment_allocated',
            paymentRequestId: id, allocationId: allocation.id, receiptId: receipt.id,
            amount: allocation.amount, allocatedDate: allocation.allocatedDate});
        }
        invoice.version++; invoice.updatedAt = recordedAt;
        row.history.push({at: recordedAt, actor, action: 'receipt_recorded', paymentReturnId: returned.id,
          receiptId: receipt.id, allocationId: allocation?.id ?? null, amount: receipt.amount,
          allocatedAmount: allocation?.amount ?? money(0n, receipt.currency)});
      }
      return {invoiceId: row.invoiceId, paymentRequestId: id, paymentReturnId: returned.id,
        ...(planned ? {receiptId: planned.receipt.id} : {}),
        ...(planned?.allocation ? {allocationId: planned.allocation.id} : {})};
    });
  }
  async file(id, name) {
    return this.workspace.serial(async () => {
      const row = this._request(id), data = this.data(), detail = this._detail(id);
      let bytes, type = 'application/json; charset=utf-8';
      if (name === 'payment-request.json') bytes = Buffer.from(json(paymentDocument(row)));
      else if (name === 'payment-request.html') {
        bytes = Buffer.from(paymentRequestHtml(row, data)); type = 'text/html; charset=utf-8';
      } else if (name === 'payment-request.uri') {
        bytes = Buffer.from(row.proposal.uri + '\n'); type = 'text/plain; charset=utf-8';
      } else if (name === 'status.json') {
        bytes = Buffer.from(json({schema: 'stellar-forge.invoice-payment-status.v1',
          revision: detail.revision, paymentRequest: detail.paymentRequest, history: detail.history}));
      } else if (name === 'receiving.json') {
        const completeReturns = [];
        for (const returned of detail.returns) completeReturns.push(await this._fullReturn(returned));
        bytes = Buffer.from(json({schema: 'stellar-forge.invoice-payment-receiving.v1',
          originalRequest: paymentDocument(row), originalRequestSha256: row.documentSha256, ...detail,
          returns: completeReturns}));
      } else if (typeof name === 'string' && /^proof-[a-f0-9-]{36}\.json$/.test(name)) {
        const returned = await this._fullReturn(this._return(row, name.slice(6, -5)));
        bytes = Buffer.from(json({schema: 'stellar-forge.invoice-payment-proof.v1',
          paymentRequestId: row.id, originalRequestSha256: row.documentSha256,
          originalRequest: paymentDocument(row), returned,
          receipt: detail.receipts.find(item => item.id === returned.receiptId) ?? null,
          allocations: detail.allocations.filter(item => item.receiptId === returned.receiptId)}));
      } else need(false, 'PAYMENT_REQUEST_FILE_NOT_FOUND', 'Choose a retained payment-request or native receiving file.', 404);
      return {bytes, name: row.proposal.invoice.number + '-' + row.id + '-' + name, type};
    });
  }
}
