import type { CanadaBuysBidderDesk, BidderDeskPackage, BidderReceiveResult } from './bidder-desk-workspace.mjs';
export type { BidderKind, BidderRecordMap, BidderDeskPackage, BidderReceiveResult } from './bidder-desk-workspace.mjs';
import type { NoticeDerivation, SourceFragment, DerivedSourceField, Stream, SourceMetadata, SourceObservation, OriginalSource, SourceEdition, Review, ReviewPatch, Workshare, WorkshareHistory, WorkshareInput, WorksharePatch, NoticeIndex, Notice, Profile, ProfileMatch } from './domain.mjs';
export type { NoticeDerivation, SourceFragment, DerivedSourceField, Stream, SourceMetadata, SourceObservation, OriginalSource, SourceEdition, Review, ReviewPatch, Workshare, WorkshareHistory, WorkshareInput, WorksharePatch, NoticeIndex, Notice, Profile, ProfileMatch } from './domain.mjs';
export interface WorkspaceMetadata { schema:string;id:string;title:string;revision:number;createdAt:string;updatedAt:string }
export interface CaptureRecord {
 id:string;stream:Stream;url:string;label:string;createdAt:string;updatedAt:string;attempts:number;revision:number;
 status:'downloading'|'interrupted'|'complete';canResume:boolean;leaseUntil?:string;retryAt?:string|null;
 sourceId?:string;sha256?:string;bytes?:number;rowCount?:number;completedAt?:string;response?:Record<string,unknown>|null;
 error?:{code:string;message:string;retryAfter?:string|null}|null;rawBase64?:string;retainedBodyBytes?:number;
}
export interface Ingestion { sourceId:string;sourceAdded:boolean;entriesAdded:number;rowCount:number;observationId?:string }
export interface Receiving {
 bidderDesk?:BidderReceiveResult|{status:'LEGACY_SOURCE_PACKAGE';importedRecords:number;conflicts:unknown[]};
 packageId:string;receivedAt:string;operator:string;sourceWorkspace:WorkspaceMetadata;ingestion:Ingestion[];
 reviewConflicts:Array<{noticeId:string;retained:Review;incoming:Review}>;
 workshareConflicts:Array<{workshareId:string;retained:Workshare;incoming:Workshare;incomingHistory:Workshare[]}>;
 captureConflicts:Array<{captureId:string;retained:CaptureRecord;incoming:CaptureRecord}>;
 sourceCaptures:CaptureRecord[];sourcePublications:Publication[];sourceReceivingHistory:unknown[];
}
export interface Publication { id:string;at:string;operator:string;kind?:string;noticeIds?:string[];[key:string]:unknown }
export interface WorkspaceView {
 schema:string;workspace:WorkspaceMetadata;revision:number;sources:SourceMetadata[];sourceObservations:SourceObservation[];
 latestOpenObservation:(SourceObservation&{id:string})|SourceMetadata|null;notices:NoticeIndex[];workshares:Workshare[];
 captures:CaptureRecord[];receivings:Receiving[];publications:Publication[];
 counts:{notices:number;awards:number;supplyArrangements:number;sources:number};
}
export interface SourceInput { stream:Stream;label?:string;url?:string;retrievedAt?:string;expectedSha256?:string;response?:Record<string,unknown>|null;coverage?:'federal'|'single-notice';bodyKind?:'original-utf8-csv'|'derived-notice-utf8-csv';derivation?:NoticeDerivation;derivationSha256?:string }
export interface Selection { scope?:'all'|'shortlist'|'selected';noticeIds?:string[] }
export interface WorkspacePackage {
 schema:string;packageId:string;exportedAt:string;workspace:WorkspaceMetadata;selection:{scope:NonNullable<Selection['scope']>;noticeIds:string[]};
 sources:Array<Omit<OriginalSource,'observations'>>;sourceObservations:SourceObservation[];
 reviews:Array<{noticeId:string;review:Review}>;workshares:WorkshareHistory[];captures:CaptureRecord[];
 publications:Publication[];receivingHistory:unknown[];provenance:Record<string,unknown>;
 /** Present in v2 packages. Legacy v1 packages contain the original procurement records. */
 bidderDesk?:BidderDeskPackage;
}
export interface Comparison { before:Omit<SourceEdition,'row'>;after:Omit<SourceEdition,'row'>;sameNotice:boolean;
 changes:Array<{field:string;beforePresent:boolean;afterPresent:boolean;before:unknown;after:unknown}> }
export interface Report { body:string;mime:string;filename:string }
export interface WorkspaceResult { workspace:WorkspaceMetadata }
export type ReceiveResult=WorkspaceResult&{receiving:Receiving;alreadyReceived:boolean};
export declare const WORKSPACE_SCHEMA:string;
export declare const PACKAGE_SCHEMA:string;
export declare function sha256(value:string|Uint8Array):string;
export declare function canonical(value:unknown):string;
export declare function failure(code:string,message:string,status?:number,details?:unknown):Error&{code:string;status:number;details?:unknown};
export declare class CanadaBuysWorkspace {
 constructor(directory:string,options?:{operator?:string;title?:string});
 readonly directory:string;readonly databasePath:string;readonly operator:string;readonly bidderDesk:CanadaBuysBidderDesk;
 metadata():WorkspaceMetadata;
 view():WorkspaceView;
 importCsv(input:string|Uint8Array,metadata:SourceInput,expectedRevision:number):WorkspaceView&{ingestion:Ingestion};
 getSource(id:string,options?:{includeBody?:true}):OriginalSource;
 getSource(id:string,options:{includeBody:false}):Omit<OriginalSource,'rawText'>;
 getEntry(id:string):SourceEdition;
 getNotice(id:string):Notice;
 compare(beforeId:string,afterId:string):Comparison;
 updateReview(id:string,patch:ReviewPatch):Notice&WorkspaceResult;
 createWorkshare(input:WorkshareInput,expectedRevision:number):WorkspaceResult&{workshare:Workshare};
 getWorkshare(id:string):WorkshareHistory;
 updateWorkshare(id:string,patch:WorksharePatch):WorkspaceResult&{workshare:Workshare};
 qualify(profile?:Profile,at?:number):{profile:Profile;results:ProfileMatch[]};
 report(options?:Selection&{format?:'json'|'csv'|'html'}):Report;
 exportPackage(options?:Selection&{expectedRevision?:number}):WorkspacePackage;
 receivePackage(packet:WorkspacePackage,options:{expectedRevision:number}):ReceiveResult;
 getReceiving(id:string):Receiving;
 getCapture(id:string):CaptureRecord;
 getPublication(id:string):Publication|null;
 recordPublication(record:Omit<Publication,'id'|'at'|'operator'>&{id?:string},expectedRevision?:number|null):WorkspaceResult&{publication:Publication};
 close():void;
}
