// MIT. Public types for the original Buyer application agent.
export type JSONValue = null | boolean | number | string | ReadonlyArray<JSONValue> | { readonly [key: string]: JSONValue };
export type JSONObject = { readonly [key: string]: JSONValue };
export type ApprovalMode = 'BROWSER' | 'TERMINAL';
export interface RequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface BuyerConnection {
 schema: 'stellar-forge.buyer-runbook-workspace-launch.v1';
 directory: string; selectionSha256: string; instanceId: string; pid: number; url: string;
 approvalMode: ApprovalMode; approvalAvailable: boolean; launchSha256: string;
 sourceFiles: ReadonlyArray<JSONObject>;
}
export interface NativeExecution extends JSONObject {
 executionId: string; runId: string; kind: string; only: string | null;
 startedAt: string; status: string; cancelRequested: boolean; finishedAt: string | null;
}
export interface NativeBuyerRun extends JSONObject {
 id: string; state: JSONObject; active: NativeExecution | null;
 terminalAvailable: boolean; approvalMode: ApprovalMode; approvalAvailable: boolean;
}
export interface NativeApproval extends JSONObject {
 current: JSONObject | null; approval: JSONObject | null;
}
export interface OriginalPage<T extends JSONValue = JSONObject> extends JSONObject {
 items: ReadonlyArray<T>; offset: number; limit: number; total: number;
 nextOffset: number | null; stateSha256: string;
}
export interface OriginalFile extends JSONObject {
 name: string; bytes: number; sha256: string;
}
export interface RetainedManifest extends JSONObject {
 state: 'MANIFEST_RETAINED'; exportId: string; manifest: JSONObject;
 manifestSha256: string; manifestFile: OriginalFile;
}
export interface RetainedChunk extends JSONObject {
 exportId: string; manifestSha256: string; readId: string;
 file: OriginalFile; offset: number; bytesRead: number; nextOffset: number | null;
 encoding: 'base64'; data: string;
}
export interface BuyerActionInputs {
  "open": { "workspace": string };
  "status": { "workspace": string };
  "list": { "workspace": string; "collection": "drafts" | "acquisitions" | "configurations" | "requests" | "clients" | "paidFiles" | "recovery"; "offset"?: number; "limit"?: number; "expectedStateSha256"?: string };
  "operator": { "workspace": string };
  "operator_revision": { "workspace": string; "id": string };
  "operator_review": { "workspace": string; "settings": string; "expectedSettingsSha256": string; "expectedStateSha256": string; "note"?: string; "sourceRevision"?: string };
  "operator_save": { "workspace": string; "settings": string; "expectedSettingsSha256": string; "expectedStateSha256": string; "note"?: string; "sourceRevision"?: string; "expectedReviewSha256": string; "requestId": string };
  "client": { "workspace": string; "id": string };
  "receive_client": { "workspace": string; "file": string; "expectedSha256": string; "requestId": string };
  "client_file": { "workspace": string; "id": string; "file": string; "name": "seller-client.mjs" | "seller-client.d.mts" | "seller-openapi.json" | "package.json" | "README.md"; "expectedSha256": string; "requestId": string };
  "client_request": { "workspace": string; "id": string; "expectedManifestSha256": string; "operationId": string; "intentId": string; "values": Readonly<Record<string, JSONValue>>; "ticket"?: { "file": string; "expectedSha256": string; "header"?: string }; "requestId": string };
  "request": { "workspace": string; "id": string };
  "receive_request": { "workspace": string; "file": string; "expectedSha256": string; "filename": string; "requestId": string };
  "review_request": { "workspace": string; "id": string; "acceptIndex": number; "totalAtomic": string; "dailyAtomic": string; "requestId": string };
  "prepare_request": { "workspace": string; "id": string; "reviewSha256": string; "requestId": string };
  "paid_file": { "workspace": string; "id": string };
  "receive_paid_file": { "workspace": string; "file": string; "expectedSha256": string; "filename": string; "requestId": string };
  "review_paid_file": { "workspace": string; "id": string; "expectedRevision": number; "totalAtomic": string; "dailyAtomic": string; "filename": string; "claimEnv": string; "requestId": string };
  "prepare_paid_file": { "workspace": string; "id": string; "reviewSha256": string; "requestId": string };
  "draft": { "workspace": string; "id": string; "revision"?: number };
  "save_draft": { "workspace": string; "id"?: string; "expectedRevision": number; "manifest": { "schema": "stellar-forge.buyer-runbook.v1"; "id": string; "title": string; "operations": ReadonlyArray<{ "id": string; "label": string; "config": string; "saveAs"?: string }> }; "requestId": string };
  "initialize": { "workspace": string; "id": string; "expectedRevision": number; "reviewSha256": string; "requestId": string };
  "run": { "workspace": string; "id": string };
  "execute": { "workspace": string; "id": string; "only"?: string; "requestId": string };
  "finalize": { "workspace": string; "id": string; "only"?: string; "requestId": string };
  "cancel": { "workspace": string; "id": string; "executionId": string; "requestId": string };
  "recover": { "workspace": string; "id": string; "requestId": string };
  "unlock": { "workspace": string; "id": string; "ownerPid": number; "requestId": string };
  "bind_accounting": { "workspace": string; "id": string; "only": string; "operator": string; "requestId": string };
  "retrieve_file": { "workspace": string; "id": string; "only": string; "configSha256": string; "handoffSha256": string; "requestId": string };
  "reset_file": { "workspace": string; "id": string; "only": string; "configSha256": string; "handoffSha256": string; "requestId": string };
  "approval": { "workspace": string };
  "resource_preview": { "workspace": string; "id": string; "operation": string };
  "backup_review": { "workspace": string; "profile": string; "expectedProfileSha256": string };
  "backup_start": { "workspace": string; "profile": string; "expectedProfileSha256": string; "kind": "SNAPSHOT" | "VERIFY"; "expectedReviewSha256"?: string; "quiesced"?: boolean; "requestId": string };
  "backup_cancel": { "workspace": string; "id": string; "requestId": string };
  "operation": { "workspace": string; "requestId": string };
  "resume": { "workspace": string; "requestId": string };
  "reconcile": { "workspace": string; "requestId": string; "id"?: string };
  "capture": { "workspace": string; "exportId": string; "files": ReadonlyArray<{ "kind": "sdk" | "operator" | "request" | "paid-handoff" | "resource" | "paid-resource" | "report" | "accounting"; "id": string; "name"?: "client-export.json" | "seller-client.mjs" | "seller-client.d.mts" | "seller-openapi.json" | "package.json" | "README.md" | "body" | "handoff"; "operation"?: string; "format"?: "json" | "html"; "expectedSha256"?: string }> };
  "exports": { "workspace": string; "offset"?: number; "limit"?: number };
  "manifest": { "workspace": string; "exportId": string };
  "file": { "workspace": string; "exportId": string; "file": string; "expectedManifestSha256": string; "expectedSha256"?: string; "readId"?: string; "offset"?: number; "limit"?: number };
  "file_release": { "workspace": string; "exportId": string; "readId": string };
}
export type BuyerAction = keyof BuyerActionInputs;
export type NativeReply<K extends BuyerAction> =
 K extends 'run' ? NativeBuyerRun :
 K extends 'approval' ? NativeApproval :
 K extends 'list' ? OriginalPage :
 K extends 'manifest' ? RetainedManifest :
 K extends 'file' ? RetainedChunk : JSONObject;
