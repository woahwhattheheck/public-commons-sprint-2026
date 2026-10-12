// MIT. Installed lifecycle for the original Water project and native DSS workspace.
import { constants } from 'node:fs';
import { open, lstat, realpath, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { absolute, privateDirectory, makePrivate, operationLease, processIdentity,
  saveJSON, plain, canonical, json, digest, need } from '../../distribution/runtime-workspace/storage.mjs';

export const WATER_MANAGED_STARTUP = 'stellar-forge.usgs-water-workspace-launch.v1';
export const WATER_MANAGED_PROBE = 'stellar-forge.usgs-water-workspace-listener.v1';
export const WATER_MANAGED_FILE = 'managed-workspace.json';
const PROJECT = 'starforge.usgs-water-project.v1';
const INPUTS = 'stellar-forge.usgs-water-workspace-inputs.v1';
const hash = value => digest(json(canonical(value)));
const same = (a, b) => hash(a) === hash(b);
const owned = info => process.getuid === undefined || info.uid === process.getuid();

/** Read one original private record without changing its project or buyer state. */
export async function readWaterManagedRecord(path, maximum = 2 * 1024 * 1024) {
  path = absolute(path);
  need(await realpath(dirname(path)) === dirname(path), 'WATER_MANAGED_REAL_PARENT_REQUIRED');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    need(before.isFile() && before.nlink === 1 && !(before.mode & 0o077) && owned(before) &&
      before.size <= maximum, 'WATER_MANAGED_PRIVATE_RECORD_REQUIRED');
    const bytes = await file.readFile(), after = await file.stat();
    need(bytes.length === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs, 'WATER_MANAGED_RECORD_CHANGED');
    return { path, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      bytes, sha256: digest(bytes) };
  } finally { await file.close(); }
}
async function folderIdentity(directory, optional) {
  directory = absolute(directory);
  let info;
  try { await privateDirectory(directory); info = await lstat(directory); }
  catch (error) {
    if (!optional || error.code !== 'ENOENT') throw error;
    const parent = await privateDirectory(dirname(directory)), existing = await lstat(parent);
    return { path: directory, new: true, parent: { path: parent, device: String(existing.dev), inode: String(existing.ino) } };
  }
  return { path: directory, new: false, device: String(info.dev), inode: String(info.ino) };
}
async function pythonIdentity(executable) {
  if (!executable) return null;
  executable = absolute(executable);
  need(await realpath(dirname(executable)) === dirname(executable), 'WATER_MANAGED_REAL_PARENT_REQUIRED');
  const target = await realpath(executable), file = await open(target, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await file.stat({ bigint: true });
    need(info.isFile(), 'WATER_MANAGED_PYTHON_EXECUTABLE_REQUIRED');
    await access(executable, constants.X_OK);
    return { executable, target, device: String(info.dev), inode: String(info.ino), bytes: String(info.size),
      mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs) };
  } finally { await file.close(); }
}
/** The original selection, buyer file and host-selected interpreter are the launch inputs. */
export async function reviewWaterManagedInputs({ directory, buyerConfiguration, nativePython, optional = false } = {}) {
  const folder = await folderIdentity(directory, optional);
  let project = null, buyer = null;
  if (!folder.new) {
    try {
      const original = await readWaterManagedRecord(join(folder.path, 'project.json')), value = original.value;
      need(plain(value) && value.schema === PROJECT && Number.isSafeInteger(value.revision) && value.revision > 0 &&
        typeof value.title === 'string' && value.title.length <= 200 &&
        value.selectionSha256 === digest(json(value.selection)), 'WATER_MANAGED_PROJECT_CHANGED');
      project = { path: original.path, sha256: original.sha256, revision: value.revision,
        title: value.title, selectionSha256: value.selectionSha256 };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (buyerConfiguration) {
    const original = await readWaterManagedRecord(absolute(buyerConfiguration));
    need(plain(original.value), 'WATER_MANAGED_BUYER_CONFIGURATION_REQUIRED');
    buyer = { path: original.path, sha256: original.sha256 };
  }
  const python = await pythonIdentity(nativePython);
  const value = { schema: INPUTS, directory: folder, project, buyer, nativePython: python };
  return { ...value, sha256: hash(value) };
}
function sameRetainedSelection(selected, current) {
  const { directory: before, sha256: a, ...left } = selected;
  const { directory: after, sha256: b, ...right } = current;
  need(same(left, right) && before.path === after.path &&
    (before.new || same(before, after)), 'WATER_MANAGED_INPUTS_CHANGED',
  'Review the current saved Water project and host inputs before starting.');
}
export function waterManagedUrl(value, port = 0) {
  let url; try { url = new URL(value); } catch { need(false, 'WATER_MANAGED_URL_INVALID'); }
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/' &&
    !url.username && !url.password && !url.search && !url.hash &&
    Number(url.port || 80) > 0 && Number(url.port || 80) <= 65535 &&
    (!port || Number(url.port || 80) === port), 'WATER_MANAGED_URL_INVALID');
  return url.href;
}
function selectedPort(value) {
  const port = value === undefined ? 0 : Number(value);
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'WATER_MANAGED_PORT_INVALID');
  return port;
}
function selectedFacilitator(value) {
  if (!value) return null;
  let url; try { url = new URL(value); } catch { need(false, 'WATER_MANAGED_FACILITATOR_INVALID'); }
  need(!url.username && !url.password && !url.search && !url.hash &&
    (url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)),
  'WATER_MANAGED_FACILITATOR_INVALID');
  return value;
}

