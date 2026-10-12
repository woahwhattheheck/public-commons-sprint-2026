// MIT. Public declarations for the adjacent source-native index.mjs.
import type { Buffer } from 'node:buffer';
import type { Server } from 'node:http';

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue; }
export type Environment = Readonly<Record<string, string | undefined>>;
export type Sha256 = string;
export type NativeJobState =
  | 'PREPARED' | 'AWAITING_SETTLEMENT' | 'QUEUED' | 'RUNNING' | 'CANCELLING'
  | 'COMPLETED' | 'FAILED' | 'INTERRUPTED' | 'CANCELLED';
export type DispatchState =
  | 'READY' | 'DISPATCHING' | 'UNRESOLVED' | 'REJECTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED';
export type NativeExecutionStatus =
  | 'new' | 'running' | 'waiting' | 'success' | 'error' | 'canceled' | 'crashed' | 'unknown';

export const SCHEMA: 'stellar-forge.n8n-merchant.v1';
export const REQUEST_SCHEMA: 'stellar-forge.n8n-dispatch.v1';
export const RECEIPT_SCHEMA: 'stellar-forge.n8n-accepted.v1';
export const PREPARED_SCHEMA: 'stellar-forge.n8n-prepared-merchant.v1';
export const STORE_SCHEMA: 'stellar-forge.n8n-dispatch-store.v1';

