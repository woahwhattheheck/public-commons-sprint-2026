/** MIT. Complete original Research eligibility consumer contracts. */
export type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
export interface Actor {id: string; name: string}
export interface Criterion {id: string; name: string; include: string; exclude: string}
export interface Stage {
  id: string; name: string; criterionIds: string[]; reviewerIds: string[];
  minimumDecisions: number; requireFullText: boolean;
}
export interface EligibilityProtocol {
  name: string; criteria: Criterion[]; stages: Stage[]; reviewers: Actor[];
  resolverIds: string[]; exclusionReasons: {id: string; label: string}[];
  disagreementProcedure: string;
}
export type Disposition = 'include' | 'exclude' | 'uncertain' | 'unavailable';
export type Assessment = 'meets' | 'does_not_meet' | 'unclear' | 'not_applicable';
export interface CriterionAnswer {criterionId: string; assessment: Assessment; note?: string}
export interface Basis {
  availability: 'available' | 'unavailable' | 'not_required';
  occurrenceIds?: string[]; locator?: string; note?: string;
}
export interface DecisionData {
  workSetId: string; occurrenceId: string; stageId: string; disposition: Disposition;
  criterionAnswers: CriterionAnswer[]; basis: Basis; reason: string;
  exclusionReasonId?: string; supersedes?: string;
}
export interface ResolutionData {
  workSetId: string; occurrenceId: string; stageId: string;
  mode: 'consensus' | 'adjudication';
  disposition: 'include' | 'exclude' | 'awaiting_information';
  decisionIds: string[]; reason: string; exclusionReasonId?: string;
}
export interface StudyLinkData {
  studyId?: string; name: string; occurrenceIds: string[]; reason: string;
  evidence: {occurrenceId: string; locator: string; note: string}[];
}
export type Classification = 'supports' | 'contradicts' | 'background' | 'unreviewed';
export interface OutcomeData {
  workSetId: string; reason: string;
  outcomes: {occurrenceId: string; resolutionId: string; classification?: Classification; note?: string}[];
}
export type EligibilityAction =
  | {action: 'create-review'; reviewId?: never;
      data: {questionId: string; name: string; description?: string; protocol: EligibilityProtocol}}
  | {action: 'revise-protocol'; reviewId: string; data: {protocol: EligibilityProtocol; reason: string}}
  | {action: 'create-workset'; reviewId: string;
      data: {protocolId: string; name: string; occurrenceIds: string[]; reason: string}}
  | {action: 'decide'; reviewId: string; data: DecisionData}
  | {action: 'resolve'; reviewId: string; data: ResolutionData}
  | {action: 'study-link'; reviewId: string; data: StudyLinkData}
  | {action: 'apply-outcomes'; reviewId: string; data: OutcomeData}
  | {action: 'review-impact'; reviewId: string;
      data: {impactId: string; disposition: 'reviewed' | 'needs_review' | 'out_of_scope'; reason: string; workSetId?: string}};
export type EligibilityRequest = {
  requestId: string; expectedRevision: number; actor: Actor;
} & EligibilityAction;
export type EligibilitySection = 'overview' | 'reviews' | 'occurrences' | 'queue' | 'decisions'
  | 'resolutions' | 'studies' | 'impact' | 'operations';
