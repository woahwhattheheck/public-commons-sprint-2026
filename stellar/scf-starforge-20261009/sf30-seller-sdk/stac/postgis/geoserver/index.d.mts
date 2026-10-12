/// <reference types="node" />
export type Sha256 = string;
export type OperationId = string;
export type NativeJson = null | boolean | number | string | NativeJson[] | { [key: string]: NativeJson };
export interface AuthorizationReference { scheme: 'Basic' | 'Bearer' | 'ApiKey'; authorizationEnv: string; }
export interface GeoServerReader { id: string; roles: string[]; authorization: AuthorizationReference; }
export interface GeoServerDatabase {
  profileId: string; host: string; port?: number; name: string; schema: string; role: string;
  primaryKeyMetadataTable: string;
}
export interface GeoServerProfile {
  schema: 'starforge.geoserver-profile.v1'; id: string; baseUrl: string; workspace: string; datastore: string;
  database: GeoServerDatabase; administrator: AuthorizationReference; readers: GeoServerReader[];
  transport?: Record<string, unknown>; allowLoopback?: boolean; timeoutMs?: number;
  pageBytes?: number; totalBytes?: number; maxPages?: number; pageSize?: number; python?: string;
}
export interface GeoServerPublicProfile {
  schema: GeoServerProfile['schema']; id: string; baseUrl: string; workspace: string; datastore: string;
  database: Required<GeoServerDatabase>; readers: Array<Pick<GeoServerReader, 'id' | 'roles'>>;
  limits: { pageBytes: number; totalBytes: number; maxPages: number; pageSize: number };
}
export interface LayerPublication {
  layerId: string; name?: string; title?: string; abstract?: string; enabled?: boolean; advertised?: boolean;
  style: { name: string; workspace?: string | null; file?: string; sha256?: Sha256; format?: 'sld' | 'se' };
  access: { read: string[]; write: string[] };
  map?: { bbox: [string, string, string, string]; width?: number; height?: number };
}
export interface PreparePublication {
  operationId: OperationId; receivingDirectory: string; manifestSha256: Sha256;
  layers: LayerPublication[]; expectedPublication?: OperationId | null; kind?: 'publish' | 'refresh';
}
export interface PrepareRollback {
  operationId: OperationId; publicationId: OperationId; receivingDirectory: string;
  manifestSha256: Sha256; expectedPublication?: OperationId | null;
}
export interface ApplyPublication { operationId: OperationId; reviewSha256: Sha256; }
export interface ExportReceiving { operationId: OperationId; directory: string; archiveFile?: string; }
export interface OperationOptions { signal?: AbortSignal; }
export interface SourceFile { path: string; bytes: number; sha256: Sha256; }
export interface NativeReaderBinding {
  schema: 'starforge.geoserver-native-reader-binding.v1'; profileSha256: Sha256; readerSha256: Sha256;
}
export interface GeoServerConfiguration {
  profile: GeoServerProfile; reader: Record<string, unknown>; profileFile: string; readerFile: string;
  nativeBinding: NativeReaderBinding; hostSources: Array<{ name: string; bytes: Buffer }>;
}
export interface ConfigurationOptions extends OperationOptions {
  profileFile: string; readerFile: string; expectedProfileSha256?: Sha256; expectedReaderSha256?: Sha256;
}
export interface OperatorOptions extends ConfigurationOptions {
  directory: string; environment?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch;
}
export interface VerificationRequest extends OperationOptions {
  directory: string; expectedManifestSha256: Sha256; role: string; requireUnchangedRows: true;
}
export interface NativePostgisVerification {
  verified: true; manifestFile: SourceFile; manifest: Record<string, unknown>; profile: Record<string, unknown>;
  current: { projectId: string; editionId: string; revision: number; database: string;
    role: string; sessionRole: string; readOnly: true; [key: string]: unknown };
  observations: { allAcceptedRowsMatch: true; layers: unknown[] };
}
export interface PublisherOptions {
  directory: string; profile: GeoServerProfile;
  verifyReceiving: (request: VerificationRequest) => Promise<NativePostgisVerification>;
  environment?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; nativeBinding?: NativeReaderBinding | null;
  hostSources?: Array<{ name: string; bytes: Buffer }>;
}
export interface GeoServerArchive {
  schema: 'starforge.geoserver-archive.v1'; path: string; bytes: number; sha256: Sha256; manifestSha256: Sha256;
}
export interface OperationState {
  schema: 'starforge.geoserver-operation.v1'; id: OperationId; state: string; kind: 'publish' | 'refresh' | 'rollback';
  requestSha256: Sha256; reviewSha256?: Sha256; profileSha256: Sha256; createdAt: string;
  steps: Array<Record<string, unknown>>; history: Array<Record<string, unknown>>;
  receiving?: Record<string, unknown>; receivingProgress?: Record<string, unknown>;
  exports?: Array<{ directory: string; manifestSha256: Sha256; at: string; archive?: GeoServerArchive }>;
  [key: string]: unknown;
}
export interface PublicationRequest {
  schema: 'starforge.geoserver-publication-request.v1'; operationId: OperationId; projectId: string;
  kind: 'publish' | 'refresh' | 'rollback'; receivingDirectory: string; manifestSha256: Sha256;
  profile: GeoServerPublicProfile; layers: LayerPublication[]; expectedPublication: OperationId | null;
  publicationId?: OperationId;
}
export interface PublicationReview {
  schema: 'starforge.geoserver-publication-review.v1'; operationId: OperationId; requestSha256: Sha256;
  kind: 'publish' | 'refresh' | 'rollback'; direction?: 'reverse'; createdAt: string;
  steps: Array<Record<string, unknown>>; [key: string]: unknown;
}
export interface OperationInspection { state: OperationState; request: PublicationRequest; review: PublicationReview | null; }
export interface WorkspaceInspection {
  profile: GeoServerPublicProfile; publication: Record<string, unknown> | null;
  running: { id: OperationId; startedAt: string } | null; operations: OperationState[];
}
export interface PreparedPublication { state: OperationState; review: PublicationReview; reviewSha256: Sha256; }
export interface PublicationResult { state: OperationState; review: PublicationReview; publication: Record<string, unknown> | null; }
export interface GeoServerReceiving {
  directory: string; manifestSha256: Sha256;
  manifest: { schema: 'starforge.geoserver-receiving.v1'; exportId: Sha256; operationId: OperationId; projectId: string;
    requestSha256: Sha256; reviewSha256: Sha256; postgisManifestSha256: Sha256; files: SourceFile[]; [key: string]: unknown };
  operation: { id: OperationId; state: string; kind: string; projectId: string };
  postgis: { editionId: string; revision: number }; native: Array<Record<string, unknown>>; archive?: GeoServerArchive;
}
export interface ServiceCatalog {
  workspace: Record<string, unknown>; datastore: Record<string, unknown>; roles: string[];
  styles: Array<{ name: string; workspace: string | null }>; nativeViews: string[];
}
export interface GeoServerPublisher {
  directory: string; profile: GeoServerPublicProfile;
  prepare(input: PreparePublication, options?: OperationOptions): Promise<PreparedPublication>;
  apply(input: ApplyPublication, options?: OperationOptions): Promise<PublicationResult>;
  reconcile(input: { operationId: OperationId }, options?: OperationOptions):
    Promise<{ state: OperationState; review: PublicationReview; conflicts: unknown[] }>;
  prepareRollback(input: PrepareRollback, options?: OperationOptions): Promise<PreparedPublication>;
  receive(input: { operationId: OperationId }, options?: OperationOptions):
    Promise<{ state: OperationState; receiving: Record<string, unknown> }>;
  exportReceiving(input: ExportReceiving, options?: OperationOptions): Promise<GeoServerReceiving>;
  describe(): Promise<ServiceCatalog>;
  inspect(): Promise<WorkspaceInspection>;
  inspect(id: OperationId): Promise<OperationInspection>;
  readMap(input: { operationId: OperationId; readerId: string; layerId: string }):
    Promise<{ bytes: Buffer; sha256: Sha256; contentType: 'image/png' }>;
  exportDescriptor(input: { operationId: OperationId; manifestSha256: Sha256 }):
    Promise<{ directory: string; manifestSha256: Sha256; at: string; archive: GeoServerArchive }>;
  cancel(input: { operationId: OperationId }): { operationId: OperationId; state: 'CANCELLING' | 'NO_ACTIVE_OPERATION' };
  close(): Promise<void>;
}
export interface GeoServerOperator extends GeoServerPublisher {
  configuration: NativeReaderBinding & { profileFile: string; readerFile: string; profile: GeoServerPublicProfile };
}
export interface ConsoleLaunch {
  schema: 'starforge.geoserver-console-launch.v1'; workspace: string; instanceId: string;
  url: string; origin: string; connectionFile: string; profile: GeoServerPublicProfile;
}
export interface GeoServerConsole extends ConsoleLaunch { finished: Promise<{ state: 'CLOSED' }>; close(): Promise<void>; }
export interface ConsoleActionInputs {
  prepare: PreparePublication; apply: ApplyPublication; reconcile: { operationId: OperationId };
  prepareRollback: PrepareRollback; receive: { operationId: OperationId }; exportReceiving: ExportReceiving;
}
export interface ConsoleJob { id: string; action: keyof ConsoleActionInputs; operationId: OperationId;
  state: 'RUNNING' | 'COMPLETED' | 'INTERRUPTED'; startedAt: string; finishedAt?: string;
  result?: Record<string, unknown>; error?: { code: string; message: string }; }
