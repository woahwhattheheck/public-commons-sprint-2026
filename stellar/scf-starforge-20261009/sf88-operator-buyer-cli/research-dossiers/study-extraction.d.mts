/** MIT. Complete source-bound study extraction contract. */
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type TypedValue = ['number',string] | ['str',string] | ['bool',boolean] |
  ['NoneType',null] | ['array',TypedValue[]] | ['object',Array<[string,TypedValue]>];
export interface Actor { id:string; name:string }
export type ValueStatus='reported'|'derived'|'not-estimable'|'not-reported'|'not-applicable'|'uncertain';
export type ValueType='text'|'decimal'|'integer'|'boolean'|'choice'|'multi-choice'|'json';
export interface Field {
  id:string; label:string; valueType:ValueType; required:boolean; instructions?:string; unit?:string;
  choices?:Array<{id:string;label:string}>;
}
export interface FormDefinition {
  fields:Field[]; reviewers:Actor[]; extractorIds:string[]; resolverIds:string[];
  minimumExtractions:number; disagreementProcedure:string;
}
export interface SourceOccurrence {
  occurrenceId:string; editionId:string; questionId:string; key:string; sourceId:string; title:string;
  url:string; doi:string|null; provider:string; sourceSha256:string; sourceBytes:number;
  contentDigest:string; publishedAt:string|null; sourceReference:string; editionLabel:string;
}
export type BasisInput =
  {occurrenceId:string;kind:'json-pointer';pointer:string;fileName?:string} |
  {occurrenceId:string;kind:'passage';locator:string;quote?:string;fileName?:string};
export interface OriginalFile {name:string;sha256:string;bytes:number;mediaType:string|null}
export type SourceBinding = SourceOccurrence & (
  {kind:'json-pointer';pointer:string;file?:OriginalFile;contentSha256:string;contentBytes:number;
   parser:{module:string;sha256:string};found:boolean;typedValue?:TypedValue} |
  {kind:'passage';locator:string;quote:string;file?:OriginalFile;quoteMatched:boolean|null}
);
export interface Derivation {method:string;inputFieldIds:string[];expression?:string;reference?:string}
export interface AnswerInput {
  rowId:string;fieldId:string;status:ValueStatus;value:TypedValue;bases?:BasisInput[];
  context?:{[key:string]:Json};note?:string;derivation?:Derivation;
}
export interface Answer extends Omit<AnswerInput,'bases'|'context'|'note'> {
  bases:SourceBinding[];context:{[key:string]:Json};note:string;chosenSubmissionId?:string;
  sourceDifferences:Array<{occurrenceId:string;pointer:string;file?:OriginalFile;reported:TypedValue;entered:TypedValue}>;
}
export interface ResultRowInput {id:string;label:string;context?:{[key:string]:Json};occurrenceIds:string[]}
export interface ResultRow {id:string;label:string;context:{[key:string]:Json};sources:SourceOccurrence[]}
export interface CommonRecord {actor:Actor;createdAt:string;originalRevision:number;revision:number}
export interface Form extends CommonRecord {id:string;questionId:string}
export interface FormEdition extends CommonRecord {
  id:string;formId:string;version:number;question:{id:string;text:string};name:string;
  description:string;definition:FormDefinition;reason:string;previous:string|null;
}
export interface Study {
  id:string;reviewId:string;questionId:string;version:number;name:string;occurrenceIds:string[];
  sources:SourceOccurrence[];evidence:Array<{occurrenceId:string;locator:string;note:string}>;
  reason:string;previous:{version:number;sha256:string}|null;actor:Actor;createdAt:string;
  [key:string]:unknown;
}
export interface ResultSet extends CommonRecord {
  id:string;formEditionId:string;questionId:string;study:Study;name:string;description:string;
  rows:ResultRow[];editionIds:string[];supersedes:string|null;reason:string;
}
export interface Extraction extends CommonRecord {
  id:string;resultSetId:string;formEditionId:string;version:number;supersedes:string|null;
  answers:Answer[];reason:string;
}
export interface Submission extends CommonRecord {
  id:string;resultSetId:string;extractionId:string;extractionSha256:string;supersedes:string|null;reason:string;
}
export interface Comparison {
  fieldId:string;label:string;required:boolean;status:'MISSING'|'INCOMPLETE'|'AGREEMENT'|'DISAGREEMENT';
  sourceAgreement:boolean;
  entries:Array<{submissionId:string;extractionId:string;actor:Actor;answer:Answer|null}>;
}
export interface Resolution extends CommonRecord {
  id:string;resultSetId:string;rowId:string;mode:'consensus'|'adjudication';submissionIds:string[];
  submissionSha256:string;comparison:Comparison[];answers:Answer[];supersedes:string|null;reason:string;
}
export type ResultStatus='RESOLVED'|'STALE_RESOLUTION'|'NOT_EXTRACTED'|'NEEDS_REVIEW'|'DISAGREEMENT'|'READY_FOR_RESOLUTION';
export interface ResultRecord {
  resultSet:{id:string;name:string};row:ResultRow;
  form:{id:string;edition:number;name:string;definition:FormDefinition};study:Study;
  submissions:Array<{id:string;actor:Actor;submittedAt:string;extractionId:string;reason:string;values:Record<string,Answer>}>;
  comparison:Comparison[];resolution:Resolution|null;resolutionHistory:Resolution[];
  values:Record<string,Answer>|null;status:ResultStatus;createdAt:string;originalRevision:number;revision:number;
}
export interface ResultEdition {
  resultId:string;editionId:string;questionId:string;studyId:string;label:string;status:ResultStatus;
  current:boolean;sourceBindings:Array<SourceOccurrence|SourceBinding>;record:ResultRecord;
}
export interface ImpactReview extends CommonRecord {
  id:string;impactId:string;resultSetId:string;fingerprint:string;disposition:'retain'|'revise'|'replaced';
  receivingResultSetId:string|null;observation:{kind:string;previous:unknown;current:unknown};reason:string;
}
export interface Impact {
  id:string;resultSetId:string;resultIds:string[];questionId:string;kind:string;
  previous:unknown;current:unknown;fingerprint:string;review:ImpactReview|null;
}
export interface UnresolvedResult {
  resultId:string;editionId:string;resultSetId:string;questionId:string;studyId:string;label:string;status:ResultStatus;
  missingReviewerIds:string[];minimumExtractions:number;submittedCount:number;disagreementFieldIds:string[];missingFieldIds:string[];
}
interface RequestBase {requestId:string;expectedRevision:number;actor:Actor}
export type ResolutionChoice =
  {fieldId:string;submissionId:string} |
  {fieldId:string;answer:Omit<AnswerInput,'rowId'|'fieldId'>};
