import type { Buffer } from 'node:buffer';
import type { JSONValue, JsonObject, Control, SourceInspection, SourceSummary, SourceRow, HandoffSummary, HandoffRow, HandoffDefinition, HandoffDefinitionInput, ReturnSummary, DecisionSelection, DecisionSummary, DispatchSummary, DispatchDefinition, DispatchDefinitionInput, WorkspaceOperation, MutationResult, Page, PageInput, ExportSelection } from './index.mjs';
export const GIS_HOST_SCHEMA:'stellar-forge.open311-gis-host.v1';
export interface HostInput {label:string;path:string;sha256:string;kind:'source'|'return'|'workspace';format:'gpkg'|'geojson'|'csv'|'json'}
export interface HostWorkspace {label:string;directory:string;inputs:Record<string,HostInput>}
export interface HostConfiguration {schema:typeof GIS_HOST_SCHEMA;path:string;workspaces:Record<string,HostWorkspace>}
export function readGISWorkspaceConfiguration(path:string):Promise<HostConfiguration>;
export function readGISHostInput(entry:HostWorkspace,alias:string,expectedSha256?:string):Promise<{input:HostInput;bytes:Buffer;sha256:string;originalText:string|null;name:string}>;
export interface FileManifest {name:string;type:string;bytes:number;sha256:string;[key:string]:JSONValue}
export type FileSelection=(ExportSelection|{kind:'operation';operationId:string})&{expectedRevision:number};
export interface FileContinuation {readId?:string;expectedSha256?:string;offset?:number;limit?:number}
export interface FileChunk {file:FileManifest;readId:string;encoding:'base64';data:string;offset:number;bytesRead:number;nextOffset:number|null}
export interface Paged<T> extends Page<T> {workspaceId:string;revision:number;returned:number;nextOffset:number|null}
export type HostAction=Control&{input:string;expectedSha256:string};
export type CallTool=(name:string,args:Record<string,unknown>)=>unknown|Promise<unknown>;
export class Open311GISMerchantClient {
  constructor(callTool:CallTool,workspace:string);
  call(name:string,input?:Record<string,unknown>):Promise<unknown>;
  workspaces():Promise<JsonObject>;
  status():Promise<JsonObject>;
  records(kind:'sources'|'handoffs'|'returns'|'decisions'|'dispatches',input:{expectedRevision:number;offset?:number;limit?:number}):Promise<Paged<SourceSummary|HandoffSummary|ReturnSummary|DecisionSummary|DispatchSummary>>;
  input(input:string):Promise<{workspace:string;input:string;name:string;kind:HostInput['kind'];format:HostInput['format'];bytes:number;sha256:string}>;
  inspectSource(input:{input:string;reportId?:string;expectedSha256?:string}):Promise<SourceInspection>;
  importSource(input:HostAction&{reportId?:string;name?:string}):Promise<MutationResult<{source:SourceSummary;reused:boolean}>>;
  createHandoff(input:Control&{definition:HandoffDefinitionInput}):Promise<MutationResult<{handoff:HandoffSummary}>>;
  sourceRows(input:{id:string;expectedRevision:number}&PageInput):Promise<Paged<SourceRow>>;
  handoff(input:{id:string;expectedRevision:number}&PageInput):Promise<Paged<HandoffRow>&{handoff:HandoffSummary;definition:HandoffDefinition;coverage:JsonObject[]}>;
  row(input:{handoffId:string;key:string;expectedRevision:number}):Promise<{workspaceId:string;revision:number;handoff:HandoffSummary;row:HandoffRow;versions:JsonObject[]}>;
  importReturn(input:HostAction&{handoffId:string;analyst:string;name?:string}):Promise<MutationResult<{returned:ReturnSummary}>>;
  returned(input:{id:string;expectedRevision:number;section?:'changes'|'conflicts'|'missingKeys'|'decisions';offset?:number;limit?:number}):Promise<Paged<JSONValue>&{summary:ReturnSummary;section:string}>;
  decide(input:Control&{selection:DecisionSelection}):Promise<MutationResult<{decision:DecisionSummary;handoff:HandoffSummary}>>;
  createDispatch(input:Control&{definition:DispatchDefinitionInput}):Promise<MutationResult<{dispatch:DispatchSummary}>>;
  dispatch(input:{id:string;expectedRevision:number;offset?:number;limit?:number}):Promise<Paged<HandoffRow>&{summary:DispatchSummary;definition:DispatchDefinition;coverage:JsonObject[];decisionIds:string[]}>;
  operation(requestId:string):Promise<Omit<WorkspaceOperation,'input'>&{input:JsonObject}|null>;
  receive(input:HostAction):Promise<MutationResult<{originalWorkspaceId:string;originalRevision:number;packageSha256:string;records:number}>>;
  readFile(selection:FileSelection,continuation?:FileContinuation):Promise<FileChunk>;
  releaseFile(readId:string):Promise<{workspace:string;readId:string;state:'RELEASED'}>;
  downloadFile(selection:FileSelection,options?:{limit?:number;maximumBytes?:number;onChunk?:undefined}):Promise<{file:FileManifest;bytesRead:number;bytes:Buffer}>;
  downloadFile(selection:FileSelection,options:{limit?:number;maximumBytes?:number;onChunk:(bytes:Buffer,position:{file:FileManifest;offset:number})=>unknown|Promise<unknown>}):Promise<{file:FileManifest;bytesRead:number}>;
}
