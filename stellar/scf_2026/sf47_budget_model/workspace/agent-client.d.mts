import type {InstallationSourceInputs,InstallationSourceResponses} from './installation-source-desk-agent.mjs';
export * from './installation-source-desk-agent.mjs';
// MIT. TypeScript declarations for the original SF47 client and its saved delivery workflow.
import type { Buffer } from 'node:buffer';

export const GRANT_AGENT_SCHEMA: 'stellar-forge.sf47-agent.v1';
export const GRANT_MAX_BUNDLE_BYTES: number;
export const GRANT_MAX_SOURCE_BYTES: number;
export const GRANT_MAX_WORKBOOK_HANDOVER_BYTES: number;
export const GRANT_CASE_ACTIONS: readonly GrantCaseAction[];

/** Full native JSON objects retain their original fields and decimal strings. */
export type GrantObject = Record<string, unknown>;
/** YYYY-MM-DD. The native service validates that this is an actual civil date. */
export type GrantCivilDate = string;

/** Original saved selections returned together from one versioned operating case. */
export type GrantOperatingWorkflowSelection =
  | { kind: 'statement-original'; sourceId: string }
  | { kind: 'account-reconciliation'; reconciliationId: string; revision: number }
  | { kind: 'cost-funding'; revision: number }
  | { kind: 'award-terms'; id: string; revision: number }
  | { kind: 'cohort-delivery'; sourceId: string }
  | { kind: 'grant-procedure'; sourceId: string };
export interface GrantOperatingWorkflowPopulation {
  key: string; section: string; label: string; count: number;
}
export interface GrantOperatingWorkflowEntry {
  key: string; collection: string; id: string; revision: number | null;
  section: string; kindLabel: string; label: string;
  /** The complete original source summary, retaining its native fields and values. */
  summary: GrantObject;
  selection: GrantOperatingWorkflowSelection;
}
export interface GrantOperatingWorkflows {
  schema: 'stellar-forge.sf47-operating-workflows.v1';
  case: { id: string; version: number };
  populations: GrantOperatingWorkflowPopulation[];
  entries: GrantOperatingWorkflowEntry[];
}

export type GrantInstallationStage = 'PLANNED' | 'COMMISSIONING' | 'OPERATING' | 'HANDED_OVER' | 'RETIRED';
export type GrantCheckState = 'OPEN' | 'IN_PROGRESS' | 'ACCEPTED' | 'CHANGES_REQUIRED' | 'NOT_APPLICABLE';
export type GrantDeliveryPriority = 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
export type GrantDeliveryDueStatus = 'COMPLETE' | 'INACTIVE' | 'UNDATED' | 'OVERDUE' | 'TODAY' | 'UPCOMING';
export type GrantCaseAction =
  | 'work-intake.upload' | 'work-intake.save' | 'work-intake.apply' | 'task-outcomes.save' | 'funding.save'
  | 'contributor.save' | 'work.save' | 'work.submit' | 'work.accept' | 'work.reopen' | 'work.void'
  | 'invoice.save' | 'invoice.review' | 'invoice.dispute' | 'invoice.reopen' | 'invoice.void'
  | 'cash.record' | 'cash.void' | 'settlement.receive' | 'settlement.correct' | 'statement.receive' | 'statement-setup.save' | 'award.save' | 'deployment.save'
  | 'purchase.record' | 'purchase.observe' | 'purchase.void' | 'outcome.save'
  | 'engagement.prepare' | 'engagement.receiving' | 'risk-register.save'
  | 'review' | 'close' | 'reopen' | 'cohort.prepare' | 'installation.save' | 'installation.return' | 'installation.return-stage' | 'implementation.prepare'
  | 'amendment.save' | 'amendment.review' | 'amendment.apply'
  | 'completion.save' | 'completion.prepare' | 'completion.extension' | 'completion.submit' | 'completion.decision'
  | 'completion.corrections.save'
  | GrantExpenseAction;

/** Original quantities are atomic integer strings. Native asset scale is always explicit. */
export type GrantExpenseAction = 'expense.receive' | 'expense.save' | 'expense.review' | 'expense.reopen' | 'expense.void';
export type GrantExpenseTransition = 'review' | 'reopen' | 'void';
export type GrantExpenseState = 'DRAFT' | 'REVIEWED' | 'VOID';
export interface GrantExpenseSplit extends GrantObject {
  costId: string;
  fundingBasis: 'GRANT' | 'CUSTOMER' | 'INTERNAL' | 'PREAWARD';
  nativeAmount: string;
  usdValue?: string | null;
  memo?: string;
}
export interface GrantExpenseValuation extends GrantObject {
  mode: 'ENTERED_USD' | 'RETAINED_RATE';
  date: GrantCivilDate;
  sourceIds: string[];
  note: string;
  nativeUnit?: { currency: string; decimals: number } | null;
  /** The original forecast currency rate object, including its retained source and basis. */
  rate?: GrantObject | null;
}
export interface GrantExpenseAllocationInput extends GrantObject {
  id?: string;
  intakeId: string;
  sourceLineId: string;
  expectedSourceRowSha256: string;
  allocations: GrantExpenseSplit[];
  valuation?: GrantExpenseValuation | null;
  unattributedReason?: string;
  linkedInvoiceIds?: string[];
  linkedPurchaseIds?: string[];
  linkedWorkIds?: string[];
}
export interface GrantExpenseLine extends GrantObject {
  intakeId: string;
  sourceLineId: string;
  sourceRowSha256: string;
  workspaceId: string;
  closeId: string;
  kind: 'EXPENSE' | 'CREDIT';
  original: { network: string; asset: string; amount: string };
  attributionId: string | null;
  attributionState: GrantExpenseState | null;
}
export interface GrantExpenseAttribution extends GrantObject {
  id: string;
  state: GrantExpenseState;
  version: number;
  contentSha256: string;
  source: GrantObject;
  allocations: GrantExpenseSplit[];
  valuation: (GrantExpenseValuation & { originalMoney?: GrantObject; calculation?: GrantObject }) | null;
  bookkeepingChanged: boolean;
  currentSource: GrantObject | null;
  allowedActions: GrantExpenseAction[];
}
export interface GrantExpenseDashboard extends GrantObject {
  schema: 'scf.operations.expense-attribution.v1';
  caseId: string;
  version: number;
  sources: GrantObject[];
  lines: GrantExpenseLine[];
  attributions: GrantExpenseAttribution[];
  costs: { id: string; tranche: number; plannedUsd: string }[];
  canReceive: boolean;
  summary: GrantObject;
  reviewItems: GrantObject[];
}
export interface GrantExpensePreview extends GrantObject {
  schema: 'scf.operations.expense-attribution.v1';
  caseId: string;
  version: number;
  filename: string;
  inspection: GrantObject;
  rows: GrantObject[];
  receiving: 'ALREADY_RETAINED' | 'HISTORICAL_EDITION' | 'CURRENT_ORIGINAL';
  retainedIntakeId: string | null;
  previousIntakeId: string | null;
  previewSha256: string;
}
export interface GrantExpenseReceipt extends GrantObject {
  id: string;
  version: number;
  action: GrantExpenseAction;
  kind: string;
  recordId: string;
}
export type GrantExpenseRequest = GrantOperationRequest & { action: GrantExpenseAction; data: GrantObject };
export type GrantExpenseRequestState =
  | { status: 'COMMITTED'; requestId: string; caseId: string; currentVersion: number; receipt: GrantExpenseReceipt }
  | { status: 'NOT_RECORDED'; requestId: string; caseId: string; currentVersion: number };


export type GrantStatementCategory = 'GRANT' | 'INVOICE' | 'CUSTOMER' | 'CAPITAL' | 'REFUND' | 'OTHER';
export interface GrantStatementAllocation {
  invoiceId: string;
  amountUsd: string;
}
export interface GrantStatementDecision {
  /** Physical source line at the beginning of the original CSV record. */
  rowNumber: number;
  action: 'IMPORT' | 'EXCLUDE';
  /** Required for an exclusion. */
  reason?: string;
  category?: GrantStatementCategory;
  tranche?: 0 | 1 | 2 | 3 | null;
  allocations?: GrantStatementAllocation[];
}
export interface GrantStatementSource {
  filename: string;
  contentBase64: string;
  observedAt: string;
  sourceUrl?: string;
}
export interface GrantStatementCommonInput {
  statementSetup?: GrantStatementSetupRef;
  source: GrantStatementSource;
  /** Stable nonsecret source account identity; case-sensitive and independent of the filename. */
  accountId: string;
  accountLabel?: string;
  currency: string;
  defaultCategory?: GrantStatementCategory;
  /** Supply both original signed balances together. Native bank formats use decimal text with no grouping. */
  openingBalance?: string | null;
  closingBalance?: string | null;
  valuationNote?: string;
  sourceReviewNote?: string;
  decisions?: GrantStatementDecision[];
}
export interface GrantCsvStatementInput extends GrantStatementCommonInput {
  sourceFormat?: 'CSV';
  format: {
    delimiter: ',' | ';' | '\t' | '|';
    decimalMark: '.' | ',';
    groupMark: '' | '.' | ',' | ' ' | '\u00a0' | "'";
    dateFormat: 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY/MM/DD';
    amountMode: 'SIGNED' | 'DEBIT_CREDIT';
    positiveDirection: 'IN' | 'OUT';
  };
  /** Exact original heading strings, including any surrounding spaces. */
  columns: {
    date: string; reference: string; description?: string; amount?: string;
    debit?: string; credit?: string; currency?: string; usdValue?: string;
  };
}
export interface GrantMt940StatementOptions {
  profile: 'TEXT_BODY' | 'FIN_ENVELOPE';
  encoding: 'ASCII' | 'UTF-8' | 'ISO-8859-1';
  debitCreditProfile: 'CD_ONLY' | 'CD_REVERSALS';
  /** Explicit beginning of the original two-digit-year interpretation window, 1900 through 2000. */
  yearWindowStart: number;
  dateBasis: 'VALUE_DATE';
  currencyScales: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6>;
}
export interface GrantOfxStatementInput extends GrantStatementCommonInput {
  /** Includes original QFX files. */
  sourceFormat: 'OFX';
  statementId: string;
  statementOptions?: null | Record<string, never>;
  format?: never;
  columns?: never;
}
export interface GrantMt940StatementInput extends GrantStatementCommonInput {
  sourceFormat: 'MT940';
  statementId: string;
  statementOptions: GrantMt940StatementOptions;
  format?: never;
  columns?: never;
}
export type GrantStatementInput = GrantCsvStatementInput | GrantOfxStatementInput | GrantMt940StatementInput;
export type GrantStatementInspectionInput =
  | { sourceFormat: 'OFX'; source: GrantStatementSource; statementOptions?: null | Record<string, never> }
  | { sourceFormat: 'MT940'; source: GrantStatementSource; statementOptions: GrantMt940StatementOptions };
export interface GrantStatementFinding {
  code: string;
  message: string;
  severity: 'ERROR' | 'REVIEW' | 'INFO';
}
export interface GrantStatementSourceBalance {
  date: GrantCivilDate;
  amount: string;
}
export interface GrantStatementAccount {
  id: string;
  kind: 'BANK' | 'CREDITCARD';
  label: string;
  accountReference: string;
  currency: string;
  bankId: string | null;
  accountType?: string | null;
  nativeAccountSha256?: string;
  from: GrantCivilDate | null;
  until: GrantCivilDate | null;
  rowCount: number;
  pendingCount: number;
  openingBalance: GrantStatementSourceBalance | null;
  closingBalance: GrantStatementSourceBalance | null;
  cashEligible: boolean;
  findings: GrantStatementFinding[];
  balanceSnapshots?: GrantObject[];
}
export interface GrantStatementInspection {
  schema: 'stellar-forge.sf47-bank-statements.v1';
  caseId: string;
  expectedVersion: number;
  source: {
    filename: string; bytes: number; sha256: string; sourceUrl: string; observedAt: string;
    sourceFormat: 'OFX' | 'MT940';
  };
  statements: GrantStatementAccount[];
  inspectionSha256: string;
}
export interface GrantStatementBankSummary {
  sourceFormat: 'OFX' | 'MT940';
  statementId: string;
  parserProfile: string;
  parserReportSha256: string;
  accountReference: string;
  bankId: string | null;
  kind: 'BANK' | 'CREDITCARD';
  nativeAccountSha256: string | null;
  dateBasis: 'OFX_DTPOSTED' | 'MT940_VALUE_DATE';
  sourceOpeningBalance: GrantStatementSourceBalance | null;
  sourceClosingBalance: GrantStatementSourceBalance | null;
  pendingCount: number;
  balanceSnapshots: GrantObject[];
  findings: GrantStatementFinding[];
}
export interface GrantStatementRow {
  /** CSV physical record line, or unique native account review ordinal. */
  rowNumber: number;
  /** Native OFX or MT940 physical source line. */
  sourceLine?: number;
  identityBasis?: 'PROVIDER_REFERENCE' | 'STATEMENT_POSITION';
  providerReference?: string;
  nativeIdentity?: GrantObject;
  corrected?: boolean;
  originalRecordId?: string;
  correctionSourceIds?: string[];
  correctedRecord?: GrantObject;
  reference: string;
  date: GrantCivilDate | null;
  description: string;
  direction: 'IN' | 'OUT' | null;
  amount: string | null;
  currency: string;
  usdValue: string | null;
  category: GrantStatementCategory;
  tranche: 0 | 1 | 2 | 3 | null;
  allocations: GrantStatementAllocation[];
  action: 'IMPORT' | 'EXCLUDE';
  reason: string;
  status: 'NEW' | 'EXISTING' | 'EXCLUDED' | 'CONFLICT';
  recordId: string | null;
  problems: string[];
  original: Record<string, string>;
  /** Original cash validator result; provisional source and new-record IDs are replaced atomically on receiving. */
  record?: GrantObject;
}
export interface GrantStatementPreview {
  statementSetup?: GrantStatementSetupRef;
  schema: 'stellar-forge.sf47-statements.v1';
  caseId: string;
  expectedVersion: number;
  inputsSha256: string;
  previewSha256: string;
  source: {
    filename: string; bytes: number; sha256: string; sourceUrl: string; observedAt: string;
    accountId: string; accountLabel: string; currency: string; editionSha256: string;
    sourceFormat?: 'OFX' | 'MT940';
  };
  headers: string[];
  rows: GrantStatementRow[];
  bank?: GrantStatementBankSummary;
  summary: {
    rows: number; newCount: number; existingCount: number; excludedCount: number; conflictCount: number;
    inflow: string; outflow: string; net: string; importInflow: string; importOutflow: string;
    completeAmounts: boolean;
  };
  balance: {
    status: 'MATCH' | 'MISMATCH' | 'NOT_PROVIDED' | 'UNAVAILABLE';
    openingBalance: string | null; closingBalance: string | null;
    calculatedBalance: string | null; difference: string | null;
  };
  findings: { code: string; message: string; rowNumber?: number; recordId?: string | null }[];
  canImport: boolean;
  unchanged: boolean;
  retainedSourceId: string | null;
}
export interface GrantStatementReceipt {
  id: string;
  version: number;
  action: 'statement.receive';
  kind: 'statement';
  recordId: string;
  sourceIds: string[];
  cashIds: string[];
  existingCashIds: string[];
  unchanged: boolean;
  statementSha256: string;
  previewSha256: string;
}

export interface GrantStatementSetupRef {
  id: string; name: string; revision: number; sourceId: string; sourceSha256: string; editionSha256: string;
}
export interface GrantStatementSetupAccount {
  accountId: string; accountLabel: string; currency: string; defaultCategory: GrantStatementCategory;
}
export type GrantStatementSetupSettings = GrantStatementSetupAccount & (
  | {sourceFormat: 'CSV'; format: GrantCsvStatementInput['format']; columns: GrantCsvStatementInput['columns']}
  | {sourceFormat: 'OFX'}
  | {sourceFormat: 'MT940'; statementOptions: GrantMt940StatementOptions}
);
export interface GrantStatementSetupBasis {
  sourceSha256: string; filename: string; headers: string[];
  bank: null | {
    sourceFormat: 'OFX' | 'MT940'; accountReference: string; bankId: string | null;
    kind: 'BANK' | 'CREDITCARD'; nativeAccountSha256: string | null; dateBasis: string;
  };
}
export interface GrantStatementSetupSummary extends GrantStatementSetupRef {
  status: 'ACTIVE' | 'ARCHIVED'; caseVersion: number; savedAt: string; actor: string; note: string;
  settings: GrantStatementSetupSettings; basis: GrantStatementSetupBasis;
}
export type GrantStatementSetupWrite = GrantOperationRequest & {note: string; name: string;} & (
  | {id?: never; expectedRevision: 0; status?: 'ACTIVE'; inputs: GrantStatementInput}
  | {id: string; expectedRevision: number; status?: 'ACTIVE'; inputs: GrantStatementInput}
  | {id: string; expectedRevision: number; status: 'ARCHIVED'; inputs?: never}
);
export interface GrantStatementSetupReceipt extends GrantObject {
  id: string; version: number; action: 'statement-setup.save'; kind: 'source'; recordId: string;
  statementSetup: GrantStatementSetupSummary;
}

export type GrantWorkIntakeKind = 'WORK' | 'INVOICES';
export type GrantWorkIntakeField = 'externalId' | 'contributor' | 'costId' | 'description' | 'startDate' | 'endDate' | 'hours' | 'fundingBasis' | 'number' | 'issuedDate' | 'dueDate' | 'lineId' | 'amountUsd' | 'currency' | 'workIds';
export interface GrantWorkIntakeFormat {
  encoding: 'utf-8-sig' | 'utf-16' | 'cp1252';
  delimiter: ',' | '\t' | ';' | '|';
  headerRow: number;
  dateFormat: 'ISO' | 'DAY_FIRST' | 'MONTH_FIRST';
  decimalSeparator: '.' | ',';
  groupSeparator: '' | ',' | '.' | ' ';
}
export interface GrantWorkIntakeDocument {
  format: GrantWorkIntakeFormat;
  mapping: Partial<Record<GrantWorkIntakeField, {column: number} | {value: string}>>;
  contributors: {sourceValue: string; contributorId: string}[];
  costs: {sourceValue: string; costId: string}[];
  rowEdits: {row: number; values: Partial<Record<GrantWorkIntakeField, string>>; skip: boolean; reason: string}[];
  recordDecisions: {key: string; action: 'CREATE' | 'REUSE' | 'SKIP'; recordId: string; reason: string}[];
  sourceSystem: string;
}
export interface GrantWorkIntakeSummary {
  id: string; name: string; kind: GrantWorkIntakeKind; state: 'DRAFT' | 'APPLIED';
  revision: number; caseVersion: number; sourceId: string; sourceSha256: string;
  createdAt: string; updatedAt: string; actor: string; sha256: string;
  previewSummary: GrantWorkIntakeTotals | null;
}
export interface GrantWorkIntakeTotals {
  sourceRows: number; excludedRows: number; proposedRecords: number; newRecords: number;
  matchedRecords: number; excludedRecords: number; issueCount: number; ready: boolean;
  newHours: string; matchedHours: string; newInvoiceUsd: string; matchedInvoiceUsd: string;
}
export interface GrantWorkIntakeEdition extends GrantWorkIntakeSummary {
  schema: 'stellar-forge.sf47-work-intake.v1';
  document: GrantWorkIntakeDocument; previewSha256: string | null;
  previousSha256: string | null; note: string;
  applied: null | {caseVersion: number; appliedAt: string; actor: string; previewSha256: string;
    summary: GrantWorkIntakeTotals; links: {key: string; kind: 'work' | 'invoices'; recordId: string;
      operation: 'CREATED' | 'REUSED'; rows: number[]; externalIds: string[]; fingerprint: string; snapshot: GrantObject}[]};
}
export interface GrantWorkIntakeView {
  intake: GrantWorkIntakeEdition; source: GrantObject;
  columns: {index: number; label: string}[];
  rows: {row: number; lineStart: number; lineEnd: number; cells: string[]}[];
  history: GrantWorkIntakeSummary[]; caseVersion: number;
}
export interface GrantWorkIntakePreview extends GrantObject {
  schema: 'stellar-forge.sf47-work-intake.v1.preview';
  caseId: string; caseVersion: number; intakeId: string; intakeRevision: number;
  intakeSha256: string; kind: GrantWorkIntakeKind; document: GrantWorkIntakeDocument;
  summary: GrantWorkIntakeTotals; previewSha256: string;
  columns: {index: number; label: string}[]; rows: GrantObject[]; candidates: GrantObject[]; issues: GrantObject[];
}
export interface GrantWorkIntakeWrite extends GrantOperationRequest {
  intakeId: string; expectedRevision: number; document?: GrantWorkIntakeDocument; expectedPreviewSha256?: string;
}
export interface GrantWorkIntakeUpload extends GrantOperationRequest {
  name: string; kind: GrantWorkIntakeKind; format?: Partial<GrantWorkIntakeFormat>;
  sourceId?: string; file?: {filename: string; contentBase64: string; mediaType?: string; sourceUrl?: string; observedAt?: string};
}
export interface GrantCommercialConnectionInput {
  id: string;
  label: string;
  /** Complete local HTTP API URL including its original port and API path. */
  baseUrl: string;
  actor: string;
  requestId: string;
}
export interface GrantCommercialConnection {
  id: string;
  label: string;
  baseUrl: string;
  workspaceId: string;
  sourcesSha256: string;
  recordedBy: string;
}
export interface GrantCommercialConnections {
  schema: 'stellar-forge.commercial-receivables-connections.v1';
  endpoints: GrantCommercialConnection[];
}
export interface GrantCommercialCustomers {
  revision: number;
  issuer: GrantObject;
  customers: (GrantObject & { id: string; name: string })[];
}
export interface GrantCommercialCurrency { code: string; scale: number; }
export type GrantCommercialBillingBasis = 'PHASE_ACCEPTANCE' | 'COMMERCIAL_AUTHORIZATION';
export interface GrantCommercialScheduleInput {
  expectedVersion: number;
  installationId: string;
  installationRevision: number;
  expectedInstallationSha256: string;
  /** Exact original currency scale, from zero through six. Amounts are never rounded. */
  currencyScale: number;
}
export interface GrantCommercialMilestoneMapping {
  milestoneId: string;
  issueDate: GrantCivilDate;
  dueDate: GrantCivilDate;
  billingBasis: GrantCommercialBillingBasis;
  requiredCheckIds?: string[];
  authorizationSourceIds?: string[];
  authorizationNote?: string;
}
export interface GrantCommercialPrepareInput extends GrantCommercialScheduleInput {
  requestId: string;
  actor: string;
  expectedScheduleSha256: string;
  endpointId: string;
  customerId: string;
  /** Every original schedule milestone appears exactly once. */
  milestones: GrantCommercialMilestoneMapping[];
  purchaseOrder?: string;
  note?: string;
}
export interface GrantCommercialSource {
  sourceId: string;
  sourceSha256: string;
  packetSourceId: string | null;
  packetSha256: string | null;
  caseId: string;
  planSha256: string;
}
export interface GrantCommercialSourceMilestone {
  milestoneId: string;
  sourceIndex: number;
  label: string;
  trigger: string;
  /** Exact fixed-scale native money. */
  amount: string;
  sourceAmount: string | number;
  sourceSha256: string;
  original: GrantObject;
}
export interface GrantCommercialSchedule {
  schema: 'stellar-forge.sf47-commercial-receivables.v1';
  programId: string;
  expectedVersion: number;
  installation: GrantInstallationRef;
  source: GrantCommercialSource;
  customer: unknown;
  supplier: unknown;
  title: string;
  currency: GrantCommercialCurrency;
  amount: string;
  priceStatus: string;
  commercial: GrantObject;
  milestones: GrantCommercialSourceMilestone[];
  phaseChecks: GrantObject[];
  scheduleSha256: string;
}
export interface GrantCommercialEligibility extends GrantObject {
  ready: boolean;
}
export interface GrantCommercialIntent extends GrantObject {
  id: string;
  action: 'draft' | 'issue';
  state: string;
  actor: string;
  attempts: number;
  native: GrantObject | null;
}
export interface GrantCommercialMilestone extends GrantCommercialSourceMilestone, GrantCommercialMilestoneMapping {
  obligationKey: string;
  specificationSha256: string;
  specificationRevision: number;
  superseded: boolean;
  nativeRequestId: string;
  requiredCheckIds: string[];
  authorizationSourceIds: string[];
  authorizationNote: string;
  invoiceId: string | null;
  native: GrantObject | null;
  lastRefreshAt: string | null;
  origin: { programId: string; preparedId: string; milestoneId: string; };
  draftIntent: GrantCommercialIntent | null;
  issueIntent: GrantCommercialIntent | null;
  eligibility: GrantCommercialEligibility;
}
export interface GrantCommercialPrepared {
  schema: 'stellar-forge.sf47-commercial-receivables.v1';
  id: string;
  programId: string;
  sourceProgramId: string;
  createdAt: string;
  actor: string;
  requestId: string;
  endpointId: string;
  accountingIdentity: { workspaceId: string; sourcesSha256: string; [key: string]: unknown; };
  customerId: string;
  nativeCustomer: GrantObject;
  schedule: GrantCommercialSchedule;
  milestones: GrantCommercialMilestone[];
  purchaseOrder: string;
  note: string;
  sourceSnapshot: {
    installation: Omit<GrantInstallationEdition, 'current'>;
    commissioningCase: GrantObject;
    receivingPacket: GrantObject | null;
    workshare: GrantObject;
  };
  preparedSha256: string;
}
export interface GrantCommercialSummary {
  id: string;
  createdAt: string;
  customerName: string;
  currency: GrantCommercialCurrency;
  amount: string;
  milestoneCount: number;
  draftCount: number;
  issuedCount: number;
  voidCount: number;
  pendingCount: number;
  supersededCount: number;
}
export interface GrantCommercialList {
  schema: 'stellar-forge.sf47-commercial-receivables.v1';
  programId: string;
  items: GrantCommercialSummary[];
}
export interface GrantCommercialIssuePreview {
  id: string;
  milestoneId: string;
  invoiceId: string;
  eligibility: GrantCommercialEligibility;
  nativePreview: {
    document: GrantObject;
    previewSha256: string;
    expectedVersion: number;
    revision: number;
  };
  issuePreviewSha256: string;
  retainedIntent?: GrantCommercialIntent;
}
export interface GrantCommercialCommandResult {
  id: string;
  milestoneId: string;
  obligationKey: string;
  requestId: string;
  intent: GrantCommercialIntent;
  native: GrantObject;
  commercial: GrantCommercialPrepared;
}

