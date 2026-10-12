// MIT. Complete original job export receiving, with typed native identities.
import type { N8nJobExport, N8nExportedJob, Sha256, Environment } from
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/n8n/index.d.ts';
export type { N8nJobExport, N8nExportedJob };
export const N8N_DOWNLOAD_SCHEMA: 'stellar-forge.n8n-job-download.v1';
export interface MerchantFileClient {
  readonly endpoint: string;
  call(name: string, arguments_: Record<string, unknown>,
    options?: { requestSignal?: AbortSignal | null; timeoutMs?: number }): Promise<Record<string, unknown>>;
}
export type N8nDownloadConnection = {
  workspace: string;
  exportId: Sha256;
  tokenEnv?: string;
  environment?: Environment;
  signal?: AbortSignal;
  expectedManifestSha256?: Sha256;
} & ({ url: string; client?: never } | { client: MerchantFileClient; url?: never });
export interface N8nDownloadProgress {
  exportId: Sha256;
  file: string;
  bytes: number;
  total: number;
  state: 'DOWNLOADING';
}
export interface N8nJobReceiving {
  schema: typeof N8N_DOWNLOAD_SCHEMA;
  state: 'COMPLETE' | 'REOPENED';
  directory: string;
  exportId: Sha256;
  configurationSha256: Sha256;
  job: N8nExportedJob;
  manifestSha256: Sha256;
  files: number;
  bytes: number;
  recordsValidated: true;
  dispatchRevision: number | null;
}
export interface N8nCompletedDownload extends N8nJobReceiving {
  state: 'COMPLETE';
  resumed: boolean;
  resumedBytes: number;
}
/** Reads the immutable manifest; no payload download or workflow execution. */
export function inspectN8nJobDownload(options: N8nDownloadConnection): Promise<{
  manifest: N8nJobExport; manifestSha256: Sha256;
}>;
/** Resumes the same endpoint, workspace, export and private directory, then validates full records. */
export function downloadN8nJobExport(options: N8nDownloadConnection & {
  directory: string;
  chunkSize?: number;
  onProgress?: (progress: N8nDownloadProgress) => void | Promise<void>;
}): Promise<N8nCompletedDownload>;
/** Verifies every saved file and its native job/dispatch identities without a network connection. */
export function reopenN8nJobDownload(options: {
  directory: string;
  expectedManifestSha256?: Sha256;
}): Promise<N8nJobReceiving & { state: 'REOPENED' }>;
