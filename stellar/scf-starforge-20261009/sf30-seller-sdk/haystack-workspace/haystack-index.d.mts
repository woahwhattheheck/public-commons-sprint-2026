import type { HaystackDiagnostic, HaystackDict, HaystackGrid } from './haystack-types.mjs';

export type HaystackRole = 'site' | 'equip' | 'point' | 'space' | 'system' |
  'device' | 'weatherStation' | 'weather';
export interface HaystackSourceInput {
  sourceId: string;
  grid: HaystackGrid;
}
export interface HaystackRecord {
  key: string;
  sourceId: string;
  rowIndex: number;
  tags: HaystackDict;
  id: string | null;
  display: string;
  roles: HaystackRole[];
  siteRef: string | null;
  equipRef: string | null;
  kind: string | null;
  unit: string | null;
  markers: string[];
  outgoingRelationIds: string[];
  diagnosticIds: string[];
  refCount: number;
}
export interface HaystackRelation {
  id: string;
  sourceId: string;
  fromKey: string;
  tag: string;
  path: string;
  targetId: string;
  targetKeys: string[];
  state: 'resolved' | 'unresolved' | 'ambiguous';
  crossSourceCandidateKeys: string[];
  suppliedDisplay?: string;
}
export interface HaystackNestedGrid {
  sourceId: string;
  fromKey: string;
  tag: string;
  path: string;
  rowCount: number;
  columnCount: number;
}
export interface HaystackAnalysis {
  records: HaystackRecord[];
  relations: HaystackRelation[];
  diagnostics: HaystackDiagnostic[];
  counts: {
    sources: number;
    records: number;
    identifiedRecords: number;
    anonymousRecords: number;
    sites: number;
    equips: number;
    points: number;
    spaces: number;
    systems: number;
    devices: number;
    weatherStations: number;
    weatherPoints: number;
    relations: number;
    resolvedRelations: number;
    unresolvedRelations: number;
    ambiguousRelations: number;
    crossSourceCandidateRelations: number;
    nestedGrids: number;
    diagnostics: number;
    errors: number;
    warnings: number;
    info: number;
    byRole: Record<HaystackRole, number>;
  };
  sources: { sourceId: string; rowCount: number; columnCount: number; meta: HaystackDict }[];
  nestedGrids: HaystackNestedGrid[];
}
export function analyzeGrids(inputs?: HaystackSourceInput[]): HaystackAnalysis;
