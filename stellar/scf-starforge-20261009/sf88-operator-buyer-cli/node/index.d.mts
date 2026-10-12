export type JsonObject = { [key: string]: unknown };
export interface OperatorProfile {
  operator?: { python: string; actor: string; service: string; policy: string; ledger: string };
  signerModule?: string;
  trustedPayer?: string;
  bodyCaptureTimeoutMs?: number;
  /** Per native HTTP exchange, including response body; 1–300,000 ms. */
  requestTimeoutMs?: number;
  buyerTransport?: { mode: 'explicit-connect'; origin: string; proxyUrl?: string; proxyEnv?: string };
}
export interface BuyerOptions {
  /** Absolute path to the original sf88-operator-buyer-cli directory. */
  runtimeDirectory: string;
  /** Private (0700 on POSIX), caller-owned directory. */
  stateDirectory: string;
  operatorProfile?: OperatorProfile | string;
  node?: string;
  environment?: Record<string, string | undefined>;
  timeoutMs?: number;
  cleanupGraceMs?: number;
  outputLimit?: number;
  /** Separate original dataset report budget; 32 MiB default, 1–256 MiB allowed. */
  datasetReportLimit?: number;
  /** Separate inbox snapshot/report result budget; 32 MiB default, 1–256 MiB allowed. */
  inboxReportLimit?: number;
}
export interface NativeRequest {
  intentId: string;
  url: string;
  method?: string;
  expect: {
    scheme: string; network: string; asset: string; payTo: string; maxAtomic: string;
    maxTimeoutSeconds?: number; paymentFlow?: 'authorization' | 'upfront';
  };
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
  orderReference?: string;
  ticketFile?: string;
  ticketHeader?: string;
  /** Functions cannot cross the native process boundary; use an operator profile. */
  approve?: unknown;
  sign?: unknown;
}
export interface ResponseStreamOptions {
  format: 'sse' | 'ndjson';
  maxRecordBytes?: number;
  maxRecords?: number;
}
export interface ResponseCaptureOptions {
  maxBytes?: number;
  /** Native stream captures allow at most 300,000 ms. */
  timeoutMs?: number;
  expectedSha256?: string;
  expectedBytes?: number;
  expectedContentType?: string;
  stream?: ResponseStreamOptions;
}
export interface StreamReadOptions {
  /** Inspect the originally recorded complete prefix of a failed capture. */
  allowPartial?: boolean;
  maxRecordBytes?: number;
  maxRecords?: number;
  signal?: AbortSignal;
}
export interface BuyerStreamSummary {
  readonly format: 'sse' | 'ndjson';
  readonly records: number;
  readonly bytes: number;
  readonly complete: boolean;
  readonly pendingRecord: boolean;
  readonly lastCompleteByte: number;
  readonly lastEventId?: string;
  readonly retryMilliseconds?: number | null;
  readonly emptyLines?: number;
  readonly error?: string;
}
export interface BuyerStreamEvent {
  readonly index: number;
  readonly format: 'sse';
  readonly event: string;
  readonly data: string;
  readonly id: string;
  readonly retry?: number;
}
export interface ImportOptions {
  body?: string | Uint8Array;
  /** Stops preparation and its original offline review before an operation is returned. */
  signal?: AbortSignal;
  operatorProfile?: OperatorProfile | string;
  /** The Node application owns the fixed private destination. */
  responseFile?: ResponseCaptureOptions;
  /** Reviewed merchant HTTP deadline; independent of the native subprocess deadline. */
  requestTimeoutMs?: number;
}
export interface WorkspaceImportOptions extends Omit<ImportOptions, 'operatorProfile'> {
  /** Optional explicit native request/config merged with the workspace by its original binding. */
  configuration?: string | JsonObject;
  /** Explicit new intent for the selected request; never inferred during recovery. */
  intentId?: string;
}
export interface Review {
  readonly intentId: string;
  readonly configSha256: string;
  readonly bodySha256: string;
  readonly ticketSha256: string | null;
  readonly reviewedAt: string;
  readonly native: JsonObject;
  /** Original workspace chosen at preparation; its keys are not in application metadata. */
  readonly nativeWorkspace?: string;
}
export interface OperationStatus {
  intentId: string; directory: string; state: string;
  resultRecoverable: boolean; nativeStatus: unknown; deliveryStatus: string | null;
  /** Present after this prepared operation is assigned to an original inbox. */
  inboxDirectory?: string;
  nativeWorkspace?: string;
  retry: 'NO_AUTOMATIC_RETRY';
}
export interface NativeSummary extends JsonObject {
  mode: 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT';
  intentId: string;
  status: unknown;
  httpStatus: number | null;
  requestTimeoutMs?: number;
  responseFile?: { status: string; path?: string; bytes?: number; sha256?: string;
    stream?: BuyerStreamSummary; partialPath?: string; partialSha256?: string; [key: string]: unknown };
}
export interface ResultRecord {
  readonly schema: string;
  readonly intentId: string;
  readonly configSha256: string;
  readonly native: NativeSummary;
  readonly exitCode: number | null;
  readonly exitSignal: string | null;
  readonly runtimeError: string | null;
  readonly recovered: boolean;
  readonly recordedAt: string;
}
export class BuyerError extends Error {
  readonly code: string;
  readonly operation?: Operation;
  readonly exitCode?: number | null;
  readonly dataset?: Dataset;
  readonly acquisition?: ObjectAcquisition;
  readonly commandId?: string;
  readonly commandDirectory?: string;
  readonly partialPath?: string;
  readonly destination?: string;
  readonly destinationPublished?: boolean;
  constructor(code: string, details?: Record<string, unknown>);
  /** Public diagnostic fields; recovery handles remain directly accessible on the error. */
  toJSON(): { name: string; code: string; exitCode?: number | null; destinationPublished?: boolean };
}
export class Buyer {
  readonly stateDirectory: string;
  constructor(options: BuyerOptions);
  ready(): Promise<this>;
  /** Recovery of the original operator plus this existing application state. */
  workspaceRecovery(): WorkspaceRecovery;
  /** Complete original runbook operations; no extra Buyer state is created. */
  acquisitions(options?: AcquisitionWorkspaceSelection): AcquisitionWorkspace;
  /** Reopen an existing original SF88 inbox without creating a second store. */
  inbox(directory: string): Inbox;
  createInbox(options: { directory: string; signal?: AbortSignal }): Promise<Inbox>;
  inspectOperationHandoff(file: string, options?: { accept?: number; signal?: AbortSignal }): Promise<OperationHandoffView>;
  operation(intentId: string): Operation;
  fromConfig(input: string | JsonObject, options?: ImportOptions): Promise<Operation>;
  /** Adopt original operator configuration; keys are loaded only by its native child. */
  fromWorkspace(directory: string, options?: WorkspaceImportOptions): Promise<Operation>;
  fromOperationHandoff(file: string, options: {
    accept: number; operatorProfile?: OperatorProfile | string; signal?: AbortSignal;
    responseFile?: ResponseCaptureOptions;
    requestTimeoutMs?: number;
  }): Promise<Operation>;
  fromRequest(request: NativeRequest, options?: Omit<ImportOptions, 'body'>): Promise<Operation>;
  call(request: NativeRequest, options?: Omit<ImportOptions, 'body'>): Promise<BuyerResult>;
  discover(catalog: JsonObject, options?: { destination?: string; signal?: AbortSignal }): Promise<JsonObject>;
  prepare(input: {
    discoveryFile: string; row: number; accept: number; intentId: string; url: string;
    method?: string; headers?: Record<string, string>; body?: string | Uint8Array;
    operatorProfile?: OperatorProfile | string; signal?: AbortSignal; ticketFile?: string; ticketHeader?: string;
    responseFile?: ResponseCaptureOptions;
    requestTimeoutMs?: number;
  }): Promise<Operation>;
  list(): AsyncIterable<Operation>;
  dataset(id: string): Dataset;
  createDataset(options: DatasetOptions): Promise<Dataset>;
  attachDataset(options: { id: string; directory: string; accountingOnly?: boolean }): Promise<Dataset>;
  listDatasets(): AsyncIterable<Dataset>;
  object(id: string): ObjectAcquisition;
  createObject(options: ObjectOptions): Promise<ObjectAcquisition>;
  attachObject(options: { id: string; directory: string; accountingOnly?: boolean }): Promise<ObjectAcquisition>;
  listObjects(): AsyncIterable<ObjectAcquisition>;
}
export class Operation {
  readonly intentId: string;
  readonly directory: string;
  readonly configPath: string;
  constructor(buyer: Buyer, intentId: string);
  /** Stops the original offline review child; the prepared operation remains available. */
  review(options?: { signal?: AbortSignal }): Promise<Review>;
  execute(options: { review: Review; signal?: AbortSignal }): Promise<BuyerResult>;
  /** Reads saved output only. This method never launches a native buyer. */
  recover(): Promise<BuyerResult | null>;
  inspect(): Promise<OperationStatus>;
}
export class BuyerResult extends VerifiedFile {
  readonly record: ResultRecord;
  readonly native: NativeSummary;
  readonly status: unknown;
  readonly delivery: { status: string; [key: string]: unknown };
  readonly stream: BuyerStreamSummary | null;
  readonly ok: boolean;
  constructor(record: ResultRecord, responseFile: ResponseCaptureOptions & { destination: string; maxBytes: number },
    runtimeDirectory?: string);
  raiseForStatus(): this;
  events(options?: StreamReadOptions): AsyncIterable<BuyerStreamEvent>;
  ndjson<T = unknown>(options?: StreamReadOptions): AsyncIterable<T>;
}
export abstract class VerifiedFile {
  verify(options?: { chunkSize?: number; signal?: AbortSignal }): Promise<{ bytes: number; sha256: string }>;
  /** Exhaust before committing side effects; final digest verification can throw. */
  chunks(options?: { chunkSize?: number; signal?: AbortSignal }): AsyncIterable<Uint8Array>;
  bytes(options?: { limit?: number; signal?: AbortSignal }): Promise<Uint8Array>;
  json<T = unknown>(options?: { limit?: number; signal?: AbortSignal }): Promise<T>;
  csvRows(options: { headers: true; maxFieldCharacters?: number; signal?: AbortSignal }): AsyncIterable<Record<string, string>>;
  csvRows(options?: { headers?: false; maxFieldCharacters?: number; signal?: AbortSignal }): AsyncIterable<string[]>;
  saveAs(destination: string, options?: { signal?: AbortSignal }): Promise<string>;
}

