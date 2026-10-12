// MIT. The original retained operator, without a parallel state model.
import type { Buffer } from 'node:buffer';
import type { ODataWorkspaceState, ODataConnection, ODataSavedPlan, ODataQueryPlan, ODataEdition,
  ODataEditionSummary, ODataRow, ODataReview, ODataComparison, ODataExport, ODataTransfer,
  ODataFieldValue, ODataLiveProfile, ODataDatasetPayment, ODataDatasetResponse } from './types.mjs';
export type * from './types.mjs';
export interface ODataWorkspace {
  readonly directory: string;
  state(): Promise<ODataWorkspaceState>;
  connect(input: { url: string; id?: string; name?: string; authEnv?: string; signal?: AbortSignal; allowLoopback?: boolean }): Promise<ODataConnection>;
  refreshConnection(id: string): Promise<ODataConnection>;
  plan(input: { connectionId: string; query: ODataQueryPlan; id?: string; name?: string }): Promise<ODataSavedPlan>;
  reviewPlan(input: { id: string; note: string }): Promise<ODataSavedPlan>;
  startCapture(input: { id?: string; planId: string; label?: string }): Promise<ODataEditionSummary>;
  capture(id: string, options?: { pageBudget?: number; signal?: AbortSignal }): Promise<ODataEditionSummary>;
  pause(id: string): Promise<ODataEditionSummary>;
  edition(id: string): Promise<ODataEdition>;
  rows(id: string): Promise<ODataRow[]>;
  reviewEdition(input: { id: string; decision: 'accept' | 'needs-work'; note: string }): Promise<ODataReview>;
  compare(beforeId: string, afterId: string): Promise<ODataComparison>;
  exportEdition(input: { id: string; name?: string; fields?: string[]; payment?: ODataDatasetPayment;
    origin?: string; path?: string; defaultLimit?: number; maxLimit?: number }): Promise<ODataExport>;
  queryExport(input: { id: string; query?: string }): Promise<ODataDatasetResponse>;
  recordLiveProduct(record: ODataLiveProfile): Promise<ODataLiveProfile>;
  backup(): Promise<ODataTransfer>;
  restore(bundle: ODataTransfer): Promise<{ connections: number; editions: number; exports: number; liveProducts: number }>;
  raw(sha256: string): Promise<Buffer>;
  /** Aborts imports, waits for their current operation, and settles original state. */
  close(): Promise<void>;
}
export declare function openODataWorkspace(options: { directory: string; fetchImpl?: typeof globalThis.fetch }): Promise<ODataWorkspace>;
export declare function fieldValue(row: ODataRow, path: string): ODataFieldValue;
export declare function rowKey(row: ODataRow, keyFields: string[]): string;
