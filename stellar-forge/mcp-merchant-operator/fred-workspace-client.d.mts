/// <reference types="node" />
import type { Buffer } from 'node:buffer';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type NativeRecord = JsonObject & { id: string };
export interface FredSourceInput { path: string; kind: 'public-table' | 'capture'; label?: string; sha256?: string }
export interface FredMerchantProfile { label?: string; origin: string; path?: string; payment: JsonObject }
export interface FredWorkspaceOptions {
  label?: string; projectId?: string; expectedBindingSha256?: string;
  timeoutMs?: number; maxResponseBytes?: number;
  inputs?: Record<string, FredSourceInput>; merchantProfiles?: Record<string, FredMerchantProfile>;
}
export type FredWorkspaceDefinition = FredWorkspaceOptions & (
  { url: string | FredStartup; consoleUrlFile?: never; consoleUrlEnv?: never } |
  { consoleUrlFile: string; url?: never; consoleUrlEnv?: never } |
  { consoleUrlEnv: string; url?: never; consoleUrlFile?: never }
);
export interface FredWorkspaceConfiguration {
  schema: 'stellar-forge.fred-workspace-connection.v1'; path: string;
  workspaces: Record<string, FredWorkspaceDefinition>;
}
export interface FredBinding {
  schema: 'stellar-forge.fred-workspace-binding.v1';
  directory: string; projectId: string; createdAt: string;
  buyerConfig: { path: string; settingsSha256: string } | null;
  facilitator: string | null; allowLocalFacilitator: boolean; merchantPort: number; sha256: string;
}
export interface FredStartup {
  schema: 'stellar-forge.fred-workspace-startup.v1'; state: 'LISTENING';
  binding: FredBinding; instanceId: string; startedAt: string; buyerConfigured: boolean; url?: string;
}
export interface FredProject {
  schema: 'stellar-forge.fred-project.v1'; id: string; title: string; apiKeyEnv: string;
  selection: JsonObject; revision: number; createdAt: string; selectedCapture: string | null;
  captures: NativeRecord[]; reviews: NativeRecord[]; publications: NativeRecord[]; operations: NativeRecord[];
  pending: JsonObject | null; acquisition?: JsonObject | null;
}
export interface FredState { project: FredProject; merchant: JsonObject | null; busy: string | null; buyerConfigured: boolean }
export interface FredClientMetadata {
  projectId: string | null; connected: boolean; closed: boolean; bindingSha256: string | null;
  instanceId: string | null; timeoutMs: number; maxResponseBytes: number; hostOwnership: 'ORIGINAL_FRED_WORKSPACE';
}
export interface FredOperation {
  projectId: string; revision: number; busy: string | null; operation: NativeRecord | null;
  pending: JsonObject | null; acquisition: JsonObject | null; observationTimedOut?: boolean;
}
export interface FredObservedPage {
  captureId: string; series: Json[]; total: number; offset: number; limit: number; rows: JsonObject[]; nextOffset: number | null;
}
export interface FredComparisonPage {
  total: number; offset: number; limit: number; changes: JsonObject[]; nextOffset: number | null; [key: string]: unknown;
}
export interface FredPublication {
  edition: JsonObject; plan: JsonObject; offers: JsonObject[];
  requests: Array<{ intentId: string; url: string; file: string | null; purchaseSha256: string }>;
}
export interface FredRevisionResult { revision: number; replayed?: boolean }
export interface FredConfiguredResult extends FredRevisionResult { selection: JsonObject }
export interface FredCaptureResult extends FredRevisionResult { captureId: string; rowCount: number; missing: number }
export interface FredCombinedResult extends FredCaptureResult { originalCaptures: string[] }
export interface FredSelectedResult extends FredRevisionResult { captureId: string }
export interface FredReviewedResult extends FredSelectedResult { reviewId: string }
export interface FredPublishedResult extends FredRevisionResult {
  publicationId: string; reviewId: string; captureId: string; snapshot: string;
  editionId: string; resource: string; publicOrigin: string;
}
export interface FredFileMetadata { path: string; bytes: number; sha256: string; contentType: string; role: string }
export interface FredAdvertisedFile extends FredFileMetadata { resource: string }
export interface FredMerchantRuntime {
  publicationId: string; url: string; mode: string; editionId: string; snapshot: string; resource: string;
}
export interface FredPreparedPurchase {
  schema: 'stellar-forge.fred-purchase.v1'; editionId: string; captureSha256: string; snapshot: string;
  planSha256: string; intentId: string; url: string; file: string | null; previous: JsonObject | null;
  expected: FredAdvertisedFile | null; configSha256: string; config: JsonObject; purchaseSha256: string;
}
export interface FredDeliveredPurchase {
  state: 'DELIVERED'; intentId: string; editionId: string; bytes: number; sha256: string;
  metadata: JsonObject & { snapshot?: string; nextCursor?: string | null; path?: string; contentType?: string };
  page?: JsonObject;
}
export interface FredPendingPurchase {
  state: 'PREPARED_NOT_STARTED' | 'NATIVE_PREPARATION_INCOMPLETE' | 'AWAITING_NATIVE_RESULT';
  intentId: string; editionId?: string;
}
export type FredPurchaseStatus = FredDeliveredPurchase | FredPendingPurchase;
export interface FredJournalInput { id: string; expectedRevision: number }
export interface FredSelectionInput extends FredJournalInput { selection: JsonObject }
export interface FredImportInput extends FredJournalInput { capture: JsonObject }
export interface FredCombineInput extends FredJournalInput { captureIds: string[] }
export interface FredCaptureInput extends FredJournalInput { captureId: string }
export interface FredReviewInput extends FredCaptureInput { policy?: JsonObject; note?: string }
export interface FredPublishInput extends FredJournalInput { reviewId: string; origin: string; path?: string; payment: JsonObject }
export interface FredAbandonInput extends FredJournalInput { pendingId: string }
export interface FredPublicationInput { publicationId: string }
export interface FredIntentInput extends FredPublicationInput { intentId: string }
export interface FredPrepareInput extends FredIntentInput {
  query?: string; file?: string | null; previous?: JsonObject | null; acceptIndex?: number;
}
export interface FredRequestOptions { signal?: AbortSignal }
export interface FredFileOptions extends FredRequestOptions { expectedSha256?: string }
export type FredFileSelection =
  { kind: 'source'; captureId: string } |
  { kind: 'comparison'; before: string; after: string } |
  { kind: 'project' } |
  { kind: 'customer'; publicationId: string; intentId: string };