export interface OperationHandoffView extends JsonObject {
  handoffPath: string;
  handoffSha256: string;
  handoffBytes: number;
  intentId: string;
  sellerUrl: string;
  method: string;
  bodyPresent: boolean;
  bodyBytes: number;
  bodySha256: string;
  acceptIndex: number | null;
  acceptedTerms: NativeRequest['expect'] | null;
  choices: Array<{ acceptIndex: number; acceptedTerms?: NativeRequest['expect']; error?: string }>;
  /** Native redacted ticket metadata, never its bearer value. */
  operationTicket: JsonObject | null;
}
export interface InboxJob extends JsonObject {
  schema: 'stellar-forge.sf88.buyer-inbox.v1';
  id: string;
  state: string;
  operation: JsonObject & { intentId: string };
  /** Unreadable native list rows may contain only an ID and error. */
  configSha256?: string;
  sourceConfigSha256?: string;
  bodyBytes?: number;
  bodySha256?: string | null;
  responseDestination?: string | null;
  operationTicket?: JsonObject | null;
  attempt?: JsonObject | null;
  outcome?: NativeSummary | null;
  lastError?: JsonObject | null;
  recovery?: JsonObject | null;
  finalization?: JsonObject | null;
  retry: 'NO_AUTOMATIC_RETRY';
}
export interface InboxReview {
  readonly root: string;
  readonly intentId: string;
  readonly configSha256: string;
  readonly bodySha256: string | null;
  readonly ticketSha256: string | null;
  readonly reviewedAt: string;
  readonly native: JsonObject;
}
export class InboxResult<T = JsonObject> {
  readonly native: T;
  /** Outcome of this command, separate from the historical buyer attempt. */
  readonly process: {
    readonly exitCode: number | null;
    readonly exitSignal: string | null;
    readonly errorCode: string | null;
  };
  /** Failed/uncertain logs remain private here; also set if successful temporary cleanup failed. */
  readonly commandDirectory: string | null;
}
export class InboxError extends BuyerError {
  readonly result: InboxResult<JsonObject | null>;
  readonly inboxDirectory?: string;
  readonly intentId?: string;
  constructor(code: string, result: InboxResult<JsonObject | null>, details?: Record<string, unknown>);
}
export class Inbox {
  readonly directory: string;
  constructor(buyer: Buyer, directory: string);
  list(options?: {signal?: AbortSignal}): Promise<InboxResult<{
    schema: 'stellar-forge.sf88.buyer-inbox.v1'; root: string; jobs: InboxJob[];
  }>>;
  show(intentId: string, options?: {signal?: AbortSignal}): Promise<InboxResult<InboxJob>>;
  /** Assign a prepared Node operation once; repeat only the identical inbox intake. */
  enqueue(operation: Operation, options?: {signal?: AbortSignal}): Promise<InboxResult<InboxJob>>;
  /** Import a separately prepared original native config, retaining its output/operator paths. */
  enqueueConfig(configFile: string, options?: {signal?: AbortSignal}): Promise<InboxResult<InboxJob>>;
  review(intentId: string, options?: {signal?: AbortSignal}): Promise<InboxReview>;
  execute(intentId: string, options: {
    review: InboxReview; workspaceDirectory?: string; signal?: AbortSignal;
  }): Promise<InboxResult<InboxJob>>;
  /** Cancels an unattempted intent; cannot cancel or undo a recorded purchase. */
  cancel(intentId: string, options?: {signal?: AbortSignal}): Promise<InboxResult<InboxJob>>;
  /** Read and reduce original saved evidence; never repeat buyer execution. */
  recover(intentId: string, options?: {signal?: AbortSignal}): Promise<InboxResult<InboxJob>>;
  finalize(intentId: string, options: {
    workspaceDirectory: string; outboxDirectory?: string; merchantRoute?: string; signal?: AbortSignal;
  }): Promise<InboxResult<InboxJob>>;
  exportReport(destination: string, options?: {
    workspaceDirectory?: string; signal?: AbortSignal;
  }): Promise<InboxResult<{path: string; bytes: number; sha256: string}>>;
  /** Original terminal summary + configured saved response; null if no response record exists. */
  response(intentId: string, options?: {signal?: AbortSignal}): Promise<InboxResponse | null>;
}
/** Verified original bytes and native facts, without a fabricated historical process verdict. */
export class InboxResponse extends VerifiedFile {
  readonly job: InboxJob;
  readonly native: NativeSummary;
  readonly status: unknown;
  readonly delivery: {status: string; [key: string]: unknown};
  readonly stream: BuyerStreamSummary | null;
  constructor(job: InboxJob, responseFile: ResponseCaptureOptions & {destination: string; maxBytes: number},
    runtimeDirectory: string);
  events(options?: StreamReadOptions): AsyncIterable<BuyerStreamEvent>;
  ndjson<T = unknown>(options?: StreamReadOptions): AsyncIterable<T>;
}

