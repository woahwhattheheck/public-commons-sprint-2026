/**
 * Public contract for the pure cohort planning engine.
 * Inputs are JSON values; monetary and atomic quantities retain textual precision.
 */
export declare const COHORT_PLAN_SCHEMA: "stellar-forge.sf47-cohort-plan.v1";
export declare const COHORT_PLAN_REPORT_SCHEMA: "stellar-forge.sf47-cohort-plan-report.v1";
export type DecimalText = string;
export type AtomicText = string;
export type DateText = string;
export type TimestampText = string;
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Participation = "INDEPENDENT_OPERATOR" | "CUSTOMER" | "TEAM_OPERATED" | "UNKNOWN";
export type Environment = "LOCAL" | "TESTNET" | "MAINNET" | "OTHER" | "UNKNOWN";
export type AsOfPosition = "PAST" | "AS_OF_DAY" | "FUTURE";

export declare class CohortPlanningError extends Error {
  code: string;
  path: string;
  constructor(code: string, message: string, path?: string);
}

export interface PlanSource {
  programId: string;
  version: number;
  planContentSha256: string;
  planId?: string;
  planRevision?: number;
}

/** All additional original rule fields survive normalization and comparison. */
export interface CohortPlanningRule {
  schema: "stellar-forge.scf-deployment-outcomes.v1";
  target: {
    tranche: 2 | 3;
    proposed_window: {
      consecutive_calendar_days: number;
      [originalField: string]: unknown;
    };
    target_counts: Record<string, number>;
    [originalField: string]: unknown;
  };
  [originalField: string]: unknown;
}

export interface OriginalDeploymentAcceptancePlan {
  schema: "stellar-forge.scf-deployment-outcomes.v1";
  targets: Array<{
    tranche: number;
    proposed_window: Record<string, unknown>;
    target_counts: Record<string, number>;
    [originalField: string]: unknown;
  }>;
  [originalField: string]: unknown;
}

export interface NativePlanningDeployment {
  id: string;
  role: "BUYER" | "MERCHANT" | "BOTH" | string;
  label?: string;
  name?: string;
  operatorId?: string;
  participantClass?: Participation;
  environment?: Environment;
  sourceIds?: string[];
  sourceNote?: string;
  [originalField: string]: unknown;
}

export interface NativeCohortPlanningSeed {
  source: PlanSource;
  rule: CohortPlanningRule;
  inputs?: {
    asOfAt?: TimestampText;
    windowStart?: DateText | null;
    [originalField: string]: unknown;
  };
  inventory?: {
    deployments?: NativePlanningDeployment[];
    [originalField: string]: unknown;
  };
  [originalField: string]: unknown;
}

export interface PlanningSeedOptions {
  asOfAt?: TimestampText;
  windowStart?: DateText;
  draftId?: string;
  name?: string;
  planId?: string;
  planRevision?: number;
}

export interface PlanningEvidence {
  sourceIds: string[];
  sourceNote: string;
}

export interface PlanningParticipant extends PlanningEvidence {
  id: string;
  label: string;
  operatorId: string;
  participantClass: Participation;
  environment: Environment;
  deploymentId: string | null;
}

export interface PlanningFacilitator extends PlanningEvidence {
  id: string;
  label: string;
  operatorId: string;
  participantClass: Participation;
  serviceUrl: string;
}

export interface PlanningOperation extends PlanningEvidence {
  id: string;
  label: string;
  merchantId: string;
  scope: string;
  expectedOutput: string;
  sourcePeriod: string;
}

export interface PlanningDateExclusion {
  date: DateText;
  label: string;
}

export interface PlanningCalendar {
  timezone: "UTC";
  weekdays: Weekday[];
  excludedDates: PlanningDateExclusion[];
}

export type PlanningCadence =
  | { kind: "WEEKDAYS"; weekdays: Weekday[] }
  | { kind: "EVERY_N_DAYS"; intervalDays: number; anchorDate: DateText }
  | { kind: "EXPLICIT_DATES"; dates: DateText[] };