export type ExtractionRequest = RequestBase & (
  {action:'create-form';data:{questionId:string;name:string;description?:string;definition:FormDefinition;reason:string}} |
  {action:'revise-form';data:{formId:string;previousEditionId:string;name:string;description?:string;definition:FormDefinition;reason:string}} |
  {action:'create-result-set';data:{formEditionId:string;studyId:string;studyVersion:number;name:string;
    description?:string;rows:ResultRowInput[];reason:string;supersedes?:string}} |
  {action:'save-extraction';data:{resultSetId:string;answers:AnswerInput[];reason:string;supersedes?:string}} |
  {action:'submit-extraction';data:{extractionId:string;reason:string}} |
  {action:'resolve-result';data:{resultSetId:string;rowId:string;submissionIds:string[];mode:'consensus'|'adjudication';
    answers?:ResolutionChoice[];reason:string;supersedes?:string}} |
  {action:'review-impact';data:{impactId:string;expectedFingerprint:string;disposition:'retain'|'revise'|'replaced';
    reason:string;resultSetId?:string}}
);
export interface Operation {
  schema:'sf88-research-study-extraction-operation/v1';id:string;requestId:string;requestSha256:string;
  request:ExtractionRequest;action:ExtractionRequest['action'];actor:Actor;originalRevision:number;revision:number;
  originalRevisionSha256:string;createdAt:string;sha256:string;result:{
    form?:Form;formEdition?:FormEdition;resultSet?:ResultSet;extraction?:Extraction;submission?:Submission;
    resolution?:Resolution;impactReview?:ImpactReview;
  };
}
export interface DossierState {
  id:string;title:string;revision:number;previous:string|null;questions:Array<{id:string;text:string}>;
  extractionEvents?:Operation[];[key:string]:unknown;
}
export interface ExtractionModel {
  forms:Form[];formEditions:FormEdition[];resultSets:ResultSet[];extractions:Extraction[];
  submissions:Submission[];resolutions:Resolution[];impactReviews:ImpactReview[];operations:Operation[];
  results:ResultEdition[];impact:Impact[];unresolved:UnresolvedResult[];
  occurrences:Map<string,SourceOccurrence>;studies:Study[];studyHistory:Study[];
}
export interface PublicationContext {
  dossierId:string;revision:number;results:ResultEdition[];impacts:Impact[];unresolved:UnresolvedResult[];
}
export type Section='overview'|'forms'|'formEditions'|'resultSets'|'extractions'|'submissions'|'results'|
  'resolutions'|'impact'|'operations'|'occurrences'|'studies';
