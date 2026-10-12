/** Original grant-portfolio console and retained action contracts. */
export type Sha256 = string;
export type PortfolioId = string;
export type OperationId = string;
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key:string]:JsonValue};
export type JsonObject = {[key:string]:JsonValue};
export type PortfolioTable = 'entities'|'financial'|'links'|'decisions'|'candidates'|'changes'|'sources';
export type SourceStandard = 'iati'|'360giving';
export type RequestState = 'RUNNING'|'COMPLETED'|'FAILED';
export type PortfolioAction = 'source.receive'|'portfolio.save'|'review.save'|'portfolio.export'|'portfolio.receive';
export interface RequestOptions { signal?:AbortSignal; }
export interface ActionOptions extends RequestOptions { expectedRevision?:number; }
export interface FileDescriptor { sha256:Sha256; bytes:number; filename:string; url?:string; }
export interface SavedPortfolioFile extends FileDescriptor { path:string; retained:true; }
export interface PortfolioFile { descriptor:FileDescriptor; response:Response; }
export interface SourceCoverage {
  statement:string; sourceUrl:string; observedAt:string; license:string;
}
export interface SourceReceiveInput {
  object:Sha256; standard:SourceStandard; label:string; coverage:SourceCoverage; selection?:JsonObject;
}
export interface PortfolioReview { status:'draft'|'reviewed'|'needs-correction'; reviewer:string; note:string; }
export interface PortfolioSaveInput {
  id?:PortfolioId; expectedPortfolioRevision?:number; name:string; notes:string;
  sources:Sha256[]; sourceReplacements?:{before:Sha256; after:Sha256}[]; review:PortfolioReview;
}
export interface ReviewReference { sourceId:Sha256; entityKey:Sha256; sha256:Sha256; }
export type ReviewDecision =
  | {id?:string; type:'link'; left:ReviewReference; right:ReviewReference;
      relation:'same-organization'|'grant-activity'|'duplicate';
      disposition:'confirmed'|'rejected'|'ambiguous'; rationale:string}
  | {id?:string; type:'record'; record:ReviewReference;
      disposition:'unmatched'|'coverage-only'|'duplicate'; related?:ReviewReference; rationale:string};
export type SavedReviewDecision = ReviewDecision & {
  reviewer:string; reviewedAt:string; status:'CURRENT'|'STALE';
};
export interface ReviewSaveInput {
  portfolioId:PortfolioId; expectedPortfolioRevision:number; reviewer:string; decisions:ReviewDecision[];
}
export interface PortfolioSelection { portfolioId:PortfolioId; revision:number; }
export interface PortfolioReceiveInput { object:Sha256; }
export interface PortfolioExportDescriptor extends FileDescriptor, PortfolioSelection { snapshot:Sha256; }
export interface RetainedRequest<Result = JsonValue> {
  schema:string; id:OperationId; state:RequestState; inputSha256:Sha256;
  result?:Result; error?:JsonObject|string;
  [key:string]:unknown;
}
export type ActionInput = {operationId:OperationId; expectedRevision?:number} & (
  | {action:'source.receive'; payload:SourceReceiveInput}
  | {action:'portfolio.save'; payload:PortfolioSaveInput}
  | {action:'review.save'; payload:ReviewSaveInput}
  | {action:'portfolio.export'; payload:PortfolioSelection}
  | {action:'portfolio.receive'; payload:PortfolioReceiveInput}
);
export interface PortfolioState {
  schema:'stellar-forge.grant-portfolio.v1'; workspaceId:string; revision:number;
  sources:JsonObject[]; portfolios:JsonObject[]; requests:JsonObject[];
  [key:string]:unknown;
}
export interface RowsInput extends PortfolioSelection {
  table:PortfolioTable; offset?:number; limit?:number; search?:string;
  status?:string; standard?:string; entityKey?:Sha256;
}
export interface RowPage<Row = JsonObject> {
  rows:Row[]; total:number; offset:number; nextOffset:number|null;
  revision:number; snapshot:Sha256;
}
export interface DetailInput extends PortfolioSelection { sourceId:Sha256; entityKey:Sha256; }
export interface UploadInput {
  body:BodyInit|AsyncIterable<Uint8Array>; bytes:number; sha256?:Sha256;
}
export interface WaitOptions extends RequestOptions {
  pollMs?:number; timeoutMs?:number;
  onUpdate?:(request:RetainedRequest)=>void|Promise<void>;
}
export interface GrantPortfolioError extends Error {
  code:string; status?:number; nativeCode?:string; details?:JsonValue;
  operationId?:OperationId; recovery?:string;
}
export declare const GRANT_PORTFOLIO_SCHEMA:'stellar-forge.grant-portfolio.v1';
export declare const GRANT_PORTFOLIO_MAX_PACKET_BYTES:number;
export declare const GRANT_PORTFOLIO_MAX_ACTION_BYTES:number;

