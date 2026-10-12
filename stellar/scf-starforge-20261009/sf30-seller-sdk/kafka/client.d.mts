// MIT. Complete typed contract for the original Kafka workspace Node consumer.
import type { Buffer } from 'node:buffer';

/** Original lower-case SHA-256 identifiers are validated at every request boundary. */
export type KafkaId = string;
/** Original nonnegative signed-64 decimal token; never a JavaScript number. */
export type KafkaOffset = string;
export type KafkaOperation = string;
export type KafkaJsonPrimitive = null | boolean | string | number | KafkaJsonNumber;
export type KafkaJsonValue = KafkaJsonPrimitive | KafkaJsonValue[] | KafkaJsonObject;
export interface KafkaJsonObject { [name: string]: KafkaJsonValue | undefined; }
export interface KafkaNumberTransport { $kafkaNumber: string; }
export class KafkaJsonNumber {
  constructor(source: string);
  readonly source: string;
  toString(): string;
  valueOf(): never;
  /** Ordinary JSON.stringify emits an exact tagged numeric lexeme for MCP transport. */
  toJSON(): KafkaNumberTransport;
}
export function parseKafkaJson(text: string): KafkaJsonValue;
/** Emits native raw number lexemes for KafkaJsonNumber; never rounds them through Number. */
export function stringifyKafkaJson(value: unknown, space?: number | string): string;
export function kafkaOffset(value: string): KafkaOffset;
export const KAFKA_CLIENT_SCHEMA: 'stellar-forge.kafka-workspace-client.v1';
export const KAFKA_CONNECTION_SCHEMA: 'stellar-forge.kafka-client-connection.v1';
export const KAFKA_LAUNCH_SCHEMA: 'stellar-forge.kafka-workspace-launch.v1';
export const KAFKA_LIMITS: Readonly<{
  connectionBytes: number; requestBytes: number; datasetRequestBytes: number;
  sourceBytes: number; nativePacketBytes: number; kafkaPacketBytes: number;
  jsonBytes: number; downloadBytes: number;
}>;
export type KafkaCaptureStatus = 'PREPARED' | 'RUNNING' | 'CANCELLING' | 'CANCELLED' |
  'INTERRUPTED' | 'COMPLETE' | 'LIMIT_REACHED' | 'SOURCE_GAP' | 'SOURCE_CHANGED' |
  'SOURCE_CONFLICT' | 'ERROR';
export const KAFKA_CAPTURE_STATUSES: readonly KafkaCaptureStatus[];

export interface KafkaClientDefinition {
  connectionFile: string;
  expectedWorkspaceId?: string;
  expectedBindingSha256?: KafkaId;
}
export interface KafkaRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maximumJsonBytes?: number;
}
export interface KafkaClientOptions extends KafkaRequestOptions {
  /** One to four outstanding native requests; the browser shares the original eight slots. */
  concurrency?: number;
}
export interface KafkaUploadOptions extends KafkaRequestOptions {
  /** Complete original file SHA is checked before any upload bytes are sent. */
  sha256?: KafkaId;
}
export interface KafkaDownloadOptions extends KafkaRequestOptions {
  maximumBytes?: number;
  /** Optional expected full response file SHA; checked before publishing the destination. */
  sha256?: KafkaId;
}
export interface KafkaBinding {
  workspace: string;
  workspaceId: string;
  bindingSha256: KafkaId;
}
export interface KafkaPythonIdentity {
  executable: string; prefix: string; basePrefix: string; implementation: string;
  version: number[];
}
export interface KafkaNativeLaunch extends KafkaBinding {
  schema: 'stellar-forge.kafka-workspace-launch.v1';
  status: 'KAFKA_WORKSPACE_READY';
  sourceRoot: string; python: KafkaPythonIdentity; pid: number;
  /** Private original console capability. This field is omitted by client.inspect(). */
  console: string;
  connectionFile?: string;
}
export interface KafkaApplicationConnection {
  applicationId: string; operationId: string; observedAt: string;
  original: Pick<KafkaNativeLaunch, 'schema' | 'workspace' | 'workspaceId' | 'bindingSha256' | 'sourceRoot' | 'pid'>;
}
export interface KafkaWorkspaceConnection {
  readonly schema: 'stellar-forge.kafka-client-connection.v1';
  readonly connectionFile: string; readonly origin: string; readonly port: number;
  readonly fileSha256: KafkaId;
  readonly application?: Readonly<KafkaApplicationConnection>;
  /** Non-enumerable private capability, for the host transport only. */
  readonly token: string;
  /** Non-enumerable original private URL, for the host transport only. */
  readonly consoleUrl: string;
}
export interface KafkaClientInspection extends KafkaBinding {
  schema: 'stellar-forge.kafka-workspace-client.v1';
  status: 'KAFKA_WORKSPACE_READY';
  sourceRoot: string; python: KafkaPythonIdentity; pid: number; origin: string;
  connectionFile: string; connectionSha256: KafkaId;
  application?: { applicationId: string; operationId: string; observedAt: string };
}
export function readKafkaWorkspaceConnection(filename: string): Promise<Readonly<KafkaWorkspaceConnection>>;
export function readKafkaHostFile(filename: string, maximum: number, options?: {
  privateFile?: boolean; sha256?: KafkaId;
}): Promise<Buffer>;

