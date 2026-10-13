/// <reference types="node" />
/** MIT. Complete borrowed Source Monitoring agent operations; no native service ownership. */
import type {ReadOperation,WriteOperation,NativeIdentity} from './client.mjs';
import type {IncomingHttpHeaders} from 'node:http';
export type {ReadOperation,WriteOperation,NativeIdentity} from './client.mjs';
export const AGENT_RESULT_SCHEMA:'stellar-forge.source-monitoring-agent-result.v1';
export interface MonitoringScope {
 workspace:string;
 /** Exact original physical workspace, independently received branches remain separate. */
 expectedWorkspace:string;
 expectedBindingSha256:string;
}
export interface MonitoringFileAlias {
 path:string;bytes:number;sha256:string;name?:string;media?:string;sourceUrl?:string;
}
export interface MonitoringWorkspaceAlias {
 label?:string;connectionFile:string;expectedWorkspace:string;expectedBindingSha256:string;timeoutMs?:number;
}
export interface SourceMonitoringConfiguration {
 schema:'stellar-forge.source-monitoring-workspaces.v1';
 storageDirectory:string;
 workspaces:Record<string,MonitoringWorkspaceAlias>;
 files?:Record<string,MonitoringFileAlias>;
}
export interface NormalizedSourceMonitoringConfiguration extends SourceMonitoringConfiguration {
 workspaces:Record<string,Required<MonitoringWorkspaceAlias>>;
 files:Record<string,Required<MonitoringFileAlias>>;
}
export function validateSourceMonitoringConfiguration(value:SourceMonitoringConfiguration,options:{baseDirectory:string}):NormalizedSourceMonitoringConfiguration;
export function readSourceMonitoringConfiguration(file:string):Promise<NormalizedSourceMonitoringConfiguration>;
export type RetainedMonitoringSelection={kind:'retained';sha256:string;bytes:number};
export type NativeMonitoringSelection=
 | {kind:'workspace'}
 | {kind:'object'|'source';id:string;bytes?:number}
 | {kind:'review-exchange';id:string;role:'issued_json'|'issued_html'|'returned_file';sha256:string;bytes:number};
