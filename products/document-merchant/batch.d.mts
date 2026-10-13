import type {DocumentProviderId, DocumentJobFormat, DocumentInput, OriginalDocumentFile, JsonValue} from './index.mjs';
import type {JobWorkspace, NativeSettlement, JobWorkspaceOutputs} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/index.mjs';
import type {IntakeCatalog, IntakePayment} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/intake/index.mjs';

export const DOCUMENT_BATCH_SCHEMA: 'stellar-forge.document-batch.v1';
export const DOCUMENT_BATCH_PLAN_SCHEMA: 'stellar-forge.document-batch-plan.v1';
export const DOCUMENT_BATCH_SNAPSHOT_SCHEMA: 'stellar-forge.document-batch-snapshot.v1';
export interface DocumentBatchInput {
  schema: 'stellar-forge.document-batch.v1';
  id: string; name: string; provider: DocumentProviderId; merchantOrigin: string | null;
  documents: Array<{id: string; label?: string; source: string; format: DocumentJobFormat; input: DocumentInput}>;
}
export interface NormalizedDocumentBatchItem {
  id: string; label: string; source: string; sourcePath: string; format: DocumentJobFormat;
  functionId: 'renderHtml' | 'renderMarkdown' | 'assemblePdfs'; reference: string;
  input: {title: string; taskReference: string; settings: {[key: string]: JsonValue}};
}
export interface NormalizedDocumentBatch {
  schema: 'stellar-forge.document-batch.v1'; id: string; name: string; provider: DocumentProviderId;
  merchantOrigin: string; sourceRoot: string; documents: NormalizedDocumentBatchItem[];
}
export interface DocumentBatchPaymentTotal {
  scheme: string; network: string; asset: string; payTo: string; paymentFlow: string;
  documents: number; maximumAtomic: string;
}
export interface DocumentBatchPlanItem extends Omit<NormalizedDocumentBatchItem,'source'> {
  requestId: string; inputSha256: string; source: OriginalDocumentFile;
  sourcePath: string; payment: IntakePayment; purchaseUrl: string; functionSha256: string;
}
export interface DocumentBatchPlan {
  schema: 'stellar-forge.document-batch-plan.v1'; id: string; name: string; directory: string;
  workspaceDirectory: string; createdAt: string; inputSha256: string; input: NormalizedDocumentBatch;
  catalog: IntakeCatalog; items: DocumentBatchPlanItem[]; totals: DocumentBatchPaymentTotal[];
  unitMeaning: {documents: number; outputPackages: number; parentTaskReferences: number; customerAcceptedParentTasks: null};
}
export interface SavedDocumentBatch {plan: DocumentBatchPlan; sha256: string; bytes: number}
export interface DocumentBatchOutput {
  received: boolean; package: JobWorkspaceOutputs['package']; manifestSha256: string;
  job?: Extract<JobWorkspaceOutputs,{received:true}>['job'];
  policySha256?: string; selectionSha256?: string; directory?: string;
  files: Array<{slot: string; filename: string; contentType: string; bytes: number;
    sha256: string; path: string | null; resourceId: string | null}>;
}
export interface DocumentBatchRow {
  id: string; label: string; format: DocumentJobFormat; taskReference: string; reference: string;
  requestId: string; requestRevision: number; requestPhase: string; source: OriginalDocumentFile; payment: IntakePayment;
  checkoutId: string | null; checkoutPhase: string | null; checkoutIntent: string | null; checkoutAttempted: boolean;
  jobEntryId: string | null; jobId: string | null; nativeSettlement: NativeSettlement | null; jobState: string | null;
  received: boolean; state: string; error: string | null; packageResourceId: string | null; outputs: DocumentBatchOutput | null;
}
export interface DocumentBatchSnapshot {
  schema: 'stellar-forge.document-batch-snapshot.v1'; id: string; name: string; observedAt: string;
  workspaceDirectory: string; inputSha256: string; merchantOrigin: string; provider: DocumentProviderId;
  totals: DocumentBatchPaymentTotal[]; documents: number; counts: Record<string,number>; receivedDocuments: number;
  parentTasks: Array<{reference: string; documents: number; receivedDocuments: number;
    completeDocumentSet: boolean; customerAcceptance: null}>;
  rows: DocumentBatchRow[];
}
export interface DocumentBatchProgress {
  stage: 'SOURCE_STAGED' | 'DOCUMENT_RESULT' | 'DOCUMENT_RECEIVING'; index: number; total: number;
  itemId?: string; requestId?: string; source?: OriginalDocumentFile;
  outcome?: {id: string; requestId?: string; checkoutId?: string; jobEntryId?: string; state?: string; error?: string | null};
}
export type DocumentBatchProgressHandler = (value: DocumentBatchProgress) => void | Promise<void>;
export interface DocumentBatchContext {workspace: JobWorkspace; plan: DocumentBatchPlan; signal?: AbortSignal}
export interface DocumentBatchRunOptions extends DocumentBatchContext {
  approvedPlanSha256: string; planSha256: string; deadlineMs?: number; pollMs?: number;
  intakeAccessToken?: string; onProgress?: DocumentBatchProgressHandler;
}
export interface DocumentBatchReceiveOptions extends DocumentBatchContext {
  deadlineMs?: number; pollMs?: number; onProgress?: DocumentBatchProgressHandler;
}
export interface DocumentBatchOperation {
  kind: 'RUN' | 'RECEIVE'; outcomes: NonNullable<DocumentBatchProgress['outcome']>[];
  admission?: {itemId: string; code: string} | null; remainingUnvisited?: number;
}
export interface DocumentBatchSavedFile {name: string; bytes: number; sha256: string}
export interface DocumentBatchExport {
  schema: 'stellar-forge.document-batch-export.v1'; batchId: string; directory: string;
  collection: {id: string; revision: number; members: number};
  documents: number; receivedDocuments: number; observedAt: string;
  archive: {path: string; bytes: number; sha256: string};
  files: DocumentBatchSavedFile[];
}
export function documentBatchTemplate(provider?: DocumentProviderId): DocumentBatchInput;
export function normalizeDocumentBatch(value: DocumentBatchInput, options: {sourceRoot: string}): NormalizedDocumentBatch;
export function prepareDocumentBatch(options: {workspace: JobWorkspace; directory: string; request: DocumentBatchInput;
  sourceRoot: string; intakeAccessToken?: string | null; signal?: AbortSignal; onProgress?: DocumentBatchProgressHandler}): Promise<SavedDocumentBatch>;
