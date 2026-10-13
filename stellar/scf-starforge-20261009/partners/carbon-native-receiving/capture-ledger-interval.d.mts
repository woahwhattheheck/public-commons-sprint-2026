/** Portable native helper types; also work in the reconstructed receiving/ layout. */
export interface PrepareLedgerIntervalOptions {
  sourceRoot:string;output:string;mode?:'capture'|'reselect'|'selected';
  optionsFile?:string;selectionPointer?:string;ledgerField?:string;sourceSelectionFile?:string;
  sdk?:unknown;sdkModule?:string;network?:'mainnet'|'testnet';networkPassphrase?:string;
  rpcUrl?:string;pageSize?:number;startLedger?:string|number;beforeLedger?:string|number;
  accounts?:string[];contractIds?:string[];addresses?:string[];ledgers?:Array<string|number>;
  baselineOptionsFile?:string;operation?:string;resume?:boolean;fetchClosures?:boolean;
  fetchImpl?:typeof fetch;signal?:AbortSignal;timeoutMs?:number;
  onProgress?:(value:{phase:string;manifest:string;[key:string]:unknown})=>void|Promise<void>;
}
export interface PrepareLedgerIntervalResult {
  output:string;manifest:string;captureOptions:string;captureOptionsBytes:number;captureOptionsSha256:string;
  query:{network:string;networkPassphrase:string;rpcUrl:string;ledgers?:string[];startLedger?:string;beforeLedger?:string;pageSize?:number};
  selectedLedgers:number;selectedTransactions:number;transactionHashes:string[];
  selectionManifest?:string;selectionId?:string;scannedLedgers?:string;decodedTransactions?:string;
  fullOriginalPages?:number;selectedOriginalPages?:number;replayed?:boolean;children?:Record<string,unknown>[];
}
export const HELP:string;
export function prepareLedgerInterval(options:PrepareLedgerIntervalOptions):Promise<PrepareLedgerIntervalResult>;
export function main(args?:string[]):Promise<PrepareLedgerIntervalResult|undefined>;
