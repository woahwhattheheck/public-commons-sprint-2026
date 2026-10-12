/** Original Woo ERP store/client interface. Native IDs and hashes remain strings. */
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export interface McpClient {
 endpoint:string;
 call(name:string,args:Record<string,unknown>,options?:{timeoutMs?:number;requestSignal?:AbortSignal|null}):Promise<any>;
}
export interface ClientOptions {
 store:string;url?:string;client?:McpClient;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal;
}
export interface PageArguments {
 pointer?:string;offset?:number;limit?:number;expectedSnapshotSha256?:string;
}
export interface ValueChild {key:string;pointer:string;type:string;children?:number;length?:number;value?:Json}
export interface ValuePage {
 snapshotSha256:string;pointer:string;type:string;offset:number;limit?:number;total:number;nextOffset:number|null;
 rows?:ValueChild[];text?:string;units?:'utf16';value?:Json;
}
export interface InputDescriptor {input:string;label:string;kind:'mapping'|'project'}
export interface NativeOrderSummary {
 schema:'stellar-forge.sf104.erp-order-view.v1';operationId:string;orderId:string;storeNamespace:string;externalReference:string;
 revision:number;state:string;currentEditionId:string;approvedEditionId:string|null;recordSha256:string;observedAt:string;
 sourceStatus:Record<string,Json>;issuesPreview:string[];issueCount:number;edition:Record<string,Json>;
 approval:Record<string,Json>|null;pendingWrite:Record<string,Json>|null;target:Record<string,Json>|null;
 counts:{editions:number;attempts:number;decisions:number;imports:number};pointers:Record<string,string>;
 imported:boolean;importNeedsReconcile:boolean;reused?:boolean;
}
export interface MappingSummary {
 mapId:string;schema:string;createdAt:string;createdBy:number;storeNamespace:string;currency:string;reviewOwner:string;
 check:Json;checkHistoryCount:number;snapshotSha256:string;pointer:'';
}
export interface NativeError {code?:string;message?:string;data?:Json;[key:string]:unknown}
export interface NativeReply<T> {store:string;httpStatus?:number;native:T|NativeError}
export interface ExportSelection {kind:'mapping'|'project';id:string;exportId:string}
export interface FileIdentity {name:string;bytes:number;sha256:string}
export interface ErpManifest extends ExportSelection {
 schema:'stellar-forge.sf104.erp-file-export.v1';store:string;siteUrl:string;nativeSha256:string;revision:number|null;files:[FileIdentity];
}
export interface ExportManifestReply extends ExportSelection {
 store:string;state:'MANIFEST_RETAINED';manifest:ErpManifest;manifestSha256:string;manifestFile:FileIdentity;
}
export interface FileReadReply extends ExportSelection {
 store:string;manifestSha256:string;readId:string;file:FileIdentity;offset:number;bytesRead:number;nextOffset:number|null;encoding:'base64';data:string;
}
export interface OperationRevision {operationId:string;expectedRevision:number}
export interface Commands {
 'inputs':{};
 'input':PageArguments&{input:string};
 'status':Omit<PageArguments,'pointer'>;
 'mapping':PageArguments&{mapId:string};
 'mapping-save':{input:string;expectedSha256:string;expectedCurrentMapId:string};
 'mapping-select':{mapId:string;expectedCurrentMapId:string};
 'mapping-check':{mapId:string};
 'orders':{q?:string;state?:string;page?:number;limit?:number};
 'inspect':{operationId:string};
 'read':PageArguments&{operationId:string};
 'prepare':{orderId:string;mapId?:string;expectedRevision:number};
 'approve':OperationRevision&{editionId:string;reason:string;targetBaselineSha256?:string};
 'deliver':OperationRevision&{editionId:string};
 'reconcile':OperationRevision;
 'identify-target':OperationRevision&{targetBaselineSha256:string;reason:string;confirmOperationEnded?:true;providerOutcome?:string};
 'authorize-retry':OperationRevision&{confirmOperationEnded:true;confirmNoOrder:true;reason:string;providerOutcome:string};
 'bind-import':OperationRevision&{reason:string};
 'export':({kind:'project';expectedRevision:number}|{kind:'mapping';expectedRevision?:never})&Omit<ExportSelection,'kind'>;
 'export-manifest':ExportSelection;
 'export-file':ExportSelection&{file:'manifest.json'|'project.json'|'mapping.json';expectedManifestSha256:string;expectedSha256?:string;readId?:string;offset?:number;limit?:number};
 'export-file-release':ExportSelection&{readId:string};
 'import':{input:string;expectedSha256:string};
 'import-export':{fromStore:string;id:string;exportId:string;expectedManifestSha256:string};
}
export interface Replies {
 'inputs':{store:string;inputs:InputDescriptor[]};
 'input':{store:string;input:string;label:string;kind:'mapping'|'project';file:{bytes:number;sha256:string};operationId?:string;revision?:number;nativeSha256?:string;value:ValuePage};
 'status':{store:string;native:Record<string,Json>;selectedMap:MappingSummary|null;maps:ValuePage};
 'mapping':{store:string;native:MappingSummary;value:ValuePage};
 'mapping-save':NativeReply<MappingSummary>;
 'mapping-select':NativeReply<MappingSummary>;
 'mapping-check':NativeReply<MappingSummary>;
 'orders':{store:string;native:{orders:Record<string,Json>[];page:number;limit:number;total:number;pages:number}};
 'inspect':NativeReply<NativeOrderSummary>;
 'read':{store:string;operationId:string;revision:number;observedAt:string;sourceStatus:Record<string,Json>;value:ValuePage};
 'prepare':NativeReply<NativeOrderSummary>;
 'approve':NativeReply<NativeOrderSummary>;
 'deliver':NativeReply<NativeOrderSummary>;
 'reconcile':NativeReply<NativeOrderSummary>;
 'identify-target':NativeReply<NativeOrderSummary>;
 'authorize-retry':NativeReply<NativeOrderSummary>;
 'bind-import':NativeReply<NativeOrderSummary>;
 'export':ExportManifestReply;
 'export-manifest':ExportManifestReply;
 'export-file':FileReadReply;
 'export-file-release':ExportSelection&{store:string;released:string};
 'import':NativeReply<NativeOrderSummary>;
 'import-export':NativeReply<NativeOrderSummary>;
}
export interface DownloadOptions extends ExportSelection {
 directory:string;expectedManifestSha256:string;chunkSize?:number;signal?:AbortSignal;
 onProgress?:(value:{exportId:string;file:string;bytes:number;total:number;state:'DOWNLOADING'})=>void|Promise<void>;
}
export interface ReceivedNative {
 schema:string;operationId?:string;orderId?:string;revision?:number;sha256:string;mapId?:string;
 mappings?:number;editions?:number;attempts?:number;decisions?:number;
}
export interface DownloadResult extends ExportSelection {
 schema:'stellar-forge.sf104.erp-download.v1';store:string;state:'COMPLETE';directory:string;
 manifestSha256:string;nativeSha256:string;revision:number|null;resumed:boolean;resumedBytes:number;files:number;bytes:number;native:ReceivedNative;
}
export interface WooErpClient {
 readonly store:string;readonly endpoint:string;
 call<C extends keyof Commands>(command:C,args:Commands[C],options?:{timeoutMs?:number;requestSignal?:AbortSignal|null}):Promise<Replies[C]>;
 inspectExport(selection:ExportSelection):Promise<{manifest:ErpManifest;manifestSha256:string}>;
 download(options:DownloadOptions):Promise<DownloadResult>;
}
export const wooErpClientOperations:Readonly<Record<keyof Commands,string>>;
export function openWooErpClient(options:ClientOptions):Promise<WooErpClient>;
export function inspectReceivedWooErp(options:{
 directory:string;expectedManifestSha256:string;store?:string;kind?:'mapping'|'project';id?:string;exportId?:string;
}):Promise<{schema:'stellar-forge.sf104.erp-received.v1';state:'COMPLETE';directory:string;manifest:ErpManifest;manifestSha256:string;file:FileIdentity&{path:string};native:ReceivedNative}>;
