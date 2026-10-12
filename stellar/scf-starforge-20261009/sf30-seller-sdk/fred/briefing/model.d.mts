export type FredBriefingComparison = 'previous_period' | 'year_earlier' | 'previous_observation';
export type FredBriefingState = 'READY' | 'SOURCE_MISSING' | 'BASE_ABSENT' | 'BASE_MISSING' | 'CALENDAR_DATE_ABSENT' | 'NUMERIC_LITERAL_UNSUPPORTED';
export type FredRelativeState = 'READY' | 'NOT_SELECTED' | 'ZERO_BASE' | 'SOURCE_UNAVAILABLE' | 'NUMERIC_LITERAL_UNSUPPORTED';
export interface FredBriefingSeriesSelection {
  id: string; comparisons?: FredBriefingComparison[]; relativeChange?: boolean;
}
export interface FredBriefingSelection {
  schema?: 'stellar-forge.fred-briefing-spec.v1'; title?: string; start?: string; end?: string;
  decimalPlaces?: number; notes?: string; series?: FredBriefingSeriesSelection[];
}
export interface FredNormalizedBriefing {
  schema: 'stellar-forge.fred-briefing-spec.v1'; title: string; start: string; end: string; decimalPlaces: number; notes: string;
  series: Array<{ id: string; comparisons: FredBriefingComparison[]; relativeChange: boolean }>;
}
export interface FredOriginalObservation {
  series: string; date: string; value: string; missing: boolean; as_of: string;
  time_basis: 'FRED_REALTIME_DATE' | 'PUBLIC_TABLE_RETRIEVAL_DATE';
  realtime_start: string; realtime_end: string; units: string; frequency: string; seasonal_adjustment: string;
}
export interface FredOriginalSeries {
  id: string; title: string; units: string; frequency: string; seasonalAdjustment: string;
  observationStart: string; observationEnd: string; lastUpdated: string; notes: string;
  publisher?: string; release?: string; sourceUrl?: string; asOf?: string; retrievedAt?: string; timeBasis?: string;
  count?: number; missing?: number; notesCoverage?: string;
}
export interface FredOriginalSelection { series: string[]; asOf: string; start: string; end: string; pageSize: number; maxRows: number }
export interface FredOriginalModel {
  selection: FredOriginalSelection; sourceMode: 'API_VINTAGE' | 'PUBLIC_TABLE'; timeBasis: string;
  series: FredOriginalSeries[]; rows: FredOriginalObservation[]; rowCount: number; missing: number;
  sourceResponses: number; retrievalWindow?: { from: string; through: string };
}
export interface FredBriefingMeasure {
  series: string; date: string; comparison: FredBriefingComparison; state: FredBriefingState;
  currentIndex: number; baselineDate: string | null; baselineIndex: number | null;
  absoluteChange: string | null; changeUnits: string; relativePercent: string | null; relativeState: FredRelativeState; relativeRounded: boolean;
}
export interface FredBriefingExpandedMeasure extends FredBriefingMeasure {
  current: FredOriginalObservation; baseline: FredOriginalObservation | null;
}
export interface FredBriefingSeries extends FredOriginalSeries {
  sourceUrl: string; selection: FredNormalizedBriefing['series'][number]; selectedRows: number; selectedMissing: number;
  firstSelectedDate: string | null; lastSelectedDate: string | null; latest: FredOriginalObservation | null;
  latestAvailable: FredOriginalObservation | null; latestMeasures: FredBriefingMeasure[];
}
export interface FredBriefingCalculation {
  version: 'FRED_EXACT_PERIOD_V1'; relativeFormula: string; relativeDecimalPlaces: number; relativeRounding: 'HALF_EVEN';
  absoluteChange: string; priorPeriod: string; yearEarlier: string; previousObservation: string; baselineSource: string;
}
export interface FredBriefingSummary {
  schema: 'stellar-forge.fred-briefing-model.v1'; captureId: string; reviewId: string | null; title: string; notes: string;
  selection: FredNormalizedBriefing;
  source: { sourceMode: FredOriginalModel['sourceMode']; timeBasis: string; selection: FredOriginalSelection;
    sourceRows: number; sourceMissing: number; retrievalWindow?: { from: string; through: string } };
  calculation: FredBriefingCalculation; selectedRows: number; missing: number; measureCount: number; observationCount: number;
  totals: Partial<Record<FredBriefingState, number>>;
}
export interface FredBriefingModel extends FredBriefingSummary {
  series: FredBriefingSeries[]; observations: FredOriginalObservation[]; measures: FredBriefingMeasure[];
}
export interface FredBriefingReport extends FredBriefingModel { reportId: string; sourceNotice: string; sourceTerms: string }
export interface FredBriefingPage extends FredBriefingSummary {
  series: Array<Omit<FredBriefingSeries, 'latestMeasures'> & { latestMeasures: FredBriefingExpandedMeasure[] }>;
  measures: FredBriefingExpandedMeasure[]; offset: number; limit: number; nextOffset: number | null;
  reportId?: string; previewId?: string; sourceNotice?: string; sourceTerms?: string;
}
export type FredRelativeChange =
  { state: 'NUMERIC_LITERAL_UNSUPPORTED' | 'ZERO_BASE'; value: null; rounded: false } |
  { state: 'READY'; value: string; rounded: boolean; decimalPlaces: number; rounding: 'HALF_EVEN' };
export declare const BRIEFING_SPEC: 'stellar-forge.fred-briefing-spec.v1';
export declare const BRIEFING_MODEL: 'stellar-forge.fred-briefing-model.v1';
export declare const MAX_BRIEFING_ROWS: 10000;
export declare const BRIEFING_COMPARISONS: readonly FredBriefingComparison[];
export declare function normalizeFredBriefing(input: FredBriefingSelection, model: FredOriginalModel): FredNormalizedBriefing;
export declare function fredRelativeChange(before: string, after: string, decimalPlaces?: number): FredRelativeChange;
export declare function buildFredBriefingModel(input: { model: FredOriginalModel; captureId: string; reviewId?: string | null;
  selection: FredBriefingSelection }): FredBriefingModel;
export declare function pageFredBriefing(report: FredBriefingModel, options?: { offset?: number; limit?: number }): FredBriefingPage;
