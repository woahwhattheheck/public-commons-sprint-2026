// MIT. Complete customer-update wire and borrowed-client types.
export type Json = null | boolean | number | string | Json[] | { [key:string]: Json };
export interface CustomerActor { id:string; name:string; }
export interface CustomerFile { sha256:string; bytes:number; }
export interface CustomerSourcePlan {
  id:string; name:string; questionId:string; provider:string; query:string;
  parameters:{[key:string]:Json}; original:{[key:string]:Json}; terms:string; constraints:string;
}
export interface CustomerOutput { id:string; label:string; format:string; acceptance:string; }
export interface CustomerBrief {
  name:string; customer:{id:string;name:string;reference:string}; purpose:string; owner:CustomerActor; questionIds:string[];
  protocol:{title:string;version:string;source:string;notes:string}; sourcePlans:CustomerSourcePlan[]; outputs:CustomerOutput[];
  scope:{currency:string;amount:string;unit:string;note:string;reference:string}; updatePolicy:string;
}
export interface CustomerPeriod { planId:string; from:string; until:string; field:string; notes:string; }
export interface CustomerRequestedUpdate {
  briefId:string; kind:'BASELINE'|'UPDATE'|'CORRECTION'; previousDeliveryId:string|null; label:string;
  request:{by:CustomerActor;receivedAt:string;reference:string;note:string}; periods:CustomerPeriod[]; instructions:string;
}
export interface CustomerRecordSelection { path:string; sha256:string; label?:string; }
export interface CustomerWorkSelection { intakeIds:string[]; records:CustomerRecordSelection[]; }
export interface CustomerChangeDecision {
  sourceId:string; fingerprint:string; disposition:'reviewed'|'needs_review'|'not_applicable'; reason:string;
}
export interface CustomerAcceptance {
  outputId:string; status:'met'|'partly_met'|'not_met'|'not_applicable'|'not_reviewed'; note:string;
}
export interface CustomerReviewWorkInput {
  projectId:string; cycleId:string; requestEditionId:string; selection:CustomerWorkSelection; fingerprint:string;
  summary:string; limitations:string; changeDecisions:CustomerChangeDecision[]; acceptance:CustomerAcceptance[]; note:string;
}
export type CustomerUpdateActionData =
  | {action:'create-project';data:{brief:CustomerBrief}}
  | {action:'revise-brief';data:{projectId:string;expectedBriefId:string;brief:CustomerBrief;reason:string}}
  | {action:'record-agreement';data:{projectId:string;briefId:string;disposition:'PROPOSED'|'ACCEPTED'|'CHANGES_REQUESTED'|'DECLINED';
      by:CustomerActor;occurredAt:string;reference:string;message:string;records?:{[key:string]:Json}}}
  | {action:'request-update';data:{projectId:string;definition:CustomerRequestedUpdate}}
  | {action:'revise-request';data:{projectId:string;cycleId:string;expectedRequestEditionId:string;definition:CustomerRequestedUpdate;reason:string}}
  | {action:'attach-intake';data:{projectId:string;cycleId:string;requestEditionId:string;planId:string;editionIds:string[];
      original:{[key:string]:Json};note:string}}
  | {action:'review-work';data:CustomerReviewWorkInput}
  | {action:'publish-delivery';data:{projectId:string;workId:string;expectedWorkSha256:string;title:string;coverNote:string;deliveryNote:string}}
  | {action:'record-delivery';data:{projectId:string;deliveryId:string;status:'SENT'|'RECEIVED'|'ACCEPTED'|'CORRECTIONS_REQUESTED'|'WITHDRAWN';
      by:CustomerActor;occurredAt:string;channel:string;reference:string;message:string;original?:{[key:string]:Json}}}
  | {action:'set-project-status';data:{projectId:string;status:'ACTIVE'|'PAUSED'|'COMPLETE';reason:string}};
