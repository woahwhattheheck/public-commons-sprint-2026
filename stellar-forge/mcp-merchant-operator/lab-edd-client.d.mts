/// <reference types="node" />
/** Laboratory calls retain the original source values and native result shapes. */
import type { WqxNativeClient, WqxRetainedFile, WqxFileRead, WqxInputState } from './wqx-workspace-client.mjs';
export type LaboratoryJson = null | boolean | number | string | LaboratoryJson[] | { [key: string]: LaboratoryJson };
export type LaboratoryObject = { [key: string]: LaboratoryJson };
export type LaboratoryInputRef = `input:${string}` | `file:${string}`;
export type LaboratoryToolName = `merchant_lab_${string}`;
export type LaboratoryFamily = 'current' | 'baseline' | 'correspondence';
export type LaboratorySlot = 'source' | 'baseline' | 'decisions' | 'baseline_decisions' | 'reconciliation';
export interface LaboratoryOptions { signal?: AbortSignal; timeoutMs?: number }
export interface LaboratoryScope { workspace?: string }
export interface LaboratoryPage { offset?: number; limit?: number }
export interface LaboratorySource extends LaboratoryScope {
  requestId: string; expectedRevision?: number; expectedBindingSha256?: string;
}
export interface LaboratoryPreview extends LaboratorySource {
  documents?: Partial<Record<LaboratoryFamily, LaboratoryObject>>;
  documentRefs?: Partial<Record<LaboratoryFamily, LaboratoryInputRef>>;
}
export interface LaboratoryParameters {
  profile: 'equis-lab-3' | 'equis-lab-4' | 'geotech-dts8d'; reviewName: string;
  expectedSourceSha256?: string; encoding?: 'utf-8' | 'windows-1252';
  decisionFormat?: 'json' | 'csv' | 'tsv'; tableScope?: 'issues' | 'all'; tableFields?: string[];
  baselineProfile?: LaboratoryParameters['profile']; baselineEncoding?: LaboratoryParameters['encoding'];
  expectedBaselineSha256?: string; baselineDecisionFormat?: 'json' | 'csv' | 'tsv';
  reconciliationFormat?: 'json' | 'csv' | 'tsv';
}
export type LaboratoryFile = WqxRetainedFile;
export interface LaboratoryCompleteResponse {
  schema: 'stellar-forge.lab-complete-response.v1'; workspace: string; action: string;
  delivery: 'COMPLETE_FILE'; file: LaboratoryFile; [key: string]: unknown;
}
export type LaboratoryReply<T = Record<string, unknown>> = T | LaboratoryCompleteResponse;
export interface LaboratoryBinding {
  schema: 'starforge.lab-edd-operator-source.v1'; requestId: string; reference: string;
  merchant: LaboratoryObject; parameters: LaboratoryParameters; originals: LaboratoryObject;
  current: LaboratoryObject; baseline: LaboratoryObject | null; bindingSha256: string;
}
export interface LaboratoryPreviewResult {
  previewSha256: string; binding: LaboratoryBinding; identity: LaboratoryObject;
  summary: LaboratoryObject; file: LaboratoryFile; revision: number;
}
export interface LaboratoryReview {
  schema: 'starforge.lab-edd-operator-review.v1'; reviewId: string; requestId: string;
  binding: LaboratoryBinding; previewSha256: string; nativeIdentity: LaboratoryObject;
  summary: LaboratoryObject; files: Record<string, LaboratoryFile>;
  jobInputs: Partial<Record<LaboratorySlot, LaboratoryFile>>; reviewSha256: string; createdAt: string;
  reused?: boolean;
}
export interface LaboratoryResult {
  schema: 'starforge.lab-edd-operator-result.v1'; status: 'COMPLETE'; resultId: string;
  file: LaboratoryFile; origin: LaboratoryObject; manifest: LaboratoryObject;
  members: { path: string; bytes: number; sha256: string }[]; receipt: LaboratoryFile; reused?: boolean;
}
export interface LaboratoryDownload {
  schema: string; status: 'COMPLETE' | 'REOPENED'; directory: string; filename: string;
  file: LaboratoryFile; bytes: number; sha256: string; resumedBytes: number;
}
export interface LaboratoryTransferOptions extends LaboratoryOptions {
  chunkSize?: number; onProgress?: (value: Record<string, unknown>) => void | Promise<void>;
}
export class LaboratoryWorkspaceClient {
  constructor(options: { client: WqxNativeClient; workspace?: string });
  readonly workspace: string | undefined; readonly endpoint: string; readonly closed: boolean;
  /** Close this client only; Stop/recovery remains an explicit original owner operation. */
  close(): void;
  call<T = Record<string, unknown>>(name: LaboratoryToolName, args?: Record<string, unknown>, options?: LaboratoryOptions): Promise<LaboratoryReply<T>>;
  status(args?: LaboratoryScope, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  profiles(args?: LaboratoryScope, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  discover(args?: LaboratoryScope, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  requestCreate(args: LaboratoryScope & { catalogRef: LaboratoryInputRef; expectedCatalogSha256: string;
    reference: string; parameters: LaboratoryParameters; label?: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  requests(args?: LaboratoryScope & LaboratoryPage & { q?: string; phase?: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  request(args: LaboratoryScope & { requestId: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  select(args: LaboratoryScope & { requestId: string; slot: LaboratorySlot; inputRef: LaboratoryInputRef;
    expectedSha256: string; expectedRevision: number }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  remove(args: LaboratoryScope & { requestId: string; slot: LaboratorySlot; expectedRevision: number }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  inspect(args: LaboratorySource, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  rows(args: LaboratorySource & LaboratoryPage & { side?: 'current' | 'baseline'; section?: string; field?: string; q?: string; recordId?: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  issues(args: LaboratorySource & LaboratoryPage & { side?: 'current' | 'baseline'; severity?: string; code?: string; q?: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  groups(args: LaboratorySource & LaboratoryPage & { status?: string; kind?: string; groupId?: string; q?: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  preview(args: LaboratoryPreview, options?: LaboratoryOptions): Promise<LaboratoryReply<LaboratoryPreviewResult>>;
  table(args: LaboratoryPreview & { family?: LaboratoryFamily; format?: 'csv' | 'tsv'; scope?: 'issues' | 'all'; fields?: string[] }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  tableImport(args: LaboratorySource & { family: LaboratoryFamily; inputRef: LaboratoryInputRef }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  reviewSave(args: LaboratoryPreview & { reviewId: string; expectedPreviewSha256: string }, options?: LaboratoryOptions): Promise<LaboratoryReply<LaboratoryReview>>;
  reviews(args?: LaboratoryScope & LaboratoryPage & { requestId?: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  review(args: LaboratoryScope & { reviewId: string }, options?: LaboratoryOptions): Promise<LaboratoryReply<LaboratoryReview>>;
  reviewApply(args: LaboratoryScope & { requestId: string; applyId: string; reviewId: string;
    expectedReviewSha256: string; expectedRevision: number }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  intake(args: LaboratoryScope & { requestId: string; action: 'prepare' | 'import' | 'withdraw' | 'stop' | 'wait';
    expectedRevision?: number; reason?: string; taskId?: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  accessRefresh(args: LaboratoryScope & { requestId: string; expectedRevision: number }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  checkouts(args?: LaboratoryScope & LaboratoryPage & { phase?: string; q?: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  checkout(args: LaboratoryScope & { checkoutId: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  checkoutAction(args: LaboratoryScope & { checkoutId: string; action: 'review' | 'execute' | 'recover' | 'stop' | 'wait';
    expectedRevision?: number; taskId?: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  approval(args: LaboratoryScope & { checkoutId: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  approvalDecide(args: LaboratoryScope & { checkoutId: string; intent: string; approvalId: string; requestSha256: string;
    decision: 'approve' | 'reject'; taskId: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  customers(args?: LaboratoryScope & LaboratoryPage & { q?: string; state?: string; view?: 'active' | 'archived' | 'all' }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  customer(args: LaboratoryScope & { entryId: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  customerAction(args: LaboratoryScope & { entryId: string; action: 'refresh' | 'watch' | 'fetch' | 'stop' | 'wait';
    deadlineMs?: number; pollMs?: number; taskId?: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  merchantStatus(args?: LaboratoryScope, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  merchantJob(args: LaboratoryScope & { jobId: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  jobAction(args: LaboratoryScope & { jobId: string; action: 'cancel' | 'retry'; expectedRevision: number; reason: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  worker(args: LaboratoryScope & { action: 'start' | 'stop' }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  resultOpen(args: LaboratoryScope & { expectedSha256: string } & ({ inputRef: LaboratoryInputRef; resourceId?: never } | { resourceId: string; inputRef?: never }), options?: LaboratoryOptions): Promise<LaboratoryReply<LaboratoryResult>>;
  result(args: LaboratoryScope & LaboratoryPage & { resultId: string; member?: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  files(args?: LaboratoryScope & LaboratoryPage & { expectedSnapshot?: string }, options?: LaboratoryOptions): Promise<LaboratoryReply>;
  inputBegin(args: { inputId: string; name: string; contentType: string; bytes: number; sha256: string }, options?: LaboratoryOptions): Promise<WqxInputState>;
  inputStatus(args: { inputId: string }, options?: LaboratoryOptions): Promise<WqxInputState>;
  inputAppend(args: { inputId: string; sha256: string; offset: number; dataBase64: string }, options?: LaboratoryOptions): Promise<WqxInputState>;
  inputFinish(args: { inputId: string; sha256: string }, options?: LaboratoryOptions): Promise<WqxInputState>;
  fileRead(args: { fileId: string; expectedSha256: string; readId?: string; offset?: number; limit?: number }, options?: LaboratoryOptions): Promise<WqxFileRead>;
  fileRelease(args: { fileId: string; readId: string }, options?: LaboratoryOptions): Promise<{ fileId: string; readId: string; released: boolean }>;
}
export function openLaboratoryWorkspaceClient(options: {
  client?: WqxNativeClient; url?: string; workspace?: string; tokenEnv?: string; environment?: NodeJS.ProcessEnv; signal?: AbortSignal;
}): Promise<LaboratoryWorkspaceClient>;
export function uploadLaboratoryInput(client: LaboratoryWorkspaceClient, input: {
  path: string; inputId: string; name?: string; contentType?: string; expectedSha256?: string; maximumBytes?: number;
}, options?: LaboratoryTransferOptions): Promise<Record<string, unknown> & { inputRef: LaboratoryInputRef; sha256: string }>;
export function downloadLaboratoryFile(client: LaboratoryWorkspaceClient, input: {
  file: LaboratoryFile; directory: string; name?: string;
}, options?: LaboratoryTransferOptions): Promise<LaboratoryDownload>;
export function reopenLaboratoryDownload(input: { directory: string; expectedSha256?: string }): Promise<LaboratoryDownload>;
export function receiveLaboratoryReply<T>(client: LaboratoryWorkspaceClient, reply: LaboratoryReply<T>, options: {
  directory: string; signal?: AbortSignal; timeoutMs?: number;
}): Promise<{ value: T; download: LaboratoryDownload | null }>;
export function downloadLaboratoryReview(client: LaboratoryWorkspaceClient, input: {
  reviewId: string; expectedReviewSha256: string; directory: string;
}, options?: LaboratoryTransferOptions): Promise<{ status: 'COMPLETE'; directory: string; editor: string;
  correspondenceEditor: string | null; files: Record<string, unknown>[] }>;
