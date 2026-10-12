import type {Buffer} from 'node:buffer';
import type {JobResolution, OriginalJobModel, OriginalRecord} from '../resolution/index.mjs';

export type JobServiceLanding = 'jobs' | 'inputs' | 'resolutions' | 'deliveries';
export interface JobServiceOptions {
  configPath: string; directory: string;
  nativeFactoryPath?: string | null; intakeConfigPath?: string | null;
  deliveryConfigPath?: string | null; deliveryDirectory?: string | null;
  sellerPort?: number; customerPort?: number; operatorPort?: number; operationsPort?: number;
  startWorker?: boolean; startDelivery?: boolean; landing?: JobServiceLanding;
}
export interface NormalizedJobServiceOptions {
  configPath: string; directory: string;
  nativeFactoryPath: string | null; intakeConfigPath: string | null;
  deliveryConfigPath: string | null; deliveryDirectory: string | null;
  sellerPort: number; customerPort: number; operatorPort: number; operationsPort: number;
  startWorker: boolean; startDelivery: boolean; landing: JobServiceLanding;
}
export interface JobSourceIdentity {
  schema: 'stellar-forge.job-source.v1'; configSha256: string; applicationSha256: string;
  application: string; publicOrigin: string;
}
export interface JobSourceFile {path: string; bytes: number; sha256: string}
export interface JobServicePorts {seller: number; customer: number; operator: number; operations: number}
export interface JobServiceFunction {
  id: string; path: string; description: string; payment: OriginalRecord;
  timeoutMs: number; maxInputBytes: number; maxOutputBytes: number;
  output: {format: 'json' | 'bytes'; contentType: string; filename: string};
  inputFiles: OriginalRecord | null;
}
export interface JobServiceSummary {
  name: string; publicOrigin: string; nativePayments: boolean; workerCount: number; memoryLimitMb: number;
  maxPending: number; maxJobs: number; environmentReferences: string[]; functions: JobServiceFunction[];
}
export interface JobServiceSelection {
  schema: 'stellar-forge.job-service-selection.v1'; selectionSha256: string;
  runtimeDirectory: string; directory: string; configPath: string; source: JobSourceIdentity;
  applicationPath: string; sourceBinding: OriginalRecord | null; nativeFactory: JobSourceFile | null;
  intake: {configuration: OriginalRecord; file: JobSourceFile | null};
  delivery: {configuration: OriginalRecord; file: JobSourceFile; directory: string} | null;
  ports: JobServicePorts; startWorker: boolean; startDelivery: boolean; landing: JobServiceLanding;
  files: JobSourceFile[]; summary: JobServiceSummary;
}
export interface JobServiceIdentity {
  schema: 'stellar-forge.job-service-identity.v1'; instanceId: string; selectionSha256: string;
}
export interface JobWorkspaceIdentity {
  schema: 'stellar-forge.job-workspace-identity.v1'; instanceId: string; pid: number;
  directory: string; configPath: string; runtimeDirectory: string; source: JobSourceIdentity;
  origin: string; capabilities: {inputs: true; resolution: true; delivery: boolean};
  service: JobServiceIdentity | null;
}
export interface JobServiceLaunch {
  schema: 'stellar-forge.job-service-launch.v1'; state: 'LISTENING'; service: 'starforge-paid-jobs';
  instanceId: string; pid: number; startedAt: string; directory: string; configPath: string;
  runtimeDirectory: string; source: JobSourceIdentity; applicationPath: string; sourceBinding: OriginalRecord | null;
  selectionSha256: string; requestedPorts: JobServicePorts; startWorker: boolean; startDelivery: boolean;
  nativeFactory: JobSourceFile | null; intakeConfiguration: JobSourceFile | null;
  deliveryConfiguration: JobSourceFile | null;
  seller: string; customer: string; operator: string; operations: string; intake: string | null;
  inputReceiving: string; resolution: string; deliveries: string | null; deliveryState: string | null;
  mode: string; landing: JobServiceLanding; entryUrl: string;
}
export interface JobServiceExit {
  schema: 'stellar-forge.job-service-exit.v1'; instanceId: string; pid: number;
  startedAt: string; closedAt: string; state: 'STOPPED' | 'FAILED'; phase: string;
  directory: string; configPath: string; selectionSha256: string | null;
  error: string | null; closeErrors: string[];
}
export interface JobServiceAnnouncement {
  schema: 'stellar-forge.job-service-launch.v1'; state: 'LISTENING'; service: 'starforge-paid-jobs';
  instanceId: string; pid: number; selectionSha256: string;
  seller: string; customer: string; operator: string; operations: string; intake: string | null;
  inputReceiving: string; resolution: string; deliveries: string | null; deliveryState: string | null;
  mode: string; landing: JobServiceLanding; entryUrl: string; privateLaunch?: string;
}
export interface OriginalJobMerchant extends OriginalJobModel {
  readonly configPath: string; readonly configuration: OriginalRecord; readonly inputs: unknown;
  readonly resolution: JobResolution;
  createJob(input: {functionId: string; input: OriginalRecord; label?: string; reference?: string;
    claimToken?: string; signal?: AbortSignal}): Promise<OriginalRecord>;
  renewClaim(input: {id: string; expectedRevision: number; reason: string; claimToken?: string}): Promise<OriginalRecord>;
  result(id: string): Promise<{body: Buffer; contentType: string; filename: string; sha256: string}>;
  reconcile(): Promise<unknown>; startWorker(): Promise<unknown>; stopWorker(): Promise<unknown>;
  close(): Promise<{stopped: true}>;
}
export interface OriginalServiceListener {
  url: string; close(): Promise<unknown>; [name: string]: unknown;
}
export interface OriginalJobWorkspace extends OriginalServiceListener {
  origin: string; token: string; inputReceivingUrl: string; resolutionUrl: string;
  identity: JobWorkspaceIdentity;
}
export interface OriginalResultDelivery {
  snapshot(): OriginalRecord; start(): unknown; close(): Promise<unknown>; [name: string]: unknown;
}
export interface JobService {
  model: OriginalJobMerchant;
  seller: OriginalServiceListener & {mode: string; operations: OriginalServiceListener};
  customer: OriginalServiceListener & {publicOrigin: string; intakeUrl: string | null};
  workspace: OriginalJobWorkspace; delivery: OriginalResultDelivery | null | undefined;
  selection: JobServiceSelection; launch: JobServiceLaunch; launchFile: string | null;
  closed: Promise<JobServiceExit>; close(): Promise<JobServiceExit>;
}
export type JobServiceLaunchExpectation = Partial<Pick<JobServiceLaunch,
  'directory' | 'configPath' | 'runtimeDirectory' | 'source' | 'selectionSha256' | 'instanceId' | 'pid'>>;
