/** Complete native Grant Operations case and Applications setup handoff. */
export const GRANT_HANDOFF_SCHEMA: 'stellar-forge.grant-application-handoff.v1';
export const GRANT_NATIVE_HANDOFF_SCHEMA: 'stellar-forge.native-grant-application-handoff.v1';
export const GRANT_HANDOFF_OPERATION_SCHEMA: 'stellar-forge.grant-application-handoff-operation.v1';
export const GRANT_HANDOFF_MAX_BYTES: number;
export interface GrantHostSettings {
  workspaceDirectory: string;
  pythonExecutable?: string;
  scenarioFile?: string;
  port?: number;
  [field: string]: unknown;
}
export interface GrantHandoffBindings {
  runtimeId: string;
  label: string;
  settings: GrantHostSettings;
  caseName: string;
  actor: string;
  allowStart: boolean;
}
export interface GrantCaseIdentity {
  id: string;
  version: number;
  mode: 'OPERATIONS' | 'WALKTHROUGH';
  planId: string;
  planRevision: number;
}
export interface GrantRuntimeIdentity {
  directory: string;
  installationId: string;
  profileId: string;
  sourceCommit: string;
  sourceManifestSha256: string;
  profileSha256: string;
  lockSha256: string;
}
export interface GrantHandoffSource {
  workspaceId: string;
  applicationId: string;
  applicationRevision: string;
  runtimeId: string;
  runtime: GrantRuntimeIdentity;
  nativeSelectionSha256: string;
  nativeSource: Record<string, unknown>;
  case: GrantCaseIdentity;
}
export interface GrantHandoffFile {
  filename: string;
  mediaType: 'application/zip' | 'application/json';
  bytes: number;
  sha256: string;
  contentBase64: string;
}
export interface GrantPairedHandoffDocument {
  schema: typeof GRANT_HANDOFF_SCHEMA;
  id: string;
  createdAt: string;
  name: string;
  source: GrantHandoffSource;
  files: { case: GrantHandoffFile; setup: GrantHandoffFile };
}
/** Native receiving creates a new destination setup; it has no producing-host Application. */
export interface GrantNativeHandoffDocument extends Omit<GrantPairedHandoffDocument, 'schema' | 'source'> {
  schema: typeof GRANT_NATIVE_HANDOFF_SCHEMA;
  source: { kind: 'native-archive' };
}
export type GrantHandoffDocument = GrantPairedHandoffDocument | GrantNativeHandoffDocument;
export interface GrantHandoffInspection {
  schema: typeof GRANT_HANDOFF_SCHEMA | typeof GRANT_NATIVE_HANDOFF_SCHEMA;
  id: string;
  name: string;
  createdAt: string;
  bytes: number;
  sha256: string;
  source: GrantHandoffSource | { kind: 'native-archive' };
  files: { case: Omit<GrantHandoffFile, 'contentBase64'>; setup: Omit<GrantHandoffFile, 'contentBase64'> };
  setup: Record<string, unknown>;
}
export interface GrantRuntimeWorkspace {
  directory: string;
  state(): Promise<{ workspaceId: string; runtimes: Array<{ id: string; phase: string; directory: string }>; [key: string]: unknown }>;
  applicationsState(options?: { historyLimit?: number }): Promise<{
    applications: Array<{ id: string; revision: string; runtimeId: string; kind: string; label: string;
      settings: Record<string, unknown>; error?: unknown }>;
    catalog: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }>;
  applicationsReview(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  applicationsSave(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}
export interface GrantHandoffReport {
  schema: typeof GRANT_HANDOFF_OPERATION_SCHEMA;
  operationId: string;
  operationDirectory: string;
  direction: 'EXPORT' | 'RECEIVE';
  phase: 'PREPARED' | 'EXPORTED' | 'CASE_RECEIVED' | 'APPLICATION_REVIEWED' | 'APPLICATION_SAVED';
  workspaceId: string;
  package: { file: string; bytes: number; sha256: string; name: string; filename?: string } | null;
  selection: Record<string, unknown>;
  originalCase: GrantCaseIdentity | Omit<GrantCaseIdentity, 'planRevision'> | Pick<GrantCaseIdentity, 'id' | 'version'> | null;
  importRequest: { requestId: string; name: string; actor: string } | null;
  imported: { result: { id: string; version: number; action: 'import'; planId: string; mode: string };
    file: string; bytes: number; sha256: string; source: Record<string, unknown> } | null;
  preflight: Record<string, unknown> | null;
  application: Record<string, unknown> | null;
  lastError: { at: string; code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}
export function inspectGrantHandoff(options: { package?: string | null; packageText?: string | null }): Promise<GrantHandoffInspection>;
/** New exports require applicationId, caseId and the selected expectedVersion. Resume uses the original operation. */
export function exportGrantHandoff(model: GrantRuntimeWorkspace, options: {
  operation: string; applicationId?: string; caseId?: string; expectedVersion?: number;
  name?: string; allowStart?: boolean; requestId?: string;
}): Promise<GrantHandoffReport>;
/** Select one complete paired package or native case ZIP and explicit destination bindings. Native source is read by the original importer. */
export function prepareGrantHandoff(model: GrantRuntimeWorkspace, options: {
  operation: string; package?: string | null; bindings?: string | null; requestId?: string | null;
  packageText?: string | null; bindingsValue?: GrantHandoffBindings | null;
  caseArchive?: string | null; caseBase64?: string | null; caseFilename?: string | null; name?: string | null;
}): Promise<GrantHandoffReport>;
export function receiveGrantHandoff(model: GrantRuntimeWorkspace, options: { operation: string }): Promise<GrantHandoffReport>;
export function saveGrantHandoffApplication(model: GrantRuntimeWorkspace, options: { operation: string }): Promise<GrantHandoffReport>;
export function grantHandoffStatus(options: { operation: string }): Promise<GrantHandoffReport>;

export function grantHandoffCases(model: GrantRuntimeWorkspace, options: { applicationId: string; allowStart?: boolean }): Promise<{
  application: Record<string, unknown>; selection: Record<string, unknown>;
  cases: Array<GrantCaseIdentity & { name: string; state: string; updatedAt: string }>;
  source: Record<string, unknown>;
}>;
export function grantHandoffDownload(options: { operation: string }): Promise<{ filename: string; bytes: number; sha256: string; text: string }>;
