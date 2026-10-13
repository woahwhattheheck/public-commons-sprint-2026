import type {GridFabricProcedureCaptureResult,GridFabricProcedureCaptureReceipt} from './gridfabric-procedure-native.mjs';
export declare const GRID_COMPARISON_SCHEMA:'stellar-forge.gridfabric-procedure-comparison.v1';
export interface GridCaptureComparisonSelection {beforeReportId?:string|null;afterReportId?:string|null;}
export interface GridCaptureComparisonRow {
  id:string;reportSpecifierId:string;rId:string;timestamp:number;
  presence:'both'|'before_only'|'after_only';
  before:Record<string,unknown>|null;after:Record<string,unknown>|null;
  beforeSemantics:Record<string,unknown>|null;afterSemantics:Record<string,unknown>|null;
  beforeValue:unknown;afterValue:unknown;difference:string|null;differenceUnit:string|null;reason:string|null;
  outcome:string;valueChanged:boolean;parametersChanged:boolean;qualityChanged:boolean;calculationChanged:boolean;changed:boolean;
}
export type GridComparisonSide=Pick<GridFabricProcedureCaptureResult,'input'|'plan'|'capture'|'catalog'> & {receipt:Omit<GridFabricProcedureCaptureReceipt,'directory'>};
export interface GridCaptureComparison {
  schema:typeof GRID_COMPARISON_SCHEMA;selection:GridCaptureComparisonSelection;
  before:GridComparisonSide;after:GridComparisonSide;
  reports:{before:Record<string,unknown>|null;after:Record<string,unknown>|null};
  intervals:GridCaptureComparisonRow[];outcomes:Array<Record<string,unknown>>;plan:Record<string,unknown>;
  sourceChanges:Array<Record<string,unknown>>;fileChanges:Array<Record<string,unknown>>;
  scope:Record<string,unknown>;
  summary:{intervals:number;matched:number;changed:number;sourceResolved:number;sourceNeeded:number;incompatible:number;selectedOnly:number;outcomeChanges:number;planStepChanges:number};
}
/** Subtract already-rounded original decimal results exactly; no measurement calculation or unit conversion. */
export declare function gridDecimalDifference(before:string,after:string):string;
/** Caller must first receive both complete originals with readGridFabricProcedureCapture. No native mutation. */
export declare function compareGridFabricCaptures(before:GridFabricProcedureCaptureResult,after:GridFabricProcedureCaptureResult,selection?:GridCaptureComparisonSelection):GridCaptureComparison;
/** Re-derive the whole report from the two validated originals and require complete exact equality. */
export declare function receiveGridFabricComparison(value:unknown,before:GridFabricProcedureCaptureResult,after:GridFabricProcedureCaptureResult):GridCaptureComparison;
export declare function renderGridFabricComparisonHTML(value:GridCaptureComparison):string;
