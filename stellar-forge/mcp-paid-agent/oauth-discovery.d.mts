import type { OAuthResourceConfig, NormalizedOAuthResourceConfig } from './oauth-resource.mjs';

/** Trusted selected transport. Honor signal through complete response consumption. */
export type OAuthOperatorFetch = (url: string, options: {
  method: string;
  headers: Record<string, string>;
  body?: string;
  redirect: 'manual';
  signal: AbortSignal;
}) => Promise<Response>;

export interface OAuthOperatorTransportOptions {
  /** Only these exact HTTPS origins bypass the default public DNS-pinned metadata transport. */
  trustedOrigins?: string[];
  fetchImpl?: OAuthOperatorFetch;
  /** Complete-response deadline, 100–120000 milliseconds; default 10000. */
  timeoutMs?: number;
  /** Complete-response byte limit, 1024–8388608; default 1048576. */
  maxBytes?: number;
}

export interface OAuthBearerChallenge {
  resourceMetadata?: string;
  scopes?: string[];
  error?: 'invalid_request' | 'invalid_token' | 'insufficient_scope' | 'access_denied' | 'temporarily_unavailable';
}
export type OAuthRetryAfter = { seconds: number } | { at: string };
export interface OAuthHttpObservation {
  url: string;
  method: string;
  status: number;
  bytes: number;
  sha256: string;
  retryAfter?: OAuthRetryAfter;
}

export interface OAuthDiscoveryReport {
  schema: 'stellar-forge.mcp-oauth-discovery.v1';
  resource: string;
  metadataUrl: string;
  authorizationServers: string[];
  selectedIssuer: string;
  authorizationMetadataUrl: string;
  endpoints: {
    authorization_endpoint?: string;
    token_endpoint?: string;
    jwks_uri?: string;
    registration_endpoint?: string;
  };
  supportedScopes: string[];
  challenges: OAuthBearerChallenge[];
  pkceS256: boolean;
  registration: {
    clientIdMetadataDocuments: boolean;
    dynamicRegistration: boolean;
    preRegistration: true;
  };
  authorizationResponseIssuerParameter: boolean;
  keySet: null | {
    url: string;
    bytes: number;
    sha256: string;
    usableKeyCount: number;
    /** Selected public metadata fields as returned by the provider. Token verification is server-side. */
    keys: Array<Partial<Record<'kid' | 'kty' | 'alg' | 'use' | 'key_ops', unknown>>>;
  };
  compatible: boolean;
  compatibilityProblems: string[];
  observations: OAuthHttpObservation[];
}

export interface OAuthDiscoveryOptions extends OAuthOperatorTransportOptions {
  resource: string;
  /** Required when the protected resource advertises multiple issuers. */
  issuer?: string;
  /** Optional pinned, normalized server configuration used to compare issuer/JWKS/algorithms. */
  expectedAuthorizationServer?: NormalizedOAuthResourceConfig['authorizationServers'][number];
}

export type OAuthProbeTermination = { required: false } | {
  required: true;
  state: 'closed' | 'unsupported' | 'failed';
  status?: number;
  code?: string;
};
export interface OAuthProbeReport {
  schema: 'stellar-forge.mcp-oauth-probe.v1';
  resource: string;
  tokenProvided: true;
  initialized: true;
  protocolVersion: '2025-11-25';
  serverInfo: { name: string; version: string };
  tools: Array<{ name: string; inputSchemaSha256: string; outputSchemaSha256?: string }>;
  toolCount: number;
  catalogComplete: true;
  termination: OAuthProbeTermination;
  observations: OAuthHttpObservation[];
}

export interface OAuthProbeOptions extends Omit<OAuthOperatorTransportOptions, 'trustedOrigins'> {
  config: OAuthResourceConfig;
  /** Opaque access token, sent only to the exact configured resource and excluded from reports. */
  token: string;
  /** Complete catalog page limit, 1–256; default 64. An unfinished catalog throws. */
  maxPages?: number;
}

export class OAuthOperatorError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}
export function parseBearerChallenges(header?: string | null): Array<Record<string, string>>;
export function authorizationMetadataCandidates(issuer: string): string[];
export function discoverOAuthResource(options: OAuthDiscoveryOptions): Promise<OAuthDiscoveryReport>;
export function probeOAuthResource(options: OAuthProbeOptions): Promise<OAuthProbeReport>;
