// MIT. Complete inputs and named results for the installed local and MCP clients.
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface RubyCallOptions { timeoutMs?: number; signal?: AbortSignal; }
export interface RubyError { code: string; message: string; status: number; details?: unknown; }
export interface RubyFile { name: string; bytes: number; sha256: string; type?: string; [key: string]: unknown; }
export interface RubyOperation {
  id: string; environmentId: string; applicationId?: string; action: string;
  phase: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED' | string;
  active: boolean; stopRequested?: boolean; attempt: number; createdAt: string; updatedAt: string;
  stage?: string; result?: Record<string, unknown> | null; error?: { code?: string; message?: string } | null;
  [key: string]: unknown;
}
export interface RubyEnvironment {
  id: string; title: string; directory?: string; selectionSha256?: string;
  selection?: Record<string, unknown>; operations?: RubyOperation[]; [key: string]: unknown;
}
export interface RubyApplication {
  id: string; title: string; environmentId: string; directory: string;
  selectionSha256: string; phase: string; source: Record<string, unknown>;
  current?: RubyOperation | null; runs: RubyOperation[]; [key: string]: unknown;
}
export interface RubyUnavailable { id: string; phase: 'UNAVAILABLE'; error: RubyError; }
export interface RubyWorkspace {
  schema: string; directory: string; defaults: Record<string, unknown>;
  environments: Array<RubyEnvironment | RubyUnavailable>; applications: Array<RubyApplication | RubyUnavailable>; operations: RubyOperation[];
  customers?: RubyCustomerPage; [key: string]: unknown;
}
export interface RubyProbe {
  schema: 'stellar-forge.ruby-probe.v1'; ruby_version: string; executable: string;
  executableTarget: string; executableBytes: number; executableSha256: string;
  selectedBundler: string | null; bundlerAvailable: boolean | null; [key: string]: unknown;
}
export interface RubyLog {
  offset: number; nextOffset: number; totalBytes: number; text: string; [key: string]: unknown;
}
export interface RubySourcePreview {
  manifest: RubyFile; kind?: 'native' | 'baserow'; [key: string]: unknown;
}
export interface RubyExistingPreview {
  input: RubyFile; selected: Record<string, unknown>; result?: Record<string, unknown> | null;
  [key: string]: unknown;
}
export interface CustomerSelectionBase {
  id: string; title: string; requestId: string; environmentId: string;
  sourceDirectory: string; expectedSourceSha256: string; outputDirectory: string;
  checkout: string; python: string; node: string; datasetId: string;
  applicationId?: string; operationId?: string; registrationId?: string;
}
export interface NativeCustomerSelection extends CustomerSelectionBase {
  kind: 'native'; sourceKey: string; keys?: string[];
  customerKey?: never; sourceRef?: never; query?: never;
}
export interface BaserowCustomerSelection extends CustomerSelectionBase {
  kind: 'baserow'; customerKey: string; sourceRef: string; query?: string;
  sourceKey?: never; keys?: never;
}
export interface RubyCustomer {
  schema: 'stellar-forge.ruby-customer.v1'; id: string; title: string;
  phase: 'SELECTING' | 'SELECTED' | 'COMMISSIONING' | 'CUSTOMER_COMPLETE' | 'REGISTERING' |
    'FINALIZING' | 'READY' | 'CUSTOMER_NEEDS_RESUME' | 'REGISTRATION_NEEDS_RESUME';
  selectionSha256?: string; requestId?: string; createdAt?: string;
  source?: Record<string, unknown>; selected?: Record<string, unknown>;
  environment?: { id: string; selectionSha256: string }; customerOperation?: RubyOperation | null;
  customerOperationId?: string; entry?: string; argv?: string[];
  registrationOperation?: RubyOperation | null; registrationId?: string;
  applicationId?: string; applicationDirectory?: string; application?: RubyApplication | null;
  result?: Record<string, unknown> | null; files?: RubyFile[]; [key: string]: unknown;
}
export interface RubyCustomerPage {
  schema: 'stellar-forge.ruby-customers.v1'; customers: RubyCustomer[]; offset: number; total: number;
  nextOffset: number | null; [key: string]: unknown;
}
export type RubyEditionFormat = 'native' | 'baserow';
export interface RubyEditionSourcePreview {
  schema: 'stellar-forge.ruby-application-edition-source-preview.v1';
  format: RubyEditionFormat; directory: string; manifest: RubyFile;
  original: Record<string, unknown>;
  dataset: {
    manifest: RubyFile; directory: string; schema: string; datasetId: string;
    sourceKey: string | null; sourceFormat: 'SF100_SCAN' | 'SF88_SESSION';
    rowCount: number; fields: string[]; snapshot: string; sourceSha256: string;
    querySha256: string; definition: Record<string, unknown>;
  };
  customer?: { manifest: RubyFile; original: Record<string, unknown> };
}
export interface RubyEditionSelection {
  schema: 'stellar-forge.ruby-application-data-edition.v1'; id: string; title: string;
  originalApplicationManifestSha256: string; originalApplicationId: string;
  tenantKey: string; sourceKey: string; mappingSha256: string;
  source: { format: RubyEditionFormat; originalDirectory: string; manifestSha256: string };
  requestId: string; actor: string; createdAt: string; sha256: string;
}
export interface RubyEditionSource {
  schema: 'stellar-forge.ruby-application-data-source.v1'; selectionSha256: string;
  format: RubyEditionFormat; manifestSha256: string; datasetManifestSha256: string;
  sourceSha256: string; membershipSha256: string; rows: number; fields: string[]; files: RubyFile[];
}
export interface RubyEditionReceipt {
  revision: number; operation_sha256: string; manifest_sha256: string;
  source_sha256: string; preview_sha256: string; [key: string]: unknown;
}
export interface RubyEditionCommitted {
  id: string; receipt: RubyEditionReceipt; file: RubyFile; [key: string]: unknown;
}
export interface RubyEditionReview {
  id: string; directory: string; selection: Record<string, unknown>;
  review: {
    schema: 'stellar-forge.dataset-operator-review.v1'; id: string; selection_sha256: string;
    prepared_at: string; summary: {
      binding: Record<string, unknown>; counts: Record<string, number>; preview_sha256: string;
      [key: string]: unknown;
    };
    groups: Record<string, unknown>; files: RubyFile[]; [key: string]: unknown;
  } | null;
  approval: Record<string, unknown> | null; committed: RubyEditionCommitted | null;
  state: { phase: string; [key: string]: unknown };
}
export interface RubyEditionFile {
  name: string; scope: 'edition' | 'source' | 'review'; reviewId?: string;
  bytes?: number; sha256?: string; type?: string; [key: string]: unknown;
}
export interface RubyApplicationEdition {
  schema: 'stellar-forge.ruby-application-edition-view.v1';
  applicationId: string; environmentId: string; editionId: string;
  selection: RubyEditionSelection; selectionSha256: string;
  source: RubyEditionSource | null; reviews: RubyEditionReview[]; operations: RubyOperation[];
  files: RubyEditionFile[];
  phase: 'RUNNING' | 'COMMITTED' | 'PREPARED' | 'RECEIVED' | 'RECEIVING';
  latestCommitted: RubyEditionCommitted | null;
}
export interface RubyApplicationEditionPage {
  schema: 'stellar-forge.ruby-application-editions.v1'; applicationId: string;
  offset: number; total: number; nextOffset: number | null; editions: RubyApplicationEdition[];
}
export type RubyTransferSource =
  | { kind: 'operation'; operationId: string; name: string }
  | { kind: 'customer'; id: string; name: string }
  | { kind: 'edition'; id: string; editionId: string; reviewId?: string; name: string };
