/// <reference types="node" />
/** Original WQX MCP operations; all local paths are client-side only. */
export type WqxJson = null | boolean | number | string | WqxJson[] | { [key: string]: WqxJson };
export type WqxObject = { [key: string]: WqxJson };
export type WqxInputRef = `input:${string}` | `file:${string}` | `host:${string}`;
export type WqxToolName = `merchant_wqx_${string}`;
export interface WqxRequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface WqxNativeClient {
  /** Stable endpoint identity; bearer/session secrets remain outside this value. */
  endpoint: string;
  /** Return the original structuredContent value, as openMerchantFileClient does. */
  call(name: string, args: Record<string, unknown>, options?: { requestSignal?: AbortSignal | null; timeoutMs?: number }): Promise<unknown>;
}
export interface WqxClientOptions {
  client?: WqxNativeClient; url?: string; workspace?: string; tokenEnv?: string;
  environment?: NodeJS.ProcessEnv; signal?: AbortSignal;
}
export interface WqxScope { workspace?: string }
export interface WqxRetainedFile {
  fileId: string; name: string; contentType: string; bytes: number; sha256: string;
  schema?: string; workspace?: string | null; source?: WqxObject; createdAt?: string;
}
export interface WqxFileRead {
  fileId: string; readId: string;
  file: { name: string; contentType: string; bytes: number; sha256: string };
  offset: number; bytesRead: number; nextOffset: number | null; encoding: 'base64'; data: string;
}
export interface WqxInputReceiving {
  inputId: string; status: 'RECEIVING'; name: string; contentType: string; bytes: number;
  sha256: string; receivedBytes: number;
}
export interface WqxInputComplete {
  inputId: string; status: 'COMPLETE'; name: string; contentType: string; bytes: number;
  sha256: string; receivedBytes: number; inputRef: WqxInputRef; completedAt?: string;
}
export type WqxInputState = WqxInputReceiving | WqxInputComplete;
export interface WqxLaunch {
  launchId: string; projectBindingId: string; sourceSha256: string; selectionSha256: string;
  projectRevision: number | null; pid: number;
}
export interface WqxNativeResult<T = WqxObject> {
  workspace: string; launch: WqxLaunch; httpStatus: number; result: T; file: WqxRetainedFile;
}
export interface WqxPage<T = WqxObject> {
  total: number; snapshot: string; offset: number; items: T[]; nextOffset: number | null;
}
export interface WqxPageArgs { offset?: number; limit?: number; expectedSnapshot?: string }
export interface WqxRetainedUsage {
  fileReads: { activeFileReads: number; pendingFileCloses: number; snapshotBytes: number; immutableFileBytes: number };
  closing: boolean;
}
export type WqxWorkspaceStatus =
  | { workspace: string; label: string; status: 'OPEN'; launch: WqxLaunch;
      project: WqxJson; buyerConfigured: boolean; runtime: WqxJson;
      counts: Record<WqxInventoryArgs['kind'], number> }
  | { workspace: string; label: string; projectBindingId: string; status: 'STOPPED' | 'UNAVAILABLE';
      error: { code: string; message: string } };
