/// <reference types="node" />
import type {EditionInput,PeriodInput,PeriodSourceInput,WorkInput,AssignmentInput,ReviewInput,MutationResult as RunbookMutationResult,CallOptions,CycleHeader,BookHeader,RetainedFile,FileMetadata,FileChunk} from './accounting-runbooks-client.mjs';
export type {CallOptions} from './accounting-runbooks-client.mjs';
export type PortfolioAction='configure'|'commission'|'schedule'|'command'|'capture'|'receive'|'adopt';
export type ChildAction='save'|'create'|'assign'|'work'|'submit'|'review';
export interface Envelope {workspaceId:string;revision:number}
export interface Observation {workspaceId?:string;expectedRevision?:number}
export interface PageOptions extends Observation {offset?:number;limit?:number}
export interface Page<T> {view:string;items:T[];offset:number;limit:number;total:number;nextOffset:number|null}
export interface PageResult<T> extends Envelope {page:Page<T>}
export interface CompletePage<T> extends Envelope {view:string;items:T[];total:number;observationSha256?:string;source?:ClientSourceHeader}
export interface FileReference {source:string;name:string;bytes?:number;sha256?:string}
export interface PinnedFileReference extends FileReference {bytes:number;sha256:string}
export interface Person {
  id:string;name:string;minutesPerDay:number;workingDays?:number[];holidays?:string[];
  timeOff?:{from:string;to:string;note?:string}[];
}
export interface FirmInput {name:string;closeStandard?:string;reportingStandard?:string;reportingCadence?:string;escalationNote?:string}
export interface FirmEdition extends Required<FirmInput> {id:string;actor:string;createdAt:string;staff:Required<Person>[]}
export type FirmHeader=Omit<FirmEdition,'staff'>&{staffCount:number};
export interface ConfigureInput {actor:string;expectedFirmEditionId?:string|null;firm:FirmInput;staff:Person[]}
export interface CommissionInput {
  actor:string;alias:string;clientWorkspaceId:string;clientRevision:number;runbookId:string;editionId:string;
  clientId?:string;expectedCommissionId?:string;preparerId:string;backupId:string;reviewerId:string;
  status:'DISCOVERY'|'READY'|'ACTIVE';name:string;scope?:string;sourceGaps?:string;
  reportingInstructions?:string;escalationInstructions?:string;readinessNote?:string;
  sourcePacketId?:string;sourceClientId?:string;
}
export interface Commission {
  id:string;createdAt:string;actor:string;firmEditionId:string;alias:string;
  clientWorkspaceId:string;clientRevision:number;runbookId:string;editionId:string;editionSha256:string;
  name:string;preparerId:string;backupId:string;reviewerId:string;status:'DISCOVERY'|'READY'|'ACTIVE';
  scope:string;sourceGaps:string;reportingInstructions:string;escalationInstructions:string;readinessNote:string;
  receivedFrom?:{packetId:string;packetSha256:string;clientId:string};
}
export interface ClientRecord {id:string;createdAt:string;latestCommissionId:string;commissions:Commission[]}
export type ClientHeader=Omit<ClientRecord,'commissions'>&{commissionCount:number;commission:Commission};
export interface PlanRowInput {
  id:string;clientId:string;commissionId:string;label:string;preparerId?:string;backupId?:string;reviewerId?:string;
  closeDate:string;reviewDate?:string;preparationMinutes:number;reviewMinutes:number;backupMinutes?:number;
  cycleId?:string|null;previousCycleId?:string|null;source?:PeriodSourceInput;
}
export interface CalendarInput {label:string;startDate:string;endDate:string;previousPlanId?:string|null;rows:PlanRowInput[]}
export interface ScheduleInput extends CalendarInput {actor:string;expectedPreviewSha256:string;capacityExceptions?:{id:string;note:string}[]}
export interface Allocation {rowId:string;clientId:string;role:'preparation'|'review'|'backup';staffId:string;date:string;minutes:number}
export interface CapacityDay {
  staffId:string;date:string;capacityMinutes:number;bookedMinutes:number;plannedMinutes:number;
  preparationMinutes:number;reviewMinutes:number;backupMinutes:number;totalMinutes:number;availableMinutes:number;overloadMinutes:number;
}
export type CapacityConflict=
  {id:string;kind:'UNALLOCATED';rowId:string;clientId:string;role:string;staffId:string;from:string;to:string;requestedMinutes:number;unallocatedMinutes:number}|
  {id:string;kind:'EXISTING_OVERLOAD';staffId:string;date:string;overloadMinutes:number};
