// MIT. Private, hash-bound RisingWave source artifacts.
import { open, mkdir, lstat, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
export const SOURCE_PIN = '45baf6460ea942e4ff57a5aa057d5b8db7f3b563';
export const PROTOCOL_VERSION = '3.1.0';
export const EPOCH_ORIGIN_MS = 1617235200000n;
export class RisingWaveSourceError extends Error {
  constructor(code, message = code, details = {}) {
    super(message); this.name = 'RisingWaveSourceError'; this.code = code;
    this.details = details;
  }
  toJSON() { return { code: this.code, message: this.message, details: this.details }; }
}
export class QueryInputError extends RisingWaveSourceError {
  constructor(field, code, message = code) {
    super(code, message, { field }); this.name = 'QueryInputError'; this.field = field;
  }
}
export const fail = (code, message, details) => new RisingWaveSourceError(code, message, details);
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const own = (value, key) => Object.hasOwn(value, key);
export function exact(value, keys, code) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fail(code);
}
export function bound(value, low, high, code) {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw fail(code);
  return value;
}
export function name(value, code = 'RISINGWAVE_NAME_INVALID') {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(value) ||
      ['constructor','prototype','__proto__'].includes(value)) throw fail(code);
  return value;
}
export function identifier(value) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 255 ||
      /[\x00-\x1f\x7f]/.test(value) || Buffer.from(value).toString('utf8') !== value)
    throw fail('RISINGWAVE_IDENTIFIER_INVALID');
  return '"' + value.replace(/"/g, '""') + '"';
}
export const qualified = value => identifier(value.schema) + '.' + identifier(value.name);
export const literal = value => "'" + value.replace(/'/g, "''") + "'";
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  if (value === undefined || typeof value === 'number' && !Number.isFinite(value)) throw fail('RISINGWAVE_NON_JSON_VALUE');
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export const identity = value => digest(canonical(value));
export const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const now = () => new Date().toISOString();
export function absolute(value) {
  if (typeof value !== 'string' || resolve(value) !== value) throw fail('RISINGWAVE_ABSOLUTE_PATH_REQUIRED');
  return value;
}
export function contained(directory, filename) {
  absolute(directory);
  if (typeof filename !== 'string' || !filename || isAbsolute(filename)) throw fail('RISINGWAVE_ARTIFACT_PATH_INVALID');
  const path = resolve(directory, filename), r = relative(directory, path);
  if (!r || r === '..' || r.startsWith('../') || isAbsolute(r)) throw fail('RISINGWAVE_ARTIFACT_PATH_INVALID');
  return path;
}
export async function privateDirectory(path, create = false) {
  absolute(path);
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077) throw fail('RISINGWAVE_PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
export async function readBytes(path, limit = 1048576, privateFile = false) {
  absolute(path);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > limit || privateFile && before.mode & 0o077) throw fail('RISINGWAVE_FILE_INVALID');
    const output = Buffer.alloc(before.size + 1); let offset = 0;
    while (offset < output.length) {
      const r = await file.read(output, offset, output.length - offset, null);
      if (!r.bytesRead) break; offset += r.bytesRead;
    }
    const after = await file.stat();
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw fail('RISINGWAVE_FILE_CHANGED');
    return output.subarray(0, offset);
  } finally { await file.close(); }
}
export async function readJson(path, limit = 8388608, privateFile = false) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(path, limit, privateFile))); }
  catch (issue) { if (issue.code) throw issue; throw fail('RISINGWAVE_JSON_INVALID'); }
}
export async function optionalJson(path, limit = 8388608) {
  try { return await readJson(path, limit, true); } catch (issue) { if (issue.code === 'ENOENT') return null; throw issue; }
}
export async function writeAll(file, value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value); let offset = 0;
  while (offset < data.length) {
    const r = await file.write(data, offset, data.length - offset, null);
    if (!r.bytesWritten) throw fail('RISINGWAVE_WRITE_INCOMPLETE');
    offset += r.bytesWritten;
  }
}
export async function syncDirectory(path) {
  const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); }
}
export async function createFile(path, value) {
  const file = await open(path, 'wx', 0o600);
  try { await writeAll(file, value); await file.sync(); } finally { await file.close(); }
}
export async function atomicFile(path, value) {
  const temporary = join(dirname(path), '.' + randomUUID() + '.tmp');
  try { await createFile(temporary, value); await rename(temporary, path); await syncDirectory(dirname(path)); }
  catch (issue) { await unlink(temporary).catch(() => {}); throw issue; }
}
export const atomicJson = (path, value) => atomicFile(path, bytes(value));
export async function fileInfo(path, filename = undefined) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw fail('RISINGWAVE_ARTIFACT_NOT_REGULAR');
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let size = 0;
    for (;;) {
      const r = await file.read(buffer, 0, buffer.length, null);
      if (!r.bytesRead) break; size += r.bytesRead; hash.update(buffer.subarray(0,r.bytesRead));
    }
    const after = await file.stat();
    if (size !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw fail('RISINGWAVE_FILE_CHANGED');
    return { path: filename ?? path, bytes: size, sha256: hash.digest('hex') };
  } finally { await file.close(); }
}
export function errorValue(issue) {
  return typeof issue?.toJSON === 'function' ? issue.toJSON() :
    { code: typeof issue?.code === 'string' ? issue.code : 'RISINGWAVE_OPERATION_FAILED',
      message: String(issue?.message ?? issue).slice(0,4096) };
}
export function checkAbort(signal) {
  if (signal?.aborted) throw fail('RISINGWAVE_CANCELLED','The original source operation was cancelled.');
}
export function epochMs(epoch) {
  if (typeof epoch !== 'string' || !/^[0-9]+$/.test(epoch)) throw fail('RISINGWAVE_EPOCH_INVALID');
  const n = BigInt(epoch);
  if (n > 18446744073709551615n) throw fail('RISINGWAVE_EPOCH_INVALID');
  return String(EPOCH_ORIGIN_MS + (n >> 16n));
}
export function canonicalCsvLine(values) {
  return values.map(value => {
    if (value === null) return '';
    const text = String(value);
    return text === '' || /[",\r\n]/.test(text) ? '"' + text.replace(/"/g,'""') + '"' : text;
  }).join(',') + '\n';
}
