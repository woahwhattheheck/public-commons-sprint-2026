// MIT. Complete native FHIR operation and retained-file client contracts.
export type Json=null|boolean|number|string|Json[]|{[key:string]:Json};
export interface JsonObject{[key:string]:Json}
export type UUID=string;export type SHA256=string;
export interface RequestOptions{requestSignal?:AbortSignal|null;timeoutMs?:number}
export interface ClientOptions{url:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal}
export interface LocalClientOptions{connection:string;exportsDirectory:string}
export interface FileIdentity{name:string;bytes:number;sha256:SHA256;contentType:string}
export interface ExportManifest{
  schema:'stellar-forge.fhir-bulk-merchant-export.v1';exportId:SHA256;workspace:string;workspaceId:UUID;instanceId:UUID;
  kind:'native-response'|'source-file'|'source-packet'|'dataset'|'dataset-packet'|'comparison-file'|'workspace-packet';
  source:JsonObject;files:FileIdentity[];
}
export interface RetainedResult<T=Json>{
  schema:'stellar-forge.fhir-bulk-merchant-result.v1';state:'COMPLETED'|'REJECTED';workspace:string;workspaceId:UUID;instanceId:UUID;
  kind:ExportManifest['kind'];source:JsonObject;exportId:SHA256|null;manifestSha256:SHA256;
  manifestFile:{name:'fhir-bulk-manifest.json';bytes:number;sha256:SHA256};files:FileIdentity[];
  native:{ok:boolean;status:number;headers:Record<string,string>};
  retention:{state:'COMPLETE'}|{state:'FAILED';code:string;recovery:string};completeValue?:boolean;value?:T;preview?:Json;
}
export interface WorkspaceList{
  configured:boolean;workspaces:Array<{workspace:string;label:string;workspaceId:UUID;allowStart:boolean;selectionSha256:SHA256;
  inputs:Array<{input:string;label:string;sha256:SHA256;bytes:number}>}>;
  clients:Array<{workspace:string;workspaceId:UUID;allowStart:boolean;owned:boolean;closed:boolean}>;
  activeFileReads:number;pendingFileCloses:number;snapshotBytes:number;immutableFileBytes:number;
}
export interface OperatorOpen{state:'OPEN';workspace:string;workspaceId:UUID;instanceId:UUID;ownership:'OWNED'|'BORROWED';selectionSha256:SHA256}
export interface OperatorRelease{state:'RELEASED';workspace:string;workspaceId:UUID;ownership:'OWNED'|'BORROWED';originalOperatorClosed:boolean}
export interface FileManifest{
  state:'MANIFEST_RETAINED';workspace:string;exportId:SHA256;manifest:ExportManifest;
  manifestFile:{name:'fhir-bulk-manifest.json';bytes:number;sha256:SHA256};
}
export interface FileRangeResult{
  workspace:string;exportId:SHA256;manifestSha256:SHA256;
  file:{name:string;bytes:number;sha256:SHA256;type?:string};readId:UUID;offset:number;bytesRead:number;
  encoding:'base64';data:string;nextOffset:number|null;
}
export interface JsonPageResult{
  workspace:string;exportId:SHA256;manifestSha256:SHA256;file:string;pointer:string;type:string;offset:number;total:number;
  value?:Json;nextOffset:number|null;valueAvailableInOriginalFile?:boolean;message?:string;
}
export interface FhirActionArguments{
  workspaces:{};
  schema:{};
  operator_open:{workspace:string};
  operator_release:{workspace:string};
  operator:{workspace:string};
  state:{workspace:string};
  catalogue:{workspace:string};
  auth_profiles:{workspace:string};
  connection:{workspace:string;connectionId:string};
  connection_save:{workspace:string;connection:JsonObject};
  discover:{workspace:string;connectionId:string};
  groups:{workspace:string;connectionId:string;url?:string};
  discovery:{workspace:string;discoveryId:string};
  group_page:{workspace:string;groupPageId:string};
  export:{workspace:string;exportId:string};
  export_save:{workspace:string;export:JsonObject};
  export_advance:{workspace:string;exportId:string;operationId:string};
  operation:{workspace:string;operationId:string};
  operation_status:{workspace:string;operationId:string;statusUrl:string;reason:string};
  operation_receive_capture:{workspace:string;operationId:string;sourceId:string;reason:string};
  operation_cancel:{workspace:string;operationId:string;requestId:string};
  source:{workspace:string;sourceId:string};
  source_members:{workspace:string;sourceId:string};
  source_rows:{workspace:string;sourceId:string;resourceType?:string;kind?:"output"|"deleted"|"error"|"all";offset?:number;limit?:number;query?:string};
  source_row:{workspace:string;sourceId:string;fileId:string;line:number};
  source_file:{workspace:string;sourceId:string;member:string};
  source_packet:{workspace:string;sourceId:string};
  source_import:{workspace:string;input:string;expectedSha256?:string;label?:string};
  mapping_default:{workspace:string;sourceId:string;resourceType:string;name?:string};
  mapping_preview:{workspace:string;sourceId:string;plan:JsonObject;limit?:number};
  compose:{workspace:string;composition:JsonObject};
  plan:{workspace:string;planId:string};
  plan_save:{workspace:string;plan:JsonObject};
  build:{workspace:string;buildId:string};
  build_create:{workspace:string;sourceId:string;planId:string};
  build_query:{workspace:string;buildId:string;query?:Record<string,string>};
  build_dataset:{workspace:string;buildId:string};
  build_packet:{workspace:string;buildId:string};
  comparison_create:{workspace:string;beforeId:string;afterId:string};
  comparison_changes:{workspace:string;comparisonId:string;offset?:number;limit?:number};
  comparison_file:{workspace:string;comparisonId:string};
  workspace_packet:{workspace:string};
  workspace_import:{workspace:string;input:string;expectedSha256?:string};
  packet_import:{workspace:string;input:string;expectedSha256?:string};
  receive_export:{workspace:string;sourceWorkspace:string;exportId:string;expectedManifestSha256:string;kind:"source"|"packet"|"workspace";label?:string};
  manifest:{workspace:string;exportId:string};
  file:{workspace:string;exportId:string;file:string;expectedManifestSha256:string;expectedSha256:string;offset?:number;limit?:number;readId?:string};
  file_release:{workspace:string;exportId:string;readId:string};
  json:{workspace:string;exportId:string;expectedManifestSha256:string;file:string;pointer?:string;offset?:number;limit?:number};
}
export interface FhirActionResults{
  workspaces:WorkspaceList;
  schema:JsonObject;
  operator_open:OperatorOpen;
  operator_release:OperatorRelease;
  operator:RetainedResult;
  state:RetainedResult;
  catalogue:RetainedResult;
  auth_profiles:RetainedResult;
  connection:RetainedResult;
  connection_save:RetainedResult;
  discover:RetainedResult;
  groups:RetainedResult;
  discovery:RetainedResult;
  group_page:RetainedResult;
  export:RetainedResult;
  export_save:RetainedResult;
  export_advance:RetainedResult;
  operation:RetainedResult;
  operation_status:RetainedResult;
  operation_receive_capture:RetainedResult;
  operation_cancel:RetainedResult;
  source:RetainedResult;
  source_members:RetainedResult;
  source_rows:RetainedResult;
  source_row:RetainedResult;
  source_file:RetainedResult;
  source_packet:RetainedResult;
  source_import:RetainedResult;
  mapping_default:RetainedResult;
  mapping_preview:RetainedResult;
  compose:RetainedResult;
  plan:RetainedResult;
  plan_save:RetainedResult;
  build:RetainedResult;
  build_create:RetainedResult;
  build_query:RetainedResult;
  build_dataset:RetainedResult;
  build_packet:RetainedResult;
  comparison_create:RetainedResult;
  comparison_changes:RetainedResult;
  comparison_file:RetainedResult;
  workspace_packet:RetainedResult;
  workspace_import:RetainedResult;
  packet_import:RetainedResult;
  receive_export:RetainedResult;
  manifest:FileManifest;
  file:FileRangeResult;
  file_release:{state:'RELEASED';workspace:string;exportId:SHA256;readId:UUID};
  json:JsonPageResult;
}
export type FhirAction=keyof FhirActionArguments;
export interface FhirClient{
  readonly endpoint:string;
  call<A extends FhirAction>(action:A|`merchant_fhir_bulk_${A}`,args:FhirActionArguments[A],options?:RequestOptions):Promise<FhirActionResults[A]>;
  close():Promise<void>;
  readValue(options:ReadValueOptions):Promise<Json>;
  workspaces(args?:FhirActionArguments['workspaces'],options?:RequestOptions):Promise<FhirActionResults['workspaces']>;
  schema(args?:FhirActionArguments['schema'],options?:RequestOptions):Promise<FhirActionResults['schema']>;
  operatorOpen(args:FhirActionArguments['operator_open'],options?:RequestOptions):Promise<FhirActionResults['operator_open']>;
  operatorRelease(args:FhirActionArguments['operator_release'],options?:RequestOptions):Promise<FhirActionResults['operator_release']>;
  operator(args:FhirActionArguments['operator'],options?:RequestOptions):Promise<FhirActionResults['operator']>;
  state(args:FhirActionArguments['state'],options?:RequestOptions):Promise<FhirActionResults['state']>;
  catalogue(args:FhirActionArguments['catalogue'],options?:RequestOptions):Promise<FhirActionResults['catalogue']>;
  authProfiles(args:FhirActionArguments['auth_profiles'],options?:RequestOptions):Promise<FhirActionResults['auth_profiles']>;
  connection(args:FhirActionArguments['connection'],options?:RequestOptions):Promise<FhirActionResults['connection']>;
  connectionSave(args:FhirActionArguments['connection_save'],options?:RequestOptions):Promise<FhirActionResults['connection_save']>;
  discover(args:FhirActionArguments['discover'],options?:RequestOptions):Promise<FhirActionResults['discover']>;
  groups(args:FhirActionArguments['groups'],options?:RequestOptions):Promise<FhirActionResults['groups']>;
  discovery(args:FhirActionArguments['discovery'],options?:RequestOptions):Promise<FhirActionResults['discovery']>;
  groupPage(args:FhirActionArguments['group_page'],options?:RequestOptions):Promise<FhirActionResults['group_page']>;
  export(args:FhirActionArguments['export'],options?:RequestOptions):Promise<FhirActionResults['export']>;
  exportSave(args:FhirActionArguments['export_save'],options?:RequestOptions):Promise<FhirActionResults['export_save']>;
  exportAdvance(args:FhirActionArguments['export_advance'],options?:RequestOptions):Promise<FhirActionResults['export_advance']>;
  operation(args:FhirActionArguments['operation'],options?:RequestOptions):Promise<FhirActionResults['operation']>;
  operationStatus(args:FhirActionArguments['operation_status'],options?:RequestOptions):Promise<FhirActionResults['operation_status']>;
  operationReceiveCapture(args:FhirActionArguments['operation_receive_capture'],options?:RequestOptions):Promise<FhirActionResults['operation_receive_capture']>;
  operationCancel(args:FhirActionArguments['operation_cancel'],options?:RequestOptions):Promise<FhirActionResults['operation_cancel']>;
  source(args:FhirActionArguments['source'],options?:RequestOptions):Promise<FhirActionResults['source']>;
  sourceMembers(args:FhirActionArguments['source_members'],options?:RequestOptions):Promise<FhirActionResults['source_members']>;
  sourceRows(args:FhirActionArguments['source_rows'],options?:RequestOptions):Promise<FhirActionResults['source_rows']>;
  sourceRow(args:FhirActionArguments['source_row'],options?:RequestOptions):Promise<FhirActionResults['source_row']>;
  sourceFile(args:FhirActionArguments['source_file'],options?:RequestOptions):Promise<FhirActionResults['source_file']>;
  sourcePacket(args:FhirActionArguments['source_packet'],options?:RequestOptions):Promise<FhirActionResults['source_packet']>;
  sourceImport(args:FhirActionArguments['source_import'],options?:RequestOptions):Promise<FhirActionResults['source_import']>;
  mappingDefault(args:FhirActionArguments['mapping_default'],options?:RequestOptions):Promise<FhirActionResults['mapping_default']>;
  mappingPreview(args:FhirActionArguments['mapping_preview'],options?:RequestOptions):Promise<FhirActionResults['mapping_preview']>;
  compose(args:FhirActionArguments['compose'],options?:RequestOptions):Promise<FhirActionResults['compose']>;
  plan(args:FhirActionArguments['plan'],options?:RequestOptions):Promise<FhirActionResults['plan']>;
  planSave(args:FhirActionArguments['plan_save'],options?:RequestOptions):Promise<FhirActionResults['plan_save']>;
  build(args:FhirActionArguments['build'],options?:RequestOptions):Promise<FhirActionResults['build']>;
  buildCreate(args:FhirActionArguments['build_create'],options?:RequestOptions):Promise<FhirActionResults['build_create']>;
  buildQuery(args:FhirActionArguments['build_query'],options?:RequestOptions):Promise<FhirActionResults['build_query']>;
  buildDataset(args:FhirActionArguments['build_dataset'],options?:RequestOptions):Promise<FhirActionResults['build_dataset']>;
  buildPacket(args:FhirActionArguments['build_packet'],options?:RequestOptions):Promise<FhirActionResults['build_packet']>;
  comparisonCreate(args:FhirActionArguments['comparison_create'],options?:RequestOptions):Promise<FhirActionResults['comparison_create']>;
  comparisonChanges(args:FhirActionArguments['comparison_changes'],options?:RequestOptions):Promise<FhirActionResults['comparison_changes']>;
  comparisonFile(args:FhirActionArguments['comparison_file'],options?:RequestOptions):Promise<FhirActionResults['comparison_file']>;
  workspacePacket(args:FhirActionArguments['workspace_packet'],options?:RequestOptions):Promise<FhirActionResults['workspace_packet']>;
  workspaceImport(args:FhirActionArguments['workspace_import'],options?:RequestOptions):Promise<FhirActionResults['workspace_import']>;
  packetImport(args:FhirActionArguments['packet_import'],options?:RequestOptions):Promise<FhirActionResults['packet_import']>;
  receiveExport(args:FhirActionArguments['receive_export'],options?:RequestOptions):Promise<FhirActionResults['receive_export']>;
  manifest(args:FhirActionArguments['manifest'],options?:RequestOptions):Promise<FhirActionResults['manifest']>;
  file(args:FhirActionArguments['file'],options?:RequestOptions):Promise<FhirActionResults['file']>;
  fileRelease(args:FhirActionArguments['file_release'],options?:RequestOptions):Promise<FhirActionResults['file_release']>;
  json(args:FhirActionArguments['json'],options?:RequestOptions):Promise<FhirActionResults['json']>;
}
export interface DownloadSelection{workspace:string;exportId:SHA256;client?:FhirClient;url?:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal}
export interface DownloadOptions extends DownloadSelection{
  directory:string;expectedManifestSha256?:SHA256;chunkSize?:number;onProgress?:(progress:JsonObject)=>void|Promise<void>;
}
export interface DownloadReceipt{
  schema:'stellar-forge.fhir-bulk-file-receipt.v1';state:'COMPLETE'|'REOPENED';workspace:string;workspaceId:UUID;
  exportId:SHA256;manifestSha256:SHA256;directory:string;files:number;bytes:number;kind:ExportManifest['kind'];source:JsonObject;
  resumed?:boolean;resumedBytes?:number;
}
export interface ReadValueOptions{
  workspace?:string;result?:RetainedResult;exportId?:SHA256;file?:string;expectedManifestSha256?:SHA256;
  client?:FhirClient;url?:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal;
}
export function openFhirMerchantClient(options:ClientOptions):Promise<FhirClient>;
export function openFhirLocalClient(options:LocalClientOptions):Promise<FhirClient>;
export function downloadFhirExport(options:DownloadOptions):Promise<DownloadReceipt>;
export function inspectFhirExport(options:DownloadSelection):Promise<{manifest:ExportManifest;manifestSha256:SHA256}>;
export function reopenFhirExport(options:{directory:string;workspace:string;exportId:SHA256;expectedManifestSha256?:SHA256}):Promise<DownloadReceipt>;
export function readFhirValue(options:ReadValueOptions):Promise<Json>;
export const fhirActions:Readonly<Record<FhirAction,{name:string;description:string;inputSchema:JsonObject;annotations:JsonObject}>>;
