import type { HaystackAnalysis, HaystackRole } from "./haystack-index.mjs";
export type Json = null | boolean | number | string | Json[] | { [name: string]: Json };
export type Role = "site" | "equip" | "point" | "all";
export type Counts = HaystackAnalysis["counts"];
export type Severity = "error" | "warning" | "info";
export type ProposalState = "proposed" | "accepted" | "rejected";
export interface Identity {
  schema: "commons.haystack.startup.v1"; workspaceId: string; workspaceCreatedAt: string;
  instanceId: string; startedAt: string; pid: number; url: string; directory: string;
}
export interface Diagnostic {
  id: string; code: string; severity: Severity; message: string; sourceId?: string;
  rowIndex?: number; recordKey?: string; tag?: string; details?: Json;
}
export interface Source {
  id: string; name: string; sourceUrl: string; format: "json-v4"; bytes: number; importedAt: string;
  gridSha256: string; rows: number; columns: number; diagnostics: Diagnostic[]; selected?: boolean;
}
export interface NativeRecord {
  key: string; sourceId: string; rowIndex: number; tags: Record<string, Json>; id: string | null; display: string;
  roles: HaystackRole[]; siteRef: string | null; equipRef: string | null;
  kind: string | null; unit: string | null; markers: string[];
  outgoingRelationIds: string[]; diagnosticIds: string[]; refCount: number;
}
export interface Relation {
  id: string; sourceId: string; fromKey: string; tag: string; targetId: string; targetKeys: string[];
  state: "resolved" | "unresolved" | "ambiguous"; crossSourceCandidateKeys?: string[]; path?: string;
}
export interface Status {
  format: "commons.haystack.workspace.v1"; workspaceId: string; title: string; revision: number;
  createdAt: string; sha256: string; materialSha256: string; selectedSourceIds: string[];
  sourceCount: number; editionCount: number; proposalCount: number; pendingProposals: number;
  recordCount: number; counts: Counts; diagnosticCount: number; sourceDiagnostics: number;
}
export interface Revision { expectedRevision: number }
export interface Mutation extends Revision { operationId: string }
export interface Paging { offset?: number; limit?: number }
export interface EditionSelection extends Revision { editionId?: string }
export interface Envelope { workspaceId: string; revision: number; editionId?: string }
export interface Page<T> extends Envelope {
  items: T[]; offset: number; limit: number; total: number; nextOffset: number; hasMore: boolean;
}
export interface Outcome extends Envelope { operationId: string; replayed: boolean }
export type Cell = { present: false } | { present: true; value: Json };
export type Edit = { recordKey: string; tag: string; action: "set"; value: Json } | { recordKey: string; tag: string; action: "remove" };
export interface Change { recordKey: string; tag: string; before: Cell; after: Cell }
export interface Proposal {
  id: string; title: string; note: string; createdAt: string; createdRevision: number; baseMaterialSha256: string;
  state: ProposalState; changes: Change[]; review: null | { decision: "accept" | "reject"; note: string; reviewedAt: string; proposalSha256: string };
  reviewedRevision?: number; sha256: string; stale: boolean;
}
export type ProposalSummary = Omit<Proposal, "changes"> & { changeCount: number };
export interface Preview { counts: Counts; diagnostics: Diagnostic[] }
export interface Edition {
  id: string; title: string; note: string; savedAt: string; savedRevision: number; sourceIds: string[];
  approvedProposalIds: string[]; materialSha256: string; counts: Counts; diagnosticCount: number; diagnosticSha256: string;
}
export interface SourcePair { beforeSourceId: string; afterSourceId: string }
export type ChangeState = "added" | "removed" | "changed" | "same";
export interface ComparisonRow { key: string; state: ChangeState; before: NativeRecord | null; after: NativeRecord | null; changes: Array<Omit<Change, "recordKey">> }
export interface Comparison extends Page<ComparisonRow> {
  beforeEditionId: string; afterEditionId: string; sourcePairs: SourcePair[]; counts: Record<ChangeState, number>;
}
export interface ByteRange {
  sha256: string; name: string; mediaType: string; sourceId?: string; operationId?: string;
  offset: number; bytes: number; totalBytes: number; nextOffset: number; complete: boolean; base64: string; chunkSha256: string;
}
export interface Delivery extends Outcome {
  name: string; mediaType: string; sha256: string; bytes: number; kind: "workspace" | "register" | "diagnostics" | "native-grid"; createdAt: string;
}
export type DeliveryArguments = Mutation & (
  { kind: "workspace" } |
  { kind: "register" | "diagnostics"; format?: "json" | "csv" | "html"; editionId?: string; role?: Role } |
  { kind: "native-grid"; sourceId: string; editionId?: string; format?: "json" }
);
export interface Operation {
  id: string; action: string; argumentsSha256: string; revision: number; at: string;
  previousSha256: string | null; result: Record<string, Json>; sha256: string;
}
export interface ActionMap {
  "workspace.status": { args: Record<string, never>; result: Status };
  "workspace.rename": { args: Mutation & { title: string }; result: Outcome & { title: string } };
  "sources.list": { args: Revision & Paging; result: Page<Source> };
  "source.read": { args: { sourceId: string; offset?: number; length?: number }; result: ByteRange };
  "source.import": { args: Mutation & { name: string; base64: string; sourceUrl?: string; format?: "json-v4"; select?: boolean }; result: Outcome & { source: Source; alreadyRetained?: boolean; selected?: boolean } };
  "source.select": { args: Mutation & { sourceIds: string[] }; result: Outcome & { sourceIds: string[] } };
  "records.list": { args: EditionSelection & Paging & { role?: Role; sourceId?: string; query?: string }; result: Page<NativeRecord> };
  "record.read": { args: EditionSelection & { recordKey: string }; result: Envelope & { record: NativeRecord; relations: Relation[]; diagnostics: Diagnostic[] } };
  "diagnostics.list": { args: EditionSelection & Paging & { severity?: Severity; sourceId?: string; recordKey?: string }; result: Page<Diagnostic> };
  "proposal.preview": { args: Revision & { edits: Edit[] }; result: Envelope & Preview & { materialSha256: string; changes: Change[] } };
  "proposals.list": { args: Revision & Paging & { state?: ProposalState }; result: Page<ProposalSummary> };
  "proposal.read": { args: Revision & { proposalId: string }; result: Envelope & { proposal: Proposal; preview: Preview | null } };
  "proposal.prepare": { args: Mutation & { title: string; note?: string; edits: Edit[]; proposalId?: string }; result: Outcome & { proposal: Proposal; preview: Preview } };
  "proposal.review": { args: Mutation & { proposalId: string; decision: "accept" | "reject"; note?: string }; result: Outcome & { proposal: Proposal } };
  "editions.list": { args: Revision & Paging; result: Page<Edition> };
  "edition.read": { args: Revision & { editionId: string }; result: Envelope & { edition: Edition; sources: Source[]; counts: Counts; diagnosticCount: number } };
  "edition.save": { args: Mutation & { title: string; note?: string }; result: Outcome & { edition: Edition } };
  "edition.compare": { args: Revision & Paging & { beforeEditionId: string; afterEditionId: string; sourcePairs?: SourcePair[]; state?: ChangeState }; result: Comparison };
  "operations.list": { args: Revision & Paging; result: Page<Operation> };
  "operation.read": { args: { operationId: string }; result: Outcome & Record<string, unknown> };
  "delivery.prepare": { args: DeliveryArguments; result: Delivery };
  "delivery.read": { args: { operationId: string; offset?: number; length?: number }; result: ByteRange };
}
export type PagedAction = { [A in keyof ActionMap]: ActionMap[A]["result"] extends Page<unknown> ? A : never }[keyof ActionMap];
export interface RequestOptions { signal?: AbortSignal }
export interface ClientOptions {
  url: string; token?: string; workspaceId?: string | null; instanceId?: string | null;
  fetch?: typeof globalThis.fetch; maxResponseBytes?: number;
}
export class HaystackClientError extends Error {
  status: number; code: string; details?: unknown; outcomeUnknown: boolean;
  constructor(message: string, options?: { status?: number; code?: string; details?: unknown; outcomeUnknown?: boolean });
}
export class HaystackClient {
  constructor(options: ClientOptions);
  url: string; token: string; workspaceId: string | null; instanceId: string | null; identity: Identity | null; maxResponseBytes: number;
  connect(options?: RequestOptions): Promise<Identity>;
  request(action: "workspace.status", args?: Record<string, never>, options?: RequestOptions): Promise<Status>;
  request<A extends keyof ActionMap>(action: A, args: ActionMap[A]["args"], options?: RequestOptions): Promise<ActionMap[A]["result"]>;
  pages<A extends PagedAction>(action: A, args: ActionMap[A]["args"], options?: RequestOptions): AsyncGenerator<ActionMap[A]["result"], void, unknown>;
  sourceBytes(sourceId: string, options?: RequestOptions): Promise<Uint8Array>;
  deliveryBytes(operationId: string, options?: RequestOptions): Promise<Uint8Array>;
}
