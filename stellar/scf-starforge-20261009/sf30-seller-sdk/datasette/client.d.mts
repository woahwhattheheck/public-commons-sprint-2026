/** Datasette workspace interfaces over the original retained source and publisher. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue | undefined; }

/** Source metadata describes an existing host account or plugin selection.
 * Keep credential values in the native host connection, outside this record. */
export interface DatasetteSelection {
  url: string;
  kind?: 'table' | 'query';
  database?: string;
  table?: string;
  query?: string;
  columns?: string[];
  columnSource?: JsonObject & { url: string; sha256: string };
  account?: string;
  authentication?: { plugin: string; selector: string };
  continuation?: 'next_url' | 'link';
  metadata?: JsonValue;
  immutableIdentity?: { value: string; evidence: JsonValue };
}
/** The original HTTP response retained by source.adopt. Use bodyEncoding: 'base64'
 * when transporting saved bytes through JSON; otherwise body is the original UTF-8 text. */
export interface DatasetteCapturedPage extends JsonObject {
  body: string;
  bodyEncoding?: 'base64';
  requestedUrl?: string;
  requested_url?: string;
  responseUrl?: string;
  response_url?: string;
  status?: number | null;
  headers?: JsonObject | Array<[string, string]>;
  startedAt?: string | null;
  completedAt?: string | null;
  retrievedAt?: string | null;
  retrievalWindow?: { notBefore?: string; notAfter?: string; not_before?: string; not_after?: string };
  providerReceipt?: JsonObject;
  responseUrlBasis?: string;
  originalReceipt?: JsonObject;
  recovery?: JsonObject;
  sha256?: string;
  redirects?: JsonValue[];
}
export interface PageSelection { offset?: number; limit?: number; }
export interface SourceReview {
  key?: string[];
  /** Pass the original complete native projection definition. */
  projection?: JsonObject;
}
export interface PublisherReview {
  runId: string;
  /** Retain this exact original request through a lost response. */
  requestId?: string;
  reviewer: string;
  note: string;
  initialize?: boolean;
  expectedSnapshot?: string;
  expectedRevision?: number;
}
export interface DatasetteOperationInputs {
  'source.capture': {
    operationId: string; selection: DatasetteSelection; pageLimit?: number;
  };
  'source.adopt': {
    operationId: string; selection: DatasetteSelection;
    /** Complete originally captured response records, including native metadata. */
    pages: DatasetteCapturedPage[];
  };
  'source.inspect': PageSelection & { operationId: string };
  'source.review': SourceReview & { operationId: string };
  'editions.create': { id: string; operationId: string; name: string; key: string[]; projection: JsonObject };
  'editions.list': Record<string, never>;
  'editions.inspect': PageSelection & { id: string };
  'editions.compare': { left: string; right: string };
  'source.select': { editionId: string; query?: string; requestId?: string; expectedSelectionHash?: string | null };
  'publisher.status': { limit?: number; plansOffset?: number; runsOffset?: number; historyOffset?: number };
  'publisher.source': Record<string, never>;
  'publisher.target': Record<string, never>;
  'publisher.plan': {
    title: string; query?: string; input?: JsonObject; dataset?: JsonObject;
    extraction?: JsonObject; sourceHash?: string; requestId?: string;
  };
  /** runId is the original UUID for this extraction, including continuation. */
  'publisher.extract': { planId: string | number; runId: string };
  'publisher.inspect': { runId: string; query?: string };
  'publisher.review': PublisherReview;
  'publisher.publish': { runId: string; reviewId: string };
  'publisher.recover': { runId: string };
  'publisher.buyer-offer': { runId: string; query?: string };
  /** Native buyer fields retain the existing publisher's buyer input contract. */
  'publisher.prepare-buyer': JsonObject & { runId: string };
  'release.prepare': {
    runId: string; outputDirectory?: string; payment: JsonObject; origin: string; path?: string;
  };
  'release.stage': {
    packageDirectory: string; releaseDirectory?: string; id: string; label?: string; runtime?: JsonValue;
  };
  'source.export': { editionId: string; outputFile?: string };
  'source.receive': { archiveFile: string; sha256: string; directory?: string; id?: string };
  'files.list': PageSelection & { prefix?: string };
  'files.inspect': { path: string; sha256?: string };
  'files.read': { path: string; sha256: string; offset?: number | string; limit?: number | string };
  'workspace.export': { outputFile?: string };
  'workspace.receive': { archiveFile: string; directory: string; sha256: string };
  'requests.inspect': { requestId: string };
  'requests.list': PageSelection;
  'operations.inspect': { operationId: string };
  'operations.cancel': { operationId: string };
}
export type DatasetteOperation = keyof DatasetteOperationInputs;
export declare const DATASETTE_OPERATIONS: readonly DatasetteOperation[];

