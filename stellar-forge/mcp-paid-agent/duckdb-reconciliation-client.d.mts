// SPDX-License-Identifier: MIT
/** Exact native comparison values and IDs are never coerced through JavaScript numbers. */
export type NativeId = string;
export type RequestId = string;
export type ComparisonState =
  | 'EXACT_EQUAL' | 'EXACT_DIFFERENT' | 'NULLS_EQUAL' | 'WITHIN_TOLERANCE'
  | 'OUTSIDE_TOLERANCE' | 'NULL_NOT_COMPARABLE' | 'NON_FINITE_NOT_COMPARABLE'
  | 'DUPLICATE_NOT_PAIRED' | 'ONE_SIDED' | 'QUARANTINED';
export type GroupCategory =
  | 'MATCHED' | 'TOLERANCE_MATCHED' | 'SOURCE_ONLY' | 'TARGET_ONLY'
  | 'VALUE_DIFFERENCE' | 'MULTISET_DIFFERENCE' | 'NOT_COMPARABLE';
export interface NumericComparisonRule {
  mode: 'numeric-tolerance';
  /** Exact nonnegative decimal strings, coefficient/exponent bounded by native review. */
  absolute: string;
  /** Ratio in [0,1]; 0.005 is 0.5%, scaled by max(abs(source),abs(target)). */
  relative: string;
  /** Approved native source unit. This statement performs no unit conversion. */
  unit: string;
  nulls: 'equal' | 'uncomparable';
  basis: string;
}
export interface LiteralValueMap { original: string; canonical: string; }
export interface ComparisonColumn {
  name: string; source: string; target: string; role: 'key' | 'value';
  meaning?: string; source_map?: LiteralValueMap[]; target_map?: LiteralValueMap[];
  /** Only native BIGINT/HUGEINT/DECIMAL/DOUBLE value columns; never keys. */
  comparison?: NumericComparisonRule;
}
export interface ComparisonWindow { id: string; start: string; end: string; basis: 'native' | 'lexical'; }
export interface ReconciliationDefinition {
  name: string; label: string; source_edition: NativeId; target_edition: NativeId;
  columns: ComparisonColumn[]; window_column?: string | null;
  windows?: ComparisonWindow[]; notes?: string;
}
export interface NumericRules {
  schema: 'stellar-forge.duckdb-reconciliation.numeric-rules.v1';
  formula: string;
  columns: Array<{index: number; name: string; type: string; comparison: NumericComparisonRule}>;
  arithmetic: string; duplicates: string; missing: string;
}
export interface ReviewedEdition {
  edition_id: NativeId; row_count: number; manifest_sha256: string;
  source_binding_sha256: string; columns: Array<Record<string, unknown>>;
  keys: string[]; source_scope: Record<string, unknown>; source_meanings: unknown;
}
export interface ReconciliationReview {
  schema: 'stellar-forge.duckdb-reconciliation.v1'; workspace_id: string;
  definition: ReconciliationDefinition; source: ReviewedEdition; target: ReviewedEdition;
  comparison_columns: Array<{name: string; type: string; role: 'key' | 'value'}>;
  omitted: {source: string[]; target: string[]}; comparison_basis: string;
  comparison_rules?: NumericRules; review_sha256: string;
}
export interface ReconciliationPair {
  schema: string; pair_id: NativeId; name: string; label: string; revision: number;
  definition_sha256: string; definition: ReconciliationDefinition; review: ReconciliationReview; created_at: string;
}
export interface SideAccounting {
  total: number; included: number; quarantined: number; excluded: number; matched: number; unmatched: number;
  canonical_matched?: number; exact_matched?: number; tolerance_matched?: number;
}
export interface DecisionProgress {
  required: number; recorded: number; accepted: number; requires_correction: number;
  deferred: number; open: number; resolved: number;
}
export interface RunSummary {
  source: SideAccounting; target: SideAccounting;
  groups: Partial<Record<GroupCategory, number>> & {total: number; duplicate_groups: number};
  fields?: Record<ComparisonState, number> & {total: number};
  accounting_balanced: boolean; scope_note: string; decisions: DecisionProgress;
}
export interface ReconciliationRun {
  schema: string; run_id: NativeId; pair_id: NativeId; pair_revision: number;
  definition_sha256: string; review_revision: number; review: ReconciliationReview;
  summary: RunSummary; source_edition: NativeId; target_edition: NativeId;
  created_at: string; comparison_basis: string; comparison_rules?: NumericRules;
}
export interface PageOptions { offset?: number; limit?: number; }
export interface NativeGrid {
  columns: Array<{name: string; type: string}>;
  rows: unknown[][]; offset: number; limit: number; total: number; next_offset: number | null;
  run_id?: NativeId; review_revision?: number;
}
export type Catalog<K extends string,T> =
  {offset: number; limit: number; total: number; next_offset: number | null} & Record<K,T[]>;
