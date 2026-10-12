// MIT. Complete native Property Operations client types.
export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };
export type JSONObject = { [key: string]: JSONValue };
export type PropertyGroup = 'baselines' | 'selections' | 'contracts' | 'requests' | 'editions' | 'reviews' | 'comparisons' | 'bindings' | 'documents' | 'resources';
export type PropertyReadAction = 'property.get' | 'property.operation' | 'property.candidates' | 'property.resource.publisher';
export type PropertyWriteAction = 'property.file.import' | 'property.baseline.save' | 'property.selection.save' | 'property.propply.prepare' | 'property.rentcheck.contract' | 'property.rentcheck.prepare' | 'property.inspection.prepare' | 'property.request.run' | 'property.request.recover' | 'property.request.import' | 'property.identity.save' | 'property.comparison.save' | 'property.inspection.bind' | 'property.report.save' | 'property.resource.export';
export type PublisherOperation = 'status' | 'prepare' | 'preview' | 'reviewDraft' | 'publish' | 'activateSnapshot' | 'collect' | 'release.stage' | 'release.inspect' | 'release.activate' | 'release.rollback' | 'release.start' | 'release.stop' | 'buyer.review' | 'buyer.prepare' | 'buyer.session' | 'buyer.run' | 'buyer.recover' | 'buyer.account' | 'buyer.export';
export type PropertyPublisherAction = `property.publisher.${PublisherOperation}`;
export type PropertyAction = PropertyReadAction | PropertyWriteAction | PropertyPublisherAction | 'dataset.query' | 'package.export';
export type PublisherFileKind = 'draft-csv' | 'draft-review' | 'buyer-config' | 'session-manifest' | 'session-csv' | 'session-jsonl' | 'session-review';
export interface RequestOptions { signal?: AbortSignal; }
export interface NativeRevision {
  key: string;
  workspace_id: string | null;
  expected_revision: number;
}
export interface ReviewInput { actor: string; note: string; }
export interface PropertyFile { file: string; bytes: number; sha256: string; [key: string]: JSONValue; }
export interface NativeRecordSummary { id: string; kind?: string; file?: string; sha256?: string; [key: string]: JSONValue | undefined; }
export interface NativeOperation {
  key: string;
  action: PropertyWriteAction;
  input_sha256: string;
  state: 'ISSUED' | 'DONE';
  created_at: string;
  completed_at?: string;
  request_id?: string;
  result?: JSONValue;
}
export interface PropertyState {
  schema: 'tjlabs.property-workspace/v1';
  id: string | null;
  revision: number;
  baselines: NativeRecordSummary[];
  selections: NativeRecordSummary[];
  contracts: NativeRecordSummary[];
  requests: NativeRecordSummary[];
  editions: NativeRecordSummary[];
  reviews: NativeRecordSummary[];
  comparisons: NativeRecordSummary[];
  bindings: NativeRecordSummary[];
  documents: NativeRecordSummary[];
  resources: NativeRecordSummary[];
  files: PropertyFile[];
  operations: NativeOperation[];
  meaning: JSONObject;
}
export interface SourceExportFile { name: string; bytes: number; sha256: string; [key: string]: JSONValue; }
export interface SourceExport { id: string; files: SourceExportFile[]; [key: string]: unknown; }
export interface PropertyWorkspaceState {
  schema: 'stellar-forge.socrata-workspace.v1';
  createdAt: string;
  updatedAt: string;
  property: PropertyState;
  captures: JSONObject[];
  editions: JSONObject[];
  activeEditionId: string | null;
  exports: SourceExport[];
  publisher: JSONObject | null;
  propertyPublishers: Record<string, JSONObject>;
  [key: string]: unknown;
}
export interface NativeResult<T = JSONValue> {
  state: PropertyWorkspaceState;
  result: T;
  property_resource_id?: string;
  [key: string]: unknown;
}
export interface PreparedPropertyRequest<A extends PropertyWriteAction = PropertyWriteAction> {
  schema: 'stellar-forge.property-client-request.v1';
  createdAt: string;
  action: A;
  payload: JSONObject & NativeRevision;
  inputSha256: string;
}
export interface PreparedInspection {
  prepared: PreparedPropertyRequest;
  state: PropertyWorkspaceState;
  operation: NativeOperation | null;
  disposition: 'DONE' | 'ISSUED' | 'ABSENT_AT_ORIGINAL_REVISION' | 'ABSENT_AFTER_CHANGE';
}
export type PropertyFileSelection =
  | { kind: 'property'; file: string; bytes?: number; sha256?: string }
  | { kind: 'source-export'; exportId: string; name: string; bytes?: number; sha256?: string };
