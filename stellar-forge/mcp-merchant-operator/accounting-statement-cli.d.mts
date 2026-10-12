// MIT. Declarations for durable original customer-statement CLI operations.
import type {
  AccountingStatementClient, AccountingStatementPreview, AssignmentReconciliation,
  CustomerAssignmentResult, CustomerReconciliation, CustomerSaveResult, CustomerUsageImportResult,
  StatementArgumentsMap, StatementArtifactName, StatementFileIdentity, StatementFileMetadata,
  StatementFileSelection, StatementInputMap, StatementLookupResult, StatementMutationKind,
  StatementRetentionArguments, StatementRetentionResult, StatementWithdrawalResult, UsageReconciliation,
  WithdrawalReconciliation, RetainedStatementStatus,
} from './accounting-statement-client.mjs';

export type AccountingStatementOperationKind = StatementMutationKind | 'retain';
export interface AccountingStatementOperationArguments extends StatementArgumentsMap { retain: StatementRetentionArguments; }
export interface StatementOperationConnection {
  directory: string; url: string; workspace: string; tokenEnv?: string;
}
export type StatementPrepareOptions<K extends AccountingStatementOperationKind = AccountingStatementOperationKind> =
  K extends 'retain'
    ? StatementOperationConnection & { kind: K; preview: AccountingStatementPreview; actor: string; requestId?: string }
    : K extends StatementMutationKind
      ? StatementOperationConnection & { kind: K; arguments: StatementInputMap[K] }
      : never;
export interface PreparedStatementOperation<K extends AccountingStatementOperationKind = AccountingStatementOperationKind> {
  directory: string; kind: K; requestSha256: string; arguments: AccountingStatementOperationArguments[K]; phase: 'PREPARED';
}
export function prepareAccountingStatementOperation(options: StatementPrepareOptions<'retain'>): Promise<PreparedStatementOperation<'retain'>>;
export function prepareAccountingStatementOperation<K extends StatementMutationKind>(
  options: StatementOperationConnection & { kind: K; arguments: StatementInputMap[K] },
): Promise<PreparedStatementOperation<K>>;
export function prepareAccountingStatementOperation(options: StatementPrepareOptions): Promise<PreparedStatementOperation>;
export type StatementOperationObservation = StatementLookupResult | CustomerReconciliation |
  AssignmentReconciliation | UsageReconciliation | WithdrawalReconciliation;
export type StatementOperationSubmission = CustomerSaveResult | CustomerAssignmentResult |
  CustomerUsageImportResult | StatementRetentionResult | StatementWithdrawalResult;
export type StatementOperationResult =
  | { directory: string; kind: AccountingStatementOperationKind; found: false; previouslyAttempted: boolean; observation: StatementOperationObservation }
  | ({ directory: string; kind: AccountingStatementOperationKind; submitted: boolean; acknowledged: boolean; found: true } &
      (StatementOperationObservation | StatementOperationSubmission));
export function runAccountingStatementOperation(options: {
  directory: string; execute?: boolean;
  client?: AccountingStatementClient & { readonly endpoint?: string };
  environment?: Record<string, string | undefined>; signal?: AbortSignal;
}): Promise<StatementOperationResult>;
export type StatementDownloadClient = Pick<AccountingStatementClient, 'workspace' | 'fileChunks'>;
export interface StatementDownloadResult {
  output: string; workspace: string; selection: StatementFileSelection; file: StatementFileMetadata; complete: true;
}
/** Alias of the original complete-file accounting maintenance downloader. */
export const downloadAccountingStatementFile: (options: {
  client: StatementDownloadClient; selection: StatementFileSelection; expectedSha256: string;
  output: string; chunkBytes?: number; signal?: AbortSignal;
}) => Promise<StatementDownloadResult>;
export interface StatementDeliveryResult {
  directory: string; schema: 'stellar-forge.accounting-statement-delivery.v1'; workspace: string;
  statementId: string; number: string; observedStatus: RetainedStatementStatus; observedRevision: number;
  files: Array<StatementFileIdentity & { name: StatementArtifactName; reused: boolean }>; complete: true;
}
export function exportAccountingStatement(options: {
  client: StatementDownloadClient & Pick<AccountingStatementClient, 'detail'>;
  statementId: string; directory: string; signal?: AbortSignal;
}): Promise<StatementDeliveryResult>;
export function downloadAccountingStatementStatus(options: {
  client: StatementDownloadClient; statementId: string; output: string; signal?: AbortSignal;
}): Promise<{ output: string; workspace: string; statementId: string; file: StatementFileMetadata; complete: true }>;
export function main(args?: string[]): Promise<unknown>;
