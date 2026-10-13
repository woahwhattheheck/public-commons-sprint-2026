/// <reference types="node" />
import type {NativeIdentity,NativeReply,JsonInput,JsonObject,ReadOperation,WriteOperation,Query,FileReceiving,OriginalObject} from './client.mjs';
import type {NormalizedSourceMonitoringConfiguration,MonitoringScope} from './merchant.mjs';
export interface AuthorizedMonitoringFile {
 path:string;bytes:number;sha256:string;name?:string;media?:string;sourceUrl?:string;
}
export interface AgentMonitoringClientOptions {
 configuration:NormalizedSourceMonitoringConfiguration;
 scope:MonitoringScope;
 /** Only an existing commissioning programme's exact selected output may be declared here. */
 authorizeFile?:null|((file:{path:string;bytes:number;sha256:string})=>Promise<AuthorizedMonitoringFile>);
}
/** A complete original native reply transported through the advertised customer-agent tools. */
export class AgentMonitoringClient {
 constructor(options:AgentMonitoringClientOptions);
 inspect():Promise<NativeIdentity>;
 get<T=JsonObject>(operation:ReadOperation,parameters?:Query):Promise<NativeReply<T>>;
 /** Original JSON text/bytes retain numeric token spelling through the tool transport. */
 post<T=JsonObject>(operation:WriteOperation,input:JsonInput):Promise<NativeReply<T>>;
 upload(path:string,options?:{name?:string;media?:string;sourceUrl?:string}):Promise<NativeReply<OriginalObject>>;
 receiveArchive(path:string):Promise<NativeReply>;
 download(kind:'workspace'|'object'|'source'|'review-exchange',selection:{
  id?:string;role?:'issued_json'|'issued_html'|'returned_file';output:string;expectedSha256?:string;
 }):Promise<FileReceiving>;
 /** Drain this transport and its retained readers. The borrowed native service stays owned by Applications. */
 close():Promise<void>;
}
export function createAgentMonitoringClient(options:{
 configurationFile:string;workspace:string;authorizeFile?:AgentMonitoringClientOptions['authorizeFile'];
}):Promise<AgentMonitoringClient>;
