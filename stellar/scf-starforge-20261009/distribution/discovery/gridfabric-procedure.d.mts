import type { OperatingPlan } from './operating-plan.mjs';
export declare const GRIDFABRIC_PROCEDURE_INPUT_SCHEMA: 'stellar-forge.gridfabric-procedure-input.v1';
export declare const GRIDFABRIC_PROCEDURE_CAPTURE_SCHEMA: 'stellar-forge.gridfabric-procedure-capture.v1';
export type GridFabricProcedureStep = 'workspace'|'configuration'|'sources'|'mappings'|'callbacks'|'events'|'dispatch'|'reports'|'delivery';
export declare const GRIDFABRIC_PROCEDURE_STEPS: readonly GridFabricProcedureStep[];
export interface GridFabricProcedureWorkspace { workspace_id:string; workspace_directory:string; source_sha256:string; }
export interface GridFabricProcedureInput {
  schema: typeof GRIDFABRIC_PROCEDURE_INPUT_SCHEMA;
  id:string; title:string; customer?:string; period?:string; owner?:string; purpose?:string; notes?:string; receiving?:string;
  workspace:GridFabricProcedureWorkspace; expectedRevision:number; instanceId:string;
  records?:Array<{stepId:GridFabricProcedureStep; collection:string; id:string}>;
  files?:Array<{stepId:GridFabricProcedureStep; fileId:string}>;
  stepResults?:Array<{stepId:GridFabricProcedureStep; status:'planned'|'in-progress'|'completed'|'skipped'; note:string}>;
}
export interface GridFabricProcedureCaptureMember { stepId:GridFabricProcedureStep; path:string; bytes:number; sha256:string; }
export interface GridFabricProcedureCapture {
  schema: typeof GRIDFABRIC_PROCEDURE_CAPTURE_SCHEMA;
  workspace:GridFabricProcedureWorkspace; revision:number; capturedAt:string; instanceId:string; input:GridFabricProcedureInput;
  records:Array<GridFabricProcedureCaptureMember & {collection:string; id:string; record:Record<string,unknown>}>;
  files:Array<GridFabricProcedureCaptureMember & {fileId:string; name?:string}>;
  [key:string]:unknown;
}
export declare function inspectGridFabricProcedureInput(input:unknown):GridFabricProcedureInput & {
  customer:string;period:string;owner:string;purpose:string;notes:string;receiving:string;
  records:NonNullable<GridFabricProcedureInput['records']>;files:NonNullable<GridFabricProcedureInput['files']>;
  stepResults:NonNullable<GridFabricProcedureInput['stepResults']>;
};
export declare function prepareGridFabricProcedure(options:{
  catalog:unknown;input:GridFabricProcedureInput;savedAt?:string;
}):OperatingPlan;
export declare function recordGridFabricProcedure(plan:OperatingPlan,capture:GridFabricProcedureCapture,
  options:{input:GridFabricProcedureInput;savedAt?:string}):OperatingPlan;
