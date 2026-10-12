/// <reference types="node" />

export type StellarNetwork = 'stellar:pubnet' | 'stellar:testnet';
export type UUID = string;
export type SHA256 = string;
export type NativeMethod =
  | 'base.fetchContractData'
  | 'base.fetchAccount'
  | 'base.fetchAccountTrustLines'
  | 'base.fetchAccountData'
  | 'base.fetchClassicLiquidityPools'
  | 'base.fetchClassicLiquidityPoolById'
  | 'base.fetchAssets'
  | 'base.fetchNfts'
  | 'base.getAccountAssetsBalances'
  | 'base.getAccountNftsBalances'
  | 'stellardomains.instanceData'
  | 'stellardomains.getAllDomains'
  | 'stellardomains.getAddressDomains'
  | 'stellardomains.getDomainsOwnedByAddress'
  | 'stellardomains.resolveOwnedDomains'
  | 'blend.fetchPoolsInfo'
  | 'blend.fetchPoolInfo'
  | 'blend.fetchPoolAuctions'
  | 'blend.fetchPoolEvents'
  | 'blend.fetchPoolAssetInfo'
  | 'blend.fetchPoolAssetHistoricalData'
  | 'blend.fetchPoolAssetHistoricalEmissions'
  | 'blend.fetchPoolUserPositions'
  | 'blend.fetchPoolUserPosition'
  | 'blend.fetchPoolUserPositionHistorical'
  | 'blend.fetchUserPositions'
  | 'blend.fetchCometPoolHistory'
  | 'axis-markets.queryOrders'
  | 'axis-markets.fetchOrder'
  | 'axis-markets.queryLastTrades'
  | 'axis-markets.queryLastSwaps'
  | 'axis-markets.fetchMarketDepth'
  | 'reflector.fetchOraclesData'
  | 'reflector.fetchHistoricalPrices'
  | 'xbull-swap.fetchStrictSendRecordsByAddress';

export type NativeValue =
  | {t:'null'|'undefined'}
  | {t:'string';v:string}
  | {t:'boolean';v:boolean}
  | {t:'number';v:number|'NaN'|'Infinity'|'-Infinity'|'-0'}
  | {t:'bigint';v:string}
  | {t:'date';v:string|null}
  | {t:'bytes';kind:string;v:string}
  | {t:'array'|'set';v:NativeValue[]}
  | {t:'object';v:[string,NativeValue][]}
  | {t:'map';v:[NativeValue,NativeValue][]};

