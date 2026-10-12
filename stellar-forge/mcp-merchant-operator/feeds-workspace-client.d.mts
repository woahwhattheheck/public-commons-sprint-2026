import type { PreparedFeedsRequest, FeedsRequestRecord, FeedsRequestRecovery } from './feeds-workspace-request.mjs';
import type { FeedDeliveryManifest, FeedDeliveryInfo, FeedDownloadCompletion, FeedReopenedDelivery,
  FeedDownloadProgress, FeedDownloadSelection, FeedReopenSelection } from './feeds-download.mjs';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [name: string]: JsonValue };
export type JsonObject = { [name: string]: JsonValue };
export type FeedFamily = 'feed' | 'collection';
export type FeedField = 'key' | 'id' | 'title' | 'link' | 'published' | 'updated' | 'summary' | 'content' |
  'authors' | 'categories' | 'enclosures' | 'feed_id' | 'source_url' | 'source_sha256';
export interface FeedConfig { url: string; label?: string; rssIdentity?: 'guid' | 'guid-or-link'; allowedOrigins?: string[]; }
export interface FeedCollectionMember { sourceId: string | null; entryId: string | null; feedId: string | null; enabled: boolean; }
export type FeedRevisions = Record<string, number>;
export interface FeedActionInputs {
  register: { feedId: string; config: FeedConfig; expectedRevision: number; operationId: string };
  capture: { feedId: string; operationId: string; followPages?: boolean; pageLimit?: number; force?: boolean; fromCapture?: string };
  resume: { captureId: string };
  apply: { captureId: string; expectedRevision: number; operationId: string; decisions?: Record<string, string>; acceptIdentity?: boolean };
  annotate: { feedId: string; identity: string; expectedRevision: number; operationId: string; note?: string; tags?: string[]; starred?: boolean };
  edition: { feedIds: string[]; name: string; fields: FeedField[]; expectedRevisions: FeedRevisions; operationId: string };
  query: { editionId: string; params?: Record<string, string> };
  compare: { beforeId: string; afterId: string };
  'collection-save': { collectionId: string; title: string; members: FeedCollectionMember[]; newFeeds?: Record<string, FeedConfig>; expectedRevision: number; operationId: string };
  'collection-capture': { collectionId: string; expectedRevision: number; expectedRevisions: FeedRevisions; operationId: string; pageLimit?: number; force?: boolean };
  'collection-resume': { runId: string };
  'collection-edition': { runId: string; name: string; fields: FeedField[]; expectedRevisions: FeedRevisions; operationId: string };
}
export type FeedAction = keyof FeedActionInputs;
export type FeedActionSelection = { [A in FeedAction]: { action: A; input: FeedActionInputs[A] } }[FeedAction];
export type FeedPublisherAction = 'publisher.status' | 'publisher.preview' | 'publisher.reviewDraft' | 'publisher.publish' |
  'publisher.activateSnapshot' | 'publisher.collect' | 'publisher.release.stage' | 'publisher.release.inspect' |
  'publisher.release.activate' | 'publisher.release.rollback' | 'publisher.release.start' | 'publisher.release.stop' |
  'publisher.buyer.review' | 'publisher.buyer.prepare' | 'publisher.buyer.session' | 'publisher.buyer.run' |
  'publisher.buyer.recover' | 'publisher.buyer.account' | 'publisher.buyer.export';
export interface FeedPageInput { offset?: number; limit?: number; expectedSnapshot?: string; }
export interface FeedInventoryInput extends FeedPageInput { kind: 'feeds' | 'editions' | 'subscription-sources' | 'collections'; }
export type FeedReadArray = 'entries' | 'items' | 'requests' | 'collection.members' | 'feeds' | 'registrations' |
  'runs' | 'editions' | 'revisions';
