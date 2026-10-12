import type { Buyer, Operation } from '../index.mjs';

export type PartitionParameter = string | number | boolean | string[];
export type PartitionParameters = Record<string, PartitionParameter>;
export interface PartitionSource {
  readonly apiRepository: string; readonly apiRevision: string; readonly apiPath: string;
  readonly apiReference: string; readonly coreRepository: string; readonly coreRevision: string;
  readonly coreVersion: string; readonly inferenceVersion: string;
  readonly product: 'self-hosted-partition';
}
export const UNSTRUCTURED_SOURCE: Readonly<PartitionSource>;
export const PARTITION_LIMITS: Readonly<{
  requestBytes: number; documentBytes: number; responseBytes: number; parametersBytes: number;
}>;
export const PARTITION_DEFAULT_PARAMETERS: Readonly<PartitionParameters>;
export const PARTITION_PURCHASE_SCHEMA: 'sf88-unstructured-saved-purchase-v1';
export const PARTITION_RESEARCH_SCHEMA: 'sf88-research-results-v1';
export interface PartitionElement {
  type: string | null; element_id: string; text: string;
  metadata: Record<string, unknown> & {
    filename?: string; page_number?: number | string;
    coordinates?: Record<string, unknown>; text_as_html?: string; orig_elements?: string;
  };
  [key: string]: unknown;
}
export interface PartitionElementSummary {
  elements: number; types: Record<string, number>; pages: string[];
  withCoordinates: number; withTableHtml: number; withOriginalElements: number;
  repeatedElementIds: number;
}
export interface PartitionPaymentOption {
  scheme: 'exact'; network: string; asset: string; payTo: string; amount: string;
  extra: Record<string, unknown> & { paymentFlow: 'authorization' };
  [key: string]: unknown;
}
export interface PartitionProfile {
  id: string; operationId: string; handler: string; title: string; description: string;
  path: string; url: string; parameters: PartitionParameters; parametersSha256: string;
  maxDocumentBytes: number; maxRequestBytes: number; maxResponseBytes: number;
  paymentFlow: 'authorization'; paymentOptions: PartitionPaymentOption[];
}
export interface PartitionManifest {
  schema: 'stellar-forge.unstructured-partition-manifest.v1';
  source: PartitionSource; publicOrigin: string; requestTimeoutMs: number;
  handlerTimeoutMs: number; profiles: PartitionProfile[];
}
export interface RetainedBytes { bytes: number; sha256: string; bodyBase64: string }
export interface DocumentDescription {
  field?: 'files'; filename: string; contentType: string; bytes: number; sha256: string;
}
export interface PartitionNativeOutcome {
  status: string; httpStatus: 200; sellerReportedSettlement?: string | null; responseStatus: 'SAVED';
}
export interface SavedPartitionPurchase {
  schema: typeof PARTITION_PURCHASE_SCHEMA; source: PartitionSource;
  workspaceId: string; intentId: string; configurationSha256: string;
  selection: {
    method: 'POST'; url: string; profileId: string; paymentFlow: 'authorization';
    contentType: string; parameters: PartitionParameters; parametersSha256: string;
  };
  request: RetainedBytes; document: RetainedBytes & DocumentDescription; response: RetainedBytes;
  summary: PartitionElementSummary; native: PartitionNativeOutcome;
}
export interface PartitionBinding {
  schema: typeof PARTITION_PURCHASE_SCHEMA; workspaceId: string; intentId: string;
  configurationSha256: string; method: 'POST'; url: string; profileId: string;
  paymentFlow: 'authorization'; parametersSha256: string; document: DocumentDescription;
  requestSha256: string; requestBytes: number; responseSha256: string; responseBytes: number;
  native: PartitionNativeOutcome;
}
export interface PartitionRequestInput {
  runtimeDirectory: string; manifest: PartitionManifest; profile: string; file: string;
  filename?: string; mediaType?: string; bodyFile: string; intentId: string;
  maxAtomic: string; acceptIndex: number;
}
export interface PreparedPartitionRequest {
  reused: boolean; bodyFile: string; bodyBytes: number; bodySha256: string;
  headers: Record<string, string>; document: DocumentDescription;
  parametersSha256: string; maximumAtomic: string; originalTerms: PartitionPaymentOption;
  purchase: {
    routeId: string; method: 'POST'; intentId: string; acceptIndex: number;
    paymentFlow: 'authorization'; bodyFile: string; headers: Record<string, string>;
    saveResponse: true; responseMaxBytes: number; responseTimeoutMs: number; requestTimeoutMs: number;
  };
}
export function normalizePartitionParameters(input?: PartitionParameters): PartitionParameters;
export function parsePartitionElements(value: unknown): PartitionElement[];
export function partitionElementSummary(elements: PartitionElement[]): PartitionElementSummary;
export function validatePartitionManifest(value: unknown): PartitionManifest;
export function readPartitionManifest(file: string): Promise<PartitionManifest>;
export function preparePartitionRequest(input: PartitionRequestInput): Promise<PreparedPartitionRequest>;
export function preparePartitionPurchase(buyer: Buyer, input: {
  manifest: PartitionManifest; profile: string; file: string; filename?: string; mediaType?: string;
  client: string; intentId: string; maxAtomic: string; acceptIndex: number;
  workspace?: string; signal?: AbortSignal;
}): Promise<Operation>;
export function readPartitionPurchase(buyer: Buyer, intentId: string, options: {
  workspaceId: string; signal?: AbortSignal;
}): Promise<SavedPartitionPurchase>;
export function readPartitionInboxPurchase(buyer: Buyer, inboxDirectory: string, intentId: string,
  options: { workspaceId: string; signal?: AbortSignal }): Promise<SavedPartitionPurchase>;
