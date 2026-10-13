export * from './core.mjs';
export * from './capture.mjs';
export * from './ledger.mjs';
export * from './server.mjs';
export * from './client.mjs';
import type {SourceEdition,SavedSourceEdition,WorkspaceState,WorkspaceOverview,Handover,NativeRow,SourceSummary,ReadonlyJSON,DetachedJSON} from './core.mjs';
export interface OperationOptions {revision:number;requestId?:string;actor?:string}
export interface OperationResult extends NativeRow {revision:number;workspaceId:string;requestId:string;replayed:boolean}
export const MAX_INPUT_BYTES:number;
export const MAX_WORKSPACE_BYTES:number;
export function decode(bytes:Uint8Array):string;
export function digest(value:unknown):string;
export function sourceDigest(source:ReadonlyJSON<SourceEdition>):string;
export function sealSource<T extends ReadonlyJSON<SourceEdition>>(source:T):DetachedJSON<T>&{sha256:string};
export function verifySources<T extends ReadonlyJSON<WorkspaceState>>(state:T):T;
export function readJSONFile(path:string,maximum?:number):Promise<unknown>;
export function inspectBinding(directory:string):Promise<{directory:string;workspaceId:string}>;
export class GiveCreditWorkspace {
  directory:string;readonly state:ReadonlyJSON<WorkspaceState>;closed:boolean;
  static create(directory:string,options?:{name?:string;handover?:ReadonlyJSON<Handover>}):Promise<GiveCreditWorkspace>;
  static open(directory:string,options?:{expectedWorkspaceId?:string}):Promise<GiveCreditWorkspace>;
  serial<T>(work:()=>T|Promise<T>):Promise<T>;
  overview():Promise<WorkspaceOverview>;
  snapshot():Promise<WorkspaceState>;
  readonlySnapshot():Promise<ReadonlyJSON<WorkspaceState>>;
  readonlyHandover():Promise<ReadonlyJSON<Handover>>;
  applyUnlocked(action:string,value:NativeRow,options:OperationOptions):Promise<OperationResult>;
  apply(action:string,value:NativeRow,options:OperationOptions):Promise<OperationResult>;
  importUnlocked(source:ReadonlyJSON<SourceEdition>,label:string,options:OperationOptions):Promise<OperationResult&{edition:{id:string;label:string}&SourceSummary;alreadyPresent?:boolean}>;
  import(source:ReadonlyJSON<SourceEdition>,label:string,options:OperationOptions):Promise<OperationResult&{edition:{id:string;label:string}&SourceSummary;alreadyPresent?:boolean}>;
  handover():Promise<Handover>;
  saveCapture(kind:'registry'|'ledger',checkpoint:SourceEdition,options?:{phase?:string;provenance?:NativeRow}):Promise<import('./checkpoint.mjs').CheckpointStatus>;
  captureStatus(kind:'registry'|'ledger'):Promise<import('./checkpoint.mjs').CheckpointStatus|NativeRow|null>;
  exportCapture(kind:'registry'|'ledger',path:string):Promise<NativeRow>;
  importCapture(kind:'registry'|'ledger',path:string):Promise<import('./checkpoint.mjs').CheckpointStatus>;
  captureStore(kind:'registry'|'ledger'):Promise<import('./checkpoint.mjs').CaptureCheckpointStore>;
  releaseCapture(kind:'registry'|'ledger'):Promise<void>;
  captureCheckpoint(kind:'registry'|'ledger'):Promise<SourceEdition|undefined>;
  close():Promise<void>;
}
export * from './archive.mjs';
export * from './history.mjs';
export * from './checkpoint.mjs';
