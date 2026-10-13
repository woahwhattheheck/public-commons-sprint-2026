// MIT. Complete agent operation over the original recorded cohort delivery engine.
import type {GrantJsonResponse} from './agent-client.mjs';
import type {CohortAdoptionClient,CohortAdoptionCase,CohortAdoptionCaseSource,
  CohortAdoptionPrepared,CohortAdoptionSaved,CohortAdoptionReceipt,CohortAdoptionRequestStatus,CohortAdoptionExport}
  from './cohort_planning_agent.mjs';
import type {CohortDeliveryInput,CohortDeliveryComparison,DeliveryIdentityLink,DeliveryIntentAssignment,
  DeliveryFinding,CohortCommercialChoices,CohortOriginalCostReceive} from './cohort_delivery_comparison.mjs';
export const COHORT_DELIVERY_AGENT_SCHEMA:'stellar-forge.sf47-cohort-delivery-agent.v1';
export interface CohortDeliverySourceSelection {
  expectedVersion:number;planSourceId:string;expectedPlanSha256:string;reviewId:string;
  expectedReviewBusinessSha256?:string;
}
export interface CohortDeliveryNativeSources {
  plan:CohortAdoptionCaseSource;
  review:{id:string;version:number;businessSha256:string;measurementSha256:string;previewSha256:string;
    responseSha256?:string;responseBytes?:number};
}
export interface CohortDeliveryAgentResult {
  schema:typeof COHORT_DELIVERY_AGENT_SCHEMA;
  state:'CALCULATED'|'EDITABLE_INPUT';
  document:CohortDeliveryComparison|CohortDeliveryInput;
  summary:CohortDeliveryComparison['summary']|null;
  source:CohortDeliveryComparison['source']|null;
  issues:Array<DeliveryFinding & {path?:string}>;
  case?:CohortAdoptionCase;nativeSources?:CohortDeliveryNativeSources;
  previousDocument?:CohortDeliveryComparison|CohortDeliveryInput;
  savedSource?:CohortAdoptionCaseSource;changes?:CohortDeliveryAgentEdit[];
}
export type CohortDeliveryAgentEdit =
  ({action:'LINK_IDENTITY'} & DeliveryIdentityLink)|
  {action:'UNLINK_IDENTITY';kind:DeliveryIdentityLink['kind'];plannedId:string}|
  ({action:'PLACE_INTENT'} & DeliveryIntentAssignment)|
  {action:'CLEAR_PLACEMENT';intentId:string}|
  {action:'TITLE_NOTE';title?:string;note?:string}|
  {action:'START_COMMERCIAL'}|{action:'REMOVE_COMMERCIAL'}|{action:'SET_COMMERCIAL';commercial:CohortCommercialChoices}|
  {action:'RECEIVE_ORIGINAL_COSTS';originalCosts:CohortOriginalCostReceive}|{action:'REMOVE_ORIGINAL_COSTS'};
export type CohortDeliveryAgentDocument=CohortDeliveryComparison|CohortDeliveryInput|
  CohortDeliveryAgentResult|CohortAdoptionPrepared|CohortAdoptionSaved;
export interface CohortDeliveryAgentPrepare {
  expectedVersion:number;requestId:string;actor:string;note:string;createdAt:string;
  document:CohortDeliveryAgentDocument;
}
export function seedGrantCohortDelivery(client:CohortAdoptionClient,caseId:string,
  options:CohortDeliverySourceSelection & {title?:string;note?:string}):Promise<CohortDeliveryAgentResult>;
export function editCohortDelivery(document:CohortDeliveryAgentDocument|unknown,
  changes:CohortDeliveryAgentEdit[]):CohortDeliveryAgentResult;
/** Full original source replacement retains prior choices; invalid associations remain editable with exact findings. */
export function refreshGrantCohortDelivery(client:CohortAdoptionClient,caseId:string,
  document:CohortDeliveryAgentDocument|unknown,selection:CohortDeliverySourceSelection):Promise<CohortDeliveryAgentResult>;
export function calculateCohortDelivery(document:CohortDeliveryAgentDocument|unknown):CohortDeliveryComparison;
export function reviewGrantCohortDelivery(client:CohortAdoptionClient,caseId:string,expectedVersion:number,
  document:CohortDeliveryAgentDocument|unknown):Promise<CohortDeliveryAgentResult>;
export function prepareGrantCohortDelivery(client:CohortAdoptionClient,caseId:string,
  body:CohortDeliveryAgentPrepare):Promise<CohortAdoptionPrepared>;
export function saveGrantCohortDelivery(client:CohortAdoptionClient,prepared:CohortAdoptionPrepared,
  expectedSha256:string,options:{acceptedResponse?:GrantJsonResponse<CohortAdoptionReceipt>|null;
    retainResponse:(response:GrantJsonResponse<CohortAdoptionReceipt>)=>Promise<void>}):Promise<CohortAdoptionSaved>;
export function inspectGrantCohortDeliveryRequest(client:CohortAdoptionClient,prepared:CohortAdoptionPrepared,
  expectedSha256:string,options?:{acceptedResult?:GrantJsonResponse<CohortAdoptionReceipt>|CohortAdoptionReceipt|null}):
  Promise<CohortAdoptionRequestStatus>;
export function openGrantCohortDelivery(client:CohortAdoptionClient,caseId:string,sourceId:string,
  expectedSourceSha256:string):Promise<CohortDeliveryAgentResult>;
export function exportGrantCohortDelivery(document:CohortDeliveryAgentDocument|unknown,
  format?:'JSON'|'CSV'|'HTML'):CohortAdoptionExport;
