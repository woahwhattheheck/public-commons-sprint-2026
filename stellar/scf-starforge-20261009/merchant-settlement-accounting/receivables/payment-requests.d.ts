import type {
  Allocation, CreditRecord, DateOnly, DocumentFiles, HistoryEntry, InvoiceDocument, InvoiceDraft,
  PaymentRequestDocument, PaymentRequestInput, PaymentRequestProposal, PaymentRequestSummary,
  PaymentReturn, PaymentTransferVerification, Receipt, StellarPaymentAsset, StellarPaymentAssetInput,
  StellarPaymentMemo, StellarPaymentNetwork,
} from './client.js';
export type {
  PaymentRequestInput, PaymentRequestProposal, PaymentRequestSummary, PaymentRequestDocument,
  PaymentReturn, PaymentTransferVerification, StellarPaymentAsset, StellarPaymentAssetInput,
  StellarPaymentMemo, StellarPaymentNetwork,
} from './client.js';
export const PAYMENT_REQUEST_SCHEMA: 'stellar-forge.invoice-payment-request.v1';
export const PAYMENT_PROPOSAL_SCHEMA: 'stellar-forge.invoice-payment-proposal.v1';
export const PAYMENT_TRANSFER_SCHEMA: 'stellar-forge.invoice-stellar-transfer.v1';
export interface StoredPaymentRequest {
  schema: typeof PAYMENT_REQUEST_SCHEMA; id: string; invoiceId: string; customerId: string;
  issuedAt: string; actor: string; proposal: PaymentRequestProposal; reviewSha256: string;
  documentSha256: string; returns: PaymentReturn[]; cancelledAt: string | null;
  cancelledBy?: string; cancellationReason?: string; history: HistoryEntry[];
}
export interface ReceivablesInvoiceRecord {
  id: string; number: string | null; version: number; status: 'DRAFT' | 'ISSUED' | 'VOID';
  draft: InvoiceDraft; document: InvoiceDocument | null; files: DocumentFiles;
  history: HistoryEntry[]; voidDate?: DateOnly | null; [key: string]: unknown;
}
export interface PaymentReceivablesData {
  paymentRequests?: StoredPaymentRequest[]; invoices: ReceivablesInvoiceRecord[];
  receipts: Array<Omit<Receipt, 'allocated' | 'available'>>; allocations: Allocation[];
  credits: CreditRecord[]; [key: string]: unknown;
}
export function timestamp(): string;
export function requestRows(data: {paymentRequests?: StoredPaymentRequest[]}): StoredPaymentRequest[];
export function paymentTimestamp(value: string, name: string): string;
export function stellarAmount(value: string): {amount: string; atomic: string};
export function classicAsset(value: StellarPaymentAssetInput): StellarPaymentAsset;
export function paymentMemo(value?: StellarPaymentMemo, fallback?: StellarPaymentMemo): StellarPaymentMemo;
export function sep7PaymentUri(proposal: Pick<PaymentRequestProposal,
  'destination' | 'stellarAmount' | 'asset' | 'memo' | 'msg' | 'network' | 'networkPassphrase'>): string;
export function paymentDocument(row: StoredPaymentRequest): PaymentRequestDocument;
export function reservedInvoiceAmount(data: PaymentReceivablesData, invoiceId: string,
  network: StellarPaymentNetwork, now?: string, exceptId?: string | null): bigint;
export function compilePaymentProposal(invoice: ReceivablesInvoiceRecord, data: PaymentReceivablesData,
  input: PaymentRequestInput, options?: {now?: string; id?: string}): PaymentRequestProposal;
export function requestTransactionFingerprints(value: unknown): string[];
export function paymentReturnInput(input: {transaction: string; payer?: string | null; note?: string}):
  {transaction: string; payer: string | null; note: string};
export function validatePaymentVerification(proposal: PaymentRequestProposal, returned: PaymentReturn,
  verification: PaymentTransferVerification): PaymentTransferVerification;
export function paymentRequestSummary(row: StoredPaymentRequest, data: PaymentReceivablesData,
  asOf?: DateOnly, observedAt?: string): PaymentRequestSummary;
export function paymentRequestHtml(row: StoredPaymentRequest, data: PaymentReceivablesData): string;