export interface BuyerAgentReply<Native = JSONObject> {
 schema: 'stellar-forge.buyer-runbook.agent.v1';
 workspace: string; native: Native; connection?: BuyerConnection;
 operation?: JSONObject;
}
export interface BuyerWorkspaceSummary {
 alias: string; label: string; directory: string; selectionSha256: string;
 inputs: ReadonlyArray<{handle: string; label: string; kind: string; sha256: string}>;
 operators: ReadonlyArray<string>; receiving: JSONObject;
}
export interface BuyerAgentSummary {
 configured: boolean; closing: boolean; pendingRequests: number;
 workspaces: ReadonlyArray<BuyerWorkspaceSummary>;
}
export type InputKind = 'settings' | 'sdk-manifest' | 'sdk-file' | 'request-handoff' | 'paid-handoff' | 'ticket' | 'backup-profile';
export interface NormalizedInput { path: string; kind: InputKind; sha256: string; label: string; maximum: number }
export interface NormalizedWorkspace {
 label: string; directory: string; launchFile: string; expectedSelectionSha256: string; storageDirectory: string;
 files: Readonly<Record<string, NormalizedInput>>; operators: Readonly<Record<string, string>>;
 maximumFileBytes: number; maximumExportBytes: number; maximumExports: number;
}
export interface BuyerAgentConfiguration {
 schema: 'stellar-forge.buyer-runbook.agent-connections.v1';
 workspaces: Readonly<Record<string, NormalizedWorkspace>>;
}
export interface RetainedFileClient {
 endpoint: string;
 call(name: string, args: JSONObject, options?: unknown): Promise<JSONObject>;
}
export interface DownloadProgress { exportId: string; file: string; bytes: number; total: number; state: 'DOWNLOADING' }
export interface DownloadSelection {
 exportId: string; directory: string; expectedManifestSha256?: string;
 chunkSize?: number; signal?: AbortSignal;
 onProgress?: (progress: DownloadProgress) => void | Promise<void>;
}
export interface DownloadResult {
 schema: 'stellar-forge.buyer-runbook.agent-download-result.v1'; state: 'COMPLETE';
 directory: string; exportId: string; workspaceDirectory: string; selectionSha256: string;
 manifestSha256: string; resumed: boolean; resumedBytes: number; files: number; bytes: number;
}
export class BuyerRunbookAgent {
 constructor(configuration: BuyerAgentConfiguration);
 static fromFile(path: string): Promise<BuyerRunbookAgent>;
 get summary(): BuyerAgentSummary;
 call(name: 'workspaces' | 'merchant_buyer_runbook_workspaces', input?: Record<string, never>, options?: RequestOptions): Promise<BuyerAgentSummary & {schema: 'stellar-forge.buyer-runbook.agent.v1'}>;
 call<K extends BuyerAction>(name: K | `merchant_buyer_runbook_${K}`, input: BuyerActionInputs[K], options?: RequestOptions): Promise<BuyerAgentReply<NativeReply<K>>>;
 fileClient(workspace: string): RetainedFileClient;
 download(options: DownloadSelection & {workspace: string}): Promise<DownloadResult>;
 close(): Promise<void>;
}
export class MerchantBuyerRunbookWorkspaces extends BuyerRunbookAgent {
 constructor(config: {buyerRunbookWorkspaces?: BuyerAgentConfiguration});
}
export function readBuyerAgentConfiguration(path: string): Promise<BuyerAgentConfiguration>;
export function buyerRunbookWorkspaceTools(tool: (name: string, description: string, properties: object, required: string[], annotations: object) => unknown): ReadonlyArray<unknown>;
export function downloadBuyerRunbookExport(options: DownloadSelection & ({client: RetainedFileClient; url?: never} | {url: string; workspace: string; client?: never; tokenEnv?: string; environment?: Record<string, string | undefined>})): Promise<DownloadResult>;

export function connectBuyerRunbookFileClient(options: {url: string; workspace: string; tokenEnv?: string; environment?: Record<string, string | undefined>; signal?: AbortSignal}): Promise<RetainedFileClient>;
