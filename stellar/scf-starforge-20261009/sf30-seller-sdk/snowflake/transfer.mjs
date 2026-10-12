// MIT. Resume exact original file receiving through the private operator browser.
import { mkdir, lstat, realpath, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { canonical, sha256, atomicJson, boundedFile } from '../../sf46-release/release-core.mjs';
import { compileSnowflakeSource, fault } from './declaration.mjs';
import { HASH, UUID } from './store.mjs';

export const MAX_SNOWFLAKE_TRANSFER_CHUNK_BYTES = 196608;
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
    partitions: state.manifest.partitions.map((part, index) => ({ ...part, received: Boolean(state.uploaded[index]),
      receivedBytes: state.uploaded[index] ? part.bytes : state.offsets?.[index] ?? 0 })),
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
        state.uploaded[index] = true; (state.offsets ??= [])[index] = part.bytes; state.updatedAt = new Date().toISOString();
        await write(state);
        await unlink(join(root, filename(id) + '.' + index + '.part')).catch(error => { if (error.code !== 'ENOENT') throw error; });
        return view(state);
      });
    },
    /** Continue one original partition without putting its complete body in MCP JSON. */
    append(id, index, { offset, bytes, chunkSha256 }) {
      return exclusive(id, async () => {
        const state = await load(id), part = state.manifest.partitions[index];
        if (!Number.isSafeInteger(index) || index < 0 || !part) throw fault('SNOWFLAKE_PARTITION_UNKNOWN', undefined, 404);
        if (!Number.isSafeInteger(offset) || offset < 0 || !(bytes instanceof Uint8Array) ||
            bytes.length < 1 || bytes.length > MAX_SNOWFLAKE_TRANSFER_CHUNK_BYTES ||
            offset + bytes.length > part.bytes || !HASH.test(chunkSha256 ?? '') || sha256(bytes) !== chunkSha256)
          throw fault('SNOWFLAKE_RECEIVING_CHUNK_INVALID');
        if (state.uploaded[index]) {
          const original = await store.readObject(part);
          if (!Buffer.from(original.subarray(offset, offset + bytes.length)).equals(Buffer.from(bytes)))
            throw fault('SNOWFLAKE_RECEIVING_CHUNK_CHANGED', 'The replay differs from the received original partition.', 409);
          return view(state);
        }
        const committed = state.offsets?.[index] ?? 0;
        if (!Number.isSafeInteger(committed) || committed < 0 || committed > part.bytes || offset > committed ||
            offset < committed && offset + bytes.length > committed)
          throw fault('SNOWFLAKE_RECEIVING_OFFSET_CONFLICT', 'Continue at the original receivedBytes offset or replay a complete saved chunk.', 409);
        const path = join(root, filename(id) + '.' + index + '.part');
        const handle = await open(path, constants.O_RDWR | constants.O_CREAT |
          (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0), 0o600);
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.mode & 0o077 || info.size < committed || info.size > part.bytes)
            throw fault('SNOWFLAKE_RECEIVING_PARTIAL_CHANGED', 'Repair this original partition before continuing.');
          // Bytes after the saved cursor were never acknowledged. The original
          // receiving journal, not the process lifetime, owns this boundary.
          if (info.size > committed) { await handle.truncate(committed); await handle.sync(); }
          if (offset < committed) {
            const saved = Buffer.alloc(bytes.length); let used = 0;
            while (used < saved.length) {
              const result = await handle.read(saved, used, saved.length - used, offset + used);
              if (!result.bytesRead) throw fault('SNOWFLAKE_RECEIVING_PARTIAL_CHANGED');
              used += result.bytesRead;
            }
            if (!saved.equals(Buffer.from(bytes))) throw fault('SNOWFLAKE_RECEIVING_CHUNK_CHANGED', undefined, 409);
          } else {
            let used = 0;
            while (used < bytes.length) {
              const result = await handle.write(bytes, used, bytes.length - used, offset + used);
              if (!result.bytesWritten) throw fault('SNOWFLAKE_RECEIVING_WRITE_INTERRUPTED');
              used += result.bytesWritten;
            }
            await handle.sync();
            (state.offsets ??= [])[index] = offset + bytes.length;
            state.updatedAt = new Date().toISOString(); await write(state);
          }
          if (state.offsets?.[index] === part.bytes) {
            const original = Buffer.alloc(part.bytes); let used = 0;
            while (used < original.length) {
              const result = await handle.read(original, used, original.length - used, used);
              if (!result.bytesRead) throw fault('SNOWFLAKE_RECEIVING_PARTIAL_CHANGED');
              used += result.bytesRead;
            }
            if (sha256(original) !== part.sha256) throw fault('SNOWFLAKE_RECEIVING_BYTES_CHANGED',
              'The complete partition differs from its original manifest; repair this partition and upload it again.');
            await store.putObject(original);
            state.uploaded[index] = true; await write(state);
          }
        } finally { await handle.close(); }
        if (state.uploaded[index]) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
        return view(state);
      });
    },
    /** Repair an incomplete partition in this same receiving record. */
    repair(id, index) {
      return exclusive(id, async () => {
        const state = await load(id), part = state.manifest.partitions[index];
        if (!Number.isSafeInteger(index) || index < 0 || !part) throw fault('SNOWFLAKE_PARTITION_UNKNOWN', undefined, 404);
        if (state.uploaded[index]) { await store.readObject(part); return view(state); }
        (state.offsets ??= [])[index] = 0; state.updatedAt = new Date().toISOString(); await write(state);
        await unlink(join(root, filename(id) + '.' + index + '.part')).catch(error => { if (error.code !== 'ENOENT') throw error; });
        return view(state);
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
