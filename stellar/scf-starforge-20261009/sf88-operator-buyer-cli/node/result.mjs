// MIT — Consume the original SF31 saved response, not seller payment claims.
import { constants } from 'node:fs';
import { open, link, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { absolute, need, BuyerError, syncDirectory } from './store.mjs';

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export class BuyerResult {
  constructor(record, responseFile) {
    this.record = freeze(structuredClone(record));
    this.responseFile = freeze(structuredClone(responseFile));
  }
  get native() { return this.record.native; }
  get status() { return this.native.status; }
  get delivery() { return this.native.responseFile ?? { status: 'NOT_REQUESTED' }; }
  get ok() {
    return this.record.exitCode === 0 && !this.record.runtimeError &&
      Number.isInteger(this.native.httpStatus) && this.native.httpStatus >= 200 && this.native.httpStatus < 300 &&
      !this.native.error && !this.native.evidenceError && !this.native.responseCleanupError;
  }
  raiseForStatus() {
    if (!this.ok) throw new BuyerError(this.record.runtimeError ?? 'NATIVE_ATTEMPT_NOT_SUCCESSFUL', { exitCode: this.record.exitCode });
    return this;
  }
  _metadata() {
    const saved = this.delivery;
    need(saved.status === 'SAVED', 'RESPONSE_NOT_SAVED');
    need(this.responseFile && typeof saved.path === 'string' &&
      absolute(saved.path) === absolute(this.responseFile.destination) &&
      Number.isSafeInteger(saved.bytes) && saved.bytes >= 0 && saved.bytes <= this.responseFile.maxBytes &&
      typeof saved.sha256 === 'string' && /^[a-f0-9]{64}$/.test(saved.sha256), 'RESPONSE_FILE_METADATA_INVALID');
    return saved;
  }
  async *_read({ chunkSize = 65536, signal } = {}) {
    need(Number.isSafeInteger(chunkSize) && chunkSize > 0 && chunkSize <= 1048576, 'CHUNK_SIZE_INVALID');
    need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
    const saved = this._metadata();
    const handle = await open(saved.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      need(stat.isFile() && stat.size === saved.bytes, 'RESPONSE_FILE_CHANGED');
      const hash = createHash('sha256');
      let position = 0;
      while (position < saved.bytes) {
        need(!signal?.aborted, 'RESPONSE_READ_ABORTED');
        const buffer = Buffer.allocUnsafe(Math.min(chunkSize, saved.bytes - position));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        need(bytesRead > 0, 'RESPONSE_FILE_CHANGED');
        const chunk = buffer.subarray(0, bytesRead);
        position += bytesRead; hash.update(chunk);
        yield chunk;
      }
      const after = await handle.stat();
      need(after.size === saved.bytes && after.mtimeMs === stat.mtimeMs &&
        after.ctimeMs === stat.ctimeMs && hash.digest('hex') === saved.sha256, 'RESPONSE_FILE_CHANGED');
    } finally { await handle.close(); }
  }
  async verify(options) {
    for await (const _chunk of this._read(options)) { /* Hash without buffering. */ }
    return { bytes: this.delivery.bytes, sha256: this.delivery.sha256 };
  }
  async *chunks(options) {
    // First validate the saved object, then stream with a second complete check.
    // Consumers must exhaust the iterator before committing external side effects.
    await this.verify(options);
    yield* this._read(options);
  }
  async bytes({ limit = 8388608, signal } = {}) {
    need(Number.isSafeInteger(limit) && limit >= 0, 'READ_LIMIT_INVALID');
    need(this._metadata().bytes <= limit, 'READ_LIMIT_EXCEEDED_USE_CHUNKS');
    const parts = [];
    for await (const part of this._read({ signal })) parts.push(part);
    return Buffer.concat(parts);
  }
  async json(options) {
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await this.bytes(options))); }
    catch (error) { if (error instanceof BuyerError) throw error; throw new BuyerError('RESPONSE_JSON_INVALID'); }
  }
  async *csvRows({ headers = false, maxFieldCharacters = 1048576, signal } = {}) {
    need(typeof headers === 'boolean' && Number.isSafeInteger(maxFieldCharacters) && maxFieldCharacters > 0, 'CSV_OPTIONS_INVALID');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let state = 'FIELD', field = '', row = [], touched = false, skipLF = false, names = null, first = true;
    const finish = () => {
      const value = [...row, field]; row = []; field = ''; touched = false;
      if (!headers) return value;
      if (names === null) {
        need(value.every(name => name.length > 0) && new Set(value).size === value.length, 'CSV_HEADER_INVALID');
        names = value; return null;
      }
      need(value.length === names.length, 'CSV_COLUMN_COUNT_MISMATCH');
      return Object.assign(Object.create(null), Object.fromEntries(names.map((name, index) => [name, value[index]])));
    };
    function* parse(text) {
      for (const character of text) {
        if (first) { first = false; if (character === '\ufeff') continue; }
        if (skipLF) { skipLF = false; if (character === '\n') continue; }
        if (state === 'QUOTED') {
          if (character === '"') state = 'CLOSED';
          else field += character;
        } else if (state === 'CLOSED' && character === '"') { field += '"'; state = 'QUOTED'; }
        else if (character === ',' || character === '\n' || character === '\r') {
          if (character === ',') { row.push(field); field = ''; touched = true; }
          else { const value = finish(); if (value !== null) yield value; skipLF = character === '\r'; }
          state = 'FIELD';
        } else if (state === 'CLOSED') throw new BuyerError('CSV_CHARACTERS_AFTER_QUOTE');
        else if (character === '"') { need(field.length === 0, 'CSV_QUOTE_IN_UNQUOTED_FIELD'); state = 'QUOTED'; touched = true; }
        else { field += character; touched = true; }
        need(field.length <= maxFieldCharacters, 'CSV_FIELD_LIMIT');
      }
    }
    try {
      for await (const chunk of this.chunks({ signal })) yield* parse(decoder.decode(chunk, { stream: true }));
      yield* parse(decoder.decode());
    } catch (error) { if (error instanceof BuyerError) throw error; throw new BuyerError('CSV_UTF8_OR_IO_INVALID'); }
    need(state !== 'QUOTED', 'CSV_UNTERMINATED_QUOTE');
    if (touched || field.length || row.length) { const value = finish(); if (value !== null) yield value; }
  }
  async saveAs(destination, { signal } = {}) {
    destination = absolute(destination);
    const temporary = join(dirname(destination), `.download-${randomUUID()}`);
    const target = await open(temporary, 'wx', 0o600);
    let closed = false;
    try {
      for await (const chunk of this._read({ signal })) await target.writeFile(chunk);
      await target.sync(); await target.close(); closed = true;
      // Publish only after complete hash verification; never replace caller files.
      await link(temporary, destination);
      await unlink(temporary);
      await syncDirectory(dirname(destination));
      return destination;
    } finally {
      if (!closed) await target.close();
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}
