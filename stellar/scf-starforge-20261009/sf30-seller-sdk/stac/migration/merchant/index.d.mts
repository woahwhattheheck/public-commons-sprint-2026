// SPDX-License-Identifier: MIT
import type { FileHandle } from 'node:fs/promises';

export class ExactNumber {
  constructor(lexeme: string);
  readonly lexeme: string;
  toString(): string;
  toJSON(): string;
  [Symbol.toPrimitive](hint: string): string;
}
export type ExactJSON = null | boolean | string | number | bigint | ExactNumber | ExactJSON[] | { [key: string]: ExactJSON };
export type ExactJSONObject = { [key: string]: ExactJSON };
export type MigrationValue = null | boolean | string | number | { $number: string } | MigrationValue[] | { [key: string]: MigrationValue };
export function parseExactJSON(text: string): ExactJSON;
export function stringifyExactJSON(value: ExactJSON | unknown, space?: number): string;
export function migrationValue(value: ExactJSON | unknown): MigrationValue;
export function migrationFailure(code: string, message: string, details?: unknown): Error & { code: string; details?: unknown };
export function migrationSha256(bytes: string | Uint8Array): string;
export function migrationIdentifier(value: string, label?: string): string;
export function migrationRelativeFile(value: string): string;
export function migrationPrivateDirectory(directory: string, options?: { create?: boolean }): Promise<string>;
export function retainMigrationBytes(path: string, body: string | Uint8Array, options?: { replace?: boolean }): Promise<void>;
export interface MigrationFileDescriptor { name: string; bytes: number; sha256: string; }
export interface MigrationDeclaredFile { path: string; bytes: number; sha256: string; }
export interface MigrationOpenedFile extends MigrationFileDescriptor {
  readonlyFileHandle: FileHandle;
  type: 'application/octet-stream';
}
/** The returned descriptor is owned by the caller until closed or transferred. */
export function openMigrationFile(path: string, expected?: { bytes?: number; sha256?: string }, name?: string): Promise<MigrationOpenedFile>;

export const MIGRATION_CONNECTION_SCHEMA: 'starforge.migration-merchant-connection.v1';
export const MIGRATION_EXPORT_SCHEMA: 'starforge.migration-merchant-export.v1';
export const MIGRATION_EXPORT_MANIFEST: 'migration-export.json';
export const MIGRATION_REQUEST_SCHEMA: 'starforge.migration-native-request.v1';
export const MIGRATION_TOOL_PREFIX: 'merchant_migration_';
export const MAX_MIGRATION_REQUEST_BYTES: number;
export const MAX_MIGRATION_FILE_BYTES: number;

export type MigrationEnvironment = Record<string, string | undefined>;
export type MigrationSourceInput =
  | { kind: 'selection'; file: string; sourceRoot: string; bytes: number; sha256: string }
  | { kind: 'capture'; directory: string; sha256: string }
  | { kind: 'handover'; file: string; bytes: number; sha256: string; workspaceId: string };
export interface MigrationDestination { directory: string; workspaceId: string; }
export interface MigrationWorkspaceSelection {
  workspaceId: string;
  directory: string;
  runtimeDirectory: string;
  python: string;
  vectorPython?: string;
  qgisPython?: string;
  pythonPath?: string[];
  environment?: Record<string, string>;
  inlineResultBytes?: number;
  inputs?: Record<string, MigrationSourceInput>;
  destinations?: Record<string, MigrationDestination>;
}
export interface MigrationWorkspaceConfiguration extends MigrationWorkspaceSelection {
  alias: string;
  vectorPython: string;
  qgisPython: string;
  pythonPath: string[];
  environment: Record<string, string>;
  inlineResultBytes: number;
  inputs: Record<string, MigrationSourceInput>;
  destinations: Record<string, MigrationDestination>;
}
export interface MigrationConnection {
  schema: typeof MIGRATION_CONNECTION_SCHEMA;
  name?: string;
  workspaces: Record<string, MigrationWorkspaceSelection>;
}
export interface NormalizedMigrationConnection {
  schema: typeof MIGRATION_CONNECTION_SCHEMA;
  name: string;
  workspaces: Record<string, MigrationWorkspaceConfiguration>;
}
export function validateMigrationWorkspaceConfiguration(value: MigrationConnection | unknown, options?: { baseDirectory?: string }): NormalizedMigrationConnection;
export function readMigrationWorkspaceConfiguration(file: string): Promise<NormalizedMigrationConnection>;

