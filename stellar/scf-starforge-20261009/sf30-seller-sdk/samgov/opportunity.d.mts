/// <reference types="node" />
import type {SamSelection,SamEdition,SamNotice,SamSource,SamDeadline} from './workspace.mjs';
export interface SamOpportunitySourceBinding {
  sourceId:string;opportunitySourceId:string;sha256:string;bytes:number;kind:string;url:string;
}
export interface SamOpportunityBridgeResult {
  bridgeId:string;projectId:string;revision:number;currentProjectRevision?:number;sourceRevision:number;
  selectionId:string;editionId:string;noticeId:string;sourceBindings:SamOpportunitySourceBinding[];
  observationSourceId:string;observationSha256:string;completedAt:string;
}
export function prepareSamOpportunity(options:{
  directory:string;journalDirectory:string;operator:string;requestId:string;workspaceId:string;sourceRevision:number;
  selection:SamSelection;edition:SamEdition;notice:SamNotice;sources:Array<SamSource & {contentBase64:string}>;
  projectId?:string;expectedProjectRevision?:number;title?:string;
  documentKind?:'rfi'|'sources_sought'|'solicitation'|'other';deadline?:SamDeadline|null;
}):Promise<SamOpportunityBridgeResult>;
