// MIT. Private retained records for the original runtime operator workspace.
import { constants } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { open, mkdir, readdir, lstat, realpath, rename, readFile, link, unlink } from 'node:fs/promises';
import { dirname, resolve, join, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const now = () => new Date().toISOString();
export const digest = value => createHash('sha256').update(value).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const fail = (code, message = code, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
export const need = (value, code, message, status) => { if (!value) fail(code, message, status); };
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
export function recordId(value) {
  need(typeof value === 'string' && /^[a-f0-9]{24}$/.test(value), 'RUNTIME_WORKSPACE_RECORD_INVALID');
  return value;
}
export function operationId(value) {
  need(typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value),
    'RUNTIME_WORKSPACE_OPERATION_INVALID');
  return value;
}
export function absolute(value) {
  need(typeof value === 'string' && value && value === resolve(value) && !value.includes('\0'),
    'RUNTIME_WORKSPACE_ABSOLUTE_PATH_REQUIRED');
  return value;
}
export async function privateDirectory(value) {
  const path = absolute(value), info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    !(info.mode & 0o077) && (process.getuid === undefined || info.uid === process.getuid()),
  'RUNTIME_WORKSPACE_PRIVATE_DIRECTORY_REQUIRED', 'Use a private real directory owned by the current operator');
  return path;
}
export async function optionalPrivateEntries(path) {
  try {
    await privateDirectory(path);
    return await readdir(path);
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
export async function makePrivate(value) {
  const path = absolute(value);
  need(await realpath(dirname(path)) === dirname(path), 'RUNTIME_WORKSPACE_REAL_PARENT_REQUIRED');
  // Preserve exclusive-create semantics without acquiring a lease for the
  // common ensure-existing-directory read path.
  try {
    await lstat(path);
    throw Object.assign(new Error('Directory already exists: ' + path),
      { code: 'EEXIST', syscall: 'mkdir', path });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return withRecordWrite(path, async () => {
    await mkdir(path, { mode: 0o700 });
    return privateDirectory(path);
  });
}
export async function regular(path, maximum = 4 * 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const first = await handle.stat();
    need(first.isFile() && first.size <= maximum, 'RUNTIME_WORKSPACE_FILE_INVALID');
    const bytes = await handle.readFile(), last = await handle.stat();
    need(bytes.length <= maximum && first.size === last.size && first.mtimeMs === last.mtimeMs &&
      first.ctimeMs === last.ctimeMs, 'RUNTIME_WORKSPACE_FILE_CHANGED');
    return bytes;
  } finally { await handle.close(); }
}
export async function readJSON(path, optional = false) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(path))); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
export async function saveJSON(path, value, replace = false) {
  return withRecordWrite(path, () => saveJSONUnlocked(path, value, replace));
}
async function saveJSONUnlocked(path, value, replace) {
  const temporary = path + '.pending-' + randomUUID();
  let handle = null, created = false;
  try {
    handle = await open(temporary, 'wx', 0o600); created = true;
    await handle.writeFile(json(value)); await handle.sync();
    await handle.close(); handle = null;
    if (replace) await rename(temporary, path);
    else await link(temporary, path);
  } finally {
    try { if (handle) await handle.close(); }
    finally {
      if (created) {
        try {
          try { await unlink(temporary); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        } finally {
          const parent = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
          try { await parent.sync(); } finally { await parent.close(); }
        }
      }
    }
  }
}
export async function processIdentity(pid = process.pid) {
  try {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const selfText = await readFile('/proc/self/stat', 'utf8');
    const selfPid = Number(selfText.slice(0, selfText.indexOf(' ')));
    const parse = text => {
      const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
      return fields[0] === 'Z' ? null : fields[19] ?? null;
    };
    if (pid === process.pid) return parse(selfText);
    if (selfPid === process.pid) return parse(await readFile('/proc/' + pid + '/stat', 'utf8'));
    const selfStatus = await readFile('/proc/self/status', 'utf8');
    const ownIds = selfStatus.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/);
    if (!ownIds) return null;
    const depth = ownIds.length - 1, pending = [selfPid], visited = new Set();
    // Only resolve this process's descendants. A receiving server in a
    // different namespace relies on the original kernel lease and stop file.
    while (pending.length && visited.size < 256) {
      const parent = pending.shift();
      if (visited.has(parent)) continue;
      visited.add(parent);
      let children;
      try { children = (await readFile('/proc/' + parent + '/task/' + parent + '/children', 'utf8')).trim().split(/\s+/).filter(Boolean); }
      catch { continue; }
      for (const child of children) {
        try {
          const status = await readFile('/proc/' + child + '/status', 'utf8');
          const ids = status.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/);
          if (ids && Number(ids[depth]) === pid)
            return parse(await readFile('/proc/' + child + '/stat', 'utf8'));
          pending.push(Number(child));
        } catch {}
      }
    }
    return null;
  } catch { return null; }
}
export async function workerAlive(state) {
  return Number.isInteger(state?.pid) && typeof state?.processStart === 'string' &&
    await processIdentity(state.pid) === state.processStart;
}
async function runFlock(fileDescriptor, shared = false) {
  const started = Date.now();
  return new Promise(resolve => {
    let child, error = null, stderr = Buffer.alloc(0), stderrTruncated = false;
    let timedOut = false, timeout = null, terminate = null;
    const errorDetails = value => value ? {
      code: value.code ?? null, errno: value.errno ?? null,
      syscall: value.syscall ?? null, message: String(value.message ?? value).slice(0, 512),
    } : null;
    const finish = (status, signal) => {
      if (timeout) clearTimeout(timeout);
      if (terminate) clearTimeout(terminate);
      resolve({ status, signal, error: errorDetails(error), timedOut,
        stderr: stderr.toString('utf8'), stderrTruncated, elapsedMs: Date.now() - started });
    };
    try {
      child = spawn('flock', [shared ? '--shared' : '--exclusive', '--nonblock', '--conflict-exit-code', '75', '3'],
        { stdio: ['ignore', 'ignore', 'pipe', fileDescriptor] });
    } catch (failure) {
      error = failure; finish(null, null); return;
    }
    child.on('error', failure => { error ??= failure; });
    child.stderr?.on('data', bytes => {
      const remaining = Math.max(0, 1024 - stderr.length);
      if (bytes.length > remaining) stderrTruncated = true;
      if (remaining) stderr = Buffer.concat([stderr, bytes.subarray(0, remaining)]);
    });
    child.stderr?.on('error', failure => { error ??= failure; });
    // close follows process exit and drained stdio. Never release or retry the
    // inherited open-file description while its original child can still run.
    child.once('close', finish);
    timeout = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch (failure) { error ??= failure; }
      terminate = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (failure) { error ??= failure; }
      }, 250);
    }, 5000);
  });
}

