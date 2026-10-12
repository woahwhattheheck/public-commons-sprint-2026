/** Complete original Census edition receiving through the maintained merchant-file engine. */
export const CENSUS_GEOCODER_DOWNLOAD_STATE: 'stellar-forge.census-geocoder-mcp-download-state.v1';
export const CENSUS_GEOCODER_DOWNLOAD_RESULT: 'stellar-forge.census-geocoder-mcp-download-result.v1';
export const CENSUS_GEOCODER_MAX_FILE_BYTES: number;
export const CENSUS_GEOCODER_MAX_MANIFEST_BYTES: number;

export interface CensusNativeFileClient {
  /** Actual HTTP endpoint or the original embedded client's identity. */
  endpoint: string;
  call(name: string, args: Record<string, unknown>,
    options?: { requestSignal?: AbortSignal | null; timeoutMs?: number }): Promise<Record<string, unknown>>;
}
export interface CensusDatasetColumn {
  name: string;
  type: 'string' | 'integer' | 'number' | 'boolean';
  nullable?: boolean;
  filterable: boolean;
  rangeFilterable?: boolean;
  sortable?: boolean;
}
export interface CensusDatasetDescription {
  name: string;
  snapshot: string;
  rowCount: number;
  columns: CensusDatasetColumn[];
  defaultLimit: number;
  maxLimit: number;
  order: string;
  [key: string]: unknown;
}
export interface CensusEditionFile {
  path: string;
  bytes: number;
  sha256: string;
}
export interface CensusEditionManifest {
  schema: 'stellar-forge.census-geocoder-edition.v1';
  operationId: string;
  createdAt: string;
  batchId: string;
  attemptId: string;
  reviewId: string;
  dataset: CensusDatasetDescription;
  source: Record<string, unknown>;
  files: CensusEditionFile[];
}
export interface CensusNativeEdition extends CensusEditionManifest {
  directory: string;
  datasetPath: string;
  sellerPath: string | null;
}
export interface CensusDownloadBinding {
  workspace: string;
  workspaceId: string;
  editionId: string;
  reviewId: string;
  operationId: string;
  datasetSnapshot: string;
  hasSeller: boolean;
}
export type CensusRemoteTransport =
  | { url: string; client?: never; tokenEnv?: string; environment?: Record<string, string | undefined> }
  | { client: CensusNativeFileClient; url?: never; tokenEnv?: never; environment?: never };
export type CensusRemoteEditionOptions = CensusRemoteTransport & {
  workspace: string;
  editionId: string;
  expectedWorkspaceId?: string;
  expectedManifestSha256?: string;
  signal?: AbortSignal;
};
export interface CensusLocalEditionOptions {
  directory: string;
  expectedWorkspaceId?: string;
  expectedEditionId?: string;
  expectedManifestSha256?: string;
  signal?: AbortSignal;
}
export interface CensusDownloadProgress {
  exportId: string;
  file: string;
  bytes: number;
  total: number;
  state: 'DOWNLOADING';
}
export type CensusDownloadOptions = CensusRemoteEditionOptions & {
  directory: string;
  chunkSize?: number;
  onProgress?: (progress: CensusDownloadProgress) => void | Promise<void>;
};
export interface CensusEditionInspection extends CensusDownloadBinding {
  schema: 'stellar-forge.census-geocoder-mcp-download-inspection.v1';
  /** Current process owner; excluded from the durable port-independent binding. */
  instanceId: string;
  manifestSha256: string;
  manifest: Omit<CensusEditionManifest, 'files'> & {
    files: Array<CensusEditionFile & { name: string }>;
  };
  files: number;
  /** Sum of native member bytes; edition.json itself is separate. */
  bytes: number;
}
export interface CensusCompletedDownload extends CensusDownloadBinding {
  schema: 'stellar-forge.census-geocoder-mcp-download-result.v1';
  state: 'COMPLETE';
  directory: string;
  exportId: string;
  manifestSha256: string;
  files: number;
  /** Sum of native member bytes; edition.json itself is separate. */
  bytes: number;
  edition: CensusNativeEdition;
}
export interface CensusDownloadedEdition extends CensusCompletedDownload {
  resumed: boolean;
  resumedBytes: number;
  batchId: string;
  attemptId: string;
  dataset: CensusDatasetDescription;
  source: Record<string, unknown>;
}
export interface CensusDatasetPage {
  schema: 'stellar-forge.dataset-page.v1';
  dataset: CensusDatasetDescription;
  fields: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  filters: Record<string, string>;
  page: { limit: number; total: number; returned: number; nextCursor: string | null };
  [key: string]: unknown;
}
export type CensusDatasetResponse =
  | { status: 200; headers: Record<string, string>; body: CensusDatasetPage }
  | { status: 400 | 409 | 413; body: { error: string; message: string }; headers?: Record<string, string> };
export interface CensusLocalQuery extends Omit<CensusCompletedDownload, 'schema'> {
  schema: 'stellar-forge.census-geocoder-mcp-download-query.v1';
  response: CensusDatasetResponse;
}
export function inspectCensusGeocoderEdition(options: CensusRemoteEditionOptions): Promise<CensusEditionInspection>;
export function downloadCensusGeocoderEdition(options: CensusDownloadOptions): Promise<CensusDownloadedEdition>;
export function reopenCensusGeocoderDownload(options: CensusLocalEditionOptions): Promise<CensusCompletedDownload>;
export function queryCensusGeocoderDownload(options: CensusLocalEditionOptions & { query?: string }): Promise<CensusLocalQuery>;