export interface CalendarTotals {requestedMinutes:number;allocatedMinutes:number;unallocatedMinutes:number;existingOverloadMinutes:number}
export interface Calendar {
  schema:'stellar-forge.accounting-portfolio-calendar.v1';method:'deadline-first-backward-allocation';startDate:string;endDate:string;
  rows:Record<string,unknown>[];staff:Required<Person>[];allocations:Allocation[];days:CapacityDay[];conflicts:CapacityConflict[];totals:CalendarTotals;
}
export interface CalendarPreview {
  label:string;firmEditionId:string;firm:FirmEdition;startDate:string;endDate:string;previousPlanId:string|null;
  seriesId:string|null;bookedPlanIds:string[];rows:Record<string,unknown>[];calendar:Calendar;previewSha256:string;
}
export interface Plan extends CalendarPreview {id:string;seriesId:string;createdAt:string;actor:string;capacityExceptions:{id:string;note:string}[]}
export type PlanHeader=Omit<Plan,'firm'|'rows'|'calendar'|'capacityExceptions'>&{
  firm:FirmHeader;rowCount:number;capacityExceptionCount:number;superseded?:boolean;
  calendar:Pick<Calendar,'schema'|'method'|'startDate'|'endDate'|'totals'>&{staffCount:number;allocationCount:number;dayCount:number;conflictCount:number};
};
type WithoutActor<T>=Omit<T,'actor'>;
export interface ChildParameters {
  save:WithoutActor<EditionInput>;
  create:WithoutActor<PeriodInput>&PeriodSourceInput;
  assign:WithoutActor<AssignmentInput>&{cycleId:string};
  work:WithoutActor<WorkInput>&{cycleId:string};
  submit:{cycleId:string;note?:string};
  review:WithoutActor<ReviewInput>&{cycleId:string};
}
export interface CommandInput<A extends ChildAction=ChildAction> {
  actor:string;clientId:string;action:A;nativeRequestId:string;clientWorkspaceId:string;clientRevision:number;
  parameters:ChildParameters[A];planId?:string;rowId?:string;replacesCommandId?:string;
}
export interface ChildKinds {save:'edition_saved';create:'cycle_created';assign:'assignment_changed';work:'procedure_saved';submit:'preparation_submitted';review:'review_saved'}
export interface ChildCommand<A extends ChildAction=ChildAction> {
  id:string;originWorkspaceId:string;createdAt:string;actor:string;clientId:string;commissionId:string;alias:string;clientWorkspaceId:string;
  action:A;kind:ChildKinds[A];target:string|null;
  nativeRequest:Record<string,unknown>&{workspaceId:string;revision:number;requestId:string;actor:string};
  nativeRequestSha256:string;planId:string|null;planSeriesId:string|null;rowId:string|null;replacesCommandId:string|null;commandSha256:string;
}
export type CommandHeader=Omit<ChildCommand,'nativeRequest'>&{nativeRequestId:string;clientRevision:number;replacedByCommandId:string|null;current:boolean};
export interface CaptureInput {
  actor:string;label:string;clients:{clientId:string;clientWorkspaceId:string;clientRevision:number;cycleIds:string[]}[];
}
export interface AdoptInput {
  actor:string;receivedId:string;expectedPacketSha256:string;adoptFirm?:boolean;expectedFirmEditionId?:string|null;
  bindings:{sourceClientId:string;clientId:string;alias:string;clientWorkspaceId:string;clientRevision:number;preparerId?:string;backupId?:string;reviewerId?:string}[];
}
export interface NativeInputs {
  configure:ConfigureInput;commission:CommissionInput;schedule:ScheduleInput;command:CommandInput;capture:CaptureInput;
  receive:{actor:string};adopt:AdoptInput;
}
export interface NativeKinds {
  configure:'portfolio_configured';commission:'portfolio_commissioned';schedule:'portfolio_scheduled';command:'portfolio_command_prepared';
  capture:'portfolio_captured';receive:'portfolio_received';adopt:'portfolio_adopted';
}
export interface PreparedRequest<A extends PortfolioAction=PortfolioAction> {
  schema:'stellar-forge.accounting-portfolio-host-request.v1';action:A;kind:NativeKinds[A];target:null;
  input:NativeInputs[A]&{workspaceId:string;revision:number;requestId:string};
  file?:PinnedFileReference;requestSha256:string;wireSha256:string;
}
export interface PrepareSelection extends Observation {requestId?:string;file?:FileReference}
export interface CaptureRecord {
  id:string;label:string;createdAt:string;actor:string;sha256:string;bytes:number;packetSha256:string;originWorkspaceId:string;
  asOfWorkspaceRevision:number;clients:{clientId:string;cycleIds:string[]}[];periodCount:number;expandedBytes:number;
}
export interface ReceivedRecord {
  id:string;label:string;receivedAt:string;actor:string;originWorkspaceId:string;asOfWorkspaceRevision:number;
  sha256:string;bytes:number;packetSha256:string;metadataSha256:string;clients:number;periodCount:number;
}
export interface MutationResult extends Envelope {
  requestId:string;firmEditionId?:string;clientId?:string;commissionId?:string;planId?:string;seriesId?:string;
  previewSha256?:string;commandId?:string;commandSha256?:string;nativeRequestId?:string;clientWorkspaceId?:string;
  captureId?:string;capture?:CaptureRecord;receivedId?:string;received?:ReceivedRecord;reused?:boolean;
  clients?:{clientId:string;sourceClientId:string;commissionId:string}[];duplicate?:boolean;currentRevision?:number;
}
export interface NativeOperation {id:string;kind:NativeKinds[PortfolioAction];target:null;requestSha256:string;createdAt:string;result:MutationResult}
export type Reconciliation=
  (Envelope&{status:'NOT_FOUND';requestId:string;requestSha256:string})|
  (Envelope&{status:'COMMITTED';requestId:string;requestSha256:string;operation:NativeOperation;result:MutationResult});