/** Preserve only the original bounded flock receipt in public/private error projections. */
export function runtimeWorkspaceError(error, fallbackCode = 'RUNTIME_WORKSPACE_ERROR', messageLimit = 2000) {
  const result = { code: error.code ?? fallbackCode, message: String(error.message ?? error).slice(0, messageLimit) };
  if (!['RUNTIME_WORKSPACE_OPERATION_RUNNING', 'RUNTIME_WORKSPACE_FLOCK_UNAVAILABLE', 'RUNTIME_WORKSPACE_BACKUP_BUSY'].includes(result.code)) return result;
  try {
    const attempts = error.flock?.attempts;
    const nullableText = (value, maximum) => value === null || typeof value === 'string' && value.length <= maximum;
    const validError = value => value === null || plain(value) &&
      nullableText(value.code, 128) && (value.errno === null || typeof value.errno === 'string' && value.errno.length <= 128 ||
        Number.isSafeInteger(value.errno)) && nullableText(value.syscall, 256) && typeof value.message === 'string' &&
      value.message.length <= 512;
    const validAttempt = value => plain(value) &&
      (value.status === null || Number.isSafeInteger(value.status)) && nullableText(value.signal, 64) &&
      validError(value.error) && typeof value.timedOut === 'boolean' && typeof value.stderr === 'string' &&
      value.stderr.length <= 1024 && typeof value.stderrTruncated === 'boolean' && Number.isSafeInteger(value.elapsedMs);
    if (Array.isArray(attempts) && attempts.length >= 1 && attempts.length <= 2 && attempts.every(validAttempt)) {
      result.flock = { attempts: attempts.map(value => ({
        status: value.status, signal: value.signal,
        error: value.error === null ? null : { code: value.error.code, errno: value.error.errno,
          syscall: value.error.syscall, message: value.error.message },
        timedOut: value.timedOut, stderr: value.stderr, stderrTruncated: value.stderrTruncated,
        elapsedMs: value.elapsedMs,
      })) };
    }
  } catch { /* Keep the original error if optional diagnostics cannot be projected. */ }
  return result;
}

