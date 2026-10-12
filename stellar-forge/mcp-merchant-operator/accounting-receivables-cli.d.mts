// MIT. Declarations for original receivables command line operations and file delivery.
import type {
  AccountingReceivablesClient, CompleteInvoicePreview, NativeRecord, PaymentRequestPreview, RefundPreview, CreditDispositionPreview, BankPostingPreview,
  ReceivablesArgumentsMap, ReceivablesFileMetadata, ReceivablesFileSelection, ReceivablesMutation,
  ReceivablesMutationResult, RequestLookupResult
} from './accounting-receivables-client.mjs';

export interface ReceivablesOperationConnection {
  directory: string; url: string; workspace: string; tokenEnv?: string;
}
export type ReceivablesPrepareArguments<K extends ReceivablesMutation = ReceivablesMutation> =
  ReceivablesOperationConnection & {
    kind: K; arguments: ReceivablesArgumentsMap[K]; preview?: never; actor?: never; requestId?: never;
  };
export type ReceivablesPreparePreview =
  ReceivablesOperationConnection & {actor: string; requestId?: string; arguments?: never} &
  ({kind: 'invoice_issue'; preview: CompleteInvoicePreview} |
    {kind: 'payment_create'; preview: PaymentRequestPreview} |
    {kind: 'refund_commit'; preview: RefundPreview} |
    {kind: 'credit_disposition_apply'; preview: CreditDispositionPreview} |
    {kind: 'bank_receipts_post'; preview: BankPostingPreview});
export type ReceivablesPrepareOptions = ReceivablesPrepareArguments | ReceivablesPreparePreview;
export interface PreparedReceivablesOperation<K extends ReceivablesMutation = ReceivablesMutation> {
  directory: string; kind: K; requestSha256: string; arguments: ReceivablesArgumentsMap[K]; phase: 'PREPARED';
}
/** Store exact native JSON and one stable request ID; preview preparation binds the original revision and SHA. */
export function prepareAccountingReceivablesOperation<K extends ReceivablesMutation>(
  options: ReceivablesPrepareArguments<K>,
): Promise<PreparedReceivablesOperation<K>>;
export function prepareAccountingReceivablesOperation(
  options: ReceivablesPreparePreview & {kind: 'invoice_issue'},
): Promise<PreparedReceivablesOperation<'invoice_issue'>>;
export function prepareAccountingReceivablesOperation(
  options: ReceivablesPreparePreview & {kind: 'payment_create'},
): Promise<PreparedReceivablesOperation<'payment_create'>>;
export function prepareAccountingReceivablesOperation(
  options: ReceivablesPreparePreview & {kind: 'refund_commit'},
): Promise<PreparedReceivablesOperation<'refund_commit'>>;
export function prepareAccountingReceivablesOperation(
  options: ReceivablesPreparePreview & {kind: 'credit_disposition_apply'},
): Promise<PreparedReceivablesOperation<'credit_disposition_apply'>>;
export function prepareAccountingReceivablesOperation(
  options: ReceivablesPreparePreview & {kind: 'bank_receipts_post'},
): Promise<PreparedReceivablesOperation<'bank_receipts_post'>>;
export function prepareAccountingReceivablesOperation(
  options: ReceivablesPrepareOptions,
): Promise<PreparedReceivablesOperation>;
export type ReceivablesOperationObservation = RequestLookupResult;
export type ReceivablesOperationResult =
  {directory: string; kind: ReceivablesMutation; found: false; previouslyAttempted: boolean;
    observation: RequestLookupResult & {found: false}} |
  ({directory: string; kind: ReceivablesMutation; submitted: boolean; acknowledged: boolean; found: true} &
    (ReceivablesMutationResult | (RequestLookupResult & {found: true})));
/** Reconcile the original request first. execute=true permits one mutation call in this invocation. */
export function runAccountingReceivablesOperation(options: {
  directory: string; execute?: boolean; client?: AccountingReceivablesClient;
  environment?: Record<string, string | undefined>; signal?: AbortSignal;
}): Promise<ReceivablesOperationResult>;
export type ReceivablesDownloadClient = Pick<AccountingReceivablesClient, 'workspace' | 'fileChunks'>;
export interface ReceivablesDownloadResult {
  output: string; workspace: string; selection: ReceivablesFileSelection;
  file: ReceivablesFileMetadata; complete: true;
}
/** A missing expectedSha256 selects the first original retained snapshot; all subsequent chunks keep its SHA. */
export function downloadAccountingReceivablesFile(options: {
  client: ReceivablesDownloadClient; selection: ReceivablesFileSelection; expectedSha256?: string;
  output: string; chunkBytes?: number; maximumBytes?: number; signal?: AbortSignal;
}): Promise<ReceivablesDownloadResult>;
export interface ReceivablesOperationError extends Error {
  code?: string; message: string; status?: number; details?: unknown; applied?: false;
  outcomeUnknown?: true; reopenRequired?: true;
  commitUncertainty?: {at: string; action: string; revision: number; causeCode: string};
  operationDirectory?: string; requestId?: string;
  lookupError?: NativeRecord; releaseError?: NativeRecord; checkpointError?: NativeRecord;
}
export function main(args?: string[]): Promise<unknown>;
