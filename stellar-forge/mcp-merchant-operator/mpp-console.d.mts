import type {CustomerConfiguration,MppContract,CustomerBundle} from '../../stellar/scf-starforge-20261009/mpp-charge/customer/index.mjs';
export const MPP_CONNECTION_SCHEMA:'stellar-forge.merchant-mpp-connection.v1';
export const MAX_MPP_CHUNK_BYTES:49152;
export interface MppConnectionDocument {
  schema:typeof MPP_CONNECTION_SCHEMA;
  consoles:Record<string,{label?:string;origin:string;tokenEnv:string;workspace:string;
    customers:Record<string,{label?:string;configuration:string}>}>;
}
export interface MppConsoleSelection {
  label:string;origin:string;tokenEnv:string;workspace:string;createdAt:string;identity:string;
  customers:Record<string,{label:string;configuration:CustomerConfiguration;configurationSha256:string}>;
}
export interface MppConfiguration {schema:typeof MPP_CONNECTION_SCHEMA;selectionSha256:string;
  consoles:Record<string,MppConsoleSelection>}
export function readMppConfiguration(path:string):Promise<MppConfiguration>;
export type MppToolName='merchant_mpp_consoles'|'merchant_mpp_status'|'merchant_mpp_contract'|
  'merchant_mpp_customer_review'|'merchant_mpp_customer_review_status'|'merchant_mpp_customer_configure'|
  'merchant_mpp_preview'|'merchant_mpp_prepare'|'merchant_mpp_retry_prepare'|'merchant_mpp_execute'|
  'merchant_mpp_resume'|'merchant_mpp_finalize'|'merchant_mpp_job'|'merchant_mpp_purchase'|
  'merchant_mpp_response_preview'|'merchant_mpp_response_file'|'merchant_mpp_catalog'|
  'merchant_mpp_handoff_file'|'merchant_mpp_export'|'merchant_mpp_export_list'|
  'merchant_mpp_export_manifest'|'merchant_mpp_export_file'|'merchant_mpp_export_file_release';
export interface MppCustomerReview {
  schema:'stellar-forge.merchant-mpp-customer-review.v1';reviewId:string;console:string;workspaceIdentity:string;
  customer:string;configurationSha256:string;reviewSha256:string;createdAt:string;revision:number;
  profileId:string;contractSha256:string;profile:{contract:MppContract;configuration:Record<string,unknown>};
  difference:Record<string,unknown>|null;state?:string;currentRevision?:number;currentProfileId?:string|null;
}
export class MerchantMppConsole {
  constructor(config:{exportsDirectory:string;mpp?:MppConfiguration|null},options?:{
    environment?:Record<string,string|undefined>;fetchImpl?:typeof fetch});
  readonly summary:{configured:boolean;consoles:string[];borrowed:true;closing:boolean;
    exports:{activeFileReads:number;snapshotBytes:number}};
  call(name:'merchant_mpp_customer_review',args:{console:string;customer:string;reviewId:string;
    document:MppContract|CustomerBundle}):Promise<MppCustomerReview>;
  call(name:MppToolName,args?:Record<string,unknown>):Promise<any>;
  close():Promise<void>;
}
export function mppTools<T>(tool:(name:string,description:string,properties?:Record<string,unknown>,
  required?:string[],annotations?:{readOnly?:boolean;destructive?:boolean;idempotent?:boolean;openWorld?:boolean})=>T):T[];
