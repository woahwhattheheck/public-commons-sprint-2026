// MIT. Public inputs/results for the original Timescale merchant workflow.
export type UUID=string;
export type SHA256=string;
export type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export type JsonObject={ [key:string]:JsonValue };
export interface Scope { workspace:string; workspaceId:UUID }
export interface PageInput { offset?:number; limit?:number }
export interface Page<T> { offset:number; limit:number; total:number; rows:T[]; nextOffset:number|null }
export interface NativePage<T> { offset:number; limit:number; total:number; rows:T[]; next:number|null }
export interface CallOptions { requestSignal?:AbortSignal; timeoutMs?:number }
export interface MerchantClient { endpoint:string; call(name:string,args:unknown,options?:CallOptions):Promise<unknown> }
export interface ClientOptions extends Scope {
  url?:string; client?:MerchantClient; tokenEnv?:string;
  environment?:Record<string,string|undefined>; signal?:AbortSignal;
}
export interface OriginalRequest { requestId:UUID; expectedVersion:number }
export interface PlanPin { planId:UUID; planDigest:SHA256 }
export interface ItemPin { workItemId:UUID; itemRevision:number; itemDigest:SHA256 }
export type WorkState='OPEN'|'IN_PROGRESS'|'DEFERRED';
export type ItemState=WorkState|'RESOLVED';
export interface SourceReference { reviewId:UUID; comparisonDigest:SHA256; changeKey:SHA256; digest:SHA256 }
export interface WorkFields {
  title:string; owner:string; dueDate?:string; priority:'NORMAL'|'HIGH'|'URGENT';
  intent:string; acceptance:string; status:WorkState;
}
export interface WorkCommandBase extends OriginalRequest { actor:string; note:string }
export interface ExistingItem { workItemId:UUID; expectedRevision:number }
export interface Resolution {
  editionId:UUID; editionDigest:SHA256; comparisonDigest:SHA256;
  mode:'CURRENT_STATE_REVIEW'|'COMPLETE_AGGREGATE_VERIFICATION';
  verificationOperationId?:UUID; verificationOperationDigest?:SHA256;
  outcome:'REMEDIATED'|'ACCEPTED_CURRENT_STATE'|'SUPERSEDED'; statement:string;
}
export type RemediationCommand=
  | WorkCommandBase&{action:'create';source:SourceReference;fields:WorkFields}
  | WorkCommandBase&ExistingItem&{action:'edit';fields:WorkFields}
  | WorkCommandBase&ExistingItem&{action:'rebase';source:SourceReference}
  | WorkCommandBase&ExistingItem&PlanPin&{action:'bind-plan';relevance:string}
  | WorkCommandBase&ExistingItem&{action:'observe';operationId:UUID;operationDigest:SHA256;relevance:string}
  | WorkCommandBase&ExistingItem&{action:'resolve';resolution:Resolution}
  | WorkCommandBase&ExistingItem&{action:'reopen';status:WorkState};
