import type { Server } from 'node:http';
import type { Library, Resource, Scan } from '../resource-library/library.mjs';

export type JobState = 'PREPARED' | 'AWAITING_SETTLEMENT' | 'QUEUED' | 'RUNNING' |
  'CANCELLING' | 'COMPLETED' | 'FAILED' | 'INTERRUPTED' | 'CANCELLED';
export interface NativeSettlement { id: string; at: string }
export interface AcceptedJob {
  schema: 'stellar-forge.job-accepted.v1'; jobId: string; functionId: string; inputSha256: string;
  state: 'AWAITING_SETTLEMENT'; statusUrl: string; resultUrl: string;
}
export interface JobOutput {
  sha256: string; bytes: number; filename: string; contentType: string; url: string;
}
export interface JobStatus {
  schema: 'stellar-forge.job-status.v1'; jobId: string; functionId: string; inputSha256: string;
  label: string; state: JobState; revision: number; createdAt: string; updatedAt: string;
  nativeSettlement: NativeSettlement | null; result: JobOutput | null; error: {code: string} | null;
}
export interface JobDelivery {
  schema: 'stellar-forge.job-buyer-delivery.v1'; jobId: string; functionId: string;
  inputSha256: string; acceptanceSha256: string; completedRevision: number;
  nativeSettlement: NativeSettlement; deliveredAt: string; path: string; sha256: string;
  bytes: number; contentType: string; filename: string; sourceUrl: string;
}
export interface BuyerReceipt {
  schema: 'stellar-forge.job-buyer-receipt.v1'; jobId: string; retainedAt: string;
  acceptanceSha256: string; acceptance: AcceptedJob; latestStatus: JobStatus | null;
  purchase: {kind: 'SF88_NATIVE_RESULT' | 'SAVED_ACCEPTANCE_FILE'; status?: string; httpStatus?: number};
  delivery: JobDelivery | null;
}
export interface CustomerTask {
  id: string; kind: 'refresh' | 'watch' | 'fetch';
  state: 'RUNNING' | 'CANCELLING' | 'COMPLETE' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';
  startedAt: string; completedAt: string | null; error: string | null; indexState: string | null;
}
export interface JobEntry {
  id: string; directory: string; label: string; archived: boolean; revision: number;
  createdAt: string; updatedAt: string; observedAt: string; receipt: BuyerReceipt;
  lastError: string | null; task: CustomerTask | null; resourceId: string | null; resource: Resource | null;
}
export interface WorkspaceStatus {
  schema: 'stellar-forge.sf88.job-workspace.v1'; directory: string; revision: number;
  buyerRoots: string[]; fileRoots: string[]; entries: number;
  counts: Partial<Record<JobState, number>>; capacity: number;
  active: Array<CustomerTask & {entryId: string}>; library: ReturnType<Library['status']>; checkout: CheckoutStatus; closing: boolean;
}
export interface WorkspaceList {
  q?: string; state?: '' | JobState; view?: 'active' | 'archived' | 'all'; offset?: number; limit?: number;
}
export interface JobWorkspace {
  readonly directory: string; readonly library: Library; readonly checkout: JobCheckout;
  register(options: {buyerDirectory: string; label?: string}): Promise<{entry: JobEntry; reused: boolean}>;
  retain(options: {acceptanceBytes: Buffer; label?: string} & (
    {claimToken: string; handoff?: never} |
    {claimToken?: never; handoff: {schema: 'stellar-forge.job-handoff.v1'; claimToken: string; acceptance: AcceptedJob; [key: string]: unknown}}
  )): Promise<{entry: JobEntry; reused: boolean}>;
  list(options?: WorkspaceList): {total: number; offset: number; limit: number; items: JobEntry[]};
  get(id: string): JobEntry;
  reconcile(id: string): Promise<JobEntry>;
  update(id: string, options: {expectedRevision: number; label?: string; archived?: boolean}): Promise<JobEntry>;
  start(id: string, options?: {kind?: CustomerTask['kind']; deadlineMs?: number; pollMs?: number}): Promise<JobEntry>;
  cancel(id: string): Promise<JobEntry>;
  wait(id: string): Promise<JobEntry>;
  scan(options?: {signal?: AbortSignal; onProgress?: (progress: NonNullable<ReturnType<Library['status']>['activity']>) => void}): Promise<Scan>;
  status(): WorkspaceStatus;
  close(): Promise<void>;
}
export interface WorkspaceOptions {
  directory: string; buyerRoots?: string[]; fileRoots?: string[];
  transport?: {mode: 'explicit-connect'; origin: string} & (
    {proxyUrl: string; proxyEnv?: never} | {proxyUrl?: never; proxyEnv: string});
  fetchImpl?: typeof fetch; requestTimeoutMs?: number; maxConcurrent?: number; checkout?: CheckoutOptions;
}
export function openJobWorkspace(options: WorkspaceOptions): Promise<JobWorkspace>;
export function startJobCustomerWorkspace(options: {model: JobWorkspace; port?: number}): Promise<{
  origin: string; url: string; libraryUrl: string; collectionsUrl: string; checkoutUrl: string;
  token: string; server: Server; launch: JobWorkspaceLaunch; privateLaunch: string; close(): Promise<void>;
}>;
export function runJobWorkspaceCommand(args?: string[], options?: {print?: (value: unknown) => void}): Promise<void>;