export interface PaymentTerms {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  amount: string;
  maxTimeoutSeconds?: number;
  extra?: JsonObject;
}
export interface WebhookHeaderReference { name: string; environment: string; }
export interface N8nConnectionInput {
  apiBaseUrl: string;
  apiKeyEnvironment: string;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  maxExecutionBytes?: number;
}
export interface N8nConnection extends Required<N8nConnectionInput> {}
export interface N8nAutomationInput {
  path: string;
  description: string;
  inputSchema: JsonObject;
  example: JsonObject;
  payment: PaymentTerms;
  workflowId: string;
  webhookUrl: string;
  webhookHeader?: WebhookHeaderReference | null;
  webhookNode: string;
  resultNode: string;
  resultFields: string[];
  resultMode?: 'items' | 'single';
  maxResultItems?: number;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  filename?: string;
}
export interface N8nMerchantConfiguration {
  schema: typeof SCHEMA;
  n8n: N8nConnectionInput;
  automations: Record<string, N8nAutomationInput>;
  publicOrigin: string;
  serviceName?: string;
  tags?: string[];
  workerCount?: number;
  maxPending?: number;
  maxJobs?: number;
  memoryLimitMb?: number;
}
export interface NativeFunctionInput {
  path: string;
  description: string;
  inputSchema: JsonObject;
  example: JsonObject;
  payment: PaymentTerms;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  output: { format: 'json'; filename: string; contentType?: string };
}
export interface NativeJobConfigurationInput {
  schema: 'stellar-forge.paid-jobs.v1';
  application: string;
  publicOrigin: string;
  serviceName: string;
  environment: string[];
  functions: Record<string, NativeFunctionInput>;
  tags?: string[];
  workerCount?: number;
  maxPending?: number;
  maxJobs?: number;
  memoryLimitMb?: number;
}
export interface NativeFunctionDefinition {
  id: string;
  path: string;
  description: string;
  inputSchema: JsonObject;
  example: JsonObject;
  payment: PaymentTerms;
  timeoutMs: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  output: { format: 'json' | 'bytes'; contentType: string; filename: string };
}
export interface NativeCompiledJobConfiguration {
  schema: 'stellar-forge.paid-jobs.v1';
  application: string;
  publicOrigin: string;
  serviceName: string;
  environment: string[];
  workerCount: number;
  maxPending: number;
  maxJobs: number;
  memoryLimitMb: number;
  functions: Record<string, NativeFunctionDefinition & { offer: JsonObject; inputOffer: JsonObject }>;
  service: JsonObject;
}
export interface N8nAutomation {
  workflowId: string;
  webhookUrl: string;
  webhookHeader: WebhookHeaderReference | null;
  webhookNode: string;
  resultNode: string;
  resultFields: string[];
  resultMode: 'items' | 'single';
  maxResultItems: number;
}
export interface NormalizedN8nConfiguration {
  schema: typeof SCHEMA;
  connection: N8nConnection;
  automations: Record<string, N8nAutomation>;
  publicOrigin: string;
  serviceName: string;
  jobConfiguration: NativeJobConfigurationInput;
}
export interface N8nCompilation {
  normalized: NormalizedN8nConfiguration;
  jobs: NativeJobConfigurationInput;
  compiledJobs: NativeCompiledJobConfiguration;
  configurationSha256: Sha256;
}
export interface EnvironmentReference { name: string; present: boolean; }
export interface N8nConfigurationFile extends N8nCompilation {
  path: string;
  bytes: Buffer;
  raw: N8nMerchantConfiguration;
}
export interface RuntimeSourceFile { url: string; sha256: Sha256; }
export interface PreparedN8nRecord {
  schema: typeof PREPARED_SCHEMA;
  directory: string;
  configurationSha256: Sha256;
  inputSha256: Sha256;
  merchantSha256: Sha256;
  applicationSha256: Sha256;
  runtime: RuntimeSourceFile[];
  dispatchDirectory: string;
  jobDirectory: string;
  createdAt: string;
}
export interface PreparedN8nMerchant extends PreparedN8nRecord {
  configPath: string;
  functions: string[];
}
export interface InspectedN8nMerchant extends N8nCompilation {
  record: PreparedN8nRecord;
  environment: EnvironmentReference[];
}
export interface NativeWorkflowNode {
  parameters: JsonObject;
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  webhookId?: string;
  credentials?: Record<string, { id: string; name: string }>;
}
export interface NativeWorkflow {
  name: string;
  nodes: NativeWorkflowNode[];
  connections: Record<string, { main: Array<Array<{ node: string; type: 'main'; index: number }>> }>;
  settings: JsonObject;
  active: boolean;
  pinData: JsonObject;
  tags: JsonValue[];
}
export interface HistoryEvent {
  at: string;
  action: string;
  reason?: string;
  [field: string]: JsonValue | undefined;
}
export interface RetainedError {
  code: string;
  at?: string;
  httpStatus?: number | null;
  message?: string;
}
export interface HttpObservation {
  status: number;
  bytes: number;
  sha256: Sha256;
  receivedAt: string;
}
export interface ExecutionObservation extends Omit<HttpObservation, 'status'> {
  executionId: string;
  workflowId: string;
  status: NativeExecutionStatus;
  mode: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  inputVerified: boolean;
}
export interface DispatchResult { filename: string; sha256: Sha256; bytes: number; }
export interface N8nDispatch {
  id: string;
  attemptId: string | null;
  state: DispatchState;
  createdAt: string;
  startedAt?: string;
  executionId: string | null;
  acknowledgment?: HttpObservation;
  observation: ExecutionObservation | null;
  error: RetainedError | string | null;
  result: DispatchResult | null;
  nextPollAt: string | null;
}
export interface N8nDispatchRecord {
  schema: typeof STORE_SCHEMA;
  jobId: string;
  functionId: string;
  inputSha256: Sha256;
  workflowId: string;
  configurationSha256: Sha256;
  revision: number;
  createdAt: string;
  updatedAt: string;
  dispatches: N8nDispatch[];
  history: HistoryEvent[];
}
export interface NativeSettlement {
  id: string;
  at: string;
  [field: string]: JsonValue;
}
export interface NativeJobResult {
  filename: string;
  contentType: string;
  bytes: number;
  sha256: Sha256;
  file?: string;
  url?: string;
}
export interface NativeJobSummary {
  id: string;
  jobId: string;
  functionId: string;
  label: string;
  state: NativeJobState;
  revision: number;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  inputSha256: Sha256;
  payment: PaymentTerms;
  nativeSettlement: { id: string; at: string } | null;
  result: NativeJobResult | null;
  error: RetainedError | null;
  attempts: number;
}
export interface NativeJobRecord extends Omit<NativeJobSummary, 'attempts' | 'jobId'> {
  schema: 'stellar-forge.application-job.v1';
  input: JsonObject;
  source: JsonObject;
  settlement: NativeSettlement | null;
  attempts: JsonObject[];
  history: HistoryEvent[];
  statusUrl: string;
  resultUrl: string;
}
export interface NativeWorkerState {
  running: boolean;
  draining: boolean;
  active: number;
  maxConcurrency: number;
  error: string | null;
}
export interface NativeJobSnapshot {
  schema: 'stellar-forge.job-workspace.v1';
  revision: number;
  directory: string;
  configPath: string;
  source: JsonObject;
  serviceName: string;
  publicOrigin: string;
  mode: string;
  sellerUrl: string | null;
  worker: NativeWorkerState;
  storage: string;
  nativeActivationError: string | null;
  functions: NativeFunctionDefinition[];
  jobs: NativeJobSummary[];
  counts: Partial<Record<NativeJobState, number>>;
  eventExceptions: JsonObject[];
}
export interface NativeJobAcceptance {
  schema: 'stellar-forge.job-accepted.v1';
  jobId: string;
  functionId: string;
  inputSha256: Sha256;
  state: 'AWAITING_SETTLEMENT';
  statusUrl: string;
  resultUrl: string;
}
export interface NativeJobHandoff {
  schema: 'stellar-forge.job-handoff.v1';
  created: boolean;
  job: NativeJobSummary;
  claimToken: string;
  purchase: {
    url: string;
    method: 'POST';
    orderReference: string;
    headers: Record<string, string>;
    body: { jobId: string };
    payment: PaymentTerms;
  };
  acceptance: NativeJobAcceptance;
  statusUrl: string;
  resultUrl: string;
}
export interface NativeJobDecision { id: string; expectedRevision: number; reason: string; }
export interface NativeJobModel {
  readonly directory: string;
  readonly configPath: string;
  readonly configuration: NativeCompiledJobConfiguration;
  snapshot(): Promise<NativeJobSnapshot>;
  get(id: string): Promise<NativeJobRecord>;
  createJob(input: { functionId: string; input: JsonObject; label?: string; reference?: string; claimToken?: string }): Promise<NativeJobHandoff>;
  renewClaim(input: NativeJobDecision & { claimToken?: string }): Promise<NativeJobHandoff>;
  retry(input: NativeJobDecision): Promise<NativeJobRecord>;
  cancel(input: NativeJobDecision): Promise<NativeJobRecord>;
  startWorker(): Promise<NativeJobSnapshot>;
  stopWorker(options?: { cancelRunning?: boolean }): Promise<{ running: false; active: number; error: string | null }>;
  reconcile(): Promise<unknown>;
  result(id: string): Promise<{ body: Buffer; bytes: number; sha256: Sha256; contentType: string; filename: string }>;
  close(): Promise<{ stopped: true }>;
}
export interface ServiceAddresses {
  seller?: string;
  customer?: string;
  operations?: string;
  jobsOperator?: string;
}
export interface N8nMerchantSnapshot {
  schema: 'stellar-forge.n8n-merchant-workspace.v1';
  configuration: {
    configurationSha256: Sha256;
    normalized: NormalizedN8nConfiguration;
    environment: EnvironmentReference[];
  };
  jobs: NativeJobSnapshot;
  dispatches: N8nDispatchRecord[];
  services: ServiceAddresses;
}
export interface N8nMerchantExport extends Omit<N8nMerchantSnapshot, 'jobs'> {
  exportedAt: string;
  jobs: Omit<NativeJobSnapshot, 'jobs'> & { jobs: NativeJobRecord[] };
}
export interface N8nJobDetail { job: NativeJobRecord; dispatch: N8nDispatchRecord | null; }
export type ExecutionReconciliation =
  | { expectedRevision: number; executionId: string; reason: string }
  | { expectedRevision: number; executionId?: undefined; reason?: string };
