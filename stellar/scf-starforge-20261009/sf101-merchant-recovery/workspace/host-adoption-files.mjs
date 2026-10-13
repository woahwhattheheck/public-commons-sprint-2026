// MIT. Resumable SF101 cold adoption under the existing SF98 lease.
// The caller retains native authentication, quiescence, final modes and workspace reopen.
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { acquireDeliveryLease, assertDeliveryLease, deliveryLeaseDescriptor } from '../../sf98-merchant-delivery/delivery-lock.mjs';
import { canonical, identity } from '../../sf30-seller-sdk/postgres/publisher/files.mjs';

export const HOST_ADOPTION_SCHEMA = 'stellar-forge.host-adoption-operation.v1';
export const HOST_ADOPTION_LIMITS = Object.freeze({ jsonBytes: 32 * 1024 * 1024,
  responseBytes: 64 * 1024 * 1024, entries: 10000, roots: 128, fileBytes: 2 * 1024 ** 3 });
const helper = fileURLToPath(new URL('./host-adoption-files.py', import.meta.url));
const HASH = /^[0-9a-f]{64}$/, NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const issue = code => Object.assign(new Error(code), { code, status: 409 });
const need = (value, code) => { if (!value) throw issue(code); };
const canonicalText = value => JSON.stringify(canonical(value));
const overlap = (a, b) => a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
function path(value) {
  need(typeof value === 'string' && value.length <= 4096 && isAbsolute(value) && resolve(value) === value &&
    value !== '/' && !value.includes('\0') && !value.startsWith('//'), 'HOST_ADOPTION_ABSOLUTE_PATH_REQUIRED');
  return value;
}
function pythonPath(value = '/usr/bin/python3') { return path(value); }
function selected(input) {
  const directory = path(input.directory), binding = clone(input.binding), roots = clone(input.roots);
  need(object(binding) && binding.adoption?.directory === directory &&
    Array.isArray(roots) && roots.length > 0 && roots.length <= HOST_ADOPTION_LIMITS.roots &&
    canonicalText(roots) === canonicalText(binding.roots), 'HOST_ADOPTION_BINDING_INVALID');
  const names = new Set(), controlled = [];
  for (const root of roots) {
    need(object(root) && NAME.test(root.name ?? '') && !names.has(root.name) &&
      ['file','directory'].includes(root.kind), 'HOST_ADOPTION_ROOT_INVALID');
    names.add(root.name); controlled.push(path(root.destination), path(root.restored));
  }
  need(Array.isArray(input.reservedPaths), 'HOST_ADOPTION_RESERVED_PATHS_REQUIRED');
  const reservedPaths = [...new Set([...input.reservedPaths.map(path), ...controlled])].sort();
  need(reservedPaths.every(value => !overlap(directory, value)), 'HOST_ADOPTION_CONTROL_OVERLAP');
  const python = pythonPath(input.python ?? binding.adoption?.python);
  need(!binding.adoption?.python || python === binding.adoption.python, 'HOST_ADOPTION_PYTHON_CHANGED');
  return { directory, binding, bindingJSON: canonicalText(binding), roots, reservedPaths,
    reviewSha256: identity(binding), python };
}
function infoIdentity(info) { return { dev: String(info.dev), ino: String(info.ino) }; }
async function checkedDirectory(directory, expected = null) {
  const info = await lstat(directory, { bigint: true });
  need(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o777n) === 0o700n &&
    info.uid === BigInt(process.geteuid()) && await realpath(directory) === directory,
    'HOST_ADOPTION_PRIVATE_DIRECTORY_REQUIRED');
  const found = infoIdentity(info);
  need(!expected || found.dev === expected.dev && found.ino === expected.ino, 'HOST_ADOPTION_DIRECTORY_REPLACED');
  return found;
}
async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function createDirectory(directory) {
  const parent = dirname(directory), before = await lstat(parent, { bigint: true });
  need(before.isDirectory() && !before.isSymbolicLink() && await realpath(parent) === parent,
    'HOST_ADOPTION_CANONICAL_PARENT_REQUIRED');
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const result = await checkedDirectory(directory), after = await lstat(parent, { bigint: true });
  need(before.dev === after.dev && before.ino === after.ino && await realpath(parent) === parent,
    'HOST_ADOPTION_PARENT_REPLACED');
  // Also flush an existing same-operation directory after an interrupted mkdir.
  await syncDirectory(directory); await syncDirectory(parent);
  await checkedDirectory(directory, result);
  return result;
}
async function worker(input, { python, signal, lease = null, directoryIdentity = null } = {}) {
  need(process.platform === 'linux', 'HOST_ADOPTION_REQUIRES_LINUX');
  need(!signal?.aborted, 'HOST_ADOPTION_ABORTED');
  const raw = Buffer.from(JSON.stringify({ ...input, ...(directoryIdentity ? { directoryIdentity } : {}) }));
  need(raw.length <= HOST_ADOPTION_LIMITS.jsonBytes, 'HOST_ADOPTION_INPUT_LIMIT');
  let inherited = 'ignore';
  if (lease) inherited = await deliveryLeaseDescriptor(lease, input.directory);
  need(!signal?.aborted, 'HOST_ADOPTION_ABORTED');
  return await new Promise((resolvePromise, rejectPromise) => {
    let child, cause = null, timer = null, length = 0, stderr = 0;
    const chunks = [];
    const stop = error => {
      if (!cause) cause = error;
      if (!child) return;
      child.kill('SIGTERM');
      if (!timer) timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    };
    const aborted = () => stop(issue('HOST_ADOPTION_ABORTED'));
    try {
      child = spawn(pythonPath(python), [helper, String(process.pid)], {
        shell: false, stdio: ['pipe','pipe','pipe',inherited], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
      });
    } catch (error) { rejectPromise(error); return; }
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
    child.once('error', error => { cause ??= error; });
    child.stdout.on('data', chunk => {
      length += chunk.length;
      if (length > HOST_ADOPTION_LIMITS.responseBytes) stop(issue('HOST_ADOPTION_RESPONSE_LIMIT'));
      else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.length;
      if (stderr > 65536) stop(issue('HOST_ADOPTION_STDERR_LIMIT'));
    });
    child.stdin.on('error', error => stop(error));
    child.once('close', (code, killedBy) => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      if (cause) { rejectPromise(cause); return; }
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length))); }
      catch { rejectPromise(issue('HOST_ADOPTION_WORKER_RESPONSE_INVALID')); return; }
      if (!object(value) || !value.ok || code !== 0 || killedBy) {
        rejectPromise(issue(typeof value?.code === 'string' ? value.code : 'HOST_ADOPTION_WORKER_FAILED')); return;
      }
      resolvePromise(value.value);
    });
    child.stdin.end(raw);
  });
}
function readonlyInput(input) {
  need(HASH.test(input.expectedReviewSha256 ?? ''), 'HOST_ADOPTION_REVIEW_REQUIRED');
  return { directory: path(input.directory), reviewSha256: input.expectedReviewSha256 };
}
export async function readHostAdoption(input = {}) {
  return await worker({ ...readonlyInput(input), action: 'read' },
    { python: pythonPath(input.python), signal: input.signal });
}
export async function inspectHostAdoption(input = {}) {
  const choice = selected(input);
  const result = await worker({ directory: choice.directory, reviewSha256: choice.reviewSha256, action: 'inspect' },
    { python: choice.python, signal: input.signal });
  if (result.status !== 'ABSENT') need(canonicalText(result.binding) === choice.bindingJSON &&
    canonicalText(result.roots) === canonicalText(choice.roots), 'HOST_ADOPTION_BINDING_CHANGED');
  return result;
}
export async function openHostAdoption(input = {}) {
  const choice = selected(input), shutdown = new AbortController();
  const signal = input.signal ? AbortSignal.any([shutdown.signal, input.signal]) : shutdown.signal;
  need(!signal.aborted, 'HOST_ADOPTION_ABORTED');
  const directoryIdentity = await createDirectory(choice.directory);
  need(!signal.aborted, 'HOST_ADOPTION_ABORTED');
  const lease = await acquireDeliveryLease(choice.directory, { purpose: 'drain' });
  let closed = false, tail = Promise.resolve(), closing = null;
  async function current() {
    need(!closed && !signal.aborted, 'HOST_ADOPTION_ABORTED');
    await checkedDirectory(choice.directory, directoryIdentity);
    await assertDeliveryLease(lease, choice.directory);
    need(!closed && !signal.aborted, 'HOST_ADOPTION_ABORTED');
  }
  function invoke(action, extra = {}) {
    if (closed) return Promise.reject(issue('HOST_ADOPTION_CLOSED'));
    // Freeze caller data before queued asynchronous work or filesystem access.
    const request = clone({ action, directory: choice.directory, reviewSha256: choice.reviewSha256, ...extra });
    const run = tail.then(async () => {
      await current();
      const value = await worker(request, { python: choice.python, signal, lease, directoryIdentity });
      await current();
      return clone(value);
    });
    tail = run.catch(() => {});
    return run;
  }
  async function close() {
    if (closing) return closing;
    closed = true; shutdown.abort();
    closing = (async () => { try { await tail; } finally { await lease.release(); } })();
    return closing;
  }
  try {
    await invoke('prepare', { bindingJSON: choice.bindingJSON, roots: choice.roots, reservedPaths: choice.reservedPaths });
  } catch (error) { await close(); throw error; }
  function rootSelection(root) {
    const value = clone(root);
    need(choice.roots.some(row => canonicalText(row) === canonicalText(value)), 'HOST_ADOPTION_ROOT_CHANGED');
    return value;
  }
  return Object.freeze({
    inspectRoot: root => invoke('inspectRoot', { root: rootSelection(root) }),
    publishRoot: (root, { entries } = {}) => {
      need(Array.isArray(entries) && entries.length > 0 && entries.length <= HOST_ADOPTION_LIMITS.entries,
        'HOST_ADOPTION_ENTRIES_LIMIT');
      const retained = clone(entries);
      return invoke('publish', { root: rootSelection(root), entriesJSON: canonicalText(retained),
        entriesSha256: identity(retained) });
    },
    readResult: async () => (await invoke('read')).result,
    complete: result => {
      need(object(result) && result.reviewSha256 === choice.reviewSha256 &&
        result.status === 'HOST_HANDOFF_ADOPTED', 'HOST_ADOPTION_RESULT_INVALID');
      return invoke('complete', { result });
    },
    close
  });
}
