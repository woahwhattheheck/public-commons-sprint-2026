export type RequirementKind = 'command' | 'application' | 'merchant' | 'export' | 'feature' | 'source';
export type RequirementOrder = 'source' | 'coverage' | 'runtime-groups' | 'commands';
export type Requirement = `${RequirementKind}:${string}`;
export interface CapabilitySource { id: string; path: string; kind: 'base' | 'contribution' }
export interface CapabilityDeclaration {
  id: Requirement; kind: RequirementKind; name: string; provision: 'registration'; sources: CapabilitySource[];
}
export interface CapabilityCounts {
  commands: number; applications: number; merchantProviders: number; exports: number;
  runtimeGroups: number; components: number; sources: number;
}
export interface ProductRecord {
  id: string | null; title: string; description?: string; path?: string | null; available: boolean;
  requirements?: Requirement[]; capabilityDeclarations?: CapabilityDeclaration[]; capabilityCounts?: CapabilityCounts;
  capabilityError?: { code: string; message: string };
  [key: string]: unknown;
}
export interface ProductCatalog<T extends ProductRecord = ProductRecord> {
  repository: string; sourceCommit: string; offline: boolean; products: T[];
  capabilities?: { id: Requirement; kind: RequirementKind; name: string; products: number }[];
}
export interface RequirementOptions {
  requirements?: Requirement[]; match?: 'all' | 'any'; sort?: RequirementOrder;
}
export interface RequirementMatch {
  covered: Requirement[]; missing: Requirement[]; complete: boolean; declarations: CapabilityDeclaration[];
}
export interface RequirementResult<T extends ProductRecord = ProductRecord> {
  schema: 'stellar-forge.product-requirements.v1';
  requirements: Requirement[]; match: 'all' | 'any'; sort: RequirementOrder; total: number;
  products: (T & { requirementMatch: RequirementMatch })[];
  unread: { id: string | null; title: string; error: { code: string; message: string } }[];
}
export interface SourceReviewRequest {
  repository: string; ref: string; selection: string; offline: boolean; python: string;
}
export type RequirementPlan<T extends ProductRecord = ProductRecord> = Omit<RequirementResult<T>, 'products'> & {
  repository: string; sourceCommit: string; offline: boolean; allMatchesExported: true;
  products: (T & { requirementMatch: RequirementMatch; reviewRequest?: SourceReviewRequest })[];
};
export const PRODUCT_REQUIREMENTS_SCHEMA: 'stellar-forge.product-requirements.v1';
export const REQUIREMENT_KINDS: readonly RequirementKind[];
export const REQUIREMENT_SORTS: readonly RequirementOrder[];
export function normalizeProductRequirements(requirements?: Requirement[]): Requirement[];
export function describeProductRequirements(distribution: {
  spec: Record<string, unknown>; sources: { id: string; path: string }[]; origins?: Record<string, unknown>;
}): { requirements: Requirement[]; capabilityDeclarations: CapabilityDeclaration[]; capabilityCounts: CapabilityCounts };
export function productRequirementIndex(products: ProductRecord[]): NonNullable<ProductCatalog['capabilities']>;
export function matchProductRequirements<T extends ProductRecord>(products: T[], options?: RequirementOptions): RequirementResult<T>;
export function exportRequirementPlan<T extends ProductRecord>(catalog: ProductCatalog<T>, options?: RequirementOptions): RequirementPlan<T>;
export function productReviewRequest(catalog: ProductCatalog, id: string, options?: {
  python?: string; requirements?: Requirement[];
}): SourceReviewRequest;
