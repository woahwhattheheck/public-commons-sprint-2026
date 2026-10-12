// MIT. Dataset writer ownership retained by the process's open file description.
import { spawnSync } from 'node:child_process';
import { constants, openSync, fstatSync, lstatSync, closeSync } from 'node:fs';
import { join } from 'node:path';

const fault = (code, message) => Object.assign(new Error(message), { code, status: 409 });

export function acquireDatasetLease(directory) {
  if (process.platform !== 'linux')
    throw fault('DATASET_LINUX_FLOCK_REQUIRED', 'This dataset store uses Linux util-linux flock.');
  const path = join(directory, 'writer.lease');
  const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  let closed = false;
  const assertHeld = () => {
    if (closed) throw fault('DATASET_STORE_CLOSED', 'The dataset writer is closed.');
    const stat = fstatSync(fd), named = lstatSync(path);
    if (!stat.isFile() || !named.isFile() || named.isSymbolicLink() ||
        stat.nlink !== 1 || (stat.mode & 0o077) || stat.dev !== named.dev || stat.ino !== named.ino)
      throw fault('DATASET_LEASE_CHANGED', 'The private dataset writer lease changed while open.');
  };
  try {
    assertHeld();
    // fd3 inherits OUR open file description. The short helper exits while this
    // process retains its kernel lock; closing/crashing releases ownership.
    const result = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3'],
      { stdio: ['ignore', 'ignore', 'ignore', fd], timeout: 10000, shell: false });
    if (result.error) throw fault(result.error.code === 'ENOENT'
      ? 'DATASET_LINUX_FLOCK_REQUIRED' : 'DATASET_LEASE_FAILED',
      result.error.code === 'ENOENT' ? 'Install Linux util-linux flock to open this dataset store.'
        : 'The dataset writer lease could not be acquired.');
    if (result.status !== 0) throw fault(result.status === 73
      ? 'DATASET_WRITER_RUNNING' : 'DATASET_LEASE_FAILED',
      result.status === 73 ? 'The dataset version store already has a live writer.'
        : 'The dataset writer lease could not be acquired.');
    assertHeld();
    return Object.freeze({ assertHeld, identity() {
      assertHeld();
      const held = fstatSync(fd, { bigint: true });
      return Object.freeze({ device: held.dev.toString(), inode: held.ino.toString() });
    }, async close() {
      if (!closed) { closed = true; closeSync(fd); }
    } });
  } catch (error) { closed = true; closeSync(fd); throw error; }
}