export type CommandResult=(Envelope&{commandId:string;commandSha256:string;clientWorkspaceId:string})&
  ({found:false}|{found:true;native:RunbookMutationResult});
export interface ExecutedCommand extends Envelope {
  commandId:string;commandSha256:string;clientAlias:string;clientWorkspaceId:string;native:RunbookMutationResult;recovered:boolean;
}
export interface ClientSourceHeader {
  alias:string;clientWorkspaceId:string;clientRevision:number;counts:{runbooks:number;cycles:number;files:number;handoffs:number;closes:number};
}
export interface ClientSourceObservation extends PageOptions {clientWorkspaceId?:string;expectedClientRevision?:number;observationSha256?:string}
export type SourceView='summary'|'runbooks'|'cycles'|'files'|'handoffs'|'revisions'|'closes';
export type StatusView='summary'|'firm_editions'|'staff'|'clients'|'plans'|'commands'|'captures'|'received';
export type PlanView='summary'|'rows'|'staff'|'allocations'|'days'|'conflicts'|'capacity_exceptions';
export type ReceivedView='summary'|'firm_editions'|'clients'|'plans'|'commands'|'packets';
export interface LiveClient {
  clientId:string;alias:string;name:string;available:boolean;clientWorkspaceId?:string;clientRevision?:number;
  commissionId?:string;commissionedEditionId?:string;latestEditionId?:string;cycleCount?:number;error?:{code:string;message:string};
}
export type PortfolioFileSelection=
  {kind:'portfolio';captureId:string;file:'packet'}|
  {kind:'portfolio';receivedId:string;file:'packet'}|
  {kind:'portfolio';receivedId:string;clientId:string;cycleId:string;file:'packet'}|
  {kind:'portfolio';planId:string;file:'calendar.csv'|'print'};
