// MIT. Configure agent access to existing paid-job merchants without taking their lease.
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { line, writePrivate } from './host-files.mjs';
import { CONFIG_SCHEMA, readMerchantConfig } from './config.mjs';
import { readPaidJobWorkspaceConfiguration } from './paid-jobs.mjs';
import { initReleaseStore } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';

export async function initializePaidJobWorkspaceMerchant({ directory, connection,
  name = 'Starforge paid-job merchant' } = {}) {
  if (typeof directory !== 'string' || !directory || typeof connection !== 'string' || !connection)
    throw Object.assign(new Error('Supply the new merchant directory and private workspace connection file.'),
      { code: 'CONFIGURATION_ERROR' });
  const root = resolve(directory), paidJobWorkspaceConnection = resolve(connection);
  name = line(name, 'Merchant name');
  const configured = await readPaidJobWorkspaceConfiguration(paidJobWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, paidJobWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', paidJobWorkspacesConfigured: true,
    workspaces: Object.entries(configured.workspaces).map(([workspace, value]) => ({ workspace, label: value.label })),
    ownership: 'ORIGINAL_PAID_JOB_MERCHANT' };
}
