// SPDX-License-Identifier: MIT
/** IDs are original lowercase hexadecimal hashes/UUIDs, never display labels. */
export type Sha256 = string;
export type RequestId = string;
export type WorkspaceId = string;
export type SourceId = string;
export type NativeRecord = Record<string, unknown>;
export type NativeType = 'VARCHAR'|'BOOLEAN'|'BIGINT'|'HUGEINT'|'DOUBLE'|'DATE'|'TIMESTAMP'|'TIMESTAMPTZ'|'JSON'|`DECIMAL(${number},${number})`;
export interface Page { offset?: number; limit?: number }
export interface SourcePage extends Page { q?: string }
export interface ColumnMapping { source: string; name: string; type: NativeType; nullable: boolean }
export interface ColumnMeaning {
 source: string; role: 'tag'|'time'|'value'|'quality'|'attribute'; meaning: string;
 units?: string; timezone?: string; precision?: string;
}
export interface Interpretation {
 columns: ColumnMeaning[]; scope_note: string; null_note: string; time_note: string; allow_approximate?: boolean;
}
export interface ReviewInput {
 request_id: RequestId; report_id: Sha256; source_id: SourceId;
 columns: ColumnMapping[]; interpretation: Interpretation; keys?: [];
}
export interface RetainInput { request_id: RequestId; source: string; sha256: Sha256 }
export interface FileDescriptor { name: string; bytes: number; sha256: Sha256 }
export interface NativeSourceDescriptor extends NativeRecord {
 id: SourceId; role:'BASELINE'|'OBSERVED'; filename:string; bytes:number; sha256:Sha256;
 rows:number; columns:{name:string;oid:string|null}[]; tableName:string|null; tableDigest:Sha256;
 contractRevision:number; provider_completeness:'DECLARED_COMPLETE'|'NOT_DECLARED';
}
export interface ReportRecord extends NativeRecord {
 report_id:Sha256; filename:string; bytes:number; sha256:Sha256;
 commissioning_workspace_id:string; commissioning_id:string; revision:number; digest:Sha256;
 title:string; created_at:string; source_count:number;
 receiving_manifest:FileDescriptor; receiving_guide:FileDescriptor; sources?:NativeSourceDescriptor[];
}
export interface PairColumn {
 name:string;source:string;target:string;role:'key'|'value';meaning?:string;
 source_map?:{original:string;canonical:string}[];target_map?:{original:string;canonical:string}[];
}
export interface PairDefinition {
 name:string;label:string;source_edition:Sha256;target_edition:Sha256;columns:PairColumn[];
 window_column?:string|null;windows?:{id:string;start:string;end:string;basis:'native'|'lexical'}[];notes?:string;
}
export interface PairSaveInput {
 request_id:RequestId;expected_revision:number;definition:PairDefinition;review_sha256:Sha256;
}
export interface DownloadOptions {
 reportId:Sha256;directory:string;expectedManifestSha256?:Sha256;chunkSize?:number;signal?:AbortSignal;
 onProgress?:(record:{exportId:string;file:string;bytes:number;total:number;state:string})=>void|Promise<void>;
}
export interface NativeClient {
 endpoint:string;
 call(tool:string,args:NativeRecord,options?:{requestSignal?:AbortSignal|null;timeoutMs?:number}):Promise<NativeRecord>;
}
export interface ClientOptions {
 url?:string;client?:NativeClient;workspace:string;expectedWorkspaceId?:WorkspaceId;
 tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal;
}
export interface IntakeManifest {
 schema:'stellar-forge.duckdb-timescale-intake.v1.download-manifest';
 workspace_id:WorkspaceId;report_id:Sha256;complete:true;source_format:'TIMESCALE_COMMISSIONING';
 filename:string;files:FileDescriptor[];
}
export interface ReconciliationClient {
 workspace:string;workspaceId:WorkspaceId;endpoint:string;
 status():Promise<NativeRecord>;review(definition:PairDefinition):Promise<NativeRecord>;
 pairs(options?:Page):Promise<NativeRecord>;pair(pair_id:Sha256,revision?:number):Promise<NativeRecord>;
 savePair(request:PairSaveInput):Promise<NativeRecord>;
 runs(options?:Page&{pair_id?:Sha256}):Promise<NativeRecord>;run(run_id:Sha256):Promise<NativeRecord>;
 execute(request:{request_id:RequestId;pair_id:Sha256;expected_revision:number;definition_sha256:Sha256}):Promise<NativeRecord>;
 groups(run_id:Sha256,options?:Page&{category?:string;duplicates?:boolean}):Promise<NativeRecord>;
 rows(run_id:Sha256,options?:Page&{side?:'source'|'target';status?:string;group_id?:number}):Promise<NativeRecord>;
 row(run_id:Sha256,side:'source'|'target',row:number):Promise<NativeRecord>;
 decisions(run_id:Sha256,options?:Page):Promise<NativeRecord>;
 decide(request:{request_id:RequestId;run_id:Sha256;expected_revision:number;subject:NativeRecord;
  outcome:'OPEN'|'ACCEPTED_DIFFERENCE'|'REQUIRES_CORRECTION'|'DEFERRED';actor:string;reason:string}):Promise<NativeRecord>;
 reports(options?:Page&{run_id?:Sha256}):Promise<NativeRecord>;report(report_id:Sha256):Promise<NativeRecord>;
 saveReport(request:{request_id:RequestId;run_id:Sha256;expected_revision:number;before_run_id?:Sha256}):Promise<NativeRecord>;
 changes(report_id:Sha256,options?:Page):Promise<NativeRecord>;
 operations(options?:Page):Promise<NativeRecord>;request(request_id:RequestId):Promise<NativeRecord>;
 resume(request_id:RequestId):Promise<NativeRecord>;
 exportReport(request:{request_id:RequestId;report_id:Sha256}):Promise<NativeRecord>;
 exportRequest(request_id:RequestId):Promise<NativeRecord>;resumeExport(request_id:RequestId):Promise<NativeRecord>;
 inspectExport(exportId:Sha256):Promise<NativeRecord>;
 download(options:{exportId:Sha256;directory:string;expectedManifestSha256?:Sha256;chunkSize?:number;
  signal?:AbortSignal;onProgress?:(record:NativeRecord)=>void|Promise<void>}):Promise<NativeRecord>;
 close():Promise<void>;
}
export interface TimescaleIntakeClient {
 workspace:string;workspaceId:WorkspaceId;endpoint:string;reconciliation:ReconciliationClient;
 status():Promise<NativeRecord>;registeredReports(options?:Page):Promise<NativeRecord>;
 reports(options?:Page):Promise<NativeRecord>;report(report_id:Sha256):Promise<ReportRecord>;
 source(report_id:Sha256,source_id:SourceId,options?:SourcePage):Promise<NativeRecord>;
 retain(request:RetainInput):Promise<ReportRecord>;review(request:ReviewInput):Promise<NativeRecord>;
 import(request:{request_id:RequestId;review_id:Sha256}):Promise<NativeRecord>;
 reviews(options?:Page):Promise<NativeRecord>;operations(options?:Page):Promise<NativeRecord>;
 request(request_id:RequestId):Promise<NativeRecord>;resume(request_id:RequestId):Promise<NativeRecord>;
 reviewPair(definition:PairDefinition):Promise<NativeRecord>;savePair(request:PairSaveInput):Promise<NativeRecord>;
 inspectReport(reportId:Sha256):Promise<{manifest:IntakeManifest;manifestSha256:Sha256}>;
 downloadReport(options:DownloadOptions):Promise<NativeRecord>;close():Promise<void>;
}
export declare function parseTimescaleIntakeManifest(bytes:Uint8Array,reportId:Sha256):IntakeManifest;
export declare function openDuckDBTimescaleClient(options:ClientOptions):Promise<TimescaleIntakeClient>;
