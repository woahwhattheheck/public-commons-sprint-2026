import type {SourceEdition,NativeRow} from './core.mjs';
export const CHECKPOINT_SCHEMA:'stellar-forge.givecredit-checkpoint.v1';
export interface CheckpointStatus extends NativeRow {
  schema:typeof CHECKPOINT_SCHEMA;kind:'registry'|'ledger';generation:number;savedAt:string;
  sourceStatus:string|null;phase:string|null;responses:number;sourceFiles:number;
  tables:Record<string,number>;objects:number;objectBytes:number;references:number;
  writtenObjects:number;writtenBytes:number;reusedBytes:number;
  directory:string;manifest:string;manifestBytes?:number;manifestSha256?:string;operation?:CheckpointImportOperation;replayed?:boolean;
}
export interface CheckpointImportOperation {requestId:string;actor:string;kind:'registry'|'ledger';sourceSha256:string;sourceBytes:number;generation:number;savedAt:string;result:NativeRow}
export interface CheckpointSaveOptions {phase?:string|null;provenance?:NativeRow|null;request?:{requestId:string;actor:string}|null}
export class CaptureCheckpointStore {
  directory:string;manifestPath:string;legacyPath:string|null;queue:Promise<unknown>;
  static open(directory:string,options?:{legacyPath?:string;expectedKind?:'registry'|'ledger'}):Promise<CaptureCheckpointStore>;
  status():Promise<CheckpointStatus|NativeRow|null>;
  load():Promise<SourceEdition|undefined>;
  /** Await completion before changing a borrowed source checkpoint. */
  save(source:SourceEdition,options?:CheckpointSaveOptions):Promise<CheckpointStatus>;
  importLegacy(path:string):Promise<CheckpointStatus&{verifiedSource:{bytes:number;sha256:string};originalFile:{bytes:number;sha256:string}}>;
  export(path:string):Promise<{path:string;bytes:number;sha256:string;sourceIdentity:NativeRow;status:CheckpointStatus|NativeRow|null}>;
  operation(requestId:string):Promise<CheckpointImportOperation|null>;
  releaseMemory():void;
}
export function readCaptureCheckpoint(path:string):Promise<SourceEdition|undefined>;
