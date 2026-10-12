export interface RuntimeLockInput {
  dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>;
}
export interface LockedDependency {
  location: string; name: string; version: string; direct: boolean; linkTarget?: string;
  integrity?: string; optional?: boolean; os?: string[]; cpu?: string[];
}
export interface DependencyEdge {
  from: string; name: string; requested: string; kind: 'direct' | 'dependency' | 'optional' | 'peer';
  location?: string; reason?: string;
}
export type RuntimeDependencyLock =
  { status: 'unsupported' | 'mismatched'; reason: string } |
  { status: 'resolved' | 'incomplete'; scope: 'committed-production-lock'; lockfileVersion: 2 | 3;
    instances: LockedDependency[]; packages: { name: string; version: string; locations: string[] }[];
    counts: { instances: number; packages: number; directInstances: number; transitiveInstances: number };
    unresolved: DependencyEdge[]; optionalOmissions: DependencyEdge[] };
export function inspectRuntimeDependencyLock(manifest: RuntimeLockInput, lock: unknown): RuntimeDependencyLock;
