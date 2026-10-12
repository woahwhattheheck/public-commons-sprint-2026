// MIT. Bounded original-file I/O shared by staging and the existing merchant worker.
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { need } from '../intake/protocol.mjs';
import { CHUNK_BYTES } from './protocol.mjs';

export const sameFile = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => a[key] === b[key]);
export function checkPrivateFile(info, maximum) {
  need(info.isFile() && info.nlink === 1 && !(info.mode & 0o077) &&
    (typeof process.getuid !== 'function' || info.uid === process.getuid()) &&
    info.size <= maximum, 'JOB_INPUT_PRIVATE_FILE_INVALID', 409);
}
export async function privateDirectory(path) {
  need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path && path !== '/',
    'JOB_INPUT_PRIVATE_DIRECTORY_REQUIRED');
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    (typeof process.getuid !== 'function' || info.uid === process.getuid()) &&
    await realpath(path) === path, 'JOB_INPUT_PRIVATE_DIRECTORY_REQUIRED', 409);
  return path;
}
export async function syncDirectory(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await file.sync(); } finally { await file.close(); }
}
export async function readPrivateJson(path, limit = 1048576) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat(); checkPrivateFile(before, limit);
    const bytes = await file.readFile();
    need(bytes.length <= limit && sameFile(before, await file.stat()), 'JOB_INPUT_RECORD_CHANGED', 409);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await file.close(); }
}
export async function writePrivateJson(path, value, assertHeld) {
  const parent = dirname(path), temporary = join(parent, '.input-' + randomUUID() + '.tmp');
  let file;
  try {
    assertHeld();
    file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); await file.close(); file = null;
    assertHeld(); await rename(temporary, path); await syncDirectory(parent);
  } finally { await file?.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}
export async function readChunk(file, bytes, position, signal) {
  signal?.throwIfAborted();
  const body = Buffer.alloc(bytes);
  let offset = 0;
  while (offset < bytes) {
    signal?.throwIfAborted();
    const result = await file.read(body, offset, bytes - offset, position + offset);
    need(result.bytesRead > 0, 'JOB_INPUT_FILE_TRUNCATED', 409); offset += result.bytesRead;
  }
  return body;
}
export async function inspectHandle(file, descriptor, { signal, chunks } = {}) {
  const before = await file.stat(); checkPrivateFile(before, descriptor.bytes);
  need(before.size === descriptor.bytes, 'JOB_INPUT_FILE_SIZE_CHANGED', 409);
  const whole = createHash('sha256'), missing = [];
  for (let index = 0, position = 0; position < descriptor.bytes; index++, position += CHUNK_BYTES) {
    const body = await readChunk(file, Math.min(CHUNK_BYTES, descriptor.bytes - position), position, signal);
    whole.update(body);
    if (chunks && createHash('sha256').update(body).digest('hex') !== chunks[index]) missing.push(index);
  }
  signal?.throwIfAborted();
  need(sameFile(before, await file.stat()), 'JOB_INPUT_FILE_CHANGED', 409);
  return { info: before, sha256: whole.digest('hex'), missing };
}
export async function openVerifiedFile(path, descriptor, options = {}) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const observed = await inspectHandle(file, descriptor, options);
    need(observed.sha256 === descriptor.sha256 && observed.missing.length === 0, 'JOB_INPUT_DIGEST_MISMATCH', 409);
    return { file, info: observed.info };
  } catch (error) { await file.close(); throw error; }
}
