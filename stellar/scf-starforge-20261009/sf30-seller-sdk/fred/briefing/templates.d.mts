import type {
  FredOriginalModel, FredOriginalObservation, FredNormalizedBriefing, FredBriefingComparison,
  FredBriefingMeasure, FredBriefingModel, FredBriefingReport, FredBriefingPage,
} from './model.mjs';

export type FredBriefingTemplateAnchor = 'latest_all' | 'latest_any';
export type FredBriefingChangeKind = 'NEW_PERIOD' | 'EARLIER_PERIOD' | 'ADDED_COMPARISON' |
  'LEFT_WINDOW' | 'REMOVED_COMPARISON' | 'REVISED' | 'UNCHANGED';
export interface FredBriefingTemplateWindow {
  months: number; anchor: FredBriefingTemplateAnchor; lagMonths: number;
}
export interface FredSeriesMeaning {
  id: string; title: string; units: string; frequency: string; seasonalAdjustment: string;
}
export interface FredBriefingTemplate {
  schema: 'stellar-forge.fred-briefing-template.v1'; id: string; name: string;
  origin: { reviewId: string; captureId: string };
  window: FredBriefingTemplateWindow;
  briefing: Pick<FredNormalizedBriefing, 'title' | 'notes' | 'decimalPlaces' | 'series'>;
  seriesMeaning: FredSeriesMeaning[];
  sourceBasis: { sourceMode: string; timeBasis: string | Record<string, unknown> };
  previousTemplateId: string | null;
}
export interface FredOriginalBriefingReview {
  id: string; captureId: string; policy: Record<string, unknown>; note: string; briefing: FredNormalizedBriefing;
  [key: string]: unknown;
}
export interface FredBriefingSourceCoverage {
  series: string; title: string; frequency: string; units: string;
  firstSourceDate: string; lastSourceDate: string; sourceRows: number; windowRows: number; windowMissing: number;
  firstWindowDate: string | null; lastWindowDate: string | null;
  lastSourceMissing: boolean; lastWindowMissing: boolean | null; rowsAfterWindow: number;
}
export interface FredBriefingMeaningChange {
  series: string | null; field: 'title' | 'units' | 'frequency' | 'seasonalAdjustment' | 'sourceMode' | 'timeBasis';
  before: unknown; after: unknown;
}
export interface FredBriefingMaterialization {
  schema: 'stellar-forge.fred-briefing-materialization.v1'; previewId: string; templateId: string;
  originReviewId: string; originCaptureId: string; captureId: string; selection: FredNormalizedBriefing;
  window: { anchorDate: string; observedAnchorDate: string; anchorBasis: FredBriefingTemplateAnchor | 'explicit';
    start: string; end: string; policy: FredBriefingTemplateWindow };
  coverage: FredBriefingSourceCoverage[]; meaningChanges: FredBriefingMeaningChange[];
}
export interface FredBriefingComparisonMeasure extends Omit<FredBriefingMeasure, 'currentIndex' | 'baselineIndex'> {
  current: FredOriginalObservation; baseline: FredOriginalObservation | null; meaning: FredSeriesMeaning;
}
export interface FredBriefingChangeRow {
  series: string; date: string; comparison: FredBriefingComparison; kind: FredBriefingChangeKind;
  reasons: string[]; contextChanges: string[];
  before: FredBriefingComparisonMeasure | null; after: FredBriefingComparisonMeasure | null;
  currentValueDelta: string | null; absoluteChangeDelta: string | null;
}
export interface FredBriefingSourceChange {
  field: 'sourceMode' | 'timeBasis' | 'asOf' | 'retrievalWindow'; before: unknown; after: unknown;
}
export interface FredBriefingChanges {
  schema: 'stellar-forge.fred-briefing-changes.v1'; comparisonId: string;
  before: { captureId: string; reviewId: string | null; reportId: string | null; selection: FredNormalizedBriefing };
  after: { captureId: string; selection: FredNormalizedBriefing };
  totals: Record<FredBriefingChangeKind, number>; sourceChanges: FredBriefingSourceChange[];
  rowCount: number; changedCount: number; contextChangedCount: number; rows: FredBriefingChangeRow[];
}
export interface FredBriefingChangesPage extends Omit<FredBriefingChanges, 'rows'> {
  offset: number; limit: number; changesOnly: boolean; filteredCount: number; nextOffset: number | null;
  rows: FredBriefingChangeRow[];
}
export interface FredBriefingSuccessorRecord {
  schema: 'stellar-forge.fred-briefing-successor.v1'; id: string; templateId: string; originReviewId: string;
  beforeReviewId: string; beforeReportId: string; beforeCaptureId: string; captureId: string; reviewId: string; reportId: string;
  previousSuccessorId: string | null; materialization: FredBriefingMaterialization;
  comparison: { id: string; totals: Record<FredBriefingChangeKind, number>; rowCount: number;
    changedCount: number; contextChangedCount: number; sourceChanges: FredBriefingSourceChange[] };
}
export interface FredMaterializeBriefingInput {
  template: FredBriefingTemplate; model: FredOriginalModel; captureId: string; anchorDate?: string | null;
}
export interface FredBriefingChangesOptions { offset?: number; limit?: number; changesOnly?: boolean }
export declare const FRED_BRIEFING_TEMPLATE: 'stellar-forge.fred-briefing-template.v1';
export declare const FRED_BRIEFING_MATERIALIZATION: 'stellar-forge.fred-briefing-materialization.v1';
export declare const FRED_BRIEFING_CHANGES: 'stellar-forge.fred-briefing-changes.v1';
export declare const FRED_BRIEFING_SUCCESSOR: 'stellar-forge.fred-briefing-successor.v1';
export declare const FRED_TEMPLATE_ANCHORS: readonly FredBriefingTemplateAnchor[];
export declare const FRED_BRIEFING_CHANGE_KINDS: readonly FredBriefingChangeKind[];
export declare function createFredBriefingTemplate(input: {
  name?: string; review: FredOriginalBriefingReview; model: FredOriginalModel;
  window?: Partial<FredBriefingTemplateWindow>; previousTemplateId?: string | null;
}): FredBriefingTemplate;
export declare function validateFredBriefingTemplate(input: unknown): FredBriefingTemplate;
export declare function materializeFredBriefingTemplate(input: FredMaterializeBriefingInput): FredBriefingMaterialization;
export declare function validateFredBriefingMaterialization(input: unknown): FredBriefingMaterialization;
export declare function previewFredBriefingTemplate(input: FredMaterializeBriefingInput & {
  offset?: number; limit?: number;
}): FredBriefingMaterialization & { briefing: FredBriefingPage };
export declare function compareFredBriefingSuccessor(input: {
  before: FredBriefingModel | FredBriefingReport; after: FredBriefingModel | FredBriefingReport;
}): FredBriefingChanges;
export declare function validateFredBriefingChanges(input: unknown): FredBriefingChanges;
export declare function pageFredBriefingChanges(comparison: FredBriefingChanges, options?: FredBriefingChangesOptions): FredBriefingChangesPage;
export declare function createFredBriefingSuccessorRecord(input: {
  template: FredBriefingTemplate; materialization: FredBriefingMaterialization; reviewId: string; reportId: string;
  comparison: FredBriefingChanges; previousSuccessorId?: string | null;
}): FredBriefingSuccessorRecord;
export declare function validateFredBriefingSuccessorRecord(input: unknown): FredBriefingSuccessorRecord;
