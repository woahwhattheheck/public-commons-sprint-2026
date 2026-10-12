import type {
  BankFormat, BankAccountStatus, BankImportStatus, BankDirection, BankRowStatus, BankDateBasis, BankCsvColumns, BankCsvLayout, BankCsvInspectionLayout, BankCsvNormalizedLayout, BankStatementOptions, BankAccountInput, BankAccount, BankAccountsQuery, BankAccountsPage, BankAccountsInventory, BankSourceFile, BankSourceInspectionInput, BankSourceImportInput, BankSourceIdentity, BankSourceIssue, BankSourceSection, BankRawRow, BankSourceSample, BankSourceInspection, BankSourceRow, BankSourceMatch, BankRowDecision, BankRow, BankImportSummary, BankImportsQuery, BankImportsPage, BankImportsInventory, BankImportView, BankImportQuery, BankFileMetadata, BankFileName, BankDownload, BankImportRows, BankImportDetail, BankImportInventory, BankAllocationInput, BankPostingSplitInput, BankPostingSelectionInput, BankPostingPreviewInput, BankReviewedAllocation, BankReleasedAllocation, BankReceiptSourceBinding, BankSourceCoverage, BankResidualReceipt, BankOriginalReceipt, BankPostingSplit, BankPostingSelection, BankPostingProposal, BankReceiptBalance, BankInvoiceBalance, BankBalancePeriod, BankBalanceEffect, BankPostingTotals, BankPostingBalanceEffects, BankPostingPreview, PostBankReceiptsInput, IgnoreBankRowsInput, RestoreBankRowsInput, CloseBankImportInput, BankPostingSummary, BankMutationResult, BankAccountMutationResult, BankImportMutationResult, BankPostingMutationResult
} from "../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/bank-client-types.d.ts";
export type {
  BankFormat, BankAccountStatus, BankImportStatus, BankDirection, BankRowStatus, BankDateBasis, BankCsvColumns, BankCsvLayout, BankCsvInspectionLayout, BankCsvNormalizedLayout, BankStatementOptions, BankAccountInput, BankAccount, BankAccountsQuery, BankAccountsPage, BankAccountsInventory, BankSourceFile, BankSourceInspectionInput, BankSourceImportInput, BankSourceIdentity, BankSourceIssue, BankSourceSection, BankRawRow, BankSourceSample, BankSourceInspection, BankSourceRow, BankSourceMatch, BankRowDecision, BankRow, BankImportSummary, BankImportsQuery, BankImportsPage, BankImportsInventory, BankImportView, BankImportQuery, BankFileMetadata, BankFileName, BankDownload, BankImportRows, BankImportDetail, BankImportInventory, BankAllocationInput, BankPostingSplitInput, BankPostingSelectionInput, BankPostingPreviewInput, BankReviewedAllocation, BankReleasedAllocation, BankReceiptSourceBinding, BankSourceCoverage, BankResidualReceipt, BankOriginalReceipt, BankPostingSplit, BankPostingSelection, BankPostingProposal, BankReceiptBalance, BankInvoiceBalance, BankBalancePeriod, BankBalanceEffect, BankPostingTotals, BankPostingBalanceEffects, BankPostingPreview, PostBankReceiptsInput, IgnoreBankRowsInput, RestoreBankRowsInput, CloseBankImportInput, BankPostingSummary, BankMutationResult, BankAccountMutationResult, BankImportMutationResult, BankPostingMutationResult
} from "../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/bank-client-types.d.ts";

import type {
  RefundStatus, RefundEffectiveStatus, RefundAccountingScope, CustomerFundsQuery,
  RefundFundingInput, RefundFundingProposal, RefundOperatorPayoutInput, RefundStellarPayoutInput,
  RefundAdoptedStellarPayoutInput, RefundAdjustmentPayoutInput, RefundPayoutInput, RefundPreviewInput,
  CreditDispositionAllocationInput, CreditDispositionPreviewInput, RefundBalanceEffects, CustomerAdjustmentProposal,
  RefundOperatorPayout, RefundStellarPayout, RefundAdjustmentPayout, RefundPayout,
  RefundProposal, CreditDispositionAllocation, CreditDispositionProposal, RefundPreview,
  CreditDispositionPreview, CommitRefundInput, ApplyCreditDispositionInput, CancelRefundInput,
  ReverseRefundInput, ReportRefundReturnInput, ReceiveRefundInput, RefundSummary,
  RefundQuery, RefundPage, RefundInventory, RefundObservationStatus,
  RefundObservation, RefundReturn, RefundFileName, RefundFileMetadata,
  RefundDownload, RefundDetail, RefundMutationResult, RefundReturnMutationResult,
  CreditDispositionRecord, CreditDispositionMutationResult, CustomerFundsCurrency, CustomerFundsReceipt,
  CustomerFundsFunding, CustomerFundsAdjustment, CustomerFundsRefundReturn, CustomerFunds
} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/refund-client-types.d.ts';
export type {
  RefundReceiptSnapshot,
  RefundStatus, RefundEffectiveStatus, RefundAccountingScope, CustomerFundsQuery,
  RefundFundingInput, RefundFundingProposal, RefundOperatorPayoutInput, RefundStellarPayoutInput,
  RefundAdoptedStellarPayoutInput, RefundAdjustmentPayoutInput, RefundPayoutInput, RefundPreviewInput,
  CreditDispositionAllocationInput, CreditDispositionPreviewInput, RefundBalanceEffects, CustomerAdjustmentProposal,
  RefundOperatorPayout, RefundStellarPayout, RefundAdjustmentPayout, RefundPayout,
  RefundProposal, CreditDispositionAllocation, CreditDispositionProposal, RefundPreview,
  CreditDispositionPreview, CommitRefundInput, ApplyCreditDispositionInput, CancelRefundInput,
  ReverseRefundInput, ReportRefundReturnInput, ReceiveRefundInput, RefundSummary,
  RefundQuery, RefundPage, RefundInventory, RefundObservationStatus,
  RefundObservation, RefundReturn, RefundFileName, RefundFileMetadata,
  RefundDownload, RefundDetail, RefundMutationResult, RefundReturnMutationResult,
  CreditDispositionRecord, CreditDispositionMutationResult, CustomerFundsCurrency, CustomerFundsReceipt,
  CustomerFundsFunding, CustomerFundsAdjustment, CustomerFundsRefundReturn, CustomerFunds
} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/refund-client-types.d.ts';

