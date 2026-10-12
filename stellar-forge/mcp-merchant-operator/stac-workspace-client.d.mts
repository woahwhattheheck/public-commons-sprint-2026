/// <reference types="node" />
import type { Buffer } from 'node:buffer';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type NativeObject = Record<string, unknown>;
export interface RequestOptions { signal?: AbortSignal }
export interface StacHostInput { path: string; kind: 'imagery-handover' | 'processing-handover' | 'processing-source' | 'processing-page'; label?: string; sha256?: string }
export interface StacProcessingProfile { label?: string; deployment: NativeObject; sourceInput: string; sourceMetadata?: NativeObject }
export interface StacHostDefinition {
  /** Exactly one of url, consoleUrlFile or consoleUrlEnv. URL files contain the original serve JSON or URL. */
  url?: string | { url: string; workspaceId: string };
  consoleUrlFile?: string;
  consoleUrlEnv?: string;
  /** Required with a plain URL. A native serve JSON record already supplies this ID. */
  workspaceId?: string;
  label?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  inputs?: Record<string, StacHostInput>;
  processingProfiles?: Record<string, StacProcessingProfile>;
}
export interface StacWorkspaceConfiguration {
  schema: typeof STAC_WORKSPACE_CONNECTION_SCHEMA;
  path: string;
  workspaces: Record<string, StacHostDefinition>;
}
export interface StacItem extends NativeObject {
  type: 'Feature';
  id: string;
  collection: string;
  geometry: Json;
  properties: Record<string, Json>;
  assets: Record<string, NativeObject>;
  links?: NativeObject[];
}
export interface StacQuery extends NativeObject {
  id?: string; name?: string; collections: string[]; bbox?: number[]; intersects?: NativeObject;
  datetime: string; cloudCoverMax?: number; pageSize?: number; maxPages?: number;
}
export interface StacEdition extends NativeObject {
  id: string; status: string; queryId: string; reviewId: string; query: StacQuery;
  pages: NativeObject[]; pagesCount: number; itemsCount: number; coverage: NativeObject;
}
export interface StacDecision extends NativeObject {
  id: string; editionId: string; itemId: string; status: 'SELECTED' | 'REJECTED' | 'REVIEW';
  actor: string; note: string; assetKeys: string[]; updatedAt: string;
}
export interface StacAsset extends NativeObject {
  id: string; editionId: string; itemId: string; assetKey: string; status: string;
  bytes?: number; sha256?: string; mime?: string;
}
export interface StacEditionView {
  edition: StacEdition; items: StacItem[]; decisions: StacDecision[]; assets: StacAsset[];
}
export interface StacWorkspaceState extends NativeObject {
  schema: 'scf-stac-workspace/v1'; id: string; revision: number; endpoint: string; title: string;
  catalog: NativeObject | null; collections: NativeObject[]; catalogSources: NativeObject[];
  queries: StacQuery[]; reviews: NativeObject[]; editions: StacEdition[]; assetReviews: NativeObject[];
  assets: StacAsset[]; decisions: StacDecision[]; operations: Record<string, NativeObject>; imports: NativeObject[];
}
export interface StacJob extends NativeObject {
  id: string; kind: string; status: 'RUNNING' | 'COMPLETE' | 'FAILED'; createdAt: string; finishedAt?: string;
  result?: unknown; error?: { code: string; message: string };
}
export interface StacState {
  workspace: StacWorkspaceState; jobs: StacJob[];
  capabilities: { processing: { enabled: boolean; reads?: string[]; actions?: string[] }; [key: string]: unknown };
}
export interface StacComparison extends NativeObject {
  leftEditionId: string; rightEditionId: string; leftCoverage: NativeObject; rightCoverage: NativeObject;
  comparableQuery: boolean; added: NativeObject[]; removed: NativeObject[]; changed: NativeObject[]; unchanged: NativeObject[];
}
export type ProcessingQuery = Record<string, string | number | boolean | (string | number | boolean)[]>;
export type StacFileSelection =
  | { kind: 'asset'; assetId: string }
  | { kind: 'report'; editionId: string; format: 'json' | 'csv' | 'html' }
  | { kind: 'handover'; editionIds?: string[]; includeAssets?: boolean }
  | { kind: 'processing-source'; deploymentKey: string }
  | { kind: 'processing-handover'; exportId: string }
  | { kind: 'state' | 'processing-state' }
  | { kind: 'edition'; editionId: string }
  | { kind: 'comparison'; leftEditionId: string; rightEditionId: string }
  | { kind: 'processing-read'; name: string; query?: ProcessingQuery };