export async function operationLease(path) {
  // Even a status probe may create its empty worker inode. Join the workspace
  // gate for that acquisition; its existing operation lease remains authoritative.
  try { return await fileLease(path, { create: false }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return withRecordWrite(path, () => fileLease(path), { allowReceiving: true });
}
async function fileLease(path, { shared = false, workspace = false, create = true } = {}) {
  const handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW |
    (create ? constants.O_CREAT : 0), 0o600);
  try {
    const info = await handle.stat(), named = await lstat(path);
    need(info.isFile() && info.nlink === 1 && !(info.mode & 0o077) &&
      info.dev === named.dev && info.ino === named.ino &&
      (process.getuid === undefined || info.uid === process.getuid()), 'RUNTIME_WORKSPACE_LEASE_INVALID');
    const attempts = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await runFlock(handle.fd, shared);
      attempts.push(result);
      if (!result.error && result.status === 0) return handle;
      if (result.status === 75) {
        throw Object.assign(new Error(workspace ?
          'A workspace write or backup is active; reopen its retained operation before retrying.' : 'RUNTIME_WORKSPACE_OPERATION_RUNNING'), {
          code: workspace ? 'RUNTIME_WORKSPACE_BACKUP_BUSY' : 'RUNTIME_WORKSPACE_OPERATION_RUNNING',
          status: workspace ? 409 : 400, flock: { attempts },
        });
      }
      const transient = result.timedOut || ['EAGAIN', 'EINTR', 'ENOMEM'].includes(result.error?.code);
      if (!transient || attempt === 1) {
        throw Object.assign(new Error('The original native flock process failed: ' + JSON.stringify(attempts)), {
          code: 'RUNTIME_WORKSPACE_FLOCK_UNAVAILABLE', status: 400, flock: { attempts },
        });
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error) { await handle.close(); throw error; }
}
// The existing kernel lease remains authoritative when a container's mounted
// /proc does not expose its inner PID namespace.
export async function operationRunning(path) {
  let lease;
  try { lease = await operationLease(path); return false; }
  catch (error) { if (error.code === 'RUNTIME_WORKSPACE_OPERATION_RUNNING') return true; throw error; }
  finally { if (lease) await lease.close(); }
}
export async function tailFile(path, maximum = 65536) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    need(info.isFile(), 'RUNTIME_WORKSPACE_LOG_INVALID');
    const start = Math.max(0, info.size - maximum), bytes = Buffer.alloc(Math.min(info.size, maximum));
    const read = await handle.read(bytes, 0, bytes.length, start);
    return { text: bytes.subarray(0, read.bytesRead).toString('utf8'), totalBytes: info.size, offset: start };
  } finally { await handle.close(); }
}


