/// <reference types="node" />
import type { Readable } from 'node:stream';
export const APPLICATION_INPUT_MAX_BYTES: number;
export const APPLICATION_INPUT_CHUNK_BYTES: number;
export interface InputManifest {
  schema: 'stellar-forge.sf88.collection-input-upload.v1';
  kind: 'body'; name: string; bytes: number; chunkSha256: string[];
}
export interface InputSelection {
  schema: 'stellar-forge.runtime-application-input-selection.v1';
  workspaceId: string; requestId: string; uploadId: string; kind: string; field: string;
  original: {name: string; bytes: number; sha256: string};
  path: string; createdAt: string; phase: 'PREPARING'|'PREPARED';
  current: null|{bytes: number; sha256: string; changed: boolean};
  error?: {code: string; message: string};
}
export interface InputUpload {
  uploadId: string; manifest: InputManifest; phase: 'UPLOADING'|'READY';
  receivedBytes: number; receivedChunks: number[]; chunkBytes: number;
  input?: {id: string; path: string; bytes: number; sha256: string; name: string};
}
export interface ApplicationInputsAPI {
  applicationInputsState(input?: {query?:string;offset?:number;limit?:number;workingOffset?:number;workingLimit?:number}): Promise<{
    schema: 'stellar-forge.runtime-application-inputs.v1'; workspaceId: string;
    files: {inputs:Array<{id:string;name:string;phase:string;bytes:number;sha256?:string;error?:string}>;
      total:number;offset:number;limit:number;hasMore:boolean};
    working: {items:InputSelection[];total:number;offset:number;limit:number};
    maximumBytes:number;chunkBytes:number;
  }>;
  applicationInputBegin(input:{manifest:InputManifest}):Promise<InputUpload>;
  applicationInputInspect(input:{uploadId:string}):Promise<InputUpload>;
  applicationInputChunk(input:{uploadId:string;index:number;body:Uint8Array|AsyncIterable<Uint8Array>}):Promise<{
    uploadId:string;index:number;bytes:number;sha256:string;
  }>;
  applicationInputComplete(input:{uploadId:string}):Promise<InputUpload>;
  applicationInputPrepare(input:{requestId:string;uploadId:string;kind:string;field:string}):Promise<InputSelection>;
  applicationInputSelection(input:{requestId:string}):Promise<InputSelection>;
  applicationInputDownload(input:{uploadId:string}):Promise<{
    name:string;filename:string;bytes:number;sha256:string;contentType:string;stream:Readable;close():Promise<void>;
  }>;
}
export function createApplicationInputsAPI(root:string,workspaceId:string):ApplicationInputsAPI;
export function retainApplicationInputFile(model:ApplicationInputsAPI,input:{path:string;name?:string}):Promise<InputUpload>;
