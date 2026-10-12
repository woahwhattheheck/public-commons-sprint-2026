// MIT. Continue the existing native programme with its actual customer/source case.
import type {CustomerActor,CustomerBrief,CustomerRequestedUpdate,CustomerRecordSelection,CustomerReviewWorkInput,
  CustomerUpdateActionData,CustomerWork,CustomerDelivery,CustomerRequestEdition,CustomerReviewResult} from './client.mjs';
import type {ResearchCustomerClient,CustomerSourceWorkspaceSelection,CustomerHandoverFile,CustomerReceivingResult} from './operator.mjs';
export type CustomerProgrammeRequest=Omit<CustomerRequestedUpdate,'briefId'|'kind'|'previousDeliveryId'>;
export type CustomerProgrammeIntake=Omit<Extract<CustomerUpdateActionData,{action:'attach-intake'}>['data'],
  'projectId'|'cycleId'|'requestEditionId'>;
export type CustomerProgrammeReview=Omit<CustomerReviewWorkInput,'projectId'|'cycleId'|'requestEditionId'|'selection'|'fingerprint'>;
export type CustomerProgrammeDelivery=Omit<Extract<CustomerUpdateActionData,{action:'publish-delivery'}>['data'],
  'projectId'|'workId'|'expectedWorkSha256'>;
export type CustomerProgrammeDeliveryEvent=Omit<Extract<CustomerUpdateActionData,{action:'record-delivery'}>['data'],
  'projectId'|'deliveryId'>;
export interface CustomerProgrammePhase {
  request:CustomerProgrammeRequest;requestRevision?:CustomerProgrammeRequest;requestRevisionReason?:string;
  intakes:CustomerProgrammeIntake[];records?:CustomerRecordSelection[];review:CustomerProgrammeReview;
  delivery:CustomerProgrammeDelivery;deliveryEvent?:CustomerProgrammeDeliveryEvent;
  expectedChangeCounts?:Partial<Record<'ADDED'|'CHANGED'|'REMOVED'|'UNCHANGED',number>>;
}
export interface ResearchCustomerDeliveryCase {
  schema:'sf88-research-customer-delivery-case/v1';name:string;dossierId:string;actor:CustomerActor;
  baseline:CustomerProgrammePhase&{brief:CustomerBrief};
  update:CustomerProgrammePhase&{brief:CustomerBrief;briefReason:string;
    requestRevision:CustomerProgrammeRequest;requestRevisionReason:string};
  correction:CustomerProgrammePhase;
  sourceWorkspace?:CustomerSourceWorkspaceSelection;receivingSourceActor?:string;
}
export interface CustomerProgrammePhaseResult {request:CustomerRequestEdition;work:CustomerWork;delivery:CustomerDelivery;}
export interface ResearchCustomerDeliveryResult {
  schema:'sf88-research-customer-delivery-native-result/v1';caseSha256:string;name:string;directory:string;
  source:{workspaceId:string;dossierId:string};receiver:{workspaceId:string};projectId:string;
  baseline:CustomerProgrammePhaseResult;update:CustomerProgrammePhaseResult;correction:CustomerProgrammePhaseResult;
  delivery:{directory:string;manifestSha256:string;files:CustomerHandoverFile[]};
  receiving:CustomerReceivingResult;
  correctionDelivery:{directory:string;manifestSha256:string;files:CustomerHandoverFile[]};
  replays:{original:CustomerReviewResult;receiving:CustomerReviewResult};completedAt:string;reused:boolean;
}
export function runResearchCustomerDelivery(input:{sender:ResearchCustomerClient;receiver:ResearchCustomerClient;
  directory:string;caseDefinition:ResearchCustomerDeliveryCase}):Promise<ResearchCustomerDeliveryResult>;
