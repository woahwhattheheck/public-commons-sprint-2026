/// <reference types="node" />
export type RunbookAction='save'|'attach'|'create'|'work'|'assign'|'submit'|'review'|'receive';
export type WorkStatus='PENDING'|'COMPLETE'|'NOT_APPLICABLE'|'BLOCKED';
export type CyclePhase='DRAFT'|'IN_REVIEW'|'CHANGES_REQUESTED'|'APPROVED';
export interface CallOptions { requestSignal?:AbortSignal; timeoutMs?:number }
export interface Observation { workspaceId?:string; expectedRevision?:number }
export interface PageOptions extends Observation { offset?:number; limit?:number }
export interface Envelope { workspaceId:string; revision:number }
export interface Page<T> { view:string; items:T[]; offset:number; limit:number; total:number; nextOffset:number|null }
export interface PageResult<T> extends Envelope { page:Page<T> }
export interface CompletePage<T> extends Envelope { view:string; items:T[]; total:number }
export interface FileReference { source:string; name:string; bytes?:number; sha256?:string }
export interface PinnedFileReference extends FileReference { bytes:number; sha256:string }
export interface RetainedFile { id:string; name:string; type:string; bytes:number; sha256:string; actor:string; createdAt:string }
export type Resource=
  {id:string;title:string;kind:'link';url:string}|
  {id:string;title:string;kind:'note';text:string}|
  {id:string;title:string;kind:'file';fileId:string};
export interface Procedure { id:string; title:string; instructions:string; required:boolean; resourceIds:string[] }
/** A named subset of procedures, saved in an immutable edition. Procedure order follows the edition. */
export interface ProcedureProfile { id:string; name:string; description:string; stepIds:string[] }
export interface ProcedureProfileInput { id:string; name:string; description?:string; stepIds:string[] }
export interface EditionInput {
  actor:string; runbookId?:string; expectedEditionId?:string|null;
  name:string; client:string; description?:string; resources?:Resource[]; steps:Procedure[]; profiles?:ProcedureProfileInput[];
}
export interface PeriodInput {
  actor:string;runbookId:string;editionId:string;label:string;preparer:string;reviewer:string;dueDate:string;
  previousCycleId?:string|null;
  /** Omit for all procedures; otherwise select a profile in editionId. Fixed for this period. */
  profileId?:string;
}
export type PeriodSourceInput=
  {sourceKind:'files';sourceLabel:string;sourceNote?:string;sourceFileIds:string[]}|
  {sourceKind?:'accountant';handoffId:string;accountantRevisionId:'initial'|string;periodCloseId?:string|null};
export interface WorkInput { actor:string;stepId:string;status:WorkStatus;note?:string;fileIds?:string[] }
export interface AssignmentInput { actor:string;expectedAssignmentSha256:string;note:string;preparer?:string;reviewer?:string;dueDate?:string }
export interface Assignments { preparer:string;reviewer:string;dueDate:string }
export interface Assignment extends Assignments {
  cycleId:string;runbookId:string;editionId:string;profileId?:string;phase:CyclePhase;workSha256:string;handoverId:string|null;sha256:string;
}
export interface HandoverHeader {
  id:string;at:string;actor:string;from:Assignments;to:Assignments;note:string;phase:CyclePhase;
  workSha256:string;previousHandoverId:string|null;beforeSha256:string;afterSha256:string;workCount:number;
}
export interface ReviewInput { actor:string;decision:'APPROVE'|'RETURN';note?:string;acceptedExceptions?:string[] }
export interface NativeInputs {
  save:EditionInput;
  attach:{actor:string;name?:string;type?:string};
  create:PeriodInput&PeriodSourceInput;
  work:WorkInput;
  assign:AssignmentInput;
  submit:{actor:string;note?:string};
  review:ReviewInput;
  receive:{actor:string};
}
export interface NativeKinds {
  save:'edition_saved';attach:'file_retained';create:'cycle_created';work:'procedure_saved';assign:'assignment_changed';
  submit:'preparation_submitted';review:'review_saved';receive:'packet_received';
}
export interface BoundInput { workspaceId:string;requestId:string;revision:number }
export interface PreparedRequest<A extends RunbookAction=RunbookAction> {
  schema:'stellar-forge.accounting-runbook-host-request.v1';
  action:A;kind:NativeKinds[A];target:A extends 'work'|'assign'|'submit'|'review'?string:null;
  input:NativeInputs[A]&BoundInput;file?:PinnedFileReference;requestSha256:string;wireSha256:string;
}
export interface PrepareSelection extends Observation { cycleId?:string;requestId?:string;file?:FileReference }
export interface MutationResult extends Envelope {
  requestId:string;runbookId?:string;editionId?:string;cycleId?:string;file?:RetainedFile;handoverId?:string;assignment?:Assignment;
  received?:ReceivedPacket;reused?:boolean;duplicate?:boolean;currentRevision?:number;
}
export interface NativeOperation {
  id:string;kind:NativeKinds[RunbookAction];target:string|null;requestSha256:string;createdAt:string;result:MutationResult;
}
export type Reconciliation=
  (Envelope&{status:'NOT_FOUND';requestId:string;requestSha256:string})|
  (Envelope&{status:'COMMITTED';requestId:string;requestSha256:string;operation:NativeOperation;result:MutationResult});
