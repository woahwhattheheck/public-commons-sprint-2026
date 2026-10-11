// MIT. Operator-owned file configuration; database paths resolve beside this file.
import { open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createSqliteQuerySource } from './source.mjs';
import { record } from './parameters.mjs';

export async function openSqliteQueryFile(filename) {
  const path = resolve(filename), handle = await open(path, 'r');
  let config;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 262144) throw new TypeError('Source configuration must be a regular JSON file up to 256 KiB');
    const buffer = Buffer.alloc(262145); let total = 0;
    while (total < buffer.length) { const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null); if (!bytesRead) break; total += bytesRead; }
    if (total > 262144) throw new RangeError('Source configuration exceeds 256 KiB');
    config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total)));
  } finally { await handle.close(); }
  if (!record(config) || config.schema !== 'stellar-forge.sqlite-source.v1' || typeof config.database !== 'string')
    throw new TypeError('Expected stellar-forge.sqlite-source.v1 configuration');
  return createSqliteQuerySource({ database: resolve(dirname(path), config.database), queries: config.queries,
    maxPending: config.maxPending, startupTimeoutMs: config.startupTimeoutMs, workerCount: config.workerCount });
}