export type GrantCommercialChangeMode = 'DRAFT_EDIT' | 'CREDIT' | 'VOID' | 'REPLACE';
export interface GrantCommercialChangeInput {
  expectedVersion:number; previousChangeId?:string|null; actor:string; sourceIds:string[];
  mode:GrantCommercialChangeMode; resolution?:'VOID'|'CREDIT'; targetAmount:string;
  issueDate?:string; dueDate?:string; effectiveDate:string; authorizedOn:string;
  description?:string; reason:string; authorization:string; purchaseOrder?:string; note?:string;
}
export interface GrantCommercialChangeProposal extends GrantObject {
  schema:'stellar-forge.commercial-milestone-changes.v1';
  preparedId:string; milestoneId:string; obligationKey:string; originalPreparedSha256:string;
  originalMilestone:GrantCommercialMilestone; originalWorkshare:GrantCommercialSchedule;
  endpointId:string; accountingIdentity:GrantObject; customerId:string; currency:GrantCommercialCurrency;
  invoiceId:string; mode:GrantCommercialChangeMode; targetAmount:string; actor:string;
  authorization:string; authorizationSources:Array<{id:string;metadata:GrantObject;contentBase64:string}>;
  nativeBefore:GrantObject; nativeBeforeSha256:string; nativeFingerprint:string;
  steps:Array<{action:'draft'|'credit'|'void';body:GrantObject}>;
  consequences:GrantObject;
}
export interface GrantCommercialChange extends GrantObject {
  id:string; obligationKey:string; sequence:number; createdAt:string;
  state:'PREPARED'|'RUNNING'|'APPLIED'|'CANCELLED';
  proposal:GrantCommercialChangeProposal; proposalSha256:string; activeInvoiceId:string|null;
  commands:Array<GrantObject & {index:number;action:'draft'|'credit'|'void'|'issue';requestId:string;
    state:'PENDING'|'ACKNOWLEDGED'|'REJECTED';body:GrantObject;intentSha256:string}>;
  currentNative?:GrantObject[];
}
export interface GrantCommercialChanges {
  schema:'stellar-forge.commercial-milestone-changes.v1';programId:string;preparedId:string;milestoneId:string;
  previousChangeId:string|null;items:Array<{id:string;sequence:number;state:GrantCommercialChange['state'];createdAt:string;mode:GrantCommercialChangeMode;targetAmount:string}>;
}
export interface GrantCommercialChangePreview {schema:string;proposal:GrantCommercialChangeProposal;previewSha256:string}
export interface GrantCommercialChangeIssuePreview extends GrantObject {
  id:string;nativePreview:GrantCommercialIssuePreview['nativePreview'];issuePreviewSha256:string;
  eligibility?:GrantCommercialEligibility;retainedCommand?:GrantObject;
}


/** Source-backed customer charges over reviewed original Buyer Expense portions.
 * Decimal amounts and integer native units remain strings; native Receivables owns all financial effects. */
export type GrantExpenseBillingMode = 'NEW' | 'DRAFT_EDIT' | 'CREDIT' | 'VOID' | 'REPLACE';
export interface GrantExpenseBillingLineInput {
  attributionId:string; expectedContentSha256:string; costId:string; nativeAmount:string;
  amountBasis:'REVIEWED_USD'|'AGREED_AMOUNT'; amount:string; description:string;
}
export interface GrantExpenseBillingInput {
  requestId:string; actor:string; expectedVersion:number; previousId?:string|null;
  mode:GrantExpenseBillingMode; endpointId?:string; customerId?:string; currency?:GrantCommercialCurrency;
  sourceIds:string[]; authorization:string; authorizedOn:GrantCivilDate; creditReviewNote:string; reason:string;
  issueDate?:GrantCivilDate; dueDate?:GrantCivilDate; effectiveDate?:GrantCivilDate; resolution?:'CREDIT'|'VOID';
  purchaseOrder?:string; note?:string; lines:GrantExpenseBillingLineInput[]; expectedPreviewSha256?:string;
}
export type GrantExpenseBillingPrepareInput = GrantExpenseBillingInput & {expectedPreviewSha256:string};
export interface GrantExpenseBillingLine extends GrantObject {
  portionKey:string; originalKey:string; attribution:GrantExpenseAttribution;
  allocation:GrantExpenseSplit & GrantObject; nativeAmount:string;
  amountBasis:'REVIEWED_USD'|'AGREED_AMOUNT'; amount:string; description:string;
}
export interface GrantExpenseBillingProposal extends GrantObject {
  schema:'stellar-forge.customer-expense-billing.v1'; programId:string; expectedVersion:number; caseMode:string;
  requestId:string; chainId:string; previousId:string|null; mode:GrantExpenseBillingMode; actor:string;
  endpointId:string; accountingIdentity:GrantObject; customerId:string; customer:GrantObject;
  currency:GrantCommercialCurrency; invoiceId:string|null;
  /** Complete original expense and customer-authorization source bodies, not excerpts. */
  sources:Array<{id:string;metadata:GrantObject;contentBase64:string}>;
  authorizationSourceIds:string[]; authorization:string; authorizedOn:GrantCivilDate;
  creditReviewNote:string; buyerCredits:GrantObject[]; reason:string; issueDate:GrantCivilDate;
  dueDate:GrantCivilDate; effectiveDate:GrantCivilDate; resolution:'CREDIT'|'VOID';
  purchaseOrder:string; note:string; lines:GrantExpenseBillingLine[]; terms:GrantObject;
  termsSha256:string; amount:string; nativeBefore:GrantObject|null; nativeFingerprint:string|null;
  steps:Array<{action:'draft'|'credit'|'void';body:GrantObject}>; consequences:GrantObject;
}
export interface GrantExpenseBillingCommand extends GrantObject {
  index:number; action:'draft'|'credit'|'void'|'issue'; body:GrantObject; requestId:string;
  state:'PENDING'|'REJECTED'|'ACKNOWLEDGED'; createdAt:string; attempts:GrantObject[]; intentSha256:string;
  review?:GrantExpenseBillingIssuePreview; result?:GrantObject; lastError?:GrantObject;
}
export interface GrantExpenseBillingCharge extends GrantObject {
  schema:'stellar-forge.customer-expense-billing.v1'; id:string; chainId:string; sequence:number; createdAt:string;
  state:'PREPARED'|'RUNNING'|'APPLIED'|'CANCELLED'; proposal:GrantExpenseBillingProposal;
  proposalSha256:string; activeInvoiceId:string|null; commands:GrantExpenseBillingCommand[];
  history:GrantObject[]; appliedAt?:string; current?:boolean; currentNative?:GrantObject[];
}
export interface GrantExpenseBillingCatalog extends GrantObject {
  attributions: GrantExpenseAttribution[];
  schema:'stellar-forge.customer-expense-billing.v1'; programId:string; version:number; mode:string;
  sources:GrantObject[]; buyerCredits:GrantObject[];
  portions:Array<{attribution:GrantExpenseAttribution;allocation:GrantExpenseSplit & GrantObject;
    portionKey:string;reservedNativeAmount:string;availableNativeAmount:string;selectable:boolean}>;
  items:Array<{id:string;chainId:string;sequence:number;state:GrantExpenseBillingCharge['state'];
    mode:GrantExpenseBillingMode;customerName:string;currency:GrantCommercialCurrency;amount:string;
    createdAt:string;activeInvoiceId:string|null;pending:boolean}>;
}
export interface GrantExpenseBillingPreview {
  schema:'stellar-forge.customer-expense-billing.v1';proposal:GrantExpenseBillingProposal;previewSha256:string;
}
export interface GrantExpenseBillingIssuePreview extends GrantObject {
  schema:'stellar-forge.customer-expense-billing.v1';id:string;proposalSha256:string;invoiceId:string;
  nativePreview:GrantCommercialIssuePreview['nativePreview'];supersedesRejectedCommand:number|null;
  termsSha256:string;issuePreviewSha256:string;retainedCommand?:GrantExpenseBillingCommand;
}
export interface GrantExpenseBillingApplyInput {actor:string;expectedProposalSha256:string}
export interface GrantExpenseBillingCancelInput extends GrantExpenseBillingApplyInput {requestId:string;reason:string}
export interface GrantExpenseBillingIssueInput {actor:string;expectedIssuePreviewSha256:string;creditDecisionId?:string}


/** Source-backed accepted CUSTOMER Work; exact quantities/rates stay strings.
 * Reservations coordinate copies in one Operations workspace, not independent installations. */
export type GrantWorkBillingMode = GrantExpenseBillingMode;
export interface GrantHourlyRate {
  id:string; label:string; contributorIds:string[]; costIds:string[]; hourlyRate:string;
}
export interface GrantHourlyAuthorityTerms {
  title:string; authorization:string; authorizedOn:GrantCivilDate; sourceIds:string[];
  endpointId:string; customerId:string; currency:GrantCommercialCurrency;
  periodStart:GrantCivilDate; periodEnd:GrantCivilDate; rates:GrantHourlyRate[];
  rounding:'EXACT'|'HALF_UP'; hoursCap:string|null; amountCap:string|null;
}
export interface GrantHourlyAuthorityInput {
  requestId:string; actor:string; expectedVersion:number; previousId?:string|null;
  expectedAuthoritySha256?:string; terms:GrantHourlyAuthorityTerms;
}
export interface GrantHourlyAuthority extends GrantObject {
  schema:'stellar-forge.customer-hourly-authority.v1'; id:string; familyId:string; revision:number;
  previousId:string|null; createdAt:string; actor:string; programId:string; expectedVersion:number;
  terms:GrantHourlyAuthorityTerms; termsSha256:string; accountingIdentity:GrantObject; customer:GrantObject;
  sources:Array<{id:string;metadata:GrantObject;contentBase64:string}>;
  sourceSnapshot:GrantObject; sourceSnapshotSha256:string;
  request:{body:GrantHourlyAuthorityInput;sha256:string}; sha256:string;
}
export interface GrantWorkBillingLineInput {
  workId:string; expectedWorkSha256:string; rateId:string; hours:string; description:string;
}
export interface GrantWorkBillingInput {
  requestId:string; actor:string; expectedVersion:number; previousId?:string|null;
  mode:GrantWorkBillingMode; authorityId:string; expectedAuthoritySha256:string; reason:string;
  issueDate?:GrantCivilDate; dueDate?:GrantCivilDate; effectiveDate?:GrantCivilDate;
  resolution?:'CREDIT'|'VOID'; purchaseOrder?:string; note?:string;
  lines:GrantWorkBillingLineInput[]; expectedPreviewSha256?:string;
}
export type GrantWorkBillingPrepareInput = GrantWorkBillingInput & {expectedPreviewSha256:string};
export interface GrantWorkBillingLine extends GrantObject {
  portionKey:string; originalKey:string; work:GrantObject; workSha256:string;
  workContentSha256:string; rate:GrantHourlyRate; nativeAmount:string; hours:string;
  amount:string; description:string;
}
export interface GrantWorkBillingProposal extends GrantObject {
  schema:'stellar-forge.customer-work-billing.v1'; programId:string; expectedVersion:number; caseMode:string;
  requestId:string; chainId:string; previousId:string|null; mode:GrantWorkBillingMode; actor:string;
  sourceSnapshot:GrantObject; sourceSnapshotSha256:string; authority:GrantHourlyAuthority;
  endpointId:string; accountingIdentity:GrantObject; customerId:string; customer:GrantObject;
  currency:GrantCommercialCurrency; invoiceId:string|null;
  sources:Array<{id:string;metadata:GrantObject;contentBase64:string}>;
  authorization:string; authorizedOn:GrantCivilDate; authorizationSourceIds:string[];
  reason:string; issueDate:GrantCivilDate; dueDate:GrantCivilDate; effectiveDate:GrantCivilDate;
  resolution:'CREDIT'|'VOID'; purchaseOrder:string; note:string; lines:GrantWorkBillingLine[];
  terms:GrantObject; termsSha256:string; amount:string; nativeBefore:GrantObject|null;
  nativeFingerprint:string|null; steps:Array<{action:'draft'|'credit'|'void';body:GrantObject}>; consequences:GrantObject;
}
export interface GrantWorkBillingCommand extends GrantObject {
  index:number; action:'draft'|'credit'|'void'|'issue'; body:GrantObject; requestId:string;
  state:'PENDING'|'REJECTED'|'ACKNOWLEDGED'; createdAt:string; attempts:GrantObject[]; intentSha256:string;
  review?:GrantWorkBillingIssuePreview; result?:GrantObject; lastError?:GrantObject;
}
export interface GrantWorkBillingCharge extends GrantObject {
  schema:'stellar-forge.customer-work-billing.v1'; id:string; chainId:string; sequence:number; createdAt:string;
  state:'PREPARED'|'RUNNING'|'APPLIED'|'CANCELLED'; proposal:GrantWorkBillingProposal; proposalSha256:string;
  activeInvoiceId:string|null; commands:GrantWorkBillingCommand[]; history:GrantObject[];
  preparationRequest:{body:GrantWorkBillingPrepareInput;sha256:string};
  appliedAt?:string; current?:boolean; currentNative?:GrantObject[];
}
export interface GrantWorkBillingCatalog extends GrantObject {
  schema:'stellar-forge.customer-work-billing.v1'; programId:string; version:number; mode:string;
  sources:GrantObject[]; contributors:GrantObject[]; costs:GrantObject[];
  work:Array<{record:GrantObject;workSha256:string;workContentSha256:string;originalKey:string;
    reservedHours:string;availableHours:string;selectable:boolean}>;
  authorities:Array<{authority:GrantHourlyAuthority;current:boolean}>;
  items:Array<{id:string;chainId:string;sequence:number;state:GrantWorkBillingCharge['state'];mode:GrantWorkBillingMode;
    customerName:string;currency:GrantCommercialCurrency;amount:string;createdAt:string;activeInvoiceId:string|null;pending:boolean}>;
}
export interface GrantWorkBillingPreview {
  schema:'stellar-forge.customer-work-billing.v1';proposal:GrantWorkBillingProposal;previewSha256:string;
}
export interface GrantWorkBillingIssuePreview extends GrantObject {
  schema:'stellar-forge.customer-work-billing.v1';id:string;proposalSha256:string;invoiceId:string;
  nativePreview:GrantCommercialIssuePreview['nativePreview'];supersedesRejectedCommand:number|null;
  termsSha256:string;issuePreviewSha256:string;retainedCommand?:GrantWorkBillingCommand;
}
export type GrantWorkBillingApplyInput = GrantExpenseBillingApplyInput;
export type GrantWorkBillingCancelInput = GrantExpenseBillingCancelInput;
export type GrantWorkBillingIssueInput = GrantExpenseBillingIssueInput;

export interface GrantAmendmentInputs {
  /** Explicit budget attribution; null leaves a retained observation unassigned. */
  packageMappings?: Array<{ fromCostId: string; toCostId: string | null; note: string }>;
  selectedRevision: number;
  expectedContentSha256: string;
  asOfDate: GrantCivilDate;
  reason: string;
  basis: {
    kind: 'INTERNAL_PLAN' | 'ISSUER_DECISION' | 'CUSTOMER_DECISION' | 'WALKTHROUGH';
    reference?: string;
    date?: GrantCivilDate | null;
    sourceIds?: string[];
    note?: string;
  };
}
export interface GrantAmendmentEdition extends GrantObject {
  id: string; revision: number; version: number; sha256: string;
  state: 'PROPOSED' | 'REVIEWED' | 'CHANGES_REQUESTED' | 'APPLIED';
  preview: GrantObject & { inputs: GrantAmendmentInputs; previewSha256: string };
  review: GrantObject | null;
  application: GrantObject | null;
}
export interface GrantAmendmentCalendarEntry extends GrantObject {
  id: string; kind: GrantDeliveryCalendarKind; tranche: number | null;
  change: 'ADDED' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';
  changedFields: string[]; scheduleChanged: boolean; awardDatesChanged: boolean;
  assignmentRetained: boolean;
  before: GrantDeliveryCalendarEntry | null;
  selected: GrantDeliveryCalendarEntry | null;
}
export interface GrantAmendmentCalendar extends GrantObject {
  schema: 'stellar-forge.sf47-amendment-calendar.v1';
  generatedAt: string; asOfDate: GrantCivilDate; impactSha256: string;
  source: {
    caseId: string; caseVersionAtPreview: number; businessSha256: string; previewSha256: string;
    beforePlan: {revision: number; contentSha256: string; sourceSha256: string};
    selectedPlan: {revision: number; contentSha256: string; sourceSha256: string};
    amendment: {id: string; revision: number; sha256: string; state: string; version: number} | null;
  };
  before: GrantDeliveryCalendar; selected: GrantDeliveryCalendar;
  entries: GrantAmendmentCalendarEntry[]; paymentClocks: GrantObject[]; basis: string[];
  summary: {
    beforeDated: number; selectedDated: number; beforeUndated: number; selectedUndated: number;
    changedEntries: number; addedEntries: number; removedEntries: number; scheduleChanges: number;
    awardDateChanges: number; retainedAssignments: number; originalPaymentEntries: number;
    paymentEntriesUnchanged: true;
  };
}
export interface GrantAmendmentPreview extends GrantObject {
  inputs: GrantAmendmentInputs; observedVersion: number; previewSha256: string;
  calendarImpact: GrantAmendmentCalendar;
}
export type GrantAmendmentCalendarExportSelection =
  | {expectedVersion: number; inputs: GrantAmendmentInputs; expectedPreviewSha256: string; expectedImpactSha256: string}
  | {amendmentId: string; revision: number; expectedAmendmentSha256: string; expectedImpactSha256: string};

export interface GrantAmendmentSaveData extends GrantObject {
  amendmentId?: string | null; expectedRevision: number;
  inputs: GrantAmendmentInputs; expectedPreviewSha256: string;
}
export interface GrantAmendmentReviewData extends GrantObject {
  amendmentId: string; expectedRevision: number; expectedAmendmentSha256: string;
  expectedPreviewSha256: string; decision: 'APPROVE' | 'RETURN_FOR_CHANGES';
  statement: string; sourceIds?: string[];
}
export interface GrantAmendmentApplyData extends GrantObject {
  amendmentId: string; expectedRevision: number; expectedAmendmentSha256: string;
  acknowledgeBaselineChange: true;
}

export interface GrantBindingInput {
  directory: string;
  scenarioFile?: string;
  pythonExecutable?: string;
  allowStart?: boolean;
  label?: string;
}
export interface GrantSourceSelection {
  schema: 'stellar-forge.sf47.workspace-selection.v1';
  workspaceDirectory: string;
  sourceDirectory: string;
  scenarioFile: string;
  scenarioSha256: string;
  pythonExecutable: string;
  pythonRealPath: string;
  sourceSha256: Record<string, string>;
}
export interface GrantBinding {
  directory: string;
  scenarioFile: string;
  pythonExecutable: string;
  allowStart: boolean;
  label: string;
  selectionSha256: string;
  selection: GrantSourceSelection;
}
export interface GrantResponseSource {
  schema: 'stellar-forge.sf47.workspace-launch.v1';
  instanceId: string;
  pid: number;
  selectionSha256: string;
  url: string;
  sourceDirectory: string;
  executionSourceDirectory: string;
}
export interface GrantNativeResponse<T = unknown> {
  value: T | undefined;
  bytes: Buffer;
  mediaType: string;
  status: number;
  sha256: string;
  source: GrantResponseSource;
  filename: string | null;
}
export interface GrantJsonResponse<T> extends GrantNativeResponse<T> { value: T; }
export interface GrantClientSummary {
  schema: typeof GRANT_AGENT_SCHEMA;
  label: string;
  selectionSha256: string;
  allowStart: boolean;
  connection: 'OWNED_ORIGINAL_SERVICE' | 'BORROWED_ORIGINAL_SERVICE' | 'CLOSED' | 'ORIGINAL_SERVICE_UNAVAILABLE';
  instanceId: string | null;
  activeRequests: number;
}
export interface GrantInspection extends GrantClientSummary {
  original?: GrantObject;
  reason?: string;
  recovery?: string;
}
export interface GrantCloseResult {
  schema: typeof GRANT_AGENT_SCHEMA;
  state: 'OWNED_ORIGINAL_SERVICE_CLOSED' | 'BORROWED_CONNECTION_RELEASED';
  originalInstanceId: string | null;
  /** Reported only after the original child and its stdio have closed. */
  result?: { code: number | null; signal: string | null; error?: string | null;
    errorChannel?: 'launcher' | 'stdout' | 'stderr' | null; diagnostics?: string; message?: string };
}
/** Failures retain the original code/status and, for an uncertain write, its request ID. */
export interface GrantClientError extends Error {
  code: string;
  status?: number;
  definite?: boolean;
  uncertain?: boolean;
  requestId?: string | null;
  source?: GrantResponseSource;
  recovery?: string;
}

export interface GrantDeliveryStepInput {
  checkId: string;
  /** Empty or omitted inherits the installation assignee. */
  owner?: string;
  /** Empty, null or omitted inherits the installation date. */
  dueDate?: GrantCivilDate | null;
  priority?: GrantDeliveryPriority | 'INHERIT';
  /** Distinct existing check IDs. Self references and cycles are rejected. */
  dependsOn?: string[];
  note?: string;
}
export interface GrantDeliveryCoordinationInput {
  owner?: string;
  dueDate?: GrantCivilDate | null;
  priority?: GrantDeliveryPriority;
  note?: string;
  steps?: GrantDeliveryStepInput[];
}
export interface GrantDeliveryStep {
  checkId: string;
  owner: string;
  dueDate: GrantCivilDate | null;
  priority: GrantDeliveryPriority | 'INHERIT';
  dependsOn: string[];
  note: string;
}
export interface GrantDeliveryCoordination {
  owner: string;
  dueDate: GrantCivilDate | null;
  priority: GrantDeliveryPriority;
  note: string;
  steps: GrantDeliveryStep[];
}
export interface GrantInstallationCheck {
  id: string;
  title: string;
  criterion: string;
  tranche: 1 | 2 | 3 | null;
  required: boolean;
  state: GrantCheckState;
  operator: string;
  observedAt: string | null;
  note: string;
  sourceIds: string[];
  workIds: string[];
  purchaseIds: string[];
  outcomeIds: string[];
}
export type GrantInstallationSupportAnchor = 'ACCEPTANCE' | 'HANDOFF';
export interface GrantInstallationEffortAllocation {
  workId: string;
  phaseId: string;
  /** Selected hours from this original Work record, retained as a decimal string. */
  hours: string;
  workContentSha256: string;
  note: string;
}
export interface GrantInstallationEffortReview {
  phaseId: string;
  /** Null retains an unentered remaining estimate. */
  remainingHours: string | null;
  reviewedBy: string;
  reviewedAt: string | null;
  basisSha256: string;
  note: string;
  sourceIds: string[];
}
export interface GrantInstallationSupportWindow {
  id: string;
  phaseIds: string[];
  includedHours: string;
  anchorPhaseId: string;
  anchorKind: GrantInstallationSupportAnchor;
  calendarDays: number;
  /** RFC6901-style pointers into the complete original Workshare plan. */
  sourcePaths: string[];
  /** Exact reviewed Workshare plan; remains pinned until its terms are reviewed again. */
  sourcePlanSha256: string;
  reviewedBy: string;
  reviewedAt: string;
  note: string;
}
export interface GrantInstallationEffortDocument {
  schema: 'stellar-forge.sf47-installation-effort.v1';
  asOfDate: GrantCivilDate;
  allocations: GrantInstallationEffortAllocation[];
  reviews: GrantInstallationEffortReview[];
  supportWindows: GrantInstallationSupportWindow[];
  note: string;
}
export type GrantInstallationEffortStatus = 'READY' | 'REVIEW_REQUIRED';
export type GrantInstallationEffortWorkState = 'LOGGED' | 'SUBMITTED' | 'ACCEPTED' | 'VOID';
export type GrantInstallationEffortFundingBasis = 'PREAWARD' | 'GRANT' | 'CUSTOMER' | 'INTERNAL';
export type GrantInstallationSupportStatus =
  | 'AWAITING_ORIGINAL_ACCEPTANCE' | 'NOT_STARTED' | 'ACTIVE' | 'EXPIRED';
export type GrantInstallationSupportWorkClassification =
  | 'VOID' | 'AWAITING_ANCHOR' | 'BEFORE_WINDOW' | 'AFTER_WINDOW'
  | 'WITHIN_WINDOW' | 'SPANS_WINDOW_BOUNDARY';
export interface GrantInstallationEffortCommercialIdentity {
  caseId: string;
  caseKey: string;
  quoteId: string;
  quoteSha256: string;
  acceptanceId: string;
  acceptanceSha256: string;
  scopeSha256: string;
  sourceId: string;
  sourceSha256: string;
}
export interface GrantInstallationEffortOriginalPhase {
  /** Original Workshare phase ID or accepted SF74 task ID. */
  phaseId: string;
  taskId?: string;
  definitionSha256?: string;
  title: string;
  /** Null when an accepted quotation does not bind task effort. */
  quotedHours: string | null;
  owner: unknown;
  dependsOn: string[];
  businessDays: number | null;
  terms: GrantObject;
  checkId: string;
  checkState: GrantCheckState;
  checkOperator: string;
  checkObservedAt: string | null;
}
export interface GrantInstallationEffortWorkshareSource {
  sourceKind?: undefined;
  commercial?: undefined;
  caseId: string;
  planSha256: string;
  title: string;
  customer: unknown;
  quotedHours: string;
  sourceId: string;
  sourceSha256: string;
  plan: GrantObject;
  phases: GrantInstallationEffortOriginalPhase[];
}
export interface GrantInstallationEffortCommercialSource {
  sourceKind: 'COMMERCIAL';
  commercial: GrantInstallationEffortCommercialIdentity;
  caseId: string;
  title: string;
  customer: string;
  quotedHours: null;
  sourceId: string;
  sourceSha256: string;
  scope: GrantObject;
  effortBasis: string;
  phases: GrantInstallationEffortOriginalPhase[];
}
export type GrantInstallationEffortPhaseSource = GrantInstallationEffortWorkshareSource | GrantInstallationEffortCommercialSource;
export interface GrantInstallationEffortWork extends GrantObject {
  id: string;
  contributorId: string;
  costId: string | null;
  description: string;
  startDate: GrantCivilDate;
  endDate: GrantCivilDate;
  hours: string;
  fundingBasis: GrantInstallationEffortFundingBasis;
  state: GrantInstallationEffortWorkState;
  sourceIds: string[];
  sourceNote: string;
}
export interface GrantInstallationEffortWorkAmounts extends GrantInstallationEffortWork {
  workId: string;
  workContentSha256: string;
  contributorName: string;
  selectedAllocatedHours: string;
  otherAllocatedHours: string;
  totalAllocatedHours: string;
  unallocatedHours: string;
  overallocatedHours: string;
}
export interface GrantInstallationEffortWorkBalance extends GrantInstallationEffortWorkAmounts {
  sourceChangedAllocationCount: number;
}
export interface GrantInstallationEffortOtherAllocation extends GrantInstallationEffortAllocation {
  installationId: string;
  installationRevision: number;
  installationSha256: string;
  name: string;
}
export interface GrantInstallationEffortWorkInventory extends GrantInstallationEffortWorkAmounts {
  /** Attributions in the other current saved Installation heads in this case. */
  allocations: GrantInstallationEffortOtherAllocation[];
}
export interface GrantInstallationEffortAllocationResult extends GrantInstallationEffortAllocation {
  currentWorkContentSha256: string;
  sourceChanged: boolean;
  workState: GrantInstallationEffortWorkState;
  startDate: GrantCivilDate;
  endDate: GrantCivilDate;
  description: string;
  contributorId: string;
  fundingBasis: GrantInstallationEffortFundingBasis;
  costId: string | null;
}
export interface GrantInstallationEffortPhaseResult extends GrantInstallationEffortOriginalPhase {
  /** Present for a retained phase from an earlier original plan. */
  retired?: true;
  originalPlanSha256?: string;
  originalScopeSha256?: string;
  originalCommercial?: GrantInstallationEffortCommercialIdentity;
  allocatedHours: string;
  recordedHours: string;
  acceptedHours: string;
  voidHours: string;
  sourceChangedHours: string;
  afterAsOfHours: string;
  spansAsOfHours: string;
  quoteBalanceHours: string | null;
  recordedOverrunHours: string | null;
  remainingHours: string | null;
  remainingReviewCurrent: boolean;
  reviewBasisSha256: string;
  review: GrantInstallationEffortReview;
  projectedTotalHours: string | null;
  projectedOverrunHours: string | null;
  allocations: GrantInstallationEffortAllocationResult[];
}
export interface GrantInstallationSupportAttribution {
  workId: string;
  phaseId: string;
  hours: string;
  state: GrantInstallationEffortWorkState;
  startDate: GrantCivilDate;
  endDate: GrantCivilDate;
  classification: GrantInstallationSupportWorkClassification;
  sourceChanged: boolean;
}
export interface GrantInstallationSupportResult extends GrantInstallationSupportWindow {
  status: GrantInstallationSupportStatus;
  sourceCurrent: boolean;
  sourceTerms: {path: string; value: unknown}[];
  anchor: {
    phaseId: string;
    checkId: string;
    kind: GrantInstallationSupportAnchor;
    checkState: GrantCheckState;
    operator: string;
    /** Present only for the original ACCEPTED phase observation. */
    observedAt: string | null;
    startDate: GrantCivilDate | null;
    dateBasis: 'ORIGINAL_OBSERVATION_CIVIL_DATE';
  };
  windowEndDate: GrantCivilDate | null;
  daysRemaining: number | null;
  recordedHours: string;
  acceptedHours: string;
  includedHoursBalance: string;
  recordedOverrunHours: string;
  reviewedRemainingHours: string | null;
  projectedOverrunHours: string | null;
  withinWindowAttributedHours: string;
  beforeWindowAttributedHours: string;
  afterWindowAttributedHours: string;
  boundarySpanningAttributedHours: string;
  unanchoredAttributedHours: string;
  attributions: GrantInstallationSupportAttribution[];
}
export interface GrantInstallationEffortSummary {
  quotedHours: string | null;
  allocatedHours: string;
  recordedHours: string;
  acceptedHours: string;
  voidHours: string;
  sourceChangedHours: string;
  afterAsOfHours: string;
  spansAsOfHours: string;
  unallocatedSelectedWorkHours: string;
  overallocatedWorkHours: string;
  reviewedPhases: number;
  totalPhases: number;
  retiredPhases: number;
  reviewedRemainingHours: string | null;
  projectedTotalHours: string | null;
  projectedOverrunHours: string | null;
}
export interface GrantInstallationEffortFinding {
  code: string;
  field: string;
  message: string;
  preventsPlanning: boolean;
}
export interface GrantInstallationEffortReport {
  schema: 'stellar-forge.sf47-installation-effort.v1';
  sourceKind?: 'COMMERCIAL';
  commercial?: GrantInstallationEffortCommercialIdentity;
  effortBasis?: string;
  asOfDate: GrantCivilDate;
  status: GrantInstallationEffortStatus;
  readyForPlanning: boolean;
  summary: GrantInstallationEffortSummary;
  phases: GrantInstallationEffortPhaseResult[];
  work: GrantInstallationEffortWorkBalance[];
  supportWindows: GrantInstallationSupportResult[];
  findings: GrantInstallationEffortFinding[];
  /** Native digest of the complete effort report before this field is added. */
  reportSha256: string;
}
export interface GrantInstallationReport extends GrantObject {
  effort?: GrantInstallationEffortReport;
}
export interface GrantInstallationEffortSelectedPhase {
  phaseId: string;
  remainingHours: string;
  reviewBasisSha256: string;
  review: GrantInstallationEffortReview & {remainingHours: string};
}
export interface GrantInstallationEffortSelectedEdition extends GrantPortfolioInstallationSelection {
  caseId: string;
  planSha256: string;
  effortReportSha256: string;
  asOfDate: GrantCivilDate;
  originalRemainingHours: string | null;
  remainingHours: string;
  phases: GrantInstallationEffortSelectedPhase[];
}
export interface GrantInstallationEffortPlanningSelection {
  schema: 'stellar-forge.sf47-installation-effort.v1.selection';
  forecastId: string;
  forecastSha256: string;
  installationSelections: GrantPortfolioInstallationSelection[];
  effort: GrantInstallationEffortSelectedEdition[];
  /** Native digest of this retained selection before its sha256 is added. */
  sha256: string;
}

