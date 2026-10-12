// MIT. Private, single-writer seller availability policy. Linux flock follows
// the existing merchant-fleet gateway's retained-file-description lease pattern.
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const SCHEMA = 'stellar-forge.seller-availability-policy.v1';
const MAX_BYTES = 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const availabilityError = (code, status = 400) => Object.assign(new Error(code), { code, status });
const fail = (code, status) => { throw availabilityError(code, status); };
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const reasonValid = value => typeof value === 'string' && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);

export function validateAvailabilityDirectory(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory || directory === '/')
    fail('AVAILABILITY_PRIVATE_DIRECTORY_REQUIRED');
  return directory;
}

function validateState(value, origin) {
  if (!plain(value) || value.schema !== SCHEMA || value.serviceOrigin !== origin ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 || !instant(value.savedAt) ||
      !Array.isArray(value.paused) || value.paused.length > 256 ||
      !Array.isArray(value.changes) || value.changes.length > 32)
    fail('AVAILABILITY_POLICY_INVALID', 503);
  const ids = new Set();
  for (const row of value.paused) {
    if (!plain(row) || !ID.test(row.id ?? '') || ids.has(row.id) ||
        !reasonValid(row.reason) || !instant(row.changedAt)) fail('AVAILABILITY_POLICY_INVALID', 503);
    ids.add(row.id);
  }
  let previous = 0;
  for (const row of value.changes) {
    if (!plain(row) || !Number.isSafeInteger(row.revision) || row.revision <= previous ||
        row.revision > value.revision || !instant(row.at) || !['pause', 'resume'].includes(row.action) ||
        !reasonValid(row.reason) || !Array.isArray(row.routeIds) || !row.routeIds.length || row.routeIds.length > 100 ||
        new Set(row.routeIds).size !== row.routeIds.length || row.routeIds.some(id => !ID.test(id)))
      fail('AVAILABILITY_POLICY_INVALID', 503);
    previous = row.revision;
  }
  return { schema: SCHEMA, serviceOrigin: origin, revision: value.revision, savedAt: value.savedAt,
    paused: value.paused.map(({ id, reason, changedAt }) => ({ id, reason, changedAt })),
    changes: value.changes.map(({ revision, at, action, routeIds, reason }) => ({ revision, at, action, routeIds, reason })) };
}

/** Open only an explicitly selected directory; never infer paths or import a live policy. */
export async function openAvailabilityPolicy({ directory, origin, routeIds }) {
  validateAvailabilityDirectory(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o077) ||
      await realpath(directory) !== directory) fail('AVAILABILITY_PRIVATE_DIRECTORY_REQUIRED');
  const lockPath = join(directory, 'availability.lock');
  const lock = await open(lockPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  let closed = false, closing = false, state, storageError = false, pending = Promise.resolve();
  async function assertLease() {
    if (closed) fail('AVAILABILITY_CLOSED', 503);
    const [opened, named] = await Promise.all([lock.stat(), lstat(lockPath)]);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || opened.nlink !== 1 ||
        (opened.mode & 0o077) || opened.dev !== named.dev || opened.ino !== named.ino)
      fail('AVAILABILITY_LEASE_LOST', 503);
  }
  const statePath = join(directory, 'availability.json');
  async function save(next) {
    await assertLease();
    const bytes = Buffer.from(JSON.stringify(next) + '\n');
    if (bytes.length > MAX_BYTES) fail('AVAILABILITY_POLICY_TOO_LARGE');
    const temp = join(directory, '.availability-' + randomUUID() + '.tmp');
    let handle;
    try {
      handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      await assertLease();
      await rename(temp, statePath);
      // The named file now has this revision. Keep memory aligned even if the
      // directory flush fails; a later refresh exposes the committed revision.
      state = next;
      const dir = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await dir.sync(); } finally { await dir.close(); }
      storageError = false;
    } catch (error) {
      storageError = true;
      await handle?.close().catch(() => {});
      await unlink(temp).catch(() => {});
      throw availabilityError(error.code?.startsWith('AVAILABILITY_') ? error.code : 'AVAILABILITY_SAVE_FAILED', 503);
    }
  }
  try {
    await assertLease();
    const result = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3'],
      { stdio: ['ignore', 'pipe', 'pipe', lock.fd], timeout: 10000 });
    if (result.error || result.status !== 0) fail(result.error?.code === 'ENOENT' ? 'AVAILABILITY_LINUX_FLOCK_REQUIRED' :
      result.status === 73 ? 'AVAILABILITY_ALREADY_OWNED' : 'AVAILABILITY_LEASE_FAILED', 503);
    let file;
    try {
      file = await open(statePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || info.size > MAX_BYTES)
        fail('AVAILABILITY_POLICY_INVALID', 503);
      const bytes = await file.readFile();
      if (bytes.length > MAX_BYTES) fail('AVAILABILITY_POLICY_INVALID', 503);
      state = validateState(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), origin);
    } catch (error) {
      if (error.code !== 'ENOENT') throw availabilityError('AVAILABILITY_POLICY_INVALID', 503);
      await save({ schema: SCHEMA, serviceOrigin: origin, revision: 0, savedAt: new Date().toISOString(), paused: [], changes: [] });
    } finally { await file?.close(); }
  } catch (error) { closed = true; await lock.close(); throw error; }

  function update(input) {
    const operation = pending.then(async () => {
      if (closing || closed) fail('AVAILABILITY_CLOSED', 503);
      if (!plain(input) || Object.keys(input).some(key => !['expectedRevision', 'action', 'routeIds', 'reason'].includes(key)) ||
          !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
          !['pause', 'resume'].includes(input.action) || !Array.isArray(input.routeIds) || !input.routeIds.length ||
          input.routeIds.length > 100 || new Set(input.routeIds).size !== input.routeIds.length ||
          input.routeIds.some(id => typeof id !== 'string' || !ID.test(id)) ||
          !reasonValid(input.reason ?? '')) fail('AVAILABILITY_CHANGE_INVALID');
      if (input.expectedRevision !== state.revision) fail('AVAILABILITY_REVISION_CHANGED', 409);
      if (state.revision === Number.MAX_SAFE_INTEGER) fail('AVAILABILITY_REVISION_EXHAUSTED', 503);
      const paused = new Map(state.paused.map(row => [row.id, row]));
      if (input.routeIds.some(id => !routeIds.has(id) && !(input.action === 'resume' && paused.has(id))))
        fail('AVAILABILITY_ROUTE_UNKNOWN');
      const at = new Date().toISOString(), reason = (input.reason ?? '').trim();
      for (const id of input.routeIds) {
        if (input.action === 'pause') paused.set(id, { id, reason, changedAt: at });
        else paused.delete(id);
      }
      if (paused.size > 256) fail('AVAILABILITY_RETIRED_PAUSE_LIMIT');
      const revision = state.revision + 1;
      const change = { revision, at, action: input.action, routeIds: [...input.routeIds].sort(), reason };
      await save({ ...state, revision, savedAt: at, paused: [...paused.values()].sort((a, b) => a.id.localeCompare(b.id)),
        changes: [...state.changes, change].slice(-32) });
      return snapshot();
    });
    pending = operation.catch(() => {});
    return operation;
  }
  function snapshot() { return { ...structuredClone(state), storageState: storageError ? 'unavailable' : 'ready' }; }
  return Object.freeze({ snapshot, update,
    paused: id => storageError || closing || closed || state.paused.some(row => row.id === id),
    async close() { closing = true; await pending; if (!closed) { closed = true; await lock.close(); } },
  });
}
