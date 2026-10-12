// MIT. Native GridFabric inputs, original response envelopes and complete file transfer.
export type JsonValue = null | boolean | number | string | JsonValue[] | { [name: string]: JsonValue };
export type JsonObject = { [name: string]: JsonValue };
export type Sha256 = string;
export type RequestId = string;
export type NativeFileId = `file_${string}` | `export_${string}`;
export type GridFabricTable =
  | 'instances' | 'instance_editions' | 'sources' | 'source_rows' | 'source_issues' | 'mappings'
  | 'callbacks' | 'callback_deliveries' | 'events' | 'event_revisions' | 'distributions'
  | 'opt_decisions' | 'device_actions' | 'reports' | 'report_rows'
  | 'management_operations' | 'management_receipts' | 'operations';
export type GridFabricHostTable = 'host_files' | 'host_dispatches';
export type GridFabricAction =
  | 'configure_instance' | 'import_source' | 'save_mapping' | 'activate_mapping' | 'record_opt_decision'
  | 'build_report' | 'reconcile_distribution' | 'prepare_management' | 'begin_management'
  | 'finish_management' | 'reconcile_management' | 'begin_device_action' | 'finish_device_action'
  | 'reconcile_device_action' | 'recover_dispatches' | 'project_event_history' | 'resume_event_callback';
