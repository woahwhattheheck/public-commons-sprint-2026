// MIT. Declarations for the original customer-statement MCP client.
export type NativeRecord = Record<string, unknown>;
export interface StatementCallOptions { requestSignal?: AbortSignal; timeoutMs?: number; }
export type StatementCall = (name: string, args: NativeRecord, options?: StatementCallOptions) => NativeRecord | PromiseLike<NativeRecord>;
export interface StatementConnectionOptions {
  workspace: string; url: string; tokenEnv?: string;
  environment?: Record<string, string | undefined>; signal?: AbortSignal;
}
export interface StatementPageArguments { offset?: number; limit?: number; }
export interface StatementPage<T, K extends string = string> {
  kind: K; items: T[]; total: number; offset: number; limit: number; nextOffset: number | null;
}
export interface StatementInventory<T> { items: T[]; revision: number; }
export interface StatementRevision { revision: number; actor: string; }
export interface CustomerProfile {
  reference: string; name: string; email: string; address: string; note: string;
}
export type CustomerVersionSelection =
  | { id?: never; expectedVersion?: never }
  | { id: string; expectedVersion: number };
export type CustomerSaveInput = StatementRevision & Pick<CustomerProfile, 'reference' | 'name'> &
  Partial<Pick<CustomerProfile, 'email' | 'address' | 'note'>> & CustomerVersionSelection;
export type CustomerSaveArguments = StatementRevision & CustomerProfile & CustomerVersionSelection;
export interface StatementCustomer extends CustomerProfile {
  id: string; version: number; createdAt: string; updatedAt: string; actor: string; orders?: number;
}
export interface CustomerAssignmentInput extends StatementRevision {
  customerId: string; orders: Array<{ orderRef: string; label?: string }>; reassign?: boolean; reason?: string;
}
export interface CustomerAssignmentArguments extends StatementRevision {
  customerId: string; orders: Array<{ orderRef: string; label: string }>; reassign?: boolean; reason: string;
}
export interface CustomerUsageImportArguments extends StatementRevision {
  source: string; expectedSha256: string; name?: string;
}
export interface StatementWithdrawalArguments extends StatementRevision { statementId: string; reason: string; }
export interface StatementInputMap {
  save: CustomerSaveInput; assign: CustomerAssignmentInput;
  usage_import: CustomerUsageImportArguments; withdraw: StatementWithdrawalArguments;
}
export interface StatementArgumentsMap {
  save: CustomerSaveArguments; assign: CustomerAssignmentArguments;
  usage_import: CustomerUsageImportArguments; withdraw: StatementWithdrawalArguments;
}
export type StatementMutationKind = keyof StatementInputMap;
export interface StatementSelection {
  customerId: string; runId: string; usageId?: string | null; replacesId?: string | null;
  from?: string; until?: string; usageOpeningId?: string | null;
}
export interface NormalizedStatementSelection extends StatementSelection { usageId: string | null; replacesId: string | null; usageOpeningId?: string; }
export interface StatementIdentity { requestId: string; actor: string; }
export interface StatementRetentionArguments extends NormalizedStatementSelection, StatementRevision {
  requestId: string; previewSha256: string;
}
export interface StatementUsageImport {
  id: string; name: string; sha256: string; bytes: number; createdAt: string; sourceCreatedAt: string;
  sourceRevision: number | string; sourceSchema: string; orderCount: number; actor: string;
}
export interface StatementServicePassIdentity {
  orderRef: string; eventId: string; routeId: string; method: string; network: string;
  amountAtomic: string; assetDigest: string; recipientDigest: string | null; entitledAt: string;
  planId: string; planRevision: string; planSha256: string; manifestSha256: string; unitsPurchased: string;
}
export type StatementServiceCapture = StatementUsageImport & {
  schema: 'stellar-forge.merchant-service-capture.v1';
} & (
  | { periodEligible: true; periodIdentity: StatementServicePassIdentity; periodIdentitySha256: string;
      pass: StatementServicePassIdentity & StatementServiceBalance & {planLabel: string; callCount: number}; unavailableCode: null; }
  | { periodEligible: false; periodIdentity: null; periodIdentitySha256: null; pass: null;
      unavailableCode: 'COMPLETE_NATIVE_PERIOD_SOURCE_REQUIRED' | 'SERVICE_PERIOD_ENTITLEMENT_REQUIRED'; }
);
export interface StatementUsageSource {
  source: string; sha256: string; bytes: number; sourceSchema: string;
  sourceCreatedAt: string; sourceRevision: number | string; orderCount: number;
}
export interface StatementBinding {
  id: string; orderRef: string; orderReferenceDigest: string; customerId: string; label: string;
  version: number; createdAt: string; updatedAt: string; actor: string; historyCount: number;
}
export interface StatementBindingHistory {
  at: string; actor: string; reason: string; previous: { customerId: string; label: string; version: number };
}
export interface StatementRun extends NativeRecord {
  id: string; name: string; status: 'complete'; createdAt: string; completedAt: string; reportSha256: string;
  period: NativeRecord | null;
}
export interface CustomerStatementState {
  schema: string; revision: number; customerCount: number; usageImportCount: number;
  statementCount: number; bindingCount: number; completedRunCount: number;
}
export interface StatementStateResult { revision: number; customerStatementState: CustomerStatementState; }
export interface StatementStatusRows {
  customers: StatementCustomer; runs: StatementRun; usage: StatementUsageImport; history: NativeRecord;
}
export type StatementStatusView = 'summary' | keyof StatementStatusRows;
export type StatementStatusResult<V extends StatementStatusView = StatementStatusView> =
  V extends keyof StatementStatusRows
    ? StatementStateResult & { page: StatementPage<StatementStatusRows[V], V>; historyScope?: 'ORIGINAL_LATEST_80' }
    : StatementStateResult;
