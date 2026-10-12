// MIT. Shared QuestDB input, file and exact scalar primitives.
import { open, mkdir, rename, lstat, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';

export class QuestDbSourceError extends Error {
  constructor(code, message = code, details = {}) {
    super(message); this.name = 'QuestDbSourceError'; this.code = code;
    for (const [key, value] of Object.entries(details)) if (!['name','message','stack','code'].includes(key)) this[key] = value;
  }
  toJSON() { return { code: this.code, message: this.message, ...Object.fromEntries(Object.entries(this).filter(([key]) => key !== 'name')) }; }
}
export class QueryInputError extends QuestDbSourceError {
  constructor(field, code, message = code) { super(code, message, { field }); this.name = 'QueryInputError'; }
}
export const fail = (code, message, details) => new QuestDbSourceError(code, message, details);
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const own = (value, key) => Object.hasOwn(value, key);
export function exact(value, allowed, code) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw fail(code);
}
export function bounded(value, min, max, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fail(code);
  return value;
}
export const utf8 = value => typeof value === 'string' && Buffer.from(value).toString('utf8') === value;
export function name(value, code = 'QUESTDB_NAME_INVALID') {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) ||
      ['constructor','prototype','__proto__'].includes(value)) throw fail(code);
  return value;
}
export function identifier(value) {
  if (!utf8(value) || !value || value.length > 255 || /[\x00-\x1f\x7f]/.test(value)) throw fail('QUESTDB_IDENTIFIER_INVALID');
  return '"' + value.replace(/"/g, '""') + '"';
}
export const literal = value => "'" + value.replace(/'/g, "''") + "'";
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  if (value === undefined || typeof value === 'number' && !Number.isFinite(value)) throw fail('QUESTDB_NON_JSON_VALUE');
  return JSON.stringify(value);
}
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const identity = value => digest(canonical(value));
export const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const stamp = () => new Date().toISOString();
export function absolute(path) {
  if (typeof path !== 'string' || resolve(path) !== path) throw fail('QUESTDB_ABSOLUTE_PATH_REQUIRED');
  return path;
}
export async function privateDirectory(path, create = false) {
  absolute(path);
  if (create) await mkdir(path, { mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077) throw fail('QUESTDB_PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
export async function readBytes(path, cap = 1048576, privateFile = false) {
  absolute(path);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > cap || privateFile && stat.mode & 0o077) throw fail('QUESTDB_FILE_INVALID');
    const output = Buffer.alloc(stat.size + 1); let offset = 0;
    while (offset < output.length) {
      const { bytesRead } = await file.read(output, offset, output.length - offset, null);
      if (!bytesRead) break; offset += bytesRead;
    }
    if (offset !== stat.size) throw fail('QUESTDB_FILE_CHANGED');
    return output.subarray(0, offset);
  } finally { await file.close(); }
}
export async function readJson(path, cap = 1048576, privateFile = false) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(path, cap, privateFile))); }
  catch (issue) { if (issue.code) throw issue; throw fail('QUESTDB_JSON_FILE_INVALID'); }
}
export async function writeAll(file, data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data); let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset, null);
    if (!bytesWritten) throw fail('QUESTDB_FILE_WRITE_INCOMPLETE'); offset += bytesWritten;
  }
}
export async function syncDirectory(path) {
  const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); }
}
export async function createFile(path, data) {
  const file = await open(path, 'wx', 0o600);
  try { await writeAll(file, data); await file.sync(); } finally { await file.close(); }
}
export async function atomicJson(path, value) {
  const temporary = join(dirname(path), '.' + randomUUID() + '.tmp');
  await createFile(temporary, bytes(value)); await rename(temporary, path); await syncDirectory(dirname(path));
}
export function decimalParts(text) {
  if (typeof text !== 'string' || text.length > 2048) throw fail('QUESTDB_DECIMAL_INVALID');
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(text);
  if (!match) throw fail('QUESTDB_DECIMAL_INVALID');
  const exponent = match[4] === undefined ? 0 : Number(match[4]);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) throw fail('QUESTDB_DECIMAL_EXPONENT_INVALID');
  return { coefficient: BigInt((match[1] || '') + match[2] + (match[3] || '')),
    scale: (match[3] || '').length - exponent };
}
export function compareDecimal(a, b) {
  const x = decimalParts(a), y = decimalParts(b), scale = Math.max(x.scale, y.scale);
  const left = x.coefficient * 10n ** BigInt(scale - x.scale);
  const right = y.coefficient * 10n ** BigInt(scale - y.scale);
  return left < right ? -1 : left > right ? 1 : 0;
}
export function integralDecimal(text) {
  const { coefficient, scale } = decimalParts(text);
  return scale <= 0 || coefficient % 10n ** BigInt(scale) === 0n;
}
export function timestampValue(value, precision = 6) {
  if (typeof value !== 'string') throw fail('QUESTDB_TIMESTAMP_INVALID');
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?Z$/.exec(value);
  if (!match || (match[7]?.length ?? 0) > precision) throw fail('QUESTDB_TIMESTAMP_PRECISION_INVALID');
  const [year, month, day, hour, minute, second] = match.slice(1,7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month-1] || hour > 23 || minute > 59 || second > 59)
    throw fail('QUESTDB_TIMESTAMP_INVALID');
  const seconds = Date.parse(value.slice(0,19) + 'Z');
  if (!Number.isSafeInteger(seconds)) throw fail('QUESTDB_TIMESTAMP_INVALID');
  return BigInt(seconds) * 1000000n + BigInt((match[7] || '').padEnd(9,'0'));
}
