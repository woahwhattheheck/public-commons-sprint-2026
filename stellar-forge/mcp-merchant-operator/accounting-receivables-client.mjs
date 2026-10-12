// MIT. Original invoice and collection workflows over one merchant MCP connection.
import {createHash} from 'node:crypto';
import {openMerchantFileClient} from './retained-download.mjs';
import {createAccountingMaintenanceClient} from './accounting-maintenance-client.mjs';

const PREFIX = 'merchant_accounting_receivables_';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const digest = value => createHash('sha256').update(json(value)).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), {code: 'ACCOUNTING_RECEIVABLES_CLIENT_' + code});
function need(ok, message, code = 'ARGUMENTS') { if (!ok) throw fail(code, message); }
function identifier(value, expression, name) {
  need(typeof value === 'string' && expression.test(value), 'Supply the exact ' + name + '.'); return value;
}
function version(value, name = 'workspace revision') {
  need(Number.isSafeInteger(value) && value >= 1, 'Use the current original ' + name + '.'); return value;
}
function wire(value = {}) {
  need(plain(value) && !Object.hasOwn(value, 'workspace'), 'Use this client’s configured workspace and one JSON argument object.');
  let result;
  try { result = JSON.parse(JSON.stringify(value)); }
  catch { throw fail('ARGUMENTS', 'Use serializable original JSON arguments.'); }
  need(plain(result), 'Use one original JSON argument object.');
  return result;
}
function operator(value) {
  need(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 1000,
    'Supply the original responsible operator.'); return value;
}
function identity(value) {
  need(plain(value), 'Supply the original operator and stable request ID.');
  return {actor: operator(value.actor), requestId: identifier(value.requestId, REQUEST_ID, 'stable request ID')};
}
export const ACCOUNTING_RECEIVABLES_METHODS = Object.freeze({
  status: 'status', saveSettings: 'settings', saveDraft: 'draft_save', importQuote: 'quote_import',
  invoicePreviewSummary: 'invoice_preview', issueInvoice: 'invoice_issue', invoice: 'invoice_detail',
  voidInvoice: 'invoice_void', issueCredit: 'credit', recordReceipt: 'receipt_record', voidReceipt: 'receipt_void',
  settlementLedger: 'settlement_ledger', importSettlement: 'settlement_import', allocate: 'allocate',
  releaseAllocation: 'release', customerExport: 'customer_export', previewPaymentRequest: 'payment_preview',
  createPaymentRequest: 'payment_create', paymentRequests: 'payment_list', paymentRequest: 'payment_detail',
  cancelPaymentRequest: 'payment_cancel', reportPaymentReturn: 'payment_return',
  receivePaymentRequest: 'payment_receive', lookupOperation: 'request_lookup',
  customerFunds: 'customer_funds', previewRefund: 'refund_preview', commitRefund: 'refund_commit',
  refunds: 'refund_list', refund: 'refund_detail', cancelRefund: 'refund_cancel', reverseRefund: 'refund_reverse',
  reportRefundReturn: 'refund_return', receiveRefund: 'refund_receive',
  previewCreditDisposition: 'credit_disposition_preview', applyCreditDisposition: 'credit_disposition_apply',
  bankAccounts: 'bank_accounts', saveBankAccount: 'bank_account_save', inspectBankSource: 'bank_source_inspect',
  importBankSource: 'bank_source_import', bankImports: 'bank_import_list', bankImport: 'bank_import_detail',
  previewBankPosting: 'bank_posting_preview', postBankReceipts: 'bank_receipts_post',
  ignoreBankRows: 'bank_rows_ignore', restoreBankRows: 'bank_rows_restore', closeBankImport: 'bank_import_close'
});
const OPERATIONS = new Set(Object.values(ACCOUNTING_RECEIVABLES_METHODS));
const ACTIONS = Object.freeze({
  settings: 'settings_saved', draft_save: 'draft_saved', quote_import: 'quote_imported',
  invoice_issue: 'invoice_issued', invoice_void: 'invoice_voided', credit: 'credit_issued',
  receipt_record: 'payment_recorded', receipt_void: 'payment_voided', settlement_import: 'settlement_recorded',
  allocate: 'payment_allocated', release: 'allocation_released', payment_create: 'payment_request_issued',
  payment_cancel: 'payment_request_cancelled', payment_return: 'payment_return_reported',
  payment_receive: 'invoice_payment_received', refund_commit: 'refund_committed', refund_cancel: 'refund_cancelled',
  refund_reverse: 'refund_reversed', refund_return: 'refund_return_reported', refund_receive: 'refund_received',
  credit_disposition_apply: 'credit_disposition_applied', bank_account_save: 'bank_account_saved',
  bank_source_import: 'bank_source_imported', bank_receipts_post: 'bank_receipts_posted',
  bank_rows_ignore: 'bank_rows_ignored', bank_rows_restore: 'bank_rows_restored', bank_import_close: 'bank_import_closed'
});
export const ACCOUNTING_RECEIVABLES_MUTATIONS = Object.freeze(Object.keys(ACTIONS));
const PAGED = new Set(['status', 'invoice_preview', 'invoice_detail', 'settlement_ledger', 'payment_list', 'payment_detail', 'refund_list',
  'bank_accounts', 'bank_import_list', 'bank_import_detail']);

