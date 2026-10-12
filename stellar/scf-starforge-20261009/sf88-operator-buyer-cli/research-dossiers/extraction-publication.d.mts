import type {Buffer} from 'node:buffer';

export type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export type JsonObject={[key:string]:JsonValue};
/** Original tagged values. Numeric payload tokens remain strings under the original engine's tags. */
export type TaggedValue=[tag:string,payload:JsonValue];
export type PublicationFormat='json'|'csv'|'markdown'|'md'|'html';
export type PublicationSection='overview'|'tables'|'table-editions'|'results'|'publications'|'rows'|
  'impact'|'reviews'|'withdrawals'|'operations'|'comparison';
export type PublicationDisposition='reviewed'|'needs_review'|'not_applicable';
export interface PublicationActor {id:string;name:string}
export interface PublicationColumn {
  id:string;label:string;pointer:string;format?:'text'|'typed'|'json';description?:string;
}
export interface PublicationTableDefinition {
  name:string;description?:string;questionIds?:string[];columns:PublicationColumn[];notes?:string;
}
export interface NormalizedPublicationDefinition {
  name:string;description:string;questionIds:string[];
  columns:Array<Required<PublicationColumn>>;notes:string;
}
export interface PublicationResultSelection {resultId:string;editionId:string;fingerprint:string}
export interface PublicationReviewInput {contextFingerprint:string;note:string}
export type PublicationRequest={
  requestId:string;expectedRevision:number;actor:PublicationActor;
}&(
  {action:'create-table';data:{definition:PublicationTableDefinition}}|
  {action:'revise-table';data:{tableId:string;expectedTableEditionId:string;
    definition:PublicationTableDefinition;reason:string}}|
  {action:'publish-table';data:{tableId:string;tableEditionId:string;previousPublicationId:string|null;
    rows:PublicationResultSelection[];title:string;summary?:string;limitations?:string;
    reason:string;review:PublicationReviewInput}}|
  {action:'review-impact';data:{publicationId:string;impactId:string;fingerprint:string;
    disposition:PublicationDisposition;reason:string}}|
  {action:'withdraw-publication';data:{publicationId:string;expectedPublicationSha256:string;reason:string}}
);
export type ExtractionAnswer=JsonObject&{
  fieldId:string;status:string;value:TaggedValue;bases:JsonValue[];context:JsonValue;note:string;
};
export type ExtractionResultRecord=JsonObject&{
  resultSet:{id:string;name:string};row:JsonObject;form:JsonObject;study:JsonValue;
  submissions:JsonValue[];comparison:JsonValue[];resolution:JsonValue;resolutionHistory:JsonValue[];
  values:{[fieldId:string]:ExtractionAnswer}|null;status:string;
};
/** The complete immutable descriptor; current is the sole field excluded from its fingerprint. */
export interface ExtractionResultDescriptor {
  resultId:string;editionId:string;questionId:string;studyId:string;label:string;
  status:string;sourceBindings:JsonValue[];record:ExtractionResultRecord;
  [originalField:string]:unknown;
}
export interface ExtractionCoreResult extends ExtractionResultDescriptor {current:boolean}
export interface PublicationResult extends ExtractionCoreResult {fingerprint:string}
export interface ExtractionCoreImpact {
  id:string;resultSetId:string;resultIds:string[];kind:string;previous:JsonValue;current:JsonValue;
  fingerprint:string;[originalField:string]:unknown;
}
export interface ExtractionPublicationCoreContext {
  dossierId:string;revision:number;results:ExtractionCoreResult[];
  impacts:ExtractionCoreImpact[];unresolved:JsonObject[];
}
export interface PublicationResultIdentity extends PublicationResultSelection {
  questionId:string;studyId:string;status:string;
}
export interface PublicationReviewContext {
  dossierId:string;currentResults:PublicationResultIdentity[];impacts:ExtractionCoreImpact[];
  unresolved:JsonObject[];fingerprint:string;
}
export interface PublicationMetadata {
  actor:PublicationActor;createdAt:string;originalRevision:number;revision:number;
}
export interface AuthoredPublicationTable extends PublicationMetadata {id:string}
export interface PublicationTableEdition extends PublicationMetadata {
  id:string;tableId:string;edition:number;previousTableEditionId:string|null;
  definition:NormalizedPublicationDefinition;reason:string;
}
export interface PublicationTable extends AuthoredPublicationTable {
  name:string;editionId:string;edition:number;definition:NormalizedPublicationDefinition;
}
export interface PublicationCell {columnId:string;pointer:string;present:boolean;value:JsonValue}
export interface FrozenPublicationRow {
  result:ExtractionResultDescriptor;fingerprint:string;currentAtPublication:boolean;cells:PublicationCell[];
}
export interface ExtractionPublication extends PublicationMetadata {
  schema:'sf88-research-extraction-publication-edition/v1';id:string;tableId:string;
  tableEditionId:string;edition:number;previousPublicationId:string|null;
  title:string;summary:string;limitations:string;reason:string;definition:NormalizedPublicationDefinition;
  rows:FrozenPublicationRow[];review:{actor:PublicationActor;note:string;contextFingerprint:string;
    context:PublicationReviewContext};sha256:string;
}
export interface PublicationImpact {
  id:string;publicationId:string;tableId:string;kind:string;resultIds:string[];
  previous:JsonValue;current:JsonValue;sourceImpact:ExtractionCoreImpact|null;fingerprint:string;
  review:PublicationImpactReview|null;
}
export interface PublicationImpactReview extends PublicationMetadata {
  id:string;publicationId:string;tableId:string;impactId:string;fingerprint:string;
  disposition:PublicationDisposition;reason:string;impact:Omit<PublicationImpact,'review'>;
}
export interface PublicationWithdrawal extends PublicationMetadata {
  id:string;publicationId:string;tableId:string;publicationSha256:string;reason:string;
}
export interface PublicationStatus {
  publicationId:string;tableId:string;status:'published'|'superseded'|'withdrawn';
  latest:boolean;withdrawalId:string|null;supersededBy:string|null;currentTableEditionId:string|null;
}
export interface PublicationEvent extends PublicationMetadata {
  schema:'sf88-research-extraction-publication-operation/v1';id:string;dossierId:string;
  requestId:string;requestSha256:string;request:PublicationRequest;tableId:string;
  action:PublicationRequest['action'];originalRevisionSha256:string;
  result:{table?:AuthoredPublicationTable;tableEdition?:PublicationTableEdition;
    publication?:ExtractionPublication;impactReview?:PublicationImpactReview;withdrawal?:PublicationWithdrawal};
  sha256:string;
}
export interface PublicationDossierState {
  id:string;title?:string;revision:number;previous?:string;updatedAt?:string;change?:unknown;
  extractionPublicationEvents?:PublicationEvent[];[originalField:string]:unknown;
}
export interface ExtractionPublicationModel {
  schema:'sf88-research-extraction-publication-view/v1';dossierId:string;revision:number;
  tables:PublicationTable[];tableEditions:PublicationTableEdition[];publications:ExtractionPublication[];
  results:PublicationResult[];impacts:PublicationImpact[];reviews:PublicationImpactReview[];
  withdrawals:PublicationWithdrawal[];operations:PublicationEvent[];statuses:PublicationStatus[];
  reviewContext:PublicationReviewContext;
}
export interface PublicationValueChange {
  pointer:string;beforePresent:boolean;afterPresent:boolean;before:JsonValue;after:JsonValue;
}
export interface PublicationComparisonRow {
  resultId:string;kind:'added'|'removed'|'changed'|'unchanged';moved:boolean;
  beforeIndex:number|null;afterIndex:number|null;before:FrozenPublicationRow|null;after:FrozenPublicationRow|null;
  changes:PublicationValueChange[];cellChanges:PublicationValueChange[];
}
export interface PublicationComparison {
  schema:'sf88-research-extraction-publication-comparison/v1';dossierId:string;revision:number;
  dossier:{id:string;title:string;revision:number};tableId:string;fromPublicationId:string;toPublicationId:string;
  from:ExtractionPublication;to:ExtractionPublication;fromStatus:PublicationStatus|null;toStatus:PublicationStatus|null;
  counts:{added:number;removed:number;changed:number;unchanged:number;moved:number};
  metadataChanges:PublicationValueChange[];rows:PublicationComparisonRow[];
}
export interface PublicationOptions {
  tableId?:string;publicationId?:string;currentOnly?:boolean;section?:PublicationSection;
  offset?:number;limit?:number;format?:PublicationFormat;fromPublicationId?:string;toPublicationId?:string;
  againstPublicationId?:string;
  changeType?:'all'|'added'|'removed'|'changed'|'unchanged';
}
export interface PublicationOverview {
  tables:number;tableEditions:number;publications:number;publishedRows:number;
  availableResultEditions:number;currentResults:number;currentResultStatuses:Record<string,number>;
  publicationStatuses:Record<string,number>;impacts:number;impactsWithoutCurrentReview:number;
  impactsNeedingReview:number;impactReviews:number;withdrawals:number;units:Record<string,string>;
}
export type PublicationPageItem=PublicationTable|PublicationTableEdition|PublicationResult|ExtractionPublication|
  (FrozenPublicationRow&{publicationId:string;tableId:string;rowIndex:number})|PublicationImpact|
  PublicationImpactReview|PublicationWithdrawal|PublicationEvent|PublicationComparisonRow;
