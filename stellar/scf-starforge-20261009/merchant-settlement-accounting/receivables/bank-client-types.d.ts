// MIT. Original bank statement intake, reviewed cash splits and retained file contracts.
import type {
  Money, DateOnly, Revision, Currency, MutationContext, MutationResult,
  Customer, InvoiceSummary, Receipt, Allocation, HistoryEntry
} from './client.d.ts';

export type BankFormat = 'CSV' | 'OFX' | 'MT940';
export type BankAccountStatus = 'ACTIVE' | 'ARCHIVED';
export type BankImportStatus = 'OPEN' | 'CLOSED';
export type BankDirection = 'CREDIT' | 'DEBIT' | 'ZERO';
export type BankRowStatus = 'UNASSIGNED' | 'POSTED' | 'LINKED' | 'IGNORED' | 'DUPLICATE' | 'CONFLICT' | 'SOURCE_ONLY';
export type BankDateBasis = 'CSV_MAPPED_DATE' | 'OFX_DTPOSTED' | 'MT940_VALUE_DATE';
export interface BankCsvColumns {
  date: string; amount?: string; credit?: string; debit?: string; transactionId?: string;
  reference?: string; counterparty?: string; invoiceReference?: string; valueDate?: string; balance?: string;
}
export interface BankCsvLayout {
  delimiter: ',' | ';' | '\t';
  dateFormat: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYYMMDD';
  decimalMark?: '.' | ','; groupSeparator?: '' | ',' | '.' | ' ';
  amountMode?: 'SIGNED' | 'CREDIT_DEBIT'; creditSign?: 'POSITIVE' | 'NEGATIVE';
  /** Exact unique original headers; SIGNED requires amount, CREDIT_DEBIT requires credit and debit. */
  columns: BankCsvColumns;
}
export type BankCsvInspectionLayout = Partial<Omit<BankCsvLayout, 'columns'>> & {columns?: Partial<BankCsvColumns>};
export interface BankCsvNormalizedLayout extends BankCsvLayout {
  decimalMark: '.' | ','; groupSeparator: '' | ',' | '.' | ' ';
  amountMode: 'SIGNED' | 'CREDIT_DEBIT'; creditSign: 'POSITIVE' | 'NEGATIVE';
}
export interface BankStatementOptions {
  profile: 'TEXT_BODY' | 'FIN_ENVELOPE'; encoding: 'ASCII' | 'UTF-8' | 'ISO-8859-1';
  debitCreditProfile: 'CD_ONLY' | 'CD_REVERSALS'; yearWindowStart: number; dateBasis: 'VALUE_DATE';
  /** Explicit scales 0..6; required for inspection without a selected account. */
  currencyScales?: Record<string, number>;
}
export interface BankAccountInput extends MutationContext {
  id?: string; expectedVersion?: number; reference: string; name: string; currency: Currency;
  method?: string; bankId?: string; accountReference?: string; csvLayout?: BankCsvLayout | null; status?: BankAccountStatus;
}
export interface BankAccount {
  id: string; reference: string; name: string; currency: Currency; method: string;
  bankId: string | null; accountReference: string | null; csvLayout: BankCsvNormalizedLayout | null;
  status: BankAccountStatus; version: number; createdAt: string; updatedAt: string;
}
export interface BankAccountsQuery {status?: BankAccountStatus; search?: string; offset?: number; limit?: number}
export interface BankAccountsPage {
  schema: 'stellar-forge.merchant-bank-accounts.v1'; revision: Revision; total: number; offset: number; limit: number;
  accounts: BankAccount[];
}
export interface BankAccountsInventory extends Omit<BankAccountsPage, 'offset' | 'limit'> {}
export interface BankSourceFile {
  name: string;
  /** Original file bytes encoded in base64, at most 1,000,000 decoded bytes. */
  dataBase64: string;
}
export type BankSourceInspectionInput = {accountId?: string; file: BankSourceFile; sectionId?: string} & (
  {format: 'CSV'; csvLayout?: BankCsvInspectionLayout; statementOptions?: never} |
  {format: 'OFX'; csvLayout?: never; statementOptions?: never} |
  {format: 'MT940'; csvLayout?: never; statementOptions: BankStatementOptions}
);
export type BankSourceImportInput = MutationContext & {accountId: string; file: BankSourceFile; sectionId?: string} & (
  {format: 'CSV'; csvLayout?: BankCsvLayout; statementOptions?: never} |
  {format: 'OFX'; csvLayout?: never; statementOptions?: never} |
  {format: 'MT940'; csvLayout?: never; statementOptions: BankStatementOptions}
);
export interface BankSourceIdentity {name: string; format: BankFormat; bytes: number; sha256: string}
export interface BankSourceIssue {
  code: string; message: string; level?: string; sourceRefs?: unknown; sourcePages?: unknown; [key: string]: unknown;
}
export interface BankSourceSection {
  id: string; kind: string; bankId: string | null; accountReference: string | null; currencyCode: string | null;
  sourceAccountIdentity: Record<string, unknown>; balanceSnapshots: Array<Record<string, unknown>>;
  from: string | null; until: string | null; openingBalance: {amount: Money; date: DateOnly | null} | null; closingBalance: {amount: Money; date: DateOnly | null} | null;
  rowCount: number; creditCount: number; debitCount: number; zeroCount: number; [key: string]: unknown;
}
export interface BankRawRow {values: string[]; fields: Record<string, unknown>; text: string | null}
export interface BankSourceSample {
  rowNumber?: number; lineNumber?: number | null; raw?: BankRawRow; amount?: string; bookedDate?: DateOnly;
  [key: string]: unknown;
}
export interface BankSourceInspection {
  schema: 'stellar-forge.merchant-bank-source-inspection.v1'; revision: Revision;
  source: BankSourceIdentity; accountId: string | null; layout: BankCsvInspectionLayout | BankCsvNormalizedLayout | null;
  columns: string[]; sections: BankSourceSection[]; sectionId: string | null; requiresLayout: boolean;
  statementOptions: BankStatementOptions | null; rows: {total: number; items: Array<BankSourceRow | BankSourceSample>};
  issues: BankSourceIssue[];
}
export interface BankSourceRow {
  id: string; rowNumber: number; lineNumber: number | null; sourceRowSha256: string; raw: BankRawRow;
  bookedDate: DateOnly; valueDate: DateOnly | null; amount: Money; currency: Currency;
  transactionId: string | null; bankReference: string; reference: string; counterparty: string; invoiceReference: string;
  balance: Money | null; kind: BankDirection; cashSource: boolean; dateBasis: BankDateBasis; narrative: string;
  sourceEligible: boolean; requiresSourceResolution: boolean; sourceIssues: BankSourceIssue[];
  sourceIdentity: Record<string, unknown> | null; originalDates: Record<string, unknown> | null;
  originalEntryMonthDay: string | null; sourcePageSha256: string | null; originalSourceOccurrences: unknown[];
  replacesTransactionKeys: string[]; transactionKey: string | null;
  transactionIdentity: 'BANK_TRANSACTION_ID' | 'STATEMENT_POSITION' | 'NONE'; economicKey: string;
  [key: string]: unknown;
}
export interface BankSourceMatch {
  bankImportId: string; sourceName: string; rowId: string; match: 'TRANSACTION_ID' | 'SAME_PAYMENT_FIELDS';
  amount: Money; bookedDate: DateOnly; kind: BankDirection; sameFacts: boolean; status: BankRowStatus; receiptIds: string[];
  [key: string]: unknown;
}
export interface BankRowDecision {
  rowId: string; status: BankRowStatus; receiptIds?: string[]; reason?: string; [key: string]: unknown;
}
export interface BankRow extends BankSourceRow {
  status: BankRowStatus; canPost: boolean; decision: BankRowDecision | null; sourceMatches: BankSourceMatch[];
  supersededBy: BankSourceMatch[];
  receiptCandidates: Array<{receipt: Receipt; reasons: string[]}>;
  invoiceCandidates: Array<{invoice: InvoiceSummary; reasons: string[]}>;
  customerCandidates: Array<{customer: Customer; reasons: string[]}>;
}
export interface BankImportSummary {
  id: string; accountId: string; accountReference: string; accountName: string; sourceName: string;
  format: BankFormat; sourceSha256: string; sectionId: string; currency: Currency; status: BankImportStatus;
  rowCount: number; creditCount: number; debitCount: number; zeroCount: number; unassignedCount: number;
  postedCount: number; linkedCount: number; ignoredCount: number; duplicateCount: number; conflictCount: number;
  sourceOnlyCount: number; postingCount: number; createdAt: string; closedAt: string | null;
}
export interface BankImportsQuery {
  accountId?: string; status?: BankImportStatus; search?: string; offset?: number; limit?: number;
}
export interface BankImportsPage {
  schema: 'stellar-forge.merchant-bank-imports.v1'; revision: Revision; total: number; offset: number; limit: number;
  imports: BankImportSummary[];
}
export interface BankImportsInventory extends Omit<BankImportsPage, 'offset' | 'limit'> {}
export type BankImportView = 'summary' | 'rows' | 'history' | 'postings';
export interface BankImportQuery {
  view?: BankImportView; rowStatus?: BankRowStatus; direction?: BankDirection; search?: string; offset?: number; limit?: number;
}
export interface BankFileMetadata {
  directoryId: string; name: string; bytes: number; sha256: string; type: string;
  customerId?: string; receiptId?: string; accountingDate?: DateOnly;
}
export type BankFileName = 'source.csv' | 'source.ofx' | 'source.mt940' | 'import.json' | 'rows.json' | 'rows.csv'
  | 'status.json' | 'reconciliation.json' | 'parser-report.json'
  | `posting-${string}.json` | `posting-${string}.html` | `posting-${string}.csv`
  | `receipt-${string}.json` | `receipt-${string}.html` | `receipt-${string}.csv`;