export interface PlanningPaymentBase {
  atomicUnitPrice: AtomicText;
  network: string;
  asset: string;
}

export type PlanningPayment =
  | { kind: "FUNDED"; atomicUnitPrice: null; network: ""; asset: "" }
  | (PlanningPaymentBase & { kind: "PER_REQUEST" })
  | (PlanningPaymentBase & { kind: "UNPAID" })
  | (PlanningPaymentBase & {
      kind: "PREPAID";
      passCapacity: number;
      openingUnits: number;
      allowanceUnitsPerRequest: number;
      passGroupId: string | null;
    });

export interface PlanningEconomics {
  currency: string;
  /** Revenue per new payment request or prepaid pass acquisition. */
  unitRevenue: DecimalText | null;
  /** Supplier cost per underlying request. */
  unitCost: DecimalText | null;
  feePerPayment: DecimalText | null;
  activeHoursPerTask: DecimalText | null;
  hourlyCost: DecimalText | null;
}


/** Exact native reference. The full selected source also remains in calendarSource. */
export interface PlanningFundingOrigin {
  installationId: string;
  revision: number;
  sha256: string;
  taskId?: string;
  fundingId?: string;
  entryId?: string;
  mode?: "PURCHASE" | "ALLOWANCE_USE" | "REOPEN" | "FREE_USE";
  state?: "PLANNED" | "CANCELLED";
}
export interface PlanningFundingEconomics {
  currency: string;
  unitRevenue: DecimalText | null;
  feePerPayment: DecimalText | null;
}
export interface PlanningExplicitFunding extends PlanningEvidence {
  id: string;
  label: string;
  kind: "DIRECT" | "PREPAID";
  date: DateText;
  buyerId: string;
  /** Original purchased operation, retained separately from the later result's task. */
  operationId: string;
  facilitatorId: string | null;
  atomicUnitPrice: AtomicText | null;
  network: string;
  asset: string;
  economics: PlanningFundingEconomics | null;
  origin: PlanningFundingOrigin | null;
}
export interface PlanningCalendarSource {
  schema: "stellar-forge.sf47-cohort-plan-calendar-source.v1";
  groupId: string;
  /** Complete original native JSON documents, including saved records and source inventory. */
  selection: Record<string, unknown>;
  cohortSeed: NativeCohortPlanningSeed;
}
export interface PlanningExplicitFundingReport extends Omit<PlanningExplicitFunding, "economics">, PlannedMetrics {
  merchantId: string;
  buyerOperatorId: string;
  merchantOperatorId: string;
  facilitatorOperatorId: string | null;
  scheduleIds: string[];
  useOccurrenceIds: string[];
  firstUsefulResultAt: TimestampText | null;
  firstUsefulResultDate: DateText | null;
  firstUseOccurrenceId: string | null;
  withinWindow: boolean | null;
  unpricedPaymentRequests: number;
  unpricedIndependentOpportunities: number;
  qualificationGaps: string[];
  atomicAmount: AtomicText | null;
  status: "UNUSED" | "EXISTING_FUNDING" | "UNPRICED" | "ZERO_PRICE" | "PLANNED";
  sourceEconomics: PlanningFundingEconomics | null;
  economics: PlanningEconomicAmounts | null;
}


