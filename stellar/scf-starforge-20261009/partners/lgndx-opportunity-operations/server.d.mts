import type {Server} from 'node:http';
import type {Buffer} from 'node:buffer';
import type {OpportunityStore} from './model.mjs';

export type OpportunityExportFormat='portable'|'html'|'markdown'|'requirements'|'capabilities'|'teaming'|'milestones'|'questions';
export interface OpportunityExport {
  bytes:Buffer;mediaType:string;filename:string;revision:number;
}
export interface OpportunityServer {
  readonly directory:string;readonly operator:string;readonly origin:string;readonly url:string;
  readonly server:Server;readonly store:OpportunityStore;close():Promise<void>;
}
export declare function opportunityExport(store:OpportunityStore,id:string,options?:{
  format?:OpportunityExportFormat;packageId?:string;revision?:number;
}):Promise<OpportunityExport>;
export declare function startOpportunityWorkspace(options:{
  directory:string;operator?:string;dossierDirectory?:string;awardDirectory?:string;
  port?:number;store?:OpportunityStore;
}):Promise<OpportunityServer>;
