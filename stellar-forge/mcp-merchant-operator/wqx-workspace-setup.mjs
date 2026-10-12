// MIT. Resume the original WQX merchant host setup through the common provider registry.
import { constants } from 'node:fs';
import { mkdir, lstat, readdir, rename, open, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initReleaseStore, readReleaseState } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { exact, failure, line, writePrivate } from './host-files.mjs';
import { readWqxWorkspaceConfiguration, wqxDecode, wqxHash, wqxHostPath, wqxJson, wqxPrivateDirectory, wqxReadPrivate } from './wqx-workspace-connection.mjs';

const SCHEMA = 'stellar-forge.wqx-operator-setup.v1';
async function exists(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function sync(path) { const handle = await open(path, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } }
async function folder(path) {
  try { await mkdir(path, { mode: 0o700 }); await sync(dirname(path)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return wqxPrivateDirectory(path);
}
async function json(path) { return wqxDecode(await wqxReadPrivate(path, 1024 * 1024)); }
async function atomic(root, name, value) {
  const temporary = join(root, '.wqx-' + name + '-next-' + randomUUID());
  try { await writePrivate(temporary, value); await rename(temporary, join(root, name)); await sync(root); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function releaseStore(root, target) {
  if (await exists(target)) { await readReleaseState(target); return; }
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (!item.isDirectory() || !/^wqx-release-setup-[a-f0-9-]{36}$/.test(item.name)) continue;
    const path = join(root, item.name); let state;
    try { state = await readReleaseState(path); } catch { continue; }
    if (state.generation !== 0 || state.active !== null || state.previous !== null || state.history.length ||
        (await readdir(join(path, 'releases'))).length)
      throw failure('WQX_SETUP_STORE_CHANGED', 'The retained setup stage already contains original merchant activity. Select its intended store.');
    await rename(path, target); await sync(root); return;
  }
  const stage = join(root, 'wqx-release-setup-' + randomUUID());
  await initReleaseStore(stage); await readReleaseState(stage); await rename(stage, target); await sync(root);
}
export async function initializeWqxWorkspaceMerchant(options = {}) {
  exact(options, ['directory', 'connection', 'name', 'releaseStore'], ['directory', 'connection']);
  const root = wqxHostPath(options.directory, process.cwd()), connection = wqxHostPath(options.connection, process.cwd());
  const name = line(options.name ?? 'Water quality merchant', 'Merchant name');
  const selectedStore = options.releaseStore === undefined ? join(root, 'releases') : wqxHostPath(options.releaseStore, process.cwd());
  const configured = await readWqxWorkspaceConfiguration(connection);
  await wqxPrivateDirectory(dirname(root)); await folder(root);
  const lease = await acquireStateLease(root);
  try {
    const { CONFIG_SCHEMA, readMerchantConfig } = await import('./config.mjs');
    const configuration = join(root, 'merchant-mcp.json'), marker = join(root, 'wqx-setup.json');
    const intent = { schema: SCHEMA, connection, releaseStore: selectedStore, name };
    if (await exists(marker)) {
      if (wqxHash(wqxJson(await json(marker))) !== wqxHash(wqxJson(intent)))
        throw failure('WQX_SETUP_CHANGED', 'This host setup belongs to another original connection, name or release store.');
    } else {
      const allowed = new Set(['lease.lock', 'merchant-mcp.json']);
      if (!(await readdir(root)).every(item => allowed.has(item) || /^\.wqx-[A-Za-z0-9_.-]+-next-[a-f0-9-]{36}$/.test(item)))
        throw failure('WQX_SETUP_DIRECTORY_IN_USE', 'Select a new private merchant directory, or reopen the original WQX setup directory.');
      if (await exists(configuration)) {
        const raw = await json(configuration);
        if (raw.schema !== CONFIG_SCHEMA || wqxHostPath(raw.wqxWorkspaceConnection, root) !== connection ||
            wqxHostPath(raw.releaseStore, root) !== selectedStore)
          throw failure('WQX_SETUP_CHANGED', 'The retained merchant configuration selects another original connection or store.');
      }
      lease.assertHeld(); await atomic(root, 'wqx-setup.json', intent);
    }
    if (options.releaseStore === undefined) await releaseStore(root, selectedStore); else await readReleaseState(selectedStore);
    await folder(join(root, 'customer-exports'));
    const reopening = Boolean(await exists(configuration));
    if (reopening) {
      const raw = await json(configuration);
      if (raw.schema !== CONFIG_SCHEMA || wqxHostPath(raw.wqxWorkspaceConnection, root) !== connection ||
          wqxHostPath(raw.releaseStore, root) !== selectedStore)
        throw failure('WQX_SETUP_CHANGED', 'The retained merchant configuration selects different original sources.');
    } else {
      lease.assertHeld(); await atomic(root, 'merchant-mcp.json', { schema: CONFIG_SCHEMA, name, releaseStore: selectedStore,
        exportsDirectory: './customer-exports', sources: {}, wqxWorkspaceConnection: connection });
    }
    const current = await readMerchantConfig(configuration);
    if (!current.wqxWorkspaces?.workspaces) throw failure('WQX_HOST_SOURCE_REQUIRED', 'Select the installed source that declares the original WQX merchant provider.');
    return { schema: CONFIG_SCHEMA, configuration, configurationSha256: wqxHash(await wqxReadPrivate(configuration, 1024 * 1024)),
      state: reopening ? 'REOPENED' : 'INITIALIZED', wqxWorkspacesConfigured: true,
      workspaces: Object.entries(configured.workspaces).map(([workspace, item]) => ({ workspace, label: item.label, projectBindingId: item.projectBindingId })),
      ownership: 'ORIGINAL_MANAGED_WQX_HOST' };
  } finally { await lease.close(); }
}
