// MIT. A short-lived coordinator lease around the original SF96 commands.
// It never replaces the permanent SF88 attempt, original SF36 ledger, or evidence.
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, realpath, open, readFile, link, unlink, rename } from 'node:fs/promises';
import { dirname, resolve, isAbsolute, join } from 'node:path';
import { hostname } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

export const hashBytes = value => createHash('sha256').update(value).digest('hex');
export const encodeJSON = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const nativeErrorCode = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'PROVIDER_DESK_OPERATION_FAILED';
export function fail(code, status = 400) { throw Object.assign(new Error(code), {code, status}); }
export function requireValue(ok, code, status = 400) { if (!ok) fail(code, status); }
export function absolutePath(value) {
  requireValue(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'), 'PILOT_ABSOLUTE_PATH_REQUIRED');
  return resolve(value);
}
export function privateInfo(info) {
  return (info.mode & 0o077) === 0 && (typeof process.getuid !== 'function' || info.uid === process.getuid());
}
export async function privateDirectory(directory) {
  const path = absolutePath(directory), info = await lstat(path);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && privateInfo(info) && await realpath(path) === path,
    'PILOT_PRIVATE_REAL_DIRECTORY_REQUIRED');
  return info;
}
export async function readPrivate(filename, maximum = 1048576) {
  const handle = await open(absolutePath(filename), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    requireValue(info.isFile() && privateInfo(info) && info.size <= maximum, 'PILOT_PRIVATE_FILE_INVALID');
    const bytes = await handle.readFile();
    requireValue(bytes.length <= maximum, 'PILOT_FILE_TOO_LARGE');
    return bytes;
  } finally { await handle.close(); }
}
export async function readJSON(filename, maximum) {
  const bytes = await readPrivate(filename, maximum);
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { fail('PILOT_JSON_INVALID'); }
}
export async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function writeNew(filename, bytes) {
  const temporary = join(dirname(filename), '.sf96-write-' + randomUUID());
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await link(temporary, filename);
    await syncDirectory(dirname(filename));
  } finally { await unlink(temporary).catch(() => {}); }
}
export async function replaceJSON(filename, value) {
  const temporary = join(dirname(filename), '.sf96-update-' + randomUUID());
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    try { await handle.writeFile(encodeJSON(value)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, filename);
    await syncDirectory(dirname(filename));
  } finally { await unlink(temporary).catch(() => {}); }
}
async function processStart(pid) {
  if (process.platform !== 'linux') return null;
  try {
    const raw = await readFile('/proc/' + pid + '/stat', 'utf8');
    return raw.slice(raw.lastIndexOf(')') + 2).split(' ')[19];
  } catch { return null; }
}
async function bootId() {
  if (process.platform !== 'linux') return null;
  try { return (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(); }
  catch { return null; }
}
export async function processStatus(owner) {
  if (!owner || owner.host !== hostname()) return 'OTHER_HOST';
  if (owner.bootId && owner.bootId !== await bootId()) return 'STOPPED';
  const current = await processStart(owner.pid);
  if (owner.processStart && current && owner.processStart !== current) return 'STOPPED';
  try { process.kill(owner.pid, 0); return 'ACTIVE'; }
  catch (error) { return error.code === 'ESRCH' ? 'STOPPED' : 'UNKNOWN'; }
}
function lockPath(directory) {
  return join(dirname(directory), '.sf96-operation-' + hashBytes(directory) + '.lock');
}
export async function inspectPilotLock(input) {
  const directory = absolutePath(input);
  await privateDirectory(dirname(directory));
  let bytes;
  try { bytes = await readPrivate(lockPath(directory), 8192); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let record;
  try { record = JSON.parse(bytes); } catch { fail('PILOT_OPERATION_LOCK_INVALID', 409); }
  requireValue(record?.schema === 'scf.sf96.operation-lease.v1' && record.directory === directory &&
    Number.isSafeInteger(record.pid) && record.pid > 0 && typeof record.host === 'string' &&
    typeof record.token === 'string' && typeof record.action === 'string', 'PILOT_OPERATION_LOCK_INVALID', 409);
  const {token, ...publicRecord} = record;
  return {...publicRecord, state:await processStatus(record), sha256:hashBytes(bytes)};
}
// Serialize only admission and owner-record replacement, not the native operation.
// SQLite's process lock makes the observed-owner comparison and unlink indivisible
// with respect to every supported admission. Its mutex file carries no payment state.
const gates = new Map();
export async function withAdmissionGate(directory, callback) {
  const parent = dirname(directory), path = join(parent, '.sf96-admission.sqlite');
  const prior = gates.get(path) ?? Promise.resolve();
  let release; const turn = new Promise(resolve => { release = resolve; });
  const queued = prior.catch(() => {}).then(() => turn); gates.set(path, queued);
  await prior.catch(() => {});
  let database;
  try {
    await privateDirectory(parent);
    const handle = await open(path, constants.O_RDWR | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const info = await handle.stat();
      requireValue(info.isFile() && info.nlink === 1 && privateInfo(info), 'PILOT_ADMISSION_FILE_INVALID');
    } finally { await handle.close(); }
    database = new DatabaseSync(path);
    database.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS coordinator_mutex (id INTEGER PRIMARY KEY); BEGIN IMMEDIATE');
    try { const value = await callback(); database.exec('COMMIT'); return value; }
    catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; }
  } catch (error) {
    if (error.code === 'ERR_SQLITE_ERROR' && /locked|busy/i.test(error.message))
      fail('PILOT_ADMISSION_BUSY', 409);
    throw error;
  } finally {
    database?.close(); release();
    if (gates.get(path) === queued) gates.delete(path);
  }
}
export async function withPilotLock(input, action, callback) {
  const directory = absolutePath(input);
  await privateDirectory(dirname(directory));
  const path = lockPath(directory);
  const record = {schema:'scf.sf96.operation-lease.v1', directory, action,
    pid:process.pid, host:hostname(), processStart:await processStart(process.pid),
    bootId:await bootId(), token:randomUUID(), startedAt:new Date().toISOString()};
  const bytes = encodeJSON(record);
  await withAdmissionGate(directory, async () => {
    try { await writeNew(path, bytes); }
    catch (error) {
      if (error.code === 'EEXIST') {
        const lock = await inspectPilotLock(directory);
        throw Object.assign(new Error('PILOT_OPERATION_BUSY'), {code:'PILOT_OPERATION_BUSY',status:409,lock});
      }
      throw error;
    }
  });
  try { return await callback(record); }
  finally {
    await withAdmissionGate(directory, async () => {
      const current = await readPrivate(path, 8192).catch(error => { if(error.code==='ENOENT')return null;throw error; });
      if (current?.equals(bytes)) { await unlink(path); await syncDirectory(dirname(path)); }
    });
  }
}
// A stopped coordinator is removed only by an explicit caller, after observing
// this exact record. Original attempted payments and reservations are untouched.
export async function releaseStoppedPilotLock(input, expectedSha256, {originalAttempt = null} = {}) {
  const directory = absolutePath(input);
  return withAdmissionGate(directory, async () => {
    const before = await inspectPilotLock(directory);
    requireValue(before && before.sha256 === expectedSha256, 'PILOT_OPERATION_LOCK_CHANGED', 409);
    requireValue(before.state === 'STOPPED', 'PILOT_OPERATION_OWNER_NOT_STOPPED', 409);
    if (originalAttempt?.kind === 'EXECUTE')
      requireValue(await processStatus(originalAttempt) === 'STOPPED', 'PILOT_NATIVE_ATTEMPT_OWNER_NOT_STOPPED', 409);
    const current = await readPrivate(lockPath(directory), 8192);
    requireValue(hashBytes(current) === expectedSha256, 'PILOT_OPERATION_LOCK_CHANGED', 409);
    await unlink(lockPath(directory)); await syncDirectory(dirname(directory));
    return {released:true, originalAttemptPreserved:true};
  });
}

export const pilotLockPath = input => lockPath(absolutePath(input));
