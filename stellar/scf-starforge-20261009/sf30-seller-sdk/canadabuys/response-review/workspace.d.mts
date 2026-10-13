import type { CanadaBuysWorkspace, WorkspaceMetadata, WorkshareHistory, SourceEdition, Report } from '../workspace.mjs';
import type { BidderRecordMap } from '../bidder-desk-workspace.mjs';
export type JSONValue=null|boolean|number|string|JSONValue[]|{[key:string]:JSONValue};
export interface ResponseBinding { noticeId:string;entryId:string;sourceId:string;rowSha256:string;[key:string]:JSONValue }
export interface ResponseMaster {
 binding:ResponseBinding;originalRow:Record<string,string>;responseBasis?:string;workshareScope?:string;
 responses:Array<{id:string;title:string;draft:string;deliverable?:string;acceptance?:string;proposedPilotAcceptance?:string;sourceRequirement?:{requirement?:string;[key:string]:unknown};[key:string]:unknown}>;
 annexes:Array<{id:string;title:string;sections:Array<{title:string;text:string;[key:string]:unknown}>;[key:string]:unknown}>;
 sources?:Array<{id:string;title:string;url?:string;summary?:string;[key:string]:unknown}>;[key:string]:unknown
}
export type SupplierReviewState='UNREVIEWED'|'PROPOSED'|'CONFIRMED'|'NEEDS_WORK';
export interface Author {name:string;organization:string;role:string}
export interface ResponseItem {id:string;text:string;comment:string;status:SupplierReviewState;reviewer:string;reviewedAt:string|null;evidenceIds:string[]}
export interface ResponseContent {respondent:Author&{notes:string};answers:ResponseItem[];annexes:Array<ResponseItem&{title:string}>}
export interface CompleteAttachment {id:string;sha256:string;name:string;mime:string;bytes:number;base64:string;description:string;addedBy:string}
export interface ResponseContext {
 source:{noticeId:string;entryId:string;sourceId:string;rowSha256:string;row:Record<string,string>;summary?:SourceEdition['summary']};
 workshare:WorkshareHistory
}
export interface ResponseDocument {
 schema:'starforge.canadabuys.response-review-document.v1';id:string;title:string;binding:ResponseBinding;master:ResponseMaster;
 workshare:WorkshareHistory;content:ResponseContent;attachments:CompleteAttachment[];merges:ResponseMerge[];
 createdAt:string;updatedAt:string;currentReviewContext:ResponseContext
}
export type ResponseRecord=BidderRecordMap['evidence'];
export interface SavedResponse {record:ResponseRecord;document:ResponseDocument;workspace:WorkspaceMetadata}
export interface AttributedEdition {revision:number;at:string;author:Author;note:string;content:ResponseContent;attachmentIds:string[];sha256:string}
export interface ResponseTransfer {
 schema:'starforge.canadabuys.response-review-transfer.v1';transferId:string;
 base:{workspaceId:string;record:ResponseRecord;document:ResponseDocument};
 draft:{content:ResponseContent;author:Author;note:string};attachments:CompleteAttachment[];editions:AttributedEdition[]
}
export type FieldStatus='UNCHANGED'|'RETURN_ONLY'|'CURRENT_ONLY'|'SAME'|'CONFLICT';
export interface FieldComparison {path:string;section:string;label:string;baseline:JSONValue;current:JSONValue;returned:JSONValue;status:FieldStatus}
export interface ContextChange<T> {baseline:T;current:T}
export interface ResponseComparison {
 rows:FieldComparison[];changedSource:ContextChange<ResponseContext['source']>|null;
 changedWorkshare:ContextChange<WorkshareHistory>|null;reviewSha256:string;contextSha256:string;returnReady:boolean
}
export interface IncomingReturn {
 transferId:string;sha256:string;author:Author;note:string;editions:number;
 attachments:Array<Omit<CompleteAttachment,'base64'>>;returnReady:boolean
}
export interface CompareResult {workspace:WorkspaceMetadata;current:{record:ResponseRecord;document:ResponseDocument};incoming:IncomingReturn;comparison:ResponseComparison}
export interface MutationBinding {workspaceId:string;expectedRevision:number;commandId:string}
export interface PrepareInput extends MutationBinding {master:ResponseMaster;workshareId:string;title?:string;allowHistoricalSource?:boolean}
export interface CompareInput {recordId:string;transfer:ResponseTransfer}
export interface ApplyInput extends MutationBinding,CompareInput {
 reviewSha256:string;choices:Record<string,'current'|'returned'>;
 acknowledgement:{source?:string;workshare?:string};reviewer:string;note?:string
}
export interface ReviewReset {group:'answers'|'annexes';id:string;reason:string}
export interface ResponseMerge {
 id:string;at:string;reviewer:string;note:string;baselineRevision:number;previousRevision:number;incomingSha256:string;transferId:string;
 returnedRecord:{id:string;revision:number;sha256:string;editionSha256:string};reviewSha256:string;choices:Record<string,'current'|'returned'>;
 acknowledgement:{source?:string;workshare?:string};context:ResponseContext;
 changedSource:ContextChange<ResponseContext['source']>|null;changedWorkshare:ContextChange<WorkshareHistory>|null;reviewResets:ReviewReset[]
}
export type PrepareResult=SavedResponse&{alreadyApplied?:boolean};
export type ApplyResult=PrepareResult&{returnedRecord:ResponseRecord;comparison:ResponseComparison&{reviewResets:ReviewReset[]}};
export interface ResponseStatus {schema:string;workspace:WorkspaceMetadata;
 records:Array<Pick<ResponseRecord,'id'|'title'|'noticeId'|'revision'|'updatedAt'|'sha256'|'bytes'>>;
 workshares:Array<Pick<WorkshareHistory,'id'|'noticeId'|'title'|'partner'|'currency'|'feeCents'|'revision'>>}
export declare function responseStatus(workspace:CanadaBuysWorkspace):ResponseStatus;
export declare function getResponseReview(workspace:CanadaBuysWorkspace,id:string,options?:{revision?:number}):SavedResponse;
export declare function prepareResponseReview(workspace:CanadaBuysWorkspace,input:PrepareInput):PrepareResult;
export declare function exportResponseReview(workspace:CanadaBuysWorkspace,id:string,options?:{revision?:number}):Promise<ResponseTransfer>;
export declare function compareResponseReturn(workspace:CanadaBuysWorkspace,input:CompareInput):Promise<CompareResult>;
export declare function applyResponseReturn(workspace:CanadaBuysWorkspace,input:ApplyInput):Promise<ApplyResult>;
export declare function responseMarkdown(workspace:CanadaBuysWorkspace,id:string,options?:{revision?:number}):Report;
