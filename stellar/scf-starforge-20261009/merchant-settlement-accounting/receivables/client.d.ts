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
  receivedDate: DateOnly; method: string; reference: string; note: string; status: 'RECORDED' | 'VOID';
  voidDate?: DateOnly | null; sourceKey: string; source: {kind: string; runId?: string; eventId?: string; [key: string]: unknown};
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
  id: string; action: string; actor: string; at: string; intentSha256: string; replayed: boolean;
  result: {invoiceId?: string; receiptId?: string; creditId?: string; allocationId?: string; settings?: boolean};
}
export interface MutationResult { revision: Revision; operation: Operation }
export interface Preview { document: InvoiceDocument; previewSha256: string; expectedVersion: number; revision: Revision }
export interface CreditInput extends MutationContext {
  creditDate: DateOnly; reason: string; lines: Array<{invoiceLineId: string; netAmount: Money; taxAmount: Money}>;
}
export interface ReceiptInput extends MutationContext {
  customerId: string; currency: Currency; amount: Money; receivedDate: DateOnly; method: string; reference: string; note?: string;
}
export interface SettlementReceiptInput extends MutationContext {
  customerId: string; runId: string; eventId: string; currency: Currency; amount: Money; receivedDate: DateOnly; valuationNote: string;
  reference?: string; note?: string;
}
export interface AllocateInput extends MutationContext { invoiceId: string; receiptId: string; amount: Money; allocatedDate: DateOnly }
export interface LedgerQuery { runId: string; customerId: string; offset?: number; limit?: number }
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
export interface ClientOptions { baseUrl?: string; fetch?: typeof fetch }
export class ReceivablesApiError extends Error {
  status: number; code: string; details: unknown; requestId: string | null; response: unknown;
}
export class ReceivablesClient {
  constructor(options?: ClientOptions);
  state(query?: {asOf?: DateOnly}): Promise<ReceivablesState>;
  settings(value: Issuer & MutationContext): Promise<MutationResult & {issuer: Issuer}>;
  saveDraft(value: SaveDraft): Promise<MutationResult & {invoice: InvoiceSummary}>;
  importQuote(value: QuoteImportInput): Promise<MutationResult & {invoice: InvoiceSummary}>;
  quoteFile(id: string, name: 'quote.json' | 'response.json' | 'source.json' | 'review.json'): Promise<Response>;
  detail(id: string, query?: {asOf?: DateOnly}): Promise<InvoiceDetail>;
  preview(id: string): Promise<Preview>;
  issue(id: string, value: MutationContext & {expectedVersion: number; previewSha256: string}): Promise<MutationResult & {invoice: InvoiceSummary}>;
  voidInvoice(id: string, value: MutationContext & {voidDate: DateOnly; reason: string}): Promise<MutationResult & {invoice: InvoiceSummary}>;
  credit(id: string, value: CreditInput): Promise<MutationResult & {credit: CreditRecord; invoice: InvoiceSummary}>;
  receipt(value: ReceiptInput): Promise<MutationResult & {receipt: Receipt}>;
  importSettlement(value: SettlementReceiptInput): Promise<MutationResult & {receipt: Receipt}>;
  allocate(value: AllocateInput): Promise<MutationResult & {allocation: Allocation; invoice: InvoiceSummary; receipt: Receipt}>;
  release(id: string, value: MutationContext & {releasedDate: DateOnly; reason: string}): Promise<MutationResult & {allocation: Allocation; invoice: InvoiceSummary; receipt: Receipt}>;
  voidReceipt(id: string, value: MutationContext & {voidDate: DateOnly; reason: string}): Promise<MutationResult & {receipt: Receipt}>;
  ledger(query: LedgerQuery): Promise<LedgerPage>;
  exportCustomer(customerId: string, query?: {asOf?: DateOnly}): Promise<CustomerExport>;
  customerFile(customerId: string, name: 'account.tar' | 'account.json' | 'account.html' | 'invoices.csv' | 'manifest.json', query?: {asOf?: DateOnly}): Promise<Response>;
  file(id: string, name: 'invoice.json' | 'invoice.html' | 'invoice.csv' | 'manifest.json' | 'status.json' | 'credit.json' | 'credit.html' | 'credit.csv'): Promise<Response>;
}
export function createReceivablesClient(options?: ClientOptions): ReceivablesClient;