export declare const COHORT_SCHEDULING_SCHEMA: "stellar-forge.sf47-delivery-scheduling.v1";
export interface PlanningDateAllocation {
  /** Date selected by the unchanged original cadence and source calendar. */
  sourceDate: DateText;
  /** Reviewed delivery date inside that same complete rule window. */
  date: DateText;
}
export interface PlanningSchedulingPolicy {
  scheduleId: string;
  flexible: boolean;
  /** Tolerances are anchored to sourceDate; replanning does not reset them. */
  advanceDays: number;
  delayDays: number;
  releaseDate: DateText | null;
  /** The complete output must arrive by the end of this UTC date. */
  dueDate: DateText | null;
  weekdays: Weekday[];
  minimumGapDays: number;
  /** Larger values receive shared capacity first. */
  priority: number;
  note: string;
}
export interface PlanningDeliveryScheduling {
  schema: typeof COHORT_SCHEDULING_SCHEMA;
  strategy: "NEAREST" | "EARLIEST";
  schedules: PlanningSchedulingPolicy[];
  note: string;
}
export declare function normalizeCohortScheduling(raw: unknown, schedules: PlanningSchedule[]): PlanningDeliveryScheduling;

export interface PlanningSchedule {
  dateAllocations?: PlanningDateAllocation[];
  fundingGroupIds?: string[];
  origin?: PlanningFundingOrigin | null;
  /** Shared active-hours pool; omission keeps delivery effort unassigned. */
  capacityPoolId?: string | null;
  id: string;
  label: string;
  operationId: string;
  buyerId: string;
  facilitatorId: string | null;
  cadence: PlanningCadence;
  tasksPerDate: number;
  requestsPerTask: number;
  timeUtc: string;
  deliveryDelayMinutes: number;
  excludedDates: PlanningDateExclusion[];
  payment: PlanningPayment;
  economics: PlanningEconomics | null;
  note: string;
}

export interface PlanningWorkshare extends PlanningEvidence {
  id: string;
  label: string;
  currency: string;
  fee: DecimalText | null;
  hours: DecimalText | null;
  hourlyCost: DecimalText | null;
  otherCosts: DecimalText | null;
}

export interface PlanningSensitivity {
  /** Optional target gross contribution margin; ordinary decimal percentage below 100. */
  minimumMarginPct?: DecimalText | null;
  effortIncreasesPct: DecimalText[];
  completionSharesPct: DecimalText[];
}

/** Complete normalized plan; the edition may also retain the original caller JSON. */
export interface CohortPlan {
  deliveryScheduling?: PlanningDeliveryScheduling;
  schema: typeof COHORT_PLAN_SCHEMA;
  draftId: string;
  name: string;
  source: PlanSource;
  rule: CohortPlanningRule;
  asOfAt: TimestampText;
  windowStart: DateText;
  calendar: PlanningCalendar;
  buyers: PlanningParticipant[];
  merchants: PlanningParticipant[];
  facilitators: PlanningFacilitator[];
  operations: PlanningOperation[];
  schedules: PlanningSchedule[];
  workshares: PlanningWorkshare[];
  capacityPools?: PlanningCapacityPool[];
  fundingGroups?: PlanningExplicitFunding[];
  calendarSource?: PlanningCalendarSource | null;
  sensitivity: PlanningSensitivity;
  note: string;
}

export interface PlannedMetrics {
  scheduledTasks: number;
  scheduledRequests: number;
  plannedPaymentRequests: number;
  plannedPaidPurchases: number;
  plannedCompleteTasks: number;
  plannedCompletePurchases: number;
  independentPurchaseOpportunities: number;
  allowanceUnits: number;
}

export interface PlanningSummary extends PlannedMetrics {
  unpricedPaymentRequests?: number;
  unpricedIndependentOpportunities?: number;
  independentBuyerOperators: number;
  independentMerchantOperators: number;
  returningBuyerOperators: number;
  sameOperationFacilitatorOperators: number;
  excludedScheduleDates: number;
  /** Paid purchases whose complete output falls after the original window. */
  completionOutsideWindow: number;
  elapsedScheduledDates: number;
}

export interface PlanningSourceComparison {
  status: "NOT_COMPARED" | "MATCH" | "CHANGED";
  fields: Array<{
    key: "programId" | "version" | "planContentSha256" | "planId" | "planRevision";
    planned: string | number;
    current: string | number;
    match: boolean;
  }>;
  ruleMatches: boolean | null;
  currentSource: PlanSource | null;
  currentRule: CohortPlanningRule | null;
}

