import type {DocumentCorrectionLineage} from './corrections.mjs';
import type {DocumentProviderId,DocumentFormat,JsonValue} from './index.mjs';
import type {
  DocumentBatchInput,DocumentBatchProgress,SavedDocumentBatch,DocumentBatchExport
} from './batch.mjs';
import type {JobWorkspace} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/index.mjs';

export const DOCUMENT_COMPOSITION_SCHEMA:'stellar-forge.document-composition.v1';
export const DOCUMENT_COMPOSITION_PLAN_SCHEMA:'stellar-forge.document-composition-plan.v1';
export interface DocumentRecordGroup {
  /** Exact root-level record key, including spaces when reading a CSV header. */
  key:string;
  /** Output array field containing this record's selected line-item fields. */
  itemsAs:string;
  itemFields:string[];
}
export type DocumentDataset =
  | {source:string;format:'csv';delimiter?:','|';'|'\t';group?:DocumentRecordGroup}
  | {source:string;format:'json';recordsPointer?:string;group?:DocumentRecordGroup};
export type DocumentCompositionCondition =
  | {pointer:string;equals:null|boolean|number|string}
  | {pointer:string;notEmpty:true};
export interface DocumentCompositionTemplateInput {
  id:string;source:string;format:DocumentFormat;title:string;label?:string;
  settings?:Record<string,JsonValue>;when?:DocumentCompositionCondition;
}
export interface DocumentCompositionRequest {
  schema:'stellar-forge.document-composition.v1';
  id:string;name:string;provider:DocumentProviderId;
  /** The template starts with null; preparation requires the selected merchant's exact HTTPS origin. */
  merchantOrigin:string|null;
  dataset:DocumentDataset;
  /** Pointer into the complete record after optional grouping. */
  recordKey:string;
  /** Text template for the original parent-task reference shared by related documents. */
  taskReference:string;
  /** Empty uses the whole record; otherwise aliases select values through JSON pointers. */
  bindings?:Record<string,string>;
  templates:DocumentCompositionTemplateInput[];
  maxGeneratedBytes?:number;
  /** Present only for an explicit selection derived from a saved composition. */
  correction?:DocumentCorrectionLineage;
}
export interface NormalizedDocumentComposition extends Omit<DocumentCompositionRequest,
  'merchantOrigin'|'bindings'|'templates'|'maxGeneratedBytes'> {
  merchantOrigin:string;bindings:Record<string,string>;maxGeneratedBytes:number;
  templates:Array<DocumentCompositionTemplateInput&{label:string;settings:Record<string,JsonValue>}>;
}
export type DocumentTemplateNode =
  | {kind:'text';value:string}
  | {kind:'value';path:string}
  | {kind:'each'|'if';path:string;children:DocumentTemplateNode[];otherwise:DocumentTemplateNode[]};
export type CompiledDocumentTemplate=DocumentTemplateNode[];
export interface DocumentCompositionCounts {
  sourceRecords:number;groupedRecords:number;selectedRecords:number;excludedRecords:number;
  parentTasks:number;documents:number;generatedBytes:number;
}
export interface DocumentCompositionFile {
  path:string;contentType:string;role:'dataset'|'configuration'|'template'|'document'|'batch'|'preview';
  bytes:number;sha256:string;content:string;
}
export interface ComposedDocument {
  id:string;recordIndex:number;recordKey:string;templateId:string;source:string;
  format:DocumentFormat;label:string;taskReference:string;title:string;
  settings:Record<string,JsonValue>;bytes:number;sha256:string;
}
export interface DocumentCompositionPlan {
  schema:'stellar-forge.document-composition-plan.v1';
  request:NormalizedDocumentComposition;originalRequest:DocumentCompositionRequest;
  requestSha256:string;batchInput:DocumentBatchInput;counts:DocumentCompositionCounts;
  documents:ComposedDocument[];files:DocumentCompositionFile[];
}
export interface SavedDocumentComposition {
  schema:'stellar-forge.document-composition-receiving.v1';
  directory:string;planPath:string;sha256:string;bytes:number;id:string;sourceRoot:string;
  batchDirectory:string;batchInputPath:string;previewPath:string;counts:DocumentCompositionCounts;plan:DocumentCompositionPlan;
}
export type DocumentCompositionProgress =
  | (DocumentCompositionCounts&{stage:'DOCUMENT_SOURCES_PREPARED';id:string})
  | DocumentBatchProgress;
export type DocumentCompositionProgressHandler=
  (value:DocumentCompositionProgress)=>void|Promise<void>;
export interface PreparedDocumentCompositionBatch {
  composition:Pick<SavedDocumentComposition,'directory'|'sha256'|'bytes'|'previewPath'|'batchDirectory'|'counts'>;
  batch:SavedDocumentBatch;
}
export interface DocumentCompositionExport {
  schema:'stellar-forge.document-composition-export.v1';id:string;directory:string;
  source:{path:string;bytes:number;sha256:string};
  counts:DocumentCompositionCounts;batch:DocumentBatchExport;
}
export function documentCompositionTemplate(provider?:DocumentProviderId):DocumentCompositionRequest;
export function normalizeDocumentComposition(value:DocumentCompositionRequest):NormalizedDocumentComposition;
export function parseDocumentCsv(source:string,options?:{delimiter?:','|';'|'\t'}):Record<string,string>[];
export function parseDocumentDataset(source:string,configuration:
  | {format:'csv';delimiter?:','|';'|'\t';group?:DocumentRecordGroup}
  | {format:'json';recordsPointer?:string;group?:DocumentRecordGroup}):
  {sourceRecords:number;records:Array<Record<string,JsonValue>>};
export function compileDocumentTemplate(source:string):CompiledDocumentTemplate;
export function renderDocumentTemplate(compiled:CompiledDocumentTemplate,record:Record<string,JsonValue>,
  options?:{format?:DocumentFormat|'text';maxBytes?:number;maxIterations?:number}):string;
export function composeDocumentSources(input:{
  request:DocumentCompositionRequest;dataset:string;templates:Record<string,string>
}):DocumentCompositionPlan;
export function reviewDocumentComposition(input:{
  request:DocumentCompositionRequest;sourceRoot:string;signal?:AbortSignal
}):Promise<DocumentCompositionPlan>;
export function readDocumentComposition(directory:string,options?:{
  requireFiles?:boolean;expectedSha256?:string;signal?:AbortSignal
}):Promise<SavedDocumentComposition>;
export function prepareDocumentComposition(input:{
  directory:string;request?:DocumentCompositionRequest;sourceRoot?:string;
  signal?:AbortSignal;onProgress?:DocumentCompositionProgressHandler
}):Promise<SavedDocumentComposition>;
export function receiveDocumentComposition(input:{
  source:string;directory:string;expectedSha256:string;signal?:AbortSignal
}):Promise<SavedDocumentComposition>;
export function prepareDocumentCompositionBatch(input:{
  workspace:JobWorkspace;directory:string;request?:DocumentCompositionRequest;sourceRoot?:string;
  intakeAccessToken?:string|null;signal?:AbortSignal;onProgress?:DocumentCompositionProgressHandler
}):Promise<PreparedDocumentCompositionBatch>;
export function readDocumentCompositionBatch(input:{
  directory:string;workspace?:JobWorkspace;signal?:AbortSignal
}):Promise<{composition:SavedDocumentComposition;batch:SavedDocumentBatch}>;
export function exportDocumentComposition(input:{
  workspace:JobWorkspace;directory:string;destination:string;signal?:AbortSignal;maxBytes?:number
}):Promise<DocumentCompositionExport>;
