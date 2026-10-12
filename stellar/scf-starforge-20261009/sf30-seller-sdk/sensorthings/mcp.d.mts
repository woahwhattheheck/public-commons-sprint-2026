/** MIT. Public types for the original SensorThings HTTP/MCP workspace.
 *
 * IDs and integer bounds are checked by the running implementation. Source
 * numeric tokens are carried in ValueCell.value or the original JSON text;
 * a string result must not be coerced to a JavaScript number.
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
/** Additional native owner fields remain inspectable without guessed meanings. */
export type NativeObject = { [key: string]: unknown };
export type Sha256 = string;
export type WorkspaceId = string;
export type WorkspaceAlias = string;
export type OperationId = string;
export type CaptureId = string;
export type DatasetId = string;
export type EntityKind = 'Things' | 'Locations' | 'HistoricalLocations' |
  'Datastreams' | 'Sensors' | 'ObservedProperties' | 'Observations' |
  'FeaturesOfInterest' | 'MultiDatastreams';
export type StreamKind = 'Datastreams' | 'MultiDatastreams';
export type SourceTable = 'observations' | 'components' | 'entities';
export type CaptureReadPart = 'summary' | 'tasks' | 'pages' | 'issues' | 'attempts' | 'parents';
export type CaptureState = 'RUNNING' | 'COMPLETE' | 'FAILED' | 'PAUSED' |
  'PAUSED_LIMIT' | 'PAUSED_RETRY_AFTER' | 'PAUSED_BUDGET' | 'INTERRUPTED';
export type TaskState = 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';
export type CapturePhase = 'stream-start' | 'stream-end' | 'graph' | 'observations';

export type SensorThingsWorkspaceReference = {
  workspaceId: WorkspaceId;
  label?: string;
} & (
  { consoleUrlFile: string; consoleUrlEnv?: never; applicationUrlFile?: never } |
  { consoleUrlEnv: string; consoleUrlFile?: never; applicationUrlFile?: never } |
  { applicationUrlFile: string; consoleUrlFile?: never; consoleUrlEnv?: never }
);
export interface SensorThingsWorkspaceConfiguration {
  schema: 'stellar-forge.sensorthings-workspace-connection.v1';
  /** One to 32 host-declared aliases; one original session reference per alias. */
  workspaces: Record<WorkspaceAlias, SensorThingsWorkspaceReference>;
}
export interface SensorThingsMerchantConfiguration extends NativeObject {
  sensorthingsWorkspaces?: SensorThingsWorkspaceConfiguration;
}
export interface SensorThingsClientOptions {
  environment?: Record<string, string | undefined>;
  /** The existing native fetch contract; no provider retry is added by this client. */
  fetchImpl?: typeof globalThis.fetch;
}
export interface SourceContract {
  protocol: string;
  specification: string;
  edition: string;
  operations: string;
  paging: string;
  observations: string;
  meaning: string;
  scope: string;
}
export interface WorkspaceSchema {
  schema: 'stellar-forge.sensorthings-schema.v1';
  workspaceSchema: 'stellar-forge.sensorthings-workspace.v1';
  workspaceId: WorkspaceId;
  sourceContract: SourceContract;
  actions: { [K in SensorThingsActionName]: readonly string[] };
  tables: SourceTable[];
  captureReads: {
    parts: CaptureReadPart[];
    defaultPart: 'full';
    maxRows: 500;
    maxRowBytes: number;
    paging: string;
  };
  operation: string;
  limits: {
    maxPageBytes: number;
    maxNativeDatasetBytes: number;
    maxNativeRows: number;
    maxFileChunkBytes: 196608;
    defaultFileChunkBytes: 65536;
  };
}
export interface NativeErrorBody extends NativeObject {
  error: string;
  message: string;
  details: NativeObject;
  operationId: OperationId | null;
  currentRevision: number | null;
}
export type NativeReply<T> =
  | { workspace: WorkspaceAlias; workspaceId: WorkspaceId; ok: true; httpStatus: number; native: T }
  | { workspace: WorkspaceAlias; workspaceId: WorkspaceId; ok: false; httpStatus: number; native: NativeErrorBody };

