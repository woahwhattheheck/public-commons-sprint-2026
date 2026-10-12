import type { IncomingMessage } from 'node:http';
import type { CheckoutEntry, JobCheckout, WorkspaceOptions } from '../index.mjs';

export type IntakePhase = 'DRAFT' | 'READY' | 'IMPORTED' | 'RECOVERABLE' | 'WITHDRAWN';
export interface IntakePayment {
  scheme: string; network: string; asset: string; payTo: string; amount: string;
  maxTimeoutSeconds?: number; extra?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface IntakeFunction {
  id: string; description: string; inputSchema: Record<string, unknown>;
  example: Record<string, unknown>; maxInputBytes: number; maxOutputBytes: number; timeoutMs: number;
  output: {format: 'json' | 'bytes'; contentType: string; filename: string};
  payment: IntakePayment; purchaseUrl: string; functionSha256: string;
}
export interface IntakeCatalog {
  schema: 'stellar-forge.job-intake-catalog.v1'; publicOrigin: string; serviceName: string;
  authentication: 'none' | 'access-token'; requestUrl: string; withdrawalUrl: string;
  functions: IntakeFunction[]; catalogSha256: string;
}
export interface IntakeTask {
  id: string; kind: 'prepare' | 'import' | 'withdraw';
  state: 'RUNNING' | 'CANCELLING' | 'COMPLETE' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';
  startedAt: string; completedAt: string | null; error: string | null;
}
export interface IntakeEntry {
  id: string; reference: string; label: string; revision: number; phase: IntakePhase;
  createdAt: string; updatedAt: string;
  merchant: {
    origin: string; serviceName: string; catalogSha256: string; functionId: string;
    functionSha256: string; authentication: IntakeCatalog['authentication'];
  };
  payment: IntakePayment; inputSha256: string; requestSha256: string;
  requestAttempts: number; withdrawalAttempts: number;
  hasAccessToken: boolean; hasTicket: boolean; handoffSha256: string | null; responseSha256: string | null;
  checkoutId: string | null; checkout: CheckoutEntry | {id: string; error: string} | null;
  lastError: string | null; task: IntakeTask | null;
  actions: {prepare: boolean; import: boolean; withdraw: boolean; stop: boolean};
}
export interface IntakeDetail extends IntakeEntry {
  input: Record<string, unknown>; function: IntakeFunction;
  history: Array<{at: string; action: string; revision: number; previousRevision?: number; [key: string]: unknown}>;
}
export interface IntakeStatus {
  schema: 'stellar-forge.sf88.job-intake.v1'; directory: string; requests: number;
  closing: boolean; capacity: number; active: Array<IntakeTask & {requestId: string}>;
}
export interface IntakeList {
  q?: string; phase?: '' | IntakePhase; offset?: number; limit?: number;
}
export interface JobIntake {
  readonly directory: string;
  discover(options: {origin: string; signal?: AbortSignal}): Promise<IntakeCatalog>;
  draft(options: {
    catalog: IntakeCatalog; functionId: string; input: Record<string, unknown>; label?: string;
    reference?: string; accessToken?: string | null;
  }): Promise<{request: IntakeEntry; reused: boolean}>;
  start(id: string, options: {
    kind?: IntakeTask['kind']; expectedRevision: number; reason?: string;
  }): Promise<IntakeEntry>;
  cancel(id: string): Promise<IntakeEntry>;
  setAccess(id: string, options: {expectedRevision: number; accessToken: string | null}): Promise<IntakeEntry>;
  get(id: string): Promise<IntakeDetail>;
  list(options?: IntakeList): {total: number; offset: number; limit: number; items: IntakeEntry[]};
  ticket(id: string): Promise<Buffer>;
  wait(id: string): Promise<IntakeDetail>;
  status(): IntakeStatus;
  close(): Promise<void>;
}
export interface IntakeOptions {
  directory: string; lease: {assertHeld(): void}; checkout: JobCheckout;
  transport?: WorkspaceOptions['transport']; fetchImpl?: typeof fetch;
  requestTimeoutMs?: number; maxConcurrent?: number;
}
export function openJobIntake(options: IntakeOptions): Promise<JobIntake>;
export function jobIntakeExtension(intake: JobIntake): Promise<{
  additionalAssets: Array<{route: string; type: string; bytes: Buffer}>;
  authenticatedRoute(options: {
    request: IncomingMessage; url: URL; send(value: unknown, status?: number): void;
    body(maximum?: number): Promise<any>;
  }): Promise<boolean>;
}>;
export const JOB_INTAKE_SCHEMA: 'stellar-forge.sf88.job-intake.v1';
export const JOB_INTAKE_PHASES: IntakePhase[];
