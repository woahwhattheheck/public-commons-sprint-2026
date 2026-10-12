export type CatalogKind = 'command' | 'source' | 'feature' | 'export' | 'application' | 'merchant';
export interface CatalogPackage {
  name: string; version: string; sourceCommit: string | null;
  sourceSelection: { id: string; title: string } | null;
}
export interface CatalogItem {
  id: string; kind: CatalogKind; name: string; description: string;
  sourceIds: string[]; featureIds: string[];
  entry?: string; path?: string; aliases?: string[]; helpArgv?: string[];
  target?: string | { [condition: string]: unknown };
  commands?: string[]; exports?: string[]; applications?: string[]; merchantProviders?: string[];
  packagePath?: string | null; packageRead?: 'direct' | 'read' | 'not-read' | 'unavailable'; error?: string;
  dependencies?: Array<{ name: string; version: string; probe: string; native?: string }>;
}
export interface CommandCatalog {
  schema: 'stellar-forge.operator-discovery.v1'; package: CatalogPackage; capturedAt: string | null;
  counts: Record<CatalogKind, number>;
  sources: Array<{ id: string; description: string; path: string }>;
  featureNames: string[]; items: CatalogItem[];
}
export interface CatalogFilters {
  query?: string; kind?: CatalogKind | 'all'; source?: string; feature?: string;
}
export interface CatalogSearch extends CatalogFilters { page?: number; pageSize?: number }
export interface CatalogResult {
  schema: 'stellar-forge.operator-discovery-search.v1'; package: CatalogPackage; capturedAt: string | null;
  query: string; filters: { kind: CatalogKind | 'all'; source: string; feature: string };
  total: number; items: CatalogItem[]; complete?: true;
  counts?: Record<CatalogKind, number>; page?: number; pageSize?: number; pages?: number;
}
export const CATALOG_SCHEMA: 'stellar-forge.operator-discovery.v1';
export const SEARCH_SCHEMA: 'stellar-forge.operator-discovery-search.v1';
export const KINDS: readonly CatalogKind[];
export function buildCommandCatalog(distribution: {
  spec: Record<string, any>; origins: Record<string, any>;
  sources: Array<{ id: string; path: string; description: string }>;
  manifest?: { packageVersion?: string; sourceCommit?: string } | null;
  selection?: { id: string; title: string };
}, options?: { featurePackages?: Record<string, { dependencies?: Record<string, string>; error?: string }>;
  capturedAt?: string | null }): CommandCatalog;
export function tokenizeQuery(query?: string): string[];
export function searchCommandCatalog(catalog: CommandCatalog, options?: CatalogSearch): CatalogResult;
export function exportCommandCatalog(catalog: CommandCatalog, options?: CatalogFilters): CatalogResult;
export function findCatalogItem(catalog: CommandCatalog, id: string): CatalogItem;
export function renderCatalogText(result: CatalogResult): string;
