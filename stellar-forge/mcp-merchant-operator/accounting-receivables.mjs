// MIT. Original receivables and invoice collection under the existing accounting owner.
import {ReceivablesWorkspace, RECEIVABLE_REQUEST_BYTES} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/store.mjs';
import {json, sha, need, field, identifier, dateValue, today, invoiceSummary, receiptSummary,
  agingReport, renderDocumentHtml, renderLinesCsv, renderCustomerTar}
  from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/core.mjs';
import {requestRows}
  from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/payment-requests.mjs';

export {receivablesDefinitions, receivablesFileNames, receivablesFileSelectors}
  from './catalog/accounting-receivables.mjs';

const PREFIX = 'merchant_accounting_receivables_';
const clone = value => structuredClone(value);
const paymentNames = ['payment-request.json', 'payment-request.html', 'payment-request.uri', 'status.json', 'receiving.json'];
const views = new Set(['summary', 'invoices', 'receipts', 'credits', 'allocations', 'aging', 'history']);

function payload(args, ...selectors) {
  const omitted = new Set(['workspace', ...selectors]);
  return Object.fromEntries(Object.entries(args).filter(([key]) => !omitted.has(key)));
}
function paged(rows, args, metadata = {}) {
  const offset = args.offset ?? 0, limit = args.limit ?? 100;
  need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 200,
    'ACCOUNTING_RECEIVABLES_PAGE', 'Use a nonnegative offset and a page size from one to 200.');
  return clone({...metadata, items: rows.slice(offset, offset + limit), total: rows.length, offset, limit});
}
function matches(row, args) {
  if (args.status && row.status !== args.status && row.paymentStatus !== args.status) return false;
  if (!args.search) return true;
  const query = field(args.search, 'receivables search', 300).toLocaleLowerCase('en-US');
  return ['id', 'number', 'reference', 'customerName', 'method', 'action', 'reason', 'note', 'transaction']
    .some(key => typeof row[key] === 'string' && row[key].toLocaleLowerCase('en-US').includes(query));
}
function header(document) {
  if (!document) return null;
  const {lines, ...rest} = document;
  return {...clone(rest), lineCount: lines?.length ?? 0};
}
function creditBrief(row) {
  const document = row.document;
  return {id: row.id, invoiceId: row.invoiceId, number: row.number, status: 'ISSUED',
    customerId: document.customer.id, customerName: document.customer.name,
    creditDate: document.creditDate, currency: clone(document.currency),
    total: document.totals.total, reason: document.reason, files: clone(row.files)};
}
function returnBrief(row) {
  const {observations, ...result} = row;
  return {...clone(result), observationCount: observations.length,
    lastObservation: clone(observations.at(-1) ?? null)};
}
function fileIdentity(file) {
  return {name: file.name, type: file.type, bytes: file.bytes.length, sha256: sha(file.bytes)};
}
function previewFiles(document) {
  return [
    {name: 'preview.json', type: 'application/json; charset=utf-8', bytes: Buffer.from(json(document))},
    {name: 'preview.csv', type: 'text/csv; charset=utf-8', bytes: Buffer.from(renderLinesCsv(document))},
    {name: 'preview.html', type: 'text/html; charset=utf-8', bytes: Buffer.from(renderDocumentHtml(document))}
  ];
}
function fileSelection(kind, selectors, file) { return {kind, ...selectors, file}; }

/** The host owns admission, draining, maintenance and the directory lease. */
export class MerchantReceivables {
  constructor(workspace, {readSource} = {}) {
    this.workspace = workspace;
    this.controller = new ReceivablesWorkspace(workspace);
    this.readSource = readSource;
  }
  async init() { await this.controller.init(); return this; }