export interface RubyFileSelection extends RubyFile {
  schema: string; transferId: string; type: string;
  source: RubyTransferSource | { kind: 'record' }; selectionSha256: string; open: boolean;
}
export interface RubyFileChunk {
  schema: string; transferId: string; offset: number; bytes: number; nextOffset: number;
  totalBytes: number; fileSha256: string; encoding: 'base64'; data: string; sha256: string; eof: boolean;
}
export interface RubyUploadCursor {
  schema: string; operationId: string; bytes: number; committedBytes: number; nextOffset: number;
  phase: 'UPLOADING' | 'READY_TO_FINISH' | 'RECEIVED'; [key: string]: unknown;
}
export interface RubyUpload extends RubyUploadCursor {
  id: string; title: string; ruby: string; bundlerVersion?: string; expectedSha256: string;
  active: boolean; [key: string]: unknown;
}
export interface RubyDownloadInput {
  transferId: string; directory: string; source?: RubyTransferSource; expectedSha256?: string; signal?: AbortSignal;
}
export interface RubyDownload extends RubyFile {
  schema: 'stellar-forge.ruby-connected-download.v1'; transferId: string; type: string;
  source: RubyTransferSource | { kind: 'record' }; selectionSha256: string;
  state: 'COMPLETE'; directory: string; path: string; filename: string;
}
export interface RubyUploadInput {
  archive: string; operationId: string; id: string; title: string; ruby: string;
  bundlerVersion?: string; expectedSha256?: string; bytes?: number; signal?: AbortSignal;
}
export interface RubyWaitOptions { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal; }
export interface RubyOperationWait extends RubyWaitOptions { operationId: string; }
export interface RubyCustomerWait extends RubyWaitOptions { id: string; expectedSelectionSha256: string; }
export interface RubyStdioConnection {
  command: string; args?: string[]; cwd?: string; env?: Record<string, string>;
  stderr?: 'inherit' | 'pipe' | 'ignore' | number; timeoutMs?: number;
  url?: never; bearerToken?: never;
}
export interface RubyHttpConnection {
  url: string; bearerToken: string; timeoutMs?: number;
  command?: never; args?: never; env?: never; cwd?: never; stderr?: never;
}
export type RubyConnection = RubyStdioConnection | RubyHttpConnection;
export interface RubyTool {
  name: string; description: string; inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}
