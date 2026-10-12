export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
/** Original reported decimal. The client performs no monetary Number conversion. */
export type DecimalString = string;
export type ReportedValue = string | null;
export interface Operator { id: string; label: string; }
export interface FileDescriptor { name: string; mime: string; size: number; sha256: string; }
export interface Page<T> { items: T[]; offset: number; limit: number; total: number; nextOffset: number | null; }
export interface RowPage { fields: Array<string | FieldReview>; rows: Array<{ordinal:number;page?:number;index?:number;values:Record<string,ReportedValue>}>; offset:number; total:number; nextOffset:number|null; }
export interface FieldReview {
  source:string; name:string; label:string; role:'identifier'|'dimension'|'date'|'measure';
  unit:string; scale:DecimalString; notes:string; nullToken:string|null;
}
export interface SourceRecord {
  id:string; revision:number; sha256:string; name:string; endpoint:string; filter:string;
  sort:string; pageSize:number; notes:string; createdAt:string; updatedAt:string; lastProbe:JsonObject|null;
}
export interface CaptureRecord {
  id:string; revision:number; sourceId:string; sourceRevision:number; sourceSha256:string;
  name:string; status:'QUEUED'|'RUNNING'|'PAUSED'|'FAILED'|'CANCELLED'|'COMPLETE';
  desiredState:'RUNNING'|'PAUSED'|'CANCELLED'; createdAt:string; updatedAt:string;
  pages:number; rows:number; totalRows:number|null; totalPages:number|null; bytes:number;
  nextPage:number|null; sha256:string|null; error:{code:string;message:string;at:string}|null;
  completedAt:string|null; files?:FileDescriptor[];
  pageRecords?:Page<JsonObject>; attempts?:Page<JsonObject>; metadata?:JsonObject;
}
export interface EditionRecord {
  id:string; revision:number; captureId:string; captureSha256:string; name:string;
  status:'DRAFT'|'READY'; createdAt:string; updatedAt:string; fields:FieldReview[];
  keyFields:string[]; notes:string; rowCount:number; sha256:string|null; files:FileDescriptor[];
  dataset:JsonObject|null; merchant:JsonObject|null;
}
export interface DatedObservation { date:string; value:DecimalString; ordinal:number; }
export interface MeasureContext {unit:string;scale:DecimalString;notes:string;source:string;label:string;nullToken:string|null;}
export interface DateObservations {
  dateField:string|null;groupFields?:string[];incompatibleDates:number;
  groups:Array<{key:Record<string,ReportedValue>;rows:number;first:DatedObservation;last:DatedObservation;change:DecimalString}>;
}
export interface MeasureTotal {
  field:string;compatible:boolean;unit:string|null;scale:DecimalString|null;left:MeasureContext;right:MeasureContext; leftSum:DecimalString|null;
  rightSum:DecimalString|null; delta:DecimalString|null; leftNumericRows:number; rightNumericRows:number;
  leftNonNumericRows:number; rightNonNumericRows:number; leftMissingRows?:number; rightMissingRows?:number;
  comparedRows?:number; participatingRows?:number; incompatibleRows?:number;
  unitIncompatibleRows:number;missingPairRows:number;nonNumericPairRows:number;
  aggregation:string;contextNotes:string[];leftObservations:DateObservations;rightObservations:DateObservations;
}
export interface ComparisonRecord {
  id:string; name:string; leftEditionId:string; rightEditionId:string; createdAt:string;
  keyFields:string[]; measureFields:string[];sha256:string|null;status:'BUILDING'|'FAILED'|'READY';
  summary:{leftRows:number;rightRows:number;added:number;removed:number;changed:number;unchanged:number;fieldChanges:Json;measureTotals:Record<string,MeasureTotal>}|null;
  files:FileDescriptor[]; rows?:JsonObject[]; offset?:number; total?:number; nextOffset?:number|null;
  creation?:{action:string;payload:JsonObject}; error?:JsonObject|null;
}
export interface ExportRecord {
  id:string; kind:'capture'|'edition'|'comparison'|'briefing'|'merchant'|'acquisition'|'refresh';
  status:'BUILDING'|'FAILED'|'READY'; sourceId:string; sourceSha256:string; revision:number;
  createdAt:string;sha256:string|null;files:FileDescriptor[];
  briefing?:{title:string;audience:string;notes:string;rowsPerPage:number;sourceExportId:string;sourceExportSha256:string;producer:JsonObject;operationId?:string;manifestSha256?:string;archiveSha256?:string;files?:number;bytes?:number};
  creation?:{action:string;payload:JsonObject}; error?:JsonObject|null;
}
export interface PackageRecord {
  packageId:string; operationId:string; workspace:{id:string;revision:number};
  createdAt:string; files:FileDescriptor[];
}
export interface FiscalSnapshot {
  schema:'stellar-forge.fiscaldata-workspace.v1'; revision:number; createdAt:string; observedAt:string;
  sources:Page<SourceRecord>; captures:Page<CaptureRecord>; editions:Page<EditionRecord>;
  comparisons:Page<ComparisonRecord>; exports:Page<ExportRecord>; catalog:JsonObject;
  refreshPlans?:Page<RefreshPlanSummary>;refreshRuns?:Page<RefreshRunSummary>; publisher:JsonObject|null;
  worker:{running:boolean;captureId:string|null;refreshRunId?:string|null}; [key:string]:unknown;
}
export interface NativeResult<T = Json> {
  result:T; state:FiscalSnapshot;
  operatorAction?:{id:string;operator:Operator;state?:'COMPLETED';recordingWarning?:string};
}
export interface WorkspaceStatus {
  workspace:string; workspaceId?:string; instanceId?:string;
  state?:'OPEN'|'CLOSED'|'CLOSING'|'RECEIVING'|'CHECKPOINTING'|'BROWSER_CLOSING';
  operator?:Operator; native?:FiscalSnapshot | Page<unknown> | JsonObject | null;
  packages?:Page<PackageRecord>; browser?:{open:boolean}; fileReads?:JsonObject; lifecycle?:JsonObject|null;
}
export interface CallOptions { signal?:AbortSignal; requestSignal?:AbortSignal|null; timeoutMs?:number; offset?:number; limit?:number; }
export interface MerchantTransport { endpoint:string; call(name:string,args:JsonObject,options?:{requestSignal?:AbortSignal|null;timeoutMs?:number}):Promise<JsonObject>; }
export interface ConnectOptions {
  url?:string; transport?:MerchantTransport; workspace:string; expectedWorkspaceId?:string;
  tokenEnv?:string; environment?:Record<string,string|undefined>; signal?:AbortSignal; timeoutMs?:number;
}
export interface SourceFields {name:string;endpoint:string;filter?:string;sort?:string;pageSize?:number;notes?:string;}
/** requestId on creation is provided by the original refresh source successor; edits remain revision-bound. */
export type SourceSave = SourceFields & ({id?:never;expectedRevision?:never;requestId?:string}|{id:string;expectedRevision:number;requestId?:never});
export interface EditionReview {id:string;expectedRevision:number;fields:FieldReview[];keyFields:string[];notes:string;filters?:string[];ranges?:string[];sorts?:string[];defaultLimit?:number;maxLimit?:number;}
export interface BriefingInput {comparisonId:string;expectedComparisonSha256:string;exportId:string;title:string;audience?:string;notes?:string;rowsPerPage?:number;requestId:string;}

