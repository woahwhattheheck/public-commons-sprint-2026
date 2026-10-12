// MIT. Plan exact native service periods through the original customer closing cycle.
import type {
  AccountingStatementClient, NormalizedStatementSelection, StatementServiceCapture, StatementServicePassIdentity,
  StatementCustomer, StatementBinding, RetainedStatement, StatementRun,
} from './accounting-statement-client.mjs';
import type {StatementCyclePrepareOptions, StatementCycleReport} from './accounting-statement-cycle.mjs';

type CompactCapture<T> = T extends unknown ? Omit<T, 'schema' | 'actor'> : never;
export type ServicePlannerCapture = CompactCapture<StatementServiceCapture>;
export type ServicePlannerNativeCapture = Extract<ServicePlannerCapture, {periodEligible: true}>;
export type ServicePlannerCustomer = Pick<StatementCustomer, 'id' | 'reference' | 'name' | 'version'>;
export type ServicePlannerBinding = Pick<StatementBinding, 'id' | 'orderRef' | 'customerId' | 'label' | 'version' | 'historyCount'>;
export type ServicePlannerRun = Pick<StatementRun, 'id' | 'name' | 'status' | 'createdAt' | 'completedAt' | 'reportSha256' | 'period'>;
export type ServicePlannerStatement = Pick<RetainedStatement,
  'id' | 'number' | 'customerId' | 'customerReference' | 'customerName' | 'runId' | 'usageId' |
  'createdAt' | 'status' | 'replacesId' | 'supersededBy' | 'requestId' | 'previewSha256' | 'from' | 'until'> & {
  usageOpeningId: string | null; servicePeriod: {from: string; until: string; orderRef: string} | null;
};
export interface ServicePlannerPeriod extends Omit<ServicePlannerStatement, 'servicePeriod'> {
  servicePeriod: {from: string; until: string; orderRef: string}; sourceMatches: boolean;
  periodIdentitySha256: string | null;
  openingCapture: {id: string; sha256: string; createdAt: string} | null;
  closingCapture: {id: string; sha256: string; createdAt: string} | null;
}
export interface ServicePlannerNote {code: string; message: string; statementIds: string[];}
export interface ServicePlannerCoverage {
  gaps: Array<{from: string; until: string; precedingStatementIds: string[]; followingStatementId: string}>;
  overlaps: Array<{from: string; until: string; statementIds: string[]}>;
  boundaries: Array<{at: string; statementIds: string[]; closingCaptureIds: string[]; openingCaptureId: string}>;
}
export interface ServicePlannerSuggestion {
  openingId: string | null; closingId: string | null; basis: 'FIRST_CAPTURE' | 'CURRENT_PERIOD';
  basisStatementIds: string[];
  state: 'CHOOSE_CAPTURES' | 'NEXT_CAPTURE_AVAILABLE' | 'FIRST_PERIOD' | 'NO_LATER_CAPTURE';
}
export interface ServicePlannerRow {
  id: string; customer: ServicePlannerCustomer; binding: ServicePlannerBinding;
  pass: StatementServicePassIdentity; planLabel: string; periodIdentitySha256: string;
  captures: ServicePlannerNativeCapture[]; history: ServicePlannerPeriod[];
  otherCustomerHistory: ServicePlannerPeriod[]; unresolvedHistory: ServicePlannerPeriod[];
  cumulativeStatements: ServicePlannerStatement[]; coverage: ServicePlannerCoverage; suggestion: ServicePlannerSuggestion;
  warnings: ServicePlannerNote[];
  counts: {captures: number; current: number; superseded: number; withdrawn: number; cumulative: number};
}
export interface ServicePlannerInventory {
  schema: 'stellar-forge.accounting-statement-service-planner.v1';
  workspace: string; endpoint: string | null; revision: number; observedAt: string; inventorySha256: string;
  customers: ServicePlannerCustomer[]; bindings: ServicePlannerBinding[]; captures: ServicePlannerCapture[];
  statements: ServicePlannerStatement[]; runs: ServicePlannerRun[]; rows: ServicePlannerRow[];
  unassigned: Array<{captureId: string; orderRef: string; name: string; sourceCreatedAt: string}>;
  counts: {customers: number; passes: number; captures: number; nativeCaptures: number; otherCaptures: number;
    unassignedCaptures: number; readyPasses: number; passesWithHistoryNotes: number};
}
export interface ServicePlannerChoice {
  rowId: string; runId: string; usageOpeningId: string; usageId: string;
  replacesId?: string | null; from?: string; until?: string;
}
export interface ServiceClosePlanRow {
  index: number; rowId: string; customer: ServicePlannerCustomer; binding: ServicePlannerBinding;
  pass: StatementServicePassIdentity; planLabel: string; periodIdentitySha256: string;
  opening: ServicePlannerNativeCapture; closing: ServicePlannerNativeCapture; run: ServicePlannerRun;
  selection: NormalizedStatementSelection; replaces: ServicePlannerPeriod | null; warnings: ServicePlannerNote[];
}
export interface ServiceClosePlan {
  schema: 'stellar-forge.accounting-statement-service-plan.v1';
  workspace: string; endpoint: string | null; inventorySha256: string; inventoryRevision: number;
  observedAt: string; rows: ServiceClosePlanRow[]; selections: NormalizedStatementSelection[];
  counts: {statements: number; customers: number; corrections: number; withNotes: number}; planSha256: string;
}
export function readAccountingStatementServicePlanner(options: {
  client: AccountingStatementClient & {readonly endpoint?: string}; signal?: AbortSignal;
}): Promise<ServicePlannerInventory>;
export function compileAccountingStatementServicePlan(options: {
  inventory: ServicePlannerInventory; choices: ServicePlannerChoice[];
}): ServiceClosePlan;
export function validateAccountingStatementServicePlan(plan: unknown): ServiceClosePlan;
export function prepareAccountingStatementServiceCycle(options:
  Omit<StatementCyclePrepareOptions, 'selections'> & {plan: ServiceClosePlan}
): Promise<StatementCycleReport>;
export function renderAccountingStatementServicePlanCsv(plan: ServiceClosePlan): string;
export function renderAccountingStatementServicePlanHtml(plan: ServiceClosePlan): string;
