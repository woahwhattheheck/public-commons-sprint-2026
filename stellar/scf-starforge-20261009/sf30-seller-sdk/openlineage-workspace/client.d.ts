export type EntityKey = string;
export type Decision = "accepted" | "needs-work" | "excluded" | "observed";
export interface Mutation { operationId: string; expectedRevision: number; }
export interface Edition { id: string; title: string; description: string; eventIds: string[]; sourceIds: string[]; createdAt: string; sourceRevision: number; }
export interface Review { id: string; title: string; reason: string; decision: Decision; entityKeys: EntityKey[]; editionId: string | null; updatedAt: string; history: Review[]; }
export interface OriginalEvent { id: string; kind: "run" | "job" | "dataset" | "unknown"; event: Record<string, unknown>; sources: {sourceId: string; line?: number; index?: number}[]; diagnostics: string[]; supported: boolean; schemaVersion?: string | null; adapter?: string | null; notes?: string[]; }
export interface Entity { key: EntityKey; namespace: string; name: string; facets?: Record<string, unknown>; eventIds: string[]; events?: OriginalEvent[]; [key: string]: unknown; }
export interface WorkspaceView { workspaceId: string; revision: number; title: string; eventCount: number; projectedCount: number; jobs: Entity[]; datasets: Entity[]; runs: Entity[]; editions: Edition[]; reviews: Review[]; sources: Record<string, unknown>[]; results: Record<string, unknown>[]; diagnostics: {eventId: string; messages: string[]}[]; }
export interface Export { id: string; bytes: number; workspaceId: string; revision: number; name: string; }
export class LineageClient {
  constructor(baseUrl: string, options?: {token?: string | null; fetchImpl?: typeof fetch; timeoutMs?: number; expectedWorkspaceId?: string; instanceId?: string; signal?: AbortSignal});
  action(action: string, args?: Record<string, unknown>): Promise<any>;
  metadata(): Promise<{workspaceId: string; title: string; revision: number; counts: Record<string, number>; retained: Record<string, number>}>;
  records(args: {collection: string; expectedRevision: number; edition?: string; offset?: number; limit?: number}): Promise<{workspaceId: string; revision: number; total: number; nextOffset: number | null; items: any[]}>;
  object(id: string, options?: {offset?: number; length?: number}): Promise<{id: string; name: string; mediaType: string; totalBytes: number; offset: number; bytes: number; nextOffset: number; complete: boolean; base64: string}>;
  read(options?: {edition?: string}): Promise<WorkspaceView>;
  importSource(bytes: Uint8Array | string, args: Mutation & {name?: string; sourceUrl?: string}): Promise<{revision: number; added: number; retained: number; source: Record<string, unknown>}>;
  saveEdition(args: Mutation & {title: string; description?: string}): Promise<{revision: number; edition: Edition}>;
  compare(from: string, to?: string): Promise<{from: string; to: string | null; changes: {kind: string; key: string; change: string; before: Entity | null; after: Entity | null}[]; addedEventIds: string[]}>;
  entity(key: EntityKey, edition?: string): Promise<Entity>;
  lineage(key: EntityKey, options?: {edition?: string; direction?: "upstream" | "downstream" | "both"; maxDepth?: number}): Promise<{nodes: Entity[]; edges: Record<string, unknown>[]}>;
  saveReview(args: Mutation & {id?: string; title: string; reason: string; decision: Decision; entityKeys: EntityKey[]; editionId?: string | null}): Promise<{revision: number; review: Review}>;
  attachResult(bytes: Uint8Array | string, args: Mutation & {name: string; mediaType?: string; entityKeys: EntityKey[]; editionId: string; sourceReference: string; query?: unknown}): Promise<{revision: number; result: Record<string, unknown>}>;
  exportWorkspace(options?: {includeApplication?: boolean}): Promise<Export>;
  downloadExport(id: string, destination: string, options?: {chunkBytes?: number}): Promise<{id: string; bytes: number; destination: string}>;
}
