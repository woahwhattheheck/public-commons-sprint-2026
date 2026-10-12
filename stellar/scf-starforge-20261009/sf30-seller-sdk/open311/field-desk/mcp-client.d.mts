// MIT. Complete installed merchant types for original dispatch, crew, return and destination workflows.
import type {
  JSON, JSONObject, WriteIntent, Mutation, Page, Paging, WorkspaceState, Operation,
  SourceSummary, SourceInspection, SourceDetail, OriginalDispatch, OriginalDispatchRow,
  Crew, CrewInput, VisitInput, Visit, VisitSummary, VisitDetail, VisitQuery,
  AttachmentMetadata, PackageSummary, CrewPackage, PackageEntry,
  ReturnSummary, ReturnDetail, ReturnProposal, SavedDecision, DecideInput,
  VisitReviewInput, SavedReview, UpdateInput, UpdateSummary, DestinationUpdate, UpdateItem,
  ExportSelection, ReceivingReceipt
} from './index.mjs';
export const FIELD_DESK_HOST_SCHEMA:'stellar-forge.open311-field-desk-host.v1';
export interface HostFile {
  label:string;path:string;sha256:string;kind:'source'|'return'|'workspace'|'attachment';format:'json'|'binary';contentType:string;
}
export interface HostWorkspace {label:string;directory:string;inputs:Record<string,HostFile>}
export interface HostConfiguration {schema:typeof FIELD_DESK_HOST_SCHEMA;path:string;workspaces:Record<string,HostWorkspace>}
export function readFieldDeskWorkspaceConfiguration(path:string):Promise<HostConfiguration>;
export function readFieldDeskHostInput(entry:HostWorkspace,alias:string,expectedSha256?:string):Promise<{
  input:HostFile;bytes:Buffer;sha256:string;originalText:string|null;name:string
}>;
export type CallTool=(name:string,args:Record<string,unknown>)=>unknown|Promise<unknown>;
export interface FileManifest {name:string;type:string;bytes:number;sha256:string;[key:string]:JSON}
export type FileSelection=(ExportSelection|{kind:'attachment';attachmentId:string}|{kind:'operation';operationId:string})&{expectedRevision:number};
export interface FileContinuation {readId?:string;expectedSha256?:string;offset?:number;limit?:number}
export interface FileChunk {file:FileManifest;readId:string;encoding:'base64';data:string;offset:number;bytesRead:number;nextOffset:number|null}
export interface AtRevision {expectedRevision:number}
export interface WorkspaceVersion {workspaceId:string;revision:number}
export type Paged<T>=Page<T>&WorkspaceVersion&{returned:number};
export type Control=Omit<WriteIntent,'hostInput'>;
export type HostAction=Control&{input:string;expectedSha256:string};
export interface InputInfo {workspace:string;input:string;name:string;kind:HostFile['kind'];format:HostFile['format'];contentType:string;bytes:number;sha256:string}
export interface WorkspaceAlias {workspace:string;label:string;inputs:{input:string;label:string;sha256:string;kind:HostFile['kind'];format:HostFile['format'];contentType:string}[]}
export type Status=Omit<WorkspaceState,'directory'|'sources'|'crews'|'packages'|'returns'|'updates'|'operations'>&{
  workspace:string;label:string;recentOperations:WorkspaceState['operations'];[key:string]:unknown
};
export interface Records {sources:SourceSummary;crews:Crew;packages:PackageSummary;returns:ReturnSummary;updates:UpdateSummary}
export type SourceView=Omit<SourceDetail,'dispatch'>&WorkspaceVersion&{dispatch:Omit<OriginalDispatch,'rows'>&{rows:number}};
export type CrewView=Paged<Crew>&{crew:Crew;section:'history'};
export type VisitView=Paged<Visit|AttachmentMetadata>&Omit<VisitDetail,'history'|'attachments'>&{
  section:'history'|'attachments';historyCount:number;attachmentCount:number
};
export type PackageView=Paged<PackageEntry|AttachmentMetadata>&{
  package:Omit<CrewPackage,'visits'|'attachments'>&{visits:number;attachments:number};section:'visits'|'attachments'
};
export type ReturnView=Paged<ReturnProposal|SavedDecision>&Omit<ReturnDetail,'proposals'|'decisions'>&{section:'proposals'|'decisions'};
export type UpdateView=Paged<UpdateItem|AttachmentMetadata>&{
  update:Omit<DestinationUpdate,'items'|'attachments'>&{items:number;attachments:number};section:'items'|'attachments'
};
export type OperationView=Omit<Operation,'input'>&{input:JSONObject};
export class Open311FieldDeskMerchantClient {
  constructor(callTool:CallTool,workspace:string);
  call(name:string,input?:Record<string,unknown>):Promise<unknown>;
  workspaces():Promise<{configured:boolean;workspaces:WorkspaceAlias[];[key:string]:unknown}>;
  status():Promise<Status>;
  records<K extends keyof Records>(kind:K,input:AtRevision&Paging):Promise<Paged<Records[K]>&{kind:K}>;
  input(input:string):Promise<InputInfo>;
  inspectSource(input:{input:string;expectedSha256?:string;dispatchId?:string}):Promise<SourceInspection>;
  importSource(input:HostAction&{name:string;dispatchId?:string}):Promise<Mutation<{source:SourceSummary}>>;
  source(input:AtRevision&{id:string}):Promise<SourceView>;
  sourceRows(input:AtRevision&{sourceId:string}&Paging):Promise<Paged<OriginalDispatchRow>>;
  saveCrew(input:Control&{crew:CrewInput}):Promise<Mutation<{crew:Crew}>>;
  crew(input:AtRevision&{id:string}&Paging):Promise<CrewView>;
  saveVisit(input:Control&{visit:VisitInput}):Promise<Mutation<{visit:VisitSummary}>>;
  visits(input:AtRevision&VisitQuery):Promise<Paged<VisitSummary>>;
  visit(input:AtRevision&{id:string;section?:'history'|'attachments'}&Paging):Promise<VisitView>;
  saveAttachment(input:HostAction&{filename?:string}):Promise<Mutation<{attachment:AttachmentMetadata;duplicate:boolean}>>;
  createPackage(input:Control&{name:string;visitIds:string[];note?:string}):Promise<Mutation<{package:PackageSummary}>>;
  package(input:AtRevision&{id:string;section?:'visits'|'attachments'}&Paging):Promise<PackageView>;
  importReturn(input:HostAction&{name?:string}):Promise<Mutation<{return:ReturnSummary}>>;
  returned(input:AtRevision&{id:string;section?:'proposals'|'decisions'}&Paging):Promise<ReturnView>;
  applyDecisions(input:Omit<DecideInput,'hostInput'>):Promise<Mutation<{decision:SavedDecision;return:ReturnSummary}>>;
  reviewVisits(input:Omit<VisitReviewInput,'hostInput'>):Promise<Mutation<{review:SavedReview}>>;
  createUpdate(input:Omit<UpdateInput,'hostInput'>):Promise<Mutation<{update:UpdateSummary}>>;
  update(input:AtRevision&{id:string;section?:'items'|'attachments'}&Paging):Promise<UpdateView>;
  operation(requestId:string):Promise<OperationView|null>;
  receive(input:HostAction):Promise<Mutation<{packageSha256:string;receivedFrom:ReceivingReceipt}>>;
  readFile(selection:FileSelection,continuation?:FileContinuation):Promise<FileChunk>;
  releaseFile(readId:string):Promise<{workspace:string;readId:string;state:'RELEASED'}>;
  downloadFile(selection:FileSelection,options?:{
    limit?:number;maximumBytes?:number;onChunk?:(bytes:Buffer,info:{file:FileManifest;offset:number})=>void|Promise<void>
  }):Promise<{file:FileManifest;bytesRead:number;bytes?:Buffer}>;
}
