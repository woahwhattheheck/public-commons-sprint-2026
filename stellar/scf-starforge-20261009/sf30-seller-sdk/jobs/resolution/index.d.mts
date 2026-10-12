import type {IncomingMessage} from 'node:http';
import type {Buffer} from 'node:buffer';

export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};
export type OriginalRecord = Record<string, unknown>;
export type JobState = 'PREPARED' | 'AWAITING_SETTLEMENT' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'INTERRUPTED' | 'CANCELLED' | 'CANCELLING';
export type RequestState = 'PREPARED' | 'DISPATCHING' | 'RECORDED' | 'FAILED' | 'UNKNOWN';
export interface RequestIdentity {requestId: string; expectedRevision: number}
export interface Connection {connected: boolean; origin: string | null; borrowed: boolean}
export interface JobPayment {network: string; asset: string; payTo: string; amountAtomic: string}
export interface NativeSettlement {id: string; at: string; receiptFingerprint: string; transactionFingerprint: string | null}
export interface JobBinding {
  jobId: string; functionId: string; inputSha256: string; payment: JobPayment;
  settlement: NativeSettlement & OriginalRecord;
}
export interface SourceBinding {
  runId: string; eventId: string; reportSha256: string;
  manifestSha256?: string | null; inputManifestSha256: string;
}
export interface AdjustmentTotals {
  grossAmountAtomic: string; refundedAmountAtomic: string; pendingRefundAmountAtomic: string;
  remainingAmountAtomic: string; availableRefundAmountAtomic: string; cancelledAmountAtomic: string;
  overRefundedAmountAtomic: string; refundStatus: 'NONE' | 'PARTIAL' | 'FULL' | 'OVER_RETURNED';
  adjustmentCount: number;
}
export interface CustomerIssue {id: string; message: string; requestedRemedy: 'RETRY' | 'REFUND' | 'CONTACT'; createdAt: string}
export interface CaseMessage {id: string; author: 'MERCHANT' | 'CUSTOMER'; text: string; issueId: string | null; at: string}
export interface CaseDecision {id: string; kind: string; at: string; message: string; state: RequestState; actor?: string}
export interface VerifiedReturn {
  transaction: string; ledger: number; transferAt: string | null; verifiedAt: string; proof: OriginalRecord;
}
export interface CustomerAdjustment {
  id: string; kind: 'REFUND' | 'CANCELLATION';
  status: 'REQUESTED' | 'VERIFYING' | 'VERIFIED' | 'WITHDRAWN' | 'RECORDED';
  amountAtomic: string; effectiveAt: string; recordedAt: string; requestSha256: string;
  source: Pick<SourceBinding, 'runId' | 'reportSha256' | 'inputManifestSha256'>;
  verification: VerifiedReturn | null;
}
export interface JobResolutionReceipt {
  schema: 'stellar-forge.job-resolution.v1'; jobId: string; functionId: string; inputSha256: string;
  revision: number; state: 'OPEN' | 'CLOSED'; createdAt: string; updatedAt: string; jobState: JobState;
  nativeSettlement: NativeSettlement; payment: JobPayment; issues: CustomerIssue[]; messages: CaseMessage[];
  decisions: CaseDecision[];
  accounting: null | {
    source: SourceBinding; observedAt: string; totals: AdjustmentTotals;
    originalProof: OriginalRecord | null; proofSource: {sha256: string; bytes: number} | null;
    adjustments: CustomerAdjustment[];
  };
}
export interface ResolutionOperation {
  id: string; kind: 'RECORD_ADJUSTMENT' | 'VERIFY_REFUND' | 'WITHDRAW_REFUND' | 'RETRY_JOB' | 'CANCEL_JOB';
  request: OriginalRecord; requestSha256: string; state: RequestState;
  createdAt: string; dispatchedAt: string | null; completedAt: string | null;
  result: OriginalRecord | null; error: {code: string} | null;
  nativeJobId?: string; nativeJob?: OriginalRecord; priorNativeJobs?: string[];
}
export interface ResolutionCase {
  schema: 'stellar-forge.job-resolution-case.v1'; job: JobBinding; revision: number; state: 'OPEN' | 'CLOSED';
  createdAt: string; updatedAt: string; issues: CustomerIssue[]; messages: CaseMessage[]; decisions: CaseDecision[];
  operations: ResolutionOperation[]; previews: OriginalRecord[]; history: OriginalRecord[];
  accounting: null | {source: SourceBinding; detail: OriginalRecord; observedAt: string};
}
export interface JobSummary {
  id: string; state: JobState; revision: number; nativeSettlement: {id: string; at: string} | null;
  error: {code: string} | null; result: {bytes: number; sha256: string} | null;
}
export interface ResolutionWorkspace {
  schema: 'stellar-forge.job-resolution-workspace.v1'; job: JobSummary; case: ResolutionCase;
  customer: JobResolutionReceipt; connection: Connection;
}
export interface ResolutionExport {
  schema: 'stellar-forge.job-resolution-export.v1'; exportedAt: string; caseSha256: string;
  case: ResolutionCase; customerReceipt: JobResolutionReceipt;
}
export interface ResolutionFile {bytes: Buffer; type: string; name: string; sha256: string}
export interface MessageRequest extends RequestIdentity {message: string; issueId?: string | null}
export interface IssueRequest extends MessageRequest {requestedRemedy?: 'RETRY' | 'REFUND' | 'CONTACT'}
export interface JobDecisionRequest extends RequestIdentity {
  kind: 'RETRY_JOB' | 'CANCEL_JOB'; expectedJobRevision: number; message: string; actor: string;
}
export interface CaseDecisionRequest extends RequestIdentity {state: 'OPEN' | 'CLOSED'; message: string; actor: string}
export interface AdjustmentPreviewRequest extends RequestIdentity {
  kind: 'REFUND' | 'CANCELLATION'; amountAtomic: string; effectiveAt: string; reason: string; actor: string; reference?: string;
}
export interface VerifyReturnRequest extends RequestIdentity {adjustmentId: string; transaction: string; actor: string; rpcEndpoint?: string}
export interface WithdrawReturnRequest extends RequestIdentity {adjustmentId: string; actor: string; reason: string}