  async status(args) {
    return this.workspace.serial(async () => {
      const data = this.controller.data(), asOf = dateValue(args.asOf ?? today(), 'account date');
      const view = args.view ?? 'summary';
      need(views.has(view), 'ACCOUNTING_RECEIVABLES_VIEW', 'Choose an original receivables inventory view.');
      if (args.customerId) this.controller._customer(args.customerId);
      const customers = this.workspace.state.customerStatements.customers;
      const invoices = data.invoices.filter(row => !args.customerId || row.draft.customerId === args.customerId);
      const receipts = data.receipts.filter(row => !args.customerId || row.customerId === args.customerId);
      const credits = data.credits.filter(row => !args.customerId || row.document.customer.id === args.customerId);
      const allocations = data.allocations.filter(row => !args.customerId || row.customerId === args.customerId);
      const payments = requestRows(data).filter(row => !args.customerId || row.customerId === args.customerId);
      const invoiceIds = new Set(invoices.map(row => row.id)), receiptIds = new Set(receipts.map(row => row.id));
      const paymentIds = new Set(payments.map(row => row.id));
      const refunds = (data.refunds || []).filter(row => !args.customerId || row.proposal.customer.id === args.customerId);
      const creditDispositions = (data.creditDispositions || []).filter(row => !args.customerId || row.proposal.customer.id === args.customerId);
      const refundIds = new Set(refunds.map(row => row.id));
      const dispositionIds = new Set(creditDispositions.map(row => row.id));
      const history = data.requests.filter(row => !args.customerId ||
        invoiceIds.has(row.result.invoiceId) || receiptIds.has(row.result.receiptId) ||
        paymentIds.has(row.result.paymentRequestId) || refundIds.has(row.result.refundId) ||
        dispositionIds.has(row.result.creditDispositionId) ||
        (row.result.receiptIds || []).some(id => receiptIds.has(id)) ||
        (row.result.invoiceIds || []).some(id => invoiceIds.has(id)));
      const metadata = {workspace: args.workspace, schema: data.schema, view, asOf,
        customerId: args.customerId ?? null, revision: this.workspace.state.revision};
      if (view === 'summary') return clone({...metadata, issuer: data.issuer,
        counts: {customers: args.customerId ? 1 : customers.length, invoices: invoices.length,
          drafts: invoices.filter(row => row.status === 'DRAFT').length,
          issued: invoices.filter(row => row.status === 'ISSUED').length,
          void: invoices.filter(row => row.status === 'VOID').length,
          receipts: receipts.length, credits: credits.length, allocations: allocations.length,
          paymentRequests: payments.length, refunds: refunds.length,
          creditDispositions: creditDispositions.length, operations: history.length}});
      if (view === 'aging') {
        const original = agingReport(data, asOf, args.customerId ?? null);
        return paged(original.invoices.filter(row => matches(row, args)), args,
          {...metadata, currencies: original.currencies,
            totalsScope: {asOf, customerId: args.customerId ?? null}});
      }
      const rows = view === 'invoices' ? invoices.map(row => invoiceSummary(row, data, asOf)) :
        view === 'receipts' ? receipts.map(row => receiptSummary(row, data, asOf)) :
        view === 'credits' ? credits.map(creditBrief) :
        view === 'allocations' ? allocations :
        [...history].reverse();
      return paged(rows.filter(row => matches(row, args)), args, metadata);
    });
  }

