// MIT. Types for the original pure Flowable source-review engine.
export interface ProgrammeSourceMember {path:string;mediaType:string;text:string}
export interface ProgrammeSourceDraft {
 schema:'stellar-forge.flowable-programme-draft.v1';id:string;title:string;kind:'process'|'case'|'decision';
 operation:string;tenantId:string;catalogue:string;
 roles:{operator?:string;reviewer?:string;specialist?:string;approver?:string};
 familyKeys:string[];migrateKeys:string[];delegationKey:string;inputs:Record<string,string>;files:ProgrammeSourceMember[];
}
export type ProgrammeSourceHash=(bytes:Uint8Array)=>string|Promise<string>;
export interface ProgrammeSourceReviewOptions {hash?:ProgrammeSourceHash}
export type ProgrammeSourceChoice='KEEP_CURRENT'|'TAKE_RETURNED'|'USE_BASELINE';
export interface ProgrammeSourceIssueMetadata {id:string;at:string;label:string;issuer:string;recipient:string;note?:string}
export interface ProgrammeSourceReviewMetadata {id:string;at:string;reviewer:string;note?:string}
export interface ProgrammeSourceIssue extends Omit<ProgrammeSourceIssueMetadata,'note'> {note:string;authorDraftId:string;baselineSha256:string}
export interface ProgrammeSourceBody {sha256:string;mediaType:string;text:string}
export interface ProgrammeSourceSnapshot {sha256:string;draft:Omit<ProgrammeSourceDraft,'files'>&{files:{path:string;sourceSha256:string}[]}}
export interface ProgrammeSourceReturn extends Omit<ProgrammeSourceReviewMetadata,'note'> {note:string;localDraftId:string;issueSha256:string;snapshotSha256:string}
export interface ProgrammeSourcePacketIdentity {bytes:number;sha256:string}
export interface ProgrammeSourceAdoption extends Omit<ProgrammeSourceReviewMetadata,'note'> {
 note:string;issueSha256:string;returnId:string;returnRecordSha256:string;incomingPacket:ProgrammeSourcePacketIdentity;
 basisSha256:string;currentSha256:string;returnedSha256:string;resultSha256:string;choices:Record<string,ProgrammeSourceChoice>;
}
export interface ProgrammeSourceExchange {
 schema:'stellar-forge.flowable-programme-source-review.v1';issue:ProgrammeSourceIssue;
 blobs:ProgrammeSourceBody[];snapshots:ProgrammeSourceSnapshot[];returns:ProgrammeSourceReturn[];
 adoptions:ProgrammeSourceAdoption[];selectedReturnId:string|null;
}
export type ProgrammeSourceRowStatus='UNCHANGED'|'SAME_CHANGE'|'RETURNED_CHANGED'|'CURRENT_CHANGED'|'CONFLICT';
export interface ProgrammeSourceRowBase {key:string;label:string;status:ProgrammeSourceRowStatus;changed:boolean}
export interface ProgrammeSourceFileRow extends ProgrammeSourceRowBase {
 kind:'source';path:string;baseline:Omit<ProgrammeSourceBody,'sha256'>|null;
 current:Omit<ProgrammeSourceBody,'sha256'>|null;returned:Omit<ProgrammeSourceBody,'sha256'>|null;
}
export type ProgrammeSourceDraftOptions=Omit<ProgrammeSourceDraft,'schema'|'id'|'files'>;
export interface ProgrammeSourceOptionsRow extends ProgrammeSourceRowBase {
 kind:'options';baseline:ProgrammeSourceDraftOptions;current:ProgrammeSourceDraftOptions;returned:ProgrammeSourceDraftOptions;
}
export type ProgrammeSourceReviewRow=ProgrammeSourceFileRow|ProgrammeSourceOptionsRow;
export interface ProgrammeSourceComparison {
 issue:ProgrammeSourceIssue;returnRecord:ProgrammeSourceReturn;returns:ProgrammeSourceReturn[];
 incomingPacket:ProgrammeSourcePacketIdentity;basisSha256:string;currentSha256:string;returnedSha256:string;
 rows:ProgrammeSourceReviewRow[];exchange:ProgrammeSourceExchange;
}
export interface ProgrammeSourceAdoptionRequest extends ProgrammeSourceReviewMetadata {
 basisSha256:string;choices:Record<string,ProgrammeSourceChoice>;returnId?:string;
}
export interface ProgrammeSourceAdoptionResult {draft:ProgrammeSourceDraft;exchange:ProgrammeSourceExchange;adoption:ProgrammeSourceAdoption;replayed:boolean}
export interface ProgrammeSourceReviewWork {
 schema:'stellar-forge.flowable-programme-source-review-work.v1';mode:'author'|'reviewer';exchangeText:string;incomingText:string;
 issue:{label:string;issuer:string;recipient:string;note:string};review:{reviewer:string;note:string};adoption:{reviewer:string;note:string};
 basisSha256:string;choices:Record<string,ProgrammeSourceChoice>;selectedRow:string;selectedReturnId:string;
}
export const PROGRAMME_SOURCE_REVIEW_SCHEMA:'stellar-forge.flowable-programme-source-review.v1';
export const PROGRAMME_SOURCE_REVIEW_WORK_SCHEMA:'stellar-forge.flowable-programme-source-review-work.v1';
export const PROGRAMME_SOURCE_REVIEW_LIMIT:number;
export const PROGRAMME_SOURCE_REVIEW_CHOICES:readonly ProgrammeSourceChoice[];
export function createProgrammeSourceReviewWork():ProgrammeSourceReviewWork;
export function validateProgrammeSourceReviewWork(value:unknown):ProgrammeSourceReviewWork;
export function parseProgrammeSourceExchange(text:string,opts?:ProgrammeSourceReviewOptions):Promise<ProgrammeSourceExchange>;
export function serializeProgrammeSourceExchange(exchange:ProgrammeSourceExchange,opts?:ProgrammeSourceReviewOptions):Promise<string>;
export function createProgrammeSourceIssue(draft:ProgrammeSourceDraft,selection:ProgrammeSourceIssueMetadata,opts?:ProgrammeSourceReviewOptions):Promise<{exchange:ProgrammeSourceExchange;issue:ProgrammeSourceIssue}>;
export function programmeSourceReviewDraft(exchange:ProgrammeSourceExchange,selection?:{returnId?:string},opts?:ProgrammeSourceReviewOptions):Promise<ProgrammeSourceDraft>;
export function createProgrammeSourceReturn(exchange:ProgrammeSourceExchange,draft:ProgrammeSourceDraft,selection:ProgrammeSourceReviewMetadata,opts?:ProgrammeSourceReviewOptions):Promise<{exchange:ProgrammeSourceExchange;returnRecord:ProgrammeSourceReturn}>;
export function compareProgrammeSourceReturn(draft:ProgrammeSourceDraft,exchange:ProgrammeSourceExchange,returnedText:string,opts?:ProgrammeSourceReviewOptions&{returnId?:string}):Promise<ProgrammeSourceComparison>;
export function applyProgrammeSourceReturn(draft:ProgrammeSourceDraft,exchange:ProgrammeSourceExchange,returnedText:string,selection:ProgrammeSourceAdoptionRequest,opts?:ProgrammeSourceReviewOptions):Promise<ProgrammeSourceAdoptionResult>;
export function exportProgrammeSourceReviewBranch(exchange:ProgrammeSourceExchange,selection?:{adoptionId?:string;branch?:'baseline'|'current'|'returned'|'result';returnId?:string},opts?:ProgrammeSourceReviewOptions):Promise<ProgrammeSourceDraft>;
