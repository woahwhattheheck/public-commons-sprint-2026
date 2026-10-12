// MIT — Private application state. Financial authority stays in the original SF36 ledger.
import { constants } from 'node:fs';
import { inspect } from 'node:util';
import { AsyncLocalStorage } from 'node:async_hooks';
import { open, mkdir, lstat, readdir, rename, link, unlink } from 'node:fs/promises';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class BuyerError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'BuyerError';
    this.code = code;
    // Recovery objects remain directly accessible, but are not log payloads.
    for (const key of Reflect.ownKeys(Object(details))) {
      if (!Object.prototype.propertyIsEnumerable.call(details, key)) continue;
      Object.defineProperty(this, key, { value: details[key], writable: true, configurable: true });
    }
  }
  toJSON() {
    const value = { name: this.name, code: this.code };
    if (Number.isInteger(this.exitCode) || this.exitCode === null) value.exitCode = this.exitCode;
    if (typeof this.destinationPublished === 'boolean') value.destinationPublished = this.destinationPublished;
    return value;
  }
  [inspect.custom](_depth, options) {
    const display = new Error(this.message);
    Object.assign(display, this.toJSON());
    display.stack = this.stack;
    return inspect(display, { ...options, customInspect: false });
  }
}
export const need = (condition, code) => { if (!condition) throw new BuyerError(code); };
export const digest = data => createHash('sha256').update(data).digest('hex');
export const now = () => new Date().toISOString();
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const safeCode = (value, fallback) => typeof value === 'string' && /^[A-Z0-9_]{1,120}$/.test(value) ? value : fallback;
export function intent(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value), 'STABLE_INTENT_ID_REQUIRED');
  return value;
}
export function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'), 'ABSOLUTE_PATH_REQUIRED');
  return resolve(value);
}
export function jsonBytes(value) {
  const text = JSON.stringify(value, (_key, item) => {
    need(item !== undefined && typeof item !== 'function' && typeof item !== 'symbol' && typeof item !== 'bigint', 'JSON_VALUES_REQUIRED');
    need(typeof item !== 'number' || Number.isFinite(item), 'JSON_VALUES_REQUIRED');
    return item;
  }, 2);
  return Buffer.from(text + '\n');
}
export async function privateDirectory(path, { create = true } = {}) {
  path = absolute(path);
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  need(stat.isDirectory() && !stat.isSymbolicLink(), 'PRIVATE_STATE_DIRECTORY_REQUIRED');
  if (process.platform !== 'win32') {
    need((stat.mode & 0o077) === 0, 'PRIVATE_STATE_DIRECTORY_REQUIRED');
    if (process.getuid) need(stat.uid === process.getuid(), 'STATE_DIRECTORY_OWNER_MISMATCH');
  }
  return path;
}
export async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function readBytes(path, limit = 65536) {
  need(Number.isSafeInteger(limit) && limit >= 0, 'READ_LIMIT_INVALID');
  const handle = await open(absolute(path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    need(stat.isFile() && stat.size <= limit, 'FILE_SIZE_OR_TYPE_INVALID');
    const data = await handle.readFile();
    need(data.length <= limit, 'FILE_SIZE_OR_TYPE_INVALID');
    return data;
  } finally { await handle.close(); }
}
export function parseJson(raw) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw new BuyerError('JSON_INVALID'); }
}
export async function readJson(path, limit) {
  const value = parseJson(await readBytes(path, limit));
  need(object(value), 'JSON_OBJECT_REQUIRED');
  return value;
}
export async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
/**
 * Recognize complete leftovers from writeBytes without removing or adopting them.
 * Callers still validate every published output and its original binding marker.
 */
export async function matchingWriteTemporaries(directory, expectedBytes) {
  need(Array.isArray(expectedBytes) && expectedBytes.every(value => value instanceof Uint8Array),
    'WRITE_TEMPORARY_BYTES_REQUIRED');
  const expected = expectedBytes.map(value => Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  directory = await privateDirectory(directory, { create: false });
  const matches = new Set();
  for (const name of await readdir(directory)) {
    if (!/^\.write-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(name)) continue;
    const path = join(directory, name);
    let handle;
    try {
      const named = await lstat(path);
      if (!named.isFile() || !expected.some(value => value.length === named.size)) continue;
      handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const before = await handle.stat();
      if (!before.isFile() || before.dev !== named.dev || before.ino !== named.ino ||
          before.size !== named.size || process.platform !== 'win32' &&
          ((before.mode & 0o077) !== 0 || process.getuid && before.uid !== process.getuid())) continue;
      let candidates = expected.filter(value => value.length === before.size), offset = 0;
      const chunk = Buffer.allocUnsafe(Math.min(65536, before.size + 1));
      while (candidates.length && offset < before.size) {
        const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, before.size - offset), offset);
        if (bytesRead === 0) { candidates = []; break; }
        candidates = candidates.filter(value => chunk.subarray(0, bytesRead).equals(value.subarray(offset, offset + bytesRead)));
        offset += bytesRead;
      }
      if (!candidates.length) continue;
      const tail = await handle.read(chunk, 0, 1, offset);
      const after = await handle.stat(), current = await lstat(path);
      if (tail.bytesRead === 0 && current.isFile() && current.dev === before.dev && current.ino === before.ino &&
          after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs)
        matches.add(name);
    } catch (error) {
      if (!['ENOENT', 'ELOOP'].includes(error.code)) throw error;
    } finally {
      if (handle) await handle.close();
    }
  }
  return matches;
}

