/// <reference types="node" />
/** Control of one original running API-pass workspace through merchant MCP. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface RequestOptions { requestSignal?: AbortSignal | null; timeoutMs?: number; }
export interface MutationIdentity { operationId: string; expectedRevision: number; }
export interface PageSelection { offset?: number; limit?: number; expectedRevision?: number; }
export interface Page<T> { items: T[]; offset: number; limit: number; total: number; nextOffset: number | null; revision: number; }
export interface FileIdentity { name?: string; bytes: number; sha256: string; contentType?: string; downloadUrl?: string; }
export interface Allowance { allowanceUnits: number; consumedUnits: number; reservedUnits: number; availableUnits: number; }
export interface PurchasedRoute { id: string; method: string; path: string; units: number; [key: string]: unknown; }
export interface OriginalReview { id: string; sha256: string; reviewedAt: string; downloadUrl: string; }
export interface PassSummary {
 id: string; label: string; archived: boolean; mode: 'access' | 'purchase'; createdAt: string; updatedAt: string;
 orderReference: string; gatewayBaseUrl: string; manifestSha256: string; claimEnv: string; claimAvailable: boolean;
 intentId: string | null; purchasePrepared: boolean; checkedAt: string | null; callCount: number;
 error: { code: string; at: string } | null;
}
export interface ApiPass extends PassSummary {
 handoff: Json | null; detail: { plan: { routes: PurchasedRoute[]; [key: string]: unknown }; usage: Allowance; native: Json; [key: string]: unknown } | null;
 native: Json | null; review: OriginalReview | null; lostOutputAttempt: { id: string; snapshot: Record<string, Json> } | null; activeTasks: NativeTask[];
}
export interface OriginalCall {
 id: string; profileId: string; requestId: string; label: string; routeId: string; method: string; path: string; units: number;
 query: [string, string][]; contentType: string; body: Pick<FileIdentity, 'bytes' | 'sha256'> | null; fingerprint: string;
 status: string; createdAt: string; updatedAt: string; recoveryOnly?: boolean; error?: Json;
 result: (FileIdentity & { status: number; replayed: boolean; downloadUrl: string; previewUrl: string }) | null;
 history: Json[];
}
export type TaskKind = 'refresh' | 'call' | 'recover' | 'prepare-purchase' | 'review-purchase' | 'execute-purchase' |
 'recover-purchase' | 'finalize-purchase' | 'report-purchase' | 'inspect-lost-output' | 'recover-lost-output' |
 'read-lost-output' | 'export-lost-output';
export interface NativeTask {
 id: string; profileId: string; callId?: string; kind: TaskKind; status: 'QUEUED' | 'RUNNING' | 'CANCELLING' | 'COMPLETED' | 'ATTENTION' | 'INTERRUPTED' | 'CANCELLED';
 createdAt: string; startedAt?: string; finishedAt?: string; error: Json | null;
 reviewId?: string; result: ({ proof?: FileIdentity; report?: FileIdentity; [key: string]: unknown }) | null;
}
export interface OriginalOperationReceipt { id: string; requestSha256: string; phase: 'COMPLETE'; replayed: boolean; }
export interface MutationResult {
 result: { profileId?: string; callId?: string; taskId?: string; alreadyConnected?: boolean; [key: string]: unknown };
 revision: number; operation: OriginalOperationReceipt;
}
export interface ConnectPassArguments extends MutationIdentity { label: string; gatewayBaseUrl: string; orderReference: string; manifestSha256: string; claimEnv: string; }
export interface PreparePurchaseArguments extends MutationIdentity { label: string; gatewayBaseUrl: string; intentId: string; claimEnv: string; handoff: string; expectedHandoffSha256: string; }
export interface AttachPurchaseArguments extends MutationIdentity { label: string; purchase: string; }
export interface UpdatePassArguments extends MutationIdentity { profileId: string; label: string; archived: boolean; }
export interface PrepareRequestArguments extends MutationIdentity {
 profileId: string; requestId: string; routeId: string; label?: string; query?: [string, string][]; contentType: string;
 bodyFile?: string; expectedBodySha256?: string;
}
export interface AdoptRequestArguments extends MutationIdentity { profileId: string; requestId: string; }
export type EnqueueArguments = MutationIdentity & { profileId: string } & (
 { kind: 'call' | 'recover'; callId: string } |
 { kind: 'inspect-lost-output'; approvedRequestFile: string; expectedApprovedRequestSha256: string } |
 { kind: 'recover-lost-output'; reviewId: string; transaction: string } |
 { kind: 'execute-purchase'; reviewId: string } |
 { kind: Exclude<TaskKind, 'call' | 'recover' | 'inspect-lost-output' | 'recover-lost-output' | 'execute-purchase'> }
);
export interface CancelArguments extends MutationIdentity { taskId: string; }
export interface DecisionArguments { profileId: string; intent: string; approvalId: string; requestSha256: string; decision: 'approve' | 'reject'; }
export type ExportSelection = { kind: 'response'; callId: string } | { kind: 'review' | 'history'; profileId: string } | { kind: 'proof' | 'report'; profileId: string; taskId: string };
export interface CaptureArguments { exportId: string; selection: ExportSelection; expectedSha256?: string; }
export interface ExportSource {
 instanceId: string; launchSha256: string; entrySha256: string; path: string; observedAt: string; nativeSha256: string | null; revision: number | null;
}
export interface ExportManifest {
 schema: 'stellar-forge.sf101.api-pass-mcp-export.v1'; exportId: string; createdAt: string; workspace: { alias: string; id: string };
 selection: ExportSelection; source: ExportSource; requestSha256: string; files: [Required<Pick<FileIdentity, 'name' | 'bytes' | 'sha256' | 'contentType'>>];
}
export interface ExportDescription { state: 'MANIFEST_RETAINED'; exportId: string; workspaceId: string; selection: ExportSelection; manifestFile: Required<Pick<FileIdentity, 'name' | 'bytes' | 'sha256' | 'contentType'>>; file: ExportManifest['files'][0]; }
export interface RetainedChunk {
 exportId: string; manifestSha256: string; readId: string; file: Required<Pick<FileIdentity, 'name' | 'bytes' | 'sha256' | 'contentType'>>;
 offset: number; bytesRead: number; nextOffset: number | null; encoding: 'base64'; data: string;
}
export interface ReadFileArguments { exportId: string; file: string; expectedManifestSha256: string; expectedSha256: string; readId?: string; offset?: number; limit?: number; }
export interface ConnectionOptions { url: string; workspace: string; workspaceId?: string; tokenEnv?: string; environment?: NodeJS.ProcessEnv; signal?: AbortSignal; }
export interface DownloadOptions {
 exportId: string; directory: string; expectedManifestSha256?: string; chunkSize?: number; signal?: AbortSignal;
 onProgress?: (value: { exportId: string; file: string; bytes: number; total: number; state: 'DOWNLOADING' }) => void | Promise<void>;
}
export interface DownloadResult { schema: 'stellar-forge.sf101.api-pass-mcp-download.v1'; state: 'COMPLETE' | 'REOPENED'; directory: string; exportId: string; workspace: ExportManifest['workspace']; selection: ExportSelection; source: ExportSource; manifestSha256: string; files: number; bytes: number; resumed?: boolean; resumedBytes?: number; }
export interface ApiPassOperationArguments {
 open: Record<string, never>; status: Record<string, never>; passes: PageSelection;
 pass: PageSelection & { profileId: string }; call: { callId: string }; call_preview: { callId: string }; body_preview: { callId: string };
 remote_calls: { profileId: string; after?: string; limit?: number }; history: PageSelection & { profileId: string; view: 'calls' | 'tasks' };
 task: { profileId: string; taskId: string }; approval: { profileId: string }; input: { file: string }; operation: { operationId: string };
 connect: ConnectPassArguments; purchase_prepare: PreparePurchaseArguments; purchase_attach: AttachPurchaseArguments; update: UpdatePassArguments;
 prepare_request: PrepareRequestArguments; adopt_request: AdoptRequestArguments; enqueue: EnqueueArguments; cancel: CancelArguments; decide: DecisionArguments;
 capture: CaptureArguments; exports: { offset?: number; limit?: number; expectedInventorySha256?: string }; manifest: { exportId: string };
 file: ReadFileArguments; file_release: { exportId: string; readId: string };
}
export interface ApiPassWorkspaceClient {
 readonly workspace: string; readonly workspaceId: string | undefined; readonly endpoint?: string;
 invoke<K extends keyof ApiPassOperationArguments>(kind: K, args: ApiPassOperationArguments[K], options?: RequestOptions): Promise<Record<string, unknown>>;
 open(args?: Record<string, never>, options?: RequestOptions): Promise<{ session: { schema: string; workspaceId: string; title: string; approvalMode: string; purchaseEnabled: boolean }; launch: Record<string, unknown> }>;
 status(args?: Record<string, never>, options?: RequestOptions): Promise<Record<string, unknown>>;
 passes(args?: PageSelection, options?: RequestOptions): Promise<Page<PassSummary>>;
 pass(args: PageSelection & { profileId: string }, options?: RequestOptions): Promise<{ revision: number; profile: ApiPass; calls: OriginalCall[]; callPagination: Omit<Page<OriginalCall>, 'items' | 'revision'>; tasks: NativeTask[] }>;
 callDetail(args: { callId: string }, options?: RequestOptions): Promise<{ revision: number; call: OriginalCall }>;
 callPreview(args: { callId: string }, options?: RequestOptions): Promise<{ text: string; binary: boolean; truncated: boolean; bytes: number }>;
 bodyPreview(args: { callId: string }, options?: RequestOptions): Promise<{ text: string; binary: boolean; truncated: boolean; bytes: number; present: boolean }>;
 remoteCalls(args: { profileId: string; after?: string; limit?: number }, options?: RequestOptions): Promise<{ schema: string; orderRef: string; calls: Json[]; nextAfter: string | null; usage: Allowance }>;
 history(args: PageSelection & { profileId: string; view: 'calls' | 'tasks' }, options?: RequestOptions): Promise<Page<OriginalCall | NativeTask> & { profileId: string; view: 'calls' | 'tasks' }>;
 task(args: { profileId: string; taskId: string }, options?: RequestOptions): Promise<{ revision: number; task: NativeTask }>;
 approval(args: { profileId: string }, options?: RequestOptions): Promise<{ intentId: string; approval: Json | null; pending: boolean; fresh: boolean; mode: string }>;
 input(args: { file: string }, options?: RequestOptions): Promise<{ handle: string; kind: 'handoff' | 'body' | 'approved-request'; label: string; bytes: number; sha256: string }>;
 operation(args: { operationId: string }, options?: RequestOptions): Promise<Record<string, unknown> & { found: boolean }>;
 connectPass(args: ConnectPassArguments, options?: RequestOptions): Promise<MutationResult>;
 preparePurchase(args: PreparePurchaseArguments, options?: RequestOptions): Promise<MutationResult>;
 attachPurchase(args: AttachPurchaseArguments, options?: RequestOptions): Promise<MutationResult>;
 updatePass(args: UpdatePassArguments, options?: RequestOptions): Promise<MutationResult>;
 prepareRequest(args: PrepareRequestArguments, options?: RequestOptions): Promise<MutationResult>;
 adoptRequest(args: AdoptRequestArguments, options?: RequestOptions): Promise<MutationResult>;
 enqueue(args: EnqueueArguments, options?: RequestOptions): Promise<MutationResult>;
 cancel(args: CancelArguments, options?: RequestOptions): Promise<MutationResult>;
 decide(args: DecisionArguments, options?: RequestOptions): Promise<MutationResult>;
 capture(args: CaptureArguments, options?: RequestOptions): Promise<ExportDescription>;
 exports(args?: { offset?: number; limit?: number; expectedInventorySha256?: string }, options?: RequestOptions): Promise<Record<string, unknown>>;
 manifest(args: { exportId: string }, options?: RequestOptions): Promise<ExportDescription>;
 readFileChunk(args: ReadFileArguments, options?: RequestOptions): Promise<RetainedChunk>;
 releaseFile(args: { exportId: string; readId: string }, options?: RequestOptions): Promise<{ exportId: string; readId: string; released: true }>;
 allPasses(options?: RequestOptions): Promise<{ revision: number; items: PassSummary[] }>;
 allHistory(args: { profileId: string; view: 'calls' | 'tasks' }, options?: RequestOptions): Promise<{ profileId: string; view: 'calls' | 'tasks'; revision: number; items: (OriginalCall | NativeTask)[] }>;
 downloadExport(options: DownloadOptions): Promise<DownloadResult>;
 disconnect(): Promise<void>;
}
export function createApiPassWorkspaceClient(options: { workspace: string; workspaceId?: string; endpoint?: string; call: (name: string, args: Record<string, unknown>, options?: RequestOptions) => Promise<unknown> }): ApiPassWorkspaceClient;
export function connectApiPassWorkspaceClient(options: ConnectionOptions): Promise<ApiPassWorkspaceClient>;
export function downloadApiPassExport(options: ConnectionOptions & DownloadOptions): Promise<DownloadResult>;
export function inspectApiPassExportDownload(options: ConnectionOptions & { exportId: string }): Promise<{ manifest: ExportManifest; manifestSha256: string }>;
export function reopenApiPassExportDownload(options: { directory: string; expectedManifestSha256?: string; workspace?: string; workspaceId?: string }): Promise<DownloadResult>;
