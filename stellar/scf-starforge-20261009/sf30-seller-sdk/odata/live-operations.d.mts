// MIT. The same original live controller used by the operator UI and CLI.
import type { Buffer } from 'node:buffer';
import type { ODataWorkspace } from './workspace.mjs';
import type { ODataEnvironment, ODataLiveProfile, ODataPayment } from './types.mjs';
import type { ODataNativeFactory, ODataLiveSnapshot, ODataNormalizedLivePlan, ODataLiveQuery,
  ODataBuyerHandoff, ODataLiveReceiving } from './live-sdk.mjs';
export interface ODataLiveRuntime {
  state: 'RUNNING'; mode: 'CHALLENGE_ONLY' | 'NATIVE_X402'; url: string; operationsUrl: string;
  startedAt: string; snapshot: ODataLiveSnapshot;
}
export interface ODataLiveStoppedRuntime {
  state: 'STOPPED'; mode: ODataLiveRuntime['mode']; startedAt: string; stoppedAt: string; snapshot: ODataLiveSnapshot;
}
export interface ODataLivePrepareInput {
  id: string; planId: string; origin: string; payment: ODataPayment; amount: string;
  name?: string; operation?: string; path?: string; maxPageRows?: number; maxTotalRows?: number;
  port?: number; operationsPort?: number; facilitator?: string;
}
export type ODataLiveReceivedRecord = Omit<ODataLiveReceiving, 'directory'> & { id: string; directory?: string };
export interface ODataLiveOperations {
  root: string;
  status(): Promise<{ products: Array<ODataLiveProfile & {
    runtime: ODataLiveRuntime | null; lastRuntime: ODataLiveRuntime | ODataLiveStoppedRuntime | null;
  }> }>;
  prepare(input: ODataLivePrepareInput): Promise<ODataLiveProfile>;
  start(input: { id: string }): Promise<ODataLiveRuntime>;
  stop(input: { id: string }): Promise<{ id: string; state: 'STOPPED' }>;
  buyer(input: { id: string; intentId: string; receivedId?: string }): Promise<ODataBuyerHandoff & { id: string; files: string[] }>;
  receive(input: { id: string; bodyBase64: string }): Promise<ODataLiveReceivedRecord & { files: string[] }>;
  file(input: { id: string; name: string; kind?: 'package'; recordId?: never } |
    { id: string; name: string; kind: 'buyer' | 'receiving'; recordId: string }): Promise<{ bytes: Buffer; name: string }>;
  detail(id: string): Promise<ODataLiveProfile & {
    plan: ODataNormalizedLivePlan; selection: { operation: string; request: ODataLiveQuery };
    runtime: ODataLiveRuntime | null; buyers: Array<ODataBuyerHandoff & { id: string }>;
    received: ODataLiveReceivedRecord[];
  }>;
  /** Settles controller writes and closes the merchant processes opened here. */
  close(): Promise<void>;
}
export declare function openODataLiveOperations(options: {
  workspace: ODataWorkspace; env?: ODataEnvironment; navigationOrigin?: string;
  nativeFactoryFor?: (facilitator: string) => ODataNativeFactory | Promise<ODataNativeFactory>;
}): Promise<ODataLiveOperations>;