export interface WqxStatus {
  schema: 'stellar-forge.wqx-operator-status.v1'; workspaces: WqxWorkspaceStatus[]; retained: WqxRetainedUsage;
}
export interface WqxInventory<T = WqxObject> extends WqxPage<T> {
  workspace: string; kind: WqxInventoryArgs['kind']; launch: WqxLaunch;
}
export type WqxValueType = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';
export interface WqxDocumentEntry {
  key: string; pointer: string; type: WqxValueType; count?: number; characters?: number; value?: WqxJson;
}
export interface WqxRecordIdentity {
  workspace: string; family: WqxRecordFamily; id: string; documentSha256: string;
  launch: WqxLaunch; file: WqxRetainedFile; pointer: string;
}
export type WqxRecord = WqxRecordIdentity & (
  | ({ type: 'array' | 'object' } & WqxPage<WqxDocumentEntry>)
  | { type: 'null' | 'boolean' | 'number' | 'string'; value?: WqxJson; characters?: number }
);
export type WqxTargetKind = 'settings' | 'location' | 'activity' | 'result' | 'translation' | 'limit' | 'reference';
export interface WqxReviewSource {
  schema: string; sourcePlanId: string; sourcePlanSha256: string; reviewId: string; reviewSha256: string;
  captureId: string; captureSha256: string; title: string; summary: WqxObject;
}
export interface WqxTarget {
  targetId: string; kind: WqxTargetKind; sourceKey: string; sourceId: string; field: string;
  matchValue: string | null; currentValue: string; savedChoice: WqxObject;
  issueCodes: string[]; issues: WqxObject[]; type: string; allowedValues: string[] | null;
  attention: boolean; status: 'attention' | 'chosen' | 'unchosen'; native: WqxObject | null; count?: number;
}
export interface WqxTargets {
  workspace: string; launch: WqxLaunch; source: WqxReviewSource; rows: WqxTarget[];
  total: number; offset: number; limit: number; kinds: WqxTargetKind[]; fields: string[]; nextOffset: number | null;
}
export interface WqxInputFiles {
  inputs: Array<{ inputRef: `host:${string}`; label: string; bytes: number; sha256: string; contentType: string }>;
  captures: Array<{ source: string; label: string; captureSha256: string }>;
}
export interface WqxFileReleased { fileId: string; readId: string; released: true }

export type WqxRecordFamily = 'capture' | 'review' | 'plan' | 'decision' | 'edition';
export interface WqxInventoryArgs extends WqxScope, WqxPageArgs { kind: 'captures' | 'reviews' | 'plans' | 'decisions' | 'editions' | 'jobs' }
export interface WqxRecordArgs extends WqxScope {
  family: WqxRecordFamily; id: string; pointer?: string; offset?: number; limit?: number; expectedDocumentSha256?: string;
}
export interface WqxTargetsArgs extends WqxScope {
  planId: string; kind?: 'settings' | 'location' | 'activity' | 'result' | 'translation' | 'limit' | 'reference'; field?: string; search?: string; status?: string; attentionOnly?: boolean;
  offset?: number; limit?: number; expectedPlanSha256?: string;
}
export interface WqxFileArgs extends WqxScope {
  family: 'capture' | 'review' | 'plan' | 'decision' | 'customer';
  id: string; format?: string; index?: number; intentId?: string;
}
export type WqxDocumentSelection =
  | { document: WqxObject; documentRef?: never }
  | { document?: never; documentRef: WqxInputRef };
export type WqxTableExportArgs = WqxScope & WqxDocumentSelection & { format: 'csv' | 'tsv' };
export interface WqxTableImportArgs extends WqxScope { inputRef: WqxInputRef; format: 'csv' | 'tsv' }
export type WqxDecisionsPreviewArgs = WqxScope & WqxDocumentSelection & { newPlanId: string };
export type WqxDecisionsSaveArgs = WqxScope & WqxDocumentSelection & {
  reviewId: string; newPlanId: string; expectedPreviewSha256: string;
};
export interface WqxReceiveArgs extends WqxScope { kind: 'review' | 'plan' | 'decision'; inputRef: WqxInputRef }
export interface WqxInputBeginArgs { inputId: string; name: string; contentType?: string; bytes: number; sha256: string }
export interface WqxInputAppendArgs { inputId: string; sha256: string; offset: number; dataBase64: string }
export interface WqxInputFinishArgs { inputId: string; sha256: string }
export interface WqxFileReadArgs { fileId: string; expectedSha256: string; offset?: number; limit?: number; readId?: string }
export interface WqxFileReleaseArgs { fileId: string; readId: string }


