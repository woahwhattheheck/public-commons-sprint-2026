// MIT. Complete original reviewer operation and retained-file client contracts.
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type UUID = string;
export type SHA256 = string;
export interface RequestOptions {requestSignal?:AbortSignal|null;timeoutMs?:number}
export interface ClientOptions {
  url:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal;
}
export interface Workspace {workspace:string}
export interface Action extends Workspace {requestId:UUID}
export interface Selection extends Workspace {selectionId:UUID}
export interface Change extends Selection {requestId:UUID;expectedRevision:number}
export interface ExportSelection extends Workspace {exportId:SHA256}
export interface FileIdentity {name:string;bytes:number;sha256:SHA256;contentType:string}
export interface ExportManifest {
  schema:'stellar-forge.grant-reviewer-merchant-export.v1';exportId:SHA256;
  workspace:string;workbenchId:UUID;kind:'native-response'|'source-document'|'saved-result'|'reviewer-packet';
  source:Record<string,Json>;files:FileIdentity[];
}
export interface RetainedResult<T=Json> extends Workspace {
  schema:'stellar-forge.grant-reviewer-merchant-result.v1';workbenchId:UUID;kind:ExportManifest['kind'];
  source:Record<string,Json>;exportId:SHA256|null;manifestSha256:SHA256;
  manifestFile:{name:'grant-reviewer-manifest.json';bytes:number;sha256:SHA256};files:FileIdentity[];
  retention:{state:'COMPLETE'}|{state:'FAILED';code:string;recovery:string};
  completeValue?:boolean;value?:T;preview?:Json;
}
export type Review = Action & {title:string} & (
  {source:'bundled'} |
  {source:'host';hostInput:string;expectedSha256?:SHA256} |
  {source:'upload';base64:string;expectedSha256:SHA256} |
  {source:'export';exportActionId:UUID}
);
export interface WorkbenchOpen extends Workspace {
  state:'OPEN';ownership:'OWNED'|'BORROWED';workbenchId:UUID;instanceId:UUID;url:string;selectionSha256:SHA256;
}
export interface WorkbenchRelease extends Workspace {
  state:'RELEASED';ownership:'OWNED'|'BORROWED';originalWorkbenchClosed:boolean;workbenchId:UUID|null;
}
export interface FileRange extends ExportSelection {
  file:string;expectedManifestSha256:SHA256;expectedSha256:SHA256;offset?:number;limit?:number;readId?:UUID;
}
export interface FileRangeResult extends ExportSelection {
  manifestSha256:SHA256;file:FileIdentity;readId:UUID;offset:number;bytesRead:number;
  encoding:'base64';data:string;nextOffset:number|null;
}
export interface FileManifest extends ExportSelection {
  state:'MANIFEST_RETAINED';manifest:ExportManifest;
  manifestFile:{name:'grant-reviewer-manifest.json';bytes:number;sha256:SHA256};
}
export interface JsonPage extends ExportSelection {
  file:string;expectedManifestSha256:SHA256;pointer?:string;offset?:number;limit?:number;
}
export interface JsonPageResult extends ExportSelection {
  manifestSha256:SHA256;file:string;pointer:string;type:string;offset:number;total:number;value?:Json;
  nextOffset:number|null;valueAvailableInOriginalFile?:boolean;message?:string;
}
export type SavedBuyerTool='bazaar_history'|'bazaar_results'|'bazaar_status'|'bazaar_read_result';
export interface ToolArguments {
  workspaces:Record<string,never>;schema:Record<string,never>;
  workbench_open:Workspace;workbench_release:Workspace;state:Workspace;selection:Selection;action:Action;
  review:Review;receive:Change;buyer_open:Change;buyer_close:Action;
  buyer_read:Workspace & {tool:SavedBuyerTool;arguments?:Record<string,Json>};
  buyer_result:Workspace & {quoteId:string};document:Selection & {index:number};export:Change;
  review_export:Action & {sourceWorkspace:string;exportId:SHA256;expectedManifestSha256:SHA256;title:string};
  manifest:ExportSelection;file:FileRange;file_release:ExportSelection & {readId:UUID};json:JsonPage;
}
export interface ToolResults {
  workspaces:Json;schema:Json;workbench_open:WorkbenchOpen;workbench_release:WorkbenchRelease;
  state:RetainedResult;selection:RetainedResult;action:RetainedResult;review:RetainedResult;
  receive:RetainedResult;buyer_open:RetainedResult;buyer_close:RetainedResult;buyer_read:RetainedResult;
  buyer_result:RetainedResult;document:RetainedResult;export:RetainedResult;review_export:RetainedResult;
  manifest:FileManifest;file:FileRangeResult;
  file_release:ExportSelection & {state:'RELEASED';readId:UUID};json:JsonPageResult;
}
export type PrefixedAction<K extends string> = `merchant_grant_reviewer_${K}`;
export interface ReviewerTransport {
  readonly endpoint:string;
  call<K extends keyof ToolArguments>(action:K|PrefixedAction<K>,args:ToolArguments[K],
    options?:RequestOptions):Promise<ToolResults[K]>;
}
export interface ReviewerClient extends ReviewerTransport {
  workspaces(args?:ToolArguments['workspaces'],options?:RequestOptions):Promise<ToolResults['workspaces']>;
  schema(args?:ToolArguments['schema'],options?:RequestOptions):Promise<ToolResults['schema']>;
  workbenchOpen(args:Workspace,options?:RequestOptions):Promise<WorkbenchOpen>;
  workbenchRelease(args:Workspace,options?:RequestOptions):Promise<WorkbenchRelease>;
  state(args:Workspace,options?:RequestOptions):Promise<RetainedResult>;
  selection(args:Selection,options?:RequestOptions):Promise<RetainedResult>;
  action(args:Action,options?:RequestOptions):Promise<RetainedResult>;
  review(args:Review,options?:RequestOptions):Promise<RetainedResult>;
  receive(args:Change,options?:RequestOptions):Promise<RetainedResult>;
  buyerOpen(args:Change,options?:RequestOptions):Promise<RetainedResult>;
  buyerClose(args:Action,options?:RequestOptions):Promise<RetainedResult>;
  buyerRead(args:ToolArguments['buyer_read'],options?:RequestOptions):Promise<RetainedResult>;
  buyerResult(args:ToolArguments['buyer_result'],options?:RequestOptions):Promise<RetainedResult>;
  document(args:ToolArguments['document'],options?:RequestOptions):Promise<RetainedResult>;
  export(args:Change,options?:RequestOptions):Promise<RetainedResult>;
  reviewExport(args:ToolArguments['review_export'],options?:RequestOptions):Promise<RetainedResult>;
  manifest(args:ExportSelection,options?:RequestOptions):Promise<FileManifest>;
  file(args:FileRange,options?:RequestOptions):Promise<FileRangeResult>;
  fileRelease(args:ToolArguments['file_release'],options?:RequestOptions):Promise<ToolResults['file_release']>;
  json(args:JsonPage,options?:RequestOptions):Promise<JsonPageResult>;
  reviewFile(args:ReviewFileOptions):Promise<RetainedResult>;
  readValue<T=Json>(args:ReadValueOptions):Promise<T>;
}
export type RemoteSelection=Partial<ClientOptions> & {client?:ReviewerTransport};
export interface ReviewFileOptions extends RemoteSelection,Action {
  file:string;title:string;expectedSha256?:SHA256;
}
export interface DownloadProgress {
  exportId:string;file:string;bytes:number;total:number;state:'DOWNLOADING';
}
export interface DownloadOptions extends RemoteSelection,ExportSelection {
  directory:string;expectedManifestSha256?:SHA256;chunkSize?:number;
  onProgress?:(progress:DownloadProgress)=>void|Promise<void>;
}
export interface DownloadReceipt extends ExportSelection {
  schema:'stellar-forge.grant-reviewer-file-receipt.v1';state:'COMPLETE'|'REOPENED';
  workbenchId:UUID;directory:string;manifestSha256:SHA256;files:number;bytes:number;
  kind:ExportManifest['kind'];source:Record<string,Json>;resumed?:boolean;resumedBytes?:number;
}
export type ReadValueOptions=RemoteSelection & {workspace?:string;result?:RetainedResult;
  exportId?:SHA256;file?:string;expectedManifestSha256?:SHA256};
export const reviewerActions:Readonly<Record<keyof ToolArguments,Readonly<{
  name:string;description:string;inputSchema:Json;annotations:Record<string,boolean>
}>>>;
export function openReviewerMerchantClient(options:ClientOptions):Promise<ReviewerClient>;
export function reviewReviewerFile(options:ReviewFileOptions):Promise<RetainedResult>;
export function downloadReviewerExport(options:DownloadOptions):Promise<DownloadReceipt>;
export function inspectReviewerExport(options:RemoteSelection & ExportSelection):Promise<{
  manifest:ExportManifest;manifestSha256:SHA256
}>;
export function reopenReviewerExport(options:ExportSelection & {directory:string;expectedManifestSha256?:SHA256}):Promise<DownloadReceipt>;
export function readReviewerValue<T=Json>(options:ReadValueOptions):Promise<T>;