export type CustomerUpdateRequest = {requestId:string;expectedRevision:number;actor:CustomerActor} & CustomerUpdateActionData;
export interface CustomerEditionBase { id:string; projectId:string; createdAt:string; actor:CustomerActor; revision:number; }
export interface CustomerProject {
  id:string;name:string;customer:CustomerBrief['customer'];createdAt:string;actor:CustomerActor;revision:number;
  currentBriefId?:string;status?:'ACTIVE'|'PAUSED'|'COMPLETE';requestCount?:number;deliveryCount?:number;
}
export interface CustomerBriefEdition extends CustomerEditionBase { edition:number;definition:CustomerBrief;reason:string; }
export interface CustomerRequestEdition extends CustomerEditionBase {
  cycleId:string;edition:number;definition:CustomerRequestedUpdate;reason:string;current?:boolean;
  latestWorkId?:string|null;latestDeliveryId?:string|null;status?:'REQUESTED'|'SOURCE_ATTACHED'|'REVIEWED'|'PUBLISHED';
}
export interface CustomerIntake extends CustomerEditionBase {
  cycleId:string;requestEditionId:string;planId:string;editionIds:string[];editions:Json[];original:{[key:string]:Json};note:string;
}
export interface CustomerWork extends CustomerEditionBase {
  cycleId:string;requestEditionId:string;selection:CustomerWorkSelection;contextFingerprint:string;
  sourceRevision:number;sourceRevisionSha256:string;snapshot:CustomerFile;payloadSha256:string;summary:string;
  counts:{editions:number;retainedEditions:number;referenceEditions:number;occurrences:number;sources:number};
  changeCounts:Record<'ADDED'|'CHANGED'|'REMOVED'|'UNCHANGED',number>;acceptance:CustomerAcceptance[];sha256:string;
}
export type CustomerReportFormat = 'json'|'md'|'html'|'csv';
export interface CustomerReportFile extends CustomerFile { format:CustomerReportFormat;name:string;contentType:string; }
export interface CustomerDelivery extends CustomerEditionBase {
  cycleId:string;workId:string;workSha256:string;sourceRevision:number;requestEditionId:string;
  title:string;coverNote:string;deliveryNote:string;files:CustomerReportFile[];sha256:string;
}
export interface CustomerUpdateOperation {
  schema:'sf88-research-customer-update-operation/v1';id:string;dossierId:string;
  originalRevision:number;originalRevisionSha256:string;revision:number;requestId:string;requestSha256:string;
  action:CustomerUpdateRequest['action'];request:CustomerUpdateRequest;actor:CustomerActor;createdAt:string;
  result:{project?:CustomerProject;brief?:CustomerBriefEdition;agreement?:Json;updateRequest?:CustomerRequestEdition;
    intake?:CustomerIntake;work?:CustomerWork;delivery?:CustomerDelivery;deliveryEvent?:Json;projectStatus?:Json};
  sha256:string;
}
export interface CustomerDossierSummary {
  schema:string;id:string;title:string;description:string;revision:number;createdAt:string;updatedAt:string;[key:string]:unknown;
}
export interface CustomerReviewResult { dossier:CustomerDossierSummary;operation:CustomerUpdateOperation;duplicate:boolean; }
export type CustomerSection = 'overview'|'projects'|'briefs'|'agreements'|'requests'|'intakes'|'work'|'deliveries'|
  'delivery-events'|'operations'|'records'|'editions'|'questions';
