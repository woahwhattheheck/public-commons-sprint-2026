// SPDX-License-Identifier: MIT
export type Hash = string;
export type UUID = string;
export type OriginalId = string;
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export interface IncomingFile {filename:string;bytes:number;sha256:Hash}
export interface OriginalFile {
  name:string;bytes:number;sha256:Hash;type:string;
  storage:{operationId:OriginalId;filename:string};
}
export interface FileSelection {kind:'analysis';id:OriginalId;file?:string}
export interface ListedFile {name:string;bytes:number;sha256:Hash;type:string;selection:FileSelection}
export interface Payment {
  scheme:string;network:'stellar:testnet'|'stellar:pubnet';asset:string;amount:string;
  payTo:string;maxTimeoutSeconds:number;extra:Record<string,Json>;
}
export interface OfferPayload {
  publicationId:OriginalId;expectedPublicationSha256:Hash;exportId:OriginalId;expectedArchiveSha256:Hash;
  title:string;description:string;license:string;reason:string;origin:string;routePrefix:string;
  payment:Payment;companions:string[];actor:string;
}
export interface OperationsSelection {
  caseId:string;deploymentId:string;purchaseId:string|null;expectedCaseVersion:number;
  expectedPreviewSha256:Hash;origin:string;
}
export interface ReceivingPayload {
  projectId:OriginalId;versionId:OriginalId;catalog:IncomingFile;handoff:IncomingFile;response:IncomingFile;
  rowIndex:number;acceptIndex:number;jobId:string;publicationId:OriginalId;expectedPublicationSha256:Hash;
  decision:'received'|'changes_requested';reason:string;operations:OperationsSelection|null;actor:string;
}
export interface OriginalRequest<P extends object=Record<string,Json>> {
  action:string;operationId:OriginalId;expectedRevision:number;payload:P;
}
export interface MerchantRecord {
  schema:'stellar-forge.sensorthings-analysis-merchant-record.v1';
  id:Hash;originWorkspaceId:UUID;operationId:OriginalId;requestSha256:Hash;
  kind:'offer'|'buyer-preparation'|'inbox-capture'|'receiving'|'service-start'|'service-stop';
  projectId:OriginalId;versionId:OriginalId;publicationId:OriginalId;createdAt:string;actor:string;
  value:Record<string,Json>;files:OriginalFile[];journal:OriginalFile;
}
export class MerchantClientError extends Error {
  code:string;status:number;detail:unknown;operationId:string|null;
}
export class AnalysisMerchantClient {
  constructor(options:{origin:string;token:string;workspaceId?:UUID|null;fetch?:typeof fetch;timeoutMs?:number});
  origin:string;workspaceId:UUID|null;readonly key:string;
  connect():Promise<Record<string,Json>>;close():void;privateLink(path?:string):string;
  request(path:string,options?:{rawBody?:string;maximum?:number;binary?:boolean;allowUnbound?:boolean;signal?:AbortSignal}):Promise<any>;
  overview(projectId?:OriginalId):Promise<any>;record(id:Hash):Promise<{record:MerchantRecord;recordSha256:Hash;availability:'VERIFIED';[key:string]:unknown}>;
  operations():Promise<any>;operation(id:OriginalId):Promise<any>;merchantOperation(id:OriginalId):Promise<any>;
  inbox():Promise<any>;inspectInput(selection:{kind:'catalog'|'handoff'|'project';file:IncomingFile}):Promise<any>;
  preview(selection:Omit<ReceivingPayload,'actor'|'operations'>&{operations:{caseId:string}|null}):Promise<any>;
  files(id:OriginalId):Promise<{files:ListedFile[];[key:string]:unknown}>;actionRaw(raw:string):Promise<any>;
  download(file:ListedFile,options?:{maximum?:number;signal?:AbortSignal}):Promise<{raw:Uint8Array;name:string;type:string;bytes:number;sha256:Hash}>;
}
export function parsePrivateLink(value:string):{origin:string;token:string};
export function connectMerchantClient(options:{urlFile:string;workspaceId:UUID;fetch?:typeof fetch;timeoutMs?:number}):Promise<AnalysisMerchantClient>;
export interface RuntimeConfig {
  schema:'stellar-forge.sensorthings-analysis-merchant-runtime.v1';port?:number;maxInFlight?:number;drainGraceMs?:number;
  operationsAccessFile?:string;nativeFactoryModule?:{path:string;bytes:number;sha256:Hash;exportName:string}|null;
}
export function readMerchantRuntime(filename:string,options?:{environment?:NodeJS.ProcessEnv;signal?:AbortSignal}):Promise<{runtime:object;identity:object}>;
export interface ExistingEndpoint {urlFile:string;workspaceId:UUID}
export interface ReceivingEndpoint extends ExistingEndpoint {inboxDirectory:string}
export interface NativeInput {
  schema:'stellar-forge.sensorthings-analysis-merchant-native.v1';operationId:OriginalId;controlDirectory:string;
  source:ExistingEndpoint;receiver:ReceivingEndpoint;reopened:ReceivingEndpoint;
  publication:{projectId:OriginalId;versionId:OriginalId;publicationId:OriginalId;publicationSha256:Hash;exportId:OriginalId;archiveSha256:Hash;archiveBytes:number};
  offer:Omit<OfferPayload,'publicationId'|'expectedPublicationSha256'|'exportId'|'expectedArchiveSha256'|'actor'>;
  buyer?:{intentId:string;responseOut:string;acceptIndex:number;note:string};startService?:{note:string};actor:string;
}
export interface NativeReceiving {
  schema:'stellar-forge.sensorthings-analysis-merchant-native-receiving.v1';parentOperationId:OriginalId;
  catalog:IncomingFile&{path:string};handoff:IncomingFile&{path:string};response:IncomingFile&{path:string};
  selection:{rowIndex:number;acceptIndex:number;jobId:string;decision:'received'|'changes_requested';reason:string};
  operations?:{caseId:string;deploymentId:string;purchaseId?:string|null};reopenNote:string;
}
/** page is the existing owner's actual Playwright Page, passed without serialization. */
export function runMerchantDelivery(input:NativeInput,options:{page:any;receiving?:NativeReceiving|null;signal?:AbortSignal;progress?:(value:unknown)=>void}):Promise<any>;
export function validateNativeInput(input:NativeInput):NativeInput;
export function validateNativeReceiving(value:NativeReceiving,input:NativeInput):NativeReceiving;
export const NATIVE_SCHEMA:string,RECEIVING_SCHEMA:string;
export const MERCHANT_SCHEMA:string,MERCHANT_RECORD:string,MERCHANT_SNAPSHOT:string;
export const MERCHANT_ACTIONS:Readonly<Record<string,readonly string[]>>;
export const MERCHANT_READS:Readonly<Record<string,string>>;
export const MERCHANT_MEANING:Readonly<Record<string,string>>;