export interface GeoServerConsoleClient {
  connection: { schema: 'starforge.geoserver-console-connection.v1'; connectionFile: string; origin: string;
    instanceId: string; workspace: string; profile: GeoServerPublicProfile };
  run<A extends keyof ConsoleActionInputs>(action: A, input: ConsoleActionInputs[A], options?: OperationOptions):
    Promise<OperationInspection & { job: ConsoleJob }>;
  inspect(id?: OperationId, options?: OperationOptions): Promise<OperationInspection | WorkspaceInspection>;
  target(options?: OperationOptions): Promise<ServiceCatalog>;
  source(input: { directory: string; manifestSha256?: Sha256 }, options?: OperationOptions): Promise<Record<string, unknown>>;
  cancel(input: { operationId: OperationId }, options?: OperationOptions): Promise<{ operationId: OperationId; state: string }>;
  close(): Promise<void>;
}
export function readGeoServerConfiguration(options: ConfigurationOptions): Promise<GeoServerConfiguration>;
export function openGeoServerOperator(options: OperatorOptions): Promise<GeoServerOperator>;
export function openGeoServerPublisher(options: PublisherOptions): Promise<GeoServerPublisher>;
export function startGeoServerConsole(options: OperatorOptions & { port?: number }): Promise<GeoServerConsole>;
export function openGeoServerConsoleClient(options: OperationOptions & { connectionFile: string; expectedInstanceId?: string }):
  Promise<GeoServerConsoleClient>;
