// MIT. Exact native workspace transfer client contract.
import type { Buffer } from 'node:buffer';

export type Sha256 = string;
export type OperationId = string;
export interface GrpcWorkspaceBinding {
  schema: 'stellar-forge.grpc-workspace-binding.v1';
  directory: string;
  identity: { device: string; inode: string };
  current: null | { revision: Sha256; generation: number; sha256: Sha256 };
}
export type GrpcTransferCounts = Record<'revisions' | 'reflections' | 'attempts' | 'health' | 'upgrades' |
  'incidents' | 'preparations' | 'releases', number>;
export type GrpcTransferFileKind = 'workspace' | 'health-prefix' | 'observation';
export interface GrpcTransferFile { path: string; bytes: number; sha256: Sha256; kind: GrpcTransferFileKind }
export interface GrpcTransferHealthPrefix {
  id: OperationId; throughSequence: number; snapshotSha256: Sha256; bytes: number;
}
export interface GrpcTransferManifest {
  schema: 'stellar-forge.grpc-workspace-transfer.v1';
  id: OperationId; createdAt: string;
  origin: { directory: string; binding: GrpcWorkspaceBinding };
  counts: GrpcTransferCounts; environmentNames: string[]; health: GrpcTransferHealthPrefix[];
  files: GrpcTransferFile[]; bytes: number; sha256: Sha256;
}
export interface GrpcTransferArchive {
  schema: 'stellar-forge.grpc-workspace-archive.v1';
  sha256: Sha256; bytes: number; filename: 'grpc-workspace.tar.gz'; manifestSha256: Sha256;
  manifest: GrpcTransferManifest;
}
export interface GrpcTransferCaptureInput { id: OperationId; expectedBinding?: GrpcWorkspaceBinding; maxBytes?: number }
export interface GrpcTransferRecord {
  schema: 'stellar-forge.grpc-workspace-transfer-operation.v1';
  id: OperationId; state: 'CAPTURING' | 'PACKING' | 'COMPLETED' | 'FAILED';
  inputSha256: Sha256; input: GrpcTransferCaptureInput; createdAt: string; updatedAt?: string;
  phase?: string; progress?: { files: number; bytes: number }; error?: string;
  archive?: Omit<GrpcTransferArchive, 'manifest'>; manifest?: GrpcTransferManifest;
}
export interface GrpcTransferRuntime {
  active: null | { id: OperationId; kind: 'capture' | 'receive' }; opened: OperationId[]; closing: boolean;
}
export interface GrpcTransferPageInput { offset?: number; limit?: number; expectedSnapshot?: Sha256 }
export interface GrpcTransferPage<T> { items: T[]; total: number; offset: number; nextOffset: number | null; snapshot: Sha256 }
export interface GrpcTransferSummary {
  id: OperationId; schema: string; state: string; createdAt: string; updatedAt?: string;
  phase?: string; error?: string; archiveSha256?: Sha256; archiveBytes?: number;
  manifestSha256?: Sha256; counts?: GrpcTransferCounts; origin?: string; directory?: string;
}
export interface GrpcTransferArchiveSelection { kind: 'capture' | 'upload'; id: OperationId }
export interface GrpcTransferReceiveInput {
  id: OperationId; archive: GrpcTransferArchiveSelection; directory: string;
  expectedSha256: Sha256; expectedBytes: number; expectedManifestSha256: Sha256;
}
export interface GrpcTransferNativeReceiving {
  schema: 'stellar-forge.grpc-workspace-native-receiving.v1';
  transferId: OperationId; manifestSha256: Sha256; checkedAt: string; directory: string;
  originalCounts: GrpcTransferCounts; currentRevision: Sha256 | null; generation: number;
  operationCaptures: number; health: Record<string, unknown>; environmentNames: string[]; binding: GrpcWorkspaceBinding;
}
export interface GrpcTransferReceivingReceipt {
  schema: 'stellar-forge.grpc-workspace-receiving.v1'; operationId: OperationId;
  archiveSha256: Sha256; archiveBytes: number; manifestSha256: Sha256; transferId: OperationId;
  directory: string; receivedAt: string;
}
export interface GrpcTransferReceipt {
  schema: 'stellar-forge.grpc-workspace-transfer-receipt.v1'; id: OperationId;
  inputSha256: Sha256; request: Omit<GrpcTransferReceiveInput, 'id'>;
  state: 'RECEIVING' | 'COMPLETED' | 'FAILED'; phase: string; createdAt: string; updatedAt: string;
  error?: string; runningHere: boolean; binding?: GrpcWorkspaceBinding;
  result?: { receipt: GrpcTransferReceivingReceipt; archiveSha256: Sha256; archiveBytes: number;
    manifestSha256: Sha256; transferId: OperationId; counts: GrpcTransferCounts;
    environmentNames: string[]; native: GrpcTransferNativeReceiving };
}
export interface GrpcTransferUploadInput {
  id: OperationId; sha256: Sha256; bytes: number; offset: number; base64: string; chunkSha256: Sha256;
}
export interface GrpcTransferUpload {
  schema: 'stellar-forge.grpc-workspace-upload.v1'; id: OperationId; sha256: Sha256; bytes: number;
  state: 'UPLOADING' | 'COMPLETED' | 'FAILED'; receivedBytes: number; nextOffset: number | null; error?: string;
}
export interface GrpcTransferChunk {
  id: OperationId; manifestSha256: Sha256; sha256: Sha256; bytes: number; offset: number;
  bytesRead: number; nextOffset: number | null; base64: string; chunkSha256: Sha256;
}
export interface GrpcTransferActions {
  capture: [GrpcTransferCaptureInput, GrpcTransferRecord];
  read: [{ id: OperationId }, GrpcTransferRecord];
  list: [GrpcTransferPageInput & { kind?: 'captures' | 'receipts' },
    GrpcTransferPage<GrpcTransferSummary> & { kind: 'captures' | 'receipts'; binding: GrpcWorkspaceBinding; runtime: GrpcTransferRuntime }];
  files: [GrpcTransferPageInput & { id: OperationId; search?: string; kind?: GrpcTransferFileKind },
    GrpcTransferPage<GrpcTransferFile> & { id: OperationId; manifestSha256: Sha256 }];
  chunk: [{ id: OperationId; expectedManifestSha256: Sha256; offset?: number; limit?: number }, GrpcTransferChunk];
  upload: [GrpcTransferUploadInput, GrpcTransferUpload];
  'upload-status': [{ id: OperationId }, GrpcTransferUpload];
  inspect: [{ archive: GrpcTransferArchiveSelection }, GrpcTransferArchive];
  receive: [GrpcTransferReceiveInput, GrpcTransferReceipt];
  receipt: [{ id: OperationId }, GrpcTransferReceipt];
  open: [{ id: OperationId; expectedBinding: GrpcWorkspaceBinding },
    { id: OperationId; directory: string; url: string; binding: GrpcWorkspaceBinding }];
  close: [{ id: OperationId }, GrpcTransferReceipt];
  cancel: [{ id: OperationId }, { id: OperationId; cancellationRequested: boolean; runtime: GrpcTransferRuntime }];
  download: [{ id: OperationId; expectedManifestSha256: Sha256 },
    { url: string; expiresInSeconds: number; filename: string; sha256: Sha256; bytes: number; manifestSha256: Sha256 }];
}
export interface GrpcTransferRequestOptions { signal?: AbortSignal }
export interface GrpcTransferProgressOptions extends GrpcTransferRequestOptions {
  progress?: (value: GrpcTransferUpload | { id: OperationId; bytes: number; receivedBytes: number }) => void | Promise<void>;
}
export interface GrpcTransferUploadFileInput { id: OperationId; path: string; expectedSha256?: Sha256; expectedBytes?: number }
export interface GrpcTransferDownloadInput { id: OperationId; expectedManifestSha256: Sha256; directory: string }
export interface GrpcTransferDownload extends GrpcTransferArchive {
  id: OperationId; createdAt: string; directory: string; archivePath: string; reused: boolean;
}
export interface GrpcTransferClient {
  request<A extends keyof GrpcTransferActions>(action: A, body: GrpcTransferActions[A][0],
    options?: GrpcTransferRequestOptions): Promise<GrpcTransferActions[A][1]>;
  manifestFile(body: { id: OperationId; expectedManifestSha256: Sha256 }, options?: GrpcTransferRequestOptions): Promise<Buffer>;
  uploadFile(input: GrpcTransferUploadFileInput, options?: GrpcTransferProgressOptions): Promise<GrpcTransferUpload>;
  downloadTo(input: GrpcTransferDownloadInput, options?: GrpcTransferProgressOptions): Promise<GrpcTransferDownload>;
  close(): Promise<void>;
}
export function createGrpcTransferClient(options: { url: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }): GrpcTransferClient;
export function uploadGrpcTransferArchive(client: Pick<GrpcTransferClient, 'request'>, input: GrpcTransferUploadFileInput,
  options?: GrpcTransferProgressOptions): Promise<GrpcTransferUpload>;
export function downloadGrpcTransferArchive(client: Pick<GrpcTransferClient, 'request' | 'manifestFile'>,
  input: GrpcTransferDownloadInput, options?: GrpcTransferProgressOptions): Promise<GrpcTransferDownload>;