export interface RecordBinding {id:string;revision:number;sha256:string|null;}
export type RefreshCapturePolicy = {mode:'source'}|{mode:'window';dateField:string;days:number;lagDays?:number;baseFilter:string};
export interface RefreshComparisonPolicy {keyFields:string[];measureFields:string[];}
export interface RefreshBriefingPolicy {title:string;audience?:string;notes?:string;rowsPerPage?:number;}
export interface RefreshPlanSave {
  id?:string;expectedRevision?:number;requestId:string;name:string;
  baselineEditionId:string;expectedBaselineSha256:string;capture?:RefreshCapturePolicy;
  comparison?:RefreshComparisonPolicy;briefing?:RefreshBriefingPolicy;notes?:string;
}
export interface RefreshPlanDefinition {
  name:string;baseline:RecordBinding;source:SourceRecord;review:Omit<EditionReview,'id'|'expectedRevision'>;
  schema:Array<{source:string;type:string|null;label:string|null;format:string|null}>;
  capture:RefreshCapturePolicy;comparison:RefreshComparisonPolicy;briefing:RefreshBriefingPolicy;notes:string;
}
export interface RefreshPlanRecord {
  id:string;schema:'stellar-forge.fiscaldata-refresh-plan.v1';kind:'refresh-plans';revision:number;
  createdAt:string;updatedAt:string;sha256:string;definition:RefreshPlanDefinition;
  versions:Array<{revision:number;sha256:string;definition:RefreshPlanDefinition;at:string;action:'SAVED'|'BASELINE_PROMOTED';
    requestKey:string;inputSha256:string;runId?:string;runSha256?:string}>;
}
export interface RefreshPlanSummary {
  id:string;revision:number;sha256:string;name:string;createdAt:string;updatedAt:string;
  baseline:RecordBinding;source:{id:string;revision:number;sha256:string;endpoint:string};
  capture:RefreshCapturePolicy;comparison:RefreshComparisonPolicy;versions:number;
}
export interface RefreshSelection {planId:string;expectedRevision:number;expectedPlanSha256:string;asOf?:string;}
export interface RefreshPeriod {asOf:string;from:string|null;through:string|null;filter:string;sort:string;}
export interface RefreshPreview {
  planId:string;planRevision:number;planSha256:string;asOf:string;period:RefreshPeriod;sourceUrl:string;
  baseline:RecordBinding;review:RefreshPlanDefinition['review'];comparison:RefreshComparisonPolicy;
}
export interface RefreshControl {id:string;expectedRevision:number;}
export interface RefreshReview extends RefreshControl {editionId:string;expectedEditionSha256:string;requestId:string;}
export interface RefreshPromotion {planId:string;expectedRevision:number;runId:string;expectedRunRevision:number;requestId:string;}
export interface RefreshRunSummary {
  id:string;revision:number;name:string;planId:string;planRevision:number;planSha256:string;
  status:'QUEUED'|'RUNNING'|'WAITING_CAPTURE'|'PAUSED'|'FAILED'|'REVIEW_REQUIRED'|'CANCELLED'|'COMPLETE';
  desiredState:'RUNNING'|'PAUSED'|'CANCELLED';phase:'SOURCE'|'CAPTURE'|'EDITION'|'REVIEW'|'COMPARE'|'EXPORT'|'BRIEFING'|'DELIVERY';
  createdAt:string;updatedAt:string;completedAt:string|null;asOf:string;period:RefreshPeriod;
  source:RecordBinding|null;capture:RecordBinding|null;edition:RecordBinding|null;comparison:RecordBinding|null;
  sourceExport:RecordBinding|null;briefing:RecordBinding|null;delivery:RecordBinding|null;sha256:string|null;
  reviewRequired:boolean;schemaChanges:number;error:{code:string;message:string}|null;
}
export interface RefreshRunRecord extends Omit<RefreshRunSummary,'reviewRequired'|'schemaChanges'> {
  schema:'stellar-forge.fiscaldata-refresh-run.v1';kind:'refresh-runs';definition:RefreshPlanDefinition;
  requestKey:string;inputSha256:string;steps:Record<string,{action:string;input:JsonObject;startedAt:string;completed:boolean;completedAt?:string;result:Json}>;
  events:JsonObject[];schemaChanges:Array<{source:string;change:'ADDED'|'REMOVED'|'CHANGED';before:Json;after:Json}>;
  review:JsonObject|null;completion:JsonObject|null;control?:JsonObject|null;
}
export interface QueryResult {rows:Array<Record<string,ReportedValue>>;[key:string]:unknown;}