// MIT. Typed original receivables, reviewed invoices and Stellar collection over merchant MCP.
export type Money = string;
export type DateOnly = string;
export type Revision = number;
export interface Currency { code: string; scale: number }
export interface MutationContext { revision: Revision; actor: string; requestId: string }
export interface Issuer {
  name: string; address?: string; email?: string; taxReference?: string;
  paymentInstructions?: string; invoicePrefix?: string; creditPrefix?: string; version?: number;
}
export interface Customer {
  id: string; name: string; reference?: string; version?: number; email?: string; address?: string; [key: string]: unknown;
}
export interface DraftLine {
  id?: string; description: string; quantity: string; unitAmount: Money; discountAmount?: Money; taxAmount?: Money;
}
export interface InvoiceLine {
  id: string; description: string; quantity: string; unitAmount: Money; subtotal: Money;
  discountAmount: Money; netAmount: Money; taxAmount: Money; total: Money;
}
export interface InvoiceTotals { subtotal: Money; discount: Money; net: Money; tax: Money; total: Money }
export interface DraftInput {
  customerId: string; currency: Currency; issueDate: DateOnly; dueDate: DateOnly;
  purchaseOrder?: string; note?: string; lines: DraftLine[]; replacesId?: string | null; sourceReference?: string;
}
export interface SaveDraft extends MutationContext, DraftInput { id?: string; expectedVersion?: number }
export interface InvoiceDraft extends Omit<DraftInput, 'lines'> { lines: InvoiceLine[]; totals: InvoiceTotals }
export interface InvoiceSummary {
  id: string; number: string | null; status: 'DRAFT' | 'ISSUED' | 'VOID'; version: number;
  customerId: string; customerName: string; currency: Currency; issueDate: DateOnly; dueDate: DateOnly;
  total: Money; paid: Money; credited: Money; balance: Money; amountDue: Money; creditBalance: Money;
  paymentStatus: 'DRAFT' | 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'CREDIT_BALANCE' | 'VOID' | 'FUTURE';
  overdueDays: number; voidDate: DateOnly | null; asOf: DateOnly; [key: string]: unknown;
}
export interface InvoiceDocument extends InvoiceDraft {
  schema: string; kind: 'INVOICE'; id: string; number: string | null;
  issuedAt: string | null; actor: string | null; issuer: Issuer; customer: Customer;
}
export interface FileMetadata { bytes: number; sha256: string }
export type DocumentFiles = Record<string, FileMetadata>;
export interface CreditLine {
  invoiceLineId: string; description: string; netAmount: Money; taxAmount: Money; total: Money;
}
export interface CreditDocument {
  schema: string; kind: 'CREDIT_NOTE'; id: string; number: string; issuedAt: string; actor: string;
  invoiceId: string; invoiceNumber: string; invoiceSha256: string; customer: Customer; issuer: Issuer; currency: Currency;
  creditDate: DateOnly; reason: string; lines: CreditLine[]; totals: {net: Money; tax: Money; total: Money};
}
export interface CreditSummary {
  id: string; invoiceId: string; number: string; customerId: string; currency: Currency;
  creditDate: DateOnly; reason: string; total: Money;
}
export interface CreditRecord {
  id: string; invoiceId: string; number: string; document: CreditDocument; directoryId: string; files: DocumentFiles;
}
export type Credit = CreditSummary;
export interface Receipt {
  id: string; customerId: string; customer: Customer; currency: Currency; amount: Money; allocated: Money; available: Money;
  receivedDate: DateOnly; accountingDate: DateOnly; replacesReceiptId?: string | null; replacedByReceiptId?: string | null;
  replacementReceiptIds?: string[]; replacementRole?: 'CORRECTION' | 'RESIDUAL';
  bankSources?: BankReceiptSourceBinding[]; method: string; reference: string; note: string; status: 'RECORDED' | 'VOID';
  voidDate?: DateOnly | null; sourceKey: string; source: {kind: string; runId?: string; eventId?: string; [key: string]: unknown};
  refunded: Money; reserved: Money; netAmount: Money; availableBeforeUnreconciledRefunds: Money;
  unreconciledRefunds: Array<Record<string, unknown>>; unreconciledRefundAmount: Money; refundDeficit: Money;
  createdAt: string; actor: string; history: HistoryEntry[]; asOf?: DateOnly; [key: string]: unknown;
}
export interface Allocation {
  id: string; invoiceId: string; receiptId: string; customerId: string; currency: Currency;
  amount: Money; minorAmount: string; allocatedDate: DateOnly; releasedDate: DateOnly | null;
  reason?: string; releasedBy?: string; createdAt: string; actor: string; history: HistoryEntry[];
}
export interface HistoryEntry {
  action: string; actor: string; at: string; requestId?: string; revision?: number;
  details?: Record<string, unknown>; [key: string]: unknown;
}
export interface SettlementRun { id: string; name: string; createdAt: string; completedAt: string; reportSha256: string }
export interface AgingCurrency {
  currency: Currency; current: Money; days1to30: Money; days31to60: Money; days61to90: Money; days91plus: Money;
  amountDue: Money; creditBalance: Money; unappliedPayments: Money; invoices: number;
}
export interface AgingReport { asOf: DateOnly; currencies: AgingCurrency[]; invoices: InvoiceSummary[] }
export interface ReceivablesState {
  schema: string; revision: Revision; asOf: DateOnly; issuer: Issuer; customers: Customer[]; runs: SettlementRun[];
  invoices: InvoiceSummary[]; receipts: Receipt[]; credits: CreditSummary[]; allocations: Allocation[];
  aging: AgingReport; history: HistoryEntry[];
}
export interface SourceQuote {
  customerId: string; directoryId: string; files: DocumentFiles; sourceSha256: string;
  quoteId: string; quoteSha256: string; originalDraftSha256: string; review: Record<string, unknown>;
}
export interface InvoiceDetail {
  invoice: InvoiceSummary; draft: InvoiceDraft; document: InvoiceDocument | null;
  credits: CreditRecord[]; allocations: Allocation[]; receipts: Receipt[]; files: DocumentFiles;
  sourceQuote: SourceQuote | null; quoteDraftChanged: boolean; history: HistoryEntry[]; revision: Revision;
}
export type QuoteImportInput = MutationContext & {
  quoteContent: string; responseContent?: string; customerId: string; issueDate: DateOnly; dueDate: DateOnly; currencyScale?: number;
} & ({scope: 'IMPLEMENTATION'; periodCount?: 1; periodLabel?: string} | {scope: 'RECURRING'; periodCount: number; periodLabel: string});
export interface Operation {
  id: string; action: string; actor: string; at: string; intentSha256: string; replayed?: boolean;
  result: {invoiceId?: string; receiptId?: string; creditId?: string; allocationId?: string; paymentRequestId?: string; paymentReturnId?: string; refundId?: string; refundReturnId?: string; creditDispositionId?: string;
    bankAccountId?: string; bankImportId?: string; bankPostingId?: string; receiptIds?: string[];
    invoiceIds?: string[]; allocationIds?: string[]; sourceRefundId?: string; sourceRefundReturnId?: string; resolvedRefundId?: string; settings?: boolean};
}
export interface MutationResult { revision: Revision; operation: Operation }
export interface Preview { document: InvoiceDocument; previewSha256: string; expectedVersion: number; revision: Revision }
export interface CreditInput extends MutationContext {
  creditDate: DateOnly; reason: string; lines: Array<{invoiceLineId: string; netAmount: Money; taxAmount?: Money}>;
}
export interface ReceiptInput extends MutationContext {
  customerId: string; currency: Currency; amount: Money; receivedDate: DateOnly; method: string; reference: string; note?: string;
}
export interface SettlementReceiptInput extends MutationContext {
  customerId: string; runId: string; eventId: string; currency: Currency; amount: Money; receivedDate: DateOnly; valuationNote: string;
  reference?: string; note?: string;
}
export interface AllocateInput extends MutationContext { invoiceId: string; receiptId: string; amount: Money; allocatedDate: DateOnly }
export interface LedgerQuery { runId: string; customerId?: string; offset?: number; limit?: number }
export interface LedgerItem {
  eventId: string; orderReferenceDigest: string; network: string; amountAtomic: string; assetDigest?: string; recipientDigest?: string;
  transfer: string; verificationScope: string; transactionFingerprint: string; recordedAt: string; eligible: boolean;
  importedReceiptId: string | null; adjustmentSummary: unknown; [key: string]: unknown;
}
export interface LedgerPage {
  items: LedgerItem[]; total: number; offset: number; limit: number; runId: string; reportSha256: string; revision: Revision;
}
export interface CustomerExport {
  schema: string; customer: Customer; currencies: AgingCurrency[]; invoices: InvoiceSummary[];
  credits: CreditSummary[]; receipts: Receipt[]; allocations: Allocation[]; asOf: DateOnly; [key: string]: unknown;
}

