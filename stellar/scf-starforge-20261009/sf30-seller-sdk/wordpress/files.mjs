// MIT. WordPress records use the existing private-file and flock primitives.
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, readdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, acquireWorkspace, readPrivate, readJson, atomicJson, hashPrivate, syncDirectory } from '../postgres/publisher/files.mjs';
import { fail, jsonBytes, sha256 } from './config.mjs';
export { privateDirectory, acquireWorkspace, readPrivate, readJson, atomicJson, hashPrivate, syncDirectory };
export async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function immutableJson(path, value, maximum = 100663296) {
  const bytes = jsonBytes(value);
  if (bytes.length > maximum) fail('WORDPRESS_RECORD_BYTES', 'The retained record exceeds its byte ceiling.', 413);
  await privateDirectory(dirname(path), true);
  if (await exists(path)) {
    if (!(await readPrivate(path, maximum)).equals(bytes)) fail('WORDPRESS_RETAINED_RECORD_CHANGED', 'The original saved record has different bytes.', 409);
    return { bytes: bytes.length, sha256: sha256(bytes) };
  }
  // The workspace lease and one writer per capture own this final record name.
  // The existing atomic writer keeps incomplete writes outside the final name.
  await atomicJson(dirname(path), path.slice(dirname(path).length + 1), value);
  return { bytes: bytes.length, sha256: sha256(bytes) };
}
export async function immutableBytes(path, bytes) {
  await privateDirectory(dirname(path), true);
  if (await exists(path)) {
    const actual = await hashPrivate(path, bytes.length);
    if (actual.bytes !== bytes.length || actual.hash !== sha256(bytes))
      fail('WORDPRESS_RETAINED_BYTES_CHANGED', 'The original saved file has different bytes.', 409);
    return { path, bytes: actual.bytes, sha256: actual.hash };
  }
  const temporary = join(dirname(path), '.pending-' + randomUUID()), handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  finally { await handle.close(); }
  await rename(temporary, path); await syncDirectory(dirname(path));
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}
export async function copied(source, destination, expected) {
  const actual = await hashPrivate(source, expected?.bytes ?? 536870912);
  if (expected && (actual.bytes !== expected.bytes || actual.hash !== expected.sha256))
    fail('WORDPRESS_SOURCE_CHANGED', 'The selected source file differs from its retained identity.', 409);
  if (await exists(destination)) {
    const previous = await hashPrivate(destination, actual.bytes);
    if (previous.bytes !== actual.bytes || previous.hash !== actual.hash)
      fail('WORDPRESS_COPY_CHANGED', 'The existing destination differs from the selected source.', 409);
    return { bytes: actual.bytes, sha256: actual.hash };
  }
  await privateDirectory(dirname(destination), true);
  const temporary = join(dirname(destination), '.pending-' + randomUUID());
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output;
  try {
    output = await open(temporary, 'wx', 0o600);
    const before = await input.stat();
    if (!before.isFile() || before.nlink !== 1 || before.mode & 0o077) fail('WORDPRESS_PRIVATE_SOURCE', 'Use the retained private source file.');
    for await (const chunk of input.createReadStream({ autoClose: false })) await output.writeFile(chunk);
    await output.sync();
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  finally { await input.close(); await output?.close(); }
  const copied = await hashPrivate(temporary, actual.bytes);
  if (copied.hash !== actual.hash || copied.bytes !== actual.bytes) fail('WORDPRESS_COPY_CHANGED', 'The selected source changed while it was copied.', 409);
  await rename(temporary, destination); await syncDirectory(dirname(destination));
  return { bytes: actual.bytes, sha256: actual.hash };
}
export async function inventory(directory, prefix = '') {
  const files = [];
  for (const item of (await readdir(join(directory, prefix), { withFileTypes: true })).sort((a,b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))) {
    if (item.name.startsWith('.pending-') || item.name === 'publisher.lock') continue;
    const name = prefix ? prefix + '/' + item.name : item.name;
    if (item.isSymbolicLink()) fail('WORDPRESS_SOURCE_LINK', 'Source packages contain retained regular files.', 409);
    if (item.isDirectory()) files.push(...await inventory(directory, name));
    else if (item.isFile()) {
      const actual = await hashPrivate(join(directory, name), 536870912);
      files.push({ path: name, bytes: actual.bytes, sha256: actual.hash });
    } else fail('WORDPRESS_SOURCE_KIND', 'Source packages contain retained regular files.', 409);
  }
  return files;
}
