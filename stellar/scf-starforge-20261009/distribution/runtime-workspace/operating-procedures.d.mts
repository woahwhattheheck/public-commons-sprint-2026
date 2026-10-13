import type { OperatingPlan, OperatingPlanDraft, OperatingPlanSummary, OperatingStepState } from '../discovery/operating-plan.mjs';
import type { OperatingPlanReturn, OperatingReturnComparison, OperatingReturnChoice, OperatingReturnJSON } from '../discovery/operating-plan-return.mjs';
export const RUNTIME_PROCEDURE_SCHEMA: 'stellar-forge.runtime-operating-procedure.v1';
export const RUNTIME_CAPTURE_SCHEMA: 'stellar-forge.runtime-operating-capture.v1';
export const RUNTIME_PROCEDURE_MAX_BYTES: number;
export const RUNTIME_PROCEDURE_BODY_MAX_BYTES: number;
export interface RuntimeProcedureSelection {
  runtimeIds?: string[]; operationIds?: string[]; archiveIds?: string[];
  backupOperationIds?: string[]; storageDirectory?: string;
}
export interface RuntimeProcedureCapture {
  id: string; stepId: string; fileId: string; capturedAt: string;
  sha256: string; bytes: number; selection: Required<Omit<RuntimeProcedureSelection,'storageDirectory'>> & {storageDirectory?:string};
}
export interface RuntimeProcedureRequest {
  requestId: string; inputSha256: string; at: string; action: string; revision: number;
}
export interface RuntimeProcedure {
  schema: typeof RUNTIME_PROCEDURE_SCHEMA; id: string; workspaceId: string; createdAt: string;
  revision: number; plan: OperatingPlan; captures: RuntimeProcedureCapture[];
  returnReviews: OperatingPlanReturn[]; requests: RuntimeProcedureRequest[];
}
export interface RuntimeProcedureView {
  record: RuntimeProcedure; recordSha256: string; reused: boolean;
  returnComparisons: Array<{reviewId:string;comparison:OperatingReturnComparison}>;
}
export interface RuntimeProcedureWrite { requestId:string; procedureId:string; expectedSha256:string }
export interface RuntimeProcedureDownload { filename:string; mediaType:string; content:string; sha256:string; bytes:number }
export interface RuntimeProceduresAPI {
  runtimeProceduresState(options?: {storageDirectory?:string}): Promise<{
    workspaceId:string; procedures:Array<{id:string;recordSha256:string;recordRevision:number;plan:OperatingPlanSummary;captureCount:number;returnCount:number}>;
    source:{runtimes:unknown[];operations:unknown[];archives:unknown[];backups:{storageDirectory:string;receiving:unknown;operations:unknown[]}};
  }>;
  runtimeProcedureRead(input:{procedureId:string}):Promise<RuntimeProcedureView>;
  runtimeProcedureCreate(input:{requestId:string;title:string;customer?:string;owner?:string;period?:string;purpose?:string;selection?:RuntimeProcedureSelection}):Promise<RuntimeProcedureView>;
  runtimeProcedureSave(input:RuntimeProcedureWrite & {draft:OperatingPlanDraft}):Promise<RuntimeProcedureView>;
  runtimeProcedureRecord(input:RuntimeProcedureWrite & {stepId:string;status:OperatingStepState;recordedResult:string;owner:string;selection?:RuntimeProcedureSelection}):Promise<RuntimeProcedureView>;
  runtimeProcedureReturn(input:RuntimeProcedureWrite & {incoming:OperatingPlan;reviewer?:string;notes?:string}):Promise<RuntimeProcedureView>;
  runtimeProcedureDecide(input:RuntimeProcedureWrite & {reviewId:string;key:string;decision:{take:OperatingReturnChoice;value?:OperatingReturnJSON;note?:string}|null}):Promise<RuntimeProcedureView>;
  runtimeProcedureApply(input:RuntimeProcedureWrite & {reviewId:string}):Promise<RuntimeProcedureView>;
  runtimeProcedureReceive(input:{requestId:string;document:RuntimeProcedure}):Promise<RuntimeProcedureView>;
  runtimeProcedureExport(input:{procedureId:string;format:'json'|'html'|'plan-json'|'plan-html';reviewId?:string}):Promise<RuntimeProcedureDownload>;
}
export function inspectRuntimeProcedure(input:unknown):RuntimeProcedure;
export function createRuntimeProceduresAPI(root:string,workspaceId:string,getModel:()=>unknown):RuntimeProceduresAPI;
