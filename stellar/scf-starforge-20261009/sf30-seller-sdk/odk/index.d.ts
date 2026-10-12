// MIT. Original ODK Central native, Applications and merchant interfaces.
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type Awaitable<T> = T | Promise<T>;
export type RecordValue = Record<string,unknown>;
export interface CentralScope {
  submittedFrom?:string; submittedBefore?:string; updatedSince?:string; pageSize?:number;
}
export interface CentralFormSelection {projectId:number|string;formId:string}
export interface CentralConnectionInput {
  id?:string;name:string;url:string;authEnv:string;allowLoopback?:boolean;
}
export interface CentralPlanInput {
  id?:string;name:string;connectionId:string;forms:CentralFormSelection[];scope:CentralScope;
}
export interface CentralIndicator {
  name?:string;tableId:string;field?:string;
  operation:'rows'|'nonempty'|'sum'|'mean'|'minimum'|'maximum'|'distinct'|'frequency';
  equals?:string|number|boolean|null;
}
export interface CentralDatasetRuntime {port?:number;facilitator?:string;allowLocalFacilitator?:boolean}
export interface CentralReviewInput {
  id:string;expectedRevision:number;decision:'accept'|'revise';note:string;reviewer?:string;
  findings?:RecordValue[];indicators?:CentralIndicator[];
}
export interface CentralFileDescriptor {
  path:string;sha256:string;bytes:number;downloadUrl?:string;url?:string;[key:string]:unknown;
}
export interface CentralSavedFiles {
  id:string;files:string[];receipts:Record<string,{sha256:string;bytes:number}>;
  [key:string]:unknown;
}
export interface CentralDatasetInput {
  id:string;tableId:string;fields?:string[];name?:string;payment?:RecordValue;
  origin?:string;path?:string;exportId?:string;expectedSemanticSha256?:string;
  defaultLimit?:number;maxLimit?:number;
}
export interface CentralReportInput {
  id:string;baselineId?:string|null;title?:string;narrative?:string;
  indicators?:CentralIndicator[];reportId?:string;
}
export interface CentralReceivedArchive {
  archiveSha256:string;archiveBytes:number;workspaceId:string;workspaceRevision:number;files:number;
}
export interface CentralState {
  schema:'stellar-forge.odk-central-workspace.v1';id:string;revision:number;createdAt:string;
  connections:RecordValue[];plans:RecordValue[];captures:RecordValue[];reviews:RecordValue[];
  exports:RecordValue[];reports:RecordValue[];archives:RecordValue[];running:string[];
  receivedArchive:CentralReceivedArchive|null;
  publisherSnapshots:RecordValue[];publisherReceiving:RecordValue[];[key:string]:unknown;
}
export interface CentralCaptureSummary extends RecordValue {
  id:string;revision:number;status:string;contentHash?:string;rowCount:number;submissionCount:number;
  forms:RecordValue[];tables:RecordValue[];decision:RecordValue|null;
}
export interface CentralCapture extends RecordValue {
  id:string;revision:number;status:string;contentHash?:string;
  forms:RecordValue[];tables:RecordValue[];decisions:RecordValue[];
}
export interface CentralRowsPage {rows:RecordValue[];next:string|null;[key:string]:unknown}
export interface CentralResourcesPage {resources:RecordValue[];next:number|null;[key:string]:unknown}
export interface CentralWorkspace {
  directory:string;
  state():CentralState;
  connect(input:CentralConnectionInput):Awaitable<RecordValue>;
  projects(input:{connectionId:string}):Awaitable<unknown>;
  forms(input:{connectionId:string;projectId:number|string}):Awaitable<unknown>;
  createPlan(input:CentralPlanInput):Awaitable<RecordValue>;
  capture(input:{planId:string;id?:string;label?:string}):Awaitable<CentralCaptureSummary>;
  resume(input:{id:string}):Awaitable<unknown>;
  pause(input:{id:string}):Awaitable<unknown>;
  wait(input:{id:string}):Awaitable<unknown>;
  edition(input:{id:string}):CentralCapture;
  rows(input:{id:string;tableId:string;after?:string;limit?:number;search?:string}):CentralRowsPage;
  row(input:{id:string;tableId:string;rowId:string}):RecordValue;
  resources(input:{id:string;after?:number;limit?:number;kind?:string}):CentralResourcesPage;
  quality(input:{id:string}):RecordValue;
  review(input:CentralReviewInput):CentralCapture;
  compare(input:{leftId:string;rightId:string;tableId:string;after?:string;limit?:number}):RecordValue;
  exportDataset(input:CentralDatasetInput):Promise<CentralSavedFiles>;
  report(input:CentralReportInput):Promise<CentralSavedFiles>;
  backup(input?:{id?:string}):Promise<CentralSavedFiles>;
  sourceFile(input:{hash:string}):Promise<CentralFileDescriptor>;
  exportFile(input:{id:string;path:string}):Promise<CentralFileDescriptor>;
  prepareRelease(input:{exportId:string;releaseId:string;label?:string;runtime?:CentralDatasetRuntime}):Awaitable<RecordValue>;
  releaseStatus(input?:RecordValue):Awaitable<RecordValue>;
  activateRelease(input:{id:string;expectedGeneration:number;reason:string}):Awaitable<RecordValue>;
  rollbackRelease(input:{to:string;expectedGeneration:number;reason:string}):Awaitable<RecordValue>;
  capturePublisher(input:CentralPublisherCaptureInput):Promise<CentralPublisherSnapshot>;
  receivePublisher(input:CentralPublisherReceiveInput):Promise<CentralPublisherReceiving>;
  publisherTransfers(input?:RecordValue):CentralPublisherTransfers;
  close():Promise<void>;
}
export interface CentralExtensionStore {
  directory:string;
  identity():Record<string,string>;
  sourceFile(hash:string):Promise<CentralFileDescriptor>;
  resourceEntries(scope:string):IterableIterator<RecordValue&{key:string;kind:string;sha256:string;bytes:number}>;
  get<T extends RecordValue=RecordValue>(kind:string,id:string,required?:boolean):T|null;
  list<T extends RecordValue=RecordValue>(kind:string):T[];
  put<T extends RecordValue>(kind:string,id:string,value:T,expectedRevision?:number):T;
  writeRecord<T extends RecordValue>(kind:string,id:string,value:T,expectedRevision?:number):T;
  transaction<T>(operation:()=>T):T;
  retain(body:Uint8Array|string):Promise<{sha256:string;bytes:number}>;
  raw(hash:string):Promise<Uint8Array>;
  resource(captureId:string,key:string):RecordValue|null;
  saveResource(captureId:string,key:string,kind:string,receipt:RecordValue):RecordValue;
  [key:string]:unknown;
}
export type CentralWorkspaceExtension=(context:{workspace:CentralWorkspace;store:CentralExtensionStore})=>Awaitable<unknown>;
export function openCentralWorkspace(options:{directory:string;fetchImpl?:typeof fetch;extend?:CentralWorkspaceExtension}):Promise<CentralWorkspace>;
export interface CentralServer {
  url:string;origin:string;directory:string;token:string;close():Promise<void>;
}
export function createCentralServer(options:{workspace:CentralWorkspace;host?:string;port?:number;token?:string;extensions?:CentralServerExtension[]}):Promise<CentralServer>;
export interface RestoreCentralResult extends CentralReceivedArchive {
  schema:'stellar-forge.odk-central-workspace.v1';directory:string;replayed?:boolean;currentWorkspaceRevision?:number;
}
export function restoreCentralArchive(options:{archive:string;directory:string;expectedSha256?:string;signal?:AbortSignal}):Promise<RestoreCentralResult>;
export const ODK_CONNECTION_FILENAME:'odk.connection.json';
export const ODK_CONNECTION_SCHEMA:'stellar-forge.odk-central-live-connection.v1';
export const ODK_STARTUP_SCHEMA:'stellar-forge.odk-central-workspace-startup.v1';
export interface CentralConnectionValue {
  schema:typeof ODK_CONNECTION_SCHEMA;instanceId:string;directory:string;
  directoryIdentity:{dev:string;ino:string};workspaceId:string;operator:string;pid:number;
  startedAt:string;origin:string;url:string;
}
export interface CentralConnection {
  path:string;sha256:string;value:CentralConnectionValue;token:string;
}
export function readCentralConnection(path:string,options?:{directory?:string}):Promise<CentralConnection>;
export interface CentralRequestOptions {signal?:AbortSignal;timeoutMs?:number;maximum?:number;fetchImpl?:typeof fetch}
export function inspectCentralListener(connection:CentralConnection,options?:CentralRequestOptions):Promise<CentralState>;
export type CentralAction='connect'|'projects'|'forms'|'createPlan'|'capture'|'resume'|'pause'|'wait'|
  'edition'|'rows'|'row'|'resources'|'quality'|'review'|'compare'|'exportDataset'|'report'|'backup'|
  'sourceFile'|'exportFile'|'prepareRelease'|'releaseStatus'|'activateRelease'|'rollbackRelease'|
  'capturePublisher'|'receivePublisher'|'publisherTransfers';