export interface PublicationPage {
  schema:'sf88-research-extraction-publication-view/v1';dossierId:string;revision:number;
  dossier:{id:string;title:string;revision:number};
  tableId:string|null;publicationId:string|null;section:PublicationSection;overview:PublicationOverview;
  reviewContext:PublicationReviewContext;tables:PublicationTable[];statuses:PublicationStatus[];
  comparison?:{fromPublicationId:string;toPublicationId:string;counts:PublicationComparison['counts'];
    metadataChanges:PublicationValueChange[];changeType:'all'|'added'|'removed'|'changed'|'unchanged'};
  items:PublicationPageItem[];offset:number;limit:number;total:number;nextOffset:number|null;complete:boolean;
}
export interface PublicationReport extends Omit<ExtractionPublicationModel,'schema'|'dossierId'|'revision'> {
  schema:'sf88-research-extraction-publication-report/v1';dossierId:string;revision:number;
  dossier:{id:string;title:string;revision:number};asOf:string|null;tableId:string|null;publicationId:string|null;
  currentOnly:boolean;rows:Array<FrozenPublicationRow&{publicationId:string;tableId:string;rowIndex:number}>;
  overview:PublicationOverview;comparison:PublicationComparison|null;operatingMethod:Record<string,string>;
}
export interface PublicationExport {filename:string;revision:number;contentType:string;body:Buffer}
export const EXTRACTION_PUBLICATION_SCHEMA:'sf88-research-extraction-publication-view/v1';
export const EXTRACTION_PUBLICATION_OPERATION_SCHEMA:'sf88-research-extraction-publication-operation/v1';
export const EXTRACTION_PUBLICATION_EDITION_SCHEMA:'sf88-research-extraction-publication-edition/v1';
export const EXTRACTION_PUBLICATION_ACTIONS:readonly PublicationRequest['action'][];
export const EXTRACTION_PUBLICATION_SECTIONS:readonly PublicationSection[];
export const EXTRACTION_PUBLICATION_FORMATS:readonly PublicationFormat[];

