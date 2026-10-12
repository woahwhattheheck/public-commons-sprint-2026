// MIT. Original merchant setup for one or more existing recovery listeners.
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { exact, line, writePrivate, failure } from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { CONFIG_SCHEMA, readMerchantConfig } from '../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import { initReleaseStore } from '../../sf82-seller-pilot/releases.mjs';
import { readRecoveryWorkspaceConfiguration } from './merchant-client.mjs';

export async function initializeRecoveryWorkspaceMerchant(options = {}) {
  exact(options, ['directory', 'connection', 'name'], ['directory', 'connection']);
  for (const key of ['directory', 'connection'])
    if (typeof options[key] !== 'string' || !isAbsolute(options[key]) || resolve(options[key]) !== options[key])
      throw failure('CONFIGURATION_ERROR', key + ' must be a normalized absolute host path.');
  const root = options.directory, recoveryWorkspaceConnection = options.connection;
  const name = line(options.name ?? 'Starforge merchant recovery', 'Merchant name');
  const selected = await readRecoveryWorkspaceConfiguration(recoveryWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, recoveryWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', recoveryWorkspacesConfigured: true,
    ownership: 'ORIGINAL_RECOVERY_WORKSPACE',
    workspaces: Object.entries(selected.workspaces).map(([workspace, value]) => ({
      workspace, label: value.label, workspaceId: value.identity.workspaceId,
      configurationSha256: value.identity.configurationSha256 })) };
}