export type NativeRecord = Record<string, unknown>;
export interface ReceivablesCallOptions { requestSignal?: AbortSignal; timeoutMs?: number }
export type ReceivablesCall = (name: string, args: NativeRecord, options?: ReceivablesCallOptions) =>
  NativeRecord | PromiseLike<NativeRecord>;
export interface ReceivablesConnectionOptions {
  workspace: string; url: string; tokenEnv?: string; environment?: Record<string, string | undefined>;
  signal?: AbortSignal; maximumResponseBytes?: number;
}
export interface ReceivablesRecoveryError extends Error {
  code?: string; status?: number; details?: unknown; applied?: false;
  outcomeUnknown?: true; reopenRequired?: true;
  commitUncertainty?: {at: string; action: string; revision: number; causeCode: string};
  operationDirectory?: string; requestId?: string;
  lookupError?: NativeRecord; releaseError?: NativeRecord;
}
export interface PageArguments { offset?: number; limit?: number }
export interface ReceivablesPage<T> extends PageArguments {
  items: T[]; total: number; offset: number; limit: number; revision: Revision;
}
export interface ReceivablesInventory<T> { items: T[]; total: number; revision: Revision }
export type ReceivablesStatusView = 'summary' | 'invoices' | 'receipts' | 'credits' | 'allocations' | 'aging' | 'history';
export interface StatusArguments extends PageArguments {
  view?: ReceivablesStatusView; customerId?: string; status?: string; search?: string; asOf?: DateOnly;
}
export interface ReceivablesStatusMetadata {
  workspace: string; schema: string; view: ReceivablesStatusView; asOf: DateOnly;
  customerId: string | null; revision: Revision;
}
export interface ReceivablesStatusSummary extends ReceivablesStatusMetadata {
  view: 'summary'; issuer: Issuer;
  counts: {customers: number; invoices: number; drafts: number; issued: number; void: number;
    receipts: number; credits: number; allocations: number; paymentRequests: number; operations: number};
}
export interface CreditBrief extends CreditSummary { status: 'ISSUED'; customerName: string; files: DocumentFiles }
export interface StatusRows {
  invoices: InvoiceSummary; receipts: Receipt; credits: CreditBrief; allocations: Allocation;
  aging: InvoiceSummary; history: Operation;
}
export type StatusPage<V extends keyof StatusRows = keyof StatusRows> =
  ReceivablesPage<StatusRows[V]> & ReceivablesStatusMetadata & {view: V} &
  (V extends 'aging' ? {currencies: AgingCurrency[]; totalsScope: {asOf: DateOnly; customerId: string | null}} : object);
export type StatusResult = ReceivablesStatusSummary | StatusPage;

export type DraftSaveArguments = MutationContext & DraftInput &
  ({invoiceId?: never; expectedVersion?: never} | {invoiceId: string; expectedVersion: number});
export type QuoteContents =
  ({quoteContent: string; quoteSource?: never} | {quoteSource: string; quoteContent?: never}) &
  ({responseContent?: string; responseSource?: never} | {responseSource: string; responseContent?: never});
export type QuoteImportArguments = MutationContext & QuoteContents & {
  customerId: string; issueDate: DateOnly; dueDate: DateOnly; currencyScale?: number;
} & ({scope: 'IMPLEMENTATION'; periodCount?: 1; periodLabel?: string} |
  {scope: 'RECURRING'; periodCount: number; periodLabel: string});
export interface InvoiceIssueArguments extends MutationContext {
  invoiceId: string; expectedVersion: number; previewSha256: string;
}
export interface InvoiceVoidArguments extends MutationContext { invoiceId: string; voidDate: DateOnly; reason: string }
export interface CreditArguments extends CreditInput { invoiceId: string }
export interface ReceiptVoidArguments extends MutationContext { receiptId: string; voidDate: DateOnly; reason: string }
export interface ReleaseArguments extends MutationContext { allocationId: string; releasedDate: DateOnly; reason: string }
export interface CustomerExportArguments { customerId: string; asOf?: DateOnly }

export type InvoicePreviewView = 'summary' | 'lines';
export interface InvoicePreviewArguments extends PageArguments { invoiceId: string; view?: InvoicePreviewView }
export type InvoiceHeader = Omit<InvoiceDocument, 'lines'> & {lineCount: number};
export type DraftHeader = Omit<InvoiceDraft, 'lines'> & {lineCount: number};
export interface CompleteInvoicePreview extends Preview { invoiceId: string }
export interface InvoicePreviewMetadata {
  workspace: string; invoiceId: string; previewSha256: string; expectedVersion: number; revision: Revision;
}
export interface InvoicePreviewSummary extends InvoicePreviewMetadata {
  view: 'summary'; documentHeader: InvoiceHeader; files: ReceivablesFileIdentity<PreviewFileSelection>[];
}
export type InvoicePreviewPage = ReceivablesPage<InvoiceLine> & InvoicePreviewMetadata &
  {view: 'lines'; currency: Currency; totals: InvoiceTotals};
