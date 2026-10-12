// MIT. Native invoice and payment-request operations on the existing accounting owner.
const PREFIX = 'merchant_accounting_receivables_';
const text = (max, min = 0) => ({type: 'string', minLength: min, maxLength: max});
const uuid = {type: 'string', pattern: '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'};
const alias = {type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$'};
const hash = {type: 'string', pattern: '^[a-f0-9]{64}$'};
const date = {type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'};
const revision = {type: 'integer', minimum: 1};
const actor = text(1000, 1);
const requestId = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'};
const money = {type: 'string', pattern: '^(0|[1-9][0-9]{0,38})(?:[.][0-9]{1,6})?$'};
const quantity = {type: 'string', pattern: '^(0|[1-9][0-9]{0,17})(?:[.][0-9]{1,6})?$'};
const lineId = {type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$'};
const nullableId = {anyOf: [uuid, {type: 'null'}]};
const account = {type: 'string', pattern: '^G[A-Z2-7]{55}$'};
const base = {workspace: alias};
const context = {...base, actor, requestId, revision};
const page = {offset: {type: 'integer', minimum: 0}, limit: {type: 'integer', minimum: 1, maximum: 200}};
const nativePage = {...page, limit: {type: 'integer', minimum: 1, maximum: 500}};
const readOnly = {readOnly: true, idempotent: true};
const object = (properties, required = [], additionalProperties = false) =>
  ({type: 'object', properties, required, additionalProperties});
const currency = object({code: {type: 'string', pattern: '^[A-Z]{3}$'},
  scale: {type: 'integer', minimum: 0, maximum: 6}}, ['code', 'scale']);
const issuer = {name: text(300), address: text(2000), email: text(300), taxReference: text(300),
  paymentInstructions: text(4000), invoicePrefix: {type: 'string', minLength: 1, maxLength: 20, pattern: '^[A-Z0-9][A-Z0-9-]*$'},
  creditPrefix: {type: 'string', minLength: 1, maxLength: 20, pattern: '^[A-Z0-9][A-Z0-9-]*$'}};
const draftLine = object({id: lineId, description: text(3000, 1), quantity, unitAmount: money,
  discountAmount: money, taxAmount: money}, ['description', 'quantity', 'unitAmount']);
const draft = {customerId: uuid, currency, issueDate: date, dueDate: date,
  lines: {type: 'array', minItems: 1, maxItems: 250, items: draftLine},
  purchaseOrder: text(300), note: text(6000), replacesId: nullableId, sourceReference: text(1000)};
const asset = {anyOf: [
  object({kind: {type: 'string', enum: ['native']}, code: {type: 'string', enum: ['XLM']}, issuer: {type: 'null'}}, ['kind']),
  object({kind: {type: 'string', enum: ['credit']}, code: {type: 'string', pattern: '^[A-Za-z0-9]{1,12}$'}, issuer: account},
    ['kind', 'code', 'issuer'])
]};
const memo = {anyOf: [
  object({type: {type: 'string', enum: ['MEMO_TEXT']}, value: text(28)}, ['type', 'value']),
  object({type: {type: 'string', enum: ['MEMO_ID']}, value: {type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$'}}, ['type', 'value']),
  object({type: {type: 'string', enum: ['MEMO_HASH', 'MEMO_RETURN']},
    value: {type: 'string', pattern: '^[A-Za-z0-9+/]{43}=$'}}, ['type', 'value'])
]};
const network = {type: 'string', enum: ['stellar:pubnet', 'stellar:testnet']};
const expiresAt = {anyOf: [
  {type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,3})?Z$'},
  {type: 'null'}
]};
const paymentTerms = {id: uuid, invoiceAmount: money, network, destination: account, asset,
  stellarAmount: {type: 'string', pattern: '^(0|[1-9][0-9]{0,18})(?:[.][0-9]{1,7})?$'},
  memo, msg: text(300), expiresAt, valuationNote: text(4000)};
const proposal = object({
  schema: {type: 'string', enum: ['stellar-forge.invoice-payment-proposal.v1']},
  ...paymentTerms,
  invoice: object({id: uuid, number: text(100, 1), sha256: hash, version: revision, currency,
    total: money, amountDue: money, asOf: date, customer: {type: 'object', properties: {}, additionalProperties: true}, issuer: {type: 'object', properties: {}, additionalProperties: true}},
    ['id', 'number', 'sha256', 'version', 'currency', 'total', 'amountDue', 'asOf', 'customer', 'issuer'], true),
  networkPassphrase: text(200, 1), amountAtomic: {type: 'string', pattern: '^[1-9][0-9]*$'}, uri: text(10000, 1),
}, ['schema', 'id', 'invoice', 'invoiceAmount', 'network', 'networkPassphrase', 'destination', 'asset',
  'stellarAmount', 'amountAtomic', 'memo', 'msg', 'expiresAt', 'valuationNote', 'uri'], true);

const funding = {type: 'array', maxItems: 1000,
  items: object({allocationId: uuid, amount: money, replacementAllocationId: nullableId}, ['allocationId', 'amount'])};
const dispositionAllocations = {type: 'array', maxItems: 1000,
  items: object({invoiceId: uuid, amount: money, allocationId: uuid}, ['invoiceId', 'amount'])};
const stellarAmount = {type: 'string', pattern: '^(0|[1-9][0-9]{0,18})(?:[.][0-9]{1,7})?$'};
const refundPayout = {anyOf: [
  object({kind: {type: 'string', enum: ['OPERATOR_RECORDED']}, method: text(100, 1),
    reference: text(300, 1), refundDate: date, replacesRefundId: nullableId}, ['kind', 'method', 'reference', 'refundDate']),
  object({kind: {type: 'string', enum: ['STELLAR_TRANSFER']}, sourceAccount: account,
    destination: account, network, asset, stellarAmount, valuationNote: text(4000,1), msg: text(300)},
    ['kind', 'sourceAccount', 'destination', 'network', 'asset', 'stellarAmount', 'valuationNote']),
  object({kind: {type: 'string', enum: ['STELLAR_TRANSFER']}, originalRefundId: uuid,
    originalReturnId: uuid, valuationNote: text(4000,1)}, ['kind', 'originalRefundId', 'originalReturnId', 'valuationNote']),
  object({kind: {type: 'string', enum: ['ORIGINAL_STELLAR_ADJUSTMENT']}, adjustmentId: uuid,
    valuationNote: text(4000,1)}, ['kind', 'adjustmentId', 'valuationNote'])
]};
const refundTerms = {id: uuid, receiptId: uuid, amount: money, effectiveDate: date, reason: text(3000, 1), customerNote:text(3000),
  funding, payout: refundPayout};
const dispositionTerms = {id: uuid, receiptId: uuid, effectiveDate: date, reason: text(3000, 1), customerNote:text(3000),
  funding, allocations: dispositionAllocations};
// Review replies carry the complete original source snapshots, proposal seal and
// dated balance effects. Their native owner validates the exact retained proposal.
const reviewedNativeProposal = object({}, [], true);


const bankCsvColumns = object(Object.fromEntries(
  ['date', 'amount', 'credit', 'debit', 'transactionId', 'reference', 'counterparty', 'invoiceReference', 'valueDate', 'balance']
    .map(name => [name, text(32000, 1)])));
const bankCsvLayout = object({
  delimiter: {type: 'string', enum: [',', ';', '\t']},
  dateFormat: {type: 'string', enum: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYYMMDD']},
  decimalMark: {type: 'string', enum: ['.', ',']},
  groupSeparator: {type: 'string', enum: ['', ',', '.', ' ']},
  amountMode: {type: 'string', enum: ['SIGNED', 'CREDIT_DEBIT']},
  creditSign: {type: 'string', enum: ['POSITIVE', 'NEGATIVE']}, columns: bankCsvColumns,
}, ['delimiter', 'dateFormat', 'decimalMark', 'groupSeparator', 'amountMode', 'creditSign', 'columns']);
const bankStatementOptions = object({
  profile: {type: 'string', enum: ['TEXT_BODY', 'FIN_ENVELOPE']},
  encoding: {type: 'string', enum: ['ASCII', 'UTF-8', 'ISO-8859-1']},
  debitCreditProfile: {type: 'string', enum: ['CD_ONLY', 'CD_REVERSALS']},
  yearWindowStart: {type: 'integer', minimum: 1900, maximum: 2000},
  dateBasis: {type: 'string', enum: ['VALUE_DATE']},
  currencyScales: {type: 'object', properties: {}, additionalProperties: {type: 'integer', minimum: 0, maximum: 6}},
}, ['profile', 'encoding', 'debitCreditProfile', 'yearWindowStart', 'dateBasis']);
const bankSourceInput = {
  accountId: uuid, format: {type: 'string', enum: ['CSV', 'OFX', 'MT940']},
  file: object({name: text(240, 1), dataBase64: {
    type: 'string', minLength: 4, maxLength: 1333336, pattern: '^[A-Za-z0-9+/]*={0,2}$',
  }}, ['name', 'dataBase64']),
  sectionId: text(1000, 1), csvLayout: bankCsvLayout, statementOptions: bankStatementOptions,
};
const bankAllocation = object({invoiceId: uuid, amount: money, allocatedDate: date}, ['invoiceId', 'amount']);
const bankSplit = object({
  action: {type: 'string', enum: ['CREATE', 'LINK', 'CORRECT']}, customerId: uuid, receiptId: uuid, amount: money,
  coverageKey: hash,
  allocations: {type: 'array', maxItems: 100, items: bankAllocation},
  residualAllocations: {type: 'array', maxItems: 100, items: bankAllocation},
  effectiveDate: date, reason: text(3000), dateDifferenceReason: text(3000),
}, ['action', 'amount']);
const bankSelections = {type: 'array', minItems: 1, maxItems: 100,
  items: object({rowId: hash, distinctPaymentReason: text(3000), sourceResolutionReason: text(3000),
    splits: {type: 'array', minItems: 1, maxItems: 100, items: bankSplit}}, ['rowId', 'splits'])};
const bankRowIds = {type: 'array', maxItems: 5000, items: hash, uniqueItems: true};

const read = (suffix, description, properties = {}, required = []) =>
  [PREFIX + suffix, description, {...base, ...properties}, ['workspace', ...required], readOnly];
const mutate = (suffix, description, properties = {}, required = []) =>
  [PREFIX + suffix, description, {...context, ...properties}, ['workspace', 'actor', 'requestId', 'revision', ...required], {idempotent: true}];

export const receivablesFileNames = Object.freeze([
  'invoice.json', 'invoice.csv', 'invoice.html', 'credit.json', 'credit.csv', 'credit.html',
  'manifest.json', 'status.json', 'quote.json', 'response.json', 'source.json', 'review.json',
  'preview.json', 'preview.csv', 'preview.html', 'payment-request.json', 'payment-request.html',
  'payment-request.uri', 'receiving.json', 'proof.json', 'account.json', 'invoices.csv', 'account.html', 'account.tar',
  'request.json', 'request.html', 'request.csv', 'refund.json', 'refund.html', 'refund.csv',
  'reversal.json', 'reversal.html', 'reversal.csv', 'disposition.json', 'disposition.html', 'disposition.csv',
  'source.csv', 'source.ofx', 'source.mt940', 'import.json', 'rows.json', 'rows.csv', 'reconciliation.json', 'parser-report.json',
]);
export const receivablesFileSelectors = Object.freeze([
  'documentId', 'invoiceId', 'paymentRequestId', 'refundId', 'bankImportId', 'returnId', 'customerId', 'asOf',
]);
export const receivablesDefinitions = [
  read('status', 'Read original invoice, receipt, credit, allocation, aging or operation-journal rows. Summary returns issuer, scoped counts and the current accounting revision.',
    {view: {type: 'string', enum: ['summary', 'invoices', 'receipts', 'credits', 'allocations', 'aging', 'history']},
      customerId: uuid, status: text(100), search: text(300), asOf: date, ...page}),
  mutate('settings', 'Save the original merchant invoice and credit-note document settings through the existing receivables operation journal.', issuer),
  mutate('draft_save', 'Create or edit an original invoice draft. Editing selects invoiceId and its current expectedVersion; currency, lines and customer remain native invoice inputs.',
    {...draft, invoiceId: uuid, expectedVersion: revision},
    ['customerId', 'currency', 'issueDate', 'dueDate', 'lines']),
  mutate('quote_import', 'Import an original service quotation into an editable invoice. For each file choose a configured receivablesInputs source alias or original inline UTF-8 content. Recurring scope carries its exact period count and label.',
    {quoteSource: alias, quoteContent: text(2000000, 1), responseSource: alias, responseContent: text(2000000),
      customerId: uuid, issueDate: date, dueDate: date, currencyScale: {type: 'integer', minimum: 0, maximum: 6},
      scope: {type: 'string', enum: ['IMPLEMENTATION', 'RECURRING']},
      periodCount: {type: 'integer', minimum: 1, maximum: 9007199254740991}, periodLabel: text(300)},
    ['customerId', 'issueDate', 'dueDate', 'scope']),
  read('invoice_preview', 'Review the original draft document, native preview SHA256 and version. Summary includes complete preview file identities for the existing file reader; lines pages the original invoice lines.',
    {invoiceId: uuid, view: {type: 'string', enum: ['summary', 'lines']}, ...page}, ['invoiceId']),
  mutate('invoice_issue', 'Issue the exact reviewed original invoice using its native previewSha256 and expectedVersion. Retain the original requestId to recover a lost response.',
    {invoiceId: uuid, previewSha256: hash, expectedVersion: revision}, ['invoiceId', 'previewSha256', 'expectedVersion']),
  read('invoice_detail', 'Open an original invoice, retained quotation binding and immutable document files, or page its lines, credits, allocations, receipts and history.',
    {invoiceId: uuid, asOf: date, view: {type: 'string', enum: ['summary', 'lines', 'credits', 'allocations', 'receipts', 'history']},
      ...page}, ['invoiceId']),
  mutate('invoice_void', 'Record the original invoice void date and reason while retaining its issued files, payment and correction history.',
    {invoiceId: uuid, voidDate: date, reason: text(3000, 1)}, ['invoiceId', 'voidDate', 'reason']),
  mutate('credit', 'Issue an original credit note against selected issued invoice lines. Native cumulative net and tax checks preserve the original invoice and all prior credits.',
    {invoiceId: uuid, creditDate: date, reason: text(3000, 1),
      lines: {type: 'array', minItems: 1, maxItems: 250,
        items: object({invoiceLineId: lineId, netAmount: money, taxAmount: money}, ['invoiceLineId', 'netAmount'])}},
    ['invoiceId', 'creditDate', 'reason', 'lines']),
  mutate('receipt_record', 'Record an existing customer payment in its invoice currency with the original date, method and reference; allocation remains an explicit receivables operation.',
    {customerId: uuid, currency, amount: money, receivedDate: date, method: text(100, 1),
      reference: text(300, 1), note: text(4000)}, ['customerId', 'currency', 'amount', 'receivedDate', 'method', 'reference']),
  mutate('receipt_void', 'Record the original receipt void date and reason after resolving its active allocations through the native accounting workflow.',
    {receiptId: uuid, voidDate: date, reason: text(3000, 1)}, ['receiptId', 'voidDate', 'reason']),
  read('settlement_ledger', 'Page the original completed reconciliation ledger, with optional existing customer bindings, native transfer eligibility and original imported-receipt identities.',
    {runId: uuid, customerId: uuid, ...nativePage}, ['runId']),
  mutate('settlement_import', 'Import one unique original verified public-network settlement for its assigned customer. Preserve the exact run/event identity, selected invoice-currency value, date and valuation basis.',
    {customerId: uuid, runId: uuid, eventId: hash, currency, amount: money, receivedDate: date,
      valuationNote: text(4000, 1), reference: text(300), note: text(4000)},
    ['customerId', 'runId', 'eventId', 'currency', 'amount', 'receivedDate', 'valuationNote']),
  mutate('allocate', 'Apply an original customer receipt to an issued invoice. Native customer, currency, precision and dated-balance conservation remain authoritative.',
    {invoiceId: uuid, receiptId: uuid, amount: money, allocatedDate: date},
    ['invoiceId', 'receiptId', 'amount', 'allocatedDate']),
  mutate('release', 'Release one original allocation on the selected date with its retained correction reason. The original receipt remains in the customer account.',
    {allocationId: uuid, releasedDate: date, reason: text(3000, 1)}, ['allocationId', 'releasedDate', 'reason']),
  read('customer_export', 'Prepare the original dated customer account inventory and exact source/file identities. Read account.tar or any original manifest member through merchant_accounting_file.',
    {customerId: uuid, asOf: date}, ['customerId']),
  read('payment_preview', 'Review an invoice-bound Stellar SEP7 wallet request using the current issued invoice balance. Returns the exact proposal, reviewSha256 and revision; keeps invoice value and received Stellar amount distinct.',
    {invoiceId: uuid, ...paymentTerms}, ['invoiceId', 'network', 'destination', 'asset', 'stellarAmount']),
  mutate('payment_create', 'Issue the exact original proposal from payment_preview. The original invoice snapshot, selected amount, network, asset, destination, memo and reviewSha256 remain bound together.',
    {invoiceId: uuid, proposal, reviewSha256: hash}, ['invoiceId', 'proposal', 'reviewSha256']),
  read('payment_list', 'Page original invoice payment requests, optionally for one invoice or customer, with current or dated receipt/allocation amounts and original request status.',
    {invoiceId: uuid, customerId: uuid, status: text(100), asOf: date, ...nativePage}),
  read('payment_detail', 'Open one original payment request and its exact reviewed proposal, or page returns, observations, receipts, allocations and history. An observations view selects returnId and supplies its complete native proof file.',
    {paymentRequestId: uuid, returnId: uuid, asOf: date,
      view: {type: 'string', enum: ['summary', 'returns', 'observations', 'receipts', 'allocations', 'history']}, ...page},
    ['paymentRequestId']),
  mutate('payment_cancel', 'Withdraw one original collection request with its reason. Retain the request, transaction observations, customer receipts and invoice allocation history.',
    {paymentRequestId: uuid, reason: text(3000, 1)}, ['paymentRequestId', 'reason']),
  mutate('payment_return', 'Record the original wallet transaction hash against an issued request. Optional payer constrains the original operation sender; otherwise the native verifier derives that account.',
    {paymentRequestId: uuid, transaction: hash, payer: {anyOf: [account, {type: 'null'}]}, note: text(4000)},
    ['paymentRequestId', 'transaction']),
  mutate('payment_receive', 'Verify the saved returned transaction through the original Stellar network. A matching public transfer creates the original receipt and optional dated allocation; test-network and incomplete observations retain their original proof and state.',
    {paymentRequestId: uuid, returnId: uuid, allocate: {type: 'boolean'},
      allocationAmount: money, allocatedDate: date, note: text(4000)}, ['paymentRequestId', 'returnId']),

  read('customer_funds', 'Read dated customer cash, refundable paid credits, actual target invoices and original verified payout returns or adjustments. Select an original receipt and exact eligible allocation identities for refund or credit disposition.',
    {customerId: uuid, asOf: date}),
  read('refund_preview', 'Review returning an original customer payment. Select unapplied receipt value or release exact paid-credit allocations; the original owner checks all later dates and returns the complete proposal, reviewSha256 and before-and-after balances. Choose a completed operator refund, a Stellar payout, a verified original adjustment or a retained unresolved original return.',
    refundTerms, ['receiptId', 'amount', 'effectiveDate', 'reason', 'payout']),
  mutate('refund_commit', 'Commit the complete original refund proposal from refund_preview with its reviewSha256. Completed operator and adopted original payouts record cash leaving; a public Stellar wallet request reserves its reviewed amount until native receiving. Test-network requests retain observations with no commercial balance changes.',
    {proposal: reviewedNativeProposal, reviewSha256: hash}, ['proposal', 'reviewSha256']),
  read('refund_list', 'Page original refund rows with their actual customer, receipt, payout kind, accounting scope, dated status and reserved/refunded amounts. The original response retains its refunds array.',
    {customerId: uuid, receiptId: uuid, asOf: date,
      status: {type: 'string', enum: ['AWAITING_TRANSFER', 'RECORDED', 'CANCELLED', 'REVERSED']},
      ...nativePage}),
  read('refund_detail', 'Open one original refund with its reviewed proposal, balance effects, returned transactions, receiving observations, operation history and original files.',
    {refundId: uuid, asOf: date}, ['refundId']),
  mutate('refund_cancel', 'Cancel the unspent part of an original Stellar refund request on the selected date. Retain its reviewed credit release, source payment, returns and files; a later actual payout remains receivable against its original proof.',
    {refundId: uuid, cancelledDate: date, reason: text(3000, 1)}, ['refundId', 'cancelledDate', 'reason']),
  mutate('refund_reverse', 'Correct an operator-recorded refund with a dated reversal and reason. Keep the original refund document and record the restored customer cash under the same receipt.',
    {refundId: uuid, reversedDate: date, reason: text(3000, 1)}, ['refundId', 'reversedDate', 'reason']),
  mutate('refund_return', 'Retain a wallet transaction hash against its original refund. Receiving uses the reviewed merchant sender, customer destination, network, asset, amount and memo.',
    {refundId: uuid, transaction: hash, note: text(4000)}, ['refundId', 'transaction']),
  mutate('refund_receive', 'Verify the original returned refund through the native Stellar verifier and retain its exact proof. Matching public receiving records the payout once; a cash-allocation conflict retains the original observation for correction and receiving of that same return. Extra actual returns can be adopted through a new exact refund review.',
    {refundId: uuid, returnId: uuid}, ['refundId', 'returnId']),
  read('credit_disposition_preview', 'Review moving an original paid credit or unapplied payment to actual issued invoices for that same customer and currency. Release selected original allocations, preserve their exact residual replacements and leave any chosen remainder unapplied. Returns the complete native proposal, reviewSha256 and dated balance effects.',
    dispositionTerms, ['receiptId', 'effectiveDate', 'reason', 'allocations']),
  mutate('credit_disposition_apply', 'Apply the exact reviewed credit-disposition proposal and reviewSha256 through the original accounting journal. Original allocation history and every affected later receipt and invoice balance remain bound to that review.',
    {proposal: reviewedNativeProposal, reviewSha256: hash}, ['proposal', 'reviewSha256']),
  read('bank_accounts', 'Page original bank account identities, currencies, saved CSV layouts and active or archived status.',
    {status: {type: 'string', enum: ['ACTIVE', 'ARCHIVED']}, search: text(300), ...nativePage}),
  mutate('bank_account_save', 'Save the original bank account identity and invoice currency. Editing retains id and expectedVersion; a retained statement keeps its original currency, bankId and accountReference.',
    {id: uuid, expectedVersion: revision, reference: text(80,1), name: text(200,1), currency,
      method: text(100,1), bankId: text(200), accountReference: text(200), csvLayout: bankCsvLayout,
      status: {type: 'string', enum: ['ACTIVE', 'ARCHIVED']}}, ['reference', 'name', 'currency']),
  read('bank_source_inspect', 'Inspect complete original CSV, OFX or MT940 bytes. Read actual account sections, dates, balances, row counts, parser findings and source SHA256. CSV inspection accepts an incomplete column mapping to reveal original headers; MT940 requires its explicit envelope, encoding, debit/reversal convention, 100-year window and complete value-date basis.',
    bankSourceInput, ['format', 'file']),
  mutate('bank_source_import', 'Retain the selected original statement section and exact file bytes for one bank account. Complete CSV column mapping or explicit MT940 source options are required by the native parser. Retention preserves source, normalized rows and parser report for subsequent reviewed customer posting.',
    bankSourceInput, ['accountId', 'format', 'file', 'sectionId']),
  read('bank_import_list', 'Page retained original bank statements with their account, currency, source identity, open/closed status and posted, linked, ignored, duplicate or conflicting credit counts.',
    {accountId: uuid, status: {type: 'string', enum: ['OPEN', 'CLOSED']}, search: text(300), ...nativePage}),
  read('bank_import_detail', 'Read original bank statement metadata and files, or page its complete source rows, posting history and operations. Row filters apply before paging. Each original source row retains its transaction identity, raw fields, source conflicts, original receipt candidates, invoice candidates and customer matching reasons.',
    {bankImportId: uuid, view: {type: 'string', enum: ['summary', 'rows', 'history', 'postings']},
      rowStatus: {type: 'string', enum: ['UNASSIGNED', 'POSTED', 'LINKED', 'IGNORED', 'DUPLICATE', 'CONFLICT', 'SOURCE_ONLY']},
      direction: {type: 'string', enum: ['CREDIT', 'DEBIT', 'ZERO']}, search: text(300), ...nativePage}, ['bankImportId']),
  read('bank_posting_preview', 'Review complete original bank credits split across actual customers. CREATE records receipts; LINK retains existing receipt identities and supports explicit partial receipt coverage; CORRECT retains original cash dates while replacing an incorrectly recorded receipt, preserving remaining original-customer cash and releasing its original allocations. Optional residualAllocations assigns that remaining cash to original-customer invoices. The native owner checks source conflicts and all affected dated balances and returns the complete proposal, balanceEffects, reviewSha256 and revision.',
    {bankImportId: uuid, selections: bankSelections}, ['bankImportId', 'selections']),
  mutate('bank_receipts_post', 'Post exactly the complete original bank proposal and reviewSha256 returned by bank_posting_preview at its reviewed revision. The original journal retains the bank posting, receipts, correction relationships, allocation releases, new allocations and complete customer receipt documents together.',
    {bankImportId: uuid, proposal: reviewedNativeProposal, reviewSha256: hash}, ['bankImportId', 'proposal', 'reviewSha256']),
  mutate('bank_rows_ignore', 'Retain a reason excluding selected original source rows from customer cash posting. Original transaction identities and complete statement files remain readable.',
    {bankImportId: uuid, rowIds: {...bankRowIds, minItems: 1}, reason: text(3000,1)}, ['bankImportId', 'rowIds', 'reason']),
  mutate('bank_rows_restore', 'Restore explicitly selected ignored source rows and reopen a closed original statement. Empty rowIds reopens a closed statement while preserving existing postings for an explicit receipt correction.',
    {bankImportId: uuid, rowIds: bankRowIds, reason: text(3000,1)}, ['bankImportId', 'reason']),
  mutate('bank_import_close', 'Close an original bank statement after every actual cash credit has a retained disposition. Keep original source, parser findings, customer postings and complete reconciliation files available.',
    {bankImportId: uuid, reason: text(3000)}, ['bankImportId']),
  read('request_lookup', 'Recover the exact original receivables operation by requestId after an uncertain response. Returns found, the retained operation and current original invoice/payment/receipt result identities.',
    {requestId, asOf: date}, ['requestId']),
];

export {PREFIX, base, context, page, nativePage, readOnly, text, uuid, alias, hash, date,
  revision, actor, requestId, money, currency, draft, paymentTerms, proposal};
