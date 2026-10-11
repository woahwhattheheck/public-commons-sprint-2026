// MIT. Private retained records for the original runtime operator workspace.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, rename, readFile, link, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const now = () => new Date().toISOString();
export const digest = value => createHash('sha256').update(value).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const fail = (code, message = code, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
export const need = (value, code, message, status) => { if (!value) fail(code, message, status); };
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
export function recordId(value) {
  need(typeof value === 'string' && /^[a-f0-9]{24}$/.test(value), 'RUNTIME_WORKSPACE_RECORD_INVALID');
  return value;
}
export function operationId(value) {
  need(typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value),
    'RUNTIME_WORKSPACE_OPERATION_INVALID');
  return value;
}
export function absolute(value) {
  need(typeof value === 'string' && value && value === resolve(value) && !value.includes('\0'),
    'RUNTIME_WORKSPACE_ABSOLUTE_PATH_REQUIRED');
  return value;
}
export async function privateDirectory(value) {
  const path = absolute(value), info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    !(info.mode & 0o077) && (process.getuid === undefined || info.uid === process.getuid()),
  'RUNTIME_WORKSPACE_PRIVATE_DIRECTORY_REQUIRED', 'Use a private real directory owned by the current operator');
  return path;
}
export async function makePrivate(value) {
  const path = absolute(value);
  need(await realpath(dirname(path)) === dirname(path), 'RUNTIME_WORKSPACE_REAL_PARENT_REQUIRED');
  await mkdir(path, { mode: 0o700 });
  return privateDirectory(path);
}
export async function regular(path, maximum = 4 * 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const first = await handle.stat();
    need(first.isFile() && first.size <= maximum, 'RUNTIME_WORKSPACE_FILE_INVALID');
    const bytes = await handle.readFile(), last = await handle.stat();
    need(bytes.length <= maximum && first.size === last.size && first.mtimeMs === last.mtimeMs &&
      first.ctimeMs === last.ctimeMs, 'RUNTIME_WORKSPACE_FILE_CHANGED');
    return bytes;
  } finally { await handle.close(); }
}
export async function readJSON(path, optional = false) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(path))); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
export async function saveJSON(path, value, replace = false) {
  const temporary = path + '.pending-' + randomUUID();
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(json(value)); await handle.sync(); }
  finally { await handle.close(); }
  if (replace) await rename(temporary, path);
  else {
    try { await link(temporary, path); }
    finally { await unlink(temporary); }
  }
  const parent = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
  try { await parent.sync(); } finally { await parent.close(); }
}
export async function processIdentity(pid = process.pid) {
  try {
    const text = await readFile('/proc/' + pid + '/stat', 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
    if (fields[0] === 'Z') return null;
    return fields[19] ?? null;
  } catch { return null; }
}
export async function workerAlive(state) {
  return Number.isInteger(state?.pid) && typeof state?.processStart === 'string' &&
    await processIdentity(state.pid) === state.processStart;
}
export async function operationLease(path) {
  const handle = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const info = await handle.stat();
    need(info.isFile() && info.nlink === 1 && !(info.mode & 0o077), 'RUNTIME_WORKSPACE_LEASE_INVALID');
    const result = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', '3'],
      { stdio: ['ignore', 'ignore', 'ignore', handle.fd], timeout: 5000 });
    need(!result.error && result.status === 0,
      result.status === 75 ? 'RUNTIME_WORKSPACE_OPERATION_RUNNING' : 'RUNTIME_WORKSPACE_FLOCK_UNAVAILABLE');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
// The existing kernel lease remains authoritative when a container's mounted
// /proc does not expose its inner PID namespace.
export async function operationRunning(path) {
  let lease;
  try { lease = await operationLease(path); return false; }
  catch (error) { if (error.code === 'RUNTIME_WORKSPACE_OPERATION_RUNNING') return true; throw error; }
  finally { if (lease) await lease.close(); }
}
export async function tailFile(path, maximum = 65536) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    need(info.isFile(), 'RUNTIME_WORKSPACE_LOG_INVALID');
    const start = Math.max(0, info.size - maximum), bytes = Buffer.alloc(Math.min(info.size, maximum));
    const read = await handle.read(bytes, 0, bytes.length, start);
    return { text: bytes.subarray(0, read.bytesRead).toString('utf8'), totalBytes: info.size, offset: start };
  } finally { await handle.close(); }
}
