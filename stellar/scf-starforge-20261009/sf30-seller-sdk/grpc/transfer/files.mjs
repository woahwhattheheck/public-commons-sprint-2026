// MIT. Stream complete private transfer files without accumulating their bodies.
import { constants, createReadStream } from 'node:fs';
import { open, lstat, realpath, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { canonical, fail, syncDirectory } from '../common.mjs';
import { GRPC_TRANSFER_FILE_BYTES, GRPC_TRANSFER_ARCHIVE_BYTES, GRPC_TRANSFER_MANIFEST_BYTES,
  GRPC_TRANSFER_CHUNK_BYTES, transferInteger, transferSha } from './manifest.mjs';

const READ = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const privateOwner = stat => !(stat.mode & 0o077) &&
  (typeof process.getuid !== 'function' || stat.uid === process.getuid());
function regular(stat, cap) {
  if (!stat.isFile() || !privateOwner(stat) || stat.size > cap)
    fail('GRPC_TRANSFER_PRIVATE_FILE_REQUIRED', 409);
}
export async function transferDirectory(path, create = false) {
  if (typeof path !== 'string' || resolve(path) !== path) fail('GRPC_TRANSFER_ABSOLUTE_DIRECTORY_REQUIRED');
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !privateOwner(stat) || await realpath(path) !== path)
    fail('GRPC_TRANSFER_PRIVATE_DIRECTORY_REQUIRED', 409);
  return path;
}
export async function transferRead(path, cap = GRPC_TRANSFER_MANIFEST_BYTES) {
  const handle = await open(path, READ);
  try {
    const before = await handle.stat(); regular(before, cap);
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) {
      const next = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!next.bytesRead) fail('GRPC_TRANSFER_FILE_CHANGED', 409);
      offset += next.bytesRead;
    }
    const after = await handle.stat(), named = await lstat(path);
    if (!same(before, after) || !same(after, named) || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || named.isSymbolicLink())
      fail('GRPC_TRANSFER_FILE_CHANGED', 409);
    return bytes;
  } finally { await handle.close(); }
}
export async function transferJson(path, cap = GRPC_TRANSFER_MANIFEST_BYTES) {
  let bytes;
  try { bytes = await transferRead(path, cap); }
  catch (issue) { if (issue.code === 'ENOENT') return null; throw issue; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('GRPC_TRANSFER_JSON_INVALID'); }
}
export async function transferWrite(path, value, { exclusive = false, cap = GRPC_TRANSFER_MANIFEST_BYTES } = {}) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value) + '\n');
  if (bytes.length > cap) fail('GRPC_TRANSFER_DOCUMENT_TOO_LARGE', 413);
  await transferDirectory(dirname(path), true);
  if (exclusive) {
    const existing = await transferJson(path, cap);
    if (existing !== null) {
      if (canonical(existing) !== canonical(value)) fail('GRPC_TRANSFER_ID_CONFLICT', 409);
      return;
    }
  }
  const temporary = path + '.' + randomUUID() + '.tmp';
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    // The original workspace writer (or receiving lock) owns this publication.
    await rename(temporary, path); await syncDirectory(dirname(path));
  } finally {
    await handle?.close();
    await unlink(temporary).catch(issue => { if (issue.code !== 'ENOENT') throw issue; });
  }
}
export async function hashTransferFile(path, cap = GRPC_TRANSFER_ARCHIVE_BYTES, { signal } = {}) {
  const handle = await open(path, READ);
  try {
    const before = await handle.stat(); regular(before, cap);
    const hash = createHash('sha256'), buffer = Buffer.alloc(262144);
    let bytes = 0;
    while (bytes < before.size) {
      signal?.throwIfAborted();
      const read = await handle.read(buffer, 0, Math.min(buffer.length, before.size - bytes), bytes);
      if (!read.bytesRead) fail('GRPC_TRANSFER_FILE_CHANGED', 409);
      hash.update(buffer.subarray(0, read.bytesRead)); bytes += read.bytesRead;
    }
    const after = await handle.stat(), named = await lstat(path);
    if (!same(before, after) || !same(after, named) || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || named.isSymbolicLink())
      fail('GRPC_TRANSFER_FILE_CHANGED', 409);
    return { bytes, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
export async function copyTransferFile({ source, destination, prefixBytes, maximum = GRPC_TRANSFER_FILE_BYTES, signal }) {
  const input = await open(source, READ);
  let output;
  try {
    const before = await input.stat(); regular(before, Math.max(maximum, prefixBytes ?? 0));
    const length = prefixBytes ?? before.size;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum || before.size < length)
      fail('GRPC_TRANSFER_FILE_SIZE_INVALID', 413);
    await transferDirectory(dirname(destination), true);
    output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    const hash = createHash('sha256'), buffer = Buffer.alloc(262144); let bytes = 0;
    while (bytes < length) {
      signal?.throwIfAborted();
      const read = await input.read(buffer, 0, Math.min(buffer.length, length - bytes), bytes);
      if (!read.bytesRead) fail('GRPC_TRANSFER_FILE_CHANGED', 409);
      const block = buffer.subarray(0, read.bytesRead); let written = 0;
      while (written < block.length) {
        const result = await output.write(block, written, block.length - written, bytes + written);
        if (!result.bytesWritten) fail('GRPC_TRANSFER_FILE_WRITE_FAILED', 500);
        written += result.bytesWritten;
      }
      hash.update(block); bytes += block.length;
    }
    const after = await input.stat(), named = await lstat(source);
    if (!same(before, after) || !same(after, named) || named.isSymbolicLink() || after.size < length ||
        prefixBytes === undefined && (before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs))
      fail('GRPC_TRANSFER_FILE_CHANGED', 409);
    await output.sync();
    return { bytes, sha256: hash.digest('hex') };
  } finally { await output?.close(); await input.close(); }
}
export async function transferRange(path, expected, { offset = 0, limit = GRPC_TRANSFER_CHUNK_BYTES } = {}) {
  transferSha(expected.sha256); transferInteger(expected.bytes, GRPC_TRANSFER_ARCHIVE_BYTES, 1);
  transferInteger(offset, expected.bytes);
  transferInteger(limit, GRPC_TRANSFER_CHUNK_BYTES, 1);
  const handle = await open(path, READ);
  try {
    const before = await handle.stat(); regular(before, GRPC_TRANSFER_ARCHIVE_BYTES);
    if (before.size !== expected.bytes) fail('GRPC_TRANSFER_ARCHIVE_CHANGED', 409);
    const bytes = Buffer.alloc(Math.min(limit, before.size - offset)); let total = 0;
    while (total < bytes.length) {
      const read = await handle.read(bytes, total, bytes.length - total, offset + total);
      if (!read.bytesRead) fail('GRPC_TRANSFER_ARCHIVE_CHANGED', 409);
      total += read.bytesRead;
    }
    const after = await handle.stat(), named = await lstat(path);
    if (!same(before, after) || !same(after, named) || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || named.isSymbolicLink())
      fail('GRPC_TRANSFER_ARCHIVE_CHANGED', 409);
    return { sha256: expected.sha256, bytes: expected.bytes, offset, bytesRead: bytes.length,
      nextOffset: offset + bytes.length < before.size ? offset + bytes.length : null,
      chunkSha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') };
  } finally { await handle.close(); }
}

export async function openTransferArchive(path, expected) {
  transferSha(expected.sha256); transferInteger(expected.bytes, GRPC_TRANSFER_ARCHIVE_BYTES, 1);
  const handle = await open(path, READ); let before, closed = false;
  try {
    before = await handle.stat(); regular(before, GRPC_TRANSFER_ARCHIVE_BYTES);
    if (before.size !== expected.bytes) fail('GRPC_TRANSFER_ARCHIVE_CHANGED', 409);
    const assertUnchanged = async () => {
      if (closed) fail('GRPC_TRANSFER_DOWNLOAD_CLOSED', 409);
      const after = await handle.stat(), named = await lstat(path);
      if (!same(before, after) || !same(after, named) || named.isSymbolicLink() ||
          before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
        fail('GRPC_TRANSFER_ARCHIVE_CHANGED', 409);
    };
    await assertUnchanged();
    return { handle, assertUnchanged, capture: { filename: 'grpc-workspace.tar.gz',
      bytes: expected.bytes, sha256: expected.sha256, contentType: 'application/gzip' },
      async close() { if (!closed) { closed = true; await handle.close(); } } };
  } catch (issue) { await handle.close(); throw issue; }
}

export async function sendTransferArchive(path, expected, response) {
  const handle = await open(path, READ);
  try {
    const stat = await handle.stat(); regular(stat, GRPC_TRANSFER_ARCHIVE_BYTES);
    if (stat.size !== expected.bytes) fail('GRPC_TRANSFER_ARCHIVE_CHANGED', 409);
    response.writeHead(200, { 'content-type': 'application/gzip', 'content-length': String(expected.bytes),
      'content-disposition': 'attachment; filename="grpc-workspace.tar.gz"',
      'x-content-sha256': expected.sha256, 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff' });
    await pipeline(createReadStream(path, { fd: handle.fd, autoClose: false, start: 0, end: expected.bytes - 1 }), response);
  } finally { await handle.close(); }
}
export function runArchiveHelper(request, { signal, python = process.env.PYTHON ?? 'python3' } = {}) {
  const script = fileURLToPath(new URL('./archive.py', import.meta.url));
  return new Promise((done, reject) => {
    let child, issue = null, stdout = '', stderr = '', killTimer;
    const abort = () => {
      issue ??= Object.assign(new Error('GRPC_TRANSFER_CANCELLED'), { code: 'GRPC_TRANSFER_CANCELLED', status: 409 });
      child?.kill('SIGTERM');
      killTimer ??= setTimeout(() => child?.kill('SIGKILL'), 5000);
      killTimer.unref?.();
    };
    try {
      signal?.throwIfAborted();
      child = spawn(python, ['-B', script], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    } catch (error) { reject(error); return; }
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', part => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(part) > GRPC_TRANSFER_MANIFEST_BYTES + 1048576) {
        issue ??= Object.assign(new Error('GRPC_TRANSFER_HELPER_OUTPUT_TOO_LARGE'), { code: 'GRPC_TRANSFER_HELPER_OUTPUT_TOO_LARGE' });
        child.kill('SIGTERM');
      } else stdout += part;
    });
    child.stderr.on('data', part => { if (stderr.length < 65536) stderr += part.slice(0, 65536 - stderr.length); });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') issue ??= error; });
    child.once('error', error => { issue ??= error; });
    child.once('close', code => {
      clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
      let value;
      try { value = JSON.parse(stdout); }
      catch { issue ??= Object.assign(new Error('GRPC_TRANSFER_HELPER_FAILED'), { code: 'GRPC_TRANSFER_HELPER_FAILED' }); }
      if (!issue && (code !== 0 || value?.error)) {
        const nativeCode = value?.error?.code;
        issue = Object.assign(new Error(typeof nativeCode === 'string' && /^GRPC_TRANSFER_[A-Z0-9_]+$/.test(nativeCode) ?
          nativeCode : 'GRPC_TRANSFER_HELPER_FAILED'), { code: nativeCode ?? 'GRPC_TRANSFER_HELPER_FAILED', status: 409 });
      }
      if (issue) reject(issue); else done(value);
    });
    child.stdin.end(JSON.stringify(request));
    if (signal?.aborted) abort();
  });
}
