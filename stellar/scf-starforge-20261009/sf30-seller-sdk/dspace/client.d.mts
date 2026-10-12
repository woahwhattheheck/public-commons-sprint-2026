/// <reference types="node" />
/** MIT. Typed host contract for the retained DSpace dataset HTTP operator. */
export interface DspaceScope {
  readonly operatorId: string;
  readonly instanceId: string;
  readonly projectKey: string;
  readonly workspaceId: string;
}
export interface DspaceLaunch {
  schema: 'stellar-forge.dspace-operator-launch.v1';
  operatorId: string;
  instanceId: string;
  pid: number;
  directory: string;
  url: string;
  serverFile: string;
  serverSha256: string;
  state: 'running';
  projectKey: string;
  workspaceId: string;
  [key: string]: unknown;
}
export type DspaceRecordKind = 'sources'|'editions'|'reviews'|'comparisons'|'publications';
export type DspaceDownloadKind = 'project'|'source'|'dataset'|'config'|'comparison'|DspaceRecordKind;
export interface OriginalMetadataValue {
  value: unknown;
  language?: string|null;
  authority?: string|null;
  confidence?: number;
  place?: number;
  [key: string]: unknown;
}
export interface OriginalDspaceObject {
  uuid: string;
  name?: string|null;
  metadata: Record<string,OriginalMetadataValue[]>;
  _links?: Record<string,unknown>;
  [key: string]: unknown;
}
export interface OriginalItem {
  uuid: string;
  object_sha256: string;
  name: string|null;
  entity_type: unknown;
  fields: string[];
  metadata_count: number;
  in_scope: boolean;
  origins: Array<Record<string,unknown>>;
  object: OriginalDspaceObject;
  [key: string]: unknown;
}
export interface ItemSummary {
  uuid: string;
  objectSha256: string;
  name: string|null;
  entity_type: unknown;
  fields: string[];
  metadata_count: number;
  in_scope: boolean;
  origins: Array<Record<string,unknown>>;
}
export interface RetainedRecordSummary {
  id: string;
  sha256?: string;
  created_at?: string;
  [key: string]: unknown;
}
export interface DspaceState {
  schema: 'stellar-forge.dspace-workspace.v1';
  id: string;
  revision: number;
  created_at: string;
  selected_edition_id: string|null;
  selected_review_id: string|null;
  sources: RetainedRecordSummary[];
  editions: RetainedRecordSummary[];
  reviews: RetainedRecordSummary[];
  comparisons: RetainedRecordSummary[];
  publications: RetainedRecordSummary[];
  operation_count: number;
  operator: {
    id: string;
    instanceId: string;
    selected: string;
    projects: Array<{key:string;name:string}>;
  };
}
export interface OriginalRequest {
  operationId: string;
  expectedRevision: number;
  actor: string;
}
export interface SourceChoice {sourceId:string;uuid:string;objectSha256:string}
export interface DistributionRights {
  attribution: string;
  basis: string;
  reference?: string|null;
}
export interface SaveEditionInput extends OriginalRequest {
  name: string;
  mode: 'items'|'metadata-values';
  selection: SourceChoice[];
  metadataFields: string[];
  rights: DistributionRights;
  previousEditionId?: string;
}
export interface ReviewEditionInput extends OriginalRequest {
  editionId: string;
  editionSha256: string;
  decision: 'approved'|'needs-changes';
  comment: string;
}
export interface SelectEditionInput extends OriginalRequest {editionId:string;reviewId:string}
export interface CompareEditionsInput extends OriginalRequest {beforeId:string;afterId:string}
export interface RecordPublicationInput extends OriginalRequest {
  editionId: string;
  publication: {snapshot:string;[key:string]:unknown};
}
export interface ImportSourceInput extends OriginalRequest {sourceBase64:string}
export interface ActionInputs {
  'import-source':ImportSourceInput;
  'save-edition':SaveEditionInput;
  'review-edition':ReviewEditionInput;
  'select-edition':SelectEditionInput;
  'compare-editions':CompareEditionsInput;
  'record-publication':RecordPublicationInput;
}
export interface OperationResult {
  operationId: string;
  revision: number;
  replayed?: boolean;
  source?: RetainedRecordSummary;
  edition?: RetainedRecordSummary;
  review?: RetainedRecordSummary;
  comparison?: RetainedRecordSummary;
  publication?: RetainedRecordSummary;
  selected_edition_id?: string;
  selected_review_id?: string;
  snapshot?: string;
  [key: string]: unknown;
}
export interface CommittedOperation {
  request_sha256: string;
  input: Record<string,unknown>;
  result: OperationResult;
}
export interface NativeDatasetQuery {
  limit?: number|string;
  cursor?: string;
  [key: string]: unknown;
}
export interface NativeDatasetPage {
  schema: 'stellar-forge.dataset-page.v1';
  dataset: {snapshot:string;[key:string]:unknown};
  fields: string[];
  rows: Array<Record<string,unknown>>;
  page: {limit:number;total:number;returned:number;nextCursor:string|null};
  filters?: Record<string,unknown>;
  [key: string]: unknown;
}
export interface DspaceDownload {
  /** Host-owned canonical retained file, never an MCP-selected destination. */
  path: string;
  filename: string;
  contentType: string;
  bytes: number;
  sha256: string;
  scope: DspaceScope;
  kind: DspaceDownloadKind;
  id: string;
}
export interface DspaceConnection {
  url: string;
  /** Private host credential; never include it in a tool result or log. */
  token: string;
  launch: DspaceLaunch;
  scope: DspaceScope;
}
export interface ClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}
export interface ConnectDspaceOptions extends ClientOptions {
  launchFile?: string;
  directory?: string;
  operatorId?: string;
  instanceId?: string;
  executionSourceDirectory?: string;
  announcement?: unknown;
}
export interface Scoped {scope?:DspaceScope}
export interface FileInspectionOptions {maximum?:number;privateFile?:boolean}
export interface FileIdentity {bytes:number;sha256:string}
export const DSPACE_MAX_INPUT_BYTES:number;
export const DSPACE_MAX_RESPONSE_BYTES:number;
export class DspaceClientError extends Error {
  code:string;
  status?:number;
  scope?:DspaceScope;
  operationId?:string;
  uncertain?:boolean;
  response?:unknown;
  causeCode?:string;
  constructor(code:string,message:string,details?:Record<string,unknown>);
}
export function validateDspaceScope(scope:DspaceScope):Readonly<DspaceScope>;
export function dspaceScopeFromState(state:DspaceState):Readonly<DspaceScope>;
export function inspectDspaceInput(filename:string,options?:FileInspectionOptions):Promise<FileIdentity>;
export function readDspaceInput(filename:string,options?:FileInspectionOptions&{expectedSha256?:string}):Promise<{bytes:Buffer;sha256:string}>;
export class DspaceOperatorClient {
  constructor(connection:DspaceConnection,options?:ClientOptions);
  /** Initial immutable binding. Select/receive returns another explicit scope. */
  readonly scope:DspaceScope;
  readonly launch:DspaceLaunch;
  readonly summary:{scope:DspaceScope;pending:number;closing:boolean};
  state(options?:Scoped):Promise<DspaceState>;
  record(input:Scoped&{kind:DspaceRecordKind;id:string;offset?:number;limit?:number}):Promise<Record<string,unknown>>;
  items(input:Scoped&{sourceId:string;offset?:number;limit?:number;selection?:'all'|'collection';search?:string}):
    Promise<{sourceId:string;items:ItemSummary[];total:number;offset:number;limit:number}>;
  item(input:Scoped&SourceChoice):Promise<OriginalItem>;
  operation(input:Scoped&{operationId:string}):Promise<CommittedOperation>;
  dispatch<K extends keyof ActionInputs>(action:K,input:ActionInputs[K],options?:Scoped):Promise<OperationResult>;
  importSource(input:Scoped&OriginalRequest&{file:string;expectedSha256:string}):Promise<OperationResult>;
  query(input:Scoped&{editionId:string;query?:NativeDatasetQuery}):Promise<NativeDatasetPage>;
  selectProject(input:Scoped&{key:string}):Promise<{scope:DspaceScope;state:DspaceState}>;
  receiveWorkspace(input:Scoped&{file:string;expectedSha256:string;operationId:string}):
    Promise<{operationId:string;sha256:string;bytes:number;replayed:boolean;scope:DspaceScope;state:DspaceState}>;
  download(input:Scoped&{kind:DspaceDownloadKind;id?:string;directory:string;expectedSha256?:string;maximumBytes?:number}):Promise<DspaceDownload>;
  /** Drains this client only. The original operator remains running. */
  close():Promise<void>;
}
export function connectDspaceOperator(options:ConnectDspaceOptions):Promise<DspaceOperatorClient>;