// Each original writer holds a shared flock for its complete mutation. A cold
// snapshot or receiving transaction takes the same inode exclusively. Nested
// model calls reuse that open-file description; siblings keep separate leases.
const workspaceLeases = new AsyncLocalStorage();
const RECEIVING_SCHEMA = 'stellar-forge.runtime-workspace-receiving.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
export async function workspaceReceivingState(directory) {
  const root = absolute(directory);
  const marker = await readJSON(join(root, '.workspace-backup-receiving.json'), true);
  if (!marker) return null;
  const config = await readJSON(join(root, 'workspace.json'), true);
  need(plain(marker) && marker.schema === RECEIVING_SCHEMA && marker.directory === root &&
    UUID.test(marker.workspaceId ?? '') && UUID.test(marker.receivingId ?? '') &&
    marker.operationId === marker.receivingId &&
    HASH.test(marker.archiveId ?? '') && marker.archiveId === marker.archiveSha256 &&
    HASH.test(marker.manifestSha256 ?? '') && marker.launchesStarted === 0 &&
    (marker.phase !== 'BINDINGS_REVIEWED' || plain(marker.bindingReview) &&
      UUID.test(marker.bindingReview.reviewId ?? '') && HASH.test(marker.bindingReview.reviewSha256 ?? '')) &&
    ['RESTORING', 'BINDINGS_REVIEW_REQUIRED', 'BINDINGS_REVIEWED'].includes(marker.phase) &&
    (config ? config.schema === 'stellar-forge.runtime-workspace.v1' &&
      config.workspaceId === marker.workspaceId && config.directory === (marker.mode === 'new-host' ? marker.originalDirectory : root) : marker.phase === 'RESTORING'),
  'RUNTIME_WORKSPACE_RECEIVING_INVALID', 'The retained receiving identity does not match this workspace.', 409);
  absolute(marker.storageDirectory);
  if (marker.mode !== undefined) {
    need(marker.mode === 'new-host' && plain(marker.receivedHistory), 'RUNTIME_WORKSPACE_RECEIVING_INVALID');
    absolute(marker.originalDirectory); absolute(marker.sourceDirectory);
    need(Array.isArray(marker.nestedWorkspaces ?? []) && (marker.nestedWorkspaces ?? []).every(item =>
      plain(item) && typeof item.path === 'string' && item.path && !item.path.startsWith('/') &&
      !item.path.split('/').some(part => !part || part === '.' || part === '..') &&
      UUID.test(item.workspaceId) && absolute(item.originalDirectory)), 'RUNTIME_WORKSPACE_RECEIVING_INVALID');
    const history = marker.receivedHistory;
    for (const name of ['operations', 'runtimes', 'managedHomes'])
      need(Array.isArray(history[name]) && new Set(history[name]).size === history[name].length &&
        history[name].every(id => (name === 'operations' ? UUID : /^[a-f0-9]{24}$/).test(id)),
        'RUNTIME_WORKSPACE_RECEIVING_INVALID');
    need(plain(history.applications) && Object.entries(history.applications).every(([id, sha]) =>
      /^[a-f0-9]{24}$/.test(id) && HASH.test(sha)), 'RUNTIME_WORKSPACE_RECEIVING_INVALID');
    if (marker.phase === 'BINDINGS_REVIEWED') {
      const binding = marker.hostBindings;
      need(plain(binding) && typeof binding.actor === 'string' && typeof binding.note === 'string' &&
        Array.isArray(binding.runtimes) && Array.isArray(marker.runtimeEntries), 'RUNTIME_WORKSPACE_RECEIVING_INVALID');
      absolute(binding.runtimeHome);
      need(new Set(binding.runtimes.map(item => item.runtimeId)).size === binding.runtimes.length &&
        binding.runtimes.every(item => history.runtimes.includes(item.runtimeId) && absolute(item.directory) &&
          marker.runtimeEntries.some(row => row.runtimeId === item.runtimeId && row.directory === item.directory &&
            row.status === 'PRESENT' && row.sourceVerified === true)),
      'RUNTIME_WORKSPACE_RECEIVING_INVALID');
    }
  }
  return marker;
}

// Receiving changes only active selections. Original records and their absolute
// paths remain readable without transformation.
export async function receivedOperation(root, id) {
  operationId(id);
  const marker = await workspaceReceivingState(root);
  return marker?.mode === 'new-host' && marker.receivedHistory.operations.includes(id) ? marker : null;
}
export async function requireCurrentOperation(root, id) {
  need(!await receivedOperation(root, id), 'RUNTIME_WORKSPACE_RECEIVED_HISTORY',
    'This imported request is retained history. Review current inputs and prepare a new request on this host; the original UUID and state remain unchanged.', 409);
}
export async function receivedApplication(root, id, value = null) {
  recordId(id);
  const marker = await workspaceReceivingState(root), expected = marker?.receivedHistory?.applications?.[id];
  if (marker?.mode !== 'new-host' || !expected) return false;
  // Compare the exact archived head bytes; a normal reviewed Save creates its
  // successor through the existing writer, retaining this revision.
  return digest(await regular(join(root, 'applications', id, 'application.json'))) === expected;
}
export async function requireCurrentApplication(root, id) {
  need(!await receivedApplication(root, id), 'APPLICATION_HOST_REVIEW_REQUIRED',
    'Review and save this received application against current runtime and data paths before connecting or starting it. Original settings and runs remain in history.', 409);
}
export async function receivedManagedHome(root, id) {
  const marker = await workspaceReceivingState(root);
  return marker?.mode === 'new-host' && marker.receivedHistory.managedHomes.includes(recordId(id)) ? marker : null;
}
export async function currentRuntimeEntry(root, value, required = true) {
  const marker = await workspaceReceivingState(root);
  if (marker?.mode !== 'new-host' || !marker.receivedHistory.runtimes.includes(value.id)) return value;
  const selected = marker.phase === 'BINDINGS_REVIEWED' ?
    marker.hostBindings.runtimes.find(item => item.runtimeId === value.id) : null;
  if (!selected) {
    need(!required, 'RUNTIME_WORKSPACE_HOST_BINDING_REQUIRED',
      'This original runtime has no current-host binding. Select and review its recovered runtime, or attach a current installation through the existing Runtime operator.', 409);
    return { ...value, originalDirectory: value.directory, directory: null, receivedHistory: true,
      phase: 'UNBOUND', hostBindingRequired: true };
  }
  return { ...value, originalDirectory: value.directory, directory: selected.directory,
    receivingId: marker.receivingId, bindingReview: marker.bindingReview };
}