// Reservation scope carries only local file allocation. Financial configuration
// and the original operation/response schemas do not acquire storage settings.
const fileReservations = new AsyncLocalStorage();
function reservationOptions(options = {}) {
  need(object(options), 'FILE_RESERVATION_OPTIONS_INVALID');
  const inherited = fileReservations.getStore();
  const reserveFile = options.reserveFile ?? inherited?.reserveFile;
  need(reserveFile === undefined || typeof reserveFile === 'function', 'FILE_RESERVATION_CALLBACK_INVALID');
  const signals = [...new Set([inherited?.signal, options.signal].filter(value => value !== undefined))];
  for (const signal of signals) need(signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
  return { reserveFile, signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] };
}
export function currentFileReservation() {
  const scope = fileReservations.getStore();
  return scope ? Object.freeze({ reserveFile: scope.reserveFile, signal: scope.signal }) : null;
}
export function withFileReservation(options, work) {
  need(typeof work === 'function', 'FILE_RESERVATION_WORK_REQUIRED');
  const selected = reservationOptions(options);
  need(selected.reserveFile, 'FILE_RESERVATION_CALLBACK_REQUIRED');
  return fileReservations.run({ ...fileReservations.getStore(), ...selected }, work);
}
function retainedBytes(data) {
  need(typeof data === 'string' || data instanceof Uint8Array, 'FILE_WRITE_BYTES_REQUIRED');
  return Buffer.from(data);
}
function retainCleanup(error, cleanupError) {
  if (cleanupError && error !== null && (typeof error === 'object' || typeof error === 'function'))
    try { Object.defineProperty(error, 'cleanupError', { value: cleanupError, configurable: true }); } catch {}
}
async function closeTemporary(slot) {
  let failure;
  if (slot.handle) {
    try { await slot.handle.close(); } catch (error) { failure = error; }
    slot.handle = undefined;
  }
  // If the initial fstat itself failed, close the handle without deleting an
  // unverified pathname. No capacity was allocated to that temporary file.
  if (!slot.identity) { if (failure) throw failure; return; }
  try {
    const current = await lstat(slot.temporary);
    need(current.isFile() && !current.isSymbolicLink() &&
      current.dev === slot.identity.dev && current.ino === slot.identity.ino,
    'FILE_RESERVATION_TEMPORARY_CHANGED');
    await unlink(slot.temporary);
  } catch (error) { if (error.code !== 'ENOENT') failure ??= error; }
  if (failure) throw failure;
}
async function ownedTemporary(path, bytes, reserveFile, signal) {
  need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
  const temporary = join(dirname(path), '.write-' + randomUUID());
  const handle = await open(temporary, 'wx', 0o600);
  const slot = { path, temporary, handle, bytes, used: false };
  try {
    slot.identity = await handle.stat();
    if (reserveFile && bytes > 0) {
      const fd = handle.fd, before = await handle.stat({ bigint: true });
      await reserveFile(Object.freeze({
        fileHandle: handle, path: temporary, kind: 'buyer-metadata', bytes, signal,
      }));
      const after = await handle.stat({ bigint: true }), named = await lstat(temporary, { bigint: true });
      need(handle.fd === fd && after.isFile() && named.isFile() && !named.isSymbolicLink() &&
        before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
        before.mode === after.mode && before.uid === after.uid && before.gid === after.gid &&
        before.nlink === after.nlink && named.dev === after.dev && named.ino === after.ino &&
        named.size === after.size && named.mode === after.mode && named.uid === after.uid &&
        named.gid === after.gid, 'FILE_RESERVATION_TARGET_CHANGED');
      need(typeof after.blocks === 'bigint' && after.blocks * 512n >= BigInt(bytes),
        'FILE_RESERVATION_INCOMPLETE');
      await handle.sync();
      need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
    }
    return slot;
  } catch (error) {
    try { await closeTemporary(slot); } catch (cleanupError) { retainCleanup(error, cleanupError); }
    throw error;
  }
}
async function publishTemporary(slot, data, exclusive, reserved) {
  try {
    if (reserved) {
      // Positional writes consume the held destination inode; they never reopen
      // it with a truncating flag that would discard the preallocated blocks.
      let offset = 0;
      while (offset < data.length) {
        const { bytesWritten } = await slot.handle.write(data, offset, data.length - offset, offset);
        need(Number.isInteger(bytesWritten) && bytesWritten > 0, 'FILE_WRITE_NO_PROGRESS');
        offset += bytesWritten;
      }
      await slot.handle.truncate(data.length);
    } else await slot.handle.writeFile(data);
    await slot.handle.sync();
    await slot.handle.close(); slot.handle = undefined;
    if (exclusive) { await link(slot.temporary, slot.path); await unlink(slot.temporary); }
    else await rename(slot.temporary, slot.path);
    await syncDirectory(dirname(slot.path));
  } finally { await closeTemporary(slot); }
}

