export type JsonValue = null | boolean | number | string | JsonValue[] | {[key:string]:JsonValue};
export interface OriginalRequest {action:string;actor:string;operation_id:string;expected_version:number;payload:Record<string,JsonValue>;}
export interface CallOptions {signal?:AbortSignal;}
export interface WorkspaceOptions {workspace:string;python?:string;application?:string;}
export class GroundwaterWorkspace {
 constructor(options:WorkspaceOptions);
 initialize(workspaceId?:string,options?:CallOptions):Promise<Record<string,JsonValue>>;
 state(projectId?:string,options?:CallOptions):Promise<Record<string,JsonValue>>;
 action(request:OriginalRequest,options?:CallOptions):Promise<Record<string,JsonValue>>;
 operation(originalId:string,options?:CallOptions):Promise<Record<string,JsonValue>>;
 run(originalId:string,options?:CallOptions):Promise<Record<string,JsonValue>>;
 report(originalId:string,options?:CallOptions):Promise<Record<string,JsonValue>>;
 inspectPackage(archive:string,options?:CallOptions):Promise<Record<string,JsonValue>>;
 receivePackage(archive:string,destination:string,options?:CallOptions):Promise<Record<string,JsonValue>>;
 restore(archive:string,destination:string,options?:CallOptions):Promise<Record<string,JsonValue>>;
}
export default GroundwaterWorkspace;