async function requireWorkspaceWritable(root) {
  const marker = await workspaceReceivingState(root);
  need(!marker || marker.phase === 'BINDINGS_REVIEWED', 'RUNTIME_WORKSPACE_BINDINGS_REVIEW_REQUIRED',
    'Finish the retained workspace restore and review its original runtime and application bindings before starting work.', 409);
}
export function workspaceLeaseDescriptor(directory) {
  const root = absolute(directory), current = workspaceLeases.getStore()?.get(root);
  need(current?.active === true, 'RUNTIME_WORKSPACE_WRITE_LEASE_REQUIRED');
  return current.handle.fd;
}
async function withWorkspaceLease(directory, callback, { exclusive = false, allowReceiving = false } = {}) {
  const root = await privateDirectory(absolute(directory));
  const inherited = workspaceLeases.getStore(), current = inherited?.get(root);
  if (current?.active) {
    need(!exclusive || current.exclusive, 'RUNTIME_WORKSPACE_LEASE_UPGRADE_INVALID',
      'Start workspace backup outside an existing workspace write.', 409);
    if (!allowReceiving && !current.exclusive) await requireWorkspaceWritable(root);
    return callback();
  }
  const handle = await fileLease(join(root, '.workspace-backup.lock'),
    { shared: !exclusive, workspace: true });
  const held = { handle, exclusive, active: true }, scope = new Map(inherited ?? []);
  scope.set(root, held);
  try {
    return await workspaceLeases.run(scope, async () => {
      if (!allowReceiving) await requireWorkspaceWritable(root);
      return callback();
    });
  } finally {
    held.active = false;
    await handle.close();
  }
}
async function withWorkspaceHierarchy(directory, callback, options) {
  const root = absolute(directory);
  const roots = [...new Set([...await recordWorkspaceRoots(join(root, 'workspace.json')), root])]
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
  const enter = index => index === roots.length ? callback() :
    withWorkspaceLease(roots[index], () => enter(index + 1), options);
  return enter(0);
}
export function withWorkspaceWrite(directory, callback, options = {}) {
  return withWorkspaceHierarchy(directory, callback, { allowReceiving: options.allowReceiving === true });
}
export function withWorkspaceBackup(directory, callback) {
  return withWorkspaceHierarchy(directory, callback, { exclusive: true, allowReceiving: true });
}
async function recordWorkspaceRoots(path) {
  const absolutePath = resolve(path), roots = new Set();
  // Include containing workspaces as well as a nested workspace. The same
  // deterministic outer-first order is used by every direct record writer.
  for (const [root, lease] of workspaceLeases.getStore() ?? []) {
    if (lease.active && absolutePath.startsWith(root + sep)) roots.add(root);
  }
  let directory = dirname(absolutePath);
  while (true) {
    const config = await readJSON(join(directory, 'workspace.json'), true);
    if (config?.schema === 'stellar-forge.runtime-workspace.v1' && config.directory === directory ||
      await workspaceReceivingState(directory)) roots.add(directory);
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return [...roots].sort((left, right) => left.length - right.length || left.localeCompare(right));
}
async function withRecordWrite(path, callback, options = {}) {
  const roots = await recordWorkspaceRoots(path);
  for (const root of roots) {
    const relative = resolve(path).slice(root.length + 1);
    const receiving = await workspaceReceivingState(root);
    need(!(receiving?.nestedWorkspaces ?? []).some(item => relative === item.path || relative.startsWith(item.path + '/')),
      'RUNTIME_WORKSPACE_NESTED_RECEIVING_REQUIRED',
      'This nested Runtime workspace is retained imported history. Use its own original workspace receiving at a separately selected destination before changing or starting it.', 409);
    const match = /^operations\/([a-f0-9-]{36})(?:\/|$)/.exec(relative);
    if (match) await requireCurrentOperation(root, match[1]);
  }
  const enter = index => index === roots.length ? callback() :
    withWorkspaceWrite(roots[index], () => enter(index + 1), options);
  return enter(0);
}
