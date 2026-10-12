import type {
 Query,ContributionPage,Contribution,RetirementPage,RetirementRecord,WorkspaceOverview,NativeFiles,Json,
 CustomerValue,ProjectValue,AssignmentValue,StatementValue,InvoiceValue,MutationOptions,MutationResult,
 SavedStatementVersion,StatementReport,EditionComparison,CaptureOptions,CaptureStatus,TableName,NativeRow,
 StatementFileName,SourceSummary,SourceEdition,SourceResponse,Startup,Handover,
} from './index.mjs';
export class StellarcarbonClient {
 constructor(options?:{baseUrl?:string;workspaceId?:string;fetch?:typeof fetch});
 baseUrl:string;workspaceId?:string;
 request<T=unknown>(path:string,options?:{method?:string;body?:unknown}):Promise<T>;
 state():Promise<WorkspaceOverview>;
 contributions(value?:Query):Promise<ContributionPage>;
 contribution(hash:string,value:{editionId:string}):Promise<Contribution>;
 retirements(value?:Query):Promise<RetirementPage>;
 retirement(certificate:string,value:{editionId:string}):Promise<RetirementRecord>;
 edition(id:string):Promise<SourceSummary&{id:string;label:string;format:SourceEdition['format'];metadata:Record<string,Json>;files:{name:string;url:string}[];responses:Pick<SourceResponse,'url'|'retrievedAt'>[]}>;
 table<K extends TableName>(id:string,table:K,value?:{offset?:number;limit?:number}):Promise<{table:K;columns:string[];items:NativeRow<K>[];total:number;offset:number;limit:number;nextOffset:number|null}>;
 apply(action:'customer',value:CustomerValue,options:MutationOptions):Promise<MutationResult>;
 apply(action:'project',value:ProjectValue,options:MutationOptions):Promise<MutationResult>;
 apply(action:'assignment',value:AssignmentValue,options:MutationOptions):Promise<MutationResult>;
 apply(action:'statement',value:StatementValue,options:MutationOptions):Promise<MutationResult>;
 apply(action:'settings',value:{name:string},options:MutationOptions):Promise<MutationResult>;
 import(files:NativeFiles,metadata:Record<string,Json>,label:string,options:MutationOptions):Promise<MutationResult>;
 capture(value:CaptureOptions,label:string,options:MutationOptions):Promise<CaptureStatus>;
 captureStatus():Promise<CaptureStatus>;
 preview(value:StatementValue,options:MutationOptions):Promise<StatementReport>;
 statement(id:string,version?:number):Promise<SavedStatementVersion&{statementId:string}>;
 compare(beforeId:string,afterId:string):Promise<EditionComparison>;
 invoice(statementId:string,value:InvoiceValue,options:MutationOptions):Promise<MutationResult&{receivablesUrl:string;paymentPlansUrl:string}>;
 statementFileUrl(id:string,version:number,name:StatementFileName):string;
 receive(directory:string,handover:Handover,options:MutationOptions):Promise<Startup>;
 handoverUrl():string;
}
