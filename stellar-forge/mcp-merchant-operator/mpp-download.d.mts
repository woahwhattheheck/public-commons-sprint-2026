export interface MppFileManifest {
  schema:'stellar-forge.mpp-file-export.v1';exportId:string;createdAt:string;
  source:{kind:'response'|'contract'|'openapi'|'package';console:string;workspaceIdentity:string;sha256:string;
    profileId?:string;purchaseId?:string;contractSha256?:string;offerId?:string;
    transaction?:string;receipt?:Record<string,unknown>;accounting?:Record<string,unknown>};
  files:Array<{name:string;bytes:number;sha256:string;contentType:string}>;
}
export interface MppDownloadOptions {url:string;exportId:string;tokenEnv?:string;
  environment?:Record<string,string|undefined>;signal?:AbortSignal}
export function inspectMppDownload(options:MppDownloadOptions):Promise<{manifest:MppFileManifest;manifestSha256:string}>;
export function downloadMppExport(options:MppDownloadOptions & {directory:string;chunkSize?:number;
  expectedManifestSha256?:string;onProgress?:(progress:Record<string,unknown>)=>void}):Promise<Record<string,unknown>>;
