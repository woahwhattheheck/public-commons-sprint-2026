import type { FeedProtocolClient, JsonObject } from './feeds-workspace-client.mjs';
export interface FeedDeliveryFile { name: string; bytes: number; sha256: string; contentType: string; }
export interface FeedDeliveryManifest {
  schema: 'stellar-forge.feeds-delivery.v1'; exportId: string; workspace: string; kind: string;
  selection: JsonObject; files: FeedDeliveryFile[]; createdAt: string;
}
export interface FeedDeliveryInfo {
  state: 'MANIFEST_RETAINED'; exportId: string; workspace: string; kind: string; selection: JsonObject;
  files: FeedDeliveryFile[]; manifestFile: { name: 'feed-delivery.json'; bytes: number; sha256: string }; manifestSha256: string;
}
export interface FeedDownloadProgress { exportId: string; file: string; bytes: number; total: number; state: 'DOWNLOADING'; }
export interface FeedDownloadSelection {
  exportId: string; directory: string; expectedManifestSha256?: string; chunkSize?: number;
  onProgress?: (progress: FeedDownloadProgress) => void | Promise<void>;
}
export interface FeedDownloadConnection {
  workspace: string; url?: string | URL; client?: FeedProtocolClient; tokenEnv?: string;
  environment?: Record<string, string | undefined>; signal?: AbortSignal;
}
export interface FeedDownloadCompletion {
  schema: 'stellar-forge.feeds-download.v1'; state: 'COMPLETE'; directory: string; workspace: string;
  exportId: string; kind: string; selection: JsonObject; manifestSha256: string;
  resumed: boolean; resumedBytes: number; files: number; bytes: number;
}
export interface FeedReopenSelection { directory: string; exportId?: string; expectedManifestSha256?: string; expectedEndpoint?: string; }
export interface FeedReopenedDelivery {
  schema: 'stellar-forge.feeds-download.v1'; state: 'REOPENED'; directory: string; workspace: string;
  exportId: string; kind: string; selection: JsonObject; manifest: FeedDeliveryManifest; manifestSha256: string; files: number; bytes: number;
}
export function downloadFeedsDelivery(options: FeedDownloadConnection & FeedDownloadSelection): Promise<FeedDownloadCompletion>;
export function inspectFeedsDelivery(options: FeedDownloadConnection & { exportId: string; expectedManifestSha256?: string }):
  Promise<{ manifest: FeedDeliveryManifest; manifestSha256: string }>;
export function reopenFeedsDelivery(options: FeedReopenSelection & { workspace: string; signal?: AbortSignal }): Promise<FeedReopenedDelivery>;