export type Reply=Envelope&Record<string,unknown>;
export interface AccountingPortfolioClient {
  readonly workspace:string;readonly endpoint?:string;
  open(options?:CallOptions):Promise<Record<string,unknown>>;
  configuredSources(options?:CallOptions):Promise<Record<string,unknown>>;
  status(args?:PageOptions&{view?:StatusView;firmEditionId?:string},options?:CallOptions):Promise<Reply>;
  source(alias:string,args?:ClientSourceObservation&{view?:SourceView;handoffId?:string},options?:CallOptions):Promise<Reply&{source:ClientSourceHeader;observationSha256:string}>;
  live(args?:PageOptions&{view?:'clients'|'cycles';clientId?:string;observationSha256?:string},options?:CallOptions):Promise<Reply&{observationSha256:string}>;
  client(clientId:string,args?:PageOptions&{view?:'summary'|'commissions'},options?:CallOptions):Promise<Reply&{client:ClientHeader}>;
  plan(planId:string,args?:PageOptions&{view?:PlanView},options?:CallOptions):Promise<Reply&{plan:PlanHeader}>;
  command(commandId:string,args?:Observation,options?:CallOptions):Promise<Envelope&{command:ChildCommand}>;
  result(command:string|ChildCommand,options?:CallOptions):Promise<CommandResult>;
  executeCommand(command:ChildCommand,options?:CallOptions):Promise<ExecutedCommand>;
  received(receivedId:string,args?:PageOptions&{view?:ReceivedView},options?:CallOptions):Promise<Reply&{received:ReceivedRecord}>;
  operation(requestId:string,options?:CallOptions):Promise<Envelope&{operation:NativeOperation}>;
  preview(input:CalendarInput,selection?:Observation,options?:CallOptions):Promise<Envelope&{preview:CalendarPreview}>;
  allStatus<T=unknown>(view:Exclude<StatusView,'summary'>,args?:{firmEditionId?:string},options?:CallOptions):Promise<CompletePage<T>>;
  allSource<T=unknown>(alias:string,view:Exclude<SourceView,'summary'>,args?:{handoffId?:string},options?:CallOptions):Promise<CompletePage<T>&{source:ClientSourceHeader;observationSha256:string}>;
  allLive<T=LiveClient>(view?:'clients'|'cycles',args?:{clientId?:string},options?:CallOptions):Promise<CompletePage<T>>;
  allClient<T=Commission>(clientId:string,view?:'commissions',args?:Observation,options?:CallOptions):Promise<CompletePage<T>>;
  allPlan<T=unknown>(planId:string,view:Exclude<PlanView,'summary'>,args?:Observation,options?:CallOptions):Promise<CompletePage<T>>;
  allReceived<T=unknown>(receivedId:string,view:Exclude<ReceivedView,'summary'>,args?:Observation,options?:CallOptions):Promise<CompletePage<T>>;
  prepare<A extends PortfolioAction>(action:A,input:NativeInputs[A],selection?:PrepareSelection,options?:CallOptions):Promise<PreparedRequest<A>>;
  execute(prepared:PreparedRequest,options?:CallOptions):Promise<MutationResult>;
  reconcile(prepared:PreparedRequest,options?:CallOptions):Promise<Reconciliation>;
  registerFileRead(readId:string):unknown;
  releaseFile(readId:string,options?:CallOptions):Promise<unknown>;
  drainFileReads():Promise<unknown>;
  fileChunks(selection:PortfolioFileSelection,options?:{chunkBytes?:number;signal?:AbortSignal}):AsyncIterable<FileChunk>;
  fileInfo(selection:PortfolioFileSelection,options?:{signal?:AbortSignal}):Promise<FileMetadata>;
  download(selection:PortfolioFileSelection,options:{expectedSha256:string;output:string;chunkBytes?:number;signal?:AbortSignal}):Promise<Record<string,unknown>>;
  disconnect():Promise<unknown>;
  closeWorkspace(options?:CallOptions):Promise<unknown>;
}
export function accountingPortfolioRequest<A extends PortfolioAction>(value:PreparedRequest<A>):PreparedRequest<A>;
export function accountingPortfolioCommand<A extends ChildAction>(value:ChildCommand<A>):ChildCommand<A>;
export function createAccountingPortfolioClient(options:{workspace:string;call:(name:string,args:Record<string,unknown>,options?:CallOptions)=>Promise<unknown>}):AccountingPortfolioClient;
export function connectAccountingPortfolioClient(options:{
  workspace:string;url:string;tokenEnv?:string;environment?:NodeJS.ProcessEnv;timeoutMs?:number;fetchImpl?:typeof fetch;
  maxResponseBytes?:number;
}):Promise<AccountingPortfolioClient>;