export type JobWorkspaceExpectation = Partial<Pick<JobWorkspaceIdentity,
  'directory' | 'configPath' | 'runtimeDirectory' | 'source' | 'origin' | 'instanceId' | 'pid'>> & {selectionSha256?: string};
export const JOB_SERVICE_SELECTION_SCHEMA: 'stellar-forge.job-service-selection.v1';
export const JOB_SERVICE_LAUNCH_SCHEMA: 'stellar-forge.job-service-launch.v1';
export const JOB_SERVICE_EXIT_SCHEMA: 'stellar-forge.job-service-exit.v1';
export const JOB_SERVICE_IDENTITY_SCHEMA: 'stellar-forge.job-service-identity.v1';
export const JOB_WORKSPACE_IDENTITY_SCHEMA: 'stellar-forge.job-workspace-identity.v1';
export const JOB_SERVICE_LANDINGS: readonly JobServiceLanding[];
export const JOB_SERVICE_RUNTIME: string;
export function normalizeJobServiceOptions(options: JobServiceOptions): NormalizedJobServiceOptions;
export function readJobServiceSelection(options: JobServiceOptions): Promise<JobServiceSelection>;
export function assertJobServiceSelection(value: unknown, expectedSha256?: string): JobServiceSelection;
export function openJobService(options: JobServiceOptions, control?: {
  env?: NodeJS.ProcessEnv; signal?: AbortSignal; expectedSelection?: string; expectedRuntime?: string; launchFile?: string | null;
}): Promise<JobService>;
export function runJobServiceCommand(options: JobServiceOptions, control?: {
  print?: (text: string) => unknown; expectedSelection?: string; expectedRuntime?: string; launchFile?: string | null; signal?: AbortSignal;
}): Promise<JobServiceExit | undefined>;
export function jobServiceAnnouncement(value: JobServiceLaunch, privateLaunch?: string | null): JobServiceAnnouncement;
export function jobServiceLaunchPath(operationDirectory: string): string;
export function jobServiceExitPath(operationDirectory: string): string;
export function readJobServiceLaunch(options: {
  file: string; expected?: JobServiceLaunchExpectation; signal?: AbortSignal;
}): Promise<JobServiceLaunch & {workspaceIdentity: JobWorkspaceIdentity}>;
export function privateJobWorkspaceUrl(value: string): URL;
export function assertJobSourceIdentity(value: unknown): asserts value is JobSourceIdentity;
export function assertJobWorkspaceIdentity(value: unknown, expected?: JobWorkspaceExpectation): JobWorkspaceIdentity;
export function readJobWorkspaceIdentity(options: {
  url: string; expected?: JobWorkspaceExpectation; signal?: AbortSignal;
}): Promise<JobWorkspaceIdentity>;