export interface FileReceipt {
  createdAt: string;
  propertyId: string | null;
  selection: PropertyFileSelection;
  descriptor: PropertyFile | SourceExportFile;
  bytes: number;
  sha256: string;
}
export interface PublisherFileSelection {
  resourceId?: string | null;
  kind: PublisherFileKind;
  id: string;
  bytes?: number;
  sha256?: string;
}
export interface PublisherFileReceipt {
  createdAt: string;
  resourceId: string | null;
  kind: PublisherFileKind;
  id: string;
  name: string;
  bytes: number;
  sha256: string;
  type: string;
  data: Uint8Array;
}
export interface PropertyConnectionRecord {
  url: string;
  createdAt?: string;
  schema?: string;
  [key: string]: JSONValue | undefined;
}
export interface PropertyClientOptions {
  url: string;
  expectedCreatedAt?: string | null;
  expectedPropertyId?: string | null;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
export class PropertyClientError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly action: string | null;
  readonly key: string | null;
  readonly uncertain: boolean;
  readonly result: unknown;
  constructor(code: string, message: string, options?: {
    status?: number | null; action?: string | null; key?: string | null;
    uncertain?: boolean; result?: unknown; cause?: unknown;
  });
}
export interface PropertyOperationsClient {
  readonly origin: string;
  readonly createdAt: string | null;
  readonly propertyId: string | null;
  status(options?: RequestOptions): Promise<PropertyWorkspaceState>;
  act<T = JSONValue>(action: PropertyAction, payload?: JSONObject, options?: RequestOptions): Promise<NativeResult<T>>;
  prepare<A extends PropertyWriteAction>(action: A, input: JSONObject, options?: { key?: string; signal?: AbortSignal }): Promise<PreparedPropertyRequest<A>>;
  inspectPrepared(request: PreparedPropertyRequest, options?: RequestOptions): Promise<PreparedInspection>;
  invoke<T = JSONValue>(request: PreparedPropertyRequest, options?: { signal?: AbortSignal; resumeIssued?: boolean }): Promise<NativeResult<T> & { reused?: boolean; operation?: NativeOperation }>;
  record(group: PropertyGroup, id: string, options?: RequestOptions): Promise<NativeResult<{ record: JSONObject; workspace_id: string | null; revision: number }>>;
  operation(key: string, options?: RequestOptions): Promise<NativeResult<{ operation: NativeOperation | null; workspace_id: string | null; revision: number }>>;
  selectFile(selection: PropertyFileSelection, options?: RequestOptions): Promise<{
    selection: PropertyFileSelection; createdAt: string; propertyId: string | null;
    descriptor: PropertyFile | SourceExportFile; path: string;
  }>;
  receiveFile(selection: PropertyFileSelection, options: {
    signal?: AbortSignal; onChunk(chunk: Uint8Array): void | Promise<void>;
  }): Promise<FileReceipt>;
  readFile(selection: PropertyFileSelection, options?: RequestOptions): Promise<FileReceipt & { data: Uint8Array }>;
  receivePublisherFile(selection: PublisherFileSelection, options: RequestOptions & {onChunk(chunk: Uint8Array): void | Promise<void>}): Promise<Omit<PublisherFileReceipt, 'data'>>;
  readPublisherFile(selection: PublisherFileSelection, options?: RequestOptions): Promise<PublisherFileReceipt>;
  close(options?: { abortReads?: boolean }): Promise<void>;
}
export const PROPERTY_CLIENT_SCHEMA: 'stellar-forge.property-client-request.v1';
export const PROPERTY_NATIVE_SCHEMA: 'tjlabs.property-workspace/v1';
export const PROPERTY_REQUEST_BYTES: number;
export const PROPERTY_JSON_BYTES: number;
export const PROPERTY_FILE_BYTES: number;
export const PROPERTY_GROUPS: readonly PropertyGroup[];
export const PROPERTY_READ_ACTIONS: readonly PropertyReadAction[];
export const PROPERTY_WRITE_ACTIONS: readonly PropertyWriteAction[];
export const PROPERTY_PUBLISHER_ACTIONS: readonly PropertyPublisherAction[];
export const PROPERTY_FILE_KINDS: readonly PublisherFileKind[];
export function propertyConnection(url: string): Readonly<{ origin: string; token: string }>;
export function readPropertyConnection(file: string): Promise<PropertyConnectionRecord>;
export function createPropertyOperationsClient(options: PropertyClientOptions): PropertyOperationsClient;
