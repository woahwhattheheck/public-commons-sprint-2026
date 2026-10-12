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
/** The destination must be new, private and beneath a canonical existing parent. */
export function prepareN8nMerchant(options: { configPath: string; directory: string }): Promise<PreparedN8nMerchant>;
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

