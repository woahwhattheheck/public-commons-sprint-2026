// Original Oak workbench data. This is the managed workspace SDK, separate from
// the generated 32-operation Oak HTTP API client returned by generateSdk().
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export interface Context { actor: string; at: string }
export interface Provenance extends JsonObject { kind: string; label: string }
export interface Edition {
  id: string; name?: string; provenance: JsonObject;
  surface: JsonObject & { paths: JsonObject }; bulkSchema?: Json;
  graphql?: Json; owaSource?: string; [key: string]: unknown;
}
export type FieldMapping =
 | { action: "copy" | "move"; from: string; to: string; reason: string }
 | { action: "omit"; from: string; reason: string }
 | { action: "constant"; to: string; value: Json; reason: string };
export interface RetainedResponse {
  status: number; body: Json; provenance: Provenance;
  headers?: JsonObject; contentType?: string; [key: string]: unknown;
}
export interface Difference { path: string; kind: string; before?: Json; after?: Json; [key: string]: unknown }
export interface ValidationIssue { path: string; rule?: string; keyword?: string; message: string }
export interface ValidationResult { valid: boolean; errors: ValidationIssue[]; unsupported: ValidationIssue[] }
export interface ComparisonRun extends Context {
  id: string; caseRevision: number; sourceEditionId: string; targetEditionId: string;
  original: RetainedResponse; candidate: RetainedResponse; mappings: FieldMapping[];
  arrayKeys: Record<string,string>; expected: Json; appliedMappings: JsonObject[];
  differences: Difference[]; originalValidation: ValidationResult; candidateValidation: ValidationResult;
  status: "MATCH" | "REVIEW";
}
export interface CaseDecision extends Context { runId: string; outcome: "accepted" | "changes-required"; note: string }
export interface OccurrenceMapping { kind: "unit" | "lesson"; from: string; to: string; reason: string }
export interface CurriculumOptions { namespaces: { original: string; candidate: string }; mappings?: OccurrenceMapping[] }
export interface CurriculumPlan extends Context {
  format: "curriculum-migration-plan.v1"; id: string;
  input: {
    caseId: string; caseRevision: number;
    originalEdition: Pick<Edition,"id"|"provenance"|"bulkSchema">;
    candidateEdition: Pick<Edition,"id"|"provenance"|"bulkSchema">;
    original: RetainedResponse; candidate: RetainedResponse;
    fieldMappings: FieldMapping[]; namespaces: { original: string; candidate: string };
  };
  mappings: OccurrenceMapping[]; rawOriginal: JsonObject; expected: Json;
  appliedFieldMappings: JsonObject[]; comparison: JsonObject;
  originalValidation: ValidationResult; candidateValidation: ValidationResult;
  expectedValidation: ValidationResult; transportDifferences: Difference[];
  status: "MATCH" | "REVIEW";
}
export interface CurriculumDecision extends Context { planId: string; outcome: "accepted" | "changes-required"; note: string }
export interface Case {
  id: string; name: string; operationKey: string; sourceEditionId: string; targetEditionId: string;
  request: JsonObject; revision: number;
  responses: { original: RetainedResponse | null; candidate: RetainedResponse | null };
  mappings: FieldMapping[]; arrayKeys: Record<string,string>; runs: ComparisonRun[];
  decisions: CaseDecision[]; curriculumPlans?: CurriculumPlan[]; curriculumDecisions?: CurriculumDecision[];
}
export interface Asset { id: string; name: string; kind: "sql"|"hasura-metadata"|"drizzle"|"graphql-introspection"|"source-notes"; content: string; [key: string]: unknown }
export interface HistoryRow extends Context { sequence: number; type: string; detail: JsonObject }
export interface Workspace {
  format: "curriculum-migration-workspace.v1"; id: string; name: string; revision: number;
  editions: Edition[]; cases: Case[]; assets: Asset[]; history: HistoryRow[];
}
export interface PortableWorkspace { format: "curriculum-workspace-export.v1"; sha256: string; workspace: Workspace }
export type Command = Context & (
 | { kind: "addEdition"; body: { edition: Edition } }
 | { kind: "addCase"; body: { case: Pick<Case,"id"|"name"|"operationKey"|"sourceEditionId"|"targetEditionId"> & { request?: JsonObject } } }
 | { kind: "updateCase"; body: { caseId: string; patch: Partial<Pick<Case,"name"|"request"|"mappings"|"arrayKeys"|"targetEditionId">> } }
 | { kind: "saveResponse"; body: { caseId: string; lane: "original"|"candidate"; response: RetainedResponse } }
 | { kind: "compareCase"; body: { caseId: string } }
 | { kind: "decide"; body: { caseId: string; decision: Pick<CaseDecision,"runId"|"outcome"|"note"> } }
 | { kind: "addAsset"; body: { asset: Asset } }
 | { kind: "planCurriculumCase"; body: { caseId: string; options: CurriculumOptions } }
 | { kind: "decideCurriculumPlan"; body: { caseId: string; decision: Pick<CurriculumDecision,"planId"|"outcome"|"note"> } }
);
export interface Expected { workspaceId: string; revision: number; snapshotSha256: string }
export interface SelectedBranch { id: string; expected: Expected }
export interface BranchSummary extends Expected {
  schema: "curriculum-browser-branch.v1"; id: string; label: string; storeId: string;
  createdAt: string; updatedAt: string; origin: JsonObject; creationSha256: string;
}
export interface Branch extends BranchSummary { snapshot: Workspace }
export interface StoreIdentity {
  schema: "stellar-forge.curriculum-migration-store.v1"; id: string; directory: string;
  title: string; createdAt: string; defaultBranchId: string; creationInputHash: string; sourceSha256: string;
}
export interface ObjectDescriptor { sha256: string; bytes: number }
export interface FileDescriptor extends ObjectDescriptor { path: string }
export interface CommandResult {
  branch: Branch; result: { kind: Command["kind"]; revision: number; caseId?: string; editionId?: string; assetId?: string; runId?: string; planId?: string };
  replayed: false;
}
export interface RequestReceipt {
  requestId: string; inputObject: ObjectDescriptor; inputSha256: string; sequence: number;
  resultObject: ObjectDescriptor; input: Json; result: Branch | CommandResult;
}
export interface HistoryPage extends Expected { id: string; total: number; offset: number; nextOffset: number|null; items: HistoryRow[] }
export type ReportKind = "portfolio"|"curriculumPortfolio"|"case"|"sourceInventory"|"curriculumPlan"|"curriculumReviewRows"|"sdk";
export type ReportInput = SelectedBranch & (
 | { kind: "portfolio"|"curriculumPortfolio"; options?: Record<string,never> }
 | { kind: "case"; options: { caseId: string } }
 | { kind: "sourceInventory"|"sdk"; options: { editionId: string } }
 | { kind: "curriculumPlan"|"curriculumReviewRows"; options: { caseId: string; planId: string } }
);
export interface ReportResult<T = Json> { branch: BranchSummary; kind: ReportKind; result: T }
export interface GeneratedFile { path: string; content: string }
export interface GeneratedSdk { editionId: string; client: string; types: string; files: GeneratedFile[]; inventory: JsonObject; diagnostics: Json[]; descriptors: FileDescriptor[] }
export type DownloadInput = SelectedBranch & (
 | { kind: "workspace"; options?: Record<string,never> }
 | { kind: "report"; options: { kind: ReportKind; options?: JsonObject } }
 | { kind: "sdkFile"; options: { editionId: string; path: "client.ts"|"types.ts"|"inventory.json" } }
 | { kind: "sourceEdition"; options: { editionId: string } }
 | { kind: "response"; options: { caseId: string; lane: "original"|"candidate" } }
 | { kind: "case"; options: { caseId: string } }
);
export interface ClientOptions { connectionFile: string; storeId: string; storeDirectory: string; timeoutMs?: number }
export interface ReceiveInput { id: string; label: string; origin?: JsonObject; requestId: string }
export interface CommandInput extends SelectedBranch { requestId: string; command: Command }
export interface ByteResult extends ObjectDescriptor { mediaType: string }
export type ChunkConsumer = (bytes: Uint8Array) => void | Promise<void>;

