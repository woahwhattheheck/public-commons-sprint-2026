// MIT. Complete paid-job receiving over the original merchant MCP transport.
export declare const PAID_JOB_RECEIVING_SCHEMA: 'stellar-forge.paid-job-agent-receiving.v1';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface MerchantJobFileClient {
  /** Stable identity of the original configured MCP endpoint. */
  readonly endpoint: string;
  /** Return the flat native structured result, including its workspace alias. */
  call(name: string, arguments_: Record<string, unknown>, options?: {
    requestSignal?: AbortSignal | null;
    timeoutMs?: number;
  }): Promise<Record<string, unknown>>;
}
export interface PaidJobExportFile {
  name: string;
  bytes: number;
  sha256: string;
}
export interface PaidJobResult {
  bytes: number;
  sha256: string;
  filename: string;
  contentType: string;
}
export interface PaidJobExportSelection {
  id: string;
  functionId: string;
  revision: number;
  state: string;
  inputSha256: string;
  configSha256: string;
  applicationSha256: string;
  result: PaidJobResult | null;
}
export interface PaidJobInputDescriptor {
  schema: 'stellar-forge.job-input-file.v1';
  filename: string;
  contentType: string;
  bytes: number;
  sha256: string;
  policySha256: string;
}
export interface PaidJobExportInput {
  slot: string;
  uploadId: string;
  file: string;
  descriptor: PaidJobInputDescriptor;
}
export interface PaidJobExportManifest {
  schema: 'stellar-forge.paid-job-agent-export.v1';
  exportId: string;
  sourceSha256: string;
  request: {
    requestId: string;
    jobId: string;
    expectedRevision: number;
    expectedCaseRevision: number | null;
  };
  job: PaidJobExportSelection;
  resolution: { revision: number; caseSha256: string } | null;
  accounting: { runId: string; eventId: string; sha256: string } | null;
  inputPolicy: { file: 'input-policy.json'; policySha256: string } | null;
  inputs: PaidJobExportInput[];
  files: PaidJobExportFile[];
  totalBytes: number;
}
export type PaidJobConnection =
  | { url: string; client?: never; tokenEnv?: string; environment?: Record<string, string | undefined> }
  | { client: MerchantJobFileClient; url?: never; tokenEnv?: never; environment?: never };
export interface PaidJobSourceSelection {
  workspace: string;
  exportId: string;
  expectedManifestSha256?: string;
  signal?: AbortSignal;
}
export type InspectPaidJobExportOptions = PaidJobSourceSelection & PaidJobConnection;
export interface PaidJobExportInspection {
  schema: typeof PAID_JOB_RECEIVING_SCHEMA;
  state: 'INSPECTED';
  workspace: string;
  manifest: PaidJobExportManifest;
  manifestSha256: string;
}
export interface PaidJobDownloadProgress {
  exportId: string;
  file: string;
  bytes: number;
  total: number;
  state: 'DOWNLOADING';
}
export type DownloadPaidJobExportOptions = InspectPaidJobExportOptions & {
  /** A new empty private directory or the same retained download directory. */
  directory: string;
  /** The original transport accepts 1 through 196608 bytes; default 196608. */
  chunkSize?: number;
  onProgress?: (progress: PaidJobDownloadProgress) => void | Promise<void>;
};
export interface ReopenPaidJobExportOptions {
  directory: string;
  workspace?: string;
  exportId?: string;
  expectedManifestSha256?: string;
  signal?: AbortSignal;
}
export interface PaidJobReceivingResult {
  schema: typeof PAID_JOB_RECEIVING_SCHEMA;
  state: 'COMPLETE' | 'REOPENED';
  directory: string;
  workspace: string;
  endpoint: string;
  exportId: string;
  manifestSha256: string;
  manifestPath: string;
  sourceSha256: string;
  job: PaidJobExportSelection;
  resolution: PaidJobExportManifest['resolution'];
  accounting: PaidJobExportManifest['accounting'];
  inputPolicy: PaidJobExportManifest['inputPolicy'];
  inputs: PaidJobExportInput[];
  files: number;
  bytes: number;
  documentsVerified: true;
  artifacts: Array<PaidJobExportFile & { path: string }>;
}
export interface PaidJobDownloadResult extends PaidJobReceivingResult {
  state: 'COMPLETE';
  resumed: boolean;
  resumedBytes: number;
}
export interface PaidJobReopenResult extends PaidJobReceivingResult {
  state: 'REOPENED';
}
/** Original resolution export returned unchanged after the native record join. */
export interface PaidJobCaseSource {
  schema: string;
  caseSha256: string;
  case: { [key: string]: JsonValue };
  customerReceipt: JsonValue;
  [key: string]: JsonValue;
}
export interface ReadPaidJobCaseSourceOptions {
  workspace: string;
  client: MerchantJobFileClient;
  exportId: string;
  expectedManifestSha256: string;
  signal?: AbortSignal;
}
/** Reads and validates the complete manifest through the original retained tools. */
export declare function inspectPaidJobExport(options: InspectPaidJobExportOptions): Promise<PaidJobExportInspection>;
/** Streams all files, resumes verified partial bytes and validates original documents. */
export declare function downloadPaidJobExport(options: DownloadPaidJobExportOptions): Promise<PaidJobDownloadResult>;
/** Rehashes every file and rejoins the original documents without network access. */
export declare function reopenPaidJobExport(options: ReopenPaidJobExportOptions): Promise<PaidJobReopenResult>;
/** Reads bounded original documents and returns the raw original resolution export. */
export declare function readPaidJobCaseSource(options: ReadPaidJobCaseSourceOptions): Promise<PaidJobCaseSource>;
