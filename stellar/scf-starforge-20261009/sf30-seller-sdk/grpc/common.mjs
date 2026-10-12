// MIT. Small bounded private-file helpers for the original gRPC merchant.
import { open, mkdir, lstat, realpath, link, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
};
export function fail(code, status = 422) {
  throw Object.assign(new Error(code), { code, status });
}
export function fields(value, allowed, label) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(label);
}
export function text(value, label, maximum = 2048) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) fail(label);
  return value;
}
export function integer(value, label, fallback, low, high) {
  value ??= fallback;
  if (!Number.isInteger(value) || value < low || value > high) fail(label);
  return value;
}
export function jsonBytes(value, cap = 1048576) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (bytes.length > cap) fail('GRPC_DOCUMENT_TOO_LARGE', 413);
  return bytes;
}
export async function readBytes(path, cap = 1048576) {
  const handle = await open(path, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > cap) fail('GRPC_FILE_SIZE_INVALID', 413);
    const chunks = []; let total = 0;
    while (total <= cap) {
      const buffer = Buffer.alloc(Math.min(65536, cap + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      chunks.push(buffer.subarray(0, bytesRead)); total += bytesRead;
    }
    const after = await handle.stat();
    if (total > cap || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || total !== before.size) fail('GRPC_SOURCE_CHANGED_DURING_READ', 409);
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}
export async function readJson(path, cap = 1048576) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(path, cap))); }
  catch (issue) {
    if (issue instanceof SyntaxError || issue.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') fail('GRPC_JSON_INVALID');
    throw issue;
  }
}
export async function writeNew(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
export async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function privateDirectory(path, create = false) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077) fail('GRPC_PRIVATE_DIRECTORY_REQUIRED');
  return realpath(resolve(path));
}

export function assertProtoArchiveFits(source) {
  const bytes = Buffer.byteLength(JSON.stringify(source, null, 2) + '\n');
  if (bytes > 8388608) fail('GRPC_CAPTURED_CONTRACT_EXCEEDS_8_MIB', 413);
  return source;
}

/** Publish a complete compact, create-only JSON value without exposing partial bytes. */
export async function writeJsonSnapshot(path, value, maximum) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  if (bytes.length > maximum) fail('GRPC_DOCUMENT_TOO_LARGE', 413);
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeNew(temporary, bytes);
    await link(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await unlink(temporary).catch(issue => { if (issue.code !== 'ENOENT') throw issue; });
  }
}