export interface RerunAuthorization { expectedRevision: number; jobRevision: number; reason: string; }
export interface N8nMerchant {
  model: NativeJobModel;
  directory: string;
  prepared: InspectedN8nMerchant;
  launch?: N8nLaunchRecord;
  services: ServiceAddresses;
  snapshot(): Promise<N8nMerchantSnapshot>;
  exportState(): Promise<N8nMerchantExport>;
  get(id: string): Promise<N8nJobDetail>;
  reconcile(id: string, decision: ExecutionReconciliation): Promise<N8nDispatchRecord>;
  authorizeRerun(id: string, decision: RerunAuthorization): Promise<{ dispatch: N8nDispatchRecord; job: NativeJobRecord }>;
  close(): Promise<{ stopped: true }>;
}
export interface N8nWorkspace {
  server: Server;
  token: string;
  origin: string;
  url: string;
  close(): Promise<void>;
}
/** Passed through to the original SF30 launcher, which validates the returned native server. */
export type NativeFactory = (compiled: Record<string, unknown>) => unknown | Promise<unknown>;
export interface ServeN8nOptions {
  directory: string;
  env?: Environment;
  nativeFactory?: NativeFactory;
  nativeFactoryPath?: string;
  sellerPort?: number;
  customerPort?: number;
  operatorPort?: number;
  operationsPort?: number;
  jobsOperatorPort?: number;
  startWorker?: boolean;
}
export interface N8nService extends ServiceAddresses {
  merchant: N8nMerchant;
  workspace: N8nWorkspace;
  url: string;
  close(): Promise<void>;
}

