// MIT. Original accounting read snapshots, shared by the native retained-file owners.
import { open, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

const MEMORY_SNAPSHOT_LIMIT = 32 * 1024;
const SNAPSHOT_BYTES_LIMIT = 256_000_000;
const SNAPSHOT_COUNT_LIMIT = 4;
const SNAPSHOT_IDLE_MS = 120_000;
export const MAX_RETAINED_CHUNK_BYTES = 196608;
export const MAX_RETAINED_IMMUTABLE_FILE_BYTES = 8 * 1024 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const SHA256 = /^[0-9a-f]{64}$/;
const sameIdentity = (left, right, includeCtime = true) =>
  ['dev', 'ino', 'size', 'mtimeNs', ...(includeCtime ? ['ctimeNs'] : [])].every(key => left[key] === right[key]);

/**
 * The native owner selects the file and verifies its original manifest in load().
 * Scope/key/directory are trusted host values, never a client-selected path.
 *
 * Existing loaders return {bytes: Buffer, name, type?}; their verified memory or
 * private unlinked snapshots retain the original 256 MB copied-byte budget.
 * A native immutable-file loader may instead return:
 *   {readonlyFileHandle, bytes: number, sha256: string, name, type?}
 * It MUST open a selected regular file read-only and transfer sole ownership of
 * that FileHandle on return. Do not close, share, or write through that handle
 * afterwards. A loader which fails before returning still owns its resources.
 * This reader independently hashes the opened descriptor with bounded memory;
 * no path is reopened and no complete native file is loaded/copied into a Buffer.
 * Native files share the four-read limit but not the copied-snapshot byte budget.
 * All readIds remain process-local; resume after release/restart by selecting the
 * same original file with expectedSha256 and a byte offset, as before.
 */
export class RetainedFileReads {
  #reads = new Map(); #readTail = Promise.resolve(); #readStats = new Map();
  #scopeClosures = new Map(); #ownedHandles = new WeakSet();
  #prefix; #closing = false; #close;
  constructor({ errorPrefix = 'RETAINED' } = {}) { this.#prefix = errorPrefix; }
  #fail(code, message) { return Object.assign(new Error(message), { code: this.#prefix + '_' + code }); }
  get summary() {
    const reads = [...this.#reads.values()];
    return { activeFileReads: reads.length,
      snapshotBytes: reads.reduce((sum, read) => sum + (read.native ? 0 : read.size), 0),
      immutableFileBytes: reads.reduce((sum, read) => sum + (read.native ? read.size : 0), 0) };
  }
  status(scope) {
    return { originalFileReads: this.#readStats.get(scope) ?? 0,
      sessions: [...this.#reads.values()].filter(read => read.scope === scope).map(read => ({
        readId: read.id, kind: read.kind, file: read.metadata,
        storage: read.native ? 'NATIVE_IMMUTABLE_DESCRIPTOR' : read.handle ? 'PRIVATE_UNLINKED_DESCRIPTOR' : 'MEMORY',
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
    const existing = this.#scopeClosures.get(scope);
    if (existing) return existing;
    // A scope may close while its native loader/hash is still pending. Prevent a
    // descriptor from appearing after closeScope has returned, without closing
    // other owners or changing their immutable readIds.
    const pending = Promise.resolve().then(async () => {
      await this.#readTail;
      await Promise.allSettled([...this.#reads.values()].filter(read => read.scope === scope)
        .map(read => this.release(scope, read.id)));
    });
    this.#scopeClosures.set(scope, pending);
    try { await pending; }
    finally { if (this.#scopeClosures.get(scope) === pending) this.#scopeClosures.delete(scope); }
  }
  #assertOpening(scope) {
    if (this.#closing || this.#scopeClosures.has(scope))
      throw this.#fail('CLOSING', 'Retained file reads for this original scope are closing.');
  }
  #ownNativeHandle(value) {
    if (!value || typeof value !== 'object' || !Number.isInteger(value.fd) || value.fd < 0 ||
        typeof value.stat !== 'function' || typeof value.read !== 'function' || typeof value.close !== 'function')
      throw this.#fail('FILE_SOURCE_INVALID', 'The native owner must return its open read-only FileHandle.');
    if (this.#ownedHandles.has(value))
      throw this.#fail('FILE_SOURCE_INVALID', 'This native FileHandle has already been transferred to the reader.');
    this.#ownedHandles.add(value); return value;
  }
  async #nativeIdentity(handle) {
    const value = await handle.stat({ bigint: true });
    if (!value.isFile() || !['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => typeof value[key] === 'bigint'))
      throw this.#fail('FILE_SOURCE_INVALID', 'Use a regular native file with precise descriptor identity.');
    return { dev: value.dev, ino: value.ino, size: value.size, mtimeNs: value.mtimeNs, ctimeNs: value.ctimeNs };
  }
  async #verifyNative(handle, size, sha256, scope, read = null) {
    this.#assertOpening(scope);
    if (read?.releasing) throw this.#fail('READ_NOT_FOUND', 'This original file read is being released.');
    const before = await this.#nativeIdentity(handle);
    if (before.size !== BigInt(size))
      throw this.#fail('FILE_CHANGED', 'The opened native file differs from its original byte count.');
    const hash = createHash('sha256'), buffer = Buffer.alloc(Math.min(MAX_RETAINED_CHUNK_BYTES, Math.max(size, 1)));
    let position = 0;
    while (position < size) {
      this.#assertOpening(scope);
      if (read?.releasing) throw this.#fail('READ_NOT_FOUND', 'This original file read is being released.');
      const length = Math.min(buffer.length, size - position);
      const result = await handle.read(buffer, 0, length, position);
      if (!Number.isInteger(result.bytesRead) || result.bytesRead < 1 || result.bytesRead > length)
        throw this.#fail('SNAPSHOT_UNAVAILABLE', 'The original native file ended before its verified byte count.');
      hash.update(buffer.subarray(0, result.bytesRead)); position += result.bytesRead;
    }
    const after = await this.#nativeIdentity(handle);
    if (!sameIdentity(before, after) || hash.digest('hex') !== sha256)
      throw this.#fail('FILE_CHANGED', 'The opened native file changed or differs from its original SHA256.');
    this.#assertOpening(scope);
    return after;
  }
  async #beforeNativeChunk(read) {
    const observed = await this.#nativeIdentity(read.handle);
    if (!sameIdentity(read.identity, observed, false))
      throw this.#fail('FILE_CHANGED', 'The original native file was modified. Reopen its original artifact explicitly.');
    if (read.identity.ctimeNs !== observed.ctimeNs) {
      // Rename/unlink can change ctime without changing the opened file. Prove
      // the same complete bytes on that descriptor before accepting a new ctime.
      // Never accept a changed chunk and then try to repair it by rehashing.
      const verified = await this.#verifyNative(read.handle, read.size, read.metadata.sha256, read.scope, read);
      if (!sameIdentity(read.identity, verified, false))
        throw this.#fail('FILE_CHANGED', 'The original native file identity changed while it was rechecked.');
      read.identity = verified;
    }
    return read.identity;
  }
  #open({ scope, key, kind, directory, load, expectedSha256 }) {
    // One original loader/hash is admitted at a time. Later chunks reuse its
    // immutable memory/private snapshot or the same owned native descriptor.
    const pending = this.#readTail.then(async () => {
      this.#assertOpening(scope);
      if (this.#reads.size >= SNAPSHOT_COUNT_LIMIT)
        throw this.#fail('READ_CAPACITY', 'Finish or release an existing file read before opening another.');
      this.#readStats.set(scope, (this.#readStats.get(scope) ?? 0) + 1);
      let read = null, ownedHandle = null;
      try {
        const original = await load();
        const native = original?.readonlyFileHandle !== undefined;
        // Take ownership before observing a concurrent close. Once load returns,
        // even a refused scope/hash/size must dispose this newly owned handle.
        if (native) ownedHandle = this.#ownNativeHandle(original.readonlyFileHandle);
        this.#assertOpening(scope);
        let size, sha;
        if (native) {
          size = original.bytes; sha = original.sha256;
          if (!Number.isSafeInteger(size) || size < 0 || size > MAX_RETAINED_IMMUTABLE_FILE_BYTES ||
              typeof sha !== 'string' || !SHA256.test(sha) || typeof original.name !== 'string' || !original.name)
            throw this.#fail('FILE_SOURCE_INVALID', 'Use exact native file metadata with a SHA256 and a byte count up to 8 GiB.');
          if (expectedSha256 && sha !== expectedSha256)
            throw this.#fail('FILE_CHANGED', 'The native file metadata differs from the requested SHA256.');
        } else {
          size = original.bytes.length; sha = digest(original.bytes);
          if (expectedSha256 && sha !== expectedSha256)
            throw this.#fail('FILE_CHANGED', 'The original file differs from the requested SHA256.');
          if (size > SNAPSHOT_BYTES_LIMIT - this.summary.snapshotBytes)
            throw this.#fail('READ_CAPACITY', 'Finish or release existing reads to make room within the 256 MB verified-snapshot budget.');
        }
        read = { id: randomUUID(), key, scope, kind, size, native, tail: Promise.resolve(),
          closed: false, memory: null, handle: ownedHandle,
          metadata: { name: original.name, contentType: original.type ?? (original.name.endsWith('.json') ? 'application/json'
            : original.name.endsWith('.tar') ? 'application/x-tar' : 'application/octet-stream'), bytes: size, sha256: sha } };
        if (native) read.identity = await this.#verifyNative(read.handle, size, sha, scope);
        else if (size <= MEMORY_SNAPSHOT_LIMIT) read.memory = original.bytes;
        else {
          // Existing Buffer owners retain their original private verified copy.
          const temporary = await mkdtemp(join(directory, '.mcp-read-')), path = join(temporary, 'snapshot');
          try {
            read.handle = await open(path, 'wx+', 0o600);
            await read.handle.writeFile(original.bytes); await unlink(path); await rmdir(temporary);
          } catch (error) {
            await read.handle?.close(); read.handle = null;
            await unlink(path).catch(() => {}); await rmdir(temporary).catch(() => {}); throw error;
          }
        }
        this.#assertOpening(scope);
        this.#reads.set(read.id, read); this.#touch(read); return read;
      } catch (error) {
        if (read) await this.#dispose(read).catch(() => {});
        else if (ownedHandle) await ownedHandle.close().catch(() => {});
        if (ownedHandle && !String(error.code ?? '').startsWith(this.#prefix + '_'))
          throw this.#fail('SNAPSHOT_UNAVAILABLE', 'The original native descriptor could not be verified. Reopen its original artifact.');
        throw error;
      }
    });
    this.#readTail = pending.then(() => {}, () => {});
    return pending;
  }
  async read(options) {
    const { scope, key, readId, expectedSha256, offset = 0, limit = 65536 } = options;
    this.#assertOpening(scope);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RETAINED_CHUNK_BYTES ||
        expectedSha256 !== undefined && !SHA256.test(expectedSha256))
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
      try {
        const identity = read.native ? await this.#beforeNativeChunk(read) : null;
        const length = Math.min(limit, read.size - offset), chunk = read.memory ? read.memory.subarray(offset, offset + length) : Buffer.alloc(length);
        if (read.handle) {
          let position = 0;
          while (position < length) {
            const result = await read.handle.read(chunk, position, length - position, offset + position);
            if (!result.bytesRead) throw this.#fail('SNAPSHOT_UNAVAILABLE', 'The private verified read snapshot is unavailable.');
            position += result.bytesRead;
          }
        }
        if (read.native && !sameIdentity(identity, await this.#nativeIdentity(read.handle)))
          throw this.#fail('FILE_CHANGED', 'The native file changed while this chunk was read. No bytes from that chunk were accepted.');
        const next = offset + length, result = { readId: read.id, file: read.metadata, offset, bytesRead: length,
          nextOffset: next < read.size ? next : null, encoding: 'base64', data: chunk.toString('base64') };
        if (next === read.size) await this.#dispose(read);
        return result;
      } catch (error) {
        if (read.native) {
          await this.#dispose(read).catch(() => {});
          if (!String(error.code ?? '').startsWith(this.#prefix + '_'))
            throw this.#fail('SNAPSHOT_UNAVAILABLE', 'The original native descriptor is unavailable. Reopen its original artifact.');
        }
        throw error;
      }
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