/** Start from a native seed or saved edition and retain its entire document. */
/** A dated useful request is separate from its original direct/prepaid settlement. */
export type GrantCustomerUseMode = 'PURCHASE' | 'ALLOWANCE_USE' | 'REOPEN' | 'FREE_USE';
export interface GrantCustomerUseTask {
  id: string;
  name: string;
  purpose: string;
  request: string;
  completeOutput: string;
  repeatTrigger: string;
  pricedUnit: string;
  sourceIds: string[];
}
export interface GrantCustomerUseSettlement {
  id: string;
  buyerDeploymentId: string;
  taskId: string;
  date: GrantCivilDate;
  kind: 'DIRECT' | 'PREPAID';
  /** Existing native observations only. A use row never creates a purchase. */
  purchaseIds: string[];
  sourceIds: string[];
  note: string;
  patternId: string | null;
}
export interface GrantCustomerUseEntry {
  id: string;
  buyerDeploymentId: string;
  taskId: string;
  date: GrantCivilDate;
  state: 'PLANNED' | 'CANCELLED';
  mode: GrantCustomerUseMode;
  fundingIds: string[];
  sourcePeriod: string;
  sourceIds: string[];
  note: string;
  patternId: string | null;
}
export interface GrantCustomerUseDocument {
  schema: 'stellar-forge.sf47-customer-use-calendar.v1';
  name: string;
  tranche: 2 | 3 | null;
  startDate: GrantCivilDate;
  endDate: GrantCivilDate;
  sourceIds: string[];
  note: string;
  tasks: GrantCustomerUseTask[];
  settlements: GrantCustomerUseSettlement[];
  entries: GrantCustomerUseEntry[];
}
export interface GrantCustomerUsePattern {
  id: string;
  taskIds: string[];
  buyerDeploymentIds: string[];
  /** Explicit civil weekdays: Monday=0 through Sunday=6. No inferred holidays. */
  weekdays?: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>;
  includeDates?: GrantCivilDate[];
  excludeDates?: GrantCivilDate[];
  mode?: GrantCustomerUseMode;
  fundingByBuyer?: Record<string, string[]>;
  /** Replace only this named expansion; other draft rows remain. */
  replacePattern?: boolean;
}
export interface GrantCustomerUseEditionSelection {
  id: string;
  revision: number;
  sha256?: string;
}
export interface GrantCustomerUseSelection {
  expectedVersion: number;
  installationRefs?: GrantCustomerUseEditionSelection[];
  asOfDate?: GrantCivilDate;
}
export interface GrantCustomerUseCounts {
  datedUses: number;
  purchaseUses: number;
  allowanceUses: number;
  reopens: number;
  freeUses: number;
  plannedSettlementGroups: number;
  directSettlementGroups: number;
  prepaidSettlementGroups: number;
  namedBuyerOperators: number;
  repeatNamedBuyerOperators: number;
  activeDates: number;
  basis: string;
}
export interface GrantCustomerUseTarget {
  key: string;
  expected: number;
  plannedPotential: number | null;
  countSufficient: boolean | null;
  qualification: 'UNREVIEWED_PLAN';
  actual: null;
}
export interface GrantCustomerUseWindow {
  startDate: GrantCivilDate;
  endDate: GrantCivilDate;
  calendarDays: number;
  requiredCalendarDays: number;
  matches: boolean;
}
export interface GrantCustomerUseReceipt extends GrantObject {
  id: string;
  deploymentId: string;
  network: string;
  asset: string;
  amountStroops: string;
  feesStroops?: string | null;
  intentId?: string | null;
  operationId?: string | null;
  requestId?: string | null;
  transactionHash?: string | null;
  ledger?: number | null;
  attemptStatus: string;
  settlementStatus: string;
  outputStatus: string;
  orderStatus?: string;
  state: string;
  observedAt?: string;
  settledAt?: string | null;
  outputCompletedAt?: string | null;
  sourceIds?: string[];
}
export interface GrantCustomerUseReport {
  schema: 'stellar-forge.sf47-customer-use-calendar.v1.report';
  name: string;
  planned: GrantCustomerUseCounts;
  rule: GrantObject | null;
  window: GrantCustomerUseWindow | null;
  targets: GrantCustomerUseTarget[];
  findings: Array<{code: string; id: string | null; field?: string; message: string}>;
  settlements: Array<GrantCustomerUseSettlement & {task: GrantCustomerUseTask; uses: string[];
    receipts: GrantCustomerUseReceipt[]; receiptCount: number; receiptIdentityCount: number;
    firstUsefulResultDate: GrantCivilDate | null; actualQualification: 'USE_ORIGINAL_COHORT_REVIEW'}>;
  entries: Array<GrantCustomerUseEntry & {task: GrantCustomerUseTask; buyer: GrantObject}>;
  receiptInventory: GrantCustomerUseReceipt[];
  receiptStates: Record<string, number>;
  sourceIds: string[];
  actualPurchaseCount: null;
  actualPurchaseBasis: string;
}
export interface GrantCustomerUseCalendar {
  schema: 'stellar-forge.sf47-customer-use-calendar.v1.selection';
  source: {caseId: string; caseVersion: number; mode: 'OPERATIONS' | 'WALKTHROUGH';
    planId: string; planContentSha256: string};
  asOfDate: GrantCivilDate;
  selection: GrantInstallationRef[];
  calendars: Array<GrantInstallationRef & {createdAt: string; sourceVersion: number; name: string;
    stage: GrantInstallationStage; groupId: string; document: GrantCustomerUseDocument;
    report: GrantCustomerUseReport; savedReport: GrantCustomerUseReport | null; sourceChanged: boolean;
    currentChanges: {missingRecords: Array<{kind: string; id: string}>; changedRecords: GrantObject[]; missingSources: string[]; changedSources: string[]}}>;
  groups: Array<{id: string; tranche: 2 | 3 | null; startDate: GrantCivilDate; endDate: GrantCivilDate;
    planContentSha256: string; planChanged: boolean; planned: GrantCustomerUseCounts;
    rule: GrantObject | null; window: GrantCustomerUseWindow | null; targets: GrantCustomerUseTarget[]}>;
  dueUses: Array<{installationId: string; revision: number; entryId: string; date: GrantCivilDate; mode: GrantCustomerUseMode}>;
  receipts: Array<{purchase: GrantCustomerUseReceipt; currentAvailable: boolean;
    savedObservations: Array<{installationId: string; revision: number; purchase: GrantCustomerUseReceipt}>;
    bindings: Array<{installationId: string; revision: number; fundingId: string}>}>;
  receiptConflicts: Array<{purchaseId: string;
    bindings: Array<{installationId: string; revision: number; fundingId: string}>}>;
  unlinkedPurchases: GrantCustomerUseReceipt[];
  sources: GrantObject[];
  qualification: string;
}
export interface GrantCustomerUseExpansionInput {
  expectedVersion: number;
  document: GrantInstallationDocument;
  pattern: GrantCustomerUsePattern;
}
export interface GrantCustomerUseExpansion {
  schema: 'stellar-forge.sf47-customer-use-calendar.v1.expansion';
  document: GrantInstallationDocument;
  pattern: GrantCustomerUsePattern;
  dates: GrantCivilDate[];
  generatedIds: string[];
  calendar: GrantCustomerUseReport;
  source: GrantObject;
  save: string;
}
export interface GrantCustomerUseCohortSelection {
  expectedVersion: number;
  installationRefs?: GrantCustomerUseEditionSelection[];
  groupId: string;
  asOfAt?: string;
}
export interface GrantCustomerUseCohortInput extends GrantObject {
  schema: 'stellar-forge.sf47-cohort-evaluation.v1';
  source: {programId: string; version: number; planContentSha256: string};
  rule: GrantObject;
  /** Original Cohort input; transfer/output/order and coverage remain unreviewed. */
  inputs: GrantObject;
  inventory: GrantObject;
  sources: GrantObject[];
  customerUse: {schema: 'stellar-forge.sf47-customer-use-calendar.v1.cohort-selection';
    groupId: string; selection: GrantInstallationRef[]; caseVersion: number; automaticQualification: false};
}
export interface GrantCustomerUseDownloadSelection extends GrantCustomerUseSelection {
  caseId: string;
  /** Defaults to complete JSON. */
  format?: 'json' | 'csv' | 'ics';
}


export type GrantCommissioningReviewState = 'OPEN' | 'APPROVED' | 'CHANGES_REQUIRED';
export interface GrantCommissioningDecision {
  state: GrantCommissioningReviewState;
  actor: string;
  observedAt: string | null;
  note: string;
  basisSha256: string;
}
export interface GrantCommissioningDecisionView extends GrantCommissioningDecision {
  basisCurrent: boolean;
  status: 'OPEN' | 'CURRENT' | 'STALE';
  effectiveApproval: boolean;
}
export interface GrantCommissioningFile {
  cycleId: string;
  deliveryId: string;
  path: string;
  bytes: number;
  sha256: string;
}
export interface GrantCommissioningCycle {
  cycleId: string;
  profileId: string;
  seriesId: string;
  seriesRevision: number;
  seriesName: string;
  customer: string;
  task: string;
  period: {start: string; end: string};
  dueDate: string;
  sourceEdition: string;
  reason: string;
  runId: string;
  state: string;
  completedAt: string | null;
  planSha256: string;
  resultSha256: string;
  calls: {id: string; sha256: string; state: string}[];
  steps: {index: number; id: string | null; state: string | null}[];
  files: Omit<GrantCommissioningFile, 'cycleId'>[];
}
export interface GrantCommissioningFunding {
  fundingId: string;
  units: number | null;
  priceAtomic: string | null;
  budgetAtomic: string | null;
  sourceIds: string[];
  note: string;
  review: GrantCommissioningDecision;
}
export interface GrantCommissioningReceiptLink {
  purchaseId: string;
  cycleId: string;
  callId: string;
  /** Explicit operator correspondence; never a new payment or transfer verification. */
  note: string;
}
export interface GrantCommissioningUse {
  entryId: string;
  cycleIds: string[];
  /** Exact original facts returned by preparation and checked against retained source bytes. */
  facts: GrantCommissioningCycle[];
  sourceIds: string[];
  note: string;
  outputEvidence: 'UNSELECTED' | 'NATIVE_RESULTS' | 'SELECTED_FILES';
  outputFiles: GrantCommissioningFile[];
  receiptLinks: GrantCommissioningReceiptLink[];
  planReview: GrantCommissioningDecision;
  receivingReview: GrantCommissioningDecision;
}
export interface GrantCommissioningDocument {
  schema: 'stellar-forge.sf47-customer-commissioning.v1';
  note: string;
  aggregateBudgetAtomic: string | null;
  authority: string;
  sourceIds: string[];
  budgetReview: GrantCommissioningDecision;
  funding: GrantCommissioningFunding[];
  uses: GrantCommissioningUse[];
}
export interface GrantCommissioningFundingView extends GrantCommissioningFunding {
  basisSha256: string;
  canApprove: boolean;
  reviewFindings: string[];
  review: GrantCommissioningDecisionView;
  active: boolean;
  useIds: string[];
  expectedAtomic: string | null;
  recordedSettledAtomic: string | null;
  completeAmountComparison: boolean;
  receipts: GrantObject[];
  issues: GrantObject[];
}
export interface GrantCommissioningUseView extends GrantCommissioningUse {
  planBasisSha256: string;
  receivingBasisSha256: string;
  canApprovePlan: boolean;
  canAcceptOutput: boolean;
  planFindings: string[];
  receivingFindings: string[];
  planReview: GrantCommissioningDecisionView;
  receivingReview: GrantCommissioningDecisionView;
  fundingReviewed: boolean;
  outputSelections: (GrantCommissioningFile & {matchesOriginal: boolean})[];
  receiptCorrespondence: (GrantCommissioningReceiptLink & {matchesOriginalCall: boolean; basis: 'EXPLICIT_OPERATOR_CORRESPONDENCE'})[];
}
export interface GrantCommissioningReport {
  schema: 'stellar-forge.sf47-customer-commissioning.v1.report';
  payment: GrantObject;
  budget: {
    aggregateBudgetAtomic: string | null;
    expectedAtomic: string | null;
    selectedGroupBudgetsAtomic: string | null;
    activeFundingGroups: number;
    uncoveredFundingIds: string[];
    basisSha256: string;
    canApprove: boolean;
    findings: string[];
    review: GrantCommissioningDecisionView;
    recordedSettledAtomic: string | null;
    completeAmountComparison: boolean;
    identityGroups: number;
    issues: GrantObject[];
  };
  funding: GrantCommissioningFundingView[];
  uses: GrantCommissioningUseView[];
  sharedCycles: {cycleId: string; entryIds: string[]}[];
  findings: {code: string; id: string; message: string}[];
  summary: {
    mappedUses: number; planReviewedUses: number; acceptedOutputs: number;
    stalePlanReviews: number; staleOutputReviews: number; reviewedFundingGroups: number;
  };
  calendar: GrantObject;
  interpretation: {amounts: string; correspondence: string; qualification: string; operation: string};
}
export interface GrantCommissioningReviewInput extends GrantInstallationPreviewInput {
  actor: string;
  observedAt: string;
  reviews: {
    kind: 'FUNDING' | 'BUDGET' | 'PLAN' | 'OUTPUT';
    id: string | null;
    state: 'APPROVED' | 'CHANGES_REQUIRED';
    expectedBasisSha256: string;
    note: string;
  }[];
}
export interface GrantCommissioningPreparation {
  schema: 'stellar-forge.sf47-customer-commissioning.v1.preparation';
  document: GrantInstallationDocument & {commissioning: GrantCommissioningDocument};
  inventory: {
    profileId: string | null;
    cycles: GrantCommissioningCycle[];
    entries: GrantObject[];
    tasks: GrantObject[];
    funding: GrantObject[];
  };
  refreshedEntryIds: string[];
  report: GrantCommissioningReport;
  reviewed?: number;
  save: string;
}

export interface GrantInstallationDocument {
  name: string;
  stage: GrantInstallationStage;
  merchantDeploymentId: string | null;
  buyerDeploymentIds: string[];
  workorder: GrantObject;
  task: GrantObject;
  source: GrantObject;
  payment: GrantObject;
  receiving: GrantObject;
  assignments: GrantObject;
  checks: GrantInstallationCheck[];
  workshare?: GrantObject;
  commercial?: GrantCommercialInstallationBinding;
  workflowPeriods?: unknown;
  coordination?: GrantDeliveryCoordinationInput;
  useCalendar?: GrantCustomerUseDocument | null;
  commissioning?: GrantCommissioningDocument;
  effort?: GrantInstallationEffortDocument;
}
export interface GrantInstallationRef {
  id: string;
  revision: number;
  sha256: string;
}
export interface GrantDeliveryInstallation extends GrantInstallationRef {
  name: string;
  stage: GrantInstallationStage;
  sourceAvailable: boolean;
  sourceRecordsChanged: boolean;
  coordination: GrantDeliveryCoordination;
}
export interface GrantDeliveryPrerequisite {
  id: string;
  title: string;
  state: GrantCheckState;
}
export interface GrantDeliveryRow {
  key: string;
  installationId: string;
  installationName: string;
  revision: number;
  editionSha256: string;
  taskId: string;
  kind: 'CONFIGURATION' | 'ACCEPTANCE';
  title: string;
  criterion: string;
  stage: GrantInstallationStage;
  state: GrantCheckState | 'COMPLETE';
  required: boolean;
  owner: string;
  dueDate: GrantCivilDate | null;
  priority: GrantDeliveryPriority;
  dueStatus: GrantDeliveryDueStatus;
  done: boolean;
  retired: boolean;
  caseClosed: boolean;
  /** Open active work with no unfinished declared prerequisite. */
  ready: boolean;
  dependsOn: string[];
  waitingOn: GrantDeliveryPrerequisite[];
  sourceAvailable: boolean;
  sourceRecordsChanged: boolean;
  note: string;
  acceptanceOperator: string;
  /** Original check observedAt; inspect state for its acceptance outcome. */
  acceptedAt: string | null;
}
export interface GrantDeliveryQueue {
  schema: 'stellar-forge.sf47-delivery-queue.v1';
  asOfDate: GrantCivilDate;
  source: {
    caseId: string;
    caseName: string;
    caseVersion: number;
    caseState: string;
    planId: string;
    planRevision: number;
    planContentSha256: string;
    installationHeads: GrantInstallationRef[];
  };
  summary: {
    installations: number;
    tasks: number;
    open: number;
    overdue: number;
    dueToday: number;
    unassigned: number;
    waiting: number;
    ready: number;
    completed: number;
    changedInstallations: number;
  };
  owners: { owner: string; open: number }[];
  installations: GrantDeliveryInstallation[];
  rows: GrantDeliveryRow[];
  /** Native digest of the queue object before this field is added. */
  sha256: string;
}
export type GrantLedgerKind = 'contributors' | 'work' | 'invoices' | 'cash';
export interface GrantLedgerFile {
  id: string;
  filename: string;
  kind: GrantLedgerKind | 'source';
  format: 'csv' | 'tsv' | 'json' | 'binary';
  contentBase64: string;
  /** Native field to original column; null explicitly ignores that native field. */
  mapping?: Record<string, string | null>;
  defaults?: GrantObject;
  sourceUrl?: string;
  observedAt?: string | null;
  mediaType?: string;
}
export interface GrantLedgerDocument {
  schema: 'stellar-forge.sf47-ledger-intake.v1';
  title: string;
  files: GrantLedgerFile[];
}
export interface GrantLedgerFileMetadata extends Omit<GrantLedgerFile, 'contentBase64' | 'mapping' | 'defaults' | 'sourceUrl' | 'observedAt' | 'mediaType'> {
  mapping: Record<string, string | null>;
  defaults: GrantObject;
  sourceUrl: string;
  observedAt: string | null;
  mediaType: string;
  bytes: number;
  sha256: string;
}
export interface GrantLedgerFileView extends GrantLedgerFileMetadata {
  headers: string[];
  rowCount: number;
  unmappedColumns: string[];
}
export interface GrantLedgerInspection extends GrantLedgerFileView {
  sample: { row: number; data: GrantObject }[];
}
export interface GrantLedgerSummary {
  records: number;
  created: number;
  replaced: number;
  files: number;
  sourceBytes: number;
  byKind: Record<GrantLedgerKind, { create: number; replace: number }>;
}
export interface GrantLedgerHistoryEntry {
  sourceId: string;
  title: string;
  recordedAt: string;
  actor: string;
  documentSha256: string;
  originalCaseId: string;
  fromVersion: number;
  version: number;
  summary: GrantLedgerSummary;
  requestId: string;
}
export interface GrantLedgerRecordPreview {
  key: string;
  kind: GrantLedgerKind;
  action: 'contributor.save' | 'work.save' | 'invoice.save' | 'cash.record';
  mode: 'create' | 'replace';
  recordId: string | null;
  fileId: string;
  /** CSV/TSV positions include the header as row one; JSON starts at one. */
  rows: number[];
  before: GrantObject | null;
  after: GrantObject;
}
export interface GrantLedgerPreview {
  schema: 'stellar-forge.sf47-ledger-preview.v1';
  title: string;
  case: { id: string; version: number; name: string; state: string; mode: 'OPERATIONS' | 'WALKTHROUGH' };
  documentSha256: string;
  canApply: boolean;
  files: GrantLedgerFileView[];
  records: GrantLedgerRecordPreview[];
  errors: { code: string; message: string; file?: number; fileId?: string | null; key?: string; rows?: number[] }[];
  summary: GrantLedgerSummary;
  alreadyRecorded: GrantLedgerHistoryEntry | null;
  previewSha256: string;
}
export interface GrantLedgerPreviewInput { document: GrantLedgerDocument; expectedVersion?: number; }
export interface GrantLedgerApplyInput extends GrantOperationRequest {
  document: GrantLedgerDocument;
  expectedPreviewSha256: string;
}
export interface GrantLedgerRecordedRow {
  key: string;
  kind: GrantLedgerKind;
  fileId: string;
  rows: number[];
  recordId: string;
  version: number;
  mode: 'create' | 'replace';
}
export interface GrantLedgerReceipt {
  id: string;
  version: number;
  action: 'ledger.intake';
  requestId: string;
  documentSha256: string;
  sourceId: string;
  summary: GrantLedgerSummary;
  files: (GrantLedgerFileMetadata & { sourceId: string })[];
  records: GrantLedgerRecordedRow[];
}
export interface GrantLedgerRecorded {
  schema: 'stellar-forge.sf47-ledger-recorded.v1';
  title: string;
  recordedAt: string;
  actor: string;
  note: string;
  requestId: string;
  caseId: string;
  fromVersion: number;
  version: number;
  documentSha256: string;
  previewSha256: string;
  summary: GrantLedgerSummary;
  files: (GrantLedgerFileMetadata & { sourceId: string })[];
  records: GrantLedgerRecordedRow[];
  document: Omit<GrantLedgerDocument, 'files'> & { files: Omit<GrantLedgerFile, 'contentBase64'>[] };
}
export interface GrantLedgerOriginal {
  source: GrantObject;
  recorded: GrantLedgerRecorded;
  document: GrantLedgerDocument;
}
export interface GrantLedgerContract {
  schema: 'stellar-forge.sf47-ledger-intake.v1';
  case: GrantLedgerPreview['case'];
  limits: { files: number; sourceBytes: number; sourceRows: number; records: number };
  fields: Record<GrantLedgerKind, string[]>;
  templates: Record<GrantLedgerKind, Record<'csv' | 'tsv', string>>;
  intakes: GrantLedgerHistoryEntry[];
}

export interface GrantPerformanceSelection {
  caseId: string;
  startDate?: GrantCivilDate | null;
  endDate?: GrantCivilDate;
  expectedVersion?: number;
}
export interface GrantPerformancePeriod {
  startDate: GrantCivilDate | null;
  endDate: GrantCivilDate;
  workRecognition: 'COMPLETION_DATE';
  recordStateBasis: 'SELECTED_CASE_VERSION';
}
export interface GrantPerformanceAmounts {
  inUsd: string;
  outUsd: string;
  netUsd: string;
  grantReceiptsUsd: string;
  customerReceiptsUsd: string;
  invoicedUsd: string;
  paidUsd: string;
  openUsd: string;
  creditUsd: string;
}
export interface GrantPerformanceReceived extends GrantPerformancePeriod {
  reportSha256: string;
  sourceCaseId: string;
  sourceCaseVersion: number;
}
export interface GrantPerformanceReport extends GrantObject {
  schema: 'stellar-forge.sf47-performance.v1';
  selection: GrantPerformancePeriod;
  case: { id: string; name: string; version: number; state: string; mode: 'OPERATIONS' | 'WALKTHROUGH' };
  plan: { id: string; revision: number; name: string; contentSha256: string; sourceSha256: string; budgetUsd: string; plannedHours: string };
  finances: Record<'opening' | 'period' | 'closing', GrantPerformanceAmounts>;
  work: Record<'opening' | 'period' | 'closing', { recordedHours: string; acceptedHours: string; preawardHours: string }>;
  packages: GrantObject[];
  categories: GrantObject[];
  contributors: GrantObject[];
  invoices: GrantObject[];
  cash: GrantObject[];
  workRecords: GrantObject[];
  aging: { bucket: string; count: number; amountUsd: string }[];
  assets: GrantObject[];
  days: GrantObject[];
  sources: GrantObject[];
  recordsSha256: string;
  reportSha256: string;
  basis: string[];
}
export interface GrantPerformanceDownloadSelection extends GrantPerformanceSelection {
  endDate: GrantCivilDate;
  expectedVersion: number;
  expectedReportSha256: string;
}

