// MIT. Portable paid-job recovery state and the original writer leases.
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { canonical, digest, jobError } from './config.mjs';
import { acquireStateLease } from '../../merchant-fleet-gateway/state-lease.mjs';
import { acquireDeliveryLease, assertDeliveryLease } from '../../sf98-merchant-delivery/delivery-lock.mjs';

const SCHEMA = 'stellar-forge.job-recovery-state.v1';
const MAX_ENTRIES = 10000, MAX_DEPTH = 16, MAX_FILE = 2 * 1024 ** 3, MAX_BYTES = 4 * 1024 ** 3;
const fail = (code, status = 409) => { throw jobError(code, status); };
const within = (path, root) => path === root || path.startsWith(root + sep);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const privateMode = info => (info.mode & 0o077n) === 0n;
const sameNode = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
const sameVersion = (a, b) => sameNode(a, b) && a.size === b.size &&
  a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;

function absolute(path) {
  return typeof path === 'string' && isAbsolute(path) && resolve(path) === path &&
    path !== '/' && !/[\x00-\x1f\x7f]/.test(path);
}
async function privateDirectory(path) {
  if (!absolute(path)) fail('JOB_RECOVERY_PRIVATE_DIRECTORY_REQUIRED', 400);
  const info = await lstat(path, { bigint: true });
  if (!info.isDirectory() || !privateMode(info) || await realpath(path) !== path)
    fail('JOB_RECOVERY_PRIVATE_DIRECTORY_REQUIRED');
  return { path, info };
}
async function optionalDirectory(path) {
  try { return await privateDirectory(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function assertDirectory(pin) {
  const info = await lstat(pin.path, { bigint: true });
  if (!info.isDirectory() || !privateMode(info) || !sameNode(pin.info, info) ||
      await realpath(pin.path) !== pin.path) fail('JOB_RECOVERY_DIRECTORY_CHANGED');
}
async function layout({ directory, deliveryDirectories = [] } = {}) {
  if (!Array.isArray(deliveryDirectories)) fail('JOB_RECOVERY_DELIVERY_DIRECTORIES_REQUIRED', 400);
  const paths = [...deliveryDirectories];
  const merchant = await privateDirectory(directory);
  const outboxPath = join(directory, 'outbox'), defaultPath = join(directory, 'result-delivery');
  const [outbox, defaultDelivery] = await Promise.all([
    optionalDirectory(outboxPath), optionalDirectory(defaultPath),
  ]);
  const explicit = [];
  const unique = new Set();
  for (let index = 0; index < paths.length; index++) {
    const pin = await privateDirectory(paths[index]);
    if (within(directory, pin.path) || pin.path === outboxPath ||
        within(pin.path, join(directory, 'source-bindings')))
      fail('JOB_RECOVERY_DELIVERY_DIRECTORY_OVERLAP', 400);
    if (!unique.has(pin.path)) {
      explicit.push({ ...pin, index });
      unique.add(pin.path);
    }
  }
  const delivery = [...new Map([...(defaultDelivery ? [defaultDelivery] : []), ...explicit]
    .map(pin => [pin.path, pin])).values()].sort((a, b) => compare(a.path, b.path));
  const roots = [{ ...merchant, logical: 'merchant' }];
  for (const pin of explicit) {
    if (within(pin.path, directory) ||
        explicit.some(other => other.path !== pin.path && within(pin.path, other.path))) continue;
    roots.push({ ...pin, logical: 'delivery:' + pin.index });
  }
  // Only the actual writer lock at each selected root is mutable lease metadata.
  const exclusions = new Map([
    [join(directory, 'lease.lock'), 'file'],
    [join(outboxPath, '.sf98-delivery.lock'), 'file'],
    [join(defaultPath, 'lease.lock'), 'file'],
    [join(directory, 'source-binding.json'), 'binding'],
    [join(directory, 'source-bindings'), 'directory'],
    ...explicit.map(pin => [join(pin.path, 'lease.lock'), 'file']),
  ]);
  return { merchant, outbox, delivery, roots, exclusions,
    absent: [!outbox && outboxPath, !defaultDelivery && defaultPath].filter(Boolean) };
}

function regularFile(info) {
  if (!info.isFile() || !privateMode(info) || info.nlink !== 1n)
    fail('JOB_RECOVERY_PRIVATE_FILE_REQUIRED');
}
async function names(path) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const raw = await readdir(path, { encoding: 'buffer' });
  let values;
  try { values = raw.map(value => decoder.decode(value)); }
  catch { fail('JOB_RECOVERY_UTF8_PATH_REQUIRED'); }
  if (new Set(values).size !== values.length) fail('JOB_RECOVERY_PATH_COLLISION');
  return values.sort(compare);
}
async function hashFile(path, named, limit) {
  regularFile(named);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    regularFile(before);
    if (!sameVersion(before, named)) fail('JOB_RECOVERY_STATE_CHANGED');
    if (before.size > BigInt(limit)) fail('JOB_RECOVERY_FILE_LIMIT', 413);
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
    let bytes = 0;
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
      if (bytes > limit) fail('JOB_RECOVERY_FILE_LIMIT', 413);
      hash.update(buffer.subarray(0, result.bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    const current = await lstat(path, { bigint: true });
    if (BigInt(bytes) !== before.size || !sameVersion(before, after) || !sameVersion(before, current))
      fail('JOB_RECOVERY_STATE_CHANGED');
    return { bytes, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}

/**
 * Call while holding acquireJobRecoveryLeases for a quiescent snapshot/adoption.
 * Paths in the digest are merchant and delivery:<original input index>, never
 * host paths. Only the exact writer locks and binding metadata listed in layout
 * are excluded; other files (including other lock names) remain original state.
 */
export async function inspectJobRecoveryState(options = {}) {
  if (process.platform !== 'linux') fail('JOB_RECOVERY_REQUIRES_LINUX', 503);
  const selected = await layout(options), entries = [];
  let files = 0, directories = 0, bytes = 0, bindingSha256 = null;
  const add = entry => {
    if (entries.length >= MAX_ENTRIES) fail('JOB_RECOVERY_ENTRY_LIMIT', 413);
    entries.push(entry);
  };
  async function visit(path, physical, logical, expected, depth) {
    if (depth > MAX_DEPTH) fail('JOB_RECOVERY_DEPTH_LIMIT', 413);
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isDirectory() || !privateMode(before) || !sameNode(expected, before))
        fail('JOB_RECOVERY_DIRECTORY_CHANGED');
      // Holding the directory fd prevents ancestor replacement from redirecting
      // a child read. Original paid-job recovery already requires Linux flock.
      const anchor = '/proc/self/fd/' + handle.fd;
      const initial = await names(anchor);
      add({ path: logical, type: 'directory' }); directories++;
      for (const name of initial) {
        const child = join(anchor, name), original = join(physical, name);
        const childLogical = logical + '/' + name;
        const info = await lstat(child, { bigint: true });
        const excluded = selected.exclusions.get(original);
        if (excluded === 'directory') {
          if (!info.isDirectory() || !privateMode(info)) fail('JOB_RECOVERY_PRIVATE_DIRECTORY_REQUIRED');
          continue;
        }
        if (excluded === 'file') { regularFile(info); continue; }
        if (excluded === 'binding') {
          bindingSha256 = (await hashFile(child, info, 65536)).sha256;
          continue;
        }
        if (info.isDirectory()) await visit(child, original, childLogical, info, depth + 1);
        else {
          const result = await hashFile(child, info, MAX_FILE);
          bytes += result.bytes;
          if (bytes > MAX_BYTES) fail('JOB_RECOVERY_BYTE_LIMIT', 413);
          add({ path: childLogical, type: 'file', bytes: result.bytes, sha256: result.sha256 });
          files++;
        }
      }
      const after = await handle.stat({ bigint: true });
      const current = await lstat(path, { bigint: true });
      if (!sameVersion(before, after) || !sameVersion(before, current) ||
          canonical(initial) !== canonical(await names(anchor))) fail('JOB_RECOVERY_STATE_CHANGED');
    } finally { await handle.close(); }
  }
  for (const root of selected.roots) {
    await visit(root.path, root.path, root.logical, root.info, 0);
    await assertDirectory(root);
  }
  entries.sort((a, b) => compare(a.path, b.path));
  return Object.freeze({ sha256: digest(canonical({ schema: SCHEMA, entries })),
    files, directories, bytes, bindingSha256 });
}

/** Own every original writer; no replacement lock protocol or new state roots. */
export async function acquireJobRecoveryLeases(options = {}) {
  if (!Array.isArray(options.deliveryDirectories ?? [])) fail('JOB_RECOVERY_DELIVERY_DIRECTORIES_REQUIRED', 400);
  const request = { directory: options.directory, deliveryDirectories: [...(options.deliveryDirectories ?? [])] };
  const merchant = await privateDirectory(request.directory);
  const acquired = [];
  let selected, closing = null;
  async function releaseAll() {
    const errors = [];
    for (const lease of [...acquired].reverse()) {
      try { await lease.close(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw Object.assign(new AggregateError(errors, 'JOB_RECOVERY_LEASE_RELEASE_FAILED'),
      { code: 'JOB_RECOVERY_LEASE_RELEASE_FAILED' });
  }
  async function assertHeld() {
    if (closing) fail('JOB_RECOVERY_LEASE_CLOSED');
    for (const lease of acquired) await lease.assertHeld();
    if (selected) {
      for (const pin of [selected.merchant, ...(selected.outbox ? [selected.outbox] : []), ...selected.delivery])
        await assertDirectory(pin);
      for (const path of selected.absent) {
        try { await lstat(path); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        fail('JOB_RECOVERY_WRITER_DIRECTORY_CHANGED');
      }
    }
  }
  try {
    const original = await acquireStateLease(merchant.path);
    acquired.push(original);
    await assertDirectory(merchant);
    // Discover independently writable queues only after the merchant is owned.
    selected = await layout(request);
    if (selected.outbox) {
      const outbox = await acquireDeliveryLease(selected.outbox.path, { purpose: 'drain' });
      acquired.push({ assertHeld: () => assertDeliveryLease(outbox, selected.outbox.path),
        close: () => outbox.release() });
    }
    for (const pin of selected.delivery) acquired.push(await acquireStateLease(pin.path));
    await assertHeld();
    return Object.freeze({ assertHeld,
      async close() {
        if (!closing) closing = releaseAll();
        return closing;
      },
    });
  } catch (error) {
    try { await releaseAll(); }
    catch (cleanup) {
      throw Object.assign(new AggregateError([error, cleanup], 'JOB_RECOVERY_LEASE_ACQUIRE_FAILED'),
        { code: 'JOB_RECOVERY_LEASE_ACQUIRE_FAILED', cause: error });
    }
    throw error;
  }
}
