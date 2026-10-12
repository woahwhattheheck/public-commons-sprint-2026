/** Retained chart changes in the original accounting workspace. */
export interface SourceChangeBinding { workspaceId: string; sourcesSha256: string }
export type SourceChangeKind = "qbo" | "xero";
export type SourceChangePhase = "PREPARED" | "APPLYING" | "CANCELLED_PENDING_SUCCESSOR" | "COMPLETED";
export interface SourceChangeAccount {
  id: string; code: string | null; name: string; eligible: boolean;
  status: string; type: string; currency?: string; systemAccount?: string; reasons?: readonly string[];
}
export interface SourceChangeCompany {
  id: string; name: string; baseCurrency: string;
  multiCurrencyEnabled?: boolean; isDemoCompany?: boolean; status?: string;
}
/** Validated by the original validateQboCompany, including all original response text. */
export interface SourceChangeQboSnapshot {
  schema: "stellar-forge.quickbooks-company.v1";
  realmId: string; companyName: string; baseCurrency: string; multiCurrencyEnabled: boolean;
  accounts: readonly Record<string, unknown>[];
  summary: Record<string, unknown>;
  sourceDocuments: { companyInfo: string; preferences: string; accounts: string };
  sourceDigests: Record<string, unknown>;
  integrity: { sha256: string };
}
export type SourceChangeTarget =
  | { kind: "qbo-review"; id: string; sha256: string }
  | { kind: "qbo-snapshot"; snapshot: SourceChangeQboSnapshot }
  | { kind: "xero-context"; id: string; sha256: string };
export interface SourceChangeQboRow {
  rowId: string; amount: string;
  debitAccount: { value: string }; creditAccount: { value: string }; description: string;
}
export type SourceChangeXeroEntry =
  | { componentId: string; decision: "include"; date: string; amount: string;
      debitAccountCode: string; creditAccountCode: string; valuationNote: string; description: string }
  | { componentId: string; decision: "exclude"; reason: string };
export interface SourceChangeSuccessorIdentity { id: string; createdAt: string; name: string; actor: string }
export interface SourceChangeQboSuccessor extends SourceChangeSuccessorIdentity {
  txnDate: string; docNumber?: string | null; rows: readonly SourceChangeQboRow[];
}
export interface SourceChangeXeroSuccessor extends SourceChangeSuccessorIdentity {
  entries: readonly SourceChangeXeroEntry[]; valuationBasis: string;
}
export interface SourceChangeAccountDifference {
  id: string; change: "added" | "removed" | "changed" | "unchanged";
  before: SourceChangeAccount | null; after: SourceChangeAccount | null;
  fields: readonly string[]; usedBy: readonly { sourceId: string; side: "debit" | "credit" }[];
}
export interface SourceChangeComparison {
  schema: "stellar-forge.accounting-source-change.v1"; kind: SourceChangeKind;
  predecessorSha256: string; beforeSha256: string; afterSha256: string; sourceChanged: boolean;
  companyChanges: readonly { field: string; before: unknown; after: unknown }[];
  accounts: readonly SourceChangeAccountDifference[];
  summary: { added: number; removed: number; changed: number; unchanged: number;
    usedChanged: number; usedUnavailable: number; currencyChanged: boolean };
  sha256: string;
}
export type SourceChangeInspectInput = {
  binding: SourceChangeBinding; kind: "qbo"; planId: string;
  target: Extract<SourceChangeTarget, { kind: "qbo-review" | "qbo-snapshot" }>;
} | {
  binding: SourceChangeBinding; kind: "xero"; planId: string;
  target: Extract<SourceChangeTarget, { kind: "xero-context" }>;
};
export type SourceChangePrepareInput = {
  id: string; predecessorSha256: string; comparisonSha256: string;
  rationale: string; valuationConfirmed: true;
} & (Extract<SourceChangeInspectInput, { kind: "qbo" }> & { successor: SourceChangeQboSuccessor }
  | Extract<SourceChangeInspectInput, { kind: "xero" }> & { successor: SourceChangeXeroSuccessor });
