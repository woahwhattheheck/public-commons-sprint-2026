// MIT. Whole adoption operations over the original Grant workspace client.
import type {Buffer} from 'node:buffer';
import type {CohortDeliveryInput,CohortDeliveryComparison,CohortRecordedCostPlan,CohortRecordedCostChoices} from './cohort_delivery_comparison.mjs';
import type {GrantWorkspaceClient,GrantJsonResponse,
  GrantCustomerUseCalendar,GrantCustomerUseEditionSelection} from './agent-client.mjs';
import type {CohortPlan,CohortPlanDocument,CohortPlanReport,CohortPlanComparison,
  NativeCohortPlanningSeed,PlanningDeliveryScheduling,PlanningComparisonOptions,
  TimestampText,DateText} from './cohort_planning.mjs';
import type {CohortDeliverySchedule,DeliveryAllocationOptions} from './cohort_planning_scheduling.mjs';

export const COHORT_PLAN_EDITION_SCHEMA: 'stellar-forge.sf47-cohort-plan-edition.v1';
export const COHORT_ADOPTION_SEED_SCHEMA: 'stellar-forge.sf47-cohort-adoption-seed.v1';
export const COHORT_ADOPTION_REVIEW_SCHEMA: 'stellar-forge.sf47-cohort-adoption-review.v1';
export const COHORT_ADOPTION_PREPARED_SCHEMA: 'stellar-forge.sf47-cohort-adoption-prepared.v1';
export const COHORT_ADOPTION_SAVED_SCHEMA: 'stellar-forge.sf47-cohort-adoption-saved.v1';
export type CohortAdoptionClient = Pick<GrantWorkspaceClient,
  'read'|'cohortSeed'|'customerUseCalendar'|'customerUseCalendarCohort'|'attach'|'download'>;
export interface CohortAdoptionCase {
  id: string; createdAt: TimestampText; version: number; planId: string;
  planRevision: number; state: string; name: string;
}
export interface CohortAdoptionSourceFile {
  filename: string; mediaType: 'application/json'; bytes: number; sha256: string;
}
export interface CohortAdoptionCaseSource {
  id:string;filename:string;mediaType:string;kind:string;sourceUrl:string;
  observedAt:TimestampText;createdAt:TimestampText;bytes:number;sha256:string;
}
export interface CohortAdoptionNativeSource extends CohortAdoptionCaseSource {
  mediaType:'application/json';kind:'other';sourceUrl:'';
}
export interface CohortAdoptionEdition {
  schema: typeof COHORT_PLAN_EDITION_SCHEMA;
  editionId: string; createdAt: TimestampText; actor: string; parentSourceId: string|null;
  plan: CohortPlan; report: CohortPlanReport; nativeSeed: NativeCohortPlanningSeed;
  deliverySchedule?: CohortDeliverySchedule; comparison?: CohortPlanComparison;
  recordedCostPlan?:CohortRecordedCostPlan;recordedCostPlanComparison?:CohortPlanComparison;
}
export type CohortAdoptionDocument = CohortPlanDocument|CohortPlanComparison|CohortAdoptionEdition|
  CohortAdoptionSeed|CohortAdoptionReview|CohortAdoptionPrepared|CohortAdoptionSaved|CohortDeliveryInput|CohortDeliveryComparison|CohortRecordedCostPlan;
