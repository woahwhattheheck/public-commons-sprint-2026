export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type ObjectValue = {[key:string]:unknown};
export type SourceMode = 'NATIVE_HTTP' | 'IMPORTED_HTTP_RESPONSES' | 'IMPORTED_PUBLIC_ATTACHMENT';
export type Calculation = 'level' | 'difference' | 'percent-change' | 'index-100';
export type ReportFormat = 'json' | 'csv' | 'html';
export interface Page {offset:number;limit:number;total:number;returned:number;next:number|null}
export interface SourceSelection {title?:string;seriesIds:string[]}
export interface SourceReceipt {
 method:'GET';url:string;finalUrl:string;status:number|null;bytes:number;sha256:string;
 startedAt?:string;receivedAt?:string;completedAt:string;headers:Record<string,string>;
 retryAt?:string|null;redirects?:ObjectValue[];transport?:ObjectValue;
}
export interface Capture {
 schema:'stellar-forge.dbnomics-capture.v1';captureId:string;selection:SourceSelection;sourceMode:SourceMode;
 terms:ObjectValue;responses:Array<{receipt:SourceReceipt;contentBase64:string}>;[key:string]:unknown;
}
export interface SourceSeries {
 id:string;provider:string;dataset:string;code:string;name:string;frequency:string;
 dimensions:Record<string,Json>;sourceUpdatedAt:string|null;indexedAt:string|null;
 metadata:ObjectValue;rowCount:number;missing:number;responseSha256:string;
}
export interface Observation {
 observationId:string;seriesId:string;provider:string;dataset:string;seriesCode:string;seriesName:string;
 frequency:string;period:string;periodStartDay:string|null;periodOrdinal:number|null;calendarIssue:string|null;
 sourceIndex:number;value:number|null;valueText:string;missing:boolean;missingReason:string|null;
 dimensions:Record<string,Json>;attributes:Record<string,Json>;sourceUpdatedAt:string|null;
 responseSha256:string;captureId:string;
}
export interface CaptureView {
 captureId:string;captureSha256:string;selection:SourceSelection;sourceMode:SourceMode;
 terms:ObjectValue;receipts:SourceReceipt[];retrievedAt:string;retrievalWindow:{from:string;to:string};
 series:SourceSeries[];metadata:ObjectValue[];rowCount:number;missing:number;
}
export interface ObservationPage {
 captureId:string;captureSha256:string;records:Observation[];page:Page;
}
export interface PageOptions {offset?:number;limit?:number}
export interface ObservationOptions extends PageOptions {seriesId?:string;search?:string}
export interface Note {id:string;observationId:string|null;author:string;tag?:string;text:string}
export interface Notes {
 schema:'stellar-forge.dbnomics-notes.v1';captureId:string;revision:number;
 entries:Note[];sha256:string|null;captureSha256?:string;operationId?:string;createdAt?:string;
}
export interface ReportSpec {
 title?:string;seriesIds?:string[];method?:Calculation;lag?:number;start?:string|null;end?:string|null;
 basePeriod?:string|null;note?:string;
}
export interface ReportRow extends Observation {
 sourceValue:number|null;calculatedValue:number|null;calculation:Calculation;calculationReason:string|null;
 basePeriod:string|null;baseObservationId:string|null;baseValue:number|null;precision:string;
}
export interface Report {
 schema:'stellar-forge.dbnomics-report.v1';reportId:string;captureId:string;captureSha256:string;
 spec:ReportSpec;series:ObjectValue[];rows:ReportRow[];rowCount:number;missingCalculations:number;
 notesRevision:number;notesSha256:string|null;analystNotes:Note[];sourceReceipts:SourceReceipt[];
 terms:ObjectValue;methodology:string;createdAt:string;sha256:string;page?:Page;
}
export interface SavedQuery {
 captureId:string;seriesIds?:string[];start?:string|null;end?:string|null;includeMissing?:boolean;
 analysis?:ReportSpec|null;review:{reviewer:string;note:string};
}
export interface Operation {
 id:string;kind:string;createdAt:string;inputHash:string;state:'PREPARED'|'RETURNED_ERROR'|'COMPLETE';
 result:ObjectValue|null;error:ObjectValue|null;active:boolean;
}
export interface FileResult {bytes:Uint8Array;mediaType:string|null;contentDisposition:string|null}
export interface Acquisition {
 id:string;selection:SourceSelection;rights?:ObjectValue;timeoutMs?:number;
}
export interface Discovery {
 kind:'providers'|'provider'|'datasets'|'dataset'|'search'|'series';
 provider?:string;dataset?:string;query?:string;limit?:number;offset?:number;dimensions?:Record<string,string[]>;
}
export interface AnalysisSelection {captureId:string;captureSha256:string;reportIds:string[];notesRevision:number;title:string}
export interface AnalysisSource {
 id:string;directory:string;documentId:string;manifestSha256:string;selection:AnalysisSelection;
 sourceBundleSha256:string;rowCount:number;counts:{observation:number;calculation:number;series:number;note:number};
 files:Array<{path:string;bytes:number;sha256:string;contentType:string}>;
}
export interface Client {
 readonly origin:string;
 status():Promise<ObjectValue>;
 source():Promise<ObjectValue>;
 operation(id:string):Promise<Operation>;
 discover(input:Discovery):Promise<ObjectValue>;
 acquire(input:Acquisition):Promise<ObjectValue>;
 refresh(input:{id:string;captureId:string;timeoutMs?:number}):Promise<ObjectValue>;
 importExample(id:string):Promise<ObjectValue>;
 importCapture(input:{id:string;capture:Capture}|{id:string;manifest:ObjectValue;files:Record<string,string>}):Promise<ObjectValue>;
 capture(id:string):Promise<CaptureView>;
 observations(id:string,options?:ObservationOptions):Promise<ObservationPage>;
 facets(id:string,options?:{field?:'seriesId'|'frequency'|'missingReason'|'provider'|'dataset';limit?:number}):Promise<ObjectValue>;
 compare(before:string,after:string,options?:PageOptions):Promise<ObjectValue & {page:Page}>;
 notes(id:string,revision?:number):Promise<Notes>;
 saveNotes(input:{id:string;captureId:string;expectedRevision:number;entries:Note[]}):Promise<Notes & {replayed:boolean}>;
 saveReport(input:{id:string;captureId:string;spec:ReportSpec;notesRevision?:number}):Promise<ObjectValue>;
 report(id:string,options?:PageOptions):Promise<Report>;
 reportFile(id:string,format?:ReportFormat):Promise<FileResult>;
 captureFile(id:string):Promise<FileResult>;
 originalResponse(id:string,index?:number):Promise<FileResult>;
 exportSources():Promise<ObjectValue>;
 analysisSource(input:{id:string;selection:AnalysisSelection}):Promise<AnalysisSource>;
 analysisSourceFile(id:string):Promise<FileResult>;
 importSources(input:{id:string;bundle:ObjectValue}):Promise<ObjectValue>;
 saveQuery(input:{id:string;name:string;query:SavedQuery;expectedHash:string}):Promise<ObjectValue>;
 planTemplate(name:string):Promise<ObjectValue>;
 savePublicationPlan(input:{id:string;plan:ObjectValue}):Promise<ObjectValue>;
 extract(input:{id:string;planId:number}):Promise<{id:string;state:string;replayed:boolean}>;
 inspect(id:string,query?:string):Promise<ObjectValue>;
 cancel(id:string):Promise<ObjectValue>;
 review(id:string,input:{reviewer:string;note:string;initialize?:boolean;expectedSnapshot?:string;expectedRevision?:number}):Promise<ObjectValue>;
 publish(id:string,reviewId:string):Promise<ObjectValue>;
 recover(id:string):Promise<ObjectValue>;
 buyerOffer(id:string,query?:string):Promise<ObjectValue>;
 prepareBuyer(id:string,input:ObjectValue):Promise<ObjectValue>;
 prepareRelease(input:{runId:string;outputDirectory:string;payment:ObjectValue;origin:string;path?:string}):Promise<ObjectValue>;
 stageRelease(input:{packageDirectory:string;releaseDirectory:string;id:string;label?:string;runtime?:ObjectValue}):Promise<ObjectValue>;
 activateRelease(input:{releaseDirectory:string;id:string;options?:ObjectValue}):Promise<ObjectValue>;
}
export class DbnomicsClientError extends Error {readonly code:string;readonly status:number;readonly result:ObjectValue}
export function createDbnomicsClient(options:{origin:string;fetchImpl?:typeof fetch;signal?:AbortSignal}):Client;
