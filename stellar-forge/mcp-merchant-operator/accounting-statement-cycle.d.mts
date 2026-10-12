// MIT. Customer closing cycles using original statement selections and retained files.
import type {
  AccountingStatementClient, StatementSelection, NormalizedStatementSelection, StatementFileIdentity,
  StatementCustomer, StatementServicePeriod, StatementUsageSourceIdentity, RetainedStatement,
} from './accounting-statement-client.mjs';
import type {StatementDeliveryResult} from './accounting-statement-cli.mjs';

export interface StatementCycleProblem { code: string; message: string; }
export type StatementCyclePhase = 'REVIEWED' | 'NOT_RETAINED' | 'SENDING' | 'RETAINED' |
  'DELIVERED' | 'EXPORT_PENDING' | 'RECONCILE_PENDING' | 'REVIEW_REQUIRED';
export interface StatementCycleReview {
  index: number; requestId: string; intent: NormalizedStatementSelection;
  customer: Pick<StatementCustomer, 'id' | 'reference' | 'name'>;
  previewSha256: string; reviewedRevision: number; reviewFile: StatementFileIdentity;
  servicePeriod: Pick<StatementServicePeriod,
    'orderRef' | 'from' | 'until' | 'openingSource' | 'closingSource' | 'opening' | 'closing' | 'totals'> | null;
  usageSource: StatementUsageSourceIdentity | null; orders: number;
}
export interface StatementCycleManifest {
  schema: 'stellar-forge.accounting-statement-cycle.v1'; cycleId: string;
  requestSha256: string; preparedAt: string; rows: StatementCycleReview[]; sha256: string;
}
export interface StatementCycleDelivery extends Omit<StatementDeliveryResult, 'directory'> {
  statusObservedAt: string; statusFile: StatementFileIdentity & { name: 'status.json' };
  indexFile: StatementFileIdentity & { name: 'index.html' };
}
export interface StatementCycleRow extends StatementCycleReview {
  phase: StatementCyclePhase; submissionAttempted: boolean; statement: RetainedStatement | null;
  delivery: StatementCycleDelivery | null; error: StatementCycleProblem | null; updatedAt: string;
}
export interface StatementCycleReport {
  directory: string; schema: 'stellar-forge.accounting-statement-cycle-register.v1';
  cycleId: string; label: string; workspace: string; requestSha256: string; manifestSha256: string;
  preparedAt: string; observedAt: string; phase: 'READY' | 'INCOMPLETE' | 'COMPLETE'; complete: boolean;
  counts: { total: number; retained: number; delivered: number; errors: number };
  rows: StatementCycleRow[];
}
export type StatementCycleClient = AccountingStatementClient & { readonly endpoint?: string };
export interface StatementCyclePrepareOptions {
  directory: string; url: string; workspace: string; tokenEnv?: string; actor: string; label: string;
  selections: StatementSelection[]; client?: StatementCycleClient;
  environment?: Record<string, string | undefined>; signal?: AbortSignal;
}
export interface StatementCycleRunOptions {
  directory: string; execute?: boolean; client?: StatementCycleClient;
  environment?: Record<string, string | undefined>; signal?: AbortSignal;
}
/** Freeze all complete native reviews; repeating identical input resumes partial preparation. */
export function prepareAccountingStatementCycle(options: StatementCyclePrepareOptions): Promise<StatementCycleReport>;
/** Reconcile every original request first. execute:true also retains unchanged reviewed drafts. */
export function runAccountingStatementCycle(options: StatementCycleRunOptions): Promise<StatementCycleReport>;
/** Refresh the local HTML/JSON register from saved progress without contacting merchant MCP. */
export function inspectAccountingStatementCycle(options: { directory: string }): Promise<StatementCycleReport>;
/** Read complete per-customer states without a writer lease; rows may advance during observation. */
export function observeAccountingStatementCycle(options: { directory: string }): Promise<StatementCycleReport>;