export type DatasetScalar = string | number | boolean | null;
export type DatasetRow = Record<string, DatasetScalar>;
export interface DatasetLimits {
  maxPages: number;
  /** Total allocation ceiling, decimal atomic units; this is not a reported charge. */
  maxTotalAtomic: string;
  maxRows?: number;
  maxPageBytes?: number;
}
export type DatasetOptions = DatasetLimits & {
  /** Stable application name, separate from the original config's native intent. */
  id: string;
  expectedSnapshot?: string | null;
} & ({ config: string | JsonObject; operatorProfile?: OperatorProfile | string; workspaceDirectory?: never }
  | { workspaceDirectory: string; config?: never; operatorProfile?: never });
export interface DatasetReport extends JsonObject {
  schema: 'stellar-forge.sf88.dataset-acquisition.v1';
  directory: string;
  status: 'READY' | 'RUNNING' | 'COMPLETE' | 'RECONCILIATION_REQUIRED' | 'PAGE_LIMIT_REACHED' | 'TOTAL_CAP_REACHED';
  /** These fields are absent from the original RUNNING report. */
  sessionId?: string;
  configurationSha256?: string;
  expectedSnapshot?: string | null;
  snapshot?: string | null;
  completedPages?: number;
  acquiredRows?: number;
  totalRows?: number | null;
  capAllocatedAtomic?: string;
  limits?: DatasetLimits;
  pages?: JsonObject[];
  interrupted?: boolean;
  next?: string;
}
export interface DatasetCommand<T = DatasetReport> {
  /** Original report, independent from the application process outcome. */
  readonly native: T;
  readonly process: { readonly exitCode: number | null; readonly exitSignal: string | null; readonly errorCode: string | null };
}
export type DatasetOutputName = 'dataset.jsonl' | 'dataset.csv' | 'review.html' | 'manifest.json';
export interface DatasetOutput { path: string; bytes: number; sha256: string }
export interface DatasetDeliveryReport extends JsonObject {
  schema: 'stellar-forge.sf88.dataset-delivery.v1';
  directory: string;
  sourceDirectory: string;
  sourceBindingSha256: string;
  resumed: boolean;
  appendedPages: number;
  nativeStatus: JsonObject & { snapshot: string; rows: number; finalized: true };
  outputs: Record<DatasetOutputName, DatasetOutput>;
  paymentStatus: string;
}
export class Dataset {
  readonly id: string;
  /** Private application entry; the native session path is in its original report. */
  readonly directory: string;
  readonly lastAccounting?: DatasetAccountingCommand;
  constructor(buyer: Buyer, id: string);
  initialize(options?: { signal?: AbortSignal }): Promise<DatasetCommand>;
  inspect(options?: { signal?: AbortSignal }): Promise<DatasetCommand>;
  recover(options?: { signal?: AbortSignal }): Promise<DatasetCommand>;
  run(options?: { signal?: AbortSignal }): Promise<DatasetCommand>;
  /** Original page financial views; no product file, key or provider is needed. */
  accounting(options?: SessionAccountingOptions): Promise<DatasetAccountingCommand>;
  initializeAccounting(options?: SessionAccountingOptions): Promise<DatasetAccountingCommand>;
  finalize(options?: SessionFinalizationOptions): Promise<DatasetAccountingCommand>;
  accountingPages(options?: SessionAccountingOptions): AsyncIterable<DatasetAccountingCommand>;
  /** Explicitly visit each remaining original range; break/abort starts no next range. */
  finalizeAll(options?: SessionFinalizationOptions): AsyncIterable<DatasetAccountingCommand>;
  /** Local native-output recovery; no process or provider request is started. */
  recoverAccounting(options?: {commandId?: string}): Promise<AccountingRecovery<DatasetAccountingCommand> | null>;
  exportAccounting(destination: string, options?: Omit<SessionAccountingOptions, 'offset'>): Promise<AccountingExport>;
  exportManifest(destination: string, options?: { signal?: AbortSignal }): Promise<DatasetCommand<JsonObject>>;
  /** Offline SF100 export. The same destination resumes its original verified archive. */
  deliver(destination?: string, options?: { signal?: AbortSignal }): Promise<DatasetDelivery>;
}
export class DatasetFile extends VerifiedFile {
  readonly metadata: DatasetOutput & { name: DatasetOutputName };
  readonly directory: string;
  constructor(metadata: DatasetOutput & { name: DatasetOutputName }, directory: string);
}
export class DatasetDelivery {
  readonly report: DatasetDeliveryReport;
  readonly manifest: JsonObject & {
    dataset: { name: string; snapshot: string; rows: number; projectedFields: string[]; [key: string]: unknown };
  };
  constructor(report: DatasetDeliveryReport, manifest: JsonObject);
  file(name: DatasetOutputName): DatasetFile;
  /** Exhaust before committing side effects; final size/hash/row-count validation can throw. */
  rows(options?: { signal?: AbortSignal; maxRowCharacters?: number }): AsyncIterable<DatasetRow>;
  /** Verified in full before returning. JSON scalar types are preserved without coercion. */
  readRows(options?: { limit?: number; maxRows?: number; signal?: AbortSignal }): Promise<DatasetRow[]>;
}

