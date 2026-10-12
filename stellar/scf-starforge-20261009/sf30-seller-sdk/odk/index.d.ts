// MIT. Original ODK Central native, Applications and merchant interfaces.
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type Awaitable<T> = T | Promise<T>;
export type RecordValue = Record<string,unknown>;
export interface CentralScope {
  submittedFrom?:string; submittedBefore?:string; updatedSince?:string; pageSize?:number;
}
export interface CentralFormSelection {projectId:number|string;formId:string}
export interface CentralConnectionInput {
  id?:string;name:string;url:string;authEnv:string;allowLoopback?:boolean;
}
export interface CentralPlanInput {
  id?:string;name:string;connectionId:string;forms:CentralFormSelection[];scope:CentralScope;
}
export interface CentralIndicator {
  name?:string;tableId:string;field?:string;
  operation:'rows'|'nonempty'|'sum'|'mean'|'minimum'|'maximum'|'distinct'|'frequency';
  equals?:string|number|boolean|null;
}
export interface CentralDatasetRuntime {port?:number;facilitator?:string;allowLocalFacilitator?:boolean}
export interface CentralReviewInput {
  id:string;expectedRevision:number;decision:'accept'|'revise';note:string;reviewer?:string;
  findings?:RecordValue[];indicators?:CentralIndicator[];
}
export interface CentralFileDescriptor {
  path:string;sha256:string;bytes:number;downloadUrl?:string;url?:string;[key:string]:unknown;
}
export interface CentralSavedFiles {
  id:string;files:string[];receipts:Record<string,{sha256:string;bytes:number}>;
  [key:string]:unknown;
}
export interface CentralDatasetInput {
  id:string;tableId:string;fields?:string[];name?:string;payment?:RecordValue;
  origin?:string;path?:string;exportId?:string;expectedSemanticSha256?:string;
  defaultLimit?:number;maxLimit?:number;
}
export interface CentralReportInput {
  id:string;baselineId?:string|null;title?:string;narrative?:string;
  indicators?:CentralIndicator[];reportId?:string;
}
export interface CentralReceivedArchive {
  archiveSha256:string;archiveBytes:number;workspaceId:string;workspaceRevision:number;files:number;
}
export interface CentralState {
  schema:'stellar-forge.odk-central-workspace.v1';id:string;revision:number;createdAt:string;
  connections:RecordValue[];plans:RecordValue[];captures:RecordValue[];reviews:RecordValue[];
  exports:RecordValue[];reports:RecordValue[];archives:RecordValue[];running:string[];
  receivedArchive:CentralReceivedArchive|null;[key:string]:unknown;
}
export interface CentralCaptureSummary extends RecordValue {
  id:string;revision:number;status:string;contentHash?:string;rowCount:number;submissionCount:number;
  forms:RecordValue[];tables:RecordValue[];decision:RecordValue|null;
}
export interface CentralCapture extends RecordValue {
  id:string;revision:number;status:string;contentHash?:string;
  forms:RecordValue[];tables:RecordValue[];decisions:RecordValue[];
}
export interface CentralRowsPage {rows:RecordValue[];next:string|null;[key:string]:unknown}
export interface CentralResourcesPage {resources:RecordValue[];next:number|null;[key:string]:unknown}
export interface CentralWorkspace {
  directory:string;
  state():CentralState;
  connect(input:CentralConnectionInput):Awaitable<RecordValue>;
  projects(input:{connectionId:string}):Awaitable<unknown>;
  forms(input:{connectionId:string;projectId:number|string}):Awaitable<unknown>;
  createPlan(input:CentralPlanInput):Awaitable<RecordValue>;
  capture(input:{planId:string;id?:string;label?:string}):Awaitable<CentralCaptureSummary>;
  resume(input:{id:string}):Awaitable<unknown>;
  pause(input:{id:string}):Awaitable<unknown>;
  wait(input:{id:string}):Awaitable<unknown>;
  edition(input:{id:string}):CentralCapture;
  rows(input:{id:string;tableId:string;after?:string;limit?:number;search?:string}):CentralRowsPage;
  row(input:{id:string;tableId:string;rowId:string}):RecordValue;
  resources(input:{id:string;after?:number;limit?:number;kind?:string}):CentralResourcesPage;
  quality(input:{id:string}):RecordValue;
  review(input:CentralReviewInput):CentralCapture;
  compare(input:{leftId:string;rightId:string;tableId:string;after?:string;limit?:number}):RecordValue;
  exportDataset(input:CentralDatasetInput):Promise<CentralSavedFiles>;
  report(input:CentralReportInput):Promise<CentralSavedFiles>;
  backup(input?:{id?:string}):Promise<CentralSavedFiles>;
  sourceFile(input:{hash:string}):Promise<CentralFileDescriptor>;
  exportFile(input:{id:string;path:string}):Promise<CentralFileDescriptor>;
  prepareRelease(input:{exportId:string;releaseId:string;label?:string;runtime?:CentralDatasetRuntime}):Awaitable<RecordValue>;
  releaseStatus(input?:RecordValue):Awaitable<RecordValue>;
  activateRelease(input:{id:string;expectedGeneration:number;reason:string}):Awaitable<RecordValue>;
  rollbackRelease(input:{to:string;expectedGeneration:number;reason:string}):Awaitable<RecordValue>;
  close():Promise<void>;
}
export interface CentralExtensionStore {
  directory:string;
  get<T extends RecordValue=RecordValue>(kind:string,id:string,required?:boolean):T|null;
  list<T extends RecordValue=RecordValue>(kind:string):T[];
  put<T extends RecordValue>(kind:string,id:string,value:T,expectedRevision?:number):T;
  writeRecord<T extends RecordValue>(kind:string,id:string,value:T,expectedRevision?:number):T;
  transaction<T>(operation:()=>T):T;
  retain(body:Uint8Array|string):Promise<{sha256:string;bytes:number}>;
  raw(hash:string):Promise<Uint8Array>;
  resource(captureId:string,key:string):RecordValue|null;
  saveResource(captureId:string,key:string,kind:string,receipt:RecordValue):RecordValue;
  [key:string]:unknown;
}
export type CentralWorkspaceExtension=(context:{workspace:CentralWorkspace;store:CentralExtensionStore})=>Awaitable<unknown>;
export function openCentralWorkspace(options:{directory:string;fetchImpl?:typeof fetch;extend?:CentralWorkspaceExtension}):Promise<CentralWorkspace>;
export interface CentralServer {
  url:string;origin:string;directory:string;token:string;close():Promise<void>;
}
export function createCentralServer(options:{workspace:CentralWorkspace;host?:string;port?:number;token?:string}):Promise<CentralServer>;
export interface RestoreCentralResult extends CentralReceivedArchive {
  schema:'stellar-forge.odk-central-workspace.v1';directory:string;replayed?:boolean;currentWorkspaceRevision?:number;
}
export function restoreCentralArchive(options:{archive:string;directory:string;expectedSha256?:string;signal?:AbortSignal}):Promise<RestoreCentralResult>;
export const ODK_CONNECTION_FILENAME:'odk.connection.json';
export const ODK_CONNECTION_SCHEMA:'stellar-forge.odk-central-live-connection.v1';
export const ODK_STARTUP_SCHEMA:'stellar-forge.odk-central-workspace-startup.v1';
export interface CentralConnectionValue {
  schema:typeof ODK_CONNECTION_SCHEMA;instanceId:string;directory:string;
  directoryIdentity:{dev:string;ino:string};workspaceId:string;operator:string;pid:number;
  startedAt:string;origin:string;url:string;
}
export interface CentralConnection {
  path:string;sha256:string;value:CentralConnectionValue;token:string;
}
export function readCentralConnection(path:string,options?:{directory?:string}):Promise<CentralConnection>;
export interface CentralRequestOptions {signal?:AbortSignal;timeoutMs?:number;maximum?:number;fetchImpl?:typeof fetch}
export function inspectCentralListener(connection:CentralConnection,options?:CentralRequestOptions):Promise<CentralState>;
export type CentralAction='connect'|'projects'|'forms'|'createPlan'|'capture'|'resume'|'pause'|'wait'|
  'edition'|'rows'|'row'|'resources'|'quality'|'review'|'compare'|'exportDataset'|'report'|'backup'|
  'sourceFile'|'exportFile'|'prepareRelease'|'releaseStatus'|'activateRelease'|'rollbackRelease';