export interface BankDownload {name: BankFileName; type: string; bytes: Uint8Array}
export interface BankImportRows {summary: never; rows: BankRow; history: HistoryEntry; postings: BankPostingSummary}
export interface BankImportDetail<V extends BankImportView = BankImportView> {
  schema: 'stellar-forge.merchant-bank-import.v1'; revision: Revision; bankImport: BankImportSummary;
  account: BankAccount; source: BankSourceIdentity; layout: BankCsvNormalizedLayout | null;
  sections: BankSourceSection[]; columns: string[]; statementOptions: BankStatementOptions | null;
  issues: BankSourceIssue[]; view: V; total: number; offset: number; limit: number; items: BankImportRows[V][];
  /** Retained file identities. status.json and reconciliation.json are also available as live downloads. */
  files: BankFileMetadata[];
}
export interface BankImportInventory extends Omit<BankImportDetail, 'offset' | 'limit'> {}
export interface BankAllocationInput {invoiceId: string; amount: Money; allocatedDate?: DateOnly}
export interface BankPostingSplitInput {
  action: 'CREATE' | 'LINK' | 'CORRECT'; customerId?: string; receiptId?: string; amount: Money;
  /** Select one exact original receipt source coverage when otherwise ambiguous. */
  coverageKey?: string;
  allocations?: BankAllocationInput[]; effectiveDate?: DateOnly; reason?: string; dateDifferenceReason?: string;
  /** For CORRECT, explicitly reapply uncorrected cash to the original customer's invoices. */
  residualAllocations?: BankAllocationInput[];
}
export interface BankPostingSelectionInput {
  rowId: string; sourceResolutionReason?: string; distinctPaymentReason?: string; splits: BankPostingSplitInput[];
}
export interface BankPostingPreviewInput {selections: BankPostingSelectionInput[]}
export interface BankReviewedAllocation {
  id: string; receiptId: string; invoiceId: string; invoiceNumber: string;
  invoice: {id: string; version: number; sha256: string; number: string}; amount: Money; allocatedDate: DateOnly;
}
export interface BankReleasedAllocation {
  id: string; invoiceId: string; amount: Money; allocatedDate: DateOnly; previousReleasedDate: DateOnly | null;
  releasedDate: DateOnly; originalSha256: string; reason: string;
}
export interface BankReceiptSourceBinding {
  bankImportId?: string; bankAccountId?: string; postingId?: string; bankPostingId?: string; rowId?: string;
  sourceSha256?: string; sourceRowSha256?: string; sourceName?: string; bookedDate?: DateOnly;
  transactionId?: string | null; transactionKey?: string | null; transactionAliases?: string[];
  bankReference?: string; reference?: string; coverageKey?: string; sourceAmount?: Money; splitAmount?: Money;
  [key: string]: unknown;
}
export interface BankSourceCoverage {
  key: string; repeatedSource: boolean; receiptAmount: Money; beforeMatchedAmount: Money;
  coveredByThisSource: Money; newlyMatchedAmount: Money; afterMatchedAmount: Money; remainingUnmatchedAmount: Money;
}
export interface BankResidualReceipt {
  id: string; customer: Customer; amount: Money; receivedDate: DateOnly; accountingDate: DateOnly;
  reference: string; method: string; source: Record<string, unknown> | null; sourceKey: string | null;
  bankSources: BankReceiptSourceBinding[]; allocations: BankReviewedAllocation[];
}
export interface BankOriginalReceipt {
  id: string; sha256: string; customerId: string; currency: Currency; amount: Money;
  receivedDate: DateOnly; accountingDate: DateOnly; status: 'RECORDED' | 'VOID'; voidDate: DateOnly | null;
  sourceKey: string | null; reference: string; method: string;
}
export interface BankPostingSplit {
  id: string; action: 'CREATE' | 'LINK' | 'CORRECT'; receiptId: string; customer: Customer;
  amount: Money; reference: string; effectiveDate: DateOnly; accountingDate: DateOnly;
  coverageKey: string | null;
  reason: string; dateDifferenceReason: string; originalReceipt: BankOriginalReceipt | null;
  releasedAllocations: BankReleasedAllocation[]; allocations: BankReviewedAllocation[];
  sourceCoverage?: BankSourceCoverage; correctedOriginalAmount?: Money; replacementReceiptIds?: string[];
  residualReceipt?: BankResidualReceipt | null; [key: string]: unknown;
}
export interface BankPostingSelection {
  rowId: string; sourceRow: Omit<BankSourceRow, 'raw'>; distinctPaymentReason: string; sourceResolutionReason: string;
  sourceMatches: BankSourceMatch[]; splits: BankPostingSplit[];
}
export interface BankPostingProposal {
  schema: 'stellar-forge.merchant-bank-posting-proposal.v1'; id: string; createdAt: string; bankImportId: string;
  account: BankAccount; source: BankSourceIdentity; section: BankSourceSection;
  normalizedSha256: string; importStateSha256: string; selections: BankPostingSelection[];
}
export interface BankReceiptBalance {
  id: string; currency: Currency; amount: Money; allocated: Money; available: Money;
  [key: string]: unknown;
}
export interface BankInvoiceBalance {
  id: string; currency: Currency; paid: Money; credited: Money; amountDue: Money; creditBalance: Money;
  [key: string]: unknown;
}
export interface BankBalancePeriod<T> {asOf: DateOnly; before: T | null; after: T | null}
export interface BankBalanceEffect<T> extends BankBalancePeriod<T> {
  id: string; customerId: string; currency: Currency; periods: Array<BankBalancePeriod<T>>;
}
export interface BankPostingTotals {
  currency: Currency; sourceCredits: Money; createdReceiptAmount: Money; linkedReceiptAmount: Money;
  correctedReceiptAmount: Money; allocatedAmount: Money;
}
export interface BankPostingBalanceEffects {
  asOf: DateOnly; receipts: Array<BankBalanceEffect<BankReceiptBalance>>;
  invoices: Array<BankBalanceEffect<BankInvoiceBalance> & {number: string}>; totals: BankPostingTotals;
}
export interface BankPostingPreview {
  revision: Revision; proposal: BankPostingProposal; reviewSha256: string; balanceEffects: BankPostingBalanceEffects;
}
export interface PostBankReceiptsInput extends MutationContext {proposal: BankPostingProposal; reviewSha256: string}
export interface IgnoreBankRowsInput extends MutationContext {rowIds: string[]; reason: string}
export interface RestoreBankRowsInput extends MutationContext {
  /** An empty list reopens the original closed import. */
  rowIds?: string[]; reason: string;
}
export interface CloseBankImportInput extends MutationContext {reason?: string}
export interface BankPostingSummary {
  id: string; bankImportId: string; recordedAt: string; actor: string; reviewSha256: string;
  rowIds: string[]; receiptIds: string[]; invoiceIds: string[]; allocationIds: string[];
  totals: BankPostingTotals; files: Record<string, BankFileMetadata>;
}
export interface BankMutationResult extends MutationResult {
  bankAccount?: BankAccount; bankImport?: BankImportSummary; bankPosting?: BankPostingSummary;
  receipts?: Receipt[]; invoices?: InvoiceSummary[]; allocations?: Allocation[];
}
export type BankAccountMutationResult = BankMutationResult & {bankAccount: BankAccount};
export type BankImportMutationResult = BankMutationResult & {bankImport: BankImportSummary};
export type BankPostingMutationResult = BankImportMutationResult & {
  bankPosting: BankPostingSummary; receipts: Receipt[]; invoices: InvoiceSummary[]; allocations: Allocation[];
};