export interface GrantSupplierAccountSelection extends GrantPerformanceSelection {
  contributorId?: string | null;
}
export interface GrantSupplierAccountPeriod extends GrantPerformancePeriod {
  contributorId: string | null;
}
export interface GrantSupplierAccountAmounts {
  invoicedUsd: string;
  paidUsd: string;
  openUsd: string;
  creditUsd: string;
  balanceUsd: string;
}
export interface GrantSupplierSummary {
  id: string; name: string; kind: string; contact: string; state: string;
  opening: GrantSupplierAccountAmounts;
  period: GrantSupplierAccountAmounts;
  closing: GrantSupplierAccountAmounts;
  work: { recordedHours: string; acceptedHours: string; preawardHours: string };
  workWithoutInvoiceLink: number;
  invoiceCount: number;
  disputedInvoices: number;
}
export interface GrantSupplierInvoiceLine {
  id: string; costId: string | null; description: string; amountUsd: string; workIds: string[];
}
export interface GrantSupplierInvoice extends GrantObject {
  id: string; contributorId: string; number: string; state: string;
  issuedDate: GrantCivilDate; dueDate: GrantCivilDate | null;
  totalUsd: string; lines: GrantSupplierInvoiceLine[];
  openingInvoicedUsd: string; periodInvoicedUsd: string; closingInvoicedUsd: string;
  openingPaidUsd: string; periodPaidUsd: string; closingPaidUsd: string;
  openUsd: string; creditUsd: string; balanceUsd: string;
  overdueDays: number; aging: string; future: boolean; inPeriod: boolean;
  sourceIds: string[]; sourceNote: string;
}
export interface GrantSupplierCashAllocation {
  invoiceId: string; amountUsd: string; invoiceNumber: string; invoiceState: string;
  contributorId: string; contributor: string; onSelectedAccount: boolean;
}
export interface GrantSupplierCash extends GrantObject {
  id: string; date: GrantCivilDate; state: string; direction: 'IN' | 'OUT'; category: string;
  amount: string; currency: string; network: string; asset: string;
  usdValue: string | null; externalRef: string; allocations: GrantSupplierCashAllocation[];
  accountAllocatedUsd: string; signedAccountPaidUsd: string; recognizedAccountPaidUsd: string;
  otherAllocatedUsd: string; unallocatedUsd: string | null;
  inPeriod: boolean; future: boolean; includedInUsd: boolean;
  usdBasis: 'VOID' | 'TESTNET' | 'UNVALUED' | 'RECORDED_USD';
  sourceIds: string[]; valuationSourceIds: string[]; sourceNote: string;
}
export interface GrantSupplierWork extends GrantObject {
  id: string; contributorId: string; description: string; state: string;
  startDate: GrantCivilDate; endDate: GrantCivilDate; hours: string; costId: string | null;
  fundingBasis: string; inPeriod: boolean; future: boolean; withoutInvoiceLink: boolean;
  invoiceLinks: { invoiceId: string; number: string; state: string; issuedDate: GrantCivilDate; lineId: string; description: string; amountUsd: string }[];
  sourceIds: string[]; sourceNote: string;
}
export interface GrantSupplierActivity {
  date: GrantCivilDate; kind: 'INVOICE' | 'PAYMENT' | 'REFUND'; recordId: string; label: string;
  invoicedUsd: string; paidUsd: string; balanceChangeUsd: string; runningBalanceUsd: string; sourceIds: string[];
}
export interface GrantSupplierAccountReport extends GrantObject {
  schema: 'stellar-forge.sf47-supplier-account.v1';
  selection: GrantSupplierAccountPeriod;
  case: GrantPerformanceReport['case'];
  plan: { id: string; revision: number; name: string; contentSha256: string };
  account: GrantObject | null;
  accounts: GrantSupplierSummary[];
  balances: Record<'opening' | 'period' | 'closing', GrantSupplierAccountAmounts>;
  workTotals: GrantPerformanceReport['work'];
  invoices: GrantSupplierInvoice[];
  work: GrantSupplierWork[];
  cash: GrantSupplierCash[];
  activity: GrantSupplierActivity[];
  aging: { bucket: string; count: number; amountUsd: string }[];
  sources: GrantObject[];
  attention: Record<'receivedInvoiceIds' | 'disputedInvoiceIds' | 'overdueInvoiceIds' | 'creditInvoiceIds' | 'workWithoutInvoiceLinkIds' | 'excludedCashIds', string[]>;
  recordsSha256: string; reportSha256: string; basis: string[];
}
export interface GrantSupplierAccountReceived extends GrantSupplierAccountPeriod {
  reportSha256: string; sourceCaseId: string; sourceCaseVersion: number;
}
export interface GrantSupplierAccountDownloadSelection extends GrantSupplierAccountSelection {
  endDate: GrantCivilDate; expectedVersion: number; expectedReportSha256: string;
}

export interface GrantAccountReconciliationCase {
  id: string; name: string; mode: 'OPERATIONS' | 'WALKTHROUGH'; state: 'OPEN' | 'CLOSED'; version: number; planId: string;
}
export interface GrantAccountReconciliationSelection {
  caseId: string; reconciliationId?: string | null; revision?: number | null; expectedVersion?: number;
}
export interface GrantAccountReconciliationPeriod {
  statementSourceId: string; reviewSourceId: string; accountId: string;
  network: string; currency: string; asset: string; startDate: GrantCivilDate; endDate: GrantCivilDate;
}
export interface GrantAccountReconciliationDocument {
  name: string; statementSourceId: string; periodStart: GrantCivilDate; periodEnd: GrantCivilDate;
  links: {rowNumbers: number[]; cashIds: string[]; reason: string}[];
  exclusions: {rowNumber: number; reason: string}[];
  outstanding: {cashId: string; reason: string; expectedClearDate: GrantCivilDate | null; sourceIds: string[]}[];
  note: string;
}
export interface GrantAccountReconciliationInput {
  expectedVersion: number; reconciliationId: string | null; expectedRevision: number;
  state: 'DRAFT' | 'CLOSED'; document: GrantAccountReconciliationDocument;
}
export interface GrantAccountReconciliationApplyInput extends GrantAccountReconciliationInput {
  expectedPreviewSha256: string; actor: string; requestId: string;
}
export type GrantAccountReconciliationRowStatus =
  'MATCHED' | 'CORRECTED' | 'LINKED' | 'SOURCE_ONLY' | 'CHANGED' | 'EXCLUDED' | 'ACKNOWLEDGED';
export interface GrantAccountReconciliationSourceRow {
  rowNumber: number; original: Record<string,string>; date: GrantCivilDate | null;
  reference: string; description: string; direction: string | null; amount: string | null;
  signedAmount: string | null; currency: string; usdValue: string | null;
  intakeStatus: string; intakeAction: string; intakeReason: string; originalCashId: string | null;
  status: GrantAccountReconciliationRowStatus; cashIds: string[]; correctionSourceIds: string[];
  matchGroupId: string | null; reason: string; problems: string[]; insidePeriod: boolean;
}
export interface GrantAccountReconciliationCash extends GrantCashObservation {
  signedAmount: string; eligible: boolean;
  status: 'MATCHED' | 'LINKED' | 'OUTSTANDING' | 'LEDGER_ONLY' | 'EXCLUDED_VOID' | 'EXCLUDED_TESTNET' | 'OUTSIDE_PERIOD' | 'OTHER_ACCOUNT';
  sourceRowNumbers: number[]; matchGroupId: string | null; reason: string;
  expectedClearDate: GrantCivilDate | null; selectedCashIds: string[]; correctionSourceIds: string[];
  outstandingSourceIds?: string[];
}
export interface GrantAccountReconciliationMatch {
  id: string; kind: string; rowNumbers: number[]; cashIds: string[]; selectedCashIds: string[];
  sourceNet: string | null; ledgerNet: string | null; difference: string | null;
  reason: string; correctionSourceIds: string[]; status: 'MATCHED' | 'CONFLICT';
}
export interface GrantAccountReconciliationTotals {
  statement: {openingBalance: string | null; closingBalance: string | null; inflow: string; outflow: string;
    net: string; calculatedClosing: string | null; difference: string | null; balanceStatus: string};
  ledger: {inflow: string; outflow: string; net: string; count: number; matchedInflow: string;
    matchedOutflow: string; matchedNet: string; matchedCount: number};
  outstanding: {inflow: string; outflow: string; net: string; count: number};
  reconciliation: {sourceAnchoredLedgerClosing: string | null; sourceDifference: string | null;
    clearedLedgerNet: string; sourceAnchoredClearedClosing: string | null; remainingDifference: string | null;
    absoluteLedgerOpening: null};
}
export interface GrantAccountReconciliationPreview {
  schema: 'stellar-forge.sf47-account-reconciliation.v1.preview';
  case: GrantAccountReconciliationCase; expectedVersion: number; reconciliationId: string | null;
  expectedRevision: number; requestedState: 'DRAFT' | 'CLOSED'; document: GrantAccountReconciliationDocument;
  selection: GrantAccountReconciliationPeriod;
  statement: {source: GrantObject; reviewSource: GrantObject; accountId: string; accountLabel: string;
    currency: string; network: string; asset: string; headers: string[]; originalBalance: GrantObject;
    originalSummary: GrantObject; editionSha256: string};
  sourceRows: GrantAccountReconciliationSourceRow[]; transactions: GrantAccountReconciliationCash[];
  matches: GrantAccountReconciliationMatch[]; totals: GrantAccountReconciliationTotals;
  counts: Record<'sourceRows' | 'matchedSourceRows' | 'excludedSourceRows' | 'acknowledgedSourceRows' |
    'sourceOnlyRows' | 'changedRows' | 'ledgerRows' | 'matchedLedgerRows' | 'ledgerOnlyRows' |
    'outstandingRows' | 'excludedLedgerRows',number>;
  findings: {code: string; severity: string; message: string; rowNumbers: number[]; cashIds: string[]}[];
  basis: GrantObject; cashBasisSha256: string; inputSha256: string;
  canSave: boolean; canClose: boolean; canApply: boolean; previewSha256: string;
}
export interface GrantAccountReconciliationEdition {
  schema: 'stellar-forge.sf47-account-reconciliation.v1.edition'; id: string; revision: number;
  parentSourceId: string | null; parentSourceSha256: string | null; caseId: string;
  fromVersion: number; version: number; state: 'DRAFT' | 'CLOSED';
  document: GrantAccountReconciliationDocument; preview: GrantAccountReconciliationPreview;
  requestId: string; recordedAt: string; recordedBy: string;
}
export interface GrantAccountReconciliationSummary {
  id: string; name: string; revision: number; state: 'DRAFT' | 'CLOSED'; version: number; fromVersion: number;
  sourceId: string; sourceSha256: string; statementSourceId: string; accountId: string; currency: string;
  periodStart: GrantCivilDate; periodEnd: GrantCivilDate; recordedAt: string; recordedBy: string;
  requestId: string; previewSha256: string; remainingDifference: string | null; unresolvedRows: number;
}
export interface GrantAccountReconciliationStatement {
  sourceId: string; reviewSourceId: string; accountId: string; accountLabel: string; currency: string;
  network: string; asset: string; source: GrantObject; reviewSource: GrantObject; sourceSha256: string;
  editionSha256: string; observedAt: string; firstDate: GrantCivilDate | null; lastDate: GrantCivilDate | null;
  rows: number; excludedRows: number; openingBalance: string | null; closingBalance: string | null;
  balanceStatus: string; retainedAtVersion: number;
}
export interface GrantAccountReconciliationReport {
  schema: 'stellar-forge.sf47-account-reconciliation.v1'; case: GrantAccountReconciliationCase;
  statements: GrantAccountReconciliationStatement[]; reconciliations: GrantAccountReconciliationSummary[];
  selection: {reconciliationId: string | null; revision: number | null};
  selected: {source: GrantObject; record: GrantAccountReconciliationEdition} | null;
  current: GrantAccountReconciliationPreview | null;
  history: {source: GrantObject; record: GrantAccountReconciliationEdition}[];
  comparison: {changed: boolean; cashChanged: boolean; savedCaseVersion: number; currentCaseVersion: number;
    addedCashIds: string[]; removedCashIds: string[]; changedCashIds: string[]; sourceRowsChanged: number[];
    savedSourceDifference: string | null; currentSourceDifference: string | null;
    savedRemainingDifference: string | null; currentRemainingDifference: string | null;
    savedCanClose: boolean; currentCanClose: boolean} | null;
  reportSha256: string;
}
export interface GrantAccountReconciliationReceipt {
  id: string; version: number; action: 'account-reconciliation.save'; reconciliationId: string;
  revision: number; state: 'DRAFT' | 'CLOSED'; sourceId: string; sourceSha256: string;
  requestId: string; previewSha256: string; selection: {reconciliationId: string; revision: number};
}
export interface GrantAccountReconciliationReceived {
  reconciliationId: string | null; revision: number | null; sourceCaseId: string;
  sourceCaseVersion: number; reportSha256: string;
}
export interface GrantAccountReconciliationStatementInputs {
  caseId: string; expectedVersion: number; statementSourceId: string; reviewSourceId: string;
  inputs: GrantStatementInput;
}
export interface GrantAccountReconciliationDownloadSelection extends GrantAccountReconciliationSelection {
  expectedVersion: number; expectedReportSha256: string;
}

export interface GrantCashAccountSelection extends GrantPerformanceSelection {
  network?: string | null; currency?: string | null; asset?: string | null;
}
export interface GrantCashAccountPeriod {
  startDate: GrantCivilDate | null; endDate: GrantCivilDate;
  network: string | null; currency: string | null; asset: string | null;
  recordStateBasis: 'SELECTED_CASE_VERSION';
}
export type GrantCashAmounts = Pick<GrantPerformanceAmounts,
  'inUsd' | 'outUsd' | 'netUsd' | 'grantReceiptsUsd' | 'customerReceiptsUsd' | 'paidUsd'>;
export interface GrantCashReplacement {
  date: GrantCivilDate; direction: 'IN' | 'OUT'; category: string; currency: string; network: string; asset: string;
  amount: string; usdValue: string | null; externalRef: string; tranche: number | null;
  allocations: {invoiceId: string; amountUsd: string}[];
  sourceIds: string[]; sourceNote: string; valuationSourceIds: string[]; valuationNote: string;
}
export interface GrantCashObservation extends GrantCashReplacement, GrantObject {
  id: string; state: 'OBSERVED' | 'VOID';
}
export interface GrantCashAccountTransaction extends GrantCashObservation {
  inPeriod: boolean; includedInUsd: boolean; usdBasis: string;
  allocatedUsd: string; unallocatedUsd: string | null;
  allocations: {invoiceId: string; amountUsd: string; invoiceNumber: string;
    contributorId: string; contributorName: string; sourceIds: string[]}[];
  origins: GrantObject[]; predecessors: GrantObject[]; successors: GrantObject[];
}
export interface GrantCashForecastContinuation extends GrantObject {
  forecastId: string; name: string; expectedVersion: number; originalSha256: string;
  status: 'READY' | 'REVIEW'; message?: string; inputs: GrantObject;
  originalCashIds: string[]; replacementCashIds: string[]; sourceCorrectionIds: string[];
  report?: GrantObject;
}
export interface GrantCashDependencies extends GrantObject {
  completion: {clocks: GrantObject[]; extensions: GrantObject[]; outcomes: GrantObject[]; reviews: GrantObject[]};
  forecasts: {id: string; name: string; version: number; createdAt: string;
    source: GrantObject; sha256: string; references: {path: (string | number)[]; cashId: string}[]; inputs: GrantObject}[];
  replacementCompletion?: GrantObject[];
}
export interface GrantCashCorrectionRecord extends GrantObject {
  schema: 'stellar-forge.sf47-cash-correction.v1';
  caseId: string; fromVersion: number; voidVersion: number; recordVersion: number; version: number;
  originalCashId: string; replacementCashId: string;
  originalSha256: string; replacementSha256: string;
  original: GrantCashObservation; voided: GrantCashObservation; replacement: GrantCashObservation;
  attachments: GrantObject[]; reason: string; selection: GrantCashAccountPeriod;
  previewSha256: string; inputSha256: string; requestId: string; actor: string; recordedAt: string;
}
export interface GrantCashAccountReport extends GrantObject {
  schema: 'stellar-forge.sf47-cash-account.v1';
  case: GrantPerformanceReport['case']; plan: GrantObject; selection: GrantCashAccountPeriod;
  accounts: GrantObject[];
  finances: Record<'opening' | 'period' | 'closing', GrantCashAmounts>;
  caseFinances: Record<'opening' | 'period' | 'closing', GrantPerformanceAmounts>;
  assets: GrantObject[]; transactions: GrantCashAccountTransaction[];
  invoices: GrantObject[]; suppliers: GrantObject[]; sources: GrantObject[]; history: GrantObject[];
  corrections: {source: GrantObject; record: GrantCashCorrectionRecord}[];
  dependencies: GrantCashDependencies; forecastContinuations: GrantCashForecastContinuation[];
  basis: string[]; reportSha256: string;
}
export interface GrantCashCorrectionInput {
  expectedVersion: number; originalCashId: string; replacement: GrantCashReplacement; reason: string;
  selection?: Partial<GrantCashAccountPeriod>; attachments?: GrantObject[];
}
export interface GrantCashCorrectionPreview extends GrantObject {
  schema: 'stellar-forge.sf47-cash-correction.v1.preview';
  case: GrantPerformanceReport['case']; selection: GrantCashAccountPeriod;
  original: GrantCashObservation; replacement: GrantCashReplacement;
  changes: {field: string; before: unknown; after: unknown}[]; attachments: GrantObject[];
  impact: {before: GrantObject; after: GrantObject; deltas: GrantObject;
    invoices: GrantObject[]; packages: GrantObject[]; assets: GrantObject[]};
  dependencies: GrantCashDependencies; findings: GrantObject[]; canApply: boolean; previewSha256: string;
}
export interface GrantCashCorrectionApplyInput extends GrantCashCorrectionInput {
  expectedPreviewSha256: string; actor: string; requestId: string;
}
export interface GrantCashCorrectionReceipt extends GrantObject {
  id: string; version: number; action: 'cash.correction'; requestId: string;
  originalCashId: string; replacementCashId: string; sourceId: string; previewSha256: string;
  forecastContinuations: GrantCashForecastContinuation[]; completion: GrantCashDependencies['completion'];
}
export interface GrantCashAccountReceived extends GrantCashAccountPeriod {
  reportSha256: string; sourceCaseId: string; sourceCaseVersion: number;
}
export interface GrantCashAccountDownloadSelection extends GrantCashAccountSelection {
  endDate: GrantCivilDate; expectedVersion: number; expectedReportSha256: string;
}

export interface GrantDeliveryQueueSelection { caseId: string; asOfDate?: GrantCivilDate; }
export interface GrantInstallationSelection {
  expectedVersion: number;
  installationId: string | null;
  expectedRevision: number;
}
export interface GrantInstallationReviewRef { id: string; sha256: string; }
export interface GrantInstallationEffortSeedInput extends GrantInstallationSelection {
  installationId: string;
  asOfDate: GrantCivilDate;
  document?: GrantInstallationDocument;
}
export interface GrantInstallationEffortSelectionInput {
  expectedVersion: number;
  forecastId: string;
  installationSelections: GrantPortfolioInstallationSelection[];
  name?: string;
  note?: string;
}
export interface GrantInstallationEffortSelection extends GrantObject {
  source: GrantObject;
  inputs: GrantObject;
  selection: GrantInstallationEffortPlanningSelection;
}
export interface GrantInstallationEffortSeed extends GrantInstallationSeed {
  schema: 'stellar-forge.sf47-installation-effort.v1';
  installationId: string;
  expectedRevision: number;
  document: GrantInstallationDocument & { effort: GrantInstallationEffortDocument };
  phaseSource: GrantInstallationEffortPhaseSource;
  workInventory: GrantInstallationEffortWorkInventory[];
  report: GrantInstallationReport & {effort: GrantInstallationEffortReport};
  previewSha256: string;
}
export interface GrantInstallationPreviewInput extends GrantInstallationSelection {
  document: GrantInstallationDocument;
  returnReview?: GrantInstallationReviewRef;
}
export interface GrantOperationRequest {
  expectedVersion: number;
  requestId: string;
  actor: string;
  note?: string;
}
export interface GrantInstallationSaveInput extends GrantInstallationPreviewInput, GrantOperationRequest {
  note: string;
  expectedPreviewSha256: string;
}
export interface GrantInstallationPreview {
  schema: 'stellar-forge.sf47-installation.v1';
  returnReview?: GrantInstallationReviewRef;
  installationId: string | null;
  expectedRevision: number;
  source: GrantObject;
  document: GrantInstallationDocument;
  snapshot: GrantObject;
  report: GrantInstallationReport;
  previous: GrantInstallationRef | null;
  changes: GrantObject[];
  previewSha256: string;
}
export interface GrantInstallationEdition extends GrantInstallationRef {
  version: number;
  createdAt: string;
  actor: string;
  note: string;
  preview: GrantInstallationPreview;
  current: { available: boolean; selectedRecordsChanged: boolean; caseVersion: number };
}
export interface GrantInstallationSeed extends GrantObject {
  document: GrantInstallationDocument;
  source: GrantObject;
}
export interface GrantInstallationSaveReceipt extends GrantObject {
  id: string;
  version: number;
  action: 'installation.save';
  kind: 'installation';
  recordId: string;
  revision: number;
  sha256: string;
}

/** Original named observations against one immutable Installation edition. */
export interface GrantInstallationReturnInput {
  installationId: string;
  revision: number;
  sha256: string;
  name: string;
  recipient: string;
  environment: string;
  note: string;
  observations: Array<Pick<GrantInstallationCheck, 'id' | 'state' | 'operator' | 'observedAt' | 'note' |
    'sourceIds' | 'workIds' | 'purchaseIds' | 'outcomeIds'>>;
}
export interface GrantInstallationReturnOwnerInput {
  retainedReview?: GrantInstallationReviewRef;
  returnedCaseId: string;
  reviewId: string;
  reviewSha256: string;
  installationId: string;
  expectedRevision: number;
  name: string;
  note: string;
  choices: Array<{id: string; action: 'KEEP' | 'APPLY'; note: string}>;
}
export interface GrantInstallationReturnSummary {
  id: string; version: number; purpose: 'INSTALLATION_RETURN' | 'INSTALLATION_RETURN_REVIEW';
  businessSha256: string; sha256: string; previewSha256: string;
  installationId: string; revision: number; name: string; createdAt: string; actor: string;
}
export interface GrantInstallationReturnSeed {
  schema: 'stellar-forge.sf47-installation-return.v1.seed';
  source: GrantObject; baseline: GrantInstallationRef; inputs: GrantInstallationReturnInput;
  checks: Array<Pick<GrantInstallationCheck, 'id' | 'title' | 'criterion' | 'tranche' | 'required'>>;
}
export interface GrantInstallationReturnPreview {
  schema: 'stellar-forge.sf47-installation-return.v1';
  source: GrantObject; inputs: GrantInstallationReturnInput;
  baseline: Omit<GrantInstallationEdition,'current'>;
  document: GrantInstallationDocument; snapshot: GrantObject; report: GrantObject;
  receivingBasisChanges: GrantObject[]; basisUnchanged: boolean; previewSha256: string;
}
export interface GrantInstallationReturnOwnerPreview {
  schema: 'stellar-forge.sf47-installation-return.v1.owner-preview';
  source: GrantObject; inputs: GrantInstallationReturnOwnerInput;
  baseline: Omit<GrantInstallationEdition,'current'>; currentInstallation: Omit<GrantInstallationEdition,'current'>;
  returnedProof: GrantObject; basisChanges: GrantObject[]; receivingBasisChanges: GrantObject[];
  checks: Array<{id: string; title: string; eligible: boolean; definitionChanges: GrantObject[];
    ownerObservation: GrantInstallationCheck | null; returnedObservation: GrantInstallationCheck;
    decision: {id: string; action:'KEEP'|'APPLY'; note:string};
    recordLinks: Record<'workIds'|'purchaseIds'|'outcomeIds', {sameOwnerRecordIds:string[];retainedAsEvidenceIds:string[]}>}>;
  newOwnerChecks: GrantInstallationCheck[]; sources: GrantObject[]; appliedChecks: number; previewSha256: string;
}
export interface GrantInstallationReturnOwnerSeed {
  schema: 'stellar-forge.sf47-installation-return.v1.owner-seed';
  source: GrantObject;
  retainedReview: GrantInstallationReviewRef;
  returned: GrantObject;
  inputs: GrantInstallationReturnOwnerInput;
  previousChoices: GrantInstallationReturnOwnerInput['choices'];
  application: {
    schema: 'stellar-forge.sf47-installation-return.v1.stage-state';
    returnReview: GrantInstallationReviewRef;
    source: GrantObject;
    stagedInstallation: GrantInstallationRef;
    currentInstallation: GrantInstallationRef | null;
    sameInstallationEdition: boolean;
    installationChanges: GrantObject[];
    selectedBasisChanges: GrantObject[];
    documentChanges: GrantObject[];
    unavailable: string | null;
    canSave: boolean;
  };
  savedInstallations: Array<GrantInstallationRef & {version: number}>;
}
export interface GrantInstallationReturnReceipt {
  id: string; version: number; action: 'installation.return'; kind: 'review'; recordId: string;
  reviewSha256: string; previewSha256: string; unchanged: false;
}
export interface GrantInstallationReturnStageReceipt extends Omit<GrantInstallationReturnReceipt, 'action'> {
  action: 'installation.return-stage';
  installationId: string; expectedRevision: number; document: GrantInstallationDocument;
}
export type GrantInstallationReturnSave<T> = GrantOperationRequest & {note:string; inputs:T; expectedPreviewSha256:string};

export interface GrantCaseView extends GrantObject {
  statementSetups: GrantStatementSetupSummary[];
  workIntakes: GrantWorkIntakeSummary[];
  workIntakeRefs?: {id: string; revision: number; sha256: string; state: 'DRAFT' | 'APPLIED'}[];
  program: { id: string; name: string; version: number; state: string; [key: string]: unknown };
}
export interface GrantCaseImportReceipt extends GrantObject {
  id: string;
  version: number;
  action: 'import';
  planId: string;
  mode: 'OPERATIONS' | 'WALKTHROUGH';
  /** Present when the imported file is a complete dated delivery queue handover. */
  deliveryQueue?: { asOfDate: GrantCivilDate; sha256: string };
  performance?: GrantPerformanceReceived;
  supplierAccount?: GrantSupplierAccountReceived;
  cashAccount?: GrantCashAccountReceived;
  accountReconciliation?: GrantAccountReconciliationReceived;
  selectedInstallation?: GrantInstallationRef;
  selectedInstallationReturn?: GrantInstallationReturnSummary;
  /** Exact selected allocation edition carried by a complete cost-funding handover. */
  selectedFunding?: GrantFundingLink & {reportSha256: string; period: GrantFundingPeriod};
}
/** Original accepted customer quotation, its complete source and task identities. */
export interface GrantCommercialInstallationBinding {
  schema: 'stellar-forge.sf47-commercial-installation.v1';
  sourceId: string;
  sourceSha256: string;
  caseKey: string;
  quoteId: string;
  quoteSha256: string;
  acceptanceId: string;
  acceptanceSha256: string;
  scopeSha256: string;
  taskChecks: {taskId: string; checkId: string; definitionSha256: string}[];
  sourceFiles: {name: string; sha256: string; bytes: number; sourceId: string}[];
}
export interface GrantCommercialSourceSelection {
  expectedVersion: number;
  sourceId: string;
  expectedSourceSha256: string;
}
export type GrantCommercialField = 'name' | 'task.name' | 'task.purpose' | 'task.request' |
  'task.completeOutput' | 'source.reference' | 'source.authority' | 'source.changePolicy' |
  'receiving.acceptanceRule' | 'assignments.commercialRef';
