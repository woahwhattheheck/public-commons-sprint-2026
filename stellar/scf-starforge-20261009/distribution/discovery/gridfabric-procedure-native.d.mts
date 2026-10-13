import type {OperatingPlan} from './operating-plan.mjs';
import type {GridFabricProcedureInput,GridFabricProcedureWorkspace,GridFabricProcedureCapture,
  GridFabricProcedureStep} from './gridfabric-procedure.mjs';

export declare const GRIDFABRIC_PROCEDURE_CAPTURE_SCHEMA: 'stellar-forge.gridfabric-procedure-capture.v1';
export declare class GridFabricProcedureCaptureError extends Error {
  code:string; details:Record<string,unknown>; captureDirectory?:string;
  constructor(code:string,message:string,details?:Record<string,unknown>);
}
export interface GridFabricProcedureOriginalResponse {
  value:Record<string,unknown>; raw_text:string; workspace_id:string;
  http_status?:number; headers?:unknown; raw_headers?:unknown;
}
export interface GridFabricProcedureFileInfo {
  workspace_id:string; file_id:string; native_file_id:string; kind:'file'|'export';
  name:string; content_type:string; bytes:number; sha256:string; [key:string]:unknown;
}
/** The caller retains ownership. Capture neither opens nor closes this borrower. */
export interface GridFabricProcedureReadClient {
  readonly identity:GridFabricProcedureWorkspace & Record<string,unknown>;
  callRaw(operation:string,payload?:Record<string,unknown>):Promise<GridFabricProcedureOriginalResponse>;
  fileInfo(fileId:string):Promise<GridFabricProcedureFileInfo>;
  readFile(fileId:string,options:{offset:number;limit:number;expectedSha256:string}):Promise<Uint8Array>;
}
export interface GridFabricProcedureMember {path:string;bytes:number;sha256:string;}
export interface GridFabricProcedureRead extends GridFabricProcedureMember {
  operation:'launch'|'state'|'source'|'contracts'|'page'|'detail';
  payload:Record<string,unknown>;metadata:GridFabricProcedureMember;
}
export interface GridFabricProcedureNativeCapture extends GridFabricProcedureCapture {
  input_sha256:string; inputFile:GridFabricProcedureMember; catalogFile:GridFabricProcedureMember;
  previousPlan:GridFabricProcedureMember;plan:GridFabricProcedureMember;html:GridFabricProcedureMember;markdown:GridFabricProcedureMember;
  members:GridFabricProcedureMember[];
  records:Array<GridFabricProcedureRead & {
    stepId:GridFabricProcedureStep;collection:string;id:string;record:Record<string,unknown>;pageRowId?:string;
    origin:'selected'|'dependency';selectedBy:string[];
  }>;
  files:Array<GridFabricProcedureMember & {
    stepId:GridFabricProcedureStep;fileId:string;name:string;content_type:string;
    origin:'selected'|'dependency';selectedBy:string[];descriptors:Record<string,unknown>[];
    metadata:GridFabricProcedureMember;
  }>;
  responses:GridFabricProcedureRead[];
  pages:Array<{stepId:GridFabricProcedureStep;selectedBy:string;collection:string;scope:string;total:number;
    rows:string[];responses:GridFabricProcedureRead[]}>;
  source:{
    identity:{schema:string;node?:string;sha256:string;modules:Array<{path:string;bytes:number;sha256:string}>};
    response:GridFabricProcedureRead;contracts:GridFabricProcedureRead;
    members:Array<GridFabricProcedureMember & {module:string}>;
    helpers:Array<GridFabricProcedureMember & {module:string}>;
  };
  observations:{beforeLaunch:GridFabricProcedureRead;beforeState:GridFabricProcedureRead;
    afterState:GridFabricProcedureRead;afterLaunch:GridFabricProcedureRead};
}
export interface GridFabricProcedureCaptureReceipt extends GridFabricProcedureMember {
  schema:'stellar-forge.gridfabric-procedure-capture-receipt.v1';
  directory:string;workspace:GridFabricProcedureWorkspace;revision:number;
}
export interface GridFabricProcedureCaptureResult {
  directory:string;plan:OperatingPlan;capture:GridFabricProcedureNativeCapture;
  input:GridFabricProcedureInput;catalog:unknown;receipt:GridFabricProcedureCaptureReceipt;
}
/**
 * Reserve a new private output directory; publish capture.json last and exclusively.
 * Requires the selected installed source to match the existing live operator source.
 * Failure retains the incomplete output and does not close or mutate the client.
 */
export declare function captureGridFabricProcedure(options:{
  client:GridFabricProcedureReadClient;catalog:unknown;input:GridFabricProcedureInput;
  outputDirectory:string;savedAt?:string;plan?:OperatingPlan;
}):Promise<GridFabricProcedureCaptureResult>;
/** Validate complete frozen members, dependencies and original full plan history offline. */
export declare function readGridFabricProcedureCapture(directory:string|{directory:string}):Promise<GridFabricProcedureCaptureResult>;
