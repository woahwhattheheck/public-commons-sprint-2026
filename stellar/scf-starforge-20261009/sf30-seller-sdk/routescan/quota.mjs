// MIT. Shared account quota; one atomic reservation precedes each original provider call.
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail, json, plain } from './config.mjs';

const SCHEMA = 'stellar-forge.routescan-quota.v1';
const WINDOW = 86400000, BUCKET = 60000;
const uint = value => Number.isSafeInteger(value) && value >= 0;
export async function privateDirectory(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory || directory === '/') fail('Select an absolute private directory.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || await realpath(directory) !== directory)
    fail('The selected directory must be private and must not be a symlink.');
  return directory;
}
export async function atomicJson(directory, name, value, { exclusive = false } = {}) {
  const temp = join(directory, '.write-' + randomUUID()), target = join(directory, name);
  let file;
  try {
    file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await file.writeFile(json(value)); await file.sync(); await file.close(); file = null;
    if (exclusive) {
      const { link } = await import('node:fs/promises');
      await link(temp, target); await unlink(temp);
    } else await rename(temp, target);
    const dir = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await dir.sync(); } finally { await dir.close(); }
  } finally { await file?.close().catch(() => {}); await unlink(temp).catch(() => {}); }
}
export async function readPrivateJson(path, max = 1048576) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || info.size > max) fail('Invalid retained private record.', 503);
    const bytes = await file.readFile();
    if (bytes.length > max) fail('Retained record is too large.', 503);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await file.close(); }
}

/** Per-transaction Linux flock allows preview and merchant processes to share
 * one provider account. The lock file is retained; closing its fd releases it. */
export async function withPrivateLock(directory, name, work) {
  const path = join(directory, name);
  const file = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const [info, named] = await Promise.all([file.stat(), lstat(path)]);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || named.isSymbolicLink() || info.dev !== named.dev || info.ino !== named.ino)
      fail('The retained workspace lock changed.', 503, 'ROUTESCAN_LOCK_CHANGED');
    const lock = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3'],
      { stdio: ['ignore', 'pipe', 'pipe', file.fd], timeout: 10000 });
    if (lock.error || lock.status !== 0) fail(lock.status === 73 ? 'Another process is updating this record; reopen it and continue.' : 'Linux util-linux flock is required.',
      503, lock.status === 73 ? 'ROUTESCAN_RECORD_BUSY' : 'ROUTESCAN_FLOCK_REQUIRED');
    const again = await lstat(path);
    if (again.dev !== info.dev || again.ino !== info.ino || again.isSymbolicLink()) fail('The retained workspace lock changed.', 503);
    return await work();
  } finally { await file.close(); }
}

export async function openRoutescanQuota({ directory, provider, policy }) {
  await privateDirectory(directory);
  const path = join(directory, 'quota.json'), identity = { account: provider.account, apiKeyEnv: provider.apiKeyEnv ?? null };
  let pending = Promise.resolve(), closed = false;
  function validate(state) {
    if (!plain(state) || state.schema !== SCHEMA || state.account !== identity.account || state.apiKeyEnv !== identity.apiKeyEnv ||
        !uint(state.revision) || !uint(state.lastDispatchAt) || !uint(state.cooldownUntil) || !uint(state.dispatched) ||
        !Array.isArray(state.buckets) || state.buckets.length > 1442 || state.buckets.some(row => !Array.isArray(row) || row.length !== 2 || !uint(row[0]) || !uint(row[1])) ||
        state.buckets.some((row, i) => i && row[0] <= state.buckets[i - 1][0]))
      fail('The quota record does not match this provider account.', 503, 'ROUTESCAN_QUOTA_CHANGED');
    return state;
  }
  async function read() {
    try { return validate(await readPrivateJson(path)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { schema: SCHEMA, ...identity, revision: 0, lastDispatchAt: 0, cooldownUntil: 0, dispatched: 0, buckets: [] };
    }
  }
  function view(state, now) {
    const buckets = state.buckets.filter(([minute]) => minute * BUCKET + WINDOW + BUCKET > now);
    const calls = buckets.reduce((sum, [, count]) => sum + count, 0);
    const interval = Math.ceil(1000 / policy.requestsPerSecond);
    const rateAt = state.lastDispatchAt ? state.lastDispatchAt + interval : 0;
    const dailyAt = calls >= policy.callsPerDay ? buckets[0][0] * BUCKET + WINDOW + BUCKET : 0;
    const retryAt = Math.max(state.cooldownUntil, rateAt, dailyAt);
    return { schema: SCHEMA, ...identity, revision: state.revision, policy: { ...policy },
      callsInWindow: calls, remainingCalls: Math.max(0, policy.callsPerDay - calls), windowSeconds: 86400,
      bucketSeconds: 60, lastDispatchAt: state.lastDispatchAt, providerCooldownUntil: state.cooldownUntil,
      totalDispatched: state.dispatched, allowed: retryAt <= now,
      retryAfterSeconds: retryAt > now ? Math.max(1, Math.ceil((retryAt - now) / 1000)) : 0,
      retryAt: retryAt > now ? new Date(retryAt).toISOString() : null };
  }
  function transact(work) {
    const result = pending.then(async () => {
      if (closed) fail('The quota session is closed.', 503);
      return withPrivateLock(directory, 'quota.lock', async () => work(await read(), Date.now()));
    });
    pending = result.catch(() => {}); return result;
  }
  function snapshot() { return transact((state, now) => view(state, now)); }
  function reserve() {
    return transact(async (state, now) => {
      const current = view(state, now);
      if (!current.allowed) throw Object.assign(new Error('Provider call quota is currently unavailable.'), {
        status: 429, code: 'ROUTESCAN_QUOTA_UNAVAILABLE', retryAfter: current.retryAfterSeconds, quota: current,
      });
      const buckets = state.buckets.filter(([minute]) => minute * BUCKET + WINDOW + BUCKET > now), minute = Math.floor(now / BUCKET);
      if (buckets.at(-1)?.[0] === minute) buckets[buckets.length - 1] = [minute, buckets.at(-1)[1] + 1];
      else buckets.push([minute, 1]);
      const next = { ...state, revision: state.revision + 1, buckets, lastDispatchAt: now, dispatched: state.dispatched + 1 };
      await atomicJson(directory, 'quota.json', next);
      return view(next, now);
    });
  }
  function observe(response) {
    const status = response?.body?.upstreamStatus ?? response?.status;
    if (status !== 429) return Promise.resolve();
    return transact(async (state, now) => {
      const raw = response.headers?.['retry-after'];
      const end = /^\d+$/.test(raw ?? '') ? now + Number(raw) * 1000 : Date.parse(raw);
      const until = Number.isSafeInteger(end) && end > now && end <= 8640000000000000 ? end : now + 60000;
      await atomicJson(directory, 'quota.json', { ...state, revision: state.revision + 1, cooldownUntil: Math.max(state.cooldownUntil, until) });
    });
  }
  return { directory, snapshot, reserve, observe, async close() { closed = true; await pending; } };
}