export interface RubyInputs {
  inspect: {  };
  probe: { ruby: string; bundlerVersion?: string; };
  create: { id: string; title: string; ruby: string; bundlerVersion: string; projectDirectory?: string; gemfile?: string; requestId: string; };
  start: { id: string; operationId: string; action: "install" | "verify" | "export"; offline?: boolean; applicationId?: string; };
  run: { id: string; operationId: string; entry: "native-dataset-lifecycle" | "baserow-customer-lifecycle"; argv?: Array<string>; };
  resume: { operationId: string; };
  cancel: { operationId: string; };
  operation: { operationId: string; };
  log: { operationId: string; offset?: number; limit?: number; };
  application: { id: string; };
  registerApplication: { id: string; title: string; environmentId: string; directory: string; requestId: string; };
  launchApplication: { id: string; operationId: string; port?: number; expectedApplicationSha256?: string; expectedEnvironmentSelectionSha256?: string; };
  stopApplication: { id: string; };
  receive: { id: string; title: string; ruby: string; bundlerVersion?: string; archive: string; expectedSha256: string; operationId: string; };
  previewSource: { kind: "native" | "baserow"; directory: string; expectedSha256?: string; };
  previewExisting: { directory: string; };
  customers: { offset?: number; limit?: number; };
  customer: { id: string; };
  selectCustomer: NativeCustomerSelection | BaserowCustomerSelection;
  adoptCustomer: { id: string; title: string; requestId: string; environmentId: string; outputDirectory: string; expectedInputSha256: string; applicationId?: string; operationId?: string; registrationId?: string; };
  advanceCustomer: { id: string; expectedSelectionSha256: string; };
  resumeCustomer: { id: string; expectedSelectionSha256: string; phase: "customer" | "registration"; };
  cancelCustomer: { id: string; expectedSelectionSha256: string; phase: "customer" | "registration"; };
  previewApplicationEditionSource: { format: RubyEditionFormat; directory: string; expectedManifestSha256?: string; };
  stageApplicationEdition: { id: string; editionId: string; title: string; format: RubyEditionFormat; directory: string; expectedManifestSha256: string; reviewId: string; operationId: string; actor: string; };
  prepareApplicationEdition: { id: string; editionId: string; reviewId: string; operationId: string; actor: string; };
  commitApplicationEdition: { id: string; editionId: string; reviewId: string; expectedPreviewSha256: string; operationId: string; actor: string; };
  applicationEditions: { id: string; offset?: number; limit?: number; };
  applicationEdition: { id: string; editionId: string; };
  openTransfer: { transferId: string; source: RubyTransferSource; expectedSha256?: string; };
  transfer: { transferId: string; };
  readTransfer: { transferId: string; offset: number; limit?: number; };
  closeTransfer: { transferId: string; };
  prepareUpload: { operationId: string; id: string; title: string; ruby: string; bundlerVersion?: string; expectedSha256: string; bytes: number; };
  upload: { operationId: string; };
  writeUpload: { operationId: string; offset: number; data: string; sha256: string; };
  finishUpload: { operationId: string; };
}
export interface RubyOutputs {
  inspect: RubyWorkspace;
  probe: RubyProbe;
  create: RubyEnvironment;
  start: RubyOperation;
  run: RubyOperation;
  resume: RubyOperation;
  cancel: RubyOperation;
  operation: RubyOperation;
  log: RubyLog;
  application: RubyApplication;
  registerApplication: RubyApplication;
  launchApplication: RubyOperation;
  stopApplication: RubyApplication;
  receive: RubyOperation;
  previewSource: RubySourcePreview;
  previewExisting: RubyExistingPreview;
  customers: RubyCustomerPage;
  customer: RubyCustomer;
  selectCustomer: RubyCustomer;
  adoptCustomer: RubyCustomer;
  advanceCustomer: RubyCustomer;
  resumeCustomer: RubyCustomer;
  cancelCustomer: RubyCustomer;
  previewApplicationEditionSource: RubyEditionSourcePreview;
  stageApplicationEdition: RubyOperation;
  prepareApplicationEdition: RubyOperation;
  commitApplicationEdition: RubyOperation;
  applicationEditions: RubyApplicationEditionPage;
  applicationEdition: RubyApplicationEdition;
  openTransfer: RubyFileSelection;
  transfer: RubyFileSelection;
  readTransfer: RubyFileChunk;
  closeTransfer: RubyFileSelection;
  prepareUpload: RubyUpload;
  upload: RubyUpload;
  writeUpload: RubyUploadCursor;
  finishUpload: RubyOperation;
}
export type RubyMethod = keyof RubyInputs;
export type RubyNamedMethods = {
  [K in RubyMethod]: keyof RubyInputs[K] extends never
    ? (input?: RubyInputs[K], options?: RubyCallOptions) => Promise<RubyOutputs[K]>
    : {} extends RubyInputs[K]
      ? (input?: RubyInputs[K], options?: RubyCallOptions) => Promise<RubyOutputs[K]>
      : (input: RubyInputs[K], options?: RubyCallOptions) => Promise<RubyOutputs[K]>;
};
export type RubyClient = RubyNamedMethods & {
  readonly schema: 'stellar-forge.ruby-connected-client.v1';
  readonly directory?: string;
  tools(): RubyTool[];
  call<K extends RubyMethod>(method: K, input: RubyInputs[K], options?: RubyCallOptions): Promise<RubyOutputs[K]>;
  downloadFile(input: RubyDownloadInput): Promise<RubyDownload>;
  uploadFile(input: RubyUploadInput): Promise<RubyOperation>;
  waitOperation(input: RubyOperationWait): Promise<RubyOperation>;
  waitCustomer(input: RubyCustomerWait): Promise<RubyCustomer>;
  close(): Promise<void>;
};
export type LocalRubyClient = RubyClient & {
  readonly directory: string;
  retainResult(value: JsonValue | Record<string, unknown>): Promise<RubyFileSelection>;
};
export function openRubyConnectedClient(options: { directory: string; create?: boolean }): Promise<LocalRubyClient>;
export function connectRubyRuntime(options: RubyConnection): Promise<RubyClient>;
export function rubyMcpProvider(client: LocalRubyClient): {
  tools: RubyTool[];
  call(name: string, input: Record<string, unknown>): Promise<unknown>;
};
export function errorView(error: unknown): RubyError;
