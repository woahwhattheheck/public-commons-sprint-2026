import type { FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';

export interface InputFileSlot {
  required: boolean; description: string; mediaTypes: string[]; maxBytes: number;
}
export interface InputFilePolicy {
  schema: 'stellar-forge.job-input-policy.v1'; slots: Record<string, InputFileSlot>;
  maxTotalBytes: number; policySha256: string;
}
export interface InputFilePolicyConfig {
  slots: Record<string, Partial<InputFileSlot>>;
  maxTotalBytes?: number;
}
export interface InputFileDescriptor {
  schema: 'stellar-forge.job-input-file.v1'; filename: string; contentType: string;
  bytes: number; sha256: string; policySha256: string;
}
export interface InputUploadPlan {
  schema: 'stellar-forge.job-input-upload.v1'; origin: string; reference: string; functionId: string;
  slot: string; file: InputFileDescriptor; chunkBytes: 262144; chunks: string[];
}
export interface InputUploadSummary {
  schema: 'stellar-forge.job-input-upload-status.v1'; id: string; planSha256: string;
  state: 'UPLOADING' | 'SEALED'; revision: number; file: InputFileDescriptor;
  createdAt: string; updatedAt: string; sealedAt: string | null;
  receivedChunks: number; totalChunks: number; receivedBytes: number; pinned: boolean;
}
export interface InputUploadStatus extends InputUploadSummary { missing: number[] }
export interface InputStoredUpload extends InputUploadSummary {
  origin: string; reference: string; functionId: string; slot: string;
}
export interface InputStorageLimits { maxBytes?: number; maxUploads?: number }
export interface InputStorageCapacity { maxBytes: number; maxUploads: number; uploads: number; reservedBytes: number }
export interface InputOwnerLease { assertHeld(): void }
export interface InputPin {
  reference: string; functionId: string; inputSha256: string; at: string;
}
export interface InputFileProgress {
  phase: string; bytes: number; totalBytes: number; slot?: string; uploadId?: string;
}
export interface JobInputStore {
  readonly directory: string;
  begin(options: {plan: InputUploadPlan; token: string}): Promise<InputUploadStatus>;
  status(id: string, token?: string): InputUploadStatus;
  plan(id: string, token?: string): InputUploadPlan;
  list(options?: {origin?: string; reference?: string; functionId?: string}): InputStoredUpload[];
  capacity(): InputStorageCapacity;
  writeChunk(options: {id: string; token?: string; index: number; body: Uint8Array; signal?: AbortSignal}): Promise<InputUploadStatus>;
  finish(options: {id: string; token?: string; signal?: AbortSignal}): Promise<InputUploadStatus>;
  openFile(id: string, token?: string, options?: {signal?: AbortSignal}): Promise<{file: FileHandle; info: Stats}>;
  pinJob(options: {origin: string; reference: string; functionId: string; input: Record<string, unknown>;
    policy: InputFilePolicy; inputSha256: string; token?: string; signal?: AbortSignal}): Promise<Record<string, InputFileDescriptor>>;
  discard(options: {id: string; token?: string; expectedRevision: number; releaseOrphan?: boolean; reason?: string}):
    Promise<{id: string; discarded: true; bytes: number}>;
  close(): Promise<{closed: true}>;
}
export interface WorkerInputFiles {
  list(): Array<InputFileDescriptor & {slot: string}>;
  metadata(slot: string): InputFileDescriptor;
  read(slot: string, options?: {maxBytes?: number}): Promise<Buffer>;
  stream(slot: string): AsyncIterable<Buffer>;
}
export const INPUT_FILES_FIELD: '$files';
export const POLICY_SCHEMA: InputFilePolicy['schema'];
export const FILE_SCHEMA: InputFileDescriptor['schema'];
export const PLAN_SCHEMA: InputUploadPlan['schema'];
export const STATUS_SCHEMA: InputUploadSummary['schema'];
export const CHUNK_BYTES: 262144;
export function normalizeFilePolicy(raw?: InputFilePolicyConfig): InputFilePolicy | null;
export function validateFilePolicy(value: unknown): InputFilePolicy;
export function inputManifest(policy: InputFilePolicy | null | undefined, input: Record<string, unknown>,
  options?: {complete?: boolean}): Record<string, InputFileDescriptor>;
export function validateUploadPlan(value: unknown): InputUploadPlan;
export function validateUploadStatus(value: unknown, plan: InputUploadPlan): InputUploadStatus;
export function fileUploadIdentity(value: Pick<InputUploadPlan, 'origin' | 'reference' | 'functionId' | 'slot' | 'file'>): string;
export function uploadIdentity(plan: InputUploadPlan): string;
export function openInputStore(options: {
  directory: string; lease: InputOwnerLease; limits?: InputStorageLimits;
  canDiscard?: (plan: InputUploadPlan, progress: {pin: InputPin | null; [key: string]: unknown}) => boolean | Promise<boolean>;
}): Promise<JobInputStore>;
export function openWorkerFiles(options: {
  directory: string; origin: string; reference: string; functionId: string; policy: InputFilePolicy;
  input: Record<string, unknown>; inputSha256: string; signal?: AbortSignal;
}): Promise<{files: WorkerInputFiles; close(): Promise<void>}>;
export function openAllowedInput(path: string, roots: string[]):
  Promise<{file: FileHandle; info: Stats; path: string; filename: string; close(): Promise<void>}>;
export function planFromHandle(options: {
  file: FileHandle; origin: string; reference: string; functionId: string; slot: string; policy: InputFilePolicy;
  filename: string; contentType: string; signal?: AbortSignal; onProgress?: (value: InputFileProgress) => void;
}): Promise<{plan: InputUploadPlan; info: Stats}>;
export function runJobInputCommand(args?: string[], options?: {print?: (value: unknown) => void}): Promise<void>;
