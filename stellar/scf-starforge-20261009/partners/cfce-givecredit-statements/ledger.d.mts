import type {Asset,LedgerEdition,Network,RegistryEdition,NativeRow} from './core.mjs';
export const CFCE_LEDGER_DEFAULTS:Readonly<{network:Network;networkPassphrase:string;rpcUrl:string;horizonUrl:string;archiveRpcUrl:string;contractId:string;account:string}>;
import type {OriginalLedgerRequest} from './archive.mjs';
export interface OriginalExpertLedgerSource {
  format:'stellar-expert-ledger-json';
  sourceUrl:string;
  content:string;
  ledger:string|number;
  status?:string|number|null;
  retrievedAt?:string|null;
  importedAt?:string;
  acquisition?:NativeRow;
  recordContainer?:'array'|'hal-records';
}
export interface OriginalRpcLedgerSource {
  format:'stellar-rpc-ledgers-json';sourceUrl:string;request:OriginalLedgerRequest;requestContent?:string;
  content:string;ledger?:string|number;status?:string|number|null;retrievedAt?:string|null;importedAt?:string;acquisition?:NativeRow;
}
export type OriginalLedgerSource=OriginalExpertLedgerSource|OriginalRpcLedgerSource;
export interface LedgerCaptureOptions {originalLedgerSources?:OriginalLedgerSource[];network?:Network;networkPassphrase?:string;rpcUrl?:string;horizonUrl?:string;archiveRpcUrl?:string|null;contractId?:string;contractIds?:string[];account?:string;accounts?:string[];simulationSource?:string;transactionHashes?:string[];hash?:string;registrySource?:RegistryEdition;registrySources?:RegistryEdition[];from?:string;before?:string;fromDate?:string;beforeDate?:string;startLedger?:string|number;endLedger?:string|number;assets?:Asset[];fetchImpl?:typeof fetch;sdk?:unknown;signal?:AbortSignal;timeoutMs?:number;rpcHeaders?:Record<string,string>;horizonHeaders?:Record<string,string>;archiveHeaders?:Record<string,string>;checkpoint?:LedgerEdition;onProgress?:(value:NativeRow&{phase:string;checkpoint:LedgerEdition})=>void|Promise<void>}
export function captureLedger(options?:LedgerCaptureOptions):Promise<LedgerEdition>;
export function captureTransaction(options:LedgerCaptureOptions&{hash:string}):Promise<LedgerEdition>;
