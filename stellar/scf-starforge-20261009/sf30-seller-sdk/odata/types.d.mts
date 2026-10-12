// MIT. Shared source types for the maintained OData provider and operator.
import type { Buffer } from 'node:buffer';

/** Decimal and Int64 values remain their original decimal text, including scale. */
export type ODataValue = string | number | boolean | null | ODataValue[] | ODataRow;
export interface ODataRow { [property: string]: ODataValue }
export type ODataHeaders = Record<string, string>;
export type ODataEnvironment = Record<string, string | undefined>;
export type ODataError = Error & { code: string; status: number; [detail: string]: unknown };
export interface ODataFacets {
  maxLength?: string | number; precision?: string | number; scale?: string | number;
  unicode?: boolean | string; sRID?: string | number; defaultValue?: unknown;
}
export interface ODataProperty extends ODataFacets {
  name: string; type: string; nullable: boolean; collection: boolean;
}
export interface ODataField extends ODataProperty { path: string; key: boolean }
export interface ODataNavigationProperty extends ODataProperty { partner: string | null; containsTarget: boolean }
export interface ODataStructuralType {
  name: string; qualifiedName: string; namespace: string; baseType: string | null;
  abstract: boolean; openType: boolean; hasStream: boolean; declaredKeys: string[];
  keyFields: string[]; properties: ODataProperty[]; navigationProperties: ODataNavigationProperty[];
}
export interface ODataEntitySetMetadata {
  name: string; entityType: string; includeInServiceDocument: boolean;
  container: string; keyFields: string[]; fields: ODataField[];
}
export interface ODataEntitySet extends ODataEntitySetMetadata { title: string; url: string }
export interface ODataSingleton { name: string; entityType: string; container: string; includeInServiceDocument?: boolean }
export interface ODataMetadata {
  version: '4.0' | '4.01'; aliases: Record<string, string>;
  entityTypes: Record<string, ODataStructuralType>; complexTypes: Record<string, ODataStructuralType>;
  enumTypes: Record<string, { qualifiedName: string; underlyingType: string; isFlags: boolean; members: Record<string, string> }>;
  typeDefinitions: Record<string, ODataFacets & { qualifiedName: string; underlyingType: string }>;
  containers: Record<string, { name: string; qualifiedName: string; extends: string | null;
    entitySets: Array<Pick<ODataEntitySetMetadata, 'name' | 'entityType' | 'includeInServiceDocument'>>;
    singletons: Array<{ name: string; entityType: string; includeInServiceDocument?: boolean }> }>;
  references: Array<{ uri: string; includes: Array<{ namespace: string; alias: string | null }> }>;
  entityContainer: string | null; entitySets: ODataEntitySetMetadata[]; singletons: ODataSingleton[];
}
export interface ODataDocumentReceipt {
  requestedUrl: string; url: string; status: number; headers: ODataHeaders;
  sha256: string; receivedAt: string;
  /** Present on discovered/portable catalogs; retained workspaces use raw(sha256). */
  rawBase64?: string; bytes?: number;
}
export interface ODataCatalog extends Omit<ODataMetadata, 'entitySets'> {
  schema: 'stellar-forge.odata-catalog.v1'; entitySets: ODataEntitySet[];
  serviceUrl: string; metadataUrl: string; observedAt: string;
  receipts: { service: ODataDocumentReceipt; metadata: ODataDocumentReceipt };
}
export type ODataFilterOperator = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'contains' | 'startswith' | 'endswith';
export interface ODataFilter { field: string; op: ODataFilterOperator; value: string | number | boolean | null }
export interface ODataOrder { field: string; direction?: 'asc' | 'desc' }
export interface ODataQueryPlan {
  entitySet: string; select?: string[]; filters?: ODataFilter[]; filterMode?: 'and' | 'or';
  orderBy?: ODataOrder[]; top?: number | null; count?: boolean;
  /** Provider preference; only the original nextLink determines continuation. */
  pageSize?: number;
}
export interface ODataNormalizedPlan {
  entitySet: string; select: string[]; filters: ODataFilter[]; filterMode: 'and' | 'or';
  orderBy: Array<Required<ODataOrder>>; top?: number; count: boolean; pageSize: number;
}
export interface ODataCompiledQuery {
  url: string; entitySet: string; entityType: string; fields: ODataField[]; keyFields: string[];
  plan: ODataNormalizedPlan; prefer: string; fingerprint: string;
}
export interface ODataSourceReceipt {
  url: string; requestedUrl?: string; sha256: string; receivedAt: string; etag: string | null;
  context: unknown; originalNextLink: string | null; deltaLink: string | null; bytes?: number;
}
export interface ODataPage {
  rows: ODataRow[]; nextLink: string | null; count: string | null; raw: Buffer;
  status: number; headers: ODataHeaders; source: ODataSourceReceipt;
}
export interface ODataTransportOptions {
  fetchImpl?: typeof globalThis.fetch; signal?: AbortSignal;
  /** Environment variable name containing the complete Authorization header. */
  authEnv?: string | null; maxBytes?: number; timeoutMs?: number;
}
export interface ODataConnection {
  id: string; name: string; url: string; authEnv: string | null; allowLoopback: boolean;
  catalog: ODataCatalog; catalogHash: string; createdAt: string; refreshedAt?: string;
}
export interface ODataSavedPlan {
  id: string; name: string; connectionId: string; catalogHash: string; query: ODataCompiledQuery;
  createdAt: string; reviewedAt: string | null; reviewNote: string | null;
}
export interface ODataReview {
  id: string; editionId: string; decision: 'accept' | 'needs-work'; note: string; createdAt: string; contentHash: string;
}
export interface ODataRetainedPage {
  number: number; source: ODataSourceReceipt & { requestedUrl: string; bytes: number };
  rowsSha256: string; rowCount: number; nextLink: string | null; status: number; headers: ODataHeaders;
}
export interface ODataEdition {
  id: string; label: string; planId: string; connectionId: string; catalogHash: string;
  catalog: ODataCatalog; query: ODataCompiledQuery; reviewNote: string | null;
  status: 'PAUSED' | 'IMPORTING' | 'COMPLETE' | 'FAILED'; pages: ODataRetainedPage[];
  rowCount: number; sourceCount: string | null; nextLink: string | null;
  createdAt: string; updatedAt?: string; completedAt: string | null; contentHash?: string;
  error: { code: string; message: string } | null; decisions: ODataReview[];
}
export interface ODataEditionSummary extends Omit<ODataEdition, 'pages' | 'catalog' | 'query'> {
  pageCount: number; queryUrl: string; entitySet: string; keyFields: string[]; fields: ODataField[];
}
export type ODataFieldValue = { state: 'value'; value: ODataValue } | { state: 'null' | 'missing'; value: null };
export interface ODataComparison {
  schema: 'stellar-forge.odata-comparison.v1'; beforeId: string; afterId: string; createdAt: string;
  sameQuery: boolean; beforeRows: number; afterRows: number;
  added: Array<{ key: string; row: ODataRow }>; removed: Array<{ key: string; row: ODataRow }>;
  changed: Array<{ key: string; fields: Array<{ path: string; before: ODataFieldValue; after: ODataFieldValue }> }>;
  note: string;
}
export interface ODataDatasetField {
  path: string; name: string; odataType: string; type: 'integer' | 'number' | 'boolean' | 'string'; collection: boolean;
}
export interface ODataDatasetDescription {
  name: string; snapshot: string; rowCount: number; defaultLimit: number; maxLimit: number; order: 'csv-record-order';
  columns: Array<{ name: string; type: 'integer' | 'number' | 'boolean' | 'string'; nullable: boolean;
    filterable: boolean; rangeFilterable?: boolean; sortable?: boolean }>;
}
export interface ODataDatasetPage {
  schema: 'stellar-forge.dataset-page.v1'; dataset: ODataDatasetDescription; fields: string[];
  filters: Record<string, string | number | boolean | null>;
  ranges?: Array<{ column: string; operator: string; value: string | number | boolean | null }>;
  order?: { column: string; direction: 'asc' | 'desc'; nulls: 'last'; ties: 'csv-record-order' };
  rows: Array<Record<string, string | number | boolean | null>>;
  page: { limit: number; total: number; returned: number; nextCursor: string | null };
}
export type ODataDatasetResponse = { status: 200; headers: Record<string, string>; body: ODataDatasetPage } |
  { status: 400 | 409 | 413; body: { error: string; message: string } };
