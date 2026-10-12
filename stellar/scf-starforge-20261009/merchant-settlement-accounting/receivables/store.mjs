// MIT. Invoices and allocations share the original accounting state, revision and lease.
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open, mkdir, lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {CustomerStatementWorkspace} from '../customer-statements/store.mjs';
import {compileQuoteInvoice} from './quote-import.mjs';
import {indexAdjustments, summarizeAdjustments, adjustmentEventKey} from '../adjustments.mjs';
import {RECEIVABLES_SCHEMA, CREDIT_SCHEMA, json, sha, need, plain, field, identifier, dateValue,
  currencyOf, currencyKey, minor, money, today, normalizeIssuer, normalizeDraft, customerSnapshot,
  invoiceDocument, normalizeCredit, invoiceSummary, receiptSummary, agingReport, renderLinesCsv,
  renderDocumentHtml, customerExport} from './core.mjs';

export const RECEIVABLE_REQUEST_BYTES = 2_000_000;
const HEX = /^[a-f0-9]{64}$/;
const at = () => new Date().toISOString();
function parsed(bytes, name) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { need(false, 'INVALID_RECEIVABLE_JSON', 'The retained ' + name + ' is not valid JSON.', 409); }
}
async function readPlain(path, maximum = 32_000_000) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    need(stat.isFile() && stat.size > 0 && stat.size <= maximum, 'RECEIVABLE_FILE_CHANGED', 'The retained file has changed.', 409);
    return await handle.readFile();
  } finally { await handle.close(); }
}
async function verified(path, record, maximum = 32_000_000) {
  const bytes = await readPlain(path, maximum);
  need(sha(bytes) === record.sha256 && (record.bytes === undefined || bytes.length === record.bytes),
    'RECEIVABLE_FILE_CHANGED', 'The retained file differs from its original recorded bytes.', 409);
  return bytes;
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
function requestId(value) {
  const id = field(value, 'request ID', 160);
  need(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id), 'INVALID_RECEIVABLE_REQUEST_ID', 'Use a stable request identifier.');
  return id;
}
function page(value = {}) {
  const offset = Number(value.offset ?? 0), limit = Number(value.limit ?? 100);
  need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit > 0 && limit <= 500,
    'INVALID_RECEIVABLE_PAGE', 'Use a nonnegative offset and a page size from one to 500.');
  return {offset, limit};
}
function eventsWithin(rows, fieldName, id) {
  const events = new Map();
  const add = (date, amount) => events.set(date, (events.get(date) ?? 0n) + amount);
  for (const row of rows) if (row[fieldName] === id) {
    add(row.allocatedDate, BigInt(row.minorAmount));
    if (row.releasedDate) add(row.releasedDate, -BigInt(row.minorAmount));
  }
  let used = 0n, maximum = 0n;
  for (const date of [...events.keys()].sort()) {
    used += events.get(date);
    need(used >= 0n, 'ALLOCATION_HISTORY_INVALID', 'An allocation release precedes its payment allocation.', 409);
    if (used > maximum) maximum = used;
  }
  return maximum;
}
function conserved(data, invoice, receipt) {
  need(eventsWithin(data.allocations, 'receiptId', receipt.id) <= minor(receipt.amount, receipt.currency),
    'RECEIPT_ALREADY_ALLOCATED', 'This payment is already allocated during part of the selected date range.', 409);
  need(eventsWithin(data.allocations, 'invoiceId', invoice.id) <= minor(invoice.document.totals.total, invoice.document.currency),
    'INVOICE_ALREADY_ALLOCATED', 'Existing dated payments already cover this invoice during part of the selected date range.', 409);
}

