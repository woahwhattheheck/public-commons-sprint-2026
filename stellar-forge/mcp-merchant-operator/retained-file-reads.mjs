// MIT. Original accounting read snapshots, shared by the native retained-file owners.
import { open, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

const MEMORY_SNAPSHOT_LIMIT = 32 * 1024;
const SNAPSHOT_BYTES_LIMIT = 256_000_000;
const SNAPSHOT_COUNT_LIMIT = 4;
const SNAPSHOT_IDLE_MS = 120_000;
export const MAX_RETAINED_CHUNK_BYTES = 196608;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * The native owner selects the file and verifies its original manifest in load().
 * This reader owns only temporary verified bytes. Scope/key/directory are trusted
 * host values, never a client-selected path. Each owner has its own lifecycle.
 */
export class RetainedFileReads {
  #reads = new Map(); #readTail = Promise.resolve(); #readStats = new Map();
  #prefix; #closing = false; #close;
  constructor({ errorPrefix = 'RETAINED' } = {}) { this.#prefix = errorPrefix; }
  #fail(code, message) { return Object.assign(new Error(message), { code: this.#prefix + '_' + code }); }
  get summary() { return { activeFileReads: this.#reads.size,
    snapshotBytes: [...this.#reads.values()].reduce((sum, read) => sum + read.size, 0) }; }
  status(scope) {
    return { originalFileReads: this.#readStats.get(scope) ?? 0,
      sessions: [...this.#reads.values()].filter(read => read.scope === scope).map(read => ({
        readId: read.id, kind: read.kind, file: read.metadata,
        storage: read.handle ? 'PRIVATE_UNLINKED_DESCRIPTOR' : 'MEMORY',
        closing: Boolean(read.releasing || read.closed), expiresAt: read.expiresAt })) };
  }
  #touch(read) {
    if (read.closed || read.releasing) return;
    clearTimeout(read.timer); read.expiresAt = new Date(Date.now() + SNAPSHOT_IDLE_MS).toISOString();
    read.timer = setTimeout(() => { void this.release(read.scope, read.id).catch(() => {}); }, SNAPSHOT_IDLE_MS);
    read.timer.unref();
  }
  async #dispose(read) {
    if (!read.disposal) {
      read.closed = true; clearTimeout(read.timer); read.memory = null;
      read.disposal = (async () => { try { await read.handle?.close(); } finally { this.#reads.delete(read.id); } })();
    }
    await read.disposal;
  }
  async release(scope, readId) {
    const read = this.#reads.get(readId);
    if (!read) return;
    if (read.scope !== scope) throw this.#fail('READ_CONFLICT', 'Choose a file read owned by this original scope.');
    if (!read.release) {
      read.releasing = true; clearTimeout(read.timer);
      read.release = (async () => { await read.tail.catch(() => {}); await this.#dispose(read); })();
    }
    await read.release;
  }
  async closeScope(scope) {
    await Promise.allSettled([...this.#reads.values()].filter(read => read.scope === scope).map(read => this.release(scope, read.id)));
  }
  #open({ scope, key, kind, directory, load, expectedSha256 }) {
    // Only one original loader's large Buffer is live here at a time. Later
    // chunks reuse its immutable snapshot and do not invoke that loader again.
    const pending = this.#readTail.then(async () => {
      if (this.#closing) throw this.#fail('CLOSING', 'Retained file reads are closing.');
      if (this.#reads.size >= SNAPSHOT_COUNT_LIMIT) throw this.#fail('READ_CAPACITY', 'Finish or release an existing file read before opening another.');
      this.#readStats.set(scope, (this.#readStats.get(scope) ?? 0) + 1);
      const original = await load(), bytes = original.bytes, sha = digest(bytes);
      if (expectedSha256 && sha !== expectedSha256) throw this.#fail('FILE_CHANGED', 'The original file differs from the requested SHA256.');
      if (bytes.length > SNAPSHOT_BYTES_LIMIT - this.summary.snapshotBytes)
        throw this.#fail('READ_CAPACITY', 'Finish or release existing reads to make room within the 256 MB verified-snapshot budget.');
      const read = { id: randomUUID(), key, scope, kind, size: bytes.length, tail: Promise.resolve(),
        closed: false, memory: null, handle: null,
        metadata: { name: original.name, contentType: original.type ?? (original.name.endsWith('.json') ? 'application/json'
          : original.name.endsWith('.tar') ? 'application/x-tar' : 'application/octet-stream'), bytes: bytes.length, sha256: sha } };
      if (bytes.length <= MEMORY_SNAPSHOT_LIMIT) read.memory = bytes;
      else {
        // Already verified original bytes, not a second export. Unlink the
        // private descriptor immediately; process exit releases it as well.
        const temporary = await mkdtemp(join(directory, '.mcp-read-')), path = join(temporary, 'snapshot');
        try {
          read.handle = await open(path, 'wx+', 0o600);
          await read.handle.writeFile(bytes); await unlink(path); await rmdir(temporary);
        } catch (error) {
          await read.handle?.close(); await unlink(path).catch(() => {}); await rmdir(temporary).catch(() => {}); throw error;
        }
      }
      this.#reads.set(read.id, read); this.#touch(read); return read;
    });
    this.#readTail = pending.then(() => {}, () => {});
    return pending;
  }
  async read(options) {
    const { scope, key, readId, expectedSha256, offset = 0, limit = 65536 } = options;
    if (this.#closing) throw this.#fail('CLOSING', 'Retained file reads are closing.');
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RETAINED_CHUNK_BYTES ||
        expectedSha256 !== undefined && !/^[0-9a-f]{64}$/.test(expectedSha256))
      throw this.#fail('INVALID_CHUNK', 'Use a nonnegative byte offset, a bounded chunk and an exact SHA256.');
    if ((offset > 0 || readId) && !expectedSha256)
      throw this.#fail('INVALID_CHUNK', 'Repeat expectedSha256 when continuing a read or resuming at a later offset.');
    const read = readId ? this.#reads.get(readId) : await this.#open(options);
    if (!read || read.closed || read.releasing)
      throw this.#fail('READ_NOT_FOUND', 'This file read completed, expired or was released. Open a new original read using the same expectedSha256 to resume.');
    if (read.scope !== scope || read.key !== key) throw this.#fail('READ_CONFLICT', 'Use this readId only for its original scope and file selection.');
    if (expectedSha256 && expectedSha256 !== read.metadata.sha256) throw this.#fail('FILE_CHANGED', 'The read snapshot differs from the requested SHA256.');
    if (offset > read.size) { if (!readId) await this.release(scope, read.id); throw this.#fail('INVALID_CHUNK', 'Use an offset within the verified original file.'); }
    const pending = read.tail.then(async () => {
      if (read.closed) throw this.#fail('READ_NOT_FOUND', 'This original file read has completed or been released.');
      this.#touch(read);
      const length = Math.min(limit, read.size - offset), chunk = read.memory ? read.memory.subarray(offset, offset + length) : Buffer.alloc(length);
      if (read.handle) {
        let position = 0;
        while (position < length) {
          const result = await read.handle.read(chunk, position, length - position, offset + position);
          if (!result.bytesRead) throw this.#fail('SNAPSHOT_UNAVAILABLE', 'The private verified read snapshot is unavailable.');
          position += result.bytesRead;
        }
      }
      const next = offset + length, result = { readId: read.id, file: read.metadata, offset, bytesRead: length,
        nextOffset: next < read.size ? next : null, encoding: 'base64', data: chunk.toString('base64') };
      if (next === read.size) await this.#dispose(read);
      return result;
    });
    read.tail = pending.then(() => {}, () => {});
    return pending;
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => {
        await this.#readTail;
        await Promise.all([...this.#reads.values()].map(read => this.release(read.scope, read.id)));
      })();
    }
    return this.#close;
  }
}
