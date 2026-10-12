// MIT. Typed merchant access and complete saved-publisher receiving.
import type {
  PublisherClient,PublisherRequest,PublisherState,PublisherReview,PublisherUpload,PublisherComparison,ExactJSONObject
} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/operator/client.mjs';

export type PublisherAlias=string;
export type PublisherDigest=string;
export type PublisherFileKind='source'|'registry'|'capture'|'transport'|'decisions'|'handoff';
export type PublisherInventoryKind='datasets'|'editions'|'decisions'|'candidates'|'requests'|'native-builds'|'native-comparisons';
export interface MerchantRequestOptions {
  readonly requestSignal?:AbortSignal|null;
  readonly timeoutMs?:number;
}
export interface PublisherMerchantConnection {
  /** One alias declared in the host's private publisher-workspaces configuration. */
  readonly workspace:PublisherAlias;
  /** Original HTTPS or loopback HTTP MCP endpoint, without query or fragment. */
  readonly url:string;
  readonly tokenEnv?:string;
  readonly environment?:Readonly<Record<string,string|undefined>>;
  readonly signal?:AbortSignal;
}
export interface PublisherFileHandle {
  readonly file:string;
  readonly kind:PublisherFileKind;
  readonly sha256:PublisherDigest|null;
}
export interface PublisherConfiguredWorkspace {
  readonly workspace:PublisherAlias;
  readonly label:string;
  readonly expectedWorkspaceId:string|null;
  readonly files:readonly PublisherFileHandle[];
}
export interface PublisherWorkspaceInventory {
  readonly configured:true;
  readonly workspaces:readonly PublisherConfiguredWorkspace[];
  readonly connected:readonly PublisherAlias[];
  readonly closing:boolean;
  readonly retainedReads:unknown;
}
export interface PublisherMerchantStatus {
  readonly workspace:PublisherAlias;
  readonly workspaceId:string;
  readonly schema:'stellar-forge.360giving-operator.v1';
  readonly label:string;
  readonly counts:Readonly<Record<'datasets'|'editions'|'decisions'|'candidates'|'requests',number>>;
  readonly numericEncoding:'original-json-number-tokens-as-strings';
}
export interface PublisherInventoryPage<T=ExactJSONObject> {
  readonly workspace:PublisherAlias;
  readonly kind?:PublisherInventoryKind;
  readonly dataset?:string;
  readonly total:number;
  readonly snapshot:PublisherDigest;
  readonly offset:number;
  readonly items:readonly T[];
  readonly nextOffset:number|null;
}
export interface PublisherPageSelection {
  readonly offset?:number;
  readonly limit?:number;
  /** Required on every page after offset zero. */
  readonly expectedSnapshot?:PublisherDigest;
}
export type PublisherInventorySelection=PublisherPageSelection&(
  |{readonly kind:'datasets'|'editions'|'decisions'|'candidates'|'requests';readonly dataset?:never}
  |{readonly kind:'native-builds'|'native-comparisons';readonly dataset:string}
);
export interface PublisherIntakeSelection {
  readonly requestId:string;
  readonly dataset:string;
  readonly label:string;
  readonly sourceUrl:string;
  readonly source:PublisherDigest;
  readonly registry:PublisherDigest;
  readonly capture?:PublisherDigest;
  readonly transport?:PublisherDigest;
}
export interface PublisherExportSelection {
  readonly requestId:string;
  readonly edition:PublisherDigest;
  readonly decision?:PublisherDigest;
  readonly candidate?:PublisherDigest;
}
export interface PublisherHandoffSelection {
  readonly requestId:string;
  readonly edition:PublisherDigest;
  readonly decision:PublisherDigest|null;
  readonly candidate:PublisherDigest|null;
}
export interface PublisherChangesSelection {
  readonly dataset:string;
  readonly comparison:PublisherDigest;
}
export interface PublisherRetainedFile {
  readonly name:'360giving-complete-handoff.zip'|'360giving-complete-changes.jsonl';
  readonly bytes:number;
  readonly sha256:PublisherDigest;
  readonly contentType:'application/zip'|'application/x-ndjson';
}
export interface PublisherManifestFile {
  readonly name:'360giving-manifest.json';
  readonly bytes:number;
  readonly sha256:PublisherDigest;
  readonly contentType:'application/json';
}
export type PublisherDeliveryIdentity=
  |{readonly kind:'handoff';readonly selection:PublisherHandoffSelection}
  |{readonly kind:'changes';readonly selection:PublisherChangesSelection};
