import type {CohortPlan, CohortPlanDocument, CohortPlanReport, PlanningDeliveryScheduling,
  DateText, TimestampText, DecimalText} from './cohort_planning.mjs';

export declare const COHORT_DELIVERY_SCHEDULE_SCHEMA: "stellar-forge.sf47-delivery-schedule-report.v1";
export interface DeliverySchedulingIssue {
  code: string;
  message: string;
  [key: string]: unknown;
}
export interface DeliveryScheduleAssignment {
  occurrenceId: string;
  scheduleId: string;
  label: string;
  sourceDate: DateText;
  originalDate: DateText;
  date: DateText;
  scheduledAt: TimestampText;
  plannedCompleteAt: TimestampText;
  scheduledTasks: number;
  scheduledRequests: number;
  requiredHours: DecimalText | null;
  capacityPoolId: string | null;
  fundingGroupIds: string[];
  priority: number;
  status: "PLACED" | "FIXED" | "UNRESOLVED";
  fixedReason: "NO_ACTIVE_WORK" | "PAST_CUTOFF" | "FIXED_DATE" | "EFFORT_REQUIRED" | "DELIVERY_POOL_REQUIRED" | null;
  moved: boolean;
  permittedDates: DateText[];
  rejectedDates: {date: DateText; reasons: DeliverySchedulingIssue[]}[];
  issues: DeliverySchedulingIssue[];
}
export type DeliveryAllocationMethod = "FIRST_FIT" | "RESOLVE_CONFLICTS";
export interface DeliveryAllocationOptions {
  name?: string;
  method?: DeliveryAllocationMethod;
  /** Default 100000. Whole candidate placements from 1 through 1000000. */
  maxSearchSteps?: number;
}
export interface DeliveryCapacityResolution {
  method: "RESOLVE_CONFLICTS";
  maxSearchSteps: number;
  visitedSteps: number;
  reconsideredGroups: number;
  resolvedGroups: number;
  revisedDates: number;
  components: {
    groupIds: string[];
    occurrenceIds: string[];
    status: "RESOLVED" | "SEARCH_LIMIT" | "NO_COMPLETE_PLACEMENT";
    visitedSteps: number;
    revisedDates: {occurrenceId: string; before: DateText; after: DateText}[];
  }[];
}
export interface CohortDeliverySchedule {
  schema: typeof COHORT_DELIVERY_SCHEDULE_SCHEMA;
  sourceDocument: CohortPlanDocument;
  constraints: PlanningDeliveryScheduling;
  candidate: CohortPlan;
  report: CohortPlanReport;
  method: string;
  /** Present only for explicitly selected conflict resolution. */
  resolution?: DeliveryCapacityResolution;
  summary: {
    status: "COMPLETE" | "UNRESOLVED";
    occurrences: number;
    moved: number;
    fixed: number;
    unresolved: number;
    capacityBefore: CohortPlanReport["capacity"]["status"];
    capacityAfter: CohortPlanReport["capacity"]["status"];
    scheduledTasks: number;
    scheduledRequests: number;
    plannedPaymentRequests: number;
    fundingGroups: number;
  };
  assignments: DeliveryScheduleAssignment[];
}
/** Defaults to fixed service dates; retains any existing complete policy. */
export declare function seedCohortDeliveryScheduling(document: CohortPlanDocument | unknown): PlanningDeliveryScheduling;
/** Pure operation. The original case and purchase records remain in sourceDocument. */
export declare function scheduleCohortDelivery(document: CohortPlanDocument | unknown,
  constraints?: PlanningDeliveryScheduling | unknown, options?: DeliveryAllocationOptions): CohortDeliverySchedule;
/** Recalculates the complete retained source and decisions before accepting the result. */
export declare function reopenCohortDeliverySchedule(document: unknown): CohortDeliverySchedule;
export declare function exportCohortDeliveryScheduleCsv(document: CohortDeliverySchedule | unknown): string;
