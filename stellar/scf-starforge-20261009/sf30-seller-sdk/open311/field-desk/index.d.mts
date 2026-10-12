// MIT. Complete public types for the municipal field desk.
import type { Server } from 'node:http';
export type JSON = null | boolean | number | string | JSON[] | { [key:string]:JSON };
export type JSONObject = { [key:string]:JSON };
export interface OriginalFile { filename?:string; contentType?:string; bytes:number; sha256:string }
export interface HostInput { alias:string; sha256:string; kind:'source'|'return'|'workspace'|'attachment'; format:'json'|'binary'; contentType?:string }
export interface WriteIntent { requestId:string; expectedRevision:number; hostInput?:HostInput }
export interface MutationBase { workspaceId:string; revision:number; requestId:string }
export type Mutation<T> = MutationBase & T;
export interface Page<T> { items:T[]; total:number; offset:number; limit:number; nextOffset:number|null }
export interface Paging { offset?:number; limit?:number; q?:string }
export interface Operation { requestId:string; kind:string; state:'SUCCEEDED'; inputSha256:string; input:JSONObject; result:MutationBase & JSONObject; createdAt:string }
export interface OperationSummary { requestId:string; kind:string; state:'SUCCEEDED'; createdAt:string }
export interface SourceSummary {
  id:string; name:string; kind:'dispatch'|'workspace'; seriesId:string;
  dispatchId:string; dispatchSha256:string; editionId:string; editionSha256:string;
  originWorkspaceId:string|null; originRevision:number|null; createdAt:string; rows:number; originalFile:OriginalFile; sha256:string;
}
export interface OriginalRecord {
  key:string; sourceSha256:string; sourceId:string; sourceSeriesId:string; captureId:string|null; sourceIndex:number;
  identityValues:JSON[]; identityValid:boolean; title:string; description:string; sourceStatus:JSON;
  referenceValues:JSONObject; dates:JSONObject; createdAt:string|null; updatedAt:string|null; closedAt:string|null;
  geometry:JSON; location:JSON; originalGeometry:JSON; spatialReference:JSON; source:JSONObject; original:JSON; issues:JSON[]; versions:JSON[];
  serviceRequestId?:string; workOrderId?:string; workNeeded?:'needed'|'not_needed'|'unknown'; costs?:JSON[];
}
export interface OriginalDispatchRow {
  key:string; serviceRequestId:string; sourceSha256:string; request:OriginalRecord & {serviceRequestId:string};
  orders:(OriginalRecord & {workOrderId:string})[]; work:JSONObject & {id:string;sha256:string}; geometry:JSON; mapped:JSONObject;
}
export interface OriginalDispatch {
  schema:'commons.open311.follow-through-dispatch.v1'; id:string; name:string; editionId:string; editionSha256:string; seriesId:string; createdAt:string;
  definition:JSONObject & {editionId:string;workIds:string[]}; rows:OriginalDispatchRow[]; coverage:JSON; totals:{actions:number;located:number;unlocated:number}; sha256:string;
}
export interface Source extends SourceSummary {
  schema:'commons.open311.field-source.v1'; originalText:string; dispatch:OriginalDispatch; options:{name:string;dispatchId:string};
}
export interface SourceInspection {
  schema:'commons.open311.follow-through-dispatch.v1'|'commons.open311.follow-through-workspace.v1';
  kind:'dispatch'|'workspace'; origin:{workspaceId:string;revision:number}|null; originalFile:OriginalFile;
  dispatches:{id:string;name:string;seriesId:string;editionId:string;rows:number;sha256:string;createdAt:string}[];
  requiresSelection:boolean; selectedDispatchId:string|null;
}
export interface SourceDetail { source:SourceSummary; dispatch:OriginalDispatch; origin:{workspaceId:string;revision:number}|null; originalFile:OriginalFile }
export interface ImportSourceInput extends WriteIntent { name:string; originalText:string; dispatchId?:string }
export interface CrewMember { id?:string; name:string; role?:string; contact?:string }
export interface CrewInput { id?:string; name:string; members?:CrewMember[]; note?:string; active?:boolean }
export interface Crew {
  schema:'commons.open311.field-crew.v1'; id:string; versionId:string; previousVersionId:string|null; name:string;
  members:{id:string;name:string;role:string;contact:string}[]; note:string; active:boolean; createdAt:string; sha256:string;
}
export interface CrewDetail { crew:Crew; history:Crew[] }
export type FieldStatus='planned'|'assigned'|'in_progress'|'completed'|'unable'|'cancelled';
export type Priority='low'|'normal'|'high'|'urgent';
export interface FieldNote { id:string; author:string; text:string; recordedAt:string }
export interface ResourceLine {
  id:string; kind:'labor'|'material'|'equipment'|'other'; name:string; quantity:string; unit:string; unitCost:string|null; currency:string|null; note:string;
}
export interface FieldRecord {
  status:FieldStatus; actualStart:string|null; actualEnd:string|null; completionNote:string;
  notes:FieldNote[]; resources:ResourceLine[]; attachmentIds:string[];
}
export interface VisitInput {
  id?:string; sourceId:string; sourceKey:string; crewId?:string|null; title?:string;
  plannedStart?:string|null; plannedEnd?:string|null; dueAt?:string|null; priority?:Priority; instructions?:string; field?:Partial<FieldRecord>;
}
export interface SourceBinding {
  sourceId:string; sourceSha256:string; seriesId:string; dispatchId:string; dispatchSha256:string; editionId:string; editionSha256:string;
  sourceKey:string; serviceRequestId:string; requestSha256:string; workId:string; workSha256:string;
  orders:{key:string;workOrderId:string;sourceSha256:string}[]; rowSha256:string;
}
export interface Visit {
  schema:'commons.open311.field-visit.v1'; id:string; versionId:string; previousVersionId:string|null; createdAt:string;
  sourceId:string; sourceKey:string; serviceRequestId:string; workId:string; source:SourceBinding;
  crewId:string|null; crewVersionId:string|null; crewName:string; title:string; plannedStart:string|null; plannedEnd:string|null; dueAt:string|null;
  priority:Priority; instructions:string; field:FieldRecord; cause:JSONObject|null; sha256:string;
}
export interface SourceChange {
  sourceId:string; latestSourceId:string; latestDispatchId:string; latestDispatchSha256:string; sourceKey:string;
  originalRowSha256:string; latestRowSha256:string|null; missingFromLatest:boolean; changed:boolean; packageSourceChanged?:boolean;
}
export interface Approval {
  visitId:string; versionId:string; outcome:'approve'|'return_to_crew'; note:string; sourceContext:SourceChange; acknowledgeSourceChange:boolean;
  reviewId:string; reviewer:string; createdAt:string; reviewNote:string; returnId:string|null; decisionId:string|null; current:boolean;
}
export interface VisitSummary {
  id:string; versionId:string; previousVersionId:string|null; sourceId:string; sourceKey:string; serviceRequestId:string; workId:string;
  title:string; crewId:string|null; crewVersionId:string|null; crewName:string; priority:Priority; plannedStart:string|null; plannedEnd:string|null;
  dueAt:string|null; createdAt:string; field:FieldRecord; sha256:string; sourceChanged?:boolean; approval?:Approval|null;
}
export interface VisitDetail { visit:Visit; sourceRow:OriginalDispatchRow; source:SourceSummary; crew:Crew|null; history:Visit[]; attachments:AttachmentMetadata[]; approval:Approval|null; sourceChange:SourceChange }
export interface VisitQuery extends Paging { sourceId?:string; crewId?:string; status?:FieldStatus|'' }
export interface SourceRowsQuery extends Paging { sourceId:string }
export interface AttachmentInput { filename:string; contentType:string; contentBase64:string }
export interface AttachmentMetadata { id:string; filename:string; contentType:string; bytes:number; sha256:string; createdAt:string; aliases?:{filename:string;contentType:string;createdAt:string}[] }
export interface AttachmentFile extends AttachmentMetadata { contentBase64:string }
export interface FileResult { filename:string; contentType:string; body:string|Uint8Array; bytes:number; sha256:string }
export interface PackageInput extends WriteIntent { name:string; visitIds:string[]; note?:string }
export interface PackageEntry { visit:Visit; sourceRow:OriginalDispatchRow; source:SourceSummary; crew:Crew|null }
export interface CrewPackage {
  schema:'commons.open311.field-crew-package.v1'; id:string; name:string; workspaceId:string; workspaceRevision:number; createdAt:string; note:string;
  visits:PackageEntry[]; attachments:AttachmentFile[]; sha256:string;
}
export interface PackageSummary { id:string; name:string; workspaceId:string; workspaceRevision:number; createdAt:string; visits:number; attachments:number; sha256:string }
export interface CrewReturn {
  schema:'commons.open311.field-return.v1'; packageId:string; packageSha256:string; name:string; returnedBy:string; note?:string;
  visits:{visitId:string;baseVersionId:string;fields:Partial<FieldRecord>}[]; attachments?:AttachmentInput[];
}
export interface ReturnSummary { id:string; packageId:string; name:string; returnedBy:string; createdAt:string; proposals:number; attachments:number; sha256:string; pending?:number }
export interface ReturnChange {
  id:string; path:string; field:keyof FieldRecord; entryId:string|null; base:JSON; current:JSON; returned:JSON; conflict:boolean;
}
export interface ReturnProposal {
  id:string; visitId:string; baseVersionId:string; currentVersionId:string; fields:Partial<FieldRecord>;
  status:'pending'|'accepted'|'rejected'; decisionId:string|null; changes:ReturnChange[]; sourceChange:SourceChange; assignmentChanged:boolean;
}
export interface FieldChoice { changeId:string; choice:'returned'|'current' }
export interface ProposalDecision {
  proposalId:string; choice:'accept'|'reject'; expectedVisitVersionId:string; fieldChoices?:FieldChoice[];
  acknowledgeSourceChange?:boolean; acknowledgeAssignmentChange?:boolean; note?:string;
}
export interface DecideInput extends WriteIntent { returnId:string; reviewer:string; note?:string; decisions:ProposalDecision[] }
export interface SavedDecision {
  schema:'commons.open311.field-decision.v1'; id:string; returnId:string; reviewer:string; note:string; createdAt:string; reviewId:string|null;
  decisions:{
    proposalId:string; visitId:string; choice:'accept'|'reject'; expectedVisitVersionId:string; baseVersionId:string; note:string;
    sourceChange:SourceChange; assignmentChanged:boolean; acknowledgeSourceChange:boolean; acknowledgeAssignmentChange:boolean;
    resultVersionId:string; applied:{changeId:string;path:string;choice:'returned'|'current';conflict:boolean}[];
  }[]; sha256:string;
}
export interface ReturnDetail { return:ReturnSummary; package:PackageSummary; proposals:ReturnProposal[]; decisions:SavedDecision[]; originalFile:OriginalFile }
export interface VisitReviewSelection { visitId:string; expectedVersionId:string; outcome:'approve'|'return_to_crew'; note?:string }
export interface VisitReviewInput extends WriteIntent { reviewer:string; note?:string; selections:VisitReviewSelection[] }
export interface SavedReview {
  schema:'commons.open311.field-supervisor-review.v1'; id:string; reviewer:string; note:string; createdAt:string; returnId:string|null; decisionId:string|null;
  selections:{visitId:string;versionId:string;outcome:'approve'|'return_to_crew';note:string;sourceContext:SourceChange;acknowledgeSourceChange:boolean}[]; sha256:string;
}
export interface Destination { name:string; system:string; reference?:string }
export interface UpdateSelection { visitId:string; expectedVersionId:string; action:'update'|'request_closure'; destinationReference?:string; note?:string }
export interface UpdateInput extends WriteIntent { name:string; reviewer:string; destination:Destination; note?:string; items:UpdateSelection[] }
export interface ResourceTotals { resources:{kind:string;name:string;unit:string;quantity:string;entries:number}[]; costs:{currency:string;amount:string}[] }
export interface UpdateItem {
  id:string; action:'update'|'request_closure'; destinationReference:string; note:string; visit:Visit; source:SourceSummary;
  sourceRow:OriginalDispatchRow; dispatchDefinition:JSONObject; sourceBinding:SourceBinding; approval:Approval; crew:Crew|null;
}
export interface DestinationUpdate {
  schema:'commons.open311.field-destination-update.v1'; id:string; name:string; workspaceId:string; workspaceRevision:number; createdAt:string;
  reviewer:string; destination:Required<Destination>; note:string; items:UpdateItem[]; attachments:AttachmentFile[];
  totals:ResourceTotals & {visits:number;closureRequests:number}; sha256:string;
}
export interface UpdateSummary { id:string; name:string; destination:Required<Destination>; reviewer:string; createdAt:string; items:number; totals:DestinationUpdate['totals']; sha256:string }
export interface ReceivingReceipt {
  requestId:string; receivedAt:string; destinationWorkspaceId:string; originWorkspaceId:string; originRevision:number; originalFile:OriginalFile; packageSha256:string;
}
export interface Counts { sources:number; crews:number; visits:number; packages:number; returns:number; pendingProposals:number; updates:number; attachments:number; fieldStatuses:Record<FieldStatus,number> }
export interface WorkspaceState {
  schema:'commons.open311.field-desk-workspace.v1'; workspaceId:string; revision:number; directory:string; createdAt:string; updatedAt:string; receivedFrom:ReceivingReceipt[];
  sources:SourceSummary[]; crews:Crew[]; packages:PackageSummary[]; returns:ReturnSummary[]; updates:UpdateSummary[]; counts:Counts; operations:OperationSummary[];
}
export interface WorkspaceBundle {
  schema:'commons.open311.field-desk-workspace.v1'; workspaceId:string; revision:number; createdAt:string; updatedAt:string; exportedAt:string;
  records:{kind:string;id:string;value:JSONObject}[]; operations:Operation[]; receivedFrom:ReceivingReceipt[]; sha256:string;
}
export type ExportKind='workspace'|'source'|'crew-json'|'crew-html'|'returned'|'visits-csv'|'update-json'|'update-csv'|'update-geojson'|'update-report';
export interface ExportSelection {
  kind?:ExportKind; sourceId?:string; packageId?:string; returnId?:string; updateId?:string; crewId?:string; status?:FieldStatus|''; q?:string; expectedRevision?:number;
}
export interface FieldDeskWorkspace {
  readonly directory:string; readonly filename:string;
  state():WorkspaceState;
  operation(requestId:string):Operation|null;
  inspectSource(originalText:string,options?:{dispatchId?:string}):SourceInspection;
  importSource(input:ImportSourceInput):Mutation<{source:SourceSummary}>;
  source(id:string):SourceDetail;
  sourceRows(selection:SourceRowsQuery):Page<OriginalDispatchRow>;
  putCrew(input:WriteIntent & {crew:CrewInput}):Mutation<{crew:Crew}>;
  crew(id:string):CrewDetail;
  putVisit(input:WriteIntent & {visit:VisitInput}):Mutation<{visit:VisitSummary}>;
  visits(selection?:VisitQuery):Page<VisitSummary>;
  visit(id:string):VisitDetail;
  putAttachment(input:WriteIntent & {attachment:AttachmentInput}):Mutation<{attachment:AttachmentMetadata;duplicate:boolean}>;
  attachment(id:string):FileResult;
  createPackage(input:PackageInput):Mutation<{package:PackageSummary}>;
  package(id:string):{package:CrewPackage};
  importReturn(input:WriteIntent & {originalText:string;name?:string}):Mutation<{return:ReturnSummary}>;
  returned(id:string):ReturnDetail;
  applyDecisions(input:DecideInput):Mutation<{decision:SavedDecision;return:ReturnSummary}>;
  reviewVisits(input:VisitReviewInput):Mutation<{review:SavedReview}>;
  createUpdate(input:UpdateInput):Mutation<{update:UpdateSummary}>;
  update(id:string):{update:DestinationUpdate};
  exportFile(selection?:ExportSelection):FileResult;
  workspaceExport():WorkspaceBundle;
  receive(input:WriteIntent & {originalText:string}):Mutation<{packageSha256:string;receivedFrom:ReceivingReceipt}>;
  close():void;
}
export interface WorkspaceBinding { schema:'stellar-forge.open311-field-desk-binding.v1'; directory:string; workspaceId:string; sha256:string }
export interface FieldDeskLaunch {
  schema:'stellar-forge.open311-field-desk-startup.v1'; state:'LISTENING'; directory:string; workspaceId:string; bindingSha256:string;
  binding:WorkspaceBinding; instanceId:string; startedAt:string; url:string;
}
export interface FieldDeskServer { server:Server; workspace:FieldDeskWorkspace; url:string; startup:FieldDeskLaunch; readonly launch:FieldDeskLaunch; close():Promise<void> }
export interface ServeOptions { directory:string; host?:'127.0.0.1'|'::1'; port?:number; expectedWorkspaceId?:string; expectedBindingSha256?:string }
export function openWorkspace(directory:string,options?:{create?:boolean}):FieldDeskWorkspace;
export function validateWorkspacePackage(originalText:string):WorkspaceBundle;
export function serveFieldDesk(options:ServeOptions):Promise<FieldDeskServer>;
export function startFieldDeskServer(options:Omit<ServeOptions,'directory'> & {workspace:string}):Promise<FieldDeskServer>;
export function workspaceBinding(directory:string,workspaceId:string):string;
export function inspectSource(originalText:string,options?:{dispatchId?:string}):SourceInspection;
export function validateDispatch(value:unknown):OriginalDispatch;
export function resourceTotals(visits:Visit[]):ResourceTotals;
export function addDecimal(a:string,b:string):string;
export function multiplyDecimal(a:string,b:string):string;
export const WORKSPACE_SCHEMA:'commons.open311.field-desk-workspace.v1';
export const DATABASE_SCHEMA:'commons.open311.field-desk-database.v1';
export const SOURCE_SCHEMA:'commons.open311.field-source.v1';
export const FOLLOW_DISPATCH_SCHEMA:'commons.open311.follow-through-dispatch.v1';
export const FOLLOW_WORKSPACE_SCHEMA:'commons.open311.follow-through-workspace.v1';
export const CREW_SCHEMA:'commons.open311.field-crew.v1';
export const VISIT_SCHEMA:'commons.open311.field-visit.v1';
export const ATTACHMENT_SCHEMA:'commons.open311.field-attachment.v1';
export const PACKAGE_SCHEMA:'commons.open311.field-crew-package.v1';
export const RETURN_INPUT_SCHEMA:'commons.open311.field-return.v1';
export const RETURN_SCHEMA:'commons.open311.field-return-record.v1';
export const DECISION_SCHEMA:'commons.open311.field-decision.v1';
export const REVIEW_SCHEMA:'commons.open311.field-supervisor-review.v1';
export const UPDATE_SCHEMA:'commons.open311.field-destination-update.v1';
export const STARTUP_SCHEMA:'stellar-forge.open311-field-desk-startup.v1';
export const BINDING_SCHEMA:'stellar-forge.open311-field-desk-binding.v1';
export const FIELD_STATUSES:FieldStatus[];
export const PRIORITIES:Priority[];