export interface SourceReference {
  sha256: Sha256;
  bytes: number;
  jsonPointer: string;
  url: string;
  requestId: Sha256;
}
export type ValueCell =
  | { state: 'missing'; type: 'missing'; value: '' }
  | { state: 'null'; type: 'null'; value: '' }
  | { state: 'value'; type: 'number' | 'string' | 'boolean' | 'object' | 'array'; value: string };
export interface SourceIssue extends NativeObject {
  code: string;
  message?: string;
  severity?: 'notice' | 'warning' | string;
}
export interface SourceLicense {
  name: string;
  url: string;
  attribution: string;
  sourceUrl: string;
  note?: string;
}
export interface SourceConfiguration {
  label: string;
  serviceUrl: string;
  authorizationEnv: string | null;
  allowLoopback: boolean;
  license: SourceLicense;
  requestTimeoutMs: number;
  maxPageBytes: number;
}
export interface SourceRecord extends SourceConfiguration {
  id: string;
  createdAt: string;
}
export type SourceView = Omit<SourceRecord, 'authorizationEnv'> & {
  authorization: 'HOST_ENVIRONMENT' | 'NONE';
};
export interface CatalogQuery {
  filter?: string;
  orderBy?: string;
  /** Original provider $top option. Returned nextLink is still followed. */
  top?: number;
  count?: boolean;
}
export interface ObservationQuery extends CatalogQuery {
  expandFeatureOfInterest?: boolean;
}
export interface ProviderReceipt extends NativeObject {
  schema: 'stellar-forge.sensorthings-response.v1';
  requestId: Sha256;
  requestSha256: Sha256;
  requestedUrl: string;
  url: string;
  status: number | null;
  headers: Record<string, string>;
  startedAt: string;
  completedAt: string;
  sourceCapturedAt: string | null;
  representation: 'RECORDED_ORIGINAL_APPLICATION_BODY' |
    'ORIGINAL_APPLICATION_BODY_AFTER_HTTP_CONTENT_DECODING';
  complete: boolean;
  error: NativeObject | null;
  sha256: Sha256;
  bytes: number;
  retryNotBefore: string | null;
}
export interface CatalogRecord extends NativeObject {
  id: Sha256;
  schema: 'stellar-forge.sensorthings-catalogue.v1';
  sourceId: string;
  kind: StreamKind;
  url: string;
  receipt: ProviderReceipt;
  query: CatalogQuery;
  previousCatalogId: Sha256 | null;
  rows: number;
  count: ValueCell;
  next: string | null;
  continuationLiteral: string | null;
  createdAt: string;
  scope: string;
}
export interface CatalogRow {
  pointer: string;
  id: ValueCell;
  name: ValueCell;
  description: ValueCell;
  unit: ValueCell;
  observationType: ValueCell;
  selfLink: ValueCell;
  /** Complete original entity JSON text with numeric lexemes retained. */
  entityJson: string;
  sourceRef: SourceReference;
}
export interface CatalogRows {
  id: Sha256;
  sourceId: string;
  kind: StreamKind;
  count: ValueCell;
  /** Original provider page continuation, distinct from local row offset. */
  next: string | null;
  rows: CatalogRow[];
  total: number;
}
export interface SelectedStream {
  key: Sha256;
  kind: StreamKind;
  id: { type: 'number' | 'string'; value: string; key: string };
  url: string;
  observationsUrl: string;
  name: ValueCell;
  description: ValueCell;
  sourceRef: SourceReference;
  selectedJson: string;
  metadataMeaning: Record<string, ValueCell>;
  catalogId: Sha256;
}
export interface SourcePlan {
  id: Sha256;
  sourceId: string;
  label: string;
  streams: SelectedStream[];
  observationQuery: ObservationQuery;
  includeHistoricalLocations: boolean;
  maxRequests: number;
  maxBytes: number;
  sourceContract: SourceContract;
  createdAt: string;
}
export type SourcePlanView = Omit<SourcePlan, 'createdAt' | 'sourceContract' | 'streams'> & {
  streams: Omit<SelectedStream, 'selectedJson'>[];
};
export interface CaptureAttempt extends NativeObject {
  requestId: Sha256;
  startedAt: string;
}
export interface CaptureParent extends NativeObject {
  taskId: Sha256;
  jsonPointer: string;
  relationship: string;
}
export interface CaptureTask {
  id: Sha256;
  phase: CapturePhase;
  kind: EntityKind;
  url: string;
  originUrl: string;
  streamKey?: Sha256 | null;
  collection: boolean;
  parents: CaptureParent[];
  state: TaskState;
  attempts: CaptureAttempt[];
  error: NativeObject | null;
  receipt?: ProviderReceipt;
  retryNotBefore?: string | null;
}
export type CaptureTaskPageRecord = Omit<CaptureTask, 'attempts' | 'parents'> & {
  attemptCount: number;
  parentCount: number;
  latestAttempt: CaptureAttempt | null;
};
export interface CapturedPage {
  taskId: Sha256;
  kind: EntityKind;
  phase: CapturePhase;
  streamKey: Sha256 | null;
  url: string;
  originUrl: string;
  collection: boolean;
  count: ValueCell;
  next: string | null;
  receipt: ProviderReceipt;
  rows: number;
}
export interface CaptureSnapshot extends NativeObject {
  id: CaptureId;
  planId: Sha256;
  plan: SourcePlan;
  source: SourceRecord;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  state: CaptureState;
  tasks: CaptureTask[];
  pages: CapturedPage[];
  streamMetadata: NativeObject[];
  issues: SourceIssue[];
  totalBytes: number;
  editionIds: Sha256[];
  endQueued: boolean;
  limitReached: boolean;
  pauseReason?: string | null;
}
export interface CaptureSummary {
  id: CaptureId;
  planId: Sha256;
  sourceId: string;
  state: CaptureState;
  createdAt: string;
  updatedAt: string;
  requests: number;
  tasks: number;
  pages: number;
  issues: number;
  remaining: number;
  totalBytes: number;
  editionIds: Sha256[];
  pauseReason: string | null;
  limitReached: boolean;
  endQueued: boolean;
  running: boolean;
}
export type CaptureView = Pick<CaptureSummary,
  'id' | 'planId' | 'state' | 'createdAt' | 'requests' | 'pages' | 'tasks' |
  'remaining' | 'editionIds' | 'pauseReason' | 'running'> & {
  updatedAt?: string;
  bytes: number;
  issues: SourceIssue[];
  issueCount: number;
  issuesTruncated: boolean;
};
export interface CapturePageBase<P extends CaptureReadPart> {
  schema: 'stellar-forge.sensorthings-capture-page.v1';
  workspaceId: WorkspaceId;
  revision: number;
  captureId: CaptureId;
  part: P;
  summary: CaptureSummary;
  consistency: string;
}
export type CaptureSummaryPage = CapturePageBase<'summary'>;
export interface CaptureJournalRecords {
  tasks: CaptureTaskPageRecord;
  pages: CapturedPage;
  issues: SourceIssue;
  attempts: CaptureAttempt;
  parents: CaptureParent;
}
export type CaptureJournalPart = keyof CaptureJournalRecords;
export type CaptureJournalPage<P extends CaptureJournalPart = CaptureJournalPart> =
  P extends CaptureJournalPart ? CapturePageBase<P> & {
    taskId: P extends 'attempts' | 'parents' ? Sha256 : null;
    total: number;
    offset: number;
    limit: number;
    rows: { index: number; record: CaptureJournalRecords[P] }[];
    nextOffset: number | null;
    projection: string;
  } : never;