export type MigrationRecordKind = 'captures' | 'plans' | 'editions' | 'projectDeliveries' | 'reviews' | 'inputs' | 'software' | 'comparisons';
export interface MigrationWorkspaceSummary {
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  schema: string;
  counts: Record<MigrationRecordKind, number>;
  nativeProjectCount: number;
  nativeSourceCount: number;
  nativeSource: MigrationValue;
}
export interface MigrationPage<T = MigrationValue> {
  offset: number; limit: number; total: number; rows: T[]; hasMore: boolean;
  workspaceId?: string; revision?: number; kind?: string;
}
export type MigrationTaskState = 'PREPARED' | 'STARTING' | 'RUNNING' | 'FINISHING' | 'COMPLETE' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED' | 'RESULT_RETAINED';
export interface MigrationNativeTask<T = MigrationValue> {
  workspaceId: string;
  requestId: string;
  command: MigrationNativeCommand;
  state: MigrationTaskState;
  attempt?: number;
  startedAt?: string | null;
  resultState?: 'COMPLETE' | 'FAILED' | 'RESULT_RETAINED';
  resultFile?: MigrationFileDescriptor;
  logFile?: MigrationFileDescriptor;
  resultJson?: string;
  value?: T;
  error?: MigrationValue;
}
export interface MigrationNativeOptions { requestId?: string; wait?: boolean; signal?: AbortSignal; }
export interface MigrationRevisionInput { revision: number; requestId: string; actor: string; }
export interface MigrationPaging { offset?: number; limit?: number; }
export interface MigrationNativeArguments {
  state: Record<string, never>;
  records: MigrationPaging & { kind: MigrationRecordKind };
  document: { kind: string; id: string };
  draft: { captureId: string; predecessorPlanId?: string };
  'source-rows': MigrationPaging & { captureId: string; layerId: string };
  issues: MigrationPaging & { planId: string; layerId?: string; kind?: string };
  'comparison-rows': MigrationPaging & { comparisonId: string; layerId?: string; status?: string };
  history: MigrationPaging;
  operation: { requestId: string };
  files: MigrationPaging & { path?: string; query?: string };
  'native-info': Record<string, never>;
  'qgis-info': Record<string, never>;
  verify: Record<string, never>;
  'native-reopen': Record<string, never>;
  capture: MigrationRevisionInput & { selection: ExactJSONObject; sourceRoot: string; originalBase64?: string };
  'receive-capture': MigrationRevisionInput & { directory: string; expectedManifestSha256: string };
  'save-plan': MigrationRevisionInput & { plan: ExactJSONObject; originalBase64?: string };
  'review-plan': MigrationRevisionInput & { planId: string; outcome: 'accepted' | 'changes-requested'; note: string };
  'compare-captures': MigrationRevisionInput & { beforeCaptureId: string; afterCaptureId: string };
  'build-edition': MigrationRevisionInput & { planId: string };
  'build-projects': MigrationRevisionInput & { editionId: string };
  export: MigrationRevisionInput & { expectedSha256?: string };
  receive: { archive: string; destination: string; expectedSha256: string; expectedWorkspaceId?: string; nativeReopen?: 'auto' | 'required' | 'skip' };
  'cartography.inventory': Record<string, never>;
  'cartography.preview': { spec: ExactJSONObject };
  'cartography.save-plan': MigrationRevisionInput & { spec: ExactJSONObject };
  'cartography.publish': MigrationRevisionInput & { planId: string };
  'cartography.operation': { requestId: string };
  'cartography.publication': { publicationId: string };
  'cartography.download': { publicationId: string; kind: 'qgz' | 'qpt' | 'pdf' | 'png' | 'plan' | 'receipt' };
  'cartography.reopen': { publicationId?: string };
}
export type MigrationNativeCommand = keyof MigrationNativeArguments;
export type MigrationNativeResult<C extends MigrationNativeCommand> = C extends 'state' ? MigrationWorkspaceSummary :
  C extends 'records' | 'history' ? MigrationPage : MigrationValue;
