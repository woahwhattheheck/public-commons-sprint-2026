// MIT. Private retained files and JSON boundaries shared by native MongoDB tools.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const record = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function fail(code, status = 400) { throw Object.assign(new Error(code), { code, status }); }
export function fields(value, allowed, code) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(code);
}
export function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code);
  return value;
}
export async function limited(path, maximum = 262144) {
  const handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) fail('MONGODB_FILE_INVALID');
    const bytes = await handle.readFile();
    if (bytes.length > maximum) fail('MONGODB_FILE_TOO_LARGE');
    return bytes;
  } finally { await handle.close(); }
}
export async function readJson(path, maximum) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await limited(path, maximum)));
}
export async function writeNew(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
export async function syncDirectory(path) {
  const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
export async function privateDirectory(path, create = false) {
  const target = resolve(path);
  if (create) await mkdir(target, { mode: 0o700 });
  const stat = await lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || await realpath(target) !== target)
    fail('MONGODB_PRIVATE_REAL_DIRECTORY_REQUIRED');
  return target;
}
