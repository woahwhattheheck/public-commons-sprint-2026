import type { Json, RequestQuery, RequestRow, RequestFilter, CaptureComparison, Open311Connection } from './index.mjs';
import type { WorkspaceConnection, WorkspaceCapture, WorkspaceOperation, WorkspaceReview, ReviewedRequest, RequestView, MutationIntent, MutationResult, CaptureInput } from './workspace.mjs';

export const COLLECTION_SCHEMA: 'commons.open311.collection.v1';
export interface CollectionPolicy {
  maxWindowDays: number; queryQuantumMs: number; minimumWindowMs: number; boundaryOverlapMs: number;
}
export type CollectionState = 'PLANNED' | 'RUNNING' | 'PAUSED' | 'INTERRUPTED' | 'COMPLETE' | 'LIMITED';
export type CollectionWindowState = 'PENDING' | 'FETCHING' | 'CAPTURED' | 'SPLIT' | 'LIMITED' | 'FAILED';
export interface CollectionSourceError {
  code: string; message: string; status: number; receipt?: WorkspaceCapture['receipt']; details?: Json;
}
export interface CollectionAttempt {
  requestId: string; startedAt: string; finishedAt: string | null; captureId: string | null;
  error: CollectionSourceError | null; intent: CaptureInput;
}
export interface CollectionWindow {
  id: string; parentId: string | null; startDate: string; endDate: string;
  state: CollectionWindowState; children: string[]; attempts: CollectionAttempt[];
  captureId: string | null; problem?: 'SOURCE_QUERY_MISMATCH' | 'RESPONSE_CAP_AT_SELECTED_PRECISION';
}
export interface CollectionSelection {
  connectionId: string; name?: string;
  query: RequestQuery & { start_date: string; end_date: string };
  policy?: Partial<CollectionPolicy>;
}
export interface CollectionPlan {
  name: string; query: RequestQuery & { start_date: string; end_date: string };
  requestedQuery: RequestQuery & { start_date: string; end_date: string };
  policy: CollectionPolicy; nodes: CollectionWindow[];
}
export interface SourceCollection extends CollectionPlan {
  schema: typeof COLLECTION_SCHEMA; id: string; connectionId: string; connection: WorkspaceConnection;
  creationRequestId: string; state: CollectionState; pauseRequested: boolean;
  runRequestId: string | null; createdAt: string; updatedAt: string;
  lastError: CollectionSourceError | null; resumeAt: string | null;
}
export interface CollectionCounts {
  windowCount: number; pendingWindows: number; activeWindows: number; capturedWindows: number;
  splitWindows: number; limitedWindows: number; failedWindows: number; originalCaptureCount: number;
  returnedRows: number; uniqueRequests: number; changedRequests: number; duplicateObservations: number;
  outOfWindowRows: number; unknownDateRows: number;
}
export interface CollectionSummary extends Omit<SourceCollection, 'nodes' | 'connection' | 'creationRequestId'> {
  counts: CollectionCounts; capResolved: boolean; firstObservedAt: string | null;
  lastObservedAt: string | null; interpretation: string;
}
export interface CollectionRequest extends RequestRow {
  review?: WorkspaceReview | null;
  collectionId: string; captureId: string; observationCount: number; versionCount: number;
}
export interface CollectionOccurrence {
  captureId: string; windowId: string; capturedAt: string; sourceSha256: string;
  sourceResponseSha256: string; requestedAt: string | null; updatedAt: string | null;
  windowPosition: 'UNKNOWN_DATE' | 'OUTSIDE_REQUESTED_WINDOW' | 'WITHIN_RECORDED_BOUNDS';
}
export interface CollectionVersion { sourceSha256: string; item: RequestRow; occurrences: CollectionOccurrence[]; }
export interface CollectionObservation {
  key: string; serviceRequestId: string; selectedCaptureId: string;
  occurrences: CollectionOccurrence[]; versions: CollectionVersion[];
}
export interface CollectionRecord {
  capture: WorkspaceCapture; items: RequestRow[];
  value?: Json; raw?: import('./index.mjs').RawResponse; receipt?: import('./index.mjs').ResponseReceipt;
}
export interface CollectionProjection {
  summary: CollectionSummary; items: CollectionRequest[]; connection?: WorkspaceConnection;
  records: CollectionRecord[]; nodes: Map<string, CollectionWindow>;
  observations: Map<string, { row: RequestRow; captureId: string; occurrences: CollectionOccurrence[];
    versions: Map<string, CollectionVersion> }>;
}
export interface CollectionFilter extends RequestFilter {
  collection: string; changedOnly?: boolean | 'true' | 'false';
  reviewStatus?: 'new' | 'assigned' | 'in_progress' | 'done'; assignee?: string;
}
export interface CollectionPage {
  items: CollectionRequest[]; total: number; offset: number; limit: number; collection: CollectionSummary;
}
export interface CollectionInfo {
  workspaceId: string; revision: number; collection: CollectionSummary; connection: WorkspaceConnection;
  items: (CollectionWindow & { capture: WorkspaceCapture | null })[];
  total: number; offset: number; limit: number; nextOffset: number | null;
}
export interface CollectionRequestView extends RequestView {
  item: CollectionRequest & ReviewedRequest; history: (CollectionOccurrence & { item: ReviewedRequest })[];
  versions: (Omit<CollectionVersion, 'item'> & { item: ReviewedRequest })[]; collection: CollectionSummary;
}
export interface CollectionComparison extends CaptureComparison {
  before: string; after: string; coverage: { before: CollectionSummary; after: CollectionSummary };
  interpretation: string;
}
export interface CollectionResult extends MutationResult { collection: CollectionSummary; }
export type CollectionCreateInput = MutationIntent & CollectionSelection;
export type CollectionRunInput = MutationIntent & { collectionId: string };
export interface CollectionExport {
  schema: 'commons.open311.collection-export.v1'; workspaceId: string; revision: number;
  collection: SourceCollection; summary: CollectionSummary; requests: CollectionRequest[];
  observations: CollectionObservation[];
  originals: Required<CollectionRecord>[];
  sourceOperations: (WorkspaceOperation | { requestId: string; state: 'NOT_ADMITTED'; intent: CaptureInput })[];
}
export function normalizeCollectionPlan(connection: Open311Connection,
  input: Pick<CollectionSelection, 'name' | 'query' | 'policy'>): CollectionPlan;
export function collectionNodeQuery(collection: CollectionPlan & { connection: Open311Connection },
  window: CollectionWindow): Record<string, string>;
export function splitCollectionWindow(window: CollectionWindow, policy: CollectionPolicy): CollectionWindow[] | null;
export function projectCollection(collection: SourceCollection, records: CollectionRecord[]): CollectionProjection;
export function queryCollection(projection: CollectionProjection, filter?: Omit<CollectionFilter, 'collection'>): CollectionPage;
export function compareCollections(before: CollectionProjection, after: CollectionProjection): CollectionComparison;
export function validateCollectionRecord(collection: SourceCollection, inventories: {
  connections: Map<string, WorkspaceConnection>;
  captures: Map<string, Required<CollectionRecord>>;
  operations: Map<string, WorkspaceOperation>;
}): SourceCollection;
