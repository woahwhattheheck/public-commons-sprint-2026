// MIT. Native immutable returned-procedure records and original model types.
import type { OperatingPlanReturn, OperatingReturnComparison, OperatingReturnRow,
 OperatingReturnChoice, OperatingReturnJSON } from '../../distribution/discovery/operating-plan-return.mjs';
import type { OperatingPlan } from '../../distribution/discovery/operating-plan.mjs';
import type { DirectoryOperatingPlanRecord } from './directory_operating_plan.mjs';
export type { OperatingPlanReturn, OperatingReturnComparison, OperatingReturnRow, OperatingReturnChoice, OperatingReturnJSON };
export type SHA256=string;
export type DirectoryOperatingReturnStage='prepared'|'reviewed'|'completed'|'applied';
export type DirectoryOperatingReturnAction='prepare'|'revise'|'complete'|'receive'|'apply';
export interface DirectoryOperatingReturnAuthor{actor:string;note?:string}
export interface DirectoryOperatingReturnPrepareInput extends DirectoryOperatingReturnAuthor{
 recordId:SHA256;incoming:OperatingPlan;id:string;reviewer?:string;notes?:string;createdAt:string;
}
export interface DirectoryOperatingReturnReviseInput extends DirectoryOperatingReturnAuthor{
 recordId:SHA256;updates?:{reviewer?:string;notes?:string};
 decisions?:Array<{key:string;decision:null|{take:OperatingReturnChoice;value?:OperatingReturnJSON;note?:string}}>;
}
export interface DirectoryOperatingReturnCompleteInput extends DirectoryOperatingReturnAuthor{recordId:SHA256;savedAt:string}
export interface DirectoryOperatingReturnApplyInput extends DirectoryOperatingReturnAuthor{recordId:SHA256;expectedRecordId:SHA256}
export interface DirectoryOperatingReturnReceiveInput extends DirectoryOperatingReturnAuthor{currentRecordId:SHA256;review:OperatingPlanReturn}
export interface DirectoryOperatingReturnExportInput extends DirectoryOperatingReturnAuthor{
 recordId:SHA256;format:'json'|'html'|'plan';label?:string;
}
export interface DirectoryOperatingReturnInputs{
 prepare:DirectoryOperatingReturnPrepareInput;revise:DirectoryOperatingReturnReviseInput;
 complete:DirectoryOperatingReturnCompleteInput;apply:DirectoryOperatingReturnApplyInput;
 receive:DirectoryOperatingReturnReceiveInput;
}
export type DirectoryOperatingReturnAcceptedInput=DirectoryOperatingReturnInputs[keyof DirectoryOperatingReturnInputs]&{note:string};
export interface DirectoryOperatingReturnFile{sha256:SHA256;bytes:number;role:string}
export type DirectoryOperatingReturnSummary=OperatingReturnComparison['summary']&{
 reviewId:string;planId:string;incomingPlanId:string;relationship:OperatingReturnComparison['relationship'];
 commonRevision:number;currentRevision:number;incomingRevision:number;ready:boolean;issues:number;
 completed:boolean;resultRevision:number|null;reviewer:string;title:string;
}
export interface DirectoryOperatingReturnRecord{
 id:SHA256;createdAt:string;schema:'stellar-forge.directory-operating-return-record.v1';
 workspaceId:string;stage:DirectoryOperatingReturnStage;action:DirectoryOperatingReturnAction;
 requestSha256:SHA256;reviewId:string;planId:string;currentRecordId:SHA256;
 predecessorRecordId:SHA256|null;appliedPlanRecordId:SHA256|null;
 addedRevisions:number|null;alreadyPresent:boolean|null;
 summary:DirectoryOperatingReturnSummary;reviewDetails:{reviewer:string;notes:string;createdAt:string};
 files:Record<'review'|'comparison'|'input',DirectoryOperatingReturnFile>;
 basisSha256:SHA256;catalogSha256:SHA256;actor:string;note:string;
}
export interface DirectoryOperatingReturnSaved{record:DirectoryOperatingReturnRecord;reused:boolean;plan?:DirectoryOperatingPlanRecord}
export interface DirectoryOperatingReturnApplied extends DirectoryOperatingReturnSaved{plan:DirectoryOperatingPlanRecord}
export interface DirectoryOperatingReturnFilters{kind?:OperatingReturnRow['kind'];conflict?:boolean;unresolved?:boolean}
export interface DirectoryOperatingReturnPage{
 recordId:SHA256;reviewId:string;rows:OperatingReturnRow[];total:number;offset:number;limit:number;nextOffset:number|null;
 bytes:number;byteBudget:4194304;summary:OperatingReturnComparison['summary'];ready:boolean;issues:OperatingReturnComparison['issues'];
}
export interface DirectoryOperatingReturnExport{
 id:SHA256;createdAt:string;kind:'operating-return';recordId:SHA256;requestSha256:SHA256;
 label:string;actor:string;note:string;name:string;contentType:string;file:DirectoryOperatingReturnFile;
 result:{reviewId:string;planId:string;stage:DirectoryOperatingReturnStage;format:'json'|'html'|'plan';completeHistories:boolean};
}
