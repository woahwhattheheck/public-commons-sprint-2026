import type { FeedToolName, FeedToolInputs, FeedToolResults, FeedFamily } from './feeds-workspace-client.mjs';
export const FEEDS_REQUEST_SCHEMA: 'stellar-forge.feeds-client-request.v1';
export const FEEDS_REQUEST_RESULT_SCHEMA: 'stellar-forge.feeds-client-response.v1';
export const MAX_FEEDS_REQUEST_BYTES: number;
export const MAX_FEEDS_RESPONSE_BYTES: number;
export interface FeedsRequestRecovery { family: FeedFamily; operationId: string; }
export interface PreparedFeedsRequest<K extends FeedToolName = FeedToolName> {
  schema: 'stellar-forge.feeds-client-request.v1'; endpoint: string; workspace: string; tool: K;
  arguments: FeedToolInputs[K] & { workspace?: string }; recovery: FeedsRequestRecovery | null; requestSha256: string;
}
export interface FeedsInvocation {
  schema: 'stellar-forge.feeds-client-invocation.v1'; endpoint: string; workspace: string; requestSha256: string;
}
export interface FeedsRequestResponse<K extends FeedToolName = FeedToolName> {
  schema: 'stellar-forge.feeds-client-response.v1'; endpoint: string; workspace: string; requestSha256: string;
  resultSha256: string; result: FeedToolResults[K];
}
export interface FeedsRequestRecord<K extends FeedToolName = FeedToolName> {
  schema: 'stellar-forge.feeds-client-record.v1'; directory: string;
  state: 'PREPARED' | 'RECONCILIATION_REQUIRED' | 'RESPONSE_RETAINED';
  request: PreparedFeedsRequest<K>; invocation: FeedsInvocation | null; response: FeedsRequestResponse<K> | null;
}
export function createFeedsRequest<K extends FeedToolName>(options: {
  endpoint: string; workspace: string; tool: K; input?: FeedToolInputs[K]; recovery?: FeedsRequestRecovery | null;
}): PreparedFeedsRequest<K>;
export function validateFeedsRequest<K extends FeedToolName>(request: PreparedFeedsRequest<K>): PreparedFeedsRequest<K>;
export function readFeedsRequest(path: string, options?: { signal?: AbortSignal }): Promise<PreparedFeedsRequest>;
export function writeFeedsRequest(path: string, request: PreparedFeedsRequest): Promise<{ path: string; bytes: number; sha256: string; reused: boolean }>;
export function retainFeedsRequest<K extends FeedToolName>(options: {
  directory: string; request: PreparedFeedsRequest<K>; signal?: AbortSignal;
}): Promise<FeedsRequestRecord<K>>;
export function inspectFeedsRequest(options: { directory: string; signal?: AbortSignal }): Promise<FeedsRequestRecord>;
