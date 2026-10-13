// MIT. Streaming, manifest-first tar.gz transport for complete Paycashless deliveries.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createGzip, createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import {
  need, hash, directory, confined, exists, writeExact, jsonBytes, readJSON,
  relativeName, lease, syncDirectory, verifyFile,
} from './files.mjs';
import { readPaycashlessDeliveryManifest, inspectPaycashlessDelivery } from './receiving.mjs';

const BLOCK = 512;
const zero = Buffer.alloc(BLOCK);
const padding = size => (BLOCK - (size % BLOCK)) % BLOCK;

function octal(value, width) {
  need(Number.isSafeInteger(value) && value >= 0, 'INVALID_TAR_NUMBER');
  const text = value.toString(8);
  need(text.length < width, 'TAR_NUMBER_OUT_OF_RANGE');
  return text.padStart(width - 1, '0') + '\0';
}

function header(name, bytes, mode, type = '0') {
  const block = Buffer.alloc(BLOCK);
  need(Buffer.byteLength(name) <= 100, 'TAR_HEADER_NAME_TOO_LONG');
  block.write(name, 0, 100, 'utf8');
  block.write(octal(mode, 8), 100, 8, 'ascii');
  block.write(octal(0, 8), 108, 8, 'ascii');
  block.write(octal(0, 8), 116, 8, 'ascii');
  block.write(octal(bytes, 12), 124, 12, 'ascii');
  block.write(octal(0, 12), 136, 12, 'ascii');
  block.fill(0x20, 148, 156);
  block.write(type, 156, 1, 'ascii');
  block.write('ustar\0', 257, 6, 'ascii');
  block.write('00', 263, 2, 'ascii');
  const checksum = block.reduce((total, byte) => total + byte, 0);
  block.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return block;
}

function paxPath(name) {
  const suffix = ' path=' + name + '\n';
  let size = Buffer.byteLength(suffix) + 1;
  while (true) {
    const next = Buffer.byteLength(suffix) + String(size).length;
    if (next === size) return Buffer.from(String(size) + suffix);
    size = next;
  }
}

export async function streamPaycashlessDelivery({
  sourceDirectory, expectedManifestSha256, signal,
}) {
  const selected = await readPaycashlessDeliveryManifest({ sourceDirectory, expectedManifestSha256 });
  async function* tar() {
    yield header('manifest.json', selected.bytes.length, 0o600);
    yield selected.bytes;
    if (padding(selected.bytes.length)) yield Buffer.alloc(padding(selected.bytes.length));
    let index = 0;
    for (const item of selected.manifest.files) {
      signal?.throwIfAborted();
      await verifyFile(sourceDirectory, item, { mode: true });
      const metadata = paxPath(item.path);
      yield header('PaxHeaders/' + index, metadata.length, 0o600, 'x');
      yield metadata;
      if (padding(metadata.length)) yield Buffer.alloc(padding(metadata.length));
      yield header('member-' + index++, item.bytes, item.mode);
      const file = await confined(sourceDirectory, item.path);
      const handle = await fs.open(file, 'r');
      try {
        const before = await handle.stat({ bigint: true });
        const digest = createHash('sha256');
        let offset = 0;
        while (offset < item.bytes) {
          signal?.throwIfAborted();
          const buffer = Buffer.alloc(Math.min(1024 * 1024, item.bytes - offset));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
          need(bytesRead > 0, 'ARCHIVE_SOURCE_CHANGED');
          const body = buffer.subarray(0, bytesRead);
          digest.update(body);
          offset += bytesRead;
          yield body;
        }
        const after = await handle.stat({ bigint: true });
        need(before.ino === after.ino && before.size === after.size &&
          before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs &&
          digest.digest('hex') === item.sha256, 'ARCHIVE_SOURCE_CHANGED');
      } finally { await handle.close(); }
      if (padding(item.bytes)) yield Buffer.alloc(padding(item.bytes));
    }
    yield zero;
    yield zero;
  }
  const output = createGzip();
  const transfer = pipeline(Readable.from(tar()), output, { signal });
  transfer.catch(error => output.destroy(error));
  return output;
}