type NativeParameters<C extends MigrationNativeCommand> = {} extends MigrationNativeArguments[C] ?
  [payload?: MigrationNativeArguments[C], options?: MigrationNativeOptions] :
  [payload: MigrationNativeArguments[C], options?: MigrationNativeOptions];

export class MigrationWorkspaceClient {
  constructor(configuration: MigrationWorkspaceConfiguration, options?: { environment?: MigrationEnvironment });
  readonly configuration: MigrationWorkspaceConfiguration;
  readonly workspaceId: string;
  readonly directory: string;
  readonly closed: boolean;
  prepare(): Promise<this>;
  open(): Promise<MigrationNativeTask<MigrationWorkspaceSummary>>;
  execute<C extends MigrationNativeCommand>(command: C, ...parameters: NativeParameters<C>): Promise<MigrationNativeTask<MigrationNativeResult<C>>>;
  inspect(requestId: string): Promise<MigrationNativeTask>;
  cancel(requestId: string): Promise<MigrationNativeTask>;
  nativeFile(path: string, expectedSha256: string): Promise<MigrationOpenedFile>;
  taskFile(requestId: string, kind?: 'result' | 'log', attempt?: number): Promise<MigrationOpenedFile>;
  requestClose(): void;
  close(): Promise<void>;
}
export function openMigrationWorkspace(configuration: MigrationWorkspaceConfiguration, options?: { environment?: MigrationEnvironment }): Promise<MigrationWorkspaceClient>;

