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
  /** Separate original dataset report budget; 32 MiB default, 1–256 MiB allowed. */
  datasetReportLimit?: number;
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
  fromOperationHandoff(file: string, options: {
    accept: number; operatorProfile?: OperatorProfile | string; signal?: AbortSignal;
  }): Promise<Operation>;
  fromRequest(request: NativeRequest, options?: Omit<ImportOptions, 'body'>): Promise<Operation>;
  call(request: NativeRequest): Promise<BuyerResult>;
  discover(catalog: JsonObject, options?: { destination?: string; signal?: AbortSignal }): Promise<JsonObject>;
  prepare(input: {
    discoveryFile: string; row: number; accept: number; intentId: string; url: string;
    method?: string; headers?: Record<string, string>; body?: string | Uint8Array;
    operatorProfile?: OperatorProfile | string; signal?: AbortSignal; ticketFile?: string; ticketHeader?: string;
  }): Promise<Operation>;
  list(): AsyncIterable<Operation>;
  dataset(id: string): Dataset;
  createDataset(options: DatasetOptions): Promise<Dataset>;
  attachDataset(options: { id: string; directory: string }): Promise<Dataset>;
  listDatasets(): AsyncIterable<Dataset>;
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
export class BuyerResult extends VerifiedFile {
  readonly record: ResultRecord;
  readonly native: NativeSummary;
  readonly status: unknown;
  readonly delivery: { status: string; [key: string]: unknown };
  readonly ok: boolean;
  constructor(record: ResultRecord, responseFile: { destination: string; maxBytes: number; timeoutMs?: number });
  raiseForStatus(): this;
}
export abstract class VerifiedFile {
  verify(options?: { chunkSize?: number; signal?: AbortSignal }): Promise<{ bytes: number; sha256: string }>;
  /** Exhaust before committing side effects; final digest verification can throw. */
  chunks(options?: { chunkSize?: number; signal?: AbortSignal }): AsyncIterable<Uint8Array>;
  bytes(options?: { limit?: number; signal?: AbortSignal }): Promise<Uint8Array>;
  json<T = unknown>(options?: { limit?: number; signal?: AbortSignal }): Promise<T>;
  csvRows(options: { headers: true; maxFieldCharacters?: number; signal?: AbortSignal }): AsyncIterable<Record<string, string>>;
  csvRows(options?: { headers?: false; maxFieldCharacters?: number; signal?: AbortSignal }): AsyncIterable<string[]>;
  saveAs(destination: string, options?: { signal?: AbortSignal }): Promise<string>;
}

export type DatasetScalar = string | number | boolean | null;
export type DatasetRow = Record<string, DatasetScalar>;
export interface DatasetLimits {
  maxPages: number;
  /** Total allocation ceiling, decimal atomic units; this is not a reported charge. */
  maxTotalAtomic: string;
  maxRows?: number;
  maxPageBytes?: number;
}
export type DatasetOptions = DatasetLimits & {
  /** Stable application name, separate from the original config's native intent. */
  id: string;
  expectedSnapshot?: string | null;
} & ({ config: string | JsonObject; operatorProfile?: OperatorProfile | string; workspaceDirectory?: never }
  | { workspaceDirectory: string; config?: never; operatorProfile?: never });
export interface DatasetReport extends JsonObject {
  schema: 'stellar-forge.sf88.dataset-acquisition.v1';
  directory: string;
  status: 'READY' | 'RUNNING' | 'COMPLETE' | 'RECONCILIATION_REQUIRED' | 'PAGE_LIMIT_REACHED' | 'TOTAL_CAP_REACHED';
  /** These fields are absent from the original RUNNING report. */
  sessionId?: string;
  configurationSha256?: string;
  expectedSnapshot?: string | null;
  snapshot?: string | null;
  completedPages?: number;
  acquiredRows?: number;
  totalRows?: number | null;
  capAllocatedAtomic?: string;
  limits?: DatasetLimits;
  pages?: JsonObject[];
  interrupted?: boolean;
  next?: string;
}
export interface DatasetCommand<T = DatasetReport> {
  /** Original report, independent from the application process outcome. */
  readonly native: T;
  readonly process: { readonly exitCode: number | null; readonly exitSignal: string | null; readonly errorCode: string | null };
}
export type DatasetOutputName = 'dataset.jsonl' | 'dataset.csv' | 'review.html' | 'manifest.json';
export interface DatasetOutput { path: string; bytes: number; sha256: string }
export interface DatasetDeliveryReport extends JsonObject {
  schema: 'stellar-forge.sf88.dataset-delivery.v1';
  directory: string;
  sourceDirectory: string;
  sourceBindingSha256: string;
  resumed: boolean;
  appendedPages: number;
  nativeStatus: JsonObject & { snapshot: string; rows: number; finalized: true };
  outputs: Record<DatasetOutputName, DatasetOutput>;
  paymentStatus: string;
}
export class Dataset {
  readonly id: string;
  /** Private application entry; the native session path is in its original report. */
  readonly directory: string;
  constructor(buyer: Buyer, id: string);
  initialize(options?: { signal?: AbortSignal }): Promise<DatasetCommand>;
  inspect(options?: { signal?: AbortSignal }): Promise<DatasetCommand>;
  recover(options?: { signal?: AbortSignal }): Promise<DatasetCommand>;
  run(options?: { signal?: AbortSignal }): Promise<DatasetCommand>;
  exportManifest(destination: string, options?: { signal?: AbortSignal }): Promise<DatasetCommand<JsonObject>>;
  /** Offline SF100 export. The same destination resumes its original verified archive. */
  deliver(destination?: string, options?: { signal?: AbortSignal }): Promise<DatasetDelivery>;
}
export class DatasetFile extends VerifiedFile {
  readonly metadata: DatasetOutput & { name: DatasetOutputName };
  readonly directory: string;
  constructor(metadata: DatasetOutput & { name: DatasetOutputName }, directory: string);
}
export class DatasetDelivery {
  readonly report: DatasetDeliveryReport;
  readonly manifest: JsonObject & {
    dataset: { name: string; snapshot: string; rows: number; projectedFields: string[]; [key: string]: unknown };
  };
  constructor(report: DatasetDeliveryReport, manifest: JsonObject);
  file(name: DatasetOutputName): DatasetFile;
  /** Exhaust before committing side effects; final size/hash/row-count validation can throw. */
  rows(options?: { signal?: AbortSignal; maxRowCharacters?: number }): AsyncIterable<DatasetRow>;
  /** Verified in full before returning. JSON scalar types are preserved without coercion. */
  readRows(options?: { limit?: number; maxRows?: number; signal?: AbortSignal }): Promise<DatasetRow[]>;
}