export class ReceivablesWorkspace {
  constructor(workspace) {
    this.workspace = workspace;
    this.statements = new CustomerStatementWorkspace(workspace);
  }
  async init() {
    await this.statements.init();
    return this.workspace.serial(async () => {
      if (this.workspace.state.receivables === undefined) {
        this.workspace.state.receivables = {schema: RECEIVABLES_SCHEMA, issuer: normalizeIssuer({}),
          invoiceSequence: 0, creditSequence: 0, invoices: [], credits: [], receipts: [], allocations: [], requests: []};
        await this.workspace.commit('receivables_initialized', 'workspace startup');
      }
      const data = this.data();
      need(data.schema === RECEIVABLES_SCHEMA &&
        ['invoices', 'credits', 'receipts', 'allocations', 'requests'].every(key => Array.isArray(data[key])) &&
        Number.isSafeInteger(data.invoiceSequence) && data.invoiceSequence >= 0 &&
        Number.isSafeInteger(data.creditSequence) && data.creditSequence >= 0,
        'INVALID_RECEIVABLES_WORKSPACE', 'The saved receivables workspace is invalid.', 409);
      return this;
    });
  }
  data() { this.workspace.lease.assertHeld(); return this.workspace.state.receivables; }
  _customer(id) {
    identifier(id, 'customer');
    const row = this.workspace.state.customerStatements.customers.find(item => item.id === id);
    need(row, 'CUSTOMER_NOT_FOUND', 'Choose a saved accounting customer.', 404); return row;
  }
  _invoice(id) {
    identifier(id, 'invoice'); const row = this.data().invoices.find(item => item.id === id);
    need(row, 'INVOICE_NOT_FOUND', 'Choose a saved invoice.', 404); return row;
  }
  _receipt(id) {
    identifier(id, 'receipt'); const row = this.data().receipts.find(item => item.id === id);
    need(row, 'RECEIPT_NOT_FOUND', 'Choose a recorded payment.', 404); return row;
  }
  _allocation(id) {
    identifier(id, 'allocation'); const row = this.data().allocations.find(item => item.id === id);
    need(row, 'ALLOCATION_NOT_FOUND', 'Choose an existing payment allocation.', 404); return row;
  }
  _result(record, asOf = today()) {
    const data = this.data(), result = {revision: this.workspace.state.revision};
    if (record.invoiceId) result.invoice = invoiceSummary(this._invoice(record.invoiceId), data, asOf);
    if (record.receiptId) result.receipt = receiptSummary(this._receipt(record.receiptId), data, asOf);
    if (record.creditId) result.credit = structuredClone(data.credits.find(row => row.id === record.creditId));
    if (record.allocationId) result.allocation = structuredClone(this._allocation(record.allocationId));
    if (record.settings) result.issuer = structuredClone(data.issuer);
    return result;
  }
  async _mutate(action, value, work) {
    need(plain(value), 'INVALID_RECEIVABLE_REQUEST', 'Send one JSON operator request.');
    const actor = field(value.actor, 'operator', 1000), id = requestId(value.requestId);
    const intent = structuredClone(value); delete intent.revision;
    const intentSha256 = sha(json({action, value: intent}));
    return this.workspace.serial(async () => {
      const data = this.data(), prior = data.requests.find(row => row.id === id);
      if (prior) {
        need(prior.action === action && prior.intentSha256 === intentSha256, 'RECEIVABLE_REQUEST_REUSED',
          'This request ID belongs to a different operation. Recover the original request or use a new ID.', 409);
        return {...this._result(prior.result), operation: {...structuredClone(prior), replayed: true}};
      }
      this.workspace.expected(value.revision);
      const result = await work(data, actor, id), record = {id, action, actor, at: at(), intentSha256, result};
      data.requests.push(record);
      await this.workspace.commit('receivables_' + action, actor, {requestId: id, ...result});
      return {...this._result(result), operation: {...structuredClone(record), replayed: false}};
    });
  }
  _view(asOf = today()) {
    dateValue(asOf, 'report date'); const data = this.data();
    return structuredClone({schema: RECEIVABLES_SCHEMA, revision: this.workspace.state.revision, asOf,
      issuer: data.issuer, customers: this.workspace.state.customerStatements.customers,
      runs: this.workspace.state.runs.filter(row => row.status === 'complete').map(row => ({
        id: row.id, name: row.name, createdAt: row.createdAt, completedAt: row.completedAt, reportSha256: row.reportSha256})),
      invoices: data.invoices.map(row => invoiceSummary(row, data, asOf)),
      receipts: data.receipts.map(row => receiptSummary(row, data, asOf)),
      credits: data.credits.map(row => ({id: row.id, invoiceId: row.invoiceId, number: row.number,
        creditDate: row.document.creditDate, currency: row.document.currency, total: row.document.totals.total,
        reason: row.document.reason, customerId: row.document.customer.id})),
      allocations: data.allocations, aging: agingReport(data, asOf),
      history: this.workspace.state.history.filter(row => row.action.startsWith('receivables_')).slice(-200).reverse()});
  }
  async state(query = {}) { return this.workspace.serial(async () => this._view(query.asOf ?? today())); }
  async settings(value) {
    return this._mutate('settings_saved', value, async data => {
      data.issuer = normalizeIssuer(value, data.issuer.version + 1); return {settings: true};
    });
  }
  async saveCustomer(value) {
    // Customer identity and editing remain the original statement controller's work.
    const result = await this.statements.saveCustomer(value);
    return {customer: result.customer, revision: this.workspace.state.revision};
  }
  async saveDraft(value) {
    return this._mutate('draft_saved', value, async (data, actor) => {
      const draft = normalizeDraft(value), customer = this._customer(draft.customerId);
      if (draft.replacesId) {
        const replaced = this._invoice(draft.replacesId);
        need(replaced.draft.customerId === draft.customerId && replaced.status !== 'DRAFT',
          'INVALID_REPLACEMENT_INVOICE', 'Link the correction to an issued or void invoice for this customer.', 409);
      }
      let invoice;
      if (value.id) {
        invoice = this._invoice(value.id);
        need(invoice.status === 'DRAFT', 'INVOICE_ALREADY_ISSUED', 'Issued document content is frozen. Use a credit note or a replacement draft.', 409);
        need(!invoice.sourceQuote || invoice.sourceQuote.customerId === draft.customerId, 'QUOTE_CUSTOMER_BINDING_CHANGED',
          'Keep the original quote import with its selected accounting customer. Import it again for a different customer.', 409);
        need(value.expectedVersion === invoice.version, 'STALE_INVOICE', 'Reload the current draft before saving this edit.', 409);
        invoice.history.push({at: at(), actor, action: 'draft_updated', previousVersion: invoice.version,
          previousDraftSha256: sha(json(invoice.draft))});
        Object.assign(invoice, {draft, customerName: customer.name, version: invoice.version + 1, updatedAt: at()});
      } else {
        invoice = {id: randomUUID(), status: 'DRAFT', number: null, version: 1, draft,
          customerName: customer.name, createdAt: at(), updatedAt: at(),
          history: [{at: at(), actor, action: 'draft_created'}]};
        data.invoices.unshift(invoice);
      }
      return {invoiceId: invoice.id};
    });
  }
  async importQuote(value) {
    return this._mutate('quote_imported', value, async (data, actor) => {
      need(typeof value.quoteContent === 'string' &&
        Buffer.byteLength(value.quoteContent, 'utf8') + Buffer.byteLength(value.responseContent ?? '', 'utf8') <= RECEIVABLE_REQUEST_BYTES,
        'QUOTE_IMPORT_LIMIT', 'Choose the original quotation and response files within the request limit.');
      if (value.scope === 'RECURRING') field(value.periodLabel, 'the specific recurring billing period', 300);
      const selected = compileQuoteInvoice(value), customer = this._customer(selected.draft.customerId);
      const sourceKey = sha(json({quoteSha256: selected.source.quote.sha256, customerId: customer.id,
        scope: selected.source.selection.scope,
        ...(selected.source.selection.scope === 'RECURRING' ? {periodCount: selected.source.selection.periodCount,
          periodLabel: selected.source.selection.periodLabel} : {})}));
      need(!data.invoices.some(row => row.quoteImportKey === sourceKey && row.status !== 'VOID'),
        'QUOTE_SCOPE_ALREADY_IMPORTED', 'This quotation scope and billing period already has a draft or issued invoice.', 409);
      const id = randomUUID(), root = join(this.workspace.directory, 'exports'), directoryId = randomUUID(), directory = join(root, directoryId);
      const parent = await lstat(root);
      need(parent.isDirectory() && !parent.isSymbolicLink(), 'RECEIVABLE_EXPORT_DIRECTORY_CHANGED', 'The accounting export directory changed.', 409);
      await mkdir(directory, {mode: 0o700});
      const sourceFiles = {'quote.json': Buffer.from(value.quoteContent, 'utf8'),
        'source.json': Buffer.from(json(selected.source)), 'review.json': Buffer.from(json(selected.review))};
      if (value.responseContent !== undefined && value.responseContent !== null) sourceFiles['response.json'] = Buffer.from(value.responseContent, 'utf8');
      const files = {};
      for (const [name, bytes] of Object.entries(sourceFiles)) {
        files[name] = {bytes: bytes.length, sha256: sha(bytes)};
        const handle = await open(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      }
      await syncDirectory(directory); await syncDirectory(root);
      data.invoices.unshift({id, status: 'DRAFT', number: null, version: 1, draft: selected.draft,
        customerName: customer.name, createdAt: at(), updatedAt: at(), quoteImportKey: sourceKey,
        sourceQuote: {customerId: customer.id, directoryId, files, sourceSha256: selected.source.sha256,
          quoteId: selected.source.quote.id, quoteSha256: selected.source.quote.sha256,
          originalDraftSha256: sha(json(selected.draft)), review: selected.review},
        history: [{at: at(), actor, action: 'quote_imported', quoteId: selected.source.quote.id,
          quoteSha256: selected.source.quote.sha256, sourceSha256: selected.source.sha256,
          scope: selected.source.selection.scope, periodLabel: selected.source.selection.periodLabel}]});
      return {invoiceId: id};
    });
  }
  async quoteFile(id, name) {
    return this.workspace.serial(async () => {
      const invoice = this._invoice(id), source = invoice.sourceQuote;
      need(source && ['quote.json', 'response.json', 'source.json', 'review.json'].includes(name) &&
        Object.hasOwn(source.files, name), 'QUOTE_SOURCE_NOT_FOUND', 'Choose a retained original quotation file.', 404);
      const directory = join(this.workspace.directory, 'exports', identifier(source.directoryId, 'retained quote source'));
      const stat = await lstat(directory);
      need(stat.isDirectory() && !stat.isSymbolicLink(), 'QUOTE_SOURCE_CHANGED', 'The retained quotation directory changed.', 409);
      const bytes = await verified(join(directory, name), source.files[name]);
      return {bytes, name: id + '-' + name, type: 'application/json; charset=utf-8'};
    });
  }
  _preview(id) {
    const invoice = this._invoice(id);
    need(invoice.status === 'DRAFT', 'INVOICE_ALREADY_ISSUED', 'Choose an editable invoice draft.', 409);
    const document = invoiceDocument(invoice, this._customer(invoice.draft.customerId), this.data().issuer);
    return {document, previewSha256: sha(json(document)), expectedVersion: invoice.version, revision: this.workspace.state.revision};
  }
  async preview(id) { return this.workspace.serial(async () => this._preview(id)); }
  async _retain(document) {
    const directoryId = randomUUID(), root = join(this.workspace.directory, 'exports'), directory = join(root, directoryId);
    const parent = await lstat(root);
    need(parent.isDirectory() && !parent.isSymbolicLink(), 'RECEIVABLE_EXPORT_DIRECTORY_CHANGED', 'The accounting export directory has changed.', 409);
    await mkdir(directory, {mode: 0o700});
    const stem = document.kind === 'CREDIT_NOTE' ? 'credit' : 'invoice';
    const files = {[stem + '.json']: Buffer.from(json(document)), [stem + '.csv']: Buffer.from(renderLinesCsv(document)),
      [stem + '.html']: Buffer.from(renderDocumentHtml(document))};
    const metadata = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, {bytes: bytes.length, sha256: sha(bytes)}]));
    files['manifest.json'] = Buffer.from(json({schema: 'stellar-forge.merchant-receivable-files.v1',
      documentId: document.id, number: document.number, documentSchema: document.schema, files: metadata}));
    metadata['manifest.json'] = {bytes: files['manifest.json'].length, sha256: sha(files['manifest.json'])};
    for (const [name, bytes] of Object.entries(files)) {
      const handle = await open(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    }
    await syncDirectory(directory); await syncDirectory(root);
    return {directoryId, files: metadata};
  }
  async issue(id, value) {
    identifier(id, 'invoice');
    return this._mutate('invoice_issued', {...value, invoiceId: id}, async (data, actor) => {
      const invoice = this._invoice(id), preview = this._preview(id);
      need(value.expectedVersion === invoice.version, 'STALE_INVOICE', 'Reload the current draft before issuing.', 409);
      need(typeof value.previewSha256 === 'string' && HEX.test(value.previewSha256) &&
        value.previewSha256 === preview.previewSha256, 'INVOICE_PREVIEW_CHANGED',
        'Review the current invoice preview before issuing its retained document.', 409);
      need(data.issuer.name.length > 0, 'MERCHANT_NAME_REQUIRED', 'Save the merchant name in document settings.');
      need(minor(invoice.draft.totals.total, invoice.draft.currency) > 0n, 'EMPTY_INVOICE', 'The issued invoice total must be positive.');
      const number = data.issuer.invoicePrefix + '-' + invoice.draft.issueDate.slice(0, 4) + '-' + String(data.invoiceSequence + 1).padStart(6, '0');
      need(!data.invoices.some(row => row.number === number), 'INVOICE_NUMBER_EXISTS', 'The next document number is already used.', 409);
      const document = invoiceDocument(invoice, this._customer(invoice.draft.customerId), data.issuer, number, at(), actor);
      const retained = await this._retain(document);
      data.invoiceSequence++;
      Object.assign(invoice, {status: 'ISSUED', number, document, ...retained, issuedAt: document.issuedAt,
        version: invoice.version + 1, updatedAt: at()});
      invoice.history.push({at: at(), actor, action: 'issued', number, previewSha256: preview.previewSha256});
      return {invoiceId: id};
    });
  }
  async voidInvoice(id, value) {
    identifier(id, 'invoice');
    return this._mutate('invoice_voided', {...value, invoiceId: id}, async (data, actor) => {
      const invoice = this._invoice(id), voidDate = dateValue(value.voidDate, 'void date'), reason = field(value.reason, 'void reason', 3000);
      need(invoice.status !== 'VOID', 'INVOICE_ALREADY_VOID', 'This invoice is already void.', 409);
      need(voidDate >= invoice.draft.issueDate, 'INVALID_VOID_DATE', 'The void date must be on or after the invoice date.');
      need(!data.credits.some(row => row.invoiceId === id), 'INVOICE_HAS_CREDITS', 'An invoice with credit notes stays in the issued register.', 409);
      need(data.allocations.filter(row => row.invoiceId === id).every(row => row.releasedDate && row.releasedDate <= voidDate),
        'INVOICE_HAS_PAYMENTS', 'Release the invoice payment allocations before the selected void date.', 409);
      invoice.status = 'VOID'; invoice.voidDate = voidDate; invoice.version++; invoice.updatedAt = at();
      invoice.history.push({at: at(), actor, action: 'voided', voidDate, reason}); return {invoiceId: id};
    });
  }
  async credit(id, value) {
    identifier(id, 'invoice');
    return this._mutate('credit_issued', {...value, invoiceId: id}, async (data, actor) => {
      const invoice = this._invoice(id);
      need(invoice.status === 'ISSUED', 'ISSUED_INVOICE_REQUIRED', 'Choose an issued invoice for this credit.', 409);
      const selected = normalizeCredit(value, invoice, data.credits.filter(row => row.invoiceId === id));
      const number = data.issuer.creditPrefix + '-' + selected.creditDate.slice(0, 4) + '-' + String(data.creditSequence + 1).padStart(6, '0');
      need(!data.credits.some(row => row.number === number), 'CREDIT_NUMBER_EXISTS', 'The next credit number is already used.', 409);
      const document = {schema: CREDIT_SCHEMA, kind: 'CREDIT_NOTE', id: randomUUID(), number, issuedAt: at(), actor,
        invoiceId: id, invoiceNumber: invoice.number, invoiceSha256: invoice.files['invoice.json'].sha256,
        customer: structuredClone(invoice.document.customer), issuer: structuredClone(invoice.document.issuer),
        currency: structuredClone(invoice.document.currency), ...selected};
      const retained = await this._retain(document);
      const credit = {id: document.id, invoiceId: id, number, document, ...retained};
      data.creditSequence++; data.credits.unshift(credit);
      invoice.history.push({at: at(), actor, action: 'credited', creditId: credit.id, number, creditDate: selected.creditDate,
        amount: selected.totals.total, reason: selected.reason});
      invoice.version++; invoice.updatedAt = at();
      return {invoiceId: id, creditId: credit.id};
    });
  }

  async receipt(value) {
    return this._mutate('payment_recorded', value, async (data, actor) => {
      const customer = this._customer(value.customerId), currency = currencyOf(value.currency);
      const amount = money(minor(value.amount, currency, 'payment amount', {positive: true}), currency);
      const receivedDate = dateValue(value.receivedDate, 'received date'), method = field(value.method, 'payment method', 100);
      const reference = field(value.reference, 'payment reference', 300), note = field(value.note ?? '', 'internal payment note', 4000, true);
      const sourceKey = sha(json({kind: 'OPERATOR_RECORDED', method: method.toLowerCase(), reference}));
      need(!data.receipts.some(row => row.sourceKey === sourceKey), 'PAYMENT_REFERENCE_EXISTS',
        'This payment reference is already recorded. Use its existing receipt.', 409);
      const row = {id: randomUUID(), customerId: customer.id, customer: customerSnapshot(customer), currency, amount,
        receivedDate, method, reference, note, sourceKey, source: {kind: 'OPERATOR_RECORDED'},
        createdAt: at(), actor, status: 'RECORDED', history: [{at: at(), actor, action: 'recorded'}]};
      data.receipts.unshift(row); return {receiptId: row.id};
    });
  }
  async _report(runId) {
    const run = this.workspace.runRow(runId);
    need(run.status === 'complete', 'RUN_NOT_COMPLETE', 'Choose a completed original reconciliation.', 409);
    const bytes = await verified(join(this.workspace.runPath(runId), 'report', 'report.json'), {sha256: run.reportSha256}, 128_000_000);
    const report = parsed(bytes, 'accounting report');
    need(report.schema === 'stellar-forge.merchant-reconciliation.v1' && Array.isArray(report.ledger),
      'ORIGINAL_ACCOUNTING_REQUIRED', 'Choose an original merchant accounting report.', 409);
    return {run, report};
  }
  _bound(customerId, row) {
    return this.workspace.state.customerStatements.bindings.some(binding => binding.customerId === customerId &&
      binding.orderReferenceDigest === row.orderReferenceDigest && sha(binding.orderRef) === binding.orderReferenceDigest);
  }
  async ledger(query = {}) {
    return this.workspace.serial(async () => {
      const {offset, limit} = page(query), {run, report} = await this._report(query.runId);
      if (query.customerId) this._customer(query.customerId);
      const adjustments = indexAdjustments(this.workspace.state.adjustments ?? []);
      let rows = report.ledger;
      if (query.customerId) rows = rows.filter(row => this._bound(query.customerId, row));
      const items = rows.slice(offset, offset + limit).map(row => {
        const records = adjustments.get(adjustmentEventKey(row)) ?? [];
        return {...structuredClone(row), recordedAt: row.at,
          eligible: row.network === 'stellar:pubnet' && row.transfer === 'OFFICIAL_TRANSFER_MATCHED' &&
            row.verificationScope === 'OFFICIAL_PUBNET_RPC' && HEX.test(row.transactionFingerprint ?? ''),
          adjustmentSummary: summarizeAdjustments(row, records),
          importedReceiptId: this.data().receipts.find(receipt => receipt.source?.kind === 'ORIGINAL_STELLAR_SETTLEMENT' &&
            receipt.source.network === row.network && receipt.source.transactionFingerprint === row.transactionFingerprint)?.id ?? null};
      });
      return {items, total: rows.length, offset, limit, runId: run.id, reportSha256: run.reportSha256, revision: this.workspace.state.revision};
    });
  }
  async importSettlement(value) {
    return this._mutate('settlement_recorded', value, async (data, actor) => {
      const customer = this._customer(value.customerId), {run, report} = await this._report(value.runId);
      need(typeof value.eventId === 'string' && HEX.test(value.eventId), 'INVALID_SETTLEMENT_EVENT', 'Select the original event identifier.');
      const matches = report.ledger.filter(row => row.eventId === value.eventId);
      need(matches.length === 1, 'AMBIGUOUS_SETTLEMENT_EVENT', 'Select one unique event from the retained report.', 409);
      const event = matches[0];
      need(event.network === 'stellar:pubnet' && event.transfer === 'OFFICIAL_TRANSFER_MATCHED' &&
        event.verificationScope === 'OFFICIAL_PUBNET_RPC' && HEX.test(event.transactionFingerprint ?? '') &&
        HEX.test(event.assetDigest ?? '') && /^(0|[1-9][0-9]*)$/.test(event.amountAtomic ?? '') && BigInt(event.amountAtomic) > 0n,
        'VERIFIED_PUBLIC_PAYMENT_REQUIRED', 'Select a public-network payment with its matching original transfer verification.', 409);
      need(this._bound(customer.id, event), 'CUSTOMER_PAYMENT_BINDING_REQUIRED',
        'Assign this original order to the selected accounting customer before importing its payment.', 409);
      const sourceKey = sha(json({kind: 'ORIGINAL_STELLAR_SETTLEMENT', network: event.network,
        transactionFingerprint: event.transactionFingerprint}));
      need(!data.receipts.some(row => row.sourceKey === sourceKey), 'SETTLEMENT_ALREADY_RECORDED',
        'This original settlement already has a receipt, including imports from another accounting run.', 409);
      const currency = currencyOf(value.currency), amount = money(minor(value.amount, currency, 'receipt valuation', {positive: true}), currency);
      const receivedDate = dateValue(value.receivedDate, 'received date'), valuationNote = field(value.valuationNote, 'receipt valuation basis', 4000);
      const records = indexAdjustments(this.workspace.state.adjustments ?? []).get(adjustmentEventKey(event)) ?? [];
      const source = {kind: 'ORIGINAL_STELLAR_SETTLEMENT', runId: run.id, reportSha256: run.reportSha256,
        eventId: event.eventId, network: event.network, transactionFingerprint: event.transactionFingerprint,
        amountAtomic: event.amountAtomic, assetDigest: event.assetDigest,
        recipientDigest: event.recipientDigest ?? null, termsRecipientDigest: event.termsRecipientDigest ?? null,
        orderReferenceDigest: event.orderReferenceDigest, transferEvidenceDigest: event.transferEvidenceDigest ?? null,
        verificationScope: event.verificationScope, valuationNote, event: structuredClone(event),
        adjustments: structuredClone(records), adjustmentSummary: summarizeAdjustments(event, records)};
      const row = {id: randomUUID(), customerId: customer.id, customer: customerSnapshot(customer), currency, amount,
        receivedDate, method: 'Stellar settlement', reference: field(value.reference ?? event.eventId, 'payment reference', 300),
        note: field(value.note ?? '', 'internal payment note', 4000, true), sourceKey, source,
        createdAt: at(), actor, status: 'RECORDED', history: [{at: at(), actor, action: 'original_settlement_imported'}]};
      data.receipts.unshift(row); return {receiptId: row.id};
    });
  }
  async allocate(value) {
    return this._mutate('payment_allocated', value, async (data, actor) => {
      const invoice = this._invoice(value.invoiceId), receipt = this._receipt(value.receiptId);
      const allocatedDate = dateValue(value.allocatedDate, 'allocation date');
      need(invoice.status === 'ISSUED' && receipt.status === 'RECORDED', 'ALLOCATION_RECORD_CLOSED',
        'Choose an issued invoice and a current payment receipt.', 409);
      need(invoice.document.customer.id === receipt.customerId &&
        currencyKey(invoice.document.currency) === currencyKey(receipt.currency),
        'ALLOCATION_IDENTITY_MISMATCH', 'The invoice and receipt must have the same customer, currency and precision.', 409);
      need(allocatedDate >= invoice.document.issueDate && allocatedDate >= receipt.receivedDate,
        'INVALID_ALLOCATION_DATE', 'Allocate on or after both the invoice and receipt dates.');
      const units = minor(value.amount, receipt.currency, 'allocation amount', {positive: true});
      const invoiceNow = invoiceSummary(invoice, data, allocatedDate), receiptNow = receiptSummary(receipt, data, allocatedDate);
      need(units <= minor(invoiceNow.amountDue, receipt.currency) && units <= minor(receiptNow.available, receipt.currency),
        'ALLOCATION_EXCEEDS_BALANCE', 'Allocate no more than the invoice amount due and the available payment on the selected date.', 409);
      const allocation = {id: randomUUID(), invoiceId: invoice.id, receiptId: receipt.id,
        customerId: receipt.customerId, currency: structuredClone(receipt.currency), amount: money(units, receipt.currency),
        minorAmount: units.toString(), allocatedDate, releasedDate: null, createdAt: at(), actor,
        history: [{at: at(), actor, action: 'allocated', allocatedDate}]};
      data.allocations.unshift(allocation);
      // Check every dated interval, including previously recorded future allocations.
      conserved(data, invoice, receipt);
      invoice.version++; invoice.updatedAt = at();
      invoice.history.push({at: at(), actor, action: 'payment_allocated', allocationId: allocation.id, receiptId: receipt.id,
        amount: allocation.amount, allocatedDate});
      receipt.history.push({at: at(), actor, action: 'allocated', invoiceId: invoice.id, allocationId: allocation.id,
        amount: allocation.amount, allocatedDate});
      return {invoiceId: invoice.id, receiptId: receipt.id, allocationId: allocation.id};
    });
  }
  async release(id, value) {
    identifier(id, 'allocation');
    return this._mutate('allocation_released', {...value, allocationId: id}, async (data, actor) => {
      const allocation = this._allocation(id), invoice = this._invoice(allocation.invoiceId), receipt = this._receipt(allocation.receiptId);
      need(!allocation.releasedDate, 'ALLOCATION_ALREADY_RELEASED', 'This allocation already has a retained release.', 409);
      const releasedDate = dateValue(value.releasedDate, 'release date'), reason = field(value.reason, 'release reason', 3000);
      need(releasedDate >= allocation.allocatedDate, 'INVALID_RELEASE_DATE', 'The release date must be on or after allocation.');
      if (invoice.voidDate) need(releasedDate <= invoice.voidDate, 'RELEASE_AFTER_VOID', 'A void invoice cannot receive a later allocation change.', 409);
      if (receipt.voidDate) need(releasedDate <= receipt.voidDate, 'RELEASE_AFTER_VOID', 'A void receipt cannot receive a later allocation change.', 409);
      allocation.releasedDate = releasedDate; allocation.reason = reason; allocation.releasedBy = actor;
      allocation.history.push({at: at(), actor, action: 'released', releasedDate, reason});
      conserved(data, invoice, receipt);
      invoice.version++; invoice.updatedAt = at();
      invoice.history.push({at: at(), actor, action: 'allocation_released', allocationId: id, releasedDate, reason});
      receipt.history.push({at: at(), actor, action: 'allocation_released', allocationId: id, releasedDate, reason});
      return {invoiceId: invoice.id, receiptId: receipt.id, allocationId: id};
    });
  }
  async voidReceipt(id, value) {
    identifier(id, 'receipt');
    return this._mutate('payment_voided', {...value, receiptId: id}, async (data, actor) => {
      const receipt = this._receipt(id), voidDate = dateValue(value.voidDate, 'void date'), reason = field(value.reason, 'void reason', 3000);
      need(receipt.status === 'RECORDED', 'RECEIPT_ALREADY_VOID', 'This receipt is already void.', 409);
      need(voidDate >= receipt.receivedDate, 'INVALID_VOID_DATE', 'The void date must be on or after the received date.');
      need(data.allocations.filter(row => row.receiptId === id).every(row => row.releasedDate && row.releasedDate <= voidDate),
        'RECEIPT_HAS_ALLOCATIONS', 'Release this receipt’s allocations before the selected void date.', 409);
      receipt.status = 'VOID'; receipt.voidDate = voidDate;
      receipt.history.push({at: at(), actor, action: 'voided', voidDate, reason}); return {receiptId: id};
    });
  }
  async _file(id, requestedName) {
    identifier(id, 'document');
    const data = this.data(), record = data.invoices.find(row => row.id === id) ?? data.credits.find(row => row.id === id);
    need(record?.document && record.files, 'ISSUED_DOCUMENT_REQUIRED', 'Choose an issued invoice or credit note.', 404);
    const name = record.document.kind === 'CREDIT_NOTE' && /^invoice\.(json|csv|html)$/.test(requestedName) ?
      requestedName.replace(/^invoice\./, 'credit.') : requestedName;
    if (name === 'status.json') {
      const status = record.document.kind === 'CREDIT_NOTE' ?
        {id: record.id, number: record.number, kind: 'CREDIT_NOTE', invoiceId: record.invoiceId, status: 'ISSUED'} :
        invoiceSummary(record, data, today());
      return {bytes: Buffer.from(json({schema: 'stellar-forge.merchant-receivable-status.v1',
        observedAt: at(), revision: this.workspace.state.revision, status, history: record.history ?? []})),
        name: record.number + '-status.json', type: 'application/json; charset=utf-8'};
    }
    need(typeof name === 'string' && Object.hasOwn(record.files, name), 'RECEIVABLE_FILE_NOT_FOUND', 'Choose a retained document file.', 404);
    const directory = join(this.workspace.directory, 'exports', identifier(record.directoryId, 'retained export'));
    const stat = await lstat(directory);
    need(stat.isDirectory() && !stat.isSymbolicLink(), 'RECEIVABLE_EXPORT_DIRECTORY_CHANGED', 'The retained document directory changed.', 409);
    const bytes = await verified(join(directory, name), record.files[name]);
    return {bytes, name: record.number + '-' + name,
      type: name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8'};
  }
  async file(id, name) { return this.workspace.serial(async () => this._file(id, name)); }
  async detail(id, query = {}) {
    return this.workspace.serial(async () => {
      const invoice = this._invoice(id), data = this.data(), asOf = query.asOf ?? today();
      let document = null;
      if (invoice.document) document = parsed((await this._file(id, 'invoice.json')).bytes, 'issued invoice');
      const linked = data.allocations.filter(row => row.invoiceId === id), receiptIds = new Set(linked.map(row => row.receiptId));
      return structuredClone({invoice: invoiceSummary(invoice, data, asOf), draft: invoice.draft, document,
        credits: data.credits.filter(row => row.invoiceId === id), allocations: linked,
        receipts: data.receipts.filter(row => receiptIds.has(row.id)).map(row => receiptSummary(row, data, asOf)),
        files: invoice.files ?? {}, sourceQuote: invoice.sourceQuote ?? null,
        quoteDraftChanged: invoice.sourceQuote ? sha(json(invoice.draft)) !== invoice.sourceQuote.originalDraftSha256 : false,
        history: invoice.history, revision: this.workspace.state.revision});
    });
  }
  async exportCustomer(customerId, query = {}) {
    return this.workspace.serial(async () => {
      const result = customerExport(this.data(), this._customer(customerId), query.asOf ?? today());
      const documents = [...result.value.invoices.map(row => row.id), ...result.value.credits.map(row => row.id)];
      let totalBytes = result.files.reduce((total, file) => total + file.bytes.length, 0);
      for (const id of documents) {
        const record = this.data().invoices.find(row => row.id === id) ?? this.data().credits.find(row => row.id === id);
        for (const name of Object.keys(record.files)) {
          const file = await this._file(id, name);
          totalBytes += file.bytes.length;
          need(totalBytes <= 128_000_000, 'CUSTOMER_EXPORT_LIMIT', 'This customer export exceeds 128 MB. Select an earlier account date or individual documents.');
          result.files.push({...file, name: 'documents/' + file.name});
        }
      }
      const files = Object.fromEntries(result.files.map(file => [file.name, {bytes: file.bytes.length, sha256: sha(file.bytes)}]));
      result.files.push({name: 'manifest.json', type: 'application/json; charset=utf-8',
        bytes: Buffer.from(json({schema: 'stellar-forge.merchant-receivables-customer-files.v1', customerId,
          asOf: result.value.asOf, files}))});
      result.revision = this.workspace.state.revision;
      return result;
    });
  }
}
