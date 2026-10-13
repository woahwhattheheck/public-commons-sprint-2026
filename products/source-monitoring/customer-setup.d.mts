/// <reference types="node" />
import type {NativeIdentity} from './client.mjs';
import type {SourceMonitoringConfiguration} from './merchant.mjs';
export const CUSTOMER_SETUP_SCHEMA:'stellar-forge.source-monitoring-customer-setup.v1';
export const CUSTOMER_PLAN_SCHEMA:'stellar-forge.source-monitoring-customer-plan.v1';
export interface CustomerSetupSelection {
 schema:typeof CUSTOMER_SETUP_SCHEMA;operationId:string;
 workspaceDirectory:string;workspaceId:string;
 applicationId:string;applicationRevision:string;runId:string;homeId:string;
 alias:string;storageDirectory:string;sourceConfigPath:string;merchantConfigPath:string;
 expectedSourceSha256:string|null;expectedMerchantSha256:string;
 label?:string;timeoutMs?:number;files?:SourceMonitoringConfiguration['files'];
}
export interface ManagedConfigRequest {
 requestId:string;operation:'managed-config-save';homeId:string;path:string;content:string;expectedSha256:string|null;
}
export interface ManagedConfigSnapshot {homeId:string;path:string;exists:boolean;sha256:string|null;content:string;bytes:number}
export interface ApplicationBinding {
 applicationId:string;applicationRevision:string;runId:string;homeId:string;homeDirectory:string;
 release:{id:string;digest:string;sourceCommit:string}|null;connectionFile:string;connectionSha256:string;identity:NativeIdentity;
}
export interface CustomerSetupPlan {
 schema:typeof CUSTOMER_PLAN_SCHEMA;selection:CustomerSetupSelection;application:ApplicationBinding;
 sourceFile:string;merchantFile:string;before:Array<Omit<ManagedConfigSnapshot,'content'>>;
 requests:[ManagedConfigRequest,ManagedConfigRequest];sha256:string;
}
export interface ConfigurationHistory {
 intentSha256:string;
 intent:{binding:{operation:string;homeId:string;homeDirectory:string;path:string;expectedSha256:string|null;targetSha256:string;remove:boolean};
  before:{exists:boolean;bytes:number;sha256:string|null;content?:string|null};
  after:{exists:boolean;bytes:number;sha256:string|null;content:string};[key:string]:unknown};
 result:null|{operationId:string;sha256:string;bytes:number;[key:string]:unknown};
 [key:string]:unknown;
}
export interface RuntimeOperation {phase:string;workerActive?:boolean|null;observation?:unknown;error?:unknown;[key:string]:unknown}
/** Minimum public Runtime API borrowed by setup; implementation remains the original Runtime model. */
export interface CustomerSetupRuntime {
 state(options:{operationDetail:'summary'}):Promise<{workspaceId:string;directory:string;[key:string]:unknown}>;
 applicationsState(options:{historyLimit:1}):Promise<{applications:Array<{
  id:string;kind:string;revision:string;phase:string;homeId:string;
  settings:{workspaceDirectory:string;[key:string]:unknown};
  home:null|{id:string;directory:string};
  release:ApplicationBinding['release'];
  current:null|{id:string;active:boolean|null;stop?:unknown;command:string;url?:{
   schema:string;operationId:string;command:string;original:NativeIdentity&{connectionFile?:string};[key:string]:unknown
  };[key:string]:unknown};[key:string]:unknown
 }>;[key:string]:unknown}>;
 managedConfig(options:{homeId:string;path:string}):Promise<ManagedConfigSnapshot>;
 managedConfigurationHistory(options:{homeId:string;path:string;operationId:string}):Promise<ConfigurationHistory>;
 operationStatus(options:{operationId:string}):Promise<RuntimeOperation>;
 begin(request:ManagedConfigRequest):Promise<{operationId:string;reopened?:boolean;[key:string]:unknown}>;
 recoverManagedOperation(operationId:string):Promise<unknown>;
}
export interface SetupStage {
 role:'source'|'merchant';operationId:string;
 history:null|{intentSha256:string;operationId:string;path:string;
  before:{exists:boolean;bytes:number;sha256:string|null};
  after:{exists:boolean;bytes:number;sha256:string|null};result:ConfigurationHistory['result']};
 operation:null|{operationId:string;phase:string;workerActive?:boolean|null;observation:unknown;error:unknown};
 current:Omit<ManagedConfigSnapshot,'content'>&{content?:undefined;matchesPrepared:boolean};
}
export interface CustomerSetupStatus {
 schema:typeof CUSTOMER_SETUP_SCHEMA;operationId:string;planSha256:string;phase:'PENDING'|'COMPLETE';
 stages:SetupStage[];sourceFile:string;merchantFile:string;workspaceAlias:string;currentConfigurationMatches:boolean;
 started?:{operationId:string;reopened?:boolean;[key:string]:unknown};
}
export interface VerifiedCustomerSetup {
 schema:typeof CUSTOMER_SETUP_SCHEMA;operationId:string;planSha256:string;phase:'VERIFIED';
 sourceFile:string;merchantFile:string;workspaceAlias:string;identity:NativeIdentity;
 applicationId:string;runId:string;configurationOperations:string[];
}
export function prepareSourceMonitoringCustomer(options:{model:CustomerSetupRuntime;selection:CustomerSetupSelection}):Promise<CustomerSetupPlan>;
export function inspectSourceMonitoringCustomer(options:{model:CustomerSetupRuntime;plan:CustomerSetupPlan}):Promise<CustomerSetupStatus>;
export function advanceSourceMonitoringCustomer(options:{model:CustomerSetupRuntime;plan:CustomerSetupPlan;recover?:boolean}):Promise<CustomerSetupStatus>;
export function verifySourceMonitoringCustomer(options:{model:CustomerSetupRuntime;plan:CustomerSetupPlan}):Promise<VerifiedCustomerSetup>;
export function customerSetupMain(argv?:string[]):Promise<number>;