export interface StatementBindingsQuery extends StatementPageArguments { customerId?: string; search?: string; }
export type RetainedStatementStatus = 'RETAINED' | 'SUPERSEDED' | 'WITHDRAWN';
export interface StatementListQuery extends StatementPageArguments { customerId?: string; status?: RetainedStatementStatus; }
export type StatementBaseArtifactName = 'statement.json' | 'statement.csv' | 'usage.csv' | 'statement.html' | 'manifest.json';
export type StatementPeriodArtifactName = 'period.csv' | 'period-summary.csv' | 'usage-opening.json' | 'usage-closing.json';
export type StatementArtifactName = StatementBaseArtifactName | StatementPeriodArtifactName;
export interface StatementFileIdentity { sha256: string; bytes: number; }
export interface StatementFileMetadata extends StatementFileIdentity { name: string; type?: string; }
export interface RetainedStatement {
  id: string; number: string; requestId: string; intentSha256: string; previewSha256: string;
  customerId: string; customerReference: string; customerName: string; runId: string; usageId: string | null;
  createdAt: string; actor: string; status: RetainedStatementStatus; replacesId: string | null; supersededBy: string | null;
  files: Record<StatementBaseArtifactName, StatementFileIdentity> & Partial<Record<StatementPeriodArtifactName, StatementFileIdentity>>;
  usageOpeningId?: string; servicePeriod?: { from: string; until: string; orderRef: string };
  orderCount: number; excludedOrderCount: number; from: string | null; until: string | null; historyCount: number;
}
export type StatementHistory =
  | { at: string; actor: string; action: 'retained' }
  | { at: string; actor: string; action: 'superseded'; statementId: string }
  | { at: string; actor: string; action: 'withdrawn'; reason: string };
