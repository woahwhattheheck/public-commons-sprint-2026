import type { ProducerReceipt, ProducerStatus } from "./producer.mjs";
export type EntityKey = string;
export type Decision = "accepted" | "needs-work" | "excluded" | "observed";
export interface Mutation { operationId: string; expectedRevision: number; }
export interface Edition { id: string; title: string; description: string; eventIds: string[]; sourceIds: string[]; createdAt: string; sourceRevision: number; }
export interface Review { id: string; title: string; reason: string; decision: Decision; entityKeys: EntityKey[]; editionId: string | null; updatedAt: string; history: Review[]; }
export interface OriginalEvent { id: string; kind: "run" | "job" | "dataset" | "unknown"; event: Record<string, unknown>; sources: {sourceId: string; line?: number; index?: number}[]; diagnostics: string[]; supported: boolean; schemaVersion?: string | null; adapter?: string | null; notes?: string[]; }
export interface Entity { key: EntityKey; namespace: string; name: string; facets?: Record<string, unknown>; eventIds: string[]; events?: OriginalEvent[]; [key: string]: unknown; }
export interface WorkspaceView { workspaceId: string; revision: number; title: string; eventCount: number; projectedCount: number; jobs: Entity[]; datasets: Entity[]; runs: Entity[]; editions: Edition[]; reviews: Review[]; sources: Record<string, unknown>[]; results: Record<string, unknown>[]; schemaComparisons: SchemaComparison[]; schemaReviews: SchemaReview[]; diagnostics: {eventId: string; messages: string[]}[]; }
export interface Export { id: string; bytes: number; workspaceId: string; revision: number; name: string; }

export type SchemaDecision = "observed" | "needs-work" | "accepted" | "resolved";
export interface SchemaEvidenceSelection { kind: "source" | "event" | "result"; id: string; }
export interface SchemaField {
  key: string; recordKey: string; path: string[]; indexPath: number[]; ambiguous: boolean; name: string; position: number; metadata: Record<string, unknown>;
  jsonPointer: string; nested: boolean;
}
export interface SchemaObservation {
  eventId: string; eventTime: string; sequence: number; jsonPointer: string;
  facet: unknown; sources: {sourceId: string; name: string; bytes: number; sourceUrl: string; line?: number; index?: number}[];
}
export interface SchemaInventory {
  status: "dataset-unobserved" | "schema-unreported" | "facet-withdrawn" | "fields-unreported" | "declared" | "ambiguous-fields";
  fields: SchemaField[]; invalidRecords: {jsonPointer: string; indexPath: number[]; value: unknown}[]; metadata: unknown; observation: SchemaObservation | null; diagnostics: string[];
}
export interface SchemaChange {
  id: string; datasetKey: EntityKey; kind: string; fieldPath: string[] | null; fieldKey: string | null; property: string;
  before: {present: boolean; value: unknown}; after: {present: boolean; value: unknown};
}
export interface SchemaComparison {
  id: string; schema: "commons.openlineage.schema-comparison.v1"; workspaceId: string;
  from: Pick<Edition, "id" | "title" | "sourceRevision" | "createdAt" | "eventIds" | "sourceIds">;
  to: Pick<Edition, "id" | "title" | "sourceRevision" | "createdAt" | "eventIds" | "sourceIds">;
  datasets: {key: EntityKey; namespace: string; name: string; before: SchemaInventory; after: SchemaInventory; changes: SchemaChange[]}[];
  declaredEdges: {before: Record<string, unknown>[]; after: Record<string, unknown>[]};
  summary: {datasets: number; changedDatasets: number; changes: number; ambiguousDatasets: number};
}
export interface SchemaReview {
  schema: "commons.openlineage.schema-review.v1"; workspaceId: string; id: string; comparisonId: string;
  from: string; to: string; changeIds: string[]; reviewer: string; decision: SchemaDecision; reason: string;
  owner: string; action: string; resolution: string; evidence: (SchemaEvidenceSelection & Record<string, unknown>)[];
  savedRevision: number; createdAt: string; updatedAt: string; history: Omit<SchemaReview, "history">[];
}
export interface SchemaReviewInput extends Mutation {
  id?: string; from: string; to: string; comparisonId: string; changeIds: string[];
  reviewer: string; decision: SchemaDecision; reason: string; owner?: string; action?: string;
  resolution?: string; evidence?: SchemaEvidenceSelection[];
}
export interface SchemaComparisonResult {
  workspaceId: string; revision: number; comparison: SchemaComparison; comparisonId: string;
  reviews: SchemaReview[]; changes: (SchemaChange & {namespace: string; datasetName: string; decision: SchemaDecision | "unreviewed"; owner: string; reviewer: string; reviewId: string | null; reviewIds: string[]})[];
  counts: Record<SchemaDecision | "unreviewed", number>;
}
export interface SchemaImpactSide {
  editionId: string; roots: string[]; nodes: {id: string; entityKey: EntityKey; field: string; depth: number; edgePath: string[]; via: string | null; source: boolean; schemaPresence: "observed" | "schema-unreported" | "absent-from-declared-schema" | "ambiguous-schema-path"}[];
  edges: Record<string, unknown>[]; entityDependencies: Record<string, unknown>[]; unresolved: Record<string, unknown>[];
  datasetAndJobKeys: EntityKey[]; runKeys: EntityKey[]; complete: boolean;
}
export interface SchemaImpact {
  workspaceId: string; revision: number; schema: "commons.openlineage.schema-impact.v1"; comparisonId: string;
  change: SchemaChange; before: SchemaImpactSide; after: SchemaImpactSide;
}

