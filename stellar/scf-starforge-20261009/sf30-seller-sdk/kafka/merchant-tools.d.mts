import type { KafkaWorkspaceClient } from './client.mjs';
import type { MerchantTool, MerchantToolFactory } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';

export declare const KAFKA_MERCHANT_CONFIGURATION: 'stellar-forge.kafka-merchant-connection.v1';
export declare const KAFKA_EXPORT_SELECTION: 'stellar-forge.kafka-merchant-export-selection.v1';
export declare const KAFKA_EXPORT_MANIFEST: 'stellar-forge.kafka-merchant-export.v1';
export type KafkaMerchantAlias = string;
export type KafkaMerchantId = string;
export type KafkaNativeArguments<K extends keyof KafkaWorkspaceClient> =
  KafkaWorkspaceClient[K] extends (...args: infer A) => unknown ? A : never;
export type KafkaNativeResult<K extends keyof KafkaWorkspaceClient> =
  KafkaWorkspaceClient[K] extends (...args: any[]) => infer R ? Awaited<R> : never;
export type KafkaMerchantOptions = Pick<
  NonNullable<ConstructorParameters<typeof KafkaWorkspaceClient>[1]>,
  'timeoutMs' | 'maximumJsonBytes' | 'concurrency'
>;
export interface KafkaMerchantInput {
  readonly path: string;
  readonly kind: 'kafka-project' | 'ndjson-project' | 'ndjson';
  readonly sha256: string;
}
export interface KafkaMerchantWorkspace {
  readonly label: string;
  readonly connectionFile: string;
  readonly expectedWorkspaceId?: string;
  readonly expectedBindingSha256?: string;
  readonly inputs: Readonly<Record<string, KafkaMerchantInput>>;
}
export interface KafkaMerchantConfiguration {
  readonly schema: typeof KAFKA_MERCHANT_CONFIGURATION;
  readonly workspaces: Readonly<Record<string, KafkaMerchantWorkspace>>;
}
export interface KafkaMerchantHostConfiguration {
  readonly exportsDirectory: string;
  readonly kafkaWorkspaces?: KafkaMerchantConfiguration | null;
}
export interface KafkaMerchantFile {
  readonly name: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly sha256: string;
}
export type KafkaMerchantExportKind =
  'kafka-project' | 'ndjson-project' | 'dataset' | 'changes' | 'merchant' |
  'message' | 'state' | 'projection' | 'record' | 'query';
export interface KafkaMerchantManifest {
  readonly schema: typeof KAFKA_EXPORT_MANIFEST;
  readonly artifact: KafkaMerchantId;
  readonly workspace: KafkaMerchantAlias;
  readonly operation: string;
  readonly workspaceId: string;
  readonly bindingSha256: string;
  readonly kind: KafkaMerchantExportKind | 'response';
  readonly selectionSha256: string;
  readonly createdAt: string;
  readonly file: KafkaMerchantFile;
}
export interface KafkaManifestFile {
  readonly name: 'manifest.json';
  readonly bytes: number;
  readonly sha256: string;
  readonly encoding: 'base64';
  readonly data: string;
}
export type KafkaMerchantExportResult = KafkaMerchantManifest & { readonly recovered: boolean };
export type KafkaMerchantResponse<T> =
  { workspace: KafkaMerchantAlias; native: T } |
  { workspace: KafkaMerchantAlias; response: KafkaMerchantExportResult & {
      complete: true; encoding: 'retained-native-json';
    } };
