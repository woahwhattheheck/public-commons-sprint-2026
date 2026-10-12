/** Source-table authoring over the original native merchant workspace generator. */
export type Delimiter = ',' | '\t' | ';' | '|';
export type DelimiterChoice = Delimiter | 'comma' | 'tab' | 'semicolon' | 'pipe';
export type FieldType = 'text' | 'integer' | 'integer-text' | 'decimal-text' | 'boolean' | 'date' | 'timestamp';
export type EmptyPolicy = 'keep' | 'null' | 'omit' | 'error';
export type JsonScalar = string | number | boolean | null;
export type Json = JsonScalar | Json[] | { [key: string]: Json };
export interface DialectOptions {
  delimiter?: DelimiterChoice;
  header?: boolean;
  skipEmptyRecords?: boolean;
}
export interface SourceRecord { record: number; line: number }
export interface ParsedRecord extends SourceRecord { cells: string[] }
export interface ParsedTable {
  delimiter: Delimiter; header: boolean; skipEmptyRecords: boolean; headings: string[];
  width: number; rows: ParsedRecord[]; skippedEmptyRecords: number; sourceRecordCount: number;
}
export interface SourceInspection {
  delimiter: Delimiter; candidates: Delimiter[]; ambiguous: boolean; headings: string[];
  columnCount: number; rowCount: number; skippedEmptyRecords: number; sourceRecordCount: number;
  /** The first twenty complete parsed rows; all rows participate in review and export. */
  preview: ParsedRecord[];
}
export interface ColumnMapping {
  /** Zero-based original source column, independent of its output name. */
  index: number;
  sourceName: string;
  name: string;
  include: boolean;
  type: FieldType;
  empty: EmptyPolicy;
  trim: boolean;
  /** Meaning only: no numerical conversion is implied. */
  unit: string;
  /** Meaning only: no timezone conversion is implied. */
  timeBasis: string;
}
export interface TableMapping {
  schema: typeof MAPPING_SCHEMA; delimiter: Delimiter; header: boolean;
  skipEmptyRecords: boolean;
  /** Zero-based source column indices, in declared compound-key order. */
  keyColumns: number[];
  columns: ColumnMapping[];
}
export interface SourceEdition {
  id: string; filename: string; sourceText: string; bytes: number; sha256: string; receivedAt: string;
}
export interface ResourceField {
  name: string; sourceName: string; sourceIndex: number; type: FieldType;
  empty: EmptyPolicy; trim: boolean; unit: string; timeBasis: string;
}
export type ResourceRow = Record<string, JsonScalar>;
export interface TabularResource {
  schema: typeof RESOURCE_SCHEMA;
  source: Pick<SourceEdition, 'filename' | 'sha256' | 'bytes'> & { editionId: string };
  fields: ResourceField[]; keyFields: string[]; rows: ResourceRow[];
}
export interface ReviewSummary {
  rows: number; columns: number; sourceRecords: number; skippedEmptyRecords: number; keyFields: string[];
}
export interface NormalizedTable {
  data: TabularResource; dataText: string; dataBytes: number; sourceRecords: SourceRecord[]; summary: ReviewSummary;
}
export interface TableReview {
  id: string; editionId: string; reviewedAt: string; mapping: TableMapping;
  sourceSha256: string; outputSha256: string; dataText: string; dataBytes: number;
  sourceRecords: SourceRecord[]; summary: ReviewSummary;
}
/** Original dataset draft fields remain owned by onboarding.mjs. Unknown metadata is retained. */
export interface NativePaymentChoice {
  scheme?: string; network: string; amount: string; asset: string; payTo: string;
  maxTimeoutSeconds: number; extra?: Json; [key: string]: unknown;
}
export interface NativeResource {
  id: string; path: string; serviceName: string; description: string;
  tags: string | string[]; amount?: string; dataText: string;
  paymentMode?: 'shared' | 'route'; paymentOptions?: NativePaymentChoice[];
  paymentStyle?: 'payment' | 'paymentOptions'; originalRouteId?: string;
  [key: string]: unknown;
}
export interface NativeStarter {
  schema?: 'stellar-forge.frontdoor-starter.v1'; folder: string; network: string; asset: string;
  payTo: string; amount: string; maxTimeoutSeconds: number; resources: NativeResource[];
  importedSeller?: Record<string, unknown>; [key: string]: unknown;
}
export interface TableDocument {
  id: string; label: string; resourceId: string; mapping: TableMapping;
  selectedEditionId: string; selectedReviewId: string | null; baselineReviewId: string | null;
  editions: SourceEdition[]; reviews: TableReview[];
}
export interface TableProject {
  schema: typeof PROJECT_SCHEMA; id: string; name: string; createdAt: string;
  starter: NativeStarter; documents: TableDocument[];
}
export interface TableSummary {
  id: string; label: string; resourceId: string; sourceEditions: number; reviews: number;
  selectedEditionId: string; selectedReviewId: string | null;
  reviewedCurrentInput: boolean; summary: ReviewSummary | null;
}
export interface ProjectSummary {
  schema: typeof PROJECT_SCHEMA; id: string; name: string; folder: string; tables: TableSummary[];
}
export interface ComparisonCounts { added: number; removed: number; changed: number; unchanged: number }
export interface RowChange {
  kind: 'added' | 'removed' | 'changed';
  /** JSON containing a typed record key or a complete sorted row signature. */
  key: string;
  beforeRecord?: SourceRecord; afterRecord?: SourceRecord; changedFields?: string[];
  before: ResourceRow | null; after: ResourceRow | null;
}
export interface ReviewComparison {
  schema: 'stellar-forge.source-table-comparison.v1'; documentId: string;
  baselineReviewId: string; currentReviewId: string;
  mode: 'record-keys' | 'whole-row-multiset'; keyFields: string[]; keysChanged: boolean;
  declaredKeyFields: { baseline: string[]; current: string[] };
  summary: ComparisonCounts;
  columns: {
    added: ResourceField[]; removed: ResourceField[];
    changed: { name: string; before: ResourceField; after: ResourceField }[];
  };
  /** Every changed, added or removed row; never a preview or sample. */
  changes: RowChange[];
}
export interface MaterialDocument {
  id: string; label: string; resourceId: string; selectedReviewId: string;
  sources: { id: string; filename: string; path: string; bytes: number; sha256: string; receivedAt: string }[];
  reviews: {
    id: string; editionId: string; output: string; mapping: string; record: string;
    bytes: number; sha256: string; summary: ReviewSummary;
  }[];
  comparisons: { json: string; csv: string; summary: ComparisonCounts; mode: ReviewComparison['mode'] }[];
}
export interface MaterialsManifest {
  schema: 'stellar-forge.source-table-materials.v1'; projectId: string; projectName: string;
  nativeWorkspaceSchema: string; documents: MaterialDocument[];
}
export interface WorkspaceFile { path: string; content: string | Uint8Array }
export interface TableWorkspace {
  files: WorkspaceFile[]; config: Record<string, unknown>;
  workspace: { schema: string; template: string; packageVersion: string | null; sourceCommit: string | null };
  commands: Record<string, string>; draft: NativeStarter;
  project: TableProject; manifest: MaterialsManifest;
  summary: { folder: string; resourceCount: number; totalDataBytes: number; projectId: string; sourceTables: TableSummary[]; [key: string]: unknown };
}
export interface FieldIssue {
  record: number; line: number; column?: number; name?: string; value?: string; key?: string; message: string;
}
export class SourceTableError extends Error {
  constructor(code: string, message: string, details?: Record<string, unknown>);
  code: string; issues?: FieldIssue[]; issueCount?: number; issuesTruncated?: boolean;
  line?: number; record?: number; column?: number; expected?: number; actual?: number;
}
export const PROJECT_SCHEMA: 'stellar-forge.source-table-project.v1';
export const MAPPING_SCHEMA: 'stellar-forge.source-table-mapping.v1';
export const RESOURCE_SCHEMA: 'stellar-forge.tabular-resource.v1';
export const TYPES: readonly FieldType[];
export const EMPTY_POLICIES: readonly EmptyPolicy[];
export const DELIMITERS: Readonly<{ comma: ','; tab: '\t'; semicolon: ';'; pipe: '|' }>;
export const LIMITS: Readonly<{ sourceBytes: number; projectBytes: number; rows: number; columns: number; documents: number }>;
export function sha256(value: string | Uint8Array | ArrayBuffer): Promise<string>;
export function decodeSource(value: Uint8Array | ArrayBuffer): string;
export function parseTable(input: string, options?: DialectOptions): ParsedTable;
export function inspectSource(input: string, options?: DialectOptions): SourceInspection;
export function initialMapping(input: string, options?: DialectOptions): TableMapping;
export function normalizeTable(edition: SourceEdition, mapping: TableMapping): NormalizedTable;
export function createProject(options?: { name?: string; starter?: NativeStarter }): TableProject;
export function selectedEdition(document: TableDocument): SourceEdition;
export function selectedReview(document: TableDocument): TableReview;
export function addDocument(project: TableProject, input: DialectOptions & { filename: string; sourceText: string; resourceId?: string }): Promise<{ project: TableProject; documentId: string; editionId: string }>;
export function addEdition(project: TableProject, documentId: string, input: { filename: string; sourceText: string }): Promise<{ project: TableProject; documentId: string; editionId: string; reused: boolean }>;
export function resetMapping(project: TableProject, documentId: string, options?: DialectOptions): TableProject;
export function replaceMapping(project: TableProject, documentId: string, mapping: TableMapping): TableProject;
export function freezeReview(project: TableProject, documentId: string): Promise<{ project: TableProject; review: TableReview; reused: boolean }>;
export function reviewIsCurrent(document: TableDocument): boolean;
export function compareReviews(document: TableDocument, baselineId: string, currentId?: string | null): ReviewComparison;
export function comparisonCsv(comparison: ReviewComparison): string;
export function importProject(input: string | TableProject): Promise<TableProject>;
export function projectSummary(project: TableProject): ProjectSummary;
export function createTableWorkspace(project: TableProject): Promise<TableWorkspace>;
export function createTableArchive(project: TableProject): Promise<{ workspace: TableWorkspace; bytes: Uint8Array }>;