export class CentralWorkspaceClient {
  constructor(connection:CentralConnection,options?:{fetchImpl?:typeof fetch});
  readonly binding:{instanceId:string;workspaceId:string;operator:string;startedAt:string;origin:string;pid:number};
  state(options?:CentralRequestOptions):Promise<CentralState>;
  action<T=unknown>(method:CentralAction,input?:RecordValue,options?:CentralRequestOptions):Promise<T>;
  namespaceAction<T=unknown>(namespace:CentralActionNamespace,method:CentralAction|CentralCommissioningAction,input?:RecordValue,options?:CentralRequestOptions):Promise<T>;
  commissioningAction<T=unknown>(method:CentralCommissioningAction,input?:RecordValue,options?:CentralRequestOptions):Promise<T>;
  commissioningState(options?:CentralRequestOptions):Promise<CentralCommissioningState>;
  connect(input:CentralConnectionInput,options?:CentralRequestOptions):Promise<RecordValue>;
  projects(input:{connectionId:string},options?:CentralRequestOptions):Promise<unknown>;
  forms(input:{connectionId:string;projectId:number|string},options?:CentralRequestOptions):Promise<unknown>;
  createPlan(input:CentralPlanInput,options?:CentralRequestOptions):Promise<RecordValue>;
  capture(input:{planId:string;id?:string;label?:string},options?:CentralRequestOptions):Promise<CentralCaptureSummary>;
  captureStatus(id:string,options?:CentralRequestOptions):Promise<RecordValue>;
  resume(input:{id:string},options?:CentralRequestOptions):Promise<unknown>;
  pause(input:{id:string},options?:CentralRequestOptions):Promise<unknown>;
  wait(input:{id:string},options?:CentralRequestOptions):Promise<unknown>;
  edition(input:{id:string},options?:CentralRequestOptions):Promise<CentralCapture>;
  rows(input:{id:string;tableId:string;after?:string;limit?:number;search?:string},options?:CentralRequestOptions):Promise<CentralRowsPage>;
  row(input:{id:string;tableId:string;rowId:string},options?:CentralRequestOptions):Promise<RecordValue>;
  resources(input:{id:string;after?:number;limit?:number;kind?:string},options?:CentralRequestOptions):Promise<CentralResourcesPage>;
  quality(input:{id:string},options?:CentralRequestOptions):Promise<RecordValue>;
  review(input:CentralReviewInput,options?:CentralRequestOptions):Promise<CentralCapture>;
  compare(input:{leftId:string;rightId:string;tableId:string;after?:string;limit?:number},options?:CentralRequestOptions):Promise<RecordValue>;
  exportDataset(input:CentralDatasetInput,options?:CentralRequestOptions):Promise<CentralSavedFiles>;
  report(input:CentralReportInput,options?:CentralRequestOptions):Promise<CentralSavedFiles>;
  backup(input?:{id?:string},options?:CentralRequestOptions):Promise<CentralSavedFiles>;
  sourceFile(input:{hash:string},options?:CentralRequestOptions):Promise<CentralFileDescriptor>;
  exportFile(input:{id:string;path:string},options?:CentralRequestOptions):Promise<CentralFileDescriptor>;
  prepareRelease(input:{exportId:string;releaseId:string;label?:string;runtime?:CentralDatasetRuntime},options?:CentralRequestOptions):Promise<RecordValue>;
  releaseStatus(input?:RecordValue,options?:CentralRequestOptions):Promise<RecordValue>;
  activateRelease(input:{id:string;expectedGeneration:number;reason:string},options?:CentralRequestOptions):Promise<RecordValue>;
  rollbackRelease(input:{to:string;expectedGeneration:number;reason:string},options?:CentralRequestOptions):Promise<RecordValue>;
  capturePublisher(input:CentralPublisherCaptureInput,options?:CentralRequestOptions):Promise<CentralPublisherSnapshot>;
  receivePublisher(input:CentralPublisherReceiveInput,options?:CentralRequestOptions):Promise<CentralPublisherReceiving>;
  publisherTransfers(input?:RecordValue,options?:CentralRequestOptions):Promise<CentralPublisherTransfers>;
  commissioningRecordHost(input:{id:string;handover:CentralCommissioningHostHandover},options?:CentralRequestOptions):Promise<RecordValue>;
  commissioningInspect(input:{id:string;projectId?:number|string|null},options?:CentralRequestOptions):Promise<CentralCommissioningInspection>;
  commissioningSaveDraft(input:CentralCommissioningDraftInput,options?:CentralRequestOptions):Promise<CentralCommissioningDraft>;
  commissioningReadiness(agreement:CentralSourceAgreement|RecordValue,options?:CentralRequestOptions):Promise<CentralCommissioningReadiness>;
  commissioningPrepare(input:CentralCommissioningPrepareInput,options?:CentralRequestOptions):Promise<CentralCommissioningRecord>;
  commissioningInstall(input:{id:string},options?:CentralRequestOptions):Promise<CentralCommissioningRecord>;
  commissioningCapturePeriod(input:CentralCommissioningPeriodInput,options?:CentralRequestOptions):Promise<{
    capture:CentralCaptureSummary|CentralCapture;requestId:string;reused:boolean}>;
  commissioningResumeCapture(input:{id:string;captureId:string},options?:CentralRequestOptions):Promise<unknown>;
  commissioningDeliver(input:CentralCommissioningDeliveryInput,options?:CentralRequestOptions):Promise<CentralCommissioningDelivery>;
  /** Release this attachment; the original Application keeps its listener and writer. */
  close():void;
}
export function connectCentralWorkspace(options:{connectionFile:string;directory?:string;fetchImpl?:typeof fetch}):Promise<CentralWorkspaceClient>;
export interface CentralManagedOptions {
  directory:string;operator?:string;port?:number;restoreArchive?:string;restoreSha256?:string;
  fetchImpl?:typeof fetch;signal?:AbortSignal;
  commissioningConnection?:CentralCommissioningConnectionInput;
  commissioningConnectionFile?:string;commissioningEnvironmentFile?:string;
}
export interface ManagedCentralWorkspace extends CentralServer {
  workspace:CentralWorkspace;operator:string;connection:{path:string;sha256:string;bytes:number;value:CentralConnectionValue};
  instanceId:string;restored:RestoreCentralResult|null;commissioning:CentralCommissioning;
  commissioningUrl:string;close():Promise<void>;
}
export function centralManagedOptions(argv:string[]):CentralManagedOptions;
export function startManagedCentralWorkspace(options:CentralManagedOptions):Promise<ManagedCentralWorkspace>;
export function centralStartup(service:ManagedCentralWorkspace):RecordValue;
export function runManagedCentralCli(argv?:string[],options?:{stdout?:{write(value:string):unknown};waitForClose?:boolean}):Promise<unknown>;
export const ODK_MCP_CONNECTION_SCHEMA:'stellar-forge.odk-workspace-connection.v1';
export interface CentralHostSource extends CentralConnectionInput {id:string}
export interface CentralMerchantProfile {label?:string;origin:string;path:string;payment:RecordValue;defaultLimit?:number;maxLimit?:number}
export interface CentralHostWorkspace {
  label:string;directory:string;connectionFile:string;workspaceId:string|null;
  connections:Record<string,CentralHostSource>;merchants:Record<string,CentralMerchantProfile>;
  runtimes:Record<string,CentralDatasetRuntime>;
}
export interface CentralHostConfiguration {
  configuration:string;sha256:string;workspaces:Record<string,CentralHostWorkspace>;
}
export function readCentralWorkspaceConfiguration(path:string):Promise<CentralHostConfiguration>;
export class MerchantCentralWorkspaces {
  constructor(config:{exportsDirectory:string;odkWorkspaces?:CentralHostConfiguration;[key:string]:unknown});
  readonly summary:RecordValue;
  call(name:string,args?:RecordValue):Promise<unknown>;
  close():Promise<void>;
}
export function odkWorkspaceTools<T>(tool:(name:string,description:string,properties:RecordValue,required:string[],annotations:RecordValue)=>T):T[];
export function initializeCentralWorkspaceMerchant(options:{directory:string;connection:string;name?:string}):Promise<RecordValue>;
export const ODK_FILE_SCHEMA:'stellar-forge.odk-central-retained-file.v1';
export function centralDownloadPath(value:string):{path:string;sourceHash:string|null};
export interface CentralRetainedFileRequest {
  requestId:string;downloadPath:string;expectedSha256:string;expectedBytes:number;
}
export interface CentralRetainedFile extends RecordValue {
  schema:typeof ODK_FILE_SCHEMA;fileId:string;workspaceId:string;requestSha256:string;
  sha256:string;bytes:number;filename:string;mediaType:string;completedAt:string;
}
export type CentralFileScope=CentralHostWorkspace&{alias:string};
export class CentralRetainedFiles {
  constructor(directory:string);
  readonly summary:RecordValue;
  find(scope:CentralFileScope,args:CentralRetainedFileRequest):Promise<(CentralRetainedFile&{reused:true})|null>;
  retain(scope:CentralFileScope,connection:CentralConnection,args:CentralRetainedFileRequest):Promise<CentralRetainedFile>;
  list(scope:CentralFileScope,offset?:number,limit?:number):Promise<{files:CentralRetainedFile[];offset:number;limit:number;total:number;nextOffset:number|null}>;
  file(scope:CentralFileScope,args:{fileId:string;readId?:string;expectedSha256?:string;offset?:number;limit?:number}):Promise<unknown>;
  release(scope:CentralFileScope,readId:string):Promise<void>;
  disconnect(scope:CentralFileScope):Promise<void>;
  close():Promise<void>;
}

