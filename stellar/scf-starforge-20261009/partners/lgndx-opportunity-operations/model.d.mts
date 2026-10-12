// MIT. Public source-bound procurement workspace facade.
export type SourceRole = 'company'|'past_performance'|'award_background'|'solicitation'|'amendment'|'question_response'|'partner'|'other';
export type DeliveryStatus = 'unspecified'|'deployed'|'pilot'|'proposed';
export type CoverageDecision = 'unreviewed'|'supported'|'partial'|'gap'|'team_required'|'exception';
export interface EvidenceInput {sourceId:string; locator:string; excerpt?:string}
export interface Evidence extends EvidenceInput {
  excerpt:string; sha256:string; dossierRevision:number; editionIds:string[]; occurrenceIds:string[];
}
export interface Source {
  id:string; role:SourceRole; title:string; url:string; capturedAt:string; filename:string;
  mediaType:string; sourceTerms:string; sha256:string; bytes:number; replacesSourceId:string|null;
  storage:'retained'|'usaspending'; dossierId:string; dossierRevision:number; questionId:string;
  editionIds:string[]; occurrenceIds:string[]; editionBindings:Array<{id:string;sha256:string;bytes:number}>;
  supersededBy?:string[];
  award?:{sourceSignature:string;editionId:string;editionSha256:string;firstPacketSha256:string;
    rowCount:number;sourcePageCount:number;coverage:Record<string,unknown>;warnings:unknown[]};
}
export interface Company {name:string;website:string;uei:string;naics:string[];size:string;description:string}
export interface Opportunity {
  title:string;buyer:string;reference:string;url:string;
  documentKind:'rfi'|'sources_sought'|'solicitation'|'implementation_target'|'other';
  stage:'research'|'qualifying'|'preparing'|'submitted'|'closed';dueAt:string;timeZone:string;notes:string;
}
export interface ResponseRules {
  maxPages:number|null;capabilityMaxPages:number|null;excludedSections:string[];notes:string;
  evidence:Evidence[];reviewRequired?:boolean;
}
export interface RecordMetadata {
  id:string;version:number;createdAt:string;createdBy:string;updatedAt:string;updatedBy:string;
  evidence:Evidence[];reviewRequired?:boolean;
}
export interface Capability extends RecordMetadata {
  title:string;kind:'capability'|'past_performance';description:string;owner:string;
  status:'draft'|'reviewed'|'retired';deliveryStatus:DeliveryStatus;tags:string[];
}
export interface Requirement extends RecordMetadata {
  number:string;title:string;text:string;category:string;mandatory:boolean;owner:string;
  responseDisposition:'unanswered'|'answer'|'not_applicable';evidenceRule:'any'|'deployed_only';
  status:'open'|'in_progress'|'reviewed'|'retired';
}
export interface Coverage extends RecordMetadata {
  requirementId:string;requirementVersion:number;decision:CoverageDecision;capabilityIds:string[];teamIds:string[];
  owner:string;response:string;reviewNote:string;
  capabilityVersions:Array<{id:string;version:number}>;teamVersions:Array<{id:string;version:number}>;reviewReasons?:string[];
}
export interface Team extends RecordMetadata {
  name:string;role:string;decision:'considering'|'contacted'|'confirmed'|'declined';owner:string;scope:string;
  note:string;capabilityIds:string[];requirementIds:string[];
}
export interface Milestone extends RecordMetadata {
  title:string;owner:string;dueAt:string;timeZone:string;status:'open'|'in_progress'|'done'|'cancelled';
  dependsOn:string[];requirementIds:string[];note:string;blocked?:boolean;overdue?:boolean;
}
export interface Question extends RecordMetadata {
  number:string;text:string;owner:string;dueAt:string;status:'open'|'submitted'|'answered'|'parked';
  answer:string;requirementIds:string[];
}
export interface SourceChange {
  id:string;beforeSourceId:string;afterSourceId:string;status:'pending'|'reviewed';decision:string;note:string;
  affectedIds:string[];contentChanged:boolean;beforeSha256:string;afterSha256:string;
  createdAt:string;createdBy:string;reviewedAt:string|null;reviewedBy:string|null;
}
export interface HandoffRecord {
  id:string;title:string;status:'draft'|'ready_for_review'|'approved_for_handoff';note:string;
  createdAt:string;createdBy:string;revision:number;sourceRevision:number;sourceStateSha256:string;sha256:string;
}
export interface HistoryRecord {revision:number;createdAt:string;operator:string;action:string;requestId:string|null;sha256:string}
export interface Readiness {
  status:'review_required'|'recorded';unresolvedItems:number;issues:string[];responseRules:ResponseRules;pageReview:string;
}
export interface Project {
  schema:'stellar-forge.opportunity-workspace.v1';id:string;title:string;description:string;revision:number;
  createdAt:string;updatedAt:string;company:Company;opportunity:Opportunity;
  dossier:{id:string;revision:number;questionId:string};responseRules:ResponseRules;sources:Source[];
  capabilities:Capability[];requirements:Requirement[];coverage:Coverage[];teaming:Team[];milestones:Milestone[];
  questions:Question[];changes:SourceChange[];packages:HandoffRecord[];history:HistoryRecord[];readiness:Readiness;
  summary:Record<string,number|{id:string;title:string;dueAt:string;timeZone:string}|null>;
}
export interface Mutation {id:string;expectedRevision:number;requestId?:string}
export interface CreateInput {
  title:string;description?:string;company?:Partial<Company>;opportunity?:Partial<Opportunity>;requestId?:string;
  responseRules?:Partial<Omit<ResponseRules,'evidence'>>&{evidence?:EvidenceInput[]};
}
export interface UpdateInput extends Mutation {
  title?:string;description?:string;company?:Partial<Company>;opportunity?:Partial<Opportunity>;
  responseRules?:Partial<Omit<ResponseRules,'evidence'>>&{evidence?:EvidenceInput[]};
}
export type SourceInput = Mutation & {
  role:SourceRole;title:string;url?:string;capturedAt:string;filename:string;mediaType?:string;
  sourceTerms?:string;replacesSourceId?:string;
} & ({contentText:string;contentBase64?:never}|{contentBase64:string;contentText?:never});
type EntityInput<T> = Partial<Omit<T,keyof RecordMetadata>>&{evidence?:EvidenceInput[]};
export interface ActionInputs {
  create:CreateInput;update:UpdateInput;retain_source:SourceInput;
  import_award_edition:Mutation&{packet?:Record<string,unknown>;editionId?:string;label?:string};
  save_capability:Mutation&EntityInput<Capability>&{capabilityId?:string};
  save_requirement:Mutation&EntityInput<Requirement>&{requirementId?:string};
  save_coverage:Mutation&EntityInput<Coverage>&{requirementId:string};
  save_team:Mutation&EntityInput<Team>&{teamId?:string};
  save_milestone:Mutation&EntityInput<Milestone>&{milestoneId?:string};
  save_question:Mutation&EntityInput<Question>&{questionId?:string};
  review_change:Mutation&{changeId:string;status:'pending'|'reviewed';decision:string;note:string;affectedIds?:string[]};
  create_package:Mutation&{title:string;status?:HandoffRecord['status'];note?:string};
}
export interface SourceRead {source:Source;contentBase64:string;contentText:string|null}
export interface PortableFile {path:string;mediaType:string;bytes:number;sha256:string;contentBase64:string}
export interface HandoffSnapshot {
  schema:'stellar-forge.opportunity-handoff.v1';id:string;projectId:string;sourceRevision:number;
  sourceStateSha256:string;title:string;status:HandoffRecord['status'];note:string;operator:string;createdAt:string;
  dossierExportedAt:string;project:Project;readiness:Readiness;files:PortableFile[];sha256:string;
}
export interface OpportunityPackage {
  schema:'stellar-forge.opportunity-package.v1';projectId:string;revision:number;createdAt:string;
  selectedPackageId:string|null;project:Project;versions:Array<{sha256:string;state:Record<string,unknown>}>;
  dossier:Record<string,unknown>;sealedPackages:HandoffSnapshot[];files:PortableFile[];sha256:string;
}
export interface ProjectSummary {
  id:string;title:string;revision:number;updatedAt:string;company:Company;opportunity:Opportunity;summary:Project['summary'];
}
export interface OpportunityStore {
  readonly directory:string;readonly operator:string;
  list():Promise<ProjectSummary[]>;get(id:string,options?:{revision?:number}):Promise<Project>;
  dispatch<A extends keyof ActionInputs>(action:A,payload:ActionInputs[A]):Promise<Project>;
  dispatch(action:'get'|'open',payload:{id:string;revision?:number}):Promise<Project>;
  dispatch(action:'list',payload?:Record<string,never>):Promise<ProjectSummary[]>;
  dispatch(action:'source'|'read_source',payload:{id:string;sourceId:string;revision?:number}):Promise<SourceRead>;
  dispatch(action:'compare',payload:{id:string;before:number;after:number}):Promise<Record<string,unknown>>;
  compare(id:string,options:{before:number;after:number}):Promise<Record<string,unknown>>;
  exportPackage(id:string,options?:{revision?:number;packageId?:string}):Promise<OpportunityPackage>;
  importPackage(packet:OpportunityPackage):Promise<Project>;close():Promise<void>;
}
export declare const OPPORTUNITY_SCHEMA:'stellar-forge.opportunity-workspace.v1';
export declare class OpportunityError extends Error {
  code:string;status:number;details:Record<string,unknown>;
  constructor(code:string,message?:string,status?:number,details?:Record<string,unknown>);
  toJSON():{error:string;message:string;details:Record<string,unknown>};
}
export declare function openOpportunityStore(options:{
  directory:string;operator:string;dossierDirectory?:string;awardDirectory?:string;
}):Promise<OpportunityStore>;