export type ObjectOptions = {
  /** Stable customer name, separate from the original native session UUID. */
  id: string;
  /** Exact whole-download allocation ceiling in decimal atomic units. */
  maxTotalAtomic: string;
} & ({config: string | JsonObject; operatorProfile?: OperatorProfile | string; workspaceDirectory?: string}
  | {workspaceDirectory: string; config?: never; operatorProfile?: never})
  & ({descriptionFile: string; objectId: string; chunkBytes?: number;
    bytes?: never; expectedSnapshot?: never; expectedSha256?: never; expectedContentType?: never}
  | {descriptionFile?: never; objectId?: never; bytes: number; chunkBytes: number;
    expectedSnapshot: string; expectedSha256?: string | null; expectedContentType?: string | null});
export interface ObjectCommandOptions {
  signal?: AbortSignal;
  /** Report paging, independent of the next native chunk to acquire. */
  chunkOffset?: number;
  /** 1–250; default 50. Full report export includes every original chunk. */
  chunkLimit?: number;
}
export interface ObjectChunk extends JsonObject {
  index: number; offset: number; length: number; intentId: string; state: string;
  capAllocatedAtomic: string; attemptId: string | null; originalOutcome: JsonObject | null;
  sha256: string | null; contentType: string | null;
}
export interface ObjectAssembly extends JsonObject {
  schema: 'stellar-forge.sf88.object-assembly.v1';
  sessionId: string; configurationSha256: string; snapshot: string;
  chunkCount: number; chunkManifestSha256: string; destination: string;
  bytes: number; sha256: string; createdAt: string;
  status: 'SAVED' | 'RECORDED'; fileRevalidated: boolean;
  receiptStatus?: 'NOT_RECORDED'; receiptError?: string;
}
export interface ObjectNativeReport extends JsonObject {
  schema: 'stellar-forge.sf88.object-acquisition.v1';
  directory: string; sessionId: string; sourceIntentId: string; configurationSha256: string;
  createdAt: string; inspectedAt: string; sourceUrl: string; workspace: string | null;
  status: 'READY' | 'RUNNING' | 'COMPLETE' | 'INTERRUPTED' | 'RECONCILIATION_REQUIRED';
  bytes: number; chunkBytes: number; chunkCount: number; expectedSnapshot: string;
  expectedSha256: string | null; expectedContentType: string | null;
  completeChunks: number; attemptedChunks: number; downloadedBytes: number;
  capAllocatedAtomic: string; objectSha256: string | null; assembly: ObjectAssembly | null;
  limits: {maxAtomic: string; maxTotalAtomic: string; plannedMaxAtomic: string};
  selection: {schema: string; descriptionSha256: string; objectId: string; filename: string; path: string} | null;
  nextChunk: JsonObject | null;
}
export interface ObjectCommandRecord {
  /** Original released JavaScript bridge; using it does not require Python. */
  mode: 'ORIGINAL_PYTHON_OBJECT'; action: string; report: ObjectNativeReport;
  chunkPage: {offset: number; limit: number; total: number; items: ObjectChunk[]; nextOffset: number | null};
  assemblyPage: {offset: number; total: number; items: ObjectAssembly[]};
  delivery?: {status: string; file: {path: string; bytes: number; sha256: string};
    assembly: ObjectAssembly; sessionId: string; snapshot: string; fileRevalidated: boolean};
  output?: {path: string; format: 'html' | 'json'; scope: 'COMPLETE_ORIGINAL_OBJECT_REPORT'};
}
export class ObjectReport {
  readonly record: ObjectCommandRecord;
  readonly process: {readonly exitCode: number | null; readonly exitSignal: string | null; readonly errorCode: string | null};
  readonly native: ObjectNativeReport;
  readonly status: ObjectNativeReport['status'];
  readonly chunks: readonly ObjectChunk[];
  readonly chunkPage: ObjectCommandRecord['chunkPage'];
  readonly assemblyPage: ObjectCommandRecord['assemblyPage'];
  constructor(record: ObjectCommandRecord, process: ObjectReport['process']);
}
export class ObjectAcquisition {
  readonly id: string;
  /** Private named app entry. Native report.directory is the original session path. */
  readonly directory: string;
  readonly lastReport?: ObjectReport;
  readonly lastAccounting?: ObjectAccountingCommand;
  constructor(buyer: Buyer, id: string);
  /** Offline prepare/attach, or resume initialization after a lost complete response. */
  initialize(options?: ObjectCommandOptions): Promise<ObjectReport>;
  inspect(options?: ObjectCommandOptions): Promise<ObjectReport>;
  /** Invokes the original acquisition for untouched chunks only. */
  run(options?: ObjectCommandOptions): Promise<ObjectReport>;
  recover(options?: ObjectCommandOptions): Promise<ObjectReport>;
  accounting(options?: ObjectAccountingOptions): Promise<ObjectAccountingCommand>;
  initializeAccounting(options?: ObjectAccountingOptions): Promise<ObjectAccountingCommand>;
  /** Explicit native reservation continuation; can query providers and update the original ledger. */
  finalize(options?: ObjectAccountingOptions & {outboxDirectory?: string; merchantRoute?: string}): Promise<ObjectAccountingCommand>;
  accountingPages(options?: ObjectAccountingOptions): AsyncIterable<ObjectAccountingCommand>;
  finalizeAll(options?: SessionFinalizationOptions): AsyncIterable<ObjectAccountingCommand>;
  recoverAccounting(options?: {commandId?: string}): Promise<AccountingRecovery<ObjectAccountingCommand> | null>;
  exportAccounting(destination: string, options?: Omit<ObjectAccountingOptions, 'offset'>): Promise<AccountingExport>;
  /** May acquire new chunks, then assembles or reopens this exact destination. */
  download(destination: string, options?: ObjectCommandOptions): Promise<ObjectDelivery>;
  assemble(destination: string, options?: ObjectCommandOptions): Promise<ObjectDelivery>;
  delivery(destination?: string, options?: ObjectCommandOptions): Promise<ObjectDelivery>;
  exportReport(destination: string, options?: ObjectCommandOptions & {format?: 'html' | 'json'}): Promise<ObjectReport>;
}
export class ObjectDelivery extends VerifiedFile {
  readonly report: ObjectReport;
  readonly path: string;
  readonly assembly: ObjectAssembly;
  readonly receiptRecorded: boolean;
  constructor(report: ObjectReport);
}
export class ObjectDownloadError extends BuyerError {
  readonly acquisition: ObjectAcquisition;
  readonly progress: ObjectReport;
  constructor(code: string, acquisition: ObjectAcquisition, progress: ObjectReport);
}
export interface SessionAccountingOptions {
  workspaceDirectory?: string;
  offset?: number;
  /** Native accounting entries, 1–250; default 100. */
  limit?: number;
  signal?: AbortSignal;
}
export interface SessionFinalizationOptions extends SessionAccountingOptions {
  /** Supplied together; passed to the original financial continuation. */
  outboxDirectory?: string;
  merchantRoute?: string;
}
export interface ObjectAccountingOptions extends SessionAccountingOptions {}
export interface SessionAccountingEntry extends JsonObject {
  /** Original index: dataset pages begin at1, object chunks at0. */
  index: number;
  intentId?: string | null;
  outcome: string;
  actualAtomicUnits?: string | null;
  receipt?: string | null;
  requestSha256?: string | null;
  completedAt?: string | null;
  code?: string;
  lastFinalized?: {completedAt: string; outcome: string; actualAtomicUnits: string; receipt: string} | null;
}
export interface SessionAccountingReport<K extends 'dataset' | 'object' = 'dataset' | 'object'> extends JsonObject {
  schema: 'stellar-forge.sf88.session-accounting.v1'; kind: K;
  directory: string; sessionId: string; configurationSha256: string;
  workspace: string | null; mode: 'VIEW' | 'FINALIZE'; observedAt: string;
  terms: NativeRequest['expect'];
  range: {offset: number; limit: number; total: number; nextOffset: number | null};
  entries: SessionAccountingEntry[];
  interrupted: boolean; recordAuthority: string;
}
export interface ObjectAccountingReport extends SessionAccountingReport<'object'> {}
export interface DatasetAccountingReport extends SessionAccountingReport<'dataset'> {}
export interface SessionAccountingCommand<R extends SessionAccountingReport = SessionAccountingReport> {
  readonly native: R;
  readonly process: ObjectReport['process'];
  readonly record: JsonObject;
  readonly commandId: string;
  readonly commandDirectory: string;
  readonly startedAt: string;
  readonly viewStatus: 'SAVED' | 'SAVE_FAILED' | 'RECOVERED_NATIVE_OUTPUT';
  readonly recovered?: boolean;
}
export interface ObjectAccountingCommand extends SessionAccountingCommand<ObjectAccountingReport> {
  readonly record: {readonly mode: 'ORIGINAL_PYTHON_OBJECT'; readonly action: 'accounting' | 'finalize';
    readonly report: ObjectAccountingReport};
}
export interface DatasetAccountingCommand extends SessionAccountingCommand<DatasetAccountingReport> {
  readonly record: {readonly schema: 'stellar-forge.node-dataset-command.v1'; readonly id: string;
    readonly command: 'accounting' | 'finalize'; readonly result: DatasetAccountingReport};
}
export interface AccountingRecovery<C extends SessionAccountingCommand = SessionAccountingCommand> {
  readonly commandId: string;
  readonly commandDirectory: string;
  readonly action: 'accounting' | 'finalize';
  readonly startedAt: string;
  readonly status: 'RECORDED' | 'OUTPUT_RECOVERED' | 'NO_COMPLETE_OUTPUT';
  readonly process: ObjectReport['process'];
  readonly result: C | null;
  /** Most recent complete range, also retained when a later command has no complete output. */
  readonly lastComplete: C | null;
}
export interface AccountingExport {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly ranges: number;
  readonly entries: number;
  readonly kind: 'dataset' | 'object';
  readonly sessionId: string;
  readonly configurationSha256: string;
  readonly format: 'jsonl';
  readonly scope: 'COMPLETE_ORIGINAL_ACCOUNTING_VIEW';
}

