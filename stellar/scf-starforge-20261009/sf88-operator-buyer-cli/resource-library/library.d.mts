import type { FileHandle } from 'node:fs/promises';
export interface LibraryConfig {
  schema: 'stellar-forge.sf88.resource-library.v1'; kind: 'inbox' | 'snapshot';
  source: string; roots: string[]; maxFileBytes: number; indexBytes: number;
}
export interface Annotation {
  id: string; revision: number; note: string; tags: string[]; starred: boolean; updatedAt: string | null;
  source?: {intentId: string; sha256: string | null; configSha256: string; path: string | null;
    source: {kind: 'inbox' | 'snapshot'; path: string}};
}
export interface Verification {
  verifiedAt: string; bytes: number; sha256: string; indexedBytes: number;
  coverage: 'COMPLETE' | 'PREFIX' | 'BINARY';
}
export interface Resource {
  id: string; intentId: string; inboxId: string; configSha256: string; createdAt: string | null;
  name: string; path: string | null; bytes: number | null; sha256: string | null;
  contentType: string | null; deliveryStatus: string | null; buyerStatus: string | null;
  httpStatus: number | null; queueState: string | null; method: string | null; url: string;
  paymentTerms: {scheme: string | null; network: string | null; asset: string | null;
    payTo: string | null; maxAtomic: string | null};
  source: {kind: 'inbox' | 'snapshot'; path: string};
  status: 'VERIFIED' | 'UNAVAILABLE' | 'INCOMPLETE'; error?: string; verification?: Verification;
  annotation: Annotation; snippet?: string;
}
export interface Scan {
  generation: string; sourceSha256: string; sourceBytes: number; jobCount: number;
  resourceCount: number; withoutFile: number; rejected: Array<{id: string | null; code: string}>;
  startedAt: string; completedAt: string; counts: Partial<Record<Resource['status'], number>>;
}
export interface Library {
  readonly state: string; readonly config: LibraryConfig;
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
export function openLibrary(options: {state: string; kind?: 'inbox' | 'snapshot'; source?: string;
  roots?: string[]; maxFileBytes?: number; indexBytes?: number}): Promise<Library>;
