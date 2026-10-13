import type {JobWorkspace} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/index.mjs';
import type {DocumentInput,DocumentProviderConfiguration,JsonValue} from './index.mjs';
import type {DocumentBatchPlan,DocumentBatchSnapshot,DocumentBatchExport,DocumentBatchRow} from './batch.mjs';

export const DOCUMENT_ASSEMBLY_SCHEMA:'stellar-forge.document-assembly.v1';
export const DOCUMENT_ASSEMBLY_PLAN_SCHEMA:'stellar-forge.document-assembly-plan.v1';
export const DOCUMENT_ASSEMBLY_DELIVERY_SCHEMA:'stellar-forge.document-assembly-delivery.v1';
export interface DocumentAssemblyRequest {
  schema:typeof DOCUMENT_ASSEMBLY_SCHEMA;id:string;name:string;merchantOrigin:string;
  title:string;taskReference:string;maxVolumeBytes?:number;
  settings?:{strict?:boolean;author?:string;subject?:string;keywords?:string};
}
export interface DocumentPdfSource {
  id:string;filename:string;bytes:number;sha256:string;base64:string;reference?:string;
}
export interface DocumentAssemblyOrigin {
  kind:'document-batch';batchId:string;batchInputSha256:string;batchPlanSha256:string;
  compositionId?:string;compositionSha256?:string;
}
export interface DocumentAssemblyVolume {
  id:string;index:number;kind:'merge'|'original';filename:string;fileIds:string[];
  input:DocumentInput;source:{path:string;bytes:number;sha256:string;contentType:'application/json'|'application/pdf'};
}
export interface DocumentAssemblyCounts {
  originalFiles:number;originalBytes:number;volumes:number;paidMerges:number;unchangedVolumes:number;
}
export interface DocumentAssemblyPlan {
  schema:typeof DOCUMENT_ASSEMBLY_PLAN_SCHEMA;request:DocumentAssemblyRequest;
  origin:DocumentAssemblyOrigin|null;inputSha256:string;files:DocumentPdfSource[];
  volumes:DocumentAssemblyVolume[];counts:DocumentAssemblyCounts;
}
export interface DocumentAssemblySource {directory:string;plan:DocumentAssemblyPlan;sha256:string;bytes:number}
export interface DocumentAssemblySelectedBatch {
  source:DocumentAssemblySource;batch:{plan:DocumentBatchPlan;sha256:string;bytes:number}|null;
  totals:DocumentBatchPlan['totals'];
}
export interface DocumentAssemblyView {
  schema:'stellar-forge.document-assembly-view.v1';id:string;directory:string;sourceSha256:string;sourceBytes:number;
  request:DocumentAssemblyRequest;origin:DocumentAssemblyOrigin|null;counts:DocumentAssemblyCounts;
  originalFiles:Array<Omit<DocumentPdfSource,'base64'>>;
  volumes:Array<DocumentAssemblyVolume&{state:string;received:boolean;native:DocumentBatchRow|null}>;
  complete:boolean;
  native:null|{planSha256:string;planBytes:number;directory:string;totals:DocumentBatchPlan['totals'];snapshot:DocumentBatchSnapshot};
}
export interface DocumentAssemblyDelivery {
  schema:typeof DOCUMENT_ASSEMBLY_DELIVERY_SCHEMA;id:string;directory:string;
  source:{path:string;bytes:number;sha256:string};request:DocumentAssemblyRequest;
  origin:DocumentAssemblyOrigin|null;counts:DocumentAssemblyCounts;
  volumes:Array<{id:string;index:number;kind:'merge'|'original';filename:string;fileIds:string[];
    bytes:number;sha256:string;resourceId:string|null}>;
  files:Array<{path:string;bytes:number;sha256:string}>;native:DocumentBatchExport|null;
  archive?:{path:string;bytes:number;sha256:string;members:number};
}
export interface DocumentAssemblySelection {workspace:JobWorkspace;directory:string;expectedSha256?:string;signal?:AbortSignal}
export function documentAssemblyTemplate():Omit<DocumentAssemblyRequest,'merchantOrigin'>&{merchantOrigin:null};
export function normalizeDocumentAssembly(request:DocumentAssemblyRequest):DocumentAssemblyRequest;
export function composeDocumentPdfAssembly(options:{request:DocumentAssemblyRequest;sources:DocumentPdfSource[];
  origin?:DocumentAssemblyOrigin|null}):DocumentAssemblyPlan;
