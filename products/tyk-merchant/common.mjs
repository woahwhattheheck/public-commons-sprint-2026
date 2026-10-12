// MIT. Private installed-product metadata around the original Tyk workspace.
import { constants as C } from 'node:fs';
import { mkdir, lstat, realpath, open, rename, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { operationLease } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import { readSf61HostFile } from '../../stellar-forge/mcp-merchant-operator/sf61-connection.mjs';

export const PRODUCT_SCHEMA = 'stellar-forge.tyk-product.v1';
export const SETUP_SCHEMA = 'stellar-forge.tyk-product-setup.v1';
export const SESSION_SCHEMA = 'stellar-forge.tyk-product-session.v1';
export const LAUNCH_SCHEMA = 'stellar-forge.tyk-product-launch.v1';
export const WORKSPACE_SCHEMA = 'stellar-forge.tyk-workspace.v1';
export const HASH = /^[a-f0-9]{64}$/;
export const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const RECORD = /^[a-f0-9]{24}$/;
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const canonical = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const failure = (code, message, data = {}) => Object.assign(new Error(message), { code: 'TYK_PRODUCT_' + code, ...data });
export function need(value, message, code = 'INPUT') { if (!value) throw failure(code, message); }
export const decode = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
export function absolute(value) {
  need(typeof value === 'string' && value.length && !value.includes('\0'), 'Select an original private path.');
  return resolve(value);
}
export async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function privateDirectory(path, create = false) {
  path = absolute(path);
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    (process.getuid === undefined || info.uid === process.getuid()) && await realpath(path) === path,
  'Use an original canonical private directory with mode 0700: ' + path, 'PRIVATE_DIRECTORY');
  return path;
}
export async function privateBytes(path, optional = false, maximum = 1024 * 1024) {
  try { return await readSf61HostFile(path, maximum, { privateFile: true }); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
export async function syncDirectory(path) {
  const handle = await open(path, C.O_RDONLY | C.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
/** Product files are serialized by the original kernel lease; publish only complete fsynced bytes. */
export async function publish(path, value, { replace = false, lease } = {}) {
  need(lease && typeof lease.assertHeld === 'function', 'Retain the original product writer.', 'OWNER_REQUIRED');
  await lease.assertHeld();
  const bytes = Buffer.isBuffer(value) ? value : typeof value === 'string'
    ? Buffer.from(value) : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const current = await privateBytes(path, true, Math.max(bytes.length, 2 * 1024 * 1024));
  if (current?.equals(bytes)) { await syncDirectory(dirname(path)); return; }
  need(!current || replace, 'The retained product file has different original bytes: ' + path, 'CONFLICT');
  const temporary = path + '.pending-' + randomUUID();
  const handle = await open(temporary, C.O_CREAT | C.O_EXCL | C.O_WRONLY | C.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(bytes); await handle.sync(); await handle.close();
    await lease.assertHeld();
    const again = await privateBytes(path, true, Math.max(bytes.length, 2 * 1024 * 1024));
    need(current === null ? again === null : again?.equals(current), 'The retained product file changed during publication.', 'CONFLICT');
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export async function leaseProduct(directory) {
  const path = join(directory, 'product.owner.lock');
  let handle;
  try { handle = await operationLease(path); }
  catch (error) {
    if (error.code === 'RUNTIME_WORKSPACE_OPERATION_RUNNING')
      throw failure('ALREADY_OPEN', 'Open this product’s existing browser; its original owner is still running.');
    throw error;
  }
  const first = await handle.stat({ bigint: true }); let closed = false;
  return {
    async assertHeld() {
      need(!closed, 'The original product owner is closed.', 'OWNER_LOST');
      const current = await lstat(path, { bigint: true });
      need(current.isFile() && current.dev === first.dev && current.ino === first.ino && current.nlink === 1n,
        'The original product owner file changed.', 'OWNER_LOST');
    },
    async close() { if (!closed) { await handle.close(); closed = true; } },
  };
}
export function originalPaths(directory) {
  return { directory, seedsFile: join(directory, 'connections.json'),
    connectionFile: join(directory, 'connection.json'), browserUrlFile: join(directory, 'browser-url.txt'),
    receivingDirectory: join(directory, 'receiving') };
}
export function launchOptions(input = {}) {
  const options = { directory: absolute(input.directory), port: input.port ?? 0 };
  need(Number.isInteger(options.port) && options.port >= 0 && options.port <= 65535,
    'Use a local port from 0 through 65535.');
  if (input.expectedBindingSha256 !== undefined)
    need(HASH.test(input.expectedBindingSha256), 'Supply the complete reviewed launch SHA-256.');
  return options;
}
export function privateUrl(value) {
  let url; try { url = new URL(value); } catch {}
  need(typeof value === 'string' && url && url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && url.pathname === '/' && !url.search && HASH.test(url.hash.slice(1)) &&
    Number(url.port || 80) > 0 && Number(url.port || 80) <= 65535,
  'Use the complete private URL printed by the original Tyk workspace.', 'CONNECTION_INVALID');
  return url;
}