export type CaptureReadPage = CaptureSummaryPage | CaptureJournalPage;

export interface EditionScope {
  traversalCompleted: boolean;
  selectedQuery: ObservationQuery;
  status: 'SELECTED_QUERY_TRAVERSED' | 'PARTIAL_SOURCE';
  snapshot: 'not_established';
  partialReason: string | null;
  pages: number;
  receivedBytes: number;
  requests: number;
  remaining: NativeObject[];
  captureStartedAt: string;
  captureLastResponseAt: string | null;
}
export interface SourceFileIdentity extends NativeObject {
  sha256: Sha256;
  bytes: number;
  role: string;
  mediaType: string;
}
export interface SourceEdition {
  schema: 'stellar-forge.sensorthings-edition.v1';
  id: Sha256;
  captureId: CaptureId;
  createdAt: string;
  source: SourceRecord;
  plan: SourcePlan;
  pages: CapturedPage[];
  streamMetadata: NativeObject[];
  issues: SourceIssue[];
  scope: EditionScope;
  sourceFiles: SourceFileIdentity[];
}
export interface EditionSummary {
  rows: number;
  uniqueObservationIds: number;
  unkeyed: number;
  duplicateOccurrences: number;
  changedDuplicates: number;
  resultTypes: Record<string, number>;
  timeKinds: Record<string, number>;
  qualityStates: Record<string, number>;
  resultStates: Record<string, number>;
  rowIssueCounts: Record<string, number>;
  sourceIssues: SourceIssue[];
  scope: EditionScope;
  qualityInterpretation: string;
  intervalInterpretation: string;
}
export interface RowsPage<T extends SourceTable = SourceTable> {
  editionId: Sha256;
  table: T;
  columns: string[];
  offset: number;
  limit: number;
  total: number;
  /** Every projected cell is source text, including numeric JSON tokens. */
  rows: Record<string, string>[];
  next: number | null;
  /** MCP's additive continuation alias; both refer to the same row offset. */
  nextOffset: number | null;
}
export interface EditionReview {
  id: string;
  editionId: Sha256;
  decision: 'accept' | 'reject' | 'follow_up';
  actor: string;
  note: string;
  acknowledgeIssues: string[];
  createdAt: string;
  scope: EditionScope;
  summarySha256: Sha256;
  requiredIssueCodes: string[];
  meaning: string;
}
export interface OperationView extends NativeObject {
  operationId: OperationId;
  requestSha256: Sha256;
  action: SensorThingsActionName;
  expectedRevision: number;
  state: 'RUNNING' | 'COMPLETE' | 'FAILED';
  createdAt: string;
  error: NativeObject | null;
  resultSha256?: Sha256;
  completedAt?: string;
  failedAt?: string;
}
export type RetainedOperation = OperationView & { result: JsonValue | null };
export interface WorkspaceView {
  schema: 'stellar-forge.sensorthings-view.v1';
  workspaceId: WorkspaceId;
  revision: number;
  sourceContract: SourceContract;
  sources: SourceView[];
  catalogs: CatalogRecord[];
  plans: SourcePlanView[];
  captures: CaptureView[];
  editions: Sha256[];
  selectedEditionId: Sha256 | null;
  reviews: EditionReview[];
  /** Complete original native owner records; their own contracts govern meaning. */
  datasets: NativeObject[];
  releases: NativeObject[];
  receipts: NativeObject[];
  sourceReceipts: NativeObject[];
  comparisons: NativeObject[];
  exports: NativeObject[];
  operations: OperationView[];
  running: CaptureId[];
}
export type ActionResult<R = JsonValue> =
  | { operationId: OperationId; reused: boolean; result: R; view: WorkspaceView; state?: never }
  | { operationId: OperationId; reused: true; state: 'RUNNING'; view: WorkspaceView; result?: never };

