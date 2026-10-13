import type {DocumentAgentArguments,DocumentAgentToolName,DocumentAgentResult,DocumentAgentTool}
  from './agent.mjs';
import type {DocumentCompositionOperation,DocumentCompositionDownloadInput} from './composition-workspace.mjs';
import type {DocumentAssemblyBrowserOperation,DocumentAssemblyBrowserDownload} from './assembly-workspace.mjs';
export interface DocumentAgentConnection {
  /** Original private customer URL, including session token. Do not log or publish. */
  url:string;directory:string;pid:number;instanceId:string;launchFile:string;launchSha256:string;
}
export interface DocumentAgentRequestOptions {signal?:AbortSignal}
export interface DocumentAgentClientOptions {
  url?:string;connection?:DocumentAgentConnection;fetch?:typeof globalThis.fetch;
  timeoutMs?:number;maxReplyBytes?:number;
}
export type DocumentAgentObservedOperation=(DocumentCompositionOperation|DocumentAssemblyBrowserOperation)&{
  waitExpired?:boolean;continuation?:string;
};
export interface DocumentAgentWaitOptions extends DocumentAgentRequestOptions {
  bundles?:boolean;pollMs?:number;deadlineMs?:number;
  onProgress?:(operation:DocumentCompositionOperation|DocumentAssemblyBrowserOperation)=>void|Promise<void>;
}
export interface DocumentAgentDownloadOptions extends DocumentAgentRequestOptions {
  bundles?:boolean;maxBytes?:number;
}
export interface DocumentAgentReceivedFile {
  path:string;bytes:number;sha256:string;
  source:DocumentCompositionDownloadInput|DocumentAssemblyBrowserDownload;bundles:boolean;
}
export interface DocumentAgentClient {
  readonly endpoint:string;
  initialize(options?:DocumentAgentRequestOptions):Promise<Record<string,unknown>>;
  tools(options?:DocumentAgentRequestOptions):Promise<DocumentAgentTool[]>;
  call<K extends DocumentAgentToolName>(name:K,args:DocumentAgentArguments[K],
    options?:DocumentAgentRequestOptions):Promise<DocumentAgentResult<K>>;
  wait(operationId:string,options?:DocumentAgentWaitOptions):Promise<DocumentAgentObservedOperation>;
  download(input:DocumentCompositionDownloadInput|DocumentAssemblyBrowserDownload,destination:string,
    options?:DocumentAgentDownloadOptions):Promise<DocumentAgentReceivedFile>;
  status(input?:DocumentAgentArguments['documents_status'],options?:DocumentAgentRequestOptions):Promise<DocumentAgentResult<'documents_status'>>;
  get(input:DocumentAgentArguments['documents_get'],options?:DocumentAgentRequestOptions):Promise<DocumentAgentResult<'documents_get'>>;
  stage(input:DocumentAgentArguments['documents_stage'],options?:DocumentAgentRequestOptions):Promise<DocumentAgentResult<'documents_stage'>>;
  quote(input:DocumentAgentArguments['documents_quote'],options?:DocumentAgentRequestOptions):Promise<DocumentAgentResult<'documents_quote'>>;
  execute(input:DocumentAgentArguments['documents_execute'],options?:DocumentAgentRequestOptions):Promise<DocumentAgentResult<'documents_execute'>>;
  receive(input:DocumentAgentArguments['documents_receive'],options?:DocumentAgentRequestOptions):Promise<DocumentAgentResult<'documents_receive'>>;
  export(input:DocumentAgentArguments['documents_export'],options?:DocumentAgentRequestOptions):Promise<DocumentAgentResult<'documents_export'>>;
}
export function readDocumentAgentConnection(launchFile:string):Promise<DocumentAgentConnection>;
export function createDocumentAgentClient(options:DocumentAgentClientOptions):DocumentAgentClient;
