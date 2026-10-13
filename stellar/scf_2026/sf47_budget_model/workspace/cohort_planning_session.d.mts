export const COHORT_WORKING_SESSION_SCHEMA: 'stellar-forge.sf47-cohort-working-session.v1';
export const COHORT_WORKING_STATE_SCHEMA: 'stellar-forge.sf47-cohort-planning-session.v1';
export const COHORT_WORKING_SESSION_MAX_BYTES: number;
export const COHORT_WORKING_STATE_FIELDS: readonly string[];
export type WorkingJson = null | boolean | number | string | WorkingJson[] | {[key:string]:WorkingJson};
export interface CohortPlanningWorkingState {
  schema: typeof COHORT_WORKING_STATE_SCHEMA;
  caseId: string;
  plan: Record<string,WorkingJson>|null;
  report: Record<string,WorkingJson>|null;
  reportInput: string;
  rowDrafts: Record<string,WorkingJson>;
  recordedCostMeasurementEditor?:{sourceId:string;source:import('./cohort_delivery_comparison.mjs').CohortTaskMeasurementOriginal|null;
    kind:'INSTALLED'|'FOLLOWUP';observationId:string;serviceBasis:string};
  tranche: 2|3;
  tab: string;
  editor: Record<string,WorkingJson>|null;
  editorDraft: Record<string,WorkingJson>|null;
  priorDrafts: WorkingJson[];
  pages: Record<string,number>;
  [key:string]: unknown;
}
export interface CohortWorkingEntry {
  id: string;
  snapshotSha256: string;
  retainedAt: string;
  reason: string;
  origin?: Record<string,WorkingJson>;
  transportActive?: boolean;
}
export interface CohortWorkingSession {
  schema: typeof COHORT_WORKING_SESSION_SCHEMA;
  sessionId: string;
  caseId: string;
  exportedAt: string;
  current: CohortWorkingEntry;
  snapshots: Record<string,CohortPlanningWorkingState>;
  history: CohortWorkingEntry[];
  incoming: CohortWorkingEntry[];
}
export interface CohortPlanningWorkingArchive {
  workingSnapshots?: Record<string,CohortPlanningWorkingState>;
  workingHistory?: CohortWorkingEntry[];
  workingIncoming?: CohortWorkingEntry[];
}
export function cohortWorkingSessionSha256(text:string):Promise<string>;
export function captureCohortPlanningState(state:Record<string,unknown>):CohortPlanningWorkingState;
export function validateCohortPlanningState(state:unknown,caseId:string):CohortPlanningWorkingState;
export function reopenCohortWorkingSession(input:unknown,options?:{caseId?:string}):Promise<CohortWorkingSession>;
export function createCohortWorkingSession(state:CohortPlanningWorkingState&CohortPlanningWorkingArchive,
 options:{sessionId:string;exportedAt:string;transportActive?:boolean}):Promise<CohortWorkingSession>;
export function describeCohortWorkingState(state:CohortPlanningWorkingState):{
 name:string;tranche:2|3;sourceVersion:number|null;unfinishedRows:number;priorDrafts:number;
 comparisonHistory:number;incomingSources:number;allocationMethod:string|null;
 originalRequest:'PENDING'|'ACCEPTED'|null;requestId:string|null;
};
export function storeCohortWorkingSnapshots(caseId:string,snapshots:Record<string,CohortPlanningWorkingState>):Promise<boolean>;
export function loadCohortWorkingSnapshots(caseId:string,ids:string[]):Promise<Record<string,CohortPlanningWorkingState>>;
