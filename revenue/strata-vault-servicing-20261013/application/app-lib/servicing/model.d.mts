/** Exact public archive and model API for the optional current Strata servicing extension. */
export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export type ContractRole = "async_vault" | "share_token" | "nav_oracle" | "identity_verifier" | "compliance" | "asset";
export interface Binding {
  network: { id: string; passphrase: string; rpcUrl: string };
  contracts: Record<ContractRole, string>;
  startLedger: number;
  sourceCommit: "400754230a3fecaa69385687ba8457f1c2250d13";
}
export interface RPCSource {
  id: string; request: { jsonrpc: "2.0"; id: string; method: string; params: JSONValue };
  endpoint: string; observedAt: string; httpStatus: number;
  responseText: string; responseHeaders: Record<string,string>; bytes: number; sha256: string;
}
export interface Batch {
  id: string; captureId?: string; networkSourceId: string; healthSourceId: string; requestedToLedger: number | null; fromLedger: number; toLedger: number;
  status: "COMPLETE" | "INCOMPLETE" | "GAP";
  sourceIds: string[]; reason: string | null;
}
export interface Snapshot { id: string; networkSourceId: string; sourceId: string; label: string; }
export interface Archive {
  schema: "strata.servicing-archive.v1"; edition: 1;
  id: string; binding: Binding; createdAt: string;
  sources: RPCSource[]; batches: Batch[]; snapshots: Snapshot[];
  notes: { id: string; text: string; recordedAt: string; }[];
  journal: { commands: JSONValue[]; attempts: JSONValue[]; captures: JSONValue[]; received: JSONValue[]; producer: JSONValue; receivedFrom: JSONValue; };
  sha256: string;
}
export interface HistoryEvent {
  id: string; sourceId: string; contractId: string; role: ContractRole;
  name: string; ledger: number; closedAt: string; txHash: string;
  topics: JSONValue[]; data: JSONValue; decodeError: string | null;
  topicXdr: string[]; valueXdr: string;
}
export interface RequestEpisode {
  id: string; side: "deposit" | "redeem"; controller: string; epoch: string;
  status: "REQUESTED" | "PRICED" | "CLAIMED" | "CANCELLED" | "INCOMPLETE";
  amount: string | null; shares: string | null; assets: string | null;
  sharePrice: string | null; requestedAt: string | null; concludedAt: string | null;
  firstLedger: number; lastLedger: number; missingStart: boolean;
  eventIds: string[]; notes: string[];
}
export interface Valuation {
  id: string; ledger: number; closedAt: string; attester: string;
  price: string; expiresAt: string; eventIds: string[];
}
export interface Epoch {
  id: string; status: "OBSERVED" | "SEALED" | "PRICED";
  totalDeposited: string | null; totalSharesRedeeming: string | null;
  sharePrice: string | null; closedAt: string | null; pricedAt: string | null;
  eventIds: string[];
}
export interface TreasuryMovement {
  id: string; direction: "TO_CUSTODIAN" | "INTO_VAULT";
  account: string; assets: string; netDeployed: string;
  ledger: number; closedAt: string; txHash: string; eventIds: string[];
}
export interface Coverage {
  fromLedger: number; toLedger: number; status: "COMPLETE" | "INCOMPLETE" | "GAP";
  batchIds: string[]; reason: string | null;
}
export interface StateSnapshot {
  id: string; sourceId: string; label: string; ledger: number; observedAt: string;
  entries: { contractId: string | null; role: ContractRole | null; keyXdr: string; valueXdr: string; lastModifiedLedger: number; liveUntilLedger: number | null; value: JSONValue; }[];
  vault: Record<string, JSONValue>;
}
export interface Reconciliation {
  id: string; fromSnapshotId: string; toSnapshotId: string;
  fromLedger: number; toLedger: number;
  status: "MATCH" | "DIFFERENCE" | "UNKNOWN";
  openingNetDeployed: string | null; closingNetDeployed: string | null;
  observedDeployed: string; observedFunded: string; expectedNetDeployed: string | null;
  difference: string | null; reason: string; eventIds: string[];
}
export interface HistoryReport {
  schema: "strata.servicing-report.v1"; archiveId: string; archiveSha256: string;
  binding: Binding; createdAt: string;
  events: HistoryEvent[]; requests: RequestEpisode[]; valuations: Valuation[];
  epochs: Epoch[]; treasury: TreasuryMovement[]; windDown: HistoryEvent[];
  coverage: Coverage[]; snapshots: StateSnapshot[]; reconciliations: Reconciliation[];
  warnings: string[];
  sources: { id: string; method: string; observedAt: string; bytes: number; sha256: string; }[];
}
export interface StatementSelection {
  controller: string;
  fromLedger?: number; toLedger?: number;
}
export interface InvestorStatement {
  schema: "strata.investor-statement.v1";
  archiveId: string; archiveSha256: string; binding: Binding;
  selection: StatementSelection; requests: RequestEpisode[]; events: HistoryEvent[];
  coverage: Coverage[]; warnings: string[];
  totals: { depositRequested: string; depositRefunded: string; sharesClaimed: string;
    sharesRequestedForRedemption: string; sharesReturned: string; redemptionAssetsPaid: string;
    windDownAssetsPaid: string; windDownSharesSurrendered: string; };
}
export declare function inspectArchive(raw: string): Promise<Archive>;
export declare function sealArchive(value: Omit<Archive, "sha256">): Promise<Archive>;
export declare function deriveHistory(archive: Archive): HistoryReport;
export declare function investorStatement(report: HistoryReport, selection: StatementSelection): InvestorStatement;
export declare function statementCSV(statement: InvestorStatement): string;
export declare function reportCSV(report: HistoryReport, view?: "activity" | "requests" | "valuations" | "epochs" | "treasury" | "coverage"): string;
export declare function canonical(value: unknown): string;
