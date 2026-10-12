// MIT. Original native descriptor reader shared by WebDAV and feed delivery.
import { randomUUID } from 'node:crypto';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
const SHA256 = /^[a-f0-9]{64}$/;
const fileStamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
const count = (value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw Object.assign(new Error(`${label} must be an integer from ${minimum} to ${maximum}.`), { code: 'INVALID_PARAMS' });
  return value;
};

/** Retain native read-only file handles, so large source packets need no duplicate snapshot. */
export class RetainedSourceFileReads {
  #prefix;
  constructor({ errorPrefix = 'SOURCE_FILE' } = {}) { this.#prefix = errorPrefix; }
  #failure(code, message) { return Object.assign(new Error(message), { code: this.#prefix + '_' + code }); }
  #reads = new Map(); #opening = Promise.resolve(); #closing = false;
  summary(scope) { return [...this.#reads.values()].filter(row => scope === undefined || row.scope === scope)
    .map(row => ({ readId: row.id, file: row.metadata, expiresAt: row.expiresAt })); }
  #touch(row) {
    clearTimeout(row.timer); row.expiresAt = new Date(Date.now() + 120000).toISOString();
    row.timer = setTimeout(() => { void this.release(row.scope, row.id).catch(() => {}); }, 120000); row.timer.unref();
  }
  async #dispose(row) {
    if (row.disposal) return row.disposal;
    row.closed = true; clearTimeout(row.timer);
    row.disposal = row.handle.close().finally(() => this.#reads.delete(row.id));
    return row.disposal;
  }
  async release(scope, id) {
    const row = this.#reads.get(id); if (!row) return false;
    if (row.scope !== scope) throw this.#failure('READ_CONFLICT', 'Select a read from this workspace.');
    row.releasing = true; clearTimeout(row.timer); await row.tail.catch(() => {}); await this.#dispose(row); return true;
  }
  async closeScope(scope) {
    await this.#opening.catch(() => {});
    await Promise.all([...this.#reads.values()].filter(row => row.scope === scope).map(row => this.release(scope, row.id)));
  }
  async close() { this.#closing = true; await this.#opening.catch(() => {}); await Promise.all([...this.#reads.values()].map(row => this.release(row.scope, row.id))); }
  async read({ scope, key, load, readId, expectedSha256, offset = 0, limit = 65536 }) {
    if (this.#closing) throw this.#failure('READ_CLOSING', 'File delivery is closing.');
    count(offset, 'Byte offset'); count(limit, 'Chunk size', 1, MAX_RETAINED_CHUNK_BYTES);
    if (expectedSha256 !== undefined && !SHA256.test(expectedSha256) || (offset > 0 || readId) && !expectedSha256)
      throw this.#failure('INVALID_CHUNK', 'Use the original SHA256 for every continued or resumed read.');
    let row = readId ? this.#reads.get(readId) : null;
    if (!readId) {
      const pending = this.#opening.then(async () => {
        if (this.#closing || this.#reads.size >= 4) throw this.#failure('READ_CAPACITY', 'Finish or release an existing native file read.');
        const original = await load();
        try {
          const before = await original.handle.stat({ bigint: true });
          if (!before.isFile() || before.size !== BigInt(original.size) || !SHA256.test(original.sha256 ?? '') ||
              expectedSha256 && original.sha256 !== expectedSha256)
            throw this.#failure('FILE_CHANGED', 'The original retained file differs from the selected identity.');
          const selected = { id: randomUUID(), scope, key, handle: original.handle, stamp: fileStamp(before),
            metadata: { name: original.filename, contentType: original.contentType, bytes: original.size, sha256: original.sha256 },
            tail: Promise.resolve(), closed: false, releasing: false };
          this.#reads.set(selected.id, selected); this.#touch(selected); return selected;
        } catch (error) { await original.handle.close(); throw error; }
      });
      this.#opening = pending.then(() => {}, () => {}); row = await pending;
    }
    if (!row || row.closed || row.releasing) throw this.#failure('READ_NOT_FOUND', 'Resume the original file with the same SHA256 and byte offset, omitting the expired readId.');
    if (row.scope !== scope || row.key !== key || expectedSha256 && row.metadata.sha256 !== expectedSha256)
      throw this.#failure('READ_CONFLICT', 'This read belongs to another original file selection.');
    if (offset > row.metadata.bytes) { if (!readId) await this.release(scope, row.id); throw this.#failure('INVALID_CHUNK', 'The offset exceeds the original file.'); }
    const pending = row.tail.then(async () => {
      try {
        if (row.closed || fileStamp(await row.handle.stat({ bigint: true })) !== row.stamp)
          throw this.#failure('FILE_CHANGED', 'The original file changed during delivery.');
        this.#touch(row);
        const wanted = Math.min(limit, row.metadata.bytes - offset), bytes = Buffer.alloc(wanted); let used = 0;
        while (used < wanted) {
          const part = await row.handle.read(bytes, used, wanted - used, offset + used);
          if (!part.bytesRead) throw this.#failure('FILE_CHANGED', 'The original file ended during delivery.'); used += part.bytesRead;
        }
        if (fileStamp(await row.handle.stat({ bigint: true })) !== row.stamp) throw this.#failure('FILE_CHANGED', 'The original file changed during delivery.');
        const next = offset + used, result = { readId: row.id, file: row.metadata, offset, bytesRead: used,
          nextOffset: next < row.metadata.bytes ? next : null, encoding: 'base64', data: bytes.toString('base64') };
        if (next === row.metadata.bytes) await this.#dispose(row); return result;
      } catch (error) { await this.#dispose(row); throw error; }
    });
    row.tail = pending.then(() => {}, () => {}); return pending;
  }
}

