// Complete original Source Collection agent; browser working copies remain the interchange format.
import type {GrantWorkspaceClient} from './agent-client.mjs';
import type {InstallationSourceCommand, InstallationSourceDraft, InstallationSourceReceipt,
  InstallationSourceOriginalFile} from './installation-source-desk-agent.mjs';

export const INSTALLATION_SOURCE_COLLECTION_AGENT_SCHEMA:'stellar-forge.installation-source-collection-agent.v1';
export const INSTALLATION_SOURCE_WORKING_COPY_SCHEMA:'stellar-forge.installation-source-working-copy.v1';
export const INSTALLATION_SOURCE_WORKING_COPY_MAX_BYTES:number;
export interface SourceCollectionRecord {[key:string]:unknown}
export interface SourceCollectionScope extends SourceCollectionRecord {
  caseId:string;planId:string;createdAt:string;
}
export interface SourceCollectionStaffContext extends SourceCollectionRecord {
  installationId:string|null;staffId:string;actor:string;role:string;displayName:string;
}
/** The complete original bytes and original local-file metadata, before receiving renames. */
export interface SourceCollectionOriginal extends SourceCollectionRecord {
  name:string;type:string;lastModified?:number;bytes:number;sha256:string;contentBase64:string;
}
export interface SourceCollectionOriginalSummary extends SourceCollectionRecord {
  name:string;type:string;lastModified?:number;bytes:number;sha256:string;
}
export interface SourceCollectionMetadata {
  filename:string;mediaType:string;sourceUrl:string;observedAt:string;
}
export type SourceCollectionFileIdentity = Pick<InstallationSourceOriginalFile,
  'id'|'filename'|'bytes'|'sha256'|'mediaType'|'sourceUrl'|'observedAt'>;
export interface SourceCollectionLink {
  file:SourceCollectionFileIdentity;revision:number;acceptedAt:string;
}
export interface SourceCollectionRow extends SourceCollectionMetadata, SourceCollectionRecord {
  id:string;original:SourceCollectionOriginal;included:boolean;requests:string[];link:SourceCollectionLink|null;
}
export interface SourceCollectionSavedReview {
  signature:string;revision:number;at:string;
}
export interface SourceCollection extends SourceCollectionRecord {
  schema:'stellar-forge.installation-source-collection.v1';id:string;draftId:string;title:string;createdAt:string;
  defaults:{sourceUrl:string;observedAt:string};rows:SourceCollectionRow[];selectedId:string|null;
  pauseRequested:boolean;review:SourceCollectionSavedReview|null;
}
export type SourceCollectionRowStatus='READY'|'RECORDED'|'REMOVED'|'RECOVER'|'LINKED'|
  'STALE_LINK'|'EXCLUDED'|'IDENTICAL'|'COLLISION'|'INVALID';
