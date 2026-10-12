// MIT. OData uses the original SF82 release store and generation numbers.
import type { ChildProcess } from 'node:child_process';
import type { ODataWorkspace } from './workspace.mjs';
import type { ODataDatasetDescription, ODataEnvironment } from './types.mjs';
export interface ODataReleaseRuntime {
  port?: number; facilitator?: string; allowLocalFacilitator?: boolean;
  handlers?: string; allowLoopbackUpstream?: boolean;
}
export interface ODataRelease {
  id: string; label: string; createdAt: string; digest: string; publicOrigin: string;
  mode: 'CHALLENGE_ONLY' | 'NATIVE_X402'; runtime: ODataReleaseRuntime;
  routes: Array<Record<string, unknown>>; source: Record<string, unknown>;
  handlerEntry: string | null; [nativeDetail: string]: unknown;
}
export interface ODataReleaseState {
  schema: string; generation: number; active: string | null; previous: string | null;
  history: Array<Record<string, unknown>>; [nativeDetail: string]: unknown;
}
export interface ODataReleaseStatus {
  schema: 'stellar-forge.seller-release-status.v1'; root: string; state: ODataReleaseState;
  releases: ODataRelease[]; errors: Array<Record<string, unknown>>;
  runtime: { state: 'STOPPED' | 'STARTING' | 'OTHER_HOST' | 'ORPHANED' | 'UNAVAILABLE' | 'RUNNING' | 'RESTART_REQUIRED';
    observed: unknown; managerAlive?: boolean; childAlive?: boolean; message?: string };
}
export interface ODataReleaseSession {
  release: ODataRelease; url: string; mode: 'CHALLENGE_ONLY' | 'NATIVE_X402'; child: ChildProcess;
  observation: Record<string, unknown>; operations: Record<string, unknown> | null;
  close(): Promise<{ forced: boolean; exitCode: number | null; exitSignal: NodeJS.Signals | null }>;
  completion: Promise<unknown>;
}
export interface ODataPublisher {
  directory: string; releases: string;
  prepare(input: { exportId: string; releaseId: string; label?: string; runtime?: ODataReleaseRuntime }): Promise<{
    exportId: string; releaseId: string; packageDirectory: string; datasetDirectory: string;
    dataset: ODataDatasetDescription; staged: ODataRelease;
  }>;
  status(): Promise<ODataReleaseStatus>;
  activate(input: { id: string; expectedGeneration: number; reason?: string }): Promise<{ changed: boolean; state: ODataReleaseState }>;
  rollback(input: { to?: string; expectedGeneration: number; reason?: string }): Promise<{ changed: boolean; state: ODataReleaseState }>;
  run(options?: { expectedGeneration?: number; startupTimeoutMs?: number; shutdownGraceMs?: number;
    handleSignals?: boolean; operationsNavigationOrigin?: string; receivingReview?: Record<string, unknown>;
    env?: ODataEnvironment }): Promise<ODataReleaseSession>;
}
export declare function openODataPublisher(options: { workspace: ODataWorkspace }): Promise<ODataPublisher>;
