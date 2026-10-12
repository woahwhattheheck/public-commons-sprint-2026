// MIT. Shared native refund and credit-disposition contracts for HTTP and MCP consumers.
import type {
  Allocation, AgingCurrency, Currency, Customer, DateOnly, HistoryEntry, InvoiceSummary,
  Money, MutationContext, MutationResult, PaymentTransferVerification, Receipt,
  StellarPaymentAsset, StellarPaymentAssetInput, StellarPaymentMemo, StellarPaymentNetwork
} from './client.d.ts';

export type RefundStatus = 'AWAITING_TRANSFER' | 'RECORDED' | 'CANCELLED' | 'REVERSED';
export type RefundEffectiveStatus = 'FUTURE' | 'RECORDED' | 'REVERSED' | 'CANCELLED' | 'RESERVED' | 'TESTNET_OBSERVATION';
export type RefundAccountingScope = 'COMMERCIAL' | 'TESTNET_OBSERVATION';
export interface CustomerFundsQuery { customerId?: string; asOf?: DateOnly }
export interface RefundFundingInput { allocationId: string; amount: Money; replacementAllocationId?: string | null }
export interface RefundFundingProposal extends RefundFundingInput {
  invoiceId: string; invoiceNumber: string; originalAmount: Money; allocatedDate: DateOnly;
  originalSha256: string; invoiceSha256: string; previousReleasedDate: DateOnly | null;
  replacementAmount: Money; replacementReleasedDate: DateOnly | null; replacementAllocationId: string | null;
}
export interface RefundOperatorPayoutInput {
  kind: 'OPERATOR_RECORDED'; method: string; reference: string; refundDate: DateOnly;
  /** Link a corrected record after the original dated reversal. */
  replacesRefundId?: string | null;
}
export interface RefundStellarPayoutInput {
  kind: 'STELLAR_TRANSFER'; sourceAccount: string; destination: string; network: StellarPaymentNetwork;
  asset: StellarPaymentAssetInput; stellarAmount: string; valuationNote: string; msg?: string;
  originalRefundId?: never; originalReturnId?: never;
}
export interface RefundAdoptedStellarPayoutInput {
  kind: 'STELLAR_TRANSFER'; originalRefundId: string; originalReturnId: string; valuationNote: string;
  /** The native preview derives the exact original verified transfer terms. */
  sourceAccount?: never; destination?: never; network?: never; asset?: never; stellarAmount?: never;
}
export interface RefundAdjustmentPayoutInput {
  kind: 'ORIGINAL_STELLAR_ADJUSTMENT'; adjustmentId: string; valuationNote: string;
}
export type RefundPayoutInput = RefundOperatorPayoutInput | RefundStellarPayoutInput |
  RefundAdoptedStellarPayoutInput | RefundAdjustmentPayoutInput;
