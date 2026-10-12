/** MIT. Typed access to the existing Research, SF74, SF97 and SF101 records. */
export type ResearchQuoteJson = null | boolean | number | string | ResearchQuoteJson[] | {[key:string]:ResearchQuoteJson};
export interface ResearchQuoteObject {[key:string]:ResearchQuoteJson}
export type ResearchQuoteActor = ResearchQuoteObject;
export type ResearchQuoteKind = 'CASE'|'BRIEF'|'RESPONSE'|'PUBLICATION'|'REALIZED';
export interface ResearchQuoteOptions {signal?:AbortSignal}
export interface ResearchQuotePage {
 offset?:number; limit?:number; snapshot?:string; dossierId?:string; kind?:ResearchQuoteKind;
}
export interface ResearchQuoteCaseQuery {q?:string;status?:string;dueOn?:string;offset?:number;limit?:number}
export interface ResearchQuoteCaseSelection {
 requestId:string;caseId:string;dossierId:string;revision:number;projectId:string;briefId:string;actor:ResearchQuoteActor;
}
export interface ResearchQuoteBriefSelection {
 requestId:string;caseId:string;caseRevision:string;quoteId:string;quoteSha256:string;
 dossierId:string;revision:number;projectId:string;briefId:string;merchant:string;
 scope:{component:'IMPLEMENTATION'|'RECURRING'|'ROUTE_USAGE'|'KEEP';unit:string;note:string};
 reason:string;actor:ResearchQuoteActor;
}
export interface ResearchQuoteResponseSelection {
 requestId:string;bindingId:string;caseRevision:string;responseId:string;revision:number;
 actor:ResearchQuoteActor;by:ResearchQuoteActor;
}
export interface ResearchQuotePublicationSelection {
 requestId:string;bindingId:string;dossierId:string;revision:number;deliveryId:string;
 title:string;summary:string;usage:string;
 sourceWorkspace?:null|{library:string;actor:string;requestId:string};
}
export interface ResearchQuoteReportSelection {
 requestId:string;bindingId:string;publicationId:string;purchaseIds:string[];revision:number;
 pricing:null|{profile:string;version:string;costEdition?:string};actor:ResearchQuoteActor;
}
export interface ResearchQuoteApplySelection {id:string;reviewSha256:string}
export type ResearchQuoteSelection = ResearchQuoteCaseSelection|ResearchQuoteBriefSelection|
 ResearchQuoteResponseSelection|ResearchQuotePublicationSelection|ResearchQuoteReportSelection;
