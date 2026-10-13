export type DocumentProviderId = 'mintpdf' | 'snaplab' | 'pdfmint';
export type DocumentFormat = 'html' | 'markdown';
export type DocumentJobFormat = DocumentFormat | 'pdf-set';
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};
export interface DocumentProviderConfiguration {
  schema: 'stellar-forge.document-provider.v1';
  provider: DocumentProviderId;
  plan?: string;
  authentication?: 'bearer' | 'anonymous';
  keyEnvironment?: string | null;
  maxSourceBytes?: number;
  maxPdfBytes?: number;
  timeoutMs?: number;
}
export interface NormalizedDocumentProvider extends DocumentProviderConfiguration {
  plan: string;
  authentication: 'bearer' | 'anonymous';
  keyEnvironment: string | null;
  maxSourceBytes: number;
  maxPdfBytes: number;
  timeoutMs: number;
}
export interface DocumentSupplierPlan {
  id: string; label: string; currency: 'USD'; priceMinor: number;
  units: number; period: string; concurrency: number | null;
  requestsPerMinute: number | null;
}
export interface DocumentProvider {
  id: DocumentProviderId; name: string; origin: string; path: string; usagePath: string;
  formats: DocumentFormat[]; defaultKeyEnvironment: string; anonymous: boolean;
  unit: string; maxSourceBytes: number; maxRequestBytes: number; limitBasis: string;
  plans: DocumentSupplierPlan[]; sources: string[]; responseHeaders: string[];
  billing: string; checkedOn: string;
}
export interface OriginalDocumentFile {
  schema: 'stellar-forge.job-input-file.v1';
  filename: string; contentType: string; bytes: number; sha256: string; policySha256: string;
}
export interface DocumentInput {
  title: string; taskReference: string;
  settings?: {[key: string]: JsonValue};
  $files?: {[slot: string]: OriginalDocumentFile};
}
export interface DocumentSetup {
  schema: 'stellar-forge.document-merchant-setup.v1';
  serviceName: string; publicOrigin: string | null;
  payment: {[key: string]: JsonValue};
  provider: DocumentProviderConfiguration;
  formats?: DocumentFormat[]; pathPrefix?: string;
  assembly?: {payment:{[key:string]:JsonValue}};
  workerCount?: number; maxPending?: number; maxJobs?: number; memoryLimitMb?: number;
  inputStorage?: {maxBytes?: number; maxUploads?: number};
  intakeKeyEnvironment?: string | null;
}
export interface DocumentInstallation {
  schema: 'stellar-forge.document-merchant-installation.v1';
  setupId: string; directory: string; inputSha256: string; sourceCheckedOn: string;
  planSha256: string; jobsConfig: string; merchantState: string; providerConfig: string;
  customerSetup: string; source: {[key: string]: JsonValue};
  provider: NormalizedDocumentProvider; payment: {[key: string]: JsonValue};
  functions: string[]; workerCount: number; maxPending: number; environmentNames: string[];
  files: Array<{name: string; bytes: number; sha256: string}>;
}
export interface DocumentPreparationReview {
  schema: 'stellar-forge.document-merchant-review.v1'; state: 'NEW' | 'INCOMPLETE' | 'PREPARED';
  directory: string; input: DocumentSetup; inputSha256: string; request: DocumentSetup;
  jobsConfig: string; merchantState: string; providerConfig: string; customerSetup: string;
  files: Array<{name: string; bytes: number; sha256: string}>;
  configuration: {[key: string]: JsonValue}; supplierPrice: {[key: string]: JsonValue};
  setupId?: string; planSha256?: string;
}
export interface DocumentWorkerContext {
  jobId: string; attemptId: string; signal?: AbortSignal;
  files: {
    metadata(slot: string): OriginalDocumentFile;
    read(slot: string, options: {maxBytes: number}): Promise<Uint8Array>;
  };
}
export interface DocumentOutputFiles {
  pdf: Uint8Array; source: Uint8Array; request: Uint8Array; render: Uint8Array;
}
export interface DocumentFetchOptions {
  signal?: AbortSignal;
  environment?: {[name: string]: string | undefined};
  fetchImplementation?: typeof fetch;
}
export const DOCUMENT_SETUP_SCHEMA: 'stellar-forge.document-merchant-setup.v1';
export const DOCUMENT_PROVIDER_SCHEMA: 'stellar-forge.document-provider.v1';
export const DOCUMENT_RENDER_SCHEMA: 'stellar-forge.document-render.v1';
export const DOCUMENT_PLAN_SCHEMA: 'stellar-forge.document-merchant-plan.v1';
export const DOCUMENT_INSTALLATION_SCHEMA: 'stellar-forge.document-merchant-installation.v1';
export const DOCUMENT_REVIEW_SCHEMA: 'stellar-forge.document-merchant-review.v1';
export const SOURCE_CHECKED_ON: string;
export function documentProviders(): DocumentProvider[];
export function documentProvider(id: DocumentProviderId): DocumentProvider;
export function normalizeDocumentProvider(value: DocumentProviderConfiguration): NormalizedDocumentProvider;
export function documentSettingsSchema(id: DocumentProviderId): {[key: string]: JsonValue};
export function defaultDocumentSettings(id: DocumentProviderId): {[key: string]: JsonValue};
export function documentInputSchema(provider: DocumentProviderId, format: DocumentJobFormat): {[key: string]: JsonValue};
export function normalizeDocumentInput(provider: DocumentProviderId, format: DocumentJobFormat, input: DocumentInput):
  {title: string; taskReference: string; settings: {[key: string]: JsonValue}};