export type CheckoutPhase = 'IMPORTED' | 'REVIEWED' | 'RECOVERABLE' | 'ACCEPTED' | 'FINISHED';
export interface CheckoutTerms {
  scheme: 'exact'; network: 'stellar:testnet' | 'stellar:pubnet'; asset: string;
  payTo: string; maxAtomic: string; maxTimeoutSeconds?: number; paymentFlow?: 'authorization' | 'upfront';
}
export interface CheckoutTicket {
  jobId: string; functionId: string; label: string; merchantRevision: number;
  inputSha256: string; statusUrl: string; resultUrl: string; sellerUrl: string;
  method: 'POST'; orderReference: string; acceptedTerms: CheckoutTerms;
  bodySha256: string; bodyBytes: number;
}
export type CheckoutOperator =
  {kind: 'workspace'; directory: string} |
  {kind: 'profile'; sourcePath: string; profileSha256: string};
export type CheckoutSelection =
  {kind: 'workspace'; directory: string; runtimeDirectory: string} |
  {kind: 'profile'; path: string; runtimeDirectory: string};
export interface CheckoutReview {
  mode: 'OFFLINE_REVIEW'; intentId: string; reviewedAt: string; configSha256: string;
  bodySha256: string; sellerUrl: string; method: 'POST'; acceptedTerms: CheckoutTerms;
  bodyBytes: number; nativeWorkspace: string | null; operatorId: string | null;
  serviceId: string | null; signerFilename: string | null;
}
export interface CheckoutNativeOutcome {
  status: string | null; httpStatus: number | null; deliveryStatus: string | null;
  exitCode: number | null; runtimeError: string | null; recovered: boolean; recordedAt: string | null;
}
export interface CheckoutTask {
  id: string; kind: 'review' | 'execute' | 'recover';
  state: 'RUNNING' | 'CANCELLING' | 'COMPLETE' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';
  stage: 'PREPARING' | 'REVIEWING' | 'EXECUTING' | 'RECOVERING' | 'RETAINING_RESULT';
  startedAt: string; completedAt: string | null; error: string | null;
}
export interface CheckoutEntry {
  id: string; intentId: string; label: string; revision: number; phase: CheckoutPhase;
  createdAt: string; updatedAt: string; ticket: CheckoutTicket; handoffSha256: string;
  operator: CheckoutOperator; runtimeDirectory: string; nativeDirectory: string; attempted: boolean;
  review: CheckoutReview | null; native: CheckoutNativeOutcome | null; jobEntryId: string | null;
  lastError: string | null; task: CheckoutTask | null; pendingTicket: boolean;
  history: Array<{at: string; action: string; revision: number; previousRevision?: number; [key: string]: unknown}>;
  actions: {review: boolean; execute: boolean; recover: boolean; replace: boolean; stop: boolean};
}
export interface CheckoutStatus {
  schema: 'stellar-forge.sf88.job-checkout.v1'; directory: string; runtimeDirectory: string;
  entries: number; counts: Partial<Record<CheckoutPhase, number>>; capacity: 1; closing: boolean;
  selection: CheckoutSelection | null; active: (CheckoutTask & {checkoutId: string}) | null;
}
export type CheckoutOptions = {
  runtimeDirectory?: string; environment?: Record<string, string | undefined>; timeoutMs?: number;
} & (
  {operatorWorkspace: string; operatorProfile?: never} |
  {operatorProfile: string; operatorWorkspace?: never} |
  {operatorWorkspace?: never; operatorProfile?: never}
);
export interface JobCheckout {
  readonly directory: string;
  import(options: {handoffBytes: Buffer; label?: string}): Promise<{checkout: CheckoutEntry; reused: boolean}>;
  replace(id: string, options: {handoffBytes: Buffer; expectedRevision: number; reason: string}): Promise<CheckoutEntry>;
  get(id: string): CheckoutEntry;
  list(options?: {q?: string; phase?: '' | CheckoutPhase; offset?: number; limit?: number}): {
    total: number; offset: number; limit: number; items: CheckoutEntry[];
  };
  status(): CheckoutStatus;
  start(id: string, options: {kind?: CheckoutTask['kind']; expectedRevision: number}): Promise<CheckoutEntry>;
  cancel(id: string, options?: {taskId?: string}): Promise<CheckoutEntry>;
  wait(id: string): Promise<CheckoutEntry>;
  close(): Promise<void>;
}
export interface JobWorkspaceLaunch {
  schema: 'stellar-forge.sf88.job-workspace-launch.v1'; state: 'LISTENING' | 'CLOSED';
  directory: string; runtimeDirectory: string; operatorSelection: CheckoutSelection | null;
  pid: number; instanceId: string; startedAt: string; endedAt?: string;
  url: string; checkoutUrl: string; libraryUrl: string; collectionsUrl: string; privateLaunch: string;
}
export const JOB_WORKSPACE_LAUNCH_SCHEMA: 'stellar-forge.sf88.job-workspace-launch.v1';
export function jobWorkspaceLaunchPath(directory: string): string;
export function readJobWorkspaceLaunch(options: {
  directory: string; runtimeDirectory: string; operatorWorkspace?: string; operatorProfile?: string; pid?: number;
}): Promise<JobWorkspaceLaunch>;