export interface WqxResultArgs extends WqxScope {
  captureId: string; id: string; sourceSha256: string; sourceIndex: number; captureSha256: string;
}
export interface WqxCaptureImportArgs extends WqxScope { source: string; expectedRevision: number; title?: string }
export interface WqxCaptureCancelArgs extends WqxScope { captureId: string }
export type WqxNativeArguments<T> = WqxScope & (
  | { request: T; inputRef?: never }
  | { request?: never; inputRef: WqxInputRef }
);
export interface WqxProjectSaveRequest { title: string; selection: WqxObject; expectedRevision: number }
export interface WqxCaptureStartRequest { operationId: string; expectedRevision: number }
export interface WqxAnalyzeRequest { captureId: string; options?: WqxObject; comparisonCaptureId?: string }
export interface WqxReviewSaveRequest extends WqxAnalyzeRequest {
  reviewId: string; expectedCaptureSha256: string; note?: string;
}
export interface WqxPlanPreviewRequest { reviewId: string; expectedReviewSha256: string; options?: WqxObject }
export interface WqxPlanSaveRequest extends WqxPlanPreviewRequest { planId: string }
export interface WqxEditionPrepareRequest { editionId: string; reviewId: string }
export interface WqxMerchantStageRequest { editionId: string; origin: string; payment: WqxObject; path?: string }
export interface WqxMerchantStartRequest { editionId: string; allowLocalFacilitator?: boolean; challengeOnly?: boolean }
export interface WqxCustomerPrepareRequest {
  editionId: string; intentId: string; query?: WqxObject; file?: string; kind?: string;
  previous?: WqxObject; acceptIndex?: number;
}
export interface WqxCustomerExecuteRequest { intentId: string }
export interface WqxCustomerReopenRequest { editionId: string; intentId: string }

export interface WqxToolContract {
  merchant_wqx_result: {args:WqxResultArgs;result:WqxNativeResult};
  merchant_wqx_files: {args:WqxPageArgs;result:WqxPage<WqxRetainedFile>};
  merchant_wqx_input_files: {args:Record<string, never>;result:WqxInputFiles};
  merchant_wqx_capture_import: {args:WqxCaptureImportArgs;result:WqxNativeResult};
  merchant_wqx_capture_cancel: {args:WqxCaptureCancelArgs;result:WqxNativeResult};
  merchant_wqx_project_save: {args:WqxNativeArguments<WqxProjectSaveRequest>;result:WqxNativeResult};
  merchant_wqx_capture_start: {args:WqxNativeArguments<WqxCaptureStartRequest>;result:WqxNativeResult};
  merchant_wqx_analyze: {args:WqxNativeArguments<WqxAnalyzeRequest>;result:WqxNativeResult};
  merchant_wqx_review_save: {args:WqxNativeArguments<WqxReviewSaveRequest>;result:WqxNativeResult};
  merchant_wqx_plan_preview: {args:WqxNativeArguments<WqxPlanPreviewRequest>;result:WqxNativeResult};
  merchant_wqx_plan_save: {args:WqxNativeArguments<WqxPlanSaveRequest>;result:WqxNativeResult};
  merchant_wqx_edition_prepare: {args:WqxNativeArguments<WqxEditionPrepareRequest>;result:WqxNativeResult};
  merchant_wqx_merchant_stage: {args:WqxNativeArguments<WqxMerchantStageRequest>;result:WqxNativeResult};
  merchant_wqx_merchant_start: {args:WqxNativeArguments<WqxMerchantStartRequest>;result:WqxNativeResult};
  merchant_wqx_merchant_stop: {args:WqxNativeArguments<Record<string, never>>;result:WqxNativeResult};
  merchant_wqx_customer_prepare: {args:WqxNativeArguments<WqxCustomerPrepareRequest>;result:WqxNativeResult};
  merchant_wqx_customer_execute: {args:WqxNativeArguments<WqxCustomerExecuteRequest>;result:WqxNativeResult};
  merchant_wqx_customer_reopen: {args:WqxNativeArguments<WqxCustomerReopenRequest>;result:WqxNativeResult};
  merchant_wqx_status: { args: WqxScope; result: WqxStatus };
  merchant_wqx_inventory: { args: WqxInventoryArgs; result: WqxInventory };
  merchant_wqx_record: { args: WqxRecordArgs; result: WqxRecord };
  merchant_wqx_targets: { args: WqxTargetsArgs; result: WqxTargets };
  merchant_wqx_file: { args: WqxFileArgs; result: WqxRetainedFile };
  merchant_wqx_file_read: { args: WqxFileReadArgs; result: WqxFileRead };
  merchant_wqx_file_release: { args: WqxFileReleaseArgs; result: WqxFileReleased };
  merchant_wqx_input_begin: { args: WqxInputBeginArgs; result: WqxInputState };
  merchant_wqx_input_append: { args: WqxInputAppendArgs; result: WqxInputState };
  merchant_wqx_input_finish: { args: WqxInputFinishArgs; result: WqxInputComplete };
  merchant_wqx_input_status: { args: { inputId: string }; result: WqxInputState };
  merchant_wqx_table_export: { args: WqxTableExportArgs; result: WqxRetainedFile };
  merchant_wqx_table_import: { args: WqxTableImportArgs; result: WqxNativeResult };
  merchant_wqx_decisions_preview: { args: WqxDecisionsPreviewArgs; result: WqxNativeResult };
  merchant_wqx_decisions_save: { args: WqxDecisionsSaveArgs; result: WqxNativeResult };
  merchant_wqx_receive: { args: WqxReceiveArgs; result: WqxNativeResult };
}
export interface WqxUploadSelection {
  path: string; inputId: string; name?: string; contentType?: string; expectedSha256?: string; maximumBytes?: number;
}
export interface WqxDownloadSelection { file: WqxRetainedFile; directory: string; name?: string }
export interface WqxUploadProgress {
  inputId: string; status: WqxInputState['status']; bytes: number; total: number; sha256: string;
}
export interface WqxDownloadProgress {
  fileId: string; name: string; status: 'DOWNLOADING'; bytes: number; total: number; sha256: string;
}
export interface WqxUploadOptions extends WqxRequestOptions {
  /** Original named-input protocol permits at most 65,536 decoded bytes. */
  chunkSize?: number; onProgress?: (progress: WqxUploadProgress) => void | Promise<void>;
}
export interface WqxDownloadOptions extends WqxRequestOptions {
  chunkSize?: number; onProgress?: (progress: WqxDownloadProgress) => void | Promise<void>;
}
export type WqxUploadResult = WqxInputComplete & { resumedBytes: number };
export interface WqxDownloadResult {
  schema: 'stellar-forge.wqx-file-download.v1'; status: 'COMPLETE' | 'REOPENED';
  directory: string; filename: string; file: WqxRetainedFile; bytes: number; sha256: string; resumedBytes: number;
}
export declare const WQX_TRANSFER_CHUNK_BYTES: 65536;
export declare const WQX_TRANSFER_MAX_BYTES: 134217728;
export declare const WQX_DOWNLOAD_SCHEMA: 'stellar-forge.wqx-file-download.v1';
export declare const WQX_DOWNLOAD_STATE_SCHEMA: 'stellar-forge.wqx-file-download-state.v1';
export declare function validateWqxFile<T extends WqxRetainedFile>(value: T): T;
export declare function openWqxWorkspaceClient(options?: WqxClientOptions): Promise<WqxWorkspaceClient>;

