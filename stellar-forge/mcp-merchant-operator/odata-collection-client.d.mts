// MIT. Original customer download and receiving API.
import type { ODataCollection, ODataCollectionAnalysisMapping, readCollectionRows } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live/collection.mjs';
export const ODATA_COLLECTION_DOWNLOAD_SCHEMA: 'stellar-forge.odata-collection-download.v1';
export const ODATA_COLLECTION_RECEIVING_SCHEMA: 'stellar-forge.odata-collection-receiving.v1';
export interface OriginalMerchantClient {
  endpoint: string;
  call(name: string, args: Record<string, unknown>, options?: {
    requestSignal?: AbortSignal | null; timeoutMs?: number;
  }): Promise<Record<string, unknown>>;
}
export interface MerchantConnection {
  url?: string;
  client?: OriginalMerchantClient;
  tokenEnv?: string;
  environment?: Record<string, string | undefined>;
  signal?: AbortSignal;
}
export interface CollectionSelection {
  workspace: string;
  liveServiceId: string;
  collectionId: string;
}
export interface CollectionIdentity {
  collectionSha256: string;
  sourceBinding: string;
  queryFingerprint: string;
  rows: number;
  pages: number;
}
export interface OriginalSourceFile {
  path: string;
  bytes: number;
  sha256: string;
  contentType: string;
  role?: string;
}
export interface OriginalSourceDocument {
  schema: 'stellar-forge.analysis-source-document.v1';
  title: string;
  format: 'csv' | 'json';
  document: OriginalSourceFile;
  originals: OriginalSourceFile[];
  provenance: Record<string, unknown>;
  complete: true;
}
export interface SourceSummary {
  schema: 'stellar-forge.analysis-source-document.v1';
  title: string;
  format: 'csv' | 'json';
  sourceSha256: string;
  collectionSha256: string;
  files: number;
  bytes: number;
  originalPackets: number;
}
export interface DownloadProgress {
  exportId: string;
  file: string;
  bytes: number;
  total: number;
  state: 'DOWNLOADING';
}
export interface DownloadOptions extends MerchantConnection, CollectionSelection {
  expectedSha256: string;
  directory: string;
  chunkSize?: number;
  onProgress?: (event: DownloadProgress) => void | Promise<void>;
}
export interface DownloadResult extends CollectionSelection, CollectionIdentity {
  schema: typeof ODATA_COLLECTION_DOWNLOAD_SCHEMA;
  state: 'COMPLETE';
  directory: string;
  endpoint: string;
  sourceSha256: string;
  sourceManifest: string;
  exportId: string;
  manifestSha256: string;
  title: string;
  format: 'csv' | 'json';
  resumed: boolean;
  resumedBytes: number;
  files: number;
  bytes: number;
}
export type CollectionSummary = Pick<ODataCollection,
  'schema' | 'directory' | 'title' | 'operation' | 'entitySet' | 'metadataSha256' | 'sourceBinding' |
  'query' | 'queryFingerprint' | 'keyFields' | 'rows' | 'completion' | 'reportedCounts' |
  'countConsistent' | 'acquisition' | 'mapping' | 'manifestSha256' | 'analysis' | 'analysisProjection'> & {
    pages: number; restoredFrom?: { sha256: string; bytes: number };
  };
export interface ReceivingResult extends CollectionSelection {
  schema: typeof ODATA_COLLECTION_RECEIVING_SCHEMA;
  state: 'COMPLETE';
  endpoint: string;
  downloadDirectory: string;
  sourceSha256: string;
  collection: CollectionSummary;
}
export function listMerchantODataCollections(options: MerchantConnection & {
  workspace: string; liveServiceId: string; offset?: number; limit?: number;
}): Promise<{
  workspace: string; liveServiceId: string; collections: Array<Record<string, unknown>>;
  page: { offset: number; limit: number; total: number; nextOffset: number | null };
}>;
export function inspectMerchantODataCollection(options: MerchantConnection & CollectionSelection & {
  expectedSha256?: string;
}): Promise<CollectionSelection & CollectionIdentity & {
  schema: typeof ODATA_COLLECTION_DOWNLOAD_SCHEMA; state: 'INSPECTED'; endpoint: string;
  source: SourceSummary; document: OriginalSourceDocument;
}>;
export function downloadMerchantODataCollection(options: DownloadOptions): Promise<DownloadResult>;
export function inspectODataCollectionDownload(options: {
  directory: string; expectedSha256?: string; signal?: AbortSignal;
}): Promise<CollectionSelection & {
  schema: typeof ODATA_COLLECTION_DOWNLOAD_SCHEMA; state: 'COMPLETE'; directory: string;
  endpoint: string; sourceManifest: string; source: SourceSummary;
}>;
export function receiveODataCollectionDownload(options: {
  directory: string; collectionDirectory: string; expectedSha256: string; signal?: AbortSignal;
}): Promise<ReceivingResult>;
export function fetchODataCollection(options: DownloadOptions & {
  collectionDirectory: string;
}): Promise<{
  schema: typeof ODATA_COLLECTION_RECEIVING_SCHEMA; state: 'COMPLETE';
  download: DownloadResult; receiving: ReceivingResult;
}>;
export function inspectReceivedODataCollection(options: { directory: string }): Promise<CollectionSummary>;
export function readReceivedODataCollectionRows(options: {
  directory: string; offset?: number; limit?: number;
}): ReturnType<typeof readCollectionRows>;
export function receivedODataCollectionAnalysisMapping(options: {
  directory: string; source: string; sourceRevision: number;
}): Promise<ODataCollectionAnalysisMapping>;
