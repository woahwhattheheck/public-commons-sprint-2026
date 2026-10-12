// MIT. Exact local source copies and atomic retained-operation publications.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, link, unlink, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { issue, LIMITS, relativePath } from './contract.mjs';

export async function privateDirectory(path) {
  path = resolve(path); await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (await realpath(path) !== path || !stat.isDirectory() || stat.isSymbolicLink()) throw issue('CLOUD_PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
export async function within(root, name, missing = false) {
  relativePath(name); const path = resolve(root, name), rel = relative(root, path);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw issue('CLOUD_PATH_OUTSIDE_EDITION');
  let cursor = root;
  for (const part of name.split('/')) {
    cursor = resolve(cursor, part);
    try { if ((await lstat(cursor)).isSymbolicLink()) throw issue('CLOUD_SYMLINK_FORBIDDEN'); }
    catch (error) { if (!(missing && error.code === 'ENOENT')) throw error; }
  }
  return path;
}
export async function readBytes(filename, maximum = LIMITS.jsonBytes) {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum)) throw issue('CLOUD_FILE_LIMIT');
    const bytes = Buffer.alloc(Number(before.size) + 1); let total = 0;
    while (total < bytes.length) {
      const result = await file.read(bytes, total, bytes.length - total, null);
      if (!result.bytesRead) break; total += result.bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (BigInt(total) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ino !== after.ino)
      throw issue('CLOUD_ORIGINAL_FILE_CHANGED', 'The original file changed while reading it.', 409);
    return bytes.subarray(0, total);
  } finally { await file.close(); }
}
export async function readJson(filename, maximum = LIMITS.jsonBytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(filename, maximum))); }
  catch (error) { if (error.code) throw error; throw issue('CLOUD_JSON_INVALID'); }
}
export async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function atomicBytes(path, bytes, { replace = false } = {}) {
  await privateDirectory(dirname(path));
  const temporary = path + '.' + randomUUID() + '.tmp'; let handle, created = false;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    created = true; await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    if (replace) await rename(temporary, path);
    else {
      try { await link(temporary, path); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const original = await readBytes(path, bytes.length);
        if (!original.equals(bytes)) throw issue('CLOUD_IMMUTABLE_FILE_CONFLICT', 'This retained identity already contains different bytes.', 409);
      }
    }
    await syncDirectory(dirname(path));
  } finally {
    await handle?.close();
    if (created) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export const atomicJson = (path, value, options) => atomicBytes(path, Buffer.from(JSON.stringify(value, null, 2) + '\n'), options);
export async function fileDigest(path, maximum = LIMITS.fileBytes) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum)) throw issue('CLOUD_FILE_LIMIT');
    const hash = createHash('sha256'), chunk = Buffer.alloc(1024 * 1024); let total = 0;
    for (;;) {
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break; total += bytesRead;
      if (total > maximum) throw issue('CLOUD_FILE_LIMIT');
      hash.update(chunk.subarray(0, bytesRead));
    }
    const after = await file.stat({ bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ino !== after.ino || BigInt(total) !== before.size)
      throw issue('CLOUD_ORIGINAL_FILE_CHANGED', undefined, 409);
    return { bytes: String(total), sha256: hash.digest('hex') };
  } finally { await file.close(); }
}
export async function acceptStream(path, stream, expected, { signal } = {}) {
  try {
    const found = await fileDigest(path, Math.max(LIMITS.fileBytes, Number(expected.bytes)));
    if (found.bytes === expected.bytes && (!expected.sha256 || found.sha256 === expected.sha256)) {
      const hash = createHash('sha256'); let bytes = 0;
      for await (const chunk of stream) {
        if (signal?.aborted) throw issue('CLOUD_UPLOAD_ABORTED');
        bytes += chunk.length;
        if (BigInt(bytes) > BigInt(expected.bytes)) throw issue('CLOUD_UPLOAD_LENGTH_MISMATCH');
        hash.update(chunk);
      }
      if (String(bytes) !== found.bytes || hash.digest('hex') !== found.sha256) throw issue('CLOUD_UPLOAD_DIGEST_MISMATCH');
      return { ...found, reused: true };
    }
    throw issue('CLOUD_IMMUTABLE_FILE_CONFLICT', undefined, 409);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await privateDirectory(dirname(path));
  const temporary = path + '.' + randomUUID() + '.tmp'; let handle, created = false;
  const hash = createHash('sha256'); let bytes = 0;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    created = true;
    for await (const chunk of stream) {
      if (signal?.aborted) throw issue('CLOUD_UPLOAD_ABORTED');
      bytes += chunk.length;
      if (BigInt(bytes) > BigInt(expected.bytes)) throw issue('CLOUD_UPLOAD_LENGTH_MISMATCH');
      hash.update(chunk); await handle.writeFile(chunk);
    }
    const sha256 = hash.digest('hex');
    if (String(bytes) !== expected.bytes || expected.sha256 && sha256 !== expected.sha256) throw issue('CLOUD_UPLOAD_DIGEST_MISMATCH');
    await handle.sync(); await handle.close(); handle = null;
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const retained = await fileDigest(path, Math.max(LIMITS.fileBytes, Number(expected.bytes)));
      if (retained.bytes !== expected.bytes || retained.sha256 !== sha256) throw issue('CLOUD_IMMUTABLE_FILE_CONFLICT', undefined, 409);
    }
    await syncDirectory(dirname(path));
    return { bytes: String(bytes), sha256, reused: false };
  } finally {
    await handle?.close();
    if (created) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export async function retainFile(source, destination, expected) {
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || String(before.size) !== expected.bytes) throw issue('CLOUD_ORIGINAL_FILE_SIZE_MISMATCH');
    const stream = handle.createReadStream({ autoClose: false });
    const retained = await acceptStream(destination, stream, expected);
    const after = await handle.stat({ bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ino !== after.ino)
      throw issue('CLOUD_ORIGINAL_FILE_CHANGED', undefined, 409);
    return retained;
  } finally { await handle.close(); }
}
