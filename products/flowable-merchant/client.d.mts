/** Installed client of the original Flowable workspace and its complete native source/history deliveries. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type RecordKind = 'connection' | 'portfolio' | 'release' | 'process' | 'task' | 'migration' | 'delivery' | 'receiving';
export type OperationKind = 'release' | 'process' | 'task' | 'migration';
export type CollectionKind = 'deployments' | 'definitions' | 'processes' | 'tasks'
  | 'historicProcesses' | 'historicTasks' | 'historicActivities' | 'historicVariables';
export type FlowableState = 'SAVED' | 'CAPTURING' | 'CAPTURED' | 'COMPLETED' | 'PREPARING' | 'PREPARED'
  | 'INVALID' | 'DISPATCHED' | 'READBACK' | 'CONFIRMED' | 'ACCEPTED' | 'OBSERVED' | 'REJECTED'
  | 'UNKNOWN' | 'STALE' | 'PREPARE_FAILED' | 'INTERRUPTED' | 'EXPORTED' | 'INSPECTED' | 'ADOPTING' | 'ADOPTED';
export interface FlowableConnection {
  schema?: 'stellar-forge.flowable-connection.v1';
  /** Human alias. The saved connection separately has a 24-hex record ID. */
  id: string;
  label?: string;
  /** Complete original REST service base, including its actual context path. */
  baseUrl: string;
  /** Names of existing host environment variables. Their values are never retained in the connection. */
  usernameEnv: string;
  passwordEnv: string;
}
export interface SourceReference { sha256: string; bytes: number; mediaType?: string }
export interface RecordReference { kind: RecordKind; id: string; revision: number; sha256: string }
export interface NativeEntity { id: string; [key: string]: Json | undefined }
export interface NativeResource {
  definitionId?: string; deploymentId?: string; filename: string; contentType?: string;
  bytes: number; sha256: string; contentBase64?: string;
  definitionRef?: SourceReference; originalResource?: SourceReference; [key: string]: unknown;
}
export interface NativeResponse {
  id?: string; status: number; statusText?: string; ok: boolean;
  bodyBytes: number; bodySha256: string; reference?: SourceReference; json?: Json; bodyText?: string;
}
export interface FlowableRecord<Value = Record<string, unknown>> extends RecordReference {
  schema: 'stellar-forge.flowable-workspace.v1';
  requestId: string; requestSha256: string; createdAt: string; updatedAt: string; bytes: number; value: Value;
  portfolio?: { startedAt: string; completedAt: string;
    collections: Record<CollectionKind, { total: number; retained: number; complete: boolean; pages: number }>;
    resources: number };
  plan?: NativeRequestPlan;
  reconciliation?: NativeReconciliation;
  validation?: NativeResponse;
  response?: NativeResponse;
}
export interface RecordSummary extends RecordReference {
  schema: 'stellar-forge.flowable-workspace.v1';
  createdAt: string; updatedAt: string; label: string; state: FlowableState; phase?: string;
  summary?: Record<string, unknown>; connectionId?: string;
}
export interface RecordPage {
  snapshot: string; offset: number; limit: number; total: number; nextOffset: number | null; items: RecordSummary[];
}
export interface WorkspaceView {
  schema: 'stellar-forge.flowable-workspace.v1'; workspaceId: string; directory: string; createdAt: string;
  closing: boolean;
  connections: (RecordSummary & { connection: FlowableConnection; configurationSha256: string; credentialAvailable: boolean })[];
  counts: Record<RecordKind, number>; capabilities: Record<string, Json>;
}
export interface Paging { offset?: number; limit?: number }
export interface ListRecordsInput extends Paging { kind?: RecordKind; snapshot?: string }
export interface GetRecordInput extends Paging { kind: RecordKind; id: string; revision?: number }
export interface ReadPortfolioInput extends Paging { id: string; revision?: number; collection: CollectionKind }
export interface PortfolioPage extends Paging {
  portfolio: RecordReference; collection: CollectionKind; offset: number; limit: number;
  items: NativeEntity[]; total: number; nativeTotal: number; complete: boolean;
  pages: unknown[]; exchanges: unknown[]; nextOffset: number | null;
}
export interface RequestIdentity { requestId: string }
export interface SaveConnectionInput extends RequestIdentity {
  connection: FlowableConnection; id?: string; expectedRevision?: number;
}
export interface CapturePortfolioInput extends RequestIdentity { connectionId: string; label?: string }
export interface DeploymentSelection {
  action: 'deploy'; deploymentName?: string; deploymentKey?: string; tenantId?: string;
  /** Complete original BPMN or native deployment archive, encoded without modifying its bytes. */
  resource: { filename: string; contentType?: string; contentBase64: string };
}
export interface ProcessSelection {
  action: 'start';
  /** Exact native JSON text selecting the definition, business key, tenant and variables. */
  bodyText: string;
}
export interface TaskSelection {
  action: 'claim' | 'complete' | 'delegate' | 'resolve'; taskId: string;
  /** Exact native JSON text. Its action must equal the selected action. */
  bodyText: string;
}
export interface MigrationSelection {
  action: 'migrate'; processInstanceId: string;
  /** Original Flowable migration document. Native validation precedes dispatch. */
  bodyText: string;
}
export type FlowableSelection = DeploymentSelection | ProcessSelection | TaskSelection | MigrationSelection;
export interface PrepareInput<Selection extends FlowableSelection> extends RequestIdentity {
  connectionId: string; selection: Selection; label?: string; note?: string;
}
export type PrepareReleaseInput = PrepareInput<DeploymentSelection>;
export type PrepareProcessInput = PrepareInput<ProcessSelection>;
export type PrepareTaskInput = PrepareInput<TaskSelection>;
export type PrepareMigrationInput = PrepareInput<MigrationSelection>;
export interface DispatchOperationInput extends RequestIdentity {
  id: string; expectedRevision: number; planSha256: string;
}
export interface ReconcileOperationInput extends RequestIdentity {
  kind: OperationKind; id: string; expectedRevision?: number;
}
export interface ExportWorkspaceInput extends RequestIdentity { label?: string }
/** A local path on the original server. Use inspectDeliveryFile for a file on the client host. */
export interface InspectDeliveryInput extends RequestIdentity { path: string; label?: string }
export interface AdoptDeliveryInput extends RequestIdentity { id: string; expectedRevision: number; manifestSha256: string }
export interface NativeRequestPlan {
  action: FlowableSelection['action'] | 'validateMigration';
  requestSha256: string; connectionId: string; connectionSha256: string;
  method: string; path: string; query?: Record<string, unknown>; contentType?: string;
  bodyBase64?: string; bodyBytes: number; bodySha256: string; readback?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface NativeState {
  connectionId?: string; observedAt?: string;
  definitions?: NativeEntity[]; deployments?: NativeEntity[]; processes?: NativeEntity[];
  historicProcesses?: NativeEntity[]; tasks?: NativeEntity[]; historicTasks?: NativeEntity[];
  activities?: NativeEntity[]; historicActivities?: NativeEntity[]; resources?: NativeResource[];
  [key: string]: unknown;
}
export interface NativeReconciliation {
  state: FlowableState; evidence?: Record<string, unknown>; [key: string]: unknown;
}
export interface OperationValue {
  label: string; note?: string; state: FlowableState; phase: string;
  connectionId: string; connection: FlowableConnection; configurationSha256: string;
  planSha256: string; plan: SourceReference; selection: SourceReference;
  requestBody?: SourceReference; sourceResource?: { filename: string; reference: SourceReference };
  before?: SourceReference; after?: SourceReference; validation?: SourceReference;
  response?: SourceReference; reconciliation?: SourceReference; journal?: SourceReference;
  preparedAt?: string; dispatchedAt?: string; completedAt?: string;
  dispatchRequestId?: string; summary: Record<string, unknown>;
  failure?: { code: string; message: string; outcomeUnknown?: boolean; at: string; exchange?: SourceReference };
  [key: string]: unknown;
}
export interface OperationReview {
  schema: 'stellar-forge.flowable-operation-review.v1';
  record: RecordReference; label: string; note?: string; state: FlowableState; phase: string;
  preparedAt?: string; dispatchedAt?: string; completedAt?: string;
  connection: { id: string; alias?: string; label?: string; baseUrl?: string; configurationSha256: string };
  request: { action: string; method: string; path: string; query?: Record<string, unknown>;
    contentType?: string; bodyBytes: number; bodySha256: string; planSha256: string; bodyText?: string;
    resource?: { filename: string; contentType?: string; bytes?: number; sha256?: string; mediaType?: string };
    deploymentName?: string; deploymentKey?: string; tenantId?: string; processInstanceId?: string; taskId?: string } | null;
  before: NativeState | null; after: NativeState | null;
  validation: NativeResponse | null; response: NativeResponse | null; reconciliation: NativeReconciliation | null;
  failure: OperationValue['failure'] | null;
  originals: { role: string; reference: SourceReference; filename?: string }[];
}
export interface DeliveryValue {
  state: 'PREPARING' | 'EXPORTED'; label: string;
  file?: { bytes: number; sha256: string; [key: string]: unknown };
  snapshot: SourceReference; summary: Record<string, unknown>; [key: string]: unknown;
}
export interface ReceivingValue {
  state: 'INSPECTED' | 'ADOPTING' | 'ADOPTED'; label: string; manifestSha256: string;
  manifest: SourceReference;
  sourceWorkspace: { schema: 'stellar-forge.flowable-workspace.v1'; workspaceId: string; createdAt: string };
  sourceDeliveryId: string; summary: Record<string, unknown>; original: SourceReference; [key: string]: unknown;
}
export interface ActionInputs {
  view: Record<string, never>;
  listRecords: ListRecordsInput;
  getRecord: GetRecordInput;
  readPortfolio: ReadPortfolioInput;
  readDefinition: { portfolioId: string; definitionId: string; revision?: number };
  readSource: { reference: SourceReference };
  readReview: { kind: OperationKind; id: string; revision?: number };
  saveConnection: SaveConnectionInput;
  capturePortfolio: CapturePortfolioInput;
  prepareRelease: PrepareReleaseInput;
  dispatchRelease: DispatchOperationInput;
  prepareProcess: PrepareProcessInput;
  dispatchProcess: DispatchOperationInput;
  prepareTask: PrepareTaskInput;
  dispatchTask: DispatchOperationInput;
  prepareMigration: PrepareMigrationInput;
  dispatchMigration: DispatchOperationInput;
  reconcileOperation: ReconcileOperationInput;
  exportWorkspace: ExportWorkspaceInput;
  inspectDelivery: InspectDeliveryInput;
  adoptDelivery: AdoptDeliveryInput;
}
export interface ActionResults {
  view: WorkspaceView;
  listRecords: RecordPage;
  getRecord: FlowableRecord;
  readPortfolio: PortfolioPage;
  readDefinition: { portfolio: RecordReference; definition: NativeEntity; resources: NativeResource[] };
  readSource: { reference: SourceReference; value: Json } | { reference: SourceReference; contentBase64: string; text?: string };
  readReview: OperationReview;
  saveConnection: FlowableRecord<{ label: string; connection: FlowableConnection; configurationSha256: string; state: 'SAVED' }>;
  capturePortfolio: FlowableRecord;
  prepareRelease: FlowableRecord<OperationValue>;
  dispatchRelease: FlowableRecord<OperationValue>;
  prepareProcess: FlowableRecord<OperationValue>;
  dispatchProcess: FlowableRecord<OperationValue>;
  prepareTask: FlowableRecord<OperationValue>;
  dispatchTask: FlowableRecord<OperationValue>;
  prepareMigration: FlowableRecord<OperationValue>;
  dispatchMigration: FlowableRecord<OperationValue>;
  reconcileOperation: FlowableRecord<OperationValue>;
  exportWorkspace: FlowableRecord<DeliveryValue>;
  inspectDelivery: FlowableRecord<ReceivingValue>;
  adoptDelivery: FlowableRecord<ReceivingValue>;
}
export interface FlowableActionContract { title: string; description: string; write: boolean; inputSchema: Record<string, unknown> }
export const FLOWABLE_WORKSPACE_ACTIONS: Readonly<Record<keyof ActionInputs, FlowableActionContract>>;
export function flowableProductActions(): (FlowableActionContract & { name: keyof ActionInputs })[];
export interface ProductSession {
  schema: 'stellar-forge.flowable-product-session.v1';
  state: 'STARTING' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'FAILED' | 'STOP_UNCONFIRMED';
  productId: string; directory: string; workspaceDirectory: string; instanceId: string; workspaceId: string;
  bindingSha256: string; resourceId: string; sourceSha256: string; connectionFile: string;
  browserUrlFile: string; browserUrl: string; port: number; startedAt: string; endedAt?: string;
}
export interface DownloadReceipt {
  schema: 'stellar-forge.flowable-product-delivery.v1'; state: 'RETAINED';
  productId: string; workspaceId: string; deliveryId: string; deliveryRevision: number;
  recordSha256: string; path: string; bytes: number; sha256: string;
}
export interface RetainedFile {
  path: string; bytes: number; sha256: string; mediaType: string; productId: string; workspaceId: string;
}
export interface ClientOptions {
  directory: string; fetch?: typeof globalThis.fetch; signal?: AbortSignal;
  timeoutMs?: number; expectedWorkspaceId?: string;
}
export interface FlowableRequestError extends Error {
  code?: string; status?: number; requestId?: string; recordId?: string; outcomeUnknown?: boolean;
}
export class FlowableProductClient {
  constructor(options: ClientOptions);
  readonly directory: string;
  connection(): Promise<{ record: ProductSession; origin: string; token: string }>;
  call<Method extends keyof ActionInputs>(method: Method, args: ActionInputs[Method]): Promise<ActionResults[Method]>;
  callToFile<Method extends keyof ActionInputs>(method: Method, args: ActionInputs[Method],
    options: { path: string }): Promise<RetainedFile & { method: Method; requestId?: string }>;
  view(): Promise<WorkspaceView>;
  status(): Promise<WorkspaceView>;
  listRecords(input?: ListRecordsInput): Promise<RecordPage>;
  getRecord(input: GetRecordInput): Promise<FlowableRecord>;
  readPortfolio(input: ReadPortfolioInput): Promise<PortfolioPage>;
  readDefinition(input: ActionInputs['readDefinition']): Promise<ActionResults['readDefinition']>;
  readSource(input: ActionInputs['readSource']): Promise<ActionResults['readSource']>;
  readReview(input: ActionInputs['readReview']): Promise<OperationReview>;
  saveConnection(input: SaveConnectionInput): Promise<ActionResults['saveConnection']>;
  capturePortfolio(input: CapturePortfolioInput): Promise<FlowableRecord>;
  prepareRelease(input: PrepareReleaseInput): Promise<FlowableRecord<OperationValue>>;
  dispatchRelease(input: DispatchOperationInput): Promise<FlowableRecord<OperationValue>>;
  prepareProcess(input: PrepareProcessInput): Promise<FlowableRecord<OperationValue>>;
  dispatchProcess(input: DispatchOperationInput): Promise<FlowableRecord<OperationValue>>;
  prepareTask(input: PrepareTaskInput): Promise<FlowableRecord<OperationValue>>;
  dispatchTask(input: DispatchOperationInput): Promise<FlowableRecord<OperationValue>>;
  prepareMigration(input: PrepareMigrationInput): Promise<FlowableRecord<OperationValue>>;
  dispatchMigration(input: DispatchOperationInput): Promise<FlowableRecord<OperationValue>>;
  reconcileOperation(input: ReconcileOperationInput): Promise<FlowableRecord<OperationValue>>;
  exportWorkspace(input: ExportWorkspaceInput): Promise<FlowableRecord<DeliveryValue>>;
  inspectDelivery(input: InspectDeliveryInput): Promise<FlowableRecord<ReceivingValue>>;
  adoptDelivery(input: AdoptDeliveryInput): Promise<FlowableRecord<ReceivingValue>>;
  downloadDelivery(options: { id: string; path: string; expectedSha256?: string }): Promise<DownloadReceipt>;
  downloadSource(options: { reference: SourceReference; path: string }): Promise<RetainedFile & { reference: SourceReference }>;
  inspectDeliveryFile(options: { requestId: string; path: string; label?: string; expectedSha256?: string }): Promise<FlowableRecord<ReceivingValue>>;
  /** Drain this SDK connection; the original application owner retains its separate lifecycle. */
  close(): Promise<void>;
}