/** Recovery uses the original native CLI; this constructor creates no application state. */
export type WorkspaceRecoveryOptions = Pick<BuyerOptions,
  'runtimeDirectory' | 'node' | 'environment' | 'timeoutMs' | 'cleanupGraceMs' | 'outputLimit'>;
export type WorkspaceRecoveryOperation = 'inspect' | 'snapshot' | 'verify' | 'restore';
export interface WorkspaceRecoverySelection {
  directory: string;
  stateRoot: string;
  inboxes?: readonly string[];
  include?: readonly string[];
  signal?: AbortSignal;
}
export interface WorkspaceRecoverySnapshotOptions extends WorkspaceRecoverySelection {
  output: string;
  /** The caller has actually stopped writers; this does not stop them. */
  quiesced: true;
  /** Environment variable NAME only. Defaults to SF88_BACKUP_PASSPHRASE. */
  passphraseEnv?: string;
}
export interface WorkspaceRecoveryArchiveOptions {
  bundle: string;
  passphraseEnv?: string;
  /** Current trusted absolute interpreter; not an interpreter selected by the archive. */
  python?: string;
  expectedRecordSha256?: string;
  signal?: AbortSignal;
}
export interface WorkspaceRecoveryPlan extends JsonObject {
  schema: 'stellar-forge.sf88.workspace-recovery.v1';
  stateRoot: string;
  directory: string;
  selected: string[];
  include: string[];
  missing: string[];
  parentDirectories: string[];
  network: string;
  payer: string;
  ledger: string;
  policy: string;
  keys: string;
  python: string;
  walletEnvironment: string | null;
  walletEnvironmentExported: false;
  restoreMode: 'ORIGINAL_CANONICAL_STATE_ROOT';
  runtime: { path: string; retained: false }[];
  inboxes: {
    root: string;
    jobs: { id: string; intentId: string; state: string; configSha256: string;
      attemptId: string | null; finality: unknown }[];
  }[];
}
export interface WorkspaceRecoveryRecord extends JsonObject {
  schema: 'stellar-forge.sf88.workspace-recovery.v1';
  recordSha256: string;
  createdAt: string;
  stateRoot: string;
  directory: string;
  network: string;
  payer: string;
  files: number;
  bytes: number;
  checkpoint: JsonObject;
  inboxes: { root: string; jobs: number }[];
  runtime: { path: string; retained: false }[];
  walletEnvironmentExported: false;
}
export interface WorkspaceRecoverySnapshot extends WorkspaceRecoveryRecord {
  status: 'BUYER_STATE_BACKUP_CREATED';
  bundle: string;
}
export interface WorkspaceRecoveryVerification extends WorkspaceRecoveryRecord {
  status: 'BUYER_STATE_BACKUP_VERIFIED';
}
export interface WorkspaceRecoveryRestore extends WorkspaceRecoveryRecord {
  status: 'BUYER_STATE_RESTORED';
  executionStarted: false;
  originalStateRetained: true;
}
export type WorkspaceRecoveryNative = WorkspaceRecoveryPlan | WorkspaceRecoverySnapshot |
  WorkspaceRecoveryVerification | WorkspaceRecoveryRestore;