export function publicationInput(input:unknown):PublicationRequest;
export function publicationDefinition(input:unknown):NormalizedPublicationDefinition;
export function publicationDigest(value:unknown):string;
/** Pass a raw core descriptor. This function excludes current and preserves every other original property. */
export function publicationResultDescriptor(result:ExtractionCoreResult):ExtractionResultDescriptor;
export function publicationResultFingerprint(result:ExtractionCoreResult):string;
export function recordExtractionPublication(state:PublicationDossierState,coreContext:ExtractionPublicationCoreContext,
  request:PublicationRequest,createdAt:string):PublicationEvent;
export function extractionPublicationModel(state:PublicationDossierState,
  coreContext:ExtractionPublicationCoreContext):ExtractionPublicationModel;
export function extractionPublicationPage(state:PublicationDossierState,model:ExtractionPublicationModel,
  options?:PublicationOptions):PublicationPage;
export function extractionPublicationReport(state:PublicationDossierState,model:ExtractionPublicationModel,
  options?:PublicationOptions):PublicationReport;
export function extractionPublicationCompare(state:PublicationDossierState,model:ExtractionPublicationModel,
  options:{fromPublicationId:string;toPublicationId:string;publicationId?:string;againstPublicationId?:string}|
    {publicationId:string;againstPublicationId:string;fromPublicationId?:string;toPublicationId?:string}):PublicationComparison;
export function extractionPublicationExport(state:PublicationDossierState,model:ExtractionPublicationModel,
  options?:PublicationOptions):PublicationExport;
export function validateExtractionPublicationState(state:PublicationDossierState):void;
export function validateExtractionPublicationTransition(previous:PublicationDossierState|null,
  state:PublicationDossierState,previousCoreContext:ExtractionPublicationCoreContext):void;
export function extractionPublicationMarkdownLines(report:PublicationReport):string[];
export function extractionPublicationHtmlFragment(report:PublicationReport):string;
