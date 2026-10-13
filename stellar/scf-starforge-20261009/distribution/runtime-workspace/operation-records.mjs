// MIT. Bounded read-only reuse of unchanged original operation JSON.
// Live worker/process/lease observations are performed by the existing reader.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { need } from './storage.mjs';

export function createOperationRecordReader({ maximumBytes = 8 * 1024 * 1024, maximumEntries = 128 } = {}) {
  const entries = new Map(), pending = new Map();
  let retainedBytes = 0, epoch = 0;
  const version = info => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].map(String).join(':');
  const valid = info => need(info.isFile() && info.size <= 4n * 1024n * 1024n,
    'RUNTIME_WORKSPACE_FILE_INVALID');
  function drop(path) {
    const previous = entries.get(path);
    if (previous) { retainedBytes -= previous.bytes; entries.delete(path); }
  }
  async function read(path, optional) {
    let handle;
    const openedEpoch = epoch;
    try {
      // Keep the original O_NOFOLLOW admission and opened-file consistency.
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const first = await handle.stat({ bigint: true }); valid(first);
      const key = version(first), retained = entries.get(path);
      if (retained?.version === key) {
        const last = await handle.stat({ bigint: true }); valid(last);
        need(version(last) === key, 'RUNTIME_WORKSPACE_FILE_CHANGED');
        if (openedEpoch === epoch && entries.get(path) === retained) {
          entries.delete(path); entries.set(path, retained);
        }
        return retained.value;
      }
      drop(path);
      const bytes = await handle.readFile(), last = await handle.stat({ bigint: true }); valid(last);
      need(bytes.length <= 4 * 1024 * 1024 && BigInt(bytes.length) === first.size && version(last) === key,
        'RUNTIME_WORKSPACE_FILE_CHANGED');
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (openedEpoch === epoch && bytes.length <= maximumBytes && maximumEntries > 0) {
        while (entries.size && (retainedBytes + bytes.length > maximumBytes || entries.size >= maximumEntries))
          drop(entries.keys().next().value);
        entries.set(path, { version: key, bytes: bytes.length, value }); retainedBytes += bytes.length;
      }
      return value;
    } catch (error) {
      drop(path);
      if (optional && error.code === 'ENOENT') return null;
      throw error;
    } finally { if (handle) await handle.close(); }
  }
  return {
    async read(path, optional = false) {
      // Optionality belongs to each caller; the shared original read itself
      // keeps a missing record as an error until that caller handles it.
      let work = pending.get(path);
      if (!work) {
        work = read(path, false);
        pending.set(path, work);
      }
      try { return await work; }
      catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
      finally { if (pending.get(path) === work) pending.delete(path); }
    },
    clear() { epoch++; entries.clear(); pending.clear(); retainedBytes = 0; },
  };
}
