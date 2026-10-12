// MIT. Stream the complete reviewed 2BA dataset and processing file as one ZIP64 archive.
// ZIP layout: PKWARE APPNOTE 6.3.10 §§4.3.7–4.3.16 and 4.5.3.
// https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
import { createDeflateRaw } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fail } from '../model.mjs';

const CHUNK = 64 * 1024;
const MAX_FILE = 8 * 1024 ** 3;
const MAX_ARCHIVE = 8 * 1024 ** 3;
const FLAGS = 0x0808; // UTF-8 names and trailing data descriptors.
const VERSION = 45;
const DOS_DATE = 33; // 1980-01-01; archive metadata is deterministic.
const CRC = new Uint32Array(256);
for (let n = 0; n < CRC.length; n++) {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC[n] = value >>> 0;
}
const crc32 = (state, bytes) => {
  for (const byte of bytes) state = CRC[(state ^ byte) & 255] ^ (state >>> 8);
  return state >>> 0;
};
function field64(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('TWO_BA_ARCHIVE_SIZE', 'Archive lengths must be exact nonnegative integers.');
  return BigInt(value);
}
function memberName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(value) ||
      value === '.' || value === '..')
    fail('TWO_BA_ARCHIVE_NAME', 'The recipient archive requires flat, portable original file names.');
  return Buffer.from(value, 'utf8');
}
function localHeader(name) {
  const header = Buffer.alloc(30), extra = Buffer.alloc(20);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(VERSION, 4); header.writeUInt16LE(FLAGS, 6);
  header.writeUInt16LE(8, 8); header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(0xffffffff, 18); header.writeUInt32LE(0xffffffff, 22);
  header.writeUInt16LE(name.length, 26); header.writeUInt16LE(extra.length, 28);
  extra.writeUInt16LE(1, 0); extra.writeUInt16LE(16, 2);
  // Unknown streamed lengths are supplied by the ZIP64 data descriptor.
  return Buffer.concat([header, name, extra]);
}
function dataDescriptor(row) {
  const result = Buffer.alloc(24);
  result.writeUInt32LE(0x08074b50, 0); result.writeUInt32LE(row.crc32, 4);
  result.writeBigUInt64LE(field64(row.compressedBytes), 8);
  result.writeBigUInt64LE(field64(row.bytes), 16);
  return result;
}
function centralHeader(row) {
  const header = Buffer.alloc(46), extra = Buffer.alloc(28), name = memberName(row.name);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x032d, 4); header.writeUInt16LE(VERSION, 6);
  header.writeUInt16LE(FLAGS, 8); header.writeUInt16LE(8, 10);
  header.writeUInt16LE(DOS_DATE, 14); header.writeUInt32LE(row.crc32, 16);
  header.writeUInt32LE(0xffffffff, 20); header.writeUInt32LE(0xffffffff, 24);
  header.writeUInt16LE(name.length, 28); header.writeUInt16LE(extra.length, 30);
  header.writeUInt32LE((0o100600 * 65536) >>> 0, 38);
  header.writeUInt32LE(0xffffffff, 42);
  extra.writeUInt16LE(1, 0); extra.writeUInt16LE(24, 2);
  extra.writeBigUInt64LE(field64(row.bytes), 4);
  extra.writeBigUInt64LE(field64(row.compressedBytes), 12);
  extra.writeBigUInt64LE(field64(row.offset), 20);
  return Buffer.concat([header, name, extra]);
}
function ending(count, centralOffset, centralBytes, endOffset) {
  const zip64 = Buffer.alloc(56), locator = Buffer.alloc(20), end = Buffer.alloc(22);
  zip64.writeUInt32LE(0x06064b50, 0); zip64.writeBigUInt64LE(44n, 4);
  zip64.writeUInt16LE(0x032d, 12); zip64.writeUInt16LE(VERSION, 14);
  zip64.writeBigUInt64LE(field64(count), 24); zip64.writeBigUInt64LE(field64(count), 32);
  zip64.writeBigUInt64LE(field64(centralBytes), 40);
  zip64.writeBigUInt64LE(field64(centralOffset), 48);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(field64(endOffset), 8); locator.writeUInt32LE(1, 16);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0xffff, 8); end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12); end.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([zip64, locator, end]);
}
async function* sourceChunks(body) {
  const values = typeof body === 'string' || body instanceof Uint8Array ? [body] : body;
  if (!values || !(Symbol.iterator in Object(values) || Symbol.asyncIterator in Object(values)))
    fail('TWO_BA_ARCHIVE_BODY', 'The complete original export must provide a byte or UTF-8 text stream.');
  const encoder = new TextEncoder();
  let pending = Buffer.allocUnsafe(CHUNK), used = 0;
  for await (const value of values) {
    if (typeof value === 'string') {
      let offset = 0;
      while (offset < value.length) {
        const next = encoder.encodeInto(value.slice(offset), pending.subarray(used));
        offset += next.read; used += next.written;
        if (used > CHUNK - 4 || next.read === 0) {
          if (used) yield pending.subarray(0, used);
          pending = Buffer.allocUnsafe(CHUNK); used = 0;
        }
      }
    } else if (value instanceof Uint8Array) {
      let offset = 0;
      while (offset < value.byteLength) {
        const size = Math.min(CHUNK - used, value.byteLength - offset);
        pending.set(value.subarray(offset, offset + size), used);
        offset += size; used += size;
        if (used === CHUNK) { yield pending; pending = Buffer.allocUnsafe(CHUNK); used = 0; }
      }
    } else fail('TWO_BA_ARCHIVE_BODY', 'The original export contains a value that is not a byte or UTF-8 text chunk.');
  }
  if (used) yield pending.subarray(0, used);
}

