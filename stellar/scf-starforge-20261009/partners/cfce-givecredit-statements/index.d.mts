export * from './core.mjs';
export * from './capture.mjs';
export * from './ledger.mjs';
export * from './server.mjs';
export * from './client.mjs';
import type {SourceEdition,SavedSourceEdition,WorkspaceState,WorkspaceOverview,Handover,NativeRow,SourceSummary} from './core.mjs';
export interface OperationOptions {revision:number;requestId?:string;actor?:string}
export interface OperationResult extends NativeRow {revision:number;workspaceId:string;requestId:string;replayed:boolean}
export const MAX_INPUT_BYTES:number;
export const MAX_WORKSPACE_BYTES:number;
export function decode(bytes:Uint8Array):string;
export function digest(value:unknown):string;
export function sourceDigest(source:SourceEdition):string;
export function sealSource<T extends SourceEdition>(source:T):T&{sha256:string};
export function verifySources(state:WorkspaceState):WorkspaceState;
export function readJSONFile(path:string,maximum?:number):Promise<unknown>;
export function inspectBinding(directory:string):Promise<{directory:string;workspaceId:string}>;
export class GiveCreditWorkspace {
  directory:string;state:WorkspaceState;closed:boolean;
  static create(directory:string,options?:{name?:string;handover?:Handover}):Promise<GiveCreditWorkspace>;
  static open(directory:string,options?:{expectedWorkspaceId?:string}):Promise<GiveCreditWorkspace>;
  serial<T>(work:()=>T|Promise<T>):Promise<T>;
  overview():Promise<WorkspaceOverview>;
  snapshot():Promise<WorkspaceState>;
  applyUnlocked(action:string,value:NativeRow,options:OperationOptions):Promise<OperationResult>;
  apply(action:string,value:NativeRow,options:OperationOptions):Promise<OperationResult>;
  import(source:SourceEdition,label:string,options:OperationOptions):Promise<OperationResult&{edition:{id:string;label:string}&SourceSummary;alreadyPresent?:boolean}>;
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