/** Exact public fields accepted by the existing dataset seller compiler.
 * Values configure a proposed offer; they do not verify ownership or settle it.
 */
export interface PublicDatasetPaymentTerms {
  scheme: 'exact';
  network: 'stellar:testnet' | 'stellar:pubnet';
  asset: string;
  /** Positive atomic units as source text, within the native Soroban i128 bound. */
  amount: string;
  payTo: string;
  /** Integer seconds, 1..86400, checked by the original compiler. */
  maxTimeoutSeconds: number;
}

export type SensorThingsActionPayloads = {
  'source.add': {
    label: string; serviceUrl: string; license: SourceLicense;
    authorizationEnv?: string; allowLoopback?: boolean;
    requestTimeoutMs?: number; maxPageBytes?: number;
  };
  'catalog.capture': { sourceId: string; kind?: StreamKind } & (
    { query?: CatalogQuery; previousCatalogId?: never } |
    { previousCatalogId: Sha256; query?: never }
  );
  'plan.create': {
    sourceId: string; label: string; streams: { catalogId: Sha256; pointer: string }[];
    observationQuery?: ObservationQuery; includeHistoricalLocations?: boolean;
    maxRequests?: number; maxBytes?: number;
  };
  'capture.start': { planId: Sha256; budget?: number };
  'capture.resume': { captureId: CaptureId; budget?: number; retryFailed?: boolean };
  'capture.pause': { captureId: CaptureId };
  'capture.seal': { captureId: CaptureId; allowPartial?: boolean; reason?: string };
  'edition.review': { editionId: Sha256; decision: EditionReview['decision']; actor: string;
    note: string; acknowledgeIssues: string[] };
  'edition.compare': { leftId: Sha256; rightId: Sha256 };
  'edition.export': { editionId: Sha256 };
  'edition.import': { filename: string; expectedSha256: Sha256; expectedBytes: number };
  'dataset.prepare': { editionId: Sha256; name?: string; table?: SourceTable };
  'dataset.query': { datasetId: DatasetId; query?: string };
  /** Payment fields are the original SF82 contract, not a SensorThings substitute. */
  'release.prepare': { datasetId: DatasetId; origin: string; path?: string; payment: PublicDatasetPaymentTerms };
  'release.activate': { releaseId: string; expectedGeneration: number };
  'release.rollback': { releaseId: string; expectedGeneration: number };
  'release.start': { releaseId: string; expectedGeneration: number };
  'release.stop': { releaseId: string };
  'buyer.inspect': { intentIds: string[] };
  'buyer.receive': { intentIds: string[] };
  /** Native publisher objects retain their original source/version-specific schema. */
  'publisher.buyer.review': { datasetId: DatasetId; snapshot: Sha256; query: string };
  'publisher.buyer.prepare': { datasetId: DatasetId; review: JsonObject; intentId: string;
    acceptIndex: number; offerSha256: Sha256 };
  'publisher.buyer.session': { datasetId: DatasetId; buyerId: string; maxPages: number;
    maxTotalAtomic: string; maxRows?: number; maxPageBytes?: number };
  'publisher.buyer.run': { datasetId: DatasetId; id: string; retryUnpaid?: boolean; expectedAttemptSha256?: Sha256 };
  'publisher.buyer.recover': { datasetId: DatasetId; id: string };
  'publisher.buyer.account': { datasetId: DatasetId; id: string };
  'publisher.buyer.export': { datasetId: DatasetId; id: string };
};
export type SensorThingsActionName = keyof SensorThingsActionPayloads;
export type ActionArguments<A extends SensorThingsActionName = SensorThingsActionName> =
  A extends SensorThingsActionName ? {
    workspace: WorkspaceAlias;
    operationId: OperationId;
    expectedRevision: number;
    action: A;
    payload: SensorThingsActionPayloads[A];
  } : never;

