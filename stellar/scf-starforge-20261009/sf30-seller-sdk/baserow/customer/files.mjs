// MIT. Complete private customer files, published only after their exact bytes.
import { constants } from 'node:fs';
import { open, lstat, mkdir, link, unlink, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { object, bytes, digest, identity, privateDirectory, readPrivate, readJson,
  hashPrivate, syncDirectory, acquireWorkspace, fault } from '../../postgres/publisher/files.mjs';
export { object, bytes, digest, identity, privateDirectory, readPrivate, readJson,
  hashPrivate, syncDirectory, acquireWorkspace, fault };
export const HASH = /^[a-f0-9]{64}$/;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const MAX_CUSTOMER_BYTES = 872415232;
export const MAX_CUSTOMER_FILES = 14104;
export const MAX_METADATA_BYTES = 33554432;
export const check = (value, code, message = code) => { if (!value) throw fault(code, message); };
export async function exists(path) {
  try { await lstat(path); return true; } catch (issue) { if (issue.code === 'ENOENT') return false; throw issue; }
}
export function fileLimit(name) {
  if (name === 'source.json' || name === 'attachments.json' || name === 'customer-manifest.json') return MAX_METADATA_BYTES;
  if (name === 'dataset/session.json') return 4096;
  if (/^dataset\/pages\/[0-9]{5}\.json$/.test(name)) return 2101248;
  if (name === 'dataset/manifest.json') return 4194304;
  if (['dataset/dataset.jsonl', 'dataset/dataset.csv', 'dataset/review.html'].includes(name)) return 268435456;
  if (/^attachments\/attachment-[0-9]{6}\.bin$/.test(name)) return 33554432;
  throw fault('BASEROW_CUSTOMER_FILE_NAME_INVALID');
}
export function descriptor(value) {
  check(object(value) && typeof value.name === 'string' && Number.isSafeInteger(value.bytes) &&
    value.bytes >= 0 && value.bytes <= fileLimit(value.name) && HASH.test(value.sha256 ?? ''),
    'BASEROW_CUSTOMER_FILE_DESCRIPTOR_INVALID');
  return { name: value.name, bytes: value.bytes, sha256: value.sha256 };
}
export function same(left, right, code = 'BASEROW_CUSTOMER_BINDING_CHANGED') {
  check(identity(left) === identity(right), code);
}
export function cancelled(signal) {
  if (signal?.aborted) throw fault('BASEROW_CUSTOMER_CANCELLED');
}
export async function rootDirectory(path, create = false) {
  check(typeof path === 'string' && resolve(path) === path && path !== '/', 'BASEROW_CUSTOMER_ABSOLUTE_DIRECTORY_REQUIRED');
  await privateDirectory(path, create); return path;
}
async function outputParent(path) {
  await privateDirectory(dirname(path));
  check(resolve(path) === path && !path.includes('\0'), 'BASEROW_CUSTOMER_OUTPUT_PATH_INVALID');
}
async function publishTemporary(temporary, path, expected) {
  try { await link(temporary, path); }
  catch (issue) {
    if (issue.code !== 'EEXIST') throw issue;
    const found = await hashPrivate(path, expected.bytes);
    check(found.bytes === expected.bytes && found.hash === expected.sha256, 'BASEROW_CUSTOMER_EXISTING_FILE_CHANGED');
  }
  await unlink(temporary);
  await syncDirectory(dirname(path));
}
// Create-only publication leaves a completed file visible, including on restart.
export async function once(path, content) {
  await outputParent(path);
  check(Buffer.isBuffer(content), 'BASEROW_CUSTOMER_BYTES_REQUIRED');
  const expected = { bytes: content.length, sha256: digest(content) };
  if (await exists(path)) {
    const found = await hashPrivate(path, content.length);
    check(found.bytes === expected.bytes && found.hash === expected.sha256, 'BASEROW_CUSTOMER_EXISTING_FILE_CHANGED');
    return expected;
  }
  const temporary = join(dirname(path), '.customer-pending-' + randomUUID());
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content); await handle.sync(); await handle.close();
    await publishTemporary(temporary, path, expected); return expected;
  } catch (issue) {
    await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw issue;
  }
}
const statIdentity = info => [String(info.dev), String(info.ino), String(info.size),
  String(info.mtimeNs), String(info.ctimeNs), String(info.mode), String(info.nlink)];
