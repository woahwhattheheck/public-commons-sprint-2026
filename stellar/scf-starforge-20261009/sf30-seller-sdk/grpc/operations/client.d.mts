// MIT. Typed original gRPC operations and incident workflow.
export type UUID = string;
export type SHA256 = string;
export type CallOutcome = 'ATTEMPTED' | 'COMPLETED' | 'OUTCOME_UNCONFIRMED' | 'NOT_STARTED';
export interface OperationsSelection { from?: string | null; to?: string | null; revisions?: string[]; methods?: string[]; includeHealth?: boolean }
export interface IncidentLink { kind: 'call' | 'health' | 'revision'; id: string; sequence?: number }
export interface CorrectiveAction { id: UUID; title: string; owner?: string; state: 'planned' | 'in-progress' | 'completed' | 'cancelled'; dueAt?: string | null; note?: string }
export interface IncidentEdit { title: string; severity?: 'low' | 'medium' | 'high' | 'critical'; state?: 'open' | 'investigating' | 'monitoring' | 'resolved';
  summary?: string; impact?: string; findings?: string; review?: { state?: 'draft' | 'reviewed'; reviewer?: string; note?: string };
  links?: IncidentLink[]; actions?: CorrectiveAction[] }
export interface IncidentRevision { schema: 'stellar-forge.grpc-incident-revision.v1'; id: UUID; version: number; parentSha256: SHA256 | null;
  captureId: UUID; captureSha256: SHA256; createdAt: string; authorWorkspaceId: UUID; operationId: UUID; inputSha256: SHA256; edit: IncidentEdit; sha256: SHA256 }
export interface IncidentSummary { id: UUID; version: number; sha256: SHA256; captureId: UUID; captureSha256: SHA256; updatedAt: string;
  title: string; severity: NonNullable<IncidentEdit['severity']>; state: NonNullable<IncidentEdit['state']>;
  review: NonNullable<IncidentEdit['review']>; actions: number; outstandingActions: number }
export interface CaptureSummary { id: UUID; captureSha256: SHA256; originWorkspaceId: UUID; startedAt: string; capturedAt: string;
  selection: Required<OperationsSelection>; selectedRevision: SHA256 | null; generation: number; attempts: number; outcomes: Record<CallOutcome, number>;
  recordedElapsed: { samples: number; missing: number; minMs: number | null; p50Ms: number | null; p95Ms: number | null; maxMs: number | null };
  healthObservations: number; sourceRevisions: number; preparations: number; meaning: string }
export interface PageInput { offset?: number; limit?: number; expectedSnapshot?: SHA256 }
export interface Page<T> { total: number; offset: number; snapshot: SHA256; items: T[]; nextOffset: number | null }
export interface CaseRead { case: IncidentSummary; revision: IncidentRevision; currentVersion: number; currentSha256: SHA256; history: IncidentSummary[]; capture: CaptureSummary }
export interface OperationsExport { schema: 'stellar-forge.grpc-operations-export.v1'; capture: Record<string, unknown>; history: IncidentRevision[]; exportSha256: SHA256 }
export interface FileDescriptor { path: string; filename: string; bytes: number; sha256: SHA256; contentType: string }
export interface OperationsFiles { schema: 'stellar-forge.grpc-operations-files.v1'; exportSha256: SHA256; captureId: UUID; captureSha256: SHA256; case: IncidentSummary; files: FileDescriptor[] }
export interface Requests {
  capture: { id: UUID; selection?: OperationsSelection };
  captures: PageInput;
  read: { id: UUID; section?: 'summary' | 'calls' | 'health' | 'timeline' | 'methods' | 'revisions' | 'call' | 'health-observation' | 'source';
    recordId?: string; search?: string; phase?: string; method?: string; revision?: SHA256 } & PageInput;
  cases: PageInput & { state?: string; severity?: string; search?: string };
  case: { id: UUID; version?: number };
  save: { id: UUID; captureId: UUID; operationId: UUID; expectedVersion: number; edit: IncidentEdit };
  export: { id: UUID; version: number };
  receive: { operationId: UUID; bundle: OperationsExport };
}
export interface Responses {
  capture: CaptureSummary; captures: Page<CaptureSummary>;
  read: CaptureSummary | (Page<Record<string, unknown>> & { captureId: UUID; section: string }) | { captureId: UUID; captureSha256: SHA256; section: string; record: unknown };
  cases: Page<IncidentSummary>; case: CaseRead; save: CaseRead; export: OperationsFiles;
  receive: { schema: 'stellar-forge.grpc-operations-received.v1'; operationId: UUID; exportSha256: SHA256; captureId: UUID; captureSha256: SHA256;
    caseId: UUID; receivedVersion: number; currentVersion: number; receiverWorkspaceId: UUID; receivedAt: string };
}
export interface GrpcOperationsClient {
  request<K extends keyof Requests>(action: K, body: Requests[K]): Promise<Responses[K]>;
  download(input: { exportSha256: SHA256; file: string }): Promise<{ path: string; contentType: string; bytes: Uint8Array; sha256: SHA256 }>;
  close(): Promise<void>;
}
export function createGrpcOperationsClient(options: { url: string; fetch?: typeof globalThis.fetch }): GrpcOperationsClient;
