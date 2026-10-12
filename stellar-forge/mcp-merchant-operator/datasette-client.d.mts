/** MIT. Typed operations and complete receiving through the original Datasette workspace. */
import type {DatasetteOperation, DatasetteOperationInputs, DatasetteUploadDeclaration, DatasetteUploadRange, DatasetteUploadStatus, JsonValue} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/client.mjs';
export type {DatasetteOperation, DatasetteOperationInputs, DatasetteSelection, DatasetteCapturedPage, DatasetteUploadDeclaration, DatasetteUploadRange, DatasetteUploadStatus} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/client.mjs';

export interface MerchantRequestOptions {requestSignal?: AbortSignal | null; timeoutMs?: number;}
export interface DatasetteMerchantConnection {
  url: string;
  workspace?: string;
  tokenEnv?: string;
  environment?: Record<string, string | undefined>;
  signal?: AbortSignal;
}
export interface NativeReply<T = JsonValue> {workspace: string; operation?: DatasetteOperation; native: T;}
export interface NativeFile {
  schema: 'stellar-forge.datasette-retained-file.v1';
  workspaceId: string;
  path: string;
  name: string;
  /** Exact native decimal integer text; the original retained-file ceiling is 2 GiB. */
  bytes: string;
  sha256: string;
  kind: string;
  modifiedAt: string;
}
export interface Page {offset: number; limit: number; total: number; next: number | null; previous?: number | null;}
export interface NativeFilePage {workspaceId: string; files: NativeFile[]; page: Page;}
export interface ManifestFile {name: string; bytes: number; sha256: string;}
export interface DownloadManifest {
  schema: 'stellar-forge.datasette-download-manifest.v1';
  exportId: string;
  workspaceId: string;
  native: {operation: 'files.list'; prefix: string; files: number; manifestSha256: string};
  files: ManifestFile[];
  totalBytes: number;
}
export interface RetainedChunk {
  readId: string;
  file: {name: string; contentType: string; bytes: number; sha256: string};
  offset: number;
  bytesRead: number;
  nextOffset: number | null;
  encoding: 'base64';
  data: string;
}
export interface Selected {workspace?: string;}
export interface Range {offset?: number; limit?: number; readId?: string;}
export interface DatasetteMerchantInputs {
  workspaces: Record<string, never>;
  health: Selected;
  status: Selected;
  operations: Selected;
  operation: Selected & {operation: DatasetteOperation; input: DatasetteOperationInputs[DatasetteOperation]};
  reconnect: Selected & {workspaceId: string};
  upload_status: Selected & {uploadId: string};
  upload_chunk: Selected & DatasetteUploadRange & {data: string};
  files: Selected & {prefix?: string; offset?: number; limit?: number};
  file: Selected & {path: string; sha256?: string};
  file_read: Selected & Range & {path: string; expectedSha256: string};
  file_release: Selected & {readId: string};
  export_prepare: Selected & {workspaceId: string; prefix?: string};
  export_inventory: Selected & {exportId: string; offset?: number; limit?: number};
  export_manifest: Selected & {exportId: string};
  export_file: Selected & Range & {exportId: string; file: string; expectedManifestSha256: string; expectedSha256: string};
  export_file_release: Selected & {exportId: string; readId: string};
}
export interface ManifestRetained {
  state: 'MANIFEST_RETAINED';
  workspace: string;
  workspaceId: string;
  exportId: string;
  manifestFile: ManifestFile;
  originalFiles?: number;
  totalBytes?: number;
}
export interface DatasetteMerchantResults {
  workspaces: {configured: boolean; workspaces: Array<{workspace: string; label: string; connection: string; expectedWorkspaceId: string | null}>};
  health: NativeReply;
  status: NativeReply;
  operations: NativeReply;
  operation: NativeReply;
  reconnect: {state: 'CONNECTED'; workspace: string; workspaceId: string; native: JsonValue; status: JsonValue; operations: JsonValue};
  upload_status: NativeReply<DatasetteUploadStatus>;
  upload_chunk: NativeReply<DatasetteUploadStatus>;
  files: NativeReply<NativeFilePage>;
  file: NativeReply<NativeFile>;
  file_read: RetainedChunk;
  file_release: {state: 'RELEASED'; workspace: string; readId: string};
  export_prepare: ManifestRetained;
  export_inventory: {workspace: string; workspaceId: string; exportId: string; manifestSha256: string; native: DownloadManifest['native']; files: ManifestFile[]; page: Page};
  export_manifest: ManifestRetained;
  export_file: RetainedChunk & {exportId: string; manifestSha256: string};
  export_file_release: {state: 'RELEASED'; workspace: string; exportId: string; readId: string};
}
export interface ToolDefinition {name: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown>;}
export declare const datasetteActions: Readonly<Record<keyof DatasetteMerchantInputs, ToolDefinition>>;
type CamelOperation<S extends string> =
  S extends `${infer A}.${infer B}` ? `${A}${Capitalize<CamelOperation<B>>}` :
  S extends `${infer A}-${infer B}` ? `${A}${Capitalize<CamelOperation<B>>}` : S;
