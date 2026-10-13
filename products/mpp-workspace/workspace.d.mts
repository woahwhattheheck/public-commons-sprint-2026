import type { CustomerConfiguration, CustomerWorkbenchProfile } from '../../stellar/scf-starforge-20261009/mpp-charge/customer/index.mjs';
export type Environment = Record<string, string | undefined>;
export type NativeVersions = { '@stellar/mpp':'0.7.1'; mppx:'0.6.29'; '@stellar/stellar-sdk':'15.1.0' };
export interface MppProduct {
  schema:'stellar-forge.mpp-product.v1'; name:string; directory:string;
  operatorDirectory:string; configuration:string; connection:string; customersFile:string;
  customerFiles:string; receivingDirectory:string; sessionFile:string;
  workspaceDirectory:string; workspaceOwnership:'CREATED'|'ATTACHED'; workspaceCreatedAt:string;
  dependencyRoot:string; createdAt:string;
}
export interface NativeMetadata {
  schema:'stellar-forge.mpp-workspace.v1'; createdAt:string; revision:number;
  merchant:string|null; buyer:string|null; customer?:string|null; updatedAt?:string;
}
export interface RuntimeSelection {
  directory:string; versions:NativeVersions; state:'PACKAGES_PRESENT'|'RECEIVING_REQUIRED';
  files:Array<{role:string;path:string;bytes:number;sha256:string}>;
  installed:Array<{name:string;version:string;path?:string;bytes?:number;sha256?:string;installed?:false}>;
}
export interface CustomerSelections {
  schema:'stellar-forge.mpp-product-customers.v1'; revision:number;
  customers:Record<string,{label:string;file:string;sha256:string}>;
}
export interface MppSession {
  schema:'stellar-forge.mpp-product-session.v1';state:'STARTING'|'OPEN'|'DRAINING'|'CLOSED'|'FAILED';
  directory:string;workspace:string;workspaceCreatedAt:string;pid:number;ppid:number;
  startedAt:string;stoppedAt?:string;browserOnly:boolean;tokenEnv:string;
  browserUrl?:string;mcpUrl?:string|null;console?:'native';versions?:NativeVersions;
  bindingSha256?:string;resourceId?:string;authorization?:Record<string,unknown>|null;
}
export interface OpenMppOptions {
  directory:string;port?:number;mcpPort?:number;browserOnly?:boolean;tokenEnv?:string;
  environment?:Environment;managedBindingSha256?:string;
}
export type OpenMppProduct = Omit<MppProduct, 'schema'> & MppSession & {
  state:'OPEN';browserUrl:string;mcpUrl:string|null;console:'native';versions:NativeVersions;
  close():Promise<void>;launch?:import('./managed.mjs').MppLaunch;
}
export const MPP_PRODUCT_SCHEMA:'stellar-forge.mpp-product.v1';
export const MPP_PRODUCT_CUSTOMERS_SCHEMA:'stellar-forge.mpp-product-customers.v1';
export const MPP_PRODUCT_SESSION_SCHEMA:'stellar-forge.mpp-product-session.v1';
export const CONSOLE_TOKEN_ENV:'STARFORGE_MPP_PRODUCT_CONSOLE_TOKEN';
export function initializeMppProduct(options:{directory:string;name?:string;workspaceDirectory?:string;dependencyRoot:string}):
  Promise<MppProduct & {state:'INITIALIZED';reused:boolean;console?:'native'}>;
export function readMppProduct(directory:string,options?:{validateOperator?:boolean}):Promise<MppProduct>;
export function readProductCustomers(profile:MppProduct):Promise<CustomerSelections>;
export function inspectNativeSelection(directory:string):Promise<RuntimeSelection>;
export function readNativeIdentity(directory:string):Promise<{directory:string;metadata:NativeMetadata;
  profiles:Record<'merchant'|'buyer'|'customer',null|{id:string;path:string;bytes:number;sha256:string;profile:Record<string,unknown>}>;
}>;
export function recoverMppProductSetup(directory:string):Promise<MppProduct & {state:'INITIALIZED';recovered:boolean}>;
export function registerMppCustomer(options:{directory:string;customer:string;file?:string;label?:string;expectedRevision:number;remove?:boolean}):
  Promise<{schema:'stellar-forge.mpp-product-customers.v1';revision:number;customer:string;state:'REGISTERED'|'REMOVED';reused:boolean}>;
export function configureMppProfile(options:{directory:string;kind:'merchant'|'buyer'|'customer';file:string;expectedRevision:number}):
  Promise<{schema:'stellar-forge.mpp-profile-selection.v1';workspace:string;kind:string;profileId:string;revision:number;metadata:NativeMetadata}>;
export function inspectMppProduct(directory:string):Promise<MppProduct & {native:{metadata:NativeMetadata};
  runtime:RuntimeSelection;customers:CustomerSelections;session:MppSession|null;
  console:{reachable:boolean;code?:string;identity?:import('./client.mjs').NativeIdentity;state?:import('./client.mjs').ConsoleState}}>;
export function openMppProduct(options:OpenMppOptions):Promise<OpenMppProduct>;
