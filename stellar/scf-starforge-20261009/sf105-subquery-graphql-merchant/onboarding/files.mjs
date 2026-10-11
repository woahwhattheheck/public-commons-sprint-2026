// MIT. Private create-only files for the original SF105 operator workflow.
import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const own = (value, name) => Object.hasOwn(value, name);
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function fail(code, message) {
  const error = new TypeError(message); error.code = code; throw error;
}
export function fields(value, names, label) {
  if (!record(value) || Object.keys(value).some(name => !names.includes(name)))
    fail('INVALID_FIELDS', `${label} contains unsupported fields`);
}
export function text(value, label, max = 2048) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value))
    fail('INVALID_TEXT', `${label} must be nonempty printable text within its size limit`);
  return value;
}
export async function readBytes(filename, limit = 1048576) {
  const handle = await open(resolve(filename), 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) fail('INPUT_SIZE', 'Input must be a regular file within the documented size limit');
    const bytes = Buffer.alloc(limit + 1); let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (!length || length > limit) fail('INPUT_SIZE', 'Input is empty or exceeds its documented size limit');
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}
export function decode(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('INPUT_UTF8', 'Input must be valid UTF-8'); }
}
export function parseJson(bytes) {
  try { return JSON.parse(decode(bytes)); }
  catch { fail('INPUT_JSON', 'Input must be a valid UTF-8 JSON document'); }
}
export async function writeBundle(directory, files) {
  const target = resolve(directory);
  if (new Set(files.map(([name]) => name)).size !== files.length || files.some(([name]) =>
    typeof name !== 'string' || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/.test(name) ||
    name.split('/').some(part => ['.', '..'].includes(part)))) throw new TypeError('Invalid internal bundle filenames');
  // The existing parent is supplied by the operator. This reserves the output
  // once; a prior package is never modified, resumed or recursively replaced.
  await mkdir(target, { mode: 0o700 });
  const directories = new Set([target]);
  try {
    for (const [name, bytes] of files) {
      const path = resolve(target, name), parent = dirname(path);
      if (!directories.has(parent)) { await mkdir(parent, { mode: 0o700 }); directories.add(parent); }
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    }
    for (const path of [...directories].reverse()) {
      const handle = await open(path, 'r');
      try { await handle.sync(); } finally { await handle.close(); }
    }
  } catch (cause) {
    const error = new Error('Output is incomplete; choose a new directory after inspecting the private partial files', { cause });
    error.code = 'OUTPUT_INCOMPLETE'; throw error;
  }
  return target;
}