/**
 * The original caller owns the immutable review/snapshot and consumes this body
 * before closing it. Cancellation drains both streams and the original row
 * iterator through Readable.from; no archive file or independent writer exists.
 */
export async function* streamTwoBaArchive(members) {
  if (!Array.isArray(members) || members.length !== 2 ||
      members[0]?.name !== 'parameters.xml' ||
      typeof members[1]?.name !== 'string' || !/^ETIM_XCHANGE_[A-Za-z0-9_-]+[.]json$/.test(members[1].name))
    fail('TWO_BA_ARCHIVE_MEMBERS', 'The complete recipient package contains parameters.xml and its native ETIM_XCHANGE JSON file.');
  const selected = members.map(row => {
    memberName(row.name);
    if (typeof row.open !== 'function') fail('TWO_BA_ARCHIVE_BODY', 'Each original member needs its owned source factory.');
    return { name: row.name, open: row.open };
  });
  let offset = 0;
  const directory = [], account = chunk => {
    offset += chunk.byteLength;
    if (offset > MAX_ARCHIVE) fail('TWO_BA_ARCHIVE_SIZE', 'The complete recipient ZIP exceeds the original 8 GiB retained-file limit.');
    return chunk;
  };
  for (const member of selected) {
    const row = { name: member.name, offset, bytes: 0, compressedBytes: 0, crc32: 0 };
    yield account(localHeader(memberName(member.name)));
    let crc = 0xffffffff, completed = false, original;
    const input = Readable.from((async function* () {
      original = await member.open();
      for await (const chunk of sourceChunks(original)) {
        row.bytes += chunk.length;
        if (row.bytes > MAX_FILE) fail('TWO_BA_ARCHIVE_SIZE', 'A complete recipient member exceeds the original 8 GiB file limit.');
        crc = crc32(crc, chunk);
        yield chunk;
      }
    })(), { objectMode: false, highWaterMark: CHUNK });
    const compressed = createDeflateRaw({ level: 6, chunkSize: CHUNK, readableHighWaterMark: CHUNK, writableHighWaterMark: CHUNK });
    const pumping = pipeline(input, compressed);
    // Attach a rejection observer immediately; the same rejection is awaited
    // after consumption and the compressor also forwards source failures.
    const settled = pumping.then(() => null, error => error);
    try {
      for await (const chunk of compressed) {
        row.compressedBytes += chunk.length;
        yield account(chunk);
      }
      const error = await settled;
      if (error) throw error;
      if (!row.bytes) fail('TWO_BA_ARCHIVE_EMPTY', 'The complete processing and dataset files must both be nonempty.');
      row.crc32 = (crc ^ 0xffffffff) >>> 0;
      completed = true;
    } finally {
      if (!completed) { input.destroy(); compressed.destroy(); }
      await settled;
    }
    yield account(dataDescriptor(row));
    directory.push(row);
  }
  const centralOffset = offset;
  for (const row of directory) yield account(centralHeader(row));
  const centralBytes = offset - centralOffset, endOffset = offset;
  yield account(ending(directory.length, centralOffset, centralBytes, endOffset));
}

export function twoBaArchiveDescriptor({ review, dataset, parameters }) {
  if (!review || typeof review.id !== 'string' || !/^[a-f0-9]{32}$/.test(review.id) ||
      !review.recipient || review.plan?.profile?.target !== '2ba-xchange-2.0')
    fail('TWO_BA_REVIEW_REQUIRED', 'Select the original immutable 2BA xChange recipient review.');
  if (review.counts?.errors || !review.counts?.total)
    fail('TWO_BA_CORRECTIONS_REQUIRED', 'Resolve the selected recipient review before creating its complete upload package.');
  if (!dataset || typeof dataset.filename !== 'string' || dataset.body === undefined)
    fail('TWO_BA_DATASET_REQUIRED', 'Use the original complete native xChange export.');
  if (!parameters || parameters.filename !== 'parameters.xml' || typeof parameters.body !== 'string' ||
      Buffer.byteLength(parameters.body) > 64 * 1024)
    fail('TWO_BA_PARAMETERS_REQUIRED', 'Use the selected original processing parameters.');
  const xml = parameters.body, name = dataset.filename, body = dataset.body;
  memberName(name);
  return { type: 'application/zip',
    filename: 'ETIM_XCHANGE_' + review.id + '_2BA.zip',
    body: streamTwoBaArchive([
      { name: 'parameters.xml', open: () => xml },
      { name, open: () => body }
    ]) };
}
