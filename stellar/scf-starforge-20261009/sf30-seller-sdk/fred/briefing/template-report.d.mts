import type {
  FredBriefingTemplate, FredBriefingMaterialization, FredBriefingChanges, FredBriefingSuccessorRecord,
} from './templates.mjs';
export declare const FRED_BRIEFING_SUCCESSOR_CSV_COLUMNS: readonly string[];
export declare function fredBriefingSuccessorCsv(comparison: FredBriefingChanges): string;
export declare function renderFredBriefingSuccessor(input: {
  template: FredBriefingTemplate; materialization: FredBriefingMaterialization; comparison: FredBriefingChanges;
  successor?: FredBriefingSuccessorRecord;
  briefing?: { reviewId: string; reportId: string; manifest?: object };
}): string;
