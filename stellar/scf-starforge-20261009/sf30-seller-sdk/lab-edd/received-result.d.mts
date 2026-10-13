export interface ExpectedLabResultIdentity {
  archiveSha256?: string;
  archiveBytes?: number;
  manifestSha256?: string;
  functionId?: 'laboratoryReview';
  jobId?: string;
  reviewName?: string;
  sourceSha256?: string;
  documentSha256?: string;
  reviewSha256?: string;
  baselineSourceSha256?: string;
  baselineDocumentSha256?: string;
  baselineReviewSha256?: string;
  correspondenceReviewSha256?: string;
}
export interface LabResultProfile { id: string; version: string; [key: string]: unknown; }
export interface LabResultEditionIdentity {
  profile: LabResultProfile;
  sourceSha256: string;
  documentSha256: string;
  reviewSha256: string;
}
export interface LabResultFolderIdentity extends LabResultEditionIdentity {
  functionId: 'laboratoryReview';
  jobId: string | null;
  reviewName: string | null;
  archiveBytes: number;
  archiveSha256: string;
  manifestSha256: string;
  baseline: LabResultEditionIdentity | null;
  reconciliation: {
    comparisonSha256: string;
    documentSha256: string;
    reviewSha256: string;
    outputComparisonSha256: string;
  } | null;
}
export interface ReceivedLabFile {
  path: string;
  bytes: number;
  sha256: string;
  role: 'receiving-binding' | 'complete-original-result' | 'original-result-member' |
    'current-native-file' | 'baseline-native-file' | 'customer-entry-page';
}
export interface ReceivedLabNativeFile {
  path: string;
  filename: string;
  bytes: number;
  sha256: string;
  sourceFile?: { filename: string; bytes: number; sha256: string };
  formatConversion?: { from: 'xls-biff8'; to: 'xlsx'; profileId: 'geotech-dts8d'; originalRetained: true };
}
export interface ReceivedLabNativeFamily {
  label: 'Current' | 'Baseline';
  profile: LabResultProfile;
  preparation: { status: 'PREPARED' | 'REVIEW_REQUIRED'; [key: string]: unknown };
  report: {
    disposition: string;
    counts: { error: number; review: number; info: number; [key: string]: unknown };
    summary: Record<string, unknown>;
  };
  files: ReceivedLabNativeFile[];
}
export interface ReceivedLabResultReceipt {
  schema: 'starforge.lab-edd-received-result.v1';
  status: 'COMPLETE';
  layoutVersion: 1;
  identity: LabResultFolderIdentity;
  entryPage: 'index.html';
  resultArchive: 'original-result.zip';
  bindingSha256: string;
  originalResultMembers: number;
  originalInputFiles: number;
  nativeFamilies: ReceivedLabNativeFamily[];
  files: ReceivedLabFile[];
  managedFileBytes: number;
}
export interface ReceivedLabResult {
  status: 'COMPLETE';
  directory: string;
  entryPage: string;
  archivePath: string;
  receiptPath: string;
  receipt: ReceivedLabResultReceipt;
  reused?: boolean;
  writtenFiles?: number;
  retainedFiles?: number;
  readOnly?: true;
}
export interface ReceiveLabResultOptions {
  file: string;
  directory: string;
  expected?: ExpectedLabResultIdentity;
  signal?: AbortSignal;
}
export interface OpenReceivedLabResultOptions {
  directory: string;
  expected?: ExpectedLabResultIdentity;
  signal?: AbortSignal;
}
export const LAB_RESULT_FOLDER_SCHEMA: 'starforge.lab-edd-received-result.v1';
export const LAB_RESULT_BINDING_SCHEMA: 'starforge.lab-edd-result-folder-binding.v1';
export function receiveLabResult(options: ReceiveLabResultOptions): Promise<ReceivedLabResult>;
export function openReceivedLabResult(options: OpenReceivedLabResultOptions): Promise<ReceivedLabResult>;
