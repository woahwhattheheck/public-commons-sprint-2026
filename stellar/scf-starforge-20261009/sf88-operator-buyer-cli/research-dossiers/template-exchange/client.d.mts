/** MIT. Complete original template client over the same Research connection. */
import type {TemplateExchange,PageOptions,TemplateRequest,StagedAction} from './index.mjs';
export interface TemplateClientOptions {signal?:AbortSignal}
export interface TemplateDownload {
 bytes:number;sha256:string;filename?:string;contentType?:string;revision?:number;
 [key:string]:unknown;
}
export interface TemplateFileInput {
 filename:string;bodyBase64:string;format?:'xlsx'|'csv';delimiter?:string;
}
export interface TemplateExchangeClient {
 page(query?:PageOptions,options?:TemplateClientOptions):ReturnType<TemplateExchange['page']>;
 record(query:Parameters<TemplateExchange['inspectRecord']>[1],options?:TemplateClientOptions):ReturnType<TemplateExchange['inspectRecord']>;
 publication(query:Parameters<TemplateExchange['publication']>[1],options?:TemplateClientOptions):ReturnType<TemplateExchange['publication']>;
 operation(query:Parameters<TemplateExchange['operation']>[1],options?:TemplateClientOptions):ReturnType<TemplateExchange['operation']>;
 stageTemplate(body:TemplateFileInput,options?:TemplateClientOptions):ReturnType<TemplateExchange['stageWorkbook']>;
 stageMapping(body:Parameters<TemplateExchange['stageMapping']>[1],options?:TemplateClientOptions):Promise<StagedAction>;
 stageRelease(body:Parameters<TemplateExchange['stageRelease']>[1],options?:TemplateClientOptions):Promise<StagedAction>;
 stageReturn(body:TemplateFileInput&{revision?:number;releaseId:string},options?:TemplateClientOptions):Promise<StagedAction>;
 stageReturnReview(body:Parameters<TemplateExchange['stageReturnReview']>[1],options?:TemplateClientOptions):Promise<StagedAction>;
 review(body:TemplateRequest&{projection?:'metadata'|'full'},options?:TemplateClientOptions):ReturnType<TemplateExchange['review']>;
 prepareExtractionDraft(body:Parameters<TemplateExchange['prepareExtractionDraft']>[1],options?:TemplateClientOptions):ReturnType<TemplateExchange['prepareExtractionDraft']>;
 acceptExtractionDraft(body:Parameters<TemplateExchange['acceptExtractionDraft']>[1],options?:TemplateClientOptions):ReturnType<TemplateExchange['acceptExtractionDraft']>;
 blob(sha256:string,query?:{revision?:number;filename?:string},options?:TemplateClientOptions):Promise<Uint8Array>;
 download(sha256:string,file:string,query?:{revision?:number;filename?:string},options?:TemplateClientOptions):Promise<TemplateDownload>;
}
export interface TemplateExchangeTransport {
 dossierId:string;
 request:(route:string,body:unknown,options:{method:'GET'|'POST';signal?:AbortSignal})=>Promise<any>;
 readBlob:(route:string,options:TemplateClientOptions)=>Promise<Uint8Array>;
 download?:(route:string,file:string,options:TemplateClientOptions&{expectedSha256:string})=>Promise<TemplateDownload>;
}
export interface TemplateExchangeBrowserConnection {
 baseUrl:string;dossierId:string;fetch?:typeof fetch;headers?:Record<string,string>;
 request?:undefined;
}
export function createTemplateExchangeClient(input:TemplateExchangeTransport|TemplateExchangeBrowserConnection):TemplateExchangeClient;
