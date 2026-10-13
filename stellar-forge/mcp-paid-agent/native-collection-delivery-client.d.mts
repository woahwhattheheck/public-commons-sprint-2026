// SPDX-License-Identifier: MIT
export interface ConnectionOptions {url:string;deliveryWorkspace?:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal}
export interface Page {offset?:number;limit?:number}
export interface HistoryPage extends Page {expectedHistorySha256?:string}
export interface Range {byteOffset?:number;maxBytes?:number}
export interface FileIdentity {bytes:number;sha256:string}
export interface OriginalRequest {id:string;collectionId:string;expectedManifestSha256:string;title:string;note:string;intentIds:string[];maxVerifyBytes:number;allowIncomplete:boolean}
export interface PrepareRequest extends OriginalRequest {expectedPreviewSha256:string}
export interface TaskRequest {id:string;expectedTaskSha256:string;title:string;note:string;intentIds:string[]}
export interface TaskPrepareRequest extends TaskRequest {expectedPreviewSha256:string}
export interface TaskIdentity {taskSha256:string;planSha256:string;system:string;id:string;revision:string}
export interface TaskInspection {schema:string;task:TaskIdentity;items:Array<{intentId:string;role:string;jobId:string;nativeState:string;originalStatus:string|null;recoveredReadId:string|null;bytes:number;sha256:string}>;offset:number;total:number;nextOffset:number|null}
export interface UploadChunk {offset:number;base64:string;chunkSha256:string}
export interface Requests {
 workspaces:Page;status:Page;preview:OriginalRequest;prepare:PrepareRequest;inspect:{id:string};
 'task-inspect':{expectedTaskSha256:string}&Page;'task-preview':TaskRequest;'task-prepare':TaskPrepareRequest;
 'manifest-file':{id:string;expectedFileSha256:string}&Range;
 'result-file':{id:string;expectedFileSha256:string}&Range;
 'package-file':{id:string;expectedFileSha256:string}&Range;
 'upload-start':{sha256:string;bytes:number;filename:string};
 'upload-status':{sha256:string};
 'upload-chunk':{sha256:string;offset:number;base64:string;chunkSha256:string};
 'upload-chunks':{sha256:string;chunks:UploadChunk[]};
 'upload-finish':{sha256:string};receive:{sha256:string};
 'received-list':HistoryPage;
 'received-package':{sha256:string};
 'received-manifest-file':{sha256:string;expectedFileSha256:string}&Range;
 'received-package-file':{sha256:string;expectedFileSha256:string}&Range;
 received:{sha256:string}&Page;
 'received-file':{sha256:string;path:string;expectedFileSha256:string}&Range;
}
export interface SavedRange extends FileIdentity {verifiedSavedFile:true;encoding:'base64';byteOffset:number;returnedBytes:number;nextByteOffset:number|null;data:string}
export interface Package extends FileIdentity {filename:string;mediaType:'application/x-ndjson';manifestSha256:string}
export interface CompleteDelivery {schema:string;id:string;state:'COMPLETE';request:OriginalRequest|(TaskRequest&{kind:'inbox-task'});previewSha256:string;package:Package;outputsComplete:boolean;responseCount:number;sourceFiles:number;files:{result:FileIdentity&{name:'result.json'};manifest:FileIdentity&{name:'manifest.json'}}}
export interface Upload extends FileIdentity {filename:string;offset:number;complete:boolean;uploadBatchChunks?:1|2}
export interface Member extends FileIdentity {path:string;role:'source'|'response'|'review'}
export interface Received extends FileIdentity {schema:string;manifestSha256:string;outputsComplete:boolean;title:string;items:Member[];offset:number;total:number;nextOffset:number|null}
export interface TaskOrigin {taskSha256:string;planSha256:string;system:string;id:string;revision:string}
export type ReceiptSummary = {sha256:string;state:'COMPLETE';title:string;collectionId:string|null;task?:TaskOrigin;capturedAt:string;manifestSha256:string;bytes:number;files:number;contentBytes:number;outputsComplete:boolean;requestCount:number}
 | {sha256:string;state:'INCOMPLETE'} | {sha256:string;state:'UNAVAILABLE';code:string};
