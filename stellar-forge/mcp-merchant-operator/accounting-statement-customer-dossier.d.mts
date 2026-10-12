// MIT. Complete original customer handovers from an existing statement cycle.
import type {
  StatementCyclePhase, StatementCycleReview,
} from './accounting-statement-cycle.mjs';
import type {RetainedStatementStatus} from './accounting-statement-client.mjs';

export interface StatementDossierCycle {
  cycleId: string; label: string; workspace: string; requestSha256: string;
  manifestSha256: string; preparedAt: string;
}
export interface StatementDossierCustomer { customerId: string; reference: string; name: string; }
export interface StatementDossierPlan { id: string; revision: string; label: string; }
export interface StatementDossierSelectedPlan extends StatementDossierPlan { orderRef: string; orderLabel: string; }
export interface StatementDossierPass { orderRef: string; label: string; plan: StatementDossierPlan | null; }
export interface StatementDossierStatementIdentity {
  id: string; number: string; status: RetainedStatementStatus; createdAt: string;
  replacesId: string | null; supersededBy: string | null;
}
export interface StatementDossierCounts {
  total: number; retained: number; delivered: number; pending: number;
  current: number; superseded: number; withdrawn: number;
}
export interface StatementDossierRow {
  index: number; requestId: string; previewSha256: string; phase: StatementCyclePhase; ready: boolean;
  statement: StatementDossierStatementIdentity | null;
  servicePeriod: StatementCycleReview['servicePeriod']; usageSource: StatementCycleReview['usageSource'];
  sourceObservedAt: string; errorCode: string | null;
  plan: StatementDossierSelectedPlan | null; passes: StatementDossierPass[];
}
export interface StatementDossierCustomerGroup extends StatementDossierCustomer {
  rowIndexes: number[]; counts: StatementDossierCounts; complete: boolean; rows: StatementDossierRow[];
}
export interface StatementDossierGroups {
  schema: 'stellar-forge.accounting-statement-customer-dossier-groups.v1';
  cycle: StatementDossierCycle; customers: StatementDossierCustomerGroup[];
}
export interface StatementDossierFile { path: string; sha256: string; bytes: number; }
export interface StatementDossierStatement extends StatementDossierRow {
  included: boolean; path: string | null; statusObservedAt: string | null;
  withdrawal: {at: string; actor: string; reason: string} | null;
  orders: number | null; reportSha256: string | null;
}
/** dossier.json records every payload file. Its own identity is appended to read/export results. */
export interface StatementDossierManifest {
  schema: 'stellar-forge.accounting-statement-customer-dossier.v1';
  cycle: StatementDossierCycle; customer: StatementDossierCustomer; snapshotSha256: string;
  observedAt: string; complete: boolean; counts: StatementDossierCounts;
  statements: StatementDossierStatement[]; files: StatementDossierFile[];
}
export interface StatementDossierSnapshot extends StatementDossierManifest {
  directory: string; totalBytes: number;
}
export interface StatementDossierExport extends StatementDossierSnapshot { reused: boolean; }
/**
 * Read atomic saved cycle progress without its writer lease. Pass labels come from exact original
 * review bytes; their bounded cache is keyed by the original request and complete review SHA.
 */
export function inspectAccountingStatementCustomerDossiers(options: {
  directory: string; signal?: AbortSignal;
}): Promise<StatementDossierGroups>;
/**
 * Export all selected rows for one original customer. Takes the original cycle lease and output-root
 * lease, verifies complete native documents/files and publishes outputDirectory/snapshotSha256.
 * At least one row must be completely delivered. Pending rows remain visible in partial handovers.
 * Repeating unchanged saved inputs reuses the immutable snapshot.
 */
export function exportAccountingStatementCustomerDossier(options: {
  directory: string; customerId: string; outputDirectory: string; signal?: AbortSignal;
}): Promise<StatementDossierExport>;
/**
 * Read an immutable or copied private customer snapshot without its merchant connection or cycle.
 * Validates the manifest and digest; verifyFiles also checks every saved payload SHA and byte length.
 * Returned files contains dossier.json exactly once, in addition to the declared payload files.
 */
export function readAccountingStatementCustomerDossier(options: {
  directory: string; signal?: AbortSignal; verifyFiles?: boolean;
}): Promise<StatementDossierSnapshot>;
