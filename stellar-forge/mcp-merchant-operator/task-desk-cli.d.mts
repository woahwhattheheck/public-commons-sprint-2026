import type {MerchantTaskDesks,TaskDeskPacketFileSelection,TaskDeskRpcFileSelection,TaskDeskCustomerFileSelection} from './task-desk.mjs';
export type TaskDeskDownloadSelection=TaskDeskPacketFileSelection|
 (TaskDeskRpcFileSelection&{kind:'rpc'})|(TaskDeskCustomerFileSelection&{kind:'customer'});
/** Receive all original ranges, verify the entire file and publish atomically. */
export function receiveTaskDeskFile(bridge:MerchantTaskDesks,input:TaskDeskDownloadSelection,output:string):Promise<{
 path:string;bytes:number;sha256:string;name:string;contentType:string;reused:boolean
}>;
export function main(argv?:string[]):Promise<unknown>;
