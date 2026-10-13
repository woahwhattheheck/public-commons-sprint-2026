// MIT. Complete original Installation Source Desk typed route and request contracts.
import type {Buffer} from 'node:buffer';
import type {GrantNativeResponse,GrantJsonResponse,GrantObject} from './agent-client.mjs';
export const INSTALLATION_SOURCE_SCHEMA:'stellar-forge.installation-source-desk.v1';
export const INSTALLATION_SOURCE_OPERATION_SCHEMA:'stellar-forge.installation-source-desk-operation.v1';
export const INSTALLATION_SOURCE_MAX_FILE_BYTES:number;
/** Complete archive receiving cap, including native manifest and ZIP framing. */
export const INSTALLATION_SOURCE_MAX_ARCHIVE_BYTES:number;
export const INSTALLATION_SOURCE_ACTIONS:readonly InstallationSourceAction[];
export const INSTALLATION_SOURCE_READS:readonly string[];
export type InstallationSourceAction='create'|'file.add'|'file.remove'|'selection.save'|'prepare'|
  'native.receive'|'attach'|'commissioning.attach'|'commissioning.archive.receive'|'edition.apply'|'mapping.apply';
export interface InstallationSourceSelection {caseId:string;draftId:string}
export interface InstallationSourceContext {requestId:string;actor:string;note?:string}
export interface InstallationSourceCommand<Data extends GrantObject=GrantObject> extends InstallationSourceContext {
  expectedRevision:number;action:InstallationSourceAction;data:Data;
}
export interface InstallationSourceOriginalFile extends GrantObject {
  id:string;filename:string;bytes:number;sha256:string;mediaType:string;sourceUrl:string;observedAt:string;
  originalMemberName?:string;originalRole?:string;originalType?:string;
  originalArchive?:{fileId:string;filename:string;bytes:number;sha256:string;memberName:string};
}
export interface InstallationSourceHistory extends GrantObject {
  revision:number;action:InstallationSourceAction;actor:string;note:string;at:string;
  requestId:string;requestSha256:string;
}
export interface InstallationSourceDraft extends GrantObject {
  schema:typeof INSTALLATION_SOURCE_SCHEMA;caseId:string;id:string;revision:number;title:string;
  createdAt:string;updatedAt:string;files:InstallationSourceOriginalFile[];
  selection:GrantObject|null;preparations:GrantObject[];attachments:GrantObject[];history:InstallationSourceHistory[];
  mappingReconciliations?:InstallationMappingReceipt[];
}
export interface InstallationSourceDraftSummary extends GrantObject {
  id:string;revision:number;title:string;createdAt:string;updatedAt:string;fileCount:number;selectedBytes:number;
  preparationCount:number;attachmentCount:number;latestPreparation:GrantObject|null;selectionSha256:string|null;
}
export interface InstallationSourceList {
  schema:typeof INSTALLATION_SOURCE_SCHEMA;caseId:string;drafts:InstallationSourceDraftSummary[];
}
export interface InstallationSourceProfiles extends GrantObject {
  schema:typeof INSTALLATION_SOURCE_SCHEMA;engine:GrantObject;
  profiles:Array<GrantObject&{profile:GrantObject}>;sourceFormats:GrantObject[];nativePackages:GrantObject[];
  limits:{fileBytes:number;selectedInputBytes:number;caseSourceBytes:number;caseSourceFiles:number};
}
export interface InstallationSourcePreparedFile extends GrantObject {
  filename:string;bytes:number;sha256:string;mediaType:string;sourceUrl:string;observedAt:string;
}
export interface InstallationSourcePreparation extends GrantObject {
  id:string;state:'PREPARED_SOURCE';files:InstallationSourcePreparedFile[];
  selectionSha256:string;draftRevision:number;preparedAt:string;
}
export interface InstallationSourceReceipt<Result extends GrantObject|null=GrantObject|null> {
  schema:typeof INSTALLATION_SOURCE_SCHEMA;requestId:string;requestSha256:string;
  draft:InstallationSourceDraft;result:Result;
  nativeMapping?:InstallationMappingWire;
}
export type InstallationSourceRequest=
  |{schema:typeof INSTALLATION_SOURCE_SCHEMA;requestId:string;state:'NOT_RECORDED'}
  |{schema:typeof INSTALLATION_SOURCE_SCHEMA;requestId:string;state:'RECORDED';result:InstallationSourceReceipt};