/** Hold the actual future publication files before native work begins.
 * Repeated paths reserve separate original atomic replacements in order. */
export async function prepareWriteReservations(entries, options = {}) {
  const { reserveFile, signal } = reservationOptions(options);
  if (!reserveFile) return null;
  need(Array.isArray(entries) && entries.length > 0 && entries.length <= 256,
    'FILE_RESERVATION_PLAN_INVALID');
  need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
  const slots = [], byPath = new Map();
  let closed = false;
  try {
    for (const entry of entries) {
      need(object(entry) && Object.keys(entry).every(key => ['path', 'bytes', 'exclusive'].includes(key)) &&
        Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= 2147483647 &&
        (entry.exclusive === undefined || typeof entry.exclusive === 'boolean'),
      'FILE_RESERVATION_ENTRY_INVALID');
      const path = absolute(entry.path);
      const slot = await ownedTemporary(path, entry.bytes, reserveFile, signal);
      slot.exclusive = entry.exclusive ?? false;
      slots.push(slot);
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path).push(slot);
    }
  } catch (error) {
    const cleanup = await Promise.allSettled(slots.map(closeTemporary));
    retainCleanup(error, cleanup.find(item => item.status === 'rejected')?.reason);
    throw error;
  }
  const pool = {
    async write(path, data, exclusive) {
      need(!closed, 'FILE_RESERVATION_CLOSED');
      const queue = byPath.get(path);
      if (!queue) return false;
      const slot = queue.find(item => !item.used);
      need(slot, 'FILE_RESERVATION_PLAN_EXHAUSTED');
      need(slot.exclusive === exclusive && data.length <= slot.bytes, 'FILE_RESERVATION_WRITE_MISMATCH');
      slot.used = true;
      // Once capacity is held, persist interruption/error checkpoints even if
      // the operation's AbortSignal fired during its original native call.
      await publishTemporary(slot, data, exclusive, true);
      return true;
    },
    run(work) {
      need(!closed && typeof work === 'function', 'FILE_RESERVATION_CLOSED');
      return fileReservations.run({ reserveFile, signal, pool }, work);
    },
    writeBytes(path, data, options) { return pool.run(() => writeBytes(path, data, options)); },
    writeJson(path, value, options) { return pool.run(() => writeJson(path, value, options)); },
    summary() { return { files: slots.length, bytes: slots.reduce((sum, slot) => sum + slot.bytes, 0),
      remaining: slots.filter(slot => !slot.used).length, closed }; },
    async close() {
      if (closed) return;
      closed = true;
      const cleanup = await Promise.allSettled(slots.filter(slot => !slot.used).map(closeTemporary));
      const failure = cleanup.find(item => item.status === 'rejected');
      if (failure) throw failure.reason;
    },
  };
  return Object.freeze(pool);
}
export async function writeBytes(path, data, options = {}) {
  path = absolute(path);
  const { exclusive = false } = options;
  const selected = reservationOptions(options), scope = fileReservations.getStore();
  const raw = selected.reserveFile ? retainedBytes(data) : data;
  if (scope?.pool && await scope.pool.write(path, raw, exclusive)) return;
  const slot = await ownedTemporary(path, selected.reserveFile ? raw.length : 0,
    selected.reserveFile, selected.signal);
  await publishTemporary(slot, raw, exclusive, Boolean(selected.reserveFile));
}
export const writeJson = (path, value, options) => writeBytes(path, jsonBytes(value), options);
