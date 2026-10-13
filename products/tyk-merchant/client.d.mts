/** Complete installed client of the original Tyk workspace, its immutable records and native deliveries. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type RecordKind = 'connection' | 'capture' | 'cohort' | 'commissioning' | 'rollout' | 'delivery' | 'receiving';
export type TykState = 'IN_PROGRESS' | 'COMPLETE' | 'SAVED' | 'CAPTURING' | 'CAPTURED' | 'PREPARING' | 'PREPARED' | 'DISPATCHED' | 'READBACK'
  | 'CONFIRMED' | 'ACCEPTED' | 'PARTIAL' | 'UNCHANGED' | 'DIVERGED' | 'ABSENT' | 'UNKNOWN' | 'STALE'
  | 'PREPARE_FAILED' | 'INTERRUPTED' | 'EXPORTED' | 'INSPECTED' | 'ADOPTING' | 'ADOPTED';
export interface TykConnection {
  schema?: 'stellar-forge.tyk-connection.v1';
  /** Human connection alias. Saved connection records separately have 24-hex record IDs. */
  id: string;
  label: string;
  kind: 'gateway' | 'dashboard';
  baseUrl: string;
  /** Name of an existing host environment variable; no credential value is saved. */
  authEnv: string;
}
export interface SourceReference { sha256: string; bytes: number; mediaType?: string }
export interface RecordReference { kind: RecordKind; id: string; revision: number; sha256: string }
export interface TykRecord<Value = Record<string, unknown>> extends RecordReference {
  schema: 'stellar-forge.tyk-workspace.v1';
  requestId: string;
  requestSha256: string;
  createdAt: string;
  updatedAt: string;
  bytes: number;
  value: Value;
  portfolio?: { offset: number; limit: number; total: number; nextOffset: number | null; items: ApiSummary[]; [key: string]: unknown };
  plan?: NativeRequestPlan;
  reconciliation?: { state: TykState; evidence?: Record<string, unknown>; [key: string]: unknown };
  response?: { status: number; statusText: string; ok: boolean; bodyBytes: number; bodySha256: string; reference: SourceReference; json?: Json; bodyText?: string };
}
export interface ApiSummary {
  apiId: string;
  kind: 'classic' | 'oas';
  found: boolean;
  sha256?: string;
  bytes?: number;
  summary?: Record<string, unknown>;
  definitionRef?: SourceReference;
}
export interface RecordSummary extends RecordReference {
  schema: 'stellar-forge.tyk-workspace.v1';
  createdAt: string;
  updatedAt: string;
  label: string;
  state: TykState;
  phase?: string;
  summary?: Record<string, unknown>;
  connectionId?: string;
}
export interface RecordPage {
  snapshot: string;
  offset: number;
  limit: number;
  total: number;
  nextOffset: number | null;
  items: RecordSummary[];
}
export interface WorkspaceView {
  schema: 'stellar-forge.tyk-workspace.v1';
  workspaceId: string;
  directory: string;
  createdAt: string;
  closing: boolean;
  connections: (RecordSummary & { connection: TykConnection; configurationSha256: string; credentialAvailable: boolean })[];
  counts: Record<RecordKind, number>;
  capabilities: Record<string, Json>;
}
export interface ReviewValuePreview {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'text';
  sha256: string; semanticSha256: string; bytes: number; preview: Json; truncated: boolean;
}
export interface ReviewChange {
  apiId: string; path: string; category: string; change: 'ADDED' | 'REMOVED' | 'CHANGED';
  before: ReviewValuePreview | null; after: ReviewValuePreview | null;
}
export interface DefinitionReview {
  schema: 'stellar-forge.tyk-definition-review.v1';
  rollout: RecordReference;
  reportSha256: string;
  report: SourceReference;
  stage: 'REQUEST_PREPARED' | 'NATIVE_CONVERSION' | 'CURRENT_READBACK';
  planSha256: string;
  summary: { apis: number; changedApis: number; unchangedApis: number; pendingApis: number;
    changes: number; added: number; removed: number; changed: number; byCategory: Record<string, number> };
  sources: { apiId: string; beforeApiId: string; afterApiId: string;
    relationship: 'SAME_NATIVE_API' | 'CLASSIC_TO_NATIVE_STAGED_COPY';
    before: { state: 'PRESENT' | 'ABSENT' | 'PENDING'; reference?: SourceReference; kind?: string; role?: string };
    after: { state: 'PRESENT' | 'ABSENT' | 'PENDING'; reference?: SourceReference; kind?: string; role?: string };
    comparison: 'LOSSLESS_JSON' | 'COMPLETE_TEXT' | 'AWAITING_NATIVE_DOCUMENT';
    notes: string[]; changeOffset: number; changes: number }[];
  changes: { offset: number; limit: number; total: number; nextOffset: number | null; items: ReviewChange[] };
}
export interface Paging { offset?: number; limit?: number }
export interface ListRecordsInput extends Paging { kind?: RecordKind; snapshot?: string }
export interface GetRecordInput extends Paging { kind: RecordKind; id: string; revision?: number }
export interface RequestIdentity { requestId: string }
export interface SaveConnectionInput extends RequestIdentity { connection: TykConnection; id?: string; expectedRevision?: number }
export interface CaptureInput extends RequestIdentity { connectionId: string; label?: string }
export interface ImportCaptureInput extends CaptureInput { capture: Record<string, unknown> }
export interface CreateCohortInput extends RequestIdentity {
  label: string;
  note?: string;
  captureId: string;
  captureRevision: number;
  apiIds: string[];
  id?: string;
  expectedRevision?: number;
}
export type CommissioningNativeStep = 'conversion' | 'staging' | 'promotion';
export type CommissioningReviewStep = 'conversion-review' | 'production-review';
export type CommissioningStep = CommissioningNativeStep | CommissioningReviewStep | 'staged-capture' | 'final-capture';
export interface CreateCommissioningInput extends RequestIdentity {
  cohortId: string; cohortRevision: number; label: string;
  customer?: string; operator?: string; checkNames: string[];
  /** Complete original customer-selected source; terms remain source, not native or commercial acceptance. */
  workshare?: CommissioningSupportingFile;
  abortOnFailure?: boolean; overrideStaged?: boolean;
}
export interface PrepareCommissioningStepInput extends RequestIdentity {
  id: string; expectedRevision: number; stepId: CommissioningNativeStep;
}
export interface CommissioningCheck {
  apiId: string; name: string; outcome: 'passed' | 'failed'; note: string;
}
export interface CommissioningSupportingFile {
  name: string; mediaType: string; contentBase64: string; note?: string;
}
export interface RecordCommissioningReviewInput extends RequestIdentity {
  id: string; expectedRevision: number; stepId: CommissioningReviewStep;
  contextSha256: string; reviewer: string; note: string;
  checks?: CommissioningCheck[]; files?: CommissioningSupportingFile[];
}
export interface RefreshCommissioningInput extends RequestIdentity {
  id: string; expectedRevision: number; phase: 'staged' | 'final';
}
export interface CommissioningWorkshare {
  source: { id: string; name: string; mediaType: string; bytes: number;
    encoding: 'base64'; content: string; note: string };
  sourceSha256: string; cohort: RecordReference; connectionId: string;
  configurationSha256: string; checkNames: string[];
}
export interface CommissioningValue {
  schema: 'stellar-forge.tyk-commissioning.v1';
  label: string; customer: string; operator: string;
  cohort: RecordReference; connectionId: string; configurationSha256: string;
  checkNames: string[]; abortOnFailure: boolean; overrideStaged: boolean;
  manuscript: SourceReference;
  /** Original source binding returned by the same workspace. */
  workshare: CommissioningWorkshare | null;
  bindings: Partial<Record<CommissioningNativeStep, RecordReference>>;
  reviews: Partial<Record<CommissioningReviewStep, {
    reviewer: string; note: string; checks: CommissioningCheck[]; accepted: boolean;
    contextSha256: string; context: Record<string, unknown>; recordedAt: string;
  }>>;
  supportingFiles: Record<string, unknown[]>;
  observation: RecordReference | null; finalObservation: RecordReference | null;
  pending: Record<string, unknown> | null;
  state: 'IN_PROGRESS' | 'COMPLETE';
  summary: { apis: number; steps: number; completed: number; checks: number };
}
export interface CommissioningObservation {
  phase: 'staged' | 'final'; capture: RecordReference;
  apis: { apiId: string; stagedApiId: string; sha256: string; bytes?: number;
    definitionRef: SourceReference | null; summary: Record<string, unknown> | null }[];
}
export interface CommissioningView {
  record: TykRecord<CommissioningValue>;
  progress: {
    schema: 'stellar-forge.tyk-commissioning.v1'; state: 'IN_PROGRESS' | 'COMPLETE';
    next: CommissioningStep | null;
    summary: { apis: number; steps: number; completed: number; checks: number };
    steps: { id: CommissioningStep; title: string; instruction: string;
      status: 'planned' | 'in-progress' | 'completed'; ready: boolean; complete: boolean;
      record: RecordReference | null; nativeState: TykState | null }[];
  };
  cohort: TykRecord;
  workshare: CommissioningWorkshare | null;
  rollouts: Record<CommissioningNativeStep, TykRecord<RolloutValue> | null>;
  observation: CommissioningObservation | null; finalObservation: CommissioningObservation | null;
  reviewContexts: Partial<Record<CommissioningReviewStep, { context: Record<string, unknown>; sha256: string }>>;
  /** Full original OperatingPlan with every revision and complete supporting file. */
  plan: { schema: 'stellar-forge.operating-plan.v1'; id: string; revisions: unknown[]; [key: string]: unknown };
}

