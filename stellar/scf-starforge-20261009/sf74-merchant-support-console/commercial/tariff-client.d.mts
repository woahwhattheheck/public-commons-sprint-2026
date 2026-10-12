/** Original saved-case tariff receiving over the configured loopback merchant listener. */
export type Sha256=string;
export type UUID=string;
export interface CommercialTariffScope {workspaceId:Sha256;caseId:UUID}
export interface SelectedCase {id:UUID;revision:Sha256}
export interface TariffSelection {
  id:Sha256;pricingSourceId:Sha256;receivingSourceSha256:Sha256;
  tariffPlanId:UUID;planLabel:string;comparisonId:Sha256;selectionRequestId:UUID;selectedAt:string;
  scenarioPlanId:UUID;scenarioId:string;sourceVersion:UUID;pricingVersion:UUID;
  routeId:string;tariffId:string;tariffLabel:string;mode:'graduated'|'volume';selectedQuantity:string;
  tariffGrossUsd:string;uniformUnitUsd:string;uniformGrossUsd:string;roundingDeltaUsd:string;
  tiers:Array<{upTo:string|null;unitPriceUsd:string}>;
  files:Array<{name:string;bytes:number;sha256:Sha256}>;
  material?:{id:string;sha256:Sha256;bytes:number};
  backup?:{materialId:string;sha256:Sha256;bytes:number};
  comparison:Record<string,unknown>;
}
export interface TariffEnvelope<T=Record<string,unknown>> {
  scope:CommercialTariffScope;case:SelectedCase;tariffSources:TariffSelection[];action:string;result:T;
}
export interface OriginalAuthoring {
  pricingDirectory:string;pricingConfig:string;pricingSnapshot?:string;pricingHistory?:string;
}
export interface OriginalRequest {
  id?:UUID;scope?:CommercialTariffScope;expectedRevision?:Sha256;
}
export interface TariffStatus {
  scope:CommercialTariffScope;case:SelectedCase;tariffSources:TariffSelection[];
  active:Array<{action:string;startedAt:string;requestIds:UUID[]}>;
}
export interface CaptureRequest extends OriginalRequest,Partial<OriginalAuthoring>{
  selectionRequestId:UUID;backupRequestId:UUID;directory:string;
}
export interface InspectRequest extends OriginalRequest {directory:string;expectedSourceSha256?:Sha256}
export interface AttachRequest extends OriginalRequest {
  expectedRevision:Sha256;directory:string;expectedSourceSha256:Sha256;
  pricingRequestId:UUID;backupAttachmentRequestId:UUID;tariffAttachmentRequestId:UUID;
  actor:string;bindingReason:string;
}
export interface CaseRequest extends OriginalRequest {
  revision?:Sha256;sourceId?:Sha256;quoteId?:UUID;quoteSha256?:Sha256;monthlyRequests?:string;
}
export interface RestoreRequest extends Omit<CaseRequest,'monthlyRequests'>{
  quoteId:UUID;quoteSha256:Sha256;archive:string;directory:string;
}
export interface TariffFile {
  scope:CommercialTariffScope;
  descriptor:{filename:string;bytes:number;sha256:Sha256;mediaType:string};bytes:Uint8Array;
}
export interface TariffClient {
  readonly scope:CommercialTariffScope;
  status(args?:OriginalRequest):Promise<TariffStatus>;
  catalog(args:OriginalRequest&OriginalAuthoring):Promise<TariffEnvelope>;
  selection(args:OriginalRequest&OriginalAuthoring&{selectionRequestId:UUID}):Promise<TariffEnvelope>;
  capture(args:CaptureRequest):Promise<TariffEnvelope>;
  inspect(args:InspectRequest):Promise<TariffEnvelope>;
  attach(args:AttachRequest):Promise<TariffEnvelope>;
  case(args:CaseRequest):Promise<TariffEnvelope>;
  restore(args:RestoreRequest):Promise<TariffEnvelope>;
  download(args:OriginalRequest&{revision?:Sha256;sourceId:Sha256;kind:'SOURCE'|'PORTFOLIO'}):Promise<TariffFile>;
  call(action:string,args?:Record<string,unknown>):Promise<TariffEnvelope|TariffStatus|TariffFile>;
}
export class CommercialTariffError extends Error{
  readonly code:string;readonly status?:number;readonly requestState?:'REJECTED'|'UNKNOWN';
  constructor(message:string,details?:{code?:string;status?:number;requestState?:'REJECTED'|'UNKNOWN'});
}
export function createCommercialTariffClient(options:{
  url:string;caseId:UUID;workspaceId:Sha256;fetch?:typeof globalThis.fetch
}):TariffClient;
