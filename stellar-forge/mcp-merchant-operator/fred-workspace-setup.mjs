// MIT. Attach the installed merchant host to existing original economic workspaces.
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { readFredWorkspaceConfiguration } from './fred-workspace-client.mjs';
import { CONFIG_SCHEMA, readMerchantConfig, line, writePrivate } from './config.mjs';

export async function initializeFredWorkspaceMerchant({ directory, connection, name = 'Starforge economic editions' }) {
  if (typeof directory !== 'string' || !directory || typeof connection !== 'string' || !connection)
    throw Object.assign(new Error('Supply the new merchant directory and original FRED connection file.'), { code: 'CONFIGURATION_ERROR' });
  const root = resolve(directory), fredWorkspaceConnection = resolve(connection);
  name = line(name, 'Merchant name');
  const selected = await readFredWorkspaceConfiguration(fredWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, fredWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', fredWorkspacesConfigured: true,
    workspaces: Object.entries(selected.workspaces).map(([workspace, value]) => ({
      workspace, label: value.label, projectId: value.projectId ?? null })),
    hostOwnership: 'ORIGINAL_FRED_WORKSPACE' };
}
