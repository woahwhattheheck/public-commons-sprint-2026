/** Complete original service-agreement mutation and HTTP client contracts. */
export type DateOnly = string;
export type Money = string;
export type Revision = number;
export type AgreementStatus = 'ACTIVE' | 'ENDED' | 'CANCELLED';
export type BillingStatus = 'UPCOMING' | 'DUE' | 'PREPARING' | 'DRAFT' | 'ISSUED' | 'VOID';
export type InvoiceTiming = 'START' | 'END';
export type ExportFormat = 'tar' | 'json' | 'csv' | 'html';
export interface Currency { code: string; scale: number }
export interface Customer {
  id: string; name: string; reference?: string; email?: string; address?: string;
  version?: number; [key: string]: unknown;
}
export interface MutationContext { revision: Revision; actor: string; requestId: string; workspaceId?: string }
export interface ExistingAgreementMutation extends MutationContext { expectedVersion: number }
export interface BillingTerms { billingMonths?: number; invoiceTiming?: InvoiceTiming; dueDays?: number }
/** The optional handover is the complete original accepted SF74 renewal JSON, retained byte-for-byte. */
export interface AcceptedQuotation { quoteContent: string; responseContent: string; renewalJson?: string }
export interface ServiceTermsReference { id: string; revision: number; sha256: string }
export interface ServiceRenewalFinancialJoin {
  caseId: string; caseRevision: string; agreementId: string;
  sourceTerms: ServiceTermsReference; proposedContinuation: ServiceTermsReference;
  activeTerms: ServiceTermsReference | null; quoteId: string | null; quoteSha256: string | null;
  acceptanceId: string | null; acceptedAt: string | null;
}
/** Identities validated from the retained complete renewal handover and exact quotation/response bytes. */
export interface AgreementRenewalSource {
  sha256: string; acceptedHead: ServiceTermsReference; financialJoin: ServiceRenewalFinancialJoin;
  servicePeriod: {effectiveFrom: string; effectiveUntil: string | null};
}
export interface CreateAgreement extends MutationContext, BillingTerms, AcceptedQuotation {
  reference: string; title: string; customerId: string; startDate: DateOnly;
  termMonths: number; currencyScale?: number;
}
export interface AmendAgreement extends ExistingAgreementMutation, BillingTerms, AcceptedQuotation {
  effectiveDate: DateOnly; reason: string;
}
export interface RenewAgreement extends ExistingAgreementMutation { additionalMonths: number; reason: string }
export interface CancelAgreement extends ExistingAgreementMutation { effectiveDate: DateOnly; reason: string }
export interface BillAgreement extends ExistingAgreementMutation { periodId: string; previewSha256: string }
/** Bind the current preview revision and workspace ID when continuing this staged operation. */
export type BillingRecoveryRequest = Omit<BillAgreement, 'revision' | 'workspaceId'>;
export interface HistoryEntry {
  action: string; actor: string; at: string; requestId?: string; revision?: number;
  details?: Record<string, unknown>; [key: string]: unknown;
}
export interface PreviousInvoice {
  billingId: string; invoiceId: string | null; number: string | null;
  status: 'PREPARING' | 'DRAFT' | 'ISSUED' | 'VOID';
}
export interface BillingPeriod {
  id: string; startMonth: number; endMonth: number; startDate: DateOnly; endDate: DateOnly;
  periodCount: number; issueDate: DateOnly; dueDate: DateOnly; editionId: string; sourceId: string;
  currency: Currency; amount: Money; status: BillingStatus; due: boolean; canPrepare: boolean;
  invoiceId: string | null; invoiceNumber: string | null; billingId: string | null;
  billingRequestId: string | null; previousInvoices: PreviousInvoice[];
}
export interface AgreementEdition {
  id: string; fromMonth: number; effectiveDate: DateOnly; billingMonths: number;
  invoiceTiming: InvoiceTiming; dueDays: number; sourceId: string;
  quote: {id: string; sha256: string; title: string; [key: string]: unknown};
  response: {sha256?: string; status?: string; [key: string]: unknown};
  renewal?: AgreementRenewalSource;
  createdAt: string; actor: string; reason: string; currency: Currency;
  amountsByPeriods: Record<string, Money>;
  [key: string]: unknown;
}
export interface AgreementBilling {
  id: string; requestId: string; periodId: string; actor: string;
  invoiceId?: string | null; previewSha256?: string; expectedVersion?: number;
  status?: 'PREPARING' | 'DRAFT' | 'ISSUED' | 'VOID';
  preparedAt?: string; completedAt?: string | null; [key: string]: unknown;
}
export interface AgreementSummary {
  id: string; reference: string; title: string; customerId: string; customerName: string;
  version: number; startDate: DateOnly; endDate: DateOnly; termMonths: number;
  status: AgreementStatus; periods: BillingPeriod[]; [key: string]: unknown;
}
export interface Agreement extends AgreementSummary {
  editions: AgreementEdition[]; history: HistoryEntry[]; billings: AgreementBilling[];
}
export interface ServiceAgreementState {
  schema: string; workspaceId: string; revision: Revision; asOf: DateOnly;
  customers: Customer[]; agreements: AgreementSummary[]; history: HistoryEntry[];
}
export interface AgreementDetail {
  workspaceId: string; revision: Revision; asOf: DateOnly; agreement: Agreement; periods: BillingPeriod[];
}
export interface InvoiceLine {
  id: string; description: string; quantity: string; unitAmount: Money; subtotal: Money;
  discountAmount: Money; netAmount: Money; taxAmount: Money; total: Money;
}
export interface InvoiceTotals { subtotal: Money; discount: Money; net: Money; tax: Money; total: Money }
export interface InvoiceDraft {
  customerId: string; currency: Currency; issueDate: DateOnly; dueDate: DateOnly;
  purchaseOrder?: string; note?: string; lines: InvoiceLine[]; totals: InvoiceTotals;
  replacesId?: string | null; sourceReference?: string; [key: string]: unknown;
}
export interface InvoiceSummary {
  id: string; number: string | null; status: 'DRAFT' | 'ISSUED' | 'VOID'; version: number;
  customerId: string; customerName: string; currency: Currency; issueDate: DateOnly; dueDate: DateOnly;
  total: Money; paid: Money; credited: Money; balance: Money; amountDue: Money; creditBalance: Money;
  paymentStatus: 'DRAFT' | 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'CREDIT_BALANCE' | 'VOID' | 'FUTURE';
  overdueDays: number; voidDate: DateOnly | null; asOf: DateOnly; [key: string]: unknown;
}
export interface AgreementPreview {
  workspaceId: string; revision: Revision; agreementId: string; agreementVersion: number;
  period: BillingPeriod; invoiceDraft: InvoiceDraft; quoteReview: Record<string, unknown>;
  previewSha256: string; recoveryRequest?: BillingRecoveryRequest;
}
export interface AgreementOperation {
  id?: string; requestId?: string; action: string; actor: string; at: string;
  intentSha256?: string; replayed?: boolean; result?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface AgreementMutationResult {
  workspaceId: string; revision: Revision; agreementId: string;
  agreement: Agreement; operation: AgreementOperation;
}
export interface AgreementBillResult extends AgreementMutationResult { invoice: InvoiceSummary }
export interface RequestOptions { signal?: AbortSignal }
export interface DatedOptions extends RequestOptions { asOf?: DateOnly }
export interface PreviewOptions extends DatedOptions { periodId: string }
export interface ExportOptions extends DatedOptions { format?: ExportFormat }
export interface DownloadedAgreementFile { name: string; type: string; bytes: Uint8Array }
export interface ServiceAgreementClientOptions { baseUrl?: string; fetch?: typeof globalThis.fetch }
export interface PreparedAgreementBillingDetails {
  agreementBillingPrepared: true; billingId: string; requestId: string; [key: string]: unknown;
}
export interface ServiceAgreementClientErrorOptions {
  status?: number; code?: string; details?: unknown; uncertain?: boolean; reopenRequired?: boolean;
  method?: string; url?: string; requestId?: string | null; response?: unknown; cause?: unknown;
}
export class ServiceAgreementClientError extends Error {
  constructor(message: string, options?: ServiceAgreementClientErrorOptions);
  status: number; code: string; details: unknown; uncertain: boolean; reopenRequired: boolean;
  method: string; url: string; requestId: string | null; billingId: string | null; response: unknown;
}
export interface ServiceAgreementClient {
  readonly baseUrl: string;
  state(options?: DatedOptions): Promise<ServiceAgreementState>;
  detail(id: string, options?: DatedOptions): Promise<AgreementDetail>;
  preview(id: string, options: PreviewOptions): Promise<AgreementPreview>;
  create(body: CreateAgreement, options?: RequestOptions): Promise<AgreementMutationResult>;
  amend(id: string, body: AmendAgreement, options?: RequestOptions): Promise<AgreementMutationResult>;
  renew(id: string, body: RenewAgreement, options?: RequestOptions): Promise<AgreementMutationResult>;
  cancel(id: string, body: CancelAgreement, options?: RequestOptions): Promise<AgreementMutationResult>;
  bill(id: string, body: BillAgreement, options?: RequestOptions): Promise<AgreementBillResult>;
  sourceFile(id: string, sourceId: string, name: string, options?: RequestOptions): Promise<DownloadedAgreementFile>;
  exportAgreement(id: string, options?: ExportOptions): Promise<DownloadedAgreementFile>;
}
export function createServiceAgreementClient(options?: ServiceAgreementClientOptions): Readonly<ServiceAgreementClient>;
