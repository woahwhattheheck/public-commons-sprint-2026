import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FileHandle } from 'node:fs/promises';

export interface VerifiedDownload {
  file: FileHandle; resource: {id: string; name: string}; bytes: number; sha256: string;
  dispose(): Promise<void>;
}
export interface VerifiedDownloads {
  register(produce: (signal: AbortSignal) => Promise<VerifiedDownload>, options?: {signal?: AbortSignal}):
    Promise<{url: string; bytes: number; sha256: string}>;
  serve(options: {request: IncomingMessage; response: ServerResponse; path: string; signal?: AbortSignal}): Promise<boolean>;
  status(): {capacity: number; occupied: number; tickets: number; closing: boolean};
  close(): Promise<{closed: true}>;
}
export function createVerifiedDownloads(options?: {prefix?: string; capacity?: number; ttlMs?: number}): VerifiedDownloads;
