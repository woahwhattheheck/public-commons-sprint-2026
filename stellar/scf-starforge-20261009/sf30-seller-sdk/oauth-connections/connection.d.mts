// MIT. Declarations for the original private grant owner and its public projections.
import type { OAuthProfile, OAuthProfileOptions } from './profile.mjs';

export type OAuthEnvironment = Readonly<Record<string, string | undefined>>;

/** The original transport validates every returned address before using one. */
export interface OAuthLookupAddress { address: string; family: number }
export type OAuthLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => readonly OAuthLookupAddress[] | Promise<readonly OAuthLookupAddress[]>;

export interface OAuthConnectionOptions extends OAuthProfileOptions {
  /** Host-owned values only; never send this object to a browser or saved package. */
  env?: OAuthEnvironment;
  lookup?: OAuthLookup;
}

export type OAuthGrantState = 'disconnected' | 'connected' | 'refreshing' | 'reconnect_required';
export type OAuthRemoteRevocationState = 'not_requested' | 'requested' | 'confirmed' | 'unknown' | 'failed';
export type OAuthRetainedRevocationState = Exclude<OAuthRemoteRevocationState, 'not_requested'>;
export type OAuthFlowPhase =
  | 'awaiting_authorization' | 'exchanging' | 'review_grant' | 'committing'
  | 'connected' | 'declined' | 'failed' | 'discarded' | 'expired';

export interface OAuthGrantReview {
  actor: string;
  reference?: string;
}
export interface OAuthRecordedReview {
  actor: string;
  reference: string;
  at: string;
}
export interface OAuthRecordedError {
  /** A local OAUTH_CONNECTION_* code, never the provider's raw response. */
  code: string;
  at: string;
}
export interface OAuthFlowError {
  code: string;
  message: string;
}

/** Safe metadata only. No access/refresh token, verifier, code or token hash. */
export interface OAuthGrantStatus {
  id: string | null;
  state: OAuthGrantState;
  scopes: string[];
  issuedAt: string | null;
  expiresAt: string | null;
  refreshExpiresAt: string | null;
  hasRefreshToken: boolean;
  generation: number;
  review: OAuthRecordedReview | null;
  lastError: OAuthRecordedError | null;
  retryAfter: string | null;
  remoteRevocation: OAuthRemoteRevocationState;
}

export interface OAuthRevocationStatus {
  grantId: string;
  state: OAuthRetainedRevocationState;
  requestedAt: string;
  lastAttemptAt: string | null;
  lastError: OAuthRecordedError | null;
  /** The original disconnect request that retained this cleanup. */
  requestId: string;
}

export interface OAuthConnectionStatus {
  schema: 'stellar-forge.oauth-connection-status.v1';
  revision: number;
  profileSha256: string;
  profile: OAuthProfile;
  callbackPath: string;
  updatedAt: string;
  grant: OAuthGrantStatus;
  history: Array<{ at: string; operation: string }>;
  revocations: OAuthRevocationStatus[];
}

export interface OAuthFlow {
  flowId: string;
  phase: OAuthFlowPhase;
  requestedScopes: string[];
  expiresAt: string;
  profileSha256: string;
  reviewId?: string;
  scopes?: string[];
  refreshable?: boolean;
  tokenExpiresAt?: string | null;
  lastError?: OAuthFlowError;
}

export interface OAuthConnectionSnapshot extends OAuthConnectionStatus {
  /** Authorization flows belong to this open connection instance, not the durable store. */
  flow: OAuthFlow | null;
}
export interface OAuthStatusRequest { flowId?: string }

