import type { IncomingMessage, ServerResponse } from 'node:http';

export type HostRequest = IncomingMessage & { originalUrl?: string; body?: unknown };
export interface SellerApplicationRequest {
  method: string;
  url: URL;
  query: Record<string, string | string[]>;
  body: unknown;
  pathParams: Readonly<Record<string, string>>;
  headers: IncomingMessage['headers'];
  signal: AbortSignal;
  deadlineEpochMillis: number;
}
export interface SellerResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}
export interface SellerRoute {
  id: string;
  definition?: Record<string, unknown>;
  offer?: Record<string, unknown>;
  handler: (request: SellerApplicationRequest) => SellerResponse | Promise<SellerResponse>;
  admit?: (request: SellerApplicationRequest) => boolean | SellerResponse | Promise<boolean | SellerResponse>;
}
export interface CompiledSeller {
  readonly routes: readonly unknown[];
  readonly nativeRoutes: Readonly<Record<string, unknown>>;
}
export interface SellerAvailabilityChange {
  expectedRevision: number;
  action: 'pause' | 'resume';
  routeIds: readonly string[];
  reason?: string;
}
export interface SellerAvailabilitySnapshot {
  schema: 'stellar-forge.seller-availability.v1';
  available: true;
  revision: number;
  savedAt: string;
  storageState: 'ready' | 'unavailable';
  serviceOrigin: string;
  routes: ReadonlyArray<{
    id: string;
    method: string;
    path: string;
    description: string;
    inFlight: number;
    admitted: number;
    rejected: number;
    paused: boolean;
    reason: string;
    changedAt: string | null;
    state: 'selling' | 'pausing' | 'paused' | 'storage_unavailable';
  }>;
  retiredPauses: ReadonlyArray<{ id: string; reason: string; changedAt: string }>;
  recentChanges: ReadonlyArray<{
    revision: number;
    at: string;
    action: 'pause' | 'resume';
    routeIds: readonly string[];
    reason: string;
  }>;
}
/** Private operator state. The embedded seller owns the policy's close lifecycle. */
export interface SellerAvailabilityControl {
  snapshot(): SellerAvailabilitySnapshot;
  update(change: SellerAvailabilityChange): Promise<SellerAvailabilitySnapshot>;
}
export interface EmbeddedSellerSnapshot {
  schema: 'stellar-forge.embedded-seller.v1';
  mode: 'CHALLENGE_ONLY' | 'NATIVE_X402';
  routes: ReadonlyArray<{ id: string; method: string; url: string; routeTemplate?: string }>;
  lifecycle: {
    state: 'ACCEPTING' | 'DRAINING' | 'CLOSED';
    accepting: boolean;
    maxInFlight: number;
    drainGraceMs: number;
    inFlight: number;
    admitted: number;
    completed: number;
    disconnected: number;
    capacityRejected: number;
    drainingRejected: number;
    forcedClose: boolean;
    semantics: string;
  };
  requestLifetime: Readonly<Record<string, number>>;
}
export type EmbeddedSellerOptions<Context = unknown> = {
  allowLocalhost?: boolean;
  nativeFactory?: null | ((compiled: CompiledSeller) => unknown | Promise<unknown>);
  contextFromRequest?: (request: HostRequest) => Context;
  documentation?: boolean;
  maxInFlight?: number;
  drainGraceMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  admissionTimeoutMs?: number;
  handlerTimeoutMs?: number;
  requestTimeoutMs?: number;
  /** Canonical absolute private policy directory; requires Linux flock. */
  availabilityDirectory?: string;
} & ({ routes: SellerRoute[]; compiled?: never } | { compiled: CompiledSeller; routes?: never });

export interface EmbeddedSeller {
  readonly compiled: CompiledSeller;
  readonly mode: 'CHALLENGE_ONLY' | 'NATIVE_X402';
  readonly availability?: SellerAvailabilityControl;
  handle(request: HostRequest, response: ServerResponse): Promise<boolean>;
  middleware(request: HostRequest, response: ServerResponse, next: (error?: unknown) => unknown): Promise<unknown>;
  snapshot(): EmbeddedSellerSnapshot;
  close(): Promise<EmbeddedSellerSnapshot['lifecycle']>;
}

/** Returns only the value explicitly supplied by this request's host extractor. */
export declare function getEmbeddedRequestContext<Context = unknown>(): Context | undefined;
export declare function createEmbeddedSeller<Context = unknown>(options: EmbeddedSellerOptions<Context>): Promise<EmbeddedSeller>;