export interface SDKConnection {
  network: StellarNetwork;
  consumerToken: string;
  apiUrl?: string;
}
export interface PublicConnection {
  alias: string;
  network: StellarNetwork;
  apiUrl: string;
}
export interface Operation {
  /** Retain this ID and the complete original arguments when retrying. */
  requestId: string;
  /** Required for the first intent; an existing request returns its original result. */
  expectedRevision: number;
}
export interface SourceFile {
  path: string;
  bytes: number;
  sha256: SHA256;
  contentType?: string;
  mode?: number;
}
export interface SourceRange {
  path: string;
  bytes: number;
  totalBytes: number;
  sha256: SHA256;
  contentType?: string;
  offset: number;
  complete: boolean;
  content: Buffer;
}
export interface NativeMethodDescription {
  id: NativeMethod;
  name: string;
  family: 'base'|'blend'|'stellardomains'|'reflector'|'xbull-swap'|'axis-markets';
  description: string;
  kind: 'native'|'composition';
  arguments: string[];
  pagination: {argumentIndex:number;defaultLimit:number;maxLimit:number;startPage:number}|null;
  resultShape: 'array'|'object'|'record'|'prices';
  requiresOptions: string[];
}
export interface Pagination {
  mode: 'all'|'once';
  startPage?: number;
  limit?: number;
}
export interface QueryInput {
  name: string;
  connectionAlias: string;
  method: NativeMethod;
  /** Arguments in the original publisher method order. Date and bigint values are retained losslessly. */
  args: unknown[];
  sdkOptions?: Record<string,unknown>;
  pagination?: Pagination;
}
export interface QueryVersion extends Omit<QueryInput,'args'> {
  queryId: UUID;
  version: number;
  args: unknown[];
  nativeArgs: NativeValue;
  network: StellarNetwork;
  sdkOptions: Record<string,unknown>;
  pagination: Pagination;
  createdAt: string;
  sha256: SHA256;
  receivedSourceVersion?: {queryId:UUID;version:number;sha256:SHA256};
}
export interface SavedQuery {
  id: UUID;
  name: string;
  currentVersion: number;
  versions: QueryVersion[];
  originalQueryId?: UUID;
  sourceWorkspaceId?: UUID;
}
export interface NativeError {
  code: string;
  message: string;
  status?: number|null;
  at: string;
}
export interface NativeRow {
  key: string;
  sha256: SHA256;
  value: NativeValue;
  display: unknown;
  recordKey: string|null;
}
export interface RetainedRow extends NativeRow {
  index: number;
  page: number;
  attemptId: UUID;
}
export interface NativeExchange {
  schema: 'stellar-forge.stellar-indexer.exchange.v1';
  id: UUID;
  index: number;
  request: {
    url: string;
    method: string;
    headers: [string,string][];
    privateHeaderNames: string[];
    body: SourceFile;
  };
  startedAt: string;
  finishedAt?: string;
  response: {
    url: string;
    status: number;
    statusText: string;
    headers: [string,string][];
    body?: SourceFile;
    bodyEncoding?: 'fetch-decoded';
    jsonShape?: string;
    rowCount?: number;
  }|null;
  error: NativeError|null;
}
export interface NativePageResult {
  schema: 'stellar-forge.stellar-indexer.native-page.v1';
  method: NativeMethod;
  kind: 'native'|'composition';
  page: number;
  startedAt: string;
  finishedAt: string;
  runtimeId: SHA256;
  args: NativeValue;
  value: NativeValue;
  sourceCount: number;
  rowCount: number;
  sourceExhausted: boolean;
  primarySourceSha256: SHA256|null;
  coverage: Record<string,unknown>;
  rows: NativeRow[];
  exchanges: NativeExchange[];
}
export interface NativeAttempt {
  id: UUID;
  number: number;
  page: number;
  phase: 'PREPARED'|'RUNNING'|'COMMITTED'|'INTERRUPTED'|'FAILED';
  connection: PublicConnection;
  createdAt: string;
  finishedAt?: string;
  interruptedAt?: string;
  runtimeId: SHA256|null;
  applicationId?: SHA256;
  directory: string;
  result: SourceFile|null;
  error: NativeError|null;
  files?: SourceFile[];
}
export interface CapturePage {
  number: number;
  page: number;
  attemptId: UUID;
  rowOffset: number;
  rowCount: number;
  sourceCount: number;
  result: SourceFile;
  primarySourceSha256: SHA256|null;
  coverage: Record<string,unknown>;
  completedAt: string;
}
export interface ReceivedSource {
  workspaceId: UUID;
  captureId: UUID;
  exportId: SHA256;
  manifestSha256: SHA256;
  at: string;
}
export interface Capture {
  id: UUID;
  sourceWorkspaceId: UUID;
  queryId: UUID;
  queryVersion: number;
  query: QueryVersion;
  frozenArgs: NativeValue;
  network: StellarNetwork;
  connectionAlias: string;
  connection: PublicConnection;
  bindings: {connection:PublicConnection;at:string;reason?:string}[];
  status: 'READY'|'RUNNING'|'PAUSED'|'FAILED'|'COMPLETE';
  desiredState: 'RUNNING'|'PAUSED';
  nextPage: number;
  rowCount: number;
  sourceCount: number;
  pages: CapturePage[];
  attempts: NativeAttempt[];
  activeAttemptId: UUID|null;
  runtimeId: SHA256|null;
  runtimeGeneration?: UUID;
  editionId: UUID|null;
  createdAt: string;
  updatedAt: string;
  completedAt: string|null;
  lastError: NativeError|null;
  originalCaptureId?: UUID;
  receivedSources?: ReceivedSource[];
}
export type CaptureSummary = Omit<Capture,'pages'|'attempts'> & {
  pageCount: number;
  attemptCount: number;
};
export interface Edition {
  schema: 'stellar-forge.stellar-indexer.edition.v1';
  id: UUID;
  sourceWorkspaceId: UUID;
  captureId: UUID;
  queryId: UUID;
  queryVersion: number;
  method: NativeMethod;
  network: StellarNetwork;
  query: QueryVersion;
  frozenArgs: NativeValue;
  runtimeId: SHA256;
  rowCount: number;
  sourceCount: number;
  pageCount: number;
  pages: CapturePage[];
  completedAt: string;
  observation: string;
  sha256: SHA256;
  file: SourceFile;
  originalEditionId?: UUID;
  originalCaptureId?: UUID;
}
export interface CapturedRuntimeSource {
  id: SHA256;
  path: string;
  manifestSha256: SHA256;
}
export interface CapturedApplicationSource extends CapturedRuntimeSource {
  entrypoint: string;
  cli: string;
}
export interface WatchSource {
  watchId: UUID;
  exportId: string;
  path: string;
  manifestSha256: SHA256;
}
export interface SourceManifest {
  schema: 'stellar-forge.stellar-indexer.source-export.v1'|'stellar-forge.stellar-indexer.delivery-export.v1';
  exportId: SHA256;
  requestId: SHA256;
  origin: {workspaceId:UUID;revision:number;capturedAt:string};
  snapshot: 'workspace-source.json';
  captures: {id:UUID;queryId:UUID;queryVersion:number;status:Capture['status'];network:StellarNetwork;
    rowCount:number;pageCount:number;attemptCount:number;editionId:UUID|null}[];
  editions: {id:UUID;captureId:UUID;sha256:SHA256;rowCount:number}[];
  runtimes: CapturedRuntimeSource[];
  applications: CapturedApplicationSource[];
  watches: WatchSource[];
  files: SourceFile[];
  fileCount: number;
  totalBytes: number;
}
export interface SourceExport {
  id: SHA256;
  directory: string;
  manifest: SourceManifest;
  manifestSha256: SHA256;
}
export interface RuntimeInstallation {
  applicationId: SHA256;
  runtimeId: SHA256;
  directory: string;
  sourceDirectory: string;
  entrypoint: string;
  cli: string;
}
export interface ReceivingInput extends Operation {
  sourceDirectory: string;
  expectedManifestSha256?: SHA256;
  /** Optional named private connection on this host; it must keep the original network. */
  connectionAlias?: string;
}
export interface WatchReceivingConnection {
  connectionAlias?: string;
  recoveryConnectionAlias?: string|null;
  publicationDirectory?: string|null;
}
export interface Revision {revision:number}
export interface SourceReceived {
  capture: CaptureSummary & {received:true;retainedNewer:boolean;sourceCaptureId:UUID};
  edition: Edition|null;
  received: true;
  manifestSha256: SHA256;
  sourceDirectory: string;
  installations?: RuntimeInstallation[];
}
export interface DeliveryReceived {
  captures: SourceReceived['capture'][];
  editions: Edition[];
  /** Complete native watch states returned by the original Soroban watch receiver. */
  watches: Record<string,unknown>[];
  received: true;
  manifestSha256: SHA256;
  sourceDirectory: string;
  installations?: RuntimeInstallation[];
}
export interface WorkspaceDescription extends Revision {
  workspaceId: UUID;
  sdkVersion: string;
  queries: SavedQuery[];
  captures: CaptureSummary[];
  editions: Edition[];
  exports: SourceExport[];
  connections: PublicConnection[];
  methods: NativeMethodDescription[];
}
export interface RowsResult {
  rows: RetainedRow[];
  total: number;
  offset: number;
  nextOffset: number|null;
}
export interface Comparison {
  summary: {
    beforeEditionId: UUID;afterEditionId: UUID;beforeRows:number;afterRows:number;
    identicalOccurrences:number;duplicateKeys:number;added:number;removed:number;changed:number;
    queryChanged:boolean;beforeQuery:QueryVersion;afterQuery:QueryVersion;
  };
  changes: {key:string;kind:'added'|'removed'|'changed';before:RetainedRow[];after:RetainedRow[]}[];
  total:number;
  offset:number;
  nextOffset:number|null;
}
export interface NativeWatchWorkspace {
  describe():Promise<{revision:number;[key:string]:unknown}>;
  watchExport(input:Operation&{watchId:UUID}):Promise<{export:{id:string;directory:string;
    manifest:{files:SourceFile[];[key:string]:unknown};manifestSha256:SHA256};[key:string]:unknown}>;
  watchReceive(input:Operation&WatchReceivingConnection&{sourceDirectory:string;expectedManifestSha256?:SHA256}):
    Promise<{watch:Record<string,unknown>;[key:string]:unknown}>;
}
export interface WorkspaceOptions {
  directory: string;
  connections?: Record<string,SDKConnection>;
  /** Installed dependency project; the executing application source remains separately retained. */
  installationDirectory?: string;
  eventWorkspace?: unknown;
  eventWatches?: NativeWatchWorkspace;
}
export interface StellarIndexerWorkspace {
  readonly directory: string;
  describe():Promise<WorkspaceDescription>;
  querySave(input:Operation&QueryInput):Promise<Revision&{query:SavedQuery}>;
  queryConfigure(input:Operation&{queryId:UUID}&Partial<QueryInput>):Promise<Revision&{query:SavedQuery}>;
  captureStart(input:Operation&{queryId:UUID;queryVersion?:number}):Promise<Revision&{capture:CaptureSummary}>;
  capturePause(input:Operation&{captureId:UUID}):Promise<Revision&{capture:CaptureSummary}>;
  captureResume(input:Operation&{captureId:UUID;connectionAlias?:string}):Promise<Revision&{capture:CaptureSummary}>;
  /** Runs native pages to exhaustion by default. maxPages explicitly pauses after that many accepted attempts. */
  captureRun(input:{captureId:UUID;signal?:AbortSignal;maxPages?:number}):
    Promise<Revision&{capture:CaptureSummary;edition:Edition|null}>;
  status(input:{captureId:UUID}):Promise<Revision&{capture:Capture&{pageCount:number;attemptCount:number}}>;
  edition(input:{editionId:UUID}):Promise<Revision&{edition:Edition}>;
  rows(input:({captureId:UUID;editionId?:never}|{editionId:UUID;captureId?:never})&{offset?:number;limit?:number}):Promise<RowsResult>;
  compare(input:{beforeEditionId:UUID;afterEditionId:UUID;offset?:number;limit?:number}):Promise<Comparison>;
  sourceExport(input:Operation&({captureId:UUID;editionId?:never}|{editionId:UUID;captureId?:never})):
    Promise<Revision&{export:SourceExport}>;
  deliveryExport(input:Operation&{editionIds:UUID[];captureIds?:UUID[];watchIds:UUID[]}):
    Promise<Revision&{export:SourceExport}>;
  sourceFile(input:{exportId:SHA256;path:string;offset?:number;length?:number|null}):Promise<SourceRange>;
  sourceReceive(input:ReceivingInput):Promise<Revision&SourceReceived>;
  deliveryReceive(input:ReceivingInput&{watchConnections?:Record<UUID,WatchReceivingConnection>}):
    Promise<Revision&DeliveryReceived>;
  close():Promise<void>;
}
export const WORKSPACE_SCHEMA: 'stellar-forge.stellar-indexer.workspace.v1';
export function validateQueryVersion(version:QueryVersion):QueryVersion;
export function inspectStellarIndexerWorkspace(options:{directory:string;allowMissing?:false}):
  Promise<{exists:true;id:UUID;workspaceId:UUID;revision:number;directory:string}>;
export function inspectStellarIndexerWorkspace(options:{directory:string;allowMissing:true}):
  Promise<{exists:true;id:UUID;workspaceId:UUID;revision:number;directory:string}|{exists:false;directory:string}>;
export function openStellarIndexerWorkspace(options:WorkspaceOptions):Promise<StellarIndexerWorkspace>;
