// MIT. Continue an original private SF99 bundle with the same plan and exact bytes.
import { open, mkdir, lstat, realpath, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { acquireStateLease } from '../merchant-fleet-gateway/state-lease.mjs';

const SCHEMA = 'stellar-forge.merchant-host-generation.v1';
const INTENT = 'generation.json';
const MAXIMUM = 4 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
function need(value, message) { if (!value) throw new Error(message); }
const sameInode = (a, b) => a.dev === b.dev && a.ino === b.ino;
const owner = info => typeof process.getuid !== 'function' || info.uid === process.getuid();
const absent = error => error.code === 'ENOENT';

/**
 * Only the original private preparation is writable. A completed bundle remains
 * usable after its runbook hands it to the service group; installed bundles are
 * reopened through checkBundle, not resumed as writable preparations.
 */
export async function resumeHostGeneration(directory, artifacts, manifest) {
  const expected = new Map();
  for (const [name, text] of artifacts) {
    need(/^[A-Za-z0-9_.-]+$/.test(name) &&
      !['.', '..', INTENT, 'lease.lock', 'deployment.json'].includes(name),
    'HOST_GENERATION_ARTIFACT_NAME_INVALID');
    const bytes = Buffer.from(text);
    need(bytes.length <= MAXIMUM, 'HOST_GENERATION_ARTIFACT_TOO_LARGE: ' + name);
    expected.set(name, bytes);
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  need(manifestBytes.length <= 1024 * 1024, 'HOST_GENERATION_MANIFEST_TOO_LARGE');
  expected.set('deployment.json', manifestBytes);
  const intent = Buffer.from(JSON.stringify({
    schema: SCHEMA, bundle: directory, manifestSha256: sha(manifestBytes),
    files: [...expected].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha(bytes) })),
  }, null, 2) + '\n');
  need(intent.length <= MAXIMUM, 'HOST_GENERATION_INTENT_TOO_LARGE');

  let created = false;
  try { await mkdir(directory, { mode: 0o700 }); created = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  need(await realpath(directory) === directory, 'HOST_GENERATION_CANONICAL_DIRECTORY_REQUIRED');
  const root = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  let lease;
  const assertDirectory = async () => {
    const [held, named] = await Promise.all([root.stat(), lstat(directory)]);
    need(held.isDirectory() && named.isDirectory() && !named.isSymbolicLink() &&
      sameInode(held, named) && owner(held) && !(held.mode & 0o077),
    'HOST_GENERATION_PRIVATE_DIRECTORY_REQUIRED');
    lease?.assertHeld();
  };
  const assertFile = async (handle, name, maximum) => {
    const [held, named] = await Promise.all([handle.stat(), lstat(join(directory, name))]);
    need(held.isFile() && named.isFile() && !named.isSymbolicLink() && sameInode(held, named) &&
      held.nlink === 1 && owner(held) && !(held.mode & 0o077) && held.size <= maximum,
    'HOST_GENERATION_PRIVATE_FILE_REQUIRED: ' + name);
    return held;
  };
  const readPrefix = async (handle, name, bytes) => {
    const before = await assertFile(handle, name, bytes.length);
    const retained = Buffer.alloc(before.size);
    for (let offset = 0; offset < retained.length;) {
      const { bytesRead } = await handle.read(retained, offset, retained.length - offset, offset);
      need(bytesRead > 0, 'HOST_GENERATION_FILE_CHANGED: ' + name);
      offset += bytesRead;
    }
    const after = await assertFile(handle, name, bytes.length);
    need(sameInode(before, after) && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
    'HOST_GENERATION_FILE_CHANGED: ' + name);
    need(retained.equals(bytes.subarray(0, retained.length)),
      'HOST_GENERATION_BYTES_CONFLICT: ' + name);
    return after;
  };
  const inspect = async (name, bytes) => {
    let handle;
    try {
      handle = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      return await readPrefix(handle, name, bytes);
    } catch (error) {
      if (!handle && absent(error)) return null;
      throw error;
    } finally { await handle?.close(); }
  };
  try {
    await assertDirectory();
    if (created) {
      const parent = await open(dirname(directory), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
      try { await parent.sync(); } finally { await parent.close(); }
    }
    lease = await acquireStateLease(directory);
    await assertDirectory();
    const lock = await lstat(join(directory, 'lease.lock'));
    need(owner(lock) && lock.nlink === 1, 'HOST_GENERATION_PRIVATE_LEASE_REQUIRED');
    const allowed = new Set([...expected.keys(), INTENT, 'lease.lock']);
    const names = await readdir(directory);
    const unexpected = names.filter(name => !allowed.has(name));
    need(!unexpected.length, 'HOST_GENERATION_UNEXPECTED_FILE: ' + unexpected.join(', '));
    // Reconcile the whole retained operation before writing any generated bytes.
    const selections = new Map([[INTENT, intent], ...expected]);
    const previous = new Map();
    for (const [name, bytes] of selections) previous.set(name, await inspect(name, bytes));
    const result = {
      schema: SCHEMA, state: 'COMPLETE', directory,
      manifestSha256: sha(manifestBytes), reusedFiles: 0,
      resumedFiles: 0, createdFiles: 0, bytesWritten: 0,
    };
    const retain = async (name, bytes, count = true) => {
      await assertDirectory();
      const before = previous.get(name);
      const flags = constants.O_RDWR | constants.O_NOFOLLOW |
        (before ? 0 : constants.O_CREAT | constants.O_EXCL);
      const handle = await open(join(directory, name), flags, 0o600);
      try {
        const current = await readPrefix(handle, name, bytes);
        need(!before || sameInode(before, current) && before.size === current.size &&
          before.mtimeMs === current.mtimeMs && before.ctimeMs === current.ctimeMs,
        'HOST_GENERATION_FILE_CHANGED: ' + name);
        let offset = current.size;
        while (offset < bytes.length) {
          lease.assertHeld();
          const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
          need(bytesWritten > 0, 'HOST_GENERATION_WRITE_INCOMPLETE: ' + name);
          offset += bytesWritten;
          if (count) result.bytesWritten += bytesWritten;
        }
        await handle.sync();
        const complete = await readPrefix(handle, name, bytes);
        need(complete.size === bytes.length, 'HOST_GENERATION_WRITE_INCOMPLETE: ' + name);
        await assertDirectory();
        if (count) {
          if (!before) result.createdFiles++;
          else if (before.size === bytes.length) result.reusedFiles++;
          else result.resumedFiles++;
        }
      } finally { await handle.close(); }
      // Persist each original directory entry before publishing the final manifest.
      await root.sync();
    };
    // This stable intent binds every output to the complete selected preparation.
    // A partial intent is reconciled by the same exact-prefix rule as its files.
    await retain(INTENT, intent, false);
    for (const [name, bytes] of expected) await retain(name, bytes);
    await assertDirectory();
    return result;
  } finally {
    try { await lease?.close(); } finally { await root.close(); }
  }
}
