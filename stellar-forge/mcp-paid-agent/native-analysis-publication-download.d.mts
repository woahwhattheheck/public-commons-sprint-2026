// SPDX-License-Identifier: MIT
export type DatasetPackageFileName = 'datapackage.json' | 'data.json' | 'publication.zip'
  | 'recipe.json' | 'manifest.json' | 'report.html';
export interface DatasetFile {
  name: string; relative: string; bytes: number; sha256: string; mime: string;
  visibility?: 'public' | 'private';
}
export interface DatasetPackageIndex {
  schema: 'stellar-forge.analysis-dataset-publication-downloads.v1';
  workspace_id: string; job_id: string; recipe_id: string; recipe_sha256: string;
  source: {workspace_id: string; query_export_id: string; manifest_sha256: string;
    binding_sha256: string; row_count: number; columns: string[]};
  files: DatasetFile[];
  /** Digest of the exact native downloads.json; this convenience field is outside that file. */
  index_sha256: string;
}
export interface DatasetSourceIndex {
  schema: 'stellar-forge.analysis-publication-source-files.v1';
  workspace_id: string; job_id: string; package_id: string; package_index_sha256: string;
  native_workspace_id: string; export_id: string; source_hash: string;
  manifest_sha256: string; native_manifest_sha256: string; files: DatasetFile[];
  /** Digest of the exact native files-index.json; this convenience field is outside that file. */
  index_sha256: string;
}
export type NativeDatasetIndex = DatasetPackageIndex | DatasetSourceIndex;
export interface NativeCallOptions {requestSignal?: AbortSignal | null; timeoutMs?: number}
export interface NativeAnalysisDatasetClient {
  endpoint: string; analysisWorkspace: string;
  call<T = unknown>(operation: string, body: Record<string, unknown>, options?: NativeCallOptions): Promise<T>;
}
export interface DatasetConnectionOptions {
  url?: string; analysisWorkspace: string; tokenEnv?: string;
  environment?: Record<string, string | undefined>; signal?: AbortSignal;
}
export interface DatasetInspectOptions extends DatasetConnectionOptions {
  jobId: string; source?: boolean; expectedWorkspaceId?: string; client?: NativeAnalysisDatasetClient;
}
export interface DatasetDescription {
  jobId: string; workspaceId: string; source: boolean; indexSha256: string;
  recipeId?: string; recipeSha256?: string; queryExportId?: string; queryManifestSha256?: string; rowCount?: number;
  packageId?: string; packageIndexSha256?: string; nativeWorkspaceId?: string;
  nativeExportId?: string; sourceHash?: string; nativeManifestSha256?: string;
}
export interface DatasetReview extends DatasetDescription {
  schema: 'stellar-forge.analysis-dataset-download.v1'; state: 'REVIEW'; analysisWorkspace: string;
  index: NativeDatasetIndex;
  indexFile: {name: 'downloads.json' | 'files-index.json'; bytes: number; sha256: string};
}
export interface DatasetDownloadOptions extends DatasetInspectOptions {
  directory: string; expectedIndexSha256: string; chunkSize?: number;
  onProgress?: (progress: {exportId: string; file: string; bytes: number;
    total: number; state: 'DOWNLOADING'}) => void | Promise<void>;
}
export interface DatasetReopenOptions {
  directory: string; jobId: string; source?: boolean; expectedIndexSha256: string;
  expectedWorkspaceId?: string; signal?: AbortSignal;
}
export interface DatasetDownloadResult extends DatasetDescription {
  schema: 'stellar-forge.analysis-dataset-download.v1'; state: 'COMPLETE'; directory: string;
  /** The original Analysis hex32 job ID. nativeExportId is the separate workbench UUID. */
  exportId: string;
  manifestSha256: string; resumed: boolean; resumedBytes: number; files: number; bytes: number;
  indexFile: string; analysisWorkspace?: string; offline?: boolean;
}
/** The existing authenticated native MCP transport; this owns no host or analytical job. */
export function openNativeAnalysisDatasetClient(options: DatasetConnectionOptions): Promise<NativeAnalysisDatasetClient>;
/** Read the complete original raw index through native bounded file ranges. */
export function inspectNativeAnalysisDataset(options: DatasetInspectOptions): Promise<DatasetReview>;
/** Download all exact original members under the maintained flock and same prefix checkpoint. */
export function downloadNativeAnalysisDataset(options: DatasetDownloadOptions): Promise<DatasetDownloadResult>;
/** Verify a completed local handover without a native server or network request. */
export function reopenNativeAnalysisDataset(options: DatasetReopenOptions): Promise<DatasetDownloadResult>;
export function main(argv?: string[]): Promise<number>;