export type BuyerFile = 'dataset.csv' | 'dataset.jsonl' | 'review.html' | 'delivery.json' | 'manifest.json';
export type PublisherFile = 'draft-csv' | 'draft-review' | 'buyer-config' | 'session-manifest' |
  'session-delivery-manifest' | 'session-csv' | 'session-jsonl' | 'session-review';
export type TransferFile = 'archive' | 'transfer.json' | 'source-receiving.json' | 'original-transfer-manifest.json';
/** A group selection is valid for list; choose its returned concrete member for read. */
export type FileSelection =
  | { kind: 'source'; id: Sha256; sha256?: Sha256 }
  | { kind: 'edition'; id: Sha256; file?: 'edition.json' }
  | { kind: 'dataset'; id: DatasetId; file?: string }
  | { kind: 'comparison'; id: string; file?: 'comparison.json' | 'changes.jsonl' }
  | { kind: 'transfer'; id: string; file?: TransferFile }
  | { kind: 'buyer'; id: string; file?: BuyerFile }
  | { kind: 'publisher'; datasetId: DatasetId; id: string; file?: PublisherFile };
export type ConcreteFileSelection =
  | { kind: 'source'; id: Sha256; sha256: Sha256 }
  | { kind: 'edition'; id: Sha256; file: 'edition.json' }
  | { kind: 'dataset'; id: DatasetId; file: string }
  | { kind: 'comparison'; id: string; file: 'comparison.json' | 'changes.jsonl' }
  | { kind: 'transfer'; id: string; file: TransferFile }
  | { kind: 'buyer'; id: string; file: BuyerFile }
  | { kind: 'publisher'; datasetId: DatasetId; id: string; file: PublisherFile };