export interface RequestOptions { signal?: AbortSignal }
export interface NativePageInput<C = GridFabricTable> {
  collection: C; offset?: number; limit?: number; scope?: string; tag?: string;
  gte?: string; lt?: string; order?: 'asc' | 'desc';
}
export interface NativePage<C = GridFabricTable | GridFabricHostTable> {
  collection: C; total: number; offset: number; limit: number;
  next_offset: number | null; rows: JsonObject[];
}
export interface NativeSource {
  schema: 'stellar-forge.gridfabric-native-source.v1'; node: string; sha256: Sha256;
  modules: Array<{ path: string; bytes: number; sha256: Sha256 }>;
}
export interface GridFabricIdentity {
  readonly workspace_id: string; readonly workspace_directory: string;
  readonly source_sha256: Sha256; readonly origin: string; readonly revision: number;
  readonly native_source: NativeSource; readonly raw_launch: string;
}
export interface GridFabricState {
  schema: 'stellar-forge.gridfabric-plaid.workspace.v1'; workspace_id: string;
  revision: number; name: string; collections: Record<GridFabricTable, number>;
  [field: string]: unknown;
}
export interface NativeReply<T = JsonObject> {
  value: T; raw_text: string; http_status: number; workspace_id: string;
  headers: Record<string, string | string[] | undefined>; raw_headers: string[];
}
export interface OperationEnvelope<T = JsonObject> {
  /** Retain this exact canonical UUID before requesting an action. */
  request_id: RequestId;
  /** Read and review the original workspace revision. */
  expected_revision: number;
  input: T;
}
export type TargetCategory = 'venId' | 'resourceId' | 'groupId' | 'partyId';
export interface DeviceBinding {
  device_id: string; adapter_id?: string;
  target_ids?: Partial<Record<TargetCategory, string[]>>;
}
export interface CallbackBinding {
  evidence_source_id: string; reviewer: string;
  events_pointer?: string; event_pointer?: string; event_id_pointer?: string; revision_pointer?: string;
  targets_pointer?: string; interval_id_pointer?: string; signal_pointer?: string; interval_start_pointer?: string;
  distribution_id_pointer?: string; distribution_complete_pointer?: string; opt_type_pointer?: string;
  response_template?: JsonObject; target_match?: 'any' | 'all';
  target_bindings?: Array<{ pointer: string; category: TargetCategory }>;
}
export interface ConfigureInstanceInput {
  instance_id: string; name: string; management_url: string;
  management_headers_env?: Record<string,string>; callback_headers_env?: Record<string,string>;
  callback_basic_user_env?: string | null; callback_basic_password_env?: string | null;
  device_adapter_url?: string | null; device_adapter_headers_env?: Record<string,string>;
  plugin_api_version?: string; plugin_version?: string; schema_source_id?: string;
  bindings?: Record<string,CallbackBinding>; devices?: DeviceBinding[];
}
export interface ParsedSourceProfile {
  fields: Record<string,string | number | null>;
  constants: JsonObject;
  [field: string]: unknown;
}
export type ImportSourceInput = {
  file_sha256: Sha256; name: string; provenance: JsonObject; corrects_source_id?: string;
} & ({ format: 'original'; profile?: null } | { format: 'csv' | 'json'; profile: ParsedSourceProfile });
export interface MappingEntry {
  r_id: string; report_specifier_id: string; device_id: string; channel: string;
  kind: 'energy' | 'power' | 'status'; unit: 'Wh' | 'kWh' | 'W' | 'kW' | 'status';
  time_basis: 'start' | 'end' | 'instant'; period_seconds: number; decimal_places: number;
  aggregation: string; allow_resample: boolean; source_ids: string[];
  resampled_data_quality?: string; default_data_quality?: string;
  [field: string]: unknown;
}
export interface SaveMappingInput {
  instance_id: string; name: string; reviewer: string; entries: MappingEntry[];
  registration_response: JsonObject; source_evidence?: string[];
}
export interface ReportQuery {
  startTimet: number; endTimet: number; granularityInSeconds: number;
  rIds: string[]; reportSpecifierId?: string; [field: string]: unknown;
}
export interface ReviewedInput { reviewer: string; source_evidence: string[] }
export interface ManagementPreparation extends Partial<ReviewedInput> {
  instance_id: string; reviewer: string; namespace: string; parameters: JsonObject;
}
export interface OriginalDispatchReceipt {
  attempt_id: string; body_utf8: string; http_status?: number;
  headers?: JsonObject; transport_error?: JsonValue;
}
export interface DispatchReconciliation extends ReviewedInput {
  reason: string; disposition: 'complete' | 'not_applied' | 'still_unknown';
}
export interface ResumeEventCallbackInput extends ReviewedInput {
  callback_id: string; event_id: string; expected_event_revision: JsonValue;
  expected_interval_id?: JsonValue; expected_effective_start_timet?: JsonValue;
}
export interface GridFabricInputMap {
  launch: Record<string,never>;
  state: Record<string,never>;
  source: Record<string,never>;
  contracts: Record<string,never>;
  page: NativePageInput;
  host_page: NativePageInput<GridFabricHostTable>;
  detail: { collection: GridFabricTable; id: string };
  operation: { request_id: RequestId };
  exports: Record<string,never>;
  restore_status: { name: string; sha256?: Sha256 };
  configure_instance: OperationEnvelope<ConfigureInstanceInput>;
  import_source: OperationEnvelope<ImportSourceInput>;
  save_mapping: OperationEnvelope<SaveMappingInput>;
  activate_mapping: OperationEnvelope<{ mapping_id: string; reviewer: string }>;
  record_opt_decision: OperationEnvelope<ReviewedInput & {
    instance_id: string; event_id: string; opt_type: 'optIn' | 'optOut'; opt_reason: string; resource_id?: string;
  }>;
  build_report: OperationEnvelope<{ instance_id: string; query: ReportQuery }>;
  reconcile_distribution: OperationEnvelope<ReviewedInput & { distribution_id: string; complete: true; event_ids: string[] }>;
  prepare_management: OperationEnvelope<ManagementPreparation>;
  begin_management: OperationEnvelope<{ operation_id: string }>;
  finish_management: OperationEnvelope<OriginalDispatchReceipt & { operation_id: string }>;
  reconcile_management: OperationEnvelope<DispatchReconciliation & { operation_id: string }>;
  begin_device_action: OperationEnvelope<{ device_action_id: string }>;
  finish_device_action: OperationEnvelope<OriginalDispatchReceipt & { device_action_id: string }>;
  reconcile_device_action: OperationEnvelope<DispatchReconciliation & { device_action_id: string }>;
  recover_dispatches: OperationEnvelope<{ reviewer: string; reason: string }>;
  project_event_history: OperationEnvelope<ReviewedInput & { instance_id: string }>;
  resume_event_callback: OperationEnvelope<ResumeEventCallbackInput>;
  dispatch_management: OperationEnvelope<{ operation_id: string }>;
  dispatch_device: OperationEnvelope<{ device_action_id: string }>;
  export: { request_id: RequestId; expected_revision: number };
}
export type GridFabricOperation = keyof GridFabricInputMap;
export type GridFabricResult<K extends GridFabricOperation> =
  K extends 'state' ? GridFabricState :
  K extends 'source' ? NativeSource :
  K extends 'page' ? NativePage<GridFabricTable> :
  K extends 'host_page' ? NativePage<GridFabricHostTable> :
  K extends 'detail' ? { collection: GridFabricTable; id: string; record: JsonObject } :
  K extends 'exports' ? { items: JsonObject[] } : JsonObject;
