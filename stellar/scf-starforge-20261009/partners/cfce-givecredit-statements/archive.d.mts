/** Complete original JSON-RPC ledger response decoding; native quantities remain strings. */
export interface OriginalLedgerRequest {jsonrpc:'2.0';id:string|number;method:'getLedgers';params:{startLedger?:string|number;pagination?:{cursor?:string;limit?:string|number};xdrFormat?:'base64'}}
export interface ArchiveLedgerHeader {sequence:string;hash:string;previousLedgerHash:string;createdAt:string;ledgerCloseTime:string;protocol:string;transactions:string;sourcePointer:string}
export interface ArchiveContractCall {operationIndex:string;contractId:string;function:string}
export interface ArchiveBumpSequence {operationIndex:string;sourceAccount:string|null;bumpTo:string}
export interface ArchiveTransaction {
  hash:string;hashAliases:string[];ledger:string;createdAt:string;applicationOrder:string;nativeTransactionId:string;originalProtocol:string;
  envelopeXdr:string;resultXdr:string;resultMetaXdr:string;successful:boolean;resultCode:string;feeBump:boolean;
  sourceAccount:string;baseSourceAccount:string|null;sourceSequence:string;feeSource:string|null;
  operationKinds:string[];contractCalls:ArchiveContractCall[];bumpSequences:ArchiveBumpSequence[];addresses:string[];
  sourcePointer:string;headerPointer:string;nativeXdrPath:string;ledgerHash:string;
}
export interface ArchiveLedgerPage {responseId:string|number;cursor:string|null;oldestLedger:string|null;latestLedger:string|null;ledgers:ArchiveLedgerHeader[];rows:ArchiveTransaction[]}
export function decodeArchiveLedgerPage(options:{content:string;sdk:unknown;networkPassphrase:string;request?:OriginalLedgerRequest}):ArchiveLedgerPage;
