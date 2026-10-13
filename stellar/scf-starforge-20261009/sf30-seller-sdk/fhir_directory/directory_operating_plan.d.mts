// MIT. Complete types over the unchanged original OperatingPlan model.
import type {CommandCatalog} from '../../distribution/discovery/catalog.mjs';
import type {OperatingPlan,OperatingPlanDraft,OperatingPlanSummary,OperatingComparison,OperatingStep} from '../../distribution/discovery/operating-plan.mjs';
export type {OperatingPlan,OperatingPlanDraft,OperatingPlanSummary,OperatingComparison,OperatingStep};
export type Json=null|boolean|number|string|Json[]|{[key:string]:Json};
export type SHA256=string;
export const DIRECTORY_OPERATING_BASIS:'stellar-forge.directory-operating-basis.v1';
export const DIRECTORY_PLAN_RESULT:'stellar-forge.directory-operating-preview.v1';
export const MAX_PLAN_BYTES:number;
export interface DirectoryOperatingFile {sha256:SHA256;bytes:number;role:string}
export interface DirectoryOperatingReference {kind:string;id:SHA256;sha256:SHA256}
export interface DirectoryOperatingObservation {
 key:string;title:string;kind:string;id:SHA256;status:'planned'|'in-progress'|'completed'|'skipped';
 summary:Json;files:Json;links:Json;recordedResult:string;
 instruction?:string;expectedResult?:string;
}
export type DirectoryOperatingPlanCreateInput={"id":string;"title":string;"customer":string;"purpose"?:string;"period":string;"owner":string;"receiving":string;"notes"?:string;"savedAt":string;"basis":{"editionId":string;"mappingId"?:string|null;"previewId"?:string|null;"conversionId"?:string|null;"selectionId"?:string|null;"referralJoinId"?:string|null;"handoffId"?:string|null;"contextSourceIds"?:Array<string>;"comparisonIds"?:Array<string>;"conformanceAssessmentIds"?:Array<string>;"receivingReviewIds"?:Array<string>};"outputDirectory":string;"recorded"?:boolean;"continuations"?:Array<{"id":string;"title":string;"instruction":string;"inputs"?:string;"expectedResult"?:string;"owner"?:string;"due"?:string;"argv"?:Array<string>}>;"actor":string;"note"?:string;"previewRecordId"?:string};
export type DirectoryOperatingPlanSaveInput={"recordId":string;"draft":{"schema":"stellar-forge.operating-plan-draft.v1";"planId":string;"baseRevision":number;"content":{"title":string;"customer":string;"purpose":string;"period":string;"owner":string;"receiving":string;"notes":string;"steps":Array<{"id":string;"title":string;"instruction":string;"inputs":string;"expectedResult":string;"owner":string;"due":string;"status":"planned"|"in-progress"|"completed"|"skipped";"recordedResult":string;"argv":Array<string>;"selection":{"package":{};"capturedAt":string|null;"item":{};"sources":Array<{}>;"runtimeGroups":Array<{}>}|null}>}};"savedAt":string;"actor":string;"note"?:string};
export type DirectoryOperatingPlanReceiveInput={"document":{"schema":"stellar-forge.operating-plan.v1";"id":string;"createdAt":string;"origin":{"id":string;"revision":number;"createdAt":string}|null;"revisions":Array<{"title":string;"customer":string;"purpose":string;"period":string;"owner":string;"receiving":string;"notes":string;"steps":Array<{"id":string;"title":string;"instruction":string;"inputs":string;"expectedResult":string;"owner":string;"due":string;"status":"planned"|"in-progress"|"completed"|"skipped";"recordedResult":string;"argv":Array<string>;"selection":{"package":{};"capturedAt":string|null;"item":{};"sources":Array<{}>;"runtimeGroups":Array<{}>}|null}>;"revision":number;"savedAt":string}>};"expectedRecordId":string|null;"basis"?:{"editionId":string;"mappingId"?:string|null;"previewId"?:string|null;"conversionId"?:string|null;"selectionId"?:string|null;"referralJoinId"?:string|null;"handoffId"?:string|null;"contextSourceIds"?:Array<string>;"comparisonIds"?:Array<string>;"conformanceAssessmentIds"?:Array<string>;"receivingReviewIds"?:Array<string>};"actor":string;"note"?:string};
export type DirectoryOperatingPlanCopyInput={"recordId":string;"id":string;"title"?:string;"savedAt":string;"actor":string;"note"?:string};
export type DirectoryOperatingPlanCompareInput={"recordId":string;"revision"?:number};
export type DirectoryOperatingPlanExportInput={"recordId":string;"format":"json"|"markdown"|"html";"revision"?:number;"label"?:string;"actor":string;"note"?:string};
export type DirectoryOperatingPlanStepInput={"id":string;"title"?:string;"instruction"?:string;"inputs"?:string;"expectedResult"?:string;"owner"?:string;"due"?:string;"status"?:"planned"|"in-progress"|"completed"|"skipped";"recordedResult"?:string;"argv"?:Array<string>;"itemId"?:string|null};
export type DirectoryOperatingBasisSelection=DirectoryOperatingPlanCreateInput['basis'];
export interface DirectoryOperatingBasis {
 schema:'stellar-forge.directory-operating-basis.v1';workspaceId:string;workspace:string;observedAt:string;
 selection:DirectoryOperatingBasisSelection;recordRefs:DirectoryOperatingReference[];recordRefsSha256:SHA256;
 observations:DirectoryOperatingObservation[];findings:string[];
}
export interface DirectoryOperatingPlanRecord {
 schema:'stellar-forge.directory-operating-plan-record.v1';id:SHA256;createdAt:string;
 workspaceId:string;stage:'prepared'|'saved';planId:string;revision:number;
 predecessorRecordId:SHA256|null;preparedFromId:SHA256|null;originRecordId:SHA256|null;
 action:'preview'|'create'|'save'|'receive'|'copy';requestSha256:SHA256;
 summary:OperatingPlanSummary;actor:string;note:string;
 files:Record<'document'|'basis'|'catalog'|'input',DirectoryOperatingFile>;
}
export interface DirectoryOperatingPreview {
 schema:'stellar-forge.directory-operating-preview.v1';workspaceId:string;
 record:DirectoryOperatingPlanRecord;basis:DirectoryOperatingBasis;
 document:OperatingPlan;summary:OperatingPlanSummary;
}
export interface DirectoryOperatingSaved {
 record:DirectoryOperatingPlanRecord;reused:boolean;addedRevisions:number;
}
export interface DirectoryOperatingBinding {
 workspaceId:string;originalWorkspace:string;currentWorkspace:string;relocated:boolean;observedAt:string;
 records:Array<{kind:string;id:SHA256;state:'unchanged'|'missing'|'changed';originalSha256:SHA256;currentSha256:SHA256|null}>;
}
export interface DirectoryOperatingComparison extends OperatingComparison {
 recordId:SHA256;directoryBinding:DirectoryOperatingBinding;
}
export interface DirectoryOperatingExport {
 id:SHA256;createdAt:string;kind:'operating-plan';recordId:SHA256;requestSha256:SHA256;
 label:string;actor:string;note:string;name:string;contentType:string;file:DirectoryOperatingFile;
 result:{planId:string;revision:number;revisions:number;format:'json'|'markdown'|'html';completeHistory:boolean};
}
export function inspectDirectoryOperatingBasis(value:unknown):DirectoryOperatingBasis;
export function createDirectoryOperatingPlan(options:{
 catalog:CommandCatalog;input:DirectoryOperatingPlanCreateInput;basis:DirectoryOperatingBasis
}):OperatingPlan;