export type MigrationSelection = {
  operation: 'migrate';
  apiIds: string[];
  abortOnFailure: boolean;
} & (
  { mode: 'stage'; overrideStaged: boolean } |
  { mode: 'dryRun' | 'promote' | 'direct'; overrideStaged: false }
);
export interface VersionQuery {
  base_api_id?: string;
  base_api_version_name?: string;
  new_version_name?: string;
  set_default?: boolean;
  /** Dashboard OAS create/import only; exact native capitalization. */
  templateID?: string;
}
export interface ImportQuery extends VersionQuery {
  upstreamURL?: string;
  listenPath?: string;
  customDomain?: string;
  allowList?: boolean;
  validateRequest?: boolean;
  mockResponse?: boolean;
  authentication?: boolean;
}
export type DefinitionSelection =
  { operation: 'create'; kind: 'classic' | 'oas'; definitionText: string; contentType?: 'application/json' | 'application/x-yaml'; apiId?: string; query?: VersionQuery } |
  { operation: 'import'; kind: 'oas'; definitionText: string; contentType?: 'application/json' | 'application/x-yaml'; apiId?: string; query?: ImportQuery } |
  { operation: 'update'; kind: 'classic' | 'oas'; apiId: string; definitionText: string; contentType?: 'application/json' | 'application/x-yaml'; query?: Record<string, never> };