export type InvoiceDetailView = 'summary' | 'lines' | 'credits' | 'allocations' | 'receipts' | 'history';
export interface InvoiceDetailArguments extends PageArguments {
  invoiceId: string; view?: InvoiceDetailView; asOf?: DateOnly;
}
export interface InvoiceDetailMetadata {
  workspace: string; invoiceId: string; invoice: InvoiceSummary; view: InvoiceDetailView; revision: Revision;
}
export interface InvoiceDetailSummary extends InvoiceDetailMetadata {
  view: 'summary'; draftHeader: DraftHeader; documentHeader: InvoiceHeader | null; sourceQuote: SourceQuote | null;
  quoteDraftChanged: boolean; counts: {lines: number; credits: number; allocations: number; receipts: number; history: number};
  files: Array<FileMetadata & {selection: DocumentFileSelection}>;
  statusFile: DocumentFileSelection | null; quoteFiles: QuoteFileSelection[];
}
export interface InvoiceDetailRows {
  lines: InvoiceLine; credits: CreditBrief; allocations: Allocation; receipts: Receipt; history: HistoryEntry;
}
export type InvoiceDetailPage<V extends keyof InvoiceDetailRows = keyof InvoiceDetailRows> =
  ReceivablesPage<InvoiceDetailRows[V]> & InvoiceDetailMetadata & {view: V};
export interface CustomerExportSummary {
  workspace: string; schema: string; customerId: string; customer: Customer; asOf: DateOnly;
  currencies: AgingCurrency[]; counts: {invoices: number; credits: number; receipts: number; allocations: number};
  files: ReceivablesFileIdentity<CustomerFileSelection>[]; packet: CustomerFileSelection; revision: Revision;
}

export type StellarNetwork = 'stellar:pubnet' | 'stellar:testnet';
export type StellarAssetInput = {kind: 'native'} | {kind: 'credit'; code: string; issuer: string};
export type StellarAsset = {kind: 'native'; code: 'XLM'; issuer: null} | {kind: 'credit'; code: string; issuer: string};
export interface StellarMemo {type: 'MEMO_TEXT' | 'MEMO_ID' | 'MEMO_HASH' | 'MEMO_RETURN'; value: string}
export interface PaymentPreviewArguments {
  invoiceId: string; id?: string; invoiceAmount?: Money; network: StellarNetwork; destination: string;
  asset: StellarAssetInput; stellarAmount: string; memo?: StellarMemo; msg?: string;
  expiresAt?: string | null; valuationNote?: string;
}
export interface PaymentInvoiceSnapshot {
  id: string; number: string; sha256: string; version: number; currency: Currency; total: Money;
  amountDue: Money; asOf: DateOnly; customer: Customer; issuer: Issuer;
}
export interface PaymentProposal {
  schema: 'stellar-forge.invoice-payment-proposal.v1'; id: string; invoice: PaymentInvoiceSnapshot;
  invoiceAmount: Money; network: StellarNetwork; networkPassphrase: string; destination: string;
  asset: StellarAsset; stellarAmount: string; amountAtomic: string; memo: StellarMemo; msg: string;
  expiresAt: string | null; valuationNote: string; uri: string;
}
export interface PaymentRequestPreview {
  proposal: PaymentProposal; reviewSha256: string; invoice: InvoiceSummary; revision: Revision;
}
export interface PaymentCreateArguments extends MutationContext {
  invoiceId: string; proposal: PaymentProposal; reviewSha256: string;
}
export interface PaymentCancelArguments extends MutationContext { paymentRequestId: string; reason: string }
export interface PaymentReturnArguments extends MutationContext {
  /** Omission preserves an existing payer constraint. An explicit account changes it before
   * verification; null clears it. A changed or cleared constraint requires a note. */
  paymentRequestId: string; transaction: string; payer?: string | null; note?: string;
}
export interface PaymentReceiveArguments extends MutationContext {
  paymentRequestId: string; returnId: string; allocate?: boolean; allocationAmount?: Money;
  allocatedDate?: DateOnly; note?: string;
}
export type PaymentRequestStatus =
  'OPEN' | 'AWAITING_VERIFICATION' | 'SATISFIED' | 'PARTIALLY_APPLIED' | 'RECEIVED_UNAPPLIED' |
  'CANCELLED' | 'EXPIRED' | 'TESTNET_VERIFIED' | 'FAILED' | 'NOT_FOUND' | 'VERIFICATION_UNAVAILABLE' |
  'TRANSFER_PRECEDES_REQUEST' | 'TRANSFER_AFTER_EXPIRY' | 'TRANSFER_AFTER_CANCELLATION' | 'RECEIPT_REVERSED';
export type PaymentObservationStatus = 'RECORDED' | 'TESTNET_VERIFIED' | 'FAILED' | 'NOT_FOUND' |
  'VERIFICATION_UNAVAILABLE' | 'TRANSFER_PRECEDES_REQUEST' | 'TRANSFER_AFTER_EXPIRY' | 'TRANSFER_AFTER_CANCELLATION';
export interface PaymentProofArtifact {
  directoryId: string; name: 'transfer-proof.json'; bytes: number; sha256: string;
}
export interface PaymentTransferVerification {
  schema: 'stellar-forge.invoice-stellar-transfer.v1'; status: 'VERIFIED' | 'NOT_FOUND' | 'FAILED';
  network: StellarNetwork; transaction: string; observedAt: string; networkPassphrase?: string;
  payer?: string | null; recipient?: string; asset?: StellarAsset; amountAtomic?: string; memo?: StellarMemo;
  ledger?: number; closedAt?: string; verificationScope?: string; transactionFingerprint?: string;
  transactionFingerprints?: string[]; proof: NativeRecord; proofArtifact?: PaymentProofArtifact;
  code?: string; message?: string; reason?: string; detail?: string;
}
export interface PaymentObservation {
  id: string; recordedAt: string; actor: string; status: PaymentObservationStatus; verification: PaymentTransferVerification;
}
export interface PaymentReturnReference {
  id: string; transaction: string; payer: string | null; note: string; reportedAt: string; actor: string;
  receiptId: string | null; allocationId: string | null; observations: PaymentObservation[];
}
export interface PaymentReturnBrief extends Omit<PaymentReturnReference, 'observations'> {
  observationCount: number; lastObservation: PaymentObservation | null;
}
export interface PaymentRequestSummary {
  id: string; invoiceId: string; invoiceNumber: string; customerId: string; customerName: string;
  status: PaymentRequestStatus; issuedAt: string; expiresAt: string | null; cancelledAt: string | null;
  currency: Currency; invoiceAmount: Money; currentAmountDue: Money; balanceChanged: boolean;
  received: Money; applied: Money; unapplied: Money; payable: boolean; network: StellarNetwork; asset: StellarAsset;
  stellarAmount: string; destination: string; memo: StellarMemo; uri: string; valuationNote: string;
  documentSha256: string; returnCount: number; receiptIds: string[];
  lastObservation: {status: PaymentObservationStatus; recordedAt: string; transaction: string} | null;
  asOf: DateOnly; observedAt: string;
}
export interface PaymentListArguments extends PageArguments {
  invoiceId?: string; customerId?: string; status?: PaymentRequestStatus; asOf?: DateOnly;
}
export type PaymentList = ReceivablesPage<PaymentRequestSummary>;
export type PaymentDetailView = 'summary' | 'returns' | 'observations' | 'receipts' | 'allocations' | 'history';
export type PaymentDetailArguments = PageArguments & {paymentRequestId: string; asOf?: DateOnly} &
  ({view?: Exclude<PaymentDetailView, 'observations'>; returnId?: never} | {view: 'observations'; returnId: string});
