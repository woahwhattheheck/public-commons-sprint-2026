// MIT. Linux flock retained by the gateway's own open file description.
import { spawnSync } from 'node:child_process';
import { constants, openSync, fstatSync, lstatSync, closeSync } from 'node:fs';
import { join } from 'node:path';

export async function acquireStateLease(directory) {
  const path = join(directory, 'lease.lock');
  const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  let closed = false;
  const assertHeld = () => {
    if (closed) throw new Error('FLEET_STATE_LEASE_LOST');
    const stat = fstatSync(fd);
    const named = lstatSync(path);
    if (!stat.isFile() || !named.isFile() || named.isSymbolicLink() ||
        (stat.mode & 0o077) || stat.dev !== named.dev || stat.ino !== named.ino)
      throw new Error('FLEET_PRIVATE_LEASE_REQUIRED');
  };
  try {
    assertHeld();
    // fd3 is a duplicate of OUR open file description, not a second open.
    // Successful helper exit leaves its flock held by the retained parent fd.
    // Parent close/crash releases it; no surviving helper or stale-PID recovery.
    const result = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3'],
      { stdio: ['ignore', 'pipe', 'pipe', fd], timeout: 10000 });
    if (result.error) throw Object.assign(new Error(result.error.code === 'ENOENT' ?
      'FLEET_LINUX_FLOCK_REQUIRED' : 'FLEET_STATE_LEASE_FAILED'), { cause: result.error });
    if (result.status !== 0) throw new Error(result.status === 73 ?
      'FLEET_STATE_ALREADY_OWNED' : 'FLEET_STATE_LEASE_FAILED');
    assertHeld();
    return {
      pid: process.pid, assertHeld,
      async close() { if (!closed) { closed = true; closeSync(fd); } },
    };
  } catch (error) { closed = true; closeSync(fd); throw error; }
}