export interface NativeOperation {
  id:UUID;kind:string;state:string;inputDigest:SHA256;created:string;updated:string;attempts:number;
  input:JsonObject;result:JsonObject|null;error:JsonObject|null;before:JsonObject|null;
  dispatch?:{statementDigest:SHA256;dispatchedAt:string};
}
export interface Started { id:UUID;reused:boolean;operation:NativeOperation }
export interface WorkspaceStatus extends Scope {
  state:'OPEN'|'CLOSED'|'CLOSING'|'OPENING';publisher:string;
  instanceId?:UUID;publisherInstanceId?:UUID;
  native?:{version:number;[key:string]:unknown};
  browser?:{open:boolean};fileReads?:unknown;
}
export interface FileDescription { name:string;bytes:number;sha256:SHA256;contentType?:string }
export interface FileChunk {
  readId:UUID;file:FileDescription;offset:number;bytesRead:number;nextOffset:number|null;
  encoding:'base64';data:string;exportId?:UUID;manifestSha256?:SHA256;
}
export interface ChunkInput { expectedSha256:SHA256;offset?:number;limit?:number;readId?:UUID }
export interface NativeFileInput extends ChunkInput {kind:'edition'|'result'|'before';id:UUID}
export interface FileProgress { exportId:UUID;file:string;bytes:number;total:number;state:string }
export interface ReceiveInput {
  exportId:UUID;directory:string;expectedManifestSha256?:SHA256;chunkSize?:number;signal?:AbortSignal;
  onProgress?:(value:FileProgress)=>void|Promise<void>;
}
export interface ReceiveResult {
  schema:string;exportId:UUID;manifestSha256:SHA256;directory:string;resumed:boolean;
  files:unknown;[key:string]:unknown;
}
export interface ManifestResult<T=JsonObject> { manifest:T;manifestSha256:SHA256 }
export interface ReportManifest {
  schema:'stellar-forge.timescale-remediation-download.v1';exportId:UUID;workspaceId:UUID;
  workItemId:UUID;itemRevision:number;itemDigest:SHA256;workspaceVersion:number;
  createdAt:string;complete:true;files:FileDescription[];
}
export interface WindowSelection {
  editionId:UUID;editionDigest:SHA256;aggregateKey:SHA256;timeColumn:string;
  timeType:'timestamptz'|'timestamp'|'date'|'smallint'|'integer'|'bigint'|'timestamp with time zone'|'timestamp without time zone';
  start:string;end:string;timezone?:string;title:string;owner:string;note:string;
}
export interface RefreshPlan extends WindowSelection {
  force?:boolean;bucketsPerBatch?:number;maxBatches?:number;newestFirst?:boolean;
}
export interface ItemSummary {
  id:UUID;revision:number;title:string;status:ItemState;owner:string;dueDate:string;
  priority:'NORMAL'|'HIGH'|'URGENT';source:Record<string,unknown>;plans:number;observations:number;
  [key:string]:unknown;
}
export interface ItemDetail {
  schema:string;workspaceId:UUID;version:number;item:ItemSummary;itemDigest:SHA256;
  historyCount:number;section:'summary'|'plans'|'observations'|'history';page?:Page<Record<string,unknown>>;
}
export interface RemediationClient {
  list(input?:PageInput&{status?:ItemState;owner?:string;q?:string},options?:CallOptions):Promise<{
    schema:string;workspaceId:UUID;version:number;counts:Record<ItemState,number>;items:NativePage<ItemSummary>
  }>;
  sources(input?:PageInput,options?:CallOptions):Promise<{
    schema:string;workspaceId:UUID;version:number;sources:NativePage<SourceReference&Record<string,unknown>>
  }>;
  item(input:{workItemId:UUID;section?:'summary';itemRevision?:number;itemDigest?:SHA256}|
    ItemPin&PageInput&{section:'plans'|'observations'|'history'},options?:CallOptions):Promise<ItemDetail>;
  context(input:ItemPin&PageInput&{editionId?:UUID;changeOffset?:number;changeLimit?:number},options?:CallOptions):Promise<Record<string,unknown>>;
  command(input:RemediationCommand,options?:CallOptions):Promise<Started>;
  report(input:OriginalRequest&ItemPin,options?:CallOptions):Promise<Started>;
  inspectReport(input:{exportId:UUID;signal?:AbortSignal}):Promise<ManifestResult<ReportManifest>>;
  downloadReport(input:ReceiveInput):Promise<ReceiveResult>;
}
export interface TimescaleClient extends Scope {
  readonly endpoint:string;
  call(method:keyof typeof TIMESCALE_CLIENT_METHODS,input?:Record<string,unknown>,options?:CallOptions):Promise<unknown>;
  status(input?:PageInput,options?:CallOptions):Promise<WorkspaceStatus>;
  open(input?:Record<string,never>,options?:CallOptions):Promise<WorkspaceStatus>;
  close(input:{instanceId:UUID;publisherInstanceId:UUID},options?:CallOptions):Promise<{workspace:string;instanceId:UUID;state:'CLOSED';publisherState:string}>;
  capture(input:OriginalRequest&{title:string;note:string;timeoutMs?:number},options?:CallOptions):Promise<Started>;
  edition(input:PageInput&{editionId:UUID;table?:string},options?:CallOptions):Promise<Record<string,unknown>>;
  compare(input:PageInput&{beforeId:UUID;afterId:UUID},options?:CallOptions):Promise<Record<string,unknown>>;
  review(input:OriginalRequest&{beforeId:UUID;afterId:UUID;comparisonDigest:SHA256;reviewer:string;note:string;
    decisions:{changeKey:SHA256;decision:'ACCEPT'|'REMEDIATE'|'DEFER';owner:string;note:string}[]},options?:CallOptions):Promise<Started>;
  refresh(input:OriginalRequest&({action:'prepare';plan:RefreshPlan}|PlanPin&{action:'run';timeoutMs?:number}),options?:CallOptions):Promise<Started>;
  verify(input:OriginalRequest&PlanPin&{timeoutMs?:number},options?:CallOptions):Promise<Started>;
  job(input:OriginalRequest&({action:'prepare';editionId:UUID;editionDigest:SHA256;jobId:string;changes:JsonObject;title:string;owner:string;note:string}|
    PlanPin&{action:'apply'}),options?:CallOptions):Promise<Started>;
  publication(input:OriginalRequest&({action:'select';selection:WindowSelection&{columns:string[]};
    extraction?:{maxRows?:number;maxBytes?:number;maxRowBytes?:number;timeoutMs?:number}}|PlanPin&{action:'extract'}),options?:CallOptions):Promise<Started>;
  operation(input:{action:'inspect'|'cancel';requestId:UUID},options?:CallOptions):Promise<NativeOperation|{id:UUID;cancelling:boolean}>;
  plan(input:{planId:UUID},options?:CallOptions):Promise<Record<string,unknown>>;
  record(input:PageInput&{requestId:UUID;record:'result'|'before';table?:string},options?:CallOptions):Promise<Record<string,unknown>>;
  file(input:NativeFileInput,options?:CallOptions):Promise<FileChunk>;
  releaseFile(input:{readId:UUID},options?:CallOptions):Promise<{released:boolean;readId:UUID}>;
  browser(input:{action:'open'|'close';port?:number},options?:CallOptions):Promise<{state:string;url?:string;reused?:boolean}>;
  export(input:OriginalRequest,options?:CallOptions):Promise<Started>;
  wait(requestId:UUID,options?:{intervalMs?:number;timeoutMs?:number;signal?:AbortSignal}):Promise<NativeOperation>;
  readonly remediation:RemediationClient;
  readonly exports:{
    inspect(input:{exportId:UUID;signal?:AbortSignal}):Promise<ManifestResult>;
    download(input:ReceiveInput):Promise<ReceiveResult>;
  };
}
export const TIMESCALE_CLIENT_METHODS:Readonly<{
  status:string;open:string;close:string;capture:string;edition:string;compare:string;review:string;
  refresh:string;verify:string;job:string;publication:string;operation:string;plan:string;record:string;
  file:string;'file-release':string;browser:string;export:string;'export-manifest':string;'export-file':string;
  'export-file-release':string;'remediation-list':string;'remediation-sources':string;'remediation-item':string;
  'remediation-context':string;'remediation-command':string;'remediation-report':string;'report-manifest':string;
  'report-file':string;'report-file-release':string;
}>;
export function openTimescaleClient(options:ClientOptions):Promise<TimescaleClient>;
