/// <reference types="node" />
import type {Readable} from 'node:stream';
import type {ApplicationInputSetManifest,ApplicationInputSetFile,ApplicationInputSetStatus,ApplicationInputSetsAPI} from './application-input-sets.mjs';
import type {ApplicationInputsAPI} from './application-inputs.mjs';
export interface ApplicationInputSetArchiveReview {
 schema:'stellar-forge.runtime-application-input-set-archive-review.v1';setId:string;originWorkspaceId:string;
 manifest:ApplicationInputSetManifest;files:Array<ApplicationInputSetFile&{offset:number}>;bytes:number;
}
export interface ApplicationInputSetArchivesAPI {
 applicationInputSetArchiveDownload(input:{setId:string}):Promise<{
  setId:string;originWorkspaceId:string;manifest:ApplicationInputSetManifest;bytes:number;
  filename:string;type:'application/zip';stream:Readable;close():Promise<void>;
 }>;
}
export function createApplicationInputSetArchivesAPI(getModel:()=>ApplicationInputSetsAPI&ApplicationInputsAPI):ApplicationInputSetArchivesAPI;
export function inspectApplicationInputSetArchiveFile(input:{archive:string}):Promise<ApplicationInputSetArchiveReview&{path:string}>;
export function receiveApplicationInputSetArchive(model:ApplicationInputSetsAPI&ApplicationInputsAPI,input:{archive:string;expectedSetId?:string}):Promise<ApplicationInputSetStatus&{archive:string;originWorkspaceId:string}>;
export function exportApplicationInputSetArchive(model:ApplicationInputSetArchivesAPI,input:{setId:string;output:string}):Promise<{path:string;setId:string;bytes:number;sha256:string}>;
