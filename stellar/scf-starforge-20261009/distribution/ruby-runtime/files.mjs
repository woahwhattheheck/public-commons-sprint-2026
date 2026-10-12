// MIT. Private source, archive and immutable receiving files for managed Ruby.
import { constants } from 'node:fs';
import { open, lstat, realpath, readdir, mkdir, unlink, link, chmod } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export { absolute, canonical, digest, json, need, plain, now, saveJSON,
  operationId, operationLease, operationRunning, privateDirectory, regular, processIdentity } from '../runtime-workspace/storage.mjs';
import { absolute, digest, json, need, plain, privateDirectory, regular } from '../runtime-workspace/storage.mjs';

export async function readJSON(path, optional = false) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(path, 64 * 1024 * 1024))); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
export const SCHEMA = 'stellar-forge.ruby-runtime.v1';
export const MAX_FILES = 100000;
export const MAX_BYTES = 4 * 1024 * 1024 * 1024;
export const hashObject = value => digest(JSON.stringify(sort(value)));
export function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  return plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
}
export function id(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) && !['.','..'].includes(value),
    'RUBY_ID_INVALID', 'Use an ID of 1–80 letters, digits, dots, underscores or hyphens.');
  return value;
}
export function sha(value) {
  need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'RUBY_SHA256_INVALID');
  return value;
}
export function label(value) {
  need(typeof value === 'string' && value.trim() && value.length <= 160 && !value.includes('\0'),
    'RUBY_TITLE_INVALID');
  return value;
}
export function member(value) {
  need(typeof value === 'string' && value && value.length <= 4096 && !value.includes('\0') &&
    !value.includes('\\') && !isAbsolute(value) && value.split('/').every(p => p && p !== '.' && p !== '..'),
    'RUBY_MEMBER_INVALID');
  return value;
}
export async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function directory(path, create = false) {
  absolute(path);
  if (create) {
    const parent = dirname(path);
    need(await realpath(parent) === parent, 'RUBY_REAL_PARENT_REQUIRED');
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const selected = await privateDirectory(path);
  if (create) await syncParent(path);
  return selected;
}
export async function treeDirectories(root, path) {
  const inside = relative(root, path);
  need(inside === '' || !isAbsolute(inside) && inside !== '..' && !inside.startsWith('../'),
    'RUBY_OUTPUT_OUTSIDE');
  let at = root;
  await directory(at);
  for (const part of inside.split('/').filter(Boolean)) {
    at = join(at, part); await directory(at, true);
  }
  return at;
}
export async function once(path, bytes) {
  bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (await exists(path)) {
    const original = await regular(path, Math.max(bytes.length, 1));
    need(original.equals(bytes), 'RUBY_RETAINED_FILE_CHANGED', 'The original retained file differs: ' + path, 409);
    return;
  }
  const temporary = path + '.pending-' + randomUUID();
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  try {
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      need((await regular(path, Math.max(bytes.length, 1))).equals(bytes), 'RUBY_RETAINED_FILE_CHANGED', undefined, 409);
    }
  } finally { await unlink(temporary); }
  await syncParent(path);
}
export async function syncParent(path) {
  const parent = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
  try { await parent.sync(); } finally { await parent.close(); }
}
function same(first, last) {
  return first.dev === last.dev && first.ino === last.ino && first.size === last.size &&
    first.mtimeNs === last.mtimeNs && first.ctimeNs === last.ctimeNs;
}
export async function fingerprint(path, { maximum = MAX_BYTES, privateOnly = false } = {}) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const first = await file.stat({ bigint: true });
    need(first.isFile() && first.size >= 0 && first.size <= BigInt(maximum), 'RUBY_FILE_INVALID');
    if (privateOnly) need((first.mode & 0o077n) === 0n &&
      (process.getuid === undefined || first.uid === BigInt(process.getuid())), 'RUBY_PRIVATE_FILE_REQUIRED');
    const h = createHash('sha256'); let count = 0;
    for await (const bytes of file.createReadStream({ start: 0, autoClose: false })) { count += bytes.length; h.update(bytes); }
    need(BigInt(count) === first.size && same(first, await file.stat({ bigint: true })), 'RUBY_FILE_CHANGED', undefined, 409);
    return { bytes: count, sha256: h.digest('hex') };
  } finally { await file.close(); }
}
export async function copyFile(source, destination, expected = null) {
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  const temporary = destination + '.pending-' + randomUUID();
  let output;
  try {
    const before = await input.stat({ bigint: true });
    need(before.isFile() && before.size <= BigInt(MAX_BYTES), 'RUBY_FILE_INVALID');
    output = await open(temporary, 'wx', 0o600);
    const h = createHash('sha256'); let count = 0;
    for await (const bytes of input.createReadStream({ start: 0, autoClose: false })) {
      h.update(bytes); count += bytes.length;
      need(count <= MAX_BYTES, 'RUBY_FILE_TOO_LARGE');
      let at = 0;
      while (at < bytes.length) { const n = await output.write(bytes, at, bytes.length - at); need(n.bytesWritten > 0, 'RUBY_WRITE_FAILED'); at += n.bytesWritten; }
    }
    const descriptor = { bytes: count, sha256: h.digest('hex') };
    need(BigInt(count) === before.size && same(before, await input.stat({ bigint: true })), 'RUBY_FILE_CHANGED', undefined, 409);
    if (expected) need((expected.bytes === undefined || expected.bytes === count) && expected.sha256 === descriptor.sha256, 'RUBY_FILE_CHANGED', undefined, 409);
    await output.sync(); await output.close(); output = null;
    try { await link(temporary, destination); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const old = await fingerprint(destination, { privateOnly: true });
      need(old.bytes === count && old.sha256 === descriptor.sha256, 'RUBY_RETAINED_FILE_CHANGED', undefined, 409);
    }
    await chmod(destination, expected?.executable ? 0o700 : 0o600);
    await syncParent(destination);
    return descriptor;
  } finally {
    if (output) await output.close();
    await input.close();
    try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
/** Inventory before copying; a second inventory closes additions/removals during the snapshot. */
export async function inventory(root, { exclude = [], privateOnly = false } = {}) {
  absolute(root);
  const info = await lstat(root);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(root) === root, 'RUBY_SOURCE_DIRECTORY_INVALID');
  const out = []; let total = 0;
  const ignored = name => exclude.some(prefix => name === prefix || name.startsWith(prefix + '/'));
  async function visit(path, prefix) {
    const names = await readdir(path); names.sort();
    for (const name of names) {
      const key = prefix ? prefix + '/' + name : name;
      if (ignored(key)) continue;
      member(key);
      const full = join(root, key), stat = await lstat(full);
      need(!stat.isSymbolicLink(), 'RUBY_SOURCE_LINK', 'Retain real source files inside the selected project: ' + key);
      if (privateOnly) need(!(stat.mode & 0o077) && (process.getuid === undefined || stat.uid === process.getuid()), 'RUBY_PRIVATE_FILE_REQUIRED');
      if (stat.isDirectory()) await visit(full, key);
      else {
        need(stat.isFile() && out.length < MAX_FILES, 'RUBY_SOURCE_FILE_INVALID');
        const descriptor = await fingerprint(full, { privateOnly });
        total += descriptor.bytes; need(total <= MAX_BYTES, 'RUBY_SOURCE_TOO_LARGE');
        out.push({ name: key, ...descriptor, executable: Boolean(stat.mode & 0o111) });
      }
    }
  }
  await visit(root, '');
  return out;
}
export async function copyTree(source, destination, { files = null, exclude = [], privateOnly = false } = {}) {
  const selected = files ?? await inventory(source, { exclude, privateOnly });
  await directory(destination, true);
  for (const entry of selected) {
    const name = member(entry.name), target = join(destination, name);
    await treeDirectories(destination, dirname(target));
    for (const pending of await readdir(dirname(target))) {
      if (pending.startsWith(name.split('/').at(-1) + '.pending-') && /\.pending-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(pending)) {
        const file = join(dirname(target), pending), stat = await lstat(file);
        need(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077), 'RUBY_PENDING_FILE_INVALID');
        await unlink(file);
      }
    }
    await copyFile(join(source, name), target, entry);
  }
  const after = await inventory(source, { exclude, privateOnly });
  need(hashObject(after) === hashObject(selected), 'RUBY_SOURCE_CHANGED', undefined, 409);
  const copied = await inventory(destination, { privateOnly: true });
  need(hashObject(copied) === hashObject(selected), 'RUBY_COPY_CHANGED', undefined, 409);
  return copied;
}
/** The HTTP receiver gets an independent unlinked snapshot, never a mutable producer descriptor. */
export async function openSnapshot(path, expected, root) {
  const source = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const temporary = join(root, '.download-' + randomUUID());
  let file;
  try {
    const before = await source.stat({ bigint: true });
    need(before.isFile() && before.size === BigInt(expected.bytes), 'RUBY_FILE_CHANGED', undefined, 409);
    file = await open(temporary, 'wx+', 0o600); await unlink(temporary);
    const h = createHash('sha256'); let count = 0;
    for await (const bytes of source.createReadStream({ start: 0, autoClose: false })) {
      h.update(bytes); count += bytes.length;
      let offset = 0;
      while (offset < bytes.length) { const n = await file.write(bytes, offset, bytes.length - offset); need(n.bytesWritten > 0, 'RUBY_WRITE_FAILED'); offset += n.bytesWritten; }
    }
    need(count === expected.bytes && h.digest('hex') === expected.sha256 && same(before, await source.stat({ bigint: true })),
      'RUBY_FILE_CHANGED', undefined, 409);
    await file.sync(); return file;
  } catch (error) { if (file) await file.close(); throw error; }
  finally { await source.close(); }
}