export interface InstallationSourceOperation extends InstallationSourceSelection {
  schema:typeof INSTALLATION_SOURCE_OPERATION_SCHEMA;request:InstallationSourceCommand;
  requestSha256:string;operationSha256:string;workspaceDirectory?:string;review?:GrantObject;
}
export interface InstallationSourceExecution {
  state:'RECORDED'|'NOT_RECORDED';operation:InstallationSourceOperation;receipt:InstallationSourceReceipt|null;
  /** Exact original lookup on replay/reconcile, or exact original command response on first execution. */
  response:GrantJsonResponse<InstallationSourceRequest|InstallationSourceReceipt>;
  replayed:boolean;
}
export interface InstallationCommissioningSelection {
  captureFileId:string;fileIds:string[];expectedVersion:number;projectId:string;installationId:string;
  expectedInstallationRevision:number;milestonePhases:Array<{milestoneIndex:number;phaseId:string}>;
  includeAccountSnapshot?:boolean;
}
export interface InstallationCommissioningInspection extends GrantObject {
  schema:'stellar-forge.installation-commissioning-receiving.v1';
  caseId:string;draftId:string;draftRevision:number;version:number;
  capture:GrantObject;files:InstallationSourceOriginalFile[];projects:GrantObject[];installations:GrantObject[];
  optionalReports:GrantObject[];scope:'PRIVATE_CAPTURE_FILES';containsCompleteAccount:boolean;
}
export interface InstallationCommissioningPreview extends GrantObject {
  schema:'stellar-forge.installation-commissioning-receiving.v1';caseId:string;draftId:string;
  draftRevision:number;selection:InstallationCommissioningSelection;previewSha256:string;
  capture:GrantObject;project:GrantObject;installation:GrantObject;
  milestonePhases:Array<{milestoneIndex:number;phaseId:string;checkId:string;phase:GrantObject;check:GrantObject;milestone:GrantObject}>;
  sources:Array<InstallationSourceOriginalFile|GrantObject>;newBytes:number;newSourceCount:number;
  findings:GrantObject[];scope:string;
}
export interface InstallationCommissioningArchiveMember extends GrantObject {
  id:string|null;filename:string;originalMemberName:string;bytes:number;sha256:string;mediaType:string;
  originalType:string;originalRole:string;containsCompleteAccount:boolean;
  disposition:'NEW'|'REUSED'|'CONFLICT'|'ARCHIVE_ONLY';existingFileId:string|null;replaceSelected:boolean;
  materialized:boolean;retainedInArchive:true;archiveOnlyReason:null|'EMPTY_ORIGINAL_MEMBER';
}
export interface InstallationCommissioningArchivePreview extends GrantObject {
  schema:'stellar-forge.installation-commissioning-archive.v1';caseId:string;draftId:string;draftRevision:number;
  selection:{archiveFileId:string;expectedArchiveSha256:string;replaceFileIds:string[]};
  archive:InstallationSourceOriginalFile;capture:GrantObject;members:InstallationCommissioningArchiveMember[];
  conflicts:Array<{filename:string;originalMemberName:string;existing:InstallationSourceOriginalFile;
    incoming:InstallationCommissioningArchiveMember;replaceSelected:boolean}>;
  removedFiles:InstallationSourceOriginalFile[];newBytes:number;selectedBytes:number;storedBytesAfter:number;
  limits:{archiveBytes:number;memberBytes:number;selectedBytes:number;storedBytes:number};ready:boolean;
  receivingSelection:{captureFileId:string;fileIds:string[]};previewSha256:string;scope:'PRIVATE_COMPLETE_CAPTURE_ARCHIVE';
}
export interface InstallationSourceArchiveDescription {
  filename:string;bytes:number;sha256:string;mediaType:'application/zip';preparationId:string;
}
export interface InstallationSourceInputs {
  profiles:Record<string,never>;
  list:{caseId:string};
  detail:InstallationSourceSelection&{revision?:number};
  request:InstallationSourceSelection&{requestId:string};
  command:InstallationSourceSelection&{body:InstallationSourceCommand};
  'file-inspect':InstallationSourceSelection&{fileId:string;revision?:number;phaseIdAmendment?:GrantObject};
  file:InstallationSourceSelection&{fileId:string;revision?:number;expectedSha256:string};
  preparation:InstallationSourceSelection&{preparationId:string};
  'archive-describe':InstallationSourceSelection&{preparationId:string};
  archive:InstallationSourceSelection&{preparationId:string;expectedSha256:string};
  output:InstallationSourceSelection&{preparationId:string;filename:string;expectedSha256:string};
  'commissioning-inspect':InstallationSourceSelection&{
    body:{expectedRevision:number;captureFileId:string;fileIds:string[]}};
  'commissioning-preview':InstallationSourceSelection&{
    body:InstallationCommissioningSelection&{expectedRevision:number}};
  'archive-inspect':InstallationSourceSelection&{
    body:{expectedRevision:number;archiveFileId:string;replaceFileIds?:string[]}};
  'edition-compare':InstallationSourceSelection&{body:InstallationEditionComparisonInput};
  'edition-preview':InstallationSourceSelection&{body:InstallationEditionPreviewInput};
  'mapping-compare':InstallationSourceSelection&{body:InstallationMappingComparisonInput};
  'mapping-preview':InstallationSourceSelection&{body:InstallationMappingPreviewInput};
  'mapping-compare-wire':InstallationSourceSelection&{body:InstallationMappingComparisonInput};
  'mapping-preview-wire':InstallationSourceSelection&{body:InstallationMappingPreviewInput};
  'mapping-draft-wire':InstallationSourceSelection&{body:{revision:number|null}};
  execute:{operation:InstallationSourceOperation};
  reconcile:{operation:InstallationSourceOperation};
}
export interface InstallationSourceResponses {
  profiles:GrantJsonResponse<InstallationSourceProfiles>;
  list:GrantJsonResponse<InstallationSourceList>;
  detail:GrantJsonResponse<InstallationSourceDraft>;
  request:GrantJsonResponse<InstallationSourceRequest>;
  command:GrantJsonResponse<InstallationSourceReceipt>;
  'file-inspect':GrantJsonResponse<GrantObject>;
  file:GrantNativeResponse;
  preparation:GrantJsonResponse<InstallationSourcePreparation>;
  'archive-describe':GrantJsonResponse<InstallationSourceArchiveDescription>;
  archive:GrantNativeResponse;
  output:GrantNativeResponse;
  'commissioning-inspect':GrantJsonResponse<InstallationCommissioningInspection>;
  'commissioning-preview':GrantJsonResponse<InstallationCommissioningPreview>;
  'archive-inspect':GrantJsonResponse<InstallationCommissioningArchivePreview>;
  'edition-compare':GrantJsonResponse<InstallationEditionComparison>;
  'edition-preview':GrantJsonResponse<InstallationEditionPlan>;
  'mapping-compare':GrantJsonResponse<InstallationMappingComparison>;
  'mapping-preview':GrantJsonResponse<InstallationMappingPlan>;
  'mapping-compare-wire':GrantJsonResponse<InstallationMappingWire<InstallationMappingComparison>>;
  'mapping-preview-wire':GrantJsonResponse<InstallationMappingWire<InstallationMappingPlan>>;
  'mapping-draft-wire':GrantJsonResponse<InstallationMappingWire<InstallationSourceDraft>>;
  execute:InstallationSourceExecution;
  reconcile:InstallationSourceExecution;
}
export function installationSourceCanonical(value:unknown):string;
export function installationSourceRequestSha256(caseId:string,draftId:string,body:InstallationSourceCommand):string;
export function prepareInstallationSourceCommand(caseId:string,draftId:string,body:InstallationSourceCommand,
  options?:{review?:GrantObject;workspaceDirectory?:string}):InstallationSourceOperation;