export function prepareDocumentPdfAssembly(options:{directory:string;request:DocumentAssemblyRequest;
  sources:DocumentPdfSource[];origin?:DocumentAssemblyOrigin|null;signal?:AbortSignal}):Promise<DocumentAssemblySource>;
export function readDocumentPdfAssembly(directory:string,options?:{expectedSha256?:string;requireFiles?:boolean;
  signal?:AbortSignal}):Promise<DocumentAssemblySource>;
export function receiveDocumentPdfAssembly(options:{source:string;directory:string;expectedSha256:string;
  signal?:AbortSignal}):Promise<DocumentAssemblySource>;
export function stageDocumentPdfAssemblyFiles(options:DocumentAssemblySelection&{request:DocumentAssemblyRequest;
  files:Array<{id:string;path:string;filename?:string;bytes?:number;sha256?:string;reference?:string}>}):Promise<DocumentAssemblySource>;
export function stageDocumentPdfAssemblyFromBatch(options:DocumentAssemblySelection&{
  request:DocumentAssemblyRequest;batchDirectory:string;batchPlanSha256:string;itemIds:string[];
  composition?:{id:string;sha256:string}}):Promise<DocumentAssemblySource>;
export function prepareDocumentPdfAssemblyBatch(options:DocumentAssemblySelection&{
  intakeAccessToken?:string|null;onProgress?:(value:unknown)=>void|Promise<void>}):Promise<DocumentAssemblySelectedBatch>;
export function readDocumentPdfAssemblyBatch(options:DocumentAssemblySelection):Promise<DocumentAssemblySelectedBatch>;
export function inspectDocumentPdfAssembly(options:DocumentAssemblySelection):Promise<DocumentAssemblyView>;
export function runDocumentPdfAssembly(options:DocumentAssemblySelection&{approvedPlanSha256?:string;
  receiveOnly?:boolean;intakeAccessToken?:string|null;deadlineMs?:number;pollMs?:number;
  onProgress?:(value:unknown)=>void|Promise<void>}):Promise<DocumentAssemblyView>;
export function documentPdfAssemblyOutput(options:DocumentAssemblySelection&{volumeId:string}):Promise<{
  path:string;bytes:number;sha256:string;resourceId:string|null;filename:string;contentType:'application/pdf';
  volume:DocumentAssemblyVolume}>;
export function exportDocumentPdfAssembly(options:DocumentAssemblySelection&{destination:string;maxBytes?:number}):
  Promise<DocumentAssemblyDelivery>;

export const DOCUMENT_PDF_SOURCE_SCHEMA:'stellar-forge.document-pdf-source.v1';
export const DOCUMENT_ASSEMBLY_SOURCE_CHECKED_ON:string;
export const DOCUMENT_ASSEMBLY_FORMAT:'pdf-set';
export const DOCUMENT_ASSEMBLY_MAX_FILES:50;
export function documentAssemblySettingsSchema():Record<string,JsonValue>;
export function normalizeDocumentAssemblyInput(providerId:'pdfmint',input:DocumentInput):Required<Pick<DocumentInput,'title'|'taskReference'|'settings'>>;
export function documentAssemblyInputSchema(providerId:'pdfmint'):Record<string,JsonValue>;
export function normalizeDocumentPdfSource(value:{schema:typeof DOCUMENT_PDF_SOURCE_SCHEMA;files:DocumentPdfSource[]},
  options?:{minimumFiles?:number}):{schema:typeof DOCUMENT_PDF_SOURCE_SCHEMA;files:DocumentPdfSource[]};
export function buildDocumentAssemblyRequest(configuration:DocumentProviderConfiguration,input:DocumentInput,sourceText:string):{
  provider:'pdfmint';format:'pdf-set';input:DocumentInput;url:string;method:'POST';contentType:'application/json';
  body:Record<string,unknown>;bodyText:string;source:{schema:typeof DOCUMENT_PDF_SOURCE_SCHEMA;files:DocumentPdfSource[]};
  sourceCheckedOn:string;
};
