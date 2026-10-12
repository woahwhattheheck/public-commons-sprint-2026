// MIT. Public declarations for the original Python workspace and merchant receiver.
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface JsonObject { [key: string]: JsonValue; }
export type Sha256 = string;
export type RecordKind = "workflow" | "operation" | "capture" | "edition" | "receiving" | "task";
export interface ContentObject { sha256: Sha256; bytes: number; }
export interface FileDescriptor extends ContentObject { path: string; content_type?: string; }
export interface ExactNumber { $number: string; }
export interface ExactDecimal { $decimal: string; }
export interface ExactInteger { $integer: string; }
export interface ExactFloat { $float: string; }
export interface ExactBinary { $binary: string; encoding: "base64"; }
export interface ExactTemporal { $temporal: string; }
/** Tagged values are source values, never JavaScript-number coercion instructions. */
export type PreviewValue = null | boolean | number | string | ExactNumber | ExactDecimal | ExactInteger |
  ExactFloat | ExactBinary | ExactTemporal | PreviewValue[] | { [name: string]: PreviewValue };
export interface RetainedRecord {
  id: string; revision_sha256: Sha256; workflow_id: string; schema?: string;
  [name: string]: unknown;
}
export interface SourceFile extends ContentObject { id?: string; filename?: string; [name: string]: unknown; }
export interface OutputDefinition {
  id: string; title?: string; store?: string; path?: string;
  format: "csv" | "ndjson" | "geojson-seq" | "parquet" | "geoparquet";
  primary_key?: string | string[]; geometry_column?: string | null;
  axis_order?: string; crs?: JsonValue;
  csv?: {header: boolean; delimiter?: string; quotechar?: string; escapechar?: string | null;
    encoding?: string; columns?: string[]; [name: string]: unknown};
  max_objects?: number; max_bytes?: number; [name: string]: unknown;
}
export interface WorkflowDefinition {
  schema: string; id: string; title: string;
  account: {organization_id: string | null; region: string | null; runtime: string | null; version?: string; [name: string]: unknown};
  job: {name: string; script: {uri?: string; object?: ContentObject; filename?: string; [name: string]: unknown};
    args?: string[]; timeout_seconds?: number; [name: string]: unknown};
  sources: JsonObject[]; outputs: OutputDefinition[];
  limits?: {max_objects: number; max_bytes: number};
  source_files?: SourceFile[]; [name: string]: unknown;
}
/** A source-only interoperability record retains its original source definition;
 * submitting a cloud job uses this stronger complete native contract. */