export interface FeedReadBase { id: string; offset?: number; limit?: number; family?: FeedFamily; revision?: number; query?: string; state?: 'active' | 'deleted' | 'all'; }
export type FeedReadInput = FeedReadBase & (
  { kind: 'captures' | 'review' | 'records' | 'changes'; array?: never; expectedSnapshot?: never } |
  { kind: 'operation' | 'subscription-plan' | 'collection' | 'collection-run' | 'requests' | 'edition';
    array?: FeedReadArray; expectedSnapshot?: string }
);
export interface FeedIntakeInput { file: string; operationId: string; feedId?: string; sourceUrl?: string; }
export type FeedExportKind = 'feed-project' | 'collection-project' | 'dataset' | 'opml' | 'opml-source' | 'source' | 'http-body' | 'changes';
export interface FeedExportInput { operationId: string; kind: FeedExportKind; id: string; revision?: number; }
export type FeedReceiveInput = { operationId: string } & (
  { file: string; fromWorkspace?: never; exportId?: never } |
  { file?: never; fromWorkspace?: string; exportId: string }
);
export interface FeedPublisherPrepareInput { productId: string; editionId: string; profile: string; }
export interface FeedPublisherInput { productId: string; action: FeedPublisherAction; input: JsonObject; }
export interface FeedPublisherExportInput { productId: string; operationId: string; id: string; kind: 'draft-csv' | 'draft-review' | 'buyer-config' | 'customer'; }
export interface FeedFileInput { exportId: string; file: string; expectedManifestSha256: string; expectedSha256: string; readId?: string; offset?: number; limit?: number; }
export interface FeedToolInputs {
  merchant_feeds_workspaces: Record<string, never>;
  merchant_feeds_status: Record<string, never>;
  merchant_feeds_inventory: FeedInventoryInput;
  merchant_feeds_read: FeedReadInput;
  merchant_feeds_action: FeedActionSelection;
  merchant_feeds_intake: FeedIntakeInput;
  merchant_feeds_cancel: { jobId: string };
  merchant_feeds_export: FeedExportInput;
  merchant_feeds_exports: FeedPageInput;
  merchant_feeds_receive: FeedReceiveInput;
  merchant_feeds_publisher_prepare: FeedPublisherPrepareInput;
  merchant_feeds_publishers: { productId?: string };
  merchant_feeds_publisher: FeedPublisherInput;
  merchant_feeds_publisher_export: FeedPublisherExportInput;
  merchant_feeds_download_manifest: { exportId: string };
  merchant_feeds_download_file: FeedFileInput;
  merchant_feeds_download_file_release: { exportId: string; readId: string };
}
export type FeedToolName = keyof FeedToolInputs;
export interface FeedActivity {
  state: 'IDLE' | 'RUNNING' | 'DONE' | 'FAILED'; id?: string; action?: string; operationId?: string | null;
  startedAt?: number; completedAt?: number; result?: JsonValue; error?: string;
  capture?: JsonValue; collection?: JsonValue;
}
export interface FeedStatus {
  ownership: 'EXISTING_FEED_CONSOLE'; activity: FeedActivity;
  counts?: { feeds: number; editions: number; subscriptionSources: number; collections: number };
  fields?: FeedField[]; defaultFields?: FeedField[]; fileReads?: JsonObject;
}
export interface FeedNativeOperation {
  schema: 'stellar-forge.feed-operation.v1'; id: string; family: FeedFamily; historyOnly: boolean;
  created: number; state: 'RESULT_RETAINED' | 'INTENT_RETAINED'; request: JsonObject; result: JsonValue;
  run: JsonObject | null; continuation: { action: 'resume'; captureId: string } | { action: 'collection-resume'; runId: string } | null;
}
export interface FeedNativePage<T = JsonValue> { items: T[]; nextOffset: number | null; offset?: number; total?: number; snapshot?: string; array?: FeedReadArray; selection?: JsonObject; kind?: string; }
export type FeedReply<T = JsonValue> = { workspace: string; native: T } |
  { workspace: string; nativeSummary: JsonObject; completeResult: FeedDeliveryInfo };
