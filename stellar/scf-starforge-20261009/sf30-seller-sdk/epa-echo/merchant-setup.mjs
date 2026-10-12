// MIT. Product-owned setup for the existing EPA ECHO merchant attachment.
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { exact, failure, line, writePrivate } from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { readEchoWorkspaceConfiguration } from './mcp.mjs';

function hostPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0'))
    throw failure('CONFIGURATION_ERROR', 'Choose an original host path.');
  return resolve(value);
}

/** Initialize the original merchant host around an already running EPA ECHO workspace. */
export async function initializeEchoWorkspaceMerchant(options) {
  exact(options, ['directory', 'connection', 'name'], ['directory', 'connection']);
  const { directory, connection, name = 'Starforge EPA ECHO facility operator' } = options;
  const root = hostPath(directory), echoWorkspaceConnection = hostPath(connection);
  const selectedName = line(name, 'Merchant name');
  const selected = await readEchoWorkspaceConfiguration(echoWorkspaceConnection);
  const [{ CONFIG_SCHEMA, readMerchantConfig }, { initReleaseStore }] = await Promise.all([
    import('../../../../stellar-forge/mcp-merchant-operator/config.mjs'),
    import('../../sf82-seller-pilot/releases.mjs')
  ]);
  await mkdir(root, { mode: 0o700 });
  await initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, {
    schema: CONFIG_SCHEMA, name: selectedName, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, echoWorkspaceConnection
  });
  await readMerchantConfig(configuration);
  return {
    schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', echoWorkspacesConfigured: true,
    workspaces: Object.entries(selected.workspaces).map(([workspace, item]) => ({
      workspace, label: item.label, workspaceId: item.workspaceId
    })),
    authoring: 'ORIGINAL_EPA_ECHO_WORKSPACE'
  };
}