export type EligibilityExportSection = Exclude<EligibilitySection, 'overview' | 'reviews'>;
export interface PageSelection {
  revision?: number; reviewId?: string; workSetId?: string;
  section?: EligibilitySection; offset?: number; limit?: number;
}
export interface SourceOccurrence {
  occurrenceId: string; editionId: string; questionId: string; key: string;
  sourceId: string; title: string; url: string; doi: string | null;
  provider: string; sourceSha256: string; sourceBytes: number; contentDigest: string;
  publishedAt: string | null; sourceReference: string; editionLabel: string;
  selected?: boolean; classification?: Classification; workSetIds?: string[];
}
export interface EligibilityOverview {
  reviewCount: number; protocolCount: number; workSetCount: number;
  reportOccurrenceCount: number; retainedEditionCount: number;
  confirmedStudyCount: number; ungroupedReportCount: number;
  decisionCount: number; resolutionCount: number; appliedOutcomeCount: number;
  unresolvedImpactCount: number; queueAssignmentCount: number;
  includedReportAssignments: number; excludedReportAssignments: number;
  statusCounts: Record<string, number>; exclusionReasonCounts: Record<string, number>;
  stageCounts: {workSetId: string; protocolId: string; stageId: string; stageName: string;
    reports: number; statusCounts: Record<string, number>}[];
  units: Record<string, string>;
}
export interface SavedProtocol {
  id: string; reviewId: string; edition: number; definition: EligibilityProtocol;
  question: {id: string; text: string}; actor: Actor; reason: string;
  createdAt: string; [key: string]: unknown;
}
export interface WorkSet {
  id: string; reviewId: string; protocolId: string; name: string;
  sourceRevision: number; sources: SourceOccurrence[];
  sourceEditionIdsAtCreation: string[]; [key: string]: unknown;
}
export interface EligibilityPage<T = Record<string, unknown>> {
  schema: 'sf88-research-eligibility-view/v1';
  dossier: {id: string; title: string; revision: number};
  reviewId: string | null; workSetId: string | null; section: EligibilitySection;
  overview: EligibilityOverview; protocols: SavedProtocol[]; workSets: WorkSet[];
  reviewers: Actor[]; exclusionReasons: {id: string; label: string}[];
  items: T[]; offset: number; limit: number; total: number; nextOffset: number | null;
}
export interface EligibilityOperation {
  schema: 'sf88-research-eligibility-operation/v1'; id: string; dossierId: string;
  requestId: string; requestSha256: string; request: EligibilityRequest;
  reviewId: string; action: EligibilityAction['action']; actor: Actor; createdAt: string;
  originalRevision: number; revision: number; originalRevisionSha256: string;
  result: {review?: Record<string, unknown>; protocol?: SavedProtocol; workSet?: WorkSet;
    decision?: Record<string, unknown>; resolution?: Record<string, unknown>;
    study?: Record<string, unknown>; application?: Record<string, unknown>;
    impactReview?: Record<string, unknown>};
  sha256: string;
}
export interface EligibilityReceipt {
  dossier: {id: string; revision: number; [key: string]: unknown};
  operation: EligibilityOperation; duplicate: boolean;
}
export interface EligibilityExportFile {
  file: string; revision: number; bytes: number; sha256: string;
  contentType: string; filename?: string;
}
export interface EligibilityExportOptions {
  revision: number; reviewId: string; workSetId?: string;
  format?: 'json' | 'csv'; section?: EligibilityExportSection;
  file: string; expectedSha256?: string; signal?: AbortSignal;
}
/** Structural interface implemented by the original authenticated workspace client. */
export interface EligibilityClient {
  eligibility(dossierId: string, options?: PageSelection): Promise<EligibilityPage>;
  reviewEligibility(dossierId: string, request: EligibilityRequest): Promise<EligibilityReceipt>;
  exportEligibility(dossierId: string, options: EligibilityExportOptions): Promise<EligibilityExportFile>;
}
export const ELIGIBILITY_REQUEST_FIELDS: readonly string[];
export const ELIGIBILITY_EXPORT_SECTIONS: readonly EligibilityExportSection[];
export const ELIGIBILITY_RECOVERY: string;
export function eligibilityConsumerInput(input: EligibilityRequest): {request: EligibilityRequest; sha256: string};
export function validateEligibilityPage<T = Record<string, unknown>>(
  value: unknown, dossierId: string, options?: PageSelection): EligibilityPage<T>;
export function readEligibility(
  client: EligibilityClient, dossierId: string, options?: PageSelection): Promise<EligibilityPage>;
export function iterateEligibility(
  client: EligibilityClient, dossierId: string, options?: PageSelection): AsyncGenerator<Record<string, unknown>>;
export function validateEligibilityOperation(
  value: unknown, dossierId: string, request: EligibilityRequest): EligibilityReceipt;
export function submitEligibility(
  client: EligibilityClient, dossierId: string, request: EligibilityRequest): Promise<EligibilityReceipt>;
export function exportEligibility(
  client: EligibilityClient, dossierId: string, options: EligibilityExportOptions): Promise<EligibilityExportFile>;
