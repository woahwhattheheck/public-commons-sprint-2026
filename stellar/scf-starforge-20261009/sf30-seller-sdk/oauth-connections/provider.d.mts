// MIT. Typed access to the original SF30 credential provider.
import type { OAuthConnectionOptions } from './connection.mjs';

export interface OAuthConnectionProviderOptions extends OAuthConnectionOptions {
  /** Exact original resource origin selected by the receiving application. */
  resourceOrigin?: string;
}
export type OAuthProviderState = 'empty' | 'loading' | 'ready' | 'reconnect_required' | 'closed';

/** Safe provider state. Generation belongs to this provider instance. */
export interface OAuthProviderSnapshot {
  readonly state: OAuthProviderState;
  readonly hasToken: boolean;
  readonly expiresInMs: number | null;
  readonly profileSha256: string;
  readonly grantId: string;
  readonly generation: number;
  readonly tokenRequests: number;
  readonly cacheHits: number;
  readonly renewals: number;
  readonly failures: number;
  readonly cancellations: number;
  readonly invalidations: number;
  readonly lastError: string | null;
}
/** Private host credential. Never serialize this result into browser/status output. */
export interface OAuthAuthorizationHeaders { readonly authorization: string }
export interface OAuthConnectionProvider {
  /** Reads the original pinned grant and shares its current bounded renewal. */
  readonly headers: (options?: { signal?: AbortSignal }) => Promise<OAuthAuthorizationHeaders>;
  readonly snapshot: () => OAuthProviderSnapshot;
  readonly generation: () => number;
  /** Invalidate only the exact rejected header; this does not replay any resource request. */
  readonly invalidate: (expectedAuthorization?: string) => OAuthProviderSnapshot;
  /** Abort/drain owned renewal, then clear private bearer state; the Agent remains borrowed. */
  readonly close: () => Promise<OAuthProviderSnapshot>;
}
export declare function createOAuthConnectionProvider(
  binding: unknown,
  options?: OAuthConnectionProviderOptions,
): OAuthConnectionProvider;