export interface PlanningWindow {
  start: DateText;
  end: DateText;
  calendarDays: number;
  requiredCalendarDays: number;
  tranche: 2 | 3;
  expectedEnvironment: "TESTNET" | "MAINNET";
  asOfAt: TimestampText;
  asOfDay: DateText;
}

export interface PlanningDay extends PlannedMetrics {
  date: DateText;
  weekday: Weekday;
  isWorkingDay: boolean;
  exclusionLabels: string[];
  asOfPosition: AsOfPosition;
}

export interface PlanningAllowance {
  groupId: string;
  openingActiveUnits: number;
  consumedUnits: number;
  plannedNewPasses: number;
  retainedUnusedPreviousUnits: number;
  remainingActiveUnits: number;
}

export interface PlanningEconomicAmounts {
  currency: string;
  revenue: DecimalText | null;
  supplierCost: DecimalText | null;
  paymentFees: DecimalText | null;
  activeHours: DecimalText | null;
  laborCost: DecimalText | null;
  totalCost: DecimalText | null;
  contribution: DecimalText | null;
}

export interface PlanningOccurrence extends PlannedMetrics {
  /** Present when this original occurrence has a reviewed date allocation. */
  sourceDate?: DateText;
  originalScheduledAt?: TimestampText;
  fundingGroupIds?: string[];
  id: string;
  scheduleId: string;
  label: string;
  operationId: string;
  buyerId: string;
  merchantId: string;
  facilitatorId: string | null;
  buyerOperatorId: string;
  merchantOperatorId: string;
  facilitatorOperatorId: string | null;
  date: DateText;
  scheduledAt: TimestampText;
  plannedCompleteAt: TimestampText;
  completionDate: DateText;
  withinWindow: boolean;
  asOfPosition: AsOfPosition;
  paymentKind: "PER_REQUEST" | "PREPAID" | "UNPAID" | "FUNDED";
  network: string;
  asset: string;
  allowance: PlanningAllowance | null;
  qualificationGaps: string[];
  atomicAmount: AtomicText;
  economics: PlanningEconomicAmounts | null;
}

export interface PlanningExcludedDate {
  scheduleId: string;
  date: DateText;
  reasons: string[];
}

export interface PlanningBuyerGroup extends PlannedMetrics {
  operatorId: string | null;
  label: string;
  buyerIds: string[];
  completionDates: DateText[];
  returningPotential: boolean;
}

export interface PlanningMerchantGroup extends PlannedMetrics {
  operatorId: string | null;
  label: string;
  merchantIds: string[];
  buyerOperatorIds: string[];
}

export interface PlanningOperationGroup extends PlannedMetrics {
  id: string;
  label: string;
  merchantId: string;
  facilitatorOperatorIds: string[];
  buyerOperatorIds: string[];
  independentFacilitatorCount: number;
}

export interface PlanningFacilitatorGroup extends PlannedMetrics {
  operatorId: string | null;
  label: string;
  serviceIds: string[];
  operationIds: string[];
}

export interface PlanningTarget {
  key: string;
  expected: number;
  planned: number | null;
  gap: number | null;
  status: "PLANNED_CAPACITY" | "SHORTFALL" | "OUTSIDE_SCHEDULE_SCOPE" | "PRICE_UNSPECIFIED";
  unpricedAdditional?: number;
}

export type PlanningComponent = "revenue" | "supplierCost" | "paymentFees" | "activeHours" | "laborCost";

export interface PlanningCurrency extends PlanningEconomicAmounts {
  /** Unallocated linked estimates keep affected currency totals incomplete. */
  unallocatedFundingIds?: string[];
  unallocatedDeliveryIds?: string[];
  records: number;
  knownSubtotals: Record<PlanningComponent, DecimalText>;
  unknownRecordCounts: Record<PlanningComponent, number>;
  complete: boolean;
  marginPercent: DecimalText | null;
}

