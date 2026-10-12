import type { FiscalWorkspaceClient,Operator,JsonObject } from './fiscaldata-workspace-client.mjs';
export type DownloadKind = 'capture'|'edition'|'comparison'|'export'|'package';
export interface FiscalSelection {
  schema:'stellar-forge.fiscaldata-download-selection.v1'; selectionId:string;
  endpoint:string; workspace:{alias:string;id:string}; kind:DownloadKind; id:string; reader:Operator;
  source:JsonObject & {id:string;sha256:string};
  files:Array<{name:string;bytes:number;sha256:string;mime:string}>;
}
export interface SelectionResult { selection:FiscalSelection; selectionSha256:string; }
export interface DownloadResult {
  schema:'stellar-forge.fiscaldata-download.v1'; state:'COMPLETE'; directory:string; exportId:string;
  kind:DownloadKind; id:string; workspace:{alias:string;id:string}; sourceSha256:string;
  manifestSha256:string; resumed:boolean; resumedBytes:number; files:number; bytes:number;
}
export const FISCALDATA_SELECTION_SCHEMA:'stellar-forge.fiscaldata-download-selection.v1';
export const FISCALDATA_SELECTION_FILE:'fiscal-selection.json';
export function selectFiscalDownload(input:{client:FiscalWorkspaceClient;kind:DownloadKind;id:string;expectedSha256?:string;signal?:AbortSignal}):Promise<SelectionResult>;
export function downloadFiscalSelection(input:{
  client:FiscalWorkspaceClient;selection:FiscalSelection;directory:string;expectedSelectionSha256?:string;
  signal?:AbortSignal;chunkSize?:number;
  onProgress?:(value:{exportId:string;file:string;bytes:number;total:number;state:'DOWNLOADING'})=>void|Promise<void>;
}):Promise<DownloadResult>;
export function readFiscalSelection(path:string):Promise<SelectionResult>;
export function writeFiscalSelection(path:string,selection:FiscalSelection):Promise<{path:string;bytes:number;sha256:string;selectionId:string}>;
export function verifyFiscalDownload(input:{directory:string;expectedSelectionSha256?:string}):Promise<SelectionResult & {
  schema:'stellar-forge.fiscaldata-download-verification.v1';state:'VERIFIED';directory:string;files:number;bytes:number;
}>;
export function receiveFiscalDownload(input:{
  directory:string;destination:string;operationId:string;actor:Operator;expectedSelectionSha256?:string;expectedWorkspaceId?:string;
}):Promise<{schema:'stellar-forge.fiscaldata-remote-receiving.v1';state:'RECEIVED';selectionId:string;selectionSha256:string;packageSha256:string;receiving:JsonObject}>;
export function inspectReceivedFiscalWorkspace(input:{directory:string;expectedWorkspaceId:string}):Promise<{workspaceId:string;snapshot:JsonObject}>;
