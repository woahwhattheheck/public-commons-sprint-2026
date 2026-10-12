// MIT. Declarations for the original public profile and compiler implementation.
export declare const PROFILE_SCHEMA: 'stellar-forge.oauth-authorization-profile.v1';
export declare const INTUIT_QBO_PROVIDER: 'intuit-quickbooks';
export declare const INTUIT_QBO_SCOPE: 'com.intuit.quickbooks.accounting';
export declare const INTUIT_QBO_ENDPOINTS: Readonly<{authorization: string; token: string; revoke: string; sandbox: string; production: string}>;
export interface IntuitQuickBooksProvider { kind: typeof INTUIT_QBO_PROVIDER; environment: 'sandbox' | 'production' }
export declare function intuitQboProfile(profile: unknown): boolean;
export declare function qboRealm(value: unknown): value is string;

export interface OAuthSourceIdentity {
  /** SHA-256 of the exact original OpenAPI bytes. */
  sha256: string;
  /** The original OpenAPI security-scheme name. */
  scheme: string;
}

export type OAuthClientAuthentication =
  | { authMethod: 'none'; clientSecretEnv?: never }
  | { authMethod: 'client_secret_basic' | 'client_secret_post'; clientSecretEnv: string };

export type OAuthClientAuthenticationInput =
  | { authMethod?: 'none'; clientSecretEnv?: never }
  | { authMethod: 'client_secret_basic' | 'client_secret_post'; clientSecretEnv: string };

export interface OAuthProfileFields {
  schema: typeof PROFILE_SCHEMA;
  label: string;
  source: OAuthSourceIdentity;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  issuer?: string;
  /** Public registered client identifier, never a client-secret value. */
  clientId: string;
  scopes: string[];
  resourceOrigins: string[];
  authorizationParameters: Record<string, string>;
  resourceParameters: string[];
  /** Generic profiles use S256. The explicit Intuit confidential client dialect uses none. */
  pkceMethod: 'S256' | 'none';
  provider?: IntuitQuickBooksProvider;
  /** Intuit only: exact registered localhost sandbox or public HTTPS callback origin. */
  callbackOrigin?: string;
}

/** Canonical normalized, public-only profile. This value is not a private grant. */
export type OAuthProfile = OAuthProfileFields & OAuthClientAuthentication;

export type OAuthProfileInput =
  Omit<OAuthProfileFields, 'scopes' | 'resourceOrigins' | 'authorizationParameters' | 'resourceParameters' | 'pkceMethod'> &
  {
    scopes: readonly string[];
    resourceOrigins: readonly string[];
    authorizationParameters?: Readonly<Record<string, string>>;
    resourceParameters?: readonly string[];
    pkceMethod?: 'S256' | 'none';
  } & OAuthClientAuthenticationInput;

export interface OAuthProfileOptions {
  /** Explicit development support for literal http://127.0.0.1:PORT only. */
  allowLoopback?: boolean;
}

export interface OAuthEndpointOptions extends OAuthProfileOptions {
  origin?: boolean;
  query?: boolean;
}

/** Serializable public references; no directory path or credential value. */
export interface OAuthConnectionBinding {
  directoryEnv: string;
  profileSha256: string;
  grantId: string;
  requiredScopes: string[];
  clientSecretEnv?: string;
}

export type OAuthConnectionBindingInput =
  Omit<OAuthConnectionBinding, 'requiredScopes'> & { requiredScopes: readonly string[] };

/** The original compiler freezes the binding and its scope array. */
export type CompiledOAuthConnection =
  Readonly<Omit<OAuthConnectionBinding, 'requiredScopes'>> & {
    readonly requiredScopes: readonly string[];
  };

export interface OAuthCompileOptions extends OAuthProfileOptions {
  resourceOrigin?: string;
}

export declare function plain(value: unknown): value is Record<string, unknown>;
export declare function hex(value: unknown): value is string;
export declare function envName(value: unknown): value is string;
export declare function opaque(value: unknown): value is string;
export declare function bearer(value: unknown): value is string;
export declare function identifier(value: unknown): value is string;
export declare function exact(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown>;
export declare function text(value: unknown, label: string, maximum?: number, empty?: boolean): string;
export declare function scopes(value: unknown, label?: string): string[];
export declare function endpoint(value: unknown, options?: OAuthEndpointOptions): string;

/** Validate unknown input, normalize defaults and retain only the supported public profile fields. */
export declare function normalizeOAuthProfile(raw: unknown, options?: OAuthProfileOptions): OAuthProfile;
/** Hash the normalized profile; normalization is the caller's explicit preceding step. */
export declare function oauthProfileIdentity(profile: OAuthProfile): string;
export declare function oauthCallbackPath(profileSha256: string): string;
export declare function oauthRedirectOrigin(profile: OAuthProfile, localOrigin: string): string;
/** Pure compilation: this reads no environment, directory, grant or credential. */
export declare function compileOAuthConnection(raw: unknown, options?: OAuthCompileOptions): CompiledOAuthConnection;

