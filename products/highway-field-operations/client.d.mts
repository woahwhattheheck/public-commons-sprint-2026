/// <reference types="node" />
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type JsonObject = {[key:string]:Json};
export interface Actor {id:string;name:string}
export interface Branch {id:string;directory:string}
export interface Command {requestId:string;kind:string;actor:Actor;at:string;body:JsonObject}
export interface FileIdentity {bytes:number;sha256:string}
export interface PageOptions {offset?:number;limit?:number}
export interface Page<T=Json> {offset:number;total:number;nextOffset:number|null;items:T[]}
export interface HistoryEntry {
 revision:number;requestId:string;requestSha256:string;envelope:JsonObject;
 result:Json;previousSha256:string;sha256:string
}
export interface OriginalRequest {envelope:JsonObject;result:Json;requestSha256:string}
export interface SourceRecord {
 objectId:number;globalId:string|null;feature:JsonObject;attachments:Json[]
}
export interface RecordPage {
 offset:number;total:number;nextOffset:number|null;records:SourceRecord[];
 captureId:string;layerId:number;name:string;type:string;metadata:JsonObject;
 coverage:JsonObject;observations:Json[]
}
export interface WorkspaceState {
 revision:number;sha256:string;state:JsonObject;view:JsonObject;
 directory:string;sourceSha256:string;pairedAvailable:boolean;dispatch:JsonObject
}
export interface CommandResult {requestId:string;revision:number;sha256:string;outcome:Json;reused:boolean}
export interface FieldIssueRequest {
 id:string;recipient:Actor;inspectionIds:string[];workspaceRevision:number;stateSha256:string;
 note:string;actor:Actor;at:string
}
export interface FieldIssueResult extends CommandResult {issue:{id:string;document:FileIdentity;html:FileIdentity}}
export interface FieldReturnIntake extends FileIdentity {
 issueId:string;selectedEditionId:string|null;editions:Array<{id:string;parentId:string|null;label:string;actor:Actor;at:string}>;
 attachmentCount:number;draftRetained:boolean
}
export interface ProjectionSelection {
 captureId:string;layerId:number;formId:string;objectIdColumn:string;
 fieldMap:Array<{captureField:string;deliveryField:string;encoding?:'native'|'json-text'}>;
 sourceKind?:'captured'|'approved-proposal';
 proposalId?:string;proposalSha256?:string
}
export type NativeOperation =
 'status'|'inspect-delivery'|'review-import'|'import'|'review-pair'|'save-pair'|
 'run'|'decision'|'report'|'request'|'resume'|'read'|'page'|'row'|'export'|'receive';
export interface NativeResult {
 operationId:string;result:Json;recordBody:JsonObject;recordRequestId:string
}
export interface DatasetResult {
 operationId:string;selection:ProjectionSelection;projection:JsonObject;
 reportPath:string;delivery:JsonObject
}
export type DownloadSelection =
 {kind:'blob';id:string;expectedSha256?:string;expectedBytes?:number} |
 {kind:'archive';id:string;expectedSha256:string;expectedBytes:number} |
 {kind:'field-issue-json'|'field-issue-html'|'field-return';id:string;expectedSha256:string;expectedBytes:number} |
 {kind:'dispatch-report';id:string;expectedSha256?:string;expectedBytes?:number};
export interface DownloadResult extends FileIdentity {mediaType:string}
export interface ClientOptions {
 connectionFile:string;workspaceId:string;workspaceDirectory:string;timeoutMs?:number
}
export class HighwayFieldError extends Error {
 code:string;status:number|null;result:Json|null;uncertain:boolean;operation:Json|null;
 constructor(code:string,message:string,details?:{
  status?:number|null;result?:Json|null;uncertain?:boolean;operation?:Json|null
 });
}
export class HighwayFieldClient {
 constructor(options:ClientOptions);
 readonly selectedBranch:Branch;
 readonly connectionFile:string;
 state():Promise<WorkspaceState>;
 history(options?:PageOptions):Promise<Page<HistoryEntry>>;
 request(requestId:string):Promise<{request:OriginalRequest|null}>;
 records(captureId:string,layerId:number,options?:PageOptions):Promise<RecordPage>;
 inspection(inspectionId:string):Promise<JsonObject>;
 fieldIssue(request:FieldIssueRequest,expectedRevision:number):Promise<FieldIssueResult>;
 fieldComparison(returnId:string,editionId?:string,adoptionId?:string):Promise<JsonObject>;
 fieldDocument(kind:'issues'|'returns',recordId:string):Promise<{record:JsonObject;document:JsonObject}>;
 nativeRequest(operationId:string):Promise<JsonObject>;
 prepareDataset(operationId:string,selection:ProjectionSelection):Promise<DatasetResult>;
 native(operationId:string,operation:NativeOperation,input:JsonObject):Promise<NativeResult>;
 restoreNative(recordId:string,operationId:string):Promise<NativeResult>;
 pages(kind:'history',selection?:{},options?:PageOptions):AsyncGenerator<Page<HistoryEntry>,void,unknown>;
 pages(kind:'records',selection:{captureId:string;layerId:number},options?:PageOptions):AsyncGenerator<RecordPage,void,unknown>;
 command(command:Command,expectedRevision:number):Promise<CommandResult>;
 exportWorkspace(publicationId:string,revision:number):Promise<JsonObject>;
 receive(input:FileIdentity&{operationId:string}):Promise<JsonObject>;
 uploadBytes(kind:'blob'|'archive'|'field-file',data:Buffer,expected:FileIdentity):Promise<(FileIdentity&{reused?:boolean})|FieldReturnIntake>;
 uploadFile(kind:'blob'|'archive'|'field-file',file:string,expected:FileIdentity):Promise<(FileIdentity&{reused?:boolean})|FieldReturnIntake>;
 download(selection:DownloadSelection,onChunk:(chunk:Buffer)=>void|Promise<void>):Promise<DownloadResult>;
 /** Drains this borrowed client's original calls; never stops the Applications owner. */
 close():Promise<void>;
}
export function createHighwayFieldClient(options:ClientOptions):HighwayFieldClient;