export interface FeedWorkspaceDeclaration {
  workspace: string; label: string;
  inputs: { file: string; kind: 'feed' | 'opml' | 'feed-project' | 'collection-project'; label: string; sha256: string }[];
  merchantProfiles: string[]; buyerWorkspaces: string[]; fileReads: JsonObject;
}
export interface FeedWorkspacesReply { workspaces: FeedWorkspaceDeclaration[]; [name: string]: unknown; }
export interface FeedRetainedExportsPage extends FeedNativePage<FeedDeliveryInfo | {
  state: 'PREPARING' | 'PREPARATION_UNBOUND'; exportId: string; kind?: string; operationId?: string; selection?: JsonObject; recovery?: string;
}> { workspace: string; }
export interface FeedFileReply {
  workspace: string; exportId: string; manifestSha256: string;
  file: { name: string; bytes: number; sha256: string; contentType?: string };
  readId: string; offset: number; bytesRead: number; nextOffset: number | null; encoding: 'base64'; data: string;
}
export interface FeedToolResults {
  merchant_feeds_workspaces: FeedWorkspacesReply;
  merchant_feeds_status: FeedReply<FeedStatus>;
  merchant_feeds_inventory: FeedReply<FeedNativePage>;
  merchant_feeds_read: FeedReply;
  merchant_feeds_action: FeedReply<FeedActivity>;
  merchant_feeds_intake: FeedReply<FeedActivity>;
  merchant_feeds_cancel: FeedReply;
  merchant_feeds_export: FeedDeliveryInfo;
  merchant_feeds_exports: FeedRetainedExportsPage;
  merchant_feeds_receive: FeedReply<FeedActivity>;
  merchant_feeds_publisher_prepare: FeedReply;
  merchant_feeds_publishers: FeedReply | { workspace: string; products: { productId: string; opened: boolean }[] };
  merchant_feeds_publisher: FeedReply;
  merchant_feeds_publisher_export: FeedDeliveryInfo;
  merchant_feeds_download_manifest: FeedDeliveryInfo;
  merchant_feeds_download_file: FeedFileReply;
  merchant_feeds_download_file_release: { workspace: string; exportId: string; readId: string; released: true };
}
/** A trusted provided adapter keeps its own underlying factory lifetime. */
export interface FeedProtocolClient {
  endpoint: string;
  call(name: string, arguments_: Record<string, unknown>, options?: { requestSignal?: AbortSignal | null; timeoutMs?: number }): Promise<unknown>;
}
export interface FeedsClientOptions {
  workspace: string; url?: string | URL; client?: FeedProtocolClient; tokenEnv?: string; environment?: Record<string, string | undefined>;
  signal?: AbortSignal; timeoutMs?: number; resultsDirectory?: string; maximumResponseBytes?: number;
}
export interface FeedCallOptions { signal?: AbortSignal; timeoutMs?: number; }
export interface FeedResolveOptions extends FeedCallOptions {
  directory?: string; resultsDirectory?: string; chunkSize?: number;
  onProgress?: (progress: FeedDownloadProgress) => void | Promise<void>;
}
export interface FeedResolvedReply<T = JsonValue> {
  workspace: string; native: T;
  delivery: (FeedDownloadCompletion & { manifest: FeedDeliveryManifest; resultPath: string }) | null;
}
export interface FeedPageOptions extends FeedResolveOptions { maxPages?: number; }
export interface FeedOperationSelection { operationId: string; family?: FeedFamily; jobId?: string; }
export interface FeedOperationObservation {
  schema: 'stellar-forge.feeds-client-operation.v1'; workspace: string; selection: FeedOperationSelection;
  state: 'RUNNING' | 'CONSOLE_BUSY' | 'JOB_FAILED' | 'OPERATION_NOT_FOUND' | 'HISTORY_RETAINED' | 'RESULT_RETAINED' | 'CONTINUATION_AVAILABLE' | 'INTENT_RETAINED';
  activity: FeedActivity; operation: FeedNativeOperation | null; deliveries: NonNullable<FeedResolvedReply['delivery']>[];
}
export interface FeedJobObservation {
  schema: 'stellar-forge.feeds-client-job.v1'; workspace: string; jobId: string;
  state: FeedActivity['state'] | 'JOB_NO_LONGER_CURRENT'; activity: FeedActivity; delivery: FeedResolvedReply['delivery'];
}
export interface FeedWaitOptions<T = FeedOperationObservation> extends FeedResolveOptions {
  pollMs?: number; maximumWaitMs?: number; onActivity?: (activity: T) => void | Promise<void>;
}
export interface FeedRequestExecutionOptions extends FeedCallOptions { directory: string; repeat?: boolean; }
export interface FeedReconciliation {
  schema: 'stellar-forge.feeds-client-reconciliation.v1'; workspace: string; state: 'NATIVE_OBSERVATION';
  directory: string; recordState: FeedsRequestRecord['state']; request: PreparedFeedsRequest;
  invocation: FeedsRequestRecord['invocation']; response: FeedsRequestRecord['response'];
  activity: FeedActivity; operation: FeedNativeOperation | null; publisher: JsonValue | null;
  deliveries: NonNullable<FeedResolvedReply['delivery']>[];
}
export class FeedsWorkspaceClient {
  constructor(transport: FeedProtocolClient, options: Pick<FeedsClientOptions, 'workspace' | 'signal' | 'timeoutMs' | 'resultsDirectory'>);
  readonly endpoint: string; readonly workspace: string; readonly closing: boolean;
  call<K extends FeedToolName>(name: K, input: FeedToolInputs[K], options?: FeedCallOptions): Promise<FeedToolResults[K]>;
  workspaces(options?: FeedCallOptions): Promise<FeedWorkspacesReply>;
  status(options?: FeedCallOptions): Promise<FeedReply<FeedStatus>>;
  inventory(input: FeedInventoryInput, options?: FeedCallOptions): Promise<FeedReply<FeedNativePage>>;
  read(input: FeedReadInput, options?: FeedCallOptions): Promise<FeedReply>;
  action<A extends FeedAction>(action: A, input: FeedActionInputs[A], options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  register(input: FeedActionInputs['register'], options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  capture(input: FeedActionInputs['capture'], options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  resume(input: FeedActionInputs['resume'], options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  apply(input: FeedActionInputs['apply'], options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  annotate(input: FeedActionInputs['annotate'], options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  edition(input: FeedActionInputs['edition'], options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  query(input: FeedActionInputs['query'], options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  compare(input: FeedActionInputs['compare'], options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  saveCollection(input: FeedActionInputs['collection-save'], options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  captureCollection(input: FeedActionInputs['collection-capture'], options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  resumeCollection(input: FeedActionInputs['collection-resume'], options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  collectionEdition(input: FeedActionInputs['collection-edition'], options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  intake(input: FeedIntakeInput, options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  cancel(jobId: string, options?: FeedCallOptions): Promise<FeedReply>;
  export(input: FeedExportInput, options?: FeedCallOptions): Promise<FeedDeliveryInfo>;
  exports(input?: FeedPageInput, options?: FeedCallOptions): Promise<FeedRetainedExportsPage>;
  receive(input: FeedReceiveInput, options?: FeedCallOptions): Promise<FeedReply<FeedActivity>>;
  preparePublisher(input: FeedPublisherPrepareInput, options?: FeedCallOptions): Promise<FeedReply>;
  publishers(input?: { productId?: string }, options?: FeedCallOptions): Promise<FeedToolResults['merchant_feeds_publishers']>;
  publisher(productId: string, action: FeedPublisherAction, input?: JsonObject, options?: FeedCallOptions): Promise<FeedReply>;
  publisherExport(input: FeedPublisherExportInput, options?: FeedCallOptions): Promise<FeedDeliveryInfo>;
  manifest(exportId: string, options?: FeedCallOptions): Promise<FeedDeliveryInfo>;
  readFile(input: FeedFileInput, options?: FeedCallOptions): Promise<FeedFileReply>;
  releaseFile(input: { exportId: string; readId: string }, options?: FeedCallOptions): Promise<FeedToolResults['merchant_feeds_download_file_release']>;
  resolveResult<T = JsonValue>(reply: FeedReply<T>, options?: FeedResolveOptions): Promise<FeedResolvedReply<T>>;
  inspectDelivery(input: { exportId: string; expectedManifestSha256?: string }, options?: FeedCallOptions): Promise<{ manifest: FeedDeliveryManifest; manifestSha256: string }>;
  downloadDelivery(input: FeedDownloadSelection, options?: FeedCallOptions): Promise<FeedDownloadCompletion>;
  reopenDelivery(input: FeedReopenSelection, options?: FeedCallOptions): Promise<FeedReopenedDelivery>;
  exportAndDownload(input: FeedExportInput, receiving: Omit<FeedDownloadSelection, 'exportId' | 'expectedManifestSha256'>, options?: FeedCallOptions):
    Promise<{ workspace: string; exported: FeedDeliveryInfo; download: FeedDownloadCompletion }>;
  customerAndDownload(input: Omit<FeedPublisherExportInput, 'kind'>, receiving: Omit<FeedDownloadSelection, 'exportId' | 'expectedManifestSha256'>, options?: FeedCallOptions):
    Promise<{ workspace: string; exported: FeedDeliveryInfo; download: FeedDownloadCompletion }>;
  inventoryPages(input: FeedInventoryInput, options?: FeedPageOptions): AsyncGenerator<FeedResolvedReply<FeedNativePage>>;
  readPages(input: FeedReadInput, options?: FeedPageOptions): AsyncGenerator<FeedResolvedReply<FeedNativePage>>;
  exportPages(input?: FeedPageInput, options?: FeedPageOptions): AsyncGenerator<FeedResolvedReply<FeedRetainedExportsPage>>;
  operation(input: FeedOperationSelection, options?: FeedCallOptions): Promise<FeedReply<FeedNativeOperation>>;
  waitForOperation(input: FeedOperationSelection, options?: FeedWaitOptions): Promise<FeedOperationObservation>;
  waitForJob(jobId: string, options?: FeedWaitOptions<FeedJobObservation>): Promise<FeedJobObservation>;
  prepare<K extends FeedToolName>(tool: K, input: FeedToolInputs[K], options?: { recovery?: FeedsRequestRecovery }): PreparedFeedsRequest<K>;
  execute<K extends FeedToolName>(request: PreparedFeedsRequest<K>, options: FeedRequestExecutionOptions): Promise<FeedsRequestRecord<K>>;
  reconcile(options: FeedResolveOptions & { directory: string }): Promise<FeedReconciliation>;
  requestClose(): void;
  close(): Promise<void>;
}
export function openFeedsWorkspaceClient(options: FeedsClientOptions): Promise<FeedsWorkspaceClient>;
export const FEEDS_CLIENT_TOOLS: readonly FeedToolName[];
export { createFeedsRequest, readFeedsRequest, writeFeedsRequest, retainFeedsRequest, inspectFeedsRequest } from './feeds-workspace-request.mjs';
export { downloadFeedsDelivery, inspectFeedsDelivery, reopenFeedsDelivery } from './feeds-download.mjs';
