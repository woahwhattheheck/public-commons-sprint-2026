// SPDX-License-Identifier: MIT
// OS-owned single-writer lifetime for a private local directory.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { InputError } from './config.mjs';

function requireLock(condition, code) {
  if (!condition) throw new InputError(code);
}
function privateOwned(info, directory) {
  return (directory ? info.isDirectory() : info.isFile()) &&
    !info.isSymbolicLink() &&
    (process.platform === 'win32' || (info.mode & 0o077) === 0 &&
      typeof process.getuid === 'function' && info.uid === process.getuid());
}
async function sameLockFile(handle, path, code) {
  const [opened, named] = await Promise.all([handle.stat(), lstat(path)]);
  requireLock(privateOwned(opened, false) && privateOwned(named, false) &&
    opened.nlink === 1 && named.nlink === 1 &&
    opened.dev === named.dev && opened.ino === named.ino, code);
}

/**
 * Return an idempotent asynchronous release function. Linux keeps the same
 * private inode in place and holds flock through the parent's open descriptor.
 * Windows and other Unix platforms keep the original named-pipe/socket scheme.
 */
export async function lockPrivateDirectory({
  directory, filename, namespace, busyCode, unavailableCode,
}) {
  requireLock(typeof unavailableCode === 'string' && /^[A-Z0-9_]+$/.test(unavailableCode) &&
    typeof busyCode === 'string' && /^[A-Z0-9_]+$/.test(busyCode),
  'PRIVATE_DIRECTORY_LOCK_OPTIONS_INVALID');
  requireLock(typeof directory === 'string' && isAbsolute(directory) &&
    resolve(directory) === directory && !directory.includes('\0') &&
    typeof filename === 'string' && /^[.a-zA-Z0-9_-]{1,120}\.lock$/.test(filename) &&
    typeof namespace === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(namespace),
  unavailableCode);
  let root;
  try {
    root = await lstat(directory);
    requireLock(privateOwned(root, true) && await realpath(directory) === directory, unavailableCode);
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError(unavailableCode);
  }

  if (process.platform === 'linux') {
    const path = join(directory, filename);
    let handle;
    try {
      handle = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
      await sameLockFile(handle, path, unavailableCode);
      // flock(2) follows the open file description shared by inherited fd 3 and
      // this parent handle. The short child exits while the parent retains it.
      const result = spawnSync('flock', [
        '--exclusive', '--nonblock', '--conflict-exit-code', '73', '3',
      ], { stdio: ['ignore', 'ignore', 'pipe', handle.fd], timeout: 10000 });
      requireLock(!result.error && result.status === 0,
        !result.error && result.status === 73 ? busyCode : unavailableCode);
      await sameLockFile(handle, path, unavailableCode);
      const currentRoot = await lstat(directory);
      requireLock(currentRoot.dev === root.dev && currentRoot.ino === root.ino &&
        privateOwned(currentRoot, true) && await realpath(directory) === directory, unavailableCode);
      let released;
      return () => released ??= handle.close();
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error instanceof InputError) throw error;
      throw new InputError(unavailableCode);
    }
  }

  const name = namespace + '-' + createHash('sha256').update(directory).digest('hex');
  const address = process.platform === 'win32'
    ? '\\\\.\\pipe\\' + name : join(directory, filename.replace(/\.lock$/, '.sock'));
  const server = createServer(socket => socket.destroy());
  try {
    await new Promise((accept, reject) => {
      const failed = error => {
        server.close(() => {});
        reject(new InputError(error.code === 'EADDRINUSE' ? busyCode : unavailableCode));
      };
      server.once('error', failed);
      server.listen(address, () => { server.off('error', failed); accept(); });
    });
  } catch (error) {
    server.close(() => {});
    if (error instanceof InputError) throw error;
    throw new InputError(unavailableCode);
  }
  server.unref();
  let released;
  return () => released ??= new Promise((accept, reject) =>
    server.close(error => error ? reject(error) : accept()));
}
