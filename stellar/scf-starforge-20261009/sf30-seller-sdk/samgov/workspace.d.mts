/// <reference types="node" />
export type SamJson = null | boolean | number | string | SamJson[] | {[key:string]:SamJson};
export type SamCaptureStatus = 'queued'|'running'|'paused'|'failed'|'capacity'|'complete';
export interface SamQueryDefinition {
  filters:{postedFrom:string;postedTo:string;noticeid?:string;solnum?:string;title?:string;
    ptype?:string|string[];organizationCode?:string;organizationName?:string;ncode?:string;ccode?:string;
    typeOfSetAside?:string;state?:string;zip?:string;rdlfrom?:string;rdlto?:string};
  pageSize:number;maxRecords:number;sourceTerms:string;
}
export interface SamQuery {id:string;name:string;revision:number;definition:SamQueryDefinition;createdAt:string;updatedAt:string}
export interface SamSource {
  id:string;kind:'search_page'|'description'|'attachment';url:string;filename:string;mediaType:string;
  bytes:number;sha256:string;capturedAt:string;status:number;request:{method:'GET';url:string};
  headers:Record<string,string>;originalSha256:string;
  redactions:Array<{kind:string;replacements:number}>;redirects:Array<{status:number;from:string;to:string}>;
  representation:'original'|'credential_redacted';originalPrivateAtCapture:boolean;noticeId?:string;
}
export interface SamSourceRead extends SamSource {contentBase64:string;contentText?:string}
export interface SamResource {
  sourceId:string|null;kind:'description'|'attachment';url:string;filename:string;
  mediaType:string|null;bytes:number;sha256:string|null;capturedAt:string;status:number|'unavailable';
  originalSha256?:string;redactions?:SamSource['redactions'];error?:SamFailure;
}
export interface SamNotice {
  noticeId:string;title:string|null;solicitationNumber:string|null;fullParentPathName:string|null;
  fullParentPathCode:string|null;postedDate:string|null;type:string|null;baseType:string|null;active:string|null;
  responseDeadLine:string|null;archiveDate:string|null;archiveType:string|null;
  naicsCode:string|null;classificationCode:string|null;setAsideCode:string|null;setAsideDescription:string|null;
  descriptionUrl:string|null;uiUrl:string;resourceLinks:string[];awardAmount:string|null;
  awardNumber:string|null;awardDate:string|null;awardeeName:string|null;awardeeUei:string|null;
  pointOfContact:SamJson;placeOfPerformance:SamJson;raw:Record<string,SamJson>;recordSha256:string;
  deadlineStatus:'absent'|'explicit_offset'|'requires_timezone_review';
  source:{sourceId:string;rowPointer:string;pageOffset:number;sha256:string;capturedAt:string;url:string};
  resources:SamResource[];
}
export interface SamEdition {
  id:string;name:string;kind:'api_observation'|'resource_enriched';captureId:string|null;parentEditionId:string|null;
  querySha256:string;rowCount:number;sourceCount:number;sourceIds:string[];sha256:string;objectSha256:string;
  createdAt:string;complete:boolean;sourceBasis:'latest_api_observation';
}
export interface SamPage {
  index:number;offset:number;limit:number;count:number;totalRecords:number;sourceId:string;
  sha256:string;capturedAt:string;status:number;
}
export interface SamAttempt {
  id:string;offset:number;requestedAt:string;request:{method:'GET';url:string};
  status:string;sourceId?:string;responseStatus?:number;capturedAt?:string;sha256?:string;
  error?:SamFailure;endedAt?:string;
}
export interface SamPending {id:string;offset:number;request:{method:'GET';url:string};requestedAt:string}
export interface SamFailure {code:string;message:string;status:number;requiredRecords?:number}
export interface SamCapture {
  id:string;name:string;queryId:string;queryRevision:number;definition:SamQueryDefinition;
  endpoint:string;querySha256:string;status:SamCaptureStatus;nextOffset:number;count:number;
  totalRecords:number|null;pageCount:number;attemptCount:number;startedAt:string|null;updatedAt:string;
  completedAt:string|null;error:SamFailure|null;editionId:string|null;manifestSha256:string;
}
export interface SamDeadline {at:string;timeZone:string;reason:string}
export interface SamSelection {
  id:string;name:string;revision:number;editionId:string;noticeIds:string[];notes:string;createdAt:string;updatedAt:string;
}
export interface SamReview {
  id:string;editionId:string;noticeId:string;recordSha256:string;
  status:'unreviewed'|'watching'|'qualified'|'declined'|'needs_review';owner:string;notes:string;
  deadline:SamDeadline|null;createdAt:string;createdBy:string;revision:number;
}
export interface SamChange {
  id:string;beforeEditionId:string;afterEditionId:string;noticeId:string;
  kind:'added'|'removed'|'changed'|'unchanged';changedFields:string[];
  beforeSha256:string|null;afterSha256:string|null;decision:'reviewed'|'follow_up'|'dismissed';
  owner:string;note:string;createdAt:string;createdBy:string;revision:number;
}
export interface SamHandoff {
  id:string;name:string;note:string;selectionId:string;selectionRevision:number;editionId:string;
  sourceRevision:number;sourceStateSha256:string;revision:number;createdAt:string;createdBy:string;
}
export interface SamPublication {
  id:string;kind:'merchant'|'opportunity';selectionId:string;selectionRevision:number;editionId:string;
  sourceRevision:number;sourceStateSha256:string;createdAt:string;createdBy:string;
  files:Array<{path:string;sha256:string;bytes:number}>;
  directory?:string;bundle?:Record<string,SamJson>;snapshot?:string;seller?:Record<string,SamJson>|null;
  buyerReviews?:Array<Record<string,SamJson>>;buyerPreparations?:Array<Record<string,SamJson>>;
  noticeId?:string;projectId?:string;projectRevision?:number;bridgeId?:string;
  sourceBindings?:Array<Record<string,SamJson>>;
}
export interface SamHistoryEntry {
  revision:number;at:string;operator:string;action:string;requestId:string|null;sha256:string;
}
export interface SamWorkspaceView {
  id:string|null;schema:'stellar-forge.samgov-workspace.v1';revision:number;createdAt:string|null;updatedAt:string|null;
  queries:SamQuery[];captures:SamCapture[];editions:SamEdition[];selections:SamSelection[];sources:SamSource[];
  reviews:SamReview[];changes:SamChange[];handoffs:SamHandoff[];publications:SamPublication[];
  history:SamHistoryEntry[];summary:Record<string,number>;
  capabilities?:{canCapture:boolean;keyConfigured:boolean;readOnly:boolean;activeCaptures:string[];
    endpoint:string;apiKeyEnv:string;opportunityConfigured:boolean};
}
export interface SamVersion {
  sha256:string;
  state:Omit<SamWorkspaceView,'history'|'summary'|'capabilities'> & {
    previous:string|null;
    change:{action:string;operator:string;requestId:string|null;requestSha256:string|null;result:SamJson};
  };
}
export interface SamPacket {
  schema:'stellar-forge.samgov-packet.v1';id:string;revision:number;createdAt:string;
  selectionId:string|null;handoffId:string|null;
  workspace:Omit<SamWorkspaceView,'capabilities'>;versions:SamVersion[];
  editions:Array<SamEdition & {rows:SamNotice[]}>;sources:SamSource[];
  objects:Array<{sha256:string;bytes:number;contentBase64:string}>;sha256:string;
}
export interface SamComparison {
  before:SamEdition;after:SamEdition;sourceBasis:'latest_api_observation';
  counts:{added:number;removed:number;changed:number;unchanged:number};
  items:Array<{noticeId:string;kind:'added'|'removed'|'changed'|'unchanged';title:string|null;
    changedFields:string[];before:SamNotice|null;after:SamNotice|null}>;
}
export interface SamGet {
  kind:'query'|'capture'|'edition'|'selection'|'handoff'|'publication';
  record:SamQuery|SamCapture|SamEdition|SamSelection|SamHandoff|SamPublication;
  items:Array<SamPage|SamNotice|SamCapture>;total:number;offset:number;limit:number;
  pages?:SamPage[];attempts?:SamAttempt[];pending?:SamPending|null;
  sourceBasis?:'latest_api_observation';edition?:SamEdition;
}
export interface SamMutationEnvelope {expectedRevision:number;requestId:string}
export interface SamMutation {workspace:SamWorkspaceView;result:Record<string,unknown>;reused?:boolean}
export interface SamActionPayloads {
  save_query:SamMutationEnvelope & Partial<Pick<SamQueryDefinition,'pageSize'|'maxRecords'|'sourceTerms'>> &
    {queryId?:string;name:string;filters:SamQueryDefinition['filters']};
  start_capture:SamMutationEnvelope & {queryId:string;queryRevision:number;name?:string};
  run_capture:SamMutationEnvelope & {captureId:string};
  resize_capture:SamMutationEnvelope & {captureId:string;maxRecords:number};
  import_capture:SamMutationEnvelope & {name:string;definition:SamQueryDefinition;pages:Array<{
    request:{method:'GET';url:string};status:number;capturedAt:string;headers?:Record<string,string>;contentBase64:string}>};
  save_selection:SamMutationEnvelope & {selectionId?:string;editionId:string;name:string;noticeIds:string[];notes?:string};
  review_notice:SamMutationEnvelope & {editionId:string;noticeId:string;status:SamReview['status'];owner:string;
    notes?:string;deadline?:SamDeadline|null};
  review_change:SamMutationEnvelope & {beforeEditionId:string;afterEditionId:string;noticeId:string;
    decision:SamChange['decision'];owner:string;note:string};
  create_handoff:SamMutationEnvelope & {name:string;selectionId:string;note?:string};
  capture_resources:SamMutationEnvelope & {editionId:string;noticeIds:string[];descriptions?:boolean;
    attachments?:boolean;resourceUrls?:string[]};
  retain_resource:SamMutationEnvelope & {editionId:string;noticeId:string;kind:'description'|'attachment';
    url:string;filename:string;mediaType:string;capturedAt:string;contentBase64:string};
  prepare_merchant:SamMutationEnvelope & {selectionId:string;payment?:Record<string,SamJson>;origin?:string;
    path?:string;defaultLimit?:number;maxLimit?:number};
  buyer_review:SamMutationEnvelope & {publicationId:string;seller:string;query?:Record<string,string|number>|string};
  prepare_buyer:SamMutationEnvelope & {publicationId:string;reviewId:string;intentId:string;
    acceptIndex:number;offerSha256:string};
  prepare_opportunity:SamMutationEnvelope & {selectionId:string;noticeId:string;projectId?:string;
    expectedProjectRevision?:number;title?:string;documentKind?:'rfi'|'sources_sought'|'solicitation'|'other';
    deadline?:SamDeadline|null};
}
export interface SamProgress {
  captureId:string;status:SamCaptureStatus;nextOffset:number;count:number;totalRecords:number|null;pageCount:number;
  attemptCount:number;pending:SamPending|null;error:SamFailure|null;retryAt:string|null;updatedAt:string;
}
export interface SamRunOptions {signal?:AbortSignal;onProgress?:(progress:SamProgress)=>unknown|Promise<unknown>}
export interface SamPacketSelection {revision?:number;selectionId?:string;handoffId?:string}
export interface SamWorkspace {
  readonly directory:string;
  list():Promise<SamWorkspaceView>;
  get(id:string,options?:{offset?:number;limit?:number;search?:string}):Promise<SamGet>;
  dispatch<A extends keyof SamActionPayloads>(action:A,payload:SamActionPayloads[A],options?:SamRunOptions):Promise<SamMutation>;
  dispatch(action:'view',payload?:Record<string,never>):Promise<SamWorkspaceView>;
  dispatch(action:'get',payload:{id:string;offset?:number;limit?:number;search?:string}):Promise<SamGet>;
  dispatch(action:'notice',payload:{editionId:string;noticeId:string}):Promise<{
    edition:SamEdition;notice:SamNotice;reviews:SamReview[];changes:SamChange[]}>;
  dispatch(action:'read_source',payload:{sourceId:string}):Promise<SamSourceRead>;
  dispatch(action:'compare',payload:{beforeEditionId:string;afterEditionId:string}):Promise<SamComparison>;
  dispatch(action:'cancel_capture',payload:{captureId:string}):Promise<{captureId:string;active:boolean;pauseRequested:boolean}>;
  readSource(sourceId:string):Promise<SamSourceRead>;
  compare(beforeEditionId:string,afterEditionId:string):Promise<SamComparison>;
  exportPacket(options?:SamPacketSelection):Promise<SamPacket>;
  importPacket(packet:SamPacket|Buffer|string):Promise<SamWorkspaceView>;
  runCapture(captureId:string,options?:SamRunOptions):Promise<SamMutation>;
  cancelCapture(captureId:string):{captureId:string;active:boolean;pauseRequested:boolean};
  close():Promise<void>;
}
export interface SamWorkspaceOptions {
  directory:string;operator?:string;apiKeyEnv?:string;endpoint?:string;environment?:Record<string,string|undefined>;
  fetchImpl?:typeof fetch;readOnly?:boolean;opportunityDirectory?:string;timeoutMs?:number;maxSourceBytes?:number;
}
export function openSamWorkspace(options:SamWorkspaceOptions):Promise<SamWorkspace>;
