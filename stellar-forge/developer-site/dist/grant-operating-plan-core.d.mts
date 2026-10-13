import type { OperatingPlanReturn } from
  '../../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan-return.mjs';
export const GRANT_OPERATING_REVIEW_RECEIPT_SCHEMA: 'stellar-forge.grant-operating-review-receipt.v1';
export type GrantOperatingReturnInput = OperatingPlan | OperatingPlanReturn;
export interface GrantOperatingReviewedReturn {
  schema: typeof GRANT_OPERATING_REVIEW_RECEIPT_SCHEMA;
  at: string; filename: string; note: string; resultRevision: number; review: OperatingPlanReturn;
}
export function grantOperatingReturnInput(value: unknown):
  { plan: OperatingPlan; reviewedReturn: OperatingPlanReturn | null };
import type { OperatingPlan, OperatingRegistration, OperatingStep, OperatingStepState, OperatingFileComparison } from
  '../../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan.mjs';
export const GRANT_OPERATING_SELECTION_SCHEMA: 'stellar-forge.grant-operating-selection.v1';
export const GRANT_OPERATING_PREPARATION_SCHEMA: 'stellar-forge.grant-operating-preparation.v1';
export const GRANT_OPERATING_CONTINUATION_SCHEMA: 'stellar-forge.grant-operating-continuation.v1';
export const GRANT_OPERATING_RETURN_COMPARISON_SCHEMA: 'stellar-forge.grant-operating-return-comparison.v1';
export const GRANT_OPERATING_RETURN_DRAFT_SCHEMA: 'stellar-forge.grant-operating-return-draft.v1';
export interface NativeGrantPlanningSource {
  schema: 'stellar-forge.grant-plan-source.v1'; sha256: string; filename: string;
  receivedAt: string; bytes: number; base64: string; kind: 'json' | 'zip';
  document: { id: string; name: string; currentRevision: number; revisions: Array<Record<string, any>> };
}
export interface NativeGrantPlanningReview {
  schema: 'stellar-forge.grant-plan-review.v1'; sourceSha: string; revision: number;
  costIds: string[]; note: string; previewText: string; previewBasis: string;
  summaryReviewed: boolean; applications: Array<Record<string, unknown>>;
  operatingSelection?: GrantOperatingSelection;
}
export interface GrantOperatingSelection {
  schema: typeof GRANT_OPERATING_SELECTION_SCHEMA; sourceSha256: string; revision: number;
  title: string; customer: string; purpose: string; owner: string; receiving: string; notes: string;
  bindings: Record<string, OperatingRegistration | null>; prepared: GrantOperatingPreparation[];
  returnDraft?: GrantOperatingReturnDraft | null;
}
export interface GrantOperatingPreparation {
  schema: typeof GRANT_OPERATING_PREPARATION_SCHEMA;
  source: { filename: string; sha256: string; bytes: number; planId: string; planName: string;
    revision: number; contentSha256: string; scenarioSourceSha256: string; scenarioCalculationSha256: string };
  packageIds: string[];
  totals: { plannedUsd: string; estimatedHours: string | null; awardRequestUsd: string; projectEndDay: number };
  plan: OperatingPlan;
  continuation?: GrantOperatingContinuation;
  reviewedReturns?: GrantOperatingReviewedReturn[];
}
export function newGrantOperatingSelection(source: NativeGrantPlanningSource, revision?: number): GrantOperatingSelection;
export function validateGrantOperatingSelection(value: unknown, source: NativeGrantPlanningSource, revision: number): GrantOperatingSelection;
export function grantOperatingSelectionOf(review: NativeGrantPlanningReview, source: NativeGrantPlanningSource): GrantOperatingSelection;
export function prepareGrantOperatingPlan(source: NativeGrantPlanningSource, review: NativeGrantPlanningReview,
  options: { id: string; savedAt?: string; selection?: GrantOperatingSelection }): GrantOperatingPreparation;

export interface GrantOperatingContinuation {
  schema: typeof GRANT_OPERATING_CONTINUATION_SCHEMA;
  plan: OperatingPlan;
  receipts: Array<{ at: string; filename: string; note: string; fromRevision: number; toRevision: number }>;
}
export interface GrantOperatingReturnedPackage {
  packageId: string; stepId: string; native: Record<string, any>;
  original: OperatingStep; previous: OperatingStep | null; returned: OperatingStep | null;
  status: OperatingStepState | 'missing'; changedFromPrepared: string[]; changedFromPrevious: string[];
  filesFromPrepared: OperatingFileComparison; filesFromPrevious: OperatingFileComparison;
}
export interface GrantOperatingReturnComparison {
  schema: typeof GRANT_OPERATING_RETURN_COMPARISON_SCHEMA;
  planId: string; source: GrantOperatingPreparation['source']; packageIds: string[];
  totals: GrantOperatingPreparation['totals']; preparedRevision: number; previousRevision: number;
  incomingRevision: number; selectedRevision: number; addedRevisions: number; reused: boolean;
  reviewedReturn: null | { id: string; reviewer: string; notes: string; completedAt: string;
    currentRevision: number; incomingRevision: number; resultRevision: number; decisions: number; retained: boolean };
  originalTitle: string; previousTitle: string; incomingTitle: string;
  stepOrder: {
    prepared: GrantOperatingStepPosition[]; previous: GrantOperatingStepPosition[]; returned: GrantOperatingStepPosition[];
    changedFromPrepared: boolean; changedFromPrevious: boolean; addedIds: string[]; removedIds: string[];
  };
  planChanges: Array<{ field: string; original: string; previous: string; returned: string }>;
  packages: GrantOperatingReturnedPackage[]; additionalSteps: OperatingStep[];
  counts: Record<OperatingStepState | 'missing', number>;
}
export function grantOperatingContinuationPlan(prepared: GrantOperatingPreparation): OperatingPlan;
export function compareGrantOperatingReturn(source: NativeGrantPlanningSource,
  review: NativeGrantPlanningReview, incoming: GrantOperatingReturnInput): GrantOperatingReturnComparison;
export function receiveGrantOperatingReturn(source: NativeGrantPlanningSource,
  review: NativeGrantPlanningReview, incoming: GrantOperatingReturnInput, options?: {
    at?: string; filename?: string; note?: string; expectedRevision?: number;
  }): { review: NativeGrantPlanningReview; comparison: GrantOperatingReturnComparison;
    reused: boolean; addedRevisions: number; reviewAdded: boolean };

export interface GrantOperatingStepPosition { id: string; title: string; position: number; }
export interface GrantOperatingReturnDraft {
  schema: typeof GRANT_OPERATING_RETURN_DRAFT_SCHEMA;
  sourceSha256: string; nativeRevision: number; planId: string;
  incoming: OperatingPlan; reviewedReturn?: OperatingPlanReturn; filename: string; note: string; openedAt: string; comparedRevision: number;
}
export function stageGrantOperatingReturn(source: NativeGrantPlanningSource, review: NativeGrantPlanningReview,
  incoming: GrantOperatingReturnInput, options?: { filename?: string; note?: string; openedAt?: string }):
  { review: NativeGrantPlanningReview; comparison: GrantOperatingReturnComparison };
export function refreshGrantOperatingReturn(source: NativeGrantPlanningSource, review: NativeGrantPlanningReview):
  { review: NativeGrantPlanningReview; comparison: GrantOperatingReturnComparison };
export function closeGrantOperatingReturn(source: NativeGrantPlanningSource, review: NativeGrantPlanningReview): NativeGrantPlanningReview;
