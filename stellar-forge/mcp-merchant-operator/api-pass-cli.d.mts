/// <reference types="node" />
import type {ApiPassWorkspaceClient,ApiPassOperationArguments,MutationIdentity,MutationResult,ExportDescription} from './api-pass-client.mjs';
export type WriteKind = 'connect' | 'purchase_prepare' | 'purchase_attach' | 'update' | 'prepare_request' |
 'adopt_request' | 'enqueue' | 'cancel' | 'decide' | 'capture';
type WithOptionalOperation<T> = T extends MutationIdentity ? Omit<T,'operationId'> & {operationId?:string} : T;
export type PreparationArguments<K extends WriteKind> = WithOptionalOperation<ApiPassOperationArguments[K]>;
export interface PreparedRequest<K extends WriteKind=WriteKind> {
 schema:'stellar-forge.sf101.api-pass-client-operation.v1'; preparedAt:string; url:string;
 workspace:string; workspaceId:string; tokenEnv:string; kind:K; arguments:ApiPassOperationArguments[K]; requestSha256:string;
}
export interface ClientOperationState {
 schema:'stellar-forge.sf101.api-pass-client-operation-state.v1'; requestSha256:string;
 phase:'PREPARED'|'SENDING'|'ATTENTION'|'NOT_OBSERVED'|'RETURNED'; attempts:number; updatedAt:string;
 error:{code:string;outcomeUnknown:boolean}|null; observation?:Record<string,unknown>|null;
 lookupError?:{code:string;outcomeUnknown:boolean};
}
export interface PrepareOperationOptions<K extends WriteKind> {
 directory:string; url:string; workspace:string; workspaceId:string; tokenEnv?:string; kind:K;
 arguments:PreparationArguments<K>; operationId?:K extends 'decide'|'capture'?never:string;
}
export function prepareApiPassOperation<K extends WriteKind>(options:PrepareOperationOptions<K>):Promise<{
 directory:string;phase:'PREPARED';request:PreparedRequest<K>;
}>;
export interface RunOperationOptions {
 directory:string;
 /** False reopens the exact host receipt. True may send its one retained native action. */
 execute?:boolean;
 client?:ApiPassWorkspaceClient; environment?:NodeJS.ProcessEnv; signal?:AbortSignal;
}
export type OperationResult =
 {directory:string;phase:'RETURNED'|'REOPENED';found:true;requestSha256:string;native:MutationResult|ExportDescription} |
 {directory:string;phase:'NOT_OBSERVED';found:false;requestSha256:string;observation:Record<string,unknown>|null};
export function runApiPassOperation(options:RunOperationOptions):Promise<OperationResult>;
export function reopenApiPassOperation(options:{directory:string}):Promise<{
 directory:string;request:PreparedRequest;phase:ClientOperationState['phase']|'REOPENED';found:boolean;
 state:ClientOperationState;native:MutationResult|ExportDescription|null;
}>;
/** Installed CLI. Read/preparation/result exits zero; unobserved exits three; errors exit two. */
export function main(args?:string[]):Promise<unknown>;