export interface ReceivedPacket {
  id:string;sha256:string;bytes:number;packetSha256:string;runbookId:string;cycleId:string;
  originWorkspaceId:string;actor:string;receivedAt:string;
}
export interface BookHeader {
  id:string;name:string;client:string;latestEditionId:string;editionCount:number;createdAt:string;updatedAt:string;
}
export interface EditionHeader {
  id:string;number:number;name:string;client:string;description:string;actor:string;createdAt:string;
  originWorkspaceId:string;stepCount:number;resourceCount:number;profileCount?:number;
}
export interface SourceHeader {
  kind:'accountant'|'files';originWorkspaceId:string;fileCount:number;
  label?:string;note?:string;sha256?:string;handoffId?:string;handoffName?:string;
  accountantRevisionId?:string;accountantRevisionName?:string;runId?:string|null;periodCloseId?:string|null;
  source?:Record<string,unknown>;summary?:Record<string,unknown>;
}
export interface CycleHeader {
  id:string;runbookId:string;editionId:string;profileId?:string;profileName?:string;label:string;phase:CyclePhase;preparer:string;reviewer:string;
  dueDate:string;previousCycleId:string|null;readOnly:boolean;originWorkspaceId:string;createdAt:string;updatedAt:string;
  source:SourceHeader;progress:{total:number;pending:number;complete:number;blocked:number;notApplicable:number};
  submissionCount:number;reviewCount:number;historyCount:number;assignmentSha256:string;handoverCount:number;
}
export interface WorkRecord { status:WorkStatus;note:string;fileIds:string[];actor:string;updatedAt:string|null }
export interface SubmissionHeader { id:string;at:string;actor:string;note:string;workSha256:string;workCount:number }
export interface ReviewRecord {
  id:string;at:string;actor:string;decision:'APPROVE'|'RETURN';note:string;acceptedExceptions:string[];
  submissionId:string;workSha256:string;
}
export interface HandoffHeader { id:string;name:string;runId:string|null;sourceKind:'merchant-settlement'|'buyer-expense-period';buyerWorkspaceId:string|null;createdAt:string;closeId:string|null;revisionCount:number }
export interface HandoffRevision { id:string;label:string;createdAt?:string }
export interface CloseHeader { id:string;label:string;runId:string }
export interface SourceFile { name:string;bytes:number;sha256:string;type?:string;id?:string }
export interface StatusViews { books:BookHeader;cycles:CycleHeader;files:RetainedFile;received:ReceivedPacket }
export interface SourceViews { handoffs:HandoffHeader;revisions:HandoffRevision;closes:CloseHeader;files:RetainedFile }
export interface BookViews { editions:EditionHeader;steps:Procedure;profiles:ProcedureProfile;resources:Resource }
export interface CycleViews {
  steps:Procedure&{work:WorkRecord};resources:Resource;source_files:SourceFile;
  submissions:SubmissionHeader;submission_work:{stepId:string;title:string;work:WorkRecord};
  reviews:ReviewRecord;history:{at:string;actor:string;action:string;[key:string]:unknown};
  handovers:HandoverHeader;handover_work:{stepId:string;title:string;work:WorkRecord};
}
export interface StatusSummary extends Envelope {
  counts:{books:number;cycles:number;files:number;received:number;operations:number};
  supportedSources:['accountant','files'];phases:CyclePhase[];fileBytes:number;packetBytes:number;
}
export interface BookResult extends Envelope { runbook:BookHeader;edition:EditionHeader;page?:Page<BookViews[keyof BookViews]> }
export interface CycleResult extends Envelope {
  cycle:CycleHeader;edition:EditionHeader;assignment:Assignment;initialAssignments?:Assignments;page?:Page<CycleViews[keyof CycleViews]>;
  submission?:Omit<SubmissionHeader,'workCount'>;handover?:HandoverHeader;
}
export type FileSelection=
  {kind:'runbooks';cycleId:string;file:'packet'|'print'|'tasks.csv'}|
  {kind:'runbooks';fileId:string;file?:'original'};
