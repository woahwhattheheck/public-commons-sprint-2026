// MIT. Original Matomo artifacts through the maintained native file writer.
import type {MatomoClient,MatomoArtifactFile} from './client.mjs';
export const MATOMO_TRANSFER_SCHEMA:'stellar-forge.matomo-artifact-transfer.v1';
export const MATOMO_TRANSFER_MANIFEST:'matomo-transfer.json';
export type MatomoArtifact = 'capture'|'edition'|'database'|'comparison'|'delivery'|'handover'|'source'|'workspace-origin'|'workspace-archive'|'workspace-original';
export type MatomoArtifactKind = 'csv'|'config'|'manifest'|'archive'|'scan';
export interface MatomoArtifactSelection {
 workspace:string;artifact:MatomoArtifact;id:string;kind?:MatomoArtifactKind;expectedSha256?:string;
}
export interface MatomoTransferSource {
 workspace:string;workspaceId:string;workspaceIdentity:string;artifact:MatomoArtifact;id:string;
 kind:MatomoArtifactKind|null;file:MatomoArtifactFile;
}
/** Client-created transfer selection; never a provider or payment receipt. */
export interface MatomoTransfer {
 schema:typeof MATOMO_TRANSFER_SCHEMA;transferId:string;
 provenance:'CLIENT_SELECTION_OF_ORIGINAL_MATOMO_ARTIFACT';
 source:MatomoTransferSource;files:[{name:'payload';bytes:number;sha256:string}];
}
export interface MatomoInspectedArtifact {
 selection:MatomoTransfer;manifestSha256:string;endpoint:string;
}
export interface MatomoArtifactDownload {
 schema:'stellar-forge.matomo-artifact-download.v1';state:'COMPLETE';directory:string;
 exportId:string;source:MatomoTransferSource;payload:'payload';manifestSha256:string;
 files:number;bytes:number;resumed?:boolean;resumedBytes?:number;reopened?:boolean;
}
export interface MatomoDownloadProgress {
 exportId:string;file:string;bytes:number;total:number;state:'DOWNLOADING';
}
export function parseMatomoTransfer(raw:Uint8Array,expectedTransferId?:string):MatomoTransfer;
export function inspectMatomoArtifact(options:{
 client:MatomoClient;selection:MatomoArtifactSelection;signal?:AbortSignal;
}):Promise<MatomoInspectedArtifact>;
export function downloadMatomoArtifact(options:{
 client:MatomoClient;selection:MatomoTransfer;directory:string;signal?:AbortSignal;chunkSize?:number;
 onProgress?:(progress:MatomoDownloadProgress)=>void|Promise<void>;
}):Promise<MatomoArtifactDownload>;
export function reopenMatomoArtifact(options:{directory:string;signal?:AbortSignal}):Promise<MatomoArtifactDownload>;