export interface ResearchQuoteReview extends ResearchQuoteObject {reviewSha256:string}
export interface ResearchQuoteOperation {
 schema:'sf88-research-customer-quote-operation/v1';workspaceId:string;casesWorkspaceId:string;
 id:string;kind:ResearchQuoteKind;status:'PREPARING'|'REVIEWED'|'COMPLETE';
 request:ResearchQuoteObject;requestSha256:string;createdAt:string;
 review:ResearchQuoteReview|null;result:ResearchQuoteJson;
}
export interface ResearchQuoteOperationSummary {
 id:string;kind:ResearchQuoteKind;createdAt:string;dossierId:string|null;caseId:string|null;
 quoteId:string|null;status:'PREPARING'|'REVIEWED'|'COMPLETE';bindingId:string|null;
}
export interface ResearchQuoteInventory {
 schema:'sf88-research-customer-quote-operation/v1';workspaceId:string;snapshot:string;
 items:ResearchQuoteOperationSummary[];errors:{id:string;code:string}[];
 offset:number;limit:number;total:number;nextOffset:number|null;
}
export interface ResearchQuoteFile {name:string;bytes:number;sha256:string;contentType:string}
export interface ResearchQuoteFiles {
 schema:'sf88-research-customer-quotes/v1';workspaceId:string;id:string;files:ResearchQuoteFile[];
}
export interface ResearchQuoteFileMetadata {
 schema:'sf88-research-customer-quotes/v1';workspaceId:string;id:string;descriptor:ResearchQuoteFile;
}
export interface ResearchQuoteCaseIdentity extends ResearchQuoteObject {
 id:string;revision:string;
}
export interface ResearchQuoteCaseFileMetadata {
 schema:'sf88-research-customer-quotes/v1';workspaceId:string;caseId:string;
 case:ResearchQuoteCaseIdentity;descriptor:ResearchQuoteFile;
}
/** Preserves all original native fields; response bodies are not renamed or reduced. */
export interface ResearchQuoteNativeResponse<T=ResearchQuoteJson> {
 schema:'sf88-research-customer-quotes/v1';workspaceId:string;action:string;
 caseId?:string;profile?:string;result:T;binding?:ResearchQuoteJson;bindingSha256?:string;
}
export interface ResearchQuoteCaseList {
 enabled:boolean;cases:ResearchQuoteObject[];total:number;offset:number;limit:number;
 nextOffset:number|null;unavailable:ResearchQuoteJson;
}
export interface ResearchQuoteCaseView extends ResearchQuoteObject {
 case:ResearchQuoteCaseIdentity;revision:string;
}
export interface ResearchQuoteConfiguration {
 schema:'sf88-research-customer-quotes-host/v1';workspaceId:string;configurationFile:string|null;
 cases:{directory:string;workspaceId:string;identity:ResearchQuoteObject};
 pricing:Array<{id:string;label:string;config:string;directory:string;snapshot?:string;history?:string;
  nativeOutbox?:string;sourcePackage?:string;releaseStore?:string;releaseRuntime?:ResearchQuoteObject}>;
 merchants:{items:ResearchQuoteJson[];errors:ResearchQuoteJson[]};
}
export type ResearchQuoteCaseAction =
 'preview'|'save-draft'|'publish'|'receive'|'receive-pricing'|'compare'|'preview-implementation'|'adopt-implementation'|
 'receiving-status'|'receiving-capture'|'receiving-inspect'|'receiving-attach'|'receiving-case'|'receiving-restore'|
 'tariff-status'|'tariff-catalog'|'tariff-selection'|'tariff-capture'|'tariff-inspect'|'tariff-attach'|'tariff-case'|'tariff-restore';
export type ResearchQuotePricingAction =
 'state'|'preview'|'save'|'version'|'compare'|'planning-state'|'planning-preview'|'planning-save'|'planning-read'|
 'economics-state'|'economics-preview'|'economics-save'|'economics-edition'|'economics-proposal'|'economics-apply'|
 'repricing-source'|'repricing-preview'|'repricing-save'|'repricing-stage';
export interface ResearchQuoteDownloadOptions extends ResearchQuoteOptions {
 file:string;expectedSha256?:string;expectedBytes?:number;
}
export interface ResearchQuotePinnedDownloadOptions extends ResearchQuoteDownloadOptions {
 expectedSha256:string;expectedBytes:number;
}
/** Additional descriptor fields from the original streamed file publisher remain intact. */
export interface ResearchQuoteSavedFile {
 bytes:number;sha256:string;path?:string;file?:string;name?:string;filename?:string;contentType?:string;
 [key:string]:unknown;
}
export type ResearchQuoteDownload<M=ResearchQuoteFileMetadata|ResearchQuoteCaseFileMetadata> =
 ResearchQuoteSavedFile & {metadata:M};
