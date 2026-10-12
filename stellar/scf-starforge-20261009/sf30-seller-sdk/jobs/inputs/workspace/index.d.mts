import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FileHandle } from 'node:fs/promises';
import type { InputFilePolicy, InputUploadStatus, InputUploadPlan, InputStoredUpload,
  InputStorageCapacity, InputFileDescriptor, InputFileProgress } from '../index.mjs';

export interface InputReceivingJob {
  id: string; label: string; functionId: string; state: string; revision: number;
  createdAt: string; updatedAt: string;
}
export interface InputReceivingFilter {
  q?: string; functionId?: string; reference?: string; state?: '' | 'UPLOADING' | 'SEALED';
  ownership?: '' | 'UNASSIGNED' | 'ORPHAN_PIN' | 'RETAINED_JOB'; offset?: number; limit?: number;
}
export interface InputReceivingQuery {
  schema: 'stellar-forge.job-input-workspace.v1'; configured: boolean;
  serviceName: string; publicOrigin: string; capturedAt: string;
  capacity: InputStorageCapacity | null; readers: {active: number; maximum: number};
  functions: Array<{id: string; description: string; inputFiles: InputFilePolicy}>;
  totals: {uploading: number; sealed: number; unassigned: number; orphanPins: number; retainedJobs: number; receivedBytes: number};
  total: number; offset: number; limit: number;
  items: Array<InputStoredUpload & {job: InputReceivingJob | null; ownership: 'UNASSIGNED' | 'ORPHAN_PIN' | 'RETAINED_JOB'}>;
}
export interface InputReceivingDetail {
  upload: InputUploadStatus; original: InputUploadPlan; job: InputReceivingJob | null; usesFile: boolean;
  policy: {current: boolean; configured: InputFilePolicy['slots'][string] | null; configuredPolicySha256: string | null};
  release: {allowed: boolean; orphanPin: boolean; reason: 'RETAINED_JOB' | 'ORPHAN_PIN' | 'UNASSIGNED'; revision: number};
}
export interface VerifiedInputDownload {
  file: FileHandle; resource: {id: string; name: string}; bytes: number; sha256: string;
  dispose(): Promise<void>;
}
export interface JobInputWorkspace {
  query(options?: InputReceivingFilter): Promise<InputReceivingQuery>;
  get(id: string): Promise<InputReceivingDetail>;
  preview(id: string, options?: {signal?: AbortSignal; maxBytes?: number}):
    Promise<InputFileDescriptor & {id: string; verifiedAt: string; previewBytes: number; truncated: boolean; text: string | null; hex: string | null}>;
  download(id: string, options?: {signal?: AbortSignal}): Promise<VerifiedInputDownload>;
  save(id: string, options: {path: string; resume?: boolean; signal?: AbortSignal; onProgress?: (value: InputFileProgress) => void}):
    Promise<{id: string; path: string; bytes: number; sha256: string; resumedFrom: number; reused: boolean}>;
  discard(options: {id: string; expectedRevision: number; reason: string; releaseOrphan?: boolean}):
    Promise<{id: string; discarded: true; bytes: number}>;
  close(): Promise<{closed: true}>;
}
export interface JobInputWorkspaceExtension {
  desk: JobInputWorkspace;
  assets: Array<{route: string; type: 'text/html' | 'text/javascript' | 'text/css'; bytes: Buffer}>;
  status(): {workspace: '/inputs/'; configured: boolean; downloads: {capacity: number; occupied: number; tickets: number; closing: boolean}};
  publicRoute(context: {request: IncomingMessage; response: ServerResponse; url: URL; signal?: AbortSignal}): Promise<boolean>;
  authenticatedRoute(context: {request: IncomingMessage; response?: ServerResponse; url: URL; signal?: AbortSignal;
    body(maximum?: number): Promise<Record<string, unknown>>; send(value: unknown, status?: number): void}): Promise<boolean>;
  close(): Promise<{closed: true}>;
}
export const INPUT_DESK_SCHEMA: 'stellar-forge.job-input-workspace.v1';
export const PREVIEW_BYTES: 262144;
export function openJobInputWorkspace(options: {model: {inputs: import('../index.mjs').JobInputStore | null;
  configuration: {functions: Record<string, {inputFiles?: InputFilePolicy | null}>};
  snapshot(): Promise<{jobs: InputReceivingJob[]; serviceName: string; publicOrigin: string;
    functions: Array<{id: string; description: string; inputFiles?: InputFilePolicy | null}>}>;
  get(id: string): Promise<InputReceivingJob & {input: Record<string, unknown>}>;
}; maxReaders?: number}): JobInputWorkspace;
export function jobInputWorkspaceExtension(options: Parameters<typeof openJobInputWorkspace>[0]): Promise<JobInputWorkspaceExtension>;
