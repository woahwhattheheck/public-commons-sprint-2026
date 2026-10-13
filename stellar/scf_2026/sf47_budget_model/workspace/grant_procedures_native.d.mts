// MIT. Native API delegates to the original GrantWorkspaceClient.
import type {Buffer} from 'node:buffer';
import type {GrantWorkspaceClient,GrantResponseSource,GrantCaseImportReceipt} from './agent-client.mjs';
import type {
 PreparedGrantProcedure,ProcedureCase,ProcedureEditionKind,ProcedureInspection,ProcedureSource,ProcedureVerification,ProcedureStepLinks
} from './grant_procedures.mjs';
export interface RetainedNativeResponse<T=unknown> {
 status:number;mediaType:string;sha256:string;filename:string|null;source:GrantResponseSource;
 value:T|null;bytes:number;dataBase64:string;
}
export interface ProcedureFileReceipt {path:string;bytes:number;sha256:string;reused:boolean}
export type NativeProcedureTableInput=
 | {key:string;origin:'case-plan'}
 | {key:string;origin:'case-source';sourceId:string}
 | {key:string;origin:'local-original';originalText:string}
 /** Original table key is copied whole from parentSourceId. */
 | {key:string;origin:'preceding-procedure'};
export interface NativeProcedureSelection {
 caseId:string;operatingPlanText:string;selectedRevision?:number;actor:string;note?:string;editionId?:string;createdAt?:string;
 sourceIds?:string[];tables?:NativeProcedureTableInput[];editions?:{kind:ProcedureEditionKind;id:string;revision:number}[];
 stepLinks?:ProcedureStepLinks[];parentSourceId?:string|null;
}
export interface NativePreparedProcedure extends PreparedGrantProcedure {
 verification:ProcedureVerification;caseReturn:RetainedNativeResponse<ProcedureCase>;afterReturn:RetainedNativeResponse<ProcedureCase>;
}
export interface NativeReopenedProcedure extends ProcedureInspection {
 current:ProcedureCase;metadata:ProcedureSource;raw:string;verification:ProcedureVerification;
 caseReturn:RetainedNativeResponse<ProcedureCase>;sourceReturn:RetainedNativeResponse<unknown>;
}
export interface ProcedureSaveReceipt {id:string;version:number;action:'source.add';kind:'source';recordId:string}
export interface ProcedureSaveIntent {
 schema:'stellar-forge.sf47-grant-procedure.v1.save';workspaceDirectory:string;caseId:string;requestId:string;
 body:{expectedVersion:number;requestId:string;actor:string;note:string;filename:string;kind:'other';mediaType:'application/json';sourceUrl:'';observedAt:string};
 procedure:{editionId:string;bytes:number;sha256:string};
}
export interface ProcedureReceiveIntent {
 schema:'stellar-forge.sf47-grant-procedure.v1.receive';workspaceDirectory:string;requestId:string;
 input:{caseId:string;sourceId:string;editionId:string;archiveBytes:number;archiveSha256:string;manifestSha256:string};
 body:{requestId:string;name:string;actor:string};
}
export interface ProcedureSaved {
 schema:'stellar-forge.sf47-grant-procedure.v1.saved';intent:ProcedureSaveIntent;source:ProcedureSource;native:ProcedureSaveReceipt;
}
export interface ProcedureReceived {
 schema:'stellar-forge.sf47-grant-procedure.v1.received';intent:ProcedureReceiveIntent;source:ProcedureSource;native:GrantCaseImportReceipt;
}
export interface ProcedureDeliveryManifest {
 schema:'stellar-forge.sf47-grant-procedure.v1.delivery';caseId:string;caseVersion:number;sourceId:string;editionId:string;
 operatingPlanId:string;selectedRevision:number;members:{name:string;bytes:number;sha256:string}[];
}
export type ProcedureEvent={
 event:'PROCEDURE_NATIVE_RETURN';schema:'stellar-forge.sf47-grant-procedure.v1.return';
 intent:ProcedureSaveIntent|ProcedureReceiveIntent;response:RetainedNativeResponse;
}|{
 event:'PROCEDURE_NATIVE_FAILURE';schema:'stellar-forge.sf47-grant-procedure.v1.failure';
 intent:ProcedureSaveIntent|ProcedureReceiveIntent;
 error:{code:string|null;message:string;status:number|null;definite:boolean|null;uncertain:boolean|null;requestId:string|null;source:unknown;recovery:unknown};
};
export interface ProcedureNativeObserver {emit?:(event:ProcedureEvent)=>void}
export function readProcedureFile(path:string,maximum?:number):Promise<Buffer>;
export function procedureDirectory(path:string,options?:{create?:boolean}):Promise<string>;
export function retainProcedureFile(path:string,bytes:Uint8Array):Promise<ProcedureFileReceipt>;
export function prepareGrantProcedureNative(client:GrantWorkspaceClient,input:NativeProcedureSelection):Promise<NativePreparedProcedure>;
export function reopenGrantProcedureNative(client:GrantWorkspaceClient,input:{caseId:string;sourceId:string}):Promise<NativeReopenedProcedure>;
export function saveGrantProcedureNative(client:GrantWorkspaceClient,input:{
 prepared:string|{raw:string};requestId:string;operationDirectory:string;workspaceDirectory:string;resume?:boolean;
},observer?:ProcedureNativeObserver):Promise<{complete:ProcedureSaved;verification:ProcedureVerification;reused:boolean}>;
export function inspectGrantProcedureDelivery(directory:string):Promise<{manifest:ProcedureDeliveryManifest;summary:ProcedureInspection['summary']}>;
export function exportGrantProcedureNative(client:GrantWorkspaceClient,input:{
 caseId:string;sourceId:string;expectedVersion:number;directory:string;
}):Promise<{manifest:ProcedureDeliveryManifest;directory:string;reused:boolean;preservedStage?:string}>;
export function receiveGrantProcedureNative(client:GrantWorkspaceClient,input:{
 directory:string;operationDirectory:string;workspaceDirectory:string;requestId:string;name:string;actor:string;resume?:boolean;
},observer?:ProcedureNativeObserver):Promise<{complete:ProcedureReceived;verification:ProcedureVerification;current:ProcedureCase;reused:boolean}>;