export interface MonitoringRange {
 readId:string;file:{name:string;contentType:string;bytes:number;sha256:string};
 offset:number;bytesRead:number;nextOffset:number|null;encoding:'base64';data:string;
}
/** Actual selected input metadata is retained independently of native object deduplication. */
export interface MonitoringSelectedInput {
 alias:string;bytes:number;sha256:string;name:string;media:string;sourceUrl?:string;
}
export type MonitoringAgentAction='inspect'|'read'|'command'|'upload'|'receive_archive'|'download'|'file_read';
/** Full JSON document addressed by the result's request selection, retained before native dispatch. */
export interface MonitoringRequestDocument {
 schema:'stellar-forge.source-monitoring-agent-request.v1';
 scope:MonitoringScope;operation:WriteOperation|'upload'|'receive_archive';
 input:RetainedMonitoringSelection;selectedInput:MonitoringSelectedInput|null;
 /** Explains that original native request identity remains in the exact input bytes. */
 nativeIdentity:string;
}
/** Full JSON document addressed by response.metadata. The body is retained separately in full. */
export interface MonitoringHttpDocument {
 schema:'stellar-forge.source-monitoring-agent-http.v1';
 scope:MonitoringScope;operation:string;request:RetainedMonitoringSelection|null;
 status:number|null;headers:IncomingHttpHeaders;body:RetainedMonitoringSelection;
}
export interface MonitoringFailureBody extends RetainedMonitoringSelection {
 status:number|null;headers:IncomingHttpHeaders;metadata:RetainedMonitoringSelection;
 /** Complete original text only when it fits the inline limit, otherwise null. */
 rawJson:string|null;
}
/** Complete document addressed by error.evidence; detail preserves the native error metadata. */
export interface MonitoringErrorDocument {
 code:string;message:string;dispatched:boolean;uncertain:boolean;
 request:RetainedMonitoringSelection|null;detail:Record<string,unknown>;
 response:MonitoringFailureBody|null;
}
export interface MonitoringNativeResponse {
 schema:typeof AGENT_RESULT_SCHEMA;status:'NATIVE_RESPONSE';scope:MonitoringScope;operation:ReadOperation|WriteOperation|'upload'|'receive_archive';
 agentAction:'read'|'command'|'upload'|'receive_archive';
 input:RetainedMonitoringSelection|null;request?:RetainedMonitoringSelection;
 selectedInput?:MonitoringSelectedInput;
 response:{status:number;headers:IncomingHttpHeaders;metadata:RetainedMonitoringSelection;bytes:number;sha256:string;selection:RetainedMonitoringSelection;
  inline:boolean;rawJson:string|null;instruction:string};
}
export interface MonitoringNativeFailure {
 schema:typeof AGENT_RESULT_SCHEMA;status:'NATIVE_ERROR';scope:MonitoringScope;operation:string;
 agentAction:MonitoringAgentAction;
 input:RetainedMonitoringSelection|null;request?:RetainedMonitoringSelection;instruction:string;
 error:{code:string;message:string;uncertain:boolean;dispatched:boolean;detail:Record<string,unknown>;evidence:RetainedMonitoringSelection};
 response:MonitoringFailureBody|null;
 selectedInput?:MonitoringSelectedInput;
}
export interface MonitoringConnected {
 schema:typeof AGENT_RESULT_SCHEMA;status:'CONNECTED';scope:MonitoringScope;identity:NativeIdentity;
}
export interface MonitoringReleased {released:true;readId:string;scope:MonitoringScope}
export interface MonitoringFileResult {
 schema:typeof AGENT_RESULT_SCHEMA;status:'FILE_RETAINED';scope:MonitoringScope;
 originalSelection:NativeMonitoringSelection;
 file:{selection:RetainedMonitoringSelection;bytes:number;sha256:string};
}
/** Native page limits are integers from 1 through 250; offsets retain native route bounds. */
export interface MonitoringPage {offset?:number;limit?:number}
/** The original client calls each exact native route; parameters are not interchangeable. */
export interface MonitoringReadParameters {
 state:Record<string,never>;
 contract:Record<string,never>;
 entity:{scope:string;id:string};
 entities:MonitoringPage&{scope:string};
 aliases:{scope:string;id:string};
 changes:MonitoringPage&{comparison:string;kind?:string;material?:boolean};
 impacts:{comparison:string};
 case:{id:string};
 statements:MonitoringPage&{set:string;entity?:string};
 response:{id:string};
 request:{id:string};
 'update-plan':{before:string;after:string;index:string};
 cycles:Record<string,never>;
 cycle:{id:string};
 'cycle-request':{id:string};
 'cycle-report':{id:string;version:number};
 'gleif-intake':{requestId:string};
 'review-exchanges':MonitoringPage;
 'review-exchange':MonitoringPage&{id:string};
 'review-exchange-request':{requestId:string};
 'review-exchange-compare':{returnId:string;editionId:string;adoptionRequestId?:string};
 'portfolio-cycle-reviews':{comparisonId:string};
 'portfolio-refreshes':Record<string,never>;
 'portfolio-refresh':MonitoringPage&{id:string;kind?:''|'added'|'removed'|'changed'|'unchanged';query?:string};
 'portfolio-refresh-request':{requestId:string};
 'portfolio-refresh-report':{id:string};
}
/** A discriminated union preserves the selected route and its exact required query fields. */
export type MonitoringReadArguments<O extends ReadOperation=ReadOperation>={
 [K in O]:{scope:MonitoringScope;operation:K;parameters:MonitoringReadParameters[K]}
}[O];
export type MonitoringCommandArguments={scope:MonitoringScope;operation:WriteOperation}&(
 {jsonText:string;inputFile?:never}|{jsonText?:never;inputFile:{alias:string;bytes:number;sha256:string}});
