import type {
 TaskDeskStatus,TaskDeskDraft,TaskDeskTaskDetail,TaskDeskComparison,TaskPreview,
 TaskDeskOperationReply,TaskDeskPacket,TaskDeskRpcResponse,TaskDeskRpcReads,
 TaskDeskCustomerInspection,TaskDeskCustomerSelection,TaskDeskCustomerRequest,
 TaskDeskCustomerPreview,TaskDeskCustomerDelivery,TaskDeskCustomerHistory,TaskDeskCustomerSourceManifest
} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/agents/task-desk/client.mjs';
export interface TaskDeskConnectionDefinition{
 label:string;connectionFile:string;roots:TaskDeskStatus['roots'];maxFileBytes:number;
}
export interface TaskDeskConnections{
 schema:'stellar-forge.task-desk-connections.v1';desks:Record<string,TaskDeskConnectionDefinition>;
}
export interface MerchantTaskDeskOptions{fetchImpl?:typeof fetch}
export interface MerchantTaskDeskConfig{taskDesks:TaskDeskConnections;exportsDirectory:string}
export interface MerchantTaskDeskResult<T>{desk:string;instanceId:string;bindingSha256:string;native:T}
export interface TaskDeskFileRead{
 desk:string;selection:Record<string,unknown>;readId:string;
 file:{name:string;contentType:string;bytes:number;sha256:string};
 offset:number;bytesRead:number;nextOffset:number|null;encoding:'base64';data:string;
}
export interface TaskDeskFileSelection{
 desk:string;expectedInstanceId?:string;readId?:string;expectedSha256?:string;offset?:number;limit?:number;
}
export interface TaskDeskPacketFileSelection extends TaskDeskFileSelection{
 taskId:string;expectedTaskSha256:string;kind:'response'|'archive';intentId?:string;
}
export interface TaskDeskRpcFileSelection extends TaskDeskFileSelection{
 intentId:string;sourceReadId:string;responseSha256:string;
}

export interface TaskDeskCustomerTaskSelection {desk:string;taskId:string;expectedTaskSha256:string}
export interface TaskDeskCustomerReviewedSelection extends TaskDeskCustomerTaskSelection {
 request:TaskDeskCustomerRequest;expectedPreviewSha256:string;
}
export interface TaskDeskCustomerFileSelection extends TaskDeskFileSelection,TaskDeskCustomerReviewedSelection {
 packageSha256:string;manifestSha256:string;
}

