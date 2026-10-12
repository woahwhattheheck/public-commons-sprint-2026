/// <reference types="node" />
export interface ZoteroConnection {
  schema:'stellar-forge.zotero-workspace-connection.v1';
  url:string;active:true;instanceId:string;workspaceId:string;
}
export interface ZoteroLibrary {type:'users'|'groups';id:string}
export interface ZoteroScope {collectionKeys:string[];includeDescendants:boolean}
export interface ZoteroProfile {
  schema?:'stellar-forge.zotero-profile.v1';title:string;library:ZoteroLibrary;
  apiKeyEnv:string|null;sourceTerms:string;scope:ZoteroScope;includeTrashed?:boolean;
  timeoutMs?:number;maxPageBytes?:number;maxCaptureBytes?:number;maxItems?:number;
}
export interface ZoteroDecision {selected:boolean;classification:'unreviewed'|'supports'|'contradicts'|'background';note:string}
export interface ZoteroProject {
  id:string;revision:number;title:string;description:string;editionId:string;scope:ZoteroScope;
  decisions:Record<string,ZoteroDecision>;
  findings:Array<{id:string;title:string;text:string;itemKeys:string[]}>;
}
export interface ZoteroFile {bytes:Buffer;sha256:string;contentType:string|null;filename:string}
export type ZoteroMethod =
  'state'|'record.get'|'record.list'|'record.history'|'edition.get'|'project.get'|'project.page'|
  'capture.get'|'profile.save'|'capture.prepare'|'capture.control'|'documents.import'|
  'project.save'|'project.decide'|'edition.compare'|'research.get'|'research.preview'|
  'research.prepare'|'research.receive';
export interface ZoteroClient {
  verify():Promise<{workspaceId:string;instanceId:string;active:true}>;
  state():Promise<Record<string,unknown>>;
  invoke<T=Record<string,unknown>>(method:ZoteroMethod,input?:Record<string,unknown>,requestId?:string|null):Promise<T>;
  importDocuments(bytes:Uint8Array,selection:{profileId:string;profileRevision:number;requestId:string}):Promise<Record<string,unknown>>;
  download(selection:{kind:string;id:string;revision?:number;role?:string;name?:string}):Promise<ZoteroFile>;
  exportWorkspace(requestId:string):Promise<ZoteroFile>;
  receiveWorkspace(bytes:Uint8Array,selection:{name:string;requestId:string}):Promise<Record<string,unknown>>;
  openReceiver(name:string):Promise<Record<string,unknown>>;
  shutdown():Promise<{closing:true;instanceId:string}>;
  close():void;
}
export function readZoteroConnection(value:ZoteroConnection):{origin:string;token:string;workspaceId:string;instanceId:string};
export function loadZoteroConnection(path:string):Promise<ReturnType<typeof readZoteroConnection>>;
export function createZoteroClient(connection:ZoteroConnection|ReturnType<typeof readZoteroConnection>,options?:{fetchImpl?:typeof fetch;timeoutMs?:number}):ZoteroClient;