export type SourceCollectionRequestState='PREPARED'|'UNRESOLVED'|'REJECTED'|'RECORDED';
export interface SourceCollectionReviewRow {
  id:string;status:SourceCollectionRowStatus;errors:string[];
  file:SourceCollectionFileIdentity|null;sameName:SourceCollectionFileIdentity|null;
  sameBytes:SourceCollectionFileIdentity[];requestId:string|null;requestState:SourceCollectionRequestState|null;
  originalName:string;filename:string;bytes:number;
}
export interface SourceCollectionReview {
  signature:string;revision:number;currentBytes:number;addedBytes:number;totalBytes:number;
  rows:SourceCollectionReviewRow[];problems:string[];ready:number;recorded:number;excluded:number;blocked:boolean;
}
export interface SourceCollectionRequestError extends SourceCollectionRecord {
  message:string;code:string|null;status:number|null;definitive:boolean;at:string;
  uncertain?:boolean;requestId?:string|null;originalCode?:string|null;originalStatus?:number|null;
  source?:SourceCollectionRecord;route?:string;outcomeUnknown?:boolean;reopenRequired?:boolean;
  commitUncertainty?:SourceCollectionRecord;
}
/** Original native journal envelope. Do not replace request IDs or regenerate bodies on retry. */
export interface SourceCollectionRequest extends SourceCollectionRecord {
  schema:'stellar-forge.installation-source-desk.v1';caseId:string;draftId:string;
  body:InstallationSourceCommand;createdAt:string;requestSha256:string;editorText:string|null;
  state:SourceCollectionRequestState;receipt?:InstallationSourceReceipt;recordedAt?:string;
  lastError?:SourceCollectionRequestError;statusRead?:{state:'NOT_RECORDED';at:string};
}
export interface SourceCollectionMappingEditor extends SourceCollectionRecord {
  draftId:string;baseRevision:number;selectionText:string;dirty:boolean;
}
export interface SourceCollectionWorkingState extends SourceCollectionRecord {
  schema:'stellar-forge.installation-source-desk.v1';scope:SourceCollectionScope;
  open:boolean;tab:string;draftId:string;revision:number|null;
  work:SourceCollectionMappingEditor|null;note:string;newTitle:string;
  upload:SourceCollectionMetadata;caseForm:SourceCollectionRecord|null;
  pendingId:string|null;preparationId:string|null;profileWork:SourceCollectionRecord|null;
  commissioningWork:SourceCollectionRecord|null;collectionWork:SourceCollection|null;
  inspectionFileId:string|null;notice:string;error:string;
  rejected:Array<{requestId:string;action:string;code:string|null}>;
  copyName:string;rawFields:Record<string,string>;fieldErrors:Record<string,string>;historyRevisionText:string|null;
}
/** Preserve all additional original-owner fields and earlier copies when moving between operator surfaces. */
export interface InstallationSourceCollectionWorkingCopy extends SourceCollectionRecord {
  schema:'stellar-forge.installation-source-desk.v1';
  workingCopySchema:typeof INSTALLATION_SOURCE_WORKING_COPY_SCHEMA;
  scope:SourceCollectionScope;staffContext:SourceCollectionStaffContext|null;
  copyId:string;sequence:number;name:string;updatedAt?:string;
  sourceDraftId:string;selectedRevision:number|null;
  saved:InstallationSourceDraft|null;working:SourceCollectionMappingEditor|null;
  caseForm:SourceCollectionRecord|null;profileWork:SourceCollectionRecord|null;
  pendingRequest:SourceCollectionRequest|null;state:SourceCollectionWorkingState;
  current:InstallationSourceDraft;selected:InstallationSourceDraft|null;
  prepared:SourceCollectionRecord|null;inspection:SourceCollectionRecord|null;catalogue:SourceCollectionRecord|null;
  selectedFile:SourceCollectionOriginal|null;requests:SourceCollectionRequest[];
  earlierCopies:Array<InstallationSourceCollectionWorkingCopy|SourceCollectionRecord>;
}
export interface SourceCollectionRowInventory extends SourceCollectionMetadata, SourceCollectionRecord {
  id:string;original:SourceCollectionOriginalSummary;included:boolean;requests:string[];link:SourceCollectionLink|null;
}
export interface SourceCollectionInventory extends SourceCollectionRecord {
  schema:'stellar-forge.installation-source-collection.v1';id:string;draftId:string;title:string;createdAt:string;
  defaults:{sourceUrl:string;observedAt:string};rows:SourceCollectionRowInventory[];
  selectedId:string|null;pauseRequested:boolean;review:SourceCollectionSavedReview|null;
}
export interface SourceCollectionPendingSummary {
  requestId:string;requestSha256:string;action:string;state:SourceCollectionRequestState;
  receipt:InstallationSourceReceipt|null;lastError:SourceCollectionRequestError|null;
}
export interface InstallationSourceCollectionInspection {
  schema:typeof INSTALLATION_SOURCE_COLLECTION_AGENT_SCHEMA;copyId:string;sequence:number;
  caseId:string;draftId:string;collection:SourceCollectionInventory|null;review:SourceCollectionReview|null;
  pendingRequest:SourceCollectionPendingSummary|null;running:boolean;
  storageError:{code:string;message:string}|null;
}
export interface SourceCollectionReconciliation {
  state:'RECORDED'|'NOT_RECORDED';receipt:InstallationSourceReceipt|null;requestId:string;
}
export interface InstallationSourceCollectionReconciled extends InstallationSourceCollectionInspection {
  results:SourceCollectionReconciliation[];
}
export interface InstallationSourceCollectionContext {
  /** Applies only to newly prepared file.add requests; retained actors remain unchanged. */
  actor:string;
  /** Omission retains the original working-copy note. */
  note?:string;
  /** Original canonical workspace identity passed to the existing native operation helper. */
  workspaceDirectory?:string;
}
/**
 * Compare expectedSequence and atomically retain the COMPLETE browser copy at sequence+1.
 * Return that complete stored copy. Reconcile any uncertain storage acknowledgement
 * internally or throw; this agent cannot issue a native POST after a persistence failure.
 */
