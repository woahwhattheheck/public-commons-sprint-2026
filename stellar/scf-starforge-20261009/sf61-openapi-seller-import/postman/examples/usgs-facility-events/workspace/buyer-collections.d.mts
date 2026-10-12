import type { FileHandle } from 'node:fs/promises';
import type { CollectionPackage } from '../../../../../sf88-operator-buyer-cli/resource-library/collection-package.mjs';
import type { ResourceCollection } from '../../../../../sf88-operator-buyer-cli/resource-library/library.mjs';

export const COLLECTION_ARCHIVE_LIMIT: number;
export interface CollectionIdentity {
  archiveSha256: string;
  archiveBytes: number;
  manifestSha256: string;
  manifestBytes: number;
}
export interface RetainedArchive {
  path: string;
  archiveSha256: string;
  archiveBytes: number;
  manifestBytes: Buffer;
  manifest: CollectionPackage;
}
export interface CollectionReadOptions {
  signal?: AbortSignal;
  onObject?(object: CollectionPackage['objects'][number]): {
    write(chunk: Uint8Array): void | Promise<void>;
    finish(): void | Promise<void>;
    close(): void | Promise<void>;
  } | undefined | Promise<{
    write(chunk: Uint8Array): void | Promise<void>;
    finish(): void | Promise<void>;
    close(): void | Promise<void>;
  } | undefined>;
}
export function collectionShelf(workspace: string): Promise<string>;
export function collectionArchivePath(workspace: string, sha256: string): string;
export function retainCollectionArchive(workspace: string, archive: string,
  options?: {expectedSha256?: string; signal?: AbortSignal}): Promise<RetainedArchive & {name: string}>;
export function retainUploadedCollection(workspace: string, readable: AsyncIterable<Uint8Array>,
  options: {expectedSha256: string; expectedBytes: number; signal?: AbortSignal}): Promise<RetainedArchive>;
export function readRetainedCollection(workspace: string, entry: CollectionIdentity,
  options?: CollectionReadOptions): Promise<{
    manifest: CollectionPackage; manifestBytes: Buffer; manifestSha256: string; bytes: number; sha256: string;
  }>;
export function readCollectionMembers(metadata: Uint8Array,
  options?: {query?: string; offset?: number; limit?: number}): {
    collection: string; revision: number; total: number; offset: number; limit: number;
    items: Array<{member: ResourceCollection['members'][number]; eligible: boolean; selectionNote: string}>;
  };
export type ArchivePart =
  | {type: 'collection-archive'; sha256: string; bytes: number}
  | {type: 'collection-part'; offset: number; base64: string}
  | {type: 'collection-end'; sha256: string};
export function collectionArchiveParts(workspace: string, entry: CollectionIdentity,
  options?: {signal?: AbortSignal}): AsyncGenerator<ArchivePart>;
export function receiveArchiveParts(workspace: string, identity: {sha256: string; bytes: number},
  options?: {signal?: AbortSignal}): Promise<{
    sha256: string;
    write(part: Extract<ArchivePart,{type:'collection-part'}>): Promise<void>;
    finish(part: Extract<ArchivePart,{type:'collection-end'}>): Promise<RetainedArchive>;
    close(): Promise<void>;
  }>;
export function downloadCollectionArchive(workspace: string, entry: CollectionIdentity,
  options?: {signal?: AbortSignal}): Promise<{
    bytes: number; sha256: string; file: FileHandle; dispose(): Promise<void>;
    verifiedAt: string; text: string | null; indexedBytes: number; coverage: string;
  }>;
export { parseCollectionManifest } from '../../../../../sf88-operator-buyer-cli/resource-library/collection-package.mjs';
