// MIT. Preserve immutable original files using the existing SF88 private writer.
import { constants } from 'node:fs';
import { open, lstat, realpath, link } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import {
  absolute, privateDirectory, readBytes, writeBytes, exists, syncDirectory,
} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { digest, need, MAX_FILE_BYTES } from './manifest.mjs';

export { absolute, privateDirectory, readBytes, writeBytes, exists, syncDirectory };
export async function realDirectory(value, { create = false } = {}) {
  const path = absolute(value);
  await privateDirectory(path, { create });
  need(await realpath(path) === path, 'EDGAR_PORTABLE_REAL_DIRECTORY_REQUIRED');
  return path;
}
export async function pinnedFile(path, expected = null, maximum = MAX_FILE_BYTES) {
  path = absolute(path);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size > 0 && before.size <= maximum, 'EDGAR_PORTABLE_REGULAR_FILE_REQUIRED');
    const bytes = await handle.readFile(), after = await handle.stat(), current = await lstat(path);
    need(current.isFile() && !current.isSymbolicLink() && bytes.length === before.size &&
      before.dev === current.dev && before.ino === current.ino &&
      ['size', 'mtimeMs', 'ctimeMs'].every(key => before[key] === after[key]),
    'EDGAR_PORTABLE_ORIGINAL_CHANGED');
    const pin = { bytes: String(bytes.length), sha256: digest(bytes) };
    need(expected === null || expected.bytes === pin.bytes && expected.sha256 === pin.sha256,
      'EDGAR_PORTABLE_ORIGINAL_CHANGED', 'An original selected file differs from the saved workspace snapshot.');
    return { ...pin, bytes };
  } finally { await handle.close(); }
}
export async function exactFile(path, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  await realDirectory(dirname(path), { create: true });
  if (await exists(path)) {
    const current = await pinnedFile(path, { bytes: String(bytes.length), sha256: digest(bytes) },
      Math.max(bytes.length, MAX_FILE_BYTES));
    return { bytes: current.bytes.length, sha256: current.sha256, reused: true };
  }
  try { await writeBytes(path, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    await pinnedFile(path, { bytes: String(bytes.length), sha256: digest(bytes) }, Math.max(bytes.length, MAX_FILE_BYTES));
    return { bytes: bytes.length, sha256: digest(bytes), reused: true };
  }
  return { bytes: bytes.length, sha256: digest(bytes), reused: false };
}
export function selectedPath(root, name) {
  need(typeof name === 'string' && name && !name.startsWith('/') && !/[\\\u0000]/.test(name) &&
    name.split('/').every(part => part && part !== '.' && part !== '..'),
  'EDGAR_PORTABLE_PATH_INVALID');
  const path = join(absolute(root), name);
  need(path.startsWith(resolve(root) + '/'), 'EDGAR_PORTABLE_PATH_INVALID');
  return path;
}
export function decodeJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { need(false, 'EDGAR_PORTABLE_JSON_INVALID'); }
}

/** Share an immutable original inode with its archive stage when the filesystem allows it. */
export async function linkExactOriginal(original, target, expected) {
  await realDirectory(dirname(target), { create: true });
  if (await exists(target)) { await pinnedFile(target, expected); return; }
  await pinnedFile(original, expected);
  try { await link(original, target); }
  catch (error) {
    if (error.code === 'EEXIST') { await pinnedFile(target, expected); return; }
    if (error.code !== 'EXDEV') throw error;
    await exactFile(target, (await pinnedFile(original, expected)).bytes);
    return;
  }
  await pinnedFile(target, expected);
  await syncDirectory(dirname(target));
}