export function inspectGeoServerReceiving(directory: string, options?: OperationOptions & { expectedManifestSha256?: Sha256 }): Promise<GeoServerReceiving>;
export function adoptGeoServerReceiving(options: OperationOptions & { directory: string; outputDirectory: string; expectedManifestSha256: Sha256 }):
  Promise<{ schema: 'starforge.geoserver-adoption-result.v1'; directory: string; manifestSha256: Sha256;
    operation: GeoServerReceiving['operation']; profileFile: string; readerFile: string }>;
export function createGeoServerArchive(options: OperationOptions & { directory: string; archiveFile: string; manifestSha256: Sha256; python?: string }): Promise<GeoServerArchive>;
export function normalizeProfile(input: GeoServerProfile): GeoServerProfile;
export function normalizeSelection(input: LayerPublication[], receipt: unknown, profile: GeoServerProfile): LayerPublication[];
export function validateReceipt(receipt: unknown): Record<string, unknown>;
export function publicProfile(profile: GeoServerProfile): GeoServerPublicProfile;
export function parseExactJSON(text: string): unknown;
export function canonical(value: unknown): string;
export function nativeBytes(value: unknown): Buffer;
export const PROFILE_SCHEMA: 'starforge.geoserver-profile.v1';
export const REQUEST_SCHEMA: 'starforge.geoserver-publication-request.v1';
export const REVIEW_SCHEMA: 'starforge.geoserver-publication-review.v1';
export const RECEIVING_SCHEMA: 'starforge.geoserver-receiving.v1';
export function runGeoServerCli(argv?: string[], options?: OperationOptions & {
  environment?: NodeJS.ProcessEnv; stdout?: NodeJS.WritableStream; stderr?: NodeJS.WritableStream; processSignals?: boolean;
}): Promise<Record<string, unknown> & { exitCode?: number }>;
