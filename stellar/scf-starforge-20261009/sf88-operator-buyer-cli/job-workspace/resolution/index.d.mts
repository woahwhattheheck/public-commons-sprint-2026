import type {IncomingMessage, ServerResponse} from 'node:http';
import type {
  JobResolutionReceipt, IssueRequest, MessageRequest, ResolutionFile, ResolutionAsset, OriginalRecord
} from '../../../sf30-seller-sdk/jobs/resolution/index.mjs';

export type CustomerOperationState = 'PREPARED' | 'DISPATCHING' | 'RECEIVED' | 'FAILED' | 'UNKNOWN';
export interface CustomerOperation {
  id: string; kind: 'ISSUE' | 'MESSAGE'; request: IssueRequest | MessageRequest; requestSha256: string;
  state: CustomerOperationState; createdAt: string; startedAt: string | null; completedAt: string | null;
  error: {code: string} | null; receiptSha256?: string;
}
export interface RetainedReceipt {
  file: string; sha256: string; bytes: number; revision: number; observedAt: string;
}
export interface BuyerResolutionState {
  schema: 'stellar-forge.job-resolution-customer-state.v1'; jobId: string;
  acceptanceSha256: string; purchaseSha256: string; receipt: JobResolutionReceipt | null;
  retainedReceipt: RetainedReceipt | null; operations: CustomerOperation[]; updatedAt: string;
}
export interface BuyerResolutionExport {
  schema: 'stellar-forge.job-resolution-buyer-export.v1'; exportedAt: string; jobId: string;
  acceptanceSha256: string; acceptanceBase64: string; purchaseSha256: string; purchase: OriginalRecord;
  receiptSha256: string; receiptBase64: string; operations: CustomerOperation[];
}
export interface FollowOptions {signal?: AbortSignal; deadlineMs?: number}
export interface BuyerResolution {
  readonly directory: string; readonly stateDirectory: string; readonly jobId: string;
  inspect(): Promise<BuyerResolutionState>;
  refresh(options?: FollowOptions): Promise<BuyerResolutionState>;
  issue(input: IssueRequest, options?: FollowOptions): Promise<BuyerResolutionState>;
  message(input: MessageRequest, options?: FollowOptions): Promise<BuyerResolutionState>;
  recover(requestId: string, options?: FollowOptions): Promise<BuyerResolutionState>;
  resume(requestId: string, options?: FollowOptions): Promise<BuyerResolutionState>;
  export(): Promise<BuyerResolutionExport>;
  receive(bundle: BuyerResolutionExport): Promise<BuyerResolutionState>;
  close(): Promise<unknown>;
}
export interface CustomerTask {
  id: string; entryId: string; kind: string; state: 'RUNNING' | 'CANCELLING'; startedAt: string;
}
export interface OriginalCustomerEntry {
  id: string; directory: string; label: string;
  receipt: {jobId: string; acceptanceSha256: string; latestStatus?: {state: string} | null};
}
export interface CustomerListQuery {q?: string; view?: string; offset?: number; limit?: number}
export interface CustomerPage {items: OriginalCustomerEntry[]; total: number; [key: string]: unknown}
export interface ResolutionListEntry {
  id: string; jobId: string; label: string; jobState: string; revision: number | null;
  observedAt: string | null; pending: number; task: CustomerTask | null;
}
export type WorkspaceResolutionState = BuyerResolutionState & {entryId: string};
export interface JobResolutionController {
  status(): {active: CustomerTask[]; capacity: number};
  list(query?: CustomerListQuery): Promise<Omit<CustomerPage, 'items'> & {items: ResolutionListEntry[]}>;
  inspect(entryId: string, options?: {signal?: AbortSignal}): Promise<WorkspaceResolutionState>;
  refresh(entryId: string, options?: {signal?: AbortSignal}): Promise<WorkspaceResolutionState>;
  issue(entryId: string, input: IssueRequest, options?: {signal?: AbortSignal}): Promise<WorkspaceResolutionState>;
  message(entryId: string, input: MessageRequest, options?: {signal?: AbortSignal}): Promise<WorkspaceResolutionState>;
  recover(entryId: string, input: {requestId: string}, options?: {signal?: AbortSignal}): Promise<WorkspaceResolutionState>;
  resume(entryId: string, input: {requestId: string}, options?: {signal?: AbortSignal}): Promise<WorkspaceResolutionState>;
  receive(entryId: string, input: BuyerResolutionExport, options?: {signal?: AbortSignal}): Promise<WorkspaceResolutionState>;
  export(entryId: string, options?: {signal?: AbortSignal}): Promise<ResolutionFile>;
  stop(entryId: string): Promise<{stopped: true; operationId?: string}>;
  close(): Promise<{closed: true}>;
}
export interface ResolutionRouteContext {
  request: IncomingMessage; response: ServerResponse; url: URL; signal: AbortSignal;
  send(value: unknown, status?: number): void;
  body(maxBytes: number): Promise<OriginalRecord>;
}
export const BUYER_RESOLUTION_SCHEMA: 'stellar-forge.job-resolution-buyer.v1';
export const BUYER_RESOLUTION_EXPORT: 'stellar-forge.job-resolution-buyer-export.v1';
export const BUYER_RESOLUTION_RECEIVING_BYTES: number;
export function openJobResolutionBuyer(options: {
  directory: string; transport?: unknown; fetchImpl?: typeof fetch; requestTimeoutMs?: number;
}): Promise<BuyerResolution>;
export function openJobResolutionController(options: {
  lease: {assertHeld(): void};
  getEntry(entryId: string): OriginalCustomerEntry;
  listEntries(query: CustomerListQuery): CustomerPage | Promise<CustomerPage>;
  transport?: unknown; fetchImpl?: typeof fetch; requestTimeoutMs?: number; maxConcurrent?: number;
}): JobResolutionController;
export function jobResolutionExtension(controller: JobResolutionController): Promise<{
  additionalAssets: ResolutionAsset[];
  authenticatedRoute(context: ResolutionRouteContext): Promise<boolean>;
}>;
export function runJobBuyerResolutionCommand(argv: string[], options?: {signal?: AbortSignal}): Promise<unknown>;