/** Borrows a live authenticated console; dispose aborts only this client's HTTP work. */
export declare class GrantPortfolioClient {
  constructor(consoleUrl:string, options?:{timeoutMs?:number});
  readonly origin:string;
  readonly closed:boolean;
  schema(options?:RequestOptions):Promise<JsonObject>;
  state(options?:RequestOptions):Promise<PortfolioState>;
  launch(options?:RequestOptions):Promise<JsonObject>;
  source(id:Sha256, options?:RequestOptions):Promise<JsonObject>;
  portfolio(id:PortfolioId, options:{revision:number}&RequestOptions):Promise<JsonObject>;
  rows<Row = JsonObject>(input:RowsInput, options?:RequestOptions):Promise<RowPage<Row>>;
  pages<Row = JsonObject>(input:RowsInput, options?:RequestOptions & {
    onPage?:(page:RowPage<Row>)=>void|Promise<void>;
  }):AsyncGenerator<RowPage<Row>,void,void>;
  detail(input:DetailInput, options?:RequestOptions):Promise<JsonObject>;
  action<Result = JsonValue>(input:ActionInput, options?:RequestOptions):Promise<RetainedRequest<Result>>;
  request<Result = JsonValue>(operationId:OperationId, options?:RequestOptions):Promise<RetainedRequest<Result>>;
  resume<Result = JsonValue>(operationId:OperationId, options?:RequestOptions):Promise<RetainedRequest<Result>>;
  wait<Result = JsonValue>(operationId:OperationId, options?:WaitOptions):Promise<RetainedRequest<Result>>;
  receiveSource(operationId:OperationId, payload:SourceReceiveInput, options?:ActionOptions):Promise<RetainedRequest>;
  savePortfolio(operationId:OperationId, payload:PortfolioSaveInput, options?:ActionOptions):Promise<RetainedRequest>;
  saveReview(operationId:OperationId, payload:ReviewSaveInput, options?:ActionOptions):Promise<RetainedRequest>;
  createExport(operationId:OperationId, payload:PortfolioSelection, options?:ActionOptions):Promise<RetainedRequest<PortfolioExportDescriptor>>;
  receivePortfolio(operationId:OperationId, payload:PortfolioReceiveInput, options?:ActionOptions):Promise<RetainedRequest>;
  upload(input:UploadInput, options?:RequestOptions):Promise<FileDescriptor>;
  uploadFile(filename:string, options?:RequestOptions & {sha256?:Sha256}):Promise<FileDescriptor>;
  openObject(sha256:Sha256, options?:RequestOptions & {bytes?:number}):Promise<PortfolioFile>;
  openExport(id:Sha256, options?:RequestOptions & {bytes?:number}):Promise<PortfolioFile>;
  downloadObject(sha256:Sha256, filename:string, options?:RequestOptions & {bytes?:number}):Promise<SavedPortfolioFile>;
  downloadExport(id:Sha256, filename:string, options?:RequestOptions & {bytes?:number}):Promise<SavedPortfolioFile>;
  dispose():Promise<void>;
}
/** Publishes a complete checked file once; same-byte receiving reuses the original destination. */
export declare function saveGrantPortfolioFile(file:PortfolioFile, filename:string):Promise<SavedPortfolioFile>;
export declare function readGrantPortfolioConnection(filename:string):Promise<string>;
export declare function connectGrantPortfolio(options:
  ({consoleUrl:string; consoleUrlFile?:never}|{consoleUrl?:never; consoleUrlFile:string}) &
  {timeoutMs?:number}):Promise<GrantPortfolioClient>;