/** Configuration-only compilation; credential values remain environment references. */
export function compileN8nMerchant(raw: N8nMerchantConfiguration, options?: { baseDir?: string }): N8nCompilation;
export function readN8nConfiguration(path: string): Promise<N8nConfigurationFile>;
export function environmentStatus(configuration: Pick<N8nCompilation, 'jobs'>, env?: Environment): EnvironmentReference[];
/** Generates a native importable wrapper for an existing child workflow. */
export function createAutomationWorkflow(raw: N8nMerchantConfiguration, options: {
  functionId: string; childWorkflowId: string; headerCredentialId?: string; headerCredentialName?: string;
}): NativeWorkflow;
/** Create a private merchant; explicit resume retains and completes the same original preparation. */
export function prepareN8nMerchant(options: { configPath: string; directory: string; resume?: boolean }): Promise<PreparedN8nMerchant>;
export function inspectN8nMerchant(directory: string, options?: { env?: Environment }): Promise<InspectedN8nMerchant>;
/** Acquires the original job directory lease; close the returned owner when finished. */
export function openN8nMerchant(directory: string, options?: { env?: Environment }): Promise<N8nMerchant>;
export function serveN8nMerchant(options: ServeN8nOptions): Promise<N8nService>;
/** Borrows the supplied merchant; closing the workspace closes its listener only. */
export function startN8nWorkspace(options: { merchant: N8nMerchant; port?: number }): Promise<N8nWorkspace>;
export function readDispatch(directory: string, id: string): Promise<N8nDispatchRecord | null>;
export function listDispatches(directory: string): Promise<N8nDispatchRecord[]>;
export function activeDispatch(row: N8nDispatchRecord | null | undefined): N8nDispatch | null;
export function readDispatchResult(directory: string, id: string): Promise<{
  row: N8nDispatchRecord; dispatch: N8nDispatch; body: Buffer;
}>;
export function runN8nMerchantCommand(argv?: string[], options?: { print?: (value: string) => void }): Promise<void>;

export const N8N_LAUNCH_SCHEMA: 'stellar-forge.n8n-merchant-launch.v1';
export interface N8nLaunchRecord extends ServiceAddresses {
  schema: typeof N8N_LAUNCH_SCHEMA;
  state: 'LISTENING' | 'STOPPING';
  directory: string;
  sourceDirectory: string;
  launchSourceDirectory: string;
  sourceFiles: Array<{ path: string; bytes: number; sha256: Sha256 }>;
  privateLaunch: string;
  pid: number;
  ppid: number;
  instanceId: string;
  configurationSha256: Sha256;
  applicationSha256: Sha256;
  nativeFactoryPath: string | null;
  startWorker: boolean;
  requestedPorts: { sellerPort: number; customerPort: number; operatorPort: number; operationsPort: number; jobsOperatorPort: number };
  startedAt: string;
  stoppingAt?: string;
  url: string;
}
export interface LaunchN8nOptions extends Omit<ServeN8nOptions, 'nativeFactory'> {
  configPath?: string;
  sourceDirectory?: string;
  launchSourceDirectory?: string;
}
export interface N8nLaunchService extends N8nService { announcement: N8nLaunchRecord; }
/** Owns the original merchant and retains its current private launch identity. */
export function startN8nMerchantLaunch(options: LaunchN8nOptions): Promise<N8nLaunchService>;
/** Reads the retained identity and verifies it against the live authenticated original operator. */
export function readN8nMerchantLaunch(options: {
  directory: string; sourceDirectory?: string; launchSourceDirectory?: string;
  pid?: number; instanceId?: string; nativeFactoryPath?: string | null; startWorker?: boolean;
}): Promise<N8nLaunchRecord>;