export interface CohortAdoptionSeed {
  schema: typeof COHORT_ADOPTION_SEED_SCHEMA; sourceKind: 'CASE'|'CALENDAR';
  case: CohortAdoptionCase; nativeSeed: NativeCohortPlanningSeed;
  calendarSelection?: GrantCustomerUseCalendar;
  plan: CohortPlan; report: CohortPlanReport; schedulingChoices: PlanningDeliveryScheduling;
}
export interface CohortAdoptionReview {
  schema: typeof COHORT_ADOPTION_REVIEW_SCHEMA;
  document: CohortPlanDocument|CohortPlanComparison|CohortAdoptionEdition|CohortDeliveryComparison|CohortRecordedCostPlan;
  recordedCostPlan?:CohortRecordedCostPlan;
  plan?: CohortPlan; report?: CohortPlanReport; comparison?: CohortPlanComparison;
  deliverySchedule?: CohortDeliverySchedule; case?: CohortAdoptionCase;
  nativeSeed?: NativeCohortPlanningSeed; changes?: CohortAdoptionEdit[];
  recordedDelivery?:Pick<CohortDeliveryComparison,'summary'|'source'|'issues'>;
  nativeSources?:import('./cohort_delivery_agent.mjs').CohortDeliveryNativeSources;
}
export type CohortAdoptionSeedOptions = {
  expectedVersion: number; name?: string; draftId?: string; asOfAt?: TimestampText;
} & ({
  source: 'CASE'; tranche: 2|3; windowStart?: DateText;
  groupId?: never; installationRefs?: never;
}|{
  source: 'CALENDAR'; groupId: string; installationRefs?: GrantCustomerUseEditionSelection[];
  tranche?: never; windowStart?: never;
});
export type CohortAdoptionCollection =
  'buyers'|'merchants'|'facilitators'|'operations'|'schedules'|'workshares'|'capacityPools'|'fundingGroups';
export type CohortAdoptionEdit = {
  action:'FROM_RECORDED_COSTS';recordedDocument:CohortDeliveryInput|CohortDeliveryComparison;choices:CohortRecordedCostChoices;
}|{
  action: 'PLAN';
  fields: Partial<Pick<CohortPlan,'name'|'asOfAt'|'windowStart'|'calendar'|'sensitivity'|'note'|'deliveryScheduling'>>;
}|{
  action: 'UPDATE'; collection: CohortAdoptionCollection; id: string;
  /** Nested object fields merge, arrays replace in full, and id/origin stay original. */
  fields: Record<string,unknown>;
}|{
  action: 'ADD'; collection: CohortAdoptionCollection; value: Record<string,unknown>; beforeId?: string;
}|{
  action: 'REMOVE'; collection: CohortAdoptionCollection; id: string;
};
export interface CohortAdoptionPrepareInput {
  expectedVersion: number; requestId: string; actor: string; note: string;
  /** Keep exactly the same UTC creation time and complete input on original-request retries. */
  createdAt: TimestampText; document: CohortAdoptionDocument;
  parentSourceId?: string; expectedParentSha256?: string;
}
export interface CohortAdoptionSourceRequest {
  expectedVersion: number; requestId: string; actor: string; note: string; action: 'source.add';
  data: {kind:'other';filename:string;contentBase64:string;mediaType:'application/json';
    sourceUrl:'';observedAt:TimestampText};
}
export interface CohortAdoptionPrepared {
  schema: typeof COHORT_ADOPTION_PREPARED_SCHEMA;
  caseId: string; caseCreatedAt: TimestampText; case: CohortAdoptionCase;
  document: CohortAdoptionEdition|CohortPlanComparison|CohortDeliveryComparison;
  nativeSeed: NativeCohortPlanningSeed|null; parentSource: CohortAdoptionCaseSource|null;
  sourceFile: CohortAdoptionSourceFile; request: CohortAdoptionSourceRequest; preparedSha256: string;
}
export interface CohortAdoptionReceipt {
  id: string; version: number; action: 'source.add'; kind: 'source'; recordId: string;
}
export interface CohortAdoptionEvent {
  version:number;at:TimestampText;actor:string;note:string;requestId:string;
  action:'source.add';kind:'source';recordId:string;before:null;after:CohortAdoptionNativeSource;sha256:string;
}
export interface CohortAdoptionRequestStatus {
  state:'PREPARED'|'COMMITTED';case:CohortAdoptionCase;
  event:CohortAdoptionEvent|null;source:CohortAdoptionNativeSource|null;
  acceptedResult:CohortAdoptionReceipt|null;
}
export interface CohortAdoptionSaved extends Omit<CohortAdoptionReview,'schema'|'case'> {
  schema:typeof COHORT_ADOPTION_SAVED_SCHEMA;case:CohortAdoptionCase;preparedSha256:string;
  originalRequestId:string;receipt:CohortAdoptionReceipt;source:CohortAdoptionNativeSource;
  recovered:boolean;
}
export interface CohortAdoptionExport {
  bytes:Buffer;sha256:string;mediaType:string;filename:string;
}
export function seedGrantCohortAdoption(client:CohortAdoptionClient,caseId:string,
  options:CohortAdoptionSeedOptions):Promise<CohortAdoptionSeed>;
