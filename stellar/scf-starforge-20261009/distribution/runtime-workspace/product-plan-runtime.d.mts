import type { ProductPlanView, ProductBuildState } from './source-product-plans.mjs';

export const PRODUCT_PLAN_RUNTIMES_SCHEMA: 'stellar-forge.product-plan-runtimes.v1';
export const PRODUCT_PLAN_HANDOFF_SCHEMA: 'stellar-forge.product-plan-handoff.v1';
export interface RuntimeOperationSummary {
  id: string; operation: string; runtimeId?: string | null; targetId?: string | null;
  phase?: string; displayPhase?: string; workerActive?: boolean;
  createdAt?: string; updatedAt?: string; completedAt?: string; profileId?: string | null;
}
export interface ProductRuntimeCandidate {
  runtimeId: string; label: string; directory: string | null; phase: string;
  sourceCommit: string | null; packageVersion: string | null; profileId: string | null;
  archiveSha256: string; installationId: string | null; errorCode?: string; preparationErrorCode?: string;
  operations: RuntimeOperationSummary[];
}
export interface ProductPlanRuntimes {
  schema: typeof PRODUCT_PLAN_RUNTIMES_SCHEMA; workspaceId: string; planId: string; bindingId: string;
  sourceCommit: string; selection: string; reviewId: string; requestId: string;
  build: { phase: string; archiveId: string | null;
    archive: { file: string; bytes: number; sha256: string } | null } | null;
  runtimes: ProductRuntimeCandidate[];
}
export interface RuntimeWorkspaceSnapshot {
  workspaceId: string;
  runtimes: { id: string; label: string; directory: string; phase: string;
    archiveSha256?: string | null; sourceCommit?: string | null; packageVersion?: string | null;
    profileId?: string | null; state?: { installationId?: string } | null;
    error?: { code?: string }; preparationError?: { code?: string } | null; [key: string]: unknown }[];
  operations: (RuntimeOperationSummary & {
    name?: string; targetDirectory?: string; archiveSha256?: string | null; archiveId?: string | null;
    [key: string]: unknown;
  })[];
}
export interface OriginalRuntimeInstallation {
  directory: string; archiveSha256: string; installationId: string; profileId: string;
  source: { sourceCommit: string; packageName: string; packageVersion: string; manifestSha256: string;
    [key: string]: unknown };
  [key: string]: unknown;
}
export interface InstalledDependency {
  name: string; expectedVersion: string; requested: unknown; ready: boolean; native?: string;
  checks: { group: string; probe: string; version?: string; state: string;
    importState?: string; importCode?: string; native?: { state: string; kind?: string };
    [key: string]: unknown }[];
}
export interface OriginalRuntimeInspection {
  directory: string; installationId: string; profileId: string; sourceCommit: string;
  status: string; ready: boolean; sourceVerified?: boolean; lockSha256: string | null; lockMatches: boolean;
  profile: { dependencies: InstalledDependency[]; nativeRequired: boolean; loadRequested: boolean;
    [key: string]: unknown };
  [key: string]: unknown;
}
export interface OriginalRuntimeHandoff {
  schema: 'stellar-forge.runtime-deployment-handoff.v1';
  directory: string; installationId: string; profileId: string; sourceCommit: string;
  sourceManifestSha256: string; lockSha256: string | null;
  [key: string]: unknown;
}
export interface ProductPlanHandoff {
  schema: typeof PRODUCT_PLAN_HANDOFF_SCHEMA; generatedAt: string; workspaceId: string;
  planId: string; bindingId: string; sourceCommit: string; selection: string;
  planContentSha256: string; sourceSha256: string; reviewId: string; requestId: string; selectionSha256: string;
  archive: { file: string; bytes: number; sha256: string; archiveId: string | null };
  runtime: { runtimeId: string; label: string; directory: string; installationId: string;
    profileId: string; sourceManifestSha256: string; status: string; lockSha256: string | null; sourceVerified: true };
  inspection: OriginalRuntimeInspection; handoff: OriginalRuntimeHandoff;
}
export interface ProductPlanInstallationSummary {
  observedAt: string; runtimeId: string; label: string; installationId: string; profileId: string;
  sourceManifestSha256: string; status: string; lockSha256: string | null; sourceVerified: boolean;
  archiveSha256: string; nativeRequired: boolean; loadRequested: boolean;
  dependencies: { name: string; expectedVersion: string; requested: unknown; ready: boolean; native: string | null;
    checks: { group: string; probe: string; version: string | null; state: string;
      importState: string | null; importCode: string | null; native?: { state: string; kind?: string } }[] }[];
}
export function selectedProductPlanBuild(view: ProductPlanView, options?: { builds?: ProductBuildState[] }): ProductBuildState | null;
export function productPlanRuntimes(view: ProductPlanView, state: RuntimeWorkspaceSnapshot,
  options?: { builds?: ProductBuildState[] }): ProductPlanRuntimes;
export function productPlanHandoff(view: ProductPlanView, options: {
  runtime: { id: string; label: string; directory: string }; installation: OriginalRuntimeInstallation;
  inspection: OriginalRuntimeInspection; handoff: OriginalRuntimeHandoff; generatedAt?: string;
}): ProductPlanHandoff;
export function productPlanInstallationSummary(view: ProductPlanView, value: ProductPlanHandoff): ProductPlanInstallationSummary;
