export interface ArchiveInputOptions {
  sourceRoot:string;
  output:string;
  sourceManifest:string;
  ledgerFiles:string[];
  sdkModule?:string;
  sdk?:unknown;
}
export interface ArchiveInputResult {
  output:string;
  manifest:string;
  captureOptions:string;
  files:number;
  decodedRows:string;
  selectedTransactions:number;
  transactionHashes:string[];
}
export function prepareArchiveInputs(options:ArchiveInputOptions):Promise<ArchiveInputResult>;