export interface PlanningAsset {
  network: string;
  asset: string;
  atomicAmount: AtomicText | null;
  knownAtomicAmount?: AtomicText;
  unpricedPaymentRequests?: number;
  plannedPaymentRequests: number;
  plannedPaidPurchases: number;
}

export interface PlanningPassGroup {
  id: string;
  buyerId: string;
  merchantId: string;
  network: string;
  asset: string;
  passCapacity: number;
  openingUnits: number;
  remainingActiveUnits: number;
  retainedUnusedPreviousUnits: number;
  consumedUnits: number;
  plannedNewPasses: number;
  scheduleIds: string[];
}

export interface PlanningWorkshareCase {
  effortIncreasePct: DecimalText;
  hours: DecimalText | null;
  laborCost: DecimalText | null;
  totalCost: DecimalText | null;
  contribution: DecimalText | null;
  marginPercent: DecimalText | null;
}

export interface PlanningWorkshareReport extends PlanningWorkshare {
  cases: PlanningWorkshareCase[];
  breakEvenHours: DecimalText | null;
}

export interface PlanningCompletionSensitivity {
  completionSharePct: DecimalText;
  baseOpportunities: number;
  potentialCompletedWholePurchases: number;
  purchaseTarget: number | null;
  requiredOpportunities: number | null;
  shortfall: number | null;
}

export interface PlanningEffortSensitivity {
  currency: string;
  effortIncreasePct: DecimalText;
  activeHours: DecimalText | null;
  laborCost: DecimalText | null;
  totalCost: DecimalText | null;
  contribution: DecimalText | null;
}

export interface PlanningFinding {
  code: string;
  severity: "info" | "warning";
  scope: string;
  id: string | null;
  message: string;
}

export interface PlanningCapacityOverride {
  date: DateText;
  availableHours: DecimalText | null;
  label: string;
}
export interface PlanningCapacityPool extends PlanningEvidence {
  id: string;
  label: string;
  /** Aggregate active staff hours, Monday 1 through Sunday 7; blank/null is unknown. */
  hoursByWeekday: Partial<Record<Weekday, DecimalText | null>>;
  dateOverrides: PlanningCapacityOverride[];
}
export type PlanningCapacityStatus = "WITHIN_CAPACITY" | "OVERALLOCATED" | "INCOMPLETE";
export interface PlanningCapacityDay {
  poolId: string;
  date: DateText;
  weekday: Weekday;
  weekStart: DateText;
  availableHours: DecimalText | null;
  availabilityBasis: "DATE_OVERRIDE" | "WEEKDAY";
  availabilityNote: string;
  scheduledTasks: number;
  scheduleIds: string[];
  requiredHours: DecimalText | null;
  knownRequiredHours: DecimalText;
  headroomHours: DecimalText | null;
  additionalHoursKnownMinimum: DecimalText;
  utilizationPercent: DecimalText | null;
  unknownEffortOccurrences: number;
  status: PlanningCapacityStatus;
}
export interface PlanningCapacitySummary {
  availableHours: DecimalText | null;
  knownAvailableHours: DecimalText;
  requiredHours: DecimalText | null;
  knownRequiredHours: DecimalText;
  headroomHours: DecimalText | null;
  /** Sum of positive daily shortages; spare capacity on another day is not netted. */
  additionalHoursKnownMinimum: DecimalText;
  overloadedDates: DateText[];
  unknownAvailabilityDates: number;
  unknownEffortOccurrences: number;
  status: PlanningCapacityStatus;
}
export interface PlanningCapacityWeek extends PlanningCapacitySummary {
  poolId: string;
  weekStart: DateText;
  start: DateText;
  end: DateText;
  includedCalendarDays: number;
}
export interface PlanningCapacityPoolReport extends PlanningCapacityPool, PlanningCapacitySummary {
  days: PlanningCapacityDay[];
  weeks: PlanningCapacityWeek[];
}
export interface PlanningCapacityReport {
  status: PlanningCapacityStatus | "NOT_CONFIGURED";
  basis: string;
  pools: PlanningCapacityPoolReport[];
  unassigned: Array<{ scheduleId: string; date: DateText; scheduledTasks: number; requiredHours: DecimalText | null }>;
  sensitivity: Array<PlanningCapacitySummary & { poolId: string; label: string; effortIncreasePct: DecimalText }>;
}
export interface PlanningServicePricing {
  fundingGroupIds?: string[];
  currencies?: string[];
  id: string;
  label: string;
  scheduleIds: string[];
  currency: string | null;
  paymentKind: "PER_REQUEST" | "PREPAID" | "UNPAID" | "FUNDED";
  scheduledTasks: number;
  chargeUnits: number;
  unitRevenue: DecimalText | null;
  totalCost: DecimalText | null;
  revenue: DecimalText | null;
  uncoveredCost: DecimalText | null;
  minimumMarginPct: DecimalText | null;
  breakEvenUnitRevenue: DecimalText | null;
  targetUnitRevenue: DecimalText | null;
  unitRevenueIncrease: DecimalText | null;
  unknownRecordCounts: Record<"revenue" | "supplierCost" | "paymentFees" | "laborCost", number>;
  status: "INCOMPLETE" | "NO_NEW_CHARGES" | "NO_COST" | "BELOW_COST" | "UNVALUED_REVENUE" | "COVERS_COST";
  priceBasis: string;
}

