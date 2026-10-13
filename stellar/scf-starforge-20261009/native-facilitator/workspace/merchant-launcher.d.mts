/** Original managed native agent host and its reviewed connection binding. */
import type {NativeOperatorIdentity} from './client.mjs';
export interface NativeAgentFileIdentity {path:string;bytes:number;sha256:string}
export interface NativeAgentConnection {
  label:string;timeoutMs:number;maxResponseBytes:number;
  operatorUrlFile?:string;operatorUrlEnv?:string;instanceId?:string;
}
export interface NativeAgentBinding {
  schema:'stellar-forge.native-agent-binding.v1';configFile:string;operator:string;
  connectionFile:string;connection:NativeAgentConnection;configurationFiles:NativeAgentFileIdentity[];
  releaseStore:string;exportsDirectory:string;operatorOrigin:string|null;receipt:NativeOperatorIdentity|null;
  bindingSha256:string;
}
export interface NativeAgentStartup {
  schema:'stellar-forge.native-agent-launch.v1';state:'LISTENING';
  instanceId:string;pid:number;ppid:number;startedAt:string;
  configFile:string;operator:string;bindingSha256:string;
  releaseStore:string;exportsDirectory:string;
  /** The original private native browser URL, including its session token. */
  operatorUrl:string;
  /** Original merchant MCP endpoint; its bearer token remains in the selected environment. */
  mcpUrl:string;native:NativeOperatorIdentity;
}
export interface NativeAgentSession {
  readonly startup:Readonly<NativeAgentStartup>;
  readonly binding:Readonly<NativeAgentBinding>;
  readonly operator:{call(name:string,args?:Record<string,unknown>):Promise<unknown>;status():Promise<unknown>};
  /** Retries retain the same original merchant service owner. */
  close():Promise<void>;
}
export interface NativeAgentLaunchOptions {
  configPath:string;operator:string;expectedBindingSha256?:string;
  port?:number;tokenEnv?:string;environment?:Record<string,string|undefined>;
}
/** A failed startup cleanup can retain its original service for an explicit close retry. */
export interface NativeAgentCloseError extends Error {closeNativeAgent?:()=>Promise<void>}
export const NATIVE_AGENT_STARTUP_SCHEMA:'stellar-forge.native-agent-launch.v1';
export function inspectNativeAgentBinding(options:{configPath:string;operator:string}):Promise<Readonly<NativeAgentBinding>>;
export function startNativeFacilitatorAgent(options:NativeAgentLaunchOptions):Promise<Readonly<NativeAgentSession>>;
export function main(argv?:string[]):Promise<Readonly<NativeAgentBinding>|Readonly<NativeAgentSession>|undefined>;