export interface FiscalActionInputs {
  'catalog.refresh':{};
  'sources.save':SourceSave; 'sources.probe':{id:string;revision?:number};
  'captures.start':{sourceId:string;sourceRevision:number;sourceSha256:string;requestId:string;name?:string};
  'captures.get':{id:string}; 'captures.rows':{id:string;offset?:number;limit?:number};
  'captures.pause':{id:string}; 'captures.resume':{id:string}; 'captures.cancel':{id:string};
  'editions.create':{captureId:string;captureSha256:string;name:string;requestId:string};
  'editions.get':{id:string}; 'editions.rows':{id:string;offset?:number;limit?:number};
  'editions.review':EditionReview; 'editions.build':{id:string;expectedRevision:number;requestId:string};
  'editions.query':{id:string;query:string};
  'comparisons.create':{leftEditionId:string;rightEditionId:string;keyFields:string[];measureFields:string[];name:string;requestId:string};
  'comparisons.get':{id:string;offset?:number;limit?:number;changesOnly?:boolean};
  'exports.create':{kind:'capture'|'edition'|'comparison';id:string;requestId:string};
  'briefings.create':BriefingInput;
  /** Uses a host-declared profile; raw merchant terms are not accepted by the MCP boundary. */
  'merchant.configure':{editionId:string;profile:string;requestId:string};
  'refresh.plans.list':{offset?:number;limit?:number};
  'refresh.plans.get':{id:string};
  'refresh.plans.save':RefreshPlanSave;
  'refresh.runs.list':{planId?:string;offset?:number;limit?:number};
  'refresh.runs.get':{id:string};
  'refresh.runs.preview':RefreshSelection;'refresh.runs.start':RefreshSelection & {requestId:string};
  'refresh.runs.pause':RefreshControl;'refresh.runs.resume':RefreshControl;'refresh.runs.cancel':RefreshControl;
  'refresh.runs.review':RefreshReview;'refresh.baseline.promote':RefreshPromotion;
}
export interface FiscalActionResults {
  'sources.save':SourceRecord; 'captures.start':CaptureRecord; 'captures.get':CaptureRecord;
  'captures.pause':CaptureRecord; 'captures.resume':CaptureRecord; 'captures.cancel':CaptureRecord;
  'captures.rows':RowPage; 'editions.create':EditionRecord; 'editions.get':EditionRecord;
  'editions.review':EditionRecord; 'editions.build':EditionRecord; 'editions.rows':RowPage;
  'comparisons.create':ComparisonRecord; 'comparisons.get':ComparisonRecord;
  'exports.create':ExportRecord; 'briefings.create':ExportRecord; 'merchant.configure':ExportRecord;
  'editions.query':QueryResult;
  'refresh.plans.list':Page<RefreshPlanSummary>;'refresh.plans.get':RefreshPlanRecord;'refresh.plans.save':RefreshPlanRecord;
  'refresh.runs.list':Page<RefreshRunSummary>;'refresh.runs.get':RefreshRunRecord;'refresh.runs.preview':RefreshPreview;
  'refresh.runs.start':RefreshRunRecord;'refresh.runs.pause':RefreshRunRecord;'refresh.runs.resume':RefreshRunRecord;
  'refresh.runs.cancel':RefreshRunRecord;'refresh.runs.review':RefreshRunRecord;'refresh.baseline.promote':RefreshPlanRecord;
}
export type ActionResult<K> = K extends keyof FiscalActionResults ? FiscalActionResults[K] : Json;
export type PublisherAction =
  'publisher.prepare'|'publisher.status'|'publisher.preview'|'publisher.reviewDraft'|'publisher.publish'|
  'publisher.activateSnapshot'|'publisher.collect'|'publisher.release.stage'|'publisher.release.inspect'|
  'publisher.release.activate'|'publisher.release.rollback'|'publisher.release.start'|'publisher.release.stop'|
  'publisher.buyer.review'|'publisher.buyer.prepare'|'publisher.buyer.session'|'publisher.buyer.run'|
  'publisher.buyer.recover'|'publisher.buyer.account'|'publisher.buyer.export';
