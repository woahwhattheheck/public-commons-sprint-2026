/** MIT. Complete selected native files through the original retained downloader.
 *
 * This is a client-bound file-set manifest, not a replacement provider manifest
 * or a new source acquisition. Received native file bytes and hashes are exact.
 */
import type {
  ConcreteFileSelection,
  FileSelection,
  FileListArguments,
  FileReadArguments,
  FileReleaseArguments,
  Sha256,
  WorkspaceAlias,
  WorkspaceId,
  WorkspaceScope
} from './mcp.mjs';

export const DOWNLOAD_SCHEMA: 'stellar-forge.sensorthings-download-manifest.v1';
export const DOWNLOAD_MANIFEST: 'sensorthings-download.json';
export const DOWNLOAD_LIMITS: Readonly<{
  files: 25000;
  fileBytes: 8589934592;
  totalBytes: 8589934592;
  manifestBytes: 16777216;
  checkpointBytes: 33554432;
}>;

export interface SensorThingsDownloadFile {
  /** Flat numbered destination name; original name and selector are retained below. */
  name: string;
  originalName: string;
  type: string;
  bytes: number;
  sha256: Sha256;
  selection: ConcreteFileSelection;
}
export interface SensorThingsDownloadManifest {
  schema: typeof DOWNLOAD_SCHEMA;
  id: Sha256;
  kind: 'CLIENT_BOUND_NATIVE_FILE_SET';
  workspace: WorkspaceAlias;
  workspaceId: WorkspaceId;
  selection: FileSelection;
  nativeFilesManifestSha256: Sha256;
  files: SensorThingsDownloadFile[];
  meaning: string;
}
export interface SensorThingsFileInspection {
  manifest: SensorThingsDownloadManifest;
  manifestSha256: Sha256;
}
export type SensorThingsFileToolName = 'merchant_sensorthings_schema' |
  'merchant_sensorthings_files' | 'merchant_sensorthings_file_read' |
  'merchant_sensorthings_file_release';
export type SensorThingsFileToolArguments = WorkspaceScope | FileListArguments |
  FileReadArguments | FileReleaseArguments;
/** Compatible with the configured MerchantSensorThingsWorkspaces instance and
 * the existing openMerchantFileClient's structured tool-return contract. */
export interface SensorThingsFileClient {
  endpoint?: string;
  call(name: 'merchant_sensorthings_schema', args: WorkspaceScope): Promise<unknown>;
  call(name: 'merchant_sensorthings_files', args: FileListArguments): Promise<unknown>;
  call(name: 'merchant_sensorthings_file_read', args: FileReadArguments): Promise<unknown>;
  call(name: 'merchant_sensorthings_file_release', args: FileReleaseArguments): Promise<unknown>;
}
export interface SensorThingsReceivingSelection {
  workspace: WorkspaceAlias;
  workspaceId: WorkspaceId;
  selection: FileSelection;
  /** Bind a previously inspected exact selection; mismatch never creates another export. */
  exportId?: Sha256;
  signal?: AbortSignal;
}
export type SensorThingsReceivingConnection =
  | { client: SensorThingsFileClient; url?: never; tokenEnv?: never;
      environment?: never; maximumResponseBytes?: never }
  | { client?: never; url: string; tokenEnv?: string;
      environment?: Record<string, string | undefined>;
      /** Existing MCP response limit, 1024..134217728 bytes; default 2097152. */
      maximumResponseBytes?: number };
export type SensorThingsInspectionOptions =
  SensorThingsReceivingSelection & SensorThingsReceivingConnection;
export interface SensorThingsDownloadProgress {
  exportId: Sha256;
  file: string;
  bytes: number;
  total: number;
  state: 'DOWNLOADING';
}
export type SensorThingsDownloadOptions = SensorThingsInspectionOptions & {
  /** Reopen this same private absolute directory after a partial transfer. */
  directory: string;
  expectedManifestSha256?: Sha256;
  /** One to 196608 bytes; this adapter defaults to 65536. */
  chunkSize?: number;
  onProgress?: (progress: SensorThingsDownloadProgress) => void | Promise<void>;
};
export interface SensorThingsDownloadResult {
  schema: 'stellar-forge.sensorthings-download-result.v1';
  state: 'COMPLETE';
  directory: string;
  exportId: Sha256;
  workspace: WorkspaceAlias;
  workspaceId: WorkspaceId;
  selection: FileSelection;
  originalFilesManifestSha256: Sha256;
  manifestKind: 'CLIENT_BOUND_NATIVE_FILE_SET';
  manifestSha256: Sha256;
  resumed: boolean;
  resumedBytes: number;
  /** Native selected files; the client-bound manifest is additional. */
  files: number;
  bytes: number;
}
/** Validates complete original UTF-8 manifest bytes and its content-bound ID. */
export function parseSensorThingsDownloadManifest(
  bytes: Uint8Array, id: Sha256
): SensorThingsDownloadManifest;
/** Reads complete native metadata pages; no new native export is created. */
export function inspectSensorThingsFiles(
  options: SensorThingsInspectionOptions
): Promise<SensorThingsFileInspection>;
/** Downloads every selected immutable file, verifies full SHA256 and resumes
 * the existing checkpoint/held reads. Generated draft-review selections reject. */
export function downloadSensorThingsFiles(
  options: SensorThingsDownloadOptions
): Promise<SensorThingsDownloadResult>;

export type {
  ConcreteFileSelection, FileSelection, Sha256, WorkspaceAlias, WorkspaceId
} from './mcp.mjs';
