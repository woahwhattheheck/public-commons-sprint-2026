import type {CustomerValue,ProjectValue,AssignmentValue,StatementValue as CarbonStatementValue,InvoiceValue} from '../stellarcarbon-statements/index.mjs';
import type {PaymentLinkValue,AllocationValue,BridgeValue,StatementValue,NativeRow} from '../cfce-givecredit-statements/core.mjs';
export type CarbonKind='stellarcarbon'|'givecredit';
export type Alias=string;
export interface SourceSelection {sourceFile?:Alias;sourceExport?:string;sourceWorkspace?:Alias}
export interface MutationOptions {requestId:string;revision:number;actor:string}
export interface ConnectionWorkspace {kind:CarbonKind;label?:string;directory:string;workspaceId:string;mode?:'managed'|'owned';url?:string;files?:Record<Alias,string>;accountingDirectory?:string;accountingWorkspaceId?:string;accountingSourcesSha256?:string}
export interface ConnectionFile {schema:'stellar-forge.carbon-customer-connection.v1';workspaces:Record<Alias,ConnectionWorkspace>;destinations?:Record<Alias,string>}
export interface FileIdentity {device:string;inode:string;bytes:string;modified:string;changed:string}
export interface ConfiguredWorkspace extends Omit<ConnectionWorkspace,'files'|'accountingDirectory'|'accountingWorkspaceId'|'accountingSourcesSha256'> {mode:'managed'|'owned';files:Record<Alias,{path:string;identity:FileIdentity}>;identity:{device:string;inode:string};accounting?:{directory:string;workspaceId:string;sourcesSha256:string}}
export interface CarbonConfiguration {schema:ConnectionFile['schema'];workspaces:Record<Alias,ConfiguredWorkspace>;destinations:Record<Alias,{path:string;parent:string;identity:{device:string;inode:string}}>}
export interface RetainedExport {schema:'stellar-forge.carbon-agent-export.v1';exportId:string;workspaceId:string;kind:CarbonKind;name:string;type:string;status:number;bytes:number;sha256:string}
export interface NativeResult<T=unknown> {value:T|null;receipt:RetainedExport}
export interface OperationResult<T=unknown> {state:string;native:T|null;receipt:RetainedExport;next?:string}
export type SaveInput=MutationOptions&(
 {action:'customer';value:CustomerValue}|{action:'project';value:ProjectValue}|{action:'assignment';value:AssignmentValue}|
 {action:'statement';value:CarbonStatementValue|StatementValue}|{action:'invoice';value:InvoiceValue&{statementId:string}}|
 {action:'payment-link';value:PaymentLinkValue}|{action:'allocation';value:AllocationValue}|{action:'bridge';value:BridgeValue}|
 {action:'settings';value:{name:string}}|{action:'carry-payment-links';value:{fromRegistryEditionId:string;toRegistryEditionId:string;fromLedgerEditionId:string;toLedgerEditionId:string}});
export interface ImportInput extends MutationOptions,SourceSelection {format:'source'|'backup-files'|'retained'|'registry-files'|'carbon-source'|'carbon-retained';label:string;metadata?:NativeRow;network?:'mainnet'|'testnet'}
export type CaptureInput={command:'status'|'stop';kind:'api'|'registry'|'ledger'}|({command:'start';kind:'api'|'registry'|'ledger';value?:NativeRow;sourceFile?:Alias;label:string}&MutationOptions);
export type CheckpointInput=({command:'import';kind:'registry'|'ledger'}&MutationOptions&SourceSelection)|{command:'export';kind:'registry'|'ledger';exportId:string};
export type ExportInput={exportId:string}&({kind:'handover'}|{kind:'source';editionId:string}|{kind:'source-file';editionId:string;name?:string;fileIndex?:number}|{kind:'comparison';beforeId:string;afterId:string}|{kind:'statement';statementId:string;version:number;name:string});
export interface AgentSummary {kind:CarbonKind;ownership:'managed'|'owned';workspaceId:string;instanceId:string;url:string}
export const CONNECTION_SCHEMA:ConnectionFile['schema'];
export function readCarbonCustomerConfiguration(path:string):Promise<CarbonConfiguration>;
export function initializeCarbonCustomerMerchant(options:{directory:string;connection:string;name?:string;releaseStore?:string}):Promise<unknown>;
export function attachCarbonWorkspace(definition:ConfiguredWorkspace,options:{exportDirectory:string;fetchImpl?:typeof fetch}):Promise<CarbonAgentClient>;
export class CarbonAgentClient {
 readonly instanceId:string;readonly summary:AgentSummary;readonly kind:CarbonKind;readonly directory:string;
 verify():Promise<unknown>;
 view(view:string,query?:Record<string,string|number>):Promise<NativeResult>;
 preview(kind:'statement'|'allocation'|'bridge',value:CarbonStatementValue|StatementValue|AllocationValue|BridgeValue):Promise<NativeResult>;
 save(input:SaveInput):Promise<OperationResult>;
 import(input:ImportInput,foreignSource?:RetainedExport&{path:string}):Promise<OperationResult>;
 capture(input:CaptureInput):Promise<NativeResult|OperationResult>;
 checkpoint(input:CheckpointInput,foreignSource?:RetainedExport&{path:string}):Promise<NativeResult|OperationResult|{receipt:RetainedExport}>;
 operation(requestId:string):Promise<unknown>;resume(requestId:string):Promise<OperationResult>;
 download(input:ExportInput):Promise<NativeResult|{receipt:RetainedExport}>;
 exportReceipt(exportId:string):Promise<RetainedExport&{path:string}>;
 retained(exportId:string):Promise<{readonlyFileHandle:import('node:fs/promises').FileHandle;bytes:number;sha256:string;name:string;type:string}>;
 requestClose():void;close():Promise<{instanceId:string;ownership:'managed'|'owned';state:'CLOSED'|'DETACHED'}>;
}
export class MerchantCarbonCustomerWorkspaces {
 constructor(config:{carbonCustomerWorkspaces?:CarbonConfiguration;exportsDirectory:string},options?:{fetchImpl?:typeof fetch});
 readonly summary:unknown;call(name:string,args?:Record<string,unknown>):Promise<unknown>;requestClose():void;close():Promise<void>;
}
export function carbonCustomerTools<T>(tool:(name:string,description:string,properties:Record<string,unknown>,required:string[])=>T):T[];
export const ACTIONS:Record<CarbonKind,string[]>;
export const VIEWS:Record<string,{kind?:CarbonKind;keys:string[];required:string[]}>;
export const IMPORTS:Record<CarbonKind,string[]>;
export const STATEMENT_FILES:Record<CarbonKind,string[]>;
export const OPERATION_SCHEMAS:Record<CarbonKind,Record<string,Record<string,unknown>>>;
export const PREVIEW_SCHEMAS:Record<CarbonKind,Record<string,Record<string,unknown>>>;
export function receiveCustomerAgent(options:{sourceFile:string;outputDirectory:string;fromDate?:string;beforeDate?:string}):Promise<{directory:string;phase:string;files:number;events:number}>;