export declare class WqxWorkspaceClient {
  constructor(options: { client: WqxNativeClient; workspace?: string });
  readonly workspace: string | undefined;
  readonly endpoint: string;
  readonly closed: boolean;
  close(): void;
  call<K extends keyof WqxToolContract>(name: K, args: WqxToolContract[K]['args'], options?: WqxRequestOptions): Promise<WqxToolContract[K]['result']>;
  /** Original catalog validation also applies to all subsequent WQX tool names. */
  call<T = WqxObject>(name: WqxToolName, args?: Record<string, unknown>, options?: WqxRequestOptions): Promise<T>;
  status(args?: WqxScope, options?: WqxRequestOptions): Promise<WqxStatus>;
  inventory(args: WqxInventoryArgs, options?: WqxRequestOptions): Promise<WqxInventory>;
  record(args: WqxRecordArgs, options?: WqxRequestOptions): Promise<WqxRecord>;
  result(args: WqxResultArgs, options?: WqxRequestOptions): Promise<WqxNativeResult>;
  files(args?: WqxPageArgs, options?: WqxRequestOptions): Promise<WqxPage<WqxRetainedFile>>;
  inputFiles(args?: Record<string, never>, options?: WqxRequestOptions): Promise<WqxInputFiles>;
  captureImport(args: WqxCaptureImportArgs, options?: WqxRequestOptions): Promise<WqxNativeResult>;
  captureCancel(args: WqxCaptureCancelArgs, options?: WqxRequestOptions): Promise<WqxNativeResult>;
  projectSave(args:WqxNativeArguments<WqxProjectSaveRequest>, options?:WqxRequestOptions): Promise<WqxNativeResult>;
  captureStart(args:WqxNativeArguments<WqxCaptureStartRequest>, options?:WqxRequestOptions): Promise<WqxNativeResult>;
  analyze(args:WqxNativeArguments<WqxAnalyzeRequest>, options?:WqxRequestOptions): Promise<WqxNativeResult>;
  reviewSave(args:WqxNativeArguments<WqxReviewSaveRequest>, options?:WqxRequestOptions): Promise<WqxNativeResult>;
  planPreview(args:WqxNativeArguments<WqxPlanPreviewRequest>, options?:WqxRequestOptions): Promise<WqxNativeResult>;
  planSave(args:WqxNativeArguments<WqxPlanSaveRequest>, options?:WqxRequestOptions): Promise<WqxNativeResult>;
  editionPrepare(args:WqxNativeArguments<WqxEditionPrepareRequest>, options?:WqxRequestOptions): Promise<WqxNativeResult>;
  merchantStage(args:WqxNativeArguments<WqxMerchantStageRequest>, options?:WqxRequestOptions): Promise<WqxNativeResult>;
  merchantStart(args:WqxNativeArguments<WqxMerchantStartRequest>, options?:WqxRequestOptions): Promise<WqxNativeResult>;
  merchantStop(args:WqxNativeArguments<Record<string, never>>, options?:WqxRequestOptions): Promise<WqxNativeResult>;
  customerPrepare(args:WqxNativeArguments<WqxCustomerPrepareRequest>, options?:WqxRequestOptions): Promise<WqxNativeResult>;
  customerExecute(args:WqxNativeArguments<WqxCustomerExecuteRequest>, options?:WqxRequestOptions): Promise<WqxNativeResult>;
  customerReopen(args:WqxNativeArguments<WqxCustomerReopenRequest>, options?:WqxRequestOptions): Promise<WqxNativeResult>;
  targets(args: WqxTargetsArgs, options?: WqxRequestOptions): Promise<WqxTargets>;
  file(args: WqxFileArgs, options?: WqxRequestOptions): Promise<WqxRetainedFile>;
  fileRead(args: WqxFileReadArgs, options?: WqxRequestOptions): Promise<WqxFileRead>;
  fileRelease(args: WqxFileReleaseArgs, options?: WqxRequestOptions): Promise<WqxFileReleased>;
  inputBegin(args: WqxInputBeginArgs, options?: WqxRequestOptions): Promise<WqxInputState>;
  inputAppend(args: WqxInputAppendArgs, options?: WqxRequestOptions): Promise<WqxInputState>;
  inputFinish(args: WqxInputFinishArgs, options?: WqxRequestOptions): Promise<WqxInputComplete>;
  inputStatus(args: { inputId: string }, options?: WqxRequestOptions): Promise<WqxInputState>;
  tableExport(args: WqxTableExportArgs, options?: WqxRequestOptions): Promise<WqxRetainedFile>;
  tableImport(args: WqxTableImportArgs, options?: WqxRequestOptions): Promise<WqxNativeResult>;
  decisionsPreview(args: WqxDecisionsPreviewArgs, options?: WqxRequestOptions): Promise<WqxNativeResult>;
  decisionsSave(args: WqxDecisionsSaveArgs, options?: WqxRequestOptions): Promise<WqxNativeResult>;
  receive(args: WqxReceiveArgs, options?: WqxRequestOptions): Promise<WqxNativeResult>;
  uploadFile(input: WqxUploadSelection, options?: WqxUploadOptions): Promise<WqxUploadResult>;
  downloadFile(input: WqxDownloadSelection, options?: WqxDownloadOptions): Promise<WqxDownloadResult>;
}
export declare function uploadWqxInput(client: WqxWorkspaceClient, input: WqxUploadSelection, options?: WqxUploadOptions): Promise<WqxUploadResult>;
export declare function downloadWqxFile(client: WqxWorkspaceClient, input: WqxDownloadSelection, options?: WqxDownloadOptions): Promise<WqxDownloadResult>;
export declare function reopenWqxDownload(options: { directory: string; expectedSha256?: string }): Promise<WqxDownloadResult>;
