// MIT. Complete original live-page collection and Analysis receiving.
import type { PreparedODataProduct, ODataLiveQuery, ODataLivePage } from '../live-sdk.mjs';

export declare const COLLECTION_SCHEMA: 'stellar-forge.odata-live-collection.v1';
export declare const COLLECTION_INPUT_SCHEMA: 'stellar-forge.odata-live-collection-input.v1';
export declare const ANALYSIS_DOCUMENT_SCHEMA: 'stellar-forge.analysis-source-document.v1';
export interface ODataCollectionFile { bytes: number; sha256: string }
export interface ODataCollectionNamedFile extends ODataCollectionFile { path: string }
export type ODataCollectionExchange = { requestPath: string; responsePath: string } & (
  { buyerConfigPath: string; buyerResultPath: string } |
  { buyerConfigPath?: never; buyerResultPath?: never }
);
export interface ODataCollectionLimits {
  /** At most 10,000 original exchanges. */ maxPages: number;
  /** At most 1,000,000 declared-key rows. */ maxRows: number;
  /** At most 128 MiB of selected original input. */ maxSourceBytes: number;
  /** At most 128 MiB per retained collection output. */ maxOutputBytes: number;
}
export interface ODataCollectionColumn {
  path: string; name: string; odataType: string; underlyingType: string;
  type: 'integer' | 'number' | 'boolean' | 'string'; nullable: boolean; key: boolean;
  precision: number | string | null; scale: number | string | null;
  /** Complete original parsed CSDL property and facets. */ sourceDefinition: Record<string, unknown>;
}
export interface ODataCollectionPage {
  page: number; rowOffset: number; rows: number; seenRows: number; count: string | null;
  completion: ODataLivePage['completion']; supplierResponseSha256: string; receivedAt: string; etag: string | null;
  files: { request: ODataCollectionNamedFile; response: ODataCollectionNamedFile;
    buyer?: ODataCollectionNamedFile; result?: ODataCollectionNamedFile };
  native: null | { kind: 'SF88_BUYER_RESPONSE'; intentId: string; configurationSha256: string;
    resultSha256: string; nativeStatus: unknown; paymentStatus: unknown; httpStatus: 200; responseFileStatus: 'SAVED' };
}
export interface ODataCollectionManifest {
  schema: typeof COLLECTION_SCHEMA; selectionSha256: string; title: string; sourceBinding: string;
  metadataSha256: string; serviceRoot: string; merchantOrigin: string; operation: string; entitySet: string;
  query: ODataLiveQuery; queryFingerprint: string; keyFields: string[]; rows: number; pageCount: number;
  completion: 'provider' | 'limit'; reportedCounts: string[]; countConsistent: boolean;
  acquisition: { kind: 'live-continuation'; firstReceivedAt: string; lastReceivedAt: string };
  mapping: ODataCollectionColumn[]; limits: ODataCollectionLimits; sourceBytes: number;
  pages: ODataCollectionPage[]; originalFiles: string[]; analysisFormat: 'json' | 'csv';
  analysisProjection: {format: 'json' | 'csv'; columns: number; bytesUpperBound: number; maxRowBytesUpperBound: number;
    exactBytes: boolean; maxBytes: 134217728; maxRowBytes: 2097152};
  files: Record<string, ODataCollectionFile>;
}
export interface ODataCollection extends ODataCollectionManifest {
  directory: string; manifestSha256: string;
  analysis: ODataCollectionNamedFile & { path: 'analysis/source.json'; format: 'json' | 'csv' };
}
export interface ODataCollectionInput {
  operation?: string; title?: string; fields?: string[]; limits?: Partial<ODataCollectionLimits>;
  exchanges: ODataCollectionExchange[]; directory: string; allowLoopback?: boolean;
}
export interface ODataCollectionInputFile extends Omit<ODataCollectionInput, 'directory' | 'allowLoopback'> {
  schema: typeof COLLECTION_INPUT_SCHEMA;
}
export interface ODataCollectionAnalysisMapping {
  source: string; source_revision: number;
  mapping: { collection: ''; sse_data: 'text';
    columns: Array<{ name: string; pointer: string; type: 'native' | 'text' | 'number'; missing: 'error' }> };
}
export declare function receiveCollection(prepared: PreparedODataProduct, input: ODataCollectionInput): Promise<ODataCollection>;
export declare function openCollection(directory: string): Promise<ODataCollection>;
export declare function restoreCollection(input: {
  sourceManifest: string; directory: string; expectedSha256?: string;
}): Promise<ODataCollection & { restoredFrom: { bytes: number; sha256: string } }>;
export declare function readCollectionRows(directory: string, options?: {offset?: number; limit?: number}): Promise<{
  collectionSha256: string; sourceBinding: string; operation: string; metadataSha256: string; serviceRoot: string; merchantOrigin: string;
  offset: number; total: number; rows: ODataLivePage['items']; nextOffset: number | null;
}>;
export declare function collectionAnalysisMapping(collection: ODataCollectionManifest, input: {
  source: string; sourceRevision: number;
}): ODataCollectionAnalysisMapping;
