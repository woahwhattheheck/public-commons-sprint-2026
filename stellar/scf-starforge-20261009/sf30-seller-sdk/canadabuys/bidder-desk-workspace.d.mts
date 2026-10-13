import type { ResponseDocument, ResponseComparison, ReviewReset } from './response-review/workspace.mjs';
import type { CanadaBuysWorkspace, WorkspaceMetadata } from './workspace.mjs';
import type { CapabilityProfile, CapabilityProfileInput, EvidenceDocument, EvidenceDocumentInput,
 RequirementAssessment, RequirementAssessmentInput, DecisionChoice, DecisionContext,
 CapabilityFit, DecisionContextComparison } from './bidder-desk-domain.mjs';
import type { DecisionReportRecord, DecisionNextAction, DecisionReportFormat } from './bidder-desk-reports.mjs';
export type BidderKind='profile'|'evidence'|'requirement'|'decision';
export type Saved<T>=Omit<T,'id'|'noticeId'|'revision'|'createdAt'|'updatedAt'|'operator'|'editionSha256'>&{
 id:string;noticeId:string|null;revision:number;createdAt:string;updatedAt:string;operator:string;editionSha256:string
};
export interface BidderAssessment extends CapabilityFit {
 reviewIssues:Array<{code:string;requirementId:string;message:string;evidenceId?:string;reviewedRevision?:number;currentRevision?:number;assessment?:string}>;
 requirements:{total:number;met:number;unresolved:number};
}
export interface BidDecision extends DecisionReportRecord {
 schema:'starforge.canadabuys.bid-decision.v1';editionSha256:string;
 context:DecisionContext;assessment:BidderAssessment;changes:DecisionContextComparison|null;
}
export interface BidderRecordMap {
 profile:Saved<CapabilityProfile>;evidence:Saved<EvidenceDocument>;requirement:Saved<RequirementAssessment>;decision:BidDecision;
}
export type BidderRecord=BidderRecordMap[BidderKind];
export interface DecisionSelection {
 noticeId:string;sourceEntryId:string;profileId:string;profileRevision:number;allowHistoricalEntry?:boolean
}
export interface DecisionInput extends DecisionSelection {
 /** Exact contextSha256 returned by assess. A changed reviewed context requires reassessment. */
 contextSha256:string;choice?:DecisionChoice;rationale:string;owner?:string;reviewedBy?:string;
 nextActions?:DecisionNextAction[];unknowns?:string[];conditions?:string
}
export interface BidderInputMap {
 profile:CapabilityProfileInput;
 evidence:EvidenceDocumentInput&{bodyBase64?:string;noticeId?:string|null};
 requirement:RequirementAssessmentInput&{noticeId:string};
 decision:DecisionInput;
}
export type BidderCreate<K extends BidderKind>=BidderInputMap[K]&{id?:string;expectedRevision:number;commandId?:string};
export type BidderPatch<K extends BidderKind>=Partial<BidderInputMap[K]>&{expectedRevision:number;commandId?:string};
export type BidderMutation<K extends BidderKind>={record:BidderRecordMap[K];workspace:WorkspaceMetadata;alreadyApplied?:boolean};
export type DecisionListRecord=Omit<BidDecision,'context'|'assessment'|'changes'>&{
 requirementCount:number;evidenceCount:number;fit:CapabilityFit['overall']|null;reviewIssueCount:number
};
export interface BidderPage<K extends BidderKind> {
 kind:K;records:Array<K extends 'decision'?DecisionListRecord:BidderRecordMap[K]>;
 page:{offset:number;limit:number;total:number;nextOffset:number|null}
}
export interface BidderDeskStatus {
 schema:typeof BIDDER_DESK_SCHEMA;workspace:WorkspaceMetadata;counts:Record<BidderKind,number>
}
export interface BidderAssessResult {
 context:DecisionContext;assessment:BidderAssessment;contextSha256:string;evaluatedAt:string
}
export interface BidderFitResult {
 profile:BidderRecordMap['profile'];results:Array<CapabilityFit&{
  noticeId:string;sourceEntryId:string;presentInLatestOpenFeed:boolean|null
 }>
}
export interface BidderCompareResult {
 decision:DecisionListRecord;changes:DecisionContextComparison;current:DecisionContext;assessment:BidderAssessment
}
export interface BidderDeskPackage {
 schema:typeof BIDDER_DESK_SCHEMA;packageSha256:string;
 records:Array<{kind:BidderKind;id:string;headRevision:number;editions:BidderRecord[]}>;
 bodies:Array<{sha256:string;bytes:number;base64:string}>;
 commands:Array<{id:string;fingerprint:string;result:{record:BidderRecord}|{record:BidderRecordMap['evidence'];document:ResponseDocument}|{record:BidderRecordMap['evidence'];document:ResponseDocument;returnedRecord:BidderRecordMap['evidence'];comparison:ResponseComparison&{reviewResets:ReviewReset[]}}}>;
}
export interface BidderReceiveResult {
 schema:typeof BIDDER_DESK_SCHEMA;status:'RECEIVED'|'REVIEW_REQUIRED';packageSha256?:string;
 recordsAdded?:number;editionsAdded?:number;commandsAdded?:number;
 conflicts:Array<{kind:BidderKind|'command';id:string;revision?:number;localSha256?:string;incomingSha256?:string;reason?:string}>;
 incoming?:BidderDeskPackage;message?:string;
}
export const BIDDER_DESK_SCHEMA:'starforge.canadabuys.bidder-desk.v1';
export const BIDDER_PACKAGE_SCHEMA:'starforge.canadabuys.package.v2';
export function validateDeskEnvelope(packet:unknown):BidderDeskPackage;
export function mergeBidderDeskPackages(packets:BidderDeskPackage[]):BidderDeskPackage;
export interface EvidenceIntakeInput {
 workspaceId:string;noticeId:string;expectedRevision:number;commandId:string;
 /** Fresh workspace guard for an explicit retry; original intake identity stays unchanged. */
 applyRevision?:number;
 documents:Array<Omit<EvidenceDocumentInput,'id'|'noticeId'|'revision'|'createdAt'|'updatedAt'|'operator'|'editionSha256'|'review'>&{
  bodyBase64:string;capturedAt:string;review?:{state:'UNREVIEWED';note?:string}
 }>;
}
export interface EvidenceIntakeResult {
 schema:'starforge.canadabuys.evidence-intake.v1';commandId:string;intakeSha256:string;noticeId:string;
 records:Array<BidderRecordMap['evidence']>;workspace:WorkspaceMetadata;alreadyApplied:boolean;
}
export class CanadaBuysBidderDesk {
 constructor(workspace:CanadaBuysWorkspace,options?:{maximumEvidenceBytes?:number});
 status():BidderDeskStatus;
 intakeEvidence(input:EvidenceIntakeInput):EvidenceIntakeResult;
 list<K extends BidderKind>(kind:K,options?:{noticeId?:string;offset?:number;limit?:number}):BidderPage<K>;
 get<K extends BidderKind>(kind:K,id:string,options?:{revision?:number;history?:false}):BidderRecordMap[K];
 get<K extends BidderKind>(kind:K,id:string,options:{revision?:number;history:true}):BidderRecordMap[K]&{history:BidderRecordMap[K][]};
 create<K extends BidderKind>(kind:K,input:BidderCreate<K>):BidderMutation<K>;
 update<K extends BidderKind>(kind:K,id:string,input:BidderPatch<K>):BidderMutation<K>;
 createDecision(input:BidderCreate<'decision'>):BidderMutation<'decision'>;
 updateDecision(id:string,input:BidderPatch<'decision'>):BidderMutation<'decision'>;
 evidenceFile(id:string,options?:{revision?:number}):{record:BidderRecordMap['evidence'];body:Uint8Array;mime:string;filename:string};
 fit(profileId:string,options?:{profileRevision?:number;noticeIds?:string[];now?:number|string}):BidderFitResult;
 assess(selection:DecisionSelection):BidderAssessResult;
 compareCurrent(id:string):BidderCompareResult;
 report(id:string,options?:{revision?:number;format?:DecisionReportFormat}):{body:string;mime:string;filename:string};
 exportData(options?:{noticeIds?:string[];all?:boolean}):BidderDeskPackage;
 /** Internal composition hook. Receive complete packages through CanadaBuysWorkspace.receivePackage. */
 receiveData(packet:BidderDeskPackage,options:{selectedNoticeIds:Set<string>}):BidderReceiveResult;
}
