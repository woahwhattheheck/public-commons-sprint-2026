// MIT. Private destination metadata beside the original SF98 journals.
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, rename, unlink, readdir } from 'node:fs/promises';
import { isAbsolute, resolve, join, dirname, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const ROOT_SCHEMA = 'stellar-forge.sf98.destinations.v1';
export const DESTINATION_SCHEMA = 'stellar-forge.sf98.destination.v1';
export const CURSOR_SCHEMA = 'stellar-forge.sf98.destination-cursor.v1';
export const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
export const eventPattern = /^[a-f0-9]{64}$/;
export const hash = value => createHash('sha256').update(value).digest('hex');
export const fault = (code, status = 400) => Object.assign(new Error(code), { code, status });
export const codeOf = error => [error?.code, error?.message].find(value =>
  typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(value)) ?? 'DESTINATION_OPERATION_FAILED';

export function absoluteDirectory(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || value === '/' || resolve(value) !== value)
    throw fault('ABSOLUTE_PRIVATE_DIRECTORY_REQUIRED');
  return value;
}
export async function privateDirectory(value, create = false) {
  const path = absoluteDirectory(value);
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
      process.getuid && info.uid !== process.getuid() || await realpath(path) !== path)
    throw fault('PRIVATE_OPERATOR_DIRECTORY_REQUIRED');
  return path;
}
export function separateDirectories(left, right) {
  if (left === right || left.startsWith(right + sep) || right.startsWith(left + sep))
    throw fault('SOURCE_AND_DESTINATION_WORKSPACE_MUST_BE_SEPARATE');
}
export async function readPrivate(path, { optional = false, maxBytes = 1048576 } = {}) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0 ||
        process.getuid && info.uid !== process.getuid()) throw fault('PRIVATE_OPERATOR_FILE_REQUIRED');
    if (info.size > maxBytes) throw fault('OPERATOR_FILE_TOO_LARGE');
    const bytes = await file.readFile();
    if (bytes.length > maxBytes) throw fault('OPERATOR_FILE_TOO_LARGE');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  finally { await file?.close(); }
}
export async function readJSON(path, options) {
  const text = await readPrivate(path, options);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { throw fault('INVALID_OPERATOR_JSON'); }
}
export async function writeJSON(path, value, { createOnly = false } = {}) {
  await privateDirectory(dirname(path));
  const existing = await readPrivate(path, { optional: true });
  if (createOnly && existing !== null) throw fault('OPERATOR_FILE_ALREADY_EXISTS', 409);
  const temporary = join(dirname(path), '.write-' + randomUUID());
  let file;
  try {
    file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0), 0o600);
    await file.writeFile(JSON.stringify(value, null, 2) + '\n');
    await file.sync(); await file.close(); file = null;
    // Callers hold the original kernel lease before replacing shared metadata.
    await rename(temporary, path);
    const directory = await open(dirname(path), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await file?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export async function destinationIds(root) {
  const entries = await readdir(join(root, 'destinations'), { withFileTypes: true });
  return entries.filter(entry => entry.isDirectory() && idPattern.test(entry.name))
    .map(entry => entry.name).sort();
}
export function destinationPath(root, id) {
  if (!idPattern.test(id ?? '')) throw fault('INVALID_DESTINATION_ID');
  return join(root, 'destinations', id);
}
export function eventPrefix(events, count = events.length) {
  if (!Number.isSafeInteger(count) || count < 0 || count > events.length)
    throw fault('SOURCE_JOURNAL_CONTINUITY_CHANGED', 409);
  const digest = createHash('sha256');
  for (let index = 0; index < count; index++) digest.update(JSON.stringify(events[index]) + '\n');
  return digest.digest('hex');
}
export function expectRevision(destination, expectedRevision) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== destination.revision)
    throw fault('DESTINATION_CHANGED_REFRESH', 409);
}
export function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key))) throw fault('INVALID_OPERATION_FIELDS');
}
