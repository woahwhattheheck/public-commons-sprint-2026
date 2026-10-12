// MIT. Whole native operator and complete editable customer handover.
import type {CustomerUpdateRequest,CustomerReviewResult,CustomerUpdatesClient,CustomerDelivery,CustomerWork,CustomerFile,Json} from './client.mjs';
export interface ResearchCustomerClient {
  status():Promise<{workspaceId:string;[key:string]:unknown}>;
  metadata(id:string,options?:{revision?:number}):Promise<{id:string;revision:number;[key:string]:unknown}>;
  customerUpdates():CustomerUpdatesClient;
  reopenFile(file:string,options:{expectedSha256:string}):Promise<{dossier:{id:string;revision:number;[key:string]:unknown};source:CustomerFile}>;
  europePmc():{
    list(options?:{limit?:number}):Promise<{id:string;selection:{library:string};[key:string]:unknown}>;
    exportWorkspace(input:{requestId:string;actor:string}):Promise<CustomerFile&{[key:string]:unknown}>;
    downloadWorkspace(input:{requestId:string;file:string;expectedSha256:string}):Promise<unknown>;
    restoreFile(input:{requestId:string;actor:string;file:string;expectedSha256:string}):Promise<unknown>;
  };
}
export interface CustomerSourceWorkspaceSelection { library:string;actor:string;requestId:string; }
export interface CustomerHandoverFile extends CustomerFile {
  name:string;kind:'report'|'work'|'dossier'|'europe-pmc';format?:'json'|'md'|'html'|'csv';contentType:string;
}
export interface CustomerHandoverSelection {
  workspaceId:string;dossierId:string;revision:number;projectId:string;delivery:CustomerDelivery;work:CustomerWork;
  sourceWorkspace:CustomerSourceWorkspaceSelection|null;
}
export interface CustomerHandoverManifest {
  schema:'sf88-research-customer-handover/v1';createdAt:string;selection:CustomerHandoverSelection;files:CustomerHandoverFile[];
}
export interface CustomerHandover {
  schema:'sf88-research-customer-handover-inspected/v1';directory:string;manifestSha256:string;manifestBytes:number;
  manifest:CustomerHandoverManifest;selection:CustomerHandoverSelection;
  files:(CustomerHandoverFile&{path:string})[];
  portable:{dossierId:string;revision:number;headSha256:string;versions:number;blobs:number;projectId:string;deliveryId:string;bytes:number;sha256:string};
  reused?:boolean;
}
export interface CustomerSavedResult {
  schema:'sf88-research-customer-saved-result/v1';workspaceId:string;dossierId:string;requestSha256:string;
  result:CustomerReviewResult;completedAt:string;directory:string;reused:boolean;
}
export interface CustomerReceivingResult {
  schema:'sf88-research-customer-receiving-result/v1';workspaceId:string;manifestSha256:string;dossierId:string;projectId:string;
  deliveryId:string;revision:number;dossier:unknown;sourceWorkspace:unknown;completedAt:string;directory:string;reused:boolean;
}
export interface CustomerSavedExport {
  schema:'sf88-research-customer-export-result/v1';workspaceId:string;requestSha256:string;selection:CustomerDelivery|CustomerWork;
  file:CustomerFile&{name:string;path:string;contentType:string};completedAt:string;directory:string;reused:boolean;
}
export function submitCustomerUpdate(input:{
  client?:ResearchCustomerClient|null;directory:string;dossierId:string;inputFile?:string;input?:CustomerUpdateRequest;
}):Promise<CustomerSavedResult>;
export function findCustomerRecord<T=Json>(client:ResearchCustomerClient,id:string,section:string,recordId:string,
  options?:{revision?:number;projectId?:string}):Promise<{record:T;revision:number}>;
export function createCustomerHandover(input:{
  client?:ResearchCustomerClient|null;directory:string;dossierId:string;deliveryId:string;revision?:number;
  sourceWorkspace?:CustomerSourceWorkspaceSelection|null;
}):Promise<CustomerHandover>;
export function receiveCustomerHandover(input:{
  client?:ResearchCustomerClient|null;directory:string;sourceDirectory?:string;manifestSha256?:string;sourceActor?:string;
}):Promise<CustomerReceivingResult>;
export function retainCustomerExport(input:{
  client?:ResearchCustomerClient|null;directory:string;dossierId:string;deliveryId?:string;workId?:string;revision?:number;
  format?:'json'|'md'|'html'|'csv'|'portable'|'portable.gz';expectedSha256?:string;
}):Promise<CustomerSavedExport>;
export function readCustomerOperation(directory:string):Promise<{
  schema:'sf88-research-customer-operation-inspected/v1';directory:string;files:Record<string,unknown>;
}>;