export interface CustomerListOptions { revision?:number;projectId?:string;cycleId?:string;section?:CustomerSection;offset?:number;limit?:number;query?:string; }
export interface CustomerPage<T=Json> {
  schema:string;dossierId:string;revision:number;section:string;overview?:Record<string,number>;
  projects?:CustomerProject[];items?:T[];offset?:number;limit?:number;total?:number;nextOffset?:number|null;complete?:boolean;
  next?:{revision:number;offset:number;limit:number}|null;
}
export type CustomerPreviewSection = 'overview'|'changes'|'sources'|'records'|'intakes'|'editions'|'uncovered-plans';
export interface CustomerPreviewInput {
  revision?:number;projectId:string;cycleId:string;requestEditionId:string;selection:CustomerWorkSelection;
  section?:CustomerPreviewSection;offset?:number;limit?:number;fingerprint?:string;
}
export interface CustomerPreview extends CustomerPage {
  revisionSha256:string;fingerprint:string;project:CustomerProject;brief:CustomerBriefEdition;requested:CustomerRequestEdition;
  baseline:{workId:string;sourceRevision:number;previousDeliveryId:string;fingerprint:string}|null;
  counts:CustomerWork['counts'];changeCounts:CustomerWork['changeCounts'];recordCount:number;uncoveredPlanCount:number;currentBriefId:string;
}
export interface CustomerSavedWorkView extends CustomerPreview {
  schema:'sf88-research-customer-update-saved-work/v1';workspaceRevision:number;workId:string;createdAt:string;actor:CustomerActor;
  review:{summary:string;limitations:string;changeDecisions:CustomerChangeDecision[];acceptance:CustomerAcceptance[];note:string};
}
export interface CustomerNativeRecord {
  schema:'sf88-research-customer-update-record/v1';dossierId:string;revision:number;path:string;sha256:string;label:string;kind:string;record:Json;
}
export interface CustomerExportOptions {
  file:string;revision?:number;deliveryId?:string;workId?:string;
  format?:CustomerReportFormat|'portable'|'portable.gz';expectedSha256?:string;signal?:AbortSignal;
}
export interface CustomerDownload extends CustomerFile { file:string;filename:string;contentType:string;revision?:number; }
export interface CustomerTransportOptions { signal?:AbortSignal; }
export interface CustomerEuropePmcPlanInput {
  queryId:string;queryRevision:number;questionId:string;planId:string;name?:string;constraints?:string;library?:string;
}
export interface CustomerUpdatesClient {
  list<T=Json>(id:string,options?:CustomerListOptions,transport?:CustomerTransportOptions):Promise<CustomerPage<T>>;
  record(id:string,input:CustomerRecordSelection&{revision?:number},transport?:CustomerTransportOptions):Promise<CustomerNativeRecord>;
  preview(id:string,input:CustomerPreviewInput,transport?:CustomerTransportOptions):Promise<CustomerPreview>;
  review(id:string,input:CustomerUpdateRequest,transport?:CustomerTransportOptions):Promise<CustomerReviewResult>;
  work(id:string,input:{revision?:number;workId:string;section?:CustomerPreviewSection;offset?:number;limit?:number},
    transport?:CustomerTransportOptions):Promise<CustomerSavedWorkView>;
  export(id:string,input:CustomerExportOptions):Promise<CustomerDownload>;
  europePmcPlan(input:CustomerEuropePmcPlanInput,transport?:CustomerTransportOptions):Promise<{schema:'sf88-research-customer-source-plan/v1';plan:CustomerSourcePlan}>;
}
export function createCustomerUpdatesClient(transport:{
  request:(path:string,input?:unknown,options?:CustomerTransportOptions&{readOnly?:boolean})=>Promise<any>;
  download:(path:string,file:string,options?:{expectedSha256?:string;signal?:AbortSignal})=>Promise<CustomerDownload>;
}):CustomerUpdatesClient;


/** Complete portable browser working form. Receiving verifies the original native base hash. */
export type CustomerWorkingFormKind='brief'|'agreement'|'request'|'intake'|'work'|'delivery'|'delivery-response'|'project-status';
export interface CustomerWorkingFormPacket {
  schema:'sf88-research-customer-working-form/v1';
  source:{workspaceId:string;dossierId:string;projectId:string|null;revision:number;revisionSha256:string};
  form:{kind:CustomerWorkingFormKind;id:string;data:{[key:string]:Json};updatedAt:string;
    saved:{[key:string]:Json}|null;previousBases:Json[];origin:{[key:string]:Json}|null};
}
