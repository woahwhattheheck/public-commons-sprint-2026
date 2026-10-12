/// <reference types="node" />
export declare const KAFKA_MERCHANT_MANIFEST_NAME: 'manifest.json';
export declare const KAFKA_MERCHANT_EXPORT_SCHEMA: 'stellar-forge.kafka-merchant-export.v1';
export declare const KAFKA_MERCHANT_DOWNLOAD_SCHEMA: 'stellar-forge.kafka-merchant-download.v1';
export declare const KAFKA_MERCHANT_DOWNLOAD_STATE_SCHEMA: 'stellar-forge.kafka-merchant-download-state.v1';
import type { KafkaMerchantManifest, KafkaMerchantFile, KafkaManifestFile } from './merchant-tools.mjs';
export type { KafkaMerchantManifest, KafkaMerchantFile, KafkaManifestFile, KafkaMerchantExportKind } from './merchant-tools.mjs';
export type KafkaMerchantExportManifest = KafkaMerchantManifest;
export interface KafkaMerchantSelection {
  workspace: string;
  artifact: string;
  expectedWorkspaceId?: string;
  expectedBindingSha256?: string;
}
export interface MerchantFileRequestOptions {
  requestSignal?: AbortSignal | null;
  timeoutMs?: number;
}
/** The original connected MCP client returns each tool's structuredContent. */
export interface KafkaMerchantFileClient {
  endpoint: string;
  call(name: string, args: Record<string, unknown>, options?: MerchantFileRequestOptions): Promise<Record<string, unknown>>;
}
export type KafkaMerchantConnection = KafkaMerchantSelection & {
  signal?: AbortSignal;
} & ({
  url: string;
  tokenEnv?: string;
  environment?: NodeJS.ProcessEnv;
  client?: never;
} | {
  client: KafkaMerchantFileClient;
  url?: never;
  tokenEnv?: never;
  environment?: never;
});
export interface KafkaMerchantManifestReview extends KafkaMerchantSelection {
  schema: 'stellar-forge.kafka-merchant-download-review.v1';
  endpoint: string;
  manifest: KafkaMerchantExportManifest;
  manifestSha256: string;
  manifestFile: Pick<KafkaManifestFile, 'name' | 'bytes' | 'sha256'>;
  /** A copy of the exact original bytes, including original whitespace/newline. */
  manifestBytes: Buffer;
}
export interface KafkaMerchantDownloadProgress {
  exportId: string;
  file: string;
  bytes: number;
  total: number;
  state: 'DOWNLOADING';
}
export interface KafkaMerchantDownloadOptions {
  directory: string;
  expectedManifestSha256?: string;
  chunkSize?: number;
  signal?: AbortSignal;
  /** Runs only after the complete chunk and its checkpoint have been saved. */
  onProgress?: (progress: KafkaMerchantDownloadProgress) => void | Promise<void>;
}
export interface KafkaMerchantDownloadResult extends KafkaMerchantSelection {
  schema: typeof KAFKA_MERCHANT_DOWNLOAD_SCHEMA;
  state: 'COMPLETE';
  directory: string;
  endpoint: string;
  exportId: string;
  operation: string;
  workspaceId: string;
  bindingSha256: string;
  kind: KafkaMerchantManifest['kind'];
  file: KafkaMerchantFile;
  manifestSha256: string;
  manifestPath: string;
  filePath: string;
  resumed: boolean;
  resumedBytes: number;
  files: number;
  bytes: number;
}
export interface KafkaMerchantLocalDownloadResult extends KafkaMerchantSelection {
  schema: typeof KAFKA_MERCHANT_DOWNLOAD_SCHEMA;
  state: 'COMPLETE';
  local: true;
  directory: string;
  endpoint: string;
  operation: string;
  workspaceId: string;
  bindingSha256: string;
  kind: KafkaMerchantManifest['kind'];
  file: KafkaMerchantFile;
  manifestSha256: string;
  manifestPath: string;
  filePath: string;
  files: 1;
  bytes: number;
}
export interface KafkaMerchantDownloader extends KafkaMerchantSelection {
  readonly endpoint: string;
  readonly closed: boolean;
  inspect(options?: { expectedManifestSha256?: string; signal?: AbortSignal }): Promise<KafkaMerchantManifestReview>;
  download(options: KafkaMerchantDownloadOptions): Promise<KafkaMerchantDownloadResult>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
export declare function parseKafkaMerchantExportManifest(
  bytes: Uint8Array, selection: KafkaMerchantSelection
): KafkaMerchantExportManifest;
export declare function openKafkaMerchantDownloader(options: KafkaMerchantConnection): Promise<KafkaMerchantDownloader>;
export declare function inspectKafkaMerchantExport(
  options: KafkaMerchantConnection & { expectedManifestSha256?: string }
): Promise<KafkaMerchantManifestReview>;
export declare function downloadKafkaMerchantExport(
  options: KafkaMerchantConnection & KafkaMerchantDownloadOptions
): Promise<KafkaMerchantDownloadResult>;
export declare function inspectKafkaMerchantDownload(
  options: KafkaMerchantSelection & { directory: string; expectedManifestSha256?: string; signal?: AbortSignal }
): Promise<KafkaMerchantLocalDownloadResult>;