export interface DatasetteHealth extends JsonObject {
  schema: string;
  workspaceId: string;
  instanceId?: string;
  directory?: string;
  pid?: number;
}
export interface DatasetteRetainedFile extends JsonObject {
  schema: 'stellar-forge.datasette-retained-file.v1';
  workspaceId: string;
  path: string;
  name: string;
  /** Decimal byte count, preserving the original file identity. */
  bytes: string;
  sha256: string;
  kind: string;
  modifiedAt: string;
}
export interface DatasetteFilePage extends JsonObject {
  workspaceId: string;
  files: DatasetteRetainedFile[];
  page: { offset: number; limit: number; total: number; next: number | null; previous: number | null };
}
export interface DatasetteFileChunk extends DatasetteRetainedFile {
  offset: string;
  length: string;
  encoding: 'base64';
  data: string;
  complete: boolean;
  nextOffset: string | null;
}
export interface DatasetteWorkspaceArchive extends JsonObject {
  schema: 'stellar-forge.datasette-workspace-archive.v1';
  workspaceId: string;
  archiveFile: string;
  bytes: string;
  sha256: string;
  manifestSha256: string;
  snapshotSha256: string;
  manifest: JsonObject;
  reused: boolean;
  retainedFile?: DatasetteRetainedFile;
}
export interface DatasetteWorkspaceReceiving extends JsonObject {
  schema: 'stellar-forge.datasette-workspace-receiving.v1';
  workspaceId: string;
  directory: string;
  archiveFile: string;
  bytes: string;
  sha256: string;
  phase: 'COMPLETE';
  originalArchive: string;
  manifestFile: string;
  preimagesDirectory: string;
  relocations: JsonObject[];
  reused: boolean;
  manifest: JsonObject;
}
/** Original archive declaration retained before the first body byte. */
export interface DatasetteUploadDeclaration {
  uploadId: string;
  name: string;
  bytes: string;
  sha256: string;
}
export interface DatasetteUploadRange extends DatasetteUploadDeclaration {
  offset: string;
  length: string;
}
export interface DatasetteUploadStatus extends JsonObject {
  schema: 'stellar-forge.datasette-upload.v1';
  workspaceId: string;
  uploadId: string;
  state: 'RECEIVING' | 'FINALIZABLE' | 'COMPLETE' | 'REJECTED';
  name: string;
  bytes: string;
  sha256: string;
  receivedBytes: string;
  prefixSha256: string;
  uncheckpointedBytes: string;
  chunks: number;
  maximumChunkBytes: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  archiveFile?: string;
  retainedFile?: DatasetteRetainedFile;
  error?: JsonObject;
  replayed?: boolean;
}
export interface DatasetteOriginalRequest extends JsonObject {
  schema: 'stellar-forge.datasette-request.v1';
  workspaceId: string; requestId: string; operation: string; input: JsonObject; requestHash: string;
  state: 'PENDING' | 'COMPLETE' | 'REJECTED'; createdAt: string; completedAt: string | null;
  result: JsonValue | null; error: JsonObject | null;
  receiving?: {originDirectory:string;directory:string;note:string};
}
export interface DatasetteRequestPage extends JsonObject {
  schema: 'stellar-forge.datasette-request-list.v1'; workspaceId: string;
  requests: Array<JsonObject & {requestId:string;operation:string;requestHash:string;state:string}>;
  page: {offset:number;limit:number;total:number;next:number|null;previous:number|null};
}
export interface DatasetteOperationResults {
  'requests.inspect': DatasetteOriginalRequest;
  'requests.list': DatasetteRequestPage;
  'files.list': DatasetteFilePage;
  'files.inspect': DatasetteRetainedFile;
  'files.read': DatasetteFileChunk;
  'workspace.export': DatasetteWorkspaceArchive;
  'workspace.receive': DatasetteWorkspaceReceiving;
}
export type DatasetteOperationResult<K extends DatasetteOperation> =
  K extends keyof DatasetteOperationResults ? DatasetteOperationResults[K] : JsonValue;
export interface DatasetteRequestOptions { signal?: AbortSignal; }
export interface DatasetteClientOptions {
  /** Original local HTTP workspace URL, or an explicitly supplied HTTPS origin. */
  url: string;
  expectedWorkspaceId?: string;
  fetchImpl?: typeof globalThis.fetch;
  /** 1–3600000 milliseconds. Default 300000. */
  timeoutMs?: number;
  /** 1024–268435456 bytes. Default 33554432. */
  maxResponseBytes?: number;
}
export interface DatasetteClient {
  readonly origin: string;
  /** Identity returned by the first successful health read. */
  readonly workspaceId: string | null;
  health(options?: DatasetteRequestOptions): Promise<DatasetteHealth>;
  status(options?: DatasetteRequestOptions): Promise<JsonValue>;
  operations(options?: DatasetteRequestOptions): Promise<JsonValue>;
  uploadStatus(input: {uploadId: string}, options?: DatasetteRequestOptions): Promise<DatasetteUploadStatus>;
  /** At most 8 MiB per request. Retain uploadId and read status after interruption. */
  uploadChunk(input: DatasetteUploadRange, rawBytes: Uint8Array | ArrayBuffer | Blob,
    options?: DatasetteRequestOptions): Promise<DatasetteUploadStatus>;
  /** Every action uses the original workspace dispatch and retains native results.
   * No transport or timeout failure automatically repeats a mutation. */
  dispatch<K extends DatasetteOperation>(
    operation: K,
    input: DatasetteOperationInputs[K],
    options?: DatasetteRequestOptions,
  ): Promise<DatasetteOperationResult<K>>;
}
export interface DatasetteErrorContext {
  status?: number | null;
  operation?: string | null;
  operationId?: string | null;
  uncertain?: boolean;
  result?: JsonValue | null;
  cause?: unknown;
}
export declare class DatasetteClientError extends Error {
  constructor(code: string, message: string, context?: DatasetteErrorContext);
  readonly code: string;
  readonly status: number | null;
  readonly operation: string | null;
  readonly operationId: string | null;
  /** A mutating response was not received completely; inspect its original state. */
  readonly uncertain: boolean;
  readonly result: JsonValue | null;
}
export declare function datasetteConnection(url: string): Readonly<{ origin: string }>;
export declare function createDatasetteClient(options: DatasetteClientOptions): DatasetteClient;