export interface OAuthRevisionCommand {
  expectedRevision: number;
  /** Retain this ID and the complete unchanged input before dispatch. */
  requestId: string;
}
export interface OAuthBeginRequest extends OAuthRevisionCommand {
  /** Exact registered http://127.0.0.1:PORT plus this profile's callbackPath. */
  redirectUri: string;
}
export interface OAuthAuthorizationStart {
  flowId: string;
  phase: 'awaiting_authorization';
  requestedScopes: string[];
  expiresAt: string;
  profileSha256: string;
  /** Contains protocol state; deliver to the intended operator, not a shared status log. */
  authorizationUrl: string;
  callbackPath: string;
}
export interface OAuthCompleteRequest {
  flowId: string;
  /** Actual callback query parameters; the core validates state, issuer and duplicates. */
  parameters: URLSearchParams;
}
export interface OAuthApproveRequest extends OAuthRevisionCommand {
  flowId: string;
  reviewId: string;
  review: OAuthGrantReview;
}
export interface OAuthDiscardRequest { flowId: string }
export interface OAuthRefreshRequest extends OAuthRevisionCommand {
  expectedGrantId: string;
}
export interface OAuthDisconnectRequest extends OAuthRevisionCommand {
  expectedGrantId: string | null;
  /** Local disconnect is saved before an explicitly requested remote revocation. */
  revoke: boolean;
}
export interface OAuthRevokeRequest extends OAuthRevisionCommand {
  /** Select an older cleanup explicitly; remote retry requires local disconnection. */
  expectedRevocationGrantId?: string;
}

export type OAuthDurableCommandKind = 'approve' | 'refresh' | 'disconnect' | 'revoke';
export type OAuthCommandState = 'completed' | 'failed' | 'reconnect_required' | 'superseded';
export interface OAuthCommandReceipt extends OAuthConnectionStatus {
  operation: {
    requestId: string;
    kind: OAuthDurableCommandKind;
    /** A fulfilled promise may still record a failed or uncertain provider operation. */
    state: OAuthCommandState;
    code?: string;
  };
}

/**
 * Structural error details, not an exported runtime Error class.
 * Catch unknown: unrelated filesystem/AbortSignal errors need not have these fields.
 * Approval SAVE_UNKNOWN is identified by code even when outcomeUnknown is absent.
 */
export interface OAuthConnectionFailure extends Error {
  code: string;
  status?: number;
  outcome?: 'not_sent' | 'rejected' | 'unknown';
  outcomeUnknown?: boolean;
  retryAfterMs?: number;
  connectionState?: OAuthGrantState;
}

export interface OAuthAccessTokenOptions extends OAuthConnectionOptions {
  signal?: AbortSignal;
  expectedProfileSha256?: string;
  expectedGrantId?: string;
  /** Must equal the profile's reference, including omission for a public client. */
  clientSecretEnv?: string;
  resourceOrigin?: string;
  requiredScopes?: readonly string[];
  force?: boolean;
  /** The exact rejected bearer; server memory only. No backend request is replayed. */
  rejectedAccessToken?: string;
}

/** SERVER-ONLY credential output. This must never be returned by a workspace/status endpoint. */
export interface OAuthPrivateAccessToken {
  token: string;
  generation: number;
  expiresAt: string | null;
  refreshed: boolean;
}

export interface OAuthConnection {
  readonly status: (request?: OAuthStatusRequest) => Promise<OAuthConnectionSnapshot>;
  readonly begin: (request: OAuthBeginRequest) => Promise<OAuthAuthorizationStart>;
  readonly complete: (request: OAuthCompleteRequest) => Promise<OAuthFlow>;
  readonly approve: (request: OAuthApproveRequest) => Promise<OAuthCommandReceipt>;
  /** Synchronous on the core; the host registry adds its own async alias check. */
  readonly discard: (request: OAuthDiscardRequest) => OAuthFlow;
  readonly refresh: (request: OAuthRefreshRequest) => Promise<OAuthCommandReceipt>;
  readonly disconnect: (request: OAuthDisconnectRequest) => Promise<OAuthCommandReceipt>;
  readonly revoke: (request: OAuthRevokeRequest) => Promise<OAuthCommandReceipt>;
  /** Abort flows and drain owned exchanges/saves; this does not disconnect a saved grant. */
  readonly close: () => Promise<void>;
}

export declare function initializeOAuthConnection(
  directory: string,
  options: OAuthProfileOptions & { profile: unknown },
): Promise<OAuthConnectionStatus>;
export declare function oauthConnectionStatus(
  directory: string, options?: OAuthProfileOptions,
): Promise<OAuthConnectionStatus>;
export declare function openOAuthConnection(
  directory: string, options?: OAuthConnectionOptions,
): Promise<OAuthConnection>;
export declare function getOAuthAccessToken(
  directory: string, options?: OAuthAccessTokenOptions,
): Promise<OAuthPrivateAccessToken>;

