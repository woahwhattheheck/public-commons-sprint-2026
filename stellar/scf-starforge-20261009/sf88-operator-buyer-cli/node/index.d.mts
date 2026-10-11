export type JsonObject = { [key: string]: unknown };
export interface OperatorProfile {
  operator?: { python: string; actor: string; service: string; policy: string; ledger: string };
  signerModule?: string;
  trustedPayer?: string;
  bodyCaptureTimeoutMs?: number;
  buyerTransport?: { mode: 'explicit-connect'; origin: string; proxyUrl?: string; proxyEnv?: string };
}
export interface BuyerOptions {
  /** Absolute path to the original sf88-operator-buyer-cli directory. */
  runtimeDirectory: string;
  /** Private (0700 on POSIX), caller-owned directory. */
  stateDirectory: string;
  operatorProfile?: OperatorProfile | string;
  node?: string;
  environment?: Record<string, string | undefined>;
  timeoutMs?: number;
  cleanupGraceMs?: number;
  outputLimit?: number;
}
export interface NativeRequest {
  intentId: string;
  url: string;
  method?: string;
  expect: {
    scheme: string; network: string; asset: string; payTo: string; maxAtomic: string;
    maxTimeoutSeconds?: number; paymentFlow?: 'authorization';
  };
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
  orderReference?: string;
  ticketFile?: string;
  ticketHeader?: string;
  /** Functions cannot cross the native process boundary; use an operator profile. */
  approve?: unknown;
  sign?: unknown;
}
export interface ImportOptions { body?: string | Uint8Array; operatorProfile?: OperatorProfile | string }
export interface Review {
  readonly intentId: string;
  readonly configSha256: string;
  readonly bodySha256: string;
  readonly ticketSha256: string | null;
  readonly reviewedAt: string;
  readonly native: JsonObject;
}
export interface OperationStatus {
  intentId: string; directory: string; state: string;
  resultRecoverable: boolean; nativeStatus: unknown; deliveryStatus: string | null;
  retry: 'NO_AUTOMATIC_RETRY';
}
export interface NativeSummary extends JsonObject {
  mode: 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT';
  intentId: string;
  status: unknown;
  httpStatus: number | null;
  responseFile?: { status: string; path?: string; bytes?: number; sha256?: string; [key: string]: unknown };
}
export interface ResultRecord {
  readonly schema: string;
  readonly intentId: string;
  readonly configSha256: string;
  readonly native: NativeSummary;
  readonly exitCode: number | null;
  readonly exitSignal: string | null;
  readonly runtimeError: string | null;
  readonly recovered: boolean;
  readonly recordedAt: string;
}
export class BuyerError extends Error {
  readonly code: string;
  readonly operation?: Operation;
  readonly exitCode?: number | null;
  constructor(code: string, details?: Record<string, unknown>);
}
export class Buyer {
  readonly stateDirectory: string;
  constructor(options: BuyerOptions);
  ready(): Promise<this>;
  operation(intentId: string): Operation;
  fromConfig(input: string | JsonObject, options?: ImportOptions): Promise<Operation>;
  fromRequest(request: NativeRequest, options?: Omit<ImportOptions, 'body'>): Promise<Operation>;
  call(request: NativeRequest): Promise<BuyerResult>;
  discover(catalog: JsonObject, options?: { destination?: string; signal?: AbortSignal }): Promise<JsonObject>;
  prepare(input: {
    discoveryFile: string; row: number; accept: number; intentId: string; url: string;
    method?: string; headers?: Record<string, string>; body?: string | Uint8Array;
    operatorProfile?: OperatorProfile | string; signal?: AbortSignal; ticketFile?: string; ticketHeader?: string;
  }): Promise<Operation>;
  list(): AsyncIterable<Operation>;
}
export class Operation {
  readonly intentId: string;
  readonly directory: string;
  readonly configPath: string;
  constructor(buyer: Buyer, intentId: string);
  review(): Promise<Review>;
  execute(options: { review: Review; signal?: AbortSignal }): Promise<BuyerResult>;
  /** Reads saved output only. This method never launches a native buyer. */
  recover(): Promise<BuyerResult | null>;
  inspect(): Promise<OperationStatus>;
}
export class BuyerResult {
  readonly record: ResultRecord;
  readonly native: NativeSummary;
  readonly status: unknown;
  readonly delivery: { status: string; [key: string]: unknown };
  readonly ok: boolean;
  constructor(record: ResultRecord, responseFile: { destination: string; maxBytes: number; timeoutMs?: number });
  raiseForStatus(): this;
  verify(options?: { chunkSize?: number; signal?: AbortSignal }): Promise<{ bytes: number; sha256: string }>;
  /** Exhaust before committing side effects; final digest verification can throw. */
  chunks(options?: { chunkSize?: number; signal?: AbortSignal }): AsyncIterable<Uint8Array>;
  bytes(options?: { limit?: number; signal?: AbortSignal }): Promise<Uint8Array>;
  json<T = unknown>(options?: { limit?: number; signal?: AbortSignal }): Promise<T>;
  csvRows(options: { headers: true; maxFieldCharacters?: number; signal?: AbortSignal }): AsyncIterable<Record<string, string>>;
  csvRows(options?: { headers?: false; maxFieldCharacters?: number; signal?: AbortSignal }): AsyncIterable<string[]>;
  saveAs(destination: string, options?: { signal?: AbortSignal }): Promise<string>;
}
