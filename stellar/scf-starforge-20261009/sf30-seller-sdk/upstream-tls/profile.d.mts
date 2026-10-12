import type { SecureContext, ConnectionOptions } from 'node:tls';
import type { UpstreamTlsDeclaration } from './config.mjs';

export interface TlsCertificateSummary { readonly sha256: string; readonly validFrom: string; readonly validTo: string; }
export interface UpstreamTlsSnapshot {
  readonly schema: 'stellar-forge.upstream-tls.v1';
  readonly state: 'LOADED' | 'DEFERRED';
  readonly loadedAt: string | null;
  readonly authentication: 'PEM' | 'PKCS12' | 'SERVER_ONLY';
  readonly trust: 'CUSTOM_CA_ONLY' | 'NODE_DEFAULT';
  readonly minVersion: string;
  readonly references: readonly string[];
  readonly certificate: TlsCertificateSummary | null;
  readonly caCertificates: readonly TlsCertificateSummary[];
  readonly bundleSha256: string | null;
}
export interface UpstreamTlsProfile {
  snapshot(): UpstreamTlsSnapshot;
  toJSON(): UpstreamTlsSnapshot;
}
export class UpstreamTlsError extends Error { readonly code: string; readonly reference?: string; }
export function loadUpstreamTls(value: UpstreamTlsDeclaration,
  options?: { env?: Record<string, string | undefined>; origin?: string; now?: number }): UpstreamTlsProfile;
export function loadUpstreamTls(value: undefined, options?: { env?: Record<string, string | undefined>; origin?: string; now?: number }): undefined;
export function deferUpstreamTls(value: UpstreamTlsDeclaration, options?: { env?: Record<string, string | undefined>; origin?: string }): UpstreamTlsProfile;
export function deferUpstreamTls(value: undefined, options?: { env?: Record<string, string | undefined>; origin?: string }): undefined;
export function assertUpstreamTlsProfile(profile?: UpstreamTlsProfile): void;
export function upstreamTlsRequestOptions(profile?: UpstreamTlsProfile): Readonly<{
  secureContext?: SecureContext; sessionIdContext?: string; rejectUnauthorized?: true; checkServerIdentity?: ConnectionOptions['checkServerIdentity'];
}>;
