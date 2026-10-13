import type { JSONValue, DecisionChoice, DecisionContext, CapabilityFit, DecisionContextComparison } from './bidder-desk-domain.mjs';

export const DECISION_REPORT_SCHEMA: 'starforge.canadabuys.decision-report.v1';
export const DECISION_REPORT_FORMATS: readonly DecisionReportFormat[];
export type DecisionReportFormat = 'json' | 'html' | 'csv';
export interface DecisionNextAction {
  id: string;
  task: string;
  owner: string;
  dueAt: string | null;
  status: string;
  [field: string]: unknown;
}
export interface DecisionReportRecord {
  id: string;
  noticeId: string;
  revision: number;
  sourceEntryId: string;
  profileId: string;
  profileRevision: number;
  contextSha256: string;
  choice: DecisionChoice;
  rationale: string;
  owner: string;
  nextActions: DecisionNextAction[];
  unknowns: string[];
  conditions: JSONValue;
  reviewedBy: string;
  reviewedAt: string;
  createdAt: string;
  updatedAt: string;
  operator: JSONValue;
  [field: string]: unknown;
}
export interface DecisionReportEnvelope {
  decision: DecisionReportRecord;
  context: DecisionContext;
  assessment?: CapabilityFit | null;
  changes?: DecisionContextComparison | null;
  /** Unknown saved metadata stays present in the complete JSON export and typed CSV sections. */
  [field: string]: unknown;
}
/**
 * Returns UTF-8 text. HTML escapes original publisher/user content; CSV is RFC4180-style with
 * CRLF rows and formula-safe display cells. JSON retains the complete saved envelope.
 * This function never reads current workspace data, evaluates a replacement clock or writes a file.
 */
export function renderDecisionReport(envelope: DecisionReportEnvelope, options?: { format?: DecisionReportFormat }): string;