export function readDocumentBatch(directory: string): Promise<SavedDocumentBatch>;
export function inspectDocumentBatch(options: DocumentBatchContext): Promise<DocumentBatchSnapshot>;
export function runDocumentBatch(options: DocumentBatchRunOptions): Promise<DocumentBatchSnapshot & {operation: DocumentBatchOperation}>;
export function receiveDocumentBatch(options: DocumentBatchReceiveOptions): Promise<DocumentBatchSnapshot & {operation: DocumentBatchOperation}>;
export function saveDocumentBatchReport(options: {snapshot: DocumentBatchSnapshot; plan: DocumentBatchPlan; directory: string}):
  Promise<{directory: string; files: DocumentBatchSavedFile[]}>;
export function exportDocumentBatch(options: DocumentBatchContext & {directory: string; maxBytes?: number}): Promise<DocumentBatchExport>;
export function receiveDocumentBatchCollection(options: {archive: string; destination: string; libraryState: string;
  expectedSha256: string; resume?: boolean; signal?: AbortSignal; maxBytes?: number}): Promise<{
    schema: 'stellar-forge.document-batch-receiving.v1'; receipt: Record<string,unknown>;
    library: ReturnType<JobWorkspace['library']['status']>; collection: ReturnType<JobWorkspace['library']['collections']['show']>;
  }>;
export {openJobWorkspace as openDocumentBatchCustomer} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/index.mjs';