/** Validate transport identity while preserving every original JSON field and string. */
export function accountingReceivablesArguments(kind, value) {
  need(Object.hasOwn(ACTIONS, kind), 'Choose an original receivables mutation.');
  const result = wire(value);
  version(result.revision); operator(result.actor); identifier(result.requestId, REQUEST_ID, 'stable request ID');
  return result;
}
export function accountingInvoicePreview(preview) {
  need(plain(preview) && plain(preview.document) && UUID.test(preview.invoiceId ?? '') &&
    preview.document.id === preview.invoiceId && SHA.test(preview.previewSha256 ?? '') &&
    digest(preview.document) === preview.previewSha256,
    'Keep the complete original invoice preview and its exact document SHA-256.', 'PREVIEW');
  version(preview.revision); version(preview.expectedVersion, 'invoice version');
  return preview;
}
export function accountingInvoiceIssueArguments(preview, value) {
  accountingInvoicePreview(preview);
  return {invoiceId: preview.invoiceId, ...identity(value), revision: preview.revision,
    expectedVersion: preview.expectedVersion, previewSha256: preview.previewSha256};
}
export function accountingPaymentRequestPreview(preview) {
  need(plain(preview) && plain(preview.proposal) &&
    preview.proposal.schema === 'stellar-forge.invoice-payment-proposal.v1' &&
    UUID.test(preview.proposal.id ?? '') && UUID.test(preview.proposal.invoice?.id ?? '') &&
    SHA.test(preview.reviewSha256 ?? '') && digest(preview.proposal) === preview.reviewSha256 &&
    preview.invoice?.id === preview.proposal.invoice.id,
    'Keep the complete original wallet proposal, invoice selection and review SHA-256.', 'PREVIEW');
  version(preview.revision); return preview;
}
export function accountingPaymentRequestArguments(preview, value) {
  accountingPaymentRequestPreview(preview);
  return {invoiceId: preview.proposal.invoice.id, ...identity(value), revision: preview.revision,
    proposal: structuredClone(preview.proposal), reviewSha256: preview.reviewSha256};
}
function reviewedCustomerAdjustment(preview, schema, label) {
  need(plain(preview) && plain(preview.proposal) && preview.proposal.schema === schema &&
    UUID.test(preview.proposal.id ?? '') && UUID.test(preview.proposal.receiptId ?? '') &&
    UUID.test(preview.proposal.customerId ?? '') && SHA.test(preview.reviewSha256 ?? '') &&
    plain(preview.balanceEffects) &&
    digest({proposal: preview.proposal, balanceEffects: preview.balanceEffects}) === preview.reviewSha256,
    'Keep the complete original ' + label + ', its balance effects and exact review SHA-256.', 'PREVIEW');
  version(preview.revision); return preview;
}
export function accountingRefundPreview(preview) {
  return reviewedCustomerAdjustment(preview, 'stellar-forge.merchant-receivables-refund-proposal.v1', 'refund proposal');
}
export function accountingCreditDispositionPreview(preview) {
  return reviewedCustomerAdjustment(preview, 'stellar-forge.merchant-receivables-credit-disposition.v1', 'credit disposition proposal');
}
export function accountingRefundArguments(preview, value) {
  accountingRefundPreview(preview);
  return {...identity(value), revision: preview.revision,
    proposal: structuredClone(preview.proposal), reviewSha256: preview.reviewSha256};
}
export function accountingCreditDispositionArguments(preview, value) {
  accountingCreditDispositionPreview(preview);
  return {...identity(value), revision: preview.revision,
    proposal: structuredClone(preview.proposal), reviewSha256: preview.reviewSha256};
}
export function accountingBankPostingPreview(preview) {
  need(plain(preview) && plain(preview.proposal) &&
    preview.proposal.schema === 'stellar-forge.merchant-bank-posting-proposal.v1' &&
    UUID.test(preview.proposal.id ?? '') && UUID.test(preview.proposal.bankImportId ?? '') &&
    Array.isArray(preview.proposal.selections) && plain(preview.balanceEffects) &&
    SHA.test(preview.reviewSha256 ?? '') &&
    digest({proposal: preview.proposal, balanceEffects: preview.balanceEffects}) === preview.reviewSha256,
    'Keep the complete original bank posting proposal, its balance effects and review SHA-256.', 'PREVIEW');
  version(preview.revision); return preview;
}
export function accountingBankPostingArguments(preview, value) {
  accountingBankPostingPreview(preview);
  return {bankImportId: preview.proposal.bankImportId, ...identity(value), revision: preview.revision,
    proposal: structuredClone(preview.proposal), reviewSha256: preview.reviewSha256};
}
function nativeIntent(kind, input) {
  const value = wire(input);
  delete value.revision;
  if (kind === 'draft_save' && Object.hasOwn(value, 'invoiceId')) {
    const id = value.invoiceId; delete value.invoiceId; value.id = id;
  }
  const selector = ['invoice_issue', 'invoice_void', 'credit', 'payment_create'].includes(kind) ? 'invoiceId' :
    kind === 'receipt_void' ? 'receiptId' : kind === 'release' ? 'allocationId' :
    ['payment_cancel', 'payment_return', 'payment_receive'].includes(kind) ? 'paymentRequestId' :
    ['refund_cancel', 'refund_reverse', 'refund_return', 'refund_receive'].includes(kind) ? 'refundId' :
    ['bank_receipts_post', 'bank_rows_ignore', 'bank_rows_restore', 'bank_import_close'].includes(kind) ? 'bankImportId' : null;
  if (selector) { const id = value[selector]; delete value[selector]; value[selector] = id; }
  return digest({action: ACTIONS[kind], value});
}
function decodeOriginal(bytes) {
  try { return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes); }
  catch { throw fail('FILE_ENCODING', 'The original file is not valid UTF-8.'); }
}

