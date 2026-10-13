import type {
  DocumentSetup, NormalizedDocumentProvider, DocumentFormat, JsonValue
} from './index.mjs';
import type {
  JobServiceOptions, NormalizedJobServiceOptions, JobSourceFile, JobServiceSelection,
  JobService, JobServiceLaunch, JobServiceExit, JobWorkspaceIdentity
} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/index.mjs';

export interface DocumentServiceOptions extends Omit<JobServiceOptions, 'configPath' | 'directory'> {
  directory: string;
  configurationFile?: string | null;
}
export interface DocumentServiceSummary {
  name: string; publicOrigin: string; provider: NormalizedDocumentProvider;
  formats: DocumentFormat[]; nativePayments: boolean;
  paymentPerDocument: {[key: string]: JsonValue};
  supplierPrice: {[key: string]: JsonValue};
  workerCount: number; memoryLimitMb: number; maxPending: number; maxJobs: number;
  environmentReferences: string[];
  functions: Array<{
    id: string; path: string; description: string;
    payment: {[key: string]: JsonValue};
    inputFiles: {[key: string]: JsonValue};
    output: {[key: string]: JsonValue};
  }>;
  intake: {[key: string]: JsonValue};
  delivery: {[key: string]: JsonValue} | null;
}
export interface DocumentServiceSelection {
  schema: 'stellar-forge.document-service-selection.v1';
  selectionSha256: string; sourceDirectory: string; runtimeDirectory: string; directory: string;
  configurationFile: JobSourceFile | null; options: NormalizedJobServiceOptions;
  setup: {
    input: DocumentSetup; inputSha256: string; jobsConfig: string; merchantState: string;
    providerConfig: string; customerSetup: string;
    files: Array<{name: string; bytes: number; sha256: string}>;
  };
  sourceFiles: JobSourceFile[]; optionalFiles: JobSourceFile[];
  summary: DocumentServiceSummary;
}
export interface DocumentService extends JobService {
  documentSelection: DocumentServiceSelection;
}
export interface DocumentServiceControl {
  env?: NodeJS.ProcessEnv; signal?: AbortSignal; expectedSelection?: string;
  launchSourceDirectory?: string; launchFile?: string | null;
}
export interface DocumentServiceReceiving {
  documentSelection: DocumentServiceSelection;
  nativeSelection: JobServiceSelection;
  launch: JobServiceLaunch & {workspaceIdentity: JobWorkspaceIdentity};
}
export const DOCUMENT_SERVICE_SELECTION_SCHEMA: 'stellar-forge.document-service-selection.v1';
export const DOCUMENT_SERVICE_SOURCE: 'products/document-merchant';
export const DOCUMENT_SERVICE_SOURCE_FILES: readonly string[];
export function normalizeDocumentServiceOptions(options: DocumentServiceOptions): {
  directory: string; configurationFile: string | null; service: NormalizedJobServiceOptions;
};
export function assertDocumentServiceSource(launchSourceDirectory?: string): Promise<{
  sourceDirectory: string; launchSourceDirectory: string;
}>;
export function readDocumentServiceSources(): Promise<JobSourceFile[]>;
export function readDocumentServiceSelection(options: DocumentServiceOptions): Promise<DocumentServiceSelection>;
export function assertDocumentServiceSelection(value: unknown, expectedSha256?: string): DocumentServiceSelection;
export function openDocumentService(options: DocumentServiceOptions,
  control?: DocumentServiceControl): Promise<DocumentService>;
export function runDocumentServiceCommand(options: DocumentServiceOptions,
  control?: Omit<DocumentServiceControl, 'env'> & {print?: (text: string) => unknown}): Promise<JobServiceExit | undefined>;
export function readDocumentServiceLaunch(options: {
  options: DocumentServiceOptions; file: string; expectedSelection?: string;
  expected?: {pid?: number; instanceId?: string}; signal?: AbortSignal;
}): Promise<DocumentServiceReceiving>;