export interface FredBundleIdentity {
  schema: 'stellar-forge.fred-project-bundle.v1'; projectId: string; revision: number;
  bundleSha256: string; captures: number; publications: number;
}
export interface FredDownloadedFile {
  name: string; type: string; bytes: Buffer; sha256: string; status: number; projectId: string; bundle?: FredBundleIdentity;
}
export interface FredSavedFile {
  path: string; name: string; type: string; bytes: number; sha256: string; projectId: string; reused: boolean; bundle?: FredBundleIdentity;
}
export interface FredClientRuntime { environment?: Record<string, string | undefined>; fetchImpl?: typeof fetch }

export declare const FRED_WORKSPACE_CONNECTION_SCHEMA: 'stellar-forge.fred-workspace-connection.v1';
export declare const FRED_CLIENT_MAX_BYTES: number;
export declare const FRED_CLIENT_MAX_REQUEST_BYTES: number;
export declare function fredDigest(bytes: string | Uint8Array): string;
export declare function canonicalFredJSON(value: Json): string;
export declare class FredWorkspaceError extends Error {
  code: string; status?: number; ambiguous?: boolean; operationId?: string; projectId?: string;
  responseReceived?: boolean; responseBytes?: number; responseSha256?: string; retryAt?: string;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}
export declare function readFredHostFile(path: string, maximum?: number,
  options?: { privateFile?: boolean; expectedSha256?: string }): Promise<Buffer>;
export declare function readFredWorkspaceConfiguration(path: string): Promise<FredWorkspaceConfiguration>;
export declare class FredWorkspaceClient {
  constructor(definition: FredWorkspaceDefinition, runtime?: FredClientRuntime);
  readonly metadata: FredClientMetadata;
  timeoutMs: number; maxResponseBytes: number;
  launch(options?: FredRequestOptions): Promise<FredStartup>;
  state(options?: FredRequestOptions): Promise<FredState>;
  operation(id: string, options?: FredRequestOptions): Promise<FredOperation>;
  observations(input: { captureId: string; series?: string; offset?: number }, options?: FredRequestOptions): Promise<FredObservedPage>;
  compare(input: { before: string; after: string; offset?: number }, options?: FredRequestOptions): Promise<FredComparisonPage>;
  publication(publicationId: string, options?: FredRequestOptions): Promise<FredPublication>;
  preview(input: { publicationId: string; query?: string }, options?: FredRequestOptions): Promise<JsonObject>;
  configure(input: FredSelectionInput, options?: FredRequestOptions): Promise<FredConfiguredResult>;
  capture(input: FredJournalInput, options?: FredRequestOptions): Promise<FredCaptureResult>;
  importCapture(input: FredImportInput, options?: FredRequestOptions): Promise<FredCaptureResult>;
  combine(input: FredCombineInput, options?: FredRequestOptions): Promise<FredCombinedResult>;
  select(input: FredCaptureInput, options?: FredRequestOptions): Promise<FredSelectedResult>;
  review(input: FredReviewInput, options?: FredRequestOptions): Promise<FredReviewedResult>;
  publish(input: FredPublishInput, options?: FredRequestOptions): Promise<FredPublishedResult>;
  abandon(input: FredAbandonInput, options?: FredRequestOptions): Promise<FredRevisionResult & { pendingId: string; state: 'ABANDONED' }>;
  startMerchant(input: FredPublicationInput, options?: FredRequestOptions): Promise<FredMerchantRuntime>;
  stopMerchant(input: FredPublicationInput, options?: FredRequestOptions): Promise<{ state: 'STOPPED' }>;
  prepare(input: FredPrepareInput, options?: FredRequestOptions): Promise<FredPreparedPurchase>;
  buy(input: FredIntentInput, options?: FredRequestOptions): Promise<FredPurchaseStatus>;
  recover(input: FredIntentInput, options?: FredRequestOptions): Promise<FredPurchaseStatus>;
  wait(id: string, options?: FredRequestOptions & { timeoutMs?: number; intervalMs?: number }): Promise<FredOperation>;
  file(selection: FredFileSelection, options?: FredFileOptions): Promise<FredDownloadedFile>;
  close(): void;
}
export declare function inspectFredProjectBundle(bundle: unknown): FredBundleIdentity;
export declare function saveFredFile(client: FredWorkspaceClient, selection: FredFileSelection, destination: string,
  options?: FredFileOptions): Promise<FredSavedFile>;
export declare function receiveFredWorkspaceFile(source: string, directory: string, options?: { expectedSha256?: string }):
  Promise<FredBundleIdentity & { sourceBytes: number; sourceSha256: string; received: JsonObject }>;