export interface FixedFileMetadata extends NativeObject {
  selection: ConcreteFileSelection;
  name: string;
  type: string;
  bytes: number;
  sha256: Sha256;
  materialized: true;
  retention: 'ORIGINAL_IMMUTABLE_FILE';
  verification: 'COMPLETE_HELD_FD_HASH_BEFORE_FIRST_BYTE';
}
export interface GeneratedReviewMetadata extends NativeObject {
  selection: { kind: 'publisher'; datasetId: DatasetId; id: string; file: 'draft-review' };
  name: 'dataset-review.json';
  type: 'application/json';
  bytes: null;
  sha256: null;
  materialized: false;
  retention: 'ORIGINAL_GENERATED_READ_SESSION';
  verification: 'SNAPSHOT_SHA_RETURNED_BY_FIRST_READ';
}
export type FileMetadata = FixedFileMetadata | GeneratedReviewMetadata;
export interface FilesPage extends NativeObject {
  schema: 'stellar-forge.sensorthings-files.v1';
  workspaceId: WorkspaceId;
  selection: FileSelection;
  files: FileMetadata[];
  total: number;
  offset: number;
  nextOffset: number | null;
  manifestSha256: Sha256;
}
export interface FileRead {
  readId: string;
  file: {
    name: string;
    bytes: number;
    sha256: Sha256;
    contentType: string;
    type: string;
  };
  offset: number;
  bytesRead: number;
  nextOffset: number | null;
  encoding: 'base64';
  data: string;
}
export interface FileReleased {
  readId: string;
  released: true;
  alreadyAbsent?: true;
}
export interface WorkspaceScope { workspace: WorkspaceAlias; }
export type CaptureFullArguments = WorkspaceScope & {
  captureId: CaptureId; part?: never; offset?: never; limit?: never; taskId?: never; expectedRevision?: never;
};
export type CaptureSummaryArguments = WorkspaceScope & {
  captureId: CaptureId; part: 'summary'; expectedRevision?: number; offset?: 0; limit?: never; taskId?: never;
};
export type CaptureJournalArguments<P extends CaptureJournalPart = CaptureJournalPart> =
  P extends CaptureJournalPart ? WorkspaceScope & {
    captureId: CaptureId;
    part: P;
    /** Nonzero offsets require the first page's expectedRevision at runtime. */
    offset?: number;
    limit?: number;
    expectedRevision?: number;
  } & (P extends 'attempts' | 'parents' ? { taskId: Sha256 } : { taskId?: never }) : never;
export type CaptureArguments = CaptureFullArguments | CaptureSummaryArguments | CaptureJournalArguments;
export type FileListArguments = WorkspaceScope & {
  selection: FileSelection; offset?: number; limit?: number; manifestSha256?: Sha256;
};
export type FileReadArguments = WorkspaceScope & {
  selection: ConcreteFileSelection;
  /** Repeat expectedSha256 with any readId or nonzero offset. */
  readId?: string;
  expectedSha256?: Sha256;
  offset?: number;
  /** One to 196608 bytes, default 65536. */
  limit?: number;
};
export type FileReleaseArguments = WorkspaceScope & { readId: string };

