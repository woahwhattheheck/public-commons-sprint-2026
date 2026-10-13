/** The maintained Portfolio target desk's existing HTTP and commissioning contracts. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type ReadonlyDeep<T> = T extends readonly (infer V)[] ? readonly ReadonlyDeep<V>[] :
  T extends object ? { readonly [P in keyof T]: ReadonlyDeep<T[P]> } : T;
export type Identity = string;
export type NativeGuid = string;
export type SourceFamily = "tasks" | "resources" | "assignments" | "dependencies" | "calendars";
export type MappedFamily = Exclude<SourceFamily, "calendars">;
export type EvidenceClass = "native_receipt" | "original_export" | "original_screenshot" | "operator_statement";
export type ExceptionDisposition = "retained_difference" | "needs_correction" | "manual_followup" | "observed_resolved";
export type ComparisonStatus = "equal" | "different" | "unmapped" | "unobserved";
export interface UploadDescriptor {
  schema: "portfolio.operator-upload.v1"; sha256: Identity; bytes: number; filename: string; path: string;
}
export interface EvidenceSelection {
  source: UploadDescriptor; class: EvidenceClass; title?: string; format?: string;
}
export interface ImportException {
  evidence_sha256: Identity; coordinate: JsonValue; original: JsonValue;
}
export interface ExceptionDecision {
  exception_id: Identity; disposition: ExceptionDisposition; note: string; evidence_sha256: Identity[];
}
export interface ConversionRule {
  target: string; convert: "text" | "utc" | "integer" | "number" | "percent_fraction" | "boolean" | "choice";
  values?: { [sourceValue: string]: number }; timezone?: string; fold?: 0 | 1;
}
export interface CommissioningMappings {
  task_fields?: { [originalSourceField: string]: ConversionRule };
  date_decisions?: { [originalTaskKey: string]: { [originalField: string]: { timezone?: string; fold?: 0 | 1 } } };
  retain_source_note?: string;
}
export type RowMappings = { [F in MappedFamily]: { [originalSourceKey: string]: NativeGuid } };
export interface IntakeArguments {
  source: UploadDescriptor; label?: string; profile?: JsonObject;
  companions?: Array<UploadDescriptor | {
    source: UploadDescriptor; label?: string;
    profile?: { format?: string; role?: string; encoding?: string; delimiter?: string; json_pointer?: string };
  }>;
}
export interface AdoptionArguments {
  edition_id: Identity; profile_id: string; project_id: NativeGuid; evidence: EvidenceSelection[];
  import_exceptions?: ImportException[]; import_settings?: JsonObject; import_time?: JsonValue;
  project_url?: string; label?: string;
}
export interface RevisionSelection { deployment_id: Identity; expected_revision: number; }
export interface AdoptionProposalArguments extends RevisionSelection {
  row_ids: RowMappings; exception_decisions: ExceptionDecision[]; mappings?: CommissioningMappings;
}
export interface ReviewerSelection { reviewer: string; note: string; accepted_findings: Identity[]; }
export interface AdoptionReviewArguments extends RevisionSelection, ReviewerSelection { proposal_sha256: Identity; }
export interface CorrectionArguments extends RevisionSelection {
  basis_sha256: Identity; edition_id?: Identity; mappings?: CommissioningMappings;
  selected_fields?: Array<{ source_key: string; target_field: string }>;
}
export interface CorrectionReviewArguments extends RevisionSelection, ReviewerSelection {}
export interface ContinuationArguments { deployment_id: Identity; review_sha256: Identity; retry_rejected?: boolean; }
export interface AcceptanceArguments extends RevisionSelection {
  comparison_sha256: Identity; reviewer: string; note: string; exceptions?: string[];
  commissioning_comparison_sha256: Identity;
  accepted_commissioning_fields: Identity[]; accepted_identity_findings: Identity[];
}
export interface RebindArguments extends RevisionSelection { profile_id: string; reviewer: string; note: string; }
export interface ActionArguments {
  intake: IntakeArguments;
  probe: { profile_id: string };
  adopt_existing: AdoptionArguments;
  prepare_adoption_review: AdoptionProposalArguments;
  review_adoption: AdoptionReviewArguments;
  prepare_observed_correction: CorrectionArguments;
  review: CorrectionReviewArguments;
  continue: ContinuationArguments;
  capture_target: RevisionSelection;
  accept: AcceptanceArguments;
  commissioning_handover: { deployment_id: Identity };
  rebind_imported_target: RebindArguments;
  archive: Record<string, never>;
}
export type CommissioningAction = keyof ActionArguments;
export interface ArtifactDescriptor {
  sha256: Identity; bytes?: number; filename: string; kind?: string; request_id?: Identity;
  [key: string]: unknown;
}
export interface PublicProfile {
  id: string; kind: string; label?: string; api_origin?: string; user_id?: string; source_timezone?: string;
  [key: string]: unknown;
}
export interface Hello {
  schema: "portfolio.operator-hello.v1"; workspace_id: string; profiles: PublicProfile[];
}
export interface Finding {
  id: Identity; code: string; message: string; family?: string | null; keys?: string[];
  fields?: string[]; severity?: string; evidence?: JsonValue; [key: string]: unknown;
}
export interface NativeInventoryRow {
  native_guid: NativeGuid; entity: string; native_key: string; native_sha256: Identity;
  native: JsonObject; membership: JsonValue; reader_candidates: JsonValue[];
  [key: string]: unknown;
}
export interface NativeInventory {
  schema: "portfolio.imported-plan-inventory.v1";
  families: { [F in MappedFamily]: NativeInventoryRow[] };
  bucket_observations: JsonValue[]; project: JsonObject; project_receipt: JsonValue;
  team_capture_sha256: Identity; [key: string]: unknown;
}
export interface ComparedField {
  id: Identity; family: string; key: string; source_field: string; source_value: JsonValue;
  target_field: string; target_value: JsonValue; conversion: JsonValue; native_guid?: NativeGuid | null;
  status: ComparisonStatus; observed_present: boolean; observed_value?: JsonValue;
  observed_native_sha256?: Identity | null; [key: string]: unknown;
}
export interface IntendedObserved {
  schema: "portfolio.intended-observed-comparison.v1";
  fields: ComparedField[]; counts: { [S in ComparisonStatus]: number }; [key: string]: unknown;
}
export interface SourceRow { key: string; uid?: JsonValue; guid?: JsonValue; fields: { [name: string]: JsonValue }; [key: string]: unknown; }
export interface EditionRecord {
  id: Identity; schema: "project-portfolio-edition.v1"; kind: string; sha256: Identity;
  source_ids: Identity[]; label: string; created_at: string; model_bytes: number;
  sources: JsonValue[]; counts: { [family: string]: number }; [key: string]: unknown;
}
/** The edition GET returns project metadata and counts; obtain original rows through the family pages. */
export interface SourceEdition extends EditionRecord {
  model: { schema: "project-portfolio-model.v1"; project: JsonObject; counts: { [F in SourceFamily]: number } };
}
export interface IntakeResult extends EditionRecord {
  model: { schema: "project-portfolio-model.v1"; project: JsonObject } & { [F in SourceFamily]: SourceRow[] } & { [key: string]: unknown };
}
export interface Page<T> { items: T[]; next_cursor: string | null; [key: string]: unknown; }
export interface SourceRows {
  edition_id: Identity; family: SourceFamily; offset: number;
  items: SourceRow[]; total: number; next_offset: number | null; [key: string]: unknown;
}
export interface DeploymentRecord {
  id: Identity; revision: number; state: string; source_edition_id: Identity; profile_id: string;
  project_id?: NativeGuid; project_name?: string;
  plan_sha256: Identity; review_sha256?: Identity; capture_edition_id?: Identity;
  comparison_sha256?: Identity; acceptance_sha256?: Identity;
  commissioning_origin?: "external_import"; commissioning_root_id?: Identity;
  import_intake_sha256?: Identity; commissioning_inventory_sha256?: Identity;
  commissioning_comparison_sha256?: Identity; adoption_review_sha256?: Identity;
  commissioning_identity_findings?: Finding[]; rebind_sha256?: Identity;
  parent_deployment_id?: Identity; parent_snapshot_sha256?: Identity;
  review?: JsonObject | null; acceptance?: JsonObject | null; calls?: JsonObject;
  [key: string]: unknown;
}
/** Expanded immutable objects supplied by GET /api/deployments/:id. */
export interface Deployment extends DeploymentRecord { plan: JsonObject; review: JsonObject | null; acceptance: JsonObject | null; }
export interface DeploymentSummary {
  id: Identity; revision: number; state: string; profile_id: string; source_edition_id: Identity;
  project_id: NativeGuid | null; project_name: string | null; plan_sha256: Identity | null;
  review_sha256: Identity | null; capture_edition_id: Identity | null; acceptance_sha256: Identity | null;
  commissioning_origin: "external_import" | null; commissioning_root_id: Identity | null;
  adoption_review_sha256: Identity | null; commissioning_inventory_sha256: Identity | null;
  commissioning_comparison_sha256: Identity | null; created_at: string | null; updated_at: string | null;
  error: JsonValue; [key: string]: unknown;
}
export interface AdoptionProposal {
  proposal_sha256: Identity; deployment_revision: number; required_finding_ids: Identity[];
  plan: JsonObject; intended_observed: IntendedObserved; import_exception_review: JsonValue;
  [key: string]: unknown;
}
export interface Handover {
  commissioning_json: ArtifactDescriptor; commissioning_html: ArtifactDescriptor;
  lineage_deployment_ids: Identity[]; [key: string]: unknown;
}
export interface WorkspaceArchive {
  schema: "portfolio.operator-archive.v1"; filename: string;
  archive: { sha256: Identity; bytes: number; kind: "workspace_archive"; request_id: Identity; path: string };
  native_result: JsonValue;
}
export interface ActionResults {
  intake: IntakeResult; probe: JsonObject; adopt_existing: DeploymentRecord;
  prepare_adoption_review: AdoptionProposal; review_adoption: DeploymentRecord;
  prepare_observed_correction: DeploymentRecord; review: DeploymentRecord; continue: DeploymentRecord;
  capture_target: DeploymentRecord; accept: DeploymentRecord; commissioning_handover: Handover;
  rebind_imported_target: DeploymentRecord; archive: WorkspaceArchive;
}
export interface PreparedRequest<K extends CommissioningAction = CommissioningAction> {
  readonly schema: "portfolio.commissioning-client-request.v1";
  readonly workspace_id: string; readonly request_id: Identity; readonly kind: K;
  readonly arguments: ReadonlyDeep<ActionArguments[K]>;
}
export interface RequestRecord<K extends CommissioningAction = CommissioningAction> {
  id: Identity; kind: K; arguments: ActionArguments[K]; state: string; revision: number;
  result_sha256?: Identity; result?: ActionResults[K] | null;
  error?: { code: string; message: string; dispatched?: boolean; details?: unknown };
  [key: string]: unknown;
}
export interface WorkspaceState {
  schema: "portfolio.target-workspace.v1"; profiles: PublicProfile[];
  deployments: Page<DeploymentSummary>; requests: Page<RequestRecord>; editions: Page<EditionRecord>;
  [key: string]: unknown;
}
export interface Inspection {
  schema: "portfolio.commissioning-inspection.v1"; workspace_id: string;
  deployment: Deployment; source: SourceEdition;
  objects: {
    import_intake_sha256?: JsonObject;
    commissioning_inventory_sha256?: NativeInventory;
    commissioning_comparison_sha256?: IntendedObserved;
    comparison_sha256?: JsonObject; adoption_review_sha256?: JsonObject; rebind_sha256?: JsonObject;
  };
}
export interface ReadOptions { signal?: AbortSignal; }
export interface PrepareOptions { requestId?: Identity; }
export interface WaitOptions<K extends CommissioningAction = CommissioningAction> extends ReadOptions {
  pollIntervalMs?: number; timeoutMs?: number; onProgress?: (request: RequestRecord<K>) => void | Promise<void>;
}
export interface ClientOptions {
  baseUrl: string; token: string; workspaceId?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}