type CamelTool<S extends string> = S extends `${infer A}_${infer B}` ? `${A}${Capitalize<CamelTool<B>>}` : S;
type ToolMethods = {[K in keyof DatasetteMerchantInputs as CamelTool<K>]:
  (args: DatasetteMerchantInputs[K], requestOptions?: MerchantRequestOptions) => Promise<DatasetteMerchantResults[K]>};
type NativeMethods = {[K in DatasetteOperation as CamelOperation<K>]:
  (args: Selected & {input: DatasetteOperationInputs[K]}, requestOptions?: MerchantRequestOptions) => Promise<NativeReply>};
export type DatasetteMerchantClient = Readonly<ToolMethods & NativeMethods & {
  endpoint: string;
  call<K extends keyof DatasetteMerchantInputs>(action: K | `merchant_datasette_${K}`,
    args: DatasetteMerchantInputs[K], requestOptions?: MerchantRequestOptions): Promise<DatasetteMerchantResults[K]>;
  /** This method requires a workspace alias selected when opening the client. */
  nativeOperation<K extends DatasetteOperation>(operation: K, input: DatasetteOperationInputs[K], requestOptions?: MerchantRequestOptions): Promise<NativeReply>;
  uploadFile(options: Selected & DatasetteLocalUploadOptions): Promise<DatasetteUploadResult>;
  downloadExport(options: Selected & LocalDownloadOptions): Promise<DatasetteDownloadResult>;
  inspectExport(options: Selected & {exportId: string; signal?: AbortSignal}): Promise<{manifest: DownloadManifest; manifestSha256: string}>;
}>;
export declare function openDatasetteClient(options: DatasetteMerchantConnection): Promise<DatasetteMerchantClient>;
export interface OriginalMerchantTransport {
  endpoint: string;
  call(name: string, args: Record<string, unknown>, options?: MerchantRequestOptions): Promise<unknown>;
}
export interface LocalDownloadOptions {
  exportId: string;
  directory: string;
  expectedManifestSha256?: string;
  chunkSize?: number;
  signal?: AbortSignal;
  onProgress?: (value: Record<string, unknown>) => void | Promise<void>;
}
export interface DatasetteDownloadOptions extends LocalDownloadOptions {
  workspace: string;
  client?: OriginalMerchantTransport;
  url?: string;
  tokenEnv?: string;
  environment?: Record<string, string | undefined>;
}
export interface DatasetteDownloadResult {
  schema: 'stellar-forge.datasette-download-result.v1';
  state: 'COMPLETE' | 'REOPENED';
  directory: string;
  exportId: string;
  workspaceId: string;
  native: DownloadManifest['native'];
  manifestSha256: string;
  files: number;
  bytes: number;
  resumed?: boolean;
  resumedBytes?: number;
  verifiedFiles?: ManifestFile[];
}
export declare function downloadDatasetteExport(options: DatasetteDownloadOptions): Promise<DatasetteDownloadResult>;
export declare function inspectDatasetteExport(options: Omit<DatasetteDownloadOptions, keyof LocalDownloadOptions> & {exportId: string}): Promise<{manifest: DownloadManifest; manifestSha256: string}>;
/** Reads only the complete local download under the original download lease. */
export declare function reopenDatasetteExport(options: {directory: string; exportId: string; expectedManifestSha256?: string}): Promise<DatasetteDownloadResult>;

export interface DatasetteLocalUploadOptions extends DatasetteUploadDeclaration {
  /** Complete reviewed private local file. It is never sent as a remote filesystem path. */
  path: string;
  /** 64 KiB–8 MiB; default 1 MiB. Byte declarations and offsets remain exact decimal text. */
  chunkSize?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (value: {workspace: string; uploadId: string; state: DatasetteUploadStatus['state'];
    receivedBytes: string; bytes: string; sha256: string}) => void | Promise<void>;
}
export interface DatasetteFileUploadOptions extends DatasetteLocalUploadOptions {
  workspace: string;
  client?: OriginalMerchantTransport;
  url?: string;
  tokenEnv?: string;
  environment?: Record<string, string | undefined>;
}
export interface DatasetteUploadResult extends NativeReply<DatasetteUploadStatus> {
  state: DatasetteUploadStatus['state'];
  source: {path: string; bytes: string; sha256: string};
  resumedBytes: string;
}
/** One explicit continuation. A failed mutating response is never retried automatically. */
export declare function uploadDatasetteFile(options: DatasetteFileUploadOptions): Promise<DatasetteUploadResult>;
