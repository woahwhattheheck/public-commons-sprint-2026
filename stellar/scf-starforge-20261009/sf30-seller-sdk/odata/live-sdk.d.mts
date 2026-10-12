// MIT. Live paid-page contract and original merchant/customer lifecycle.
import type { Server } from 'node:http';
import type { CompiledSeller, SellerApplicationRequest, SellerResponse,
  EmbeddedSellerSnapshot, SellerAvailabilityControl } from '../embedded/index.mjs';
import type { ODataWorkspace } from './workspace.mjs';
import type { ODataCatalog, ODataEntitySet, ODataQueryPlan, ODataNormalizedPlan, ODataCompiledQuery,
  ODataFilter, ODataPayment, ODataEnvironment } from './types.mjs';
export type * from './types.mjs';
export declare const PLAN_SCHEMA: 'stellar-forge.odata-live-merchant.v1';
export declare const PAGE_SCHEMA: 'stellar-forge.odata-live-page.v1';
export interface ODataLiveOperation {
  id: string; path: string; entitySet: string; fields: string[]; filterFields?: string[]; orderFields?: string[];
  maxPageRows: number; maxTotalRows: number; amountAtomic: string;
  /** Fixed saved-query scope; omitted only for an explicitly flexible merchant. */
  sourceFilters?: ODataFilter[]; sourceFilterMode?: 'and' | 'or';
}
export interface ODataLiveLimits {
  timeoutMs: number; maxResponseBytes: number; maxInFlight: number; cursorLifetimeSeconds: number;
}
export interface ODataLivePlan {
  schema: typeof PLAN_SCHEMA; title: string; publicOrigin: string; serviceRoot: string; metadataSha256: string;
  headerEnv?: Record<string, string>; oauth2?: Record<string, unknown>; payment: ODataPayment;
  operations: ODataLiveOperation[]; limits?: Partial<ODataLiveLimits>;
}
export interface ODataNormalizedLivePlan extends Omit<ODataLivePlan, 'operations' | 'limits'> {
  operations: Array<ODataLiveOperation & { filterFields: string[]; orderFields: string[] }>;
  limits: ODataLiveLimits;
}
export type ODataLiveQueryInput = Omit<ODataQueryPlan, 'entitySet'>;
export type ODataLiveQuery = Omit<ODataNormalizedPlan, 'entitySet' | 'top'> & { top: number };
export interface ODataLiveCompiledQuery {
  compiled: ODataCompiledQuery; query: ODataLiveQuery; url: string; seenRows: number;
}
export type ODataLiveRequest = ODataLiveQueryInput | { cursor: string };
export interface ODataLivePage {
  schema: typeof PAGE_SCHEMA; operation: string; entitySet: string; metadataSha256: string;
  query: ODataLiveQuery; queryFingerprint: string;
  /** Keys are selected OData paths; Decimal/Int64 stay strings. */
  items: Array<Record<string, string | number | boolean | null>>;
  count: string | null; seenRows: number; completion: 'continue' | 'provider' | 'limit';
  next: string | null; supplierResponseSha256: string; receivedAt: string; etag: string | null;
}
export interface PreparedODataProduct {
  plan: ODataNormalizedLivePlan; catalog: ODataCatalog; sourceBinding: string;
  upstreams: Record<string, unknown>; spec: Record<string, unknown>; selections: Array<Record<string, unknown>>;
  bindings: Array<Record<string, unknown>>; imported: Record<string, unknown>; service: Record<string, unknown>;
  offers: { resources: Array<Record<string, unknown>> };
}
export interface PreparedODataDraft extends PreparedODataProduct {
  selection: { operation: string; request: ODataLiveQuery }; query: ODataLiveCompiledQuery;
}
export interface ODataLiveManifest {
  schema: 'stellar-forge.odata-live-package.v1'; id: string; createdAt: string; sourceBinding: string;
  files: Record<string, { bytes: number; sha256: string }>;
}
export interface ODataLivePackage extends PreparedODataDraft { directory: string; manifest: ODataLiveManifest }
export interface ODataBuyerHandoff {
  schema: 'stellar-forge.odata-live-buyer-handoff.v1'; directory: string; operation: string; intentId: string;
  metadataSha256: string; requestSha256: string; buyerSha256: string;
}
export interface ODataLiveReceiving {
  schema: 'stellar-forge.odata-live-receiving.v1'; directory: string; operation: string; metadataSha256: string;
  rows: number; seenRows: number; count: string | null; columns: string[]; query: ODataLiveQuery; queryFingerprint: string;
  completion: ODataLivePage['completion']; supplierResponseSha256: string;
  originalResponse: { file: 'original-response.json'; sha256: string; bytes: number };
  jsonl: { file: 'rows.jsonl'; sha256: string; bytes: number }; nextRequest: 'next-request.json' | null;
}
export interface ODataLiveSnapshot {
  schema: 'stellar-forge.odata-live-runtime.v1'; closed: boolean; metadataSha256: string; operations: string[];
  supplierReads: number; deliveredPages: number; deliveredRows: number; rejectedResponses: number;
}
export interface ODataApplication extends PreparedODataProduct {
  config: Record<string, unknown>;
  handlers: Readonly<Record<string, (request: SellerApplicationRequest) => Promise<boolean | SellerResponse>>>;
  snapshot(): ODataLiveSnapshot; close(): Promise<void>;
}
export type ODataNativeFactory = (compiled: CompiledSeller) => unknown | Promise<unknown>;
export type ODataLookup = (hostname: string, options: { all: true; verbatim: true }) =>
  Promise<Array<{ address: string; family: number }>>;