export interface NativeWorkflowDefinition extends WorkflowDefinition {
  account: {organization_id: string; region: string; runtime: string; version?: string; [name: string]: unknown};
  job: WorkflowDefinition["job"] & {args: string[]; timeout_seconds: number};
  outputs: (OutputDefinition & {store: "s3" | "my_files"; path: string})[];
  limits: {max_objects: number; max_bytes: number};
}
export interface WorkflowRecord extends RetainedRecord {
  definition: WorkflowDefinition; created_at: string; updated_at: string; updated_by?: string;
}
export interface OperationRecord extends RetainedRecord {
  operation_id: string; reviewed_definition: WorkflowDefinition; state: string;
  native_run_id?: string | null; native_status?: string | null;
  mode?: "submit" | "attach"; review_sha256?: Sha256; workflow_revision?: Sha256;
  run_objects?: ContentObject[]; log_captures?: JsonObject[]; output_editions?: string[];
}
export interface OutputColumn {
  name: string; types: string[]; source_types?: string[];
  source_nullable?: boolean[]; nullable?: boolean; [name: string]: unknown;
}
export interface OutputPart {
  relative_path: string; object: ContentObject; provider: JsonObject;
  role: "data" | "auxiliary"; row_count?: number; inspection?: JsonObject; [name: string]: unknown;
}
export interface EditionDataset {
  id: string; dataset_id: string; definition: OutputDefinition;
  listing_object: ContentObject; source_objects: ContentObject[]; complete: true;
  files: OutputPart[]; row_count: number; columns: OutputColumn[]; geometry: JsonObject;
  primary_key: string[]; content_sha256: Sha256; row_index_object: ContentObject;
  row_index_schema: string; preview_encoding: string;
}
export interface EditionRecord extends RetainedRecord {
  operation_id: string; native_run_id: string | null; native_status?: string | null;
  review_sha256?: Sha256 | null; operation_revision_sha256: Sha256;
  source_binding_sha256: Sha256; created_at: string; datasets: EditionDataset[]; comparisons: Comparison[];
}
export interface CaptureRecord extends RetainedRecord {
  operation_id: string; native_run_id?: string | null; datasets: JsonObject[];
  state: string; total_objects?: number; total_bytes?: number;
}
export interface RecordByKind {
  workflow: WorkflowRecord; operation: OperationRecord; capture: CaptureRecord;
  edition: EditionRecord; receiving: RetainedRecord; task: RetainedRecord;
}
export interface PageArguments { offset?: number; /** 1–1000 */ limit?: number; }
export interface RecordPage<T = RetainedRecord> {
  items: T[]; offset: number; limit: number; total: number; next_offset: number | null;
}
export interface WorkspaceState {
  workspace_id: string; title: string;
  workflows: WorkflowRecord[]; operations: OperationRecord[]; editions: EditionRecord[];
  pages?: {workflows: Omit<RecordPage, "items">; operations: Omit<RecordPage, "items">; editions: Omit<RecordPage, "items">};
}
export interface RuntimeInformation {
  sdk_version: string | null; required_sdk_version: string;
  packages: Record<string, string | null>; organization_id: string | null; region: string | null;
  runtimes: string[]; api_base_url: string; connection_configured: boolean;
}
export interface EventPage {
  items: {seq: number; recorded_at: string; event: JsonValue}[];
  has_more: boolean; next_cursor: number;
}
export interface LogPage extends Omit<RecordPage<JsonObject>, "items"> {
  operation_id: string; native_run_id: string | null; items: JsonObject[];
  capture: number | null;
  captures: {index: number; captured_at: string | null; entries: number | null; complete: boolean}[];
  captured_at?: string | null; complete: boolean; error?: JsonValue;
}
export interface EditionRows {
  edition_id: string; dataset_id: string; native_run_id: string | null; source_binding_sha256: Sha256;
  offset: number; limit: number; total: number; next_offset: number | null;
  rows: Record<string, PreviewValue>[]; columns: OutputColumn[]; preview_encoding: string;
}
export interface Comparison {
  id: string; [name: string]: unknown;
}
export interface WorkflowExport extends ContentObject {
  schema: string; package_id: Sha256; workflow_id: string; source_workspace_id: string;
  path: string; records: number; objects: number; files: number; editions: string[];
  workflow_revision?: Sha256;
}
export interface DatasetExport {
  schema: "stellar-forge.wherobots-dataset-package.v1"; package_id: Sha256;
  directory: string; edition_id: string; dataset_id: string; source_binding_sha256: Sha256;
  files: FileDescriptor[]; source: JsonObject; reused?: boolean; [name: string]: unknown;
}
export interface ImportedHandover {
  status: "COMPLETE"; source_workspace_id: string; workflow_id: string; package_id: Sha256;
  created: number; advanced: number; reused: number; objects: number; source_directory: string;
  records: Record<string, {source_revision_sha256: Sha256; received_revision_sha256: Sha256}>;
  [name: string]: unknown;
}
export interface ToolDefinition {
  name: string; description: string;
  inputSchema: {type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false};
  annotations?: {readOnlyHint?: boolean; [name: string]: unknown};
}
export interface ToolReply<T = unknown> {
  content: {type: "text"; text: string}[]; structuredContent: T; isError: boolean;
}
export interface WorkspaceOptions {
  /** An already initialized, absolute private workspace directory. */
  directory: string;
  /** The original ID from init/state; each Python request checks this identity. */
  workspaceId?: string; python?: string; env?: Record<string, string | undefined>;
}
export interface CoreArguments {
  state: PageArguments; runtime: Record<string, never>;
  logs: {operation_id: string; capture?: number; offset?: number; limit?: number};
  get: {kind: RecordKind; id: string}; list: PageArguments & {kind: RecordKind};
  events: {kind: RecordKind; id: string; after?: number; limit?: number};
  import_source: {path: string; filename?: string; script?: boolean; expected_sha256?: Sha256; expected_bytes?: number};
  save_workflow: {definition: NativeWorkflowDefinition; expected_revision?: Sha256 | null; actor?: string};
  adopt: {input: string; files: Record<string, string | ContentObject>; account: JsonObject;
    expected_revision?: Sha256 | null; actor?: string; input_sha256?: Sha256};
  review: {workflow_id: string; operation_id: string; expected_revision: Sha256 | null; actor?: string; mode?: "submit" | "attach"};
  submit: {operation_id: string}; recover: {operation_id: string; native_run_id?: string};
  refresh: {operation_id: string; include_logs?: boolean}; cancel: {operation_id: string};
  capture: {operation_id: string};
  compare: {left_id: string; right_id: string}; rows: {edition_id: string; dataset_id: string; offset?: number; limit?: number};
  export: {workflow_id: string; destination: string; expected_revision?: Sha256 | null; export_id?: string; reuse_existing?: boolean};
  export_dataset: {edition_id: string; dataset_id: string; destination: string;
    expected_revision?: Sha256 | null; export_id?: string; reuse_existing?: boolean};
  import: {source: string; expected_sha256?: Sha256};
  inspect_export: {export_kind: "workflow" | "dataset"; source: string};
}
export interface CoreResults {
  state: WorkspaceState; runtime: RuntimeInformation; logs: LogPage;
  get: RetainedRecord; list: RetainedRecord[] | RecordPage; events: EventPage;
  import_source: ContentObject & {filename: string; [name: string]: unknown};
  save_workflow: WorkflowRecord; adopt: WorkflowRecord; review: OperationRecord;
  submit: OperationRecord; recover: OperationRecord; refresh: OperationRecord; cancel: OperationRecord;
  capture: EditionRecord; compare: Comparison; rows: EditionRows;
  export: WorkflowExport; export_dataset: DatasetExport; import: ImportedHandover;
  inspect_export: (WorkflowExport & {workflow_revision: Sha256}) | DatasetExport;
}
type ArgumentsTuple<T> = {} extends T ? [args?: T] : [args: T];
export type CoreOperation = keyof CoreArguments;
export type WorkspaceMethods = {[K in CoreOperation]: (...args: ArgumentsTuple<CoreArguments[K]>) => Promise<CoreResults[K]>};
export type WherobotsWorkspace = Omit<WorkspaceMethods, "get"> & {
  readonly directory: string; readonly workspaceId: string | undefined;
  readonly summary: {active_processes: number; closing: boolean};
  /** Drains accepted native child processes; subsequent calls reject. */
  close(): Promise<void>;
  execute<K extends CoreOperation>(operation: K, ...args: ArgumentsTuple<CoreArguments[K]>): Promise<CoreResults[K]>;
  get<K extends RecordKind>(args: {kind: K; id: string}): Promise<RecordByKind[K]>;
  tools(): ToolDefinition[];
  callTool<K extends CoreOperation>(name: `wherobots_${K}`, ...args: ArgumentsTuple<CoreArguments[K]>): Promise<ToolReply<CoreResults[K]>>;
};
export function createWherobotsWorkspace(options: WorkspaceOptions): WherobotsWorkspace;
export const wherobotsToolDefinitions: ToolDefinition[];

