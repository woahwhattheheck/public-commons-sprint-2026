import { LineageClient } from "./client.js";
import type { Mutation } from "./client.js";

export type QualitySeverity = "error" | "warning" | "info";
export type QualityScope = "dataset" | "input" | "output";
export type QualityStatus = "pass" | "fail" | "unknown";
export type QualityDecision = "open" | "investigating" | "accepted" | "resolved";
export type QualityRecordCollection = "qualityRules" | "qualityEvaluations" | "qualityDispositions";
export type QualityDirection = "input" | "output" | "dataset";
export type QualityOperator = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "between";
export interface QualitySelection { edition?: string; datasetKey?: string; runKey?: string; }
export interface QualityIdentity { workspaceId: string; revision: number; edition: string | null; }
export interface QualitySource { sourceId: string; line?: number; index?: number; [key: string]: unknown; }
export interface QualityMetric { path: string; value: unknown; valid: boolean; reason?: string; }
export interface QualityAssertion {
  id: string;
  index: number;
  assertion: string | null;
  name: string;
  column: string | null;
  success: boolean | null;
  severity: QualitySeverity | string | null;
  expected?: string | null;
  actual?: string | null;
  query?: string | null;
  path: string;
  contentType: string | null;
  description: string | null;
  valid: boolean;
  diagnostics: string[];
  original: unknown;
}
export interface QualityObservation {
  id: string;
  eventId: string;
  eventTime: unknown;
  eventType: unknown;
  runKey: string | null;
  jobKey: string | null;
  datasetKey: string;
  namespace: string;
  name: string;
  direction: QualityDirection;
  scope: QualityScope;
  sequence: number;
  datasetPath: string;
  adapter: string | null;
  expectedScope: QualityScope | null;
  recognized: boolean;
  facetName: string;
  path: string;
  schemaURL: unknown;
  producer: unknown;
  deleted: boolean;
  schemaStatus: "recognized" | "unsupported" | "invalid";
  diagnostics: string[];
  metrics: QualityMetric[];
  assertions: QualityAssertion[];
  sources: QualitySource[];
  facet: unknown;
}
export interface QualityRuleBase {
  id?: string;
  version?: number;
  title: string;
  datasetKey: string;
  enabled?: boolean;
  severity: QualitySeverity;
  scope: QualityScope | "any";
  missing: "unknown" | "fail";
}
export interface QualityMetricRuleInput extends QualityRuleBase {
  kind: "metric";
  metricPath: string;
  operator: QualityOperator;
  value: number;
  upper?: number;
}
export interface QualityAssertionRuleInput extends QualityRuleBase {
  kind: "assertion";
  assertion: { name: string; column?: string | null; };
  expectedSuccess: boolean;
}
export type QualityRuleInput = QualityMetricRuleInput | QualityAssertionRuleInput;
export type QualityRuleVersion = QualityRuleInput & {
  id: string;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type QualityRule = QualityRuleVersion & { history: QualityRuleVersion[]; };
export interface QualityFinding {
  id: string;
  ruleId: string | null;
  ruleVersion: number | null;
  title: string;
  datasetKey: string;
  namespace: string;
  name: string;
  eventTime: unknown;
  eventType: unknown;
  scope: QualityScope | null;
  direction: QualityDirection;
  schemaURL: unknown;
  reportedSeverity?: string | null;
  assertion?: QualityAssertion;
  runKey: string | null;
  jobKey: string | null;
  eventId: string | null;
  observationId: string | null;
  facetPath: string | null;
  status: QualityStatus;
  severity: QualitySeverity | string;
  expected: unknown;
  actual: unknown;
  message: string;
  sources: QualitySource[];
}
export interface QualityEvaluation extends QualityIdentity {
  schema: "commons.openlineage.quality.evaluation.v1";
  datasetKey: string | null;
  runKey: string | null;
  contentSha256?: string;
  adapterVersion: number;
  upstreamCommit: string;
  selectionSha256: string;
  ruleSetSha256: string;
  sourceIds: string[];
  id: string | null;
  title?: string;
  createdAt: string;
  summary: { pass: number; fail: number; unknown: number; total: number; };
  findings: QualityFinding[];
  ruleVersions: QualityRuleVersion[];
  eventIds: string[];
}
export type SavedQualityEvaluation = QualityEvaluation & { id: string; title: string; contentSha256: string; };
export interface QualityDispositionVersion {
  id: string;
  evaluationId: string;
  findingId: string;
  decision: QualityDecision;
  reason: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  revision: number;
}
export interface QualityDisposition extends QualityDispositionVersion { history: QualityDispositionVersion[]; }
export interface QualityDatasetSummary {
  datasetKey: string;
  namespace: string;
  name: string;
  observationCount: number;
  metricCount: number;
  assertionCount: number;
  failureCount: number;
  latestAt: string | null;
}
export interface QualitySavedRecords {
  rules: QualityRule[];
  evaluations: SavedQualityEvaluation[];
  dispositions: QualityDisposition[];
}
export interface QualityOverview extends QualityIdentity, QualitySavedRecords {
  datasets: QualityDatasetSummary[];
  counts: { datasets: number; observations: number; metrics: number; assertions: number; failedAssertions: number; invalidFacets: number; };
}
export interface QualityHistory extends QualityIdentity, QualitySavedRecords {
  datasetKey: string | null;
  runKey: string | null;
  observations: QualityObservation[];
}
export interface QualityMutationResult { revision: number; operationId?: string; workspaceId?: string; replayed?: boolean; }
export interface QualityReport { mediaType: string; text: string; revision: number; workspaceId: string; evaluationId: string | null; }
export class QualityClient extends LineageClient {
  qualityOverview(options?: QualitySelection): Promise<QualityOverview>;
  qualityHistory(datasetKey: string, options?: Omit<QualitySelection, "datasetKey">): Promise<QualityHistory>;
  saveQualityRule(args: Mutation & { rule: QualityRuleInput }): Promise<QualityMutationResult & { rule: QualityRule }>;
  evaluateQuality(options?: QualitySelection): Promise<QualityEvaluation>;
  saveQualityEvaluation(args: Mutation & QualitySelection & { title: string; expectedSelectionHash?: string; expectedRulesHash?: string }): Promise<QualityMutationResult & { evaluation: SavedQualityEvaluation }>;
  saveQualityDisposition(args: Mutation & { evaluationId: string; findingId: string; decision: QualityDecision; reason: string }): Promise<QualityMutationResult & { disposition: QualityDisposition }>;
  qualityReport(options?: QualitySelection & { evaluationId?: string; format?: "json" | "csv" | "html" }): Promise<QualityReport>;
}
