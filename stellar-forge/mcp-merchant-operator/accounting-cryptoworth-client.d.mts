export type NativeId = string;
export type Sha256 = string;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type NativeDocument = Record<string, any>;
export interface CallOptions { requestSignal?: AbortSignal; timeoutMs?: number; }
export interface FileOptions { expectedSha256?: Sha256; chunkBytes?: number; signal?: AbortSignal; }
export interface InputFile { source: string; name: string; sha256?: Sha256; bytes?: number; }
export interface ReviewedInputFile extends InputFile { sha256: Sha256; bytes: number; }
export interface DateMapping {
  format: 'ISO_UTC' | 'UTC_SECONDS' | 'UTC_DATE' | 'ZONE_SECONDS' | 'ZONE_DATE';
  timeZone: string;
  precision?: 'day' | 'second' | 'millisecond';
}
export type ColumnRole = 'date' | 'cryptoId' | 'type' | 'amountOne' | 'amountOneType' |
  'amountTwo' | 'amountTwoType' | 'transactionHash' | 'connectionId' | 'note' | 'ledgerId' | 'rowId';
export type Columns = Partial<Record<ColumnRole, string>>;
export interface ActorRequest { id?: NativeId; name: string; actor: string; createdAt?: string; }
export interface ProfileRequest extends ActorRequest {
  previousProfileId?: NativeId | null;
  file: InputFile;
  delimiter?: ',' | ';' | '\t';
  columns: Columns;
  constants: Record<string, string>;
  target: { entityId: string; entityName?: string; connectionId: string; connectionName?: string; merchantAccount: string };
  date: DateMapping;
  assets: Array<{ network: 'stellar:testnet' | 'stellar:pubnet'; assetDigest: Sha256; cryptoId: string; amountType: string; scale: number }>;
}
export interface PlanRequest extends ActorRequest {
  profileId: NativeId;
  handoffId: NativeId;
  accountantRevisionId: NativeId | 'initial';
  previousPlanId?: NativeId | null;
  decisions?: Array<{ movementId: Sha256; selectionId?: Sha256 | null; action: 'INCLUDE' | 'EXCLUDE' | 'ALREADY_IMPORTED'; reason?: string; reference?: string }>;
  dateEvidence?: Array<{ movementId: Sha256; transferAt: string; note: string; file: InputFile }>;
}
export interface NativeImport {
  id: string;
  entityId: string;
  connectionId: string;
  receivedAt: string;
  reference: string;
  note?: string;
}
export interface CaptureRequest extends ActorRequest {
  purpose: 'IMPORT_RETURN' | 'BASELINE';
  file: InputFile;
  nativeImport: NativeImport;
  layout: { kind: 'INPUT_FORMAT' | 'MAPPED_EXPORT'; delimiter?: ',' | ';' | '\t'; columns?: Columns; date?: DateMapping;
    amountConvention?: 'UNSIGNED' | 'SEND_NEGATIVE'; amountTwoConvention?: 'UNSIGNED' | 'SEND_NEGATIVE'; groupSeparator?: '' | ',' };
}
export interface ReturnRequest extends ActorRequest {
  captureId: NativeId;
  status: 'REVIEWED' | 'BOOKED';
  bookRef?: string;
  accountCode?: string | null;
  note?: string;
  expectedParentId: NativeId | null;
}
export interface RequestMap { profile: ProfileRequest; plan: PlanRequest; capture: CaptureRequest; return: ReturnRequest; }
export type OperationKind = keyof RequestMap;
export interface PageQuery { offset?: number; limit?: number; search?: string; status?: string; }
export interface WorkspaceResult { workspaceId: Sha256; revision: number; }
export interface RecordPage extends WorkspaceResult {
  page: { view: string; items: NativeDocument[]; total: number; offset: number; limit: number; nextOffset: number | null };
}
export interface RowPage extends WorkspaceResult { items: NativeDocument[]; totalRows: number; offset: number; limit: number; }
export interface NativeRecord {
  id: NativeId;
  requestSha256: Sha256;
  previewSha256?: Sha256;
  integrity?: { sha256: Sha256 };
  status?: 'PREPARED' | 'COMMITTED' | 'SUPERSEDED';
  [key: string]: unknown;
}
export interface Preview<K extends OperationKind = OperationKind> extends WorkspaceResult {
  kind: K;
  planId?: NativeId;
  request: RequestMap[K] & { id: NativeId; createdAt: string };
  workspaceRevision: number;
  previewSha256: Sha256;
  requestSha256: Sha256;
  wireSha256: Sha256;
  profile?: NativeDocument;
  plan?: NativeDocument;
  comparison?: NativeDocument;
  summary?: NativeDocument;
  accountantPreview?: NativeDocument;
  items?: NativeDocument[];
  totalRows?: number;
  offset?: number;
  limit?: number;
}
export interface SaveArguments<K extends OperationKind = OperationKind> {
  workspaceId: Sha256;
  planId?: NativeId;
  request: RequestMap[K] & { id: NativeId; createdAt: string; revision: number; previewSha256: Sha256 };
}
export interface SaveResult extends Partial<WorkspaceResult> {
  found: boolean;
  unresolved?: boolean;
  superseded?: boolean;
  recovered?: boolean;
  record?: NativeRecord;
  kind?: OperationKind;
  duplicate?: boolean;
  [key: string]: unknown;
}
export interface RollbackArguments {
  workspaceId: Sha256;
  planId: NativeId;
  request: { id: NativeId; captureId: NativeId; nativeImportId: string; completedAt: string; actor: string; reason: string; reference: string; revision: number };
}
export interface PacketInspection extends WorkspaceResult {
  schema: 'stellar-forge.cryptoworth-receiving-packet.v1';
  planId: NativeId;
  profileId: NativeId;
  sha256: Sha256;
  packetSha256: Sha256;
  name: string;
  bytes: number;
  file: ReviewedInputFile;
  summary: NativeDocument;
  plan: NativeDocument;
  profile: NativeDocument;
  existing: { planId: NativeId | null; received: boolean };
}
export interface PacketOptions { actor: string; name?: string; revision?: number; }
export interface PacketArguments {
  workspaceId: Sha256;
  file: ReviewedInputFile;
  revision: number;
  actor: string;
  name: string;
  expectedSha256: Sha256;
  expectedPacketSha256: Sha256;
}
export type FileSelection =
  { kind: 'cryptoworth'; profileId: NativeId; file: string } |
  { kind: 'cryptoworth'; planId: NativeId; file: string; captureId?: NativeId; returnId?: NativeId; rollbackId?: NativeId; scope?: 'stage' | 'completed' };
