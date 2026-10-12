// MIT. Appraisal request and response types for the original Research client.
export type Sha256 = string;
export type RiskDesign = 'randomized-parallel'|'randomized-cluster'|'randomized-crossover'|
  'nonrandomized-intervention'|'cohort'|'case-control'|'cross-sectional'|'diagnostic-accuracy'|
  'prognostic'|'systematic-review'|'other';
export type RiskSection = 'overview'|'reviews'|'protocols'|'studies'|'results'|'assessments'|
  'drafts'|'submissions'|'comparisons'|'adjudications'|'impact'|'operations'|'sources';
export type RiskAction = 'create-review'|'revise-protocol'|'create-assessment'|'revise-assessment'|
  'save-draft'|'submit-review'|'adjudicate'|'review-impact';
export interface RiskActor { id:string; name:string }
export interface RiskRights {
  basis:'original'|'license'|'permission'|'public_domain'|'reference_only';
  statement:string; url:string;
}
export interface RiskInstrument {
  id:string; title:string; version:string;
  origin:'published'|'reviewer_authored';
  sourceUrls:string[]; applicableDesigns:RiskDesign[]; scope:'study'|'result'; rights:RiskRights;
}
export interface RiskFormField {
  id:string; label:string; type:'text'|'choice'|'multi';
  choices:{id:string;label:string}[]; required:boolean; requiresEvidence:boolean; help:string;
}
export interface RiskFormDomain {
  id:string; title:string; description:string; requiresEvidence:boolean; fields:RiskFormField[];
}
export interface RiskForm {
  title:string; version:string; origin:'reviewer_authored'|'licensed_reproduction';
  sourceUrls:string[]; rights:RiskRights; domains:RiskFormDomain[];
  judgments:{id:string;label:string;description:string}[];
  requireDomainJudgments:boolean; requireOverall:boolean;
}
export interface RiskProtocolDefinition {
  name:string; description:string; instrument:RiskInstrument; form:RiskForm;
  reviewers:RiskActor[]; resolverIds:string[]; minimumReviewers:number; disagreementProcedure:string;
}
export interface RiskPassage {
  occurrenceId:string; locator:string; quote:string; jsonPointer:string; note:string;
  /** Exact named member of an original retained source bundle, when selected. */
  fileName?:string;
}
export interface RiskTarget {
  studyId:string; studyVersion:number; studySha256:Sha256;
  design:RiskDesign; designRationale:string; scope:'study'|'result';
  resultId:string|null; resultVersion:number|null; resultSha256:Sha256|null;
  occurrenceIds:string[]; designBasis:RiskPassage[];
}
export interface RiskAnswer {
  fieldId:string;
  status:'answered'|'not_reported'|'unavailable'|'not_applicable'|'unanswered';
  value:null|string|string[]; rationale:string; basis:RiskPassage[];
}
export interface RiskOverallJudgment {
  judgmentId:string;
  basisStatus:'supported'|'not_reported'|'unavailable'|'not_applicable';
  rationale:string; basis:RiskPassage[];
}
export interface RiskDomainJudgment extends RiskOverallJudgment { domainId:string }
export interface RiskDraftContent {
  assessmentId:string; assessmentEditionId:string;
  answers:RiskAnswer[]; judgments:RiskDomainJudgment[]; overall:RiskOverallJudgment|null;
  supersedes:string|null; reason:string;
}
export interface RiskAssessmentInput {
  name:string; protocolId:string; target:RiskTarget; reason:string;
}
export interface RiskRequestBase {
  requestId:string; expectedRevision:number; actor:RiskActor;
}
export type RiskRequest =
  | (RiskRequestBase & {action:'create-review';reviewId?:never;data:{
      questionId:string;eligibilityReviewId:string;name:string;description:string;protocol:RiskProtocolDefinition;
    }})
  | (RiskRequestBase & {action:'revise-protocol';reviewId:string;data:{
      protocol:RiskProtocolDefinition;reason:string;
    }})
  | (RiskRequestBase & {action:'create-assessment';reviewId:string;data:RiskAssessmentInput})
  | (RiskRequestBase & {action:'revise-assessment';reviewId:string;data:RiskAssessmentInput & {
      assessmentId:string;assessmentEditionId:string;
    }})
  | (RiskRequestBase & {action:'save-draft';reviewId:string;data:RiskDraftContent})
  | (RiskRequestBase & {action:'submit-review';reviewId:string;data:{
      assessmentId:string;assessmentEditionId:string;draftId:string;supersedes:string|null;reason:string;
    }})
  | (RiskRequestBase & {action:'adjudicate';reviewId:string;data:RiskDraftContent & {
      submissionIds:string[];expectedComparisonSha256:Sha256;
    }})
  | (RiskRequestBase & {action:'review-impact';reviewId:string;data:{
      impactId:string;fingerprint:Sha256;disposition:'reviewed'|'needs_review'|'out_of_scope';reason:string;
    }});
