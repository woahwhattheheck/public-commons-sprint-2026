export const CUSTOMER_API_VERSION: 'stellar-forge.mpp-customer.v1';
export interface PaymentTerms {network:string;currency:string;recipient:string;amountAtomic:string;decimals:number}
export interface MerchantOffer {id:string;method:'GET'|'POST';path:string;url:string;description:string;
  payment:PaymentTerms;request:{body:'none'|'optional-json';query:'string-map'}}
export interface MppContract {schema:'stellar-forge.mpp-customer-contract.v1';title:string;origin:string;realm:string;
  profileId:string;payment:{method:'stellar';intent:'charge';mode:'pull';credentialType:'transaction'};
  runtime:Record<string,string>;offers:MerchantOffer[];sha256:string}
export interface CustomerConfiguration {schema?:'stellar-forge.mpp-customer.v1';workspace:string;dependencyRoot:string;
  operator:{python:string;ledger:string;policy:string;actor:string;service:string};
  signer:{payer:string;keyEnv:string};assetLimits:Array<{network:string;currency:string;decimals:number;
    maxAtomic:string;maxFeeStroops?:string}>;rpcUrl?:string;transport?:Record<string,unknown>}
export interface PurchaseInputs {purchaseId:string;query?:Record<string,string|string[]>;json?:unknown;challengeId?:string}
export interface NativeReceipt {method:'stellar';status:'success';reference:string;timestamp:string;externalId?:string}
export interface PurchaseView {id:string;phase:string;transaction?:string;receipt?:NativeReceipt;
  finality?:Record<string,unknown>;response?:{status:number;headers:Record<string,string>;bytes:number;sha256:string};
  customer:{contractSha256:string;offerId:string;merchant?:string;origin:string;activeContractChanged?:boolean};
  [key:string]:unknown}
export interface CustomerResult {response:Response;receipt:NativeReceipt;transaction:string;
  accounting:Record<string,unknown>;contractSha256:string;offerId:string;bytes:number;sha256:string}
export interface MppPurchase {readonly id:string;inspect():Promise<PurchaseView>;execute():Promise<PurchaseView>;
  resume():Promise<PurchaseView>;finalize():Promise<PurchaseView>;result():Promise<CustomerResult>;
  save(destination:string):Promise<Record<string,unknown>>}
export interface MppCustomer<OfferId extends string=string> {readonly contract:MppContract;
  readonly configuration:CustomerConfiguration;prepare(offerId:OfferId,inputs:PurchaseInputs):Promise<MppPurchase>;
  purchase(purchaseId:string):MppPurchase;
  list(options?:{offset?:number;limit?:number}):Promise<{items:PurchaseView[];total:number;nextOffset:number|null}>;
  refresh():Promise<{contract:MppContract;difference:ContractDifference}>;close():Promise<void>}
export interface ContractDifference {before:string;after:string;changed:boolean;profileChanged:boolean;
  changes:Array<Record<string,unknown>>}
export interface CustomerBundle {schema:'stellar-forge.mpp-customer-bundle.v1';generatorVersion:1;
  contractSha256:string;origin:string;sha256:string;files:Array<{name:string;content:string;bytes:number;sha256:string}>}
export interface CustomerExport {directory:string;bundleSha256:string;contractSha256:string;origin:string;
  state:'WRITING'|'COMPLETE'|'CHANGED'|'INCOMPLETE';
  files:Array<{name:string;bytes:number;sha256:string;state:'MATCH'|'MISSING'|'CHANGED'}>;
  createdAt:string;completedAt:string|null}
export function merchantContract(profile:Record<string,unknown>):MppContract;
export function parseContract(input:MppContract|string|Uint8Array,options?:{expectedSha256?:string}):MppContract;
export function buildCustomerRequest(contract:MppContract,offerId:string,
  inputs?:{query?:Record<string,string|string[]>;json?:unknown}):{url:string;method:'GET'|'POST';json?:unknown};
export function contractOpenAPI(contract:MppContract):Record<string,unknown>;
export function compareContracts(before:MppContract,after:MppContract):ContractDifference;
export function fetchMerchantContract(origin:string,options?:{transport?:Record<string,unknown>}):Promise<MppContract>;
export function customerConfigurationTemplate(contract:MppContract):CustomerConfiguration;
export function customerConfiguration(configuration:CustomerConfiguration,contract:MppContract):CustomerConfiguration;
export function initializeCustomer(options:{contract:MppContract;configuration:CustomerConfiguration}):Promise<Record<string,unknown>>;
export function connectCustomer<OfferId extends string=string>(options:{contract:MppContract;configuration:CustomerConfiguration;
  environment?:Record<string,string|undefined>}):Promise<MppCustomer<OfferId>>;
export const CUSTOMER_BUNDLE_SCHEMA:'stellar-forge.mpp-customer-bundle.v1';
export const CUSTOMER_EXPORT_SCHEMA:'stellar-forge.mpp-customer-export.v1';
export const CUSTOMER_FILES:readonly string[];
export function createCustomerBundle(options:{profile?:Record<string,unknown>;contract?:MppContract}):Promise<CustomerBundle>;
export function parseCustomerBundle(input:CustomerBundle|string|Uint8Array):CustomerBundle;
export function exportCustomerPackage(options:{profile?:Record<string,unknown>;contract?:MppContract;directory:string}):Promise<CustomerExport>;
export function receiveCustomerBundle(options:{bundle:CustomerBundle|string|Uint8Array;directory:string;resume?:boolean}):Promise<CustomerExport>;
export function inspectCustomerExport(directory:string):Promise<CustomerExport>;
export function resumeCustomerExport(directory:string):Promise<CustomerExport>;
export function readCustomerBundleFile(path:string):Promise<CustomerBundle>;
