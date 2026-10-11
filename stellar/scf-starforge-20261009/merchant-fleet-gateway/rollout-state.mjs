// MIT. Private immutable merchant configuration snapshots; no seller credentials or processes owned.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants, closeSync, existsSync, fsyncSync, fstatSync, lstatSync, mkdirSync,
  openSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { acquireStateLease } from './state-lease.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const MAX = 16 * 1024 * 1024;
const ID = /^[a-f0-9]{32}$/;
const HEX = /^[a-f0-9]{64}$/;
const SCHEMA = 'stellar-forge.fleet-rollout-state.v1';
const json = value => JSON.stringify(value, null, 2) + '\n';
function privateDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const s = lstatSync(path);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077))
    throw new Error('FLEET_PRIVATE_DIRECTORY_REQUIRED');
}
function readPrivate(path, limit = MAX) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || (s.mode & 0o077) || s.size > limit) throw new Error('FLEET_PRIVATE_FILE_REQUIRED');
    const bytes = readFileSync(fd);
    if (bytes.length > limit) throw new Error('FLEET_STATE_TOO_LARGE');
    return bytes;
  } finally { closeSync(fd); }
}
function atomic(path, value) {
  const bytes = Buffer.from(json(value));
  if (bytes.length > MAX) throw new Error('FLEET_STATE_TOO_LARGE');
  const temp = path + '.' + randomUUID() + '.tmp';
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  try {
    renameSync(temp, path);
    const dir = openSync(dirname(path), constants.O_RDONLY);
    try { fsyncSync(dir); } finally { closeSync(dir); }
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}
function birth(pid) {
  try {
    const stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() + ':' +
      stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch { return null; }
}
export async function openRolloutState(directory) {
  if (!isAbsolute(directory) || resolve(directory) !== directory || directory === '/')
    throw new TypeError('Use an absolute normalized private fleet state directory');
  privateDirectory(directory);
  const snapshots = join(directory, 'snapshots'); privateDirectory(snapshots);
  // A stale PID file must never let concurrent restarts unlink each other's
  // new lease. Linux flock holds the actual file inode until its holder exits.
  if (process.platform !== 'linux') throw new Error('FLEET_DURABLE_CONTROL_REQUIRES_LINUX');
  const lease = await acquireStateLease(directory);
  const lockPath = join(directory, 'owner.json');
  const owner = { id: randomUUID(), host: hostname(), pid: process.pid, birth: birth(process.pid), leasePid: lease.pid };
  try { atomic(lockPath, owner); }
  catch (error) { await lease.close(); throw error; }
  let closed = false;
  const assertOwner = () => {
    lease.assertHeld();
    if (closed || JSON.parse(readPrivate(lockPath, 4096)).id !== owner.id)
      throw new Error('FLEET_STATE_OWNERSHIP_CHANGED');
  };
  const statePath = join(directory, 'active.json');
  const read = () => {
    if (!existsSync(statePath)) return null;
    const state = JSON.parse(readPrivate(statePath));
    if (state?.schema !== SCHEMA || !Number.isSafeInteger(state.revision) || state.revision < 1 ||
        !ID.test(state.snapshotId) || !HEX.test(state.digest) || !Array.isArray(state.history) ||
        state.history.length > 16 || state.history.some(row => !ID.test(row.snapshotId) || !HEX.test(row.digest)))
      throw new Error('FLEET_STATE_INVALID');
    return state;
  };
  const close = async () => {
    if (closed) return;
    try { assertOwner(); unlinkSync(lockPath); }
    finally { closed = true; await lease.close(); }
  };
  try {
    const controlPath = join(directory, 'control.json');
    const prior = existsSync(controlPath) ? JSON.parse(readPrivate(controlPath, 4096)) : null;
    if (prior && (typeof prior.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(prior.token)))
      throw new Error('FLEET_CONTROL_FILE_INVALID');
    const token = prior?.token ?? randomBytes(32).toString('base64url');
    read();
    return {
      directory, controlPath, token, instance: owner.id, read,
      snapshot(fleet) {
        assertOwner();
        if (!fleet.sourceManifest || !Array.isArray(fleet.sourceConfigs)) throw new Error('FLEET_SOURCE_REQUIRED');
        const snapshotId = randomUUID().replaceAll('-', '');
        const dir = join(snapshots, snapshotId); mkdirSync(dir, { mode: 0o700 });
        try {
          const configDir = join(dir, 'sellers'); privateDirectory(configDir);
          const manifest = structuredClone(fleet.sourceManifest);
          const files = [];
          for (let i = 0; i < manifest.tenants.length; i++) {
            const name = 'sellers/' + manifest.tenants[i].id + '.json';
            const bytes = Buffer.from(json(fleet.sourceConfigs[i]));
            if (bytes.length > 1024 * 1024) throw new Error('FLEET_CONFIG_TOO_LARGE');
            atomic(join(dir, name), fleet.sourceConfigs[i]);
            files.push({ path: name, sha256: hash(bytes) });
            manifest.tenants[i].sellerConfig = './' + name;
          }
          atomic(join(dir, 'fleet.json'), manifest);
          files.push({ path: 'fleet.json', sha256: hash(json(manifest)) });
          const digest = hash(json(files));
          atomic(join(dir, 'snapshot.json'), { schema: 'stellar-forge.fleet-snapshot.v1', snapshotId, digest, files });
          return { snapshotId, digest };
        } catch (error) { rmSync(dir, { recursive: true, force: true }); throw error; }
      },
      manifest(record) {
        if (!ID.test(record?.snapshotId) || !HEX.test(record?.digest)) throw new Error('FLEET_SNAPSHOT_INVALID');
        const dir = join(snapshots, record.snapshotId);
        privateDirectory(dir);
        const meta = JSON.parse(readPrivate(join(dir, 'snapshot.json')));
        if (meta?.schema !== 'stellar-forge.fleet-snapshot.v1' || meta.snapshotId !== record.snapshotId ||
            meta.digest !== record.digest || !Array.isArray(meta.files) || meta.files.length < 3 ||
            meta.files.length > 33 || hash(json(meta.files)) !== record.digest)
          throw new Error('FLEET_SNAPSHOT_CHANGED');
        const names = new Set();
        for (const file of meta.files) {
          if (!/^(?:fleet\.json|sellers\/[a-z][a-z0-9-]{1,39}\.json)$/.test(file.path) ||
              names.has(file.path) || !HEX.test(file.sha256)) throw new Error('FLEET_SNAPSHOT_INVALID');
          names.add(file.path);
          if (hash(readPrivate(join(dir, file.path))) !== file.sha256) throw new Error('FLEET_SNAPSHOT_CHANGED');
        }
        if (!names.has('fleet.json')) throw new Error('FLEET_SNAPSHOT_INVALID');
        return join(dir, 'fleet.json');
      },
      activate(record, expectedRevision) {
        assertOwner();
        const prior = read();
        if ((prior?.revision ?? 0) !== expectedRevision) throw new Error('FLEET_REVISION_CHANGED');
        this.manifest(record);
        const history = prior ? [
          { revision: prior.revision, snapshotId: prior.snapshotId, digest: prior.digest, at: prior.at },
          ...prior.history,
        ].slice(0, 16) : [];
        const next = { schema: SCHEMA, revision: expectedRevision + 1, ...record,
          at: new Date().toISOString(), history };
        atomic(statePath, next);
        return next;
      },
      publish(url) {
        assertOwner();
        atomic(controlPath, { schema: 'stellar-forge.fleet-control.v1', url, token, instance: owner.id });
      },
      collect(extra = []) {
        assertOwner();
        const state = read();
        const keep = new Set([state, ...(state?.history ?? []), ...extra]
          .filter(Boolean).map(record => record.snapshotId));
        let removed = 0, retained = 0, unmanaged = 0;
        for (const name of readdirSync(snapshots)) {
          if (keep.has(name)) { retained++; continue; }
          const path = join(snapshots, name), stat = lstatSync(path);
          if (!ID.test(name) || !stat.isDirectory() || stat.isSymbolicLink()) { unmanaged++; continue; }
          let metadata;
          try { metadata = JSON.parse(readPrivate(join(path, 'snapshot.json'))); }
          catch { unmanaged++; continue; }
          if (metadata?.schema !== 'stellar-forge.fleet-snapshot.v1' || metadata.snapshotId !== name) {
            unmanaged++; continue;
          }
          rmSync(path, { recursive: true }); removed++;
        }
        return { state: unmanaged ? 'UNMANAGED_ENTRIES' : 'CURRENT', retained, removed, unmanaged };
      },
      close,
    };
  } catch (e) { await close(); throw e; }
}
