// MIT. Private operator source credentials; no values in configuration exports.
export interface SourceAuthorization<S extends 'Bearer' | 'ApiKey' = 'Bearer' | 'ApiKey'> {
  readonly origin: string;
  readonly scheme: S;
}
export type SourceBearerBinding = {
  readonly origin: string;
  readonly tokenEnv: string;
  readonly credentialRef?: never;
} | {
  readonly origin: string;
  readonly credentialRef: string;
  readonly tokenEnv?: never;
};
export type SourceApiKeyBinding = {
  readonly origin: string;
  readonly apiKeyEnv: string;
  readonly credentialRef?: never;
} | {
  readonly origin: string;
  readonly credentialRef: string;
  readonly apiKeyEnv?: never;
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
export interface SourceAuth<S extends 'Bearer' | 'ApiKey'> {
  readonly origins: readonly string[];
  requestHeaders(request: SourceRequest): Promise<Readonly<Record<string, string>>>;
  authorizationForOrigin(origin: string): SourceAuthorization<S> | null;
  /** Stop future resolutions and cancel in-flight resolutions. */
  close(): void;
}
export interface SourceBearerAuth extends SourceAuth<'Bearer'> {}
export interface SourceApiKeyAuth extends SourceAuth<'ApiKey'> {}
export interface SourceCredentialOptions {
  resolveCredential?: (reference: string, request: SourceCredentialRequest) => string | Promise<string>;
  environment?: Record<string, string | undefined>;
  timeoutMs?: number;
}
export class SourceAuthenticationError extends Error {
  readonly code: string;
  constructor(code: string);
}
export function createSourceBearerAuth(options: SourceCredentialOptions & {
  bindings: readonly SourceBearerBinding[];
}): SourceBearerAuth;
export function createSourceApiKeyAuth(options: SourceCredentialOptions & {
  bindings: readonly SourceApiKeyBinding[];
}): SourceApiKeyAuth;
