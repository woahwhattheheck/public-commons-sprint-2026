// MIT. Private, exact-byte initialization shared by the original buyer and commerce constructors.
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, link, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual as same } from 'node:util';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const need = (value, code) => { if (!value) fail(code); };
const privateMode = info => info.isFile() && (info.mode & 0o077) === 0 &&
  (typeof process.getuid !== 'function' || info.uid === process.getuid());
export const initializationJson = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

export async function initializationDirectory(path, { create = false } = {}) {
  need(typeof path === 'string' && resolve(path) === path && path !== '/' && !path.includes('\0'),
    'INITIALIZATION_ABSOLUTE_PATH_REQUIRED');
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0 &&
    (typeof process.getuid !== 'function' || info.uid === process.getuid()) &&
    await realpath(path) === path, 'INITIALIZATION_PRIVATE_DIRECTORY_REQUIRED');
  return info;
}
export async function initializationBytes(path, limit = 16777216) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    need(privateMode(info) && info.size <= limit, 'INITIALIZATION_PRIVATE_FILE_REQUIRED');
    const bytes = await file.readFile();
    need(bytes.length <= limit, 'INITIALIZATION_FILE_TOO_LARGE');
    return bytes;
  } finally { await file.close(); }
}
export async function optionalInitializationBytes(path, limit) {
  try { return await initializationBytes(path, limit); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
/** Check all retained inputs before adding any missing part of an interrupted setup. */
export async function verifyInitializationFile(path, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const existing = await optionalInitializationBytes(path, Math.max(bytes.length, 1));
  need(existing === null || existing.equals(bytes), 'INITIALIZATION_SOURCE_CHANGED');
  return existing !== null;
}
export async function syncInitializationDirectory(path) {
  const file = await open(path, 'r');
  try { await file.sync(); } finally { await file.close(); }
}

/** Publish complete bytes once; an explicit resume accepts only identical existing bytes. */
export async function retainInitializationFile(path, value, { resume = false } = {}) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (resume) {
    const existing = await optionalInitializationBytes(path, Math.max(bytes.length, 1));
    if (existing !== null) {
      need(existing.equals(bytes), 'INITIALIZATION_SOURCE_CHANGED');
      return existing;
    }
  }
  const temporary = join(dirname(path), '.initializing-' + randomUUID());
  const file = await open(temporary, 'wx', 0o600);
  try {
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    try { await link(temporary, path); }
    catch (error) {
      if (!resume || error.code !== 'EEXIST') throw error;
      need((await initializationBytes(path, Math.max(bytes.length, 1))).equals(bytes), 'INITIALIZATION_SOURCE_CHANGED');
    }
    await syncInitializationDirectory(dirname(path));
    return bytes;
  } finally { await unlink(temporary).catch(() => {}); }
}

/** Preserve an existing timestamp while comparing every other original identity field. */
export async function retainInitializationRecord(path, value, { resume = false, ignore = [] } = {}) {
  const prior = resume ? await optionalInitializationBytes(path) : null;
  if (prior !== null) {
    let existing;
    try { existing = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(prior)); }
    catch { fail('INITIALIZATION_RECORD_INVALID'); }
    const without = record => Object.fromEntries(Object.entries(record ?? {}).filter(([key]) => !ignore.includes(key)));
    const expected = JSON.parse(initializationJson(value));
    need(same(without(existing), without(expected)), 'INITIALIZATION_SOURCE_CHANGED');
    return existing;
  }
  await retainInitializationFile(path, initializationJson(value), { resume });
  return value;
}

// The trusted original Python executable holds the OS lock. EOF releases it after parent loss.
const LEASE = `import fcntl,os,stat,sys
path=sys.argv[1]
fd=os.open(path,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
try:
    info=os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&0o077: raise RuntimeError('private lock required')
    try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: sys.exit(73)
    print('INITIALIZATION_LOCKED',flush=True)
    sys.stdin.buffer.read()
finally: os.close(fd)
`;

/** One native constructor owns this private path; restarting never relies on stale PID files. */
export async function acquireInitialization(directory, { python, resume = false } = {}) {
  need(typeof resume === 'boolean', 'INITIALIZATION_RESUME_BOOLEAN_REQUIRED');
  need(typeof python === 'string' && resolve(python) === python, 'INITIALIZATION_PYTHON_REQUIRED');
  need(await realpath(dirname(directory)) === dirname(directory), 'INITIALIZATION_PARENT_PATH_AMBIGUOUS');
  let created = false;
  try { await mkdir(directory, { mode: 0o700 }); created = true; }
  catch (error) { if (error.code !== 'EEXIST' || !resume) throw error; }
  const identity = await initializationDirectory(directory);
  const child = spawn(python, ['-I', '-B', '-c', LEASE, join(directory, '.initialization.lock')], {
    shell: false, env: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'ignore'],
  });
  let resolveExit;
  const exited = new Promise(done => { resolveExit = done; });
  child.once('exit', code => resolveExit(code));
  child.once('error', () => resolveExit(null));
  child.stdin.on('error', () => {});
  await new Promise((done, reject) => {
    let output = '', settled = false;
    const finish = error => {
      if (settled) return; settled = true; clearTimeout(timer);
      error ? reject(error) : done();
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(Object.assign(new Error('INITIALIZATION_LOCK_TIMEOUT'), { code: 'INITIALIZATION_LOCK_TIMEOUT' })); }, 10000);
    child.stdout.on('data', part => {
      output += part;
      if (output === 'INITIALIZATION_LOCKED\n') finish();
      else if (output.length > 128) { child.kill('SIGKILL'); finish(Object.assign(new Error('INITIALIZATION_LOCK_FAILED'), { code: 'INITIALIZATION_LOCK_FAILED' })); }
    });
    child.once('error', () => finish(Object.assign(new Error('INITIALIZATION_PYTHON_START_FAILED'), { code: 'INITIALIZATION_PYTHON_START_FAILED' })));
    child.once('exit', code => finish(Object.assign(new Error(code === 73 ? 'INITIALIZATION_ALREADY_RUNNING' : 'INITIALIZATION_LOCK_FAILED'),
      { code: code === 73 ? 'INITIALIZATION_ALREADY_RUNNING' : 'INITIALIZATION_LOCK_FAILED' })));
  });
  let closing;
  return { created, identity, close: () => closing ??= (async () => {
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    try { await exited; } finally { clearTimeout(timer); }
  })() };
}