export interface GrantCommercialInstallationInput extends GrantCommercialSourceSelection, GrantInstallationSelection {
  quoteId: string;
  quoteSha256: string;
  acceptanceId: string;
  acceptanceSha256: string;
  document?: GrantInstallationDocument;
  resolutions?: Partial<Record<GrantCommercialField, 'accepted' | 'current'>>;
}
export interface GrantCommercialInstallationReview extends GrantInstallationSeed {
  schema: 'stellar-forge.sf47-commercial-installation.v1';
  installationId: string | null;
  expectedRevision: number;
  canApply: boolean;
  conflicts: {key: GrantCommercialField; base: string; current: string; accepted: string; resolution: 'accepted' | 'current' | null}[];
  resolutions: Partial<Record<GrantCommercialField, 'accepted' | 'current'>>;
  changes: {fields: GrantObject[]; added: GrantObject[]; changed: GrantObject[]; unchanged: GrantObject[]; removed: GrantObject[]};
  original: GrantObject;
  sourceChanges: GrantObject[];
  reviewSha256: string;
}
export interface GrantWorkshareSourceSelection {
  expectedVersion: number;
  sourceId: string;
  expectedSourceSha256: string;
  packetSourceId?: string | null;
  expectedPacketSha256?: string | null;
}
export interface GrantWorkflowSourceSelection {
  expectedVersion: number;
  sourceId: string;
  expectedSourceSha256: string;
}
export interface GrantModelSaveInput extends GrantOperationRequest {
  inputs: GrantObject;
  expectedPreviewSha256: string;
}
export interface GrantForecastSource extends GrantObject {
  programId: string;
  version: number;
  planId: string;
  planRevision: number;
  planContentSha256: string;
  planSourceSha256: string;
  businessSha256: string;
  factsSha256: string;
}
export interface GrantForecastPreview extends GrantObject {
  schema: 'stellar-forge.sf47-operating-forecast.v1';
  engineVersion: 1;
  source: GrantForecastSource;
  inputs: GrantObject;
  report: GrantObject;
  previewSha256: string;
}
export interface GrantSavedForecast extends GrantForecastPreview {
  id: string;
  createdAt: string;
  actor: string;
  note: string;
  snapshot: GrantObject;
  sha256: string;
  current?: GrantObject;
}
export type GrantPortfolioStatus = 'READY' | 'INCOMPLETE' | 'HORIZON_EXCEEDED';
/** Decimal strings preserve the original native allocation's precision. */
export type GrantPortfolioHours = string;
export type GrantWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export interface GrantPortfolioCalendar {
  startDate: GrantCivilDate;
  horizonDays: number;
  weekdays: GrantWeekday[];
  holidays: GrantCivilDate[];
  extraWorkingDates: GrantCivilDate[];
}
export interface GrantPortfolioResource {
  id: string;
  name: string;
  /** Monday through Sunday. null is unentered; "0" is unavailable. */
  hoursByWeekday: [GrantPortfolioHours | null, GrantPortfolioHours | null, GrantPortfolioHours | null, GrantPortfolioHours | null, GrantPortfolioHours | null, GrantPortfolioHours | null, GrantPortfolioHours | null];
  hoursByDate: Record<GrantCivilDate, GrantPortfolioHours>;
  note: string;
}
export interface GrantPortfolioTask {
  id: string;
  effortHours: Record<string, GrantPortfolioHours | null>;
  dependsOn: string[];
  releaseDate: GrantCivilDate | null;
  dueDate: GrantCivilDate | null;
  minBusinessDays: number;
  priority: number;
  note: string;
}
export interface GrantPortfolioInstallationRef {
  installationId: string;
  installationRevision: number;
  installationSha256: string;
}
export interface GrantPortfolioInstallationSelection extends GrantPortfolioInstallationRef {
  /** The existing commercial task ID from the saved Forecast. */
  taskId: string;
}
export interface GrantPortfolioInstallationPhase {
  phaseId: string;
  /** Explicit remaining work; acceptance observations never fill this value. */
  remainingHours: GrantPortfolioHours | null;
  effortHours: Record<string, GrantPortfolioHours | null>;
  /** Retains the original phase dependencies. */
  dependsOn: string[];
  releaseDate: GrantCivilDate | null;
  dueDate: GrantCivilDate | null;
  minBusinessDays: number;
  /** null inherits the aggregate task priority; every integer, including 100, is explicit. */
  priority: number | null;
  note: string;
}
export interface GrantPortfolioInstallationPlan extends GrantPortfolioInstallationSelection {
  /** Reviewed boundary phases and their ancestors define the commercial delivery window. */
  deliveryPhaseIds: string[];
  deliveryBoundaryNote: string;
  /** Every original phase remains present, including support after delivery. */
  phases: GrantPortfolioInstallationPhase[];
  note: string;
}
export interface GrantPortfolioInstallationSourceSelection extends GrantPortfolioInstallationRef {
  /** Original Workshare case ID. */
  caseId: string;
  planSha256: string;
  sourceId: string;
  sourceSha256: string;
  packetSourceId: string | null;
  packetSha256: string | null;
}
export interface GrantPortfolioInstallationSource {
  schema: 'stellar-forge.sf47-portfolio-installations.v1';
  selections: GrantPortfolioInstallationSourceSelection[];
  sha256: string;
}
export interface GrantPortfolioOriginalPhase {
  phaseId: string;
  title: string;
  quotedHours: GrantPortfolioHours;
  /** Complete original owner value, retained without coercing the source into text. */
  owner: unknown;
  dependsOn: string[];
  businessDays: number | null;
  terms: GrantObject;
  checkId: string;
  checkState: GrantCheckState;
  checkOperator: string;
  checkObservedAt: string | null;
  coordinationOwner: string;
  coordinationDueDate: GrantCivilDate | null;
  coordinationPriority: GrantDeliveryPriority;
}
export interface GrantPortfolioAvailableInstallation extends GrantPortfolioInstallationSourceSelection {
  name: string;
  stage: GrantInstallationStage;
  title: string;
  /** Complete original customer value from the selected Workshare plan. */
  customer: unknown;
  quotedHours: GrantPortfolioHours;
  commercial: GrantObject;
  schedule: GrantObject;
  workorder: GrantObject;
  matchingTaskIds: string[];
  phases: GrantPortfolioOriginalPhase[];
  unavailable?: never;
}
export interface GrantPortfolioUnavailableInstallation extends GrantPortfolioInstallationRef {
  name: string;
  stage: GrantInstallationStage;
  matchingTaskIds: [];
  phases: [];
  unavailable: { code: string; message: string };
}
export type GrantPortfolioInstallationCandidate =
  | GrantPortfolioAvailableInstallation
  | GrantPortfolioUnavailableInstallation;
export interface GrantPortfolioInstallationPhaseResult {
  phaseId: string;
  scheduleTaskId: string;
  title: string;
  quotedHours: GrantPortfolioHours;
  remainingHours: GrantPortfolioHours | null;
  owner: unknown;
  checkState: GrantCheckState;
  checkOperator: string;
  checkObservedAt: string | null;
  coordinationOwner: string;
  dependsOn: string[];
  deliveryScope: boolean;
  startDate: GrantCivilDate | null;
  finishDate: GrantCivilDate | null;
  dueDate: GrantCivilDate | null;
  effortHours: Record<string, GrantPortfolioHours | null>;
  /** Result field name; the editable input uses minBusinessDays. */
  minimumBusinessDays: number;
}
export interface GrantPortfolioInstallationPlanResult extends GrantPortfolioInstallationSelection {
  caseId: string;
  planSha256: string;
  quotedHours: GrantPortfolioHours;
  remainingHours: GrantPortfolioHours;
  deliveryPhaseIds: string[];
  deliveryBoundaryNote: string;
  deliveryPhaseClosure: string[];
  deliveryStartDate: GrantCivilDate | null;
  deliveryFinishDate: GrantCivilDate | null;
  allWorkFinishDate: GrantCivilDate | null;
  phases: GrantPortfolioInstallationPhaseResult[];
}
export interface GrantPortfolioSeedOptions {
  installationSelections?: GrantPortfolioInstallationSelection[];
  /** Complete editable draft. Seed changes base phase plans and preserves explicit alternative overrides. */
  inputs?: GrantPortfolioInputs;
}
export interface GrantPortfolioSaveReceipt extends GrantObject {
  id: string;
  version: number;
  action: 'portfolio.save';
  kind: 'portfolio';
  recordId: string;
}
export interface GrantForecastSaveReceipt extends GrantObject {
  id: string;
  version: number;
  action: 'forecast.save';
  kind: 'forecast';
  recordId: string;
}
export interface GrantPortfolioAlternative {
  id: string;
  name: string;
  note: string;
  /** An authored override replaces the complete field; omitted fields inherit the base. */
  calendar?: GrantPortfolioCalendar;
  resources?: GrantPortfolioResource[];
  tasks?: GrantPortfolioTask[];
  /** Complete replacement; [] uses aggregate tasks. Seed preserves this authored override. */
  installationPlans?: GrantPortfolioInstallationPlan[];
}
export interface GrantPortfolioInputs extends GrantObject {
  schema: 'stellar-forge.sf47-portfolio.v1';
  name: string;
  forecastId: string;
  forecastSha256: string;
  calendar: GrantPortfolioCalendar;
  resources: GrantPortfolioResource[];
  tasks: GrantPortfolioTask[];
  installationPlans?: GrantPortfolioInstallationPlan[];
  alternatives: GrantPortfolioAlternative[];
  note: string;
}
export interface GrantPortfolioForecastRef {
  id: string;
  sha256: string;
  previewSha256: string;
  source: GrantForecastSource;
}
export interface GrantPortfolioSourceTask extends GrantObject {
  id: string;
  sourceKind: string;
  sourceId: string;
  title: string;
  remainingHours: GrantPortfolioHours;
  startDate: GrantCivilDate | null;
  endDate: GrantCivilDate | null;
  tranche: number | null;
  remainingCostUsd: string | null;
  scope: string;
  sourceIds: string[];
  timing?: GrantObject;
  nativePricing?: GrantObject;
  nativeReceipts?: GrantObject[];
  currencyValuation?: GrantObject;
}
export interface GrantPortfolioSeed extends GrantObject {
  inputs: GrantPortfolioInputs;
  baseForecast: GrantPortfolioForecastRef;
  sourceTasks: GrantPortfolioSourceTask[];
  originalCapacity: GrantObject;
  originalAssignments: GrantObject[];
  installationCandidates?: GrantPortfolioInstallationCandidate[];
  installationSource?: GrantPortfolioInstallationSource;
}
export interface GrantPortfolioFinding {
  code: string;
  field: string;
  message: string;
}
export interface GrantPortfolioChosenDates extends GrantObject {
  taskId: string;
  sourceKind: string;
  sourceId: string;
  oldStartDate: GrantCivilDate | null;
  oldEndDate: GrantCivilDate | null;
  startDate: GrantCivilDate;
  endDate: GrantCivilDate;
  startShiftDays: number | null;
  endShiftDays: number | null;
}
export interface GrantPortfolioAlternativeSummary extends GrantObject {
  phaseLateTasks?: number;
  sourceTasks?: number;
}
export interface GrantPortfolioAlternativeResult extends GrantObject {
  id: string;
  name: string;
  note: string;
  status: GrantPortfolioStatus;
  findings: GrantPortfolioFinding[];
  summary: GrantPortfolioAlternativeSummary | null;
  schedule: GrantObject | null;
  chosenDates: GrantPortfolioChosenDates[];
  forecast: { inputs: GrantObject; previewSha256: string; report: GrantObject } | null;
  installationPlans?: GrantPortfolioInstallationPlanResult[];
}
export interface GrantPortfolioReport extends GrantObject {
  sourceTasks: GrantPortfolioSourceTask[];
  baseline: GrantObject;
  alternatives: GrantPortfolioAlternativeResult[];
  comparison: GrantObject[];
  comparisonBasis: string;
  paymentTimingBasis: string;
  installationCandidates?: GrantPortfolioAvailableInstallation[];
}
export interface GrantPortfolioPreview extends GrantObject {
  schema: 'stellar-forge.sf47-portfolio.v1';
  engineVersion: 1;
  source: GrantForecastSource;
  baseForecast: GrantPortfolioForecastRef;
  inputs: GrantPortfolioInputs;
  report: GrantPortfolioReport;
  installationSource?: GrantPortfolioInstallationSource;
  previewSha256: string;
}
export interface GrantPortfolioCurrentSource extends GrantObject {
  programId: string;
  version: number;
  sourceChanged: boolean;
  retainedOriginalProgramId: string;
  installationSourceChanged?: boolean;
}
export interface GrantSavedPortfolio extends GrantPortfolioPreview {
  id: string;
  version: number;
  createdAt: string;
  actor: string;
  note: string;
  snapshot: GrantObject;
  baseForecastSnapshot: GrantObject;
  sha256: string;
  current?: GrantPortfolioCurrentSource;
}
export interface GrantPortfolioSelection extends GrantObject {
  inputs: GrantObject;
  selection: {
    portfolioId: string;
    portfolioSha256: string;
    alternativeId: string;
    baseForecast: GrantPortfolioForecastRef;
    source: GrantForecastSource;
    previewSha256: string;
    chosenDates: GrantPortfolioChosenDates[];
    installationSource?: GrantPortfolioInstallationSource;
    installationPlans?: GrantPortfolioInstallationPlanResult[];
  };
}

/** Two explicit retained revisions; omit toPlanId to compare within the same plan. */
export interface GrantForecastComparisonSelection {
  caseId: string;
  beforeId: string;
  afterId: string;
  expectedComparisonSha256?: string;
}
export interface GrantForecastComparisonExportSelection extends GrantForecastComparisonSelection {
  expectedComparisonSha256: string;
}
export interface GrantForecastComparisonIdentity {
  id: string; name: string; createdAt: string; actor: string; note: string;
  sha256: string; previewSha256: string; reportSha256: string; engineVersion: number;
  asOfDate: GrantCivilDate; calendarStart: GrantCivilDate; source: GrantForecastSource;
}
export interface GrantForecastComparison {
  schema: 'stellar-forge.sf47.forecast-comparison.v1';
  comparisonSha256: string;
  case: {id: string; createdAt: string};
  before: GrantForecastComparisonIdentity; after: GrantForecastComparisonIdentity;
  basis: {delta: 'after - before'; reportBasis: string; dailyBasis: string; cashBasis: string; scopeBasis: string;
    sameAsOfDate: boolean; sameCalendarStart: boolean; sameOpeningCash: boolean; sameSelectedCustomers: boolean;
    sameOriginalCase: boolean; samePlanContent: boolean; samePlanSource: boolean; sameSourceFacts: boolean; sameEngine: boolean};
  notices: {code: string; message: string}[];
  summary: {assumptionChanges: number; sourceChanges: number; daysBefore: number; daysAfter: number;
    overlapDays: number; groupChanges: Record<string, number>};
  metrics: GrantPlanComparisonMetric[];
  groups: Record<string, GrantPlanComparisonRow[]>;
  sourceGroups: Record<string, GrantPlanComparisonRow[]>;
  changes: (GrantPlanComparisonChange & {area: 'assumptions' | 'source'})[];
  days: {date: GrantCivilDate; before: GrantObject | null; after: GrantObject | null; delta: Record<string, string | null>}[];
  work: {date: GrantCivilDate; projectId: string; before: GrantObject | null; after: GrantObject | null; deltaHours: string | null}[];
  coverage: {before: GrantObject; after: GrantObject};
  snapshots: {before: GrantSavedForecast; after: GrantSavedForecast};
}

export interface GrantPlanComparisonSelection {
  planId: string;
  fromRevision: number;
  toRevision: number;
  toPlanId?: string;
  expectedComparisonSha256?: string;
}
export interface GrantPlanComparisonExportSelection extends GrantPlanComparisonSelection {
  expectedComparisonSha256: string;
}
export interface GrantPlanComparisonIdentity {
  id: string;
  name: string;
  revision: number;
  savedAt: string;
  note: string;
  contentSha256: string;
  reportSha256: string;
  calculatorSha256: string | null;
  source: GrantObject & { sha256: string; filename: string; url: string };
}
export interface GrantPlanComparisonChange {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  beforePresent: boolean;
  afterPresent: boolean;
  before: unknown;
  after: unknown;
}
export interface GrantPlanComparisonRow {
  id: string;
  state: 'added' | 'removed' | 'changed' | 'unchanged';
  before: GrantObject | null;
  after: GrantObject | null;
  changes: GrantPlanComparisonChange[];
}
export interface GrantPlanComparisonMetric {
  id: string;
  label: string;
  unit: string;
  before: string | number | null;
  after: string | number | null;
  /** Exact decimal after minus before. Null means at least one side is unset or absent. */
  delta: string | null;
  path: string;
}
export interface GrantPlanComparisonDay {
  day: number;
  before: GrantObject | null;
  after: GrantObject | null;
  delta: Record<'accruedUsd' | 'plannedOutflowUsd' | 'conditionalInflowUsd' | 'cashGapUsd' | 'gapAfterCapitalInputUsd' | 'accruedUnpaidUsd', string | null>;
}
export interface GrantPlanComparison {
  schema: 'stellar-forge.sf47.plan-comparison.v1';
  comparisonSha256: string;
  before: GrantPlanComparisonIdentity;
  after: GrantPlanComparisonIdentity;
  basis: {
    delta: 'after - before';
    reportBasis: string;
    dailyBasis: string;
    sameOriginalSource: boolean;
    sameCalculator: boolean;
    sameInputs: boolean;
  };
  summary: {
    inputChanges: number;
    reportChanges: number;
    groups: Record<'workPackages' | 'milestones' | 'contributors' | 'delivery', Record<'added' | 'removed' | 'changed' | 'unchanged', number>>;
    modeledDaysBefore: number;
    modeledDaysAfter: number;
  };
  metrics: GrantPlanComparisonMetric[];
  groups: Record<'workPackages' | 'milestones' | 'contributors' | 'delivery', GrantPlanComparisonRow[]>;
  changes: Array<GrantPlanComparisonChange & { area: 'scenario' | 'planning' | 'report' }>;
  days: GrantPlanComparisonDay[];
  snapshots: Record<'before' | 'after', GrantObject & { scenario: GrantObject; planning: GrantObject; report: GrantObject }>;
}

export type GrantDeliveryCalendarKind =
  | 'GRANT_RECEIPT' | 'SUBMISSION_DEADLINE' | 'PLANNED_SUBMISSION'
  | 'DELIVERABLE' | 'DELIVERABLE_COMPLETED' | 'FORM_SUBMISSION' | 'EXTENSION_CONFIRMATION';
export interface GrantDeliveryCalendarEntry extends GrantObject {
  id: string;
  kind: GrantDeliveryCalendarKind;
  tranche: number | null;
  title: string;
  /** Recorded civil bounds are inclusive; an unknown bound remains null. */
  startDate: GrantCivilDate | null;
  endDate: GrantCivilDate | null;
  sortDate: GrantCivilDate | null;
  datePrecision: 'RANGE' | 'DAY' | 'START_ONLY' | 'FINISH_ONLY' | 'UNDATED';
  status: string;
  active: boolean;
  detail: string;
  sourceId: string;
  costId: string | null;
  ownerIds: string[];
  ownerNames: string[];
  originalDeadlineOn?: GrantCivilDate | null;
  deadlineSource?: string;
  daysRemaining?: number | null;
  sourceIds: string[];
  dateBasis: string;
  calendarStatus: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  dateStatus?: string;
  confirmedDeadlineOn?: GrantCivilDate;
  submittedDeadlineOn?: GrantCivilDate;
  planningAssignments?: GrantObject[];
}
export interface GrantDeliveryCalendarSummary extends GrantObject {
  entries: number;
  undated: number;
  activeDeadlines: number;
  overdueDeadlines: number;
  dueToday: number;
  submittedDeadlines: number;
  openDeliverables: number;
  completedDeliverables: number;
  nextDeadlineOn: GrantCivilDate | null;
  byKind: Partial<Record<GrantDeliveryCalendarKind, number>>;
}
export interface GrantDeliveryCalendar extends GrantObject {
  schema: 'stellar-forge.sf47-delivery-calendar.v1';
  case: {
    id: string;
    name: string;
    mode: 'OPERATIONS' | 'WALKTHROUGH';
    state: 'OPEN' | 'CLOSED';
    version: number;
  };
  asOfDate: GrantCivilDate;
  generatedAt: string;
  source: {
    planId: string;
    planRevision: number;
    planContentSha256: string;
    planSourceSha256: string;
    calendarStart: GrantCivilDate | null;
    caseUpdatedAt: string;
    caseCreatedAt: string;
    completionPlans: GrantObject[];
  };
  rule: GrantObject;
  entries: GrantDeliveryCalendarEntry[];
  undated: GrantDeliveryCalendarEntry[];
  summary: GrantDeliveryCalendarSummary;
  basis: string[];
  sha256: string;
}
export interface GrantDeliveryCalendarSelection {
  caseId: string;
  asOfDate?: GrantCivilDate;
  expectedVersion?: number;
}
export interface GrantDeliveryCalendarDownloadSelection extends GrantDeliveryCalendarSelection {
  /** A complete case snapshot. Screen filters do not affect exports. Defaults to ICS. */
  format?: 'ics' | 'csv' | 'json';
}

/** Explicit case selection in one original workspace snapshot. */
export interface GrantDeliveryAgendaSelection {
  caseIds: string[];
  asOfDate?: GrantCivilDate;
  /** When supplied, must include exactly one current version for every selected case. */
  expectedVersions?: Record<string, number>;
}
export interface GrantDeliveryAgendaDownloadSelection extends GrantDeliveryAgendaSelection {
  /** Downloads include all selected case rows, independently of browser filters. */
  format?: 'ics' | 'csv' | 'json';
}
export interface GrantDeliveryAgendaCase {
  id: string;
  origin: GrantObject;
  /** Complete original calendar metadata and digest, before its entry arrays are joined. */
  calendar: Pick<GrantDeliveryCalendar,
    'schema' | 'case' | 'asOfDate' | 'generatedAt' | 'source' | 'rule' | 'summary' | 'basis' | 'sha256'>;
}
export interface GrantDeliveryAgendaEntry {
  /** Original case ID followed by ":" and the original calendar entry ID. */
  id: string;
  caseId: string;
  /** Position in this case's original entries or undated array. */
  position: number;
  entry: GrantDeliveryCalendarEntry;
}
export interface GrantDeliveryAgenda extends GrantObject {
  schema: 'stellar-forge.sf47-delivery-agenda.v1';
  generatedAt: string;
  asOfDate: GrantCivilDate;
  selection: {
    caseIds: string[];
    asOfDate: GrantCivilDate;
    expectedVersions: Record<string, number>;
  };
  cases: GrantDeliveryAgendaCase[];
  entries: GrantDeliveryAgendaEntry[];
  undated: GrantDeliveryAgendaEntry[];
  summary: GrantDeliveryCalendarSummary & {cases: number};
  basis: string[];
  sha256: string;
}

/** Original whole-task comparison inputs. Decimal quantities remain exact strings. */
export type GrantTaskMeasurementBasis = 'OBSERVED' | 'ESTIMATED' | 'MIXED' | 'UNRECORDED';
export interface GrantTaskEffort {
  id: string; label: string;
  category: 'ACQUISITION' | 'PROCESSING' | 'CORRECTION' | 'RECEIVING' | 'OTHER';
  personMinutes: string | null; hourlyRate: string | null; notes: string;
}
export interface GrantTaskCost { id: string; label: string; amount: string | null; notes: string }
export interface GrantTaskMethod {
  name: string; basis: GrantTaskMeasurementBasis; observedAt: string | null;
  sourceReference: string; population: string; period: string; output: string; quality: string;
  attemptedTasks: string | null; completedTasks: string | null; elapsedMinutes: string | null;
  sourceIds: string[]; notes: string; effort: GrantTaskEffort[]; costs: GrantTaskCost[];
}

/** Internal funding assignment; does not change original work, invoice, cash or issuer state. */
export type GrantFundingKind = 'PREAWARD' | 'GRANT' | 'CUSTOMER' | 'INTERNAL' | 'OTHER';
export type GrantFundingEligibility = 'UNASSESSED' | 'SUPPORTED' | 'EXCLUDED';
export interface GrantFundingSource {
  id: string; name: string; kind: GrantFundingKind; reference: string;
  decision: 'PROPOSED' | 'RECORDED'; sourceIds: string[]; conditions: string;
  costWindowStart: GrantCivilDate | null; costWindowEnd: GrantCivilDate | null;
  receiptTiming: string; limitUsd: string | null; note: string;
}
export interface GrantFundingAllocation {
  fundId: string; quantity: string; eligibility: GrantFundingEligibility;
  sourceIds: string[]; basis: string;
}
export interface GrantFundingAssignment {
  kind: 'WORK' | 'INVOICE'; recordId: string; lineId: string | null; note: string;
  allocations: GrantFundingAllocation[];
}
export interface GrantFundingDocument {
  title: string; status: 'DRAFT' | 'REVIEWED'; asOfDate: GrantCivilDate;
  periodStart: GrantCivilDate | null; periodEnd: GrantCivilDate; note: string;
  funds: GrantFundingSource[]; assignments: GrantFundingAssignment[];
}
export interface GrantFundingInputs { expectedRevision: number; document: GrantFundingDocument }
export interface GrantFundingTarget {
  key: string; kind: 'WORK' | 'INVOICE'; recordId: string; lineId: string | null;
  recordVersion: number; recordSha256: string; state: string; date: GrantCivilDate; startDate: GrantCivilDate;
  costId: string | null; contributorId: string; contributor: string; description: string; invoiceNumber: string | null;
  unit: 'HOURS' | 'USD'; quantity: string; originalQuantity: string; originalFundingBasis: GrantFundingKind | null;
  workIds: string[]; sourceIds: string[];
}
export interface GrantFundingCase extends GrantObject {
  id: string; name: string; version: number; mode: 'OPERATIONS' | 'WALKTHROUGH'; createdAt: string;
}
export interface GrantFundingSnapshot {
  case: GrantFundingCase; plan: GrantObject;
  records: {contributors: GrantObject[]; work: GrantObject[]; invoices: GrantObject[]};
  sources: GrantObject[];
}
export interface GrantFundingLink {
  sourceId: string; sourceSha256: string; revision: number; editionSha256: string;
}
export interface GrantFundingPeriod {startDate: GrantCivilDate | null; endDate: GrantCivilDate; asOfDate: GrantCivilDate}
export interface GrantFundingTotals {
  invoiceUsd: string; workHours: string; acceptedHours: string; reviewedInvoiceUsd: string;
  supportedInvoiceUsd: string; excludedInvoiceUsd: string;
}
export interface GrantFundingFundBalance {
  id: string; name: string; kind: GrantFundingKind | 'UNASSIGNED';
  decision: 'PROPOSED' | 'RECORDED' | 'UNASSIGNED'; limitUsd: string | null; limitExcessUsd: string | null;
  opening: GrantFundingTotals; period: GrantFundingTotals; closing: GrantFundingTotals; afterEnd: GrantFundingTotals;
}
export interface GrantFundingBalance extends GrantFundingTarget {
  interval: 'OPENING' | 'PERIOD' | 'AFTER_END'; assigned: string; unassigned: string;
  allocationNote: string; spansPeriodStart: boolean;
}
export interface GrantFundingAllocationRow extends GrantFundingTarget {
  fundId: string | null; fundName: string; fundKind: GrantFundingKind | 'UNASSIGNED';
  fundDecision: 'PROPOSED' | 'RECORDED' | 'UNASSIGNED'; eligibility: GrantFundingEligibility;
  basis: string; fundSourceIds: string[]; fundReference: string; allocationNote: string;
  interval: 'OPENING' | 'PERIOD' | 'AFTER_END'; windowObservation: 'UNSTATED' | 'OUTSIDE_SOURCE_WINDOW' | 'WITHIN_SOURCE_WINDOW';
}
export interface GrantFundingChange {key: string; change: string; before: GrantObject | null; after: GrantObject | null}
export interface GrantFundingChanges {
  previous: GrantFundingLink | null; originalRows: GrantFundingChange[];
  assignments: GrantFundingChange[]; funds: GrantFundingChange[];
}
export interface GrantFundingReport {
  schema: 'stellar-forge.sf47-cost-funding.v1.report'; period: GrantFundingPeriod; basis: string; dateBasis: string;
  sourceCounts: {work: number; invoices: number; targets: number; allocationParts: number};
  totals: Record<'opening' | 'period' | 'closing' | 'afterEnd', GrantFundingTotals>;
  funds: GrantFundingFundBalance[];
  packages: Array<{costId: string | null; plannedUsd: string | number | null; plannedHours: string | number | null;
    invoiceUsd: string; assignedInvoiceUsd: string; unassignedInvoiceUsd: string; workHours: string; assignedWorkHours: string; unassignedWorkHours: string}>;
  balances: GrantFundingBalance[]; allocations: GrantFundingAllocationRow[];
  findings: Array<{code: string; key: string; fundId: string | null; message: string}>; changes: GrantFundingChanges;
}
export interface GrantFundingSummary extends GrantFundingLink {
  title: string; status: 'DRAFT' | 'REVIEWED'; savedAt: string; actor: string; caseVersion: number;
  period: GrantFundingPeriod; reportSha256: string;
}
export interface GrantFundingCatalog {
  case: GrantFundingCase; plan: {id: string; revision: number; contentSha256: string};
  targets: GrantFundingTarget[]; sources: GrantObject[]; packages: GrantObject[];
}
export interface GrantFundingPreview {
  schema: 'stellar-forge.sf47-cost-funding.v1.preview'; inputs: GrantFundingInputs; previous: GrantFundingLink | null;
  source: GrantFundingSnapshot; report: GrantFundingReport; reportSha256: string; previewSha256: string;
}
export interface GrantFundingEdition {
  schema: 'stellar-forge.sf47-cost-funding.v1'; id: 'cost-funding'; revision: number; caseVersion: number;
  previous: GrantFundingLink | null; savedAt: string; actor: string; note: string;
  document: GrantFundingDocument; source: GrantFundingSnapshot; report: GrantFundingReport;
  reportSha256: string; previewSha256: string; sha256: string;
}
export interface GrantFundingView {
  source: GrantObject; edition: GrantFundingEdition; catalog: GrantFundingCatalog;
  history: GrantFundingSummary[]; currentSourceChanges: GrantFundingChange[]; inputs: GrantFundingInputs;
}
export interface GrantFundingSeed {inputs: GrantFundingInputs; catalog: GrantFundingCatalog; selectedEdition: GrantFundingSummary | null; history: GrantFundingSummary[]}
export interface GrantFundingSaveInput {
  expectedVersion: number; requestId: string; actor: string; note: string;
  inputs: GrantFundingInputs; expectedPreviewSha256: string;
  /** Full original result, when already accepted; prevents resubmission into an older restored journal. */
  acceptedResult?: GrantFundingReceipt;
}
export interface GrantFundingReceipt {
  id: string; version: number; action: 'funding.save'; kind: 'source'; recordId: string; funding: GrantFundingSummary;
}
export type GrantFundingRequest = {caseId: string; caseCreatedAt: string; requestId: string} &
  ({found: false} | {found: true; fingerprint: string; result: GrantFundingReceipt; resultSha256: string});