export interface StatementUsageSourceIdentity {
  id: string | null; sha256: string | null; sourceSchema: string; createdAt: string; revision: number | string;
}
export interface StatementServiceBalance {
  unitsPurchased: string; unitsUsed: string; unitsReserved: string; unitsRemaining: string;
}
export type StatementServiceCallStatus = 'IN_FLIGHT' | 'RECOVERY_REQUIRED' | 'COMPLETED' | 'CONSUMED' | 'RELEASED';
export interface StatementNativeServiceCall {
  requestId: string; routeId: string; method: string; path: string; requestSha256: string;
  units: string; consumedUnits: string; reservedUnits: string;
  status: StatementServiceCallStatus; storedStatus: StatementServiceCallStatus; revision: number;
  startedAt: string; deadlineAt: string; updatedAt: string; errorCode: string | null;
  result: { status: number; contentType: string; sha256: string; bytes: number } | null;
}
export interface StatementServicePeriodCall extends NativeRecord {
  requestId: string; routeId: string; method: string; path: string; units: string;
  kind: 'NEW_CALL' | 'RESULT_RECOVERED' | 'DURABLE_CHANGE' | 'CARRIED_RESERVATION';
  opening: StatementNativeServiceCall | null; closing: StatementNativeServiceCall;
  admittedUnits: string; consumedUnits: string; releasedUnits: string;
  reservedDeltaUnits: string; availableDeltaUnits: string; resultRecovered: boolean;
}
export interface StatementServicePeriodRoute extends NativeRecord {
  routeId: string; method: string; path: string; routeUnits: string;
  openingCalls: number; closingCalls: number; newCalls: number; changedCalls: number; resultRecoveries: number;
  openingUsedUnits: string; closingUsedUnits: string; openingReservedUnits: string; closingReservedUnits: string;
  admittedUnits: string; consumedUnits: string; releasedUnits: string;
}
export interface StatementServicePeriodTotals {
  openingCalls: number; closingCalls: number; newCalls: number; changedCalls: number; unchangedCalls: number;
  carriedReservations: number; resultRecoveries: number;
  admittedUnits: string; consumedUnits: string; releasedUnits: string; reservedDeltaUnits: string; availableDeltaUnits: string;
}
export interface StatementServicePeriod {
  schema: 'stellar-forge.merchant-service-period.v1'; orderRef: string; eventId: string;
  planId: string; planSha256: string; manifestSha256: string; planLabel: string;
  from: string; until: string; timeBasis: 'COMPLETE_NATIVE_SNAPSHOT_COMPARISON';
  openingSource: StatementUsageSourceIdentity; closingSource: StatementUsageSourceIdentity;
  opening: StatementServiceBalance; closing: StatementServiceBalance; totals: StatementServicePeriodTotals;
  routes: StatementServicePeriodRoute[]; calls: StatementServicePeriodCall[];
}
export interface StatementServicePeriodSummary extends Omit<StatementServicePeriod, 'routes' | 'calls'> {
  counts: { routes: number; calls: number };
}
export interface StatementUsagePeriodSelection { usageOpeningId: string; usageId: string; }
export interface StatementUsagePeriodQuery extends StatementUsagePeriodSelection, StatementPageArguments {
  view?: 'summary' | 'routes' | 'calls';
}
export interface StatementUsagePeriodReport { period: StatementServicePeriod; revision: number; }
export interface StatementUsagePeriodFile extends StatementUsagePeriodSelection, StatementFileIdentity {
  kind: 'customer-usage-period-preview'; file: 'usage-period.json';
}
export interface StatementUsagePeriodSummary {
  period: StatementServicePeriodSummary; periodSha256: string; revision: number;
  page?: StatementPage<StatementServicePeriodRoute | StatementServicePeriodCall, 'routes' | 'calls'>;
  reportFile: StatementUsagePeriodFile;
}
export interface StatementDraft extends NativeRecord {
  schema: 'stellar-forge.merchant-customer-statement.v1';
  customer: Pick<StatementCustomer, 'id' | 'reference' | 'name' | 'email' | 'address' | 'version'>;
  source: {
    runId: string; reportSha256: string; inputManifestSha256: string | null; reportCreatedAt: string;
    originalPeriod: NativeRecord | null;
    usage: StatementUsageSourceIdentity | null; usageOpening?: StatementUsageSourceIdentity;
  };
  selection: {
    from: string | null; until: string | null; timeBasis: 'NATIVE_SETTLEMENT_CAPTURED_AT';
    usageBasis: 'CUMULATIVE_AS_OF_SERVICE_SNAPSHOT' | 'COMPLETE_NATIVE_SNAPSHOT_COMPARISON' | null;
  };
  servicePeriod?: StatementServicePeriod;
  items: NativeRecord[]; excluded: NativeRecord[];
  totals: {
    orders: number; excludedOrders: number; serviceOrders: number; requiringReconciliation: number;
    byAsset: NativeRecord[]; merchantQuotedUsd: { knownOrders: number; unknownOrders: number; knownTotal: string };
  };
}
export interface AccountingStatementPreview {
  intent: NormalizedStatementSelection; draft: StatementDraft; previewSha256: string; revision: number;
}
export interface StatementDocumentSummary extends NativeRecord {
  schema: StatementDraft['schema']; customer: StatementDraft['customer']; source: StatementDraft['source'];
  selection: StatementDraft['selection']; servicePeriod?: StatementServicePeriodSummary;
  totals: Omit<StatementDraft['totals'], 'byAsset'> & { assetCount: number };
  counts: { items: number; excluded: number; assets: number };
}
export type StatementDocumentView = 'summary' | 'items' | 'excluded' | 'assets' | 'calls' | 'adjustments' | 'period-routes' | 'period-calls';
export interface StatementPreviewQuery extends StatementSelection, StatementPageArguments { view?: StatementDocumentView; orderRef?: string; }
export interface StatementDetailQuery extends StatementPageArguments {
  statementId: string; view?: StatementDocumentView | 'history'; orderRef?: string;
}
export interface StatementPreviewFile extends NormalizedStatementSelection, StatementFileIdentity {
  kind: 'customer-statement-preview'; file: 'preview.json';
}
export interface StatementPreviewSummary {
  intent: NormalizedStatementSelection; previewSha256: string; revision: number;
  draft: StatementDocumentSummary; page?: StatementPage<NativeRecord>; previewFile: StatementPreviewFile;
}
export interface StatementDetail {
  statement: RetainedStatement; document: StatementDocumentSummary; revision: number;
  page?: StatementPage<NativeRecord | StatementHistory>;
}
export type StatementLookupResult = { found: false; requestId: string; revision: number } | ({ found: true } & StatementDetail);
export type StatementRetentionResult = StatementDetail & StatementStateResult & { reused: boolean };
export type StatementWithdrawalResult = StatementDetail & StatementStateResult & { statement: RetainedStatement & { status: 'WITHDRAWN' } };
export interface CustomerSaveResult extends StatementStateResult { customer: StatementCustomer; }
export interface CustomerAssignmentResult extends StatementStateResult { assigned: number; changed: number; }
export interface CustomerUsageImportResult extends StatementStateResult { import: StatementUsageImport; reused: boolean; }
export interface CustomerReconciliation {
  found: boolean; customer: StatementCustomer | null; revision: number; match: 'CURRENT_ORIGINAL_PROFILE';
}
export interface AssignmentReconciliation {
  found: boolean; customerId: string; matchedOrders: number; requestedOrders: number; revision: number;
}
export interface UsageReconciliation { found: boolean; import: StatementUsageImport | null; revision: number; }
export type WithdrawalReconciliation =
  | ({ found: false } & StatementDetail)
  | ({ found: true; withdrawal: Extract<StatementHistory, { action: 'withdrawn' }> } & StatementDetail);