export interface GridFabricFileInfo {
  schema: 'stellar-forge.gridfabric-native-file.v1'; workspace_id: string;
  file_id: NativeFileId; native_file_id: string; kind: 'file' | 'export';
  name: string; mime_type: string; content_type: string; bytes: number; sha256: Sha256;
}
export interface GridFabricFileRange extends RequestOptions { offset?: number; limit?: number; expectedSha256: Sha256 }
export interface FileSelection extends RequestOptions {
  file: string; expectedBytes: number; expectedSha256: Sha256;
}
export interface SourceFileSelection extends FileSelection { name?: string; mimeType?: string }
export interface TextSelection extends RequestOptions {
  text: string; name?: string; mimeType?: string; expectedSha256?: Sha256;
}
export interface ArchiveSelection extends FileSelection { name: string; requestId: RequestId }
export interface GridFabricTransport {
  inspect(): Promise<GridFabricIdentity>;
  read<K extends GridFabricOperation>(operation: K, payload: GridFabricInputMap[K], options?: RequestOptions): Promise<NativeReply<GridFabricResult<K>>>;
  dispatch<K extends GridFabricOperation>(operation: K, payload: GridFabricInputMap[K], options?: RequestOptions): Promise<NativeReply<GridFabricResult<K>>>;
  fileInfo?(fileId: NativeFileId, options?: RequestOptions): Promise<GridFabricFileInfo>;
  readFile?(fileId: NativeFileId, options: Required<Omit<GridFabricFileRange,'signal'>> & RequestOptions): Promise<Uint8Array>;
  uploadFile?(input: SourceFileSelection): Promise<NativeReply>;
  uploadText?(input: TextSelection): Promise<NativeReply>;
  receiveArchive?(input: ArchiveSelection): Promise<NativeReply>;
  reopen?(): Promise<GridFabricIdentity>; close(): Promise<void>;
}
export interface GridFabricClientBase {
  readonly identity: GridFabricIdentity; readonly endpoint: string;
  call<K extends GridFabricOperation>(operation: K, payload: GridFabricInputMap[K], options?: RequestOptions): Promise<GridFabricResult<K>>;
  callRaw<K extends GridFabricOperation>(operation: K, payload: GridFabricInputMap[K], options?: RequestOptions): Promise<NativeReply<GridFabricResult<K>>>;
  fileInfo(fileId: NativeFileId | Sha256, options?: RequestOptions): Promise<GridFabricFileInfo>;
  readFile(fileId: NativeFileId | Sha256, options: GridFabricFileRange): Promise<Uint8Array>;
  uploadFile(input: SourceFileSelection): Promise<NativeReply>;
  uploadText(input: TextSelection): Promise<NativeReply>;
  receiveArchive(input: ArchiveSelection): Promise<NativeReply>;
  recover(requestId: RequestId, options?: RequestOptions): Promise<JsonObject>;
  pages(collection: GridFabricTable, options?: Omit<NativePageInput,'collection'> & RequestOptions & {host?:false}): AsyncIterable<NativePage<GridFabricTable>>;
  pages(collection: GridFabricHostTable, options: Omit<NativePageInput<GridFabricHostTable>,'collection'> & RequestOptions & {host:true}): AsyncIterable<NativePage<GridFabricHostTable>>;
  rows(collection: GridFabricTable, options?: Omit<NativePageInput,'collection'> & RequestOptions & {host?:false}): AsyncIterable<JsonObject>;
  rows(collection: GridFabricHostTable, options: Omit<NativePageInput<GridFabricHostTable>,'collection'> & RequestOptions & {host:true}): AsyncIterable<JsonObject>;
  reopen(): Promise<GridFabricIdentity>; close(): Promise<void>;
}
export type GridFabricNamedOperations = {
  launch(payload?: GridFabricInputMap['launch'],options?:RequestOptions):Promise<GridFabricResult<'launch'>>;
  state(payload?: GridFabricInputMap['state'],options?:RequestOptions):Promise<GridFabricState>;
  source(payload?: GridFabricInputMap['source'],options?:RequestOptions):Promise<NativeSource>;
  contracts(payload?: GridFabricInputMap['contracts'],options?:RequestOptions):Promise<JsonObject>;
  page(payload:GridFabricInputMap['page'],options?:RequestOptions):Promise<NativePage<GridFabricTable>>;
  hostPage(payload:GridFabricInputMap['host_page'],options?:RequestOptions):Promise<NativePage<GridFabricHostTable>>;
  detail(payload:GridFabricInputMap['detail'],options?:RequestOptions):Promise<GridFabricResult<'detail'>>;
  operation(payload:GridFabricInputMap['operation'],options?:RequestOptions):Promise<JsonObject>;
  exports(payload?:GridFabricInputMap['exports'],options?:RequestOptions):Promise<{items:JsonObject[]}>;
  restoreStatus(payload:GridFabricInputMap['restore_status'],options?:RequestOptions):Promise<JsonObject>;
  configureInstance(payload:GridFabricInputMap['configure_instance'],options?:RequestOptions):Promise<JsonObject>;
  importSource(payload:GridFabricInputMap['import_source'],options?:RequestOptions):Promise<JsonObject>;
  saveMapping(payload:GridFabricInputMap['save_mapping'],options?:RequestOptions):Promise<JsonObject>;
  activateMapping(payload:GridFabricInputMap['activate_mapping'],options?:RequestOptions):Promise<JsonObject>;
  recordOptDecision(payload:GridFabricInputMap['record_opt_decision'],options?:RequestOptions):Promise<JsonObject>;
  buildReport(payload:GridFabricInputMap['build_report'],options?:RequestOptions):Promise<JsonObject>;
  reconcileDistribution(payload:GridFabricInputMap['reconcile_distribution'],options?:RequestOptions):Promise<JsonObject>;
  prepareManagement(payload:GridFabricInputMap['prepare_management'],options?:RequestOptions):Promise<JsonObject>;
  beginManagement(payload:GridFabricInputMap['begin_management'],options?:RequestOptions):Promise<JsonObject>;
  finishManagement(payload:GridFabricInputMap['finish_management'],options?:RequestOptions):Promise<JsonObject>;
  reconcileManagement(payload:GridFabricInputMap['reconcile_management'],options?:RequestOptions):Promise<JsonObject>;
  beginDeviceAction(payload:GridFabricInputMap['begin_device_action'],options?:RequestOptions):Promise<JsonObject>;
  finishDeviceAction(payload:GridFabricInputMap['finish_device_action'],options?:RequestOptions):Promise<JsonObject>;
  reconcileDeviceAction(payload:GridFabricInputMap['reconcile_device_action'],options?:RequestOptions):Promise<JsonObject>;
  recoverDispatches(payload:GridFabricInputMap['recover_dispatches'],options?:RequestOptions):Promise<JsonObject>;
  projectEventHistory(payload:GridFabricInputMap['project_event_history'],options?:RequestOptions):Promise<JsonObject>;
  resumeEventCallback(payload:GridFabricInputMap['resume_event_callback'],options?:RequestOptions):Promise<JsonObject>;
  dispatchManagement(payload:GridFabricInputMap['dispatch_management'],options?:RequestOptions):Promise<JsonObject>;
  dispatchDevice(payload:GridFabricInputMap['dispatch_device'],options?:RequestOptions):Promise<JsonObject>;
  export(payload:GridFabricInputMap['export'],options?:RequestOptions):Promise<JsonObject>;
};
export type GridFabricClient = GridFabricClientBase & GridFabricNamedOperations;
export interface GridFabricConnectOptions {
  connectionFile:string; expectedWorkspaceId?:string; expectedWorkspace?:string; expectedSourceSha256?:Sha256;
  maximumResponseBytes?:number; timeoutMs?:number;
}
export function connectGridFabricOperator(options:GridFabricConnectOptions):Promise<GridFabricClient>;
export function createGridFabricClient(options:{transport:GridFabricTransport;expectedWorkspaceId?:string;expectedWorkspace?:string;expectedSourceSha256?:Sha256}):Promise<GridFabricClient>;
export class GridFabricClientError extends Error {
  readonly name:'GridFabricClientError'; code:string; details:Record<string,unknown>;
  http_status?:number; request_id?:RequestId; raw_text?:string; native_error?:JsonObject;
  uncertain?:boolean; accepted?:boolean; recovery?:JsonObject;
  constructor(code:string,message:string,details?:Record<string,unknown>);
}
export interface GridFabricFileManifest {
  schema:'commons.gridfabric-native-file-manifest.v1'; exportId:NativeFileId;
  workspace:{workspace_id:string;workspace_directory:string};
  native_file:Pick<GridFabricFileInfo,'file_id'|'name'|'content_type'|'bytes'|'sha256'>;
  files:Array<{name:string;file_id:NativeFileId;content_type:string;bytes:number;sha256:Sha256}>;
}
export interface GridFabricFileSource {
  readonly endpoint:string; readonly exportId:NativeFileId;
  readonly manifest:GridFabricFileManifest; readonly manifestSha256:Sha256; readonly manifestBytes:Uint8Array;
  readonly manifestFile:{name:string;bytes:number;sha256:Sha256;content_type:string};
  call(name:string,args:Record<string,unknown>,options?:{requestSignal?:AbortSignal}):Promise<JsonObject>;
}
export interface GridFabricDownload {
  directory:string; exportId:NativeFileId; manifestSha256:Sha256; manifest:GridFabricFileManifest;
  originalFile:GridFabricFileManifest['native_file'] & {path:string}; [field:string]:unknown;
}
export interface GridFabricDownloadOptions extends RequestOptions {
  client:GridFabricClient; fileId:NativeFileId | Sha256; directory:string;
  expectedSha256?:Sha256; expectedManifestSha256?:Sha256; chunkSize?:number;
  onProgress?:(progress:Record<string,unknown>)=>unknown;
}
export function createGridFabricFileSource(options:Omit<GridFabricDownloadOptions,'directory'|'expectedManifestSha256'|'chunkSize'|'onProgress'>):Promise<GridFabricFileSource>;
export function downloadGridFabricFile(options:GridFabricDownloadOptions):Promise<GridFabricDownload>;
export function reopenGridFabricDownload(options:RequestOptions & {
  directory:string;expectedManifestSha256?:Sha256;expectedWorkspaceId?:string;expectedFileId?:NativeFileId
}):Promise<GridFabricDownload>;
export function downloadGridFabricMerchantFile(options:Omit<GridFabricDownloadOptions,'client'> & {
  workspace:string;fileClient:{endpoint:string;call(name:string,args:Record<string,unknown>,options?:unknown):Promise<any>}
}):Promise<GridFabricDownload>;
export function parseGridFabricFileManifest(bytes:Uint8Array,expectedFileId:NativeFileId):GridFabricFileManifest;
export const GRIDFABRIC_CONNECTION_SCHEMA:'stellar-forge.gridfabric-workspace-connection.v1';
export const GRIDFABRIC_SDK_SCHEMA:'stellar-forge.gridfabric-sdk.v1';
export const GRIDFABRIC_FILE_MANIFEST:'gridfabric-file.json';
export const GRIDFABRIC_FILE_MANIFEST_SCHEMA:'commons.gridfabric-native-file-manifest.v1';
export const GRIDFABRIC_TABLES:readonly GridFabricTable[];
export const GRIDFABRIC_HOST_TABLES:readonly GridFabricHostTable[];
export const GRIDFABRIC_ACTIONS:readonly GridFabricAction[];
export interface GridFabricOperationDefinition {
  operation:GridFabricOperation;description:string;method:'GET'|'POST';path:string;mutating:boolean;
  inputSchema:JsonObject;annotations:{readOnlyHint:boolean;destructiveHint:boolean;openWorldHint:boolean};
  action?:GridFabricAction;dispatch?:'management'|'device';
}
export const gridFabricOperations:Readonly<Record<GridFabricOperation,GridFabricOperationDefinition>>;
export function gridFabricToolName(operation:GridFabricOperation):string;
export function gridFabricFileId(value:string):{fileId:NativeFileId;kind:'file'|'export';id:string};
export function validateGridFabricOperation<K extends GridFabricOperation>(operation:K,payload:GridFabricInputMap[K]):{
  definition:GridFabricOperationDefinition;payload:GridFabricInputMap[K]
};

