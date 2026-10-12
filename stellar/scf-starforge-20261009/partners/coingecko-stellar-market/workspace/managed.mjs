// MIT. Managed launch of the original CoinGecko browser and SQLite workspace.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { need, plain, sha, uuid, now, jsonBytes } from '../common.mjs';

export const MARKET_SELECTION_SCHEMA = 'stellar-forge.coingecko-managed-selection.v1';
export const MARKET_LAUNCH_SCHEMA = 'stellar-forge.coingecko-managed-launch.v1';
export const MARKET_MANAGED_FILES = Object.freeze([
  'cli.mjs', 'common.mjs', 'workspace/managed.mjs', 'workspace/server.mjs',
  'workspace/model.mjs', 'workspace/store.mjs', 'workspace/jobs.mjs',
  'workspace/public/app.mjs',
]);
const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const marketSelectionDigest = value => sha(jsonBytes(canonical(value)));
function absolute(value) {
  need(typeof value === 'string' && value === resolve(value) && !value.includes('\0'),
    'MANAGED_ABSOLUTE_PATH_REQUIRED', 'Select an absolute original path.');
  return value;
}
const identity = info => ({ device: String(info.dev), inode: String(info.ino) });
const owned = info => process.getuid === undefined || info.uid === process.getuid();
async function privateDirectory(value) {
  const path = absolute(value), info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && owned(info) &&
    !(info.mode & 0o077) && await realpath(path) === path,
  'MANAGED_PRIVATE_DIRECTORY_REQUIRED', 'Use a real private directory owned by this operator.');
  return { path, ...identity(info) };
}
async function bytesAt(value, maximum = 1048576, privateFile = false) {
  const path = absolute(value);
  need(await realpath(dirname(path)) === dirname(path), 'MANAGED_REAL_PARENT_REQUIRED');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const first = await handle.stat();
    need(first.isFile() && first.size <= maximum &&
      (!privateFile || owned(first) && first.nlink === 1 && !(first.mode & 0o077)),
    'MANAGED_ORIGINAL_FILE_REQUIRED', 'Select the complete original file in its private host location.');
    const bytes = await handle.readFile(), last = await handle.stat();
    need(bytes.length === first.size && first.size === last.size &&
      first.mtimeMs === last.mtimeMs && first.ctimeMs === last.ctimeMs,
    'MANAGED_FILE_CHANGED', 'The original file changed while it was being read.');
    return { bytes, path, sha256: sha(bytes), identity: identity(first) };
  } finally { await handle.close(); }
}
function parse(bytes, code) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { need(false, code, 'The original file must contain complete UTF-8 JSON.'); }
}

/** Read original identity and optional project without opening a write-capable model. */
export async function inspectMarketBinding(directory, { allowMissing = false, projectId = null } = {}) {
  absolute(directory);
  need(await realpath(dirname(directory)) === dirname(directory), 'MANAGED_REAL_PARENT_REQUIRED');
  if (projectId !== null) need(UUID.test(projectId), 'MANAGED_PROJECT_ID_INVALID');
  let folder;
  try { folder = await privateDirectory(directory); }
  catch (error) {
    if (!allowMissing || error.code !== 'ENOENT') throw error;
    need(projectId === null, 'MANAGED_PROJECT_NOT_FOUND');
    return { directory, identity: null, database: null, project: null,
      parent: await privateDirectory(dirname(directory)) };
  }
  const databasePath = join(directory, 'market.sqlite');
  let info;
  try { info = await lstat(databasePath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    need(projectId === null, 'MANAGED_PROJECT_NOT_FOUND');
    return { directory, identity: { device: folder.device, inode: folder.inode },
      database: null, project: null, parent: null };
  }
  need(info.isFile() && !info.isSymbolicLink() && owned(info) &&
    info.nlink === 1 && !(info.mode & 0o077), 'MANAGED_DATABASE_REQUIRED');
  const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 });
  let project = null;
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    need(['projects', 'records', 'files', 'operations'].every(name => tables.has(name)),
      'MANAGED_DATABASE_REQUIRED', 'Choose the original CoinGecko workspace.');
    if (projectId !== null) {
      const row = db.prepare('SELECT id,name,revision FROM projects WHERE id=?').get(projectId);
      need(row, 'MANAGED_PROJECT_NOT_FOUND', 'The selected project is not in this original workspace.');
      project = { id: row.id, name: row.name, revision: row.revision };
    }
  } finally { db.close(); }
  const after = await lstat(databasePath);
  need(after.isFile() && !after.isSymbolicLink() &&
    isDeepStrictEqual(identity(after), identity(info)), 'MANAGED_DATABASE_CHANGED');
  return { directory, identity: { device: folder.device, inode: folder.inode },
    database: { path: databasePath, ...identity(info) }, project, parent: null };
}

