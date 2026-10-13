import type {DocumentProviderId,DocumentSetup,DocumentInstallation} from './index.mjs';
import type {openDocumentService} from './launch.mjs';
import type {openDocumentBatchCustomer} from './batch.mjs';
export const DOCUMENT_ACCOUNT_SOURCE_SCHEMA:'stellar-forge.document-account-source.v1';
export const DOCUMENT_COMMISSIONING_SCHEMA:'stellar-forge.document-commerce-commissioning.v1';
export const DOCUMENT_COMMISSIONING_REVIEW_SCHEMA:'stellar-forge.document-commerce-review.v1';
export interface DocumentCommissioningCommonOptions{
  directory:string;provider?:DocumentProviderId;anonymous?:boolean;
  customerOptionsFile?:string|null;customerDirectory?:string|null;
  /** Complete explicit PDFMint assembly payment JSON, constrained by the retained original facilitator policy. */
  assemblyPaymentFile?:string;
  sellerPort?:number;customerPort?:number;operatorPort?:number;operationsPort?:number;
}
export type DocumentCommissioningOptions=DocumentCommissioningCommonOptions&(
  {commerceDirectory:string;intentId:string;accountSourceFile?:never}|
  {accountSourceFile:string;commerceDirectory?:never;intentId?:never});
export interface DocumentAccountSource{
  schema:typeof DOCUMENT_ACCOUNT_SOURCE_SCHEMA;operatorProfileFile:string;facilitatorConfigFile:string;
  publicOrigin:string;payment:DocumentSetup['payment'];
}
export interface CommissioningFile{path:string;bytes:number;sha256:string}
export interface OriginalDocumentCommerce{
  commerceDirectory?:string;operatorWorkspace:string|null;intentId:string|null;routeId:string|null;acceptIndex:number|null;
  sourceKind?:'OPERATOR_PROFILE';accountSource?:CommissioningFile;operatorProfile?:CommissioningFile;
  operatorOwner?:{python:string;actor:string;service:string;policy:string;ledger:string};
  originalTerms:DocumentSetup['payment'];publicOrigin:string;payer:string;
  sharedBudget:{maxSingleAtomic:string;totalAtomic:string;dailyAtomic:string;selectedTotalAtomic:string;allSelectionsFitTotal:boolean}|
    {policyFile:string;ledger:string;actor:string;service:string};
  facilitator:CommissioningFile;
}
export interface DocumentCommissioningReview{
  schema:typeof DOCUMENT_COMMISSIONING_REVIEW_SCHEMA;selectionSha256:string;
  options:Omit<Required<DocumentCommissioningCommonOptions>,'assemblyPaymentFile'>&Pick<DocumentCommissioningCommonOptions,'assemblyPaymentFile'>&({commerceDirectory:string;intentId:string}|{accountSourceFile:string});original:OriginalDocumentCommerce;
  configurationFiles:CommissioningFile[];sourceFiles:CommissioningFile[];request:DocumentSetup;
  customer:Parameters<typeof openDocumentBatchCustomer>[0];
  paths:{merchant:string;factory:string;customerOptions:string;consumerOptions:string;compositionOptions:string;sourceRoot:string};
  environmentNames:string[];
}
export interface DocumentCommissioning{
  schema:typeof DOCUMENT_COMMISSIONING_SCHEMA;directory:string;selectionSha256:string;
  original:OriginalDocumentCommerce;installation:DocumentInstallation;assemblyPayment?:DocumentSetup['payment'];customerOptions:string;
  consumerOptions:string;compositionOptions:string;sourceRoot:string;nativeFactory:string;nativeFactoryFile:CommissioningFile;environmentNames:string[];
  serviceOptions:Parameters<typeof openDocumentService>[0];
  routes:{origin:string;seller:string[];customerPrefix:'/jobs/';privateListeners:string[]};budgetMeaning:string;
}
export function reviewDocumentCommissioning(options:DocumentCommissioningOptions):Promise<DocumentCommissioningReview>;
export function prepareDocumentCommissioning(options:DocumentCommissioningOptions,control?:{expectedSelection?:string}):Promise<DocumentCommissioning>;
export function inspectDocumentCommissioning(directory:string):Promise<DocumentCommissioning>;
export function openCommissionedDocumentService(options:{directory:string;expectedSelection?:string},control?:{
  environment?:Record<string,string|undefined>;signal?:AbortSignal;launchFile?:string|null;launchSourceDirectory?:string;
}):Promise<{
  commissioning:DocumentCommissioning;service:Awaited<ReturnType<typeof openDocumentService>>;
  launch:Awaited<ReturnType<typeof openDocumentService>>['launch'];
  closed:Promise<{state:'STOPPED';selectionSha256:string}>;
  close():Promise<{state:'STOPPED';selectionSha256:string}>;
}>;