export interface WorkspaceRecoveryProcess {
  readonly exitCode: number | null;
  readonly exitSignal: string | null;
  readonly errorCode: string | null;
  readonly started: boolean;
  readonly cleanupErrorCode: string | null;
}
export class WorkspaceRecoveryResult<T extends WorkspaceRecoveryNative = WorkspaceRecoveryNative> {
  private constructor();
  readonly operation: WorkspaceRecoveryOperation;
  readonly native: Readonly<T> | null;
  readonly process: WorkspaceRecoveryProcess;
  /** Original completion was received. False does not assert that no state was published. */
  readonly completionReported: boolean;
  readonly ok: boolean;
}
export type WorkspaceRecoverySuccess<T extends WorkspaceRecoveryNative> =
  WorkspaceRecoveryResult<T> & { readonly native: Readonly<T>; readonly completionReported: true; readonly ok: true };
export class WorkspaceRecoveryError extends BuyerError {
  readonly result: WorkspaceRecoveryResult;
  constructor(code: string, result: WorkspaceRecoveryResult);
}
export class WorkspaceRecovery {
  constructor(options: WorkspaceRecoveryOptions);
  /** Reuses the Buyer runtime and includes its existing application directory in capture. */
  static fromBuyer(buyer: Buyer): WorkspaceRecovery;
  inspect(options: WorkspaceRecoverySelection): Promise<WorkspaceRecoverySuccess<WorkspaceRecoveryPlan>>;
  snapshot(options: WorkspaceRecoverySnapshotOptions): Promise<WorkspaceRecoverySuccess<WorkspaceRecoverySnapshot>>;
  verify(options: WorkspaceRecoveryArchiveOptions): Promise<WorkspaceRecoverySuccess<WorkspaceRecoveryVerification>>;
  restore(options: WorkspaceRecoveryArchiveOptions): Promise<WorkspaceRecoverySuccess<WorkspaceRecoveryRestore>>;
}

/** Complete original buyer-runbook workspaces, independent of single-operator recovery. */
export interface AcquisitionWorkspaceSelection {
  /** Omit only when verifying/restoring an archive without live state. */
  directory?: string;
  /** Required to create a new original workspace; immutable thereafter. */
  configsDirectory?: string;
  /** Receiver-owned preset with original payer/signer and budget limits. */
  operatorSettings?: string;
  /** Host-selected SF101 claim environment names (1–32); values stay in runtime environment. */
  paidFileClaimEnvs?: readonly string[];
  /** Existing canonical parent outside selected source state; defaults to OS temp. */
  temporaryDirectory?: string;
  /** Separate native result budget, 1–256 MiB; default 32 MiB. */
  resultLimit?: number;
}
export type AcquisitionWorkspaceOptions = WorkspaceRecoveryOptions & AcquisitionWorkspaceSelection;
export interface AcquisitionProcess {
  readonly exitCode: number | null;
  readonly exitSignal: string | null;
  readonly started: boolean;
  readonly errorCode: string | null;
  readonly nativeErrorCode: string | null;
  readonly cleanupErrorCode: string | null;
  readonly callerCancelled: boolean;
  readonly interrupted: boolean;
}
export class AcquisitionResult<T extends JsonObject = JsonObject> {
  private constructor();
  readonly command: string;
  readonly commandId: string;
  readonly native: Readonly<T> | null;
  readonly process: AcquisitionProcess;
  /** A false value does not assert that no original state was published. */
  readonly completionReported: boolean;
  readonly ok: boolean;
}
export type AcquisitionSuccess<T extends JsonObject = JsonObject> =
  AcquisitionResult<T> & {readonly native: Readonly<T>; readonly completionReported: true; readonly ok: true};