export interface RefundPreviewInput {
  id?: string; receiptId: string; amount: Money; effectiveDate: DateOnly; reason: string; customerNote?: string;
  funding: RefundFundingInput[]; payout: RefundPayoutInput;
}
export interface CreditDispositionAllocationInput { invoiceId: string; amount: Money; allocationId?: string }
export interface CreditDispositionPreviewInput {
  id?: string; receiptId: string; effectiveDate: DateOnly; reason: string; customerNote?: string;
  funding: RefundFundingInput[]; allocations: CreditDispositionAllocationInput[];
}
export interface RefundBalanceEffects {
  asOf: DateOnly; receipt: {before: Receipt; after: Receipt};
  invoices: Array<{invoiceId: string; invoiceNumber: string; before: InvoiceSummary; after: InvoiceSummary}>;
}
export interface RefundReceiptSnapshot {
  id: string; customerId: string; reference: string; method: string; receivedDate: DateOnly;
  currency: Currency; amount: Money; sourceKind: string | null; sourceKey: string;
}
/** Preserve this complete native proposal; its fingerprints bind the original allocation state. */
export interface CustomerAdjustmentProposal {
  id: string; receiptId: string; customerId: string; customer: Customer; receipt: RefundReceiptSnapshot; currency: Currency;
  effectiveDate: DateOnly; reason: string; customerNote: string; funding: RefundFundingProposal[];
  receiptSha256: string; allocationStateSha256: string; refundStateSha256: string;
}
export interface RefundOperatorPayout extends Omit<RefundOperatorPayoutInput, 'replacesRefundId'> {
  replacesRefundId?: string | null; accountingDate: DateOnly;
  [key: string]: unknown;
}
export interface RefundStellarPayout {
  kind: 'STELLAR_TRANSFER'; sourceAccount: string; destination: string; network: StellarPaymentNetwork;
  networkPassphrase?: string; asset: StellarPaymentAsset; stellarAmount: string; amountAtomic: string;
  memo: StellarPaymentMemo; valuationNote: string; walletHandoff: boolean; uri: string | null;
  refundDate?: DateOnly | null; accountingDate?: DateOnly | null; originalRefundId?: string; originalReturnId?: string;
  transaction?: string; transactionFingerprint?: string; proofSha256?: string;
  [key: string]: unknown;
}
export interface RefundAdjustmentPayout extends RefundAdjustmentPayoutInput {
  refundDate?: DateOnly; accountingDate?: DateOnly | null; transaction?: string; [key: string]: unknown;
}
export type RefundPayout = RefundOperatorPayout | RefundStellarPayout | RefundAdjustmentPayout;
export interface RefundProposal extends CustomerAdjustmentProposal {
  schema: 'stellar-forge.merchant-receivables-refund-proposal.v1';
  amount: Money; payout: RefundPayout; accountingScope: RefundAccountingScope;
  [key: string]: unknown;
}
export interface CreditDispositionAllocation extends CreditDispositionAllocationInput {
  invoiceNumber: string; invoiceSha256: string; allocationId: string;
}
export interface CreditDispositionProposal extends CustomerAdjustmentProposal {
  schema: 'stellar-forge.merchant-receivables-credit-disposition.v1';
  accountingScope: 'COMMERCIAL'; allocations: CreditDispositionAllocation[]; released: Money; allocated: Money;
  [key: string]: unknown;
}
export interface RefundPreview {
  revision: number; proposal: RefundProposal; reviewSha256: string; balanceEffects: RefundBalanceEffects;
}
export interface CreditDispositionPreview {
  revision: number; proposal: CreditDispositionProposal; reviewSha256: string; balanceEffects: RefundBalanceEffects;
}
export interface CommitRefundInput extends MutationContext { proposal: RefundProposal; reviewSha256: string }
export interface ApplyCreditDispositionInput extends MutationContext { proposal: CreditDispositionProposal; reviewSha256: string }
export interface CancelRefundInput extends MutationContext { cancelledDate: DateOnly; reason: string }
export interface ReverseRefundInput extends MutationContext { reversedDate: DateOnly; reason: string }
export interface ReportRefundReturnInput extends MutationContext { transaction: string; note?: string }
export interface ReceiveRefundInput extends MutationContext { returnId: string }
export interface RefundSummary {
  id: string; customerId: string; customerName: string; receiptId: string; receiptReference: string;
  currency: Currency; amount: Money; status: RefundStatus; effectiveStatus: RefundEffectiveStatus;
  kind: RefundPayout['kind']; accountingScope: RefundAccountingScope; effectiveDate: DateOnly;
  refundDate: DateOnly | null; accountingDate: DateOnly | null; replacesRefundId: string | null; cancelledDate: DateOnly | null; reversedDate: DateOnly | null;
  createdAt: string; returnCount: number; reserved: Money; refunded: Money;
  reference: string | null; transaction: string | null; asOf: DateOnly;
}
export interface RefundQuery extends CustomerFundsQuery {
  receiptId?: string; status?: RefundStatus; offset?: number; limit?: number;
}
export interface RefundPage {
  schema: 'stellar-forge.merchant-customer-refunds.v1'; revision: number; asOf: DateOnly;
  total: number; offset: number; limit: number; refunds: RefundSummary[];
}
export type RefundInventory = Omit<RefundPage, 'offset' | 'limit'>;
export type RefundObservationStatus = 'RECORDED' | 'TESTNET_VERIFIED' | 'TRANSFER_PRECEDES_REQUEST' |
  'TRANSFER_PRECEDES_FUNDING' | 'ADDITIONAL_TRANSFER' | 'REFUND_SOURCE_CONFLICT' | 'REFUND_FUNDS_CONFLICT' |
  'VERIFICATION_UNAVAILABLE' | 'FAILED' | 'NOT_FOUND';