export interface CohortPlanReport {
  /** Complete newer reports retain these extensions; earlier saved editions can omit them. */
  capacity?: PlanningCapacityReport;
  servicePricing?: PlanningServicePricing[];
  fundingGroups?: PlanningExplicitFundingReport[];

  schema: typeof COHORT_PLAN_REPORT_SCHEMA;
  kind: "PLAN";
  source: PlanSource;
  rule: CohortPlanningRule;
  input: CohortPlan;
  sourceComparison: PlanningSourceComparison;
  window: PlanningWindow;
  summary: PlanningSummary;
  days: PlanningDay[];
  occurrences: PlanningOccurrence[];
  excluded: PlanningExcludedDate[];
  buyers: PlanningBuyerGroup[];
  merchants: PlanningMerchantGroup[];
  operations: PlanningOperationGroup[];
  facilitators: PlanningFacilitatorGroup[];
  targets: PlanningTarget[];
  currencies: PlanningCurrency[];
  assets: PlanningAsset[];
  passGroups: PlanningPassGroup[];
  workshares: PlanningWorkshareReport[];
  sensitivity: {
    completion: PlanningCompletionSensitivity[];
    effort: PlanningEffortSensitivity[];
  };
  findings: PlanningFinding[];
}

export interface PlanningEvaluationOptions {
  nativeSeed?: NativeCohortPlanningSeed;
}

/** Selects the complete native-shaped rule for tranche 2 or 3. */
export declare function selectCohortPlanningRule(original: OriginalDeploymentAcceptancePlan, tranche: 2 | 3): CohortPlanningRule;
/** Validates JSON, reports unsupported fields explicitly, and returns normalized values. */
export declare function normalizeCohortPlan(raw: unknown): CohortPlan;
/** Seeds identities and original rules; an explicit timestamp comes from options or native seed. */
export declare function seedCohortPlan(nativeSeed: NativeCohortPlanningSeed, options?: PlanningSeedOptions): CohortPlan;
/** Old plans retain their rule while current-source differences become report findings. */
export declare function evaluateCohortPlan(input: CohortPlan, options?: PlanningEvaluationOptions): CohortPlanReport;
export declare function evaluateCohortPlan(input: unknown, options?: PlanningEvaluationOptions): CohortPlanReport;
/** One complete wide CSV string with RFC-style quoting, CRLF and formula-safe text cells. */
export declare function exportCohortPlanCsv(report: CohortPlanReport): string;


