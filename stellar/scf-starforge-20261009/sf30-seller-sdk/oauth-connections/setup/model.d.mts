// MIT. Source and registration types for the maintained setup model.
import type { OAuthProfile, OAuthClientAuthenticationInput } from '../profile.mjs';

export type SetupProvider = 'quickbooks' | 'xero';
export interface SetupContext {
  environmentFile: string | null;
  connectionsFile: string | null;
  port: number;
  allowLoopbackOAuth: boolean;
}
export type SetupContextInput = Partial<SetupContext>;
export interface SetupSelection {
  method: string; path: string; serverIndex: number; securityAlternative: number;
}
export interface GenericDefinitionFields {
  alias: string; directoryEnv: string; sourceId: string;
  selections: SetupSelection[];
  label: string; clientId: string; scopes: string[];
  revocationEndpoint?: string; issuer?: string;
  authorizationParameters?: Record<string, string>;
  resourceParameters?: string[];
  replacesProfileSha256?: string;
}
export type GenericSetupDefinition = GenericDefinitionFields & OAuthClientAuthenticationInput;
export interface ProviderRegistrationFields {
  alias: string; directoryEnv: string; sourceId: string;
  label?: string; clientId: string; clientSecretEnv: string; callbackOrigin: string;
  /** Optional input pin; normalized retained definitions always include it. */
  factorySha256?: string;
  replacesProfileSha256?: string;
}
export type ProviderSetupDefinition =
  | (ProviderRegistrationFields & {provider: 'quickbooks'; environment: 'sandbox' | 'production'})
  | (ProviderRegistrationFields & {provider: 'xero'; environment?: never});
export interface RetainedSetupAlias {retainAlias: string; expectedProfileSha256: string}
export type SetupDefinition = GenericSetupDefinition | ProviderSetupDefinition;
export type DesiredSetupEntry = SetupDefinition | RetainedSetupAlias;
export interface NormalizedSetupDefinition {
  definition: SetupDefinition; profile: OAuthProfile; profileSha256: string; sourceId: string;
}
export interface SetupSourceChoice {
  id: string; label: string; selection: SetupSelection; scheme: string;
  authorizationEndpoint: string; tokenEndpoint: string; resourceOrigin: string;
  requiredScopes: string[]; declaredScopes: string[];
}
export interface SetupSourceInspection {
  inspection: {
    sourceSha256: string; title: string;
    operations: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  choices: SetupSourceChoice[];
}
export interface SetupLimits {
  maxSourceBytes: number; maxEntries: number; maxSelectionsPerEntry: number;
  maxChoices: number; maxReviewBytes: number; maxInspectionBytes: number;
}
export interface SetupFailure extends Error {code: string; status: number}
export declare const SETUP_SCHEMA: 'stellar-forge.oauth-setup-workspace.v1';
export declare const MAX_SOURCE_BYTES: number;
export declare const MAX_ENTRIES: number;
export declare const MAX_SELECTIONS: number;
export declare const MAX_CHOICES: number;
export declare const MAX_REVIEW_BYTES: number;
export declare const MAX_INSPECTION_BYTES: number;
export declare const limits: Readonly<SetupLimits>;
export declare function fail(suffix: string, message: string, status?: number): never;
export declare function need(value: unknown, suffix: string, message: string, status?: number): asserts value;
export declare function fields(value: unknown, keys: readonly string[], label?: string): asserts value is Record<string, unknown>;
export declare function text(value: unknown, label: string, maximum?: number, empty?: boolean): string;
export declare function revision(value: unknown): number;
export declare function requestId(value: unknown): string;
export declare function sourceId(value: unknown): string;
export declare function selection(value: unknown): SetupSelection;
export declare function normalizeContext(raw?: SetupContextInput): SetupContext;
export declare function callbackUri(profile: OAuthProfile, profileSha256: string, port: number): string;
export declare function inspectSetupSource(sourceText: string): SetupSourceInspection;
export declare function normalizeNewDefinition(
  raw: GenericSetupDefinition, sourceText: string, options?: {allowLoopback?: boolean}
): NormalizedSetupDefinition;
export declare function publicEntry(entry: import('./workspace.mjs').PrivateSetupEntry): import('./workspace.mjs').PublicSetupEntry;
export declare function normalizeDesiredEntries(entries: DesiredSetupEntry[]): DesiredSetupEntry[];
export declare function setupError(error: unknown): SetupFailure;
export declare function plain(value: unknown): value is Record<string, unknown>;
export declare function hex(value: unknown): value is string;
export declare function envName(value: unknown): value is string;
export declare function identifier(value: unknown): value is string;
export declare function identity(value: unknown): string;
export declare function digest(value: string | Uint8Array): string;
