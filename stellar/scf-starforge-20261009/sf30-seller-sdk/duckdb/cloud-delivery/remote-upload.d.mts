import type {CloudClient} from './client.mjs';
import type {Sha256,ByteCount,Uuid,UploadStatus} from './types.mjs';
export function inspectCloudUpload(path:string,options?:{signal?:AbortSignal}):Promise<{path:string;bytes:ByteCount;sha256:Sha256}>;
export interface UploadProgress {editionId:string;fileId:string;offset:ByteCount;bytes:ByteCount;sentBytes:ByteCount;state:'UPLOADING'|'COMPLETE'}
export function uploadCloudFile(input:{client:CloudClient;workspace:string;workspaceInstanceId:Uuid;editionId:string;fileId:string;
 path:string;expectedSha256?:Sha256;expectedBytes?:ByteCount;signal?:AbortSignal;chunkSize?:number;onProgress?:(value:UploadProgress)=>void}):
 Promise<UploadStatus & {workspace:string;workspaceId?:Uuid;localSha256:Sha256;sentBytes?:ByteCount;resumed?:boolean}>;