export type PublisherRetainedDelivery=PublisherDeliveryIdentity&{
  readonly state:'FILES_RETAINED';
  readonly exportId:PublisherDigest;
  readonly workspace:PublisherAlias;
  readonly workspaceId:string;
  readonly files:readonly [PublisherRetainedFile];
  readonly manifestSha256:PublisherDigest;
  readonly manifestFile:PublisherManifestFile;
};
export type PublisherManifestDescriptor=Omit<PublisherRetainedDelivery,'state'>&{readonly state:'MANIFEST_RETAINED'};
export type PublisherDeliveryManifest=PublisherDeliveryIdentity&{
  readonly schema:'stellar-forge.360giving-merchant-export.v1';
  readonly exportId:PublisherDigest;
  readonly workspace:{readonly alias:PublisherAlias;readonly id:string};
  /** Complete original native export request or comparison; numeric tokens stay strings. */
  readonly original:PublisherRequest|PublisherComparison;
  readonly files:readonly [PublisherRetainedFile];
};
export interface PublisherMerchantRequest {
  readonly workspace:PublisherAlias;
  readonly workspaceId?:string;
  readonly request:PublisherRequest;
  /** A completed export call retains this delivery; request() alone reads its native record. */
  readonly delivery?:PublisherRetainedDelivery;
}
export type PublisherReceiveSelection={readonly requestId:string}&(
  |{readonly file:string;readonly exportId?:never;readonly fromWorkspace?:never}
  |{readonly exportId:PublisherDigest;readonly fromWorkspace?:PublisherAlias;readonly file?:never}
);
export interface PublisherFileReadSelection {
  readonly exportId:PublisherDigest;
  readonly file:PublisherRetainedFile['name']|PublisherManifestFile['name'];
  readonly expectedManifestSha256:PublisherDigest;
  readonly expectedSha256:PublisherDigest;
  readonly readId?:string;
  readonly offset?:number;
  /** Native retained chunks are 1–196608 bytes. */
  readonly limit?:number;
}
export interface PublisherFileChunk {
  readonly workspace:PublisherAlias;
  readonly exportId:PublisherDigest;
  readonly manifestSha256:PublisherDigest;
  readonly readId:string;
  readonly file:{readonly name:string;readonly contentType:string;readonly bytes:number;readonly sha256:PublisherDigest};
  readonly offset:number;
  readonly bytesRead:number;
  readonly nextOffset:number|null;
  readonly encoding:'base64';
  readonly data:string;
}
export interface PublisherMerchantClient {
  readonly workspace:PublisherAlias;
  /** Stable original endpoint plus its publisher alias; used by complete download checkpoints. */
  readonly endpoint:string;
  call(name:string,args?:Readonly<Record<string,unknown>>,options?:MerchantRequestOptions):Promise<unknown>;
  workspaces(args?:Readonly<Record<string,never>>,options?:MerchantRequestOptions):Promise<PublisherWorkspaceInventory>;
  status(args?:Readonly<Record<string,never>>,options?:MerchantRequestOptions):Promise<PublisherMerchantStatus>;
  inventory(options:PublisherInventorySelection,requestOptions?:MerchantRequestOptions):Promise<PublisherInventoryPage>;
  review(options:{readonly edition:string;readonly decision?:string},requestOptions?:MerchantRequestOptions):
    Promise<{readonly workspace:PublisherAlias;readonly result:PublisherReview}>;
  upload(options:{readonly file:string},requestOptions?:MerchantRequestOptions):
    Promise<{readonly workspace:PublisherAlias;readonly file:string;readonly kind:PublisherFileKind;readonly result:PublisherUpload}>;
  uploadText(options:{readonly text:string},requestOptions?:MerchantRequestOptions):
    Promise<{readonly workspace:PublisherAlias;readonly result:PublisherUpload}>;
  intake(options:PublisherIntakeSelection,requestOptions?:MerchantRequestOptions):Promise<PublisherMerchantRequest>;
  decisions(options:{readonly requestId:string;readonly edition:string;readonly object:string},requestOptions?:MerchantRequestOptions):Promise<PublisherMerchantRequest>;
  candidate(options:{readonly requestId:string;readonly edition:string;readonly decision:string},requestOptions?:MerchantRequestOptions):Promise<PublisherMerchantRequest>;
  build(options:{readonly requestId:string;readonly edition:string;readonly candidate?:string},requestOptions?:MerchantRequestOptions):Promise<PublisherMerchantRequest>;
  query(options:Parameters<PublisherClient['query']>[0],requestOptions?:MerchantRequestOptions):
    Promise<{readonly workspace:PublisherAlias;readonly result:Awaited<ReturnType<PublisherClient['query']>>}>;
  compare(options:{readonly requestId:string;readonly dataset:string;readonly before:string;readonly after:string},requestOptions?:MerchantRequestOptions):Promise<PublisherMerchantRequest>;
  changes(options:Parameters<PublisherClient['changes']>[0],requestOptions?:MerchantRequestOptions):
    Promise<{readonly workspace:PublisherAlias;readonly result:Awaited<ReturnType<PublisherClient['changes']>>}>;
  request(requestId:string,options?:MerchantRequestOptions):Promise<PublisherMerchantRequest>;
  resume(requestId:string,options?:MerchantRequestOptions):Promise<PublisherMerchantRequest>;
  /** Polls only the same accepted ID; original interrupted admissions may enter their queued continuation. */
  wait(requestId:string,options?:{readonly timeoutMs?:number;readonly pollMs?:number;readonly signal?:AbortSignal}):Promise<PublisherMerchantRequest>;
  export(options:PublisherExportSelection,requestOptions?:MerchantRequestOptions):Promise<PublisherMerchantRequest>;
  changesExport(options:PublisherChangesSelection,requestOptions?:MerchantRequestOptions):Promise<PublisherRetainedDelivery>;
  exports(options?:PublisherPageSelection,requestOptions?:MerchantRequestOptions):Promise<PublisherInventoryPage<PublisherRetainedDelivery>>;
  manifest(options:{readonly exportId:PublisherDigest},requestOptions?:MerchantRequestOptions):Promise<PublisherManifestDescriptor>;
  file(options:PublisherFileReadSelection,requestOptions?:MerchantRequestOptions):Promise<PublisherFileChunk>;
  fileRelease(options:{readonly exportId:PublisherDigest;readonly readId:string},requestOptions?:MerchantRequestOptions):
    Promise<{readonly workspace:PublisherAlias;readonly exportId:PublisherDigest;readonly readId:string;readonly state:'RELEASED'}>;
  receive(options:PublisherReceiveSelection,requestOptions?:MerchantRequestOptions):Promise<PublisherMerchantRequest>;
  /** Cancels and drains this caller's HTTP requests and waits; publisher ownership remains with Applications. */
  close():Promise<void>;
}
export interface PublisherDownloadProgress {
  readonly exportId:PublisherDigest;
  readonly file:string;
  readonly bytes:number;
  readonly total:number;
  readonly state:'DOWNLOADING';
}
export type PublisherDownloadConnection=
  |{readonly client:PublisherMerchantClient;readonly workspace?:PublisherAlias;readonly url?:never}
  |PublisherMerchantConnection&{readonly client?:never};
