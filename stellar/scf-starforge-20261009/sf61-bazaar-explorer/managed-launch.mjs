// MIT. Original Atlas launch identity for the maintained Applications lifecycle.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATLAS_WORKSPACE_SCHEMA } from './workspace.mjs';
import { InputError, need } from '../sf88-operator-buyer-cli/config.mjs';

export const ATLAS_LAUNCH_SCHEMA = 'stellar-forge.sf61.atlas-launch.v1';
const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const LAUNCH_FILE = '.atlas-application-launch.json';
const SOURCE_FILES = ['server.mjs', 'workspace.mjs', 'workspace-http.mjs', 'managed-launch.mjs'];
const RECEIVE_SCHEMA = 'stellar-forge.sf61.workspace-receive.v1';
const MODES = ['RETAINED_CATALOG_WORKSPACE', 'LOCAL_NONPAYABLE_SF44_FIXTURE',
  'ORIGINAL_SF60_DURABLE_CATALOG', 'PUBLIC_FACILITATOR_READ_ONLY'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value) + '\n');
const nativeId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(value);
function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    !value.includes('\0'), 'ATLAS_LAUNCH_ABSOLUTE_PATH_REQUIRED');
  return value;
}
function ownedPrivate(info) {
  return process.platform === 'win32' || !(info.mode & 0o077) &&
    (process.getuid === undefined || info.uid === process.getuid());
}
async function privateDirectory(directory) {
  absolute(directory);
  const info = await lstat(directory);
  need(info.isDirectory() && !info.isSymbolicLink() && ownedPrivate(info) &&
    await realpath(directory) === directory, 'ATLAS_PRIVATE_DIRECTORY_REQUIRED');
}
async function bytes(path, limit, { optional = false, privateOnly = true } = {}) {
  let file;
  try {
    need(await realpath(path) === path, 'ATLAS_LAUNCH_SYMLINK_REFUSED');
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const first = await file.stat();
    need(first.isFile() && first.size <= limit && (!privateOnly || ownedPrivate(first)),
      'ATLAS_LAUNCH_FILE_INVALID');
    const value = await file.readFile(), last = await file.stat();
    need(value.length === first.size && last.size === first.size &&
      first.mtimeMs === last.mtimeMs && first.ctimeMs === last.ctimeMs,
    'ATLAS_LAUNCH_FILE_CHANGED');
    return value;
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  } finally { await file?.close(); }
}
function decode(value, code) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
  catch { throw new InputError(code); }
}
async function sourceFiles(sourceDirectory) {
  need(await realpath(absolute(sourceDirectory)) === sourceDirectory, 'ATLAS_LAUNCH_SOURCE_CHANGED');
  return Object.fromEntries(await Promise.all(SOURCE_FILES.map(async name => [
    name, digest(await bytes(join(sourceDirectory, name), 4 * 1024 * 1024, { privateOnly: false })),
  ])));
}
function privateUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new InputError('ATLAS_LAUNCH_URL_INVALID'); }
  const port = Number(url.port || 80);
  need(typeof value === 'string' && value.length <= 4096 &&
    url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password &&
    url.pathname === '/' && !url.search && /^#[a-f0-9]{64}$/.test(url.hash) &&
    Number.isInteger(port) && port >= 1 && port <= 65535, 'ATLAS_LAUNCH_URL_INVALID');
  return url.href;
}
async function saveRecord(directory, value) {
  const path = join(directory, LAUNCH_FILE);
  // The original Atlas workspace lease owns this record's writer lifetime.
  await bytes(path, 65536, { optional: true });
  const temporary = join(directory, '.atlas-launch-write-' + randomUUID());
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(json(value)); await file.sync(); await file.close();
    await rename(temporary, path);
    if (process.platform !== 'win32') {
      const parent = await open(directory, constants.O_RDONLY);
      try { await parent.sync(); } finally { await parent.close(); }
    }
  } finally {
    await file.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Read identity for review without opening a writer or changing the workspace. */
export async function inspectAtlasWorkspace(directory) {
  await privateDirectory(directory);
  const manifestFile = join(directory, 'workspace.json');
  const [manifest, incoming, completed] = await Promise.all([
    bytes(manifestFile, 8 * 1024 * 1024, { optional: true }),
    bytes(join(directory, '.atlas-transfer-state.json'), 512 * 1024 * 1024, { optional: true }),
    bytes(join(directory, '.atlas-transfer-complete.json'), 65536, { optional: true }),
  ]);
  need(!completed || incoming, 'ATLAS_TRANSFER_STATE_INVALID');
  if (incoming) {
    const state = decode(incoming, 'ATLAS_TRANSFER_STATE_INVALID');
    const result = completed && decode(completed, 'ATLAS_TRANSFER_STATE_INVALID');
    need(result && state.schema === RECEIVE_SCHEMA && result.schema === RECEIVE_SCHEMA &&
      result.state === 'complete' && result.transferId === state.transferId &&
      result.workspaceId === state.workspaceId && result.fileCount === state.fileCount &&
      result.totalBytes === state.totalBytes, 'ATLAS_WORKSPACE_RECEIVING',
    'Continue the original workspace transfer before opening this directory');
  }
  if (!manifest) {
    need(!incoming && !completed, 'ATLAS_WORKSPACE_RECEIVING');
    need((await readdir(directory)).every(name => name.startsWith('.atlas-')),
      'ATLAS_WORKSPACE_DIRECTORY_NOT_EMPTY');
    return { directory, initialized: false, workspaceId: null, manifestFile, manifestSha256: null,
      transferFiles: [] };
  }
  const value = decode(manifest, 'ATLAS_WORKSPACE_INVALID');
  need(value?.schema === ATLAS_WORKSPACE_SCHEMA && nativeId(value.id) &&
    plain(value.captures) && plain(value.selections), 'ATLAS_WORKSPACE_INVALID');
  if (incoming) need(decode(incoming, 'ATLAS_TRANSFER_STATE_INVALID').workspaceId === value.id,
    'ATLAS_TRANSFER_STATE_INVALID');
  return { directory, initialized: true, workspaceId: value.id, manifestFile,
    manifestSha256: digest(manifest), captures: Object.keys(value.captures).length,
    selections: Object.keys(value.selections).length,
    transferFiles: incoming ? [join(directory, '.atlas-transfer-state.json'),
      join(directory, '.atlas-transfer-complete.json')] : [] };
}

/** Called only after the existing Atlas server owns its workspace and listener. */
export async function publishAtlasLaunch({ directory, sourceDirectory, source, sourceOrigin, url }) {
  need(MODES.includes(source), 'ATLAS_LAUNCH_SOURCE_INVALID');
  const selected = await inspectAtlasWorkspace(directory);
  need(selected.initialized, 'ATLAS_WORKSPACE_NOT_INITIALIZED');
  const selectedFiles = await sourceFiles(sourceDirectory);
  const launchedFiles = await sourceFiles(SOURCE_DIRECTORY);
  need(SOURCE_FILES.every(name => selectedFiles[name] === launchedFiles[name]), 'ATLAS_LAUNCH_SOURCE_CHANGED');
  const value = { schema: ATLAS_LAUNCH_SCHEMA, state: 'LISTENING',
    directory, workspaceId: selected.workspaceId, workspaceFileSha256: selected.manifestSha256,
    sourceDirectory, launchSourceDirectory: SOURCE_DIRECTORY, sourceFiles: launchedFiles, source,
    sourceOrigin: sourceOrigin ?? null, pid: process.pid, instanceId: randomUUID(),
    privateLaunch: join(directory, LAUNCH_FILE), url: privateUrl(url), startedAt: new Date().toISOString() };
  await saveRecord(directory, value);
  let closed = false;
  return {
    value,
    async retire() {
      if (closed) return;
      const current = decode(await bytes(value.privateLaunch, 65536), 'ATLAS_LAUNCH_RECORD_INVALID');
      need(current.instanceId === value.instanceId && current.pid === value.pid,
        'ATLAS_LAUNCH_INSTANCE_CHANGED');
      await saveRecord(directory, { ...current, state: 'STOPPING', url: null,
        stoppingAt: new Date().toISOString() });
      closed = true;
    },
  };
}

/** Read the original private launch; callers bind its source and process identity. */
export async function readAtlasLaunch({ directory, sourceDirectory, launchSourceDirectory, pid, instanceId }) {
  const selected = await inspectAtlasWorkspace(directory);
  need(selected.initialized, 'ATLAS_WORKSPACE_NOT_INITIALIZED');
  const privateLaunch = join(directory, LAUNCH_FILE);
  const value = decode(await bytes(privateLaunch, 65536), 'ATLAS_LAUNCH_RECORD_INVALID');
  need(value?.schema === ATLAS_LAUNCH_SCHEMA && value.state === 'LISTENING' &&
    value.directory === directory && value.workspaceId === selected.workspaceId &&
    value.sourceDirectory === sourceDirectory && sourceDirectory === SOURCE_DIRECTORY &&
    value.launchSourceDirectory === absolute(launchSourceDirectory) && value.privateLaunch === privateLaunch &&
    value.pid === pid && Number.isSafeInteger(pid) && pid > 0 &&
    value.instanceId === instanceId && typeof instanceId === 'string' &&
    /^[a-f0-9-]{36}$/.test(instanceId) && MODES.includes(value.source),
  'ATLAS_LAUNCH_BINDING_CHANGED');
  const expected = await sourceFiles(sourceDirectory);
  const launched = await sourceFiles(launchSourceDirectory);
  need(plain(value.sourceFiles) && Object.keys(value.sourceFiles).length === SOURCE_FILES.length &&
    SOURCE_FILES.every(name => value.sourceFiles[name] === expected[name] && launched[name] === expected[name]),
  'ATLAS_LAUNCH_SOURCE_CHANGED');
  privateUrl(value.url);
  return value;
}
