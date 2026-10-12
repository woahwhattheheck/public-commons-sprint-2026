import type { Json, Open311Connection, Open311Client, RequestQuery, RequestRow, ServiceRow, RawResponse, ResponseReceipt, CaptureComparison, RequestFilter } from './index.mjs';
import type { Buffer } from 'node:buffer';

export interface MutationIntent { requestId: string; expectedRevision: number; }
export interface WorkspaceConnection extends Omit<Open311Connection, 'apiKey' | 'label' | 'id' | 'jurisdictionId'> {
  id: string; name: string; jurisdictionId?: string;
}
export interface WorkspaceCapture {
  id: string; connectionId: string; kind: 'services' | 'service' | 'requests' | 'request' | 'token' | 'discovery';
  query: RequestQuery; requestedQuery?: RequestQuery; resourceId: string | null; capturedAt: string; rowCount: number;
  scope: { connectionId: string; baseUrl: string; jurisdictionId: string; kind: string; query: RequestQuery; resourceId: string | null; fixed: boolean };
  complete: boolean; saturated: boolean; responseLimit: number; statuses: string[];
  sourceSha256: string; sourceBytes: number; receipt: ResponseReceipt; connection: WorkspaceConnection;
}
export interface ReviewInput {
  status?: 'new' | 'assigned' | 'in_progress' | 'done'; assignee?: string; note?: string; dueDate?: string;
}
export interface ReviewHistory extends Required<ReviewInput> {
  requestId: string; updatedAt: string; sourceSha256: string; captureId: string;
}
export interface WorkspaceReview extends ReviewHistory {
  connectionId: string; serviceRequestId: string; history: ReviewHistory[]; needsReview?: boolean;
}
export interface ReviewedRequest extends RequestRow { review: WorkspaceReview | null; }
export interface WorkspaceOperation {
  requestId: string; payloadHash: string; kind: string; state: 'FETCHING' | 'FETCHED' | 'FAILED' | 'SUCCEEDED';
  result: Record<string, Json> | null; error: Record<string, Json> | null; createdAt: string; updatedAt: string;
}
export interface WorkspaceState {
  schema: 'commons.open311.workspace.v1'; workspaceId: string; revision: number; createdAt: string;
  connections: WorkspaceConnection[]; captures: WorkspaceCapture[]; reviews: WorkspaceReview[];
  operations: Pick<WorkspaceOperation, 'requestId' | 'kind' | 'state' | 'createdAt' | 'updatedAt'>[];
}
export interface MutationResult { workspaceId: string; revision: number; requestId: string; }
export interface CaptureInput extends MutationIntent {
  connectionId: string; kind?: WorkspaceCapture['kind']; query?: RequestQuery; resourceId?: string;
}
export interface CaptureResult extends MutationResult { capture: WorkspaceCapture; }
export interface CaptureRecord {
  capture: WorkspaceCapture; value: Json; items: (ReviewedRequest | ServiceRow)[];
  raw: RawResponse; receipt: ResponseReceipt;
}
export interface RequestView {
  item: ReviewedRequest; review: WorkspaceReview | null;
  history: { captureId: string; capturedAt: string; item: RequestRow }[];
}
export interface WorkspaceBundle {
  schema: 'commons.open311.workspace-export.v1'; exportedAt: string;
  payload: {
    workspace: Pick<WorkspaceState, 'schema' | 'workspaceId' | 'revision' | 'createdAt'>;
    connections: WorkspaceConnection[];
    captures: Omit<CaptureRecord, 'items'>[];
    reviews: WorkspaceReview[];
    operations: (WorkspaceOperation & { intent: Record<string, Json> })[];
  };
  manifest: { algorithm: 'sha256'; payloadSha256: string; payloadBytes: number;
    connectionCount: number; captureCount: number; reviewCount: number; operationCount: number };
}
export interface WorkspaceExport { filename: string; contentType: string; body: string | Buffer; }
export interface Open311Workspace {
  readonly directory: string;
  state(): WorkspaceState;
  putConnection(input: MutationIntent & { connection: Omit<WorkspaceConnection, 'id' | 'name'> & { id?: string; name?: string } }): MutationResult & { connection: WorkspaceConnection };
  capture(input: CaptureInput): Promise<CaptureResult>;
  putReview(input: MutationIntent & { connectionId: string; serviceRequestId: string; review: ReviewInput }): MutationResult & { review: WorkspaceReview };
  requests(input: RequestFilter & { capture: string }): { items: ReviewedRequest[]; total: number; offset: number; limit: number };
  request(input: { id: string; capture?: string; connection?: string }): RequestView;
  services(input: { connection: string }): { items: ServiceRow[]; capture: WorkspaceCapture | null };
  captureInfo(input: { id: string }): CaptureRecord;
  diff(input: { before: string; after: string }): CaptureComparison & { before: string; after: string };
  operation(requestId: string): WorkspaceOperation;
  export(input?: { kind?: 'workspace' | 'source' | 'json' | 'csv' | 'report'; capture?: string }): WorkspaceExport;
  receive(input: MutationIntent & { bundle: WorkspaceBundle }): MutationResult & {
    received: { workspaceId: string; sourceRevision: number; payloadSha256: string; connections: number; captures: number; reviews: number };
  };
  close(): void;
}
export class WorkspaceError extends Error {
  constructor(code: string, message: string, status?: number, details?: unknown);
  code: string; status: number; details?: unknown; receipt?: ResponseReceipt; raw?: RawResponse;
}
export function canonical(value: Json): string;
export function sha256(value: string | Uint8Array): string;
export function openWorkspace(directory: string, options?: { clientFactory?: (connection: Open311Connection) => Open311Client }): Open311Workspace;