export interface GrantTaskRecurringObservation {
  /** Stable original observation identity, retained in later comparison editions. */
  id: string; label: string; method: GrantTaskMethod;
  comparison: { decision: 'UNREVIEWED' | 'COMPARABLE' | 'NOT_COMPARABLE'; reason: string };
  status: 'DRAFT' | 'REVIEWED'; conclusion: string;
  /** Actual customer response, separate from the recording operator's review. */
  acceptance: {status: 'PENDING' | 'ACCEPTED' | 'DECLINED'; by: string; at: string | null; note: string};
  deploymentIds: string[]; purchaseIds: string[];
}
export interface GrantTaskOutcomeDocument {
  title: string; customer: string; task: string; unit: string; currency: string;
  installation: { id: string; revision: number } | null;
  deploymentIds: string[]; purchaseIds: string[];
  baseline: GrantTaskMethod; installed: GrantTaskMethod;
  /** Omitted in legacy editions; each recurring method compares with this same baseline. */
  followups?: GrantTaskRecurringObservation[];
  comparison: { decision: 'UNREVIEWED' | 'COMPARABLE' | 'NOT_COMPARABLE'; reason: string };
  status: 'DRAFT' | 'REVIEWED'; conclusion: string;
}
export interface GrantTaskOutcomeInputs {
  id: string; expectedRevision: number; document: GrantTaskOutcomeDocument;
}
export interface GrantTaskOutcomeDifference {
  prior: string; installed: string; difference: string; percent: string | null;
}
export interface GrantTaskOutcomeMethodReport {
  basis: GrantTaskMeasurementBasis; attemptedTasks: string | null; completedTasks: string | null;
  incompleteTasks: string | null; elapsedMinutes: string | null;
  personMinutes: string | null; knownPersonMinutes: string; missingEffortIds: string[];
  labourCost: string | null; knownLabourCost: string; unvaluedEffortIds: string[];
  otherCost: string | null; knownOtherCost: string; missingCostIds: string[];
  totalCost: string | null; personMinutesPerCompletedTask: string | null; costPerCompletedTask: string | null;
  categories: Array<{category: GrantTaskEffort['category']; rows: number; personMinutes: string | null; knownPersonMinutes: string}>;
}
export interface GrantTaskOutcomeReport {
  schema: 'stellar-forge.sf47-customer-task-outcomes.v1.report';
  currency: string; unit: string; baseline: GrantTaskOutcomeMethodReport; installed: GrantTaskOutcomeMethodReport;
  scopeDifferences: Array<{field: string; prior: string; installed: string}>;
  comparisonReviewed: boolean; comparable: boolean; sameCompletedTaskCount: boolean;
  measurementBasis: 'OBSERVED' | 'ESTIMATED_OR_INCOMPLETE';
  savings: Record<'personMinutes' | 'totalCost' | 'personMinutesPerCompletedTask' | 'costPerCompletedTask', GrantTaskOutcomeDifference | null>;
  findings: Array<{path: string; message: string}>; basis: string;
  followups?: Array<{id: string; label: string; status: 'DRAFT' | 'REVIEWED';
    acceptance: GrantTaskRecurringObservation['acceptance']; report: GrantTaskOutcomeReport;
    elapsedMinutesDifference: GrantTaskOutcomeDifference | null; acceptedComparableObserved: boolean}>;
  series?: {observations: number; reviewed: number; accepted: number; declined: number; pending: number;
    acceptedComparableObserved: number; observedUtcDates: string[]; basis: string};
}
export interface GrantTaskOutcomeSnapshot {
  case: {id: string; version: number; mode: string; planId: string; planRevision: number; planContentSha256: string};
  sources: GrantObject[]; deployments: GrantObject[]; purchases: GrantObject[]; installation: GrantObject | null;
}
export interface GrantTaskOutcomePreview {
  schema: 'stellar-forge.sf47-customer-task-outcomes.v1.preview';
  inputs: GrantTaskOutcomeInputs; source: GrantTaskOutcomeSnapshot; report: GrantTaskOutcomeReport;
  reportSha256: string; previewSha256: string;
}
export interface GrantTaskOutcomeSummary {
  id: string; revision: number; sourceId: string; sourceSha256: string; sha256: string;
  title: string; customer: string; status: 'DRAFT' | 'REVIEWED'; savedAt: string; actor: string;
  comparison: GrantTaskOutcomeDocument['comparison']; measurementBasis: GrantTaskOutcomeReport['measurementBasis'];
  recurring?: {observations: number; accepted: number; acceptedComparableObserved: number};
}
export interface GrantTaskOutcomeEdition {
  schema: 'stellar-forge.sf47-customer-task-outcomes.v1';
  id: string; revision: number; previous: {id: string; sha256: string; revision: number} | null;
  caseVersion: number; savedAt: string; actor: string; note: string; document: GrantTaskOutcomeDocument;
  source: GrantTaskOutcomeSnapshot; report: GrantTaskOutcomeReport; reportSha256: string; previewSha256: string; sha256: string;
}
export interface GrantTaskOutcomeView {
  source: GrantObject; edition: GrantTaskOutcomeEdition; history: GrantTaskOutcomeSummary[];
  case: {id: string; version: number; state: string};
}
export interface GrantTaskOutcomeSaveInput {
  expectedVersion: number; requestId: string; actor: string; note?: string;
  inputs: GrantTaskOutcomeInputs; expectedPreviewSha256: string;
}
export interface GrantTaskOutcomeReceipt {
  id: string; version: number; action: 'task-outcomes.save'; kind: 'source'; recordId: string;
  taskOutcomes: GrantTaskOutcomeSummary;
}

/** Human-recorded delivery risks and issues in the original case review history. */
export type GrantRiskStatus = 'OPEN' | 'MONITORING' | 'MITIGATING' | 'RESOLVED' | 'CLOSED';
export type GrantRiskCategory = 'DELIVERY' | 'STAFFING' | 'CUSTOMER' | 'FUNDING' | 'TECHNICAL' | 'SECURITY' | 'EXTERNAL' | 'OTHER';
export type GrantRiskLikelihood = 'UNASSESSED' | 'UNLIKELY' | 'POSSIBLE' | 'LIKELY' | 'NOT_APPLICABLE';
export type GrantRiskImpact = 'UNASSESSED' | 'MINOR' | 'MODERATE' | 'MAJOR';
export type GrantRiskPriority = 'UNASSESSED' | 'LOW' | 'MEDIUM' | 'HIGH';
export type GrantRiskActionStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export interface GrantRiskEvidence {
  sourceIds: string[];
  sourceNote: string;
  /** Recomputed by the native engine from the actual attachment references. */
  sourceBasis?: 'ATTACHED_SOURCE' | 'OPERATOR_ENTRY';
}
export interface GrantRiskAction extends GrantRiskEvidence {
  /** Stable [a-z][a-z0-9-]{1,99} identifier, preserved in successor editions. */
  id: string;
  title: string;
  description: string;
  /** Original case contributor ID; null explicitly records an unassigned action. */
  ownerId: string | null;
  ownerNote: string;
  status: GrantRiskActionStatus;
  dueOn: GrantCivilDate | null;
  completedOn: GrantCivilDate | null;
  progress: string;
}
export interface GrantRiskRecord extends GrantRiskEvidence {
  /** Stable [a-z][a-z0-9-]{1,99} identifier, preserved in successor editions. */
  id: string;
  kind: 'RISK' | 'ISSUE';
  title: string;
  description: string;
  category: GrantRiskCategory;
  identifiedOn: GrantCivilDate;
  ownerId: string | null;
  ownerNote: string;
  status: GrantRiskStatus;
  /** Issues use NOT_APPLICABLE; risk likelihood is explicitly recorded by the operator. */
  likelihood: GrantRiskLikelihood;
  impact: GrantRiskImpact;
  priority: GrantRiskPriority;
  assessmentNote: string;
  trigger: string;
  nextReviewOn: GrantCivilDate | null;
  costIds: string[];
  review: { on: GrantCivilDate | null; by: string; note: string };
  resolution: { on: GrantCivilDate | null; note: string };
  actions: GrantRiskAction[];
}
export interface GrantRiskReviewRef {
  reviewId: string;
  reviewSha256: string;
}
export interface GrantRiskDocument {
  schema: 'stellar-forge.sf47-delivery-risks.v1';
  name: string;
  asOfDate: GrantCivilDate;
  note: string;
  supersedes: GrantRiskReviewRef | null;
  /** Complete register, including retained resolved and closed entries; at most 200. */
  risks: GrantRiskRecord[];
}
export interface GrantRiskSource extends GrantForecastSource {
  bindingSha256: string;
}
export interface GrantRiskCounts {
  total: number;
  open: number;
  monitoring: number;
  mitigating: number;
  resolved: number;
  closed: number;
  risks: number;
  issues: number;
  unassigned: number;
  overdueReviews: number;
  overdueActions: number;
}
export interface GrantRiskOwner {
  id: string;
  name: string;
  kind: 'PERSON' | 'ORGANIZATION' | 'TEAM' | 'ROLE';
  contact: string;
}
export interface GrantRiskReportEntry {
  id: string;
  title: string;
  kind: 'RISK' | 'ISSUE';
  category: GrantRiskCategory;
  status: GrantRiskStatus;
  likelihood: GrantRiskLikelihood;
  impact: GrantRiskImpact;
  priority: GrantRiskPriority;
  owner: GrantRiskOwner | null;
  costs: { id: string; label: string; current: boolean }[];
  nextReviewOn: GrantCivilDate | null;
  reviewOverdue: boolean;
  actions: {
    id: string;
    title: string;
    status: GrantRiskActionStatus;
    owner: GrantRiskOwner | null;
    dueOn: GrantCivilDate | null;
    completedOn: GrantCivilDate | null;
    overdue: boolean;
  }[];
  sourceIds: string[];
  findings: { code: string; message: string; actionId?: string }[];
}
export interface GrantRiskReport {
  schema: 'stellar-forge.sf47-delivery-risks.v1.report';
  name: string;
  asOfDate: GrantCivilDate;
  mode: 'OPERATIONS' | 'WALKTHROUGH';
  counts: GrantRiskCounts;
  entries: GrantRiskReportEntry[];
  notice: string;
}
export interface GrantRiskSummary {
  id: string;
  version: number;
  createdAt: string;
  actor: string;
  note: string;
  purpose: 'DELIVERY_RISK_REGISTER';
  sha256: string;
  businessSha256: string;
  name: string;
  asOfDate: GrantCivilDate;
  counts: GrantRiskCounts;
  supersedes: GrantRiskReviewRef | null;
}
export interface GrantRiskList {
  schema: 'stellar-forge.sf47-delivery-risks.v1';
  source: GrantRiskSource;
  current: GrantRiskSummary | null;
  /** Complete saved editions, newest first. */
  editions: GrantRiskSummary[];
}
export interface GrantRiskSeed {
  document: GrantRiskDocument;
  source: GrantRiskSource;
  contributors: GrantObject[];
  packages: GrantObject[];
  sources: GrantObject[];
  previous: GrantRiskSummary | null;
}
export interface GrantRiskPreview {
  schema: 'stellar-forge.sf47-delivery-risks.v1';
  engineVersion: 1;
  source: GrantRiskSource;
  document: GrantRiskDocument;
  report: GrantRiskReport;
  previewSha256: string;
}
export interface GrantRiskReview {
  id: string;
  version: number;
  createdAt: string;
  actor: string;
  note: string;
  purpose: 'DELIVERY_RISK_REGISTER';
  businessSha256: string;
  snapshot: GrantObject;
  report: GrantObject;
  riskRegister: GrantRiskPreview;
  sha256: string;
}
export interface GrantRiskRegister {
  review: GrantRiskReview;
  document: GrantRiskDocument;
  source: GrantRiskSource;
  report: GrantRiskReport;
  previewSha256: string;
  current: {
    programId: string;
    version: number;
    sourceChanged: boolean;
    reason: string | null;
    retainedOriginalProgramId: string;
  };
}
export interface GrantRiskHistory {
  schema: 'stellar-forge.sf47-delivery-risks.v1.history';
  riskId: string;
  entries: { edition: GrantRiskSummary; risk: GrantRiskRecord }[];
  current: GrantRiskRecord | null;
}
export interface GrantRiskSaveInput extends GrantOperationRequest {
  note: string;
  document: GrantRiskDocument;
  expectedPreviewSha256: string;
}
export interface GrantRiskSaveCommand extends GrantOperationRequest {
  note: string;
  action: 'risk-register.save';
  data: { document: GrantRiskDocument; expectedPreviewSha256: string };
}
export interface GrantRiskSaveReceipt {
  id: string;
  version: number;
  action: 'risk-register.save';
  kind: 'review';
  recordId: string;
  reviewSha256: string;
  riskRegister: GrantRiskSummary;
}
/** Exact original command lookup, including its reviewed version, document and preview. */
export type GrantRiskRequest =
  | { found: false; requestId: string }
  | { found: true; requestId: string; fingerprint: string; result: GrantRiskSaveReceipt };

/** Exact native decimal text; hours use at most four and USD at most two decimals. */
export type GrantEngagementHours = string;
export type GrantEngagementUsd = string;
/** Exact original hourly USD rate as decimal text, at most four decimal places. */
export type GrantEngagementRate = string;
export type GrantEngagementPaymentMode = 'original' | 'accrual' | 'completion';
export type GrantEngagementAcceptanceStatus = 'PROPOSED' | 'CONFIRMED' | 'DECLINED' | 'WITHDRAWN';
export interface GrantEngagementEvidence {
  sourceIds: string[];
  sourceNote: string;
}
export interface GrantEngagementAvailability extends GrantEngagementEvidence {
  /** Monday through Sunday. null means unentered; "0" means unavailable. */
  hoursByWeekday: [GrantEngagementHours | null, GrantEngagementHours | null, GrantEngagementHours | null, GrantEngagementHours | null, GrantEngagementHours | null, GrantEngagementHours | null, GrantEngagementHours | null];
  hoursByDate: Record<GrantCivilDate, GrantEngagementHours>;
  note: string;
}
export interface GrantEngagementCompensation extends GrantEngagementEvidence {
  basis: 'HOURLY' | 'FIXED' | 'IN_KIND' | 'UNSPECIFIED';
  rateUsd: GrantEngagementRate | null;
  totalUsd: GrantEngagementUsd | null;
  paymentTerms: string;
  paymentMode: GrantEngagementPaymentMode;
  note: string;
}
/** CONFIRMED must record the actual accepting person and timestamp in native validation. */
export type GrantEngagementAcceptance = GrantEngagementEvidence & {
  by: string;
  note: string;
} & (
  | { status: 'CONFIRMED'; at: string }
  | { status: 'PROPOSED' | 'DECLINED' | 'WITHDRAWN'; at: string | null }
);
export interface GrantEngagementAllocation {
  costId: string;
  remainingHours: GrantEngagementHours;
  remainingCostUsd: GrantEngagementUsd;
  note: string;
}
export interface GrantEngagementAgreement extends GrantEngagementEvidence {
  /** Original Operations identifier: [a-z][a-z0-9-]{1,99}. */
  id: string;
  contributorId: string;
  role: string;
  scope: string;
  startDate: GrantCivilDate;
  endDate: GrantCivilDate;
  availability: GrantEngagementAvailability;
  compensation: GrantEngagementCompensation;
  acceptance: GrantEngagementAcceptance;
  /** An agreement can have no package allocations yet. */
  allocations: GrantEngagementAllocation[];
}
export interface GrantEngagementReviewRef {
  reviewId: string;
  /** Whole immutable native review digest, not only the document or preview digest. */
  reviewSha256: string;
}
export interface GrantEngagementDocument {
  schema: 'stellar-forge.sf47-contributor-engagements.v1';
  name: string;
  asOfDate: GrantCivilDate;
  agreements: GrantEngagementAgreement[];
  note: string;
  supersedes: GrantEngagementReviewRef | null;
}
export interface GrantEngagementSummary extends GrantObject {
  id: string;
  version: number;
  createdAt: string;
  actor: string;
  note: string;
  purpose: 'CONTRIBUTOR_ENGAGEMENTS';
  sha256: string;
  businessSha256: string;
  name: string;
  asOfDate: GrantCivilDate;
  agreements: number;
  confirmed: number;
  proposed: number;
  declined: number;
  withdrawn: number;
  allocatedHours: GrantEngagementHours;
  remainingCostUsd: GrantEngagementUsd;
  supersedes: GrantEngagementReviewRef | null;
}
/** Full native receiving summary retains its allocator status and ready alternatives. */
export interface GrantEngagementReceivingSummary extends GrantObject {
  id: string;
  sha256: string;
  purpose: 'CONTRIBUTOR_ENGAGEMENTS_RECEIVING';
}
export interface GrantEngagementList {
  engagements: GrantEngagementSummary[];
  receivings: GrantEngagementReceivingSummary[];
}
export interface GrantEngagementSeed {
  document: GrantEngagementDocument;
  source: GrantObject;
  contributors: GrantObject[];
  packages: GrantObject[];
  sources: GrantObject[];
  previous: GrantEngagementSummary | null;
}
export interface GrantEngagementPreview extends GrantObject {
  schema: string;
  engineVersion: number;
  source: GrantObject;
  document: GrantEngagementDocument;
  report: GrantObject;
  previewSha256: string;
}
export interface GrantEngagementBook extends GrantObject {
  review: GrantObject;
  document: GrantEngagementDocument;
  source: GrantObject;
  report: GrantObject;
  previewSha256: string;
  current: {
    programId: string;
    version: number;
    sourceChanged: boolean;
    retainedOriginalProgramId: string;
  };
  receivings: GrantEngagementReceivingSummary[];
}
export interface GrantEngagementPrepareInput extends GrantOperationRequest {
  /** Nonempty original review note, independently retained in the case command. */
  note: string;
  document: GrantEngagementDocument;
  expectedPreviewSha256: string;
}
export interface GrantEngagementPrepareReceipt extends GrantObject {
  id: string;
  version: number;
  action: 'engagement.prepare';
  recordId: string;
  sha256: string;
}
export interface GrantEngagementRemainder extends GrantEngagementAllocation {}
export interface GrantEngagementPaymentSelection {
  costId: string;
  paymentMode: GrantEngagementPaymentMode;
  note: string;
}
export interface GrantEngagementForecastSelection extends GrantEngagementReviewRef {
  /** Existing base Forecast; its asOfDate must equal the selected book date. */
  forecastId: string;
  /** Every selected agreement must have native CONFIRMED acceptance. */
  agreementIds: string[];
  /** If supplied, covers every affected package. Omission uses native derived remainders. */
  remainders?: GrantEngagementRemainder[];
  /** If supplied, covers every affected package. Differing agreement modes need an explicit choice. */
  paymentModes?: GrantEngagementPaymentSelection[];
  name: string;
  note: string;
}
export interface GrantEngagementForecastPreview {
  /** Complete normalized native selection; retain it for engagement.receiving. */
  selection: GrantEngagementForecastSelection;
  inputs: GrantObject;
  forecast: GrantForecastPreview;
  projection: GrantObject;
  source: GrantObject;
}
export interface GrantEngagementResourceSelection {
  engagementId: string;
  resourceId: string;
}
export interface GrantEngagementPortfolioSelection extends GrantEngagementReviewRef {
  /** Newly saved Forecast from the preceding native engagement handover. */
  forecastId: string;
  agreementIds: string[];
  /** Covers each selected contributor once, retaining chosen original resource IDs. */
  resourceMap: GrantEngagementResourceSelection[];
  /** Complete native draft, including every explicit alternative and Installation phase. */
  inputs?: GrantPortfolioInputs;
  name: string;
  note: string;
}
export interface GrantEngagementPortfolioPreview {
  selection: GrantEngagementPortfolioSelection;
  inputs: GrantPortfolioInputs;
  portfolio: GrantPortfolioPreview;
  projection: GrantObject;
  source: GrantObject;
}
export interface GrantEngagementReceivingData extends GrantEngagementReviewRef {
  forecastId: string;
  portfolioId: string;
  forecastSelection: GrantEngagementForecastSelection;
  portfolioSelection: GrantEngagementPortfolioSelection;
}
export interface GrantEngagementReceivingInput extends GrantOperationRequest, GrantEngagementReceivingData {
  /** Nonempty original receiving note; native writes retain the same request identity. */
  note: string;
}
export interface GrantEngagementReceivingReceipt extends GrantObject {
  id: string;
  version: number;
  action: 'engagement.receiving';
  recordId: string;
  sha256: string;
}

export const GRANT_PLANNING_SOURCE_SCHEMA: 'stellar-forge.sf47-planning-source-agent.v1';
export const GRANT_PLANNING_SOURCE_ACTIONS: readonly (keyof GrantPlanningSourceInputs)[];
export type GrantPlanningRole = 'packages' | 'milestones' | 'contributors' | 'assignments';
export interface GrantWorkbookUpload {
  filename: string; bytes: number; sha256: string; dataBase64: string;
}
export interface GrantWorkbookSource extends GrantWorkbookUpload {
  schema: 'stellar-forge.planning-workbook-source.v1'; id: string;
  description: GrantObject;
  decoder: {path: string; sha256: string; parser: 'stellar-forge.xlsx-reader.v1'};
}
export interface GrantWorkbookMapping {
  schema: 'stellar-forge.planning-workbook-mapping.v1';
  plan: GrantObject & {
    name: string; notes: string; sheet: string; range: string; headerRow: number | null;
    hiddenRows: string; blankRows: string; mergedCells: string;
    columns: Array<GrantObject & {name: string; source: string; formula: string; date: string}>;
  };
  numericText: Record<string, 'source' | 'decimal'>;
}
export interface GrantWorkbookProjection {text: string; bytes?: number; sha256: string;}
export interface GrantWorkbookSelection {source: GrantWorkbookSource; projection: GrantWorkbookProjection;}
export interface GrantWorkbookInspectionInput {
  source: GrantWorkbookUpload | GrantWorkbookSource;
  preview?: {sheet?: string; range?: string; offset?: number; limit?: number};
  headerRow?: number | null;
}
export interface GrantWorkbookProjectionInput {
  source: GrantWorkbookUpload | GrantWorkbookSource; mapping: GrantWorkbookMapping;
}
export interface GrantWorkbookInspection {
  source: GrantWorkbookSource; preview: GrantObject; headerCells: GrantObject[];
}
export interface GrantPlanningWorkbookProfile {
  schema: 'stellar-forge.planning-workbook-export-profile.v1';
  numberMode: 'exact-text' | 'spreadsheet-numbers'; precisionPolicy: 'text' | 'reject';
  amountMode: 'native-values' | 'formulas'; note: string;
}
export interface GrantPlanningWorkbookReturnProfile {
  schema: 'stellar-forge.planning-workbook-return-profile.v1';
  modeByRole: Record<GrantPlanningRole, 'merge' | 'replace'>;
  orphanPolicy: 'preserve' | 'remove-unreferenced'; includeHiddenRows: boolean; note: string;
}
export type GrantPlanningField =
  | {source: 'column'; column: string; members?: Record<string,string>}
  | {source: 'constant'; value: string | number | null; members?: Record<string,string>}
  | {source: 'existing'; members?: Record<string,string>};
