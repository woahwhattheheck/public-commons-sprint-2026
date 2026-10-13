import { LineageClient } from "./client.js";
import type { Mutation } from "./client.js";

export interface ServicePolicyInput {
  id?: string | null;
  title: string;
  jobKey: string;
  owner?: string;
  runbook?: string;
  enabled?: boolean;
  effectiveFrom: string;
  maxCompletionAgeSeconds?: number | null;
  maxDurationSeconds?: number | null;
  failureWindowSeconds?: number;
  monitorFailures?: boolean;
}
export interface ServicePolicy extends Required<ServicePolicyInput> {
  id: string;
  version: number;
  reason: string;
  createdAt: string;
  updatedAt: string;
  history: Omit<ServicePolicy, "history">[];
}
export type ServiceCondition = "completion-stale" | "completion-unobserved" | "run-failed" | "run-aborted" | "run-overdue" | "run-duration-exceeded";
export interface ServiceFinding {
  id: string;
  policyId: string;
  policyVersion: number;
  jobKey: string;
  runKey: string | null;
  kind: ServiceCondition;
  summary: string;
  owner: string;
  runbook: string;
  eventIds: string[];
  sourceIds: string[];
  asOf: string;
  observedAt: string | null;
  dueAt: string | null;
  measuredSeconds: number | null;
  thresholdSeconds: number | null;
}
export interface ServiceObservation {
  policyId: string;
  policyVersion: number;
  title: string;
  jobKey: string;
  owner: string;
  runbook: string;
  enabled: boolean;
  state: "satisfied" | "violated" | "awaiting-observation" | "disabled" | "not-started";
  lastCompletedAt: string | null;
  lastCompletedRunKey: string | null;
  observedRuns: number;
  activeRuns: number;
  findingIds: string[];
  notes: string[];
}
export interface ServiceAssessment {
  schema: "commons.openlineage.service-level-assessment.v1";
  evaluationVersion?: 1 | 2;
  workspaceId: string;
  sourceRevision: number;
  editionId: string | null;
  asOf: string;
  eventIds: string[];
  sourceIds: string[];
  policySnapshots: (Required<ServicePolicyInput> & { id: string; version: number })[];
  observations: ServiceObservation[];
  findings: ServiceFinding[];
  coverage: {
    selectedEvents: number;
    eligibleEvents: number;
    projectedEvents: number;
    excludedFutureEvents: number;
    invalidTimeEvents: number;
    diagnostics: { eventId: string; messages: string[] }[];
  };
}
export interface SavedServiceAssessment {
  id: string;
  createdAt: string;
  appliedToIncidents: boolean;
  assessmentSha256: string;
  assessment: ServiceAssessment;
}
export interface ServiceIncident {
  id: string;
  policyId: string;
  status: "open" | "acknowledged" | "resolved" | "accepted";
  active: boolean;
  owner: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastEvaluatedAt: string;
  firstAssessmentId: string;
  lastAssessmentId: string;
  lastObservedAssessmentId: string;
  originalFinding: ServiceFinding;
  latestFinding: ServiceFinding;
  history: {
    at: string;
    action: string;
    assessmentId: string;
    reason?: string;
    owner?: string;
    before?: { status: string; owner: string };
    after?: { status: string; owner: string };
  }[];
}
export interface ServiceLevels {
  schema: "commons.openlineage.service-levels.v1";
  workspaceId: string;
  revision: number;
  policies: ServicePolicy[];
  assessments: SavedServiceAssessment[];
  incidents: ServiceIncident[];
}
export interface ServiceMutationResult { workspaceId: string; revision: number; operationId: string; replayed?: boolean; }
export class ServiceLevelClient extends LineageClient {
  serviceLevels(): Promise<ServiceLevels>;
  saveServicePolicy(args: Mutation & { policy: ServicePolicyInput; reason: string }): Promise<ServiceMutationResult & { policy: ServicePolicy }>;
  evaluateServiceLevels(args: { asOf: string; editionId?: string | null }): Promise<ServiceAssessment>;
  saveServiceAssessment(args: Mutation & { asOf: string; editionId?: string | null; applyToIncidents?: boolean }): Promise<ServiceMutationResult & { assessment: SavedServiceAssessment; incidentCount: number }>;
  reviewServiceIncident(args: Mutation & { id: string; decision: "acknowledge" | "assign" | "resolve" | "accept" | "reopen"; reason: string; owner?: string }): Promise<ServiceMutationResult & { incident: ServiceIncident }>;
  serviceLevelReport(args?: { assessmentId?: string | null; format?: "json" | "csv" | "html" }): Promise<{ mediaType: string; text: string }>;
}
