// MIT. Private resumable bindings for the original SF30 upstream launcher.
import { readFile, lstat, open, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { compileUpstreamBindings, validateUpstreamService } from '../sf30-seller-sdk/upstream.mjs';

const LIMIT = 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function readBytes(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > LIMIT)
    throw new TypeError('Upstream bindings must be a regular JSON file up to 1 MiB');
  const bytes = await readFile(path);
  if (bytes.length > LIMIT) throw new RangeError('Upstream bindings exceed 1 MiB');
  return bytes;
}

/** Also used by status: verify saved configuration without resolving credentials. */
export async function verifyUpstreamSnapshot(out, snapshot) {
  if (!plain(snapshot) || Object.keys(snapshot).some(key => !['file', 'sha256'].includes(key)) ||
      typeof snapshot.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.sha256) ||
      snapshot.file !== `pilot-upstreams-${snapshot.sha256}.json`)
    throw new TypeError('Invalid saved upstream snapshot; supply --upstreams with the intended bindings');
  const path = join(out, snapshot.file), bytes = await readBytes(path);
  if (digest(bytes) !== snapshot.sha256)
    throw new Error('Saved upstream bindings changed. Restore the saved snapshot or supply --upstreams with the intended replacement.');
  return { path, bytes };
}

async function persistSnapshot(out, bytes, snapshot) {
  const temp = join(out, `.pilot-upstreams-${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(temp, 'wx', 0o600);
    await file.writeFile(bytes);
    await file.sync();
    await file.close(); file = null;
    // A completed private file becomes visible atomically; concurrent launches
    // cannot overwrite an existing snapshot or leave its digest-named path partial.
    try { await link(temp, join(out, snapshot.file)); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await verifyUpstreamSnapshot(out, snapshot);
    }
  } finally {
    await file?.close().catch(() => {});
    await unlink(temp).catch(() => {});
  }
}

/** Validate with SF30, then retain only original JSON bytes and their digest. */
export async function prepareUpstreamSnapshot({ out, input, saved, config, allowLoopback = false, deferCredentials = false }) {
  const bytes = input ? await readBytes(input) : (await verifyUpstreamSnapshot(out, saved)).bytes;
  let bindings;
  try { bindings = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new TypeError('Upstream bindings must contain valid UTF-8 JSON'); }
  // Paid launch validates credential values here. Unpaid-only resume validates
  // their references and leaves value resolution to the original admitted handler.
  // Saved JSON always retains names and original bytes, never credential values.
  const compiled = compileUpstreamBindings(bindings, { allowLoopback, deferCredentials });
  validateUpstreamService(config, compiled);
  const sha256 = digest(bytes), snapshot = { file: `pilot-upstreams-${sha256}.json`, sha256 };
  if (input) await persistSnapshot(out, bytes, snapshot);
  return snapshot;
}