export interface PaymentDetailMetadata {
  workspace: string; paymentRequestId: string; paymentRequest: PaymentRequestSummary;
  view: PaymentDetailView; revision: Revision;
}
export interface PaymentDetailSummary extends PaymentDetailMetadata {
  view: 'summary'; proposal: PaymentProposal; issuedAt: string; reviewSha256: string; documentSha256: string;
  cancelledAt: string | null; cancellationReason: string | null;
  counts: {returns: number; observations: number; receipts: number; allocations: number; history: number};
  files: PaymentFileSelection[];
}
export interface PaymentDetailRows {
  returns: PaymentReturnBrief; observations: PaymentObservation; receipts: Receipt; allocations: Allocation; history: HistoryEntry;
}
export type PaymentDetailPage<V extends keyof PaymentDetailRows = keyof PaymentDetailRows> =
  ReceivablesPage<PaymentDetailRows[V]> & PaymentDetailMetadata & {view: V} &
  (V extends 'observations' ? {returnId: string; transaction: string; proofFile: PaymentProofFileSelection} : object);

export type DocumentFileName = 'invoice.json' | 'invoice.csv' | 'invoice.html' | 'credit.json' | 'credit.csv' |
  'credit.html' | 'manifest.json' | 'status.json';
export interface DocumentFileSelection {kind: 'receivables-document'; documentId: string; file: DocumentFileName}
export interface QuoteFileSelection {
  kind: 'receivables-quote'; invoiceId: string; file: 'quote.json' | 'response.json' | 'source.json' | 'review.json';
}
export interface PreviewFileSelection {
  kind: 'receivables-preview'; invoiceId: string; file: 'preview.json' | 'preview.csv' | 'preview.html';
}
export type PaymentFileName = 'payment-request.json' | 'payment-request.html' | 'payment-request.uri' | 'status.json' | 'receiving.json';
export interface PaymentProofFileSelection {
  kind: 'receivables-payment'; paymentRequestId: string; returnId: string; file: 'proof.json';
}
export type PaymentFileSelection =
  {kind: 'receivables-payment'; paymentRequestId: string; file: PaymentFileName; returnId?: never} | PaymentProofFileSelection;
export interface CustomerFileSelection {
  kind: 'receivables-customer'; customerId: string; asOf?: DateOnly;
  file: 'account.json' | 'invoices.csv' | 'account.html' | 'manifest.json' | 'account.tar' | `documents/${string}`;
}

export interface RefundDetailArguments { refundId: string; asOf?: DateOnly }
export interface RefundCancelArguments extends CancelRefundInput { refundId: string }
export interface RefundReverseArguments extends ReverseRefundInput { refundId: string }
export interface RefundReturnArguments extends ReportRefundReturnInput { refundId: string }
export interface RefundReceiveArguments extends ReceiveRefundInput { refundId: string }
export interface RefundFileSelection { kind: 'receivables-refund'; refundId: string; file: RefundFileName }

export interface BankImportDetailArguments extends BankImportQuery {bankImportId: string}
export interface BankPostingPreviewArguments extends BankPostingPreviewInput {bankImportId: string}
export interface BankReceiptsPostArguments extends PostBankReceiptsInput {bankImportId: string}
export interface BankRowsIgnoreArguments extends IgnoreBankRowsInput {bankImportId: string}
export interface BankRowsRestoreArguments extends RestoreBankRowsInput {bankImportId: string}
export interface BankImportCloseArguments extends CloseBankImportInput {bankImportId: string}
export interface BankFileSelection {kind: 'receivables-bank'; bankImportId: string; file: BankFileName}

export type ReceivablesFileSelection = DocumentFileSelection | QuoteFileSelection | PreviewFileSelection |
  PaymentFileSelection | CustomerFileSelection | RefundFileSelection | BankFileSelection;
export interface ReceivablesFileMetadata extends FileMetadata {name: string; type?: string}
export interface ReceivablesFileIdentity<S extends ReceivablesFileSelection = ReceivablesFileSelection>
  extends ReceivablesFileMetadata {selection: S}
export interface ReceivablesFileOptions {expectedSha256?: string; chunkBytes?: number; signal?: AbortSignal}
export interface ReceivablesFileChunk {
  readId: string; offset: number; encoding: 'base64'; data: string; bytesRead: number; nextOffset: number | null;
  file: ReceivablesFileMetadata; bytes: Uint8Array; complete: boolean;
}
export interface ReceivablesFileDrain {workspace: string; released: true; activeFileReads: number}

export interface ReceivablesMutationResult extends MutationResult {
  invoice?: InvoiceSummary; receipt?: Receipt; credit?: CreditRecord; allocation?: Allocation; issuer?: Issuer;
  paymentRequest?: PaymentRequestSummary; paymentReturn?: PaymentReturnReference;
  refund?: RefundSummary; refundReturn?: RefundReturn; creditDisposition?: CreditDispositionRecord;
  invoices?: InvoiceSummary[]; allocations?: Allocation[]; receipts?: Receipt[];
  bankAccount?: BankAccount; bankImport?: BankImportSummary; bankPosting?: BankPostingSummary;
}
export type PaymentRequestMutationResult = ReceivablesMutationResult & {
  invoice: InvoiceSummary; paymentRequest: PaymentRequestSummary;
};
export type PaymentReturnMutationResult = PaymentRequestMutationResult & {paymentReturn: PaymentReturnReference};
export type RequestLookupResult =
  {workspace: string; found: false; requestId: string; revision: Revision} |
  ({workspace: string; found: true; requestId: string} & ReceivablesMutationResult);