  async quoteImport(args) {
    const input = payload(args, 'quoteSource', 'responseSource');
    for (const [sourceKey, contentKey] of [['quoteSource', 'quoteContent'], ['responseSource', 'responseContent']]) {
      if (args[sourceKey] === undefined) continue;
      need(args[contentKey] === undefined, 'ACCOUNTING_RECEIVABLES_SOURCE_SELECTION',
        'Choose either the configured source or its original inline contents for each quotation file.');
      need(typeof this.readSource === 'function', 'ACCOUNTING_RECEIVABLES_SOURCE_UNAVAILABLE',
        'Select a quotation source configured on the original accounting owner.');
      const bytes = await this.readSource(args[sourceKey], RECEIVABLE_REQUEST_BYTES);
      need(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array,
        'ACCOUNTING_RECEIVABLES_SOURCE_BYTES', 'The original quotation source must return its file bytes.');
      need(bytes.byteLength <= RECEIVABLE_REQUEST_BYTES, 'QUOTE_IMPORT_LIMIT',
        'Choose the original quotation file within the native request limit.');
      try { input[contentKey] = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes); }
      catch { need(false, 'ACCOUNTING_RECEIVABLES_SOURCE_ENCODING',
        'The original quotation file must use valid UTF-8.'); }
    }
    return this.controller.importQuote(input);
  }

  async invoicePreview(args) {
    const result = await this.controller.preview(args.invoiceId);
    const metadata = {workspace: args.workspace, invoiceId: args.invoiceId,
      previewSha256: result.previewSha256, expectedVersion: result.expectedVersion, revision: result.revision};
    if (args.view === 'lines') return paged(result.document.lines, args,
      {...metadata, view: 'lines', currency: result.document.currency, totals: result.document.totals});
    need(args.view === undefined || args.view === 'summary', 'ACCOUNTING_RECEIVABLES_VIEW',
      'Choose the invoice preview summary or original line view.');
    return {...metadata, view: 'summary', documentHeader: header(result.document),
      files: previewFiles(result.document).map(file => ({...fileIdentity(file),
        selection: fileSelection('receivables-preview', {invoiceId: args.invoiceId}, file.name)}))};
  }

  async invoiceDetail(args) {
    const result = await this.controller.detail(args.invoiceId, {asOf: args.asOf});
    const view = args.view ?? 'summary';
    const metadata = {workspace: args.workspace, invoiceId: args.invoiceId, invoice: result.invoice,
      view, revision: result.revision};
    if (view === 'summary') return {...metadata, draftHeader: header(result.draft),
      documentHeader: header(result.document), sourceQuote: result.sourceQuote,
      quoteDraftChanged: result.quoteDraftChanged,
      counts: {lines: (result.document ?? result.draft).lines.length, credits: result.credits.length,
        allocations: result.allocations.length, receipts: result.receipts.length, history: result.history.length},
      files: Object.entries(result.files).map(([file, identity]) => ({...identity,
        selection: fileSelection('receivables-document', {documentId: args.invoiceId}, file)})),
      statusFile: result.document ?
        fileSelection('receivables-document', {documentId: args.invoiceId}, 'status.json') : null,
      quoteFiles: result.sourceQuote ? Object.keys(result.sourceQuote.files).map(file =>
        fileSelection('receivables-quote', {invoiceId: args.invoiceId}, file)) : []};
    const rows = view === 'lines' ? (result.document ?? result.draft).lines :
      view === 'credits' ? result.credits.map(creditBrief) :
      view === 'allocations' ? result.allocations :
      view === 'receipts' ? result.receipts :
      view === 'history' ? [...result.history].reverse() : null;
    need(rows !== null, 'ACCOUNTING_RECEIVABLES_VIEW', 'Choose an original invoice detail view.');
    return paged(rows, args, metadata);
  }

  async paymentDetail(args) {
    const result = await this.controller.paymentRequest(args.paymentRequestId, {asOf: args.asOf});
    const view = args.view ?? 'summary';
    const metadata = {workspace: args.workspace, paymentRequestId: args.paymentRequestId,
      paymentRequest: result.paymentRequest, view, revision: result.revision};
    if (view === 'summary') return {...metadata, proposal: result.proposal, issuedAt: result.issuedAt,
      reviewSha256: result.reviewSha256, documentSha256: result.documentSha256,
      cancelledAt: result.cancelledAt, cancellationReason: result.cancellationReason,
      counts: {returns: result.returns.length, observations: result.returns.reduce((sum, row) => sum + row.observations.length, 0),
        receipts: result.receipts.length, allocations: result.allocations.length, history: result.history.length},
      files: paymentNames.map(file =>
        fileSelection('receivables-payment', {paymentRequestId: args.paymentRequestId}, file))};
    let rows = view === 'returns' ? result.returns.map(returnBrief) :
      view === 'receipts' ? result.receipts :
      view === 'allocations' ? result.allocations :
      view === 'history' ? [...result.history].reverse() : null;
    if (view === 'observations') {
      identifier(args.returnId, 'returned payment');
      const returned = result.returns.find(row => row.id === args.returnId);
      need(returned, 'PAYMENT_RETURN_NOT_FOUND', 'Choose a returned transaction for this original payment request.', 404);
      rows = [...returned.observations].reverse();
      Object.assign(metadata, {returnId: returned.id, transaction: returned.transaction,
        proofFile: fileSelection('receivables-payment',
          {paymentRequestId: args.paymentRequestId, returnId: returned.id}, 'proof.json')});
    }
    need(rows !== null, 'ACCOUNTING_RECEIVABLES_VIEW', 'Choose an original payment request detail view.');
    return paged(rows, args, metadata);
  }

  async bankImportDetail(args) {
    const result = await this.controller.bankImport(args.bankImportId, payload(args, 'bankImportId'));
    return {...result, files: result.files.map(file => ({...file,
      selection: fileSelection('receivables-bank', {bankImportId: args.bankImportId}, file.name)}))};
  }

  async requestLookup(args) {
    const requestId = field(args.requestId, 'original request ID', 160);
    need(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(requestId),
      'INVALID_RECEIVABLE_REQUEST_ID', 'Use the original stable request identifier.');
    return this.workspace.serial(async () => {
      const record = this.controller.data().requests.find(row => row.id === requestId);
      if (!record) return {workspace: args.workspace, found: false, requestId,
        revision: this.workspace.state.revision};
      return {workspace: args.workspace, found: true, requestId,
        ...this.controller._result(record.result, args.asOf ?? today()), operation: clone(record)};
    });
  }

  async customerExport(args) {
    const result = await this.controller.exportCustomer(args.customerId, {asOf: args.asOf});
    return {workspace: args.workspace, customerId: args.customerId,
      schema: result.value.schema, asOf: result.value.asOf, customer: result.value.customer,
      currencies: result.value.currencies,
      counts: {invoices: result.value.invoices.length, credits: result.value.credits.length,
        receipts: result.value.receipts.length, allocations: result.value.allocations.length,
        refunds: result.value.refunds?.length ?? 0, creditDispositions: result.value.creditDispositions?.length ?? 0},
      files: result.files.map(file => ({...fileIdentity(file),
        selection: fileSelection('receivables-customer',
          {customerId: args.customerId, asOf: result.value.asOf}, file.name)})),
      packet: fileSelection('receivables-customer',
        {customerId: args.customerId, asOf: result.value.asOf}, 'account.tar'),
      revision: result.revision};
  }

  async call(operation, args) {
    need(typeof operation === 'string' && operation.startsWith(PREFIX),
      'ACCOUNTING_RECEIVABLES_OPERATION', 'Choose an original receivables operation.');
    const selected = operation.slice(PREFIX.length), input = payload(args);
    // Keep original exceptions, including commit uncertainty and reopen fields, intact.
    switch (selected) {
      case 'status': return this.status(args);
      case 'settings': return this.controller.settings(input);
      case 'draft_save': {
        const value = payload(args, 'invoiceId');
        if (args.invoiceId !== undefined) value.id = args.invoiceId;
        return this.controller.saveDraft(value);
      }
      case 'quote_import': return this.quoteImport(args);
      case 'invoice_preview': return this.invoicePreview(args);
      case 'invoice_issue': return this.controller.issue(args.invoiceId, payload(args, 'invoiceId'));
      case 'invoice_detail': return this.invoiceDetail(args);
      case 'invoice_void': return this.controller.voidInvoice(args.invoiceId, payload(args, 'invoiceId'));
      case 'credit': return this.controller.credit(args.invoiceId, payload(args, 'invoiceId'));
      case 'receipt_record': return this.controller.receipt(input);
      case 'receipt_void': return this.controller.voidReceipt(args.receiptId, payload(args, 'receiptId'));
      case 'settlement_ledger': return this.controller.ledger(input);
      case 'settlement_import': return this.controller.importSettlement(input);
      case 'allocate': return this.controller.allocate(input);
      case 'release': return this.controller.release(args.allocationId, payload(args, 'allocationId'));
      case 'customer_export': return this.customerExport(args);
      case 'payment_preview': return this.controller.previewPaymentRequest(args.invoiceId, payload(args, 'invoiceId'));
      case 'payment_create': return this.controller.createPaymentRequest(args.invoiceId, payload(args, 'invoiceId'));
      case 'payment_list': return this.controller.paymentRequests(input);
      case 'payment_detail': return this.paymentDetail(args);
      case 'payment_cancel': return this.controller.cancelPaymentRequest(args.paymentRequestId, payload(args, 'paymentRequestId'));
      case 'payment_return': return this.controller.reportPaymentReturn(args.paymentRequestId, payload(args, 'paymentRequestId'));
      case 'payment_receive': return this.controller.receivePaymentRequest(args.paymentRequestId, payload(args, 'paymentRequestId'));
      case 'customer_funds': return this.controller.customerFunds(input);
      case 'refund_preview': return this.controller.previewRefund(input);
      case 'refund_commit': return this.controller.commitRefund(input);
      case 'refund_list': return this.controller.refunds(input);
      case 'refund_detail': return this.controller.refund(args.refundId, payload(args, 'refundId'));
      case 'refund_cancel': return this.controller.cancelRefund(args.refundId, payload(args, 'refundId'));
      case 'refund_reverse': return this.controller.reverseRefund(args.refundId, payload(args, 'refundId'));
      case 'refund_return': return this.controller.reportRefundReturn(args.refundId, payload(args, 'refundId'));
      case 'refund_receive': return this.controller.receiveRefund(args.refundId, payload(args, 'refundId'));
      case 'credit_disposition_preview': return this.controller.previewCreditDisposition(input);
      case 'credit_disposition_apply': return this.controller.applyCreditDisposition(input);
      case 'bank_accounts': return this.controller.bankAccounts(input);
      case 'bank_account_save': return this.controller.saveBankAccount(input);
      case 'bank_source_inspect': return this.controller.inspectBankSource(input);
      case 'bank_source_import': return this.controller.importBankSource(input);
      case 'bank_import_list': return this.controller.bankImports(input);
      case 'bank_import_detail': return this.bankImportDetail(args);
      case 'bank_posting_preview': return this.controller.previewBankPosting(args.bankImportId, payload(args, 'bankImportId'));
      case 'bank_receipts_post': return this.controller.postBankReceipts(args.bankImportId, payload(args, 'bankImportId'));
      case 'bank_rows_ignore': return this.controller.ignoreBankRows(args.bankImportId, payload(args, 'bankImportId'));
      case 'bank_rows_restore': return this.controller.restoreBankRows(args.bankImportId, payload(args, 'bankImportId'));
      case 'bank_import_close': return this.controller.closeBankImport(args.bankImportId, payload(args, 'bankImportId'));
      case 'request_lookup': return this.requestLookup(args);
      default: need(false, 'ACCOUNTING_RECEIVABLES_OPERATION', 'Choose an original receivables operation.');
    }
  }

  async file(args) {
    if (args.kind === 'receivables-document')
      return this.controller.file(args.documentId, args.file);
    if (args.kind === 'receivables-quote')
      return this.controller.quoteFile(args.invoiceId, args.file);
    if (args.kind === 'receivables-preview') {
      const result = await this.controller.preview(args.invoiceId);
      const file = previewFiles(result.document).find(row => row.name === args.file);
      need(file, 'RECEIVABLE_FILE_NOT_FOUND', 'Choose the original invoice preview JSON, CSV or HTML.', 404);
      return {...file, name: args.invoiceId + '-' + file.name};
    }
    if (args.kind === 'receivables-payment') {
      let name = args.file;
      if (name === 'proof.json') {
        identifier(args.returnId, 'returned payment');
        name = 'proof-' + args.returnId + '.json';
      } else need(args.returnId === undefined, 'ACCOUNTING_RECEIVABLES_FILE_SELECTORS',
        'Select a returned transaction only when reading its native proof.');
      return this.controller.paymentRequestFile(args.paymentRequestId, name);
    }
    if (args.kind === 'receivables-bank')
      return this.controller.bankImportFile(args.bankImportId, args.file);
    if (args.kind === 'receivables-refund')
      return this.controller.refundFile(args.refundId, args.file);
    if (args.kind === 'receivables-customer') {
      const result = await this.controller.exportCustomer(args.customerId, {asOf: args.asOf});
      if (args.file === 'account.tar') return {name: args.customerId + '-' + result.value.asOf + '-account.tar',
        type: 'application/x-tar', bytes: renderCustomerTar(result.files)};
      const file = result.files.find(row => row.name === args.file);
      need(file, 'RECEIVABLE_FILE_NOT_FOUND', 'Choose a file in the original customer account manifest.', 404);
      return file;
    }
    need(false, 'ACCOUNTING_RECEIVABLES_FILE_KIND', 'Choose an original receivables or invoice collection file.', 404);
  }
}
