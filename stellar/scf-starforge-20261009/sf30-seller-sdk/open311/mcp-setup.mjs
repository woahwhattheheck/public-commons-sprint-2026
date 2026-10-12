// MIT. Replayable native merchant setup using the original release-store initializer.
import { readdir, lstat, rename, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG_SCHEMA, readMerchantConfig } from '../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import { writePrivate, failure, line } from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { initReleaseStore, readReleaseState } from '../../sf82-seller-pilot/releases.mjs';
import { privateDirectory, withPrivateLock, atomicJson, readPrivateJson } from '../routescan/quota.mjs';
import { canonicalJson } from './domain.mjs';
import { readOpen311WorkspaceConfiguration } from './mcp-client.mjs';

const SETUP = 'stellar-forge.open311-native-setup.v1';
const need = (value, message) => { if (!value) throw failure('OPEN311_SETUP_CONFLICT', message); };
async function optional(path, maximum = 1024 * 1024) {
  try { return await readPrivateJson(path, maximum); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function directorySync(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function exactConfiguration(path, value) {
  const found = await optional(path);
  if (found) { need(canonicalJson(found) === canonicalJson(value), 'The original native merchant configuration changed.'); return; }
  try { await writePrivate(path, value); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need(canonicalJson(await optional(path)) === canonicalJson(value), 'Another setup selected a different native merchant configuration.');
  }
}
export async function initializeOpen311MerchantWorkspace({
  directory, connection, name = 'Starforge municipal service desks', releaseStore,
} = {}) {
  need(typeof directory === 'string' && directory && typeof connection === 'string' && connection,
    'Supply the native merchant directory and original private workspace connection file.');
  name = line(name, 'Native merchant name');
  const root = resolve(directory), selectedConnection = resolve(connection);
  const selected = await readOpen311WorkspaceConfiguration(selectedConnection);
  const binding = { schema: SETUP, name, connection: selectedConnection,
    releaseStore: releaseStore ? resolve(releaseStore) : null };
  await privateDirectory(root);
  return withPrivateLock(root, 'open311-setup.lock', async () => {
    let intent = await optional(join(root, 'open311-setup.json'), 1024 * 1024);
    if (intent) need(canonicalJson(intent.binding) === canonicalJson(binding),
      'This original setup belongs to another selected host configuration.');
    else {
      need((await readdir(root)).every(name => name === 'open311-setup.lock'),
        'Initialize a new empty native merchant directory or replay its original setup.');
      intent = { binding, attempts: [] };
      await atomicJson(root, 'open311-setup.json', intent);
    }
    const store = binding.releaseStore ?? join(root, 'releases');
    if (binding.releaseStore) await readReleaseState(store);
    else {
      let info;
      try { info = await lstat(store); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (info) {
        need(info.isDirectory() && !info.isSymbolicLink(), 'Keep the original release store directory.');
        await readReleaseState(store);
      } else {
        let stage = intent.attempts.at(-1)?.directory, ready = false;
        if (stage) {
          try { await readReleaseState(stage); ready = true; }
          catch (error) {
            intent.attempts.at(-1).interrupted = true;
            intent.attempts.at(-1).lastError = { code: String(error.code ?? 'RELEASE_SETUP_ERROR'),
              message: String(error.message ?? 'Release-store setup was interrupted.') };
            await atomicJson(root, 'open311-setup.json', intent);
          }
        }
        if (!ready) {
          stage = join(root, 'release-store-preparing-' + randomUUID());
          intent.attempts.push({ directory: stage, startedAt: new Date().toISOString() });
          await atomicJson(root, 'open311-setup.json', intent);
          await initReleaseStore(stage);
        }
        await privateDirectory(join(stage, 'releases'));
        await rename(stage, store); await directorySync(root);
        await readReleaseState(store);
      }
    }
    await privateDirectory(join(root, 'customer-exports'));
    const configuration = join(root, 'merchant-mcp.json');
    const config = { schema: CONFIG_SCHEMA, name,
      releaseStore: binding.releaseStore ?? './releases',
      exportsDirectory: './customer-exports', sources: {}, open311WorkspaceConnection: selectedConnection };
    await exactConfiguration(configuration, config); await directorySync(root);
    await readMerchantConfig(configuration);
    const result = { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED',
      open311WorkspacesConfigured: true,
      workspaces: Object.entries(selected.workspaces).map(([workspace, item]) =>
        ({ workspace, label: item.label, connectionProfiles: Object.keys(item.connectionProfiles),
          inputs: Object.keys(item.inputs) })),
      hostOwnership: 'ORIGINAL_OPEN311_WORKSPACES' };
    await atomicJson(root, 'open311-setup-result.json', result);
    return result;
  });
}