/** Existing accounting file kinds remain accepted by the shared retained-file reader. */
export interface OriginalAccountingFileSelection {
  kind: 'response' | 'report' | 'export' | 'collection' | 'pricing' | 'period' | 'accountant' | 'adjustment' | 'qbo' | 'xero';
  recoveryId?: string; runId?: string; exportId?: string; collectionId?: string; sourceId?: string;
  reviewId?: string; closeId?: string; handoffId?: string; revisionId?: string; adjustmentId?: string;
  jobId?: string; planId?: string; responseId?: string; nativePost?: boolean; attemptId?: string; file?: string;
}
export type StatementFileSelection =
  | (StatementUsagePeriodSelection & { kind: 'customer-usage-period-preview'; file: 'usage-period.json' })
  | (StatementSelection & { kind: 'customer-statement-preview'; file: 'preview.json' })
  | { kind: 'customer-statement'; statementId: string; file: StatementArtifactName | 'status.json' }
  | OriginalAccountingFileSelection;
export interface StatementFileOptions { expectedSha256?: string; chunkBytes?: number; signal?: AbortSignal; }
export interface StatementFileChunk {
  readId: string; offset: number; encoding: 'base64'; data: string; bytesRead: number; nextOffset: number | null;
  file: StatementFileMetadata; bytes: Uint8Array; complete: boolean;
}
export interface StatementReaderDrain { workspace: string; released: true; activeFileReads: number; }
export interface AccountingStatementClient {
  readonly workspace: string;
  open(options?: StatementCallOptions): Promise<NativeRecord>;
  status<V extends StatementStatusView = 'summary'>(args?: StatementPageArguments & { view?: V; search?: string }, options?: StatementCallOptions): Promise<StatementStatusResult<V>>;
  sources(options?: StatementCallOptions): Promise<NativeRecord>;
  bindings(args?: StatementBindingsQuery, options?: StatementCallOptions): Promise<StatementPage<StatementBinding, 'bindings'> & { revision: number }>;
  order(args: StatementPageArguments & { orderRef: string }, options?: StatementCallOptions): Promise<{ binding: StatementBinding; page: StatementPage<StatementBindingHistory, 'history'>; revision: number }>;
  statements(args?: StatementListQuery, options?: StatementCallOptions): Promise<StatementPage<RetainedStatement, 'statements'> & { revision: number }>;
  lookup(requestId: string, options?: StatementCallOptions): Promise<StatementLookupResult>;
  allCustomers(options?: StatementCallOptions): Promise<StatementInventory<StatementCustomer>>;
  allUsage(options?: StatementCallOptions): Promise<StatementInventory<StatementUsageImport>>;
  usageCaptures(args?: StatementPageArguments, options?: StatementCallOptions): Promise<{revision: number; page: StatementPage<StatementServiceCapture, 'usage-captures'>}>;
  allUsageCaptures(options?: StatementCallOptions): Promise<StatementInventory<StatementServiceCapture>>;
  allBindings(args?: StatementBindingsQuery, options?: StatementCallOptions): Promise<StatementInventory<StatementBinding>>;
  allStatements(args?: StatementListQuery, options?: StatementCallOptions): Promise<StatementInventory<RetainedStatement>>;
  saveCustomer(value: CustomerSaveInput, options?: StatementCallOptions): Promise<CustomerSaveResult>;
  assign(value: CustomerAssignmentInput, options?: StatementCallOptions): Promise<CustomerAssignmentResult>;
  usageSource(source: string, options?: StatementCallOptions): Promise<StatementUsageSource>;
  importUsage(value: CustomerUsageImportArguments, options?: StatementCallOptions): Promise<CustomerUsageImportResult>;
  usagePeriodSummary(args: StatementUsagePeriodQuery, options?: StatementCallOptions): Promise<StatementUsagePeriodSummary>;
  usagePeriod(args: StatementUsagePeriodSelection, options?: StatementCallOptions): Promise<StatementUsagePeriodReport>;
  previewSummary(args: StatementPreviewQuery, options?: StatementCallOptions): Promise<StatementPreviewSummary>;
  preview(args: StatementSelection, options?: StatementCallOptions): Promise<AccountingStatementPreview>;
  retain(preview: AccountingStatementPreview, identity: StatementIdentity, options?: StatementCallOptions): Promise<StatementRetentionResult>;
  detail(args: StatementDetailQuery, options?: StatementCallOptions): Promise<StatementDetail>;
  withdraw(value: StatementWithdrawalArguments, options?: StatementCallOptions): Promise<StatementWithdrawalResult>;
  reconcileRetention(preview: AccountingStatementPreview, identity: StatementIdentity, options?: StatementCallOptions): Promise<StatementLookupResult>;
  reconcileCustomer(value: CustomerSaveInput, options?: StatementCallOptions): Promise<CustomerReconciliation>;
  reconcileAssignments(value: CustomerAssignmentInput, options?: StatementCallOptions): Promise<AssignmentReconciliation>;
  reconcileUsage(value: CustomerUsageImportArguments, options?: StatementCallOptions): Promise<UsageReconciliation>;
  reconcileWithdrawal(value: StatementWithdrawalArguments, options?: StatementCallOptions): Promise<WithdrawalReconciliation>;
  registerFileRead(readId: string): { workspace: string; readId: string };
  releaseFile(readId: string, options?: StatementCallOptions): Promise<NativeRecord>;
  drainFileReads(): Promise<StatementReaderDrain>;
  fileChunks(selection: StatementFileSelection, options?: StatementFileOptions): AsyncGenerator<StatementFileChunk, void, unknown>;
  disconnect(): Promise<NativeRecord | StatementReaderDrain>;
  closeWorkspace(options?: StatementCallOptions): Promise<NativeRecord | StatementReaderDrain>;
}
export interface ConnectedAccountingStatementClient extends AccountingStatementClient { readonly endpoint: string; }
export function accountingStatementSelection(selection: StatementSelection): NormalizedStatementSelection;
export function accountingStatementPreview<T extends AccountingStatementPreview>(preview: T): T;
export function accountingStatementPreview(preview: unknown): AccountingStatementPreview;
export function accountingStatementRetentionArguments(preview: AccountingStatementPreview, identity: StatementIdentity): StatementRetentionArguments;
export function accountingStatementArguments<K extends StatementMutationKind>(kind: K, value: StatementInputMap[K]): StatementArgumentsMap[K];
export function createAccountingStatementClient(options: { workspace: string; call: StatementCall }): Readonly<AccountingStatementClient>;
export function connectAccountingStatementClient(options: StatementConnectionOptions): Promise<Readonly<ConnectedAccountingStatementClient>>;