export function buildDocumentRequest(configuration: DocumentProviderConfiguration, format: DocumentJobFormat,
  input: DocumentInput, sourceText: string): {
    provider: DocumentProviderId; url: string; method: 'POST'; contentType: 'application/json';
    bodyText: string; input: {title: string; taskReference: string; settings: {[key: string]: JsonValue}};
    config: NormalizedDocumentProvider;
  };
export function documentPriceReview(configuration: DocumentProviderConfiguration,
  counts?: {documents?: number; supplierUnits?: number}): {[key: string]: JsonValue};
export function documentSetupTemplate(provider?: DocumentProviderId, options?: {anonymous?: boolean; assembly?: boolean}): DocumentSetup;
export function normalizeDocumentSetup(value: DocumentSetup): DocumentSetup;
export function documentJobConfiguration(request: DocumentSetup): {[key: string]: JsonValue};
export function prepareDocumentMerchant(input: {directory: string; request: DocumentSetup}): Promise<DocumentInstallation>;
export function inspectDocumentMerchant(directory: string): Promise<DocumentInstallation>;
export function reviewDocumentMerchant(options: {directory: string; request?: DocumentSetup}): Promise<DocumentPreparationReview>;
export function readDocumentSetupRequest(path: string): Promise<DocumentSetup>;
export function renderDocumentBytes(configuration: DocumentProviderConfiguration, format: DocumentJobFormat,
  input: DocumentInput, sourceBytes: Uint8Array, options?: DocumentFetchOptions & {
    jobId?: string | null; attemptId?: string | null; sourceDescriptor?: OriginalDocumentFile | null;
  }): Promise<DocumentOutputFiles>;
export function renderPaidDocument(configuration: DocumentProviderConfiguration, format: DocumentJobFormat,
  input: DocumentInput, context: DocumentWorkerContext): Promise<DocumentOutputFiles>;
export function readDocumentSupplierUsage(configuration: DocumentProviderConfiguration,
  options?: DocumentFetchOptions): Promise<{
    schema: 'stellar-forge.document-supplier-usage.v1'; provider: DocumentProviderId;
    observedAt: string; url: string; status: number; bytes: number; sha256: string; account: JsonValue;
  }>;
export * from './batch.mjs';
export * from './batch-render.mjs';
export * from './launch.mjs';
export * from './composition.mjs';

export * from './composition-workspace.mjs';
export * from './composition-server.mjs';

export * from './composition-service.mjs';

export * from './assembly.mjs';

export * from './commissioning.mjs';

export * from './commissioning-application.mjs';
export * from './assembly-workspace.mjs';
