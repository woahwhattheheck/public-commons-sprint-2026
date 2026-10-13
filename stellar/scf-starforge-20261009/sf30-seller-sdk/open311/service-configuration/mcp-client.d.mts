// MIT. Complete installed merchant types for original sources, service configurations, routing and implementation handovers.
import type { Buffer } from 'node:buffer';
import type {
  JsonValue, MutationControl, MutationResult, Page, PageSelection, WorkspaceState, Operation,
  SourceSummary, SourceInspection, OriginalRow, ProfileRecord, ProfileSummary,
  PutProfileInput, SourceSelection, CreatePreviewInput, PreviewRecord, PreviewSummary, PreviewRow, PreviewPage,
  CreateReleaseInput, ReleaseRecord, ReleaseSummary, ApplyStage, Implication, ExportKind, ReceivingReceipt
} from './index.mjs';
export const SERVICE_CONFIGURATION_HOST_SCHEMA:'stellar-forge.open311-service-configuration-host.v1';
export interface HostFile {label:string;path:string;sha256:string;kind:'source'|'profile'|'workspace';format:'json';contentType:string}
export interface HostWorkspace {label:string;directory:string;inputs:Record<string,HostFile>}
export interface HostConfiguration {schema:typeof SERVICE_CONFIGURATION_HOST_SCHEMA;path:string;workspaces:Record<string,HostWorkspace>}
export function readServiceConfigurationWorkspaceConfiguration(path:string):Promise<HostConfiguration>;
export function readServiceConfigurationHostInput(entry:HostWorkspace,alias:string,expectedSha256?:string):Promise<{
  input:HostFile;bytes:Buffer;sha256:string;originalText:string;name:string
}>;
export type CallTool=(name:string,args:Record<string,unknown>)=>unknown|Promise<unknown>;
export interface FileManifest {name:string;type:string;bytes:number;sha256:string;[key:string]:JsonValue}
export interface AtRevision {expectedRevision:number}
export interface WorkspaceVersion {workspaceId:string;revision:number}
export type FileSelection=AtRevision&(
  {kind:'workspace'}|
  ({kind:'profile'}&({profileId:string;profileVersionId?:string}|{profileId?:string;profileVersionId:string}))|
  {kind:'source';sourceId:string}|
  {kind:'preview-json'|'preview-csv';previewId:string}|
  {kind:'release-json'|'release-report';releaseId:string}|
  {kind:'operation';operationId:string}
);
export interface FileContinuation {readId?:string;expectedSha256?:string;offset?:number;limit?:number}
export interface FileChunk {file:FileManifest;readId:string;encoding:'base64';data:string;offset:number;bytesRead:number;nextOffset:number|null}
export type Paged<T>=Page<T>&WorkspaceVersion&{returned:number};
export type HostAction=MutationControl&{input:string;expectedSha256:string};
export interface InputInfo {workspace:string;input:string;name:string;kind:HostFile['kind'];format:'json';contentType:string;bytes:number;sha256:string}
export interface WorkspaceAlias {workspace:string;label:string;inputs:{input:string;label:string;sha256:string;kind:HostFile['kind'];format:'json';contentType:string}[]}
export type Status=Omit<WorkspaceState,'directory'|'sources'|'profiles'|'previews'|'releases'|'operations'>&{
  workspace:string;label:string;recentOperations:WorkspaceState['operations'];[key:string]:unknown
};
export interface Records {sources:SourceSummary;profiles:ProfileSummary;previews:PreviewSummary;releases:ReleaseSummary}
export type SourceView=WorkspaceVersion&{source:SourceSummary};
export type ProfileView=Paged<ProfileRecord>&{profile:ProfileRecord;section:'history';historyCount:number};
export type SelectedProfile=Pick<ProfileRecord,'schema'|'id'|'versionId'|'previousVersionId'|'createdAt'|'sha256'>&{name:string};
export type SelectedPreview=Omit<PreviewRecord,'items'|'implications'|'overrides'>&{implications:number;overrides:number};
export type SelectedRelease=Omit<ReleaseRecord,'profile'|'preview'|'source'|'baseline'|'remaining'|'applyOrder'|'implications'>&{
  profile:SelectedProfile;preview:SelectedPreview;source:SourceSummary;
  baseline:{profile:SelectedProfile;declaredBy:string;note:string}|null;
  remaining:number;applyOrder:number;implications:number
};
export interface ReleaseSections {remaining:ReleaseRecord['remaining'][number];'apply-order':ApplyStage;implications:Implication}
export type ReleaseView<S extends keyof ReleaseSections='remaining'>=Paged<ReleaseSections[S]>&{release:SelectedRelease;section:S};
export type OperationView=Omit<Operation,'input'>&{input:Record<string,unknown>};
export interface DownloadOptions {limit?:number;maximumBytes?:number;onChunk?:(bytes:Buffer,info:{file:FileManifest;offset:number})=>void|Promise<void>}
export class Open311ServiceConfigurationMerchantClient {
  constructor(callTool:CallTool,workspace:string);
  call(name:string,input?:Record<string,unknown>):Promise<unknown>;
  workspaces():Promise<{configured:boolean;workspaces:WorkspaceAlias[];[key:string]:unknown}>;
  status():Promise<Status>;
  records<K extends keyof Records>(kind:K,input:AtRevision&PageSelection):Promise<Paged<Records[K]>&{kind:K}>;
  input(input:string):Promise<InputInfo>;
  inspectSource(input:{input:string;expectedSha256?:string}):Promise<SourceInspection>;
  importSource(input:HostAction&{name:string;selection:SourceSelection}):Promise<MutationResult<{source:SourceSummary}>>;
  source(input:AtRevision&{id:string}):Promise<SourceView>;
  sourceRows(input:AtRevision&{sourceId:string}&PageSelection):Promise<Paged<OriginalRow>>;
  saveProfile(input:Omit<PutProfileInput,'hostInput'|'originalText'>):Promise<MutationResult<{profile:ProfileSummary}>>;
  importProfile(input:HostAction&{profileId?:string;expectedProfileVersionId?:string|null}):Promise<MutationResult<{profile:ProfileSummary}>>;
  profile(input:AtRevision&{id:string}&Omit<PageSelection,'q'>):Promise<ProfileView>;
  createPreview(input:CreatePreviewInput):Promise<MutationResult<{preview:PreviewSummary}>>;
  preview(input:AtRevision&{id:string}&PageSelection):Promise<PreviewPage&WorkspaceVersion&{returned:number}>;
  createRelease(input:CreateReleaseInput):Promise<MutationResult<{release:ReleaseSummary}>>;
  release<S extends keyof ReleaseSections='remaining'>(input:AtRevision&{id:string;section?:S}&Omit<PageSelection,'q'>):Promise<ReleaseView<S>>;
  operation(requestId:string):Promise<OperationView|null>;
  receive(input:HostAction):Promise<MutationResult<{packageSha256:string;receivedFrom:ReceivingReceipt}>>;
  readFile(selection:FileSelection,continuation?:FileContinuation):Promise<FileChunk>;
  releaseFile(readId:string):Promise<{workspace:string;readId:string;state:'RELEASED'}>;
  downloadFile(selection:FileSelection,options?:Omit<DownloadOptions,'onChunk'>&{onChunk?:undefined}):Promise<{file:FileManifest;bytesRead:number;bytes:Buffer}>;
  downloadFile(selection:FileSelection,options:DownloadOptions&{onChunk:NonNullable<DownloadOptions['onChunk']>}):Promise<{file:FileManifest;bytesRead:number;bytes?:never}>;
  downloadFile(selection:FileSelection,options?:DownloadOptions):Promise<{file:FileManifest;bytesRead:number;bytes?:Buffer}>;
}