export type PublisherDownloadOptions=PublisherDownloadConnection&{
  readonly exportId:PublisherDigest;
  /** Reuse this private directory to continue its complete original file checkpoint. */
  readonly directory:string;
  readonly signal?:AbortSignal;
  readonly chunkSize?:number;
  readonly expectedManifestSha256?:PublisherDigest;
  readonly onProgress?:(progress:PublisherDownloadProgress)=>void|Promise<void>;
};
export type PublisherDownloadResult=PublisherDeliveryIdentity&{
  readonly schema:'stellar-forge.360giving-merchant-download.v1';
  readonly state:'COMPLETE';
  readonly directory:string;
  readonly exportId:PublisherDigest;
  readonly workspace:{readonly alias:PublisherAlias;readonly id:string};
  readonly manifestSha256:PublisherDigest;
  readonly resumed:boolean;
  readonly resumedBytes:number;
  readonly files:number;
  readonly bytes:number;
};
export function open360GivingMerchantClient(options:PublisherMerchantConnection):Promise<PublisherMerchantClient>;
export function download360GivingExport(options:PublisherDownloadOptions):Promise<PublisherDownloadResult>;
export function inspect360GivingExport(options:PublisherDownloadConnection&{readonly exportId:PublisherDigest;readonly signal?:AbortSignal}):
  Promise<{readonly manifest:PublisherDeliveryManifest;readonly manifestSha256:PublisherDigest}>;
