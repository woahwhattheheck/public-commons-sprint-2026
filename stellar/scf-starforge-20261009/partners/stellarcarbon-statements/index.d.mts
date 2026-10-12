/** Original native quantities, IDs and TOIDs are strings; never convert them to Number. */
export type DecimalString = string;
export type NativeId = string;
export type CivilDate = string;
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type TableName = 'distribution_txs'|'minted_blocks'|'retirement_from_block'|'retirements'|'sink_status'|'sinking_txs'|'vcs_projects';
export interface DistributionTx {hash:string;created_at:string;sender:string;recipient:string;carbon_amount:DecimalString;toid:NativeId}
export interface MintedBlock {
 serial_hash:string;transaction_hash:string;created_at:string;vcs_project_id:NativeId;serial_number:string;
 block_start:NativeId;block_end:NativeId;sub_account_id:NativeId;sub_account_name:string;
 vintage_start:CivilDate;vintage_end:CivilDate;toid:NativeId;
}
export interface RetirementFromBlock {retirement_id:NativeId;block_hash:string;vcu_amount:NativeId}
export interface Retirement {
 certificate_id:NativeId;vcu_amount:NativeId;serial_number:string;retirement_date:CivilDate;
 retirement_beneficiary:string;retirement_details:string;vcs_project_id:NativeId;issuance_date:CivilDate;
 instrument_type:string;vintage_start:CivilDate;vintage_end:CivilDate;total_vintage_quantity:NativeId;
 registry_url?:string;
}
export interface SinkStatus {sinking_tx_hash:string;certificate_id:NativeId;amount_filled:DecimalString;finalized:boolean}
export interface SinkingTx {
 hash:string;created_at:string;contract_id:string|null;funder:string;recipient:string;carbon_amount:DecimalString;
 source_asset_code:string;source_asset_issuer:string|null;source_asset_amount:DecimalString;
 dest_asset_code:string;dest_asset_issuer:string|null;dest_asset_amount:DecimalString;vcs_project_id:NativeId;
 memo_type:string;memo_value:string|null;toid:NativeId;contract_id_reported?:boolean;
}
export interface VcsProject {id:NativeId;name:string;category:string;protocol:string;additional_certifications:string|null;region:string;country:string}
export interface NativeTables {
 distribution_txs:DistributionTx[];minted_blocks:MintedBlock[];retirement_from_block:RetirementFromBlock[];
 retirements:Retirement[];sink_status:SinkStatus[];sinking_txs:SinkingTx[];vcs_projects:VcsProject[];
}
export type NativeRow<K extends TableName=TableName> = NativeTables[K][number];
export type NativeFiles = Record<TableName,string>;
export interface SourceResponse {url:string;retrievedAt:string;status:number;content:string}
export interface SourceEdition {
 schema:'stellar-forge.stellarcarbon-source-edition.v1';format:'native-backup'|'api-capture';
 metadata:Record<string,Json>;files:Partial<NativeFiles>;responses:SourceResponse[];tables:NativeTables;
 id?:string;label?:string;importedAt?:string;sha256?:string;
}
export interface SavedSourceEdition extends SourceEdition {id:string;label:string;importedAt:string;sha256:string}
export interface SourceSummary {
 counts:Record<TableName,number>;carbon:DecimalString;allocated:DecimalString;remaining:DecimalString;
 completeContributions:number;firstContribution:CivilDate|null;lastContribution:CivilDate|null;
}
export interface Period {fromDate:CivilDate;beforeDate:CivilDate}
export interface VersionedRecord {id:string;version:number;createdAt:string;updatedAt:string}
export interface CustomerValue {id?:string;expectedVersion?:number;name:string;reference?:string;note?:string;merchantCustomerId?:string|null}
export interface Customer extends VersionedRecord {name:string;reference:string;note:string;merchantCustomerId:string|null}
export interface ProjectValue {id?:string;expectedVersion?:number;customerId:string;name:string;reference?:string;note?:string}
export interface CustomerProject extends VersionedRecord {customerId:string;name:string;reference:string;note:string}
export type AssignmentKind = 'TRANSACTION'|'RECIPIENT'|'FUNDER';
export interface AssignmentValue {
 id?:string;expectedVersion?:number;kind:AssignmentKind;value:string;customerId:string;projectId?:string|null;
 fromDate?:CivilDate|null;beforeDate?:CivilDate|null;active?:boolean;note?:string;
}
export interface Assignment extends VersionedRecord {
 kind:AssignmentKind;value:string;customerId:string;projectId:string|null;fromDate:CivilDate|null;beforeDate:CivilDate|null;active:boolean;note:string;
}
export interface AssignedTo {status:'ASSIGNED'|'UNASSIGNED'|'CONFLICT';customerId:string|null;projectId:string|null;assignmentIds:string[]}
export interface Contribution extends SinkingTx {
 assignment:AssignedTo;impactProject:VcsProject|null;allocations:(SinkStatus&{retirement:Retirement})[];
 allocated:DecimalString;remaining:DecimalString;collectionStatus:'COMPLETE'|'PARTIAL'|'AWAITING_RETIREMENT';nativeFinalized:boolean;
}
export interface AssetTotal {side:'source'|'dest';code:string;issuer:string|null;amount:DecimalString}
export interface ContributionTotals {
 count:number;carbon:DecimalString;allocated:DecimalString;remaining:DecimalString;complete:number;partial:number;
 unassigned:number;conflicts:number;assets:AssetTotal[];
}
export interface RetirementAttribution {
 hash:string;toid:NativeId;createdAt:string;customerId:string|null;projectId:string|null;amount:DecimalString;finalized:boolean;
}
export interface RetirementRecord extends Retirement {
 allocations:RetirementAttribution[];attributedAmount:DecimalString;impactProject:VcsProject|null;
 blocks:(RetirementFromBlock&{block?:MintedBlock|null})[];
}
export interface RetirementTotals {certificates:number;certificateCarbon:DecimalString;attributedCarbon:DecimalString}
export interface Query {
 editionId?:string;customerId?:string;projectId?:string;impactProjectId?:NativeId;fromDate?:CivilDate;beforeDate?:CivilDate;
 cursor?:NativeId|null;limit?:number|string;search?:string;assignmentStatus?:AssignedTo['status'];
 status?:Contribution['collectionStatus'];funder?:string;recipient?:string;beneficiary?:string;
}
export interface Page<T> {items:T[];total:number;limit:number;nextCursor:NativeId|null;editionId:string}
export interface ContributionPage extends Page<Contribution> {totals:ContributionTotals}
export interface RetirementPage extends Page<RetirementRecord> {totals:RetirementTotals}
export interface StatementValue extends Period {
 id?:string;expectedVersion?:number;title:string;editionId:string;customerId?:string|null;projectId?:string|null;note?:string;
}
export interface StatementSpec extends Period {title:string;editionId:string;customerId:string|null;projectId:string|null;note:string}
export interface StatementReport {
 schema:'stellar-forge.stellarcarbon-statement.v1';spec:StatementSpec;
 source:{id:string;format:SourceEdition['format'];importedAt:string;metadata:Record<string,Json>;sha256:string|null};
 customer:Customer|null;project:CustomerProject|null;contributionDateBasis:string;allocationDateBasis:string;retirementDateBasis:string;
 totals:ContributionTotals;retirementTotals:RetirementTotals;
 coverage:{sourcePeriodTransactions:number;unassigned:number;conflictingAssignments:number};
 contributions:Contribution[];retirements:RetirementRecord[];
 customerSnapshot:Customer[];projectSnapshot:CustomerProject[];assignmentSnapshot:Assignment[];
}
export interface SavedStatementVersion extends StatementReport {version:number;createdAt:string;actor:string}
export interface SavedStatement {id:string;createdAt:string;versions:SavedStatementVersion[]}
export interface InvoiceLink {
 id:string;statementId:string;statementVersion:number;invoiceId:string;accountingWorkspaceId:string;createdAt:string;actor:string;
}
export interface HistoryRecord {requestId:string;action:string;actor:string;at:string;revision:number;recordId:string}
export interface OperationRecord {requestId:string;intent:string;result:Record<string,unknown>;revision:number}
export interface WorkspaceState {
 schema:'stellar-forge.stellarcarbon-workspace.v1';workspaceId:string;name:string;createdAt:string;revision:number;
 editions:SavedSourceEdition[];customers:Customer[];projects:CustomerProject[];assignments:Assignment[];
 statements:SavedStatement[];invoices:InvoiceLink[];history:HistoryRecord[];operations:OperationRecord[];
}
export interface StatementVersionSummary extends Period {
 version:number;createdAt:string;title:string;editionId:string;customerId:string|null;projectId:string|null;
 totals:ContributionTotals;retirementTotals:RetirementTotals;
}
export interface WorkspaceOverview extends Omit<WorkspaceState,'createdAt'|'editions'|'statements'|'operations'> {
 editions:(SourceSummary&{id:string;label:string;format:SourceEdition['format'];importedAt:string;metadata:Record<string,Json>;sha256:string})[];
 statements:{id:string;createdAt:string;versions:StatementVersionSummary[]}[];
 integration?:{accounting:boolean;accountingWorkspaceId:string|null;receivablesUrl:string|null;paymentPlansUrl:string|null;customersUrl:string|null};
}
export interface Handover {schema:'stellar-forge.stellarcarbon-handover.v1';exportedAt:string;workspace:WorkspaceState}
export interface MutationOptions {revision:number;requestId?:string;actor?:string}
export interface Operation {action:'import'|'customer'|'project'|'assignment'|'statement'|'invoice-link'|'settings';value:Record<string,unknown>;
 revision:number;requestId:string;actor:string;recordId?:string;at?:string;intentSha256?:string}