/** Start and stop the original server; the existing kernel lease owns this launch. */
export async function startManagedWaterWorkspace({ directory, buyerConfiguration, nativePython, port = 0,
  merchantPort = 0, facilitator, expectedInputsSha256, expectedProjectSha256,
  env = process.env, signal } = {}) {
  directory = absolute(directory); port = selectedPort(port); merchantPort = selectedPort(merchantPort);
  facilitator = selectedFacilitator(facilitator);
  signal?.throwIfAborted();
  const selected = await reviewWaterManagedInputs({ directory, buyerConfiguration, nativePython, optional: true });
  if (expectedInputsSha256 !== undefined) need(expectedInputsSha256 === selected.sha256,
    'WATER_MANAGED_INPUTS_CHANGED', 'Review the current original inputs before starting.');
  if (expectedProjectSha256 !== undefined) need(expectedProjectSha256 === (selected.project?.sha256 ?? 'empty'),
    'WATER_MANAGED_PROJECT_CHANGED', 'Review the current saved Water selection before starting.');
  signal?.throwIfAborted();
  let lease, workspace, ready, closing, abortHandler;
  const close = () => closing ??= (async () => {
    if (abortHandler) signal?.removeEventListener('abort', abortHandler);
    try {
      await workspace?.close();
      if (ready) await saveJSON(join(directory, WATER_MANAGED_FILE), {
        ...ready, status: 'STOPPED', stoppedAt: new Date().toISOString(),
      }, true);
      return { closed: true, launchId: ready?.launchId ?? null };
    } finally { await lease?.close(); }
  })();
  try {
    if (selected.directory.new) {
      const parent = await folderIdentity(dirname(directory), false);
      need(parent.device === selected.directory.parent.device && parent.inode === selected.directory.parent.inode,
        'WATER_MANAGED_PARENT_CHANGED');
      await makePrivate(directory);
    }
    lease = await operationLease(join(directory, 'managed-workspace.lock'));
    signal?.throwIfAborted();
    const current = await reviewWaterManagedInputs({ directory, buyerConfiguration, nativePython });
    sameRetainedSelection(selected, current);
    let buyer = null;
    if (current.buyer) {
      const original = await readWaterManagedRecord(current.buyer.path);
      need(original.sha256 === current.buyer.sha256, 'WATER_MANAGED_BUYER_CHANGED');
      const { Buyer } = await import('../../sf88-operator-buyer-cli/node/client.mjs');
      buyer = await new Buyer(original.value).ready();
    }
    signal?.throwIfAborted();
    const processStart = await processIdentity();
    need(processStart, 'WATER_MANAGED_PROCESS_IDENTITY_REQUIRED', 'Use the original Linux runtime.');
    const originalProcess = { pid: process.pid, ppid: process.ppid, start: processStart };
    const launchId = randomUUID();
    let listener;
    const { startWaterWorkspace } = await import('./workspace.mjs');
    workspace = await startWaterWorkspace({ directory, port, merchantPort, facilitator: facilitator ?? undefined,
      buyer, env: { ...env, ...(nativePython ? { USGS_HECDSS_PYTHON: nativePython } : {}) },
      application: () => listener });
    signal?.throwIfAborted();
    const observed = await reviewWaterManagedInputs({ directory, buyerConfiguration, nativePython });
    sameRetainedSelection(current, observed);
    const url = waterManagedUrl(workspace.url, port), address = workspace.server.address();
    need(address?.address === '127.0.0.1' && address.port === Number(new URL(url).port || 80),
      'WATER_MANAGED_LISTENER_CHANGED');
    listener = { schema: WATER_MANAGED_PROBE, launchId, process: originalProcess,
      directory, reviewedInputsSha256: selected.sha256, inputsSha256: observed.sha256 };
    ready = { schema: WATER_MANAGED_STARTUP, status: 'USGS_WATER_WORKSPACE_READY', launchId,
      url, process: originalProcess, reviewedInputsSha256: selected.sha256, inputs: observed,
      requested: { port, merchantPort, facilitator }, startedAt: new Date().toISOString() };
    await saveJSON(join(directory, WATER_MANAGED_FILE), ready, true);
    abortHandler = () => { close().catch(() => {}); };
    signal?.addEventListener('abort', abortHandler, { once: true });
    signal?.throwIfAborted();
    return { url, ready, workspace, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}

/** One compact startup line for the existing managed worker, with ordinary signal shutdown. */
export async function runManagedWaterWorkspace(options = {}) {
  const controller = new AbortController();
  let release, service;
  const stopped = new Promise(done => { release = done; });
  const stop = () => { controller.abort(new Error('The Water workspace was stopped.')); release(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    service = await startManagedWaterWorkspace({ ...options, signal: controller.signal });
    await new Promise((done, reject) => {
      process.stdout.write(JSON.stringify(service.ready) + '\n', error => error ? reject(error) : done());
    });
    await stopped;
    return await service.close();
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    await service?.close();
  }
}
