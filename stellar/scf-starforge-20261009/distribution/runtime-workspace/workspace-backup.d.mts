// SPDX-License-Identifier: MIT
import type {Readable} from 'node:stream';
export interface BackupStorage {storageDirectory?: string}
export type Sha256 = string;
export type RequestId = string;
export interface ExternalBinding {
  path: string; roles: string[]; locations: string[];
  expected: Array<Record<string,string>>;
  status?: 'PRESENT'|'MISSING'|'SOURCE_MISMATCH'|'UNAVAILABLE'|'HISTORICAL_REFERENCE';
  sourceVerified?: boolean;
  error?: {code:string|number|null;message:string};
}
export interface BackupReview {
  reviewId:RequestId;reviewSha256:Sha256;workspaceId:string;directory:string;
  runtimeHome:string;sourceDirectory?:string;createdAt:string;label:string;
  files:number;directories:number;links:number;bytes:number;inventorySha256:Sha256;
  externalBindings:ExternalBinding[];externalBindingDiscovery?:{parsedJsonFiles:number;unscannedJsonFiles:Array<{path:string;bytes:number;reason:string}>;externalTreesCopied:false};excluded:Array<{path:string;reason:string}>;
}
export interface BackupInspection {
  archiveId:Sha256;sha256:Sha256;bytes:number;manifestSha256:Sha256;
  archivePath:string;review:BackupReview;inspectedAt:string;
}
export interface ReceivingResult {
  receivingId:RequestId;directory:string;workspaceId:string;
  phase:'BINDINGS_REVIEW_REQUIRED'|'BINDINGS_REVIEWED';
  restoredFiles?:number;bindings?:ExternalBinding[];launchesStarted:0;
  sourceReadiness?:'REQUIRES_ORIGINAL_NATIVE_REVIEW';
}
export interface BackupOperation {
  schema:'stellar-forge.runtime-workspace-backup-operation.v1';
  operationId:RequestId;kind:'EXPORT'|'RESTORE';
  phase:'QUEUED'|'RUNNING'|'COMPLETE'|'FAILED'|'INTERRUPTED';
  recordedPhase?:string;root:string;storageDirectory:string;
  input:BackupCreateInput|BackupRestoreInput;createdAt:string;updatedAt:string;
  attempt:number;workerActive?:boolean|null;restoredFiles?:number;restoringPath?:string;
  worker?:{pid:number;processStart:unknown;startedAt:string};
  child?:{pid:number;procPid?:number;processStart?:string;pidNamespace?:string;startedAt:string};
  observation?:{status:'UNAVAILABLE';error:{code:string;message:string}};
  error?:{code:string;message:string}|null;
  receiving?:{available:boolean;phase?:'RESTORING'|'BINDINGS_REVIEW_REQUIRED'|'BINDINGS_REVIEWED';directory?:string;workspaceId?:string;status?:'MISSING'|'UNAVAILABLE';error?:{code:string;message:string}};
  result?:ReceivingResult|(BackupInspection&{filename:string});
}
export interface BackupUpload {
  uploadId:RequestId;requestId:RequestId;sha256:Sha256;bytes:number;receivedBytes:number;
  complete:boolean;archivePath:string|null;createdAt:string;completedAt?:string;
}
export interface CurrentHostBindings {
  runtimeHome:string;runtimes:Array<{runtimeId:string;directory:string}>;actor:string;note:string;
}
export interface ReceivedRuntimeEntry {
  runtimeId:string;label:string;originalDirectory:string;sourceDirectory:string;directory:string|null;
  expected:Record<string,string>;status:'UNBOUND'|'PRESENT'|'SOURCE_MISMATCH';sourceVerified:boolean;
  source?:Record<string,string|null>;comparisons?:Record<string,{expected:string;actual:string|null}>;
  error?:{code:string|number|null;message:string};
}
export interface BindingReview {
  reviewId:RequestId;reviewSha256:Sha256;receivingId:RequestId;directory:string;
  workspaceId:string;checkedAt:string;manifestSha256:Sha256;
  canOpen:boolean;runtimeHomeReady:boolean;bindings:ExternalBinding[];
  mode?:'new-host';originalDirectory?:string;sourceDirectory?:string;hostBindings?:CurrentHostBindings|null;
  runtimeEntries?:ReceivedRuntimeEntry[];importedOperationCount?:number;
  sourceReadiness:'REQUIRES_ORIGINAL_NATIVE_REVIEW';
}
export interface BackupCreateInput extends BackupStorage {
  requestId:RequestId;reviewId:RequestId;reviewSha256:Sha256;
}
export interface BackupRestoreInput extends BackupStorage {
  requestId:RequestId;archiveId:Sha256;manifestSha256:Sha256;directory:string;mode?:'original'|'new-host';
}
export interface WorkspaceBackupAPI {
  workspaceBackupState(input?:BackupStorage):Promise<{
    workspaceId:string;directory:string;storageDirectory:string;receiving:unknown|null;
    reviews:BackupReview[];operations:BackupOperation[];uploads:BackupUpload[];inspections:BackupInspection[];
  }>;
  workspaceBackupReview(input:BackupStorage&{requestId:RequestId;label:string}):Promise<BackupReview>;
  workspaceBackupCreate(input:BackupCreateInput):Promise<BackupOperation>;
  workspaceBackupInspect(input:BackupStorage&{archivePath?:string;uploadId?:RequestId;sha256:Sha256}):Promise<BackupInspection>;
  workspaceBackupUpload(input:BackupStorage&{requestId:RequestId;sha256:Sha256;bytes:number;offset:number;body:AsyncIterable<Uint8Array>}):Promise<BackupUpload>;
  workspaceBackupRestore(input:BackupRestoreInput):Promise<BackupOperation>;
  workspaceBackupContinue(input:BackupStorage&{operationId:RequestId}):Promise<BackupOperation>;
  workspaceBackupDownload(input:BackupStorage&{archiveId:Sha256}):Promise<{stream:Readable;bytes:number;filename:string;sha256:Sha256;type:'application/gzip'}>;
  workspaceBackupBindings(input:BackupStorage&{receivingId:RequestId;hostBindings?:CurrentHostBindings}):Promise<BindingReview>;
  workspaceBackupOpen(input:BackupStorage&{receivingId:RequestId;reviewId:RequestId;reviewSha256:Sha256}):Promise<ReceivingResult>;
}
export declare function createWorkspaceBackupAPI(directory:string):WorkspaceBackupAPI;