export const N8N_EXPORT_SCHEMA: 'stellar-forge.n8n-job-export.v1';
export const N8N_EXPORT_MANIFEST: 'n8n-job-export.json';
export const N8N_EXPORT_MAX_BYTES: number;
export const N8N_EXPORT_MAX_FILE_BYTES: number;
export interface N8nExportRequest {
  requestId: string;
  jobId: string;
  expectedRevision: number;
  expectedDispatchRevision: number | null;
}
export interface N8nExportFile {
  name: 'job.json' | 'dispatch.json' | 'result.json';
  bytes: number;
  sha256: Sha256;
}
export interface N8nExportedJob {
  id: string;
  functionId: string;
  revision: number;
  state: NativeJobState;
  inputSha256: Sha256;
  configSha256: Sha256;
  applicationSha256: Sha256;
  result: Pick<NativeJobResult, 'bytes' | 'sha256' | 'contentType' | 'filename'> | null;
}
export interface N8nJobExport {
  schema: typeof N8N_EXPORT_SCHEMA;
  exportId: Sha256;
  configurationSha256: Sha256;
  request: N8nExportRequest;
  job: N8nExportedJob;
  files: N8nExportFile[];
  totalBytes: number;
}
export interface N8nManifestReply {
  state: 'MANIFEST_RETAINED';
  exportId: Sha256;
  manifestFile: { name: typeof N8N_EXPORT_MANIFEST; bytes: number; sha256: Sha256 };
}
export interface N8nFileRequest {
  exportId: Sha256;
  file: typeof N8N_EXPORT_MANIFEST | N8nExportFile['name'];
  expectedManifestSha256: Sha256;
  expectedSha256: Sha256;
  offset?: number;
  limit?: number;
  readId?: string;
}
export interface N8nFileChunk {
  exportId: Sha256;
  manifestSha256: Sha256;
  readId: string;
  file: { name: N8nFileRequest['file']; bytes: number; sha256: Sha256; contentType: string };
  offset: number;
  bytesRead: number;
  nextOffset: number | null;
  encoding: 'base64';
  data: string;
}
export interface N8nAgentStatus {
  schema: 'stellar-forge.n8n-agent-status.v1';
  configuration: N8nMerchantSnapshot['configuration'];
  jobs: Omit<NativeJobSnapshot, 'jobs'>;
  services: ServiceAddresses;
  fileReads: { activeFileReads: number; snapshotBytes: number };
}
export interface N8nJobPage {
  schema: 'stellar-forge.n8n-job-page.v1';
  revision: number;
  total: number;
  jobs: NativeJobSummary[];
  nextCursor: string | null;
}
export interface N8nExportPage {
  schema: 'stellar-forge.n8n-export-page.v1';
  exports: Array<{ exportId: Sha256; job: N8nExportedJob; files: N8nExportFile[];
    totalBytes: number; manifestSha256: Sha256 }>;
  nextCursor: string | null;
}
export interface N8nPrepareRequest {
  requestId: string;
  reference?: string;
  functionId: string;
  input: JsonObject;
  label?: string;
}
export interface N8nRenewRequest {
  requestId: string;
  jobId: string;
  expectedRevision: number;
  reason: string;
}
/** Validate the immutable completion manifest and every original file descriptor. */
export function parseN8nJobExport(bytes: Uint8Array, expectedExportId?: Sha256): N8nJobExport;
/** Validate full original job/input/source and dispatch identities after file verification. */
export function validateN8nExportRecords(manifest: N8nJobExport, jobBytes: Uint8Array,
  dispatchBytes: Uint8Array): N8nJobDetail;
/** Borrows the existing live merchant; owns its request journal and temporary file reads. */
export class N8nAgentOperations {
  constructor(merchant: N8nMerchant);
  status(): Promise<N8nAgentStatus>;
  jobs(input?: { limit?: number; cursor?: string; q?: string; status?: NativeJobState }): Promise<N8nJobPage>;
  prepare(input: N8nPrepareRequest): Promise<NativeJobHandoff>;
  renew(input: N8nRenewRequest): Promise<NativeJobHandoff>;
  export(input: N8nExportRequest): Promise<N8nManifestReply>;
  exports(input?: { limit?: number; cursor?: string; jobId?: string }): Promise<N8nExportPage>;
  manifest(input: { exportId: Sha256 }): Promise<N8nManifestReply>;
  file(input: N8nFileRequest): Promise<N8nFileChunk>;
  release(input: { exportId: Sha256; readId: string }): Promise<{ state: 'FILE_READ_RELEASED'; exportId: Sha256; readId: string }>;
  close(): Promise<void>;
}
