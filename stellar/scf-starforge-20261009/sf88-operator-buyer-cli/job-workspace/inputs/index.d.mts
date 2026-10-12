import type { IncomingMessage } from 'node:http';
import type { Library } from '../../resource-library/library.mjs';
import type { IntakeDetail, IntakeEntry } from '../intake/index.mjs';
import type { InputFilePolicy, InputFileDescriptor, InputFileProgress, InputUploadPlan,
  InputUploadStatus, InputUploadSummary, InputStorageCapacity, InputStorageLimits, InputOwnerLease
} from '../../../sf30-seller-sdk/jobs/inputs/index.mjs';
export type { InputFilePolicy, InputFilePolicyConfig, InputFileSlot, InputFileDescriptor, InputFileProgress,
  InputUploadPlan, InputUploadStatus, InputUploadSummary, InputStorageCapacity, InputStorageLimits
} from '../../../sf30-seller-sdk/jobs/inputs/index.mjs';
export { CHUNK_BYTES, INPUT_FILES_FIELD, POLICY_SCHEMA, FILE_SCHEMA, PLAN_SCHEMA, STATUS_SCHEMA,
  validateFilePolicy, validateUploadPlan, validateUploadStatus, fileUploadIdentity, uploadIdentity
} from '../../../sf30-seller-sdk/jobs/inputs/index.mjs';

export type InputFileSource =
  {kind: 'browser-file' | 'local-file'; filename: string} |
  {kind: 'resource-library'; resourceId: string; sha256: string; bytes: number; source: unknown} | null;
export interface CustomerInputTask {
  id: string; kind: 'file-selection' | 'file-staging' | 'file-sealing' | 'library-file-selection' | 'file-remove' | 'file-cleanup';
  state: 'RUNNING' | 'CANCELLING'; startedAt: string; completedAt: string | null; progress: InputFileProgress | null;
}
export interface CustomerInputSummary {
  policy: InputFilePolicy; descriptors: Record<string, InputFileDescriptor>;
  slots: Array<{slot: string; rule: InputFilePolicy['slots'][string]; file: InputFileDescriptor | null;
    upload: InputUploadSummary | null; remote: InputUploadSummary | null; error: string | null}>;
  ready: boolean; merchantReceived: boolean; editable: boolean;
  capacity: InputStorageCapacity; cleanup: {uploads: number; bytes: number}; task: CustomerInputTask | null;
}
export interface CustomerFileSelection {
  slot: string; expectedRevision: number; filename?: string; contentType?: string; signal?: AbortSignal;
}
export interface JobInputFiles {
  readonly directory: string;
  summary(row: IntakeEntry | IntakeDetail): CustomerInputSummary | null;
  busy(id: string): boolean;
  begin(id: string, options: {plan: InputUploadPlan; expectedRevision: number; source?: InputFileSource; signal?: AbortSignal}):
    Promise<InputUploadStatus>;
  chunk(id: string, options: {uploadId: string; index: number; body: Uint8Array; signal?: AbortSignal}): Promise<InputUploadStatus>;
  seal(id: string, options: {uploadId: string; signal?: AbortSignal}): Promise<InputUploadStatus>;
  local(id: string, options: CustomerFileSelection & {path: string; contentType: string}): Promise<{upload: InputUploadStatus}>;
  library(id: string, options: CustomerFileSelection & {resourceId: string}):
    Promise<{upload: InputUploadStatus; resourceId: string; sourceSha256: string}>;
  searchLibrary(options?: {q?: string; offset?: number; limit?: number}): {
    total: number; offset: number; limit: number; items: Array<{
      id: string; label?: string; bytes: number; sha256: string; contentType: string | null;
      filename: string; source: unknown; status: 'VERIFIED';
    }>;
  };
  remove(id: string, options: {slot: string; expectedRevision: number; signal?: AbortSignal}): Promise<{slot: string; removed: true}>;
  cleanup(id: string, options: {expectedRevision: number; signal?: AbortSignal}): Promise<{uploads: number; bytes: number}>;
  cancel(id: string): boolean;
  close(): Promise<{closed: true}>;
}
export interface JobInputFileOptions {
  directory: string; lease: InputOwnerLease; fileRoots?: string[]; library?: Library; limits?: InputStorageLimits;
  maxConcurrent?: number; deadlineMs?: number;
  /** Original retained request callbacks supplied by openJobIntake. */
  readRequest(id: string): Promise<any>;
  editFile(id: string, options: {slot: string; file: InputFileDescriptor | null; source?: InputFileSource;
    expectedRevision: number}): Promise<unknown>;
  assertEditable(row: any): void;
  assertCleanup(row: any, expectedRevision: number): void;
  refresh(id: string): Promise<unknown>;
  fetchJson(url: string, options: {method: string; headers: Record<string, string>; signal?: AbortSignal;
    body: string | Uint8Array; maximum: number}): Promise<{value: unknown}>;
}
export function openJobInputFiles(options: JobInputFileOptions): Promise<JobInputFiles>;
export function jobInputFileExtension(intake: {inputFiles: JobInputFiles; get(id: string): Promise<IntakeDetail>}): Promise<{
  additionalAssets: Array<{route: string; type: string; bytes: Buffer}>;
  authenticatedRoute(options: {request: IncomingMessage; url: URL; signal?: AbortSignal;
    send(value: unknown, status?: number): void; body(maximum?: number): Promise<any>}): Promise<boolean>;
}>;