export interface WorkspaceClientSummary {
  configured: boolean;
  workspaces: {
    workspace: WorkspaceAlias;
    label: string | undefined;
    workspaceId: WorkspaceId;
    connection: 'ORIGINAL_APPLICATIONS_RECORD' | 'ORIGINAL_PRIVATE_URL_FILE' | 'ORIGINAL_PRIVATE_URL_ENV';
    activeFileReads: { readId: string; sha256: Sha256; selection: ConcreteFileSelection }[];
    ownership: 'EXISTING_SENSORTHINGS_WORKSPACE';
  }[];
}
export interface SensorThingsToolArguments {
  merchant_sensorthings_workspaces: Record<string, never>;
  merchant_sensorthings_schema: WorkspaceScope;
  merchant_sensorthings_view: WorkspaceScope;
  merchant_sensorthings_catalog: WorkspaceScope & { catalogId: Sha256; offset?: number; limit?: number };
  merchant_sensorthings_edition: WorkspaceScope & { editionId: Sha256; mode?: 'metadata' | 'summary' };
  merchant_sensorthings_rows: WorkspaceScope & { editionId: Sha256; table: SourceTable; offset?: number; limit?: number };
  merchant_sensorthings_capture: CaptureArguments;
  merchant_sensorthings_release: WorkspaceScope & { releaseId: string };
  merchant_sensorthings_publisher: WorkspaceScope & { datasetId: DatasetId };
  merchant_sensorthings_operation: WorkspaceScope & { operationId: OperationId };
  merchant_sensorthings_action: ActionArguments;
  merchant_sensorthings_files: FileListArguments;
  merchant_sensorthings_file_read: FileReadArguments;
  merchant_sensorthings_file_release: FileReleaseArguments;
}
export interface SensorThingsToolResults {
  merchant_sensorthings_workspaces: WorkspaceClientSummary;
  merchant_sensorthings_schema: NativeReply<WorkspaceSchema>;
  merchant_sensorthings_view: NativeReply<WorkspaceView>;
  merchant_sensorthings_catalog: NativeReply<CatalogRows>;
  merchant_sensorthings_edition: NativeReply<SourceEdition | EditionSummary>;
  merchant_sensorthings_rows: NativeReply<RowsPage>;
  merchant_sensorthings_capture: NativeReply<CaptureSnapshot | CaptureReadPage>;
  merchant_sensorthings_release: NativeReply<NativeObject>;
  merchant_sensorthings_publisher: NativeReply<NativeObject>;
  merchant_sensorthings_operation: NativeReply<RetainedOperation>;
  merchant_sensorthings_action: NativeReply<ActionResult>;
  merchant_sensorthings_files: NativeReply<FilesPage>;
  merchant_sensorthings_file_read: NativeReply<FileRead>;
  merchant_sensorthings_file_release: NativeReply<FileReleased>;
}
export type SensorThingsToolName = keyof SensorThingsToolArguments;

export interface ToolFieldSchema {
  type: 'string' | 'integer' | 'boolean' | 'object';
  maxLength?: number;
  pattern?: string;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  properties?: Record<string, ToolFieldSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
}
export interface SensorThingsToolAnnotations {
  readOnly?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
  destructive?: boolean;
}
export type SensorThingsToolFactory<T> = (
  name: SensorThingsToolName,
  description: string,
  properties: Record<string, ToolFieldSchema>,
  required: readonly string[],
  annotations: SensorThingsToolAnnotations
) => T;
export interface SensorThingsToolDefinition {
  name: SensorThingsToolName;
  properties: Record<string, ToolFieldSchema>;
  required: readonly string[];
}

/** Reads private host references; it does not open another native writer. */
export function readSensorThingsWorkspaceConfiguration(path: string): Promise<SensorThingsWorkspaceConfiguration>;
/** Uses the original loopback HTTP owner; call() may synchronously reject invalid parameters. */
export class MerchantSensorThingsWorkspaces {
  constructor(config: SensorThingsWorkspaceConfiguration | SensorThingsMerchantConfiguration,
    options?: SensorThingsClientOptions);
  readonly summary: WorkspaceClientSummary;
  call(name: 'merchant_sensorthings_capture', args: CaptureFullArguments): Promise<NativeReply<CaptureSnapshot>>;
  call(name: 'merchant_sensorthings_capture', args: CaptureSummaryArguments): Promise<NativeReply<CaptureSummaryPage>>;
  call<P extends CaptureJournalPart>(name: 'merchant_sensorthings_capture',
    args: CaptureJournalArguments<P>): Promise<NativeReply<CaptureJournalPage<P>>>;
  call(name: 'merchant_sensorthings_edition',
    args: WorkspaceScope & { editionId: Sha256; mode: 'summary' }): Promise<NativeReply<EditionSummary>>;
  call(name: 'merchant_sensorthings_edition',
    args: WorkspaceScope & { editionId: Sha256; mode?: 'metadata' }): Promise<NativeReply<SourceEdition>>;
  call<K extends SensorThingsToolName>(name: K,
    ...args: K extends 'merchant_sensorthings_workspaces'
      ? [args?: SensorThingsToolArguments[K]] : [args: SensorThingsToolArguments[K]]
  ): Promise<SensorThingsToolResults[K]>;
  /** Drains pending native calls and releases this client's own held-file reads. */
  close(): Promise<void>;
}
export { sensorThingsWorkspaceTools } from './mcp-protocol.mjs';
