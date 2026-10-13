import type {JsonValue} from './index.mjs';
import type {SavedDocumentComposition,DocumentCompositionPlan} from './composition.mjs';
export const DOCUMENT_CORRECTION_DRAFT_SCHEMA:'stellar-forge.document-correction-draft.v1';
export const DOCUMENT_CORRECTION_SCHEMA:'stellar-forge.document-correction.v1';
export interface DocumentCorrectionSelection {
  id:string;name:string;mode?:'correction'|'repeat';reason:string;documentIds:string[];
}
export interface DocumentCorrectionDraft extends Omit<DocumentCorrectionSelection,'mode'> {
  schema:typeof DOCUMENT_CORRECTION_DRAFT_SCHEMA;
  parent:{id:string;sourceSha256:string};mode:'correction'|'repeat';
  /** Complete original grouped records; keys and business task references remain fixed. */
  records:Array<Record<string,JsonValue>>;
  templates:Record<string,string>;
}
export interface DocumentCorrectionLineage {
  schema:typeof DOCUMENT_CORRECTION_SCHEMA;mode:'correction'|'repeat';reason:string;
  parent:{id:string;sourceSha256:string};
  documents:Array<{id:string;recordKey:string;templateId:string;taskReference:string;sourceSha256:string}>;
}
export function documentCorrectionDraft(input:DocumentCorrectionSelection&{source:SavedDocumentComposition}):DocumentCorrectionDraft;
export function composeDocumentCorrection(input:{source:SavedDocumentComposition;draft:DocumentCorrectionDraft}):DocumentCompositionPlan;
export function stageDocumentCorrection(input:{
  sourceDirectory:string;directory:string;draft:DocumentCorrectionDraft;signal?:AbortSignal
}):Promise<SavedDocumentComposition>;