export class AcquisitionError extends BuyerError {
  readonly result: AcquisitionResult;
  constructor(code: string, result: AcquisitionResult);
}
export interface AcquisitionManifest extends JsonObject {
  schema: 'stellar-forge.buyer-runbook.v1';
  id: string;
  title: string;
  operations: Array<{id: string; label: string; config: string; saveAs?: string}>;
}
export interface AcquisitionPlan extends JsonObject {
  id: string;
  title: string;
  directory: string;
  operations: JsonObject[];
}
export interface AcquisitionDraft extends JsonObject {
  id: string;
  revision: number;
  reviewSha256: string;
  manifest: AcquisitionManifest;
  plan: AcquisitionPlan;
  revisions: number[];
}
export interface AcquisitionReady extends JsonObject {
  id: string;
  intentId: string;
  configName: string;
  configPath: string;
  configSha256: string;
  operatorDirectory: string;
  generation: number;
  reviewRevision: number;
  reviewSha256: string;
}
export interface AcquisitionRequestReview extends JsonObject {
  id: string;
  revision: number;
  reviewSha256: string;
  acceptIndex: number;
  acceptedTerms: JsonObject;
  totalAtomic: string;
  dailyAtomic: string;
}
export interface AcquisitionRequest extends JsonObject {
  id: string;
  filename: string;
  handoffSha256: string;
  view: OperationHandoffView;
  review: AcquisitionRequestReview | null;
  prepared: AcquisitionReady | null;
  expired: boolean;
}
export interface AcquisitionPaidFileReview extends JsonObject {
  id: string;
  revision: number;
  reviewSha256: string;
  handoffSha256: string;
  acceptedTerms: JsonObject;
  totalAtomic: string;
  dailyAtomic: string;
  filename: string;
  claimEnv: string;
}
export interface AcquisitionPaidFileReady extends JsonObject {
  id: string;
  intentId: string;
  configName: string;
  configPath: string;
  configSha256: string;
  operatorDirectory: string;
  reviewRevision: number;
  reviewSha256: string;
  paidFile: JsonObject & {handoffSha256: string; destination: string; claimEnv: string};
}
export interface AcquisitionPaidFileOrder extends JsonObject {
  id: string;
  filename: string;
  handoffSha256: string;
  handoff: JsonObject;
  review: AcquisitionPaidFileReview | null;
  prepared: AcquisitionPaidFileReady | null;
  preparing: boolean;
  claimEnvs: Array<{name: string; available: boolean}>;
}
export interface AcquisitionPaidFileView extends JsonObject {
  id: string;
  orderReference: string;
  purchaseUrl: string;
  deliveryUrl: string;
  file: JsonObject & {bytes: number; sha256: string};
  destination: string;
  handoffSha256: string;
  configSha256: string;
  delivery: JsonObject;
  transfer: JsonObject;
  claimEnv: string;
  claimAvailable: boolean;
}
export interface AcquisitionPaidFileTransferOptions {
  only: string;
  configSha256: string;
  handoffSha256: string;
  signal?: AbortSignal;
}
export interface AcquisitionRunView extends JsonObject {
  id: string;
  planSha256: string;
  state: JsonObject & {
    plan: AcquisitionPlan;
    operations: Array<JsonObject & {id: string; intentId: string; state: string;
      paidFile?: AcquisitionPaidFileView | {error: string}}>;
    accounting: JsonObject;
    executionLock: JsonObject | null;
  } | null;
  stateRefreshError?: string | null;
  terminalAvailable: boolean | null;
  execution?: JsonObject & {
    executionId: string;
    status: string;
    result?: JsonObject & {results?: JsonObject[]};
    error?: string;
  };
}
export interface AcquisitionWorkspaceState extends JsonObject {
  directory: string;
  configsDirectory: string;
  drafts: Array<JsonObject & {id: string; revision: number; initialized: boolean}>;
  acquisitions: Array<{id: string; title: string; planId: string; imported: boolean}>;
  intake: JsonObject & {requests: Array<JsonObject & {id: string; prepared: AcquisitionReady | null}>};
  recovery: JsonObject & {history: JsonObject[]};
  paidFiles: JsonObject & {requests: Array<JsonObject & {id: string; prepared: AcquisitionPaidFileReady | null}>;
    claimEnvs: Array<{name: string; available: boolean}>};
  configurations: JsonObject[];
  terminalAvailable: boolean;
}
export interface AcquisitionRecoveryReview extends JsonObject {
  profile: JsonObject & {
    directory: string; configsDirectory: string; stateRoot: string; reviewSha256: string;
    operators: string[]; runs: JsonObject[]; requests: JsonObject[];
    restoreMode: 'ORIGINAL_CANONICAL_STATE_ROOT';
  };
  native: JsonObject;
}
export interface AcquisitionArchive extends JsonObject {
  schema: 'stellar-forge.sf88.workspace-recovery.v2';
  status: 'BUYER_STATE_BACKUP_CREATED' | 'BUYER_STATE_BACKUP_VERIFIED' | 'BUYER_STATE_RESTORED';
  recordSha256: string;
  bundle: string;
  directory: string;
  stateRoot: string;
  operators: Array<JsonObject & {directory: string; checkpoint: JsonObject}>;
  files: number;
  bytes: number;
  reopened?: JsonObject & {acquisitions: number; requests: number};
  executionStarted?: false;
}
export interface AcquisitionExport extends JsonObject {
  destination: string;
  bytes: number;
  sha256: string;
  published: true;
  publicationSyncError: string | null;
}
export interface AcquisitionArchiveOptions {
  bundle: string;
  expectedRecordSha256?: string;
  /** Environment variable NAME, never the passphrase value. */
  passphraseEnv?: string;
  /** Receiver-owned interpreter for original ledger verification. */
  python?: string;
  signal?: AbortSignal;
}
export class AcquisitionWorkspace {
  /** Construction never creates state or loads a wallet. */
  constructor(options: AcquisitionWorkspaceOptions);
  static fromBuyer(buyer: Buyer, options?: AcquisitionWorkspaceSelection): AcquisitionWorkspace;
  readonly directory: string | null;
  readonly configsDirectory: string | null;
  readonly operatorSettings: string | null;
  readonly paidFileClaimEnvs: readonly string[] | null;
  state(options?: {signal?: AbortSignal}): Promise<AcquisitionSuccess<AcquisitionWorkspaceState>>;
  attachRun(run: string, options?: {signal?: AbortSignal}): Promise<AcquisitionSuccess<AcquisitionWorkspaceState>>;
  request(id: string, options?: {signal?: AbortSignal}): Promise<AcquisitionSuccess<AcquisitionRequest>>;
  receiveRequest(file: string, options?: {filename?: string; signal?: AbortSignal}): Promise<AcquisitionSuccess<AcquisitionRequest>>;
  reviewRequest(id: string, options: {
    acceptIndex: number; totalAtomic: string; dailyAtomic: string; signal?: AbortSignal;
  }): Promise<AcquisitionSuccess<AcquisitionRequest>>;
  prepareRequest(id: string, options: {reviewSha256: string; signal?: AbortSignal}): Promise<AcquisitionSuccess<AcquisitionReady>>;
  paidFile(id: string, options?: {signal?: AbortSignal}): Promise<AcquisitionSuccess<AcquisitionPaidFileOrder>>;
  receivePaidFile(file: string, options?: {filename?: string; signal?: AbortSignal}):
    Promise<AcquisitionSuccess<AcquisitionPaidFileOrder>>;
  reviewPaidFile(id: string, options: {
    expectedRevision: number; totalAtomic: string; dailyAtomic: string;
    filename: string; claimEnv: string; signal?: AbortSignal;
  }): Promise<AcquisitionSuccess<AcquisitionPaidFileOrder>>;
  preparePaidFile(id: string, options: {reviewSha256: string; signal?: AbortSignal}):
    Promise<AcquisitionSuccess<AcquisitionPaidFileReady>>;
  /** Pause by aborting the caller signal; resume selects the same exact original operation. */
  retrievePaidFile(id: string, options: AcquisitionPaidFileTransferOptions):
    Promise<AcquisitionSuccess<AcquisitionRunView>>;
  resetPaidFile(id: string, options: AcquisitionPaidFileTransferOptions):
    Promise<AcquisitionSuccess<AcquisitionRunView>>;
  downloadPaidFile(id: string, operationId: string, destination: string, options?: {signal?: AbortSignal}):
    Promise<AcquisitionSuccess<AcquisitionExport>>;
  exportPaidFile(id: string, options: {destination: string; signal?: AbortSignal}):
    Promise<AcquisitionSuccess<AcquisitionExport>>;
  draft(id: string, options?: {revision?: number; signal?: AbortSignal}): Promise<AcquisitionSuccess<AcquisitionDraft>>;
  save(options: {
    id?: string; expectedRevision?: number; manifest: AcquisitionManifest; signal?: AbortSignal;
  }): Promise<AcquisitionSuccess<AcquisitionDraft>>;
  initialize(id: string, options: {
    expectedRevision: number; reviewSha256: string; signal?: AbortSignal;
  }): Promise<AcquisitionSuccess<AcquisitionRunView>>;
  inspect(id: string, options?: {signal?: AbortSignal}): Promise<AcquisitionSuccess<AcquisitionRunView>>;
  /** Exact reviewed plan plus the original native controlling-terminal approval. */
  execute(id: string, options: {
    expectedPlanSha256: string; only?: string; signal?: AbortSignal;
  }): Promise<AcquisitionSuccess<AcquisitionRunView>>;
  recover(id: string, options?: {signal?: AbortSignal}): Promise<AcquisitionSuccess<AcquisitionRunView>>;
  unlock(id: string, options: {ownerPid: number; signal?: AbortSignal}): Promise<AcquisitionSuccess<AcquisitionRunView>>;
  finalize(id: string, options?: {only?: string; signal?: AbortSignal}): Promise<AcquisitionSuccess<AcquisitionRunView>>;
  bindAccounting(id: string, options: {
    only: string; workspace: string; signal?: AbortSignal;
  }): Promise<AcquisitionSuccess<AcquisitionRunView>>;
  preview(id: string, operationId: string, options?: {signal?: AbortSignal}): Promise<AcquisitionSuccess<JsonObject>>;
  download(id: string, operationId: string, destination: string,
    options?: {signal?: AbortSignal}): Promise<AcquisitionSuccess<AcquisitionExport>>;
  export(id: string, options: {
    format: 'json' | 'html' | 'csv'; destination: string; signal?: AbortSignal;
  }): Promise<AcquisitionSuccess<AcquisitionExport>>;
  exportRequest(id: string, options: {
    kind: 'body' | 'handoff'; destination: string; signal?: AbortSignal;
  }): Promise<AcquisitionSuccess<AcquisitionExport>>;
  backupReview(options: {stateRoot: string; signal?: AbortSignal}): Promise<AcquisitionSuccess<AcquisitionRecoveryReview>>;
  backup(options: {
    stateRoot: string; output: string; reviewSha256: string; quiesced: true;
    passphraseEnv?: string; signal?: AbortSignal;
  }): Promise<AcquisitionSuccess<AcquisitionArchive>>;
  verify(options: AcquisitionArchiveOptions): Promise<AcquisitionSuccess<AcquisitionArchive>>;
  restore(options: AcquisitionArchiveOptions): Promise<AcquisitionSuccess<AcquisitionArchive>>;
}
