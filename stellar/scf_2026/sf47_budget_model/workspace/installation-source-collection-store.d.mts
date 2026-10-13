import type {InstallationSourceCollectionWorkingCopy,SourceCollectionScope} from './installation-source-collection-agent.mjs';
export const SOURCE_COLLECTION_STORE_SCHEMA:'stellar-forge.installation-source-collection-store.v1';
export const SOURCE_COLLECTION_MAX_COPY_BYTES:number;
export interface SourceCollectionStoreOptions {directory:string;workspaceDirectory:string}
export interface SourceCollectionStoreSelection {
 schema:typeof SOURCE_COLLECTION_STORE_SCHEMA;workspaceDirectory:string;copyId:string;draftId:string;
 scope:SourceCollectionScope;initialSequence:number;input:{bytes:number;sha256:string};
}
export interface SourceCollectionCheckpoint {
 sequence:number;copySha256:string;copyBytes:number;checkpointSha256:string;previousSha256:string|null;
}
export interface SourceCollectionHistory {
 schema:typeof SOURCE_COLLECTION_STORE_SCHEMA;workspaceDirectory:string;copyId:string;
 initialSequence:number;sequence:number;items:SourceCollectionCheckpoint[];
}
export class InstallationSourceCollectionStore {
 constructor(options:SourceCollectionStoreOptions);
 readonly directory:string;readonly workspaceDirectory:string;
 manifest?:SourceCollectionStoreSelection;
 static create(options:SourceCollectionStoreOptions&{workingCopy:InstallationSourceCollectionWorkingCopy;originalBytes?:Uint8Array}):Promise<InstallationSourceCollectionStore>;
 init():Promise<this>;
 load(options?:{sequence?:number}):Promise<InstallationSourceCollectionWorkingCopy>;
 persist(copy:InstallationSourceCollectionWorkingCopy,options:{expectedSequence:number}):Promise<InstallationSourceCollectionWorkingCopy>;
 export(options?:{sequence?:number}):Promise<Buffer>;
 history():Promise<SourceCollectionHistory>;
 originalInput():Promise<Buffer>;
}
