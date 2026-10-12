// SPDX-License-Identifier: MIT
export type LineageFileName = 'events.json' | 'plan.json' | 'native-bindings.json' | 'receipts.json'
  | 'report.html' | 'manifest.json' | 'handover.zip';
export interface LineageFile {
  name: LineageFileName; bytes: number; sha256: string;
  mime: 'application/json' | 'text/html;charset=utf-8' | 'application/zip';
}
export interface NativeLineageIndex {
  schema: 'stellar-forge.analysis-lineage-downloads.v1';
  workspace_id: string; plan_id: string; plan_sha256: string; events_sha256: string;
  manifest_sha256: string; files: LineageFile[]; index_sha256: string;
}
export interface NativeCallOptions { requestSignal?: AbortSignal | null; timeoutMs?: number }
export interface NativeAnalysisLineageClient {
  endpoint: string; analysisWorkspace: string;
  call<T = unknown>(operation: string, body: Record<string, unknown>, options?: NativeCallOptions): Promise<T>;
}
export interface LineageConnectionOptions {
  url?: string; analysisWorkspace: string; tokenEnv?: string;
  environment?: Record<string, string | undefined>; signal?: AbortSignal;
}
export interface LineageInspectOptions extends LineageConnectionOptions {
  planId: string; client?: NativeAnalysisLineageClient;
}
export interface LineageDescription {
  planId: string; workspaceId: string; planSha256: string; indexSha256: string;
  nativeManifestSha256: string; handoverSha256: string;
}
export interface LineageReview extends LineageDescription {
  schema: 'stellar-forge.analysis-lineage-download.v1'; state: 'REVIEW';
  analysisWorkspace: string; index: NativeLineageIndex;
  indexFile: {name: 'lineage-download-index.json'; bytes: number; sha256: string};
}
export interface LineageDownloadOptions extends LineageInspectOptions {
  directory: string; expectedPlanSha256: string; expectedIndexSha256: string;
  chunkSize?: number;
  onProgress?: (progress: {exportId: string; file: LineageFileName; bytes: number;
    total: number; state: 'DOWNLOADING'}) => void | Promise<void>;
}
export interface LineageReopenOptions {
  directory: string; planId: string; expectedPlanSha256: string; expectedIndexSha256: string;
  signal?: AbortSignal;
}
export interface LineageDownloadResult extends LineageDescription {
  schema: 'stellar-forge.analysis-lineage-download.v1'; state: 'COMPLETE';
  directory: string; exportId: string; manifestSha256: string; resumed: boolean;
  resumedBytes: number; files: number; bytes: number; indexFile: string;
  analysisWorkspace?: string; offline?: boolean;
}
/** The maintained authenticated native MCP client; no analytical process or job is started. */
export function openNativeAnalysisLineageClient(options: LineageConnectionOptions): Promise<NativeAnalysisLineageClient>;
/** Read the current original download index and review its two native digests. */
export function inspectNativeAnalysisLineage(options: LineageInspectOptions): Promise<LineageReview>;
/** Receive all seven original files, retaining the same directory and verified byte prefixes. */
export function downloadNativeAnalysisLineage(options: LineageDownloadOptions): Promise<LineageDownloadResult>;
/** Verify the original complete local handover without any network request. */
export function reopenNativeAnalysisLineage(options: LineageReopenOptions): Promise<LineageDownloadResult>;
export function main(argv?: string[]): Promise<number>;