export class CentralWorkspaceClient {
  constructor(connection:CentralConnection,options?:{fetchImpl?:typeof fetch});
  readonly binding:{instanceId:string;workspaceId:string;operator:string;startedAt:string;origin:string;pid:number};
  state(options?:CentralRequestOptions):Promise<CentralState>;
  action<T=unknown>(method:CentralAction,input?:RecordValue,options?:CentralRequestOptions):Promise<T>;
  connect(input:CentralConnectionInput,options?:CentralRequestOptions):Promise<RecordValue>;
  projects(input:{connectionId:string},options?:CentralRequestOptions):Promise<unknown>;
  forms(input:{connectionId:string;projectId:number|string},options?:CentralRequestOptions):Promise<unknown>;
  createPlan(input:CentralPlanInput,options?:CentralRequestOptions):Promise<RecordValue>;
  capture(input:{planId:string;id?:string;label?:string},options?:CentralRequestOptions):Promise<CentralCaptureSummary>;
  captureStatus(id:string,options?:CentralRequestOptions):Promise<RecordValue>;
  resume(input:{id:string},options?:CentralRequestOptions):Promise<unknown>;
  pause(input:{id:string},options?:CentralRequestOptions):Promise<unknown>;
  wait(input:{id:string},options?:CentralRequestOptions):Promise<unknown>;
  edition(input:{id:string},options?:CentralRequestOptions):Promise<CentralCapture>;
  rows(input:{id:string;tableId:string;after?:string;limit?:number;search?:string},options?:CentralRequestOptions):Promise<CentralRowsPage>;
  row(input:{id:string;tableId:string;rowId:string},options?:CentralRequestOptions):Promise<RecordValue>;
  resources(input:{id:string;after?:number;limit?:number;kind?:string},options?:CentralRequestOptions):Promise<CentralResourcesPage>;
  quality(input:{id:string},options?:CentralRequestOptions):Promise<RecordValue>;
  review(input:CentralReviewInput,options?:CentralRequestOptions):Promise<CentralCapture>;
  compare(input:{leftId:string;rightId:string;tableId:string;after?:string;limit?:number},options?:CentralRequestOptions):Promise<RecordValue>;
  exportDataset(input:CentralDatasetInput,options?:CentralRequestOptions):Promise<CentralSavedFiles>;
  report(input:CentralReportInput,options?:CentralRequestOptions):Promise<CentralSavedFiles>;
  backup(input?:{id?:string},options?:CentralRequestOptions):Promise<CentralSavedFiles>;
  sourceFile(input:{hash:string},options?:CentralRequestOptions):Promise<CentralFileDescriptor>;
  exportFile(input:{id:string;path:string},options?:CentralRequestOptions):Promise<CentralFileDescriptor>;
  prepareRelease(input:{exportId:string;releaseId:string;label?:string;runtime?:CentralDatasetRuntime},options?:CentralRequestOptions):Promise<RecordValue>;
  releaseStatus(input?:RecordValue,options?:CentralRequestOptions):Promise<RecordValue>;
  activateRelease(input:{id:string;expectedGeneration:number;reason:string},options?:CentralRequestOptions):Promise<RecordValue>;
  rollbackRelease(input:{to:string;expectedGeneration:number;reason:string},options?:CentralRequestOptions):Promise<RecordValue>;
  /** Release this attachment; the original Application keeps its listener and writer. */
  close():void;
}
export function connectCentralWorkspace(options:{connectionFile:string;directory?:string;fetchImpl?:typeof fetch}):Promise<CentralWorkspaceClient>;
export interface CentralManagedOptions {
  directory:string;operator?:string;port?:number;restoreArchive?:string;restoreSha256?:string;
  fetchImpl?:typeof fetch;signal?:AbortSignal;
}
export interface ManagedCentralWorkspace extends CentralServer {
  workspace:CentralWorkspace;operator:string;connection:{path:string;sha256:string;bytes:number;value:CentralConnectionValue};
  instanceId:string;restored:RestoreCentralResult|null;close():Promise<void>;
}
export function centralManagedOptions(argv:string[]):CentralManagedOptions;
export function startManagedCentralWorkspace(options:CentralManagedOptions):Promise<ManagedCentralWorkspace>;
export function centralStartup(service:ManagedCentralWorkspace):RecordValue;
export function runManagedCentralCli(argv?:string[],options?:{stdout?:{write(value:string):unknown};waitForClose?:boolean}):Promise<unknown>;
export const ODK_MCP_CONNECTION_SCHEMA:'stellar-forge.odk-workspace-connection.v1';
export interface CentralHostSource extends CentralConnectionInput {id:string}
export interface CentralMerchantProfile {label?:string;origin:string;path:string;payment:RecordValue;defaultLimit?:number;maxLimit?:number}
export interface CentralHostWorkspace {
  label:string;directory:string;connectionFile:string;workspaceId:string|null;
  connections:Record<string,CentralHostSource>;merchants:Record<string,CentralMerchantProfile>;
  runtimes:Record<string,CentralDatasetRuntime>;
}
export interface CentralHostConfiguration {
  configuration:string;sha256:string;workspaces:Record<string,CentralHostWorkspace>;
}
export function readCentralWorkspaceConfiguration(path:string):Promise<CentralHostConfiguration>;
export class MerchantCentralWorkspaces {
  constructor(config:{exportsDirectory:string;odkWorkspaces?:CentralHostConfiguration;[key:string]:unknown});
  readonly summary:RecordValue;
  call(name:string,args?:RecordValue):Promise<unknown>;
  close():Promise<void>;
}
export function odkWorkspaceTools<T>(tool:(name:string,description:string,properties:RecordValue,required:string[],annotations:RecordValue)=>T):T[];
export function initializeCentralWorkspaceMerchant(options:{directory:string;connection:string;name?:string}):Promise<RecordValue>;
export const ODK_FILE_SCHEMA:'stellar-forge.odk-central-retained-file.v1';
export function centralDownloadPath(value:string):{path:string;sourceHash:string|null};
export interface CentralRetainedFileRequest {
  requestId:string;downloadPath:string;expectedSha256:string;expectedBytes:number;
}
export interface CentralRetainedFile extends RecordValue {
  schema:typeof ODK_FILE_SCHEMA;fileId:string;workspaceId:string;requestSha256:string;
  sha256:string;bytes:number;filename:string;mediaType:string;completedAt:string;
}
export type CentralFileScope=CentralHostWorkspace&{alias:string};
export class CentralRetainedFiles {
  constructor(directory:string);
  readonly summary:RecordValue;
  find(scope:CentralFileScope,args:CentralRetainedFileRequest):Promise<(CentralRetainedFile&{reused:true})|null>;
  retain(scope:CentralFileScope,connection:CentralConnection,args:CentralRetainedFileRequest):Promise<CentralRetainedFile>;
  list(scope:CentralFileScope,offset?:number,limit?:number):Promise<{files:CentralRetainedFile[];offset:number;limit:number;total:number;nextOffset:number|null}>;
  file(scope:CentralFileScope,args:{fileId:string;readId?:string;expectedSha256?:string;offset?:number;limit?:number}):Promise<unknown>;
  release(scope:CentralFileScope,readId:string):Promise<void>;
  disconnect(scope:CentralFileScope):Promise<void>;
  close():Promise<void>;
}