/** Retain this private input file unchanged when continuing the same receiving operation. */
export interface GridFabricSdkReceivingInput {
  schema:'commons.gridfabric-sdk-receiving-input.v1'; operation_id:string;
  connectionFile:string; workspace:string; workspaceId:string; sourceSha256:Sha256;
  outputDirectory:string; exportRequestId:RequestId; restoreRequestId:RequestId; restoredName:string;
  minimumCollections?:Partial<Record<GridFabricTable,number>>;
}
export interface GridFabricReceivingError {
  name:string; code?:string; message:string; details?:Record<string,unknown>;
  request_id?:RequestId; recovery?:JsonObject; uncertain?:boolean;
}
export interface GridFabricSdkReceivingResult {
  schema:'commons.gridfabric-sdk-receiving.v1'; state:'COMPLETE'; operation_id:string;
  configuration_sha256:Sha256; created_at:string; completed_at:string;
  phases:Array<{name:string;at:string;[field:string]:unknown}>;
  workspace:{workspace_id:string;directory:string;source_sha256:Sha256}; revision:number;
  native_export:NativeReply; native_restore:NativeReply;
  portable:{export_id:RequestId;sha256:Sha256;bytes:number;path:string;manifest_sha256:Sha256};
  restored:{directory:string;workspace_id:string;revision:number};
  collections:Record<GridFabricTable,number>;
  table_reads:Record<GridFabricTable | GridFabricHostTable,{rows:number;pages:number;sha256:Sha256}>;
  original_files:Array<{file_id:`file_${string}`;name:string;bytes:number;sha256:Sha256;ranges:number}>;
  mcp:{tool_count:number;collections:number;original_error:GridFabricReceivingError;
    source_download:{path:string;bytes:number;sha256:Sha256};streamed_source_sha256:Sha256;
    restored_request_id:RequestId};
  restarted:{sdk:true;mcp:true;previous_origin:string;current_origin:string};
  cold_operator_closed:true; receiving_directory:string; receiving_record:string; reused?:true;
}
/** Borrow the existing live operator, receive all native rows/files, and close the cold owner. */
export function runGridFabricSdkReceiving(options:{configuration:string}):Promise<GridFabricSdkReceivingResult>;