export interface RiskViewOptions {
  revision?:number; reviewId?:string; assessmentId?:string; assessmentEditionId?:string;
  section?:RiskSection; actorId?:string; offset?:number; limit?:number;
}
export interface RiskRecordIdentity {
  id:string; reviewId:string; createdAt:string; actor:RiskActor;
  originalRevision:number; revision:number;
}
export interface RiskProtocolRecord extends RiskRecordIdentity {
  edition:number; question:{id:string;text:string}; definition:RiskProtocolDefinition;
  supersedes:string|null; reason:string;
}
export interface RiskAssessmentRecord extends RiskRecordIdentity {
  editionId:string; version:number; questionId:string; name:string; protocolId:string;
  target:RiskTarget; supersedes:string|null; reason:string;
}
/** Complete original immutable source/reviewer record, including future source fields. */
export type RiskNativeRecord = Readonly<Record<string,unknown>>;
export interface RiskStudySelector {
  studyId:string; studyVersion:number; studySha256:Sha256; name:string;
  questionId:string; occurrenceIds:string[]; record:RiskNativeRecord;
}
export interface RiskResultSelector {
  resultId:string; resultVersion:number; resultSha256:Sha256; studyId:string; name:string;
  questionId:string; occurrenceIds:string[]; record:RiskNativeRecord;
}
export interface RiskComparison {
  sha256:Sha256; submissionIds:string[]; status:string;
  valueDisagreement:boolean; rationaleVariation:boolean;
  adjudication:RiskNativeRecord|null; adjudicationCurrent:boolean;
  [key:string]:unknown;
}
export interface RiskImpact {
  id:string; fingerprint:Sha256; kind:string; title:string;
  reviewId:string; assessmentId:string|null;
  before:unknown; after:unknown; lastReview:RiskNativeRecord|null; status:string;
}
export interface RiskView {
  schema:'sf88-research-risk-of-bias-view/v1'; dossierId:string; revision:number;
  section:RiskSection; reviewId:string|null; assessmentId:string|null;
  items:RiskNativeRecord[]; total:number; offset:number; limit:number; nextOffset:number|null;
  overview:RiskNativeRecord; review:RiskNativeRecord|null; protocol:RiskProtocolRecord|null;
  assessment:RiskAssessmentRecord|null; comparison:RiskComparison|null;
  actorDraft:RiskNativeRecord|null; actorSubmission:RiskNativeRecord|null;
}
export interface RiskOperation {
  schema:string; id:string; dossierId:string; requestId:string; requestSha256:Sha256;
  request:RiskRequest; reviewId:string; action:RiskAction; actor:RiskActor; createdAt:string;
  originalRevision:number; revision:number; originalRevisionSha256:Sha256; sha256:Sha256;
  result:{
    review?:RiskNativeRecord; protocol?:RiskProtocolRecord; assessment?:RiskAssessmentRecord;
    draft?:RiskNativeRecord; submission?:RiskNativeRecord; adjudication?:RiskNativeRecord;
    impactReview?:RiskNativeRecord;
  };
}
export interface RiskMutationResult {
  dossier:{id:string;revision:number;[key:string]:unknown};
  operation:RiskOperation; duplicate:boolean;
}
export interface RiskExportOptions extends Omit<RiskViewOptions,'offset'|'limit'> {
  format?:'json'|'csv'|'md'|'html'; file:string; expectedSha256?:Sha256; signal?:AbortSignal;
}
export interface RiskFileReceipt {
  file:string; filename:string; contentType:string; bytes:number; sha256:Sha256; revision:number;
}
/** Existing ResearchWorkspaceClient methods; listener ownership stays with that client. */
export interface OriginalResearchRiskClient {
  riskOfBias(dossierId:string,options?:RiskViewOptions):Promise<unknown>;
  reviewRiskOfBias(dossierId:string,request:RiskRequest):Promise<unknown>;
  exportRiskOfBias(dossierId:string,options:RiskExportOptions):Promise<unknown>;
}
export interface RiskOfBiasClient {
  view(dossierId:string,options?:RiskViewOptions):Promise<RiskView>;
  review(dossierId:string,request:RiskRequest):Promise<RiskMutationResult>;
  export(dossierId:string,options:RiskExportOptions):Promise<RiskFileReceipt>;
}
export declare const RISK_OF_BIAS_VIEW_SCHEMA:'sf88-research-risk-of-bias-view/v1';
export declare function createRiskOfBiasClient(client:OriginalResearchRiskClient):Readonly<RiskOfBiasClient>;