export interface ODataExport {
  id: string; editionId: string; directory: string; createdAt: string; dataset: ODataDatasetDescription;
  mapping: ODataDatasetField[]; merchant: boolean; files: string[];
}
export interface ODataLiveProfile {
  schema: 'stellar-forge.odata-live-profile.v1'; id: string; name: string; planId: string; operation: string;
  sourceBinding: string; createdAt: string; settings: { port: number; operationsPort: number; facilitator: string | null; allowLoopback?: boolean };
  files: string[];
}
export interface ODataStoredState {
  schema: 'stellar-forge.odata-workspace.v1'; revision: number; createdAt: string;
  updatedAt?: string; restoredAt?: string; connections: ODataConnection[]; plans: ODataSavedPlan[];
  editions: ODataEdition[]; reviews: ODataReview[]; exports: ODataExport[];
  activeEdition: string | null; liveProducts?: ODataLiveProfile[];
}
export interface ODataWorkspaceState extends Omit<ODataStoredState, 'editions' | 'liveProducts'> {
  editions: ODataEditionSummary[]; liveProducts: ODataLiveProfile[]; running: string[];
}
export interface ODataTransfer {
  schema: 'stellar-forge.odata-transfer.v1'; exportedAt: string; state: ODataStoredState;
  files: Array<{ path: string; sha256: string; bodyBase64: string }>;
}
export interface ODataPayment {
  network: 'stellar:testnet' | 'stellar:pubnet'; asset: string; payTo: string; maxTimeoutSeconds: number;
}
export interface ODataDatasetPayment extends ODataPayment { scheme: 'exact'; amount: string }