export async function readMarketManagedSource(root = ROOT) {
  absolute(root);
  const files = {};
  for (const name of MARKET_MANAGED_FILES) {
    const file = await bytesAt(resolve(root, name));
    files[name] = { bytes: file.bytes.length, sha256: file.sha256 };
  }
  return { files, sha256: marketSelectionDigest(files) };
}

/** Keep original profile paths and exact configuration outside the research archive. */
export async function readMarketManagedConfiguration(configurationFile = null) {
  if (configurationFile === null) return {
    configuration: { path: null, sha256: null, profiles: [] }, buyerProfiles: [], inputs: [],
  };
  const file = await bytesAt(configurationFile, 1048576, true);
  const value = parse(file.bytes, 'MANAGED_CONFIGURATION_JSON_REQUIRED');
  need(plain(value) && Array.isArray(value.buyerProfiles ?? []) &&
    (value.buyerProfiles ?? []).length <= 128, 'MANAGED_BUYER_PROFILES_INVALID');
  const buyerProfiles = [], profiles = [], inputs = [
    { path: file.path, kind: 'file', sha256: file.sha256 },
  ], ids = new Set();
  for (const profile of value.buyerProfiles ?? []) {
    need(plain(profile) && typeof profile.id === 'string' &&
      /^[A-Za-z0-9._:-]{1,160}$/.test(profile.id) && !ids.has(profile.id) &&
      typeof profile.name === 'string' && profile.name.trim().length > 0 &&
      profile.name.length <= 240 && typeof profile.network === 'string' &&
      profile.network.length > 0 && profile.network.length <= 128,
    'MANAGED_BUYER_PROFILE_INVALID');
    ids.add(profile.id);
    const nativeConfig = await bytesAt(absolute(profile.configPath), 1048576, true);
    // Syntax and source custody are checked here. The original native buyer
    // remains the authority for actual payment configuration and preparation.
    need(plain(parse(nativeConfig.bytes, 'MANAGED_BUYER_CONFIGURATION_INVALID')),
      'MANAGED_BUYER_CONFIGURATION_INVALID');
    const workspace = await privateDirectory(absolute(profile.workspacePath));
    const selected = { id: profile.id, name: profile.name, network: profile.network,
      configPath: nativeConfig.path, workspacePath: workspace.path };
    buyerProfiles.push(selected);
    profiles.push({ ...selected, configSha256: nativeConfig.sha256,
      workspaceIdentity: { device: workspace.device, inode: workspace.inode } });
    inputs.push({ path: nativeConfig.path, kind: 'file', sha256: nativeConfig.sha256 },
      { path: workspace.path, kind: 'directory' });
  }
  return { configuration: { path: file.path, sha256: file.sha256, profiles }, buyerProfiles, inputs };
}

export function parseMarketSelection(value) {
  if (typeof value === 'string') {
    need(Buffer.byteLength(value) <= 8000, 'MANAGED_SELECTION_TOO_LARGE',
      'Use a private configuration containing the buyer profiles needed for this application.');
    value = parse(Buffer.from(value), 'MANAGED_SELECTION_INVALID');
  }
  need(plain(value) && Buffer.byteLength(JSON.stringify(value)) <= 8000 && value.schema === MARKET_SELECTION_SCHEMA &&
    plain(value.workspace) && plain(value.configuration) && plain(value.source) &&
    plain(value.source.files) && HASH.test(value.source.sha256 ?? '') &&
    typeof value.allowLocalMerchant === 'boolean',
  'MANAGED_SELECTION_INVALID', 'Review the original CoinGecko application before Start.');
  absolute(value.workspace.directory);
  const validIdentity = item => plain(item) && /^\\d+$/.test(item.device ?? '') && /^\\d+$/.test(item.inode ?? '');
  const workspace = value.workspace, configuration = value.configuration;
  need((workspace.identity === null || validIdentity(workspace.identity)) &&
    (workspace.database === null || validIdentity(workspace.database) &&
      workspace.database.path === join(workspace.directory, 'market.sqlite')) &&
    (workspace.project === null || plain(workspace.project) && UUID.test(workspace.project.id ?? '') &&
      typeof workspace.project.name === 'string' && Number.isSafeInteger(workspace.project.revision) &&
      workspace.project.revision >= 0) &&
    (workspace.parent === null || validIdentity(workspace.parent) &&
      workspace.parent.path === dirname(workspace.directory)),
  'MANAGED_WORKSPACE_SELECTION_INVALID');
  need(Array.isArray(configuration.profiles) && configuration.profiles.length <= 128 &&
    (configuration.path === null
      ? configuration.sha256 === null && configuration.profiles.length === 0
      : HASH.test(configuration.sha256 ?? '') && absolute(configuration.path)),
  'MANAGED_CONFIGURATION_SELECTION_INVALID');
  need(isDeepStrictEqual(Object.keys(value.source.files).sort(), [...MARKET_MANAGED_FILES].sort()) &&
    Object.values(value.source.files).every(file => plain(file) && HASH.test(file.sha256 ?? '') &&
      Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 1048576) &&
    marketSelectionDigest(value.source.files) === value.source.sha256,
  'MANAGED_SOURCE_CHANGED');
  return value;
}

