/** Installed client of the original Flowable workspace and its complete native source/history deliveries. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type RecordKind = 'connection' | 'portfolio' | 'release' | 'process' | 'task' | 'migration'
  | 'decisionPortfolio' | 'decisionRelease' | 'decisionEvaluation'
  | 'casePortfolio' | 'caseRelease' | 'caseInstance' | 'casePlanItem' | 'caseTask' | 'programme' | 'delivery' | 'receiving';
export type OperationKind = 'release' | 'process' | 'task' | 'migration' | 'decisionRelease' | 'decisionEvaluation'
  | 'caseRelease' | 'caseInstance' | 'casePlanItem' | 'caseTask';
export type CaseCollectionKind = 'deployments' | 'definitions' | 'cases' | 'planItems' | 'tasks' | 'variables'
  | 'historicCases' | 'historicPlanItems' | 'historicTasks' | 'historicVariables' | 'milestones';
export type DecisionCollectionKind = 'deployments' | 'definitions' | 'historicExecutions';
export type CollectionKind = 'deployments' | 'definitions' | 'processes' | 'tasks'
  | 'historicProcesses' | 'historicTasks' | 'historicActivities' | 'historicVariables';
export type FlowableState = 'SAVED' | 'CAPTURING' | 'CAPTURED' | 'COMPLETED' | 'PREPARING' | 'PREPARED'
  | 'INVALID' | 'DISPATCHED' | 'READBACK' | 'CONFIRMED' | 'ACCEPTED' | 'OBSERVED' | 'REJECTED'
  | 'UNKNOWN' | 'STALE' | 'PREPARE_FAILED' | 'INTERRUPTED' | 'EXPORTED' | 'INSPECTED' | 'ADOPTING' | 'ADOPTED' | 'IN_PROGRESS';
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
/** Original CMMN VariableInstanceResponse; typed data is nested in variable. */
export interface NativeCaseVariable {
  id: string; caseInstanceId?: string; caseInstanceUrl?: string; taskId?: string; planItemInstanceId?: string;
  variable: { name: string; type?: string; value?: Json; scope?: string; valueUrl?: string;
    [key: string]: Json | undefined };
  [key: string]: unknown;
}
export interface NativeResource {
  kind?: 'dmn-definition-resource' | 'dmn-execution-audit' | string;
  definitionId?: string; definitionIds?: string[]; deploymentId?: string; executionId?: string;
  caseInstanceId?: string; variableInstanceId?: string; taskId?: string; planItemInstanceId?: string;
  variableName?: string; variableType?: string; history?: boolean;
  filename: string; contentType?: string;
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
    collections: Partial<Record<CollectionKind | DecisionCollectionKind | CaseCollectionKind, { total: number; retained: number; complete: boolean; pages: number }>>;
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
export interface ReadDecisionPortfolioInput extends Paging { id: string; revision?: number; collection: DecisionCollectionKind }
export interface ReadCasePortfolioInput extends Paging { id: string; revision?: number; collection: CaseCollectionKind }
export interface PortfolioPage extends Paging {
  portfolio: RecordReference; collection: CollectionKind | DecisionCollectionKind; offset: number; limit: number;
  items: NativeEntity[]; total: number; nativeTotal: number; complete: boolean;
  pages: unknown[]; exchanges: unknown[]; nextOffset: number | null;
}
export interface CasePortfolioPage extends Omit<PortfolioPage, 'collection' | 'items'> {
  collection: CaseCollectionKind; items: (NativeEntity | NativeCaseVariable)[];
}
export interface CapturedCase {
  portfolio: RecordReference; caseInstance: NativeEntity | null; historicCase: NativeEntity | null;
  definitions: NativeEntity[]; resources: NativeResource[];
  related: Partial<Record<CaseCollectionKind, (NativeEntity | NativeCaseVariable)[]>>;
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
export interface DecisionDeploymentSelection {
  action: 'deploy'; tenantId?: string;
  /** One complete original DMN resource. Its filename determines the native deployment name. */
  resource: { filename: string; contentType?: string; contentBase64: string };
}
export interface DecisionEvaluationSelection {
  action: 'evaluate'; mode?: 'auto' | 'decision' | 'decisionService'; singleResult?: boolean;
  /** Exact native JSON: decisionKey, tenantId, parentDeploymentId, inputVariables, disableHistory.
   * The engine resolves its actual definition; retain original numeric text and native variable types. */
  bodyText: string;
}
export interface CaseDeploymentSelection {
  action: 'deploy'; deploymentName?: string; deploymentKey?: string; tenantId?: string;
  /** Complete original CMMN resource or native deployment archive. */
  resource: { filename: string; contentType?: string; contentBase64: string };
}
export interface CaseStartSelection {
  action: 'startCase';
  /** Exact native caseDefinitionId or caseDefinitionKey, business identity and typed variables. */
  bodyText: string;
}
export interface CaseUpdateSelection {
  action: 'updateCase' | 'evaluateCaseCriteria'; caseInstanceId: string;
  /** Update uses name/businessKey without an action. Criteria uses action:evaluateCriteria. */
  bodyText: string;
}
export interface CaseTerminationSelection { action: 'terminateCase'; caseInstanceId: string }
export type CaseInstanceSelection = CaseStartSelection | CaseUpdateSelection | CaseTerminationSelection;
export interface CasePlanItemSelection {
  action: 'startPlanItem' | 'triggerPlanItem' | 'enablePlanItem' | 'disablePlanItem';
  planItemInstanceId: string;
  /** Optional expected owning case; the adapter verifies it against the actual native plan item. */
  caseInstanceId?: string;
  /** Exact JSON action start, trigger, enable or disable. In this engine enable starts the item. */
  bodyText: string;
}
export interface CaseTaskSelection {
  action: 'claim' | 'unclaim' | 'complete' | 'delegate' | 'resolve'; taskId: string;
  /** Optional expected owning case; the adapter verifies it against the native task. */
  caseInstanceId?: string;
  /** The original native JSON action must match; unclaim uses claim with assignee:null. */
  bodyText: string;
}
export type FlowableSelection = DeploymentSelection | ProcessSelection | TaskSelection | MigrationSelection
  | DecisionDeploymentSelection | DecisionEvaluationSelection | CaseDeploymentSelection | CaseInstanceSelection
  | CasePlanItemSelection | CaseTaskSelection;
export interface PrepareInput<Selection extends FlowableSelection> extends RequestIdentity {
  connectionId: string; selection: Selection; label?: string; note?: string;
}
export type PrepareReleaseInput = PrepareInput<DeploymentSelection>;
export type PrepareProcessInput = PrepareInput<ProcessSelection>;
export type PrepareTaskInput = PrepareInput<TaskSelection>;
export type PrepareMigrationInput = PrepareInput<MigrationSelection>;
export type PrepareDecisionReleaseInput = PrepareInput<DecisionDeploymentSelection>;
export type PrepareDecisionEvaluationInput = PrepareInput<DecisionEvaluationSelection>;
export type PrepareCaseReleaseInput = PrepareInput<CaseDeploymentSelection>;
export type PrepareCaseInstanceInput = PrepareInput<CaseInstanceSelection>;
export type PrepareCasePlanItemInput = PrepareInput<CasePlanItemSelection>;
export type PrepareCaseTaskInput = PrepareInput<CaseTaskSelection>;
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
  activities?: NativeEntity[]; historicActivities?: NativeEntity[]; historicExecutions?: NativeEntity[]; resources?: NativeResource[];
  cases?: NativeEntity[]; planItems?: NativeEntity[]; variables?: NativeCaseVariable[];
  historicCases?: NativeEntity[]; historicPlanItems?: NativeEntity[];
  historicVariables?: NativeCaseVariable[]; milestones?: NativeEntity[];
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
    deploymentName?: string; deploymentKey?: string; tenantId?: string; processInstanceId?: string; taskId?: string;
    caseInstanceId?: string; planItemInstanceId?: string;
    mode?: 'auto' | 'decision' | 'decisionService'; singleResult?: boolean } | null;
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

/** Exact declarative programme sources and bindings; original JSON bodies remain text. */
export interface ProgrammeSourceSelector {
  step: string; document: 'response' | 'before' | 'after' | 'reconciliation' | 'selection'; pointer: string;
  where?: Record<string, null | boolean | string | number | ProgrammeSourceSelector>; valuePointer?: string;
}
export interface ProgrammeBinding { field?: 'processInstanceId' | 'caseInstanceId' | 'taskId' | 'planItemInstanceId'; token?: string; from: ProgrammeSourceSelector }
export interface ProgrammeStep {
  key: string; label: string; kind: OperationKind; selection: Record<string, Json>;
  after?: string[]; bindings?: ProgrammeBinding[]; note?: string;
}
export interface FlowableProgramme {
  schema: 'stellar-forge.flowable-programme.v1'; key: string; label: string; note?: string;
  sources?: { name: string; bytes: number; sha256: string; mediaType?: string; contentBase64: string }[];
  steps: ProgrammeStep[];
}
export interface SaveProgrammeInput { requestId: string; connectionId: string; programmeText: string }
export interface PrepareProgrammeStepInput { requestId: string; id: string; expectedRevision: number; stepKey: string; renew?: boolean }
export interface ReviewProgrammeInput {
  requestId: string; id: string; expectedRevision: number; basisSha256: string;
  decision: 'accepted' | 'changes-requested'; reviewer: string; note: string;
}
export interface ProgrammeView {
  schema: 'stellar-forge.flowable-programme-view.v1'; record: RecordReference; label: string; note: string;
  connectionId: string; programmeKey: string; programmeSha256: string; source: SourceReference;
  sources: { name: string; reference: SourceReference }[]; programme: FlowableProgramme;
  progress: { total: number; confirmed: number; state: string; next: string | null;
    rows: { key: string; label: string; kind: OperationKind; state: string; ready: boolean; waitingFor: string[];
      attempts: number; selected: null | { operationId: string; index: number; command: PrepareProgrammeStepInput; input: Record<string, Json> };
      record: null | (RecordReference & { state: FlowableState; phase: string; dispatchedAt: string | null }) }[];
    basis: { key: string; record: RecordReference | null }[] };
  basisSha256: string; review: null | { decision: string; reviewer: string; note: string; reviewedAt: string;
    basisSha256: string; current: boolean }; reviewHistory: Record<string, unknown>[];
}

export interface ActionInputs {
  saveProgramme: SaveProgrammeInput;
  readProgramme: { id: string; revision?: number };
  prepareProgrammeStep: PrepareProgrammeStepInput;
  reviewProgramme: ReviewProgrammeInput;
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
  readDecisionPortfolio: ReadDecisionPortfolioInput;
  readDecisionDefinition: { portfolioId: string; definitionId: string; revision?: number };
  readDecisionExecution: { portfolioId: string; executionId: string; revision?: number };
  captureDecisionPortfolio: CapturePortfolioInput;
  prepareDecisionRelease: PrepareDecisionReleaseInput;
  dispatchDecisionRelease: DispatchOperationInput;
  prepareDecisionEvaluation: PrepareDecisionEvaluationInput;
  dispatchDecisionEvaluation: DispatchOperationInput;
  readCasePortfolio: ReadCasePortfolioInput;
  readCaseDefinition: { portfolioId: string; definitionId: string; revision?: number };
  readCaseInstance: { portfolioId: string; caseInstanceId: string; revision?: number };
  captureCasePortfolio: CapturePortfolioInput;
  prepareCaseRelease: PrepareCaseReleaseInput;
  dispatchCaseRelease: DispatchOperationInput;
  prepareCaseInstance: PrepareCaseInstanceInput;
  dispatchCaseInstance: DispatchOperationInput;
  prepareCasePlanItem: PrepareCasePlanItemInput;
  dispatchCasePlanItem: DispatchOperationInput;
  prepareCaseTask: PrepareCaseTaskInput;
  dispatchCaseTask: DispatchOperationInput;
  reconcileOperation: ReconcileOperationInput;
  exportWorkspace: ExportWorkspaceInput;
  inspectDelivery: InspectDeliveryInput;
  adoptDelivery: AdoptDeliveryInput;
}
export interface ActionResults {
  saveProgramme: FlowableRecord;
  readProgramme: ProgrammeView;
  prepareProgrammeStep: { programme: RecordReference; stepKey: string; attempt: number; operation: FlowableRecord<OperationValue> };
  reviewProgramme: FlowableRecord;
  view: WorkspaceView;
  listRecords: RecordPage;
  getRecord: FlowableRecord;
  readPortfolio: PortfolioPage;
  readDefinition: { portfolio: RecordReference; definition: NativeEntity; deployment: NativeEntity | null; resources: NativeResource[] };
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
  readDecisionPortfolio: PortfolioPage;
  readDecisionDefinition: { portfolio: RecordReference; definition: NativeEntity; deployment: NativeEntity | null; resources: NativeResource[] };
  readDecisionExecution: { portfolio: RecordReference; execution: NativeEntity; resources: NativeResource[] };
  captureDecisionPortfolio: FlowableRecord;
  prepareDecisionRelease: FlowableRecord<OperationValue>;
  dispatchDecisionRelease: FlowableRecord<OperationValue>;
  prepareDecisionEvaluation: FlowableRecord<OperationValue>;
  dispatchDecisionEvaluation: FlowableRecord<OperationValue>;
  readCasePortfolio: CasePortfolioPage;
  readCaseDefinition: { portfolio: RecordReference; definition: NativeEntity; deployment: NativeEntity | null; resources: NativeResource[] };
  readCaseInstance: CapturedCase;
  captureCasePortfolio: FlowableRecord;
  prepareCaseRelease: FlowableRecord<OperationValue>;
  dispatchCaseRelease: FlowableRecord<OperationValue>;
  prepareCaseInstance: FlowableRecord<OperationValue>;
  dispatchCaseInstance: FlowableRecord<OperationValue>;
  prepareCasePlanItem: FlowableRecord<OperationValue>;
  dispatchCasePlanItem: FlowableRecord<OperationValue>;
  prepareCaseTask: FlowableRecord<OperationValue>;
  dispatchCaseTask: FlowableRecord<OperationValue>;
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
  saveProgramme(input: SaveProgrammeInput): Promise<FlowableRecord>;
  readProgramme(input: { id: string; revision?: number }): Promise<ProgrammeView>;
  prepareProgrammeStep(input: PrepareProgrammeStepInput): Promise<ActionResults['prepareProgrammeStep']>;
  reviewProgramme(input: ReviewProgrammeInput): Promise<FlowableRecord>;
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
  readDecisionPortfolio(input: ReadDecisionPortfolioInput): Promise<PortfolioPage>;
  readDecisionDefinition(input: ActionInputs['readDecisionDefinition']): Promise<ActionResults['readDecisionDefinition']>;
  readDecisionExecution(input: ActionInputs['readDecisionExecution']): Promise<ActionResults['readDecisionExecution']>;
  captureDecisionPortfolio(input: CapturePortfolioInput): Promise<FlowableRecord>;
  prepareDecisionRelease(input: PrepareDecisionReleaseInput): Promise<FlowableRecord<OperationValue>>;
  dispatchDecisionRelease(input: DispatchOperationInput): Promise<FlowableRecord<OperationValue>>;
  prepareDecisionEvaluation(input: PrepareDecisionEvaluationInput): Promise<FlowableRecord<OperationValue>>;
  dispatchDecisionEvaluation(input: DispatchOperationInput): Promise<FlowableRecord<OperationValue>>;
  readCasePortfolio(input: ReadCasePortfolioInput): Promise<CasePortfolioPage>;
  readCaseDefinition(input: ActionInputs['readCaseDefinition']): Promise<ActionResults['readCaseDefinition']>;
  readCaseInstance(input: ActionInputs['readCaseInstance']): Promise<CapturedCase>;
  captureCasePortfolio(input: CapturePortfolioInput): Promise<FlowableRecord>;
  prepareCaseRelease(input: PrepareCaseReleaseInput): Promise<FlowableRecord<OperationValue>>;
  dispatchCaseRelease(input: DispatchOperationInput): Promise<FlowableRecord<OperationValue>>;
  prepareCaseInstance(input: PrepareCaseInstanceInput): Promise<FlowableRecord<OperationValue>>;
  dispatchCaseInstance(input: DispatchOperationInput): Promise<FlowableRecord<OperationValue>>;
  prepareCasePlanItem(input: PrepareCasePlanItemInput): Promise<FlowableRecord<OperationValue>>;
  dispatchCasePlanItem(input: DispatchOperationInput): Promise<FlowableRecord<OperationValue>>;
  prepareCaseTask(input: PrepareCaseTaskInput): Promise<FlowableRecord<OperationValue>>;
  dispatchCaseTask(input: DispatchOperationInput): Promise<FlowableRecord<OperationValue>>;
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