export interface MutationResult {revision:number;replayed:boolean;requestId:string;workspaceId:string;[key:string]:unknown}
export interface ComparisonChange {key:string;before:Record<string,unknown>;after:Record<string,unknown>;fields:{name:string;before:unknown;after:unknown;category?:'instrument-metadata';sourcePlaceholder?:boolean;note?:string}[]}
export interface EditionComparison {
 schema:'stellar-forge.stellarcarbon-comparison.v1';beforeId:string;afterId:string;previous:SourceSummary;current:SourceSummary;
 deltaAvailable:boolean;delta:{carbon:DecimalString|null;allocated:DecimalString|null;remaining:DecimalString|null};
 tables:Record<TableName,{comparisonStatus:'available'|'unavailable';coverage:{before:{available:boolean;scope:Json};after:{available:boolean;scope:Json}};note:string;
 added:{key:string;after:NativeRow}[];removed:{key:string;before:NativeRow}[];changed:ComparisonChange[];sourceDifferences:{key:string;before:NativeRow;after:NativeRow;representationChanges:{name:string;before:Json;after:Json}[];fieldAvailabilityChanges:{name:string;before:Json;after:Json;beforeAvailable:boolean;afterAvailable:boolean}[]}[];
 counts:{before:number;after:number;added:number|null;removed:number|null;changed:number|null;sourceDifferences:number|null}}>;
}
export interface CaptureQuery extends Period {baseUrl:'https://api.stellarcarbon.io'|'https://testnet-api.stellarcarbon.io';pageSize:number}
export interface CaptureCheckpoint {schema:'stellar-forge.stellarcarbon-api-capture.v1';query:CaptureQuery;startedAt:string;responses:SourceResponse[]}
export interface CaptureOptions extends Partial<Period> {
 baseUrl?:CaptureQuery['baseUrl'];pageSize?:number;checkpoint?:CaptureCheckpoint;retain?:(checkpoint:CaptureCheckpoint)=>Promise<void>;
 fetchImpl?:typeof fetch;signal?:AbortSignal;resume?:boolean;
}
export interface CaptureStatus {status:'IDLE'|'RUNNING'|'COMPLETE'|'INTERRUPTED';pages:number;startedAt?:string;completedAt?:string;lastUrl?:string;editionId?:string;error?:{code:string;message:string}}
export interface InvoiceValue {statementVersion?:number;amount:DecimalString;currency:{code:string;scale:number};issueDate:CivilDate;dueDate:CivilDate;taxAmount?:DecimalString;note?:string}
export interface InvoiceDraft {
 customerId:string;currency:{code:string;scale:number};issueDate:CivilDate;dueDate:CivilDate;sourceReference:string;note:string;
 lines:{description:string;quantity:string;unitAmount:DecimalString;discountAmount:DecimalString;taxAmount:DecimalString}[];
}
export interface StatementFile {type:string;content:string}
export type StatementFileName = 'statement.json'|'statement.html'|'contributions.csv'|'allocations.csv'|'retirements.csv';
export const SOURCE_SCHEMA:'stellar-forge.stellarcarbon-source-edition.v1';
export const WORKSPACE_SCHEMA:'stellar-forge.stellarcarbon-workspace.v1';
export const STATEMENT_SCHEMA:'stellar-forge.stellarcarbon-statement.v1';
export const HANDOVER_SCHEMA:'stellar-forge.stellarcarbon-handover.v1';
export const TABLES:Record<TableName,string[]>;
export const KEYS:Record<TableName,string[]>;
export function copy<T>(value:T):T;
export function need(condition:unknown,code:string,message:string,status?:number):asserts condition;
export function plain(value:unknown):value is Record<string,unknown>;
export function text(value:unknown,label:string,maximum?:number,empty?:boolean):string;
export function id(value:unknown,label?:string):string;
export function civilDate(value:unknown,label?:string):CivilDate;
export function dayOf(value:string):CivilDate;
export function windowOf(value?:Partial<Period>):Period;
export function inWindow(value:string,period:Period):boolean;
export function parseNativeJSON(source:string):unknown;
export function integer(value:unknown,label?:string):NativeId;
export function units(value:string,scale?:number):bigint;
export function decimal(value:bigint,scale?:number):DecimalString;
export function sum(rows:Record<string,unknown>[],field:string,scale?:number):DecimalString;
export function rowKey(table:TableName,row:Record<string,unknown>):string;
export function normalizeRow<K extends TableName>(table:K,input:unknown[]|Record<string,unknown>):NativeRow<K>;
export function parseTable<K extends TableName>(table:K,content:string):NativeTables[K];
export function indexTables(tables:NativeTables):Record<TableName,Map<string,NativeRow>>;
export function validateTables(tables:NativeTables,options?:{format?:SourceEdition['format']}):NativeTables;
export function receiveBackup(files:NativeFiles,metadata?:Record<string,Json>):SourceEdition;
export function sourceSummary(source:SourceEdition):SourceSummary;
export function now():string;
export function newWorkspace(value:{workspaceId:string;name:string;createdAt?:string}):WorkspaceState;
export function validateWorkspace(value:unknown):WorkspaceState;
export function editionFor(state:WorkspaceState,editionId:string):SavedSourceEdition;
export function recordFor<T extends {id:string}>(rows:T[],recordId:string,label:string):T;
export function canonical(value:unknown):string;
export function assignmentsFor(state:WorkspaceState,tx:SinkingTx):AssignedTo;
export function sourceIndex(state:WorkspaceState,editionId:string):{
 source:SavedSourceEdition;contributions:Contribution[];retirements:Map<string,Retirement>;projects:Map<string,VcsProject>;
};
export function contributionsPage(state:WorkspaceState,query?:Query):ContributionPage;
export function contributionDetail(state:WorkspaceState,editionId:string,hash:string):Contribution;
export function retirementRegister(state:WorkspaceState,query?:Query):{editionId:string;rows:RetirementRecord[];totals:RetirementTotals};
export function retirementsPage(state:WorkspaceState,query?:Query):RetirementPage;
export function retirementDetail(state:WorkspaceState,editionId:string,certificateId:NativeId):RetirementRecord;
export function contributionTotals(rows:Contribution[]):ContributionTotals;
export function statementSpec(state:WorkspaceState,input:StatementValue):StatementSpec;
export function prepareStatement(state:WorkspaceState,input:StatementValue):StatementReport;
export function compareEditions(state:WorkspaceState,beforeId:string,afterId:string):EditionComparison;
export function mutate(state:WorkspaceState,operation:Operation):{state:WorkspaceState;result:Record<string,unknown>;replayed:boolean};
export function workspaceOverview(state:WorkspaceState):WorkspaceOverview;
export function statementVersion(state:WorkspaceState,statementId:string,version?:number|string):SavedStatementVersion;
export function exportHandover(state:WorkspaceState):Handover;
export function receiveHandover(value:unknown):WorkspaceState;
export function invoiceDraftForStatement(state:WorkspaceState,statementId:string,value:InvoiceValue):InvoiceDraft;
export function captureNativeApi(options:CaptureOptions):Promise<SourceEdition>;
export function csv(columns:string[],rows:Record<string,unknown>[]):string;
export function statementContributions(report:StatementReport):Record<string,unknown>[];
export function statementAllocations(report:StatementReport):Record<string,unknown>[];
export function statementRetirements(report:StatementReport):Record<string,unknown>[];
export function statementHTML(report:StatementReport,options?:{statementId?:string}):string;
export function statementFiles(report:StatementReport,options?:{statementId?:string}):Record<StatementFileName,StatementFile>;
export function comparisonCSV(report:EditionComparison):string;
export const MAX_INPUT_BYTES:number;
export function digest(value:unknown):string;
export function sourceDigest(source:SourceEdition):string;
export function sealSource(source:SourceEdition):SourceEdition&{sha256:string};
export function verifySources(state:WorkspaceState):WorkspaceState;
export function readNativeDirectory(directory:string):Promise<SourceEdition&{sha256:string}>;
export function inspectBinding(directory:string):Promise<{directory:string;workspaceId:string}>;
export class StellarcarbonWorkspace {
 directory:string;state:WorkspaceState;closed:boolean;
 static create(directory:string,options?:{name?:string;handover?:Handover}):Promise<StellarcarbonWorkspace>;
 static open(directory:string,options?:{expectedWorkspaceId?:string}):Promise<StellarcarbonWorkspace>;
 serial<T>(work:()=>T|Promise<T>):Promise<T>;
 overview():Promise<WorkspaceOverview>;snapshot():Promise<WorkspaceState>;
 applyUnlocked(action:Operation['action'],value:Record<string,unknown>,options?:MutationOptions):Promise<MutationResult>;
 apply(action:Operation['action'],value:Record<string,unknown>,options?:MutationOptions):Promise<MutationResult>;
 import(source:SourceEdition,label:string,options?:MutationOptions):Promise<MutationResult>;
 handover():Promise<Handover>;saveCapture(value:CaptureCheckpoint):Promise<void>;captureCheckpoint():Promise<CaptureCheckpoint|undefined>;
 close():Promise<void>;
}
export interface AccountingConnection {
 workspace:{directory:string;state:Record<string,unknown>;serial<T>(work:()=>T|Promise<T>):Promise<T>};
 receivables:{data():{requests:{id:string;result:{invoiceId?:string}}[]};state():Promise<{revision:number}>;saveDraft(value:Record<string,unknown>):Promise<{invoice:{id:string}}>;[key:string]:unknown};
}
export function createStatementInvoice(workspace:StellarcarbonWorkspace,accounting:AccountingConnection,
 input:MutationOptions&{statementId:string;value:InvoiceValue}):Promise<{invoice:InvoiceLink;revision:number;alreadyLinked?:boolean;[key:string]:unknown}>;
export interface ServerOptions {
 directory:string;port?:number;expectedWorkspaceId?:string;accountingDirectory?:string;expectedAccountingWorkspaceId?:string;expectedAccountingSourcesSha256?:string;
}
export interface Startup {schema:'stellar-forge.stellarcarbon-startup.v1';directory:string;workspaceId:string;accountingWorkspaceId:string|null;url:string}
export function createStellarcarbonServer(options:ServerOptions):Promise<{
 schema:Startup['schema'];url:string;startup:Startup;workspace:StellarcarbonWorkspace;accounting?:AccountingConnection;server:unknown;close():Promise<void>;
}>;
export {StellarcarbonClient} from './client.mjs';