export interface RequestLookupArguments {requestId: string; asOf?: DateOnly}
export interface ReceivablesArgumentsMap {
  status: StatusArguments; settings: Issuer & MutationContext; draft_save: DraftSaveArguments;
  quote_import: QuoteImportArguments; invoice_preview: InvoicePreviewArguments; invoice_issue: InvoiceIssueArguments;
  invoice_detail: InvoiceDetailArguments; invoice_void: InvoiceVoidArguments; credit: CreditArguments;
  receipt_record: ReceiptInput; receipt_void: ReceiptVoidArguments; settlement_ledger: LedgerQuery;
  settlement_import: SettlementReceiptInput; allocate: AllocateInput; release: ReleaseArguments;
  customer_export: CustomerExportArguments; payment_preview: PaymentPreviewArguments; payment_create: PaymentCreateArguments;
  payment_list: PaymentListArguments; payment_detail: PaymentDetailArguments; payment_cancel: PaymentCancelArguments;
  payment_return: PaymentReturnArguments; payment_receive: PaymentReceiveArguments; request_lookup: RequestLookupArguments;
  customer_funds: CustomerFundsQuery; refund_preview: RefundPreviewInput; refund_commit: CommitRefundInput;
  refund_list: RefundQuery; refund_detail: RefundDetailArguments; refund_cancel: RefundCancelArguments;
  refund_reverse: RefundReverseArguments; refund_return: RefundReturnArguments; refund_receive: RefundReceiveArguments;
  credit_disposition_preview: CreditDispositionPreviewInput; credit_disposition_apply: ApplyCreditDispositionInput;
  bank_accounts: BankAccountsQuery; bank_account_save: BankAccountInput;
  bank_source_inspect: BankSourceInspectionInput; bank_source_import: BankSourceImportInput;
  bank_import_list: BankImportsQuery; bank_import_detail: BankImportDetailArguments;
  bank_posting_preview: BankPostingPreviewArguments; bank_receipts_post: BankReceiptsPostArguments;
  bank_rows_ignore: BankRowsIgnoreArguments; bank_rows_restore: BankRowsRestoreArguments; bank_import_close: BankImportCloseArguments;
}
export interface ReceivablesResultsMap {
  status: StatusResult; settings: ReceivablesMutationResult & {issuer: Issuer};
  draft_save: ReceivablesMutationResult & {invoice: InvoiceSummary}; quote_import: ReceivablesMutationResult & {invoice: InvoiceSummary};
  invoice_preview: InvoicePreviewSummary | InvoicePreviewPage; invoice_issue: ReceivablesMutationResult & {invoice: InvoiceSummary};
  invoice_detail: InvoiceDetailSummary | InvoiceDetailPage; invoice_void: ReceivablesMutationResult & {invoice: InvoiceSummary};
  credit: ReceivablesMutationResult & {credit: CreditRecord; invoice: InvoiceSummary};
  receipt_record: ReceivablesMutationResult & {receipt: Receipt}; receipt_void: ReceivablesMutationResult & {receipt: Receipt};
  settlement_ledger: LedgerPage; settlement_import: ReceivablesMutationResult & {receipt: Receipt};
  allocate: ReceivablesMutationResult & {allocation: Allocation; invoice: InvoiceSummary; receipt: Receipt};
  release: ReceivablesMutationResult & {allocation: Allocation; invoice: InvoiceSummary; receipt: Receipt};
  customer_export: CustomerExportSummary; payment_preview: PaymentRequestPreview; payment_create: PaymentRequestMutationResult;
  payment_list: PaymentList; payment_detail: PaymentDetailSummary | PaymentDetailPage;
  payment_cancel: PaymentRequestMutationResult; payment_return: PaymentReturnMutationResult; payment_receive: PaymentReturnMutationResult;
  request_lookup: RequestLookupResult;
  customer_funds: CustomerFunds; refund_preview: RefundPreview; refund_commit: RefundMutationResult;
  refund_list: RefundPage; refund_detail: RefundDetail; refund_cancel: RefundMutationResult;
  refund_reverse: RefundMutationResult; refund_return: RefundReturnMutationResult; refund_receive: RefundReturnMutationResult;
  credit_disposition_preview: CreditDispositionPreview; credit_disposition_apply: CreditDispositionMutationResult;
  bank_accounts: BankAccountsPage; bank_account_save: BankAccountMutationResult;
  bank_source_inspect: BankSourceInspection; bank_source_import: BankImportMutationResult;
  bank_import_list: BankImportsPage; bank_import_detail: BankImportDetail;
  bank_posting_preview: BankPostingPreview; bank_receipts_post: BankPostingMutationResult;
  bank_rows_ignore: BankImportMutationResult; bank_rows_restore: BankImportMutationResult; bank_import_close: BankImportMutationResult;
}
export type ReceivablesOperation = keyof ReceivablesArgumentsMap;
export type ReceivablesMutation = 'settings' | 'draft_save' | 'quote_import' | 'invoice_issue' | 'invoice_void' | 'credit' |
  'receipt_record' | 'receipt_void' | 'settlement_import' | 'allocate' | 'release' |
  'payment_create' | 'payment_cancel' | 'payment_return' | 'payment_receive' |
  'refund_commit' | 'refund_cancel' | 'refund_reverse' | 'refund_return' | 'refund_receive' | 'credit_disposition_apply' |
  'bank_account_save' | 'bank_source_import' | 'bank_receipts_post' | 'bank_rows_ignore' | 'bank_rows_restore' | 'bank_import_close';
export type ReceivablesPagedOperation = 'status' | 'invoice_preview' | 'invoice_detail' | 'settlement_ledger' | 'payment_list' | 'payment_detail' | 'refund_list' | 'bank_accounts' | 'bank_import_list' | 'bank_import_detail';
export type ReceivablesAllRows<K extends ReceivablesPagedOperation> =
  K extends 'status' ? StatusRows[keyof StatusRows] : K extends 'invoice_preview' ? InvoiceLine :
  K extends 'invoice_detail' ? InvoiceDetailRows[keyof InvoiceDetailRows] : K extends 'settlement_ledger' ? LedgerItem :
  K extends 'payment_list' ? PaymentRequestSummary : K extends 'payment_detail' ? PaymentDetailRows[keyof PaymentDetailRows] :
  K extends 'bank_accounts' ? BankAccount : K extends 'bank_import_list' ? BankImportSummary :
  K extends 'bank_import_detail' ? BankImportRows[BankImportView] : RefundSummary;
export type ReceivablesAllResult<K extends ReceivablesPagedOperation> =
  (K extends 'refund_list' ? RefundInventory : K extends 'bank_accounts' ? BankAccountsInventory :
    K extends 'bank_import_list' ? BankImportsInventory : K extends 'bank_import_detail' ? BankImportInventory :
    ReceivablesInventory<ReceivablesAllRows<K>>) & NativeRecord;
