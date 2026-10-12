import type { ProductCatalog, ProductRecord } from './product-requirements.mjs';
import type { RuntimeDependencyLock } from './runtime-dependencies.mjs';
export interface OriginalGitSource {
  commit: string;
  tree: { path: string; blob: string; type: string; mode: string }[];
  readFiles(entries: OriginalGitSource['tree']): Map<string, Uint8Array & { toString(encoding: string): string }>;
}
export interface SourceDescriptor { path: string; gitBlob: string; bytes: number; sha256: string }
export interface RuntimePeer { version: string; probe: string; native?: string }
export interface ProductRuntimeRequirements {
  nativePeers: Record<string, RuntimePeer>; featurePeers: Record<string, Record<string, RuntimePeer>>;
  runtimePackageManifests: Record<string, string>; featureNames: string[];
  resolvedManifestPeers: Record<string, Record<string, RuntimePeer>>;
  manifests: Record<string, SourceDescriptor>;
  dependencyLocks: Record<string, (RuntimeDependencyLock & { source: SourceDescriptor; declared: Record<string, string> }) |
    { status: 'declared'; declared: Record<string, string> } |
    { status: 'unavailable'; path: string; declared: Record<string, string>; error: { code: string; message: string } }>;
  errors: { feature: string; path: string; code: string; message: string }[];
}
export function resolveProductRuntimeRequirements(source: OriginalGitSource, spec: Record<string, unknown>): ProductRuntimeRequirements;
export function enrichProductRequirements<T extends ProductRecord>(source: OriginalGitSource, catalog: ProductCatalog<T>): ProductCatalog<T>;
export function loadProductRequirements(options: { repository: string; ref?: string; offline?: boolean }): Promise<ProductCatalog>;
