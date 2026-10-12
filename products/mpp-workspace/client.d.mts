import type { ChannelOperation, ChannelRecordKind, ChannelRecord, ChannelJob, ChannelBytes } from '../../stellar/scf-starforge-20261009/mpp-channel/client.mjs';
import type { MppContract, CustomerBundle, CustomerExport, CustomerDraft, CustomerWorkbenchProfile,
  CustomerRequestPreview, CustomerResourcePreview, PurchaseInputs, PurchaseView, WorkbenchSnapshot,
  NativeReceipt } from '../../stellar/scf-starforge-20261009/mpp-charge/customer/index.mjs';
import type { Environment, NativeVersions, NativeMetadata } from './workspace.mjs';
export type { MppContract, CustomerBundle, CustomerExport, CustomerDraft, CustomerWorkbenchProfile,
  CustomerRequestPreview, CustomerResourcePreview, PurchaseInputs, PurchaseView, WorkbenchSnapshot, NativeReceipt };
export interface NativeIdentity {
  schema:'stellar-forge.mpp-console-identity.v1';pid:number;ppid:number;origin:string;
  workspace:string;createdAt:string;versions:NativeVersions;
}
export interface JobTicket {id:string;state:'RUNNING'}
export interface JobObservation extends Omit<JobTicket,'state'> {
  state:'RUNNING'|'COMPLETE'|'FAILED'|'JOB_NOT_RETAINED';kind?:string;createdAt?:string;updatedAt?:string;
  result?:unknown;error?:string;purchaseId?:string;purchase?:PurchaseView;
}
export interface ConsoleState {
  schema:'stellar-forge.mpp-console.v1';metadata:NativeMetadata;versions:NativeVersions;
  profiles:{merchant:Record<string,unknown>|null;buyer:Record<string,unknown>|null;customer:CustomerWorkbenchProfile|null};
  customerWorkbench:WorkbenchSnapshot;
  merchant:null|{port:number;profileId:string;active:number};
  purchases:PurchaseView[];deliveries:Array<Record<string,unknown>>;jobs:JobObservation[];
}
export interface ProfileSelection {kind:string;profileId:string;revision:number}
export interface CustomerReview {profile:CustomerWorkbenchProfile;profileId:string;revision:number;contractSha256:string}
export interface Catalog {profileSource:'active'|'saved';contract:MppContract;publicContract:string;publicOpenAPI:string}
export interface Handoff {bytes:Uint8Array;contentType:string|null;sha256:string;responseHeaders:Record<string,string>}
export interface ResponseDownload {
  schema:'stellar-forge.mpp-product-response.v1';purchaseId:string;workspace:string;workspaceCreatedAt:string;
  path:string;bytes:number;sha256:string;contractSha256:string;offerId:string;transaction:string;
  receipt:NativeReceipt;accounting:Record<string,unknown>;contentType:string|null;recordPath:string;
}
export interface RequestInputs {query?:Record<string,string|string[]>;json?:unknown}
export class MppProductError extends Error {
  readonly code:string;purchaseId?:string;jobId?:string;status?:number;
  constructor(code:string,message:string,options?:{purchaseId?:string;jobId?:string;cause?:unknown;status?:number});
}
export class MppProductClient {
  private constructor();
  readonly directory:string;readonly workspaceDirectory:string;
  identity():Promise<NativeIdentity>;
  state():Promise<ConsoleState>;
  channelState():Promise<ChannelRecord>;
  channelAction(name:ChannelOperation,input:ChannelRecord):Promise<ChannelJob>;
  channelRecord(kind:ChannelRecordKind,key:string):Promise<ChannelRecord>;
  channelResponse(purchaseId:string):Promise<ChannelBytes>;
  channelHandover(sha256:string):Promise<ChannelBytes>;
  catalog():Promise<Catalog>;
  handoff(kind:'contract'|'openapi'|'package',profileId:string):Promise<Handoff>;
  configureProfile(kind:'merchant'|'buyer'|'customer',profile:Record<string,unknown>|CustomerWorkbenchProfile,revision:number):Promise<ProfileSelection>;
  startMerchant(port?:number):Promise<{port:number;profileId:string}>;
  stopMerchant():Promise<{status:'STOPPED'}>;
  recoverDelivery(deliveryId:string):Promise<JobTicket>;
  customerStatus(options?:{offset?:number;limit?:number}):Promise<WorkbenchSnapshot>;
  intake(document:MppContract|CustomerBundle):Promise<CustomerDraft>;
  fetchContract(origin:string,transport?:Record<string,unknown>):Promise<CustomerDraft>;
  reviewCustomer(profile:CustomerWorkbenchProfile,revision:number):Promise<CustomerReview>;
  configureCustomer(profile:CustomerWorkbenchProfile,revision:number):Promise<ProfileSelection>;
  preview(options:{profileId:string;offerId:string;inputs?:RequestInputs}):Promise<CustomerRequestPreview>;
  prepare(options:{profileId:string;offerId:string} & PurchaseInputs):Promise<JobTicket>;
  retryPrepare(purchaseId:string):Promise<JobTicket>;
  execute(purchaseId:string):Promise<JobTicket>;
  resume(purchaseId:string):Promise<JobTicket>;
  finalize(purchaseId:string):Promise<JobTicket>;
  purchase(purchaseId:string):Promise<PurchaseView>;
  responsePreview(purchaseId:string):Promise<CustomerResourcePreview>;
  job(jobId:string,options?:{purchaseId?:string}):Promise<JobObservation>;
  waitJob(jobId:string,options?:{purchaseId?:string;timeoutMs?:number;intervalMs?:number;signal?:AbortSignal}):Promise<JobObservation>;
  receiveCustomer(options:{profileId:string;directory:string;expectedBundleSha256?:string}):Promise<CustomerExport & {sourceBytes:number;sourceSha256:string}>;
  downloadResponse(options:{purchaseId:string;path:string;expectedSha256?:string}):Promise<ResponseDownload>;
  close():Promise<void>;
}
export function connectMppProduct(options:{directory:string;fetchImpl?:typeof fetch;timeoutMs?:number}):Promise<MppProductClient>;
export interface MppAgent {
  readonly endpoint:string;readonly console:'native';
  call(name:string,args?:Record<string,unknown>,options?:{requestSignal?:AbortSignal|null;timeoutMs?:number}):Promise<Record<string,unknown>>;
  consoles():Promise<Record<string,unknown>>;
  status(options?:{offset?:number;limit?:number}):Promise<Record<string,unknown>>;
  catalog():Promise<Catalog>;
  fetchContract(customer:string,origin:string):Promise<Record<string,unknown>>;
  review(input:{customer:string;reviewId:string;document:MppContract|CustomerBundle}):Promise<Record<string,unknown>>;
  reviewStatus(reviewId:string):Promise<Record<string,unknown>>;
  configure(reviewId:string,expectedReviewSha256:string):Promise<Record<string,unknown>>;
  preview(input:{profileId:string;offerId:string;inputs?:RequestInputs}):Promise<CustomerRequestPreview>;
  prepare(input:{profileId:string;offerId:string} & PurchaseInputs):Promise<Record<string,unknown>>;
  retryPrepare(purchaseId:string):Promise<Record<string,unknown>>;
  execute(purchaseId:string):Promise<Record<string,unknown>>;
  resume(purchaseId:string):Promise<Record<string,unknown>>;
  finalize(purchaseId:string):Promise<Record<string,unknown>>;
  job(jobId:string,purchaseId?:string):Promise<JobObservation>;
  purchase(purchaseId:string):Promise<PurchaseView>;
  responsePreview(purchaseId:string):Promise<CustomerResourcePreview>;
  export(input:{exportId:string;expectedSha256:string;kind:'response';purchaseId:string}|
    {exportId:string;expectedSha256:string;kind:'contract'|'openapi'|'package';profileId:string}):Promise<Record<string,unknown>>;
  download(input:{exportId:string;directory:string;expectedManifestSha256?:string;chunkSize?:number}):Promise<Record<string,unknown>>;
}
export function connectMppAgent(options:{directory:string;environment?:Environment;signal?:AbortSignal}):Promise<MppAgent>;
export function receiveMppCustomer(options:{file:string;directory:string;resume?:boolean}):Promise<CustomerExport>;
export function inspectMppCustomer(directory:string):Promise<CustomerExport>;
export function resumeMppCustomer(directory:string):Promise<CustomerExport>;
