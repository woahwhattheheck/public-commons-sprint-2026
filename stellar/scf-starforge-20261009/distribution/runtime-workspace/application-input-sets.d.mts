/// <reference types="node" />
import type {ApplicationInputsAPI} from './application-inputs.mjs';
export const APPLICATION_INPUT_SET_SCHEMA:'stellar-forge.runtime-application-input-set.v1';
export const APPLICATION_INPUT_SET_LIMITS:Readonly<{files:number;directories:number;bytes:number;fileBytes:number;chunkBytes:number}>;
export interface ApplicationInputSetFile {path:string;bytes:number;sha256:string;chunkSha256:string[]}
export interface ApplicationInputSetManifest {
  schema:typeof APPLICATION_INPUT_SET_SCHEMA;name:string;directories:string[];files:ApplicationInputSetFile[];
}
export interface ApplicationInputSetStatus {
  workspaceId:string;setId:string;manifest:ApplicationInputSetManifest;createdAt:string;
  phase:'UPLOADING'|'READY';bytes:number;receivedBytes:number;
  files:Array<ApplicationInputSetFile&{uploadId:string;phase:'NOT_STARTED'|'UPLOADING'|'READY';receivedChunks:number[];receivedBytes:number}>;
}
export interface ApplicationInputSetSelection {
  schema:'stellar-forge.runtime-application-input-set-selection.v1';
  workspaceId:string;requestId:string;setId:string;kind:string;field:string;memberPath:string;
  directory:string;path:string;manifest:ApplicationInputSetManifest;createdAt:string;phase:'PREPARING'|'PREPARED';
  current:null|Array<{path:string;bytes?:number;sha256?:string;changed?:boolean;error?:{code:string;message:string}}>;
  error?:{code:string;message:string};
}
export interface ApplicationInputSetsAPI {
  applicationInputSetsState(input?:{query?:string;offset?:number;limit?:number;workingOffset?:number;workingLimit?:number}):Promise<{
    schema:'stellar-forge.runtime-application-input-sets.v1';workspaceId:string;limits:typeof APPLICATION_INPUT_SET_LIMITS;
    sets:{items:Array<{setId:string;name:string;files:number;directories:number;bytes:number;createdAt:string}>;total:number;offset:number;limit:number};
    working:{items:ApplicationInputSetSelection[];total:number;offset:number;limit:number};
  }>;
  applicationInputSetBegin(input:{manifest:ApplicationInputSetManifest}):Promise<ApplicationInputSetStatus>;
  applicationInputSetInspect(input:{setId:string}):Promise<ApplicationInputSetStatus>;
  applicationInputSetComplete(input:{setId:string}):Promise<ApplicationInputSetStatus>;
  applicationInputSetSelection(input:{requestId:string}):Promise<ApplicationInputSetSelection>;
  applicationInputSetPrepare(input:{requestId:string;setId:string;kind:string;field:string;memberPath?:string}):Promise<ApplicationInputSetSelection>;
  applicationInputSetExport(input:{setId:string;directory:string}):Promise<{
    directory:string;originalsDirectory:string;setId:string;manifest:ApplicationInputSetManifest;
  }>;
}
export function normalizeApplicationInputSet(value:unknown):ApplicationInputSetManifest;
export function createApplicationInputSetsAPI(root:string,workspaceId:string,inputs:ApplicationInputsAPI):ApplicationInputSetsAPI;
