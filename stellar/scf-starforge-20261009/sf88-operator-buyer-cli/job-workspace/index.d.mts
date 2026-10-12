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
  active: Array<CustomerTask & {entryId: string}>; library: ReturnType<Library['status']>; closing: boolean;
}
export interface WorkspaceList {
  q?: string; state?: '' | JobState; view?: 'active' | 'archived' | 'all'; offset?: number; limit?: number;
}
export interface JobWorkspace {
  readonly directory: string; readonly library: Library;
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
  fetchImpl?: typeof fetch; requestTimeoutMs?: number; maxConcurrent?: number;
}
export function openJobWorkspace(options: WorkspaceOptions): Promise<JobWorkspace>;
export function startJobCustomerWorkspace(options: {model: JobWorkspace; port?: number}): Promise<{
  origin: string; url: string; libraryUrl: string; collectionsUrl: string; token: string; server: Server; close(): Promise<void>;
}>;
export function runJobWorkspaceCommand(args?: string[], options?: {print?: (value: unknown) => void}): Promise<void>;
