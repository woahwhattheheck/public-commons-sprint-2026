// MIT. One Linux delivery writer per original SF98 outbox.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { hostname } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const holders = new WeakMap();
const LOCK_NAME = '.sf98-delivery.lock';
const CONFLICT = 75;

async function privateDirectory(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory) ||
      directory === '/' || resolve(directory) !== directory ||
      await realpath(directory) !== directory) throw new Error('PRIVATE_OUTBOX_PATH_REQUIRED');
  const info = await lstat(directory);
  if (!info.isDirectory() || info.mode & 0o077) throw new Error('PRIVATE_OUTBOX_MODE_REQUIRED_0700');
}

async function lockFile(directory, create) {
  await privateDirectory(directory);
  const handle = await open(join(directory, LOCK_NAME), constants.O_RDWR |
    (create ? constants.O_CREAT : 0) | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077)
      throw new Error('PRIVATE_DELIVERY_LOCK_REQUIRED_0600');
    return { handle, info };
  } catch (error) { await handle.close(); throw error; }
}

async function flock(handle) {
  if (process.platform !== 'linux') throw new Error('SF98_DELIVERY_REQUIRES_LINUX_FLOCK');
  // flock(2) belongs to the open file description. FD 3 is a dup of our still
  // open handle, so the kernel lock survives this short helper's exit and is
  // released by handle.close(), or automatically if this process is killed.
  return new Promise((resolvePromise, reject) => {
    const child = spawn('flock', ['--exclusive', '--nonblock',
      '--conflict-exit-code', String(CONFLICT), '3'], {
      stdio: ['ignore', 'ignore', 'ignore', handle.fd], shell: false,
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('SF98_FLOCK_UNAVAILABLE_INSTALL_UTIL_LINUX'));
    });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(true);
      else if (code === CONFLICT) resolvePromise(false);
      else reject(new Error('SF98_DELIVERY_LOCK_HELPER_FAILED'));
    });
  });
}

export async function acquireDeliveryLease(directory, { purpose = 'drain' } = {}) {
  if (!['worker', 'drain', 'requeue'].includes(purpose)) throw new TypeError('Invalid delivery lease purpose');
  const { handle, info } = await lockFile(directory, true);
  try {
    if (!await flock(handle)) {
      const error = new Error('SF98_DELIVERY_BUSY');
      error.code = 'SF98_DELIVERY_BUSY';
      throw error;
    }
    const owner = Object.freeze({ schema: 'stellar-forge.sf98.delivery-owner.v1',
      id: randomUUID(), pid: process.pid, host: hostname(), purpose,
      acquiredAt: new Date().toISOString() });
    await handle.truncate(0);
    await handle.writeFile(JSON.stringify(owner) + '\n');
    await handle.sync();
    const lease = Object.freeze({ directory, owner,
      async release() {
        const held = holders.get(lease);
        if (!held) return;
        holders.delete(lease);
        await held.handle.close();
      },
    });
    holders.set(lease, { handle, info, directory });
    await assertDeliveryLease(lease, directory);
    return lease;
  } catch (error) { await handle.close(); throw error; }
}

export async function assertDeliveryLease(lease, directory) {
  const held = holders.get(lease);
  if (!held || held.directory !== directory) throw new Error('SF98_ACTIVE_DELIVERY_LEASE_REQUIRED');
  const current = await lstat(join(directory, LOCK_NAME));
  if (!current.isFile() || current.dev !== held.info.dev || current.ino !== held.info.ino || current.nlink !== 1)
    throw new Error('SF98_DELIVERY_LOCK_REPLACED');
}

export async function withDeliveryLease(directory, operation, options) {
  const lease = await acquireDeliveryLease(directory, options);
  try { return await operation(lease); }
  finally { await lease.release(); }
}

export async function inspectDeliveryLease(directory) {
  let file;
  try { file = await lockFile(directory, false); }
  catch (error) {
    if (error.code === 'ENOENT') return { active: false, owner: null };
    throw error;
  }
  try {
    const available = await flock(file.handle);
    let owner = null;
    if ((await file.handle.stat()).size <= 4096) {
      try {
        const raw = JSON.parse(await file.handle.readFile('utf8'));
        if (raw.schema === 'stellar-forge.sf98.delivery-owner.v1') owner = raw;
      } catch { /* owner may be writing metadata; kernel ownership remains authoritative */ }
    }
    return { active: !available, owner };
  } finally { await file.handle.close(); }
}