export interface MigrationExportManifest {
  schema: typeof MIGRATION_EXPORT_SCHEMA;
  exportId: string;
  workspaceId: string;
  revision: number;
  requestId: string;
  actor: string;
  native: { packageManifestSha256: string; fileCount: number; totalDecodedBytes: number };
  files: [MigrationFileDescriptor & { name: 'handover.zip' }];
}
export function parseMigrationExportManifest(bytes: string | Uint8Array, exportId: string): MigrationExportManifest;
export interface WorkspaceSelection { workspace: string; }
export interface MigrationInputSummary { input: string; kind: MigrationSourceInput['kind']; sha256: string; bytes?: number; workspaceId?: string; }
export interface MigrationMerchantStatus {
  schema: 'starforge.migration-workspaces-status.v1';
  configured: boolean; connected: string[]; pending: number; closing: boolean;
  activeFileReads?: number; pendingFileCloses?: number; snapshotBytes?: number; immutableFileBytes?: number;
  workspaces: Array<{ workspace: string; workspaceId: string; connected: boolean;
    inputs: MigrationInputSummary[]; destinations: Array<{ destination: string; workspaceId: string }> }>;
}
export interface MigrationFileChunk {
  readId: string;
  file: MigrationFileDescriptor & { contentType: string };
  offset: number;
  bytesRead: number;
  nextOffset: number | null;
  encoding: 'base64';
  data: string;
}
export interface MigrationReleasedFile {
  state: 'RELEASED'; workspace: string; readId: string;
  path?: string; requestId?: string; kind?: 'result' | 'log'; exportId?: string;
}
export interface MigrationToolArguments {
  "merchant_migration_status": {
    workspace?: string;
  };
  "merchant_migration_open": {
    workspace: string;
  };
  "merchant_migration_inputs": {
    workspace: string;
    input?: string;
  };
  "merchant_migration_state": {
    workspace: string;
  };
  "merchant_migration_records": {
    workspace: string;
    kind: "captures" | "plans" | "editions" | "projectDeliveries" | "reviews" | "inputs" | "software" | "comparisons";
    offset?: number;
    limit?: number;
  };
  "merchant_migration_document": {
    workspace: string;
    kind: string;
    id: string;
  };
  "merchant_migration_draft": {
    workspace: string;
    captureId: string;
    predecessorPlanId?: string;
  };
  "merchant_migration_source_rows": {
    workspace: string;
    captureId: string;
    layerId: string;
    offset?: number;
    limit?: number;
  };
  "merchant_migration_issues": {
    workspace: string;
    planId: string;
    layerId?: string;
    kind?: string;
    offset?: number;
    limit?: number;
  };
  "merchant_migration_comparison_rows": {
    workspace: string;
    comparisonId: string;
    layerId?: string;
    status?: string;
    offset?: number;
    limit?: number;
  };
  "merchant_migration_history": {
    workspace: string;
    offset?: number;
    limit?: number;
  };
  "merchant_migration_operation": {
    workspace: string;
    requestId: string;
  };
  "merchant_migration_task": {
    workspace: string;
    requestId: string;
  };
  "merchant_migration_cancel": {
    workspace: string;
    requestId: string;
  };
  "merchant_migration_capture": {
    workspace: string;
    input: string;
    expectedSha256: string;
    revision: number;
    requestId: string;
    actor: string;
    wait?: boolean;
  };
  "merchant_migration_receive_capture": {
    workspace: string;
    input: string;
    expectedSha256: string;
    revision: number;
    requestId: string;
    actor: string;
    wait?: boolean;
  };
  "merchant_migration_save_plan": {
    workspace: string;
    planJson: string;
    revision: number;
    requestId: string;
    actor: string;
    wait?: boolean;
  };
  "merchant_migration_review_plan": {
    workspace: string;
    planId: string;
    outcome: "accepted" | "changes-requested";
    note: string;
    revision: number;
    requestId: string;
    actor: string;
    wait?: boolean;
  };
  "merchant_migration_compare_captures": {
    workspace: string;
    beforeCaptureId: string;
    afterCaptureId: string;
    revision: number;
    requestId: string;
    actor: string;
    wait?: boolean;
  };
  "merchant_migration_build_edition": {
    workspace: string;
    planId: string;
    revision: number;
    requestId: string;
    actor: string;
    wait?: boolean;
  };
  "merchant_migration_build_projects": {
    workspace: string;
    editionId: string;
    revision: number;
    requestId: string;
    actor: string;
    wait?: boolean;
  };
  "merchant_migration_verify": {
    workspace: string;
    wait?: boolean;
  };
  "merchant_migration_native_info": {
    workspace: string;
  };
  "merchant_migration_qgis_info": {
    workspace: string;
  };
  "merchant_migration_native_reopen": {
    workspace: string;
    wait?: boolean;
  };
  "merchant_migration_files": {
    workspace: string;
    path?: string;
    query?: string;
    offset?: number;
    limit?: number;
  };
  "merchant_migration_file": {
    workspace: string;
    path: string;
    expectedSha256: string;
    readId?: string;
    offset?: number;
    limit?: number;
  };
  "merchant_migration_file_release": {
    workspace: string;
    path: string;
    readId: string;
  };
  "merchant_migration_task_file": {
    workspace: string;
    requestId: string;
    attempt?: number;
    kind?: "result" | "log";
    expectedSha256: string;
    readId?: string;
    offset?: number;
    limit?: number;
  };
  "merchant_migration_task_file_release": {
    workspace: string;
    requestId: string;
    attempt?: number;
    kind?: "result" | "log";
    readId: string;
  };
  "merchant_migration_export": {
    workspace: string;
    exportId: string;
    revision: number;
    requestId: string;
    actor: string;
    wait?: boolean;
  };
  "merchant_migration_export_manifest": {
    workspace: string;
    exportId: string;
  };
  "merchant_migration_export_file": {
    workspace: string;
    exportId: string;
    file: string;
    expectedManifestSha256: string;
    expectedSha256: string;
    readId?: string;
    offset?: number;
    limit?: number;
  };
  "merchant_migration_export_file_release": {
    workspace: string;
    exportId: string;
    readId: string;
  };
  "merchant_migration_receive": {
    workspace: string;
    input: string;
    destination: string;
    expectedSha256: string;
    nativeReopen?: "auto" | "required" | "skip";
    requestId: string;
    wait?: boolean;
  };
  "merchant_migration_cartography_inventory": {
    workspace: string;
  };
  "merchant_migration_cartography_preview": {
    workspace: string;
    specJson: string;
  };
  "merchant_migration_cartography_save_plan": {
    workspace: string;
    specJson: string;
    revision: number;
    requestId: string;
    actor: string;
    wait?: boolean;
  };
  "merchant_migration_cartography_publish": {
    workspace: string;
    planId: string;
    revision: number;
    requestId: string;
    actor: string;
    wait?: boolean;
  };
  "merchant_migration_cartography_operation": {
    workspace: string;
    requestId: string;
  };
  "merchant_migration_cartography_publication": {
    workspace: string;
    publicationId: string;
  };
  "merchant_migration_cartography_download": {
    workspace: string;
    publicationId: string;
    kind: "qgz" | "qpt" | "pdf" | "png" | "plan" | "receipt";
  };
  "merchant_migration_cartography_reopen": {
    workspace: string;
    publicationId?: string;
    wait?: boolean;
  };
  "merchant_migration_close": {
    workspace: string;
  };
}
export interface MigrationToolResults {
  "merchant_migration_status": MigrationMerchantStatus;
  "merchant_migration_open": MigrationNativeTask<MigrationWorkspaceSummary> & WorkspaceSelection;
  "merchant_migration_inputs": { workspace: string; workspaceId: string; inputs: MigrationInputSummary[] };
  "merchant_migration_state": MigrationNativeTask<MigrationWorkspaceSummary> & WorkspaceSelection;
  "merchant_migration_records": MigrationNativeTask<MigrationPage<MigrationValue>> & WorkspaceSelection;
  "merchant_migration_document": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_draft": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_source_rows": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_issues": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_comparison_rows": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_history": MigrationNativeTask<MigrationPage<MigrationValue>> & WorkspaceSelection;
  "merchant_migration_operation": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_task": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_cancel": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_capture": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_receive_capture": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_save_plan": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_review_plan": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_compare_captures": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_build_edition": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_build_projects": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_verify": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_native_info": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_qgis_info": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_native_reopen": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_files": MigrationNativeTask<MigrationPage<MigrationDeclaredFile> | MigrationDeclaredFile> & WorkspaceSelection;
  "merchant_migration_file": MigrationFileChunk;
  "merchant_migration_file_release": MigrationReleasedFile;
  "merchant_migration_task_file": MigrationFileChunk;
  "merchant_migration_task_file_release": MigrationReleasedFile;
  "merchant_migration_export": MigrationNativeTask & WorkspaceSelection & { exportId: string };
  "merchant_migration_export_manifest": { state: 'MANIFEST_RETAINED'; workspace: string; workspaceId: string; exportId: string; manifestFile: MigrationFileDescriptor };
  "merchant_migration_export_file": MigrationFileChunk & { exportId: string; manifestSha256: string };
  "merchant_migration_export_file_release": MigrationReleasedFile;
  "merchant_migration_receive": MigrationNativeTask & WorkspaceSelection & { input: string; destination: string; expectedWorkspaceId: string };
  "merchant_migration_cartography_inventory": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_cartography_preview": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_cartography_save_plan": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_cartography_publish": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_cartography_operation": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_cartography_publication": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_cartography_download": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_cartography_reopen": MigrationNativeTask & WorkspaceSelection;
  "merchant_migration_close": { state: 'CLOSED'; workspace: string; workspaceId: string };
}
export type MigrationToolName = keyof MigrationToolArguments;
export type MigrationAction = MigrationToolName extends `merchant_migration_${infer A}` ? A : never;
type FullTool<N extends MigrationAction | MigrationToolName> = N extends MigrationToolName ? N : `merchant_migration_${N}` & MigrationToolName;
type ScopedArguments<N extends MigrationAction | MigrationToolName> = Omit<MigrationToolArguments[FullTool<N>], 'workspace'> & { workspace?: string };
type ScopedParameters<N extends MigrationAction | MigrationToolName> = {} extends ScopedArguments<N> ?
  [args?: ScopedArguments<N>, options?: MerchantRequestOptions] :
  [args: ScopedArguments<N>, options?: MerchantRequestOptions];
