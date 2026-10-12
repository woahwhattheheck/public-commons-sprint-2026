export interface OriginalFile {path:string;bytes:number;sha256:string;}
export interface WherobotsApplicationSelection {
  schema:"stellar-forge.wherobots-application-selection.v1";
  binding:{
    connectionFile:string;workspace:string;workspaceId:string;directory:string;
    python:string;pythonRealPath:string;profile:string|null;pythonPath:string[];
    configurationFiles:OriginalFile[];bindingSha256:string;
  };
  source:{root:string;files:{name:string;bytes:number;sha256:string}[];sha256:string;};
}
export interface WherobotsApplicationStartup {
  schema:"stellar-forge.wherobots-application-startup.v1";state:"READY";
  workspace:string;workspace_id:string;directory:string;connectionFile:string;
  bindingSha256:string;sourceRoot:string;sourceSha256:string;
  pid:number;workerPid:number;instanceId:string;url:string;
  runtime:import("./source/index.mjs").RuntimeInformation;
}
export interface WherobotsApplicationOptions {
  connection:string;workspace:string;python?:string;
}
export interface WherobotsApplicationExit {code:number|null;signal:string|null;error:Error|null;}
export interface WherobotsApplication {
  startup:WherobotsApplicationStartup;url:string;selection:WherobotsApplicationSelection;
  close():Promise<WherobotsApplicationExit>;closed:Promise<WherobotsApplicationExit>;
  readonly diagnostics:{pid:number|undefined;closing:boolean;exited:boolean;stderr:string;};
}
export const WHEROBOTS_APPLICATION_SELECTION:"stellar-forge.wherobots-application-selection.v1";
export const WHEROBOTS_APPLICATION_STARTUP:"stellar-forge.wherobots-application-startup.v1";
export function prepareWherobotsApplication(options:WherobotsApplicationOptions&{
  sourceRoot?:string;
}):Promise<WherobotsApplicationSelection>;
export function startWherobotsApplication(options:WherobotsApplicationOptions&{
  selection?:WherobotsApplicationSelection|string;port?:number;
  environment?:Record<string,string|undefined>;signal?:AbortSignal;
}):Promise<WherobotsApplication>;
export function verifyWherobotsApplicationStartup(value:unknown,options:{
  selection:WherobotsApplicationSelection|string;launchSourceRoot:string;port?:number;pid?:number;signal?:AbortSignal;
}):Promise<{url:string;workspaceId:string;connectionFile:string;original:Record<string,unknown>;}>;
export function main(argv?:string[]):Promise<unknown>;
