/** Exact original decimal amounts, atomic quantities, hashes and ledger identities remain strings. */
import type {SourceEdition as CarbonSource, SinkingTx, Retirement} from '../stellarcarbon-statements/index.mjs';
export type Network='mainnet'|'testnet';
export type DecimalString=string;
export type AtomString=string;
export type NativeRow=Record<string,unknown>;
export type SourceKind='registry'|'ledger'|'carbon';
export type RegistryTable='donations'|'nfts'|'organizations'|'initiatives'|'credits'|'providers'|'stories'|'impactlinks';
export type LedgerTable='transactions'|'transfers'|'donationEvents'|'contractObservations';
export interface Period {fromDate:string;beforeDate:string}
export interface Asset {key:string;code:string|null;issuer:string|null;contractId?:string|null;decimals:number|string;network?:string|null;chain?:string|null;metadataLedger?:string;metadataRawRefs?:string[]}
export interface Donation extends NativeRow {id:string;organizationId:string;initiativeId?:string|null;wallet?:string|null;chain?:string|null;network?:string|null;asset?:string|null;issuer?:string|null;amount:DecimalString;usdvalue:DecimalString;created:string;impactlinks?:NativeRow[]}
export interface Receipt extends NativeRow {id:string;donationId?:string|null;donorAddress:string;organizationId?:string;initiativeId?:string|null;chainName?:string;network?:string;transactionId?:string|null;tokenId:string;contractId?:string;created?:string;coinValue?:DecimalString;usdValue?:DecimalString}
export interface RegistryTables {donations:Donation[];nfts:Receipt[];organizations:NativeRow[];initiatives:NativeRow[];credits:NativeRow[];providers:NativeRow[];stories:NativeRow[];impactlinks:NativeRow[]}
export interface Transaction extends NativeRow {hash:string;hashAliases?:string[];network:Network;ledger:string;createdAt:string|null;successful:boolean;applicationOrder?:string|null;envelopeXdr?:string|null;resultMetaXdr?:string|null;rawRefs?:string[]}
export interface Transfer extends NativeRow {key:string;hash:string;network:Network;ledger:string;createdAt:string|null;from:string;to:string;asset:Asset;amountAtoms:AtomString;operationIndex?:string;eventIndex?:string;operationId?:string;eventId?:string|null;destinationAsset?:Asset;destinationAmountAtoms?:AtomString;rawRefs?:string[]}
export interface DonationEvent extends NativeRow {key:string;hash:string;network:Network;ledger:string;createdAt:string|null;contractId:string;donor:string;provider:string;amountAtoms:AtomString;operationIndex?:string;eventIndex?:string;rawRefs?:string[]}
export interface ContractObservation extends NativeRow {key:string;network:Network;ledger:string;createdAt:string|null;contractId:string;hash?:string;phase?:string;provider:string|null;vendor:string|null;providerFees:string|null;vendorFees:string|null;tokenContractId:string|null;bucketAtoms:AtomString|null;minimumAtoms:AtomString|null;accountedRemainderAtoms:string|null;tokenBalanceAtoms:string|null;rawRefs?:string[];sourceStatus?:NativeRow}
export interface LedgerTables {transactions:Transaction[];transfers:Transfer[];donationEvents:DonationEvent[];contractObservations:ContractObservation[]}
export interface SourceResponse {url:string;method?:string;request?:NativeRow;retrievedAt:string;status?:string;content:string;file?:string;sha256?:string}
export interface SourceBase {schema:'stellar-forge.givecredit-source.v1';kind:SourceKind;metadata:NativeRow&{network?:Network;status?:string};files:Record<string,string>;responses:SourceResponse[];id?:string;label?:string;importedAt?:string;sha256?:string}
export interface RegistryEdition extends SourceBase {kind:'registry';tables:RegistryTables}
export interface LedgerEdition extends SourceBase {kind:'ledger';tables:LedgerTables;metadata:NativeRow&{network:Network}}
export interface CarbonEdition extends SourceBase {kind:'carbon';tables:Record<string,never>;carbon:CarbonSource;metadata:NativeRow&{network:Network}}
export type SourceEdition=RegistryEdition|LedgerEdition|CarbonEdition;
export type SavedSourceEdition=SourceEdition&{id:string;label:string;importedAt:string;sha256:string};
export interface SourceSummary {kind:SourceKind;network:Network|null;counts:Record<string,number>;files?:number;responses?:number;coverage?:unknown;contributions?:number;carbon?:DecimalString}
export interface VersionedRecord {id:string;version:number;createdAt:string;updatedAt:string}
export interface RecordValue {id?:string;expectedVersion?:number;active?:boolean}
export interface PaymentLinkValue extends RecordValue {registryEditionId:string;ledgerEditionId:string;donationId:string;paymentKey:string;amountAtoms:AtomString;receiptId?:string|null;note:string}
export interface PaymentLink extends VersionedRecord,Omit<PaymentLinkValue,keyof VersionedRecord> {active:boolean;source:{donation:Donation;payment:Transfer};walletMatches:boolean;registryPrecision:4;ledgerPrecision:number}
export type FundingMethod='PROPORTIONAL_GROSS'|'FIFO_GROSS'|'EXPLICIT';
export interface FundingCapacity {paymentKey:string;amountAtoms:AtomString;note?:string}
export interface AllocationPart {paymentKey:string;amountAtoms:AtomString;weightAtoms:AtomString;payment:Transfer;capacityAtoms?:AtomString;capacityNote?:string;capacitySource?:NativeRow;availableCapacityAtoms?:AtomString;orderSource?:NativeRow;operatorOrder?:NativeRow|null}
export interface AllocationValue extends RecordValue {ledgerEditionId:string;payoutKey:string;method:FundingMethod;name?:string;note?:string;paymentKeys?:string[];parts?:{paymentKey:string;amountAtoms:AtomString}[];capacities?:FundingCapacity[];ordering?:{paymentKey:string;precedesPayout?:boolean;rank?:number|string;note:string}[];confirmProviderPayout?:boolean;classificationNote?:string}
export interface Allocation extends VersionedRecord {ledgerEditionId:string;payoutKey:string;method:FundingMethod;name:string;note:string;active:boolean;parts:AllocationPart[];source:{network:Network;contractId:string;provider:string;asset:Asset;payoutAtoms:AtomString;createdAt:string|null};payoutClassification:string;classificationNote:string;confirmProviderPayout:boolean;classificationSource:NativeRow;rounding:string}
export interface BridgeValue extends RecordValue {ledgerEditionId:string;carbonEditionId:string;payoutKey:string;allocationId:string;sinkHash:string;paymentAtoms:AtomString;carbonAmount:DecimalString;note:string}
export interface Bridge extends VersionedRecord,Omit<BridgeValue,keyof VersionedRecord> {active:boolean;allocationVersion:number;allocationSnapshot:Allocation;source:{payout:Transfer;sink:SinkingTx};attributionBasis:string}
export interface StatementValue extends Period {id?:string;expectedVersion?:number;title:string;basis:'REGISTRY_CREATED'|'LEDGER_CLOSED';registryEditionId?:string|null;ledgerEditionId?:string|null;carbonEditionId?:string|null;organizationId?:string|null;initiativeId?:string|null;donorAddress?:string|null;note?:string}
export interface AssetTotal {asset:Asset;amountAtoms:AtomString;amount:DecimalString;records:number}
export interface Impact extends NativeRow {paymentKey:string;donationId?:string;linkId?:string;bridgeId:string;allocationId:string;allocationVersion:number;allocationSnapshot:Allocation;payoutKey:string;sinkHash:string;sink:SinkingTx;method:FundingMethod;carbonAtoms:AtomString;allocatedAtoms:AtomString;remainingAtoms:AtomString;carbon:DecimalString;allocated:DecimalString;remaining:DecimalString;certificates:{certificateId:string;retirementDate:string;amountAtoms:AtomString;amount:DecimalString;certificate:Retirement}[]}
export interface Statement extends NativeRow {schema:'stellar-forge.givecredit-statement.v1';spec:StatementValue;sources:{registry:NativeRow|null;ledger:NativeRow|null;carbon:NativeRow|null};dateBasis:string;allocationBasis:string;retirementDateBasis:string;totals:{registryRecords:number;registryAssets:AssetTotal[];registryUSD:DecimalString;paymentRecords:number;paymentAssets:AssetTotal[];carbon:DecimalString;allocated:DecimalString;remaining:DecimalString;linkedCertificates:number;periodCertificates:number};coverage:{registryDateBasis:boolean;ledgerDateBasis:boolean;unassignedDonations:number;receiptsWithSharedPayment:{paymentKey:string;receiptIds:string[]}[];paymentSourceAvailable:boolean;carbonSourceAvailable:boolean};organization:NativeRow|null;initiative:NativeRow|null;donations:Donation[];payments:Transfer[];receipts:Receipt[];impacts:Impact[];relatedPayouts:{payout:Transfer;allocationId:string;allocationVersion:number;current:boolean;usedForCarbon:boolean;method:FundingMethod;selectedFunding:AllocationPart[];wholeFunding:AllocationPart[]}[];certificates:(Retirement&{attributedAmount:DecimalString;withinRetirementPeriod:boolean})[];retirementRegister:(Retirement&{attributedAmount:DecimalString;withinRetirementPeriod:boolean})[];assignmentSnapshot:PaymentLink[];allocationSnapshot:Allocation[];bridgeSnapshot:Bridge[];version?:number;createdAt?:string;actor?:string}
export interface SavedStatement extends Statement {version:number;createdAt:string;actor:string}
export interface WorkspaceState {schema:'stellar-forge.givecredit-workspace.v1';workspaceId:string;name:string;createdAt:string;revision:number;editions:SavedSourceEdition[];paymentLinks:PaymentLink[];allocations:Allocation[];bridges:Bridge[];statements:{id:string;title:string;createdAt:string;updatedAt:string;versions:SavedStatement[]}[];history:NativeRow[];operations:NativeRow[];receivedFrom?:NativeRow}
export interface WorkspaceOverview extends NativeRow {workspaceId:string;name:string;revision:number;editions:(SourceSummary&{id:string;label:string;importedAt:string;metadata:NativeRow})[];paymentLinks:PaymentLink[];allocations:Allocation[];bridges:Bridge[];statements:NativeRow[];history:NativeRow[]}
export interface Handover {schema:'stellar-forge.givecredit-handover.v1';exportedAt:string;workspace:WorkspaceState}
export interface Page<T> {items:T[];offset:number;limit:number;total:number;nextOffset:number|null;editionId?:string}
export interface Query {editionId:string;ledgerEditionId?:string;organizationId?:string;initiativeId?:string;donorAddress?:string;fromDate?:string;beforeDate?:string;search?:string;address?:string;kind?:'payment'|'payout';contractId?:string;offset?:number|string;limit?:number|string}
export interface Comparison {schema:'stellar-forge.givecredit-comparison.v1';before:{id:string;label:string};after:{id:string;label:string};kind:SourceKind;tables:Record<string,{counts:{before:number;after:number;added:number;removed:number;changed:number};added:{key:string;row:NativeRow}[];removed:{key:string;row:NativeRow}[];changed:{key:string;before:NativeRow;after:NativeRow}[]}>}
export interface ExportFile {type:string;content:string}
export const SOURCE_SCHEMA:'stellar-forge.givecredit-source.v1';
export const WORKSPACE_SCHEMA:'stellar-forge.givecredit-workspace.v1';
export const STATEMENT_SCHEMA:'stellar-forge.givecredit-statement.v1';
export const HANDOVER_SCHEMA:'stellar-forge.givecredit-handover.v1';
export const REGISTRY_TABLES:RegistryTable[];
export const LEDGER_TABLES:LedgerTable[];
export function need(condition:unknown,code:string,message:string,status?:number):asserts condition;
export function copy<T>(value:T):T;
export function plain(value:unknown):value is NativeRow;
export function text(value:unknown,label?:string,max?:number,allowEmpty?:boolean):string;
export function id(value:unknown,label?:string):string;
export function units(value:string,scale?:number):bigint;
export function decimal(value:bigint,scale?:number):string;
export function parseNativeJSON(content:string):unknown;
export function dayOf(value:string):string;
export function civilDate(value:string,label?:string):string;
export function windowOf(value:Period):Period;
export function inWindow(value:string,period:Period):boolean;
export function amount(value:string,scale:number,label?:string):string;
export function atoms(value:string,label?:string):string;
export function signedAtoms(value:string,label?:string):string;
export function network(value:string):Network;
export function txKey(row:{network:Network;hash:string}):string;
export function keyForReceipt(row:Receipt):string;
export function normalizeRegistryTables(input:Partial<RegistryTables>):RegistryTables;
export function receiveRegistryFiles(files:Record<string,string>,metadata?:NativeRow):RegistryEdition;
export function receiveCarbon(source:CarbonSource,options:{network:Network;label?:string}):CarbonEdition;
export function validateSourceEdition<T extends SourceEdition>(source:T):T;
export function sourceSummary(source:SourceEdition):SourceSummary;
export function canonical(value:unknown):string;
export function now():string;
export function newWorkspace(options:{workspaceId:string;name?:string;createdAt?:string}):WorkspaceState;
export function validateWorkspace(state:WorkspaceState):WorkspaceState;
export function recordFor<T extends {id:string}>(rows:T[],recordId:string,label?:string):T;
export function editionFor(state:WorkspaceState,editionId:string,kind?:SourceKind):SavedSourceEdition;
export function assetKey(asset:Asset):string;
export function transactionFor(source:LedgerEdition,hash:string):Transaction|undefined;
export function providerPayoutCandidates(source:LedgerEdition):(Transfer&{classification:'provider-payout'|'vendor-fee'|'requires-source-classification';classificationBasis:string;donationEvent:DonationEvent;donorPaymentKey:string;observationRefs:string[]})[];
export function providerPayouts(source:LedgerEdition):Transfer[];
export function nativePayments(source:LedgerEdition):Transfer[];
export function registrySummary(state:WorkspaceState,editionId:string):NativeRow;
export function donationDetail(state:WorkspaceState,editionId:string,donationId:string,ledgerEditionId?:string):{donation:Donation;organization:NativeRow|null;initiative:NativeRow|null;receipts:Receipt[];receiptCandidates:Receipt[];paymentLinks:PaymentLink[];candidatePayments:Transfer[];matchingRule:string};
export function donationsPage(state:WorkspaceState,query:Query):Page<Donation&{organizationName:string;initiativeName:string;linkedPayments:number;receiptCount:number;candidateCount:number}>;
export function transfersPage(state:WorkspaceState,query:Query):Page<Transfer&{role:string;amount:string}>;
export function transferDetail(state:WorkspaceState,editionId:string,key:string):Transfer&NativeRow;
export function poolRegister(state:WorkspaceState,editionId:string,query?:Partial<Query>):NativeRow;
export function apportion(total:bigint,entries:{id:string;weight:bigint;cap?:bigint}[]):{id:string;amount:bigint}[];
export function prepareAllocation(state:WorkspaceState,value:AllocationValue):Omit<Allocation,keyof VersionedRecord>;
export function prepareBridge(state:WorkspaceState,value:BridgeValue):Omit<Bridge,keyof VersionedRecord>;
export function carbonAttributions(state:WorkspaceState,ledgerEditionId:string,carbonEditionId:string):Impact[];
export function prepareStatement(state:WorkspaceState,value:StatementValue):Statement;
export function statementVersion(state:WorkspaceState,id:string,version?:number|string):SavedStatement;
export function compareEditions(state:WorkspaceState,beforeId:string,afterId:string):Comparison;
export function mutate(state:WorkspaceState,operation:{action:string;value:NativeRow;requestId:string;revision:number;actor?:string;recordId?:string;at?:string;intentSha256?:string}):{state:WorkspaceState;result:NativeRow;replayed:boolean};
export function workspaceOverview(state:WorkspaceState):WorkspaceOverview;
export function exportHandover(state:WorkspaceState):Handover;
export function receiveHandover(handover:Handover,options?:{workspaceId?:string}):WorkspaceState;
export function readableDate(value:string):string;
export function methodLabel(value:FundingMethod):string;
export function csv(columns:(string|[string,(row:NativeRow)=>unknown])[],rows:NativeRow[]):string;
export function statementHTML(report:Statement):string;
export function statementFiles(report:Statement):Record<string,ExportFile>;
export function comparisonCSV(comparison:Comparison):string;

export interface FundingCapacityResult extends NativeRow {capacityAtoms:AtomString|null;grossWeightAtoms:AtomString;providerPortionAtoms:AtomString|null;vendorPortionAtoms:AtomString|null;residualAtoms:string|null;providerPayoutAtoms:AtomString|null;sourceBasis:string;rawRefs:string[];unresolvedReasons:string[];status:'source-derived'|'operator-capacity-required'}
export function paymentFundingCapacity(source:LedgerEdition,payment:Transfer):FundingCapacityResult;
export function compareNativeOrder(source:LedgerEdition,left:Transfer|DonationEvent,right:Transfer|DonationEvent):{comparison:-1|0|1|null;sourceBasis:string;rawRefs:string[]};
export function paymentBeforePayout(source:LedgerEdition,payment:Transfer,payout:Transfer):{comparison:-1|0|1|null;precedes:boolean|null;sourceBasis:string;rawRefs:string[]};
