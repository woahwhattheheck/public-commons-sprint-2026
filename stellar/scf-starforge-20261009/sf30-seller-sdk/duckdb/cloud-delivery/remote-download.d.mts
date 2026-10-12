import type {CloudClient} from './client.mjs';
import type {Artifact,ArtifactFile,Sha256,TransferSelection,TransferResult} from './types.mjs';
export const CLOUD_TRANSFER_SCHEMA:'stellar-forge.cloud-artifact-transfer.v1';
export const CLOUD_TRANSFER_MANIFEST:'cloud-transfer.json';
export interface ArtifactSelectionInput {workspace:string;artifact:Artifact;id:string;file?:string;kind?:'summary'|'full';expectedSha256?:Sha256}
export function parseCloudTransfer(raw:Uint8Array,expectedTransferId?:Sha256):TransferSelection;
export function inspectCloudArtifact(input:{client:CloudClient;selection:ArtifactSelectionInput;signal?:AbortSignal}):
 Promise<{selection:TransferSelection;manifestSha256:Sha256;endpoint:string}>;
export function downloadCloudArtifact(input:{client:CloudClient;selection:TransferSelection;directory:string;
 signal?:AbortSignal;chunkSize?:number;onProgress?:(value:unknown)=>void}):Promise<TransferResult>;
export function reopenCloudArtifact(input:{directory:string;signal?:AbortSignal}):Promise<TransferResult>;
