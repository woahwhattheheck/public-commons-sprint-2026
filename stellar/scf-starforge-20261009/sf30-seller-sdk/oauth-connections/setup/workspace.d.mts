// MIT. Retained setup operations and the explicitly private native host binding.
import type {OAuthProfile} from '../profile.mjs';
import type {OAuthConnectionStatus, OAuthEnvironment} from '../connection.mjs';
import type {OAuthHostDirectoryIdentity} from '../host.mjs';
import type {SetupContext, SetupContextInput, SetupDefinition, DesiredSetupEntry,
  SetupProvider, SetupLimits, SetupSourceInspection} from './model.mjs';
import type {OAuthSetupProviderAdapter, SetupProviderCatalogEntry} from './providers.mjs';
export type {SetupContext, SetupContextInput, SetupDefinition, DesiredSetupEntry,
  SetupProvider, ProviderSetupDefinition, GenericSetupDefinition} from './model.mjs';
export interface SetupRuntimeBinding {
  runtimeId: string; directory: string; installationId: string;
  profileId: string; profileSha256: string; lockSha256: string;
  sourceCommit: string; sourceManifestSha256: string; sourceRoot: string;
}
export interface SetupDirectoryIdentity {path: string; device: string; inode: string; uid: number}
export interface SetupSourceRecord {
  id: string; sha256: string; bytes: number; label: string; title: string; importedAt: string;
}
export interface PublicSetupEntry {
  kind: 'retained' | 'initialize'; alias: string; directoryEnv: string;
  sourceId: string; profileSha256: string; profile: OAuthProfile; callbackUri: string;
  definition?: SetupDefinition;
  existingGrant?: {id: string | null; state: string};
}
export interface PrivateSetupEntry extends PublicSetupEntry {
  directory: string; directoryIdentity: OAuthHostDirectoryIdentity | null;
}
export interface SetupChange {
  alias: string; kind: 'added' | 'retained' | 'replaced' | 'removed';
  beforeProfileSha256?: string; afterProfileSha256?: string;
}
export interface SetupEditionSummary {
  id: string; sequence: number; createdAt: string; reviewId: string; requestId: string;
  entryCount: number; registrySha256: string; environmentSha256: string;
}
export interface SetupPrepared {
  editionId: string; registrySha256: string; environmentSha256: string;
  settings: {oauthConnectionsFile: string; environmentFile: string; port: number; allowLoopbackOAuth: boolean};
}
export interface SetupEdition extends SetupEditionSummary {
  schema: 'stellar-forge.oauth-setup-edition.v1'; runtimeBinding: SetupRuntimeBinding | null;
  entries: PublicSetupEntry[]; sources: SetupSourceRecord[];
  review: {actor: string; reference: string; callbacksRegistered: true; at: string};
  changes: SetupChange[];
  files: Array<{path: string; bytes: number; sha256: string; private: boolean}>;
  context: SetupContext;
}
export interface SetupReview {
  schema: 'stellar-forge.oauth-setup-review.v1';
  reviewId: string; revision: number; baseEditionId: string | null; contextBinding: string;
  entries: PublicSetupEntry[]; changes: SetupChange[];
  environmentNames: string[]; callbackUris: string[]; files: Array<{path: string; role: string}>;
}
export interface SetupSourceResult extends SetupSourceInspection {revision: number; source: SetupSourceRecord}
export interface SetupProviderSourceResult extends SetupSourceResult {provider: SetupProvider; factorySha256: string}
export interface SetupCommitResult {
  schema: 'stellar-forge.oauth-setup-commit.v1'; revision: number; edition: SetupEdition; prepared: SetupPrepared;
  operation: {requestId: string; action: 'commit'; state: 'completed'};
}
export interface SetupActivationResult {
  schema: 'stellar-forge.oauth-setup-activation.v1'; revision: number; edition: SetupEdition; prepared: SetupPrepared;
  operation: {requestId: string; action: 'activate'; state: 'completed'};
}
export type SetupMutationResult = SetupSourceResult | SetupProviderSourceResult | SetupCommitResult | SetupActivationResult;
export type SetupMutationAction = 'source.import' | 'source.provider' | 'commit' | 'activate';
export interface SetupPending {action: SetupMutationAction; requestId: string; inputHash: string; phase: string}
export type SetupOperation =
  | {requestId: string; action: SetupMutationAction; inputHash: string; state: 'pending'; phase: string}
  | {requestId: string; action: SetupMutationAction; inputHash: string; state: 'completed'; result: SetupMutationResult};