export interface MonitoringUploadArguments {scope:MonitoringScope;fileAlias:string;bytes:number;sha256:string;name?:string;media?:string;sourceUrl?:string}
export interface MonitoringArchiveArguments {scope:MonitoringScope;fileAlias:string;bytes:number;sha256:string}
export interface MonitoringFileReadArguments {scope:MonitoringScope;selection:NativeMonitoringSelection|RetainedMonitoringSelection;expectedSha256?:string;readId?:string;offset?:number;limit?:number}
export interface MonitoringAgentSummary {
 configured:true;closing:boolean;
 workspaces:Array<MonitoringScope&{label:string;connection:'ORIGINAL_PRIVATE_FILE'}>;
 files:Array<{alias:string;name:string;media:string;sourceUrl:string;bytes:number;sha256:string}>;
 activeFileReads:number;pendingFileCloses:number;snapshotBytes:number;immutableFileBytes:number;
}
/** Closed names and argument/result mappings for adapters over the maintained provider. */
export interface MonitoringToolArguments {
 merchant_monitoring_workspaces:Record<string,never>;
 merchant_monitoring_inspect:{scope:MonitoringScope};
 merchant_monitoring_read:MonitoringReadArguments;
 merchant_monitoring_command:MonitoringCommandArguments;
 merchant_monitoring_upload:MonitoringUploadArguments;
 merchant_monitoring_receive_archive:MonitoringArchiveArguments;
 merchant_monitoring_download:{scope:MonitoringScope;selection:NativeMonitoringSelection};
 merchant_monitoring_file_read:MonitoringFileReadArguments;
 merchant_monitoring_file_release:{scope:MonitoringScope;readId:string};
}
export interface MonitoringToolResults {
 merchant_monitoring_workspaces:MonitoringAgentSummary;
 merchant_monitoring_inspect:MonitoringConnected|MonitoringNativeFailure;
 merchant_monitoring_read:MonitoringNativeResponse|MonitoringNativeFailure;
 merchant_monitoring_command:MonitoringNativeResponse|MonitoringNativeFailure;
 merchant_monitoring_upload:MonitoringNativeResponse|MonitoringNativeFailure;
 merchant_monitoring_receive_archive:MonitoringNativeResponse|MonitoringNativeFailure;
 merchant_monitoring_download:MonitoringFileResult|MonitoringNativeFailure;
 merchant_monitoring_file_read:MonitoringRange|MonitoringNativeFailure;
 merchant_monitoring_file_release:MonitoringReleased;
}
export type MonitoringToolName=keyof MonitoringToolArguments;
export class MerchantSourceMonitoring {
 constructor(config:{sourceMonitoring:NormalizedSourceMonitoringConfiguration});
 readonly summary:MonitoringAgentSummary;
 call(name:'merchant_monitoring_workspaces',args?:Record<string,never>):Promise<MonitoringAgentSummary>;
 call(name:'merchant_monitoring_inspect',args:{scope:MonitoringScope}):Promise<MonitoringConnected|MonitoringNativeFailure>;
 call(name:'merchant_monitoring_read',args:MonitoringReadArguments):Promise<MonitoringNativeResponse|MonitoringNativeFailure>;
 call(name:'merchant_monitoring_command',args:MonitoringCommandArguments):Promise<MonitoringNativeResponse|MonitoringNativeFailure>;
 call(name:'merchant_monitoring_upload',args:MonitoringUploadArguments):Promise<MonitoringNativeResponse|MonitoringNativeFailure>;
 call(name:'merchant_monitoring_receive_archive',args:MonitoringArchiveArguments):Promise<MonitoringNativeResponse|MonitoringNativeFailure>;
 call(name:'merchant_monitoring_download',args:{scope:MonitoringScope;selection:NativeMonitoringSelection}):Promise<MonitoringFileResult|MonitoringNativeFailure>;
 call(name:'merchant_monitoring_file_read',args:MonitoringFileReadArguments):Promise<MonitoringRange|MonitoringNativeFailure>;
 call(name:'merchant_monitoring_file_release',args:{scope:MonitoringScope;readId:string}):Promise<MonitoringReleased>;
 call<N extends MonitoringToolName>(name:N,args:MonitoringToolArguments[N]):Promise<MonitoringToolResults[N]>;
 /** Drain only this provider's accepted calls and read handles; leave the original server running. */
 close():Promise<void>;
}
