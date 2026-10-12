import type {Buffer} from 'node:buffer';
import type {Control,JSONValue,JsonObject,SourceOptions,SourceRole,SourceInspection,SourceSummary,SourceRow,ProfileInput,Profile,EditionDefinition,EditionSummary,LinkInput,Link,WorkInput,WorkSummary,WorkQueueRow,Work,RequestSummary,RequestDetail,NormalizedOrder,DecisionSelection,ReviewDecision,ReturnSummary,ReturnDetail,Proposal,DispatchDefinition,DispatchSummary,DispatchRow,Page,PageInput,Changes,WorkspaceOperation,MutationResult,ExportSelection} from './index.mjs';
export const FOLLOW_THROUGH_HOST_SCHEMA:'stellar-forge.open311-follow-through-host.v1';
export interface HostInput {label:string;path:string;sha256:string;kind:'source'|'metadata'|'review'|'workspace';format:'arcgis'|'geojson'|'csv'|'json'|'auto'}
export interface HostWorkspace {label:string;directory:string;inputs:Record<string,HostInput>}
export interface HostConfiguration {schema:typeof FOLLOW_THROUGH_HOST_SCHEMA;path:string;workspaces:Record<string,HostWorkspace>}
export function readFollowThroughWorkspaceConfiguration(path:string):Promise<HostConfiguration>;
export function readFollowThroughHostInput(entry:HostWorkspace,alias:string,expectedSha256?:string):Promise<{input:HostInput;bytes:Buffer;sha256:string;originalText:string;name:string}>;
export type CallTool=(name:string,args:Record<string,unknown>)=>unknown|Promise<unknown>;
export interface FileManifest {name:string;type:string;bytes:number;sha256:string;[key:string]:JSONValue}
export type FileSelection=(ExportSelection|{kind:'operation';operationId:string})&{expectedRevision:number};
export interface FileContinuation {readId?:string;expectedSha256?:string;offset?:number;limit?:number}
export interface FileChunk {file:FileManifest;readId:string;encoding:'base64';data:string;offset:number;bytesRead:number;nextOffset:number|null}
export interface Paged<T> extends Page<T> {workspaceId:string;revision:number;returned:number;nextOffset:number|null}
export type AtRevision={expectedRevision:number};
export type HostAction=Control&{input:string;expectedSha256:string};
export type SourceSelection=Omit<SourceOptions,'metadataText'>&{metadataInput?:string;expectedMetadataSha256?:string};
export class Open311FollowThroughMerchantClient {
  constructor(callTool:CallTool,workspace:string);
  call(name:string,input?:Record<string,unknown>):Promise<unknown>;
  workspaces():Promise<JsonObject>;
  status():Promise<JsonObject>;
  records(kind:'sources'|'profiles'|'editions'|'work'|'returns'|'dispatches',input:AtRevision&PageInput):Promise<Paged<SourceSummary|Profile|EditionSummary|WorkSummary|ReturnSummary|DispatchSummary>>;
  input(input:string):Promise<JsonObject>;
  inspectSource(input:{input:string;expectedSha256?:string}&SourceSelection):Promise<SourceInspection>;
  importSource(input:HostAction&SourceSelection&{role:SourceRole;seriesId:string;observedAt:string}):Promise<MutationResult<{source:SourceSummary;reused:boolean}>>;
  saveProfile(input:Control&{profile:ProfileInput}):Promise<MutationResult<{profile:Profile;reused:boolean}>>;
  build(input:Control&{definition:EditionDefinition}):Promise<MutationResult<{edition:EditionSummary}>>;
  record(kind:'source'|'profile'|'edition',input:AtRevision&{id:string}):Promise<Record<string,unknown>>;
  sourceRows(input:AtRevision&{id:string}&PageInput):Promise<Paged<SourceRow>>;
  requests(input:AtRevision&{editionId:string;discrepancy?:string;assignee?:string;workStatus?:string}&PageInput):Promise<Paged<RequestSummary>>;
  orders(input:AtRevision&{editionId:string}&PageInput):Promise<Paged<NormalizedOrder>>;
  request(input:AtRevision&{editionId:string;key:string}):Promise<RequestDetail&{workspaceId:string;revision:number}>;
  changes(input:AtRevision&{before:string;after:string;entity?:'requests'|'orders'}&PageInput):Promise<Paged<Changes['items'][number]>&Omit<Changes,'items'>>;
  reviewLink(input:Control&{selection:LinkInput}):Promise<MutationResult<{link:Link}>>;
  saveWork(input:Control&{work:WorkInput}):Promise<MutationResult<{work:WorkSummary}>>;
  workQueue(input:AtRevision&{editionId:string;approval?:string;assignee?:string;status?:string}&PageInput):Promise<Paged<WorkQueueRow>>;
  work(input:AtRevision&{id:string}&PageInput):Promise<Paged<Work>&{work:Work;section:'history'}>;
  importReview(input:HostAction):Promise<MutationResult<{returned:ReturnSummary}>>;
  returned(input:AtRevision&{id:string;targetEditionId?:string;section?:'proposals'|'decisions'}&PageInput):Promise<Paged<Proposal|ReviewDecision>&Omit<ReturnDetail,'proposals'|'decisions'>>;
  applyReview(input:Control&{selection:DecisionSelection}):Promise<MutationResult<{decision:ReviewDecision;returned:ReturnSummary;work:WorkSummary[];links:Link[]}>>;
  createDispatch(input:Control&{definition:DispatchDefinition}):Promise<MutationResult<{dispatch:DispatchSummary}>>;
  dispatch(input:AtRevision&{id:string}&PageInput):Promise<Paged<DispatchRow>&{dispatch:DispatchSummary;definition:DispatchDefinition;coverage:JsonObject}>;
  operation(requestId:string):Promise<WorkspaceOperation|null>;
  receive(input:HostAction):Promise<MutationResult<{originalWorkspaceId:string;originalRevision:number;packageSha256:string;records:number}>>;
  readFile(selection:FileSelection,continuation?:FileContinuation):Promise<FileChunk>;
  releaseFile(readId:string):Promise<{workspace:string;readId:string;state:'RELEASED'}>;
  downloadFile(selection:FileSelection,options?:{limit?:number;maximumBytes?:number;onChunk?:(bytes:Buffer,info:{file:FileManifest;offset:number})=>void|Promise<void>}):Promise<{file:FileManifest;bytesRead:number;bytes?:Buffer}>;
}
