// MIT. Bounded standard ZIP output for one complete scientific application result.
import { open } from 'node:fs/promises';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createDeflateRaw } from 'node:zlib';

const CRC = new Uint32Array(256);
for (let i = 0; i < CRC.length; i++) {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC[i] = value >>> 0;
}
const fail = code => { throw Object.assign(new Error(code), { code }); };
const header = (length, signature) => { const bytes = Buffer.alloc(length); bytes.writeUInt32LE(signature, 0); return bytes; };
const validPath = name => typeof name === 'string' && Buffer.byteLength(name) <= 240 &&
  /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(name) && !name.split('/').some(part => !part || part === '.' || part === '..');

/** Fixed metadata makes repeated execution of the same original job byte reproducible. */
export async function createScientificArchive(path, { signal, maxBytes = 67108864, maxLogicalBytes = 536870912 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 22 || maxBytes > 67108864) fail('JOB_OUTPUT_TOO_LARGE');
  let file = await open(path, 'wx', 0o600), position = 0, logical = 0, finished = false, busy = false;
  const entries = [], names = new Set();
  const active = () => { signal?.throwIfAborted(); if (!file || finished) fail('JOB_OUTPUT_ARCHIVE_CLOSED'); };
  async function write(bytes) {
    active();
    if (position + bytes.length > maxBytes) fail('JOB_OUTPUT_TOO_LARGE');
    let used = 0;
    while (used < bytes.length) {
      signal?.throwIfAborted();
      const result = await file.write(bytes, used, bytes.length - used, position);
      if (result.bytesWritten < 1) fail('JOB_OUTPUT_ARCHIVE_WRITE_FAILED');
      used += result.bytesWritten; position += result.bytesWritten;
    }
  }
  async function add(name, source, { contentType = 'application/octet-stream', expected } = {}) {
    active();
    if (busy || !validPath(name) || names.has(name) || entries.length >= 128) fail('JOB_OUTPUT_ARCHIVE_MEMBER_INVALID');
    busy = true;
    const filename = Buffer.from(name), start = position, local = header(30, 0x04034b50), flags = 0x0808;
    local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12); local.writeUInt16LE(filename.length, 26);
    let crc = 0xffffffff, count = 0, compressed = 0;
    const digest = createHash('sha256'), deflater = createDeflateRaw({ level: 6 });
    deflater.on('error', () => {});
    const cancelled = () => deflater.destroy(signal.reason ?? new Error('JOB_EXECUTION_CANCELLED'));
    signal?.addEventListener('abort', cancelled, { once: true });
    try {
      await write(local); await write(filename);
      const chunks = source instanceof Uint8Array ? [source] : source;
      if (!chunks || typeof chunks[Symbol.asyncIterator] !== 'function' && typeof chunks[Symbol.iterator] !== 'function')
        fail('JOB_OUTPUT_ARCHIVE_SOURCE_INVALID');
      const producer = (async () => {
        for await (const part of chunks) {
          signal?.throwIfAborted();
          if (!(part instanceof Uint8Array)) fail('JOB_OUTPUT_ARCHIVE_SOURCE_INVALID');
          const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part.buffer, part.byteOffset, part.byteLength);
          count += bytes.length;
          if (logical + count > maxLogicalBytes || count > 268435456) fail('JOB_OUTPUT_TOO_LARGE');
          digest.update(bytes);
          for (const byte of bytes) crc = CRC[(crc ^ byte) & 255] ^ (crc >>> 8);
          if (!deflater.write(bytes)) await once(deflater, 'drain', { signal });
        }
        deflater.end();
      })();
      producer.catch(error => deflater.destroy(error));
      try {
        for await (const bytes of deflater) { compressed += bytes.length; await write(bytes); }
        await producer;
      } catch (error) { deflater.destroy(error); await producer.catch(() => {}); throw error; }
      const sha256 = digest.digest('hex');
      if (expected && (expected.bytes !== count || expected.sha256 !== sha256)) fail('JOB_INPUT_ORIGINAL_BYTES_CHANGED');
      crc = (crc ^ 0xffffffff) >>> 0;
      const descriptor = header(16, 0x08074b50);
      descriptor.writeUInt32LE(crc, 4); descriptor.writeUInt32LE(compressed, 8); descriptor.writeUInt32LE(count, 12);
      await write(descriptor);
      const entry = { path: name, bytes: count, sha256, contentType, compressedBytes: compressed };
      entries.push({ entry, filename, start, flags, crc }); names.add(name); logical += count;
      return { ...entry };
    } finally {
      signal?.removeEventListener('abort', cancelled); deflater.destroy(); busy = false;
    }
  }
  async function finish() {
    active();
    if (busy) fail('JOB_OUTPUT_ARCHIVE_BUSY');
    const start = position;
    for (const value of entries) {
      const { entry, filename, flags, crc } = value, central = header(46, 0x02014b50);
      central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8);
      central.writeUInt16LE(8, 10); central.writeUInt16LE(33, 14); central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(entry.compressedBytes, 20); central.writeUInt32LE(entry.bytes, 24);
      central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      central.writeUInt32LE(value.start, 42); await write(central); await write(filename);
    }
    const size = position - start, end = header(22, 0x06054b50);
    end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(size, 12); end.writeUInt32LE(start, 16); await write(end);
    await file.sync(); await file.close(); file = null; finished = true;
    return { bytes: position, logicalBytes: logical, members: entries.map(value => ({ ...value.entry })) };
  }
  return Object.freeze({
    add, finish,
    members() { return entries.map(value => ({ ...value.entry })); },
    async close() { if (file) { const current = file; file = null; await current.close(); } },
  });
}
