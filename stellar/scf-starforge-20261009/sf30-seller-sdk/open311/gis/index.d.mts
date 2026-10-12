import type { Buffer } from 'node:buffer';
import type { Server } from 'node:http';
export type JSONValue=null|boolean|number|string|JSONValue[]|{[key:string]:JSONValue};
export type JsonObject={[key:string]:JSONValue};
export interface Point {type:'Point';coordinates:[number,number]}
export type Geometry=Point|null;
export type GeometryStatus='SOURCE_POINT'|'MISSING_COORDINATES'|'INVALID_COORDINATES';
export interface OperatorFields {assignedTeam:string;assetId:string;workOrderId:string;priority:string;action:'review'|'dispatch'|'defer'|'dismiss';dueDate:string;note:string}
export interface SourceIdentity {baseUrl:string;jurisdictionId:string;serviceRequestId:string}
export interface SourceRow {
  key:string;sourceIdentity:SourceIdentity;sourceKey:string;sourceId:string;originalSourceId:string;
  serviceRequestId:string;sourceSha256:string;captureId:string;collectionId:string;observedAt:string;
  serviceCode:string|null;serviceName:string|null;sourceStatus:string|null;sourceStatusNotes:string;sourceClosedAt:string|null;
  description:string|null;address:string|null;agency:JSONValue;requestedAt:string|null;updatedAt:string|null;
  source:JsonObject;sourceReview:JSONValue;reportContext:JSONValue;geometryStatus:GeometryStatus;originalGeometry:Geometry;geometry:Geometry;
}
export interface HandoffRow extends SourceRow {operator:OperatorFields;lastDecisionId:string|null;geometryOrigin:'source'|'analyst';sourceChanged:boolean;previousSourceSha256:string|null}
export interface Counts {rows:number;located:number;unlocated:number;invalidGeometry:number}
export interface HandoffCounts extends Counts {dispatchReady:number;changedSources:number}
export interface SourceConnection {baseUrl:string;jurisdictionId:string;name:string;attribution:JsonObject}
export interface SourceSummary {id:string;kind:'collection'|'report';name:string;sha256:string;bytes:number;reportId:string|null;importedAt:string;counts:Counts;connections:SourceConnection[];coverage:JsonObject[]}
export interface ImportedSource extends SourceSummary {schema:typeof GIS_SOURCE_SCHEMA;originalText:string;rows:SourceRow[]}
export interface SourceInspection {kind:'collection'|'report';name:string;sha256:string;bytes:number;reports:{id:string;name:string;rows:number}[];selectedReportId:string|null;summary:Counts|null}
export interface HandoffDefinitionInput {name:string;sourceIds:string[];predecessorId?:string|null;filters?:{q?:string;statuses?:(string|null)[];serviceCodes?:(string|null)[];geometry?:'any'|'located'|'unlocated'};defaults?:Partial<OperatorFields>}
export interface HandoffDefinition {name:string;sourceIds:string[];predecessorId:string|null;filters:{q:string;statuses:(string|null)[];serviceCodes:(string|null)[];geometry:'any'|'located'|'unlocated'};defaults:OperatorFields}
export interface HandoffSummary {id:string;seriesId:string;edition:number;predecessorId:string|null;name:string;sha256:string;createdAt:string;sourceIds:string[];counts:HandoffCounts;head:boolean}
export interface Handoff extends Omit<HandoffSummary,'head'> {schema:typeof HANDOFF_SCHEMA;definition:HandoffDefinition;rows:HandoffRow[];coverage:JsonObject[];decisionHistory:string[];interpretation:string;creation?:{kind:'decision';decisionId:string}}
export interface EditableRow {geometry:Geometry;operator:OperatorFields}
export interface AnalystChange {id:string;key:string;serviceRequestId:string;sourceSha256:string;fields:string[];before:EditableRow;after:EditableRow}
export interface AnalystConflict {id:string;rowNumber:number|null;key:string|null;code:string;message:string;fields:string[]}
export type AnalystFormat='gpkg'|'geojson'|'csv'|'json';
export interface OriginalFile {encoding:'base64';body:string;bytes:number;sha256:string}
export interface ReturnCounts {changes:number;conflicts:number;missing:number;unchanged:number}
export interface AnalystReturn {schema:typeof RETURN_SCHEMA;id:string;sha256:string;handoffId:string;handoffSha256:string;analyst:string;name:string;format:AnalystFormat;original:OriginalFile;receivedAt:string;changes:AnalystChange[];conflicts:AnalystConflict[];missingKeys:string[];unchangedCount:number;counts:ReturnCounts}
export interface ReturnSummary {id:string;handoffId:string;handoffSha256:string;analyst:string;name:string;format:AnalystFormat;sha256:string;editionSha256:string;bytes:number;receivedAt:string;counts:ReturnCounts}
export interface DecisionSelection {returnId:string;handoffId:string;reviewer:string;note?:string;accept?:string[];reject?:string[]}
export interface Decision {schema:typeof DECISION_SCHEMA;id:string;sha256:string;returnId:string;returnSha256:string;handoffId:string;handoffSha256:string;baseHandoffId:string;newHandoffId:string;newHandoffSha256:string;reviewer:string;note:string;accept:string[];reject:string[];createdAt:string}
export interface DecisionSummary {id:string;returnId:string;handoffId:string;newHandoffId:string;reviewer:string;note:string;accepted:number;rejected:number;accept:string[];reject:string[];createdAt:string}
export type DispatchField='key'|'serviceRequestId'|'sourceKey'|'sourceId'|'sourceSha256'|'captureId'|'collectionId'|'sourceStatus'|'sourceStatusNotes'|'sourceClosedAt'|'serviceCode'|'serviceName'|'description'|'address'|'agency'|'requestedAt'|'updatedAt'|'observedAt'|'longitude'|'latitude'|keyof OperatorFields;
export interface DispatchColumn {name:string;field:DispatchField}
export interface DispatchDefinitionInput {name:string;handoffId:string;destination:string;note?:string;keys?:string[];columns?:DispatchColumn[]}
export interface DispatchDefinition {name:string;handoffId:string;destination:string;note:string;keys:string[];columns:DispatchColumn[]}
export interface DispatchSummary {id:string;name:string;handoffId:string;destination:string;sha256:string;createdAt:string;counts:{rows:number;located:number;unlocated:number}}
export interface Dispatch extends DispatchSummary {schema:typeof DISPATCH_SCHEMA;handoffSha256:string;definition:DispatchDefinition;rows:HandoffRow[];coverage:JsonObject[];decisionIds:string[]}
export interface Control {requestId:string;expectedRevision:number}
export type MutationResult<T>={workspaceId:string;revision:number;requestId:string}&T;
export interface ReceiveDescriptor extends Control {originalFile:{sha256:string;bytes:number};incomingPackageSha256:string;hostInput?:JsonObject}
export interface WorkspaceOperation {requestId:string;kind:string;state:'SUCCEEDED';inputSha256:string;input:Control&{[key:string]:JSONValue};result:JsonObject;createdAt:string}
export interface WorkspaceState {
  schema:typeof WORKSPACE_SCHEMA;directory:string;workspaceId:string;revision:number;createdAt:string;updatedAt:string;receivedFrom:JsonObject[];
  sources:SourceSummary[];handoffs:HandoffSummary[];returns:ReturnSummary[];decisions:DecisionSummary[];dispatches:DispatchSummary[];
  dispatchFields:DispatchField[];defaultDispatchColumns:DispatchColumn[];operations:Pick<WorkspaceOperation,'requestId'|'kind'|'state'|'createdAt'>[];
}
export interface PageInput {q?:string;offset?:number;limit?:number}
export interface Page<T> {items:T[];total:number;offset:number;limit:number}
export type AssetSelection={handoffId:string;dispatchId?:never}|{dispatchId:string;handoffId?:never};
export type ExportSelection=({kind:'workspace'}|({kind:'json'|'geojson'|'csv'|'gpkg'|'html'}&AssetSelection)|{kind:'source';sourceId:string}|{kind:'returned';returnId:string})&{expectedRevision?:number};
export interface ExportedFile {filename:string;contentType:string;body:string|Buffer;bytes:number;sha256:string}
export type SavedRecord={kind:'source';id:string;value:ImportedSource}|{kind:'handoff';id:string;value:Handoff}|{kind:'return';id:string;value:AnalystReturn}|{kind:'decision';id:string;value:Decision}|{kind:'dispatch';id:string;value:Dispatch};
export interface WorkspacePackage {schema:typeof WORKSPACE_SCHEMA;workspaceId:string;revision:number;createdAt:string;updatedAt:string;exportedAt:string;sha256:string;records:SavedRecord[];operations:WorkspaceOperation[];receivedFrom:JsonObject[]}
export type ReturnInput=Control&{handoffId:string;analyst:string;name?:string}&({format:'gpkg';contentBase64:string;originalText?:never}|{format:'geojson'|'csv'|'json';originalText:string;contentBase64?:never});
export interface Workspace {
  readonly directory:string;
  state():WorkspaceState;
  operation(requestId:string):WorkspaceOperation|null;
  inspectSource(originalText:string,options?:{reportId?:string}):SourceInspection;
  importSource(input:Control&{originalText:string;reportId?:string;name?:string}):MutationResult<{source:SourceSummary;reused:boolean}>;
  putHandoff(input:Control&{definition:HandoffDefinitionInput}):MutationResult<{handoff:HandoffSummary}>;
  importReturn(input:ReturnInput):MutationResult<{returned:ReturnSummary}>;
  putDecision(input:Control&{selection:DecisionSelection}):MutationResult<{decision:DecisionSummary;handoff:HandoffSummary}>;
  putDispatch(input:Control&{definition:DispatchDefinitionInput}):MutationResult<{dispatch:DispatchSummary}>;
  source(id:string):{summary:SourceSummary;originalText:string;rows:SourceRow[]};
  sourceRows(input:{id:string}&PageInput):Page<SourceRow>;
  handoff(input:{id:string}&PageInput):Page<HandoffRow>&{handoff:HandoffSummary;definition:HandoffDefinition;coverage:JsonObject[]};
  row(input:{handoffId:string;key:string}):{handoff:HandoffSummary;row:HandoffRow;versions:JsonObject[]};
  returned(id:string):{summary:ReturnSummary;changes:AnalystChange[];conflicts:AnalystConflict[];missingKeys:string[];decisions:DecisionSummary[]};
  dispatch(id:string):{summary:DispatchSummary;definition:DispatchDefinition;rows:HandoffRow[];coverage:JsonObject[];decisionIds:string[]};
  workspaceExport(options?:{expectedRevision?:number}):WorkspacePackage;
  exportFile(selection:ExportSelection):ExportedFile;
  receive(input:Control&{originalText:string}):MutationResult<{originalWorkspaceId:string;originalRevision:number;packageSha256:string;records:number}>;
  close():void;
}
export function openWorkspace(directory:string,options?:{create?:boolean}):Workspace;
export function receiveWorkspace(directory:string,originalText:string,control?:Partial<Control>):ReturnType<Workspace['receive']>;
export function validateWorkspacePackage(originalText:string,options?:{directory?:string}):WorkspacePackage;
export function inspectSource(originalText:string,options?:{reportId?:string}):SourceInspection;
export function importSource(originalText:string,options:{reportId?:string|null;name?:string;importedAt:string}):ImportedSource;
export function sourceSummary(source:ImportedSource):SourceSummary;
export function sourceVersions(source:ImportedSource,key:string):JsonObject[];
export function normalizeDefinition(input:HandoffDefinitionInput):HandoffDefinition;
export function createHandoff(input:HandoffDefinitionInput,sources:ImportedSource[],identity:{id:string;createdAt:string},options?:{predecessor?:Handoff|null}):Handoff;
export function handoffSummary(handoff:Handoff,head?:boolean):HandoffSummary;
export interface DecodedFile {metadata?:{handoffId?:string|null;handoffSha256?:string|null}|null;problems?:{rowNumber?:number|null;key?:string|null;code:string;message:string;fields?:string[]}[];rows:{rowNumber:number;properties:JsonObject;geometry:Geometry;problem?:{code:string;message:string}}[]}
export function analystReturn(handoff:Handoff,decoded:DecodedFile,input:{analyst:string;name?:string;format:AnalystFormat;original:OriginalFile},identity:{id:string;createdAt:string}):AnalystReturn;
export function returnSummary(returned:AnalystReturn):ReturnSummary;
export function applyDecision(base:Handoff,current:Handoff,returned:AnalystReturn,selection:DecisionSelection,identity:{id:string;createdAt:string},options?:{previousDecisions?:Decision[]}):{decision:Decision;handoff:Handoff};
export function decisionSummary(decision:Decision):DecisionSummary;
export function createDispatch(handoff:Handoff,input:DispatchDefinitionInput,identity:{id:string;createdAt:string}):Dispatch;
export function dispatchSummary(dispatch:Dispatch):DispatchSummary;
export function normalizeGeometry(value:JSONValue):Geometry;
export function sourceGeometry(source:JsonObject):{geometry:Geometry;geometryStatus:GeometryStatus};
export function normalizeOperator(value?:Partial<OperatorFields>):OperatorFields;
export function encodePoint(value:Geometry):Buffer|null;
export function decodePoint(value:Uint8Array|null):Geometry;
export function writeGeoPackage(asset:Handoff|Dispatch,sources:ImportedSource[],options?:{directory?:string}):Buffer;
export function readGeoPackage(bytes:Uint8Array,options?:{directory?:string}):DecodedFile;
export function decodeAnalystFile(bytes:Uint8Array,format:AnalystFormat,options?:{directory?:string}):DecodedFile;
export function exportAsset(asset:Handoff|Dispatch,sources:ImportedSource[],kind:'json'|'geojson'|'csv'|'gpkg'|'html',options?:{directory?:string}):Pick<ExportedFile,'filename'|'contentType'|'body'>;
export function geoJson(asset:Handoff|Dispatch,sources:ImportedSource[]):JsonObject;
export function analystJson(asset:Handoff|Dispatch,sources:ImportedSource[]):JsonObject;
export function assetCsv(asset:Handoff|Dispatch):string;
export function assetHtml(asset:Handoff|Dispatch,sources:ImportedSource[]):string;
export function csvEncode(columns:string[],rows:JsonObject[],options?:{protectCells?:boolean}):string;
export function csvDecode(originalText:string):Record<string,string>[];
export interface Startup {schema:typeof STARTUP_SCHEMA;state:'LISTENING';directory:string;workspaceId:string;bindingSha256:string;binding:{schema:typeof BINDING_SCHEMA;directory:string;workspaceId:string;sha256:string};instanceId:string;startedAt:string;url:string}
export interface RunningDesk {server:Server;workspace:Workspace;url:string;startup:Startup;readonly launch:Startup;close():Promise<void>}
export interface ServerOptions {host?:'127.0.0.1'|'::1';port?:number;expectedWorkspaceId?:string;expectedBindingSha256?:string}
export function serveGIS(options:{directory:string}&ServerOptions):Promise<RunningDesk>;
export function startGISServer(options:{workspace:string}&ServerOptions):Promise<RunningDesk>;
export function workspaceBinding(directory:string,workspaceId:string):string;
export const WORKSPACE_SCHEMA:'commons.open311.gis-workspace.v1';
export const GIS_SOURCE_SCHEMA:'commons.open311.gis-source.v1';
export const HANDOFF_SCHEMA:'commons.open311.gis-handoff.v1';
export const RETURN_SCHEMA:'commons.open311.gis-return.v1';
export const DECISION_SCHEMA:'commons.open311.gis-decision.v1';
export const DISPATCH_SCHEMA:'commons.open311.gis-dispatch.v1';
export const ANALYST_SCHEMA:'commons.open311.gis-analyst.v1';
export const STARTUP_SCHEMA:'stellar-forge.open311-gis-startup.v1';
export const BINDING_SCHEMA:'stellar-forge.open311-gis-binding.v1';
export const FILE_COLUMNS:readonly string[];
export const SOURCE_COLUMNS:readonly string[];
export const OPERATOR_COLUMNS:Readonly<Record<string,keyof OperatorFields>>;
export const EMPTY_OPERATOR:Readonly<OperatorFields>;
export const DISPATCH_FIELDS:readonly DispatchField[];
export const DEFAULT_DISPATCH_COLUMNS:readonly DispatchColumn[];