export interface FileReadInput {
  kind:'capture'|'edition'|'comparison'|'export'|'publisher'|'package'; id:string; filename:string;
  expectedSha256?:string; readId?:string; offset?:number; limit?:number;
}
export interface FileChunk {
  readId:string; file:{name:string;contentType:string;bytes:number;sha256:string};
  offset:number; bytesRead:number; nextOffset:number|null; encoding:'base64'; data:string;
}
export interface Collection<T> {workspace:string;workspaceId:string;revision:number;operator:Operator;items:T[];total:number;}
export type RecordSection = 'sources'|'captures'|'editions'|'comparisons'|'exports'|'refreshPlans'|'refreshRuns';
export const FISCALDATA_CLIENT_SCHEMA:'stellar-forge.fiscaldata-client.v1';
export const FISCALDATA_MODEL_SCHEMA:'stellar-forge.fiscaldata-workspace.v1';
export class FiscalWorkspaceClient {
  constructor(transport:MerchantTransport,options:Omit<ConnectOptions,'transport'|'url'|'tokenEnv'|'environment'>);
  readonly endpoint:string; readonly workspace:string; readonly expectedWorkspaceId:string|null;
  readonly identity:{workspace:string;workspaceId:string;instanceId:string|null;operator:Operator|null}|null;
  status(page?:{section?:string;offset?:number;limit?:number},options?:CallOptions):Promise<WorkspaceStatus>;
  hostStatus(options?:CallOptions):Promise<JsonObject>;
  open(options?:CallOptions):Promise<WorkspaceStatus>;
  assertOpen(options?:CallOptions):Promise<WorkspaceStatus & {workspaceId:string;operator:Operator;native:FiscalSnapshot}>;
  closeWorkspace(instanceId:string,options?:CallOptions):Promise<WorkspaceStatus>;
  catalog(action?:'get'|'refresh',page?:{offset?:number;limit?:number},options?:CallOptions):Promise<JsonObject | NativeResult>;
  action<K extends keyof FiscalActionInputs>(action:K,payload:FiscalActionInputs[K],options?:CallOptions):Promise<NativeResult<ActionResult<K>>>;
  action(action:PublisherAction,payload:JsonObject,options?:CallOptions):Promise<NativeResult>;
  value<K extends keyof FiscalActionInputs>(action:K,payload:FiscalActionInputs[K],options?:CallOptions):Promise<ActionResult<K>>;
  value(action:PublisherAction,payload:JsonObject,options?:CallOptions):Promise<Json>;
  query(id:string,query?:string,options?:CallOptions):Promise<NativeResult<QueryResult>>;
  checkpoint(operationId:string,options?:CallOptions):Promise<PackageRecord & {instanceId:string;state:FiscalSnapshot}>;
  restore(input:({sourceImport:string}|{sourceWorkspace:string;packageId:string}) & {expectedSha256:string;operationId:string},options?:CallOptions):Promise<JsonObject>;
  browser(action:'open'|'close',input?:{port?:number},options?:CallOptions):Promise<JsonObject>;
  history(page?:{offset?:number;limit?:number},options?:CallOptions):Promise<Page<JsonObject>>;
  file(input:FileReadInput,options?:CallOptions):Promise<FileChunk>;
  releaseFile(readId:string,options?:CallOptions):Promise<{released:true;readId:string}>;
  list<T = JsonObject>(section:RecordSection,page?:{limit?:number;maximumItems?:number},options?:CallOptions):Promise<Collection<T>>;
  find<T = JsonObject>(section:RecordSection,id:string,options?:CallOptions):Promise<{item:T;workspaceId:string;operator:Operator;revision:number}>;
  package(packageId:string,options?:CallOptions):Promise<{item:PackageRecord;workspaceId:string;operator:Operator}>;
  /** Drains this client's requests/file reads. Does not close the original remote workspace. */
  dispose():Promise<void>;
}
export function connectFiscalWorkspace(options:ConnectOptions):Promise<FiscalWorkspaceClient>;
