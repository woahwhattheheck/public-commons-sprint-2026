// MIT. Durable original OData workspace state and source files.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { acquireReleaseLease } from '../../sf82-seller-pilot/release-process.mjs';

export const SCHEMA = 'stellar-forge.odata-workspace.v1';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const stable = value => JSON.stringify(canonical(value));
export const formatted = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const fault = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
export const now = () => new Date().toISOString();
export function identifier(value, label = 'identifier') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value))
    throw fault('ODATA_IDENTIFIER', 'Use a valid ' + label + '.');
  return value;
}
export async function writeNew(path, bytes) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
export async function atomic(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeNew(temporary, formatted(value));
    await rename(temporary, path);
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
export async function retain(directory, bytes) {
  const body = Buffer.from(bytes), hash = digest(body), path = join(directory, hash);
  try { await writeNew(path, body); }
  catch (error) { if (error.code !== 'EEXIST') throw error;
    if (digest(await readFile(path)) !== hash) throw fault('ODATA_SOURCE_CHANGED', 'Retained source bytes changed.', 409); }
  return { sha256: hash, bytes: body.length };
}
export async function openState(directory) {
  directory = resolve(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const name of ['sources', 'editions', 'exports', 'transfers']) await mkdir(join(directory, name), { recursive: true, mode: 0o700 });
  const path = join(directory, 'workspace.json');
  try { await writeNew(path, formatted({ schema: SCHEMA, revision: 0, createdAt: now(), connections: [], plans: [], editions: [], reviews: [], exports: [], activeEdition: null })); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  let tail = Promise.resolve();
  async function read() {
    const state = await readJson(path);
    if (state.schema !== SCHEMA || !Number.isSafeInteger(state.revision)) throw fault('ODATA_WORKSPACE_SCHEMA', 'Unsupported OData workspace format.');
    return state;
  }
  async function mutate(operation) {
    const task = tail.then(async () => {
      // Reuse the original native kernel lease. A crashed Linux process releases
      // its descriptor automatically; an old metadata file cannot strand work.
      let lease, lock;
      try {
        lease = await acquireReleaseLease(directory, 'state.lock');
        if (!lease) lock = await open(path + '.lock', 'wx', 0o600);
      } catch (error) {
        if (['EEXIST','RELEASE_BUSY'].includes(error.code)) throw fault('ODATA_WORKSPACE_BUSY', 'Another workspace write is in progress; retry this action.', 409);
        throw error;
      }
      try {
        if (lock) await lock.writeFile(formatted({ pid: process.pid, startedAt: now() }));
        const state = await read(), result = await operation(state);
        state.revision++; state.updatedAt = now(); await atomic(path, state);
        return result;
      } finally {
        await lease?.close();
        if (lock) { await lock.close(); await unlink(path + '.lock'); }
      }
    });
    tail = task.catch(() => {}); return task;
  }
  return { directory, read, mutate, settle: () => tail };
}