export interface Selection {formId?:string;resultSetId?:string}
export interface PageOptions extends Selection {section?:Section;offset?:number;limit?:number}
export interface Overview {
  schema:'sf88-research-study-extraction/v1';dossierId:string;revision:number;formCount:number;resultSetCount:number;
  resultCount:number;resultEditionCount:number;studyCount:number;retainedOccurrenceCount:number;draftCount:number;
  submissionCount:number;resolutionCount:number;statuses:Partial<Record<ResultStatus,number>>;
  unresolved:UnresolvedResult[];impactCount:number;unreviewedImpactCount:number;
}
export interface Page {
  schema:'sf88-research-study-extraction/v1';dossierId:string;revision:number;section:Section;
  overview:Overview;offset:number;limit:number;total:number;items:unknown[];nextOffset:number|null;complete:boolean;
}
export interface SourceOptions {python?:string;signal?:AbortSignal;timeoutMs?:number;resolveSourcePointers?:(
  input:{rawText:string;expectedSha256:string;expectedBytes:number;pointers:string[]},
  options?:{python?:string;signal?:AbortSignal;timeoutMs?:number}
)=>Promise<{sourceSha256:string;sourceBytes:number;parser:{module:string;sha256:string};
  values:Array<{pointer:string;found:boolean;typedValue?:TypedValue}>}>}
export const EXTRACTION_SCHEMA:'sf88-research-study-extraction/v1';
export const EXTRACTION_OPERATION_SCHEMA:'sf88-research-study-extraction-operation/v1';
export const EXTRACTION_ACTIONS:readonly ExtractionRequest['action'][];
export const EXTRACTION_SECTIONS:readonly Section[];
export const EXTRACTION_VALUE_STATUSES:readonly ValueStatus[];
export function extractionDigest(value:unknown):string;
export function extractionInput(input:unknown):ExtractionRequest;
export function extractionTypedValue(input:unknown):TypedValue;
export function extractionDefinition(input:unknown):FormDefinition;
export function studyExtractionModel(state:DossierState,projected:Map<string,unknown>):ExtractionModel;
export function extractionPublicationContext(state:DossierState,model:ExtractionModel):PublicationContext;
export function extractionSourcePointers(state:DossierState,projected:Map<string,unknown>,
  input:{occurrenceId:string;pointers:string[];fileName?:string},options?:SourceOptions):Promise<{
  schema:'sf88-research-extraction-source-values/v1';dossierId:string;revision:number;
  occurrence:SourceOccurrence;values:SourceBinding[];
}>;
export function recordStudyExtractionOperation(state:DossierState,projected:Map<string,unknown>,
  input:ExtractionRequest,createdAt:string,options?:SourceOptions):Promise<Operation>;
export function extractionOverview(state:DossierState,model:ExtractionModel,options?:Selection):Overview;
export function extractionPage(state:DossierState,model:ExtractionModel,options?:PageOptions):Page|(Overview&{section:'overview';complete:true});
export function extractionReport(state:DossierState,model:ExtractionModel,options?:Selection):Record<string,unknown>;
export function validateStudyExtractionState(state:DossierState):void;
export function validateStudyExtractionTransition(previous:DossierState|null,state:DossierState,
  projected?:Map<string,unknown>,options?:SourceOptions):Promise<void>;
