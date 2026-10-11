// MIT — Private application state. Financial authority stays in the original SF36 ledger.
import { constants } from 'node:fs';
import { open, mkdir, lstat, rename, link, unlink } from 'node:fs/promises';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class BuyerError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'BuyerError';
    this.code = code;
    Object.assign(this, details);
  }
}
export const need = (condition, code) => { if (!condition) throw new BuyerError(code); };
export const digest = data => createHash('sha256').update(data).digest('hex');
export const now = () => new Date().toISOString();
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const safeCode = (value, fallback) => typeof value === 'string' && /^[A-Z0-9_]{1,120}$/.test(value) ? value : fallback;
export function intent(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value), 'STABLE_INTENT_ID_REQUIRED');
  return value;
}
export function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'), 'ABSOLUTE_PATH_REQUIRED');
  return resolve(value);
}
export function jsonBytes(value) {
  const text = JSON.stringify(value, (_key, item) => {
    need(item !== undefined && typeof item !== 'function' && typeof item !== 'symbol' && typeof item !== 'bigint', 'JSON_VALUES_REQUIRED');
    need(typeof item !== 'number' || Number.isFinite(item), 'JSON_VALUES_REQUIRED');
    return item;
  }, 2);
  return Buffer.from(text + '\n');
}
export async function privateDirectory(path, { create = true } = {}) {
  path = absolute(path);
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  need(stat.isDirectory() && !stat.isSymbolicLink(), 'PRIVATE_STATE_DIRECTORY_REQUIRED');
  if (process.platform !== 'win32') {
    need((stat.mode & 0o077) === 0, 'PRIVATE_STATE_DIRECTORY_REQUIRED');
    if (process.getuid) need(stat.uid === process.getuid(), 'STATE_DIRECTORY_OWNER_MISMATCH');
  }
  return path;
}
export async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function readBytes(path, limit = 65536) {
  need(Number.isSafeInteger(limit) && limit >= 0, 'READ_LIMIT_INVALID');
  const handle = await open(absolute(path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    need(stat.isFile() && stat.size <= limit, 'FILE_SIZE_OR_TYPE_INVALID');
    const data = await handle.readFile();
    need(data.length <= limit, 'FILE_SIZE_OR_TYPE_INVALID');
    return data;
  } finally { await handle.close(); }
}
export function parseJson(raw) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw new BuyerError('JSON_INVALID'); }
}
export async function readJson(path, limit) {
  const value = parseJson(await readBytes(path, limit));
  need(object(value), 'JSON_OBJECT_REQUIRED');
  return value;
}
export async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function writeBytes(path, data, { exclusive = false } = {}) {
  path = absolute(path);
  const temporary = join(dirname(path), `.write-${randomUUID()}`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close(); handle = undefined;
    if (exclusive) { await link(temporary, path); await unlink(temporary); }
    else await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export const writeJson = (path, value, options) => writeBytes(path, jsonBytes(value), options);