export interface FileChunk {
  readId: string;
  file: { name: string; bytes: number; sha256: Sha256; [key: string]: unknown };
  bytes: Uint8Array;
  offset: number;
  complete: boolean;
  nextOffset: number | null;
  [key: string]: unknown;
}
export interface ConnectionOptions {
  url: string;
  workspace: string;
  tokenEnv?: string;
  environment?: Record<string, string | undefined>;
  [key: string]: unknown;
}
export interface AccountingCryptoworthClient {
  readonly workspace: string;
  readonly endpoint?: string;
  open(options?: CallOptions): Promise<NativeDocument>;
  status(args?: { view?: 'summary' | 'profiles' | 'plans' | 'handoffs' | 'rollbacks'; offset?: number; limit?: number }, options?: CallOptions): Promise<NativeDocument>;
  sources(options?: CallOptions): Promise<NativeDocument>;
  source(args: PageQuery & { handoffId: NativeId; accountantRevisionId: NativeId | 'initial' }, options?: CallOptions): Promise<RowPage>;
  template(args: { file: InputFile; delimiter?: ',' | ';' | '\t' }, options?: CallOptions): Promise<WorkspaceResult & { file: ReviewedInputFile; template: NativeDocument; requiredRoles: string[]; suggestedColumns: Columns }>;
  profile(profileId: NativeId, options?: CallOptions): Promise<WorkspaceResult & { record: NativeRecord; profile: NativeDocument; files: NativeDocument[] }>;
  plan(planId: NativeId, args?: { view?: 'summary' | 'captures' | 'returns' | 'rollbacks' | 'files' | 'receivedPackets' | 'decisions' | 'dateEvidence'; offset?: number; limit?: number }, options?: CallOptions): Promise<NativeDocument>;
  rows(planId: NativeId, args?: PageQuery & { captureId?: NativeId }, options?: CallOptions): Promise<RowPage>;
  capture(planId: NativeId, captureId: NativeId, options?: CallOptions): Promise<WorkspaceResult & { record: NativeRecord; comparison: NativeDocument; files: NativeDocument[]; rollbacks: NativeDocument[] }>;
  returned(planId: NativeId, returnId: NativeId, options?: CallOptions): Promise<WorkspaceResult & { record: NativeRecord; files: NativeDocument[] }>;
  rollbackRecord(rollbackId: NativeId, options?: CallOptions): Promise<WorkspaceResult & { record: NativeRecord }>;
  allStatus(view: 'profiles' | 'plans' | 'handoffs' | 'rollbacks', options?: CallOptions): Promise<WorkspaceResult & { items: NativeDocument[]; total: number }>;
  allPlan(planId: NativeId, view: 'captures' | 'returns' | 'rollbacks' | 'files' | 'receivedPackets' | 'decisions' | 'dateEvidence', options?: CallOptions): Promise<WorkspaceResult & { items: NativeDocument[]; total: number }>;
  allRows(planId: NativeId, args?: PageQuery & { captureId?: NativeId }, options?: CallOptions): Promise<WorkspaceResult & { items: NativeDocument[]; total: number }>;
  preview<K extends OperationKind>(kind: K, request: RequestMap[K], selection?: PageQuery & { planId?: NativeId }, options?: CallOptions): Promise<Preview<K>>;
  reconcile(preview: Preview, options?: CallOptions): Promise<SaveResult>;
  save(preview: Preview, options?: CallOptions): Promise<SaveResult>;
  reconcileRollback(value: RollbackArguments, options?: CallOptions): Promise<SaveResult>;
  rollback(value: RollbackArguments, options?: CallOptions): Promise<SaveResult>;
  inspectPacket(file: InputFile, options?: CallOptions): Promise<PacketInspection>;
  reconcilePacket(inspection: PacketInspection, options?: CallOptions): Promise<SaveResult>;
  receivePacket(inspection: PacketInspection, selection: PacketOptions, options?: CallOptions): Promise<SaveResult>;
  registerFileRead(readId: string): NativeDocument;
  releaseFile(readId: string, options?: CallOptions): Promise<NativeDocument>;
  drainFileReads(): Promise<NativeDocument>;
  fileChunks(selection: FileSelection, options?: FileOptions): AsyncGenerator<FileChunk>;
  disconnect(): Promise<unknown>;
  closeWorkspace(options?: CallOptions): Promise<NativeDocument>;
}
export function accountingCryptoworthPreview<K extends OperationKind>(value: Preview<K>): Preview<K>;
export function accountingCryptoworthSaveArguments<K extends OperationKind>(preview: Preview<K>): SaveArguments<K>;
export function accountingCryptoworthRollbackArguments(value: RollbackArguments): RollbackArguments;
export function accountingCryptoworthPacketArguments(inspection: PacketInspection, options: PacketOptions): PacketArguments;
export function createAccountingCryptoworthClient(options: {
  workspace: string;
  call: (name: string, args: Record<string, unknown>, options?: CallOptions) => Promise<NativeDocument>;
}): AccountingCryptoworthClient;
export function connectAccountingCryptoworthClient(options: ConnectionOptions): Promise<AccountingCryptoworthClient>;
