import { QualityClient } from "./quality-client.mjs";
import type { Mutation } from "./client.js";
import type { QualityFinding, QualityRuleVersion, SavedQualityEvaluation, QualityDisposition,
  QualityDispositionVersion, QualityDecision, QualityMutationResult } from "./quality-client.mjs";
export interface QualityRunPair { beforeRunKey: string; afterRunKey: string; }
export interface QualityFindingPair { beforeFindingId: string; afterFindingId: string; }
export interface QualityComparisonSelection {
  beforeEvaluationId: string; afterEvaluationId: string;
  runPairs?: QualityRunPair[]; findingPairs?: QualityFindingPair[];
}
export interface QualityComparisonSource {
  id: string; title: string; contentSha256: string; revision: number; edition: string | null;
  datasetKey: string | null; runKey: string | null; createdAt: string; selectionSha256: string;
  ruleSetSha256: string; adapterVersion: number; upstreamCommit: string; eventIds: string[]; sourceIds: string[]; ruleVersions: QualityRuleVersion[];
  runs: {runKey: string; jobKey: string | null}[];
}
export interface QualityComparisonRow {
  id: string; kind: "matched" | "before-only" | "after-only" | "ambiguous";
  method: "explicit" | "unique-original-identity" | null;
  before: QualityFinding[]; after: QualityFinding[]; candidates: QualityFindingPair[];
  changes: string[]; definitionChanged: boolean; beforeRule: QualityRuleVersion | null;
  afterRule: QualityRuleVersion | null; statusTransition: string | null; outcomeChanged: boolean; valueChanged: boolean;
}
export interface QualityComparison {
  schema: "commons.openlineage.quality-comparison.v1"; workspaceId: string; revision: number;
  before: QualityComparisonSource; after: QualityComparisonSource;
  runPairs: QualityRunPair[]; findingPairs: QualityFindingPair[]; rows: QualityComparisonRow[];
  summary: {matched: number; beforeOnly: number; afterOnly: number; ambiguous: number;
    changedOutcomes: number; changedDefinitions: number; beforeFindings: number; afterFindings: number};
  selectionChanges: {adapterChanged: boolean; upstreamChanged: boolean; filtersChanged: boolean; events: QualitySetChange; sources: QualitySetChange; rules: QualitySetChange};
  comparisonSha256: string;
}
export interface QualitySetChange {added: string[]; removed: string[]; retained: string[];}
export interface SavedQualityComparison extends QualityComparison {
  id: string; title: string; createdAt: string; contentSha256: string;
}
export interface EarlierQualityDisposition {evaluationId: string; findingId: string; version: number;}
export interface QualityFollowupInput {
  id?: string; version?: number; comparisonId: string; rowId: string; decision: QualityDecision; reason: string;
  owner?: string; dueDate?: string | null; evidenceResultIds?: string[]; sourceDisposition?: EarlierQualityDisposition | null;
}
export interface QualityFollowupVersion {
  id: string; version: number; workspaceId: string; revision: number; createdAt: string; updatedAt: string;
  comparisonId: string; comparisonSha256: string; rowId: string; beforeEvaluationId: string;
  beforeFindingId: string | null; afterEvaluationId: string; afterFindingId: string;
  decision: QualityDecision; reason: string; owner: string; dueDate: string | null;
  evidenceResultIds: string[]; sourceDisposition: QualityDispositionVersion | null; contentSha256: string;
}
export interface QualityFollowup extends QualityFollowupVersion {history: QualityFollowupVersion[];}
export interface QualityFollowupOverview {
  workspaceId: string; revision: number; evaluations: QualityComparisonSource[];
  comparisons: SavedQualityComparison[]; followups: QualityFollowup[]; dispositions: QualityDisposition[];
  evidence: Record<string, unknown>[];
}
export interface QualityFollowupReport {workspaceId: string; revision: number; comparisonId: string; mediaType: string; text: string;}
export class QualityFollowupClient extends QualityClient {
  qualityFollowupOverview(): Promise<QualityFollowupOverview>;
  compareSavedQuality(args: QualityComparisonSelection): Promise<QualityComparison>;
  saveQualityComparison(args: Mutation & QualityComparisonSelection & {title: string; expectedComparisonHash: string}):
    Promise<QualityMutationResult & {comparison: SavedQualityComparison}>;
  saveQualityFollowup(args: Mutation & QualityFollowupInput): Promise<QualityMutationResult & {followup: QualityFollowup}>;
  qualityFollowupReport(args: {comparisonId: string; format?: "json" | "csv" | "html"}): Promise<QualityFollowupReport>;
}