export function reviewCohortAdoption(document:CohortAdoptionDocument|unknown,
  options?:{nativeSeed?:NativeCohortPlanningSeed}):CohortAdoptionReview;
export function reviewGrantCohortAdoption(client:CohortAdoptionClient,caseId:string,expectedVersion:number,
  document:CohortAdoptionDocument|unknown):Promise<CohortAdoptionReview>;
export function editCohortAdoption(document:CohortAdoptionDocument|unknown,changes:CohortAdoptionEdit[],
  options?:Pick<PlanningComparisonOptions,'title'|'note'>):CohortAdoptionReview;
export interface CohortAdoptionSchedulingInput extends DeliveryAllocationOptions {
  document:CohortAdoptionDocument|unknown;
  constraints?:PlanningDeliveryScheduling;
}
/** The selected method and complete competing-group decisions travel with the original allocation. */
export function scheduleCohortAdoption(input:CohortAdoptionSchedulingInput):CohortDeliverySchedule;
export function compareCohortAdoption(input:{beforeDocument:CohortAdoptionDocument|unknown;
  afterDocument:CohortAdoptionDocument|unknown;options?:PlanningComparisonOptions}):CohortPlanComparison;
export function rebaseGrantCohortAdoption(client:CohortAdoptionClient,caseId:string,expectedVersion:number,
  document:CohortAdoptionDocument|unknown):Promise<CohortAdoptionReview>;
export function cohortAdoptionPreparedSha256(prepared:Omit<CohortAdoptionPrepared,'preparedSha256'>|
  CohortAdoptionPrepared):string;
export function prepareGrantCohortAdoption(client:CohortAdoptionClient,caseId:string,
  body:CohortAdoptionPrepareInput):Promise<CohortAdoptionPrepared>;
export function validateCohortAdoptionPrepared(prepared:unknown,expectedSha256:string):CohortAdoptionPrepared;
export function inspectGrantCohortAdoptionRequest(client:CohortAdoptionClient,prepared:CohortAdoptionPrepared,
  expectedSha256:string,options?:{acceptedResult?:GrantJsonResponse<CohortAdoptionReceipt>|CohortAdoptionReceipt|null}):
  Promise<CohortAdoptionRequestStatus>;
export function saveGrantCohortAdoption(client:CohortAdoptionClient,prepared:CohortAdoptionPrepared,
  expectedSha256:string,options:{acceptedResponse?:GrantJsonResponse<CohortAdoptionReceipt>|null;
    /** Persist every original response byte before this callback resolves. The Merchant MCP owner supplies this. */
    retainResponse:(response:GrantJsonResponse<CohortAdoptionReceipt>)=>Promise<void>}):Promise<CohortAdoptionSaved>;
export function openGrantCohortAdoption(client:CohortAdoptionClient,caseId:string,sourceId:string,
  expectedSourceSha256:string):Promise<CohortAdoptionReview & {case:CohortAdoptionCase;source:CohortAdoptionNativeSource}>;
export function exportCohortAdoption(document:CohortAdoptionDocument|unknown,format?:'JSON'|'CSV'|'HTML'):CohortAdoptionExport;
