/** MIT. Full Soroban event merchant client and original source-file contracts. */
export type UUID=string;
export type SHA256=string;
export type Alias=string;
export type StellarNetwork='stellar:testnet'|'stellar:pubnet';
export type JsonValue=null|boolean|number|string|JsonValue[]|JsonObject;
export interface JsonObject{[key:string]:JsonValue}
export interface RequestOptions{requestSignal?:AbortSignal|null;timeoutMs?:number}
export interface ConnectionOptions{
  url:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal;
}
export interface WorkspaceSelection{workspace:Alias}
export interface Mutation{requestId:string;expectedRevision:number}
export interface Revision{workspaceId:UUID;revision:number}
export interface RpcConnection{id:string;network:StellarNetwork;rpcOrigin:string}
export interface NamedRpcConnection extends RpcConnection{alias:Alias}
export interface EventFilter extends JsonObject{}
/** Complete original RPC event JSON, including provider extension fields and XDR strings. */
export type RpcEvent=JsonObject;
export interface PlanVersion{
  id:UUID;version:number;name:string;startLedger:number|null;endLedger:number|null;
  pageSize:number;filters:EventFilter[];createdAt:string;sha256:SHA256;
}
export interface Plan{id:UUID;name:string;currentVersion:number;versions:PlanVersion[]}
export type CaptureStatus='PENDING'|'CAPTURING'|'INTERRUPTED'|'WAITING_FOR_LEDGER'|'COMPLETE';
export interface Capture{
  id:UUID;planId:UUID;planVersion:number;plan:PlanVersion;connection:RpcConnection;
  connectionAlias?:Alias;selection?:{startLedger:number|null;endLedger:number|null;maxLedgers:number};
  sourceOriginWorkspaceId?:UUID;createdByRequestId?:string;
  status:CaptureStatus;createdAt:string;startLedger:number|null;endLedger:number|null;cursor:string|null;
  frontierLedger:number|null;latestLedger:number|null;eventCount:number;duplicateCount:number;
  pages:JsonValue;exchanges:JsonValue;attempts:JsonValue;lastError:JsonValue;
  completion?:JsonObject;
}
export interface SourceFileIdentity{path:string;bytes:number;sha256:SHA256;contentType:string}
export interface DownloadFileIdentity extends SourceFileIdentity{name:string}
export interface Edition{
  id:UUID;name:string;captureId:UUID;planId:UUID;planVersion:number;createdAt:string;
  network:StellarNetwork;startLedger:number;endLedger:number;eventCount:number;
  source:SourceFileIdentity;format:'json-array';completion:JsonObject;sha256:SHA256;
  sourceOriginWorkspaceId?:UUID;
  receivedFrom?:{workspaceId:UUID;fromWorkspaceId?:UUID;exportId:SHA256;manifestSha256:SHA256};
}
export interface NativeSourceManifest{
  schema:'stellar-forge.soroban-events.source-export.v1';exportId:SHA256;editionId:UUID;
  files:SourceFileIdentity[];fileCount:number;bytes:number;
}
export interface NativeWatchManifest{
  schema:'stellar-forge.soroban-events.watch-export.v1';exportId:SHA256;watchId:UUID;
  files:SourceFileIdentity[];fileCount:number;bytes:number;
}
export type NativeExportManifest=NativeSourceManifest|NativeWatchManifest;
export type DownloadManifest=(Omit<NativeSourceManifest,'files'>|Omit<NativeWatchManifest,'files'>)&{
  files:DownloadFileIdentity[];
};
export interface SourceExport{
  id:SHA256;directory:string;manifest:NativeSourceManifest;manifestSha256:SHA256;
}
export interface WorkspaceState extends Revision{
  connection:RpcConnection|null;connections:NamedRpcConnection[];plans:Plan[];captures:Capture[];editions:Edition[];exports:SourceExport[];
}
export interface WorkspaceDescription{
  workspace:Alias;label:string;ownership:'CLOSED'|'OPENING'|'OPEN'|'CLOSING';
  captureConfigured:boolean;network:StellarNetwork|null;receivers:Alias[];
  connections:Alias[];publications:Alias[];
}
/** Native publication paths are selected only by the host configuration. */
export interface NativeWatchPublication{directory:string;feedId?:string;sourceId?:string;label?:string;description?:string}
export type PortableWatchPublication=Omit<NativeWatchPublication,'directory'>&{directory?:string};
export interface WatchConfiguration{
  windowLedgers:number;pollIntervalMs:number;connectionAlias:Alias;
  recoveryConnectionAlias:Alias|null;publication:NativeWatchPublication|null;
}
export interface WatchConfigurationRecord{
  version:number;planVersion:number;
  config:Omit<WatchConfiguration,'publication'>&{publication:PortableWatchPublication|null};
  connection:NamedRpcConnection|{alias:Alias;network:StellarNetwork};
  recoveryConnection:NamedRpcConnection|null;publicationTargetId:UUID|null;changedAt:string;received?:boolean;
}
export interface WatchPublicationTarget{
  id:UUID;directory:string|null;config:PortableWatchPublication;createdAt:string;publication:JsonValue;
  recoveryDirectory?:string|null;lastEditionId?:UUID;lastWindowId?:UUID;updatedAt?:string;
}
export type WatchStatus='PAUSED'|'PAUSING'|'RUNNING'|'WAITING_FOR_LEDGER'|'RETENTION_GAP'|'INTERRUPTED'|'COMPLETE';
export interface WatchWindow{
  id:string;planVersion:number;startLedger:number;endLedger:number;captureId:UUID;editionId:UUID;
  editionSha256:SHA256;eventCount:number;publicationTargetId:string|null;
  publication:JsonValue;completedAt:string;
}
export interface EventWatch{
  id:UUID;name:string;planId:UUID;planVersion:number;sourceWorkspaceId:UUID;network:StellarNetwork;
  configVersion:number;config:WatchConfiguration;configurations:WatchConfigurationRecord[];desiredState:'RUNNING'|'PAUSED';status:WatchStatus;
  initialLedger:number|null;nextLedger:number|null;endLedger:number|null;active:JsonValue;windows:WatchWindow[];
  publication:JsonValue;publicationTargets:Record<UUID,WatchPublicationTarget>;
  recovery:{id:UUID;editionIds:UUID[];connectionAlias:Alias|null;requestedAt:string}|null;
  pauseVersion:number;lastStartedAt?:string;lastError:JsonValue;createdAt:string;updatedAt:string;
  receivedFrom?:{workspaceId:UUID;fromWorkspaceId:UUID;exportId:SHA256;manifestSha256:SHA256};
}
export interface WatchSourceExport{
  id:SHA256;directory:string;watchId:UUID;manifest:NativeWatchManifest;manifestSha256:SHA256;createdAt:string;
}
export interface WatchState extends Revision{
  watches:EventWatch[];exports:WatchSourceExport[];connections:NamedRpcConnection[];
  runner?:{state:'RUNNING'|'STOPPED';lastError:{code:string;message:string}|null};
}
export interface WatchResult extends Revision{watch:EventWatch}
export interface WatchRunResult extends WatchResult{completedWindows:WatchWindow[];busy:boolean}
export interface WatchSelection extends WorkspaceSelection{watchId:UUID}
/** All mutations here use the independent watch revision returned by watchState. */
export interface WatchSettings{
  name?:string;planVersion?:number;endLedger?:number|null;windowLedgers?:number;pollIntervalMs?:number;
  connectionAlias?:Alias;recoveryConnectionAlias?:Alias|null;
  /** Configured host publication alias; null disables future publication. */
  publication?:Alias|null;
}
export interface WatchSaveArguments extends WorkspaceSelection,Mutation,WatchSettings{
  name:string;planId:UUID;startLedger?:number|null;
}
export interface EventPage extends Revision{
  captureId:UUID;rows:RpcEvent[];nextCursor:string|null;total:number;complete:boolean;
}
export interface PublisherSource extends Revision{
  editionId:UUID;file:string;sha256:SHA256;bytes:number;format:string;
}
export interface ExportSelection extends WorkspaceSelection{
  exportId:SHA256;expectedManifestSha256?:SHA256;
}
export interface ManifestResult extends WorkspaceSelection{
  state:'MANIFEST_RETAINED';exportId:SHA256;manifest:NativeExportManifest;
  manifestFile:{name:'manifest.json';bytes:number;sha256:SHA256};
}
export interface FileRange extends WorkspaceSelection{
  exportId:SHA256;manifestSha256:SHA256;readId:UUID;
  file:{name:string;bytes:number;sha256:SHA256;contentType:string};
  offset:number;bytesRead:number;nextOffset:number|null;encoding:'base64';data:string;
}
export interface JsonPage extends WorkspaceSelection{
  exportId:SHA256;manifestSha256:SHA256;file:string;pointer:string;
  type:'array'|'object'|'null'|'string'|'number'|'boolean';offset:number;total:number;nextOffset:number|null;
  value?:JsonValue;valueAvailableInOriginalFile?:boolean;message?:string;
}
export interface SorobanEventsToolArguments{
  workspaces:Record<string,never>;
  open:WorkspaceSelection;
  close:WorkspaceSelection;
  state:WorkspaceSelection;
  plan_save:WorkspaceSelection&Mutation&{
    planId?:UUID;name:string;startLedger?:number|null;endLedger?:number|null;filters?:EventFilter[];pageSize?:number;
  };
  capture_start:WorkspaceSelection&Mutation&{planId:UUID};
  capture_resume:WorkspaceSelection&Mutation&{captureId:UUID;connectionAlias?:Alias};
  capture_status:WorkspaceSelection&{captureId:UUID};
  events:WorkspaceSelection&{captureId:UUID;after?:string;limit?:number;contractId?:string;type?:string};
  edition_create:WorkspaceSelection&Mutation&{captureId:UUID;name:string};
  edition:WorkspaceSelection&{editionId:UUID};
  source_export:WorkspaceSelection&Mutation&{editionId:UUID};
  publisher_source:WorkspaceSelection&{editionId:UUID};
  watch_state:WorkspaceSelection;
  watch_status:WatchSelection;
  watch_save:WatchSaveArguments;
  watch_configure:WatchSelection&Mutation&WatchSettings;
  watch_start:WatchSelection&Mutation;
  watch_pause:WatchSelection&Mutation;
  watch_run:WatchSelection&{maxWindows?:number};
  watch_repair:WatchSelection&Mutation&{editionIds?:UUID[];recoveryConnectionAlias?:Alias};
  watch_export:WatchSelection&Mutation;
  /** expectedRevision belongs to the destination watch state. Import restores PAUSED. */
  watch_receive:WorkspaceSelection&Mutation&{
    exportId:SHA256;receiver:Alias;expectedManifestSha256:SHA256;connectionAlias?:Alias;
    recoveryConnectionAlias?:Alias;publication?:Alias;
  };
  manifest:WorkspaceSelection&{exportId:SHA256};
  file:WorkspaceSelection&{
    exportId:SHA256;file:string;expectedManifestSha256:SHA256;expectedSha256:SHA256;
    offset?:number;limit?:number;readId?:UUID;
  };
  file_release:WorkspaceSelection&{exportId:SHA256;readId:UUID};
  json:WorkspaceSelection&{
    exportId:SHA256;file:string;expectedManifestSha256:SHA256;pointer?:string;offset?:number;limit?:number;
  };
  /** expectedRevision is the configured receiving workspace revision. */
  receive:WorkspaceSelection&Mutation&{exportId:SHA256;receiver:Alias;expectedManifestSha256:SHA256};
}
export interface SorobanEventsToolResults{
  workspaces:{workspaces:WorkspaceDescription[];receivers:Record<Alias,Alias>};
  open:WorkspaceSelection&WorkspaceState;
  close:WorkspaceSelection&{state:'CLOSED'};
  state:WorkspaceState;
  plan_save:Revision&{plan:Plan};
  capture_start:Revision&{capture:Capture};
  capture_resume:Revision&{capture:Capture};
  capture_status:Revision&{capture:Capture};
  events:EventPage;
  edition_create:Revision&{edition:Edition};
  edition:Revision&{edition:Edition};
  source_export:Revision&{export:SourceExport};
  publisher_source:PublisherSource;
  watch_state:WatchState;
  watch_status:WatchResult;
  watch_save:WatchResult;
  watch_configure:WatchResult;
  watch_start:WatchResult;
  watch_pause:WatchResult;
  watch_run:WatchRunResult;
  watch_repair:WatchResult;
  watch_export:Revision&{export:WatchSourceExport};
  watch_receive:WatchResult&WorkspaceSelection&{receiver:Alias;received:true;retainedNewer:boolean};
  manifest:ManifestResult;
  file:FileRange;
  file_release:WorkspaceSelection&{exportId:SHA256;readId:UUID;state:'RELEASED'};
  json:JsonPage;
  receive:Revision&WorkspaceSelection&{receiver:Alias;edition:Edition;capture:Capture;received:true};
}
export type SorobanEventsToolName=keyof SorobanEventsToolArguments;
export type SorobanEventsPrefixedToolName<K extends SorobanEventsToolName=SorobanEventsToolName>=`merchant_soroban_events_${K}`;
export interface MerchantCaller{
  endpoint:string;
  call<K extends SorobanEventsToolName>(name:K|SorobanEventsPrefixedToolName<K>,
    args:SorobanEventsToolArguments[K],options?:RequestOptions):Promise<SorobanEventsToolResults[K]>;
}
export type ConnectionSource=(ConnectionOptions&{client?:never})|{
  client:MerchantCaller;url?:never;signal?:AbortSignal;
};
export interface TransferSelection extends ExportSelection{
  result?:Revision&{export:SourceExport|WatchSourceExport};
}
export interface DownloadOptions extends TransferSelection{
  directory:string;chunkSize?:number;signal?:AbortSignal;
  onProgress?:(progress:{exportId:SHA256;file:string;bytes:number;total:number;state:string})=>unknown|Promise<unknown>;
}
export interface DownloadReceiptBase{
  schema:'stellar-forge.soroban-events.file-receipt.v1';state:string;exportId:SHA256;
  manifestSha256:SHA256;directory:string;files:number;bytes:number;workspace?:Alias;
  resumed?:boolean;resumedBytes?:number;
}
export type DownloadReceipt=DownloadReceiptBase&(
  {sourceSchema:'stellar-forge.soroban-events.source-export.v1';editionId:UUID;watchId?:never}|
  {sourceSchema:'stellar-forge.soroban-events.watch-export.v1';watchId:UUID;editionId?:never}
);
export interface ReopenOptions extends TransferSelection{directory:string;signal?:AbortSignal}
export interface ReadJsonOptions extends TransferSelection{file:string;signal?:AbortSignal}
/** A watch export uses the destination watch revision; an edition export uses its engine revision. */
export interface ReceiveOptions extends TransferSelection,Mutation{
  receiver:Alias;signal?:AbortSignal;connectionAlias?:Alias;recoveryConnectionAlias?:Alias;publication?:Alias;
}
export type ReceiveResult=SorobanEventsToolResults['receive']|SorobanEventsToolResults['watch_receive'];
export interface SorobanEventsMerchantClient extends MerchantCaller{
  workspaces(args?:SorobanEventsToolArguments['workspaces'],options?:RequestOptions):Promise<SorobanEventsToolResults['workspaces']>;
  open(args:SorobanEventsToolArguments['open'],options?:RequestOptions):Promise<SorobanEventsToolResults['open']>;
  close(args:SorobanEventsToolArguments['close'],options?:RequestOptions):Promise<SorobanEventsToolResults['close']>;
  state(args:SorobanEventsToolArguments['state'],options?:RequestOptions):Promise<SorobanEventsToolResults['state']>;
  planSave(args:SorobanEventsToolArguments['plan_save'],options?:RequestOptions):Promise<SorobanEventsToolResults['plan_save']>;
  captureStart(args:SorobanEventsToolArguments['capture_start'],options?:RequestOptions):Promise<SorobanEventsToolResults['capture_start']>;
  captureResume(args:SorobanEventsToolArguments['capture_resume'],options?:RequestOptions):Promise<SorobanEventsToolResults['capture_resume']>;
  captureStatus(args:SorobanEventsToolArguments['capture_status'],options?:RequestOptions):Promise<SorobanEventsToolResults['capture_status']>;
  events(args:SorobanEventsToolArguments['events'],options?:RequestOptions):Promise<SorobanEventsToolResults['events']>;
  editionCreate(args:SorobanEventsToolArguments['edition_create'],options?:RequestOptions):Promise<SorobanEventsToolResults['edition_create']>;
  edition(args:SorobanEventsToolArguments['edition'],options?:RequestOptions):Promise<SorobanEventsToolResults['edition']>;
  sourceExport(args:SorobanEventsToolArguments['source_export'],options?:RequestOptions):Promise<SorobanEventsToolResults['source_export']>;
  publisherSource(args:SorobanEventsToolArguments['publisher_source'],options?:RequestOptions):Promise<SorobanEventsToolResults['publisher_source']>;
  watchState(args:SorobanEventsToolArguments['watch_state'],options?:RequestOptions):Promise<SorobanEventsToolResults['watch_state']>;
  watchStatus(args:SorobanEventsToolArguments['watch_status'],options?:RequestOptions):Promise<SorobanEventsToolResults['watch_status']>;
  watchSave(args:SorobanEventsToolArguments['watch_save'],options?:RequestOptions):Promise<SorobanEventsToolResults['watch_save']>;
  watchConfigure(args:SorobanEventsToolArguments['watch_configure'],options?:RequestOptions):Promise<SorobanEventsToolResults['watch_configure']>;
  watchStart(args:SorobanEventsToolArguments['watch_start'],options?:RequestOptions):Promise<SorobanEventsToolResults['watch_start']>;
  watchPause(args:SorobanEventsToolArguments['watch_pause'],options?:RequestOptions):Promise<SorobanEventsToolResults['watch_pause']>;
  watchRun(args:SorobanEventsToolArguments['watch_run'],options?:RequestOptions):Promise<SorobanEventsToolResults['watch_run']>;
  watchRepair(args:SorobanEventsToolArguments['watch_repair'],options?:RequestOptions):Promise<SorobanEventsToolResults['watch_repair']>;
  watchExport(args:SorobanEventsToolArguments['watch_export'],options?:RequestOptions):Promise<SorobanEventsToolResults['watch_export']>;
  watchReceive(args:SorobanEventsToolArguments['watch_receive'],options?:RequestOptions):Promise<SorobanEventsToolResults['watch_receive']>;
  manifest(args:SorobanEventsToolArguments['manifest'],options?:RequestOptions):Promise<SorobanEventsToolResults['manifest']>;
  file(args:SorobanEventsToolArguments['file'],options?:RequestOptions):Promise<SorobanEventsToolResults['file']>;
  fileRelease(args:SorobanEventsToolArguments['file_release'],options?:RequestOptions):Promise<SorobanEventsToolResults['file_release']>;
  json(args:SorobanEventsToolArguments['json'],options?:RequestOptions):Promise<SorobanEventsToolResults['json']>;
  receive(args:SorobanEventsToolArguments['receive'],options?:RequestOptions):Promise<SorobanEventsToolResults['receive']>;
  downloadExport(options:DownloadOptions):Promise<DownloadReceipt>;
  inspectExport(options:TransferSelection&{signal?:AbortSignal}):Promise<{manifest:DownloadManifest;manifestSha256:SHA256}>;
  reopenExport(options:ReopenOptions):Promise<DownloadReceipt>;
  readJson<T extends JsonValue=JsonValue>(options:ReadJsonOptions):Promise<T>;
  receiveExport(options:ReceiveOptions):Promise<ReceiveResult>;
}
export function openSorobanEventsMerchantClient(options:ConnectionOptions):Promise<SorobanEventsMerchantClient>;
export function downloadSorobanEventsExport(options:ConnectionSource&DownloadOptions):Promise<DownloadReceipt>;
export function inspectSorobanEventsExport(options:ConnectionSource&TransferSelection):Promise<{manifest:DownloadManifest;manifestSha256:SHA256}>;
export function reopenSorobanEventsExport(options:ReopenOptions):Promise<DownloadReceipt>;
export function readSorobanEventsJson<T extends JsonValue=JsonValue>(options:ConnectionSource&ReadJsonOptions):Promise<T>;
export function receiveSorobanEventsExport(options:ConnectionSource&ReceiveOptions):Promise<ReceiveResult>;
export const sorobanEventsDefinitions:ReadonlyArray<{
  name:SorobanEventsPrefixedToolName;action:SorobanEventsToolName;description:string;
  properties:Record<string,JsonValue>;required:string[];readOnly:boolean;openWorld:boolean;
}>;

