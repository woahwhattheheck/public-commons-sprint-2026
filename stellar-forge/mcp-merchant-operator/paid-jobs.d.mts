/** Original paid-job workspace attachment. Every tool borrows its selected merchant. */
export interface PaidJobSourceSelection { configSha256: string; applicationSha256: string }
export interface PaidJobWorkspaceSelection {
  label: string; directory: string; source: PaidJobSourceSelection;
  launchFile?: string; urlFile?: string; runtimeDirectory?: string; selectionSha256?: string;
}
export interface PaidJobWorkspaceConfiguration {
  schema: 'stellar-forge.paid-job-workspace-connection.v1';
  selectionSha256: string; workspaces: Record<string, PaidJobWorkspaceSelection>;
}
export const PAID_JOB_WORKSPACE_CONNECTION_SCHEMA: 'stellar-forge.paid-job-workspace-connection.v1';
export function readPaidJobWorkspaceConfiguration(path: string): Promise<PaidJobWorkspaceConfiguration>;
type Workspace = { workspace: string };
type Job = Workspace & { jobId: string };
type Page = { cursor?: string; limit?: number };
type JobDecision = Job & { expectedRevision: number; reason: string };
type CaseDecision = Job & { requestId: string; expectedRevision: number };
export interface PaidJobToolArguments {
  merchant_jobs_status: Workspace;
  merchant_jobs_jobs: Workspace & Page & { q?: string; status?: string; functionId?: string };
  merchant_jobs_job: Job;
  merchant_jobs_prepare: Workspace & { requestId: string; functionId: string; input: Record<string, unknown>;
    reference?: string; label?: string; claimToken?: string };
  merchant_jobs_renew: JobDecision & { requestId: string };
  merchant_jobs_cancel: JobDecision;
  merchant_jobs_retry: JobDecision;
  merchant_jobs_reconcile: Workspace;
  merchant_jobs_worker: Workspace & { action: 'start' | 'stop' };
  merchant_jobs_inputs: Workspace & { q?: string; functionId?: string; reference?: string;
    state?: 'UPLOADING' | 'SEALED'; ownership?: 'UNASSIGNED' | 'ORPHAN_PIN' | 'RETAINED_JOB'; offset?: number; limit?: number };
  merchant_jobs_input: Workspace & { uploadId: string };
  merchant_jobs_input_preview: Workspace & { uploadId: string; maxBytes?: number };
  merchant_jobs_input_discard: Workspace & { uploadId: string; expectedRevision: number; reason: string; releaseOrphan?: boolean };
  merchant_jobs_case_read: Job & Page & { section?: 'summary' | 'issues' | 'messages' | 'decisions' | 'operations' |
    'previews' | 'history' | 'accounting' | 'receipt'; requestId?: string };
  merchant_jobs_case_reply: CaseDecision & { message: string; issueId?: string };
  merchant_jobs_case_state: CaseDecision & { state: 'OPEN' | 'CLOSED'; message: string; actor: string };
  merchant_jobs_case_job: CaseDecision & { kind: 'RETRY_JOB' | 'CANCEL_JOB'; expectedJobRevision: number; message: string; actor: string };
  merchant_jobs_accounting: Workspace;
  merchant_jobs_case_bind: Job & { runId: string; expectedRevision: number };
  merchant_jobs_case_refresh: Job;
  merchant_jobs_case_preview: CaseDecision & { kind: 'REFUND' | 'CANCELLATION'; amountAtomic: string;
    effectiveAt: string; reason: string; actor: string; reference?: string };
  merchant_jobs_case_record: CaseDecision;
  merchant_jobs_case_verify: CaseDecision & { adjustmentId: string; transaction: string; actor: string };
  merchant_jobs_case_withdraw: CaseDecision & { adjustmentId: string; actor: string; reason: string };
  merchant_jobs_case_recover: Job & { requestId: string };
  merchant_jobs_case_resume: CaseDecision;
  merchant_jobs_case_receive: Workspace & { sourceWorkspace: string; exportId: string; expectedManifestSha256: string };
  merchant_jobs_deliveries: Workspace & { deliveryId?: string };
  merchant_jobs_delivery_control: Workspace & ({ action: 'scan' | 'drain' | 'start' | 'stop' } |
    { action: 'requeue'; deliveryId: string; expectedRevision: number; reason: string });
  merchant_jobs_export: Job & { requestId: string; expectedRevision: number; expectedCaseRevision: number | null };
  merchant_jobs_exports: Workspace & Page & { jobId?: string };
  merchant_jobs_manifest: Workspace & { exportId: string };
  merchant_jobs_file: Workspace & { exportId: string; file: string; expectedManifestSha256: string; expectedSha256: string;
    offset?: number; limit?: number; readId?: string };
  merchant_jobs_file_release: Workspace & { exportId: string; readId: string };
}
export class MerchantPaidJobWorkspaces {
  constructor(config: { paidJobWorkspaces?: PaidJobWorkspaceConfiguration | null });
  readonly summary: {
    configured: boolean; ownership: 'ORIGINAL_PAID_JOB_MERCHANT';
    workspaces: Array<{ workspace: string; label: string; source: PaidJobSourceSelection;
      launch: 'MANAGED_APPLICATION' | 'ORIGINAL_OPERATOR_URL' }>;
    activeCalls: number; activeFileReads: number; closing: boolean;
  };
  call<K extends keyof PaidJobToolArguments>(name: K, args: PaidJobToolArguments[K]):
    Promise<Record<string, unknown> & { workspace: string }>;
  cancel(): void;
  close(): Promise<void>;
}