export function verifyPartitionPurchase(value: unknown, options: {runtimeDirectory: string}): Promise<{
  purchase: SavedPartitionPurchase; elements: PartitionElement[]; document: Uint8Array;
}>;
export function partitionPurchaseBinding(purchase: SavedPartitionPurchase): PartitionBinding;
export interface PartitionEditionReference { id: string; workspaceId: string; operationId: string }
export interface PartitionResearchEnvelope {
  schema: typeof PARTITION_RESEARCH_SCHEMA; provider: 'unstructured'; query: string;
  success: true; status: 'AVAILABLE'; sourceTerms: string;
  results: Array<Record<string, unknown>>; usage: Record<string, unknown>; warnings: string[];
  originalPurchase: SavedPartitionPurchase;
}
export interface PartitionEditionReceipt {
  reference: PartitionEditionReference; binding: PartitionBinding;
  editionSha256: string; elementCount: number; summary: PartitionElementSummary;
}
export interface PartitionEditionProvider {
  readonly workspaceId: string; readonly runtimeDirectory: string;
  envelope(intentId: string, options?: {signal?: AbortSignal}): Promise<PartitionResearchEnvelope>;
  describe(intentId: string, options?: {signal?: AbortSignal}): Promise<PartitionEditionReceipt>;
  read(reference: PartitionEditionReference): Promise<{
    status: 'AVAILABLE'; items: Array<Record<string, unknown>>; usage: Record<string, unknown>;
    warnings: string[]; retention: 'ORIGINAL_SAVED_BUYER_RESULT';
  }>;
}
export function createPartitionEditionProvider(buyer: Buyer, options: {
  workspaceId: string; inboxDirectory?: string;
}): PartitionEditionProvider;
export function verifyPartitionResearchEnvelope(value: unknown, options: {
  runtimeDirectory: string;
}): Promise<PartitionEditionReceipt & {
  envelope: PartitionResearchEnvelope; elements: PartitionElement[]; document: Uint8Array;
}>;
export interface OriginalDossierView {
  id: string; revision: number; editions: Array<Record<string, unknown>>;
  [key: string]: unknown;
}
export interface OriginalDossierStore {
  get(id: string, options?: {revision?: number}): Promise<OriginalDossierView>;
  getMetadata?(id: string, options?: {revision?: number}): Promise<OriginalDossierView>;
  receive(id: string, options: Record<string, unknown>): Promise<OriginalDossierView>;
  receiveReference(id: string, options: Record<string, unknown>): Promise<OriginalDossierView>;
}
export interface PartitionReceivingDecision {
  questionId: string; label: string; expectedRevision: number; expectedEditionSha256: string;
  mode?: 'retained' | 'reference'; signal?: AbortSignal;
}
export interface PartitionReceivingResult {
  dossier: OriginalDossierView; receipt: PartitionEditionReceipt; reused: boolean; editionId: string;
}
export function receivePartitionEnvelope(store: OriginalDossierStore, dossierId: string,
  options: PartitionReceivingDecision & {envelope: PartitionResearchEnvelope; runtimeDirectory: string}):
  Promise<PartitionReceivingResult>;
export function receivePartitionEdition(store: OriginalDossierStore, dossierId: string,
  options: PartitionReceivingDecision & {provider: PartitionEditionProvider; intentId: string}):
  Promise<PartitionReceivingResult>;
