/// <reference types="node" />
/** MIT. The original OpenSanctions HTTP console; original JSON bytes stay in raw. */
export const CLIENT_SCHEMA: 'stellar-forge.source-monitoring-client.v1';
export const DOMAIN_SCHEMA: 'starforge.opensanctions-workspace.v1';
export const STARTUP_SCHEMA: 'stellar-forge.opensanctions-workspace-launch.v1';
export type ReadOperation = 'state' | 'contract' | 'entity' | 'entities' | 'aliases' |
  'changes' | 'impacts' | 'case' | 'statements' | 'response' | 'request' | 'update-plan' |
  'review-exchanges' | 'review-exchange' | 'review-exchange-request' | 'review-exchange-compare' |
  'cycles' | 'cycle' | 'cycle-request' | 'cycle-report' | 'gleif-intake' | 'portfolio-cycle-reviews' | 'portfolio-refreshes' | 'portfolio-refresh' | 'portfolio-refresh-request' | 'portfolio-refresh-report';
export type WriteOperation = 'review-exchange-issue' | 'review-exchange-command' | 'review-exchange-return-preview' | 'published-edition' | 'edition' | 'portfolio' | 'statement-set' |
  'compare' | 'update' | 'fetch-update' | 'select-update' | 'review' | 'case' | 'profile' |
  'prepare' | 'dispatch' | 'receive-response' | 'query' | 'cycle-command' | 'gleif-preview' | 'gleif-receive' | 'portfolio-refresh-prepare' | 'portfolio-refresh-command';
export const GET_OPERATIONS: readonly ReadOperation[];
export const POST_OPERATIONS: readonly WriteOperation[];
export type JsonObject = { [key: string]: unknown };
export type JsonInput = JsonObject | string | Uint8Array;
export type Query = { [key: string]: string | boolean | number };
export interface NativeReply<T = JsonObject> {
  json: T;
  /** Exact complete response bytes. Use these when numeric token spelling matters. */
  raw: Buffer;
  status: number;
  headers: import('node:http').IncomingHttpHeaders;
  sha256: string;
}
export interface NativeIdentity {
  schema: typeof STARTUP_SCHEMA;
  domainSchema: typeof DOMAIN_SCHEMA;
  workspace: string;
  bindingSha256: string;
  nativeBindingSha256: string;
  sourceRoot: string;
  python: { executable: string; version: number[] };
  pid: number;
}
export interface FileReceiving {
  path: string;
  bytes: number;
  sha256: string;
  reused: boolean;
  kind?: 'workspace' | 'object' | 'source' | 'review-exchange';
  role?: 'issued_json' | 'issued_html' | 'returned_file';
  id?: string;
}
export interface OriginalObject {
  id: string;
  bytes: number;
  name: string;
  media: string;
  provenance: JsonObject;
  receivedAt: number;
}
export class MonitoringError extends Error {
  code: string;
  detail: JsonObject;
  constructor(code: string, message: string, detail?: JsonObject);
  toJSON(): JsonObject;
}
export function readJsonInput(filename: string): Promise<Buffer>;
export function writeReply(filename: string, reply: { raw: Uint8Array }): Promise<FileReceiving>;
export interface ClientOptions {
  connectionFile: string;
  timeoutMs?: number;
  expectedWorkspace?: string;
  expectedBindingSha256?: string;
}
export class MonitoringClient {
  constructor(options: ClientOptions);
  readonly identity: NativeIdentity | null;
  readonly closed: boolean;
  inspect(): Promise<NativeIdentity>;
  get<T = JsonObject>(operation: ReadOperation, parameters?: Query): Promise<NativeReply<T>>;
  /** JSON text/Uint8Array inputs are sent byte-for-byte after structural validation. */
  post<T = JsonObject>(operation: WriteOperation, input: JsonInput): Promise<NativeReply<T>>;
  upload(filename: string, options?: {
    name?: string; media?: string; sourceUrl?: string;
  }): Promise<NativeReply<OriginalObject>>;
  receiveArchive(filename: string): Promise<NativeReply>;
  receiveEdition(selection: {
    metadataFile: string; entitiesFile: string; metadataUrl: string;
    label?: string; entitlement?: JsonObject;
  }): Promise<NativeReply>;
  receivePortfolio(selection: { file: string; key: string; label: string }): Promise<NativeReply>;
  receiveStatements(selection: {
    file: string; edition: string; sourceUrl: string; name?: string;
    complete?: boolean; scope?: JsonObject;
  }): Promise<NativeReply>;
  receiveUpdate(selection: {
    before: string; after: string; indexFile: string; indexUrl?: string;
    deltas: Array<{ version: string; file: string; sourceUrl?: string }>;
  }): Promise<NativeReply>;
  receiveResponse(selection: {
    id: string; file: string; status: number; sourceNote: string;
    expected: string; headers?: JsonObject;
  }): Promise<NativeReply>;
  download(kind: 'workspace' | 'object' | 'source' | 'review-exchange', selection: {
    id?: string; output: string; role?: 'issued_json' | 'issued_html' | 'returned_file'; expectedSha256?: string;
  }): Promise<FileReceiving>;
  /** Close this client and finish cleanup; original server operations remain retained. */
  close(): Promise<void>;
}
