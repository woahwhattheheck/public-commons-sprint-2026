// MIT — Stream the original portable dossier JSON through files and HTTP.
import { constants } from 'node:fs';
import { open, link, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';
import { absolute, need, BuyerError, syncDirectory } from '../node/store.mjs';

export const PORTABLE_LIMIT = 256 * 1024 * 1024;
const VERSION_LIMIT = 8 * 1024 * 1024;
const BLOB_RECORD_LIMIT = Math.ceil(64 * 1024 * 1024 / 3) * 4 + 65536;

function transform(source, codec) {
  source.once('error', error => codec.destroy(error));
  codec.once('close', () => source.destroy());
  return source.pipe(codec);
}

async function decoded(source) {
  need(source && typeof source[Symbol.asyncIterator] === 'function', 'PORTABLE_STREAM_REQUIRED');
  const iterator = source[Symbol.asyncIterator]();
  const first = [];
  let prefixBytes = 0;
  while (prefixBytes < 2) {
    const next = await iterator.next();
    if (next.done) break;
    need(next.value instanceof Uint8Array, 'PORTABLE_STREAM_REQUIRED');
    if (!next.value.length) continue;
    const part = Buffer.from(next.value);
    first.push(part); prefixBytes += part.length;
  }
  const prefix = Buffer.concat(first);
  const stream = Readable.from((async function* () {
    let size = prefix.length;
    try {
      need(size <= PORTABLE_LIMIT, 'PORTABLE_SIZE_LIMIT');
      if (prefix.length) yield prefix;
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        need(next.value instanceof Uint8Array, 'PORTABLE_STREAM_REQUIRED');
        size += next.value.length;
        need(size <= PORTABLE_LIMIT, 'PORTABLE_SIZE_LIMIT');
        yield next.value;
      }
    } finally { await iterator.return?.(); }
  })());
  return prefix[0] === 0x1f && prefix[1] === 0x8b ? transform(stream, createGunzip()) : stream;
}

class JsonCursor {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.decoder = new TextDecoder('utf-8', {fatal: true});
    this.buffer = ''; this.position = 0; this.finished = false; this.bytes = 0;
  }
  async fill() {
    while (this.position >= this.buffer.length && !this.finished) {
      const next = await this.iterator.next();
      this.position = 0;
      if (next.done) {
        this.finished = true; this.buffer = this.decoder.decode();
      } else {
        this.bytes += next.value.length;
        need(this.bytes <= PORTABLE_LIMIT, 'PORTABLE_SIZE_LIMIT');
        this.buffer = this.decoder.decode(next.value, {stream: true});
      }
    }
    return this.position < this.buffer.length;
  }
  async space() {
    while (await this.fill()) {
      while (this.position < this.buffer.length && /[ \t\r\n]/.test(this.buffer[this.position])) this.position++;
      if (this.position < this.buffer.length) return;
    }
  }
  async peek() { await this.space(); return this.buffer[this.position] ?? null; }
  async expect(character) {
    need(await this.peek() === character, 'PORTABLE_JSON_INVALID');
    this.position++;
  }
  async value(limit) {
    await this.space();
    const first = this.buffer[this.position];
    need(first !== undefined && !',]}:'.includes(first), 'PORTABLE_JSON_INVALID');
    const container = first === '{' || first === '[';
    const scalarString = first === '"';
    const parts = [];
    let depth = 0, quoted = false, escaped = false, complete = false, bytes = 0;
    while (await this.fill()) {
      const start = this.position;
      while (this.position < this.buffer.length) {
        const character = this.buffer[this.position];
        if (!container && !scalarString && /[ \t\r\n,\]}]/.test(character)) { complete = true; break; }
        this.position++;
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') {
            quoted = false;
            if (scalarString && depth === 0) { complete = true; break; }
          }
        } else if (character === '"') quoted = true;
        else if (character === '{' || character === '[') depth++;
        else if (character === '}' || character === ']') {
          depth--;
          if (container && depth === 0) { complete = true; break; }
        }
      }
      const part = this.buffer.slice(start, this.position);
      bytes += Buffer.byteLength(part); need(bytes <= limit, 'PORTABLE_RECORD_SIZE_LIMIT');
      parts.push(part);
      if (complete) break;
    }
    need(complete || (!container && !scalarString && !quoted && parts.length), 'PORTABLE_TRUNCATED');
    try { return JSON.parse(parts.join('')); }
    catch { throw new BuyerError('PORTABLE_JSON_INVALID'); }
  }
  async close() { await this.iterator.return?.(); }
}

// Top-level fields may be in any order. Each original revision/blob is yielded
// alone; the original v1 wire schema and its exact source bytes remain intact.
export async function* portableEntries(source) {
  const cursor = new JsonCursor(await decoded(source));
  const seen = new Set();
  try {
    await cursor.expect('{');
    if (await cursor.peek() !== '}') {
      while (true) {
        const key = await cursor.value(1024);
        need(typeof key === 'string' && !seen.has(key), 'PORTABLE_FIELD_INVALID');
        seen.add(key); await cursor.expect(':');
        if (key === 'versions' || key === 'blobs') {
          await cursor.expect('[');
          let index = 0;
          if (await cursor.peek() !== ']') {
            while (true) {
              const value = await cursor.value(key === 'versions' ? VERSION_LIMIT : BLOB_RECORD_LIMIT);
              yield {kind: key, index: index++, value};
              const next = await cursor.peek();
              if (next === ']') break;
              await cursor.expect(',');
            }
          }
          await cursor.expect(']');
          yield {kind: 'array', key, count: index};
        } else {
          yield {kind: 'field', key, value: await cursor.value(65536)};
        }
        if (await cursor.peek() === '}') break;
        await cursor.expect(',');
      }
    }
    await cursor.expect('}');
    need(await cursor.peek() === null, 'PORTABLE_TRAILING_DATA');
  } catch (error) {
    if (error instanceof TypeError) throw new BuyerError('PORTABLE_JSON_INVALID');
    throw error;
  } finally { await cursor.close(); }
}

export function encodePortable(chunks, {compression = 'none'} = {}) {
  need(['none', 'gzip'].includes(compression), 'PORTABLE_COMPRESSION_INVALID');
  const source = Readable.from((async function* () {
    let bytes = 0;
    for await (const chunk of chunks) {
      bytes += Buffer.byteLength(chunk);
      need(bytes <= PORTABLE_LIMIT, 'PORTABLE_SIZE_LIMIT');
      yield chunk;
    }
  })());
  return compression === 'gzip' ? transform(source, createGzip()) : source;
}

export async function openPortableFile(file) {
  const handle = await open(absolute(file), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    need(info.isFile() && info.size <= PORTABLE_LIMIT, 'FILE_SIZE_OR_TYPE_INVALID');
    return handle.createReadStream({autoClose: true});
  } catch (error) { await handle.close(); throw error; }
}

export async function writePortableFile(file, exported) {
  file = absolute(file);
  const temporary = join(dirname(file), '.portable-write-' + randomUUID());
  let handle;
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    handle = await open(temporary, 'wx', 0o600);
    for await (const chunk of exported.body) {
      const body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      await handle.writeFile(body); hash.update(body); bytes += body.length;
    }
    await handle.sync(); await handle.close(); handle = undefined;
    await link(temporary, file); await unlink(temporary); await syncDirectory(dirname(file));
    return {file, filename: exported.filename, contentType: exported.contentType,
      bytes, sha256: hash.digest('hex')};
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
