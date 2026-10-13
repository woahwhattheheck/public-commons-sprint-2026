// MIT. Typed caller over the original paid-job MCP transport and native commissioning receiver.
import type {
  DownloadPaidJobExportOptions, ReopenPaidJobExportOptions, PaidJobReceivingResult,
  PaidJobInputDescriptor,
} from '../../../../../stellar-forge/mcp-merchant-operator/paid-jobs-client.mjs';

export declare const COMMISSIONING_CUSTOMER_SCHEMA: 'starforge.wqx-commissioning-customer-receiving.v1';
export type CommissioningExportFormat =
  | 'bundle' | 'review' | 'decisions' | 'observations' | 'counterparts'
  | 'correspondences' | 'series' | 'report';
export interface CompleteFileIdentity {
  bytes: number;
  sha256: string;
}
export interface CommissioningJobInput {
  mode: 'commissioning';
  /** The immutable review name selected in the complete source bundle. */
  reviewId: string;
  expectedCommissioningSavedSha256: string;
  expectedCommissioningReviewSha256: string;
  /** Supplied by the original sealed upload controller, never a local pathname. */
  $files?: { source: PaidJobInputDescriptor };
}
export interface CommissioningSourceBinding {
  kiwisEditionSha256: string;
  counterpart: {
    kind: 'wqx-review' | 'wqx-scientific' | 'lab-edd-result' | 'kiwis-wqm';
    sourceSha256: string;
  };
}
export interface CommissioningJobIdentity {
  reviewId: string;
  sourceId: string;
  title: string;
  savedSha256: string;
  reviewSha256: string;
  documentSha256: string;
  sourceSha256: string;
  source: CommissioningSourceBinding;
  counts: Record<string, number>;
  inputSha256: string;
  bundleSha256: string;
}
export interface InspectCommissioningSourceOptions {
  sourceFile: string;
  expectedSourceSha256: string;
  signal?: AbortSignal;
}
export interface CommissioningSourceInspection {
  sourceFile: string;
  source: CompleteFileIdentity & { filename: string; contentType: 'application/json' };
  input: CommissioningJobInput;
  commissioning: CommissioningJobIdentity;
}
export interface CommissioningNativeExport extends CompleteFileIdentity {
  format: CommissioningExportFormat;
  /** Absolute verified local file path. */
  path: string;
  /** Original native filename, unchanged by the transport member path. */
  filename: string;
  contentType: string;
}
export interface CommissioningReceivedProject {
  directory: string;
  reviewId: string;
  sourceId: string;
  savedSha256: string;
  reviewSha256: string;
  reopened: true;
}
export interface ReceiveCommissioningResultOptions {
  archiveFile: string;
  expectedArchiveSha256: string;
  /** A new private directory or the same retained original receiving directory. */
  directory: string;
  python?: string;
  expectedJobId?: string;
  expectedRequest?: CommissioningJobInput;
  expectedSource?: CompleteFileIdentity;
  signal?: AbortSignal;
}
export interface CommissioningCustomerResult {
  schema: typeof COMMISSIONING_CUSTOMER_SCHEMA;
  completedAt: string;
  binding: {
    schema: 'starforge.wqx-commissioning-customer-binding.v1';
    archiveFile: string;
    archive: CompleteFileIdentity;
    expectedJobId: string | null;
    expectedRequest: Omit<CommissioningJobInput, '$files'> | null;
    expectedSource: CompleteFileIdentity | null;
    expectedDescriptor: PaidJobInputDescriptor | null;
  };
  jobId: string;
  input: CommissioningJobInput;
  original: CommissioningJobIdentity;
  archive: CompleteFileIdentity & {
    path: string;
    logicalBytes: number;
    members: Array<CompleteFileIdentity & { path: string }>;
  };
  exports: CommissioningNativeExport[];
  coldExports: CommissioningNativeExport[];
  receivedProject: CommissioningReceivedProject;
  reopened: boolean;
}
export type DownloadCommissioningJobOptions = DownloadPaidJobExportOptions & {
  /** Separate from the original complete MCP download directory. */
  receivingDirectory: string;
  python?: string;
};
export type ReopenCommissioningJobOptions = ReopenPaidJobExportOptions & {
  /** The same original native customer receiving directory. */
  receivingDirectory: string;
  python?: string;
};
export interface CommissioningPaidJobResult {
  transport: PaidJobReceivingResult;
  commissioning: CommissioningCustomerResult;
}
export declare function inspectCommissioningJobSource(
  options: InspectCommissioningSourceOptions
): Promise<CommissioningSourceInspection>;
export declare function receiveCommissioningJobResult(
  options: ReceiveCommissioningResultOptions
): Promise<CommissioningCustomerResult>;
export declare function downloadCommissioningJob(
  options: DownloadCommissioningJobOptions
): Promise<CommissioningPaidJobResult>;
export declare function reopenCommissioningJob(
  options: ReopenCommissioningJobOptions
): Promise<CommissioningPaidJobResult>;