/** Original commissioning definitions; source and policy JSON remain unmodified. */
export type CentralPeriod = 0 | 1;
export interface CentralCommissioningHostReference {
  owner?:string;operationId?:string;profileId?:string;receiptPath?:string;receiptSha256?:string;
  sourceCommit?:string;release?:string;observedAt?:string;
}
export interface CentralCommissioningConnectionInput {
  id?:string;connectionId?:string;name?:string;url:string;authEnv:string;
  allowLoopback?:boolean;hostReference?:CentralCommissioningHostReference;
}
export interface CentralCommissioningConnection {
  connectionId?:string;name:string;url:string;authEnv:string;allowLoopback:boolean;
  hostReference?:CentralCommissioningHostReference;
}
export interface CentralCommissioningHostHandover extends RecordValue {
  schema:'stellar-forge.odk-central-host.v1.handover';operation_id:string;
  source:RecordValue&{commit:string};version:string;observed_at:string;
  connection:CentralConnectionInput;container_states:RecordValue[];
  url?:string;mode?:string;compose_project?:string;runtime?:RecordValue;
  backup_count?:number;restore?:RecordValue|null;receiving_operation?:string|RecordValue|null;
}
export type CentralAgreementForm = string | {
  project_id?:string|number;projectId?:string|number;
  form_id?:string;formId?:string;xmlFormId?:string;
};
export interface CentralAgreementTable {
  project_id?:string|number;projectId?:string|number;
  form_id?:string;formId?:string;xmlFormId?:string;table:string;
}
export interface CentralAgreementPeriod {
  label:string;submitted_from:string;submitted_before_exclusive:string;
  updated_since?:string|null;page_size?:number;
}
export interface CentralAgreementMeasure extends CentralAgreementTable {
  name:string;operation:CentralIndicator['operation'];field?:string;equals?:string|number|boolean|null;
}
export interface CentralAgreementOutput extends CentralAgreementTable {name?:string;fields:string[]}
export interface CentralCommissioningKickoff {
  status?:'proposed'|'agreed';start?:string|null;weekdays?:number[];excludedDates?:string[];
  agreementReference?:string|null;inputsReadyReference?:string|null;capacityReference?:string|null;
}
export interface CentralSourceAgreement extends RecordValue {
  schema?:'stellar-forge.central-source-agreement.v1';opportunity_id:string;name?:string;
  commercial_scope?:RecordValue&{max_existing_forms?:number;delivery_business_days?:number};
  customer_decisions:{
    accountable_project_owner:Json;technical_receiver:Json;authorized_central_origin:string;
    project_id:number|string|null;selected_forms:CentralAgreementForm[];reporting_timezone:string;
    periods:CentralAgreementPeriod[];late_edit_policy:Json;review_state_inclusion:Json;
    metric_definitions:CentralAgreementMeasure[];cross_form_identity_rules?:Json;
    approved_output_fields:CentralAgreementOutput[];media_retention_selection:Json;
    [key:string]:unknown;
  };
  processing:{reviewStates:'all';lateEdits:'current-state-at-capture';portableSource:'complete-selected-capture'};
  kickoff?:CentralCommissioningKickoff;
}
export interface CentralCommissioningReadiness {ready:boolean;issues:Array<{field:string;message:string}>}
export interface CentralCommissioningSchedule {
  status:'proposed'|'agreed';start:string|null;finish:string|null;workingDays:number;dates:string[];
  weekdays:number[];excludedDates:string[];agreementReference:string|null;
  inputsReadyReference:string|null;capacityReference:string|null;description:string;
}
export interface CentralCommissioningDraft extends RecordValue {
  id:string;revision:number;agreement:CentralSourceAgreement|RecordValue;
  agreementSha256:string;readiness:CentralCommissioningReadiness;savedAt:string;
}
export interface CentralCommissioningInspection extends RecordValue {
  id:string;revision:number;status:string;connectionId?:string;
  request:{connection:CentralCommissioningConnection;connectionId:string;projectId:string|null};
  actor?:{id:string|number;email?:string;displayName?:string;type?:string};
  project?:RecordValue|null;projects?:RecordValue[];forms?:RecordValue[];
  sourceIdentity?:string;sources?:Record<string,RecordValue>;error?:RecordValue|null;
}
export interface CentralCommissioningDefinition extends RecordValue {
  agreement:CentralSourceAgreement;agreementSha256:string;projectId:string;
  forms:Array<{projectId:string;formId:string}>;
  periods:Array<{index:CentralPeriod;label:string;scope:CentralScope}>;
  outputs:Array<{projectId:string;formId:string;table:string;fields:string[];name:string;index:number}>;
  indicators:Array<{projectId:string;formId:string;table:string;name:string;operation:CentralIndicator['operation'];
    field?:string;equals?:string|number|boolean|null}>;
  schedule:CentralCommissioningSchedule;connectionId:string;inspectionId:string;sourceIdentity:string;
  plans:Array<CentralPlanInput&{id:string}>;
}
export interface CentralCommissioningRecord extends RecordValue {
  schema:'stellar-forge.central-commissioning.v1';id:string;revision:number;status:string;
  request:Omit<CentralCommissioningPrepareInput,'id'>;definition:CentralCommissioningDefinition;
  sourceDefinition:{draftId:string;draftRevision:number;draftSha256:string;inspectionId:string;
    inspectionRevision:number;inspectionSourceIdentity:string};
  connection:CentralCommissioningConnection;createdAt:string;installedPlans:string[];error:RecordValue|null;
}
export interface CentralCommissioningCaptureSelection {period:CentralPeriod;captureId:string;reviewId:string}
export interface CentralCommissioningDataset extends CentralSavedFiles {
  period:CentralPeriod;captureId:string;tableId:string;name:string;
}
export interface CentralCommissioningReport extends CentralSavedFiles {
  period:CentralPeriod;captureId:string;baselineId:string|null;
}
export interface CentralCommissioningDocument extends RecordValue {
  name:string;type:string;sha256:string;bytes:number;
}
export interface CentralCommissioningDelivery extends RecordValue {
  schema:'stellar-forge.central-commissioning.v1';id:string;revision:number;status:string;
  selection:{commissionId:string;captures:CentralCommissioningCaptureSelection[]};
  request:{commissionId:string;commissionDefinitionSha256:string;
    captures:Array<CentralCommissioningCaptureSelection&{contentHash:string}>};
  archiveId:string;createdAt:string;datasets:CentralCommissioningDataset[];
  reports:CentralCommissioningReport[];documents:CentralCommissioningDocument[];
  archive?:CentralSavedFiles|null;receivedArchive?:CentralReceivedArchive|null;error:RecordValue|null;
}
export interface CentralCommissioningState extends RecordValue {
  schema:'stellar-forge.central-commissioning.v1';workspaceId:string;workspaceDirectory:string;
  revision:number;connection:CentralCommissioningConnection|null;receivedArchive:CentralReceivedArchive|null;
  drafts:CentralCommissioningDraft[];hostReceipts:RecordValue[];inspections:RecordValue[];
  commissions:Array<CentralCommissioningRecord&{plans:(RecordValue|null)[];
    captures:RecordValue[];deliveries:CentralCommissioningDelivery[]}>;
  storageReopenRequired:boolean;
}
export interface CentralCommissioningDraftInput {
  id:string;requestId:string;expectedRevision:number;agreement:CentralSourceAgreement|RecordValue;
}
export interface CentralCommissioningPrepareInput {
  id:string;draftId:string;draftRevision:number;inspectionId:string;existingPlanIds?:[string,string];
}
export interface CentralCommissioningPeriodInput {id:string;period:CentralPeriod;requestId:string;label?:string}
export interface CentralCommissioningDeliveryInput {
  id:string;requestId:string;captures:[CentralCommissioningCaptureSelection,CentralCommissioningCaptureSelection];
}
export interface CentralCommissioning {
  state():CentralCommissioningState;
  readiness(agreement:CentralSourceAgreement|RecordValue):CentralCommissioningReadiness;
  recordHost(input:{id:string;handover:CentralCommissioningHostHandover}):Promise<RecordValue>;
  inspect(input:{id:string;projectId?:number|string|null}):Promise<CentralCommissioningInspection>;
  saveDraft(input:CentralCommissioningDraftInput):Promise<CentralCommissioningDraft>;
  prepare(input:CentralCommissioningPrepareInput):Promise<CentralCommissioningRecord>;
  install(input:{id:string}):Promise<CentralCommissioningRecord>;
  capturePeriod(input:CentralCommissioningPeriodInput):Promise<{
    capture:CentralCaptureSummary|CentralCapture;requestId:string;reused:boolean}>;
  resumeCapture(input:{id:string;captureId:string}):Promise<unknown>;
  deliver(input:CentralCommissioningDeliveryInput):Promise<CentralCommissioningDelivery>;
  close():Promise<void>;
}
export const COMMISSIONING_SCHEMA:'stellar-forge.central-commissioning.v1';
export function agreementReadiness(agreement:CentralSourceAgreement|RecordValue):CentralCommissioningReadiness;
export function deliverySchedule(input?:CentralCommissioningKickoff,days?:number):CentralCommissioningSchedule;
export function createCentralCommissioning(options:{
  workspace:CentralWorkspace;store:CentralExtensionStore;
  connection?:CentralCommissioningConnectionInput;fetchImpl?:typeof fetch;
}):CentralCommissioning;
export interface CentralServerExtension {
  name:string;assets:ReadonlyMap<string,{url:URL;type:string}>;
  handle(context:{request:import('node:http').IncomingMessage;response:import('node:http').ServerResponse;
    address:URL;body(request:import('node:http').IncomingMessage):Promise<unknown>;
    json(response:import('node:http').ServerResponse,status:number,value:unknown):unknown}):Promise<boolean>;
}
export function createCommissioningExtension(options:{
  workspace:CentralWorkspace;commissioning:CentralCommissioning;
}):CentralServerExtension;
export interface OpenCentralCommissioning {
  workspace:CentralWorkspace;commissioning:CentralCommissioning;
  extension:CentralServerExtension;close():Promise<void>;
}
export function openCentralCommissioning(options:{
  directory:string;connection?:CentralCommissioningConnectionInput;fetchImpl?:typeof fetch;
}):Promise<OpenCentralCommissioning>;
export interface ServedCentralCommissioning {
  schema:'stellar-forge.central-commissioning-listener.v1';workspaceId:string;directory:string;
  origin:string;url:string;fieldWorkspaceUrl:string;token:string;
  workspace:CentralWorkspace;commissioning:CentralCommissioning;close():Promise<void>;
}
export function serveCentralCommissioning(options:{
  directory:string;connection?:CentralCommissioningConnectionInput;host?:string;port?:number;
  token?:string;fetchImpl?:typeof fetch;
}):Promise<ServedCentralCommissioning>;
export type CentralCommissioningAction='recordHost'|'inspect'|'saveDraft'|'readiness'|'prepare'|
  'install'|'capturePeriod'|'resumeCapture'|'deliver';
