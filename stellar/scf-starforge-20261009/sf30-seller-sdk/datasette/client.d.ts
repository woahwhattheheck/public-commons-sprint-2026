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
  requestedUrl: string;
  responseUrl: string;
  status: number;
  headers: JsonObject | Array<[string, string]>;
  startedAt: string;
  completedAt: string;
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
  'editions.create': SourceReview & { id: string; operationId: string; name: string };
  'editions.list': Record<string, never>;
  'editions.inspect': PageSelection & { id: string };
  'editions.compare': { left: string; right: string };
  'source.select': { editionId: string; query?: string };
  'publisher.status': Record<string, never>;
  'publisher.source': Record<string, never>;
  'publisher.target': Record<string, never>;
  'publisher.plan': {
    title: string; query?: string; input?: JsonObject; dataset?: JsonObject;
    extraction?: JsonObject; sourceHash?: string;
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
    runId: string; outputDirectory: string; payment: JsonObject; origin: string; path?: string;
  };
  'release.stage': {
    packageDirectory: string; releaseDirectory: string; id: string; label?: string; runtime?: JsonValue;
  };
  'source.export': { editionId: string; outputFile: string };
  'source.receive': { archiveFile: string; directory: string };
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
  /** Every action uses the original workspace dispatch and retains native results.
   * No transport or timeout failure automatically repeats a mutation. */
  dispatch<K extends DatasetteOperation>(
    operation: K,
    input: DatasetteOperationInputs[K],
    options?: DatasetteRequestOptions,
  ): Promise<JsonValue>;
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
