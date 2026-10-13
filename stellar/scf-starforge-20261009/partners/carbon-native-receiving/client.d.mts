import type {StellarSdkRuntimeOptions,StellarSdkRuntimeReceipt} from './prepare-sdk-runtime.mjs';
import type {ArchiveInputOptions,ArchiveInputResult} from './prepare-ledger-inputs.mjs';
export const OPERATION:'SCF-CARBON-NATIVE-8D45-20261012';
export interface SourceSelection {sourceRoot:string}
export interface SourceInspection {
  schema:'stellar-forge.carbon-native-source-inspection.v1';operation:typeof OPERATION;sourceRoot:string;sourceCommit:string;
  files:number;sourceBytes:number;capabilities:Record<string,unknown>;manifest:{path:string;bytes:number;sha256:string};handover:{bytes:number;sha256:string};
}
export interface ReceivingObservers {
  signal?:AbortSignal;onEvent?:(event:Record<string,unknown>)=>void;onStdout?:(chunk:string)=>void;onStderr?:(chunk:string)=>void;
}
export interface ReceivingOptions extends SourceSelection,ReceivingObservers {
  output:string;resumeFrom?:string;chromium?:string;sdkModule?:string;actor?:string;ledgerSource?:string;registrySource?:string;
  captureOptions?:string;captureCheckpoint?:string;from?:string;before?:string;archivePath?:string;keepOpen?:boolean;
  accountingDirectory?:string;expectedAccountingWorkspaceId?:string;expectedAccountingSourcesSha256?:string;accountingConfig?:string;
}
export interface ReceivingStatusOptions {output:string;archivePath?:string;verifyArchive?:boolean}
export interface ReceivingStatus {
  schema:'stellar-forge.carbon-native-status.v1';operation:typeof OPERATION;
  state:'not-started'|'running'|'incomplete'|'interrupted'|'archive-pending'|'archive-invalid'|'complete';
  output:string;sourceRoot:string|null;invocationFile:string|null;receivingFile:string|null;
  process:{running:boolean|null;recordedState:string|null;pid:number|null;exitCode:number|null;signal:string|null};
  startedAt:string|null;completedAt:string|null;
  stages:Array<{name:string;status:string;startedAt?:string;completedAt?:string;error?:Record<string,unknown>}>;
  workspaces:Record<string,unknown>;accounting:Record<string,unknown>|null;resume:Record<string,unknown>|null;errors:Array<Record<string,unknown>>;
  archive:{path:string;descriptor:string;complete:boolean;bytes:number|null;sha256:string|null;
    verification:'pending'|'metadata'|'sha256';actualSha256:string|null;members:number|null};
  live:{stellarcarbon?:string;givecredit?:string;observed:'open'|'closed'|'unknown'}|null;
  issues:Array<{part:string;code:string;message:string}>;
}
export interface NativeReceivingRun {
  pid:number|null;sourceRoot:string;output:string;invocationFile:string;completion:Promise<ReceivingStatus>;
  stop:(signal?:'SIGINT'|'SIGTERM')=>boolean;
}
export const RUN_FLAGS:Readonly<Record<string,string>>;
export function receivingArguments(options:ReceivingOptions):string[];
export function inspectReceivingSource(options:SourceSelection):Promise<SourceInspection>;
export function receivingStatus(options:ReceivingStatusOptions):Promise<ReceivingStatus>;
export class CarbonNativeReceivingClient {
  constructor(options?:{nodeExecutable?:string});
  nodeExecutable:string;
  inspectSource(options:SourceSelection):Promise<SourceInspection>;
  prepareSdk(options:StellarSdkRuntimeOptions):Promise<StellarSdkRuntimeReceipt>;
  prepareLedgerInputs(options:ArchiveInputOptions):Promise<ArchiveInputResult>;
  receiveSource(options:SourceSelection&{downloads:string;signal?:AbortSignal;onStderr?:(chunk:string)=>void}):Promise<SourceInspection>;
  status(options:ReceivingStatusOptions):Promise<ReceivingStatus>;
  verify(options:ReceivingStatusOptions):Promise<ReceivingStatus>;
  start(options:ReceivingOptions):Promise<NativeReceivingRun>;
  run(options:ReceivingOptions):Promise<ReceivingStatus>;
}