export type CentralActionNamespace='actions'|'commissioning';
export interface CentralPublisherCaptureInput {id:string;expectedGeneration?:number}
export interface CentralPublisherReceiveInput {id:string;snapshotId:string}
export interface CentralPublisherSourceFile {path:string;sha256:string;bytes:number}
export interface CentralPublisherSnapshot extends RecordValue {
  schema:'stellar-forge.central-publisher-snapshot.v1';id:string;revision:number;status:string;
  sourceWorkspaceId:string;createdAt:string;present?:boolean;
  selection?:(RecordValue&{pending?:CentralPublisherPending[];preparations?:RecordValue[]})|null;
  files:CentralPublisherSourceFile[];fileCount?:number;bytes?:number;manifestSha256?:string;
}
export interface CentralPublisherPending extends RecordValue {
  kind:string;path:string;status:'PENDING'|'INVALID';code:string;message:string;
  missingPaths?:string[];originalRelease?:RecordValue;
}
export interface CentralPublisherReceiving extends RecordValue {
  schema:'stellar-forge.central-publisher-receiving.v1';id:string;revision:number;status:string;
  request:RecordValue;datasets:RecordValue[];packages:RecordValue[];releases:RecordValue[];
  originalSelection:RecordValue|null;activation?:RecordValue&{unavailableActive?:boolean};
  pending?:CentralPublisherPending[];
  historicalSource?:{directory:string;files:CentralPublisherSourceFile[];manifestSha256:string};
  resumePreparations?:Array<{id:string;request:RecordValue;originalStatus:string;action:'prepareRelease'}>;
}
export interface CentralPublisherTransfers extends RecordValue {
  snapshots:CentralPublisherSnapshot[];receiving:CentralPublisherReceiving[];
}
export function centralOperationId(input:unknown):string|null;
export function centralActionRoute(namespace:CentralActionNamespace,method:CentralAction|CentralCommissioningAction):{path:string;readOnly:boolean};
export function requestCentralAction<T=unknown>(connection:CentralConnection,namespace:CentralActionNamespace,
  method:CentralAction|CentralCommissioningAction,input?:unknown,options?:CentralRequestOptions):Promise<T>;
export function inspectCentralCommissioning(connection:CentralConnection,options?:CentralRequestOptions):Promise<CentralCommissioningState>;