async function writeLaunch(path, value, replace = false) {
  const temporary = replace ? path + '.' + uuid() + '.next' : path;
  let handle, created = false;
  try {
    handle = await open(temporary, 'wx', 0o600); created = true;
    await handle.writeFile(jsonBytes(value)); await handle.sync(); await handle.close(); handle = null;
    if (replace) await rename(temporary, path);
  } catch (error) {
    await handle?.close().catch(() => {});
    if (created) await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function readMarketLaunch(path) {
  return parse((await bytesAt(path, 65536, true)).bytes, 'MANAGED_LAUNCH_INVALID');
}

/** The normal browser/model/worker and original lease own this entire lifetime. */
export async function startManagedMarketWorkspace({
  directory, selection, configurationFile = null, projectId = null,
  allowLocalMerchant = false, port = 0,
} = {}) {
  selection = parseMarketSelection(selection);
  need(directory === selection.workspace.directory &&
    configurationFile === selection.configuration.path &&
    (projectId ?? null) === (selection.workspace.project?.id ?? null) &&
    allowLocalMerchant === selection.allowLocalMerchant &&
    Number.isInteger(port) && port >= 0 && port <= 65535,
  'MANAGED_SELECTION_CHANGED');
  // Save creates a missing private directory; the original Start review then
  // binds that exact directory. A stale missing-directory review cannot launch.
  need(selection.workspace.identity !== null, 'MANAGED_START_REVIEW_REQUIRED',
    'Save the application, then review Start against its created private directory.');
  const source = await readMarketManagedSource();
  need(isDeepStrictEqual(source, selection.source), 'MANAGED_SOURCE_CHANGED');
  let originalConfiguration = await readMarketManagedConfiguration(configurationFile);
  need(isDeepStrictEqual(originalConfiguration.configuration, selection.configuration),
    'MANAGED_CONFIGURATION_CHANGED');
  const { startMarketWorkspace } = await import('./server.mjs');
  let launch = null, launchPath = null;
  const runtime = await startMarketWorkspace({
    directory, port, buyerProfiles: originalConfiguration.buyerProfiles,
    allowLocal: allowLocalMerchant,
    beforeOpen: async () => {
      const current = await inspectMarketBinding(directory, { projectId });
      need(isDeepStrictEqual(current, selection.workspace), 'MANAGED_WORKSPACE_CHANGED',
        'The selected original workspace or project changed. Review Start again.', 409);
      const latest = await readMarketManagedConfiguration(configurationFile);
      need(isDeepStrictEqual(latest.configuration, selection.configuration), 'MANAGED_CONFIGURATION_CHANGED');
      originalConfiguration = latest;
    },
    onListening: async ({ url }) => {
      const workspace = await inspectMarketBinding(directory, { projectId });
      const address = new URL('/', url);
      if (projectId) address.searchParams.set('project', projectId);
      const launchDirectory = join(directory, 'managed-launches');
      try { await mkdir(launchDirectory, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      await privateDirectory(launchDirectory);
      launch = { schema: MARKET_LAUNCH_SCHEMA, status: 'COINGECKO_READY',
        instanceId: uuid(), pid: process.pid, createdAt: now(),
        directory, workspace, sourceDirectory: ROOT,
        selectionSha256: marketSelectionDigest(selection), source,
        configuration: originalConfiguration.configuration, allowLocalMerchant,
        url: address.href, origin: address.origin };
      launchPath = join(launchDirectory, launch.instanceId + '.json');
      await writeLaunch(launchPath, launch);
      return launch;
    },
  });
  let closing;
  const close = () => closing ??= (async () => {
    let error;
    try { await runtime.close(); } catch (failure) { error = failure; }
    try {
      await writeLaunch(launchPath, { ...launch, status: 'CLOSED', closedAt: now() }, true);
    } catch (failure) { if (!error) error = failure; else error.launchRecordError = failure.code ?? failure.message; }
    if (error) throw error;
  })();
  return { ...runtime, url: launch.url, startup: launch, close };
}
