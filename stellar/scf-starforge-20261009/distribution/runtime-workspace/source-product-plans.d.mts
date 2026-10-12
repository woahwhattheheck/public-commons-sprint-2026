import type { ProductCatalog, ProductRecord, Requirement, SourceReviewRequest } from '../discovery/product-requirements.mjs';
import type { ProductRuntimeRequirements, SourceDescriptor } from '../discovery/product-requirements-source.mjs';

export const PRODUCT_PLAN_SCHEMA: 'stellar-forge.runtime-product-plan.v1';
export const PRODUCT_PLAN_BUNDLE_SCHEMA: 'stellar-forge.runtime-product-plan-bundle.v1';
export const PRODUCT_PLAN_MAX_BYTES: number;
export interface ProductPlanIntent {
  label: string; purpose: string; sourceCommit: string; selection: string; requirements: Requirement[];
}
export interface ProductDefinition {
  schema: 'stellar-forge.runtime-source-build-review.v1';
  sourceCommit: string; selection: string; title: string; description: string;
  packageName: string; packageVersion: string; product: Record<string, unknown>;
  distributionInputs: SourceDescriptor[]; supportingInputs: SourceDescriptor[];
  commands: Record<string, string>; exports: Record<string, unknown>; components: string[];
  applications: string[]; merchantProviders: string[]; features: string[];
  contributions: { id: string; path: string }[];
}
export interface SavedSourceBuildReview extends ProductDefinition {
  repository: string; offline: boolean; python: string;
  reviewId: string; selectionSha256: string; requestId: string; reviewedAt: string;
}
export type ProductInspection = Partial<ProductRuntimeRequirements> & Record<string, unknown>;
export interface ProductPlan {
  schema: typeof PRODUCT_PLAN_SCHEMA; planId: string; intent: ProductPlanIntent;
  sourceSha256: string; catalogProduct: ProductRecord; source: ProductDefinition;
  createdAt: string; contentSha256: string;
}
export interface ProductPlanOrigin {
  schema: 'stellar-forge.runtime-product-plan-origin.v1'; originId: string; planId: string;
  workspaceId: string; review: SavedSourceBuildReview; runtimeRequirements: ProductInspection; createdAt: string;
}
export interface ProductBuildState {
  reviewId: string; selectionSha256: string; requestId: string; title: string;
  selection: string; repository: string; sourceCommit: string; packageName: string;
  packageVersion: string; reviewedAt: string; output: string;
  phase: 'REVIEWED' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'; stage: string | null;
  catalogDirectory: string | null; archiveId: string | null;
  archive: { file: string; bytes: number; sha256: string } | null;
  error: { code: string; message: string } | null;
}
export interface ProductPlanObservation {
  observationId: string; originId: string; workspaceId: string; observedAt: string; build: ProductBuildState;
}
export interface ProductPlanBundle {
  schema: typeof PRODUCT_PLAN_BUNDLE_SCHEMA; plan: ProductPlan; origins: ProductPlanOrigin[];
  observations: ProductPlanObservation[]; exportedAt: string; sha256: string;
}
export interface SourceBuildRequest {
  operation: 'source-build'; requestId: string; reviewId: string; selectionSha256: string;
}
export interface ProductPlanView {
  plan: ProductPlan; bindingId: string; workspaceId: string; review: SavedSourceBuildReview;
  catalog: ProductCatalog & { savedPlanId: string };
  product: ProductDefinition & { repository: string; offline: boolean; python: string; runtimeRequirements: ProductInspection };
  buildRequest: SourceBuildRequest;
  origins: (ProductPlanOrigin & { local: boolean; currentBuild: ProductBuildState | null })[];
  observations: ProductPlanObservation[];
}
export interface ProductPlanSaveInput extends Omit<SourceReviewRequest, 'offline' | 'python'> {
  label: string; purpose?: string; requirements?: Requirement[]; offline?: boolean; python?: string;
}
export interface ProductPlanReceivingState {
  receiptId: string; status: 'RECEIVED' | 'FAILED' | 'COMPLETE';
  planId?: string; bindingId?: string; reviewId?: string; requestId?: string; selectionSha256?: string;
  receivedOrigins?: number; completedAt?: string; updatedAt?: string; error?: { code: string; message: string };
}
export interface ProductPlanReceiving {
  input: {
    schema: 'stellar-forge.runtime-product-plan-receiving.v1'; receiptId: string;
    workspaceId: string; bundleSha256: string; repository: string; offline: boolean; python: string;
    bundle: ProductPlanBundle; receivedAt: string;
  };
  state: ProductPlanReceivingState;
}
export interface ProductPlanSummary {
  planId: string; label: string; purpose: string; sourceCommit: string; selection: string;
  requirements: Requirement[]; title: string; createdAt: string;
  bindings: { bindingId: string; repository: string; offline: boolean; python: string;
    reviewId: string; requestId: string; selectionSha256: string; createdAt: string }[];
}
export interface ProductPlansState {
  plans: ProductPlanSummary[]; total: number; nextCursor: string | null; workspaceId: string;
  receiving: { receiptId: string; label: string; planId: string | null; selection: string | null;
    sourceCommit: string | null; repository: string | null; receivedAt: string;
    status: ProductPlanReceivingState['status']; error: { code: string; message: string } | null;
    bindingId: string | null; summaryPending: boolean }[];
  receivingTotal: number; receivingNextCursor: string | null;
}
export function inspectProductPlanBundle(value: unknown): ProductPlanBundle;
export function readProductPlanDocument(path: string): Promise<unknown>;
export function readSourceProductPlan(root: string, input: { planId: string; bindingId?: string }): Promise<ProductPlanView>;
export function saveSourceProductPlan(root: string, input: ProductPlanSaveInput): Promise<ProductPlanView>;
export function refreshSourceProductPlan(root: string, input: { planId: string; bindingId?: string }): Promise<ProductPlanView>;
export function exportSourceProductPlan(root: string, input: { planId: string }): Promise<ProductPlanBundle>;
export function readProductPlanReceiving(root: string, input: { receiptId: string }): Promise<ProductPlanReceiving>;
export function receiveSourceProductPlan(root: string, input: {
  bundle: ProductPlanBundle; repository: string; offline?: boolean; python?: string;
}): Promise<ProductPlanView & { receiptId: string; receiving: ProductPlanReceivingState }>;
export function continueProductPlanReceiving(root: string, input: {
  receiptId: string;
}): Promise<ProductPlanView & { receiptId: string; receiving: ProductPlanReceivingState }>;
export function sourceProductPlansState(root: string, input?: {
  query?: string; limit?: number; cursor?: string;
  receivingQuery?: string; receivingStatus?: 'all' | 'RECEIVED' | 'FAILED' | 'COMPLETE';
  receivingLimit?: number; receivingCursor?: string;
}): Promise<ProductPlansState>;
