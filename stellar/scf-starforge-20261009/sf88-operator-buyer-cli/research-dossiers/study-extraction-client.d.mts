/** MIT. Original Research listener attachment. Values and operations use the domain's complete types. */
import type {
  ExtractionRequest,Operation,Overview,Page,PageOptions,SourceOccurrence,SourceBinding
} from './study-extraction.mjs';
import type {
  PublicationRequest,PublicationEvent,PublicationPage,PublicationSection
} from './extraction-publication.mjs';

export interface ExtractionRequestOptions {signal?:AbortSignal}
export interface ExtractionPageOptions extends PageOptions,ExtractionRequestOptions {revision?:number}
export interface ExtractionSourceSelection extends ExtractionRequestOptions {
  revision?:number;occurrenceId:string;pointers:string[];fileName?:string;
}
export interface ExtractionSourceValues {
  schema:'sf88-research-extraction-source-values/v1';dossierId:string;revision:number;
  occurrence:SourceOccurrence;values:SourceBinding[];
}
export interface ExtractionDossierMetadata {
  id:string;revision:number;title?:string;[originalMetadata:string]:unknown;
}
export interface ExtractionCommitResult<T=Operation> {
  dossier:ExtractionDossierMetadata;operation:T;duplicate:boolean;
}
export interface ExtractionDownloadOptions extends ExtractionRequestOptions {
  file:string;expectedSha256?:string;
}
export interface ExtractionDownload {
  file:string;bytes:number;sha256:string;filename?:string;contentType?:string;revision?:number;
  [originalFileMetadata:string]:unknown;
}
export interface ExtractionExportOptions extends ExtractionDownloadOptions {
  revision?:number;formId?:string;resultSetId?:string;format?:'json'|'md'|'html';
}
export type PublicationChangeType='all'|'added'|'removed'|'changed'|'unchanged';
export interface ExtractionPublicationSelection extends ExtractionRequestOptions {
  revision?:number;tableId?:string;publicationId?:string;currentOnly?:boolean;
  fromPublicationId?:string;toPublicationId?:string;againstPublicationId?:string;
  changeType?:PublicationChangeType;
}
export interface ExtractionPublicationPageOptions extends ExtractionPublicationSelection {
  section?:PublicationSection;offset?:number;limit?:number;
}
export interface ExtractionPublicationPage extends PublicationPage {dossierId:string;revision:number}
export interface ExtractionPublicationExportOptions extends ExtractionPublicationSelection,ExtractionDownloadOptions {
  format?:'json'|'csv'|'md'|'html';
}
export interface StudyExtractionClient {
  /** Page zero selects a revision; every later page must pass that original revision. */
  extraction(dossierId:string,options?:ExtractionPageOptions):Promise<Page|(Overview&{section:'overview';complete:true})>;
  /** Reads the retained original JSON member; this POST is read-only and never commits a revision. */
  extractionSourceValues(dossierId:string,options:ExtractionSourceSelection):Promise<ExtractionSourceValues>;
  /** The exact saved five-field request is the retry unit after an interrupted response. */
  reviewExtraction(dossierId:string,input:ExtractionRequest,options?:ExtractionRequestOptions):Promise<ExtractionCommitResult>;
  exportExtraction(dossierId:string,options:ExtractionExportOptions):Promise<ExtractionDownload>;
  extractionPublications(dossierId:string,options?:ExtractionPublicationPageOptions):Promise<ExtractionPublicationPage>;
  reviewExtractionPublication(dossierId:string,input:PublicationRequest,options?:ExtractionRequestOptions):Promise<ExtractionCommitResult<PublicationEvent>>;
  exportExtractionPublication(dossierId:string,options:ExtractionPublicationExportOptions):Promise<ExtractionDownload>;
}
export interface StudyExtractionTransport {
  request(route:string,body?:unknown,options?:ExtractionRequestOptions&{readOnly?:boolean}):Promise<unknown>;
  download(route:string,file:string,options?:ExtractionRequestOptions&{expectedSha256?:string}):Promise<ExtractionDownload>;
}
/** Borrow the original ResearchWorkspaceClient transport; its existing close method owns attachment cleanup. */
export function createStudyExtractionClient(transport:StudyExtractionTransport):Readonly<StudyExtractionClient>;