export interface ResearchQuotesClient {
 configuration(options?:ResearchQuoteOptions):Promise<ResearchQuoteConfiguration>;
 listCases(query?:ResearchQuoteCaseQuery,options?:ResearchQuoteOptions):Promise<ResearchQuoteNativeResponse<ResearchQuoteCaseList>>;
 readCase(caseId:string,query?:{revision?:string},options?:ResearchQuoteOptions):Promise<ResearchQuoteNativeResponse<ResearchQuoteCaseView>>;
 createCase(input:ResearchQuoteCaseSelection,options?:ResearchQuoteOptions):Promise<ResearchQuoteOperation>;
 caseAction(caseId:string,action:ResearchQuoteCaseAction,input?:ResearchQuoteObject,options?:ResearchQuoteOptions):Promise<ResearchQuoteNativeResponse>;
 pricing(profile:string,action:ResearchQuotePricingAction,input?:ResearchQuoteObject,options?:ResearchQuoteOptions):Promise<ResearchQuoteNativeResponse>;
 prepare(input:ResearchQuoteBriefSelection,options?:ResearchQuoteOptions):Promise<ResearchQuoteOperation>;
 prepareResponse(input:ResearchQuoteResponseSelection,options?:ResearchQuoteOptions):Promise<ResearchQuoteOperation>;
 apply(input:ResearchQuoteApplySelection,options?:ResearchQuoteOptions):Promise<ResearchQuoteOperation>;
 preparePublication(input:ResearchQuotePublicationSelection,options?:ResearchQuoteOptions):Promise<ResearchQuoteOperation>;
 enrollPublication(input:ResearchQuoteApplySelection,options?:ResearchQuoteOptions):Promise<ResearchQuoteOperation>;
 prepareReport(input:ResearchQuoteReportSelection,options?:ResearchQuoteOptions):Promise<ResearchQuoteOperation>;
 list(query?:ResearchQuotePage,options?:ResearchQuoteOptions):Promise<ResearchQuoteInventory>;
 operation(id:string,options?:ResearchQuoteOptions):Promise<ResearchQuoteOperation>;
 files(id:string,options?:ResearchQuoteOptions):Promise<ResearchQuoteFiles>;
 fileInfo(id:string,name:string,options?:ResearchQuoteOptions):Promise<ResearchQuoteFileMetadata>;
 caseFileInfo(caseId:string,input:ResearchQuoteObject,options?:ResearchQuoteOptions):Promise<ResearchQuoteCaseFileMetadata>;
 tariffFileInfo(caseId:string,input:ResearchQuoteObject,options?:ResearchQuoteOptions):Promise<ResearchQuoteCaseFileMetadata>;
 download(id:string,name:string,options:ResearchQuotePinnedDownloadOptions):Promise<ResearchQuoteDownload<ResearchQuoteFileMetadata>>;
 downloadCase(caseId:string,input:ResearchQuoteObject,options:ResearchQuoteDownloadOptions):Promise<ResearchQuoteDownload<ResearchQuoteCaseFileMetadata>>;
 downloadTariff(caseId:string,input:ResearchQuoteObject,options:ResearchQuoteDownloadOptions):Promise<ResearchQuoteDownload<ResearchQuoteCaseFileMetadata>>;
}
export interface ResearchQuotesTransport {
 /** Raw callbacks are called only within the single accepted run below. */
 request(route:string,input?:ResearchQuoteObject,options?:ResearchQuoteOptions):Promise<unknown>;
 download(route:string,file:string,options:ResearchQuoteOptions&{expectedSha256?:string;request?:ResearchQuoteObject}):Promise<ResearchQuoteSavedFile>;
 run<T>(work:()=>Promise<T>):Promise<T>;
}
export declare const RESEARCH_QUOTES_CASE_ACTIONS:readonly ResearchQuoteCaseAction[];
export declare const RESEARCH_QUOTES_PRICING_ACTIONS:readonly ResearchQuotePricingAction[];
export declare function captureResearchQuoteInput(value:object):ResearchQuoteObject;
export declare function validateResearchQuoteOperation(value:unknown,selection?:{
 requestId?:string;kind?:ResearchQuoteKind;input?:object;reviewSha256?:string;
}):ResearchQuoteOperation;
export declare function createResearchQuotesClient(transport:ResearchQuotesTransport):ResearchQuotesClient;