export declare const COHORT_PLAN_COMPARISON_SCHEMA: "stellar-forge.sf47-cohort-plan-comparison.v1";
export type CohortPlanDocument = import('./cohort_delivery_comparison.mjs').CohortRecordedCostPlan | CohortPlan | CohortPlanReport | import('./cohort_planning_scheduling.mjs').CohortDeliverySchedule | {
  schema: "stellar-forge.sf47-cohort-plan-edition.v1";
  plan: CohortPlan;
  [originalField: string]: unknown;
};
export interface PlanningNumberChange { before: number | null; after: number | null; delta: number | null; }
export interface PlanningDecimalChange { before: DecimalText | null; after: DecimalText | null; delta: DecimalText | null; }
export interface PlanningFieldChange {
  key: string;
  beforePresent: boolean;
  afterPresent: boolean;
  before: unknown;
  after: unknown;
}
export interface PlanningRowChange<T> {
  id: string;
  status: "ADDED" | "REMOVED" | "CHANGED" | "MOVED";
  beforeIndex: number | null;
  afterIndex: number | null;
  before: T | null;
  after: T | null;
  changes: PlanningFieldChange[];
}
export type PlanningMoneyComparisonField = PlanningComponent | "totalCost" | "contribution" | "marginPercent";
export type PlanningWorkshareComparisonField = "fee" | "hours" | "otherCosts" | "laborCost" | "totalCost" | "contribution";
export type PlanningWorkshareTotals = {
  currency: string;
  records: number;
  complete: boolean;
  knownSubtotals: Record<PlanningWorkshareComparisonField, DecimalText>;
  unknownRecordCounts: Record<PlanningWorkshareComparisonField, number>;
} & Record<PlanningWorkshareComparisonField, DecimalText | null>;
export interface PlanningComparisonOrigin {
  label?: string; caseId?: string; sourceId?: string; filename?: string;
  sha256?: string; bytes?: number; capturedAt?: TimestampText;
}
export interface PlanningComparisonOptions {
  title?: string; note?: string;
  origins?: { before?: PlanningComparisonOrigin | null; after?: PlanningComparisonOrigin | null };
}

export interface PlanningAmountComparison<T> {
  id: string; before: T | null; after: T | null;
  amounts: Record<string, PlanningDecimalChange>;
}
export interface PlanningDeliveryComparison {
  status: { before: PlanningCapacityReport["status"]; after: PlanningCapacityReport["status"] };
  pools: Array<PlanningAmountComparison<PlanningCapacityPoolReport>>;
  days: Array<PlanningAmountComparison<PlanningCapacityDay>>;
  weeks: Array<PlanningAmountComparison<PlanningCapacityWeek>>;
  dayChanges: Array<PlanningRowChange<PlanningCapacityDay>>;
  weekChanges: Array<PlanningRowChange<PlanningCapacityWeek>>;
  unassigned: Array<PlanningRowChange<PlanningCapacityReport["unassigned"][number]>>;
  sensitivity: Array<PlanningRowChange<PlanningCapacityReport["sensitivity"][number]>>;
}
export interface PlanningPriceComparison extends PlanningAmountComparison<PlanningServicePricing> {
  /** Monetary differences exist only when both groups retain the same known currency. */
  counts: Record<"chargeUnits" | "scheduledTasks", PlanningNumberChange>;
  minimumMarginPct: PlanningDecimalChange;
}

