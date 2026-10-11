// MIT. Portable source releases and local installation primitives.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, lstat, realpath, readdir, mkdir, rename, unlink } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';

export const RELEASE_SCHEMA = 'stellar-forge.product-release.v1';
export const HOME_SCHEMA = 'stellar-forge.product-home.v1';
export const MANIFEST = 'release.json';
export const MAX_BYTES = 64 * 1024 * 1024;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function relativePath(path) {
  if (typeof path !== 'string' || !path || path.length > 1024 || path.includes('\\') ||
      path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..') ||
      /[\x00-\x1f\x7f:]/.test(path)) throw new Error('Invalid release path');
  return path;
}
export function releaseId(manifest) {
  return manifest.version + '-' + manifest.source.commit.slice(0, 12) + '-' + manifest.digest.slice(0, 12);
}
export function validateId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(id))
    throw new Error('Invalid release ID');
  return id;
}
export async function plainDirectory(path) {
  const full = resolve(path), stat = await lstat(full);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Expected a regular directory: ' + full);
  return realpath(full);
}
export async function boundedFile(root, relative, max = MAX_BYTES) {
  relativePath(relative);
  const path = join(root, relative), actual = await realpath(path);
  if (!actual.startsWith(root + sep)) throw new Error('Release file leaves its directory: ' + relative);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > max) throw new Error('Invalid or oversized file: ' + relative);
    const bytes = await handle.readFile();
    if (bytes.length !== stat.size || bytes.length > max) throw new Error('File changed while reading: ' + relative);
    return bytes;
  } finally { await handle.close(); }
}
export async function putFile(path, bytes, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  const handle = await open(path, 'wx', mode);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
export async function atomicJson(path, value) {
  const temp = path + '.new-' + randomUUID();
  await putFile(temp, JSON.stringify(value, null, 2) + '\n', 0o600);
  try { await rename(temp, path); } catch (error) { await unlink(temp).catch(() => {}); throw error; }
  // Directory fsync is available on Linux; Windows does not provide it.
  if (process.platform !== 'win32') {
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
export async function jsonFile(path) { return JSON.parse(await readFile(path, 'utf8')); }

export async function verifyRelease(input, expected) {
  const root = await plainDirectory(input);
  const manifestBytes = await boundedFile(root, MANIFEST, 4 * 1024 * 1024);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schema !== RELEASE_SCHEMA || manifest.product !== 'Stellar Forge' ||
      !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? '') ||
      !/^[0-9a-f]{40}$/.test(manifest.source?.commit ?? '') ||
      !/^[0-9a-f]{64}$/.test(manifest.digest ?? '') || !Array.isArray(manifest.files) ||
      !manifest.files.length || manifest.files.length > 10000) throw new Error('Invalid release manifest');
  const { digest, ...body } = manifest;
  if (sha256(canonical(body)) !== digest || (expected && expected !== digest))
    throw new Error('Release digest mismatch');
  const paths = new Set(), files = [];
  let total = 0;
  for (const file of manifest.files) {
    relativePath(file.path);
    if (file.path === MANIFEST || paths.has(file.path) || !Number.isSafeInteger(file.bytes) ||
        file.bytes < 0 || (total += file.bytes) > MAX_BYTES || ![0o644, 0o755].includes(file.mode) ||
        !/^[0-9a-f]{64}$/.test(file.sha256 ?? '')) throw new Error('Invalid manifest file entry');
    paths.add(file.path);
    const bytes = await boundedFile(root, file.path, file.bytes);
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
      throw new Error('Release content differs: ' + file.path);
    files.push(file);
  }
  if (!paths.has('forge.mjs') || !paths.has('release-core.mjs') || !paths.has('package.json') ||
      !manifest.commands || typeof manifest.commands !== 'object' || Array.isArray(manifest.commands))
    throw new Error('Release has no native launcher');
  for (const [name, command] of Object.entries(manifest.commands)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || typeof command?.summary !== 'string' ||
        !paths.has(command.path) || !command.path.endsWith('.mjs')) throw new Error('Invalid native command');
  }
  // Dependencies are the only mutable installation content. They are separately
  // reported by doctor; they are not covered by the source release digest.
  async function inspect(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (!prefix && (entry.name === 'node_modules' || entry.name === 'package-lock.json')) continue;
      if (entry.isSymbolicLink()) throw new Error('Symlink in release: ' + name);
      if (entry.isDirectory()) await inspect(join(dir, entry.name), name + '/');
      else if (!entry.isFile() || (name !== MANIFEST && !paths.has(name)))
        throw new Error('Unlisted release content: ' + name);
    }
  }
  await inspect(root);
  return { root, manifest, manifestBytes, files, totalBytes: total, id: releaseId(manifest) };
}

export async function withHomeLock(input, operation) {
  const home = await plainDirectory(input), lock = join(home, '.release-update.lock');
  let handle;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { handle = await open(lock, 'wx', 0o600); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = await readFile(lock, 'utf8');
      let owner; try { owner = JSON.parse(previous); } catch { throw new Error('Unreadable installation lock: ' + lock); }
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('Invalid installation lock');
      let active = true;
      try { process.kill(owner.pid, 0); } catch (probe) { if (probe.code === 'ESRCH') active = false; }
      if (active || attempt) throw new Error('Another release update is in progress (PID ' + owner.pid + ')');
      if (await readFile(lock, 'utf8') === previous) await unlink(lock);
    }
  }
  if (!handle) throw new Error('Could not acquire release update lock');
  const nonce = randomUUID();
  await handle.writeFile(JSON.stringify({ pid: process.pid, nonce })); await handle.sync();
  try { return await operation(home); }
  finally { await handle.close(); await unlink(lock).catch(() => {}); }
}
