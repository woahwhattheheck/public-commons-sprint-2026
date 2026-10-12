/** Typed operations over the original Huwise / Opendatasoft workbench. */
export type NativeResult = Record<string, unknown>;
export interface Scope { workspace: string }
export interface Page { offset?: number; limit?: number }
export interface RequestOptions { requestSignal?: AbortSignal | null; timeoutMs?: number }
export interface ClientOptions { url: string; tokenEnv?: string; environment?: Record<string, string | undefined>; signal?: AbortSignal }
export interface OdsQuery {
  where?: string; order_by?: string; refine?: string[]; exclude?: string[];
  lang?: string; timezone?: string; limit?: number; offset?: number; select?: string; group_by?: string;
}
export interface CaptureSelection extends Omit<OdsQuery, 'limit' | 'offset' | 'select' | 'group_by'> {
  datasetId: string; timeoutMs?: number; maxResponseBytes?: number; maxRows?: number; maxBytes?: number;
}
export interface ProjectionField { field: string; type: 'string' | 'integer' | 'number' | 'boolean'; nullable?: boolean; encoding?: 'native' | 'json' }
export interface RowNote { rowIndex: number; text: string }
export interface SourceIdentity {
  catalogOrigin: string; datasetId: string; datasetUid: string; editionId: string;
  captureSha256: string; notesRevision: number; rowCount: number; merchantManifestSha256?: string; tenantManifestSha256?: string;
}
export interface FileIdentity { name: string; bytes: number; sha256: string; contentType: string }
export interface ExportManifest {
  schema: 'stellar-forge.opendatasoft-agent-export.v1'; exportId: string; workspace: string;
  createdAt: string; source: SourceIdentity;
  selection: { geometryField?: string; sourceId?: string; merchantExportId?: string; buyerRequestId?: string; tenantExportId?: string };
  files: FileIdentity[];
}
export interface ExportInput extends Scope {
  exportId: string; editionId: string; expectedCaptureSha256: string; expectedNotesRevision: number;
  geometryField?: string; sourceId?: string; merchantExportId?: string; buyerRequestId?: string; tenantExportId?: string;
}
export interface Operation {
  id: string; kind: string; state: 'RUNNING' | 'COMPLETE' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';
  startedAt: string; completedAt?: string; progress: unknown; result: unknown; error: unknown;
}
export interface TenantPlanInput {
  editionId:string; captureSha256:string; notesRevision:number;
  target:{alias:string;datasetId:string;datasetUid?:string};
  dataset:NativeResult & {dataset_id?:string;is_restricted:boolean;metadata:NativeResult};
  resource:{uid?:string;type:string;title:string;params?:NativeResult};
  resourceMode?:'append'|'replace-selected'; publish:boolean;
  changes?:Partial<Record<'fields'|'processors'|'users'|'groups'|'schedules',Array<{id?:string;body:NativeResult}>>>;
  acceptance?:{mode?:'source-match'|'reviewed-output';expectedRows?:number;fieldMap?:Record<string,string>;allowAdditionalRows?:boolean};
}
export interface Inputs {
  tenant_targets:Scope;
  tenant_datasets:Scope & {target:string;query?:{dataset_id?:string;offset?:number;limit?:number}};
  tenant_prepare:Scope & ({plan:TenantPlanInput;planJson?:never} | {planJson:string;plan?:never});
  tenant_plan:Scope & {planId:string};
  tenant_inspect:Scope & {planId:string};
  tenant_review:Scope & {planId:string;planSha256:string;configurationSha256:string;note?:string};
  tenant_apply:Scope & {planId:string;reviewId:string};
  tenant_recover:Scope & {planId:string;recovery?:{fileUid?:string;stepIds?:Record<string,string>}};
  tenant_status:Scope & {planId:string};
  tenant_receive:Scope & {planId:string;limits?:{maxRows?:number;maxBytes?:number}};
  tenant_export:Scope & {planId:string};
  tenant_delivery:Scope & {tenantExportId:string};
  status: Partial<Scope> & Page;
  open: Scope & { browser?: boolean };
  close: Scope & { instanceId: string };
  search: Scope & { query?: OdsQuery };
  dataset: Scope & { datasetId: string };
  preview: Scope & { datasetId: string; query?: OdsQuery };
  capture: Scope & { selection: CaptureSelection };
  resume: Scope & { editionId: string; limits?: { maxRows?: number; maxBytes?: number } };
  import: Scope & { sourceImport: string };
  operation: Scope & { operationId: string };
  cancel: Scope & { operationId: string };
  edition: Scope & { editionId: string };
  rows: Scope & Page & { editionId: string };
  facets: Scope & { editionId: string; field: string; limit?: number; mode?: 'value' | 'members' };
  notes: Scope & { editionId: string; expectedCaptureSha256: string; expectedRevision: number; text: string; rowNotes: RowNote[] };
  compare: Scope & Page & { before: string; after: string; key: string };
  source_save: Scope & { editionId: string; expectedCaptureSha256: string; projection: Record<string, ProjectionField>; query?: string; title?: string };
  publication_create: Scope & { sourceId: string; plan?: NativeResult };
  publication: Scope & { publicationId: string; query?: string };
  publication_review: Scope & { publicationId: string; expectedCandidateDigest: string; reviewer: string; note: string };
  publication_recover: Scope & { publicationId: string };
  publication_publish: Scope & { publicationId: string; reviewId: string };
  merchant_export: Scope & { publicationId: string; expectedCandidateDigest: string; merchant: string };
  merchant_stage: Scope & { merchantExportId: string; expectedManifestSha256: string; releaseId: string; label?: string };
  buyer_offer: Scope & { merchantExportId: string; seller: string; query?: string };
  buyer_prepare: Scope & { merchantExportId: string; seller: string; query?: string; intentId: string; acceptIndex: number; offerSha256: string };
  export: ExportInput;
  exports: Partial<Scope> & Page;
  manifest: { exportId: string };
  file: { exportId: string; file: string; expectedManifestSha256: string; expectedSha256?: string; readId?: string; offset?: number; limit?: number };
  file_release: { exportId: string; readId: string };
}
export type OperationStarted = { operationId: string; editionId?: string };
export interface ManifestResult { state: 'MANIFEST_RETAINED'; exportId: string; manifest: ExportManifest; manifestSha256: string; manifestFile: FileIdentity }
export type StartedAction = 'tenant_prepare' | 'tenant_inspect' | 'tenant_review' | 'tenant_apply' | 'tenant_recover' | 'tenant_status' | 'tenant_receive' | 'tenant_export' | 'capture' | 'resume' | 'import' | 'notes' | 'source_save' | 'publication_create' | 'publication_review' | 'publication_recover' | 'publication_publish' | 'merchant_export' | 'merchant_stage' | 'buyer_prepare';
export type Result<K extends keyof Inputs> =
  K extends StartedAction ? OperationStarted :
  K extends 'operation' ? { workspace: string; operation: Operation } :
  K extends 'manifest' | 'export' ? ManifestResult :
  K extends 'rows' ? { records: NativeResult[]; page: { offset: number; limit: number; returned: number; total: number; next: number | null } } :
  K extends 'file' ? { exportId: string; manifestSha256: string; file: FileIdentity; readId: string; offset: number; bytesRead: number; nextOffset: number | null; encoding: 'base64'; data: string } :
  NativeResult;