export interface ODataMerchant {
  server: Server; url: string; mode: 'CHALLENGE_ONLY' | 'NATIVE_X402'; directory: string;
  compiled: CompiledSeller; application: ODataApplication; outbox: unknown;
  lifecycle: { snapshot(): EmbeddedSellerSnapshot['lifecycle'] }; availability?: SellerAvailabilityControl;
  operations: { url: string; close(): Promise<unknown>; [nativeDetail: string]: unknown };
  close(): Promise<void>;
}
export declare function validatePlan(plan: ODataLivePlan, catalog: ODataCatalog, options?: { allowLoopback?: boolean }): ODataNormalizedLivePlan;
export declare function buildQuery(plan: ODataNormalizedLivePlan, catalog: ODataCatalog, operation: string, input?: ODataLiveQueryInput): ODataLiveCompiledQuery;
export declare function validatePage(page: unknown, plan: ODataNormalizedLivePlan, catalog: ODataCatalog, operation: string): {
  operation: ODataNormalizedLivePlan['operations'][number]; entity: ODataEntitySet; query: ODataLiveQuery; compiled: ODataCompiledQuery;
};
export declare function prepareProduct(plan: ODataLivePlan, catalog: ODataCatalog, options?: { allowLoopback?: boolean }): PreparedODataProduct;
export declare function templatePlan(catalog: ODataCatalog, options?: { publicOrigin?: string; entitySet?: string }): ODataLivePlan;
export declare function templateFromWorkspace(workspace: ODataWorkspace, input: {
  planId: string; publicOrigin?: string; payment?: ODataPayment; amountAtomic?: string;
}): Promise<ODataLivePlan>;
export declare function prepareDraft(input: { catalog: ODataCatalog; plan: ODataLivePlan;
  selection: { operation: string; request: ODataLiveQueryInput } }, options?: { allowLoopback?: boolean }): PreparedODataDraft;
export declare function prepareFromWorkspace(workspace: ODataWorkspace, input: {
  planId: string; plan: ODataLivePlan; operation?: string;
}, options?: { allowLoopback?: boolean }): Promise<PreparedODataDraft>;
export declare function writePackage(prepared: PreparedODataDraft, directory: string): Promise<ODataLiveManifest & { directory: string }>;
export declare function readPackage(directory: string, options?: { allowLoopback?: boolean }): Promise<ODataLivePackage>;
export declare function prepareBuyerHandoff(prepared: PreparedODataProduct, input: {
  operation: string; request: ODataLiveRequest; intentId: string; directory: string; acceptIndex?: number;
  /** Final SF88 paths when the original files are prepared in a staging directory. */
  requestDirectory?: string;
}): Promise<ODataBuyerHandoff>;
export declare function receivePage(prepared: PreparedODataProduct, input: {
  operation: string; responsePath: string; directory: string;
}): Promise<ODataLiveReceiving>;
export declare function createODataApplication(plan: ODataLivePlan, catalog: ODataCatalog, options: {
  cursorKey: Uint8Array; env?: ODataEnvironment; allowLoopback?: boolean; lookup?: ODataLookup;
}): ODataApplication;
export declare function startODataMerchant(options: {
  plan: ODataLivePlan; catalog: ODataCatalog; directory: string; env?: ODataEnvironment;
  port?: number; operationsPort?: number; nativeFactory?: ODataNativeFactory | null; allowLoopback?: boolean;
  lookup?: ODataLookup; historyRetentionDays?: number; navigationOrigin?: string | null;
}): Promise<ODataMerchant>;
