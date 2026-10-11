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
export type SellerStreamFormat = 'sse' | 'ndjson';
/** Original decoded UTF-8 bytes. The seller validates framing without rewriting records. */
export interface SellerResponseStream {
  format: SellerStreamFormat;
  body: AsyncIterable<Uint8Array>;
  /** 1 byte–1 GiB; capped by the application's maxStreamBytes. */
  maxBytes?: number;
  /** Maximum source chunk, default 1 MiB; maximum 16 MiB. */
  maxChunkBytes?: number;
  /** Maximum complete event/record, default 1 MiB; maximum 16 MiB. */
  maxRecordBytes?: number;
  /** Maximum complete records, default 100,000; maximum 1,000,000. */
  maxRecords?: number;
  /** Generation and delivery lifetime, default 120,000 ms; maximum one hour. */
  maxDurationMs?: number;
  /** Time awaiting the next requested chunk, default 30,000 ms; maximum five minutes. */
  idleTimeoutMs?: number;
  /**
   * Called once by the seller, including before iteration and after natural EOF.
   * Stop the actual producer and release its resources. Undefined means success;
   * an Error carries cancellation, validation, settlement or delivery failure.
   */
  close?: (reason?: Error) => void | Promise<unknown>;
}
export interface SellerResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  stream?: SellerResponseStream;
}
export interface SellerStreamingResponse extends SellerResponse {
  status: 200;
  headers: Record<string, string>;
  body?: never;
  stream: SellerResponseStream;
}
export interface SellerStreamingResponseOptions extends SellerResponseStream {
  status?: 200;
  /** Defaults to the format's UTF-8 content type; custom headers must remain compatible. */
  headers?: Record<string, string>;
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
  maxStreamBytes?: number;
  streamSpoolDirectory?: string;
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
/**
 * Create an original seller response. Default authorization generates completely
 * before native settlement; the route's explicitly advertised upfront flow can
 * deliver live after the existing native before-handler receipt.
 */
export declare function streamingResponse(options: SellerStreamingResponseOptions): SellerStreamingResponse;