export interface SourceChangeApplyInput {
  binding: SourceChangeBinding; id: string; previewSha256: string; revision: number;
  actor: string; note: string; unusedConfirmed: true; noExternalImport: true; mappingConfirmed: true;
}
export interface SourceChangeResumeInput { binding: SourceChangeBinding; id: string }
export interface SourceChangeRejection {
  id: string; requestSha256: string; state: "rejected"; error: string; message: string; createdAt: string;
}
export interface SourceChangeIntent {
  id: string; requestSha256: string; actor: string; note: string; createdAt: string;
  cancellation: { id: string; actor: string; note: string; planSha256: string; unusedConfirmed: true }
    | { actor: string; reason: string; noExternalImport: true };
  successorId: string; previewSha256: string;
}
export interface SourceChangeRecord {
  id: string; binding: SourceChangeBinding; kind: SourceChangeKind;
  planId: string; predecessorSha256: string; successorId: string;
  name: string; actor: string; createdAt: string; rationale: string;
  previewSha256: string; comparisonSha256: string; phase: SourceChangePhase;
  intent: SourceChangeIntent | null; cancelledAt: string | null; completedAt: string | null;
  rejections: readonly SourceChangeRejection[];
}
export interface SourceChangeEnvelope {
  schema: "stellar-forge.accounting-source-change.v1"; binding: SourceChangeBinding;
}
export interface SourceChangeSource {
  before: { sha256: string; company: SourceChangeCompany };
  after: Record<string, unknown> & { company: SourceChangeCompany };
}
export interface SourceChangeInspection extends SourceChangeEnvelope {
  revision: number; kind: SourceChangeKind; planId: string;
  predecessor: { id: string; name: string; sha256: string; eligible: boolean; blockers: readonly string[] };
  target: Record<string, unknown>; comparison: SourceChangeComparison; accounts: readonly SourceChangeAccount[];
  defaults: Omit<SourceChangeQboSuccessor, "id" | "createdAt" | "actor">
    | Omit<SourceChangeXeroSuccessor, "id" | "createdAt" | "actor">;
  source: SourceChangeSource;
}
export interface SourceChangeDetail extends SourceChangeEnvelope {
  revision: number; reopenRequired: boolean; record: SourceChangeRecord;
  review: { comparison: SourceChangeComparison; source: SourceChangeSource;
    request: Record<string, unknown>; plan: Record<string, unknown>; predecessor: Record<string, unknown> };
  current: { predecessorEligible: boolean; blockers: readonly string[]; predecessorCancelled: boolean;
    successorExists: boolean; successorStatus: string | null };
}
export interface SourceChangeCatalog extends SourceChangeEnvelope {
  revision: number; reopenRequired: boolean; connectionsAvailable: boolean;
  plans: readonly { kind: SourceChangeKind; id: string; name: string; sha256: string; company: string;
    baseCurrency: string; baselineAvailable: boolean; eligible: boolean; blockers: readonly string[] }[];
  contexts: readonly { id: string; name: string; tenantId: string; sha256: string; createdAt: string }[];
  changes: readonly SourceChangeRecord[];
}
export interface SourceChangeSourcePage extends SourceChangeEnvelope {
  reviews: readonly Record<string, unknown>[]; total: number; nextOffset: number | null;
}
export interface SourceChangeErrorEnvelope {
  schema: "stellar-forge.accounting-source-change.v1"; binding: SourceChangeBinding | null;
  reopenRequired: boolean; error: string; message: string;
  outcome: "unknown" | "not_found" | "rejected"; command?: SourceChangeRejection;
}
export interface SourceChangeFile { bytes: Uint8Array; name: string; type: string }
/**
 * A hosting adapter supplies the original leased Store and native controllers.
 * The opaque controller arguments are the existing QboWorkspace/XeroWorkspace
 * and optional openAccountingConnections result. No replacement provider is opened.
 */
export declare class SourceChangeWorkspace {
  constructor(workspace: unknown, options: { qbo?: unknown | null; xero: unknown; connections?: unknown | null });
  readonly workspace: unknown;
  readonly tasks: Set<Promise<unknown>>;
  reopenRequired: boolean;
  binding(): SourceChangeBinding;
  assertBinding(value: SourceChangeBinding): void;
  catalog(): Promise<SourceChangeCatalog>;
  sources(options?: { offset?: number; limit?: number }): Promise<SourceChangeSourcePage>;
  inspect(value: SourceChangeInspectInput): Promise<SourceChangeInspection>;
  prepare(value: SourceChangePrepareInput): Promise<SourceChangeDetail>;
  detail(changeId: string): Promise<SourceChangeDetail>;
  apply(changeId: string, value: SourceChangeApplyInput): Promise<SourceChangeDetail>;
  resume(changeId: string, value: SourceChangeResumeInput): Promise<SourceChangeDetail>;
  download(changeId: string): Promise<SourceChangeFile>;
  close(): Promise<void>;
}
export declare const SOURCE_CHANGE_REQUEST_BYTES: number;
export declare function handleSourceChangeRequest(
  owner: SourceChangeWorkspace | null | undefined,
  request: { method: string; path: string; value?: unknown; query?: Record<string, string> }
): Promise<null | { file: SourceChangeFile }
  | { value: SourceChangeCatalog | SourceChangeSourcePage | SourceChangeInspection | SourceChangeDetail }
  | { status: number; value: SourceChangeErrorEnvelope }>;