class Reader {
  constructor(stream, signal) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.current = Buffer.alloc(0);
    this.offset = 0;
    this.done = false;
    this.signal = signal;
  }

  async read(size, optional = false) {
    const parts = [];
    let length = 0;
    while (length < size) {
      this.signal?.throwIfAborted();
      if (this.offset === this.current.length) {
        const next = await this.iterator.next();
        if (next.done) {
          this.done = true;
          need(optional && length === 0, 'TRUNCATED_ARCHIVE');
          return null;
        }
        this.current = Buffer.from(next.value);
        this.offset = 0;
        if (!this.current.length) continue;
      }
      const take = Math.min(size - length, this.current.length - this.offset);
      parts.push(this.current.subarray(this.offset, this.offset + take));
      this.offset += take;
      length += take;
    }
    return parts.length === 1 ? parts[0] : Buffer.concat(parts, length);
  }

  async discardZeros(size) {
    if (!size) return;
    const bytes = await this.read(size);
    need(bytes.every(byte => byte === 0), 'NONZERO_TAR_PADDING');
  }
}

function field(block, start, length) {
  const bytes = block.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return new TextDecoder('utf-8', { fatal: true }).decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function number(block, start, length) {
  const value = field(block, start, length).trim();
  need(/^[0-7]+$/.test(value), 'INVALID_TAR_NUMBER');
  const parsed = Number.parseInt(value, 8);
  need(Number.isSafeInteger(parsed) && parsed >= 0, 'INVALID_TAR_NUMBER');
  return parsed;
}

function parseHeader(block) {
  const checksum = number(block, 148, 8);
  const copy = Buffer.from(block);
  copy.fill(0x20, 148, 156);
  need(copy.reduce((total, byte) => total + byte, 0) === checksum, 'TAR_CHECKSUM_MISMATCH');
  need(field(block, 257, 6) === 'ustar', 'UNSUPPORTED_TAR_FORMAT');
  need(!field(block, 157, 100), 'ARCHIVE_LINK_REJECTED');
  const prefix = field(block, 345, 155);
  const name = (prefix ? prefix + '/' : '') + field(block, 0, 100);
  return {
    name, bytes: number(block, 124, 12), mode: number(block, 100, 8),
    type: field(block, 156, 1) || '0',
  };
}

function parsePax(bytes) {
  let offset = 0;
  let name = null;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    need(space > offset, 'INVALID_PAX_HEADER');
    const sizeText = bytes.subarray(offset, space).toString('ascii');
    need(/^[1-9][0-9]*$/.test(sizeText), 'INVALID_PAX_LENGTH');
    const size = Number(sizeText);
    need(Number.isSafeInteger(size) && size > space - offset + 1 &&
      offset + size <= bytes.length && bytes[offset + size - 1] === 10, 'INVALID_PAX_LENGTH');
    const value = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(space + 1, offset + size - 1));
    need(value.startsWith('path=') && name === null, 'UNSUPPORTED_PAX_FIELD');
    name = value.slice(5);
    relativeName(name);
    offset += size;
  }
  need(name, 'PAX_PATH_REQUIRED');
  return name;
}