export interface GrantPlanningSourceBinding {
  role: GrantPlanningRole; documentId: string; mode: 'merge' | 'replace';
  fields: Record<string, GrantPlanningField>;
  excludedRows: Array<{editionId: string; record: number; note: string}>;
}
export interface GrantPlanningSourceBaseline {
  id: string; name: string; revision: number; contentSha256: string;
  source: GrantObject; scenario: GrantObject; planning: GrantObject;
}
export interface GrantPlanningSourceBook extends GrantObject {
  schema: 'stellar-forge.planning-source-tables.v1';
  id: string; name: string; createdAt: string; baseline: GrantPlanningSourceBaseline;
  project: GrantObject; bindings: GrantPlanningSourceBinding[];
  settings: {scenarioName: string; awardRequestUsd: string; projectEndDay: number};
  orphanPolicy: 'preserve' | 'remove-unreferenced'; reviews: GrantObject[]; appliedReviewId: string | null;
  workbookSources?: GrantWorkbookSource[]; workbookSelections?: GrantObject[];
  selectedWorkbooks?: Record<string,string | null>;
}
export type GrantPlanningSourceBookInput = GrantPlanningSourceBook | string | {
  schema: 'stellar-forge.planning-source-tables.v1.retained'; text: string;
};
export interface GrantPlanningSourceView extends GrantObject {
  schema: typeof GRANT_PLANNING_SOURCE_SCHEMA; operation: string; book: GrantPlanningSourceBook;
  baseline: {id: string; revision: number; contentSha256: string}; collections: GrantObject[];
}
export interface GrantPlanningSourcePreview extends GrantObject {
  schema: 'stellar-forge.planning-source-tables.preview.v1'; id: string;
  book: GrantPlanningSourceBook; planId: string; expectedRevision: number;
  scenarioPatch: GrantObject; planning: GrantObject; native: GrantObject; nativeSha256: string;
  review: GrantObject & {preparedAt: string; sourceRows: GrantObject[]; changes: GrantObject[]};
}
export interface GrantPlanningSourceFile {
  filename: string; bytes: Uint8Array; delimiter?: ',' | ';' | '\t' | '|'; header?: boolean;
}
export interface GrantPlanningSourceInputs {
  snapshot: {planId: string; revision?: number; expectedContentSha256?: string};
  read: {book: GrantPlanningSourceBookInput; role?: GrantPlanningRole};
  receive: {book: GrantPlanningSourceBookInput; role: GrantPlanningRole; file: GrantPlanningSourceFile};
  'receive-workbook': {book: GrantPlanningSourceBookInput; role: GrantPlanningRole; selection: GrantWorkbookSelection};
  'receive-returned-workbook': {book: GrantPlanningSourceBookInput; file: GrantPlanningSourceFile; profile: GrantPlanningWorkbookReturnProfile};
  configure: {
    book: GrantPlanningSourceBookInput; role?: GrantPlanningRole;
    binding?: Partial<Pick<GrantPlanningSourceBinding,'fields' | 'mode' | 'excludedRows'>>;
    tableMapping?: GrantObject; settings?: Partial<GrantPlanningSourceBook['settings']>;
    orphanPolicy?: GrantPlanningSourceBook['orphanPolicy'];
    exclusions?: Array<{record: number; excluded: boolean; note?: string}>;
  };
  select: {book: GrantPlanningSourceBookInput} & (
    {role: GrantPlanningRole; editionId: string; workbookSelectionId?: never}
    | {workbookSelectionId: string; role?: never; editionId?: never}
  );
  review: {book: GrantPlanningSourceBookInput; roles: GrantPlanningRole[]};
  rebase: {book: GrantPlanningSourceBookInput; planId: string; revision?: number; expectedContentSha256?: string};
  preview: {book: GrantPlanningSourceBookInput};
  save: {preview: GrantPlanningSourcePreview; note: string; requestId: string};
  handover: {planId: string; revision: number; expectedContentSha256: string; profile: GrantPlanningWorkbookProfile};
}
export interface GrantPlanningWorkbookHandover extends GrantNativeResponse<undefined> {
  handover: {
    schema: typeof GRANT_PLANNING_SOURCE_SCHEMA; plan: {id: string; revision: number; contentSha256: string};
    sourceProjectId: string; manifest: GrantObject;
  };
  /** Exact original source project, planning ZIP, XLSX and manifest members. */
  companions: GrantNativeResponse[];
}
export interface GrantPlanningSourceResponses {
  snapshot: GrantJsonResponse<GrantPlanningSourceView>;
  read: GrantJsonResponse<GrantPlanningSourceView>;
  receive: GrantJsonResponse<GrantPlanningSourceView>;
  'receive-workbook': GrantJsonResponse<GrantPlanningSourceView>;
  'receive-returned-workbook': GrantJsonResponse<GrantPlanningSourceView>;
  configure: GrantJsonResponse<GrantPlanningSourceView>;
  select: GrantJsonResponse<GrantPlanningSourceView>;
  review: GrantJsonResponse<GrantPlanningSourceView>;
  rebase: GrantJsonResponse<GrantPlanningSourceView>;
  preview: GrantJsonResponse<GrantPlanningSourcePreview>;
  save: GrantJsonResponse<GrantObject>;
  handover: GrantPlanningWorkbookHandover;
}
export function grantPlanningSourceProfiles(): {
  schema: typeof GRANT_PLANNING_SOURCE_SCHEMA; roles: Record<GrantPlanningRole,GrantObject>;
  workbookExport: GrantPlanningWorkbookProfile; workbookReturn: GrantPlanningWorkbookReturnProfile;
  sourceProjectSchema: string; workbookMappingSchema: string; guides: string[];
};

/** Exact original atomic quantity; the native reader owns transfer verification. */
export interface GrantSettlementTransfer extends GrantObject {
  network: string;
  asset: string;
  amountAtomic: string;
  transaction: string;
  matchingEventId: string;
  transferKey: string;
  ledger: number;
  recipient: string;
  payer: string | null;
}
export interface GrantSettlementUnits {
  currency: string;
  /** Explicit asset precision, 0 through 12. */
  decimals: number;
  unitSourceIds: string[];
  unitNote: string;
}
export interface GrantSettlementCashInput extends GrantSettlementUnits {
  date: GrantCivilDate;
  usdValue?: string | null;
  valuationSourceIds?: string[];
  /** Required by the native reader whenever usdValue is supplied. */
  valuationNote?: string;
  category?: 'CUSTOMER' | 'INVOICE' | 'OTHER' | 'REFUND';
  tranche?: 0 | 1 | 2 | 3 | null;
  /** Original supplier-invoice allocations are permitted only for cash outflows. */
  allocations?: { invoiceId: string; amountUsd: string }[];
}
export interface GrantSettlementAttribution {
  rowId: string;
  reason: string;
  deploymentIds: string[];
  workIds: string[];
}
export type GrantSettlementSelection = GrantSettlementAttribution & (
  | { decision: 'RECORD_CASH'; cash: GrantSettlementCashInput; cashId?: null }
  | { decision: 'LINK_CASH'; cashId: string; cash: GrantSettlementUnits }
  | { decision: 'OBSERVE' | 'OMIT'; cashId?: null; cash?: never }
);
export interface GrantSettlementReviewInput {
  name: string;
  selections: GrantSettlementSelection[];
}
export interface GrantSettlementCashValue extends GrantObject {
  id?: string;
  state?: 'OBSERVED' | 'VOID';
  direction: 'IN' | 'OUT';
  category: string;
  date: GrantCivilDate;
  currency: string;
  network: string;
  asset: string;
  amount: string;
  usdValue: string | null;
  externalRef: string;
  allocations: { invoiceId: string; amountUsd: string }[];
}
export interface GrantSettlementCashRecord extends GrantSettlementCashValue {
  id: string;
  state: 'OBSERVED' | 'VOID';
}
export interface GrantSettlementSource extends GrantObject {
  sha256: string;
  bytes: number;
  filename: string;
  kind: string;
  runId: string;
  reportSha256: string;
}
export interface GrantSettlementRow extends GrantObject {
  rowId: string;
  eventId: string;
  kind: 'PAYMENT' | 'REFUND';
  original: GrantObject;
  transfer: GrantSettlementTransfer | null;
  canRecordCash: boolean;
  issues: string[];
  sourceTime: string | null;
  sourceTimeBasis: string;
}
export interface GrantSettlementEffect extends GrantObject {
  rowId: string;
  decision: string;
  cash: GrantSettlementCashValue | null;
  cashId: string | null;
  existingCashId: string | null;
  /** Prior link retained when a reporting edition adopts existing replacement cash. */
  previousCashId?: string | null;
  replacedCashId: string | null;
  voidedCashId: string | null;
  deploymentIds: string[];
  workIds: string[];
  findings: unknown[];
}
export interface GrantSettlementReviewedSelection extends GrantSettlementAttribution {
  decision: 'RECORD_CASH' | 'LINK_CASH' | 'OBSERVE' | 'OMIT';
  cashId: string | null;
  cash: GrantSettlementUnits | GrantSettlementCashInput | null;
}
export interface GrantSettlementProposal extends GrantObject {
  name: string;
  selections: GrantSettlementReviewedSelection[];
  effects: GrantSettlementEffect[];
  counts: GrantObject;
  canApply: boolean;
}
export interface GrantSettlementPreview extends GrantObject {
  schema: string;
  caseId: string;
  version: number;
  source: GrantSettlementSource;
  reader: GrantObject;
  counts: GrantObject;
  rows: GrantSettlementRow[];
  units: GrantObject[];
  deployments: GrantObject[];
  work: GrantObject[];
  cash: GrantSettlementCashRecord[];
  retainedReviews: GrantObject[];
  previewSha256: string;
  html: string;
  /** Present only when both the complete name and selections were supplied. */
  proposed?: GrantSettlementProposal;
}
export interface GrantSettlementReceiveInput extends GrantOperationRequest, GrantSettlementReviewInput {
  filename: string;
  expectedPreviewSha256: string;
}
export interface GrantSettlementReview extends GrantObject {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  actor: string;
  sourceSha256: string;
  sourceId: string;
  counts: GrantObject;
  previousReviewId?: string | null;
}
export interface GrantSettlementList extends GrantObject {
  caseId: string;
  version: number;
  items: GrantSettlementReview[];
}
export interface GrantSettlementSavedRow extends GrantSettlementRow {
  decision: 'UNSELECTED' | 'RECORD_CASH' | 'LINK_CASH' | 'OBSERVE' | 'OMIT' | 'CORRECT_CASH' | 'VOID_CASH' | 'RELINK';
  reason: string;
  cashId: string | null;
  /** Exact reviewed unit/valuation input, separate from the current cash record. */
  cash: GrantSettlementUnits | GrantSettlementCashInput | null;
  deploymentIds: string[];
  workIds: string[];
}
export interface GrantSettlementSaved extends GrantObject {
  review: GrantSettlementReview;
  source: GrantSettlementSource;
  rows: GrantSettlementSavedRow[];
  currentCash: GrantSettlementCashRecord[];
  history: GrantSettlementReview[];
  downloadSourceId: string;
  inspectionSourceId: string;
}
export type GrantSettlementCorrectionInput = {
  reviewId: string;
  rowId: string;
  expectedCashId: string | null;
  reason: string;
  deploymentIds?: string[];
  workIds?: string[];
} & (
  | { decision: 'CORRECT_CASH'; cash: GrantSettlementCashInput; cashId?: never }
  | { decision: 'LINK_CASH'; cashId: string; cash: GrantSettlementUnits }
  | { decision: 'VOID_CASH' | 'RELINK'; cash?: never; cashId?: never }
);
export type GrantSettlementCorrectionPreviewInput = GrantSettlementCorrectionInput & { expectedVersion: number };
export type GrantSettlementCorrectInput = GrantSettlementCorrectionInput & GrantOperationRequest & { expectedPreviewSha256: string };
export interface GrantSettlementCorrectionPreview extends GrantObject {
  caseId: string;
  version: number;
  source: GrantSettlementSource;
  review: GrantSettlementReview;
  row: GrantObject & { rowId: string; cashId: string | null; transfer: GrantSettlementTransfer | null };
  proposed: { selection: GrantObject & { reviewId: string; rowId: string; expectedCashId: string | null; decision: 'CORRECT_CASH' | 'LINK_CASH' | 'VOID_CASH' | 'RELINK'; reason: string; cashId?: string | null; cash: GrantSettlementCashInput | GrantSettlementUnits | null; deploymentIds: string[]; workIds: string[] }; effects: GrantSettlementEffect[]; counts: GrantObject; canApply: boolean };
  previewSha256: string;
}
export interface GrantSettlementSaveReceipt extends GrantObject {
  id: string;
  version: number;
  action: 'settlement.receive' | 'settlement.correct';
  reviewId: string;
  sourceId: string;
  sourceSha256: string;
  cashIds: string[];
  unchanged: boolean;
}

export interface GrantReadSelection {
  intakeId?: string;
  planId?: string;
  caseId?: string;
  forecastId?: string;
  portfolioId?: string;
  reviewId?: string;
  revision?: number;
  after?: number;
  limit?: number;
  asOfDate?: GrantCivilDate;
}
export type GrantOtherReadView =
  | 'plans' | 'plan' | 'plan-history' | 'cases' | 'case-report' | 'case-history' | 'expenses'
  | 'forecasts' | 'forecast' | 'portfolios' | 'portfolio' | 'review' | 'completion';
/** One exact saved native check attributed to an original tranche work package. */
export interface CompletionInstallationSelection {
  costId: string;
  installationId: string;
  revision: number;
  sha256: string;
  checkId: string;
  requirePaidPurchase: boolean;
}
export type GrantCompletionInstallationSelection = CompletionInstallationSelection;
export interface GrantCompletionAssignment {
  costId: string;
  ownerIds: string[];
  startDate: GrantCivilDate | null;
  endDate: GrantCivilDate | null;
  state: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETE';
  completedOn: GrantCivilDate | null;
  workIds: string[];
  deploymentIds: string[];
  sourceIds: string[];
  note: string;
  completionNote: string;
}
/** Complete original assignments; selected evidence does not mark a package complete. */
export interface GrantCompletionInputs extends GrantObject {
  tranche: 1 | 2 | 3;
  items: GrantCompletionAssignment[];
  note: string;
  installationSelections?: CompletionInstallationSelection[];
}
export type CompletionInputs = GrantCompletionInputs;
export interface GrantCompletionInstallationEvidence {
  schema: 'stellar-forge.sf47-completion-installations.v1';
  selections: CompletionInstallationSelection[];
  /** Full immutable native editions, excluding their current display metadata. */
  installations: Array<Omit<GrantInstallationEdition, 'current'>>;
  sha256: string;
}
export interface GrantCompletionInstallationReport {
  schema: 'stellar-forge.sf47-completion-installations.v1';
  evidence: GrantCompletionInstallationEvidence;
  asOfDate: GrantCivilDate;
  rows: Array<{
    selection: CompletionInstallationSelection;
    installationName: string;
    check: GrantInstallationCheck;
    sourceIds: string[];
    /** Complete original native purchase observations, retaining decimal strings. */
    purchases: GrantObject[];
    usefulPaidPurchaseIds: string[];
    currentEdition: GrantInstallationRef | null;
  }>;
  summary: {
    selectedChecks: number;
    acceptedChecks: number;
    notApplicableChecks: number;
    distinctUsefulPaidPurchases: number;
    purchaseObservations: GrantObject[];
    /** Observations do not imply independent adoption or issuer acceptance. */
    meaning: string;
  };
  issues: Array<{code: string; costId: string; installationId: string; checkId: string; message: string}>;
  ready: boolean;
}
export interface GrantCompletionInstallationCatalogue {
  schema: 'stellar-forge.sf47-completion-installations.v1';
  caseId: string;
  version: number;
  tranche: 1 | 2 | 3;
  installations: Array<GrantInstallationRef & {
    name: string; stage: GrantInstallationStage; costIds: string[]; checks: GrantInstallationCheck[];
  }>;
}
export interface GrantCompletionInstallationTransfer {
  schema: 'stellar-forge.sf47-completion-installations.v1';
  source: {caseId: string; version: number; planContentSha256: string};
  originalInputs: GrantCompletionInputs;
  proposedInputs: GrantCompletionInputs;
  suggestions: Array<{
    costId: string;
    completedOn: GrantCivilDate | null;
    completionNote: string;
    acceptanceRecorded: boolean;
    excludedLinks: Array<{kind: 'work' | 'deployment'; id: string; reason: string}>;
    meaning: string;
  }>;
  report: GrantCompletionInstallationReport;
  previewSha256: string;
}

/** A saved correction assessment is not an issuer acceptance or a deadline extension. */
export type GrantCompletionCorrectionState = 'OPEN' | 'IN_PROGRESS' | 'ADDRESSED' | 'NOT_APPLICABLE';
export interface GrantCompletionCorrectionFinding {
  id: string;
  request: string;
  basis: string;
  costIds: string[];
  ownerIds: string[];
  state: GrantCompletionCorrectionState;
  dueOn: GrantCivilDate | null;
  completedOn: GrantCivilDate | null;
  response: string;
  workIds: string[];
  deploymentIds: string[];
  sourceIds: string[];
}
export interface GrantCompletionCorrectionInputs {
  roundId: string;
  previousReviewId: string | null;
  outcomeId: string;
  expectedOutcomeSha256: string;
  document: {title: string; findings: GrantCompletionCorrectionFinding[]; note: string};
}
export interface GrantCompletionCorrectionsSeed extends GrantObject {
  schema: 'stellar-forge.sf47-completion-corrections.v1';
  caseId: string;
  caseVersion: number;
  /** A new seed has an empty findings list; enter the actual findings before preview/save. */
  inputs: GrantCompletionCorrectionInputs;
  sourceOutcome: GrantObject;
  originalPreparation: GrantObject;
  currentOutcome: GrantObject | null;
  currentHeadReviewId: string | null;
  packages: GrantObject[];
}
export interface GrantCompletionCorrectionsPreview extends GrantObject {
  schema: 'stellar-forge.sf47-completion-corrections.v1';
  caseId: string;
  caseVersion: number;
  sourceSha256: string;
  asOfDate: GrantCivilDate;
  revision: number;
  inputs: GrantCompletionCorrectionInputs;
  sourceOutcome: GrantObject;
  originalPreparation: GrantObject;
  report: {
    readyForPreparation: boolean;
    sourceCurrent: boolean;
    issues: {code: string; findingId: string | null; costId: string | null; message: string}[];
    comparison: GrantObject;
    findingCount: number;
    addressed: number;
    notApplicable: number;
  };
  previewSha256: string;
}
export type GrantCompletionCorrectionsSaveInput = GrantOperationRequest & {
  inputs: GrantCompletionCorrectionInputs;
  asOfDate: GrantCivilDate;
  expectedPreviewSha256: string;
};
export interface GrantCompletionCorrectionsReceipt extends GrantObject {
  id: string;
  version: number;
  action: 'completion.corrections.save';
  kind: 'review';
  recordId: string;
  roundId: string;
  revision: number;
  previewSha256: string;
  unchanged: false;
}
export interface GrantCompletionCorrectionsReview extends GrantObject {
  id: string;
  version: number;
  createdAt: string;
  actor: string;
  note: string;
  businessSha256: string;
  purpose: 'TRANCHE_CORRECTIONS';
  snapshot: GrantObject;
  report: GrantObject;
  corrections: GrantCompletionCorrectionsPreview;
}
/** Select the current saved correction edition explicitly for re-preparation. */
export interface GrantCompletionPreviewInput extends GrantObject {
  receiptId: string;
  asOfDate?: GrantCivilDate;
  summary: string;
  cohortReviewIds?: string[];
  implementationReviewIds?: string[];
  correctionReviewId?: string;
}

/** Exact immutable editions selected from the original risk register list. */
export interface GrantRiskComparisonSelection {
  caseId: string;
  beforeReviewId: string;
  beforeReviewSha256: string;
  afterReviewId: string;
  afterReviewSha256: string;
}
/** Non-ZIP exports reject a supplied case-version condition. */
export interface GrantRiskComparisonExportSelection extends GrantRiskComparisonSelection {
  expectedComparisonSha256: string;
  expectedVersion?: never;
}
/** Full case export also binds the current case version observed by the read. */
export interface GrantRiskComparisonZipSelection extends GrantRiskComparisonSelection {
  expectedComparisonSha256: string;
  expectedVersion: number;
}
export type GrantRiskComparisonChange = 'ADDED' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';
export type GrantRiskComparisonSide =
  | { present: false; value: null }
  | { present: true; value: unknown };
export interface GrantRiskComparisonField {
  path: string;
  before: GrantRiskComparisonSide;
  after: GrantRiskComparisonSide;
}
export interface GrantRiskComparisonRiskRow {
  id: string;
  change: GrantRiskComparisonChange;
  before: GrantRiskRecord | null;
  after: GrantRiskRecord | null;
  fields: GrantRiskComparisonField[];
  reportBefore: GrantRiskReportEntry | null;
  reportAfter: GrantRiskReportEntry | null;
  reportFields: GrantRiskComparisonField[];
  /** Linked saved plan/contributor/package/source changes, independent of reportFields. */
  contextChanged: boolean;
}
export interface GrantRiskComparisonActionRow {
  id: string;
  riskId: string;
  change: GrantRiskComparisonChange;
  before: GrantRiskAction | null;
  after: GrantRiskAction | null;
  fields: GrantRiskComparisonField[];
  reportBefore: GrantRiskReportEntry['actions'][number] | null;
  reportAfter: GrantRiskReportEntry['actions'][number] | null;
  reportFields: GrantRiskComparisonField[];
  contextChanged: boolean;
}
export interface GrantRiskComparisonContextRow {
  kind: 'SOURCE_IDENTITY' | 'PLAN' | 'CONTRIBUTOR' | 'PACKAGE' | 'SOURCE';
  id: string;
  change: GrantRiskComparisonChange;
  before: unknown;
  after: unknown;
  fields: GrantRiskComparisonField[];
}
export interface GrantRiskComparison {
  schema: 'stellar-forge.sf47-delivery-risk-comparison.v1';
  engineVersion: 1;
  selection: Omit<GrantRiskComparisonSelection, 'caseId'>;
  direction: 'SAME_EDITION' | 'FORWARD' | 'REVERSE';
  before: GrantRiskSummary;
  after: GrantRiskSummary;
  originals: { before: GrantRiskReview; after: GrantRiskReview };
  registerFields: GrantRiskComparisonField[];
  counts: { name: string; before: number; after: number; delta: number }[];
  riskRows: GrantRiskComparisonRiskRow[];
  actionRows: GrantRiskComparisonActionRow[];
  contextRows: GrantRiskComparisonContextRow[];
  notice: string;
  /** Authoritative native Python canonical digest; never substitute JS reserialization. */
  comparisonSha256: string;
}
export interface GrantRiskComparisonView {
  comparison: GrantRiskComparison;
  /** Current case identity stays outside the immutable comparison digest. */
  current: { programId: string; version: number };
}

export interface GrantDownloadSelections {
  'work-billing': {caseId:string;chargeId:string};
  'expense-billing': {caseId:string;chargeId:string};
  'risk-comparison': GrantRiskComparisonZipSelection;
  'risk-comparison-json': GrantRiskComparisonExportSelection;
  'risk-comparison-report': GrantRiskComparisonExportSelection;
  'risk-comparison-risks': GrantRiskComparisonExportSelection;
  'risk-comparison-actions': GrantRiskComparisonExportSelection;
  'risk-comparison-context': GrantRiskComparisonExportSelection;
  'forecast-comparison': GrantForecastComparisonExportSelection;
  'forecast-comparison-report': GrantForecastComparisonExportSelection;
  'forecast-comparison-json': GrantForecastComparisonExportSelection;
  'forecast-comparison-changes': GrantForecastComparisonExportSelection;
  'forecast-comparison-impact': GrantForecastComparisonExportSelection;
  'forecast-comparison-daily': GrantForecastComparisonExportSelection;
  'forecast-comparison-work': GrantForecastComparisonExportSelection;
  plan: { planId: string; revision?: number };
  'plan-comparison': GrantPlanComparisonExportSelection;
  'plan-comparison-report': GrantPlanComparisonExportSelection;
  'plan-comparison-changes': GrantPlanComparisonExportSelection;
  'plan-comparison-impact': GrantPlanComparisonExportSelection;
  'plan-comparison-daily': GrantPlanComparisonExportSelection;
  scenario: { planId: string };
  'daily-csv': { planId: string };
  'costs-csv': { planId: string };
  case: { caseId: string };
  'expense-attributions': { caseId: string };
  'expense-sources': { caseId: string };
  'expense-html': { caseId: string };
  'task-outcomes': {caseId: string; comparisonId: string; revision: number; expectedVersion: number};
  'cost-funding': {caseId: string; revision: number; expectedVersion: number; expectedReportSha256: string};
  forecast: { caseId: string; forecastId: string };
  portfolio: { caseId: string; portfolioId: string };
  'delivery-queue': GrantDeliveryQueueSelection;
  'delivery-calendar': GrantDeliveryCalendarDownloadSelection;
  'delivery-agenda': GrantDeliveryAgendaDownloadSelection;
  'customer-use-calendar': GrantCustomerUseDownloadSelection;
  performance: GrantPerformanceDownloadSelection;
  'supplier-account': GrantSupplierAccountDownloadSelection;
  'cash-account': GrantCashAccountDownloadSelection;
  'account-reconciliation': GrantAccountReconciliationDownloadSelection;
  installation: { caseId: string; installationId: string; revision: number };
  'installation-return': { caseId: string; reviewId: string };
  commercial: { caseId: string; billingId: string };
  'commercial-change': {caseId:string;changeId:string};
  source: { caseId: string; sourceId: string };
  settlement: { caseId: string; reviewId: string };
  completion: { caseId: string; reviewId: string };
  'completion-corrections': { caseId: string; reviewId: string };
  cohort: { caseId: string; reviewId: string };
  engagement: { caseId: string; reviewId: string };
  'risk-register': { caseId: string; reviewId: string };
  implementation: { caseId: string; reviewId: string };
  'implementation-original': { caseId: string; sourceId: string; sha256: string };
}

export function inspectGrantAgentBinding(input: GrantBindingInput): Promise<GrantBinding>;
export function readGrantAgentFile(filename: string, maximum?: number, privateOnly?: boolean): Promise<Buffer>;

