// MIT. Resume exact original file receiving through the private operator browser.
import { mkdir, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, sha256, atomicJson, boundedFile } from '../../sf46-release/release-core.mjs';
import { compileSnowflakeSource, fault } from './declaration.mjs';
import { HASH, UUID } from './store.mjs';

const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
export function validateSnowflakeReceivingManifest(manifest) {
  if (manifest?.schema !== 'stellar-forge.snowflake-receiving.v1' ||
      !UUID.test(manifest.requestId ?? '') || !Array.isArray(manifest.partitions) ||
      !manifest.partitions.length || manifest.partitions.length > 20000)
    throw fault('SNOWFLAKE_RECEIVING_MANIFEST_INVALID');
  compileSnowflakeSource(manifest.source);
  if (manifest.sourceId && manifest.sourceId !== sha256(canonical(manifest.source)))
    throw fault('SNOWFLAKE_RECEIVING_SOURCE_CHANGED');
  if (manifest.editionId && !HASH.test(manifest.editionId)) throw fault('SNOWFLAKE_EDITION_ID_INVALID');
  let total = 0; const paths = new Set();
  for (const [index, part] of manifest.partitions.entries()) {
    if (part.partition !== index || !HASH.test(part.sha256 ?? '') || !Number.isSafeInteger(part.bytes) ||
        part.bytes < 1 || part.bytes > 67108864 || (total += part.bytes) > 1073741824 ||
        typeof part.path !== 'string' || part.path.length > 256 || part.path.startsWith('/') ||
        part.path.includes('\\') || part.path.split('/').some(segment => !segment || segment === '.' || segment === '..') ||
        paths.has(part.path)) throw fault('SNOWFLAKE_RECEIVING_DESCRIPTOR_INVALID');
    paths.add(part.path);
  }
  return manifest;
}
export async function createSnowflakeTransfers(workspace) {
  const store = workspace.store, root = join(store.directory, 'receiving'), tasks = new Map();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 || await realpath(root) !== root)
    throw fault('SNOWFLAKE_PRIVATE_DIRECTORY_REQUIRED');
  let closing = false;
  const filename = id => {
    if (!HASH.test(id ?? '')) throw fault('SNOWFLAKE_RECEIVING_ID_INVALID');
    return id + '.json';
  };
  const load = async id => {
    const state = parse(await boundedFile(root, filename(id), 4194304));
    if (state.schema !== 'stellar-forge.snowflake-browser-receiving.v1' || state.id !== id ||
        sha256(canonical(state.manifest)) !== id) throw fault('SNOWFLAKE_RECEIVING_STATE_CHANGED');
    return state;
  };
  const write = state => atomicJson(join(root, filename(state.id)), state);
  const view = state => ({ id: state.id, status: state.status, requestId: state.manifest.requestId,
    editionId: state.editionId ?? null, received: state.uploaded.filter(Boolean).length,
    partitions: state.manifest.partitions.map((part, index) => ({ ...part, received: Boolean(state.uploaded[index]) })),
    ...(state.lastError ? { lastError: state.lastError } : {}) });
  function exclusive(id, task) {
    if (closing) return Promise.reject(fault('SNOWFLAKE_WORKSPACE_CLOSING', undefined, 503));
    const before = tasks.get(id) ?? Promise.resolve();
    const pending = before.catch(() => {}).then(task).finally(() => { if (tasks.get(id) === pending) tasks.delete(id); });
    tasks.set(id, pending); return pending;
  }
  return {
    async begin(manifest) {
      validateSnowflakeReceivingManifest(manifest);
      if (Buffer.byteLength(canonical(manifest)) > 2097152) throw fault('SNOWFLAKE_RECEIVING_MANIFEST_TOO_LARGE');
      const id = sha256(canonical(manifest));
      return exclusive(id, async () => {
        try { return view(await load(id)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const state = { schema: 'stellar-forge.snowflake-browser-receiving.v1', id, manifest,
          createdAt: new Date().toISOString(), status: 'RECEIVING',
          uploaded: manifest.partitions.map(() => false) };
        await write(state); return view(state);
      });
    },
    async status(id) { return view(await load(id)); },
    async descriptor(id, index) {
      const state = await load(id);
      if (!Number.isSafeInteger(index) || index < 0 || index >= state.manifest.partitions.length)
        throw fault('SNOWFLAKE_PARTITION_UNKNOWN', undefined, 404);
      return state.manifest.partitions[index];
    },
    put(id, index, bytes) {
      return exclusive(id, async () => {
        const state = await load(id), part = state.manifest.partitions[index];
        if (!Number.isSafeInteger(index) || index < 0 || !part) throw fault('SNOWFLAKE_PARTITION_UNKNOWN', undefined, 404);
        if (!(bytes instanceof Uint8Array) || bytes.length !== part.bytes || sha256(bytes) !== part.sha256)
          throw fault('SNOWFLAKE_RECEIVING_BYTES_CHANGED');
        await store.putObject(bytes);
        state.uploaded[index] = true; state.updatedAt = new Date().toISOString();
        await write(state); return view(state);
      });
    },
    commit(id) {
      return exclusive(id, async () => {
        const state = await load(id);
        if (state.status === 'RECEIVED') { store.edition(state.editionId); return view(state); }
        if (!state.uploaded.every(Boolean)) throw fault('SNOWFLAKE_RECEIVING_PARTITIONS_MISSING');
        state.status = 'IMPORTING'; await write(state);
        async function* originals() { for (const part of state.manifest.partitions) yield await store.readObject(part); }
        try {
          const operation = await workspace.receiveOriginals(state.manifest, originals());
          state.status = operation.status === 'COMPLETE' ? 'RECEIVED' : operation.status;
          state.editionId = operation.editionId; state.operationId = operation.id; delete state.lastError;
          await write(state); return view(state);
        } catch (error) {
          state.status = 'INTERRUPTED'; state.lastError = { code: error.code ?? 'SNOWFLAKE_RECEIVING_INTERRUPTED', message: error.message };
          await write(state); throw error;
        }
      });
    },
    async close() { closing = true; await Promise.allSettled([...tasks.values()]); },
  };
}
