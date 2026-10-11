// MIT. Private operator files; kernel-owned workspace lock, no background daemon.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';

export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const digest = value => createHash('sha256').update(value).digest('hex');
export const identity = value => digest(JSON.stringify(canonical(value)));
export const fault = (code, message = code, status = 400) => Object.assign(new Error(message), { code, status });
export const stamp = () => new Date().toISOString();
export function absolute(value, label = 'directory') {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value === '/' || value.includes('\0'))
    throw fault('ABSOLUTE_PATH_REQUIRED', 'Choose a normalized absolute ' + label + '.');
  return value;
}
export async function privateDirectory(path, create = false) {
  absolute(path);
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || await realpath(path) !== path)
    throw fault('PRIVATE_DIRECTORY_REQUIRED', 'The operator directory must be private (mode 0700) and have no symlink components.');
}
export async function readPrivate(path, maximum = 262144) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || stat.size > maximum)
      throw fault('PRIVATE_FILE_REQUIRED', 'Use a private regular file within its size limit.');
    const buffer = Buffer.alloc(Math.min(maximum + 1, stat.size + 1));
    let size = 0;
    while (size < buffer.length) {
      const part = await handle.read(buffer, size, buffer.length - size, null);
      if (!part.bytesRead) break; size += part.bytesRead;
    }
    if (size > maximum || size !== stat.size) throw fault('SOURCE_CHANGED_DURING_READ');
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs)
      throw fault('SOURCE_CHANGED_DURING_READ');
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}
export async function readJson(path, maximum) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readPrivate(path, maximum))); }
  catch (issue) { if (issue.code) throw issue; throw fault('PRIVATE_JSON_INVALID'); }
}
export async function hashPrivate(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || stat.size > maximum)
      throw fault('PRIVATE_FILE_REQUIRED');
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length; if (size > maximum) throw fault('PRIVATE_FILE_TOO_LARGE'); hash.update(chunk);
    }
    const after = await handle.stat();
    if (size !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs)
      throw fault('SOURCE_CHANGED_DURING_READ');
    return { hash: hash.digest('hex'), bytes: size };
  } finally { await handle.close(); }
}
export async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function createFile(path, content) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
}
export async function atomicJson(directory, name, value) {
  const temporary = join(directory, '.pending-' + randomUUID());
  await createFile(temporary, bytes(value)); await rename(temporary, join(directory, name));
  await syncDirectory(directory);
}
export async function acquireWorkspace(directory) {
  if (process.platform !== 'linux') throw fault('LINUX_FLOCK_REQUIRED', 'This local workspace uses Linux util-linux flock.');
  const handle = await open(join(directory, 'publisher.lock'), constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077) throw fault('PRIVATE_LOCK_REQUIRED');
    // Same inherited-open-description pattern as original SF98 delivery-lock.mjs:
    // the parent handle keeps the kernel lock after the short flock process exits.
    await new Promise((done, reject) => {
      const child = spawn('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', '3'],
        { stdio: ['ignore', 'ignore', 'ignore', handle.fd], shell: false });
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('error', () => { clearTimeout(timer); reject(fault('FLOCK_UNAVAILABLE')); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? done() :
        reject(fault(code === 75 ? 'PUBLISHER_ALREADY_OPEN' : 'FLOCK_FAILED', 'Open the existing workspace or stop its process first.', 409)); });
    });
    return () => handle.close();
  } catch (issue) { await handle.close(); throw issue; }
}
