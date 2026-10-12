/** Original Snowflake merchant actions and complete receiving. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type NativeRecord = { [key: string]: unknown };
export interface WorkspaceSelection { workspace: string }
export interface EditionSelection extends WorkspaceSelection { editionId: string }
export interface OperationSelection extends WorkspaceSelection { operationId: string }
export interface PublicationSelection extends WorkspaceSelection { publicationId: string }
export interface TransferSelection extends WorkspaceSelection { transferId: string }
export interface Paging { offset?: number; limit?: number }
export interface Context extends WorkspaceSelection { workspaceId: string; instanceId: string }
export interface Page<T> { items: T[]; nextOffset: number | null }
export interface Source extends NativeRecord { id: string; createdAt: string; config: { [key: string]: Json } }
export interface Operation extends NativeRecord {
  id: string; status: 'PREPARED' | 'SUBMITTING' | 'FETCHING' | 'RUNNING' | 'CANCELLING' |
    'COMPLETE' | 'FAILED' | 'CANCELLED' | 'REJECTED' | 'INTERRUPTED' | 'AUTH_REQUIRED' | 'RESULT_UNAVAILABLE';
  editionId?: string; statementHandle?: string; nextAttemptAt?: number;
}
export interface Edition extends NativeRecord {
  id: string; sourceId: string; operationId: string; queryName: string; createdAt: string;
  statementHandle: string; rowCount: number; partitionCount: number;
  partitions: Array<{ index: number; rows: number; bytes: number; sha256: string }>;
}
export interface Review extends NativeRecord { decision: 'ACCEPTED' | 'REJECTED'; actor: string; note: string; sequence: number }
export interface Publication extends NativeRecord {
  id: string; editionId: string; status: 'PREPARING' | 'STAGING' | 'PREPARED' | 'INTERRUPTED';
  requestSha256: string; request: NativeRecord; releaseId?: string;
}
export interface Partition { path: string; partition: number; bytes: number; sha256: string }
export interface Transfer extends NativeRecord {
  id: string; status: string; requestId: string; editionId: string | null; received: number;
  partitions: Array<Partition & { received: boolean; receivedBytes: number }>;
}
export interface WorkspaceState extends NativeRecord { id: string; schema: string; revision: number; sourceId: string | null }
export interface FileDescriptor { name: string; bytes: number; sha256: string; contentType: string }
export interface ExportSource {
  editionId: string; sourceId: string; queryName: string; statementHandle: string;
  rowCount: number; partitionCount: number; publicationId: string | null;
}
export interface ExportManifest {
  schema: 'stellar-forge.snowflake-agent-export.v1'; exportId: string; workspace: string; workspaceId: string;
  createdAt: string; selectionSha256: string; source: ExportSource; files: FileDescriptor[];
}
export interface ExportInfo {
  exportId: string; workspace: string; workspaceId: string; manifestSha256: string;
  manifestFile: FileDescriptor; source: ExportSource; files: number; bytes: number;
}
export interface FileChunk {
  exportId: string; manifestSha256: string; readId: string; file: FileDescriptor;
  offset: number; bytesRead: number; nextOffset: number | null; encoding: 'base64'; data: string;
}
export interface ActionArgs {
  workspaces: {};
  open: WorkspaceSelection;
  state: WorkspaceSelection;
  sources: WorkspaceSelection & Paging;
  source: WorkspaceSelection & { sourceId: string };
  save_source: WorkspaceSelection & { config: { [key: string]: Json }; expectedRevision: number };
  operations: WorkspaceSelection & Paging;
  operation: OperationSelection;
  observations: OperationSelection & Paging;
  capture: WorkspaceSelection & { sourceId?: string; queryName: string; arguments?: { [key: string]: Json }; requestId: string };
  resume: OperationSelection;
  cancel: OperationSelection;
  editions: WorkspaceSelection & Paging;
  edition: EditionSelection;
  rows: EditionSelection & Paging;
  compare: WorkspaceSelection & { beforeId: string; afterId: string; sampleLimit?: number };
  review: EditionSelection & { decision: 'ACCEPTED' | 'REJECTED'; actor: string; note: string; comparisonId?: string };
  receive_begin: WorkspaceSelection & { manifest: { [key: string]: Json } };
  receive_status: TransferSelection;
  receive_chunk: TransferSelection & { partition: number; offset: number; data: string; chunkSha256: string };
  receive_repair: TransferSelection & { partition: number };
  receive_commit: TransferSelection;
  publications: WorkspaceSelection & Paging;
  publication: PublicationSelection;
  prepare: EditionSelection & { publicationId: string; draft: { [key: string]: Json }; runtime?: { [key: string]: Json }; label?: string };
  resume_publication: PublicationSelection;
  release_console: WorkspaceSelection;
  export: EditionSelection & { exportId: string; publicationId?: string; cloudDelivery?: { [key: string]: Json } };
  exports: Paging & { workspace?: string };
  manifest: { exportId: string };
  file: { exportId: string; file: string; expectedManifestSha256: string; expectedSha256?: string; readId?: string; offset?: number; limit?: number };
  file_release: { exportId: string; readId: string };
  close: WorkspaceSelection & { instanceId: string };
}
export interface ActionResults {
  workspaces: { workspaces: Array<{ workspace: string; workspaceId: string; label: string; open: boolean; instanceId: string | null; url: string | null; closing: boolean }> };
  open: Context & { url: string; state: WorkspaceState };
  state: Context & { state: WorkspaceState };
  sources: Context & Page<Source>;
  source: Context & { source: Source };
  save_source: Context & { source: Source };
  operations: Context & Page<Operation>;
  operation: Context & { operation: Operation };
  observations: Context & Page<NativeRecord>;
  capture: Context & { operation: Operation };
  resume: Context & { operation: Operation };
  cancel: Context & { operation: Operation };
  editions: Context & Page<Edition>;
  edition: Context & { edition: Edition; review: Review | null };
  rows: Context & { editionId: string; columns: NativeRecord[]; rows: Array<Record<string, string | null>>; offset: number; total: number; nextOffset: number | null };
  compare: Context & { comparison: NativeRecord };
  review: Context & { review: Review };
  receive_begin: Context & { transfer: Transfer };
  receive_status: Context & { transfer: Transfer };
  receive_chunk: Context & { transfer: Transfer };
  receive_repair: Context & { transfer: Transfer };
  receive_commit: Context & { transfer: Transfer };
  publications: Context & Page<Publication>;
  publication: Context & { publication: Publication };
  prepare: Context & { publication: Publication };
  resume_publication: Context & { publication: Publication };
  release_console: Context & { url: string };
  export: ExportInfo;
  exports: Page<ExportInfo> & { total?: number };
  manifest: ExportInfo;
  file: FileChunk;
  file_release: { exportId: string; readId: string; released: boolean };
  close: Context & { state: 'CLOSED' };
}
export type Action = keyof ActionArgs;
export interface RequestOptions { requestSignal?: AbortSignal; timeoutMs?: number }
export interface ClientOptions { url: string; tokenEnv?: string; environment?: Record<string, string | undefined>; signal?: AbortSignal }
type Camel<S extends string> = S extends `${infer First}_${infer Rest}` ? `${First}${Capitalize<Camel<Rest>>}` : S;
type Methods = { [A in Action as Camel<A>]: (args: ActionArgs[A], options?: RequestOptions) => Promise<ActionResults[A]> };
export type PageAction = 'sources' | 'operations' | 'observations' | 'editions' | 'rows' | 'publications' | 'exports';
export type SnowflakeClient = Methods & {
  endpoint: string;
  call<A extends Action>(action: A | `merchant_snowflake_${A}`, args: ActionArgs[A], options?: RequestOptions): Promise<ActionResults[A]>;
  pages<A extends PageAction>(action: A, args: ActionArgs[A], options?: RequestOptions): AsyncGenerator<ActionResults[A]>;
  awaitOperation(selection: OperationSelection, options?: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal }): Promise<ActionResults['operation']>;
};
export const SNOWFLAKE_EXPORT_SCHEMA: 'stellar-forge.snowflake-agent-export.v1';
export const snowflakeActions: Readonly<Record<Action, { name: string; description: string; inputSchema: NativeRecord; annotations: NativeRecord }>>;
export function openSnowflakeClient(options: ClientOptions): Promise<SnowflakeClient>;
export interface DeliveryConnection {
  client?: SnowflakeClient; url?: string; tokenEnv?: string; environment?: Record<string, string | undefined>;
  exportId: string; expectedManifestSha256?: string; signal?: AbortSignal;
}
export interface DeliveryResult {
  schema: 'stellar-forge.snowflake-download-result.v1'; state: 'COMPLETE' | 'REOPENED';
  directory: string; exportId: string; workspace: string; workspaceId: string; original: ExportSource;
  manifestSha256: string; files: number; bytes: number; resumed?: boolean; resumedBytes?: number;
  verifiedFiles?: FileDescriptor[];
}
export function downloadSnowflakeExport(options: DeliveryConnection & {
  directory: string; chunkSize?: number; onProgress?: (progress: NativeRecord) => void | Promise<void>;
}): Promise<DeliveryResult>;
export function inspectSnowflakeExport(options: DeliveryConnection): Promise<{ manifest: ExportManifest; manifestSha256: string }>;
export function reopenSnowflakeExport(options: { directory: string; exportId: string; expectedManifestSha256?: string }): Promise<DeliveryResult>;
export interface UploadProgress {
  workspace: string; workspaceId: string; transferId: string; partition: number; receivedBytes: number;
  partitionBytes: number; resumedBytes: number; uploadedBytes: number; repaired?: boolean;
}
export interface UploadResult {
  schema: 'stellar-forge.snowflake-upload-result.v1'; state: 'RECEIVED'; workspace: string; workspaceId: string;
  transferId: string; editionId: string; operationId: string; partitions: number; resumedBytes: number; uploadedBytes: number; transfer: Transfer;
}
export function uploadSnowflakeOriginals(options: Omit<DeliveryConnection, 'exportId' | 'expectedManifestSha256'> & {
  workspace: string; manifestFile: string; chunkSize?: number; expectedWorkspaceId?: string; repairIncomplete?: boolean;
  onProgress?: (progress: UploadProgress) => void | Promise<void>;
}): Promise<UploadResult>;