export interface ReceivedHistory {schema:string;historySha256:string;items:ReceiptSummary[];offset:number;total:number;nextOffset:number|null}
export interface ReceivedPackage {schema:string;state:'COMPLETE';sha256:string;package:FileIdentity&{manifestSha256:string};origin:{collectionId:string|null;task?:TaskOrigin};outputsComplete:boolean;files:{manifest:FileIdentity&{name:'manifest.json'}}}
export interface Preview {schema:string;request:OriginalRequest;previewSha256:string;source:{sha256:string;files:number;bytes:number};[key:string]:unknown}
export interface TaskPreview {schema:string;request:TaskRequest&{kind:'inbox-task'};task:TaskIdentity;previewSha256:string;source:{sha256:string;files:number;bytes:number};[key:string]:unknown}
export interface Responses {
 workspaces:{schema:string;operation:'workspaces';items:unknown[];offset:number;total:number;nextOffset:number|null};
 status:{mode:'COLLECTIONS'|'RECEIVING'|'INBOX_TASK';source:unknown;uploadBatchChunks?:1|2;items:unknown[];offset:number;total:number;nextOffset:number|null};
 'task-inspect':TaskInspection;'task-preview':TaskPreview;'task-prepare':CompleteDelivery;
 preview:Preview;prepare:CompleteDelivery;inspect:CompleteDelivery|{schema:string;id:string;state:'PREPARING'};
 'manifest-file':{id:string;filename:'manifest.json';file:SavedRange};
 'result-file':{id:string;filename:'result.json';file:SavedRange};
 'package-file':{id:string;filename:'customer-delivery.ndjson';file:SavedRange};
 'upload-start':Upload;'upload-status':Upload;'upload-chunk':Upload;'upload-chunks':Upload;'upload-finish':Upload;
 'received-list':ReceivedHistory;'received-package':ReceivedPackage;
 'received-manifest-file':{sha256:string;filename:'manifest.json';file:SavedRange};
 'received-package-file':{sha256:string;filename:'customer-delivery.ndjson';file:SavedRange};
 receive:Received;received:Received;'received-file':{packageSha256:string;path:string;file:SavedRange};
}
export interface Context {requestSignal?:AbortSignal|null;timeoutMs?:number}
export interface NativeCustomerClient {
 readonly endpoint:string;readonly deliveryWorkspace:string|undefined;
 call<K extends keyof Requests>(operation:K,body:Requests[K],context?:Context):Promise<Responses[K]>;
 preview(request:OriginalRequest,context?:Context):Promise<Preview>;
 prepare(request:PrepareRequest,context?:Context):Promise<CompleteDelivery>;
 inspectTask(expectedTaskSha256:string,range?:Page,context?:Context):Promise<TaskInspection>;
 previewTask(request:TaskRequest,context?:Context):Promise<TaskPreview>;
 prepareTask(request:TaskPrepareRequest,context?:Context):Promise<CompleteDelivery>;
 inspect(id:string,context?:Context):Promise<Responses['inspect']>;
 received(sha256:string,range?:Page,context?:Context):Promise<Received>;
 receivedHistory(page?:HistoryPage,context?:Context):Promise<ReceivedHistory>;
 receivedPackage(sha256:string,context?:Context):Promise<ReceivedPackage>;
}
export const DELIVERY_NATIVE_SCHEMA:string;
export function openNativeCollectionDeliveryClient(options:ConnectionOptions):Promise<NativeCustomerClient>;
export function checkedDeliveryRange(value:SavedRange,selection:FileIdentity&{byteOffset:number;maxBytes:number}):Uint8Array;
export function uploadNativeCustomerPackage(options:{client:NativeCustomerClient;file:string;directory:string;expectedSha256:string;filename:string;signal?:AbortSignal;onProgress?:(value:{stage:'upload';sha256:string;offset:number;bytes:number;startOffset:number;chunks:number;uploadBatchChunks:number})=>void|Promise<void>}):Promise<{schema:string;intent:unknown;status:Upload}>;
export function retainNativeCustomerRequest<K extends 'preview'|'prepare'|'task-preview'|'task-prepare'|'receive'>(options:{client:NativeCustomerClient;directory:string;operation:K;body:Requests[K];signal?:AbortSignal}):Promise<{schema:string;intent:unknown;value:Responses[K]}>;
