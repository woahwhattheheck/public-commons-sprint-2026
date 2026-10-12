import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-contracts.mjs';
export { MAX_RETAINED_CHUNK_BYTES } from './retained-file-contracts.mjs';
// MIT. Original accounting read snapshots, shared by the native retained-file owners.
import { open, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

const MEMORY_SNAPSHOT_LIMIT = 32 * 1024;
const DEFAULT_SNAPSHOT_BYTES_LIMIT = 256_000_000;
const COPY_CHUNK_BYTES = 1024 * 1024;
const SNAPSHOT_COUNT_LIMIT = 4;
const SNAPSHOT_IDLE_MS = 120_000;

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * The native owner selects the file and verifies its original manifest in load().
 * An owner with a retained file can instead provide loadFile(), its exact byte
 * count and expectedSha256. That path is streamed once into the same private
 * snapshot. Scope/key/directory/source paths and maximum size are trusted host
 * values, never client-selected paths. Each owner has its own lifecycle.
 */
export class RetainedFileReads {
  #reads = new Map(); #readTail = Promise.resolve(); #readStats = new Map();
  #prefix; #closing = false; #close; #maxSnapshotBytes;
  #opening = new Map(); #scopeClosures = new Map();
  constructor({ errorPrefix = 'RETAINED', maxSnapshotBytes = DEFAULT_SNAPSHOT_BYTES_LIMIT } = {}) {
    this.#prefix = errorPrefix;
    if (!Number.isSafeInteger(maxSnapshotBytes) || maxSnapshotBytes < 1)
      throw this.#fail('INVALID_CAPACITY', 'Use an explicit positive safe-integer snapshot byte budget.');
    this.#maxSnapshotBytes = maxSnapshotBytes;
  }
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
  closeScope(scope) {
    if (!this.#scopeClosures.has(scope)) {
      // Include admitted loaders, which may not have published their snapshot
      // yet. New admissions to this scope wait for an explicit later reopen.
      const closing = (async () => {
        await Promise.allSettled([...(this.#opening.get(scope) ?? [])]);
        await Promise.allSettled([...this.#reads.values()].filter(read => read.scope === scope)
          .map(read => this.release(scope, read.id)));
      })().finally(() => { this.#scopeClosures.delete(scope); });
      this.#scopeClosures.set(scope, closing);
    }
    return this.#scopeClosures.get(scope);
  }
  #capacity(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw this.#fail('INVALID_FILE', 'The original file must declare its exact nonnegative byte count.');
    if (bytes > this.#maxSnapshotBytes - this.summary.snapshotBytes)
      throw this.#fail('READ_CAPACITY', 'Finish or release existing reads to make room within the original owner snapshot byte budget.');
  }
  async #snapshotHandle(directory) {
    const temporary = await mkdtemp(join(directory, '.mcp-read-')), path = join(temporary, 'snapshot');
    let handle;
    try {
      handle = await open(path, 'wx+', 0o600);
      // Keep only the private descriptor during the copy and all later ranges.
      await unlink(path); await rmdir(temporary);
      return handle;
    } catch (error) {
      await handle?.close().catch(() => {});
      await unlink(path).catch(() => {}); await rmdir(temporary).catch(() => {}); throw error;
    }
  }
  async #copyOriginalFile(original, directory, expectedSha256) {
    if (!original || typeof original !== 'object' || typeof original.path !== 'string' || !isAbsolute(original.path) ||
        typeof original.name !== 'string' || !original.name || original.name.length > 255 ||
        /[\\/\u0000-\u001f\u007f]/.test(original.name))
      throw this.#fail('INVALID_FILE', 'The original owner must select an absolute retained file and its download name.');
    this.#capacity(original.bytes);
    let source, snapshot;
    try {
      source = await open(original.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const before = await source.stat({ bigint: true });
      if (!before.isFile() || typeof process.getuid !== 'function' || before.uid !== BigInt(process.getuid()) ||
          (before.mode & 0o077n) !== 0n)
        throw this.#fail('INVALID_FILE', 'Select an owned private regular source file.');
      if (before.size !== BigInt(original.bytes))
        throw this.#fail('FILE_CHANGED', 'The retained source size differs from its original manifest.');
      snapshot = await this.#snapshotHandle(directory);
      const hash = createHash('sha256'), buffer = Buffer.alloc(Math.min(COPY_CHUNK_BYTES, Math.max(original.bytes, 1)));
      let position = 0;
      while (position < original.bytes) {
        if (this.#closing || this.#scopeClosures.has(original.scope))
          throw this.#fail('CLOSING', 'Retained file reads are closing.');
        const result = await source.read(buffer, 0, Math.min(buffer.length, original.bytes - position), position);
        if (!result.bytesRead) throw this.#fail('FILE_CHANGED', 'The retained source ended before its declared size.');
        const chunk = buffer.subarray(0, result.bytesRead);
        let written = 0;
        while (written < chunk.length) {
          const result = await snapshot.write(chunk, written, chunk.length - written, position + written);
          if (!result.bytesWritten) throw this.#fail('SNAPSHOT_UNAVAILABLE', 'The private snapshot could not retain the original bytes.');
          written += result.bytesWritten;
        }
        hash.update(chunk); position += chunk.length;
      }
      if ((await source.read(buffer, 0, 1, position)).bytesRead)
        throw this.#fail('FILE_CHANGED', 'The retained source grew beyond its original manifest.');
      const after = await source.stat({ bigint: true });
      if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid'].some(key => before[key] !== after[key]))
        throw this.#fail('FILE_CHANGED', 'The original source changed during its snapshot copy.');
      const sha256 = hash.digest('hex');
      if (sha256 !== expectedSha256)
        throw this.#fail('FILE_CHANGED', 'The original file differs from the requested SHA256.');
      await source.close(); source = null;
      const handle = snapshot; snapshot = null;
      return { handle, sha256, size: original.bytes };
    } finally {
      await Promise.allSettled([source?.close(), snapshot?.close()].filter(Boolean));
    }
  }
  #open({ scope, key, kind, directory, load, loadFile, expectedSha256 }) {
    // Serialize original acquisition, then serve each owner's independent
    // immutable snapshot. Range reads never rerun the original exporter.
    const pending = this.#readTail.then(async () => {
      if (this.#closing || this.#scopeClosures.has(scope))
        throw this.#fail('CLOSING', 'Retained file reads are closing.');
      if (this.#reads.size >= SNAPSHOT_COUNT_LIMIT)
        throw this.#fail('READ_CAPACITY', 'Finish or release an existing file read before opening another.');
      if (typeof load === 'function' && loadFile !== undefined || typeof loadFile === 'function' && load !== undefined ||
          typeof load !== 'function' && typeof loadFile !== 'function')
        throw this.#fail('INVALID_FILE', 'Select exactly one original Buffer loader or retained-file loader.');
      if (loadFile && !expectedSha256)
        throw this.#fail('INVALID_FILE', 'Retained-file acquisition requires its original expectedSha256.');
      this.#readStats.set(scope, (this.#readStats.get(scope) ?? 0) + 1);
      const original = await (loadFile ?? load)();
      let size, sha, memory = null, handle = null;
      try {
        if (loadFile) {
          const copied = await this.#copyOriginalFile({ ...original, scope }, directory, expectedSha256);
          size = copied.size; sha = copied.sha256; handle = copied.handle;
        } else {
          if (!Buffer.isBuffer(original?.bytes) || typeof original?.name !== 'string')
            throw this.#fail('INVALID_FILE', 'The original Buffer loader must return bytes and a download name.');
          const bytes = original.bytes;
          this.#capacity(bytes.length); size = bytes.length; sha = digest(bytes);
          if (expectedSha256 && sha !== expectedSha256)
            throw this.#fail('FILE_CHANGED', 'The original file differs from the requested SHA256.');
          if (bytes.length <= MEMORY_SNAPSHOT_LIMIT) memory = Buffer.from(bytes);
          else { handle = await this.#snapshotHandle(directory); await handle.writeFile(bytes); }
        }
        if (this.#closing || this.#scopeClosures.has(scope))
          throw this.#fail('CLOSING', 'Retained file reads are closing.');
        const read = { id: randomUUID(), key, scope, kind, size, tail: Promise.resolve(),
          closed: false, memory, handle,
          metadata: { name: original.name, contentType: original.type ?? (original.name.endsWith('.json') ? 'application/json'
            : original.name.endsWith('.tar') ? 'application/x-tar' : 'application/octet-stream'), bytes: size, sha256: sha } };
        this.#reads.set(read.id, read); handle = null; this.#touch(read); return read;
      } finally {
        await handle?.close().catch(() => {});
      }
    });
    let opening = this.#opening.get(scope);
    if (!opening) { opening = new Set(); this.#opening.set(scope, opening); }
    opening.add(pending);
    const remove = () => { opening.delete(pending); if (!opening.size) this.#opening.delete(scope); };
    this.#readTail = pending.then(remove, remove);
    return pending;
  }
  async read(options) {
    const { scope, key, readId, expectedSha256, offset = 0, limit = 65536 } = options;
    if (this.#closing || this.#scopeClosures.has(scope)) throw this.#fail('CLOSING', 'Retained file reads are closing.');
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