export interface RefundObservation {
  id: string; recordedAt: string; actor: string; status: RefundObservationStatus;
  verification: PaymentTransferVerification | null; error?: {code: string; message: string};
  [key: string]: unknown;
}
export interface RefundReturn {
  id: string; transaction: string; note: string; reportedAt: string; actor: string;
  observations: RefundObservation[]; resolvedRefundId?: string | null;
}
export type RefundFileName = 'request.json' | 'request.html' | 'request.csv' |
  'refund.json' | 'refund.html' | 'refund.csv' | 'reversal.json' | 'reversal.html' | 'reversal.csv' |
  'disposition.json' | 'disposition.html' | 'disposition.csv' |
  'status.json' | 'receiving.json' | `proof-${string}.json`;
export interface RefundFileMetadata { sha256: string; bytes: number; type: string }
export interface RefundDownload { name: RefundFileName; type: string; bytes: Uint8Array }
export interface RefundDetail {
  schema: 'stellar-forge.merchant-customer-refunds.v1'; revision: number; asOf: DateOnly;
  refund: RefundSummary; proposal: RefundProposal; returns: RefundReturn[]; history: HistoryEntry[];
  files: Partial<Record<RefundFileName, RefundFileMetadata>>; balanceEffects: RefundBalanceEffects;
}
export interface RefundMutationResult extends MutationResult {
  refund: RefundSummary; receipt: Receipt; invoices: InvoiceSummary[]; allocations?: Allocation[];
  refundReturn?: RefundReturn;
}
export interface RefundReturnMutationResult extends RefundMutationResult { refundReturn: RefundReturn }
export interface CreditDispositionRecord {
  id: string; customerId: string; customerName: string; receiptId: string; receiptReference: string;
  currency: Currency; effectiveDate: DateOnly; released: Money; allocated: Money; unappliedAfter: Money;
  createdAt: string; allocationIds: string[]; invoiceIds: string[];
}
export interface CreditDispositionMutationResult extends MutationResult {
  creditDisposition: CreditDispositionRecord; receipt: Receipt; invoices: InvoiceSummary[]; allocations: Allocation[];
}
export interface CustomerFundsCurrency extends AgingCurrency { reservedRefunds: Money; refundedPayments: Money }
export interface CustomerFundsReceipt extends Receipt { availableToRefund: Money }
export interface CustomerFundsFunding {
  allocationId: string; receiptId: string; receiptReference: string; invoiceId: string; invoiceNumber: string;
  customerId: string; currency: Currency; amount: Money; allocatedDate: DateOnly;
  invoiceCreditBalance: Money; refundableAmount: Money; scheduledReleaseDate: DateOnly | null;
}
export interface CustomerFundsAdjustment {
  adjustmentId: string; receiptId: string; network: StellarPaymentNetwork; asset: StellarPaymentAsset;
  amountAtomic: string; transaction: string; transferAt: string; sourceAccount: string; destination: string;
  [key: string]: unknown;
}
export interface CustomerFundsRefundReturn {
  originalRefundId: string; originalReturnId: string; observationId: string; receiptId: string;
  network: 'stellar:pubnet'; sourceAccount: string; destination: string; asset: StellarPaymentAsset;
  stellarAmount: string; amountAtomic: string; memo: StellarPaymentMemo; transaction: string;
  transactionFingerprint: string; closedAt: string; ledger: number; amount: Money; currency: Currency;
  verificationScope: string; proofSha256: string; status: string; valuationNote: string; customerNote: string;
}
export interface CustomerFunds {
  schema: 'stellar-forge.merchant-customer-funds.v1'; revision: number; asOf: DateOnly; customer: Customer | null; customers: Customer[];
  currencies: CustomerFundsCurrency[]; receipts: CustomerFundsReceipt[]; eligibleFunding: CustomerFundsFunding[];
  targetInvoices: InvoiceSummary[]; availableAdjustments: CustomerFundsAdjustment[];
  availableRefundReturns: CustomerFundsRefundReturn[];
}