export interface FileMetadata { name:string;contentType:string;bytes:number;sha256:string }
export interface FileChunk {
  readId:string;file:FileMetadata;offset:number;nextOffset:number|null;bytesRead:number;encoding:'base64';
  data:string;bytes:Buffer;complete:boolean;
}
export interface FileReadOptions { expectedSha256?:string;chunkBytes?:number;signal?:AbortSignal }
export interface DownloadOptions extends FileReadOptions { expectedSha256:string;output:string }
export interface DownloadResult { output:string;workspace:string;selection:FileSelection;file:FileMetadata;complete:true }
export interface AccountingRunbooksClient {
  readonly workspace:string;readonly endpoint?:string;
  open(options?:CallOptions):Promise<Record<string,unknown>>;
  configuredSources(options?:CallOptions):Promise<Record<string,unknown>>;
  status(args?:Observation&{view?:'summary'},options?:CallOptions):Promise<StatusSummary>;
  status<V extends keyof StatusViews>(args:PageOptions&{view:V},options?:CallOptions):Promise<PageResult<StatusViews[V]>>;
  sources<V extends keyof SourceViews='handoffs'>(args?:PageOptions&{view?:V;handoffId?:string},options?:CallOptions):Promise<PageResult<SourceViews[V]>>;
  book(runbookId:string,args?:PageOptions&{editionId?:string;view?:'summary'|keyof BookViews},options?:CallOptions):Promise<BookResult>;
  cycle(cycleId:string,args?:PageOptions&{submissionId?:string;handoverId?:string;view?:'summary'|'assignment'|keyof CycleViews},options?:CallOptions):Promise<CycleResult>;
  operation(requestId:string,options?:CallOptions):Promise<Envelope&{operation:NativeOperation}>;
  allStatus<V extends keyof StatusViews>(view:V,options?:CallOptions):Promise<CompletePage<StatusViews[V]>>;
  allSources<V extends keyof SourceViews>(view:V,args?:Observation&{handoffId?:string},options?:CallOptions):Promise<CompletePage<SourceViews[V]>>;
  allBook<V extends keyof BookViews>(runbookId:string,view:V,args?:Observation&{editionId?:string},options?:CallOptions):Promise<CompletePage<BookViews[V]>>;
  allCycle<V extends keyof CycleViews>(cycleId:string,view:V,args?:Observation&{submissionId?:string;handoverId?:string},options?:CallOptions):Promise<CompletePage<CycleViews[V]>>;
  prepare<A extends RunbookAction>(action:A,input:NativeInputs[A],selection?:PrepareSelection,options?:CallOptions):Promise<PreparedRequest<A>>;
  execute(prepared:PreparedRequest,options?:CallOptions):Promise<MutationResult>;
  reconcile(prepared:PreparedRequest,options?:CallOptions):Promise<Reconciliation>;
  registerFileRead(readId:string):{workspace:string;readId:string};
  releaseFile(readId:string,options?:CallOptions):Promise<Record<string,unknown>>;
  drainFileReads():Promise<unknown>;
  fileChunks(selection:FileSelection,options?:FileReadOptions):AsyncGenerator<FileChunk,void,unknown>;
  fileInfo(selection:FileSelection,options?:{signal?:AbortSignal}):Promise<FileMetadata>;
  download(selection:FileSelection,options:DownloadOptions):Promise<DownloadResult>;
  disconnect():Promise<unknown>;
  closeWorkspace(options?:CallOptions):Promise<unknown>;
}
export function accountingRunbookRequest<A extends RunbookAction>(value:PreparedRequest<A>):PreparedRequest<A>;
export function createAccountingRunbooksClient(options:{
  workspace:string;call:(name:string,args:Record<string,unknown>,options?:CallOptions)=>Promise<Record<string,unknown>>;
}):Readonly<AccountingRunbooksClient>;
export function connectAccountingRunbooksClient(options:{
  workspace:string;url:string;tokenEnv?:string;environment?:NodeJS.ProcessEnv;signal?:AbortSignal;
  /** Full JSON-RPC response limit; 1024 bytes–128MiB, default128MiB. */
  maxResponseBytes?:number;
}):Promise<Readonly<AccountingRunbooksClient>>;