export interface StacFile { name: string; type: string; bytes: Buffer; sha256: string }
export interface StacAssetStream { name: string; type: string; bytes: number; sha256: string; body: ReadableStream<Uint8Array> | null }
export interface StacAssetRange {
  file: { name: string; contentType: string; bytes: number; sha256: string };
  offset: number; bytesRead: number; nextOffset: number | null; encoding: 'base64'; data: string; chunkSha256: string;
}
export interface StacSavedFile { filename: string; bytes: number; sha256: string; contentType: string; sourceFilename: string }
export interface StacHandover extends NativeObject { schema: 'scf-stac-handover/v1'; sourceWorkspaceId: string; digest: string; files: NativeObject[] }

export declare const STAC_WORKSPACE_CONNECTION_SCHEMA: 'stellar-forge.stac-workspace-connection.v1';
export declare const STAC_CLIENT_MAX_BYTES: number;
export declare class StacWorkspaceError extends Error {
  code: string; status?: number; ambiguous?: boolean; operationId?: string; method?: string; published?: boolean;
  constructor(code: string, message: string, details?: NativeObject);
}
export declare function stacDigest(bytes: string | Uint8Array): string;
export declare function canonicalStacJSON(value: Json | NativeObject): string;
export declare function nativeStacItemId(item: Pick<StacItem, 'collection' | 'id'>): string;
export declare function readStacHostFile(path: string, maximum?: number, options?: { privateFile?: boolean; expectedSha256?: string }): Promise<Buffer>;
export declare function readStacWorkspaceConfiguration(path: string): Promise<StacWorkspaceConfiguration>;
export declare class StacWorkspaceClient {
  timeoutMs: number; maxResponseBytes: number;
  constructor(definition: StacHostDefinition, options?: { environment?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch });
  readonly metadata: { workspaceId: string | null; connected: boolean; closed: boolean; timeoutMs: number; maxResponseBytes: number; hostOwnership: 'ORIGINAL_STAC_HOST' };
  state(options?: RequestOptions): Promise<StacState>;
  jobs(options?: RequestOptions): Promise<{ jobs: StacJob[] }>;
  job(operationId: string, options?: RequestOptions): Promise<StacJob>;
  edition(editionId: string, options?: RequestOptions): Promise<StacEditionView>;
  compare(input: { leftEditionId: string; rightEditionId: string }, options?: RequestOptions): Promise<StacComparison>;
  discover(input: { operationId: string; expectedRevision: number }, options?: RequestOptions): Promise<StacJob>;
  saveQuery(input: StacQuery & { expectedRevision: number }, options?: RequestOptions): Promise<StacQuery>;
  reviewSearch(input: { queryId: string }, options?: RequestOptions): Promise<NativeObject>;
  acquire(input: { reviewId: string; operationId: string }, options?: RequestOptions): Promise<StacJob>;
  resume(input: { editionId: string; operationId: string }, options?: RequestOptions): Promise<StacJob>;
  cancel(input: { editionId: string }, options?: RequestOptions): Promise<StacEdition>;
  reviewAsset(input: { editionId: string; itemId: string; assetKey: string; maxBytes: number }, options?: RequestOptions): Promise<NativeObject>;
  acquireAsset(input: { reviewId: string; operationId: string }, options?: RequestOptions): Promise<StacJob>;
  setDecision(input: { editionId: string; itemId: string; status: StacDecision['status']; actor: string; note?: string; assetKeys?: string[]; expectedRevision: number }, options?: RequestOptions): Promise<StacDecision>;
  importHandover(bundle: StacHandover, options?: RequestOptions): Promise<NativeObject>;
  processingState(options?: RequestOptions): Promise<NativeObject>;
  processingRead(name: string, query?: ProcessingQuery, options?: RequestOptions): Promise<NativeObject>;
  processingAction(name: string, input: { input?: NativeObject; operationId: string }, options?: RequestOptions): Promise<StacJob>;
  streamAsset(assetId: string, options?: RequestOptions & { expectedSha256?: string }): Promise<StacAssetStream>;
  assetRange(assetId: string, options?: RequestOptions & { expectedSha256?: string; offset?: number; limit?: number }): Promise<StacAssetRange>;
  wait(operationId: string, options?: RequestOptions & { timeoutMs?: number; intervalMs?: number }): Promise<StacJob>;
  file(selection: StacFileSelection, options?: RequestOptions): Promise<StacFile>;
  close(): void;
}
export declare function saveStacFile(client: StacWorkspaceClient, selection: StacFileSelection, destination: string,
  options?: RequestOptions & { expectedSha256?: string }): Promise<StacSavedFile>;
