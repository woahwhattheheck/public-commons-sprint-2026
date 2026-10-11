import type { FileHandle } from 'node:fs/promises';
import type { Library, LibraryConfig, ResourceCollection, Resource } from './library.mjs';
export interface CollectionPackage {
  schema: 'stellar-forge.sf88.resource-collection-package.v1';
  collection: ResourceCollection; collectionSha256: string;
  objects: Array<{path: string; sha256: string; bytes: number}>;
}
export interface TransferOptions {signal?: AbortSignal; maxBytes?: number}
export interface ArchiveOptions extends TransferOptions {expectedSha256?: string}
export interface CollectionExport extends TransferOptions {id: string; revision?: number}
export interface ArchiveResult {
  bytes: number; sha256: string; manifestSha256: string;
  collectionId: string; revision: number; memberCount: number; objectCount: number;
}
export function exportCollection(library: Library, options: CollectionExport & {destination: string}): Promise<ArchiveResult & {path: string}>;
export function prepareCollectionDownload(library: Library, options: CollectionExport): Promise<ArchiveResult & {
  file: FileHandle; resource: {id: string; name: string}; dispose(): Promise<void>;
}>;
export function inspectCollectionArchive(archive: string, options?: ArchiveOptions): Promise<{
  manifest: CollectionPackage; manifestSha256: string; bytes: number; sha256: string;
}>;
export function receiveCollection(options: ArchiveOptions & {archive: string; destination: string; resume?: boolean}): Promise<{
  directory: string; source: string; roots: string[]; kind: 'collection'; manifestSha256: string;
  bytes: number; sha256: string; collectionId: string; revision: number; memberCount: number;
}>;
export function openReceivedLibrary(options: {directory: string; state: string; signal?: AbortSignal;
  indexBytes?: number; maxFileBytes?: number}): Promise<Library>;
export function readCollectionSource(config: LibraryConfig): Promise<{
  resources: Array<Omit<Resource,'annotation'|'status'> & {status:'UNVERIFIED'}>;
  details: {sourceSha256: string; sourceBytes: number; resourceCount: number; collection: {
    id: string; name: string; revision: number; note: string
  }; jobCount: null; withoutFile: 0; rejected: never[]};
}>;