export async function copyExact(source, destination, expected, signal) {
  cancelled(signal); await outputParent(destination);
  check(Number.isSafeInteger(expected.bytes) && expected.bytes >= 0 && HASH.test(expected.sha256 ?? ''),
    'BASEROW_CUSTOMER_FILE_DESCRIPTOR_INVALID');
  await privateDirectory(dirname(source));
  if (await exists(destination)) {
    const found = await hashPrivate(destination, expected.bytes);
    check(found.bytes === expected.bytes && found.hash === expected.sha256, 'BASEROW_CUSTOMER_EXISTING_FILE_CHANGED');
    return;
  }
  const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const temporary = join(dirname(destination), '.customer-pending-' + randomUUID());
  let output;
  try {
    const before = await input.stat({ bigint: true });
    check(before.isFile() && before.nlink === 1n && (before.mode & 0o077n) === 0n &&
      before.size === BigInt(expected.bytes) && await realpath(source) === source,
      'BASEROW_CUSTOMER_SOURCE_FILE_CHANGED');
    output = await open(temporary, 'wx', 0o600);
    const hash = createHash('sha256'), buffer = Buffer.alloc(1048576); let length = 0;
    for (;;) {
      cancelled(signal);
      const read = await input.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
      check(length <= expected.bytes, 'BASEROW_CUSTOMER_SOURCE_FILE_CHANGED');
      const part = buffer.subarray(0, read.bytesRead); hash.update(part);
      let offset = 0;
      while (offset < part.length) {
        const written = await output.write(part, offset, part.length - offset, null);
        check(written.bytesWritten > 0, 'BASEROW_CUSTOMER_WRITE_INCOMPLETE');
        offset += written.bytesWritten;
      }
    }
    const after = await input.stat({ bigint: true });
    same(statIdentity(before), statIdentity(after), 'BASEROW_CUSTOMER_SOURCE_FILE_CHANGED');
    check(length === expected.bytes && hash.digest('hex') === expected.sha256, 'BASEROW_CUSTOMER_SOURCE_FILE_CHANGED');
    await output.sync(); await output.close(); output = null;
    cancelled(signal); await publishTemporary(temporary, destination, expected);
  } finally {
    await input.close(); await output?.close().catch(() => {}); await unlink(temporary).catch(() => {});
  }
}
export async function describeFile(root, name) {
  const maximum = fileLimit(name);
  await privateDirectory(dirname(join(root, name)));
  const value = await hashPrivate(join(root, name), maximum);
  return { name, bytes: value.bytes, sha256: value.hash };
}
export async function validateFiles(root, files, signal) {
  check(Array.isArray(files) && files.length >= 7 && files.length <= MAX_CUSTOMER_FILES,
    'BASEROW_CUSTOMER_COMPLETE_FILES_REQUIRED');
  const seen = new Set(); let total = 0;
  for (const raw of files) {
    cancelled(signal); const item = descriptor(raw);
    check(!seen.has(item.name), 'BASEROW_CUSTOMER_DUPLICATE_FILE');
    seen.add(item.name); total += item.bytes;
    check(total <= MAX_CUSTOMER_BYTES, 'BASEROW_CUSTOMER_TOO_MANY_BYTES');
    const observed = await describeFile(root, item.name);
    same(observed, item, 'BASEROW_CUSTOMER_FILE_CHANGED');
  }
  return { names: seen, bytes: total };
}
export async function ensurePacketDirectories(root) {
  await rootDirectory(root, true);
  await privateDirectory(join(root, 'dataset'), true);
  await privateDirectory(join(root, 'dataset', 'pages'), true);
  await privateDirectory(join(root, 'attachments'), true);
}
