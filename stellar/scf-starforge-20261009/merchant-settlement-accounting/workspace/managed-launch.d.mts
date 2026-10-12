// MIT. Reviewed original accounting application launch and ownership.
import type {Server} from 'node:http';
import type {AccountingConnectionsOwner,AccountingSavedSelections,AccountingSelectionSummaries,AccountingConnectionRuntime} from './connections-workspace.mjs';

export declare const ACCOUNTING_MANAGED_SCHEMA:'stellar-forge.managed-accounting-binding.v1';
export declare const ACCOUNTING_STARTUP_SCHEMA:'stellar-forge.managed-accounting-startup.v1';
export interface ManagedAccountingSettings {
  directory:string;port?:number;connectionsFile?:string|null;selectionDirectory?:string;
  allowLoopbackOAuth?:boolean;recoveryStartPaused?:boolean;
  outboxDir?:string;proofDir?:string;termsFile?:string;recoveredDir?:string;
  recoveryStateRoot?:string;recoveryBackupRoot?:string;rpcProxyEnv?:string;
  recoveryPassEnv?:string;deliverySecretEnv?:string;
}
export interface AccountingManagedInput {
  name:string;path:string;type:'file'|'directory';device?:string;inode?:string;
  bytes?:number;sha256?:string;exists?:boolean;
}
export interface BuyerAccountingWorkspaceBinding {
  schema:'stellar-forge.accounting-workspace-binding.v1';directory:string;
  workspaceId:string;sourcesSha256:string;
  sources:{sourceMode:'buyer';buyerSourceFile:string;buyerSourceSha256:string;buyerSourceBytes:number};
}
export interface AccountingLaunchInspection {
  binding:{
    schema:typeof ACCOUNTING_MANAGED_SCHEMA;settings:ManagedAccountingSettings;
    oauth:Record<string,unknown>;selectionRoot:Record<string,unknown>|null;
    selections:{quickbooks:string|null;xero:string|null};inputs:AccountingManagedInput[];
    workspaceBinding?:BuyerAccountingWorkspaceBinding;
  };
  bindingSha256:string;
  /** Full private native source. Use review when returning operator metadata. */
  selections:AccountingSavedSelections;
  review:{
    schema:typeof ACCOUNTING_MANAGED_SCHEMA;bindingSha256:string;directory:string;port:number;allowLoopbackOAuth:boolean;
    connectionsFile:string|null;selectionDirectory:string|null;connectionsSha256:string|null;
    profiles:Array<Record<string,unknown>>;selections:{quickbooks:string|null;xero:string|null};
    inputs:AccountingManagedInput[];targets:AccountingSelectionSummaries;recoveryStartPaused:boolean;
    sourceMode:'merchant'|'buyer';workspaceBinding:BuyerAccountingWorkspaceBinding|null;
  };
}
export interface AccountingManagedStartup {
  schema:typeof ACCOUNTING_STARTUP_SCHEMA;status:'ACCOUNTING_WORKSPACE_READY';
  instanceId:string;pid:number;startedAt:string;directory:string;selectionDirectory:string|null;
  requestedPort:number;port:number;bindingSha256:string;connectionsFile:string|null;
  connectionsSha256:string|null;profileCount:number;selections:{quickbooks:string|null;xero:string|null};
  url:string;connectionsUrl:string|null;workspaceBinding?:BuyerAccountingWorkspaceBinding;
}
export interface OriginalAccountingHost {
  readonly url:string;readonly server:Server;readonly workspace:unknown;readonly accountant:unknown;
  readonly qbo?:unknown;readonly xero:unknown;readonly bitwave?:unknown;readonly collection?:unknown;
  readonly statements?:unknown;readonly delivery?:unknown;readonly maintenance:unknown;
  close():Promise<void>;
}
export interface ManagedAccountingOwner {
  readonly accounting:OriginalAccountingHost;readonly connections:AccountingConnectionsOwner|undefined;
  readonly managed:AccountingManagedStartup;readonly url:string;
  /** Abort native selection capture; drain original accounting; then close OAuth owners. */
  close():Promise<void>;
}
export declare function inspectAccountingLaunch(settings:ManagedAccountingSettings,options?:{
  env?:Record<string,string|undefined>;allowMissing?:boolean;
}):Promise<AccountingLaunchInspection>;
export declare function startManagedAccountingWorkspace(settings:ManagedAccountingSettings,options:AccountingConnectionRuntime&{
  expectedSha256:string;
  startWorkspace:(options:Record<string,unknown>)=>Promise<OriginalAccountingHost>;
  announce?:(startup:AccountingManagedStartup)=>void|Promise<void>;
}):Promise<ManagedAccountingOwner>;
export declare function accountingManagedArguments(argv:string[]):{
  settings:ManagedAccountingSettings;expectedSha256:string;
};