export interface KafkaMerchantSummary {
  readonly configured: boolean;
  readonly ownership: 'ORIGINAL_KAFKA_HTTP_WORKSPACE';
  readonly closing: boolean;
  readonly activeOperations: number;
  readonly activeFileReads: number;
  readonly snapshotBytes: number;
  readonly immutableFileBytes: number;
  readonly workspaces: Array<{
    workspace: KafkaMerchantAlias; label: string;
    expectedWorkspaceId: string | null; expectedBindingSha256: string | null;
    inputs: Array<{input: KafkaMerchantAlias; kind: KafkaMerchantInput['kind']; sha256: string}>;
  }>;
}
export interface KafkaMerchantInspection {
  workspace: KafkaMerchantAlias; status: string; workspaceId: string;
  bindingSha256: string; origin: string; pid: number;
  application: {applicationId: string; operationId: string; observedAt: string} | null;
}
export interface KafkaMerchantReadResult {
  workspace: KafkaMerchantAlias; artifact: KafkaMerchantId;
  readId: string; file: KafkaMerchantFile; offset: number; bytesRead: number;
  nextOffset: number | null; encoding: 'base64'; data: string;
}
export interface KafkaMerchantExportPage {
  workspace: KafkaMerchantAlias; total: number; offset: number;
  items: Array<
    ({state: 'COMPLETE'} & KafkaMerchantManifest) |
    {artifact: string; state: 'SELECTING'} |
    {artifact: string; state: 'RECEIVING'; operation: string; kind: string;
      input: Record<string, unknown>; workspaceId: string; bindingSha256: string}
  >;
  nextOffset: number | null;
}
type Workspace = {workspace: KafkaMerchantAlias};
type Pagination = {offset?: number; limit?: number};
export type KafkaMerchantExportInput = Workspace & {operation: string} & (
  {kind: 'kafka-project'; selection: KafkaNativeArguments<'exportKafka'>[0]} |
  {kind: 'ndjson-project' | 'dataset'; selection: {build: string}} |
  {kind: 'changes' | 'message' | 'projection'; selection: {id: string}} |
  {kind: 'merchant'; selection: KafkaNativeArguments<'exportMerchant'>[0]} |
  {kind: 'state'; selection: Record<string, never>} |
  {kind: 'record'; selection: {kind: 'connection' | 'inspection' | 'capture' | 'source' | 'plan'; id: string}} |
  {kind: 'query'; selection: KafkaNativeArguments<'downloadQuery'>[0]}
);
export interface KafkaMerchantToolInputs {
  merchant_kafka_workspaces: Record<string, never>;
  merchant_kafka_inspect: Workspace;
  merchant_kafka_state: Workspace;
  merchant_kafka_configured_topics: Workspace;
  merchant_kafka_read: Workspace & {kind: 'connection' | 'inspection' | 'capture' | 'projection' | 'source' | 'plan'; id: string};
  merchant_kafka_save_connection: Workspace & KafkaNativeArguments<'saveConnection'>[0];
  merchant_kafka_inspect_connection: Workspace & KafkaNativeArguments<'inspectConnection'>[0];
  merchant_kafka_prepare_capture: Workspace & KafkaNativeArguments<'prepareCapture'>[0];
  merchant_kafka_run_capture: Workspace & KafkaNativeArguments<'runCapture'>[0];
  merchant_kafka_resume_capture: Workspace & KafkaNativeArguments<'resumeCapture'>[0];
  merchant_kafka_cancel_capture: Workspace & {capture: string};
  merchant_kafka_wait_capture: Workspace & {capture: string; pollMs?: number; timeoutMs?: number};
  merchant_kafka_messages: Workspace & {capture: string} & Pagination;
  merchant_kafka_message: Workspace & {id: string; operation?: string};
  merchant_kafka_project: Workspace & KafkaNativeArguments<'project'>[0];
  merchant_kafka_save_plan: Workspace & {planJson: string};
  merchant_kafka_build: Workspace & KafkaNativeArguments<'build'>[0];
  merchant_kafka_query: Workspace & KafkaNativeArguments<'query'>[0];
  merchant_kafka_compare: Workspace & KafkaNativeArguments<'compare'>[0];
  merchant_kafka_changes: Workspace & {id: string} & Pagination;
  merchant_kafka_import: Workspace & {input: string; name?: string; label?: string};
  merchant_kafka_export: KafkaMerchantExportInput;
  merchant_kafka_exports: Workspace & Pagination;
  merchant_kafka_manifest: Workspace & {artifact: string; includeFile?: boolean};
  merchant_kafka_file_read: Workspace & {artifact: string; expectedSha256: string; readId?: string; offset?: number; limit?: number};
  merchant_kafka_file_release: Workspace & {readId: string};
}
export interface KafkaMerchantToolResults {
  merchant_kafka_workspaces: KafkaMerchantSummary;
  merchant_kafka_inspect: KafkaMerchantInspection;
  merchant_kafka_state: KafkaMerchantResponse<KafkaNativeResult<'state'>>;
  merchant_kafka_configured_topics: KafkaMerchantResponse<KafkaNativeResult<'configuredTopics'>>;
  merchant_kafka_read: KafkaMerchantResponse<KafkaNativeResult<'connection' | 'inspection' | 'capture' | 'projection' | 'source' | 'plan'>>;
  merchant_kafka_save_connection: KafkaMerchantResponse<KafkaNativeResult<'saveConnection'>>;
  merchant_kafka_inspect_connection: KafkaMerchantResponse<KafkaNativeResult<'inspectConnection'>>;
  merchant_kafka_prepare_capture: KafkaMerchantResponse<KafkaNativeResult<'prepareCapture'>>;
  merchant_kafka_run_capture: KafkaMerchantResponse<KafkaNativeResult<'runCapture'>>;
  merchant_kafka_resume_capture: KafkaMerchantResponse<KafkaNativeResult<'resumeCapture'>>;
  merchant_kafka_cancel_capture: KafkaMerchantResponse<KafkaNativeResult<'cancelCapture'>>;
  merchant_kafka_wait_capture: KafkaMerchantResponse<KafkaNativeResult<'waitForCapture'>>;
  merchant_kafka_messages: KafkaMerchantResponse<KafkaNativeResult<'messages'>>;
  merchant_kafka_message: KafkaMerchantExportResult;
  merchant_kafka_project: KafkaMerchantResponse<KafkaNativeResult<'project'>>;
  merchant_kafka_save_plan: KafkaMerchantResponse<KafkaNativeResult<'savePlan'>>;
  merchant_kafka_build: KafkaMerchantResponse<KafkaNativeResult<'build'>>;
  merchant_kafka_query: KafkaMerchantResponse<KafkaNativeResult<'query'>>;
  merchant_kafka_compare: KafkaMerchantResponse<KafkaNativeResult<'compare'>>;
  merchant_kafka_changes: KafkaMerchantResponse<KafkaNativeResult<'changes'>>;
  merchant_kafka_import: KafkaMerchantResponse<KafkaNativeResult<'importKafka' | 'importNative' | 'addSource'>>;
  merchant_kafka_export: KafkaMerchantExportResult;
  merchant_kafka_exports: KafkaMerchantExportPage;
  merchant_kafka_manifest: KafkaMerchantManifest & {manifestFile?: KafkaManifestFile};
  merchant_kafka_file_read: KafkaMerchantReadResult;
  merchant_kafka_file_release: {workspace: KafkaMerchantAlias; readId: string; state: 'RELEASED'};
}
export declare function readKafkaWorkspaceConfiguration(filename: string): Promise<KafkaMerchantConfiguration>;
export declare function kafkaWorkspaceTools(tool: MerchantToolFactory): MerchantTool[];
export declare class MerchantKafkaWorkspaces {
  constructor(config: KafkaMerchantHostConfiguration, options?: KafkaMerchantOptions);
  get summary(): KafkaMerchantSummary;
  call(name: 'merchant_kafka_workspaces'): Promise<KafkaMerchantSummary>;
  call<K extends keyof KafkaMerchantToolInputs>(name: K, args: KafkaMerchantToolInputs[K]): Promise<KafkaMerchantToolResults[K]>;
  requestClose(): void;
  close(): Promise<void>;
}