export const ACCOUNTING_RECEIVABLES_METHODS: Readonly<{
  status: 'status'; saveSettings: 'settings'; saveDraft: 'draft_save'; importQuote: 'quote_import';
  invoicePreviewSummary: 'invoice_preview'; issueInvoice: 'invoice_issue'; invoice: 'invoice_detail';
  voidInvoice: 'invoice_void'; issueCredit: 'credit'; recordReceipt: 'receipt_record'; voidReceipt: 'receipt_void';
  settlementLedger: 'settlement_ledger'; importSettlement: 'settlement_import'; allocate: 'allocate';
  releaseAllocation: 'release'; customerExport: 'customer_export'; previewPaymentRequest: 'payment_preview';
  createPaymentRequest: 'payment_create'; paymentRequests: 'payment_list'; paymentRequest: 'payment_detail';
  cancelPaymentRequest: 'payment_cancel'; reportPaymentReturn: 'payment_return'; receivePaymentRequest: 'payment_receive';
  lookupOperation: 'request_lookup'; customerFunds: 'customer_funds'; previewRefund: 'refund_preview';
  commitRefund: 'refund_commit'; refunds: 'refund_list'; refund: 'refund_detail'; cancelRefund: 'refund_cancel';
  reverseRefund: 'refund_reverse'; reportRefundReturn: 'refund_return'; receiveRefund: 'refund_receive';
  previewCreditDisposition: 'credit_disposition_preview'; applyCreditDisposition: 'credit_disposition_apply';
  bankAccounts: 'bank_accounts'; saveBankAccount: 'bank_account_save'; inspectBankSource: 'bank_source_inspect';
  importBankSource: 'bank_source_import'; bankImports: 'bank_import_list'; bankImport: 'bank_import_detail';
  previewBankPosting: 'bank_posting_preview'; postBankReceipts: 'bank_receipts_post'; ignoreBankRows: 'bank_rows_ignore';
  restoreBankRows: 'bank_rows_restore'; closeBankImport: 'bank_import_close';
}>;
export const ACCOUNTING_RECEIVABLES_MUTATIONS: readonly ReceivablesMutation[];
export function accountingReceivablesArguments<K extends ReceivablesMutation>(
  kind: K, value: ReceivablesArgumentsMap[K],
): ReceivablesArgumentsMap[K];
export function accountingInvoicePreview(preview: CompleteInvoicePreview): CompleteInvoicePreview;
export function accountingInvoiceIssueArguments(
  preview: CompleteInvoicePreview, identity: {actor: string; requestId: string},
): InvoiceIssueArguments;
export function accountingPaymentRequestPreview(preview: PaymentRequestPreview): PaymentRequestPreview;
export function accountingPaymentRequestArguments(
  preview: PaymentRequestPreview, identity: {actor: string; requestId: string},
): PaymentCreateArguments;


export function accountingRefundPreview(preview: RefundPreview): RefundPreview;
export function accountingRefundArguments(
  preview: RefundPreview, identity: {actor: string; requestId: string},
): CommitRefundInput;
export function accountingCreditDispositionPreview(preview: CreditDispositionPreview): CreditDispositionPreview;
export function accountingCreditDispositionArguments(
  preview: CreditDispositionPreview, identity: {actor: string; requestId: string},
): ApplyCreditDispositionInput;

/** Validate the complete original proposal, balance effects, revision and combined review seal. */
export function accountingBankPostingPreview(preview: BankPostingPreview): BankPostingPreview;
export function accountingBankPostingArguments(
  preview: BankPostingPreview, identity: {actor: string; requestId: string},
): BankReceiptsPostArguments;

/** One caller connection; disconnect drains its reads, closeWorkspace explicitly closes the original owner. */
export interface AccountingReceivablesClient {
  readonly workspace: string; readonly endpoint?: string;
  open(options?: ReceivablesCallOptions): Promise<NativeRecord>;
  sources(options?: ReceivablesCallOptions): Promise<NativeRecord>;
  callOperation<K extends ReceivablesOperation>(
    kind: K, args: ReceivablesArgumentsMap[K], options?: ReceivablesCallOptions,
  ): Promise<ReceivablesResultsMap[K]>;
  status(args?: StatusArguments & {view?: 'summary'}, options?: ReceivablesCallOptions): Promise<ReceivablesStatusSummary>;
  status<V extends keyof StatusRows>(args: StatusArguments & {view: V}, options?: ReceivablesCallOptions): Promise<StatusPage<V>>;
  saveSettings(args: ReceivablesArgumentsMap['settings'], options?: ReceivablesCallOptions): Promise<ReceivablesResultsMap['settings']>;
  saveDraft(args: DraftSaveArguments, options?: ReceivablesCallOptions): Promise<ReceivablesResultsMap['draft_save']>;
  importQuote(args: QuoteImportArguments, options?: ReceivablesCallOptions): Promise<ReceivablesResultsMap['quote_import']>;
  invoicePreviewSummary(args: InvoicePreviewArguments & {view?: 'summary'}, options?: ReceivablesCallOptions): Promise<InvoicePreviewSummary>;
  invoicePreviewSummary(args: InvoicePreviewArguments & {view: 'lines'}, options?: ReceivablesCallOptions): Promise<InvoicePreviewPage>;
  previewInvoice(args: {invoiceId: string}, options?: ReceivablesCallOptions): Promise<CompleteInvoicePreview>;
  issueInvoice(args: InvoiceIssueArguments, options?: ReceivablesCallOptions): Promise<ReceivablesResultsMap['invoice_issue']>;
  invoice(args: InvoiceDetailArguments & {view?: 'summary'}, options?: ReceivablesCallOptions): Promise<InvoiceDetailSummary>;
  invoice<V extends keyof InvoiceDetailRows>(args: InvoiceDetailArguments & {view: V}, options?: ReceivablesCallOptions): Promise<InvoiceDetailPage<V>>;
  voidInvoice(args: InvoiceVoidArguments, options?: ReceivablesCallOptions): Promise<ReceivablesResultsMap['invoice_void']>;
  issueCredit(args: CreditArguments, options?: ReceivablesCallOptions): Promise<ReceivablesResultsMap['credit']>;
  recordReceipt(args: ReceiptInput, options?: ReceivablesCallOptions): Promise<ReceivablesResultsMap['receipt_record']>;
  voidReceipt(args: ReceiptVoidArguments, options?: ReceivablesCallOptions): Promise<ReceivablesResultsMap['receipt_void']>;
  settlementLedger(args: LedgerQuery, options?: ReceivablesCallOptions): Promise<LedgerPage>;
  importSettlement(args: SettlementReceiptInput, options?: ReceivablesCallOptions): Promise<ReceivablesResultsMap['settlement_import']>;
  allocate(args: AllocateInput, options?: ReceivablesCallOptions): Promise<ReceivablesResultsMap['allocate']>;
  releaseAllocation(args: ReleaseArguments, options?: ReceivablesCallOptions): Promise<ReceivablesResultsMap['release']>;
  customerExport(args: CustomerExportArguments, options?: ReceivablesCallOptions): Promise<CustomerExportSummary>;
  previewPaymentRequest(args: PaymentPreviewArguments, options?: ReceivablesCallOptions): Promise<PaymentRequestPreview>;
  createPaymentRequest(args: PaymentCreateArguments, options?: ReceivablesCallOptions): Promise<PaymentRequestMutationResult>;
  paymentRequests(args?: PaymentListArguments, options?: ReceivablesCallOptions): Promise<PaymentList>;
  paymentRequest(args: PaymentDetailArguments & {view?: 'summary'}, options?: ReceivablesCallOptions): Promise<PaymentDetailSummary>;
  paymentRequest<V extends keyof PaymentDetailRows>(
    args: PaymentDetailArguments & {view: V}, options?: ReceivablesCallOptions,
  ): Promise<PaymentDetailPage<V>>;
  cancelPaymentRequest(args: PaymentCancelArguments, options?: ReceivablesCallOptions): Promise<PaymentRequestMutationResult>;
  reportPaymentReturn(args: PaymentReturnArguments, options?: ReceivablesCallOptions): Promise<PaymentReturnMutationResult>;
  receivePaymentRequest(args: PaymentReceiveArguments, options?: ReceivablesCallOptions): Promise<PaymentReturnMutationResult>;

