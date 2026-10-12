/// <reference types="node" />
export type NativeObject = Record<string, unknown>;
export type OriginalInput = { operationId: string; actor: string; input: NativeObject };
export type ReportFormat = 'zip' | 'json' | 'html' | 'csv';
export type FileIdentity = { bytes: number; sha256: string };
export type CompleteReceivingInput = OriginalInput & { catalog: Buffer; handoff: Buffer; response: Buffer };
export interface DeskOptions { directory:string; sourceWorkspace?:string; application?:string; python?:string; operationsAccess?:string; signal?:AbortSignal; }
export class GroundwaterReportDesk {
  constructor(options:DeskOptions);
  directory:string;
  open(options?:{create?:boolean}):Promise<NativeObject>;
  state():Promise<NativeObject>;
  reports():Promise<NativeObject>;
  report(id:string):Promise<NativeObject>;
  publish(input:OriginalInput):Promise<NativeObject>;
  publication(id:string):Promise<NativeObject>;
  prepareBuyer(input:{operationId:string;actor:string;publicationId:string;format:ReportFormat;acceptIndex:number;intentId:string;responseOut:string}):Promise<NativeObject>;
  prepareCatalog(input:{operationId:string;actor:string;catalog:Buffer;rowIndex:number;acceptIndex:number;intentId:string;responseOut:string}):Promise<NativeObject>;
  capture(input:{operationId:string;actor:string;inboxDirectory:string;intentIds:string[]}):Promise<NativeObject>;
  handoffInfo(raw:Buffer):NativeObject;
  previewReceiving(input:CompleteReceivingInput):Promise<NativeObject>;
  receive(input:CompleteReceivingInput):Promise<NativeObject>;
  receiving(id:string):Promise<NativeObject>;
  original(id:string):Promise<NativeObject>;
  resume(id:string):Promise<NativeObject>;
  cases():Promise<NativeObject>;
  case(id:string):Promise<NativeObject>;
  export(input:{operationId:string;actor:string;destination:string}):Promise<NativeObject>;
  restore(input:{archive:string;destination:string;expectedSha256:string;expectedBytes:number}):Promise<NativeObject>;
  download(id:string,kind:string,format?:ReportFormat):Promise<FileIdentity & {path:string;name:string;mime:string}>;
}
export class ReportDeskClient {
  constructor(input:{url:string;expectedDeskId:string;fetchImpl?:typeof fetch;signal?:AbortSignal});
  open():Promise<NativeObject>;
  read(kind:string,id?:string):Promise<NativeObject>;
  action(action:string,input:NativeObject):Promise<NativeObject>;
}
export function startReportDesk(input:{desk:GroundwaterReportDesk;port?:number;launchFile?:string;nativeFactory?:Function|null;handleSignals?:boolean}):Promise<{url:string;origin:string;apiBase:string;launch:NativeObject;close():Promise<void>}>;
export const SCHEMA:string;
export const defaultApplication:string;
export const ACTIONS:readonly string[];