export interface KafkaSecurityConfiguration {
  protocol: 'PLAINTEXT' | 'SSL' | 'SASL_PLAINTEXT' | 'SASL_SSL';
  mechanism?: 'PLAIN' | 'SCRAM-SHA-256' | 'SCRAM-SHA-512';
  usernameEnv?: string; passwordEnv?: string;
  caFileEnv?: string; certificateFileEnv?: string; keyFileEnv?: string; keyPasswordEnv?: string;
}
export interface KafkaConnectionConfiguration {
  schema: 'stellar-forge.kafka-connection.v1';
  label: string; brokers: string[]; topic: string;
  security: KafkaSecurityConfiguration;
  requestTimeoutSeconds: number; maxMessageBytes: number;
  maxCaptureBytes: number; maxCaptureRecords: number;
}
export interface KafkaSaveConnectionRequest {
  connection: KafkaOperation; expectedRevision: number; operation: KafkaOperation;
  config: KafkaConnectionConfiguration;
}
export interface KafkaSavedConnection {
  id: KafkaOperation; revision: number; sha256: KafkaId; operation: KafkaOperation;
  config: KafkaConnectionConfiguration; createdAt: string;
}
export interface KafkaClientStatus extends KafkaJsonObject {
  available: boolean;
}
export interface KafkaInspectConnectionRequest {
  connection: KafkaOperation; revision: number; operation: KafkaOperation;
}
export interface KafkaPartitionBounds {
  partition: number;
  /** Earliest currently retained offset. */
  low: KafkaOffset;
  /** Read-uncommitted high watermark, preserved separately from the committed end. */
  high: KafkaOffset;
  /** Original read-committed end used by capture selection. */
  end: KafkaOffset;
  observedAt: string;
}
export interface KafkaInspection {
  id: KafkaId; operation: KafkaOperation;
  connection: KafkaOperation; connectionRevision: number; configSha256: KafkaId;
  observedAt: string; client: KafkaClientStatus;
  clusterId: string; topicId: string; topic: string; partitions: KafkaPartitionBounds[];
}
export interface KafkaCaptureRangeSelection {
  partition: number; start: KafkaOffset; end: KafkaOffset;
}
export interface KafkaPrepareCaptureRequest {
  inspection: KafkaId; operation: KafkaOperation; ranges: KafkaCaptureRangeSelection[];
}
export interface KafkaCaptureRevisionRequest { capture: KafkaId; expectedRevision: number; }
export interface KafkaCaptureRange extends KafkaCaptureRangeSelection {
  next: KafkaOffset; status: string; records: number; bytes: number;
  terminalEvidence: KafkaJsonValue;
}
export interface KafkaCaptureAttempt extends KafkaJsonObject {
  id: KafkaId;
}
export interface KafkaCapture {
  id: KafkaId; operation: KafkaOperation; inspection: KafkaId;
  connection: KafkaOperation; connectionRevision: number; configSha256: KafkaId;
  clusterId: string; topicId: string; topic: string;
  status: KafkaCaptureStatus; revision: number;
  records: number; bytes: number; retainedBytes: number; boundaryBytes: number; boundaryRecords: number;
  ranges: KafkaCaptureRange[]; createdAt: string; updatedAt: string;
  error: KafkaJsonValue; attempts: KafkaCaptureAttempt[];
}
export interface KafkaWaitOptions { signal?: AbortSignal; timeoutMs?: number; pollMs?: number; }
export interface KafkaPagination { offset?: number; limit?: number; }
export type KafkaTimestampType = 'NOT_AVAILABLE' | 'CREATE_TIME' | 'LOG_APPEND_TIME';
export interface KafkaMessageIdentity {
  id: KafkaId; sha256: KafkaId; clusterId: string; topicId: string; topic: string;
  partition: number; offset: KafkaOffset; timestampType: KafkaTimestampType;
  timestampMs: string | null; leaderEpoch: number | null;
}
export interface KafkaMessageSummary extends KafkaMessageIdentity {
  keyState: 'null' | 'empty' | 'utf8' | 'binary';
  keyUtf8Preview: string | null; keyPreviewTruncated: boolean;
  keyBytes: number | null; valueBytes: number | null; headerCount: number; wireBytes: number;
  valueState: 'tombstone' | 'present'; goldskyOperation: string | null; deleted: boolean;
}
export interface KafkaMessage extends KafkaMessageIdentity {
  keyBase64: string | null; valueBase64: string | null;
  headers: {name: string; valueBase64: string | null}[];
  keyUtf8: string | null; value: KafkaJsonValue; valueState: string;
  parseError: string | null; goldskyOperation: string | null; deleted: boolean;
  /** The exact native decoded JSON numeric text. Do not parse through ordinary Number. */
  valueJson: string | null;
}
export interface KafkaMessagePage {
  capture: KafkaId; offset: number; limit: number; total: number; messages: KafkaMessageSummary[];
}
export interface KafkaProjectionRequest {
  operation: KafkaOperation; captures: {id: KafkaId; revision: number}[];
  view: 'events' | 'latest-per-partition-key';
  decode: 'json' | 'bytes';
  deletePolicy: 'retain' | 'tombstone' | 'tombstone-or-goldsky';
  acceptIncomplete: boolean; label: string;
}
export interface KafkaMappingColumn {
  name: string; path?: (string | number)[];
  type?: 'string' | 'integer' | 'number' | 'boolean';
  nullable?: boolean; mode?: 'scalar' | 'json' | 'state'; missing?: 'error' | 'null';
}
export interface KafkaMappingPlan {
  schema: 'stellar-forge.ndjson-mapping.v1'; name: string;
  recordPath?: (string | number)[]; columns: KafkaMappingColumn[];
  filters?: string[]; ranges?: string[]; sorts?: string[]; keys?: string[];
  defaultLimit?: number; maxLimit?: number; maxBytes?: number; maxRows?: number;
  maxCellChars?: number; allowEmpty?: boolean;
}
export interface KafkaSourceView {
  id: KafkaId; label: string; name: string; bytes: number; created: string;
  inventory: KafkaJsonObject;
}
export interface KafkaProjection {
  id: KafkaId; operation: KafkaOperation; source: KafkaId; selection: KafkaProjectionRequest;
  coverage: KafkaCapture[]; records: number; bytes: number; retainedBytes: number;
  excluded: number; createdAt: string; sourceView: KafkaSourceView; defaultPlan: KafkaMappingPlan;
}
export interface KafkaSavedPlan {id: KafkaId; plan: KafkaMappingPlan;}
export interface KafkaBuildRequest {source: KafkaId; plan: KafkaId;}
export interface KafkaFileDigest {bytes: number; sha256: KafkaId;}
export interface KafkaBuildView {
  schema: string; id: KafkaId; source: KafkaId; plan: KafkaId; rowCount: number;
  keys: string[]; columns: {column: string; emptyCells: number; nullValues: number}[];
  native: KafkaJsonObject; engineBlob: string; files: Record<string,KafkaFileDigest>;
}
export interface KafkaQueryRequest {build: KafkaId; query: Record<string,string>;}
/** The unchanged original dataset engine response, with exact JSON numbers preserved. */
export interface KafkaQueryResult extends KafkaJsonObject {id: number; ok: true;}
export interface KafkaCompareRequest {before: KafkaId; after: KafkaId;}
export interface KafkaComparison {
  schema: string; id: KafkaId; before: KafkaId; after: KafkaId; plan: KafkaId;
  keys: string[]; semantics: string;
  counts: {added: number; removed: number; changed: number; unchanged: number};
  changesSha256: KafkaId;
}
export interface KafkaChange extends KafkaJsonObject {
  kind: string; key: KafkaJsonValue;
}
export interface KafkaChangePage {rows: KafkaChange[]; offset: number; nextOffset: number | null;}
export interface KafkaWorkspaceState {
  schema: string;
  sources: {id: KafkaId; label: string; name: string; bytes: number; created: string}[];
  plans: {id: KafkaId; name: string; created: string}[];
  builds: KafkaBuildView[]; comparisons: KafkaComparison[];
  kafka: {
    schema: 'stellar-forge.kafka-state.v1'; workspaceId: string; client: KafkaClientStatus;
    connections: KafkaSavedConnection[]; inspections: KafkaInspection[];
    captures: KafkaCapture[]; projections: Omit<KafkaProjection,'sourceView' | 'defaultPlan'>[];
    activeCapture: KafkaId | null;
  };
}
export interface KafkaConfiguredTopic {
  connection: KafkaOperation; revision: number; configSha256: KafkaId; topic: string; brokers: string[];
}
export interface KafkaReceivedProject {
  schema: 'stellar-forge.kafka-receiving.v1'; id: KafkaId;
  projection: KafkaId; source: KafkaId; plan: KafkaId; build: KafkaBuildView; captures: KafkaId[];
  receivedAt: string; manifestSha256: KafkaId; reconstructed: true; reopened?: boolean;
}
export interface KafkaReceivedNative {
  source: KafkaId; plan: KafkaId; build: KafkaBuildView; reconstructed: true;
}
/** Payment terms are passed intact to the original NDJSON merchant preparer. */
export interface KafkaMerchantRequest {
  build: KafkaId; payment: KafkaJsonObject; origin: string; path: string;
}
export type KafkaDownloadKind = 'kafka-project' | 'ndjson-project' | 'dataset' |
  'comparison-changes' | 'merchant' | 'message' | 'state' | 'projection' | 'record' | 'query';
