import type {DocumentCommissioningReview,CommissioningFile,DocumentCommissioning} from './commissioning.mjs';
import type {DocumentServiceReceiving} from './launch.mjs';
import type {openCommissionedDocumentService} from './commissioning.mjs';
export const DOCUMENT_COMMISSIONING_APPLICATION_SCHEMA:'stellar-forge.document-commissioning-application.v1';
export interface DocumentCommissioningApplicationSelection{
  schema:typeof DOCUMENT_COMMISSIONING_APPLICATION_SCHEMA;sourceDirectory:string;optionsFile:CommissioningFile;
  review:DocumentCommissioningReview;merchantState:string;sourceFiles:CommissioningFile[];selectionSha256:string;
}
export interface DocumentCommissioningApplicationOptions{
  optionsFile:string;expectedSelection?:string;launchSourceDirectory?:string;launchFile?:string|null;
}
export interface DocumentCommissioningApplicationControl{
  environment?:Record<string,string|undefined>;signal?:AbortSignal;
}
export function readDocumentCommissioningApplicationSelection(options:{optionsFile:string}):
  Promise<DocumentCommissioningApplicationSelection>;
export function assertDocumentCommissioningApplicationSelection(value:unknown,expectedSelection?:string):
  DocumentCommissioningApplicationSelection;
export function openDocumentCommissioningApplication(options:DocumentCommissioningApplicationOptions,
  control?:DocumentCommissioningApplicationControl):
  Promise<Awaited<ReturnType<typeof openCommissionedDocumentService>>&{
    applicationSelection:DocumentCommissioningApplicationSelection;
  }>;
export function readDocumentCommissioningApplicationLaunch(options:{
  optionsFile:string;expectedSelection?:string;file:string;expected?:{pid?:number;instanceId?:string};signal?:AbortSignal;
}):Promise<DocumentServiceReceiving&{applicationSelection:DocumentCommissioningApplicationSelection;
  commissioning:DocumentCommissioning}>;
export function runDocumentCommissioningApplication(options:DocumentCommissioningApplicationOptions,
  control?:DocumentCommissioningApplicationControl&{print?:(text:string)=>unknown}):
  Promise<{state:'STOPPED';selectionSha256:string}|undefined>;