export type ReloadSelection =
  { operation: 'hotReload'; scope: 'node'; block?: boolean } |
  { operation: 'hotReload'; scope: 'group'; block?: never };
export type TykSelection = MigrationSelection | DefinitionSelection | ReloadSelection;
export interface SourceDefinitionSelection { captureId: string; revision: number; apiId: string; sha256: string }
export interface AdaptDefinitionResult {
  schema: 'stellar-forge.tyk-definition-adaptation.v1';
  connectionId: string;
  nativeConnectionId: string;
  connectionSha256: string;
  sourceSha256: string;
  kind: 'classic' | 'oas';
  apiId: string;
  transformation: 'UNCHANGED' | 'UNWRAP_DASHBOARD_CLASSIC' | 'WRAP_DASHBOARD_CLASSIC';
  definitionText: string;
  sha256: string;
  bytes: number;
  capture: RecordReference;
  target: RecordReference;
  sourceDefinition: SourceDefinitionSelection;
}
export interface PrepareRolloutInput extends RequestIdentity {
  connectionId: string;
  selection: TykSelection;
  sourceDefinition?: SourceDefinitionSelection;
  cohortId?: string;
  cohortRevision?: number;
  label?: string;
  note?: string;
}
export interface DispatchRolloutInput extends RequestIdentity { id: string; expectedRevision: number; planSha256: string }
export interface ReconcileRolloutInput extends RequestIdentity { id: string; expectedRevision?: number }
export interface ExportWorkspaceInput extends RequestIdentity { label?: string }
/** Local server-side path. Use inspectDeliveryFile for a file on the SDK host. */
export interface InspectDeliveryInput extends RequestIdentity { path: string; label?: string }
export interface AdoptDeliveryInput extends RequestIdentity { id: string; expectedRevision: number; manifestSha256: string }
export interface NativeRequestPlan {
  sha256: string;
  method: string;
  path: string;
  apiIds: string[];
  mutation: boolean;
  [key: string]: unknown;
}
export interface RolloutValue {
  label: string;
  state: TykState;
  phase: string;
  connectionId: string;
  configurationSha256: string;
  planSha256: string;
  plan: SourceReference;
  selection: SourceReference;
  response?: SourceReference;
  reconciliation?: SourceReference;
  dispatchRequestId?: string;
  summary: Record<string, unknown>;
  [key: string]: unknown;
}
export interface DeliveryValue {
  state: 'PREPARING' | 'EXPORTED';
  label: string;
  file?: { bytes: number; sha256: string; [key: string]: unknown };
  snapshot: SourceReference;
  summary: Record<string, unknown>;
  [key: string]: unknown;
}
export interface ReceivingValue {
  state: 'INSPECTED' | 'ADOPTING' | 'ADOPTED';
  label: string;
  manifestSha256: string;
  manifest: SourceReference;
  sourceWorkspace: { schema: 'stellar-forge.tyk-workspace.v1'; workspaceId: string; createdAt: string };
  sourceDeliveryId: string;
  summary: Record<string, unknown>;
  original: SourceReference;
  [key: string]: unknown;
}
export interface ActionInputs {
  view: Record<string, never>;
  listRecords: ListRecordsInput;
  getRecord: GetRecordInput;
  readDefinition: { captureId: string; apiId: string; revision?: number };
  adaptDefinition: { captureId: string; apiId: string; revision?: number; connectionId: string };
  readSource: { reference: SourceReference };
  readReview: { id: string; revision?: number; offset?: number; limit?: number };
  saveConnection: SaveConnectionInput;
  capture: CaptureInput;
  importCapture: ImportCaptureInput;
  createCohort: CreateCohortInput;
  createCommissioning: CreateCommissioningInput;
  readCommissioning: { id: string; revision?: number };
  prepareCommissioningStep: PrepareCommissioningStepInput;
  recordCommissioningReview: RecordCommissioningReviewInput;
  refreshCommissioning: RefreshCommissioningInput;
  prepareRollout: PrepareRolloutInput;
  dispatchRollout: DispatchRolloutInput;
  reconcileRollout: ReconcileRolloutInput;
  exportWorkspace: ExportWorkspaceInput;
  inspectDelivery: InspectDeliveryInput;
  adoptDelivery: AdoptDeliveryInput;
}
export interface ActionResults {
  view: WorkspaceView;
  listRecords: RecordPage;
  getRecord: TykRecord;
  readDefinition: { capture: RecordReference; definition: Record<string, unknown> };
  adaptDefinition: AdaptDefinitionResult;
  readSource: { reference: SourceReference; value: Json };
  readReview: DefinitionReview;
  saveConnection: TykRecord<{ label: string; connection: TykConnection; configurationSha256: string; state: 'SAVED' }>;
  capture: TykRecord;
  importCapture: TykRecord;
  createCohort: TykRecord;
  createCommissioning: TykRecord<CommissioningValue>;
  readCommissioning: CommissioningView;
  prepareCommissioningStep: TykRecord<CommissioningValue>;
  recordCommissioningReview: TykRecord<CommissioningValue>;
  refreshCommissioning: TykRecord<CommissioningValue>;
  prepareRollout: TykRecord<RolloutValue>;
  dispatchRollout: TykRecord<RolloutValue>;
  reconcileRollout: TykRecord<RolloutValue>;
  exportWorkspace: TykRecord<DeliveryValue>;
  inspectDelivery: TykRecord<ReceivingValue>;
  adoptDelivery: TykRecord<ReceivingValue>;
}
export interface TykActionContract {
  title: string;
  description: string;
  write: boolean;
  inputSchema: Record<string, unknown>;
}
export const TYK_WORKSPACE_ACTIONS: Readonly<Record<keyof ActionInputs, TykActionContract>>;
export function tykProductActions(): (TykActionContract & { name: keyof ActionInputs })[];
export interface ProductSession {
  schema: 'stellar-forge.tyk-product-session.v1';
  state: 'STARTING' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'FAILED' | 'STOP_UNCONFIRMED';
  productId: string;
  directory: string;
  workspaceDirectory: string;
  instanceId: string;
  workspaceId: string;
  bindingSha256: string;
  resourceId: string;
  sourceSha256: string;
  connectionFile: string;
  browserUrlFile: string;
  browserUrl: string;
  port: number;
  startedAt: string;
  endedAt?: string;
}
export interface DownloadReceipt {
  schema: 'stellar-forge.tyk-product-delivery.v1';
  state: 'RETAINED';
  productId: string;
  workspaceId: string;
  deliveryId: string;
  deliveryRevision: number;
  recordSha256: string;
  path: string;
  bytes: number;
  sha256: string;
}
export interface RetainedFile {
  path: string; bytes: number; sha256: string; mediaType: string;
  productId: string; workspaceId: string;
}
export interface ClientOptions {
  directory: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  expectedWorkspaceId?: string;
}
export class TykProductClient {
  constructor(options: ClientOptions);
  readonly directory: string;
  connection(): Promise<{ record: ProductSession; origin: string; token: string }>;
  call<Method extends keyof ActionInputs>(method: Method, args: ActionInputs[Method]): Promise<ActionResults[Method]>;
  callToFile<Method extends keyof ActionInputs>(method: Method, args: ActionInputs[Method],
    options: { path: string }): Promise<RetainedFile & { method: Method; requestId?: string }>;
  view(): Promise<WorkspaceView>;
  status(): Promise<WorkspaceView>;
  listRecords(input?: ListRecordsInput): Promise<RecordPage>;
  getRecord(input: GetRecordInput): Promise<TykRecord>;
  readDefinition(input: ActionInputs['readDefinition']): Promise<ActionResults['readDefinition']>;
  adaptDefinition(input: ActionInputs['adaptDefinition']): Promise<AdaptDefinitionResult>;
  readSource(input: ActionInputs['readSource']): Promise<ActionResults['readSource']>;
  readReview(input: ActionInputs['readReview']): Promise<DefinitionReview>;
  saveConnection(input: SaveConnectionInput): Promise<ActionResults['saveConnection']>;
  capture(input: CaptureInput): Promise<TykRecord>;
  importCapture(input: ImportCaptureInput): Promise<TykRecord>;
  createCohort(input: CreateCohortInput): Promise<TykRecord>;
  createCommissioning(input: CreateCommissioningInput): Promise<TykRecord<CommissioningValue>>;
  readCommissioning(input: ActionInputs['readCommissioning']): Promise<CommissioningView>;
  prepareCommissioningStep(input: PrepareCommissioningStepInput): Promise<TykRecord<CommissioningValue>>;
  recordCommissioningReview(input: RecordCommissioningReviewInput): Promise<TykRecord<CommissioningValue>>;
  refreshCommissioning(input: RefreshCommissioningInput): Promise<TykRecord<CommissioningValue>>;
  prepareRollout(input: PrepareRolloutInput): Promise<TykRecord<RolloutValue>>;
  dispatchRollout(input: DispatchRolloutInput): Promise<TykRecord<RolloutValue>>;
  reconcileRollout(input: ReconcileRolloutInput): Promise<TykRecord<RolloutValue>>;
  exportWorkspace(input: ExportWorkspaceInput): Promise<TykRecord<DeliveryValue>>;
  inspectDelivery(input: InspectDeliveryInput): Promise<TykRecord<ReceivingValue>>;
  adoptDelivery(input: AdoptDeliveryInput): Promise<TykRecord<ReceivingValue>>;
  downloadDelivery(options: { id: string; path: string; expectedSha256?: string }): Promise<DownloadReceipt>;
  downloadSource(options: { reference: SourceReference; path: string }): Promise<RetainedFile & { reference: SourceReference }>;
  inspectDeliveryFile(options: { requestId: string; path: string; label?: string; expectedSha256?: string }): Promise<TykRecord<ReceivingValue>>;
  /** Close the SDK connection, preserving the application owner's separate lifecycle. */
  close(): Promise<void>;
}