export interface MigrationToolProperty {
  type: 'string' | 'integer' | 'boolean';
  description?: string; minimum?: number; maximum?: number; pattern?: string; enum?: string[];
}
export interface MigrationToolDefinition {
  name: MigrationToolName; description: string;
  properties: Record<string, MigrationToolProperty>; required: string[];
}
export const migrationToolDefinitions: readonly Readonly<MigrationToolDefinition>[];
export function migrationWorkspaceTools<T>(factory: (
  name: MigrationToolName, description: string, properties: Record<string, MigrationToolProperty>, required: string[]
) => T): T[];
export interface MigrationMerchantConfiguration {
  migrationWorkspaces?: NormalizedMigrationConnection | null;
}
export class MerchantMigrationWorkspaces {
  constructor(config: MigrationMerchantConfiguration, options?: { environment?: MigrationEnvironment });
  readonly summary: { configured: boolean; connected: string[]; pending: number; closing: boolean;
    activeFileReads?: number; pendingFileCloses?: number; snapshotBytes?: number; immutableFileBytes?: number };
  call<N extends MigrationToolName>(name: N, args: MigrationToolArguments[N]): Promise<MigrationToolResults[N]>;
  requestClose(): void;
  close(): Promise<void>;
}
export interface MerchantRequestOptions { requestSignal?: AbortSignal | null; signal?: AbortSignal; timeoutMs?: number; }
export interface OriginalMerchant {
  call(name: string, args?: Record<string, unknown>, options?: MerchantRequestOptions): Promise<unknown>;
}
export type MigrationMerchantConnection = {
  workspace: string; workspaceId: string; tokenEnv?: string; environment?: MigrationEnvironment; signal?: AbortSignal;
} & (
  | { merchant: OriginalMerchant; endpoint: string; url?: never }
  | { url: string; merchant?: never; endpoint?: never }
);
export interface MigrationDownloadProgress {
  exportId: string; file: string; bytes: number; total: number; state: 'DOWNLOADING';
}
export interface MigrationDownloadOptions {
  exportId: string; directory: string; expectedManifestSha256?: string;
  chunkSize?: number; onProgress?: (value: MigrationDownloadProgress) => void | Promise<void>; signal?: AbortSignal;
}
export interface MigrationDownloadedExport {
  schema: 'starforge.migration-downloaded-export.v1'; state: 'COMPLETE'; directory: string;
  workspaceId: string; revision: number; requestId: string; exportId: string; manifestSha256: string;
  resumed: boolean; resumedBytes: number; files: number; bytes: number;
}
export interface MigrationMerchantClient {
  readonly workspace: string; readonly workspaceId: string; readonly endpoint: string;
  call<N extends MigrationAction | MigrationToolName>(action: N, ...parameters: ScopedParameters<N>): Promise<MigrationToolResults[FullTool<N>]>;
  inspectExport(options: { exportId: string; signal?: AbortSignal }): Promise<{ manifest: MigrationExportManifest; manifestSha256: string }>;
  downloadExport(options: MigrationDownloadOptions): Promise<MigrationDownloadedExport>;
  downloadTaskFile(options: MigrationTaskDownloadOptions): Promise<MigrationDownloadedTask>;
}
export function createMigrationMerchantClient(options: MigrationMerchantConnection): Promise<MigrationMerchantClient>;
export function inspectMigrationExport(options: MigrationMerchantConnection & { exportId: string }): Promise<{ manifest: MigrationExportManifest; manifestSha256: string }>;
export function downloadMigrationExport(options: MigrationMerchantConnection & MigrationDownloadOptions): Promise<MigrationDownloadedExport>;
export interface MigrationTaskDownloadOptions {
  requestId: string; kind?: 'result' | 'log'; directory: string; chunkSize?: number;
  onProgress?: (value: MigrationDownloadProgress) => void | Promise<void>; signal?: AbortSignal;
}
export interface MigrationDownloadedTask {
  schema: 'starforge.migration-downloaded-task.v1'; state: 'COMPLETE'; directory: string;
  workspaceId: string; requestId: string; kind: 'result' | 'log';
  exportId: string; manifestSha256: string; resumed: boolean; resumedBytes: number; files: number; bytes: number;
}
export function downloadMigrationTaskFile(options: MigrationMerchantConnection & MigrationTaskDownloadOptions): Promise<MigrationDownloadedTask>;
export interface InspectReceivedMigrationOptions {
  directory: string; exportId?: string; expectedManifestSha256?: string; signal?: AbortSignal;
}
export interface ReceivedMigrationExport {
  schema: 'starforge.migration-received-export.v1'; state: 'VERIFIED'; directory: string;
  manifest: MigrationExportManifest; manifestSha256: string; archive: { path: string; bytes: number; sha256: string };
}
export function inspectReceivedMigrationExport(options: InspectReceivedMigrationOptions): Promise<ReceivedMigrationExport>;
export interface ReceiveMigrationOptions extends InspectReceivedMigrationOptions {
  destination: string; runtimeDirectory: string; python: string; pythonPath?: string[];
  nativeEnvironment?: Record<string, string>; environment?: MigrationEnvironment;
  requestId: string; nativeReopen?: 'auto' | 'required' | 'skip';
}
export interface MigrationConsumerReceiving {
  schema: 'starforge.migration-consumer-receiving.v1'; state: 'COMPLETE'; requestId: string;
  workspaceId: string; exportId: string; revision: number; manifestSha256: string;
  archive: { bytes: number; sha256: string }; nativeReopen: 'auto' | 'required' | 'skip';
  receiving: MigrationNativeTask; workspace: MigrationNativeTask<MigrationWorkspaceSummary>; verification: MigrationNativeTask;
  locations: { directory: string; destination: string; runtimeDirectory: string; result: string };
}
export function receiveMigrationExport(options: ReceiveMigrationOptions): Promise<MigrationConsumerReceiving>;
export function initializeMigrationWorkspaceMerchant(options: { directory: string; connection: string; name?: string }): Promise<{
  schema: 'stellar-forge.merchant-mcp.v1'; state: 'INITIALIZED'; configuration: string;
  migrationWorkspacesConfigured: true; hostOwnership: 'ORIGINAL_MIGRATION_WORKSPACE';
  workspaces: Array<{ workspace: string; workspaceId: string }>;
}>;
export interface MigrationCliOutput { write(value: string): unknown; }
export function runMigrationWorkspaceCli(argv?: string[], options?: {
  stdout?: MigrationCliOutput; stderr?: MigrationCliOutput; environment?: MigrationEnvironment;
}): Promise<number>;