export function prepareInstallationSourceUpload(caseId:string,draftId:string,bytes:Buffer|Uint8Array,
  metadata:{filename:string;mediaType:string;sourceUrl:string;observedAt:string;expectedSha256?:string},
  context:InstallationSourceContext&{expectedRevision:number}):InstallationSourceOperation;
export function prepareInstallationSourceReview(review:InstallationCommissioningPreview|InstallationCommissioningArchivePreview,
  context:InstallationSourceContext):InstallationSourceOperation;
export function validateInstallationSourceOperation(value:unknown,
  expected?:{caseId?:string;draftId?:string;workspaceDirectory?:string}):InstallationSourceOperation;
export interface InstallationSourcePlan {
  action:keyof InstallationSourceInputs;input?:GrantObject;operation?:InstallationSourceOperation;
  route?:string;options?:{body?:GrantObject;mutation:boolean;originalRequestId?:string;maxResponseBytes?:number};
}
export function planInstallationSourceOperation<K extends keyof InstallationSourceInputs>(
  action:K,input:InstallationSourceInputs[K]):InstallationSourcePlan;
export function performInstallationSourceOperation<K extends keyof InstallationSourceInputs>(
  plan:InstallationSourcePlan,send:(route:string,options:GrantObject)=>Promise<GrantNativeResponse>):
  Promise<InstallationSourceResponses[K]>;