export interface SetupOptions{directory:string;connection:string;name?:string}
export interface SetupResult{
  schema:'stellar-forge.merchant-mcp.v1';state:'INITIALIZED';configuration:string;
  source:'original-soroban-events-workspace';
  workspaces:Array<Pick<WorkspaceDescription,'workspace'|'label'|'captureConfigured'|'network'|'connections'|'publications'>>;
  receivers:Record<Alias,Alias>;
}
export function initializeSorobanEventsMerchant(options:SetupOptions):Promise<SetupResult>;

/** Private host file input. Every RPC alias selects an actual endpoint and network. */
export interface HostRpcConnection{
  rpcUrl:string;network:StellarNetwork;headers?:Record<string,string>;
  headerEnv?:Record<string,string>;allowHttp?:boolean;timeoutMs?:number;maxResponseBytes?:number;
}
export type HostWorkspaceConfiguration={
  directory:string;label?:string;connections?:Record<Alias,HostRpcConnection>;
  publications?:Record<Alias,NativeWatchPublication>;
}&(HostRpcConnection|{rpcUrl?:never;network?:never;headers?:never;headerEnv?:never;allowHttp?:never;timeoutMs?:never;maxResponseBytes?:never});
export interface SorobanEventsConnectionFile{
  schema:'stellar-forge.soroban-events-connection.v1';
  workspaces:Record<Alias,HostWorkspaceConfiguration>;receivers?:Record<Alias,Alias>;
}
