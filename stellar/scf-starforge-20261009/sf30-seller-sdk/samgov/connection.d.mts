/// <reference types="node" />
import type {BinaryLike} from 'node:crypto';
import type {SamWorkspaceView, SamProgress, SamFailure} from './workspace.mjs';

export const SAM_CONNECTION_SCHEMA: 'stellar-forge.samgov-live-connection.v1';
export const SAM_STARTUP_SCHEMA: 'stellar-forge.samgov-workspace-startup.v1';
export const SAM_CONNECTION_FILENAME: 'samgov.connection.json';
export const SAM_MAX_RESPONSE_BYTES: number;
export const SAM_MAX_CONTROL_BYTES: number;
export const SAM_HASH: RegExp;
export const SAM_UUID: RegExp;
export interface SamHostError extends Error {
  code: string; status: number; details?: unknown; data?: unknown;
}
export interface SamDirectoryIdentity {path: string; dev: string; ino: string}
export interface SamConnectionDocument {
  schema: typeof SAM_CONNECTION_SCHEMA;
  instanceId: string; directory: string; directoryIdentity: {dev: string; ino: string};
  workspaceId: string | null; operator: string; pid: number; startedAt: string;
  origin: string;
  /** Private original launch URL. The fragment is the native listener credential. */
  url: string;
  apiKeyEnv: string; endpoint: string; opportunityDirectory: string | null;
}
export interface SamConnection {
  path: string; sha256: string; value: SamConnectionDocument;
  /** Host-only credential derived from the original private launch URL. */
  token: string;
}
export interface SamConnectionView {
  instanceId: string; workspaceId: string | null; operator: string;
  startedAt: string; origin: string; pid: number;
}
export interface SamNativeTask {
  captureId: string; state: 'running' | 'completed' | 'failed'; startedAt: string;
  updatedAt: string; completedAt: string | null; progress: SamProgress | null;
  result: unknown; error: Pick<SamFailure, 'code' | 'message'> | null;
}
export interface SamNativeMerchantHost {
  publicationId: string; state: 'starting' | 'running' | 'failed' | 'closed';
  origin: string | null; startedAt: string; updatedAt: string; closedAt: string | null;
  error: {code: string; message: string} | null;
}
export interface SamListenerView {
  workspace: SamWorkspaceView; operator: string; date: string; source: 'SAM.gov';
  opportunityConfigured: boolean; tasks: SamNativeTask[]; merchantHosts: SamNativeMerchantHost[];
}
export interface SamPrivateSource {path: string; bytes: Buffer; sha256: string}
export interface SamPrivateJson<T = unknown> extends SamPrivateSource {value: T}
export interface SamRequestOptions {
  method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal;
  maximum?: number; fetchImpl?: typeof fetch; raw?: boolean;
}
export interface SamRawResponse {
  response: Response;
  /** Complete after the body is consumed or an error occurs; releases transport resources. */
  release(): Promise<void>;
}
export function samDigest(bytes: BinaryLike): string;
export function samPlain(value: unknown): value is Record<string, unknown>;
export function samFailure(code: string, message: string, status?: number, details?: unknown): SamHostError;
export function samNeed(value: unknown, code: string, message: string, status?: number): asserts value;
export function samExact(value: unknown, allowed: string[], required?: string[]): asserts value is Record<string, unknown>;
export function samAbsolute(value: unknown): string;
export function samPrivateDirectory(path: string): Promise<SamDirectoryIdentity>;
export function samReadPrivateFile(path: string, maximum?: number): Promise<SamPrivateSource>;
export function samParseJson<T = unknown>(bytes: Uint8Array): T;
export function samReadPrivateJson<T = unknown>(path: string, maximum?: number): Promise<SamPrivateJson<T>>;
export function samWritePrivateJson(path: string, value: unknown, options?: {replace?: boolean}):
  Promise<{path: string; sha256: string; bytes: number}>;
export function readSamConnection(path: string, options?: {directory?: string}): Promise<SamConnection>;
export function samConnectionView(connection: SamConnection): SamConnectionView;
export function samRequest(connection: SamConnection, path: string,
  options: SamRequestOptions & {raw: true}): Promise<SamRawResponse>;
export function samRequest<T = unknown>(connection: SamConnection, path: string,
  options?: SamRequestOptions & {raw?: false}): Promise<T>;
export function inspectSamListener(connection: SamConnection,
  options?: Omit<SamRequestOptions, 'raw' | 'method' | 'body'>): Promise<SamListenerView>;