export interface CohortPlanComparison {
  schema: typeof COHORT_PLAN_COMPARISON_SCHEMA;
  kind: "PLAN_COMPARISON";
  capacity: PlanningDeliveryComparison;
  servicePricing: PlanningPriceComparison[];
  review: { title: string; note: string; origins: { before: PlanningComparisonOrigin | null; after: PlanningComparisonOrigin | null } };
  /** The complete original JSON inputs, including original edition metadata/report when present. */
  documents: { before: CohortPlanDocument; after: CohortPlanDocument };
  /** Both reports are recalculated from each input's own complete retained rule. */
  before: CohortPlanReport;
  after: CohortPlanReport;
  basis: Array<{ key: string; before: unknown; after: unknown; match: boolean }>;
  summary: Array<{ key: keyof PlanningSummary } & PlanningNumberChange>;
  economicsCoverage: Record<"before" | "after", { occurrences: number; withEconomics: number; withoutEconomics: number; schedulesWithoutEconomics: string[] }>;
  targets: Array<{
    key: string; before: PlanningTarget | null; after: PlanningTarget | null;
    expected: PlanningNumberChange; planned: PlanningNumberChange; gap: PlanningNumberChange;
  }>;
  currencies: Array<{
    currency: string; before: PlanningCurrency | null; after: PlanningCurrency | null;
    amounts: Record<PlanningMoneyComparisonField, PlanningDecimalChange>;
  }>;
  /** One-time commissioning totals, kept separate from recurring schedule economics. */
  workshareTotals: Array<{
    currency: string; before: PlanningWorkshareTotals | null; after: PlanningWorkshareTotals | null;
    amounts: Record<PlanningWorkshareComparisonField, PlanningDecimalChange>;
  }>;
  assets: Array<{
    network: string; asset: string; before: PlanningAsset | null; after: PlanningAsset | null;
    atomicAmount: PlanningDecimalChange; plannedPaymentRequests: PlanningNumberChange; plannedPaidPurchases: PlanningNumberChange;
  }>;
  days: Array<{
    date: DateText; before: PlanningDay | null; after: PlanningDay | null;
    metrics: Record<keyof PlannedMetrics, PlanningNumberChange>;
  }>;
  inputChanges: {
    settings: PlanningFieldChange[];
    collections: Array<{
      kind: "buyers" | "merchants" | "facilitators" | "operations" | "schedules" | "workshares" | "capacityPools" | "fundingGroups";
      beforeOrder: string[]; afterOrder: string[];
      rows: Array<PlanningRowChange<PlanningParticipant | PlanningFacilitator | PlanningOperation | PlanningSchedule | PlanningWorkshare | PlanningCapacityPool | PlanningExplicitFunding>>;
    }>;
  };
  occurrences: Array<PlanningRowChange<PlanningOccurrence>>;
  participants: Array<{
    kind: "buyers" | "merchants" | "operations" | "facilitators";
    rows: Array<PlanningRowChange<PlanningBuyerGroup | PlanningMerchantGroup | PlanningOperationGroup | PlanningFacilitatorGroup>>;
  }>;
  passGroups: Array<PlanningRowChange<PlanningPassGroup>>;
  fundingGroups: Array<PlanningRowChange<PlanningExplicitFundingReport>>;
  workshares: Array<PlanningRowChange<PlanningWorkshareReport>>;
  sensitivity: {
    completion: Array<PlanningRowChange<PlanningCompletionSensitivity>>;
    effort: Array<PlanningRowChange<PlanningEffortSensitivity>>;
  };
  findings: { added: PlanningFinding[]; removed: PlanningFinding[] };
}
/** Absolute candidate-minus-baseline values; no currency conversion or automatic plan choice. */
export declare function compareCohortPlans(baseline: CohortPlanDocument, candidate: CohortPlanDocument, options?: PlanningComparisonOptions): CohortPlanComparison;
export declare function compareCohortPlans(baseline: unknown, candidate: unknown, options?: PlanningComparisonOptions): CohortPlanComparison;
/** Reopens both complete documents and recalculates all derived comparison values. */
export declare function reopenCohortPlanComparison(document: unknown): CohortPlanComparison;
/** Complete comparative CSV rows with exact decimal text and formula-safe cells. */
export declare function exportCohortPlanComparisonCsv(comparison: CohortPlanComparison): string;
