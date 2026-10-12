/// <reference types="node" />
/** MIT. Complete public types for the original WebDAV merchant tool family. */
export type Uuid = string;
export type Sha256 = string;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: unknown };
export interface RequestOptions {
  requestSignal?: AbortSignal | null;
  timeoutMs?: number;
  /** false retains the original completeResult descriptor for disk receiving. */
  resolveResult?: boolean;
}
export interface OriginalMerchantClient {
  endpoint: string;
  call(name: string, args: JsonObject, options?: RequestOptions): Promise<JsonObject>;
}
export interface WebDavClientOptions {
  /** Select either an original trusted native client or the HTTP url. */
  client?: OriginalMerchantClient;
  url?: string;
  tokenEnv?: string;
  environment?: Record<string, string | undefined>;
  signal?: AbortSignal;
  maximumResultBytes?: number;
}
export interface Scoped { workspace: string }
export interface Mutation extends Scoped { operationId: Uuid; expectedRevision: number; expectedProfileSha256?: Sha256 }
export interface NativeOperation extends JsonObject {
  id: Uuid; action: string; status: 'RUNNING' | 'COMPLETE' | 'INTERRUPTED' | 'FAILED';
  intentSha256: Sha256; createdAt: string; reservedRevision: number;
  input?: JsonObject; resultSha256?: Sha256; resultBytes?: number;
  error?: { code: string; message: string } | null;
}
export interface HistoryPage {
  offset: number; limit: number; total: number; nextOffset: number | null;
  originalWindow?: 'NEWEST_100'; olderByOperationId?: true;
}
export interface NativeWorkspaceState extends JsonObject {
  schema: 'stellar-forge.webdav-workspace.v1'; id: Uuid; revision: number;
  createdAt: string; updatedAt: string; activeSourceId: Uuid | null;
  activeMerchantId: Uuid | null; activeProductId: Uuid | null;
  sources: JsonObject[]; captures: JsonObject[]; mappings: JsonObject[]; editions: JsonObject[];
  merchants: JsonObject[]; exports: JsonObject[]; products: JsonObject[]; operations: NativeOperation[];
  pages: Record<'sources'|'captures'|'mappings'|'editions'|'merchants'|'exports'|'products'|'operations', HistoryPage>;
  running: Array<{ id: Uuid; action: string; startedAt: string }>;
}
export interface SourceDeclaration {
  schema: 'stellar-forge.webdav-source.v1';
  connection: {
    rootUrl: string; allowLocalHttp?: boolean; caFileEnv?: string;
    auth?: { type: 'none' } | { type: 'basic'; usernameEnv: string; passwordEnv: string }
      | { type: 'bearer'; tokenEnv: string };
  };
  limits?: {
    maxListingBytes?: number; maxEntries?: number; maxFileBytes?: number;
    timeoutMs?: number; maxCaptureMs?: number;
  };
}
export interface ConfiguredWorkspace {
  workspace: string; label: string; state: 'OPEN'|'CLOSED';
  sourceProfiles: Array<{ profile: string; label: string; source: SourceDeclaration }>;
  merchantProfiles: Array<{ profile: string; label: string; origin: string; path: string; payment: JsonObject }>;
  buyerWorkspaces: Array<{ buyerWorkspace: string; label: string; directorySha256: Sha256 }>;
  runtime: { port: number; facilitator?: string; allowLocalFacilitator?: boolean };
  sourcePackets: Array<{ packet: string; label: string; sha256: Sha256 }>;
}
export interface WebDavStatus extends JsonObject {
  configured?: boolean; workspace?: string; label?: string; state?: 'OPEN'|'CLOSING'|'CLOSED';
  instanceId?: Uuid; browser?: { url: string }; native?: NativeWorkspaceState;
  workspaces?: ConfiguredWorkspace[];
}
export interface CompleteResult {
  kind: 'result'; id: string; bytes: number; sha256: Sha256;
  content: 'original-operation-record'|'complete-response'; durableOperation: boolean;
  received?: true;
}
export interface NativeResponse<T = JsonObject> extends JsonObject {
  operation?: NativeOperation; result?: T; state?: NativeWorkspaceState;
  active?: boolean; pending?: boolean; replayed?: boolean; completeResult?: CompleteResult;
}
export interface ListingEntry extends JsonObject {
  href: string; originalHref: string; relativeHref: string; name: string;
  kind: 'collection'|'file'|'unknown'; etag: string | null; contentLength: number | null;
  contentLengthText: string | null; lastModified: string | null; contentType: string | null;
  accessible: boolean; issues: JsonValue[]; propertyStatus: JsonObject; properties: JsonObject;
}
export interface RetainedListing extends JsonObject {
  id: Uuid; sha256: Sha256; sourceId?: Uuid; href: string; capturedAt: string;
  offset: number; limit: number; total: number; nextOffset: number | null; entries: ListingEntry[];
}
export interface CaptureSelection {
  id: Uuid; href: string; etag: string | null; contentLength: number | null;
  lastModified: string | null; expectedSha256?: Sha256; restarts?: Uuid;
}
export interface Projection {
  format: 'csv'|'json'|'ndjson'; recordsPointer?: string;
  columns: Record<string, {
    pointer: string; type: 'string'|'integer'|'number'|'boolean';
    nullable?: boolean; missing?: 'error'|'null';
  }>;
}
export interface DatasetContract {
  name: string; filters?: string[]; ranges?: string[]; sorts?: string[];
  maxBytes?: number; maxRows?: number; maxCellChars?: number;
  defaultLimit?: number; maxLimit?: number; maxPageBytes?: number;
}
export interface EditionReview {
  reviewer: string; decision: 'approve'; note?: string;
  expectedCaptureSha256: Sha256; projectionHash: Sha256;
}
export type CaptureArgs = Mutation & (
  { action: 'start'; selection: CaptureSelection } |
  { action: 'resume'; captureId: Uuid } |
  { action: 'sample'; captureId: Uuid; format: 'csv'|'json'|'ndjson'; recordsPointer?: string; limit?: number }
);
export type EditionArgs = Mutation & (
  { action: 'build'; mappingId: Uuid; dataset: DatasetContract; review: EditionReview } |
  { action: 'export'; editionId: Uuid; merchantId: Uuid; reviewer: string; note?: string }
);
export type PublisherAction = 'publisher.prepare'|'publisher.status'|'publisher.preview'|'publisher.reviewDraft'
  |'publisher.publish'|'publisher.activateSnapshot'|'publisher.collect'
  |'publisher.release.stage'|'publisher.release.inspect'|'publisher.release.activate'
  |'publisher.release.rollback'|'publisher.release.start'|'publisher.release.stop'
  |'publisher.buyer.review'|'publisher.buyer.prepare'|'publisher.buyer.session'|'publisher.buyer.run'
  |'publisher.buyer.recover'|'publisher.buyer.account'|'publisher.buyer.export';
