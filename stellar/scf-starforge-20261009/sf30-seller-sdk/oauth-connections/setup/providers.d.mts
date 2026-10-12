// MIT. Trusted selected-runtime adapter; no grant or provider network operations.
import type { OAuthProfile } from '../profile.mjs';
import type { SetupProvider, SetupContext, ProviderSetupDefinition, NormalizedSetupDefinition } from './model.mjs';
export type {SetupProvider, ProviderSetupDefinition} from './model.mjs';
export declare const OAUTH_SETUP_PROVIDERS: readonly SetupProvider[];
export declare function oauthSetupProviderId(value: unknown): SetupProvider;
export interface ProviderSourceIdentity {
  sha256: string; bytes: number; scheme: string; file: string;
}
export type SetupProviderCatalogEntry =
  | {provider: SetupProvider; label: string; enabled: false; reason: string}
  | {provider: SetupProvider; label: string; enabled: true;
      kind: 'intuit-quickbooks' | 'xero-accounting';
      source: ProviderSourceIdentity; factorySha256: string;
      registrationFields: string[]; environments: Array<'sandbox' | 'production'>};
export interface OriginalSetupProviderSource {
  provider: SetupProvider; label: string; source: ProviderSourceIdentity;
  factorySha256: string; sourceText: string;
}
export interface OAuthSetupProviderAdapter {
  catalog(): SetupProviderCatalogEntry[];
  source(provider: SetupProvider, expectedSourceSha256: string): Promise<OriginalSetupProviderSource>;
  normalizeDefinition(
    definition: ProviderSetupDefinition, sourceText: string, options: {context: SetupContext}
  ): Promise<NormalizedSetupDefinition>;
}
export interface SetupProfileAuthority {
  normalizeOAuthProfile(value: unknown, options?: {allowLoopback?: boolean}): OAuthProfile;
  oauthProfileIdentity(profile: OAuthProfile): string;
}
export declare function loadOAuthSetupProviders(options: {
  /** Canonical source root from the original inspectMerchantRuntime result. */
  sourceRoot: string;
  profileAuthority?: SetupProfileAuthority;
}): Promise<OAuthSetupProviderAdapter>;