  customerFunds(args?: CustomerFundsQuery, options?: ReceivablesCallOptions): Promise<CustomerFunds>;
  previewRefund(args: RefundPreviewInput, options?: ReceivablesCallOptions): Promise<RefundPreview>;
  commitRefund(args: CommitRefundInput, options?: ReceivablesCallOptions): Promise<RefundMutationResult>;
  refunds(args?: RefundQuery, options?: ReceivablesCallOptions): Promise<RefundPage>;
  refund(args: RefundDetailArguments, options?: ReceivablesCallOptions): Promise<RefundDetail>;
  cancelRefund(args: RefundCancelArguments, options?: ReceivablesCallOptions): Promise<RefundMutationResult>;
  reverseRefund(args: RefundReverseArguments, options?: ReceivablesCallOptions): Promise<RefundMutationResult>;
  reportRefundReturn(args: RefundReturnArguments, options?: ReceivablesCallOptions): Promise<RefundReturnMutationResult>;
  receiveRefund(args: RefundReceiveArguments, options?: ReceivablesCallOptions): Promise<RefundReturnMutationResult>;
  refundFile(args: {refundId: string; file: RefundFileName}, options?: ReceivablesFileOptions & {maximumBytes?: number}):
    Promise<{bytes: Uint8Array; file: ReceivablesFileMetadata}>;
  previewCreditDisposition(args: CreditDispositionPreviewInput, options?: ReceivablesCallOptions): Promise<CreditDispositionPreview>;
  applyCreditDisposition(args: ApplyCreditDispositionInput, options?: ReceivablesCallOptions): Promise<CreditDispositionMutationResult>;
  bankAccounts(args?: BankAccountsQuery, options?: ReceivablesCallOptions): Promise<BankAccountsPage>;
  saveBankAccount(args: BankAccountInput, options?: ReceivablesCallOptions): Promise<BankAccountMutationResult>;
  inspectBankSource(args: BankSourceInspectionInput, options?: ReceivablesCallOptions): Promise<BankSourceInspection>;
  importBankSource(args: BankSourceImportInput, options?: ReceivablesCallOptions): Promise<BankImportMutationResult>;
  bankImports(args?: BankImportsQuery, options?: ReceivablesCallOptions): Promise<BankImportsPage>;
  bankImport<V extends BankImportView = BankImportView>(
    args: BankImportDetailArguments & {view?: V}, options?: ReceivablesCallOptions,
  ): Promise<BankImportDetail<V>>;
  previewBankPosting(args: BankPostingPreviewArguments, options?: ReceivablesCallOptions): Promise<BankPostingPreview>;
  postBankReceipts(args: BankReceiptsPostArguments, options?: ReceivablesCallOptions): Promise<BankPostingMutationResult>;
  ignoreBankRows(args: BankRowsIgnoreArguments, options?: ReceivablesCallOptions): Promise<BankImportMutationResult>;
  restoreBankRows(args: BankRowsRestoreArguments, options?: ReceivablesCallOptions): Promise<BankImportMutationResult>;
  closeBankImport(args: BankImportCloseArguments, options?: ReceivablesCallOptions): Promise<BankImportMutationResult>;
  bankImportFile(args: {bankImportId: string; file: BankFileName}, options?: ReceivablesFileOptions & {maximumBytes?: number}):
    Promise<{bytes: Uint8Array; file: ReceivablesFileMetadata}>;
  lookupOperation(args: RequestLookupArguments, options?: ReceivablesCallOptions): Promise<RequestLookupResult>;
  /** Every page must retain the original revision, total and accounting date. */
  listAll<K extends ReceivablesPagedOperation>(
    kind: K, args: Omit<ReceivablesArgumentsMap[K], 'offset' | 'limit'>, options?: ReceivablesCallOptions,
  ): Promise<ReceivablesAllResult<K>>;
  /** Read the original journal; configured quote aliases reconcile against archived exact source bytes. */
  reconcileOperation<K extends ReceivablesMutation>(
    kind: K, args: ReceivablesArgumentsMap[K], options?: ReceivablesCallOptions,
  ): Promise<RequestLookupResult>;
  fileChunks(selection: ReceivablesFileSelection, options?: ReceivablesFileOptions): AsyncGenerator<ReceivablesFileChunk>;
  fileBytes(selection: ReceivablesFileSelection, options?: ReceivablesFileOptions & {maximumBytes?: number}):
    Promise<{bytes: Uint8Array; file: ReceivablesFileMetadata}>;
  registerFileRead(readId: string): {workspace: string; readId: string};
  releaseFile(readId: string, options?: ReceivablesCallOptions): Promise<NativeRecord>;
  drainFileReads(): Promise<ReceivablesFileDrain>;
  disconnect(): Promise<ReceivablesFileDrain>;
  closeWorkspace(options?: ReceivablesCallOptions): Promise<NativeRecord>;
}
export function createAccountingReceivablesClient(options: {
  workspace: string; call: ReceivablesCall;
}): AccountingReceivablesClient;
export function connectAccountingReceivablesClient(
  options: ReceivablesConnectionOptions,
): Promise<AccountingReceivablesClient & {readonly endpoint: string}>;
