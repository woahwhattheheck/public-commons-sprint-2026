export type RecordKind='connection'|'source'|'draft'|'capture'|'operation'|'commissioning'|'request'|'handover'|'note';
export interface ObjectReference { sha256:string; bytes:number }
export interface RecordReference { kind:RecordKind; id:string; revision:number; sha256:string }
export interface RetainedRecord<T=Record<string,unknown>> extends RecordReference { createdAt:string; updatedAt:string; value:T }
export interface Connection { label:string; managementUrl:string; organizationId:string; environmentId:string; auth:{type:'bearer';tokenEnv:string}|{type:'basic';usernameEnv:string;passwordEnv:string};gatewayUrls?:string[];contract?:Record<string,unknown>|null;allowHttp?:boolean;requestTimeoutMs?:number;maximumResponseBytes?:number }
export interface SourceFile { path:string;content?:string;base64?:string;mediaType?:string;sha256?:string }
export interface SourceFinding { id:string;code:string;location:string;detail:string }
export interface NativeDraft { schema:'gravitee.proxy-draft.v1';label:string;sourceSha256:string;operationId:string;body:Record<string,unknown>;plans:Record<string,unknown>[];findings:SourceFinding[];resolutions:Record<string,string>;mapping:Record<string,unknown>;routes:Record<string,unknown>[] }
export interface GatewayProbe { gatewayIndex?:number;path:string;method?:'GET'|'HEAD'|'OPTIONS';expectedStatus?:number;headerEnv?:Record<string,string> }
export interface CommissioningInput { requestId:string;connectionId:string;draftId:string;draftRevision?:number;mappingSha256:string;label?:string;publishPlans?:boolean;publishAPI?:boolean;start?:boolean;deploy?:boolean;review?:{request?:boolean;accept?:boolean;message?:string};deploymentLabel?:string;probes?:GatewayProbe[] }
export interface Inputs {
 view:Record<string,never>;
 list:{kind?:RecordKind;offset?:number;limit?:number};
 get:{kind:RecordKind;id:string;revision?:number;includeJournal?:boolean};
 readObject:{reference:ObjectReference};
 readSource:{id:string;revision?:number};
 readDraft:{id:string;revision?:number};
 readCapture:{id:string;revision?:number};
 saveConnection:{requestId?:string;connection:Connection};
 importSource:{requestId?:string;files:SourceFile[];entry:string;label?:string};
 saveDraft:{requestId?:string;sourceId:string;sourceRevision?:number;id?:string;expectedRevision?:number;mapping?:Record<string,unknown>;draft?:NativeDraft};
 capture:{requestId?:string;connectionId:string;label?:string;apiIds?:string[]};
 prepareOperation:{requestId?:string;connectionId:string;operationId:string;parameters?:{apiId?:string;planId?:string;pageId?:string;eventId?:string;query?:Record<string,unknown>;body?:Record<string,unknown>};label?:string};
 refreshOperation:{id:string};
 executeOperation:{id:string;planSha256:string};
 reconcileOperation:{id:string;apiId?:string;planId?:string};
 commission:CommissioningInput;
 probe:{requestId?:string;connectionId:string;probe:GatewayProbe};
 addNote:{requestId?:string;label?:string;note:string;record?:RecordReference};
 exportHandover:{requestId?:string;label?:string;includeSoftware?:boolean};
}
export interface WorkspaceClient {
 action<K extends keyof Inputs>(method:K,input:Inputs[K],options?:{signal?:AbortSignal}):Promise<unknown>;
 download(reference:ObjectReference,options?:{signal?:AbortSignal}):Promise<ArrayBuffer>;
 read(method:keyof Inputs):(input:Inputs[keyof Inputs])=>Promise<unknown>;
}
export declare const READ_METHODS:readonly string[];
export declare const WRITE_METHODS:readonly string[];
export declare function createGraviteeWorkspaceClient(options:{url:string;token?:string;workspaceId?:string;fetch?:typeof globalThis.fetch}):WorkspaceClient;