export interface OriginalAdjustmentWorkspace {
  options?: {allowLocalRpc?: boolean};
  workspace: {view(): OriginalRecord};
  view(): OriginalRecord;
  event(runId: string, eventId: string): Promise<OriginalRecord>;
  preview(request: OriginalRecord): Promise<OriginalRecord>;
  record(request: OriginalRecord): Promise<OriginalRecord>;
  detail(adjustmentId: string): Promise<OriginalRecord>;
  verify(adjustmentId: string, request: OriginalRecord): Promise<OriginalRecord>;
  savedJob(jobId: string): Promise<OriginalRecord>;
  withdraw(adjustmentId: string, request: OriginalRecord): Promise<OriginalRecord>;
  export(request: {runId: string; format: 'json'}): Promise<Omit<ResolutionFile, 'sha256'>>;
}
export type AccountingSelection =
  | {controller: OriginalAdjustmentWorkspace; url?: never; timeoutMs?: number}
  | {url: string; controller?: never; timeoutMs?: number};
export interface JobAccounting {
  readonly origin: string | null;
  endpoint(network: string, value?: string): string;
  state(): Promise<OriginalRecord>; view(): Promise<OriginalRecord>;
  event(runId: string, eventId: string): Promise<OriginalRecord>;
  preview(value: OriginalRecord): Promise<OriginalRecord>; record(value: OriginalRecord): Promise<OriginalRecord>;
  detail(id: string): Promise<OriginalRecord>; verify(id: string, value: OriginalRecord): Promise<OriginalRecord>;
  savedJob(id: string): Promise<OriginalRecord>; withdraw(id: string, value: OriginalRecord): Promise<OriginalRecord>;
  export(runId: string): Promise<Omit<ResolutionFile, 'sha256'>>; close(): void;
}
export interface OriginalJobModel {
  directory: string;
  snapshot(): Promise<{jobs: Array<{id: string; nativeSettlement: unknown}>}>;
  get(id: string): Promise<OriginalRecord>;
  customerStatus(request: {id: string; token: string}): Promise<OriginalRecord>;
  retry(request: {id: string; expectedRevision: number; reason: string}): Promise<OriginalRecord>;
  cancel(request: {id: string; expectedRevision: number; reason: string}): Promise<OriginalRecord>;
}
export interface JobResolution {
  readonly directory: string;
  status(): Promise<{schema: string; connection: Connection; closing: boolean}>;
  connect(request: {url: string}): Promise<{connected: true; origin: string}>;
  accountingState(): Promise<{revision: number; runs: OriginalRecord[]}>;
  list(): Promise<{items: Array<OriginalRecord>; connection: Connection}>;
  get(jobId: string): Promise<ResolutionWorkspace>;
  customer(jobId: string, token: string): Promise<JobResolutionReceipt>;
  issue(jobId: string, token: string, input: IssueRequest): Promise<JobResolutionReceipt>;
  customerMessage(jobId: string, token: string, input: MessageRequest): Promise<JobResolutionReceipt>;
  reply(jobId: string, input: MessageRequest): Promise<ResolutionWorkspace>;
  setCase(jobId: string, input: CaseDecisionRequest): Promise<ResolutionWorkspace>;
  jobAction(jobId: string, input: JobDecisionRequest): Promise<ResolutionWorkspace>;
  bind(jobId: string, input: {runId: string; expectedRevision: number}): Promise<ResolutionWorkspace>;
  refresh(jobId: string): Promise<ResolutionWorkspace>;
  preview(jobId: string, input: AdjustmentPreviewRequest): Promise<ResolutionWorkspace>;
  record(jobId: string, input: RequestIdentity): Promise<ResolutionWorkspace>;
  verify(jobId: string, input: VerifyReturnRequest): Promise<ResolutionWorkspace>;
  withdraw(jobId: string, input: WithdrawReturnRequest): Promise<ResolutionWorkspace>;
  recover(jobId: string, input: {requestId: string}): Promise<ResolutionWorkspace>;
  resume(jobId: string, input: RequestIdentity): Promise<ResolutionWorkspace>;
  accountingExport(jobId: string): Promise<ResolutionFile>;
  export(jobId: string): Promise<ResolutionExport>;
  receive(bundle: ResolutionExport): Promise<ResolutionWorkspace>;
  close(): Promise<{closed: true}>;
}
export interface ResolutionAsset {route: string; type: string; bytes: Buffer}
export interface ResolutionResponse {value?: unknown; status?: number; file?: ResolutionFile}
export const CASE_SCHEMA: 'stellar-forge.job-resolution-case.v1';
export const RECEIPT_SCHEMA: 'stellar-forge.job-resolution.v1';
export const EXPORT_SCHEMA: 'stellar-forge.job-resolution-export.v1';
export const RESOLUTION_DOCUMENT_BYTES: number;
export const RESOLUTION_RECEIPT_BYTES: number;
export const RESOLUTION_RECEIVING_BYTES: number;
export const RESOLUTION_REQUEST_BYTES: number;
export function openJobResolution(options: {model: OriginalJobModel; drainingModel?: OriginalJobModel; accounting?: AccountingSelection; fetchImpl?: typeof fetch}): Promise<JobResolution>;
export function createJobAccounting(options: AccountingSelection & {fetchImpl?: typeof fetch}): JobAccounting;
export function accountingOrigin(value: string): string;
export function jobBinding(row: OriginalRecord): JobBinding;
export function bindAccounting(binding: JobBinding, detail: OriginalRecord, pinned?: SourceBinding): {source: SourceBinding; detail: OriginalRecord};
export function validateReceipt(value: unknown, acceptance: OriginalRecord): JobResolutionReceipt;
export function jobResolutionAssets(): Promise<ResolutionAsset[]>;
export function resolutionOperatorPath(path: string): boolean;
export function resolutionCustomerPath(path: string): boolean;
export function readResolutionJson(request: IncomingMessage, options?: {maxBytes?: number}): Promise<OriginalRecord>;
export function readResolutionRequest(request: IncomingMessage, options?: {maxBytes?: number}): Promise<OriginalRecord | undefined>;
export function handleJobResolutionOperator(service: JobResolution, input: {method: string; path: string; value?: OriginalRecord}): Promise<ResolutionResponse | null>;
export function handleJobResolutionCustomer(service: JobResolution, input: {method: string; path: string; token: string; value?: OriginalRecord}): Promise<ResolutionResponse | null>;
export function runJobResolutionCommand(argv: string[], options?: {signal?: AbortSignal}): Promise<unknown>;