type Camel<S extends string> = S extends `${infer Left}_${infer Right}` ? `${Left}${Capitalize<Camel<Right>>}` : S;
type Methods = { [K in keyof Inputs as Camel<K>]: (args: Inputs[K], options?: RequestOptions) => Promise<Result<K>> };
export type OpendatasoftClient = Methods & {
  readonly endpoint: string;
  call<K extends keyof Inputs>(action: K, args: Inputs[K], options?: RequestOptions): Promise<Result<K>>;
  call(action: string, args?: NativeResult, options?: RequestOptions): Promise<NativeResult>;
  awaitOperation(args: Inputs['operation'], options?: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal }): Promise<{ workspace: string; operation: Operation }>;
};
export declare const opendatasoftActions: Readonly<Record<keyof Inputs, NativeResult>>;
export declare function openOpendatasoftClient(options: ClientOptions): Promise<OpendatasoftClient>;
export interface DownloadOptions {
  url?: string; client?: { endpoint: string; call(name: string, args?: NativeResult, options?: RequestOptions): Promise<NativeResult> };
  exportId: string; directory: string; tokenEnv?: string; environment?: Record<string, string | undefined>;
  signal?: AbortSignal; chunkSize?: number; expectedManifestSha256?: string;
  onProgress?: (progress: { exportId: string; file: string; bytes: number; total: number; state: 'DOWNLOADING' }) => void | Promise<void>;
}
export interface DownloadResult {
  schema: 'stellar-forge.opendatasoft-download-result.v1'; state: 'COMPLETE' | 'REOPENED';
  directory: string; exportId: string; workspace: string; original: SourceIdentity;
  manifestSha256: string; files: number; bytes: number; resumed?: boolean; resumedBytes?: number; verifiedFiles?: FileIdentity[];
}
export declare function downloadOpendatasoftExport(options: DownloadOptions): Promise<DownloadResult>;
export declare function inspectOpendatasoftExport(options: Omit<DownloadOptions, 'directory' | 'chunkSize' | 'onProgress' | 'expectedManifestSha256'>): Promise<{ manifest: ExportManifest; manifestSha256: string }>;
export declare function reopenOpendatasoftExport(options: Pick<DownloadOptions, 'directory' | 'exportId' | 'expectedManifestSha256'>): Promise<DownloadResult>;