export async function unpackPaycashlessDelivery({
  input, destination, expectedManifestSha256, signal,
  maximumManifestBytes = 16 * 1024 * 1024,
  maximumBytes = 1024 ** 4,
}) {
  need(path.isAbsolute(destination), 'ABSOLUTE_DIRECTORY_REQUIRED');
  await directory(path.dirname(destination));
  const guard = await lease(path.dirname(destination), 'unpack-' + hash(destination));
  const stage = destination + '.unpacking';
  const gunzip = createGunzip();
  const transfer = pipeline(input, gunzip, { signal });
  transfer.catch(error => gunzip.destroy(error));
  const reader = new Reader(gunzip, signal);
  try {
    const firstBlock = await reader.read(BLOCK);
    const first = parseHeader(firstBlock);
    need(first.name === 'manifest.json' && first.type === '0' &&
      first.bytes <= maximumManifestBytes, 'MANIFEST_MUST_BE_FIRST');
    const manifestBytes = await reader.read(first.bytes);
    const manifestSha256 = hash(manifestBytes);
    if (expectedManifestSha256) need(manifestSha256 === expectedManifestSha256,
      'DELIVERY_MANIFEST_MISMATCH');
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
    need(Array.isArray(manifest.files), 'INVALID_DELIVERY_MANIFEST');
    const declared = new Map();
    let total = 0;
    for (const file of manifest.files) {
      relativeName(file.path);
      need(!declared.has(file.path) && file.path !== 'manifest.json',
        'DUPLICATE_DELIVERY_MEMBER');
      need(Number.isSafeInteger(file.bytes) && file.bytes >= 0 &&
        Number.isInteger(file.mode) && file.mode >= 0 && file.mode <= 0o777 &&
        /^[a-f0-9]{64}$/.test(file.sha256), 'INVALID_DELIVERY_DESCRIPTOR');
      total += file.bytes;
      need(Number.isSafeInteger(total) && total <= maximumBytes, 'DELIVERY_TOO_LARGE');
      declared.set(file.path, file);
    }
    await reader.discardZeros(padding(first.bytes));
    const completed = await exists(destination);
    const root = completed ? destination : stage;
    await directory(root);
    await writeExact(path.join(root, 'manifest.json'), manifestBytes);
    const seen = new Set();
    let pax = null;
    while (true) {
      const block = await reader.read(BLOCK);
      if (block.every(byte => byte === 0)) {
        const ending = await reader.read(BLOCK);
        need(ending.every(byte => byte === 0) && !pax, 'INVALID_TAR_END');
        while (true) {
          const remainder = await reader.read(BLOCK, true);
          if (!remainder) break;
          need(remainder.every(byte => byte === 0), 'TRAILING_ARCHIVE_MEMBER');
        }
        break;
      }
      const entry = parseHeader(block);
      if (entry.type === 'x') {
        need(pax === null && entry.bytes <= 1024 * 1024, 'PAX_METADATA_TOO_LARGE');
        pax = parsePax(await reader.read(entry.bytes));
        await reader.discardZeros(padding(entry.bytes));
        continue;
      }
      need(entry.type === '0', 'ARCHIVE_LINK_OR_SPECIAL_FILE_REJECTED');
      const name = pax ?? entry.name;
      pax = null;
      relativeName(name);
      const descriptor = declared.get(name);
      need(descriptor && !seen.has(name), 'UNDECLARED_OR_DUPLICATE_ARCHIVE_MEMBER');
      need(entry.bytes === descriptor.bytes && entry.mode === descriptor.mode,
        'ARCHIVE_MEMBER_IDENTITY_MISMATCH');
      const target = await confined(root, name, true);
      const temporary = target + '.unpack-pending';
      const old = await exists(target);
      let handle = null;
      if (!old) {
        // A previous interrupted file remains evidence; a new attempt uses a new name.
        const pending = await exists(temporary);
        if (pending) {
          const recovery = path.join(path.dirname(destination), '.paycashless-unpack-recovery', hash(destination));
          await directory(recovery);
          await fs.rename(temporary, path.join(recovery, hash(name) + '-' + Date.now()));
        }
        handle = await fs.open(temporary, 'wx', 0o600);
      }
      const digest = createHash('sha256');
      let offset = 0;
      try {
        while (offset < descriptor.bytes) {
          const part = await reader.read(Math.min(1024 * 1024, descriptor.bytes - offset));
          digest.update(part);
          if (handle) await handle.writeFile(part);
          offset += part.length;
        }
        need(digest.digest('hex') === descriptor.sha256, 'ARCHIVE_MEMBER_HASH_MISMATCH');
        if (handle) {
          await handle.chmod(descriptor.mode);
          await handle.sync();
          await handle.close();
          handle = null;
          await fs.rename(temporary, target);
          await syncDirectory(path.dirname(target));
        } else {
          await verifyFile(root, descriptor, { mode: true });
        }
      } finally { if (handle) await handle.close(); }
      await reader.discardZeros(padding(descriptor.bytes));
      seen.add(name);
    }
    await transfer;
    need(seen.size === declared.size, 'INCOMPLETE_ARCHIVE');
    async function checkMembers(base, relative = '') {
      for (const item of await fs.readdir(base, { withFileTypes: true })) {
        const name = relative ? relative + '/' + item.name : item.name;
        const actual = await fs.lstat(path.join(base, item.name));
        need(!actual.isSymbolicLink(), 'ARCHIVE_LINK_REJECTED');
        if (actual.isDirectory()) await checkMembers(path.join(base, item.name), name);
        else need(actual.isFile() && (name === 'manifest.json' || declared.has(name)),
          'UNDECLARED_ARCHIVE_MEMBER');
      }
    }
    await checkMembers(root);
    const inspected = await inspectPaycashlessDelivery({
      sourceDirectory: root, expectedManifestSha256: manifestSha256,
    });
    if (!completed) {
      await fs.rename(stage, destination);
      await syncDirectory(path.dirname(destination));
    }
    return {
      ...inspected, sourceDirectory: destination, directory: destination,
      replayed: !!completed,
    };
  } finally {
    gunzip.destroy();
    input.destroy?.();
    await transfer.catch(() => {});
    await guard.release();
  }
}
