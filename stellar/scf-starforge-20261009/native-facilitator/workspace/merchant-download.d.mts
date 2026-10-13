/** Complete receiving of original native profiles and catalog views. */
import type {NativeOperatorIdentity,NativeCatalogExportMetadata,StellarNetwork} from './client.mjs';
export interface NativeExportFile {name:'profile.json'|'catalog.json';bytes:number;sha256:string}
export interface NativeProfileSelection {name:string;sha256:string}
export interface NativeExportCatalogSelection {runtimeId:string;expectedVersion:number;query?:string}
export type NativeExportRequest =
  | {schema:'stellar-forge.native-operator-export-request.v1';operator:string;exportId:string;kind:'profile';selection:NativeProfileSelection}
  | {schema:'stellar-forge.native-operator-export-request.v1';operator:string;exportId:string;kind:'catalog';selection:NativeExportCatalogSelection};
export interface NativeExportSource {
  operator:NativeOperatorIdentity;profile:NativeProfileSelection;network:StellarNetwork;
  catalog?:NativeCatalogExportMetadata & {resourceCount:number;pages:number};
}
export interface NativeOperatorExportManifest {
  schema:'stellar-forge.native-operator-export.v1';operator:string;exportId:string;kind:'profile'|'catalog';
  request:NativeExportRequest;requestSha256:string;capturedAt:string;source:NativeExportSource;files:NativeExportFile[];
}
export interface NativeRetainedClient {
  readonly endpoint:string;
  call(name:string,args:Record<string,unknown>,options?:{requestSignal?:AbortSignal|null;timeoutMs?:number}):Promise<Record<string,unknown>>;
}
export type NativeExportTransport =
  | {url:string;client?:never;tokenEnv?:string;environment?:Record<string,string|undefined>}
  | {client:NativeRetainedClient;url?:never;tokenEnv?:never;environment?:never};
export type NativeExportInspectOptions = NativeExportTransport & {operator:string;exportId:string;signal?:AbortSignal};
export interface NativeExportDownloadProgress {exportId:string;file:string;bytes:number;total:number;state:'DOWNLOADING'}
export type NativeExportDownloadOptions = NativeExportInspectOptions & {
  directory:string;expectedManifestSha256?:string;chunkSize?:number;
  onProgress?:(progress:NativeExportDownloadProgress)=>void|Promise<void>;
};
export interface NativeExportDownloadResult {
  schema:'stellar-forge.native-operator-download.v1';state:'COMPLETE';directory:string;operator:string;exportId:string;
  kind:'profile'|'catalog';source:NativeExportSource;manifestSha256:string;
  resumed:boolean;resumedBytes:number;files:number;bytes:number;
}
export function inspectNativeOperatorExport(options:NativeExportInspectOptions):
  Promise<{manifest:NativeOperatorExportManifest;manifestSha256:string}>;
export function downloadNativeOperatorExport(options:NativeExportDownloadOptions):Promise<NativeExportDownloadResult>;
