import type {CloudClientOptions,CloudToolArguments,CloudToolName,CloudToolResults,ToolOptions,ToolDeclaration,Uuid,OperationId} from './types.mjs';
export * from './types.mjs';
export const CLOUD_CLIENT_TOOLS:readonly ToolDeclaration[];
export class CloudClient {
 private constructor();
 readonly endpoint:string;readonly pendingRequests:number;readonly retainedReads:{readId:Uuid;workspace:string}[];readonly closing:boolean;
 call<K extends CloudToolName>(name:K,args:CloudToolArguments[K],options?:ToolOptions):Promise<CloudToolResults[K]>;
 workspaces(options?:ToolOptions):Promise<CloudToolResults['merchant_cloud_workspaces']>;
 openWorkspace(workspace:string,options?:ToolOptions):Promise<CloudToolResults['merchant_cloud_open']>;
 status(workspace:string,options?:ToolOptions):Promise<CloudToolResults['merchant_cloud_status']>;
 operation(workspace:string,operationId:OperationId,kind?:'cloud'|'draft'|'package',options?:ToolOptions):Promise<CloudToolResults['merchant_cloud_operation']>;
 closeWorkspace(workspace:string,workspaceInstanceId:Uuid,options?:ToolOptions):Promise<CloudToolResults['merchant_cloud_close']>;
 releaseArtifact(workspace:string,readId:Uuid):Promise<CloudToolResults['merchant_cloud_artifact_release']|{workspace:string;released:Uuid;ownerClosed:true}>;
 close():Promise<void>;
}
export function connectCloudClient(options:CloudClientOptions):Promise<CloudClient>;
