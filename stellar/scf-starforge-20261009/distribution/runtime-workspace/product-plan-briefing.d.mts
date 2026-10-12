import type { ProductPlanView } from './source-product-plans.mjs';
import type { ProductPlanHandoff, ProductPlanInstallationSummary } from './product-plan-runtime.mjs';
import type { SourceDescriptor } from '../discovery/product-requirements-source.mjs';
import type { CapabilityDeclaration } from '../discovery/product-requirements.mjs';

export const PRODUCT_PLAN_BRIEFING_SCHEMA: 'stellar-forge.product-plan-briefing.v1';
export type ProductPlanBriefingFormat = 'json' | 'markdown' | 'html';
export const PRODUCT_PLAN_BRIEFING_FORMATS: readonly ProductPlanBriefingFormat[];
export interface BriefingBuild {
  phase: string; stage: string | null; reviewId: string; requestId: string;
  sourceCommit: string; archiveId: string | null;
  archive: { file: string; bytes: number; sha256: string } | null;
  errorCode: string | null;
}
export interface BriefingDependencyEdge {
  from: string; name: string; requested: string; kind: string; location?: string; reason?: string;
}
export interface BriefingRuntimeGroup {
  name: string; status: string; manifestPath: string | null;
  manifest: SourceDescriptor | null; lock: SourceDescriptor | null; lockfileVersion: number | null;
  reason: string | null;
  declarations: { name: string; requested: string; probe: string | null; native: string | null }[];
  instances: { name: string; version: string; location: string; direct: boolean; optional: boolean;
    linkTarget?: string; integrity?: string; os?: string[]; cpu?: string[] }[];
  unresolved: BriefingDependencyEdge[]; optionalOmissions: BriefingDependencyEdge[];
  errors: { code: string; path: string }[];
  counts: { declared: number; instances: number; directInstances: number; transitiveInstances: number };
}
export interface ProductPlanBriefing {
  schema: typeof PRODUCT_PLAN_BRIEFING_SCHEMA; generatedAt: string;
  plan: { planId: string; label: string; purpose: string; createdAt: string; contentSha256: string; sourceSha256: string };
  product: {
    selection: string; title: string; description: string; sourceCommit: string;
    packageName: string; packageVersion: string; readme: string | null;
    counts: { commands: number; exports: number; applications: number; merchantProviders: number;
      components: number; features: number; nativeDependencies: number };
    commands: { name: string; entry: string }[];
    exports: { name: string; entry: unknown }[];
    applications: string[]; merchantProviders: string[]; components: string[];
    contributions: { id: string; path: string }[]; sourceInputs: SourceDescriptor[];
  };
  capabilities: CapabilityDeclaration[]; dependencies: BriefingRuntimeGroup[];
  review: { reviewId: string; requestId: string; selectionSha256: string; reviewedAt: string;
    bindingId: string; inspectedAt: string };
  build: BriefingBuild | null; installation: ProductPlanInstallationSummary | null;
  origins: { originId: string; local: boolean; selected: boolean; recordedAt: string;
    reviewId: string; requestId: string; build: BriefingBuild | null }[];
  observations: { originId: string; observedAt: string; build: BriefingBuild | null }[];
}
export interface ProductPlanBriefingExport {
  schema: typeof PRODUCT_PLAN_BRIEFING_SCHEMA; planId: string; bindingId: string; sourceCommit: string;
  generatedAt: string; format: ProductPlanBriefingFormat; filename: string; mimeType: string; content: string; runtimeId?: string;
}
export function productPlanBriefing(view: ProductPlanView, options?: { generatedAt?: string; installation?: ProductPlanHandoff }): ProductPlanBriefing;
export function formatProductPlanBriefingMarkdown(value: ProductPlanBriefing): string;
export function formatProductPlanBriefingHTML(value: ProductPlanBriefing): string;
export function exportProductPlanBriefing(view: ProductPlanView, options?: {
  format?: ProductPlanBriefingFormat; generatedAt?: string; installation?: ProductPlanHandoff;
}): ProductPlanBriefingExport;