export interface MerchantTransport {
  /** Pass the existing opened merchant operator or a compatible authenticated MCP carrier. */
  call(name: string, args?: Record<string, unknown>): Promise<unknown>;
}
export interface MerchantClientOptions {
  merchant: MerchantTransport; workspace: string; workspaceId?: string;
}
export interface MerchantInput extends ContentObject {
  input: string; label: string; kind: "source" | "script" | "intake" | "handover"; filename: string;
}
export interface MerchantStatus {
  configured: boolean;
  workspaces: {workspace: string; label: string; workspace_id: string; connected: boolean; closing: boolean;
    client: {active_processes: number; closing: boolean} | null; inputs: MerchantInput[]}[];
  retained: {activeFileReads: number; snapshotBytes: number; immutableFileBytes: number};
}
export interface MerchantExport {
  schema: "stellar-forge.wherobots-merchant-export.v1";
  export_id: string; workspace_id: string; kind: "workflow" | "dataset";
  request_sha256: Sha256; manifest_sha256: Sha256; created_at: string;
  selection: {export_id: string; expected_revision: Sha256; workflow_id?: string; edition_id?: string; dataset_id?: string};
  native: {[name: string]: unknown}; files: FileDescriptor[];
}
export interface ExportSelection {kind: "export"; export_id: string; file: string;}
export interface ObjectSelection {kind: "object"; object_sha256: Sha256;}
export type MerchantFileArguments = (ExportSelection | ObjectSelection) & {
  expected_sha256: Sha256; read_id?: string; offset?: number; /** 1–196608 bytes */ limit?: number;
};
export type MerchantReleaseArguments = (ExportSelection | ObjectSelection) & {read_id: string};
export interface MerchantFileChunk {
  readId: string; read_id: string;
  file: {name: string; contentType: string; bytes: number; sha256: Sha256};
  offset: number; bytesRead: number; nextOffset: number | null; next_offset: number | null;
  encoding: "base64"; data: string;
}
type SharedMerchantCore = Exclude<CoreOperation, "inspect_export" | "import_source" | "adopt" | "import" | "export" | "export_dataset">;
export type MerchantArguments = Pick<CoreArguments, SharedMerchantCore> & {
  status: Record<string, never>; open: Record<string, never>; close: Record<string, never>;
  inputs: {input?: string};
  import_source: Omit<CoreArguments["import_source"], "path"> & {input: string; expected_sha256: Sha256};
  adopt: Omit<CoreArguments["adopt"], "files"> & {files: Record<string, string>; input_sha256: Sha256};
  import: {input: string; expected_sha256: Sha256};
  export: {workflow_id: string; export_id: string; expected_revision: Sha256};
  export_dataset: {edition_id: string; dataset_id: string; export_id: string; expected_revision: Sha256};
  export_status: {export_id: string}; file: MerchantFileArguments; file_release: MerchantReleaseArguments;
};
export type MerchantResults = Omit<Pick<CoreResults, SharedMerchantCore>, "list"> & {
  status: MerchantStatus; open: WorkspaceState & {workspace: string};
  close: {workspace: string; workspace_id: string; state: "CLOSED"};
  inputs: {workspace: string; inputs: MerchantInput[]} | (MerchantInput & {workspace: string; verified: true});
  list: RecordPage;
  import_source: CoreResults["import_source"]; adopt: WorkflowRecord; import: ImportedHandover;
  export: MerchantExport; export_dataset: MerchantExport; export_status: MerchantExport;
  file: MerchantFileChunk; file_release: {released: true; read_id: string};
};
export type MerchantOperation = keyof MerchantArguments;
export type MerchantMethods = {[K in MerchantOperation]: (...args: ArgumentsTuple<MerchantArguments[K]>) => Promise<MerchantResults[K]>};
export interface ReceivingProgress {
  phase: "RESUMED" | "CHUNK" | "FILE" | "COMPLETE"; workspace: string; workspace_id: string;
  export_id: string; manifest_sha256: Sha256; file: string | null; fileOffset: number | null;
  completedBytes: number; totalBytes: number; chunks: number;
}
export interface ReceiveExportOptions {
  exportId: string; directory: string; expectedManifestSha256?: Sha256;
  chunkBytes?: number; signal?: AbortSignal;
  /** Runs after each durable checkpoint; may abort the supplied signal. */
  onProgress?: (progress: ReceivingProgress) => void | Promise<void>;
}
export interface ReceivedExport {
  schema: "stellar-forge.wherobots-merchant-receiving.v1"; state: "COMPLETE";
  directory: string; filesDirectory: string; workspace: string; workspace_id: string;
  export_id: string; manifest_sha256: Sha256; kind: "workflow" | "dataset";
  files: FileDescriptor[]; bytes: number; manifest: MerchantExport;
  handover?: string; datasetDirectory?: string;
}
export type WherobotsMerchantClient = Omit<MerchantMethods, "get"> & {
  readonly workspace: string; readonly workspaceId: string | undefined;
  call<K extends MerchantOperation>(operation: K | `merchant_wherobots_${K}`,
    ...args: ArgumentsTuple<MerchantArguments[K]>): Promise<MerchantResults[K]>;
  get<K extends RecordKind>(args: {kind: K; id: string}): Promise<RecordByKind[K]>;
  tools(): ToolDefinition[];
  receiveExport(options: ReceiveExportOptions): Promise<ReceivedExport & {chunks: number}>;
};
export function createWherobotsMerchantClient(options: MerchantClientOptions): WherobotsMerchantClient;
export function receiveWherobotsExport(options: MerchantClientOptions & ReceiveExportOptions): Promise<ReceivedExport & {chunks: number}>;
export function inspectReceivedWherobotsExport(directory: string, options?: {
  exportId?: string; workspaceId?: string; expectedManifestSha256?: Sha256;
}): Promise<ReceivedExport>;
export interface ImportReceivedOptions {
  directory: string; workspace: string; workspaceId?: string; python?: string;
  env?: Record<string, string | undefined>;
  /** Initializes this separate local workspace with the original Python initializer. */
  create?: boolean; title?: string;
}
export interface ReopenedReceiving {
  schema: "stellar-forge.wherobots-merchant-import.v1"; state: "REOPENED";
  directory: string; workspace_id: string; source_workspace_id: string;
  export_id: string; manifest_sha256: Sha256; archive_sha256: Sha256; package_id: Sha256;
  workflow: WorkflowRecord; editions: EditionRecord[]; receiving: ImportedHandover; workspace: WorkspaceState;
}
export function importReceivedWherobotsWorkflow(options: ImportReceivedOptions): Promise<ReopenedReceiving>;
export function runWherobotsMerchantClientCli(argv?: string[], output?: {
  stdout?: {write(value: string): unknown}; stderr?: {write(value: string): unknown};
}): Promise<unknown>;