export class GrantWorkspaceClient {
  /** Complete original Source Desk lifecycle using this client's existing owner and drain. */
  installationSources<K extends keyof InstallationSourceInputs>(action:K,input:InstallationSourceInputs[K]):Promise<InstallationSourceResponses[K]>;
  constructor(binding: GrantBinding);
  workbook(action: 'inspect', input: GrantWorkbookInspectionInput): Promise<GrantJsonResponse<GrantWorkbookInspection>>;
  workbook(action: 'project', input: GrantWorkbookProjectionInput): Promise<GrantJsonResponse<GrantWorkbookSelection>>;
  planningSources<K extends keyof GrantPlanningSourceInputs>(action: K, input: GrantPlanningSourceInputs[K]): Promise<GrantPlanningSourceResponses[K]>;
  readonly summary: GrantClientSummary;
  inspect(): Promise<GrantInspection>;
  open(selection?: { expectedSelectionSha256?: string }): Promise<GrantInspection>;
  browser(): Promise<{ schema: typeof GRANT_AGENT_SCHEMA; url: string; original: GrantObject }>;
  read(view: 'task-outcomes', selection: {caseId: string}): Promise<GrantJsonResponse<{comparisons: GrantTaskOutcomeSummary[]}>>;
  read(view: 'task-outcome', selection: {caseId: string; comparisonId: string; revision?: number}): Promise<GrantJsonResponse<GrantTaskOutcomeView>>;
  read(view: 'forecast-comparison', selection: GrantForecastComparisonSelection): Promise<GrantJsonResponse<GrantForecastComparison>>;
  read(view: 'plan-comparison', selection: GrantPlanComparisonSelection): Promise<GrantJsonResponse<GrantPlanComparison>>;
  read(view: 'amendments', selection: { caseId: string }): Promise<GrantJsonResponse<GrantObject>>;
  read(view: 'amendment', selection: { caseId: string; amendmentId: string; revision?: number }): Promise<GrantJsonResponse<{ amendment: GrantAmendmentEdition; current: GrantObject; history: GrantObject[]; calendarImpact: GrantAmendmentCalendar }>>;
  read(view: 'ledger-intake', selection: { caseId: string }): Promise<GrantJsonResponse<GrantLedgerContract>>;
  read(view: 'ledger-intake-original', selection: { caseId: string; sourceId: string }): Promise<GrantJsonResponse<GrantLedgerOriginal>>;
  read(view: 'work-intakes', selection: {caseId: string}): Promise<GrantJsonResponse<{intakes: GrantWorkIntakeSummary[]}>>;
  read(view: 'work-intake', selection: {caseId: string; intakeId: string; revision?: number}): Promise<GrantJsonResponse<GrantWorkIntakeView>>;
  read(view: 'performance', selection: GrantPerformanceSelection): Promise<GrantJsonResponse<GrantPerformanceReport>>;
  read(view: 'supplier-account', selection: GrantSupplierAccountSelection): Promise<GrantJsonResponse<GrantSupplierAccountReport>>;
  read(view: 'cash-account', selection: GrantCashAccountSelection): Promise<GrantJsonResponse<GrantCashAccountReport>>;
  read(view: 'account-reconciliation', selection: GrantAccountReconciliationSelection): Promise<GrantJsonResponse<GrantAccountReconciliationReport>>;
  read(view: 'account-reconciliation-statement-inputs', selection: {caseId: string; sourceId: string}): Promise<GrantJsonResponse<GrantAccountReconciliationStatementInputs>>;
  read(view: 'delivery-calendar', selection: GrantDeliveryCalendarSelection): Promise<GrantJsonResponse<GrantDeliveryCalendar>>;
  read(view: 'delivery-agenda', selection: GrantDeliveryAgendaSelection): Promise<GrantJsonResponse<GrantDeliveryAgenda>>;
  read(view: 'delivery-queue', selection: GrantDeliveryQueueSelection): Promise<GrantJsonResponse<GrantDeliveryQueue>>;
  read(view: 'case', selection: { caseId: string }): Promise<GrantJsonResponse<GrantCaseView>>;
  read(view: 'operating-workflows', selection: {caseId: string; expectedVersion: number}): Promise<GrantJsonResponse<GrantOperatingWorkflows>>;
  read(view: 'settlements', selection: { caseId: string }): Promise<GrantJsonResponse<GrantSettlementList>>;
  read(view: 'settlement', selection: { caseId: string; reviewId: string }): Promise<GrantJsonResponse<GrantSettlementSaved>>;
  read(view: 'expenses', selection: { caseId: string }): Promise<GrantJsonResponse<GrantExpenseDashboard>>;
  read(view: 'installations', selection: { caseId: string }): Promise<GrantJsonResponse<{ installations: GrantObject[] }>>;
  read(view: 'installation', selection: { caseId: string; installationId: string; revision?: number }): Promise<GrantJsonResponse<GrantInstallationEdition>>;
  read(view: 'installation-history', selection: { caseId: string; installationId: string; before?: number; limit?: number }): Promise<GrantJsonResponse<{ editions: GrantObject[]; nextBefore: number | null }>>;
  read(view: 'risk-comparison', selection: GrantRiskComparisonSelection): Promise<GrantJsonResponse<GrantRiskComparisonView>>;
  read(view: 'risks', selection: { caseId: string }): Promise<GrantJsonResponse<GrantRiskList>>;
  read(view: 'risk-register', selection: { caseId: string; reviewId: string }): Promise<GrantJsonResponse<GrantRiskRegister>>;
  read(view: 'risk-history', selection: { caseId: string; riskId: string }): Promise<GrantJsonResponse<GrantRiskHistory>>;
  read(view: 'engagements', selection: { caseId: string }): Promise<GrantJsonResponse<GrantEngagementList>>;
  read(view: 'engagement', selection: { caseId: string; reviewId: string }): Promise<GrantJsonResponse<GrantEngagementBook>>;
  read(view: 'forecast', selection: { caseId: string; forecastId: string }): Promise<GrantJsonResponse<GrantSavedForecast>>;
  read(view: 'portfolio', selection: { caseId: string; portfolioId: string }): Promise<GrantJsonResponse<GrantSavedPortfolio>>;
  read<T = GrantObject>(view: GrantOtherReadView, selection?: GrantReadSelection): Promise<GrantJsonResponse<T>>;
  plan<T = GrantObject>(action: 'estimate' | 'save' | 'restore' | 'clone', planId: string, body: GrantObject): Promise<GrantJsonResponse<T>>;
  createCase<T = GrantObject>(body: { planId: string; selectedRevision: number; expectedContentSha256: string; name: string; mode: 'OPERATIONS' | 'WALKTHROUGH'; calendarStart?: GrantCivilDate; actor: string; requestId: string }): Promise<GrantJsonResponse<T>>;
  command<T = GrantObject>(caseId: string, body: GrantOperationRequest & { action: GrantCaseAction; data: GrantObject }): Promise<GrantJsonResponse<T>>;
  workIntakePreview(caseId: string, body: {expectedVersion: number; intakeId: string; revision?: number; document?: GrantWorkIntakeDocument}): Promise<GrantJsonResponse<GrantWorkIntakePreview>>;
  workIntakeUpload(caseId: string, body: GrantWorkIntakeUpload): Promise<GrantJsonResponse<GrantObject>>;
  workIntakeSave(caseId: string, body: GrantWorkIntakeWrite): Promise<GrantJsonResponse<GrantObject>>;
  workIntakeApply(caseId: string, body: GrantWorkIntakeWrite & {expectedPreviewSha256: string}): Promise<GrantJsonResponse<GrantObject>>;
  statementInspect(caseId: string, expectedVersion: number, inputs: GrantStatementInspectionInput): Promise<GrantJsonResponse<GrantStatementInspection>>;
  statementPreview(caseId: string, expectedVersion: number, inputs: GrantStatementInput): Promise<GrantJsonResponse<GrantStatementPreview>>;
  statementReceive(caseId: string, body: GrantOperationRequest & { inputs: GrantStatementInput; expectedPreviewSha256: string }): Promise<GrantJsonResponse<GrantStatementReceipt>>;
  statementSetupSave(caseId: string, body: GrantStatementSetupWrite): Promise<GrantJsonResponse<GrantStatementSetupReceipt>>;
  operatingWorkflows(caseId: string, expectedVersion: number): Promise<GrantJsonResponse<GrantOperatingWorkflows>>;
  accountReconciliationPreview(caseId: string, body: GrantAccountReconciliationInput): Promise<GrantJsonResponse<GrantAccountReconciliationPreview>>;
  accountReconciliationApply(caseId: string, body: GrantAccountReconciliationApplyInput): Promise<GrantJsonResponse<GrantAccountReconciliationReceipt>>;
  cashCorrectionPreview(caseId: string, body: GrantCashCorrectionInput): Promise<GrantJsonResponse<GrantCashCorrectionPreview>>;
  cashCorrectionApply(caseId: string, body: GrantCashCorrectionApplyInput): Promise<GrantJsonResponse<GrantCashCorrectionReceipt>>;
  ledgerIntakeInspect(caseId: string, file: GrantLedgerFile): Promise<GrantJsonResponse<GrantLedgerInspection>>;
  ledgerIntakePreview(caseId: string, body: GrantLedgerPreviewInput): Promise<GrantJsonResponse<GrantLedgerPreview>>;
  ledgerIntakeApply(caseId: string, body: GrantLedgerApplyInput): Promise<GrantJsonResponse<GrantLedgerReceipt>>;
  amendmentCalendarExport(caseId: string, selection: GrantAmendmentCalendarExportSelection): Promise<GrantNativeResponse>;
  amendmentPreview<T = GrantAmendmentPreview>(caseId: string, expectedVersion: number, inputs: GrantAmendmentInputs): Promise<GrantJsonResponse<T>>;
  forecastPreview<T = GrantForecastPreview>(caseId: string, expectedVersion: number, inputs: GrantObject): Promise<GrantJsonResponse<T>>;
  forecastSave<T = GrantForecastSaveReceipt>(caseId: string, body: GrantModelSaveInput): Promise<GrantJsonResponse<T>>;
  portfolioSeed<T = GrantPortfolioSeed>(caseId: string, expectedVersion: number, forecastId: string, options?: GrantPortfolioSeedOptions): Promise<GrantJsonResponse<T>>;
  portfolioPreview<T = GrantPortfolioPreview>(caseId: string, expectedVersion: number, inputs: GrantObject): Promise<GrantJsonResponse<T>>;
  portfolioSave<T = GrantPortfolioSaveReceipt>(caseId: string, body: GrantModelSaveInput): Promise<GrantJsonResponse<T>>;
  portfolioSelection<T = GrantPortfolioSelection>(caseId: string, expectedVersion: number, portfolioId: string, alternativeId: string): Promise<GrantJsonResponse<T>>;
  read(view: 'cost-funding', selection: {caseId: string}): Promise<GrantJsonResponse<{catalog: GrantFundingCatalog; history: GrantFundingSummary[]}>>;
  read(view: 'funding-edition', selection: {caseId: string; revision?: number}): Promise<GrantJsonResponse<GrantFundingView>>;
  read(view: 'funding-request', selection: {caseId: string; requestId: string}): Promise<GrantJsonResponse<GrantFundingRequest>>;
  fundingSeed(caseId: string, body: {expectedVersion: number; revision?: number}): Promise<GrantJsonResponse<GrantFundingSeed>>;
  fundingPreview(caseId: string, body: {expectedVersion: number; inputs: GrantFundingInputs}): Promise<GrantJsonResponse<GrantFundingPreview>>;
  fundingSave(caseId: string, body: GrantFundingSaveInput): Promise<GrantJsonResponse<GrantFundingReceipt>>;
  riskSeed(caseId: string, body: { expectedVersion: number; reviewId?: string }): Promise<GrantJsonResponse<GrantRiskSeed>>;
  riskPreview(caseId: string, body: { expectedVersion: number; document: GrantRiskDocument }): Promise<GrantJsonResponse<GrantRiskPreview>>;
  riskSave(caseId: string, body: GrantRiskSaveInput): Promise<GrantJsonResponse<GrantRiskSaveReceipt>>;
  riskRequest(caseId: string, body: { command: GrantRiskSaveCommand }): Promise<GrantJsonResponse<GrantRiskRequest>>;
  taskOutcomesSeed(caseId: string, expectedVersion: number): Promise<GrantJsonResponse<{inputs: GrantTaskOutcomeInputs; case: {id: string; version: number}}>>;
  taskOutcomesPreview(caseId: string, body: {expectedVersion: number; inputs: GrantTaskOutcomeInputs}): Promise<GrantJsonResponse<GrantTaskOutcomePreview>>;
  taskOutcomesSave(caseId: string, body: GrantTaskOutcomeSaveInput): Promise<GrantJsonResponse<GrantTaskOutcomeReceipt>>;
  read(view: 'installation-returns', selection: {caseId:string}): Promise<GrantJsonResponse<{schema:string;caseId:string;version:number;reviews:GrantInstallationReturnSummary[]}>>;
  installationReturnSeed(caseId:string, body:{expectedVersion:number;installationId:string;revision:number;sha256:string}): Promise<GrantJsonResponse<GrantInstallationReturnSeed>>;
  installationReturnPreview(caseId:string, body:{expectedVersion:number;inputs:GrantInstallationReturnInput}): Promise<GrantJsonResponse<GrantInstallationReturnPreview>>;
  installationReturnReviewSeed(caseId:string, body:{expectedVersion:number;retainedReview:GrantInstallationReviewRef}): Promise<GrantJsonResponse<GrantInstallationReturnOwnerSeed>>;
  installationReturnReviewPreview(caseId:string, body:{expectedVersion:number;inputs:GrantInstallationReturnOwnerInput}): Promise<GrantJsonResponse<GrantInstallationReturnOwnerPreview>>;
  installationReturn(caseId:string, body:GrantInstallationReturnSave<GrantInstallationReturnInput>): Promise<GrantJsonResponse<GrantInstallationReturnReceipt>>;
  installationReturnStage(caseId:string, body:GrantInstallationReturnSave<GrantInstallationReturnOwnerInput>): Promise<GrantJsonResponse<GrantInstallationReturnStageReceipt>>;
  engagementSeed(caseId: string, expectedVersion: number, reviewId?: string): Promise<GrantJsonResponse<GrantEngagementSeed>>;
  engagementPreview(caseId: string, expectedVersion: number, document: GrantEngagementDocument): Promise<GrantJsonResponse<GrantEngagementPreview>>;
  engagementPrepare(caseId: string, body: GrantEngagementPrepareInput): Promise<GrantJsonResponse<GrantEngagementPrepareReceipt>>;
  engagementForecast(caseId: string, expectedVersion: number, selection: GrantEngagementForecastSelection): Promise<GrantJsonResponse<GrantEngagementForecastPreview>>;
  engagementPortfolio(caseId: string, expectedVersion: number, selection: GrantEngagementPortfolioSelection): Promise<GrantJsonResponse<GrantEngagementPortfolioPreview>>;
  engagementReceiving(caseId: string, body: GrantEngagementReceivingInput): Promise<GrantJsonResponse<GrantEngagementReceivingReceipt>>;
  customerUseCalendar(caseId: string, body: GrantCustomerUseSelection): Promise<GrantJsonResponse<GrantCustomerUseCalendar>>;
  customerUseCalendarExpand(caseId: string, body: GrantCustomerUseExpansionInput): Promise<GrantJsonResponse<GrantCustomerUseExpansion>>;
  customerUseCalendarCohort(caseId: string, body: GrantCustomerUseCohortSelection): Promise<GrantJsonResponse<GrantCustomerUseCohortInput>>;
  installationSeed(caseId: string, expectedVersion: number): Promise<GrantJsonResponse<GrantInstallationSeed>>;
  installationCommercial<T = GrantObject>(caseId: string, body: GrantCommercialSourceSelection): Promise<GrantJsonResponse<T>>;
  installationCommercialSeed(caseId: string, body: GrantCommercialInstallationInput): Promise<GrantJsonResponse<GrantCommercialInstallationReview>>;
  installationWorkshares<T = GrantObject>(caseId: string, body: GrantWorkshareSourceSelection): Promise<GrantJsonResponse<T>>;
  installationWorkshareSeed(caseId: string, body: GrantWorkshareSourceSelection & GrantInstallationSelection & { workshareCaseId: string; document?: GrantInstallationDocument }): Promise<GrantJsonResponse<GrantInstallationSeed>>;
  installationWorkflows<T = GrantObject>(caseId: string, body: GrantWorkflowSourceSelection): Promise<GrantJsonResponse<T>>;
  installationWorkflowSeed(caseId: string, body: GrantWorkflowSourceSelection & GrantInstallationSelection & { cycleIds: string[]; document?: GrantInstallationDocument }): Promise<GrantJsonResponse<GrantInstallationSeed>>;
  installationCommissioningSeed(caseId: string, body: GrantInstallationPreviewInput): Promise<GrantJsonResponse<GrantCommissioningPreparation>>;
  installationCommissioningReview(caseId: string, body: GrantCommissioningReviewInput): Promise<GrantJsonResponse<GrantCommissioningPreparation>>;
  installationEffortSeed(caseId: string, body: GrantInstallationEffortSeedInput): Promise<GrantJsonResponse<GrantInstallationEffortSeed>>;
  installationEffortSelection(caseId: string, body: GrantInstallationEffortSelectionInput): Promise<GrantJsonResponse<GrantInstallationEffortSelection>>;
  installationPreview(caseId: string, body: GrantInstallationPreviewInput): Promise<GrantJsonResponse<GrantInstallationPreview>>;
  installationSave(caseId: string, body: GrantInstallationSaveInput): Promise<GrantJsonResponse<GrantInstallationSaveReceipt>>;

  workBillingCatalog(caseId:string):Promise<GrantJsonResponse<GrantWorkBillingCatalog>>;
  workBillingAuthority(caseId:string,authorityId:string):Promise<GrantJsonResponse<GrantHourlyAuthority>>;
  /** Save/replay the same original customer authorization, complete sources and request body. */
  workBillingSaveAuthority(caseId:string,body:GrantHourlyAuthorityInput):Promise<GrantJsonResponse<GrantHourlyAuthority>>;
  workBilling(caseId:string,chargeId:string):Promise<GrantJsonResponse<GrantWorkBillingCharge>>;
  workBillingPreview(caseId:string,body:GrantWorkBillingInput):Promise<GrantJsonResponse<GrantWorkBillingPreview>>;
  workBillingPrepare(caseId:string,body:GrantWorkBillingPrepareInput):Promise<GrantJsonResponse<GrantWorkBillingCharge>>;
  /** Resume the original native requests after response loss; no replacement preparation. */
  workBillingApply(caseId:string,chargeId:string,body:GrantWorkBillingApplyInput):Promise<GrantJsonResponse<GrantWorkBillingCharge>>;
  workBillingCancel(caseId:string,chargeId:string,body:GrantWorkBillingCancelInput):Promise<GrantJsonResponse<GrantWorkBillingCharge>>;
  workBillingPreviewIssue(caseId:string,chargeId:string):Promise<GrantJsonResponse<GrantWorkBillingIssuePreview>>;
  workBillingIssue(caseId:string,chargeId:string,body:GrantWorkBillingIssueInput):Promise<GrantJsonResponse<GrantWorkBillingCharge>>;
  workBillingRefresh(caseId:string,chargeId:string):Promise<GrantJsonResponse<GrantWorkBillingCharge>>;
  expenseBillingCatalog(caseId:string):Promise<GrantJsonResponse<GrantExpenseBillingCatalog>>;
  expenseBilling(caseId:string,chargeId:string):Promise<GrantJsonResponse<GrantExpenseBillingCharge>>;
  expenseBillingPreview(caseId:string,body:GrantExpenseBillingInput):Promise<GrantJsonResponse<GrantExpenseBillingPreview>>;
  /** Persist the original reviewed preparation. Retry only the same complete body and requestId. */
  expenseBillingPrepare(caseId:string,body:GrantExpenseBillingPrepareInput):Promise<GrantJsonResponse<GrantExpenseBillingCharge>>;
  /** Resume the same immutable native commands after response loss; no client-generated request replacement. */
  expenseBillingApply(caseId:string,chargeId:string,body:GrantExpenseBillingApplyInput):Promise<GrantJsonResponse<GrantExpenseBillingCharge>>;
  expenseBillingCancel(caseId:string,chargeId:string,body:GrantExpenseBillingCancelInput):Promise<GrantJsonResponse<GrantExpenseBillingCharge>>;
  expenseBillingPreviewIssue(caseId:string,chargeId:string):Promise<GrantJsonResponse<GrantExpenseBillingIssuePreview>>;
  /** Retain the original issue preview and credit decision on every retry. */
  expenseBillingIssue(caseId:string,chargeId:string,body:GrantExpenseBillingIssueInput):Promise<GrantJsonResponse<GrantExpenseBillingCharge>>;
  expenseBillingRefresh(caseId:string,chargeId:string):Promise<GrantJsonResponse<GrantExpenseBillingCharge>>;
  commercialChanges(caseId:string,billingId:string,milestoneId:string):Promise<GrantJsonResponse<GrantCommercialChanges>>;
  commercialChange(caseId:string,changeId:string):Promise<GrantJsonResponse<GrantCommercialChange>>;
  commercialChangePreview(caseId:string,billingId:string,milestoneId:string,body:GrantCommercialChangeInput):Promise<GrantJsonResponse<GrantCommercialChangePreview>>;
  commercialChangePrepare(caseId:string,billingId:string,milestoneId:string,body:GrantCommercialChangeInput & {requestId:string;expectedPreviewSha256:string}):Promise<GrantJsonResponse<GrantCommercialChange>>;
  commercialChangeApply(caseId:string,changeId:string,body:{actor:string;expectedProposalSha256:string}):Promise<GrantJsonResponse<GrantCommercialChange>>;
  commercialChangeCancel(caseId:string,changeId:string,body:{actor:string;expectedProposalSha256:string;requestId:string;reason:string}):Promise<GrantJsonResponse<GrantCommercialChange>>;
  commercialChangePreviewIssue(caseId:string,changeId:string):Promise<GrantJsonResponse<GrantCommercialChangeIssuePreview>>;
  commercialChangeIssue(caseId:string,changeId:string,body:{actor:string;expectedIssuePreviewSha256:string;expectedProposalSha256?:string;creditDecisionId?:string}):Promise<GrantJsonResponse<GrantCommercialChange>>;
  commercialChangeRefresh(caseId:string,changeId:string):Promise<GrantJsonResponse<GrantCommercialChange>>;
  commercialConnections(): Promise<GrantJsonResponse<GrantCommercialConnections>>;
  commercialConfigureConnection<T = GrantObject>(body: GrantCommercialConnectionInput): Promise<GrantJsonResponse<T>>;
  commercialCustomers(endpointId: string): Promise<GrantJsonResponse<GrantCommercialCustomers>>;
  commercialList(caseId: string): Promise<GrantJsonResponse<GrantCommercialList>>;
  commercialDetail(caseId: string, billingId: string): Promise<GrantJsonResponse<GrantCommercialPrepared>>;
  commercialSchedule(caseId: string, body: GrantCommercialScheduleInput): Promise<GrantJsonResponse<GrantCommercialSchedule>>;
  /** A new request may correct unbilled selections before a native command is retained. */
  commercialPrepare(caseId: string, body: GrantCommercialPrepareInput): Promise<GrantJsonResponse<GrantCommercialPrepared>>;
  /** Native request identity is retained once for each original obligation and action. */
  commercialDraft(caseId: string, billingId: string, milestoneId: string, body: { actor: string }): Promise<GrantJsonResponse<GrantCommercialCommandResult>>;
  commercialPreview(caseId: string, billingId: string, milestoneId: string): Promise<GrantJsonResponse<GrantCommercialIssuePreview>>;
  commercialIssue(caseId: string, billingId: string, milestoneId: string, body: { actor: string; expectedIssuePreviewSha256: string }): Promise<GrantJsonResponse<GrantCommercialCommandResult>>;
  commercialRefresh(caseId: string, billingId: string): Promise<GrantJsonResponse<GrantCommercialPrepared>>;
  cohortSeed<T = GrantObject>(caseId: string, expectedVersion: number, tranche: 2 | 3): Promise<GrantJsonResponse<T>>;
  cohortPreview<T = GrantObject>(caseId: string, expectedVersion: number, inputs: GrantObject): Promise<GrantJsonResponse<T>>;
  cohortPrepare<T = GrantObject>(caseId: string, body: GrantModelSaveInput): Promise<GrantJsonResponse<T>>;
  implementationSource<T = GrantObject>(caseId: string, expectedVersion: number, sourceId: string, asOfAt?: string): Promise<GrantJsonResponse<T>>;
  implementationPreview<T = GrantObject>(caseId: string, expectedVersion: number, inputs: GrantObject): Promise<GrantJsonResponse<T>>;
  implementationPrepare<T = GrantObject>(caseId: string, body: GrantModelSaveInput): Promise<GrantJsonResponse<T>>;
  completionCorrectionsSeed<T = GrantCompletionCorrectionsSeed>(caseId: string, expectedVersion: number, outcomeId: string, reviewId?: string): Promise<GrantJsonResponse<T>>;
  completionCorrectionsPreview<T = GrantCompletionCorrectionsPreview>(caseId: string, expectedVersion: number, inputs: GrantCompletionCorrectionInputs, asOfDate?: GrantCivilDate): Promise<GrantJsonResponse<T>>;
  completionCorrectionsSave<T = GrantCompletionCorrectionsReceipt>(caseId: string, body: GrantCompletionCorrectionsSaveInput): Promise<GrantJsonResponse<T>>;
  completionInstallations<T = GrantCompletionInstallationCatalogue>(caseId: string, body: {expectedVersion: number; tranche: 1 | 2 | 3}): Promise<GrantJsonResponse<T>>;
  completionInstallationsPreview<T = GrantCompletionInstallationTransfer>(caseId: string, body: {expectedVersion: number; inputs: GrantCompletionInputs; asOfDate?: GrantCivilDate}): Promise<GrantJsonResponse<T>>;
  completionSave<T = GrantObject>(caseId: string, body: GrantOperationRequest & {inputs: GrantCompletionInputs}): Promise<GrantJsonResponse<T>>;
  completionSeed<T = GrantObject>(caseId: string, expectedVersion: number, tranche: 1 | 2 | 3): Promise<GrantJsonResponse<T>>;
  completionPreview<T = GrantObject>(caseId: string, expectedVersion: number, inputs: GrantObject & {correctionReviewId?: string}): Promise<GrantJsonResponse<T>>;
  completionSave<T = GrantObject>(caseId: string, body: GrantOperationRequest & { inputs: GrantObject }): Promise<GrantJsonResponse<T>>;
  completionPrepare<T = GrantObject>(caseId: string, body: GrantOperationRequest & GrantObject & {correctionReviewId?: string}): Promise<GrantJsonResponse<T>>;
  completionExtension<T = GrantObject>(caseId: string, body: GrantOperationRequest & GrantObject): Promise<GrantJsonResponse<T>>;
  completionSubmit<T = GrantObject>(caseId: string, body: GrantOperationRequest & GrantObject): Promise<GrantJsonResponse<T>>;
  completionDecision<T = GrantObject>(caseId: string, body: GrantOperationRequest & GrantObject): Promise<GrantJsonResponse<T>>;
  settlementPreview(caseId: string, expectedVersion: number, bytes: Buffer, filename: string, selection?: GrantSettlementReviewInput): Promise<GrantJsonResponse<GrantSettlementPreview>>;
  settlementReceive(caseId: string, bytes: Buffer, body: GrantSettlementReceiveInput): Promise<GrantJsonResponse<GrantSettlementSaveReceipt>>;
  settlementCorrectionPreview(caseId: string, body: GrantSettlementCorrectionPreviewInput): Promise<GrantJsonResponse<GrantSettlementCorrectionPreview>>;
  settlementCorrect(caseId: string, body: GrantSettlementCorrectInput): Promise<GrantJsonResponse<GrantSettlementSaveReceipt>>;
  supportPreview<T = GrantObject>(caseId: string, expectedVersion: number, bytes: Buffer, filename: string): Promise<GrantJsonResponse<T>>;
  supportReceive<T = GrantObject>(caseId: string, bytes: Buffer, body: GrantOperationRequest & GrantObject): Promise<GrantJsonResponse<T>>;
  expensePreview(caseId: string, expectedVersion: number, bytes: Buffer, filename: string): Promise<GrantJsonResponse<GrantExpensePreview>>;
  expenseReceive(caseId: string, bytes: Buffer, body: GrantOperationRequest & { filename: string; expectedPreviewSha256: string }): Promise<GrantJsonResponse<GrantExpenseReceipt>>;
  expenseSave(caseId: string, body: GrantOperationRequest & { data: GrantExpenseAllocationInput }): Promise<GrantJsonResponse<GrantExpenseReceipt>>;
  expenseTransition(caseId: string, action: GrantExpenseTransition, body: GrantOperationRequest & { note: string; id: string; expectedContentSha256: string }): Promise<GrantJsonResponse<GrantExpenseReceipt>>;
  expenseRequest(caseId: string, body: GrantExpenseRequest): Promise<GrantJsonResponse<GrantExpenseRequestState>>;
  buyerPreview<T = GrantObject>(caseId: string, expectedVersion: number, bytes: Buffer, filename: string): Promise<GrantJsonResponse<T>>;
  buyerReceive<T = GrantObject>(caseId: string, bytes: Buffer, body: GrantOperationRequest & GrantObject): Promise<GrantJsonResponse<T>>;
  download<K extends keyof GrantDownloadSelections>(kind: K, selection: GrantDownloadSelections[K]): Promise<GrantNativeResponse>;
  importBundle(kind: 'case', bytes: Buffer, body: { name: string; requestId: string; actor: string }): Promise<GrantJsonResponse<GrantCaseImportReceipt>>;
  importBundle<T = GrantObject>(kind: 'plan', bytes: Buffer, body: { name: string; requestId: string; actor?: string }): Promise<GrantJsonResponse<T>>;
  importScenario<T = GrantObject>(bytes: Buffer, body: GrantObject): Promise<GrantJsonResponse<T>>;
  attach<T = GrantObject>(caseId: string, bytes: Buffer, body: GrantOperationRequest & GrantObject): Promise<GrantJsonResponse<T>>;
  intake<T = GrantObject>(bytes: Buffer, body: GrantObject): Promise<GrantJsonResponse<T>>;
  /** Freeze new requests, drain accepted operations and release the same connection. A failed drain can be retried on this instance; open is available after successful detach. */
  detach(expectedInstanceId?: string): Promise<GrantCloseResult>;
  /** Permanent admission stop; repeated calls retry a failed close of the same original owners. */
  close(): Promise<GrantCloseResult>;
}
