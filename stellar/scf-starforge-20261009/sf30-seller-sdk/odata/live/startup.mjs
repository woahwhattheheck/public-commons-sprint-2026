// MIT. Original OData workspace identity and structured native launch announcement.
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomic, digest, stable, SCHEMA, identifier, fault } from '../state.mjs';

export const ODATA_STARTUP = 'stellar-forge.odata-workspace-startup.v1';
export const ODATA_PROBE = 'stellar-forge.odata-workspace-listener.v1';
export const ODATA_LAUNCH_FILE = 'application-launch.json';
const HASH = /^[a-f0-9]{64}$/;
const PACKAGE_FILES = ['catalog.json', 'plan.json', 'seller-service.json', 'offers.json',
  'openapi.json', 'customer-query.json', 'request.json'];
const need = (value, message) => { if (!value) throw fault('ODATA_APPLICATION_CHANGED', message, 409); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function odataPrivateJson(path, maximum = 65536) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    need(info.isFile() && info.size <= maximum && !(info.mode & 0o077) &&
      (process.getuid === undefined || info.uid === process.getuid()), 'Use the original private OData file.');
    const bytes = await file.readFile();
    need(bytes.length <= maximum, 'The original OData file exceeds its supported size.');
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      sha256: digest(bytes), bytes: bytes.length };
  } finally { await file.close(); }
}

/** Workspace edits are mutable. Its creation identity and selected directory survive them. */
export async function odataWorkspaceIdentity(directory, { optional = false } = {}) {
  need(typeof directory === 'string' && directory === resolve(directory) && !directory.includes('\0'),
    'Use an absolute original OData workspace directory.');
  let info;
  try { info = await lstat(directory); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    await realpath(directory) === directory &&
    (process.getuid === undefined || info.uid === process.getuid()), 'Use a private regular OData workspace directory.');
  let original;
  try { original = await odataPrivateJson(join(directory, 'workspace.json'), 64 * 1024 * 1024); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  const value = original.value;
  need(value.schema === SCHEMA && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) &&
    Array.isArray(value.connections) && Array.isArray(value.plans), 'Select an original OData workspace.');
  const identity = { schema: SCHEMA, directory, createdAt: value.createdAt };
  return { ...identity, sha256: digest(stable(identity)) };
}

/** Bind one immutable original live profile and all seven package files. */
export async function odataLiveIdentity(directory, id) {
  identifier(id, 'live service ID');
  const root = join(directory, 'live', 'products', id), packageDirectory = join(root, 'package');
  for (const path of [root, packageDirectory]) {
    const info = await lstat(path);
    need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) && await realpath(path) === path,
      'Use the retained private OData live product.');
  }
  const original = await odataPrivateJson(join(root, 'profile.json'));
  const profile = original.value, manifest = await odataPrivateJson(join(packageDirectory, 'package.json'));
  need(profile.schema === 'stellar-forge.odata-live-profile.v1' && profile.id === id && HASH.test(profile.sourceBinding ?? '') &&
    manifest.value.schema === 'stellar-forge.odata-live-package.v1' && manifest.value.sourceBinding === profile.sourceBinding &&
    plain(manifest.value.files) && Object.keys(manifest.value.files).length === PACKAGE_FILES.length &&
    PACKAGE_FILES.every(name => Object.hasOwn(manifest.value.files, name)), 'The original OData live profile and package differ.');
  for (const name of PACKAGE_FILES) {
    const expected = manifest.value.files[name], actual = await odataPrivateJson(join(packageDirectory, name), 16 * 1024 * 1024);
    need(plain(expected) && expected.bytes === actual.bytes && expected.sha256 === actual.sha256,
      'The original OData live package changed: ' + name);
  }
  const identity = { id, sourceBinding: profile.sourceBinding, profileSha256: original.sha256,
    packageManifestSha256: manifest.sha256, packageDirectory, stateDirectory: join(root, 'runtime') };
  return { ...identity, sha256: digest(stable(identity)) };
}

export async function odataProcessIdentity(pid = process.pid) {
  need(Number.isSafeInteger(pid) && pid > 0, 'Use the original running OData process.');
  if (process.platform !== 'linux') {
    process.kill(pid, 0);
    return { pid, ppid: pid === process.pid ? process.ppid : null, start: null };
  }
  const raw = await readFile(pid === process.pid ? '/proc/self/stat' : '/proc/' + pid + '/stat', 'utf8');
  const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
  need(fields.length >= 20 && /^[0-9]+$/.test(fields[19]), 'The original OData process changed.');
  return { pid, ppid: pid === process.pid ? process.ppid : Number(fields[1]), start: fields[19] };
}

export async function prepareODataLaunch({ workspace, expectedIdentity, liveId, expectedLive } = {}) {
  const identity = await odataWorkspaceIdentity(workspace.directory);
  need(expectedIdentity === undefined || expectedIdentity === 'new' || identity.sha256 === expectedIdentity,
    'Reopen the selected original OData workspace.');
  const live = liveId ? await odataLiveIdentity(workspace.directory, liveId) : null;
  need(!expectedLive || live?.sha256 === expectedLive, 'The selected live service changed before launch.');
  if (live) need((await workspace.state()).liveProducts?.some(value => value.id === live.id && value.sourceBinding === live.sourceBinding),
    'The selected live service does not belong to this OData workspace.');
  return { workspace: identity, live };
}

/** Small original listener view; it does not copy catalogs, provider credentials or row pages. */
export async function odataWorkspaceProbe(workspace) {
  return { schema: ODATA_PROBE, workspace: await odataWorkspaceIdentity(workspace.directory),
    process: await odataProcessIdentity() };
}

export function odataLoopback(value, selectedPort = 0) {
  let url;
  try { url = new URL(value); } catch { need(false, 'Use the original OData loopback listener.'); }
  const port = Number(url.port || 80);
  need(typeof value === 'string' && value.length <= 4096 && url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    port >= 1 && port <= 65535 && (!selectedPort || port === selectedPort) &&
    !url.username && !url.password && !url.search && !url.hash && url.pathname === '/',
    'Use the original OData loopback listener.');
  return url.href;
}

/** Called by the original CLI after its workspace and optional live merchant are listening. */
export async function announceODataWorkspace({ workspace, server, launch, liveRuntime = null } = {}) {
  const current = await prepareODataLaunch({ workspace, expectedIdentity: launch.workspace.sha256,
    liveId: launch.live?.id, expectedLive: launch.live?.sha256 });
  const address = server.server.address();
  need(address && typeof address === 'object' && address.address === '127.0.0.1', 'The original OData workspace is not listening.');
  const url = odataLoopback(server.url, address.port);
  let live = null;
  if (current.live) {
    need(liveRuntime?.state === 'RUNNING' && typeof liveRuntime.mode === 'string', 'The selected OData live service is not running.');
    live = { ...current.live, mode: liveRuntime.mode, url: odataLoopback(liveRuntime.url),
      operationsUrl: odataLoopback(liveRuntime.operationsUrl) };
  } else need(liveRuntime === null, 'The running live service differs from the selected OData application.');
  const value = { schema: ODATA_STARTUP, status: 'ODATA_WORKSPACE_READY', launchId: randomUUID(),
    workspace: current.workspace, process: await odataProcessIdentity(), url, live };
  await atomic(join(workspace.directory, ODATA_LAUNCH_FILE), value);
  return value;
}