export type PublisherFileKind = 'draft-csv'|'draft-review'|'buyer-config'|'session-manifest'|'session-csv'|'session-jsonl'|'session-review';
export type WebDavFileSelector =
  { kind: 'source'; id: Uuid } |
  { kind: 'listing'; id: Uuid; sourceId: Uuid; filename: 'xml'|'json' } |
  { kind: 'capture'; id: Uuid; filename: 'body.bin'|'receipt.json' } |
  { kind: 'edition'; id: Uuid; filename: 'dataset.csv'|'dataset.json'|'source.json'|'edition.json' } |
  { kind: 'export'; id: Uuid; filename: string } |
  { kind: 'packet'; id: Uuid } |
  { kind: 'publisher'; productId: Uuid; id: string; publisherKind: PublisherFileKind } |
  { kind: 'result'; id: string };
export interface OriginalFile {
  name: string; bytes: number; sha256: Sha256; contentType?: string;
}
export interface FileChunk {
  readId: Uuid; file: OriginalFile; offset: number; bytesRead: number;
  nextOffset: number | null; encoding: 'base64'; data: string;
}
export interface ChunkSelection {
  readId?: Uuid; expectedSha256?: Sha256; offset?: number; limit?: number;
}
export interface ToolArguments {
  merchant_webdav_status: { workspace?: string; offset?: number; limit?: number };
  merchant_webdav_open: Scoped;
  merchant_webdav_close: Scoped & { instanceId: Uuid };
  merchant_webdav_source: Mutation & { profile: string };
  merchant_webdav_catalogue: Mutation & { href?: string; depth?: 0|1; offset?: number; limit?: number };
  merchant_webdav_listing: Scoped & { sourceId: Uuid; id: Uuid; offset?: number; limit?: number };
  merchant_webdav_capture: CaptureArgs;
  merchant_webdav_mapping: Mutation & { captureId: Uuid; expectedCaptureSha256: Sha256; projection: Projection };
  merchant_webdav_edition: EditionArgs;
  merchant_webdav_preview: Scoped & { editionId: Uuid; query?: string };
  merchant_webdav_merchant: Mutation & { editionId: Uuid; profile: string; reviewer: string; note?: string };
  merchant_webdav_publisher: Mutation & { action: PublisherAction; productId?: Uuid; payload?: JsonObject };
  merchant_webdav_operation: Scoped & { kind: 'operation'|'capture'|'mapping'|'publisher'; id: Uuid };
  merchant_webdav_cancel: Scoped & { operationId: Uuid };
  merchant_webdav_packet: Mutation;
  merchant_webdav_receive: Scoped & { action: 'inspect'|'receive'; packet: string; expectedSha256: Sha256; offset?: number; limit?: number };
  merchant_webdav_file: Scoped & WebDavFileSelector & ChunkSelection;
  merchant_webdav_file_release: Scoped & { readId: Uuid };
}
export interface ToolResults {
  merchant_webdav_status: WebDavStatus;
  merchant_webdav_open: WebDavStatus;
  merchant_webdav_close: { workspace: string; instanceId: Uuid; state: 'CLOSED' };
  merchant_webdav_source: NativeResponse;
  merchant_webdav_catalogue: NativeResponse<RetainedListing>;
  merchant_webdav_listing: RetainedListing;
  merchant_webdav_capture: NativeResponse;
  merchant_webdav_mapping: NativeResponse;
  merchant_webdav_edition: NativeResponse;
  merchant_webdav_preview: JsonObject;
  merchant_webdav_merchant: NativeResponse;
  merchant_webdav_publisher: NativeResponse;
  merchant_webdav_operation: NativeResponse;
  merchant_webdav_cancel: { operationId: Uuid; cancelling: boolean; state: NativeWorkspaceState };
  merchant_webdav_packet: NativeResponse;
  merchant_webdav_receive: JsonObject;
  merchant_webdav_file: FileChunk;
  merchant_webdav_file_release: { workspace: string; readId: Uuid; released: true };
}
export type ToolName = keyof ToolArguments;
export type MutationToolName = {
  [N in ToolName]: ToolArguments[N] extends Mutation ? N : never
}[ToolName];
export interface FileReadSelection extends Scoped {
  selector: WebDavFileSelector; expectedSha256?: Sha256; maximumBytes?: number;
}
export interface WebDavWorkspaceClient {
  readonly endpoint: string;
  request<N extends ToolName>(name: N, args: ToolArguments[N], options?: RequestOptions): Promise<ToolResults[N]>;
  call<N extends ToolName>(name: N, args: ToolArguments[N], options?: RequestOptions): Promise<ToolResults[N]>;
  status(args?: ToolArguments['merchant_webdav_status'], options?: RequestOptions): Promise<WebDavStatus>;
  open(args: Scoped, options?: RequestOptions): Promise<WebDavStatus>;
  close(args: ToolArguments['merchant_webdav_close'], options?: RequestOptions): Promise<ToolResults['merchant_webdav_close']>;
  source(args: ToolArguments['merchant_webdav_source'], options?: RequestOptions): Promise<NativeResponse>;
  catalogue(args: ToolArguments['merchant_webdav_catalogue'], options?: RequestOptions): Promise<NativeResponse<RetainedListing>>;
  listing(args: ToolArguments['merchant_webdav_listing'], options?: RequestOptions): Promise<RetainedListing>;
  capture(args: CaptureArgs, options?: RequestOptions): Promise<NativeResponse>;
  mapping(args: ToolArguments['merchant_webdav_mapping'], options?: RequestOptions): Promise<NativeResponse>;
  edition(args: EditionArgs, options?: RequestOptions): Promise<NativeResponse>;
  preview(args: ToolArguments['merchant_webdav_preview'], options?: RequestOptions): Promise<JsonObject>;
  merchant(args: ToolArguments['merchant_webdav_merchant'], options?: RequestOptions): Promise<NativeResponse>;
  publisher(args: ToolArguments['merchant_webdav_publisher'], options?: RequestOptions): Promise<NativeResponse>;
  operation(args: ToolArguments['merchant_webdav_operation'], options?: RequestOptions): Promise<NativeResponse>;
  cancel(args: ToolArguments['merchant_webdav_cancel'], options?: RequestOptions): Promise<ToolResults['merchant_webdav_cancel']>;
  packet(args: Mutation, options?: RequestOptions): Promise<NativeResponse>;
  receive(args: ToolArguments['merchant_webdav_receive'], options?: RequestOptions): Promise<JsonObject>;
  file(args: ToolArguments['merchant_webdav_file'], options?: RequestOptions): Promise<FileChunk>;
  releaseFile(args: ToolArguments['merchant_webdav_file_release'], options?: RequestOptions): Promise<ToolResults['merchant_webdav_file_release']>;
  readFileBytes(selection: FileReadSelection, options?: RequestOptions): Promise<{ file: OriginalFile; bytes: Buffer }>;
  readJsonFile<T = JsonValue>(selection: FileReadSelection, options?: RequestOptions): Promise<{ file: OriginalFile; bytes: Buffer; value: T }>;
  assertWorkspace(input: Scoped & { workspaceId: Uuid }, options?: RequestOptions): Promise<WebDavStatus>;
  listingPages(input: ToolArguments['merchant_webdav_listing'], options?: RequestOptions): AsyncGenerator<RetainedListing>;
  historyPages(input: Scoped & { offset?: number; limit?: number }, options?: RequestOptions): AsyncGenerator<WebDavStatus>;
}
export const WEBDAV_TOOL_CONTRACTS: Readonly<Record<ToolName, {
  name: ToolName; description: string; inputSchema: JsonObject; annotations: JsonObject;
}>>;
export function createWebDavWorkspaceClient(options?: WebDavClientOptions): Promise<WebDavWorkspaceClient>;