export type InstallationSourceCollectionPersist = (
  workingCopy:InstallationSourceCollectionWorkingCopy,
  options:{expectedSequence:number}
) => Promise<InstallationSourceCollectionWorkingCopy>;
export interface InstallationSourceCollectionAgentOptions {
  workingCopy:InstallationSourceCollectionWorkingCopy;
  client:Pick<GrantWorkspaceClient,'installationSources'>;
  persist:InstallationSourceCollectionPersist;context:InstallationSourceCollectionContext;
}
export type SourceCollectionEdit =
  |{rowId:string;field:'included';value:boolean}
  |{rowId:string;field:keyof SourceCollectionMetadata;value:string}
  |{field:'title'|'sourceUrl'|'observedAt';value:string};
export interface SourceCollectionExistingSelection {
  revision:number;fileId:string;sha256:string;bytes:number;filename:string;
}
/** Does not create a native draft or infer an original case/plan identity. */
export function createInstallationSourceCollectionWorkingCopy(input:{
  draft:InstallationSourceDraft;scope:SourceCollectionScope;staffContext:SourceCollectionStaffContext|null;name?:string;
}):InstallationSourceCollectionWorkingCopy;
/** Borrows the supplied client and never starts or closes a native workspace owner. */
export class InstallationSourceCollectionAgent {
  constructor(options:InstallationSourceCollectionAgentOptions);
  /** Complete original browser copy, including all source bytes and request bodies. */
  snapshot():InstallationSourceCollectionWorkingCopy;
  /** Current inventory and original collection review; original base64 bytes are omitted here. */
  inspect():InstallationSourceCollectionInspection;
  /** Refreshes the original native draft; preserves raw unrelated editors and historical selection. */
  refresh():Promise<InstallationSourceCollectionInspection>;
  /** Parks the prior complete copy and starts the original engine's new collection. */
  start(input?:{title?:string;sourceUrl?:string;observedAt?:string}):Promise<InstallationSourceCollectionInspection>;
  /** Every full original is 1 byte..8 MiB; staged originals together remain within 64 MiB. */
  stage(files:SourceCollectionOriginal[]):Promise<InstallationSourceCollectionInspection>;
  edit(change:SourceCollectionEdit):Promise<InstallationSourceCollectionInspection>;
  useExisting(rowId:string,selection:SourceCollectionExistingSelection):Promise<InstallationSourceCollectionInspection>;
  clearExisting(rowId:string):Promise<InstallationSourceCollectionInspection>;
  review():Promise<InstallationSourceCollectionInspection>;
  /** A retained unresolved request is looked up/recovered by its same original native ID. */
  receive(options?:{expectedSignature?:string}):Promise<InstallationSourceCollectionInspection>;
  /** Read-only by default. retry:true permits only the original retained request body after lookup. */
  reconcile(options?:{retry?:boolean}):Promise<InstallationSourceCollectionReconciled>;
  /** Requires a definite native rejection and a fresh original NOT_RECORDED lookup. */
  retireRejected():Promise<InstallationSourceCollectionInspection>;
  /** The original loop saves the pause after the current original request has a retained outcome. */
  pause():InstallationSourceCollectionInspection;
}
export function createInstallationSourceCollectionAgent(
  options:InstallationSourceCollectionAgentOptions
):InstallationSourceCollectionAgent;