export class PortfolioClientError extends Error {
  readonly name: "PortfolioClientError"; code: string; status?: number; requestId?: Identity;
  outcome?: "unknown" | "read_interrupted"; saved?: RequestRecord; cause?: unknown;
  source?: { filename: string; bytes: number; sha256: Identity };
  constructor(code: string, message: string, details?: Record<string, unknown>);
}
export const COMMISSIONING_ACTIONS: readonly CommissioningAction[];
export function createRequestId(): Identity;
export function restorePreparedRequest<K extends CommissioningAction = CommissioningAction>(value: unknown): PreparedRequest<K>;
export class PortfolioCommissioningClient {
  constructor(options: ClientOptions);
  readonly baseUrl: string;
  readonly workspaceId: string | undefined;
  connect(options?: ReadOptions & { workspaceId?: string }): Promise<Hello>;
  prepare<K extends CommissioningAction>(kind: K, args: ActionArguments[K], options?: PrepareOptions): PreparedRequest<K>;
  prepareIntake(args: IntakeArguments, options?: PrepareOptions): PreparedRequest<"intake">;
  prepareAdoption(args: AdoptionArguments, options?: PrepareOptions): PreparedRequest<"adopt_existing">;
  prepareAdoptionProposal(args: AdoptionProposalArguments, options?: PrepareOptions): PreparedRequest<"prepare_adoption_review">;
  prepareAdoptionReview(args: AdoptionReviewArguments, options?: PrepareOptions): PreparedRequest<"review_adoption">;
  prepareCorrection(args: CorrectionArguments, options?: PrepareOptions): PreparedRequest<"prepare_observed_correction">;
  prepareCorrectionReview(args: CorrectionReviewArguments, options?: PrepareOptions): PreparedRequest<"review">;
  prepareContinuation(args: ContinuationArguments, options?: PrepareOptions): PreparedRequest<"continue">;
  prepareCapture(args: RevisionSelection, options?: PrepareOptions): PreparedRequest<"capture_target">;
  prepareAcceptance(args: AcceptanceArguments, options?: PrepareOptions): PreparedRequest<"accept">;
  prepareHandover(args: { deployment_id: Identity }, options?: PrepareOptions): PreparedRequest<"commissioning_handover">;
  prepareRebind(args: RebindArguments, options?: PrepareOptions): PreparedRequest<"rebind_imported_target">;
  prepareArchive(options?: PrepareOptions): PreparedRequest<"archive">;
  submit<K extends CommissioningAction>(request: PreparedRequest<K>, options?: ReadOptions): Promise<RequestRecord<K>>;
  status<K extends CommissioningAction>(request: PreparedRequest<K>, options?: ReadOptions): Promise<RequestRecord<K>>;
  resume<K extends CommissioningAction>(request: PreparedRequest<K>, options?: ReadOptions & { retryFailed?: boolean }): Promise<RequestRecord<K>>;
  wait<K extends CommissioningAction>(request: PreparedRequest<K>, options?: WaitOptions<K>): Promise<RequestRecord<K>>;
  getRequest<K extends CommissioningAction = CommissioningAction>(requestId: Identity, options?: ReadOptions): Promise<RequestRecord<K>>;
  getDeployment(deploymentId: Identity, options?: ReadOptions): Promise<Deployment>;
  getObject<T = JsonValue>(sha256: Identity, options?: ReadOptions): Promise<T>;
  getState(options?: ReadOptions & { cursor?: string; limit?: number }): Promise<WorkspaceState>;
  getEditions(options?: ReadOptions & { cursor?: string; limit?: number }): Promise<Page<EditionRecord>>;
  getRequests(options?: ReadOptions & { cursor?: string; limit?: number }): Promise<Page<RequestRecord>>;
  iterateSourceRows(editionId: Identity, options: ReadOptions & { family: SourceFamily; limit?: number }): AsyncGenerator<SourceRow, void, unknown>;
  getEdition(editionId: Identity, options?: ReadOptions): Promise<SourceEdition>;
  getEdition(editionId: Identity, options: ReadOptions & { family: SourceFamily; offset?: number; limit?: number }): Promise<SourceRows>;
  inspect(deploymentId: Identity, options?: ReadOptions): Promise<Inspection>;
  upload(bytes: Uint8Array | ArrayBuffer | Blob, options: ReadOptions & { filename: string }): Promise<UploadDescriptor>;
  uploadEvidence(bytes: Uint8Array | ArrayBuffer | Blob,
    options: ReadOptions & { filename: string; class: EvidenceClass; title?: string; format?: string }): Promise<EvidenceSelection>;
  downloadResponse(artifact: ArtifactDescriptor, options?: ReadOptions): Promise<Response>;
  downloadBytes(artifact: ArtifactDescriptor, options?: ReadOptions): Promise<Uint8Array>;
}