/** Borrow the original structured call; its transport owns authentication. */
export function createAccountingReceivablesClient({workspace, call} = {}) {
  identifier(workspace, /^[a-z0-9][a-z0-9_-]{0,63}$/, 'configured workspace alias');
  need(typeof call === 'function', 'Provide the original structured MCP call.');
  const maintenance = createAccountingMaintenanceClient({workspace, call}), pending = new Set();
  let closed = false, transitioning = false, closePromise;
  function accepting() { need(!closed && !transitioning, 'This caller is draining or closed.', 'CLOSED'); }
  async function tracked(work) {
    accepting(); const promise = Promise.resolve().then(work); pending.add(promise);
    try { return await promise; } finally { pending.delete(promise); }
  }
  function invoke(name, args = {}, options) {
    const selected = wire(args);
    return tracked(async () => {
      const result = await call(name, {...selected, workspace}, options);
      need(plain(result), 'The original merchant returned no structured result.', 'REPLY');
      return result;
    });
  }
  async function transition(work, permanent = false) {
    accepting(); transitioning = true;
    try {
      await Promise.allSettled([...pending]);
      const result = await work();
      if (permanent) closed = true;
      return result;
    } finally { transitioning = false; }
  }
  function closeAfter(work) {
    if (!closePromise) {
      const attempt = transition(work, true);
      closePromise = attempt;
      // The original reader retains unreleased IDs after failure; keep this caller able to finish that drain.
      attempt.catch(() => { if (closePromise === attempt) closePromise = undefined; });
    }
    return closePromise;
  }
  const client = {
    workspace,
    open: options => invoke('merchant_accounting_open', {}, options),
    sources: options => invoke('merchant_accounting_sources', {}, options),
    callOperation(kind, args = {}, options) {
      need(OPERATIONS.has(kind), 'Choose a declared original receivables operation.');
      return invoke(PREFIX + kind, Object.hasOwn(ACTIONS, kind) ? accountingReceivablesArguments(kind, args) : args, options);
    },
    async listAll(kind, args = {}, options) {
      need(PAGED.has(kind) && args.offset === undefined && args.limit === undefined,
        'Choose an original paged read and let this reader advance its offsets.');
      if (kind === 'bank_import_detail') need(['rows', 'history', 'postings'].includes(args.view),
        'Select rows, history or postings for a complete original bank import view.');
      const rowKey = kind === 'refund_list' ? 'refunds' : kind === 'bank_accounts' ? 'accounts' :
        kind === 'bank_import_list' ? 'imports' : 'items';
      const items = [], ids = new Set(); let offset = 0, total, revision, date, metadata;
      for (;;) {
        const result = await client.callOperation(kind, {...args, offset, limit: 200}, options);
        const rows = result[rowKey];
        need(Array.isArray(rows) && result.offset === offset &&
          Number.isSafeInteger(result.total) && result.total >= offset + rows.length &&
          rows.length <= 200, 'The original inventory page is inconsistent.', 'PAGE');
        version(result.revision);
        total ??= result.total; revision ??= result.revision;
        const observedDate = result.asOf ?? result.invoice?.asOf ?? result.paymentRequest?.asOf ?? rows[0]?.asOf ?? null;
        if (metadata === undefined) {
          const {[rowKey]: omitted, offset: ignoredOffset, limit: ignoredLimit, total: ignoredTotal, ...rest} = result;
          metadata = rest; date = observedDate;
        }
        need(result.total === total && result.revision === revision && observedDate === date,
          'The original inventory changed between pages. Read the current inventory again.', 'OBSERVATION_CHANGED');
        for (const row of rows) {
          need(row.asOf === undefined || observedDate === row.asOf,
            'The original inventory page combines different accounting dates.', 'OBSERVATION_CHANGED');
          if (typeof row.id === 'string') {
            need(!ids.has(row.id), 'An original inventory row appeared twice while paging.', 'PAGE');
            ids.add(row.id);
          }
          items.push(row);
        }
        offset += rows.length;
        if (offset === total) return {...metadata, [rowKey]: items, total, revision};
        need(rows.length > 0, 'The original inventory page did not advance.', 'PAGE');
      }
    },
    async fileBytes(selection, {maximumBytes = 128_000_000, ...options} = {}) {
      need(Number.isSafeInteger(maximumBytes) && maximumBytes > 0 && maximumBytes <= 128_000_000,
        'Use a complete-file byte limit within the native export size.');
      const parts = []; let length = 0, metadata;
      for await (const chunk of client.fileChunks(selection, options)) {
        metadata ??= chunk.file;
        need(Number.isSafeInteger(metadata.bytes) && metadata.bytes <= maximumBytes &&
          length + chunk.bytes.length <= maximumBytes,
          'The original file exceeds the selected complete-file limit.', 'FILE_SIZE');
        parts.push(chunk.bytes); length += chunk.bytes.length;
      }
      need(metadata && length === metadata.bytes, 'The original complete file ended early.', 'FILE_REPLY');
      return {bytes: Buffer.concat(parts, length), file: metadata};
    },
    bankImportFile({bankImportId, file}, options) {
      identifier(bankImportId, UUID, 'original bank import UUID');
      return client.fileBytes({kind: 'receivables-bank', bankImportId, file}, options);
    },
    refundFile({refundId, file}, options) {
      identifier(refundId, UUID, 'original refund UUID');
      return client.fileBytes({kind: 'receivables-refund', refundId, file}, options);
    },
    async previewInvoice(args, options) {
      need(plain(args) && UUID.test(args.invoiceId ?? '') &&
        Object.keys(args).every(key => key === 'invoiceId'),
        'Select the original draft invoice for its complete preview.');
      const summary = await client.invoicePreviewSummary(args, options);
      const descriptor = summary.files?.find(row => row.name === 'preview.json');
      need(descriptor && SHA.test(descriptor.sha256 ?? '') && descriptor.sha256 === summary.previewSha256 &&
        descriptor.selection?.kind === 'receivables-preview' && descriptor.selection.invoiceId === args.invoiceId &&
        descriptor.selection.file === 'preview.json' && Number.isSafeInteger(descriptor.bytes) && descriptor.bytes > 0,
        'The original invoice preview has no complete file identity.', 'PREVIEW');
      const complete = await client.fileBytes(descriptor.selection,
        {expectedSha256: descriptor.sha256, maximumBytes: 2_000_000, signal: options?.requestSignal});
      need(complete.bytes.length === descriptor.bytes, 'The complete preview size changed.', 'PREVIEW');
      let document;
      try { document = JSON.parse(decodeOriginal(complete.bytes)); }
      catch { throw fail('PREVIEW', 'The original invoice preview is not valid UTF-8 JSON.'); }
      return accountingInvoicePreview({invoiceId: args.invoiceId, document, previewSha256: summary.previewSha256,
        expectedVersion: summary.expectedVersion, revision: summary.revision});
    },
    async reconcileOperation(kind, value, options) {
      const args = accountingReceivablesArguments(kind, value);
      const result = await client.lookupOperation({requestId: args.requestId}, options);
      if (!result.found) return result;
      const operation = result.operation;
      need(operation?.id === args.requestId && operation.action === ACTIONS[kind] &&
        operation.actor === args.actor.trim() && SHA.test(operation.intentSha256 ?? ''),
        'The retained request ID belongs to another original operation.', 'REQUEST_BINDING');
      let native = args;
      if (kind === 'quote_import' && (args.quoteSource !== undefined || args.responseSource !== undefined)) {
        const invoiceId = result.invoice?.id;
        identifier(invoiceId, UUID, 'original imported invoice UUID');
        const detail = await client.invoice({invoiceId}, options), source = detail.sourceQuote;
        need(source && plain(source.files), 'The original imported quotation source is missing.', 'REQUEST_BINDING');
        native = Object.fromEntries(Object.entries(args).filter(([key]) => !['quoteSource', 'responseSource'].includes(key)));
        for (const [sourceKey, contentKey, name] of [
          ['quoteSource', 'quoteContent', 'quote.json'], ['responseSource', 'responseContent', 'response.json']
        ]) if (args[sourceKey] !== undefined) {
          need(args[contentKey] === undefined && source.files[name] && SHA.test(source.files[name].sha256 ?? ''),
            'The retained quotation source does not match this original import.', 'REQUEST_BINDING');
          const file = await client.fileBytes({kind: 'receivables-quote', invoiceId, file: name},
            {expectedSha256: source.files[name].sha256, maximumBytes: 2_000_000, signal: options?.requestSignal});
          native[contentKey] = decodeOriginal(file.bytes);
        }
      }
      need(nativeIntent(kind, native) === operation.intentSha256,
        'The original request ID belongs to different retained arguments.', 'REQUEST_BINDING');
      return result;
    },
    registerFileRead: readId => maintenance.registerFileRead(readId),
    releaseFile: (readId, options) => maintenance.releaseFile(readId, options),
    drainFileReads: () => transition(() => maintenance.drainFileReads()),
    async *fileChunks(selection, options) {
      accepting(); const iterator = maintenance.fileChunks(selection, options);
      try {
        for (;;) { accepting(); const item = await iterator.next(); if (item.done) return; yield item.value; }
      } finally { await iterator.return?.(); }
    },
    disconnect() {
      return closeAfter(() => maintenance.drainFileReads());
    },
    closeWorkspace(options) {
      return closeAfter(() => maintenance.closeWorkspace(options));
    }
  };
  for (const [name, operation] of Object.entries(ACCOUNTING_RECEIVABLES_METHODS))
    client[name] = (args = {}, options) => client.callOperation(operation, args, options);
  const paymentPreview = client.previewPaymentRequest;
  client.previewPaymentRequest = async (args, options) => {
    const result = accountingPaymentRequestPreview(await paymentPreview(args, options));
    need(result.proposal.invoice.id === args.invoiceId, 'The wallet proposal belongs to another invoice.', 'PREVIEW');
    return result;
  };
  for (const [method, review] of [
    ['previewRefund', accountingRefundPreview],
    ['previewCreditDisposition', accountingCreditDispositionPreview]
  ]) {
    const nativePreview = client[method];
    client[method] = async (args, options) => {
      const result = review(await nativePreview(args, options));
      need(result.proposal.receiptId === args.receiptId,
        'The reviewed customer adjustment belongs to another receipt.', 'PREVIEW');
      return result;
    };
  }
  const bankPreview = client.previewBankPosting;
  client.previewBankPosting = async (args, options) => {
    const result = accountingBankPostingPreview(await bankPreview(args, options));
    need(result.proposal.bankImportId === args.bankImportId,
      'The reviewed bank posting belongs to another original import.', 'PREVIEW');
    return result;
  };
  return Object.freeze(client);
}
export async function connectAccountingReceivablesClient({workspace, ...options} = {}) {
  const connection = await openMerchantFileClient({...options,
    errorPrefix: 'ACCOUNTING_RECEIVABLES', clientName: 'starforge-accounting-receivables'});
  return Object.freeze({...createAccountingReceivablesClient({workspace, call: connection.call}), endpoint: connection.endpoint});
}