export type TaskDeskMerchantDraft=Omit<TaskDeskDraft,'selections'>&{
 selections:(Omit<TaskDeskDraft['selections'][number],'rpcResult'>&{
   rpcResult?:{readId:string;responseSha256:string}
 })[];
};
export function readTaskDeskConfiguration(path:string):Promise<TaskDeskConnections>;
/** Transport ownership only; close releases this bridge's reads, never the original desk. */
export class MerchantTaskDesks{
 constructor(config:MerchantTaskDeskConfig,options?:MerchantTaskDeskOptions);
 readonly summary:{configured:boolean;ownership:'EXISTING_INBOX_TASK_DESK';
  desks:{desk:string;label:string;roots:TaskDeskStatus['roots'];maxFileBytes:number}[];
  files:{activeFileReads:number;pendingFileCloses:number;snapshotBytes:number;immutableFileBytes:number}};
 call(name:'merchant_task_desk_status',args:{desk:string}):Promise<MerchantTaskDeskResult<Omit<TaskDeskStatus,'csrfToken'>>>;
 call(name:'merchant_task_desk_inspect',args:{desk:string;taskId:string;expectedTaskSha256:string}):Promise<MerchantTaskDeskResult<TaskDeskTaskDetail>>;
 call(name:'merchant_task_desk_packet',args:{desk:string;taskId:string;expectedTaskSha256:string}):Promise<MerchantTaskDeskResult<TaskDeskPacket>>;
 call(name:'merchant_task_desk_packet_file',args:TaskDeskPacketFileSelection):Promise<TaskDeskFileRead>;
 call(name:'merchant_task_desk_rpc_file',args:TaskDeskRpcFileSelection):Promise<TaskDeskFileRead>;
 call(name:'merchant_task_desk_rpc_inspect',args:{desk:string;intentId:string;readId:string;responseSha256:string}):Promise<MerchantTaskDeskResult<TaskDeskRpcResponse>>;
 call(name:'merchant_task_desk_rpc_reads',args:{desk:string;intentId:string}):Promise<MerchantTaskDeskResult<TaskDeskRpcReads>>;
 call(name:'merchant_task_desk_preview',args:TaskDeskMerchantDraft&{desk:string;expectedInstanceId:string}):Promise<MerchantTaskDeskResult<TaskPreview>>;
 call(name:'merchant_task_desk_create',args:TaskDeskMerchantDraft&{desk:string;expectedInstanceId:string;expectedPreviewSha256:string}):Promise<MerchantTaskDeskResult<TaskDeskTaskDetail>>;
 call(name:'merchant_task_desk_execute',args:{desk:string;expectedInstanceId:string;taskId:string;expectedTaskSha256:string;intentId:string;reviewId:string;requestId:string}):Promise<MerchantTaskDeskResult<TaskDeskOperationReply<'execute'>>>;
 call(name:'merchant_task_desk_recover',args:{desk:string;expectedInstanceId:string;taskId:string;expectedTaskSha256:string;intentId:string;requestId:string}):Promise<MerchantTaskDeskResult<TaskDeskOperationReply<'recover'>>>;
 call(name:'merchant_task_desk_receive',args:{desk:string;expectedInstanceId:string;taskId:string;expectedTaskSha256:string;requestId:string}):Promise<MerchantTaskDeskResult<TaskDeskOperationReply<'receive'>>>;
 call(name:'merchant_task_desk_compare',args:{desk:string;taskId:string;expectedTaskSha256:string;previousId:string;expectedPreviousTaskSha256:string}):Promise<MerchantTaskDeskResult<TaskDeskComparison>>;

 call(name:'merchant_task_desk_customer_source',args:{desk:string;expectedInstanceId:string;sourceRoot:string;destination:string}):Promise<MerchantTaskDeskResult<TaskDeskCustomerSourceManifest>>;
 call(name:'merchant_task_desk_customer_task',args:TaskDeskCustomerTaskSelection):Promise<MerchantTaskDeskResult<TaskDeskCustomerInspection>>;
 call(name:'merchant_task_desk_customer_deliveries',args:TaskDeskCustomerTaskSelection):Promise<MerchantTaskDeskResult<TaskDeskCustomerHistory>>;
 call(name:'merchant_task_desk_customer_preview',args:TaskDeskCustomerTaskSelection&{expectedInstanceId:string;selection:TaskDeskCustomerSelection}):Promise<MerchantTaskDeskResult<TaskDeskCustomerPreview>>;
 call(name:'merchant_task_desk_customer_prepare',args:TaskDeskCustomerReviewedSelection&{expectedInstanceId:string}):Promise<MerchantTaskDeskResult<TaskDeskCustomerDelivery>>;
 call(name:'merchant_task_desk_customer_inspect',args:TaskDeskCustomerTaskSelection&{deliveryId:string}):Promise<MerchantTaskDeskResult<TaskDeskCustomerDelivery>>;
 call(name:'merchant_task_desk_customer_reconcile',args:TaskDeskCustomerReviewedSelection):Promise<MerchantTaskDeskResult<TaskDeskCustomerDelivery>>;
 call(name:'merchant_task_desk_customer_file',args:TaskDeskCustomerFileSelection):Promise<TaskDeskFileRead>;
 call(name:string,args?:Record<string,unknown>):Promise<unknown>;
 close():Promise<void>;
}