export type DecisionSubject = {kind: 'group'; group_id: number} | {kind: 'row'; side: 'source' | 'target'; row: number};
export type DecisionOutcome = 'OPEN' | 'ACCEPTED_DIFFERENCE' | 'REQUIRES_CORRECTION' | 'DEFERRED';
export interface ReconciliationDecision {
  run_id: NativeId; sequence: number; subject: DecisionSubject; outcome: DecisionOutcome;
  actor: string; reason: string; created_at: string; request_id: RequestId;
}
export interface ReconciliationReport {
  schema: string; report_id: NativeId; run_id: NativeId; pair_id: NativeId;
  pair_revision: number; review_revision: number; definition: ReconciliationDefinition;
  review: ReconciliationReview; summary: RunSummary;
  source_edition: NativeId; target_edition: NativeId; before_run_id: NativeId | null;
  scope_comparison: Record<string,unknown> | null;
  queries: Array<{kind: 'rows' | 'groups' | 'fields' | 'decisions' | 'changes';
    query_id: NativeId; revision: number; sql: string; parameters: unknown; parameters_text: string;
    [key: string]: unknown}>;
  views_at_creation: Array<{name: string; edition_id: NativeId; revision: number}>; created_at: string;
}
export interface ReconciliationRequest {
  request_id: RequestId; kind: 'pairs' | 'run' | 'decision' | 'report';
  body: Record<string, unknown>; state: 'PREPARED' | 'RUNNING' | 'INTERRUPTED' | 'COMPLETE';
  created_at: string; updated_at?: string; error?: string; result?: unknown;
}
export interface ExportManifest {
  schema: 'stellar-forge.duckdb-reconciliation.v1.export';
  export_id: NativeId; report_id: NativeId; report_digest: string;
  request_id: RequestId; workspace_id: string; complete: true; state: 'COMPLETE';
  comparison_rules?: NumericRules;
  files: Array<{name: string; bytes: number; sha256: string; [key: string]: unknown}>;
  queries: Array<{kind: string; query_id: NativeId; revision: number; export_id: NativeId;
    directory: string; rows: number}>;
  sources: Array<{edition_id: NativeId; directory: string; files: string[]}>;
  [key: string]: unknown;
}
export function parseReconciliationManifest(bytes: Uint8Array, exportId: NativeId): ExportManifest;
export interface ReconciliationClient {
  readonly workspace: string; readonly workspaceId: string; readonly endpoint: string;
  status(): Promise<{schema: string; workspace_id: string; feature_schema?: string;
    pair_count: number; run_count: number; report_count: number}>;
  review(definition: ReconciliationDefinition): Promise<ReconciliationReview>;
  pairs(options?: PageOptions): Promise<Catalog<'pairs',ReconciliationPair>>;
  pair(pairId: NativeId, revision?: number): Promise<ReconciliationPair>;
  savePair(request: {request_id: RequestId; expected_revision: number;
    definition: ReconciliationDefinition; review_sha256: string}): Promise<ReconciliationPair>;
  runs(options?: PageOptions & {pair_id?: NativeId}): Promise<Catalog<'runs',ReconciliationRun>>;
  run(runId: NativeId): Promise<ReconciliationRun>;
  execute(request: {request_id: RequestId; pair_id: NativeId; expected_revision: number;
    definition_sha256: string}): Promise<ReconciliationRun>;
  groups(runId: NativeId, options?: PageOptions & {category?: GroupCategory; duplicates?: boolean}): Promise<NativeGrid>;
  rows(runId: NativeId, options?: PageOptions & {side?: 'source' | 'target';
    status?: 'INCLUDED' | 'QUARANTINED' | 'EXCLUDED_WINDOW'; group_id?: number}): Promise<NativeGrid>;
  fields(runId: NativeId, options?: PageOptions & {group_id?: number; column_name?: string; state?: ComparisonState}): Promise<NativeGrid>;
  row(runId: NativeId, side: 'source' | 'target', row: number): Promise<{
    side: string; row: number; edition_id: NativeId; original: Record<string,unknown>; canonical: Record<string,unknown>}>;
  decisions(runId: NativeId, options?: PageOptions): Promise<Catalog<'decisions',ReconciliationDecision>>;
  decide(request: {request_id: RequestId; run_id: NativeId; expected_revision: number;
    subject: DecisionSubject; outcome: DecisionOutcome; actor: string; reason: string}): Promise<{
    decision: ReconciliationDecision; run: ReconciliationRun}>;
  reports(options?: PageOptions & {run_id?: NativeId}): Promise<Catalog<'reports',ReconciliationReport>>;
  report(reportId: NativeId): Promise<ReconciliationReport>;
  saveReport(request: {request_id: RequestId; run_id: NativeId; expected_revision: number;
    before_run_id?: NativeId}): Promise<ReconciliationReport>;
  changes(reportId: NativeId, options?: PageOptions): Promise<NativeGrid>;
  operations(options?: PageOptions): Promise<Catalog<'operations',ReconciliationRequest>>;
  request(requestId: RequestId): Promise<ReconciliationRequest>;
  resume(requestId: RequestId): Promise<unknown>;
  exportReport(request: {request_id: RequestId; report_id: NativeId}): Promise<Record<string,unknown>>;
  exportRequest(requestId: RequestId): Promise<Record<string,unknown>>;
  resumeExport(requestId: RequestId): Promise<Record<string,unknown>>;
  inspectExport(exportId: NativeId): Promise<Record<string,unknown>>;
  download(options: {exportId: NativeId; directory: string; expectedManifestSha256?: string;
    chunkSize?: number; onProgress?: (progress: Record<string,unknown>) => void | Promise<void>;
    signal?: AbortSignal}): Promise<Record<string,unknown>>;
  /** Releases only this client's requests. The original server and database owner stay external. */
  close(): Promise<void>;
}
export function openDuckDBReconciliationClient(options: {
  url?: string; client?: {endpoint: string; call: (...args: any[]) => Promise<any>};
  workspace: string; expectedWorkspaceId?: string; tokenEnv?: string;
  environment?: Record<string,string | undefined>; signal?: AbortSignal;
}): Promise<ReconciliationClient>;
