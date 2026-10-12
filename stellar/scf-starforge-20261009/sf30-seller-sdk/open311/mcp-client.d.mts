import type { Buffer } from 'node:buffer';
import type { Open311Connection, RequestFilter, RequestRow, ServiceRow, RawResponse, ResponseReceipt } from './index.mjs';
import type { MutationIntent, MutationResult, WorkspaceConnection, WorkspaceCapture, WorkspaceOperation, WorkspaceReview, CaptureInput, CaptureResult, ReviewInput, ReviewedRequest, RequestView, WorkspaceBundle } from './workspace.mjs';

export const OPEN311_HOST_SCHEMA: 'stellar-forge.open311-workspace-host.v1';
export const OPEN311_MAX_INPUT_BYTES: number;
export interface HostInput { label: string; path: string; sha256: string; }
export interface HostWorkspace {
  label: string; directory: string; inputs: Record<string, HostInput>;
  connectionProfiles: Record<string, Omit<Open311Connection, 'apiKey' | 'label'> & { id: string; name: string }>;
}
export interface WorkspaceHostConfiguration {
  schema: typeof OPEN311_HOST_SCHEMA; path: string; workspaces: Record<string, HostWorkspace>;
}
export function readOpen311WorkspaceConfiguration(path: string): Promise<WorkspaceHostConfiguration>;
export function readOpen311HostInput(entry: HostWorkspace, name: string, expectedSha256?: string):
  Promise<{ input: HostInput; bytes: Buffer; value: WorkspaceBundle; sha256: string; name: string }>;
export type MerchantCallTool = (name: string, args: Record<string, unknown>) => unknown | Promise<unknown>;
export interface Page<T> {
  items: T[]; total: number; offset: number; limit: number; returned: number; nextOffset: number | null;
}
export interface RevisionView { revision: number; workspaceId: string; }
export interface WorkspaceStatus extends RevisionView {
  schema: 'commons.open311.workspace.v1'; workspace: string; label: string; createdAt: string;
  counts: { connections: number; captures: number; reviews: number };
  recentOperations: Pick<WorkspaceOperation, 'requestId' | 'kind' | 'state' | 'createdAt' | 'updatedAt'>[];
  originalFileReads: number; sessions: { readId: string; kind: string; file: FileMetadata; storage: string; closing: boolean; expiresAt: string }[];
}
export interface FileMetadata { name: string; contentType: string; bytes: number; sha256: string; }
export type FileSelection =
  | { kind: 'workspace'; expectedRevision: number }
  | { kind: 'source'; capture: string; expectedRevision?: number }
  | { kind: 'json' | 'csv' | 'report'; capture: string; expectedRevision: number }
  | { kind: 'comparison'; before: string; after: string; expectedRevision?: number }
  | { kind: 'operation'; operationId: string; expectedRevision?: number };
export interface FileContinuation { readId?: string; expectedSha256?: string; offset?: number; limit?: number; }
export interface RetainedChunk {
  readId: string; file: FileMetadata; offset: number; bytesRead: number; nextOffset: number | null;
  encoding: 'base64'; data: string;
}
export interface SourceProfileSummary {
  profile: string; connectionId: string; name: string; baseUrl: string; jurisdictionId: string;
  statusValues: string[]; responseLimit: number; pagination: boolean; extendedAttributes: boolean;
  queryExtensions: string[]; attribution: Open311Connection['attribution'] | null;
}
export interface WorkspaceAliases {
  workspace: string; label: string;
  inputs: { input: string; label: string; sha256: string; kind: 'workspace' }[];
  connectionProfiles: SourceProfileSummary[];
}
export type RecordKind = 'connections' | 'captures' | 'reviews';
export interface RecordTypes { connections: WorkspaceConnection; captures: WorkspaceCapture; reviews: WorkspaceReview; }
export interface PageInput { offset?: number; limit?: number; }
export type DifferenceSection = 'added' | 'changed' | 'unchanged' | 'missingFromCapture';
export interface DifferenceItem {
  id: string; key: string; before: RequestRow; after: RequestRow; fields: string[];
}
export class Open311MerchantClient {
  constructor(callTool: MerchantCallTool, workspace: string);
  call(name: string, input?: Record<string, unknown>): Promise<unknown>;
  workspaces(): Promise<{ configured: boolean; workspaces: WorkspaceAliases[]; openWorkspaces: number;
    activeFileReads: number; pendingFileCloses: number; snapshotBytes: number; immutableFileBytes: number }>;
  status(): Promise<WorkspaceStatus>;
  records<K extends RecordKind>(kind: K, input: PageInput & { expectedRevision: number }):
    Promise<RevisionView & Page<RecordTypes[K]> & { kind: K }>;
  configure(input: MutationIntent & { profile: string }): Promise<MutationResult & { connection: WorkspaceConnection }>;
  capture(input: CaptureInput): Promise<CaptureResult>;
  captureInfo(id: string): Promise<{ capture: WorkspaceCapture; receipt: ResponseReceipt; raw: Omit<RawResponse, 'body'>;
    itemCount: number; completeFiles: { source: 'source'; records: 'json' } }>;
  services(input: PageInput & { connection: string; expectedRevision: number }):
    Promise<RevisionView & Page<ServiceRow> & { capture: WorkspaceCapture | null }>;
  requests(input: Omit<RequestFilter, 'status' | 'service' | 'serviceCode' | 'offset' | 'limit'> & PageInput & {
    status?: string; service?: string; capture: string; expectedRevision: number }):
    Promise<RevisionView & Page<ReviewedRequest> & { capture: string }>;
  request(input: { id: string; capture?: string; connection?: string; expectedRevision?: number }):
    Promise<RevisionView & RequestView>;
  diff(input: PageInput & { before: string; after: string; section?: DifferenceSection }):
    Promise<Page<RequestRow | DifferenceItem> & { before: string; after: string; scopeComparable: boolean;
      section: DifferenceSection; counts: Record<DifferenceSection, number> }>;
  review(input: MutationIntent & { connectionId: string; serviceRequestId: string; review: ReviewInput }):
    Promise<MutationResult & { review: WorkspaceReview }>;
  operation(requestId: string): Promise<WorkspaceOperation>;
  input(input: string): Promise<{ workspace: string; input: string; name: string; bytes: number; sha256: string;
    schema: WorkspaceBundle['schema']; sourceWorkspace: WorkspaceBundle['payload']['workspace']; manifest: WorkspaceBundle['manifest'] }>;
  receive(input: MutationIntent & { input: string; expectedSha256: string }): Promise<MutationResult & {
    received: { workspaceId: string; sourceRevision: number; payloadSha256: string; connections: number; captures: number; reviews: number };
  }>;
  readFile(selection: FileSelection, continuation?: FileContinuation): Promise<RetainedChunk>;
  releaseFile(readId: string): Promise<{ workspace: string; readId: string; state: 'RELEASED' }>;
  downloadFile(selection: FileSelection, options?: { limit?: number; maximumBytes?: number }):
    Promise<{ file: FileMetadata; bytesRead: number; bytes: Buffer }>;
  downloadFile(selection: FileSelection, options: { limit?: number; maximumBytes?: number;
    onChunk: (bytes: Buffer, metadata: { file: FileMetadata; offset: number }) => void | Promise<void> }):
    Promise<{ file: FileMetadata; bytesRead: number }>;
}
