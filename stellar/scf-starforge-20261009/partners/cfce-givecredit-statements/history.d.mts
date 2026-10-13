import type {Network,NativeRow} from './core.mjs';
export const LEDGER_INTERVAL_DEFAULTS:Readonly<{network:'mainnet';networkPassphrase:string;rpcUrl:string;pageSize:8;accounts:string[];contractIds:string[]}>;
export interface LedgerHistoryProgress {phase:string;manifest:string;nextLedger?:string;retainedPages?:string;decodedTransactions?:string;[key:string]:unknown}
export interface LedgerHistoryOptions {
  sourceRoot:string;output:string;sdk?:unknown;sdkModule?:string;network?:Network;networkPassphrase?:string;
  rpcUrl?:string;pageSize?:number;startLedger?:string|number;beforeLedger?:string|number;
  accounts?:string[];contractIds?:string[];addresses?:string[];
  baselineOptionsFile?:string;sourceSelectionFile?:string;operation?:string;resume?:boolean;fetchClosures?:boolean;
  ledgers?:Array<string|number>;fetchImpl?:typeof fetch;signal?:AbortSignal;timeoutMs?:number;
  onProgress?:(value:LedgerHistoryProgress)=>void|Promise<void>;
}
export interface LedgerIntervalQuery {network:Network;networkPassphrase:string;rpcUrl:string;startLedger:string;beforeLedger:string;pageSize:number}
export interface LedgerHistoryResult {
  output:string;manifest:string;selectionManifest:string;captureOptions:string;captureOptionsBytes:number;captureOptionsSha256:string;
  selectionId:string;query:LedgerIntervalQuery;scannedLedgers:string;decodedTransactions:string;selectedTransactions:number;
  selectedLedgers:number;transactionHashes:string[];fullOriginalPages:number;selectedOriginalPages:number;replayed?:boolean;
}
export interface SelectedLedgerResult {
  output:string;manifest:string;captureOptions:string;captureOptionsBytes:number;captureOptionsSha256:string;
  query:{network:Network;networkPassphrase:string;rpcUrl:string;ledgers:string[]};
  selectedLedgers:number;selectedTransactions:number;transactionHashes:string[];children:NativeRow[];
}
/** Every original ledger in [startLedger,beforeLedger); same-query resume and compact selected-ledger closure. */
export function captureLedgerInterval(options:LedgerHistoryOptions):Promise<LedgerHistoryResult>;
/** Re-select complete local originals; network is used only with fetchClosures:true. */
export function selectLedgerInterval(options:LedgerHistoryOptions):Promise<LedgerHistoryResult>;
/** Fetch only native-selected complete ledgers, retaining their original selection file and each original response. */
export function captureLedgerSelection(options:LedgerHistoryOptions&{ledgers?:Array<string|number>}):Promise<SelectedLedgerResult>;
