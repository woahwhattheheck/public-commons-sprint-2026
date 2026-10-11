// MIT. Original SF30 process birth identity and SF98 open-description lock pattern.
// The permanent lock inode is shared by manager and worker. Never unlink it.
import { spawn } from 'node:child_process';
import { constants, fstatSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { linuxProcessIdentity, liveOwner } from '../sf30-seller-sdk/operations/history.mjs';

const LEASE = 'stellar-forge.seller-release-lease.v1';
const CONFLICT = 75;
const NAMES = new Set(['run.lock', 'state.lock']);
const decimal = value => typeof value === 'string' && /^\d{1,20}$/.test(value);
const failure = (code, message) => Object.assign(new Error(message), { code });

export function validProcessIdentity(value) {
  return value == null || value.schema === 'linux-proc.v1' &&
    Number.isSafeInteger(value.procPid) && value.procPid > 0 && decimal(value.startTicks) &&
    typeof value.bootId === 'string' && /^[a-f0-9-]{36}$/.test(value.bootId) && decimal(value.procDevice);
}

export function validReleaseLease(value) {
  return value == null || value.schema === LEASE && NAMES.has(value.name) &&
    decimal(value.device) && decimal(value.inode);
}

export async function releaseProcessOwner() {
  return { pid: process.pid, host: hostname(), processIdentity: await linuxProcessIdentity() };
}

export async function releaseProcessAlive(owner, current) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1) return false;
  if (!validProcessIdentity(owner.processIdentity)) return true;
  return liveOwner({ ...owner, host: owner.host ?? current.host }, current);
}

function fileIdentity(info, name) {
  if (!info.isFile() || info.nlink !== 1n || (info.mode & 0o077n) !== 0n)
    throw failure('RELEASE_LOCK_FILE_INVALID', 'The release lifetime lock must be a private regular file with one link.');
  return { schema: LEASE, name, device: String(info.dev), inode: String(info.ino) };
}

function sameFile(a, b) {
  return a?.schema === LEASE && b?.schema === LEASE && a.name === b.name &&
    a.device === b.device && a.inode === b.inode;
}

async function lockFile(root, name, create) {
  if (!NAMES.has(name)) throw new TypeError('Unknown original release lock.');
  const path = join(root, '.sf82-' + name + '.lifetime');
  const handle = await open(path, constants.O_RDWR | (create ? constants.O_CREAT : 0) |
    (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const identity = fileIdentity(await handle.stat({ bigint: true }), name);
    return { handle, identity, async assert() {
      const current = fileIdentity(await lstat(path, { bigint: true }), name);
      if (!sameFile(current, identity)) throw failure('RELEASE_LOCK_REPLACED', 'The original release lifetime lock changed.');
    } };
  } catch (error) { await handle.close(); throw error; }
}

async function tryFlock(handle) {
  // Same flock(2) open-file-description ownership used by original SF98 delivery.
  // This helper exits; our still-open descriptor keeps the kernel lock alive.
  return new Promise((resolve, reject) => {
    const child = spawn('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', String(CONFLICT), '3'],
      { stdio: ['ignore', 'ignore', 'ignore', handle.fd], shell: false });
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(failure('RELEASE_FLOCK_UNAVAILABLE', 'Install util-linux (flock) for Linux release ownership.'));
    });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve(true);
      else if (code === CONFLICT) resolve(false);
      else reject(failure('RELEASE_FLOCK_FAILED', 'The release lifetime lock helper failed.'));
    });
  });
}

export async function acquireReleaseLease(root, name) {
  if (process.platform !== 'linux') return null;
  const file = await lockFile(root, name, true);
  try {
    if (!await tryFlock(file.handle))
      throw failure('RELEASE_BUSY', name === 'run.lock' ?
        'The original release manager or seller still owns this store.' : 'Another release change is being saved.');
    await file.assert();
    let closed = false;
    return { fd: file.handle.fd, identity: file.identity,
      provesEnded(record) { return !closed && sameFile(record, file.identity); },
      assert: file.assert,
      async close() { if (!closed) { closed = true; await file.handle.close(); } },
    };
  } catch (error) { await file.handle.close(); throw error; }
}

export async function inspectReleaseLease(root, record) {
  if (!record || !validReleaseLease(record) || process.platform !== 'linux') return null;
  let file;
  try { file = await lockFile(root, record.name, false); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    if (!sameFile(record, file.identity)) return null;
    const active = !await tryFlock(file.handle);
    await file.assert();
    return { active, identity: file.identity };
  } finally { await file.handle.close(); }
}

export function inheritedReleaseLease(descriptor, name = 'run.lock') {
  if (descriptor === '-') return null;
  if (descriptor !== '4') throw new Error('Invalid original release lifetime descriptor.');
  return fileIdentity(fstatSync(4, { bigint: true }), name);
}

export function sameReleaseLease(a, b) {
  return a == null && b == null || sameFile(a, b);
}

export async function releaseOwnerLiveness(root, owner, current, heldLease) {
  const lease = heldLease?.provesEnded(owner.kernelLease) ? { active: false } :
    await inspectReleaseLease(root, owner.kernelLease);
  if (lease?.active === false) return { managerAlive: false, childAlive: false };
  const [managerAlive, childAlive] = await Promise.all([
    releaseProcessAlive(owner, current),
    releaseProcessAlive({ host: owner.host, pid: owner.childPid, processIdentity: owner.childProcessIdentity }, current),
  ]);
  return { managerAlive, childAlive };
}

export async function recordedSellerAlive(root, observed, current, heldLease) {
  if (heldLease?.provesEnded(observed.kernelLease)) return false;
  const lease = await inspectReleaseLease(root, observed.kernelLease);
  if (lease?.active === false) return false;
  return releaseProcessAlive(observed, current);
}
