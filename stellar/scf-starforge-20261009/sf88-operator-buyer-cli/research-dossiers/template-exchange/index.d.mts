/** MIT. Complete original-dossier template exchange API. */
import type {Actor,ExtractionRequest,DossierState,Operation as ExtractionOperation} from '../study-extraction.mjs';
export interface BlobRef {sha256:string;bytes:number}
export interface WorkbookSpec {filename:string;format?:'xlsx'|'csv';delimiter?:','|'\t'|';'|'|';workbook:BlobRef;inspection:BlobRef}
export interface CellValue {type:'blank'|'text'|'number'|'boolean'|'date'|'error';value:null|string|boolean}
export interface NativeCell {address:string;value:CellValue;formula:{text:string;attributes:Record<string,string>}|null;style:string|null;fingerprint:string}
export interface Sheet {name:string;sheetId:string;state:string;path:string|null;kind:'worksheet'|'retained-nonworksheet';cells:NativeCell[];merged:string[];protected:boolean;formulaRanges:string[]}
export interface Inspection {schema:'sf88-template-workbook/v1';filename:string;format:'xlsx'|'csv';sha256:string;bytes:number;sheets:Sheet[];formulaCount:number;partCount:number;originalParts:Array<{path:string;sha256:string;bytes:number}>;csv?:{delimiter:string;bom:boolean;newline:string;terminalNewline:boolean}}
export interface MappingBinding {id?:string;sheet:string;cell:string;resultId:string;editionId:string;fieldId?:string;component?:'value'|'status'|'note'|'context'|'bases';pointer?:string;typed?:boolean;mode?:'text'|'number'|'boolean'|'json';rowIdentity?:{column:string;value:string}}
export interface ReturnDecision {bindingId:string;disposition:'keep-release'|'propose-correction'|'client-only';note:string;fixedCellConfirmed?:boolean}
export type TemplateAction='retain-template'|'revise-template'|'save-mapping'|'release-workbook'|'receive-return'|'review-return'|'record-extraction-draft';
export type TemplateSection='overview'|'templates'|'template-editions'|'mappings'|'releases'|'returns'|'return-reviews'|'drafts'|'operations';
export interface TemplateRequest {requestId:string;expectedRevision:number;actor:Actor;action:TemplateAction;data:Record<string,unknown>&{reason:string}}
export interface Operation {schema:'sf88-research-template-operation/v1';id:string;dossierId:string;requestId:string;requestSha256:string;request:TemplateRequest;action:TemplateAction;actor:Actor;createdAt:string;originalRevision:number;revision:number;originalRevisionSha256:string;result:Record<string,any>;blobs:BlobRef[];sha256:string}
export interface PageOptions {revision?:number;section?:TemplateSection;offset?:number;limit?:number;templateId?:string}
export interface Page {schema:'sf88-research-template-exchange/v1';dossierId:string;revision:number;section:TemplateSection;overview:Record<TemplateSection,number>;sourceContext:{sha256:string;revision:number};publications:Array<{id:string;title:string;sha256:string;rows:number;status:string}>;items:any[];offset:number;limit:number;total:number;nextOffset:number|null}
export interface WorkbookOptions {python?:string;signal?:AbortSignal;timeoutMs?:number}
export interface DossierBindings {
 head:(id:string,revision?:number)=>Promise<{sha256:string;state:DossierState}>;
 commit:(id:string,expectedRevision:number,label:string,update:(next:DossierState,previous:DossierState)=>Promise<void>,options?:{projection:'metadata'|'full'})=>Promise<unknown>;
 blob:(metadata:BlobRef)=>Promise<Buffer>;putBlob:(body:Buffer)=>Promise<BlobRef>;
 reviewExtraction?:(id:string,request:ExtractionRequest&{projection?:'metadata'|'full'})=>Promise<{dossier:unknown;operation:ExtractionOperation;duplicate:boolean}>;
 workbookOptions?:WorkbookOptions;
}
export interface StagedAction {expectedRevision:number;action:TemplateAction;data:Record<string,unknown>;preview:unknown}
export interface TemplateExchange {
 page(id:string,options?:PageOptions):Promise<Page>;
 publication(id:string,options:{revision?:number;publicationId:string;offset?:number;limit?:number}):Promise<{dossierId:string;revision:number;publication:any;items:any[];total:number;nextOffset:number|null;newerSourceReview:any}>;
 operation(id:string,options:{revision?:number;requestId:string}):Promise<{dossierId:string;revision:number;operation:Operation|null}>;
 stageWorkbook(input:{filename:string;body:Buffer;format?:'xlsx'|'csv';delimiter?:string}):Promise<WorkbookSpec&{summary:unknown}>;
 stageMapping(id:string,input:{revision?:number;templateEditionId:string;publicationId:string;bindings:MappingBinding[];previousMappingId?:string|null}):Promise<StagedAction>;
 stageRelease(id:string,input:{revision?:number;mappingId:string;filename?:string;review:{note:string;allowHistorical?:boolean;acknowledgeNewerSource?:boolean}}):Promise<StagedAction>;
 stageReturn(id:string,input:{revision?:number;releaseId:string;filename:string;body:Buffer;format?:'xlsx'|'csv';delimiter?:string}):Promise<StagedAction>;
 stageReturnReview(id:string,input:{revision?:number;returnId:string;decisions:ReturnDecision[]}):Promise<StagedAction>;
 review(id:string,request:TemplateRequest&{projection?:'metadata'|'full'}):Promise<{dossier:unknown;operation:Operation;duplicate:boolean}>;
 prepareExtractionDraft(id:string,input:{revision?:number;reviewId:string;actor:Actor;requestId:string;resultSetId:string;reason:string}):Promise<{dossierId:string;revision:number;reviewId:string;request:ExtractionRequest;requestSha256:string;blob:BlobRef}>;
 acceptExtractionDraft(id:string,input:{reviewId:string;request:ExtractionRequest;requestBlob:BlobRef;receiptRequestId:string;reason:string}):Promise<{native:unknown;receipt:unknown}>;
 inspectRecord(id:string,input:{revision?:number;kind:'edition'|'mapping'|'release'|'return'|'review'|'draft';recordId:string}):Promise<{dossierId:string;revision:number;record:any;details:Record<string,any>}>;
 readBlob(id:string,input:{revision?:number;sha256:string}):Promise<BlobRef&{dossierId:string;revision:number;body:Buffer}>;
}
export function createTemplateExchange(bindings:DossierBindings):TemplateExchange;
export function validateTemplateExchangeState(state:DossierState):void;
export function templateExchangeBlobs(state:DossierState):BlobRef[];
export function validateTemplateExchangeTransition(previous:DossierState|null,state:DossierState,options:{readContent:(metadata:BlobRef)=>Promise<Buffer>}&WorkbookOptions):Promise<void>;
export function recordTemplateExchange(state:DossierState,request:TemplateRequest,createdAt:string,options:{readContent:(metadata:BlobRef)=>Promise<Buffer>}&WorkbookOptions):Promise<Operation>;
export function inspectWorkbook(body:Buffer,options:{filename:string;format?:'xlsx'|'csv';delimiter?:string}&WorkbookOptions):Promise<Inspection>;
export function patchWorkbook(body:Buffer,options:{filename:string;format?:'xlsx'|'csv';delimiter?:string;patches:Array<{sheet:string;cell:string;expectedFingerprint:string;value:CellValue}>}&WorkbookOptions):Promise<{body:Buffer;inspection:Inspection;report:unknown}>;
export const TEMPLATE_ROUTE_PREFIX:'/api/research/dossiers/:dossierId/template-exchange';
export const TEMPLATE_POST_ACTIONS:readonly string[];
export function createTemplateExchangeDispatcher(input:{templateExchange:TemplateExchange}):(request:{dossierId:string;method:string;action?:string;query?:Record<string,string>;body?:unknown})=>Promise<{kind:'json';body:unknown}|{kind:'file';body:Buffer;filename:string;contentType:string;sha256:string;revision:number}>;
export {createTemplateExchangeClient} from './client.mjs';
export type {TemplateExchangeClient,TemplateClientOptions,TemplateDownload,TemplateFileInput,TemplateExchangeTransport,TemplateExchangeBrowserConnection} from './client.mjs';

export function runTemplateExchangeCli(argv:string[],options?:{openStore?:Function;stdout?:{write:(text:string)=>unknown}}):Promise<unknown>;
