export class PaymentPlansApiError extends Error {
  constructor(message: string, options?: {status?: number; code?: string; details?: unknown; requestId?: string | null; response?: unknown});
  status: number; code: string; details: unknown; requestId: string | null; response: unknown;
}
export interface Currency { code: string; scale: number; }
export interface PlanFilters { asOf?: string; through?: string; customerId?: string; }
export interface InstallmentDraft { id?: string; dueDate: string; amount: string; label?: string; }
export interface PaymentPlanDraft {
  id?: string; invoiceId: string; balanceDate: string; title: string; reference?: string;
  customerNote?: string; installments: InstallmentDraft[];
}
export interface NormalizedPaymentPlanDraft extends PaymentPlanDraft {
  currency: Currency; total: string; reference: string; customerNote: string;
  installments: Array<InstallmentDraft & {id: string}>;
}
export interface InstallmentProjection extends InstallmentDraft {
  id: string; paid: string; credited: string; remaining: string; status: string;
}
export interface PaymentPlanProjection {
  id: string; planId?: string; version: number; status: 'DRAFT' | 'ACTIVE' | 'CANCELLED';
  collectionStatus: 'DRAFT' | 'FUTURE' | 'CANCELLED' | 'ACTIVE' | 'OVERDUE' |
    'REPLAN_REQUIRED' | 'SATISFIED' | 'INVOICE_CLOSED';
  invoiceId: string; invoiceNumber: string; customerId: string; customerName: string;
  currency: Currency; asOf: string; effectiveDate?: string; title: string; reference: string; customerNote?: string;
  hasDraftChanges: boolean; editionId: string | null; installments: InstallmentProjection[];
  scheduledOutstanding: string; unscheduledAmount: string; overdueAmount: string;
  nextDueDate: string | null; baselineChanged: boolean;
}
export interface InvoiceBalance {
  id: string; number: string | null; version: number; status: string; issued: boolean;
  customerId: string; customerName: string; currency: Currency; issueDate: string; dueDate: string;
  total: string; paid: string; credited: string; balance: string; amountDue: string;
  creditBalance: string; paymentStatus: string; overdueDays: number; voidDate: string | null; asOf: string;
}
export interface CurrencyCollections {
  currency: Currency; amountDue: string; overdue: string; dueToday: string; upcoming: string;
  afterHorizon: string; unscheduled: string; creditBalance: string; invoices: number;
}
export interface CollectionInstallment extends InstallmentProjection {
  planId: string; editionId: string; invoiceId: string; invoiceNumber: string;
  customerId: string; customerName: string; currency: Currency; bucket: string;
}
export interface UnscheduledInvoice {
  invoiceId: string; invoiceNumber: string; customerId: string; customerName: string;
  currency: Currency; amount: string; originalDueDate: string; reason: string; planId?: string;
}
export interface CollectionsReport {
  schema: string; asOf: string; through: string; customerId: string | null;
  currencies: CurrencyCollections[]; installments: CollectionInstallment[];
  unplanned: UnscheduledInvoice[]; plans: PaymentPlanProjection[];
}
export interface PaymentPlansState {
  schema: string; workspaceId: string; revision: number; asOf: string; through: string;
  customers: Array<{id: string; name?: string; displayName?: string; [key: string]: unknown}>;
  invoices: InvoiceBalance[]; plans: PaymentPlanProjection[]; report: CollectionsReport;
}
export interface ScheduleEdition {
  id: string; editionNumber: number; effectiveDate: string; createdAt: string; actor: string;
  reviewSha256: string; total: string; currency: Currency; reference: string;
  files: Record<ScheduleFileName, {bytes: number; sha256: string; type: string}>;
}
export interface PaymentPlanDetail {
  workspaceId: string; revision: number; plan: PaymentPlanProjection; draft: NormalizedPaymentPlanDraft;
  editions: ScheduleEdition[]; history: Array<Record<string, unknown>>; ledger: unknown;
}
export interface PaymentPlanReview {
  workspaceId: string; revision: number; reviewSha256: string; effectiveDate: string;
  planId: string; planVersion: number;
  source: {
    invoiceId: string; invoiceNumber: string; invoiceSha256: string; invoiceVersion: number;
    balanceDate: string; customer: unknown; issuer: unknown; currency: Currency;
    issueDate: string; originalDueDate: string; total: string; paid: string; credited: string;
    amountDue: string; allocations: unknown[]; credits: unknown[];
  };
  schedule: PaymentPlanDraft & {currency: Currency; total: string};
}
export interface MutationContext { revision: number; actor: string; requestId: string; workspaceId?: string; }
export interface SavePaymentPlan extends MutationContext { plan: PaymentPlanDraft; expectedVersion?: number; }
export interface ActivatePaymentPlan extends MutationContext { expectedVersion: number; reviewSha256: string; }
export interface CancelPaymentPlan extends MutationContext { expectedVersion: number; cancelledDate: string; reason: string; }
export interface PaymentPlanOperation {
  id: string; action: string; actor: string; at: string; intentSha256: string;
  result: {planId: string; editionId?: string}; replayed: boolean;
}
export interface PaymentPlanMutation {
  workspaceId: string; revision: number; plan: PaymentPlanProjection; draft: NormalizedPaymentPlanDraft;
  edition?: ScheduleEdition; operation: PaymentPlanOperation;
}
export interface GeneratePaymentPlan {
  invoiceId: string; balanceDate: string; firstDueDate: string; count: number;
  /** Fixed-day interval; defaults to 30 when neither interval is supplied. */
  intervalDays?: number;
  /** Calendar-month interval, from 1 to 120; mutually exclusive with intervalDays. */
  intervalMonths?: number;
  /** Calendar months only. END_OF_MONTH requires the first due date to be month-end. */
  monthAnchor?: 'DAY_OF_MONTH' | 'END_OF_MONTH';
  title?: string; reference?: string; customerNote?: string;
}
export interface PaymentPlansClientOptions { baseUrl?: string; fetch?: typeof fetch; }
export type ScheduleFileName = 'schedule.json' | 'schedule.csv' | 'schedule.html' | 'manifest.json';
export type CollectionsFileName = 'collections.json' | 'collections.csv';
export class PaymentPlansClient {
  constructor(options?: PaymentPlansClientOptions);
  baseUrl: string; fetch: typeof fetch;
  request(path: string, options?: {method?: string; body?: unknown; signal?: AbortSignal; binary?: boolean}): Promise<any>;
  state(filters?: PlanFilters): Promise<PaymentPlansState>;
  detail(id: string, filters?: Pick<PlanFilters, 'asOf'>): Promise<PaymentPlanDetail>;
  generate(value: GeneratePaymentPlan): Promise<{workspaceId: string; revision: number; draft: NormalizedPaymentPlanDraft}>;
  savePlan(value: SavePaymentPlan): Promise<PaymentPlanMutation>;
  previewPlan(id: string): Promise<PaymentPlanReview>;
  activate(id: string, value: ActivatePaymentPlan): Promise<PaymentPlanMutation>;
  cancelPlan(id: string, value: CancelPaymentPlan): Promise<PaymentPlanMutation>;
  getOperation(requestId: string): Promise<PaymentPlanMutation | {workspaceId: string; revision: number; operation: null}>;
  scheduleFile(id: string, editionId: string, name: ScheduleFileName): Promise<Response>;
  collectionsFiles(filters?: PlanFilters): Promise<{report: CollectionsReport; revision: number; files: Array<{name: string; type: string; bytes: number}>}>;
  collectionsFile(name: CollectionsFileName, filters?: PlanFilters): Promise<Response>;
}
export function createPaymentPlansClient(options?: PaymentPlansClientOptions): PaymentPlansClient;
