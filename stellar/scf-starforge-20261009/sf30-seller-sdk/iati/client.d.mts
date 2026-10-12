/** MIT. Typed access to the original IATI console. Financial and identifier values remain strings. */
export type Sha256 = string;
export type ExactDecimalString = string;
export type CalendarDate = string;
export type Collection = 'activities' | 'transactions' | 'budgets';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface RequestOptions { signal?: AbortSignal }
export interface RevisionOptions extends RequestOptions { revision?: number }
export interface Selection {
  activityIds?: string[];
  currencies?: string[];
  transactionTypes?: string[];
  budgetTypes?: string[];
  dateFrom?: CalendarDate;
  dateTo?: CalendarDate;
}
export interface Review {
  status: 'draft' | 'reviewed' | 'needs-correction';
  /** A named reviewer is required for reviewed or needs-correction. */
  reviewer: string;
  note: string;
}
export interface PortfolioDefinition {
  requestId: string;
  name: string;
  notes?: string;
  /** One to thirty-two distinct, complete retained publisher source IDs. */
  sources: Sha256[];
  selection?: Selection;
  review?: Review;
}
export type PortfolioSave = PortfolioDefinition &
  ({ id?: never; expectedRevision?: never } | { id: Sha256; expectedRevision: number });
export interface Column {
  name: string; type: 'string'; nullable: false;
}
export interface IatiPlan {
  schema?: 'stellar-forge.iati-mapping.v1';
  domainVersion?: 'iati-2.03-associations-2';
  collection: Collection;
  name?: string;
  language?: string;
  fields?: string[];
  selection?: Selection;
  /** These capabilities are derived from the chosen known fields by the native mapper. */
  columns?: Column[];
  keys?: ['row_id'];
  filters?: string[];
  ranges?: string[];
  sorts?: string[];
  allowEmpty?: boolean;
  defaultLimit?: number;
  maxLimit?: number;
  maxBytes?: number;
  maxRows?: number;
  maxCellChars?: number;
}
export interface SavedPlan { id: Sha256; plan: IatiPlan }
export interface FileIdentity { bytes: number; sha256: Sha256 }
export interface SourceSummary {
  id: Sha256; label: string; name: string; bytes: number; created: number;
}
export interface Source extends SourceSummary { inventory: Record<string, unknown> }
export interface Profile {
  schema: 'stellar-forge.iati-profile.v1';
  source: Pick<SourceSummary, 'id' | 'label' | 'name' | 'bytes'>;
  inventory: Record<string, unknown>;
}
export interface NativeDescription {
  name: string;
  rowCount: number;
  snapshot: Sha256;
  maxLimit: number;
  columns: Array<Column & { filterable: boolean; rangeFilterable: boolean; sortable: boolean }>;
  [key: string]: unknown;
}
export interface NativeBuild {
  schema: string; id: Sha256; source: Sha256; plan: Sha256;
  rowCount: number; keys: string[];
  columns: Array<{ column: string; emptyCells: number; nullValues: number }>;
  native: NativeDescription;
  engineBlob: string;
  files: Record<'data.csv' | 'dataset.json' | 'rows.sqlite', FileIdentity>;
}
export interface QueryPage {
  schema: 'stellar-forge.dataset-page.v1';
  dataset: NativeDescription;
  fields: string[];
  rows: Array<Record<string, string>>;
  page: { limit: number; total: number; returned: number; nextCursor: string | null };
  filters: Record<string, string>;
  ranges?: Array<{ column: string; operator: string; value: string }>;
  order?: unknown;
}
export interface NativeQuery {
  id: number; ok: true; engineBlob: string; dataset: NativeDescription;
  response:
    | { status: 200; headers: Record<string, string>; body: QueryPage }
    | { status: 400 | 409 | 413; body: { error: string; message: string } };
}
export interface NativeComparison {
  schema: string; id: Sha256; before: Sha256; after: Sha256;
  counts: Record<string, number>; changesSha256: Sha256;
  [key: string]: unknown;
}
export interface ChangePage {
  rows: Array<{ kind: string; key: string[]; fields?: string[]; before?: unknown; after?: unknown }>;
  offset: number; nextOffset: number | null;
}
export interface BaseFinancialGroup {
  collection: 'transactions' | 'budgets';
  reportingOrgRef: string;
  hierarchy: string;
  currency: string;
  valueDate: string;
  count: number;
  amount: ExactDecimalString;
}
export interface TransactionGroup extends BaseFinancialGroup {
  collection: 'transactions';
  transactionType: string;
  transactionTypeLabel: string;
}
export interface BudgetGroup extends BaseFinancialGroup {
  collection: 'budgets';
  budgetType: string; budgetTypeLabel: string;
  budgetStatus: string; budgetStatusLabel: string;
  periodStart: string; periodEnd: string;
}
export interface PortfolioCounts {
  sources: number; activities: number; transactions: number; budgets: number;
  plannedDisbursementsRetained: number;
  reviewRecords: number; excludedFinancialRecords: number;
}
export interface Coverage {
  bySource: Array<{ source: Sha256; activities: number; transactions: number; budgets: number; reportingOrgRefs: string[] }>;
  activityCount: number; activityIdsSha256: Sha256;
}
export interface ReportSummary {
  counts: PortfolioCounts;
  financialGroups: Array<TransactionGroup | BudgetGroup>;
  reviewCount: number;
  coverage: Coverage;
  semantics: Record<string, string>;
  [key: string]: unknown;
}
export interface Portfolio {
  schema: 'stellar-forge.iati-portfolio.v1';
  id: Sha256; revision: number; name: string; notes: string;
  sources: Sha256[]; selection: Selection; review: Review;
  editions: Array<{
    source: Sha256;
    activities: NativeBuild; transactions: NativeBuild; budgets: NativeBuild;
  }>;
  created: number; updated: number; previousRevision: number | null;
  report: ReportSummary; definitionSha256: Sha256;
}
export interface Report extends ReportSummary {
  portfolio: Sha256; revision: number; name: string; notes: string;
  review: Review; definitionSha256: Sha256;
}
export interface PortfolioCompare {
  id: Sha256; beforeRevision: number; afterRevision: number;
  /** Explicit original publisher edition pairs when automatic pairing is ambiguous. */
  pairs?: Array<{ before: Sha256; after: Sha256 }>;
}
export interface PortfolioComparison {
  schema: 'stellar-forge.iati-portfolio-comparison.v1';
  id: Sha256; portfolio: Sha256; beforeRevision: number; afterRevision: number;
  selectionChanged: boolean;
  pairs: Array<{ before: Sha256; after: Sha256 }>;
  addedSources: Sha256[]; removedSources: Sha256[];
  comparisons: Array<{ collection: Collection; before: Sha256; after: Sha256; comparison: NativeComparison }>;
  beforeCounts: PortfolioCounts; afterCounts: PortfolioCounts;
  semantics: unknown;
}
export interface WorkspaceState {
  schema: 'stellar-forge.iati-workspace.v1';
  sources: SourceSummary[];
  plans: Array<{ id: Sha256; name: string; created: number }>;
  builds: NativeBuild[]; comparisons: NativeComparison[];
  portfolios: Portfolio[];
}
export interface Presets {
  schema: 'stellar-forge.iati-presets.v1';
  standard: '2.03';
  collections: Array<{ collection: Collection; label: string; fields: string[]; plan: IatiPlan }>;
  transactionTypes: Record<string, string>;
  budgetTypes: Record<string, string>;
  budgetStatuses: Record<string, string>;
  currencyCatalog: { asOf: CalendarDate; codes: string[]; withdrawn: string[]; source: string };
}
export interface PythonIdentity {
  executable: string; prefix: string; basePrefix: string;
  implementation: string; version: [number, number, number];
}
export interface ManagedLaunch {
  schema: 'stellar-forge.iati-workspace-launch.v1';
  status: 'IATI_WORKSPACE_READY';
  workspace: string; bindingSha256: Sha256; sourceRoot: string;
  python: PythonIdentity; pid: number;
  /** Private capability URL. Never publish it with report or source exports. */
  console: string;
  connectionFile?: string;
}
export interface ReceivedPortfolio {
  portfolio: Portfolio; reconstructed: true;
  historyCount: number; datasetCount: number; reportFiles: string[];
  /** Actual receiving engine and SQLite index identities; original portfolio history remains unchanged. */
  receivingBuilds: Array<{ id: Sha256; engineBlob: string; indexSha256: Sha256 }>;
}
export interface ReceivedProject { source: Sha256; plan: Sha256; build: NativeBuild; [key: string]: unknown }
export interface SourceInput {
  body: BodyInit | AsyncIterable<Uint8Array>;
  /** Actual observed byte count of the complete original input, up to 256 MiB. */
  bytes: number;
  name?: string; label?: string;
}
export interface PacketInput {
  body: BodyInit | AsyncIterable<Uint8Array>;
  /** Actual complete archive length, within the native 4 GiB packet limit. */
  bytes: number;
  kind?: 'portfolio' | 'project';
}
/** Borrows an existing authenticated loopback console. It creates no source store or process. */
export declare class IatiWorkspaceClient {
  constructor(consoleUrl: string, options?: { timeoutMs?: number });
  readonly origin: string;
  state(options?: RequestOptions): Promise<WorkspaceState>;
  launch(options?: RequestOptions): Promise<ManagedLaunch>;
  source(id: Sha256, options?: RequestOptions): Promise<Source>;
  plan(id: Sha256, options?: RequestOptions): Promise<SavedPlan>;
  savePlan(plan: IatiPlan, options?: RequestOptions): Promise<SavedPlan>;
  build(source: Sha256, plan: Sha256, options?: RequestOptions): Promise<NativeBuild>;
  query(build: Sha256, params?: Record<string, string>, options?: RequestOptions): Promise<NativeQuery>;
  compare(before: Sha256, after: Sha256, options?: RequestOptions): Promise<NativeComparison>;
  changes(id: Sha256, options?: RequestOptions & { offset?: number; limit?: number }): Promise<ChangePage>;
  presets(options?: RequestOptions): Promise<Presets>;
  profile(source: Sha256, options?: RequestOptions): Promise<Profile>;
  portfolios(options?: RequestOptions): Promise<{ portfolios: Portfolio[] }>;
  portfolio(id: Sha256, options?: RevisionOptions): Promise<Portfolio>;
  history(id: Sha256, options?: RequestOptions): Promise<{ history: Portfolio[] }>;
  savePortfolio(input: PortfolioSave, options?: RequestOptions): Promise<Portfolio>;
  report(id: Sha256, options?: RevisionOptions): Promise<Report>;
  comparePortfolio(input: PortfolioCompare, options?: RequestOptions): Promise<PortfolioComparison>;
  /** Consume or cancel the returned full native stream; this is never a reconstructed file. */
  export(kind: 'project' | 'dataset' | 'changes' | 'portfolio' | 'report', id: Sha256, options?: RevisionOptions): Promise<Response>;
  ingest(input: SourceInput, options?: RequestOptions): Promise<Source>;
  receive(input: PacketInput, options?: RequestOptions): Promise<ReceivedPortfolio | ReceivedProject>;
  /** Aborts and drains this client's requests only. Applications owns the original console. */
  dispose(): Promise<void>;
}
/** The connection file is read from its exact private, single-linked regular file with a bounded FileHandle. */
export declare function connectIatiWorkspace(options:
  ({ consoleUrl: string; consoleUrlFile?: never } | { consoleUrl?: never; consoleUrlFile: string }) &
  { timeoutMs?: number }): Promise<IatiWorkspaceClient>;
