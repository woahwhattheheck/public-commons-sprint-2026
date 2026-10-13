import type {CohortPlan, CohortPlanningRule, NativeCohortPlanningSeed, PlanningSeedOptions} from './cohort_planning.mjs';

export declare const COHORT_PLAN_CALENDAR_SOURCE_SCHEMA: 'stellar-forge.sf47-cohort-plan-calendar-source.v1';
export interface NativeCalendarEditionReference {
  id: string;
  revision: number;
  sha256: string;
}
export interface NativeCustomerUseCalendarSelection {
  schema: 'stellar-forge.sf47-customer-use-calendar.v1.selection';
  source: {caseId: string; caseVersion: number; planContentSha256: string; [original: string]: unknown};
  selection: NativeCalendarEditionReference[];
  groups: Array<{
    id: string;
    tranche: 2 | 3 | null;
    startDate: string;
    endDate: string;
    planContentSha256: string;
    planChanged: boolean;
    rule: CohortPlanningRule | null;
    [original: string]: unknown;
  }>;
  calendars: Array<NativeCalendarEditionReference & {
    groupId: string;
    document: Record<string, unknown>;
    [original: string]: unknown;
  }>;
  [original: string]: unknown;
}
export interface NativeCustomerUsePlanningSeed extends NativeCohortPlanningSeed {
  customerUse: {
    groupId: string;
    caseVersion: number;
    selection: NativeCalendarEditionReference[];
    [original: string]: unknown;
  };
}
export interface CalendarPlanningSeedOptions extends Pick<PlanningSeedOptions, 'draftId' | 'name' | 'asOfAt'> {
  groupId?: string;
}
/** Receives complete matching native documents into a new editable plan with separate explicit funding. */
export declare function seedCohortPlanFromCalendar(
  nativeSeed: NativeCustomerUsePlanningSeed,
  calendarSelection: NativeCustomerUseCalendarSelection,
  options?: CalendarPlanningSeedOptions
): CohortPlan;
