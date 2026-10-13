export interface OperationOptions { signal?: AbortSignal; requestSignal?: AbortSignal | null; timeoutMs?: number }
export interface MerchantClientOptions { url: string; tokenEnv?: string; environment?: Record<string,string | undefined>; signal?: AbortSignal }
export interface WorkspaceInput { workspace: string }
export interface SnapshotInput extends WorkspaceInput { exportId: string }
export interface SourceDefinition { id: string; [key: string]: unknown }
export interface FeedDefinition { id: string; [key: string]: unknown }
export interface FileIdentity { name: "snapshot.json" | "events.sqlite"; bytes: number; sha256: string; contentType: string }
export interface SnapshotManifest {
  schema: "stellar-forge.webhook-feed-download.v1"; exportId: string; storeId: string;
  originalManifestSha256: string; createdAt: string; highWatermark: number;
  acceptedEvents: number; retainedEvents: number; purgedThroughSequence: number;
  files: [FileIdentity, FileIdentity]; bytes: number;
}
export interface ManifestResult extends SnapshotInput {
  state: "MANIFEST_RETAINED"; manifest: SnapshotManifest;
  manifestFile: { name: "download.json"; bytes: number; sha256: string };
}
export interface ReceiveResult {
  state: "RECEIVED" | "REOPENED"; directory: string; storeId: string;
  exportId: string; manifestSha256: string;
}
export interface RestoreInput {
  directory: string; destination: string; exportId: string; expectedManifestSha256: string;
}
export interface ReopenInput {
  directory: string; exportId: string; expectedManifestSha256?: string; signal?: AbortSignal;
}
export interface DownloadInput extends SnapshotInput {
  directory: string; expectedManifestSha256?: string; signal?: AbortSignal;
  chunkSize?: number; onProgress?: (progress: Record<string, unknown>) => void | Promise<void>;
}
export interface OriginalClient {
  endpoint: string;
  call(name: string, args?: Record<string, unknown>, options?: OperationOptions): Promise<unknown>;
}
export interface WebhookFeedClient extends OriginalClient {
  close(): Promise<void>;
  workspaces(args?: Record<string, never>, options?: OperationOptions): Promise<{
    workspaces: Array<{workspace: string; label: string; expectedStoreId: string | null}>;
    receivers: string[];
  }>;
  state(args: WorkspaceInput, options?: OperationOptions): Promise<Record<string, unknown>>;
  sourceSave(args: WorkspaceInput & {definition: SourceDefinition; expectedRevision?: string | null}, options?: OperationOptions): Promise<Record<string, unknown>>;
  feedSave(args: WorkspaceInput & {definition: FeedDefinition; expectedRevision?: string | null}, options?: OperationOptions): Promise<Record<string, unknown>>;
  events(args: WorkspaceInput & {after?: number; limit?: number; sourceId?: string}, options?: OperationOptions): Promise<{workspace: string; events: Array<Record<string, unknown>>}>;
  event(args: WorkspaceInput & {sequence: number}, options?: OperationOptions): Promise<Record<string, unknown>>;
  preview(args: WorkspaceInput & {feedId: string; cursor?: string; limit?: number}, options?: OperationOptions): Promise<Record<string, unknown>>;
  planSave(args: WorkspaceInput & {plan: Record<string, unknown>; expectedRevision?: string | null}, options?: OperationOptions): Promise<Record<string, unknown>>;
  release(args: WorkspaceInput & {name: string}, options?: OperationOptions): Promise<Record<string, unknown>>;
  snapshot(args: WorkspaceInput & {name: string}, options?: OperationOptions): Promise<Record<string, unknown>>;
  manifest(args: SnapshotInput, options?: OperationOptions): Promise<ManifestResult>;
  file(args: SnapshotInput & {file: "download.json" | "snapshot.json" | "events.sqlite"; expectedManifestSha256: string; expectedSha256: string; offset?: number; limit?: number; readId?: string}, options?: OperationOptions): Promise<Record<string, unknown>>;
  fileRelease(args: SnapshotInput & {readId: string}, options?: OperationOptions): Promise<Record<string, unknown>>;
  receive(args: SnapshotInput & {receiver: string; expectedManifestSha256: string}, options?: OperationOptions): Promise<ReceiveResult & {workspace: string; receiver: string}>;
  retention(args: WorkspaceInput & {throughSequence: number; expectedHighWatermark: number}, options?: OperationOptions): Promise<Record<string, unknown>>;
  inspectSnapshot(args: SnapshotInput & OperationOptions): Promise<Record<string, unknown>>;
  downloadSnapshot(args: DownloadInput): Promise<Record<string, unknown>>;
  reopenSnapshot(args: ReopenInput): Promise<ReceiveResult & {files: number; bytes: number}>;
  restoreDownloaded(args: RestoreInput): Promise<ReceiveResult>;
}
export declare function openWebhookFeedClient(options: {connection: string}): Promise<WebhookFeedClient>;
export declare function openWebhookFeedMerchantClient(options: MerchantClientOptions): Promise<WebhookFeedClient>;
export declare function inspectWebhookSnapshot(options: SnapshotInput & OperationOptions & {client: OriginalClient}): Promise<Record<string, unknown>>;
export declare function downloadWebhookSnapshot(options: DownloadInput & {client: OriginalClient}): Promise<Record<string, unknown>>;
export declare function reopenWebhookSnapshot(options: ReopenInput): Promise<ReceiveResult & {files: number; bytes: number}>;
export declare const webhookFeedDefinitions: ReadonlyArray<{
  name: string; action: string; description: string; properties: Record<string, unknown>;
  required: string[]; readOnly: boolean;
}>;