export class LineageClient {
  constructor(baseUrl: string, options?: {token?: string | null; fetchImpl?: typeof fetch; timeoutMs?: number; expectedWorkspaceId?: string; instanceId?: string; signal?: AbortSignal});
  action(action: string, args?: Record<string, unknown>): Promise<any>;
  producerStatus(): Promise<ProducerStatus>;
  emitSource(bytes: Uint8Array | string, options?: {name?: string; sourceUrl?: string; contentEncoding?: "identity" | "gzip"; operationId?: string; expectedRevision?: number}): Promise<ProducerReceipt>;
  metadata(): Promise<{workspaceId: string; title: string; revision: number; counts: Record<string, number>; retained: Record<string, number>}>;
  records(args: {collection: string; expectedRevision: number; edition?: string; offset?: number; limit?: number}): Promise<{workspaceId: string; revision: number; total: number; nextOffset: number | null; items: any[]}>;
  object(id: string, options?: {offset?: number; length?: number}): Promise<{id: string; name: string; mediaType: string; totalBytes: number; offset: number; bytes: number; nextOffset: number; complete: boolean; base64: string}>;
  read(options?: {edition?: string}): Promise<WorkspaceView>;
  importSource(bytes: Uint8Array | string, args: Mutation & {name?: string; sourceUrl?: string; contentEncoding?: "identity" | "gzip"}): Promise<{revision: number; added: number; retained: number; source: Record<string, unknown>}>;
  saveEdition(args: Mutation & {title: string; description?: string}): Promise<{revision: number; edition: Edition}>;
  compare(from: string, to?: string): Promise<{from: string; to: string | null; changes: {kind: string; key: string; change: string; before: Entity | null; after: Entity | null}[]; addedEventIds: string[]}>;
  entity(key: EntityKey, edition?: string): Promise<Entity>;
  lineage(key: EntityKey, options?: {edition?: string; direction?: "upstream" | "downstream" | "both"; maxDepth?: number}): Promise<{nodes: Entity[]; edges: Record<string, unknown>[]}>;
  compareSchemas(from: string, to: string): Promise<SchemaComparisonResult>;
  schemaImpact(args: {from: string; to: string; comparisonId: string; changeId: string}): Promise<SchemaImpact>;
  saveSchemaReview(args: SchemaReviewInput): Promise<{workspaceId: string; revision: number; operationId: string; replayed?: boolean; review: SchemaReview; comparisonId: string; summary: Omit<SchemaComparisonResult, "workspaceId" | "revision" | "comparison">}>;
  schemaReport(from: string, to: string, format?: "json" | "csv" | "html"): Promise<{mediaType: string; text: string}>;
  saveReview(args: Mutation & {id?: string; title: string; reason: string; decision: Decision; entityKeys: EntityKey[]; editionId?: string | null}): Promise<{revision: number; review: Review}>;
  attachResult(bytes: Uint8Array | string, args: Mutation & {name: string; mediaType?: string; entityKeys: EntityKey[]; editionId: string; sourceReference: string; query?: unknown}): Promise<{revision: number; result: Record<string, unknown>}>;
  exportWorkspace(options?: {includeApplication?: boolean}): Promise<Export>;
  downloadExport(id: string, destination: string, options?: {chunkBytes?: number}): Promise<{id: string; bytes: number; destination: string; alreadyPresent?: boolean}>;
}
