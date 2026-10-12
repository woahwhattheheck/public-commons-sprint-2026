// MIT. Private operator source credentials; no token values in configuration exports.
export interface SourceAuthorization { readonly origin: string; readonly scheme: 'Bearer' }
export type SourceBearerBinding = {
  readonly origin: string;
  readonly tokenEnv: string;
  readonly credentialRef?: never;
} | {
  readonly origin: string;
  readonly credentialRef: string;
  readonly tokenEnv?: never;
};
export interface SourceRequest {
  url: string | URL;
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | string;
  signal?: AbortSignal;
}
export interface SourceCredentialRequest {
  readonly url: string;
  readonly origin: string;
  readonly method: string;
  readonly signal: AbortSignal;
}
export interface SourceBearerAuth {
  readonly origins: readonly string[];
  requestHeaders(request: SourceRequest): Promise<Readonly<Record<string, string>>>;
  authorizationForOrigin(origin: string): SourceAuthorization | null;
  /** Stop future resolutions and cancel in-flight resolutions. */
  close(): void;
}
export class SourceAuthenticationError extends Error {
  readonly code: string;
  constructor(code: string);
}
export function createSourceBearerAuth(options: {
  bindings: readonly SourceBearerBinding[];
  resolveCredential?: (reference: string, request: SourceCredentialRequest) => string | Promise<string>;
  environment?: Record<string, string | undefined>;
  timeoutMs?: number;
}): SourceBearerAuth;
