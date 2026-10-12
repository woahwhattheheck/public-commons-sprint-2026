import type { FileHandle } from 'node:fs/promises';
export interface LibraryConfig {
  schema: 'stellar-forge.sf88.resource-library.v1'; kind: 'inbox' | 'snapshot' | 'collection' | 'paid-jobs';
  source: string; roots: string[]; maxFileBytes: number; indexBytes: number;
}
export interface Annotation {
  id: string; revision: number; note: string; tags: string[]; starred: boolean; updatedAt: string | null;
  inheritedRevision?: number;
  source?: {intentId: string | null; sha256: string | null; configSha256: string | null; path: string | null;
    source: {kind: 'inbox' | 'snapshot' | 'collection' | 'paid-jobs'; path: string}};
}
export interface Verification {
  verifiedAt: string; bytes: number; sha256: string; indexedBytes: number;
  coverage: 'COMPLETE' | 'PREFIX' | 'BINARY';
}
export interface Resource {
  id: string; intentId: string | null; inboxId: string | null; configSha256: string | null; createdAt: string | null;
  name: string; path: string | null; bytes: number | null; sha256: string | null;
  contentType: string | null; deliveryStatus: string | null; buyerStatus: string | null;
  httpStatus: number | null; queueState: string | null; method: string | null; url: string;
  paymentTerms: {scheme: string | null; network: string | null; asset: string | null;
    payTo: string | null; maxAtomic: string | null};
  source: {kind: 'inbox' | 'snapshot' | 'collection' | 'paid-jobs'; path: string};
  status: 'VERIFIED' | 'UNAVAILABLE' | 'INCOMPLETE'; error?: string; verification?: Verification;
  annotation: Annotation; snippet?: string; inheritedAnnotation?: Annotation;
  job?: {workspaceEntryId: string; jobId: string; functionId: string; label: string;
    inputSha256: string; acceptanceSha256: string; completedRevision: number;
    nativeSettlement: {id: string; at: string}; purchaseKind: string;
    statusUrl: string; resultUrl: string; deliveredAt: string};
  origin?: {manifestSha256: string; collectionId: string; collectionRevision: number;
    resource: Omit<Resource,'annotation'>; annotation: Annotation};
}
export interface Scan {
  generation: string; sourceSha256: string; sourceBytes: number; jobCount: number | null;
  collection?: {id: string; name: string; revision: number; note: string};
  resourceCount: number; withoutFile: number; rejected: Array<{id: string | null; code: string}>;
  startedAt: string; completedAt: string; counts: Partial<Record<Resource['status'], number>>;
}
export interface Library {
  readonly state: string; readonly config: LibraryConfig; readonly collections: Collections;
  status(): {config: LibraryConfig; scan: Scan | null; selection: string | null;
    activity: {id: string; state: string; completed: number; total: number | null; startedAt: string} | null;
    scanLease: {id: string; pid: number; host: string; start: string | null} | null};
  scan(options?: {signal?: AbortSignal; onProgress?: (progress: NonNullable<ReturnType<Library['status']>['activity']>) => void}): Promise<Scan>;
  search(options?: {q?: string; offset?: number; limit?: number; status?: '' | Resource['status']; starred?: boolean}):
    {total: number; offset: number; limit: number; scan: Scan | null; items: Resource[]};
  resource(id: string): Resource;
  preview(id: string, options?: {signal?: AbortSignal}): Promise<Verification & {resource: Resource; text: string | null}>;
  download(id: string, options?: {signal?: AbortSignal}): Promise<Verification & {resource: Resource; text: string | null;
    file: FileHandle; dispose(): Promise<void>}>;
  saveAnnotation(id: string, options: {expectedRevision: number; operationId: string; note?: string; tags?: string[]; starred?: boolean}): Annotation;
  revisions(id: string): Annotation[];
  exportReview(): {schema: 'stellar-forge.sf88.resource-review.v1'; exportedAt: string; config: LibraryConfig;
    scan: Scan | null; resources: Omit<Resource, 'annotation'>[]; annotations: Annotation[]; selection: string | null};
  select(id: string | null): {id: string | null};
  cancelScan(): ReturnType<Library['status']>;
  close(): Promise<void>;
}
export function openLibrary(options: {state: string; kind?: 'inbox' | 'snapshot' | 'collection' | 'paid-jobs'; source?: string;
  roots?: string[]; maxFileBytes?: number; indexBytes?: number}): Promise<Library>;

export interface ResourceCollection {
  schema: 'stellar-forge.sf88.resource-collection.v1';
  id: string; revision: number; name: string; note: string; updatedAt: string; scan: Scan | null;
  members: Array<Resource & {bytes: number; sha256: string; path: string}>;
}
export interface CollectionSelection {
  id: string; sha256: string; annotationRevision: number; mode?: 'current' | 'retain';
}
export interface CollectionSave {
  id: string; name: string; note?: string; members: CollectionSelection[];
  expectedRevision: number; operationId: string;
}
export interface CollectionSummary {
  id: string; name: string; note: string; revision: number; updatedAt: string; memberCount: number; bytes: string;
}
export interface CollectionPage {total: number; offset: number; limit: number; items: CollectionSummary[]}
export interface Collections {
  list(options?: {offset?: number; limit?: number}): CollectionPage;
  show(id: string, revision?: number): ResourceCollection;
  history(id: string, options?: {offset?: number; limit?: number}): CollectionPage;
  save(request: CollectionSave): ResourceCollection;
}
