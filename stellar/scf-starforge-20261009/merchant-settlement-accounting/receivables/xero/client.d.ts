import type {Currency, Customer, InvoiceSummary, CreditSummary, MutationContext, Money, DateOnly} from '../client.mjs';
export type {Currency, Customer, InvoiceSummary, CreditSummary, MutationContext, Money, DateOnly} from '../client.mjs';

export type XeroDateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY';
export type XeroPackageState = 'PREPARED' | 'PARTIAL' | 'RECEIVED';
export type XeroResolutionStatus = 'UNRESOLVED' | 'REJECTED' | 'IMPORTED' | 'MISMATCH' | 'CONFLICT';
export interface XeroOriginalFile { name: string; dataBase64: string }
export interface XeroFileReference {
  name: string; type: string; bytes: number; sha256: string; role: string;
  documentIds?: string[]; rowCount?: number;
}
export interface XeroTemplateReference { name: string; sha256: string; bytes: number; headers: string[] }
export interface XeroContactMapping { customerId: string; contactName: string }
export interface XeroLineMapping { documentId: string; lineId: string; accountCode: string; taxType: string }
export interface XeroProfileFields {
  name: string; organisation: string; currency: Currency;
  invoiceDateFormat: XeroDateFormat; creditDateFormat: XeroDateFormat;
  accountCode: string; taxType: string;
  contacts?: XeroContactMapping[]; lineMappings?: XeroLineMapping[];
}
export type SaveXeroProfile = MutationContext & XeroProfileFields & (
  {id?: never; expectedVersion?: never; invoiceTemplate: XeroOriginalFile; creditTemplate: XeroOriginalFile} |
  {id: string; expectedVersion: number; invoiceTemplate?: XeroOriginalFile; creditTemplate?: XeroOriginalFile}
);
export interface XeroProfile extends XeroProfileFields {
  id: string; version: number; contacts: XeroContactMapping[]; lineMappings: XeroLineMapping[];
  invoiceTemplate: XeroTemplateReference; creditTemplate: XeroTemplateReference;
}
export interface XeroSelection {
  profileId: string; documentIds: string[]; asOf: DateOnly; parentId?: string;
}
export type XeroPreviewSelection = XeroSelection | {profileId: string; parentId: string; documentIds?: string[]; asOf?: DateOnly};
export interface XeroReviewedSelection extends XeroSelection { profileVersion: number }
export interface XeroPreviewIssue { code: string; message: string; documentId?: string; lineId?: string }
export interface XeroDocument {
  id: string; kind: 'INVOICE' | 'CREDIT_NOTE'; number: string;
  customerId: string; customerName: string; contactName: string; currency: Currency; date: DateOnly;
  /** Canonical decimal amounts, for example "124.00"; preserve them as strings. */
  net: Money; tax: Money; total: Money;
  lineCount: number; sourceSha256: string; invoiceId: string | null; invoiceNumber: string | null;
}
export interface XeroTotals {
  invoices: {net: Money; tax: Money; total: Money};
  credits: {net: Money; tax: Money; total: Money}; currency: Currency;
}
export interface XeroPreview {
  schema: string; revision: number; profile: XeroProfile; ready: boolean; issues: XeroPreviewIssue[];
  selection: XeroReviewedSelection; previewSha256: string;
  documents: XeroDocument[]; totals: XeroTotals; files: XeroFileReference[]; sourceFingerprint: string;
}
export type PrepareXeroPackage = MutationContext & XeroSelection & {previewSha256: string};
export interface XeroResultColumns {
  documentNumber: string; documentId: string; status: string;
  net: string; tax: string; total: string; currency: string; error?: string;
}
export interface XeroReceiveContext extends MutationContext {
  file: XeroOriginalFile; importedStatusValues?: string[]; retiredStatusValues?: string[];
  receivedAt: string; organisation: string;
}
export type ReceiveXeroResult = XeroReceiveContext & (
  {format: 'NATIVE_JSON'; columns?: never; decimalSeparator?: never; groupSeparator?: never; creditSign?: never} |
  {format?: 'CSV_SUMMARY'; columns: XeroResultColumns; decimalSeparator?: '.' | ','; groupSeparator?: '' | ',' | '.' | ' '; creditSign?: 'POSITIVE' | 'NEGATIVE'}
);
export interface CorrectXeroPackage extends MutationContext {
  profileId: string; documentIds?: string[]; asOf?: DateOnly; previewSha256: string;
}
export interface XeroResolution {
  documentId: string; documentNumber: string; status: XeroResolutionStatus;
  externalDocumentId?: string | null; externalDocumentIds: string[]; externalStatus?: string | null; message: string;
  sourceSha256: string; imported: boolean; latestPackageId: string; activeExternalDocumentIds: string[]; sourcePointers?: string[];
  importId?: string; packageId?: string; fileName?: string; sourceRowNumbers: number[]; canCorrect: boolean;
}
export interface XeroReturnedRow {
  rowNumbers: number[]; sourcePointers?: string[]; documentId: string; documentNumber: string; status: XeroResolutionStatus;
  externalDocumentId: string; externalStatus: string; error: string; sourceSha256: string;
  net: Money; tax: Money; total: Money; currency: string | Currency;
}
export interface XeroNativeDocument {
  collection?: string; index?: number; pointer: string; kind: string | null; number: string; id: string;
  type?: string; kindSource?: string; status: string; currency: string;
  amounts: {net: string; tax: string; total: string; rounding?: string};
  canonicalAmounts?: {net?: Money; tax?: Money; total?: Money; rounding?: Money};
  providerRejected?: boolean; validationPointers?: string[]; lineItemCount?: number; lineItemsPresent?: boolean; excludedReason?: string | null;
  /** Full source fields are supplied by the retained interpretation report; compact detail may omit them. */
  fields?: Record<string, string>; lineItems?: Array<{pointer: string; original: unknown; fields?: Record<string, string>}>;
  original?: unknown; issues?: unknown[];
}
export interface XeroNativeMetadata {
  schema: string; sourceKind: string; collections: Array<{name: string; pointer: string; count: number}>;
  envelope: Record<string, unknown>; documentCount: number; consideredCount: number;
  excludedDocuments?: unknown[]; excludedDocumentCount?: number; documents: XeroNativeDocument[];
  numberEncoding?: string; monetaryConvention?: string;
  /** Every original JSON numeric token is retained in the interpretation report. */
  numericTokens?: Array<{pointer: string; lexeme: string}>; numericTokenCount?: number;
}
export interface XeroReceivedImport {
  format: 'NATIVE_JSON' | 'CSV_SUMMARY'; native?: XeroNativeMetadata; retiredStatusValues?: string[];
  id: string; packageId: string; receivedAt: string; recordedAt: string; actor: string; organisation: string;
  file: {name: string; sha256: string; bytes: number}; fileName: string; reportName: string;
  columns?: XeroResultColumns; decimalSeparator?: '.' | ','; groupSeparator?: '' | ',' | '.' | ' ';
  creditSign?: 'POSITIVE' | 'NEGATIVE'; importedStatusValues: string[];
  rows: XeroReturnedRow[]; unmatchedRows: number[]; sourceRowCount?: number; organisationKey?: string;
}
export interface XeroPackageSummary {
  id: string; title: string; createdAt: string; actor: string; profileId: string; profileVersion: number;
  organisation: string; asOf: DateOnly; parentId: string | null;
  documentCount: number; state: XeroPackageState; resolvedCount: number; unresolvedCount: number; correctableCount: number; totals: XeroTotals;
}
export interface XeroHistoryEntry {
  at?: string; recordedAt?: string; actor?: string; action?: string; type?: string;
  id?: string; requestId?: string; [key: string]: unknown;
}
export interface XeroPackage extends XeroPackageSummary {
  schema: string; sourceFingerprint: string; previewSha256: string; family: XeroPackageSummary[];
  selection: XeroReviewedSelection; documents: XeroDocument[]; files: XeroFileReference[];
  profile: XeroProfile; imports: XeroReceivedImport[]; resolutions: XeroResolution[]; history: XeroHistoryEntry[];
}
export interface XeroState {
  schema: string; revision: number; asOf: DateOnly; workspaceId: string; sourcesSha256: string;
  profiles: XeroProfile[]; packages: XeroPackageSummary[];
  customers: Customer[]; invoices: InvoiceSummary[]; credits: CreditSummary[];
}
export interface XeroDetail { package: XeroPackage; revision: number }
export interface XeroOperation {
  id: string; action: string; actor: string; at: string; intentSha256: string; replayed: boolean;
  result: {xeroProfileId?: string; xeroProfileVersion?: number; xeroPackageId?: string; importId?: string; [key: string]: unknown};
}
export interface XeroProfileMutationResult { profile: XeroProfile; revision: number; operation: XeroOperation }
export interface XeroPackageMutationResult { package: XeroPackage; revision: number; operation: XeroOperation }
export type XeroExportRecord = XeroPackage;
export interface XeroClientOptions { baseUrl?: string; fetch?: typeof globalThis.fetch }
export interface XeroErrorOptions {
  status?: number; code?: string; details?: unknown; requestId?: string | null; response?: unknown;
}
export class XeroReceivablesApiError extends Error {
  constructor(message: string, options?: XeroErrorOptions);
  status: number; code: string; details: unknown; requestId: string | null; response: unknown;
}
export class XeroReceivablesClient {
  constructor(options?: XeroClientOptions);
  baseUrl: string; fetch: typeof globalThis.fetch;
  request(path: string, options: {method?: string; body?: unknown; signal?: AbortSignal; binary: true}): Promise<Response>;
  request<T = unknown>(path: string, options?: {method?: string; body?: unknown; signal?: AbortSignal; binary?: false}): Promise<T>;
  state(query?: {asOf?: DateOnly}): Promise<XeroState>;
  saveProfile(value: SaveXeroProfile): Promise<XeroProfileMutationResult>;
  preview(value: XeroPreviewSelection): Promise<XeroPreview>;
  prepare(value: PrepareXeroPackage): Promise<XeroPackageMutationResult>;
  detail(id: string): Promise<XeroDetail>;
  receive(id: string, value: ReceiveXeroResult): Promise<XeroPackageMutationResult>;
  correct(id: string, value: CorrectXeroPackage): Promise<XeroPackageMutationResult>;
  file(id: string, name: string): Promise<Response>;
  export(id: string): Promise<XeroExportRecord>;
  exportFile(id: string, name?: string): Promise<Response>;
}
export function createXeroReceivablesClient(options?: XeroClientOptions): XeroReceivablesClient;
