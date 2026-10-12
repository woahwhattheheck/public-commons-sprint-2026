/// <reference types="node" />
import type { WebDavWorkspaceClient, WebDavFileSelector, Uuid, Sha256, JsonObject, RequestOptions } from './webdav-workspace-client.mjs';
export interface ReceivingFile {
  name: string; remoteName: string; bytes: number; sha256: Sha256; selector: WebDavFileSelector;
}
export interface ReceivingManifest {
  schema: 'stellar-forge.webdav-client-receiving.v1'; exportId: Sha256;
  endpoint: string; workspace: string; workspaceId: Uuid;
  source: { mode: 'export'; id: Uuid; manifestSha256: Sha256; editionId: Uuid; merchantId: Uuid; snapshot: string }
    | { mode: 'files' };
  files: ReceivingFile[];
}
export interface ReceivingProgress { exportId: string; file: string; bytes: number; total: number; state: 'DOWNLOADING' }
export interface ReceivingResult {
  schema: 'stellar-forge.webdav-client-download-result.v1'; state: 'COMPLETE'; directory: string;
  exportId: Sha256; workspace: string; workspaceId: Uuid; source: ReceivingManifest['source'];
  originalEndpoint: string; manifestSha256: Sha256; resumed: boolean; resumedBytes: number;
  files: number; bytes: number; manifestFile: string;
}
export function prepareWebDavReceiving(input: {
  client: WebDavWorkspaceClient; workspace: string;
} & ({ exportId: Uuid; expectedManifestSha256?: Sha256; files?: never } | {
  files: Array<{ name: string; selector: WebDavFileSelector; expectedSha256?: Sha256 }>;
  exportId?: never; expectedManifestSha256?: never;
}), options?: RequestOptions): Promise<{ manifest: ReceivingManifest; manifestSha256: Sha256 }>;
export function downloadWebDavReceiving(input: {
  client: WebDavWorkspaceClient; manifest: ReceivingManifest | Buffer; directory: string;
  expectedManifestSha256?: Sha256; signal?: AbortSignal; chunkSize?: number;
  onProgress?: (progress: ReceivingProgress) => void | Promise<void>;
}): Promise<ReceivingResult>;
export function inspectWebDavReceiving(input: {
  directory: string; expectedManifestSha256?: Sha256; signal?: AbortSignal;
}): Promise<{ schema: 'stellar-forge.webdav-client-offline-receiving.v1'; state: 'COMPLETE';
  directory: string; manifestSha256: Sha256; manifest: ReceivingManifest; files: number; bytes: number }>;
export function restoreWebDavSourcePacket(input: {
  directory: string; file: string; destination: string; python?: string;
  expectedManifestSha256?: Sha256; signal?: AbortSignal;
}): Promise<JsonObject & { originalReceivingId: Sha256; originalWorkspaceId: Uuid }>;