export type KafkaDownloadRecordKind = 'connection' | 'inspection' | 'capture' | 'source' | 'plan';
export interface KafkaCompletedDownload {
  schema: 'stellar-forge.kafka-client-download.v1'; kind: KafkaDownloadKind;
  path: string; bytes: number; sha256: KafkaId; contentType: string;
  workspaceId: string; bindingSha256: KafkaId;
  request: {method: 'GET' | 'POST'; route: string; bodySha256?: KafkaId};
}
export interface KafkaInspectedFile {
  schema: 'stellar-forge.kafka-client-file.v1'; path: string; bytes: number; sha256: KafkaId;
}
export function inspectKafkaDownload(filename: string, options?: {
  maximumBytes?: number; sha256?: KafkaId; signal?: AbortSignal;
}): Promise<KafkaInspectedFile>;
export interface KafkaErrorDetails {
  status?: number; outcomeUnknown?: boolean; method?: string; route?: string;
  retainedFile?: KafkaCompletedDownload;
}
export class KafkaWorkspaceError extends Error implements KafkaErrorDetails {
  constructor(code: string, message: string, details?: KafkaErrorDetails);
  readonly code: string;
  status?: number; outcomeUnknown?: boolean; method?: string; route?: string;
  retainedFile?: KafkaCompletedDownload;
  toJSON(): {code: string; message: string} & KafkaErrorDetails;
}
export class KafkaWorkspaceClient {
  constructor(definition: KafkaClientDefinition, options?: KafkaClientOptions);
  readonly definition: Readonly<KafkaClientDefinition>;
  readonly closed: boolean;
  readonly binding: KafkaBinding | null;
  inspect(options?: KafkaRequestOptions): Promise<KafkaClientInspection>;
  state(options?: KafkaRequestOptions): Promise<KafkaWorkspaceState>;
  /** Saved exact-topic connections; this does not issue a broker-wide topic scan. */
  configuredTopics(options?: KafkaRequestOptions): Promise<KafkaConfiguredTopic[]>;
  connection(id: KafkaOperation, options?: KafkaRequestOptions): Promise<KafkaSavedConnection>;
  saveConnection(request: KafkaSaveConnectionRequest, options?: KafkaRequestOptions): Promise<KafkaSavedConnection>;
  inspectConnection(request: KafkaInspectConnectionRequest, options?: KafkaRequestOptions): Promise<KafkaInspection>;
  inspection(id: KafkaId, options?: KafkaRequestOptions): Promise<KafkaInspection>;
  prepareCapture(request: KafkaPrepareCaptureRequest, options?: KafkaRequestOptions): Promise<KafkaCapture>;
  capture(id: KafkaId, options?: KafkaRequestOptions): Promise<KafkaCapture>;
  runCapture(request: KafkaCaptureRevisionRequest, options?: KafkaRequestOptions): Promise<KafkaCapture>;
  resumeCapture(request: KafkaCaptureRevisionRequest, options?: KafkaRequestOptions): Promise<KafkaCapture>;
  cancelCapture(id: KafkaId, options?: KafkaRequestOptions): Promise<KafkaCapture>;
  waitForCapture(id: KafkaId, options?: KafkaWaitOptions): Promise<KafkaCapture>;
  messages(id: KafkaId, pagination?: KafkaPagination, options?: KafkaRequestOptions): Promise<KafkaMessagePage>;
  message(id: KafkaId, options?: KafkaRequestOptions): Promise<KafkaMessage>;
  project(request: KafkaProjectionRequest, options?: KafkaRequestOptions): Promise<KafkaProjection>;
  projection(id: KafkaId, options?: KafkaRequestOptions): Promise<KafkaProjection>;
  source(id: KafkaId, options?: KafkaRequestOptions): Promise<KafkaSourceView>;
  plan(id: KafkaId, options?: KafkaRequestOptions): Promise<KafkaSavedPlan>;
  savePlan(plan: KafkaMappingPlan, options?: KafkaRequestOptions): Promise<KafkaSavedPlan>;
  build(request: KafkaBuildRequest, options?: KafkaRequestOptions): Promise<KafkaBuildView>;
  query(request: KafkaQueryRequest, options?: KafkaRequestOptions): Promise<KafkaQueryResult>;
  compare(request: KafkaCompareRequest, options?: KafkaRequestOptions): Promise<KafkaComparison>;
  changes(id: KafkaId, pagination?: KafkaPagination, options?: KafkaRequestOptions): Promise<KafkaChangePage>;
  addSource(filename: string, labels?: {name?: string; label?: string}, options?: KafkaUploadOptions): Promise<KafkaSourceView>;
  importKafka(filename: string, options?: KafkaUploadOptions): Promise<KafkaReceivedProject>;
  importNative(filename: string, options?: KafkaUploadOptions): Promise<KafkaReceivedNative>;
  exportKafka(request: {build: KafkaId; projection?: KafkaId}, destination: string, options?: KafkaDownloadOptions): Promise<KafkaCompletedDownload>;
  exportNative(build: KafkaId, destination: string, options?: KafkaDownloadOptions): Promise<KafkaCompletedDownload>;
  exportDataset(build: KafkaId, destination: string, options?: KafkaDownloadOptions): Promise<KafkaCompletedDownload>;
  exportChanges(id: KafkaId, destination: string, options?: KafkaDownloadOptions): Promise<KafkaCompletedDownload>;
  exportMerchant(request: KafkaMerchantRequest, destination: string, options?: KafkaDownloadOptions): Promise<KafkaCompletedDownload>;
  downloadRecord(kind: KafkaDownloadRecordKind, id: KafkaId | KafkaOperation, destination: string, options?: KafkaDownloadOptions): Promise<KafkaCompletedDownload>;
  downloadQuery(request: KafkaQueryRequest, destination: string, options?: KafkaDownloadOptions): Promise<KafkaCompletedDownload>;
  downloadMessage(id: KafkaId, destination: string, options?: KafkaDownloadOptions): Promise<KafkaCompletedDownload>;
  downloadState(destination: string, options?: KafkaDownloadOptions): Promise<KafkaCompletedDownload>;
  downloadProjection(id: KafkaId, destination: string, options?: KafkaDownloadOptions): Promise<KafkaCompletedDownload>;
  /** Idempotently abort and drain this client's requests and file handles. */
  close(): Promise<void>;
}
