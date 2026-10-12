export type Sha256 = string;
export type Selection = Record<string, string[]>;
export interface Category { code: string; position: number; label: string }
export interface Dimension { id: string; position: number; label: string; categories: Category[]; metadataJson: string }
export interface CubeSummary {
  schema: 'stellar-forge.eurostat-cube.v1'; id: string[]; size: number[]; cellCount: number;
  dimensions: Dimension[]; label: string; source: string; updated: string; datasetCode: string;
  agencyId: string; metadataJson: string; statusLabels: Record<string,string>;
  valueFormat: 'array'|'object'; metadataOnly: boolean; numericCount: number; nullCount: number;
  absentCount: number; statusFormat: 'absent'|'global'|'array'|'object'; globalStatus?: string;
  statusCount: number; state: 'EMPTY_SELECTION'|'METADATA_ONLY'|'NO_OBSERVATIONS'|'DATA';
}
export interface Capture {
  schema: 'stellar-forge.eurostat-capture.v1'; id: Sha256; sourceUrl: string; retrievedAt: string;
  transport: {kind:string;httpStatus:number|null;headers?:[string,string][];operationId?:string;
    attempt?:number;nativeFileUploadId?:string;note?:string};
  response: {file:'response.json';bytes:number;sha256:Sha256}; cube: CubeSummary;
}
export interface Cell {
  index: number; dimensions: Record<string,string>; labels: Record<string,string>;
  /** Original JSON numeric lexeme, including trailing decimal zeros or exponent spelling. */
  value: string|null; valueState:'VALUE'|'NULL'|'ABSENT';
  status:string|null; statusState:'GLOBAL'|'PRESENT'|'NULL'|'ABSENT';statusLabel:string|null;
}
export interface CellPage {
  schema:'stellar-forge.eurostat-cells-page.v1';total:number;offset:number;limit:number;next:number|null;cells:Cell[];
}
export interface SourceReview {
  reviewer:string;note:string;use:'commercial'|'noncommercial';rightsBasis:string;attribution:string;
  geographies:string[];modifiedNotice?:string;
}
export interface SourceQuery {captureId:Sha256;selection?:Selection;includeMissing?:boolean;review:SourceReview}
export interface Column {name:string;type:'string'|'integer';nullable:false}
export interface QueryDescription extends SourceQuery {
  columns:string[];columnTypes:Column[];parameters:[];captureSha256:Sha256;responseSha256:Sha256;
  dimensionColumns:(Column&{kind:string;dimension?:string})[];sourceUrl:string;sourceUpdated:string;
}
export interface SourceDescription {
  hash:Sha256;bytes:number;
  config:{schema:'stellar-forge.eurostat-source.v1';captures:Record<Sha256,{file:string;sha256:Sha256}>;
    queries:Record<string,SourceQuery>};
  queries:Record<string,QueryDescription>;captures:Record<Sha256,Capture&{captureSha256:Sha256}>;
}
export interface AcquisitionRequest {
  id:string;sourceUrl?:string;
  request?:{dataset:string;language?:'EN'|'FR'|'DE';dimensions?:Selection;geoLevel?:string;
    time?:{periods?:string[];since?:string;until?:string;last?:number}};
  continueExisting?:boolean;timeoutMs?:number;maxBytes?:number;
}
export interface AcquisitionAttempt {
  state:string;attempt:number;sourceUrl:string;startedAt:string;finishedAt?:string;httpStatus?:number|null;
  headers?:[string,string][];bodyComplete?:boolean;bodyBytes?:number;bodySha256?:Sha256;
  bodyFile?:string;captureId?:Sha256|null;error?:{code:string;message:string}|null;
}
export interface Acquisition {request:Record<string,unknown>;state:string;attempts:AcquisitionAttempt[]}
export interface PlanInput {
  title:string;query:string;input:Record<string,never>;sourceHash:Sha256;
  dataset:{name:string;columns:Record<string,{type:'string'|'integer';nullable:false}>;
    filters?:string[];ranges?:string[];sorts?:string[];maxCellChars?:number;defaultLimit?:number;
    maxLimit?:number;maxPageBytes?:number};
  extraction:{order:{column:string;direction:'asc'|'desc'}[];maxRows?:number;maxBytes?:number;
    maxRowBytes?:number;timeoutMs?:number};
}
export interface SavedPlan {id:number;folder:string;data:PlanInput&Record<string,unknown>;created:string}
export interface NativeRun {
  id:string;plan:number;state:string;data:{review?:{id:string;reviewer:string;note:string;candidateDigest:Sha256;target:Record<string,unknown>};
    publication?:{snapshot:Sha256;revision:number;mode:string;recordedAt:string};error?:string|null;[key:string]:unknown};
  [key:string]:unknown;
}
export interface Handover {
  schema:'stellar-forge.eurostat-source-handover.v1';sha256:Sha256;
  files:{path:string;bytes:number;sha256:Sha256;base64:string}[];
}
export interface Comparison {
  schema:'stellar-forge.eurostat-comparison.v1';matchedUniverse:number;changes:number;counts:Record<string,number>;
  beforeCoverage:Selection;afterCoverage:Selection;beforeUpdated:string;afterUpdated:string;metadataChanged:boolean;
  offset:number;limit:number;next:number|null;
  entries:{key:string;result:'CHANGED'|'ONLY_BEFORE_SELECTION'|'ONLY_AFTER_SELECTION';before:Cell|null;after:Cell|null}[];
}
export interface ReleaseInput {
  runId:string;outputDirectory:string;payment:Record<string,unknown>;origin:string;path?:string;
}
export interface ReleasePreparation {
  schema:'stellar-forge.eurostat-release-preparation.v1';directory:string;runId:string;planId:number;
  query:string;snapshot:Sha256;rowCount:number;binding:Record<string,unknown>;dataset:Record<string,unknown>;
  sourceFiles:{path:string;bytes:number;sha256:Sha256}[];offers:unknown;reused:boolean;
}
export interface BuyerOffer {
  mode:'NATIVE_X402'|'CHALLENGE_ONLY';seller:string;resource:string;url:string;snapshot:Sha256;
  query:string;offerSha256:Sha256;accepts:Record<string,unknown>[];offer:Record<string,unknown>;
}
export interface EurostatClient {
  origin:string;
  status():Promise<{schema:'stellar-forge.eurostat-project-status.v1';project:Record<string,unknown>;
    source:SourceDescription;acquisitions:Acquisition[];publisher:Record<string,unknown>}>;
  source():Promise<SourceDescription>;capture(id:Sha256):Promise<{capture:Capture;captureSha256:Sha256}>;
  briefing(id:Sha256,query?:string):Promise<Record<string,unknown>>;
  originalResponse(id:Sha256):Promise<Uint8Array>;
  cells(id:Sha256,options?:{selection?:Selection;includeMissing?:boolean;offset?:number;limit?:number}):Promise<CellPage>;
  compare(before:Sha256,after:Sha256,options?:{offset?:number;limit?:number}):Promise<Comparison>;
  acquire(input:AcquisitionRequest):Promise<Acquisition>;acquisition(id:string):Promise<Acquisition>;
  importCapture(input:{responseText:string;sourceUrl:string;retrievedAt:string;transport?:Capture['transport']}):
    Promise<{capture:Capture;captureSha256:Sha256;sourceHash:Sha256;reused:boolean}>;
  saveQuery(input:{name:string;query:SourceQuery;expectedHash:Sha256}):Promise<{name:string;query:SourceQuery;sourceHash:Sha256}>;
  planTemplate(input:{query:string;title?:string;name?:string}):Promise<PlanInput>;
  exportSources():Promise<Handover>;importSources(packet:Handover):Promise<SourceDescription>;
  savePlan(input:PlanInput):Promise<SavedPlan>;extract(plan:number):Promise<{id:string}>;
  inspect(id:string,query?:string):Promise<Record<string,unknown>>;cancel(id:string):Promise<unknown>;
  review(id:string,input:{reviewer:string;note:string;initialize?:boolean;expectedSnapshot?:Sha256;expectedRevision?:number}):Promise<NativeRun>;
  publish(id:string,reviewId:string):Promise<NativeRun>;recover(id:string):Promise<NativeRun|Record<string,unknown>>;
  buyerOffer(id:string,query?:string):Promise<BuyerOffer>;
  prepareBuyer(id:string,input:{query?:string;intentId:string;acceptIndex:number;offerSha256:Sha256}):Promise<Record<string,unknown>>;
  prepareRelease(input:ReleaseInput):Promise<ReleasePreparation>;
  stageRelease(input:{packageDirectory:string;releaseDirectory:string;id:string;label?:string;
    runtime?:{port:number;facilitator?:string;allowLocalFacilitator?:boolean}}):Promise<Record<string,unknown>>;
  activateRelease(input:{releaseDirectory:string;id:string;options?:Record<string,unknown>}):Promise<Record<string,unknown>>;
}
export class EurostatClientError extends Error {code:string;status:number;result:unknown}
export function createEurostatClient(options:{origin:string;fetchImpl?:typeof fetch;signal?:AbortSignal}):EurostatClient;