export interface InstallationEditionRef {draftId:string;revision:number;sha256:string}
export interface InstallationEditionFileDecision {
  sourceFileId:string;choice:'retain'|'replace'|'remove';targetFileId:string|null;
}
export interface InstallationEditionMapping {mode:'source'|'target'|'explicit';selection:GrantObject|null}
export interface InstallationEditionComparisonInput {
  source:{draftId:string;revision:number};targetRevision:number;
  sourcePreparationId:string|null;targetPreparationId:string|null;
}
export interface InstallationEditionChange {
  pointer:string;beforePresent:boolean;afterPresent:boolean;before:unknown;after:unknown;
}
export interface InstallationEditionFileChange {
  filename:string;status:'same'|'changed'|'added'|'removed';
  source:InstallationSourceOriginalFile|null;target:InstallationSourceOriginalFile|null;
}
export interface InstallationEditionComparison extends GrantObject {
  schema:'stellar-forge.installation-source-edition-comparison.v1';caseId:string;
  source:{ref:InstallationEditionRef;draft:InstallationSourceDraft};
  target:{ref:InstallationEditionRef;draft:InstallationSourceDraft};
  files:InstallationEditionFileChange[];selectionChanges:InstallationEditionChange[];
  preparations:{source:InstallationSourcePreparation|null;target:InstallationSourcePreparation|null;
    files:InstallationEditionPreparedFileChange[];reportChanges:InstallationEditionChange[]};
  sha256:string;
}
export interface InstallationEditionPreviewInput {
  source:InstallationEditionRef;target:InstallationEditionRef;
  files:InstallationEditionFileDecision[];mapping:InstallationEditionMapping;
}
export interface InstallationEditionPlan extends InstallationEditionPreviewInput,GrantObject {
  schema:'stellar-forge.installation-source-edition-plan.v1';caseId:string;
  resultFiles:InstallationSourceOriginalFile[];selection:GrantObject|null;selectionSha256:string;
  findings:Array<{code:string;pointer:string;message:string}>;sha256:string;
}
export function prepareInstallationSourceEdition(plan:InstallationEditionPlan,
  context:InstallationSourceContext):InstallationSourceOperation;

export interface InstallationEditionPreparedFileChange {
  filename:string;status:'same'|'changed'|'added'|'removed';
  source:InstallationSourcePreparedFile|null;target:InstallationSourcePreparedFile|null;
}

export interface InstallationMappingComparisonInput {
  source:InstallationEditionRef;target:InstallationEditionRef;expandedArrays:string[];
}
export interface InstallationMappingRow {
  pointer:string;sourcePresent:boolean;targetPresent:boolean;source:unknown;target:unknown;
  sourceType:'absent'|'null'|'boolean'|'string'|'number'|'array'|'object';
  targetType:'absent'|'null'|'boolean'|'string'|'number'|'array'|'object';
}
export interface InstallationMappingComparison extends InstallationMappingComparisonInput,GrantObject {
  schema:'stellar-forge.installation-mapping-comparison.v1';caseId:string;
  sourceSelection:GrantObject|null;targetSelection:GrantObject|null;
  arrays:Array<{pointer:string;sourceLength:number;targetLength:number;expanded:boolean}>;
  rows:InstallationMappingRow[];sha256:string;
}
export type InstallationMappingDecision =
  |{pointer:string;choice:'source'|'target'|'absent';value:null}
  |{pointer:string;choice:'custom';value:unknown};
export interface InstallationMappingPreviewInput extends InstallationMappingComparisonInput {
  decisions:InstallationMappingDecision[];files:InstallationEditionFileDecision[];
}
export interface InstallationMappingPlan extends InstallationMappingComparisonInput,GrantObject {
  schema:'stellar-forge.installation-mapping-plan.v1';caseId:string;comparisonSha256:string;
  decisions:InstallationMappingDecision[];selection:GrantObject|null;selectionSha256:string;
  arrayChanges:Array<{pointer:string;positions:Array<{originalIndex:number;resultIndex:number|null}>}>;
  editionPlan:InstallationEditionPlan;sha256:string;
}
export interface InstallationMappingReceipt extends GrantObject {
  schema:'stellar-forge.installation-mapping-reconciliation.v1';state:'RECONCILED_SOURCE_MAPPING';
  caseId:string;draftId:string;draftRevision:number;requestId:string;actor:string;at:string;
  source:InstallationEditionRef;target:InstallationEditionRef;plan:InstallationMappingPlan;
  editionTransition:GrantObject;sha256:string;
}
export function prepareInstallationSourceMapping(plan:InstallationMappingPlan,
  context:InstallationSourceContext):InstallationSourceOperation;

export interface InstallationMappingWire<Value=unknown> {
  schema:'stellar-forge.installation-mapping-wire.v1';canonicalJSON:string;sha256:string;
  /** Read-route convenience view; canonicalJSON is the exact numeric authority. */
  value?:Value;
}
export function prepareInstallationSourceMappingWire(wire:InstallationMappingWire<InstallationMappingPlan>,
  context:InstallationSourceContext):InstallationSourceOperation;

export const INSTALLATION_SOURCE_MAX_JSON_BYTES:number;
