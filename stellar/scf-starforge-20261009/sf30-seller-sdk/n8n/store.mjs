// MIT. One retained n8n dispatch history per original paid job, using the native fleet lease.
import { mkdir, open, readFile, lstat, realpath, rename, link, unlink, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireStateLease } from '../../merchant-fleet-gateway/state-lease.mjs';
import { canonical, digest, JOB_ID } from '../jobs/config.mjs';
import { fail } from './config.mjs';

export const STORE_SCHEMA = 'stellar-forge.n8n-dispatch-store.v1';
export async function privateDirectory(path, { create = true } = {}) {
  if (typeof path !== 'string' || resolve(path) !== path) fail('DIRECTORY', 'Use an absolute private directory.');
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 ||
      typeof process.getuid === 'function' && info.uid !== process.getuid() || await realpath(path) !== path)
    fail('DIRECTORY', 'The state directory must be private and canonical.');
  return path;
}
export async function writePrivate(path, bytes, { replace = false } = {}) {
  const temporary = join(dirname(path), '.pending-' + randomUUID());
  let fd;
  try {
    fd = await open(temporary, 'wx', 0o600);
    await fd.writeFile(bytes); await fd.sync(); await fd.close(); fd = null;
    if (replace) await rename(temporary, path); else await link(temporary, path);
    const parent = await open(dirname(path), 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  } finally { if (fd) await fd.close(); await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
export async function readPrivate(path, maximum = 4194304) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.size > maximum)
    fail('STORE_FILE', 'The original private record is unavailable or exceeds its declared limit.', 409);
  const bytes = await readFile(path);
  if (bytes.length > maximum) fail('STORE_FILE', 'The original private record exceeds its declared limit.', 409);
  return bytes;
}
export function jobDirectory(directory, id) {
  if (typeof id !== 'string' || !JOB_ID.test(id)) fail('JOB_ID', 'Select the original paid-job identifier.');
  return join(directory, digest(id));
}
export async function readDispatch(directory, id) {
  try {
    const row = JSON.parse(await readPrivate(join(jobDirectory(directory, id), 'dispatch.json')));
    if (row.schema !== STORE_SCHEMA || row.jobId !== id || !Array.isArray(row.dispatches) || !Number.isSafeInteger(row.revision))
      fail('STORE_IDENTITY', 'The retained dispatch identity does not match this job.', 409);
    return row;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function listDispatches(directory) {
  const rows = [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const path = join(directory, entry.name, 'dispatch.json');
    try {
      const row = JSON.parse(await readPrivate(path));
      if (row.schema !== STORE_SCHEMA || digest(row.jobId) !== entry.name) fail('STORE_IDENTITY', 'A dispatch record has a different identity.', 409);
      rows.push(row);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function activeDispatch(row) { return row?.dispatches.at(-1) ?? null; }
export async function withDispatch(directory, id, action) {
  await privateDirectory(directory);
  const root = await privateDirectory(jobDirectory(directory, id));
  let lease;
  try { lease = await acquireStateLease(root); }
  catch (error) {
    if (error.message === 'FLEET_STATE_ALREADY_OWNED') fail('BUSY', 'This workflow is being monitored by its original worker. Pause that job before an operator repair.', 409);
    throw error;
  }
  try {
    const store = {
      root,
      read: () => readDispatch(directory, id),
      async save(row, event) {
        lease.assertHeld();
        const at = new Date().toISOString();
        row.schema = STORE_SCHEMA; row.jobId = id; row.updatedAt = at;
        row.createdAt ??= at; row.revision = (row.revision ?? 0) + 1;
        row.history ??= [];
        if (event) row.history.push({ at, ...event });
        if (row.history.length > 2048) fail('HISTORY_LIMIT', 'The retained dispatch history reached its limit.', 409);
        await writePrivate(join(root, 'dispatch.json'), Buffer.from(canonical(row) + '\n'), { replace: true });
        return structuredClone(row);
      },
      async result(body) {
        const sha256 = digest(body), filename = 'result-' + sha256 + '.json';
        try { await writePrivate(join(root, filename), body); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const old = await readPrivate(join(root, filename), 67108864);
          if (!old.equals(body)) fail('RESULT_CHANGED', 'The retained result differs from its original digest.', 409);
        }
        return { filename, sha256, bytes: body.length };
      },
    };
    return await action(store);
  } finally { await lease.close(); }
}
export async function readDispatchResult(directory, id) {
  const row = await readDispatch(directory, id), dispatch = activeDispatch(row);
  if (dispatch?.state !== 'SUCCEEDED' || !/^result-[a-f0-9]{64}\.json$/.test(dispatch.result?.filename ?? ''))
    fail('RESULT_PENDING', 'The workflow has not retained its selected result yet.', 409);
  const bytes = await readPrivate(join(jobDirectory(directory, id), dispatch.result.filename), 67108864);
  if (digest(bytes) !== dispatch.result.sha256 || bytes.length !== dispatch.result.bytes)
    fail('RESULT_CHANGED', 'The retained result no longer matches its original bytes.', 409);
  return { row, dispatch, body: bytes };
}