export interface SetupCatalog {
  schema: 'stellar-forge.oauth-setup-catalog.v1'; enabled: true; workspaceId: string;
  revision: number; currentEditionId: string | null; sources: SetupSourceRecord[];
  editions: SetupEditionSummary[];
  baseEntries: Array<{alias: string; directoryEnv: string; profileSha256: string; profile: OAuthProfile;
    callbackUri: string | null; grant: {id: string | null; state: string};
    entry: {retainAlias: string; expectedProfileSha256: string}; definition?: SetupDefinition}>;
  clientSecretEnvs: string[]; limits: SetupLimits; providers: SetupProviderCatalogEntry[];
  policy: {allowLoopbackOAuth: boolean}; contextError: {code: string; message: string} | null;
  runtimeBinding: SetupRuntimeBinding | null; pending: SetupPending | null;
}
export interface SetupStatus {
  revision: number; currentEditionId: string | null; edition: SetupEdition | null;
  prepared: SetupPrepared | null;
  connections: Array<OAuthConnectionStatus & {alias: string; directoryEnv: string}>;
  pending: SetupPending | null; operation: SetupOperation | null;
}
export type SetupDownloadKind = 'profile-review' | 'registry' | 'source-manifest' | 'operator-plan';
export interface SetupDownload {filename: string; mime: string; content: string}
export interface SetupActionInputs {
  catalog: Record<string, never>;
  'source.import': {requestId: string; expectedRevision: number; label: string; sourceText: string};
  'source.provider': {requestId: string; expectedRevision: number; provider: SetupProvider; sourceSha256: string};
  'source.inspect': {sourceId: string};
  review: {expectedRevision: number; baseEditionId: string | null; entries: DesiredSetupEntry[]};
  commit: {requestId: string; expectedRevision: number; reviewId: string; actor: string;
    reference?: string; callbacksRegistered: true};
  status: {editionId?: string; requestId?: string};
  recover: {requestId: string};
  activate: {requestId: string; expectedRevision: number; editionId: string};
  download: {editionId: string; kind: SetupDownloadKind};
}
export interface SetupActionResults {
  catalog: SetupCatalog;
  'source.import': SetupSourceResult;
  'source.provider': SetupProviderSourceResult;
  'source.inspect': SetupSourceInspection & {source: SetupSourceRecord};
  review: SetupReview; commit: SetupCommitResult; status: SetupStatus;
  recover: SetupMutationResult; activate: SetupActivationResult; download: SetupDownload;
}
export interface SetupOptions {
  directory: string; grantRoot: string; ownerDirectory: string; ownerWorkspaceId: string;
  runtimeBinding?: SetupRuntimeBinding | null; policy?: {allowLoopbackOAuth?: boolean};
  providers?: OAuthSetupProviderAdapter;
  selectionRoot?: string;
  validateReview?: (value: {entries: PrivateSetupEntry[]; context: SetupContext;
    runtimeBinding: SetupRuntimeBinding | null}) => void | Promise<void>;
  validatePrepared?: (value: {prepared: SetupPrepared; entries: PrivateSetupEntry[];
    context: SetupContext; runtimeBinding: SetupRuntimeBinding | null}) => void | Promise<void>;
}
export declare function oauthSetupAction<A extends keyof SetupActionInputs>(
  options: SetupOptions,
  request: {action: A; context?: SetupContextInput; input: SetupActionInputs[A]}
): Promise<SetupActionResults[A]>;
export interface SetupEditionSelection {
  editionId: string; alias: string; expectedProfileSha256: string;
}
export interface AccountingSelectionOwner {
  schema: 'stellar-forge.oauth-setup-accounting-selection-owner.v1';
  ownerWorkspaceId: string; workspaceId: string; provider: SetupProvider;
  alias: string; profileSha256: string; selectionKey: string;
}
export interface PrivateSetupHostEdition {
  schema: 'stellar-forge.oauth-setup-host-edition.v1';
  ownerWorkspaceId: string; workspaceId: string; revision: number; currentEditionId: string | null;
  edition: SetupEditionSummary; runtimeBinding: SetupRuntimeBinding | null; provider: SetupProvider;
  prepared: SetupPrepared;
  registry: {path: string; sha256: string; connections: Array<{alias: string; directoryEnv: string}>};
  environmentFile: {path: string; sha256: string};
  /** PRIVATE effective environment, including existing client-secret values. Never serialize. */
  environment: OAuthEnvironment;
  entry: PrivateSetupEntry; status: OAuthConnectionStatus;
  selection: {directory: string; key: string; owner: AccountingSelectionOwner;
    rootIdentity: SetupDirectoryIdentity; directoryIdentity: SetupDirectoryIdentity};
}
/** Prepares only owned selection storage. Does not authorize or acquire native account data. */
export declare function resolveOAuthSetupEdition(
  options: SetupOptions, selection: SetupEditionSelection
): Promise<PrivateSetupHostEdition>;