export interface CreateBranchInput extends ReceiveInput { snapshot: Workspace | PortableWorkspace }
export type ImportAssetInput = SelectedBranch & { requestId: string; command: Context & {
  kind: "addAsset"; body: { asset: Pick<Asset,"id"|"name"|"kind"> & { [key: string]: unknown } }
}};
export type ImportResponseInput = SelectedBranch & { requestId: string; command: Context & {
  kind: "saveResponse"; body: { caseId: string; lane: "original"|"candidate";
    response: Pick<RetainedResponse,"status"|"provenance"> & { headers?: JsonObject; contentType?: string; [key: string]: unknown }
  }
}};
export type ImportEditionInput = SelectedBranch & { requestId: string; command: Context & { kind: "addEdition"; body?: Record<string,never> }};
export class CurriculumMigrationError extends Error {
  readonly code: string; readonly status: number|null; readonly result: unknown;
  readonly uncertain: boolean; readonly requestId: string|null;
  constructor(code: string, message: string, details?: {status?:number|null;result?:unknown;uncertain?:boolean;requestId?:string|null});
}
export class CurriculumMigrationClient {
  constructor(options: ClientOptions);
  readonly selectedStore: {storeId:string;storeDirectory:string};
  state(): Promise<StoreIdentity>;
  branches(): Promise<BranchSummary[]>;
  branch(id:string): Promise<Branch>;
  request(requestId:string): Promise<RequestReceipt|null>;
  createBranch(input:CreateBranchInput): Promise<Branch>;
  command(input:CommandInput): Promise<CommandResult>;
  report(input:SelectedBranch & {kind:"sdk";options:{editionId:string}}): Promise<ReportResult<GeneratedSdk>>;
  report(input:SelectedBranch & {kind:"case";options:{caseId:string}}): Promise<ReportResult<Case>>;
  report(input:SelectedBranch & {kind:"curriculumPlan";options:{caseId:string;planId:string}}): Promise<ReportResult<CurriculumPlan>>;
  report(input:ReportInput): Promise<ReportResult>;
  historyPage(input:SelectedBranch & {offset?:number;limit?:number}): Promise<HistoryPage>;
  history(input:SelectedBranch & {limit?:number}): AsyncGenerator<HistoryPage,void,unknown>;
  exportBranch(input:SelectedBranch): Promise<PortableWorkspace>;
  download(input:DownloadInput,onChunk:ChunkConsumer,expectedFile?:ObjectDescriptor): Promise<ByteResult>;
  downloadAsset(input:SelectedBranch & {assetId:string},onChunk:ChunkConsumer,expectedFile?:ObjectDescriptor): Promise<ByteResult>;
  downloadApplicationSource(path:string,onChunk:ChunkConsumer,expectedFile?:ObjectDescriptor): Promise<ByteResult>;
  receiveFile(input:ReceiveInput,file:string,expectedFile:ObjectDescriptor): Promise<Branch>;
  importAssetFile(input:ImportAssetInput,file:string,expectedFile:ObjectDescriptor): Promise<CommandResult>;
  importResponseFile(input:ImportResponseInput,file:string,expectedFile:ObjectDescriptor): Promise<CommandResult>;
  importEditionFile(input:ImportEditionInput,file:string,expectedFile:ObjectDescriptor): Promise<CommandResult>;
  close(): Promise<void>;
}
export function createCurriculumMigrationClient(options:ClientOptions): CurriculumMigrationClient;
